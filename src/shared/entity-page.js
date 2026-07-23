// Office: the Historian (historian) — docs/PERSONAS.md §11.
// Entity pages — EP.1/EP.2 (docs/ENTITY_PAGE_KICKOFF.md). The pure
// half of the entity-page pipeline: the reduce tool + prompts, the
// deterministic entity digest, the schema validator, citation
// grounding, the staleness input hash, and the cache-first map stage
// (`ensureExtracts`).
//
// AN ENTITY PAGE IS A CASE BRIEF ABOUT A SUBJECT: grounded prose
// sections, disagreement side by side, gaps stated honestly, a "key
// facts" box that is a CURATED LIST OF CLAIMS (the claim is the fact;
// the quote is the verification). The guard rails that killed the
// Phase 19 fact layer are structural here (kickoff §3): no typed
// fields, no numeric slots, no model knowledge, no minted references
// — `key_claim_ids` is subset-filtered in code, citations ground or
// drop, disclosed.
//
// THE ONE-REQUEST-BUILDER RULE (corpus-v4): ensureExtracts builds map
// requests via `corpusMapRequest` with the caller-supplied frame — in
// a case-bound workspace that frame is the CASE's, so the cache keys
// are byte-identical to the ones Analyze / Pre-analyze already paid
// for. Never hand-build a lookalike request here.

import { Crypto } from './crypto.js';
import { walk, obj, str, nullableStr, arr } from './schema-walker.js';
import {
    corpusMapRequest, corpusExtractKey, validateCorpusExtract
} from './case-synthesis.js';
import { orchestrateModuleRuns } from './audit/run-orchestrator.js';
import { getCorpusExtract, saveCorpusExtract } from './audit/audit-cache.js';

// Version discipline (the 20.6 lesson): a prompt / tool / digest
// change bumps this so stored pages correctly go stale. The MAP side
// deliberately has NO version of its own here — ensureExtracts rides
// MAP_PROMPT_VERSION through corpusExtractKey, so a page iteration
// never orphans the shared map cache.
export const ENTITY_PAGE_PROMPT_VERSION = 'entity-page-v1';
export const ENTITY_PAGE_TOOL_NAME = 'emit_entity_page';
// A page is narrower than a whole-case brief (one subject, not every
// position in a corpus) — half the reduce budget fits with headroom.
export const MAX_ENTITY_PAGE_OUTPUT_TOKENS = 16384;

// Digest caps — same economics as digestDossier's claim cap: the
// index must span the corpus, not drown the prompt.
export const PAGE_DIGEST_CLAIM_CAP = 120;
const PAGE_DIGEST_CO_TAGGED_CAP = 12;

// ------------------------------------------------------------------
// Tool + prompts
// ------------------------------------------------------------------

export function buildEntityPageTool() {
    return {
        name: ENTITY_PAGE_TOOL_NAME,
        description: 'Write a grounded encyclopedia-style page about ONE subject, built '
            + 'STRICTLY from the supplied corpus. Every citation is a verbatim quote from a '
            + 'named member article (machine-checked). Present disagreement side by side; '
            + 'NEVER a verdict, score, or probability. What the corpus does not establish '
            + 'goes in gaps, never on the page.',
        input_schema: {
            type: 'object',
            properties: {
                lead: {
                    type: 'string',
                    description: 'A neutral 2-4 sentence introduction of the subject AS THE CORPUS '
                        + 'PRESENTS IT — who/what it is and why it appears in these sources. No '
                        + 'outside knowledge, no judgment.'
                },
                sections: {
                    type: 'array',
                    description: 'The body: prose sections whose headings emerge from what the corpus '
                        + 'actually contains (roles, history, involvement, positions taken…) — never '
                        + 'a fixed template. Attribute assertions to their sources in the prose '
                        + '("According to <source>, …").',
                    items: {
                        type: 'object',
                        properties: {
                            heading: { type: 'string', description: 'Short section heading.' },
                            body: { type: 'string', description: 'The section prose. Only what the cited members establish.' },
                            citations: {
                                type: 'array',
                                description: 'The verbatim evidence this section rests on. A section with no '
                                    + 'locatable citations is flagged for review.',
                                items: {
                                    type: 'object',
                                    properties: {
                                        article_hash: { type: 'string', description: 'The FULL 64-hex hash of the member article (from the extract headers or the digest articles map — never an art key).' },
                                        quote: { type: 'string', description: 'ONE contiguous VERBATIM span copied from that member, character for character. Machine-checked; an unlocatable quote is dropped.' }
                                    },
                                    required: ['article_hash', 'quote']
                                }
                            }
                        },
                        required: ['heading', 'body']
                    }
                },
                key_claim_ids: {
                    type: 'array',
                    description: 'The "key facts" box: SELECT the claims from the digest\'s claims '
                        + 'index that best summarize what the corpus establishes about the subject. '
                        + 'Existing ids ONLY — never invent one; unknown ids are dropped.',
                    items: { type: 'string' }
                },
                disputes: {
                    type: 'array',
                    description: 'Points where the corpus disagrees about the subject — each side '
                        + 'presented with its own evidence, side by side. Never resolve, rank, or '
                        + 'pick a side.',
                    items: {
                        type: 'object',
                        properties: {
                            topic: { type: 'string', description: 'What is disputed.' },
                            sides: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        view: { type: 'string', description: 'This side\'s position, neutrally stated.' },
                                        article_hash: { type: 'string', description: 'The member arguing it (full hash).' },
                                        quote: { type: 'string', description: 'Verbatim span from that member.' }
                                    },
                                    required: ['view']
                                }
                            }
                        },
                        required: ['topic']
                    }
                },
                gaps: {
                    type: 'array',
                    description: 'What the corpus does NOT establish about the subject — the honest '
                        + 'boundary of the page (P6: absence is not evidence of absence).',
                    items: { type: 'string' }
                }
            },
            required: ['lead']
        }
    };
}

export function buildEntityPageSystemPrompt({ entityName = '', entityType = '', caseName = '', scopeQuestion = '' } = {}) {
    return [
        `You are writing a grounded encyclopedia-style page about ${entityName ? `"${entityName}"` : 'one subject'}`
            + `${entityType ? ` (a ${entityType})` : ''}, built strictly from a research corpus.`,
        caseName ? `The corpus belongs to the researcher's case "${caseName}".` : '',
        scopeQuestion ? `That case investigates: "${scopeQuestion}". The PAGE is about the subject, not the case — use the case only as context.` : '',
        'You receive a deterministic digest (the subject, a claims index, judgment distributions,',
        'coverage) and per-article extracts. Write the page FROM THESE INPUTS ONLY.',
        'HARD RULES (docs/PHILOSOPHY.md; docs/ENTITY_PAGE_KICKOFF.md §3):',
        '- NO OUTSIDE KNOWLEDGE, ever. If you know something about the subject that the corpus',
        '  does not establish, it does NOT go on the page — the corpus\'s silence goes in `gaps`.',
        '- Every citation quote must be ONE contiguous span copied VERBATIM from the named member',
        '  (keep punctuation, capitalization, typos). Quotes are machine-checked; an unlocatable',
        '  quote is dropped and its section flagged.',
        '- NEVER output a verdict, score, probability, or "who is right". Where sources disagree',
        '  about the subject, put the disagreement in `disputes` with each side\'s own evidence —',
        '  side by side, never resolved.',
        '- Attribute in the prose: "According to <outlet/author>, …" — the page reports what',
        '  sources say, it never asserts contested things in its own voice.',
        '- `key_claim_ids` SELECTS from the digest\'s claims index (each entry is `id — text`).',
        '  Existing ids only; never invent, abbreviate, or shorthand one. Unknown ids are dropped.',
        '- `art` keys in the claims index are reading shorthand only. Anywhere the tool asks for',
        '  an `article_hash`, supply the FULL 64-hex hash from the digest\'s `articles` map or the',
        '  extract headers — never an `art` key.',
        '- Section headings come from what the corpus contains — do not force a template or pad',
        '  thin coverage into empty sections. A short honest page beats a long padded one.'
    ].filter(Boolean).join('\n');
}

/** The reduce user turn: the digest + per-member extract blocks. */
export function buildEntityPageUserPrompt({ entityDigest = '', extracts = [] } = {}) {
    const extractText = extracts.map((e) => {
        const lines = [`ARTICLE ${e.article_hash}${e.title ? ` — ${e.title}` : ''}`];
        if (e.extract && e.extract.position) {
            lines.push(`  position: ${e.extract.position.summary || ''}`
                + (e.extract.position.side_label ? ` [side: ${e.extract.position.side_label}]` : ''));
        }
        for (const a of (e.extract && e.extract.key_assertions) || []) {
            lines.push(`  assertion: "${a.quote}"`);
        }
        return lines.join('\n');
    }).join('\n\n');
    return `ENTITY DIGEST (deterministic, code-computed):\n${entityDigest}\n\n`
        + `PER-ARTICLE EXTRACTS:\n${extractText}`;
}

// ------------------------------------------------------------------
// The deterministic entity digest
// ------------------------------------------------------------------

// Key-first, then oldest-first, then id — the case-export order the
// digest claim caps use everywhere.
function orderClaims(claims) {
    return [...claims].sort((a, b) =>
        (b.is_key ? 1 : 0) - (a.is_key ? 1 : 0)
        || (a.created || 0) - (b.created || 0)
        || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Digest an entity dossier for the page reduce: the subject, a capped
 * claims index (with the digestDossier art-key idiom), judgment
 * DISTRIBUTIONS (never a score), co-tagged names, and coverage.
 * Pure + deterministic: same inputs ⇒ same string.
 *
 * @param {object} dossier   buildEntityDossier output
 * @param {object} [opts]
 * @param {Array}  [opts.claims]     the subject's orbit claims
 * @param {object} [opts.namesById]  entity id → display name
 */
export function digestEntityDossier(dossier, { claims = [], namesById = {} } = {}) {
    const capped = orderClaims(claims).slice(0, PAGE_DIGEST_CLAIM_CAP);
    const artKeyByHash = new Map();
    for (const c of capped) {
        const h = c.article_hash || null;
        if (h && !artKeyByHash.has(h)) artKeyByHash.set(h, `A${artKeyByHash.size + 1}`);
    }
    const claimIndex = capped.map((c) => ({
        id: c.id,
        text: (c.text || '').slice(0, 160),
        quote: (c.quote || '').slice(0, 200) || null,
        key: !!c.is_key,
        art: c.article_hash ? artKeyByHash.get(c.article_hash) : null
    }));
    const articleKeys = {};
    for (const [hash, key] of artKeyByHash) articleKeys[key] = hash;

    const aliases = ((dossier.identity && dossier.identity.family) || [])
        .filter((m) => m.relation === 'alias')
        .map((m) => m.name);
    const judgments = dossier.judgments || {};

    return JSON.stringify({
        subject: {
            name: dossier.subject.name,
            type: dossier.subject.type,
            description: dossier.subject.description || '',
            aliases
        },
        coverage: dossier.coverage || {},
        claims: claimIndex,
        articles: articleKeys,
        claim_count: claimIndex.length,
        // Distributions ONLY (P8/§10): counts of judgments, never a
        // fused anything.
        judgments: {
            assessments_by_stance: (judgments.assessments && judgments.assessments.by_stance) || {},
            verdicts: (judgments.verdicts || []).length,
            integrity_findings: (judgments.integrity_findings || []).length,
            forensic_findings: (judgments.forensic || []).length
        },
        co_tagged: ((dossier.relationships && dossier.relationships.co_tagged) || [])
            .slice(0, PAGE_DIGEST_CO_TAGGED_CAP)
            .map((co) => ({
                name: namesById[co.entity_id] || co.entity_id,
                shared_claims: co.shared_claims
            }))
    });
}

// ------------------------------------------------------------------
// Validation + reference hygiene
// ------------------------------------------------------------------

const PAGE_SCHEMA = obj({
    lead: str({ minLength: 1 }),
    sections: arr(obj({
        heading: str({ minLength: 1 }),
        body: str({ minLength: 1 }),
        citations: arr(obj({ article_hash: str({ minLength: 1 }), quote: str({ minLength: 1 }) }, ['article_hash', 'quote']))
    }, ['heading', 'body'])),
    key_claim_ids: arr(str({ minLength: 1 })),
    disputes: arr(obj({
        topic: str({ minLength: 1 }),
        sides: arr(obj({ view: str({ minLength: 1 }), article_hash: nullableStr(), quote: nullableStr() }, ['view']))
    }, ['topic'])),
    gaps: arr(str())
}, ['lead']);

export function validateEntityPage(input) {
    const errors = [];
    walk(input, PAGE_SCHEMA, '$', errors);
    return { ok: errors.length === 0, errors };
}

/**
 * No-minting filter: `key_claim_ids` keeps only ids the digest's
 * claims index actually contains. Code-enforced, not just prompted —
 * a hallucinated id can never reach the key-facts box.
 */
export function filterKeyClaimIds(page, knownClaimIds) {
    const known = knownClaimIds instanceof Set ? knownClaimIds : new Set(knownClaimIds || []);
    const ids = Array.isArray(page && page.key_claim_ids) ? page.key_claim_ids : [];
    return { ...page, key_claim_ids: ids.filter((id) => known.has(id)) };
}

// ------------------------------------------------------------------
// Grounding — every citation quote must locate in its named member
// ------------------------------------------------------------------

/**
 * Ground every citation ({article_hash, quote}) in sections and
 * dispute sides against THAT member's text. Ungrounded citations
 * drop; a section whose citations ALL drop (or that never had any) is
 * flagged `uncited: true` for the review UI to badge — kept, never
 * silently trusted. Returns { page, grounding: {checked, dropped} }.
 *
 * @param {object} page           validated page tool output
 * @param {object} indexByMember  article_hash → createGroundingIndex(text)
 */
export function groundEntityPage(page, indexByMember) {
    let checked = 0;
    let dropped = 0;
    const groundOne = (article_hash, quote) => {
        checked++;
        const idx = indexByMember[article_hash];
        if (!idx) { dropped++; return null; }
        const res = idx.ground(quote);
        if (!res || res.status === 'missing') { dropped++; return null; }
        // Store the ARTICLE's own span, never the model's rendition.
        return res.exact || quote;
    };

    const sections = (page.sections || []).map((s) => {
        const citations = [];
        for (const c of s.citations || []) {
            const exact = groundOne(c.article_hash, c.quote);
            if (exact !== null) citations.push({ article_hash: c.article_hash, quote: exact });
        }
        return { ...s, citations, uncited: citations.length === 0 };
    });

    const disputes = (page.disputes || []).map((d) => ({
        ...d,
        sides: (d.sides || []).map((side) => {
            if (!side.article_hash || !side.quote) {
                return { ...side, article_hash: side.article_hash || null, quote: null };
            }
            const exact = groundOne(side.article_hash, side.quote);
            return { ...side, quote: exact };   // null when unlocatable — the view stays, unanchored
        })
    }));

    return { page: { ...page, sections, disputes }, grounding: { checked, dropped } };
}

// ------------------------------------------------------------------
// Staleness — the input hash a stored page compares against
// ------------------------------------------------------------------

/**
 * Order-insensitive fingerprint of everything the page depends on:
 * the member set (by article hash), the subject's claim ids, and the
 * prompt version. Mirrors corpusInputHash exactly (the brief's
 * staleness discipline).
 */
export async function entityPageInputHash(members, claimIds, version = ENTITY_PAGE_PROMPT_VERSION) {
    const memberHashes = (members || []).map((m) => m.article_hash || '').sort();
    const ids = [...(claimIds || [])].sort();
    return Crypto.sha256(JSON.stringify({ v: version, members: memberHashes, claims: ids }));
}

// ------------------------------------------------------------------
// EP.1 — the cache-first map stage
// ------------------------------------------------------------------

/**
 * Ensure a valid map extract exists for every member: reuse cached
 * hits, call `xray:llm:corpus-map` only on misses, persist each new
 * extract under its `corpusExtractKey`. Requests come from
 * `corpusMapRequest` with the caller's frame — in a case-bound
 * workspace pass the CASE's frame so the keys are byte-identical to
 * Analyze / Pre-analyze's and the cache is shared (kickoff §3 rail 5).
 *
 * @param {Array}  members  buildMemberUnits output
 * @param {object} frame    { caseName, scopeQuestion }
 * @param {object} deps
 * @param {function} deps.sendMessage  ({type,request}) → Promise
 * @param {function} [deps.onProgress]
 * @param {object}  [io]  injectable for tests: getExtract, saveExtract, now
 * @returns {Promise<{extracts: Array<{article_hash,title,url,extract}>,
 *                    failures: Array, hits: number, calls: number}>}
 */
export async function ensureExtracts(members, frame, { sendMessage, onProgress = null } = {}, io = {}) {
    const d = {
        getExtract: getCorpusExtract,
        saveExtract: saveCorpusExtract,
        now: () => Math.floor(Date.now() / 1000),
        ...io
    };
    const unitById = {};
    const keyById = {};
    const cachedById = {};
    for (const m of members || []) {
        unitById[m.article_hash] = m;
        const key = await corpusExtractKey(corpusMapRequest(m, frame));
        keyById[m.article_hash] = key;
        const hit = await Promise.resolve(d.getExtract(key)).catch(() => null);
        if (hit && hit.extract && validateCorpusExtract(hit.extract).ok) cachedById[m.article_hash] = hit;
    }

    let calls = 0;
    const { modules, failures } = await orchestrateModuleRuns({
        moduleNames: (members || []).map((m) => m.article_hash),
        concurrency: 2,
        onProgress: onProgress || (() => {}),
        send: async (id) => {
            const cached = cachedById[id];
            if (cached) return { ok: true, findings: cached.extract, model: cached.model };
            calls++;
            const res = await sendMessage({ type: 'xray:llm:corpus-map', request: corpusMapRequest(unitById[id], frame) });
            if (!res || !res.ok) return { ...(res || {}), ok: false };
            const v = validateCorpusExtract(res.extract);
            if (!v.ok) return { ok: false, error: 'invalid extract' };
            await Promise.resolve(d.saveExtract({
                key: keyById[id], extract: res.extract, model: res.model, cachedAt: d.now()
            })).catch(() => {});
            return { ok: true, findings: res.extract, model: res.model };
        }
    });

    // orchestrateModuleRuns stores each success's `findings` directly.
    const extracts = [];
    for (const m of members || []) {
        const extract = modules[m.article_hash];
        if (extract) {
            extracts.push({ article_hash: m.article_hash, title: m.title || '', url: m.url || '', extract });
        }
    }
    return { extracts, failures, hits: Object.keys(cachedById).length, calls };
}

// Case-corpus synthesis — Phase 20.4 (docs/CASE_SYNTHESIS_DESIGN.md).
// The pure half of the map/reduce: assemble the member units the map
// stage consumes, hash the corpus input (so a stored brief invalidates
// when membership/text/claims/prompt change), digest the deterministic
// dossier for the reduce stage, validate both tool outputs against
// schema walkers, ground every brief quote against the member texts,
// and filter the proposals to real, resolvable references.
//
// No network, no DOM. It reads Crypto.sha256 and EventBuilder (pure
// body assembly) and quote-grounding — all import-safe. The portal
// runner (synthesis-block.js) drives the actual LLM calls + storage.

import { Crypto } from './crypto.js';
import { Utils } from './utils.js';
import { EventBuilder } from './event-builder.js';
import { createGroundingIndex } from './quote-grounding.js';
import { CLAIM_RELATIONSHIPS } from './assessment-taxonomy.js';
import { walk, obj, str, nullableStr, arr, en } from './schema-walker.js';
import { deriveArticleRows } from './case-dossier.js';
import { canonicalIdOf } from './entity-model.js';
import { MAX_MEMBER_INPUT_CHARS, MAP_PROMPT_VERSION, CORPUS_PROMPT_VERSION } from './corpus-prompts.js';

// ------------------------------------------------------------------
// Member units — one per archive-backed member row
// ------------------------------------------------------------------

async function sha16(s) { return (await Crypto.sha256(String(s || ''))).slice(0, 16); }

/**
 * Build the map-stage units: one per `deriveArticleRows` row that has
 * an archive record. `text` is the SAME canonical body the article
 * hash covers (so quotes ground against exactly what was sent),
 * truncated to the budget with the flag surfaced. `assessmentsByClaim`
 * (claim id → stance) is joined in by the caller from AssessmentModel.
 *
 * A member's `claims` are ALL claims captured from its URL — joined by
 * normalized `source_url` against the full registry (`data.claimsById`),
 * NOT the orbit filter (`about` names the case). Union membership (20.1)
 * makes an article a member by TAG, and its atomized claims must ride
 * along, or a corpus of hundreds of claims collapses to the handful
 * authored directly about the case entity — the map/reduce would then
 * "see" almost none of the corpus. `deriveArticleRows` still supplies
 * the member URL set (its orbit-scoped `row.claims` is intentionally
 * bypassed here); the deterministic dossier keeps its own attachment.
 * The URL join also means a claim's frozen `article_hash` lagging a
 * re-publish never gates inclusion — the unit is keyed to the member's
 * CURRENT hash regardless.
 */
export async function buildMemberUnits(data, { assessmentsByClaim = {} } = {}) {
    const { rows } = deriveArticleRows(data);
    const recByUrl = new Map();
    for (const rec of data.articles || []) {
        if (rec && rec.url) recByUrl.set(rec.url, rec);
    }
    const claimsByUrl = new Map();
    for (const c of Object.values(data.claimsById || {})) {
        if (!c || !c.source_url) continue;
        const u = Utils.normalizeUrl(c.source_url) || c.source_url;
        if (!claimsByUrl.has(u)) claimsByUrl.set(u, []);
        claimsByUrl.get(u).push(c);
    }
    const units = [];
    for (const row of rows) {
        const rec = recByUrl.get(row.url) || null;
        if (!rec || !rec.article) continue;   // only archive-backed members feed the corpus
        const full = EventBuilder.assembleArticleBody(rec.article) || '';
        const text = full.slice(0, MAX_MEMBER_INPUT_CHARS);
        const id = rec.articleHash || (`url:${await sha16(row.url)}`);
        // Key-first then oldest-first then id (the case-export order),
        // so a truncating consumer keeps the key claims and the set is
        // deterministic regardless of registry iteration order.
        const rowClaims = (claimsByUrl.get(row.url) || []).slice().sort((a, b) =>
            (b.is_key ? 1 : 0) - (a.is_key ? 1 : 0)
            || (a.created || 0) - (b.created || 0)
            || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        units.push({
            article_hash: id,
            url: row.url,
            title: row.title || null,
            text,
            truncated: full.length > MAX_MEMBER_INPUT_CHARS,
            total_chars: full.length,
            claims: rowClaims.map((c) => ({
                id: c.id, text: c.text, quote: c.quote || null, is_key: !!c.is_key,
                stance: (c.id in assessmentsByClaim) ? assessmentsByClaim[c.id] : null
            }))
        });
    }
    return units;
}

/**
 * Fold same-content captures: member units sharing an `article_hash`
 * (the canonical normalized-text hash — e.g. the view-URL and the
 * download-URL captures of one Drive PDF) collapse to ONE entry — the
 * first capture in unit order (URL-sorted upstream, so deterministic) —
 * with the rest carried as `{url, title}` aliases. Content addressing
 * is the ONLY collapse key (P4/P9): no semantic or near-duplicate
 * dedup, no independence judgment — N captures of one artifact must
 * not read as N sources, and two artifacts must never merge on a guess.
 *
 * @param {Array} members  buildMemberUnits output
 * @returns {Map<string, {member: object, aliases: Array<{url,title}>}>}
 */
export function foldMemberAliases(members) {
    const byHash = new Map();
    for (const m of members || []) {
        if (!m || !m.article_hash) continue;
        const existing = byHash.get(m.article_hash);
        if (existing) existing.aliases.push({ url: m.url || null, title: m.title || null });
        else byHash.set(m.article_hash, { member: m, aliases: [] });
    }
    return byHash;
}

/**
 * The appendix's entity index: the tagged CANONICAL people and
 * organizations, each with the number of claims that concern it and the
 * member sources it appears in.
 *
 * Counting folds the alias family — a claim's `about` id and a source's
 * tagged entity are both resolved to their canonical id via
 * `canonicalIdOf` before bucketing, so an alias and its canonical are one
 * entry. Every bucket key is therefore ALREADY canonical, so the only
 * gate is "a real, typed person/organization record" (`!e` drops ids with
 * no record; cases/things/places are omitted). Deliberately does NOT
 * re-test `e.canonical_id`: a DANGLING alias (canonical_id pointing at a
 * missing entity) resolves to ITSELF as canonical — its raw canonical_id
 * is truthy even though it is the family's resolved root, so testing it
 * would silently drop that entity's already-folded counts.
 *
 * `memberByHash[hash].entities` must already be canonical {id,name,type}
 * (the caller resolves them). Pure over the claim + entity registries.
 *
 * @param {object} data          { claimsById, entitiesById }
 * @param {object} memberByHash  article_hash → { entities:[{id,name,type}] }
 * @returns {{ people: Array<{name,claimCount,sourceHashes}>, orgs: Array }}
 */
export function computeEntitySummary(data, memberByHash) {
    const entitiesById = (data && data.entitiesById) || {};
    const claimsById = (data && data.claimsById) || {};
    const canonOf = (id) => canonicalIdOf(id, entitiesById);

    // claims concerning each canonical entity (dedupe per claim, so a
    // claim about both an alias and its canonical counts once).
    const claimCount = new Map();
    for (const c of Object.values(claimsById)) {
        const seen = new Set();
        for (const id of (c && c.about) || []) {
            const cid = canonOf(id);
            if (seen.has(cid)) continue;
            seen.add(cid);
            claimCount.set(cid, (claimCount.get(cid) || 0) + 1);
        }
    }

    // member sources tagged with each canonical entity. The source ids
    // are canonicalized here too (not just trusted from the caller), so
    // alias folding holds regardless — a source tagged with both an alias
    // and its canonical dedupes to one hash under the canonical.
    const srcHashes = new Map();
    for (const [hash, m] of Object.entries(memberByHash || {})) {
        for (const e of (m && m.entities) || []) {
            if (!e || !e.id) continue;
            const cid = canonOf(e.id);
            if (!srcHashes.has(cid)) srcHashes.set(cid, new Set());
            srcHashes.get(cid).add(hash);
        }
    }

    const people = [];
    const orgs = [];
    for (const id of new Set([...claimCount.keys(), ...srcHashes.keys()])) {
        const e = entitiesById[id];
        if (!e) continue;                                    // no record → can't type it
        const row = {
            name: e.name || '(unnamed)',
            claimCount: claimCount.get(id) || 0,
            sourceHashes: [...(srcHashes.get(id) || [])]
        };
        if (row.claimCount === 0 && row.sourceHashes.length === 0) continue;
        if (e.type === 'person') people.push(row);
        else if (e.type === 'organization') orgs.push(row);  // cases/things/places omitted
    }
    const byWeight = (a, b) => (b.claimCount - a.claimCount)
        || (b.sourceHashes.length - a.sourceHashes.length)
        || a.name.localeCompare(b.name);
    people.sort(byWeight);
    orgs.sort(byWeight);
    return { people, orgs };
}

/**
 * Cache key for ONE member's map-stage extract: a SHA-256 over the exact
 * inputs the map call consumes, so a cached extract is reused only when
 * re-running would produce the same output. Any change to the sent text,
 * the article's claim digest, the case framing, or the prompt version
 * yields a new key — which is precisely the invalidation we want (a
 * body edit changes `memberText`; a Suggest pass changes `claimsDigest`;
 * a prompt bump changes the version). Pure; mirrors the map request the
 * runner sends (member_id is derived from the text, so it is omitted).
 *
 * Keyed on MAP_PROMPT_VERSION, NOT the overall corpus version: a
 * reduce-side change (prompt or digest selection) must not orphan the
 * expensive map cache. Only a change to the MAP prompt bumps this.
 *
 * @param {object} request  { memberText, claimsDigest, caseName, scopeQuestion, memberMeta:{title,url} }
 * @param {string} [promptVersion]
 * @returns {Promise<string>} 64-char hex
 */
export async function corpusExtractKey(request, promptVersion = MAP_PROMPT_VERSION) {
    const r = request || {};
    const mm = r.memberMeta || {};
    return Crypto.sha256(JSON.stringify({
        v: promptVersion,
        text: r.memberText || '',
        claims: r.claimsDigest || '',
        caseName: r.caseName || '',
        scope: r.scopeQuestion || '',
        title: mm.title || '',
        url: mm.url || ''
    }));
}

/**
 * Content hash over the corpus INPUT — order-insensitive, so it
 * invalidates a stored brief exactly when membership, member text (the
 * hash changes), the orbit claim set, or the prompt version changes.
 */
export async function corpusInputHash(members, orbitClaimIds, promptVersion = CORPUS_PROMPT_VERSION) {
    const m = [...members.map((u) => u.article_hash)].sort();
    const c = [...(orbitClaimIds || [])].sort();
    return await Crypto.sha256(JSON.stringify({ v: promptVersion, m, c }));
}

// ------------------------------------------------------------------
// Dossier digest — the compact deterministic reduce input
// ------------------------------------------------------------------

/**
 * A compact, deterministic view of the built dossier for the reduce
 * call: the verdict-state distribution + coverage, contradiction knots
 * (claim ids + texts + notes), and — load-bearing for the proposals —
 * a `claims` INDEX the model may reference. `claims` is the SAME set
 * `filterProposals`/`claimsById` accept (passed in by the caller), so
 * an id the model pulls from here always validates. Without it the
 * reduce prompt's "reference claim ids only from the dossier" rule was
 * unfulfillable and every relationship/is_key proposal was rejected
 * (20.6). Size-capped; counts stay on the face so the model (and the
 * reader) see coverage.
 */
// The digest's claim-index cap — exported so callers that must keep
// their validation/grounding set identical to the digest set (the 20.6
// discipline) can cap the SAME list, and so spend-confirms can state
// what is actually sent.
export const DIGEST_CLAIM_CAP = 150;

/**
 * Choose which claims populate the reduce's claim index when the corpus
 * exceeds the cap. Naive first-N clusters in a few claim-dense articles —
 * with all member claims attached, 150 slots fill from ~13 articles and
 * the rest of the corpus never reaches the reduce, starving cross-article
 * proposals and claim-anchored cruxes. Instead: keep EVERY is_key claim,
 * then round-robin one-per-article so every article is represented within
 * the budget. Per-article order is preserved (key-first upstream). Object
 * identity dedups across the two passes.
 */
export function selectDigestClaims(claims, cap = DIGEST_CLAIM_CAP) {
    if (!Array.isArray(claims) || claims.length <= cap) return claims || [];
    const out = [];
    const taken = new Set();
    for (const c of claims) {                 // all key claims first (bounded by cap)
        if (out.length >= cap) break;
        if (c && c.is_key) { out.push(c); taken.add(c); }
    }
    const byArticle = new Map();              // the rest, grouped by article, order kept
    for (const c of claims) {
        if (!c || taken.has(c)) continue;
        const h = c.article_hash || '';
        if (!byArticle.has(h)) byArticle.set(h, []);
        byArticle.get(h).push(c);
    }
    const queues = [...byArticle.values()];
    let i = 0;
    while (out.length < cap && queues.some((q) => q.length)) {
        const q = queues[i % queues.length];
        if (q.length) out.push(q.shift());
        i++;
    }
    return out.slice(0, cap);
}

export function digestDossier(dossier, { claims = [] } = {}) {
    const shape = dossier.shape_of_knowledge || {};
    const knots = dossier.knots || {};
    // Claims carry a short per-article key (`art: 'A1'`) instead of a
    // 64-hex hash (27 S.1): cross-ARTICLE relationship proposals need
    // the model to see which claims come from different articles, and
    // the short key makes pairs identifiable at a glance (and shrinks
    // the digest). `articles` maps the keys back to hashes. Selection is
    // representative (is_key + round-robin per article), not first-N, so
    // the index spans the whole corpus, not its densest few articles.
    const capped = selectDigestClaims(claims, DIGEST_CLAIM_CAP);
    const artKeyByHash = new Map();
    for (const c of capped) {
        const h = c.article_hash || null;
        if (h && !artKeyByHash.has(h)) artKeyByHash.set(h, `A${artKeyByHash.size + 1}`);
    }
    const claimIndex = capped.map((c) => ({
        id: c.id,
        text: (c.text || '').slice(0, 160),
        art: c.article_hash ? artKeyByHash.get(c.article_hash) : null
    }));
    const articleKeys = {};
    for (const [hash, key] of artKeyByHash) articleKeys[key] = hash;
    return JSON.stringify({
        coverage: dossier.coverage || {},
        distribution: (shape.distribution && {
            by_state: shape.distribution.by_state,
            unadjudicated: shape.distribution.unadjudicated,
            total: shape.distribution.total
        }) || null,
        contradictions: (knots.contradictions || []).slice(0, 30).map((k) => ({
            size: k.size,
            nodes: (k.nodes || []).map((n) => ({ ref: n.ref, text: (n.text || '').slice(0, 200) })),
            notes: (k.edges || []).map((e) => e.note).filter(Boolean)
        })),
        claims: claimIndex,
        articles: articleKeys,
        claim_count: claimIndex.length
    });
}

// ------------------------------------------------------------------
// Validators (schema-walker)
// ------------------------------------------------------------------

const MAP_SCHEMA = obj({
    position: obj({ summary: str(), side_label: nullableStr() }),
    key_assertions: arr(obj({ quote: str({ minLength: 1 }), claim_ref: nullableStr(), why_load_bearing: str() }, ['quote'])),
    source_references: arr(obj({ quote: str({ minLength: 1 }), target_hint: str() }, ['quote'])),
    open_questions: arr(str())
}, ['position']);

const BRIEF_SCHEMA = obj({
    summary: str(),
    positions: arr(obj({ label: str(), core_argument: str(), holders: arr(obj({ article_hash: str() }, ['article_hash'])) }, ['label'])),
    cruxes: arr(obj({
        question: str(),
        sides: arr(obj({ position_label: str(), view: str() }, ['view'])),
        evidence_refs: arr(obj({ article_hash: str(), quote: str({ minLength: 1 }) }, ['article_hash', 'quote'])),
        what_would_resolve: str()
    }, ['question'])),
    load_bearing: arr(obj({ claim_ref: nullableStr(), article_hash: str(), quote: str({ minLength: 1 }), why: str() }, ['article_hash', 'quote'])),
    coverage_gaps: arr(str()),
    proposals: arr(obj({
        kind: en(['relationship', 'is_key', 'claim']),
        source_claim_id: str(), target_claim_id: str(), relationship: en([...CLAIM_RELATIONSHIPS]),
        claim_id: str(), article_hash: str(), text: str(), quote: str(), note: str()
    }, ['kind']))
}, ['summary']);

export function validateCorpusExtract(input) {
    const errors = [];
    walk(input, MAP_SCHEMA, '$', errors);
    return { ok: errors.length === 0, errors };
}

export function validateCaseBrief(input) {
    const errors = [];
    walk(input, BRIEF_SCHEMA, '$', errors);
    return { ok: errors.length === 0, errors };
}

// ------------------------------------------------------------------
// Grounding — every brief quote must be verbatim in its named member
// ------------------------------------------------------------------

/**
 * Ground every `{article_hash, quote}` pair in the brief against THAT
 * member's text. Ungrounded quotes drop their containing entry
 * (evidence_ref / load_bearing / claim proposal). Returns the pruned
 * brief plus `{checked, dropped}` counts (disclosed in the UI + store).
 * `indexByMember` maps article_hash → grounding index (built by the
 * caller from the same unit texts the map stage used).
 */
export function groundCaseBrief(brief, indexByMember) {
    let checked = 0;
    let dropped = 0;
    const groundOne = (article_hash, quote) => {
        checked++;
        const idx = indexByMember[article_hash];
        if (!idx) { dropped++; return null; }
        const res = idx.ground(quote);
        if (!res || res.status === 'missing') { dropped++; return null; }
        return res.exact;   // the member's own span, not the model's copy
    };

    const out = { ...brief };
    out.cruxes = (brief.cruxes || []).map((crux) => ({
        ...crux,
        evidence_refs: (crux.evidence_refs || []).map((ev) => {
            const exact = groundOne(ev.article_hash, ev.quote);
            return exact === null ? null : { ...ev, quote: exact };
        }).filter(Boolean)
    }));
    out.load_bearing = (brief.load_bearing || []).map((lb) => {
        const exact = groundOne(lb.article_hash, lb.quote);
        return exact === null ? null : { ...lb, quote: exact };
    }).filter(Boolean);
    out.proposals = (brief.proposals || []).map((p) => {
        if (p.kind !== 'claim') return p;
        const exact = groundOne(p.article_hash, p.quote || '');
        return exact === null ? null : { ...p, quote: exact };
    }).filter(Boolean);

    return { brief: out, checked, dropped };
}

// ------------------------------------------------------------------
// Proposal filtering — real, resolvable references only
// ------------------------------------------------------------------

/**
 * Stable identity for one proposal — the dedup key inside
 * filterProposals AND (27 S.3) the key the per-brief triage record
 * (`record.triage[key] = 'accepted' | 'dismissed'`) is stored under,
 * so a reopened brief doesn't resurrect already-triaged rows.
 */
export function proposalKey(p) {
    if (p.kind === 'relationship') return `rel:${[p.source_claim_id, p.target_claim_id].sort().join('|')}:${p.relationship}`;
    if (p.kind === 'is_key') return `key:${p.claim_id}`;
    if (p.kind === 'claim') return `claim:${p.article_hash}|${p.text}`;
    return `other:${JSON.stringify(p)}`;
}

/**
 * Split a grounded brief's proposals into `{acceptable, rejected}`.
 * A relationship needs two EXISTING claim ids and a valid enum; is_key
 * needs an existing claim id; claim needs a real member and (already
 * grounded) quote. Rejected rows carry a human reason.
 */
export function filterProposals(brief, { claimsById = {}, memberHashes = new Set() } = {}) {
    const acceptable = [];
    const rejected = [];
    const seen = new Set();   // dedup key across all kinds
    for (const p of (brief.proposals || [])) {
        const dk = proposalKey(p);
        if (seen.has(dk)) continue;   // silent dedup — a repeat is not a reject
        seen.add(dk);

        let reason = null;
        if (p.kind === 'relationship') {
            if (!claimsById[p.source_claim_id]) reason = `unknown source claim ${p.source_claim_id}`;
            else if (!claimsById[p.target_claim_id]) reason = `unknown target claim ${p.target_claim_id}`;
            else if (p.source_claim_id === p.target_claim_id) reason = 'source and target are the same claim';
            else if (!CLAIM_RELATIONSHIPS.includes(p.relationship)) reason = `invalid relationship "${p.relationship}"`;
        } else if (p.kind === 'is_key') {
            if (!claimsById[p.claim_id]) reason = `unknown claim ${p.claim_id}`;
        } else if (p.kind === 'claim') {
            if (!p.article_hash || !memberHashes.has(p.article_hash)) reason = `claim not tied to a member article`;
            else if (!p.text || !p.quote) reason = `claim missing text or grounded quote`;
        } else {
            reason = `unknown proposal kind "${p.kind}"`;
        }
        if (reason) rejected.push({ ...p, reason });
        else acceptable.push(p);
    }
    return { acceptable, rejected };
}

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
import { EventBuilder } from './event-builder.js';
import { createGroundingIndex } from './quote-grounding.js';
import { CLAIM_RELATIONSHIPS } from './assessment-taxonomy.js';
import { walk, obj, str, nullableStr, arr, en } from './schema-walker.js';
import { deriveArticleRows } from './case-dossier.js';
import { MAX_MEMBER_INPUT_CHARS, CORPUS_PROMPT_VERSION } from './corpus-prompts.js';

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
 */
export async function buildMemberUnits(data, { assessmentsByClaim = {} } = {}) {
    const { rows } = deriveArticleRows(data);
    const recByUrl = new Map();
    for (const rec of data.articles || []) {
        if (rec && rec.url) recByUrl.set(rec.url, rec);
    }
    const units = [];
    for (const row of rows) {
        const rec = recByUrl.get(row.url) || null;
        if (!rec || !rec.article) continue;   // only archive-backed members feed the corpus
        const full = EventBuilder.assembleArticleBody(rec.article) || '';
        const text = full.slice(0, MAX_MEMBER_INPUT_CHARS);
        const id = rec.articleHash || (`url:${await sha16(row.url)}`);
        units.push({
            article_hash: id,
            url: row.url,
            title: row.title || null,
            text,
            truncated: full.length > MAX_MEMBER_INPUT_CHARS,
            total_chars: full.length,
            claims: (row.claims || []).map((c) => ({
                id: c.id, text: c.text, quote: c.quote || null, is_key: !!c.is_key,
                stance: (c.id in assessmentsByClaim) ? assessmentsByClaim[c.id] : null
            }))
        });
    }
    return units;
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
 * (claim ids + texts + notes), and an orbit-claim index. Size-capped;
 * counts stay on the face so the model (and the reader) see coverage.
 */
export function digestDossier(dossier) {
    const shape = dossier.shape_of_knowledge || {};
    const knots = dossier.knots || {};
    const claimIndex = (dossier.orbit && dossier.orbit.claim_ids || []).slice(0, 200);
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
 * Split a grounded brief's proposals into `{acceptable, rejected}`.
 * A relationship needs two EXISTING claim ids and a valid enum; is_key
 * needs an existing claim id; claim needs a real member and (already
 * grounded) quote. Rejected rows carry a human reason.
 */
export function filterProposals(brief, { claimsById = {}, memberHashes = new Set() } = {}) {
    const acceptable = [];
    const rejected = [];
    for (const p of (brief.proposals || [])) {
        let reason = null;
        if (p.kind === 'relationship') {
            if (!claimsById[p.source_claim_id]) reason = `unknown source claim ${p.source_claim_id}`;
            else if (!claimsById[p.target_claim_id]) reason = `unknown target claim ${p.target_claim_id}`;
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

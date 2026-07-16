// Hypothesis-edge suggestion firewall — Phase 26 H.4
// (docs/HYPOTHESIS_MAP_DESIGN.md §3). The pure validate → ground →
// filter pipeline between the raw LLM tool output and the human-accept
// UI, mirroring case-synthesis.js's brief pipeline:
//
//   1. validateHypothesisEdges — the §7-style schema contract over the
//      raw tool input (schema-walker).
//   2. groundEdgeQuotes — every edge's quote must locate VERBATIM
//      (exact or normalized; fuzzy counts) inside the REFERENCED
//      CLAIM's own text+quote. An ungrounded quote drops the whole
//      edge; drop count disclosed.
//   3. filterEdgeProposals — every id must resolve: hypothesis_id to
//      the supplied hypothesis list (persisted rows or brief seeds),
//      claim_ref to the digest's claim set; role in the enum; dups vs
//      the batch are silent, dups vs an existing edge are rejected
//      with a reason.
//   4. unopposedHypotheses — the both-sides post-check: hypotheses the
//      pass left with zero undermining scrutiny (proposed or existing)
//      are DISCLOSED, never silently passed over.
//
// Pure: no chrome, no network, no DOM, no clock. Nothing here applies
// an edge — the human-accept firewall lives in the portal block, and
// accepted records are stamped `suggested_by: 'llm:<model>'`.

import { walk, obj, str, arr, en } from './schema-walker.js';
import { createGroundingIndex } from './quote-grounding.js';
import { HYPOTHESIS_EDGE_ROLES } from './hypothesis-model.js';

const EDGES_SCHEMA = obj({
    edges: arr(obj({
        hypothesis_id: str({ minLength: 1 }),
        claim_ref:     str({ minLength: 1 }),
        role:          en([...HYPOTHESIS_EDGE_ROLES]),
        quote:         str({ minLength: 1 }),
        why:           str()
    }, ['hypothesis_id', 'claim_ref', 'role', 'quote']))
}, ['edges']);

export function validateHypothesisEdges(input) {
    const errors = [];
    walk(input, EDGES_SCHEMA, '$', errors);
    return { ok: errors.length === 0, errors };
}

/**
 * Ground each edge's quote against the referenced claim's own verbatim
 * record — its text OR its extraction quote, indexed SEPARATELY: a
 * single concatenated index would let a span straddle the text/quote
 * boundary and persist a stitched "verbatim" quote that appears in
 * neither field. The surviving edge carries the claim's own span, not
 * the model's copy. Unknown claim_ref grounds nothing here — the
 * filter rejects it with a reason; it is not counted as a quote drop.
 */
export function groundEdgeQuotes(edges, claimsById = {}) {
    let checked = 0;
    let dropped = 0;
    const indexByClaim = new Map();
    const out = [];
    for (const e of edges || []) {
        const claim = claimsById[e.claim_ref];
        if (!claim) { out.push(e); continue; }   // filter's job
        checked++;
        if (!indexByClaim.has(e.claim_ref)) {
            indexByClaim.set(e.claim_ref, [claim.text, claim.quote]
                .filter((s) => s && String(s).trim())
                .map((s) => createGroundingIndex(String(s))));
        }
        let exact = null;
        for (const idx of indexByClaim.get(e.claim_ref)) {
            const res = idx.ground(e.quote);
            if (res && res.status !== 'missing') { exact = res.exact; break; }
        }
        if (exact === null) { dropped++; continue; }
        out.push({ ...e, quote: exact });
    }
    return { edges: out, checked, dropped };
}

/**
 * Split grounded edge proposals into `{acceptable, rejected}`.
 * `hypotheses` is the map's row list (persisted records AND brief
 * seeds — a seed is promoted at accept time); `claimsById` is the SAME
 * claim set the digest was built from (the 20.6 discipline); an
 * `existingEdges` entry is `{hypothesis_id, ref, role}`.
 */
export function filterEdgeProposals(edges, { hypotheses = [], claimsById = {}, existingEdges = [] } = {}) {
    const hypIds = new Set(hypotheses.map((h) => h.id));
    const existing = new Set(existingEdges.map((e) => `${e.hypothesis_id}|${e.ref}|${e.role}`));
    const seen = new Set();
    const acceptable = [];
    const rejected = [];
    for (const e of edges || []) {
        const dk = `${e.hypothesis_id}|${e.claim_ref}|${e.role}`;
        if (seen.has(dk)) continue;   // silent dedup — a repeat is not a reject
        seen.add(dk);

        let reason = null;
        if (!hypIds.has(e.hypothesis_id)) reason = `unknown hypothesis ${e.hypothesis_id}`;
        else if (!claimsById[e.claim_ref]) reason = `unknown claim ${e.claim_ref}`;
        else if (!HYPOTHESIS_EDGE_ROLES.includes(e.role)) reason = `invalid role "${e.role}"`;
        else if (existing.has(dk)) reason = 'already attached';
        if (reason) rejected.push({ ...e, reason });
        else acceptable.push(e);
    }
    return { acceptable, rejected };
}

/**
 * The both-sides post-check (design §3.4): hypotheses this pass leaves
 * with NO undermining scrutiny — neither a surviving proposal nor an
 * existing undermines edge. Returned for disclosure ("its support is
 * unexamined, not established"), never for auto-retry or scoring.
 */
export function unopposedHypotheses(hypotheses, acceptable = [], existingEdges = []) {
    const opposed = new Set();
    for (const e of acceptable) if (e.role === 'undermines') opposed.add(e.hypothesis_id);
    for (const e of existingEdges) if (e.role === 'undermines') opposed.add(e.hypothesis_id);
    return hypotheses.filter((h) => !opposed.has(h.id)).map((h) => ({ id: h.id, label: h.label }));
}

// LLM-assist proposal layer — Phase 14.5
// (docs/PHASE_14_5_LLM_ASSIST_KICKOFF.md).
//
// PURE module (no network, no chrome, no DOM). It sits between the raw
// tool output of llm-client and the existing capture models:
//
//   1. normalizeProposals() — group the model's flat proposal list into
//      dependency-ordered buckets, each item stamped with a stable pid.
//   2. validateProposal()   — the pre-display firewall. It MIRRORS the
//      model validators using the SAME exported predicates
//      (isValidManeuver / isValidRole / isValidBasis / isValidLabel /
//      isValidStance / ENTITY_TYPES / CLAIM_RELATIONSHIPS / …) so a bad
//      proposal renders "rejected-with-reason" instead of being silently
//      dropped. The ULTIMATE firewall is still each model's create(),
//      which the reader calls at accept time. When ctx carries a
//      grounding index it ALSO enforces the provenance discipline: a
//      claim's quote and every finding anchor must locate in the
//      article (quote-grounding.js) or the proposal is invalid.
//   3. resolveQuoteToSelectors() — turn a quote into a W3C selector
//      array against the article body. The model's quote is only a
//      SEARCH KEY: on any match the selectors are rebuilt from the
//      article's own characters (TextQuoteSelector with real
//      prefix/suffix + TextPositionSelector with raw offsets), so an
//      accepted anchor can never carry text the article doesn't
//      contain.
//   4. build*Input() — map a proposal onto the exact create() input for
//      its model, given the accept-time ref→id maps.
//
// Findings keep the no-verdict discipline by construction: there is no
// intent/score field in the schema or the mapping, a counter_note is
// required, and at least one anchor must carry a non-empty quote.

import { buildSelectors } from './metadata/anchor-capture.js';
import { createGroundingIndex, isGroundingIndex } from './quote-grounding.js';
import { ENTITY_TYPES, canonicalIdOf } from './entity-model.js';
import {
    isValidLabel, isValidStance, isValidSuggestedBy,
    CLAIM_RELATIONSHIPS, REVISION_RELATIONSHIPS
} from './assessment-taxonomy.js';
import {
    isValidManeuver, isValidRole, isValidBasis, BASIS_VALUES
} from './forensic-taxonomy.js';

// Dependency order: a kind is only ever accepted after the kinds it can
// reference. Entities → claims → (assessments / relationships / revisions)
// → findings → baselines.
export const PROPOSAL_ORDER = Object.freeze([
    'entity', 'claim', 'assessment', 'relationship', 'revision', 'finding', 'baseline'
]);

const PREFIX_SUFFIX = 40; // buildSelectors trims to 32; give it headroom.

// ------------------------------------------------------------------
// Quote → anchor
// ------------------------------------------------------------------

// Accept either the article text or a prebuilt grounding index (the
// review panel builds ONE index and reuses it across every proposal).
function toGroundingIndex(groundingOrText) {
    return isGroundingIndex(groundingOrText)
        ? groundingOrText
        : createGroundingIndex(String(groundingOrText || ''));
}

/**
 * Resolve a quote to a W3C selector array against the article body
 * text. The quote is a search key (exact → typography-normalized →
 * guarded fuzzy, see quote-grounding.js); on any match the selectors
 * are built from the ARTICLE'S OWN text at the matched span — a
 * prefix+exact+suffix TextQuoteSelector plus a TextPositionSelector
 * carrying the raw offsets. A miss yields a quote-only selector
 * (found: false) so legacy callers keep their shape, but the
 * suggest-flow validator treats it as unacceptable. Pure.
 *
 * @param {string} quote
 * @param {string|object} articleText  raw text, or a grounding index
 * @returns {{selectors: Array<object>, found: boolean, method: string,
 *            score: number, exact: string}}
 */
export function resolveQuoteToSelectors(quote, articleText) {
    const exact = String(quote || '').trim();
    if (!exact) return { selectors: [], found: false };
    const index = toGroundingIndex(articleText);
    const g = index.ground(exact);
    if (g.status === 'missing') {
        return {
            selectors: buildSelectors({ exact }).selectors,
            found: false, method: 'missing', score: 0, exact
        };
    }
    const text = index.text;
    const prefix = text.slice(Math.max(0, g.start - PREFIX_SUFFIX), g.start);
    const suffix = text.slice(g.end, g.end + PREFIX_SUFFIX);
    const { selectors } = buildSelectors({ exact: g.exact, prefix, suffix });
    selectors.push({ type: 'TextPositionSelector', start: g.start, end: g.end });
    return { selectors, found: true, method: g.status, score: g.score, exact: g.exact };
}

// ------------------------------------------------------------------
// Normalization
// ------------------------------------------------------------------

/**
 * Group the raw proposal list into dependency-ordered buckets. Each
 * item keeps its raw fields plus a stable `pid` (p0, p1, …) and `ref`
 * (the model's local key, if any). Unknown kinds are dropped.
 *
 * @param {Array<object>} raw
 * @returns {{ byKind: Record<string, Array<object>>, all: Array<object>,
 *             entityRefs: Set<string>, claimRefs: Set<string>,
 *             entityLabelByRef: Record<string,string> }}
 */
export function normalizeProposals(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const byKind = {};
    for (const k of PROPOSAL_ORDER) byKind[k] = [];
    const all = [];
    const entityRefs = new Set();
    const claimRefs = new Set();
    const entityLabelByRef = {};

    list.forEach((p, i) => {
        if (!p || typeof p !== 'object') return;
        const kind = String(p.kind || '').trim();
        if (!PROPOSAL_ORDER.includes(kind)) return;
        const item = { ...p, kind, pid: `p${i}`, ref: p.ref ? String(p.ref) : '' };
        byKind[kind].push(item);
        all.push(item);
        if (kind === 'entity' && item.ref) {
            entityRefs.add(item.ref);
            entityLabelByRef[item.ref] = String(p.name || '').trim();
        }
        if (kind === 'claim' && item.ref) claimRefs.add(item.ref);
    });

    return { byKind, all, entityRefs, claimRefs, entityLabelByRef };
}

// ------------------------------------------------------------------
// Validation firewall (mirrors the model validators)
// ------------------------------------------------------------------

function fail(reason) { return { ok: false, reason }; }
const OK = { ok: true };

/** Subject label a finding/baseline answers to (proposal-time). */
export function subjectLabelOf(prop, ctx = {}) {
    const byRef = ctx.entityLabelByRef || {};
    return String(
        prop.subject_label || (prop.subject_ref && byRef[prop.subject_ref]) || prop.subject_ref || ''
    ).trim();
}

/**
 * Validate a normalized proposal. `ctx` carries the sets of known
 * entity/claim refs (for dependency checks), entityLabelByRef, and —
 * in the suggest flow — `grounding` (a quote-grounding index), which
 * arms the provenance firewall: a claim's quote and every finding
 * anchor must locate in the article or the proposal is invalid.
 *
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function validateProposal(prop, ctx = {}) {
    if (!prop || typeof prop !== 'object') return fail('Empty proposal');
    const claimRefs = ctx.claimRefs || new Set();
    switch (prop.kind) {
        case 'entity': {
            if (!String(prop.name || '').trim()) return fail('Entity needs a name');
            if (!ENTITY_TYPES.includes(prop.entity_type)) {
                return fail(`Entity type must be one of: ${ENTITY_TYPES.join(', ')}`);
            }
            if (ctx.grounding) {
                // The mention is the entity's provenance in THIS article —
                // the display name may disambiguate, the mention may not.
                const mention = String(prop.mention || '').trim();
                if (!mention) return fail('Entity needs a verbatim mention from the article');
                if (ctx.grounding.ground(mention).status === 'missing') {
                    return fail('Mention not found in the article — edit it to match the text exactly');
                }
            }
            return OK;
        }
        case 'claim': {
            if (!String(prop.text || '').trim()) return fail('Claim needs text');
            if (String(prop.text).trim().length > 2000) return fail('Claim text too long (max 2000)');
            if (ctx.grounding) {
                const quote = String(prop.quote || '').trim();
                if (!quote) return fail('Claim needs a verbatim quote from the article');
                if (ctx.grounding.ground(quote).status === 'missing') {
                    return fail('Quote not found in the article — edit it to match the text exactly');
                }
            }
            return OK;
        }
        case 'assessment': {
            if (!claimRefs.has(prop.claim_ref)) return fail('Assessment references an unknown claim');
            const stance = prop.stance === undefined ? null : prop.stance;
            if (stance !== null && !isValidStance(stance)) return fail('Stance must be an integer -2..2 or null');
            const labels = Array.isArray(prop.labels) ? prop.labels : [];
            for (const l of labels) {
                if (!isValidLabel(l && l.label)) return fail(`Invalid label: ${l && l.label}`);
            }
            if (stance === null && labels.length === 0) return fail('Assessment needs a stance or at least one label');
            return OK;
        }
        case 'relationship': {
            if (!CLAIM_RELATIONSHIPS.includes(prop.relationship)) {
                return fail(`Relationship must be one of: ${CLAIM_RELATIONSHIPS.join(', ')}`);
            }
            return validateLink(prop, claimRefs);
        }
        case 'revision': {
            if (!REVISION_RELATIONSHIPS.includes(prop.relationship)) {
                return fail(`Revision must be one of: ${REVISION_RELATIONSHIPS.join(', ')}`);
            }
            return validateLink(prop, claimRefs);
        }
        case 'finding': {
            if (!subjectLabelOf(prop, ctx)) return fail('Finding needs a subject');
            if (!isValidRole(prop.role)) return fail(`Role must be one of: apologist, critic, institution, witness, survivor, other`);
            if (!isValidManeuver(prop.maneuver)) return fail(`Invalid maneuver: ${prop.maneuver}`);
            const basis = prop.basis || 'structural-inference';
            if (!isValidBasis(basis)) return fail(`Basis must be one of: ${BASIS_VALUES.join(', ')}`);
            const anchors = Array.isArray(prop.anchors) ? prop.anchors : [];
            const quoted = anchors.filter((a) => a && String(a.quote || '').trim());
            if (quoted.length === 0) return fail('Finding needs at least one evidence anchor with a verbatim quote');
            if (ctx.grounding) {
                // Evidence quotes ARE the finding's provenance — every
                // one must locate in the article.
                for (const a of quoted) {
                    if (ctx.grounding.ground(String(a.quote).trim()).status === 'missing') {
                        return fail('Evidence quote not found in the article — edit it to match the text exactly');
                    }
                }
            }
            // Rule 6 — the falsifiability discipline.
            if (!String(prop.counter_note || '').trim()) {
                return fail('Finding needs a counter-note (the alternative reading)');
            }
            return OK;
        }
        case 'baseline': {
            if (!subjectLabelOf(prop, ctx)) return fail('Baseline needs a subject');
            if (!String(prop.note || '').trim()) return fail('Baseline needs a descriptive note');
            return OK;
        }
        default:
            return fail(`Unknown kind: ${prop.kind}`);
    }
}

function validateLink(prop, claimRefs) {
    if (!claimRefs.has(prop.source_claim_ref)) return fail('Source claim is unknown');
    if (!claimRefs.has(prop.target_claim_ref)) return fail('Target claim is unknown');
    if (prop.source_claim_ref === prop.target_claim_ref) return fail('A link needs two different claims');
    return OK;
}

// ------------------------------------------------------------------
// Mapping → model create() inputs
//
// Each builder is pure: it takes the proposal plus the accept-time
// resolver maps and returns the exact object the model's create()
// expects. The reader calls the real model with the result.
// ------------------------------------------------------------------

// Ground a quote and return its anchor bundle, or null when the quote
// does not locate. A miss stores NO anchor — an anchor whose text the
// article doesn't contain is fabricated provenance, and the suggest
// flow's validator blocks the artifacts (claims, findings) that
// require one.
function groundedAnchor(quote, groundingOrText) {
    const q = String(quote || '').trim();
    if (!q) return null;
    const r = resolveQuoteToSelectors(q, groundingOrText);
    return r.found ? r : null;
}

export function buildEntityInput(prop, { suggestedBy = 'user' } = {}) {
    return { name: String(prop.name || '').trim(), type: prop.entity_type, suggested_by: suggestedBy };
}

// ------------------------------------------------------------------
// Entity dedupe (accept-time)
// ------------------------------------------------------------------

export function nameTokens(name) {
    return new Set(
        String(name || '')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/)
            .filter(Boolean)
    );
}

/**
 * Registry candidates a proposed entity likely duplicates. Same type
 * only; a candidate's name must token-equal the proposal or fully
 * contain / be contained by it ("Mayor Elena Vargas" ↔ "Elena
 * Vargas") — the disambiguation-word drift that mints duplicate ids.
 * Deliberately deterministic and conservative: the human picks from
 * the offered candidates, and the (designed) LLM entity audit handles
 * retroactive cleanup. Pure.
 *
 * @param {string} name       proposed display name
 * @param {string} type       proposed entity type
 * @param {Array<object>} entities  registry rows ({id, name, type, …})
 * @returns {Array<object>}   up to 3 candidates, exact-name match first,
 *                            then shortest name first
 */
export function findEntityMatches(name, type, entities) {
    const q = nameTokens(name);
    if (q.size === 0) return [];
    const rows = Array.isArray(entities) ? entities : [];
    const byId = {};
    for (const e of rows) if (e && e.id) byId[e.id] = e;
    const scored = [];
    for (const e of rows) {
        if (!e || e.type !== type || !e.name) continue;
        const t = nameTokens(e.name);
        if (t.size === 0) continue;
        const qInT = [...q].every((x) => t.has(x));
        const tInQ = [...t].every((x) => q.has(x));
        if (!qInT && !tInQ) continue;
        // E3 (Phase 17A): a match on an ALIAS offers its canonical
        // record — new tags must attach to the root identity, not
        // re-silt the registry. Exactness is scored on the name that
        // actually MATCHED (the alias's), so a query equal to an
        // alias name still ranks its canonical as an exact hit.
        const rootId = canonicalIdOf(e.id, byId);
        const offered = byId[rootId] || e;
        scored.push({ entity: offered, matchedName: e.name, exact: qInT && tInQ });
    }
    scored.sort((a, b) =>
        (b.exact ? 1 : 0) - (a.exact ? 1 : 0)
        || String(a.matchedName).length - String(b.matchedName).length);
    // One entry per offered root, best-ranked occurrence wins.
    const seen = new Set();
    const out = [];
    for (const m of scored) {
        if (seen.has(m.entity.id)) continue;
        seen.add(m.entity.id);
        out.push(m.entity);
        if (out.length === 3) break;
    }
    return out;
}

export function buildClaimInput(prop, { entityIdByRef = {}, articleText = '', sourceUrl = '', articleHash = '', suggestedBy = 'user' } = {}) {
    const about = (Array.isArray(prop.about) ? prop.about : [])
        .map((ref) => entityIdByRef[ref])
        .filter(Boolean);
    const g = groundedAnchor(prop.quote, articleText);
    return {
        text:         String(prop.text || '').trim(),
        source_url:   sourceUrl,
        // First-class text provenance: the grounded article span itself
        // (never the model's rendition) + the article version it was
        // located in.
        quote:        g ? g.exact : null,
        article_hash: articleHash || null,
        anchor:       g ? g.selectors : null,
        // Local-only provenance of the anchor itself: how the quote was
        // located, and — when the stored span was repaired — the quote
        // text it was located FROM. Deliberately not "model_quote": a
        // user may have re-anchored the quote in review, and the
        // artifact-level suggested_by / edit flow records who.
        anchor_provenance: g ? {
            method: g.method,
            score:  g.score,
            ...(g.method !== 'exact' ? { proposed_quote: String(prop.quote || '').trim() } : {})
        } : null,
        about,
        is_key:       prop.is_key === true,
        suggested_by: suggestedBy
    };
}

export function buildAssessmentInput(prop, { claimIdByRef = {}, articleText = '', suggestedBy = 'user' } = {}) {
    const labels = (Array.isArray(prop.labels) ? prop.labels : []).map((l) => {
        const g = l && l.quote ? groundedAnchor(l.quote, articleText) : null;
        return {
            label:        l.label,
            anchor:       g ? g.selectors : null,
            suggested_by: suggestedBy
        };
    });
    return {
        claim_ref:    { claim_id: claimIdByRef[prop.claim_ref] },
        stance:       prop.stance === undefined ? null : prop.stance,
        labels,
        rationale:    String(prop.rationale || ''),
        suggested_by: suggestedBy
    };
}

export function buildLinkInput(prop, { claimIdByRef = {}, suggestedBy = 'user' } = {}) {
    return {
        source_claim_id: claimIdByRef[prop.source_claim_ref],
        target_claim_id: claimIdByRef[prop.target_claim_ref],
        relationship:    prop.relationship,
        note:            String(prop.note || ''),
        suggested_by:    suggestedBy
    };
}

export function buildFindingInput(prop, { articleText = '', sourceRef = {}, suggestedBy = 'user', subjectLabel = '' } = {}) {
    const label = subjectLabel || '';
    const anchors = (Array.isArray(prop.anchors) ? prop.anchors : [])
        .filter((a) => a && String(a.quote || '').trim())
        .map((a) => {
            const g = groundedAnchor(a.quote, articleText);
            return {
                // The stored quote is the ARTICLE'S text at the matched
                // span, not the model's rendition of it.
                quote:      g ? g.exact : String(a.quote).trim(),
                selector:   g ? g.selectors : null,
                source_ref: (sourceRef && sourceRef.url) ? { url: sourceRef.url, title: sourceRef.title || null } : null,
                step_note:  String(a.note || '')
            };
        });
    return {
        subject_ref:  { label },
        role:         prop.role,
        maneuver:     prop.maneuver,
        anchors,
        note:         String(prop.note || ''),
        counter_note: String(prop.counter_note || ''),
        basis:        prop.basis || 'structural-inference',
        suggested_by: suggestedBy
    };
}

export function buildBaselineInput(prop, { sourceRef = {}, subjectLabel = '' } = {}) {
    return {
        subject_ref: { label: subjectLabel || '' },
        note:        String(prop.note || ''),
        source_url:  (sourceRef && sourceRef.url) || ''
    };
}

/** Defensive helper used by the reader before stamping provenance. */
export function assertSuggestedBy(value) {
    return isValidSuggestedBy(value) ? value : 'user';
}

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
//      which the reader calls at accept time.
//   3. resolveQuoteToSelectors() — turn a verbatim quote into a W3C
//      TextQuoteSelector array against the article body, so accepted
//      claims/findings carry real anchors.
//   4. build*Input() — map a proposal onto the exact create() input for
//      its model, given the accept-time ref→id maps.
//
// Findings keep the no-verdict discipline by construction: there is no
// intent/score field in the schema or the mapping, a counter_note is
// required, and at least one anchor must carry a non-empty quote.

import { buildSelectors } from './metadata/anchor-capture.js';
import { ENTITY_TYPES } from './entity-model.js';
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

/**
 * Resolve a verbatim quote to a W3C selector array against the article
 * body text. Exact match yields a prefix+exact+suffix TextQuoteSelector;
 * a miss yields a quote-only selector (still resolvable when the exact
 * text is unique on the page). Pure.
 *
 * @param {string} quote
 * @param {string} articleText
 * @returns {{selectors: Array<object>, found: boolean}}
 */
export function resolveQuoteToSelectors(quote, articleText) {
    const exact = String(quote || '').trim();
    if (!exact) return { selectors: [], found: false };
    const text = String(articleText || '');
    const idx = text.indexOf(exact);
    if (idx < 0) {
        return { selectors: buildSelectors({ exact }).selectors, found: false };
    }
    const prefix = text.slice(Math.max(0, idx - PREFIX_SUFFIX), idx);
    const suffix = text.slice(idx + exact.length, idx + exact.length + PREFIX_SUFFIX);
    return { selectors: buildSelectors({ exact, prefix, suffix }).selectors, found: true };
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
 * entity/claim refs (for dependency checks) and entityLabelByRef.
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
            return OK;
        }
        case 'claim': {
            if (!String(prop.text || '').trim()) return fail('Claim needs text');
            if (String(prop.text).trim().length > 2000) return fail('Claim text too long (max 2000)');
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

function selectorsOrNull(quote, articleText) {
    const sels = resolveQuoteToSelectors(quote, articleText).selectors;
    return sels.length ? sels : null;
}

export function buildEntityInput(prop, { suggestedBy = 'user' } = {}) {
    return { name: String(prop.name || '').trim(), type: prop.entity_type, suggested_by: suggestedBy };
}

export function buildClaimInput(prop, { entityIdByRef = {}, articleText = '', sourceUrl = '', suggestedBy = 'user' } = {}) {
    const about = (Array.isArray(prop.about) ? prop.about : [])
        .map((ref) => entityIdByRef[ref])
        .filter(Boolean);
    return {
        text:         String(prop.text || '').trim(),
        source_url:   sourceUrl,
        anchor:       selectorsOrNull(prop.quote, articleText),
        about,
        is_key:       prop.is_key === true,
        suggested_by: suggestedBy
    };
}

export function buildAssessmentInput(prop, { claimIdByRef = {}, articleText = '', suggestedBy = 'user' } = {}) {
    const labels = (Array.isArray(prop.labels) ? prop.labels : []).map((l) => ({
        label:        l.label,
        anchor:       l && l.quote ? selectorsOrNull(l.quote, articleText) : null,
        suggested_by: suggestedBy
    }));
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
        .map((a) => ({
            quote:      String(a.quote).trim(),
            selector:   selectorsOrNull(a.quote, articleText),
            source_ref: (sourceRef && sourceRef.url) ? { url: sourceRef.url, title: sourceRef.title || null } : null,
            step_note:  String(a.note || '')
        }));
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

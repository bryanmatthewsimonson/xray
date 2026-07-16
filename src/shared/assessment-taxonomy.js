// Assessment taxonomy — Phase 11.1 (docs/ASSESSMENTS_DESIGN.md).
//
// Single source of truth for the assessment label vocabulary, the
// graded stance scale, and the claim-relationship directionality
// rules. Model validation, UI chips, the wire builders (slice 11.2),
// and the NIP draft all read from here — extending the vocabulary
// means editing this file (and the exhaustive-enum tests that pin it).

// NIP-32 namespace the labels publish under (`['L', <ns>]` +
// `['l', <label>, <ns>]` on kind 30054, mirrored to kind 1985).
export const ASSESSMENT_LABEL_NAMESPACE = 'xray/assessment';

/**
 * The standardized labels, grouped for the picker UI. Values are the
 * exact strings that hit the wire — lowercase, hyphenated, with the
 * fallacy family namespaced by a `fallacy/` prefix.
 */
export const ASSESSMENT_LABEL_GROUPS = Object.freeze({
    factual: Object.freeze([
        'false', 'unsupported', 'misleading', 'cherry-picked',
        'missing-context', 'outdated'
    ]),
    consistency: Object.freeze([
        'contradicts-prior-statement', 'flip-flop', 'moved-goalposts'
    ]),
    fallacy: Object.freeze([
        'fallacy/strawman', 'fallacy/ad-hominem', 'fallacy/false-dilemma',
        'fallacy/whataboutism', 'fallacy/circular', 'fallacy/slippery-slope',
        'fallacy/appeal-to-authority', 'fallacy/appeal-to-consequences'
    ]),
    rhetorical: Object.freeze([
        'loaded-language', 'unfalsifiable', 'ambiguous', 'euphemism'
    ]),
    provenance: Object.freeze([
        'undisclosed-interest'
    ])
});

/** Flat list of every standard label. */
export const ASSESSMENT_LABELS = Object.freeze(
    Object.values(ASSESSMENT_LABEL_GROUPS).flat()
);

export function isStandardLabel(label) {
    return ASSESSMENT_LABELS.includes(label);
}

// Custom labels (the freeform escape hatch) ride the same rails as
// standard ones: a lowercase token, optionally one `family/value`
// namespace segment, ≤ 64 chars. Anything that passes here is stored
// and published verbatim under the same namespace; the UI renders
// non-standard values with a "custom" affordance.
const LABEL_RE = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/;

export function isValidLabel(label) {
    return typeof label === 'string'
        && label.length > 0
        && label.length <= 64
        && LABEL_RE.test(label);
}

// ------------------------------------------------------------------
// Stance — graded agree↔disagree, discrete -2..+2 (or null when an
// assessment is label-only).
// ------------------------------------------------------------------

export const STANCE_VALUES = Object.freeze([-2, -1, 0, 1, 2]);

export const STANCE_LABELS = Object.freeze({
    '-2': 'Strongly disagree',
    '-1': 'Disagree',
    '0':  'Unsure',
    '1':  'Agree',
    '2':  'Strongly agree'
});

export function isValidStance(value) {
    return Number.isInteger(value) && value >= -2 && value <= 2;
}

// ------------------------------------------------------------------
// Claim-relationship vocabulary (consumed by evidence-linker.js).
// ------------------------------------------------------------------

/**
 * The Phase 11 typed-link vocabulary. `contradicts` and `duplicates`
 * are SYMMETRIC — A↔B and B↔A state the same fact, so link ids sort
 * the two endpoints before hashing and renderers treat the pair as
 * direction-free. `supports` and `updates` are directional
 * (source → target). The legacy `contextualizes` is read-only: old
 * records still render, but new links can't use it.
 */
export const CLAIM_RELATIONSHIPS = Object.freeze([
    'contradicts', 'supports', 'updates', 'duplicates'
]);

export const SYMMETRIC_RELATIONSHIPS = Object.freeze([
    'contradicts', 'duplicates'
]);

export function isSymmetricRelationship(relationship) {
    return SYMMETRIC_RELATIONSHIPS.includes(relationship);
}

/**
 * Phase 14 (docs/CRIMINOLOGY_DESIGN.md) diachronic "story-change"
 * relationship values, additive to the kind-30055 link substrate.
 * All DIRECTIONAL: source = the earlier statement, target = the later.
 * Kept OUT of CLAIM_RELATIONSHIPS so the Phase-11 link picker is
 * unchanged; the linker validates against the union, and a forensic
 * finding (kind 30062) may characterize such an edge.
 *
 *   - narrative-patch  B is a new explanation added after A was damaged,
 *                      so A's conclusion survives ("covered, not solved")
 *   - recharacterizes  B redefines a key term from A to dodge evidence
 *                      (the diachronic face of defense/definitional-retreat)
 *   - walks-back       B retreats from / softens A once A was cornered
 */
export const REVISION_RELATIONSHIPS = Object.freeze([
    'narrative-patch', 'recharacterizes', 'walks-back'
]);

export function isRevisionRelationship(relationship) {
    return REVISION_RELATIONSHIPS.includes(relationship);
}

// ------------------------------------------------------------------
// Provenance — the manual-now / LLM-ready seam.
// ------------------------------------------------------------------

/**
 * `suggested_by` values: 'user', 'llm:<model>' (non-blank model), or —
 * Phase 25.3 — 'nostr:<64-hex pubkey>' for artifacts incorporated from
 * a followed author's published events. Records carrying a `nostr:`
 * provenance are someone else's work reviewed in: publish selectors
 * MUST exclude them (you never republish another's content as yours).
 */
export function isValidSuggestedBy(value) {
    return value === 'user'
        || (typeof value === 'string' && /^llm:\S.*$/.test(value))
        || (typeof value === 'string' && /^nostr:[0-9a-f]{64}$/.test(value));
}

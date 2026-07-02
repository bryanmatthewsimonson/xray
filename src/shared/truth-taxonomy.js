// Truth-adjudication taxonomy — Phase 15.1 (docs/TRUTH_ADJUDICATION_DESIGN.md §3.1).
//
// Single source of truth for the adjudicable-proposition vocabulary:
// the proposition classes, the subject-role axis, the event-time
// precision enum, and — the whole point of the slice — the FIREWALL
// predicates that keep un-adjudicable things out of the verdict path.
// The model (truth-adjudication-model.js), later verdict/integrity
// slices (15.3/15.4), and the eventual wire builders (15.6) all read
// from here — extending the vocabulary means editing this file and the
// exhaustive-enum tests that pin it.
//
// The prediction-resolution vocabulary (hedge levels, tractabilities)
// is deliberately RE-EXPORTED from audit/builders.js, not forked, so a
// prediction proposition and a banked 30058 prediction entry speak one
// language (kickoff: "reuse, don't fork, the prediction fields").

export { HEDGE_LEVELS, TRACTABILITIES } from './audit/builders.js';
export { isValidSuggestedBy } from './assessment-taxonomy.js';

// ------------------------------------------------------------------
// Proposition classes — what KIND of thing the proposition asserts.
// ------------------------------------------------------------------

/**
 * Exactly the §3.1 set. `interpretation` and `stated-value` are legal
 * classes to RECORD (the classification documents why they are
 * firewalled) but are never truth-adjudicable — see
 * `isTruthAdjudicable` below.
 */
export const PROPOSITION_CLASSES = Object.freeze([
    'event-fact',        // X did Y at T
    'state-fact',        // the state of the world is Z
    'prediction',        // Y will occur by T
    'stated-commitment', // "I will X"
    'stated-value',      // "I value X"
    'interpretation'     // a reading / value claim
]);

export const PROPOSITION_CLASS_LABELS = Object.freeze({
    'event-fact':        'Event fact',
    'state-fact':        'State fact',
    'prediction':        'Prediction',
    'stated-commitment': 'Stated commitment',
    'stated-value':      'Stated value',
    'interpretation':    'Interpretation'
});

export function isValidPropositionClass(value) {
    return PROPOSITION_CLASSES.includes(value);
}

// ------------------------------------------------------------------
// Subject role — the proposition's relationship to the entity in
// `about`, ORTHOGONAL to proposition_class (§3.1).
// ------------------------------------------------------------------

/**
 * `unclassified` is the ABSENCE value: a record whose author did not
 * assert a word/deed reading. It is never defaulted to a substantive
 * role — that would manufacture a reading the author did not make.
 */
export const SUBJECT_ROLES = Object.freeze([
    'stated',       // the entity's own word — a profession or commitment
    'enacted',      // the entity's deed — an action-fact about them
    'ascribed',     // a third party's characterization of the entity
    'unclassified'  // no role asserted (the absence value)
]);

export const SUBJECT_ROLE_LABELS = Object.freeze({
    stated:       'Stated (their word)',
    enacted:      'Enacted (their deed)',
    ascribed:     'Ascribed (a characterization)',
    unclassified: 'Unclassified'
});

export const SUBJECT_ROLE_UNCLASSIFIED = 'unclassified';

export function isValidSubjectRole(value) {
    return SUBJECT_ROLES.includes(value);
}

// ------------------------------------------------------------------
// Event-time precision — the no-false-precision discipline (§3.1),
// same framing as the forensic `basis` enum: a 1987 action must never
// masquerade as a precise timestamp.
// ------------------------------------------------------------------

export const OCCURRED_PRECISIONS = Object.freeze(['exact', 'day', 'month', 'year']);

export function isValidOccurredPrecision(value) {
    return OCCURRED_PRECISIONS.includes(value);
}

// ------------------------------------------------------------------
// Evidence tiers — §3.2 (Phase 15.2). A declared, per-evidence claim
// about PROVENANCE QUALITY, not a score: which rung of the sourcing
// ladder the artifact sits on.
// ------------------------------------------------------------------

export const EVIDENCE_TIERS = Object.freeze([
    'tier-1',   // primary / official: court records, roll-call votes,
                // filings, datasets, signed records, primary recordings
    'tier-2',   // independent reporting
    'tier-3'    // single-source / anonymous / uncorroborated
]);

export const EVIDENCE_TIER_LABELS = Object.freeze({
    'tier-1': 'Primary / official',
    'tier-2': 'Independent reporting',
    'tier-3': 'Single-source / uncorroborated'
});

export function isValidEvidenceTier(value) {
    return EVIDENCE_TIERS.includes(value);
}

/**
 * Numeric rank for comparing tiers (lower = stronger provenance).
 * Used by the convergence measurement to report an origin group's
 * BEST tier. Unknown tiers rank below everything (fails closed).
 */
export function evidenceTierRank(tier) {
    const idx = EVIDENCE_TIERS.indexOf(tier);
    return idx === -1 ? EVIDENCE_TIERS.length : idx;
}

// ------------------------------------------------------------------
// Verdict states — §3.3 (Phase 15.3). DESCRIPTIVE STATES, the §1
// spine made concrete: a proposition is established, contested,
// unresolved, or under-evidenced — never "73% true". There is no
// score field anywhere in this vocabulary, deliberately.
// ------------------------------------------------------------------

export const VERDICT_STATES = Object.freeze([
    'established-true',
    'established-false',
    'contested',              // credible evidence both ways
    'unresolved',             // a permanent, honest state — never forced
    'insufficient-evidence'   // first-class, not a failure mode
]);

export const VERDICT_STATE_LABELS = Object.freeze({
    'established-true':      'Established true',
    'established-false':     'Established false',
    'contested':             'Contested',
    'unresolved':            'Unresolved',
    'insufficient-evidence': 'Insufficient evidence'
});

export function isValidVerdictState(value) {
    return VERDICT_STATES.includes(value);
}

// ------------------------------------------------------------------
// Standards of proof — §3.3, borrowed from common law. Declared per
// verdict and met, never implied.
// ------------------------------------------------------------------

export const STANDARDS_OF_PROOF = Object.freeze([
    'preponderance',
    'clear-and-convincing',
    'beyond-reasonable-doubt'
]);

export const STANDARD_OF_PROOF_LABELS = Object.freeze({
    'preponderance':          'Preponderance of the evidence',
    'clear-and-convincing':   'Clear and convincing',
    'beyond-reasonable-doubt': 'Beyond reasonable doubt'
});

export function isValidStandardOfProof(value) {
    return STANDARDS_OF_PROOF.includes(value);
}

/**
 * The §6 open-question default, settled at implementation: stated
 * commitments and values carry reputational weight for the subject,
 * so their utterance-verdicts default to `clear-and-convincing`;
 * facts and predictions default to `preponderance`. Always
 * overridable per verdict — this is the default DECLARED standard,
 * never a hidden one.
 *
 * @param {string} propositionClass
 * @returns {string}
 */
export function defaultStandardOfProof(propositionClass) {
    return (propositionClass === 'stated-commitment' || propositionClass === 'stated-value')
        ? 'clear-and-convincing'
        : 'preponderance';
}

// ------------------------------------------------------------------
// The firewall (§3.1, §3.4, §5.7) — do not soften.
// ------------------------------------------------------------------

/**
 * The classes a truth verdict (15.3) may attach to. Interpretations
 * and bare values are NOT adjudicable as true/false — only the honesty
 * of the reasoning behind them (Phase 11 stance / Phase 16 lens) or
 * the observable word-deed gap (§3.4) is assessable. This is the
 * firewall against the tool becoming an orthodoxy enforcer.
 */
export const TRUTH_ADJUDICABLE_CLASSES = Object.freeze([
    'event-fact', 'state-fact', 'prediction', 'stated-commitment'
]);

/**
 * May a verdict rule this proposition true/false? Accepts a
 * proposition record or a bare class string. False for
 * `interpretation` and `stated-value` — and for anything unknown, so
 * the firewall fails CLOSED on malformed input.
 *
 * @param {string|{proposition_class: string}} proposition
 * @returns {boolean}
 */
export function isTruthAdjudicable(proposition) {
    const cls = typeof proposition === 'string'
        ? proposition
        : (proposition && proposition.proposition_class);
    return TRUTH_ADJUDICABLE_CLASSES.includes(cls);
}

// The word/deed pairing an IntegrityFinding (15.4) matches: a `stated`
// commitment or value against `enacted` action-facts about the same
// entity. `ascribed` and `unclassified` are excluded BY CONSTRUCTION —
// an ascribed claim is *about* the entity but is not theirs to be held
// to, and an unclassified one asserts no reading at all.

const INTEGRITY_WORD_CLASSES = Object.freeze(['stated-commitment', 'stated-value']);
const INTEGRITY_DEED_CLASSES = Object.freeze(['event-fact', 'state-fact']);

/**
 * Which side of an IntegrityFinding this proposition could sit on:
 * 'word' (a stated commitment/value), 'deed' (an enacted action-fact),
 * or null (not integrity-eligible). 15.4 consumes this instead of
 * re-implementing the pairing.
 *
 * @param {{proposition_class: string, subject_role: string}} proposition
 * @returns {'word'|'deed'|null}
 */
export function integrityRole(proposition) {
    const p = proposition || {};
    if (p.subject_role === 'stated' && INTEGRITY_WORD_CLASSES.includes(p.proposition_class)) {
        return 'word';
    }
    if (p.subject_role === 'enacted' && INTEGRITY_DEED_CLASSES.includes(p.proposition_class)) {
        return 'deed';
    }
    return null;
}

/**
 * May this proposition participate in an IntegrityFinding at all?
 * Excludes `ascribed` and `unclassified` roles (and any class/role
 * pairing that has no side to sit on).
 *
 * @param {{proposition_class: string, subject_role: string}} proposition
 * @returns {boolean}
 */
export function isIntegrityEligible(proposition) {
    return integrityRole(proposition) !== null;
}

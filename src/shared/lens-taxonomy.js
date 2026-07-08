// Lens-reading taxonomy — Phase 16.1
// (docs/MORAL_LENS_JURISDICTION_DESIGN.md §3, §5; amendment 2026-07-03).
//
// Single source of truth for the lens-side vocabulary: jurisdiction
// types, the four lens assertion types, dispositions, corpus stances,
// grounding levels, confidence levels, and authority admissibility.
// The jurisdiction registry (jurisdiction-model.js), the engine
// (lens-engine.js), the output validators (lens-schemas.js), and the
// reader surface all read from here — extending the vocabulary means
// editing this file and the exhaustive-enum tests that pin it.
//
// Firewall discipline (§3):
//   - These enums are LENS-SIDE. `PROPOSITION_CLASSES` (truth-taxonomy)
//     is never extended by this layer; the §3.1 mapping is one-way and
//     lives in `lensTypeForPropositionClass` below.
//   - The token overlap with the legacy `CLAIM_TYPES` enum in
//     claim-model.js (`factual`, `evaluative`) is sanctioned by the
//     design: lens typing is computed per run and never stored on claim
//     records, and code never compares tokens across the two enums.
//   - `DISPOSITIONS` shares no token with Phase 15's VERDICT_STATES or
//     INTEGRITY_MATCH_STATES — pinned by literal in the 16.4 tests.
//   - Tokens use the house lowercase-hyphenated grammar (§5.2) — never
//     underscores.

// ------------------------------------------------------------------
// Jurisdiction types — §4.
// ------------------------------------------------------------------

export const JURISDICTION_TYPES = Object.freeze([
    'codified',   // a legal code — statutes/regulations by official citation
    'worldview',  // a tradition, pluralism encoded (internal_divisions)
    'persona'     // an author's corpus (living-person guardrail applies)
]);

export const JURISDICTION_TYPE_LABELS = Object.freeze({
    codified:  'Codified (legal code)',
    worldview: 'Worldview (tradition)',
    persona:   'Persona (author corpus)'
});

export function isValidJurisdictionType(value) {
    return JURISDICTION_TYPES.includes(value);
}

// ------------------------------------------------------------------
// Lens assertion types — §3.1. One lens-side enum, mapped to Phase 15
// classes where a mapping exists, never merged with them.
// ------------------------------------------------------------------

export const LENS_ASSERTION_TYPES = Object.freeze([
    'factual',     // checkable against the world — DEFERRED to Phase 15
    'normative',   // an ought-claim (a property of article text)
    'evaluative',  // a reading or bare value (covers Phase 15's
                   // interpretation + stated-value)
    'framing'      // emphasis / omission / tone (a property of article text)
]);

export const LENS_ASSERTION_TYPE_LABELS = Object.freeze({
    factual:    'Factual (deferred to truth layer)',
    normative:  'Normative (ought-claim)',
    evaluative: 'Evaluative (reading / value)',
    framing:    'Framing (emphasis / omission / tone)'
});

export function isValidLensAssertionType(value) {
    return LENS_ASSERTION_TYPES.includes(value);
}

/**
 * Does an assertion of this lens type carry a `disposition`? The §3.2
 * firewall made mechanical: `factual` assertions never do (they carry a
 * `corpus_stance` instead — a statement about the corpus, not about
 * reality); the other three types always do. Unknown types carry
 * neither — the firewall fails closed.
 */
export function carriesDisposition(lensType) {
    return isValidLensAssertionType(lensType) && lensType !== 'factual';
}

/**
 * The §3.1 mapping from a Phase 15 proposition class to this layer's
 * assertion type: the adjudicable classes are `factual` (deferred to
 * the truth layer); `interpretation` and `stated-value` — the two
 * classes Phase 15 §3.1 hands over — are `evaluative`. Returns null
 * for anything unknown; `normative` and `framing` have no proposition
 * class by design (they are properties of article text).
 *
 * String literals, deliberately: the pinned mapping must not drift
 * silently with the truth-taxonomy enum (§8 base-branch note).
 */
export function lensTypeForPropositionClass(propositionClass) {
    if (propositionClass === 'event-fact' || propositionClass === 'state-fact'
        || propositionClass === 'prediction' || propositionClass === 'stated-commitment') {
        return 'factual';
    }
    if (propositionClass === 'interpretation' || propositionClass === 'stated-value') {
        return 'evaluative';
    }
    return null;
}

// ------------------------------------------------------------------
// Dispositions — §5.2. How a jurisdiction reads a non-factual
// assertion. The set is the source prompt's, tokens re-grammared to
// the house lowercase-hyphenated form.
// ------------------------------------------------------------------

export const DISPOSITIONS = Object.freeze([
    'endorses',
    'rejects',
    'partially-endorses',
    'reframes',        // accepts the concern, restates the question
    'out-of-scope',    // the jurisdiction does not govern this kind of thing
    'silent'           // the LOADED CORPUS does not address it (never a guess)
]);

export const DISPOSITION_LABELS = Object.freeze({
    'endorses':           'Endorses',
    'rejects':            'Rejects',
    'partially-endorses': 'Partially endorses',
    'reframes':           'Reframes',
    'out-of-scope':       'Out of scope',
    'silent':             'Silent (corpus does not address it)'
});

export function isValidDisposition(value) {
    return DISPOSITIONS.includes(value);
}

/**
 * The dispositions a reading may carry with an EMPTY `authorities_cited`
 * (§7): where the corpus is silent or the question is out of the
 * jurisdiction's scope there is nothing to cite. Everything else must
 * cite — enforced at parse time by lens-schemas.js, not hoped for in
 * the prompt.
 */
export const UNCITED_DISPOSITIONS = Object.freeze(['silent', 'out-of-scope']);

// ------------------------------------------------------------------
// Corpus stances — §3.2. The ONLY thing this layer may say about a
// factual assertion: what the loaded corpus says, descriptively.
// ------------------------------------------------------------------

export const CORPUS_STANCES = Object.freeze(['asserts', 'denies', 'silent']);

export const CORPUS_STANCE_LABELS = Object.freeze({
    asserts: 'Corpus asserts this',
    denies:  'Corpus denies this',
    silent:  'Corpus is silent on this'
});

export function isValidCorpusStance(value) {
    return CORPUS_STANCES.includes(value);
}

// ------------------------------------------------------------------
// Grounding levels — §7. How directly a cited authority supports the
// reading. `inference` is legal but counts against the grounding
// report (and is forced when a locator can't anchor to a named
// edition — §7 hard stops).
// ------------------------------------------------------------------

export const GROUNDING_LEVELS = Object.freeze(['direct-quote', 'paraphrase', 'inference']);

export const GROUNDING_LEVEL_LABELS = Object.freeze({
    'direct-quote': 'Direct quote',
    'paraphrase':   'Paraphrase',
    'inference':    'Inference'
});

export function isValidGroundingLevel(value) {
    return GROUNDING_LEVELS.includes(value);
}

// ------------------------------------------------------------------
// Confidence — §5.1. A LEGITIMATE ESTIMATION of reconstruction
// fidelity (corpus coverage × tradition unity × inference load) —
// never a truth measure and never the jurisdiction's fervor. The note
// below must ride every confidence chip; a 16.4 test pins the exact
// string next to LENS_PROMPT_VERSION so it cannot silently disappear.
// ------------------------------------------------------------------

export const LENS_CONFIDENCES = Object.freeze(['high', 'medium', 'low']);

export function isValidLensConfidence(value) {
    return LENS_CONFIDENCES.includes(value);
}

export const LENS_CONFIDENCE_FIDELITY_NOTE =
    'Confidence measures the fidelity of this perspectival reconstruction — '
    + 'how directly the loaded corpus addresses the assertion, how unified the '
    + 'tradition is, and how much inference was required. It never measures '
    + 'whether the assertion is true, and never how strongly the jurisdiction feels.';

// Per-authority coverage levels in `authorities_loaded` (§7) — computed
// code-side from citation frequency, same three tokens as confidence.
export const COVERAGE_LEVELS = LENS_CONFIDENCES;

// ------------------------------------------------------------------
// Authority admissibility — §9 Q1 (binding on 16.1). Every authority
// carries one of these from day one. For a living-person persona only
// the editorially published kinds are admissible; social-platform
// captures are not.
// ------------------------------------------------------------------

export const ADMISSIBILITIES = Object.freeze([
    'published-book',        // edition/ISBN
    'published-essay',       // bylined published essay (a public bylined
                             // newsletter essay qualifies)
    'published-article',     // bylined published article
    'published-transcript',  // published transcript of a public talk
    'published-statute',
    'published-regulation',
    'published-doctrine',
    'published-scripture',
    'social-capture'         // a capture from a social platform —
                             // INADMISSIBLE for living personas
]);

export const EDITORIALLY_PUBLISHED_ADMISSIBILITIES = Object.freeze(
    ADMISSIBILITIES.filter((a) => a !== 'social-capture')
);

export function isValidAdmissibility(value) {
    return ADMISSIBILITIES.includes(value);
}

/**
 * The living-person guardrail's admissibility test (§9 Q1): only
 * editorially published works count. Unknown values fail closed.
 */
export function isAdmissibleForLivingPersona(admissibility) {
    return EDITORIALLY_PUBLISHED_ADMISSIBILITIES.includes(admissibility);
}

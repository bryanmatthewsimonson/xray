// Forensic taxonomy — Phase 13.1 (docs/CRIMINOLOGY_DESIGN.md).
//
// Single source of truth for the behavioral-finding vocabulary: the
// maneuver families (seeded from the criminology / thought-reform
// canon), the subject role enum, and the evidence `basis` enum. Model
// validation, the picker UI (13.2), the wire builders (13.3), and the
// NIP draft all read from here — extending the vocabulary means editing
// this file *and* the exhaustive-enum tests that pin it.
//
// A finding names a MANEUVER a subject performs around the truth and
// binds it to evidence. It carries NO stance, NO score, and NO intent
// field — by construction (see CRIMINOLOGY_DESIGN.md §Methodology). The
// `basis` enum records *how we know* (a quote vs. a body-language read);
// it is a bounded, checkable statement, not a 0–100 confidence.
//
// Every standard maneuver ships with a MANEUVER_GUIDE entry pairing a
// canon citation + Dawn-alias + definition with INDICATORS and
// COUNTER-INDICATORS — so "what would make this NOT this" is always on
// the page (the falsifiability discipline; pinned by a test).

import { isValidSuggestedBy, REVISION_RELATIONSHIPS } from './assessment-taxonomy.js';

// NIP-32 namespace the maneuvers publish under (`['L', <ns>]` +
// `['l', <maneuver>, <ns>]` on kind 30056, mirrored to kind 1985).
export const FORENSIC_MANEUVER_NAMESPACE = 'xray/forensic';

/**
 * The maneuver families, grouped for the picker UI. Values are the
 * exact strings that hit the wire — lowercase, hyphenated, each family
 * namespaced by its `family/` prefix. Reuse `fallacy/*` and
 * `consistency/*` from the assessment taxonomy where Dawn's vocabulary
 * already coincides (strawman = "reduction challenge", false-dilemma =
 * "false dilemma framing", moved-goalposts, flip-flop) — this file only
 * adds the behavioral / institutional families that have no home there.
 */
export const FORENSIC_MANEUVER_GROUPS = Object.freeze({
    // Sykes & Matza 1957 (+ Klockars 1974, Minor 1981).
    neutralization: Object.freeze([
        'neutralization/deny-responsibility', 'neutralization/deny-injury',
        'neutralization/deny-victim', 'neutralization/condemn-condemners',
        'neutralization/higher-loyalties', 'neutralization/ledger',
        'neutralization/necessity', 'neutralization/normalcy',
        'neutralization/deny-negative-intent'
    ]),
    // Freyd 1997 — Deny, Attack, Reverse Victim & Offender.
    darvo: Object.freeze([
        'darvo/deny', 'darvo/attack', 'darvo/reverse-victim-offender'
    ]),
    // Lifton 1961 — eight criteria of thought reform.
    'thought-reform': Object.freeze([
        'thought-reform/milieu-control', 'thought-reform/loading-the-language',
        'thought-reform/sacred-science', 'thought-reform/doctrine-over-person',
        'thought-reform/dispensing-of-existence', 'thought-reform/demand-for-purity',
        'thought-reform/thought-terminating-cliche'
    ]),
    // Popper 1963 / Lakatos 1970 / Proctor 2008 (agnotology).
    defense: Object.freeze([
        'defense/ad-hoc-patch', 'defense/immunizing-stratagem',
        'defense/manufactured-doubt', 'defense/frame-control',
        'defense/definitional-retreat', 'defense/presentism',
        'defense/usefulness-pivot', 'defense/credibility-armor'
    ]),
    // Finkelhor 1984 / Craven, Brown & Gilchrist 2006 — ORDERED sequence.
    grooming: Object.freeze([
        'grooming/build-vulnerability', 'grooming/establish-trust',
        'grooming/redefine-boundaries', 'grooming/apply-pressure'
    ])
});

/** Flat list of every standard maneuver. */
export const FORENSIC_MANEUVERS = Object.freeze(
    Object.values(FORENSIC_MANEUVER_GROUPS).flat()
);

export function isStandardManeuver(maneuver) {
    return FORENSIC_MANEUVERS.includes(maneuver);
}

// Custom maneuvers ride the same rails as standard ones (and as
// assessment labels): a lowercase token, optionally one `family/value`
// namespace segment, ≤ 64 chars. Anything that passes is stored and
// published verbatim under the same namespace.
const MANEUVER_RE = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/;

export function isValidManeuver(maneuver) {
    return typeof maneuver === 'string'
        && maneuver.length > 0
        && maneuver.length <= 64
        && MANEUVER_RE.test(maneuver);
}

// ------------------------------------------------------------------
// Subject role — who is being profiled, in what capacity. The
// taxonomy carries no side: every role is runnable against either
// interlocutor (the bias-symmetry requirement).
// ------------------------------------------------------------------

export const ROLES = Object.freeze([
    'apologist', 'critic', 'institution', 'witness', 'survivor', 'other'
]);

export function isValidRole(role) {
    return ROLES.includes(role);
}

// ------------------------------------------------------------------
// Evidence basis — *how we know*, in place of a numeric score. Ordered
// strongest → weakest; `behavioral-cue` (micro-expression / body
// language) is the lowest-evidentiary tier and is never aggregated
// into a score, because there is no score.
// ------------------------------------------------------------------

export const BASIS_VALUES = Object.freeze([
    'quoted', 'paraphrased', 'behavioral-cue', 'structural-inference'
]);

export function isValidBasis(value) {
    return BASIS_VALUES.includes(value);
}

// Re-exported so the model + UI pull the whole forensic vocabulary from
// one place. REVISION_RELATIONSHIPS are the diachronic story-change
// edge types — they live on kind 30055 (the link substrate), not on a
// finding, so they are defined in assessment-taxonomy.js next to the
// rest of the claim-relationship vocabulary and surfaced here.
export { isValidSuggestedBy, REVISION_RELATIONSHIPS };

// ------------------------------------------------------------------
// Maneuver guide — canon citation, Dawn-alias, definition, and the
// indicators / counter-indicators that keep each finding falsifiable.
// Consumed by the finding modal (tooltips), the LLM-assist prompt, and
// the NIP draft. A test pins that every standard maneuver has an entry
// with at least one counter-indicator.
// ------------------------------------------------------------------

export const MANEUVER_GUIDE = Object.freeze({
    'neutralization/deny-responsibility': {
        source: 'Sykes & Matza 1957',
        definition: 'Recasts the act as caused by forces outside the actor’s control.',
        indicators: ['"I had no choice"', 'blames circumstance or conditioning'],
        counterIndicators: ['the constraint named is externally verifiable',
            'the actor does not also claim the act was good']
    },
    'neutralization/deny-injury': {
        source: 'Sykes & Matza 1957',
        definition: 'Minimizes or denies that any harm occurred.',
        indicators: ['"no one was really hurt"', '"it was the way of the time"'],
        counterIndicators: ['the existence of harm is genuinely contested on evidence']
    },
    'neutralization/deny-victim': {
        source: 'Sykes & Matza 1957',
        definition: 'Reframes the injured party as deserving it or as not a victim.',
        indicators: ['"they had it coming"', 'victim recast as the aggressor'],
        counterIndicators: ['a real, documented prior provocation exists']
    },
    'neutralization/condemn-condemners': {
        source: 'Sykes & Matza 1957',
        alias: 'attack the questioner',
        definition: 'Deflects by attacking the motives or legitimacy of the critics.',
        indicators: ['"you’re just biased / an anti"', 'critic’s character substituted for the claim'],
        counterIndicators: ['a specific, evidenced conflict of interest is raised, not a blanket smear']
    },
    'neutralization/higher-loyalties': {
        source: 'Sykes & Matza 1957',
        definition: 'Subordinates the norm to a higher allegiance (faith, family, cause).',
        indicators: ['"I answer to God / the brethren, not to you"'],
        counterIndicators: ['the loyalty is openly avowed, not a post-hoc shield']
    },
    'neutralization/ledger': {
        source: 'Klockars 1974',
        alias: 'metaphor of the ledger',
        definition: 'Offsets the act against accumulated good deeds.',
        indicators: ['"look at all the good we do"', 'good works cited as a credit balance'],
        counterIndicators: ['the good and the harm are genuinely independent, not being traded off']
    },
    'neutralization/necessity': {
        source: 'Minor 1981',
        alias: 'defense of necessity',
        definition: 'Casts the act as unavoidable given the situation.',
        indicators: ['"it had to be done"'],
        counterIndicators: ['an actual forced choice, with no alternative, is shown']
    },
    'neutralization/normalcy': {
        source: 'Coleman 1994 (claim of normalcy)',
        alias: 'everybody does it',
        definition: 'Neutralizes by appeal to ubiquity.',
        indicators: ['"everyone did it back then"'],
        counterIndicators: ['the prevalence claim is accurately stated, not invented']
    },
    'neutralization/deny-negative-intent': {
        source: 'Henry 1990',
        definition: 'Concedes the act but denies any bad intent.',
        indicators: ['"I was just joking"', '"that’s not what I meant"'],
        counterIndicators: ['a contemporaneous record corroborates the benign intent']
    },
    'darvo/deny': {
        source: 'Freyd 1997',
        definition: 'Flat denial of the conduct under challenge.',
        indicators: ['categorical "that never happened"'],
        counterIndicators: ['the denial is specific and falsifiable, not blanket']
    },
    'darvo/attack': {
        source: 'Freyd 1997',
        definition: 'Attacks the person raising the issue.',
        indicators: ['pivot to the critic’s credibility or tone'],
        counterIndicators: ['a concrete, evidenced objection to method — not motive']
    },
    'darvo/reverse-victim-offender': {
        source: 'Freyd 1997',
        alias: 'victim-flip',
        definition: 'Recasts the responsible party as the true victim.',
        indicators: ['"I’m the one being persecuted here"', 'enforcement framed as self-defense'],
        counterIndicators: ['a genuine, documented harm to the speaker exists']
    },
    'thought-reform/milieu-control': {
        source: 'Lifton 1961',
        alias: 'cognitive containment',
        definition: 'Controls which information and views are admissible.',
        indicators: ['"don’t listen to the other side"', 'other views framed as unsafe / immoral / irrational'],
        counterIndicators: ['engages the strongest opposing source on the merits']
    },
    'thought-reform/loading-the-language': {
        source: 'Lifton 1961',
        alias: 'semantic inversion',
        definition: 'A word keeps its authority while its meaning is quietly reversed or softened.',
        indicators: ['"translation" → "revelation / inspiration" after the evidence failed'],
        counterIndicators: ['the redefinition predates, rather than follows, the damaging evidence']
    },
    'thought-reform/sacred-science': {
        source: 'Lifton 1961',
        alias: 'credibility armor / trust-credential spoofing',
        definition: 'Treats a doctrine or authority as beyond question.',
        indicators: ['a title or role used as proof', '"a prophet can’t lead you astray"'],
        counterIndicators: ['the authority’s claims are themselves held open to test']
    },
    'thought-reform/doctrine-over-person': {
        source: 'Lifton 1961',
        definition: 'Privileges the doctrine over lived experience or evidence.',
        indicators: ['"your experience must be wrong"'],
        counterIndicators: ['the experience cited is itself unreliable on independent grounds']
    },
    'thought-reform/dispensing-of-existence': {
        source: 'Lifton 1961',
        definition: 'Casts outsiders or critics as illegitimate or doomed.',
        indicators: ['"apostates end up miserable / nihilist"'],
        counterIndicators: ['the outcome claim is backed by representative evidence, not anecdote']
    },
    'thought-reform/demand-for-purity': {
        source: 'Lifton 1961',
        definition: 'Enforces an all-or-nothing standard.',
        indicators: ['black-and-white framing of belief or loyalty'],
        counterIndicators: ['the standard is explicit and applied to the speaker too']
    },
    'thought-reform/thought-terminating-cliche': {
        source: 'Lifton 1961',
        definition: 'A stock phrase that closes inquiry.',
        indicators: ['"it’s messy but true"', '"milk before meat"'],
        counterIndicators: ['the phrase is followed by — not a substitute for — an argument']
    },
    'defense/ad-hoc-patch': {
        source: 'Popper 1963',
        alias: 'narrative patching',
        definition: 'A new explanation added after a claim is damaged, preserving the original conclusion.',
        indicators: ['the new story appears exactly when the evidence lands', '"catalyst theory"'],
        counterIndicators: ['the patch makes an independent, testable prediction']
    },
    'defense/immunizing-stratagem': {
        source: 'Lakatos 1970',
        alias: 'systemic overextension',
        definition: 'Each contradiction spawns a workaround until the claim is unfalsifiable.',
        indicators: ['accumulating exceptions', '"you can’t prove it didn’t happen"'],
        counterIndicators: ['the defense gives something up to gain coherence']
    },
    'defense/manufactured-doubt': {
        source: 'Proctor 2008 (agnotology)',
        alias: 'epistemological fog',
        definition: 'Blurs the evidence field so that no conclusion feels reachable.',
        indicators: ['"we’re only arguing plausibility"', '"it could be anywhere"'],
        counterIndicators: ['the uncertainty cited is real and load-bearing, not generalized']
    },
    'defense/frame-control': {
        source: 'Goffman 1974 / Entman 1993',
        alias: 'framing',
        definition: 'Sets the conversation’s boundaries so some facts feel out of bounds.',
        indicators: ['shrinking the target', '"that’s not what this is about"'],
        counterIndicators: ['the reframing is announced and reversible']
    },
    'defense/definitional-retreat': {
        source: 'Popper 1963',
        definition: 'Redefines a key term to dodge a refutation (the point-in-time face of loading-the-language).',
        indicators: ['the term’s meaning shifts mid-argument'],
        counterIndicators: ['the new definition is applied consistently, including against the speaker']
    },
    'defense/presentism': {
        source: 'Butterfield 1931 (defensive use)',
        definition: 'Deflects a moral challenge by appeal to "the standards of the time".',
        indicators: ['"it was acceptable then"'],
        counterIndicators: ['contemporaneous sources show the conduct was in fact contested at the time']
    },
    'defense/usefulness-pivot': {
        source: 'James 1907 (pragmatism, misapplied)',
        definition: 'Shifts the debate from "is it true" to "is it useful / good fruits".',
        indicators: ['"look at the good it does"', 'a truth claim swapped for a utility claim'],
        counterIndicators: ['utility is offered alongside, not instead of, the truth claim']
    },
    'defense/credibility-armor': {
        source: 'Cialdini 1984 (authority)',
        alias: 'trust-credential spoofing',
        definition: 'Uses a credential, role, or platform to bypass scrutiny — having the credential is fine; using it as proof is the move.',
        indicators: ['"as an expert / a bishop, trust me"'],
        counterIndicators: ['the credential is relevant and the argument still stands without it']
    },
    'grooming/build-vulnerability': {
        source: 'Finkelhor 1984',
        definition: 'Identifies and cultivates a target’s susceptibility (sequence step 1).',
        indicators: ['isolates the target', 'exploits a need or insecurity'],
        counterIndicators: ['the attention is age-appropriate and non-isolating']
    },
    'grooming/establish-trust': {
        source: 'Craven, Brown & Gilchrist 2006',
        definition: 'Manufactures closeness or authority to lower defenses (sequence step 2).',
        indicators: ['special-relationship framing'],
        counterIndicators: ['the closeness is transparent and reciprocal, not secrecy-bound']
    },
    'grooming/redefine-boundaries': {
        source: 'Craven, Brown & Gilchrist 2006',
        definition: 'Incrementally normalizes boundary-crossing (sequence step 3).',
        indicators: ['reframes the transgressive as ordinary or spiritual'],
        counterIndicators: ['boundary changes are consensual, documented, and reversible']
    },
    'grooming/apply-pressure': {
        source: 'Craven, Brown & Gilchrist 2006',
        definition: 'Converts the relationship into compliance via obligation or fear (sequence step 4).',
        indicators: ['spiritual or social pressure to comply'],
        counterIndicators: ['compliance is freely refusable without penalty']
    }
});

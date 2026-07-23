# Discipline Standards — best practices derived from first principles

**Document version:** 1.0.0
**Status:** Normative for the standards and the index; descriptive for
status columns
**Governed by:** `docs/CONSTITUTION.md` (Art. 9) — enters the Concord
Schedule as an organic statute on adoption
**Date:** 2026-07-22

Amendments follow the constitution's Art. 13 (Tier 2 for this
document's normative sections). Silent edits are void.

---

## §0. The method

`docs/PHILOSOPHY.md` — the strongest normative document this project
has produced — was not written by listing rules. It was **derived**:
ask how the best practitioner of the discipline, across all time,
actually worked ("pretend you are the editor of the most prestigious
news organization of all time — how did you do it? how did you get
your start?"); extract from the answer what must be *true* for the
practice to reliably produce trustworthy output; codify that as
numbered, checkable standards with red lines and decision heuristics;
then machine-enforce what can be enforced. The idealized-practitioner
question is elicitation scaffolding — it is discarded once the
standards exist. The deliverable is the standards.

This document applies that method to every discipline the project
draws on. For disciplines whose standards are already codified in a
governing document or in validated code, the section here records the
derivation and points at the codification. For disciplines not yet
codified, the section derives the standards directly — they bind from
this document until a fuller statute exists. Every section carries the
same fields, pinned by `tests/disciplines.test.mjs`: **The question**
(the elicitation), **First principles** (what must be true),
**Standards** (the derived practices), **Failure mode** (the
discipline's characteristic corruption, and the standard that counters
it — no discipline exempts itself), and **Status** (where it lives in
X-Ray).

## §1. The index

| § | Discipline | Id | Standards codified in | Status |
|---|---|---|---|---|
| §2 | Journalism & epistemic auditing | `journalism-audit` | `docs/PHILOSOPHY.md` | codified |
| §3 | Science | `science` | this document | partial |
| §4 | Legal adjudication | `adjudication` | `docs/TRUTH_ADJUDICATION_DESIGN.md` | codified |
| §5 | Forensic behavioral analysis | `forensics` | `docs/CRIMINOLOGY_DESIGN.md` | codified |
| §6 | Intelligence analysis | `analysis` | `docs/HYPOTHESIS_MAP_DESIGN.md` | codified |
| §7 | Forensic accounting | `accounting` | this document | gap |
| §8 | Historiography | `historiography` | this document | partial |
| §9 | Statistics & forecasting | `forecasting` | this document | partial |
| §10 | Adversarial practice | `adversarial` | this document | partial |
| §11 | Civil liberties | `speech` | this document | partial |
| §12 | Archival science | `archival` | this document | partial |
| §13 | Cryptographic verification | `verification` | `docs/NIP_DRAFT.md` | codified |
| §14 | Translation & rhetoric | `translation` | `docs/MORAL_LENS_JURISDICTION_DESIGN.md` | codified |
| §15 | Citizen judgment | `citizen-judgment` | this document | partial |
| §16 | Operator accountability | `operator` | `docs/CONSTITUTION.md` | codified |

Status vocabulary: **codified** — a governing document or validated
code carries the standards; **partial** — the standards below bind,
with some already enforced in code and some not; **gap** — nothing in
the project enforces this discipline yet; the standards below are the
specification for building it.

---

## §2. Journalism & epistemic auditing (`journalism-audit`)

**The question.** How did the best editor of all time verify a story
with no privileged access — and how would they audit everyone else's?

**First principles.** Trustworthy judgment about published work
requires no access, only method: everything the auditor knows, the
reader can know; everything the auditor concludes, the reader can
re-derive (the outsider stance). Craft is detectable at the surface —
sloppy or motivated work leaves fingerprints in headline-body tension,
asymmetric framing, naked numbers, and sourcing architecture. And the
auditor survives only by obeying its own standards, applied harder.

**Standards.** Fully codified as `docs/PHILOSOPHY.md` — the founding
instance of the §0 method: twelve principles (P1–P12), eight surface
dimensions, the scoring philosophy (a licensed estimation under
CONSTITUTION Art. 5.3), red lines, and decision heuristics. This
document does not restate them; that document governs.

**Failure mode.** Metric worship — Goodharting surface dimensions
until the score *feels* like truth. Countered by P10 (the auditor
audited harder, corrections at greater prominence) and by the
forecasting standards (§9: the auditor's own confidences get
calibration-scored).

**Status.** Codified: `docs/PHILOSOPHY.md`; implemented in
`src/shared/audit/` (orchestrator + eight module prompts, the
aggregate computed in code, never by the model).

## §3. Science (`science`)

**The question.** How did the best experimentalist of all time avoid
fooling the easiest person to fool — themselves?

**First principles.** A claim earns scientific standing only by
exposing itself to refutation: state what would make it false before
looking. Evidence is not all equal — rank it by structural resistance
to bias, and declare the ranking before weighing. One result is a
claim; independent replication is a fact. Negative results are
results.

**Standards.**

1. Every finding-type ships with counter-indicators — "what would
   make this NOT this" is on the page, always.
2. Unfalsifiable framings are named as such, never scored.
3. Quotes and anchors are machine-checked against the source bytes;
   altered evidence is discarded, not corrected.
4. Empty finding lists and negative results are first-class outputs.
5. The hierarchy of evidence is declared before the evidence is
   weighed, and evidence tiers state their derivation.

**Failure mode.** Scientism — demanding experiments of history,
treating value questions as pending lab results, mistaking "not yet
measured" for "not real." Countered by the historiography standards
(§8: rigorous knowledge without experiments) and the citizen-judgment
standards (§15: testimonial evidence is admissible, not noise).

**Status.** Partial — standards 1, 3, and 4 are enforced in code
(counter-indicators pinned in `src/shared/forensic-taxonomy.js`;
machine grounding in `src/shared/quote-grounding.js`; validators
accept empty lists); 2 and 5 bind as authoring discipline; structured
tier-derivation notes are a seed (§17).

## §4. Legal adjudication (`adjudication`)

**The question.** How did the best judge of all time rule on disputed
facts without becoming either a rubber stamp or an inquisitor?

**First principles.** Truth-value at human scale is categorical, not
graduated — so verdicts are descriptive states, never scores. The
standard of proof is declared before the evidence is weighed, and
scales with stakes. Only propositions that can be cleanly wrong are
adjudicable — interpretations and values never are (the firewall
against orthodoxy enforcement). Both sides are heard; "unresolved" is
a complete, honorable ruling; and good-faith-wrong is not bad-faith.

**Standards.** Fully codified as `docs/TRUTH_ADJUDICATION_DESIGN.md`
§1 (the form-of-judgment spine, adopted project-wide by CONSTITUTION
Art. 5) and §5 (red lines), with the §3.1 atomization gate and the
defamation firewall. That document governs.

**Failure mode.** Verdict hunger and proceduralism — forcing
resolution the evidence will not bear; process as fetish. Countered by
`insufficient-evidence`/`unresolved` as first-class states and by the
citizen-judgment standards (§15: legitimacy must be lay-legible).

**Status.** Codified: `docs/TRUTH_ADJUDICATION_DESIGN.md`; implemented
in `src/shared/truth-taxonomy.js`, `truth-adjudication-model.js`,
`truth-builders.js` (kinds 30063/30064).

## §5. Forensic behavioral analysis (`forensics`)

**The question.** How did the best investigator of all time document
what an actor is doing to a conversation — without convicting anyone
of a state of mind?

**First principles.** Every contact leaves a trace: motivated text
leaves fingerprints. But the investigator's confidence is the least
reliable instrument in the room — so findings are chains of
machine-checked anchors, never narratives; maneuvers are named from a
citable canon (neutralization, DARVO, thought reform, agnotology,
grooming sequences, revision patterns), never diagnosed in persons;
and every subject-implicating finding carries its innocent reading,
required, or it does not save.

**Standards.** Fully codified as `docs/CRIMINOLOGY_DESIGN.md`'s six
rules (structure not intent; evidence-bound; baseline→deviation;
role-typed and symmetric; sequences first-class; falsifiability via
the required counter-note) and the canon-cited maneuver taxonomy.
That document governs.

**Failure mode.** Two, paired: tunnel vision (the case that builds
itself) — countered by the analysis standards (§6: the same evidence
scored against the innocent hypothesis); and pathologizing dissent
(concept creep until every disagreement is a maneuver) — countered by
the chain requirement and the civil-liberties standards (§11:
disagreement is not a disorder).

**Status.** Codified: `docs/CRIMINOLOGY_DESIGN.md`; implemented in
`src/shared/forensic-taxonomy.js`, `forensic-corpus.js` (the
intent-word red line and counter-note validator), `forensic-model.js`
(kind 30062).

## §6. Intelligence analysis (`analysis`)

**The question.** How did the best analyst of all time keep the
conclusion from arriving before the analysis?

**First principles.** Bias is beaten by procedure, not sincerity:
enumerate the competing hypotheses first, then score each piece of
evidence against *all* of them — evidence consistent with your
favorite is usually consistent with the others too. The map never
declares a winner; fused scores are where politicization enters.
Structural counts (what supports what, what depends on what) are
measurements; fused probabilities are not.

**Standards.** Fully codified as `docs/HYPOTHESIS_MAP_DESIGN.md` (no
fused score, both-sides edges, coverage gaps named) and
`docs/COUNTERFACTUAL_DESIGN.md` (counts with derivations, never
probabilities). Those documents govern.

**Failure mode.** Agnostic drift — the matrix that never concludes —
countered by the adjudication standards (§4: what is adjudicable
eventually reaches the bench); and mirror-imaging, countered by the
translation standards (§14: model the actor in the actor's own frame).

**Status.** Codified; implemented in `src/shared/hypothesis-map.js`,
`corpus-prompts.js` (the four synthesis passes),
`case-counterfactual.js` — with the no-numeric-slot grep guards as
enforcement.

## §7. Forensic accounting (`accounting`)

**The question.** How did the best forensic accountant of all time
prove where the money actually went — and who bears the loss that
someone else booked as gain?

**First principles.** Money claims are checkable precisely because
money is conserved: every flow has two sides (double-entry is
symmetric accounting at the origin), so every monetary claim resolves
to a ledger, a unit, a baseline, and a counterparty — or it is
rhetoric. Debasement of the unit of account is the oldest documented
fraud (dishonest weights), and it is exposed by accounting, not by
enrolling in an economic school. Anomaly is not fraud: base rates come
before accusations.

**Standards.**

1. Every monetary claim carries unit, baseline, deflator, and time
   window — nominal/real conflation is itself a finding.
2. Follow the flow to a counterparty: "costs X" is incomplete until
   "paid to whom" is answered or declared unknowable.
3. No school-of-thought enrollment — measure every camp's sacred cows
   symmetrically (P5 applied to economics; the project's inflation
   mandate is prosecuted under these standards, never assumed by
   them).
4. Anomaly-to-accusation requires a base rate: how often does this
   pattern occur absent fraud?
5. Structure, not intent: name mechanisms of transfer, never guilt —
   guilt is the adjudication discipline's, and only for adjudicable
   propositions.

**Failure mode.** Fraud-everywhere — every anomaly a crime — and its
motivated twin, accounting bent to a prior (the inflation mandate is
precisely where the temptation lives; standard 3 exists for it).
Countered by the adversarial standards (§10: the innocent read of the
same books, required) and the forecasting standards (§9: base rates).

**Status.** **Gap** — nothing enforces this discipline yet. The
specification when built (§17 seed 1): a `money/*` maneuver family in
`forensic-taxonomy.js` (candidates: nominal-real-conflation,
shifted-baseline, cherry-picked-window, denominator-swap,
hidden-counterparty, unit-debasement), deepened Number Hygiene rules
in the audit's dimension 3, and a follow-the-money map on the
claim-links proposal rails — proposals only, human-accepted, no
numeric slot.

## §8. Historiography (`historiography`)

**The question.** How did the best historian of all time reconstruct
what a record establishes — and refuse to say more?

**First principles.** Source criticism is the discipline: who wrote
this, when, from what vantage, copied from whom, surviving through
whose hands. Provenance is authenticated before content is weighed
(the lineage that leads to content-addressing). The record is a sample
of the past, not the past — so the account attributes in the prose,
preserves contradictions side by side, and marks its gaps instead of
smoothing them.

**Standards.**

1. No outside knowledge: what the corpus does not establish goes in
   the gaps list, not on the page.
2. Attribute in the prose ("according to X") — the account reports; it
   never asserts contested things in its own voice.
3. Contradictory sources render side by side, never sanded into one
   story.
4. Citations are verbatim and machine-checked; unlocatable quotes are
   dropped and flagged.
5. Judge an era's texts by their own context before the present's
   frame (presentism is a named maneuver in the forensic taxonomy —
   the disciplines convict their own failures).

**Failure mode.** Presentism and narrative smoothing. Countered by
standard 5 plus the archival standards (§12: the hash-anchored record
resists the smoothing hand).

**Status.** Partial — standards 1–4 are enforced for entity pages
(`src/shared/entity-page.js` prompt + validator, grounded citations,
the gaps field); standard 5 binds as authoring discipline.

## §9. Statistics & forecasting (`forecasting`)

**The question.** How did the best forecaster of all time earn the
right to a probability?

**First principles.** A probability is legitimate only under a scoring
rule that punishes it when wrong — honesty must be the optimal
strategy. Calibration is a skill built by feedback: predicted
frequencies checked against resolved outcomes. A multi-year resolved
ledger is the one credential that cannot be faked — and time is the
one dimension where the outsider holds exactly the same information as
the insider. Small samples shrink toward the population; a three-item
mean is never a reputation.

**Standards.**

1. Predictions are logged at extraction with hedge level, horizon, and
   resolution criteria — and never scored at extraction.
2. Resolutions are evidence-bound and disputable like everything else.
3. Calibration is computed from *resolved* predictions only, and
   applies to the system's own confidences as much as any subject's.
4. Confident-wrong costs more than hedged-wrong; confident-right earns
   more than hedged-right (P7).
5. Shrinkage for small samples, factor published; every point estimate
   carries its spread (CONSTITUTION Art. 5).

**Failure mode.** False precision — the 73.4% that launders judgment
into arithmetic. Countered by the adjudication spine (§4: states, not
scores; derivation or absence) and Art. 5's license conditions.

**Status.** Partial — extraction and the ledger kinds (30058/30059)
ship; Brier calibration is specified and logged but **not activated**
(`src/shared/audit/calibration.js`) — activation is §17 seed 4.

## §10. Adversarial practice (`adversarial`)

**The question.** What did every institution that deleted its devil's
advocate learn the hard way?

**First principles.** Unopposed cases rot. The one documented natural
experiment is stark: the church abolished its own devil's-advocate
office in 1983, and canonizations proceeded at roughly twenty times
the historical rate. Dissent must therefore be a *slot that cannot be
left empty* — a structural requirement, not a hoped-for virtue — and
it targets claims, never persons: the counter-read defends the subject
against the finding.

**Standards.**

1. Every subject-implicating finding carries a counter-read written as
   a defense, not a strawman; a weak counter-read voids the finding.
2. The strongest version of the opposing position is stated before
   concluding against it (the steelman rule, scored as a dimension in
   opinion audits).
3. Challenges require evidence — quotes or verifiable references — or
   they are returned, not adjudicated.
4. Rejected disputes remain visible forever: what was challenged and
   survived is part of the record's credibility.
5. The adversarial process must sometimes change outcomes — an
   adversarial step that never rejects anything is decoration, and its
   rejection rate is a checkable fact.

**Failure mode.** Contrarian nihilism and manufactured doubt — doubt
as identity, or doubt as industry (the taxonomy's own
`defense/manufactured-doubt`). Countered by the forecasting standards
(§9: doubt pays rent against resolved ledgers) and the adjudication
standards (§4: "contested" has evidence requirements).

**Status.** Partial — standards 1, 3, and 4 are enforced (the
counter-note validator in `src/shared/forensic-corpus.js`; dispute
kind 30061; permanent dispute records); 2 is enforced in the lens and
opinion-audit prompts; 5 binds as a review discipline.

## §11. Civil liberties (`speech`)

**The question.** How did the best rights lawyer of all time defeat
lies without handing anyone the power to define them?

**First principles.** The remedy for false speech is more speech, not
enforced silence — because the power to delete lies is the power to
delete truths, and it always changes hands. The liar keeps the right
to speak after the lie is convicted: the record convicts; the person
still speaks. Honest error is not malice, and the process that exposes
must not itself chill: sources and the vulnerable get minimization;
living persons get published positions only, never inferred motive.

**Standards.**

1. Exposure, never deletion: no feature of the system removes speech;
   every remedy is more, better-anchored speech (CONSTITUTION Art. 3).
2. Good-faith-wrong is never treated as bad-faith.
3. Living persons: published positions only — no inferred private
   belief, motive, or character.
4. Sources and survivors get minimization: capture what the finding
   needs, not what the archive can hold.
5. The chilling-effect test is applied to every new judgment surface
   before it ships: who stops speaking if this exists?

**Failure mode.** Both-sidesism — neutrality theater that hands the
megaphone its own defense. Countered by the journalism standards (§2:
false balance is itself an asymmetry finding — symmetry of standards,
not of conclusions).

**Status.** Partial — standards 1–3 are enforced (append-only
supersession; the defamation firewall in
`docs/TRUTH_ADJUDICATION_DESIGN.md`; the living-person guardrail in
`src/shared/lens-prompt.js`); 4 is a seed (§17); 5 binds as a design
discipline.

## §12. Archival science (`archival`)

**The question.** How did the best archivist of all time keep a record
alive longer than everyone who wanted it gone?

**First principles.** The artifact's identity is its content, not its
address — a stealth edit is a new artifact, and the diff is
information. Preservation is redundancy plus verifiability (many
copies, each checkable). Capture must be judgment-free: the clerk
records verbatim and proposes; the moment capture editorializes,
curation becomes censorship with clean hands. And an archive is for
use — retention without findability is hoarding.

**Standards.**

1. Content addressing: the hash of the text is the identity; the URL
   is metadata; every audit and judgment anchors to the hash.
2. Append-only semantics everywhere: supersession links, never
   update-in-place.
3. Capture is judgment-free and verbatim-anchored; extraction
   proposes, never judges, links, or assesses.
4. Vocabulary changes are additive and test-pinned; wire values never
   rename.
5. Durability is multi-relay redundancy plus bundled signed JSON — no
   single archive, including the operator's, is the authority.

**Failure mode.** The landfill and its mirror — hoarding everything
and serving nothing, or curating so tastefully the archive becomes an
editorial line no one voted on. Countered by standard 3 and the
civil-liberties minimization standard (§11, standard 4).

**Status.** Partial — standards 1, 2, 3, and 5 are enforced
(`src/shared/archive-cache.js`, `audit/article-hash.js`, the capture
assistant's never-judges rule in `llm-prompts.js`, supersession
semantics project-wide); 4 is enforced per-taxonomy by
exhaustive-enum tests.

## §13. Cryptographic verification (`verification`)

**The question.** How does a stranger verify the record without
trusting anyone — including us?

**First principles.** Security must not depend on the design being
secret (the Kerckhoffs rule — the ancestor of published methodology).
Signatures prove authorship, not honesty; hashes prove integrity, not
truth; one keypair is not one human — so the mathematics authenticates
the *record* while judgment stays human, and every consensus-shaped
claim carries the Sybil caveat until the input set is roster-scoped or
history-costly.

**Standards.** Codified in `docs/NIP_DRAFT.md` and the constitution's
wire covenant (Art. 10): sign locally by default, keys never leave the
user's custody; everything published verifiable by a stranger from
public materials; a signature is never rendered as an endorsement of
truth; decentralized publication preferred — no architecture that
requires the operator to stay honest, present, or alive.

**Failure mode.** Trustless utopianism — believing the protocol
replaces judgment; Sybil blindness. Countered by the citizen-judgment
standards (§15: every incorporation is human-accepted) and the
never-count-open-sets rule (`docs/TRUTH_SYSTEMS.md` S-2 and §3.3,
constraint 5).

**Status.** Codified; implemented in `src/shared/crypto.js` (BIP-340
tested against the reference vectors), `signer.js`,
`nostr-client.js` (verify-on-ingest at the single choke point), the
identity layer.

## §14. Translation & rhetoric (`translation`)

**The question.** How did the best translator of all time make truth
receivable by the people who most needed it — without bending it?

**First principles.** You cannot persuade a mind you cannot model: the
first act is reconstruction — how does this perspective read this
claim, in its own voice, on its own authorities? (The
ideological-Turing-test standard: a reading its own adherents would
accept as fair.) The second act is exposition: rhetoric in service of
accuracy, never the reverse — a persuasive rendering that shades the
finding is propaganda and is discarded. Truth that loses the
persuasion war fails in the world, and the fault is the teacher's.

**Standards.** The inbound half is fully codified as
`docs/MORAL_LENS_JURISDICTION_DESIGN.md` (the perspective's voice,
never the tool's; ground-in-corpus; steelman; encoded pluralism; never
a truth ruling). The outbound line is `docs/TRUTH_SYSTEMS.md` H-7 on
its adoption: legibility, translation, teaching, and calibrated
presentation are in scope; optimizing a message for belief-change is
not.

**Failure mode.** Propaganda (outbound: persuasion outrunning
evidence) and ventriloquism (inbound: the caricature wearing the
costume of empathy). Countered by the science standards (§3: accuracy
is the license) and the historiography standards (§8: the
reconstruction must trace to the tradition's actual corpus).

**Status.** Codified (inbound): `src/shared/lens-prompt.js`,
`lens-engine.js`, `jurisdiction-model.js`. Outbound persuasion mode is
a seed (§17).

## §15. Citizen judgment (`citizen-judgment`)

**The question.** Why does every durable truth system leave the last
word with ordinary people — and how do the good ones keep that from
becoming a mob?

**First principles.** Consensus that excludes non-experts is a
priesthood, and priesthoods fail — legitimacy requires that ordinary
people can follow the reasoning and render their own judgment. Many
independent lay judgments beat one expert *only when the errors are
uncorrelated* (Condorcet's condition — which is also the brigading
warning), so the individual judgment must stay individual: recorded as
one person's stance, never absorbed into a crowd number, and every
machine or network suggestion passes a human hand before it becomes
record.

**Standards.**

1. Every incoming suggestion — model or network — is a proposal until
   a human accepts it; rendering never writes.
2. The stance is personal and stays personal: assessments are the
   reader's own, never averaged into a truth-signal; foreign judgments
   render side by side, never merged.
3. One accept per artifact — bulk credulity is not review.
4. Declining persists; a declined proposal never nags again.
5. No one republishes another's work as their own.

**Failure mode.** The mob verdict — vibes as verdicts, correlated
error, certainty borrowed from the crowd. Countered by the
adjudication standards (§4: standards of proof stand between stance
and verdict) and the verification standards (§13: a thousand keys are
not a thousand citizens).

**Status.** Partial — standards 1–5 are enforced across
`src/shared/assessment-model.js` (kind 30054), `incorporation.js`,
`review-queue.js`, `llm-proposals.js`, and the network feed; "partial"
only because the discipline's standards live in scattered design docs
rather than one statute.

## §16. Operator accountability (`operator`)

**The question.** What keeps the person running the tool honest —
without gating the pursuit of truth?

**First principles.** The operator is the first threat model (every
surveyed system's terminal failure is self-exemption), so the
standards bind the operator at the strictest degree — but as
accountability on the *published record*, never as pre-publication
gates: a gate heavy enough to matter would stop meaningful truth
pursuit; a gate light enough not to matter is theater.
Self-examination is by instrument, later and on the record — the moral
lens applied to the operator's own corpus, and the same words-vs-deeds
machinery every subject faces.

**Standards.** Codified as CONSTITUTION Art. 8: disclosure attaches to
publishes (never blocks them); corrections at operator grade; no
operator special-casing in code (guard-tested); ties resolve against
the operator; the same instruments run on the operator's record as on
anyone's; operator-facing safeguards are advisory, never blocking,
with declines recorded.

**Failure mode.** Self-exemption by a thousand small asymmetries —
countered by the journalism discipline's symmetry test run on the
operator's own camp (§2; P5's "periodically uncomfortable for every
camp") and by the network: outsiders' judgments of the operator's
events, surfaced unfiltered.

**Status.** Codified (Art. 8); the advisory surfaces are seeds (§17):
the tone advisory (`respectGate` — v0 is the existing intent-word red
line in `src/shared/forensic-corpus.js` pointed inward, no model
call), the disclosure record, the About-Me view, the self-corrections
log.

---

## §17. Gaps and seeds, ranked

1. **Forensic accounting** (§7) — the one full **gap**: the `money/*`
   maneuver family, Number Hygiene deepening, the follow-the-money
   map. Mandate-central.
2. **Respect gate v0** (§16) — the advisory tone pass over
   operator-authored text; deterministic, nearly free.
3. **About-Me view + self-corrections log** (§16) — composes the
   network client and the supersession chains; P8/P10 rendered.
4. **Calibration activation** (§9) — Brier is specified and logged;
   the cheapest seed on the list.
5. **Outbound persuasion mode** (§14) — reverse-lens exposition of a
   finding for a named jurisdiction; derived-only, no wire kind.
6. **Minimization pass** (§11) — living-person and survivor redaction
   advisory at capture and publish time.
7. **Structured tier-derivation notes** (§3) — evidence tiers state
   their downgrade reasons like every other derived value.

The broader cross-system gap registry (right-of-reply,
notice-disclosure, adversarial collaboration, the symmetry self-test
corpus, and the rest) lives in `docs/TRUTH_SYSTEMS.md` §2.

---

## Amendment log

**v1.0.0 — 2026-07-22.** Initial derivation. Fifteen disciplines
indexed; standards derived for the uncodified ones; failure modes
named with their countervailing standards; the accounting gap
specified; seeds ranked. Reworked pre-adoption on maintainer review
from a "college of personas" draft: the idealized-practitioner
question is elicitation scaffolding (the §0 method — how PHILOSOPHY.md
was actually derived), never the deliverable. The deliverable is the
standards.

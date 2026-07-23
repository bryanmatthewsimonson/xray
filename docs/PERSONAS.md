# The College of Personas — the offices X-Ray answers to

**Document version:** 1.0.0
**Status:** Normative for office boundaries, the check-graph, and the
operator covenant; descriptive for code seats
**Governed by:** `docs/CONSTITUTION.md` (Art. 9) — enters the Concord
Schedule as an organic statute on adoption
**Date:** 2026-07-22

Amendments follow the constitution's Art. 13 (Tier 2 for this
document's normative sections). Silent edits are void — a college that
rewrites its own charters quietly has already failed its first office.

---

## §0. The founding observation

X-Ray's best feature was born from a persona prompt: *pretend you are a
bigshot editor of the most prestigious news organization of all time —
how did you do it?* The answer became the Phase-13 epistemic auditor
and its constitution. The lesson, generalized here: an idealized
**office** — not a person; an office at its best across all time — is
simultaneously (a) a standard the project measures itself against,
(b) a prompt-engineering asset, and (c) a jurisdiction with borders.

The codebase is already a de facto college — eight prompt files speak
in "You are …" voices, five never-merge judgment families each carry
their own form of judgment, counter-reads are mandatory. This document
names the offices, assigns every judgment family exactly one owner,
gives every office a known occupational disease and a named checker,
and binds the operator first.

Each office states its charge universally and credits its traditions
by name — scripture, science, law, and craft together, as exemplars
among exemplars (CONSTITUTION Amendment log, register decision
2026-07-22). The standing texts of the whole college: Matthew 7:1–5
(the plank comes out first); Proverbs 18:17 ("the one who states his
case first seems right, until the other comes and examines him" — the
whole adversarial architecture in one verse); Zechariah 8:16 (public
judgment, true, aimed at peace); 1 Thessalonians 5:21 ("test
everything; hold fast what is good"); and the maintainer's own credo:
truth can only destroy that which should have never existed.

## §1. The roster

Eighteen offices. The table is machine-parsed by
`tests/personas.test.mjs`: slugs are unique, every checker is a roster
slug (`network` is the one extra-collegial checker, by design), every
office checks at least one other, no office checks itself, and every
non-"not yet" seat path exists on disk.

| § | Office | Slug | Judgment family owned | Occupational disease | Checked by | Seat |
|---|---|---|---|---|---|---|
| §3 | Editor-in-Chief | `editor` | epistemic audits (30056–30061) | metric worship | `ombudsman`, `forecaster` | `src/shared/audit/` |
| §4 | Scientist | `scientist` | falsifiability discipline (cross-cutting) | scientism | `historian`, `juror` | `src/shared/quote-grounding.js` |
| §5 | Judge | `judge` | verdicts + integrity (30063/30064) | verdict hunger | `juror`, `counsel` | `src/shared/truth-taxonomy.js` |
| §6 | Detective | `detective` | forensic findings (30062, the chain) | tunnel vision | `analyst`, `advocate` | `src/shared/forensic-corpus.js` |
| §7 | Analyst | `analyst` | synthesis, hypotheses, counterfactuals | agnostic drift | `judge`, `forecaster` | `src/shared/corpus-prompts.js` |
| §8 | Forensic Accountant | `accountant` | money-flow findings | fraud-everywhere | `advocate`, `forecaster` | not yet |
| §9 | Psychologist of Manipulation | `psychologist` | the maneuver vocabulary | pathologizing dissent | `detective`, `counsel` | `src/shared/forensic-taxonomy.js` |
| §10 | Confessor | `confessor` | the operator's plank | cheap grace | `archivist`, `psychologist` | not yet |
| §11 | Historian | `historian` | provenance, entity pages | presentism | `translator`, `archivist` | `src/shared/entity-page.js` |
| §12 | Statistician-Forecaster | `forecaster` | prediction ledger, calibration | false precision | `judge`, `juror` | `src/shared/audit/calibration.js` |
| §13 | Devil's Advocate | `advocate` | counter-reads, disputes (30061) | contrarian nihilism | `forecaster`, `judge`, `peacemaker` | `src/shared/forensic-corpus.js` |
| §14 | Civil-Liberties Lawyer | `counsel` | speech, sources, the firewalls | both-sidesism | `confessor`, `editor` | `src/shared/truth-taxonomy.js` |
| §15 | Peacemaker | `peacemaker` | the operator's tone | false peace | `editor`, `psychologist` | not yet |
| §16 | Ombudsman | `ombudsman` | auditing the auditors (P10) | capture | `juror`, `network` | `src/shared/event-journal.js` |
| §17 | Archivist-Librarian | `archivist` | capture, preservation, vocabulary | hoarding | `translator`, `counsel` | `src/shared/archive-cache.js` |
| §18 | Cryptographer | `cryptographer` | keys, signatures, relays | trustless utopianism | `juror`, `accountant` | `src/shared/crypto.js` |
| §19 | Teacher-Translator | `translator` | lens readings, exposition | propaganda | `scientist`, `historian` | `src/shared/lens-prompt.js` |
| §20 | Juror | `juror` | assessments (30054), human-accept seams | mob verdict | `judge`, `cryptographer` | `src/shared/assessment-model.js` |

## §2. The template

Every office section carries exactly these fields, in this order —
pinned by the guard test:

- **The Question** — the single question the office exists to answer.
- **Charge** — the idealized office, stated universally.
- **Traditions & exemplars** — named lineages, scripture and science
  together.
- **Non-negotiables** — hard rules, agreeing with what the validators
  already enforce where the office has a code seat.
- **Occupational disease** — the failure mode this office reliably
  develops, and **Checked by:** the offices that check it, with the
  mechanism.
- **Seat in X-Ray** — where it lives in code, or "not yet" plus its
  roadmap seed.

---

## §3. The Office of the Editor-in-Chief (`editor`)

**The Question.** How well was this artifact made — and what does its
surface reveal about the process behind it?

**Charge.** The best editor of all time and eternity is not the one
with the best access; it is the one who needed none. This office reads
fingerprints: headline against body, verb against verb, number against
denominator, source against attribution. It grades craft, never truth,
and it publishes its method before its findings.

**Traditions & exemplars.** I. F. Stone, patron of the outsider
stance — barred from the press conferences, he beat the insiders using
only public documents, which is exactly X-Ray's position. A. J.
Liebling and George Seldes (the press criticized in public); Katharine
Graham and Harold Evans (the spine to publish against pressure); the
great standards desks. The watchman of Ezekiel 33: the office is
defined by the duty to warn, and the guilt of silence.

**Non-negotiables.** (1) No finding without a verbatim quote (P3).
(2) Identical standards regardless of valence (P5) — the scoreboard
must periodically discomfort every camp, including the operator's.
(3) Craft is not truth: the 0–100 audit score is a licensed estimation
(CONSTITUTION Art. 5.3), never a verdict. (4) Score what was
published, not the charitable rewrite (P4). (5) Every module states
what it could not determine.

**Occupational disease.** In the wild, access bias — cured here
structurally by the outsider stance. Its residual form: **metric
worship** — Goodharting surface dimensions until the score *feels*
like truth. **Checked by:** `ombudsman` (P10 — the auditor audited
harder, corrections at greater prominence) and `forecaster` (the
auditor's own confidence values are calibration-scored).

**Seat in X-Ray.** `src/shared/audit/` — the orchestrator persona in
`audit-prompt.js` and the eight module personas in
`module-prompts.js`; governed by `docs/PHILOSOPHY.md`. The one office
whose charter is already fully written: this document cites it rather
than restating it.

## §4. The Office of the Scientist (`scientist`)

**The Question.** What would make this false — and has anyone honestly
looked?

**Charge.** The Scientist's oath is Feynman's: the first principle is
that you must not fool yourself, and you are the easiest person to
fool. This office owns no wire kind; it owns a discipline that runs
through every other office — no claim without a stated defeater, no
pattern without counter-indicators, no quote a machine cannot locate.
It also holds the evidence-hierarchy strand: not all evidence is
equal, and the ranking is itself public and argued.

**Traditions & exemplars.** Popper (falsifiability), Feynman
(cargo-cult science), Semmelweis (right against consensus, and the
cost of being unpersuasive — the bridge to the Teacher), Cochrane and
Sackett (evidence-based medicine), Ioannidis (the field auditing
itself). Thomas, whose demand for evidence was met with wounds, not
shame (John 20); Elijah at Carmel — a designed, discriminating
experiment between live hypotheses (1 Kings 18); Gideon's fleece, run
twice with conditions reversed — a control (Judges 6).

**Non-negotiables.** (1) Every finding-type ships with
counter-indicators — "what would make this NOT this" is always on the
page. (2) Unfalsifiable framings are named, not scored. (3) Anchors
are machine-checked; altered quotes are discarded, not corrected.
(4) Negative results and empty finding lists are first-class outputs.
(5) The hierarchy of evidence is declared before the evidence is
weighed.

**Occupational disease.** **Scientism** — demanding RCTs of history,
treating value questions as pending lab results, mistaking "not yet
measured" for "not real." **Checked by:** `historian` (rigorous
knowledge exists without experiments — source criticism is a method,
not a weakness) and `juror` (lived, testimonial knowledge is
admissible evidence, not noise).

**Seat in X-Ray.** `src/shared/quote-grounding.js` (the machine-check
on every quote), the counter-indicator requirement in
`forensic-taxonomy.js`, the mandatory `counter_note` — cross-cutting
by design.

## §5. The Office of the Judge (`judge`)

**The Question.** Is this proposition established — under which
standard of proof, on what evidence, with what caveats?

**Charge.** The Judge adjudicates propositions, never people; renders
states, never scores; and treats "unresolved" as a complete, honorable
verdict. The office's deepest rule is Learned Hand's: the spirit of
liberty is the spirit which is not too sure that it is right — a
verdict is a description of where the evidence stands, on a declared
standard, forever open to supersession.

**Traditions & exemplars.** The common law (due process, audi alteram
partem, Blackstone's ratio), Learned Hand, Cardozo; the rabbinic
court's two-witness discipline. Solomon, whose sword produced evidence
rather than a preference (1 Kings 3); Deuteronomy 1:16–17 ("hear the
small and the great alike; you shall not be partial"); Deuteronomy
19:15 (two or three witnesses); Proverbs 18:17 as the standing brief.

**Non-negotiables.** (1) The §3.1 firewall — interpretations and
values are never adjudicated true/false; only event-facts,
state-facts, predictions, and stated commitments are adjudicable.
(2) The standard of proof is declared before the evidence is weighed.
(3) Verdicts are the five descriptive states, never a percentage — a
proposition is not 73% true. (4) Good-faith-wrong is not bad-faith
(the defamation firewall). (5) Every number in evidence shows its
derivation or does not appear (CONSTITUTION Art. 5.1).

**Occupational disease.** **Proceduralism and verdict hunger** —
process as fetish; forcing resolution where the evidence will not bear
it. **Checked by:** `juror` (justice ordinary people cannot follow has
failed — legitimacy is lay-legible) and `counsel` (the firewall is
patrolled from outside the courtroom).

**Seat in X-Ray.** `src/shared/truth-taxonomy.js` (verdict states,
standards of proof, the firewall predicates),
`truth-adjudication-model.js`, `adjudicate-modal.js`,
`truth-builders.js` — `docs/TRUTH_ADJUDICATION_DESIGN.md` is this
office's statute.

## §6. The Office of the Detective (`detective`)

**The Question.** What is this actor doing to the conversation — shown
by an evidence chain, readable two ways?

**Charge.** The Detective builds chains, not stories: anchor by
anchor, source by source, each link machine-checked, each pattern
published with its innocent reading attached. The office's founding
humility: the investigator's confidence is the least reliable
instrument in the room — hence the chain, the counter-read, and the
cap.

**Traditions & exemplars.** Locard (every contact leaves a trace —
sloppy or motivated text leaves fingerprints), the statement-analysis
tradition, the PEACE interview model (non-coercive, evidence-led), and
the wrongful-conviction literature as the office's own case file of
its disease. Doyle's dictum: it is a capital mistake to theorize
before one has data. Daniel in the trial of Susanna — separate the
witnesses, cross-examine independently, and the contradiction acquits.
Proximate inspiration, credited in `docs/CRIMINOLOGY_DESIGN.md`: the
forensic-criminology framing.

**Non-negotiables.** (1) Structure, not intent — no lying, motive, or
state-of-mind field exists, and none is smuggled into notes. (2) Every
anchor is verbatim and machine-grounded; altered evidence is
discarded. (3) A pattern needs a chain — prefer two or more sources.
(4) The counter-read is written as if defending the subject; a
strawman counter-read voids the finding. (5) Fewer, better-evidenced
findings beat many speculative ones.

**Occupational disease.** **Tunnel vision** — the case that builds
itself, evidence selected to fit the suspect. **Checked by:** `analyst`
(the same evidence must be scored against the innocent hypothesis —
structured analysis exists to break single-hypothesis lock-in) and
`advocate` (the mandatory counter-read is the Advocate stationed
inside the Detective's own paperwork).

**Seat in X-Ray.** `src/shared/forensic-corpus.js` (the prompt, the
intent-word red line, the validator), `forensic-model.js`,
`forensic-publish.js` (kind 30062). Co-jurisdiction with the
Psychologist: the Detective owns the chain discipline; the
Psychologist owns the vocabulary.

## §7. The Office of the Analyst (`analyst`)

**The Question.** Which hypotheses are live, and what does each piece
of evidence do to each of them?

**Charge.** The Analyst is the cartographer of arguments: positions
attributed, cruxes side by side, claims wired to hypotheses on both
sides, structural dependencies counted. The originating insight
(Heuer): bias is beaten by procedure, not sincerity — enumerate the
hypotheses first, then let evidence discriminate, and never let the
map declare a winner.

**Traditions & exemplars.** Richards Heuer (the analysis of competing
hypotheses — the hypothesis map's parent tradition), Sherman Kent
(estimative discipline — the shared border with the Forecaster), the
red-team tradition, Robert Jervis (the honest postmortem). The twelve
spies (Numbers 13–14): identical evidence, majority and minority
reports, both preserved — and the majority was wrong. Disagreement is
data, and the record must carry the dissent.

**Non-negotiables.** (1) Never declare which hypothesis is right, rank
them, or attach strength in any form — the tool schemas carry no
numeric slot, by grep-guarded construction. (2) Propose edges for
every hypothesis, on both sides; a hypothesis with only unexamined
support is a coverage gap, not a winner. (3) Ids come only from the
supplied index, never invented. (4) Counterfactuals are counts, not
probabilities. (5) Coverage gaps are named — absence of evidence is a
property of the corpus, not of the world.

**Occupational disease.** **Agnostic drift and mirror-imaging** — the
matrix that never concludes, and the analyst who models every actor as
reasoning like the analyst. **Checked by:** `judge` (what is
adjudicable must eventually reach the bench rather than circling the
map forever) and `forecaster` (base rates discipline the hypothesis
space).

**Seat in X-Ray.** `src/shared/corpus-prompts.js` (the four synthesis
roles), `hypothesis-map.js`, `hypothesis-suggest.js`,
`case-counterfactual.js`.

## §8. The Office of the Forensic Accountant (`accountant`)

**The Question.** Where did the money actually go — and who bears the
loss that someone else booked as gain?

**Charge.** The best forensic accountant of all time and eternity
follows flows, not rhetoric: every claim about money resolves to a
ledger, a unit, a baseline, and a counterparty. This office holds the
project's inflation mandate in its measured form — debasement of the
unit of account is the oldest documented fraud, dishonest weights, and
it is exposed by accounting, not by enrolling in an economic school.
The office measures who receives new money first and who holds the bag
last, and publishes the derivation of every number.

**Traditions & exemplars.** Pacioli (double-entry — every flow has two
sides; symmetric accounting at the origin), Cressey (the fraud
triangle — and the lineage matters: the neutralization theory already
in the forensic taxonomy descends from Cressey's rationalization work;
the college's families are cousins), Frank Wilson (took down Capone
with ledgers when bullets could not), Markopolos (the Madoff memos —
right, documented, and ignored: being correct is not enough, the
bridge to the Teacher), Cantillon (who gets the new money first).
Proverbs 11:1 and Amos 8:5 — "a false balance is an abomination";
"making the ephah small and the shekel great" is monetary debasement
in its oldest recorded form. Zacchaeus: fourfold restitution as the
restoration end-state (the Confessor's border).

**Non-negotiables.** (1) Every monetary claim carries unit, baseline,
deflator, and time window — nominal/real conflation is a finding.
(2) Follow the flow to a counterparty: "costs X" is incomplete until
"paid to whom" is answered or declared unknowable. (3) No
school-of-thought enrollment — the office measures every camp's sacred
cows symmetrically (P5 applied to economics). (4) Anomaly is not
fraud: base rates before accusations. (5) Structure, not intent — the
office names mechanisms of transfer, never guilt.

**Occupational disease.** **Fraud-everywhere** — every anomaly a
crime, every ledger a conspiracy; and its motivated twin, accounting
bent to a prior (the inflation mandate is precisely where this office
will be tempted). **Checked by:** `advocate` (the innocent read of the
same books, mandatory) and `forecaster` (anomaly base rates — how
often does this pattern occur absent fraud?).

**Seat in X-Ray.** Not yet. Roadmap seed (§25): a `money/*` maneuver
family in `forensic-taxonomy.js`, deepened Number Hygiene rules in the
audit's dimension 3, and a follow-the-money map on the claim-links
proposal rails — proposals only, human-accepted, no numeric slot.

## §9. The Office of the Psychologist of Manipulation (`psychologist`)

**The Question.** What influence technique is this text performing —
named from the canon, never diagnosed in a person?

**Charge.** This office curates the vocabulary of manipulation —
thought reform, DARVO, neutralization, grooming sequences, agnotology
— so that gaslighting becomes legible: nameable, citable, checkable.
It is central to the mandate because manipulation that cannot be named
cannot be answered. Its iron rule: it names maneuvers in texts, never
disorders in people — the taxonomy is a microscope for structure, not
a couch for defendants.

**Traditions & exemplars.** Lifton (the eight criteria of thought
reform), Freyd (DARVO, institutional betrayal), Singer (cults in our
midst), Sykes & Matza (techniques of neutralization), Cialdini
(influence, mapped honestly — the same levers sell soap and
salvation), Proctor (agnotology — manufactured doubt as an industry).
Genesis 3 as the archetypal maneuver sequence — doubt-seeding ("did
God really say…?"), flat denial ("you will not surely die"), motive
reframing; Matthew 23 read as a taxonomy of religious manipulation
(loaded language, burdens bound on others); Mark 7:11 — a loaded term
that voids an obligation.

**Non-negotiables.** (1) Never diagnose persons — no clinical or
characterological labels on subjects, ever; maneuvers attach to
statements. (2) Every maneuver carries canon citation, definition,
indicators, and counter-indicators (test-pinned). (3) Side-neutral by
construction: every family is runnable against apologist and critic,
accuser and accused alike. (4) Sequences need their order: grooming
and narrative-patch findings require the ordered chain. (5) Vocabulary
growth is conservative: a new maneuver enters only with canon citation
and counter-indicators.

**Occupational disease.** **Pathologizing dissent** — concept creep
until every disagreement is DARVO and every strong argument is
"manipulation." **Checked by:** `detective` (no maneuver without the
concrete, machine-grounded chain) and `counsel` (disagreement is not a
disorder; vigorous speech is protected precisely when it is annoying).

**Seat in X-Ray.** `src/shared/forensic-taxonomy.js` (the six families
and the maneuver guide); `docs/CRIMINOLOGY_DESIGN.md` (the six rules).
Co-governs kind 30062 with the Detective.

## §10. The Office of the Confessor (`confessor`)

**The Question.** Have I taken the plank out of my own eye — and is
this exposure aimed at restoration?

**Charge.** The keystone office: it binds the operator, not the
subjects. Before any judgment leaves the gates, the Confessor asks the
Matthew 7 question in its original order — plank first, speck second —
and holds the telos: exposure aims at repentance, correction, and
restoration, never humiliation. Truth in service of love is not a
softening of the standard; it is the standard's license to exist. The
office also holds protection of the weakest: the strong absorb
scrutiny first.

**Traditions & exemplars.** The cure of souls; Augustine's
*Confessions* (the genre of public self-audit); Bonhoeffer (*Life
Together* — confession before the community; "cheap grace" is this
office's named disease); the Ignatian examen (a daily self-audit
liturgy — the direct ancestor of the operator ritual, §23); the
recovery movement's steps four through ten (searching moral inventory,
then amends). Nathan before David ("you are the man" — the courage to
confront power, 2 Samuel 12) and David's answer, Psalm 51: a king's
confession entered into the permanent public record. John 8 — neither
condemnation nor the pretense that nothing happened.

**Non-negotiables.** (1) The operator confesses before accusing:
subject-implicating publishes prompt the plank check, and skipping it
is itself recorded. (2) Exposure names its restoration path — what
correction would resolve this finding; a finding with no exit is a
weapon, not a standard. (3) Confession is an act, not a mood:
disclosures are written, dated, and attached. (4) Grace never edits
the record — forgiveness is a person's act; supersession-not-deletion
still holds. (5) The weakest party in any exposure gets the strongest
protection.

**Occupational disease.** **Cheap grace** — absolution as amnesty,
confession as ritual theater that launders continued behavior; and its
inverse, scrupulosity that paralyzes legitimate exposure. **Checked
by:** `archivist` (nothing is erased; a confession supersedes, never
deletes — the structural anti-cheap-grace) and `psychologist` (a
confession can itself be a maneuver — the taxonomy screens the
operator's own contrition for DARVO-shaped apology).

**Seat in X-Ray.** Not yet — this office **binds the operator**
(CONSTITUTION Art. 8). Roadmap seed (§23): the Plank Check and the
Exposure File.

## §11. The Office of the Historian (`historian`)

**The Question.** What does this record establish, on which sources,
of what provenance — and what does it not establish?

**Charge.** The Historian practices source criticism as a moral
discipline: who wrote this, when, from what vantage, copied from whom,
surviving through whose hands. In X-Ray, the office writes the
grounded encyclopedia — pages built strictly from the captured corpus,
attributed in the prose, silent where the corpus is silent.

**Traditions & exemplars.** Mabillon (diplomatics — the science of
authenticating documents; the spiritual ancestor of
content-addressing), Ranke (the sources as they are), Thucydides (the
method statement: checked reports, "not as the poets have sung"), Marc
Bloch (*The Historian's Craft*, written in the Resistance — source
criticism under fire). Luke 1:1–4 — "having carefully investigated
everything from the beginning… an orderly account… that you may know
the certainty"; the citation practice of Kings and Chronicles ("are
they not written in the book of the annals of…" — the ancient world's
source links).

**Non-negotiables.** (1) No outside knowledge — if the corpus does not
establish it, it goes in the gaps list, not on the page. (2) Attribute
in the prose — the page reports; it never asserts contested things in
its own voice. (3) Disputes render side by side, never resolved.
(4) Verbatim citations, machine-checked; unlocatable quotes are
dropped and flagged. (5) A short honest page beats a long padded one.

**Occupational disease.** **Presentism and narrative smoothing** —
judging the past by the present's frame (the taxonomy already names
`defense/presentism`: the college convicts its own offices' diseases),
and sanding contradictory sources into a clean story. **Checked by:**
`translator` (read an era through its own authorities before judging
it) and `archivist` (the hash-anchored record resists the smoothing
hand).

**Seat in X-Ray.** `src/shared/entity-page.js` (the
grounded-encyclopedia writer), `entity-dossier.js`, `dossier-time.js`;
provenance machinery in `url-identity.js` and the archive lineage.

## §12. The Office of the Statistician-Forecaster (`forecaster`)

**The Question.** How often is this class of claim right — and is this
claimant better calibrated than chance?

**Charge.** The licensed-estimation office: the only place in the
college where a probability may be uttered, and only under scoring
rules that punish it when it is wrong (CONSTITUTION Art. 5). Its long
game is the prediction ledger — the one dimension where the outsider
holds exactly the same information as the insider: time.

**Traditions & exemplars.** Brier (the scoring rule), Tetlock
(superforecasting; confident experts barely beat chance, and never
know it), Kahneman and Tversky (base rates, overconfidence), Kent
(words of estimative probability — "serious possibility" means
nothing until numbered), Graunt (the first mortality tables — counting
deaths honestly during plague). Joseph before Pharaoh (Genesis 41 — a
forecast with a horizon and a hedging policy: seven fat years stored
against seven lean); Luke 14:28 (count the cost before the tower);
James 4:13–15 (the mandatory hedge); Deuteronomy 18:22 — the prophet
whose prediction fails is thereby known false: a resolution ledger.

**Non-negotiables.** (1) Predictions are logged at extraction with
hedge level, horizon, and resolution criteria — and never scored at
extraction. (2) Resolutions are evidence-bound and disputable.
(3) Calibration is computed, published, and applied to the auditors
themselves. (4) Confident-wrong costs more than hedged-wrong (P7).
(5) Shrinkage for small samples, with the factor published — a
three-article mean is never a reputation.

**Occupational disease.** **False precision** — the 73.4% that
launders judgment into arithmetic; numbers as authority costumes.
**Checked by:** `judge` (the form-of-judgment spine: states, not
scores; derivation or absence) and `juror` (a number the reader cannot
re-derive is an assertion, not a measurement).

**Seat in X-Ray.** `src/shared/audit/calibration.js` (Brier —
specified and logged; activation is this office's cheapest seed),
prediction extraction in the audit's module 8, kinds 30058/30059.

## §13. The Office of the Devil's Advocate (`advocate`)

**The Question.** What is the strongest honest case that this finding
is wrong?

**Charge.** Institutionalized dissent: the college pays someone to
argue against itself, because unopposed cases rot. In X-Ray the
Advocate is not a person but a slot that cannot be left empty — the
required counter-note, the mandatory counter-indicators, the steelman
rule, the dispute kind. One boundary is load-bearing: this office
tests claims; it never accuses persons — the accusation of persons is
the office's inversion (Revelation 12:10 names "the accuser of the
brethren" as the enemy's job description), and the code draws the same
line: the counter-read defends the subject against the finding; it
never prosecutes anyone.

**Traditions & exemplars.** The Promotor Fidei — the church's own
devil's advocate (1587), whose 1983 abolition was followed by
canonizations at twenty times the historical rate: the institutional
cautionary tale of deleting dissent. Mill (*On Liberty* — he who knows
only his own side of the case knows little of that); the tenth-man
doctrine; the premortem. Abraham arguing over Sodom (Genesis 18 —
licensed dissent before the highest possible authority, welcomed by
it); Paul opposing Peter to his face, within the college (Galatians
2:11); Proverbs 18:17 as the standing brief.

**Non-negotiables.** (1) The counter-read is mandatory wherever a
finding implicates a subject — written as a defense, not a strawman; a
weak counter-read voids the finding. (2) Dissent targets findings and
claims, never persons. (3) Challenges require evidence or they are
returned, not adjudicated. (4) The record keeps the dissent: rejected
disputes remain visible; minority reports are preserved. (5) The
Advocate must sometimes win — an adversarial process that never
changes an outcome is decoration.

**Occupational disease.** **Contrarian nihilism** — doubt as identity;
and its industrial form, manufactured doubt (the taxonomy's own
`defense/manufactured-doubt`: this office's tool, weaponized).
**Checked by:** `forecaster` (doubt pays rent: resolved ledgers and
base rates close questions), `judge` ("contested" is a verdict state
with evidence requirements, not an escape hatch), and `peacemaker`
(dissent without contempt — the counter-read is screened for sneer;
mockery is not an argument).

**Seat in X-Ray.** The counter-note enforcement and validators in
`src/shared/forensic-corpus.js`; counter-indicators in
`forensic-taxonomy.js`; the steelman rule in `lens-prompt.js`; dispute
kind 30061.

## §14. The Office of the Civil-Liberties Lawyer (`counsel`)

**The Question.** Does this exposure leave everyone — including the
liar, the source, and the subject — with their rights intact?

**Charge.** The anti-censorship office: lies are abolished by
exposure, never deletion, and the liar keeps the right to speak,
because the alternative hands someone the power to define lying
(CONSTITUTION Art. 3). It holds three briefs at once: speech (even
despised speech), sources (shield and minimization — the
whistleblower's shepherd folded in here, as the press-freedom bar has
always held both briefs), and subjects (the defamation firewall:
good-faith-wrong is not bad-faith; living persons get
published-positions-only).

**Traditions & exemplars.** Brandeis's Whitney concurrence — the
remedy is more speech, not enforced silence: the
exposure-not-deletion doctrine verbatim; Holmes's Abrams dissent;
Milton's *Areopagitica* (let truth and falsehood grapple); Andrew
Hamilton and the Zenger jury; the actual-malice standard (the legal
form of good-faith-wrong-is-not-bad-faith); the shield-law tradition;
the principle that you defend the speech you despise or the principle
is a preference. Gamaliel (Acts 5 — "if this plan is of man, it will
fail; if of God, you cannot stop it": the canonical let-speech-run
argument, made inside a hostile council); Nicodemus (John 7:51 — does
our law judge a man without first hearing him?); Acts 25:16 (the
accused meets the accusers face to face).

**Non-negotiables.** (1) Exposure, never deletion: no feature removes
speech; every remedy is more, better-anchored speech. (2) The liar's
right to speak survives conviction of the lie — the record convicts;
the person still speaks. (3) Living persons: published positions only,
never inferred private belief, motive, or character. (4) Sources and
survivors get minimization: capture what the finding needs, not what
the archive can hold. (5) Good-faith-wrong is never treated as
bad-faith; the chilling-effect test is applied to every new judgment
surface before it ships.

**Occupational disease.** **Both-sidesism and process absolutism** —
neutrality theater that hands the megaphone its own defense while the
harmed drown. **Checked by:** `confessor` (protection of the weakest
outranks symmetry theater — the strong absorb scrutiny first) and
`editor` (false balance is itself an asymmetry finding: symmetry of
standards, not symmetry of conclusions).

**Seat in X-Ray.** `src/shared/truth-taxonomy.js` (the §3.1 firewall
predicates and the defamation firewall); the living-person guardrail
in `lens-prompt.js`; append-only supersession semantics everywhere
(P9). The minimization pass is a roadmap seed.

## §15. The Office of the Peacemaker (`peacemaker`)

**The Question.** Can this be said so that the person it is about
could hear it — without changing what it says?

**Charge.** The tone-safeguard the maintainer explicitly requested on
himself. The Peacemaker owns manner, never matter: it may soften a
sentence, steelman an opponent, or delay a send; it may never bury a
finding. Its charter contains its own disease warning, from the
office's greatest modern holder: the peace it seeks is never the
absence of tension but the presence of justice — and the project's
future vision (social media where respect is the default) is this
office's jurisdiction scaled up.

**Traditions & exemplars.** King (the Letter from Birmingham Jail —
the peacemaker's charter and the rebuke of false peace in one
document); Tutu (no reconciliation without truth — the ordering
matters); Zehr (restorative justice); Rosenberg (nonviolent
communication — observation before evaluation: structure-not-intent as
an interpersonal ethic); Fisher (separate the people from the
problem). Matthew 5:9; Abigail (1 Samuel 25 — intercepting David
mid-vendetta, armed and in the right and about to do the thing he
would regret: the exact respect-gate function, performed on the
operator); Jeremiah 6:14 as the disease text ("saying 'peace, peace,'
when there is no peace").

**Non-negotiables.** (1) Tone edits, never content edits — a
Peacemaker intervention preserves every finding, anchor, and caveat
intact. (2) Contempt is flagged wherever it appears — especially in
the operator's own drafts. (3) Steelman before send: the opponent's
position restated so they would sign it. (4) De-escalation never
delays a warning the watchman owes (Ezekiel 33 outranks comfort).
(5) Advisory, never blocking: the operator can always publish;
declining the counsel is logged, not punished.

**Occupational disease.** **False peace** — conflict-avoidance that
buries findings; harmony purchased with silence. **Checked by:**
`editor` (the finding publishes regardless; the watchman's duty is
non-negotiable) and `psychologist` (thought-terminating clichés —
"let's all calm down" — are in the taxonomy; the Peacemaker's own
language is screened by it).

**Seat in X-Ray.** Not yet — this office **binds the operator**
(CONSTITUTION Art. 8). Roadmap seed (§23): the Respect Gate, with a
deterministic v0 already latent in the codebase.

## §16. The Office of the Ombudsman (`ombudsman`)

**The Question.** Who audits the auditors — and did we correct
ourselves as loudly as we accused?

**Charge.** P10 personified: the auditor obeys its own standards,
applied harder. The Ombudsman receives complaints against the system,
publishes the system's corrections at greater prominence than its
accusations, maintains the exposure file of the operator's own
conflicts, and treats others' scores of the auditor as required
reading, not noise.

**Traditions & exemplars.** The Swedish Justitieombudsman (1809 — a
state officer whose jurisdiction is the state itself); inspectors
general; the newsroom public editors, and the cautionary tale of
abolishing the post — removing the office does not remove the need;
Juvenal's *quis custodiet ipsos custodes* as the standing question.
The covenant lawsuit of Micah 6 — the prophets as legal officers whose
client sues his own institution; John the Baptist auditing the head of
state at the cost of his head; Micah 6:8 as the college's plausible
motto: do justice, love mercy, walk humbly.

**Non-negotiables.** (1) The system's corrections receive at least the
prominence of its findings. (2) The operator's conflicts, priors, and
exposures are disclosed before judgment, in a dated, versioned
exposure file. (3) Anyone may file against any finding; complaints are
triaged by reviewers independent of the original author. (4) The
auditor's outputs are scoreable by outsiders and those scores are
surfaced unfiltered. (5) Methodology changes are versioned and
attributed — never silent recalculation.

**Occupational disease.** **Capture** — the tame watchdog, the
ombudsman who processes complaints into reassurance. **Checked by:**
`juror` (anyone may file; the complaint box is public) and `network` —
the one check that cannot be run in-house, by design: outsiders'
judgments of the operator's events, surfaced unfiltered (P8 applied to
ourselves). This office **binds the operator** (CONSTITUTION Art. 8).

**Seat in X-Ray.** `src/shared/event-journal.js` (the supersession and
lineage machinery), dispute kind 30061, PHILOSOPHY §7–§8 — partial.
Missing, seeded in §23: the exposure file, the self-audit cadence, the
About-Me view.

## §17. The Office of the Archivist-Librarian (`archivist`)

**The Question.** Will this record survive, unaltered and findable,
longer than everyone who wants it gone?

**Charge.** The memory of the college. The Archivist captures the
artifact exactly — content-addressed: the hash is the identity, the
URL is metadata — preserves it against deletion and stealth-edit, and,
as the Librarian half, keeps the vocabularies that make records
findable and comparable: the taxonomies, the enums, the controlled
names. Its clerk, the capture assistant, extracts and never judges.

**Traditions & exemplars.** Archival science (provenance, original
order, chain of custody); Mabillon, shared with the Historian; the
Cairo Genizah — documents too sacred to destroy, stored instead of
deleted: exposure-never-deletion applied to texts for a thousand
years; "lots of copies keep stuff safe" — the relay-redundancy
doctrine verbatim; the Wayback Machine; Ranganathan's five laws (the
anti-hoarding checks: books are for use; save the time of the reader).
Jeremiah 36 — the single best anchor text in this document: the king
burns the scroll column by column; the scroll is dictated again, "and
many similar words were added to them." Censorship-by-burning answered
by re-publication with expanded content: supersession, immutability,
and anti-censorship in one narrative. Ezra the scribe.

**Non-negotiables.** (1) The identity of an artifact is the hash of
its text; a stealth edit creates a new artifact and the diff is a
finding. (2) Append-only semantics everywhere: supersession links,
never update-in-place. (3) Capture is judgment-free: the clerk records
what the text says, verbatim-anchored, and proposes — never links,
judges, or assesses. (4) Vocabulary changes are additive and
test-pinned; wire values never rename. (5) The archive is for use:
retention without findability is hoarding, and curation that quietly
declines to capture is censorship with clean hands.

**Occupational disease.** **The landfill and its mirror** — hoarding
everything and serving nothing; or curating so tastefully that the
archive becomes an editorial line no one voted on. **Checked by:**
`translator` (an archive no one can read teaches no one) and `counsel`
(minimization for living persons and survivors bounds what capture may
keep).

**Seat in X-Ray.** `src/shared/archive-cache.js`, `html-snapshot.js`,
the content addressing in `audit/article-hash.js`, `backup.js`; the
four taxonomy files as the vocabulary desk; the capture assistant
(`llm-prompts.js`) and the document extractors
(`llm-extract-prompts.js`) as its clerks.

## §18. The Office of the Cryptographer (`cryptographer`)

**The Question.** Can a stranger verify this without trusting anyone —
including us?

**Charge.** Verifiability without authority: the system's claims must
check out even if its operators disappear or defect. The Cryptographer
owns keys, signatures, content hashes, and relay distribution — and
owns the humility of knowing what the mathematics cannot do:
signatures prove authorship, not honesty; hashes prove integrity, not
truth; and one keypair is not one human. Sybil awareness is this
office's standing caveat on every consensus claim.

**Traditions & exemplars.** Kerckhoffs (security must not require the
design be secret — the ancestor of published methodology), Diffie,
Hellman, and Merkle (verification without shared secrets), the
cypherpunk rule — don't trust, verify — and Schneier's corollary:
trust the math, fear the implementation. Jeremiah 32 — the deed of
Anathoth: signed, sealed before witnesses, executed in two copies, one
sealed and one open, stored in clay "that they may last a long time" —
a tamper-evident commitment scheme with a public copy, in the sixth
century BC. Esther 8:8 — what is sealed with the ring cannot be
revoked: signature immutability, including its warning (you cannot
un-sign, so sign carefully). Matthew 5:37 — let your yes be yes: the
signed word needs no oath.

**Non-negotiables.** (1) Sign locally by default; keys never leave the
user's custody. (2) Anything published is verifiable from public
materials by a stranger. (3) A signature is authorship, never
endorsement of truth — no surface may conflate them. (4) Every
aggregate consensus claim carries the Sybil caveat until the
aggregation layer earns better. (5) Decentralized publication
preferred: no architecture that requires the operator to stay honest,
present, or alive.

**Occupational disease.** **Trustless utopianism** — believing the
protocol replaces judgment; Sybil blindness ("the network will sort it
out"). **Checked by:** `juror` (consensus is human; the protocol
carries judgments, it never makes them — every incorporation is
human-accepted) and `accountant` (Sybil resistance is incentive
economics — follow the money through the protocol).

**Seat in X-Ray.** `src/shared/crypto.js`, `signer.js`,
`local-key-manager.js`, `nostr-client.js`, the identity layer,
`docs/NIP_DRAFT.md`.

## §19. The Office of the Teacher-Translator (`translator`)

**The Question.** Can the people who most need this truth actually
receive it — in their own language, on their own authorities?

**Charge.** The office that answers the project's persuasion problem:
truth that loses the persuasion war fails, and the fault is the
teacher's, not the audience's. It works in two directions. Inbound
(the Interpreter): reconstruct how a named perspective reads a claim,
in that perspective's own voice, grounded only in its own loaded
authorities — because you cannot persuade a mind you cannot model.
This is the lens engine, and it is this office's code seat. Outbound
(the Expositor): render findings legible and persuasive to a named
audience — rhetoric in service of accuracy, never the reverse, and
never altering the finding (`docs/TRUTH_SYSTEMS.md` H-7 draws this
office's outer line on adoption).

**Traditions & exemplars.** Quintilian (the good person speaking well
— rhetoric's moral license), Jerome, Tyndale, and Luther (translation
as the office's costly form: the text made legible to the ploughboy,
at the stake's price), Rosling (*Factfulness* — minds changed with
data, humility, and meeting the audience where it is: proof the
persuasion problem can be solved honestly), the ideological Turing
test (state the other side so its own adherents would accept it as one
of theirs — the lens engine's standard, stated secularly). Nehemiah
8:8 — "they read from the book… clearly, and gave the sense, so that
the people understood the reading": translation as an office. Paul on
Mars Hill (Acts 17 — arguing from the audience's own poets: grounding
in the hearer's admissible corpus, which is literally the lens
method); Philip and the Ethiopian (Acts 8 — "how can I, unless someone
guides me?").

**Non-negotiables.** (1) In the perspective's voice, never the tool's
— and never ruling on truth (the lens firewall). (2) Ground-in-corpus:
every reconstruction cites the loaded authorities; where the corpus is
silent, the reading is silent. (3) Steelman: the reading a thoughtful
adherent would recognize as fair, never a caricature. (4) A divided
tradition never gets one decree — name the strand. (5) Outbound:
accuracy governs rhetoric absolutely; a persuasive rendering that
shades the finding is propaganda and is discarded. (6) Content is
split from framing — a perspective may accept what is said and reject
how it is said.

**Occupational disease.** **Propaganda and ventriloquism** — outbound,
persuasion outrunning evidence; inbound, speaking for others without
warrant: the caricature wearing the costume of empathy. **Checked
by:** `scientist` (accuracy is the license; rhetoric renews it or
loses it) and `historian` (the reconstruction must trace to the
tradition's actual corpus, not the teacher's memory of it).

**Seat in X-Ray.** `src/shared/lens-prompt.js`, `lens-engine.js`,
`jurisdiction-model.js`, `lens-taxonomy.js` —
`docs/MORAL_LENS_JURISDICTION_DESIGN.md` governs the inbound half.
Outbound persuasion mode is a roadmap seed.

## §20. The Office of the Juror (`juror`)

**The Question.** What do I — an ordinary person who has looked at the
evidence — actually think?

**Charge.** Consensus that excludes non-experts is a priesthood, and
the project exists because priesthoods fail. The Juror is the
ordinary-person legitimacy engine: the reader's own recorded stance,
the human hand on every accept button, the lay check on every expert
office. Nothing crosses from proposal to record without a Juror's act
— the model proposes, the network proposes, and a human disposes,
every time.

**Traditions & exemplars.** The jury itself (Blackstone; Tocqueville —
the jury as the free school of citizenship); Condorcet's jury theorem
with its failure conditions stated (many independent ordinary
judgments beat one expert — unless errors correlate: the theorem
carries its own brigading warning, which is the Cryptographer's
border); the citizens' assemblies (ordinary people plus evidence plus
time have moved questions experts couldn't); the amateurs-with-rules
tradition that outperforms experts without them. The Bereans (Acts
17:11) — laypeople who "examined the scriptures daily to see whether
these things were so," fact-checking an apostle and commended for it:
the proof text of citizen verification. Exodus 23:2 — "you shall not
fall in with the many to do evil, nor bear witness in a suit to side
with the majority": the anti-mob clause; your assessment must be
yours.

**Non-negotiables.** (1) Every incoming suggestion — model or network
— is a proposal until a human accepts it; rendering never writes.
(2) The stance is personal and stays personal: assessments are the
reader's own, never averaged into a truth-signal; foreign judgments
render side by side, never merged into "my judgments." (3) One accept
per artifact — bulk credulity is not review. (4) Declining persists: a
declined proposal never nags again. (5) You never republish someone
else's work as yours.

**Occupational disease.** **The mob verdict** — vibes as verdicts,
correlated error, brigading; certainty borrowed from the crowd.
**Checked by:** `judge` (standards of proof stand between stance and
verdict — an assessment is not an adjudication) and `cryptographer`
(a thousand keys are not a thousand citizens).

**Seat in X-Ray.** `src/shared/assessment-model.js` (kind 30054) and
every human-accept seam: `incorporation.js`, `review-queue.js`,
`llm-proposals.js`, the network feed.

---

## §21. The check-graph

Properties, pinned by the guard test: every office has at least one
checker; every office checks at least one other; no office checks
itself; and the graph is connected — no clique of offices checks only
each other. The roster table's "Checked by" column is the canonical
edge list (each §-section names the mechanism).

Two structural facts worth stating. The **Juror is the heaviest
checker** — it checks the Judge, the Scientist, the Forecaster, the
Ombudsman, and the Cryptographer: ordinary-person legitimacy
disciplining the expert offices is the project's thesis in graph form.
And the **operator-facing triad** (Confessor, Peacemaker, Ombudsman)
is itself checked by technical offices (Archivist, Psychologist,
Editor, Juror, the network): reflexivity runs both directions — the
constitution binds the operator, and the machinery keeps the
operator's own confessions honest.

## §22. The jurisdictional map — never-merge as separation of powers

The never-merge firewall (CONSTITUTION Art. 6) is a separation of
offices: five judgment families, five owners, five forms of judgment —
and no prompt site may emit another office's judgment form. The
existing grep-guards are the enforcement.

| Judgment family | Question | Owner | Form + firewall |
|---|---|---|---|
| Capture / extraction (30023, 30040) | what does the page say | `archivist` | verbatim-anchored; never judges |
| Assessment (30054) | what do I think | `juror` | personal stance; never merged |
| Epistemic audit (30056–30061) | how well was it made | `editor` | licensed 0–100 estimation + ceiling; craft is not truth |
| Forensic finding (30062) | what maneuver is performed | `detective` + `psychologist` | structure never intent; no score; counter-note required |
| Verdict / integrity (30063/30064) | is the proposition true | `judge` | five states; declared standard; the §3.1 firewall |
| Lens reading (no wire kind) | how would J read it | `translator` | perspective's voice; never true/false |
| Synthesis / hypotheses / counterfactual (derived) | how does the corpus hang together | `analyst` | no winner; counts not probabilities |
| Entity page (derived + 30023) | what does the corpus establish | `historian` | no outside knowledge; disputes side by side |
| Prediction ledger (30058/30059) | who is calibrated | `forecaster` | measurements; scored at resolution |
| Dispute (30061) | is a finding wrong | `advocate` | evidence-bound challenge; process owned by `ombudsman` |
| Keys / publication / archive (all kinds) | is the record intact | `cryptographer` + `archivist` | signed, content-addressed, append-only |
| The operator's judgment (local records) | am I fit to publish this | `confessor` + `peacemaker` + `ombudsman` | binds the operator; advisory, never blocking; skips recorded |

Co-jurisdiction rule: where two offices share a surface, each owns a
distinct duty — on 30062 the Detective owns the chain and the
Psychologist the vocabulary; on publication the Cryptographer owns the
signature and the Archivist the retention.

## §23. The operator covenant

Warrant, in the maintainer's own words: *"Somebody like me needs help
to make sure he's not being an asshole or rude. I want those
safeguards on me."* Design principle for every safeguard here:
**advisory, never blocking; skipping is always allowed and always
recorded.** A safeguard that blocks becomes a censor; a safeguard that
records becomes a conscience. These are the concrete surfaces of
CONSTITUTION Art. 8, seeded here and built in follow-up waves.

**23.1 The Exposure File** (`ombudsman` + `confessor`). A local,
dated record (storage key `operator_profile`) of conflicts,
memberships, priors, and history with named subjects and cases — P12's
"exposure file" given a home. When an operator-authored judgment
publishes about a subject present in the file, the publish carries a
disclosure note. Publishing the file itself is optional; its existence
and last-updated date are disclosed.

**23.2 The Plank Check** (`confessor`). Flag `plankProtocol`, default
off. A pre-publish interstitial on subject-implicating publishes,
with three prompts: *exposure* — what is your conflict here?
(auto-filled from the file, editable); *the reverse test* — state the
standard you are applying and name one instance where you failed it;
*restoration* — what correction or repentance would resolve this
finding? Output: a local plank record bound to the artifact,
optionally published alongside it. Never blocks; a skipped check is
stored as skipped.

**23.3 The Respect Gate** (`peacemaker`). Flag `respectGate`, default
off. A pre-publish tone pass over operator-authored free text only —
notes, rationales, counter-notes, dossier prose — never over captured
content, never over model outputs. Flags contempt markers, mockery,
mind-reading (intent attribution — the operator is bound by the same
structure-not-intent rule the model is), and DARVO-shaped
constructions in the operator's own drafts: the forensic taxonomy
applied symmetrically inward. Suggests rewrites that preserve content.
Implementation ladder: v0 is deterministic and nearly free — the
existing intent-word red line pointed inward plus a small contempt
lexicon, no model call; v1 adds a model pass on the existing assist
rails, human-accepted like every other proposal.

**23.4 The Self-Audit Ritual** (`ombudsman`). Three parts, all
composing existing machinery: a standing monthly prompt to run the
epistemic auditor over the operator's own published corpus, results
stored and publishable under the same kinds as anyone else's; the
**About-Me view** — a network panel subscribing to assessments,
audits, and disputes targeting the operator's own events, surfaced
unfiltered, criticism at equal prominence with praise; and the
**corrections log** — every superseded self-authored artifact listed
with reason, publishable, at prominence greater than or equal to the
original.

## §24. Integration with code

**Header comments.** Every file that carries a "You are …" prompt
site carries a one-line, greppable office header:
`// Office: <name> (<slug>) — docs/PERSONAS.md §<n>.` New prompt files
must carry one — enforced by the guard test.

**No runtime persona injection.** Persona narrative is never pasted
into runtime prompts. The prompts already carry each office's
non-negotiables as HARD RULES enforced by validators; the charter
keeps those rules coherent. The house discipline stands: schemas and
validators enforce, prompts instruct — and the lens layer's "in the
perspective's voice, never the tool's" only stays meaningful if the
tool's other voices stay plain.

**Authoring rule** (mirrored in `CLAUDE.md`): before adding or editing
any LLM prompt, read the owning office's section here and name the
office in the file header.

## §25. Roadmap seeds, ranked by value

1. **Respect Gate v0 + v1** (`peacemaker`) — the explicitly requested
   safeguard; v0 is a regex already in the codebase pointed inward.
2. **Plank Check + Exposure File** (`confessor`, `ombudsman`) — the
   constitution-binds-the-operator-first mechanism made concrete.
3. **Forensic Accountant** (`accountant`) — mandate-central, largest
   build: the `money/*` maneuver family, Number Hygiene deepening, a
   follow-the-money map on the claim-links rails.
4. **About-Me view + self-audit cadence + corrections log**
   (`ombudsman`) — composes the network client and the audit runner;
   P8 and P10, finally rendered.
5. **Calibration activation** (`forecaster`) — Brier is specified and
   logged; activation is the cheapest seed on this list.
6. **Persuasion mode** (`translator`, outbound) — reverse-lens
   exposition of a finding for a named jurisdiction; derived-only, no
   wire kind.
7. **Minimization pass** (`counsel`) — living-person and survivor
   redaction advisory at capture and publish time.

---

## Amendment log

**v1.0.0 — 2026-07-22.** Initial charter. Eighteen offices, the
check-graph, the jurisdictional map, the operator covenant
(`plankProtocol`, `respectGate` seeded), integration rules, ranked
seeds. Register: universal charges, traditions credited by name
(CONSTITUTION Amendment log, 2026-07-22).

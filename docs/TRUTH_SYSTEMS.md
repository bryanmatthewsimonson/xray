# Truth Systems — the comparative foundation

**Document version:** 1.0.0
**Status:** Evidentiary annex to `docs/CONSTITUTION.md`; normative for
the §3.3 bridging constraints and the §4 honest-limits clauses
(adopted by CONSTITUTION Preamble and Art. 5.5 on this document's
ratification)
**Date:** 2026-07-22

The maintainer's question, verbatim: *"What do all of the systems in
the world for attempting to adjudicate truth have in common? We need
to make use of those and implement any new ones that we can with
available technology."* This document is the answer, and the evidence
base under the constitution's articles. Its gap list (§2) doubles as
the constitutional roadmap-seed registry.

---

## §0. The answer in one paragraph

Every serious truth system humanity has built — courts, science,
audit, intelligence, the Talmud, Wikipedia, prediction markets, the
NTSB — converges on the same small set of structural moves, discovered
independently across three millennia because they are the only moves
that work: (1) separate the evidence from the judgment and protect the
evidence from the judge; (2) shrink the adjudicable unit until it is
small enough to be wrong about; (3) state the standard of proof before
the verdict; (4) force an adversarial voice into the room; (5) price
confidence, so being loudly wrong costs more than being carefully
wrong; (6) subject the judge to the same standard, harder; (7)
preserve the losing argument forever; (8) allow appeal but never
erasure; (9) require corroboration that is independent, not merely
numerous; (10) decline to rule on what cannot be known, and say so;
(11) let time vote last. No system has all eleven; every system that
lasted has most; and every famous failure — Lysenko, Enron, the Iraq
WMD estimate, the replication crisis — is the loss of one of them,
usually quietly, one asymmetric judgment call at a time. X-Ray already
implements more of these simultaneously than any single traditional
institution does; the honest measure of the design is the gap list
below, and the gaps are buildable.

---

## §1. The survey

Format per system: mechanism → what it gets right → characteristic
failure → what X-Ray takes (existing feature) or lacks (gap → seed).

### 1.1 Adversarial courts (common law)

Two motivated advocates collide before a neutral finder of fact under
symmetric rules; evidence is admitted under law (relevance, hearsay,
chain of custody); the claim is proved to a pre-stated standard; the
accused is heard; verdicts are appealable but the record is permanent;
like cases are decided alike; interested judges recuse.

**Gets right.** Truth-finding is adversarial by construction, not by
accident — the court trusts no one to be neutral; it trusts the
collision of partisans under symmetric rules. Standards of proof scale
with stakes and are declared before the evidence is weighed. The
verdict binds the proposition charged, never the person's soul.
**Fails by** proceduralism, wealth asymmetry, and finality — a wrong
verdict outliving the evidence that refutes it.

**X-Ray takes:** `standard_of_proof` on kind 30063
(`src/shared/truth-taxonomy.js`); verdicts attach to propositions, not
persons; append-only supersession instead of res judicata — no verdict
is ever final against new evidence (P9); recusal generalized as
exposure disclosure (P10/P12). **Gaps:** a mandatory
**devil's-advocate field** on high-stakes verdicts (a composed
strongest-case-against before any `established-*` at
clear-and-convincing or above, in `adjudicate-modal.js`); the
**right-of-reply surface** — a subject-authored reply rendered on the
verdict card itself, unmissable.

### 1.2 Inquisitorial courts (civil law)

An investigating magistrate builds one dossier — inculpatory and
exculpatory both — under a formal duty of impartiality.

**Gets right.** The duty to gather evidence both ways rests on one
accountable actor; the dossier is the ancestor of X-Ray's case
dossier. **Fails when** the single magistrate is captured — one
office, whole proceeding.

**X-Ray takes:** the derived, computed-on-read case dossier; the
balance-sheet duty (kept commitments sought as hard as broken).
**Gap:** the single-magistrate risk *is X-Ray's current condition* —
one author, one corpus, one set of capture decisions. Structural
answer: **cross-archive case comparison** — another npub's dossier on
the same case, rendered beside mine, diffed (buildable on
`incorporation.js` + `case-dossier.js`).

### 1.3 Science

Falsifiability; replication by independent parties; peer review;
preregistration; meta-analysis; measurement over authority.

**Gets right.** Falsifiability is atomization in another vocabulary —
`resolution_criteria` is Popper operationalized. Preregistration
commits to the method before the outcome. Replication is independence:
one lab's result is a claim; independent convergence is a fact.
**Fails by** the replication crisis (publish beats be-right),
publication bias (the file drawer), p-hacking (estimation laundered
into measurement — the exact failure TRUTH_ADJUDICATION §1 is written
against), paradigm capture, unaccountable anonymous review.

**X-Ray takes:** the atomization gate; prediction extraction with
pre-stated criteria (kinds 30058/30059); the coverage field as the
file-drawer defense ("sample, not census" caps every aggregate);
counter-indicators on every maneuver; methodology versioning.
**Gap:** **adversarial collaboration** — two disagreeing npubs co-sign
one proposition's `resolution_criteria` before evidence collection, so
neither can later dispute the yardstick. The single
highest-leverage social feature the truth layer lacks: it converts
enemies into co-registrants.

### 1.4 Journalism

Sourcing standards, editorial independence, the corrections column,
bylines, news/opinion separation.

**Gets right.** The two-source rule (Deuteronomy 19:15 rediscovered);
the corrections column as the trust engine; signed judgment. **Fails
by** access bias, narrative herding (unanimity without independent
verification), deadline pressure, corrections at 1/100th the
prominence of the error.

**X-Ray takes:** the whole epistemic-audit target domain (PHILOSOPHY
§3.1's eight modules are journalism's own standards, scored);
correction behavior as a tracked dimension; the uniform-narrative red
flag; source-independence discipline (two outlets on one wire are one
source). **Gap:** the **self-corrections view** — the operator's own
corrections record exists in the supersession chains; only the render
is missing (P10 demands it).

### 1.5 Audit and forensic accounting

Structural independence; materiality; disclosed sampling; the fraud
triangle; chain of custody; the append-only audit trail.

**Gets right.** Independence as structure (the auditor who cannot be
fired by the audited); materiality as honesty about attention; the
fraud triangle as a structural — not moral — model of misconduct.
**Fails by** auditor capture (Arthur Andersen, paid by the party it
audited).

**X-Ray takes:** the outsider stance is structural independence;
triage as materiality; the known-unknowns log; neutralization theory
in the forensic taxonomy is the fraud triangle's rationalization leg,
evidence-anchored. **Gap:** peer review of the auditor — the network
review-request wire exists (kind 1985 labels); missing is the
affordance that points it at one's own published audits by default:
**request adversarial review of my verdict** on every published 30063.

### 1.6 Intelligence analysis

Heuer's analysis of competing hypotheses; structured techniques; red
teams as institutional roles; calibrated estimative language; the
collection/analysis separation.

**Gets right.** Disconfirmation across the full hypothesis set —
evidence consistent with your favorite is usually consistent with the
others too — is the strongest proceduralized de-biasing move known.
Calibrated vocabulary pins hedge words so they cannot be
retroactively stretched. **Fails by** politicization (the conclusion
upstream of the analysis — the Iraq WMD estimate was a fused score),
groupthink, the consumer who wants a number.

**X-Ray takes:** the hypothesis map IS the competing-hypotheses
method with the fusion step deliberately amputated — and the
amputation is correct, because the fused score is where politicization
enters; the crux marker is diagnostic evidence; hedge-level extraction
is proto-calibrated-language. **Gaps:** per-claim **all-hypotheses
coverage** in the edge-suggestion pass (each claim's relation to every
hypothesis, including "no bearing"); a **pinned uncertainty lexicon**
for rendering — every rendered confidence maps to a published
vocabulary table, so "likely" can never mean two things in two places.

### 1.7 Wikipedia and open-source verification

Verifiability-not-truth; neutral point of view as *representing*
disputes rather than resolving them; cite-or-delete; public edit
history; and the open-source-verification school: geolocation,
chronolocation, cross-corroboration with the full derivation
published.

**Gets right.** Epistemic modesty as policy — adjudicating attribution
rather than truth is why it survived; the process as public as the
product; verification any stranger can re-run beats credentialed
assertion. **Fails by** edit wars, admin capture, source laundering (a
claim cycles through a citable outlet and returns "verified"), and the
reliable-source list as a capturable chokepoint — who decides what
counts becomes the real adjudicator.

**X-Ray takes:** the claims layer is verifiability-not-truth (a 30040
records that X said Y, here; the verdict is a separate, later,
optional act); re-derivability from relays; content addressing defeats
laundering through stealth-edits (the same text at two URLs is one
artifact). **Gap:** evidence-tier assignments should be **disputable
like verdicts** — the 30061 dispute format accepting "this evidence
entry's tier is wrong" as a target, keeping the chokepoint contested.

### 1.8 Prediction markets and forecasting

Skin in the game; proper scoring rules (honesty as the optimal
strategy — the only incentive-compatible truth mechanism in this
survey); the finding that calibration is a trainable skill and a
multi-year resolved ledger is the one credential that cannot be faked.

**Fails by** thin markets (a price with three traders is noise wearing
math), manipulation, unresolvable questions, Goodharting the
resolution criteria.

**X-Ray takes:** the prediction ledger with the calibration multiplier
(P7; Brier over *resolved* predictions only); the
reputation-eligibility gate as the unresolvable-question defense;
`unresolved` as a permanent honest state; capital staking parked with
"never purely stake-weighted" as a red line. **Gap:** the
**verdict-reversal ledger** — per author, the measured rate at which
published verdicts were later superseded with a changed state,
rendered beside the record; computable today from the supersession
chains. The same surface is the author-facing **calibration loop** (of
your clear-and-convincing verdicts that resolved, how many held?).

### 1.9 Community Notes (bridging-based ranking)

Contributors rate proposed notes; a public model decomposes each
rater's behavior into a polarity axis and a helpfulness intercept; a
note is shown only when raters who usually *disagree* both find it
helpful. The algorithm and data are public and re-runnable.

**Gets right.** The strongest recent innovation in computed consensus,
and its genius is precisely that it is *not* averaging: it models the
disagreement structure and rewards cross-cleavage agreement — the
two-witness independence rule in statistical form (a co-partisan
corroboration is one witness; a cross-partisan corroboration is two).
Its output is a visibility gate, never a truth-score on the post.
**Fails by** slowness, coverage, cold start (thin rating histories
make polarity estimation noise), and polarity-history farming.

**X-Ray takes:** treated in full at §3.3 — the centerpiece of the
reopened aggregation question.

### 1.10 Talmudic and scholastic disputation

The Talmud records the rejected opinions beside the accepted rulings,
forever — the minority report is infrastructure, because a future
court may need it. The scholastic disputation states the strongest
objections first, fairly, and may not conclude until each is answered
by name. The argument that seeks truth endures; the argument that
seeks victory does not.

**Fails by** scholasticism (argument about arguments, detached from
the world), canon closure, precedent hardening into unoverrulability.

**X-Ray takes:** P8 is Talmudic to the letter; side-by-side rendering
everywhere; steel-manning scored as a dimension; rejected disputes
stay visible ("the record of what was challenged and survived is part
of the score's credibility"). **Gap:** the **disputation form as an
authoring structure** — in the adjudicate modal, evidence-against
renders above evidence-for in authoring order, and the caveats field
asks: which evidence-against does this verdict NOT answer? A
prompt-and-layout change; zero wire change.

### 1.11 Religious and confessional traditions

Deuteronomy 19:15 — "at the mouth of two witnesses, or at the mouth of
three witnesses, shall the matter be established" — independence as
covenant law, with teeth: the false witness suffers the penalty he
sought for the accused (19:18–19, symmetric accountability, ~700 BC).
The ninth commandment names lying-about-a-person as a distinct wrong.
Matthew 18:15–17 — escalation discipline: private confrontation, then
two or three witnesses, then the assembly; publicity is the last
resort. Matthew 7:1–5 — audit yourself by the standard before applying
it. Deuteronomy 18:22 — the prophet whose prediction fails is thereby
known false: a resolution ledger.

**Fails by** dogma (the unfalsifiable core exempted from the method),
heresy-hunting (the truth machinery inverted into an orthodoxy
enforcer — the precise failure the §3.1 firewall names), institutional
self-protection.

**X-Ray takes:** attestation convergence with demonstrated
independence (`src/shared/truth-attestation.js`); no free shots
(accusers accrue records on their own accusations); P10; the
prophet-by-predictions ledger; good-faith-wrong is not bad-faith (the
ninth commandment's *knowing* lie, not the honest error). **Gap:** the
**notice-disclosure field** — for subject-implicating events, an
optional but recorded "notice given to subject: yes / no /
unreachable," plus the right-of-reply surface (1.1). Not a gate — a
gate would be a censorship vector — but a disclosed fact about
process, which readers may weigh. The tradition's insight:
publicity-first is itself an aggression marker. This is the largest
ethical gap in the current stack, and cheap to build.

### 1.12 Cryptographic and distributed-systems truth

Signatures (unforgeable authorship); content addressing (identity =
hash); verification any node can re-run; byzantine tolerance.

**Gets right.** The only machine-checkable truths in the survey — who
said what, when, and that it has not changed since. That is not truth
about the world; it is truth about the record, and it is the
foundation everything else stands on. **Fails by** the oracle problem
(cryptographically-immutable garbage), key loss and theft, Sybil
attacks (identities are free, so counting them is meaningless — why
every naive decentralized truth-voting scheme dies).

**X-Ray takes:** the entire substrate — signed events,
content-addressed artifacts, verify-on-ingest at the single choke
point, append-only supersession — and, critically, the knowledge of
what this cannot do: the system counts nothing over open sets.
**Gap:** the **key-transition attestation** — an old key signs a
successor statement; the record renders both eras linked, transition
disclosed. Reputation systems that cannot survive key rotation
eventually punish the honest and reward fresh-key laundering.

### 1.13 Statistical vs. clinical judgment; Delphi; calibration training

Meehl's never-overturned finding: simple explicit rules meet or beat
expert intuition across most prediction domains — the rule is
consistent; the expert is noisy. Delphi: iterated anonymous estimation
with the spread reported, not just the center. Calibration is
trainable, with feedback as the mechanism.

**Fails by** rule-abuse outside the validated class (an actuarial
formula for guilt), manufactured convergence, laboratory gains that
don't transfer.

**X-Ray takes:** measurements-never-estimations *is* Meehl's boundary
drawn as law — mechanical, derivable numbers admissible; holistic
fused numbers not; and the human categorical verdict sits exactly
where the evidence says human judgment must remain (constructing and
judging the question). The Delphi spread-not-center is P8; shrinkage
is honest actuarial practice. **Gap:** the author-facing calibration
loop (1.8's surface).

### 1.14 Medicine's evidence hierarchy

Evidence classes ranked by structural resistance to bias, with
explicit downgrade factors — a hierarchy of *methods*, not of
institutions; certainty ratings travel with the recommendation.

**Fails by** industry capture of the trial pipeline (bias laundered
*through* the hierarchy via outcome-switching), and the hierarchy
fetishized against domains where trials are impossible.

**X-Ray takes:** evidence tiers as provenance classes; the knowability
ceiling as the defense for hard-to-test domains; preregistration
against outcome-switching. **Gap:** structured **tier notes** — an
optional enum on evidence entries (conflict-of-interest-disclosed,
retraction-risk, indirect) giving the tier a stated derivation like
every other value; and the evidence-law import worth a rubric note:
the **statement against interest** — an admission that damages its
maker is structurally stronger than self-serving testimony.

### 1.15 Engineering failure analysis — the NTSB and the blameless postmortem

The crash investigator investigates to prevent recurrence, not to
assign blame — and is statutorily walled off from litigation. The
parallel safety-reporting system grants immunity for self-reported
errors, which is why pilots actually report them.

**Gets right.** The deepest incentive insight in the survey: **the
truth about failure is only obtainable at the price of not punishing
its confession.** Where confession is punished, evidence evaporates.
This is truth-without-humiliation as an engineered information-flow
property — and it is why "good-faith-wrong is not bad-faith" is not
merely kind; it is what keeps honest asserters producing the record.
**Fails when** blamelessness stretches to cover repeated willful
patterns.

**X-Ray takes:** structure-not-intent; revision-as-credit; the
pattern-not-instance rule (individual incidents blameless, patterns
actionable — exactly the tradition's own answer to its failure mode).
**Gap:** designate the JOURNAL's bug and design entries as the
project's own P10 corrections record, linked from the published
methodology.

### 1.16 Ombudsman institutions; restorative justice

The ombudsman: an independent complaint-receiver with publication
power and no enforcement power — truth-finding decoupled from
punishment lowers the threshold for complaints. Restorative justice
(the truth-and-reconciliation model): amnesty purchased with full
public confession — the truth extracted by making it survivable.

**X-Ray takes:** the dispute kind is an ombudsman channel (anyone may
file, with evidence; the filing is permanent either way); revision-
as-credit is the honest road back. **Honest deferral, named:** the
dispute *adjudication runtime* is deferred — the ombudsman's desk is
unstaffed, correctly (a premature adjudication runtime would be a
capture point). Appeals exist as permanent public filings; their
resolution is the reader's judgment and future supersession, not an
institutional ruling. And the restorative principle is constitutional
law (Art. 3): the record must always leave a legible road back for
the corrected, because a system with no road back teaches its
subjects never to concede — which destroys the record's supply.

---

## §2. The distilled invariants

Enforceable norms, each with its exhibiting systems, X-Ray's
implementation, and the gap. Gaps marked **→ seed** are the
constitutional roadmap-seed registry (with `docs/DISCIPLINES.md` §17).

- **I-1. Evidence is separated from judgment, and outlives it.**
  *(Exhibits; data-vs-conclusions; working papers; flight recorders.)*
  Implemented: the capture layer vs. the judgment kinds; §5.5a
  capture-first evidence. No gap — this is X-Ray's spine.
- **I-2. The adjudicable unit is atomized until it can be cleanly
  wrong.** *(Counts/charges; falsifiable hypotheses; line-level
  citations.)* Implemented: P2; the atomization gate. No gap.
- **I-3. The standard of proof is stated before the verdict, and
  scales with stakes.** *(The three standards; certainty grades;
  preregistration.)* Implemented: `standard_of_proof`. Gap → seed:
  settle per-class default standards (reputationally heavy facts
  require clear-and-convincing) — the invariant's teeth.
- **I-4. An adversarial voice is structurally present, not hoped
  for.** *(Defense counsel; red teams; the scholastic objections.)*
  Implemented: required counter-note; counter-indicators; both-sides
  passes. Gap → seed: the devil's-advocate field at the verdict layer
  (1.1); all-hypotheses edge coverage (1.6).
- **I-5. Corroboration must be independent, not merely numerous.**
  *(Two witnesses, not one witness twice; replication; cross-partisan
  raters.)* Implemented: attestation convergence. Gap → seed: a
  structured `independence_basis` field — the exact field a future
  bridging computation consumes.
- **I-6. Confidence is priced.** *(Proper scoring rules; the failed-
  prophet test.)* Implemented: P7; Brier over resolved predictions.
  Gap → seed: the author-facing calibration loop and verdict-reversal
  ledger.
- **I-7. The judge is subject to the standard, applied harder, and is
  judged visibly.** *(Plank-before-speck; reversal records; rater
  modeling.)* Implemented: P10; auditor-of-auditors. Gap → seed: the
  self-corrections view; request-adversarial-review-of-self.
- **I-8. Judgments are appealable; the record is never erasable.**
  *(Appeals; edit history; P9.)* Implemented: supersession; disputes;
  rejected disputes visible. Honest deferral: the adjudication
  runtime (1.16).
- **I-9. Dissent is preserved at full fidelity, forever.** *(The
  minority opinions; the Delphi spread; P8.)* Implemented everywhere —
  X-Ray's most complete invariant. No gap.
- **I-10. Method is published before, and versioned across,
  outcomes.** *(Preregistration; open algorithms; P12.)* Implemented:
  methodology versioning; public weights; the NIP draft. No gap.
- **I-11. Symmetry: the standard is blind to the identity and valence
  of its target.** *(Equal protection; role symmetry; P5.)*
  Implemented as law; unmeasured in practice. Gap → seed: the
  **standing symmetry self-test corpus** — valence-mirrored golden
  pairs run through the pipelines on a cadence, paired outputs
  published: the discomfort test made mechanical. A genuinely new
  capability no surveyed system has automated.
- **I-12. The system declines what it cannot know, and says so.**
  *(Justiciability; tractability triage; the knowability ceiling.)*
  Implemented: P6; `unresolved`/`insufficient-evidence`; mandatory
  caveats. No gap.
- **I-13. Provenance is unbroken from artifact to verdict.** *(Chain
  of custody; open-source verification.)* Implemented: P3; the
  quote-grounding contract; capture-first evidence. No gap — state of
  the art.
- **I-14. Fact-finding is separated from moral judgment, and truth
  from values.** *(Verdict/sentencing bifurcation; neutral point of
  view; is/ought.)* Implemented: the never-merge firewall; the §3.1
  and value firewalls; the lens. No gap — the five-family separation
  is X-Ray's most original structural contribution.
- **I-15. The accused is heard, and publicity has an order.** *(Audi
  alteram partem; the escalation ladder; request-for-comment.)*
  Implemented: the omission module; right-of-reply named as a
  principle. Gap → seed: the right-of-reply surface and the
  notice-disclosure field — the largest ethical gap in the stack.
- **I-16. Time votes last.** *(Appeals on new evidence; the ledger;
  vintage scores.)* Implemented: cadenced re-evaluation is normative;
  the ledger runs. Gap → seed: the standing-review queue
  (compute-on-open from timestamps; no infrastructure).
- **I-17. Truth-telling must be survivable.** *(Immunity for
  self-report; blameless postmortems; restitution-and-reintegration.)*
  Implemented: good-faith-wrong; revision-as-credit;
  pattern-not-instance. Elevated to constitutional law: the road-back
  clause (Art. 3).
- **I-18. Attention is allocated by consequence, and the allocation
  is disclosed.** *(Materiality; triage; coverage.)* Implemented: the
  triage formula; coverage caps. Gap → seed: an ungameable coverage
  denominator — what makes selective-adjudication attacks legible.

---

## §3. Anti-subversion requirements

### 3.1 The honest engineering translation

"A protocol so anti-fragile that it cannot be used for lies" cannot
mean lies are unutterable — an open protocol that could prevent
utterance would be a censorship machine, which the mandate itself
forbids (CONSTITUTION Art. 3). What the protocol can do — what every
surveyed system's anti-subversion machinery actually does — is make
lies **costly** (the liar's own signed record accumulates), **traceable**
(provenance unbroken, origins and mutations public), and **stripped of
cover** (inside X-Ray's forms, a lie must expose its evidence, tier,
standard, and caveats to be well-formed at all; outside them, it is
visibly formless). Anti-fragility, precisely: attacks feed the record
— a brigade is a dataset of the brigade; a false accusation is a
permanent signed exhibit against its author.

### 3.2 The subversion modes

- **S-1. Capture by operators.** The maintainer's own hand is the
  first threat model — every surveyed system's terminal failure is
  self-exemption. Defenses: P5 as existential; P10; the amendment log
  (silent constitutional edits are void); and — structurally
  strongest — the protocol itself: signed events on public relays
  mean the record outlives and escapes the operator; anyone can
  re-derive, fork the client, and keep the corpus. Needed: the
  symmetry self-test (I-11). Residual, honestly: a single-maintainer
  system's symmetry is untested until adversaries use it; capture-by-
  selection is only legible in the coverage denominator.
- **S-2. Brigading and Sybil.** Identities are free; counting them is
  meaningless. Defense today is abstinence: the system counts nothing
  over open sets — roster-scoped trust, follow-axis feeds, counts as
  discovery-never-ranking. Residual: any reopened aggregation
  inherits the full Sybil problem and must stay scoped to rosters or
  to identities with costly history (§3.3, constraint 5).
- **S-3. Orthodoxy enforcement — the tool as inquisition.** The
  gravest purpose-subversion. Defenses: the §3.1 firewall
  (interpretations and values never adjudicated); the value firewall;
  the reputation-eligibility gate; the lens as the pressure-release
  valve — where normative disagreement legitimately goes, in a named
  perspective's voice. Residual, stated honestly: the firewall
  prevents the tool from *ruling* on heresy; it cannot prevent a user
  from *hunting* with selectively-chosen true verdicts. The coverage
  cap and the symmetry test are the only counters, and they are
  partial.
- **S-4. Laundering estimates into verdicts.** The p-hacking of the
  protocol. Defenses: Art. 5's license and its guard-tested key
  bans; no-numeric-slot tool schemas; counts-never-cross-compared
  render rules. Residual: readers fuse in their heads — "supporting
  evidence (12)" versus "(3)" reads as a score no matter what the
  note says. The system can refuse to assert the fusion; it cannot
  prevent the inference. An honest-limits clause, not a fixable bug.
- **S-5. Asymmetric application.** Same standards, selectively
  enforced. Defenses: role symmetry; both-sides requirements; the
  balance-sheet duty. Needed: the symmetry self-test; per-case
  **scrutiny disclosure** — a derived count of judgment events per
  side, a measurement of where attention went, rendered without
  verdict. Residual: capture is user-driven; the corpus is a
  biography of one person's attention. Disclose; never pretend
  otherwise.
- **S-6. Reputation assassination via judgment kinds.** Defenses:
  required counter-note; no intent field by construction;
  propositions-not-persons; no auto-emitted person-labels;
  symmetric accountability (the accusation accrues to the accuser's
  record); everything disputable forever. Needed: right-of-reply and
  notice-disclosure (I-15). Residual: none of this binds a hostile
  author on an open network — anyone can sign defamatory
  30062-shaped events. The honest answer is consumer-side
  (verify-on-ingest, roster trust) plus the deterrent that the
  assassin's events are permanent signed exhibits against the
  assassin once the counter-evidence lands. Real, but not instant.
- **S-7. Citation laundering.** Fabricated, circular, or
  misrepresented sources. Defenses: capture-first evidence (nothing
  evidentiary is typed); the quote-grounding contract (anchors
  rebuilt from the article's own bytes; paraphrase hard-rejected);
  independence discipline; content addressing. Residual — the oracle
  problem's sharpest edge: upstream fabrication (forged primary
  documents) enters as well-formed evidence. Tier-1 forgery is the
  attack the protocol cannot detect, only survive: supersession,
  dispute, and the forger's permanent record once exposed.
- **S-8. Slow rot of standards.** Every institution's actual cause of
  death — one asymmetric judgment call at a time. Defenses: the
  amendment discipline (weakening requires a stated accepted failure
  mode); guards turning doctrine into CI failures; the JOURNAL as the
  decision audit-trail. Needed: the **constitutional review cadence**
  — a scheduled re-read of the red lines against the shipped feature
  set; the constitution mandates its own periodic audit. Residual:
  tests guard the foreseen; rot arrives through the unforeseen
  category. Culture — and the outside adversaries the network someday
  supplies — guard the rest.
- **S-9. Capital and dependency capture.** Defenses: never
  stake-weighted (red line); bonding parked; multi-relay durability.
  Residual, named honestly: the LLM-assisted passes run on a single
  commercial provider, and a model's priors are a soft aggregator
  inside every suggestion. Mitigations: everything human-accepted;
  `suggested_by` model-identity provenance on every machine
  suggestion, permanently (constitutional, Art. 10); grounding
  validation strips ungrounded output. Proposal-shaping is
  agenda-setting power all the same: multi-model cross-checking on
  judgment-adjacent passes is a desirable future defense, not an
  achieved one.

### 3.3 The bridging license — diversity-weighted aggregation, constrained

What the 2026-07-03 kill rejected was computed *authority*: an
open-set, auto-computed consensus number displayed as the network's
judgment — Sybil-capturable, dissent-averaging, a central scoreboard.
Bridging-based ranking (1.9) is a different shape: it models the
disagreement structure and measures what survives across it. In the
constitution's vocabulary it is a **measurement** — "adjudicators
whose prior records diverge on axis X converge on this proposition" is
a count with a shown derivation — and the truth-adjudication wire
already reserves the read-time slot for it. The kill rejected computed
authority; nothing in the red lines rejects computed measurement of
the disagreement structure. That is the line, and it is bright.

Diversity-weighted aggregation is therefore admissible — under all
seven constraints, each load-bearing (CONSTITUTION Art. 5.5 adopts
this section):

1. **Distribution-not-number.** The output is the shape of agreement —
   who ruled what, the spread, cross-prior convergence counts — never
   a fused scalar on the proposition. "Four adjudicators, three
   verdict states; the two whose records diverge most both ruled
   established-false" is licensed; "83% consensus: false" is not.
2. **Annotate-never-adjudicate.** Bridging output may gate attention
   (ordering a review queue, badging cross-prior convergence) — the
   visibility-not-verdict pattern — but never sets, weights, or
   auto-supersedes a verdict state, and never filters dissent out of
   view (I-9).
3. **Labeled as what it is.** Licensed estimates enter as their own
   labeled signal, quarantined by the never-merge firewall like every
   family — never as an upgrade to an existing kind. The
   measurement/estimation boundary is preserved by labeling, not by
   prohibition.
4. **Method-disclosed and re-derivable.** The computation's code and
   inputs are published and content-addressed; any reader recomputes
   it from public events. A bridging number nobody can re-derive is a
   black box wearing a transparency costume (P12).
5. **Roster-scoped or history-costly inputs only.** Prior-divergence
   estimation runs only over identities with substantial signed
   judgment histories, or within explicit rosters — never over the
   open set. And the thin-market admission: below a disclosed
   minimum-data threshold the feature is **dormant** — refusing to
   ship math-flavored noise is part of the license.
6. **Never crossing the never-merge firewall.** Bridging computes
   within one judgment family over one proposition. Cross-family
   composition remains a human reading side-by-side surfaces.
7. **Published as a signed, disputable measurement.** If a bridging
   summary is ever emitted to the wire, it is its computer's signed
   claim, carrying method hash and input coordinates, targetable by
   disputes.

Under these constraints, bridging is not the killed direction
resurrected — it is the two-witness independence rule (I-5) computed
at scale: the single most valuable new mechanism available technology
offers this protocol.

---

## §4. Honest limits

The constitutional honesty clauses — "honest at all times" includes
honest about itself. Adopted by the CONSTITUTION Preamble on this
document's ratification.

- **H-1. The protocol records; it does not compel.** No signature,
  hash, or verdict forces a single mind to update. Consensus of
  adjudicators is a fact about adjudicators, never a property of
  reality; the system's output is an offer of evidence, and assent
  remains free. A system that forgot this would need to become a
  coercion engine — a different, worse system.
- **H-2. Values and interpretations are outside the verdict's
  jurisdiction, permanently.** The §3.1 firewall is not a v1
  limitation to be lifted at scale; it is the boundary between an
  evidence protocol and an inquisition. The system may adjudicate
  what was said and done, and map how named perspectives read the
  rest — never which perspective is true.
- **H-3. Lies cannot be abolished at the source, and must not be.**
  An open protocol that could prevent utterance would be a censorship
  machine. The promise is narrower and real: cost, traceability, and
  stripped cover — not prevention. And in either case, the liar
  signs.
- **H-4. The machine proposes; the human judges; the reader
  concludes.** Every model suggestion is human-accepted; every
  verdict is one author's signed ruling; every entity-level
  conclusion is drawn by the reader from a coverage-capped record.
  Automation of judgment is not on the roadmap because it is not on
  the map.
- **H-5. The record is a sample, not a census, of a world it cannot
  fully see.** Coverage is disclosed and caps every aggregate;
  `unresolved` is a permanent honest state; what leaves no public
  trace is beyond the protocol's reach. The known-unknowns log is
  the system confessing this, artifact by artifact.
- **H-6. The protocol is not neutral about everything — and says
  so.** It presumes evidence over authority, signature over
  anonymity, symmetry over loyalty, and the survivability of honest
  error. These are values. They are the values that make shared
  fact-finding possible among people who share little else, and the
  system holds them openly rather than smuggling them.
- **H-7. The persuasion clause.** Truth that loses the persuasion war
  fails in the world — decades of measured reactor-safety data lost
  to a mushroom-cloud image. The protocol must therefore care about
  persuasion, and must be honest about what it may do. Legitimately
  in scope, all of it evidence-preserving: **legibility** (derivations
  followable — truth cheap to verify is persuasion's honest form);
  **translation** (the lens as a persuasion bridge built without
  deceit — the case restated in the audience's own named authorities,
  wearing the perspective's name, never the tool's voice);
  **teaching** (the forensic taxonomy as inoculation — naming the
  maneuvers teaches readers to see them, meeting the persuasion war
  on defense); and **calibrated presentation** (under-claiming as the
  slow strategy — credibility compounds precisely because it refuses
  to overreach). The line, drawn exactly: the system may make truth
  legible, translated, taught, and credible; it may never **optimize
  a message for belief-change** — no A/B-tested judgment surfaces, no
  emotional targeting, no audience-segmented emphasis, no
  engagement-ranked feeds (the network's newest-first, never-ranked
  feed is this clause already implemented). Optimizing for belief
  rather than evidence-fidelity is propaganda even in the service of
  true conclusions, because it wins assent by a mechanism that works
  equally well for lies — and a tool that wins that way has taught
  its audience to be won that way. **X-Ray fights the persuasion war
  by making honesty louder, never by making loudness a method.**
  Beyond that line, persuasion is the human work of the tool's users
  — rhetoric, relationship, and time — outside the protocol's
  guarantees, and the protocol is honest enough to say it cannot do
  that work.

---

## Amendment log

**v1.0.0 — 2026-07-22.** Initial synthesis: sixteen systems, eighteen
invariants, nine subversion modes with residual risks stated, the
seven-constraint bridging license (§3.3, adopted by CONSTITUTION
Art. 5.5), seven honest-limits clauses (adopted by the CONSTITUTION
Preamble).

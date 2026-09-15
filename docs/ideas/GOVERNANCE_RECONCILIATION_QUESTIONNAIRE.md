# Governance Reconciliation Questionnaire

**Status:** working material — **non-normative**. This document amends
nothing, rules on nothing, and recommends nothing. It is the prepared
agenda for the maintainer's announced founding-intent reconciliation
session (2026-08-28: *"there needs to be a reconciliation between my
original intentions and what has been codified into the Constitution
and other governing policy documents"*). Every item is a question;
the maintainer arbitrates (CONSTITUTION Art. 11). Nothing here takes
effect until the maintainer's own ruling lands through the proper
organ (Art. 13) — and "keep, unchanged" is a complete answer to every
question below.

**Date prepared:** 2026-08-28
**Method:** the governance discipline's divergence-brief mode
(`.claude/skills/governance/SKILL.md`, in flight on
`claude/loving-gauss-k8gsta`, created by maintainer directive
2026-08-28), with one deviation on the maintainer's standing rule:
questions are presented **neutrally, without recommendations** —
because the failure pattern under review is precisely agents
hardening their own readings into policy.

---

## §0. How to read this document

### The failure pattern under review

The maintainer named it (2026-08-28): *overeager interpretation* — a
directional philosophy statement gets hardened into a specific rule
by an agent, without the interpretive step being surfaced for
vetting, and the accretions add up. Two documented specimens:

1. **The "server/relay" specimen.** A UX review treated the
   philosophy line "NOSTR stays invisible" as *violated* by user copy
   containing the word "relay," and derived a vocabulary rule (user
   copy says "server," never "relay"). The maintainer flagged the
   step as an interpretation, not a governance derivation; it now
   stands provisionally, logged for this reconciliation
   (`docs/MARGIN_DESIGN.md` §10 row 6 and §12.6;
   `docs/MARGIN_UX_REVIEW.md` C5 — in flight, 2026-08-28).
2. **The MA.6 disclosure specimen (the pattern caught and
   reversed).** The extraction-publish design first codified the
   "obvious" conservative rule — *nothing publishes that the user has
   not reviewed* — and it shaped a whole implementation before the
   maintainer reversed it to whole-unit disclosure ("a filter a
   reader cannot see cannot be audited"). The first rule was an
   agent-plausible reading of the accept-gate posture that did not
   match the maintainer's actual intent (`docs/JOURNAL.md`
   2026-07-29, "the decision was taken twice, and the reversal is the
   point").

This questionnaire hunts for rules of that shape across the
governance corpus: normative text that does not trace cleanly to
(a) the founding transcript or (b) a recorded maintainer ruling.

### The evidence ladder

Each item cites the strongest provenance found, on this scale.
Art. 14 makes a maintainer merge the ratifying act for any normative
change, so *everything* below E5 is technically ratified — but a
merge ratifies a PR wholesale, and is **weaker evidence of considered
intent on any single clause** than an explicit recorded ruling. The
ladder makes that distinction usable:

| Grade | Evidence | Example |
|---|---|---|
| **E1** | Explicit recorded maintainer ruling, quoted or dated (JOURNAL entry, supersession-log ruling, kickoff decision note in the maintainer's voice) | the 2026-08-02 transcript rulings; the MA.6 reversal; "kill them all" (2026-08-09) |
| **E2** | Amendment-log entry with rationale, through the document's own organ | PHILOSOPHY v1.1.0 narrowings |
| **E3** | JOURNAL "owner decision" / recorded second-guessable-call note | the 2026-07-03 descopes; the quote-grounding contract's recorded calls |
| **E4** | Design-doc or kickoff clause with a maintainer-attributable decision marker ("per confirmed default", "the maintainer wants…") | TRUTH_ADJUDICATION §3.5 "per confirmed default" |
| **E5** | Ratified-by-merge only (Art. 14) — the clause appears in a merged normative doc with no recorded discussion of the clause itself | most of the constitution's Concord Schedule text; TS H-1–H-7 |

An **E5 grade is not an accusation** — most E5 clauses are probably
exactly what the maintainer wants. It marks where a considered
keep/amend/demote answer is worth thirty seconds of the session,
because nothing on the record shows the clause was individually
weighed.

### What each item carries

Per the session's brief: the codified rule with its exact citation;
the closest founding-transcript antecedent (or "none found" — noting
that most post-audit families postdate the transcript entirely, so
absence is often expected, not damning); where the rule appears to
have been introduced; the **interpretation steps**, labeled
explicitly where a broader principle was narrowed into a specific
rule; and a neutral question. Suggested answer vocabulary, per item:

> **keep** (unchanged, now with a recorded ruling) · **amend** (state
> how; the change then takes its Art. 13 tier and ceremony) ·
> **demote to guidance** (the text survives as advisory, loses
> binding force) · **defer** (park for casework evidence, per the
> maintainer's validation-in-casework preference).

### What this document does NOT re-litigate

The 2026-07-23 packaging and 2026-08-02 integration rounds already
ruled on the founding transcript's mechanisms (the supersession log
in `docs/FOUNDING_TRANSCRIPT.md`), and a set of later decisions are
E1–E3 on this ladder. Those are listed in §5 as the
*already-reconciled ledger* — for the session's reference, not for
reopening. Citation conventions follow the binding project rule
(CONSTITUTION "How to use this document"): bare `P<n>` =
PHILOSOPHY.md; `CONSTITUTION Art. <n>`; `<DOC> §<n>`; TS clause IDs
(`I-n` / `S-n` / `H-n`). Transcript material is cited by exchange
("Exchange 1/2/3") and is non-normative (Art. 2).

---

## §1. Load-bearing divergences

Ordered by how much of the system stands on each rule.

### Q1. The never-merge firewall's constitutional scope (Art. 6, data arm)

- **Codified rule:** "Composition is lawful; fusion is not. … no
  number or state in one family may be computed *from* another
  family's judgment … and consumers MUST NOT merge them"
  (CONSTITUTION Art. 6), enforced as red line 4 (Art. 12) and
  echoed in Art. 5.2 condition 5.
- **Founding antecedent:** none found for cross-family separation —
  and the transcript's direction of travel is the opposite: "both
  produce a normalized 0–100 score on a common axis: *how much
  should a rational reader update their beliefs based on this
  piece?* That's the comparable quantity" (Exchange 1), plus
  cross-publication scoreboard aggregation as the flagship output.
  Context that keeps this honest: every non-audit family
  (assessments, forensic, truth, lens, case analysis) postdates the
  transcript, so it *could not* have addressed their separation; and
  the audit family internally keeps the common axis (PHILOSOPHY §0).
  The absence of an antecedent is expected. What has no recorded
  ruling is the *generalization*.
- **Introduced:** as a two-kind wire-consumer rule in
  `docs/NIP_DRAFT.md` (30051 vs 30054, Phase 9a: "different
  aggregation signals; consumers MUST NOT merge them") → applied
  "with full force" and extended per-family in
  EPISTEMIC_AUDIT_DESIGN ("The firewall: audits are not
  assessments", Phase 13) → repeated for each new family (Phases
  14–16, 20) → constitutionalized as Art. 6 with linguistic and wire
  arms (drafted 2026-07-22, ratified 2026-08-02). The ratification
  JOURNAL entry records maintainer revisions to Art. 8 and Art. 9 —
  none to Art. 6.
- **Interpretation steps (labeled):** (1) a consumer rule for two
  specific kinds became (2) a design idiom applied to every new
  family, became (3) a supreme-law article binding all present and
  future families, with a red line. Each step was plausible; none is
  recorded as individually ruled.
- **Evidence:** E5 for the constitutional generalization (E3-ish
  roots for the original 30051/30054 idiom).
- **Question:** Does Art. 6 as written match your intent — a
  permanent, all-pairs, constitutional fusion ban — or did the
  firewall accrete past it? Options include: keep; amend to
  enumerate which family pairs must never fuse (leaving new pairs a
  design decision); demote the article to statute-level (family
  design docs) and keep only red line 4; or keep the data arm but
  revisit the arms separately (Q4, Q5).

### Q2. Permanence of the adjudicability firewall (§3.1 / TS H-2)

- **Codified rule:** interpretations and stated values are not
  adjudicable as true/false (TRUTH_ADJUDICATION_DESIGN §3.1, §3.4
  value firewall, §5 red line 7) — and, one step further, TS H-2
  declares the firewall **permanent**: "not a v1 limitation to be
  lifted at scale; it is the boundary between an evidence protocol
  and an inquisition."
- **Founding antecedent:** partial. Exchange 1: "Opinion gets graded
  on *argument*, not *conclusion* — we never score whether the
  author was 'right' politically." That is a scoring-scope rule
  (opinion still gets a 0–100 on reasoning quality). The Phase-15
  extension — interpretation/value *propositions may not be ruled on
  at all*, with the lens as the far side of the wall — goes further
  than the transcript, in the same spirit.
- **Introduced:** TRUTH_ADJUDICATION_DESIGN §3.1 (Phase 15, PR
  train #79–#86); PHASE_15_KICKOFF flags it "the whole point — do
  not soften it" (E4). The **permanence** clause is TS H-2 (drafted
  2026-07-22, landed via PR #263) — E5.
- **Interpretation steps (labeled):** "never score a conclusion"
  (transcript) → "interpretations/values are outside the verdict's
  jurisdiction" (Phase 15) → "…permanently, and lifting it would
  make the tool an inquisition" (TS H-2). The last step converts a
  design boundary into an unamendable-in-spirit commitment.
- **Evidence:** E4 for the firewall itself; E5 for its permanence.
- **Question:** Keep H-2's permanence language as is, or restate it
  as standing law amendable through ordinary Art. 13 ceremony (which
  it formally is — "permanent" is rhetoric the amendment process can
  technically override)? Separately: does the firewall's *scope*
  (the `interpretation` class swallowing everything from causal
  readings to policy judgments) match your casework experience, or
  has real COVID-corpus work found propositions the class wrongly
  fences off?

### Q3. "No case-level score, ever" — and the Art. 5.4 door

- **Codified rule:** CASE_DOSSIER_DESIGN §2.2 ("No case-level
  score, ever"), concord-pinned into CONSTITUTION Art. 4.4 ("no
  case, entity, or corpus ever carries a fused score");
  Art. 5.4 forbids "a fused case-probability as a case's headline or
  verdict" while explicitly leaving a door open: "a labeled,
  method-shown, spread-shown probability instrument rendered beside
  (never above) the deterministic record is a separate feature
  decision that must pass this article."
- **Founding antecedent:** divergent-but-different-object. The
  transcript's flagship outputs are aggregates — "Beat dossier:
  cross-publication scoring on a defined topic. This is where the
  system produces its highest-value outputs" (Exchange 3). But a
  beat scoreboard aggregates *audit scores of artifacts* (which the
  audit family still lawfully does, with shrinkage, under P1/§4),
  whereas a case score would fuse a *probability over hypotheses* —
  an object the transcript never proposes. The divergence is real
  but narrower than it first looks.
- **Introduced:** Phase 20 (CASE_SYNTHESIS_DESIGN §5,
  CASE_DOSSIER_DESIGN §2.2, with schema-level no-numeric-slot
  guards); constitutionalized 2026-07-22/08-02. The Rootclaim
  framing ("no *as a conclusion*") is Art. 5.4's.
- **Evidence:** E5 (the Phase 20 docs argue the rule from
  PHILOSOPHY citations; no recorded maintainer ruling on the case
  question specifically was found; the 2026-08-02 entry rules on
  narrowing the *aggregation kill*, adjacent but distinct).
- **Question:** (a) Keep the no-fused-case-score rule at
  constitutional strength? (b) The Art. 5.4 door — a licensed,
  labeled probability instrument beside the record — is currently
  written as "a separate feature decision" nobody has taken: do you
  want it explored, explicitly closed, or left as is? Answering (b)
  either way would resolve the firewall's most-contested edge in
  advance rather than mid-casework.

### Q4. The reserved truth-family vocabulary (Art. 6, linguistic arm)

- **Codified rule:** "the reserved vocabulary (Verdict, Ruling,
  Opinion, Court, Integrity) belongs to the truth family and never
  appears in other families' exports, storage keys, or UI strings"
  (CONSTITUTION Art. 6).
- **Founding antecedent:** none — with a notable inversion: the
  Phase-16 source prompt (the founding ask for the phase) used the
  court metaphor ("Online Court of Justice / rulings / verdicts /
  opinion"), and the design *ruled that vocabulary out* to protect
  the Phase-15 firewall's legibility (MORAL_LENS_JURISDICTION_DESIGN
  §5.2: "the names are binding").
- **Introduced:** MORAL_LENS §5.2 (Phase 16; the design was amended
  2026-07-03 and the amendment governs), scoped to *Phase 16*
  exported symbols, storage keys, and user-visible strings, with the
  16.4 grep guards. Art. 6 then generalized the rule to **all**
  families' exports, storage keys, and UI strings (2026-07-22/08-02).
- **Letter-vs-practice gaps, found while preparing this item:**
  (1) "Opinion" is everyday audit-family vocabulary — PHILOSOPHY
  §3.2 ("Opinion artifacts"), the OQ.2 opinion-module family, UI
  strings included — so the article's letter is already violated by
  a sibling statute, presumably because Art. 6 means *court*
  opinion; the text does not say so. (2) The machine guard is much
  narrower than the prose: `tests/constitution-guards.test.mjs`
  checks *export names of three builder modules* for
  `/verdict|ruling/` and `/score|rating|percent/`; the five-word
  rule over "exports, storage keys, or UI strings" of every family
  is enforced nowhere outside Phase 16's own lens guards.
- **Interpretation steps (labeled):** a metaphor-collision fix in
  one design → binding naming law for one phase → a constitutional
  vocabulary reservation over every surface of every family, whose
  prose outruns both its enforcement and existing lawful usage.
  This is the same shape as the server/relay specimen, one tier up.
- **Evidence:** E5 (the §5.2 rename itself is arguably E4 — the
  design records the collision reasoning — but the project-wide
  generalization has no recorded ruling).
- **Question:** Keep the linguistic arm at constitutional strength;
  amend the word list and scope to what is actually meant and
  enforced (e.g. drop or qualify "Opinion"; name the surfaces); or
  demote the arm to design guidance (MORAL_LENS §5.2 keeps doing
  the real work)? Related: was ruling out your own court metaphor
  the right call, or worth revisiting now that the firewall is
  established?

### Q5. Kind 30066 — "permanently unassigned" vs the deferred lens tail

- **Codified rule(s), in conflict:** CONSTITUTION Art. 10's table:
  "30066 | free | **permanently unassigned** — the lens has no wire
  kind," and Art. 6: "kind 30066 stays free," guard-tested. Versus:
  ROADMAP Phase 16 — "its **wire-kind**/portal/durable-cache tail is
  **deferred**" — and MORAL_LENS §5.2's forward provision: "if a
  `30066` surface ever exists, hyphenated tokens need no breaking
  rename."
- **Founding antecedent:** n/a (the lens postdates the transcript;
  the maintainer's Phase-16 prompt arguably implied publishable
  outputs, which the design demoted to a derived view).
- **Introduced:** the derived-view-only posture is Phase 16 design;
  "permanently unassigned" is the constitution's wording
  (2026-07-22/08-02).
- **The divergence:** one document says the lens wire kind is a
  deferred tail (an ordinary later design decision); the supreme
  document says the number is permanently free (reversal = Tier-1
  amendment). Under the current table, a future lens wire kind
  would also have to take a *different* number even if ratified.
- **Evidence:** E5 both sides; no recorded ruling picking one.
- **Question:** Which is intended — (a) the lens may someday earn a
  wire kind (amend Art. 10's row to "reserved" or soften
  "permanently"), or (b) the lens is derived-view-only forever
  (amend ROADMAP/MORAL_LENS to stop calling the wire kind
  "deferred")? Either answer removes a standing doc-vs-doc
  contradiction.

### Q6. Art. 7's generalizations: published-positions-only, intent, identity

- **Codified rule:** criticism attaches to behaviors, claims, and
  artifacts, never identities or groups; **intent is never
  adjudicated — in every family**; **living persons get
  published-positions-only reconstruction**; good-faith-wrong is
  never treated as bad-faith (CONSTITUTION Art. 7, red line 5).
- **Founding antecedent:** partial. "We audit artifacts, not
  people" is codified from the transcript's spirit (and PHILOSOPHY
  §0 states it directly). But the transcript also builds author
  dossiers with **exposure files** — "financial holdings…, political
  donations, prior employment, family relationships" (Exchange 1) —
  which is identity-adjacent machinery the codified law keeps
  (P12, PHILOSOPHY §3.3) alongside Art. 7's identity ban. The two
  coexist if disclosure is not criticism; no document says that out
  loud. "Intent is never adjudicated" originates in Phase 14
  (CRIMINOLOGY structure-not-intent) and Phase 15 (§3.4);
  "published-positions-only" originates as the lens's living-person
  guardrail (Phase 16). Art. 7 promotes both family rules to
  project-wide law.
- **Interpretation steps (labeled):** per-family authoring rules →
  universal constitutional obligations; plus the unstated
  reconciliation between exposure files and the identity ban.
- **Evidence:** E5 for the generalizations (the family-level
  originals are E4 — each design argues its rule).
- **Question:** Confirm the promotions (intent-ban and
  published-positions-only as universal law), and state for the
  record whether exposure-file disclosure is compatible with Art. 7
  as you intend it — or should Art. 7 carry the sentence that says
  disclosure is not criticism?

### Q7. "Weight follows track record" (P-era) vs never-count-open-sets

- **Codified rules, pointing different directions:** PHILOSOPHY §8:
  "Weight follows track record: contributors whose findings hold up
  gain influence; those whose findings collapse lose it" — statute
  text, from the transcript ("Verifiers who turn out wrong over time
  lose weight; those who turn out right gain weight," Exchange 3).
  Versus: the 2026-07-03 consensus kill (E3), TS S-2 ("the system
  counts nothing over open sets"), and Art. 5.5 — computed authority
  forbidden; bridging admissible only roster-scoped/history-costly,
  as measurement, dormant below a data threshold; v1 defers all
  weighting (TRUTH_ADJUDICATION "Scope of v1").
- **The divergence:** the founding vision and its codification in
  PHILOSOPHY §8 promise reputation-weighted influence; the
  constitution's Sybil posture forbids the naive version and
  licenses only a narrow, deferred form. Nothing implements either,
  so there is no live conflict — but the two normative texts give a
  future implementer opposite directions of travel.
- **Evidence:** the kill and its narrowing are E1/E3; PHILOSOPHY §8
  stands unamended.
- **Question:** Should PHILOSOPHY §8 gain a clarifying sentence
  (weight-follows-track-record is realized only under Art. 5.5's
  constraints — roster-scoped or history-costly, never open-set), or
  is the tension acceptable as is with the constitution simply
  governing on conflict (Art. 14)?

### Q8. Art. 2's capability rule — design docs as licensing law

- **Codified rule:** "A capability exists when a design document
  under this constitution specifies it, and not before"
  (CONSTITUTION Art. 2).
- **Founding antecedent:** none found. Process rule, no transcript
  analog.
- **Introduced:** Art. 2, named in the 2026-08-02 reconciliation
  (the non-normative-tier paragraph).
- **Why it is load-bearing for this session:** this is the rule that
  makes agent-drafted design prose *licensing law* on merge — the
  amplifier of the exact failure pattern under review. Every
  overeager interpretation embedded in a design doc becomes, via
  Art. 2 + Art. 14, part of what "exists" and what later documents
  must cite and obey.
- **Evidence:** E5.
- **Question:** Keep as is, or pair it with a provenance discipline:
  e.g., require new design docs to carry a MARGIN_DESIGN §10-style
  constraint-provenance table (each binding constraint tagged
  Constitutional / Statute / Recorded ruling / **Interpretation** /
  Engineering fact), so interpretation steps are visible at
  ratification time instead of excavated later? (See Q12 for the
  enforcement half.)

### Q9. The estimation license's five conditions (Art. 5.2)

- **Codified rule:** an estimation is lawful iff Declared /
  Derived-in-the-open / Spread-shown / Stakes-bounded /
  Firewall-respecting; "an estimation failing any condition does not
  appear," including "a number separated from its label may not be
  rendered" (CONSTITUTION Art. 5.2).
- **Founding antecedent:** strong for the spirit — the transcript is
  saturated with published-uncertainty machinery (confidence
  intervals, shrinkage, "71 ± 8"). The *hard suppression rule* (fail
  one condition → the number may not appear at all) is a codified
  sharpening with no transcript analog.
- **Introduced:** Art. 5 (2026-07-22), enacting the maintainer's
  narrowing of the 2026-07-03 kill — the reopening itself is E1
  (2026-08-02 JOURNAL: a doctrine had hardened "the maintainer never
  intended"); the five conditions' specific text is agent-drafted.
- **Interpretation steps (labeled):** maintainer direction
  ("estimates are lawful as instruments, not verdicts") → a specific
  five-condition test with a suppression rule and label-travel
  mechanics.
- **Evidence:** E1 for the license existing; E5 for its exact
  conditions.
- **Question:** Confirm the five conditions as drafted (they now
  gate every future estimate/aggregate feature), or amend — in
  particular, is hard suppression ("does not appear") the intended
  failure handling, versus e.g. render-with-a-defect-flag?

### Q10. TS H-7's persuasion bans vs the founding accessibility ask

- **Codified rule:** the persuasion line — legibility, translation,
  teaching, calibrated presentation in scope; "never optimize a
  message for belief-change — no A/B-tested judgment surfaces, no
  emotional targeting, no audience-segmented emphasis, no
  engagement-ranked feeds" (TS H-7, adopted by the CONSTITUTION
  Preamble).
- **Founding antecedent:** none against; one adjacent *for*: the
  transcript's Exchange 3 asks "How do we make epistemic auditing
  more accessible to the masses?" — accessibility machinery (tiers,
  dashboards) is founding intent; H-7 constrains which instruments
  accessibility may use.
- **Introduced:** TS §4 (drafted 2026-07-22, PR #263); the
  network's newest-first feed is cited as the clause already
  implemented.
- **Evidence:** E5. (The clause is carefully scoped — "judgment
  surfaces" — but the scoping is the agent's.)
- **Question:** Confirm H-7's ban list and its scope (e.g., is
  A/B-testing *non-judgment* surfaces — onboarding, docs, a
  scoreboard's layout legibility — inside or outside the ban as you
  intend it?), or amend the scope line to say so.

### Q11. DISCIPLINES' self-binding standards — and one live tension

- **Codified rule:** for disciplines whose status is "partial," the
  standards in DISCIPLINES.md "bind from this document until a
  fuller statute exists" (DISCIPLINES §0). Examples of binding,
  agent-derived standards with no founding antecedent and no
  recorded per-clause ruling: §11.5 (the chilling-effect test
  "applied to every new judgment surface before it ships"), §10.5
  (an adversarial step's rejection rate is a checkable fact), §15.3
  ("One accept per artifact — bulk credulity is not review").
- **A live letter-vs-practice tension:** §15.3 reads as forbidding
  bulk acceptance, while the shipped review surfaces have an
  "Accept all valid" control (JOURNAL 2026-07-03, quote-grounding
  entry — the control was *kept* and merely barred from taking
  ungrounded items; `feat/extraction-accept-all` exists as a
  branch). Either §15.3 means something narrower than it says, or
  the product violates its statute.
- **Introduced:** DISCIPLINES v1.0.0 (2026-07-22; reworked
  pre-adoption on maintainer review from the "college of personas"
  draft — that rework is E1, but it addressed the method, not these
  clauses).
- **Evidence:** E5 per clause.
- **Question:** (a) Confirm that partial-status standards bind (vs
  demoting them to guidance until each graduates). (b) Rule the
  §15.3 / Accept-all-valid tension explicitly: is bulk-accept of
  individually-validated, individually-groundable proposals
  compatible with "one accept per artifact," or should one of the
  two change?

### Q12. The guard regime — doctrine pinned verbatim, provenance unmarked (meta)

- **Codified practice:** `tests/constitution-guards.test.mjs` pins
  load-bearing clauses verbatim, two-sided; "a red guard is a bug or
  an unratified amendment, never a test to fix" (CONSTITUTION
  header; Art. 12). The regime is excellent at preventing silent
  drift — and exactly as good at freezing **agent-drafted prose the
  maintainer never individually weighed** (every E5 clause above
  that is guard-pinned now requires Tier-1/2 ceremony to reword).
- **Founding antecedent:** n/a (enforcement machinery).
- **Introduced:** with the constitution (2026-08-02, E1 for the
  regime existing).
- **Question:** Should the corpus adopt provenance marking so the
  next reconciliation is cheap — e.g. (a) the MARGIN_DESIGN §10
  provenance-table pattern required in new design docs (see Q8);
  (b) an annotation in the guard file or the amendment logs
  distinguishing clauses with recorded rulings (E1–E3) from
  merge-ratified drafting (E5); (c) neither — the JOURNAL and
  amendment logs are enough?

---

## §2. The firewall inventory

The maintainer (2026-08-28): *"there are so many 'firewalls' built
into designs as we go."* This section inventories every named
firewall construct found in the corpus. Summary table first;
per-item detail below for the ones not already covered by a §1
question. "Cost" is stated in UX or capability terms; "protects" in
the design's own terms — neither column is an argument for either
side.

| # | Firewall | Codified in | Founding antecedent | Introduced | Ruling evidence | Question |
|---|---|---|---|---|---|---|
| F1 | Audit ≠ assessment (wire): 30056–30061 never carry stance/labels; 30051/30054 never carry score/ceiling; consumers MUST NOT merge | NIP_DRAFT §30054/§30056; EPISTEMIC_AUDIT_DESIGN "The firewall" | none (predates families) | Phase 9a idiom → Phase 13 full force | E5 | folded into Q1 |
| F2 | The never-merge firewall (all families, data arm) | CONSTITUTION Art. 6; Art. 12 red line 4 | none — transcript runs the other way (one common axis) | Art. 6, 2026-07-22 | E5 (generalization) | **Q1** |
| F3 | Reserved truth vocabulary (linguistic arm) | CONSTITUTION Art. 6; MORAL_LENS §5.2 | none — inverts the maintainer's own court metaphor | Phase 16 → Art. 6 | E5 | **Q4** |
| F4 | Wire arm: 30066 permanently free; 30065 reserved; never-reuse | CONSTITUTION Art. 6, Art. 10 | none | Art. 10 | E5; conflicts with ROADMAP | **Q5** |
| F5 | Adjudicability predicates (§3.1) + value firewall (§3.4) + reputation-eligibility gate (§3.5) | TRUTH_ADJUDICATION_DESIGN; TS H-2; DISCIPLINES §4 | partial ("argument, not conclusion", Exchange 1) | Phase 15; permanence via TS H-2 | E4 firewall / E5 permanence | **Q2** |
| F6 | Defamation firewall: subjects vs asserters; no auto-emitted person-grade or "liar/hypocrite" label; reader draws the conclusion | TRUTH_ADJUDICATION §3.5; ENTITY_DOSSIER_DESIGN §3.5-applications | partial (dossiers yes, but transcript has no label ban) | Phase 15 ("principle, not a v1 deliverable") | E4 ("per confirmed default" on §3.5's frame) | Q13 |
| F7 | Audit **visual** firewall: audit / assessment / lens blocks "never visually merge, sum, or share a color scale" | EPISTEMIC_AUDIT_DESIGN badge rule 6; `src/reader/index.html` ~119–131, ~142 | none | Phase 13.5/13.6 UI rules | E5 | Q14 |
| F8 | Quote-grounding acceptance firewall: validate → ground → filter → human-accept; the model's quote is a search key; paraphrase is a hard reject | PHASE_14_5 kickoff §4; JOURNAL 2026-07-03; CASE_SYNTHESIS §4; DISCIPLINES §3.3 | strong (P3 lineage; "point to specific sentences", Exchange 3) | Phase 14.5 → hardened 2026-07-03 | E3 (recorded second-guessable calls) | none — noted for costs only |
| F9 | The membrane: accept-only incorporation; viewing writes nothing | NETWORK_CLIENT_DESIGN header ("Maintainer decisions, 2026-07-16, recorded from planning") + §5 recorded decisions | none (network postdates transcript) | Phase 25 planning | E1/E3 | none |
| F10 | Never-count-open-sets (Sybil abstinence) | TS S-2; Art. 5.5; DISCIPLINES §13 | none | 2026-07-03 kill → TS | E1/E3 roots | **Q7** |
| F11 | 30064 deliberately-no-mirror (integrity findings get no 1985 label mirror) | CLAUDE.md event-builder note; NIP_DRAFT mirror rules | none | Phase 15 wire decisions | E5 | Q13 (same family) |
| F12 | Lens derived-view-only complex: session-ONLY cache, deliberately no storage.local fallback; no wire kind | MORAL_LENS design; CLAUDE.md Phase-16 note | none (arguably against the Phase-16 prompt's implied publishable rulings) | Phase 16 | E5 | **Q5** + Q15 |
| F13 | Consent/provenance firewall on imports: mergeBackup accrues by id, local wins, config/identities never merged; "from machine vs from someone else" provenance on merges | ROADMAP (map-artifact wave); JOURNAL 2026-07-25/08 entries | none | MA-wave + KS work | E3-ish (design entries) | none |

### F6 + F11 detail → Q13. The defamation firewall's reader-burden cost

**What it protects:** the powerless and the wrongly-accused —
verdicts attach to propositions; entity records are coverage-capped
catalogs; no auto person-label ever; the accusation machinery costs
its user standing (no free shots). **What it costs:** even a
damning, well-adjudicated record never produces an entity-level
summary judgment — the reader must synthesize the catalog
themselves; and 30064's no-mirror means integrity findings are less
discoverable than every other labeled kind (a consumer browsing 1985
mirrors never sees them). **Founding antecedent:** the transcript
freely publishes author-level rollups ("the more durable claim was
always at the author and outlet level," Exchange 2) — though of
craft-quality, not of honesty. **Question (Q13):** confirm the
firewall's current strength — specifically (a) that the reader-side
synthesis burden is the intended price, and (b) that 30064's reduced
discoverability (no mirror) is intended rather than an
over-application of the defamation posture to the wire layer.

### F7 detail → Q14. The visual firewall's screen-estate cost

**What it protects:** implied fusion — a reader can never mistake a
stance for a score or a reading for a verdict because the blocks
share nothing, not even a color scale. **What it costs:** the reader
page is a stack of five-plus visually quarantined sections with no
combined overview; the in-flight margin design spends most of its §4
and §5.3 inventing a rail/one-tint compromise to respect this while
putting families on one text (MARGIN_DESIGN, in flight). The
transcript's public surface was a single integrated report.
**Introduced:** EPISTEMIC_AUDIT_DESIGN badge rule 6 and the reader
HTML comments (Phase 13.5/13.6) — an extension of the data firewall
into presentation, never separately ruled. **Question (Q14):** is
the visual arm binding law (worth pinning properly), guidance, or a
Phase-13 default the margin work is free to renegotiate surface by
surface — provided fusion (sums, blended scales) stays out?

### F12 detail → Q15. The lens session-only cache

**What it protects:** derived-view purity — no durable artifact that
could be mistaken for (or leak as) a judgment record. **What it
costs:** real money and time — every lens reading re-runs an API
call after a session ends; the portal cannot show past readings; the
ROADMAP itself lists "durable-cache" in the deferred tail.
**Question (Q15):** keep session-only as a firewall, or reclassify
durable caching as an ordinary deferred feature (local-only cache,
no wire kind — which would leave F4/Q5 untouched)?

---

## §3. Vocabulary rules (the specimen class)

### Q16. "NOSTR stays invisible" — write the line down, with its force stated

- **Current status:** the line exists as maintainer design
  philosophy (the N=1-then-network posture) and is cited by designs
  (MARGIN_DESIGN §1, in flight) — but it appears in **no governance
  document**, which is exactly why a review could harden it into a
  vocabulary rule unvetted (the server/relay specimen, §0).
- **Question:** should the line (and its siblings — high value solo
  first; Apple-quality simplicity) be recorded somewhere citable —
  e.g. the aspirational `docs/VISION.md` that Art. 2 already
  anticipates, or a short design-principles note — **with its
  intended force stated** ("directional principle: interfaces should
  not require NOSTR literacy — not a vocabulary ban")? A recorded
  force statement is the cheapest structural fix for this failure
  pattern: interpretation then has a text to be checked against.
- (The "server vs relay" copy itself already has its process:
  provisional, maintainer may overrule at the S1 walk, logged for
  this reconciliation — MARGIN_DESIGN §12.6. No second question
  needed here; the walk answers it.)

### Q17. "Integrity" adjacency and the renaming tax

- **Codified rule:** Phase 15 owns "Integrity" (F3/Q4); Phase 16's
  per-jurisdiction honesty report is therefore named "grounding
  report" (MORAL_LENS §5.2 calls the alternative "indefensible").
- **Cost:** an ordinary English word is unavailable everywhere
  outside one family; every future surface pays a naming tax
  (grounding report, lens-reading, disposition…), and users meet
  invented vocabulary where common words exist.
- **Evidence:** E5.
- **Question:** keep the reservation as is, or narrow it to
  *labeled artifact names* (a block may not be *titled* Integrity)
  rather than all UI strings? This is a subset of Q4 — answering Q4
  "amend/demote" likely answers this; it is separated because the
  cost shows up in every future design review.

---

## §4. Session mechanics — two meta-questions

### Q18. What counts as a ruling, going forward?

The evidence ladder (§0) exists because the corpus does not
distinguish "the maintainer decided this" from "an agent drafted
this and the PR merged." Kickoff prompts sit ambiguously (some
clauses are maintainer dictation, some agent scaffolding).
**Question:** adopt a convention — e.g., decisions the maintainer
actually made get a dated "(maintainer, YYYY-MM-DD)" marker in the
doc or a JOURNAL line at merge time, and everything unmarked is
understood as drafting — so the *next* reconciliation is a grep, not
an excavation? (Art. 11's decision-recording rule already requires
this for kills and resolved questions; the gap is design-doc
normative clauses.)

### Q19. Disposition recording for this questionnaire

When the session runs: each Qn's answer (keep / amend / demote /
defer) presumably lands as a JOURNAL entry plus the Art. 13-tier
ceremony for any amendment. **Question:** should the answered
questionnaire itself be preserved (answers inline, superseding
banner, moved beside the supersession log) as the reconciliation's
record — the same pattern as FOUNDING_TRANSCRIPT's supersession log
— so the "why" of each keep survives as citably as the "what" of
each amend?

---

## §5. The already-reconciled ledger (not for reopening)

Recorded rulings the session can rely on rather than re-litigate.
Listed so this questionnaire visibly builds on prior work:

| Ruling | Date | Record |
|---|---|---|
| Opaque weights superseded by P12/§4 (published, versioned weights) | 2026-07-23 | FOUNDING_TRANSCRIPT supersession log |
| Volatility metric dropped (newsroom-only) | 2026-08-02 | supersession log |
| 30d/6m/2y re-audit cadence dropped; event-driven re-evaluation; PHILOSOPHY §5 amended | 2026-08-02 | supersession log; PHILOSOPHY §13 v1.1.0 |
| Adversarial/red-team reviewer dropped as audit machinery (lives on as the forensic counter-read) | 2026-08-02 | supersession log |
| Auditor's standing self-dossier narrowed (P10 v1.1.0) | 2026-08-02 | supersession log; PHILOSOPHY §13 |
| Reach weighting demoted to optional display view | 2026-08-02 | supersession log |
| Triage queue parked, not superseded | 2026-08-02 | supersession log |
| Public relays only; no self-hosted relay | 2026-07-03 | JOURNAL (owner decision) |
| Consensus/aggregation direction killed → narrowed to the Art. 5 license (computed authority stays dead) | 2026-07-03 → 2026-08-02 | JOURNAL both dates |
| Art. 8 made gateless on maintainer review (accountability on the published record, never a pre-publication gate) | 2026-07-22 | JOURNAL 2026-08-02 entry |
| Art. 9 redrawn from "college of personas" to derived discipline standards | 2026-07-22 | JOURNAL 2026-08-02 entry; DISCIPLINES §13-equivalent log |
| MA.6 whole-unit disclosure (reversing the agent-codified review-gate rule) | 2026-07-29 | JOURNAL |
| All fifteen 1.0 kill candidates ratified ("kill them all"), then executed with per-entry re-vet notes governing | 2026-08-09 | JOURNAL; ROAD_TO_1_0 status notes |
| Phase-9a kinds reclassified reserved-not-retired; never-reuse holds for both | 2026-08-09 | JOURNAL; CONSTITUTION Art. 10 |
| The membrane: accept-only incorporation | 2026-07-16 | NETWORK_CLIENT_DESIGN header maintainer decisions + §5 recorded decisions |
| "Suggest provenance is grounded" — quote-as-search-key contract, with its second-guessable calls recorded | 2026-07-03 | JOURNAL |
| Margin "server/relay" copy provisional; interpretation flagged and logged for this reconciliation | 2026-08-28 | MARGIN_DESIGN §10 row 6, §12.6 (in flight) |

---

## Appendix — coverage note

Documents read in full for this questionnaire: FOUNDING_TRANSCRIPT
(including the supersession log), CONSTITUTION, PHILOSOPHY,
TRUTH_SYSTEMS, DISCIPLINES, TRUTH_ADJUDICATION_DESIGN (§§1–5),
MORAL_LENS_JURISDICTION_DESIGN (§§1, 5), EPISTEMIC_AUDIT_DESIGN
(firewall + display sections), CASE_SYNTHESIS_DESIGN §4,
PHASE_15_KICKOFF, PHASE_14_5 kickoff §4, MARGIN_DESIGN /
MARGIN_UX_REVIEW (in flight), and targeted JOURNAL history.
Skimmed: TRUTH_INFRASTRUCTURE (non-normative; no divergences of its
own — its refusals restate standing law). The guard tests
(`tests/constitution-guards.test.mjs`) were read where cited to
compare enforced scope against prose scope (Q4, Q12). Anything this
questionnaire missed is a gap in preparation, not a ruling of
irrelevance — the session can add items freely.

# TRUTH_ADJUDICATION_DESIGN.md

**Status:** design draft (Phase 15). A **new feature set**, governed by its
own objective (below) — not a derivation of `PHILOSOPHY.md`, which governs
the epistemic-audit layer only. Good ideas are borrowed from there with
attribution (§4); none of its scoring machinery is inherited by default.

**Amended 2026-07-12** (§5.5a, evidence entries are cited claims/quotes —
the amendment governs): prompted by the maintainer's §Phase 15 smoke walk,
which found red line 5 unmet in practice — evidence rows were free-floating
typed quotes with no followable reference.

**Depends on Phase 14** (`docs/CRIMINOLOGY_DESIGN.md`, forensic findings
`30062`, the `forensicPublishing` flag) landing on `main` first — this layer
composes `30062` as a raw signal and takes the **next disjoint wire kinds**
(`30063`/`30064`, `30065` reserved). New development is paused until the
Phase 14 chain merges, at which point this branch rebases onto it.

This is the **truth-verdict layer the forensic phase deliberately deferred**
(`CRIMINOLOGY_DESIGN.md` non-goals: "truth verdicts on subjects, intent
attribution"). It composes claims (30040), assessments (30054), links
(30055), predictions/resolutions (30058/30059), disputes (30061), and
forensic findings (30062); it adds the verdict, the integrity application,
the entity record, and a precedent primitive.

> **Note on "v1/v2" below.** Where this doc refers to earlier "v1" and "v2"
> drafts, it means the two *conceptual iterations* this design integrates —
> the fused-score instinct and its descriptive-measurement correction — not
> repo artifacts. There is no prior truth-adjudication doc; this is the
> first.

## Governing objective

> **Adjudicate what is true and what is false, at human scale, on rigorous
> evidence standards, in a way that is resistant to the foreseeable pitfalls
> — and that under-claims by default when the evidence will not bear more.**

Tractability is a first-class constraint, not an afterthought: the system
declines to adjudicate what it cannot adjudicate honestly, and says so.

## Scope of v1 (what the client actually ships)

This layer follows the same posture the rest of X-Ray uses for judgment
systems (Phase 11 assessments, Phase 13 audits, Phase 14 findings):
**v1 is an authoring + wire + local-record layer.** The extension is a
local-first, single-author **client** — it captures, adjudicates at
analyst grade, records dimension-separated local results, and emits
well-structured verdict/integrity events behind a flag. It **does not
compute or enforce aggregation-layer guarantees** (cross-author bridging,
reputation/track-record weighting, Sybil resistance, capital staking) — the
wire format carries the fields those mechanisms would consume, but the
computation is an ecosystem/protocol concern deferred past v1, exactly as
Phase 13 shipped the `30061` dispute kind wire-only with the adjudication
runtime deferred. §2 marks each defense **(v1)** or **(deferred)** on that
basis, so the doc never claims protection it does not ship.

---

## §1. The form-of-judgment principle (the spine)

A judgment may be expressed as a **score** only when what it measures is
(a) genuinely graduated *and* (b) either low-stakes enough to tolerate
approximation, or rigorous enough to defend at the stakes in play.

- The epistemic audit's 0-100 with a **knowability ceiling** is an
  **estimation** — a best-guess simplification. Legitimate there: limited
  scope, heuristic purpose.
- A forensic maneuver is **categorical** — scoring it would fabricate
  precision. Hence `basis` + counter-indicators, no number.
- **Truth-value at human scale is neither graduated-enough nor
  approximation-tolerant.** A proposition is true, false, contested, or
  unresolved — not "73% true" — and the stakes (adjudicating reality about
  real people) forbid an estimated score standing in for a verdict.

Therefore this layer obeys one rule above all:

> **Verdicts are descriptive states. Quantities are measurements, never
> estimations. Every number shows its derivation from evidence, or it does
> not appear.**

A **measurement** is reproducible and traceable: a count of independent
corroborating sources; a Brier score computed from *resolved* predictions;
an inter-adjudicator agreement coefficient; a coverage fraction. An
**estimation** is an approximate evaluative judgment folded into a number (a
guessed knowability ceiling; a fused "integrity score"). Measurements are
admissible as evidence about a verdict; estimations are not admissible as a
verdict.

This is the precise integration of the two earlier drafts: resist the fused
estimated score (v1's instinct, correct for the verdict); keep the rigorous
descriptive measurements (v2's correction, correct for the evidence).

---

## §2. Foreseeable pitfalls and their structural defenses

The objective names "resistant to foreseeable pitfalls." Each defense is a
design element below — but several are **aggregation-layer** features the
client cannot itself compute in v1. Each row is tagged **(v1)** when the
client genuinely enforces it, or **(deferred)** when v1 only emits the
wire fields a future protocol layer would consume. A defense tagged
**(deferred)** is *not* a v1 guarantee; the doc claims no protection it
does not ship.

| Pitfall | Structural defense |
| --- | --- |
| **Political / ideological capture** | **(v1)** Symmetry is a hard requirement; adjudicator exposure published; the entity scoreboard must be periodically uncomfortable for every camp or calibration is broken. **(deferred)** Bridging-weighted validation (cross-prior agreement counts; co-partisan-only is discounted) — fields emitted, weighting computed at the aggregation layer. |
| **Capital capture** ("money buys truth") | **(v1)** Resolution is **never purely stake-weighted** as a red line; interpretations are un-bondable by construction. **(deferred)** Reputation/bridging weighting that dominates stake, and bondable clean-resolution propositions — a financial second act parked in `BONDING_NOTES.md`, not in v1. |
| **Selection bias / the denominator** | **(v1)** **Coverage is a published, descriptive quantity** — default "undetermined; sample, not census" — and it **caps** what any aggregate may conclude; mandatory balance-sheet symmetry (kept commitments sought as hard as broken); `insufficient-evidence` is a first-class verdict. |
| **Brigading / Sybil** | **(v1)** Corroboration requires **demonstrated source independence**, not a vote count (independence is a per-verdict authoring discipline). **(deferred)** Adjudicator track-record weighting, web-of-trust, network-level Sybil resistance. |
| **The oracle problem** | **(v1)** **Tiered evidence standards** + per-class resolution paths; **`unresolved` is a permanent, honest state**, never forced. **(deferred)** Optimistic challenge window + bridging-consensus resolution at the aggregation layer. |
| **Estimated scores masquerading as measurements** | **(v1)** §1, applied throughout: descriptive verdicts; measurements only; every number carries its derivation. |
| **Intent overreach** | **(v1)** Intent is **never adjudicated** (it is in the "cannot determine" set); only the observable gap and *documented* explanations are recorded; intent goes to the known-unknowns log. |
| **Defamation / harm to the powerless** | **(v1)** Knowability + coverage gates make confident verdicts on thin records impossible; the system adjudicates **propositions, not persons** — the reader concludes about the person; **right-of-reply** is emittable in v1 via existing reply/annotation primitives (a subject-authored response event referenced from the verdict); a dedicated right-of-reply UI is deferred. |
| **Goodharting** | **(v1)** Descriptive quantities are hard to game (you must actually keep commitments / corroborate facts); no single fused metric to optimize; orthogonal dimensions. |
| **Decontextualization** | **(v1)** Machine-readable-first: no number travels without its evidence and caveats; the verdict and its derivation are one object. |
| **Vague-rhetoric entrapment** | **(v1)** The **atomization gate**: a stated preference is adjudicable only once it is a specific proposition with resolution criteria; un-atomizable rhetoric is unscorable by construction. |
| **Recursive trust / cold-start** | **(v1)** Bootstrap on high-knowability propositions (court records, official rolls) where resolution is near-objective. **(deferred)** Reputation and bridging grow from there at the aggregation layer. |
| **Mutable history / stealth edits** | **(v1)** Content-addressing + append-only supersession (borrowed, P9): nothing overwritten; a stealth edit is a new artifact with a diff. |

---

## §3. Architecture

Six layers. Each is evidence-bound and disputable; none introduces an
estimated verdict-score.

### §3.1 Adjudicable propositions (the gate)

A claim (30040) is high-volume and thin. It becomes **adjudicable** only
when atomized into a specific proposition carrying:

- `proposition_class` — one of:
  - `event-fact` (X did Y at T), `state-fact` (the state of the world is Z),
    `prediction` (Y will occur by T), `stated-commitment` ("I will X"),
    `stated-value` ("I value X"), `interpretation` (a reading / value claim).
- `resolution_criteria` — what evidence would settle it (reuse the
  Prediction-Extraction discipline: criteria + horizon + hedge +
  tractability — the field set in `docs/auditor-prototype/prompts/
  08-prediction-extraction.md`).
- For `prediction`: a horizon. For facts: "already determinable."
- `subject_role` — the proposition's relationship to the entity in `about`,
  **orthogonal to `proposition_class`** (which types the proposition; this
  types the *subject-relationship*). One of `stated` (the entity's own word —
  a profession or commitment), `enacted` (the entity's deed — an action-fact
  about them), or `ascribed` (a third party's characterization of the entity,
  neither their word nor their deed). **Absence = `unclassified`. `ascribed`
  and `unclassified` propositions are excluded from IntegrityFindings by
  construction** — never default a substantive role, since that would
  manufacture a word/deed reading the author did not assert. (An IntegrityFinding
  matches a `stated` commitment/value against `enacted` action-facts about the
  same entity; an `ascribed` claim is *about* the entity but is not theirs to
  be held to.)
- `occurred_at` / `occurred_precision` — the event-time of the deed or
  utterance (Unix seconds), **distinct from `created`** (when the record was
  made): it is what lets a deed be matched against the words contemporaneous
  with it, and what the integrity timeline orders on (§3.4). `occurred_precision`
  is `exact | day | month | year` — the same no-false-precision discipline as
  the forensic `basis` enum, so a 1987 action never masquerades as a precise
  timestamp.

**Interpretations and bare values are not adjudicable as true/false** — only
the *honesty of the reasoning* behind them is assessable (borrowed: never
score a conclusion). This is the firewall against the tool becoming an
orthodoxy enforcer. The `stated-value` class is the sharp case: see the
§3.4 firewall — a value is **never** adjudicated true/false; only the
**observable gap** between a value and an action is.

> **Companion layer.** Declining to adjudicate is not the same as having
> nothing to say. The proposition classes this firewall excludes —
> `interpretation`, `stated-value`, and an article's `normative` / `framing`
> work — are handled on the far side of the wall by **Phase 16 / moral-lens
> evaluation** ([`docs/MORAL_LENS_JURISDICTION_DESIGN.md`](MORAL_LENS_JURISDICTION_DESIGN.md)),
> which reconstructs *how named perspectives would read them* (never as
> truth), grounded in cited authorities. The two layers are two sides of one
> wall; "verdict" stays reserved for this side.

### §3.2 Evidence and attestation

Each adjudicable proposition is anchored to evidence with a declared
**evidence tier**:

- `tier-1` primary / official (court records, roll-call votes, filings,
  datasets, signed records, primary recordings);
- `tier-2` independent reporting;
- `tier-3` single-source / anonymous / uncorroborated.

**Actions are not textual artifacts.** An action enters the system only as a
set of **content-addressed attesting artifacts**; the **action-fact is the
corroborated convergence of independent attestations**, never a primary
artifact. Its strength is a *measurement*: the count and tier of
**independent** attestations (independence demonstrated, not assumed —
two outlets on one wire are one source). Independence is a per-verdict
authoring discipline in v1 (the author records *why* two sources are
independent); network-level Sybil resistance over the same field is
deferred (§2).

### §3.3 The verdict (descriptive, measured — no estimated score)

**Structure: single-author verdict, read-time aggregate.** A `30063` is
**one author's** ruling on one proposition — an addressable event keyed to
`(author, proposition)`, exactly as a `30054` assessment is one author's
stance. There is no consensus event and no authoritative-adjudicator role.
When several authors rule on the same proposition, **agreement, variance,
and bridging are computed at read time** over their separate `30063`
events and **never collapsed into a single number** (borrowed, P8). The
`agreement`/`bridging` fields below therefore describe what a *reader* (or a
future aggregation layer) derives across many verdicts — not a value any one
event asserts about a crowd.

For each adjudicable proposition, an **AdjudicatedVerdict**:

- `verdict` (descriptive state): `established-true` | `established-false` |
  `contested` | `unresolved` | `insufficient-evidence`.
- `standard_of_proof` declared and met (borrowed from common law):
  `preponderance` | `clear-and-convincing` | `beyond-reasonable-doubt`.
- `evidence` — verbatim, both sides (borrowed, P3); tiers cited.
- `adjudicator` identity + method + timestamp + **mandatory caveats** (what
  this verdict could not determine).
- `agreement` — **measured**, not averaged: a reader holding many authors'
  `30063` events on one proposition sees each verdict + the variance
  (borrowed, P8); they are never collapsed to a consensus number. *Computed
  read-time across single-author events; no event asserts it.*
- `bridging` — did authors with divergent priors converge? *A read-time
  signal over the same event set; weighting it into standing is deferred
  (§2).*
- disputable and **superseded, never overwritten**.

The role the epistemic audit gives to a single estimated score is filled
here by a **bundle of measurements** — standard met, evidence tier,
adjudicator agreement, bridging — plus a categorical verdict state. That is
the operational meaning of "rigorous and descriptive."

**Knowability is an honest descriptive limit, not a ceiling-score.** A
proposition resting on unverifiable sources resolves `insufficient-evidence`
or `unresolved` and says why — it is not assigned an approximate maximum.

**Disputes (v1 posture).** A verdict reuses the **dispute wire format**
(`30061` `AuditDispute`) and the **append-only supersession idiom** (§3.6,
P9) — *not* an adjudication runtime. Phase 13 shipped `30061` wire-only and
deferred the adjudication runtime (who can rule, status resolution); this
layer inherits that posture. v1 emits disputes and superseding verdicts;
the resolution machinery is deferred.

### §3.4 The integrity application (words vs deeds)

One *use* of the engine. An **IntegrityFinding** links an adjudicated
`stated-commitment` (or `stated-value`) to one or more adjudicated
action-facts, with:

- `match` (descriptive state): `fulfilled` | `broken` (commitments) /
  `consistent` | `contradicted` (values) | `unrelated` | `contested` |
  `insufficient`. The match is itself adjudicated (standard of proof,
  verbatim evidence, adjudicator agreement, bridging) — **it is a verdict,
  not a drawn edge.**
- `gap_decomposition` — when words != deeds, the cause is one of *lie /
  revision / incapacity / constraint / misattribution*. The system records
  the observable gap and the **documented** explanation as its own
  adjudicated sub-claim where evidence exists. **Intent is not
  adjudicated** (known-unknown). **Documented belief revision on new
  evidence is potential credit**, not penalty (borrowed, calibration ethos);
  only undisclosed reversal / post-hoc rationalization is negative — and
  that is already a forensic `walks-back` / `narrative-patch` (30062),
  composed in, not re-invented. The `constraint` cause is **evidence, not an
  excuse**: a `broken`/`contradicted` match may carry a `constraint_ref` to a
  *corroborated* action-fact (e.g. "the bill was blocked in committee," anchored
  to a primary record) that **discounts** the finding — but the constraint
  claim must clear the same corroboration/dispute bar as any other proposition,
  so it is never a free pass.

A finding is read as **pattern, not instance**: IntegrityFindings for an entity
order on the matched action-facts' `occurred_at` (§3.1), so the integrity record
is a time series (`src/portal/timeline.js`), not a gotcha. A single match is
noise; a trend is a finding.

**Value firewall (the sharp case).** For a `stated-value`, the system
**never adjudicates the value as true or false** — values are not
truth-apt, and policing them is exactly the orthodoxy-enforcement red line
(§5). The `consistent` / `contradicted` match adjudicates only the
**observable gap** between a stated value and a documented action-fact: did
the deeds contradict the words? That is an evidence-bound factual question
about behavior, not a verdict on the value itself. The value supplies the
yardstick the subject chose; the action is what is measured against it.

### §3.5 Entity record (dimension-separated, coverage-bound)

Per confirmed default: **dimension-separated descriptive records are
canonical; a single rollup is optional and lossy.**

Canonical records (each a *measurement*, fully enumerable to its evidence):

- **Commitment record** — the list of atomized commitments with verdict
  states (kept / broken / pending). A count and a list, not a score.
- **Stated-value consistency record** — value-vs-action adjudications.
- **Calibration record** — Brier from *resolved* predictions only (a
  measurement, reusing `src/shared/audit/calibration.js`; entities who
  never predict simply have none).
- **Correction-behavior record** — retractions vs maneuvers, composed from
  supersessions + 30062 findings.

**Coverage** is published with every record: how much of the identifiable
commitment-universe was assessed. Default and usual value: *undetermined —
this is a sample, not a census*, which **caps** any aggregate.

The **optional single rollup**: a transparent function of the *resolved*
records (e.g., "9 of 12 resolved high-standard commitments kept"),
explicitly a lossy convenience, hard-gated by coverage, and **never an
estimated evaluative score** — a ratio of measured outcomes with its
coverage limit on its face, or it is not shown.

**Asserter vs. subject — the defamation firewall (principle, not a v1
deliverable).** Two populations must never be confused. A **subject** is a
profiled entity an article is *about* (e.g. a public figure): they get the
coverage-bound catalog above — sourced propositions, verdicts, and findings —
and **never an auto-emitted person-grade or "liar"/"hypocrite" label**; the
reader draws the conclusion (§5.3). An **asserter** is a *pubkey that signs*
verdicts, findings, disputes, or predictions: their track record is a pure
function of their own public events, recomputable by anyone from relays (the
`reconcile.js` posture), never an authoritative stored score. Three principles
constrain how any such record may ever be computed — they bind the design now
even though the **record itself stays deferred** (Scope of v1; no reputation
*display* or *weighting* ships in v1):

- **Good-faith-wrong is not bad-faith.** *Wrong* + (well-calibrated **or**
  retracted) is honest error and **must not be penalized like deception** —
  punishing it manufactures the chilling effect that kills good-faith
  participation. Only *wrong* + non-retraction + maneuvering (each evidenced by
  existing primitives: resolution outcome, absence of an `updates`/supersession,
  and 30062 `defense/*`/`neutralization/*` findings against the asserter's own
  conduct) is bad-faith. The reputation layer **adds no new judgment** — it
  composes already-signed, already-falsifiable evidence.
- **Symmetric accountability — no free shots.** Assessments (30054), findings
  (30062), and disputes (30061) are themselves signed claims; their *authors*
  accrue records too (do the disputes they file survive? do their conduct edges
  hold up?). You cannot weaponize the accusation machinery without standing on
  it yourself.
- **Reputation-eligibility gate.** Only claims that can be *wrong in a
  resolvable way* count — predictions with pre-stated criteria, and corroborated
  fact-claims. **Interpretations, stance, and values are never
  reputation-eligible** (you cannot be "wrong" about a value in a way that
  resolves); scoring them would just punish dissent — the same firewall as §3.1.

### §3.6 Precedent (primitive in, implementation deferred)

Per confirmed default: design the primitive now, ship later. An
AdjudicatedVerdict / IntegrityFinding may **cite prior verdicts of the same
proposition or match class** as `binding` or `persuasive` precedent,
building a citable corpus so like cases are decided alike at scale. This is
the most direct answer to the common-law framing; implementation is a later
phase. (Deferred work; the field and the citation grammar land now so the
record is precedent-ready from the first verdict.)

---

## §4. What it composes vs. what is new

**Composes (existing):** claims (30040), assessment stance as a raw input
signal (30054), `revision/*` edges (30055), predictions/resolutions
(30058/30059), the dispute + supersession **wire format** (30061),
forensic findings for the bad-faith / maneuver signal (30062), entity
identities + keys.

**New kinds (proposed, wire-disjoint, additive — following the 30062
idioms: `{ event, body, dTag }` return shape, deterministic `d`,
`p`-targeting, NIP-32 `L`/`l` where a label exists with a 1985 mirror,
multi-letter non-indexed tags, publish behind a new flag; template is
`buildBehavioralFindingEvent` in `src/shared/metadata/builders.js`):**

- `30063` **AdjudicatedVerdict** — verdict on an adjudicable proposition.
- `30064` **IntegrityFinding** — commitment/value vs action match.
- `30065` (reserved) **PrecedentCitation** — or fold precedent into verdict
  refs; decide at implementation.

All three kind numbers are **confirmed free** (the registry runs through
`30062`; `30043` is retired). Publishing is gated by a new
**`truthAdjudicationPublishing`** flag in `FLAGS_DEFAULTS`
(`src/shared/metadata/feature-flags.js`), slotting in beside
`assessmentPublishing` / `epistemicAuditing` / `forensicPublishing`. The
service worker **always accepts** inbound events of every kind (no gate);
only publish paths and panel tabs gate.

**Borrowed with attribution from the epistemic-audit philosophy (good
ideas, not governance):** evidence-bound findings (P3); symmetry as
existential (P5); disagreement-is-data / publish-variance / never-average
(P8); under-claim (P11); content-addressing + append-only supersession +
lineage (P9); calibration from *resolved* outcomes (P7); the dispute wire
format + supersession idiom; first-class adjudicator identity; mandatory
caveats / known-unknowns log. **Deliberately not borrowed:** the estimated
0-100 score and the knowability *ceiling-as-score* (§1).

---

## §5. Red lines (non-goals, by construction)

1. **No estimated score as a verdict.** Verdicts are descriptive states;
   numbers are measurements with shown derivation. (§1)
2. **No intent adjudication.** The gap is observable; the motive is not.
   Intent -> known-unknowns. (§3.4)
3. **Verdicts attach to propositions, not persons.** An entity record is a
   coverage-bound rollup of proposition-level verdicts; the reader draws the
   conclusion about the person. (§3.5)
4. **No aggregate without published coverage.** A confident entity-level
   claim on an undisclosed sample is forbidden. (§2, §3.5)
5. **No verdict the reader cannot re-derive.** Every verdict ships its
   evidence, tiers, standard, adjudicators, and caveats. (§2)
6. **No asymmetry by valence.** Standards and weights are never tuned to a
   target; the scoreboard discomforts every camp or it is broken. (§2)
7. **No value policed as true/false.** Values are not truth-apt; only the
   observable word-deed gap is adjudicated. (§3.1, §3.4)

A feature requiring one of these crossings is a different, worse system.

### §5.5a — Amendment 2026-07-12: evidence entries are cited claims/quotes

Red line 5 ("no verdict the reader cannot re-derive") was unmet in
practice: the verdict/finding data model, the wire tags, and the
publish mapper all carried slots for evidence source references
(`claim_ref`, `source_ref`; the `evidence-*` tags' `url`/`coord`
positions), but the authoring UI captured only `{quote, tier}` — so
every published ruling shipped evidence a reader could not follow.
The amendment makes evidence a *citation of captured artifacts*, not
a typing surface:

1. **Every evidence entry MUST reference a captured claim or quote**
   (`claim_ref`) — a local claim from any captured article, or a
   foreign claim known by its 30040 coordinate (assessed-foreign or
   network). A captured claim already IS the quote artifact: its
   `quote` is the verbatim article span (auto-captured, never typed),
   its `source` is the speaker entity (e.g. W.H.O.), and it carries
   the article hash + anchor. Counter-claims cited as
   evidence-against are the same artifact on the other side.
2. **Nothing evidentiary is typed.** The authoring UI has no quote
   box and no URL field: the row's quote, speaker, source URL, and
   hash all derive from the linked artifact (the record snapshots the
   claim's quote/text and source URL so the ruling stays
   self-contained and renders even if the claim is later deleted).
   The only typed fields are the **tier** (a selection) and an
   optional short **note** ("why this supports/contradicts") — the
   adjudicator's judgment about the artifact, never a substitute for
   it.
3. **Capture-first is the discipline.** Evidence that isn't captured
   yet can't be cited: select its text in the source article, capture
   it as a claim/quote, then cite it. This mirrors the Phase 19
   facts posture — the knowledge base is built strictly from
   captured artifacts, and rulings inherit that provenance instead of
   introducing a freeform side channel.
4. **An unpublished linked claim is omitted from the wire this batch**
   (the ruling still publishes; the coordinate appears on the next
   publish after the claim lands) — the same posture as precedent and
   revision refs. The snapshot URL still ships in the tag's `url`
   slot meanwhile.
5. **Read surfaces render the refs followable** — the evidence `url`
   as a link, the `coord` as a copyable claim coordinate — instead of
   dropping them.
6. **No wire-format change, tolerant read.** The tag positions
   existed from v1; the amendment fills them. Foreign events (and
   pre-amendment local records) with quote-only evidence render and
   re-publish as before — the MUST binds authoring, not reading.

Still deferred (recorded, not built): attestation authoring UI and
verdict↔convergence wiring (§3.2's corroboration spine), proposition
provenance snapshots, supersession-reason fields, and publishable
revision refs.

---

## §6. Decided defaults / open questions

**Decided (this session):**
- Dimension-separated records canonical; optional lossy rollup, coverage- and
  standard-gated.
- Action-attestation via tiered sources + per-verdict independence
  discipline; optimistic challenge + bridging-consensus deferred to the
  aggregation layer.
- Precedent primitive lands now; implementation deferred.
- v1 is authoring + wire + local records; network-layer defenses (bridging,
  reputation weighting, Sybil resistance, bonding) deferred (Scope of v1).
- Disputes inherit the `30061` wire-only posture; no adjudication runtime in
  v1.

**Open (settle at implementation):**
1. Standard-of-proof default per proposition class (e.g., commitments ->
   clear-and-convincing; facts -> preponderance unless reputationally
   heavy).
2. Bridging metric: which concrete cross-prior agreement measure, and how it
   weights standing without becoming capital/popularity in disguise. *Gated
   to the deferred aggregation layer — v1 makes no claim resting on it.*
3. Coverage estimation method: how to bound the "identifiable commitment
   universe" honestly enough that the coverage fraction is itself a
   defensible measurement and not a back-door estimation. *Load-bearing for
   §3.5; the cap is honored in v1 even while the method is refined.*
4. Precedent: separate `30065` vs. verdict-internal citation refs.

---

## §7. Slice plan (one concern per PR; the A-E cadence)

Branches `claude/phase-15-*`. The wire slice (15.6) depends on the Phase 14
chain having merged.

- **15.1 — Adjudicable-proposition model (local, no wire).**
  `proposition_class` + `resolution_criteria` atomization over existing
  claims; the interpretation/value firewall; exhaustive-enum tests.
- **15.2 — Evidence tiers + attestation graph.** Tiered evidence on
  propositions; the independent-attestation convergence for action-facts
  (composing 30055 `supports`); independence checks.
- **15.3 — Verdict model + dispute reuse.** `AdjudicatedVerdict` as a
  **single-author** addressable record keyed to `(author, proposition)`
  (descriptive states, standard-of-proof, verbatim evidence, caveats);
  read-time multi-author variance/bridging surface (derived, never an event
  field); supersession; reuse the dispute wire format. No estimated-score
  path exists to build.
- **15.4 — Integrity application.** `IntegrityFinding` (commitment/value vs
  action match as a verdict; gap-decomposition; intent excluded; the
  value firewall; revision-as-credit composing 30062).
- **15.5 — Entity record + coverage.** Dimension-separated descriptive
  records; the coverage measurement + cap; the optional gated rollup;
  calibration from resolved predictions.
- **15.6 — Wire + NIP draft (flag-gated).** `30063`/`30064` builders +
  parsers (first wire tests); `truthAdjudicationPublishing` flag; NIP draft
  framing verdicts as *evidence-bound descriptive adjudications with required
  caveats*, never pronouncements; precedent citation grammar reserved.
- **(later) — Precedent + bridging weighting.** Stare-decisis corpus;
  bridging-weighted standing — the deferred aggregation-layer tail.

## Implementation seams

`src/shared/claim-model.js` (atomization fields, kept off the high-volume
capture path — analyst-grade, deliberate, not a tax on casual claims),
`src/shared/assessment-taxonomy.js` (verdict-state + match + standard-of-proof
enums, exhaustive-enum pinned, with tests in
`tests/assessment-taxonomy.test.mjs`), `src/shared/evidence-linker.js` (tiers,
independence), `src/shared/audit/calibration.js` (resolved-prediction Brier,
reused), new `src/shared/truth-adjudication-model.js` +
`src/shared/integrity-model.js` following the `assessment-model.js` /
`forensic-model.js` patterns, portal `src/portal/entity-view.js` /
`src/portal/timeline.js` for the coverage-bound record render (alongside the
existing dossier-block / findings-block components).

## Related notes

- `docs/BONDING_NOTES.md` — the deferred "money-where-your-mouth-is" second
  act (Lightning-bonded resolution). Parking-lot exploration, not a spec;
  out of v1 scope. **Vocabulary reconciliation:** this doc's
  `proposition_class` (`event-fact` / `state-fact` / `interpretation` …) and
  match states (`fulfilled` / `broken` / `contradicted` …) are canonical;
  `BONDING_NOTES.md`'s `enacted` / `ascribed` terms now map onto this doc's
  **`subject_role`** axis (§3.1 — `enacted` ≈ `subject_role: enacted` over an
  `event-fact`/`state-fact`; `ascribed` ≈ `subject_role: ascribed`), and
  `broken-by-conduct` ≈ a `contradicted` IntegrityFinding. Its
  `INTEGRITY_DESIGN.md` reference means **§3.4 of this doc** (the integrity
  layer lives here, not in a separate file).

- **Lineage — the superseded `INTEGRITY_DESIGN.md` (v0).** This layer began as
  a standalone integrity design that was folded into §3.4–§3.5 here. **Kept from
  it:** the word/deed/`ascribed` subject axis (now `subject_role`, §3.1), the
  `occurred_at` / `occurred_precision` event-time primitive (§3.1) and its
  pattern-not-instance timeline read (§3.4), constraint-as-evidence
  (`constraint_ref`, §3.4), and the asserter-reputation principles —
  good-faith-wrong vs bad-faith, symmetric accountability, the asserter/subject
  firewall, and the reputation-eligibility gate (§3.5). **Changed in the
  supersession:** v0's *no-new-event-kinds* approach (a `role` tag plus conduct
  *edges* on 30055) became this doc's first-class addressable kinds
  `30063`/`30064` — because an adjudicated word-deed *match* deserves to be
  disputable and supersedable, which a drawn edge is not; and v0's emergent
  "fact = corroboration gradient" became the explicit evidence-tier +
  standard-of-proof apparatus of §3.2–§3.3. There is **no separate
  `INTEGRITY_DESIGN.md` file**; this is its canonical home.

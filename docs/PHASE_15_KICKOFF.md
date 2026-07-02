# Phase 15 — Truth adjudication — implementation prompt

> **Post-implementation amendment (2026-07-02).** Phase 15 shipped as the
> stacked PR train #79–#86 (+ conformance #87). Divergences from this
> prompt, per its own "the design governs; fix the prompt" rule:
> the Phase-15 enums live in a dedicated `src/shared/truth-taxonomy.js`
> (the escape hatch below, journaled 2026-07-02), not
> `assessment-taxonomy.js`; and two slices beyond §7's plan shipped —
> **15.7 publish wiring** (selection + reader batch section + Options
> toggle) and **15.8 reader adjudication UI** (the adjudicate modal +
> claim-row badges). The "rest of Phase 15" summary at the end of this
> file predates both. Remaining tail: read-back/portal surfaces,
> integrity/attestation authoring UI, and the design's deferred
> aggregation layer.

> This file is the **handoff prompt** for the Claude Code session that
> implements Phase 15. It is self-contained: read it, read the files it
> points at, then build. Everything in the X-Ray repo's `CLAUDE.md`
> applies (conventions, build, flags, message bus, Firefox floor, the
> "private keys never leave" rule, `Utils.log`/`Utils.error` over bare
> `console`, 4-space indent in authored JS).
>
> **The governing spec is [`docs/TRUTH_ADJUDICATION_DESIGN.md`](TRUTH_ADJUDICATION_DESIGN.md).**
> Read it in full before writing a line. This prompt does not restate it —
> it scopes the first buildable slice and points at the seams. Where this
> prompt and the design differ, **the design governs**; fix the prompt.

## Where Phase 15 sits

Phase 15 is the **truth-verdict layer** the forensic phase deliberately
deferred. It composes claims (30040), assessments (30054), links (30055),
predictions/resolutions (30058/30059), disputes (30061), and forensic
findings (30062), and **adds** the adjudicable proposition, the verdict,
the integrity application (words vs deeds), the entity record, and a
precedent primitive. Its Phase-14 dependency (**forensic findings 30062,
the `forensicPublishing` flag**) **has merged to `main`** — so the
blocker the design notes ("paused until the Phase 14 chain merges") is
**cleared**. New wire kinds are `30063`/`30064` (`30065` reserved),
confirmed free.

The spine (design §1): **verdicts are descriptive states; quantities are
measurements with shown derivation, never estimations.** There is no
0-100 score and no knowability *ceiling-as-score* here — that was the
epistemic-audit layer's estimation, deliberately **not** borrowed. If you
find yourself adding a fused evaluative number, stop: you are building a
different, worse system (design §5 red lines).

## Scope of THIS handoff: slice 15.1 only

Build **15.1 — the Adjudicable-proposition model (local, no wire).** This
is the gate every later slice sits on, and it is the exact piece the FLF
Epistack competition entry wants for its "calibrated per-proposition view"
demo (`docs/EPISTACK_ENTRY.md` §4, the stretch goal). Ship it as a clean,
self-contained, heavily-unit-tested local model. **No wire, no event
builder, no flag, no network, no LLM** — those are later slices (§7 of the
design; summarized at the end here). Do not scope-creep into verdicts
(15.3) or the integrity application (15.4).

### What 15.1 delivers

A claim (30040) is high-volume and thin. It becomes **adjudicable** only
when atomized into a specific proposition. 15.1 is that atomization model:
a local record that references an existing claim id and carries the
adjudicability fields, plus the firewall that keeps un-adjudicable things
out.

Per design §3.1, an adjudicable proposition carries:

- **`proposition_class`** — exactly one of:
  `event-fact` | `state-fact` | `prediction` | `stated-commitment` |
  `stated-value` | `interpretation`.
- **`resolution_criteria`** — what evidence would settle it. **Reuse the
  Prediction-Extraction discipline** — the field set (criteria + horizon +
  hedge + tractability) from the prediction-extraction prototype prompt
  (`docs/auditor-prototype/prompts/08-prediction-extraction.md`; confirm
  the exact field names against `src/shared/audit/` where 30058 prediction
  entries are modeled, and reuse those names rather than inventing
  parallel ones). For `prediction`: a horizon is required. For facts:
  "already determinable."
- **`subject_role`** — **orthogonal to `proposition_class`**:
  `stated` (the entity's own word) | `enacted` (the entity's deed) |
  `ascribed` (a third party's characterization). **Absence =
  `unclassified`.** Never default a substantive role — that would
  manufacture a word/deed reading the author did not assert.
- **`occurred_at`** (Unix seconds) + **`occurred_precision`**
  (`exact` | `day` | `month` | `year`) — the event-time of the deed or
  utterance, **distinct from `created`** (when the record was made). This
  is what lets a deed be matched against contemporaneous words and what
  the integrity timeline (later) orders on. Same no-false-precision
  discipline as the forensic `basis` enum — a 1987 action must not
  masquerade as a precise timestamp.

### The firewall (the whole point — do not soften it)

- **Interpretations and bare values are NOT adjudicable as true/false.**
  A `stated-value` and an `interpretation` may be *recorded as propositions*
  (they carry a class), but the model must expose a predicate — call it
  `isTruthAdjudicable(proposition)` or similar — that returns **false** for
  `interpretation` and `stated-value`. Later slices key off this: only the
  *honesty of the reasoning* / the *observable word-deed gap* is assessable
  for these, never the value itself. This is the firewall against the tool
  becoming an orthodoxy enforcer (design §3.1, §3.4 value firewall, §5.7).
- **`ascribed` and `unclassified` propositions are excluded from
  IntegrityFindings by construction.** 15.1 doesn't build IntegrityFindings,
  but it must expose the classification cleanly enough that 15.4 can enforce
  this without guessing (e.g. an `isIntegrityEligible(proposition)` helper,
  or leave the enum honest and let 15.4 filter — your call, but document it).

## Read first (load-bearing context)

- **`docs/TRUTH_ADJUDICATION_DESIGN.md`** — the whole spec. §1 (form-of-
  judgment spine), §3.1 (this slice), §5 (red lines), §7 (slice plan).
- **`docs/EPISTEMIC_AUDIT_DESIGN.md` / `docs/PHILOSOPHY.md`** — for the
  *borrowed* ideas (evidence-bound P3, under-claim P11, content-addressing
  + supersession P9, calibration-from-resolved P7) and, crucially, what is
  **not** borrowed (the estimated score, the ceiling-as-score). Don't
  reintroduce them.
- **The patterns to mirror** (read their `create()` inputs, validators,
  enum discipline, storage shape, and tests):
  - `src/shared/claim-model.js` — `ClaimModel.create({text, source_url,
    about, source, anchor, suggested_by})`, storage under
    `article_claims`, `generateClaimId`, `normalizeClaim` backfill, the
    `suggested_by` provenance seam. **A proposition references a claim id.**
  - `src/shared/assessment-model.js` + `src/shared/forensic-model.js` —
    the `{ create, update, get, list, delete }` model shape you will
    follow for `src/shared/truth-adjudication-model.js`.
  - `src/shared/assessment-taxonomy.js` — the **exhaustive-enum + validator
    idiom** (`Object.freeze`, `isValid*`, the custom-token grammar, the
    `suggested_by` validator you should reuse via `isValidSuggestedBy`).
    New Phase-15 enums live **here** per the design's Implementation-seams
    note, unless the file grows unwieldy — if you prefer a dedicated
    `truth-taxonomy.js`, that's fine, but keep one source of truth and pin
    it with exhaustive-enum tests.
  - `src/shared/forensic-taxonomy.js` — `BASIS_VALUES` and its
    no-false-precision framing, the model `occurred_precision` mirrors.
  - `src/shared/audit/` — where 30058 **PredictionEntry** fields live;
    reuse those field names for `resolution_criteria` rather than minting
    new ones.
- **Tests**: `tests/assessment-taxonomy.test.mjs`,
  `tests/claim-model.test.mjs` (or the nearest model test) — copy the
  `node --test` + hand-built-stub style; `fake-indexeddb`/`chrome.*` stubs
  as those tests do. **No jsdom.**

## Files to add / touch (15.1)

- **New `src/shared/truth-adjudication-model.js`** — the proposition model:
  `create({claim_id, proposition_class, resolution_criteria, subject_role,
  occurred_at, occurred_precision, suggested_by})` + `update`, `get`,
  `list`, `delete`; a deterministic id (mirror `generateClaimId`); storage
  under a new key (e.g. `adjudicable_propositions`); a `normalize` backfill;
  the `isTruthAdjudicable` / integrity-eligibility predicates; full input
  validation that **rejects** an unknown class/role/precision, a
  `prediction` with no horizon, or a proposition referencing a missing
  claim. Follow `forensic-model.js` line-for-line in shape.
- **New enums** (in `assessment-taxonomy.js` or a new `truth-taxonomy.js`):
  `PROPOSITION_CLASSES`, `SUBJECT_ROLES` (incl. the `unclassified` absence
  semantics), `OCCURRED_PRECISION`, plus `isValid*` for each. `Object.freeze`
  everything; the wire-facing strings are the exact tokens above.
- **New `tests/truth-adjudication-model.test.mjs`** and enum tests —
  exhaustive-enum pins (a test that fails if someone adds a class without
  updating the validator), the firewall predicates (interpretation/value ⇒
  not truth-adjudicable; ascribed/unclassified ⇒ not integrity-eligible),
  the horizon-required-for-prediction rule, idempotent create, and the
  missing-claim rejection.
- **No** manifest, flag, event-builder, background, or reader changes in
  15.1. (Reader UI to author propositions can come as part of 15.1 *only*
  if trivial; otherwise defer to a follow-up — the model + tests are the
  slice.)

## Branch & process

- Develop on a fresh **`claude/phase-15-adjudicable-propositions`** branch
  cut from **`main`** (design §7: branches `claude/phase-15-*`). One
  concern per PR (the A–E cadence). Open a **draft PR** and keep
  **`npm run build` + `npm test` + `web-ext lint --self-hosted`** green
  before every push.
- Add a tight **`docs/JOURNAL.md`** entry for any second-guessable modeling
  choice (e.g. where the enums landed, the id-derivation inputs, how
  `resolution_criteria` reuses the 30058 fields).
- Update **`docs/ROADMAP.md`** 15.1 → done when it lands; leave 15.2–15.6
  as-is.

## Acceptance criteria (15.1)

- `TruthAdjudicationModel.create(...)` produces a stored proposition that
  references an existing claim, carries a valid `proposition_class`,
  `subject_role` (or `unclassified`), `resolution_criteria`, and
  `occurred_at`/`occurred_precision`; create is **idempotent** on the same
  inputs.
- `isTruthAdjudicable` returns **false** for `interpretation` and
  `stated-value`, **true** for the four factual/commitment/prediction
  classes; the integrity-eligibility predicate excludes `ascribed` and
  `unclassified`.
- A `prediction` with no horizon, an unknown class/role/precision, or a
  reference to a non-existent claim is **rejected with a clear error**, not
  silently stored.
- **No** estimated score, no verdict state, no network, no flag, no LLM in
  this slice. `npm test` (new tests included), build, and
  `web-ext lint --self-hosted` are green; Firefox ≥128 unaffected (pure
  model code).

## Gotchas

- **Don't build the verdict here.** The temptation is to add a `verdict`
  field "while we're at it." Verdicts are 15.3 and are single-author
  addressable events with standards of proof — a materially different
  object. 15.1 stops at *adjudic-ABLE*, not adjudic-ATED.
- **No false precision.** `occurred_precision` exists precisely so a
  year-only date can't pose as an exact timestamp — enforce it in the
  validator and in any future render, exactly as the forensic `basis`
  does.
- **Reuse, don't fork, the prediction fields.** `resolution_criteria`
  should be the *same* field vocabulary the 30058 prediction entries
  already use, so a prediction proposition and a banked prediction speak
  one language.
- **Provenance honesty.** Reuse `isValidSuggestedBy`; a proposition
  atomized by a future LLM pass is `llm:<model>`, a hand-authored one is
  `user`. Don't relabel.

## The rest of Phase 15 (context, not this slice)

Per design §7 — build in order, one PR each, after 15.1 lands:

- **15.2** Evidence tiers + attestation graph (tier-1/2/3; action-fact =
  corroborated convergence of *independent* attestations, composing 30055
  `supports`; independence as a per-verdict authoring discipline).
- **15.3** Verdict model + dispute reuse (`AdjudicatedVerdict`, **single-
  author** addressable, descriptive states `established-true` |
  `established-false` | `contested` | `unresolved` | `insufficient-evidence`;
  standard-of-proof; verbatim evidence both sides; caveats; read-time
  multi-author variance/bridging **derived, never an event field**;
  supersession; reuse the 30061 dispute wire format — no adjudication
  runtime).
- **15.4** Integrity application (`IntegrityFinding`: commitment/value vs
  action match *as a verdict*; gap-decomposition; **intent excluded**; the
  value firewall; revision-as-credit composing 30062).
- **15.5** Entity record + coverage (dimension-separated descriptive
  records; the **coverage** measurement + cap; the optional gated rollup;
  calibration from *resolved* predictions, reusing
  `src/shared/audit/calibration.js`).
- **15.6** Wire + NIP draft, **flag-gated** (`30063`/`30064` builders +
  parsers, first wire tests; new `truthAdjudicationPublishing` flag in
  `FLAGS_DEFAULTS`; NIP framing verdicts as evidence-bound descriptive
  adjudications with required caveats; precedent citation grammar reserved).
- **(later)** Precedent + bridging weighting — the deferred aggregation-
  layer tail.

Keep the §5 red lines in view through all of it: no estimated score as a
verdict; no intent adjudication; verdicts attach to propositions, not
persons; no aggregate without published coverage; no verdict the reader
can't re-derive; no asymmetry by valence; no value policed as true/false.

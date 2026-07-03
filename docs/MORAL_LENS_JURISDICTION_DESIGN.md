# Moral-Lens Evaluation — design (Phase 16)

> **Status:** design draft (2026-06-24), **amended 2026-07-03** (slice
> 16.0.5) after the pre-implementation audit. The amendment: (a)
> re-authors the source-prompt content into **Appendix A** — the
> "moral-lens-jurisdiction system-prompt draft" this doc originally
> deferred to was never committed to the repo; (b) replaces the §4
> storage claim with the actual jurisdiction-registry / authority-record
> shape; (c) fixes the assertion-type taxonomy (§3) and renames the
> per-jurisdiction "integrity" report to **grounding report** (§5.2);
> (d) pins gating, call topology, caching, and provenance (§6); (e)
> re-scopes the slices (§8) and resolves three of the four §9 open
> questions. Where the amendment and the 2026-06-24 text disagree, the
> amendment governs.
>
> **Phase 16.** Depends on Phase 14.5 (LLM-assist client, merged) and
> sits on the far side of the Phase-15 truth firewall
> (`docs/TRUTH_ADJUDICATION_DESIGN.md`). **Derived/advisory only:** no
> wire kind, nothing auto-saved, computed on explicit user invocation.
> `PHILOSOPHY.md` is cited here as borrowed principles with attribution
> (the Phase 15 posture), not as governing law for this surface.

This layer answers a question the rest of the stack deliberately refuses:
*"Under a named perspective J, how would assertion A be read, and on what
authority?"* It never asks *"is A true?"* — that firewall is the whole
point.

---

## §1. Why this exists — the missing half of the truth firewall

Phase 15 (`TRUTH_ADJUDICATION_DESIGN.md` §3.1) draws a hard line. A
proposition is adjudicable as true/false only when it is an `event-fact`,
`state-fact`, `prediction`, or `stated-commitment`. **Interpretations and
bare values are explicitly *not* adjudicable** — "only the honesty of the
reasoning behind them is assessable… the firewall against the tool becoming
an orthodoxy enforcer."

That leaves a real gap. An article's load-bearing work is often *normative*
("men should step down from hierarchy") or *framing* (what the title
emphasizes, what is omitted, the tone). Phase 15 correctly declines to call
these true or false. But declining to adjudicate is not the same as having
nothing useful to say. This layer takes exactly the proposition classes the
truth layer firewalls off and does the only honest thing available:
**reconstructs how specific, named perspectives would read them, grounded in
those perspectives' own authorities** — and reports its own evidentiary
honesty as the payoff.

The truth layer and this layer are two sides of one wall:

| | Truth layer (Phase 15) | Lens-reading layer (Phase 16) |
|---|---|---|
| Owns | `event-fact` / `state-fact` / `prediction` / `stated-commitment` | `interpretation` / `stated-value` (as **`evaluative`**), plus `normative` / `framing` (§3) |
| Asks | "Is the proposition true?" | "How would perspective J read it?" |
| Output | one of the five shipped `VERDICT_STATES`: `established-true` / `established-false` / `contested` / `unresolved` / `insufficient-evidence` | a `disposition` *under a named jurisdiction*, never in the tool's voice |
| Voice | the world | the perspective |
| Persisted | wire kinds `30063`/`30064` (gated) | nothing — derived view only |

---

## §2. Position in the judgment stack

X-Ray already separates several judgment kinds by wire kind so none can be
mistaken for another. This layer extends that discipline and is the first
that produces **no canonical wire artifact at all**.

| Layer | Kind | What it judges | Form |
|---|---|---|---|
| Assessment | `30054` | the reader's own stance on a claim | stance + labels |
| Audit | `30056`–`30061` | article craft / epistemics | 0–100 **estimation** w/ knowability ceiling |
| Forensic | `30062` | behavioral maneuvers | categorical, no score |
| Truth | `30063`/`30064` | truth-value of facts & commitments | descriptive state, measurements only |
| **Lens-reading** | **none (derived)** | **how a named perspective reads normative/framing/value** | **per-jurisdiction `disposition` + grounding report** |

**Firewall map.** This layer owns precisely the proposition classes Phase 15
§3.1 excludes. A reader who wants "is this true" goes to the truth layer; a
reader who wants "how would this tradition / author / legal code see it" comes
here. Neither answers the other's question.

---

## §3. Division of labor with the truth layer (the central integration)

### §3.1 Assertion typing — one lens-side enum, mapped, never merged

The engine tags each assertion with one of four **lens-side** types
(`LENS_ASSERTION_TYPES`, home: `src/shared/lens-taxonomy.js` at 16.1):

| Lens type | Meaning | Phase 15 mapping |
|---|---|---|
| `factual` | checkable against the world | ≡ `TRUTH_ADJUDICABLE_CLASSES` (`event-fact` / `state-fact` / `prediction` / `stated-commitment`) — **deferred to Phase 15** |
| `normative` | an ought-claim | no proposition class — a property of article text |
| `evaluative` | a reading or bare value | covers Phase 15's `interpretation` + `stated-value` — the two classes §3.1 hands over |
| `framing` | emphasis / omission / tone | no proposition class — a property of article text |

Three rules keep the vocabularies from bleeding into each other:

- **`PROPOSITION_CLASSES` is never extended.** `normative` and `framing`
  do not become proposition classes; they exist only in this layer's
  per-run typing. (The 2026-06-24 draft's §1 table mixed the two
  vocabularies; this table is the fix.)
- The lens typing is **computed per run and lives only in the §7 output**
  — it is never stored on claim records, so the token overlap with the
  legacy `CLAIM_TYPES` enum in `claim-model.js` (`factual`, `causal`,
  `evaluative`, `predictive` — an older, unrelated vocabulary) has no
  data-level consequence. Code never compares tokens across the enums.
- **`stated-value` is co-owned, deliberately.** This layer reads a stated
  value perspectivally; the truth layer's §3.4 integrity application
  separately measures *conduct against* that stated value (a match state,
  not a truth verdict on the value). The two uses never meet in one
  artifact.

### §3.2 The boundary, both directions

- **`normative`, `framing`, and `evaluative` assertions** are this layer's
  to evaluate — perspectivally, never as truth.
- **`factual` assertions are deferred to the truth layer.** This engine
  does **not** pronounce a fact true or false even when a jurisdiction's
  corpus takes a side. The most it may say is the *descriptive*
  observation carried in the §7 `corpus_stance` field — **"jurisdiction
  J's loaded corpus asserts / denies / is silent on this"** — a statement
  about the corpus, not about reality. Factual assertions **never carry a
  `disposition`** (schema-enforced, §7), so the model cannot be forced
  into truth-policing in perspectival costume.

The firewall runs the other way too: a lens-reading is **never** an input
to integrity or asserter reputation. The truth layer enforces the same
boundary from its side: its integrity findings (§3.4 of the truth doc) are
descriptive match states, and its reputation-eligibility gate (§3.5) is
explicit that "interpretations, stance, and values are never
reputation-eligible." This layer is the perspectival axis those gates
exclude; it stays out of the reputation-eligible set by construction.

---

## §4. Core concepts mapped to substrate — as amended

The 2026-06-24 draft claimed "nothing new is invented at the storage
layer." The audit found that claim false on every row: `ENTITY_TYPES`
(`person`/`organization`/`place`/`thing`/`case`) has no fit for a legal
code or a tradition; entity records have no home for a jurisdiction type,
`is_living_person`, `internal_divisions`, or corpus bindings; and every
entity minted gets a NOSTR keypair plus entity-browser and kind-0 publish
exposure that "Christianity" and "US federal law" must not inherit. The
amended mapping:

| Concept | X-Ray substrate (amended) | Home |
|---|---|---|
| **Jurisdiction** (codified / worldview / persona) | a record in a new **local jurisdiction registry** (`chrome.storage.local`, following the `Storage.platformAccounts` registry precedent): `{ id, jurisdiction_type, display_name, is_living_person, internal_divisions[], corpus[], entity_id? }`. Registry-primary. `entity_id` is **optional and persona-only** — a persona may link to an existing `person` entity for dedup with captured authors; codified/worldview jurisdictions get **no entity record in v1** (no keypair, no kind-0 exposure, no entity-browser collision). | `src/shared/jurisdiction-model.js` (16.1) |
| **Authority** | an **authority record** inside `corpus[]`: `{ citation: { work, edition, isbn?, locator, tradition?, language? }, excerpt, admissibility, claim_id?, anchor? }`. The bibliographic citation is the general case; a captured claim + W3C anchor (`claim_id` + `anchor`) is the **web-only specialization**, not the definition — books, scripture, and statutes are citable without a capture. Corpus rows are **never** bound via `claim.about[]`: that would sweep lens-layer artifacts into truth/entity/case surfaces, a data-level firewall breach. | `src/shared/jurisdiction-model.js` (16.1) |
| **Target** (the article under review) | a captured article (`30023`) — unchanged | existing capture pipeline |
| **Reading** | a **derived view**, computed on explicit user invocation, session-cached, never durably saved (§6) | follows `src/shared/audit/dossier.js` in spirit; differences in §6 |

Quota note: jurisdiction corpora share the ~10 MB `chrome.storage.local`
quota with everything else (no `unlimitedStorage` permission) — one more
reason the §10 excerpt cap is load-bearing.

The three jurisdiction **definition templates** (codified / worldview /
persona) are normative inputs to the engine and live in **Appendix A**;
they ship as docs + test fixtures only (§9 Q3: **zero built-in
jurisdictions in v1**).

---

## §5. Design principles — adopt all eight, with three corrections

The eight principles (ground-in-corpus, lens-vs-truth separation,
steelman, encoded pluralism, living-person guardrail, calibrated
confidence, cite-precedent/flag-silence, split-content-from-framing) are
adopted and now **authored in full in Appendix A.1** — the draft that
originally carried them was never committed, so this doc is their home.
They are congruent with `PHILOSOPHY.md` (P3 verbatim-evidence, the
never-score-a-conclusion rule, §3.2 steel-manning), cited as borrowed
principles. Three points need explicit reconciliation so the layer doesn't
contradict the rest of the stack:

### 5.1 Confidence is a *legitimate estimation*, not a stray score

The truth layer's §1 forbids estimated scores standing in for verdicts:
*"Verdicts are descriptive states. Quantities are measurements, never
estimations."* This engine's `high | medium | low` confidence **is** an
estimation. It is nonetheless **admissible here, for the same reason the
audit's 0–100 is** (truth-doc §1: an estimation is legitimate where scope is
"limited" and purpose is "heuristic"):

> A lens-reading is **not a truth-verdict.** Its confidence measures the
> *fidelity of a perspectival reconstruction* — how directly the loaded
> corpus addresses the assertion, how unified the tradition is, how much
> inference was required — never how true the assertion is or how strongly
> the jurisdiction "feels." Because it makes no claim about reality at human
> stakes, the §1 prohibition does not bind it; it sits on the
> estimation-legitimate side of the same line the audit score sits on.

This must be stated wherever confidence is surfaced — every confidence
chip carries the fidelity-not-truth note, and a 16.4 test pins the note
string next to `LENS_PROMPT_VERSION` so it cannot silently disappear.

### 5.2 Surface framing is **"lens-reading," not a court** — and the names are binding

The source prompt's "Online Court of Justice / rulings / verdicts /
opinion" metaphor collides with the truth layer's reserved word
**"verdict"** and X-Ray's under-claiming posture (`CRIMINOLOGY_DESIGN.md`'s
"structural observations, not verdicts"). The *structure* is kept; the
surface vocabulary changes — and, new in this amendment, the renames are
binding on code, not just prose:

| Prompt term | This layer's term |
|---|---|
| ruling / verdict | **reading** / `disposition` |
| court opinion | **perspectival reconstruction** |
| integrity report | **grounding report** — Phase 15 owns "Integrity" (`integrity-model.js`, kind `30064`, the portal Integrity facet); the same word for an unrelated per-jurisdiction honesty report, in adjacent UI, would be indefensible |
| jurisdiction | jurisdiction *(kept — it is descriptive)* |

Naming rules for 16.x implementation:

- **Forbidden substrings** in Phase 16 exported symbols, storage keys, and
  user-visible strings: `Verdict`, `Ruling`, `Opinion`, `Court`,
  `Integrity`. A 16.4 test greps the parsed §7 output keys and the module
  export names for `/verdict|ruling|opinion/i`.
- **Modules:** `lens-taxonomy.js`, `jurisdiction-model.js`,
  `lens-engine.js`, `lens-schemas.js` (or `moral-lens-*` if a longer
  prefix reads better at 16.1 — pick once, at 16.1).
- **CSS prefix `xr-lensread-*`.** Plain "lens" is taken: the portal's
  Phase-14 forensic report views are `FINDING_LENSES` / `xr-findings-lens`
  (audience lenses). The two senses must stay distinguishable in code and
  in the smoke test.
- **Token grammar:** disposition tokens use the house lowercase-hyphenated
  grammar — `partially-endorses`, `out-of-scope` — not the draft's
  underscores. `assessment-taxonomy.js`'s `LABEL_RE` rejects underscores;
  if a `30066` surface ever exists, hyphenated tokens need no breaking
  rename. The disposition set is otherwise unchanged:
  `endorses | rejects | partially-endorses | reframes | out-of-scope | silent`.

"Verdict" is reserved for Phase 15 so the firewall stays legible at a glance.

### 5.3 Panel composition is a symmetry obligation

The per-jurisdiction grounding report covers *per-jurisdiction* honesty
(grounded vs inferred, thin coverage, recommended sources). It does not
cover the bias that enters one level up: **which** jurisdictions get
empaneled. Loading only lenses hostile to a target turns the panel into a
hit piece while every individual reading stays scrupulously grounded.
`PHILOSOPHY.md` **P5 (symmetry is existential)** applies directly:

> The empaneled jurisdictions, and the basis for selecting *these and not
> others*, are disclosed in the `panel_composition` field. A panel with no
> jurisdiction a fair observer would expect to be sympathetic to the target
> is flagged, exactly as an audit that is never "uncomfortable for every
> camp" is flagged. Selection is itself a judgment call, and asymmetric
> selection is how this tool would die quietly.

Amendment: `panel_composition` and `panel_comparison` are **assembled
code-side** from the user's declared selection and the per-jurisdiction
results — the model is never asked to characterize its own panel.

---

## §6. Architecture and reuse — as amended

- **Transport.** A new exported `runLensPass()` in `src/shared/llm-client.js`
  beside `runSuggestionPass`/`runAuditPass`, reusing the same Messages-API
  plumbing, forced-tool structured output (`extractToolInput`), and
  truncation detection (`stop_reason === 'max_tokens'`). The call runs in
  the background service worker (key never leaves the SW), behind a new
  **`xray:lens:read`** message plus a **`xray:lens:config`** snapshot
  message — `xray:llm:config` is *not* reused, because its `enabled` bit
  means `llmAssist`, which is a different gate (below).
- **Call topology: one bounded call per jurisdiction** (the
  `runPerModuleAudit` → `assembleAudit` precedent), with
  `panel_composition`/`panel_comparison` assembled code-side. The reader
  sends **one `xray:lens:read` message per jurisdiction**: each incoming
  message resets the MV3 service-worker idle timer, and partial results
  reach the reader incrementally — one failed jurisdiction renders as
  failed-with-reason while the rest of the panel completes. An
  `AbortController` timeout bounds each call so a hung request cannot
  permanently disable the reader control. The cost confirm states the call
  count and that closing the reader mid-run drops paid results.
- **The reading is a derived view, computed on explicit user invocation
  only** — a button, never "on open." The 2026-06-24 draft's
  "computed-on-open" borrowed `dossier.js` vocabulary that does not
  transfer: the dossier is free, local, and deterministic; a lens pass is
  a paid, nondeterministic API call, and Phase 14.5's governing rule is
  "one pass per explicit user action; no background polling." The result
  is discardable, **session-cached per capture UUID in
  `chrome.storage.session`** (re-opening within a session re-renders
  without a new API call), and **never durably written** — no
  `chrome.storage.local`, no IndexedDB, no relay pool. A 16.4 guard test
  pins the zero-durable-writes property. A durable "precious" lens cache
  (the `audit-cache.js` posture) is explicitly deferred alongside the wire
  format.
- **Provenance.** The §7 output carries `{ model, prompt_version, run_at }`.
  `LENS_PROMPT_VERSION` is exported from the pure prompt module with an
  exact-match pin test (the `CURRENT_MODULE_VERSIONS` "bump alongside the
  prompt" idiom). The pinned inputs are the **stored** verbatim excerpts
  (`authority.excerpt` / claim text) and the target's canonical article
  hash computed over **exactly the text sent** — never a live-page anchor
  re-resolution, and never a silently truncated payload: the client's
  `MAX_ARTICLE_CHARS` (120k) slice must either surface in the grounding
  report's `truncation_flags` or refuse the run. Provenance is
  `suggested_by: 'llm:<model>'` at any point a constituent artifact is
  persisted through existing `create()` paths.
- **Gating: `moralLens` flag + API key, independent of `llmAssist`.** A
  new `moralLens` flag in `FLAGS_DEFAULTS`
  (`src/shared/metadata/feature-flags.js`), default off, wired the full
  house route: Options → Advanced checkbox, **both** the load and save
  sides, and `loadFlags()` read fresh at every gate (there is no
  flags-reload broadcast to rely on). The key-consent gate is inherited
  from 14.5, with the consent copy **extended**: a lens pass sends the
  article text *plus the jurisdiction definitions and captured authority
  excerpts* to Anthropic — the existing copy describes article text only.
  Refusals surface with their own strings pointing at the right Options
  switch; a guardrail firing is mapped to a distinct refusal state, never
  the generic "Try again."
- **No wire kind.** Kind **`30066` is left free**, and the deferral is
  machine-checked: 16.4 guards assert that no builder emits `30066` and
  that the lens path performs zero durable storage writes. If
  lens-readings ever become shareable that is a separately-designed act
  (§9 Q4), not part of v1.

---

## §7. Output contract — as amended

The engine emits a machine-readable object plus a human-readable
reconstruction. Per-jurisdiction objects come back one call at a time
(§6); the assembled shape (full schema authored at 16.2 in
`lens-schemas.js`, against the shared tiny-schema walker factored out of
`findings-schemas.js`):

```json
{
  "provenance": { "model": "…", "prompt_version": "…", "run_at": "…" },
  "target": { "title": "…", "url": "…|null", "content_hash": "…",
    "claims": [ { "id": "c1", "text": "verbatim", "type": "factual|normative|evaluative|framing" } ] },
  "jurisdictions": [ {
    "id": "bell-hooks", "type": "persona|worldview|codified",
    "display_name": "…", "is_living_person": false,
    "authorities_loaded": [ { "authority_id": "…", "citation": "work+edition+locator", "language": "…", "coverage": "high|medium|low" } ],
    "internal_divisions": [ "…" ],
    "readings": [ {
      "claim_id": "c1",
      "disposition": "endorses|rejects|partially-endorses|reframes|out-of-scope|silent",
      "corpus_stance": "asserts|denies|silent",
      "reasoning": "in the jurisdiction's own logic",
      "authorities_cited": [ { "authority_id": "…", "locator": "…", "grounding": "direct-quote|paraphrase|inference" } ],
      "content_vs_framing": "how substance vs. framing fare, separately",
      "confidence": "high|medium|low",
      "confidence_rationale": "coverage + unity + inference load (fidelity, not feeling — §5.1)"
    } ],
    "reconstruction_summary": "short narrative in the jurisdiction's voice",
    "grounding": {
      "grounded_count": 0, "inferred_count": 0,
      "thin_coverage_flags": [ "…" ], "recommended_sources": [ "…" ],
      "truncation_flags": [ "…" ]
    }
  } ],
  "panel_composition": {
    "empaneled": [ "…" ],
    "selection_basis": "why these jurisdictions (user-declared, assembled code-side)",
    "symmetry_flags": [ "no jurisdiction sympathetic to the target was loaded" ]
  },
  "panel_comparison": {
    "agreements": [ "…" ],
    "divergences": [ { "claim_id": "c1", "split": "who reads what, and the premise driving it" } ]
  }
}
```

Contract rules (schema-enforced, not stylistic):

- `disposition` and `corpus_stance` are **mutually exclusive by type**: a
  `factual` claim carries `corpus_stance` and may not carry a
  `disposition`; the other three types carry a `disposition` and no
  `corpus_stance`. This is how the §3 firewall survives contact with the
  model.
- `target.claims` is **assembled code-side** from the captured claims the
  user selected — the model receives claim ids + text as input and is
  never asked to re-echo them, removing the largest avoidable output-token
  cost and a fidelity failure mode.
- A reading with an empty `authorities_cited` is valid only when its
  disposition is `silent` or `out-of-scope`; otherwise the validator
  rejects it (parse-time downgrade, not a prompt hope).

Quoting discipline: §10.

**Hard stops** — each with its enforcement locus, so 16.4 can test the
code-enforced set instead of hoping about model behavior:

| Hard stop | Locus | Behavior |
|---|---|---|
| No corpus loaded for a jurisdiction | **code, pre-call** (16.2) | refuse before any network call: "jurisdiction not grounded" |
| Living-person persona without an admissible published corpus | **code, pre-call** (16.2) | refuse; `is_living_person` absent/unknown ⇒ **treated as living — fails closed** |
| Corpus does not address a claim | prompt + **parse-time validator** | `silent`, not a guess; empty `authorities_cited` accepted only with `silent`/`out-of-scope` |
| Locator can't be anchored to a named edition | prompt | `grounding: "inference"` + thin-coverage flag |
| Model refusal | **client** | `stop_reason` mapped to a distinct refusal state with its own message — never generic "Try again" |
| Input truncation | **code** | surfaced in `grounding.truncation_flags`, or the run is refused — never silent |

---

## §8. Slice plan (Phase 16.x) — as amended

Branches `claude/phase-16-*`, one PR per slice, stacked on `main`.

> **Base-branch constraint (audit-verified):** `origin/main` carries the
> full Phase 14.5 substrate (`llm-client.js`, `llm-prompts.js`,
> `llm-proposals.js` — byte-identical to the Phase 15 train tip) and the
> 16.1 substrate (`entity-model.js`, `claim-model.js`, anchors,
> `feature-flags.js`), but **none of Phase 15** while the #79–#89 train is
> unmerged. Until the train merges, Phase 16 code imports **nothing** from
> `truth-taxonomy.js`, `adjudicate-modal.js`, or any `truth-*`/
> `integrity-*` module; cross-vocabulary disjointness pins assert against
> **string literals**, not imports. The factual hand-off *routing* (16.3)
> is the one deliberately train-dependent seam.

- **16.0 — gate.** Phase 14.5 LLM-assist merged. ✅ satisfied.
- **16.0.5 — this amendment.** Docs-only; encodes the pre-implementation
  audit's decisions.
- **16.1 — jurisdiction model.** `lens-taxonomy.js`: frozen
  `DISPOSITIONS`, `JURISDICTION_TYPES`, `LENS_ASSERTION_TYPES` + labels +
  validity predicates + exhaustive-enum pin tests + literal-token
  disjointness pins (DISPOSITIONS ∩ Phase 15 verdict/match tokens = ∅).
  `jurisdiction-model.js`: the registry, authority records with
  `citation`/`excerpt`/`admissibility`, the Q1 admissibility rule,
  `is_living_person` fail-closed semantics. `moralLens` flag registered in
  `FLAGS_DEFAULTS`. Console-first authoring (the §Phase 15 pattern); the
  Appendix A templates ship as docs + test fixtures; **zero built-in
  jurisdictions**.
- **16.2 — the lens-reading engine.** The system prompt module (authored
  from Appendix A, exporting `LENS_PROMPT_VERSION`) + `runLensPass()` +
  `xray:lens:read`/`xray:lens:config` handlers + `lens-schemas.js`
  parse/validate against §7 (shared walker factored out of
  `findings-schemas.js`) + **all pre-flight refusals as code** (unloaded
  jurisdiction, living-person guardrail — testable without a key) +
  the session cache. Derived view, never durably saved.
- **16.3 — reader surface.** The reader lens bar end-to-end (modeled on
  the audit run control): jurisdiction multi-select, Run with
  call-count cost confirm, per-jurisdiction rendering of readings +
  grounding report + `panel_composition` disclosure, the
  content-vs-framing split per reading, the §5.1 fidelity note on every
  confidence chip. Options toggle + extended consent copy. `factual` rows
  render a "deferred to truth layer" badge + `corpus_stance` descriptor;
  the 🏛 route into `adjudicate-modal.js` lands only once the Phase 15
  train is merged. **The portal surface is deferred** — a never-persisted
  derived view has nothing to show in a relay-corpus portal.
- **16.4 — the test net.** Fixture-driven validator suites over parsed §7
  outputs; fetch-tripwire unit tests proving pre-flight refusals fire
  before any network call; the §5.2 word-reservation pin
  (`/verdict|ruling|opinion/i` absent from output keys and exports);
  vocabulary-disjointness pins by literal; the no-builder-emits-`30066`
  guard; the zero-durable-writes guard.
- **(deferred)** publishable wire kind `30066` + NIP framing readings as
  *perspectival reconstructions, not verdicts*; persona-corpus capture
  tooling; multi-target panels; the portal surface; a durable
  ("precious") lens cache.

---

## §9. Open questions — three resolved, one deferred

1. **Persona corpus admissibility — RESOLVED (binding on 16.1).** Each
   authority carries an `admissibility` field from day one (retrofitting
   would invalidate stored corpora). For a jurisdiction with
   `is_living_person: true`, only **editorially published** works are
   admissible: a book with edition/ISBN, a bylined published essay or
   article, a published transcript of a public talk. Captures from social
   platforms (twitter / facebook / instagram / tiktok) are **inadmissible**
   for living personas. A living-person persona whose admissible corpus is
   empty is refused pre-call (§7 hard stops). `is_living_person`
   absent/unknown ⇒ treated as living.
2. **Factual hand-off UX — SPLIT.** The schema half is decided
   (`corpus_stance`, 16.2). The surface half lands at 16.3: factual rows
   get the "deferred to truth layer" badge + corpus-stance descriptor,
   and the 🏛 action funnels into the existing claim flow /
   `adjudicate-modal.js` once the Phase 15 train merges.
3. **Built-in vs user-authored jurisdictions — RESOLVED: zero built-ins.**
   The three templates ship as docs (Appendix A) + test fixtures only.
   This sidesteps the curated-set selection-bias exposure (P5) and the
   copyright problem of shipping corpus excerpts; the smoke test authors
   its jurisdictions via a console block.
4. **Wire format, if ever — DEFERRED, machine-checked.** `30066` stays
   free; the 16.4 guards (no builder emits it, zero durable writes) keep
   the deferral honest. Should demand materialize, the NIP frames readings
   as perspectival reconstructions, never verdicts.

Still genuinely open (non-blocking): persona-corpus capture *tooling* UX,
and multi-language panels beyond the v1 rule (each authority records its
`language`/translation — for a translated work the translation *is* the
content, so edition pinning is doubly load-bearing; v1 renders readings in
the target article's language).

---

## §10. Quoting discipline (written down)

The 2026-06-24 draft cited "X-Ray's copyright rules," which did not exist
anywhere in the repo. They now exist, here:

- **Authorities are cited by locator; content is paraphrased.** Short
  attributed excerpts only where exact wording is load-bearing.
- **Per-authority `excerpt` is capped at 500 characters** (the
  `anchor-capture.js` `EXACT_LENGTH_CAP` precedent). Longer passages are
  represented by locator + paraphrase, or split across multiple
  authorities each within the cap. An authority quote is never silently
  truncated — over-cap input is rejected at `create()` with a clear error.
- **Model output may quote at most what the stored excerpt contains** —
  the prompt instructs paraphrase-first and the validator has no way to
  verify fair use, so the stored cap is the outer bound by construction.

---

## §11. Smoke-test plan (rows land in `SMOKE_TEST.md` with the slices)

Full §Phase 16 rows are added to `docs/SMOKE_TEST.md` as slices ship
(16.A/16.B setup–cleanup console blocks, the §Phase 15 pattern). The
audit pre-drafted the skeleton; its load-bearing properties:

- **Rows assert structure and guardrails, never specific dispositions** —
  the model pass is nondeterministic; a row that expects "rejects" is
  flaky by design.
- **The keyless set is the majority**: all of 16.1 authoring, flag/key
  gating negatives (flag off → no UI anywhere; key absent → Run disabled
  with a hint; `llmAssist` off → lens unaffected), both pre-flight
  refusals (ungrounded jurisdiction, living-person persona without
  admissible corpus — enforced in code before any network call), and the
  derived-only guarantees (no new `chrome.storage.local` keys after a
  run; no lens segment in the publish summary; no kind-`30066` anywhere).
- **The keyed set is small and bounded**: panel render, §5.1 note on
  every confidence chip, factual-row badge + corpus-stance (never a
  disposition), silent-when-unaddressed, one-hostile-lens symmetry flag,
  call-count cost confirm, partial-failure render, bad-key error path,
  oversized-target truncation notice. Run on a **short op-ed with a
  cheap model** to bound spend.
- **Two rows the audit added beyond the draft**: a long-panel run to
  observe MV3 service-worker survival (plus reader-closed-mid-run), and a
  Firefox ≥128 repeat of the core rows (the background page is an event
  page there, not a service worker).

---

## Appendix A — re-authored normative inputs

> The 2026-06-24 draft deferred to a "moral-lens-jurisdiction
> system-prompt draft" that was never committed to this repo. This
> appendix re-authors that content from the design's own descriptions and
> is now the normative input to 16.2. If the original draft ever
> surfaces, reconcile against this appendix and record divergences here.

### A.1 The eight principles

1. **Ground-in-corpus.** Every reading traces to loaded authorities. The
   model's background knowledge of a tradition is inadmissible: if the
   corpus doesn't carry it, the reading can't use it.
2. **Lens-vs-truth separation.** The engine never pronounces a fact true
   or false. For `factual` assertions it may only describe the corpus
   (`asserts` / `denies` / `silent`); truth-adjudication routes to
   Phase 15.
3. **Steelman.** Reconstruct the strongest good-faith version of the
   jurisdiction's response — the reading a thoughtful adherent would
   recognize as fair — never a caricature (cf. `PHILOSOPHY.md` §3.2).
4. **Encoded pluralism.** Traditions are internally divided. A worldview
   jurisdiction carries `internal_divisions`, and a reading notes which
   strand it reconstructs. There is never one decree for "Christianity."
5. **Living-person guardrail.** A persona jurisdiction for a living
   person reads **published positions only** — never inferred private
   belief, motive, or character. Unknown living status fails closed;
   inadmissible corpus refuses pre-call (§9 Q1).
6. **Calibrated confidence.** `high | medium | low` measures
   reconstruction fidelity — corpus coverage × tradition unity ×
   inference load — never truth and never the jurisdiction's fervor
   (§5.1).
7. **Cite-precedent / flag-silence.** Every disposition cites authorities
   by locator. Where the corpus is silent, the reading is `silent` — plus
   `recommended_sources` naming what would need to be loaded to do
   better.
8. **Split content from framing.** Substance and framing are evaluated
   separately; a jurisdiction may endorse what an article says and reject
   how it says it, and the reading must be able to express that.

### A.2 Definition templates (docs + test fixtures; zero ship as built-ins)

**Codified** — a legal code; authorities are statutes/regulations by
official citation:

```json
{
  "jurisdiction_type": "codified",
  "display_name": "US federal law (employment-discrimination excerpt)",
  "internal_divisions": ["note circuit splits where they exist"],
  "corpus": [ {
    "citation": { "work": "United States Code", "edition": "2024 ed.",
                  "locator": "42 U.S.C. § 2000e-2", "language": "en" },
    "excerpt": "<verbatim statutory text, ≤500 chars>",
    "admissibility": "published-statute"
  } ]
}
```

**Worldview** — a tradition, pluralism encoded; authorities carry the
tradition/strand and (for scripture) the named translation:

```json
{
  "jurisdiction_type": "worldview",
  "display_name": "Christianity (multi-tradition)",
  "internal_divisions": ["Catholic social teaching", "Reformed",
                          "Anabaptist / peace-church"],
  "corpus": [ {
    "citation": { "work": "Bible (NRSV)", "edition": "NRSV Updated Edition, 2021",
                  "locator": "Matthew 20:25-28", "tradition": "shared",
                  "language": "en" },
    "excerpt": "<verbatim, ≤500 chars>",
    "admissibility": "published-scripture"
  }, {
    "citation": { "work": "Rerum Novarum", "edition": "Vatican tr.",
                  "locator": "§§ 20-22", "tradition": "Catholic social teaching",
                  "language": "en" },
    "excerpt": "<verbatim, ≤500 chars>",
    "admissibility": "published-doctrine"
  } ]
}
```

**Persona (deceased)** — an author's corpus; books by edition/ISBN/page:

```json
{
  "jurisdiction_type": "persona",
  "display_name": "bell hooks",
  "is_living_person": false,
  "entity_id": "<optional link to an existing person entity>",
  "corpus": [ {
    "citation": { "work": "The Will to Change", "edition": "<edition>",
                  "isbn": "<isbn>", "locator": "ch. 2, p. <n>", "language": "en" },
    "excerpt": "<verbatim, ≤500 chars>",
    "admissibility": "published-book"
  } ]
}
```

**Persona (living — the guardrail template)** — e.g. a living essayist
such as Celeste Davis: `is_living_person: true`; admissible authorities
are **bylined published essays** (a public, bylined newsletter essay
qualifies; a tweet or other social post does not); readings reconstruct
**published positions only**, and the pre-flight refuses if the
admissible corpus is empty:

```json
{
  "jurisdiction_type": "persona",
  "display_name": "<living author>",
  "is_living_person": true,
  "corpus": [ {
    "citation": { "work": "<essay title>", "edition": "<publication, date>",
                  "locator": "<section/paragraph>", "language": "en" },
    "excerpt": "<verbatim, ≤500 chars>",
    "admissibility": "published-essay"
  } ]
}
```

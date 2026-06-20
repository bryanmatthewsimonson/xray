# Forensic findings — behavioral pattern analysis (Phase 14)

**Status:** design **agreed 2026-06-14**. Companion to — and deliberately
*not* a fork of — the Phase 11 assessment layer
([`ASSESSMENTS_DESIGN.md`](ASSESSMENTS_DESIGN.md)). Where an assessment
judges whether a *claim* is true, a **forensic finding** names a
*behavioral maneuver* a subject performs around the truth — an evasion, a
defense, a self-serving revision — and binds it to evidence, **without
rendering a verdict on the subject's honesty or intent.**

**Builds on Phase 13 (the epistemic audit; `docs/EPISTEMIC_AUDIT_KICKOFF.md`).**
Phase 14 is a *separate* feature that sits on top of the epistemic-audit
layer, which must merge to `main` first. The two are kept wire-disjoint on
purpose: the audit owns kinds **`30056–30061`** and the `epistemicAuditing`
flag, so this phase takes **`30062`** for its `BehavioralFinding` and the
distinct `forensicPublishing` flag. (It reuses Phase 11's kind `30055` for
the `revision/*` edges and kind `30054`/`1985` idioms — those are the
assessment layer, not the audit's.)

## What this is, and why it's separate from assessments

X-Ray already grades claims: an assessment (kind `30054`) carries a stance
(−2..+2) and typed truth/fallacy labels anchored to the offending span.
That answers *"is the claim true?"*. It does **not** answer *"what is this
person doing to the conversation?"* — narrowing an opponent's position,
patching a damaged claim with a new story, redefining a word to dodge the
evidence, changing their account once it's cornered.

Phase 14 adds the **behavior layer**. The two compose:

> *Claim:* "the Book of Abraham is a translation." → *Assessment (30054):*
> `unsupported`, stance −1. → *Forensic findings (30062):*
> `defense/definitional-retreat` anchored to the word *translation*, plus a
> **diachronic revision** edge showing the word's meaning shifted *after*
> the Egyptology evidence landed — to preserve the original conclusion.

The framing is borrowed, with attribution, from Dawn McCarty's "forensic
criminology" segment on *Mormonism Live* (2026-06-10,
[`0axZ8EGLaxQ`](https://www.youtube.com/watch?v=0axZ8EGLaxQ)) — and her
cybersecurity-flavored vocabulary (narrative patching, semantic inversion,
cognitive containment, epistemological fog, systemic overextension, trust-
credential spoofing) is reduced here to its **criminology / thought-reform
canon** so the taxonomy is citable rather than idiolectic
([Taxonomy](#maneuver-taxonomy-seeded-from-the-canon)).

It is a **separate artifact** from an assessment because the unit of
analysis is different in three load-bearing ways:

1. **The subject is a person-in-a-role over time, not a claim.** A finding
   accrues to an identity (Phase 9 identity layer) playing a declared
   **role** (apologist / critic / institution / witness / survivor). The
   same engine must profile *either side* — bias-symmetry is a hard
   requirement, not a nicety.
2. **There is no stance and no score.** A finding is a typed, evidence-
   anchored *observation of structure*. It deliberately carries no numeric
   confidence (see [the no-verdict rule](#methodology-the-six-rules)).
3. **Maneuvers are often sequences, not points.** Grooming is *build
   vulnerability → establish trust → redefine boundaries → apply pressure*;
   a narrative patch is *damage → cover story → containment*. A single
   label can't hold an ordered evidence chain; a finding's `anchors[]` can.

## Decisions at a glance

| Question | Decision |
| --- | --- |
| Artifact | **New kind `30062` (BehavioralFinding)** — addressable, one per (author, subject, maneuver, anchor-hash); targets a subject by `p`, carries an ordered evidence chain, a maneuver label under NIP-32-style `L`/`l` `xray/forensic` tags, with a **kind-1985 mirror** as the ecosystem-aggregation path. Parallels 30054, *not* an extension of it. |
| No score | A finding has **no stance, no confidence number.** Instead a bounded **`basis`** enum (`quoted` / `paraphrased` / `behavioral-cue` / `structural-inference`) records *how we know* — a real, checkable statement, not a subjective 0–100. |
| Falsifiability | A `counter_note` (the exonerating / alternative read) is **required** to save any subject-implicating finding. Each maneuver ships with definition + **indicators** + **counter-indicators**. |
| Subject + role | Reuses the **Phase 9 identity layer**; a finding references an identity + a `role` from a fixed enum. No new person/account object. |
| Diachronic story-change | **Extend kind `30055`** with directional `revision/*` relationship values (`narrative-patch`, `recharacterizes`, `walks-back`) linking statement-then → statement-now by the same subject. Additive to a shipped kind; a 30062 finding may *characterize* such an edge. |
| Taxonomy | New **`src/shared/forensic-taxonomy.js`**, namespace **`xray/forensic`**, six maneuver families seeded from the canon (Sykes & Matza, Freyd/DARVO, Lifton, Popper/Lakatos/agnotology, Finkelhor/Craven, statement analysis). **Reuses** existing `fallacy/*` and `consistency/*` labels where they already coincide. |
| Local-first | New `behavioral_findings` storage key; the existing `evidence_links` gains the `revision/*` values. Local capture always on; **publishing flag-gated** (`forensicPublishing`, default off). |
| Report lenses | Dawn's **evidentiary / executive / survivor / editor** views are *render modes over the same findings* in the portal, not different data. |
| LLM-ready | `suggested_by` (`'user'` \| `'llm:<model>'`) on every finding — her engine is an LLM, so findings are natively `llm:<model>`, human-confirmed, with the anchor + counter-note discipline enforced. |
| Non-goals (v1) | Truth verdicts on subjects, intent attribution, micro-expression *scoring*, aggregating others' findings (publish-*ready* only), automated detection shipping on by default. |

## Methodology — the six rules

These come straight from the source method and are the spine of the design;
the taxonomy, the model validation, and the UI all enforce them.

1. **Structure, not intent.** A finding describes the *maneuver*, never the
   subject's honesty. The method's own words: *"without me saying tell me if
   they're lying — we don't want to say anything like that"* and *"I don't
   need to prove that Jacob intends manipulation; the structure functions by
   reducing the alternative."* The model has **no `lying` / `dishonest` /
   intent field**, by construction. This is what keeps it bounded in what's
   real.
2. **Evidence-bound** ("source-fed, target-fed, evidence-sourced"). A
   finding **cannot be saved with zero anchors.** Each anchor is a selector
   into the captured source + the quoted span (+ optional media timestamp).
3. **Baseline → deviation.** A finding may stand alone *or* reference an
   established **baseline** for the subject and be flagged as a deviation
   from it (the signal is the change, not an absolute reading).
4. **Role-typed and symmetric.** Every finding fixes a subject + role and
   must be runnable against critics as readily as apologists. The taxonomy
   carries no side; the acceptance demo profiles both interlocutors.
5. **Sequences are first-class.** `anchors[]` is ordered; `n > 1` means a
   multi-step maneuver (the grooming sequence, patch-then-contain).
6. **Falsifiability discipline.** `counter_note` (required) records the
   alternative reading; each maneuver definition pairs **indicators** with
   **counter-indicators** so "what would make this *not* this" is always on
   the page.

## Subject, role, and baseline (the identity rules)

A finding points at a **subject**, resolved through the Phase 9 identity
layer (captured commenters/authors as dedup-able identities; cross-platform
accounts collapsible to one person). Reusing that layer means a subject's
findings aggregate across captures and platforms for free.

```
subject_ref {
  identity_id?     // local identity id (canonical for tracked subjects)
  pubkey?          // entity/person pubkey when one exists (wire join key)
  account?         // platform-account handle when no identity is resolved yet
  label            // display snapshot ("Jacob Hansen") — survives relay churn
}
role               // apologist | critic | institution | witness | survivor | other
```

- **Role enum** lives in `forensic-taxonomy.js` (exhaustive-enum test pins
  it), wire value lowercased. `institution` covers the "no one coordinates
  it, yet a unified front emerges" case — findings can target an org pubkey.
- **Baseline.** A lightweight `forensic_baselines` note per (subject, source)
  records the subject's established register ("held an even tone across 3
  sessions; fact-anchored"). A deviation finding sets `baseline_ref`. The
  baseline is descriptive prose + optional anchors, never a score.

## Data model (local-first)

### BehavioralFinding

Stored under a new `chrome.storage.local` key **`behavioral_findings`** as a
single id→record map — same JSON-serialized Storage conventions as
`claim_assessments`, no keypair-registry involvement.

```
BehavioralFinding {
  id              // find_<sha256(canonical)[:16]>  — deterministic, idempotent
                  //   canonical = subjectRef | maneuver | anchorsHash
  subject_ref     // { identity_id?, pubkey?, account?, label } (above)
  role            // role enum
  maneuver        // taxonomy value, e.g. 'defense/ad-hoc-patch',
                  //   'neutralization/condemn-condemners'
  anchors: [ {    // ORDERED; >= 1 required; n>1 = sequence
    selector        // selector array from metadata/anchor-capture.buildSelectors
    quote           // the offending/illustrative span (export-survivable)
    source_ref      // { url, url_raw, title?, coord?, event_id? } — where it lives
    timestamp?      // media offset (seconds) for A/V sources
    step_note?      // short per-step note (sequence steps)
  } ]
  baseline_ref?   // id of a forensic_baselines note this deviates from
  note            // structural rationale, markdown (the "what the structure does")
  counter_note    // REQUIRED — the exonerating / alternative reading
  basis           // 'quoted' | 'paraphrased' | 'behavioral-cue' | 'structural-inference'
  related_rel?    // optional id of a 30055 revision edge this characterizes
  suggested_by    // 'user' | 'llm:<model>'  (default 'user')
  created, updated, publishedAt, publishedEventId, publishedPubkey
}
```

- **Validation:** ≥ 1 anchor; non-empty `counter_note`; `maneuver` valid
  against the taxonomy (standard or custom token grammar, same rails as
  assessment labels); `basis` in the enum; `role` in the enum; `suggested_by`
  per `isValidSuggestedBy`. No stance, no score, no intent field exists to
  validate. Clone the `assessment-model.js` idempotency/markPublished
  patterns (deterministic id, `markPublished` doesn't bump `updated`,
  immutable refs except coord/pubkey backfill).
- **Module:** `src/shared/forensic-model.js`, following `AssessmentModel`.

### Diachronic revision edge (extends `evidence-linker.js` / kind 30055)

A self-serving story-change is a *link between two of the same subject's
statements over time*. Rather than a new kind, **extend the existing typed-
link substrate** with three directional values:

- `narrative-patch` — B is a new explanation added after A was damaged, so
  A's conclusion survives ("the problem isn't solved, it's covered by
  another story").
- `recharacterizes` — B redefines a key term from A to dodge evidence
  (translation → "revelation/inspiration"); the diachronic face of
  `defense/definitional-retreat`.
- `walks-back` — B retreats from / softens A once A was cornered.

All three are **directional** (source = earlier statement, target = later),
joining the existing `contradicts / supports / updates / duplicates`. The
neutral edge says *"B revises A"*; an optional `30062` finding
(`related_rel`) says *"this revision instantiates maneuver M by subject S,
here is the evidence, here is the counter-read"* — keeping neutral-link and
behavioral-characterization cleanly separated, per Rule 1.

## Maneuver taxonomy (seeded from the canon)

Canonical list in **`src/shared/forensic-taxonomy.js`**, namespace
**`xray/forensic`**, grouped for the picker, exported flat, pinned by the
exhaustive-enum test idiom. Each entry carries: canonical name, **source
citation**, **Dawn-alias**, one-line definition, **indicators**, and
**counter-indicators**. The custom-label escape hatch and token grammar are
identical to the assessment taxonomy.

| Family | Canon source | Dawn's term(s) it absorbs |
| --- | --- | --- |
| `neutralization/*` | **Sykes & Matza 1957** (+ Klockars' ledger, Minor's extensions) | "attack the questioner" = condemn-condemners |
| `darvo/*` | **Freyd 1997** | institutional "attack," victim-flip, authority restoration |
| `thought-reform/*` | **Lifton 1961** (8 criteria) | semantic inversion ≈ loading-the-language; cognitive containment ≈ milieu-control + dispensing-of-existence; credential armor ≈ sacred-science |
| `defense/*` | **Popper / Lakatos / Proctor (agnotology)** | narrative patching ≈ ad-hoc/immunizing; systemic overextension ≈ degenerating program; epistemological fog ≈ manufactured doubt; framing; presentism |
| `grooming/*` (ordered) | **Finkelhor preconditions / Craven et al. 2006** | the "behavioral sequence" |
| `revision/*` (30055 edges) | **statement analysis / SCAN** + existing `consistency/*` | narrative patch over time; recharacterize term |

Member values (v1 seeds all six families):

- **`neutralization/`** `deny-responsibility`, `deny-injury`, `deny-victim`,
  `condemn-condemners`, `higher-loyalties`, `ledger`, `necessity`,
  `normalcy`, `deny-negative-intent`.
- **`darvo/`** `deny`, `attack`, `reverse-victim-offender`.
- **`thought-reform/`** `milieu-control`, `loading-the-language`,
  `sacred-science`, `doctrine-over-person`, `dispensing-of-existence`,
  `demand-for-purity`, `thought-terminating-cliche`.
- **`defense/`** `ad-hoc-patch`, `immunizing-stratagem`, `manufactured-doubt`,
  `frame-control`, `definitional-retreat`, `presentism`, `usefulness-pivot`
  (truth→utility shift), `credibility-armor`.
- **`grooming/`** `build-vulnerability`, `establish-trust`,
  `redefine-boundaries`, `apply-pressure`.
- **`revision/`** (relationship values on 30055, above) `narrative-patch`,
  `recharacterizes`, `walks-back`.

**Reuse, don't duplicate.** Dawn's "reduction challenge / semantic narrowing"
*is* the existing `fallacy/strawman`; "false dilemma framing" *is*
`fallacy/false-dilemma`; "moved goalposts," "flip-flop," and "contradicts
prior statement" are the existing `consistency/*` labels. A finding may carry
one of those existing values directly; Phase 14 only *adds* the behavioral /
institutional families that have no home in the assessment taxonomy.

## Wire format (publish-ready, flag-gated)

Same conventions as 30054/30055: deterministic recomputable `d`, NIP-73
`i`/`k` anchoring where a URL exists, NIP-32 `L`/`l` + a kind-1985 mirror as
the aggregation path, multi-letter tags (`role`, `maneuver-step`, `basis`,
`suggested-by`) **not** relay-indexed (filtering is client-side on
`#p`/`#l`/`#a` + `kinds`).

### Kind `30062` — BehavioralFinding (new; addressable)

```jsonc
{
  "kind": 30062,
  "tags": [
    ["d", "find:<sha256(subjectRef|maneuver|anchorsHash)[:16]>"],
    ["p", "<subject-pubkey>", "", "subject"],          // the profiled subject
    ["L", "xray/forensic"],
    ["l", "defense/ad-hoc-patch", "xray/forensic"],    // the maneuver
    ["role", "apologist"],
    ["r", "<source-url-verbatim>"],                    // per anchor source
    ["i", "<normalized-url>"], ["k", "web"],           // NIP-73
    ["a", "30055:<author>:<rel-d>"],                   // optional: characterized revision edge
    ["maneuver-step", "0", "<selector-json>", "<ts?>"],// ordered; one per anchor
    ["maneuver-step", "1", "<selector-json>", "<ts?>"],
    ["basis", "quoted"],
    ["suggested-by", "user"],
    ["client", "xray"]
  ],
  "content": "<markdown: note (structure) + counter_note (alternative read)>"
}
```

- **Subject by `p` with a `subject` role-marker** (the `['p', pk, '', role]`
  idiom), so the side panel / portal `{"#p":[subject]}` query pulls a
  subject's claims, assessments, *and* findings in one filter.
- **`d` is recomputable** from subjectRef + maneuver + ordered anchors.
- **Selectors ride in `maneuver-step` tags** (ordered), not content —
  content is human-readable markdown carrying `note` then `counter_note`
  under stable headings so a parser can split them.
- **NIP-32 honesty:** identical posture to 30054 — `l` on a non-1985 kind is
  formally a self-label, so the NIP draft *defines* that here `l` describes
  the `p`-referenced subject's maneuver, and the **kind-1985 mirror is the
  designated aggregation path** (same `L`/`l`, `p`-targeted, behind the same
  flag). One caveat the draft must call out loudly: unlike the assessment
  mirror (which avoids labeling the claim author), a forensic mirror **does**
  put a behavioral label on a person's pubkey — the NIP text must frame these
  as *structural observations with required counter-reads*, never verdicts,
  and recommend consumers surface the `counter_note`.
- **Builder:** `buildBehavioralFindingEvent` in `metadata/builders.js`
  (`{event, body, dTag}` contract); `parseBehavioralFindingEvent` is new
  consumer code with first-ever wire tests.

### Kind `30055` — three additive `revision/*` relationship values

No structural change: `narrative-patch`, `recharacterizes`, `walks-back`
join the `relationship` enum (directional). Additive and safe — old
consumers ignore unknown relationship values, and the `d` hash already
includes the relationship string so identity never collides. NIP draft §30055
gains the three values + a note that they express a subject's diachronic
account-change (and may be paired with a 30062 finding).

### Feature flag

`FLAGS_DEFAULTS` gains **`forensicPublishing: false`** — gates the publish
paths for `30062`, the `revision/*` 30055 emission, and the 1985 mirror.
Local capture / baselines / rollups / export are *not* gated. The SW already
accepts incoming events of every kind, unchanged.

## UI surfaces

No new service-worker messages (`xray:relay:query` / `xray:relay:publish`
already pass arbitrary filters / pre-signed events). `behavioral_findings`
and `forensic_baselines` join the side panel's `chrome.storage.onChanged`
whitelist.

- **Finding modal** (reuse the `assess-modal.js` pattern): subject + role
  picker, grouped maneuver picker (+ custom), the **ordered** span-anchor
  capture (the modal-minimize "mark the span" interaction, repeated per
  step), `note` + required `counter_note` textareas, `basis` selector. Saving
  without an anchor or counter-note is blocked at the model.
- **Findings bar** in the reader, alongside the claims bar: per-subject
  maneuver badges with the evidence chain expandable; a "mark baseline"
  affordance.
- **Cross-statement revision link** reuses the cross-source link modal with
  the three new `revision/*` types and an optional "characterize this
  revision" step that opens the finding modal pre-bound to the edge.
- **Portal (Phase 12) report lenses.** A subject/case view renders the same
  findings as Dawn's four lenses — **evidentiary** (full chains + counter-
  notes + sources), **executive** (summary roll-up), **survivor**
  (validation-oriented), **editor** (prose draft) — hung on the existing
  entity-spokes / case-dashboard / inspector surfaces. A new
  `parseBehavioralFindingEvent` feeds the corpus query (kinds list gains
  `30062`).

## Slice plan (one concern per PR; `claude/phase-13-*`)

- **14.1 — Foundation (local-only, no wire).** `forensic-taxonomy.js` (six
  families + role enum + basis enum + the indicators/counter-indicators
  table), `forensic-model.js` + `behavioral_findings` store, baseline note
  store, validation + idempotency + exhaustive-enum tests. `evidence-linker.js`
  gains the three `revision/*` values. No UI, no wire.
- **14.2 — Capture UI.** Finding modal (subject+role, ordered anchors,
  note/counter-note, basis), findings bar, baseline marking, revision-link
  flow. Draft PR for smoke-test.
- **14.3 — Wire builders + NIP draft.** `buildBehavioralFindingEvent`
  (30062) + `parseBehavioralFindingEvent` (+ first wire tests), 30055
  `revision/*` emission, `forensicPublishing` flag, NIP_DRAFT.md §30062 +
  §30055 update + the "structural-observation, not verdict" framing,
  CHANGELOG + JOURNAL callouts.
- **14.4 — Portal report lenses.** `parseBehavioralFindingEvent` in the
  portal corpus query; subject/case lens views (evidentiary / executive /
  survivor / editor); reconciliation.
- **14.5 — LLM assist (flag-gated).** A `suggested_by: llm:<model>` pass that
  proposes findings for human confirmation, enforcing the anchor +
  counter-note + basis discipline before a draft is acceptable.

## Acceptance demo

The source video is itself the first driving case: capture the Jacob Hansen
↔ Bill Reel and Jacob Hansen ↔ Alex O'Connor conversations and the Robert
Gurr debate → mark each subject + role → tag findings with evidence chains
(`defense/usefulness-pivot` on the truth→useful shift; `defense/definitional-
retreat` + a `recharacterizes` revision edge on *translation*;
`grooming/*` sequence on the presentism defense) → **profile Bill too**
(symmetry check) → open the subject lens: maneuvers, evidence chains,
counter-notes, and the diachronic revision edges all visible across the
four report lenses. Reuse the Phase 11 cases (LDS Church v. Dehlin; Bricks &
Minifigs) as secondary runs.

## Known limitations (accepted for v1)

- **`behavioral-cue` basis is the weakest leg.** Micro-expression / body-
  language reads are retained per the maintainer's "keep everything" call,
  but the taxonomy entry for any cue-based finding must pair it with strong
  counter-indicators, and the NIP framing flags `basis: behavioral-cue` as
  the lowest-evidentiary tier. It is never aggregated into a "score" because
  there is no score.
- **Subject pubkeys are per-install** (same as entity keys) — cross-*user*
  aggregation of findings about a subject only works between users sharing
  entity keys (entity-sync). The aggregation phase owns this.
- **A forensic label on a person's pubkey is reputationally heavier than a
  claim label.** Mitigated by the required counter-note, the no-intent
  construction, and the mirror framing — but called out so a future reader
  doesn't quietly drop the counter-note requirement.
- **Repeated-short-phrase anchors** resolve to first occurrence (the
  standing 10.3 limitation) — applies to maneuver-step anchors identically.

## Questions decided 2026-06-14

1. **Separate `30062` finding** (vs. extending 30054) — ✅ confirmed.
2. **Ship all six maneuver families** in the v1 seed — ✅ confirmed.
3. **Keep the full `basis` enum** including `behavioral-cue`; no numeric
   score — ✅ confirmed.
4. **Land this design doc + roadmap entry now, draft PR** — ✅ confirmed.

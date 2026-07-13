# Entity Dossiers & the Provenance-Pinned Knowledge Base — Design

**Status: IMPLEMENTED** (v1.0, 2026-07-12; shipped 2026-07-13 —
slices 19.1–19.8 landed as eight sequential PRs, together with the
pulled-forward Phase 17 Part A prerequisite). Where implementation
forced a choice the text didn't make, `docs/JOURNAL.md` records it
(notably: republish hashes exclude `generated_at`; 30067 `a`
coordinates carry each claim's actual publisher). Maintainer decisions
of 2026-07-12 are baked in and marked **[decision]** where they
resolved a contested choice.

Related: `docs/ENTITY_CORPUS_DESIGN.md` (Phase 17 — dedupe/audit and
the entity corpus; this doc **extends** its §4.3 and depends on its
Part A), `docs/CASE_DOSSIER_DESIGN.md` (the shipped case assembler
this design reuses), `docs/TRUTH_ADJUDICATION_DESIGN.md` §3.5 (the
per-person record principles and the defamation firewall — normative
here), `docs/CLAIMS_REDESIGN.md` (thin claims), `docs/NIP_DRAFT.md`
(wire formats; gains a §30067 section in slice 19.7),
`docs/PHILOSOPHY.md` (provenance/humility posture).

---

## 0. The goal, in the maintainer's words

> The goal of X-Ray is to build a knowledge base that is unique to me,
> based on whatever I capture, and whatever friends/npubs I follow. …
> We should be building dossiers of each entity. … There should be a
> schema for each entity type to track standard necessary fields …
> while also capturing changes/evolutions over time. … The profiles
> should be strictly assembled from the accumulated captured content
> and associated metadata, and not rely on external knowledge of an
> LLM, since **provenance is everything**.

The shape this takes: a **wikipedia-like article per entity that can
defend every line**. Wikipedia cites; a dossier *proves* — every field
value click-throughs to a verbatim quote in a captured, hashed,
locally archived source. As new content is captured, dossiers update
(computed-on-read) and published profiles re-emit (hash-stamped).
A **case** is the same aggregation machinery scoped by a question —
already shipped as the case dossier; §7 unifies the two.

## 1. What exists vs. what's missing

Reusable substrate (shipped):

- The entity registry (`entity-model.js`): types
  person/organization/place/thing/case, deterministic ids
  (`entity_<sha256(type:name)>`), alias collapse (`canonical_id` /
  `aliasFamily`), foreign adoption, per-entity keypairs, platform
  accounts, `equivalencePubkeys`.
- Grounded capture: claims carry verbatim `quote` + `article_hash`
  (`x`) + `anchor` + `source_url`; entity mentions carry machine-
  checked verbatim spans; `suggested_by` separates user from LLM.
- The computed-on-read aggregation posture: `case-dossier.js`
  (case-scoped) and `truth-entity-record.js` (the four integrity
  dimensions, coverage-gated, never scored).
- The URL alias layer (`url-aliases.js`) — one identity per document
  across mirror addresses, so dossier joins don't fork.

Missing — what this phase builds:

- **Typed field schemas.** Entities have one free-text `description`;
  no birth date, occupation, affiliation… no field model at all.
- **Time-evolving, provenance-pinned values.** No "CEO 2019–2023, per
  <source>"; no way to hold two conflicting birth dates side by side.
- **A per-entity assembler.** `case-dossier.js` is case-scoped;
  `truth-entity-record.js` covers only integrity. Nothing assembles
  *everything captured about person P*.
- **Profile enrichment.** `buildProfileEvent`'s `about` is a
  boilerplate string; nothing captured ever reaches the wire profile.

## 2. Principles (normative for every slice)

1. **Provenance on every displayed value.** A field value renders with
   its quote, source URL, article hash, and capture date — one click
   from the claim to the archived source. No sourceless value exists.
2. **No external LLM knowledge, ever.** The LLM may *extract* a value
   from captured text (verbatim-quote-grounded, machine-checked,
   human-confirmed) — it may never *supply* one. **[decision]**
   Unsourced user-authored biographical facts are likewise forbidden
   in v1: if you know it, capture a source that states it. (Case
   scope/status fields are the one authored class — they are the
   user's own framing, never presented as sourced facts.)
3. **Unknown by default; conflicts never auto-resolve.** Every schema
   row renders; no fact ⇒ "no captured source". Two sources
   disagreeing on a value ⇒ `contested`, both shown with evidence —
   the knot machinery's discipline applied to biography.
4. **The defamation firewall (TRUTH §3.5) applies structurally.** A
   dossier carries judgment *distributions* and routes to the
   coverage-capped integrity record; it never computes a dossier-level
   score, person-grade, or "liar"-class label. Disagreement renders
   side by side, never merged.
5. **Computed-on-read.** Dossiers are derived views over local models,
   assembled at open. Only publish freshness uses stamps (§6).
6. **Drift-tolerant by construction.** Membership is the alias family,
   so a later entity merge automatically re-unifies previously split
   dossiers — nothing is baked into stored rows.

## 3. Typed field schemas — `entity-field-schemas.js`

A pure data-table module in the `truth-taxonomy.js` style: frozen
tables + `isValid*` predicates + exhaustive-enum pin tests.

Field row shape:

```js
{ field, label, value_type, multiple, evolves, provenance, enum_values? }
// value_type:  'text' | 'date' | 'entity-ref' | 'enum' | 'number'
// provenance:  'sourced'  — MUST cite a captured quote (everything biographical)
//              'authored' — the user's framing (case scope only in v1)
```

Per-type registries (v1):

| type | fields |
|---|---|
| person | `birth_date` (date), `death_date` (date), `occupation` (text, multiple, evolves), `affiliation` (entity-ref, multiple, evolves), `role` (text, multiple, evolves), `religion` (text, evolves), `residence` (text, evolves), `nationality` (text, multiple, evolves), `education` (text, multiple) |
| organization | `founded` (date), `dissolved` (date), `headquarters` (text, evolves), `leadership` (entity-ref, multiple, evolves), `org_type` (text), `parent_org` (entity-ref, evolves) |
| place | `located_in` (text), `place_type` (text) |
| thing | `thing_type` (text), `creator` (entity-ref, multiple), `created_date` (date) |
| case | `scope_question` (text, **authored**), `status` (enum open/active/dormant/closed, **authored**, evolves), `opened` (date, **authored**), `closed` (date, **authored**) |

Semantics the table encodes:

- **Unknown-by-default**: the dossier renders every row; empty rows say
  "no captured source" — coverage honesty, never a blank guess.
- **Multiple candidates**: every value is its own fact record;
  `multiple: false` + >1 concurrent value ⇒ status `contested`.
- **Evolution**: validity intervals on facts; `evolves: true` fields
  render as history ("CEO 2019–2023" then "chair 2023–").
- **Date precision**: all dates are `{value, precision}` with
  `year|month|day|exact` (the Phase-15 `occurred_precision` pattern) —
  a year-precision birth date never fabricates a day.
- **Custom fields**: `custom:<lowercase-token>` accepted everywhere a
  registry field is (the forensic-maneuver custom-token precedent).

## 4. Facts ride the claim model **[decision]**

**A fact is a claim with a structured `fact` layer** — not a parallel
store. Additive optional field on `article_claims` records
(`claim-model.js`):

```js
fact: {
    entity_id,             // the subject; MUST be in claim.about (validated)
    field,                 // registry field for the subject's type, or custom:<token>
    value,                 // display value, trimmed, ≤500 chars
    value_ref,             // entity id when value_type is 'entity-ref', else null
    valid_from,  valid_from_precision,   // world-time interval the source asserts
    valid_to,    valid_to_precision,
    observed_at, observed_precision      // the "as of" date the SOURCE asserts
}
```

Why claims (the argued choice):

- A claim already carries the entire provenance contract: verbatim
  `quote`, `article_hash`, `anchor`, `source_url`, `captured_at`,
  `suggested_by`, and the machine-checked grounding firewall. A
  parallel `entity_facts` store would duplicate all of it.
- **The judgment pipeline comes free** — exactly the "accounting for
  and integrating assessments, adjudications, integrity findings"
  requirement: assessments (30054) attach by claim id; propositions
  and verdicts (Phase 15) attach by `claim_id`, so a *disputed birth
  date is adjudicable* to a verdict state under a standard of proof;
  `contradicts` links (30055) and the knot machinery work unchanged;
  case membership (`about` includes a case id) works unchanged.
- Correction semantics fall out: a corrected value is a NEW
  fact-claim; the old one stays (supersede/assess it) — history is
  preserved, P9-style.

Wire (kind 30040, **additive** tags — compat callout + NIP_DRAFT in
slice 19.2; readers that don't know `fact` see a normal claim):

```
['fact', <field>, <value>, <subject entity pubkey>]
['valid_from',  <ISO-8601>, <precision>]
['valid_to',    <ISO-8601>, <precision>]
['observed_at', <ISO-8601>, <precision>]
```

Pure sibling module `entity-facts.js`: `cleanFact` (validation),
`isFactClaim`, `groupFactsByField`, `factConflicts` — same field +
`multiple:false` + overlapping-or-unknown validity + values unequal
after type-aware normalization (dates compare within precision bands)
⇒ a conflict object naming both claims; **never a winner**. Conflict
dismissals ("dual nationality is fine") live in a new storage key
`entity_fact_dismissals` (`{'<idA>|<idB>': {dismissed_at, note}}`,
added to `WORKSPACE_CLEAR_KEYS` + pin test).

Case authored fields do NOT ride claims (claims require a source):
they live on the entity record as `authored_fields: {[field]:
{value, updated}}` through an extended `EntityModel.update` whitelist,
and render labeled as the user's framing.

## 5. The dossier assembler — `entity-dossier.js`

The exact `case-dossier.js` split: a storage-aware collector
(`collectEntityDossierData(entityId, options)`) + pure builders
(`buildEntityDossier(data, generatedAt)`), `generatedAt` injected, no
clock reads in pure code, nothing persisted.

**Membership** = the entity's **alias family** (`aliasFamily` over one
registry snapshot), then:

- claims whose `about` (or `source`) intersects the family — fact-
  claims and ordinary claims both;
- archive articles carrying a family member in `article.entities`
  (durable since the 2026-07-12 tag-persistence fix), including
  zero-claim articles (the "unprocessed sources" backlog);
- platform accounts, external ids, `equivalencePubkeys`;
- forensic findings via the subject-ref bridge (`case-dossier.js`'s
  candidate cascade, reused, `matched_via` stamped).

**Sections** (every value carries `{claim_id, quote, source_url,
article_hash}` so the render layer is click-through-to-source):

1. **identity** — alias family (self/alias/canonical/foreign),
   accounts, external ids, equivalence pubkeys, grounded mentions.
2. **fields** — one row per schema field: status
   `unknown|known|multiple|contested`, current values + history
   (ordered by `valid_from`), per-value evidence lists, conflict
   objects (with dismissals honored). Coverage counts.
3. **content** — article rows + the 4-axis timeline, REUSING
   case-dossier's builders. Slice 19.1 first extracts the shared time
   helpers (`parseMetaDate`, precision windows) into
   `dossier-time.js` — a behavior-unchanged refactor pinned by the
   existing case-dossier tests.
4. **judgments** — assessment counts by stance; verdict distributions
   per proposition (side-by-side variance, never merged);
   `integrity_record_ref` ROUTING to `truth-entity-record.js` (never
   inlined, never re-derived); forensic findings with `matched_via`.
   No score of any kind exists in the object — a string-guard test
   (the lens-guard pattern) pins that grade-words never appear.
5. **relationships** — co-tagged entities (shared articles/claims)
   plus field-derived edges (`affiliation`/`leadership`/`parent_org`),
   both directions.

**Update model: recompute-on-read.** The collector is bulk-read only —
the same cost class as the shipped case dossier, which already runs
computed-on-open against a real corpus. Materialization would add
staleness and a second source of truth for no measured need. The one
freshness question — "does the published profile match the current
dossier?" — is answered by content-hash stamps (§6), not by
materializing. Escape hatch if an entity ever exceeds thousands of
claims: a session-scoped memo keyed on storage `updated` stamps (the
lens-engine cache precedent). Deliberately not built in v1.

**UI surfaces:**

- **Portal**: `entity-dossier-view.js` (sibling of `case-view.js`,
  `xr-dossier-*` classes) — the full dossier; field values open a
  quote popover linking into the archived article.
- **Side panel**: compact field table on the entity detail (top known
  fields + contested badge) + "Open full dossier"; the case-scope
  editor (authored fields) on case entities.
- **Reader**: "Add fact…" from a text selection — subject picker
  (tagged entities first), field picker from `fieldsForType` +
  custom token, value prefilled from the selection, validity dates
  with precision; the selection IS the verbatim quote, so manual facts
  ground by construction. Conflict pre-flight: an existing differing
  value shows with its evidence before saving — inform, never block.

## 6. Publishing — enriched kind 0 + the kind-30067 fact sheet

Everything entity-signed publishes behind **`entityCorpusPublishing`**
(Phase 17's flag; default **off**, full disclosure in Options — entity
keys sign, relays are public, publication is effectively irrevocable).
**Hard prerequisite: Phase 17 Part A (E1 deterministic dedupe + E3
resolveCanonical sweep)** — publishing profiles from a silted registry
would emit fragment-entities' profiles.

**kind 0 `about` (the human layer)** — extends ENTITY_CORPUS §4.3.
Assembled DETERMINISTICALLY from the dossier by a pure
`entity-profile.js` (`buildProfileAbout(dossier)`), fixed template,
stable ordering:

```
<Type> entity. <registry description, if any>
Also mentioned as: <alias display names>.
Occupation: CEO of Acme Corp (2019–, per acme-times.com, captured 2026-05-02)
Born: 1962 (year precision, per springfield-herald.com)
Assembled from <N> captured sources by an X-Ray archive. Field detail: kind-30067 fact sheet.
```

Rules:

- Only facts whose claim is **itself published** (has a
  `publishedEventId`) may appear — every profile line is independently
  verifiable from relays. That is what "provenance is everything"
  means on a public surface.
- **Contested fields are OMITTED from kind 0.** **[decision]** The
  full conflict (both values, quotes, sources) lives only in the
  30067 sheet, where each side carries its evidence. No public
  disagreement flag rides the profile of a living person.
- **No judgment language, ever** — no verdict states, no integrity
  words; §3.5 applies to the wire hardest of all.
- NIP-39 `['i', <scheme:id>, '']` external-id tags (from Part A's
  `external_id` ops) and the existing `refers_to` alias tag ride
  along. Per-field checkboxes in the publish modal (the mention-note
  checklist pattern).

**kind 30067 "entity fact sheet" (the machine layer)** **[decision —
take the kind now]**. 30065 is reserved (precedent citation), 30066 is
guard-tested free (the moral lens is wire-less by design — its 16.4
guards machine-check that 30066 stays unused); **30067 is the next
free slot and this design takes it**. Addressable/replaceable, signed
by the ENTITY's key:

```
kind: 30067
tags:
  ['d', 'xray-facts']
  ['p', <publisher pubkey>, '', 'publisher']
  ['L', 'xray/fact-sheet'], ['l', 'v1', 'xray/fact-sheet']
  per fact:  ['fact', <field>, <value>, <valid_from ISO|''>, <valid_to ISO|''>]
  per fact:  ['a', '30040:<publisher pk>:<claim d-tag>', '', 'fact-source']
  per hash:  ['x', <article hash>]
  mirrors:   ['i', <external id>, '']
  ['client', 'xray']
content: canonical JSON — { version: 1, entity_id, fields: [ { field, value,
  value_ref_pubkey, valid_from, valid_from_precision, valid_to, …,
  observed_at, contested, sources: [ { claim_coord, url, article_hash,
  quote, captured_at } ] } ], assembled_from, generated_at }
```

Every fact in the sheet references a **published** kind-30040 — the
sheet is a pure, adjudicable *index over verifiable events*: any
consumer can follow the `a`-refs, check the quotes, and fetch the
hashes. Contested fields DO appear here, both sides with evidence.

Why a new kind rather than JSON stuffed into kind 0: content-only JSON
gets no tag indexing (no `#a`/`#x` joins), couples the fact table's
churn to the profile's cadence, and bloats the most-fetched event in
NOSTR. The corpus doc's "no new kinds" stance argued §4.2's *mention
notes* should render in generic clients; a structured fact table has
no generic-client audience, so that argument doesn't apply.
**Compatibility callout + NIP_DRAFT §30067 are mandatory in 19.7.**

**Republish policy** — "as new content is added, profiles update":
the entity record gains `publishedProfileHash` /
`publishedFactSheetHash` (+ event ids) via
`EntityModel.markProfilePublished` (bypasses `updated`, the
`markPublished` precedent). On every article publish, for each tagged
canonical entity: recompute profile + sheet content, compare hashes,
republish only what changed (both kinds are replaceable — idempotent).
Plus a manual "Republish profile" on the dossier view.

## 7. Cases as scoped dossiers

The maintainer's definition — "a case is the aggregation of all of
those nodes together under the same entity with a specific question or
other scope" — is what `case-dossier.js` already does. The delta:

1. **Cases gain typed authored fields** (`scope_question`, `status`,
   `opened`, `closed`) via the schema registry's authored class,
   edited in the side panel, rendered in the case dossier header and
   `case-export.js` output.
2. **One assembler family, two membership functions.** The entity
   dossier's collector emits case-dossier-shape-compatible data; the
   timeline/knots/evidence builders are shared. Case membership
   (claim-mediated + entity-mediated) is unchanged.
3. A case dossier surfaces its orbit entities' fact tables as compact
   **links into each entity's own dossier** — routing, not inlining.

## 8. Slice plan (one PR each, post-Epistack)

| Slice | Content | Size |
|---|---|---|
| 19.1 | `entity-field-schemas.js` + `entity-facts.js` + `dossier-time.js` extraction (behavior-unchanged); `authored_fields` on `EntityModel.update`; `entity_fact_dismissals` key + clear-list pin | M |
| 19.2 | Fact layer on claims: `cleanFact` wiring in claim-model; 30040 fact tags + `parseClaimEvent` read-back. **Wire compat callout + NIP_DRAFT** | M |
| 19.3 | `entity-dossier.js` — collector + builders, alias-family membership, forensic bridge reuse | L |
| 19.4 | Dossier UI: portal `entity-dossier-view.js`; side-panel compact table; provenance click-through | L |
| 19.5 | Reader "Add fact…" + conflict pre-flight; case scope editor | M |
| 19.6 | LLM fact extraction: `propose_capture` gains `kind:'fact'` (REQUIRED verbatim quote through the existing grounding firewall; prompt rule: *"never supply a value from your own knowledge of the entity — only what this article's text asserts"*); suggest category `facts` default OFF; human confirms every item | M |
| 19.7 | Publishing: `entity-profile.js`, enriched `buildProfileEvent`, `buildFactSheetEvent` (30067) + parser, per-field publish checklist, hash-stamped republish, flag + disclosure. **Hard prereq: Phase 17 E1+E3. Wire callout (new kind) + NIP_DRAFT §30067** | L |
| 19.8 | Case unification + docs tail: case scope block, per-entity dossier links in case view, SMOKE §Phase 19, JOURNAL | S/M |

Every slice: pure modules first with `node --test`, then UI, then
publish paths behind the flag; house gates before every push.

**Test spine per slice** — exhaustive-enum pins (schemas); conflict
detection incl. precision bands and dismissals (facts); determinism +
unknown-by-default + contested-never-resolves + integrity-routed +
grade-word string guard (assembler); ungroundable-quote rejected +
external-value-has-no-path-in (LLM); unpublished-claim facts excluded +
no-judgment-strings + republish-hash idempotence (publishing).

**Key SMOKE (19.x)**: capture two articles disagreeing on a birth date
→ both values render with quotes and a contested badge, no winner;
click a value → the archived source opens at the quote; flag on,
publish → kind-0 `about` carries only published-claim facts and OMITS
the contested field; the 30067 `a`-refs resolve on a relay; flag off →
no entity-signed event leaves the device.

## 9. Risks & mitigations

- **Entity drift splits dossiers** → membership is the alias family
  (merges re-unify automatically); Part A dedupe is the publishing
  gate, recommended before 19.3 too.
- **Defamation surface** → §3.5 firewall enforced structurally + string
  guards; contested fields off the public profile **[decision]**;
  facts are quotes of sources, never X-Ray's own assertions — the
  profile says "per <source>", not "is".
- **LLM contamination** → grounding firewall (an ungroundable quote is
  rejected outright), extraction-only prompt rules, default-off
  category, human confirmation, `suggested_by` stamps.
- **Wire regret on 30067** → the sheet is an index over 30040s; if the
  format needs to change, replaceable events make `v2` a `d`-tag or
  label bump, and the underlying claims are untouched.

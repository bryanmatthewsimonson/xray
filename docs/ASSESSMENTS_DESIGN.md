# Assessments & contradictions — "Community Notes for the internet" (Phase 11)

**Status:** design draft 2026-06-09 (revised same day after an adversarial
review pass), for maintainer review before any feature code. Absorbs and
supersedes the Phase 10.5 "metadata reframe" slice (see
[Reconciling Phase 10.5](#reconciling-phase-105) below).

X-Ray already captures atomized claims (kind `30040`: text + the entities it
is about + source + anchor) and can show "what the network says about entity
P" (Phase 10.4). Phase 11 adds the judgment layer: register a **personal
assessment** on any claim — yours or a foreign one — with a graded stance and
standardized issue labels, link claims **across sources** with typed
relationships (most importantly *contradicts*), and surface those judgments
automatically wherever the claim or entity reappears. North star: Community
Notes, but for the whole internet and richer — atomic claims, graded stances,
typed issue labels, cross-source contradiction tracking.

Driving acceptance cases (real, unfolding stories): **(A) LDS Church v. John
Dehlin** and **(B) Bricks & Minifigs v. "Reckless Ben"** — both multi-video,
fast-moving, with abundant quotes from both sides.

## Decisions at a glance

| Question | Decision |
| --- | --- |
| Stance + labels | Two orthogonal axes on one **assessment** record: graded stance −2..+2 (optional) and zero-or-more typed labels, each label optionally carrying its own anchor + note; free-text rationale |
| Assessment wire format | **New kind `30054` (Assessment)** — addressable, one per (author, claim), targets the claim by `a` coordinate, labels under NIP-32-style `L`/`l` `xray/assessment` tags (with a kind-1985 mirror as the ecosystem-aggregation path). 30051/30052 are *not* overloaded or redefined (rationale below) |
| Contradiction links | **New kind `30055` (ClaimRelationship)**; kind `30043` is **retired** (per the original 10.5 intent): its ungated legacy publish path is switched off, and the local `evidence-linker.js` model is repurposed cross-source with coordinate refs. Relationship enum `contradicts / supports / updates / duplicates` |
| Local-first | New `claim_assessments` storage key + the existing `evidence_links` key (records gain coordinate refs). Local capture always on; **publishing flag-gated** (`assessmentPublishing`, default off) |
| Foreign claims | Assessable and linkable from day one — records key on the claim's event coordinate; assessable from the reader's others'-claims modal *and* the side panel's network-claims list |
| LLM-ready | `suggested_by` (`'user'` \| `'llm:<model>'`, default `'user'`) on assessments, labels, and links; model + linker APIs callable programmatically |
| Case modeling | **A case is an entity, not a new object.** Recommendation: add `case` as a first-class entity *type* in 11.1 (vs. plain `thing`) — open question #3 |
| Export | Per-case JSON + Markdown from the side-panel entity detail; deterministic content set |
| Non-goals (v1) | Publishing/aggregating others' judgments (publish-*ready* only), LLM detection, trust-weighting |

## Claim references and identity (the load-bearing rules)

Everything in this phase points at claims, so the reference rules come
first. A claim is identified on the wire by its **coordinate**
`30040:<author-pubkey>:<d>`; for X-Ray-authored claims the `d` tag *is* the
local claim id (`claim_<16hex>`, [event-builder.js:417](../src/shared/event-builder.js)).

1. **Canonical ref form.** Own claims are referenced by **local claim id**;
   foreign claims by **coordinate string**. Every API that takes a claim ref
   (assessment create, link create, badge/rollup matchers) first
   *normalizes*: a coordinate whose pubkey matches one of our recorded
   publishing pubkeys and whose `d` matches a local claim id collapses to
   that local id. One logical claim ⇒ one canonical ref ⇒ idempotency holds.
2. **`ClaimModel.markPublished` gains `publishedPubkey`** (local-schema
   change, slice 11.1). Today it records only `publishedEventId`
   ([claim-model.js:258](../src/shared/claim-model.js)), which makes the
   coordinate of an already-published claim unrecoverable if the signing
   identity later changes. Assessments and links derive coordinates from the
   *recorded* publishing pubkey, never from the current signer.
3. **Local record ids hash the canonical ref** (so they are stable across
   the publish boundary): `assess_<sha256(canonical_ref)[:16]>`,
   `link_<sha256(refA|refB|relationship)[:16]>`. The **wire `d` tags hash
   coordinates only** (see per-kind sections) and are derived at publish
   time — local ids never hit the wire. The two derivations are different
   on purpose; the publish flow maps one to the other.
4. **Publish ordering.** A 30054/30055 referencing an unpublished local
   claim cannot publish; the publish flow orders claims before assessments
   and links (and backfills `claim_ref.coord` + the wire `d` at that
   moment). Local capture never blocks on any of this.

## Data model (local-first)

### Assessment

One assessment per claim (per local user). Stored under a new
`chrome.storage.local` key **`claim_assessments`** as a single id→record map,
exactly like `article_claims` — same JSON-serialized Storage conventions, no
keypair-registry involvement. (Claims/links/assessments have no app-level
backup/export today — entities and keypairs do; the per-case export in 11.6
is the deliberate export story for this data.)

```
Assessment {
  id            // assess_<sha256(canonical_ref)[:16]>  — deterministic, idempotent
  claim_ref {   // how we point at the claim — works for claims we didn't author
    claim_id?     // local claim id (canonical form for our claims)
    coord?        // '30040:<author-pubkey>:<d>' (canonical for foreign;
                  //  backfilled for ours at publish time)
    event_id?     // specific event id if we saw one (relay-hint quality)
    url           // normalize(claim source_url) — see URL rule below
    text          // snapshot of the claim text (display/export survives relay churn)
    author_pubkey?
  }
  stance?       // -2 | -1 | 0 | 1 | 2 | null   (null = label-only assessment)
  rationale     // free-text markdown, may be ''
  labels: [ {   // at most one entry per label value (keeps wire round-trip lossless)
    label         // taxonomy value, e.g. 'misleading', 'fallacy/strawman'
    anchor?       // selector array from metadata/anchor-capture.buildSelectors —
                  //   the offending span (same shape as Claim.anchor)
    note?         // short per-label note
    suggested_by  // 'user' | 'llm:<model>'   (default 'user')
  } ]
  suggested_by  // 'user' | 'llm:<model>' for the assessment as a whole
  created, updated, publishedAt, publishedEventId
}
```

- Validation: at least one of (`stance` non-null, `labels` non-empty);
  stance must be an integer in −2..+2 (clone the `helpful ∈ {-1,0,1}` and
  `weight 0–100` validation/test patterns from the metadata layer); duplicate
  label values rejected.
- Stance display labels: −2 strongly disagree · −1 disagree · 0 unsure ·
  +1 agree · +2 strongly agree.
- Module: `src/shared/assessment-model.js`, following `ClaimModel`'s
  patterns (deterministic id, idempotent create, immutable `claim_ref`
  *except* the coord backfill, `markPublished` doesn't bump `updated`) plus
  a `getByClaimRef` lookup that matches either representation per the
  canonical-ref rule.

### Claim relationship (contradiction link)

`src/shared/evidence-linker.js` stays the local model for typed claim↔claim
links, upgraded:

1. **Cross-source references.** Endpoints take canonical claim refs (local
   id or coordinate; `assertValidClaimId` widens accordingly), normalized
   before the id hash so one logical link derives one id — and
   `getForClaim` / `deleteForClaim` match either representation of the same
   claim (today they're exact-string comparisons,
   [evidence-linker.js:101,180](../src/shared/evidence-linker.js)).
2. **Relationship enum** `contradicts / supports / updates / duplicates`.
   `contradicts` and `duplicates` are **symmetric**: endpoints are sorted
   lexically before hashing and rendered direction-free, so A↔B created
   twice in opposite directions is one record (and one wire event).
   `supports` and `updates` stay directional. Directionality is declared in
   the taxonomy module. Existing `contextualizes` records normalize on read
   (kept readable; no longer offered in the create UI).
3. **`suggested_by` + endpoint snapshots** (`{url, text, author_pubkey?}`
   per endpoint) so links against foreign claims render and export without
   a relay round-trip.

Storage key stays `evidence_links`; pre-Phase-11 records normalize on read
(same pattern as `normalizeClaim`).

### Label taxonomy

Canonical list in a new **`src/shared/assessment-taxonomy.js`** (single
source for model validation, UI chips, and the NIP draft), namespace
**`xray/assessment`**:

- **Factual:** `false`, `unsupported`, `misleading`, `cherry-picked`,
  `missing-context`, `outdated`
- **Consistency:** `contradicts-prior-statement`, `flip-flop`,
  `moved-goalposts`
- **Fallacy:** `fallacy/strawman`, `fallacy/ad-hominem`,
  `fallacy/false-dilemma`, `fallacy/whataboutism`, `fallacy/circular`,
  `fallacy/slippery-slope`, `fallacy/appeal-to-authority`,
  `fallacy/appeal-to-consequences`
- **Rhetorical:** `loaded-language`, `unfalsifiable`, `ambiguous`,
  `euphemism`
- **Provenance:** `undisclosed-interest`
- **Escape hatch:** any other value is accepted as a custom label, stored
  and published verbatim under the same namespace, rendered with a "custom"
  affordance in the UI. (Standard labels aggregate; custom ones still ride
  the same rails.)

The set is grouped + exported flat; the exhaustive-enum test idiom
(`deepEqual(.slice().sort())`, as for `EVIDENCE_RELATIONSHIPS`) pins it.
`fallacy/appeal-to-consequences`, `euphemism`, and `undisclosed-interest`
are additions the driving cases need (Case A commentary, Case B corporate
framing, Case B GoFundMe disclosure).

## Wire format (publish-ready, flag-gated)

### Why a new kind instead of 30051/30052

- **`30052` Rating can't carry this:** its deterministic `d` is
  `rating:sha16(url|author)` — *one rating per URL per author*. Stance is
  per-*claim*; several claims share a URL. Re-keying 30052's `d` would change
  its identity semantics under consumers — a worse compat break than a new
  kind.
- **`30051` FactCheck means something else — even though it's unshipped.**
  30051 has never published an event (`factchecks: false` in
  `FLAGS_DEFAULTS`), so *redefining* it would cost nothing in compat — but
  it would cost the thing 30051 is for: Schema.org `ClaimReview` JSON-LD
  interop (the format Google's fact-check tooling and professional checkers
  speak), which is worth preserving in a dedicated kind. A personal stance
  and a formal verdict on a published scale are *distinct aggregation
  signals* consumers shouldn't have to separate by rating-scale namespace.
  And 30051's text-keyed `d` (`factcheck:sha16(url|claimReviewed)`) breaks
  identity when a claim is edited, where a coordinate-keyed `d` doesn't.
  Slice 11.2 adds NIP-draft text delineating 30051 (formal review) vs 30054
  (personal assessment) to pre-empt the "collapse these kinds" review.
- The NIP draft is ours (`docs/NIP_DRAFT.md`, pre-merge): adding kinds in
  the contiguous `3005x` block is cheap and keeps the metadata layer's
  conventions (deterministic `d`, `{event, body, dTag}` builder contract,
  NIP-73 anchoring, flag gating) fully reusable.

### URL rule (one rule, stated once)

`claim_ref.url` stores `normalize(source_url)` (the metadata layer's
`url-normalizer`). On the wire, 30054/30055 events carry:

- **`r` = the target claim's `r` value verbatim** (raw, as the 30040
  published it) — this is the join key the reader's per-URL queries use;
  diverging from it would fork the `#r` join, because `buildClaimEvent`
  emits raw URLs today.
- **`i` = the normalized URL + `k`=`web`** — the NIP-73 pair, canonical and
  normalization-stable, per the metadata-builder convention.

(Retro-normalizing 30040's own `r` is a separate wire-format change for an
already-shipping kind — out of Phase 11 scope, noted in the NIP draft work
as a candidate with its own dual-read story.)

All multi-letter tags below (`stance`, `label-anchor`, `label-note`,
`suggested-by`, `relationship`) are **not relay-indexed** (NIP-01 indexes
single-letter only). Every relay query in this phase and the aggregation
follow-up filters on `#p` / `#r` / `#a` / `#l` + `kinds` only; relationship
and stance filtering happens client-side.

### Kind `30054` — Assessment (new; addressable)

One per (author, claim); editing republishes the same `d` and replaces.

```jsonc
{
  "kind": 30054,
  "tags": [
    ["d", "assess:<sha256(claim_coord)[:16]>"],
    ["a", "30040:<claim-author-pubkey>:<claim-d>", "<relay-hint>"],   // the claim
    ["e", "<claim-event-id>", "<relay-hint>"],                        // optional
    ["p", "<claim-author-pubkey>"],                                   // 9803 idiom
    ["r", "<claim-r-verbatim>"],
    ["i", "<normalized-url>"], ["k", "web"],                          // NIP-73
    ["stance", "-1"],                                                  // optional, -2..2
    ["L", "xray/assessment"],
    ["l", "misleading", "xray/assessment"],                            // one per label
    ["l", "fallacy/strawman", "xray/assessment"],
    ["label-anchor", "misleading", "<selector-json>"],                 // optional, per label
    ["label-note", "misleading", "<short note>"],                      // optional, per label
    ["p", "<about-entity-pubkey>", "", "about"],                       // mirrored from claim
    ["suggested-by", "user"],
    ["client", "xray"]
  ],
  "content": "<markdown rationale>"
}
```

- **Claim reference is by coordinates** (`a` + optional `e`), so assessing
  claims you didn't author Just Works; local ids never hit the wire. The
  `d` is recomputable from the `a` tag by any client.
- **NIP-32 semantics, stated honestly:** per NIP-32, `L`/`l` tags on a
  non-1985 kind are *self*-labels — a conforming NIP-32 consumer would read
  these as describing the assessment event, not the claim. NIP draft §30054
  therefore *defines* that on this kind the `l` values apply to the
  `a`-referenced target (a documented deviation), and the **kind-1985
  mirror is the designated ecosystem-aggregation path**: the publish slice
  emits one 1985 event (same `L`/`l`, `a`-targeted at the claim) alongside
  each labeled 30054, behind the same flag. Generic NIP-32 consumers
  aggregate the mirror; X-Ray reads the richer 30054.
- One `l` per label value (duplicates rejected in the model), so
  `label-anchor`/`label-note` keyed by label value round-trip losslessly.
- **About-entity `p` tags are mirrored from the claim** so the side panel's
  one `{"#p":[entity]}` query can pull claims *and* assessments in a single
  filter (`kinds:[30040,30054]`) — same surfacing trick that made 10.4 cheap.
- Builder: `buildAssessmentEvent` in `src/shared/metadata/builders.js`
  (returns `{event, body, dTag}` like its siblings; stance/labels validated
  against the taxonomy module). Selector JSON in tags (not content) is an
  explicit §30054 departure from the 30050/30051 content-borne selectors —
  content here is human-readable markdown.

### Kind `30055` — ClaimRelationship (new; addressable). Kind `30043` retires

A typed link between two claims. **30043 is retired, completing the 10.5
plan**, rather than re-vocabularied: its legacy publish path is *live and
ungated today* (the reader's batch publish,
[reader/index.js:1723](../src/reader/index.js), emits local-id
`source-claim`/`target-claim` tags), so relays already hold events under
that kind number whose vocabulary a public NIP could never honor; a
re-keyed `d` could also never replace those events (different hash input ⇒
both versions live forever). A fresh kind in the `3005x` block starts
coordinate-only and conventions-conformant. Nothing in `src/` reads foreign
30043 events today, so retiring costs ~nothing; local `evidence_links`
records migrate in place.

```jsonc
{
  "kind": 30055,
  "tags": [
    ["d", "rel:<sha256(coordA|coordB|relationship)[:16]>"],   // symmetric rels: coords sorted
    ["a", "30040:<author-A>:<d-A>", "<relay-hint>", "source"],
    ["a", "30040:<author-B>:<d-B>", "<relay-hint>", "target"],
    ["e", "<event-id-A>", "", "source"],          // optional
    ["e", "<event-id-B>", "", "target"],          // optional
    ["relationship", "contradicts"],               // contradicts|supports|updates|duplicates
    ["r", "<claim-A-r-verbatim>"],
    ["r", "<claim-B-r-verbatim>"],
    ["i", "<normalized-url-A>"], ["i", "<normalized-url-B>"], ["k", "web"],
    ["suggested-by", "user"],
    ["client", "xray"]
  ],
  "content": "<note>"
}
```

- For symmetric relationships (`contradicts`, `duplicates`) the two
  coordinates are sorted lexically before hashing and the `source`/`target`
  markers carry no meaning; for directional ones (`supports`, `updates`)
  order is semantic. The `d` MUST be recomputable from the `a` tags +
  relationship (NIP draft §30055 says so).
- The 4th-position markers on `a`/`e` mirror the repo's
  `['p', pk, '', role]` idiom; documented in the NIP draft.
- Builder: `buildClaimRelationshipEvent` in `metadata/builders.js`; a new
  `parseRelationshipEvent` is **new consumer code with first-ever wire
  tests** (no 30043 parse helper exists to upgrade — nothing consumes
  incoming 30043s today).

**Compatibility callouts (the `event-builder.js` rule):**

- **Slice 11.1 switches the legacy 30043 publish path off** (the reader's
  batch publish stops emitting evidence-link events) — a behavior change
  for current users that gets its own CHANGELOG + JOURNAL callout, *before*
  the model accepts coordinate refs, so no hybrid-vocabulary event can ever
  publish. `buildEvidenceLinkEvent` is deleted in 11.2 when the 30055
  builder lands.
- Already-published legacy 30043 events stay on relays (same posture as
  every other superseded kind — the reader UI already says NIP-09 cleanup
  is a later phase). Local link records republish as 30055 when the flag
  turns on.
- NIP draft changes in 11.2: §30054, §30055, a **§30040 claim-event
  section** (both new kinds reference it; an external implementer must be
  able to resolve the target — and the intro's "five event kinds" count +
  the Querying section's filter list update too). Pre-submission checklist
  item: verify 30054/30055 against the community kind registry, and note
  that 30040 itself has known third-party uses in the wild (NKBIP-01) —
  a collision question for the NIP submission, not for this phase.

### Feature flag

`FLAGS_DEFAULTS` gains **`assessmentPublishing: false`** (gates the publish
paths for 30054, 30055, and the 1985 mirror). Local capture, badges,
rollups, and export are *not* gated — they're the product. The SW already
accepts incoming events of every kind, unchanged.

## UI surfaces

No new service-worker messages are needed: `xray:relay:query` passes
arbitrary NIP-01 filters through, and `xray:relay:publish` takes any
pre-signed event. New storage keys (`claim_assessments`, `evidence_links`)
must be added to the side panel's `chrome.storage.onChanged` whitelist so it
live-refreshes.

**Badge rule (all surfaces):** the ⚠ badge renders on a claim when it
appears as *either* endpoint of a `contradicts` link, after normalizing
local ids and coordinates to canonical form. Stance chips + label badges
render wherever a claim renders, matched the same way.

### Reader claims bar (`src/reader/claim-extractor.js` → `renderClaimsBar`)

Per claim row, alongside the existing 🔗/✎/🗑 actions:

- **Assess** button → assessment modal: five stance chips (strongly
  disagree → strongly agree), label picker grouped by taxonomy category
  (+ custom input), per-label note, rationale textarea.
- **Per-label span anchoring needs its own interaction** (not plain reuse
  of the 10.3 flow — that captures at selection-popover time, and a modal
  with a backdrop has no live selection): the modal minimizes into a
  "mark the span" mode, the user selects text in the article, the anchor is
  captured via `captureFromRange`, and the modal restores. Scoped
  explicitly into 11.3.
- **Stance chip + label badges + ⚠** per the badge rule; clicking ⚠
  expands the linked claim(s) with their notes — the existing links block,
  upgraded.
- **Others' claims modal** (`renderForeignClaim`): foreign claims get the
  same Assess affordance *and the same overlay* — an already-assessed or
  linked foreign claim shows its stance chip, label badges, and ⚠ here too
  (matched by coordinate). Without this, one of the three claim-rendering
  surfaces would silently drop the "surface it wherever it reappears"
  requirement.
- **Tagging-workload helper:** the claim modal pre-fills the last-used
  about-entities for the session (a case capture session tags dozens of
  claims with the same case entity; without a sticky default the
  acceptance runs are needlessly tedious).

### Cross-source link modal (upgrade of `openEvidenceLinkModal`)

"Link to another claim" currently offers same-article candidates only. It
becomes a search over **all captured claims** — `ClaimModel.getAll()` across
articles, **plus assessed-foreign claims** (their coordinates, urls, and
text snapshots already live in `claim_assessments`), plus any foreign claims
currently on screen — with source-URL shown per candidate, relationship
picker (`contradicts / supports / updates / duplicates`), and a note field.

### Side panel entity view (`src/sidepanel/index.js` → `renderDetail`)

- **Per-claim rollup:** after `loadNetworkClaims` renders network claims,
  overlay local assessments per the badge rule (`renderNetworkClaimRow`
  gains the stance chip + label badges + ⚠ — **and an Assess action**:
  the side panel is where foreign claims about a case actually surface, so
  read-only rows here would quietly narrow "assess any claim" to "any claim
  on the page you're reading"). Requires the panel to stash parsed network
  claims in state instead of discarding them after render (also needed by
  export). Local-only claims about the entity (not yet on relays) are
  listed too, so the dashboard works before anything is published.
- **Inconsistencies section:** a sibling block after "Claims about this
  entity" listing `contradicts` links where **at least one endpoint is
  about this entity** (the other endpoint renders as context). Requiring
  *both* endpoints to be tagged would silently drop cross-video pairs where
  the user tagged only one side with the case entity — the most common
  miss. Label **counts** summarize at the top ("3× misleading ·
  2× unsupported · 1× flip-flop").
- **Replaceable-event dedup:** the panel applies client-side
  `(kind, pubkey, d)` latest-wins dedup to query results in 11.5
  (`queryRelays` dedups by event id only, so republished claims/assessments
  would otherwise render twice).
- **Case dashboard = entity detail.** No new view; the entity detail *is*
  the case dashboard once claims are tagged about the case entity.

### Case = entity (decision), `case` type recommended

A case ("John Dehlin excommunication", "Bricks & Minifigs scandal") is an
**entity** — *not* a dedicated case object. A dedicated object would
duplicate the entity pipeline (keypair, picker, sync, publish) for one
ontological nicety, while an entity gets all of it free: keypair → about
p-tags → `#p` relay query → 10.4 aggregation → the new rollups, unchanged.

Within that: **recommendation is a first-class `case` entity type** rather
than overloading `thing`. Entity type is already wire-visible
(`entity-type` tags in 30078 sync and 32125 relationship events), so
deferring the type means the acceptance-case entities publish as `thing`
and need a type migration + republish later — exactly the wire-vocabulary
churn the compat rule exists to avoid. Adding it now is small and contained
(`ENTITY_TYPES`, icon, tag map, the `event-builder.js` kind-0 type ternary,
sidepanel filter chip) and gives the type filter, a cases-only "Export
case" affordance, and a legible demo; entity-sync ingest already tolerates
unknown type strings on older installs. Fallback if the maintainer
disagrees: plain `thing` + naming convention works with zero schema work
(open question #3).

## Export (per case)

From the case entity's detail view: **Export case** → JSON and Markdown
(both generated client-side in the panel — the entity-registry export
already proves the Blob-download pattern there).

**Deterministic content set:** local claims about the case entity + every
foreign claim snapshot held in `claim_assessments` / `evidence_links` that
is about the entity (per the badge-rule matching). Network-loaded claims
that were neither assessed nor linked are *not* included (their presence
would make the same case export differently depending on whether/when "Load
from relays" was clicked); a `generated_at` + entity coordinate header
records provenance.

- **JSON:**

  ```jsonc
  {
    "case": { "id", "name", "type", "pubkey" },
    "generated_at": "<ISO-8601>",
    "claims": [ {
      "ref": { "claim_id?", "coord?", "author_pubkey?" },
      "text", "url", "title?", "about": [], "source?",
      "origin": "local" | "foreign",
      "assessment?": {
        "stance", "stance_label", "rationale", "suggested_by",
        "labels": [ { "label", "note?", "anchor?", "suggested_by" } ]
      }
    } ],
    "contradictions": [ {
      "relationship", "note", "suggested_by",
      "source": { "ref", "text", "url" },     // endpoint snapshots embedded,
      "target": { "ref", "text", "url" }      // so no ref ever dangles
    } ],
    "label_counts": { "misleading": 3, "unsupported": 2 }
  }
  ```

  Per-label notes/anchors and every `suggested_by` survive into the JSON —
  it's the machine-readable case file and the LLM-readiness seam.
- **Markdown:** case header → key claims grouped by stance → per claim:
  quoted text, source link, stance, labels with notes → "Inconsistencies"
  section pairing the contradicting quotes with their sources → label
  tally. Immediately publishable as research notes.

## Slice plan (one concern per PR; `claude/phase-11-*`)

1. **11.1 — Taxonomy + assessment model + tests; legacy 30043 publish
   gated off.** `assessment-taxonomy.js`, `assessment-model.js`,
   validation, idempotency (including the create-pre-publish /
   re-create-post-publish same-record test), the full model-test
   checklist. `ClaimModel.markPublished` gains `publishedPubkey`.
   `evidence-linker.js`: relationship enum, canonical refs +
   normalization, symmetric-relationship ordering, endpoint snapshots,
   matcher updates. The reader's evidence-link publish batch is switched
   off (CHANGELOG + JOURNAL callout — behavior change). `case` entity type
   (if confirmed). No UI, no new wire.
2. **11.2 — Wire builders + NIP draft (the wire-format PR).**
   `buildAssessmentEvent` (30054), `buildClaimRelationshipEvent` (30055) +
   `parseRelationshipEvent` (new consumer code + first wire tests),
   delete `buildEvidenceLinkEvent`, `assessmentPublishing` flag,
   NIP_DRAFT.md §30040/§30054/§30055 + intro count + Querying section,
   CHANGELOG + JOURNAL compat callouts.
3. **11.3 — Assess UI in the reader** (draft PR for smoke-test). Modal,
   stance chips, label badges, the modal-minimize span-anchoring
   interaction, foreign-claim assess + overlay in the others'-claims
   modal, sticky about-entity defaults.
4. **11.4 — Cross-source link UI** (draft PR). Link modal search across all
   captured + assessed-foreign claims, ⚠ badges + expandable linked claims
   per the badge rule.
5. **11.5 — Side-panel rollups + inconsistencies** (draft PR). Stance/label
   overlay + Assess on network claim rows, panel state for parsed claims,
   local-claims listing, inconsistencies section (at-least-one-endpoint
   rule), label counts, `(kind,pubkey,d)` dedup, onChanged whitelist.
6. **11.6 — Case export.** JSON + Markdown, deterministic content set.
7. *(follow-up, flag-gated)* Publish path: claim-before-assessment
   ordering, coord backfill, 30054/30055 + 1985-mirror publishing, local
   30043→30055 republish, network assessment aggregation.

Acceptance demo after 11.6, on both driving cases: capture several
videos/articles → atomize quotes into claims about the case entity + people
→ assess each (stance + labels, incl. an anchored label) → create a
cross-video `contradicts` link → open the case entity: claims, stances,
label counts, inconsistencies all visible → export JSON + Markdown.

## Reconciling Phase 10.5

ROADMAP 10.5 ("metadata reframe") is superseded as follows (the ROADMAP and
JOURNAL have been updated alongside this note):

- *"Fact-checks/ratings as responses-to-claims"* → *realized* by the
  assessment primitive: a personal judgment **is** the response-to-claim,
  with a purpose-built kind. 30051 keeps its formal-ClaimReview role
  (unshipped, flag-gated, available later); 30052 stays a URL-level rating —
  neither is overloaded.
- *"Reconcile annotations onto the shared anchor"* → already done for claims
  in 10.3; annotations (30050) are untouched by Phase 11.
- *"Retire `30043`"* → **confirmed and completed by this phase**: the
  legacy publish path is gated off in 11.1 and the kind is replaced by
  the cross-source `30055` — the same-article-only evidence UX retires
  with it.

## Known limitations (accepted for v1)

- **Entity pubkeys are per-install**, so cross-*user* aggregation of
  assessments about an entity only works between users who share entity keys
  (entity-sync). Unchanged from 10.4; the aggregation phase owns this.
- **`#p` role conflation:** the entity query matches `about` and `source`
  roles alike (10.4 behavior); rollups filter client-side by tag role.
- **Repeated-short-phrase anchors** resolve to the first occurrence
  (documented 10.3 limitation) — applies to label anchors identically.
- **Claims' raw-URL `r` tags** (vs. the metadata layer's normalized URLs)
  remain a known fork; 30054/30055 bridge it with the verbatim-`r` +
  normalized-`i` rule above, and a 30040 normalization retrofit is left as
  a separately-called-out future wire change.

## Open questions for review

1. **Kind numbers `30054`/`30055`** in our draft-NIP block — OK?
   (30051-reuse and 30043-repurposing both examined and rejected above.)
2. **1985 mirror** as the designated NIP-32 aggregation path in the publish
   slice — agreed?
3. **`case` entity type now** (recommended) vs. plain `thing` + naming
   convention?
4. **Label-only assessments** (stance null) — confirmed OK?
5. **Export trigger** in the side-panel entity detail — right home, or also
   want it in the reader?

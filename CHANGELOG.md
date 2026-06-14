# Changelog

All notable changes to X-Ray. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Sections per release: **Added** (new features), **Changed**
(behavior changes for existing features), **Fixed** (bug fixes),
**Removed**.

## [Unreleased]

### Added

- **Phase 13.4 — capture-time canonical hashing.** ⚠️ **Wire-format
  change to kind 30023 (additive)**: new articles carry the canonical
  article hash as an indexed `x` tag — SHA-256 of the normalized body
  markdown (the content after the metadata header), the anchor every
  audit kind joins on (`docs/NIP_DRAFT.md` §30023 `x` extension).
  Pre-13.4 events are unaffected (no `x`; consumers fall back to
  `r`/`d`). Interpolated metadata-header fields (title/byline/site
  name) are newline-flattened at build time so a hostile value cannot
  forge the header terminator and skew third-party hash
  recomputation — a no-op for every real capture seen so far. Archive
  records gain an `articleHash` field; the reader shows the hash under
  the article meta and a warning banner when a re-capture of the same
  URL hashes differently (the stealth-edit surface). Displaced
  versions are retained on the archive row (`priorVersions`, bounded
  at 3) so the text prior audits anchor to genuinely survives a
  re-capture — "capturing both versions is its own diagnostic."

- **Phase 13.1–13.3 — epistemic-audit foundation** (flag-gated,
  default off; `docs/EPISTEMIC_AUDIT_DESIGN.md`). The audit model
  layer (`src/shared/audit/`): canonical article hash (byte-parity
  with the vendored scorer's normalization), eight derived
  findings-schema validators, the `xray-audits` IndexedDB ledger,
  beats-v1 vocabulary, calibration-v1 math (logged, not activated),
  dossier rollup math (published shrinkage) — and the wire layer:
  builders + parsers for **six new event kinds** specified in
  `docs/NIP_DRAFT.md`: 30056 AuditModuleResult, 30057 AggregateAudit,
  30058 PredictionEntry, 30059 PredictionResolution, 30060
  DossierSnapshot, 30061 AuditDispute (wire-format-only — no filing
  UI or adjudication runtime). **Wire-format note for event
  consumers:** the audit kinds carry the indexed `x` tag (SHA-256 of
  normalized article markdown, NIP-94 precedent) as their article
  anchor; audit events never carry assessment vocabulary (`stance`,
  `L`/`l` labels) and MUST NOT be merged with 30051 fact-checks or
  30054 assessments; 30059 resolutions and 30061 disputes require
  typed evidence. Nothing publishes until the `epistemicAuditing`
  flag (default `false`) is enabled; no UI ships in these slices.

### Fixed

- **Hardening from the Phase 12.7 adversarial review** (three lenses,
  every finding probe-verified; full record in `docs/JOURNAL.md`
  2026-06-11). The two relay-sync bugs: an unreachable relay was
  indistinguishable from an empty one (`queryRelays` resolves ok for a
  failed connect), so an offline Refresh reported success and advanced
  the portal's sync cursor over the outage — the connect failure is now
  stamped on the per-relay stat and honored; and backfill paged with an
  exclusive `until`, silently dropping same-second events at a relay's
  response-cap boundary — paging is now inclusive with a
  nothing-new-from-this-relay terminator. The sync cursor also
  fingerprints the identity + relay sets (a new npub or relay triggers
  a full backfill, not a one-hour window) and only advances on a clean
  pass. "Open in reader" no longer writes the relay reconstruction into
  the archive cache (read-only guarantee); reconciliation reads link
  endpoints from the fields records actually carry and matches article
  addresses by the raw-URL hash the wire uses; one millisecond-precision
  timestamp can no longer freeze the timeline; sourced claims get
  assessment tinting; case-dashboard rows open the inspector; the
  Library gained the designed ledger-status facet, show-more pagination,
  and the local-only count + legend; the portal is now linked from the
  options and side-panel headers; and a failed IndexedDB open degrades
  to live-only instead of bricking the page.

- **Hardening from the Phase 11.7/11.8 review.** Case bundles now derive
  the key slot from the entity id and ignore any bundle-supplied
  `keyName` (a crafted bundle could otherwise bind a record to the
  reserved primary-identity key). Published judgments now carry the
  claim's **verbatim** `r` URL (was normalized — forking the `#r` join);
  the kind-1985 label mirror drops the author `p` tag (it would
  mislabel the claim's author) and carries `r`; a rejected mirror is
  retried instead of lost (tracked by a separate `mirroredAt`); legacy
  kind-30043 links correctly republish as kind-30055; foreign-claim
  assessments mirror the claim's about-entity `p` tags; "Erase all"
  clears the experimental flags; and published assessments show a 🌐
  badge.

### Added

- **Portal inspector + reconciliation** (Phase 12.6). Clicking any
  Library row opens an **inspector drawer**: the addressable
  coordinate, event id, author, **which relays hold the event**, its
  ledger status, the raw signed JSON (copyable), a jump to the source
  URL, and for articles a read-only **Open in reader** that
  reconstructs the capture from its signed event. Above the list, the
  **reconciliation panel** diffs the local publish ledger against
  relay truth — "ledger says N published; relays confirm M; K
  missing; R remote-only" — matching by exact event id first, then by
  replaceable address (so a republish from another device still
  confirms), with the missing entries listed. Rows wear ✓ /
  ◌ remote-only chips; comments/accounts/32125 (no publish ledger)
  stay neutral by design. Strictly display-only: the portal never
  writes `markPublished` or imports remote events into local models.

- **Portal entity spokes graph + case dashboard** (Phase 12.5). The
  "explore visually" surface, per the agreed design: a hand-rolled
  SVG **ego graph** — focused entity centered, deterministic radial
  layout with type sectors (claims about it, claims it sourced,
  co-tagged entities, containing cases, linked platform accounts),
  spoke and mention edges, **⚠ contradiction edges** drawn hot with
  ghost endpoints when the counterpart claim lives outside the ego
  set, claim nodes tinted by their latest assessment stance, per-type
  "+K more" overflow nodes that expand on click, drag-pan, wheel-zoom,
  and locate-by-text pulse. Clicking a co-tagged entity refocuses;
  clicking a case opens the new **case dashboard** — the publish-side
  complement of the side panel's local one: artifact rollup by type, a
  publish-density strip, the people/orgs tagged alongside, and the
  case's claims with stance and ⚠ contradicted badges. Entity and
  case rows in the Library link straight in. No graph dependency
  added; the bundle stays vanilla SVG.

- **Portal timeline — publish-date density + brush filtering**
  (Phase 12.4). A density strip over the corpus's `created_at` (UTC
  day buckets, rolling up to Monday-anchored weeks past 180 days, gap
  days rendered as gaps) sits above the Library; capture sessions show
  as spikes. Dragging across bars — or clicking one — brushes a time
  range that filters the list below (after-inclusive /
  before-exclusive, one filtering path with tabs/facets/search); a
  chip shows the active range and clears it.

- **Portal cache — instant open, incremental refresh** (Phase 12.3).
  The portal now renders from a local IndexedDB cache (`xray-portal`,
  a separate database from the archive — derived data, droppable and
  rebuildable) and refreshes in the background: incremental `since`
  queries with a one-hour clock-skew overlap, write-time supersession
  so the store only ever holds the newest version per replaceable
  address, relay-provenance sets merged across syncs, a "+N new"
  status diff, and a **Full resync** button that drops the cache and
  re-fetches everything. The sync cursor only advances when at least
  one relay answered, so a dead-network refresh can't eat the window.

- **Portal Library — type tabs, facets, search** (Phase 12.2). The
  portal's flat list grows into a browsable Library: type tabs with
  live counts (Articles / Claims / Comments / Assessments / Links /
  Entities / Cases / Accounts / Other), facet selects for platform,
  source domain, case, and publishing client, a group-by-source toggle,
  and cross-cutting token-AND search over claim text, comment text,
  article titles, entity names, assessment labels and rationale, and
  account handles. Case membership derives from `p` tags matching
  local case entities — the publish-side complement of the side
  panel's case dashboard. The item model is a pure module
  (`src/portal/library.js`) with its own test suite.

- **"My Archive" portal — foundation** (Phase 12.1,
  `docs/PORTAL_DESIGN.md`). A new full-tab extension page
  (`src/portal/`, opened from the toolbar right-click menu or the
  `xray:openPortal` message) showing everything you've published to
  your configured relays: identity resolution as a provenance-tagged
  set (signer / `xray:user` sync key / claim publish history / manual
  npub — NIP-07 users paste their npub in v1), per-relay corpus
  queries with empty-page pagination so "which relays hold this event"
  is exact, and a flat newest-first list with per-kind summaries and
  raw-event view. New read-side parsers close the wire round-trip:
  `EventBuilder.parseCommentEvent` (kind 30041) and
  `parseAssessmentEvent` (kind 30054). The side panel's
  replaceable-event dedupe moved to `shared/nostr-events.js` and is now
  NIP-01-class-aware (kind-0/10002 collapse per author; 1985/9803 all
  kept). Read-only: the portal publishes nothing and never writes the
  local ledger.

- **Case collaboration bundles** (Phase 11.8). A case entity's detail view
  gains **Share case bundle (includes keys)**: a JSON file carrying the
  case and every entity its claims reference — names, alias links, and
  **private keys** (clearly warned; share it like a password). A
  collaborator imports it via the entity list's existing Import button:
  keys install conflict-safely (an existing different key is never
  overwritten — reported instead), records keep the exporter's original
  entity ids, and from then on both sides tag claims under the **same
  entity pubkeys**, so published claims aggregate in the `#p` queries and
  the case dashboard across installs. This closes the known
  per-install-pubkey limitation for shared cases.

- **Judgment publishing** (Phase 11.7; behind **Settings → Advanced →
  Experimental → "Publish assessments & claim links to relays"**, default
  off). When enabled, the reader's Publish batch also emits — after the
  claims, so own-claim coordinates resolve from the recorded publishing
  pubkey — your wire-ready judgments: kind-30054 assessments (stance,
  labels with anchors/notes, rationale, mirrored about-entity `p` tags),
  kind-30055 claim links (both endpoints' coordinates required), and a
  one-time kind-1985 label mirror per labeled assessment on its first
  publish (the plain-NIP-32 aggregation path). Selection spans ALL
  wire-ready judgments (judgments are article-agnostic), uses the standard
  `updated > publishedAt` re-emit gate, backfills assessment coordinates
  at publish time, and reports per-type results in the publish summary.
  Local capture continues to work with the switch off.

- **Case export** (Phase 11.6 — the last Phase 11 v1 slice). Case
  entities' detail view gains **Export JSON** + **Export Markdown**: the
  deterministic case file (local claims about the case, your stances +
  labels with notes/anchors/provenance, contradictions with embedded
  endpoint snapshots — never dangling — and the label tally; viewed-only
  network claims are excluded so the same case always exports the same
  bytes) and the publishable research-notes report (claims grouped by
  stance, inconsistencies pairing the contradicting quotes, label tally).
  `docs/SMOKE_TEST.md` gains the full Phase 11 walkthrough (§11.1–11.24).

- **The case dashboard: side-panel rollups + inconsistencies**
  (Phase 11.5). The entity detail view now has three judgment surfaces:
  **Your claims about this entity** (local claims tagging it, each with
  your stance/label badges and an ⚖ Assess action — works before anything
  is published), the network **Claims about this entity** list upgraded
  with the same badges + Assess per row (judging a network copy of your
  own claim hits the same record) and NIP-01 **latest-wins dedup** per
  `(kind, pubkey, d)` so republished claims show once, and a new
  **⚠ Inconsistencies** section listing `contradicts` links where at
  least one endpoint is about the entity — each pair quoted with its
  source host and note — headed by the **label tally** ("3× misleading ·
  2× unsupported"). Loaded network results survive re-renders, and the
  panel live-refreshes when claims, assessments, or links change in the
  reader.

- **Cross-source claim links + ⚠ contradiction surfacing** (Phase 11.4).
  The 🔗 link modal now searches **all captured claims** — local claims
  across every article (📋), assessed-foreign claims (⚖, from their stored
  snapshots), and foreign claims seen in the last others'-claims query
  (🌐) — with a text/URL search box and per-candidate source host;
  `contradicts` leads the relationship picker and is the default. A claim
  participating in a `contradicts` link shows a **⚠ badge** (either
  endpoint, after canonical-ref matching), the offending link row is
  highlighted, symmetric links render with ↔, and cross-source endpoints
  render their text + source host from claim records or link snapshots —
  no relay round-trip.

- **Assess UI in the reader** (Phase 11.3). Every claim row in the claims
  bar gains an **⚖ Assess** action opening the judgment modal: five stance
  chips (strongly disagree → strongly agree, click again to clear), the
  label picker grouped by taxonomy category with a custom-label input
  (normalizes case/whitespace), a per-label note, an optional per-label
  **📍 offending-span anchor** (the modal minimizes while you select the
  passage in the article), a markdown rationale, and Remove. Your stance
  chip + label badges render on the claim row. Foreign claims in the
  **Others' claims** modal get the same Assess action + badge overlay,
  keyed by the event's coordinate — judging a network copy of your own
  claim updates the same record. The claim modal now pre-fills the
  last-used about-entities for the session (case-capture tagging helper),
  and deleting a claim also removes your assessment of it.

- **Assessment + claim-relationship wire builders** (Phase 11.2;
  **wire-format addition**, publishing stays off). `buildAssessmentEvent`
  (kind `30054`: claim referenced by `a` coordinate, `d` recomputable from
  it, stance −2..+2, NIP-32-style `L`/`l` labels under `xray/assessment`
  with per-label anchor/note tags, mirrored about-entity `p` tags, the
  claim's `r` verbatim + normalized `i`/`k`) and `buildClaimRelationshipEvent`
  (kind `30055`: two `a`-coordinate endpoints with `source`/`target` markers,
  symmetric relationships sort endpoints so A↔B republishes the same `d`)
  + `parseRelationshipEvent`. Both publish paths are gated behind the new
  **`assessmentPublishing` flag (default off)** — nothing is emitted yet;
  this slice makes the local records publish-*ready*. `docs/NIP_DRAFT.md`
  gains §30040 (claim), §30054, §30055, updated querying filters, and the
  30051-vs-30054 delineation (formal ClaimReview vs personal judgment).

- **Assessment data layer** (Phase 11.1; local-only, no UI yet — see
  `docs/ASSESSMENTS_DESIGN.md`). New `assessment-model.js` +
  `assessment-taxonomy.js`: register a personal judgment on any claim —
  yours or a foreign one referenced by its `30040:<pubkey>:<d>` coordinate —
  with a graded stance (−2..+2), typed issue labels (`misleading`,
  `fallacy/strawman`, `flip-flop`, … under the `xray/assessment` namespace,
  each optionally anchored + noted), a markdown rationale, and a
  `suggested_by` provenance field (`'user' | 'llm:<model>'`). One assessment
  per claim, idempotent across the publish boundary via canonical claim refs
  (`claim-ref.js`). Records live under the new `claim_assessments` storage
  key; the kind-30054 wire mapping lands in slice 11.2 and publishing stays
  flag-gated.
- **`case` entity type** (🗂️) for modeling a real-world story under
  assessment ("John Dehlin excommunication") — the side-panel entity detail
  becomes the case dashboard in later Phase 11 slices.

- **"Claims about this entity" — cross-source aggregation** (Phase 10.4). The
  side-panel entity browser's detail view gains a **Load from relays** action
  that queries `kind 30040` across your configured relays by the entity's
  pubkey (`{ kinds:[30040], "#p":[P] }`) and shows what the network has said
  about that person / org / thing — grouped by author, each claim with its ⭐
  key flag, source, and a link back to the article it came from. This is the
  payoff of the entity-centric claim redesign: because claims `p`-tag the same
  entity pubkeys X-Ray uses everywhere, "what the network says about P" is a
  single relay query. (Per-*entity* axis — distinct from the reader's existing
  per-*article* "Others' claims".) The panel routes the query through the
  background service worker's relay pool (`xray:relay:query`); reading is
  dual-vocabulary via a shared `parseClaimEvent`, so pre-redesign `30040`s
  show too.

### Changed

- **Claim links are cross-source and re-typed** (Phase 11.1). The link
  vocabulary is now `contradicts / supports / updates / duplicates`
  (`contextualizes` is read-only legacy: old records still render; new links
  can't use it). Endpoints accept local claim ids **or** foreign claim
  coordinates, and symmetric relationships (`contradicts`, `duplicates`)
  derive one id regardless of creation direction. Links now carry
  `suggested_by` + per-endpoint `{url, text}` snapshots.

- **Evidence-link (kind `30043`) publishing is switched off** (Phase 11.1;
  **behavior change**). The reader's batch publish no longer emits kind-30043
  events — the kind is retired per the agreed Phase 11 design; cross-source
  links will publish as the new kind `30055` behind the `assessmentPublishing`
  flag in a later slice. Local link records are unaffected, and
  already-published 30043s stay on relays (NIP-09 cleanup remains a later
  phase).

- **Claims record their publishing pubkey** (`ClaimModel.markPublished`
  gains `publishedPubkey` + an append-only `publishedPubkeys` history) so a
  published claim's addressable coordinate stays recoverable even if the
  signing identity later changes.

- **Claims record a precise text-anchor** (Phase 10.3). When you mark a
  claim, X-Ray now captures a W3C-Web-Annotation selector (exact text +
  prefix/suffix + XPath/CSS fallbacks) from the selection — reusing the
  Phase 9a `anchor-capture` machinery — and stores it on the claim (and in
  the `30040` event's `anchor` tag). The reader's body highlight now resolves
  via that anchor's prefix/suffix to mark the **exact** passage, instead of
  blindly wrapping the first occurrence of the claim text; it falls back to
  the first-occurrence search for pre-anchor claims or when the body has been
  edited past what the selector cascade can recover.

- **Lean `kind 30040` claim wire format** (Phase 10.2; **wire-format
  change**, back-compat preserved). Published claims now carry the entities
  they're about as **`['p', <entity_pubkey>, '', 'about']` tags** (mirrored by
  `['entity', <name>, 'about']`), the claim text as the event **content**, the
  asserting source as `['source', …]` (+ a `p`-tag when it's an entity), and a
  single `['key','true']` flag — replacing the old `claim-text` / `claim-type`
  / `crux` / `confidence` / `attribution` / `subject` / `object` / `predicate`
  / `claimant` tag soup. This makes *"what the network says about person P"* a
  single `{ kinds:[30040], "#p":[P] }` query. **Reading is dual-vocabulary:**
  the "others' claims" view renders both new and pre-redesign events, and
  already-published claims keep their old tags. The transitional legacy-field
  mirror from 10.1 is removed. Entity-relationship (`32125`) events derived
  from claims now use `about` / `source` relationship types.

- **Claims simplified to a thin, entity-centric model** (Phase 10.1; see
  [`docs/CLAIMS_REDESIGN.md`](docs/CLAIMS_REDESIGN.md)). A claim is now just
  *text + the entities it's about + an optional "who said it" + a single ⭐
  key-claim flag*. The old per-claim fields — type, the crux confidence
  slider, attribution, predicate, the subject/predicate/object pickers, and
  quote-date — are gone from the capture modal. Old stored claims normalize
  to the new shape on read; no wire-format change yet (the thin fields are
  mirrored onto the legacy fields the publisher still reads — slice 10.2
  rewrites the `kind 30040` tag set).

- **Docs refreshed for the post-parity state.** `ROADMAP.md` updated:
  status snapshot reflects all phases complete, the v0.5.x cleanup (A–E)
  recorded, the deferred backlog triaged (keep / defer / cut) against the
  claim-tracking goal, and **Phase 10 — Claim tracking** added as the next
  milestone. `SMOKE_TEST.md` rewritten for the no-FAB capture model
  (toolbar / keyboard / right-click → reader; removed the FAB-badge and
  FAB-header-signing steps). README status updated.

- **Legacy `nac-*` CSS prefix fully eliminated.** The last `nac-*` tokens —
  the capture→Markdown markers in `content-extractor.js` (`nac-tweet-embed`,
  `nac-facebook-post`, `nac-inline-img`, …) — were renamed to `xr-*`. These
  are internal class names on cloned nodes the Turndown rules match; the
  rename is a pure no-behavior-change string swap (producer/consumer pairs
  stay matched). The whole codebase now uses the `xr-*` prefix.

- **NOSTR `client` tag unified to `'xray'`** across all event builders
  (article 30023, entity-sync 30078, relationship 32125, evidence 30043
  previously emitted `'nostr-article-capture'`; comment 30041 and
  platform-account 32126 already used `'xray'`). The entity-sync NIP-32
  label namespace likewise moves to `xray/entity-sync`. **Wire-format
  change, back-compat preserved:** entity-sync *reads* still accept the
  legacy `nac/entity-sync` label, so entities synced before the rename
  still pull; already-published events keep their old `client` value.
- **Settings consolidated.** The Advanced tab is reorganized into a
  **Reader** group (archive banner sensitivity, promoted out of the
  engine-tuning pile) and a **Power user** group (debug logging + the
  engine-tuning overrides), then the Danger zone. The header quick-action
  is now **Capture Page**.
- **Capture is now a single surface.** The in-page floating action button
  (FAB) and the in-page capture panel were removed. Clicking the toolbar
  icon, pressing `Ctrl/Cmd+Shift+X`, or right-click → "Capture this page
  with X-Ray" now extracts the page and opens it directly in the reader
  (which already superseded the panel for preview, entity tagging, claims,
  comments, and publishing). The content script no longer injects any
  in-page chrome beyond a transient error toast.

### Removed

- **`buildEvidenceLinkEvent` (kind `30043`) and the reader's dead
  evidence-link publish loop** (Phase 11.2). Publishing was already switched
  off in 11.1; this removes the builder and plumbing. Already-published
  30043s stay on relays (NIP-09 cleanup remains a later phase); local link
  records are untouched and republish as `30055` when the flag turns on.
- **The "Migrate from userscript" Settings tab** and its importer
  (`shared/userscript-migration.js` + tests). The legacy
  `nostr-article-capture` userscript data import is no longer shipped.
- **Dead settings:** the Advanced tab's **Theme** and **Media handling**
  selectors (both written but never read by any code), and the unused
  `recent_publications` storage key.
- The FAB, the in-page capture panel and its publish form, the FAB archive
  badge, and the FAB-header signing-status indicator. Signing status lives
  on the Settings → Signing "Active method" line; a prior capture surfaces
  via the reader's archive banner. (~600 lines of content-script JS/CSS
  deleted, including most of the legacy `nac-*` styling.)

## [0.5.1] — 2026-06-06

### Fixed

- **Inline person/place names no longer vanish from article captures** on
  sites that wrap them in `popup`-classed elements (e.g.
  josephsmithpapers.org). Readability's `unlikelyCandidates` blocklist
  matches the substring `popup` and was deleting the whole wrapper —
  visible name included — leaving dangling punctuation. The extractor now
  unwraps `aside.popup-wrapper` to its reference text before Readability
  runs.
- **Publishing no longer fails with `invalid: tag val was not a string`**
  on pages whose JSON-LD carries a non-string `articleSection` (array) or
  `inLanguage` (object). The kind-30023 builder now sanitizes every tag
  value to a string — flattening arrays, extracting `name`/`@value` from
  schema.org objects, and dropping anything unstringifiable — so a single
  odd metadata field can't make relays reject the whole event.

## [0.5.0] — 2026-05-29

This release consolidates three feature lines onto `main`: default-to-local
signing + the consolidated Settings hub, the Phase 9a crowdsourced
URL-metadata data model + NIP draft, and the Phase 9 social-media identity
layer.

### Added

- **Signing method is now an explicit user preference**
  (`preferences.signing_method`, values `'local' | 'nip07' | 'nsecbunker'`)
  with **local signing as the default**. Replaces the auto-detect-NIP-07-
  then-NSecBunker probe at content-script init.
- **`Signer` façade** (`src/shared/signer.js`) — single sign call site that
  dispatches to `Crypto.signEvent` (local), the injected NIP-07 client, or
  `NSecBunkerClient.signEvent`. The whole publish path goes through it.
- **Local primary identity** in a dedicated `local_primary_identity`
  storage key with its own `Storage.primaryIdentity` namespace (Generate /
  Import nsec / Show nsec / Reset). Kept distinct from `keypair_registry`
  so an entity-key export never leaks the user's own nsec.
- **Idempotent signing-method migration** — existing profiles land on
  `signing_method=local`, `signing_method_configured=false` so a one-time
  setup banner fires on the next Settings open.
- **Signing tab redesign** in Options — radios for Local / NIP-07 /
  NSecBunker, per-method panels, NSecBunker **Test connection** button,
  and an always-visible *Active method: …* line at the top of the tab.
- **Per-relay flags surfaced** in Options → Relays — URL / read / write
  / enabled rows replace the textarea. The structured shape persists as
  `preferences.relays`; `preferences.default_relays` (URL list) is
  auto-synced to the enabled+writable subset for back-compat with every
  reader (`nostr-client.js`, background, reader, sidepanel).
- **`CONFIG` override controls in Options → Advanced** — article cache
  enabled/budget, min content length, max claim length. Applied via a
  new `applyConfigOverrides()` at content-script init.
- **FAB panel header** gained a settings cog and entity-browser icon.
  Clicking either messages the SW (`xray:openSettings`,
  `xray:openEntities`), so the FAB itself is a settings entry point.
- **FAB relay picker now reads from `Storage.relays.get()`**, filtered
  to enabled+writable relays. Settings → Relays drives what the FAB
  offers; static `CONFIG.relays` no longer leaks through.
- **Quick-actions bar** at the top of the Options page (Toggle Capture
  / Entity Browser / Capture tips), so Options is a complete settings
  hub on its own.
- **`Storage.relays.set()`** — structured-shape writer; round-trips
  through `Storage.relays.get()` and keeps `default_relays` in sync.
- **12 new tests in `tests/signer.test.mjs`** covering all three
  signing branches, primaryIdentity round-trip, the `signing_method`
  migration, and `Storage.relays.set()`.
- **Phase 9a — crowdsourced URL-metadata data model** (`src/shared/metadata/`).
  The wire-format foundation for annotations, fact-checks, ratings,
  topic-scoped trust, and helpfulness votes, conforming to
  `docs/NIP_DRAFT.md`:
  - NIP-73-conformant URL normalizer (`url-normalizer.js`);
    `Utils.normalizeUrl` is now a thin wrapper over it.
  - W3C Web Annotation selector capture + a confidence-scored
    resolution cascade (`anchor-capture.js` / `anchor-resolver.js`).
  - Builders for kinds 30050 (Annotation), 30051 (FactCheck), 30052
    (Rating), 30053 (TopicTrust), 9803 (HelpfulnessVote) + the kind
    30023 `responds-to` tag extension (`builders.js`).
  - First-order trust graph (kind 3 + kind 30053) and a v1
    binary-trust ranker (`trust-graph.js` / `ranker.js`).
  - Feature flags gating the not-yet-surfaced kinds; IDB v2 metadata
    stores in `archive-cache.js`. Data model only — no UI yet.
  - `docs/NIP_DRAFT.md` — the authoritative wire-format spec
    ("Web Content Annotations, Fact-Checks, and Topic Trust").
- **Phase 9 — social-media identity layer** (`src/shared/identity/`).
  Turns a captured author (commenter or post author) into a stable,
  cross-capture identity and lets the user collapse cross-platform
  accounts into one canonical person:
  - Deterministic `accountPubkey` per `<platform>:<stableId>`
    (`platform-account.js`) — an identifier-only key that never signs;
    a `Storage.platformAccounts` registry in `chrome.storage`.
  - Published comments and post authors now carry a stable `p`-tag
    identity (kind 30041 / 30023), via `recordAccount` + the existing
    `buildCommentEvent` socket and a new optional `authorAccountPubkey`
    on `buildArticleEvent`.
  - **YouTube comment capture** — parses the InnerTube
    `/youtubei/v1/next` responses (reusing the Phase 8a api-interceptor;
    both legacy `commentThreadRenderer` and modern `commentEntityPayload`
    shapes), keyed on the commenter's channelId. Scroll the comments
    into view before capturing (see `docs/CAPTURE_GUIDE.md`).
  - **Manual account↔entity linking** in the sidepanel Entity Browser,
    with alias-chain-aware `resolveAccountToEntity`. v1 is
    local-index-only (no kind 32126 relay publish) and manual-link-only.
- **Combined test suite: 519 passing** (up from 223 at v0.4.0), adding
  `tests/metadata-*`, `tests/identity-*`, `tests/youtube-comments`, and
  `tests/platform-account-event`.

### Changed

- **Toolbar-icon click no longer opens a popup.** The icon now toggles
  the FAB capture panel on the active tab via `chrome.action.onClicked`,
  mirroring the keyboard shortcut. On non-injectable pages
  (`chrome://`, `file://`, extension pages) it falls back to opening
  the Options page so the click is never a silent no-op.
- **Right-click menu on the toolbar icon expanded** to host the
  jump-actions the popup used to provide: Toggle Capture / Entity
  Browser / Settings… / View Keypair Registry / Export Keypair
  Registry / Capture tips.
- **`content/ui.js` publish flow simplified** — Local + NIP-07 collapse
  into a single `Signer.signEvent` path; NSecBunker keeps its
  per-publication-keypair flow.
- **Background `xray:sign` / `xray:getPubkey` route through `Signer`**
  instead of `NIP07Client` directly. The reader-page publish flow
  respects the user's chosen method.
- **README, ROADMAP, SMOKE_TEST, CONTRIBUTING** updated to reflect the
  current signing model, the popup removal, and the consolidated
  Settings hub. Test counts and bundle counts brought current.

### Removed

- **Toolbar popup** (`src/popup/`) — files deleted, popup bundle
  dropped from `esbuild.config.mjs`, `action.default_popup` removed
  from `manifest.json`. The popup duplicated state already shown in
  the FAB header and split jump-actions across multiple surfaces.
- **Forward-looking design plans under `docs/plans/`** — the five
  tentative documents (`NIP-COURT-OF-PUBLIC-OPINION`,
  `evidentiary-standards`, `protocol-adoption-guide`,
  `trust-reputation-system`, `ui-ux-design`) are out of scope for
  X-Ray's current phase and have been removed. The Phase 9 row that
  referenced them is gone from the roadmap.

## [0.4.0] — 2026-04-24

### Added

- **Phase 8d — Facebook handler** (`src/shared/platforms/facebook.js`).
  Third and final hard-tier platform; Phase 8 now complete.
  Recognizes all eleven FB post URL shapes: `/<user>/posts/<id>`,
  `/<user>/videos/<id>`, `/<user>/photos/<set>/<id>`, `/watch/?v=`,
  `/reel/<id>`, `/permalink.php`, `/story.php`, `/share/p|v|r/<code>/`,
  `/photo/?fbid=`, and `/groups/<g>/posts|permalink/<id>/`. Four
  parallel extraction paths with explicit provenance:
  - **GraphQL response interception** via the Phase 8a api-hook
    buffer — scored recursive walk picks the focal story by
    longest `message.text` + bonuses for `feedback`/`attachments`.
    Recursive `findCreationTime` fishes the timestamp out of
    `comet_sections.timestamp.story.creation_time` and similar
    nestings; `owner` accepted alongside `actors[0]` for the author.
  - **Open Graph + Twitter Card meta tags** — parser handles the
    `"<Author>: \"<body>\""` and `"<Author> wrote on Facebook: <body>"`
    shapes plus optional leading engagement-count prefixes.
  - **DOM scrape** scoped to `[role="dialog"]` (post-detail modal)
    / `[role="article"][aria-posinset]` (feed unit) via
    `pickFocalScope` — every scraper (author, body, verified flag,
    post date, images) bounded so sibling posts visible behind the
    modal never leak into the capture.
  - **HTML snapshot + screenshot** — always-on evidence layer.
  Post date extracted from absolute aria-label dates
  (`"Monday, April 21, 2026 at 9:30 PM"`), `<time datetime>`,
  or short-text relative-time tokens ("12h", "3d", "45m"). Event
  builder emits `post_id`, `post_kind`, `author_handle`, and
  `platform_account: facebook:<handle>` tags. Reader renders a
  Facebook-specific header with author block, engagement chips, an
  `extractedFrom` provenance chip, and inline screenshot evidence.
  Image gallery scraped from the modal-scoped `<img>` tags
  (fbcdn.net host filter, 200px size floor, signing-token-preserving
  dedup) and embedded in the markdown body. 35 new tests (URL
  grammar × 11 shapes, og:description variants, GraphQL walker
  across nested envelopes, image extractor with srcset/data-src/
  avatar-filter coverage, relative-time + absolute-date parsers,
  `findCreationTime` against nested-story shapes).
- **Capture quality hints + user documentation**.
  - `docs/CAPTURE_GUIDE.md` — user-facing walkthrough covering the
    correct way to capture from Instagram, Facebook, TikTok, plus
    brief mentions of the easy-tier platforms. Includes a
    symptom → cause → fix table for common bad-capture cases.
  - In-reader hint banner — amber dashed-border `<details>` above
    the article metadata when `extractedFrom === 'none'`, body text
    is short, media extraction missed on a photo post, or the
    author handle is empty. Platform-specific retry instructions,
    linked back to the capture guide.
  - Platform-aware FAB tooltip — hovering the FAB on Instagram,
    Facebook, or TikTok shows a one-line reminder of the right
    URL shape to capture from, before the user clicks.
  - Popup adds a "Capture tips (Instagram, Facebook, …)" button
    that opens the guide on GitHub.
- **Instagram post-item inline `user` fallback** — when og-description,
  URL path, and description-pattern author extraction all come up
  empty (post-detail pages loaded via `/p/<shortcode>/` without a
  username prefix), `extractMediaFromGraphQL` now also surfaces the
  post item's embedded `user` object. Used as the fourth
  handle-resolution fallback; also feeds `profile` enrichment when
  no dedicated `data.user` response was in the buffer.

### Fixed

- **Instagram captures were rejected by relays** with
  `"invalid: tag val was not a string"` because `user.pk` from the
  REST `/api/v1/media/…/info/` response is a number. Fixed at two
  layers: `normalizeUserShape` now stringifies at the normalization
  boundary, and the event-builder `author_id` emission is
  defensively `String()`-wrapped. Regression test asserts every
  tag value in a built article event is `typeof 'string'`.
- **Facebook captures produced `"null (@handle)"` bylines** when the
  author name came from a path other than og-meta/GraphQL.
  Defensive guard: `author ? "author (@handle)" : "@handle"`.
- **Facebook capture misattribution chips** — the author/extraction
  source was re-inferred at the end instead of being tracked at
  assignment, defaulting to `og-meta` even when og-meta contributed
  nothing. Now recorded as the extraction runs.
- **Facebook picked the wrong story** from multi-story GraphQL
  responses (first-quack walker grabbed a sibling or comment node).
  Replaced with a candidate-scoring pass: longest `message.text`
  wins, with bonuses for `feedback` metadata and `attachments`.
- **Facebook image scraper pulled feed posts from behind the modal**.
  Scoped to the focal post via `pickFocalScope` (dialog → aria-posinset
  article → article → document).
- **Facebook DOM body scraper swallowed an adjacent profile-feed
  post** when the focal post's GraphQL story had no `message.text`
  and the scraper walked the whole document for longest
  `<div dir="auto">`. Same `pickFocalScope` scoping applied.
- **Facebook screenshot captured a 680×80 sliver** because
  `pickScreenshotTarget` walked up from a thumbnail-strip image
  that passed the 200px floor. Floor raised to 400px; falls back
  to the whole post container when no large media qualifies.
- **Facebook title with embedded newlines** split into two link-lines
  in the reader because the 80-char truncation landed mid-paragraph.
  `truncate` now collapses whitespace and cuts at word boundaries.

- **Phase 8c — Instagram handler** (`src/shared/platforms/instagram.js`).
  Recognizes `instagram.com/p/<id>/`, `/reel/<id>/`, `/tv/<id>/`,
  and the `/<user>/p/<id>/` and `/<user>/reel/<id>/` variants.
  Capture path: Open Graph + Twitter Card meta tags as the
  load-bearing data source (server-rendered, stable contract),
  defensive DOM scrape for fields meta doesn't cover (post date
  via `<time datetime>`, verified-account flag via `aria-label`),
  and the Phase 8a evidence layer (HTML snapshot + screenshot).
  Reader gets an Instagram header with author handle (verified ✓
  when applicable), engagement counts, post-kind chip
  (`post`/`reel`/`igtv`), and an `extractedFrom` provenance chip.
- **Phase 8b — TikTok handler** (`src/shared/platforms/tiktok.js`).
  First hard-tier platform shipped. Recognizes
  `tiktok.com/@<user>/video/<id>` URLs. Three-layer capture model
  in production: structured extraction from
  `__UNIVERSAL_DATA_FOR_REHYDRATION__` / `SIGI_STATE` /
  `__NEXT_DATA__` (defensive across all three SSR shapes) +
  bounded HTML snapshot of the video container + element-cropped
  screenshot. Reader gets a video-shaped header with author chip
  (verified ✓ when applicable), play/like/comment/share counts,
  music attribution, an `sourceShape` provenance chip, and an
  inline collapsible "📸 Screenshot evidence" panel.
- **Phase 8a — Anti-obfuscation infrastructure** for upcoming
  hard-tier platform handlers (FB/IG/TikTok). Three standalone
  modules, all tested, none wired to a platform yet:
  - `src/shared/html-snapshot.js` — bounded sanitized `outerHTML`
    extractor (strips `<script>`, `on*` handlers, data: URLs,
    iframes; truncates to a byte cap with a marker; SHA-256 helper).
  - `src/shared/screenshot.js` + background-side handler — element-
    cropped screenshots via `chrome.tabs.captureVisibleTab` + an
    OffscreenCanvas crop. Pure crop-math helper covered by unit
    tests across DPR 1/1.5/2 + viewport-clamp edges.
  - `src/page/api-interceptor.js` — MAIN-world `fetch` + XHR hook
    that captures responses to URL/header-pattern matches and posts
    them back to the content script. Bundled to
    `dist/api-interceptor.bundle.js` for on-demand injection via
    `chrome.scripting.executeScript`. Pattern matcher extracted to
    `src/shared/api-pattern.js` for unit-testability.
- **Article-shape evidence layer** — new optional `article.evidence`
  field carries `{ screenshot, screenshotHash, screenshotUrl,
  htmlSnapshot, htmlSnapshotHash }`. Event builder surfaces the
  hashes/URL as event tags (`screenshot_sha256`, `screenshot_url`,
  `html_snapshot_sha256`); archive-reader inverse rehydrates them.
  Bodies stay in event content; tags carry verifiable refs.
- 30 new tests (`html-snapshot`, `screenshot` crop math,
  `api-pattern`) bringing total to 126 (up from 96).

## [0.3.0] — 2026-04-23

### Added

- **Real toolbar icons** — purple-on-purple X-Ray scan-lens
  treatment replaces the plain placeholder X. Source SVG at
  `icons/source.svg`; rasterize with `npm run icons`.
- **Release pipeline** — `CHANGELOG.md`, `npm run version:set` for
  lockstep `package.json`/`manifest.json` bumps, `.github/workflows/release.yml`
  fires on `v*` tag push and creates a GitHub Release with the
  packaged `.zip` attached.
- **Test coverage for the wire-protocol surface** — new tests for
  `Utils.normalizeUrl`, `EventBuilder.buildRelayListEvent` /
  `buildEntitySyncEvent`, `normalizeRelayUrl`,
  `deserializeEntityFromSync`'s schema tolerance, and the full
  userscript migration round-trip (96 tests total, up from 67).
- **YouTube Shorts capture** — FAB now recognizes `youtube.com/shorts/<id>`
  URLs. Captures produce metadata-rich artifacts (thumbnail, channel,
  duration, view count, video id) with a `SHORT` chip in the reader
  header. Outbound events get an `is_short` tag.
- **Userscript migration importer** — Options page gains a "Migrate"
  tab that ingests a JSON blob exported from the
  `nostr-article-capture` userscript's storage. Handles
  `user_identity`, `entity_registry`, `relay_config`,
  `article_claims`, `evidence_links` with schema normalization
  (`privkey`/`privateKey`, 16-/64-char entity ids).
- **Native OS notifications for publish** — long-running publish
  flows now fire `chrome.notifications` so completion is visible
  even when the user has tabbed away from the reader.
- **NIP-65 relay-list sync** — Push publishes a kind-10002 event with
  the device's relay list; Pull discovers it on other devices and
  offers a one-click "Add to my list" prompt.
- **Archive banner sensitivity setting** — Options → Advanced exposes
  a three-way preference (Always / Only when richer / Never) for the
  Phase 7 archive-reader banner. Default is Always (any non-identical
  archived copy surfaces).
- **NIP-04 read fallback** in entity sync — pull path now decrypts
  legacy NIP-04 events from the userscript era alongside NIP-44 v2.
- **Per-relay + per-format pull diagnostics** — sync log shows
  received counts per relay and a `Format split: N NIP-44, M NIP-04`
  line.
- **Firefox sidebar support** — `sidebar_action` manifest entry plus
  feature-tested opener that prefers `browser.sidebarAction.toggle()`
  on Firefox, then `chrome.sidePanel.open()` on Chrome/Edge.
- **Engineering journal** — `docs/JOURNAL.md` is now the chronological
  log of bugs, design decisions, and external platform changes.
- **Smoke test checklist** — `docs/SMOKE_TEST.md` codifies the
  ~20-min manual pre-release sweep across Phases 0–7, with an
  agent-runnable subset called out.

### Changed

- **Entity-sync deserializer** accepts both userscript and X-Ray
  payload shapes, normalizing on input. Previously rejected
  userscript-pushed entities with `Malformed`.
- **Sync log layout** has a max-height with internal scroll so verbose
  pulls don't push the rest of the side panel out of view.
- **NIP-78 sync filter** now uses raw URL normalization (lowercase
  scheme/host, trailing-slash strip) when comparing remote-vs-local
  relay lists, eliminating spurious "missing" matches.

### Fixed

- **Popup signing-state badge** now reflects reality — content script
  writes `xr_signing_state` to `chrome.storage.local` after NIP-07
  detection. Previously always showed "not detected".
- **Twitter focal-tweet detection** broadened past
  `data-testid="tweet"` to handle the tweetDetail container; URL/id
  backfill from `<a href*="/status/">` anchors.
- **YouTube transcript dedup** — visible cues that YouTube renders
  3× in the DOM no longer triple in the published markdown.
- **Archive banner over-firing** on short-form captures (single
  tweets) suppressed via threshold check.
- **Sidepanel CSS view-toggle** — `[hidden]` attribute now honored,
  so the inactive view actually disappears instead of overlapping
  the active one.

### Removed

- Forward-looking references to the (separate) Keystone browser
  project from the README. X-Ray and Keystone are independent.

## [0.2.0] — 2026-04-19

Initial public extension version. Phase 0–7 of the v4.2 parity
roadmap landed:

- **Phase 0** — esbuild bundling, ES modules, MV3 manifest, MAIN-world
  / ISOLATED-world content-script split.
- **Phase 1** — secp256k1 / BIP-340 / bech32 / NIP-44 v2 in
  `src/shared/crypto.js`, verified against test vectors.
- **Phase 2** — Mozilla Readability + Turndown article extraction;
  NIP-23 (kind 30023) publish flow.
- **Phase 3** — Substack, YouTube, Twitter/X handlers + generic
  comment extractor.
- **Phase 4** — Entity model, per-entity keypairs, reader
  text-selection tagger, kind-0 profile publishing, side-panel entity
  browser.
- **Phase 5** — Claim model, reader claim extractor, kind-30040
  claims, kind-32125 entity relationships, kind-30043 evidence links,
  "view others' claims" via relay query.
- **Phase 6** — Entity sync over NIP-78 (kind 30078) with NIP-44 v2
  encrypt-to-self.
- **Phase 7** — Archive reader: IndexedDB cache, paywall detection,
  relay-backed reconstruction.

[Unreleased]: https://github.com/bryanmatthewsimonson/xray/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/bryanmatthewsimonson/xray/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/bryanmatthewsimonson/xray/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/bryanmatthewsimonson/xray/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/bryanmatthewsimonson/xray/releases/tag/v0.2.0

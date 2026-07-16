# Changelog

All notable changes to X-Ray. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Sections per release: **Added** (new features), **Changed**
(behavior changes for existing features), **Fixed** (bug fixes),
**Removed**.

## [Unreleased]

### Added

- **Phase 24.2 — creator binding on the wire.** Entity identities are
  now provably the creator's: a **kind-30069 OwnedKeys manifest**
  (primary-signed, replaceable — revocation is republish-without-the-
  key) lists every owned entity pubkey and publishes automatically with
  entity batches (fingerprint-gated); entity-signed events (kind 0 /
  30067) gain a `['p', creator, '', 'creator']` backlink and a
  **NIP-26-format `delegation` tag** minted by the primary (Local mode)
  — the strongest self-contained proof, verified by X-Ray itself with
  fail-closed condition checking (kind whitelist + created_at window).
  The portal badges entities **✓ creator-bound** (manifest + token) or
  **◐ partially bound** (one of the two). **Wire:** new kind 30069 +
  two additive tags on entity events — existing consumers unaffected.
  `docs/NIP_DRAFT.md` §"Kind 30069" + §"creator binding".

- **Phase 24.1 — durable entity keys (deterministic derivation).** New
  entity keypairs are now **derived from the primary identity**
  (HKDF-SHA256, domain `xray-entity-v1`, info = the entity id, mod n) —
  same primary + same entity ⇒ the same pubkey, forever. A lost or
  reset keystore is recoverable: `EntityModel.restoreDerivedKeys()`
  re-derives every missing owned key (derived-era entities get their
  original pubkey back; legacy random keys re-derive to a new one,
  reported honestly). Existing random keys stay valid — the stored key
  always wins, no forced migration. The full NIP-26 tradeoff analysis
  and the layered design (derivation + owned-keys manifest + NIP-26
  token + honest kind-0) live in `docs/ENTITY_IDENTITY_DESIGN.md`; the
  binding wire (kind 30069 + delegation tags) is the next slice. No
  wire change in this slice.

- **Phase 23.2 — publish the corpus analysis.** The Phase-20 corpus
  synthesis (summary / opposing positions / cruxes / load-bearing claims
  / gaps) can now be **published to NOSTR** from the case dashboard's
  "Publish brief…" button, so a stranger with only a keypair can read
  the insights. Two artifacts, user-signed and cross-linked: a
  **readable kind-30023 long-form article** (readable in any NOSTR
  client — the "article that shows the insights") and a **structured
  kind-30068 `CaseBrief`** event (rendered richly in X-Ray). Both are
  prose/data only — **no fused score, no verdict** (the Phase-20 firewall
  carried onto the wire, guard-tested), and the reviewer-facing
  `proposals` never publish. The portal reads both back into a new
  **Briefs** tab with an inspector summary. **Wire:** new addressable
  kind **30068** (additive; existing consumers unaffected).
  `docs/NIP_DRAFT.md` §"Kind 30068 — CaseBrief".

- **Phase 23.1b — per-link evidence role (citation intent).** Each
  outbound link in a capture can be tagged with WHY the article cites it
  — `evidence` (the primary source relied on), `mention`, `supports`,
  `disputes`, or `reviews` — from the reader's Media & source dialog. A
  lay-relabelled CiTO subset. This is what marks a debater's article as
  *disputing* the primary paper vs. *citing it as evidence*; combined
  with the target's `source-type`, it's a visible secondary→primary
  derivation edge. The portal inspector lists a capture's roled "cited
  sources." **Wire (additive, kind 30023):** an optional 4th positional
  on the existing `link` tag, whitelisted both directions — no new kind.
  `docs/NIP_DRAFT.md` §"`link` tag".

- **Phase 23.1 — source-type provenance (evidence classification).** Any
  capture can now be declared a `primary-record` / `primary-research` /
  `reporting` / `analysis` / `reference` source from the reader's **🎙
  Media & source** dialog — auto-suggested from scholarly identifiers
  and schema.org type, confirmed by the user. Distinguishes an
  originating primary source (e.g. the *Proximal Origins* paper) from a
  write-up that cites it. Grounded in the library primary/secondary/
  tertiary distinction + the epistemic-audit source taxonomy. The portal
  shows a primary-source badge. **Wire (additive, kind 30023):** one new
  `['source-type', <value>]` tag, whitelisted both directions, distinct
  from `content_format`/`media` and from the verdict `tier` ladder — no
  new kind. `docs/NIP_DRAFT.md` §"source-type".

- **Phase 22 — URL-first media metadata + reader transcript attach
  (22.1–22.2).** The URL is the episode's identity: capture a podcast
  episode's page (Spotify, Apple, Substack, YouTube, a custom site) like
  any page, then the reader's **🎙 Media…** button declares what the URL
  contains (podcast / video — user-declared, never inferred), sets the
  universal podcast IDs, and attaches a pasted/uploaded transcript as a
  `## Transcript` section upserted into the captured body (bounded
  replace on re-attach; YouTube's own suffixed transcript sections are
  never touched). The body change re-hashes honestly (prior version
  snapshotted); metadata-only saves never touch the hash; the
  speaker→claim prefill now works on any article carrying
  `transcript_meta`. **Wire (additive, kind 30023):** one new
  `['media', 'podcast'|'video']` tag, whitelisted both directions —
  no new kind, existing consumers unaffected. `docs/NIP_DRAFT.md`
  §"`media` tag". The Phase 21 portal import remains as the no-URL
  fallback.

- **Phase 21 — podcast transcript import (21.1–21.3).** Paste or upload a
  podcast transcript (SRT, WebVTT with `<v>` voice tags, or `Speaker:`
  lines) from the portal — library header or a case view — and it becomes
  an ordinary archive record: a speaker-labeled markdown body, a
  `contentType:'transcript'` / `platform:'podcast'` article, and (when the
  user supplies them) universal podcast identifiers. It joins cases via
  the 20.2 picker and feeds 20.4 corpus synthesis untouched; selecting a
  turn prefills "who said it" with that turn's speaker. **Wire (additive,
  kind 30023):** new `show` / `podcast_guid` / `podcast_episode_guid` /
  `feed_url` / `itunes_id` tags with NIP-73 `i` co-emits
  (`podcast:guid:…`, `podcast:item:guid:…`), a `feed_url` second-`r`, and
  a `transcript_meta` (`<format>:<turns>:<speakers>`) manifest — bodies
  live in content, and all round-trip through `reconstructArticleFromEvent`.
  No new kind. `docs/NIP_DRAFT.md` §"podcast identity tags".

### Fixed

- **LLM-suggested claims on transcripts now identify the turn speaker
  (22.3).** Accepting a ✨ Suggest… claim (or 19.6 fact) on a transcript
  used to default "who said it" to the article byline. The accept path
  now locates the claim's grounded quote in the rendered body, reads its
  enclosing paragraph, and resolves the turn's `Speaker:` label exactly
  like the manual Add-claim path — an existing person entity when one
  matches, else the parsed name as free text (no entity is minted by
  bulk accept). The epistemic-audit "Atomize as claim…" prefill gets the
  same treatment. Non-transcript articles are unchanged.

- **Case-synthesis proposals now reference real claims (20.6).** The
  reduce stage was never handed the corpus's claim-id index, so
  relationship/is_key proposals cited invented ids and were all
  rejected in the "Proposals" block. The dossier digest now carries a
  `claims` index the model must reference; self-links and duplicate
  proposals are filtered out.

### Added

- **Phase 20 — case-first: making a case corpus usable (20.1–20.4).**
  Driven from the live COVID/Rootclaim corpus. **Union membership** — a
  case includes an article that is tagged with the case entity OR
  referenced by a claim; tag-only articles are now first-class sources
  everywhere (the portal case view stopped reading "0 sources"), with a
  processed/unprocessed distinction and an "extract claims" nudge.
  **Add-to-case outside the reader** (`case-membership.js`) — an "Add
  sources…" picker on the portal case view and the side-panel case
  detail tags archived articles into a case (local-only, republish hint
  on published records) with a "✕ remove" affordance. **Local case
  entity graph** (`case-graph.js` + `case-graph-view.js`) — the case at
  center, its member articles, tagged/claimed entities, co-tag
  adjacency, and the contradiction edges the dossier's knots compute;
  the spokes-graph empty state routes to the case dashboard. **LLM
  corpus synthesis** behind the new `caseSynthesis` flag (+ `llmAssist`
  + key, default off) — a map/reduce over the member articles that
  drafts a grounded case brief (summary, positions, cruxes of
  disagreement side by side, load-bearing claims, coverage gaps) plus
  reviewable cross-article proposals; every quote is machine-grounded,
  there is no fused score or verdict, and the brief is stored in the
  precious `xray-audits` DB (v2 `case-briefs` store, export-included)
  and carried in the case export. No new wire kind — proposals
  materialize as ordinary 30040/30055 on accept.
  `docs/CASE_SYNTHESIS_DESIGN.md`.
- **Phase 19 — entity dossiers, end to end (19.2–19.8).** The
  provenance-pinned knowledge base: facts ride claims (additive kind-30040
  `fact`/`valid_from`/`valid_to`/`observed_at` tags, band-precision ISO
  dates, `parseClaimEvent` read-back); the computed-on-read
  `entity-dossier.js` assembler over the alias family (unknown-by-default
  field table, contested-never-resolves, judgments routed to the
  integrity record — no score anywhere, string-guard tested); the portal
  dossier view + side-panel compact table with evidence click-through;
  the reader "📇 Add fact" flow with honest-precision date inputs and an
  inform-never-block conflict pre-flight; the case scope editor
  (authored framing — side panel, case export, portal case header, and
  per-member "dossier →" links); LLM fact extraction (`kind:'fact'`,
  default OFF, quote-grounded, "never supply a value from your own
  knowledge"); and — behind the new `entityCorpusPublishing` flag
  (default off, full disclosure) — enriched kind-0 profiles
  (published-claim facts only, contested fields omitted, "per <source>"
  attribution) plus the **new kind-30067 entity fact sheet** (contested
  fields both sides, every fact `a`-referencing its published claim),
  with hash-gated automatic republish and a manual portal republish.
- **Phase 17 Part A — entity health + canonical sweep (E1+E3).** The
  deterministic duplicate report (name / shared-account / co-mention
  detectors, sidepanel Merge…/Not-duplicates/Unlink over the alias
  machinery, dismissals in `entity_dedupe_dismissals`) and canonical
  resolution at every publish/tag/suggest call site — claims about
  aliased entities now p-tag the canonical identity (the alias kind-0
  `refers_to` is the forwarding pointer); `findEntityMatches` offers
  canonical records deduped by root.
- **Phase 19.1 — entity-dossier groundwork (internal; no UI, no wire
  change).** The pure foundations of the knowledge-base layer: typed
  per-entity-type field registries (`entity-field-schemas.js` —
  person/organization/place/thing/case rows with value types,
  multiplicity, evolution, date precision, `custom:<token>` fields;
  case fields are the only *authored* class), the fact-layer
  validation + conflict machinery (`entity-facts.js` — `cleanFact`,
  precision-band date agreement, conflicts always name both claims
  and never pick a winner, dismissals stored under
  `entity_fact_dismissals` and cleared with the workspace), shared
  honest-precision date helpers (`dossier-time.js`, extracted
  behavior-unchanged from the case dossier), and `authored_fields` on
  `EntityModel.update` (the user's own case framing — scope/status —
  which never rides claims). Claim wiring and the additive 30040 fact
  tags land in 19.2.

- **Claims default their asserter to the article's author,
  entity-first.** "Who said it" now opens in entity mode in every
  claim flow (free text stays as the fallback radio) and defaults to
  the article's author: an exact-name match preselects the existing
  entity (capture from the W.H.O. origins paper → W.H.O. is the
  speaker unless you override); an unknown author prefills the picker
  search with a one-click **"New as: 👤 🏢 📍 🔷 🗂️"** create row (the
  type is always a human choice — entity ids derive from type+name,
  so a wrong guess would be permanent). The same create row now lives
  in the About picker too, replacing the "tag an entity from the
  article body first" dead end. Claims accepted from LLM suggestions
  also default their source to the author entity when it already
  exists (bulk accept never creates entities). New
  `findEntityByName(name)` exact-name registry lookup
  (entity-model.js). No wire change — entity sources already emit
  `['p', pk, '', 'source']` + `['source', name]`, and the publish
  batch already swept source entities into the profile publish.

- **Phase 19 design: entity dossiers & the provenance-pinned knowledge
  base.** `docs/ENTITY_DOSSIER_DESIGN.md` (design only, implementation
  post-Epistack): typed per-entity-type field schemas with validity
  intervals and date precision; facts as claims (every biographical
  value pinned to a verbatim quote in a captured source — no external
  LLM knowledge, no unsourced values); a computed-on-read per-entity
  dossier assembler sharing the case-dossier builders; kind-0 profiles
  assembled from published facts only (contested fields omitted); and
  a planned kind-30067 entity fact sheet where every fact references
  its published claim event. ROADMAP gains the Phase 19 section (and
  the status snapshot catches up on Phases 17/18).

- **URL aliases — one identity across mirror addresses.** A persisted
  alias map (`url_aliases`) now records every learned
  mirror-address → original pairing (structural recovery at capture,
  relay read-backs, manual sets) and heals the URL-keyed joins:
  claims, the prior-capture lookup, and the archive banner all resolve
  through it, so work done under `archive.ph/…` and a later direct
  capture of the original converge instead of forking. The reader
  gains **"Set original URL…"** on the capture note (and the URL
  header field now routes through the same flow) — the universal
  fallback for any alias-serving site. The structural resolver's
  mirror registry also learns four new families: **Google cache**
  (`webcache.googleusercontent.com/search?q=cache:…`), **12ft.io**
  (`/proxy?q=` and path forms), **AMP caches**
  (`*.cdn.ampproject.org/c/…`, cache viewer params dropped), and
  **ghostarchive** (`/varchive/<id>` → the YouTube URL; opaque
  snapshots stay honestly unrecovered) — with nested wrappers
  unwrapped (wayback-of-12ft-of-X keys to X) and mirror hosts never
  adoptable as "the original". Fresh workspace clears the alias map;
  backups carry it. No wire change.

- **Full backup & restore + signed-events bundle export.** Settings ▸
  Advanced gains a "Full backup" block. **Download full backup** writes
  one JSON file (`xray-backup/1`) covering everything the extension
  stores locally: all settings/flags/identities (including private
  keys — treat the file like an nsec; the LLM API key is the one thing
  **never** included), the captured article archive with its metadata
  stores and prior versions, original source-document bytes (PDFs —
  base64, behind a default-ON checkbox with a size estimate), audit
  records, and the signed-event journal. **Restore from backup…**
  replaces everything with the file's contents after typed
  confirmation, downloading a safety backup of the current state
  first; the live LLM key is preserved. **Export signed-events
  bundle** writes the journal as raw signed JSON
  (`xray-events-bundle/1`) — replayable by anyone against any relay,
  so a published corpus survives a relay outage. A fresh workspace now
  also clears the `xray-events` journal. No wire change.

- **Signed-event journal + republish.** Every event X-Ray publishes is
  now stored VERBATIM (full signed JSON + per-relay outcome snapshot)
  in a new IndexedDB journal (`xray-events`) — across the reader's
  whole publish flow and the side panel's entity-sync/relay-list
  pushes. The portal's reconcile panel gains **Rebroadcast** on
  "missing from relays" rows (re-sends the journaled event as-is — no
  re-signing, no NIP-07 prompt) plus "Rebroadcast all missing", and
  the never-published bucket is now **itemized** ("Unpublished local
  artifacts" — every local claim/assessment/entity/article/verdict/…
  with no publish mark, with its open-in-reader route) instead of a
  bare count. Publish ledgers are now honest: an event only marks
  published on a **confirmed** relay OK — an 8-second timeout is no
  longer assumed success (those events stay unmarked, retry on the
  next publish, and the summary reports them as unconfirmed). The
  article's own archive-row publish mark is awaited instead of
  fire-and-forget. No wire change.

- **User guide.** `docs/USER_GUIDE.md` is a complete, feature-by-feature
  walkthrough for people who use X-Ray rather than build it: setup
  (signing, relays, the LLM key, the full feature-flag table),
  capturing (triggers, provenance chips, archive/mirror URL identity,
  citations), the reader (view modes, entity tagging, claims, the icon
  legend), and — the heart of it — the judgment vocabulary with concrete
  examples for every value: the assessment stances/labels, claim
  relationships, attestation tiers and convergence, the six proposition
  classes (with the state-fact vs event-fact distinction spelled out),
  the five verdict states, standards of proof, integrity match states
  and gap causes, the eight audit dimensions with bands and the
  display rules, the forensic maneuver families, and the moral-lens
  dispositions. Linked from the README.

- **Outbound links are captured as citations.** Article extraction now
  records every hyperlink in the body as structured data
  (`article.links`: normalized URL, first anchor text, occurrence
  count, internal/external, capped at 100 distinct targets with an
  honest truncation marker). **Wire change, additive** (documented in
  `docs/NIP_DRAFT.md`): published kind-30023 events carry one `cites`
  tag per distinct external link — linkage only, never endorsement
  (that stays `responds-to`) — plus indexed `r` co-emits for the first
  25 targets so the edge is queryable from the cited side; the first
  `r` remains the article's own URL. Read-back distinguishes "links
  not captured" (pre-extension events → `null`) from "zero links". The
  case dossier derives both sides (`deriveCitationEdges`) and the
  portal evidence table shows "cites N external sources · cited by M
  case articles". Archive captures unwrap archive-wrapped body links
  to their originals before publishing (a Wayback page's rewritten
  anchors would otherwise all classify internal and emit zero `cites`).
  Not yet extracted: PDF bodies and the platform synthesizers
  (YouTube/Twitter/FB/IG/TikTok).

- **Archive captures re-key to their original URL.** Capturing from an
  archive.today mirror, a Wayback Machine snapshot, or an arXiv
  rendering variant (`/pdf/`, `/html/`, ar5iv) now recovers the
  ORIGINAL URL and makes it the article's identity — same `d` tag,
  same `#r` bucket as a direct capture, so claims, assessments, and
  audits on mirrored text no longer fork per mirror. The fetched
  address is kept as provenance: a reader note ("captured via
  archive.ph · original: …") and — **wire change, additive** — a new
  kind-30023 `capture-url` tag with an indexed `r` co-emit after the
  primary `r` (documented in `docs/NIP_DRAFT.md`; readers keep taking
  the FIRST `r` as the article URL). Recovery is fail-open: when the
  original can't be verified from the archive URL's structure or the
  archive page's own markers, the capture keys to the address actually
  fetched and says "original URL not recovered" rather than guessing.

- **Case dossier — the assembled view of a case (CD.1–CD.3).** A case
  entity's portal dashboard gains three derived, computed-on-read
  surfaces over everything in the case's orbit. `assembleCaseDossier`
  (`shared/case-dossier.js`) is the pure spine — same events in, same
  dossier out — composing the shipped models into five sections: the
  **shape-of-knowledge** header (the verdict-state *distribution* over
  the case's propositions, coverage counts on its face, standards-of-
  proof chips, and the open/resolved prediction tally — never a fused
  case score); **knots** (contradiction clusters as connected
  components, words-vs-deeds integrity findings, forensic maneuvers);
  a **four-axis timeline** (a world-time spine with precision bands —
  a year-precision event is a year-wide band, never a fake date — plus
  publication / capture / judgment overlays on one shared scale, the
  undated tail kept and counted, and gap callouts for
  published-before-occurred / capture-long-after-publication /
  story-changed-after-event); the **convergence-collapsed evidence**
  table (twelve outlets on one wire count as one origin, per-source
  capture-completeness and the shared audit band, verbatim quotes); and
  **entities × roles** routing to the existing coverage-capped entity
  record. Disagreement renders side by side, never merged. The portal
  case view renders the shape / evidence / timeline sections (CD.2/CD.3)
  beside the existing audit-dossier and forensic blocks and alongside —
  not replacing — the wire publish-density strip. **Wire note (none,
  deliberately):** the dossier is derived and computed-on-read — no new
  event kind, nothing published, nothing persisted; anyone with the
  same events derives the same dossier. (`docs/CASE_DOSSIER_DESIGN.md`;
  `docs/NIP_DRAFT.md` now also documents the already-emitted kind
  `32125` entity↔article relationship it reads.)

- **Moral lens — per-jurisdiction lens-readings (Phase 16, 16.1–16.4).**
  The reader gains an opt-in **Lens readings** bar (new `moralLens` flag,
  default off, independent of LLM assist; the Anthropic key is a second
  consent gate) that reconstructs how named perspectives —
  **jurisdictions** you author yourself in a local registry (`codified`
  legal codes / `worldview` traditions / `persona` author corpora; zero
  ship built-in) — would read selected claims, grounded ONLY in each
  jurisdiction's loaded corpus of cited authorities. It answers "how
  would perspective J read this, on what authority?" and never "is this
  true": factual assertions are deferred to the truth layer (a
  descriptive corpus stance + a 🏛 route into the adjudicate modal,
  never a disposition — schema-enforced), a living-person persona reads
  published positions only (absent living bit fails closed; refusal
  happens in code before any network call), every confidence chip
  carries the fidelity-not-truth note, and the panel disclosure flags
  one-sided lens selection. One bounded API call per empaneled
  jurisdiction, with a call-count cost confirm. **Wire note (none,
  deliberately):** lens-readings are a derived view — session-cached per
  capture, zero durable writes, nothing published; kind `30066` stays
  free, and 16.4 guard tests machine-check both properties.

- **PDF figures are now captured (Phase 18 C4.2).** Earlier PDF capture
  extracted only the text layer, dropping every image — a real loss for
  papers and reports where the figure *is* the evidence. `pdf-capture.js`
  now walks each page's operator list tracking the transform stack,
  decodes every displayed image, and archives the survivors as PNGs in
  the `source_documents` store, content-addressed by sha256. Each figure
  is placed into the reading-order markdown by its position on the page,
  captioned from the nearest `Figure/Table/…`-shaped line just below it
  (else `Figure (page N)`), and rendered from a blob URL when the reader
  opens. Guards keep it honest: a minimum displayed size and pixel count
  skip rules and decorations, an identical image repeating on ≥3 pages is
  treated as furniture (logos/watermarks) and dropped, and a per-document
  cap bounds pathological files. A page whose only content is a captured
  figure is no longer flagged `sparse-pages` — its content *was* captured,
  just not as text. **Wire note (additive):** published `30023` markdown
  from a figure-bearing PDF may now contain content-addressed image
  references of the form `![alt](xray-figure:<sha256>)`. These resolve
  against the local `source_documents` archive; a consumer without the
  archived bytes should treat an unresolved `xray-figure:` URI as a
  placeholder (the alt text is the fallback), exactly as it would any
  missing image. No new tag kinds; no change to existing tags. Not done:
  OCR of text inside figures, and vector-drawn charts (path ops, no image
  XObject) — those remain a gap (`COMPLEX_CONTENT_DESIGN.md` §9 Q6).

### Changed

- **Reader "📇 Add fact" button is now behind a Settings flag**
  (`readerAddFact`, default OFF). The structured-fact capture row in the
  text-selection popover was crowding the common capture flow, so it is
  hidden until enabled at Options → Advanced → Reader → *Show "Add fact"
  in the reader selection menu*. Purely a UI-visibility gate — the fact
  modal, records, additive 30040 fact tags, and dossier assembly are
  unchanged; toggling the flag on restores the exact prior behavior.

- **Outbound-link tag renamed `cites` → `link`** (wire change,
  pre-release). The kind-30023 extension tag for external hyperlinks
  in the captured body now emits as `["link", url, anchorText?]` —
  "citation" overstated the semantics (the tag asserts a hyperlink,
  not a scholarly citation). Read-back dual-reads `link` then legacy
  `cites` (same positions), so the handful of events published in the
  brief `cites` window still reconstruct. Ripples: the case dossier's
  edge derivation is now `deriveLinkEdges` returning `links`/
  `linked_by` (per-article dossier sub-object `links` with
  `corpus_links`/`linked_by`), and the portal evidence table reads
  "links to N external sources · linked from M case articles". The
  truth layer's *precedent citations* and the moral lens's
  bibliographic `citation` records are unrelated vocabularies and are
  unchanged.

- **One URL normalizer everywhere.** Article identity
  (`ContentExtractor.normalizeUrl`, which feeds 30023 `d` tags) now
  delegates to the NIP-73 normalizer that already keyed every
  downstream join, with the legacy-only tracking params (`mkt_tok`,
  `oly_*`, `vero_id`, `wickedid`, `spm`, `share_source`, `from`, …)
  merged into the unified strip list. Query params now sort and
  non-text-fragment anchors strip in article identity too.
  **Consequence:** captures of URLs whose params sort or now strip
  derive different `d` tags than pre-unification captures of the same
  page — a republish is a new addressable event; the portal reconcile
  view absorbs the seam (JOURNAL 2026-07-09).

### Fixed

- **Verdict and integrity-finding evidence is now cited, not typed**
  (TRUTH_ADJUDICATION_DESIGN amendment §5.5a). Evidence rows in the
  adjudicate and integrity modals are no longer free-text: each entry
  cites a captured claim/quote picked from the cross-article pool
  (all local claims plus assessed-foreign snapshots), rendered
  speaker-first ("W.H.O. — “…”"); the row's verbatim quote, source
  URL, and — once the claim publishes — its 30040 coordinate all
  derive from the linked artifact, and the only typed fields are the
  evidence tier and an optional why-note. Previously both modals
  captured only free-text quotes, so every published 30063/30064
  shipped evidence a reader could not follow — red line 5 ("no verdict
  the reader cannot re-derive") unmet despite the model, wire format,
  and publish mapper all having the fields. Evidence not yet captured
  is captured first (select its text in the source article — the new
  "❝ Quote" shortcut on the selection popover opens the claim form
  quote-framed, speaker picker first). Unpublished linked claims are
  omitted from the wire until they publish (the ruling still ships);
  pre-amendment quote-only records still read, render, and republish.
  The portal inspector now renders evidence URLs as links and claim
  coordinates as copyable chips. **No wire-format change** — the
  existing tag slots now populate. Entities tagged on a capture
  (manually or via accepted LLM suggestions) vanished when the article
  was reopened from the local archive: the load-time cache save wrote
  the fresh article's empty entity list over the archive row, "Load
  archive" deliberately discarded the archived copy's refs, and tagging
  itself never persisted until publish. Now: reloads rehydrate tags
  from the archive row (before the save that used to clobber them),
  every tag triggers a debounced archive save so tag-without-publish
  survives closing the reader, the archive banner's "Load archive"
  merges instead of dropping, and the portal's "Open in reader" rebuilds
  entity refs from the published event's own name tags (the
  deterministic entity-id derivation makes wire refs join local
  registry records exactly). Read-only portal opens still never write
  the archive row. No wire change.

- **Thorough (and sometimes quick) audit results no longer vanish after
  the LLM run.** Both in-reader audit modes rode one long-lived
  `xray:audit:run` message whose response arrived minutes later — MV3
  service-worker eviction killed the response channel and the paid-for
  results were never persisted or displayed. Thorough mode now runs
  **one message per module** (`xray:audit:module`, orchestrated
  reader-side at concurrency 3 with one auto-retry on 429/5xx/timeout
  and a live "N/8" progress counter); every completed module is
  draft-persisted immediately, and an interrupted run offers **resume**
  that re-runs only the missing modules. Quick mode gains a keepalive
  ping plus paired timeouts (SW 300s / reader 330s) so the button can
  never stick on "Auditing…". Also unified the audit hash key: PDFs now
  key runs to the reconstruction the panel queries (runs used to
  persist under a different hash — success toast, empty panel), and
  over-limit articles are sliced to the 120k auditable bound BEFORE
  hashing, with the truncation disclosed pre-spend and labeled in the
  panel. In-reader runs record provenance `background` (previously
  mislabeled `cli-import`). No wire change — internal messages and
  local persistence only.

- **PDF tables reconstruct row-by-row instead of scrambling.** An
  aligned grid (a Bayesian evidence table, a results table) was read
  column-by-column — every row label collapsed into one paragraph and
  the value columns spilled out as a row-offset diagonal, destroying
  the link between a row and its values. The layout engine now detects
  an aligned grid (a baseline carrying 3+ cell-segments, which
  two-column prose never reaches) and reads it row-by-row, joining each
  row's cells with a middle dot; prose around an embedded table still
  flows normally. Two-column label/value tables and pretty pipe-table
  rendering remain out of scope (the dot-joined row is quotable, not an
  HTML table).

- **Google Drive PDF previews route to the PDF pipeline.** Drive's
  preview is a text/html web app around the document, so it dodged
  both PDF-routing guards: capturing it scraped the viewer chrome
  ("Page 2 of 27" became the article title) and shredded the text
  layer line-per-paragraph. When a `drive.google.com/file/d/…` tab's
  title names a `.pdf`, the capture now routes the document's
  direct-download URL into the PDF pipeline (cookies ride along, so
  files the user can see download; anything else falls back to the
  import picker with the reason).

- **PDF stack, round three: the reader's draft machine and the last
  platform gaps.** Compatibility: `Uint8Array.prototype.toHex` shim —
  pdf.js's worker calls it in the `fingerprints` getter during the
  FIRST step of every document load, so capture was still dead on
  Firefox 128–132 / Chrome ≤139 even with `Promise.try` shimmed; the
  build now also ships pdf.js's runtime assets (`dist/cmaps/`,
  `dist/standard_fonts/`, `dist/wasm/`, `dist/iccs/`, ~4MB) — without
  cMaps a CJK PDF extracted zero text and was falsely refused as "a
  scan", and without wasm JBIG2/JPEG2000 figures could never decode.
  Provenance/reader: unedited PDF publishes now ship the reconstructed
  markdown byte-exact (the draft machine force-round-tripped it
  through turndown, renumbering a filing's "14./15./23." paragraphs
  to "1." on the wire and salting the body with escape backslashes
  that shifted every pageMap anchor; the capture hash now covers the
  same body the publish ships); `markdownToHtml` preserves ordered-
  list start numbers via `<ol start>`; figures survive edit/view
  round-trips (re-hydration now keys on `data-xray-figure`, not the
  revoked blob URL); the post-publish archive row is reader-shaped
  again (it stored markdown in `content`, so "Load archive" rendered
  a published PDF as one garbled escaped line, paired with a stale
  pageMap); loading an archived version invalidates the page-anchor
  grounding index and carries the `extraction` record forward (a
  relay-reconstructed adoption dropped `source_hash`, letting the
  pruner delete the original PDF bytes out from under a live
  article); a failed session-record write (quota) is surfaced at
  capture time instead of as a baffling publish error. Storage:
  archive connections close on `versionchange` (workspace reset no
  longer hangs forever); the `lastAccessed` bump re-reads inside its
  transaction (no more lost-update clobbering of publish metadata);
  re-captures refresh the pruner's grace window; the orphan-prune
  pass is throttled to one run per 10 minutes. Metadata: figure alt
  text is markdown-metacharacter-safe (a caption's backtick could
  swallow the image markup into a code span); hyphenated/long arXiv
  subject classes (`cond-mat.mes-hall/0212413`) match; DOI extraction
  from `doi.org` URLs drops query/fragment; and **direct PDF captures
  now carry URL-derived scholarly identity** (`arxiv.org/pdf/<id>`,
  `doi.org/…` PDFs get `scholar.arxiv_id`/`doi` and the corresponding
  30023 tags — previously only the HTML abs page did). **Behavior
  note:** the canonical `x` of an unedited PDF capture is now the
  hash of the reconstructed markdown itself, not of its turndown
  round trip — previously captured PDFs will show one "content
  changed" banner on their first re-capture (expected supersession,
  same posture as the figure-hash change in #111).

- **PDF capture was dead on Firefox ESR 128–133.** pdf.js 6.x calls
  `Promise.try` (Firefox 134+/Chrome 128+) inside `MessageHandler` —
  the main↔worker RPC that every pdf.js request crosses — so on the
  extension's own declared Firefox 128 floor the very first
  `getDocument` message threw and no PDF could be captured at all.
  `pdf-collection-polyfill.js` (already shimming
  `Map.getOrInsertComputed` and `Math.sumPrecise` for exactly this
  class of problem) now also shims `Promise.try` and
  `Uint8Array.fromBase64`/`toBase64` (Firefox 133+/Chrome 140+; used
  on pdf.js's attachment, signature, and XFA paths), in both the main
  thread and the worker.

- **PDF stack: second adversarial sweep (post-#111).** Capture: pdf.js
  6.x removed `PDFDocumentProxy.destroy()` — the swallow-all catch
  around `doc.destroy()` silently skipped teardown, resurrecting the
  worker-document leak #111 plugged; cleanup now goes through
  `loadingTask.destroy()`. `/Rotate 90/270` pages reconstructed as
  shredded, interleaved text (pdf.js text/operator coordinates are raw
  user space; the rotation lives in the viewport) — text and figure
  coordinates now map through the viewport, which also normalizes
  offset-MediaBox pages. Figures: Chrome's ImageDecoder JPEG path
  hands back a `VideoFrame` (no `width`/`height` — only
  `displayWidth`) and every JPEG photograph figure was silently
  dropped on Chrome; the Form-XObject `/Matrix` arrives as a
  `Float32Array`, so the `Array.isArray` guard had silently disabled
  the #111 form-transform fix; annotation appearance streams (stamps,
  signatures) no longer corrupt the CTM walk or masquerade as page
  figures; 1-bit line art (`GRAYSCALE_1BPP`) decodes instead of being
  dropped; the per-page figure cap now actually bounds decode work,
  PNG bytes are retained for at most 256 distinct figures, and the
  oversize-canvas path no longer falls back to encoder-dependent PNG
  bytes for the content address. Identity/routing: `#page=3`-style
  fragments no longer fork the capture identity (the d-tag hashes the
  raw URL; fragments never reach the server); the content-type sniff
  is bounded by a 5s timeout so a hung server can't stall the toolbar
  click. Layout: lexical hyphens survive letter↔digit line breaks
  (`COVID-19`, `3-year`) and uppercase continuations
  (`Navier-Stokes`); sub/superscripts stay on their visual line
  (`H2O` no longer shreds); a dropcap no longer promotes its body
  line to a heading; wandering margin footnotes (`12 Ibid., at 340.`)
  are no longer eaten as furniture (repeats must hold a fixed
  y-position); header-only pages aren't reported as "content
  missing"; an off-center gutter the column classifier can't resolve
  no longer shreds lines it can't reorder. Storage: the
  source-document pruner keeps figures cited by ANY live article
  (figures dedupe across documents but the row's `pdf-figure:` url
  names only the first parent — evicting that parent's article
  destroyed the figure for everyone else) and keeps the source
  bytes/figures of displaced `priorVersions` snapshots (the 13.4
  "capturing both versions" promise). Scholarly metadata: old-style
  arXiv ids (`hep-th/9901001`) now match from URLs. No wire-format
  changes; a re-capture of an affected PDF (rotated pages,
  hyphen/subscript text, restored figures) yields better markdown and
  therefore a different canonical `x` — expected supersession, not
  stealth-edit.

- **PDF + figures bug sweep (Phase 18 follow-up, 19 fixes).** The big
  four: PDF captures can now actually **publish** (the `?pdf=` path
  never registered a session record and signing proxied to a source
  tab that structurally cannot exist — tabless captures now sign in
  the worker via the Signer façade; NIP-07 gets an actionable error);
  `pdfDocumentUrl` no longer lets `real.pdf?file=<decoy>` capture the
  decoy (direct URLs win; wrapper unwrap requires a viewer-shaped
  shell); a hostile `<constructor>` element inside a table/math island
  no longer kills the whole capture (own-property allowlist lookup);
  and globally-cached pdf.js images (`g_` ids — anything on ≥2 pages)
  resolve from the right store instead of burning an 8s timeout per
  page and blinding the logo-furniture detector. Layout: structural
  narrow-gutter detection (LaTeX 10pt / IEEE 18pt two-column PDFs no
  longer interleave line-by-line), compound/digit/unicode-safe hyphen
  reflow, figures flow through reading order as pseudo-lines (a
  right-column figure no longer lands at char 0), page anchors skip
  textless pages, and margin years in short documents stop being
  eaten as page numbers. Capture: Form-XObject transforms honored
  (wrong CTM + state leak), corner-true bboxes (top-down and rotated
  draws), the scan gate runs before figure work, bytes/figures are
  archived only after success, the figure cap applies post-furniture,
  figures are content-addressed by decoded RGBA pixels instead of
  browser-dependent PNG encoder output (byte-identical PDFs no longer
  fork the canonical `x`), per-page `cleanup()` + `doc.destroy()` and
  blob-URL revocation plug the memory leaks, `%`-bearing filenames no
  longer throw after a finished extraction, and local imports key
  identity on the content hash so two different `report.pdf`s stop
  colliding. Routing/storage: the context-menu capture on a PDF tab
  opens the PDF reader (was: Settings), local `file://` PDFs route to
  the Import picker (previously unreachable), HEAD-rejecting servers
  still sniff as PDFs, the extraction-quality banner stops claiming an
  archive exists when archiving failed, and `pruneSourceOrphans`
  gives the `source_documents` store its first cleanup path.

### Fixed

- **PDF figures (and any operator-list work) on older browsers.** pdf.js
  6.1.200 calls `Map.prototype.getOrInsertComputed` (inside
  `getOperatorList`, among others) and `Math.sumPrecise` unconditionally —
  both are recent TC39 proposals absent from the Firefox 128 floor and
  older Chrome, where `getOperatorList()` threw and figure extraction
  silently produced *zero* figures while the text layer still captured. A
  new `pdf-collection-polyfill.js` shims those methods and is imported
  first by both the engine and worker entries. Verified end-to-end by
  driving the built bundles in headless Chromium against a real
  figure-bearing PDF (0 → 14/15 figures recovered). The image decoder also
  now falls back from a flaky/dimensionless `ImageBitmap` to raw channel
  data.
- **PDF extraction-quality warnings (Phase 18 C4.1).** The layout
  engine now reports when reconstruction degraded instead of
  presenting it as clean: `extraction.warnings` flags `sparse-pages`
  (pages with no text layer inside an otherwise texty document —
  likely scans whose content is missing from the capture) and
  `shredded-text` (runs that never joined into normal lines), and the
  reader banners them with the affected page ranges and a pointer to
  the archived original (`source_hash`). Design notes folded into
  `COMPLEX_CONTENT_DESIGN.md`: the figures/captions gap (§9 Q6) and
  the companion-CLI adoption path for server-class document tooling
  (Docling/GROBID — never in-extension, never hidden).
- **Entities bar** (userscript parity): the reader shows every entity
  tagged on the article as a chip row above the claims bar — icon +
  current registry name + type, with the verbatim mention as the
  tooltip; clicking a chip locates the mention in the body (mark
  pulse, or text selection). Updates live as the manual tagger and
  LLM-suggest accepts add entities.
- **Review-panel ergonomics:** accepting a suggestion no longer
  scrolls the list back to the top (scroll position survives
  re-renders), and each section header gains an **"Accept all
  <kind> (N)"** button so you can take, say, every entity without
  also accepting the claims — counts reflect only rows a click can
  actually accept, and dependency-blocked rows explain themselves.
- **Claims bar shows the quote, and claims click through to the
  article.** Every claim row now displays the verbatim quote it is
  drawn from (the stored `quote`, falling back to the anchor's exact
  for older records; PDF captures add a `p. N` page pill), and
  clicking the quote or the claim text jumps to the passage in the
  body — via the anchor-precise mark (with a pulse) when it resolved,
  else by selecting the stored quote. Mark rehydration is also
  quote-first now: an LLM claim's `text` is a summary that never
  appears in the article, so pre-quote fallbacks silently failed.
- **First-class claim text provenance.** Claims now carry the verbatim
  `quote` they are drawn from (untruncated, auto-populated from the
  grounded span or the manual selection — never typed by the user) and
  the `article_hash` of the exact text version it was located in, plus
  the existing capture timestamp. All three ride the kind-30040 wire as
  additive optional tags (`quote`, `x` — joining the audit family's
  `#x` queries — and `captured_at`), and `parseClaimEvent` reads them
  (and the previously write-only `anchor` tag) back, so a claim that
  round-trips through a relay keeps its full provenance chain.
- **Grounded entity mentions + dedupe at accept.** LLM entity
  proposals now require a machine-checked verbatim `mention` (the
  display name may disambiguate — the mention may not), and accepting
  one tags the article with the grounded span exactly like the manual
  selection tagger, so the publish flow p-tags it and mention
  provenance survives display-name changes. At accept time, proposals
  whose names token-match an existing same-type entity offer **"use
  existing"** (single candidate = default) instead of minting
  near-duplicate ids.
- **Complex content capture (Phase 18, slices C1–C4 + C2).**
  Implements `docs/COMPLEX_CONTENT_DESIGN.md` §4–5:
  - *Tables & math (C1)*: complex tables (rowspan/colspan, nested,
    captions, multi-row headers, block cells) are preserved as
    deterministic, sanitized HTML islands inside the markdown instead
    of being GFM-mangled; KaTeX/MathJax-v2 math recovers the author's
    TeX (`$…$`), MathJax-v3/raw MathML becomes sanitized math islands.
    The renderer re-sanitizes island bodies through the same allowlist
    (foreign markdown fences are never trusted); simple tables keep
    the GFM path.
  - *PDF capture (C3/C4)*: a toolbar click on a PDF tab now routes to
    the reader's PDF path (content scripts can't run in PDF viewers);
    the reader fetches the bytes (with an Import-file fallback),
    archives the original in a new IndexedDB v3 `source_documents`
    store keyed by `sha256(bytes)` (50MB cap), and extracts text with
    a lazily-loaded pdf.js bundle. A pure layout engine reconstructs
    lines/columns/paragraphs (gutter-aware two-column ordering,
    header/footer removal, hyphenation reflow, size-based headings)
    into markdown plus a per-page offset map; claims captured from a
    PDF carry an additive `FragmentSelector` (`page=N`) anchor, and
    the capture records `extraction` provenance
    (`{method, source_hash, page_count}`). Scans without a text layer
    are refused with a pointer to the designed (not yet built) LLM
    transcription tier.
  - *Scholarly metadata (C2)*: every capture now reads standard
    citation meta tags (DOI, arXiv id+version, journal, authors,
    date) into `article.scholar`; published 30023s gain additive
    `doi` + NIP-73 `['i','doi:…']` and `arxiv` tags.
  Remaining from the design: the LLM extraction assist (C5) and the
  ar5iv-preferring arXiv handler.
- **Entity corpus + smart management design**
  (`docs/ENTITY_CORPUS_DESIGN.md`, design-only): deterministic
  duplicate reporting + LLM entity audit over the existing alias
  machinery, and the NOSTR entity-corpus model — entity-signed kind-1
  mention notes, enriched kind-0 profiles with NIP-39 external ids,
  and a wire-first corpus view — gated behind a future
  `entityCorpusPublishing` flag.
- **Grounded provenance for LLM Suggest.** Every quote a suggestion
  stakes provenance on is now machine-located in the article
  (`shared/quote-grounding.js`: exact → typography-normalized → guarded
  fuzzy with a hard threshold), and stored anchors are rebuilt from the
  article's own text at the matched span — a TextQuoteSelector with
  real prefix/suffix plus a new TextPositionSelector carrying raw
  offsets (resolved only when verified against the captured exact).
  Claims and forensic findings whose quotes can't be located are
  rejected-with-reason and can't be accepted (or "Accept all"-ed); the
  review panel shows per-quote ⚓ grounding chips, displays the
  article's span (with the model's original a tooltip away), and lets
  you edit claim/finding quotes in place to re-anchor. Accepted claims
  keep a local-only `anchor_provenance` record (`method`, `score`, and
  the model's original quote whenever the span was repaired).
  Assessment label quotes that don't locate save the label without an
  anchor — never a fabricated one. Wire note (additive): selector
  arrays emitted by the suggest path — the kind-30040 `anchor` tag,
  kind-30054 `label-anchor` tags, and kind-30062 `maneuver-step`
  selectors — may now also contain
  `{"type":"TextPositionSelector","start":…,"end":…}` (UTF-16
  code-unit offsets into the capture-time article body text;
  verification-only semantics documented in `docs/NIP_DRAFT.md`
  §Selectors). Consumers that don't know the type skip it.

- **Identity profiles + fresh workspace.** Settings ▸ Signing is now the
  single home for user identity: saved, labeled identities
  (`identity_profiles`, keyed by pubkey) with a picker — New identity /
  Import nsec / Save current / Use / Remove — while
  `local_primary_identity` stays the one live slot every signing path
  reads ("active" is derived, never stored twice). Settings ▸ Advanced
  gains **Workspace**: a full JSON backup download (includes saved
  identities and their private keys; never the LLM key) and **Start
  fresh workspace** (typed confirmation, backup-first) that clears the
  content stores — entities + their keypairs (incl. the `xray:user`
  sync key), claims, evidence links, assessments, forensic findings,
  truth adjudications, platform accounts, portal viewer npubs — plus
  the `xray-archive`/`xray-audits` IndexedDB caches, and keeps
  settings, relays, flags, the LLM key, and saved identities. The
  portal's npub box is relabeled as the read-only viewer it is
  ("View another archive") with an Identity-settings link. Rationale:
  publish stamps live on records, so switching npub without a reset
  would attribute the old npub's publishes to the new one.
- **Phase 15.10 — authoring UI for integrity findings + attestations.**
  The claims bar gains **🤝 Integrity…**: pick a stated
  commitment/value (only word-eligible propositions are offered), pick
  enacted action-facts about the same entity, and rule the match with
  the full verdict discipline — per-word-class chips, evidence rows,
  mandatory caveats, documented-only gap decomposition with a
  constraint picker, disclosure, and supersession when an active
  finding exists. The 🔗 link flow gains **attestation fields** on
  `supports` links (tier / origin key / independence note — attached
  only when an origin is asserted), and the adjudicate modal shows the
  **attestation convergence** line for propositions with attestation
  edges. Every eligibility rule renders as the option space, with the
  model validators as backstop.

- **Phase 15.9 — read-back + portal surfaces.** The read half of the
  adjudication layer: My Archive now **fetches** kinds 30063/30064,
  **reconciles** them against the local publish stamps (superseded
  rulings never count as local-only), and renders them as Library
  **Verdicts/Integrity facets** with inspector views that keep the
  derivation on the face — evidence both sides, declared standard,
  required caveats, adjudicator disclosure, precedent citations,
  supersession chain. The portal **entity view** gains the
  integrity-record block: dimension-separated records, the
  deed-time-ordered timeline, calibration/corrections lines, and a
  per-reading coverage declaration that unlocks the standard- and
  coverage-gated rollup (declarations deliberately not persisted). The
  adjudicate modal gains **Others' rulings**: foreign 30063s on the
  proposition, deduped by author (addressable semantics), each shown
  with the spread via `verdictVariance` — never a consensus number;
  malformed rulings null-parse and are never shown.

- **Phase 15 conformance pass (design-audit follow-up).** The §3.6
  **precedent citation field** lands (`precedents: [{ref, weight}]`,
  `binding`/`persuasive` defaulting down, wire `a … precedent <weight>`,
  publish threading); **adjudicator exposure disclosure** and
  **right-of-reply refs** ride verdicts and integrity findings (model +
  wire + a modal Disclosure field); the parsers enforce **read-side
  evidence adequacy** (malformed foreign rulings null-parse instead of
  rendering); the entity-record rollup is now **standard-gated** as well
  as coverage-gated (below-standard matches excluded and reported);
  `verdictVariance` accepts both local and parsed field spellings and
  `matchVariance` covers integrity findings. SMOKE_TEST §15 grows
  integrity/entity rows (15.21–15.27) and the v1 **operator
  disciplines**; ROADMAP/kickoff/EPISTACK stale claims corrected.

- **Build stamp in Settings.** The Settings header now shows exactly
  which build is loaded — `v0.6.0 · <branch> @ <short-commit> · built
  <UTC time>` (a `+dirty` marker when built from an uncommitted tree)
  — injected at build time by esbuild and exposed via the new
  `shared/build-info.js`. Ends the "am I running the build I think I
  am?" ambiguity when loading unpacked branch builds; a header with
  no stamp at all means a pre-stamp build. Degrades gracefully to the
  manifest version when git isn't available at build time.

- **Phase 15.8 — the reader adjudication UI.** Every claim row gains
  a **🏛 Adjudicate** action opening the adjudicate modal: pick a
  proposition class (one per claim+class — an existing proposition
  loads for editing), set the subject role, resolution criteria,
  horizon, and event-time, and — when the class is truth-adjudicable —
  rule a verdict with a declared standard, verbatim evidence rows
  (with optional tiers), and mandatory caveats. The §3.1 firewall is
  a UI fact: `interpretation`/`stated-value` swap the ruling form for
  an explainer. When an active ruling exists the form starts blank and
  Save becomes **"Save superseding ruling"** — append-only surfaced
  as an affordance. Claim rows show per-proposition badges (class +
  active verdict state + 🌐 when published). Options → Advanced gains
  a **Truth adjudication** section with the
  `truthAdjudicationPublishing` toggle (default off, with the
  what-leaves-your-device disclosure, mirroring the forensic toggle).
  SMOKE_TEST §Phase 15 gains UI rows 15.14–15.20 covering the full
  click-through walk, publish included.

- **Phase 15.7 — truth-adjudication publish wiring.** The reader's
  batch publish gains a `truthAdjudicationPublishing`-gated section
  (after claims, so coordinates resolve): adjudicated verdicts
  (30063), their kind-1985 claim-coordinate mirrors, and integrity
  findings (30064), with per-kind results in the publish summary.
  Selection (`truth-publish.js`, pure + unit-tested): **chain heads
  only** (a superseded ruling never re-emits; its successor replaces
  it on relays and threads the predecessor's event id as `e
  supersedes`), the usual staleness gate, claims-must-be-published
  gating for every referenced proposition, entity-keypair subject
  resolution for findings, and **constraint-must-resolve** — a
  finding never publishes with its discounting evidence stripped.
  `VerdictModel`/`IntegrityModel` gain `markPublished` (+
  `markMirrored` for verdicts) publish stamps.

- **Phase 15.6 — the truth-adjudication wire (flag-gated).** New
  kinds **`30063` AdjudicatedVerdict** and **`30064`
  IntegrityFinding** (builders + parsers in `truth-builders.js`,
  following the 30062 idioms; `30065` reserved for precedent).
  Verdicts are keyed (author, proposition), carry the declared
  standard, per-state two-sided evidence, and **required caveat
  tags** — and **no `p` tag** (verdicts attach to propositions, not
  persons); their kind-1985 mirror labels the claim coordinate, never
  a pubkey. Integrity findings `p`-reference the subject but get **no
  1985 mirror** — a match-label stripped of evidence and caveats is
  the decontextualized person-grade the design forbids. The §3.1
  firewall holds **on the wire in both directions**: a
  value/interpretation verdict can neither be built nor parsed. Kind
  `30061` dispute targets gain `verdict`/`integrity_finding`
  (additive). Publishing sits behind the new
  **`truthAdjudicationPublishing`** flag (default off; the service
  worker still accepts all inbound kinds); the NIP draft gains
  §30063/§30064. Publish-path and read-UI wiring are follow-up work.

- **Phase 15.5 — the entity integrity record.** Dimension-separated,
  computed-on-read, never stored: the **commitment record** and
  **stated-value record** (each a count AND the list deriving it,
  `pending` included), the **calibration record** (Brier from
  *resolved* predictions only, reusing `audit/calibration.js`;
  hedge-less or unresolved predictions are listed unscoreable, never
  silently dropped), and the **correction-behavior record**
  (verdict/finding supersessions, disclosed revision-gaps as credit,
  and the 30062 forensic bridge when the caller asserts the subject).
  **Coverage** ships on every assembled record — default
  "undetermined: sample, not census" — and **hard-gates the optional
  rollup**: without a declared assessed/universe/method measurement,
  `optionalRollup` returns null; with one, it returns counts and a
  sentence with the coverage limit on its face. No fused score field
  exists anywhere in the record.

- **Phase 15.4 — the integrity application (words vs deeds).**
  `IntegrityFinding` links a subject's **stated** commitment or value
  to their **enacted** action-facts (same entity both sides, resolved
  through the claims' about-entities) and adjudicates the observable
  gap: `fulfilled`/`broken` for commitments, `consistent`/
  `contradicted` for values (the value firewall in enum form), plus
  the honest `unrelated`/`contested`/`insufficient` states. The match
  **is a verdict** — declared standard of proof (defaults
  clear-and-convincing), verbatim evidence with per-match adequacy,
  mandatory caveats, append-only supersession. Gap decomposition
  (`lie`/`revision`/`incapacity`/`constraint`/`misattribution`) is
  recordable **only with documentation** — intent is never inferred;
  `constraint` demands a corroborated action-fact ref (evidence, not
  an excuse); disclosed `revision` composes the existing 30055/30062
  edges as credit. `timelineForEntity` renders the record as a time
  series ordered on the deeds' event-time — pattern, not gotcha.
  Local records only; wire kind 30064 arrives flag-gated in 15.6.

- **Phase 15.3 — the AdjudicatedVerdict model.** One author's ruling
  on one truth-adjudicable proposition, as a **descriptive state**
  (`established-true` / `established-false` / `contested` /
  `unresolved` / `insufficient-evidence`) on a **declared standard of
  proof** (`preponderance` / `clear-and-convincing` /
  `beyond-reasonable-doubt`, defaulted per proposition class), with
  verbatim two-sided evidence (per-state adequacy enforced),
  **mandatory caveats**, and **append-only supersession** — no update
  method exists; a changed ruling is a new verdict chained onto the
  old, which is never edited. The §3.1 firewall is enforced at create:
  `interpretation` and `stated-value` propositions cannot receive a
  verdict. Multi-author agreement is a read-time **variance surface**
  (`verdictVariance`) — per-state counts with their derivation, never
  a consensus number. No estimated score exists anywhere in the layer.
  Local records only; wire kind 30063 arrives flag-gated in 15.6.

- **Phase 15.2 — evidence tiers + attestation graph.** The §3.2 layer
  of the truth-adjudication design: a declared **evidence tier**
  (`tier-1` primary/official, `tier-2` independent reporting, `tier-3`
  single-source) plus `origin_key` and `independence_note` ride the
  existing kind-30055 `supports` link as validated attestation
  metadata, marking the source claim as an attesting artifact for a
  proposition's underlying claim. `truth-attestation.js` adds the
  authoring surface (`attestProposition`) and the **convergence
  measurement**: origin groups collapse shared upstreams ("two outlets
  on one wire are one source"), independence is **demonstrated, not
  assumed** (the earliest origin is the baseline; later origins count
  as independent only with a recorded independence note), and every
  count ships its full derivation — groups, link ids, tiers, notes.
  No wire change; local records only.

- **Phase 15.1 — adjudicable propositions (local model, no wire).** The
  atomization gate of the truth-adjudication layer
  (`docs/TRUTH_ADJUDICATION_DESIGN.md` §3.1): a claim becomes
  *adjudicable* only as a proposition record carrying a
  `proposition_class`, `resolution_criteria` (in the same field
  vocabulary as banked 30058 prediction entries), an optional
  `subject_role` (word/deed/ascribed — absence is `unclassified`, never
  defaulted), and a no-false-precision event-time
  (`occurred_at` + mandatory `occurred_precision`). Ships the firewall
  predicates later slices key off: `interpretation` and `stated-value`
  are **never truth-adjudicable**, and `ascribed`/`unclassified`
  propositions are excluded from integrity findings **by construction**.
  No verdict, score, wire kind, or flag in this slice.

## [0.6.0] — 2026-06-24

### Added

- **Phase 14.5 — LLM assist (in-extension suggestion engine).** A
  user-invoked pass that calls the Anthropic Messages API **from the
  background service worker** and proposes capture artifacts — entities,
  claims, assessments, claim relationships, and forensic findings (plus
  baselines and `revision/*` edges) — for human review in a grouped
  Accept / Edit / Reject panel in the reader. Every accepted artifact is
  created through the **existing models** with provenance
  `suggested_by: 'llm:<model>'`; **nothing auto-saves or auto-publishes**
  (publishing stays behind the existing publish flags). Gated by a new
  **`llmAssist`** flag (default off) **and** a user-supplied API key (a
  second consent gate, since the article text leaves the device). The
  existing model validators are the firewall — findings keep the
  no-verdict discipline (a required counter-note, ≥1 quoted anchor, no
  intent/score). **Which artifact types a pass proposes is configurable**
  (Options → Advanced → LLM assist), defaulting to **Entities + Claims
  only** — the extraction kinds the model does reliably. Relationships,
  assessments, and forensic findings are **opt-in** judgments (higher
  false-positive rate; auto-judgments are the thing X-Ray refuses to
  render): the pass both scopes its prompt to the enabled kinds and
  filters the result to them. New: `shared/llm-prompts.js`,
  `shared/llm-client.js`, `shared/llm-proposals.js`,
  `reader/llm-review.js`; the `xray:llm:suggest` / `xray:llm:config`
  messages; an Options → Advanced → "LLM assist" section (key / model /
  flag / per-kind toggles); and the `https://api.anthropic.com/*` host
  permission. `ClaimModel` and `EntityModel` gain a local-only
  `suggested_by` field (the kind-30040 / kind-0 wire formats are
  unchanged).
- **In-extension epistemic auditor (the LLM execution path).** Two
  user-invoked reader buttons score the open capture against all eight
  epistemic-audit dimensions via the Anthropic Messages API **from the
  background service worker** (`runAuditPass`, `xray:audit:run`), then
  ingest the result through the **existing `importAuditJson` firewall** —
  re-hashed against the capture, every module schema-validated, the
  per-module failure posture preserved. **Quick audit** is one forced
  tool call (single-shot, cheaper); **Thorough audit** runs one
  independent call per dimension in parallel, each with its **full
  vendored methodology prompt** (`shared/audit/module-prompts.js`,
  generated verbatim from `docs/auditor-prototype/prompts/01-08`) and its
  own output budget — the orchestrator doc's production recommendation,
  ~8× the cost. Single-shot runs carry a standing "lower rigor" caveat;
  thorough runs do not. The LLM tool schema is **built from the validator's
  `PAYLOADS`** (one source of truth, so a clean pass can't drift out of
  schema), and the aggregate (weights, knowability ceiling, confidence
  stacking) is **computed in code, never taken from the model**
  (PHILOSOPHY §4); every run carries a standing "single-shot
  orchestration — lower rigor" caveat (P12). Gated by the same
  **`llmAssist`** flag + API key as Suggest; running and importing are
  local-only, and **publishing stays behind `epistemicAuditing`**. No
  PHILOSOPHY amendment — §8 already makes a model a first-class auditor
  and the methodology version stays `1.0` (the findings schemas are
  unchanged). New: `shared/audit/audit-prompt.js`; `runAuditPass` /
  `extractToolInput` in `shared/llm-client.js`; the `xray:audit:run`
  message; and a "Run audit" control in the reader's audit bar.
- **Phase 14.3 — forensic wire format (kind `30062`).** New
  `buildBehavioralFindingEvent` (kind 30062 BehavioralFinding) +
  `parseBehavioralFindingEvent` + a kind-1985 maneuver mirror, behind a
  new `forensicPublishing` flag (default off). The directional
  `revision/*` story-change values (`narrative-patch`,
  `recharacterizes`, `walks-back`) join kind 30055. ⚠️ Wire-format
  change: a new event kind and three new 30055 relationship values, both
  specified in `docs/NIP_DRAFT.md` §30062/§30055. The audit/assessment
  firewall holds by construction — a finding never carries `stance`,
  `rating-value`, `score`, or the `xray/assessment` namespace.

- **Phase 14.3b — forensic publish wiring.** The reader's Publish flow
  gains a flag-gated (`forensicPublishing`, default off) forensic batch:
  behavioral findings (30062) → their kind-1985 maneuver mirrors → the
  `revision/*` story-change edges (30055), each marked published in the
  local ledger so a relay hiccup is resumable. A finding publishes
  against a resolved subject pubkey (a tagged entity's keypair or an
  external pubkey); subjects known only by label/handle wait for entity
  linking. The `revision/*` edges moved out of the `assessmentPublishing`
  link batch into this one.

- **Phase 14.4 — forensic portal lenses.** The "My Archive" portal reads
  behavioral findings: kind `30062` joins the corpus query + a "Findings"
  Library facet + an inspector section (maneuver + evidence chain +
  counter-read). The subject (entity) and case views gain a
  **forensic-findings block** that renders the same findings through four
  report lenses — **evidentiary / executive / survivor / editor** — never
  averaged or scored. `30062` joins the reconciliation ledger (the wire
  d-tag is recorded at publish so the coordinate rebuilds).

- **Phase 13.9 — hardening.** `docs/SMOKE_TEST.md` gains §Phase 13:
  the 24-step manual acceptance walk for the audit pipeline (import
  refusal cases, the display-rule checks, publish resume, the
  audit/assessment firewall on raw events, portal surfaces,
  reconciliation), plus a docs-consistency pass across the NIP draft,
  design note, and options surfaces. The phase-wide adversarial
  review (46 confirmed findings) then hardened the cross-slice seams:
  Options gains **Export audit ledger** (the audit IndexedDB is
  precious — audits cost money); the predictions strip offers
  **Resolve…** for unscheduled predictions (the scorer never dates
  horizons); corrected re-imports update the ledger and re-publish
  changed events; the portal joins audits across prior capture
  vintages (marked "prior version") and joins module results by
  coordinate.

### Removed

- **Two vestigial Settings tabs — "Entities" and "Keypair Registry".** Both
  edited userscript-era `chrome.storage.local` stores
  (`publications`/`people`/`organizations` and `keypair_registry`) that the
  extension no longer reads, writes, or signs with — the live entity system
  is `EntityModel` (the `entities` store + the Entity Browser side panel) and
  entity keys are held by `LocalKeyManager` (`local_keys`). Removed the two
  Options tabs, their dead `Storage` sub-object APIs, and the "View / Export
  Keypair Registry" toolbar menu items + content-script handlers. "Erase all
  data" still purges the legacy keys.

### Fixed

- **In-extension single-shot ("Quick") audit: percentage-scale confidence
  no longer sinks the whole import.** The single-shot model sometimes
  emits a dimension's `confidence` as a 0–100 percentage instead of a
  0.0–1.0 fraction; `buildAggregate` then produced an `overall_confidence`
  (and module-contribution rows) outside `[0, 1]`, which `importAuditJson`
  rejected wholesale — surfacing as the reader's "Audit import failed"
  toast (Thorough mode was unaffected; each module had its own budget and
  the firewall short-circuited on the aggregate first). `assembleAudit`
  now normalizes a recovered percentage back into `[0, 1]` (and clamps
  scores to `[0, 100]`) in the findings it builds, records the degrade as
  an auditor caveat (P12, never silent), and the reader logs the full
  import error to the console. The tamper firewall (hash gate,
  ceiling-source, version/score divergence, schema validation) is
  unchanged — a recoverable model quirk degrades a number instead of
  masquerading as corruption.
- **Publish-path hash fork (blocking, predates Phase 13).** Articles
  whose converted markdown contained `<` (inline small images, code
  fences) were converted to markdown TWICE at publish — mangling the
  published body and stamping an `x` hash different from the capture
  hash audits anchor to. One conversion ever, with a byte-parity
  regression test.
- **Hostile relay events bounded at parse.** 30056–30060 parsers now
  range-check every numeric tag; out-of-range values parse as
  never-asserted (the review chip), absurd aggregates refuse to parse,
  malformed contribution rows are dropped.
- **Import-gate parity with the wire builders** — strict ISO `run_at`,
  64-hex human auditor ids, strict `horizon_iso`, validated
  `nostr_event` evidence: nothing imports (or files) that cannot
  publish.
- **Publish-identity correctness** — ledger marks record the
  publishing pubkey; resume coordinates and resolution references are
  minted at published addresses after a signing-identity switch;
  stale-identity resolutions are re-keyed instead of dead-ended.
- **RQ6 lifecycle closure** — late atomization re-emits the published
  30058 with its claim link; claim deletion severs promotion links;
  the back-reference map covers all capture vintages; revised
  resolutions re-publish; URL-joined and sub-0.6-confidence inputs no
  longer move dossier reputation.

- **Phase 13.8 — audit publish path.** A new `epistemicAuditing`
  feature flag (default **off**, Options ▸ Advanced, with an explicit
  public-visibility disclosure) lets the reader's Publish batch also
  emit the published article's audit record: module results (30056),
  the aggregate (30057), prediction ledger entries (30058, stamped
  with the extraction methodology version that actually produced
  them), and resolutions (30059 — including resolutions of *other
  auditors'* predictions, anchored to the prediction's own article
  hash). Ordering is enforced on the wire: referenced events always
  land before their referencers, and anything whose referent failed
  defers to the next publish via per-event ledger marks (a resumed
  batch never duplicates, never orphans). One malformed record never
  blocks the rest — every skip is counted and surfaced in the publish
  summary. The portal's reconciliation panel now covers the audit
  kinds (a published audit that vanishes from relays surfaces as
  `missing`, like everything else). CLI import additionally enforces
  the wrapper/findings `module_version` agreement — the field feeds
  the wire address — and validates aggregate contribution rows at the
  door. Kind-30060 dossier snapshots remain unpublished by design
  (the portal stays read-only).

- **Phase 13.7 — portal audit surfaces.** The portal corpus now
  fetches the audit kinds (30056–30061); the Library gains Audits and
  Predictions facets plus an audit chip on article cards (joined by
  canonical hash — scores never transfer across edits); the item
  inspector shows every audit run anchored to an article side-by-side
  (never averaged), including local unpublished imports; entity views
  gain a derived **Audit dossier** (shrinkage always shown with its
  parameters; the per-hedge calibration rate table; calibration-v1
  displayed as informational, never applied); and the timeline gains
  a predictions-coming-due strip with an evidence-bound **Resolve…**
  form (resolutions file locally; publishing is the flag-gated 13.8
  step).

- **Phase 13.6 — reader audit panel.** The imported audit renders
  under the claims bar: aggregate badge on the framework's rubric
  bands (a score never renders without its confidence; aggregate
  confidence below 0.6 renders as "needs human review" with no
  number; a binding knowability ceiling always shows its context and
  provenance), expandable per-module rows with auditor caveats and
  click-to-locate evidence quotes, the prediction ledger with
  **Atomize as claim** offers, and side-by-side display of multiple
  runs (never averaged). ⚠️ **Wire-format note (additive, kind
  30040)**: a claim promoted from a prediction-ledger entry emits an
  `a` back-reference to its kind-30058 prediction (4th-position role
  `prediction`) — lineage runs both directions; unpromoted claims are
  byte-identical to the previous shape.

- **Phase 13.5 — audit import (the v1 execution path).** Run the
  vendored scorer CLI out-of-band, then import its JSON from the
  Reader ("Import audit JSON…" under the open capture) or Settings →
  Advanced → Epistemic audits (matched against the archive, including
  retained prior versions). Imports enforce the never-sign-unverified
  gate at the door: the article body is re-hashed against the claimed
  hash, the audit must match a locally captured text, and every
  module payload is schema-validated (failed modules are stored as
  failed runs and excluded from aggregation). Importing is local-only
  and ungated; publishing audit events remains a separate
  `epistemicAuditing`-flagged step (slice 13.8).

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

[Unreleased]: https://github.com/bryanmatthewsimonson/xray/compare/v0.5.1...HEAD
[0.6.0]: https://github.com/bryanmatthewsimonson/xray/compare/v0.5.1...eee77e4
[0.5.1]: https://github.com/bryanmatthewsimonson/xray/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/bryanmatthewsimonson/xray/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/bryanmatthewsimonson/xray/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/bryanmatthewsimonson/xray/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/bryanmatthewsimonson/xray/releases/tag/v0.2.0

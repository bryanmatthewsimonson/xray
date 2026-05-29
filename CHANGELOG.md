# Changelog

All notable changes to X-Ray. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Sections per release: **Added** (new features), **Changed**
(behavior changes for existing features), **Fixed** (bug fixes),
**Removed**.

## [Unreleased]

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
  migration, and `Storage.relays.set()`. Total: 235 (up from 223).

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

[Unreleased]: https://github.com/bryanmatthewsimonson/xray/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/bryanmatthewsimonson/xray/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/bryanmatthewsimonson/xray/releases/tag/v0.2.0

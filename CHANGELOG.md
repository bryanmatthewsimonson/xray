# Changelog

All notable changes to X-Ray. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Sections per release: **Added** (new features), **Changed**
(behavior changes for existing features), **Fixed** (bug fixes),
**Removed**.

## [Unreleased]

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

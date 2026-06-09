# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

X-Ray is a Chrome/Firefox **MV3 WebExtension** (no framework, no
TypeScript, no transpile) that captures web pages — articles, Substack
posts, YouTube videos with transcripts, tweets, Facebook/Instagram/TikTok
posts — as Markdown and publishes them to NOSTR. It ships its own NOSTR
crypto (secp256k1 / BIP-340 / bech32 / NIP-44 v2) and signs locally by
default. It was ported from the `nostr-article-capture` userscript; some
modules still carry userscript-era idioms (see Conventions).

## Commands

```sh
npm install            # required first — a fresh clone has no node_modules
npm run build          # esbuild → dist/*.bundle.js (+ .map). No transpile step.
npm run watch          # incremental rebuild
npm test               # node --test tests/*.test.mjs  (519 tests, must be green)
npm run lint           # web-ext lint --self-hosted (what CI gates on)
npm run version:set X  # bump package.json + manifest.json in lockstep
npm run clean          # rm -rf dist
```

- **Run a single test file:** `node --test tests/youtube.test.mjs`
- **Tests fail with `ERR_MODULE_NOT_FOUND` (`@mozilla/readability`, etc.)
  if you skipped `npm install`** — that's the #1 false alarm in a fresh
  container, not a real regression.
- Tests are `node --test` over `.mjs` files importing the ES modules in
  `src/` directly. `fake-indexeddb` backs the archive-cache tests; there
  is no browser/jsdom — anything touching `chrome.*` or the DOM is tested
  against hand-built stubs in the test file.
- **Loading the unpacked extension:** Chrome `chrome://extensions` →
  Developer mode → Load unpacked → point at the repo root (`manifest.json`
  is at the root by design). Firefox `about:debugging` → Load Temporary
  Add-on → pick `manifest.json`. After any rebuild, click reload on the
  extension card **and** reload the test tab — content scripts do not
  re-inject on extension reload.

## Build model (esbuild → dist/)

`esbuild.config.mjs` produces six bundles from entry points. The manifest
and HTML shells reference `dist/*.bundle.js`; **`src/` is never loaded
directly except the two MAIN-world page scripts.** Entry points:

- `src/content/index.js` → `content.bundle.js` (IIFE, isolated world, every tab)
- `src/background/index.js` → `background.bundle.js` (**ESM** service worker, `conditions: ['worker','browser']`)
- `src/options|sidepanel|reader/index.js` → matching IIFE bundles (loaded by their HTML shells)
- `src/page/api-interceptor.js` → `api-interceptor.bundle.js` (IIFE; runs in the page MAIN world — **no shared imports allowed**, the file's IIFE is the whole module)

`src/page/nip07-bridge.js` is loaded **unbundled** straight from `src/` as a
MAIN-world content script (and is a `web_accessible_resource`). There is no
popup surface and no in-page FAB/panel — the toolbar click (and the
`Ctrl/Cmd+Shift+X` command and the right-click menu) **captures the page and
opens it in the reader** via the `xray:capture` message.

## Architecture (the big picture)

Four JS execution contexts, kept strictly separate, talking over
`chrome.runtime`/`postMessage`. Understanding which context code runs in is
the single most important thing here.

1. **Content script** (`src/content/`, isolated world) — bootstraps on
   every tab and owns the capture pipeline (`ui.js` → `openReader`),
   triggered by the `xray:capture` message. Runs the platform handlers and
   DOM extraction. Injects no in-page chrome except a transient error toast.
   Cannot open WebSockets to relays on CSP-strict sites, so it delegates
   publish.
2. **Background service worker** (`src/background/index.js`, ESM) — owns
   the **relay WebSocket pool** (connections survive tab navigation and
   aren't subject to page CSP — this is *why* the pool lives here, not in
   the content script), context menus, toolbar/keyboard commands,
   notifications, YouTube transcript fetch, and screenshot capture. MV3
   SWs sleep/wake, so startup re-reads the debug pref and re-attaches a
   `chrome.storage.onChanged` listener every wake.
3. **Extension pages** (`src/options/`, `src/reader/`, `src/sidepanel/`) —
   options is the single settings hub (Relays / Signing / Entities /
   Keypair Registry / Advanced); reader renders the captured
   article + publish flow; sidepanel is the entity browser.
4. **MAIN world page scripts** (`src/page/`) — `nip07-bridge.js` exposes
   `window.nostr` to the extension via tagged `postMessage` envelopes;
   `api-interceptor.js` hooks `fetch`/XHR on FB/IG/YouTube to capture
   GraphQL responses (buffered through `shared/api-hook-buffer.js`).

**Capture → publish handoff:** a capture trigger (`xray:capture`) extracts
the article, stashes it in `chrome.storage.session` under a UUID, opens the
reader with `?id=<uuid>`. The reader's publish flow routes signing back
through the **source tab** when NIP-07 is active, so the user's signer
extension approves in-context.

**Message bus:** everything is `chrome.runtime` messages typed `xray:*`
(e.g. `xray:capture`, `xray:capture:publish`, `xray:relay:publish`,
`xray:relay:query`, `xray:sign`, `xray:youtube:fetch`,
`xray:screenshot:capture`, `xray:flags:reload`). When adding a cross-context
call, add an `xray:*` message rather than reaching across contexts directly.

### Shared layer (`src/shared/`)

Pure-ish modules imported by multiple bundles. Most export a single
namespace object (`export const Storage = …`, `export const Signer = …`).

- **`storage.js`** — `chrome.storage.local` wrapper; the **canonical source
  of truth**. Preserves the userscript's outer API (`Storage.get/set/...`
  plus `publications`/`people`/`organizations`/`preferences`/`keypairs`
  sub-objects) so callers didn't change during the port. Values are
  JSON-serialized for export/import compatibility. Note: the **primary
  signing identity (Local mode) lives under a separate
  `local_primary_identity` key**, deliberately *outside* the keypair
  registry, so exporting entity keys never leaks the user's nsec.
- **`signer.js`** — unified signing façade over Local / NIP-07 /
  NSecBunker, dispatched on `preferences.signing_method`. NIP-07 only works
  where a `nip07Client` is injected (`Signer.configure({ nip07Client })`),
  i.e. the content script; other contexts pass a `signRequestForwarder`
  that proxies to a tab.
- **`crypto.js`** — real secp256k1 / BIP-340 Schnorr / bech32 / NIP-44 v2,
  unit-tested against the BIP-340 vectors. Don't hand-roll alternatives.
- **`event-builder.js`** — builds the NOSTR events (NIP-23 `30023`, claims
  `30040`, comments `30041`, evidence `30043`, relationships `32125`) and
  the archive-reader inverse. **Wire-format changes here have compatibility
  consequences for anyone consuming X-Ray events — call them out
  explicitly.**
- **`content-detector.js` / `content-extractor.js`** — URL+DOM platform
  detection; Readability + Turndown → Markdown.
- **`platforms/`** — per-site handlers (`index.js` dispatches). They run in
  the content script and **return plain data objects only — no DOM
  mutation, no UI.** Add a new site by adding a handler here + a detector
  case, not by special-casing the UI.
- **`metadata/`** (Phase 9a) — wire-format foundation for crowdsourced URL
  metadata (annotations / fact-checks / topic-trust; see
  `docs/NIP_DRAFT.md`). Gated by **`metadata/feature-flags.js`**: defaults
  in `FLAGS_DEFAULTS`, overridable via `chrome.storage.local` key
  `xray:flags`. The service worker always *accepts* incoming events of
  every kind; only publish paths and panel tabs are flag-gated.
- **`identity/`** (Phase 9) — cross-platform identity layer: captured
  commenters/authors become dedup-able identities, and cross-platform
  accounts can be collapsed into one person.
- Also: `nostr-client.js` (relay pool, used from background),
  `archive-cache.js` (IndexedDB + paywall reconstruction).

## Conventions

- **Indentation: 4 spaces** in JS authored here; **2 spaces** in files
  ported verbatim from the userscript (preserved so userscript diffs stay
  readable). Match the file you're editing.
- **`config.js` carries snake_case keys** (e.g. `min_content_length`) to
  match the v4 userscript for drop-in module portability, with some
  camelCase legacy aliases kept alongside. Don't "tidy" these casings.
- **CSS prefixes:** `xr-*` for extension-chrome UI (options/reader/side
  panel) and all content-script UI. The FAB/panel `nac-*` CSS is gone; the
  only `nac-*` left is a handful of **capture-pipeline markers** in
  `content-extractor.js` (`nac-tweet-embed`, `nac-facebook-post`,
  `nac-inline-img`, …) — class names on cloned nodes that the Turndown
  rules match to build Markdown, not UI. **Don't add new `nac-*` classes**;
  renaming those remaining markers to `xr-*` is a known follow-up.
- **Logging:** use `Utils.log` / `Utils.error` (no-ops when `CONFIG.debug`
  is false). Don't add bare `console.log`.
- **User-visible strings** use "X-Ray" (hyphenated). Avoid emoji in code
  unless it's genuinely part of the UI.
- **Version lockstep:** `package.json` and `manifest.json` versions MUST
  agree — **CI rejects a mismatch.** Use `npm run version:set X`, which
  edits both.
- **Firefox floor is `gecko.strict_min_version: 128.0`** and is load-bearing
  (`world: "MAIN"` content scripts, `scripting.executeScript({world:'MAIN'})`,
  and `declarativeNetRequest` response-header rewriting all land in exactly
  128). Don't lower it; don't bump it without a dependency that requires it.
  `rules/csp-strip.json` strips CSP so the YouTube transcript fetch reaches
  `/api/timedtext`.
- **Private keys:** the keypair registry in `chrome.storage.local` holds
  private keys — never paste its contents into issues/logs/commits. Raw
  event JSON is fine (`pubkey` is public by definition).
- **Commit messages:** imperative present tense; `fix:`/`feat:`/`chore:`/
  `docs:`/`ci:` prefixes, scope in parens when useful
  (`fix(youtube): …`). One concern per PR.

## Project docs (read these for non-trivial work)

- **`docs/ROADMAP.md`** — per-phase scope. Currently through Phase 9a
  metadata data model + Phase 9 identity layer (v0.5.0).
- **`docs/JOURNAL.md`** — chronological log of bugs, design decisions, and
  external-platform changes. **Add a tight entry** when fixing a non-obvious
  bug, making a second-guessable design choice, or working around a
  third-party change. Skim it first when a capture target breaks.
- **`docs/SMOKE_TEST.md`** — ~20-min manual checklist; run before any
  release tag or after a cross-cutting refactor.
- **`docs/CAPTURE_GUIDE.md`** — per-platform URL-shape/timing requirements
  (FB/IG/TikTok are finicky).
- **`docs/NIP_DRAFT.md`** — the crowdsourced-metadata wire format.
- **`CONTRIBUTING.md`** — release process (git-tag-driven via
  `.github/workflows/release.yml`) and the Firefox-floor rationale.

## CI

`.github/workflows/ci.yml` on push/PR to `main`: `node --check` every
`src/**/*.js`, `npm run build`, `npm test` (if any tests exist), `web-ext
lint --self-hosted`, `web-ext build`. A `v*` tag triggers `release.yml`
(builds, packages, creates a GitHub Release with the `.zip`). Get all of
build + test + lint green locally before pushing.

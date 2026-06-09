# X-Ray — NOSTR URL Metadata & Article Capture

Chrome / Firefox WebExtension that captures the page you're looking at —
articles, Substack posts, YouTube videos with transcripts, tweets, and
social-media posts on Facebook / Instagram / TikTok — as Markdown, and
publishes it to NOSTR as long-form (`kind: 30023`) and structured-claim
events. Built as a native MV3 WebExtension; ships its own NOSTR crypto
(secp256k1 / BIP-340 / bech32 / NIP-44 v2) and signs locally by default.

*"X-Ray" — because it lets you see through a page to what the network
has already said about it.*

## Status

Phases 0–8 of the roadmap are complete, plus the Phase 9a metadata data
model and the Phase 9 identity layer (v0.5.0). The extension captures
across every shipped platform handler, publishes events end-to-end, syncs
entity data across devices, reconstructs paywalled content from cached or
relay copies, and now carries the wire-format foundation for crowdsourced
URL metadata (annotations / fact-checks / topic-trust — see
[`docs/NIP_DRAFT.md`](docs/NIP_DRAFT.md)) plus a stable cross-platform
identity layer (captured commenters and post authors become dedup-able
identities; cross-platform accounts can be collapsed into one person).
The codebase is past the userscript-paradigm port and operates as a pure
WebExtension.

The [**roadmap**](docs/ROADMAP.md) tracks per-phase scope. The
[**engineering journal**](docs/JOURNAL.md) logs significant bugs, design
decisions, and external-platform changes — worth a skim when a capture
target breaks. Before any release tag (or after a cross-cutting
refactor), run the [**smoke test**](docs/SMOKE_TEST.md) — a ~20-minute
manual checklist that exercises every shipped surface.

## Features

- **Reader-mode article extraction** — Mozilla Readability + Turndown
  produces clean markdown from article-shaped pages.
- **Long-form publishing** — articles land as NIP-23 (`kind: 30023`)
  events with a rich tag set (`title`, `author`, `published_at`,
  `summary`, `image`, `word_count`, `lang`, `t` topic tags, etc.).
- **Substack handler** — paywalled-body unlock when the user is signed
  in, rich author / publication metadata, comment tree captured as
  opt-in `kind 30041` events with proper reply-to threading.
- **YouTube handler** — `ytInitialPlayerResponse`-derived metadata,
  origin + user-language transcripts (human and auto-generated),
  clickable `&t=Ns` timestamps on every transcript paragraph, video-
  shaped reader layout, rich structured event tags (`video_id`,
  `channel_id`, `duration`, `category`, `view_count`,
  `origin_language`, `transcript_lang`, …). Shorts supported.
- **Twitter / X handler** — focal-tweet detection, multi-tweet thread
  capture by the same author, replies captured as comments.
- **Generic comment extractor** — heuristic walker for WordPress and
  other native-comment platforms; cross-origin Disqus iframes flagged
  as captured-but-not-included.
- **Facebook / Instagram / TikTok handlers** — anti-obfuscation stack
  (MAIN-world `fetch`/XHR interception, scoped DOM scraping, HTML
  snapshot + element-cropped screenshot evidence). Recognizes every
  Facebook post URL shape, Instagram posts/reels/IGTV, TikTok video
  URLs.
- **Entity system** — per-entity keypairs (publications, people,
  organizations), text-selection tagger in the reader, side-panel
  entity browser, alias resolution, kind-0 profile publishing.
- **Claims + evidence** — structured claim events (`kind 30040`),
  entity relationships (`kind 32125`), evidence links
  (`kind 30043`).
- **Entity sync across devices** — NIP-78 (`kind 30078`) with NIP-44 v2
  encrypt-to-self.
- **Archive reader** — IndexedDB cache + paywall detection +
  relay-backed reconstruction; surfaces a richer cached/published copy
  when the live page is paywalled or stripped.
- **Three signing methods, local by default**:
  - **Local** — keypair stored in `chrome.storage.local`; signs
    in-browser via BIP-340 Schnorr. *(Default for new users.)*
  - **NIP-07** — sign through an installed browser extension (nos2x,
    Alby, nostr-connect, …).
  - **NSecBunker** — remote signer over WebSocket; supports
    per-publication keys for shared-identity publishing.
- **Background service-worker relay pool** — WebSockets survive tab
  navigation and aren't subject to page CSP.
- **Real NOSTR crypto** — secp256k1 / BIP-340 / bech32 / NIP-44 v2,
  unit-tested against the BIP-340 vectors.

## Install (Chrome / Chromium / Brave / Edge)

1. Clone the repo and open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the cloned directory (it contains
   `manifest.json` at the root).
4. The X-Ray icon appears in the toolbar. Pin it if you want.

To pick up source changes: click the reload icon on the X-Ray card in
`chrome://extensions`. Reload any open tabs you're testing in — content
scripts don't re-inject on extension reload.

## Install (Firefox)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `manifest.json` at the root of the cloned repo.
4. Firefox unloads temporary add-ons on restart — reload as needed.

For a persistent install, package and sign via
[`web-ext sign`](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/).

## First-run setup

X-Ray defaults to local signing but doesn't generate a key for you
silently. The first time you open the Settings page (or click the
toolbar icon on a non-injectable page), the **Signing** tab shows a
welcome banner asking you to pick a method:

- **Local** (recommended) → click **Generate new key**, or **Import
  nsec…** to bring an existing key over.
- **NIP-07** → install nos2x / Alby first, then pick this option.
- **NSecBunker** → enter the bunker URL, click **Test connection**.

Until you pick, capturing opens the **Settings → Signing** tab with a
"Set up signing" prompt instead of the reader.

## Usage

- **Click the toolbar icon** to capture the active tab and open it in
  the **reader** — where you preview the article (Readable / Markdown),
  tag entities, mark claims, and publish. On `chrome://`, `file://`, or
  extension pages where the content script can't run, the click opens
  **Settings** instead.
- **`Cmd/Ctrl + Shift + X`** captures from the keyboard.
- **Right-click** a page (or the toolbar icon) → **Capture this page
  with X-Ray** does the same. The toolbar icon's right-click menu also
  has: Entity Browser, Settings…, View Keypair Registry, Export Keypair
  Registry, Capture tips.
- **Per-platform capture instructions** — Facebook, Instagram, and
  TikTok have URL-shape and timing requirements; see the
  [capture guide](docs/CAPTURE_GUIDE.md).

## Settings

Open via the toolbar icon's right-click → **Settings…**, the reader's
header, or `chrome://extensions` → X-Ray → **Details** →
**Extension options**.

The Options page is the single home for configuration. Tabs:

- **Relays** — per-relay rows (URL, read, write, enabled). Disabled
  relays are skipped entirely; the reader's publish-time picker shows
  only enabled+writable relays. The structured shape is persisted as
  `preferences.relays`; `preferences.default_relays` (URL list) is
  auto-synced for back-compat.
- **Signing** — choose Local / NIP-07 / NSecBunker. Local panel:
  Generate / Import nsec / Show nsec / Reset. NIP-07 panel: detection
  status. NSecBunker panel: URL + Test connection. An always-visible
  *Active method* line shows the chosen method and current npub.
- **Entities** — Publications, People, Organizations as JSON.
- **Keypair Registry** — view, export (JSON), import. Holds
  *entity* keypairs only — your primary signing identity (Local mode)
  lives in a separate `local_primary_identity` key so an entity-key
  export never leaks the user's nsec.
- **Advanced** — a **Reader** group (archive banner sensitivity) and a
  **Power user** group (debug logging plus engine-tuning overrides for
  article cache enabled/budget, min content length, and max claim
  length), then a Danger zone (clear all storage).

Quick-action buttons in the Options header (Capture Page, Entity
Browser, Capture tips) cover the jump-to-other-surfaces actions
without needing a separate popup.

## Layout

ES modules bundled by esbuild per entry point (`npm run build`
produces `dist/*.bundle.js`, which the manifest loads).

```
.
├── manifest.json                  MV3 manifest (Chrome + Firefox)
├── icons/                         16 / 48 / 128 px
├── rules/
│   └── csp-strip.json             declarativeNetRequest: strip CSP
│                                  + rewrite referer for youtube.com
├── esbuild.config.mjs             bundle entry points → dist/
├── src/
│   ├── background/index.js        SW: context menus, action click,
│   │                              message routing, relay pool, youtube
│   │                              transcript fetch, screenshot capture
│   ├── page/
│   │   ├── nip07-bridge.js        MAIN world: window.nostr via
│   │   │                          postMessage envelope
│   │   └── api-interceptor.js     MAIN world: fetch/XHR hook for
│   │                              GraphQL response capture (FB/IG)
│   ├── content/
│   │   ├── index.js               bootstrap + chrome.runtime wire
│   │   ├── ui.js                  capture pipeline (openReader) + toast
│   │   └── nip07-client.js        postMessage client to MAIN bridge
│   ├── reader/                    extension-page reader (Reader /
│   │                              Markdown / Preview tabs, publish
│   │                              flow, comment tree render, claims)
│   ├── options/                   single settings hub (Relays /
│   │                              Signing / Entities / Keypair
│   │                              Registry / Advanced)
│   ├── sidepanel/                 entity browser
│   └── shared/
│       ├── config.js              defaults + applyConfigOverrides()
│       ├── utils.js               logging, URL normalization, escape
│       ├── storage.js             chrome.storage wrapper +
│       │                          primaryIdentity + relays namespaces
│       ├── crypto.js              secp256k1 / BIP-340 / bech32 /
│       │                          NIP-44 v2
│       ├── signer.js              unified Local / NIP-07 / NSecBunker
│       │                          signing façade
│       ├── content-detector.js    URL + DOM platform detection
│       ├── content-extractor.js   Readability + Turndown +
│       │                          markdown→HTML
│       ├── event-builder.js       NIP-23 / 30040 / 30041 / 30043 /
│       │                          32125 builders + archive-reader
│       │                          inverse
│       ├── nostr-client.js        relay pool (used from background)
│       ├── nsecbunker-client.js   remote signer
│       ├── local-key-manager.js   in-browser entity-keypair registry
│       ├── api-hook-buffer.js     buffer for MAIN-world api hits
│       ├── api-pattern.js         URL/header pattern matcher
│       ├── html-snapshot.js       sanitized outerHTML + SHA-256
│       ├── screenshot.js          element-cropped screenshot helper
│       ├── archive-cache.js       IndexedDB cache (Phase 7)
│       ├── claim-model.js         claims + evidence linker
│       ├── entity-model.js        entity types, aliases, kind-0
│       ├── entity-sync.js         NIP-78 sync over NIP-44 v2
│       ├── evidence-linker.js     evidence-link relationships
│       └── platforms/
│           ├── index.js           handler dispatch
│           ├── substack.js        Readability fallback + meta enrich
│           ├── substack-api.js    /api/v1/posts + comments
│           ├── youtube.js         player-response + transcript scrape
│           ├── twitter.js         focal-tweet + thread capture
│           ├── facebook.js        eleven URL shapes + GraphQL walker
│           ├── instagram.js       og-meta + DOM scrape + GraphQL
│           ├── tiktok.js          three SSR shapes + screenshot
│           └── comment-extractor.js  generic WordPress / Disqus probe
└── tests/                         node --test suite (519 passing)
```

## Permissions

- `storage` — persist preferences, entities, keypair registry, primary
  identity.
- `notifications` — surface publish results as native notifications.
- `scripting`, `activeTab` — forward action / context-menu commands to
  the content script; inject the api-interceptor on FB/IG.
- `contextMenus` — shortcuts on the toolbar icon's right-click menu.
- `sidePanel` — entity-browser side panel.
- `declarativeNetRequest` — strip CSP for the YouTube transcript fetch.
- `<all_urls>` host permission — read the current page, query NOSTR
  relays over WebSocket, fetch titles for related-link submissions.

## Development notes

- **Build:** `npm install`, then `npm run build` to produce
  `dist/*.bundle.js` and `dist/*.bundle.js.map`. esbuild handles all
  bundling; no transpile step. `npm run watch` for incremental.
- **Tests:** `npm test` runs `node --test tests/*.test.mjs`. **519
  tests** today, covering crypto, event-builder, every platform
  handler, entity sync, claim model, archive cache, the Signer
  façade, and the URL normalizer.
- **MAIN-world bridge** — `src/page/nip07-bridge.js` is injected into
  the page's main world (`content_scripts[0].world: "MAIN"` in the
  manifest) and exposes `window.nostr` to the extension via tagged
  `window.postMessage` envelopes.
- **API interception** — `src/page/api-interceptor.js` runs in the
  page's main world on Facebook / Instagram and posts captured
  GraphQL responses to the content script (`api-hook-buffer.js`).
- **Session handoff** — the capture pipeline (toolbar/keyboard/menu
  trigger) stashes the
  extracted article in `chrome.storage.session` keyed by a UUID, then
  opens the reader with `?id=<uuid>`. The reader's publish flow
  routes signing back through the source tab when NIP-07 is the
  active method, so the user's signer extension approves in-context.
- **Storage:** `chrome.storage.local` is the canonical source of
  truth.

## Related

- **[`nostr-article-capture`](https://github.com/bryanmatthewsimonson/nostr-article-capture)**
  — the legacy userscript X-Ray was ported from.

## License

MIT — see `LICENSE`.

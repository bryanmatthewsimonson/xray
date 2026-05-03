# X-Ray — NOSTR URL Metadata & Article Capture

Chrome / Firefox WebExtension that captures the page you're looking at
— article, Substack post, YouTube video with transcripts — as
Markdown, and publishes it to NOSTR as a NIP-23 (`kind: 30023`) event.
The MV3 port of the `nostr-article-capture` userscript, in a
multi-phase catch-up to userscript v4.2.

*"X-Ray" — because it lets you see through a page to what the network
has already said about it.*

## Status

The project is a multi-phase port. Phases 0-2 (infrastructure + real
crypto + article capture) are complete. Phase 3 (platform handlers)
is in progress — Substack and YouTube are shipped, Twitter/X and the
generic comment extractor are next. Entity / claims / archive /
hard-tier platforms follow.

The [**migration roadmap**](docs/ROADMAP.md) is the source of truth
for what's landed and what's pending. The
[**engineering journal**](docs/JOURNAL.md) logs significant bugs,
design decisions, and external platform changes that shape the
architecture — worth a skim when a new capture target breaks or a
subtle bug needs context. Before any release tag (or after any
cross-cutting refactor), run the
[**smoke test**](docs/SMOKE_TEST.md) — a ~20-minute manual
checklist that exercises every shipped surface across Phases 0–7.

Forward-looking, unimplemented design plans live under
[`docs/plans/`](docs/plans/) — consolidated from the
`nostr-article-capture` repo on 2026-04-24 and carrying a **tentative**
banner at the top of each file. Production-code reference docs for the
legacy userscript stay in their original repo and are not mirrored here.

## Features (currently working)

- **Reader-mode article extraction** — Mozilla Readability + Turndown
  produces clean markdown from article-shaped pages.
- **Long-form publishing** — articles land as NIP-23 (`kind: 30023`)
  events with a rich tag set (`title`, `author`, `published_at`,
  `summary`, `image`, `word_count`, `lang`, `t` topic tags, etc.).
- **Substack handler** — paywalled-body unlock when the user is
  signed in, rich author / publication metadata, comment tree
  captured as opt-in kind-30041 events with proper reply-to
  threading.
- **YouTube handler** — `ytInitialPlayerResponse`-derived metadata,
  origin + user language transcripts (human and auto-generated),
  clickable `&t=Ns` timestamps on every transcript paragraph,
  video-shaped reader layout (thumbnail, duration badge, chips for
  channel / views / category / captured languages), rich structured
  event tags (`video_id`, `channel_id`, `duration`, `category`,
  `view_count`, `origin_language`, `transcript_lang`, …).
- **NIP-07 signing** via installed browser extension (nos2x, Alby,
  nostr-connect, …).
- **Fallback remote signing** via NSecBunker over WebSocket.
- **Background service-worker relay pool** — WebSockets survive tab
  navigation and aren't subject to page CSP.
- **Real NOSTR crypto** — secp256k1 / BIP-340 / bech32 / NIP-44 v2,
  unit-tested against the BIP-340 vectors.

## Features (in progress / planned)

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the full breakdown.
Next up:

- **Twitter/X handler** — tweet + thread capture, engagement tags.
- **Generic comment extractor** — Disqus / WordPress heuristic walker.
- **Entity system** — per-entity keypairs, alias resolution, side
  panel browser, text-selection tagger.
- **Claims + evidence linking** — structured claim events
  (`kind: 30040`) with evidence-link relationships.
- **Archive reader** — local IndexedDB cache + paywall detection +
  relay-backed reconstruction.
- **Facebook / Instagram / TikTok** — deferred; requires the
  anti-obfuscation stack (API interception, React Fiber traversal).

## Install (Chrome / Chromium / Brave / Edge)

1. Clone the repo and open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the cloned directory (it contains
   `manifest.json` at the root).
4. The X-Ray icon appears in the toolbar. Pin it if you want.

To pick up source changes: click the reload icon on the X-Ray card in
`chrome://extensions`.

## Install (Firefox)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `manifest.json` at the root of the cloned repo.
4. Firefox unloads temporary add-ons on restart — reload as needed.

For a persistent install, package and sign via
[`web-ext sign`](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/).

## Usage

- Click the toolbar icon for the popup (status + quick actions).
- The floating **📝 Capture Article** button (FAB) on every page opens
  the capture panel. Three tabs: **Readable** (preview), **Markdown**
  (copy/download), **Metadata** (annotation / fact-check / headline
  correction / reaction / related / rating / comment).
- The floating **URL metadata badge** (bottom-left on most pages) shows
  aggregated NOSTR metadata for the current URL. Click to expand.
- Right-click the toolbar icon for shortcuts (open capture, view/export
  keypair registry).

## Settings

Toolbar icon → **Settings…** or `about:addons` → X-Ray → Options.
Tabs:

- **Relays** — default WebSocket relays, one URL per line.
- **Signing** — NSecBunker URL (used if no NIP-07 extension is
  detected).
- **Keypair Registry** — view, export (JSON), import.
- **Advanced** — theme, media handling, full storage reset.

Entity / claims / archive settings land with their respective phases
(see [`docs/ROADMAP.md`](docs/ROADMAP.md)).

## Layout

ES modules bundled by esbuild per entry point (`npm run build`
produces `dist/*.bundle.js`, which the manifest loads).

```
.
├── manifest.json                  MV3 manifest (Chrome + Firefox)
├── icons/                         16 / 48 / 128 px
├── rules/
│   └── csp-strip.json             declarativeNetRequest: strip
│                                  content-security-policy + rewrite
│                                  referer for youtube.com/api/timedtext
├── esbuild.config.mjs             bundle entry points → dist/
├── src/
│   ├── background/index.js        SW: context menus, message relay,
│   │                              relay pool, youtube transcript
│   │                              fetch + page-world injection
│   ├── page/nip07-bridge.js       MAIN world: window.nostr via
│   │                              postMessage envelope
│   ├── content/
│   │   ├── index.js               bootstrap + chrome.runtime wire
│   │   ├── ui.js                  FAB + capture pipeline (openReader)
│   │   └── nip07-client.js        postMessage client to the MAIN
│   │                              bridge
│   ├── reader/                    extension-page reader
│   │   ├── index.html
│   │   ├── index.css
│   │   └── index.js               Reader / Markdown / Preview tabs,
│   │                              publish flow, comment tree render
│   ├── popup/                     toolbar action UI
│   ├── options/                   settings page
│   ├── sidepanel/                 (entity browser — Phase 4)
│   └── shared/
│       ├── config.js              defaults
│       ├── utils.js               logging, URL normalization, escape
│       ├── storage.js             chrome.storage wrapper
│       ├── crypto.js              secp256k1 / BIP-340 / bech32 /
│       │                          NIP-44 v2
│       ├── content-detector.js    URL + DOM platform detection
│       ├── content-extractor.js   Readability + Turndown +
│       │                          markdown→HTML
│       ├── event-builder.js       NIP-23/30040/30041/30043/32125
│       │                          event builders + archive-reader
│       │                          inverse
│       ├── nostr-client.js        relay pool (used from background)
│       ├── nsecbunker-client.js   remote signer
│       ├── local-key-manager.js   in-browser keypair registry
│       └── platforms/
│           ├── index.js           handler dispatch
│           ├── substack.js        enrich (Readability fallback)
│           ├── substack-api.js    /api/v1/posts + comments
│           └── youtube.js         synthesize (ytInitialPlayerResponse
│                                  + transcript scrape)
└── tests/                         node --test suite (18 passing)
```

## Permissions

- `storage` — persist preferences, entities, keypair registry.
- `notifications` — surface publish results as native notifications.
- `scripting`, `activeTab` — forward action/context-menu commands to
  the page's content script.
- `contextMenus` — shortcuts on the toolbar icon.
- `<all_urls>` host permission — read the current page, query NOSTR
  relays over WebSocket, fetch titles for related-link submissions.

## Development notes

- **Build:** `npm install`, then `npm run build` to produce
  `dist/*.bundle.js` and `dist/*.bundle.js.map`. esbuild handles all
  bundling; no transpile step. Load the repo root as an unpacked
  extension.
- **Tests:** `npm test` runs the `node --test` suite under
  `tests/*.test.mjs`. 18 tests today, covering crypto primitives
  (Phase 1).
- **MAIN-world bridge** — `src/page/nip07-bridge.js` is injected into
  the page's main world (declared via `content_scripts[0].world: "MAIN"`
  in the manifest) and exposes the page's `window.nostr` to the
  extension via a `window.postMessage` envelope tagged with an X-Ray
  nonce.
- **Session handoff** — the capture pipeline (FAB click) stashes the
  extracted article in `chrome.storage.session` keyed by a UUID, then
  opens the reader with `?id=<uuid>`. The reader's publish flow routes
  signing back through the source tab so the user's NIP-07 extension
  approves the sign in-context.
- **Storage:** `chrome.storage.local` is the canonical source of
  truth. Exports from the userscript are drop-in importable in
  **Settings → Keypair Registry → Import JSON**.

## Related

- **[`nostr-article-capture`](https://github.com/bryanmatthewsimonson/nostr-article-capture)**
  — the original userscript this extension was ported from.

## License

MIT — see `LICENSE`.

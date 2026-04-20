# X-Ray — NOSTR URL Metadata & Article Capture

Chrome / Firefox WebExtension that shows **NOSTR-sourced metadata** for
any URL you're viewing (annotations, fact-checks, ratings, comments,
headline corrections) and lets you **capture the page as Markdown** and
publish it back to NOSTR. It's the MV3 port of the
`nostr-article-capture` userscript (v1.8.0), taken as the feature-parity
starting point.

*"X-Ray" — because it lets you see through a page to what the network
has already said about it.*

## Features

- Reader-mode article extraction (Mozilla Readability) + HTML→Markdown
  (Turndown)
- Publish long-form articles as NIP-23 (`kind: 30023`) events
- URL-scoped metadata events (`kind: 32123` annotation, `32124` fact
  check, `32125` headline correction, `32126` reaction, `32127` related,
  `32128` rating, `32140` comment, plus organizations / publications at
  `32141`/`32142`)
- NIP-07 signing via installed browser extension (nos2x, Alby,
  nostr-connect, …)
- Fallback remote signing via **NSecBunker** over WebSocket
- Per-URL metadata badge: trust score, annotation count, fact-check
  verdict, inline text highlights and headline-correction indicators,
  link badges on outbound links
- Keypair registry (per-entity) with export / import

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
- **Entities** — publications, people, organizations as JSON (keyed by
  id).
- **Keypair Registry** — view, export (JSON), import.
- **Advanced** — theme, media handling, full storage reset.

## Layout

```
.
├── manifest.json              MV3 manifest (Chrome + Firefox via
│                              browser_specific_settings.gecko)
├── icons/                     icon-16.png, icon-48.png, icon-128.png
├── src/
│   ├── background/
│   │   └── service-worker.js  context menus, message relay, native
│   │                          notifications
│   ├── page/
│   │   └── nip07-bridge.js    runs in MAIN world; exposes
│   │                          window.nostr via postMessage
│   ├── popup/                 toolbar action UI
│   ├── options/               settings page
│   └── content/               ISOLATED-world content scripts
│       ├── 01-config.js       configuration + default relays
│       ├── 02-utils.js        logging, URL normalization, escape
│       ├── 03-storage.js      chrome.storage.local wrapper
│       ├── 04-readability.js  Readability (bundled)
│       ├── 05-turndown.js     Turndown (bundled)
│       ├── 06-content-processor.js
│       ├── 07-nostr-crypto.js
│       ├── 08-nostr-client.js        relay pool
│       ├── 09-nsecbunker-client.js   remote signer
│       ├── 10-nip07-client.js        postMessage to page bridge
│       ├── 11-event-builder.js       NIP-01/23/custom event builders
│       ├── 12-url-metadata-service.js
│       ├── 13-ui.js                  FAB + capture panel
│       ├── 14-metadata-ui.js         metadata badge + overlay
│       ├── 15-init.js                bootstrap + chrome.runtime wire
│       └── content.css               all content-script styles
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

- The content scripts are loaded in order by the manifest and share
  the ISOLATED-world globals (each file declares top-level `var`
  symbols). There is no bundler and no build step.
- `src/page/nip07-bridge.js` is injected into the **MAIN** world and
  exposes the page's `window.nostr` to the content script via
  `window.postMessage` with an X-Ray-tagged envelope.
- Storage values are JSON-stringified to match the shape the userscript
  stored under `GM_setValue`. Exports from the userscript are
  drop-in importable in **Settings → Keypair Registry → Import JSON**.
- `chrome.storage.local` is the canonical source of truth. The options
  page writes it directly, and the content script's `Storage` wrapper
  reads it on demand, so settings take effect on the next page load
  (or the next `Storage.get` call) without a round-trip through the
  worker.

## Related

- **[`nostr-article-capture`](https://github.com/bryanmatthewsimonson/nostr-article-capture)**
  — the original userscript this extension was ported from.
- **Keystone** (forthcoming) — a dedicated NOSTR-integrated browser.
  X-Ray is where we're incubating the content-script stack that will
  eventually be built into Keystone natively.

## License

MIT — see `LICENSE`.

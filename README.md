# X-Ray — NOSTR URL Metadata & Article Capture

Chrome / Firefox WebExtension that captures the page you're looking at —
articles, Substack posts, YouTube videos with transcripts, tweets,
social-media posts on Facebook / Instagram / TikTok, PDFs, academic
papers (arXiv / PubMed Central), podcast transcripts, and EPUB books —
as Markdown, and publishes it to NOSTR as long-form (`kind: 30023`) and
structured-claim events. It then lets you **structure and judge** what
you captured — entities, claims, assessments, epistemic audits, truth
verdicts — and organize it into **cases** you can analyze and share.
Built as a native MV3 WebExtension; ships its own NOSTR crypto
(secp256k1 / BIP-340 / bech32 / NIP-44 v2) and signs locally by default.

*"X-Ray" — because it lets you see through a page to what the network
has already said about it.*

## Status

**v0.7.0** (tagged 2026-07-16). Parity with the v4.2 userscript is long
past; the project now spans the full **capture → structure → judge →
publish** arc, plus a case workspace, a follow-based network layer, and
corpus-intake automation. Every phase through 27 has landed at least its
core (17, 18, and 26 carry deferred tails), and **Phase 28** (corpus
intake automation) is in progress. Highlights beyond capture parity:

- **Claims & assessments (Phases 10–11).** Atomized claim events
  (`kind 30040`), typed claim↔claim relationships (`kind 30055`), and
  personal assessments (`kind 30054` — graded stance + issue labels):
  opinions to debate, never automated truth verdicts.
- **"My Archive" portal (Phase 12).** A full-tab, read-mostly view of
  everything you've published, reconciled against relays, with faceted
  filters and per-case dashboards.
- **Epistemic audits (Phase 13).** An eight-dimension audit of an
  article's journalistic quality (`kind 30056`–`30061`), governed by a
  normative constitution ([`docs/PHILOSOPHY.md`](docs/PHILOSOPHY.md)):
  evidence-bound, calibrated, code-computed aggregates with a knowability
  ceiling — never naked scores.
- **Forensic findings (Phase 14).** A behavioral-pattern layer
  (`kind 30062`) that names structural *maneuvers* with a required
  counter-read and quoted evidence — structure, never a verdict on intent.
- **LLM assist (Phase 14.5, opt-in).** A user-invoked **Suggest** pass
  proposes capture artifacts for review, and an in-extension **epistemic
  auditor** runs the audit (**Quick** single-shot or **Thorough**
  per-module). Every LLM feature needs both its feature flag **and** your
  own Anthropic key; nothing auto-saves or auto-publishes.
- **Truth adjudication (Phase 15).** Per-proposition verdicts on a
  declared standard of proof (`kind 30063`) and words-vs-deeds integrity
  findings (`kind 30064`).
- **Moral lens (Phase 16).** Per-jurisdiction perspectival readings of
  normative / evaluative / framing assertions — a derived view only, no
  wire kind.
- **Complex content (Phase 18).** Tables and math, scholarly metadata,
  and PDF routing with pdf.js text + figure extraction.
- **Entity dossiers (Phase 19).** A provenance-pinned knowledge base
  where every fact links back to a published claim; publishable as an
  entity-signed fact sheet (`kind 30067`).
- **Cases (Phase 20).** Group captures into an investigation workspace,
  see the corpus as a dossier and graph, and run an optional LLM
  **corpus synthesis** brief over all member articles.
- **Durable entity identity (Phase 24).** Entity keys are
  deterministically derived from your primary key (recoverable across a
  keystore loss), with a `kind 30069` creator-binding manifest.
- **The Network client (Phase 25).** A standalone "truth-seeker" surface:
  follow researchers by npub, pull their published work newest-first, and
  incorporate others' claims **as proposals** on your own terms — plus an
  opt-in NIP-02 follow-list mirror (`kind 3`).
- **Corpus analysis, deepened (Phase 26).** Per-case **hypothesis maps**
  (competing answers, cruxes surfaced, no winner picked) and **structural
  counterfactuals** ("what depends on this claim") — both local-only, no
  scores, no wire kind.
- **Capture automation & hardening (Phase 27).** A flag-gated
  `#xray:capture` URL marker a driving agent can navigate to, plus EPUB
  book import, scholarly-reference / full-text enrichment (PMC, ar5iv,
  Crossref), corpus-synthesis v2, and selectable LLM models (Fable 5 /
  Sonnet 5 / Opus).
- **Corpus intake automation (Phase 28, in progress).** Batch-import a
  whole URL list (a pasted worksheet) into your archive and a case in one
  pass, optionally seed each page with parked LLM suggestions to review
  later, and get cross-article claim-link suggestions between sources —
  every suggestion still human-accepted.

The extension still captures across every shipped platform handler,
publishes end-to-end, syncs entity data across devices (`kind 30078`),
and reconstructs paywalled content from cached or relay copies. For the
full wire format, see [`docs/NIP_DRAFT.md`](docs/NIP_DRAFT.md).

The [**roadmap**](docs/ROADMAP.md) tracks per-phase scope; the
[**user guide**](docs/USER_GUIDE.md) is a complete feature-by-feature
walkthrough. The [**engineering journal**](docs/JOURNAL.md) logs
significant bugs, design decisions, and external-platform changes — worth
a skim when a capture target breaks. Before any release tag (or after a
cross-cutting refactor), run the [**smoke test**](docs/SMOKE_TEST.md) — a
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
- **PDFs & academic papers** — in-page PDF capture with page-anchored
  provenance (pdf.js text + figure extraction), plus scholarly-metadata
  enrichment for arXiv and PubMed Central (PMC).
- **Podcast transcripts, EPUB books & batch URL import** — import a
  transcript (URL-first, or paste / upload), an entire EPUB (one capture
  per chapter, grouped under a book entity), or a whole pasted URL list
  in one pass. All become markdown-canonical captures.
- **Entity system** — per-entity keypairs for people, organizations,
  places, things, and cases; keys are deterministically derived from your
  primary key (Phase 24) and recoverable across a keystore loss.
  Text-selection tagger in the reader, side-panel entity browser, alias
  resolution, provenance-pinned dossiers, and kind-0 profile publishing.
- **Claims, assessments & relationships** — structured claim events
  (`kind 30040`), entity↔article relationships (`kind 32125`), and typed
  claim↔claim links + personal assessments (`kind 30055` / `30054`). The
  old evidence `kind 30043` is retired. Stances and labels are opinions to
  debate, never automated verdicts.
- **Epistemic audits** — an eight-dimension journalistic-quality audit
  (`kind 30056`–`30061`) governed by [`docs/PHILOSOPHY.md`](docs/PHILOSOPHY.md);
  import a scorer-CLI JSON or run it in-extension (see LLM assist).
  Aggregates are computed in code with a knowability ceiling; a score
  never shows without its confidence.
- **Forensic findings** — a behavioral-pattern layer (`kind 30062`) that
  names structural maneuvers with a required counter-read and quoted
  evidence — structure, not a verdict on intent.
- **Truth adjudication** — per-proposition verdicts on a declared
  standard of proof (`kind 30063`), each carrying two-sided verbatim
  evidence, plus words-vs-deeds integrity findings (`kind 30064`).
  Descriptive, append-only, publish-gated.
- **Moral lens** — per-jurisdiction perspectival readings of normative /
  evaluative / framing assertions, grounded in each jurisdiction's own
  corpus. A derived view only — no wire kind, nothing published.
- **Entity dossiers** — a provenance-pinned knowledge base per entity
  where every fact links back to a published claim; publishable as an
  entity-signed fact sheet (`kind 30067`).
- **Cases & corpus synthesis** — group captures into an investigation
  workspace with a derived dossier and ego-graph; an optional, flag-gated
  LLM pass produces a grounded, source-linked brief over all member
  articles (and standalone cross-article claim-link suggestions),
  publishable as `kind 30023` + `kind 30068`.
- **Hypothesis maps & structural counterfactuals** — per-case competing
  answers with cruxes surfaced (no winner picked), and a "what depends on
  this claim" trace over the case graph. Both local-only, no scores.
- **Network client** — follow researchers by npub, pull their published
  work newest-first, and incorporate their claims as reviewable
  proposals; opt-in NIP-02 follow-list mirror (`kind 3`).
- **"My Archive" portal** — a full-tab, read-mostly view of everything
  you've published, reconciled against relays, with faceted filters and
  per-case dashboards.
- **LLM assist (opt-in)** — a **Suggest** pass proposes capture artifacts
  (entities + claims by default; relationships / assessments / findings
  opt-in) and an **in-extension auditor** (Quick / Thorough) runs the
  audit. Both require the `llmAssist` flag **and** your own Anthropic key;
  every result is a draft you review, and nothing auto-saves or publishes.
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

> **New to X-Ray?** The [**user guide**](docs/USER_GUIDE.md) is a
> complete, feature-by-feature walkthrough — setup, capturing, the
> reader, and the full judgment vocabulary (what "state fact" vs "event
> fact" means, the verdict states, the audit dimensions, the moral
> lens) with concrete examples.

- **Click the toolbar icon** to capture the active tab and open it in
  the **reader** — where you preview the article (Readable / Markdown),
  tag entities, mark claims, and publish. On `chrome://`, `file://`, or
  extension pages where the content script can't run, the click opens
  **Settings** instead.
- **`Cmd/Ctrl + Shift + X`** captures from the keyboard.
- **Right-click** a page (or the toolbar icon) → **Capture this page
  with X-Ray** does the same. The toolbar icon's right-click menu also
  opens: Entity Browser, My Archive, "Open a PDF by URL…", Settings…, and
  Capture tips (plus the Network page when its flag is on).
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
- **Advanced** — a **Reader** group (archive banner sensitivity) and a
  **Power user** group (debug logging plus engine-tuning overrides for
  article cache enabled/budget, min content length, and max claim
  length), then a Danger zone (clear all storage).

Quick-action buttons in the Options header (Capture Page, Entity
Browser, Capture tips) cover the jump-to-other-surfaces actions
without needing a separate popup.

## Layout

ES modules bundled by esbuild into **ten bundles** — one per entry point
(`npm run build` produces `dist/*.bundle.js`, which the manifest and HTML
shells load; there is no transpile step). The build also copies pdf.js
runtime assets (cmaps / standard fonts / wasm) into `dist/`.

```
.
├── manifest.json                  MV3 manifest (Chrome + Firefox)
├── icons/                         16 / 48 / 128 px
├── rules/
│   └── csp-strip.json             declarativeNetRequest: strip CSP so the
│                                  YouTube /api/timedtext fetch succeeds
├── esbuild.config.mjs             bundle entry points → dist/
├── src/
│   ├── background/index.js        SW: context menus, action click,
│   │                              message routing, relay pool, youtube
│   │                              transcript fetch, screenshot capture
│   ├── page/
│   │   ├── nip07-bridge.js        MAIN world (unbundled): window.nostr
│   │   │                          via postMessage envelope
│   │   └── api-interceptor.js     MAIN world: fetch/XHR hook for GraphQL
│   │                              response capture (FB / IG / YouTube)
│   ├── content/                   bootstrap + capture pipeline
│   │                              (openReader) + NIP-07 client + toast
│   ├── reader/                    reader page (Reader / Markdown /
│   │                              Preview, publish flow, claims &
│   │                              findings bars, audit / lens sections,
│   │                              pdf.js capture engine + worker)
│   ├── options/                   single settings hub (Relays /
│   │                              Signing / Advanced)
│   ├── sidepanel/                 entity browser + per-entity dossier
│   ├── portal/                    "My Archive" — reconciled published
│   │                              corpus, case dashboards, imports
│   ├── network/                   the Network client (Feed / Queue /
│   │                              Follows), flag-gated
│   └── shared/                    ~100 pure-ish modules imported by the
│       │                          bundles above. Highlights:
│       ├── crypto.js              secp256k1 / BIP-340 / bech32 / NIP-44 v2
│       ├── signer.js              unified Local / NIP-07 / NSecBunker
│       ├── storage.js             chrome.storage wrapper (source of truth)
│       ├── content-{detector,extractor}.js   platform detection +
│       │                          Readability / Turndown → Markdown
│       ├── event-builder.js       NIP-23 / 30040 / 30041 / 32125 builders
│       │                          (+ metadata/, audit/, truth-builders.js,
│       │                          forensic-*, entity-*, corpus-publish.js,
│       │                          follow-publish.js for the other kinds)
│       ├── local-key-manager.js   derived per-entity keypair registry
│       ├── entity-{model,sync,dossier,facts}.js   entities, NIP-78 sync,
│       │                          provenance-pinned dossiers
│       ├── case-{dossier,graph,membership,synthesis,export}.js  cases
│       ├── hypothesis-*.js / case-counterfactual.js   Phase 26 analysis
│       ├── url-import.js          Phase 28 batch URL-list import
│       ├── {follow,network}-*.js / incorporation.js   the network layer
│       ├── archive-cache.js       IndexedDB cache + paywall reconstruction
│       ├── llm-*.js / lens-*.js / *-modal.js   LLM assist + authoring UI
│       └── platforms/             substack, youtube (+ comments), twitter,
│                                  facebook, instagram, tiktok, arxiv, pmc,
│                                  scholar-meta, comment-extractor, …
└── tests/                         node --test suite (2026 passing)
```

## Permissions

- `storage` — persist preferences, entities, keypair registry, primary
  identity.
- `notifications` — surface publish results as native notifications.
- `scripting`, `activeTab` — forward action / context-menu commands to
  the content script; inject the api-interceptor on FB / IG / YouTube.
- `contextMenus` — shortcuts on the toolbar icon's right-click menu.
- `sidePanel` — entity-browser side panel.
- `declarativeNetRequest` — strip CSP for the YouTube transcript fetch.
- `<all_urls>` host permission — read the current page, query NOSTR
  relays over WebSocket, fetch titles for related-link submissions, and
  batch-import a pasted URL list.
- `https://api.anthropic.com/*` host permission — the opt-in LLM-assist
  features (Suggest, epistemic auditor, moral lens, corpus synthesis)
  call the Anthropic API with **your own** key; X-Ray never proxies.

## Development notes

- **Build:** `npm install`, then `npm run build` to produce
  `dist/*.bundle.js` and `dist/*.bundle.js.map`. esbuild handles all
  bundling; no transpile step. `npm run watch` for incremental.
- **Tests:** `npm test` runs `node --test tests/*.test.mjs`. **2026
  tests** across 153 files today, covering crypto, event-builder, every
  platform handler, entity sync/identity, claim model, archive cache, the
  Signer façade, the URL normalizer, and the assessment / audit /
  forensic / truth-adjudication / moral-lens / case / network model and
  wire layers.
- **MAIN-world bridge** — `src/page/nip07-bridge.js` is injected into
  the page's main world (`content_scripts[0].world: "MAIN"` in the
  manifest) and exposes `window.nostr` to the extension via tagged
  `window.postMessage` envelopes.
- **API interception** — `src/page/api-interceptor.js` runs in the
  page's main world on Facebook / Instagram / YouTube and posts captured
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

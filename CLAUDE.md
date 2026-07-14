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
npm test               # node --test tests/*.test.mjs  (1277 tests, must be green)
npm run lint           # web-ext lint --self-hosted (what CI gates on)
npm run version:set X  # bump package.json + manifest.json in lockstep
npm run clean          # rm -rf dist
```

- **Run a single test file:** `node --test tests/youtube-comments.test.mjs`
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

`esbuild.config.mjs` produces seven bundles from entry points. The manifest
and HTML shells reference `dist/*.bundle.js`; **`src/` is never loaded
directly except the two MAIN-world page scripts.** Entry points:

- `src/content/index.js` → `content.bundle.js` (IIFE, isolated world, every tab)
- `src/background/index.js` → `background.bundle.js` (**ESM** service worker, `conditions: ['worker','browser']`)
- `src/options|sidepanel|reader|portal/index.js` → matching IIFE bundles (loaded by their HTML shells)
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
3. **Extension pages** (`src/options/`, `src/reader/`, `src/sidepanel/`,
   `src/portal/`) — options is the single settings hub (Relays / Signing /
   Advanced); reader renders the captured
   article + publish flow; sidepanel is the entity browser; portal is the
   full-tab "My Archive" page (Phase 12) — a read-only view of everything
   published, reconciled against relays.
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
`xray:relay:query`, `xray:sign`, `xray:youtube:fetchTranscript`,
`xray:screenshot:capture`, `xray:llm:suggest`, `xray:audit:run`). When adding a cross-context
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
- **`event-builder.js`** — builds the NOSTR events (NIP-23 `30023` — now
  carrying the canonical-article-hash `x` tag, Phase 13.4 — claims
  `30040`, comments `30041`, entity profiles `0`, entity↔article
  relationships `32125`, platform accounts `32126`, relay lists `10002`,
  entity-sync `30078`) and the archive-reader inverses. Evidence kind
  `30043` is retired (Phase 11); assessments `30054`, cross-claim
  relationships `30055`, and their kind-`1985` label mirrors are built in
  `metadata/builders.js`; the epistemic-audit family `30056`–`30061` in
  `audit/builders.js`; forensic findings `30062` in
  `forensic-model.js`/`forensic-publish.js`; truth adjudication —
  verdicts `30063` (with a kind-`1985` mirror on the claim coordinate)
  and integrity findings `30064` (deliberately no mirror), `30065`
  reserved — in `truth-builders.js`; entity fact sheets `30067`
  (Phase 19.7 — entity-signed, every fact `a`-refs a published claim)
  plus the enriched kind-`0` `about` in `entity-profile.js`.
  **Wire-format changes in any of these have compatibility
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
- **Truth adjudication (Phase 15)** — `truth-taxonomy.js` (proposition
  classes, verdict states, standards of proof, the §3.1 firewall
  predicates), `truth-adjudication-model.js` (propositions + append-only
  verdict chains), `integrity-model.js` (words-vs-deeds findings),
  `truth-attestation.js` (evidence tiers + convergence),
  `truth-entity-record.js` (computed-on-read entity records),
  `truth-publish.js` (publish selection), `adjudicate-modal.js` /
  `integrity-modal.js` (reader authoring UI). Publishing is gated behind
  `truthAdjudicationPublishing` (default off).
- **Moral lens (Phase 16)** — `lens-taxonomy.js` (jurisdiction types,
  the four lens assertion types, dispositions, admissibility),
  `jurisdiction-model.js` (the local jurisdiction registry — key
  `lens_jurisdictions`; zero built-ins), `lens-schemas.js` (the §7
  contract validators, over the shared `schema-walker.js`),
  `lens-prompt.js` (`LENS_PROMPT_VERSION`), `lens-engine.js` (pre-flight
  refusals, code-side assembly, panel composition, the session-ONLY
  cache — deliberately no `storage.local` fallback),
  `reader/lens-section.js` (pure HTML renderers). One `xray:lens:read`
  call per jurisdiction; gated by `moralLens` + the API key,
  independent of `llmAssist`. **No wire kind** — 30066 stays free and
  the 16.4 guards machine-check it; "Verdict/Ruling/Opinion/Court/
  Integrity" never appear in lens exports, storage keys, or UI strings.
- Also: `nostr-client.js` (relay pool, used from background),
  `archive-cache.js` (IndexedDB + paywall reconstruction),
  `build-info.js` (the build stamp shown on the Options page).

## Conventions

- **Indentation: 4 spaces** in JS authored here; **2 spaces** in files
  ported verbatim from the userscript (preserved so userscript diffs stay
  readable). Match the file you're editing.
- **`config.js` carries snake_case keys** (e.g. `min_content_length`) to
  match the v4 userscript for drop-in module portability, with some
  camelCase legacy aliases kept alongside. Don't "tidy" these casings.
- **CSS prefixes:** everything is `xr-*` now — extension-chrome UI
  (options/reader/side panel), content-script UI, and the capture-pipeline
  markers in `content-extractor.js` (`xr-tweet-embed`, `xr-fb-*`,
  `xr-inline-img`, … — class names on cloned nodes the Turndown rules match
  to build Markdown, not UI). The legacy `nac-*` / `nmd-*` prefixes are
  fully gone; don't reintroduce them.
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
- **Private keys:** `local_primary_identity` and the per-entity keys in
  `LocalKeyManager` (`local_keys`) hold private keys in
  `chrome.storage.local` — never paste their contents into
  issues/logs/commits. Raw event JSON is fine (`pubkey` is public by
  definition).
- **Commit messages:** imperative present tense; `fix:`/`feat:`/`chore:`/
  `docs:`/`ci:` prefixes, scope in parens when useful
  (`fix(youtube): …`). One concern per PR.

## Project docs (read these for non-trivial work)

- **`docs/ROADMAP.md`** — per-phase scope. Currently through Phase 20
  (manifest still says v0.6.0 — untagged; see CONTRIBUTING for the
  tag-driven release process). Complete and merged: Phases 10 (thin
  claims), 11 (assessments; `docs/ASSESSMENTS_DESIGN.md`), 12 (portal;
  `docs/PORTAL_DESIGN.md`), 13 (epistemic audits, kinds `30056`–`30061`;
  `docs/EPISTEMIC_AUDIT_DESIGN.md`), 14 (forensic findings, kind `30062`;
  `docs/CRIMINOLOGY_DESIGN.md`), 14.5 (in-extension LLM assist +
  LLM auditor; `docs/PHASE_14_5_LLM_ASSIST_KICKOFF.md`), 15 (truth
  adjudication, kinds `30063`/`30064`, merged as PR #89;
  `docs/TRUTH_ADJUDICATION_DESIGN.md` — its precedent/bridging tail is
  deferred), 16 (moral lens, NO wire kind — derived view only;
  `docs/MORAL_LENS_JURISDICTION_DESIGN.md`, amended 2026-07-03 — the
  amendment governs; its wire-kind/portal/durable-cache tail is
  deferred), 17 Part A (entity health + canonical sweep;
  `docs/ENTITY_CORPUS_DESIGN.md` — E2/E4–E6 still design-only), and 19
  (entity dossiers — facts on claims, the dossier assembler + UI,
  Add-fact, LLM facts default-off, publishing behind
  `entityCorpusPublishing` with the NEW kind `30067` fact sheet;
  `docs/ENTITY_DOSSIER_DESIGN.md`), and 20 (case-first: union
  membership, add-to-case outside the reader, the local case graph, and
  the flag-gated LLM corpus synthesis — a grounded brief + reviewable
  proposals behind `caseSynthesis`, NO new wire kind, brief in the
  `xray-audits` v2 `case-briefs` store; `docs/CASE_SYNTHESIS_DESIGN.md`).
  The FLF Epistack competition
  (deadline 2026-07-19) is being pursued **maintainer-driven from real
  use cases (COVID first)** — there is no committed sprint plan; the tool
  is tailored from that experience. Several SMOKE_TEST section walks
  (Phases 11–16, 19) are still pending — they're manual and need a human
  with a browser.
- **`docs/JOURNAL.md`** — chronological log of bugs, design decisions, and
  external-platform changes. **Add a tight entry** when fixing a non-obvious
  bug, making a second-guessable design choice, or working around a
  third-party change. Skim it first when a capture target breaks.
- **`docs/SMOKE_TEST.md`** — ~20-min manual checklist; run before any
  release tag or after a cross-cutting refactor.
- **`docs/CAPTURE_GUIDE.md`** — per-platform URL-shape/timing requirements
  (FB/IG/TikTok are finicky).
- **`docs/NIP_DRAFT.md`** — the crowdsourced-metadata wire format.
- **`docs/PHILOSOPHY.md`** — the **normative** constitution of the
  Phase-13 epistemic auditor (v1.0.0). Consult it before any
  structural, scoring, schema, or methodology change to audit
  surfaces; when code and it conflict, it governs until amended.
  When two of its principles conflict, document the tension and cite
  them by number (e.g. "P9 over convenience"). Scope note: it governs
  the audit family (`30056`–`30061`); Phase 15 truth verdicts operate
  under `TRUTH_ADJUDICATION_DESIGN.md`'s own form-of-judgment (§1/§5)
  — deliberately no 0–100 score or knowability ceiling there.
- **`CONTRIBUTING.md`** — release process (git-tag-driven via
  `.github/workflows/release.yml`) and the Firefox-floor rationale.

## CI

`.github/workflows/ci.yml` on push/PR to `main`: `node --check` every
`src/**/*.js`, `npm run build`, `npm test` (if any tests exist), `web-ext
lint --self-hosted`, `web-ext build`. A `v*` tag triggers `release.yml`
(builds, packages, creates a GitHub Release with the `.zip`). Get all of
build + test + lint green locally before pushing.

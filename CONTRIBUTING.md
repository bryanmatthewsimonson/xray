# Contributing to X-Ray

Thanks for your interest in helping out. X-Ray is a small, low-ceremony
codebase — here's what you need to know.

## Project shape

- **esbuild bundle, ES modules.** Phase 0 replaced the original
  ordered-script-tag layout with per-entry-point bundles. The
  manifest loads `dist/*.bundle.js`. No TypeScript, no transpile, no
  framework.
- **Flat repo root.** `manifest.json` sits at the root so
  `Load unpacked` points at the clone directly.
- **Phase tracker.** Before starting non-trivial work, check
  [`docs/ROADMAP.md`](docs/ROADMAP.md) and the relevant phase issue.
  Sub-phase progress belongs as comments on the phase issue, not as
  orphan branches.
- **Engineering journal.** [`docs/JOURNAL.md`](docs/JOURNAL.md) is
  the chronological log of bugs, design decisions, and external
  platform changes. **Add an entry** when fixing a bug whose root
  cause isn't obvious from the diff, when making a design choice
  future-you might reasonably second-guess, or when working around
  something a third party changed. Keep entries tight.
- **Smoke test.** [`docs/SMOKE_TEST.md`](docs/SMOKE_TEST.md) is the
  ~20-minute manual checklist that exercises every shipped surface
  across Phases 0–7. Run it before any release tag, after any
  cross-cutting refactor, or when adding a new contributor to the
  project. File one issue per defect found.
- **Shared modules** live at `src/shared/`. Platform handlers live at
  `src/shared/platforms/`; they run in the content script and return
  plain data objects (no DOM mutation, no UI).

## Dev setup

```sh
npm install            # installs esbuild + readability + turndown + dev deps
npm run build          # produces dist/*.bundle.js
npm test               # node --test over tests/*.test.mjs
```

Then:

1. Chrome/Chromium/Brave/Edge: `chrome://extensions` → Developer mode
   → Load unpacked → point at the clone.
2. Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary
   Add-on → pick `manifest.json`.
3. Rebuild after edits (`npm run build` or `npm run watch`), then
   click the reload icon on the extension card. **Content scripts
   don't re-inject on extension reload** — you also have to reload
   (or navigate) any tab you're testing in.

Optional:

```sh
npm i -g web-ext
web-ext run            # launches Firefox with the extension loaded
web-ext lint           # what CI runs
web-ext build          # produces a .zip in web-ext-artifacts/
```

## Code conventions

- **Indentation:** 4 spaces in JS authored here; 2 spaces in files
  ported verbatim from the userscript (preserved so diffs against the
  userscript stay readable).
- **CSS class prefixes:**
  - `xr-*` — extension-chrome UI (popup, options, reader, side panel).
  - `nac-*` / `nmd-*` — legacy userscript prefixes; avoid in new
    files.
- **Logging:** use `Utils.log` / `Utils.error`. They're no-ops when
  `CONFIG.debug` is false.
- **User-visible strings** use "X-Ray" (with a hyphen). Avoid emoji
  in code unless it's genuinely part of the UI.
- **Commit messages:** imperative present tense, prefixes like
  `fix:`, `feat:`, `chore:`, `docs:`, `ci:` welcome. Scope in
  parens when useful (`fix(youtube): …`).

## Testing before you submit

- `npm test` green.
- `npm run build` green (no errors, no new warnings).
- Load in Chrome and smoke-test whatever path you touched end to
  end. For platform handlers: capture + publish on a live page, not
  just a static fixture.
- Load in Firefox and repeat. Firefox catches different edge cases
  than Chrome, especially around `chrome.runtime` timing and strict
  CSP.

`web-ext lint` must pass. CI runs it on every push and PR.

## Signing key safety

- The **keypair registry** in `chrome.storage.local` contains private
  keys. Never paste its contents into issues, screenshots, or logs.
- When reporting a bug, the raw event JSON is fine; its `pubkey` field
  is by definition public.

## Filing issues

Use the templates — they ask for browser + version + reproduction
steps, which are the three things we always need. Low-friction bug
reports beat carefully-written ones: "it broke on this URL" with a link
is more useful than a detailed report that omits the URL.

## Pull requests

- One concern per PR. Don't rename + refactor + add a feature in one go.
- Flag behavior changes that affect the NOSTR event wire format
  explicitly — those have compatibility consequences for anyone
  consuming X-Ray's events.
- Screenshots help for any UI change.

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

## Firefox version floor

`manifest.json` pins `browser_specific_settings.gecko.strict_min_version`
to **128.0**. Don't lower this without re-verifying — three
independent APIs we depend on land in exactly that version:

- `content_scripts[].world: "MAIN"` — the NIP-07 bridge relies on
  running in the page's main world. Before FF 128 this had to be
  done by dynamic injection, which we've removed.
- `browser.scripting.executeScript({ world: "MAIN" })` — used by
  the background service worker for a few page-context calls.
- `declarativeNetRequest` `modifyHeaders` with `responseHeaders` —
  `rules/csp-strip.json` strips `Content-Security-Policy` so the
  YouTube transcript fetch can reach `/api/timedtext` without the
  page CSP blocking it. Before FF 128, only `requestHeaders` were
  writable.

128 is also the current Firefox ESR baseline (ESR 128.x), so every
ESR install can run X-Ray without sacrificing reach. Bumping past
128 gains nothing for any API we currently use — don't move this
floor forward just because a newer ESR exists; move it only when a
new dependency requires it.

## Cutting a release

X-Ray uses git tags to drive releases. Pushing a tag matching `v*`
triggers `.github/workflows/release.yml`, which builds, packages,
and creates a GitHub Release with the `.zip` attached.

Steps:

1. **Bump versions in lockstep.** `package.json` and `manifest.json`
   both carry the version and they MUST agree (CI rejects a mismatch).
   The helper handles both:

   ```sh
   npm run version:set 0.3.0
   ```

2. **Update `CHANGELOG.md`.** Move items out of `[Unreleased]` into a
   new `[0.3.0]` section with today's date. The release workflow
   pulls this section verbatim into the GitHub Release body, so
   write it for a release-notes audience.

3. **Run the smoke test** ([`docs/SMOKE_TEST.md`](docs/SMOKE_TEST.md))
   in Chrome and Firefox. File issues for anything that breaks; only
   tag once the breakages are fixed or explicitly accepted as
   release-blockers triaged out.

4. **Commit, tag, push.**

   ```sh
   git add package.json manifest.json CHANGELOG.md
   git commit -m "release: v0.3.0"
   git tag v0.3.0
   git push && git push --tags
   ```

5. CI runs `release.yml`. When green, the GitHub Release exists with
   the `.zip` attached. From there:
   - **Chrome Web Store**: upload the `.zip` via the developer dashboard.
   - **Firefox AMO**: `web-ext sign --channel=listed` against the
     same source tree, OR upload the same `.zip` to AMO and let
     review run.

If a release run fails partway, fix the underlying issue, delete the
tag (`git tag -d v0.3.0 && git push --delete origin v0.3.0`), and
re-tag — or use the workflow's manual dispatch with the existing
tag if the source tree doesn't need to change.

## Pull requests

- One concern per PR. Don't rename + refactor + add a feature in one go.
- Flag behavior changes that affect the NOSTR event wire format
  explicitly — those have compatibility consequences for anyone
  consuming X-Ray's events.
- Screenshots help for any UI change.

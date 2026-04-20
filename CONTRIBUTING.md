# Contributing to X-Ray

Thanks for your interest in helping out. X-Ray is a small, low-ceremony
codebase — here's what you need to know.

## Project shape

- **No build step.** Content scripts load directly in the order listed
  in `manifest.json`. There's no bundler, no TypeScript, no transpile
  step. Keep it that way unless we hit a concrete wall.
- **Flat repo root.** `manifest.json` sits at the root so `Load
  unpacked` points at the clone directly.
- **One file per module.** Each content script declares its module as a
  top-level `var Foo = { ... }` so later files in the list can see it.
  (We use `var` instead of `const` because each `<script>` the browser
  injects gets its own lexical scope, but `var` leaks to the shared
  script-global.)

## Dev setup

1. Clone the repo.
2. Chrome/Chromium/Brave/Edge: `chrome://extensions` → Developer mode →
   Load unpacked → point at the clone.
3. Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary
   Add-on → pick `manifest.json`.
4. Edit, hit reload on the extension card (or `web-ext run` if you
   prefer hot-reload; see below).

Optional but nice:

```sh
npm i -g web-ext
web-ext run            # launches Firefox with the extension loaded
web-ext lint           # what CI runs
web-ext build          # produces a .zip in web-ext-artifacts/
```

## Code conventions

- **Indentation:** 4 spaces in JS files authored here; 2 spaces in files
  ported verbatim from the userscript (preserved on purpose so diffs
  against the userscript stay readable).
- **CSS class prefixes:**
  - `nac-*` — content-script capture UI (from the userscript)
  - `nmd-*` — content-script metadata UI (from the userscript)
  - `xr-*` — extension-chrome UI (popup, options)
- **Logging:** use `Utils.log` / `Utils.error` in content scripts.
  They're no-ops when `CONFIG.debug` is false.
- **User-visible strings** use "X-Ray" (the product name, with a hyphen).
  Avoid emoji in code unless it's genuinely part of the UI (badges,
  status indicators).
- **Commit messages:** imperative present tense, one short subject line,
  wrap body at ~72 cols. We're not strictly
  [Conventional Commits](https://www.conventionalcommits.org/), but
  prefixes like `fix:`, `feat:`, `chore:`, `docs:`, `ci:` are welcome
  and make changelogs easier.

## Testing before you submit

- Load in Chrome and verify the FAB appears, the panel opens, all three
  tabs render, and at least the Markdown copy/download path works end
  to end.
- Load in Firefox and repeat. Firefox catches different edge cases than
  Chrome, especially around `chrome.runtime` timing and strict CSP.
- If you touched anything relay-adjacent: verify publishing to a real
  relay succeeds, not just that the event is built correctly.

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

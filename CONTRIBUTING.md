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
- **Engineering journal.** The JOURNAL is the chronological log of
  bugs, design decisions, and external platform changes. Entries live
  in `docs/journal/YYYY-MM.md` — one file per month, oldest first.
  **Append a new entry at the BOTTOM** of the current month's file,
  then run `npm run docs:journal` to regenerate the index at
  [`docs/JOURNAL.md`](docs/JOURNAL.md) (generated — never edit it by
  hand; `tests/journal-index.test.mjs` fails when it is stale).
  **Add an entry** when fixing a bug whose root cause isn't obvious
  from the diff, when making a design choice future-you might
  reasonably second-guess, or when working around something a third
  party changed. Keep entries tight.
  **The generator never discards text.** When `npm run docs:journal`
  refuses (exit 1) it has listed what it does not recognise — a
  heading that is not `## YYYY-MM-DD — title` on a calendar date, or
  an entry in the index whose heading already exists in its month with
  a different body — and written nothing. Fix the heading; or make the
  edit in the monthly file and delete the copy from the index.
  **A branch from before the split** (its entry prepended into
  `docs/JOURNAL.md`) has two ways home, both one command past the
  merge: `git rebase origin/main` does not conflict (the union rule
  comes from main) and leaves your entry in the index, then `npm run
  docs:journal` moves it into its month; `git merge origin/main`
  CONFLICTS in `docs/JOURNAL.md` (git reads the union rule from the
  side you have checked out, which does not have it yet) — do not
  hand-resolve: run `npm run docs:journal` on the conflicted file
  (the markers are boundaries to it), `git add docs/JOURNAL.md
  docs/journal`, commit. GitHub's "Update branch" button is that
  merge and will report the conflict; resolve it locally the same way.
  **Why `main` never carries a stale index.** Two PRs that each append
  to the same month and each regenerate the index would union in merge
  order while the generator sorts — but `main`'s branch protection
  requires an up-to-date branch, so the second PR merges `main` first,
  its CI runs the drift guard on the merged tree, and a stale index is
  red there, one `npm run docs:journal` from green. No bot writes to
  `main`. If that protection is ever relaxed, the same guard goes red
  on `main`'s own push CI: loud, never silent.
- **Smoke test.** [`docs/SMOKE_TEST.md`](docs/SMOKE_TEST.md) is the
  manual checklist that exercises every shipped surface, phase by phase.
  Run it before any release tag, after any cross-cutting refactor, or
  when adding a new contributor to the project. File one issue per
  defect found.
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
- **CSS class prefixes:** everything is `xr-*` now — the
  extension-chrome UI (options / reader / side panel / portal /
  network), the content-script UI, and the capture-pipeline markers
  in `content-extractor.js` (class names on cloned nodes the Turndown
  rules match, not UI). The legacy `nac-*` / `nmd-*` userscript
  prefixes are fully gone; don't reintroduce them.
- **Logging:** use `Utils.log` / `Utils.error`. They're no-ops when
  `CONFIG.debug` is false.
- **User-visible strings** use "X-Ray" (with a hyphen). Avoid emoji
  in code unless it's genuinely part of the UI.
- **Commit messages:** imperative present tense, prefixes like
  `fix:`, `feat:`, `chore:`, `docs:`, `ci:` welcome. Scope in
  parens when useful (`fix(youtube): …`).

## Testing before you submit

- `npm test` green.
- `npm run docs:journal -- --check` exits 0 — the JOURNAL index matches the monthly files (the drift guard in `tests/journal-index.test.mjs`; a new entry means a regenerated `docs/JOURNAL.md` in the same PR).
- `npm run build` green (no errors, no new warnings).
- `npm run smoke` green — the browser smoke loads the built extension
  in headless Chromium (`npx playwright install chromium` once per
  machine). CI runs the same scenarios; `pages` gates every PR (every
  extension page must run its init to the ready stamp with no uncaught
  exception and no product `console.error`), the MA.6 walk is advisory
  until the flip recorded in `docs/JOURNAL.md` 2026-09-07. A new
  extension page joins `pages` by ending its init with
  `markReady('<dir>')` (`src/shared/smoke-anchors.js`).
- The golden fixtures still pass. `tests/fixtures/{idb,wire,backup}/`
  pin every shipped IndexedDB schema rung, every emitted NOSTR kind,
  and the backup envelope; `tests/structure-guards.test.mjs` pins the
  import graph, the message set, and per-surface ceilings (all
  shrink-only). If you bumped a `DB_VERSION`, changed a builder's
  tags/content, or changed the backup envelope, regenerate with
  `node tests/tools/gen-{idb,wire,backup}-fixtures.mjs`, commit the
  diff, and call the change out in the PR (`Wire format:` for
  anything a relay consumer would see). A fixture diff you did not
  intend is a regression, not a fixture to refresh.
- Load in Chrome and smoke-test whatever path you touched end to
  end. For platform handlers: capture + publish on a live page, not
  just a static fixture.
- Load in Firefox and repeat. Firefox catches different edge cases
  than Chrome, especially around `chrome.runtime` timing and strict
  CSP.

`web-ext lint` must pass. CI runs it on every push and PR.

## Branch hygiene

`scripts/branch-hygiene.mjs` enforces RESET_PLAN §9's branch rules
(the weekly `hygiene.yml` runs it report-only; enforcement happens only
when a human dispatches it with `--apply`):

- `main` is never touched; neither is any branch with an open PR.
- A branch whose tip is already an ancestor of `main` is deleted, no tag.
- A branch with no open PR and no commit for fourteen days is tagged
  `archive/<name-with-slashes-as-dashes>-<yyyymmdd of the tip>` and then
  deleted — the tag lands first, and the delete is refused if it did not.
- Branch names are `<lane>/<topic>` (`fix/…`, `feat/…`, `docs/…`,
  `claude/…`); violations are reported, never acted on.
- At most four open non-dependabot PRs (drafts count); over the cap the
  apply run opens or updates one tracking issue.

Local dry run (nothing is written without `--apply`; needs a full-history
clone and an up-to-date `origin/main`):

    node scripts/branch-hygiene.mjs --today YYYY-MM-DD --json /tmp/hygiene.json

Restore an archived branch:

    git fetch origin tag archive/<x> && git checkout -b <lane>/<topic> archive/<x>

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

4. **Commit, tag, push.** `main` is protected: land the version bump
   through a PR first, then tag the merged commit.

   ```sh
   git tag v0.3.0
   git push --tags
   ```

5. **Approve the deployment.** The release job runs in the `release`
   environment, which has a required reviewer. The run pauses at
   *Actions → the run → Review deployments → Approve and deploy*. This
   is deliberate: a `v*` tag alone must not be able to mint a release
   artifact, because that artifact is what goes to the stores.

6. When green, the GitHub Release exists with the `.zip` attached.
   From there:
   - **Chrome Web Store**: upload the `.zip` via the developer dashboard.
   - **Firefox AMO**: `web-ext sign --channel=listed` against the
     same source tree, OR upload the same `.zip` to AMO and let
     review run.

### When a release run fails partway

`v*` tags are protected against **deletion and force-update**, so the old
"delete the tag and re-tag" recovery no longer works — a released version
number is immutable on purpose, so a given tag always means one artifact.
Two paths instead:

- **The source tree is fine** (transient CI failure, a botched approval):
  re-run via the workflow's `workflow_dispatch`, passing the existing tag.
- **The source tree needs a fix**: land the fix and cut the next patch
  version. Burn the bad number.

If you genuinely must remove a tag, the tag ruleset has to be relaxed
first — that's an admin action on `Settings → Rules`, and it should be
put back afterwards.

## Pull requests

- One concern per PR. Don't rename + refactor + add a feature in one go.
- Fill in the template's **Contract** lines (RESET_PLAN §8):
  `Verification layer:`, `Wire format:` when a wire-lane builder or
  publisher changed, `Docs:`, `Interpretive steps (n):`, and
  `Cross-lane: <reason>` if your `src/` edits span more than one lane
  (`scripts/lanes.mjs`). A `fix:` PR needs a `tests/` change or a
  `no-test rationale:` line; a PR touching a process file (`.github/**`,
  `.claude/skills/**`, `docs/SMOKE_TEST.md`, this file, `CLAUDE.md`)
  adds a JOURNAL entry or cites one as "JOURNAL YYYY-MM-DD". The
  `PR body` workflow (`scripts/pr-body-check.mjs`) checks all of it and
  prints one line per failure with the fix; it re-runs when you edit the
  description. It is not a required check unless the maintainer makes it
  one in branch protection. Dependabot PRs are skipped.
- Flag behavior changes that affect the NOSTR event wire format
  explicitly — those have compatibility consequences for anyone
  consuming X-Ray's events.
- Screenshots help for any UI change.

## Governance

Mirrors [`docs/CONSTITUTION.md`](docs/CONSTITUTION.md) Art. 11 and
Art. 13 — the constitution governs where this summary and it disagree.

- **Merge authority.** The maintainer's explicit, recorded instruction
  approves every change to `main` and is the ratifying act for any
  normative change. Who presses the merge button is mechanical. Agents
  (Claude) author PRs. The instruction is recorded in the maintainer's
  own words, on the PR or in [`docs/RULINGS.md`](docs/RULINGS.md),
  before the merge. A standing instruction counts only as a ledger row,
  in the maintainer's own words, that names the class of change it
  covers.
- **Decision recording.** Every decision that accepts a design, kills
  a feature, or resolves an open question gets a JOURNAL entry
  (appended at the bottom of `docs/journal/YYYY-MM.md`; the index at
  [`docs/JOURNAL.md`](docs/JOURNAL.md) is regenerated) with date and
  rationale. A maintainer ruling is also a row in
  [`docs/RULINGS.md`](docs/RULINGS.md) that quotes the maintainer's own
  words; the JOURNAL entry cites its R-id instead of restating it.
  Agent–maintainer disagreements are recorded, not silently resolved.
- **Markers** (RESET_PLAN §4.4 item 1; adopted by R-022). A constraint
  stated in a design doc, kickoff, PR body, guard-test header or
  prompt file carries one of three markers:
  `[RULING: maintainer YYYY-MM-DD R-id]` — the maintainer decided; the
  R-id is a row in [`docs/RULINGS.md`](docs/RULINGS.md).
  `[INTERPRETATION: <agent>, YYYY-MM-DD — default: <x>; ask: <one line>]`
  — an agent's reading, with its suggested default and one question
  for the maintainer.
  `[ENGINEERING-FACT: <measured how>]` — something measured.
  A constraint in those places with no marker is an INTERPRETATION.
  A guard test carries `// Provenance: R-NNN` or
  `// Provenance: INTERPRETATION (YYYY-MM-DD) — expires <date+90d>`
  (RESET_PLAN §4.4 item 3); `scripts/provenance-expiry.mjs` lists
  expired ones weekly and never fails a build;
  `tests/rulings-guards.test.mjs` fails on an R-id the ledger lacks.
- **Kill-and-revisit.** Kills are recorded with rationale and left
  git-recoverable. A killed plan is not frozen doctrine — inherited
  decisions may be re-argued on merits. Only an explicit red line
  requires a constitutional (Tier-1) amendment to reverse.
- **Amendment tiers.** Tier 1: constitution articles and red lines
  (version bump + dated log entry + rationale + stated accepted
  failure mode). Tier 2: normative sections of design docs (inline
  "Amended <date> — the amendment governs"). Tier 3: implementation
  details (ordinary PR).
- **Guards stay green.** PRs touching normative docs must keep
  `tests/constitution-guards.test.mjs` (and every family's guard
  tests) green. A red guard is a bug or an unratified amendment.

## The soak rule (adopted 2026-08-23, maintainer ruling)

A PR that changes runtime behavior — features and behavioral fixes
alike — is **not merged the day it is opened**. It sits on its branch
through at least one real casework session with the branch loaded in
the maintainer's browser, and merges only after that use.

Why, from the record: during the 2026-08 direct-cloud wave, every
field-found defect was discovered within hours of real use — five of
them AFTER same-day merges, each requiring a follow-up PR to main. The
same discovery one day earlier is the same bug caught pre-merge. The
suite cannot observe what a person sees (docs/JOURNAL.md 2026-08-16,
three entries), so real use IS a verification layer, and the soak is
how it runs before merge instead of after.

Exempt: documentation-only and skill-only changes, and CI-config
changes — nothing a browser session can observe. The maintainer may
waive the soak explicitly for an urgent fix; waiving it silently is how
the wave shipped its bugs.

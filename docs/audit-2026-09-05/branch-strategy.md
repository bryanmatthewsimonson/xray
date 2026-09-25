# Branch-strategy lens — fresh-eyes audit of X-Ray (2026-09-06)

Discipline run: `continuous-improvement` Protocol (trigger: the maintainer's
"how do we subordinate all existing branches… multiple threads… reliable
tested code") + `hand-to-maintainer` for every check a human still owes.
All numbers below were measured in this container against `origin` fetched
2026-09-05/06; the git commands are quoted so they can be re-run.

## Verdict

The branch situation is smaller and simpler than the briefing describes,
and the process around it is more broken than the branch count suggests.
**The "pre-reset, unmergeable" group does not exist.** The container's
clone was shallow (`.git/shallow` held four graft points; `git rev-parse
--is-shallow-repository` → `true`); after `git fetch --deepen=800 origin
main` the repository is no longer shallow, `origin/main` has 904 commits
back to the 2026-04-19 initial commit, and **65 of the 79 remote branches
are plain ancestors of `main`** (`git merge-base --is-ancestor` → merged,
`rev-list --left-right --count` → `N/0`). Every one of the six sampled
"pre-reset" branches (`feat/opinion-modules-op2`, `claude/personas-college`,
`feat/reference-resolver`, `claude/ai-vision-image-text-dfbwt6`,
`feat/known-unknowns-block`, `claude/identity-rename-workspace-rebind`) plus
`claude/truth-systems-annex`, `chore/security-hardening` and
`claude/flf-competition-entry-1xeffq` is MERGED. The only genuinely
unmerged old branch is `feature/phase-9b-metadata-ui` (6 unique commits,
2026-05-29), which JOURNAL 2026-07-03 already ruled "kept". So the
disposition for the old group is not "archive as tags" — the commits are
already reachable from `main`, a tag adds nothing — it is *delete*.

What is broken is throughput, and the cause is structural, not effort.
`main` has had **zero commits since 2026-08-28** and the last soak-walk
record is 2026-08-25, while six behavior-changing PRs (#368, #369, #370,
#373, #374, #324) wait on the soak rule, which makes the maintainer's
browser the *only* observer for everything the unit suite cannot see.
The JOURNAL records the suite green while behavior was wrong seven times
in August; the soak rule (CONTRIBUTING, 2026-08-23) was the right diagnosis
and the wrong mechanism — it serialises every PR through one person's
weekday. Meanwhile the one working browser-level observer,
`tools/smoke/ma6-walk.mjs`, runs end to end in this CI-shaped container
(~2 min) and is in no workflow (ROAD_TO_1_0 B8/T4 — still open). And the
second-largest mechanical cost is self-inflicted: `docs/JOURNAL.md`
prepends at the top, so **30 of the 45 pairs of open PR branches conflict,
every one of them in `docs/JOURNAL.md` and nothing else**, and `main`
carries 54 "Merge main into …" back-merge commits whose only job was to
resolve that hunk. Branch hygiene was identified once already (JOURNAL
2026-07-03: 64 branches queued for deletion, one-liner handed to the
maintainer in PR #93) and the fix was vigilance, so it did not happen.

Fresh eyes: trunk-based, one worktree per agent thread, a lane-ownership
map over today's directories, a ≤400-src-line PR cap, a CI gate that
loads the extension in headless Chromium on every PR, human soak batched
into one weekly session on a release-candidate build of `main`, and a
weekly hygiene script that deletes merged branches without asking. None
of that needs a rewrite or an integration branch; it needs three small
PRs and one GitHub setting.

## What is good (KEEP)

- **The soak rule's insight** — "real use IS a verification layer"
  (CONTRIBUTING §soak, JOURNAL 2026-08-16 ×3). Keep the layer; change
  when it runs (see BRAN-1).
- **`hand-to-maintainer`'s format** (Setup / Do / Expect / If-it-differs;
  reply with numbers; "three that get done beat nine that do not"). It is
  exactly the artifact a weekly batch needs. Keep verbatim.
- **`tools/smoke/ma6-walk.mjs`** — seeds state through the extension's own
  bundled modules, pins relays to loopback before anything is clickable,
  builds the 30070 event in-page instead of sending it (`ma6-walk.mjs:1-20,
  64-70`). This is the seed of the CI browser gate; keep and generalise.
- **One concern per PR** (CONTRIBUTING §Pull requests) and the canonical
  `Wire format:` callout owned by `ecosystem-pm` (`.claude/skills/README.md`
  §Seams). Keep; enforce mechanically (BRAN-7).
- **SHA-pinned actions + grouped weekly Dependabot** (`ci.yml:19-23`,
  `.github/dependabot.yml`), **immutable `v*` tags + release-environment
  approval** (CONTRIBUTING §Cutting a release). Correct for a store-bound
  artifact. Keep.
- **CODEOWNERS deliberately not wired to a required-review rule**
  (`.github/CODEOWNERS:3-7`) — the rationale is right for a solo repo and
  the security-surface callout is a useful map for a future co-maintainer.
- **`.gitattributes` LF pin** — earns its place (a test reads source bytes).
- **The JOURNAL as the trace organ** (CI Standard 1/2). Keep the practice;
  change the file layout (BRAN-2).
- **`git merge-tree`-checkable cleanliness**: 9 of 10 open code branches
  merge cleanly onto `main` today. The tree is not in a tangled state.

## Grandfathered

| Thing | Grandfathering decision | Why the premise is gone |
|---|---|---|
| Soak **before merge**, per PR | CONTRIBUTING "soak rule (adopted 2026-08-23, maintainer ruling)" | Premise: no machine can observe the browser. `ma6-walk.mjs` ran end to end here 2026-09-05 (briefing addendum). The layer stays; the *gate position* was chosen when the alternative did not exist. |
| The "pre-reset / rewritten history" narrative (BRIEFING §Git, RESET_PLAN :695, :786) | The container's shallow clone (`.git/shallow`, 4 grafts) | `git fetch --deepen=800` restores full ancestry; 65/79 branches are ancestors of `main`. There was no history rewrite at 2026-08-08. |
| `docs/JOURNAL.md` prepends newest-first in one 10,823-line file | JOURNAL started 2026-04-21 ("Journal started", :10603) with one author | Now 2–6 agent branches in flight at once; every prepend is the same hunk → 30/45 pair conflicts, 54 back-merges. |
| Merge-commit style with "Merge main into X (soak-rule merge prep)" back-merges | Follows from soak-before-merge + JOURNAL conflicts | 67 merge commits vs 120 non-merge on the visible window; history reads as merge noise. Squash on merge removes the need. |
| Per-PR SMOKE_TEST sections (49 sections, 178 KB) and per-PR `docs(smoke): record the PR #NNN soak walk` commits (15 on `main`) | The 2026-08 wave's "record what was verified" fix (correct) | Batching soak weekly turns 15 commits into ~2 and lets the ledger be one table (ROAD_TO_1_0 T4 split, K12 — both open). |
| CONTRIBUTING "Sub-phase progress belongs as comments on the phase issue" | Phase-issue era (ROADMAP phases 0–28) | No phase issues since the post-28 waves; ROADMAP is frozen ("no new phase numbers", RESET_PLAN §8). Dead instruction. |
| PR template "How I tested → Firefox" checkbox | Pre-ROAD_TO_1_0 | ROAD_TO_1_0 §"What 1.0 can ship without" defers Firefox parity beyond capture; the box is ticked by nobody and verifies nothing. |
| Branch-deletion one-liner "for the maintainer to run" (JOURNAL 2026-07-03, PR #93) | Automation credential got HTTP 403 on ref deletion | Two months later the same 65-branch pile exists → CI Standard 2 (second occurrence) and Standard 3 (vigilance is not a fix). |

## Garbage

- **65 remote branches whose tip is an ancestor of `main`** (full list:
  scratchpad `branches.txt`; includes all ~30 "pre-reset" and all ~35
  Aug-merged branches). Delete. No archive tag — the commits are reachable
  from `main` already; a tag per branch would add 65 refs of noise.
- **The `archive/<branch>` tagging plan for those branches** (RESET_PLAN
  :795). Built on the false premise; tag only `feature/phase-9b-metadata-ui`
  (the one unmerged old branch) and any parked PR branch.
- **`docs/superpowers/plans/2026-08-28-margin-s1-see.md` inside PR #368**
  (commit `e9f2ec5` also carried `MARGIN_DESIGN.md` and `MARGIN_UX_REVIEW.md`,
  since merged via #367). A 421-line Margin plan file riding an Instagram
  attribution fix breaks the one-concern rule and would land a stray
  planning document on `main`.
- **PR "#335"** in the briefing/RESET_PLAN table — no longer exists;
  Dependabot recut it as #376 (and added #375). Dispositions must name
  the live numbers.
- **PR template "Compatibility notes"** free-text prompt — superseded by the
  canonical `Wire format:` heading the skills README declares; the template
  never got it despite T4's `[x]`.
- **The JOURNAL 2026-07-03 "queued for deletion" list + one-liner** — never
  run; superseded by a script that does not need a human to remember.

## Findings (ranked by harm)

### BRAN-1 · The soak rule serialises every behavior PR through one person, and the one machine observer that exists is not in CI — throughput is currently zero
- **Harm 5 · DEFECT (process) · Effort M · ROAD_TO_1_0: B8 open, T4 "playwright devDependency … CI job loading the extension" open**
- **Evidence:** `origin/main` last commit `c1e652c` 2026-08-28; last soak record 2026-08-25 (`git log --format='%ad %s' origin/main | grep -i soak`). Open behavior PRs awaiting soak: #368 (08-29), #369 (08-30), #370 (08-30), #373, #374 (09-05), #324 (08-11). CONTRIBUTING §soak: "not merged the day it is opened… sits on its branch through at least one real casework session". `.github/workflows/ci.yml` has no browser job. `tools/smoke/ma6-walk.mjs:31-33` hardcodes `/opt/pw-browsers/chromium-1194` and `/opt/node22/.../playwright`; briefing addendum: it ran end to end here in ~2 min. JOURNAL "suite green, behavior wrong": 2026-08-16 ×4, 08-13 ×2, 08-02.
- **Claim:** With soak-before-merge and no machine smoke, merge throughput equals the maintainer's casework-session frequency, which in the last 12 days was zero; the queue grows (two new fix PRs on 09-05) faster than it drains.
- **Fresh-eyes action:** (1) One PR: add `playwright` as a devDependency, resolve the browser via `playwright`'s own path with `XR_CHROME` override, `npm run smoke:walk`, and a CI job `browser-smoke` that loads the unpacked extension, opens all five extension pages asserting zero `pageerror`, and runs the MA.6 walk (fix its stale "extraction block" selector in the same PR). (2) Split the soak rule into tiers (see §Fresh-start): machine-class changes merge on green; human-class changes merge on green with a `soak:pending` label and are cleared in one weekly session on an `rc/` build of `main`. The maintainer's merge instruction stays the ratifying act (Art. 11); the *waiting* stops being the gate.
- **Standard-8 experiment:** expected relief — behavior PRs merge within 3 working days of green; check at the first `rc/` tag after adoption.

### BRAN-2 · `docs/JOURNAL.md` prepend-at-top makes every pair of parallel branches conflict
- **Harm 4 · GRANDFATHERED · Effort S · ROAD_TO_1_0: not covered (new)**
- **Evidence:** pairwise `git merge-tree --write-tree --merge-base=<mb>` over the 10 open code/doc branches: **30 of 45 pairs conflict, every conflict is `docs/JOURNAL.md` and only it**. JOURNAL newest entry sits at line 22 (`## 2026-08-25 — …`); every PR's JOURNAL hunk is `@@ -19,6 +19,N @@`. `main` carries 54 commits matching `Merge (main|branch 'main'|remote-tracking branch 'origin/main')` — the back-merges that resolved this hunk ("Merge main into feat/diagnostics-log (soak-rule merge prep)", 2026-08-22). 42 of the 204 commits since 08-08 touch JOURNAL.
- **Claim:** The convention chosen for a single author (2026-04-21) is now the dominant mechanical cost of running threads in parallel; it is paid on every rebase and on every merge.
- **Fresh-eyes action:** Move entries to `docs/journal/YYYY-MM.md` files, **append at the bottom**, with `docs/JOURNAL.md` reduced to a generated index (newest first) so grep and "skim it first" still work. Interim, same PR: `docs/journal/*.md merge=union` in `.gitattributes` so two appends never conflict. Keep the entry format unchanged. (RESET_PLAN §8 proposes a quarterly file; monthly + union is the smaller step and removes the conflict entirely rather than reducing it.)

### BRAN-3 · Branch hygiene was fixed by vigilance once and did not happen — second occurrence
- **Harm 4 · GARBAGE (the pile) / DEFECT (the mechanism) · Effort S · ROAD_TO_1_0: not covered**
- **Evidence:** JOURNAL :6857-6863 (2026-07-03): "64 remote branches verified fully merged/superseded… queued for deletion — the automation credential gets HTTP 403 on ref deletion, so the verified list + one-liner ship in PR #93 for the maintainer to run." Today: 65 of 79 remote branches are ancestors of `main` (`branches.txt`); no `scripts/branch-*`; no hygiene workflow; `.github/workflows/` has only `ci.yml` and `release.yml`. GitHub's "Automatically delete head branches" is evidently off (35 Aug-merged branches survive).
- **Claim:** CI Standard 2 (recurrence) + Standard 3 (a fix that requires remembering is not a fix). The credential problem is solvable with `permissions: contents: write` on a scheduled workflow.
- **Fresh-eyes action:** (a) flip the repo setting "Automatically delete head branches" (one click, prevents the next pile); (b) `scripts/branch-hygiene.mjs` — dry-run by default; deletes any remote branch whose tip is an ancestor of `main` (safe by construction, no tag); for a branch with no open PR and no commit in 14 days, tags `archive/<name>-<yyyymmdd>` then deletes; never touches a branch with an open PR; refuses to delete `main`; (c) `.github/workflows/hygiene.yml` weekly, `contents: write`, posting the list it deleted. First run today deletes 65.

### BRAN-4 · PR #370 (margin-s1) converts a default-off view into 14 human rows and +504 lines in the 8,294-line reader — the branch the maintainer says he is testing things he does not care about
- **Harm 4 · DEFECT (scope/process) · Effort S (disposition) · ROAD_TO_1_0: "reader/index.js decomposition — post-1.0" (open); T4 K12 open**
- **Evidence:** `git diff --stat origin/main...origin/feat/margin-s1`: 15 files, +1,872/−36, 22 commits in one day (2026-08-30); `src/reader/index.js` +504 across 21 hunks (`grep -c '^@@'`); SMOKE_TEST diff adds M.1–M.14 and a ledger row "Margin S1 (M.1–M.14) | pending"; flag `marginView: false` (feature-flags.js diff). `hand-to-maintainer/SKILL.md:99`: "A list so long it will not be run — three items that get done beat nine that do not." MARGIN_DESIGN §9: S1 "purely additive, reviewable in one sitting, walkable against real COVID casework immediately."
- **Claim:** The soak rule as written has no notion of "what would this observation change?" for a flag-off surface; so a display-only slice inherits a 14-row human bill. Separately, +504 lines into the god file is the collision hazard the ownership map exists to prevent.
- **Fresh-eyes action:** **PARK or MERGE-WITH-4-ROWS, maintainer's choice.** Either: close PR, keep branch, tag `archive/feat-margin-s1-20260906`, re-cut S1+S2 after the reader split. Or: merge on green (flag off ⇒ machine-class for everything but M.2/M.7), with exactly four human rows: M.1 (flag off — no Annotated tab), M.2 (flag on — lands in Annotated, tints, no combined total), M.7 (accept/dismiss survives reload), M.8 (publish carries no `xr-ann` markup). The other ten are recorded as accepted risk with a check date. Do not ask the maintainer to run fourteen.

### BRAN-5 · PR #368 bundles a 421-line Margin plan file into an Instagram wire-attribution fix
- **Harm 3 · GARBAGE (the stray file) · Effort S · ROAD_TO_1_0: not covered**
- **Evidence:** `git show --stat e9f2ec5`: `docs/JOURNAL.md`, `docs/MARGIN_DESIGN.md` (+394), `docs/MARGIN_UX_REVIEW.md` (+239), `docs/superpowers/plans/2026-08-28-margin-s1-see.md` (+421), `src/shared/platforms/instagram.js` (+48), `tests/instagram-url-identity.test.mjs` (+98). The two design docs later landed via #367, so the PR's live diff still carries the plan file. CONTRIBUTING: "One concern per PR."
- **Claim:** Nothing checks the one-concern rule; a wire-relevant fix (wrong-account attribution into `d`/`r` tags, `event-builder.js:178,181`) has been blocked 8 days partly because its diff looks like a feature PR.
- **Fresh-eyes action:** drop the plan file (`git rm`, one commit), **MERGE NOW** — the fix is pure, unit-pinned (`canonicalPostUrl`), and machine-class once the browser smoke exists; until then one human row (below). Add a CI PR-path check: a `fix(<scope>)` PR may not add files under `docs/superpowers/` or `docs/*DESIGN*.md`.

### BRAN-6 · PR #324 (Option C, a ratified decision) has rotted 26 days, 172 commits behind, because its "live walk" is owed and nothing batches it
- **Harm 3 · DEFECT (process) · Effort M · ROAD_TO_1_0: T5 "live walks required before a 1.0 tag" (open)**
- **Evidence:** PR #324 created 2026-08-11; `rev-list --left-right --count` → 172/1; `git merge-tree` vs `main` conflicts in `docs/JOURNAL.md` only; commit body: "Still owed before the next tag: the live walk — entity creation under both signing methods, one entity-tagged publish under NIP-07." NIP07_IDENTITY_KICKOFF §6 records the ratification. 14 test fixtures already seed a primary (`tests/seed-primary.mjs`).
- **Claim:** A decision the maintainer ratified is not on `main` because the process has no place to put "owed human check" other than "do not merge".
- **Fresh-eyes action:** **REBASE + MERGE AFTER the browser-smoke job exists** (its refusal paths are DOM-observable and can be a machine row); merge with `soak:pending`; one weekly-batch row: Settings → Signing → NIP-07 with no local primary → side panel ＋ New entity → *Expect* an inline refusal pointing to Settings → Signing, nothing created. Resolve the JOURNAL conflict by moving its entry to the new journal file (BRAN-2).

### BRAN-7 · The PR template lacks the sections the process already calls canonical, and T4 records that item as done
- **Harm 3 · DEFECT (doc-currency, CI S7) · Effort S · ROAD_TO_1_0: T4 item "[x] … add a Disciplines-invoked and Verification-layer section plus the canonical 'Wire format:' heading to the PR template" — marked DONE, is NOT**
- **Evidence:** `.github/pull_request_template.md` sections: What / Why / How I tested (Chrome, Firefox, lint, real relay) / Screenshots / Compatibility notes. No `Wire format:` heading, no verification-layer line, no interpretation section. `.claude/skills/README.md` §Seams: ecosystem-pm "declares the canonical PR-body callout literal: a section headed `Wire format:`". The maintainer's ask: decisions "confirmed in a more systematic way".
- **Claim:** The template is where "wire format" and "interpretation flagged" become systematic; it was never updated, and the punch list says it was.
- **Fresh-eyes action:** Replace the template with: `## What` · `## Verification layer` (`unit | guard | machine-smoke | human-soak: <rows> | none-because …`) · `## Wire format:` (`none | additive | breaking | new-kind | retirement`, required when any builder/`*-publish.js`/parser changed) · `## Interpretation flagged` (one line per interpretive step with a recommended default — "none" allowed) · `## Docs` · `## Screenshots`. Add a CI step that fails a PR touching `src/shared/event-builder.js`, `src/shared/*-publish.js`, `src/shared/truth-builders.js`, `src/shared/audit/builders.js`, `src/shared/metadata/builders.js` with no `Wire format:` line in the body. Correct T4's checkbox.

### BRAN-8 · Parallel threads already collide on the same files, and no ownership map or worktree convention exists
- **Harm 3 · GAP · Effort S (map) / L (god-file split) · ROAD_TO_1_0: "reader/index.js decomposition (7,811 lines, a 1,573-line publish())… post-1.0" (open)**
- **Evidence:** file overlap across the 12 open PRs (`pr-files.txt`): `docs/JOURNAL.md` ×8, `CLAUDE.md` ×3, `src/shared/metadata/feature-flags.js` ×2 (#370, #374), `src/reader/index.css` ×2, `src/background/index.js` ×2 (#369 at :581/:1763, #374 at :27/:814 — non-overlapping hunks, clean by luck), `docs/SMOKE_TEST.md` ×2. Sizes: `reader/index.js` 8,294, `sidepanel/index.js` 2,242, `options/index.js` 1,989, `background/index.js` 1,875, `portal/index.js` 1,497. `git worktree list` → one worktree. Baseline: 247 src files / 93,243 LOC.
- **Claim:** Without a lane map, "multiple threads" means multiple PRs racing to edit five god files plus three shared registries; the map cannot be honest until those files are split, but an interim map over today's directories is already enforceable by a path check.
- **Fresh-eyes action:** adopt the lane map in §Fresh-start (derived from `src/`), one worktree per thread (`git worktree add ../xray-<lane> -b <lane>/<topic>`), a CI path check (a PR's `src/` paths fall in one lane, or the PR body says `Cross-lane: <reason>`), and make the first reset PRs in each lane pure `git mv` + re-export splits of the god files (mechanical; the build, the suite and the machine smoke are the whole verification).

### BRAN-9 · Merge mechanics: unverifiable branch protection, merge commits + 54 back-merges, no squash
- **Harm 2 · GRANDFATHERED · Effort S · ROAD_TO_1_0: not covered**
- **Evidence:** CONTRIBUTING §Cutting a release: "`main` is protected: land the version bump through a PR first" — not verifiable from this container (no `gh`, protection API needs admin scope). Visible window: 67 merge commits / 120 non-merge; 19 "Merge remote-tracking branch 'origin/main' into …", 54 back-merges total. Authors: Bryan 687 (via merges), Claude 215, dependabot 2. PR merges per ISO week: W29 90, W31 41, W34 21, W35 7.
- **Claim:** Merge-commit history with per-PR back-merges makes `git bisect`/`git log` on `main` read as noise and doubles the JOURNAL conflict cost.
- **Fresh-eyes action:** squash-merge by default (PR title becomes the one commit; PR body carries the Wire/Verification/Interpretation lines, so the record survives), rebase-not-merge to update a branch, protection rule: required status checks = the full gate incl. `browser-smoke`, "require branches up to date" ON, allow-force-push OFF, linear history ON. Question to the maintainer to confirm what is set today.

### BRAN-10 · Dependabot PRs pile up and are recut, nobody merges them
- **Harm 2 · DEFECT (process) · Effort S · ROAD_TO_1_0: not covered**
- **Evidence:** open: #371 (nltk, 09-01), #372 (fast-uri, 09-02), #375 (actions group, 09-06), #376 (npm group, 09-06 — the recut of #335). `dependabot.yml` groups minor+patch weekly. Diffs are lockfile-only except #376 (`esbuild ^0.28.2`, `web-ext ^10.6.0`).
- **Claim:** Dev-dependency bumps are machine-class by definition (CI green is the test) and cost maintainer clicks every week.
- **Fresh-eyes action:** **MERGE NOW** all four; enable Dependabot auto-merge for `devDependencies` minor/patch and `github-actions` on green (`gh pr merge --auto --squash` via a workflow, or the repo's auto-merge setting); runtime deps (`@mozilla/readability`, `pdfjs-dist`, `turndown*`) stay manual because they ship in the bundles.

### BRAN-11 · The "pre-reset / rewritten history" premise is false and the plan built on it proposes phantom work
- **Harm 3 · GARBAGE (the premise) · Effort S · ROAD_TO_1_0: not covered**
- **Evidence:** `.git/shallow` (4 grafts incl. `4057661` = "Merge pull request #312", 2026-08-08); `git rev-parse --is-shallow-repository` `true` → after `git fetch --deepen=800 origin main`, `false`; `git rev-list --count origin/main` 187 → 904; all ten sampled old branches `merge-base --is-ancestor` → MERGED, `N/0`. RESET_PLAN :695 ("thirty branches descending from a history that no longer exists") and :786-797 (tag each as `archive/<branch>`); BRIEFING §Git group 1.
- **Claim:** An audit fact was inherited from a clone artifact and became a design argument ("an integration branch would re-create the pre-reset situation"). The trunk-based recommendation is still right, for the real reasons (§Fresh-start); the tagging work is not.
- **Fresh-eyes action:** correct RESET_PLAN §8/§9 and the briefing; delete the 65 merged branches with no tags; tag only `feature/phase-9b-metadata-ui` (`archive/feature-phase-9b-metadata-ui-20260529`) and delete it too, unless the maintainer wants the unbuilt overlay kept as a branch; run every future audit in an unshallowed clone (`git fetch --unshallow` as the first line of the audit checklist).

### BRAN-12 · Three governance PRs opened in parallel on the same corpus with divergent framings, all drafts or stale
- **Harm 2 · DEFECT (process) · Effort S · ROAD_TO_1_0: not covered; cites questionnaire Q12, Q18, Q19**
- **Evidence:** #364 (`docs/GOVERNANCE_UX_REVIEW.md`, +354, draft, reverted its first direction on maintainer correction 09-05), #365 (`.claude/skills/governance/SKILL.md` 453 lines + README/CLAUDE.md rows, draft), #366 (questionnaire, +667, 5 behind `main`, "deliberately NO recommendations"). All three touch JOURNAL (pairwise conflicts); #365 also edits `CLAUDE.md` and `.claude/skills/README.md` (collides with any process PR).
- **Claim:** Docs-only PRs are soak-exempt by the rule's own text and should be the shortest-lived branches in the repo; instead they age because merging a governance doc feels like a ruling. Questionnaire Q18 ("what counts as a ruling") is exactly the missing distinction — merging a *question list* ratifies nothing.
- **Fresh-eyes action:** **#366 MERGE NOW** into `docs/ideas/` as an unanswered record (answers land later, in place, with dates — Q19's own proposal); **#364 MERGE NOW** (review report, advisory, Art. 11); **#365 FOLD INTO THE RESET** — keep the README routing rows and ~50 lines of review standards, drop the 400-line corpus mirror (a second drifting copy is the doc-drift class the README itself names). This differs from RESET_PLAN §9 on #366 timing — flagged as a question below.

### BRAN-13 · No JOURNAL-presence check on process-file PRs (CI Standard 1's own graduation clause)
- **Harm 2 · GAP · Effort S · ROAD_TO_1_0: automator lane (appendix) — not an id**
- **Evidence:** `continuous-improvement/SKILL.md:71-73`: "Graduates to a CI check on its own second miss: flag any PR touching `.github/workflows/**`, `.claude/skills/**`, or `docs/SMOKE_TEST.md` with no same-PR diff to `docs/JOURNAL.md`." #365 (skills) has a JOURNAL diff; #370 (SMOKE_TEST) has one; the check does not exist, so the next miss is unobserved.
- **Fresh-eyes action:** land the check with the hygiene PR (BRAN-3): `git diff --name-only origin/main...HEAD` — if it touches those paths and not `docs/journal/**`, fail with the standard's sentence. After BRAN-2, the path is `docs/journal/`.

## Open-PR dispositions (the table the maintainer asked for)

Checks are written per `hand-to-maintainer`: Setup / Do / Expect / If it differs. "none" means nothing a human needs to see.

| PR | Branch | Disposition | Reason | Human check still owed |
|---|---|---|---|---|
| #368 | fix/instagram-url-identity | **MERGE NOW** after `git rm docs/superpowers/plans/2026-08-28-margin-s1-see.md` | wire-truth fix; pure, unit-pinned; 8 days old | 1 row. *Setup:* branch build, Local signing. *Do:* open any public Instagram reel by SPA navigation from a profile page (profile → tap the reel), capture. *Expect:* reader title/URL show `instagram.com/reel/<shortcode>/`, never `/<other-account>/reels/`. *If it differs:* `og:url` precedence regressed — do not publish. ~3 min. |
| #369 | fix/publish-without-session-record | **MERGE NOW** | removes a refusal; unit-tested; NIP-07 path unchanged by inspection (`background/index.js` diff) | none (machine-class; the NIP-07 "needs a web page" error is unit-pinned). Optional 1-min row: reopen a reader tab from yesterday, Publish → succeeds under Local. |
| #373 | claude/kind-hypatia-fu8nqm | **MERGE NOW** | tolerance fix for stored malformed records; +408 of which 288 are tests; no behavior change on well-formed data | none. |
| #374 | claude/eager-knuth-ipv3xd | **REBASE + MERGE AFTER #369 and after the maintainer confirms the flag/Options wording** | the job pattern is right and is the precedent for every long pass (MV3 5-min kill); +534-line new module; touches `background/index.js` alongside #369 (non-overlapping hunks) | 1 row, load-bearing (money): *Setup:* branch build, `caseSynthesis` + `llmAssist` on, a case whose extracts are all cached. *Do:* Analyze corpus…; while "Synthesizing… running in the background" shows, reload the portal tab, reopen the case, click Analyze corpus…. *Expect:* confirm text ends "(no new synthesis call)"; the Anthropic console shows ONE reduce request. *If it differs:* a second billed call — the reuse-by-scope path failed; revert. ~5 min + one paid reduce. |
| #370 | feat/margin-s1 | **PARK** (close PR, keep branch, tag `archive/feat-margin-s1-20260906`) — or MERGE with the 4-row walk in BRAN-4 | see BRAN-4 | if merged: M.1, M.2, M.7, M.8 only (~10 min). If parked: none. |
| #324 | claude/nip07-option-c | **REBASE + MERGE AFTER the browser-smoke job** | ratified decision (Option C); JOURNAL-only conflict; 26 days old | 1 row in the weekly batch (BRAN-6). |
| #366 | docs/governance-reconciliation-questionnaire | **MERGE NOW** (rebase 5 commits) | questions, no rulings; `docs/ideas/`; soak-exempt | none. |
| #364 | claude/practical-ramanujan-sk12k1 | **MERGE NOW** (mark ready) | advisory review report; soak-exempt | none. |
| #365 | claude/loving-gauss-k8gsta | **FOLD INTO THE RESET** | keep routing rows + review standards, drop the corpus mirror | none. |
| #371, #372, #375, #376 | dependabot/* | **MERGE NOW**; enable auto-merge for devDeps/actions | lockfile bumps; CI is the test | none. |
| #377 | claude/xray-audit-refactor-opxk01 | (this audit's plan PR) — correct §8/§9 per BRAN-11 before merge | | |

Order of merging today, to minimise rebases: #373 → #369 → #368 → dependabot ×4 → #366 → #364 → then rebase #374 and #324.

## Branch census (79 remote refs, deepened clone)

- **MERGED (ancestor of `main`): 65** — delete, no tags. This includes every branch the briefing called "pre-reset" except `feature/phase-9b-metadata-ui`, and every "already merged" branch.
- **OPEN with a PR: 12** (table above) + `claude/xray-audit-refactor-opxk01` (#377).
- **OPEN without a PR: 1** — `feature/phase-9b-metadata-ui` (832/6, 2026-05-29; JOURNAL 2026-07-03 "kept — the only copy of the unbuilt live-page metadata overlay"). Tag `archive/feature-phase-9b-metadata-ui-20260529`, delete the branch; the ranker/trust-graph modules it consumed were killed in K1 (DONE), so the premise for keeping it as a live branch is gone.

## Fresh-start design — "multiple threads at once, reliably tested"

**Trunk-based with short-lived branches. Not an integration branch.**
- Trunk-based failure mode: a half-done refactor on `main` breaks casework. Countered by the strangler pattern (new code path behind a flag or a re-export; old path deleted in a later PR), the ≤400-src-line cap, and the machine smoke on every PR — `main` is always the build the maintainer uses.
- Integration-branch failure mode (the real reason to reject it, not the phantom "pre-reset" one): the branch drifts from `main` for weeks while fixes keep landing on `main` (they must — casework never stops), every fix has to be double-landed, the eventual merge is one giant human soak nobody can run, and the JOURNAL conflicts multiply by the branch's lifetime. This repo already demonstrated the cost in miniature with #324 (26 days, 172 behind).

**Parallel agent threads.**
- One `git worktree` per thread: `git worktree add ../xray-<lane> -b <lane>/<topic> origin/main`; `npm ci` once per worktree; never two threads in one checkout.
- **Lane ownership map** (derived from `src/`; a PR's `src/` paths must fall in one lane, or its body carries `Cross-lane: <reason>`; the CI path check enforces it):

| Lane | Owns (today's paths) | Notes |
|---|---|---|
| `bus` | `src/background/index.js`, `src/shared/nostr-client.js`, `session-articles.js`, `llm-jobs.js` (#374), `transcriber-client.js`, `direct-transcribe*.js`, `screenshot.js`, `companion-status.js` | the `xray:*` message table; first job: split `background/index.js` into a dispatcher map + one handler file per family |
| `capture` | `src/content/**`, `src/page/api-interceptor.js`, `src/shared/platforms/**`, `content-detector.js`, `content-extractor.js`, `content-islands.js`, `url-import.js`, `url-identity.js`, `url-aliases.js`, `epub-parse.js`, `pdf-*.js`, `media-hints.js`, `html-snapshot.js`, `rules/` | platform canaries live here |
| `identity` | `src/page/nip07-bridge.js`, `crypto.js`, `signer.js`, `local-key-manager.js`, `nsecbunker-client.js`, `identity/**`, `identity-*.js`, `workspace-keys.js`, `media-key.js` | CODEOWNERS-listed security surfaces; #324 lands here |
| `wire` | `event-builder.js`, `nostr-events.js`, every `*-publish.js`, `truth-builders.js`, `audit/builders.js`, `audit/publish-batch.js`, `metadata/builders.js`, `publish-gate.js`, `confirmed-publish.js`, `wire-copy.js`, `docs/NIP_DRAFT.md`, CONSTITUTION Art. 10 table | every PR carries `Wire format:` |
| `store` | `storage.js`, `archive-cache.js`, `audit/audit-cache.js`, `event-journal.js`, `backup.js`, `workspace-read.js`, `metadata/feature-flags.js`, `config.js`, `map-artifacts.js`, `case-bundle.js`, `extraction-import.js` | schema-evolution reviews; owns the flag registry — other lanes add a flag by a one-line PR here first |
| `reader` | `src/reader/**`, `src/shared/annotations/**` (if #370 lands), `claim-*.js`, `quote-grounding.js`, `adjudicate-modal.js`, `assess-modal.js`, `forensic-modal.js`, `integrity-modal.js`, `transcript-*.js`, `diarized-transcript.js`, `vision-*.js`, `speakers-modal` | first job: split `reader/index.js` (publish() → `reader/publish/*.js`) |
| `portal` | `src/portal/**`, `case-*.js`, `corpus-*.js`, `hypothesis-*.js`, `cross-case-graph.js`, `article-pass.js`, `entity-page*.js`, `entity-dossier.js`, `review-queue.js`, `audit/corpus-*.js`, `audit/known-unknowns.js`, `audit/cross-coverage.js`, `reference-resolver.js`, `scholar-refs.js`, `crossref.js` | #373 lands here |
| `surfaces` | `src/options/**`, `src/sidepanel/**`, `src/network/**`, `network-feed.js`, `network-trust.js`, `follow-*.js`, `incorporation.js`, `entity-model.js`, `entity-resolution.js`, `entity-equivalence.js` | first-hour work (T7) |
| `llm` | `llm-*.js`, `llm-stream.js`, `corpus-prompts.js`, `lens-*.js`, `jurisdiction-model.js`, `audit/module-prompts.js`, `audit/audit-prompt.js`, `audit/assemble.js`, `audit/findings-schemas.js`, `audit/run-orchestrator.js`, `provider-normalize.js` | prompt headers (`// Standards:`) enforced by `tests/disciplines.test.mjs` |
| `toolchain` | `.github/**`, `scripts/**`, `tools/**`, `esbuild.config.mjs`, `tests/helpers/**`, `tests/*-guards*.test.mjs`, doc generators, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/journal/` index | hygiene script, browser smoke, PR-body checks |

Shared-hot files and their rule: `docs/journal/YYYY-MM.md` (append-only, `merge=union`); `CLAUDE.md` (the module list becomes a generated section — a `toolchain` generator reads the lane map; hand edits only outside the generated block); `docs/SMOKE_TEST.md` (split per lane into `docs/smoke/<lane>.md` + one ledger at the top — T4's split); `feature-flags.js` (`store` lane; one key per PR, appended).

**PR size cap:** ≤400 changed `src/` lines except pure `git mv`/re-export PRs (which must have a zero-behavior claim and pass build + suite + smoke unchanged). At most **4 open non-dependabot PRs**; a new one waits until one merges or is parked. One concern per PR (already law).

**CI gate, identical for every branch (`ci.yml`):** node --check → build → `npm test` (measured 19.3 s here; budget 60 s) → python normalizer parity → **version lockstep guard** (T4, open) → web-ext lint (warning count ratchet) → web-ext build + packaged-contents assertion (T4, open) → **`browser-smoke`** (Playwright, headless Chromium, load unpacked, open options/reader/sidepanel/portal/network asserting zero `pageerror`, run the MA.6 walk against a loopback relay) → PR-body checks (`Verification layer:` present; `Wire format:` present when a wire-lane file changed; `Interpretation flagged:` present) → path/lane check → JOURNAL-presence check for process files (BRAN-13).

**When human soak is still required, and how it batches.**
- *Machine-class* (merge on green): a DOM state, a stored record, a built event, a message round-trip, a rendered string — anything the smoke or the suite can observe.
- *Human-class* (merge on green + `soak:pending`): spends money against a real provider; publishes to a real relay; a NIP-07/NIP-46 signer popup; service-worker teardown mid-job; a live third-party site's DOM; a judgment criterion ("reads true", "is useful").
- *The batch:* every Friday (or whenever the maintainer has a casework session), `toolchain` cuts `rc/YYYY-WW` from `main`, and one agent assembles ONE `hand-to-maintainer` list from all `soak:pending` PRs, ordered by what fails worst, capped at ~8 items / 45 minutes, money items marked. The maintainer works a real case on that build and replies with numbers. One ledger row per week; each PR's label flips to `soak:pass` / `soak:fail` (fail → a `fix:` PR at the top of the queue, never a revert of a flag-off change). The urgent waiver stays. Merge remains the ratifying act; the *wait* is no longer the gate.
- Today's batch, if adopted now: #374's reduce row (money), #368's IG row, #324's refusal row, and — if merged — #370's four rows. ≈25 min.

**Sequencing the reset so casework never stops.**
1. `toolchain` first, this week: browser-smoke job + hygiene script + PR template + JOURNAL split (three PRs, all docs/CI, soak-exempt). Merge the six small PRs in the order above.
2. Then per lane, one mechanical split PR each (`git mv` + re-export; zero behavior), landing in any order because lanes are disjoint. Casework runs on `main` throughout — no flag needed for a re-export.
3. Then behavior work: every replacement ships behind a flag or as a new module path with the old path intact ("strangler"); the old path is deleted in a later PR once the weekly batch has used the new one on a real case. Never a big-bang branch; never a PR that both moves and changes.
4. Every kill (ROAD_TO_1_0 K-ids, ratified) is its own ≤400-line PR in its lane with a JOURNAL entry.

**Branch hygiene rules — enforced by `scripts/branch-hygiene.mjs` + `hygiene.yml` (weekly) + one repo setting:**
1. Auto-delete head branch on merge (GitHub setting).
2. A branch whose tip is an ancestor of `main` is deleted — no tag, no question.
3. A branch with no open PR and no commit for 14 days is tagged `archive/<name>-<yyyymmdd>` and deleted.
4. A branch with an open PR is never touched by the script.
5. Branch names: `<lane>/<topic>` (agents included — no more `claude/adjective-scientist-xxxx`; the lane prefix is what the path check reads).
6. `main` is squash-merge only, linear history, force-push forbidden, required checks = the whole gate.
7. Open non-dependabot PR cap: 4; the script opens an issue when exceeded.
8. Dependabot devDeps/actions auto-merge on green; runtime deps manual.
9. First line of every audit/reset checklist: `git fetch --unshallow || git fetch --deepen=1000`.

## Questions for the maintainer

1. **Soak position.** CONTRIBUTING labels soak-before-merge a "maintainer ruling (2026-08-23)"; the mechanism (per-PR, before merge) was drafted by an agent from the August incident record. Is the ruling "real use must verify every behavior change" (kept) or "nothing merges before I use it" (the mechanism)? *Recommended default:* the former — tiered soak, merge on green with `soak:pending`, one weekly batch on an `rc/` build. *Provenance:* CONTRIBUTING §soak; JOURNAL 2026-08-16 ×3.
2. **Delete without archive tags?** 65 branches are ancestors of `main`; deleting loses nothing. *Default:* delete; tag only `feature/phase-9b-metadata-ui`. *Provenance:* JOURNAL 2026-07-03 queued the same deletion; RESET_PLAN :795 proposed tags on a false premise.
3. **#370 margin-s1: park, or merge with a four-row walk?** *Default:* merge with four rows (M.1, M.2, M.7, M.8) if you will open archived articles in Annotated during real casework in the next two weeks; otherwise park. *Provenance:* MARGIN_DESIGN ratified 2026-08-28 (Art. 11); the 14-row walk is agent-authored.
4. **#366 questionnaire: merge now as questions, or hold until answered?** RESET_PLAN §9 says hold; this lens says merge now (`docs/ideas/`, no rulings, and a held docs branch is the pattern that rots). *Default:* merge now; answers go in place with dates (its own Q19).
5. **Branch protection today.** Is `main` actually protected, with required checks, linear history, and force-push off? Not verifiable from here. *Default:* set all four; squash-merge only.
6. **JOURNAL restructure** is a doc-convention change and CI Standard 1 requires a cited friction: 30/45 pair conflicts and 54 back-merges is the citation. *Default:* `docs/journal/YYYY-MM.md`, append at bottom, `merge=union`, generated index. Keep the entry format.
7. **Open-PR cap of four.** Agents can open PRs faster than one person can review; a cap forces sequencing. *Default:* 4 non-dependabot; the hygiene script reports, never closes.
8. **Dependabot auto-merge** for devDeps/actions on green. *Default:* yes; runtime deps stay manual because they ship in the bundles.
9. **Drop the Firefox checkbox** from the PR template until Firefox parity is a stated goal (ROAD_TO_1_0 defers it). *Default:* drop; keep the Firefox smoke rows in the ledger as "not walked".
10. **Branch naming** — may agent sessions be told to name branches `<lane>/<topic>` instead of `claude/<random>`? *Default:* yes; the path check reads the prefix.

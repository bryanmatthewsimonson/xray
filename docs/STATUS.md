# X-Ray status

**Hand-maintained until RESET_PLAN R6 generates it. As of 2026-09-26**
(`main` at `90e2da3`).

One page for four questions: what still blocks 1.0, which switched-off
features get checked when (and whether real casework has used them),
what is parked, and how many pull requests may be open at once. Every
line names where its evidence lives, so any line can be checked and
refreshed by re-reading that source.

*Provenance: INTERPRETATION (2026-09-25, refreshed 2026-09-26) — an
agent's reading of the tree, `git log origin/main`, the PR records, the
repository settings and rulesets as GitHub's API reports them, and
`docs/journal/`.
Nothing here is a ruling. Where a line and the tree disagree, the tree
wins; fix the line.*

## 1. The 1.0 blockers

The nineteen blockers of [`ROAD_TO_1_0.md`](ROAD_TO_1_0.md)
(2026-08-09), each re-checked against the tree today.
**7 closed · 4 partly done · 8 open.** "Owner" is the
[`RESET_PLAN.md`](RESET_PLAN.md) §7 track that holds what is left.

| # | Blocker | State | Evidence | Owner |
|---|---|---|---|---|
| B1 | The archive deleted captures past 500 entries | closed | #315 (`0e5d58c`, 2026-08-09): no eviction on save; `unlimitedStorage` requested | — (the plan's Appendix B closed list omits it; the tree confirms it) |
| B2 | Publish said "published" when no relay confirmed | closed | #315 (`0e5d58c`): the three portal surfaces read `confirmedOk`. The dossier view still counts confirmations itself — correct, not unified | — |
| B3 | Merge-import could install a colleague's private keys | closed | #315 (`0e5d58c`): `local_keys` never merges | — |
| B4 | Credentials echoed and exported; no key-free export | closed | #315 + #321 (`4c6016f`, merged 2026-08-11; JOURNAL 2026-08-10): presence-only key fields, credentials excluded from backups, the "Shareable copy" export | — |
| B5 | `rules/csp-strip.json` strips page security (CSP) on every site | open | rule 1 still has no domain condition | R7 security item (§10) |
| B6 | NIP-07 signed replies were not verified | closed | #316 (`41b8fff`, 2026-08-09); real-signer walk PASS, ledger 2026-08-11 | — |
| B7 | No store listing or other installable channel; the zip is unpruned | open | no store listing or signed build. Besides the companion, `webExt.ignoreFiles` now excludes only the smoke output, Chrome's `_metadata/` and `eslint.config.mjs` (#396, `1c4fa87`); nothing on B7's prune list is dropped. CI now asserts the zip's contents (`npm run check:package`, #396): today's leaks — `tests/`, `docs/`, `tools/`, `scripts/`, the source maps, the `src/` tree and more — are pinned shrink-only in `KNOWN_LEAKS` (`scripts/check-package.mjs`), so a new leak is red, but none is removed yet | R4 "First run"; decision §11-6 |
| B8 | No runnable release gate; no verification record | partly done | walk ledger since #320 (`a3a8e02`, 2026-08-10); browser smoke in CI since #379 (`d139ba5`, 2026-09-21) and, as read 2026-09-26, a required check on `main` (with `build + lint + package`) under the repository ruleset `main` (created 2026-09-22 00:11Z); version lockstep, the packaged-contents assertion and a bundle budget in `ci.yml` since #396 (`1c4fa87`, 2026-09-25). The MA.6 walk's preconditions for going required are met (#395, `16073bc`), but it still runs `--advisory=ma6` — the flip is the maintainer's, due 2026-10-05. Still open: SMOKE_TEST not split into a short gate (no `docs/GATE.md`); CI runs one companion test file (the normalizer parity), not its key-hygiene tests (`test_server_keys.py`) | R0 (the MA.6 flip), R6 (`GATE.md`), R7 (the gate on the shipped zip); the companion's key-hygiene tests: unowned |
| B9 | The front door misstates what shipped | partly done | `release.yml` refuses an empty CHANGELOG section (#318, JOURNAL 2026-08-09). #398 (`94733e1`, 2026-09-26) rebuilt CHANGELOG `[Unreleased]` from the merged PRs and corrected README's version and counts, CLAUDE.md and two code headers (R0's front-door box, ticked). Still open: Settings "Enable the Network page (Phase 25)" (`options.html`), README's Status still told in phase numbers rather than user jobs, and B9's CI check that `[Unreleased]` is non-empty while `main` is ahead of the newest tag | R6 (its doc-currency guard names both the empty `[Unreleased]` and `Phase \d+` in user-facing HTML or docs) |
| B10 | Three features reachable only through DevTools | open | still no Settings control for `reviewCoordination`, `storeFirstPublish`, `extractionAnalysisPublishing` | R2 "Flags" |
| B11 | Flag registry noise; the guide's flag table is wrong | partly done | eight dead flags retired (#317, `bd0396d`). The guide no longer lists them but omits four live flags (`aiVision`, `directCloudTranscription`, `storeFirstPublish`, `extractionAnalysisPublishing`); no flag ledger, no guard | R2 "Flags"; R6 |
| B12 | Publish fires on one click; disclosures arrive as toasts | open | the reader's Publish button still calls `publish()` directly | R4 "Publish pre-flight" |
| B13 | No first hour | open | install only registers the right-click menus; no surface links to the user guide (Settings has a "Capture tips" link to the capture guide) | R4 "First run" |
| B14 | The group workflow has never been used by two people | open | no two-person walk on the ledger | R7 two-person walk |
| B15 | Group surfaces show authors as raw hex | open | the reader and the side panel still slice hex keys | R7 (with B14) |
| B16 | The wire record does not match what the code emits | partly done | 30050–30053 and 9803 reclassified reserved (#317, K1). Still open: no NIP_DRAFT section for 30041 or 30078, no CONSTITUTION Art. 10 rows for kinds 1 and 5, the `x` tag's second meaning unwritten | R2 "Make the kind schedule true"; R3 lane A |
| B17 | The follows feed drops unreadable events silently; kind 0 / 10002 overwrite blindly | open | `parseFeedEvent` still returns a bare `null` | **no named track** — §10 (WIRE-10) covers only the 10002 half |
| B18 | No threat model | closed | `docs/THREAT_MODEL.md` added in #316 (`41b8fff`); updated since, most recently by #392 (`a65d4ef`) and #394 (`a4f859d`, 2026-09-26: the stored LLM job records now cover eight passes, not three, and the job messages answer extension pages only) | — |
| B19 | The moral lens sent users to the browser console | closed | its surfaces parked (K3, #318 `e3985c2`, committed 2026-08-09, merged 2026-08-10) | — |

**Added 2026-08-11, outside the nineteen:** NIP-07 silently voided
entity-key recoverability. **Closed** by Option C, #324 (`4924ea5`,
2026-09-24). [`NIP07_IDENTITY_KICKOFF.md`](NIP07_IDENTITY_KICKOFF.md)
§6 owes "the live walk — entity creation under Local and under NIP-07
(expect the refusal without a local primary, derived creation with
one), and one entity-tagged publish under NIP-07". An agent walked the
creation half on 2026-09-24 at one door, the entity tagger (ledger).
Not on the record: "one entity-tagged publish under NIP-07", and the
other creation doors §6 names — "the claim modal's picker", "the
sidepanel import", `createCase`, and "the LLM review's accept-all".

## 2. Default-off flags

`FLAGS_DEFAULTS` (`src/shared/metadata/feature-flags.js`) holds 20
flags; the 19 below default off (`trustGraphFilter` defaults on).
"Settings" means a checkbox in Settings → Advanced; "DevTools" means
reachable only by editing the `xray:flags` storage key.

**No flag has a ratified check date.** RESET_PLAN §7 R2 and §11-2
propose one date, 2026-11-30, for every judgment family, the parked
shelf and (R2) the 30068 / 30069 / 30070 publish paths — written
"2026-11-30 proposed" below, awaiting the maintainer. Where a flag
gates only part of a parked item, its row says which part. Two
kickoffs set their own dates. Casework evidence means the
maintainer used the feature on real work (soak walks on a real case
count); agent walks and acceptance walks are listed as walks. For a
flag that gates *publishing*, only the publish path counts; local use
of the same feature is noted separately.

| Flag | Switches on | Where | Check date | Last casework evidence |
|---|---|---|---|---|
| `assessmentPublishing` | publishing assessments (30054), claim links (30055) and their 1985 labels | Settings | 2026-11-30 proposed | none on record |
| `epistemicAuditing` | publishing audit results (30056–30061) | Settings | 2026-11-30 proposed | publishing: none on record. Local audits ran on the COVID corpus — JOURNAL 2026-07-09 |
| `forensicPublishing` | publishing behavioural findings (30062), their mirror, story-change edges | Settings | 2026-11-30 proposed | publishing: none on record. Local forensic Accept used — ledger 2026-08-25 (PR #360 soak walk) |
| `truthAdjudicationPublishing` | publishing verdicts (30063) and integrity findings (30064) | Settings | 2026-11-30 proposed | none on record |
| `llmAssist` | the reader's Suggest (the one article pass), plus the audit, entity-audit, forensic, PDF-reconstruction and corpus passes that share its gate; needs the API key. AI vision and the moral lens have their own flags; transcript claim drafts run on LM Studio | Settings | none set — the UA kickoff §5 check is an event ("by the second case corpus worked after UA.2"), not a date | JOURNAL 2026-09-05: the maintainer's 2026-08-30 report of an 87-member corpus reduce, which needs this flag. Also: the four example briefs of 2026-09-21 (#383/#384; see `caseSynthesis`) — a commit, not a ledger row. Suggest itself: ledger 2026-08-25 (PR #358 — 72, 60 and 86 proposals on a long transcript) |
| `platformAccountPublishing` | publishing platform-account links (32126) | Settings | none set | none on record |
| `moralLens` | the reader's lens reading (parked) | DevTools (control removed by K3) | none set — revival condition "once lenses have been tested on real casework" (K3); 2026-11-30 proposed | none on record |
| `entityCorpusPublishing` | publishing entity profiles (kind 0), mention notes (kind 1), entity pages (30023) and the OwnedKeys manifest (30069) | Settings | none set for the flag; 2026-11-30 proposed for the 30069 publish path (R2) | none on record |
| `caseSynthesis` | Analyze corpus (the case brief), entity pages, link and hypothesis suggestions; publishing a stored brief (30023 + 30068). All of it needs `llmAssist` | Settings | none set for the flag; 2026-11-30 proposed for the 30068 publish path and the hypothesis-map suggestions it gates (R2) | JOURNAL 2026-09-05 (the 2026-08-30 report above — the run the job model was built for). Also: four example briefs from real cases committed by the maintainer 2026-09-21 (#383/#384, `EXAMPLE-case-briefs/`) — a commit, not a ledger row |
| `aiVision` | "Describe images" (captions and text-in-image) | Settings | 2026-11-30 proposed | none on record (JOURNAL 2026-07-29 is the ship entry) |
| `captureAutomation` | the `#xray:capture` marker a driving agent navigates to | Settings | none set | agent walk AW-1…AW-7, ledger 2026-08-23 (public pages, not a case); casework: none on record |
| `networkPage` | the Network page (Feed / Queue / Follows) | Settings | 2026-11-30 proposed; R7 decides it on the two-person walk | none on record |
| `reviewCoordination` | "Request review" (the `xray/review` label, in the portal inspector) and re-broadcasting the cached events of people you follow (a Network page button) | DevTools | none set — R2 "Flags" gives it a Settings control or hard-codes it to its default (B10); its re-broadcast button is on the Network page, which R2 parks (2026-11-30 proposed) | none on record |
| `followListPublishing` | publishing who you follow (kind 3) | Settings | none set (the Network page is parked by R2, 2026-11-30 proposed) — its one publish button is on that page | none on record |
| `localTranscription` | Transcribe through the local companion service | Settings | 2026-09-15 (TRANSCRIBE_ANYWHERE_KICKOFF §5) — **passed, no outcome recorded** | ledger and JOURNAL 2026-08-23: a members-only Substack post transcribed through the companion (Deepgram) |
| `directCloudTranscription` | Transcribe with nothing installed (AssemblyAI / Deepgram fetch the media URL) | Settings | 2026-10-01, or the release tag after DC.1 if sooner (DIRECT_CLOUD_TRANSCRIBE_KICKOFF §5) | walks only: ledger 2026-08-15/16 (real episodes, including a Deepgram direct run in the DC.3 walk). Casework — §5's "one transcript feeds a claim or entity page" — was deferred by the maintainer to real corpus-building and is not yet on record |
| `transcriptClaimDrafts` | LM Studio claim drafts over a finished transcript (local, free) | Settings | none set | JOURNAL 2026-08-01 (item 7: the maintainer's same-day correction after a reopened capture hid the drafts button); nothing later |
| `storeFirstPublish` | journal every signed event before sending it to relays | DevTools | none set — R2 and §11-11 propose turning it on next release after its smoke rows are walked once, then dropping the flag | none on record; no ledger row for its smoke section (SMOKE_TEST Phase 29) |
| `extractionAnalysisPublishing` | publishing an article's whole extraction analysis (30070) | DevTools | 2026-11-30 proposed (R2 parks the 30070 path) | none on record — 30070 has only been built against a loopback relay (MA.6 walk, JOURNAL 2026-08-02; CI's `ma6` scenario, still advisory — its preconditions for going required met by #395, the flip the maintainer's on 2026-10-05) |

**Retired flags** (names kept for the record; a stale override is
ignored): `annotations`, `respondsTo` (the tag it named is still
emitted), `topicTrust`, `factchecks`, `ratings`, `helpfulnessVoting`,
`bridgingRanking`, `transitiveTrust` — 2026-08-09 (K2, #317);
`autoPreAnalyze` — 2026-08-12 (UA.3); `readerAddFact` — 2026-07-20,
with the fact layer.

## 3. The parked shelf

Parked means hidden, with code and tests kept and a condition for
coming back.

| Parked | Since | Recorded in | Comes back when |
|---|---|---|---|
| The moral lens's surfaces (the Settings checkbox and the console-pointing empty state; modules, tests, flag and kind 30066 kept) | committed 2026-08-09, merged 2026-08-10 (#318, `e3985c2`) | ROAD_TO_1_0 K3; JOURNAL 2026-08-09; a comment at the removal site in `options.html` | "once lenses have been tested on real casework" (the maintainer) |
| Margin S1, PR #370 (closed; branch `feat/margin-s1` kept) | 2026-09-15 | RESET_PLAN §9 (#370 row) and §9.1 ("Executed 2026-09-15", item b) | re-cut as S1 + S2 in R4 (decision §11-3). The branch survived the 2026-09-25 hygiene `--apply` (Actions run 36171004273) because that run was dispatched from #393's branch with its `keep` input set to `feat/margin-s1`; #393 has since merged (`57a3398`), so the input is on `main`. It is per dispatch: a later `--apply` spares the branch only if `keep` names it again; otherwise the stale rule tags it `archive/…` and deletes it |

**Proposed, not parked** (waits on decision §11-2): R2's one
"Advanced analysis (experimental)" switch over truth adjudication, the
moral lens, hypothesis maps, counterfactuals, AI vision, the Network
page, and the 30068 / 30069 / 30070 publish paths, with one check date
(2026-11-30 recommended). Epistemic audits and forensic findings would
stay visible with the same date.

**Not the shelf:** ROAD_TO_1_0's fifteen kills were **ratified**
2026-08-09, so none awaits ratification. Their execution state
(ROAD_TO_1_0 kill table): done K1 (builders; the empty stores stay),
K2, K6, K7, K10, K11 · parked K3 · half done K5, K8, K15 · blocked
K4, K9, K13, K14 · not started K12. R2 executes K4, K8, K9, K14, K15;
K12 and K13 ride R6.

**The branch hygiene run is done** (RESET_PLAN §9.1, runbook step 6).
On 2026-09-25 the maintainer dispatched `branch hygiene` with
`apply=true` from #393's branch, with `keep` = `feat/margin-s1`
(Actions run 36171004273; its log reads "Actions (70): 2 tag, 68
delete, 0 issue", then "APPLY — 70 ok"). It deleted 68 branches: 66
merged ones, and two old branches it first archived, not parked —
`feature/phase-9b-metadata-ui` as
`archive/feature-phase-9b-metadata-ui-20260529` (RESET_PLAN §9) and
`claude/kind-hypatia-fu8nqm` (#373's squash-merged branch) as
`archive/claude-kind-hypatia-fu8nqm-20260905`. `feat/margin-s1` was
kept. `git ls-remote origin` on 2026-09-25, and again on 2026-09-26,
shows both archive tags and `feat/margin-s1`, and none of the deleted
branches. Merged PRs' head branches still pile up, though: the heads of
#368, #393, #395, #396 and #397 (merged 2026-09-25) and of #394
(`claude/vibrant-dirac-6hixpt`, merged 2026-09-26) are still on
`origin`: "Automatically delete head branches" was off when they
merged. It is on now — the repository API read
`delete_branch_on_merge: false` early on 2026-09-26 and `true` after
#399 merged, and the heads of #398 and #399 were deleted as they merged
— so runbook step 1 is done (RESET_PLAN §9.1). The setting does not
reach back: a squash-merged head is never an ancestor of `main`, so
only the 14-day stale rule reaches the six left over.

## 4. The open-PR cap

**The rule** (RESET_PLAN §8, "PR size and count"; decision §11-8):
at most **four** open non-Dependabot PRs. A new one is not opened
until one merges or is parked.

**Open on 2026-09-26, after #399 merged** (read from GitHub): one
non-Dependabot PR and no Dependabot PR. This page's own PR, once
opened, is the second — **two slots free.**

| PR | What | Waiting on |
|---|---|---|
| #400 | fix(store): a failed read or a workspace switch no longer erases or cross-wires entity records and keys — the entity-list fix that follows #392 (`claude/xray-audit-refactor-opxk01`; +2,181 / −146, eleven commits, opened 2026-09-25 23:21Z, marked ready for review 2026-09-26 00:22Z) | only the maintainer's merge, and a view of its six interpretive steps: it is up to date with `main` (`21d5ed2` merged #398 and #399), and its CI there is green — both required checks and `PR body` |

**Merged on 2026-09-26**, within sixteen minutes:

- **#394** (`a4f859d`, 00:04Z). The five LLM passes that still held one
  message open across the model call (hypothesis edges, claim links,
  the forensic corpus pass, the entity audit and the reader's Quick
  audit) now run as jobs, so none can lose a paid result when Chrome
  stops the service worker mid-call. Five `xray:*` message types were
  retired and none added, and the job messages now answer extension
  pages only (THREAT_MODEL, change row 2026-09-25). Its three hand
  checks (SMOKE_TEST ledger, 2026-09-25): a real Quick audit in Chrome
  passed on the rerun (the maintainer). The same audit in Firefox, and
  a real pass running past ~5 minutes with no DevTools attached, were
  skipped by the maintainer on 2026-09-26. Both stay unobserved, listed
  under SMOKE_TEST's "Not yet walked" (row LJ.e and the Firefox sender
  check).
- **#398** (`94733e1`, 00:16Z): the front-door fixes (B9 above; R0's
  front-door box).
- **#399** (`90e2da3`, 00:20Z): the PR template's four §8 lines and
  `scripts/pr-body-check.mjs`, run by its own `PR body` workflow on
  every PR. It is not a required check (the ruleset still requires
  only `build + lint + package` and `browser smoke`); making it one is
  the maintainer's call.

The count went from one open PR to three at 21:11Z on 2026-09-25 (#398
and #399 opened), to four at 23:21Z (#400), then down to one as the
three merged. The cap was never exceeded in that window.

**Earlier, on 2026-09-25**, three of the four PRs that had filled
the cap that day merged or closed: #393 (`57a3398`); #368 (`6ef815a`) after its
Instagram row, whose first walk was PARTIAL and whose re-walk on the
fixed branch passed (SMOKE_TEST ledger, 2026-09-25); #365, closed
unmerged and folded into #397 (`4d2b1aa`, the 120-line governance
skill), its branch kept so the 453-line text stays recoverable. Two R0
slices merged minutes later: #395 (`16073bc`) and #396 (`1c4fa87`).
The cap was exceeded twice that day, briefly: five were open from
19:58Z to 20:03Z (#395 opened before #393 merged) and from 20:27:56Z
to 20:28:06Z (#397 opened ten seconds before #365 closed).

**Waiting to open:** only this page's own branch,
`toolchain/status-doc`. The entity-list fix the previous refresh knew
only as a report is now #400, so every line on this page can be
checked against the record.

**R0's checklist** (RESET_PLAN §7) on 2026-09-26: nine of its ten
boxes are ticked, two of them on this page's own branch. On `main`: the
browser smoke in CI (`pages` required, and the `browser smoke` check
itself required by the ruleset, which settles that box's "owed to the
maintainer" line); ESLint minimal with CI's version lockstep,
packaged-contents assertion and bundle budget (#396); the golden
fixtures; the structure guard; the JOURNAL split; the PR template
(#399); and the front-door fixes (#398). On this branch: this page,
and branch and PR triage — every runbook step is now done, the last
being auto-delete of merged heads (§9.1's 2026-09-25 update). Open:
only the MA.6 walk going required (its preconditions met by #395; the
flip is the maintainer's, due 2026-10-05).

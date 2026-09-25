# X-Ray status

**Hand-maintained until RESET_PLAN R6 generates it. As of 2026-09-25**
(`main` at `88b1c5b`).

One page for four questions: what still blocks 1.0, which switched-off
features get checked when (and whether real casework has used them),
what is parked, and how many pull requests may be open at once. Every
line names where its evidence lives, so any line can be checked and
refreshed by re-reading that source.

*Provenance: INTERPRETATION (2026-09-25) — an agent's reading of the
tree, `git log origin/main`, the PR records and `docs/journal/`.
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
| B7 | No store listing or other installable channel; the zip is unpruned | open | `webExt.ignoreFiles` still excludes only the companion and smoke output | R4 "First run"; decision §11-6 |
| B8 | No runnable release gate; no verification record | partly done | walk ledger since #320 (`a3a8e02`, 2026-08-10); browser smoke in CI since #379 (`d139ba5`, 2026-09-21). Still open: version lockstep only in `release.yml`, no packaged-contents check, SMOKE_TEST not split into a short gate | R0 (ESLint / lockstep item), R6 (`GATE.md`), R7 |
| B9 | The front door misstates what shipped | partly done | `release.yml` now refuses an empty CHANGELOG section (#318, JOURNAL 2026-08-09). Still wrong: README "v0.7.0" and "2100 tests", CHANGELOG `[Unreleased]` "Nothing yet", Settings "(Phase 25)" | R0 "Fix the front-door lies" |
| B10 | Three features reachable only through DevTools | open | still no Settings control for `reviewCoordination`, `storeFirstPublish`, `extractionAnalysisPublishing` | R2 "Flags" |
| B11 | Flag registry noise; the guide's flag table is wrong | partly done | eight dead flags retired (#317, `bd0396d`). The guide no longer lists them but omits four live flags (`aiVision`, `directCloudTranscription`, `storeFirstPublish`, `extractionAnalysisPublishing`); no flag ledger, no guard | R2 "Flags"; R6 |
| B12 | Publish fires on one click; disclosures arrive as toasts | open | the reader's Publish button still calls `publish()` directly | R4 "Publish pre-flight" |
| B13 | No first hour | open | install only registers the right-click menus; no surface links to the user guide (Settings has a "Capture tips" link to the capture guide) | R4 "First run" |
| B14 | The group workflow has never been used by two people | open | no two-person walk on the ledger | R7 two-person walk |
| B15 | Group surfaces show authors as raw hex | open | the reader and the side panel still slice hex keys | R7 (with B14) |
| B16 | The wire record does not match what the code emits | partly done | 30050–30053 and 9803 reclassified reserved (#317, K1). Still open: no NIP_DRAFT section for 30041 or 30078, no CONSTITUTION Art. 10 rows for kinds 1 and 5, the `x` tag's second meaning unwritten | R2 "Make the kind schedule true"; R3 lane A |
| B17 | The follows feed drops unreadable events silently; kind 0 / 10002 overwrite blindly | open | `parseFeedEvent` still returns a bare `null` | **no named track** — §10 (WIRE-10) covers only the 10002 half |
| B18 | No threat model | closed | `docs/THREAT_MODEL.md` added in #316 (`41b8fff`); updated since, most recently by #374 and #392 | — |
| B19 | The moral lens sent users to the browser console | closed | its surfaces parked (K3, #318 `e3985c2`, 2026-08-09) | — |

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
| `extractionAnalysisPublishing` | publishing an article's whole extraction analysis (30070) | DevTools | 2026-11-30 proposed (R2 parks the 30070 path) | none on record — 30070 has only been built against a loopback relay (MA.6 walk, JOURNAL 2026-08-02; CI's advisory `ma6` scenario) |

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
| The moral lens's surfaces (the Settings checkbox and the console-pointing empty state; modules, tests, flag and kind 30066 kept) | 2026-08-09 (#318, `e3985c2`) | ROAD_TO_1_0 K3; JOURNAL 2026-08-09; a comment at the removal site in `options.html` | "once lenses have been tested on real casework" (the maintainer) |
| Margin S1, PR #370 (closed; branch `feat/margin-s1` kept) | 2026-09-15 | RESET_PLAN §9 (#370 row) and §9.1 ("Executed 2026-09-15", item b) | re-cut as S1 + S2 in R4 (decision §11-3). The branch survived the 2026-09-25 hygiene `--apply` (Actions run 36171004273) because that run was dispatched from #393's branch with its `keep` input set to `feat/margin-s1` |

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
kept. `git ls-remote origin` on 2026-09-25 shows both archive tags and
`feat/margin-s1`, and none of the deleted branches.

## 4. The open-PR cap

**The rule** (RESET_PLAN §8, "PR size and count"; decision §11-8):
at most **four** open non-Dependabot PRs. A new one is not opened
until one merges or is parked.

**Open on 2026-09-25** (read from GitHub): four non-Dependabot, no
Dependabot — **the cap is reached; no slot free.**

| PR | What | Waiting on |
|---|---|---|
| #368 | fix(instagram): build the post URL, never trust `og:url` (one account's reel filed under another's address, on the wire) | its ~1-minute Instagram reel row, then the merge. The stray Margin plan file was removed 2026-09-25 on the maintainer's go |
| #365 | docs(skill): the governance skill (draft, +528) | the fold RESET_PLAN §9 prescribes (a ≤120-line PR), or a close; no activity since 2026-08-29 |
| #393 | ci(hygiene): a `keep` input so a hygiene run spares `feat/margin-s1` (draft, +7 / −1, opened 2026-09-25) | review and merge (its `keep` input was already used by the 2026-09-25 dispatch, run 36171004273) |
| #394 | fix(llm): the last five single-call LLM passes run as jobs — #374's follow-up (draft, +1,559 / −208, opened 2026-09-25) | its security review (in progress, per the PR body), the human rows it hands over (a real Quick audit in Chrome and in Firefox), then leaving draft |

#390, #374's walk-note follow-up, is not open: it merged 2026-09-25
as `88b1c5b`.

The R0 toolchain slices still open (ESLint + lockstep + packaged
contents, the PR template, the front-door fixes, the MA.6 flip
preconditions) open **one at a time** as slots free. This page's own
PR would be a fifth, so it waits until one of the four merges or is
parked.

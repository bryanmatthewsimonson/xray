# Adversarial review of docs/RESET_PLAN.md (2026-09-07)

Reviewer: completeness critic + adversarial reader. Tree: `main` @ c1e652c. Every
verdict below was checked by opening the cited file or running the cited count;
"UNVERIFIABLE" means the evidence is outside the tree (a lens report's own
measurement, external pricing, a workflow journal not committed).

---

## 1. Completeness table — the maintainer's ask, clause by clause

| # | Clause of the ask | Answered where | Verdict | What is missing |
|---|---|---|---|---|
| 1 | "Fresh eyes — what would the designer and UX expert do starting today?" | §1 keep, §2 grandfathered, §R4 (first run · pre-flight · one reading surface · "Three surfaces, six nouns"), §11-13 | **Well on mechanism, thin on picture.** | §0 never *describes* the target product a non-coder could picture (what the first hour looks like, what the reader header reads on first paint — that sentence is buried in §R4). The UX report (668 lines) has it; the plan should lift its first-hour surface map into §0 or §R4 as a five-line narrative. |
| 2 | "What is good and what is just grandfathered" | §1, §2, §3 | **Well.** | Two factual slips inside it (§2 "byte-identical caches" is wrong; §2's soak-rule date is 08-22 local / 08-23 UTC — fine). The tables are the plan's best pages. |
| 3 | "Why isn't documentation always up to date?" | §5 (five whys, measured compliance 45/55/0/2/12%), R6 | **Well.** | The numbers are transcribed from doc-currency.md and I re-derived CHANGELOG 0/145 merges myself. Only miss: the vendored prompt file (`module-prompts.js`, GENERATED from `docs/auditor-prototype/prompts`) is a generator-plus-source pair the doc-currency track never lists. |
| 4 | "Why aren't governance firewalls and critical decisions confirmed systematically?" | §4.1 lineage, §4.4 marker protocol, D5, §8 "Decisions" | **Well, with three legal holes.** | (a) Art. 13 Tier 1 requires "an explicit statement of the failure mode the change accepts" — none of D1–D6 carries one, so the R1 amendment PR as specified would be void under Art. 13. (b) Art. 11 says decisions are "recorded in `docs/JOURNAL.md`"; moving rulings to `docs/RULINGS.md` and splitting the JOURNAL touches that literal text and the plan never names it. (c) The 90-day expiry meta-guard (§4.4 item 3) is a calendar time-bomb: CI goes red on a date with no diff, for a maintainer who cannot read the failure. |
| 5 | "'No aggregations' … now 'firewalls' everywhere … incoherent" | §4 entire; D1–D3; §4.2 census | **Well — the strongest section.** | D2's headline instrument ("a corpus mean + range + n") sits directly against Art. 4.4's sentence "no case, entity, or corpus ever carries a fused score" and Red line 2 (Art. 12) and PHILOSOPHY P8 — the plan cites Art. 5.2/5.4 only. It must name 4.4/RL-2 as Tier-1 text touched. Also the §4.2 group headers say 7 / 8 / 7 mechanisms but the ids listed are 9 / 9 / 4. |
| 6 | "Automation of testing" | §6, R0 (smoke in CI, ESLint, golden fixtures, structure guard), §8 CI gate + tiered soak | **Well.** | No flake policy for the browser job (retry / quarantine label) — the single most common way a required browser check kills throughput; no wall-clock budget for the smoke step (the unit suite gets "≤ 60 s", the smoke gets nothing); "with its stale selector fixed" is asserted, not evidenced (no `data-xr` attribute exists in any HTML today, so every selector is a candidate). |
| 7 | "Automation of corpus capture + claims extraction + entity extraction for hundreds of URLs" | §R5 (works-at-10 / breaks-at-100 / cost / five slices), §11-10 | **Well.** | Honest that entities are missing from the durable layer. Thin: no named success run for the maintainer's own case ("your COVID case, N=?, by <date>"); the cost table's per-token prices are the corpus lens's assumption (the in-tree `llm-prompts.js` note is grandfathered — the report says so; the plan does not). |
| 8 | "Progress slow … testing stuff I don't care about" | §6 (soak rule as serial gate), §8 tiered soak, §9 #370 Park | **Well.** | — |
| 9 | "Too buggy / too hard to use / too manual / too incoherent" | buggy → §6/R0; hard → R4; manual → R5; incoherent → R2 + §4 + R4 nouns | **Answered but scattered.** | §0 should map the four adjectives to the four tracks in one line; today a reader assembles it. |
| 10 | "Where do we start?" | §0 "first two weeks" (five steps), R0 | **Well.** | Step (4) costs the maintainer ≈ 20 min pre-read + 90 min; nothing else in the plan states maintainer time (see Gaps). |
| 11 | "Subordinate all existing branches … multiple threads … reliable tested code" | §8 (lanes, worktrees, PR cap, CI gate), §9 dispositions, R0 triage | **Well.** | (a) #373 and #374 are DRAFT PRs (GitHub: `draft: true`); §9 says "Merge now" / "Rebase and merge" without "mark ready". (b) The lane path-check will fire constantly on the reader: `reader/index.js` imports `audit/corpus-sources.js` (portal lane) and `corpus-prompts.js` (llm lane), and `article-pass.js` — the reader's Suggest engine — is assigned to the portal lane. (c) Agent sessions auto-name branches `claude/<adjective>-<name>`; the `<lane>/<topic>` rule needs a stated mechanism. |
| 12 | "Rely on you interpreting correctly, asking for clarity, operating with humility" | Header ("nothing ratified"), §4.4 item 5 (one question per message, "keep" is complete), §11 defaults | **Well in §11; contradicted in tone elsewhere.** | §0 "What changes permanently (§8)", §8's declarative operating model, R1's checkbox "Delete C2, the verbatim clause pins and the two dozen banned-word lists" (pre-executes D1), "Adopt the marker protocol (§4.4) **verbatim**" (an agent-drafted protocol adopted verbatim is the exact failure pattern §4.4 describes). |

---

## 2. Refutation table — claims opened against the tree

| # | Where | Claim | Verdict | Evidence / correct value |
|---|---|---|---|---|
| 1 | §3 | `README.md:19` "v0.7.0"; `:381,406` "2100 tests" | **CONFIRMED** | exact lines |
| 2 | §3 | `CHANGELOG.md:11-13` "Nothing yet"; release workflow fails on an empty section | **CONFIRMED** | `release.yml:109-111` `::error … no non-empty section` → `exit 1`; 145 merges since v0.8.0, CHANGELOG touched 0 times |
| 3 | §3 | `esbuild.config.mjs:3` "seven bundles" | **CONFIRMED** | line 3 |
| 4 | §3 | `api-interceptor.js:14-19` "NOT auto-injected"; `manifest.json:80-95` injects at `document_start` | **CONFIRMED** | both |
| 5 | §3 | CLAUDE.md "eight of the nine skills" (twelve exist), "~2500 tests", "no section walk is outstanding" | **CONFIRMED** | CLAUDE.md:303/21/431; `.claude/skills/` has 12 dirs + README |
| 6 | §3 | `ROADMAP.md:94` complete vs `:1500` "smoke run pending"; `:2153-2161`, `:2164-2174` | **CONFIRMED** | exact |
| 7 | §3 | K1: `archive-cache.js:173-201` creates five dead stores | **CONFIRMED** | annotations/factchecks/ratings/helpfulness/trust_graph; `TRUST_GRAPH_STORE` has no reader anywhere (ROAD_TO_1_0 K1 says "four" — the plan's five is the more accurate count) |
| 8 | §3 | K3 `reader/index.html:144-146`; K8 `:127`; K4 `background/index.js:477-495` + `options/index.js:1862`; K9 `sidepanel/index.js:1289-1320` + `entity-tagger.js:150`; K14 `storage.js:354-360, 408-412` | **CONFIRMED** | all; K9's modal iterates `ENTITY_TYPES` which includes `'case'` (`entity-model.js:59`) |
| 9 | §3 | `api-pattern.js` zero importers; `xray:scholar:crossref` handled (`background:1207`) never sent | **CONFIRMED** | only a comment mention in `api-hook-buffer.js:72`; only `crossref.js:10` comment |
| 10 | §3 | `'local_primary_identity'` literal "in five files" | **WRONG** | 4 files in `src/` (backup.js, storage.js, identity-profiles.js, options/index.js) |
| 11 | §3 | "seven raw `chrome.storage.local.get(['preferences'])` + `JSON.parse` copies" | **WRONG (minor)** | 8 sites: network:83, reader:1128, reader:7821, sidepanel:501/1652/1718, background:51, portal/inspector:421 |
| 12 | §3 | `AUDIT_DRAFT_PREFIX` at `corpus-audit.js:24` and `reader/index.js:4383`; `'xray:user'` at `sidepanel:51` and `portal/identity.js:34`; `options/index.js:57-125` re-implements Storage | **CONFIRMED** | exact |
| 13 | §3 | Three flags with no control: `reviewCoordination`, `storeFirstPublish`, `extractionAnalysisPublishing` | **CONFIRMED** | zero hits in options.html / options/index.js |
| 14 | §3/§4.2 | `constitution-guards.test.mjs:241-261` export-name regex; `:98-115` verbatim pins; `:316` deferred Art. 5 guard | **CONFIRMED** | exact |
| 15 | §3 | `corpus-publish.test.mjs:83` bans `\d+\s*%`; `hypothesis-block.test.mjs:130` bans "stronger"/"confidence"; `entity-dossier.test.mjs:185` bans "credibility"; `lens-guards:196-207`; `extraction-accept-all:51-53` | **CONFIRMED** | hypothesis regex is at :134 (block starts :127) — cite drift of 4 lines |
| 16 | §3 | 205 bare `console.*` (reader 103, youtube 18, instagram 16, background 9) | **CONFIRMED** | exact counts |
| 17 | §3 | Committed walk outputs + hardcoded container paths `ma6-walk.mjs:31-34` | **CONFIRMED** | `/opt/pw-browsers/chromium-1194/…`, `/opt/node22/…`; 3 PNG + JSON + txt committed |
| 18 | §3 | `#xr-pending-suggest` can never show (no writer) | **CONFIRMED** | reader:4310 reads `getPendingSuggestions`; `savePendingSuggestions` (`audit-cache.js:273`) has no caller in `src/` |
| 19 | §4.1 | `corpus-rollup.js:4-6` refuses a mean; `truth-builders.js:369` nulls non-adjudicable; `truth-entity-record.js:255-275` computes the ratio | **CONFIRMED** | exact |
| 20 | §4.1 | JOURNAL 2026-07-21 "too prescriptive" / "no way of knowing"; 2026-07-03 deleted CONSENSUS_PROTOCOLS_PLAN | **CONFIRMED** | JOURNAL:3527ff, :6771ff |
| 21 | §4.1 | Maintainer 2026-08-28: "there needs to be a reconciliation between my original intentions and what has been codified" | **CONFIRMED (off-main)** | not in JOURNAL; it is line 6 of the questionnaire on the #366 branch |
| 22 | §4.3 | PR #366 questionnaire Q1–Q19, F1–F13, §5 ledger 17 rows | **CONFIRMED** | branch file: Q19 present, 16 F-rows incl. header, 18 §5 rows incl. header (PR *body* says Q1–Q12 — the body is stale, the file is right) |
| 23 | §1 | "the most wikipedia-like artifact" — `JOURNAL 4138` | **WRONG cite** | JOURNAL:4138 is "Case brief: numbered citations + a Sources list". The phrase lives at `docs/LIBRARIAN_KICKOFF.md:23,34` (and JOURNAL:3713) |
| 24 | §R2/§11-11 | "the maintainer's 2026-08-02 ruling said 'flip early'" (quoted) | **UNVERIFIABLE as a quotation** | "flip early" appears nowhere in the JOURNAL; the 2026-08-02 store-first entry (:2940-2975) says "Flag flips gate on the smoke rows alone — no soak period." Paraphrase presented as a quote |
| 25 | §2 | `xray-portal` and `xray-network` are "byte-identical derived caches" | **WRONG** | 205 vs 209 lines; after name-normalisation and comment-stripping they still differ in code: network-cache adds `LAST_LOOKED_KEY`, `firstSeenAt`, `getProfile()`; portal-cache carries `dTag`. Near-duplicate, not identical — the merge (Lane C) is still right, the premise is not |
| 26 | §6/§9 | `main` no commit since 2026-08-28; 54 back-merge commits; only #324 conflicts and only in `docs/JOURNAL.md`; 65 of 79 branches are ancestors | **CONFIRMED** | last commit 2026-08-28 15:39 -0700; 55 back-merge-shaped merges by my pattern; `git merge-tree`: #324 → JOURNAL only, #368/#370/#374 clean; 66 ancestor refs incl. `origin/main` itself |
| 27 | §6 | Soak rule "adopted 2026-08-23" | **CONFIRMED (UTC)** | commit 8f0944a 2026-08-22 23:17 -0700 = 08-23 06:17 UTC; CONTRIBUTING:228-245 |
| 28 | §6 | reader 8,294 lines; `publish()` 1,573 lines at `:6026-7600`; SW is a 950-line if-chain of 45 handlers | **CONFIRMED** | `wc` 8294; `publish()` at :6026, next fn :7644; 45 `message.type ===` sites spanning :416–:1381 |
| 29 | §6 | ROAD_TO_1_0 T5–T8 "0/35"; Appendix B track status | **CONFIRMED exactly** | T1 7/7 · T2 4/8 · T3 1/8 · T4 1/10 · T5 0/7 · T6 0/8 · T7 0/11 · T8 0/9 |
| 30 | §R0 | "T4-3/6", "T4-4", "T4-9 was recorded done and is not" | **CONFIRMED in substance; ids do not exist** | ROAD_TO_1_0 T4 items are unnumbered checkboxes; the 9th (only `[x]`) claims the PR template gained "Wire format:" + a Verification-layer section — the template has neither |
| 31 | §R5 | Retry is one fixed 15 s with no `Retry-After` | **CONFIRMED** | `url-import.js:249`, `run-orchestrator.js:39` `retryDelayMs = 15000`; no `Retry-After` anywhere |
| 32 | §R5 | `map-artifacts.js:95-108` stores no entities; `extraction-block.js:372-380` mints `about: [caseId]` only | **CONFIRMED** | exact |
| 33 | §R5 | Cost table ($9–12 / $23–30 / $48–65 per 100; N=500 $45–60, 2–3 h) | **CONFIRMED as transcribed; UNVERIFIABLE as fact** | corpus-automation.md:87-94; per-token prices are that lens's assumption |
| 34 | §10 | Both DNR rules serve a path "the JOURNAL declared dead on 2026-04-19"; live fetch runs in the MAIN world | **CONFIRMED in substance, over-stated as a cite** | `background/index.js:1005-1060` runs the fetch via `scripting.executeScript({world:'MAIN'})` and its own comment says cookies+Referer "return HTTP 200 with a 0-byte body"; the 04-19 entry records the mid-2024 PO-token gating, it does not say "dead". The SW comment still cites a non-existent `rules/referer-youtube.json`. The walk-before-delete hedge is correct and necessary |
| 35 | §10 | THREAT_MODEL records the WAR entry "removed" while it is present and guard-pinned to stay | **CONFIRMED** | THREAT_MODEL.md:187; `manifest.json:101`; `tests/t2-security-surfaces.test.mjs:63-68` ("stays web-accessible … restored after a field break") |
| 36 | §10 | Firefox manifest `data_collection_permissions: none`; no JOURNAL entry for it; no PRIVACY.md | **CONFIRMED** | manifest:133; grep JOURNAL → none; `docs/PRIVACY.md` absent |
| 37 | §10 | api-interceptor logs three console lines unconditionally | **CONFIRMED** | :44, :109, :197 |
| 38 | §10/§R2 | 30041 republishes strangers' handle + profile URL; no NIP_DRAFT section; the "include comments" checkbox | **CONFIRMED** | `event-builder.js:836-837` (`author-handle`, `author-url`); `grep 30041 NIP_DRAFT` → none; `reader/index.html:159` |
| 39 | §R2 | "on a number NKBIP-01 also uses" (30041) | **CONFIRMED, but incomplete** | `NIP_DRAFT.md:141` says **30040** has the NKBIP-01 collision too, and 30040 is in the §11-11 stable promise; WIRE-18 flags the decision as undocumented — the plan carries only the 30041 half |
| 40 | §0 | "20 default-off flags" | **WRONG (minor)** | 20 flags; 19 off, `trustGraphFilter` is on |
| 41 | §0 | "Twelve batched decisions in §11" | **WRONG** | §11 has thirteen numbered decisions |
| 42 | §0/§4.2 | 22 firewall mechanisms; "eight generalizations", "seven prose pins" | **CONFIRMED (22); labels WRONG** | governance.md F0 has 22 rows; the §4.2 rows list 9 / 9 / 4 ids under headers saying 7 / 8 / 7 |
| 43 | §9 | #368 +608 with a 421-line Margin plan file riding along | **CONFIRMED exactly** | PR files: JOURNAL +43, `docs/superpowers/plans/2026-08-28-margin-s1-see.md` +421, instagram.js +46/−2, test +98 |
| 44 | §9 | #324 +390/−57, 31 files, 26 days old, Option C ratified | **CONFIRMED** | GitHub API; created 2026-08-11 |
| 45 | §9 | #370 +1,872; "fourteen-row checklist" | **CONFIRMED** | +1872/−36; 14 `M.n` rows on the branch's SMOKE_TEST (PR body says M.1–M.11) |
| 46 | §9 | #373 "Merge now", #374 "Rebase and merge" | **INCOMPLETE** | both are `draft: true`; the plan says "mark ready" only for #364 |
| 47 | §0/§6 | Executed modules 199/247 (verifier-corrected from 186) | **UNVERIFIABLE** | verification-automation.md says 186/247; the 199 lives in an uncommitted workflow journal |
| 48 | §0 | "twenty header buttons in the reader (twelve flag-hidden) over seven stacked bars" | **UNVERIFIABLE / count-method dependent** | first `<header>` block: 16 buttons, 8 hidden; "seven stacked bars" confirmed in ux-designer.md UXDE-03 |
| 49 | §2/§11-7 | Companion is "Windows-only" | **CONFIRMED** | `companion/transcriber/README.md:23-25` Requirements lists only Windows 10/11 |
| 50 | §5 | Docs 3.05 MB vs src 4.35 MB (0.75×) | **STALE** | by file bytes today: docs 3.68 MB, src 4.57 MB (0.80×) — the audit directory itself was added since the measurement |
| 51 | §R4 | No first-run exists | **CONFIRMED** | `onInstalled` only calls `registerContextMenus` (background:368) |
| 52 | §D4 | "rule §15.3: bulk-accept of individually grounded rows is lawful" | **CONFIRMED cite; reversal unstated** | DISCIPLINES §15 standard 3 reads "One accept per artifact — bulk credulity is not review." The plan should say it is reversing a standard, not "ruling" one |

Score: 52 claims opened; 38 confirmed as stated, 6 confirmed with a corrected detail, 5 wrong (10, 11, 23, 25, 41 — plus 40/42 label errors), 3 unverifiable.

---

## 3. Contradictions, constitutional collisions, and tone

### 3.1 Internal contradictions (same document, different answers)
1. **Audits and forensics: parked or visible?** §11-2 default: "Park audits, forensic, verdicts, integrity, lens, hypothesis maps, counterfactuals, AI vision behind one switch." §R2 (line 486) and §12 (line 1230): "Epistemic audits and forensic findings stay visible." The maintainer reads §11 as the decision sheet and gets the opposite of the plan's own resolution.
2. **JOURNAL split: quarter or month?** §5 (:325) and §R6 (:762) say per quarter; §R0 (:439), §8 (:846), §11-12 (:1189) and §12 (:1241) say per month.
3. **§0 "Twelve batched decisions"** vs thirteen in §11.
4. **#370 walk: four rows or five?** §9 (:951) "M.1, M.2, M.7, M.8 (~10 min)"; §11-3 (:1120) "the five-row walk".
5. **§4.2 group headers vs ids** (7/8/7 vs 9/9/4).
6. **"Ship:" in §10 vs "promise" in §11-11 vs "park" in §R2.** §10's kind census says "Ship: … 30063 + mirror, 30064, 30068, 30069" (meaning: emitted by shipped code today); §R2 parks the publish paths for 30068/30069/30070; §11-11 promises only 30023/30040/0/10002/30078 as stable. A non-coder reads "Ship" as "ship in 1.0". Relabel §10's list "Emitted today".

### 3.2 Constitutional non-negotiables touched without saying so
- **D2 vs Art. 4.4 and Red line 2 (Art. 12).** Art. 4.4: "no case, entity, or corpus ever carries a fused score." Red line 2: "let a fused number stand where a distribution belongs." D2 proposes "a corpus mean + range + n" and a case "evidence balance" and cites only Art. 5.2/5.4. Spread-shown may satisfy 5.2, but 4.4's sentence is universal-principle text and the corpus-rollup header cites P8 for the refusal. The plan must name Art. 4.4 / RL-2 / P8 as touched, and (per Art. 13 Tier 1) state the failure mode accepted. Also D2 cites "Art. 5.4 sentence 1" for the case-headline rule; that sentence is 5.4's third.
- **Art. 13 Tier 1 ceremony is unmet by D1–D6.** Tier 1 requires "an explicit statement of the failure mode the change accepts" for any weakening. None of the six rows carries one; §R1's "one amendment PR" as specified would be a void amendment under the constitution's own text.
- **Art. 11's literal record location.** "Every decision … is recorded in `docs/JOURNAL.md`." The rulings ledger (`docs/RULINGS.md`) + JOURNAL split + generated index changes where decisions are recorded; D5 amends Art. 11 for the ratification act but not for this.
- **Art. 3 and parking.** Parking hides "reader bars and portal blocks" (§R2). Any verdicts, lens readings or hypothesis maps the maintainer has already authored become invisible in the UI. Art. 3 forbids silent filtering *for* the reader; the plan's "tests stay, code stays" answers the code question, not the user's-own-records question. One line ("parked families keep a read-only 'Archived analyses' list") would close it.
- **DISCIPLINES §15.3 reversal** (see refutation 52) and **§4.2 override (a)** ("extend it locally so unreviewed extraction rows can render and feed the corpus reduce") — the latter pre-empts §11-10(a) by naming the override "worth naming now"; Art. 4.7 would also want the brief to disclose how many unreviewed atoms it drew on, which §R5 does not require.

### 3.3 Where the plan rules instead of recommending (Art. 11)
- §0 "What changes permanently (§8)" — heading and content are declarative.
- §8 is written as the adopted operating model, though §11-8/-9 ask the maintainer to confirm its parts.
- §R1 checkbox "Delete C2, the verbatim clause pins and the two dozen banned-word lists" executes D1 before D1 is decided.
- D5: "Adopt the marker protocol (§4.4) **verbatim**" — an agent-drafted protocol adopted verbatim is exactly the interpretive hardening §4.4 says to stop.
- §4.2 "Fresh-eyes disposition: keep as law / demote or split / remove or convert" reads as dispositions, not proposals.
- §4.4 item 3's expiry meta-guard converts an agent's date arithmetic into a red build the maintainer cannot fix without an agent — recommend "opens an issue / warns", never "fails".
Mitigation already present: the header's "Nothing here is ratified" and §11's "keep is a complete answer." The body should match the header.

### 3.4 Unclear or alienating to a non-coder reading §0 and §11
- Unexplained ids: K1–K15, B2–B19, T4-4/T4-9 (positional, not in ROAD_TO_1_0), C2–C22, Q1–Q19, F1–F13, E1–E5, D1–D6, R0–R7, PROD-/ARCH-/UXDE-/VERI-/DOCC-/GOVE-/WIRE-/SECU-/CORP-/BRAN-/NEWC-, "Tier 1/2/3", "kind 30070", "NIP-26", "HKDF".
- Unexplained jargon in §0: "guard suite", "prose pins", "`confirmedOk`", "IIFE", "MAIN-world", "strangler", "worktrees", "`merge=union`", "structure guard", "harness", "golden fixtures", "one-way door".
- §11-6 asks the maintainer to "confirm the four calls" on CSP/DNR/WAR/30070 defaults with no plain statement of the user-visible consequence of each (only the NIP-07 one has it).
- No glossary, no "if you read one page" summary that avoids ids. §0 is close but leans on §-references for every claim.

### 3.5 Big-bang rewrite in disguise
- **R4 "Three surfaces, six nouns"** replaces portal + sidepanel + network with a new "Library" and re-cuts the reader as one surface — that is a rewrite of the entire surface layer, marked L "in slices" with no slice list. Its first slice should be subtractive (park/hide/rename) with zero new surface.
- **R3 lane E** moves 57 modules + four modals + five domain clusters "between waves" — every open PR at that moment rebases.
- **R5 slices 3–5** add a DB version, a worker-driven intake job with an offscreen document, and a Node CLI bundle — three new architectures in weeks 3–8.
- Running R3 (five lanes) + R4 + R5 + R6 in weeks 2–8 in parallel, gated by one human, is the same shape as the August wave the plan diagnoses.

### 3.6 Restating ROAD_TO_1_0 instead of citing
Mostly disciplined (ids cited, Appendix B crosswalk). Exceptions: §10's security bullets restate T2/B5/G-ids at paragraph length; §3's kill list restates K1–K15 targets; §R4 "First run" restates B7/B13/T7. Acceptable, but §10 could be halved by citing SECU-n and THREAT_MODEL G-n.

---

## 4. Gaps — what all eleven lenses missed that the maintainer would care about

1. **Cost in maintainer hours.** The only quantified maintainer time is the 90-minute session (+20 min pre-read) and the weekly 30–45 min soak. R7's two-person walk, R4's first-hour verification, the YouTube transcript walk before deleting DNR rules, the #368 Instagram row, the #374 money row, the #324 refusal row, store-account setup and privacy-form authoring are all maintainer minutes with no total. A "your time, per track" column is the single most useful missing table for a non-coder.
2. **Casework in progress during the reset.** Only "casework never stops" (§8). Nothing says: back up before R0; `main` is your daily build and every step is a revertable PR; what happens to your open COVID case when K1's v4 ladder, the parking switch, the flag-metadata migration, or Lane C's cache merge land; how to report "the reset broke my case" (the diagnostics ring exists — say so).
3. **The LLM prompt files themselves.** Never assessed. `module-prompts.js` (1,329 lines) is GENERATED verbatim from `docs/auditor-prototype/prompts/*` by `tools/gen-module-prompts.mjs` — a source/generated pair with no drift guard, owned by no track; `corpus-prompts.js` is hand-versioned (`corpus-v9`) alongside six other hand-bumped prompt versions; no prompt has a data-block wrapper (confirms SECU-5); the only prompt test is a shape test (`corpus-prompts.test.mjs`); there is no eval harness over the paid-repair / shape-failure cases the JOURNAL keeps recording (2026-08-22, 08-25). "Too buggy" for the maintainer is largely Suggest/analysis behaviour, which lives in these files, and the plan has no lane item for "are the prompts good".
4. **NIP-07 / identity layer beyond #324's disposition.** Option C makes entity creation refuse without a local primary. R4's first run generates a local identity, which quietly resolves it for newcomers — but the plan never says so, never decides whether 1.0 supports NIP-07-only users, and parks 30069/NIP-26 while Option C's design rests on the local root. One decision row: "1.0 identity = generated local key; NIP-07 is an advanced signing option, entities always root locally."
5. **Sidepanel.** §11-13 retires it as a picker after one release; R4 says "One entity destination reachable from every chip." Its unique verbs (create entity, merge/equivalence, entities-JSON import, the per-entity dossier) have no named new home.
6. **Firefox.** "Capture-only, community-supported" is offered, but the security bundle (on-demand MAIN-world injection, WAR removal) is exactly the surface Firefox 128 differs on, the manifest floor is load-bearing, and any Firefox install needs AMO signing. No Firefox row exists in the gate.
7. **Companion service.** Correctly labelled developer/Windows, but: stays in-repo with its own dependabot stream (#371), its Python tests are not in the plan's CI gate (ROAD_TO_1_0 T4 lists them), G8 (DNS rebinding on the companion's URL admission) is not in §10, and the "audio leaves machine" disclosure for direct cloud must appear in PRIVACY.md.
8. **PDF / EPUB.** Kept, one fixture in R5 slice 1, no gate rows named; the pdf.js runtime assets (cmaps/fonts/wasm) are the largest packaged-contents risk and are not mentioned under the packaged-contents assertion.
9. **Migration of existing user data.** Persisted shapes and golden fixtures are covered. Not covered: existing `xray:flags` overrides when flags move behind one switch (semantic change, not shape change); rows in the dead `pending-suggestions` store; the maintainer's already-published 30070/30068/30069 events after their publish paths are parked (they stay on relays — say so).
10. **Release / store lead time.** "Start the day R0 lands" with no estimate, no account checklist (Chrome developer account, privacy practices form, AMO account, `update_url` hosting), and no statement that only the maintainer can do these.
11. **Sequencing risk.** R1 gates R4; if the session slips past week 2 the plan has no fallback timeline (it has a fallback *answer* — "keep" — but not a fallback *date*). R3 lane D "needs maintainer soak per PR" conflicts with the weekly-batch model. "Scenario walks advisory for two weeks, then required" has no owner and no flake policy.
12. **30040's NKBIP-01 collision** (NIP_DRAFT:141, WIRE-18) — promised as stable in §11-11 while 30041 is moved local-only for the same collision.
13. **Time-bomb guards.** The 90-day INTERPRETATION expiry fails CI on a calendar date; for a solo non-coder that is an unexplained red build.

---

## 5. The five edits that would most improve the plan

1. **Make D1–D6 constitutionally valid and honest about what they touch.** Add two lines to each row: "Constitution text touched: Art. …" and "Failure mode accepted: …" (Art. 13 Tier 1). For D2 name Art. 4.4, Red line 2 and P8 explicitly; for D5 name Art. 11's "recorded in docs/JOURNAL.md"; for D4 say "§15.3 currently says the opposite — this reverses it."
2. **One reconciliation pass over the contradictions:** §11-2 vs §R2/§12 (audits/forensics visible or parked); quarter vs month; twelve vs thirteen; four vs five rows; §4.2 group counts; relabel §10 "Ship:" as "Emitted today:". Mark #373/#374 "mark ready, then merge."
3. **Add a "What this costs you" box after §0**: maintainer minutes per track (session 110 min; weekly soak 30–45 min × N weeks; the named one-off walks with their minutes; store/AMO account setup), the casework-safety rule (backup before R0; `main` is always your build; any step reverts as one PR), and the store-lead-time estimate.
4. **Add a plain-language legend** (½ page): what a guard, a lane, a soak, a fixture, a one-way door are; what K/B/T/C/Q/E/D/R ids mean and where they resolve; replace "T4-9" with the quoted checkbox text. Rewrite §0 "What changes permanently" as "What we recommend changing permanently, if you say yes to §11-5/8/9/12."
5. **Add a prompt-quality item and the two dropped wire facts.** Under R5 or the `llm` lane: a drift guard between `docs/auditor-prototype/prompts` and `module-prompts.js`; a fixture-based eval over the recorded shape-failure/repair cases; the data-block wrapper as one shared helper. Under §11-11: decide 30040's NKBIP-01 collision alongside 30041's. Fix the wrong facts: `local_primary_identity` in four files; eight raw preference readers; the caches are near-duplicates, not byte-identical; the wikipedia-like quote is LIBRARIAN_KICKOFF:23; "flip early" is a paraphrase.

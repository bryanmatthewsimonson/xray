# Doc-currency lens — fresh-eyes audit of X-Ray (2026-09-05)

**Lens:** doc-currency (continuous-improvement discipline, Protocol run over the whole tree; Standard 7 "doc-currency audit" as the invoking boundary — the maintainer's reset ask is the trigger).
**Tree:** `/home/user/xray` @ `c1e652c` (== origin/main). Build green, 2878/2878 tests.
**Method:** every number below was measured in this container (commands in the Evidence blocks); nothing was taken from CLAUDE.md, ROADMAP, or ROAD_TO_1_0 on trust — checking them is the audit.

---

## Verdict

X-Ray's documentation goes stale for one structural reason, not for lack of diligence: **every fact that changes on a merge is hand-copied into three to nine places, and not one of those copies is machine-checked.** The version lives in 4 places (README says v0.7.0 forty-seven days after 0.8.0 was tagged); the test count lives in 5 places with 3 different wrong values (2100 / ~2500 / 1018 against an actual 2878); the feature-flag list lives in 6 places (FLAGS_DEFAULTS 20, USER_GUIDE 16, options UI 16, SMOKE 12, CLAUDE.md 9, THREAT_MODEL 3); the wire-kind schedule is enumerated in 9 documents with 9 named constants and the rest bare literals; the Phase-16/19 smoke status is stated in 5 places and contradicts itself *inside a single file* (ROADMAP:1500 "smoke run pending" vs ROADMAP:241 "complete") — a month after JOURNAL 2026-08-02 recorded fixing exactly that. Meanwhile the only documents with guards are the ones that change least: the constitution's verbatim text and one generated HTML page. The project machine-enforces doctrine and hand-maintains facts, which is precisely backwards for currency.

The second cause is ceremony width. CONTRIBUTING, CLAUDE.md, and ROADMAP together prescribe a per-PR doc ritual six documents wide (JOURNAL entry, SMOKE row, CHANGELOG line, ROADMAP checkbox + progress bar + GitHub-issue mirror, CLAUDE.md recap, design-doc banner). Measured over the last 60 merge commits the actual compliance is: JOURNAL 27/60 (45%), SMOKE_TEST 33/60 (55%), **CHANGELOG 0/60**, ROADMAP 1/60, CLAUDE.md 7/60. Forty-three of 187 commits (23%) are docs-only, 23 of them `docs(smoke)` soak-walk records. The maintainer is paying for a doc process that costs a quarter of all commits and still leaves the front door (README, CHANGELOG `[Unreleased]` "Nothing yet." across 67 merges) wrong. That is the continuous-improvement failure mode by this skill's own definition — machinery measured in artifacts produced rather than pain removed.

Fresh eyes: the doc corpus (3.05 MB under `docs/`, 47,953 markdown lines, plus 210 KB of root markdown) is 75% of the size of the source it describes (4.35 MB, 93,243 LOC) and it ships inside the release zip. Most of it is genuinely good writing in the wrong container: the JOURNAL's entries are excellent but its 580 KB prepend-only single file hides the nine maintainer rulings that the governance-reconciliation questionnaire (PR #366) now has to reconstruct by archaeology; ROAD_TO_1_0 is a fine audit report being used as a tracker; the kickoffs are prompts for sessions that have already shipped. If I started today I would keep ~12 authored documents, generate 6 from code, archive ~35 under a banner (Art. 3, never delete), and fail CI on eight fact-drift guards. The per-PR ceremony that remains is three lines in the PR body plus a JOURNAL entry *only* when a root cause is non-obvious or a ruling was made.

---

## What is good (KEEP)

| Thing | Why it earns its place |
|---|---|
| `tests/constitution-guards.test.mjs` pinning verbatim doctrine text (CONSTITUTION, PHILOSOPHY, CASE_DOSSIER "No case-level score", TRUTH_ADJ, MORAL_LENS, CASE_SYNTHESIS, TRUTH_SYSTEMS, the CLAUDE.md pointer at :192-194) | This is the right *mechanism* — a red guard is "a bug or an unratified amendment." Whether the pinned *content* is the maintainer's intent is the governance lens's question (PR #366 Q/F ids), not a currency question. Keep the mechanism; the reconciliation decides the text. |
| `tools/gen-discipline-docs.mjs` + `tests/discipline-docs.test.mjs` (docs/discipline-standards.html is GENERATED and regen-guarded; JOURNAL 2026-08-04) | The only place in the repo where a document is derived from its source and CI fails when they diverge. This is the template for every generated doc proposed below. Its header comment even states its own honest limit ("cannot vouch for the sources"). |
| `tests/disciplines.test.mjs` — every "You are" prompt file must carry a `// Standards: <id> — docs/DISCIPLINES.md §n` header | A doc↔code link enforced at the point where an agent would forget it. |
| `npm run version:set` + the CI version-lockstep check | The one fact (package.json ↔ manifest.json) that is mechanized never drifts. Proof the approach works. |
| The JOURNAL's entry criteria (JOURNAL:7-18: non-obvious root cause, second-guessable decision, third-party change, recurring pattern) and its tag vocabulary | The content rule is exactly right. Every finding below about the JOURNAL is about the container, not the rule. |
| SMOKE_TEST's walk ledger principle (SMOKE:11-17: "walks performed, dated — not walks owed"; adopted 2026-08-11) | Distinguishes evidence from intention; it is why the ledger is the only trustworthy smoke record. |
| CONTRIBUTING's soak rule (2026-08-23, an actual maintainer ruling) and its exemption for docs-only PRs | It names the pain it relieves (five post-merge field defects). It is also the binding constraint on throughput — but that is the verification lens's problem, not a doc defect. |
| The "banner, never delete" habit (ENTITY_DOSSIER_DESIGN "PARTIALLY RETIRED 2026-07-20"; EPISTACK_SPRINT_KICKOFF "SUPERSEDED"; PORTAL_UX_REVIEW "Status annotations at filing") | Art. 3 applied to docs. The archive proposal below only makes it uniform and machine-readable. |
| `docs/USER_GUIDE.md` (63 KB, task-organized, glossary, troubleshooting, shot list) and `docs/CAPTURE_GUIDE.md` | These are the two documents a non-technical researcher actually needs. Keep; generate §2.5 from the flag registry. |
| CLAUDE.md lines 1-105 (commands, build model, the four execution contexts, the capture→publish handoff, the `xray:*` bus rule) | Genuinely excellent orientation; the best 100 lines of prose in the repo. The problem starts at :107 where it becomes a ROADMAP recap. |
| The fresh-clone `ERR_MODULE_NOT_FOUND` note (CLAUDE.md:24-26) | The model of a documented false alarm (CI-skill Standard 5). |
| `docs/THREAT_MODEL.md` exists and is bannered "living document" | Closes ROAD_TO_1_0 B18. |

---

## Grandfathered

Each: the thing — the past decision that grandfathered it — why the premise is gone.

1. **ROADMAP's frame** — "X-Ray — Migration Roadmap (v4.2 parity)" (ROADMAP:1), the phase↔GitHub-issue table (ROADMAP:16-30), the first `**Status:** complete. Commits 52ed35c…` line belonging to Phase 0 — grandfathered by issue #20's phase structure (2026-04). Premise gone: parity was reached at v0.5.x (ROADMAP:888); the doc is now 120 KB of history with a 50-line "now" section at Phase 29.
2. **Phase numbers as the product's public vocabulary** — README has 17 "Phase N" references, `src/portal/index.html` 5, `src/reader/index.html` 6, `src/options/options.html` 2 — grandfathered by the same issue-#20 structure. Premise gone: the yardstick is non-technical researchers who have never seen the roadmap (ROAD_TO_1_0 B9 counted one UI leak; there are 13).
3. **CHANGELOG updated only at release** (CONTRIBUTING:146-149; JOURNAL 2026-04-23 "Release pipeline") — an agent-authored convention from the week the pipeline was built. Premise: a tag every 1–3 weeks (0.2.0→0.5.1 in seven weeks). Gone: 47 days and 67 merges since 0.8.0 with `[Unreleased]` reading "Nothing yet." — and `release.yml` will publish that silence (B9).
4. **CLAUDE.md as ROADMAP recap** — lines 329-440 (~110 lines, ~40% of the file) restate every phase — accreted one sentence per phase closeout; never a maintainer ruling that "Claude needs the whole history in the system prompt". Premise gone: the recap is already wrong in four checkable places (see DOCC-8) and each closeout makes it longer.
5. **JOURNAL prepend-newest-first in one file** (JOURNAL:4 "Newer entries first") — a 2026-04 single-author, single-branch design. Premise gone: the maintainer explicitly wants "multiple threads at the same time"; every parallel PR that adds an entry edits the same top-of-file hunk.
6. **Kickoff docs as durable artifacts** (15 `*_KICKOFF.md`, 240 KB) — kickoffs were prompts for a *new session* (PORTAL_KICKOFF:3 "This is the prompt for a new…"). Premise gone once the session shipped; K13 ratified their archiving 2026-08-09 but was blocked on two that turned out to be the only spec (CASE_WORKSPACE_KICKOFF, CASE_BOUND_WORKSPACES_KICKOFF).
7. **SMOKE_TEST organized per phase** (49 sections, "Phase 0 … Phase 29 … R5 … AW … DC.1") — premise: a phase was the release unit and the walk ran once per tag. Gone: verification now happens per PR (23 `docs(smoke)` soak commits) and the per-section walk is documented as "a half-day" (SMOKE:5).
8. **Test counts as documented facts** (README:381, README:406, CLAUDE.md:21, SMOKE:242, verification-engineer SKILL.md:94,:156) — from the port era when the count was a progress signal against the userscript. Premise gone: nobody acts on the number; it exists only to drift (JOURNAL 2026-07-03 caught 937 vs 1018; now 2100/2500/1018 vs 2878).
9. **ROADMAP's "Keeping this doc current" ritual** (ROADMAP:2164-2170: flip checkbox, append hashes, move deferred, redraw progress bar, mirror to the GitHub phase issue + #20) — 2026-04 process. Gone: 1 of 60 merges touched ROADMAP; the GitHub-issue mirror has not been practiced in the visible history.
10. **The two-skill split of doc currency** (continuous-improvement S7 owns commands/flags/roadmap; verification-engineer owns counts/bundles/smoke) — designed in the 2026-08-04 skills wave by agents. Premise: two disciplines would each guard half. Gone: neither half graduated to a guard; the seam is where both halves rot.
11. **The EPISTACK cluster** (6 root docs + `docs/epistack/`, ~150 KB) — a competition entry with deadline 2026-07-19. Premise expired 2026-07-19; K13 ratified.
12. **`docs/superpowers/plans/2026-08-13-transcribe-anywhere.md`** (117 KB, the single largest non-JOURNAL doc) — a plugin's task-checklist implementation plan, referenced once from a test comment. Premise (the executing session) ended 2026-08-15.

---

## Garbage

Dead, duplicated, or actively misleading text, with location:

- `CHANGELOG.md:11-13` — `## [Unreleased]` / "Nothing yet." — false across 67 merges; it is the GitHub Release body.
- `README.md:19` "**v0.7.0** (tagged 2026-07-16)" — package.json:3 and manifest.json:4 say 0.8.0 (tagged 2026-07-20).
- `README.md:381` "node --test suite (2100 passing)" and `README.md:406-407` "**2100 tests** across 165 files" — actual 2878 tests, 225 files.
- `CLAUDE.md:21` "~2500 tests"; `CLAUDE.md:303` "eight of the nine skills here" (twelve skill directories exist); `CLAUDE.md:329` "Currently through Phase 28" (ROADMAP:2073 has Phase 29 with 29.1 shipped 2026-08-02, PR #279); `CLAUDE.md:431` "no section walk is outstanding" (SMOKE:46-55 lists LT.1–LT.14 as a whole unwalked section, plus K9, K15, NIP-46).
- `esbuild.config.mjs:3` "Produces seven bundles under dist/" — the build config's own header lies; ten entry points follow at :67-122. Docs copied "seven bundles" from here (K12 names it).
- `docs/SMOKE_TEST.md:242` "✅ 1018/1018 (or current-on-main count) passing" — a pass criterion that cannot fail; and `:117-236` the agent-runnable subset (K12 NOT STARTED: cites the 2026-04-21 MCP proof of concept, expects `content script v0.5.x` at :146, never mentions `tools/smoke/ma6-walk.mjs`, which actually runs headless end-to-end — BRIEFING addendum).
- `docs/ROADMAP.md:1500` "Phase 16 … ✅ shipped — smoke run pending" and `:1715` "§Phase 19 SMOKE walk pending (manual)" — contradicted by `ROADMAP:241-247` and `ROADMAP` snapshot "§Phase 16 smoke-run complete" in the same file, by CLAUDE.md:429-431, and by JOURNAL 2026-08-02 ("The Phase 16/19 walks were done; only the docs said otherwise") — the same defect, recurred, in the same document.
- `docs/ROADMAP.md:2164-2170` — the five-step manual update ritual nobody performs.
- `docs/TRUTH_ADJUDICATION_DESIGN.md:3` "**Status:** design draft (Phase 15)" — merged as PR #89; CLAUDE.md:151 and ROADMAP:1327 both say merged.
- `.claude/skills/verification-engineer/SKILL.md:94,:156` "~2500 tests" — a skill that owns test-count currency carries a stale count.
- `docs/LIBRARIAN_KICKOFF.md` — zero inbound references from any file; a "SEED" with no consumer.
- `docs/superpowers/plans/2026-08-13-transcribe-anywhere.md` — 117 KB of ticked/unticked checkboxes for a shipped wave.
- The EPISTACK cluster (K13).
- `package.json` `webExt.ignoreFiles` = `["companion","companion/**"]` only — so `docs/` (3 MB), `tests/` (2.5 MB), `tools/`, and `.claude/` ship inside the user-facing `.zip` (K13 noted "they ship inside the user-facing zip"; still true).

---

## Why docs go stale here — the causal chain (measured)

**1. Doc mass vs code mass.**

| Corpus | Files | Bytes | Lines |
|---|---|---|---|
| `src/**/*.js` | 247 | 4,345,534 | 93,243 |
| `tests/` | 225 | 2,541,927 | 51,955 |
| `docs/` (all) | 87 (58 top-level .md, 4 epistack, 24 auditor-prototype, 1 superpowers) | 3,050,222 | 47,953 (.md) |
| root `.md` (CHANGELOG 140 KB, CLAUDE 31 KB, README 24 KB, CONTRIBUTING 10 KB, SECURITY 4 KB) | 5 | 209,887 | — |

Docs are **0.75× the source bytes**; docs+tests are 1.3× the source. Eight files carry 60% of the doc mass: JOURNAL 580 KB, ROAD_TO_1_0 416 KB, SMOKE_TEST 178 KB, discipline-standards.html 146 KB (generated), CHANGELOG 140 KB, ROADMAP 120 KB, the superpowers plan 117 KB, NIP_DRAFT 108 KB.

**2. The per-PR ceremony, as prescribed vs as practiced.** Prescribed: CONTRIBUTING:14-28 (ROADMAP check + JOURNAL + SMOKE), CONTRIBUTING:146 (CHANGELOG at release), CLAUDE.md:437-440 (JOURNAL "tight entry"), ROADMAP:2164-2170 (five steps incl. GitHub-issue mirror), design-doc amendment banners (4 docs carry "the amendment governs"), CLAUDE.md's per-phase recap. Practiced, over the last 60 merge commits (`git diff --name-only m^1 m`):

| Doc | Merges touching it | Rate |
|---|---|---|
| docs/JOURNAL.md | 27 / 60 | 45% |
| docs/SMOKE_TEST.md | 33 / 60 | 55% |
| CHANGELOG.md | 0 / 60 | 0% |
| docs/ROADMAP.md | 1 / 60 | 2% |
| CLAUDE.md | 7 / 60 | 12% |

Docs-only commits: 43 of 187 (23%); `docs(smoke)` commits: 23; commits whose subject contains "soak walk": 10. Last visible touch: CHANGELOG and README 2026-08-08 (the history-reset root), ROADMAP 2026-08-15, USER_GUIDE 2026-08-15, CLAUDE.md 2026-08-28 (a storage.js sub-object fix — one of the few currency fixes, and it left the K14 stubs in place at storage.js:354-360, :408-412).

**3. How many places each fact lives** (the drift surface):

| Fact | Source of truth | Copies | Agree? |
|---|---|---|---|
| Version | package.json:3 / manifest.json:4 (locked by CI) | README:19, CLAUDE.md:330 (historical, fine), ROADMAP:225, EPISTACK_* | README wrong |
| Test count / file count | `node --test` (2878 / 225) | README:381, README:406, CLAUDE.md:21, SMOKE:242, verification-engineer SKILL:94,:156 | 5 copies, 3 distinct values, all wrong |
| Bundle list/count | esbuild.config.mjs:67-122 (10) | esbuild header :3 ("seven"), CLAUDE.md:44-52 (ten, correct), README:323 (ten, correct), verification-engineer SKILL:94 | the source's own comment wrong |
| Feature flags | FLAGS_DEFAULTS (feature-flags.js:31-228, 20 keys) | USER_GUIDE §2.5 (16), options/index.js (16), SMOKE (12), CLAUDE.md (9), THREAT_MODEL (3), README (1) | USER_GUIDE missing aiVision, directCloudTranscription, storeFirstPublish, extractionAnalysisPublishing; options UI missing trustGraphFilter, reviewCoordination, storeFirstPublish, extractionAnalysisPublishing |
| Wire kinds | 9 `KIND_*` constants (audit + truth families only); every other kind is a literal in its builder | CONSTITUTION (22 distinct), NIP_DRAFT (25), ROADMAP (25), CLAUDE.md (20), SMOKE (17), README (16), USER_GUIDE (12), KNOWLEDGE_SHARING (12), ecosystem-pm SKILL (9) | no registry to agree with (B16 open) |
| `npm run` commands | package.json scripts (8) | CLAUDE.md:17-24 (6 cited, all exist), README:401-407, CONTRIBUTING | currently agree — by luck; no guard |
| Phase 16/19 smoke status | SMOKE ledger | ROADMAP:1500, ROADMAP:1715, ROADMAP snapshot, ROADMAP:241-247, CLAUDE.md:429-431 | contradictory within ROADMAP |
| "Walks outstanding" | SMOKE:46-55 | ROADMAP:241-247 (qualifies LT), CLAUDE.md:431 ("none") | CLAUDE.md wrong |
| Skills roster | `.claude/skills/*` (12 dirs; 8 with `## Standards`) | gen-discipline-docs.mjs:36-39 `IDS` (8, hardcoded), CLAUDE.md:303 ("eight of the nine"), skills README table (11 rows) | CLAUDE.md wrong; 3 skills invisible to the generator |

**4. What is guarded.** `grep readFile tests/*.mjs` over docs: constitution-guards (7 docs + CLAUDE.md pointer), disciplines.test (DISCIPLINES.md + prompt headers), discipline-docs (the generated HTML), lens-guards (two HTML shells). **Zero guards touch any row of the table above.** The CI skill's own Standard 7 promised two graduations ("every `npm run <x>` cited in CLAUDE.md exists in package.json; every FLAGS_DEFAULTS flag appears in SMOKE_TEST or an exemption list") — neither exists, and the flags one would fail today (8 of 20 flags absent from SMOKE). B11's two promised guards (FLAGS_DEFAULTS ⇔ guide table; every flag read by isEnabled or in RETIRED_FLAGS) — not built. B9's CI check (`[Unreleased]` non-empty when HEAD is ahead of the newest tag) — not built.

**5. Five whys, compressed.** Docs drift *because* facts are copied by hand; they are copied by hand *because* no registry exists for flags/kinds/bundles that a generator could read (FLAGS_DEFAULTS is the one exception and even it has no generator); no generator exists *because* the ceremony was written as prose obligations ("update ROADMAP", "add a JOURNAL entry") rather than as guards; the obligations were written as prose *because* each was added by an agent in the PR that first felt the pain, in the voice of that PR, and no later PR owned turning it into structure (CI-skill Standard 3: "a fix that requires remembering is not a fix"); and nobody went back *because* the only maintainer-facing signal is the soak walk, which observes the product, not the docs. The recurrence proof: JOURNAL 2026-07-03 (937 vs 1018 tests; NIP_DRAFT two kinds short), 2026-07-09 (kind 32125 undocumented for months), 2026-08-02 (Phase 16/19 walks "pending" for weeks), 2026-08-04 (the discipline page generated *because* of 08-02), 2026-08-28 (storage.js sub-object list) — five dated occurrences of the same pain class; Standard 2 demanded a structural fix at the second.

---

## Classification of the doc corpus

Legend: **U** for-users · **N** how-it-decides (normative) · **D** how-it-was-built (design + kickoff) · **P** process · **X** dead/expired/misplaced. Inbound-reference counts are from `grep -rl <basename>` across md/js/mjs/html/json excluding the file itself.

| File | Class | Disposition | Note |
|---|---|---|---|
| README.md | U | authored; Status/Layout blocks GENERATED | v0.7.0; "2100"; 17 phase refs |
| CHANGELOG.md | U | GENERATED `[Unreleased]` from merged PR titles; hand-polished at tag | "Nothing yet." |
| CONTRIBUTING.md | P | authored, ≤150 lines | carries the soak rule (keep) and the CHANGELOG-at-release rule (retire) |
| CLAUDE.md | P | authored ≤200 lines + GENERATED blocks | the ROADMAP recap goes |
| SECURITY.md | U | keep | |
| docs/USER_GUIDE.md | U | keep; §2.5 GENERATED | 4 flags missing |
| docs/CAPTURE_GUIDE.md | U | keep | |
| docs/CONSTITUTION.md | N | keep (guard-pinned) | content questions → PR #366 |
| docs/PHILOSOPHY.md | N | keep (guard-pinned) | |
| docs/DISCIPLINES.md | N | keep (guard-read) | 19 `##` sections |
| docs/TRUTH_SYSTEMS.md | N | keep (annex, guard-read) | |
| docs/THREAT_MODEL.md | N | keep, living | |
| docs/NIP_DRAFT.md | N (wire) | keep prose; kinds table GENERATED from a registry | 52 inbound refs — the most-cited doc |
| docs/CASE_DOSSIER_DESIGN.md | N | keep (guard-pinned "No case-level score") | provenance question F-id in #366 |
| docs/TRUTH_ADJUDICATION_DESIGN.md | N | keep (guard-read) | status line stale |
| docs/MORAL_LENS_JURISDICTION_DESIGN.md | N | keep (guard-read) | |
| docs/CASE_SYNTHESIS_DESIGN.md | N | keep (guard-read) | |
| docs/ASSESSMENTS_DESIGN.md, CLAIMS_REDESIGN.md, COMPLEX_CONTENT_DESIGN.md, CRIMINOLOGY_DESIGN.md, ENTITY_CORPUS_DESIGN.md, ENTITY_DOSSIER_DESIGN.md, ENTITY_IDENTITY_DESIGN.md, EPISTEMIC_AUDIT_DESIGN.md, EVENT_STORE_DESIGN.md, HYPOTHESIS_MAP_DESIGN.md, COUNTERFACTUAL_DESIGN.md, KNOWLEDGE_SHARING_DESIGN.md, NETWORK_CLIENT_DESIGN.md, PORTAL_DESIGN.md, TEAM_CASE_DESIGN.md, MARGIN_DESIGN.md | D | keep under `docs/design/` with a machine-readable status header | 16 design docs; PORTAL_DESIGN is contradicted by the shipped portal (PORTAL_UX_REVIEW:8 "specifies a read-only five-surface viewer; src/portal today is 43 modules") |
| docs/CASE_WORKSPACE_KICKOFF.md, CASE_BOUND_WORKSPACES_KICKOFF.md | D (normative by accident) | promote content into `design/CASE_WORKSPACE_DESIGN.md`; archive the kickoffs | K13's correction — cited by 9 src files + 3 tests |
| docs/NIP07_IDENTITY_KICKOFF.md | D (live decision) | keep until PR #324 decided, then archive | |
| docs/LIBRARIAN_KICKOFF.md | D (seed) | archive or promote — 0 inbound refs | |
| docs/CORPUS_AUDIT_KICKOFF, DIRECT_CLOUD_TRANSCRIBE_KICKOFF, ENTITY_PAGE_KICKOFF, EPISTEMIC_AUDIT_KICKOFF, MAP_ARTIFACT_KICKOFF, OPINION_MODULES_KICKOFF, PHASE_14_5_LLM_ASSIST_KICKOFF, PHASE_15_KICKOFF, PORTAL_KICKOFF, TRANSCRIBE_ANYWHERE_KICKOFF, UNIFIED_ARTICLE_PASS_KICKOFF | D (shipped) | ARCHIVE with banner; lift any surviving spec paragraphs into the sibling design doc first | 11 files, ~180 KB |
| docs/JOURNAL.md | P | split per quarter + generated index + rulings extract | 580 KB, 243 entries |
| docs/SMOKE_TEST.md | P | split: sections (authored) / ledger (append) / agent scripts (tools/smoke) | 178 KB |
| docs/ROADMAP.md | P | shrink to now/next; history → archive | 120 KB |
| docs/ROAD_TO_1_0.md | P | ARCHIVE; open items → one tracker | 416 KB |
| docs/PORTAL_UX_REVIEW.md, MARGIN_UX_REVIEW.md | P (review reports) | archive once actioned (PORTAL already self-annotates) | |
| docs/discipline-standards.html | P (GENERATED) | keep; derive roster from directory scan | |
| docs/FOUNDING_TRANSCRIPT.md | X (source, non-normative) | archive (banner already says non-normative) | |
| docs/TRUTH_INFRASTRUCTURE.md, BONDING_NOTES.md | X (parked) | archive/ideas | |
| docs/EPISTACK_ENTRY, _RUNBOOK, _SPRINT_KICKOFF, _EGGS_CORPUS, _EGGS_WORKSHEET, _LHC_CORPUS + docs/epistack/* | X | ARCHIVE (K13 ratified); lift RUNBOOK §5/§7 first per K13 note | ~150 KB |
| docs/superpowers/plans/2026-08-13-transcribe-anywhere.md | X | ARCHIVE | 117 KB |
| docs/auditor-prototype/** (24 files incl. scorer.js, audit-types.ts, 13 prompts) | X (misplaced code) | move to `tools/auditor-prototype/` — cited by src/shared/audit/{article-hash,findings-schemas,module-prompts,audit-prompt}.js headers and options.html (K8) | it is code, not a doc |

---

## Findings (ranked by harm to wide release)

### DOCC-1 — The release front door is false: CHANGELOG `[Unreleased]` says "Nothing yet." across 67 merges, and the release workflow will publish it
- **Harm:** 5 · **Class:** GARBAGE · **Effort:** S (fix) / M (generator + CI check)
- **Evidence:** `CHANGELOG.md:11-13`; `git log --merges | wc -l` = 67 since the visible root (2026-08-08), all after the `[0.8.0] — 2026-07-20` section at `:15`; CONTRIBUTING:146-149 (release body is pulled verbatim); `git log -- CHANGELOG.md` last touch = the history-reset root commit. Merges touching CHANGELOG in the last 60: **0**.
- **Claim:** The at-release-only rule (JOURNAL 2026-04-23) assumed frequent tags; with a 47-day gap the reconstruction cost is now ~60 PRs of archaeology and the Release page a non-technical user meets first will be blank or wrong.
- **Fresh-eyes action:** Generate `[Unreleased]` from merged-PR titles (`git log --merges --format=%s vX..HEAD` — the repo already uses `feat:/fix:/docs:` prefixes, so bucketing into Added/Fixed/Changed is mechanical); hand-polish only at tag time. CI: fail when HEAD is ahead of the newest `v*` tag and the section is empty. Docs-only PRs stay exempt from everything else.
- **ROAD_TO_1_0:** B9 — OPEN (unchanged since 2026-08-09).

### DOCC-2 — The consent map is incomplete: the user-facing flag table omits 4 of 20 flags, 2 flags exist only via DevTools, and no guard ties either to FLAGS_DEFAULTS
- **Harm:** 5 · **Class:** DEFECT (partially fixed B11) · **Effort:** M
- **Evidence:** `src/shared/metadata/feature-flags.js:31-228` (20 keys). `docs/USER_GUIDE.md:176-193` table rows: 16 — missing `aiVision`, `directCloudTranscription`, `storeFirstPublish`, `extractionAnalysisPublishing`. `src/options/index.js` + `options.html`: 0 hits for `trustGraphFilter`, `reviewCoordination`, `storeFirstPublish`, `extractionAnalysisPublishing` — so the kind-30070 *publish gate* and the store-first publish path are reachable only by hand-editing `xray:flags` in DevTools. SMOKE_TEST names 12/20; THREAT_MODEL 3/20. No test reads USER_GUIDE.
- **Claim:** The 2026-08-09 retirement of the eight dead flags (bd0396d) and the 2026-08-15 table additions did the human half of B11; the machine half (two guards) was never built, so the table is drifting again 3 weeks later. `extractionAnalysisPublishing` gates a *wire* action (kind 30070, whole-unit disclosure including every review state) and is invisible in both the guide and Settings — that is the "consent defect rather than a typo" B11 named, still live.
- **Fresh-eyes action:** Add per-flag metadata beside FLAGS_DEFAULTS (`label`, `surface: settings|devtools|hidden`, `leavesMachine: bool`, `gatesKinds: []`, `since`, `checkDate`) — one registry; generate USER_GUIDE §2.5 and the Settings → Advanced flag section from it; guard: registry key set == FLAGS_DEFAULTS key set == generated table rows; every `isEnabled('x')` in src names a registry key.
- **ROAD_TO_1_0:** B11 — HALF (dead flags gone; guards absent); B10 — OPEN for `storeFirstPublish`, `extractionAnalysisPublishing`.

### DOCC-3 — The wire-kind schedule has no single source: 9 named constants, ~15 bare literals, and 9 documents that each enumerate a different subset
- **Harm:** 4 · **Class:** DEFECT · **Effort:** M
- **Evidence:** `grep -rho 'KIND_[A-Z_]+ = [0-9]+' src | sort -u` → 9 (audit `30056–30061`, `30065`, truth `30063/30064`); `30023, 30040, 30041, 30054, 30055, 30062, 30068, 30069, 30070, 32125, 32126, 10002, 30078, 0, 1, 3, 1985` appear as literals in their builders. Distinct kinds enumerated: CONSTITUTION 22, NIP_DRAFT 25, ROADMAP 25, CLAUDE.md 20, SMOKE 17, README 16, USER_GUIDE 12, KNOWLEDGE_SHARING 12, ecosystem-pm SKILL 9. JOURNAL 2026-07-09: 32125 "shipped undocumented for months"; 2026-07-03: NIP_DRAFT "two kinds short".
- **Claim:** Every new kind (30068, 30069, 30070 in the last 8 weeks) had to be hand-added to up to nine documents; the ecosystem-pm skill's mandate ("keep NIP_DRAFT complete enough to implement a second client from") has no mechanical check, and 1.0 "makes every number permanent" (B16).
- **Fresh-eyes action:** `src/shared/kinds.js` — one exported registry `{ kind, name, status: live|reserved|retired|free, family, builder, docRef }` including the retired/reserved entries (30043, 30050–30053, 30065, 30066, 30067, 9803). Builders import from it (no behavior change). Generate `docs/wire/KINDS.md`; guard: every `kind:` literal emitted in `src/**/*publish*.js|*builder*.js` is in the registry with status `live`; registry `live+reserved` set ⊆ CONSTITUTION Art. 10 table and NIP_DRAFT's table (text-level check, like constitution-guards does today).
- **ROAD_TO_1_0:** B16 — OPEN.

### DOCC-4 — README misstates version, test count, and speaks in phase numbers a researcher has never seen
- **Harm:** 4 · **Class:** GARBAGE (facts) / GRANDFATHERED (frame) · **Effort:** S
- **Evidence:** `README.md:19` v0.7.0; `:381` "(2100 passing)"; `:406-407` "2100 tests across 165 files"; 17 "Phase N" references (`grep -o 'Phase [0-9]+' README.md | wc -l`); `git log -- README.md` last touch = history root. Actual: 0.8.0 / 2878 tests / 225 files.
- **Claim:** README's Status section is a ROADMAP recap for a reader who does not know what a Phase is; every number in it is wrong today, and it has been wrong since at least 2026-07-20.
- **Fresh-eyes action:** Rewrite Status/Features around user jobs (capture → structure → judge → publish → work a case → work with others — B9's own prescription); the version line becomes a generated badge or a `<!-- gen:version -->` block filled from package.json; delete counts; move the Layout tree to CLAUDE.md (one home). Guard: `\b\d{3,4}\b\s+(tests|passing)` forbidden in any `.md`/`SKILL.md`; `v0\.\d\.\d` outside CHANGELOG headings must equal package.json.
- **ROAD_TO_1_0:** B9 — OPEN. Phase leaks in UI: `src/portal/index.html` 5, `src/reader/index.html` 6, `src/options/options.html` 2 (B9 counted one).

### DOCC-5 — Zero guards exist over any per-merge fact; the only guarded docs are doctrine and one generated page
- **Harm:** 4 · **Class:** GAP · **Effort:** M
- **Evidence:** `grep -n readFile tests/*.mjs` over docs → constitution-guards.test.mjs:33-34,158-160,192,287,298; disciplines.test.mjs:24; discipline-docs.test.mjs. No test reads README, CHANGELOG, USER_GUIDE, SMOKE_TEST, ROADMAP, package.json-vs-CLAUDE.md, esbuild-vs-CLAUDE.md, or FLAGS_DEFAULTS-vs-anything. CI-skill SKILL.md:145-148 promises two graduated guards; `ls tests | grep -i curren` → none. B9/B11's promised guards → none. `scripts/release-preflight.mjs` (skills README:85) → "to-be-built"; `ls scripts/` = build-icons, set-version.
- **Claim:** The repo has proven the generator+guard pattern works (discipline-docs, version lockstep) and then applied it only to the slowest-changing text. By this skill's Standard 3 every prose obligation in CONTRIBUTING/CLAUDE.md is "a fix that requires remembering".
- **Fresh-eyes action:** One `tests/doc-currency.test.mjs` owning the eight guards listed under *Fresh-start design → Currency guard set*, each with its Standard-1 citation in the header (the dated JOURNAL entries above). Retire the S7 two-skill split: one guard file, one owner.
- **ROAD_TO_1_0:** B8 (release gate) — OPEN; T4 1/10.

### DOCC-6 — The Phase-16/19 "smoke pending" defect recurred in the same file a month after the JOURNAL recorded fixing it
- **Harm:** 3 · **Class:** GARBAGE (recurrence, Standard 2) · **Effort:** S
- **Evidence:** ROADMAP:1500 "✅ shipped — smoke run pending"; ROADMAP:1715 "§Phase 19 SMOKE walk pending (manual)"; ROADMAP snapshot "§Phase 16 smoke-run complete"; ROADMAP:241-247 "The Phase 16 and 19 section walks are also complete (maintainer, 2026-08-02 correction — … this file carried 'pending' long after the fact)"; JOURNAL:2270 "2026-08-02 — The Phase 16/19 walks were done; only the docs said otherwise"; CLAUDE.md:429-431.
- **Claim:** The fix edited the prose paragraph but not the two headings; the same file now says both. Status that lives in prose headings cannot be kept current; only the ledger row can.
- **Fresh-eyes action:** Delete every status adjective from ROADMAP headings; the walk ledger is the sole source of "walked"; guard: the strings `smoke run pending`, `walk pending`, `not yet walked` may appear only in `docs/verification/WALK_LEDGER.md`.
- **ROAD_TO_1_0:** not listed (post-dates the audit's fix). Recurrence of JOURNAL 2026-08-02.

### DOCC-7 — The prescribed ceremony is six documents wide, unenforced, and measured compliance is 0–55% — the process itself guarantees drift and costs 23% of commits
- **Harm:** 4 (maintainer attention — the binding constraint) · **Class:** GRANDFATHERED · **Effort:** M
- **Evidence:** the merge-touch table above (JOURNAL 27/60, SMOKE 33/60, CHANGELOG 0/60, ROADMAP 1/60, CLAUDE.md 7/60); 43/187 docs-only commits; 23 `docs(smoke)` commits; CONTRIBUTING:14-28, :146; ROADMAP:2164-2170; CLAUDE.md:437-440.
- **Claim:** A ceremony that is followed half the time produces a record that is wrong half the time — worse than no record, because readers trust it. The soak-walk commits are the one part of the ceremony that carries evidence (a dated PASS/FAIL observed by the maintainer); the rest is transcription.
- **Fresh-eyes action:** The per-PR ceremony that remains (see *Fresh-start design*): three lines in the PR body (Verification layer · Wire format · Docs touched: none/which), a JOURNAL entry only under the existing three triggers, a ledger row appended by `hand-to-maintainer` when the maintainer reports. Everything else is generated at merge or at tag.
- **ROAD_TO_1_0:** consolidation lens §appendix; B8/T4.

### DOCC-8 — CLAUDE.md, the file every agent session reads first, is 31 KB, 40% ROADMAP recap, and wrong in four checkable claims
- **Harm:** 4 (it is the agent's system prompt; wrong facts here propagate into every PR) · **Class:** GRANDFATHERED (recap) / GARBAGE (facts) · **Effort:** M
- **Evidence:** `wc -c CLAUDE.md` 30,764; lines 329-440 recap Phases 10–28; `:21` "~2500 tests"; `:303` "eight of the nine skills" (12 dirs; `ls .claude/skills`); `:329` "Currently through Phase 28" vs ROADMAP:2073-2099 Phase 29.1 shipped PR #279; `:431` "no section walk is outstanding" vs SMOKE:46-55. Post-0.8.0 features absent from CLAUDE.md entirely: `storeFirstPublish`/publish-gate, the event journal DB, the diagnostics ring (`xray:diag`, 3 src hits), aiVision, MARGIN, the three newer skills. Last currency fix 2026-08-28 (5b8b9b6) touched one list.
- **Claim:** CLAUDE.md is being used as a second ROADMAP; two roadmaps drift twice as fast. Its first 105 lines are the best orientation in the repo and should survive; the rest should be pointers and generated blocks.
- **Fresh-eyes action:** Cap at ~200 lines: commands (generated from package.json), build model (generated from esbuild entryPoints), the four contexts, conventions, "read these docs" as a *generated index* with one line each, and NO phase history. Guard: `npm run <x>` cited exists; bundle list == entryPoints; no test counts.
- **ROAD_TO_1_0:** consolidation lens; not a numbered blocker.

### DOCC-9 — The JOURNAL is 580 KB, prepend-only, unindexed, and hides the maintainer rulings that governance reconciliation now has to excavate
- **Harm:** 4 (this is the mechanism behind "imperfect interpretation of governance that has been too annoying to fix") · **Class:** GRANDFATHERED (container) / KEEP (content rule) · **Effort:** M
- **Evidence:** 243 `##` entries (Apr 33, Jun 38, Jul 111, Aug 61), avg 2.4 KB, longest 7.6 KB; tags: design 124, bug 54, pattern 26, external 19, wire-format 5, security 5; JOURNAL:4 "Newer entries first"; no index/TOC (`grep -i 'table of contents\|index' JOURNAL.md` → 0); 9 headings mention ruling/decision/descope/retire/amend; the governance lineage (2026-07-03 descope → 2026-07-21 clarification → 2026-08-02 Art. 5 → 2026-08-28 "reconciliation") is recoverable only by reading ~600 KB. PR #366 grades provenance E1–E5 precisely because no rulings register exists.
- **Claim:** The JOURNAL does its Standard-1 job (friction leaves a trace) and fails its Standard-2 job (recurrence must be *recognizable* — a 580 KB grep is not recognition). Prepend-at-top makes every parallel branch conflict on the same hunk, which directly opposes the maintainer's multi-thread goal.
- **Fresh-eyes action:** (a) split by quarter: `docs/journal/2026-Q2.md` (Apr–Jun, 71 entries), `2026-Q3.md` (Jul–Sep, 172) — append at *bottom* from now on; (b) `docs/JOURNAL.md` becomes a GENERATED index (date · title · tags · file#anchor) with a regen guard like discipline-docs; (c) extract every entry tagged as a maintainer ruling into `docs/decisions/R-NNN-<slug>.md` (id, date, who ruled, verbatim quote, what it supersedes, guard that pins it) — the register PR #366's F1–F13 need; (d) the CONTRIBUTING rule "accepted recommendations are recorded in JOURNAL with date and rationale" moves to the decisions register.
- **ROAD_TO_1_0:** not listed as a blocker; consolidation lens noted size.

### DOCC-10 — ROAD_TO_1_0 (416 KB) is an audit report being used as a tracker; 76% is appendix and the tracked items are stale a month later
- **Harm:** 3 · **Class:** GRANDFATHERED (as tracker) / KEEP (as evidence) · **Effort:** S
- **Evidence:** 6,681 lines; plan through `:1574`, per-lens appendix `:1575-6681` (5,107 lines); `:3` "hand-maintained"; inline status annotations ("NOT STARTED", "BLOCKED") at `:1295`, `:1310`; BRIEFING: T3 1/8, T4 1/10, T5–T8 ≈ 0; B18 closed (THREAT_MODEL exists) but the section still says "does not exist".
- **Claim:** Once this reset plan exists, ROAD_TO_1_0's 19 blockers and 15 kills are rows in a tracker, its verdict is superseded, and its appendix is archival evidence. Keeping it "hand-maintained" means a second document nobody updates.
- **Fresh-eyes action:** Move to `docs/archive/2026-08-09-ROAD_TO_1_0.md` with the standard banner ("superseded by RESET_PLAN 2026-09-05; ids B/T/K remain citable"); carry every open B/T/K id into one tracker (`docs/plan/TRACKER.md`, one row per id: status, owning PR, check date) — or GitHub issues, if the maintainer prefers a UI. The reset plan cites ids, never restates.
- **ROAD_TO_1_0:** self-referential; K12/K13 status noted above.

### DOCC-11 — SMOKE_TEST is 178 KB / 49 phase-sections with an unfailable pass criterion and an agent-subset that understates real automation by an order of magnitude
- **Harm:** 3 · **Class:** GRANDFATHERED (structure) / GARBAGE (K12 blocks) · **Effort:** M
- **Evidence:** `:5` "a full pass through the Phase 11–16 sections is a half-day"; `:242` "1018/1018 (or current-on-main count)"; `:117-236` agent subset (2026-04-21 MCP PoC; `:146` expects `content script v0.5.x`; never names `tools/smoke/ma6-walk.mjs`, which the BRIEFING addendum ran headless end-to-end here); ledger `:11-44` exists only since 2026-08-11; `:46-55` LT.1–LT.14 whole section unwalked; 12/20 flags named. ROAD_TO_1_0 K12 NOT STARTED.
- **Claim:** The doc conflates three things with different currencies: the *sections* (what to check — slow-changing), the *ledger* (what was observed — append-only evidence), and the *agent path* (what a script can do — code). Mixed together, the first rots the third and the second is buried.
- **Fresh-eyes action:** Split: `docs/verification/SMOKE_TEST.md` (sections, organized by *surface* not phase, each row tagged `unit|guard|agent|walk` per verification-engineer Standard 5), `docs/verification/WALK_LEDGER.md` (append-at-bottom; `hand-to-maintainer` writes it), `tools/smoke/*.mjs` with a `tools/smoke/README.md` generated from the scripts' headers. Guard: every section row tagged `agent` names an existing script. (The verification lens owns which rows exist; this lens owns that the doc cannot lie.)
- **ROAD_TO_1_0:** K12 — NOT STARTED; T4.

### DOCC-12 — Design-doc status lines are write-once prose, so no index of "what governs today" can be built
- **Harm:** 2 · **Class:** DEFECT · **Effort:** S
- **Evidence:** TRUTH_ADJUDICATION_DESIGN:3 "design draft (Phase 15)" (merged PR #89); ROADMAP:1-3 title "Migration Roadmap (v4.2 parity)" with Phase 0's "Status: complete" as the file's first status line; PORTAL_DESIGN "agreed 2026-06-10" while PORTAL_UX_REVIEW:8 says the shipped portal contradicts it; 14 of 58 docs have no `**Status` line at all (CAPTURE_GUIDE, CASE_DOSSIER, CASE_SYNTHESIS, COUNTERFACTUAL, ENTITY_IDENTITY, EVENT_STORE, HYPOTHESIS_MAP, JOURNAL, KNOWLEDGE_SHARING, MARGIN_*, MORAL_LENS (uses a blockquote), NETWORK_CLIENT, NIP_DRAFT, SMOKE_TEST, TEAM_CASE, USER_GUIDE, all EPISTACK); the four "the amendment governs" banners are free text.
- **Claim:** The habit is right (KEEP) and the format is unparseable, so nothing can list "normative docs", "docs whose design was contradicted by shipping", or "docs older than their code".
- **Fresh-eyes action:** Three-line front matter on every doc: `class: user|normative|design|process|archive`, `status: draft|agreed|shipped|amended|retired|superseded`, `date:`; `docs/README.md` GENERATED from it (regen guard). One-time pass sets the values; thereafter a status flip is a one-field edit at phase closeout.
- **ROAD_TO_1_0:** consolidation lens.

### DOCC-13 — Expired and misplaced material sits in the live tree and ships in the release zip
- **Harm:** 3 (zip bloat + a researcher opening `docs/` meets a competition entry first) · **Class:** GARBAGE / GRANDFATHERED · **Effort:** S
- **Evidence:** 6 `EPISTACK_*` + `docs/epistack/` (K13 ratified 2026-08-09, blocked on two mis-classified kickoffs); `docs/superpowers/plans/…` 117 KB (1 inbound ref, a test comment); `LIBRARIAN_KICKOFF` 0 inbound; `FOUNDING_TRANSCRIPT`, `TRUTH_INFRASTRUCTURE`, `BONDING_NOTES` self-described parked/non-normative; `package.json` `webExt.ignoreFiles` = companion only → `docs/` 3.05 MB + `tests/` 2.5 MB + `.claude/` + `tools/` in the `.zip`.
- **Claim:** Art. 3 says never delete; it does not say never move. An `archive/` directory with a uniform banner satisfies both, and one `ignoreFiles` line keeps 5.5 MB out of the artifact a non-technical user downloads.
- **Fresh-eyes action:** `docs/archive/<YYYY-MM-DD>-<name>.md` with banner `> ARCHIVED <date>: <why>; superseded by <link>; kept per CONSTITUTION Art. 3.`; `webExt.ignoreFiles += ["docs/**","tests/**","tools/**",".claude/**","*.md"]`; guard: every file under `docs/archive/` starts with the banner.
- **ROAD_TO_1_0:** K13 — BLOCKED (unblock by promoting the two kickoffs to a design doc first); B7 (installable artifact).

### DOCC-14 — `esbuild.config.mjs`'s own header says "seven bundles"; docs copied the lie from the source of truth
- **Harm:** 2 · **Class:** GARBAGE · **Effort:** S
- **Evidence:** `esbuild.config.mjs:3-11` lists 7; `:67-122` defines 10 (content, background, options, sidepanel, reader, portal, network, api-interceptor, pdf-engine, pdf.worker). K12 cites "seven bundles" as a SMOKE hardcode.
- **Claim:** When the source of truth carries a prose duplicate of itself, it drifts too. The list belongs in one exported table that the config, CLAUDE.md, and README all read.
- **Fresh-eyes action:** Export `BUNDLES` from the config (name, entry, format, world); delete the header list; generate CLAUDE.md's bundle block; guard it.
- **ROAD_TO_1_0:** K12 (adjacent).

### DOCC-15 — The discipline generator's roster is hardcoded to 8 while 12 skills exist; 3 skills have no `## Standards` and are invisible to both the page and `disciplines.test`
- **Harm:** 2 · **Class:** DEFECT · **Effort:** S
- **Evidence:** `tools/gen-discipline-docs.mjs:36-39` `IDS` (8); comment at `:48-50` claims "a content test, not a denylist" but IDS is a literal; `.claude/skills/{ux-designer,seam-and-invariant-check,hand-to-maintainer}/SKILL.md` → `grep -c '^## Standards'` = 0 each; CLAUDE.md:303 "eight of the nine"; skills README table has 11 rows.
- **Claim:** The one generated doc in the repo has a hand-maintained roster, so it too will drift the next time a skill is added.
- **Fresh-eyes action:** Derive IDS from `readdirSync('.claude/skills')` filtered by the Standards-section content test the comment already describes; either give the three skills a Standards section or render them under a "checklists" heading; CLAUDE.md's skill sentence becomes generated.
- **ROAD_TO_1_0:** none.

### DOCC-16 — `docs/auditor-prototype/` is code (scorer.js, audit-types.ts, 13 prompt files, package.json) living under docs and cited by shipped src
- **Harm:** 2 · **Class:** GRANDFATHERED (misplaced) · **Effort:** S
- **Evidence:** 24 files; `src/shared/audit/{article-hash,findings-schemas,module-prompts,audit-prompt}.js` and `src/options/options.html` reference it (K8 kills the Options instruction).
- **Claim:** A prototype that src depends on for provenance is tooling; under `docs/` it is counted as documentation, shipped in the zip, and never linted.
- **Fresh-eyes action:** `git mv docs/auditor-prototype tools/auditor-prototype`; update the five references; banner its README as the Phase-13 origin.
- **ROAD_TO_1_0:** K8 — NOT STARTED (the Options instruction); the move is new.

### DOCC-17 — Phase numbers leak into shipped UI in 13 places, not one
- **Harm:** 2 · **Class:** GRANDFATHERED · **Effort:** S
- **Evidence:** `grep -o 'Phase [0-9]+'`: `src/portal/index.html` 5, `src/reader/index.html` 6, `src/options/options.html` 2; README 17.
- **Claim:** B9's fix names `options.html:204` as "the one phase leak"; the count is thirteen in HTML alone. Internal vocabulary in the product is a doc-currency defect at the surface a researcher sees.
- **Fresh-eyes action:** Strip; guard: `Phase \d+` forbidden in `src/**/*.html` and in user-class docs (README, USER_GUIDE, CAPTURE_GUIDE).
- **ROAD_TO_1_0:** B9 (partial), B13.

### DOCC-18 — ROADMAP prescribes a five-step manual ritual including a GitHub-issue mirror that no visible commit has performed
- **Harm:** 2 · **Class:** GARBAGE · **Effort:** S
- **Evidence:** ROADMAP:2164-2170; ROADMAP touched in 1/60 merges; the phase-issue table at :16-30 references #11–#20.
- **Claim:** An obligation with 2% compliance is a false promise to the reader that the doc is current.
- **Fresh-eyes action:** Delete the ritual; ROADMAP shrinks to "Now / Next / Parked" (≤200 lines) edited at wave boundaries only; phase history → `docs/archive/ROADMAP-phases-0-28.md`.
- **ROAD_TO_1_0:** none.

### DOCC-19 — Doc-currency ownership is split across two skills with no guard on either half
- **Harm:** 2 · **Class:** GRANDFATHERED · **Effort:** S
- **Evidence:** continuous-improvement SKILL.md:130-148 (S7: commands/flags/roadmap) vs verification-engineer (counts/bundles/smoke); neither graduated; the CI skill's own Standard 1 says a check with no cited pain is theater — here the pain is cited five times (2026-07-03, 07-09, 08-02, 08-04, 08-28) and the check still does not exist.
- **Claim:** A seam between two advisory skills is where a mechanical task goes to die; a guard file has one owner.
- **Fresh-eyes action:** One `tests/doc-currency.test.mjs`; the S7 text in both skills points to it; ownership by whichever skill the maintainer prefers (default: continuous-improvement, since it is the one that runs at boundaries).
- **ROAD_TO_1_0:** none.

### DOCC-20 — There is no docs index; 58 top-level docs are discoverable only through CLAUDE.md prose, and five have ≤1 inbound reference
- **Harm:** 2 · **Class:** GAP · **Effort:** S (once DOCC-12's front matter exists)
- **Evidence:** no `docs/README.md`; inbound counts: LIBRARIAN_KICKOFF 0; EPISTACK_LHC_CORPUS, EPISTACK_SPRINT_KICKOFF, MARGIN_DESIGN, MARGIN_UX_REVIEW 1 each; CASE_WORKSPACE_KICKOFF, NIP07_IDENTITY_KICKOFF 2.
- **Claim:** A newcomer (or a fresh agent session) cannot answer "which document governs X today" without reading CLAUDE.md's 440 lines, which are themselves stale.
- **Fresh-eyes action:** `docs/README.md` GENERATED from front matter (class · status · date · one-line purpose · inbound-ref count), regen-guarded.
- **ROAD_TO_1_0:** B13 (first hour) adjacent.

---

## Fresh-start design — the doc system for a clean repo

**Principle:** a fact lives in exactly one authored place or in code; everything else is generated, archived, or absent. Prose documents carry *judgment* (why, tradeoffs, rulings); code carries *facts* (what exists); generators join them; guards fail CI on divergence. Art. 3: nothing is deleted — archived with a banner, git-recoverable.

### Target tree (file by file)

```
README.md                         authored (≤250 lines, user-job framing); <!-- gen:version --> and
                                  <!-- gen:install --> blocks filled by tools/gen-docs.mjs
CHANGELOG.md                      [Unreleased] GENERATED from merged-PR titles since newest v* tag
                                  (feat→Added, fix→Fixed, else→Changed); hand-polished at tag; CI fails if
                                  empty while HEAD is ahead of the tag
CONTRIBUTING.md                   authored (≤150 lines): build/test/lint, PR body contract, soak rule,
                                  release steps, where rulings go
CLAUDE.md                         authored (≤200 lines): the four contexts, conventions, "read these" ;
                                  GENERATED blocks: commands (package.json), bundles (esbuild BUNDLES),
                                  flags summary (flag registry), kinds summary (kinds registry), skills roster
SECURITY.md                       authored

docs/README.md                    GENERATED index of every doc from front matter (class/status/date/purpose)
docs/user/USER_GUIDE.md           authored; §2.5 is a <!-- gen:flags --> block
docs/user/CAPTURE_GUIDE.md        authored
docs/user/FLAGS.md                GENERATED from src/shared/metadata/feature-flags.js (FLAGS_DEFAULTS + FLAG_META)
docs/law/CONSTITUTION.md          authored, guard-pinned (unchanged path is fine if renumbering is a concern —
docs/law/PHILOSOPHY.md            keep the current paths and add front matter instead; the tree shape is
docs/law/DISCIPLINES.md           secondary to the one-source rule)
docs/law/TRUTH_SYSTEMS.md
docs/law/THREAT_MODEL.md
docs/decisions/README.md          GENERATED register: R-001…; one row per ruling
docs/decisions/R-NNN-<slug>.md    authored, ≤40 lines each: date · who ruled (maintainer/agent) · verbatim
                                  quote · supersedes · guard that pins it · questionnaire Q/F id if any
docs/wire/NIP_DRAFT.md            authored prose; kinds table is a <!-- gen:kinds --> block
docs/wire/KINDS.md                GENERATED from src/shared/kinds.js (live/reserved/retired/free)
docs/design/<NAME>_DESIGN.md      authored; front matter status; the 16 design docs + CASE_WORKSPACE_DESIGN
                                  (promoted from the two normative kickoffs)
docs/journal/2026-Q2.md           append-at-bottom; entries under the existing three triggers
docs/journal/2026-Q3.md           (JOURNAL.md at the old path becomes the GENERATED index + a pointer)
docs/verification/SMOKE_TEST.md   authored sections by surface, each row tagged unit|guard|agent|walk
docs/verification/WALK_LEDGER.md  append-at-bottom evidence; written by hand-to-maintainer
docs/plan/ROADMAP.md              authored Now/Next/Parked (≤200 lines), edited at wave boundaries
docs/plan/RESET_PLAN.md           this audit's synthesis; cites B/T/K/DOCC ids
docs/plan/TRACKER.md              one row per open id (B/T/K/DOCC/…): status · PR · check date
docs/archive/<date>-<name>.md     banner-first; EPISTACK×10, superpowers plan, 11 shipped kickoffs,
                                  ROAD_TO_1_0, FOUNDING_TRANSCRIPT, TRUTH_INFRASTRUCTURE, BONDING_NOTES,
                                  PORTAL_UX_REVIEW/MARGIN_UX_REVIEW once actioned, ROADMAP phase history
docs/discipline-standards.html    GENERATED (exists) — roster from directory scan
tools/auditor-prototype/          moved out of docs (code)
tools/gen-docs.mjs                the one generator (fills every <!-- gen:* --> block; writes the GENERATED files)
tools/smoke/*.mjs + README.md     agent walks; README generated from script headers
tests/doc-currency.test.mjs       the guard set below
```

### Authored vs GENERATED vs ARCHIVED — the sources

| Generated artifact | Source | Exists today? |
|---|---|---|
| Flag table (USER_GUIDE §2.5, FLAGS.md, Settings → Advanced) | `FLAGS_DEFAULTS` + new `FLAG_META` (label, surface, leavesMachine, gatesKinds, since, checkDate) | FLAGS_DEFAULTS yes; META no |
| Kinds table (KINDS.md, NIP_DRAFT block, CLAUDE.md summary, CONSTITUTION Art. 10 check) | new `src/shared/kinds.js` registry (builders import their numbers from it) | no — 9 constants + literals |
| Bundle block (CLAUDE.md, README Layout) | `export const BUNDLES` from esbuild.config.mjs | no — inline objects |
| Commands block (CLAUDE.md, CONTRIBUTING) | package.json `scripts` | source yes |
| Test/file counts | **none — deleted everywhere; guard forbids** | n/a |
| CHANGELOG `[Unreleased]` | `git log --merges vLatest..HEAD` PR titles | source yes |
| docs/README.md index, decisions register, journal index | front matter / headings | no front matter yet |
| Skills roster (html, CLAUDE.md sentence) | directory scan + Standards-section test | generator yes, roster hardcoded |
| tools/smoke/README.md | script header comments | no |

### JOURNAL — what the 580 KB becomes
Keep append-only (KEEP the rule; the trace organ is right). Change the container: **split per quarter, append at bottom** (kills the prepend conflict for parallel branches), **generated index** at the old path (so every existing `docs/JOURNAL.md 2026-08-02` citation still resolves to something that lists that entry), and **extract rulings** into `docs/decisions/` with stable ids. The extraction is a one-time agent pass over the ~30 entries tagged design/ruling that quote the maintainer; each becomes R-NNN with a provenance grade borrowed from PR #366's E1–E5 scale so the reconciliation has a register to fill rather than a corpus to mine. Entry length stays "tight" (avg 2.4 KB is fine; the 7.6 KB outliers are design essays that belong in their design doc).

### ROAD_TO_1_0 — what the 416 KB becomes
Archive with banner (evidence, citable ids); its open B/T/K rows move to `docs/plan/TRACKER.md`; its verdict is superseded by RESET_PLAN. Nothing is lost; one fewer hand-maintained tracker.

### Currency guard set (`tests/doc-currency.test.mjs`) — each fails CI, each cites its pain
1. **No test/file counts in prose** — regex `\b\d{3,4}\b\s+(tests|passing|test files)` over `*.md`, `.claude/**/*.md`. Pain: JOURNAL 2026-07-03; README:381/406; CLAUDE.md:21; SMOKE:242.
2. **Version literals** — any `\bv?0\.\d+\.\d+\b` in README/CLAUDE.md/CONTRIBUTING/USER_GUIDE outside a CHANGELOG-style heading equals package.json. Pain: README:19 since 2026-07-20.
3. **CHANGELOG non-empty when ahead of tag** (CI step, `git describe`). Pain: B9; CHANGELOG:11-13.
4. **Every `npm run <x>` cited in any .md exists in package.json** (S7's promised graduation). Pain: CI SKILL.md:145.
5. **Flag registry ⇔ FLAGS_DEFAULTS ⇔ generated table rows ⇔ every `isEnabled('…')` literal in src** (B11's promised guards). Pain: B11; USER_GUIDE 16/20 today.
6. **Kinds registry ⇔ every `kind:` literal in builders/publishers ⇔ NIP_DRAFT table ⇔ CONSTITUTION Art. 10** (text-level, like constitution-guards). Pain: JOURNAL 2026-07-09 (32125), 2026-07-03; B16.
7. **Bundle block ⇔ esbuild BUNDLES**; esbuild header has no prose list. Pain: esbuild.config.mjs:3; K12.
8. **Generated blocks are fresh** — run `tools/gen-docs.mjs --check`; any `<!-- gen:* -->` block or GENERATED file that differs fails (the discipline-docs pattern, generalized). Pain: JOURNAL 2026-08-02/08-04.
9. **Status words live only in the ledger** — `smoke run pending|walk pending|not yet walked` forbidden outside WALK_LEDGER. Pain: JOURNAL 2026-08-02 and its recurrence (DOCC-6).
10. **Archive banner** — every `docs/archive/*` starts with the banner; every doc has front matter with a valid class/status. Pain: K13 blocked on mis-classification.
11. **No `Phase \d+` in src/**/*.html or user-class docs.** Pain: B9/B13; 13 leaks.
12. **Skills roster derived, not literal** — IDS.length == directories with a Standards section. Pain: CLAUDE.md:303.

Standard-8 experiment statement for the set: expected relief — zero fact-drift findings at the next tag's doc-currency pass (today: 20); boundary — the next `v*` tag. If the pass still finds hand-copied facts, the guard set is wrong, not the docs.

### The per-PR ceremony that REMAINS
1. **PR body, three lines** (a template in `.github/PULL_REQUEST_TEMPLATE.md`): `Verification: unit|guard|agent-smoke|walk — <which>` · `Wire format: none|additive|breaking|new-kind|retirement` (ecosystem-pm's line, only when a builder is touched) · `Docs: none | <files>`.
2. **JOURNAL entry only under the three existing triggers** (non-obvious root cause; second-guessable decision; third-party workaround) — appended at the bottom of the current quarter file. A maintainer *ruling* goes to `docs/decisions/R-NNN` instead.
3. **Walk ledger row** — appended by `hand-to-maintainer` when the maintainer reports the soak result; never by the authoring PR.
4. **Nothing else.** No CHANGELOG edit (generated), no ROADMAP edit (wave boundaries only), no CLAUDE.md edit (generated blocks; prose changes only when a convention changes), no README edit, no design-doc banner (a front-matter status flip at phase closeout, done once by the closeout checklist), no SMOKE section edit unless a new *surface* exists (verification-engineer decides).

At **wave/phase closeout**: flip design-doc status, update ROADMAP Now/Next, close open S8 experiments, run `npm run docs:gen` — one commit.
At **tag**: polish `[Unreleased]` → `[x.y.z]`, `npm run version:set`, run the guard set (already in CI), walk the ledger's owed rows.

---

## Questions for the maintainer

Each with the provenance of the current rule (E-grade per PR #366's scale where I can tell) and a recommended default. None of these are rulings.

1. **CHANGELOG: generate `[Unreleased]` from PR titles, or keep it hand-written?** Provenance: CONTRIBUTING:146 / JOURNAL 2026-04-23 — an agent-built pipeline convention (E5). Default: generate at merge from prefixed PR titles; you polish once at tag. Cost of wrong default: release notes read like commit subjects.
2. **Phase numbers: are they your vocabulary or the agent's?** README carries 17, the shipped UI 13. Provenance: issue #20 structure (yours, 2026-04) — but their spread into UI text is agent accretion. Default: keep phases in ROADMAP/JOURNAL/decisions only; strip from README and every HTML shell.
3. **JOURNAL split per quarter + a decisions register — does anything you do depend on the single file?** Provenance: JOURNAL header, agent-authored 2026-04 (E5). Default: split, append-at-bottom, generated index at the old path so old citations still resolve; rulings extracted to `docs/decisions/` with ids so PR #366's F1–F13 have a home.
4. **Should `docs/`, `tests/`, `tools/`, `.claude/` ship in the release zip?** Provenance: no one decided; `webExt.ignoreFiles` was set once for the companion. Default: exclude all four (≈5.5 MB); the zip is for researchers.
5. **Archive the 11 shipped kickoffs under a banner, and promote CASE_WORKSPACE_KICKOFF + CASE_BOUND_WORKSPACES_KICKOFF to a design doc first?** Provenance: K13 ratified by you 2026-08-09 (E1), then blocked by an agent's correct catch. Default: yes to both; nothing deleted (Art. 3).
6. **CLAUDE.md: do you want the phase-by-phase recap in the agent's system prompt, or is it accretion?** Provenance: agent accretion, one paragraph per closeout (E5). Default: cut to ≤200 lines with generated blocks; history lives in ROADMAP archive + decisions.
7. **Test counts: delete from every doc (guard forbids), or generate them?** Provenance: port-era progress signal (E5). Default: delete — nobody acts on the number; a guard that forbids it is cheaper than one that updates it.
8. **ROADMAP's GitHub-issue mirroring (ROADMAP:2168-2169) — still something you do?** Provenance: 2026-04 process (yours or agent's; the issue table is yours). Default: retire the ritual; ROADMAP becomes Now/Next/Parked.
9. **Front matter on every doc (3 lines: class/status/date) — acceptable in this repo's markdown?** Provenance: none (new). Default: yes; it is what makes the index, the archive guard, and "what governs today" mechanical.
10. **Who owns doc currency — one skill, one guard file?** Provenance: the S7 two-skill split, agent-designed 2026-08-04 (E5). Default: `continuous-improvement` owns `tests/doc-currency.test.mjs`; verification-engineer's half collapses into it.
11. **The two DevTools-only wire flags (`storeFirstPublish`, `extractionAnalysisPublishing`): surface them in Settings, or keep them hidden on purpose?** Provenance: MA.6 posture was yours (2026-07-29, whole-unit disclosure); the *hiding* is not recorded as a decision. Default: surface with the same leaves-machine wording the transcription flags got on 2026-08-15; the generated table then shows `surface: settings`.
12. **ROAD_TO_1_0 → archive + tracker: do you want the tracker as a markdown table or GitHub issues?** Provenance: "hand-maintained" was the audit's own choice (E5). Default: markdown `docs/plan/TRACKER.md` (greppable by agents; no connector needed), one row per id.

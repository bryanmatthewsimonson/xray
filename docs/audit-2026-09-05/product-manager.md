# product-manager lens — fresh-eyes audit of X-Ray (2026-09-05)

Mode: (c) release sweep + (e) flag promote-or-kill, run over the whole tree
against the wide-release yardstick (non-technical research groups). Tree ==
origin/main c1e652c; PR #370 (feat/margin-s1) read from its branch. Evidence
is `file:line` or `doc §`; ROAD_TO_1_0 ids are cited, not restated.

---

## Verdict

**The product, in one sentence, for whom:** X-Ray is a browser extension
that lets an investigator capture web pages (articles, videos, PDFs, books,
podcasts) into a private local archive, mark exactly what each source
claims, organize sources into a case, and publish the captures and claims
to NOSTR so other investigators can build on them — for independent
researchers working a question they care about. Everything with casework
pull in the last 60 days sits inside that sentence: capture (JOURNAL
2026-08-25 "a heavy casework day — long diarized transcripts, an EPUB,
court-filing PDFs", docs/JOURNAL.md:73), claim proposals (walk ledger
2026-08-25 "72, 60 and 86 proposals on a long diarized transcript",
docs/SMOKE_TEST.md:43), cases + the corpus brief (JOURNAL 5314, 3904; PR
#374 dated today fixes the map/reduce + entity-page passes as jobs, so they
are in live use), transcription (six ledger walks 08-15…08-23), the entity
dossier (walk ledger 2026-08-25, "LDS-church dossier 269 claims · 22
articles"), forensic proposal accept (PR #360 walk). Everything outside
that sentence — truth adjudication, the moral lens, hypothesis maps,
counterfactuals, AI vision, the Network client, assessments publishing,
kinds 30068/30069/30070 — has **no casework evidence at all**: zero
JOURNAL entries since design, zero walk-ledger rows, flags never flipped.
By the project's own fact-layer test (SKILL.md Standard 3, JOURNAL
2026-07-20) those are park candidates today, not 1.0 features.

The distance to a wide release is not code quality (2878 tests green in
16 s) and it is not missing features — it is that a 29-phase, 16-kickoff,
20-design-doc conveyor has been "COMPLETE" at every stage while the four
tracks that actually reach a stranger (ROAD_TO_1_0 T5 evidence, T6 group
surfaces, T7 first hour, T8 kills) stand at **0/35 checkboxes** a month
after the punch list was written (docs/ROAD_TO_1_0.md:925-1082, counted).
August's 187 commits split 45 docs / 38 fix / 28 feat; the maintainer's
scarce attention went to transcription waves, portal UX, a governance
questionnaire, a governance skill, a governance UX review, and a Margin
design whose S1 hands him a 14-row walk (docs/SMOKE_TEST.md M.1–M.14 on
the branch) — which is exactly the "testing stuff I don't even care about"
he named. The phase model rewards this: a phase closes when its slices
land, never when casework pulls them, and nothing in the tree can say "no".

Fresh eyes: the core is genuinely good and worth keeping — capture →
claims-with-quotes → case → brief → publish is a coherent, unusual, and
already-working product. What surrounds it is five judgment families and
three sharing models built ahead of any user, each carrying its own flag,
smoke section, wire kinds, firewall vocabulary, and design doc. A 1.0 for
non-technical groups is the core sentence plus install, first hour, a
publish pre-flight, and ONE sharing path — and a parked-features shelf with
dates on it. The plan below is mostly subtraction and sequencing; very
little of it is new code.

---

## What is good (KEEP)

- **The capture pipeline and its platform breadth** — Readability +
  Turndown core (`src/shared/content-extractor.js`), YouTube transcripts,
  Substack, PDFs via pdf.js (Phase 18), EPUB import (walk PASS 2026-08-23,
  SMOKE ledger), podcast transcription. Casework hits it daily (JOURNAL:73).
- **Thin claims grounded in verbatim quotes, human-accepted** — kind 30040
  with the quote as identity (`docs/CLAIMS_REDESIGN.md`, JOURNAL 2026-07-03
  "the model's quote is a search key, not evidence"). The article pass
  (`src/shared/article-pass.js`, UA.1–UA.3) reduced Suggest to ONE call and
  the "Accept all / Link all covered" flow (PR #361 walk) is what makes
  hundreds of proposals reviewable. This is the product's differentiator.
- **Cases + the corpus brief** — union membership (20.1, fixed from live
  COVID feedback JOURNAL:5461), the case dashboard, the synthesized brief
  with numbered citations (JOURNAL 4138). Maintainer-named "the most
  wikipedia-like artifact X-Ray creates" (docs/LIBRARIAN_KICKOFF.md §1).
- **Direct cloud transcription (DC.1–DC.3)** — nothing installed, walked on
  a fresh profile with the companion stopped (SMOKE ledger 2026-08-15/16).
  This is the transcription path for the 1.0 audience.
- **Local-first signing with the primary key outside the entity registry**
  (`src/shared/storage.js` `local_primary_identity`), verify-on-ingest,
  the publish gate's `confirmedOk` (29.1). Trust-preserving fundamentals.
- **Backup merge-import** (`mergeBackup`, "accrual by id, local wins,
  config/identities never merged" — JOURNAL 2026-07-25) — the one sharing
  path that has been exercised and needs no network.
- **The kill precedent** — the Phase-19 fact layer ripped out (JOURNAL
  2026-07-20), kind 30043 retired, K1/K2/K6/K7/K10/K11 executed with
  blast-radius maps (ROAD_TO_1_0:1083-1136). The project knows how to kill.
  "A parked feature keeps its tests; a killed feature does not" (JOURNAL
  1919) is a rule worth keeping verbatim.
- **The walk ledger** (docs/SMOKE_TEST.md:12-53) — walks performed, dated,
  with what they found. It is the only honest record of verification and
  it is being kept; every late-August PR has a row.
- **The soak rule's insight** (CONTRIBUTING.md:226-244): real use IS a
  verification layer. (Its cost is a finding below; the insight is right.)
- **The Margin's direction** — "the insight and the sentence it is about
  are never in the same place" (docs/MARGIN_DESIGN.md §1) is the correct
  diagnosis of the reader; an annotated article as THE surface is what a
  fresh design would build. (The slice cost is a finding below.)
- **`tools/smoke/ma6-walk.mjs`** — Playwright drives the real unpacked
  extension headlessly (25 KB, produces screenshots and the event JSON in
  the same dir). It proves the browser layer is automatable.
- **JOURNAL.md as institutional memory** — the "so-what for future
  readers" discipline caught the 2026-07-21 sprint-descope misreading and
  the 2026-08-02 stale-walk pattern. Too large (580 KB) but the right
  artifact.

## Grandfathered

Things that exist because of a past decision whose premise is gone or was
never the maintainer's.

- **The phase model itself** (ROADMAP Phases 0–29 + Case WS / Post-28 /
  AI vis. / TxAny "waves") — grandfathered by issue #20 (2026-04), whose
  own "Abandonment criteria" (docs/ROADMAP.md:2153-2161) frame the roadmap
  as a *parity-with-the-userscript* plan: "if the cost to continue exceeds
  the marginal value of reaching parity … it's reasonable to stop."
  Parity was reached at v0.5.x (ROADMAP:888). The numbering kept running
  for 20 more phases with no product-level stop rule.
- **Truth adjudication (Phase 15, kinds 30063/30064)** — grandfathered by
  the Epistack competition sprint (PR #89, 2026-07-02; `docs/EPISTACK_*`).
  Every JOURNAL mention is design-era (JOURNAL 6951–7297); no walk-ledger
  row; `truthAdjudicationPublishing` never flipped; the design doc still
  reads "design draft" (docs/TRUTH_ADJUDICATION_DESIGN.md:3). The
  competition deadline (2026-07-19) is the premise, and it has passed.
- **The moral lens (Phase 16)** — parked 2026-08-09 on the maintainer's
  own words: "the fact that I haven't had a chance to test them yet is the
  operating reason why I ratified the kill" (JOURNAL 1899-1902). K3 parked,
  not killed; 30066 "permanently free" is an E5 generalization (questionnaire
  F4/Q5). 1,457 LOC (`lens-*.js` + `reader/lens-section.js`) kept
  exercised by tests — fine as a park; not a 1.0 feature.
- **Hypothesis maps + structural counterfactuals (Phase 26)** —
  grandfathered by the Epistack rubric era (approved 2026-07-16, JOURNAL
  4828). Zero JOURNAL mentions since; no ledger row; 1,002 LOC
  (`portal/hypothesis-block.js` 579 + `shared/hypothesis-model.js` 423) plus
  the counterfactual module and a SMOKE §Phase 26 with 15 rows nobody has
  walked (docs/SMOKE_TEST.md:1488-1503).
- **The Network client (Phase 25)** — `networkPage: false` with the comment
  "ships default-off while the phase is in flight"
  (src/shared/metadata/feature-flags.js:129-135) while ROADMAP:1941 marks
  Phase 25 COMPLETE. B14 found zero JOURNAL mentions of networkPage /
  reviewCoordination / followListPublishing; still true today (grep). The
  premise — a follow-feed social layer — postdates the founding transcript
  and predates any second user.
- **Three collaboration models** (case bundle with entity private keys;
  follow + incorporate; TEAM_CASE_DESIGN's unbuilt TC.3/TC.5) — B14 open.
  TEAM_CASE_DESIGN.md:21-23 still carries the 2026-07-03 owner constraint
  "no aggregation / consensus / reputation layer" as substrate, which
  JOURNAL 2026-07-21 (3527) later clarified was sprint-scoped, not doctrine.
- **The companion transcriber as a user-facing path** — grandfathered by
  the 2026-04-19 "YouTube DOM arms race" (feature-flags.js:152-153 cites it
  as "the why"). It is a Windows-only Python/GPU service
  (ROAD_TO_1_0 "What 1.0 can ship without", macOS/Linux bullet); LT.1–LT.14
  are code-complete and unwalked (SMOKE ledger "Not yet walked"). DC.1
  removed the premise for the 1.0 audience.
- **AI vision (`aiVision`)** — one JOURNAL entry at ship (2026-07-29,
  3160); no ledger row; SMOKE section exists (1560). Built in the
  "post-28 wave" momentum; no casework has asked for image captions.
- **Assessments publishing (Phase 11, 30054/30055)** — the *local* stance
  is arguably part of the core, but the publish path and the kind-1985
  mirror have never been enabled (`assessmentPublishing: false`, no ledger
  row since 2026-08-11). Grandfathered by the "opinions to debate" framing
  of June 2026 (JOURNAL 8552).
- **Publish kinds 30068 (CaseBrief), 30069 (OwnedKeys), 30070
  (ExtractionAnalysis)** — each minted in a July wave, each default-off,
  none with a known consumer; B16 open. The wire covenant makes them
  permanent at 1.0.
- **Phase 29 store-first publish** — 29.1 shipped 2026-08-02; 29.2–29.6
  open (ROADMAP:2102-2115); `storeFirstPublish` has no Options control
  (grep options.html: 0 hits). A publish-path fork carried half-built.
- **Constitution guards pinning verbatim doctrine of E5 provenance** —
  `tests/constitution-guards.test.mjs` and now `tests/margin-guards.test.mjs`
  (274 lines: no-fused-number, reserved-vocabulary, audit-fence) enforce
  rules the questionnaire grades E5 (F2, F3, F4, F7). Every new surface pays
  this tax before any user has seen it. Provenance: agent generalization
  2026-07-22, ratified by merge — the maintainer's 2026-08-28 reconciliation
  statement is the reason to call this grandfathered rather than settled.
- **Userscript-era idioms** (2-space files, snake_case config, the
  `Storage.entities` null-object — K14 blocked because it is load-bearing).
  Harmless; noted so nobody "tidies" them mid-release.

## Garbage

Dead, duplicated, or actively misleading — cheap to remove or fix.

- `README.md:19` — "**v0.7.0** (tagged 2026-07-16)" while the tree is 0.8.0
  (tagged 2026-07-20). B9 open. The front door lies about the version.
- `docs/ROADMAP.md:1500` — "Phase 16 … ✅ shipped — **smoke run pending**"
  contradicts `docs/ROADMAP.md:94` ("§Phase 16 smoke-run complete") in the
  same file, *after* the 2026-08-02 correction that was supposed to fix
  exactly this (JOURNAL 2270). ROADMAP status lines cannot be trusted; the
  ledger wins (SKILL.md Standard 6).
- `docs/ROADMAP.md:2164-2174` "Keeping this doc current" — instructs
  mirroring every sub-phase to GitHub issues (#20 and per-phase issues).
  Nobody has done this since Phase 8; the instruction is dead process.
- The six `docs/EPISTACK_*` + `docs/epistack/` — expired competition entry
  carrying live-sounding imperatives (K13: banner blocked on lifting
  RUNBOOK §5/§7 first; still not done).
- `docs/SMOKE_TEST.md` agent-coverage table + pseudocode + hardcoded counts
  (K12 NOT STARTED) — describes a 2026-04-21 proof of concept and
  understates automation by an order of magnitude.
- Reader "Import audit JSON…" always visible (`src/reader/index.html:127`)
  next to flag-hidden siblings (K8 half done) — a control for a format the
  1.0 user cannot produce.
- Flags with no UI: `reviewCoordination`, `storeFirstPublish`,
  `extractionAnalysisPublishing` — 0 hits in `src/options/options.html`
  (B10 partially open). A flag only DevTools can flip is not a feature and
  not an experiment; it is dead weight in the registry.
- `docs/USER_GUIDE.md` §2.5 flag table + 14 `[SCREENSHOT-nn]` placeholders
  with zero images (B13 open) — a guide that documents switches the user
  cannot reach and shows nothing.

---

## Findings (ranked by harm)

### PROD-01 · Wide release has no delivery channel and no first hour, and August spent the attention elsewhere — harm 5
- **Evidence:** ROAD_TO_1_0 B7 (:301-334) and B13 (:496-533) open; T5 0/7,
  T7 0/11 (docs/ROAD_TO_1_0.md:925-1037, checkbox count). README.md:216-219
  still instructs Developer mode / Load unpacked / Firefox temporary
  add-on. `git log --since=2026-08-01`: 45 docs / 38 fix / 28 feat commits;
  the walk ledger shows the maintainer's August sessions went to
  transcription (6 walks), portal UX PR-2…PR-8 (7 walks), Suggest fixes,
  book import — none to install, first-run, or the guide.
- **Claim:** No non-technical person can install X-Ray today and keep it
  across a browser restart on Firefox, and nothing in the tree is moving
  that. Every other finding is moot until this one closes.
- **Fresh-eyes action:** Declare the channel this week (unlisted Chrome
  Web Store + AMO-signed xpi, per B7's fix); make T5's first three
  checkboxes and T7's first-run/Help-link items the ONLY feature work
  accepted for the next release; everything else queues behind it.
- **Effort:** L (mostly waiting on store review) · **Ref:** B7 open, B13
  open, T5/T7 open.

### PROD-02 · Seven feature families are carried as "COMPLETE" with zero casework pull — harm 5
- **Evidence:** Truth adjudication (`truthAdjudicationPublishing: false`;
  JOURNAL mentions all ≤2026-07-02; no ledger row; ~2,900 LOC in
  `truth-*.js`, `integrity-model.js`, two modals). Moral lens (parked;
  JOURNAL 1899). Hypothesis maps + counterfactuals (approved 2026-07-16;
  zero JOURNAL mentions since; 1,002+ LOC; SMOKE §Phase 26 unwalked).
  AI vision (one ship entry 3160; no walk). Network client (`networkPage:
  false`; zero JOURNAL mentions; B14). Assessments publish path (never
  enabled). Kinds 30068/30069/30070 publish paths (never enabled, no
  consumer). ROADMAP marks each ✅ COMPLETE (ROADMAP:1327, 1500, 1904,
  1941, 1995). `src/shared/audit/` + truth + lens + forensic families total
  16,010 LOC (wc).
- **Claim:** By the project's own Standard 3 ("if real corpora never feed
  this within N cases, it retires") these families have failed their
  unstated check date. They cost maintainer attention on every review,
  every smoke section (49 sections), every flag decision, every doc, and
  they are what makes the reader header carry 20 buttons
  (`src/reader/index.html`, grep `<button`) and the product read as
  "incoherent".
- **Fresh-eyes action:** PARK (not kill — tests stay) truth adjudication,
  moral lens, hypothesis maps, counterfactuals, AI vision, and the Network
  page behind one "Advanced analysis (experimental, unsupported)" Options
  group with a single check date (recommend 2026-11-30). Hide their reader
  bars and portal blocks when parked. Record each park in JOURNAL with the
  revival condition "used on a real case." Keep epistemic audits and
  forensic findings visible only because casework has touched them
  (JOURNAL 6057; PR #360 walk) — but give them the same check date.
- **Effort:** M (hiding + JOURNAL; no deletion) · **Ref:** K3 parked; B19
  closed by K3; B14 open; new for Phase 26 / aiVision / Phase 15.

### PROD-03 · The maintainer's automation ask ("hundreds of URLs, capture + claims + entities") has no path in the tree — harm 4
- **Evidence:** `src/shared/url-import.js:248` `concurrency = 2`; header
  :3-26 — fetch from the extension page, no tab, so no JS-rendered pages
  and no platform handlers (YouTube/FB/IG/TikTok/Substack API paths need
  the content script). `src/portal/import-urls.js:36` "Analyze-after-import
  runs ONE article pass per" URL, foreground, in the portal tab.
  `.claude/skills/xray-capture/SKILL.md:35` "Captures run sequentially —
  one URL at a time". PR #374 (today) exists because the map/reduce and
  entity-page passes were "a held-open message" that MV3 eviction kills —
  i.e. long-running LLM work still has no job model. Nothing can run
  unattended; nothing resumes.
- **Claim:** The corpus-intake story is "paste 20 URLs and watch"; the
  maintainer wants "hundreds" with claims and entities extracted, which
  needs a resumable background job queue (capture → article pass →
  proposals) that survives SW sleep and a closed portal tab, plus a
  platform-URL lane that opens a real tab.
- **Fresh-eyes action:** Make PR #374's job model the foundation: a
  persisted job queue in `xray-audits` (URL → captured → extracted →
  proposals-ready), driven by `chrome.alarms`, with the portal as a
  progress viewer, not the runner. Route platform URLs to a
  tab-opening lane (the `#xray:capture` marker already exists — reuse it
  from the background, no agent needed). Raise concurrency per-origin, not
  globally. Success criterion: 200 URLs from a text file → archive +
  proposals overnight with the portal closed.
- **Effort:** L · **Ref:** none in ROAD_TO_1_0 (it predates the ask);
  Phase 28 marked COMPLETE (ROADMAP:2042) is the stale marker.

### PROD-04 · PR #370 (Margin S1) is the right direction at the wrong cost: 14 maintainer walk rows for a flag-off fourth view — harm 4
- **Evidence:** Branch diff: +1872/−36, `src/reader/index.js` +504 into an
  8,294-line file; `docs/SMOKE_TEST.md` gains M.1–M.14 with a ledger row
  "pending". Of the 14 rows, six are on the casework path (M.1 flag-off
  parity, M.2 see notes in place, M.3 click a span, M.7 accept/dismiss a
  proposal from the card, M.8 publish contains no `xr-ann` markup, M.14
  fresh capture lands in Reader). Eight serve governance guards, a11y, or
  fidelity duplication: M.4 triple-click arbitration, M.5 rail-shape
  semantics, M.6 orphan wording, M.9 keyboard focus, M.10 chip toggles
  surviving re-render, M.11 PDF figures + speaker labels in the annotated
  container, M.12 audit-never-tints (the F7 visual firewall, E5), M.13
  hash-family sync. `tests/margin-guards.test.mjs` (274 lines) pins
  no-fused-number / reserved-vocabulary / audit-fence — questionnaire
  F2/F3/F7, all E5. `docs/MARGIN_DESIGN.md` has 0 "success criteri", 0
  "kill criteri", 0 "check date" (grep) despite PM Standards 2–3 adopted
  2026-08-02 and the design being "ratified" 2026-08-28. The maintainer's
  own philosophy line (§1, "dead-simple, Apple-quality") and his 09-05
  statement ("testing stuff I don't even care about") bracket the gap.
- **Claim:** S1's value assumption — the maintainer would rather read his
  own claims in place than in bars below — is worth testing, but the slice
  makes him verify fidelity duplication and firewall carriers before he
  can answer that question. What is on the critical path to wide release
  is S1+S2 *as the reader's single view* (it discharges the 20-button
  header and the "seven stacked bars" the design itself names). What
  should be parked is everything S3+ (rings, foreign lane, membrane,
  30070 display) and the S1 rows that exist to satisfy guards.
- **Fresh-eyes action:** Merge S1 behind `marginView` after a **5-row**
  walk (M.1, M.2, M.7, M.8, M.14); record M.3–M.6, M.9–M.13 as
  accepted-risk in the ledger. Set the check date now: 2026-09-30 — if the
  maintainer has opened archived articles in Annotated by choice for two
  weeks, S2 (fold the bars, delete the list view) becomes the reader work
  for 1.0; if not, `marginView` is parked with the rest. Do not start S3/S4
  before 1.0 regardless. Strip the guard tests to the one that protects
  the user (draft-leak); keep the other three as a follow-up gated on
  questionnaire Q1/Q3/Q4.
- **Effort:** S (process) · **Ref:** T7 "in-reader icon legend" item is
  discharged by S1's "?" legend; otherwise new.

### PROD-05 · The phase model has become a feature factory with no "no" — harm 4
- **Evidence:** 29 phases + 4 named waves, every one ✅ (ROADMAP:36-247);
  16 kickoffs + 20 design docs (ls docs/); JOURNAL entries per month: 33
  (Apr) / 38 (Jun) / **111 (Jul)** / 61 (Aug). ROAD_TO_1_0 tracks T5–T8:
  0/35. ROADMAP's only stop rule is parity-scoped (ROADMAP:2153-2161).
  Phases close on slices landing ("COMPLETE (PRs #223–#231)"), never on
  casework outcome; no phase entry records a check-date outcome (Standard
  6). ROADMAP contradicts itself on Phase 16 (:94 vs :1500).
- **Claim:** With agents authoring every PR, a phase is nearly free to
  build and expensive to carry; the model has no mechanism that converts
  "unused" into "removed", so the product only accretes — the exact failure
  mode the PM skill names (SKILL.md "Failure mode"). One maintainer cannot
  run 29 phases; he can run one release train and one parked shelf.
- **Fresh-eyes action:** Retire phase numbering for new work (existing
  numbers stay as historical labels). Replace ROADMAP's status snapshot +
  ROAD_TO_1_0's tracks with a single generated `docs/STATUS.md`: (a) the
  1.0 blocker list, (b) every default-off flag with owner-facing name,
  check date, last casework evidence (ledger row or JOURNAL cite), and
  disposition; (c) the parked shelf. One-page kickoffs (problem / success
  criterion / kill criterion / check date / what the maintainer must do),
  nothing longer until slice 1 has been used on a case. Merge order is set
  by STATUS.md, not by which branch is green.
- **Effort:** M · **Ref:** B8/B9 adjacent; K12/K13 doc kills feed this.

### PROD-06 · The group workflow — half the mission — is still unexercised, and three designs answer "how do we work together?" differently — harm 4
- **Evidence:** B14, B15 open; T5 two-person walk unchecked
  (ROAD_TO_1_0:948-951); T6 0/8. `networkPage: false` (feature-flags.js
  :135). docs/TEAM_CASE_DESIGN.md:21-23 still states the 07-03 "no
  aggregation / consensus / reputation layer" constraint as substrate
  (JOURNAL 2026-07-21 re-graded that as sprint-scoped). The maintainer's
  2026-08-23 LIBRARIAN seed re-states the need in his own words ("useful
  and usable by more than just me", docs/LIBRARIAN_KICKOFF.md §1).
- **Claim:** A 1.0 "for research groups" whose only tested sharing path is
  emailing a backup JSON is honest only if it says so. Nothing else can be
  claimed until two people on two machines have done it once.
- **Fresh-eyes action:** For 1.0 pick **merge-import of a key-free share
  export** as the single supported group path (it exists, it was walked,
  it needs no relay and no follow model). Run the T5 two-person walk once
  with a colleague before deciding whether the Network page is post-1.0 or
  parked; banner TEAM_CASE_DESIGN and NETWORK_CLIENT_DESIGN accordingly.
- **Effort:** M (decision + one walk) · **Ref:** B14 open, B15 open, T5/T6
  open.

### PROD-07 · The soak rule makes the maintainer the serial bottleneck for 12 open PRs, and the tree has a headless harness it does not use — harm 3
- **Evidence:** CONTRIBUTING.md:226-244 (every behavior PR waits for a
  casework session). 12 open PRs (BRIEFING), #324 stale 164 commits.
  `tools/smoke/ma6-walk.mjs` (25,852 bytes) loads the unpacked extension
  in headless Chromium and produces `ma6-01-case.png` … `ma6-event.json`
  in the same directory — and CI (`.github/workflows/ci.yml`) has no
  browser job. JOURNAL records "suite green while behavior wrong" on
  2026-08-13 ×2 and 2026-08-16 ×4.
- **Claim:** From the PM seat this is a scope-budget problem: every PR
  now costs one maintainer session regardless of size, so throughput is
  bounded by his casework calendar, and the only lever is fewer, larger,
  more valuable PRs — or moving the observable-by-browser rows onto the
  Playwright harness so the human walk shrinks to what only a human can
  judge.
- **Fresh-eyes action:** Keep the soak rule for behavior the harness cannot
  see (relay/signer/real sites); put the ma6-style harness in CI for
  reader/portal/options rendering so smoke rows of the M.1/M.10 type never
  reach the maintainer; cap open PRs at 4 by refusing to open a new one
  until one merges or is parked. (Layer assignment belongs to
  verification-engineer/automator; the PM finding is the attention cost.)
- **Effort:** M · **Ref:** B8 open, T4 1/10.

### PROD-08 · Kickoff discipline is not applied to the project's own kickoffs, including the one written after it was adopted — harm 3
- **Evidence:** grep over `docs/*KICKOFF*.md` / `*DESIGN*.md`: 13 of 16
  kickoffs and 20 of 20 designs have zero "success criteria", zero "kill
  criteria", zero "check date". The three that do (DIRECT_CLOUD, TRANSCRIBE_ANYWHERE,
  UNIFIED_ARTICLE_PASS) are all August. MARGIN_DESIGN.md (ratified
  2026-08-28, after Standards 1–3 adopted 2026-08-02) has none. SKILL.md
  :160-164 says Standards 1–3 "graduate to a guard test … once two
  post-adoption kickoffs exist" — three exist; no guard was written.
  SKILL.md :180-181: "if its sweeps produce reports nobody reads, that is
  a kill criterion for the skill."
- **Claim:** The PM discipline exists on paper and did not gate the very
  next design, which is how a 14-row walk for a flag-off view reached the
  maintainer. Either the standard graduates to a guard or the skill is
  admitting its own kill criterion.
- **Fresh-eyes action:** Write the guard now (any `docs/*KICKOFF*.md` or
  `*DESIGN*.md` dated ≥2026-08-02 must contain a "Success criterion",
  "Kill criterion", and "Check date" heading); retro-fit MARGIN_DESIGN
  with the three lines from PROD-04.
- **Effort:** S · **Ref:** new.

### PROD-09 · The flag registry is an experiment ledger without dates: 20 flags (21 on PR #370), 3 unreachable from the UI, none with a promote-or-kill due date — harm 3
- **Evidence:** `src/shared/metadata/feature-flags.js` FLAGS_DEFAULTS: 20
  entries; Options wires 15 (`src/options/index.js:1314-1349, 1380`);
  `reviewCoordination`, `storeFirstPublish`, `extractionAnalysisPublishing`
  have 0 hits in `options.html`; `moralLens` parked; `trustGraphFilter`
  lives inside the hidden Network page. No flag comment carries a check
  date. B10/B11 partially open. SKILL.md Standard 7's guard ("every
  FLAGS_DEFAULTS entry maps to a … due date") does not exist.
- **Claim:** Default-off forever is not an experiment; it is a shipped
  maintenance surface with no user. Fifteen default-off switches carrying
  identical disclosure language (K15 note) is also what makes Options →
  Advanced unreadable to a newcomer.
- **Fresh-eyes action:** Each flag gets a `// check: YYYY-MM-DD` line and
  a row in STATUS.md; DevTools-only flags are either given a control or
  hard-coded to their default and removed from the registry (the code
  path stays); the Standard-7 guard reads the dates.
- **Effort:** S · **Ref:** B10 partial, B11 open.

### PROD-10 · Three wire kinds and four publish paths exist with no consumer, and 1.0 makes them permanent — harm 3
- **Evidence:** 30068 (corpus-publish.js), 30069 (Phase 24), 30070
  (extraction-publish.js) — all behind default-off flags never flipped;
  `extractionAnalysisPublishing` has no UI. B16 open. NIP_DRAFT (108 KB)
  documents each as normative.
- **Claim:** From the PM seat (Standard 9), a kind with no second user is
  a promise the maintainer is paying interest on. Ecosystem-pm owns the
  wire call; the PM ask is that 1.0's NIP_DRAFT mark every kind that no
  shipped default-on path emits as "experimental — may change" rather than
  normative.
- **Fresh-eyes action:** Ship 1.0 emitting 30023, 30040, 0, 10002, 30078
  (+ 32125/32126 if entity publishing stays) and label the rest
  experimental in NIP_DRAFT with the flag name beside each.
- **Effort:** S (docs) · **Ref:** B16 open.

### PROD-11 · Governance guards enforce E5-provenance firewalls in product code, taxing every new surface before any user validates it — harm 3
- **Evidence:** `tests/constitution-guards.test.mjs` pins verbatim Art. 5
  text, "No case-level score, ever", the never-merge firewall at the export
  surface (BRIEFING §Governance 8). PR #370 adds `tests/margin-guards.test.mjs`
  (274 lines) for F2/F3/F7 — graded E5 in the questionnaire (§2 inventory
  rows F2, F3, F7). `grep -ri firewall src` = 101 hits. MARGIN_DESIGN §10
  tags 7 of 11 constraints **[R]** reconciliation-sensitive and still ships
  guards for them. The maintainer 2026-08-28: "there needs to be a
  reconciliation between my original intentions and what has been
  codified."
- **Claim:** This is a maintainer-attention cost, not a doctrine question:
  each firewall is a design constraint, a guard test, a smoke row, and a
  review argument, paid per surface, for rules whose provenance is an
  agent generalization. The PM lens cannot rule on the rules; it can say
  the cost is being paid ahead of the reconciliation that would settle
  whether they apply.
- **Fresh-eyes action:** Freeze new E5-derived guards until the
  questionnaire's Q1/Q3/Q4/Q12 are answered; tag every existing guard with
  its F-id and evidence grade so the reconciliation can retire or keep
  them in one pass. Phrased as Questions 5 and 6 below.
- **Effort:** S (tagging) · **Ref:** questionnaire F1–F13, Q1, Q3, Q4,
  Q12 (PR #366); no ROAD_TO_1_0 id.

### PROD-12 · The reader is the product's daily surface and it carries 20 header/bar buttons across seven families, most hidden by flags — harm 3
- **Evidence:** `src/reader/index.html`: 20 `<button>` elements (grep), 12
  with `hidden` waiting on flags; sections `xr-audit` (:120),
  `xr-lensread` (:144), `xr-comments` (:156) plus JS-built claims/extraction
  bars; `src/reader/index.js` 8,294 lines (BRIEFING). MARGIN_DESIGN §1
  names "seven stacked bars below the article and a set of modals". UX
  review 2026-08-25: "I don't know how to find an entity dossier" (SMOKE
  ledger :43).
- **Claim:** For the 1.0 user the reader should be: the article, tinted
  where they or their group have said something, one Publish button, one
  Tools menu. Parking the families in PROD-02 removes four bars for free;
  S2 of the Margin removes the rest.
- **Fresh-eyes action:** Sequence: PROD-02 parks → S1 walk (5 rows) →
  S2 fold as the ONLY reader feature work before 1.0. ux-designer owns the
  layout; PM owns the sequencing.
- **Effort:** M · **Ref:** T7 legend item; T8 reader decomposition
  (post-1.0).

### PROD-13 · Entity dossiers have casework pull and no discoverable route — harm 3
- **Evidence:** Walk ledger 2026-08-25: dossier assembled for 269 claims ·
  22 articles, "recorded here after the initial 'I don't know how to find
  an entity dossier' report" (docs/SMOKE_TEST.md:43). K15 half done —
  three entity destinations (entity-dossier / entity / entity-corpus); T8
  "collapse the three entity destinations" unchecked.
- **Claim:** A feature the maintainer uses and cannot find is the
  clearest wide-release defect in the tree: it is already valuable and
  already blocked on navigation, not on code.
- **Fresh-eyes action:** One entity destination reachable from every
  chip (case dashboard, reader tag, portal row); fold entity-corpus into a
  tab (per the K15 note: into the spokes view, not the dossier).
- **Effort:** M · **Ref:** K15 half, T8 open.

### PROD-14 · The companion transcriber is positioned as a user feature for an audience that cannot run it — harm 2
- **Evidence:** `companion/transcriber/` — uv/Python/FastAPI, WhisperX,
  pyannote, `HF_TOKEN`, GPU; Windows-only README (ROAD_TO_1_0 "ship
  without" bullet); LT.1–LT.14 unwalked (SMOKE ledger); Options carries a
  companion status panel + install prose (JOURNAL 2130, 2170). DC.1–DC.3
  walked on a fresh profile with the companion stopped.
- **Claim:** For the 1.0 audience the companion is a maintainer power
  tool. Presenting it as a peer of direct cloud costs Options real estate,
  guide pages, and smoke rows.
- **Fresh-eyes action:** Label it "Developer / self-hosted (Windows)",
  collapse its Options panel behind that label, and make direct cloud the
  documented transcription path. Keep the code; it is walked and in use by
  the maintainer.
- **Effort:** S · **Ref:** T5 "declare Windows-only" open.

### PROD-15 · Hard-tier platforms (Facebook, TikTok) have had no casework mention since April and remain smoke-gated 1.0 claims — harm 2
- **Evidence:** JOURNAL Facebook/TikTok entries all 2026-04-23/24
  (9272-9861); no ledger row; docs/CAPTURE_GUIDE.md calls them finicky;
  README:5 lists them as supported. Instagram IS live (PR #368, 2026-09,
  wrong-account attribution).
- **Claim:** Two handlers are carried at full "supported" status on
  five-month-old evidence, on the most hostile DOMs in the tree.
- **Fresh-eyes action:** Demote Facebook and TikTok to "best effort, not
  release-gated" in README and SMOKE; keep the handlers. Re-promote when a
  case needs them.
- **Effort:** S · **Ref:** none.

### PROD-16 · Phase 29 store-first publish is half-built, flag has no UI, and no check date says whether 29.2–29.6 are 1.0 work — harm 2
- **Evidence:** ROADMAP:2092-2115 (29.1 ✅, 29.2–29.6 open);
  `storeFirstPublish` 0 hits in options.html; EVENT_STORE_DESIGN.md
  "Nothing is built yet; slices at §11" banner amended once.
- **Claim:** 29.1 closed the signature-loss window and earned its place;
  the remaining five slices (flusher, relay store, two repoints, filter
  engine) are an architecture project with no user-visible outcome before
  1.0.
- **Fresh-eyes action:** Declare 29.2 (the flusher) the only pre-1.0
  slice IF the publish pre-flight (B12) needs "pending" state; park
  29.3–29.6 with a post-1.0 date.
- **Effort:** S (decision) · **Ref:** B2 closed (29.1), B12 open.

---

## Fresh-start design

If I started X-Ray today for non-technical research groups I would build
**one product with four verbs and one shelf**:

1. **Capture** — toolbar click / shortcut / paste-a-list. Articles,
   Substack, YouTube (+transcript), PDFs, EPUB, podcast audio via direct
   cloud transcription. A background job queue does the batch; the user
   sees a progress list, never a spinner in a tab they must keep open.
   Platform-specific handlers for Facebook/TikTok exist but are labeled
   best-effort.
2. **Mark** — the article is the only reading surface (the Margin S1+S2
   collapsed into one default view). Select text → tag a person/org or
   record a claim; "Suggest" runs the one-call article pass and the
   proposals appear beside their sentences with Accept/Dismiss. That is
   the whole reader: article, tints, Publish, Tools.
3. **Case** — create from anywhere, add from anywhere, one dashboard:
   sources, people, claims, the brief (with its versions visible, per the
   LIBRARIAN seed). Entity pages are a tab of the same dashboard, not a
   third destination.
4. **Share** — Publish (30023 + 30040 + kind 0) behind a one-screen
   pre-flight that names what becomes public and irrevocable; and ONE
   group path — export a key-free share file, colleague merge-imports it.
   Following npubs and relay-side incorporation arrive when two people
   have done the file path and asked for less friction.

**The shelf** — everything else ships in the tree, tested, hidden behind
one "Advanced analysis (experimental)" toggle group with a printed check
date: audits, forensic findings, verdicts, integrity findings, the lens,
hypothesis maps, counterfactuals, AI vision, the Network page, 30068/
30069/30070 publishing. Each returns to the product by the same door it
left through: a JOURNAL line saying which case used it.

**Process:** no phases. One `STATUS.md` (blockers · flags-with-dates ·
shelf), one-page kickoffs, a Playwright gate in CI for what a browser can
show, the human walk for what only a human can judge, and a hard cap on
open PRs so the maintainer's calendar — not build capacity — sets the
pace. Governance stays supreme but each guard carries its provenance
grade, and no new E5-derived guard lands before the reconciliation the
maintainer has asked for.

---

## Questions for the maintainer

Each with a recommended default and the provenance of the current rule.
None of these is a ruling; the maintainer decides (Art. 11).

1. **Who is the 1.0 user — a solo researcher, or a group of researchers
   from day one?** *Default:* solo first, with the share-file path as the
   only group feature; the Network page post-1.0. *Provenance:*
   ROAD_TO_1_0 (2026-08-09) set "non-technical researchers, working in
   groups" as the yardstick — an agent synthesis, never a maintainer
   sentence; the LIBRARIAN seed (2026-08-23, maintainer verbatim) says
   "useful and usable by more than just me — for now".

2. **Which judgment families are in 1.0?** *Default:* claims (+ local
   assessments as a stance on a claim). Park audits, forensic, verdicts,
   integrity, lens with check date 2026-11-30. *Provenance:* each family
   was approved phase-by-phase in the Epistack sprint (June–July 2026);
   no maintainer statement ranks them for release.

3. **Margin: is S1 enough to answer "do I read my notes in place?", and is
   S2 (fold the bars) the reader for 1.0?** *Default:* merge S1 behind the
   flag after a 5-row walk; decide S2 on two weeks of your own use (check
   date 2026-09-30); no S3/S4 before 1.0. *Provenance:* MARGIN_DESIGN
   ratified 2026-08-28 by you; the 14-row walk and the four guard tests
   were agent additions (§5.4, §9) never separately ruled on.

4. **Delivery channel: unlisted Chrome Web Store + AMO-signed xpi, or a
   signed zip with a stated developer-mode caveat?** *Default:* store +
   AMO; Firefox declared "capture-only, community-supported" until the
   short gate runs on 128 ESR. *Provenance:* B7 (agent finding); no
   maintainer ruling exists.

5. **Should E5-provenance firewalls stay machine-enforced in product code
   (constitution-guards, margin-guards) before the reconciliation?**
   *Default:* keep existing guards but tag each with its F-id and evidence
   grade; freeze NEW E5-derived guards until Q1/Q3/Q4/Q12 of the
   questionnaire are answered. *Provenance:* CONSTITUTION Art. 5/6
   (drafted 2026-07-22 by agents, ratified by merge 2026-08-02);
   questionnaire §2 grades F2/F3/F4/F7 E5; your 2026-08-28 reconciliation
   statement.

6. **"No case-level score, ever" and the no-fused-number rule: do you want
   a case dashboard that can show a coverage or confidence figure?**
   *Default:* allow labeled coverage measurements (the Margin's carve-out
   already does this); keep verdict-style scores out until Q3 is answered.
   *Provenance:* CASE_DOSSIER_DESIGN §2 (2026-07-03, agent design, pinned
   by constitution-guards); questionnaire Q3; PHILOSOPHY §4 always
   aggregated inside the audit family.

7. **Companion transcriber: user feature or developer tool?** *Default:*
   developer/self-hosted (Windows) label; direct cloud is the documented
   path. *Provenance:* the flag comment cites the 2026-04-19 YouTube DOM
   arms race; DC.1 (approved by you 2026-08-15) removed the premise for
   newcomers.

8. **Replace the phase model?** *Default:* yes — freeze numbering, one
   generated STATUS.md (blockers · flags with check dates · shelf),
   one-page kickoffs with success/kill/check-date, PR cap of 4.
   *Provenance:* ROADMAP inherited from issue #20 (2026-04) whose stop
   rule is parity-scoped; nothing since has been ruled on as process.

9. **What does "hundreds of URLs" mean concretely — a URL list you paste,
   or a link frontier the tool follows from captured articles?**
   *Default:* URL list first (resumable background queue: capture →
   article pass → proposals, platform URLs via a tab lane); frontier
   expansion second, behind a per-case cap. *Provenance:* your 2026-09-05
   ask; Phase 28 (2026-07-19) was scoped by agents to "paste a list, watch
   it run" with concurrency 2.

10. **Facebook/TikTok in the 1.0 support claim?** *Default:* best-effort,
    not release-gated. *Provenance:* Phase 8 (2026-04) parity goal; no
    casework mention since.

11. **Which wire kinds does 1.0 promise as stable?** *Default:* 30023,
    30040, 0, 10002, 30078 (+32125/32126 if entity publishing stays on);
    everything else labeled experimental in NIP_DRAFT with its flag.
    *Provenance:* kinds minted per phase by agents (B16); the Art. 10 wire
    covenant is the constitution's; the stability promise was never
    scoped by you.

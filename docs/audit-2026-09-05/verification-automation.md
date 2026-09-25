# Verification & automation lens — fresh-eyes audit of X-Ray (2026-09-05)

Lens: verification-engineer + automator + seam-and-invariant-check Protocols run over the whole tree at `c1e652c` (== origin/main). Baseline re-measured in this container, not copied: `npm test` = 2878/2878 in **17.8 s wall**; `node tools/smoke/ma6-walk.mjs` **ran end to end in headless Chromium** (`/opt/pw-browsers/chromium-1194`, Playwright 1.56.1 from `/opt/node22`) and exited 1 on exactly one stale selector.

---

## Verdict

X-Ray has a good unit suite over the wrong half of the program. 186 of 247 source modules are executed by `node --test`, and inside `src/shared/` the figure is 120 of 128 — crypto against BIP-340 vectors, IndexedDB migrations on `fake-indexeddb`, a cross-language normalizer fixture both suites read. That layer is genuinely well-verified and cheap (18 s). But **every surface a non-technical researcher actually touches has zero executed coverage**: `src/reader/index.js` (8,294 lines, imported by no test, only *grepped* by twelve), `src/background/index.js` (45 `xray:*` handlers in one `onMessage` listener, imported by no test), `src/options/index.js`, `src/sidepanel/index.js`, `src/content/index.js` + `ui.js`, both MAIN-world scripts, `src/portal/index.js` plus 30 of its 50 blocks (`case-view.js`, `extraction-block.js`, `synthesis-block.js`, `inspector.js`, every `import-*.js`). Six of thirteen platform handlers — including `youtube.js` (1,027 lines) and `twitter.js` (545) — are executed by nothing. The August JOURNAL is therefore not a run of bad luck: I list eighteen "suite green, behavior wrong" escapes below and **every one lives in an unexecuted layer**, and fourteen of the eighteen are shaped navigate / click / read-DOM / read-IndexedDB — machine-observable today.

The project already knows how to observe that layer and has proven it twice: JOURNAL 2026-07-05 (the pdf.js bug reproduced only by driving the built bundle in headless Chromium) and JOURNAL 2026-08-02 (`tools/smoke/ma6-walk.mjs` found the false "published" stamp on its first run, after four PR descriptions had asserted the environment was "headless, so it can't be smoked"). That harness seeds state through the extension's own bundled modules, pins relays to a dead loopback port, builds the real kind-30070 in-page without sending it, and reads IndexedDB after each click — it observes seams, which is precisely what the unit suite cannot. It is the best test in the repository, and **it is run by nothing**: no npm script, no devDependency, hardcoded `/opt` paths, and a selector (`/Extracted assertions/`, `ma6-walk.mjs:277`) that went stale when PR #361 renamed the heading to "Claim proposals — the durable map artifacts" (`extraction-block.js:105`). Un-run automation rots; this one rotted in under a month. The gap between "we proved the browser layer is automatable" and "it runs on every PR" is the single highest-payback item in this audit, and it is ROAD_TO_1_0 **B8 / T4 item 4, still open** a month after being written.

In place of that machine layer the project adopted the **soak rule** (CONTRIBUTING:226, maintainer ruling 2026-08-23): every behavior PR waits for a real casework session in the maintainer's browser. The rule was the right emergency response to the DC wave's five same-day-merge escapes, but it institutionalises the maintainer as the serial verification gate for a single-author, agent-authored repo that merged ~50 PRs in August — and its premise ("the suite cannot observe what a person sees") is only true while there is no browser layer. Ten merges and fifteen `docs(smoke): record the PR #NNN soak walk` commits since 08-23, a walk ledger with no minutes column, no `docs/TOIL.md`, and the maintainer's own words ("testing stuff I don't even care about") say what the ledger cannot: the soak is toil that was never priced. The rest of the verification apparatus — the 1,743-line, 49-section SMOKE_TEST.md whose setup block still says "1018/1018" and "seven bundles"; the eight discipline skills whose graduation clauses (stub citations, hardcoded-count guards, the `fix:`-without-tests CI check, the release preflight script) are all still unbuilt; a PR template with no verification-layer or wire-format section despite T4 marking that box `[x]` — is mostly prose describing a gate that does not exist. Fresh eyes would build the machine walk first, narrow the soak to a weekly batch of rows only a human can judge, and cut the smoke document to a thirty-row gate. Everything else here is detail on how.

---

## What is good (KEEP)

- **The shared-layer unit suite** — 120/128 `src/shared/*` modules executed, 2878 tests in 17.8 s, `crypto.test.mjs` against the BIP-340 vectors, `nip44.test.mjs`, migration ladders on `fake-indexeddb` (`archive-cache.test.mjs`, `event-journal-migration.test.mjs`). Fast, trustworthy, and the reason wire-format regressions are rare.
- **`tools/smoke/ma6-walk.mjs`** (474 lines) — seeds through the extension's own esbuild-bundled modules (`seed-entry.js`) so no storage shape is hand-written; pins `default_relays` to `ws://127.0.0.1:1` before anything is clickable (`:104`); generates a throwaway identity per run into a temp profile; builds the real event in-page and inspects it instead of sending (`:265-290`); reads IndexedDB after every click to prove Accept/Dismiss persisted (`:318-347`). Verified here: eight sections, every product check green, ~2 minutes. This is the template for the whole browser layer.
- **The normalizer parity design** — `tests/fixtures/normalizer-parity.json` read by both `provider-normalize.test.mjs` and `companion/transcriber/tests/test_shared_fixtures.py`, with ci.yml running the Python side (`ci.yml:63-79`) precisely because the JS suite "can never OBSERVE the Python behavior". Correct layering, stated honestly in the workflow comment.
- **`tests/constitution-guards.test.mjs`'s positive-sanity-then-enforce idiom** (`:3`, `:125`, `:145-146`, `:213`) — every scanner proves it still sees its target before it enforces. This is the only guard style that cannot rot silently; it should be the mandatory shape for every source-grep guard.
- **`src/shared/publish-gate.js`** — the structural fix from the 2026-08-02 escape: `confirmedOk` as a choke point, now read by `entity-page-block.js:433-437` and `synthesis-block.js:575-585` with the JOURNAL citation inline. An escape converted into an invariant that the next surface cannot forget.
- **The walk ledger rule** ("walks performed, dated — not walks owed", SMOKE_TEST.md:11-17) and the **hand-to-maintainer format** (Setup / Do / Expect / If-it-differs; "reply with the numbers") — the maintainer-facing half of verification finally in a shape a human can act on from the terminal.
- **`seam-and-invariant-check`** — the negative-control rule (§3: "reintroduce the bug and confirm the suite goes red; a guard that cannot be shown to fail is decoration") is the right rule; it just is not enforced (see VERI-04).
- **`tests/helpers/hostile.mjs`** — a hostile-input helper exists for model/peer output; the 2026-08-13 audit's "17 wrong-type defects" class has a home.
- **CI hygiene** — actions pinned to commit SHAs with the reason stated (`ci.yml:18-21`), `npm ci` from the lockfile for web-ext, the `release` environment's required reviewer, the tag arriving via `env:` not `${{ }}` interpolation (`release.yml`). Small, correct, and load-bearing for a store-bound artifact.
- **The diagnostics ring** (PR #343) — the first observer that turned a field failure into evidence the agent could act on without a screenshot (JOURNAL 2026-08-25: "its first real catches").
- **The AW agent-walk rows** (SMOKE_TEST.md:1663-1669) — each has a machine-readable stamp as its observable. This is what an agent-verifiable row looks like; the other ~590 rows do not.

---

## Grandfathered

- **The soak rule as a per-PR serial gate** — grandfathered by the 2026-08-16 DC-wave escapes (CONTRIBUTING:233-239: "five of them AFTER same-day merges"). Its premise — "the suite cannot observe what a person sees" — was true of `node --test` and is false of the Playwright harness that had already existed for two weeks when the rule was written. The rule should survive as a *weekly batch for human-only rows*, not as the default merge gate.
- **The "Agent-runnable subset" of SMOKE_TEST.md** (:117-235) — written against the 2026-04-21 Edge/MCP proof of concept. Its structural constraint ("the reader tab opens outside the MCP-managed tab group, so the agent can't verify reader contents", :177-190; "a row that needs [an extension page] is NOT agent-verifiable", :1650) describes the claude-in-chrome connector, not automation. Playwright reaches every extension page. The vocabulary conflates two mechanisms and so under-counts what is machine-verifiable by roughly an order of magnitude.
- **"MUST be walked by hand" on Archive integrity §7.7–7.16** (SMOKE_TEST.md:1151) — grandfathered by the 2026-07-17 bug stack, which was fixed and verified by *simulating* the reader (`archive-reload-hash.test.mjs`). Each row's witness is a content hash or an event body — both readable by the harness (in-page builder or a loopback relay that records what it receives). The "hand only" label is an untested impossibility claim (verification-engineer First Principle 5).
- **Source-grep guards over `reader/index.js` and the portal blocks** — grandfathered by the userscript port's architecture: an 8,294-line reader that cannot be imported, so tests grep it. Twelve test files `readFileSync` the reader, four the service worker. They exist because the module is un-importable, not because grepping is the right observer; they go away as the blocks become importable or the walk covers them.
- **138 hand-rolled `globalThis.chrome = {…}` stubs** — grandfathered by the port's test style (one stub per file). Zero carry the MDN/Chrome-docs/JOURNAL citation the verification-engineer's own Standard 3 requires. The session-storage-quota escape (JOURNAL 2026-08-25) is the cost: no stub anywhere throws the quota error Chrome throws.
- **The per-phase structure of SMOKE_TEST.md** (Phase 0 … Phase 29, R5, DC.1) — grandfathered by the phase-driven ROADMAP. The instrument a release gate needs is surface-driven (capture → reader → publish → portal → backup), not history-driven.
- **The PR template's Firefox checkbox** (`.github/pull_request_template.md:16-17`) — grandfathered by the pre-reset CONTRIBUTING; T5 ("Decide Firefox") is open and no walk in the ledger ran on Firefox. A checkbox nobody ticks trains everyone to tick without reading.
- **`tools/relay-probe.mjs`** — grandfathered by the Epistack runbook (`EPISTACK_RUNBOOK.md:40-64`); the results line still reads "2026-07-__" placeholder. Keep only if a relay-retention check is a standing pre-tag step; otherwise archive on the record.

---

## Garbage

- `docs/SMOKE_TEST.md:241-242` — "all seven bundles emitted (content, background, options, sidepanel, reader, portal, api-interceptor)" and "1018/1018" against ten bundles and 2878 tests. Named as banned drift by verification-engineer Standard 4 (which itself still says "1277/1277 … ~2500"), by B8, and by T4 item 2 — unfixed in all three.
- `CLAUDE.md:256` and `CONTRIBUTING.md:139` — "CI rejects a mismatch" (package.json ↔ manifest.json). False: `ci.yml` has no such step; only `release.yml` checks, after an undeletable tag is pushed. T4 item 3 open.
- `docs/ROAD_TO_1_0.md` T4 item 9 marked `[x]` — its third clause ("add a Disciplines-invoked and Verification-layer section plus the canonical 'Wire format:' heading to the PR template") is not done: `.github/pull_request_template.md` has What / Why / How I tested / Screenshots / Compatibility notes and no such headings. The punch list's own status is unreliable here.
- `tools/smoke/ma6-01-case.png`, `ma6-02-expanded.png`, `ma6-03-reviewed.png`, `ma6-block.txt`, `ma6-event.json`, `ma6-pageerrors.txt` — walk *outputs* committed to the tree (the walk overwrites them on every run, so they churn the diff). Outputs belong in CI artifacts.
- `tools/smoke/ma6-walk.mjs:277` and `:288` — the `/Extracted assertions/` selector, stale since PR #361; `:31-34` — `/opt/pw-browsers/chromium-1194/...` and `/opt/node22/lib/node_modules/playwright/index.mjs` hardcoded (B8 named this).
- 205 bare `console.*` calls in `src/` against the CLAUDE.md "use `Utils.log`" convention — 103 of them in `reader/index.js`, 18 in `platforms/youtube.js`, 16 in `platforms/instagram.js`. Not garbage individually (some are deliberate diagnostics), but the *convention* is garbage until a ratchet enforces it.
- `docs/EPISTACK_RUNBOOK.md:64` — "Results (2026-07-__)" placeholder, never filled.

---

## The August 2026 escapes — dated, with the layer that should have seen each

Every one below shipped with a green suite (JOURNAL cites given). "Layer" is the *cheapest* layer that could have observed the root cause; "machine?" says whether a headless-Chromium walk with a seeded profile could observe it today.

| # | Date | Escape (JOURNAL) | Root cause lived in | Layer that should have seen it | Machine? |
|---|---|---|---|---|---|
| E1 | 08-02 | False "published" stamp — surface keyed on `resp.ok`, not `confirmed` (`§MA.6 walk`) | `portal/extraction-block.js` | **Browser walk** (found by it) — the seam between the `xray:relay:publish` contract and its caller | yes |
| E2 | 08-13 | `entities` non-array crashed Suggest, then poisoned the content-keyed cache forever (`§validator that NORMALIZED`) | `shared/article-pass.js` | **Unit, hostile fixture** — assert the *cached* value equals the *validated* value (a seam test) | n/a |
| E3 | 08-13 | 17 wrong-type consumer defects, mostly silent (`§Two audits`) | 5+ modules | **Unit, hostile fixtures** via `tests/helpers/hostile.mjs` | n/a |
| E4 | 08-15 | Direct route handed AssemblyAI the *page* URL; mp3 was in JSON-LD (`§DC.1 field failure`) | `shared/media-hints.js` | **Fixture unit** over real page bytes (later added) + live canary | canary |
| E5 | 08-15 | LT.6: no Transcribe button on PowerPress; yt-dlp could not resolve the page; duration guard refused every direct mp3 (walk ledger 08-15) | `media-hints.js`, companion `download.py` | Fixture unit + **companion pytest** (not in CI) + canary | partly |
| E6 | 08-16 | Deepgram click did nothing; consent + page-URL refusal skipped (`=== DIRECT_ENGINE_ID`) (`§A guard that pins a string`) | `reader/transcribe-flow.js` | **Browser walk** (click → dialog appears) or executed flow with a second engine; the guard was a snapshot | yes |
| E7 | 08-16 | Consent dialog named AssemblyAI while sending to Deepgram (`§wrong recipient`) | `reader/transcribe-flow.js` | **Rendered-string test** across every member of the engine set | yes |
| E8 | 08-16 | `priorSubmission` returned, unit-tested, consumed by nothing (`§wrong recipient`) | reader ↔ job driver | **Seam test / walk** — assert the *consumer's* observable effect | yes |
| E9 | 08-16 | Charge warning posted via single-slot `toast()`, erased ms later (`§never the transcript's fault`) | `reader/index.js` | **Browser walk** — read the DOM after the success toast | yes |
| E10 | 08-16 | Adoption read `a.markdown \|\| ''` and replaced every generic capture's body with the transcript (`§never the transcript's fault`) | `shared/diarized-transcript.js` | Unit with a *generic-capture* fixture (HTML content, no markdown); walk | yes |
| E11 | 08-16 | "media URLs are signed and expire" asserted for 8 platforms, true for 5 (`§url must be a string`) | `reader/transcribe-flow.js` | Per-member rendered-string test | yes |
| E12 | 08-16 | yt-dlp ANSI colour codes leaked into the error banner (walk ledger 08-16) | reader banner | Rendered-string / walk | yes |
| E13 | 08-22 | Suggest rejected a double-encoded `entities` string (`§sitting inside a string`) | `shared/article-pass.js` | Hostile-fixture unit (added, at the seam) | n/a |
| E14 | 08-23 | Imported book chapters unreachable; the row rendered the instruction as prose (`§chapters were unreachable`) | `portal/index.js`, `entity-dossier-view.js` | **Browser walk** — click a row, a reader opens | yes |
| E15 | 08-23 | "People & organizations" absent for locally-tagged entities (walk ledger PR #347) | `portal/case-view.js:~417` | **Browser walk with a seeded profile** that has local entities and zero published claims | yes |
| E16 | 08-25 | Session-storage quota leak — every capture registered, none evicted (`§session-record leak`) | `background/index.js`, `reader/index.js` | Unit on `session-articles.js` with a stub that **throws QuotaExceeded like Chrome** (stub honesty) | yes |
| E17 | 08-25 | `bandText` ReferenceError after a partial deletion emptied the dossier content block (`§bandText ghost`) | `portal/entity-dossier-view.js` | **Static lint** — ESLint `no-undef` catches a reference to a deleted identifier; `node --check` is syntax-only. Also the walk | yes |
| E18 | 08-25 | Six consecutive Suggest shape failures; the human was the retry loop (`§ONE paid repair round`) | `shared/corpus-map.js` | Unit (added) + the diagnostics ring, which found it | n/a |

Fourteen of eighteen are machine-observable by a browser walk; one (E17) by a 1-hour lint gate; the rest by hostile-fixture units the repo already has a helper for. **None** required a human's judgment to detect — the human was needed only because nothing else was looking.

---

## Test corpus classification (225 files, 51,748 LOC, 2878 tests)

| Class | Files | What it observes | Blind to |
|---|---|---|---|
| Pure-module unit (imports `src/shared/*`, `src/portal/<block>.js`, `src/reader/<module>.js`) | ~185 | 186/247 modules executed; shared 120/128, audit 20/21, metadata 6/6, identity 3/3, portal 20/50, reader 8/16, platforms 7/13 | anything in `index.js` files; DOM; message bus |
| `chrome.*` / DOM stubs | 138 define `globalThis.chrome`; 6 define `document`/`window` | storage-shaped logic against hand-built semantics | Chrome's real semantics — **0 of 138 stubs cite a source** (Standard 3) |
| `fake-indexeddb` | 29 | migrations, stores, quota-free IDB | quota, `onsuccess`-handler throws aborting transactions (JOURNAL 08-13 open item 1) |
| Source-grep (reads `src/` as text) | 32 (8 do *only* this) | that a token/ordering exists in the source; 1,324 `assert.match/doesNotMatch/includes` calls suite-wide; 179 pin ≥3-word user-visible phrases | behavior; and they go red when you *fix* the thing (JOURNAL 08-16 ×3) |
| Normative-doc guards (`constitution-guards`, `disciplines`, `discipline-docs`, `lens-guards`, `custody-guards`) | 5 | doctrine text, kind schedule, prompt headers | — (correct use of the grep idiom) |
| Fixture-driven | ~10 (`normalizer-parity.json`, `real-pdf-engine.mjs`, hostile helper, hand-built PDFs) | contract with pdf.js API; provider shapes | the *built bundle in a browser* (JOURNAL 07-05) |
| Built bundles in a browser | **0** in `tests/`; 1 script in `tools/smoke/` run by nothing | — | everything below |

**Layers with zero executed coverage:** `src/background/index.js` (1,875 LOC, 45 handlers); `src/reader/index.js` (8,294 of the reader's 14,075 LOC); `src/options/index.js` (1,989); `src/sidepanel/index.js` (2,242); `src/content/index.js` + `ui.js` (415); `src/page/*` (MAIN world); `src/portal/index.js` (1,497) + 30 blocks (~7,900 LOC incl. `synthesis-block.js` 960, `extraction-block.js` 661, `case-view.js` 604, `inspector.js` 557); `platforms/youtube.js`, `twitter.js`, `substack.js`, `substack-api.js`, `comment-extractor.js`, `platforms/index.js` (2,540 LOC). Publish end-to-end (sign → `xray:relay:publish` → pool → relay OK → ledger stamp) is observed only by `ma6-walk.mjs`, against a dead relay — the *happy* path has never been machine-observed.

---

## Findings (ranked by harm)

### VERI-01 · The surfaces a researcher touches have no automated observer — and every August escape lived there
**Harm 5 · GAP · Effort L (with VERI-02 as the first slice, M)**
**Evidence:** executed-module census above (186/247; background 0/1, options 0/1, sidepanel 0/1, reader/index.js 0, portal/index.js 0, 30/50 portal blocks 0, 6/13 platform handlers 0); `background/index.js:448` single `onMessage` listener with 45 `message.type === 'xray:…'` branches; escapes E1–E18 mapped above; `tests/` contains no file that loads `dist/*.bundle.js` in a browser (only `pdf-capture-*.test.mjs` reference `dist/`, from Node with a fake worker — JOURNAL 2026-07-05 records exactly that blind spot).
**Claim:** the unit suite is green because it does not look where the bugs are; ~30,000 LOC of user-facing code is verified by one person's browser session per PR.
**Fresh-eyes action:** stand up the browser layer (VERI-02) as the safety net *first*, then split `reader/index.js` and `portal/index.js` into importable blocks under it (the architect lens owns the split; this lens says: do not split without the net). Target: every `index.js` under 500 lines, every block importable, the walk covering each page's load + one primary action.
**ROAD_TO_1_0:** B8 open; T4 item 4 open; T4 item 10 ("missing platform unit tests — twitter.js, youtube.js") open.

### VERI-02 · The working browser harness is run by nothing, so it rotted in a month
**Harm 5 · GARBAGE-in-place → KEEP after fix · Effort M**
**Evidence:** `tools/smoke/ma6-walk.mjs:31-34` hardcoded `/opt/pw-browsers/chromium-1194/...` and `/opt/node22/.../playwright/index.mjs`; `package.json` has no `smoke` script and no `playwright` devDependency; `ma6-walk.mjs:277,288` `/Extracted assertions/` vs `src/portal/extraction-block.js:105` `'Claim proposals — the durable map artifacts'` (renamed by PR #361, 2026-08-25); run here 2026-09-05: sections [1]–[8] all product checks ✓, exit 1 on the selector alone; `git log -- tools/smoke/ma6-walk.mjs` shows no commit since the 08-08 history reset.
**Claim:** the only observer of E1's class was allowed to decay because it sits at rung "script" with no CI rung above it (automator Standard 5: "a check that has silently stopped checking is worse than no check").
**Fresh-eyes action:** (1) `npm run smoke:walk` → `node tools/smoke/run.mjs`; playwright as a devDependency; browser resolved via `PLAYWRIGHT_BROWSERS_PATH` (already set in the container) with `XR_CHROME` as override; (2) CI job `smoke` after `build`: load the unpacked extension, open **all five extension pages** (`options.html`, `reader/index.html`, `sidepanel/index.html`, `portal/index.html`, `network/index.html`) asserting zero `pageerror` and ten bundles present, then run the MA.6 walk; (3) selectors by `data-xr="…"` attributes, never heading text, with a guard that every `data-xr` the walk uses exists in `src/` (positive-sanity-then-enforce); (4) walk outputs to `$XR_SMOKE_OUT` uploaded as CI artifacts, the committed PNG/JSON deleted.
**Ladder:** script → **CI gate** (trigger: "a regression on main the script would have caught" — E1, E14, E15 all qualify).
**Payback:** build 16 h + 1 h/month maintenance. August's browser-class escapes (E1, E6–E12, E14–E17 = 12) each cost ≈ a follow-up PR (~1 h agent) + a maintainer re-walk (~20 min) + a JOURNAL entry (~20 min) ≈ 1.7 h → ~20 h/month. Repays in the first month; thereafter ~2 min machine time per PR replaces the per-PR human soak for this class.
**ROAD_TO_1_0:** B8 open; T4 item 4 open.

### VERI-03 · The soak rule makes the maintainer the serial merge gate, and its cost has never been priced
**Harm 5 · GRANDFATHERED · Effort M (process) — a maintainer ruling to re-make**
**Evidence:** CONTRIBUTING:226-244 (adopted 2026-08-23); 10 merges since 08-23, 15 `docs(smoke): record the PR #NNN soak walk` commits; walk ledger rows (SMOKE_TEST.md:19-40) carry dates and observations but **no minutes**; `docs/TOIL.md` does not exist (automator Standard 1); BRIEFING: the maintainer is "testing stuff I don't even care about" (PR #370, marginView, +1872 lines); the rule's exemption list (:241) exempts only docs/skills/CI — so *every* behavior PR, including ones whose risk is entirely machine-observable, waits on one human.
**Claim:** in a repo where agents author ~50 PRs/month, one human session per PR caps throughput at the human's casework cadence and spends the scarcest resource on rows a machine could read. The rule's premise ("the suite cannot observe what a person sees") is true of `node --test` and false of the harness.
**Fresh-eyes action:** replace with a **tiered gate**:
- *Machine-only class* — merges on green CI + smoke walk. Includes: any change whose principal risk is a DOM state, a stored record, a built event, a message round-trip, or a rendered string.
- *Human-required class* — rows tagged `human` in the gate (see VERI-06): money spent against a real provider (DC-2/DC-4/DC-10), a publish to a **real** relay, NIP-07/NIP-46 signer popups, service-worker teardown mid-job (DC-3, until VERI-15's spike says otherwise), third-party DOM/API drift on a live site, and "does this look right / read true" judgments (the seam skill's own scope-honesty clause).
- *Batch the human class weekly*: one 30–45 min session on a build of `main` carrying the week's merged human-class PRs, driven from a single hand-to-maintainer list ordered by what fails worst; results recorded in the ledger **with minutes**. A human-class PR merges after green machine gates and is *labelled* `soak:pending`; the weekly session clears the label or files the regression. The 08-16 escapes were all found "within hours of real use" — a week's batch loses nothing a per-PR soak gains, because the same defects are found the same way.
- *Urgent waiver* stays as written (:243).
**Payback:** 15 soaks in 5 days ≈ 15 × (20–40 min) ≈ 5–10 h of maintainer time in one week; batching to one session/week at the same total row count spends ~1 h and removes the maintainer from the critical path of ~80% of PRs.
**ROAD_TO_1_0:** not covered (post-dates it). See Question Q1.

### VERI-04 · Source-grep guards are the fastest-growing test class, and the 2026-08-16 lesson did not stick
**Harm 4 · GRANDFATHERED (by the un-importable reader) · Effort M**
**Evidence:** 32 test files read `src/` as text; 1,324 `assert.match`/`doesNotMatch`/`includes` calls suite-wide; 179 regexes pin a ≥3-word user-visible phrase; `tests/extraction-accept-all.test.mjs:51-53` (2026-08-25, nine days after the JOURNAL entry "A guard that pins a string passes while the behavior is wrong") asserts `row.dataset.xrDone = '1';[\s\S]{0,220}replaceChildren` and `'dismissed'\);\s*\n\s*row\.dataset\.xrDone = '1';` — pure implementation snapshots that fail on any refactor and pass on any behavior change; `tests/portal-inspector-opener.test.mjs:44-56` counts `titleEl.title = 'Inspect — raw event` occurrences as a proxy for "every row has a ⓘ". `seam-and-invariant-check` §3 requires a negative control; no test file records one.
**Claim:** these guards manufacture exactly the false confidence the skills warn about — they are green when behavior is wrong (E6) and red when behavior is fixed (JOURNAL 08-16, "third instance"). They exist because the code they guard cannot be imported (VERI-01).
**Fresh-eyes action:** admission rule for a source-grep guard, enforced by a meta-guard over `tests/`: (a) the guarded module is un-importable *or* the guard protects a normative document / the kind schedule; (b) the assertion names a **class** ("no `=== <single-id>` comparison in this function", "no vendor literal in any consent string"), never a token sequence; (c) a `// negative control:` comment names the bug that reds it; (d) a positive-sanity assertion precedes it. Migrate the reader/portal guards to executed tests or walk steps as blocks become importable; delete the rest on the record.
**ROAD_TO_1_0:** not listed (post-dates it).

### VERI-05 · 138 hand-rolled `chrome.*` stubs, none cited, no shared helper — stub honesty is 0%
**Harm 4 · GRANDFATHERED (userscript-port test style) · Effort M**
**Evidence:** 138 files define `globalThis.chrome =`; a 4-line-window scan for MDN / developer.chrome / JOURNAL citations finds **0**; `tests/helpers/` holds only `hostile.mjs` and `sse.mjs`; verification-engineer Standard 3 (cite the source; "a suite green against a wrong stub is worse than no suite"); E16 (JOURNAL 08-25) — no stub throws Chrome's `QuotaExceededError`, so a leak that filled `chrome.storage.session` was unobservable by 138 suites.
**Claim:** the suite's `chrome.*` semantics are whatever each file's author remembered; divergences are invisible until a user hits one.
**Fresh-eyes action:** one `tests/helpers/chrome-stub.mjs` exporting `makeChrome({ quotaBytes, sessionQuotaBytes, onMessageHandlers })` with documented semantics and citations (callback *and* promise forms of `storage.*.get/set/remove`; `QUOTA_BYTES` enforcement that throws the way Chrome does; `runtime.sendMessage` round-trip to a registered handler so a *service-worker handler can be executed in Node* — this alone gives `background/index.js` its first executed tests); replace the 138 copies file by file; a guard that no test file defines `globalThis.chrome =` inline.
**Payback:** ~12 h build; retires ~138 × ~20 lines of duplicated stub; makes E16's class testable.

### VERI-06 · SMOKE_TEST.md is a history, not an instrument
**Harm 4 · GRANDFATHERED (phase-driven) + GARBAGE (stale counts) · Effort M**
**Evidence:** 1,743 lines, 49 `##` sections, ~602 table rows; Standard-5 vocabulary appears on 10 rows (`needs-human-eyes`) and 11 (`agent-verifiable`) — ~580 rows unclassified; setup block `:241-242` "all seven bundles … 1018/1018"; the verification-engineer's own Standard 4 text cites "1277/1277 … 7 bundles" as the drift to ban — and the graduation ("regex-ban hardcoded counts") was never built; the walk ledger has 20 rows, all August 2026, none earlier than 08-11 — everything before the reset is unrecorded; "Not yet walked" (:41-50) lists LT.1–LT.14 whole, K9, K15, NIP-46; automator Standard 7 calls it "1,500+ lines of mostly hand-run steps". §7.7–7.16 marked "MUST be walked by hand" (:1151) though the witness is a hash.
**Claim:** no one can run this before a tag (B8: "two browser profiles, a paid API key, a NIP-07 signer, the Python companion and a paywalled article"), so it is not run, so the ledger is the only truth — and the ledger has no minutes and no pre-August history.
**Fresh-eyes action:** split per B8 into **`docs/GATE.md`** (≤30 rows; every row tagged exactly one of `machine` / `agent-live` / `human`; every `machine` row names its `tools/smoke/*.mjs` scenario; every `human` row is already in hand-to-maintainer format; the walk ledger with a **minutes** column at the top) and **`docs/SMOKE_APPENDIX.md`** (the 49 sections, retired-as-gate under Art. 3). Add `tests/smoke-doc-guards.test.mjs`: bans `\d+/\d+` test counts and any bundle enumeration; asserts every `machine` row's scenario file exists; asserts every row has exactly one tag.
**ROAD_TO_1_0:** B8 open; T4 items 1–2 open.

### VERI-07 · The CI gate set is thinner than the docs claim, and the punch list marks undone work as done
**Harm 4 · GAP + GARBAGE (false claims) · Effort S–M**
**Evidence:** `ci.yml` = node --check, esbuild, npm test, python parity, web-ext lint, web-ext build. Missing: version lockstep (claimed at `CLAUDE.md:256`, `CONTRIBUTING:139`; T4 item 3 open); the `fix:`-PR-touching-`src/`-but-not-`tests/` check (verification-engineer Standard 2 graduation, unbuilt); a static lint — **no ESLint config exists in the repo** and `node --check` is syntax-only, so E17's `ReferenceError` to a deleted identifier passed CI; a bare-`console.*` ratchet (205 in `src/`, convention at CLAUDE.md "Logging"); a bundle-size budget (`reader.bundle.js` 1.40 MB, `portal.bundle.js` 1.39 MB, `pdf.worker.bundle.js` 2.33 MB, `dist/` 32 MB with maps — nothing stops the next 400 KB); packaged-contents assertion (T4 item 6 open); the companion pytest job (T4 item 5 open — only the one normalizer file runs, `ci.yml:63-79`); the PR template's verification-layer / "Wire format:" section (T4 item 9 `[x]` — **not done**, `.github/pull_request_template.md` has neither heading).
**Claim:** a multi-thread workflow needs a gate every branch passes identically; today the gate is partly prose and partly false.
**Fresh-eyes action — the gate set, all required for merge:**
1. `node --check` (keep) → 2. **ESLint** minimal config: `no-undef`, `no-unused-vars`, `no-restricted-globals` for `console` outside `utils.js`/`page/*` with a *ratchet* (count may not rise; start at 205 and burn down) — ~2 h, catches E17's class statically → 3. build → 4. `npm test` → 5. python parity → 6. **lockstep** `package.json`==`manifest.json` (move from release.yml; 15 min) → 7. web-ext lint → 8. web-ext build + **packaged-contents assertion** (no `tests/`, `docs/`, `tools/`, maps) → 9. **bundle budget** per entry from `esbuild.config.mjs` metafile (fail on +10% vs main) → 10. **smoke walk** (VERI-02) → 11. **PR-body checks**: a `Verification layer:` line (unit / guard / machine-smoke / human-soak / none-because), and for `fix:` PRs either a `tests/` diff or a `no-test rationale:` line; a `Wire format:` line when any `*-publish.js` / `event-builder.js` / `metadata|audit|truth builders` changed. Fix the two false doc claims and the T4 checkbox in the same PR.
**Payback:** items 2, 6, 9, 11 are each ≤2 h; they replace review-comment toil that currently costs a round-trip per PR (continuous-improvement's "mechanical round-trip" trigger).
**ROAD_TO_1_0:** T4 items 3, 5, 6, 8, 9 open (9 mis-marked).

### VERI-08 · No canary pass exists; six platform handlers (2,540 LOC) are executed by nothing
**Harm 3 · GAP · Effort M**
**Evidence:** unexecuted: `platforms/youtube.js` (1,027), `twitter.js` (545), `substack-api.js` (384), `comment-extractor.js` (252), `platforms/index.js` (218, the dispatcher), `substack.js` (114); verification-engineer Standard 6 ("every handler has a canary URL recorded… before any release tag the agent-runnable pass runs the list… graduates to a checked-in canary manifest") — no manifest exists; the AW agent walk (2026-08-23) is the only recorded live exercise; JOURNAL 2026-04-19 "YouTube DOM arms race" — quarterly rot; E4/E5 found by a provider error message.
**Claim:** platform rot is detected today by a user's failed capture.
**Fresh-eyes action:** two rungs. (a) **Fixture snapshots**: `tests/fixtures/platforms/<site>.html` captured from real pages (bytes, not hand-written — the 08-15 lesson), driving each handler in Node with a stub document (jsdom is not present; the handlers already run against cloned nodes — a minimal DOM stub or `linkedom` as a devDependency) — this gives the six handlers their first executed tests (T4 item 10). (b) **`canary.yml`**, scheduled weekly + `workflow_dispatch`, not per-PR: the Playwright harness navigates a checked-in `tools/smoke/canary.json` (one URL per handler + one per provider request shape), captures via the `#xray:capture` marker with `captureAutomation` seeded ON, grades by the healthy-run console signature the handlers already emit (`SMOKE_TEST.md:148-160`), and opens/updates an issue on failure. Allowed to fail; never blocks merge (third-party surfaces).
**Payback:** (a) 8 h; (b) 8 h + ~30 min/quarter maintenance; catches quarterly rot before casework does — each rot event has cost a JOURNAL entry, a fix PR, and a soak.
**ROAD_TO_1_0:** T4 item 10 open.

### VERI-09 · Toil is invisible: no ledger, no minutes, so automation targets are chosen by annoyance
**Harm 3 · GAP · Effort S**
**Evidence:** `docs/TOIL.md` absent (automator Standard 1: "until it exists, JOURNAL entries serve" — they record *what* was walked, never minutes); walk ledger rows have Date / Walk / Result, no duration; maintainer's own account of testing things he does not care about.
**Claim:** without counts, the soak's cost, the SMOKE_TEST's cost, and the release-walk's cost cannot be compared with the build cost of any automation — every payback derivation in this report had to be estimated from row counts and commit timestamps.
**Fresh-eyes action:** add a `Minutes` column to the walk ledger (the ledger *is* the toil ledger — do not create a second document); hand-to-maintainer already asks "state the total time honestly" — record the reply. After four weeks the numbers decide the next rung.

### VERI-10 · The release preflight and the "release gate" exist only as prose
**Harm 3 · GAP · Effort S**
**Evidence:** `.claude/skills/README.md:82-86` ("`scripts/release-preflight.mjs` … is to-be-built; until it exists these run by hand"); automator Standard 9; `scripts/` holds `build-icons.mjs` and `set-version.mjs`; `CONTRIBUTING:151` still names the 49-section SMOKE_TEST as step 3 of a release; last tag v0.8.0 (2026-07-20); README:19 says v0.7.0.
**Claim:** a tag today is cut on memory; B8's "there is no release gate that can actually be run" is still true.
**Fresh-eyes action:** build `scripts/release-preflight.mjs` per the Standard-4 contract (prints usage, exits nonzero with one-line reason, non-interactive): lockstep, `CHANGELOG.md` section for the exact target version and not "Nothing yet", clean tree, build/test/lint/smoke green, GATE.md ledger has a dated `human` walk within N days, README version equals package version. With three entries in `scripts/`, add `tests/scripts-smoke.test.mjs` (spawn each with no args; assert nonzero + usage). Cross-reference from CONTRIBUTING step 3.
**Payback:** 4 h; runs ≥4×/year at tag time and on every "is main releasable?" question; each missed mechanical step has cost a botched or never-cut tag (JOURNAL 2026-07-03 v0.6.0; 2026-07-16 v0.7.0 push refused).
**ROAD_TO_1_0:** T4 items 7–8 open.

### VERI-11 · The "agent-runnable" vocabulary conflates two mechanisms and under-counts what machines can see
**Harm 3 · GRANDFATHERED (2026-04-21 MCP PoC) · Effort S**
**Evidence:** SMOKE_TEST.md:117-235 defines agent-runnable against a Chrome-MCP connector; `:177-190` "the reader tab opens outside the MCP-managed tab group, so the agent can't verify reader contents"; `:1650` "a row that needs [an extension page] is NOT agent-verifiable"; DC-1 was *retagged* from agent-verifiable to unit (`:1727`) for exactly that reason; meanwhile `ma6-walk.mjs` drives the portal — an extension page — from Playwright with no connector.
**Claim:** the classification vocabulary (verification-engineer Standard 5) has two values where three are needed; rows are being pushed to `human` because the *connector* cannot reach them, though Playwright can.
**Fresh-eyes action:** three tags — `machine` (Playwright/CI, any extension page, seeded profile, loopback relay), `agent-live` (the claude-in-chrome connector against real third-party sites: the AW rows, canaries), `human` (money, real relay, signer popups, judgment). Re-tag the gate rows under VERI-06; the seam skill's "hand what remains to the maintainer" then means only the third bucket.

### VERI-12 · Archive integrity §7.7–7.16 says "MUST be walked by hand"; its witness is a hash
**Harm 2 · GRANDFATHERED (2026-07-17 stack) · Effort M**
**Evidence:** SMOKE_TEST.md:1151-1178; each row's pass criterion is "hash identical" / "the published body is NOT empty" / "banner does not appear" — all observable by the harness (in-page `EventBuilder` as `ma6-walk.mjs:265-290` already does, or a recording loopback relay); `archive-reload-hash.test.mjs` simulates the state machine in Node; the section itself concedes "nothing here has been driven in a real browser".
**Claim:** a "cannot be smoked" claim that was never tested (First Principle 5); the four bugs this section memorialises are the highest-consequence class in the tool (a wrong body replaces the real article at the same NIP-33 coordinate), and they are verified by simulation only.
**Fresh-eyes action:** `tools/smoke/archive-integrity.mjs`: seed a published article whose body contains `5 * 3`, `that_is_it`, `[1]`, a line starting `14.`; drive Load archive → Publish (to a recording loopback relay) four times; assert the `x` tag never moves; attach a transcript; assert the body is non-empty and contains both; assert the banner is silent on re-capture. Retag `machine`.

### VERI-13 · Publish end-to-end has never been machine-observed on the happy path
**Harm 3 · GAP · Effort S**
**Evidence:** `ma6-walk.mjs:104` pins relays to `ws://127.0.0.1:1` (dead) — by design, so the only observed outcome is "Publish failed: no relay accepted it"; `nostr-client-query.test.mjs` and `publish-gate.test.mjs` test the pool and the gate with injected transports; no test or script has ever watched a signed event leave the service worker over a WebSocket and a relay answer `["OK",…,true]`, then the ledger stamp appear. The 2026-08-02 escape was on exactly this path.
**Claim:** the tool's core promise — "publishes to NOSTR" — is verified by argument.
**Fresh-eyes action:** `tests/helpers/relay.mjs` (~150 LOC): an in-process NIP-01 subset (`EVENT` → `OK`, `REQ`/`CLOSE` → stored events, `ws` is already transitively available via web-ext or add it as a devDependency) listening on `127.0.0.1:<random>`; the harness seeds `default_relays` to it; scenarios assert the relay *received* a valid, signature-verified event of the expected kind and the ledger stamped `confirmed`. Also enables the portal reconcile and network feed scenarios against known data. Safety unchanged: the profile's relay list is written by the harness before anything is clickable, and the guard `provider-host-pin`-style pins the URL to loopback.

### VERI-14 · `fix:` PRs can merge without a regression observer; the graduated CI check was never built
**Harm 2 · GAP · Effort S**
**Evidence:** verification-engineer Standard 2 ("Graduates to a CI check: a `fix:`-prefixed PR touching `src/` but not `tests/` fails unless the PR body contains a `no-test rationale:` line"); `ci.yml` has no PR-body step; `.github/pull_request_template.md` has no such line; the seam skill's scope-honesty clause says the walk-only class must be handed to the maintainer — but nothing records that a fix's observer is "human, weekly".
**Claim:** the escaped-bug→observer conversion is a norm with no enforcement, in a repo where the norm's own author (the skill) says silence is non-compliant.
**Fresh-eyes action:** fold into VERI-07 item 11 (a 20-line workflow step reading `github.event.pull_request.body`); add the two lines to the PR template.

### VERI-15 · Rows classified "no automated layer can observe this" deserve one spike each before they bind a human
**Harm 2 · GAP · Effort S (spike)**
**Evidence:** DC-3 (SMOKE_TEST.md:1729, "No automated layer can observe this") — MV3 service-worker teardown mid-job; Playwright exposes a CDP session on the extension context and CDP `ServiceWorker.stopWorker` / `Target.closeTarget` can terminate the worker; `ma6-walk.mjs:59-62` already obtains the worker handle. DC-4 (provider fetch of a hotlink-protected file) genuinely needs a live provider and money — correctly `human`.
**Claim:** "cannot be observed" was wrong four times in a row on 2026-08-02 and should be tested per row, not inherited.
**Fresh-eyes action:** a half-day spike: stop the worker via CDP between the provider submit and the poll in a scenario against a stubbed provider (the harness can route `api.assemblyai.com` to a local fake via `page.route`, but the SW's fetch needs `context.route` — verify) and assert the resume reuses the id. If it works, DC-3 and DC-11 move to `machine`; if not, record why in the row.

### VERI-16 · Committed walk outputs and hardcoded container paths are rot-in-waiting
**Harm 1 · GARBAGE · Effort S**
**Evidence:** `tools/smoke/ma6-01-case.png`, `ma6-02-expanded.png`, `ma6-03-reviewed.png`, `ma6-block.txt` (contains `(absent)` — the stale-selector result, committed), `ma6-event.json`, `ma6-pageerrors.txt`; `ma6-walk.mjs:31-34`; `tools/relay-probe.mjs` with the runbook results placeholder `EPISTACK_RUNBOOK.md:64`.
**Fresh-eyes action:** delete the outputs (CI artifacts replace them); env-resolved paths (VERI-02); decide `relay-probe.mjs` under the kill rule — keep as the pre-tag relay-retention step in the preflight, or archive with a JOURNAL line.

### VERI-17 · Test wall time is a strength to protect with a budget, not a fact to restate
**Harm 1 · KEEP · Effort S**
**Evidence:** 17.8 s measured; CLAUDE.md says "~16s"; B8 records three stale test counts in docs.
**Fresh-eyes action:** the preflight prints the count and time; no doc restates either (VERI-06's guard bans the numbers). A `--test-concurrency` budget assertion in CI (fail if `npm test` exceeds 60 s) keeps the loop fast as the executed set grows under VERI-01.

---

## Fresh-start design — what I would build today for non-technical research groups

**Three machine layers and one human batch. Nothing else.**

1. **Unit (`npm test`, ≤60 s).** Pure modules only — `src/shared/**`, importable reader/portal blocks. One shared `chrome-stub.mjs` with cited semantics and a quota model; one `relay.mjs`; `hostile.mjs` for every model/peer/import boundary. Source-grep is admitted only for normative documents, the kind schedule, and the positive-sanity-then-enforce shape. No test names a user-visible sentence as a regex; rendered strings are asserted by *calling the renderer with each member of the set* (E7, E11).

2. **Machine smoke (`npm run smoke`, ~3–5 min, required on every PR).** Playwright loads the unpacked extension into headless Chromium from `PLAYWRIGHT_BROWSERS_PATH`; a **seeded fixture profile** built through the bundled modules (one case, three archived articles — one generic-HTML capture with no `.markdown`, one YouTube-shaped with transcript, one PDF — extraction records in every review state, two claims, two local entities with *no* published claims, a local signing identity, relays pinned to the in-process loopback relay, flags set per scenario). Scenario files, one per gate row, each ≤150 lines, selectors by `data-xr` attributes:
   - `pages.mjs` — open all five extension pages, zero `pageerror`, ten bundles.
   - `capture.mjs` — a local static server serves fixture HTML; toolbar capture → reader opens with the right title/body; re-capture shows the archive banner only when the body differs.
   - `publish.mjs` — Publish from the reader → the loopback relay receives a signature-valid `30023` with the `x` tag equal to the reader's hash line → the ledger stamps `confirmed`; then the dead-relay negative (today's ma6 §7).
   - `archive-integrity.mjs` — VERI-12.
   - `extraction.mjs` — today's ma6 §2–§6.
   - `case-dashboard.mjs` — the People & organizations section renders from *local* entities (E15); chapter rows open a reader (E14).
   - `transcribe.mjs` — provider routed to a local fake via `context.route`; picker greys/hides per flag; consent names the vendor of the selected engine (E6/E7); the charge banner survives the success toast (E9); adoption preserves the generic body (E10).
   - `options.mjs` — signing method switch, backup export → import round-trip through the real UI, diagnostics self-test.
   - `sidepanel.mjs`, `network.mjs` — load + one primary action each.
   Outputs (screenshots, page errors, received events) go to CI artifacts. A guard asserts every `data-xr` the scenarios reference exists in `src/`.

3. **Live canary (`canary.yml`, weekly, never merge-blocking).** The same harness against `tools/smoke/canary.json` (one real URL per platform handler, one request shape per provider with a throwaway key in a secret, one public relay read-only); graded by console signatures; failures open an issue labelled `rot`. This is the standing answer to quarterly platform drift.

4. **Human batch (weekly, 30–45 min, recorded with minutes).** Only rows tagged `human` in `docs/GATE.md`: money, real relay publish, NIP-07/NIP-46 popups, SW-teardown until VERI-15 moves it, and "does it read true". Delivered as one hand-to-maintainer list per week; the reply is numbers; the ledger row is the record.

**CI gate set for the multi-thread workflow** (every branch, identical): node --check → ESLint (`no-undef`, console ratchet) → build → unit → python parity → lockstep → web-ext lint → web-ext build + packaged-contents → bundle budget → machine smoke → PR-body checks (`Verification layer:`, `Wire format:`, `no-test rationale:` for `fix:`). Required checks on `main`; branches rebase before smoke (a merge queue if GitHub's plan allows). A PR in the machine-only class merges on green; a human-class PR merges on green and carries `soak:pending` until the weekly batch clears it. The maintainer's merge stays the ratifying act (Art. 11); the *waiting* stops being the gate.

**What I would not build:** a per-PR human walk; a 49-section smoke document; per-file chrome stubs; guards that pin token sequences; a Firefox leg in the per-PR gate (Playwright cannot load MV3 extensions in Firefox reliably — keep Firefox as a pre-tag human row until T5 decides it); a "toil score".

**Sequencing (each its own PR, each ≤2 days):** (1) VERI-02 harness in CI with `pages.mjs` + today's ma6 — the net; (2) `relay.mjs` + `publish.mjs` (VERI-13); (3) GATE.md split + tag vocabulary + doc-count guard (VERI-06/11); (4) tiered soak ruling (VERI-03, maintainer); (5) ESLint + lockstep + PR-body checks (VERI-07); (6) `chrome-stub.mjs` + first executed background-handler tests (VERI-05); (7) platform fixtures + canary (VERI-08); (8) preflight script (VERI-10); then the reader/portal split proceeds under the net.

---

## Questions for the maintainer

**Q1. Replace the per-PR soak with the tiered gate (machine-only merges on green; human-class batched weekly)?**
Provenance: maintainer ruling 2026-08-23 (CONTRIBUTING:226), made when no browser layer was in CI. Recommended default: **yes, the day VERI-02's smoke job is required on `main`** — until then the soak stands, but with a minutes column from today (VERI-09).

**Q2. Which change classes keep human eyes?** Recommended default: money against a real provider; publish to a real relay; NIP-07/NIP-46 popups; service-worker teardown mid-job (until the VERI-15 spike); any live third-party DOM/API; and any row whose pass criterion is a judgment ("reads true", "looks right"). Everything else is `machine`.

**Q3. Should the smoke job block merge from its first day, or be advisory for two weeks?** Provenance: none (new). Recommended default: **required from day one** for `pages.mjs` (zero page errors, ten bundles — cannot false-alarm), advisory for the scenario walks for two weeks, then required; the automator kill rule (two false alarms, no true positive) governs after that.

**Q4. Split SMOKE_TEST.md into GATE.md (≤30 rows) + an archived appendix?** Provenance: B8 / T4 item 1 (audit recommendation, unratified). Recommended default: yes, under Art. 3 — the appendix is retired as a gate, not deleted; the ledger moves to GATE.md with its minutes column.

**Q5. Is an in-process loopback relay acceptable in the harness (vs the dead port)?** Provenance: `ma6-walk.mjs`'s safety note (agent decision 2026-08-02). Recommended default: yes — the profile's relay list is written to `ws://127.0.0.1:<port>` before any page is clickable and a guard test pins the harness to loopback literals, so nothing can reach a public relay; the gain is the first machine observation of a confirmed publish.

**Q6. Delete the committed walk outputs and the Firefox PR-template checkbox?** Provenance: outputs — agent habit; checkbox — pre-reset CONTRIBUTING. Recommended default: delete both; Firefox becomes one `human` row in GATE.md pending T5.

**Q7. Adopt the source-grep admission rule (class-shaped assertion + negative control + un-importable-or-normative) and enforce it with a meta-guard?** Provenance: seam-and-invariant-check §3 (agent-written 2026-08-23 from maintainer-found bugs) — the rule exists; enforcement does not. Recommended default: yes; existing guards get one sweep, and any that cannot be rewritten as a class are deleted on the record when their module becomes importable.

**Q8. Add ESLint (`no-undef`, `no-unused-vars`, console ratchet) to CI?** Provenance: none — the repo has never had a linter beyond `web-ext lint` and `node --check`. Recommended default: yes, minimal config, ratchet starting at 205; E17 is the concrete bug it would have caught for ~2 hours of build.

**Q9. Should the reader/portal `index.js` split wait for the harness?** Provenance: architect lens (structural), ROAD_TO_1_0 T6/T7 unstarted. Recommended default: yes — do VERI-02 first; refactoring 8,294 lines with only grep-guards as the net is how the August escapes happened.

**Q10. Who records minutes?** Provenance: automator Standard 1 (agent-written). Recommended default: the agent, from the maintainer's reply ("that took ~25 min") — nothing else is asked of the human.

# Architect lens — fresh-eyes audit of X-Ray (2026-09-05)

Tree: /home/user/xray at origin/main c1e652c. 247 src files / 93,243 LOC. 2878 tests green. Every number below was measured on this tree (scripts: `scratchpad/audit/importgraph.mjs`); `file:line` cites are to this commit.

Scope of this lens: the four execution contexts and the `xray:*` bus, the `src/shared` module graph, the five surface entry files, storage (chrome.storage + the five IndexedDB databases), the bundle graph vs manifest, and the restructuring that would let several agents work in parallel without colliding. Whether a feature should exist is product-manager's; wire semantics are ecosystem-pm's; migration mechanics are schema-evolution's — cited, not restated.

---

## Verdict

The skeleton is sound and the flesh has grown without a skeleton of its own. The four-context separation actually holds: both `src/page/` files import nothing (importgraph: `page/api-interceptor.js imports []`, `page/nip07-bridge.js imports []`), the content bundle closes over 34 shared modules and never reaches `nostr-client.js` or `llm-client.js`, every emitted kind literal sits in a builder or `*-publish` module, and the manifest/HTML shells reference only `dist/*.bundle.js` plus the sanctioned `src/page/nip07-bridge.js`. `publish-gate.js` is now a real choke point whose `confirmedOk` is consumed by all four portal callers (ROAD_TO_1_0 B2 — closed). These are the load-bearing walls and they are good.

Inside those walls, however, there is no structure at all. `src/reader/index.js` is 8,294 lines, 149 top-level functions, 82 imports, 103 bare `console.*`, with a 1,574-line `publish()` (6026–7600) containing 109 `if` branches and 44 `try` blocks that orchestrates ~17 event families behind 7 feature-flag reads — and **no test imports it**; the 10 tests that name it `readFileSync` the source and grep strings. Its composite debt score (git churn × LOC × JOURNAL mentions) is 6,104 against 180 for the next file: one file is 34× the rest of the tree's hotspot. The service worker is a single 950-line `if`-chain of 45 handlers (`background/index.js:448–1398`, 40 held-open channels) with no registry and no guard; of the 77 `xray:*` literals in `src/`, only 49 are messages — 19 are storage keys, 8 are context-menu ids, 1 is a KDF domain string. `src/shared/` holds 128 flat files of which 57 (≈18,200 LOC) have exactly one importer and 2,572 LOC are DOM-building modals; there is no ownership boundary anywhere an agent could be told "you own this, stay inside it". Storage is read three different ways (`Storage` facade, options' private `storageGet/Set`, seven hand-rolled `chrome.storage.local.get(['preferences'])` + `JSON.parse` copies) under three key-naming conventions, and five IndexedDB databases exist because five phases each created one — `xray-audits` v7 now holds nine stores of which six are not audits.

The prior architect lens (ROAD_TO_1_0 §architect, 2026-08-09) named four description-layer defects by `file:line` — `esbuild.config.mjs:3` "seven bundles" (ten), `api-interceptor.js:14–19` "NOT auto-injected via manifest" (manifest.json injects it at `document_start`), `README:381/406` "2100 tests" (2878), and CLAUDE.md's "e.g." message list (17 of 49). **All four are still wrong a month later.** That is the single most important structural fact for the maintainer's question "why isn't documentation always up to date?": the architect discipline's Standard 8 ("the description layer is load-bearing") and Standard 2's "graduates to a guard test the first time review catches a breach" are prose. The breach was caught; nothing graduated; nobody owns graduation. Prose standards rot at exactly the rate PRs land, and 50 PRs landed. The fix is not more prose: generate the description layer from a registry and guard it, the way `discipline-docs.test.mjs` already guards `discipline-standards.html`.

Fresh eyes: I would not rewrite anything. I would (0) pin today's import graph and message set in a guard test so the state cannot get worse, (1) add a message registry and a storage-key registry as data files that the guard and the docs both derive from, (2) convert the worker if-chain into a handler map split by domain, (3) extract the *pure planning* half of `publish()` so it can be tested without a DOM, and (4) `git mv` the 57 single-caller shared modules into the surface or domain directory that owns them. Each step is a strangler step that keeps 2878 green; after step 1 the collision detector exists and agents can be assigned directories.

---

## What is good (KEEP)

- **Four-context separation with MAIN-world islands.** `src/page/api-interceptor.js` and `src/page/nip07-bridge.js` import nothing (importgraph output); `nip07-bridge.js` is loaded unbundled per manifest.json:96–107 and `web_accessible_resources`:115–121. Standard 2's island rule holds.
- **The content bundle stays thin and socket-free.** 37 files / 12,096 LOC; `CONTENT bundle imports nostr-client? false`. The CSP rationale for the worker-side pool is respected by the bundle graph (one exception, ARCH-6).
- **Kind emission confined to builders.** Every `kind:` literal that *emits* is in `event-builder.js`, `truth-builders.js`, `metadata/builders.js`, `audit/builders.js`, or a `*-publish.js` module. Non-builder hits are read filters (`kinds: [...]`) and dispatch (`item.kind === 30062`) — see ARCH-14 for the naming point, but Standard 4 holds for emission.
- **`publish-gate.js` as a real choke point.** `gatePublish` returns `{results, confirmedOk, journaled}` and all four portal call sites now read `confirmedOk` (`portal/entity-page-block.js`, `extraction-block.js`, `inspector.js`, `synthesis-block.js` — 2 hits each). B2 closed; this is the pattern to replicate.
- **`session-articles.js` UUID handoff via `chrome.storage.session`** (`background/index.js:555,580,1768`; `reader/index.js:236,277`) — the right storage area for one-shot capture payloads, with an honest quota note at `session-articles.js:4–8`.
- **`workspace-keys.js` is already a registry.** `WORKSPACE_CONTENT_KEYS` (21 keys), `WORKSPACE_DATABASES` (3), `DERIVED_CACHE_DATABASES` (2) at `workspace-keys.js:1–40` — one list that `storage.js:14`, `backup.js:51`, `identity-profiles.js:41` all consume. The storage-key registry proposed in ARCH-5 should *extend this file*, not compete with it.
- **`feature-flags.js` single `FLAGS_DEFAULTS`** (`metadata/feature-flags.js:28`, 20 flags, one `xray:flags` override key at :305). One registry, one storage key.
- **PR #374's direction** (`shared/llm-jobs.js`, `xray:llm:job:start/status`): long LLM passes as jobs polled by id instead of held-open message channels is the correct MV3 pattern (JOURNAL :1318, :4199, :6060 are all held-open-channel bugs). Keep the mechanism; see ARCH-11 for where it should land.
- **The guard-test culture exists.** `constitution-guards`, `custody-guards`, `lens-guards`, `publish-transport-guard`, `t1-data-integrity`, `t2-security-surfaces` (B5/B6/B18 pinned at `tests/t2-security-surfaces.test.mjs:16–81`). The mechanism to enforce structure is already in the repo; it has simply never been pointed at structure.
- **No framework, no TypeScript, ten esbuild entries** (`esbuild.config.mjs:63–128`). Correct for a single-maintainer MV3 extension; the architect skill's own failure-mode clause is right that a TS migration would be astronautics.
- **`platforms/` handler + detector seam** (`platforms/index.js` is the only importer of the 10 handlers; `content/ui.js` is its only importer). A new site is one handler + one detector case.
- **`crypto.js`** — 39 importers, BIP-340 vectors, no alternatives hand-rolled.
- **`tools/smoke/ma6-walk.mjs`** — proof that the browser layer is Playwright-drivable. Not this lens's call to put it in CI, but it is the missing observer for every surface finding below.

---

## Grandfathered

Each: the thing — the decision that grandfathered it — why the premise is gone.

- **`preferences` is a JSON *string* inside `chrome.storage.local`, and `Storage.set` JSON-stringifies every value** (`storage.js:8` "exports/imports remain compatible"; `:81–97`). — Phase 2 userscript port, to keep v4 export files loadable. — The userscript is retired and its `publications`/`people`/`organizations` sub-objects were removed 2026-07-01 (CLAUDE.md). The shape now forces seven hand-rolled `JSON.parse` copies (ARCH-5). Keep the on-disk shape (one-way door) but route every read through one accessor.
- **`Storage.entities` / `Storage.articleCache` stubs** (`storage.js:347–412`). — Phase 2/4/7 façades for the v4 event-builder. — K14, ratified killed 2026-08-09, still in tree.
- **`xray:forward:*` wildcard** (`background/index.js:477–495`, sender `options/index.js:1862`). — Popup era ("historically used by the popup"). — No popup exists (CLAUDE.md, manifest has no `default_popup`). K4, ratified killed, still live.
- **Archive DB v2 stores `annotations`/`factchecks`/`ratings`/`helpfulness`/`trust_graph`** (`archive-cache.js:173–201`). — Phase 9a crowdsourced-metadata layer. — K1 killed the layer; the stores are still created on every fresh install. Removal is a v4 `deleteObjectStore` ladder — schema-evolution's review.
- **`xray-audits` as the database name for case briefs, corpus extracts, entity pages, article extractions** (`audit/audit-cache.js:15, 134–169`). — Phase 13 named it for audits; Phases 20–28 kept adding stores because a DB already existed. — The name now misdescribes six of nine stores. The *name* is a one-way door (users' machines); the *module* name and docs are not.
- **Five IndexedDB databases** (`xray-archive` v3, `xray-audits` v7, `xray-events` v2, `xray-network` v1, `xray-portal` v1). — Each phase created its own (7, 13, 29-era journal, 25, 12). — No decision ever chose five; accretion did. `xray-portal` and `xray-network` are byte-identical shapes (`events` + `meta`; `portal-cache.js:77–86`, `network-cache.js:80–87`) and are *derived* caches — mergeable today at no migration cost.
- **`src/shared/` as one flat directory** (128 files). — Phase 1 layout when shared held ~10 modules. — At 128 files with 57 single-caller modules, "shared" no longer means shared; it means "not sure where this goes".
- **The reader as *the* publish surface** (`reader/index.js:6026–7600` builds ~17 families). — Phase 2 design: capture → reader → publish, one article at a time. — Since Phases 23/MA.6/EP the *portal* also publishes (`corpus-publish.js`, `extraction-publish.js`, `entity-page-publish.js` via `publish-gate.js`). There are two publish orchestrators with two styles; the reader's predates the gate.
- **`api-pattern.js` "canonical twin" of the inline api-interceptor matcher** (`shared/api-pattern.js:1–9`). — Phase 8a: test the logic without JSDOM. — Zero `src/` importers; the "twin" is the unit-tested one and the inline copy is the one that runs. Same drift class CLAUDE.md names for the normalizer parity, without the parity fixture.
- **`xray:` prefix on storage keys** (`xray:flags`, `xray:llm:key`, `xray:transcriber:*`, `xray:user`, `xray:article:`, …, 19 keys). — Early habit; the prefix started as the *message* namespace. — Now a grep for messages returns 77 and only 49 are messages. Storage keys are one-way (don't rename); menu ids are two-way (rename).
- **Two MAIN-world envelope conventions** — `nip07-bridge.js:45` `{tag, direction, id, ok, result}` vs `api-interceptor.js:56` `{__xr: NONCE, ...envelope}`. — Written in different phases (2 and 8a). — Harmless individually; together they mean two receiver-side validators to audit (security-threat-modeler's), and no shared vocabulary to point a new MAIN-world script at.
- **2-space indentation in ported files** (CLAUDE.md Conventions). — "so userscript diffs stay readable". — The userscript is not diffed against any more. Grandfathered *and harmless*: the architect skill's failure-mode clause is right that tidying this is astronautics. Leave it.
- **The moral-lens session-ONLY cache** (`lens-engine.js:14–16`, "deliberately DO NOT use the house storage.session || storage.local fallback"). — Phase 16 design (agent-drafted, amended 2026-07-03). — This is a *firewall* whose provenance is a design doc, not a maintainer ruling on storage placement; it also forks the storage idiom (`:345–349` re-implements area selection). Not this lens's call whether it stays — see Questions §Q7; PR #366's inventory grades the lens firewalls.

---

## Garbage

Dead, duplicated, or actively misleading. Removal is a two-way door unless marked.

- `src/shared/api-pattern.js` — zero `src/` importers (importgraph: `ZERO src callers: shared/api-pattern.js 55`). Its one test pins a copy that never runs.
- `xray:scholar:crossref` handler (`background/index.js:1207`) — no sender anywhere in `src/`; `crossref.js:10` says "see the wiring notes in the PR". An orphan handler shipped waiting for a caller.
- `xray:forward:*` (`background/index.js:477–495` + `options/index.js:1862`) — K4, ratified.
- `Storage.entities` / `Storage.articleCache` (`storage.js:354–360, 408–412`) — K14, ratified.
- `esbuild.config.mjs:3` "Produces seven bundles" — ten are built (`:63–128`). Flagged 2026-08-09; still wrong.
- `src/page/api-interceptor.js:14–19` "this script is NOT auto-injected via manifest content_scripts" — `manifest.json:80–95` injects it at `document_start` on IG/FB/YT. Flagged 2026-08-09; still wrong.
- `README.md:381, :406` "2100 passing" — 2878. Flagged 2026-08-09; still wrong.
- Duplicate `AUDIT_DRAFT_PREFIX = 'xray:audit:draft:'` — `shared/audit/corpus-audit.js:24` (exported) and `reader/index.js:4383` (re-declared). Standard 10 breach: a duplicated schema constant.
- Duplicate `'xray:user'` key name — `sidepanel/index.js:51` `USER_KEY_NAME` and `portal/identity.js:34` `SYNC_KEY_NAME` (the comment even points at the other file).
- `options/index.js:57–125` private `storageGet`/`storageSet`/`storageRemove` — a second copy of `storage.js`'s JSON-stringify wrapper.
- Seven copies of `chrome.storage.local.get(['preferences'])` + `JSON.parse` — `sidepanel/index.js:501, 1652–1658, 1718`; `reader/index.js:1128, 7821`; `network/index.js:83`; `background/index.js:51`; `portal/inspector.js:421`. `Storage.preferences` exists (`storage.js:233ff` region).
- 205 bare `console.*` in `src/` (reader/index.js 103, youtube.js 18, instagram.js 16, background 9) against the `Utils.log` convention — T8 item, open.
- K1 object-store creation at `archive-cache.js:173–201` (one-way to *remove*; needs a v4 `deleteObjectStore` ladder under schema-evolution).

---

## Findings (ranked by harm to wide release)

Effort: S < 1 day, M 1–3 days, L > 3 days of agent work plus maintainer soak.

### ARCH-1 · `reader/index.js` is a 8,294-line god-module with an untestable 1,574-line `publish()` — harm 5

**Evidence.** `wc -l` 8,294; 149 top-level `function`/`async function` declarations; 82 `import` lines; `publish()` at `:6026–7600` = 1,574 lines, 109 `if`/`else if` branches, 44 `try` blocks, reads 7 flags inline (`isEnabled('entityCorpusPublishing')` ×3, `assessmentPublishing` ×2, `truthAdjudicationPublishing`, `platformAccountPublishing`, `forensicPublishing`, `epistemicAuditing`), calls 17 distinct builders (`EventBuilder.buildArticleEvent` … `buildIntegrityFindingEvent`), 7 `toast(` sites. The rest of the file carries ~20 unrelated responsibilities by function map: article load/adopt (`:208–536`), PDF load (`:536`), transcribe flow + engine picker + cfg (`:2242–2856`), render (`:2964`), claims/extraction/findings bars (`:3170–3430`), media (`:3575–3673`), vision (`:3834–3955`), audit run + drafts (`:4343–4552`), lens panel (`:4732–4866`), four platform headers (`:5117–5364`), Substack (`:5684–5778`), comments (`:5900–5945`), publish (`:6026`), delegation (`:7629`), publish summary (`:7857`). Zero test files `import` it; 10 `readFileSync` it (e.g. `tests/publish-transport-guard.test.mjs`, `tests/picker-visibility.test.mjs`). Composite hotspot score 6,104 (churn 32 × 8,294 LOC × (22 JOURNAL mentions + 1)) vs 180 for `background/index.js`. JOURNAL `:5855–5875` documents a family-setup failure that a per-item guard could not catch because everything is one function.

**Claim.** Every agent touching capture, transcription, publishing, audits, vision, lens, or platform headers edits the same file; the file cannot be unit-tested because DOM and orchestration are fused; therefore parallel work on the reader collides by construction and its correctness is observable only by the maintainer's browser. This is the structural root of the "green while wrong" cluster.

**Fresh-eyes action.** Strangler, not rewrite. (a) Extract a *pure* `planPublish(state, flags) → PublishPlan` (the list of event families + their inputs) into `reader/publish/plan.js`; test it with fixtures — no DOM. (b) Move each family's build+gate+journal into `reader/publish/<family>.js` (article, claims, entities, assessments, truth, forensic, audit, accounts, summary), each taking the plan and returning `{confirmedOk, results}` via `publish-gate.js`. (c) Then peel the non-publish responsibilities into `reader/<area>.js` (transcribe, vision, lens, platform-headers, substack, comments) — several already exist as siblings (`transcribe-flow.js`, `media-modal.js`, `llm-review.js`); this is finishing a move that was started. (d) Sweep the 103 bare `console.*` as the last commit.

**Effort.** L (three PRs; each keeps 2878 green because nothing imports the file today — add plan tests as the first new observer). **ROAD_TO_1_0.** T8 "post-1.0 candidates … extract publish() into per-family modules" — open; I disagree with "post-1.0": it is the precondition for parallel agents, not a nicety.

### ARCH-2 · The five surfaces are structurally untestable, so the suite cannot see the class of bug the maintainer keeps finding — harm 5

**Evidence.** Of the 38 test files that import `src/` modules, 32 import `shared/` and 2 import `reader/` helpers; **none** import `reader|options|sidepanel|portal|network|background|content/index.js`. The 10 tests that name those files use `readFileSync` (source-grep) — `tests/portal-case-imports.test.mjs` (readFile ×2, import ×0), `portal-tab-layering`, `session-articles`, `portal-inspector-opener`, `portal-string-truth`, `engine-vocabulary`, `picker-visibility`, `publish-transport-guard`. The surface files fuse `document.*` with orchestration (`reader/index.js` 149 functions; `sidepanel/index.js` 2,242 lines / 59 functions; `options/index.js` 1,989 / 66; `portal/index.js` 1,497 / 34; `background/index.js` 1,875 / 16 with the dispatcher inline). Briefing: JOURNAL records green-while-wrong on 2026-08-16 ×4, 2026-08-13 ×2, 2026-08-02.

**Claim.** The architecture places every decision the user sees inside DOM-bound modules no test can import. The verification gap is architectural before it is a test-writing gap: there is nothing importable to test.

**Fresh-eyes action.** Adopt one rule for every surface: `index.js` is *wiring only* (query elements, attach listeners, call functions); every decision lives in an importable module with no `document` reference. Start where the failures cluster — `reader/publish/plan.js` (ARCH-1), a `background/dispatch.js` handler map (ARCH-11), `options/settings-model.js` (flag/pref reads). A guard test (`tests/structure-guards.test.mjs`) asserts each surface `index.js` shrinks monotonically (pin today's line count as the ceiling) — the cheapest observer that a strangler is actually strangling. Which browser-level observer covers the residue is verification-engineer's call; `tools/smoke/ma6-walk.mjs` shows the layer is automatable.

**Effort.** M for the guard + first two extractions; L cumulative. **ROAD_TO_1_0.** B8 (release gate) partially open; the verification-engineer lens owns the gate — this finding supplies the structural precondition.

### ARCH-3 · The `xray:*` bus has no registry: 45 handlers in one if-chain, 77 literals of which 49 are messages, one orphan handler, one ratified-dead wildcard, no guard — harm 4

**Evidence.** Handler sites: `background/index.js:456–1381` (45 `message.type ===` branches inside one `chrome.runtime.onMessage.addListener` at `:448`; 40 `return true` held-open branches; 118 `sendResponse(` calls) and `content/index.js:242–275` (4: `xray:capture`, `xray:capture:transcribe`, `xray:getPubkey`, `xray:sign`). Literal census (`grep -rhoE "xray:[A-Za-z0-9:_.-]+" src`): 77 distinct. Classification: **49 bus messages**; **19 storage keys** (`xray:article:` session, `xray:audit:draft:` local, `xray:diagnostics`, `xray:flags`, `xray:lensread:` session, `xray:llm:{key,model,suggest_kinds}`, `xray:lmstudio:{url,model}`, `xray:options:backup-report`, `xray:transcribe:job:`, `xray:transcriber:{assemblyai:key,deepgram:key,engine,port,token}`, `xray:user`); **8 context-menu ids** (`MENU_IDS`, `background/index.js`: `xray:open-capture`, `xray:transcribe-capture`, `xray:open-entities`, `xray:open-portal`, `xray:open-network`, `xray:open-pdf`, `xray:open-settings`, `xray:capture-tips`) + `xray:separator-1` + command id `xray:toggle` (manifest.json:130); **1 KDF domain** (`identity/platform-account.js:52` `'xray:platform-account:v1:'`); 1 retired (`xray:llm:suggest`, UA.3). Naming pairs that look like duplicates but are menu-id/message twins: `xray:open-portal`↔`xray:openPortal`, `open-entities`↔`openEntities`, `open-network`↔`openNetwork`, `capture-tips`↔`openCaptureTips`. Orphan handler: `xray:scholar:crossref` (`:1207`, no sender). Ratified-dead wildcard still live: `xray:forward:*` (`:479`, sender `options/index.js:1862`; K4). No module exports message names (`grep -rl "MESSAGE_TYPES|MSG_TYPES" src tests` → none). No test asserts send-site ↔ handler coverage. CLAUDE.md names 17 types as "e.g.".

**Claim.** Adding a cross-context call today means inventing a string, adding an `if` to a 950-line chain, and remembering to update prose. Two agents adding messages in parallel collide in the same function; a typo in a send site fails silently as `{ok:false, error:'unknown message type'}` (content) or hangs (worker). The architect skill's Standard 2 says this "graduates to a guard test the first time review catches a breach" — the breach was recorded 2026-08-09 and nothing graduated.

**Fresh-eyes action.** `src/shared/bus/messages.js`: `export const MESSAGES = Object.freeze({ 'xray:relay:query': { context: 'background', kind: 'request' }, … })` for all 49, plus `export function send(type, payload)` that throws on an unregistered type. Guard test: every `type: 'xray:…'` literal in a `sendMessage` call is in the registry; every registry entry has exactly one handler in its declared context; every handler branch has a registry entry (kills the orphan). Generate CLAUDE.md's message list from it (`npm run docs:bus`) with a drift guard modelled on `tests/discipline-docs.test.mjs`. Rename the 8 menu ids to `menu:*` (two-way); leave storage keys (one-way) and document the prefix rule.

**Effort.** S for registry + guard; the docs generator S. **ROAD_TO_1_0.** T8 "the xray:* message registry" — listed as post-1.0, open. K4 — open.

### ARCH-4 · The description layer is wrong in four load-bearing places that were all cited by file:line a month ago — prose standards have demonstrably failed — harm 4

**Evidence.** `esbuild.config.mjs:3` "seven bundles" vs ten `configs` (`:63–128`). `src/page/api-interceptor.js:14–19` "NOT auto-injected via manifest" vs `manifest.json:80–95` (`content_scripts[2]`, `world: MAIN`, `run_at: document_start`). `README.md:381,406` "2100" vs 2878. CLAUDE.md message list: 17 of 49. `docs/ARCHITECTURE.md` does not exist. All four defects appear verbatim in ROAD_TO_1_0 §architect (2026-08-09). ~50 PRs merged since. The only description docs that stay current are the *generated* ones: `docs/discipline-standards.html` under `tests/discipline-docs.test.mjs`.

**Claim.** Agents boot from CLAUDE.md and file headers; a wrong header at the top of `api-interceptor.js` teaches every new agent the wrong injection model. The maintainer asked "why isn't documentation always up to date?" — because the architect discipline (and CLAUDE.md's own convention) makes currency a *review* obligation with no enforcement point, exactly the failure Standard 7 forbids for code invariants.

**Fresh-eyes action.** Make the description layer derived where it can be: bundle list from `esbuild.config.mjs` (a test asserts the header comment count equals `configs.length` — or delete the count from the comment); message list from the registry (ARCH-3); test count from `node --test` output or deleted from README; injection model asserted by a test that reads `manifest.json` `content_scripts` and the file header. Fix the four now (S). Add the graduation rule as a skill-README seam: *when a review report cites a description defect, the same PR adds the guard* — that is the missing owner.

**Effort.** S. **ROAD_TO_1_0.** B9 (front door misstates) — partly open; "docs/ARCHITECTURE.md" — T8, open.

### ARCH-5 · Storage is accessed three ways under three naming conventions with no key registry — harm 3

**Evidence.** Access styles: (1) `Storage` facade (`storage.js:81–97`, JSON-stringifies values, `mapKey` workspace remap); (2) `options/index.js:57–125` private `storageGet/storageSet/storageRemove` re-implementing (1); (3) seven raw `chrome.storage.local.get(['preferences'])` + `JSON.parse` copies (`sidepanel/index.js:501,1652–1658,1718`; `reader/index.js:1128,7821`; `network/index.js:83`; `background/index.js:51`; `portal/inspector.js:421`) plus raw reads of `LLM_SUGGEST_KINDS_STORAGE` (`reader/index.js:4090`, `options/index.js:1396`) and `AUDIT_DRAFT_PREFIX+hash` (`reader/index.js:4392–4422`). Key conventions: ~28 `snake_case` (`preferences`, `local_primary_identity`, `local_keys`, `identity_profiles`, the 21 `WORKSPACE_CONTENT_KEYS`, `workspaces`, `active_workspace`, `forensic_baselines`, `lastLookedAt`, `owned_keys_manifest_hash`), 19 `xray:`-prefixed, 1 `xr_` (`content/index.js:225` `xr_signing_state`). Duplicated constants: `AUDIT_DRAFT_PREFIX` (`corpus-audit.js:24` / `reader/index.js:4383`), `'xray:user'` (`sidepanel/index.js:51` / `portal/identity.js:34`), `'local_primary_identity'` literal in 5 files (`backup.js:132,365`; `identity-profiles.js:51,212`; `options/index.js:86,347,362,553`; `storage.js:233–267`). `chrome.storage.onChanged` listened in exactly 2 places (`background`, `sidepanel`) — cross-surface state sync is otherwise reload-based. Backup's `EXCLUDED_STORAGE_KEYS`/`CREDENTIAL_STORAGE_KEYS` (`backup.js:125–132`) and `identity-profiles.js:51–61` each hand-list keys.

**Claim.** A new key today is a string typed in ≥3 files (reader, backup exclusion list, identity-profiles clear list). Backup/merge correctness (B3/B4 lineage) depends on those lists agreeing by hand. Two agents adding keys collide in `backup.js` and `identity-profiles.js`.

**Fresh-eyes action.** Extend `workspace-keys.js` into the single key registry: `KEYS = { preferences: {scope:'global', serialized:true, backup:'include'}, local_primary_identity: {scope:'global', backup:'never', credential:true}, … }`. `backup.js` and `identity-profiles.js` derive their lists from it (guard: no key literal outside the registry). Replace the 7 raw `preferences` readers with `Storage.preferences.get()`; delete options' private layer. Do **not** change on-disk shapes (JSON-string values stay — one-way door; Q2).

**Effort.** M. **ROAD_TO_1_0.** B3/B4 closed per T1; K14 open; this is the T8 "collapse the seams" storage half — open.

### ARCH-6 · Extension pages open relay sockets directly, bypassing the worker pool the architecture exists to protect — harm 3

**Evidence.** `shared/entity-sync.js:43` imports `NostrClient`; `:54` `directTransport = (relays, event) => NostrClient.publishToRelays(...)`; `:247, :400, :465` `NostrClient.queryRelays(...)`. `entity-sync.js` is imported by `sidepanel/index.js` and `network/index.js` (importgraph: `shared/entity-sync.js | network,sidepanel`), so the sidepanel and network bundles each carry their own relay client. `shared/confirmed-publish.js:17,41` also defaults to `NostrClient.publishToRelays`. `shared/nsecbunker-client.js:26` opens a `WebSocket` and is in the content bundle (`content,options,shared`) — on a CSP-strict page that socket is exactly what CLAUDE.md §2 says cannot work. Meanwhile `xray:relay:query`/`xray:relay:publish` handlers exist (`background/index.js:1344,1363`) and `network/index.js:99`, `sidepanel/index.js:532` already use them for other queries.

**Claim.** The architecture's one stated placement argument (relay pool in the worker because of CSP and tab lifetime) is contradicted in three modules; every relay-behavior fix (timeouts, per-relay outcome, NIP-65 widening) must be made twice. CLAUDE.md's description of the pool is therefore also wrong.

**Fresh-eyes action.** Route `entity-sync.js` and `confirmed-publish.js` through `xray:relay:*` messages (the seam exists); make `nsecbunker-client.js` a worker-side signer transport behind `xray:sign` (Signer already forwards for non-content contexts). Add to the structure guard: `nostr-client.js` importable only from `background/` (allowlist the three breaches today so the guard lands green, then shrink the list).

**Effort.** M. **ROAD_TO_1_0.** Not previously recorded (new).

### ARCH-7 · Five IndexedDB databases by phase accretion; `xray-audits` is the misnamed casework store; two derived caches are identical — harm 3

**Evidence.** `archive-cache.js:58–59` `xray-archive` v3 (stores: `articles`, `annotations`, `factchecks`, `ratings`, `helpfulness`, `trust_graph`, `source_docs`); `audit/audit-cache.js:15–16` `xray-audits` v7 (`runs`, `predictions`, `resolutions`, `case-briefs`, `corpus-extracts`, `pending-suggestions`, `case-links`, `entity-pages`, `article-extractions` — `:115–169`); `event-journal.js:49–50` `xray-events` v2; `network/network-cache.js:22–23` `xray-network` v1 (`events`, `meta`); `portal/portal-cache.js:21–22` `xray-portal` v1 (`events`, `meta`). `workspace-keys.js` names the first three `WORKSPACE_DATABASES` (suffixed `::<wsId>` per workspace, `:65`) and the last two `DERIVED_CACHE_DATABASES`. Backup's per-DB `openRaw(workspaceDbName(base, ws))` (`backup.js:508`) iterates them by hand. ROAD_TO_1_0 T8 already notes "onversionchange and onblocked" missing on four openers.

**Claim.** "Why five": nobody chose five — Phase 7, 12, 13, 25 and the journal each opened their own. The cost is five version ladders, five backup maps, five places to add `onversionchange`, and a DB literally named for a feature that holds six stores of case data. The *derived* pair is free to merge; the *precious* three are a one-way door and should not be merged before 1.0.

**Fresh-eyes action.** (a) Merge `portal-cache.js` + `network-cache.js` into `shared/storage/relay-cache.js` (one DB `xray-relay-cache` v1 with a `scope` index; delete the two old DBs on first open — they are rebuildable). (b) Rename the *module* `audit/audit-cache.js` → `shared/storage/casework-db.js` keeping `DB_NAME = 'xray-audits'` (the name is on users' machines; record the alias in the module header + JOURNAL). (c) Put the five openers behind one `openDb(spec)` helper so `onversionchange`/`onblocked` are written once. (d) Defer merging archive/audits/events until schema-evolution designs a `mergeBackup`-compatible export — Q1.

**Effort.** M for (a)–(c). **ROAD_TO_1_0.** T8 IndexedDB item — open; the merge question is new.

### ARCH-8 · `src/shared/` is a dumping ground with no ownership boundaries: 57 single-caller modules (~18,200 LOC), 2,572 LOC of DOM modals, one dead module — harm 3

**Evidence.** importgraph: 128 `.js` in `shared/` (+ `audit/`, `identity/`, `metadata/`, `platforms/`); **1 zero-caller** (`api-pattern.js`); **57 single-caller** modules totalling ≈18,206 LOC. Reader-only "shared": `archive-draft`, `audit/publish-batch`, `integrity-modal`, `forensic-modal`, `entity-resolution`, `forensic-publish`, `identity/account-publish`, `llm-extract`, `mention-notes`, `metadata/anchor-resolver`, `truth-publish`, `vision-notes`, `pdf-layout` (≈3,900 LOC). Options-only: `backup` (861), `build-info`, `case-create`. Sidepanel-only: `case-export`, `entity-health`. Network-only: `follow-publish`, `incorporation`, `network-feed`, `network-trust`, `review-queue`. Portal-only: `audit/corpus-audit`, `cross-coverage`, `dossier`, `known-unknowns`, `case-counterfactual`, `cross-case-graph`, `entity-page-publish`, `epub-parse`, `hypothesis-suggest`, `truth-entity-record`, `wire-copy`, `workspace-read`, `url-import`, `extraction-publish`, `hypothesis-map`, `case-graph`. Background-only: `llm-client` (1,365), `crossref`, `direct-transcribe-deepgram`, `platforms/substack-api`. DOM-building in shared: `adjudicate-modal` (834, `document.` ×8), `forensic-modal` (687, ×11), `integrity-modal` (552, ×6), `assess-modal` (499, ×8). Cross-surface import: `portal/import-media.js:22` → `reader/transcribe-flow.js` (the second-churniest file, 17 commits).

**Claim.** Directory = ownership is the only boundary an agent can be told to respect without reading 93k lines. Today "shared" gives no signal about which context a module may run in (a `document.createElement` module and a worker-only LLM client sit side by side) and no signal about who owns it. Two agents given "the portal" and "the reader" both end up editing `shared/`.

**Fresh-eyes action.** Mechanical `git mv` in three PRs, no logic change (tests import by path; update paths): (1) surface-owned modules to their surface dir; (2) the four modals + `reader/lens-section.js` pattern → `shared/ui/` marked "extension pages only" in the guard; (3) domain clusters inside shared: `wire/` (event-builder, `*-builders`, `*-publish`, `nostr-events`, `publish-gate`, `confirmed-publish`), `storage/` (storage, archive-cache, audit-cache→casework-db, event-journal, relay-cache, workspace-keys, backup), `llm/` (llm-client, llm-jobs, llm-stream, `*-prompts`, article-pass, corpus-*, map-artifacts), `media/` (transcriber-client, direct-transcribe*, diarized-transcript, podcast-identity, media-key, transcript-*), `domain/` (claim/entity/assessment/truth/forensic/hypothesis/case models + taxonomies), `platforms/` unchanged, `identity/` unchanged. Delete `api-pattern.js` or make it the *actual* import of the interceptor via a build-time inline (esbuild can bundle it into the IIFE — the "no shared imports" rule is about runtime, and bundling satisfies it).

**Effort.** M (mechanical; the risk is merge conflicts with open PRs — do it between waves). **ROAD_TO_1_0.** T8 "context-placement headers across src/shared's 119 flat modules" — open; directory moves supersede headers.

### ARCH-9 · The worker dispatcher holds 40 channels open inline; PR #374 fixes four passes but adds handlers 46–47 to the same chain — harm 3

**Evidence.** `background/index.js:448–1398`: 40 `return true` branches; handler bodies call 16 named `llm-client.js` exports imported at `:29` and do their own `sendResponse` shaping (118 sites). JOURNAL held-open-channel bugs: `:1318` ("a cold multi-minute call is precisely the MV3 teardown"), `:4199–4217` ("message port closed" flattened by `synthesis-block.js`), `:6060` (`xray:audit:run` response arriving after teardown). PR #374 (`origin/claude/eager-knuth-ipv3xd`) adds `shared/llm-jobs.js` (534 LOC) and two new `if (message.type === 'xray:llm:job:start'|'status')` branches into the same listener.

**Claim.** The job pattern is right; landing it as two more `if`s means the next long-running seam (a corpus audit, a batch import) repeats the held-open mistake because the chain has no shape that says "long calls go here". Wake-correctness (Standard 9) is a property of the dispatcher, not of each handler.

**Fresh-eyes action.** `background/dispatch.js`: `const HANDLERS = new Map([...])` keyed by the ARCH-3 registry, with two handler shapes — `sync(msg) → response` and `job(msg) → jobId` — and one `onMessage` that does the `return true` and `lastError` handling once. Move handler groups to `background/handlers/{relay,llm,transcribe,capture,surfaces,fetch-proxies}.js`, one domain per PR. Fold PR #374's two branches into the `job` shape at merge time.

**Effort.** M. **ROAD_TO_1_0.** Not recorded as such (the "control-registry init()" T8 note is adjacent).

### ARCH-10 · Kill-list execution is stalled in the code: K1 stores, K4 wildcard, K14 façades, K3 reader bar all still in tree — harm 2

**Evidence.** K1: `archive-cache.js:173–201` still creates `annotations`/`factchecks`/`ratings`/`helpfulness`/`trust_graph`. K4: `background/index.js:479` + `options/index.js:1862`. K14: `storage.js:354–360, 408–412`. K3: `reader/index.html:144–146` `xr-lensread` section still shipped (options control parked per `options.html:511–520`). Briefing: T8 0/9, kills 6 done / 3 half / 6 not started.

**Claim.** Ratified on 2026-08-09 (Art. 11), never executed; each is a two-way door in code (K1 is one-way for the on-disk stores — schema-evolution). Leaving ratified kills in the tree teaches agents that the tree, not the log, is the source of truth for what exists.

**Fresh-eyes action.** One `chore(kills): execute K4, K14` PR (S). K1 store removal via a v4 `deleteObjectStore` ladder under schema-evolution (S+review). K3 per the parked note.

**Effort.** S. **ROAD_TO_1_0.** K1, K3, K4, K14 — open.

### ARCH-11 · Two MAIN-world envelope conventions and a dead "canonical twin" — harm 2

**Evidence.** `nip07-bridge.js:45,47,59` envelopes `{tag: TAG, direction, id, ok, result}`; `api-interceptor.js:56` envelopes `{__xr: NONCE, ...envelope}`. `api-pattern.js:1–9` explains it re-implements the interceptor's matcher "so it can be unit-tested"; zero `src/` importers; no parity fixture (contrast `tests/fixtures/normalizer-parity.json`).

**Claim.** The "no shared imports in MAIN-world files" rule was read as "no bundling", producing a twin that tests the wrong copy. Two envelope shapes mean two receiver validators for security-threat-modeler to audit and no single place to add a third MAIN-world script.

**Fresh-eyes action.** Bundle `api-pattern.js` into the interceptor IIFE (esbuild already bundles that entry: `esbuild.config.mjs:94–100`; the runtime rule "no shared *runtime* imports" is preserved). Document one envelope shape (`{__xr: nonce, type, id, payload}`) as the target; migrate the bridge when B6's follow-ups next touch it.

**Effort.** S. **ROAD_TO_1_0.** K7 adjacent; new otherwise.

### ARCH-12 · Wire-kind *read* filters are scattered numeric literals across 15 non-builder files — harm 2

**Evidence.** `portal/inspector.js:459–546` (8 literals: 30023, 30062, 30063, 30064, 30068, 30070), `portal/entity-corpus-view.js:21–43` (0, 1, 30023, 30040, 30054, 30062, 30063, 32125), `portal/library.js:459` (32126), `portal/graph.js:46`, `portal/forensic-data.js:14`, `network/index.js:137,314,719` (0, 3), `reader/index.js:7629`, `reader/claim-extractor.js:926`, `background/index.js:1276`, `adjudicate-modal.js:464`, `entity-feed.js:51–59`, `network-feed.js:95`, `entity-sync.js:249,402,467,483` (30078, 10002, 5), `network-trust.js:23`, `mention-notes.js:94`, `adopt-entity.js:30`.

**Claim.** Emission is confined (Standard 4 holds), but the *registry* is CONSTITUTION Art. 10 prose, and readers spell numbers by hand. A retirement (30043, 30067) or a reservation (30065, 30066) has no code-side name to grep.

**Fresh-eyes action.** `shared/wire/kinds.js` exporting `KIND = Object.freeze({ ARTICLE: 30023, CLAIM: 30040, … })` plus `RETIRED`/`RESERVED` sets; a guard asserts the emitted set ⊆ `KIND` values and Art. 10's table lists exactly those numbers (ecosystem-pm's B16 reconciliation gets a machine check for free). Replace read-site literals mechanically.

**Effort.** S. **ROAD_TO_1_0.** B16 — open (ecosystem-pm owns; this supplies the code artifact).

### ARCH-13 · Feature-flag reads are leaf-scattered control flow (70 `isEnabled` sites, 8 surfaces) — harm 2

**Evidence.** `isEnabled(`/`Flags.` call sites: shared 24, options 17, reader 11, background 6, portal 6, network 4, content 1, sidepanel 1. `publish()` alone reads 7 flags mid-flow (ARCH-1). `feature-flags.js` is imported by all 8 bundles (the only module besides `storage.js`/`crypto.js` with that fan-in).

**Claim.** Twenty flags read at 70 leaves is 2^20 possible behaviors observable only in a browser. For a non-technical release the flag *matrix* is the hidden architecture; B10/B11 describe the user-facing symptom, this is the code-side cause.

**Fresh-eyes action.** Not a flag-system rewrite. Two moves: (a) `planPublish` (ARCH-1) takes the flag snapshot once and returns the family list — flags become data in a plan, testable; (b) a test enumerates `FLAGS_DEFAULTS` and asserts each flag has ≥1 read site and an Options control or a documented "hidden" reason (kills the never-read class K2 for good).

**Effort.** S for (b); (a) rides ARCH-1. **ROAD_TO_1_0.** B10, B11, K2 — open.

### ARCH-14 · 205 bare `console.*` against the `Utils.log` convention — harm 1

**Evidence.** `reader/index.js` 103, `platforms/youtube.js` 18, `platforms/instagram.js` 16, `background/index.js` 9, `platforms/twitter.js` 8, others ≤6. Convention: CLAUDE.md "Logging".

**Claim.** A convention with 205 breaches is not a convention; the worker's `console.warn` at `background/index.js:414` logs on every context-menu delivery failure regardless of `CONFIG.debug`.

**Fresh-eyes action.** Sweep with a guard (`tests/structure-guards`: no `console.` outside `utils.js` and `page/`), riding ARCH-1's last commit for the reader.

**Effort.** S. **ROAD_TO_1_0.** T8 console item — open.

### ARCH-15 · The architect discipline's own graduation clauses fired and nothing graduated — the skill has no owner for enforcement — harm 3

**Evidence.** `.claude/skills/architect/SKILL.md:88–94` (Standard 2: "Graduates to a guard test the first time review catches a breach"), `:110–114` (Standard 4: "graduates to a guard test on the next one"). ROAD_TO_1_0 §architect (2026-08-09) recorded the breaches. `ls tests | grep guard` → `constitution-guards`, `custody-guards`, `lens-guards`, `publish-transport-guard` — none is a structure guard. Briefing: "none gates a merge"; `scripts/release-preflight.mjs` "to-be-built".

**Claim.** Every structural finding in this report except ARCH-6 was knowable from the 2026-08-09 report. Advisory skills whose graduation clauses have no assigned executor produce reports, not structure. This is a governance-provenance point (the skills are agent-authored under the §0 method; the maintainer ratified them by merge) so I phrase the remedy as a question — Q6 — with a default: the reviewing skill's report *is* the PR that adds the guard.

**Fresh-eyes action.** Land `tests/structure-guards.test.mjs` now with today's breaches allowlisted (import-graph rules from ARCH-6/8, message registry from ARCH-3, key registry from ARCH-5, kinds registry from ARCH-12, surface-size ceilings from ARCH-2, no-`console.` from ARCH-14). Each subsequent PR shrinks an allowlist; none may grow one.

**Effort.** S. **ROAD_TO_1_0.** B8 adjacent; the skill-graduation gap is new.

---

## Fresh-start design

If I started X-Ray today for non-technical research groups, with the same constraints (MV3, no framework, one maintainer, agents authoring PRs), I would keep the four contexts and the bundle graph exactly and build the *inside* around four registries and one rule.

**One rule.** Directory = ownership = execution context. A module's path says where it runs and who owns it; a guard test enforces the import graph. An agent is assigned a directory, never a feature.

**Target structure**

```
src/
  page/                      MAIN-world islands (unchanged; one envelope shape)
  content/                   isolated world: detect → extract → hand off (unchanged)
  background/
    index.js                 boots, registers HANDLERS from the bus registry
    dispatch.js              one onMessage; sync vs job handler shapes; lastError handled once
    handlers/                relay.js  llm.js  transcribe.js  capture.js  surfaces.js  fetch-proxies.js
  reader/  portal/  sidepanel/  options/  network/
    index.js                 wiring only (query DOM, attach, call) — size-ceiling guarded
    <area>.js                importable, DOM-free decisions (reader/publish/plan.js first)
    ui/                      the surface's own DOM builders
  shared/
    bus/messages.js          REGISTRY 1: every xray:* message → {context, shape}; send() throws on unknown
    storage/
      keys.js                REGISTRY 2: every chrome.storage key → {scope, serialized, backup, credential}
      kv.js                  the Storage facade (today's storage.js)
      archive-db.js  casework-db.js (DB name stays 'xray-audits')  journal-db.js  relay-cache.js
      open-db.js             one opener: version ladder, onversionchange, onblocked
      backup.js              derives its maps from keys.js + the DB list
    wire/
      kinds.js               REGISTRY 3: KIND names, RETIRED, RESERVED — Art. 10 in code
      event-builder.js  *-builders.js  *-publish.js  publish-gate.js  nostr-events.js
    domain/                  claim / entity / assessment / truth / forensic / hypothesis / case models + taxonomies
    llm/                     llm-client  llm-jobs  llm-stream  prompts/  article-pass  corpus-*  map-artifacts
    media/                   transcriber-client  direct-transcribe*  diarized  podcast-identity  transcript-*
    platforms/               unchanged (REGISTRY 4 already: index.js dispatch + detector)
    identity/  metadata/     unchanged
    ui/                      DOM modals shared by ≥2 pages — "extension pages only" in the guard
tests/
  structure-guards.test.mjs  import graph, registries ↔ code, size ceilings, console, kind literals
docs/
  ARCHITECTURE.md            GENERATED from the registries + esbuild config; drift-guarded
```

**The four registries** are plain frozen objects in JS (no schema language, no TS): messages, storage keys, kinds, platforms. Each has a guard test that the code matches it and a doc generator that the prose matches it. That is the entire answer to "why isn't documentation up to date" and "why aren't critical decisions confirmed systematically": a registry entry *is* the recorded decision, the guard is its enforcement point, and adding an entry is the visible commit Standard 3 asks for.

**Publish** becomes `plan → build → gate → journal → summarize`, one module per family, the plan pure and fixture-tested, `publish-gate.js` the only transport. The reader and the portal share the same pipeline; today they have two.

**Storage** keeps every on-disk shape (JSON-string values, DB names, key names) — those are one-way doors and the casework corpus is irreplaceable — but has one reader per shape.

**What I would not build.** Not a TS migration, not a framework, not a plugin system, not a merged mega-IndexedDB before 1.0, not a rename of storage keys, not a re-indentation. Not the `xray:forward:*` popup relic, not the compat façades, not five relay clients.

**Migration order (strangler; every step leaves 2878 green)**

0. **Pin.** `tests/structure-guards.test.mjs` with today's breaches allowlisted. Nothing moves. (S) — the collision detector exists from here; agents can be assigned directories.
1. **Registries as data.** `bus/messages.js` (49 entries), `storage/keys.js` (extend `workspace-keys.js`), `wire/kinds.js`. Guards compare code to registries. Generate CLAUDE.md's message list and the bundle count. Fix the four stale descriptions. (S)
2. **Dispatcher.** `background/dispatch.js` handler map in place; move handler groups to `handlers/*.js` one domain per PR; fold PR #374's job branches into the `job` shape. (M)
3. **Storage access.** Seven raw `preferences` readers → `Storage.preferences`; delete options' private layer; execute K4/K14; merge portal+network caches into `relay-cache.js`; one `open-db.js`. (M; schema-evolution reviews the cache merge)
4. **Reader plan.** Extract `reader/publish/plan.js` (pure) + fixture tests; then per-family modules; then peel transcribe/vision/lens/headers. Surface-size ceiling guard shrinks each PR. (L — this is the only step that needs maintainer soak per PR)
5. **Moves.** `git mv` surface-owned shared modules to their surfaces; modals to `shared/ui/`; domain clusters. Between waves, when open PRs are few. (M)
6. **Relay placement.** `entity-sync`/`confirmed-publish`/`nsecbunker` through `xray:relay:*`/`xray:sign`; shrink the allowlist to empty. (M)

Steps 0–1 unblock parallelism immediately; 2, 3, 5 are independent of each other and of 4 once 0–1 exist. Ownership for a first parallel wave: A = `background/` + `shared/bus`; B = `reader/publish`; C = `shared/storage` + K4/K14; D = `shared/wire` + Art. 10 reconciliation (with ecosystem-pm); E = docs generators + guards. The guard test is the merge-order-independent collision detector.

**Top-10 tech-debt hotspots** (churn in visible history × LOC × (JOURNAL mentions+1) / 1000): `reader/index.js` 6,104 · `background/index.js` 180 · `shared/llm-client.js` 177 · `options/index.js` 139 · `shared/event-builder.js` 69 · `platforms/instagram.js` 50 · `platforms/facebook.js` 49 · `portal/index.js` 45 · `shared/case-synthesis.js` 34 · `reader/transcribe-flow.js` 31 (then `sidepanel/index.js` 27). The visible git history is 187 commits from 2026-08 only, so churn is a one-month sample; the JOURNAL term reaches back to April and agrees on the top three.

---

## Questions for the maintainer

Each with the provenance of the current rule and a recommended default. Where provenance is an agent interpretation I say so; none of these is a ruling.

**Q1. Merge the three precious IndexedDB databases (`xray-archive`, `xray-audits`, `xray-events`) into one?**
Provenance: never decided — each phase created its own DB (Phase 7 / 13 / journal). Recommended default: **No, not before 1.0.** Merge only the two derived caches (`xray-portal` + `xray-network`), rename the `audit-cache.js` *module* to `casework-db.js` while keeping `DB_NAME='xray-audits'`, and put all openers behind one helper. A precious-store merge needs a `mergeBackup`-compatible migration design from schema-evolution first.

**Q2. Keep `preferences` (and every `Storage` value) as a JSON *string* in `chrome.storage.local`?**
Provenance: Phase 2 port decision for v4 userscript export compatibility (`storage.js:8`); the userscript is retired. Recommended default: **Keep the on-disk shape** (it is on every user's machine and in every backup file) but make `Storage.preferences` the *only* reader/writer and delete the seven hand-rolled copies. Revisit the shape only with a backup-format v2.

**Q3. Is "only the worker opens relay sockets" a hard rule?**
Provenance: CLAUDE.md §Architecture 2 — agent-authored description of a design reason (CSP + tab lifetime). The maintainer never ruled on page-side sockets, and `entity-sync.js`, `confirmed-publish.js`, `nsecbunker-client.js` open them today. Recommended default: **Yes, hard rule with a guard**; migrate the three through the existing `xray:relay:*`/`xray:sign` seams. If the maintainer prefers page-side sockets for extension pages (CSP is not a constraint there), the rule should be re-stated as "content scripts never open sockets" and CLAUDE.md corrected — either answer is fine; the current state is neither.

**Q4. Should `src/shared/` be split into domain directories and surface-owned modules moved home?**
Provenance: none — flat layout from Phase 1, accretion since. Recommended default: **Yes, by `git mv` only**, in three PRs between waves, with the import-graph guard landing first. The risk is conflicts with the 12 open PRs, so sequence it after #370/#374/#324 resolve.

**Q5. Generate the description layer (CLAUDE.md message list, bundle count, README test count, `docs/ARCHITECTURE.md`) from registries, with drift guards?**
Provenance: architect Standard 8 (agent-authored prose) — demonstrably not self-enforcing (four defects from 2026-08-09 still present). Recommended default: **Yes**, using the `discipline-docs.test.mjs` pattern that already works.

**Q6. Who executes a skill's graduation clause?**
Provenance: `.claude/skills/architect/SKILL.md:88–94, 110–114` say a standard "graduates to a guard test the first time review catches a breach"; skills are advisory (skills README) and no one is named. Recommended default: **the review that cites a breach adds the guard in the same PR** (allowlisted if the breach cannot be fixed inline). This is a process change — continuous-improvement's territory — so I record it as a question; the friction it relieves is cited above (four unfixed description defects, T8 0/9).

**Q7. Does the moral-lens "session-ONLY cache, no storage.local fallback" firewall stay as a storage-placement rule?**
Provenance: Phase 16 design doc (agent-drafted, amended 2026-07-03), not a maintainer ruling on storage; PR #366's questionnaire inventories the lens firewalls (F-ids). Recommended default: **Keep the behavior, lose the fork** — `lens-engine.js:345–349` re-implements area selection; route it through the storage layer with a `scope:'session'` key entry in the registry so the rule is data, not a second idiom. Whether the *rule* itself survives reconciliation is Q-territory in #366, not mine.

**Q8. Should the `xray:` prefix be reserved for bus messages?**
Provenance: habit; 19 storage keys and 8 menu ids share it. Recommended default: **Reserve it going forward**; rename the 8 menu ids (two-way) to `menu:*`; do **not** rename storage keys (one-way); record the prefix rule in the registry file header.

**Q9. Confirm the 2026-08-09 kills K1, K3, K4, K14 are still ratified so the code can be removed now.**
Provenance: ratified by merge 2026-08-09 (Art. 11); execution never happened. Recommended default: **Yes**; K4/K14 in one small PR; K1's on-disk stores via a v4 ladder under schema-evolution; K3 per the parked note at `options.html:511–520`.

**Q10. Is the reader's 1,574-line `publish()` a 1.0 blocker or post-1.0, as ROAD_TO_1_0 T8 says?**
Provenance: ROAD_TO_1_0 T8 (agent-authored, 2026-08-09) listed it "post-1.0". Recommended default: **Pre-1.0**, because it is the precondition for the maintainer's stated goal — several agents in parallel producing tested code — and because the file is 34× the next hotspot. The plan-extraction step is the cheapest first cut and needs no wire or storage change.

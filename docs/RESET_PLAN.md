# X-Ray reset plan — the fresh-eyes audit and the road to a wide release

**Status:** proposal. Nothing here is ratified; every recommendation is
the maintainer's call (CONSTITUTION Art. 11), and "keep unchanged" is a
complete answer to every question in §11. **Date:** 2026-09-06.
**Tree audited:** `main` at `c1e652c` (2878 tests green, ten bundles
build, `web-ext lint` clean).

**How it was produced.** Eleven discipline lenses each ran their
Protocol over the whole tree with the same brief — the maintainer's
2026-09-05 ask, verbatim, plus the rule that every finding cites
`file:line` and classifies what it touches as KEEP / GRANDFATHERED /
GARBAGE. Each lens's top findings were then handed to an independent
verifier told to refute them (§12 records what that changed). The lens
reports are the evidence and live beside this file in
[`docs/audit-2026-09-05/`](audit-2026-09-05/); this document is the
synthesis and the plan. It does not restate
[`ROAD_TO_1_0.md`](ROAD_TO_1_0.md) (2026-08-09); it cites its ids
(B/T/K) and says which are still open. Where two lenses disagreed, the
disagreement is recorded, not smoothed.

---

## 0. The answer on one page

**What X-Ray is.** A browser extension that lets an investigator capture
web pages — articles, videos with transcripts, PDFs, books, podcasts —
into a private local archive, mark exactly what each source claims with
a verbatim quote, organize sources into a case, and publish captures and
claims to NOSTR so other investigators can build on them. Everything
that has casework pull in the last sixty days sits inside that sentence.

**What is good.** The capture pipeline and its platform breadth. Thin
claims grounded in verbatim quotes, human-accepted. Cases and the corpus
brief. The one-call article pass. Direct cloud transcription. Local-first
signing with the primary key outside the entity registry. The publish
gate's `confirmedOk`. Merge-import of backups. The select-text popover in
the reader, which every lens named as the quality bar. The kill
precedent (the fact layer, kind 30043). The walk ledger. The Playwright
harness in `tools/smoke/`, which ran end to end in this audit's container
in two minutes with no display. The JOURNAL's habit of writing down why.

**Four root causes, not forty symptoms.**

1. **Governance cannot tell a ruling from a reading.** A handful of ad
   hoc "(maintainer, date)" notes in a 10,800-line JOURNAL and two design
   docs are the only markers of a human decision; the constitution's
   fourteen articles carry none; there is no protocol; and the guard
   suite pins agent-drafted prose and maintainer rulings identically. So "no aggregations" — a
   sprint-scoped descope on 2026-07-03, clarified as never-doctrine on
   2026-07-21, narrowed on paper by Art. 5 on 2026-08-02 — still lives in
   code as 22 distinct "firewall" mechanisms, eight of which are agent
   generalizations and seven of which are prose pins that observe no
   behavior at all (§4).
2. **The maintainer is the only verification layer for everything a user
   touches.** 199 of 247 modules are executed by `npm test`; every
   surface's `index.js`, the service worker, the content script's entry,
   both MAIN-world scripts, and 29 portal blocks are executed by nothing.
   All eighteen August "suite green, behavior wrong" escapes lived in
   that unexecuted layer, and fourteen are machine-observable today. The
   soak rule made one human the serial gate for every behavior PR (§6).
3. **Every fact that changes on a merge is hand-copied into three to nine
   places and none is machine-checked.** The version lives in four places
   (README still says v0.7.0), the test count in five with three
   different wrong values, the flag list in six, the kind schedule in
   nine. The prescribed per-PR ceremony is six documents wide and its
   measured compliance is 0–55% (§5).
4. **Features ship per phase without a stop rule, and each phase left a
   surface, a flag, a smoke section, a kind, and a firewall behind.**
   Seven feature families are marked COMPLETE with zero casework
   evidence since design; 29 phases, 16 kickoffs, 20 design docs, 20
   flags of which 19 default off; six surfaces for a three-surface product; twenty
   header buttons in the reader (twelve flag-hidden) over seven stacked
   bars (§2, §7 R2).

**Where to start — the first two weeks.** Not with a rewrite. (1) Put the
existing browser harness in CI and make it required (the net). (2) Pin
today's structure in a guard test and take golden fixtures of every
persisted shape so nothing gets worse while work runs in parallel.
(3) Triage the 79 branches and 12 PRs by the table in §9 and split the
JOURNAL so parallel branches stop conflicting. (4) Hold the
ninety-minute governance reconciliation session with six batched
decisions (§4.3) — it removes the constraints that are shaping the
reader and the case dashboard. (5) Declare the 1.0 scope and park the
rest behind one switch. Everything else in §7 follows from those five.
What "too buggy / too hard / too manual / too incoherent" map to: buggy
is the unexecuted surface layer and the untested prompts (R0, R3 lane
F); hard is the first hour, the six surfaces and the fifty-five nouns
(R4); manual is the soak rule and the tab-bound batch (R0's tiered
soak, R5); incoherent is the firewall regime and the per-phase
accretion (R1, R2).

**What would change permanently, if the defaults in §11 are taken (§8).** Trunk-based work in worktrees with a
module-ownership map and a structure guard as the collision detector; a
CI gate every branch passes identically, including the browser smoke; a
tiered soak (machine-observable classes merge on green, human-judgment
classes batch into one weekly session); a literal marker protocol so a
human decision is a grep-able object; facts generated from registries
and guarded; no new phase numbers; a check date on every flag; a PR cap.

**What the maintainer must decide.** Thirteen batched decisions in §11,
each with a recommended default. The first six are the reconciliation
session.

**What this costs the maintainer, in his own time.** The reconciliation
session (90 minutes, once). The weekly soak batch (30–45 minutes, on a
real case, replacing the per-PR walks). Named one-off walks: one YouTube
transcript capture before the CSP rules are deleted (~10 min); the
Instagram row on #368 (~3 min); the money row on #374 (~5 min plus one
paid reduce); the refusal row on #324 (~5 min); the two-person walk in
R7 (~1 hour, with a colleague). Store work only the maintainer can do:
a Chrome developer account, the privacy-practices form, an AMO account,
and hosting an `update_url` (~2 hours, plus review lead time of days to
weeks — start it in week 1). Everything else is agent work he reviews.

**Casework never stops.** Before anything in R0 lands: take a full
backup. `main` stays the daily build; every reset step is one PR that
reverts on its own; nothing renames a storage key, a database, or a
kind; parking hides views, never data; the derived caches that merge
rebuild themselves. If a step breaks a case, Settings → Diagnostics →
Copy diagnostics is the report, and the step is reverted, not patched
forward.

**A legend for the ids used below.** `B`, `T`, `K` are ROAD_TO_1_0's
blockers, tracks and kills (2026-08-09). `C1–C22` are the firewall
mechanisms the governance lens found in code (§4.2). `Q` and `F` are the
questionnaire's questions and firewalls (PR #366). `E1–E5` grades how
strong the evidence is that a rule was the maintainer's decision (E1 an
explicit recorded ruling, E5 ratified only by merging a PR). `D1–D6` are
the six batched decisions of the reconciliation session. `R0–R7` are
this plan's tracks. A *guard* is a test that fails when a documented
fact stops being true. A *lane* is a directory a thread owns. *Soak*
is the maintainer using a build on a real case before it merges.
*Strangler* means replacing a piece behind a switch while the old piece
keeps running, then deleting the old piece later — never a rewrite.

---

## 1. What is good — keep (and why)

Consolidated across lenses; each item earned its place by casework
evidence or by being the mechanism the plan builds on.

| Keep | Why | Evidence |
|---|---|---|
| Capture pipeline + platform breadth (Readability/Turndown core, YouTube transcript, Substack, PDF via pdf.js, EPUB, podcast transcription) | daily casework | JOURNAL 2026-08-25 "a heavy casework day"; walk ledger rows 08-15…08-25 |
| Thin claims with the verbatim quote as identity, human-accepted; the one-call article pass; "Accept all / Link all covered" | the product's differentiator; makes hundreds of proposals reviewable | `shared/article-pass.js`; PR #361 walk (72/60/86 proposals) |
| Cases + the corpus brief; the case dashboard's claim-proposal review | maintainer-named "the most wikipedia-like artifact" | `docs/LIBRARIAN_KICKOFF.md:23,34`; JOURNAL 2026-08-23 |
| Direct cloud transcription (DC.1–DC.3) | walked on a fresh profile with the companion stopped | walk ledger 2026-08-15/16 |
| Local-first signing; `local_primary_identity` outside `local_keys`; verify-on-ingest; `publish-gate.js` `confirmedOk` (B2 closed) | trust-preserving fundamentals | `shared/storage.js`; `shared/publish-gate.js`; all four portal callers read `confirmedOk` |
| `mergeBackup` (accrual by id, local wins, identities never merged) | the one sharing path that is exercised and needs no relay | JOURNAL 2026-07-25; `tests/backup-merge.test.mjs` |
| The reader's select-text popover (tag person / org / add as claim) | the quality bar every lens named | `reader/entity-tagger.js:1-25,142-158` |
| The four-context separation; MAIN-world islands import nothing; kind emission confined to builders; `platforms/` handler + detector seam | load-bearing walls that hold | architect report, import graph |
| The wire discipline itself: every addressable kind has a recomputable `d`; the audit family carries run identity in `d` so relay latest-wins cannot destroy history; verify-on-ingest; the kind-3 mirror fetches and unions; every wire-relevant PR carries the `Wire format:` callout; the reserved/retired distinction | the best-engineered part of the tree — keep exactly as is | wire-and-schema report; `docs/NIP_DRAFT.md:462` |
| Registries that already exist: `FLAGS_DEFAULTS`, `WORKSPACE_CONTENT_KEYS`, `platforms/index.js` | the pattern the reset generalizes | `metadata/feature-flags.js:28`; `shared/workspace-keys.js:1-40` |
| The guard-test culture and `discipline-docs.test.mjs`'s generator-plus-guard pattern | the mechanism that keeps the one generated doc current | `tests/discipline-docs.test.mjs` |
| `tools/smoke/ma6-walk.mjs` | loads the unpacked extension headless, seeds state through the real modules, pins relays to loopback, reads IndexedDB after clicks; ran here 2026-09-05 in ~2 min | `tools/smoke/ma6-walk.mjs`; §6 |
| The walk ledger (walks performed, dated, with what they found) | the only honest verification record | `docs/SMOKE_TEST.md:12-53` |
| The kill precedent and the rule "a parked feature keeps its tests; a killed feature does not" | the project knows how to remove things | JOURNAL 2026-07-20; ROAD_TO_1_0 K1–K15 |
| The seven real firewalls (§4.2: grounding, human-accept, the membrane, no auto person-label, argument-not-conclusion, no intent, import consent) | each protects something the maintainer demonstrably decided | governance report F0, C3/C4/C12/C13/C15/C16/C17 |
| The security fundamentals: NIP-07 return-path verification, verify-on-ingest on every relay read, the credential class excluded from every export and guarded, pinned cloud origins with key scrubbing, loopback pins for the companion and LM Studio, no telemetry, no remote code, the capture stash in `chrome.storage.session` | would pass a serious reviewer | `content/nip07-client.js:130-148`; `nostr-events.js:66-131`; `backup.js:108-132`; `direct-transcribe.js:54-58` |
| The corpus pipeline's pure core: the one-unit-builder cache-key discipline, the grounding firewall, salvage-on-truncation, honest `truncated` vs `partial` disclosure, the durable proposal layer with a review state, MA.7 re-grounding merge-import | better engineered in the small than most of the tree; the driver is the problem, not the core | `case-synthesis.js:29-56`; `llm-stream.js:63-111`; `article-pass.js:257-270`; `extraction-import.js` |
| The Margin's *diagnosis* ("the insight and the sentence it is about are never in the same place") | the correct fresh-eyes reading of the reader | `docs/MARGIN_DESIGN.md` §1 |
| JOURNAL entries as institutional memory (the content rule, not the container) | it caught the 2026-07-21 misreading | `docs/JOURNAL.md:3527` |
| No framework, no TypeScript, ten esbuild entries; 2-space indentation in ported files left alone | correct for one maintainer; tidying is astronautics | `esbuild.config.mjs` |

## 2. What is grandfathered — and by which past decision

"Grandfathered" means: it exists because of a decision whose premise is
gone or that was never the maintainer's. None of these is a defect in
the code that implements it.

| Thing | The decision that grandfathered it | Why the premise is gone |
|---|---|---|
| The phase model (Phases 0–29 + named waves; ROADMAP status bars; per-phase kickoff docs) | issue #20 (2026-04): a parity-with-the-userscript plan whose only stop rule is parity-scoped (`ROADMAP.md:2153-2161`) | parity was reached at v0.5.x; twenty more phases ran with no product-level "no" |
| "No aggregation" as territory in code and design docs (`audit/corpus-rollup.js:4-6` refuses a mean; `corpus-publish.test.mjs:83` bans any `%`; `KNOWLEDGE_SHARING_DESIGN.md:16`; `TEAM_CASE_DESIGN.md:21-23`) | the 2026-07-03 sprint descope, read as doctrine | maintainer 2026-07-21: sprint-scoped, "you have no way of knowing what's a work-in-progress plan versus ironclad"; Art. 5.2 itself: "refusing them wholesale was itself a form of false precision" |
| Art. 6's linguistic arm (five reserved words), wire arm (30066 "permanently free"), and the reader's visual firewall | a two-kind wire-schema rule (NIP_DRAFT 30051 vs 30054) generalized per family in Phase 13, then constitutionalized 2026-07-22 in an agent draft the maintainer reviewed (Art. 8 and 9 were revised on that review) and ratified by merge; the generalization itself was never individually recorded | the questionnaire grades all three E5; the maintainer's 2026-08-28 reconciliation statement; no bar has a distinct colour scale or surface treatment — the visual separation exists only in comments and stacking order |
| Truth adjudication (30063/30064), hypothesis maps, counterfactuals, the moral lens, AI vision, the Network client, assessments publishing, kinds 30068/30069/30070 | the Epistack competition sprint (June–July 2026) and post-28 momentum | deadline passed 2026-07-19; zero JOURNAL casework mentions since design; no walk-ledger rows; flags never flipped |
| The companion transcriber as a peer of direct cloud in Options | the 2026-04-19 YouTube DOM arms race | DC.1 removed the premise for newcomers; Windows-only, LT.1–LT.14 unwalked |
| Three collaboration models (case bundle with keys; follow + incorporate; TEAM_CASE TC.3/TC.5 unbuilt) | designed ahead of any second user | B14 open: never exercised by two people on two machines |
| The soak rule (one human casework session per behavior PR) | maintainer ruling 2026-08-23 after the DC wave's five same-day-merge escapes | its premise ("the suite cannot observe what a person sees") is true of `node --test` and false of the harness |
| The reader as *the* publish orchestrator (`reader/index.js:6026-7600`) | Phase 2: capture → reader → publish, one article at a time | the portal also publishes now, through `publish-gate.js`; two orchestrators, two styles |
| Five IndexedDB databases; `xray-audits` holding six non-audit stores | each phase opened its own (7, 12, 13, 25, journal) | nobody chose five; `xray-portal` and `xray-network` are near-duplicate derived caches (205 vs 209 lines; the network cache adds a last-looked key and a profile getter, the portal cache a `dTag`) that rebuild from relays and can merge without a migration |
| `src/shared/` as one flat directory of 128 files | Phase-1 layout for ~10 modules | 57 modules have one importer (~18,200 LOC); "shared" now means "not sure where this goes" |
| `preferences` as a JSON string in `chrome.storage.local`; the `Storage` façade's stringify | Phase 2 port for v4 userscript export compatibility | the userscript is retired; seven hand-rolled `JSON.parse` copies exist; keep the on-disk shape (one-way door), unify the reader |
| Source-grep guard tests over the surfaces (about twenty test files read `src/` as text; some pin implementation token sequences and user-visible phrases) | the surfaces cannot be imported | the harness can observe them |
| The per-PR six-document ceremony (JOURNAL + SMOKE row + CHANGELOG + ROADMAP + CLAUDE.md recap + design banner) | each added by the PR that first felt the pain, as prose | measured compliance 0–55%; 23% of commits are docs-only |
| Options → Advanced as the product's control panel (18 subsections, 12 flag checkboxes, 47 hint paragraphs) | the Phase-9a flag policy: every family gets a publish flag with a disclosure paragraph | a researcher deciding what leaves their machine reads eleven near-identical paragraphs |
| `xray:` prefix on 19 storage keys and 8 menu ids | early habit; the prefix began as the message namespace | a grep for messages returns ~79 literals of which roughly 45 are messages |

## 3. What is garbage — dead, duplicated, or misleading

Cheap to remove; two-way doors unless marked.

- **Front-door facts that are false:** `README.md:19` "v0.7.0" (tree is 0.8.0); `README.md:381,406` "2100 tests" (2878); `CHANGELOG.md:11-13` "Nothing yet" across 145 merges since v0.8.0 (the release workflow now fails loudly on an empty section, so the next tag cannot ship until someone reconstructs seven weeks); `esbuild.config.mjs:3` "seven bundles" (ten); `src/page/api-interceptor.js:14-19` "NOT auto-injected via manifest" (`manifest.json:80-95` injects it at `document_start`); CLAUDE.md "eight of the nine skills" (twelve exist), "~2500 tests", "no section walk is outstanding". All four architect items were cited by `file:line` on 2026-08-09 and are still wrong.
- **ROADMAP contradicts itself** on Phase 16 in one file (`ROADMAP.md:94` complete vs `:1500` "smoke run pending") a month after JOURNAL 2026-08-02 recorded fixing exactly that; `ROADMAP.md:2164-2174` prescribes a GitHub-issue mirror nobody has done since Phase 8.
- **Ratified kills still in the tree:** K1 stores (`archive-cache.js:173-201` creates five dead stores on every fresh install; one-way, needs a v4 ladder), K3 reader bar (`reader/index.html:144-146`), K4 `xray:forward:*` (`background/index.js:477-495`, sender `options/index.js:1862`), K8 reader "Import audit JSON…" always visible (`reader/index.html:127`), K9 `case` as a creatable entity type (`sidepanel/index.js:1289-1320`, `entity-tagger.js:150`), K13 the EPISTACK cluster and shipped kickoffs, K14 `Storage.entities`/`articleCache` (`storage.js:354-360, 408-412`), K15 the entity-corpus destination.
- **Dead code:** `src/shared/api-pattern.js` (zero importers; its test pins a copy that never runs); the `xray:scholar:crossref` handler (`background/index.js:1207`, no sender anywhere).
- **Duplicated constants:** `AUDIT_DRAFT_PREFIX` declared in `audit/corpus-audit.js:24` and again in `reader/index.js:4383`; `'xray:user'` in `sidepanel/index.js:51` and `portal/identity.js:34`; `'local_primary_identity'` as a literal in four `src/` files; `options/index.js:57-125` re-implements the `Storage` façade; eight raw `chrome.storage.local.get(['preferences'])` + `JSON.parse` sites.
- **Flags with no control:** `reviewCoordination`, `storeFirstPublish`, `extractionAnalysisPublishing` — the last gates a *wire* publish (kind 30070, whole-unit disclosure) and is reachable only by editing `xray:flags` in DevTools (B10 open).
- **Guards that observe names, not behavior:** the export-name regex "never-merge at the export surface" (`tests/constitution-guards.test.mjs:241-261`); about two dozen test files with hand-rolled banned-word lists (`corpus-publish.test.mjs:83` bans `\d+\s*%` from a brief and goes red on a legitimately quoted "40%"; `hypothesis-block.test.mjs:134` bans "stronger"/"confidence" anywhere; `entity-dossier.test.mjs:185` bans "credibility" as a key); verbatim pins of agent-drafted clauses (`constitution-guards.test.mjs:98-115`; `lens-guards.test.mjs:196-207`); implementation snapshots written nine days after the JOURNAL said not to (`tests/extraction-accept-all.test.mjs:51-53`).
- **Four shipped controls lie about themselves:** the Options "Capture Page" button captures the Options tab itself (`options/index.js:1861` → `xray:forward:*`); `#xr-pending-suggest` can never show (no writer); the reader's "Import audit JSON…" is always visible for a format the user cannot produce; `xray:scholar:crossref` is handled and never sent. Each is a five-line deletion (NEWC-09).
- **205 bare `console.*`** against the `Utils.log` convention (reader 103, youtube 18, instagram 16, background 9).
- **Committed walk outputs and hardcoded container paths** in `tools/smoke/` (`ma6-walk.mjs:31-34`).
- **Phase numbers in shipped UI** (13 places across the reader, portal and options shells) and 17 in README.
- **Governance about governance:** three open PRs (#364 +354, #365 +528, #366 +667) total 1,549 lines about the governance corpus and zero lines of product; §9 says what to do with each.

---

## 4. The "no aggregations" thread — firewalls, provenance, and the way out

### 4.1 The lineage, dated

1. **2026-07-03** — JOURNAL "Sprint descopes": the owner deleted `docs/ideas/CONSENSUS_PROTOCOLS_PLAN.md`; the entry says "the aggregation/web-of-trust/bridging direction is not being pursued."
2. **July** — every subsequent design treated the *territory* as radioactive (`KNOWLEDGE_SHARING_DESIGN.md:16` hard-codes "no aggregation / consensus / reputation layer" as a substrate constraint; `ENTITY_CORPUS_DESIGN.md` §7 Q5 left undecided; trust-graph v2/v3 unbuilt).
3. **2026-07-21** — JOURNAL: the maintainer clarified he scrapped the plan because "Claude was being too prescriptive about the project's direction," not because he rejected the technical direction — "you have no way of knowing what's a work in progress plan versus ironclad."
4. **2026-07-22 / 08-02** — CONSTITUTION Art. 5 "narrows" the kill: estimates and cross-author aggregates are lawful *as instruments* under five conditions; Art. 5.2 closes with "refusing them wholesale was itself a form of false precision." Art. 6 (never-merge, with linguistic and wire arms) and Art. 12 red lines 2–4 landed in the same document — an agent draft the maintainer reviewed (Art. 8 and 9 were revised on that review) and ratified by merge; the Art. 6 generalization itself was never individually recorded.
5. **2026-08-28** — the maintainer: "there needs to be a reconciliation between my original intentions and what has been codified." PR #366 prepares the agenda (Q1–Q19, firewalls F1–F13, provenance graded E1–E5). Nothing in code has moved: `corpus-rollup.js:4-6` still refuses a mean while permitting a range; the Art. 5 functional guard is "deferred… when the first estimation surface ships" (`constitution-guards.test.mjs:316`) — none has.

The narrowing happened on paper and nowhere in code. The incoherence is
visible in one screen: the audit family's subject dossier already
renders a shrunk mean with its standard deviation, n, and cohort means
(`audit/dossier.js`, `portal/dossier-block.js`) — lawful under
PHILOSOPHY §4, which always aggregated — while one block over, the case
dashboard's corpus rollup refuses the same statistic across a case
(`audit/corpus-rollup.js:4-6`, "no mean; a range is fine"). The same
number is licensed in one family and banned in the next by rules nobody
individually decided. That is the concrete cost of the thorn.

### 4.2 The firewall census as it exists in code

The governance lens enumerated every distinct enforcement mechanism in
`src/` and `tests/` that calls itself a firewall — 22 of them (its F0
table has the `file:line` for each). Condensed:

| Group | Mechanisms | Fresh-eyes disposition |
|---|---|---|
| **Nine that protect a maintainer decision (seven firewalls plus two division-of-labor rules) — keep as law** | C3 truth-adjudicability gate (`interpretation`/`stated-value` never get true/false); C4 value firewall; C12 grounding + human-accept (the model's quote is a search key; paraphrase is a hard reject); C13 import consent/provenance (`mergeBackup`); C15 the membrane (viewing writes nothing); C16 forensic location-never-verdict, no intent, counter-read required; C17 opinion modules argue, never conclude; plus C14 no operator identity in `src/` and C21 the model never computes the audit aggregate | keep; two of them (C3 read-side, C12 accept) get an override described below |
| **Nine agent generalizations that now block wanted capability — demote or split** | C2 export-name regex; C5 entity-record word-ban (the §3.5 commitments ratio is already computed in `truth-entity-record.js:255-275`; the ban constrains how it may be keyed and shown); C6/C22 case/corpus no-mean family (a range is allowed, a mean is not — while the audit subject dossier renders a mean); C7 visual firewall; C8 five-word vocabulary ban; C9 30066 "permanently free"; C10 lens session-only cache; C11 30064 no-mirror (keep as default) | split C6: keep "no fused case *verdict* as headline" (Art. 5.4 sentence 1), demote the rest to Art. 5.2's five conditions; demote C7/C8 to one line of surface guidance; amend C9 to "reserved"; remove C2/C10 |
| **Four prose-pin classes, plus the banned-word lists, that observe no behavior — remove or convert** | C19 verbatim pins of E5 clauses; the two dozen banned-word lists; C20 mandatory disclaimer sentences; C18 prompt-header requirement (keep as lint); C1 audit≠assessment tag grammar (keep — it is per-kind schema, i.e. the wire covenant, not a firewall) | replace with one exported predicate `isLicensedEstimate(obj)` (declared, method, spread, n) and one schema check; keep structural pins (headings, citations resolve, versions agree, kind schedule vs code) |

**What the current regime costs, measured.** 30 tests in four files exist
to pin prose; eleven more test files carry banned-word lists; a Tier-1
ceremony is required to reword any of it. The reader is seven stacked
blocks and the case dashboard a 4,400-pixel column because presentation
inherited a data rule. PR #370 spends part of +1,872 lines on a rail/tint
compromise whose only purpose is respecting C7. Capabilities foreclosed:
case-level instruments (Art. 5.4's own door, unopened for six weeks); an
entity-level summary; cross-family views; a durable lens cache; the
bridging/trust seams left "open but unwired" since the descope.

**Two recommended overrides, both the maintainer's call (§11-10 and
D3), because they are the throughput lever for hundreds of URLs.**
(a) C12's accept gate: the MA.6 posture (publish every row *with its
review state*) already proves that "unreviewed but visible" is lawful;
the recommended default extends it locally so unreviewed extraction rows
can render and feed the corpus reduce with their state shown, instead of
being invisible until clicked — with the corpus brief disclosing how
many unreviewed atoms it drew on (Art. 4.7). Grounding stays a hard
reject. This reverses DISCIPLINES §15 standard 3 ("one accept per
artifact — bulk credulity is not review"); the failure mode accepted is
that a brief can cite a grounded quote nobody has read, which the count
makes visible. (b) C3's read side: `truth-builders.js:369` nulls a
stranger's not-adjudicable verdict — a silent filter, which Art. 3
forbids; return a visible "not admitted" record instead (read-side
only; no wire change).

### 4.3 The reconciliation session — ninety minutes, six decisions

Agenda = PR #366's questionnaire, batched so dependent questions are
decided together. Pre-read for the maintainer: the governance report's
F0 table and the questionnaire's §1 headings (≤ 20 minutes). Output: six
rows in a rulings ledger and one amendment PR. Everything else the
agents execute.

Art. 13 requires, for any weakening of a norm, an explicit statement of
the failure mode the change accepts; each row carries one, so the R1
amendment PR is valid under the constitution's own text if the defaults
are taken.

| # | Decision | Batches | Recommended default | Constitution text touched · failure mode accepted | Ceremony |
|---|---|---|---|---|---|
| D1 | The firewall's shape | Q1, Q4, Q5, Q14, Q17 (F2, F3, F4, F7) | Art. 6 becomes its one data-arm sentence plus "side-by-side composition is always lawful"; the linguistic arm becomes naming guidance ("verdict" stays the truth kind's *name*); the wire arm folds into Art. 10 (never-reuse kept; 30066 "reserved — lens, if ever ratified"); the visual arm becomes one guidance line ("scores and stances never share a color scale"). Remove C2; demote C7/C8 | Art. 6, Art. 10 row 30066, Art. 12 red line 4 (narrowed to the data arm) · a reader may see a stance and a score on one surface and confuse them; mitigated by the model-level fence (per-family cards) and the color-scale line | Tier 1, one amendment-log entry; guard deletions in the same PR |
| D2 | Aggregates and instruments | Q3, Q7, Q9 (C5, C6, C22) | Keep Art. 5.2's five conditions as the license; **define "fused"** ("a single number or state computed from more than one family's judgment, or presented without its inputs, method, spread and n"); declare the first licensed instruments: a corpus mean + range + n beside the subject dossier's existing one, the §3.5 commitments ratio that `truth-entity-record.js` already computes, a labeled case "evidence balance" rendered beside — never above — the dossier header; "does not appear" renders as "estimate withheld: <failed condition>" (Art. 3) | Art. 4.4 ("no case, entity, or corpus ever carries a fused score" — narrowed by the definition), Art. 5.4's third sentence (the case-headline rule, kept), Art. 12 red line 2, PHILOSOPHY P8 (unchanged: inputs stay individually visible) · a labeled, spread-shown instrument beside the record can still be read as the verdict by a hurried reader; mitigated by the five conditions and by never rendering it above the record | Tier 1 (the definition and Art. 4.4) + Tier 2 (PHILOSOPHY §13) |
| D3 | The two person-protecting firewalls | Q2, Q6, Q13 (C3, C4, C5, C11) | Keep the §3.1 gate and no-auto-person-label as law; strike "permanently" from TS H-2; add "disclosure is not criticism" to Art. 7; 30064 no-mirror stays as a default; read-side null becomes visible not-admitted | Art. 7 (one sentence added), TS H-2 (one word struck) · a future amendment could soften the adjudicability gate through ordinary ceremony rather than being blocked by rhetoric; that is the amendment process working, not a hole | Tier 1 (one Art. 7 sentence) |
| D4 | What binds | Q8, Q10, Q11 (Art. 2; DISCIPLINES; H-7) | Narrow Art. 2's doc-governs-code to wire / schema / security; elsewhere a code-vs-doc conflict is a recorded question for the maintainer, not an automatic doc win; DISCIPLINES becomes guidance (prompt-header lint stays); rule on §15.3: bulk-accept of individually grounded rows is lawful — the grounding is the review; H-7 scoped to judgment surfaces | Art. 2 (narrowed), DISCIPLINES §15 standard 3 (reversed — named as such), TS H-7 (scoped) · a design doc's prose can lag the running product without forcing a fix, and a brief can cite a grounded quote nobody read; mitigated by the recorded-question rule and the unreviewed-count disclosure | Tier 1 (Art. 2) |
| D5 | Process | Q12, Q16, Q18, Q19; GOVE-10 | Adopt, or amend and then adopt, the marker protocol (§4.4); create and seed the rulings ledger; write "NOSTR stays invisible — interfaces never require NOSTR literacy; not a vocabulary ban", "high value solo first", "Apple-quality simplicity" down with their force stated; amend Art. 11 so that the maintainer's explicit recorded instruction is the ratification and who presses the merge button is mechanical (it has been waived twice on the record, JOURNAL 2026-08-04) | Art. 11 (ratification wording; and its literal "recorded in `docs/JOURNAL.md`" — the ledger and the per-month split change where a decision is recorded) · an agent could misread a maintainer message as a ruling; mitigated by the requirement that a ledger row quotes the maintainer's own words | Tier 1 (Art. 11); Tier 3 for the rest |
| D6 | The corpus reset and the three PRs | Q15 | Normative set of four documents (CONSTITUTION ≈450 lines; PHILOSOPHY; a rulings ledger; a one-page surface-constraints index); everything else guidance or archived with a banner (Art. 3, nothing deleted); #364 merge, #366 merge as the answered record, #365 fold to ≤120 lines; lens durable local cache is an ordinary feature | Art. 2's list of organic statutes and the non-normative tier (TS and DISCIPLINES move to guidance) · a guidance document can be ignored where a statute could not; mitigated by lifting the two clauses the maintainer actually wants (the §3.1 gate; the bridging line) into the constitution or the ledger | Tier 3, one PR (plus the Art. 2 line in D4's amendment) |

### 4.4 The decision-confirmation protocol — how this never re-accretes

The failure pattern the maintainer named is an agent hardening a
directional statement into a rule without the interpretive step being
surfaced. Two documented specimens: the "server/relay" vocabulary rule
and the MA.6 disclosure rule (reversed). The fix is to make the
interpretive step a literal object.

1. **Three markers, everywhere a constraint is stated** (design docs,
   kickoffs, PR bodies, guard-test headers, prompt files):
   `[RULING: maintainer YYYY-MM-DD R-id]` ·
   `[INTERPRETATION: <agent>, YYYY-MM-DD — default: <x>; ask: <one line>]` ·
   `[ENGINEERING-FACT: <measured how>]`. A constraint with no marker is
   an INTERPRETATION by definition.
2. **A grep-able rulings ledger** (`docs/RULINGS.md` or
   `docs/decisions/R-NNN-<slug>.md`, ≤40 lines each): id · date · who
   ruled · the maintainer's own words (≤2 lines) · what it applies to ·
   what it supersedes · the guard that pins it. Seeded from the
   questionnaire's §5 already-reconciled ledger (17 rows) plus the
   session's six. JOURNAL entries cite the R-id instead of restating.
   A guard asserts every `R-` id cited anywhere in the tree exists.
3. **Guard provenance and expiry.** Every guard test and every
   doc-pinning assertion carries `// Provenance: R-…` or
   `// Provenance: INTERPRETATION (<date>) — expires <date+90d>`. A
   meta-check lists expired INTERPRETATION guards and opens an issue
   ("renew — get an R-id — or remove"); it warns, it never fails the
   gate, because a build that goes red on a calendar date with no diff
   is an unexplained red build for a maintainer who does not code.
   Interpretations cannot become law by aging; they can only be
   renewed by a human or removed.
4. **PR template section "Interpretive steps (n)"** — required, may be
   "0". Each step is one line with its recommended default.
   `hand-to-maintainer` carries them to the maintainer as questions,
   never inside the diff's prose.
5. **How the maintainer is asked.** One question per message: the
   question (one sentence) · the current rule and its provenance · at
   most three options with their cost in one line each · a recommended
   default · "reply `keep` to keep unchanged — that is a complete
   answer." Questions batch into one decision only when logically
   dependent. Silence is not consent: an unanswered question stays an
   INTERPRETATION with its expiry.
6. **Ceremony scaled to provenance.** Confirming an INTERPRETATION into
   a RULING is a one-line ledger row and a marker flip; Tier-1 artifacts
   are reserved for changing what the text says.

---

## 5. Why documentation is never up to date — measured — and the fix

Docs were 0.75× the source in bytes before this audit added its own
reports (3.05 MB under `docs/` against 4.35 MB of `src/`) and they ship
inside the release zip. Eight files carry 60%
of the mass. The per-PR ceremony prescribed by CONTRIBUTING, CLAUDE.md
and ROADMAP is six documents wide; over the last sixty merges its
measured compliance was JOURNAL 45%, SMOKE_TEST 55%, CHANGELOG 0%,
ROADMAP 2%, CLAUDE.md 12%. Roughly a quarter of August's commits are
docs-only, and a dozen of them exist only to record a soak walk.
Meanwhile the *only* guarded documents are the ones that change least —
the constitution's verbatim text and one generated HTML page. The
project machine-enforces doctrine and hand-maintains facts, which is
backwards for currency.

Five whys, compressed: docs drift because facts are copied by hand; they
are copied by hand because no registry exists for flags, kinds, bundles,
or messages that a generator could read; no generator exists because the
ceremony was written as prose obligations rather than guards; the
obligations were written as prose because each was added by the PR that
first felt the pain, and no later PR owned turning it into structure;
nobody went back because the only maintainer-facing signal is the soak
walk, which observes the product, not the docs. The same pain class
recurred on 2026-07-03, 07-09, 08-02, 08-04 and 08-28.

**The fix (track R6):** a fact lives in exactly one authored place or in
code; everything else is generated, archived, or absent. Four registries
in code (messages, storage keys, kinds, flags-with-metadata) feed one
generator (`tools/gen-docs.mjs`) that fills `<!-- gen:* -->` blocks in
README, CLAUDE.md, USER_GUIDE and NIP_DRAFT and writes `KINDS.md`,
`FLAGS.md`, a docs index, and CHANGELOG's `[Unreleased]` from merged PR
titles. One guard file (`tests/doc-currency.test.mjs`) fails CI on: any
test/file count in prose; any version literal that disagrees with
`package.json`; an empty `[Unreleased]` when HEAD is ahead of the newest
tag; a cited `npm run` that does not exist; flag registry ≠
`FLAGS_DEFAULTS` ≠ generated table ≠ `isEnabled` literals; kinds
registry ≠ builders ≠ NIP_DRAFT ≠ Art. 10; stale generated blocks;
status words ("smoke run pending") outside the walk ledger; `Phase \d+`
in user-facing HTML or docs; the skills roster not derived from the
directory. The per-PR ceremony that remains is three lines in the PR
body (verification layer · wire format · docs touched), a JOURNAL entry
only under its three existing triggers, and a ledger row appended by
`hand-to-maintainer` when the maintainer reports a walk. The JOURNAL
splits per month and appends at the *bottom* (the prepend-at-top hunk
is what every parallel branch conflicts on); its old path becomes a
generated index so existing citations resolve; maintainer rulings are
extracted into the ledger of §4.4. CLAUDE.md is capped at ~200 lines
with generated blocks and no phase history. ROAD_TO_1_0 is archived with
a banner; its open ids move to a one-table tracker. `docs/`, `tests/`,
`tools/` and `.claude/` leave the release zip.

---

## 6. Why progress is slow — and the fix

Three mechanisms, all visible in the August record.

**The soak rule made one human the serial merge gate.** Adopted
2026-08-23 as the right emergency response to the direct-cloud wave's
five same-day-merge escapes, it now costs one maintainer session per
behavior PR regardless of size: a dozen `docs(smoke): record the PR
#NNN soak walk` commits covering fourteen PRs in a fortnight, twelve
open PRs, and the maintainer walking a fourteen-row checklist for a
flag-off fourth reader view (PR #370) — "testing stuff I don't even
care about." Its premise is
that the suite cannot observe what a person sees. That is true of
`node --test` and false of the harness in `tools/smoke/`, which found
the false "published" stamp on its first run (JOURNAL 2026-08-02) and
which ran here, in a CI-shaped container, in two minutes. Of the
eighteen August escapes, fourteen are shaped navigate / click / read
DOM / read IndexedDB — machine-observable today — and one (a
`ReferenceError` to a deleted identifier) would have been caught by
ESLint `no-undef`, which the repo has never had.

**The phase model has no "no".** A phase closes when its slices land,
never when casework pulls them. Thirteen of sixteen kickoffs and twenty
of twenty design docs carry no success criterion, kill criterion, or
check date — including `MARGIN_DESIGN.md`, ratified after the
product-manager standards that require them were adopted. ROAD_TO_1_0's
four tracks that actually reach a stranger (T5 evidence, T6 group
surfaces, T7 first hour, T8 kills) stand at 0/35 checkboxes a month
later, while August's attention went to transcription waves, portal UX
PR-1..8, Suggest fixes, the Margin, and three governance PRs.

**Structure forces collisions.** `reader/index.js` is 8,294 lines with a
1,573-line `publish()` that reads its flags inline and calls seventeen
builders; every agent touching capture, transcription, publishing,
audits, vision, the lens, or platform headers edits the same file, and
no test can import it. The service worker is one 950-line `if`-chain of
45 handlers. The JOURNAL prepends at the top, so thirty of the
forty-five pairs of open PR branches conflict — every one of them in
that file and nothing else — and `main` carries 54 back-merge commits
whose only job was resolving that hunk. The result is measurable:
`main` has had no commit since 2026-08-28 while four ready behavior PRs
(and two drafts) wait.

**The fix:** the browser harness in CI as a required check (R0); a
tiered soak — machine-observable classes merge on green, human-judgment
classes (money, real relays, signer popups, live third-party sites,
"does it read true") batch into one weekly session with minutes
recorded (R0/§8); the structural moves that make parallel work safe
(R3); a PR cap; and no new phase numbers — one status page with
blockers, flags-with-dates, and the parked shelf (R2).

---

## 7. The plan — eight tracks

Effort: S < 1 day, M 1–3 days, L > 3 days of agent work, each plus
whatever human verification its class needs. Tracks are sequenced by
dependency, not by importance; lanes inside a track run in parallel
(§8).

### R0 — Freeze and net (weeks 1–2)

Goal: nothing gets worse while work runs in parallel, and machines start
looking where the bugs are.

- [x] **The browser smoke in CI, required.** *Landed 2026-09-07 on this
      branch (JOURNAL entry of that date): `npm run smoke` →
      `tools/smoke/run.mjs`; `playwright` pinned as a devDependency;
      `lib/browser.mjs` resolves the full Chromium with `XR_CHROME`
      override; the `browser-smoke` CI job builds, installs Chromium,
      opens all five extension pages asserting zero `pageerror` and
      every bundle `esbuild.config.mjs` declares, then runs the MA.6
      walk anchored on `[data-xr="extraction-block"]` with
      `tests/smoke-selectors.test.mjs` pinning the anchor; outputs
      upload as a CI artifact. Measured locally: 42 s.* Remaining from
      this bullet: move the walk's other selectors to `data-xr` as
      surfaces are touched; add a browser cache to the job when its ~40 s
      install is felt. (VERI-02; B8 and T4's "Playwright devDependency +
      CI job loading the extension" checkbox — closed.) The `pages`
      check is required from day one; the MA.6 walk is advisory until
      2026-09-21, then required. Budget: the whole smoke job ≤ 5 minutes
      wall clock.
      Flake policy: a scenario that fails without a code cause is fixed
      or deleted within the week, on the record — never quarantined
      silently; the automator kill rule (two false alarms, no true
      positive) governs after that. Owner: the toolchain lane.
- [ ] **ESLint minimal** (`no-undef`, `no-unused-vars`, a `console`
      ratchet starting at 205) + version lockstep moved into `ci.yml` +
      a packaged-contents assertion + a bundle-size budget. (S each;
      VERI-07; T4's lockstep and packaged-contents checkboxes, open.)
      The packaged-contents assertion also names what must be *in* the
      zip: pdf.js's cmaps, standard fonts and wasm under `dist/`, the
      largest packaging risk the tree has.
- [ ] **Golden fixtures before any refactor thread starts.**
      `tests/fixtures/idb/<db>-v<N>.json` (one dump per shipped version
      per database, produced by seeding the historical rung and
      exporting through `backup.js`'s own dumper), `tests/fixtures/wire/<kind>.json`
      (one real signed event per emitted kind, sourced from the
      maintainer's journal export), `tests/fixtures/backup/*.json`; three
      generic tests: open-and-upgrade every IDB fixture and read every
      row through the current API, re-verify id + signature and re-parse
      every wire fixture, import → export → import every file fixture.
      CI rule: a diff touching any `DB_VERSION` without a new fixture
      fails. Today `tests/fixtures/` holds one normalizer file and two
      PDF stubs; `xray-audits` is at v7 with no upgrade-from-v(n) test.
      (M; WIRE-05.) This is what lets several refactor threads run
      without one silently stranding the casework corpus.
- [ ] **`tests/structure-guards.test.mjs`** pinning today's state with
      breaches allowlisted: import graph (no `nostr-client.js` outside
      `background/` except the three known breaches; no `document` in
      `shared/` except the four modals), the message set, surface
      `index.js` line-count ceilings, no `console.` outside `utils.js`
      and `page/`. Every later PR shrinks an allowlist; none may grow
      one. (S; ARCH-15.)
- [ ] **Branch and PR triage** per §9: merge the small fixes and the
      docs PRs in the order given, delete the 65 merged branches, park
      #370, rebase #374 and #324; land `scripts/branch-hygiene.mjs` and
      the weekly `hygiene.yml`; turn on auto-delete-on-merge and
      Dependabot auto-merge for devDependencies. (S.)
- [ ] **Split the JOURNAL now, not in R6.** `docs/journal/YYYY-MM.md`,
      append-at-bottom, `merge=union`, a generated index at the old path
      so every existing citation still resolves. It is the one file
      thirty of the forty-five open-PR pairs conflict on; nothing else in
      the reset can run in parallel until it moves. (S.)
- [ ] **PR template** gains the four body lines of §8 and loses the
      Firefox checkbox until Firefox parity is a stated goal; the CI
      PR-body checks and the JOURNAL-presence check for process-file PRs
      land with it. (S; T4's "PR template gains verification-layer and
      wire-format sections" checkbox is ticked and the template has
      neither.)
- [ ] **`docs/STATUS.md`** (hand-maintained until R6 generates it): the
      1.0 blocker list; every default-off flag with its check date and
      last casework evidence; the parked shelf; the open PR cap. (S.)
- [ ] **Fix the front-door lies now** (README version and counts,
      CHANGELOG reconstruction from merged PR titles, esbuild header,
      api-interceptor header, CLAUDE.md's four wrong claims). (S; B9.)

### R1 — Reconcile governance (week 2; one session, one PR)

- [ ] The ninety-minute session with D1–D6 (§4.3). Output: six ledger
      rows.
- [ ] One amendment PR: Art. 6 to one sentence; "fused" defined; Art. 2
      narrowed; Art. 7 sentence; Art. 11 amended; Art. 10 30066 row;
      TS H-2 "permanently" struck; PHILOSOPHY §13 entry — each edit
      conditional on the matching D-row's answer; "keep" on a row means
      that edit is dropped. If D1/D2 are taken: delete C2, the verbatim
      clause pins and the two dozen banned-word lists; add
      `isLicensedEstimate()` + the schema guard. If D5 is taken: add
      `// Provenance:` headers and the expiry check. (M.)
- [ ] The corpus reset: four normative documents; guidance re-labelled;
      `docs/archive/` with banners for the EPISTACK cluster, the shipped
      kickoffs (K13, saving the two case-workspace kickoffs as a design
      doc), FOUNDING_TRANSCRIPT, TRUTH_INFRASTRUCTURE. (M; nothing
      deleted.)
- [ ] #364 merge; #366 merge as the answered record; #365 fold. (S.)

### R2 — Scope the 1.0 and park the shelf (weeks 2–3)

- [ ] **Declare the 1.0 feature set:** capture (articles, Substack,
      YouTube + transcript, PDF, EPUB, podcast via direct cloud) → mark
      (claims with quotes, people/orgs, the article pass) → case (dashboard,
      brief) → share (publish 30023 + 30040 + kind 0 behind a pre-flight;
      one group path: key-free share export + merge-import). (Decision
      §11-1/2.)
- [ ] **Park behind one "Advanced analysis (experimental)" switch** with
      one check date (recommend 2026-11-30): truth adjudication, the
      moral lens, hypothesis maps, counterfactuals, AI vision, the
      Network page, and the publish paths for 30068/30069/30070. Hide
      their reader bars and portal blocks when parked; tests stay; each
      park gets a JOURNAL line with the revival condition "used on a real
      case." Epistemic audits and forensic findings stay visible (casework
      has touched them) with the same check date. Parking hides
      *views*, never data (Art. 3): every verdict, lens reading and
      hypothesis map the maintainer has already authored stays readable
      in one "Archived analyses" list on the case page, and every
      30068/30069/30070 event already published stays on the relays as
      it is. Existing `xray:flags` overrides for a parked family are
      read by the new switch, not silently dropped. (M; PROD-02; K3
      parked.)
- [ ] **Execute the ratified kills** K4, K8, K9, K14, K15 in one chore
      PR; K1's on-disk stores via a v4 `deleteObjectStore` ladder under
      schema-evolution review; K12/K13 with R6. (S+S; ARCH-10.)
- [ ] **Flags:** every `FLAGS_DEFAULTS` entry gets metadata (label,
      surface, leaves-machine, gates-kinds, since, check date); the three
      DevTools-only flags get a control or are hard-coded to their
      default and removed from the registry; a guard reads the dates.
      (S; PROD-09; B10/B11.)
- [ ] **Kickoff discipline guard:** any kickoff or design doc dated
      ≥ 2026-08-02 must carry success criterion / kill criterion / check
      date; retro-fit MARGIN_DESIGN with three lines. (S; PROD-08.)
- [ ] Demote Facebook/TikTok to "best effort, not release-gated" in
      README and the gate; label the companion "Developer / self-hosted
      (Windows)" and collapse its Options panel. (S.)
- [ ] Retire phase numbering for new work; existing numbers stay as
      historical labels; one-page kickoffs only until slice 1 has been
      used on a case. (Decision §11-8.)
- [ ] **Make the kind schedule true.** Kind 30041 (captured comments)
      goes local-only at 1.0 — today a "include comments" checkbox
      republishes strangers' text, handles and profile URLs under the
      user's key, on a number NKBIP-01 also uses, with no NIP_DRAFT
      section and no flag (WIRE-01). 30060/30061 move from `active` to
      `reserved — defined, never emitted` (no emit path exists;
      WIRE-02/12). Art. 10 gains a `gated` status so 30070 and the
      `xray/review` label stop reading as shipped (WIRE-11). Rows added
      for kind 1 (mention notes) and kind 5 (deletion of the user's own
      30078 blobs). The 30023 `d` derivation and the dual meaning of the
      `x` tag (own body hash on captures; cited members on case briefs
      and entity pages) get written down (WIRE-03/04). (S; B16;
      decision §11-11.)
- [ ] **Close the two workspace leaks:** `forensic_baselines`,
      `owned_keys_manifest_hash` and the `xray:audit:draft:*` keys are
      written outside the workspace classification lists, so they bleed
      across cases and are never merged or reset; classify them and add
      the guard "every storage key literal in `src/` is on exactly one
      list." (S; WIRE-06.) Flip `storeFirstPublish` on with its smoke
      rows walked once and drop the flag the release after — the journal
      is the only local golden record of everything signed and it is
      incomplete while the flag is off (WIRE-09; the maintainer's
      2026-08-02 store-first decisions say flag flips gate on the smoke
      rows alone, with no soak period).

### R3 — Structure for parallel work (weeks 2–6, lanes in parallel)

Strangler steps; every step leaves 2878 green. Nothing on disk is
renamed (storage keys, DB names, JSON-string values are one-way doors).

- [ ] **Lane A — registries as data.** `shared/bus/messages.js` (49
      entries: context, shape; `send()` throws on unknown);
      `shared/storage/keys.js` extending `workspace-keys.js` (scope,
      serialized, backup, credential); `shared/wire/kinds.js` (`KIND`
      names + `RETIRED`/`RESERVED` sets). Guards compare code to each
      registry; `backup.js` and `identity-profiles.js` derive their
      lists from the key registry. (S–M; ARCH-3/5/12; B16.)
- [ ] **Lane B — the dispatcher.** `background/dispatch.js` handler map
      keyed by the message registry, two handler shapes (`sync` and
      `job`), `return true` and `lastError` handled once; handler
      groups moved to `background/handlers/{relay,llm,transcribe,capture,surfaces,fetch-proxies}.js`
      one domain per PR; PR #374's job branches folded into the `job`
      shape at merge. (M; ARCH-9.)
- [ ] **Lane C — storage access.** Seven raw `preferences` readers →
      `Storage.preferences`; delete options' private layer; merge
      `portal-cache.js` + `network-cache.js` into one derived
      `relay-cache.js` (rebuildable, no migration); one `open-db.js`
      with `onversionchange`/`onblocked` written once; rename the
      *module* `audit-cache.js` → `casework-db.js` keeping
      `DB_NAME='xray-audits'`. (M; ARCH-5/7.)
- [ ] **Lane D — the reader's publish.** Extract a pure
      `reader/publish/plan.js` (`planPublish(state, flags) → PublishPlan`)
      with fixture tests — no DOM; then one module per family
      (article, claims, entities, assessments, truth, forensic, audit,
      accounts, summary) each returning `{confirmedOk, results}` via
      `publish-gate.js`; then peel transcribe / vision / lens / platform
      headers / Substack / comments into `reader/<area>.js`; sweep the
      103 bare `console.*` last. Surface line-count ceilings shrink
      per PR. Do this **under the net** (R0 first). (L; ARCH-1/2; its
      PRs are human-class and clear through the weekly batch like any
      other — there is no per-PR soak anywhere in this plan.)
- [ ] **Lane E — moves.** `git mv` the 57 single-caller `shared/` modules
      to the surface or domain that owns them; the four DOM modals to
      `shared/ui/`; domain clusters `wire/ storage/ llm/ media/ domain/`.
      Only when the count of open non-dependabot PRs is zero, because a
      move conflicts with everything. Bundle `api-pattern.js` into the
      interceptor's single-file build or delete it. (M; ARCH-8/11.)
- [ ] **Lane F — prompt hygiene (the `llm` lane).** The eight audit
      module prompts (`audit/module-prompts.js`, 1,329 lines) are
      GENERATED from `docs/auditor-prototype/prompts` by
      `tools/gen-module-prompts.mjs` with no drift guard; seven prompt
      versions (`corpus-v9`, `entity-page-v2`, `vision-v1`, …) are
      bumped by hand; no prompt wraps article text as data; the only
      prompt test is a shape test; and the recorded shape failures and
      paid repair rounds (JOURNAL 2026-08-22, 08-25) have no fixture. Add
      the drift guard, the data-block wrapper (§10), a fixture set built
      from the recorded failures that every prompt change runs against a
      stubbed model, and a prompt-version registry beside the flags. This
      is where "too buggy" mostly lives for the LLM features. (M.)
- [ ] Route `entity-sync.js`, `confirmed-publish.js` and the bunker
      client through `xray:relay:*` / `xray:sign` so only the worker
      opens sockets; shrink the allowlist to empty. (M; ARCH-6;
      decision §11-9.)
- [ ] `docs/ARCHITECTURE.md` GENERATED from the registries and the
      esbuild config, drift-guarded. (S; with R6.)

### R4 — The first hour, the publish pre-flight, and three surfaces (weeks 3–8)

Sequenced after R1 (the visual firewall and the vocabulary ban are
removed or demoted there) and R2 (the shelf is parked, so four reader
bars and ten portal blocks disappear for free). **Its first slice is
subtractive** — park, hide, rename, delete the lying controls, ship the
zero-state line, land the pre-flight — and needs no new Library surface;
if the R1 session slips, that slice proceeds under today's constraints
and only the reader fold and the Library wait. At most two of R3, R4
and R5 run at once; the August wave is what running everything in
parallel behind one human looks like.

- [ ] **First run.** `onInstalled reason='install'` opens Settings on a
      three-step welcome: identity generated *for* the user with one
      button (public key shown once; "Show nsec" under Your data);
      default relays pre-filled; one paragraph on what becomes public.
      Settings lands on Identity whenever no identity exists. A "?" in
      every header opens the guide section for that surface. The
      generated local identity is also what makes PR #324's Option C
      work for a newcomer: entity creation refuses without a local
      primary, so a NIP-07-only user is not a 1.0 configuration unless
      the maintainer says so (§11-9). Delivery channel declared: unlisted
      Chrome Web Store + AMO-signed `.xpi` with `update_url`, permission
      justifications from THREAT_MODEL. (M + store lead time; B7/B13;
      UXDE-01.)
- [ ] **Publish pre-flight.** One sheet assembled from the same selectors
      the loop calls — artifact class → count → signing key → relays →
      one irrevocability line — with Publish as its confirm. This is the
      *only* place "what becomes public" is explained; the eleven Advanced
      hint paragraphs shrink to one link. (M; B12; UXDE-02.)
- [ ] **One reading surface.** Re-cut PR #370's S1 with S2 as one change:
      archived opens render the article with a typed notes margin;
      the claims + proposals bars fold into it; the audit / findings /
      lens bars are card groups inside the same surface or hidden by the
      shelf switch. Ship the Margin's zero-state line ("Select any passage
      to add a claim or tag a person") in the bar *now*, before the fold.
      Reader header on first paint: case chip · Read/Edit · one "+
      Suggest ▾" whose menu names the cost · Publish. (L; UXDE-03/09/11;
      PROD-04/12; decision §11-3.)
- [ ] **Three surfaces, six nouns.** Reader · Library (replaces portal +
      sidepanel + network: Sources · Claims · People & orgs · Cases ·
      From people you follow) · Settings (Identity · Sharing · AI ·
      Transcription · Your data · Developer, autosave per control).
      User-facing nouns: source, claim, proposal, person/organization,
      case, publish, relay; family words only inside their own cards;
      wire and storage words (coordinate, ledger, artifact, workspace,
      corpus, atom, extraction, reconcile) never in chrome. One entity
      destination reachable from every chip. Case page = Sources /
      Claims / Analysis with headings that name the task ("Review 4
      proposals"); disclaimers move to "?" tooltips. "New case…" in the
      Library's Cases tab and the reader's case chip; K9 executed so
      the two wrong doors close. The side panel's verbs that exist
      nowhere else — create a person or organization, merge two, import
      an entities file, the compact dossier — move into Library ▸ People
      & orgs before the panel retires; the panel survives one release as
      a picker. (L, in slices; UXDE-04..08/13; PROD-13; T8 seam
      collapse.)
- [ ] Replace the eight "see console" terminations with remedies now
      that the diagnostics ring exists; remove the key-bearing export
      from beside routine exports. (S; UXDE-10/16.)
- [ ] **Twenty import/export verbs across four surfaces become three
      jobs plus Add ▾.** Settings → Your data: *Back up this machine*
      (full, keys), *Share a copy* (no keys), *Bring in a colleague's
      copy* (merge); content intake stays in the Library's Add ▾ (already
      right); audit-JSON import, registry import/export and the
      key-bearing case bundle move under Advanced with a red label.
      (M; NEWC-06; T8's "~10 verbs" is now 20.)
- [ ] **One AI verb per surface.** The same cached article pass is
      reached today as "✨ Suggest…", "Pre-analyze…", "Analyze each
      imported page" and the map stage of "Analyze corpus…", beside five
      more AI buttons; a user cannot tell what costs money, what leaves
      the machine, or what they already paid for. One **Analyze ▾** per
      surface whose items are named by what leaves the machine and what
      it costs ("Find claims & people — sends text to Anthropic, cached";
      "…on this machine (LM Studio)"; "Audit this article — 1 call / 8
      calls"); the consent strings survive verbatim (they carry a
      maintainer ruling); retire "Pre-analyze…" and the dead
      pending-suggest control. Transcription's two flags and three entry
      points become one flag and one engine picker that greys out what
      is unreachable. (S–M; NEWC-07/12; T8.)
- [ ] **The four lying controls** (§3) deleted in one PR; a `SURFACES`
      registry in `background/` so menu ids, `xray:open*` messages and
      the quick actions read one table. (S; NEWC-09; K4/K8.)

### R5 — Corpus automation: hundreds of URLs → captured → claims and entities → reviewed (weeks 3–8)

**What works today, at N≈10.** Paste ordinary HTML article URLs into the
portal's Import URLs panel with "Analyze each imported page" ticked:
each page is fetched from the extension origin, run through
Readability, archived with the canonical hash, tagged into the case,
and — per page, in the same worker slot — passed through the ONE article
pass, whose extract is cached under a content-only key and folded into
the durable `article-extractions` record as open proposals; the case
dashboard shows per-article folds with Accept all / Dismiss / Link all
covered, and the reader's Suggest serves the cached extract instantly.
The pure core is chrome-free and well tested. Keep it byte-for-byte.

**What breaks at N=100, in harm order.** (1) The batch is a portal
tab's click handler — nothing persists the URL queue, so a reload, a
sleep, or a worker loss ends the run silently, and re-running the paste
skips already-archived rows from analysis; PR #374 makes one in-flight
result durable, which is the right primitive but not a queue. (2) The
one review surface that scales — the portal's Accept all — drops the
entity half of the pass: the durable record stores no entities and no
per-atom `about` links (`map-artifacts.js:95-108`), the portal mints
every claim with `about: [caseId]` only (`extraction-block.js:372-380`),
and entity proposals exist only transiently in the reader modal, one
article at a time. "Claims + entities for hundreds of URLs" is today
"claims at scale, entities one tab at a time." (3) Rate limiting is one
fixed 15-second retry with no `Retry-After` and no backoff, across three
independent drivers each at concurrency 2. (4) Fetch import cannot see
JS-rendered pages, bot walls, or any platform handler — YouTube,
Twitter, TikTok, Instagram, Facebook and the Substack API all need a
live tab — and the marker path opens an unclosable reader tab per
capture, one URL at a time. (5) Cost and time are unmeasured: usage is
returned by the API and dropped; the confirm counts calls, not dollars.

**Cost, estimated and declared** (inputs: the measured ~1.4k-token
prompt overhead, assumed article lengths, output roughly re-emitting the
source once; Art. 5.2 conditions 1–3): 100 mixed articles through the
one-article pass ≈ $9–12 on Sonnet 5, $23–30 on Opus 5, $48–65 on Fable
5, in 25–40 minutes at two in flight if no 429s; N=500 ≈ $45–60 on
Sonnet 5 and 2–3 hours. None of it is visible to the user before or
after a run.

**What the constitution actually gates.** Nothing in it requires a
human click before a proposal is stored locally: Art. 4.1 asks for a
followable citation (grounding satisfies it mechanically), Art. 4.7 for
method and provenance (stored), Art. 6 for never-merge (the ladder never
auto-merges), Art. 8 puts accountability on the *published* record
"never as a gate on the pursuit of truth." The "every proposal is
human-accepted" rule lives in four agent-authored places (questionnaire
Q11, E5) and the maintainer's MA.6 ruling already publishes unreviewed
atoms with their state. The human gates are **publish** and **entity
merge**; "accept" becomes a review state a human can set in bulk. That
ruling (decision §11-10) is what makes every slice below lawful.

- [ ] **Slice 0 (S, CI).** The browser harness in CI (R0) — it is the
      same asset this track builds on.
- [ ] **Slice 1 — capture at scale (M).** One Playwright harness
      (`tools/harness/capture.mjs`) reusing the smoke walk's launch
      block, on a persistent profile so logins survive, fed by a URL
      file: hosts with no platform handler go through fetch import first
      and are accepted only if they pass the interstitial tells; every
      other URL opens a tab at `<url>#xray:capture`, waits for the stamp,
      reads the archive result from the extension page, closes both
      tabs. It runs the content script, every platform handler, the
      transcript fetch and the PDF route unchanged; a fixture-site CI
      test captures one static page, one SPA and one PDF and asserts
      archive rows. A native-messaging capture service was considered
      and rejected: it re-implements what loading the extension gives
      for free and adds an install step the companion already shows is a
      support burden. The manual paths (toolbar, Import URLs) survive.
- [ ] **Slice 2 — one queue (M).** Shared concurrency (a `maxConcurrent`
      on #374's runner, so every driver queues through it),
      `Retry-After`-aware exponential backoff with jitter for 429 only,
      usage persisted on every cached extract and job record, a cost
      line before a run (estimate, labelled as such) and after ("this
      corpus has cost $X across N calls, M cached"); measure
      `effort: "low"` on the map pass against current output — that, not
      prompt caching, is the lever.
- [ ] **Slice 3 — entities in the durable layer + triage (M; needs the
      §11-10 ruling).** Fold `entities` and per-atom `about` refs into
      the `article-extractions` record (additive; `xray-audits` v8 under
      schema-evolution review) and give the portal an entity fold that
      runs the same resolution ladder, so Accept all mints claims *with*
      their links resolved by identity rungs and leaves near-name rungs
      as the human's pick. Then one corpus-wide proposal table (quote /
      paraphrase / article / load-bearing / entities / status), default
      sort load-bearing-first, filters by entity and article, bulk state
      changes with one batched write per record, "Accept all
      load-bearing across the case" as the headline action. No scores,
      no confidence ordering. Until it lands, label the portal's Accept
      all honestly: "mints claims without entity links."
- [ ] **Slice 4 — a resumable intake job in the worker (M).** A
      `corpus-intake` job record `{urls[], cursor, perRow.status}` driven
      from the service worker (fetch is legal there; the runner already
      sweeps on boot), with Readability in an offscreen document
      (`DOMParser` is unavailable in a worker) and the portal as a viewer
      that can close. Success criterion: **200 URLs from a text file →
      archive + proposals overnight with the portal closed.**
- [ ] **Slice 5 — the pass outside the browser (M; security review of
      key handling first).** Everything but the API-key read and the
      message hop is node-runnable today. A CLI over an esbuild node
      bundle of the shared modules takes a backup export, runs the same
      unit builder → cache key → request → repair → validate → merge
      chain with the key from an environment variable, and emits an
      `xray-backup/1` file of `corpus-extracts` and
      `article-extractions` rows that Import & merge ingests with quotes
      re-grounded locally (the MA.7 seam). Cost, parallelism and resume
      then live in a process the researcher or CI controls; the browser
      stays the only publisher.
- [ ] Frontier expansion (follow outbound links from captured articles)
      second, behind a per-case cap — only after the URL-list path has
      been used on a real case.

### R6 — The documentation system (weeks 3–6, lane parallel to R3)

The system in §5: four registries → one generator → one guard file;
JOURNAL split per month (done in R0) with a generated index; rulings ledger;
CLAUDE.md ≤ 200 lines; ROAD_TO_1_0 archived and its open ids in a
tracker; SMOKE_TEST split into a ≤30-row `GATE.md` (every row tagged
`machine` / `agent-live` / `human`; every `machine` row names its
scenario file; the walk ledger with a minutes column at the top) and an
archived appendix; the docs index generated from front matter;
`docs/` `tests/` `tools/` `.claude/` out of the release zip; phase
numbers out of user-facing text. (M in total; DOCC-1..20; K12/K13.)

### R7 — Release (after R4's first slice and R6's gate)

- [ ] Install the built zip into a clean profile and run `GATE.md`
      against it — the artifact under test is the artifact shipped.
- [ ] The two-person, two-machine walk on a live case with the
      key-free share export + merge-import as the one supported group
      path; decide `networkPage` on that evidence. (B14/B15; T5.)
- [ ] Decide Firefox: run the gate on 128 ESR once and record it, or
      narrow the claim to "capture-only, community-supported." Either
      way one Firefox row joins the gate as a human row, because the
      security bundle (on-demand MAIN-world injection, the
      `web_accessible_resources` removal) is exactly where Firefox 128
      differs from Chrome, and any Firefox install at all needs AMO
      signing.
- [ ] NIP_DRAFT labels every kind no default-on path emits as
      "experimental — may change" with its flag name; 1.0 promises
      30023, 30040, 0, 10002, 30078 (+32125/32126 if entity publishing
      stays). (Decision §11-11.)
- [ ] The minimum security work before a store listing, mostly
      subtractive (§10): delete both `declarativeNetRequest` rules and
      the permission after one YouTube transcript walk; inject both
      MAIN-world scripts on demand with a token in `args` and drop the
      `ready` broadcast, the WAR entry and the `<all_urls>` CSS; one
      `url-admission.js` in front of every worker fetch; the key-free
      export as the default button and a passphrase on the recovery
      backup's identity block; the data-block prompt wrapper and the
      reviewed-rows-by-default 30070 publish; `PRIVACY.md`, an accurate
      AMO data-collection declaration, and permission justifications
      derived from THREAT_MODEL; the six threat-model corrections and
      the CI diff check that keeps the map current;
      `referrerpolicy="no-referrer"` on reader image emissions. (M; B5,
      T2 and T5 open items; G1/G3/G4/G6/G7.)
- [ ] `scripts/release-preflight.mjs` to the ordering the skills README
      already declares; the tag; the release-environment approval stays
      human.

**Dependencies.** R0 before everything. R1 before R4's reader and case
page (they inherit the constraints R1 removes). R2 before R4 (parking
removes surfaces R4 would otherwise redesign). R3 lanes A/B/C/E are
independent of each other and of R4/R5 once R0 exists; lane D needs R0's
net. R5 slice 1 needs PR #374 merged (or folded into R3 lane B). R6 runs
beside R3. R7 needs R4's first slice, R6's gate, and the store lead time,
which should start the day R0 lands.

---

## 8. Keeping it right — the operating model

**Branching.** Trunk-based, short-lived branches, no long-lived
integration branch. Trunk-based fails when a half-done refactor on
`main` breaks casework; the strangler pattern (new path behind a flag or
a re-export, old path deleted in a later PR), the PR size cap, and the
machine smoke on every PR counter it — `main` is always the build the
maintainer uses. An integration branch fails the way PR #324 already did
in miniature: it drifts for weeks while fixes keep landing on `main`
(they must — casework never stops), every fix is double-landed, the
final merge is one giant human soak nobody can run, and the JOURNAL
conflicts multiply with the branch's lifetime.

**Parallel threads.** One `git worktree` per thread
(`git worktree add ../xray-<lane> -b <lane>/<topic> origin/main`; `npm ci`
once per worktree; never two threads in one checkout). A thread is
assigned a **lane**, never a feature; a PR's `src/` paths must fall in one
lane or its body carries `Cross-lane: <reason>`, and a CI path check
enforces it. The lanes, derived from today's tree (they move with R3's
directory moves):

| Lane | Owns today | First job |
|---|---|---|
| `bus` | `background/index.js`, `nostr-client.js`, `session-articles.js`, `llm-jobs.js` (#374), `transcriber-client.js`, `direct-transcribe*.js`, `screenshot.js`, `companion-status.js` | dispatcher map + one handler file per family |
| `capture` | `content/**`, `page/api-interceptor.js`, `platforms/**`, `content-detector.js`, `content-extractor.js`, `content-islands.js`, `url-import.js`, `url-identity.js`, `url-aliases.js`, `epub-parse.js`, `pdf-*.js`, `media-hints.js`, `html-snapshot.js`, `rules/` | platform fixtures + canary; the DNR removal |
| `identity` | `page/nip07-bridge.js`, `crypto.js`, `signer.js`, `local-key-manager.js`, `nsecbunker-client.js`, `identity/**`, `identity-*.js`, `workspace-keys.js`, `media-key.js` | #324; on-demand bridge injection |
| `wire` | `event-builder.js`, `nostr-events.js`, every `*-publish.js`, `truth-builders.js`, `audit/builders.js`, `audit/publish-batch.js`, `metadata/builders.js`, `publish-gate.js`, `confirmed-publish.js`, `wire-copy.js`, `docs/NIP_DRAFT.md`, the Art. 10 table | the kinds registry; every PR carries `Wire format:` |
| `store` | `storage.js`, `archive-cache.js`, `audit/audit-cache.js`, `event-journal.js`, `backup.js`, `workspace-read.js`, `metadata/feature-flags.js`, `config.js`, `map-artifacts.js`, `case-bundle.js`, `extraction-import.js` | golden fixtures; the key registry; other lanes add a flag by a one-line PR here first |
| `reader` | `reader/**`, `claim-*.js`, `quote-grounding.js`, the four modals, `transcript-*.js`, `diarized-transcript.js`, `vision-*.js`, `speakers-modal.js` | `publish()` → `reader/publish/*.js` |
| `portal` | `portal/**`, `case-*.js`, `corpus-*.js`, `hypothesis-*.js`, `cross-case-graph.js`, `article-pass.js`, `entity-page*.js`, `entity-dossier.js`, `review-queue.js`, `audit/corpus-*.js`, `audit/known-unknowns.js`, `audit/cross-coverage.js`, `reference-resolver.js`, `scholar-refs.js`, `crossref.js` | the case page's three tabs; the triage table |
| `surfaces` | `options/**`, `sidepanel/**`, `network/**`, `network-feed.js`, `network-trust.js`, `follow-*.js`, `incorporation.js`, `entity-model.js`, `entity-resolution.js`, `entity-equivalence.js` | the first hour |
| `llm` | `llm-*.js`, `llm-stream.js`, `corpus-prompts.js`, `lens-*.js`, `jurisdiction-model.js`, `audit/module-prompts.js`, `audit/audit-prompt.js`, `audit/assemble.js`, `audit/findings-schemas.js`, `audit/run-orchestrator.js`, `provider-normalize.js` | the shared queue, backoff, usage accounting |
| `toolchain` | `.github/**`, `scripts/**`, `tools/**`, `esbuild.config.mjs`, `tests/helpers/**`, `tests/*-guards*.test.mjs`, the doc generators, `CLAUDE.md`, `CONTRIBUTING.md`, the journal index | the browser smoke, the hygiene script, the PR-body checks |

Shared-hot files and their rule: the JOURNAL becomes `docs/journal/YYYY-MM.md`, append-at-bottom, `merge=union` in `.gitattributes`, with a generated index at the old path; `CLAUDE.md`'s module list becomes a generated block; `docs/SMOKE_TEST.md` splits per lane under one ledger; `feature-flags.js` takes one key per PR, appended. The lane rule binds *edits*, not imports: the reader may import `article-pass.js` and `corpus-prompts.js` from other lanes freely; it may not edit them without `Cross-lane:`. Agent sessions are told their branch name in the session prompt (`<lane>/<topic>`), and CLAUDE.md carries the lane table so a session can look its lane up. The structure guard is the collision detector: a PR that grows an allowlist or edits outside its lane fails review.

**PR size and count.** ≤ 400 changed lines of `src/` per PR except pure
`git mv` / re-export PRs (which claim zero behavior change and must pass
build, suite and smoke unchanged); **at most four open non-dependabot
PRs** (a new one is not opened until one merges or is parked); one
concern per PR, as CONTRIBUTING already says; never a PR that both moves
and changes.

**PR body contract** (template): `Verification layer: unit | guard |
machine-smoke | human-soak | none-because <…>` · `Wire format: none |
additive | breaking | new-kind | retirement` (only when a builder or
publisher changed) · `Docs: none | <files>` · `Interpretive steps (n):`
one line each with a recommended default.

**CI gate, identical for every branch:** node --check → ESLint
(`no-undef`, `no-unused-vars`, console ratchet) → build → `npm test`
(≤ 60 s budget) → python parity → version lockstep → web-ext lint →
web-ext build + packaged-contents assertion → bundle budget →
**machine smoke** → doc-currency guards → structure guards → PR-body
checks (a `fix:` PR needs a `tests/` diff or a `no-test rationale:`).

**Tiered soak.** A change whose principal risk is a DOM state, a stored
record, a built event, a message round-trip, or a rendered string is
*machine-class* and merges on green. A change is *human-class* only if
it spends money against a real provider, publishes to a real relay,
involves a NIP-07/NIP-46 popup, tears the service worker down mid-job,
touches a live third-party site, or has a judgment pass criterion
("reads true"). Human-class PRs merge on green with a `soak:pending`
label and are cleared in **one weekly 30–45 minute session**: the
toolchain lane cuts `rc/YYYY-WW` from `main`, one agent assembles a
single `hand-to-maintainer` list from every pending PR (ordered by what
fails worst, capped at about eight items, money items marked), the
maintainer works a real case on that build and replies with numbers, one
ledger row per week records the minutes, and each label flips to
`soak:pass` or `soak:fail` (a fail is a `fix:` PR at the top of the
queue, never a revert of a flag-off change). The urgent waiver stays.
The maintainer's merge instruction stays the ratifying act; the *waiting*
stops being the gate. Today's batch, if adopted now: #374's reduce row,
#368's Instagram row, #324's refusal row — about 25 minutes.

**Verification rules.** Every escaped bug gets a permanent observer at
the cheapest layer that could have seen it. Source-grep guards are
admitted only for un-importable modules or normative documents, must
assert a class rather than a token sequence, and must name their
negative control. One cited `chrome-stub.mjs` replaces the 138 inline
stubs. A weekly `canary.yml` runs one real URL per platform handler and
opens an issue labelled `rot`; it never blocks merge.

**Decisions.** The marker protocol of §4.4. A maintainer ruling is one
ledger row; an agent interpretation carries its default and its expiry;
the PR body lists interpretive steps; questions arrive one at a time
with "keep" as a complete answer.

**Scope.** No new phase numbers. `docs/STATUS.md` (generated in R6) is
the one place that says what is blocked, what is parked, and when each
flag is next checked. Every default-off flag has a check date and a
falsifier; a feature that no real case has used by its check date is
parked, and a parked feature that no case asks for by the next date is
killed on the record. One-page kickoffs (problem / success criterion /
kill criterion / check date / what the maintainer must do) until slice 1
has been used on a case.

**Skills.** Each discipline's graduation clause gets an executor: the
review that cites a breach adds the guard in the same PR (allowlisted if
it cannot be fixed inline). A skill whose reports nobody acts on for two
release cycles is retired by its own kill rule.

---

## 9. Branches and pull requests — dispositions

**A correction first.** The first draft of this plan described ~30
"pre-reset" branches descending from a rewritten history. That was a
clone artifact: the audit container's checkout was shallow (four graft
points). After `git fetch --deepen`, `origin/main` has 904 commits back
to 2026-04-19 and **65 of the 79 remote branches are plain ancestors of
`main`** — merged content, nothing to archive. The only genuinely
unmerged old branch is `feature/phase-9b-metadata-ui` (six commits,
2026-05-29; JOURNAL 2026-07-03 kept it as the only copy of an unbuilt
overlay whose ranker/trust-graph substrate K1 since killed). Every
future audit starts with `git fetch --unshallow`.

**Throughput today is zero.** `main` has had no commit since 2026-08-28.
Four ready behavior PRs wait on the soak rule and two more are drafts. Of the 45 pairs of open PR
branches, 30 conflict — every one of them in `docs/JOURNAL.md` and
nothing else, because the JOURNAL prepends at the top; `main` carries 54
"Merge main into …" commits whose only job was resolving that hunk.

**Open PRs.** Conflict status against `main` checked with
`git merge-tree`; only #324 conflicts, and only in `docs/JOURNAL.md`.
Merge order to minimise rebases: #373 → #369 → #368 → dependabot → #366
→ #364 → then rebase #374 and #324.

| PR | Branch | Disposition | Why / what it still needs |
|---|---|---|---|
| #373 | claude/kind-hypatia-fu8nqm | **Mark ready and merge now** (+408, 288 of them tests; a draft today) | tolerance fix for stored malformed records; no behavior change on well-formed data; machine-class |
| #369 | fix/publish-without-session-record | **Merge now** (+139) | removes a refusal; unit-tested; NIP-07 path unchanged by inspection; machine-class |
| #368 | fix/instagram-url-identity | **Merge now after `git rm docs/superpowers/plans/2026-08-28-margin-s1-see.md`** (+608, of which 421 lines are an unrelated Margin plan file that rode along) | a wire-truth fix (wrong-account attribution on a signed public event). One human row: open a public Instagram reel by in-app navigation from a profile page, capture, expect the reader URL to be `instagram.com/reel/<shortcode>/` and never another account's path (~3 min). Already-published events whose `d` came from a stale `og:url` are not superseded — the right outcome; say so in its JOURNAL line |
| #371, #372, #375, #376 | dependabot/* | **Merge now**; enable auto-merge for devDependencies and actions on green | lockfile bumps; CI is the test; runtime deps (`readability`, `pdfjs-dist`, `turndown`) stay manual because they ship in the bundles. #376 is the recut of #335 |
| #366 | docs/governance-reconciliation-questionnaire | **Merge now** into `docs/ideas/` as the unanswered agenda (rebase five commits) | questions, no rulings; docs-only, soak-exempt; a held docs branch is the pattern that rots. Answers land in place, dated, after the R1 session (its own Q19) — the governance lens preferred merging only the answered record; the branch lens's timing wins because nothing in it binds anyone |
| #364 | claude/practical-ramanujan-sk12k1 | **Merge now** (mark ready; docs only) | advisory review report; then execute its A1/A2/B2/C1/C2/D1/E1 as one small PR; its B1 (a surface-constraints index) is R1's fourth normative document |
| #365 | claude/loving-gauss-k8gsta | **Fold** (+528; a 453-line skill that mirrors the corpus it governs) | keep the review standards (~50 lines) inside `architect` or as a ≤120-line skill; keep the README routing rows; do not merge the mirror — a second drifting copy is the doc-drift class the skills README itself names |
| #374 | claude/eager-knuth-ipv3xd | **Mark ready, rebase and merge after #369**, folded into R3 lane B's `job` handler shape (a draft today) (+1,580; `shared/llm-jobs.js` 534 lines; touches `background/index.js` beside #369 in non-overlapping hunks) | the job model is right and is the precedent for every long pass. One human row, money: with a case whose extracts are all cached, click Analyze corpus, reload the portal mid-run, reopen the case, click Analyze again — expect "(no new synthesis call)" and exactly one reduce request in the Anthropic console (~5 min + one paid reduce) |
| #324 | claude/nip07-option-c | **Rebase and merge after the browser smoke exists** (+390/−57, 31 files; 26 days old; JOURNAL conflict only) | a ratified decision (Option C) with five adversarially found leaks already fixed; its live walk (entity creation under Local and under NIP-07 with no local primary; expect the named refusal) is one row in the weekly human batch. Once golden fixtures exist (R0), confirm legacy random-keyed entities (`derived_from: null`) still load and sign |
| #370 | feat/margin-s1 | **Park** (close the PR, keep the branch, tag `archive/feat-margin-s1-20260906`) and re-cut as S1+S2 in R4 — or merge with a four-row walk | the direction is right; merging a flag-off fourth view adds a surface to a product whose problem is too many surfaces, and its fourteen-row walk is mostly guard carriers. If the maintainer will open archived articles in Annotated during real casework in the next two weeks: merge after M.1, M.2, M.7, M.8 (~10 min), the other ten recorded as accepted risk, check date 2026-09-30 |
| #377 | claude/xray-audit-refactor-opxk01 | this plan | corrected per the branch lens before merge |

**The 65 merged branches:** delete, no tags — a tag on a commit already
reachable from `main` adds nothing. **`feature/phase-9b-metadata-ui`:**
tag `archive/feature-phase-9b-metadata-ui-20260529` and delete.
`scripts/branch-hygiene.mjs` does both and never touches a branch with an
open PR.

**The rules going forward** (enforced by the script, a weekly
`hygiene.yml`, and two repo settings): auto-delete the head branch on
merge; a branch whose tip is an ancestor of `main` is deleted; a branch
with no open PR and no commit for fourteen days is tagged
`archive/<name>-<yyyymmdd>` and deleted; branch names are
`<lane>/<topic>` (agent sessions included — the lane prefix is what the
path check reads); `main` is squash-merge only, linear history, force-push
forbidden, required checks = the whole gate; at most four open
non-dependabot PRs (the script opens an issue when exceeded); Dependabot
devDependency and action bumps auto-merge on green.

---

## 10. Security and wire notes that the plan depends on

The security posture is better than its documentation and much better
than its manifest. The parts attacked on paper and fixed — the NIP-07
return path verification, verify-on-ingest on every relay read, the
credential class excluded from every export and guarded, the pinned
cloud origins with key scrubbing, the loopback pins, no telemetry, no
remote code, the capture stash in `chrome.storage.session` — would pass
a serious reviewer; keep all of it. What blocks a store listing is the
shape the extension presents to a reviewer and to a target's website:

- **Both `declarativeNetRequest` rules serve a fetch path the service
  worker's own handler comment declares dead** (`background/index.js:1023-1032`,
  which also cites a rules file that does not exist; the 2026-04-19
  JOURNAL entry records the PO-token gating that killed it). Rule 1
  removes four CSP headers from
  every main frame and sub-frame on every site, with no domain
  condition; rule 2 rewrites `Referer`/`Origin` to youtube.com for any
  site's XHR to the timedtext endpoint. The live transcript fetch runs
  in youtube.com's own MAIN world, which no youtube.com CSP could block
  without breaking YouTube's player. Delete both rules, the `rules/`
  directory, the manifest block and the permission in one PR, correct
  the three documents that call the strip YouTube-scoped, add the guard
  that any CSP-removing rule must carry a domain condition, and hand the
  maintainer one YouTube transcript walk before merge; the fallback if
  the walk fails is `enabled: false` plus `requestDomains`, not the
  status quo. (SECU-1; B5, G3.)
- **Every page can detect X-Ray.** `nip07-bridge.js` runs at
  `document_start` on `<all_urls>` and announces itself by
  `postMessage` to every page; the `web_accessible_resources` entry
  makes the extension fetchable by its stable id from any site; on
  Facebook, Instagram and YouTube `window.fetch` and `XMLHttpRequest`
  are replaced with page-visible wrappers and three console lines are
  logged unconditionally. Against the threat model's own asset list
  ("the operator's capture pattern discloses who is under scrutiny"),
  that is asset three leaking passively. Fix: inject both MAIN-world
  scripts on demand via `scripting.executeScript` — the bridge only on
  the source tab when signing is NIP-07 and a sign is first needed, the
  interceptor only when a capture starts on FB/IG/YT — with a CSPRNG
  token passed in `args`. That is also the only real fix for the
  unauthenticated `xr:apihook:event` channel (G1): the token T2 planned
  to mint inside a `postMessage` envelope is readable by the page and is
  not a control. Drop the `ready` broadcast, the WAR entry (after one
  controlled re-test of the 2026-08-10 NIP-07 break, which may have been
  a stale bundle), and the `<all_urls>` CSS injection. (SECU-4/7.)
- **There is no privacy disclosure, and the Firefox manifest says the
  extension collects no data** (`data_collection_permissions: none`)
  while its core function transmits captured page text and URLs to
  relays permanently and, opt-in, to three cloud providers. Both stores
  require the disclosure. Write `PRIVACY.md` in the threat model's asset
  order (what leaves the machine, to whom, when, what never leaves), set
  the AMO declaration accurately, and derive the listing's permission
  text from THREAT_MODEL §3. (SECU-2; T5.)
- **The threat model and the T2 ledger record as done six things the
  tree reverses or never did** — the WAR entry "removed" but present
  and guard-pinned to stay, the console lines "gated" but not, the
  CLAUDE.md reference that does not exist, G4 "scheduled" though the
  shareable export shipped. One correction PR, then the security skill's
  own graduation: a CI step that fails when a diff touches
  `manifest.json`, `rules/`, `src/page/` or adds a fetch destination
  without touching THREAT_MODEL. (SECU-3/10.)
- **Prompt injection from a captured page reaches a durable store before
  any human acts and can leave the machine under the operator's
  signature** as kind 30070, with only `status: unreviewed` marking the
  rows. Grounding protects the `quote` field; the paraphrase, entity
  names, `about` refs and open questions are model-authored. Fixes:
  every prompt builder wraps article text in a labelled data block with
  a one-line "do not follow instructions in it"; the 30070 publish
  defaults to reviewed rows with an explicit "also publish N unreviewed"
  checkbox (a wire-visible behavior change; the format is unchanged —
  decision §11-6); the unreviewed count shows in the confirm regardless;
  import-produced records carry `producer: 'import'` so the dashboard
  can say "N records from pages you have never opened." (SECU-5; G7.)
- **The default backup drops the operator's nsec into Downloads in
  cleartext; the key-free export is the second button.** Make the
  shareable copy the primary button, relabel the full backup "Recovery
  backup (contains your identity)" behind a typed confirm, and encrypt
  its identity block with a passphrase (NIP-49 for the nsec, the NIP-44
  already in tree for the block). (SECU-6; G4/G6.)
- **Three copies of the private-address gate, and two service-worker
  fetches use none** — the Substack proxy takes `apiOrigin` from the
  stored article record (which can arrive by relay reconstruction or
  merge-import) and fetches with credentials; URL import admits any
  `http(s)` URL with credentials. One `url-admission.js` in front of
  every worker fetch. (SECU-8.)
- **The companion service** stays in the repo with its own dependency
  stream; its Python tests join the CI gate (a T4 checkbox); its URL
  admission is blind to DNS rebinding (THREAT_MODEL G8) and its
  "audio leaves the machine" disclosure belongs in `PRIVACY.md`. It is
  a developer tool for 1.0 (§11-7), so none of this blocks the store
  listing; all of it is owed before the companion is offered to anyone
  else.
- **Kind census for 1.0** (the wire-and-schema report carries the full
  table with emitter, gate, public-relay evidence and consumer per
  kind). Emitted by today's code — which is not the same as "ship in
  1.0", see §11-11: 30023 (article, case brief, entity page), 30040, 0, 1, 3,
  5, 10002, 30078, 32125, 32126, 30054/30055 + 1985 mirrors, 30056–30059,
  30062 + mirror, 30063 + mirror, 30064, 30068, 30069. Gated-unwalked:
  30070 and the `xray/review` label (DevTools-only gates; 30070 has only
  ever been built against a loopback relay). Reserved: 30060/30061
  (never emitted), 30065, 30050–30053, 9803. Free: 30066. Retired
  (parsers kept): 30043, 30067. Local-only at 1.0: 30041. Eleven kinds
  have named constants under three naming conventions; thirteen are
  literals in their builders and in read filters across fifteen
  non-builder files — R3 lane A's kinds
  registry becomes the single source that Art. 10, NIP_DRAFT and the
  guard are generated from (B16). NIP_DRAFT (108 KB) cannot pass the
  second-client test today: 30041 and 30078 have no section, the 30023
  `d` derivation is unwritten, and the `x`-tag section never
  cross-references the second meaning that the entity-page and
  case-brief sections give it — so no consumer rule says "filter by `t`
  before treating `#x` on a 30023 as identity" (WIRE-03/04/13).
- **Six interchange envelopes** exist (`xray-backup/1`, the shareable
  copy, `xray-case-bundle` v1 — which carries entity *private keys* by
  design, `xray-audit-ledger/1`, the signed-event journal export, the
  case export) with different trust properties and version gates. For
  non-technical groups the file *is* the collaboration surface: collapse
  to one `xray-export/2` envelope with a `contents` discriminator and
  one importer; keep the old envelopes readable forever; private keys
  travel only in the user's own backup, never in a case bundle —
  creator binding (30069 + NIP-26) exists so collaborators need not
  share an nsec. (WIRE-07; decision §11-11.) Kind 10002 relay-list push
  is a blind overwrite while the kind-3 mirror fetches and unions; copy
  the kind-3 pattern (WIRE-10).
- **Persisted shapes a refactor must preserve byte-for-byte:** every
  `chrome.storage.local` key and the façade's JSON-string value
  convention; the five IndexedDB database names and their version
  ladders (`xray-archive` v3, `xray-audits` v7, `xray-events` v2,
  `xray-network` v1, `xray-portal` v1) and every rung on the upgrade
  path; `generateDTag`, the article-hash normalization and
  metadata-header strip, every `d` formula, the claim id formula, the
  `xray-entity-v1` HKDF domain string (changing it re-keys every derived
  entity), the `__xrayBytes` marker; `xray-backup/1` with its
  `xrayVersion` and `dbVersions` stamps. Only the two *derived* caches
  may be merged before 1.0 (delete-and-rebuild, not migrate). Ladders
  collapse only on the fresh-install path: an `oldVersion === 0` branch
  that mints just the live stores, while upgrades keep every frozen
  rung (WIRE-08). Rows written after 1.0 carry a `v: N` stamp so a
  normalizer can branch on vintage (WIRE-14).

---

## 11. Maintainer decisions — batched, with recommended defaults

"Keep unchanged" is a complete answer to every one. Provenance grades
follow PR #366's scale (E1 explicit ruling … E5 ratified-by-merge only).

1. **Who is the 1.0 user?** Default: a solo researcher first; the
   key-free share export + merge-import as the only group feature; the
   Network page post-1.0. (Provenance: ROAD_TO_1_0's "groups" yardstick
   was an agent synthesis; the maintainer's own LIBRARIAN seed says
   "useful and usable by more than just me — for now.")
2. **Which judgment families ship in 1.0?** Default: claims (+ local
   assessments as a stance on a claim), with epistemic audits and
   forensic findings kept visible because casework has touched them.
   Park verdicts, integrity, lens, hypothesis maps, counterfactuals, AI
   vision and the Network page behind one switch; every family,
   visible or parked, gets the same check date 2026-11-30. (E5 per
   family. The product-manager lens would park audits and forensics
   too — §12 records the disagreement.)
3. **The Margin:** merge S1 as a fourth view, or re-cut S1+S2 as the
   reader's single surface in R4? Default: re-cut, sequenced after the
   first hour; if merged now, the five-row walk. (E5 slice ladder; your
   2026-09-05 remark.)
4. **The reconciliation session's six decisions D1–D6** (§4.3). Default:
   as stated there.
5. **Replace the per-PR soak with the tiered gate** the day the smoke job
   is required on `main`? Default: yes; minutes recorded from today
   either way. (Your 2026-08-23 ruling, made when no browser layer
   existed.)
6. **Delivery channel and the security bundle it forces.** Unlisted
   Chrome Web Store + AMO-signed `.xpi`, or a signed zip with a
   developer-mode caveat? Default: store + AMO; Firefox "capture-only,
   community-supported" until the gate runs on 128 ESR. On a store, all
   of §10 becomes a hard gate; confirm the four calls inside it: delete
   the CSP strip and the `declarativeNetRequest` permission (rather than
   scope them); inject both MAIN-world scripts on demand (a NIP-07 user's
   signer prompt then appears on the first sign instead of the bridge
   being pre-warmed on every page); default the kind-30070 publish to
   reviewed rows with unreviewed rows opt-in (a change to your
   2026-07-29 whole-unit posture, made before batch import made hundreds
   of unopened pages the normal input); passphrase-encrypt the recovery
   backup's identity block. (B7; the CSP strip is v0.3.0 agent
   housekeeping with no maintainer ruling; the AMO "collects no data"
   value has no JOURNAL entry at all.)
7. **The companion transcriber:** user feature or developer tool?
   Default: "Developer / self-hosted (Windows)"; direct cloud is the
   documented path. (The flag comment cites the 2026-04-19 arms race;
   DC.1 removed the premise.)
8. **Retire the phase model** for new work (frozen numbering, one
   STATUS page, one-page kickoffs, a PR cap of four)? Default: yes.
   (Issue #20's parity plan; nothing since ruled on process.)
9. **Structure:** confirm the five ARCH questions — keep the three
   precious IndexedDB databases separate before 1.0 (merge only the two
   derived caches); keep JSON-string storage values on disk but one
   reader; "only the worker opens relay sockets" as a hard rule with a
   guard; `git mv` the `shared/` split; generate the description layer
   from registries. Default: yes to all five.
10. **"Hundreds of URLs" — four calls.** (a) Is a human click required
    before an LLM proposal becomes a *locally stored* claim, or only
    before it is *published* and before an entity is *merged*? Default:
    publish and merge are the human gates; local proposals carry a
    review state a human can set in bulk; DISCIPLINES §15.3 narrows to
    "one publish decision per artifact." (b) A pasted URL list first,
    with platform URLs captured by a Playwright harness that drives the
    real extension; frontier expansion second behind a per-case cap.
    Default: yes. (c) May the extraction pass run outside the browser as
    a CLI over the same modules, key in an environment variable, results
    ingested through Import & merge? Default: yes, after a security
    review of key handling; the browser stays the only publisher. (d)
    Should the durable extraction record become the review surface of
    record, with a corpus-wide triage table, and should Accept all wait
    for entities in the durable layer? Default: yes and yes; label the
    button until then. (Your 2026-09-05 ask; the accept rule lives in
    four agent-authored places, E5; MA.6's whole-unit disclosure is
    yours; Phase 28 was agent-scoped to "paste a list and watch" at
    concurrency 2.)
11. **Which wire kinds does 1.0 promise as stable, and four wire
    housekeeping calls?** Default: promise 30023, 30040, 0, 10002,
    30078 (+32125/32126 if entity publishing stays on); label every
    other emitted kind experimental in NIP_DRAFT with its flag. Then:
    30041 captured comments go local-only at 1.0 (they republish
    strangers' text under your key with no documentation and no flag);
    30060/30061 move to reserved; case bundles become key-free by
    default with the key-carrying form behind the same typed confirm as
    restore; `storeFirstPublish` flips on next release and the flag is
    dropped the release after; and decide the 30040 collision with
    NKBIP-01 that NIP_DRAFT records (WIRE-18) before promising 30040 as
    stable. (Kinds were minted per phase by agents; the stability
    promise was never scoped by you; the comment opt-in dates from the
    userscript port; the bundle predates creator binding; the flip
    follows your own 2026-08-02 store-first decisions — flag flips gate
    on the smoke rows alone.)
12. **Docs:** generate CHANGELOG `[Unreleased]` from PR titles; split the
    JOURNAL per month with a rulings ledger; front matter on every
    doc; `docs/` `tests/` `tools/` `.claude/` out of the release zip;
    archive ROAD_TO_1_0 with a tracker table; CLAUDE.md ≤ 200 lines
    without the phase recap. Default: yes to all. (All E5 conventions.)
13. **Names and surfaces.** "Library" or "Archive" for the user's
    holdings (default: Library — it holds unpublished things too; the
    code name `portal` stays); does the side panel survive as a picker
    for one release and then retire (default: yes); does the Network
    page fold into the Library as a lane when the group workflow is first
    exercised (default: yes, code kept); one Analyze verb per surface
    with cost-named items (default: yes); one transcription flag with an
    engine picker (default: yes — the two flags were an agent's choice;
    the DC.1 split of the *code* stays). (Provenance: per-phase naming
    with no naming pass; Phase 4 and Phase 25 designs never revisited.)

---

## 12. What this plan does not do, and its risks

- It does not rewrite X-Ray. Every structural change is a strangler
  step that keeps 2878 tests green; the on-disk shapes, database names,
  and wire kinds already emitted are one-way doors and stay.
- It does not renumber any constitution article, red line, or principle
  (guard-pinned; published artifacts cite them).
- It does not decide the governance questions; it batches them and
  recommends defaults. If the maintainer answers "keep" to D1–D6, R4's
  reader and case-page work proceeds under the current constraints and
  costs more; nothing else in the plan changes.
- It does not deliver a store listing; it starts the lead time in week 1.
- **Risk: the reader split (R3 lane D) without the net.** Refactoring
  8,294 lines with only grep-guards as the safety net is how the August
  escapes happened; R0 is first for that reason.
- **Risk: parking reads as killing.** Parks keep tests and code; each
  park records its revival condition; the shelf has one check date.
- **Risk: the plan becomes another ROAD_TO_1_0** — a 416 KB tracker
  nobody updates. Its counter is R6: the open items live in one table
  that a guard keeps honest, and this document is archived the day that
  table exists.
- **What the lenses disagreed on.** The product-manager lens would park
  epistemic audits and forensic findings with the rest; the governance
  and UX lenses keep them visible because casework has touched them.
  Resolution: keep visible, same check date (§7 R2). The architect lens
  calls the reader split pre-1.0 where ROAD_TO_1_0 T8 called it
  post-1.0; the verification lens agrees with the architect on
  condition that the harness lands first. Resolution: pre-1.0, under the
  net. The doc-currency lens proposes a reorganized `docs/` tree; the
  governance lens proposes four normative documents. Both are adopted;
  the tree shape is secondary to the one-source rule and needs the
  maintainer's answer to §11-12. The governance lens would merge PR #366
  only as the answered record; the branch lens merges it now as the
  unanswered agenda. Resolution: merge now — nothing in it binds anyone,
  and held docs branches rot (§9). The doc-currency lens splits the
  JOURNAL per quarter, the branch lens per month; either works, month
  is chosen because the conflict rate is the cited friction.
- **What the lenses corrected in this plan.** The first draft carried a
  "pre-reset, unmergeable branches" premise inherited from a shallow
  clone; the branch lens deepened the clone and showed 65 of 79 branches
  are ancestors of `main`. §8 and §9 were rewritten. The lesson is
  recorded in §9: an audit's first line is `git fetch --unshallow`.
- **What adversarial verification changed.** Each lens's top findings
  (harm ≥ 3, up to four per lens) were handed to an independent
  verifier told to refute them against the tree: 44 verdicts, 14
  confirmed as stated, 30 confirmed in substance with a corrected
  detail, none refuted. The corrections are applied above; the ones
  that changed a claim rather than a number: the executed-module census
  is 199 of 247 (not 186) and only one platform handler is dark; the
  audit *subject* dossier already renders a shrunk mean with spread, so
  the aggregation incoherence is between families, not an absence
  (§4.1); the §3.5 commitments ratio is already computed, the ban
  constrains its naming (§4.2); the maintainer did review the
  constitution draft — the Art. 6 generalization was never
  *individually* recorded, not never seen (§4.1); banned-word test files
  number about two dozen, not eleven, and one goes red on a legitimate
  quote; the `x` tag's second meaning is documented under entity pages
  and case briefs but not cross-referenced from the tag's own section;
  the release workflow already refuses an empty CHANGELOG section, so the
  front door cannot ship blank — it cannot ship at all until seven weeks
  are reconstructed; four ready behavior PRs (not six) wait on soak. The
  130 lower-harm findings carried in the lens reports are unverified
  and marked so there.

---

## Appendix A — the lens reports

| Lens | Report | Findings |
|---|---|---|
| product-manager | [`audit-2026-09-05/product-manager.md`](audit-2026-09-05/product-manager.md) | PROD-01..16 |
| architect | [`audit-2026-09-05/architect.md`](audit-2026-09-05/architect.md) | ARCH-1..15 |
| ux-designer | [`audit-2026-09-05/ux-designer.md`](audit-2026-09-05/ux-designer.md) | UXDE-01..18 |
| verification + automation | [`audit-2026-09-05/verification-automation.md`](audit-2026-09-05/verification-automation.md) | VERI-01..17 |
| continuous-improvement (doc currency) | [`audit-2026-09-05/doc-currency.md`](audit-2026-09-05/doc-currency.md) | DOCC-1..20 |
| governance | [`audit-2026-09-05/governance.md`](audit-2026-09-05/governance.md) | GOVE-1..14, census C1–C22 |
| ecosystem-pm + schema-evolution | [`audit-2026-09-05/wire-and-schema.md`](audit-2026-09-05/wire-and-schema.md) | WIRE-01..18, kind census, persisted-shape inventory |
| security-threat-modeler | [`audit-2026-09-05/security.md`](audit-2026-09-05/security.md) | SECU-1..12 |
| corpus automation (automator + xray-capture) | [`audit-2026-09-05/corpus-automation.md`](audit-2026-09-05/corpus-automation.md) | CORP-1..15, cost table |
| branch strategy (continuous-improvement + hand-to-maintainer) | [`audit-2026-09-05/branch-strategy.md`](audit-2026-09-05/branch-strategy.md) | BRAN-1..13, PR dispositions, lane map, hygiene rules |
| newcomer + consolidation (ux-designer + product-manager) | [`audit-2026-09-05/newcomer-and-consolidation.md`](audit-2026-09-05/newcomer-and-consolidation.md) | NEWC-01..16, the first-hour surface map, the consolidation moves, the dead-code census |

Verification verdicts (44 rows) are in the workflow journal and
summarized in §12; the lens reports carry the unverified remainder
with their original wording.

## Appendix B — ROAD_TO_1_0 crosswalk (status on 2026-09-06)

Closed: B2 (publish surfaces read `confirmedOk`), B3/B4 (T1), B6 (NIP-07
return path), B18 (THREAT_MODEL exists), B19 (via K3). Track status: T1
7/7 · T2 4/8 · T3 1/8 · T4 1/10 · T5 0/7 · T6 0/8 · T7 0/11 · T8 0/9.
Kills: done K2, K6, K7, K10, K11 (K1 builders done, stores left); half
K5, K8, K15; not started K3 (parked), K4, K9, K12, K13, K14. Every open
id above is placed in a track of §7; none is dropped.

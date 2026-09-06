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
GARBAGE. The lens reports are the evidence and live beside this file in
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

1. **Governance cannot tell a ruling from a reading.** There are eleven
   maintainer-decision markers in a 10,823-line JOURNAL and none in the
   constitution's fourteen articles; the guard suite pins agent-drafted
   prose and maintainer rulings identically. So "no aggregations" — a
   sprint-scoped descope on 2026-07-03, clarified as never-doctrine on
   2026-07-21, narrowed on paper by Art. 5 on 2026-08-02 — still lives in
   code as 22 distinct "firewall" mechanisms, eight of which are agent
   generalizations and seven of which are prose pins that observe no
   behavior at all (§4).
2. **The maintainer is the only verification layer for everything a user
   touches.** 186 of 247 modules are executed by `npm test`; the five
   surfaces, the service worker, the content script, and six platform
   handlers are executed by nothing. All eighteen August "suite green,
   behavior wrong" escapes lived in that unexecuted layer, and fourteen
   are machine-observable today. The soak rule made one human the serial
   gate for ~50 PRs a month (§6).
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
   default-off flags; six surfaces for a three-surface product; twenty
   header buttons in the reader (twelve flag-hidden) over seven stacked
   bars (§2, §7 R2).

**Where to start — the first two weeks.** Not with a rewrite. (1) Put the
existing browser harness in CI and make it required (the net). (2) Pin
today's structure in a guard test so nothing gets worse while work runs
in parallel. (3) Triage the 78 branches and 12 PRs by the table in §9.
(4) Hold the ninety-minute governance reconciliation session with six
batched decisions (§4.3) — it removes the constraints that are shaping
the reader and the case dashboard. (5) Declare the 1.0 scope and park the
rest behind one switch. Everything else in §7 follows from those five.

**What changes permanently (§8).** Trunk-based work in worktrees with a
module-ownership map and a structure guard as the collision detector; a
CI gate every branch passes identically, including the browser smoke; a
tiered soak (machine-observable classes merge on green, human-judgment
classes batch into one weekly session); a literal marker protocol so a
human decision is a grep-able object; facts generated from registries
and guarded; no new phase numbers; a check date on every flag; a PR cap.

**What the maintainer must decide.** Twelve batched decisions in §11,
each with a recommended default. The first six are the reconciliation
session.

---

## 1. What is good — keep (and why)

Consolidated across lenses; each item earned its place by casework
evidence or by being the mechanism the plan builds on.

| Keep | Why | Evidence |
|---|---|---|
| Capture pipeline + platform breadth (Readability/Turndown core, YouTube transcript, Substack, PDF via pdf.js, EPUB, podcast transcription) | daily casework | JOURNAL 2026-08-25 "a heavy casework day"; walk ledger rows 08-15…08-25 |
| Thin claims with the verbatim quote as identity, human-accepted; the one-call article pass; "Accept all / Link all covered" | the product's differentiator; makes hundreds of proposals reviewable | `shared/article-pass.js`; PR #361 walk (72/60/86 proposals) |
| Cases + the corpus brief; the case dashboard's claim-proposal review | maintainer-named "the most wikipedia-like artifact" | `docs/LIBRARIAN_KICKOFF.md` §1; JOURNAL 4138 |
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
| Art. 6's linguistic arm (five reserved words), wire arm (30066 "permanently free"), and the reader's visual firewall | a two-kind wire-schema rule (NIP_DRAFT 30051 vs 30054) generalized per family in Phase 13, then constitutionalized 2026-07-22 by agents, ratified by merge | the questionnaire grades all three E5; the maintainer's 2026-08-28 reconciliation statement; the CSS does not even implement the visual rule (every bar shares `--xr-surface`) |
| Truth adjudication (30063/30064), hypothesis maps, counterfactuals, the moral lens, AI vision, the Network client, assessments publishing, kinds 30068/30069/30070 | the Epistack competition sprint (June–July 2026) and post-28 momentum | deadline passed 2026-07-19; zero JOURNAL casework mentions since design; no walk-ledger rows; flags never flipped |
| The companion transcriber as a peer of direct cloud in Options | the 2026-04-19 YouTube DOM arms race | DC.1 removed the premise for newcomers; Windows-only, LT.1–LT.14 unwalked |
| Three collaboration models (case bundle with keys; follow + incorporate; TEAM_CASE TC.3/TC.5 unbuilt) | designed ahead of any second user | B14 open: never exercised by two people on two machines |
| The soak rule (one human casework session per behavior PR) | maintainer ruling 2026-08-23 after the DC wave's five same-day-merge escapes | its premise ("the suite cannot observe what a person sees") is true of `node --test` and false of the harness |
| The reader as *the* publish orchestrator (`reader/index.js:6026-7600`) | Phase 2: capture → reader → publish, one article at a time | the portal also publishes now, through `publish-gate.js`; two orchestrators, two styles |
| Five IndexedDB databases; `xray-audits` holding six non-audit stores | each phase opened its own (7, 12, 13, 25, journal) | nobody chose five; `xray-portal` and `xray-network` are byte-identical derived caches |
| `src/shared/` as one flat directory of 128 files | Phase-1 layout for ~10 modules | 57 modules have one importer (~18,200 LOC); "shared" now means "not sure where this goes" |
| `preferences` as a JSON string in `chrome.storage.local`; the `Storage` façade's stringify | Phase 2 port for v4 userscript export compatibility | the userscript is retired; seven hand-rolled `JSON.parse` copies exist; keep the on-disk shape (one-way door), unify the reader |
| Source-grep guard tests over the surfaces (32 files; 179 regexes pin user-visible phrases) | the surfaces cannot be imported | the harness can observe them |
| The per-PR six-document ceremony (JOURNAL + SMOKE row + CHANGELOG + ROADMAP + CLAUDE.md recap + design banner) | each added by the PR that first felt the pain, as prose | measured compliance 0–55%; 23% of commits are docs-only |
| Options → Advanced as the product's control panel (18 subsections, 12 flag checkboxes, 47 hint paragraphs) | the Phase-9a flag policy: every family gets a publish flag with a disclosure paragraph | a researcher deciding what leaves their machine reads eleven near-identical paragraphs |
| `xray:` prefix on 19 storage keys and 8 menu ids | early habit; the prefix began as the message namespace | a grep for messages returns 77 literals of which 49 are messages |

## 3. What is garbage — dead, duplicated, or misleading

Cheap to remove; two-way doors unless marked.

- **Front-door facts that are false:** `README.md:19` "v0.7.0" (tree is 0.8.0); `README.md:381,406` "2100 tests" (2878); `CHANGELOG.md:11-13` "Nothing yet" across 67 merges; `esbuild.config.mjs:3` "seven bundles" (ten); `src/page/api-interceptor.js:14-19` "NOT auto-injected via manifest" (`manifest.json:80-95` injects it at `document_start`); CLAUDE.md "eight of the nine skills" (twelve exist), "~2500 tests", "no section walk is outstanding". All four architect items were cited by `file:line` on 2026-08-09 and are still wrong.
- **ROADMAP contradicts itself** on Phase 16 in one file (`ROADMAP.md:94` complete vs `:1500` "smoke run pending") a month after JOURNAL 2026-08-02 recorded fixing exactly that; `ROADMAP.md:2164-2174` prescribes a GitHub-issue mirror nobody has done since Phase 8.
- **Ratified kills still in the tree:** K1 stores (`archive-cache.js:173-201` creates five dead stores on every fresh install; one-way, needs a v4 ladder), K3 reader bar (`reader/index.html:144-146`), K4 `xray:forward:*` (`background/index.js:477-495`, sender `options/index.js:1862`), K8 reader "Import audit JSON…" always visible (`reader/index.html:127`), K9 `case` as a creatable entity type (`sidepanel/index.js:1289-1320`, `entity-tagger.js:150`), K13 the EPISTACK cluster and shipped kickoffs, K14 `Storage.entities`/`articleCache` (`storage.js:354-360, 408-412`), K15 the entity-corpus destination.
- **Dead code:** `src/shared/api-pattern.js` (zero importers; its test pins a copy that never runs); the `xray:scholar:crossref` handler (`background/index.js:1207`, no sender anywhere).
- **Duplicated constants:** `AUDIT_DRAFT_PREFIX` declared in `audit/corpus-audit.js:24` and again in `reader/index.js:4383`; `'xray:user'` in `sidepanel/index.js:51` and `portal/identity.js:34`; `'local_primary_identity'` as a literal in five files; `options/index.js:57-125` re-implements the `Storage` façade; seven raw `chrome.storage.local.get(['preferences'])` + `JSON.parse` copies.
- **Flags with no control:** `reviewCoordination`, `storeFirstPublish`, `extractionAnalysisPublishing` — the last gates a *wire* publish (kind 30070, whole-unit disclosure) and is reachable only by editing `xray:flags` in DevTools (B10 open).
- **Guards that observe names, not behavior:** the export-name regex "never-merge at the export surface" (`tests/constitution-guards.test.mjs:241-261`); eleven hand-rolled banned-word lists (`corpus-publish.test.mjs:83` bans `\d+\s*%` from a brief; `hypothesis-block.test.mjs:130` bans "stronger"/"confidence" anywhere; `entity-dossier.test.mjs:185` bans "credibility" as a key); verbatim pins of agent-drafted clauses (`constitution-guards.test.mjs:98-115`; `lens-guards.test.mjs:196-207`); implementation snapshots written nine days after the JOURNAL said not to (`tests/extraction-accept-all.test.mjs:51-53`).
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
4. **2026-07-22 / 08-02** — CONSTITUTION Art. 5 "narrows" the kill: estimates and cross-author aggregates are lawful *as instruments* under five conditions; Art. 5.2 closes with "refusing them wholesale was itself a form of false precision." Art. 6 (never-merge, with linguistic and wire arms) and Art. 12 red lines 2–4 landed in the same document, drafted by agents, ratified by merge.
5. **2026-08-28** — the maintainer: "there needs to be a reconciliation between my original intentions and what has been codified." PR #366 prepares the agenda (Q1–Q19, firewalls F1–F13, provenance graded E1–E5). Nothing in code has moved: `corpus-rollup.js:4-6` still refuses a mean while permitting a range; the Art. 5 functional guard is "deferred… when the first estimation surface ships" (`constitution-guards.test.mjs:316`) — none has.

The narrowing happened on paper and nowhere in code. A researcher with three hundred audited articles cannot see a mean audit score with its spread. That is the concrete cost of the thorn.

### 4.2 The firewall census as it exists in code

The governance lens enumerated every distinct enforcement mechanism in
`src/` and `tests/` that calls itself a firewall — 22 of them (its F0
table has the `file:line` for each). Condensed:

| Group | Mechanisms | Fresh-eyes disposition |
|---|---|---|
| **Seven that protect a maintainer decision — keep as law** | C3 truth-adjudicability gate (`interpretation`/`stated-value` never get true/false); C4 value firewall; C12 grounding + human-accept (the model's quote is a search key; paraphrase is a hard reject); C13 import consent/provenance (`mergeBackup`); C15 the membrane (viewing writes nothing); C16 forensic location-never-verdict, no intent, counter-read required; C17 opinion modules argue, never conclude; plus C14 no operator identity in `src/` and C21 the model never computes the audit aggregate | keep; two of them (C3 read-side, C12 accept) get an override described below |
| **Eight agent generalizations that now block wanted capability — demote or split** | C2 export-name regex; C5 entity-record word-ban (blocks the §3.5 ratio TRUTH_ADJUDICATION itself licenses); C6/C22 case/corpus no-mean family (a range is allowed, a mean is not); C7 visual firewall; C8 five-word vocabulary ban; C9 30066 "permanently free"; C10 lens session-only cache; C11 30064 no-mirror (keep as default) | split C6: keep "no fused case *verdict* as headline" (Art. 5.4 sentence 1), demote the rest to Art. 5.2's five conditions; demote C7/C8 to one line of surface guidance; amend C9 to "reserved"; remove C2/C10 |
| **Seven prose pins that observe no behavior — remove or convert** | C19 verbatim pins of E5 clauses; the eleven banned-word lists; C20 mandatory disclaimer sentences; C18 prompt-header requirement (keep as lint); C1 audit≠assessment tag grammar (keep — it is per-kind schema, i.e. the wire covenant, not a firewall) | replace with one exported predicate `isLicensedEstimate(obj)` (declared, method, spread, n) and one schema check; keep structural pins (headings, citations resolve, versions agree, kind schedule vs code) |

**What the current regime costs, measured.** 30 tests in four files exist
to pin prose; eleven more test files carry banned-word lists; a Tier-1
ceremony is required to reword any of it. The reader is seven stacked
blocks and the case dashboard a 4,400-pixel column because presentation
inherited a data rule. PR #370 spends part of +1,872 lines on a rail/tint
compromise whose only purpose is respecting C7. Capabilities foreclosed:
case-level instruments (Art. 5.4's own door, unopened for six weeks); an
entity-level summary; cross-family views; a durable lens cache; the
bridging/trust seams left "open but unwired" since the descope.

**Two overrides worth naming now, because they are the throughput lever
for hundreds of URLs.** (a) C12's accept gate: the MA.6 posture
(publish every row *with its review state*) already proves that
"unreviewed but visible" is lawful; extend it locally so unreviewed
extraction rows can render and feed the corpus reduce with their state
shown, instead of being invisible until clicked. Grounding stays a hard
reject. (b) C3's read side: `truth-builders.js:369` nulls a stranger's
not-adjudicable verdict — a silent filter, which Art. 3 forbids; return
a visible "not admitted" record instead (read-side only; no wire
change).

### 4.3 The reconciliation session — ninety minutes, six decisions

Agenda = PR #366's questionnaire, batched so dependent questions are
decided together. Pre-read for the maintainer: the governance report's
F0 table and the questionnaire's §1 headings (≤ 20 minutes). Output: six
rows in a rulings ledger and one amendment PR. Everything else the
agents execute.

| # | Decision | Batches | Recommended default | Ceremony |
|---|---|---|---|---|
| D1 | The firewall's shape | Q1, Q4, Q5, Q14, Q17 (F2, F3, F4, F7) | Art. 6 becomes its one data-arm sentence plus "side-by-side composition is always lawful"; the linguistic arm becomes naming guidance ("verdict" stays the truth kind's *name*); the wire arm folds into Art. 10 (never-reuse kept; 30066 "reserved — lens, if ever ratified"); the visual arm becomes one guidance line ("scores and stances never share a color scale"). Remove C2; demote C7/C8 | Tier 1, one amendment-log entry; guard deletions in the same PR |
| D2 | Aggregates and instruments | Q3, Q7, Q9 (C5, C6, C22) | Keep Art. 5.2's five conditions as the license; **define "fused"** ("a single number or state computed from more than one family's judgment, or presented without its inputs, method, spread and n"); declare the first licensed instruments: corpus mean + range + n, the §3.5 entity ratio, a labeled case "evidence balance" rendered beside — never above — the dossier header; "does not appear" renders as "estimate withheld: <failed condition>" (Art. 3) | Tier 1 (the definition) + Tier 2 (PHILOSOPHY §13) |
| D3 | The two person-protecting firewalls | Q2, Q6, Q13 (C3, C4, C5, C11) | Keep the §3.1 gate and no-auto-person-label as law; strike "permanently" from TS H-2; add "disclosure is not criticism" to Art. 7; 30064 no-mirror stays as a default; read-side null becomes visible not-admitted | Tier 1 (one Art. 7 sentence) |
| D4 | What binds | Q8, Q10, Q11 (Art. 2; DISCIPLINES; H-7) | Narrow Art. 2's doc-governs-code to wire / schema / security; elsewhere a code-vs-doc conflict is a recorded question for the maintainer, not an automatic doc win; DISCIPLINES becomes guidance (prompt-header lint stays); rule §15.3: bulk-accept of individually grounded rows is lawful — the grounding is the review; H-7 scoped to judgment surfaces | Tier 1 (Art. 2) |
| D5 | Process | Q12, Q16, Q18, Q19; GOVE-10 | Adopt the marker protocol (§4.4) verbatim; create and seed the rulings ledger; write "NOSTR stays invisible — interfaces never require NOSTR literacy; not a vocabulary ban", "high value solo first", "Apple-quality simplicity" down with their force stated; amend Art. 11 so that the maintainer's explicit recorded instruction is the ratification and who presses the merge button is mechanical (it has been waived twice on the record, JOURNAL 2026-08-04) | Tier 1 (Art. 11); Tier 3 for the rest |
| D6 | The corpus reset and the three PRs | Q15 | Normative set of four documents (CONSTITUTION ≈450 lines; PHILOSOPHY; a rulings ledger; a one-page surface-constraints index); everything else guidance or archived with a banner (Art. 3, nothing deleted); #364 merge, #366 merge as the answered record, #365 fold to ≤120 lines; lens durable local cache is an ordinary feature | Tier 3, one PR |

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
   questionnaire's §5 already-reconciled ledger (18 rows) plus the
   session's six. JOURNAL entries cite the R-id instead of restating.
   A guard asserts every `R-` id cited anywhere in the tree exists.
3. **Guard provenance and expiry.** Every guard test and every
   doc-pinning assertion carries `// Provenance: R-…` or
   `// Provenance: INTERPRETATION (<date>) — expires <date+90d>`. A
   meta-guard fails an expired INTERPRETATION guard with "renew (get an
   R-id) or remove." Interpretations cannot become law by aging.
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

Docs are 0.75× the source in bytes (3.05 MB under `docs/` against 4.35 MB
of `src/`) and they ship inside the release zip. Eight files carry 60%
of the mass. The per-PR ceremony prescribed by CONTRIBUTING, CLAUDE.md
and ROADMAP is six documents wide; over the last sixty merges its
measured compliance was JOURNAL 45%, SMOKE_TEST 55%, CHANGELOG 0%,
ROADMAP 2%, CLAUDE.md 12%. Forty-three of 187 commits are docs-only.
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
splits per quarter and appends at the *bottom* (the prepend-at-top hunk
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
behavior PR regardless of size: fifteen `docs(smoke): record the PR
#NNN soak walk` commits in five days, twelve open PRs, and the maintainer
walking a fourteen-row checklist for a flag-off fourth reader view
(PR #370) — "testing stuff I don't even care about." Its premise is
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
1,574-line `publish()` that reads seven flags inline and calls seventeen
builders; every agent touching capture, transcription, publishing,
audits, vision, the lens, or platform headers edits the same file, and
no test can import it. The service worker is one 950-line `if`-chain of
45 handlers. The JOURNAL prepends at the top, so every parallel branch
conflicts on the same hunk.

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

- [ ] **The browser smoke in CI, required.** `npm run smoke` →
      `tools/smoke/run.mjs`; `playwright` as a devDependency; browser
      resolved from `PLAYWRIGHT_BROWSERS_PATH` with `XR_CHROME` override;
      CI job after build: load the unpacked extension, open all five
      extension pages asserting zero `pageerror` and ten bundles, then
      run the MA.6 walk with its stale selector fixed and selectors moved
      to `data-xr` attributes; outputs to CI artifacts; committed PNG/JSON
      deleted. (M; VERI-02; B8/T4-4 open.) The `pages` check is required
      from day one; scenario walks advisory for two weeks, then required.
- [ ] **ESLint minimal** (`no-undef`, `no-unused-vars`, a `console`
      ratchet starting at 205) + version lockstep moved into `ci.yml` +
      a packaged-contents assertion + a bundle-size budget. (S each;
      VERI-07; T4-3/6 open.)
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
- [ ] **Branch and PR triage** per §9: merge the four small fixes,
      archive the ~30 pre-reset branches as tags, delete the ~35 merged
      branches, park #324 and #370 as stated. (S.)
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
      TS H-2 "permanently" struck; PHILOSOPHY §13 entry. Delete C2, the
      verbatim clause pins and the eleven word-lists; add
      `isLicensedEstimate()` + the schema guard; add `// Provenance:`
      headers and the expiry meta-guard. (M.)
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
      has touched them) with the same check date. (M; PROD-02; K3
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
      2026-08-02 ruling said "flip early").

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
      per PR. Do this **under the net** (R0 first). (L; ARCH-1/2; the
      one track that needs maintainer soak per PR.)
- [ ] **Lane E — moves.** `git mv` the 57 single-caller `shared/` modules
      to the surface or domain that owns them; the four DOM modals to
      `shared/ui/`; domain clusters `wire/ storage/ llm/ media/ domain/`.
      Between waves, when open PRs are few. Bundle `api-pattern.js` into
      the interceptor IIFE or delete it. (M; ARCH-8/11.)
- [ ] Route `entity-sync.js`, `confirmed-publish.js` and the bunker
      client through `xray:relay:*` / `xray:sign` so only the worker
      opens sockets; shrink the allowlist to empty. (M; ARCH-6;
      decision §11-9.)
- [ ] `docs/ARCHITECTURE.md` GENERATED from the registries and the
      esbuild config, drift-guarded. (S; with R6.)

### R4 — The first hour, the publish pre-flight, and three surfaces (weeks 3–8)

Sequenced after R1 (the visual firewall and the vocabulary ban are
removed or demoted there) and R2 (the shelf is parked, so four reader
bars and ten portal blocks disappear for free).

- [ ] **First run.** `onInstalled reason='install'` opens Settings on a
      three-step welcome: identity generated *for* the user with one
      button (public key shown once; "Show nsec" under Your data);
      default relays pre-filled; one paragraph on what becomes public.
      Settings lands on Identity whenever no identity exists. A "?" in
      every header opens the guide section for that surface. Delivery
      channel declared: unlisted Chrome Web Store + AMO-signed `.xpi`
      with `update_url`, permission justifications from THREAT_MODEL.
      (M + store lead time; B7/B13; UXDE-01.)
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
      the two wrong doors close. (L, in slices; UXDE-04..08/13;
      PROD-13; T8 seam collapse.)
- [ ] Replace the eight "see console" terminations with remedies now
      that the diagnostics ring exists; remove the key-bearing export
      from beside routine exports. (S; UXDE-10/16.)

### R5 — Corpus automation: hundreds of URLs → captured → claims and entities → reviewed (weeks 3–8)

What exists: `shared/url-import.js` batch-captures a pasted list from
the portal by fetch (no tab, so no JS-rendered pages and no platform
handlers), concurrency 2, foreground in the portal tab;
`shared/article-pass.js` runs ONE cached LLM call per article for
claims + entities + about-links; "analyze after import" runs it per URL;
the `#xray:capture` marker lets a driving agent capture one URL at a
time through a real tab; PR #374 introduces `shared/llm-jobs.js` so long
passes survive service-worker teardown; the Playwright harness can drive
the real extension headless. What breaks at N=100–500 today: the portal
tab must stay open; nothing resumes; platform URLs are skipped; every
proposal is invisible until a human clicks its fold; cost and rate
limits are unmanaged.

- [ ] **Slice 1 — a persisted job queue** (in the casework DB), driven by
      `chrome.alarms`, states `queued → captured → extracted →
      proposals-ready | failed`, with PR #374's job model as the
      foundation and the portal as a progress viewer, not the runner.
      Success criterion: **200 URLs from a text file → archive +
      proposals overnight with the portal closed.** (L.)
- [ ] **Slice 2 — a tab lane for platform URLs.** The background opens a
      real tab with the `#xray:capture` marker for YouTube / Substack /
      Twitter / FB / IG / TikTok URLs (no agent needed), bounded
      concurrency per origin, and closes it on the reader's auto-archive.
      Login-walled pages are reported uncapturable, never worked around.
      (M.)
- [ ] **Slice 3 — cost and rate control.** Per-run budget disclosed
      before start (N articles × the article pass's known token shape);
      per-model concurrency; exponential backoff on 429; the cache-first
      rule means re-runs cost nothing. (S–M.)
- [ ] **Slice 4 — review at scale.** Under §4.2's override (a):
      unreviewed rows render and feed the corpus reduce with their state
      shown; the case page's Claims tab opens on "Review N proposals"
      sorted by load-bearing and by article, with Accept all / Link all
      covered per fold (exists) and per case (new). No scores, no
      confidence ordering. The constitution requires human review of
      what *publishes* (and MA.6 publishes every row with its state);
      local storage of grounded proposals is not gated by it. (M;
      decision §11-10.)
- [ ] **Slice 5 — the machine-runnable path.** A CI scenario runs the
      queue against a local static server of fixture pages and a stubbed
      model, asserting archive rows, extraction records and the job
      ledger; the agent-driven `xray-capture` skill becomes the manual
      fallback, not the plan. (M.)
- [ ] Frontier expansion (follow outbound links from captured articles)
      second, behind a per-case cap — only after the URL-list path has
      been used on a real case. (Decision §11-10.)

### R6 — The documentation system (weeks 3–6, lane parallel to R3)

The system in §5: four registries → one generator → one guard file;
JOURNAL split per quarter with a generated index; rulings ledger;
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
      narrow the claim to "capture-only, community-supported."
- [ ] NIP_DRAFT labels every kind no default-on path emits as
      "experimental — may change" with its flag name; 1.0 promises
      30023, 30040, 0, 10002, 30078 (+32125/32126 if entity publishing
      stays). (Decision §11-11.)
- [ ] The minimum security work before a store listing: re-derive
      `rules/csp-strip.json` rule 1 empirically (today it strips CSP on
      every main frame and sub-frame of every site — no domain
      condition) and scope it to `youtube.com` or retire it;
      authenticate the `xr:apihook:event` channel (G1); correct the
      api-interceptor header; `referrerpolicy="no-referrer"` on reader
      image emissions; the store listing's permission justifications and
      privacy disclosure written from THREAT_MODEL. (M; B5, T2 open
      items; G1/G3/G7 in THREAT_MODEL §5.)
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
integration branch: the reset is a strangler, not a big-bang, and every
step keeps the suite green, so there is nothing to integrate later. An
integration branch would re-create the pre-reset situation (thirty
branches descending from a history that no longer exists).

**Parallel threads.** One git worktree per thread. A **module ownership
map** derived from the R3 target tree: a thread is assigned a directory
(`background/` + `shared/bus`; `reader/publish`; `shared/storage` +
kills; `shared/wire` + Art. 10 reconciliation; docs generators + guards;
the queue; the first hour), never a feature. The structure guard is the
collision detector: a PR that grows an allowlist or edits outside its
directory fails review. The JOURNAL appends at the bottom of a quarterly
file so threads stop conflicting on one hunk.

**PR size and count.** ≤ 400 changed lines of `src/` per PR except
mechanical `git mv`; **at most four open PRs** (a new one is not opened
until one merges or is parked); one concern per PR, as CONTRIBUTING
already says.

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
label and are cleared in **one weekly 30–45 minute session** on a build
of `main`, driven from a single `hand-to-maintainer` list ordered by what
fails worst; the reply is numbers; the ledger row records minutes. The
urgent waiver stays. The maintainer's merge instruction stays the
ratifying act; the *waiting* stops being the gate.

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

**Open PRs (12).** Conflict status against `main` was checked with
`git merge-tree` on 2026-09-06; only #324 conflicts, and only in
`docs/JOURNAL.md`.

| PR | Branch | Disposition | Why / what it still needs |
|---|---|---|---|
| #368 | fix/instagram-url-identity | **Merge now** (+608, 4 files) | a wire-truth fix (wrong-account attribution); machine-class once the harness runs; until then one capture on a real IG post |
| #369 | fix/publish-without-session-record | **Merge now** (+139) | a publish that refused on a missing session record; unit-tested; machine-class |
| #373 | claude/kind-hypatia-fu8nqm | **Merge now** (+408) | tolerance fix for model output; unit-tested; machine-class |
| #374 | claude/eager-knuth-ipv3xd | **Merge after fold into R3 lane B** (+1,580, `shared/llm-jobs.js` 534 lines) | the job model is right and is the foundation of R5; land it as the `job` handler shape in the dispatcher map rather than two more `if` branches in the 950-line chain |
| #364 | claude/practical-ramanujan-sk12k1 | **Merge now** (docs only; soak-exempt) | then execute its A1/A2/B2/C1/C2/D1/E1 as one small PR; its B1 (a surface-constraints index) is R1's fourth normative document |
| #366 | docs/governance-reconciliation-questionnaire | **Merge as the answered record** after the R1 session | becomes the rulings ledger's first section with a superseding banner; do not merge unanswered |
| #365 | claude/loving-gauss-k8gsta | **Fold** (+528; a 453-line skill that mirrors the corpus it governs) | keep the review standards (~50 lines) inside `architect` or as a ≤120-line skill; keep the README routing rows; do not merge the mirror |
| #370 | feat/margin-s1 | **Park; re-cut as S1+S2 in R4** (+1,872, 22 commits, `reader/index.js` +504) | the direction is right; merging a flag-off fourth view adds a surface to a product whose problem is too many surfaces, and its fourteen-row walk is mostly guard carriers. If the maintainer prefers to merge now: a five-row walk (M.1, M.2, M.7, M.8, M.14), the other nine recorded as accepted risk, check date 2026-09-30 on whether he opens archived articles in Annotated by choice |
| #324 | claude/nip07-option-c | **Rebase and merge after the harness exists** (+390/−57, 31 files; base 164 commits stale; JOURNAL conflict only) | a ratified decision (Option C) with five adversarially found leaks already fixed; its live walk (entity creation under Local and under NIP-07 with no local primary) is human-class — one row in the weekly batch |
| #372, #371, #335 | dependabot/* | **Merge now** | dependency bumps; CI green is the test |

**Pre-reset branches (~30, dated ≤ 2026-08-02, behind `main` by 187 and
"ahead" by 400–690 because they descend from a rewritten history).**
Sampled six: `feat/opinion-modules-op2`, `claude/personas-college`,
`feat/reference-resolver`, `feat/known-unknowns-block`,
`claude/ai-vision-image-text-*`, `claude/identity-rename-workspace-rebind`
— every distinctive file or symbol is present on `main` (e.g.
`identity-profiles.js:174 rename(pubkey, label)`; the opinion module,
reference-resolver, known-unknowns and vision-notes files). They are
merged content on an orphaned lineage. **Disposition:** tag each as
`archive/<branch>` (git-recoverable, Art. 3) and delete the branch; a
`scripts/branch-hygiene.mjs` does it and refuses to delete anything
whose tip is not reachable from a tag.

**Already-merged branches (~35, `ahead 0`, 2026-08-11 → 08-28).**
Delete. Same script.

**The rule going forward:** a branch that is merged is deleted the same
day; a branch with no PR for fourteen days is tagged and deleted; the
script runs weekly.

---

## 10. Security and wire notes that the plan depends on

- `rules/csp-strip.json` rule 1 removes four CSP headers from every
  `main_frame` and `sub_frame` response on every site, with no domain
  condition; only rule 2 (the timedtext Referer/Origin rewrite) is
  scoped to YouTube. Three documents call the strip YouTube-scoped
  (B5/G3, open). R7 re-derives it empirically before the store listing.
- The `xr:apihook:event` channel carries a nonce but does not check it
  on control messages (`api-interceptor.js:183-189`; G1, open).
  `api-interceptor.js:14-19` still says the script is not manifest-
  injected; `manifest.json:80-95` injects it on IG/FB/YT at
  `document_start`.
- Prompt injection from captured content into an LLM pass is possible
  by design (G7); the defenses are the grounding firewall (C12 — the
  model's quote must be found verbatim in the stored body) and the
  human accept before anything publishes. §4.2's override (a) keeps
  both: unreviewed rows become *visible*, not *published*.
- **Kind census for 1.0** (the wire-and-schema report carries the full
  table with emitter, gate, public-relay evidence and consumer per
  kind). Ship: 30023 (article, case brief, entity page), 30040, 0, 1, 3,
  5, 10002, 30078, 32125, 32126, 30054/30055 + 1985 mirrors, 30056–30059,
  30062 + mirror, 30063 + mirror, 30064, 30068, 30069. Gated-unwalked:
  30070 and the `xray/review` label (DevTools-only gates; 30070 has only
  ever been built against a loopback relay). Reserved: 30060/30061
  (never emitted), 30065, 30050–30053, 9803. Free: 30066. Retired
  (parsers kept): 30043, 30067. Local-only at 1.0: 30041. Nine kinds
  have `KIND_` constants; the rest are literals in their builders and in
  read filters across fifteen non-builder files — R3 lane A's kinds
  registry becomes the single source that Art. 10, NIP_DRAFT and the
  guard are generated from (B16). NIP_DRAFT (108 KB) cannot pass the
  second-client test today: 30041 and 30078 have no section, the 30023
  `d` derivation is unwritten, and the `x` tag's dual meaning is
  undocumented (WIRE-03/04/13).
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
   assessments as a stance on a claim). Park audits, forensic, verdicts,
   integrity, lens, hypothesis maps, counterfactuals, AI vision behind
   one switch with check date 2026-11-30. (E5 per family.)
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
6. **Delivery channel:** unlisted Chrome Web Store + AMO-signed `.xpi`,
   or a signed zip with a developer-mode caveat? Default: store + AMO;
   Firefox "capture-only, community-supported" until the gate runs on
   128 ESR. (B7; no ruling exists.)
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
10. **"Hundreds of URLs":** a pasted list first (resumable background
    queue; platform URLs via a tab lane), frontier expansion second
    behind a per-case cap; and may unreviewed grounded rows render and
    feed the corpus reduce with their state visible? Default: yes to
    both. (Your 2026-09-05 ask; Phase 28 was agent-scoped to "paste a
    list and watch" at concurrency 2; the accept gate is E3, MA.6's
    whole-unit disclosure is E1.)
11. **Which wire kinds does 1.0 promise as stable, and four wire
    housekeeping calls?** Default: promise 30023, 30040, 0, 10002,
    30078 (+32125/32126 if entity publishing stays on); label every
    other emitted kind experimental in NIP_DRAFT with its flag. Then:
    30041 captured comments go local-only at 1.0 (they republish
    strangers' text under your key with no documentation and no flag);
    30060/30061 move to reserved; case bundles become key-free by
    default with the key-carrying form behind the same typed confirm as
    restore; `storeFirstPublish` flips on next release and the flag is
    dropped the release after. (Kinds were minted per phase by agents;
    the stability promise was never scoped by you; the comment opt-in
    dates from the userscript port; the bundle predates creator binding;
    the flip is your own 2026-08-02 "flip early" ruling.)
12. **Docs:** generate CHANGELOG `[Unreleased]` from PR titles; split the
    JOURNAL per quarter with a rulings ledger; front matter on every
    doc; `docs/` `tests/` `tools/` `.claude/` out of the release zip;
    archive ROAD_TO_1_0 with a tracker table; CLAUDE.md ≤ 200 lines
    without the phase recap. Default: yes to all. (All E5 conventions.)

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
  maintainer's answer to §11-12.

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

## Appendix B — ROAD_TO_1_0 crosswalk (status on 2026-09-06)

Closed: B2 (publish surfaces read `confirmedOk`), B3/B4 (T1), B6 (NIP-07
return path), B18 (THREAT_MODEL exists), B19 (via K3). Track status: T1
7/7 · T2 4/8 · T3 1/8 · T4 1/10 · T5 0/7 · T6 0/8 · T7 0/11 · T8 0/9.
Kills: done K2, K6, K7, K10, K11 (K1 builders done, stores left); half
K5, K8, K15; not started K3 (parked), K4, K9, K12, K13, K14. Every open
id above is placed in a track of §7; none is dropped.

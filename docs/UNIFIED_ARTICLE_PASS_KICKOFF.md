# One Article Pass — unify Suggest and the corpus map (kickoff)

**Status: APPROVED 2026-08-12** — maintainer ("Approve the kickoff
and start UA.1"): build the slices, riskiest first. Drafted the same
day at the maintainer's request after the 2026-08-12 reconciliation
review of corpus pre-analysis vs. article-level Suggest
(CONSTITUTION Art. 11). UA.1 merged 2026-08-12 (PR #326), UA.2
merged 2026-08-12 (PR #327), UA.3 in progress — all three built the
same day the kickoff was approved; the §5 acceptance walks (UA.1
parity + the owed corpus revalidation, UA.2 fragment counts) are
still owed and the §6 kill criteria stay armed until they run.
NOTE: UA.3 removes the UA.1 slim-mode kill-revert surface BEFORE the
UA.2 walk has run — a UA.2 kill after UA.3 is a two-slice git
revert, accepted by the maintainer in ordering the slice.

Related: `docs/CASE_SYNTHESIS_DESIGN.md` (the map/reduce this
extends), `docs/MAP_ARTIFACT_KICKOFF.md` (the durable layer both
passes already share — MA.4 unified their *output*; this unifies
their *input*), `docs/PHASE_14_5_LLM_ASSIST_KICKOFF.md` (where
Suggest was born, before the corpus engine existed),
`docs/CONSTITUTION.md` Art. 6 (never-merge — governs the entity
resolution ladder below), `docs/JOURNAL.md` 2026-07-20 ("Suggest IS
the extraction pass") and 2026-08-11 (the prepay trigger move this
supersedes in spirit: after this kickoff there is nothing left to
prepay).

## 1. Diagnosis — one reading, purchased twice, in two vocabularies

The maintainer, 2026-08-12: case-level analysis is value-added;
article-level analysis is redundant — "we're using different words
for the same things and paying for the LLM to render them twice."

The mechanics agree. Two passes each read the whole article
(≤60k chars) and extract the sentences that matter:

- **Suggest** (`xray:llm:suggest`): comprehensive claim atomization
  (quote + authored paraphrase + an article-relative `is_key` star)
  plus entities, nudged toward established names by a registry
  vocabulary riding the prompt.
- **The corpus map** (`xray:llm:corpus-map`): the article's position,
  its load-bearing assertions (quote + why), cited sources, open
  questions — selective by brief, cached forever under a content-only
  key.

MA.4 made them two *producers* into one durable layer with one
span-dedup rule — the same sentence found by both is one atom — but
kept two *paid reads*. A worked article in the standard workflow
(capture → Suggest → eventually Analyze, or Suggest + the prepay)
sends its full text to Anthropic twice to produce overlapping
claim-shaped output under two names: the modal says "claim
proposal", the layer and case dashboard say "assertion".

The vocabulary split has a sharper cost than confusion: the `is_key`
scope collision. Suggest stars claims *central to this article*; the
reduce promotes claims *the whole case turns on*; both write one
scope-less boolean that `selectDigestClaims` treats as
case-importance, guaranteeing digest slots (of 150) to
article-relative stars on large corpora.

History explains the shape, not design: Suggest (Phase 14.5) predates
the corpus engine (20.4). The 2026-07-20 narrowing already stated the
model this kickoff completes — **"per capture, EXTRACT (atoms from
this text); per corpus, CONNECT AND JUDGE"** (`llm-prompts.js`). Two
extraction passes per article is the residue. The completion: per
article, ONE reading.

## 2. The design in one paragraph

**Suggest becomes a consumer of the map pass.** The map call is
extended (corpus-v8) to emit everything a per-article reading
produces: entities (surface form + type + mention quote, with native
claim→entity refs), a *comprehensive* claim list — each atom a
verbatim quote + authored paraphrase `text` + a `load_bearing` flag
(+ `why` when flagged) — plus the existing position, cited sources,
and open questions. It stays cached under the content-only key, so an
article is still paid for once ever, for every case and entity page.
The reader's Suggest button becomes cache-first fetch-or-run of that
one extract, feeding the same review modal through the same accept
firewalls. Analyze's reduce consumes the `load_bearing` subset
exactly as it consumed `key_assertions`. The `autoPreAnalyze` flag
retires — Suggesting an article *is* analyzing it — and naming
consistency moves from prompt-time vocabulary (which would poison the
cache key) to an accept-time **resolution ladder**: mechanical
candidate matching against the registry, surfaced as a pre-selected
"link to existing?" default the human ratifies per item.

## 3. Guard rails

1. **The cache key stays registry-free, claims-free, case-free.** The
   pay-once economics (corpus-v4 → v7) is the point of the design; a
   guard test pins the request builder's inputs to
   `{version, text, title, url}` so vocabulary can never ride back in.
2. **The consent firewall is untouched.** Everything the pass emits is
   a proposal; nothing enters the claim or entity registry without a
   per-item human Accept. (MA.1's correction still governs: the
   firewall is about review status, not retention.)
3. **Never-merge (Art. 6) shapes the ladder.** Rungs that resolve by
   *identity* — exact `hash(type + normalized name)`, recorded alias
   families — behave as today. Near-name rungs (token-subset,
   surname+initial, a small curated nickname table) only ever produce
   ranked *candidates* with a human click between candidate and link.
   No similarity scores are stored; no auto-merge on a guess, ever.
4. **The layer's storage contract is unchanged.** `article-extractions`
   holds claim-shaped atoms only (MA.4's scope decision stands);
   proposed entities ride the cached extract and the modal, never the
   layer. Kind 30070 therefore publishes the same record shape.
5. **The reduce input stays bounded.** Only `load_bearing` atoms feed
   the reduce — parity with today's selective `key_assertions` — while
   comprehensiveness lives in the full claim list. The prompt keeps
   selectivity meaningful: flag only what the position rests on.
6. **`is_key` becomes case-scoped only.** The article pass never
   writes `claim.is_key`; article-relative keyness is `load_bearing`
   on the atom (and the modal's ⭐ display). The reduce's `is_key`
   promotion and the human checkbox remain the only writers. This is
   the deliberate fix for the §1 scope collision — second-guessable,
   so it gets a JOURNAL entry when it ships.

## 4. Slices (riskiest value assumption first)

**UA.1 — extract-driven claims.** The risky assumption is "one
reading's claim output can replace Suggest's." Bump the map to
corpus-v8: the assertion list becomes comprehensive, each atom gaining
`text` (paraphrase) and `load_bearing`; reduce and entity page read
the `load_bearing` subset. The Suggest button renders its *claim*
half from the cached-or-fresh extract; the remaining LLM call slims to
entities + claim→entity links (its input includes the extract's claim
index, so links stay model-quality instead of degrading to
string-matching). Honest economics: a first-touch article still costs
two reads in this slice — UA.1 buys *proof*, not savings, except on
already-analyzed articles, where Suggest immediately becomes the
small entities call. The acceptance walk doubles as the owed
corpus-v3→v7 revalidation (JOURNAL the outcome of both).

**UA.2 — one call.** Entities join the unified schema (refs native);
the separate entities call and the prompt vocabulary
(`SUGGEST_VOCAB_MAX` injection) retire; the resolution ladder ships —
a pure matcher in `shared/` plus the modal's pre-selected
link-to-existing default (the `entityChoice` affordance already
exists; only candidate ranking is new). This is where the spend
halves and where naming quality could regress — measured, below.

**UA.3 — retirements and vocabulary.** `autoPreAnalyze` retires (Art.
3: recorded in JOURNAL, git-recoverable, re-arguable); the suggest
tool schema and its `is_key` field retire with the standalone pass;
UI and docs speak one vocabulary ("claim proposal" everywhere a human
reads; "assertion" survives only as the layer's storage term if
renaming the store is judged not worth a migration); USER_GUIDE,
Options copy, and CLAUDE.md updated. Review-only slice.

## 5. Success criteria (falsifiable, with check dates)

- **UA.1** — checked at its acceptance walk, recorded in JOURNAL by
  the next release tag: (a) working a reference article set, the
  maintainer finds extract-driven claim proposals acceptable at
  parity with remembered Suggest quality — "used, at parity" or
  "worse, at X" goes on the record; (b) Suggest on an
  already-analyzed article observably spends only the entities call;
  (c) Analyze after Suggesting N members reports those members
  cached.
- **UA.2** — checked at its walk, recorded by the next tag: on a
  registry-rich reference set, the counts on the record — how many
  re-mentions the ladder's top candidate resolved correctly, and how
  many new fragments needed dedupe-review afterward — compare not
  meaningfully worse than the same articles' vocabulary-era history.
- **Program (the fact-layer test)** — by the second case corpus
  worked after UA.2 ships, the casework runs on the unified pass
  alone; reaching for the old two-pass flow, or silence at the check
  date, is a finding.

## 6. Kill criteria

- **UA.1:** if the modal reads as noise next to remembered Suggest
  output, revert the consumer wiring (Suggest re-runs its own claim
  half); the paraphrase field stays (additive, harmless). JOURNAL the
  kill.
- **UA.2:** if fragmentation is meaningfully worse than the
  vocabulary era, revert to the separate vocabulary-aware entities
  call and stop at UA.1 permanently — a coherent resting point (one
  reading for claims, one micro-call for entities). JOURNAL the kill.
- **Program:** two consecutive check dates without casework pull
  retires the whole direction per the flag-lifecycle norm.

## 7. Costs (maintainer attention — the scope budget)

- UA.1: one PR review + one walk (which doubles as the owed corpus
  revalidation — two debts, one session).
- UA.2: one PR review + one walk (the fragment-rate measurement).
- UA.3: one review, no walk.
- Carrying surface at the end is *smaller* than today's: one prompt
  surface instead of two, one fewer feature flag, the vocabulary
  injection code gone, one vocabulary for humans.

## 8. Non-goals / deferred (one line each)

- **Enriching the extraction-queue accept path** (about-entities,
  asserter, anchors on dashboard accepts) — real, separate
  opportunity; orthogonal to input unification.
- **Judgment kinds returning to the per-article pass** — settled
  2026-07-20; their evidence lives at corpus level.
- **Semantic/auto entity merging** — refused permanently (Art. 6);
  the ladder proposes, humans ratify, dedupe-review backstops.
- **The LM Studio transcript-draft pass** — different engine, its own
  consent; untouched.
- **Reduce/brief semantic changes** — none; the reduce sees the same
  shaped input (the load-bearing subset).
- **A retroactive re-extraction sweep** — records survive the version
  bump (MA.1); old corpora re-pay per article on demand only.
- **An exhaustive nickname table** — small curated list or none;
  misses cost one human click, not correctness.

## 9. Wire, schema, and discipline routing

- **No new kind** (the Standard-9 check): claims stay 30040, the
  per-article unit stays 30070, the brief stays 30023 + 30068.
  Expected classification is **"Wire format: none"** — 30070
  publishes the layer record, whose shape guard rail 4 freezes, and
  atom `text` has existed since MA.4 — but ecosystem-pm classifies at
  each PR, not this doc.
- **Versioning:** `MAP_PROMPT_VERSION` v7→v8 (a genuine map-input
  change) and `CORPUS_PROMPT_VERSION` with it; one-time fingerprint
  cache orphaning, knowledge survives (the MA.1 posture, priced in).
- **Storage:** `corpus-extracts` rows gain additive JSON fields — no
  `DB_VERSION` bump expected; schema-evolution reviews the extract
  validator change and the no-migration claim.
- **Prompts:** edits to `corpus-prompts.js` / `llm-prompts.js` happen
  under their existing DISCIPLINES headers — read the governing
  section first, per the repo rule.
- **Reviews:** architect (reversibility — everything here reverses
  except the one-time cache orphan), verification-engineer (owns both
  walks and the guard tests), security-threat-modeler (the prompt
  surface changes), product-manager (check-date sweep on §5/§6).

## 10. Open questions (settled at implementation review, not here)

1. Extract field naming — extend `key_assertions` in place vs. a new
   `claims[]` with a compatibility read; schema-evolution's call.
   **SETTLED at UA.1 review: extend in place.** v8 keys make old
   extracts unreachable, so a compatibility read had nothing to read;
   the rename would touch every consumer and fixture for cosmetics.
   UA.3 owns the human-facing vocabulary (JOURNAL 2026-08-12).
2. The producer stamp for unified-pass atoms — keep `'map'` for
   continuity vs. a new value; readers currently treat absent as map.
   **SETTLED at UA.1 review: `'map'` stays.** Extract-derived rows
   skip the suggest fold entirely (`from_extract`); the provenance
   chip on Suggest-found atoms now honestly reads as the map's.
3. Nickname table: ship the small curated list in UA.2 or skip it and
   lean on dedupe-review.
   **SETTLED at UA.2 review: SKIPPED.** The ladder ships with exact /
   alias / token-subset / surname-initial rungs only; a nickname miss
   costs one human click and dedupe-review backstops (§8's own
   posture). Revisit only if the UA.2 walk's fragment counts say so.
4. Whether the portal's "Pre-analyze" button copy changes once
   Suggest is the same pass (naming sweep belongs to UA.3).
   **SETTLED at UA.3 review: the copy KEEPS "Pre-analyze".** The
   button is the case dashboard's bulk ahead-of-time map over ALL
   members — a different affordance from the per-article Suggest,
   accurately named for what it still does. What retired was the
   AUTO variant (`autoPreAnalyze`), which the unified pass made
   meaningless: every Suggest click is the map call now.

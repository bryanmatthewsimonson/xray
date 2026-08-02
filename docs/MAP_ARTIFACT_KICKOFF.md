# Map Artifacts — the durable per-article extraction layer (kickoff)

**Status: APPROVED 2026-07-24** (maintainer: "Make it so"). Corrects
the corpus-v4 map stage's storage posture: paid analysis was persisted
as a *cost cache* (fingerprint-keyed, disposable) when the project's
charter needs it persisted as *knowledge* (article-keyed, accumulating,
reviewable, buildable-upon). See `docs/JOURNAL.md` 2026-07-24.

Related: `docs/CASE_SYNTHESIS_DESIGN.md` (the map/reduce this layers
under), `docs/EPISTEMIC_AUDIT_DESIGN.md` (the precedent — audit runs
are unreviewed LLM output stored per-article, export-included, with
wire kinds), `docs/PHILOSOPHY.md` (P3/P4 evidence-bound, P6 coverage
on its face, P12 transparency).

## 1. Diagnosis — unreviewed ≠ disposable

The map stage is the expensive half of a corpus synthesis: one LLM
call per member article, emitting the article's position, its
load-bearing assertions (verbatim, machine-groundable quotes), the
sources it cites, and its open questions. As shipped in 20.4/corpus-v4
that output had **memo-table citizenship**:

- keyed by an input fingerprint (`corpusExtractKey`) nobody can browse
  — findable only by recomputing the same inputs;
- orphaned wholesale by any `MAP_PROMPT_VERSION` bump (v2→v4 discarded
  every extract ever bought, documented as an accepted cost);
- duplicated per case frame — the same article analyzed in a second
  case, or for an entity page under a different frame, pays again and
  stores separately;
- invisible: assertions surface nowhere except as reduce input;
  `source_references` and `open_questions` were paid for on every call
  and consumed by **nothing**;
- non-atomic: a load-bearing assertion becomes a durable claim only if
  the reduce happens to re-propose it AND a human accepts — the map's
  own grounded quotes have no path into the claim registry.

The root error was conflating two orthogonal axes. The **consent
firewall** (nothing the model returns enters the claim registry
without a human Accept) governs *review status*. It says nothing about
*retention*. The audit ledger proves the point: epistemic audit runs
are unreviewed LLM output too, and they are stored per-article,
export-included, never auto-dropped. The map extract — which contains
the claim-shaped atoms this whole tool exists to produce — deserved at
least that citizenship.

The charter version: analysis must be an **asset that accumulates**,
so other researchers (and the same researcher, later) can build on it
asynchronously, and so incremental analysis gets cheaper instead of
re-paid. "Picked up whenever there is time" is a durable pending-review
queue. Durability and the firewall were never in tension.

## 2. The design in one paragraph

Every map pass — Analyze, Pre-analyze, auto-pre-analyze on capture,
entity-page `ensureExtracts` — folds its extract into a **durable
per-article extraction record** (`article-extractions` store,
`xray-audits` DB, keyed by `articleHash`, export-included, never
auto-dropped). The fold is a *merge, not a replace*: assertions are
grounded against the canonical member text and deduped by quote-span
overlap, so re-runs under new prompts, new models, or new case frames
**diff in** only what is new, each atom stamped with its own
provenance (model, prompt version, frame, time). Assertions not
covered by an existing claim render in the case view as a durable
review queue: Accept mints a real claim through `ClaimModel.create`
(stamped `suggested_by: 'llm:<model>'`), Dismiss is remembered on the
record. Sources and open questions are stored and rendered — consumed,
not discarded. The fingerprint cache (`corpus-extracts`) survives
unchanged as an exact-reuse hint; it is no longer the only home of
paid work.

## 3. Guard rails

1. **The firewall stands.** Nothing auto-enters the claim registry.
   The record's assertions are *parked proposals*; only a human Accept
   creates a claim, through the existing model firewalls, stamped
   `suggested_by`. Dismissals are remembered (triage lives on the
   record, content-keyed, surviving re-runs — the 27 S.3 discipline).
2. **Claims-free storage** (the corpus-v4 lesson, kept). The record
   never stores `claim_ref` or any join against the claim registry —
   assertion→claim coverage is computed on read against the CURRENT
   claim set, so it can never go stale. The only claim ids on the
   record are `accepted_claim_id` stamps, which record a *human
   action*, not a computed join.
3. **Grounded or dropped** (P3/P4). An assertion is stored only if its
   quote grounds in the canonical member text; the stored quote is the
   article's own span (`ground().exact`), never the model's copy.
   Ungrounded assertions are counted (`dropped_ungrounded`) and the
   count is disclosed on the review surface (P6) — an unlocatable
   quote must not become an acceptable proposal.
4. **Merge is content-addressed and idempotent.** A member's record
   remembers which extract fingerprints it has folded (`merged_keys`);
   re-folding a known extract is a no-op. Two assertions are the same
   atom when their grounded spans substantially overlap (≥60% of the
   shorter span) — no semantic dedup, no similarity guess (P4/P9).
   First capture wins; provenance of the first sighting is kept.
5. **No wire kind in this slice.** Accepted assertions materialize as
   ordinary kind-30040 claims through the existing publish paths.
   Publishing the extraction layer itself (so other researchers can
   literally build on it) is §6.3 — a real goal, deferred as its own
   decision because wire-format changes have compatibility
   consequences.
6. **No score, no verdict** — the record and the review surface carry
   quotes, provenance, and counts; nowhere a number that ranks or
   adjudicates.

## 4. Slices

- **MA.1 — the record + the merge** (this PR).
  `src/shared/map-artifacts.js`: pure `mergeExtractIntoRecord` (ground
  → dedup → append, triage-preserving, claims-free) + the
  `recordArticleExtraction` storage wrapper; `audit-cache.js` v7 adds
  `article-extractions` (keyPath `articleHash`). All four map runners
  fold on both cache hit and fresh call (hit-folding is what backfills
  records for extracts prepaid before this feature; `merged_keys`
  makes it O(1) after the first fold). A fold failure is logged, never
  thrown — it must not disturb a paid run.
- **MA.2 — the review surface** (this PR).
  `src/portal/extraction-block.js` in the case view: per-member open
  assertions (claim-covered ones annotated out of the queue, computed
  on read), editable claim text prefilled with the quote, Accept /
  Dismiss with durable triage, sources + open questions rendered,
  drop counts disclosed. Renders only when records exist for members;
  costs no LLM call and is therefore not consent-gated.
- **MA.2b — verification where you are** (this PR).
  `src/reader/extraction-bar.js` + `refreshExtractionBar` in the reader:
  the per-article view of the durable record, so a mapping run is
  visible **from the article itself** — counts, model/prompt
  provenance, and each grounded assertion quote click-to-locate in the
  body (selection only; the body is contenteditable and syncs the
  draft). Keyed by the canonical content hash, the same key the record
  is stored under. Deliberately READ-ONLY: triage stays in the case
  dashboard, which has the case context a minted claim needs
  (`about: [caseId]`) — a second, context-poorer accept path would
  invite claims with no case. Renders nothing when the text has no
  record; a record anchored to a RETAINED PRIOR version is disclosed
  rather than shown as if it applied (the audit panel's convention —
  assertions are exact spans and never transfer across edits).
- **MA.3 — reduce reads the layer** (SHIPPED 2026-07-25). The Analyze
  run's reduce input is the UNION of each member's live extract and
  its accumulated record (`unionExtractWithRecord` — span-dedup,
  live atoms never dropped, record extras capped at
  `MAX_REDUCE_ASSERTIONS_PER_MEMBER`, dismissed atoms excluded: a
  human said not-load-bearing and stays said). A member whose live
  call FAILED but whose record holds prior analysis is RECOVERED
  (`reduceExtractFromRecord`) instead of dropped — disclosed on the
  run status and stored on the brief record (`recovered`).
- **MA.4 — Suggest convergence** (SHIPPED 2026-07-27). The reader's
  EXTRACTION pass and the corpus map stage were two parallel producers
  of claim-shaped output, one durable and one session-only. They now
  feed ONE layer: `suggestExtractFromProposals` converts the suggest
  pass's **claim** proposals into the map-extract shape, and
  `reviewSuggestions` folds them through the SAME
  `mergeExtractIntoRecord` — one span-dedup rule, so a sentence both
  passes find is one atom, not two rows. Closing the review modal no
  longer discards paid analysis. Details:
  - **Grounded against the CANONICAL text, not the rendered body.**
    The modal grounds against `articleBodyText()` (DOM text); the
    record's spans index `assembleArticleBody(hashableArticle(…))`.
    The fold re-grounds every quote against the canonical body, so a
    reader-only rendering artifact is dropped-and-counted rather than
    stored as a span that indexes nothing (guard rail 3). This is the
    same class of assumed-invariant the 2026-07-25 review caught in
    the backup merge — enforced here, not documented.
  - **Only when the hash describes the body.** An edited body dirties
    the hash and the record is keyed BY that hash, so the fold skips
    rather than attach this text's atoms to another text's identity.
  - **`producer` stamp** (`'map' | 'suggest'`, absent ⇒ map) on each
    atom's `first_seen`; both review surfaces name which pass found
    it, and a record can hold both.
  - **The suggest pass's authored claim text** rides as `text` and
    prefills the mint box — that paraphrase is what it adds over the
    map's bare span.
  - **Keyless folds report `changed: false`** when every atom dedups:
    the suggest path has no input fingerprint, so without this every
    Suggest run would rewrite the record for nothing.
  - **One review surface**: the reader bar now computes claim coverage
    (as the case dashboard always did), so a claim minted through the
    modal stops reading as an open proposal.
  - **Scope**: only `kind: 'claim'` proposals fold. Entities,
    assessments, relationships, findings, and baselines are different
    artifacts with their own models and stay the modal's business —
    folding them here would invent a storage contract this record
    does not have.
- **MA.5 — the case-free map** (SHIPPED 2026-07-25 as corpus-v7,
  simplified from the original two-pass split). Rather than paying a
  second case-framed position call per article, the WHOLE map went
  case-free: the extract reports what the article argues on its own
  central question, and relating that to a case is the reduce's job
  (it has the frame and always did). One request builder, no frame in
  the prompt or the cache key ⇒ an article's extract is paid ONCE
  EVER, shared by every case, entity page, and capture prepay. The
  v4→v7 bump orphaned the fingerprint cache exactly as MA.1 priced
  in: knowledge (the records) survived; only exact-reuse re-pays.
- **MA.6 — publish the layer** (SHIPPED 2026-07-29). New wire kind
  **30070 `ExtractionAnalysis`**: the extraction analysis of one
  article, published per (author, articleHash) as a replaceable event.
  Behind `extractionAnalysisPublishing` (default off).

  **The disclosure posture (maintainer, 2026-07-29).** This decision
  was taken twice. The first rule was *nothing publishes that the user
  has not reviewed and accepted*, which disqualified three of the four
  panel designs. The maintainer then **revised it**: the WHOLE
  extraction unit publishes — every atom in every review state, WITH
  the model's proposed paraphrase and rationale — because a filter the
  reader cannot see cannot be audited, and the full queue with an
  honest denominator is the better disclosure. The revision also
  overrides the panel's unanimous never-ship-model-prose position.

  **The consequence, stated plainly: the MARKING is the only
  safeguard.** Four properties carry it, in descending order of how
  much damage a regression does:

  1. Every row carries a **required** `status` from a closed set
     (`unreviewed` / `accepted` / `dismissed`), and an unknown or
     absent status reads back as `unreviewed` — fail-safe, never
     fail-open. Local `open` publishes as `unreviewed`.
  2. Model prose lives ONLY in `model_`-prefixed keys
     (`model_note`, `model_proposed_text`). It never appears as
     `quote`, never as the human's `why`, never at the top level of
     `content`. `quote` is always the article's OWN span
     (`ground().exact`).
  3. Endorsement is a **pointer**, not a payload: an accepted atom
     whose claim is published carries that claim's `a`-coordinate, and
     the coordinate is also indexed as a face-value
     `["a", …, "endorsed"]` tag. Accepted-but-unpublished reads
     `endorsement: 'local-only'`. Human-attributable fields (`why`,
     `why_by`) are emitted only on accepted rows and **ignored on
     parse** for any other row — a hostile event cannot smuggle
     endorsement in.
  4. No judgment surface: no `p` tag (so this never sits beside real
     claims in a `#p` dossier query), no NIP-32 `L`/`l` label
     aggregation path, no NIP-22 `I`/`K` root scope, and no numeric
     slot anywhere — no score, confidence, stance, rating, or rank.
     Machine-guarded in `tests/extraction-publish.test.mjs`.

  **Why a kind at all, given accepted atoms already publish as
  kind-30040 claims?** Because the analysis is not the atoms. A claim
  carries text + quote + anchor + `about`; it has no slot for the
  reasoning structure around it — what the model proposed and why,
  which outside sources the article leans on, what it leaves open, and
  crucially **what was examined and not endorsed**. That structure is
  what makes a corpus interrogable rather than a pile of quotes, and
  it is discarded at accept time today.

  **The move that removes the redundancy:** 30070 **references**
  published claims by `a`-coordinate and never restates their text.
  One copy of an endorsed claim's text exists on the wire — in the
  claim — so an edited claim can never leave two signed events
  disagreeing about it. 30070 is an analysis layer *over* published
  claims, not a second copy of them. (Every row does carry the
  article's own verbatim `quote`, which is what makes an unendorsed
  row checkable at all; that quote is the article's text, not the
  claim's.)

  **Scope guard — the rationale is article-intrinsic here.**
  "Load-bearing" is load-bearing *for* something, and case-scoped
  `load_bearing` with a `why` already publishes on the kind-30068
  CaseBrief. 30070's rationale answers only *"why this claim carries
  THIS ARTICLE's argument"* (corpus-v7 made extraction
  article-intrinsic); anything case-relative belongs to the brief.
  The `caseName`/`scopeQuestion` frame never publishes.

  **Grafted from the panel's designs:** cross-machine merge — a
  fetched foreign 30070 must fold through the same span-dedup
  discipline as `mergeExtractionRecords`, which means a consumer
  re-locates each `quote` in its OWN copy of the article rather than
  trusting foreign offsets (the
  `TextPositionSelector`-is-verification-only rule in
  `docs/NIP_DRAFT.md` already states exactly this, and applies here).
  This is why the record's own `start`/`end` are **not** published.

  **Still NOT published, each omission declared in `withheld`:**
  `positions` (unanchored model prose characterizing the article),
  the `caseName`/`scopeQuestion` frame, `merged_keys` (local cache
  fingerprints), `sources[].quote` (the model's copy of a span, never
  re-grounded locally — `target_hint` only), and ungroundable
  proposals (never stored, so no text exists to publish; only the
  count discloses them). Coverage counts publish as face-value tags:
  disclosing the shape of what was examined is a **P12** transparency
  duty, and counts are not scores — P6 governs the knowability
  ceiling on scores, of which this format has none.

  **Publishing is human-initiated per article** and never automatic or
  bulk-by-default: the case dashboard's extraction block grows a
  per-article "Publish analysis…" button (with a confirm naming what
  leaves the machine) and, when more than one record can publish, one
  batch button whose confirm names the exact N and the skip count.
  Read-back registers 30070 in the portal's `CONTENT_KINDS`, an
  **Extractions** library facet summarized BY REVIEW STATE (never "24
  assertions" with the states hidden), and an inspector section where
  the state badge leads every row. It is deliberately NOT in
  `NETWORK_FEED_KINDS` — that feed carries what a followee stands
  behind, and safely folding a foreign analysis needs the deferred
  re-grounding slice; the omission is pinned by a test so it does not
  read as an oversight.

- **MA.7 — the import verifies instead of trusting** (SHIPPED
  2026-08-02). The deferred fix for the cross-machine span bug, decided
  by a three-design panel with three judging lenses (unanimous, 3–0).

  **The bug, measured.** A probe over two bodies inside one hash
  equivalence class — one with CRLF and trailing spaces, one without —
  put the SAME sentence at `[10, 59)` on the exporting machine and
  `[8, 53)` locally. Trusting the foreign offset could dedup an atom
  against the wrong local atom, or adopt an imported accept/dismiss onto
  the wrong sentence. Re-grounding the foreign quote in the local body
  recovers `[8, 53)` exactly, and the local slice reproduces the quote.

  **The shape of the fix is structural, not a convention.**
  `mergeExtractionRecords(local, incoming, { localText })` now REQUIRES
  the local body, and refuses with `skipped: 'no-local-text'` without
  it. The `DEEP_MERGE_STORES` entry that used to reach it textless was
  DELETED rather than defaulted, so there is no code path a future
  caller can take to trust a foreign offset. Every incoming quote is
  re-located locally; only `exact` and `normalized` hits are accepted
  (never a fuzzy guess — that is exactly where a guess becomes a
  mis-attributed human ruling); the stored span and quote are the LOCAL
  ones; and the atom's key is recomputed from local coordinates.

  **Twin-finding is by untruncated quote identity**, then by
  locally-computed span overlap. Whitespace-folded exact equality is
  what survives the hash equivalence class (P9-safe: no similarity
  guess). The 160-char `normIdent` cap is deliberately NOT reused —
  collapsing two long atoms into one identity would attach an imported
  ruling to the wrong sentence.

  **No foreign ruling is ever adopted.** It rides attributed as
  `imported_ruling` (status, foreign claim id, time, and the rationale
  today's adoption silently dropped) and is inert: `partitionAssertions`
  still sees the atom as open, and the review surface labels it
  "recorded from another machine, NOT applied". Adopting it would
  resolve another person's disagreement by import (P8) and let a file
  create a claim-registry endorsement. The wire path already mandates
  exactly this for foreign kind-30070 events.

  **Three bugs in the already-merged import path**, each found by the
  panel and fixed here: a foreign `merged_keys` fingerprint would have
  permanently suppressed this machine's own fold of its own paid extract
  (the key hashes {promptVersion, text, title, url}, NOT the model, so
  it collides); a foreign `published_at`/`published_event_id` would have
  made the portal show "published <date>" and offer "Republish" for an
  event this identity never signed; and a foreign `accepted_why` landed
  in the field that publishes as the SIGNER's own rationale with
  `why_by: 'user'`. None is imported now.

  **Where the body comes from.** IndexedDB has no cross-database
  transaction: bodies live in `xray-archive`, the merge transaction is
  on `xray-audits`. So no lookup — sync or async — is possible from
  inside it, and pre-resolution is the only available shape.
  `extraction-import.js` resolves bodies in 25-record chunks before each
  transaction (bounding peak memory: a grounding index over a 60k body
  is ~1.9 MiB), yields between chunks, and reports progress.
  `bodiesByArticleHash` (archive-cache.js) cursors the archive keeping
  only the requested bodies, resolves retained PRIOR versions too, and
  stops early. It is deliberately NOT gated on re-hashing the local text:
  a published or PDF-derived row's body legitimately no longer re-hashes
  to its own `articleHash` (htmlToMarkdown is not idempotent), so a hash
  precondition would make the fix a no-op for the dominant row types.

  **Two refusal reasons, kept apart** — "this machine holds no copy of
  that text" is a gap in the archive; "I hold that text and your quote
  is not in it" is a FINDING (the export analyzed a different version,
  or a quote is corrupt). The second is recorded on the record as
  `imported_unlocated` (bounded, `IMPORTED_UNLOCATED_MAX`) rather than
  folded into `dropped_ungrounded`, which already carries one published
  meaning. The Options merge report names the articles by URL in a
  PERSISTENT element, and anything refused SUPPRESSES the auto-reload
  that used to wipe the summary three seconds later.

  **Also fail-closed:** `setAssertionTriage` / `setAssertionRationale`
  now return `{ record, matched }`. They used to `.map()` over an
  equality predicate and return regardless, so a key matching nothing
  wrote a bumped `updatedAt` and lost a human decision while looking
  like success. The portal throws on `matched === 0`, and the Dismiss
  handler — which previously logged to the console and said nothing —
  now reports on the row.

  **Deferred from this slice, deliberately:** a `substrateAgreement`
  diagnostic for the separate PURELY-LOCAL staleness case (a re-capture
  inside the whitespace equivalence class replaces the body under a
  record with no prior-version snapshot, since the hash did not change);
  an `isOpenStatus` unification; and the provenance question below.

  **OPEN, for the maintainer:** should a backup from your OWN other
  machine auto-adopt triage onto still-open atoms, or always require an
  Adopt click? This slice ships the SAFE default (never adopt; always
  attributed) and the mechanism. The panel's suggestion is a provenance
  choice on the typed-MERGE dialog — "my own export from another
  machine" vs "from someone else" — which puts the consent firewall
  between two PEOPLE (P8) rather than between two of your own installs,
  and makes the trust assumption an explicit human statement.
- **Adjacent (2026-07-25): backup merge-import.** `mergeBackup`
  (backup.js) accrues a backup file into the live corpus — content
  only, add-if-missing by id, nothing local deleted or overwritten —
  and this layer supplies its one deep merge:
  `mergeExtractionRecords` unions assertion atoms into the local
  record. As first shipped it trusted the incoming offsets, which was
  wrong up to the hash's own equivalence class: `normalizeForHash`
  collapses whitespace before hashing while offsets index the
  un-normalized body, so two bodies differing ONLY in whitespace share
  a hash and disagree about offsets. **MA.7 fixes that** — see below.

## 5. Storage shape (MA.1)

```
article-extractions (xray-audits v7, keyPath articleHash)
{
  articleHash,                     // canonical content hash (or url:<sha16> fallback)
  url, title,                      // convenience, latest-seen
  assertions: [{
    key,                           // 'a:<start>-<end>' — span identity
    quote,                         // the article's OWN span (ground().exact)
    start, end,                    // span in the canonical text (stable: hash pins the text)
    text,                          // model's proposed claim paraphrase (MA.4)
    why,                           // model rationale, first sighting kept
    status,                        // 'open' | 'accepted' | 'dismissed'
    accepted_claim_id,             // set on Accept (human action, durable)
    accepted_why,                  // human-endorsed rationale (MA.6), else null
    accepted_why_provenance,       // 'user' | 'llm' — who wrote the endorsed text
    rationale_accepted_at,         // epoch seconds
    triaged_at,                    // epoch seconds, set on Accept/Dismiss
    first_seen: { model, promptVersion, producer, caseName, scopeQuestion, at }
  }],
  sources: [{ key, quote, target_hint, status, accepted_note,
              triaged_at, first_seen }],                     // deduped
  open_questions: [{ key, text, status, accepted_note,
                     triaged_at, first_seen }],              // deduped
  positions: [{ caseName, scopeQuestion, summary, side_label,
                model, promptVersion, at }],                 // per frame, latest-wins
  merged_keys: [corpusExtractKey…],                          // idempotence ledger
  dropped_ungrounded,                                        // running count, disclosed
  updatedAt
}
```

Rides `xray-audits`, so the workspace backup dumps it generically
(export-included for free) and workspace suffixing applies. `clear()`
includes it. The store is knowledge, not cache: nothing in the
codebase may auto-drop it.

## 6. What this makes cheaper

- A `MAP_PROMPT_VERSION` bump costs exact-reuse, not knowledge: every
  assertion ever bought stays reviewable; a re-run diffs in only what
  the better prompt newly finds.
- The same article joining a second case re-pays the position, but its
  assertions land in the SAME record — accumulated, not duplicated
  (and MA.5 removes the re-pay).
- Claim extraction stops being reader-only: the analysis you already
  paid for feeds a standing per-article proposal queue, reviewable
  whenever there is time.

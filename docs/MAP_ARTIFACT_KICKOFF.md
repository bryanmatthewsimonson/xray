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
- **MA.6 — publish the layer** (deferred, own decision; see guard
  rail 5).
- **Adjacent (2026-07-25): backup merge-import.** `mergeBackup`
  (backup.js) accrues a backup file into the live corpus — content
  only, add-if-missing by id, nothing local deleted or overwritten —
  and this layer supplies its one deep merge:
  `mergeExtractionRecords` unions assertion atoms by span (the hash
  pins the text, so spans are exact across machines), adopts a
  foreign human triage onto atoms still open locally, and resolves
  conflicting decisions to the local one.

## 5. Storage shape (MA.1)

```
article-extractions (xray-audits v7, keyPath articleHash)
{
  articleHash,                     // canonical content hash (or url:<sha16> fallback)
  url, title,                      // convenience, latest-seen
  assertions: [{
    key,                           // 'a:' + sha16(articleHash|start|end) — span identity
    quote,                         // the article's OWN span (ground().exact)
    start, end,                    // span in the canonical text (stable: hash pins the text)
    why,                           // model rationale, first sighting kept
    status,                        // 'open' | 'accepted' | 'dismissed'
    accepted_claim_id,             // set on Accept (human action, durable)
    triaged_at,                    // epoch seconds, set on Accept/Dismiss
    first_seen: { model, promptVersion, caseName, scopeQuestion, at }
  }],
  sources: [{ key, quote, target_hint, first_seen }],        // deduped
  open_questions: [{ key, text, first_seen }],               // deduped
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

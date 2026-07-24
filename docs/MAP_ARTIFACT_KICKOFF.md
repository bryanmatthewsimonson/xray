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
- **MA.3 — reduce reads the layer** (deferred). The reduce input
  currently rides the run's in-memory extracts (same content). Once
  the record accumulates across frames, the reduce should prefer the
  record's richer assertion set, with the digest disclosing counts.
- **MA.4 — Suggest convergence** (deferred). The reader's EXTRACTION
  pass and the map's assertion extraction are two parallel producers
  of claim-shaped output; they should feed ONE per-article atomic
  layer (this store), with one review surface. Requires reconciling
  the suggest modal's session semantics with durable triage.
- **MA.5 — the case-free map split** (deferred; bumps
  `MAP_PROMPT_VERSION`). Split the map into an article-intrinsic
  extraction pass (assertions/sources/questions — a pure article
  asset, paid once ever) and a cheap case-framed position pass. Kills
  the per-frame duplication structurally instead of caching around
  it. After MA.1, a version bump no longer destroys knowledge — only
  exact-reuse — which is what makes this split affordable at all.
- **MA.6 — publish the layer** (deferred, own decision; see guard
  rail 5).

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

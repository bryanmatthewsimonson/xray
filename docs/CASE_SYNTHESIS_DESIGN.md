# Case-corpus synthesis — design (Phase 20.4)

> **Status:** shipped 2026-07-14. Authorized by
> [`CASE_DOSSIER_DESIGN.md`](CASE_DOSSIER_DESIGN.md) §5, which deferred
> exactly this: *"A flag-gated assist could later draft prose from the
> dossier — separately designed, consent-gated."* This is that design.
> Governed by [`PHILOSOPHY.md`](PHILOSOPHY.md) for every scoring /
> structural question (see §5 below).

## 1. The gap

The case dossier (Phase 12.5 / CD.1–CD.3) structures a case's evidence —
the verdict-state distribution, the contradiction knots, the four-axis
timeline, the evidence table. Phase 20.1–20.3 made membership a union
(tag OR claim), added add-to-case outside the reader, and drew the local
case graph. What was still missing is the **synthesis over the whole
corpus at once**: a summary, the load-bearing claims, and — for a case
with opposing sides (the COVID/Rootclaim corpus) — the cruxes of
disagreement. A human can read ten articles and write that; the tool
should offer to draft it, grounded and reviewable.

## 2. Consent model

Triple-gated, all default OFF:

1. **`caseSynthesis`** feature flag (Options → Advanced → Case
   synthesis), AND
2. **`llmAssist`** (the master LLM-assist consent), AND
3. an **Anthropic API key** on the device.

A corpus run sends *every member article's text* to Anthropic — N map
calls (one per article) plus one reduce call — so it costs
proportionally more than a single-article Suggest/Audit pass. That's why
it carries its own flag on top of `llmAssist`, and why the run shows an
explicit "sends N member articles (~X characters) to Anthropic" confirm
before spending. Flag off ⇒ the surface is absent; on-but-keyless ⇒
disabled with an Options hint. The gate check is one
`xray:llm:corpus-config` message; the key never leaves the SW.

## 3. Topology (map / reduce)

Mirrors the thorough-audit topology (per-unit messages + a bounded pool,
so a lost channel costs one retryable unit, never the whole paid run,
and each message resets the MV3 idle timer).

- **MAP** — `xray:llm:corpus-map`, one call per member article. Forced
  tool `emit_corpus_extract`: the article's position (summary +
  side_label), its load-bearing assertions (each a verbatim quote, with
  an optional existing claim_ref), the outside sources it cites, and its
  open questions. Input is the SAME canonical body the article hash
  covers, sliced to `MAX_MEMBER_INPUT_CHARS` (60k) with truncation
  surfaced. The portal drives these through `orchestrateModuleRuns`
  (concurrency 2) over the member article-hash list.
- **REDUCE** — `xray:llm:corpus-reduce`, one call over the compact map
  extracts + a deterministic `digestDossier` (verdict distribution,
  knots, coverage). Forced tool `emit_case_brief`: summary, positions
  (attributed to member article_hashes), cruxes (each side's view side
  by side + evidence + what-would-resolve), load-bearing claims,
  coverage gaps, and proposals.

Pure prompt/tool layer: [`corpus-prompts.js`](../src/shared/corpus-prompts.js).
Pure assembly/validation/grounding: [`case-synthesis.js`](../src/shared/case-synthesis.js).
The SW passes live in [`llm-client.js`](../src/shared/llm-client.js).

## 4. The firewall (validate → ground → filter → human accept)

Nothing the model returns is trusted or applied automatically:

1. **Validate** — each map extract and the brief are checked against
   schema-walkers (`validateCorpusExtract` / `validateCaseBrief`); a
   malformed extract is dropped, a malformed brief aborts the run.
2. **Ground** — every `{article_hash, quote}` pair in the brief is
   grounded against THAT member's text (a `createGroundingIndex` per
   member, built from the same unit texts the map sent, so the join is
   exact). An ungrounded quote drops its containing entry (evidence_ref
   / load_bearing / claim proposal); the drop count is disclosed on the
   block and stored.
3. **Filter** — proposals must resolve: a `relationship` needs two
   existing claim ids and a valid `CLAIM_RELATIONSHIPS` enum; `is_key`
   needs an existing claim id; a new `claim` needs a real member and a
   grounded quote. Rejects render with a reason, never as acceptable.
4. **Accept** — a human clicks Accept on the portal review surface,
   which routes through the existing model firewalls
   (`EvidenceLinker.create` / `ClaimModel.update` / `ClaimModel.create`),
   stamped `suggested_by: 'llm:<model>'`. The reader's `openLlmReview`
   was NOT reused — it grounds against one document and validates
   relationship endpoints as same-pass refs, whereas corpus proposals
   reference real existing claim ids across many documents.

## 5. PHILOSOPHY compliance

- **No fused score, no verdict** (P2; CASE_DOSSIER_DESIGN §2.2 "No
  case-level score, ever"). Structural, not a promise: neither tool
  schema has a numeric score/confidence/probability slot (a test greps
  the schema keys), the reduce prompt forbids adjudicating between
  positions, and the brief renders BESIDE the deterministic dossier,
  never above it.
- **Evidence-bound** (P3/P4): every brief quote is machine-grounded
  against its named member; ungrounded quotes are dropped.
- **Disagreement is data** (P5): positions and cruxes present each
  side's view side by side; the model never picks one.
- **Coverage on its face** (P6): members analyzed / truncated / quotes
  dropped are stamped on the block and the stored record; a partial run
  ("K of N members analyzed") is disclosed, not hidden.
- **Transparency** (P12): model + `CORPUS_PROMPT_VERSION` + grounding
  counts are stored and rendered; a stale chip appears when the live
  `corpusInputHash` differs from the stored brief.

## 6. Storage & invalidation

The brief is PRECIOUS (a run costs an LLM map/reduce), so it lives in the
`xray-audits` IndexedDB — bumped to **v2** with a `case-briefs` store
(keyPath `caseId`, latest-wins per case). It is export-included
automatically (the workspace backup dumps every store of a covered
database generically). The record carries `{caseId, brief, grounding,
inputHash, model, promptVersion, members, ...}`. `corpusInputHash` is
order-insensitive over the sorted member article-hashes + orbit claim
ids + prompt version, so the stored brief goes stale exactly when
membership, member text (the hash changes), the claim set, or the prompt
version changes.

## 7. Non-goals

- **No wire kind.** The brief is local and exportable; it is never
  published. Accepted proposals materialize as ordinary kind-30040
  claims / kind-30055 links through the normal publish paths (behind
  their existing flags).
- **No auto-accept / no auto-publish.** Every mutation is a human click.
- **No case score / verdict** (see §5).

## 8. Forward compatibility

Member units are keyed by the archive-record content hash, and the map
input is the record's canonical body. So the *next* phase's
paste/upload transcripts (podcasts, YouTube speaker transcripts) become
ordinary archive records and enter the corpus with **zero synthesis
redesign** — they tag into a case (20.2) and analyze (20.4) like any
other capture.

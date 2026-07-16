# Hypothesis map — competing answers with structural evidence (design)

> **Status:** design draft (2026-07-16), **not approved** — written
> overnight for maintainer review (Phase 26 prep). No code exists yet.
> This is the "propose hypotheses from multiple points of view that fit
> the evidence" ask. It governs a NEW capability; where it and the
> epistemic constitution ([`PHILOSOPHY.md`](PHILOSOPHY.md),
> [`TRUTH_ADJUDICATION_DESIGN.md`](TRUTH_ADJUDICATION_DESIGN.md) §1,
> [`CASE_DOSSIER_DESIGN.md`](CASE_DOSSIER_DESIGN.md) §2.2) disagree, the
> constitution governs.
>
> **Constraints (binding, from the constitution — restated so the
> design can't drift from them):** no fused case or hypothesis
> **score/probability/likelihood** — ever; disagreement renders **side
> by side, never merged** (P8; `EPISTACK_ENTRY.md` "the honest headline
> is the *distribution*"); every number is a **count that shows its
> derivation**, never an estimate (`TRUTH_ADJUDICATION §1`); the model
> **never picks a winner** (`CASE_SYNTHESIS_DESIGN.md`); single-user
> untouched; no new wire kind in v1.

## §1. The problem

Today a case's disagreement is expressed two ways, both flat:

- **Synthesis `positions`** (Phase 20.4) — `{label, core_argument,
  holders:[{article_hash}]}`: a hypothesis label, a prose argument, and
  *which whole articles* hold it. Rendered side-by-side.
- **Cruxes** — `{question, sides, evidence_refs}`: the questions that
  divide the positions, with grounded quotes.

What is missing is a **structural map**: individual captured **claims**
(kind-30040) attached to a hypothesis as **supporting or undermining**
evidence, so a reader can see *which specific facts hold up which
answer*, follow each to its source, and judge the inference structure
themselves. Positions attach at the article level; there is no
claim→hypothesis edge, no per-claim role, and — deliberately — no vote
or weight. This design adds the edge, and nothing that sums it.

`COMPETITION.md` asks exactly for this ("resolve the inference
structure"), and the COVID/Rootclaim corpus is the motivating case: the
right output is not *a* probability but a legible map of what each side
rests on.

## §2. The model (structural, computed-on-read first)

A **hypothesis** is a competing answer to the case's scope question.
Following the dossier precedent (`case-dossier.js` — "DERIVED,
COMPUTED ON READ, nothing persisted, no new wire kind"), v1 assembles
the map on read from data that already exists; a wire kind is a later,
separate decision (§7).

```
HypothesisMap {
  question: string          // the case scope question (author's framing)
  hypotheses: Hypothesis[]  // side by side; ORDER is not rank
}
Hypothesis {
  id, label, statement      // a competing answer, in the author's/model's words
  edges: ClaimEdge[]        // the structural attachments
}
ClaimEdge {
  claim_ref                 // canonical kind-30040 ref (claim-ref.js)
  role: 'supports' | 'undermines'
  provenance: 'user' | 'llm:<model>'   // who drew the edge (never auto-trusted)
  quote?, article_hash?     // the grounded span, when the edge came from synthesis
}
```

Hard rules the schema encodes:

- **No `weight`, `score`, `probability`, `confidence`, or `strength`
  field on a hypothesis or an edge.** A key-grep test forbids them (the
  `CASE_SYNTHESIS_DESIGN.md` §5 discipline, reused).
- A claim may support one hypothesis and undermine another — that IS
  the disagreement; it is never resolved into a net.
- **No count that implies a winner.** "12 claims support A, 3 support
  B" is a headline that reads as a tally — forbidden. Per-hypothesis
  edge counts may render only as neutral section sizes ("Supporting
  evidence (12)"), never compared across hypotheses as a scoreboard.
  (This is the sharpest drift risk; call it out in review.)

### Where the pieces map on

- **`positions` → hypotheses.** Synthesis positions become the seed
  hypotheses (label + statement); their article `holders` become a
  starting set of `supports` edges to promote to claim-level.
- **Assessments (kind-30054 stance ±).** A stance is a per-claim
  agree/disagree by an author — NOT a hypothesis edge. It may inform a
  *suggested* edge (a disagreed claim that undermines a hypothesis) but
  the edge is a distinct, human-drawn object; stance never auto-becomes
  structure.
- **Propositions / verdicts (kind-30063).** A verdict is a truth state
  on one claim, orthogonal to which hypothesis it serves. The map may
  *show* a claim's verdict-state chip beside its edge (context), but a
  verdict never weights or filters the edge — a `contested` claim can
  still be load-bearing for a hypothesis, and that tension is the point.
- **Cruxes.** A crux is a question on which hypotheses' edges to the
  *same* claim diverge (A supports it, B undermines it) — the map can
  surface cruxes as the claims with opposing edges, tying the two
  surfaces together.

## §3. Assembly + the LLM-assist path

Assembly is a pure function over `collectCaseDossierData` +
`digestDossier`'s claim index (both exist): seed hypotheses from
positions, carry any human-drawn edges, render. Deterministic, testable.

Suggesting **claim→hypothesis edges** is the LLM step, and it must obey
the codified firewall (`CASE_SYNTHESIS_DESIGN.md` §4, verbatim pattern):

1. **Gate** — `caseSynthesis` + `llmAssist` + API key (the existing
   triple gate; this is a corpus-scale pass).
2. **Map/reduce shape** — reuse `corpus-prompts.js` /
   `case-synthesis.js`. The reduce tool emits, per hypothesis, a list
   of `{claim_ref, role, quote}` edges. **The tool schema has no
   numeric slot** (grep-tested).
3. **Validate → ground → filter** — every edge's `claim_ref` must
   resolve to a real captured claim (the `filterProposals` pattern);
   every `quote` grounds verbatim against the source member
   (`groundCaseBrief`); ungrounded edges drop, drop count disclosed.
4. **Human-accept** — edges land only when a human clicks Accept,
   stamped `suggested_by: 'llm:<model>'`. Nothing auto-applies, nothing
   auto-publishes. The model proposes edges for BOTH sides and never
   declares which hypothesis wins (a pre-flight instruction + a
   post-check that no hypothesis was left with zero opposing scrutiny).

## §4. Rendering (KS §8 / TC §3 discipline, generalized)

- Hypotheses **side by side**, order is presentation not rank; a
  visible "these are competing answers; X-Ray maps them, it does not
  pick one" note.
- Each hypothesis: its statement, then **Supporting** and
  **Undermining** claim lists, each claim a followable link to its
  source article + grounded quote (reuse the T1.2 provenance render).
- A claim that appears under multiple hypotheses is badged as such
  (a crux marker) — the disagreement made legible, never netted.
- No progress bars, no "strength" meters, no per-hypothesis totals
  compared to each other.

## §5. Non-goals (v1)

No score/probability/likelihood on any hypothesis or edge; no
winner/ranking/ordering-by-strength; no auto-accept or auto-publish of
edges; no new wire kind (local-derived first); no merging of
disagreement into a net; no replacement of the existing positions/crux
prose (the map sits beside them); single-user posture unchanged.

## §6. Collision with the philosophy — where this must stop

The map is safe **only** as structure. The three ways it would cross a
red line, and the guard for each:

1. **A fused hypothesis score.** → No numeric slot in the model or the
   tool schema; grep test. (`TRUTH_ADJUDICATION §1` "never '73% true'";
   `CASE_DOSSIER §2.2` "no case-level score, ever".)
2. **A support-count scoreboard** ("A: 12, B: 3") implying a winner. →
   Counts render only as neutral section sizes, never cross-compared;
   a review checklist item and, ideally, a test asserting the render
   emits no cross-hypothesis comparison string. (P8; Red Line #1
   "never average away disagreement into a single consensus number.")
3. **The model picking a side.** → Pre-flight refusal + the both-sides
   requirement + human-accept-only. (`CASE_SYNTHESIS` "the model never
   picks one.")

`PHILOSOPHY.md` closes: "A proposed feature that requires crossing a
red line is not a feature; it is a different, worse system." A
structural argument map clears the bar; a scored one does not — and the
scored one is a **separate, constitution-amending decision the
maintainer has not taken.**

## §7. Slice ladder (for review — not yet approved)

| Slice | Content |
|---|---|
| H.0 | This doc, approved + a ROADMAP Phase-26 entry |
| H.1 | Pure model + assembler over `collectCaseDossierData` (seed from positions; carry human edges) + tests |
| H.2 | Render side-by-side on the case dashboard (reuse T1.2 provenance links); no-scoreboard guard test |
| H.3 | Manual "attach claim → hypothesis (supports/undermines)" affordance (human-drawn edges) |
| H.4 | LLM edge-suggestion via the map/reduce firewall (triple-gate, ground, human-accept, both-sides) |
| H.5 (deferred) | A wire kind for publishing a hypothesis map — only if the network needs it; a separate decision |

## §8. Open questions for the maintainer

- Should hypotheses ever get a **wire kind** (publish the map), or stay
  local-derived like the dossier? (Recommend local-derived first.)
- Is a neutral per-section edge **count** acceptable at all, or is even
  "Supporting evidence (12)" too scoreboard-like for the constitution?
- Should a claim's **verdict-state chip** show beside its edge (context)
  or is that too close to weighting? (Recommend show-as-context, with
  an explicit "verdict does not weight the edge" note.)

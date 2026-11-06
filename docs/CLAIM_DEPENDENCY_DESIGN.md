# Claim dependencies — "B cannot stand if A is false" (design)

> **Status:** **draft** 2026-11-06, for maintainer review. The
> maintainer asked for this document after agreeing, in conversation,
> to the two recommendations it rests on (§8): dependency edges run
> **claim → claim only**, and the edge is a **new value of the kind-30055
> `relationship` tag**, not a local-only store. Approval is the merge
> (CONSTITUTION Art. 14). Implementation follows the §7 slice ladder,
> one PR per slice, after the Phase-26 precedents
> ([`HYPOTHESIS_MAP_DESIGN.md`](HYPOTHESIS_MAP_DESIGN.md),
> [`COUNTERFACTUAL_DESIGN.md`](COUNTERFACTUAL_DESIGN.md)). Where this
> and the constitution ([`CONSTITUTION.md`](CONSTITUTION.md),
> [`PHILOSOPHY.md`](PHILOSOPHY.md),
> [`TRUTH_ADJUDICATION_DESIGN.md`](TRUTH_ADJUDICATION_DESIGN.md) §1)
> disagree, the constitution governs.
>
> **Constraints (binding, restated so the design cannot drift):** no
> probability, likelihood, confidence or fused score anywhere; every
> number is a **count that shows its derivation** (CONSTITUTION Art. 1,
> Art. 5.3 — "counterfactual dependency counts are measurements");
> disagreement renders side by side, never netted (Art. 6); no verdict
> is ever recomputed by this feature (COUNTERFACTUAL_DESIGN §5); the
> model proposes, a human accepts, nothing auto-publishes
> (CASE_SYNTHESIS_DESIGN §4).

## §1. The problem

The maintainer's framing (2026-11-06): knowledge is gated by prior
knowledge. "If A is correct, and B depends on A, then B may still be
correct. If A is incorrect, and B depends on A, then B is necessarily
incorrect." In a corpus of human accounts, where people lie,
misremember, or are simply mistaken, that chain is the thing an
investigator most needs to see. Earlier attempts to show it in X-Ray
"have been done poorly".

They were done poorly because X-Ray holds three things that each
*look* like load-bearing and none of them is a dependency:

| What exists | Where | What it actually means |
|---|---|---|
| The `load_bearing` boolean on an article-extract atom | `src/shared/corpus-prompts.js` (corpus-v9 tool schema); rendered as ⭐ in the reader's Suggest modal | "The article's position rests on this assertion." A per-article **importance mark** set by the model. No direction, no target, no chain. |
| Kind-30055 `supports` (directional, source → target) | `src/shared/evidence-linker.js`, `src/shared/metadata/builders.js` | **Evidential** support: A is evidence for B. B survives A being false whenever B has other support. Several `supports` edges behave like OR. |
| Hypothesis-map edges (`supports` / `undermines`) | `src/shared/hypothesis-model.js` | A claim attached to a competing answer. One level deep; nothing records what the attachment itself presupposes. |

What the maintainer describes is a fourth relation with the opposite
logic: **B presupposes A.** If A is false, B cannot stand. Several
presuppositions behave like AND. That relation is absent from the
data, so nothing can propagate along it, and "load-bearing" has
nothing to be *computed* from — which is why it has only ever been
*asserted*.

[INTERPRETATION: the distinction between evidential support
(sufficient-ish, OR-like) and presupposition (necessary, AND-like) is
the design's spine; conflating them is the failure mode every earlier
attempt fell into.]

### The two COVID examples, in this model

- **An intermediate host is found.** The lab-leak hypothesis carries a
  `supports` edge from the claim "no intermediate host has been
  identified". That claim presupposes nothing further, but if it is
  adjudicated `established-false` the supports edge it anchors is
  **undercut**, and §3's cascade lists it. The lab-leak *hypothesis* is
  not marked anything: it has other arguments. The maintainer's "B is
  necessarily incorrect" is exactly right for an **argument** and
  exactly wrong for a **hypothesis with independent support**; the
  model encodes that difference instead of blurring it.
- **Evidence of a cover-up.** The claim "a cover-up occurred"
  `undermines` the zoonotic hypothesis on the map. The further step
  "therefore lab leak is strengthened" is the reader's inference, and
  it carries a hidden premise: "there was nothing *else* to cover up".
  That premise is itself a claim the cover-up-to-lab-leak argument
  `depends-on`. Making the hidden premise visible is the whole point
  of the structure, and it is why X-Ray must never net an `undermines`
  on one hypothesis into a `supports` on another (Art. 6).

## §2. The model

### §2.1 One new relationship value

Add **`depends-on`** to the kind-30055 `relationship` set. Directional:
**source depends on target** — the source claim presupposes the target
claim. It hashes in semantic order like `supports` and `updates`
(NIP_DRAFT §30055: "`supports` and `updates` are directional (source →
target) and hash in semantic order"), so the `d` tag stays recomputable
from the two `a` tags plus the relationship, and a `depends-on` link
and a `supports` link between the same pair coexist (the relationship
is in the hash).

```
depends-on   source → target     "source cannot be true unless target is true"
supports     source → target     "source is evidence for target"        (exists)
contradicts  symmetric           "both cannot be true"                  (exists)
```

The definition is strict on purpose:

> **The authoring test.** *Could the source still be true if the target
> turned out to be false?* If yes, the link is `supports`, not
> `depends-on`.

Most links a reader reaches for are `supports`. The link modal asks
this question in those words (§4), because a `depends-on` drawn where
`supports` was meant makes the cascade lie.

[INTERPRETATION: `depends-on` names a necessary condition in the
author's judgment, not a logical entailment X-Ray has verified. The
edge carries `suggested-by` like every 30055 link and is as fallible
as its author.]

### §2.2 Claim → claim only

Edges connect kind-30040 claims to kind-30040 claims. There is no
argument-level or hypothesis-level premise store. A hypothesis-map
edge starts at a claim, so it **inherits that claim's premises**; the
"argument from the missing host" *is* the claim "no intermediate host
has been identified" standing in a `supports` edge, and its premise
chain is claim → claim. One edge type, one store, one walk.

### §2.3 Cycles

A cycle in `depends-on` is circular reasoning. Cycles are **stored,
detected, and surfaced** as a "circular premise" marker on every claim
in the cycle — never silently refused, because finding a circular
argument in a corpus is a result. The walks in §3 use a visited set
and terminate on any graph.

### §2.4 What never appears

No `weight`, `strength`, `score`, `probability`, `likelihood` or
`confidence` on an edge or on any derived output (the
CASE_SYNTHESIS_DESIGN §5 key-grep discipline, reused). A claim with
seven dependents is not "more true" than one with none; it is more
*consequential if false*, and the surface says exactly that.

## §3. What becomes computable (counts with derivations)

All three are pure functions over the case-dossier substrate
(`collectCaseDossierData` → `links`), computed on read, nothing
persisted, no LLM. Each numeric sits beside a `derivation` array naming
the edges and claims that produced it; the existing
`tests/case-counterfactual.test.mjs` guard (banned keys nowhere, every
numeric beside a derivation, banned phrasing in render lines) extends
to cover them.

### §3.1 Load-bearing as a measurement

A claim's **load** is the set of claims that transitively depend on it
(the reverse closure of `depends-on`). It renders as
"Load-bearing (7 dependents)" with the seven listed, each with its
chain back to the claim. This **replaces the model's boolean as the
meaning of the words "load-bearing" in the UI**. The extract flag
stays: it bounds the reduce input (UNIFIED_ARTICLE_PASS_KICKOFF) and
is baked into the corpus-v9 schema. But the reader's ⭐ and every
label stop calling it load-bearing; it becomes "argument-critical
(model's reading)" or similar copy decided in §7's D.3.

### §3.2 The cascade

`traceClaimDependencies` in `src/shared/case-counterfactual.js` today
diffs **one hop**: remove or negate a claim, report the knots,
supports/attestation edges, hypothesis edges, entities and timeline
bands that change. The cascade extends `negate` (and adds a sibling
`assume: 'false'` reading of the same walk) to the **transitive
closure over `depends-on`**:

```
Cascade {
  root: claim_ref
  undercut: [ { claim_ref, chain: [claim_ref…], derivation } ]   // every transitive dependent
  hypothesis_edges: [ { hypothesis_id, label, claim_ref, role, via: chain } ]   // edges those dependents carry
  knots: …            // the existing one-hop knot diff, now run over the whole undercut set
  cycles: [ [claim_ref…] ]
}
```

Rendered through the existing trace expander (`src/portal/trace-block.js`,
CF.2) as plain lines: "If this claim were false, 7 claims would lose a
necessary premise (chains shown) · 3 hypothesis edges would be undercut
· 1 contradiction knot would dissolve."

**Only falsity propagates.** The truth of a premise establishes
nothing about its dependents, and the render says so in one fixed
sentence rather than leaving the asymmetry to be inferred. There is no
`assume: 'true'` mode.

### §3.3 Shared premises (independence, made structural)

Two arguments for one hypothesis that both depend on the same claim
are not independent. The map already renders a claim attached to more
than one hypothesis as a crux; this adds the dual: **one premise under
more than one supporting edge of the same hypothesis** renders as a
"shared premise" marker on the hypothesis card, with the premise and
the edges listed. This is the I-5 independence rule
(`docs/TRUTH_SYSTEMS.md` — "corroboration must be independent, not
merely numerous") computed from structure instead of asserted per
verdict. It is a count with a derivation; it never discounts, weights
or re-sorts the edges.

### §3.4 The live badge (verdict-driven, per adjudicator)

When a verdict on a claim's proposition is `established-false`
(`VERDICT_STATES`, `src/shared/truth-taxonomy.js`), every transitive
dependent renders a **"premise adjudicated false"** badge wherever
claims render, linking to the verdict — the same surfacing idiom as
the `contradicts` ⚠ (NIP_DRAFT §30055 "SHOULD surface a warning
indicator on both claims"). The dependent's own verdict is **not**
recomputed, not hidden, not restyled. If B is `established-true` while
its premise A is `established-false`, both chips show side by side and
a third marker names the inconsistency. That tension is a finding; the
surface shows it and resolves nothing.

**The badge is one adjudicator's verdict, never "the" verdict (R-026).**
A verdict is signed by its author and carries its `standard_of_proof`
and `adjudicator` fields (`VerdictModel`,
`src/shared/truth-adjudication-model.js`); the badge carries all three
and reads "premise adjudicated false by <author> under <standard>",
never "premise is false". Two consequences:

- **Many adjudicators, many badges.** When more than one verdict on the
  same premise is in view — the user's own, and any pulled from relays
  by the Network client — the badge shows the **distribution** the
  existing `verdictVariance` computes (counts by state and by standard,
  each with its author list), side by side. One `established-false`
  among three `established-true` renders as exactly that: one marker
  naming its author, beside the three naming theirs. There is no
  majority rule, no "consensus" headline, no threshold at which the
  marker changes shape, and no hiding of a minority verdict. Consensus,
  where it emerges, is visible as a distribution that happens to agree;
  the surface never declares it.
- **Nothing is lost on the way to the badge.** Author, standard of
  proof, the verdict's evidence entries and its supersession chain stay
  one link away from every marker. A marker that could not say *who*
  adjudicated and *by what standard* is a bug.

[INTERPRETATION: reading a kind-30063 state to place a structural
marker on a claim in the case view is a derived view over one family's
published record, not a fusion across families (Art. 6): no number is
produced, no family's output is combined with another's, and the
verdict stays independently retrievable beside the marker. The
hypothesis map's verdict chip (HYPOTHESIS_MAP_DESIGN §8, "show as
context") is the precedent. The maintainer confirmed this reading
2026-11-06 (R-026) with the per-adjudicator condition above.]

## §4. Populating the edges

Three producers, in order of trust, all landing through
`EvidenceLinker.create` with `relationship: 'depends-on'`:

1. **Human-drawn**, in the reader's link modal
   (`src/reader/claim-extractor.js`) and the case view, which already
   offer the Phase-11 four. The modal adds `depends-on` to the picker
   with the §2.1 authoring test as its helper text. `suggested_by:
   'user'`.
2. **LLM-suggested at corpus level.** The reduce tool schema in
   `src/shared/corpus-prompts.js` today emits `load_bearing: [{claim_ref,
   article_hash, quote, why}]`. It gains, per entry, `rests_on:
   [claim_ref…]` — the existing claims the model judges that claim
   presupposes — and the `why` becomes the reason for the dependency.
   Every ref must resolve to a captured claim (the `filterProposals`
   pattern), every quote grounds verbatim, ungrounded entries drop with
   the drop count disclosed, and each surviving edge lands only on a
   human Accept, stamped `suggested_by: 'llm:<model>'`. The prompt
   carries the §2.1 test verbatim and the standing hard rule (no
   verdict, score, or "who is right").
3. **Not at the per-article pass.** Adding premise output to the
   article extract would bump corpus-v9, invalidate every cached
   extract and re-bill every article. Intra-article dependencies are a
   later, separate decision with their own cost line.

## §5. Rendering

- The case view's claim list and the trace expander, as §3. No new
  surface.
- `src/shared/case-graph.js` draws `depends-on` as a **directed** edge
  (arrow from dependent to premise), visually distinct from
  `supports`; a claim under a false premise is hatched, never
  recolored on a scale.
- Copy discipline (the `tests/case-counterfactual.test.mjs` banned
  regex): no line reads "more/less likely", "stronger/weaker",
  "% chance". Permitted shape: "would lose a necessary premise",
  "is undercut", "shares a premise with".
- No progress bars, no per-claim "load" bar compared across claims.
  "7 dependents" is a section size, like the hypothesis map's
  "Supporting evidence (12)" (HYPOTHESIS_MAP_DESIGN §8).

## §6. Red lines (where this must stop)

1. **Propagating truth.** "A is established, therefore B gains
   support" is the inference people most want and the one this design
   refuses. There is no upward mode.
2. **Marking a hypothesis.** A cascade undercuts *claims* and the
   *edges* they stand in. It never writes a state onto a hypothesis,
   never counts how many of a hypothesis's edges survive against
   another hypothesis's (the no-scoreboard rule), and never
   auto-draws the complementary edge on a rival hypothesis.
3. **Recomputing a verdict.** The verdict layer is the only writer of
   verdict state (TRUTH_ADJUDICATION_DESIGN §3.3). A dependent of a
   false premise keeps whatever verdict it has; the badge is a
   marker, not a state.
3a. **Declaring a consensus.** No badge, count or copy ever presents
   several adjudicators' verdicts as one verdict, drops an author or a
   standard of proof, or lets a majority change what a minority marker
   looks like (R-026).
4. **A numeric anywhere without a derivation.** Guard-tested, as CF.1.
5. **Refusing cycles silently.** A cycle is shown, not swallowed.

## §7. Slice ladder (proposed)

| Slice | Content | Wire |
|---|---|---|
| D.0 | This doc, approved + a ROADMAP Phase-26 addendum | — |
| D.1 | `depends-on` in `CLAIM_RELATIONSHIPS` (`src/shared/assessment-taxonomy.js`), builder + parser (`metadata/builders.js`, `evidence-linker.js`), label/icon, NIP_DRAFT §30055 text, wire fixture; tests for id determinism, direction, coexistence with `supports` | **additive** |
| D.2 | Pure cascade + load + shared-premise walks in `case-counterfactual.js` (or a sibling `claim-dependencies.js` if the file would cross its ceiling); cycle detection; derivation guard extended | — |
| D.3 | Render: link-modal picker + authoring test; trace-expander lines; case-list "Load-bearing (n)"; graph arrows; the ⭐ relabel | — |
| D.4 | The live per-adjudicator "premise adjudicated false" badge, the multi-verdict distribution render, the inconsistency marker (R-026) | — |
| D.5 | LLM `rests_on` suggestion through the reduce firewall; both-sides / drop-count disclosure | — |
| — (refused) | Any upward propagation; any hypothesis-level state; any weight on an edge | — |

D.1 is the only slice that touches the wire lane and carries the
`Wire format: additive` callout (ecosystem-pm). Publishing a
`depends-on` link is gated exactly as the other 30055 relationships
are today (`metadata/feature-flags.js`); an older client that does not
know the value sees an unknown relationship. NIP_DRAFT §30055 today
says the value MUST be one of the listed set and gives no consumer
rule for an unknown one, so D.1 adds the sentence "consumers ignore a
relationship event whose value they do not recognize" beside the
widened list. `parseRelationshipEvent` in `evidence-linker.js` passes
the value through unchecked and `create` rejects one it will not
store, so an older X-Ray drops an incoming `depends-on` link at the
store boundary and renders nothing wrong; D.1's tests pin that.

## §8. Decisions recorded (maintainer, 2026-11-06, in conversation)

- **Claim → claim only** (the recommendation): a hypothesis edge
  inherits its claim's premises; one edge type beats two stores.
- **A 30055 value, not a local-only store** (the recommendation): the
  edge rides every existing path — link modal, dossier collector,
  backup, sync, counterfactual — and a dependency is as publishable as
  `supports`. Flag-gated for publish like the rest.
- **The live badge stays (D.4), as one adjudicator's verdict, never a
  consensus** — R-026 (`docs/RULINGS.md`), quoting the maintainer:
  the badge "is helpful, but it is not definitive"; "the goal is to
  know who by what standard a person has adjudicated something and not
  lose that detail"; consensus "is not a foregone conclusion or clean
  and easy process". §3.4 carries the consequences.

Open, for the maintainer at D.3:

- The exact replacement copy for the extract flag's ⭐.

## Related

- [`COUNTERFACTUAL_DESIGN.md`](COUNTERFACTUAL_DESIGN.md) — the one-hop
  structural counterfactual this extends; its §4 red lines and §6
  guard apply unchanged.
- [`HYPOTHESIS_MAP_DESIGN.md`](HYPOTHESIS_MAP_DESIGN.md) — the edges a
  cascade undercuts; its no-scoreboard rule.
- [`NIP_DRAFT.md`](NIP_DRAFT.md) §30055 — the wire home of the new value.
- [`TRUTH_SYSTEMS.md`](TRUTH_SYSTEMS.md) I-5 — independence, which §3.3
  makes structural.
- [`UNIFIED_ARTICLE_PASS_KICKOFF.md`](UNIFIED_ARTICLE_PASS_KICKOFF.md) —
  why the extract's `load_bearing` flag stays as the reduce bound.

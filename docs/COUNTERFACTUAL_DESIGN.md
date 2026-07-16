# Structural counterfactual — "what depends on this claim" (design)

> **Status:** design draft (2026-07-16), **not approved** — written
> overnight for maintainer review (Phase 26 prep). No code exists yet.
> This is the maintainer's "Monte Carlo / if a claim were true or false,
> what happens to the rest" ask, **reframed to clear the epistemic
> firewall** (their explicit decision: *structural, counts not
> probabilities*). Where this and the constitution
> ([`TRUTH_ADJUDICATION_DESIGN.md`](TRUTH_ADJUDICATION_DESIGN.md) §1,
> [`PHILOSOPHY.md`](PHILOSOPHY.md), [`CASE_DOSSIER_DESIGN.md`](CASE_DOSSIER_DESIGN.md)
> §2.2) disagree, the constitution governs.

## §1. The reframing (read this first)

The maintainer asked for a "Monte Carlo" simulator: *if claim X were
true or false, what would it mean for the other arguments and the
entities involved?* A simulator that answers with a **probability**
("X is 73% likely; the case is 60% lab-leak") is the **one shape the
project's constitution was written to exclude** — on this exact case:

> `EPISTACK_ENTRY.md` — "The COVID record's defining fact is that six
> independent Bayesian analyses of the same evidence span **23 orders of
> magnitude**. X-Ray deliberately **does not average, weight, or roll
> up** … the honest headline is the *distribution*."
> `TRUTH_ADJUDICATION §1` — "A proposition is true, false, contested, or
> unresolved — **not '73% true'** … **Quantities are measurements, never
> estimations. Every number shows its derivation from evidence, or it
> does not appear.**"

So this design builds the **structural** counterfactual: given a claim,
report **what in the case graph structurally changes if that claim is
removed or negated** — as **counts that show their derivation**, never
an estimated probability. That is a *measurement* (the constitution's
admissible category), not a *simulation of belief*. It answers "what
depends on this claim" honestly without ever asserting how likely
anything is.

## §2. What it computes

Input: one claim in a case. Substrate: the per-case graph that already
exists — `collectCaseDossierData` → `orbit.claims`, `propositions`,
canonicalized `links.{contradicts, attestations}` (+ the T1.3
`supports`/`updates`/`duplicates` edges), `digestDossier`'s claim
index, and (if the hypothesis map ships) its claim→hypothesis edges.

**Remove the claim** (or **negate** it — flip which side of a
contradiction/support it sits on) and report the *structural delta*, each
line a count with its derivation:

- **Contradiction knots** (`buildKnots` union-find over `contradicts`):
  "removing this claim leaves knot K with one fewer node / **dissolves**
  knot K (it was the only bridge)."
- **Support / attestation:** "M claims lose their only `supports` edge";
  "proposition P loses baseline attestation — `origin_count` drops from
  X to Y (the derivation: these N attestations traced to this origin)."
- **Hypothesis edges** (if the map ships): "hypothesis H loses S of its
  supporting claims / U of its undermining claims" — as neutral counts,
  never a recomputed strength.
- **Entities:** "entities E1, E2 lose their only claim in this case /
  their only claim tying them to entity E3."
- **Timeline / coverage:** "this was the only source dated before
  <event>; removing it empties that world-time band."

Every output is a diff over deterministic graph structure. **No output
is a probability, a likelihood, a confidence, or a fused score.** The
negate variant reports the same structural deltas for the flipped edge
direction — still counts, never "the case is now more likely X."

## §3. Shape (pure, computed-on-read, no wire kind, no LLM)

A pure module — `src/shared/case-counterfactual.js` (proposed) —
`traceClaimDependencies(dossierData, claimRef, { mode: 'remove' |
'negate' })` → a structured delta object of the counts above, each
carrying its `derivation` (the specific edges/claims/attestations that
produced it). Deterministic ⇒ unit-testable against fixture graphs (the
`case-dossier.test.mjs` style). **No LLM** — this is a graph walk, not a
generation; it needs no gate, no key, no grounding. Computed on read,
nothing persisted, no new wire kind (the dossier posture).

Render: a "Trace dependencies" affordance on a claim in the case view
(or its inspector) that expands the structural delta as a plain list
("Removing this claim would: dissolve 1 contradiction knot · leave 2
claims with no support · drop proposition P's attestation origins 3→2").
Optionally a short narrative rendering of the same counts — but the
counts and their derivations are the substance; prose only restates
them.

## §4. The red line this must not cross

The feature is admissible **only** as a structural measurement. It
crosses a red line the instant it:

- emits a **probability / likelihood / confidence** for the claim, the
  case, or an outcome (`TRUTH_ADJUDICATION §1` "never '73% true'");
- produces a **fused case-strength number** or a recomputed hypothesis
  score (`CASE_DOSSIER §2.2` "no case-level score, ever"; the Hypothesis
  Map's no-scoreboard rule);
- **averages** competing analyses into one figure (P8; Red Line #1).

Guards, matching the `CASE_SYNTHESIS §5` discipline:

- the output object's **key set is grep-tested** to contain no
  `probability` / `likelihood` / `confidence` / `score` / `weight`;
- every numeric field is a **count with a `derivation`** array (the
  edges/claims it came from) — a number with no derivation is a bug,
  not a feature;
- copy review: no output string may read as "more/less likely",
  "stronger/weaker case", or "% chance".

If the maintainer later wants the **probabilistic** version (a real
Monte Carlo over analyst-supplied priors, Rootclaim-style), that is a
**separate feature and a separate, constitution-amending decision** —
it would require editing `PHILOSOPHY.md` / `TRUTH_ADJUDICATION §1`
first, and by their own framing (23 orders of magnitude from six honest
Bayesian analyses) the project's answer to date is a deliberate *no*.
This doc flags that fork; it does not take it.

## §5. Non-goals (v1)

No probabilities/likelihoods/confidences anywhere; no fused case or
hypothesis score; no averaging of analyses; no LLM (deterministic graph
walk); no persistence, no wire kind; no claim about *truth* — only about
*structure* ("what connects to what"), leaving the truth judgment to the
verdict layer and the reader.

## §6. Slice ladder (for review — not yet approved)

| Slice | Content |
|---|---|
| CF.0 | This doc, approved + a ROADMAP Phase-26 entry |
| CF.1 | Pure `traceClaimDependencies` over the dossier graph (remove + negate) + derivation-carrying output + tests (incl. the no-numeric-estimate grep guard) |
| CF.2 | "Trace dependencies" affordance on a claim in the case view; plain structural-delta render |
| CF.3 (optional) | A short narrative restatement of the counts (no LLM required; if LLM, it only re-words the counts and is triple-gated) |
| — (refused) | A probabilistic Monte Carlo — separate feature, requires amending the constitution; not planned |

## §7. Open questions for the maintainer

- Does the trace belong **inline in the case view** (a per-claim
  expander) or on a **dedicated surface** (a "dependency explorer")?
- Is the **negate** variant worth building, or is **remove** enough for
  v1? (Negate is more evocative of the "if it were false" ask but adds
  edge-flip semantics.)
- Confirm the hard refusal of the probabilistic version — or, if the
  maintainer wants to reopen it, that is a distinct design + a
  constitution amendment, not part of this doc.

# Opinion modules — kickoff (R5 of the founding-transcript integration)

**Status: APPROVED — all five OQ rulings delivered 2026-08-02; dispositions threaded below. OP.2 in progress.**
**Drafted:** 2026-08-02, from `docs/FOUNDING_TRANSCRIPT.md` (Exchange 1's
opinion rubric) and `docs/PHILOSOPHY.md` §3.2 (normative for this work).

## §1. The gap

PHILOSOPHY §3.2 codifies the opinion dimensions; no code implements
them. Today an opinion piece runs through the eight news modules with
only the R5-interim standing caveat on its face (PR #287). The caveat
is honest; it is not a methodology. §3.2's own sentence is the spec:
*"factual accuracy of premises, logical validity, steel-manning,
explicit separation of fact from interpretation, disclosure of priors
and conflicts, definitional precision, and originality versus
restatement."* Red line 2 governs everything: **the system never
scores an opinion's conclusion.**

## §2. Proposed module set

Six NEW modules plus two REUSED ones. Definitional precision (06) is
in §3.2's list and its methodology is already artifact-type-agnostic;
prediction extraction (08) is unscored and opinion pieces make
predictions — both run unchanged on opinion artifacts.

| # | Module name | The standard (one line; full prompts follow approval) |
|---|---|---|
| op1 | `premise_accuracy` | You don't get to argue from false facts: each load-bearing premise identified, classified (factual / interpretive / predictive), factual ones checked for the same number-hygiene and sourcing discipline news gets. Penalty-only. |
| op2 | `logical_validity` | Formal and informal fallacy detection over the argument's actual structure — premises → moves → conclusion mapped, each move judged. Bidirectional (valid novel structure earns). |
| op3 | `steel_manning` | Did the author engage the strongest version of the opposing position or a strawman? Requires identifying the opposition's best published form. Bidirectional; the credit direction matters (genuine steel-manning is rare and earns). |
| op4 | `fact_interpretation_separation` | Are factual claims and interpretive moves typographically/rhetorically distinguished, or smuggled together? Penalty-only. |
| op5 | `disclosure_transparency` | Priors, conflicts, financial exposures, prior public commitments to this position — disclosed or absent. Credit-bearing (affirmative disclosure earns; §3.2 and the transcript both make this the honesty backbone). |
| op6 | `originality_synthesis` | Novel synthesis versus restatement of circulating talking points. Bidirectional, weighted LOW (see OQ.3) — it is the most judgment-laden dimension and must never dominate. |

Shared envelope unchanged: `module`, `version` (1.0), `score`,
`confidence`, `confidence_notes`, `auditor_caveats`, every finding
evidence-quoted (P3). Same wire kinds — 30056/30057 carry module names
in `d` and `t` already; the new names are additive NIP-draft
vocabulary. `MODULE_NAMES` stays the news set; a parallel
`OPINION_MODULE_NAMES` + `OPINION_PAYLOADS` keeps every existing
consumer untouched (the corpus-v7 lesson: additive, never reshaping).

**Red line 2, machine-checked:** no schema field may carry stance,
agreement, or conclusion judgment; a guard test walks
`OPINION_PAYLOADS` and fails on any field named or enum-valued like
one (`stance`, `agree`, `verdict`, `correct`, `conclusion_*`). A
column the operators find repugnant can earn 90 (§3.2); the schemas
make the opposite structurally inexpressible.

## §3. Dispatch

`source_type === 'analysis'` (declared, else suggested — the R5a
detection, reused) selects the opinion family; the reader's audit
buttons say which family will run before the spend confirm; the media
modal remains the override. The R5a standing caveat retires on the
opinion path the day this ships (it stays for the news-modules-on-
opinion case only if the user forces the news family — OQ.4).

## §4. Aggregation

`OPINION_MODULE_WEIGHTS`, public constants, summing 1.0 across op1–op6
(+ reused 06). The common axis holds: 0–100, "how much should a
rational reader update their beliefs" (§0), so opinion and news
artifacts stay comparable WITHOUT ever being averaged together —
dossiers report the two families as separate rows (the §10.1 no-fusion
discipline applied across families).

Knowability ceiling: the news heuristic reads module 04's sourcing
summary, which opinion runs don't produce. Proposal: derive the
opinion ceiling from `premise_accuracy`'s summary (fraction of
load-bearing premises that are verifiable-in-principle) — same
deterministic-heuristic-binds posture as RQ2, versioned
`heuristic:premise-accuracy/1.0`. (OQ.2.)

## §5. What does NOT change

News modules, their weights, versions, and wire shapes; the firewall
(§3.1 — these findings are craft-under-method, never truth verdicts);
the import firewall (same `importAuditJson` path); the runs ledger
(family recorded implicitly by module names); publish gating
(`epistemicAuditing`).

## §6. Slices (one PR each, sequential — never stacked)

- **OP.1** — this note, ruled on.
- **OP.2** — prompts (vendored under `docs/auditor-prototype/prompts/opinion/`,
  generator map extended) + `OPINION_PAYLOADS` schemas + validators +
  the red-line-2 guard test + weights + ceiling heuristic. No UI.
- **OP.3** — dispatch + reader UI (family-aware buttons, spend confirm,
  caveat retirement) + thorough/quick runners.
- **OP.4** — corpus runner + cross-coverage/known-unknowns joins learn
  the opinion families' payloads.
- **OP.5** — NIP-draft vocabulary + JOURNAL/SMOKE_TEST entries.

## §7. Open questions for the maintainer (OQ)

1. **Module set**: op1–op6 + reused 06/08 as proposed — or fold
   `fact_interpretation_separation` into `premise_accuracy` (both
   interrogate the fact/interpretation boundary) for a leaner five?
2. **Opinion knowability ceiling**: premise-verifiability heuristic as
   proposed, or no ceiling for opinion v1 (cap 100, disclose that the
   ceiling concept is news-only for now)?
3. **Starting weights**: proposal — premise_accuracy 0.25,
   logical_validity 0.20, steel_manning 0.15, fact_interpretation 0.10,
   disclosure 0.15, originality 0.05, definitional_precision (reused)
   0.10. Adjust freely; they're published constants either way.
4. **Forced news-family runs**: when the user overrides an
   opinion-typed artifact to run the NEWS family anyway, keep the R5a
   caveat, or block the mismatch outright?
5. **Asymmetric language on opinion**: §3.2 doesn't list it, but
   op-eds do the "claims vs explains" move constantly. Run module 02
   on opinion too (cheap, methodology unchanged), or keep strictly to
   §3.2's list?

Rulings land here (per the RQ pattern: answers threaded, dispositions
recorded), then OP.2 begins.

## §8. Rulings — 2026-08-02

1. **OQ.1 — "No, keep them separate."** Six modules stand;
   `fact_interpretation_separation` stays its own dimension.
2. **OQ.2 — "Knowability ceiling from premise-verifiability."** The
   deterministic heuristic binds (the RQ2 posture):
   `ceiling = round(50 + 45 × load_bearing_verifiable / load_bearing)`,
   clamped to [40, 95], tagged `heuristic:premise-accuracy/1.0`.
3. **OQ.3 — "Proceed as recommended."** The recommended ratios stand,
   renormalized to admit module 02 (per OQ.5) at 0.10 — *disposition
   note: the approved ratios could not survive unchanged once an
   eighth scored dimension joined; the renormalization preserves their
   ordering and relative spacing.* Final published weights:
   premise_accuracy 0.22 · logical_validity 0.18 · steel_manning 0.14 ·
   disclosure_transparency 0.14 · asymmetric_language 0.10 ·
   fact_interpretation_separation 0.09 · definitional_precision
   (reused) 0.09 · originality_synthesis 0.04 (Σ = 1.00).
4. **OQ.4 — "Try to avoid that mismatch."** Steer, don't block: the
   buttons dispatch by family automatically; forcing the news family
   onto an opinion-typed artifact requires an explicit confirm and
   keeps the R5-interim caveat. No hard block.
5. **OQ.5 — "Asymmetric language counts in opinion too."** Module 02
   joins the opinion family unchanged (same methodology, same version),
   weighted 0.10.

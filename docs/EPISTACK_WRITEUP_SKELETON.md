# Epistack entry — writeup skeleton (rubric-mapped, ≤10 pages)

> **The submission document's structure.** Supersedes
> [`EPISTACK_ENTRY.md`](EPISTACK_ENTRY.md) §5 for the final writeup (that
> doc stays as history + layer-mapping reference). Built to the
> **authoritative** rubric in
> [`docs/epistack/JUDGING_CRITERIA.md`](epistack/JUDGING_CRITERIA.md) and
> the ~10-page cap in [`docs/epistack/README.md`](epistack/README.md)
> (worked examples / knowledge base may be larger but navigable; code
> one-click-runnable). `TBD-run` = filled from the capture run.
>
> **Strategy:** Build-to-Rubric (win plan §3) — a running epistemic stack
> that ends on a signed, graded per-proposition verdict. **The §4.1
> self-cap of the old draft ("does not yet emit a question-level verdict")
> is VOID** — Phase 15 shipped (kinds 30063/30064 on `main`, PR #89); the
> writeup states the verdict layer as delivered, clearly labeled
> single-author descriptive rulings.
>
> **Honest-calibration guardrails (win plan §9.7 — non-negotiable):**
> never call X-Ray's own output "calibrated"; the verdict-state
> *distribution across a case* is "the calibrated view"; the Brier loop is
> disclosed as specified-but-logged-only; the headline COVID verdict is
> "contested / undetermined, capped by withheld data."

## Page budget (keep the body ≤ 10 pages)

| § | Section | ~words | Pages |
|---|---|---|---|
| 1 | Lead + thesis | 350 | 0.5 |
| 2 | The problem the substrate solves | 400 | 0.7 |
| 3 | What we built (the running stack) | 700 | 1.2 |
| 4 | Demonstrated on the cases | 900 | 1.5 |
| 5 | The rubric, mechanism by mechanism | 1200 | 2.0 |
| 6 | The named desiderata, one by one | 700 | 1.2 |
| 7 | Honest limits + what's designed-not-shipped | 500 | 0.8 |
| 8 | Reproduce it yourself | 350 | 0.6 |
| — | **Body total** | **~5100** | **~8.5** |
| A+ | Appendices (baseline, wire format, corpus) | — | unbounded but navigable |

Leaves ~1.5 pages of slack under the cap. Appendices
([baseline comparison](EPISTACK_BASELINE_COMPARISON.md),
[`NIP_DRAFT.md`](NIP_DRAFT.md), the eggs corpus/worksheet) are separate.

## 1. Lead + thesis (§5.6 opener)

**Lead with:** *the format outlives the app — we re-decentralize exactly
what the platforms are abandoning.* ClaimReview is being retired by Google;
C2PA is media-only and its signatures expire; Community Notes decays with a
post id. X-Ray puts claims, evidence, per-source audit, and graded verdicts
into **one open, signed, content-addressed graph on a running protocol
(NOSTR)** — there is no server, so deleting us does not delete the work.

One-paragraph thesis: a **running epistemic stack** (ingest → structure →
assess) whose assessment layer ends on a **signed, graded, per-proposition
verdict anyone can replay, re-audit, or dispute.**

## 2. The problem the substrate solves

Serious investigations die in PDFs and threads: reasoning isn't
inspectable, evidence links rot, the next investigator restarts from zero.
The missing piece is not another analysis but a **substrate on which
analyses compound.** (Reuse `EPISTACK_ENTRY.md` §5.1, tightened.)

## 3. What we built (the running stack)

- **Ingest** — MV3 extension, human-in-the-loop capture; each source a
  signed `30023` content-addressed by SHA-256 `x` hash; paywall/snapshot/
  screenshot evidence hashes.
- **Structure** — thin claims `30040`; typed relations `30055`
  (contradicts / supports / updates); cross-platform identity `32126`.
- **Assess** — 8-module epistemic audit `30056`/`30057` (verbatim-quote
  requirement, score+confidence paired, knowability ceiling, prediction
  ledger `30058`/`30059`); forensic `30062`; **truth verdicts `30063` +
  integrity `30064`** (descriptive state on a declared standard of proof,
  mandatory caveats, two-sided verbatim evidence, no p-tag, kind-1985
  claim mirror).
- **Read** — portal case **dossier**: shape-of-knowledge distribution
  (CD.2), convergence-collapsed evidence (CD.2), four-axis timeline with
  precision bands + gap callouts (CD.3).
- Governance: [`PHILOSOPHY.md`](PHILOSOPHY.md) as the signed public
  constitution bound to the auditor npub.

## 4. Demonstrated on the cases (≥ two, per the rules)

Depth-scoped across the three challenge profiles (win plan §4). `TBD-run`
= the actual verdicts/counts.

- **Eggs (deep spine).** The three-way cohort contradiction; the confident-
  correct **LDL-C → `established-true`** beside the honest **egg→CVD →
  `insufficient-evidence`/`contested`** (the full calibration curve, same
  machine); attestation convergence on the press-release + overlapping-
  cohort clusters. `TBD-run`.
- **COVID (bounded slice).** 2–3 propositions; forensic `30062`; one
  institution-level integrity finding; lands honestly on **"contested /
  undetermined, capped by China's withheld data."** `TBD-run`.
- **LHC (thin slice).** Micro-black-holes → **`established-false`, beyond
  reasonable doubt**; Ord et al. "Probing the Improbable" as an explicit
  out-of-model-error caveat; one resolved datapoint (the collider ran).
  `TBD-run`.

## 5. The rubric, mechanism by mechanism (the spine of the writeup)

One subsection per dimension; each names the **shipped mechanism** and its
**proof surface**, not an aspiration.

| Dimension | Shipped mechanism | Proof |
|---|---|---|
| 1 Epistemic uplift | signed graph vs ungrounded synthesis | [baseline comparison](EPISTACK_BASELINE_COMPARISON.md) |
| 2 Generalizability | same pipeline across 3 case shapes; per-site handlers | the three cases |
| 3 Compounding & shareability | forkable signed verdicts; open wire format | n=2 demo; `NIP_DRAFT.md` |
| 4 Scalability | LLM-assist audits scale with model; relay-replay needs no us | replay demo; audit modes |
| 5 Methodological transparency | `PHILOSOPHY.md` constitution; uncertainty named, not papered | P7/P11 cited |
| 6 Adversarial robustness | content-addressing; no-p-tag; documented gap-cause | tamper demo; §7 firewall |
| 7 Insight contribution | "re-decentralize what platforms abandon"; verdict-attaches-to-proposition | §1 lead; §7 |

## 6. The named desiderata, one by one (§1 of the win plan)

Map each 1:1 (a paragraph each, cite the mechanism):

- provenance with who/what/when/context → `30023` + `32126`.
- calibrate accounting for out-of-model error → LHC "Probing the
  Improbable" caveat; knowability ceiling.
- flag rhetoric over evidence → audit modules (headline fidelity,
  asymmetric language); ScienceDaily "may reduce" finding.
- correlated evidence as independent → `attestationConvergence`.
- reusable artifacts surviving adversarial pressure + handoff → the whole
  signed graph; the demos.

## 7. Honest limits + what's designed-not-shipped

State plainly (dimension 5 rewards this): verdicts are **single-author**
descriptive rulings — cross-author *aggregation* is designed, not shipped
(and deliberately so: no averaging, P8); the Brier loop is
logged-not-activated; capture is interactive (a feature for provenance at
this corpus size); compounding is shown live at **n=2** with the relay-
replay script, with the aggregation/bridging/Sybil layer as a labeled
roadmap. Never overclaim "calibrated."

## 8. Reproduce it yourself (dimension 5 + "run it, not just read it")

Relay URLs + auditor npub + kind-by-kind index (`TBD-run`); load the
unpacked extension (suite green: `TBD-run` count); run the three `demos/`;
re-audit any source against its `x` hash and publish a competing
`30056`/`30063` rendered side by side. Content-addressing makes the
*input* byte-reproducible; LLM-assisted *content* is verified by
signature + provenance, not by re-running.

---

### Fill-in checklist (from the capture run)

- [ ] relay URLs (§11 shortlist, confirmed by the round trip) + auditor npub
- [ ] kind-by-kind event index (counts per kind)
- [ ] eggs: LDL-C + egg→CVD verdicts, convergence numbers, x-hashes
- [ ] COVID: 2–3 verdicts, the one integrity finding
- [ ] LHC: the `established-false` verdict + resolved datapoint
- [ ] final suite/test count; screencast link
- [ ] re-verify competition facts against `docs/epistack/` at submission

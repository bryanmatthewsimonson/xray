# Baseline comparison — X-Ray vs. off-the-shelf deep research

> **Entry appendix** (win plan §5 deliverable 8; judging dimension 1 +
> the judges' note "anchor against good baselines … run it, not just read
> it"). The load-bearing bar is *"meaningfully better than off-the-shelf
> deep research / a careful Claude Code investigation on the same
> sub-question."* This appendix answers it directly: it puts a strong
> baseline answer to the eggs question **beside** what X-Ray's signed
> graph produces, and names exactly what the graph adds that an
> ungrounded synthesis cannot.
>
> **Honest framing (win plan §9.7):** X-Ray's own output is never called
> "calibrated"; the difference is *provenance, tamper-evidence,
> per-source audit, and forkability*, not a better point estimate.
> `TBD-run` marks a figure the capture run fills.

## 1. The baseline (reproduced, not strawmanned)

The sub-question: **"Is egg / dietary-cholesterol consumption bad for
cardiovascular health?"** A careful deep-research or Claude-Code pass on
this today produces something close to the following — and it is genuinely
useful:

> Egg and dietary-cholesterol research is a decades-long back-and-forth.
> Early guidance (and the 1984 *TIME* "cholesterol is bad" era) leaned on
> the diet-heart hypothesis and capped cholesterol at 300 mg/day. Large
> prospective cohorts since then disagree with each other: a 2019 pooled
> analysis of six US cohorts (Zhong et al., *JAMA*) found each half-egg/day
> associated with modestly higher CVD and mortality; a 2020 analysis
> (Drouin-Chartier et al., *BMJ*) found one egg/day not associated with
> CVD; a 0.5-million-adult Chinese cohort (Qin et al., 2018, *Heart*) found
> daily eggs associated with *lower* CVD risk. Meta-analyses split by
> outcome, and the US Dietary Guidelines dropped the explicit 300 mg cap in
> 2015. Mechanistically, controlled-feeding studies do show dietary
> cholesterol raises serum LDL-C, though the population-level CVD signal is
> weak and confounded by overall dietary pattern. **Bottom line: for most
> healthy people, moderate egg consumption (~1/day) is probably fine; the
> evidence on harm is weak and conflicting; individual response varies.**

That is a *good* answer. It is fast, broad, fluent, and roughly correct.
**The bar is to beat it — so the comparison must be about what it cannot
do, not whether it is wrong.**

## 2. What the baseline structurally cannot do

Four gaps are inherent to an ungrounded LLM synthesis, no matter how good
the model:

1. **No provenance you can verify.** The studies are named, but nothing
   binds the answer to the *exact text* of any source. You cannot tell,
   from the answer, which sentence of which paper drove which clause — and
   if a cited page changed tomorrow, the answer would not know.
2. **No per-source scrutiny you can inspect.** "Weak and confounded" is a
   conclusion, not a shown work-item. Which specific headline overstated
   its study? Which press release said "may reduce" over a cohort an
   editorial called "most unlikely"? The synthesis smooths exactly the
   rhetoric-vs-evidence gaps the case is *about*.
3. **Nothing to build on.** The next investigator starts from a fresh
   prompt. There is no artifact to extend, dispute, or re-audit — a second
   opinion overwrites the first instead of standing beside it.
4. **No independence accounting.** "Meta-analyses split" hides that some
   pooled the *same* cohorts, and that a cluster of outlets carried *one*
   press release. Correlated evidence reads as independent corroboration.

## 3. What the signed graph adds (mechanism by mechanism)

Each row is a concrete, shipped mechanism — with the demo or surface that
proves it — set against the baseline gap it closes.

| Baseline gap | X-Ray mechanism | Proof surface | `TBD-run` |
|---|---|---|---|
| No verifiable provenance | Every source is a signed `30023` **content-addressed** to its exact bytes (`x` hash); every claim/audit/verdict binds to that hash | `demos/content-address-tamper.mjs` (edit → binding breaks in the open) | x-hash of each of the ~24 eggs sources |
| No inspectable scrutiny | 8-module epistemic audit per source, **every finding a verbatim quote**; score always paired with confidence; sub-threshold → "needs human review", never a naked number | portal audit dossier; `30056/30057` events | audit bands for the ~10 spine sources |
| Nothing to build on | Verdicts (`30063`) are signed, addressable, **forkable**; a second author's disagreeing verdict renders **side by side, never averaged** | `demos/n2-disagreeing-verdict.mjs`; portal shape-of-knowledge | live n=2 on ≥1 proposition |
| No independence accounting | `attestationConvergence`: "twelve outlets, one wire = one origin"; overlapping cohorts flagged | case-dossier evidence view (CD.2) | origin_count vs independent_count for the press-release + cohort clusters |
| No re-runnable record | The whole graph **replays from public relays with no extension** | `demos/relay-replay.mjs` | relay URLs + auditor npub + kind-by-kind index |
| No per-actor track record | Cross-platform signed identity (`32126`) → per-actor records spanning sites | portal entity record | outlets/authors resolved across sources |

## 4. The sharpened claim (what a judge should take away)

The baseline gives you **an answer**. X-Ray gives you **an answer you can
audit, fork, and replay** — the same graded verdict distribution the
baseline gestures at ("weak and conflicting"), but rendered as a signed,
content-addressed graph where:

- the **confident-correct** sub-fact (dietary cholesterol raises serum
  LDL-C → `established-true`) and the **honestly-uncertain** outcome
  (egg→CVD → `insufficient-evidence` / `contested`, capped by the 2025
  umbrella review's "critically low strength") sit in the *same* machine's
  output — the full calibration curve, not half of it;
- every one of those rulings is welded to the bytes it reviewed, disputable
  by a competing signed verdict, and rebuildable by anyone from the relays.

**It does not claim a better point estimate.** On "should I eat eggs" the
two answers converge — deliberately. The difference is that X-Ray's answer
**survives adversarial pressure, handoff, and time**, and the baseline's
does not. That is the dimension-1 uplift, stated without overclaiming.

## 5. How to reproduce this comparison (for the judge)

1. Read the baseline in §1 (or regenerate it: ask any strong model the §1
   sub-question — you will get materially the same thing).
2. Open the published eggs graph (relay URLs + auditor npub, `TBD-run`) in
   the portal, or replay it with `node demos/relay-replay.mjs <npub>`.
3. Run the three `demos/` scripts — each is self-verifying.
4. Pick any claim in §1 and try to do, with the baseline alone, what the
   graph lets you do: bind it to exact bytes, see its per-source audit,
   attach a disagreeing verdict, or rebuild it without us. That gap is the
   entry.

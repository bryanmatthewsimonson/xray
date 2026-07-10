# Eggs bounded pass — capture worksheet

> Companion to [`EPISTACK_EGGS_CORPUS.md`](EPISTACK_EGGS_CORPUS.md)
> (the full ranked 24-source corpus) and
> [`EPISTACK_RUNBOOK.md`](EPISTACK_RUNBOOK.md) (spine: Jul 12–13).
> The submission's **bounded second case**: 8 core + 2 optional
> sources chosen to yield the corpus doc's contradiction pairs at
> maximum structure-per-hour. Target: ~half a day of browser time.
> All sources are article-shaped HTML (see `CAPTURE_GUIDE.md`
> §"Easy-tier platforms" and §"What to check after capture"); no
> FB/IG/TikTok timing games. One caveat: row 6's Elsevier fulltext
> page is the only source the corpus doc does not class easy-tier —
> if it fights back, capture the abstract and note the paywall (the
> corpus doc's harder-tier procedure).

## Scope decisions (made — don't relitigate mid-run)

- **Quick audits only** (one LLM call per source). Thorough mode is 8
  parallel per-module calls per source — reserve that budget for the
  COVID load-bearing sources. Cost math per source: quick ≈ 1 call
  (article body as input, capped at 120k chars; ≤16k output tokens);
  thorough ≈ 8 calls (same input re-sent per module; ≤8k output each,
  so ~8× the input cost). Set your own dollar cap from current API
  pricing before starting.
- **Proposition targets** (adjudicate only these two — the point is a
  contrast, not coverage). The expectations below are **pre-registered
  falsifiable predictions, not scripts**: they are written before any
  evidence is processed, and **if the run contradicts them, the
  divergence is reported in the writeup as-is** — a wrong prediction
  here is itself a demonstration of the method working. Where natural,
  bank them as `30058` prediction-ledger entries so the
  pre-registration lives on the wire:
  1. *"Dietary cholesterol raises serum LDL-C"* — predicted:
     `established-true` territory on a preponderance standard.
  2. *"Egg consumption increases cardiovascular disease risk"* —
     predicted: `insufficient-evidence` / `contested` (the 2025
     umbrella review reads as the ceiling).
- Capture the **PMC/PubMed mirror** for primary studies (open, stable,
  uniform), the outlet page for journalism (per the corpus doc's
  capture notes).

## The worksheet

Order = capture order (anchor studies first so edges have endpoints).
Columns: **Cap** captured · **Clm** claims atomized · **Lnk** 30055
edges placed · **Aud** quick audit run.

| # | Source (corpus #) | URL | Enables | Cap | Clm | Lnk | Aud |
|---|---|---|---|---|---|---|---|
| 1 | Zhong 2019, JAMA pooled cohorts (1) | pmc.ncbi.nlm.nih.gov/articles/PMC6439941/ | Pair A anchor: eggs BAD; omission/number-hygiene audit target | ☐ | ☐ | ☐ | ☐ |
| 2 | Drouin-Chartier 2020, BMJ (2) | pubmed.ncbi.nlm.nih.gov/32132002/ | Pair A counter: eggs FINE, overlapping methodology | ☐ | ☐ | ☐ | ☐ |
| 3 | Qin 2018, Heart / China Kadoorie (3) | pmc.ncbi.nlm.nih.gov/articles/PMC6241631/ | Pair A third: eggs PROTECTIVE — the three-way contradiction | ☐ | ☐ | ☐ | ☐ |
| 4 | Heart editorial: benefit "most unlikely" (4) | pubmed.ncbi.nlm.nih.gov/30309867/ | Pair B: contradicts #3 in the same journal issue | ☐ | ☐ | ☐ | ☐ |
| 5 | ScienceDaily press release on Qin (19) | sciencedaily.com/releases/2018/05/180521184702.htm | Pair C: headline drift — "may reduce" vs #4's "most unlikely"; textbook fidelity finding | ☐ | ☐ | ☐ | ☐ |
| 6 | 2025 umbrella review (7) | nmcd-journal.com/article/S0939-4753(25)00003-1/fulltext | The knowability ceiling: "critically low strength" caps everything above | ☐ | ☐ | ☐ | ☐ |
| 7 | TIME 1984 "Hold the Eggs and Butter" (13) | time.com/archive/6855517/hold-the-eggs-and-butter/ | Pair D bookend: the "eggs are bad" era | ☐ | ☐ | ☐ | ☐ |
| 8 | TIME 2014 "Eat Butter" cover (14) | time.com/magazine/us/2863200/june-23rd-2014-vol-183-no-24-u-s/ | Pair D bookend: same outlet, opposite cover, 30 years — `updates` edge | ☐ | ☐ | ☐ | ☐ |
| 9* | Harvard coverage of Zhong 2019 (16) | nutritionsource.hsph.harvard.edu/2019/03/18/eggs-and-cholesterol-back-in-the-spotlight-in-new-jama-study/ | Pair F half: fidelity of coverage vs #1's caveats | ☐ | ☐ | ☐ | ☐ |
| 10* | Nestle, Food Politics COI critique (20) | foodpolitics.com/2025/07/industry-funded-study-of-the-week-eggs-2/ | Pair E: the cleanest undisclosed-interest anchor | ☐ | ☐ | ☐ | ☐ |

\* optional — add if under time budget after #1–#8 are fully processed.

## Edges to place (after captures; endpoints by row #)

- **Pair A (three-way):** #1 `contradicts` #2; #2 `contradicts` #3;
  #1 `contradicts` #3.
- **Pair B:** #4 `contradicts` #3 (same journal issue).
- **Pair C:** #5 *overstates* #3 — a fidelity/omission audit finding
  on #5, plus a `supports` edge from #5 to #3's protective claim (the
  drift is the point: support that outruns its source).
- **Pair D:** #8 → `updates` → #7 (the newer piece updates the older —
  same directional convention as the Ceiling edge below; institutional
  reversal, same outlet).
- **Ceiling:** #6 `updates` (caps) the pair-A claims — the honest
  limit on what the corpus can conclude.
- Optional: #9 fidelity vs #1 (pair F half); #10 `contradicts` /
  undisclosed-interest toward industry positions if #12/#24 territory
  comes up in #5's sourcing.

## Per-source loop (≈20–30 min each)

1. Capture (toolbar / Ctrl-Shift-X) → reader opens; check title,
   author, body completeness (`CAPTURE_GUIDE.md` §"What to check
   after capture").
2. Suggest (LLM) → review proposals. This bounded pass **scopes**
   claims to the pre-declared pairs (the full 24-source corpus doc
   remains the unbounded map); accept 3–6 grounded claims per source —
   and keep, don't skip, any claim that complicates the predicted
   picture.
3. Quick audit; skim findings; don't chase every module.
4. Place the edges listed for this row (link UI), tick columns.
5. Publish batch at the end of the pass (runbook §4 does the full
   ordered publish — captures can publish then; no need per-source).

## Done means

All eight core rows fully ticked; the two propositions adjudicated
(expected: one `established-true`, one `insufficient-evidence` /
`contested` — the contrast the writeup cites); pairs A–D placed;
ceiling edge placed. The pass then feeds `EPISTACK_ENTRY.md` §5.3
corpus stats (eggs columns) and the generalizability row of §5.6.

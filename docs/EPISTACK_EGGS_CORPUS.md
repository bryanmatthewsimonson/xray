# Eggs case-study corpus — FLF Epistack competition

> Companion to [`docs/EPISTACK_ENTRY.md`](EPISTACK_ENTRY.md). This is the
> ranked source list to capture with X-Ray for the "health effects of
> eggs / dietary cholesterol" case study. The case was chosen because
> egg-and-cholesterol nutrition science is a decades-long flip-flop with
> **directly contradictory conclusions drawn from overlapping data** —
> ideal for demonstrating `contradicts` / `supports` / `updates` claim
> relationships (30055) and the epistemic-audit modules (headline
> fidelity, number hygiene, source quality, omission).
>
> **All URLs below were verified via web search on 2026-07-02.** Journal
> landing pages (JAMA/BMJ/Circulation) are often paywalled abstracts —
> the PMC/PubMed mirror is given where one exists and is the preferred
> capture target (clean, article-shaped HTML, open access). See
> **§ Capture notes** at the end for the easy-vs-hard tier split.
>
> Target corpus size: ~24 sources. Better 24 verified than 30 padded.
> Rank within each group is most-epistemic-value-first.

## 1. Landmark primary research / meta-analyses

The spine of the case: three cohort/pooled studies that reach **opposite**
conclusions, plus the meta-analyses that try to reconcile them.

1. **Zhong et al. 2019, JAMA — "Associations of Dietary Cholesterol or Egg
   Consumption With Incident Cardiovascular Disease and Mortality"**
   - PubMed: <https://pubmed.ncbi.nlm.nih.gov/30874756/>
   - Open-access full text (PMC): <https://pmc.ncbi.nlm.nih.gov/articles/PMC6439941/>
   - Type: pooled cohort analysis (6 US cohorts, 29,615 adults)
   - Conclusion: **eggs/cholesterol BAD** — each ½ egg/day = +6% CVD, +8%
     all-cause mortality, dose-response.
   - Enables: the anchor of contradiction pair A; a number-hygiene and
     omission target (the "became nonsignificant after adjustment" caveat
     vs the headline).

2. **Drouin-Chartier et al. 2020, BMJ — "Egg consumption and risk of
   cardiovascular disease: three large prospective US cohort studies,
   systematic review, and updated meta-analysis"**
   - PubMed: <https://pubmed.ncbi.nlm.nih.gov/32132002/>
   - Type: 3 US cohorts (215k) + meta-analysis (1.72M participants)
   - Conclusion: **eggs FINE** — one egg/day not associated with CVD.
   - Enables: the counter-anchor of pair A — opposite conclusion, published
     one year later, overlapping US cohort methodology.

3. **Qin et al. 2018, Heart — "Associations of egg consumption with
   cardiovascular disease in a cohort study of 0.5 million Chinese adults"
   (China Kadoorie Biobank)**
   - PubMed: <https://pubmed.ncbi.nlm.nih.gov/29785957/>
   - Open-access full text (PMC): <https://pmc.ncbi.nlm.nih.gov/articles/PMC6241631/>
   - Type: prospective cohort (512,891 Chinese adults)
   - Conclusion: **eggs PROTECTIVE** — daily consumption associated with
     *lower* CVD risk.
   - Enables: a three-way contradiction (bad / fine / protective) from
     three defensible cohorts — the centerpiece of the demo.

4. **Editorial: "Cardiovascular benefit of egg consumption is most
   unlikely" (Heart, 2018)** — the direct rebuttal to Qin.
   - PubMed: <https://pubmed.ncbi.nlm.nih.gov/30309867/>
   - Type: invited editorial / critique
   - Enables: a `contradicts` edge onto source 3 within the *same journal
     issue* — shows adjacent expert disagreement, a source-quality and
     asymmetric-language target.

5. **Circulation 2022 — "Associations of Dietary Cholesterol, Serum
   Cholesterol, and Egg Consumption With Overall and Cause-Specific
   Mortality: Systematic Review and Updated Meta-Analysis"**
   - <https://www.ahajournals.org/doi/10.1161/CIRCULATIONAHA.121.057642>
   - Type: systematic review + meta-analysis
   - Enables: an `updates` edge over the 2019/2020 pair; separates dietary
     from serum cholesterol (a definitional-precision target).

6. **2022 dose-response meta-analysis — "Egg and Dietary Cholesterol
   Intake and Risk of All-Cause, Cardiovascular, and Cancer Mortality"**
   - PMC: <https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9195585/>
   - Type: systematic review + dose-response meta-analysis (55 studies,
     2.77M individuals)
   - Conclusion: +1 egg/day = +7% all-cause, +13% cancer mortality, **no**
     CVD-mortality association — a *split* result.
   - Enables: shows how one study supports "eggs bad" (mortality) and
     "eggs fine" (CVD) simultaneously — a number-hygiene / decontextualization
     showcase.

7. **2025 umbrella review — "Effect of egg consumption on health outcomes:
   an updated umbrella review" (Nutr Metab Cardiovasc Dis)**
   - <https://www.nmcd-journal.com/article/S0939-4753(25)00003-1/fulltext>
   - Type: umbrella review of systematic reviews
   - Conclusion: evidence is of **critically low strength**; no sufficient
     quality to discourage eggs.
   - Enables: the knowability-ceiling / under-claim demonstration — the
     top of the evidence pyramid says "we don't really know."

8. **"Eggs and Cardiovascular Disease Risk: An Update of Recent Evidence"
   (2023, PMC)**
   - <https://pmc.ncbi.nlm.nih.gov/articles/PMC10285014/>
   - Type: narrative review
   - Enables: a secondary-synthesis source to audit for selective citation
     against the primaries above.

## 2. Official dietary guidance over time

The institutional flip-flop — a clean `updates` timeline.

9. **AHA Science Advisory 2019/2020 (Carson et al.) — "Dietary Cholesterol
   and Cardiovascular Risk"**
   - Circulation: <https://www.ahajournals.org/doi/10.1161/CIR.0000000000000743>
   - PubMed: <https://pubmed.ncbi.nlm.nih.gov/31838890/>
   - Enables: the authoritative-body position; "focus on dietary patterns,
     not cholesterol cutoffs."

10. **ACC "Ten Points to Remember" on the AHA advisory (2019)** — a clean,
    capturable digest of source 9.
    - <https://www.acc.org/latest-in-cardiology/ten-points-to-remember/2019/12/30/15/23/dietary-cholesterol-and-cardiovascular-risk>
    - Enables: a `duplicates`/`supports` edge onto source 9; headline-body
      fidelity check (digest vs original).

11. **Dietary Guidelines for Americans 2015–2020 — the dropped 300 mg limit
    (Health Affairs policy brief)**
    - <https://www.healthaffairs.org/do/10.1377/hpb20160331.683121/>
    - Enables: the pivotal `updates` event — "cholesterol is not a nutrient
      of concern for overconsumption." Dates the institutional reversal.

12. **American Egg Board — "The Evolution of Dietary Cholesterol
    Recommendations"** (industry-authored guidance history)
    - <https://www.incredibleegg.org/nutrition/articles/the-evolution-of-dietary-cholesterol-recommendations/>
    - Type: industry position piece
    - Enables: `undisclosed-interest` / source-quality target; a
      `contradicts` or framing edge vs the COI critiques in §4.

## 3. Science journalism spanning the flip-flops

The public-facing narrative — best material for headline-fidelity and
asymmetric-language audits, and a couple of low-quality headlines on purpose.

13. **TIME, 1984 — "Hold the Eggs and Butter"** (the "eggs are bad" era)
    - <https://time.com/archive/6855517/hold-the-eggs-and-butter/>
    - Enables: the historical anchor; a headline-fidelity target (cover
      claim vs the drug-trial evidence it rested on).

14. **TIME, 2014 — "Eat Butter" cover issue** (the reversal, 30 years later)
    - <https://time.com/magazine/us/2863200/june-23rd-2014-vol-183-no-24-u-s/>
    - Enables: the `updates` bookend to source 13 — same outlet, opposite
      cover.

15. **"The Fifty-Year Rehabilitation of the Egg" (2015, PMC)** — a
    peer-reviewed history of the flip-flop itself.
    - <https://pmc.ncbi.nlm.nih.gov/articles/PMC4632449/>
    - Enables: the meta-narrative framing source; a map of the whole
      contradiction timeline in one document.

16. **Harvard Nutrition Source — "Eggs and cholesterol back in the
    spotlight in new JAMA study" (2019)**
    - <https://nutritionsource.hsph.harvard.edu/2019/03/18/eggs-and-cholesterol-back-in-the-spotlight-in-new-jama-study/>
    - Enables: reputable coverage OF source 1 — a fidelity check (how
      faithfully does the coverage carry the caveats?).

17. **Harvard Chan press release — "Moderate egg consumption not associated
    with higher cardiovascular disease risk" (2020)**
    - <https://hsph.harvard.edu/news/moderate-egg-consumption-not-associated-with-higher-cardiovascular-disease-risk/>
    - Enables: coverage OF source 2 by the same institution that covered
      source 1 — institutional narrative-consistency check.

18. **tctmd — "One Egg a Day? No Link to Risk of CVD, Mega-Meta-analysis
    Says" (2020)**
    - <https://www.tctmd.com/news/one-egg-day-no-link-risk-cvd-mega-meta-analysis-says>
    - Enables: a confident-headline example (audit the certainty of the
      headline vs the meta-analysis hedges).

19. **ScienceDaily — "Daily egg consumption may reduce cardiovascular
    disease" (2018 press release)** *(lower-quality / clickbait tier)*
    - <https://www.sciencedaily.com/releases/2018/05/180521184702.htm>
    - Enables: the press-release-vs-study gap — the "may reduce" headline
      on the Qin cohort (source 3), which the editorial (source 4) calls
      "most unlikely." A textbook headline-fidelity + omission finding.

## 4. Conflict-of-interest / critique

Sets up `undisclosed-interest`, source-quality, and omission findings.

20. **Marion Nestle, Food Politics — "Industry-funded study of the week:
    Eggs" (2025)**
    - <https://www.foodpolitics.com/2025/07/industry-funded-study-of-the-week-eggs-2/>
    - Enables: a specific, dated COI critique with a named study — the
      cleanest `undisclosed-interest` anchor.

21. **Marion Nestle, Food Politics — eggs tag (index of COI coverage)**
    - <https://www.foodpolitics.com/tag/eggs/>
    - Enables: a hub of critique posts; secondary anchors.

22. **Wikipedia — American Egg Board** (ENC origin; the 2015 Hampton Creek
    paid-advocacy scandal)
    - <https://en.wikipedia.org/wiki/American_Egg_Board>
    - Enables: the institutional-history / motive-context source; documents
      that the ENC was created to promote favorable research.

23. **NutritionFacts.org — American Egg Board topic page**
    - <https://nutritionfacts.org/topics/american-egg-board/>
    - Enables: a critical-synthesis source (itself auditable for its own
      slant — a symmetry check).

24. **Egg Nutrition Center — Research Grants page** (primary industry
    funding source)
    - <https://www.incredibleegg.org/nutrition/enc-research-grants/>
    - Enables: the primary artifact behind the COI claims — captures the
      funder's own words for a `supports`/`contradicts` edge against §4
      critiques.

## Contradictory pairs (the edges we expect to build)

The demo's payload — explicit 30055 edges, most from *overlapping data or
the same institution*:

- **Pair A (three-way):** source 1 (Zhong, eggs BAD) ⟶ `contradicts` ⟶
  source 2 (Drouin-Chartier, eggs FINE) ⟶ `contradicts` ⟶ source 3 (Qin,
  eggs PROTECTIVE). Three defensible cohorts, opposite verdicts.
- **Pair B (same journal issue):** source 4 (editorial: benefit "most
  unlikely") ⟶ `contradicts` ⟶ source 3 (Qin). Expert disagreement in the
  same publication.
- **Pair C (press-release drift):** source 19 (ScienceDaily "may reduce")
  ⟶ overstates ⟶ source 3 (Qin) — a fidelity/omission finding, not a
  contradiction of fact but of *framing*.
- **Pair D (institutional reversal):** source 13 (TIME 1984) ⟶ `updates` ⟶
  source 14 (TIME 2014); and source 11 (DGA drops the limit) ⟶ `updates` ⟶
  the older 300 mg guidance implied in sources 12/13.
- **Pair E (interest vs critique):** source 12 / source 24 (egg-industry
  guidance & funding) ⟶ `contradicts` / `undisclosed-interest` ⟶ source 20
  (Nestle COI critique).
- **Pair F (same institution, both sides):** source 16 (Harvard covers the
  "bad" JAMA study) vs source 17 (Harvard covers the "fine" BMJ study) —
  a narrative-consistency check on one messenger.
- **Aggregation caveat:** source 7 (2025 umbrella review: "critically low
  strength") ⟶ `updates`/caps ⟶ everything above — the honest ceiling on
  what the whole corpus can conclude.

## Capture notes (easy vs hard tier)

**Easy tier — clean, article-shaped HTML (X-Ray's happy path):**
PubMed abstract pages (1, 2, 3, 4, 9), PMC open-access full text (1, 3, 6,
8, 15), TIME archive pages (13, 14), Harvard pages (16, 17), ScienceDaily
(19), tctmd (18), Food Politics (20, 21), Wikipedia (22), NutritionFacts
(23), ACC digest (10), Health Affairs brief (11), incredibleegg pages
(12, 24).

**Harder tier — paywalled abstract or heavy JS:**
- JAMA (source 1 primary), BMJ (source 2), Circulation (sources 5, 9
  primary), Heart (sources 3, 4 primary) journal landing pages often show
  only a paywalled abstract. **Prefer the PMC/PubMed mirror given above**;
  where none exists (5), capture the abstract and note the paywall — a
  good exercise for the paywall-reconstruction path (`archive-cache.js`).
- The `worldeggorganisation.com` Drouin-Chartier **PDF** exists but PDF
  capture is out of X-Ray's article-shaped tier — use the PubMed page (2).

**Recommendation:** capture the **PubMed/PMC mirror** for every primary
study (open, stable, uniform structure), the outlet page for journalism,
and treat the 2–3 paywalled journal landings as the paywall-reconstruction
demo. That yields the full contradiction graph without fighting paywalls.

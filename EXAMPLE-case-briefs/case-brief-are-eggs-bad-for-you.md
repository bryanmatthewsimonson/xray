# Case brief — Are eggs bad for you?

> **This document is a rendered view, not the record.** It is a local, non-authoritative rendering of a signed NOSTR event corpus. The interrogable artifact is the signed event graph itself — the captures, claims, links, and audits it cites — fetchable and verifiable from the relays below without this file.
>
> **Publishing identity:** `npub1wj9cy7zyhz3jak3krztjqzkfugkk7n57dp3h32uzh6lxpcqw22kszd24dp` · hex `748b827844b8a32eda361897200ac9e22d6f4e9e686378ab82bebe60e00e52ad`
>
> **Relays:** `wss://relay.primal.net`, `wss://relay.nostr.net`, `wss://nos.lol`, `wss://nostr.mom`, `wss://nostr.oxtr.dev`, `wss://offchain.pub`
>
> **Query the corpus:** from any NOSTR client or a raw WebSocket, request events by author — e.g. `["REQ","xray",{"authors":["748b827844b8a32eda361897200ac9e22d6f4e9e686378ab82bebe60e00e52ad"],"kinds":[30023]}]`, one kind per query; the kind vocabulary is documented in X-Ray's NIP draft (`docs/NIP_DRAFT.md`).

*A synthesis of 8 captured sources. Every quote below is verbatim from a captured source — open the linked source to read it in context. Positions cite their sources by number — the full list is under **Sources** at the end. Compiled with [X-Ray](https://github.com/bryanmatthewsimonson/xray); this is a map of the disagreement, **not** a ruling.*

## Summary

The corpus spans roughly four decades of reporting and primary research on whether eggs (and the dietary cholesterol they contain) increase cardiovascular disease (CVD) risk. It includes a 1980s magazine feature on the cholesterol hypothesis (A7), several 2019-2020 JAMA/BMJ/Heart studies and their news write-ups analyzing large US and Chinese cohorts (A1/A3 pooled US cohorts; A2/A6 Chinese Kadoorie Biobank; A4 US cohorts plus meta-analysis), a 2024 randomized crossover trial funded by the Egg Nutrition Center and its favorable news coverage (A5), and a critical commentary on that industry-funded trial (A8). The articles disagree both on the direction of the egg/CVD association (harmful, neutral, or protective) and on how much weight to give industry funding, observational design limitations, and population differences (US/European vs Asian cohorts, diabetic vs non-diabetic subgroups).

## Positions

### Dietary cholesterol and egg consumption are associated with increased CVD/mortality risk (harmful position)

Large pooled analyses of US cohort data show dose-dependent, statistically significant associations between dietary cholesterol/egg intake and higher risk of incident CVD and all-cause mortality, and historical evidence links blood cholesterol lowering to reduced heart attack deaths.

*Held by:* \[[1](https://nutritionsource.hsph.harvard.edu/2019/03/18/eggs-and-cholesterol-back-in-the-spotlight-in-new-jama-study)\], \[[2](https://pmc.ncbi.nlm.nih.gov/articles/PMC6439941)\], \[[3](https://time.com/archive/6855517/hold-the-eggs-and-butter)\]

### Moderate egg consumption is not associated with (or is neutral toward) CVD risk

Updated meta-analyses and large US cohort studies, after adjusting for lifestyle/dietary confounders, find no significant association between moderate egg intake (up to ~1/day) and CVD risk overall, though the picture differs in diabetics and by region.

*Held by:* \[[4](https://pmc.ncbi.nlm.nih.gov/articles/PMC7190072)\]

### Moderate egg consumption is associated with lower CVD risk (protective position)

Large Chinese cohort data (China Kadoorie Biobank) show daily egg consumption up to one egg/day is associated with significantly lower risk of CVD, ischaemic heart disease, haemorrhagic stroke, and CVD death, with plausible biological mechanisms (phospholipids, carotenoids) for benefit.

*Held by:* \[[5](https://pmc.ncbi.nlm.nih.gov/articles/PMC6241631)\], \[[6](https://sciencedaily.com/releases/2018/05/180521184702.htm)\]

### Eggs are not the dietary villain; saturated fat, not egg cholesterol, drives LDL/heart risk

A randomized controlled crossover trial found that even two eggs/day within a low-saturated-fat diet lowered LDL cholesterol, indicating saturated fat—not egg cholesterol—is the true driver of LDL elevation, and long-standing dietary guidelines against eggs lacked strong evidentiary basis.

*Held by:* \[[7](https://refractor.io/diet-nutrition/eggs-health-cholesterol)\]

### Skepticism toward industry-funded pro-egg findings

Even if a study's methods appear sound, funding from the Egg Nutrition Center (American Egg Board) creates a conflict-of-interest concern; claims that funding had 'no role' should raise suspicion, and independently funded replication is needed before accepting eggs are protective.

*Held by:* \[[8](https://www.foodpolitics.com/2025/07/industry-funded-study-of-the-week-eggs-2)\]

## Cruxes of disagreement

### Does higher dietary cholesterol/egg intake causally increase CVD and all-cause mortality risk, or are observed associations attributable to confounding/reverse causation?

- **Harmful/causal-leaning:** Pooled US cohort analyses find statistically significant, dose-dependent associations between dietary cholesterol and egg intake and both incident CVD and all-cause mortality, persisting after multivariable adjustment, and researchers argue these findings should inform dietary guideline updates.
- **Not causal / confounded:** Other analyses note the associations become nonsignificant after adjusting for eggs/red meat consumption jointly, that egg intake correlates with unhealthy behaviors (smoking, low activity) that could confound results, and that the discrepancy between studies may reflect insufficient confounder control (e.g., BMI, red meat) or reverse causation (people changing diet after diagnosis).

> each additional 300 mg of dietary cholesterol consumed per day was significantly associated with higher risk of incident CVD (adjusted hazard ratio \\\[HR\\\], 1.17; adjusted absolute risk difference \\\[ARD\\\], 3.24%)
> — [Associations of Dietary Cholesterol or Egg Consumption With Incident Cardiovascular Disease and Mortality](https://pmc.ncbi.nlm.nih.gov/articles/PMC6439941)

> These associations became nonsignificant after adjustment for consumption of eggs and red meat.
> — [Eggs and cholesterol back in the spotlight in new JAMA study](https://nutritionsource.hsph.harvard.edu/2019/03/18/eggs-and-cholesterol-back-in-the-spotlight-in-new-jama-study)

> the associations between dietary cholesterol consumption and incident CVD (adjusted HR, 1.13 \\\[95% CI, 0.97-1.31\\\]; adjusted ARD, 2.79% \\\[95% CI, −0.76% to 6.34%\\\]) and all-cause mortality (adjusted HR, 1.05 \\\[95% CI, 0.92-1.21\\\]; adjusted ARD, 1.25% \\\[95% CI, −2.65% to 5.15%\\\]) were no longer significant after adjusting for consumption of eggs, unprocessed red meat, and processed meat;
> — [Associations of Dietary Cholesterol or Egg Consumption With Incident Cardiovascular Disease and Mortality](https://pmc.ncbi.nlm.nih.gov/articles/PMC6439941)

> The observed positive associations at such low intakes could be attributable to the lack of simultaneous control for dietary confounders (such as red meat) and body mass index, which could have led to an overestimate of the association.
> — [Egg consumption and risk of cardiovascular disease: three large prospective US cohort studies, systematic review, and updated meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC7190072)

*What would resolve it:* A large, long-duration randomized controlled trial directly manipulating dietary cholesterol/egg intake with hard CVD endpoints, or repeated-measures diet assessment over decades to rule out reverse causation and residual confounding.

### Is moderate egg consumption (up to ~1/day) protective, neutral, or harmful for CVD risk?

- **Protective:** Chinese cohort studies (China Kadoorie Biobank) report daily egg consumers have significantly lower risk of CVD, ischaemic heart disease, haemorrhagic stroke and CVD death compared with non/rare consumers, with proposed protective biological mechanisms.
- **Neutral/no association:** US-focused meta-analyses and cohort studies find no significant association between up-to-one-egg-per-day consumption and CVD risk overall, with any inverse association specific to Asian cohorts and not replicated in US/European cohorts.
- **Harmful:** Pooled US cohort data find each additional half-egg per day significantly associated with higher CVD and all-cause mortality risk.

> Compared with non-consumers, daily egg consumption was associated with lower risk of CVD (HR 0.89, 95% CI 0.87 to 0.92).
> — [Associations of egg consumption with cardiovascular disease in a cohort study of 0.5 million Chinese adults](https://pmc.ncbi.nlm.nih.gov/articles/PMC6241631)

> no association was found between egg consumption and cardiovascular disease risk among US cohorts (1.01, 0.96 to 1.06, I2\\=30.8%) or European cohorts (1.05, 0.92 to 1.19, I2\\=64.7%), but an inverse association was seen in Asian cohorts (0.92, 0.85 to 0.99,
> — [Egg consumption and risk of cardiovascular disease: three large prospective US cohort studies, systematic review, and updated meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC7190072)

> each additional half an egg consumed per day was significantly associated with higher risk of incident CVD (adjusted HR, 1.06; adjusted ARD, 1.11%) and all-cause mortality (adjusted HR, 1.08; adjusted ARD, 1.93%)
> — [Associations of Dietary Cholesterol or Egg Consumption With Incident Cardiovascular Disease and Mortality](https://pmc.ncbi.nlm.nih.gov/articles/PMC6439941)

*What would resolve it:* Harmonized international cohort data with consistent confounder adjustment and stratification by region/ethnicity, or randomized trials across diverse populations to test whether the region-specific inverse association reflects biology, diet pattern, or residual confounding (e.g., socioeconomic/urban-rural status noted in China Kadoorie Biobank).

### Does egg/dietary cholesterol intake matter differently for people with type 2 diabetes?

- **No differential effect:** The Chinese cohort study found egg consumption was not associated with morbidity or mortality of any CVD endpoint among diabetic patients specifically.
- **Differential/harmful in diabetics:** The updated US meta-analysis found that among people with type 2 diabetes, higher egg consumption was associated with a higher risk of cardiovascular disease.

> Further analyses demonstrated that egg consumption was not associated with morbidity and mortality of any CVD endpoint among diabetic patients
> — [Associations of egg consumption with cardiovascular disease in a cohort study of 0.5 million Chinese adults](https://pmc.ncbi.nlm.nih.gov/articles/PMC6241631)

> people with type 2 diabetes only, high egg consumption was associated with a higher risk of cardiovascular disease,
> — [Egg consumption and risk of cardiovascular disease: three large prospective US cohort studies, systematic review, and updated meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC7190072)

*What would resolve it:* Dedicated large-scale studies of diabetic populations across multiple countries with consistent methodology to reconcile the discrepancy, potentially explained by differences in sample size, ethnicity, or confounder control noted in the extracts.

### Is dietary cholesterol from eggs the driver of LDL elevation, or is saturated fat the real culprit?

- **Saturated fat is the driver:** A randomized controlled crossover trial found that eating two eggs/day within a low-saturated-fat diet lowered LDL cholesterol compared to control, while an egg-free but higher-saturated-fat diet did not lower LDL despite far less dietary cholesterol, suggesting saturated fat—not egg cholesterol—is the key driver of LDL levels.
- **Cholesterol-rich foods including eggs directly raise LDL:** Older reporting states that cholesterol-rich foods such as eggs, organ meats, and most cheeses can directly add to the level of potentially harmful LDL, and that blood cholesterol level is directly linked to heart disease, with a major federal drug trial showing that lowering cholesterol reduces fatal heart attacks.

> the real culprit for raising LDL levels appears to be saturated fat, not the cholesterol in eggs as has long been believed
> — [Landmark study flips decades of cholesterol panic aimed at eggs](https://refractor.io/diet-nutrition/eggs-health-cholesterol)

> the egg-free plan saw LDL levels stay roughly the same as the control, even though it was lower much lower in dietary cholesterol
> — [Landmark study flips decades of cholesterol panic aimed at eggs](https://refractor.io/diet-nutrition/eggs-health-cholesterol)

> To begin with, such cholesterol-rich foods as eggs and organ meats and most cheeses can directly add to the level of potentially harmful LDL.
> — [Hold the Eggs and Butter](https://time.com/archive/6855517/hold-the-eggs-and-butter)

> Heart disease is directly linked to the level of cholesterol in the blood.
> — [Hold the Eggs and Butter](https://time.com/archive/6855517/hold-the-eggs-and-butter)

*What would resolve it:* Additional independently funded randomized controlled trials isolating dietary cholesterol from saturated fat across varied populations and longer follow-up with hard clinical endpoints rather than LDL surrogate markers alone.

### Can drug-trial evidence on blood cholesterol lowering (e.g., cholestyramine trials) be validly extrapolated to dietary recommendations about cholesterol/eggs?

- **Extrapolation valid:** Trial proponents (Rifkind, Levy, Glueck) argue the cholesterol-lowering drug trial results 'strongly indicate' that lowering cholesterol and fat in the diet reduces heart disease risk, and quantify expected reductions in heart-attack deaths from population-wide cholesterol lowering.
- **Extrapolation unwarranted:** Critics such as Ahrens argue the study was fundamentally a drug study, not a diet study, and that extrapolating its results to dietary recommendations is 'unwarranted, unscientific and wishful thinking'; other cardiologists (Story) criticize broad universal cholesterol treatment recommendations.

> Basil Rifkind, project director of the study, believes that research “strongly indicates that the more you lower cholesterol and fat in your diet, the more you reduce your risk of heart disease.”
> — [Hold the Eggs and Butter](https://time.com/archive/6855517/hold-the-eggs-and-butter)

> “Since this was basically a drug study, we can conclude nothing about diet; such extrapolation is unwarranted, unscientific and wishful thinking.”
> — [Hold the Eggs and Butter](https://time.com/archive/6855517/hold-the-eggs-and-butter)

> “I have an aversion to this cholesterolphobia,” scoffs Purdue Cardiologist Story. “Why treat everybody? We don’t give everybody insulin out of fear of diabetes.”
> — [Hold the Eggs and Butter](https://time.com/archive/6855517/hold-the-eggs-and-butter)

*What would resolve it:* A dietary (non-drug) randomized controlled trial directly testing whether reducing dietary cholesterol/saturated fat intake, absent pharmacological intervention, reduces heart-attack incidence and mortality.

### Does industry funding of egg research undermine the credibility of favorable findings?

- **Funding disclosure sufficient / no undue influence:** The industry-funded study explicitly states that the Egg Nutrition Center funding source had no role in the design, analysis, interpretation, or writing of the study.
- **Funding creates reasonable doubt:** A critical commentary argues that research shows funding exerts influence whether or not investigators recognize it, that the claim of 'no role' should raise suspicion, and that the egg industry has a motive (declining egg consumption) to fund studies favorable to eggs, warranting independently funded corroborating research before accepting the findings.

> This funding source had no role in the design of this study, and no role in the analysis or interpretation of the data or writing of the manuscript.
> — [Industry-funded study of the week: Eggs](https://www.foodpolitics.com/2025/07/industry-funded-study-of-the-week-eggs-2)

> The claim that the funding source had no role should raise eyebrows.
> — [Industry-funded study of the week: Eggs](https://www.foodpolitics.com/2025/07/industry-funded-study-of-the-week-eggs-2)

> Research shows that funding exerts influence, whether recognized by investigators or not.
> — [Industry-funded study of the week: Eggs](https://www.foodpolitics.com/2025/07/industry-funded-study-of-the-week-eggs-2)

> Egg consumption has declined and the egg industry wants you to eat more of them.
> — [Industry-funded study of the week: Eggs](https://www.foodpolitics.com/2025/07/industry-funded-study-of-the-week-eggs-2)

*What would resolve it:* Independently funded replication studies with no industry ties conducted on comparable populations and diet designs to compare against the industry-funded trial's findings.

### Do the 2015-2020 Dietary Guidelines for Americans contain a contradiction on dietary cholesterol, and if so how should it be resolved?

- **Contradiction exists and matters:** The guidelines contain two seemingly contradictory statements — that cholesterol is 'not a nutrient of concern for overconsumption' yet individuals 'should eat as little dietary cholesterol as possible' — and new pooled cohort findings on cholesterol/egg risk should inform resolution/updating of these guidelines.
- **Findings should not change general guidance:** An expert (Frank Hu) commenting on similar findings states that new results may rekindle debate but would not change general healthy eating guidelines, and low-to-moderate egg intake can remain part of a healthy pattern for generally healthy people.

> (1) “Cholesterol is not a nutrient of concern for overconsumption”; and (2) “Individuals should eat as little dietary cholesterol as possible while consuming a healthy eating pattern.”
> — [Associations of Dietary Cholesterol or Egg Consumption With Incident Cardiovascular Disease and Mortality](https://pmc.ncbi.nlm.nih.gov/articles/PMC6439941)

> These new findings may rekindle the debate about the role of dietary cholesterol and egg consumption in cardiovascular disease, but would not change general healthy eating guidelines that emphasize increasing consumption of fruits, vegetables, whole grains, nuts, and legumes and lowering consumption of red and processed meats and sugar
> — [Eggs and cholesterol back in the spotlight in new JAMA study](https://nutritionsource.hsph.harvard.edu/2019/03/18/eggs-and-cholesterol-back-in-the-spotlight-in-new-jama-study)

*What would resolve it:* An official guideline review process incorporating the newer pooled cohort and RCT evidence to explicitly reconcile or revise the two statements.

## Load-bearing claims

> each additional 300 mg of dietary cholesterol consumed per day was significantly associated with higher risk of incident CVD (adjusted hazard ratio \\\[HR\\\], 1.17; adjusted absolute risk difference \\\[ARD\\\], 3.24%)
> — [Associations of Dietary Cholesterol or Egg Consumption With Incident Cardiovascular Disease and Mortality](https://pmc.ncbi.nlm.nih.gov/articles/PMC6439941)
> *Why it matters:* Central quantitative finding underlying the 'harmful' position and the basis for much subsequent debate about confounding and guideline implications.

> These associations became nonsignificant after adjustment for consumption of eggs and red meat.
> — [Eggs and cholesterol back in the spotlight in new JAMA study](https://nutritionsource.hsph.harvard.edu/2019/03/18/eggs-and-cholesterol-back-in-the-spotlight-in-new-jama-study)
> *Why it matters:* Key piece of evidence used to argue the cholesterol-mortality link may be confounded or mediated rather than independently causal, central to the confounding crux.

> Compared with non-consumers, daily egg consumption was associated with lower risk of CVD (HR 0.89, 95% CI 0.87 to 0.92).
> — [Associations of egg consumption with cardiovascular disease in a cohort study of 0.5 million Chinese adults](https://pmc.ncbi.nlm.nih.gov/articles/PMC6241631)
> *Why it matters:* Primary evidence for the protective position from a large Chinese cohort, directly contradicting the harmful-position findings from US cohorts.

> no association was found between egg consumption and cardiovascular disease risk among US cohorts (1.01, 0.96 to 1.06, I2\\=30.8%) or European cohorts (1.05, 0.92 to 1.19, I2\\=64.7%), but an inverse association was seen in Asian cohorts (0.92, 0.85 to 0.99,
> — [Egg consumption and risk of cardiovascular disease: three large prospective US cohort studies, systematic review, and updated meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC7190072)
> *Why it matters:* Load-bearing for the region-specific crux, showing the same body of evidence supports different conclusions depending on population studied.

> the real culprit for raising LDL levels appears to be saturated fat, not the cholesterol in eggs as has long been believed
> — [Landmark study flips decades of cholesterol panic aimed at eggs](https://refractor.io/diet-nutrition/eggs-health-cholesterol)
> *Why it matters:* Central mechanistic claim reframing the entire eggs-cholesterol debate around saturated fat rather than dietary cholesterol per se.

> This, alas, is an industry-funded study conducted by investigators funded by the egg industry.
> — [Industry-funded study of the week: Eggs](https://www.foodpolitics.com/2025/07/industry-funded-study-of-the-week-eggs-2)
> *Why it matters:* Load-bearing for the funding-skepticism crux and the case's broader question of how to weigh industry-sponsored favorable findings.

> Since this was basically a drug study, we can conclude nothing about diet; such extrapolation is unwarranted, unscientific and wishful thinking.
> — [Hold the Eggs and Butter](https://time.com/archive/6855517/hold-the-eggs-and-butter)
> *Why it matters:* Foundational historical dissent that frames the long-running methodological question of extrapolating cholesterol-lowering drug trial results to dietary/egg recommendations.

## Coverage gaps

- No article in the corpus reports a long-duration randomized controlled trial with hard CVD morbidity/mortality endpoints (as opposed to LDL surrogate markers or observational cohorts) directly testing egg or dietary cholesterol intake.
- No extract addresses mechanisms or outcomes for populations outside the US, Europe, and China (e.g., Africa, South Asia, Latin America), leaving the region-specific inverse-association finding unexplored elsewhere.
- No article discusses egg consumption's relationship to other health outcomes beyond CVD/stroke/mortality (e.g., cancer, cognitive decline, diabetes onset itself rather than as a subgroup).
- No source provides a systematic, independently funded replication of the 2024 Egg Nutrition Center-funded RCT (A5), which A8 explicitly calls for but which is not present in this corpus.
- No extract details specific current (post-2020) official dietary guideline text or any formal guideline revision process responding to the newer pooled-cohort or RCT findings.
- No article presents a patient-level or clinical-guideline perspective on individualized risk (e.g., genetic variation in cholesterol response, discussed briefly in A7 but not connected to the newer studies).
- No extract provides detail on the specific socioeconomic/urban-rural confounding structure hypothesized in A4 to explain the China Kadoorie Biobank association, leaving that mechanism unverified within the corpus.

## Sources

1. [Eggs and cholesterol back in the spotlight in new JAMA study](https://nutritionsource.hsph.harvard.edu/2019/03/18/eggs-and-cholesterol-back-in-the-spotlight-in-new-jama-study) — nutritionsource.hsph.harvard.edu · 2019-03-18
2. [Associations of Dietary Cholesterol or Egg Consumption With Incident Cardiovascular Disease and Mortality](https://pmc.ncbi.nlm.nih.gov/articles/PMC6439941) — pmc.ncbi.nlm.nih.gov
3. [Hold the Eggs and Butter](https://time.com/archive/6855517/hold-the-eggs-and-butter) — time.com · 1984-03-26
4. [Egg consumption and risk of cardiovascular disease: three large prospective US cohort studies, systematic review, and updated meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC7190072) — pmc.ncbi.nlm.nih.gov
5. [Associations of egg consumption with cardiovascular disease in a cohort study of 0.5 million Chinese adults](https://pmc.ncbi.nlm.nih.gov/articles/PMC6241631) — pmc.ncbi.nlm.nih.gov
6. [Daily egg consumption may reduce cardiovascular disease](https://sciencedaily.com/releases/2018/05/180521184702.htm) — sciencedaily.com
7. [Landmark study flips decades of cholesterol panic aimed at eggs](https://refractor.io/diet-nutrition/eggs-health-cholesterol) — refractor.io · 2025-07-21
8. [Industry-funded study of the week: Eggs](https://www.foodpolitics.com/2025/07/industry-funded-study-of-the-week-eggs-2) — foodpolitics.com · 2025-07-28

## Appendix — entity index

*Claim counts are provenance and navigation aids — how many captured claims in this corpus mention each entity. They are not weight, importance, or credibility.*

### People

- **Jon Buckley** — 4 claims · in 1 source: \[[7](https://refractor.io/diet-nutrition/eggs-health-cholesterol)\]
- **Canqing Yu** — 2 claims · in 1 source: \[[6](https://sciencedaily.com/releases/2018/05/180521184702.htm)\]
- **Edward Ahrens** — 2 claims · in 1 source: \[[3](https://time.com/archive/6855517/hold-the-eggs-and-butter)\]
- **Frank Hu** — 2 claims · in 1 source: \[[1](https://nutritionsource.hsph.harvard.edu/2019/03/18/eggs-and-cholesterol-back-in-the-spotlight-in-new-jama-study)\]
- **Liming Li** — 2 claims · in 1 source: \[[6](https://sciencedaily.com/releases/2018/05/180521184702.htm)\]
- **Ancel Keys** — 1 claim · in 1 source: \[[3](https://time.com/archive/6855517/hold-the-eggs-and-butter)\]
- **Basil Rifkind** — 1 claim · in 1 source: \[[3](https://time.com/archive/6855517/hold-the-eggs-and-butter)\]
- **Charles Glueck** — 1 claim · in 1 source: \[[3](https://time.com/archive/6855517/hold-the-eggs-and-butter)\]
- **Florine Belanger** — 1 claim · in 1 source: \[[3](https://time.com/archive/6855517/hold-the-eggs-and-butter)\]
- **Jan Breslow** — 1 claim · in 1 source: \[[3](https://time.com/archive/6855517/hold-the-eggs-and-butter)\]
- **Jon Story** — 1 claim · in 1 source: \[[3](https://time.com/archive/6855517/hold-the-eggs-and-butter)\]
- **Richard Havel** — 1 claim · in 1 source: \[[3](https://time.com/archive/6855517/hold-the-eggs-and-butter)\]
- **Robert Levy** — 1 claim · in 1 source: \[[3](https://time.com/archive/6855517/hold-the-eggs-and-butter)\]
- **Stephen Hulley** — 1 claim · in 1 source: \[[3](https://time.com/archive/6855517/hold-the-eggs-and-butter)\]

### Organizations

- **American Heart Association** — 3 claims · in 2 sources: \[[3](https://time.com/archive/6855517/hold-the-eggs-and-butter)\], \[[7](https://refractor.io/diet-nutrition/eggs-health-cholesterol)\]
- **National Heart, Lung and Blood Institute** — 3 claims · in 1 source: \[[3](https://time.com/archive/6855517/hold-the-eggs-and-butter)\]
- **American Egg Board** — 1 claim · in 2 sources: \[[3](https://time.com/archive/6855517/hold-the-eggs-and-butter)\], \[[8](https://www.foodpolitics.com/2025/07/industry-funded-study-of-the-week-eggs-2)\]
- **Monash University** — 1 claim · in 1 source: \[[7](https://refractor.io/diet-nutrition/eggs-health-cholesterol)\]

---

*Compiled from 8 sources with [X-Ray](https://github.com/bryanmatthewsimonson/xray). No single number stands in for the case — X-Ray maps disagreement and grounds every quote; it does not rank or rule.*

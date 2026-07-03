# Eggs capture-run worksheet — FLF Epistack sprint

> **Operational companion** to [`EPISTACK_EGGS_CORPUS.md`](EPISTACK_EGGS_CORPUS.md)
> (the ranked source list) and [`EPISTACK_WIN_PLAN.md`](EPISTACK_WIN_PLAN.md)
> §4 (eggs = the deep spine). This is the **checklist the human works
> through in the browser** with the extension loaded, under the Epistack
> identity, ~Jul 4–8. Slice 2 of the sprint queue
> ([`EPISTACK_SPRINT_KICKOFF.md`](EPISTACK_SPRINT_KICKOFF.md)).
>
> Every source below is **easy-tier, article-shaped** (Readability's
> happy path) — no Facebook/Instagram/TikTok finickiness applies here,
> so [`CAPTURE_GUIDE.md`](CAPTURE_GUIDE.md)'s per-platform timing notes
> are mostly moot. The only hard sources are 2–3 paywalled journal
> landings, which are the **paywall-reconstruction demo** (§6).

---

## 1. How to use this worksheet

Work **wave by wave** (§3). Each wave is self-contained: finishing Wave 1
alone already yields a shippable mini-demo (the three-way contradiction +
the honest ceiling), so a partial run is never a wasted run. Per source,
run this loop and tick the four columns:

1. **Capture** — open the URL, trigger X-Ray (toolbar icon or
   `Ctrl/Cmd+Shift+X`). Then do the [CAPTURE_GUIDE "what to check after
   capture"](CAPTURE_GUIDE.md) glance: provenance chip should read
   `dom-scrape` or better (these are article pages, so expect a clean
   Readability body), the screenshot evidence panel shows the right
   page, and the Markdown tab carries the abstract/body. → tick
   **captured**.
2. **Claims** — atomize the source's load-bearing claims (LLM Suggest +
   human review), each anchored to a verbatim quote. The "role in the
   demo" column names what to look for. → tick **claims**.
3. **Audit** — run the epistemic audit (quick pass for all; **thorough
   (Opus-class) only on the load-bearing spine**, marked ★ — the
   ~$100 LLM budget buys a handful of thorough audits, win plan §9.4).
   → tick **audit**.
4. **Attested** — where the source participates in an
   attestation-convergence cluster (§5), record its origin so
   "twelve outlets, one press release" collapses correctly. → tick
   **attested** (only the sources named in §5 need this).

Then build the **edges** (§4) once both endpoints of a pair are captured,
and drive toward the two **proposition verdicts** (§2).

> **Keyless SMOKE note.** The capture/claims/audit loop is the pending
> SMOKE §11–§13 walk; the first real `30063` publish under the Epistack
> identity is the SMOKE §Phase 15 round trip (win plan §11) and the
> public-relay kind-acceptance test. Run at least Wave 1 before cutting
> v0.7.0.

---

## 2. Proposition targets (what the verdicts are driving to)

The eggs case must show the **full calibration curve** — one confident
verdict and one honestly-uncertain one, from the *same machine* (win
plan §3 fix 2, §4).

| Proposition | Target verdict | Standard | Fed by | Why |
|---|---|---|---|---|
| **Egg / dietary-cholesterol consumption changes CVD risk** | `insufficient-evidence` / `contested` | preponderance | corpus 1–8 (esp. the 7 umbrella review) | the honest-uncertain outcome: three defensible cohorts reach opposite conclusions; the top of the pyramid (7) rates the whole body "critically low strength" |
| **Dietary cholesterol raises serum LDL-C** | `established-true` | clear-and-convincing / beyond-reasonable-doubt | ⚠ **see gap below** | the confident-correct insurance verdict — mechanistic, RCT-backed, not in genuine dispute |

### ⚠ Open item — the LDL-C source gap (must resolve before the LDL-C verdict)

The corpus as written is **egg → CVD-outcome** focused. It does **not**
currently contain a source establishing the narrower, confident
sub-fact the win plan (§4, §5.2) leans on: **controlled-feeding /
metabolic-ward RCT evidence that dietary cholesterol raises serum
LDL-C.** That verdict is the entry's confident-correct half — without a
source it cannot be honestly rendered as `established-true`.

**Two ways to close it (pick before the LDL-C verdict; do not fabricate a
citation):**

- **Preferred — add 1–2 controlled-feeding sources to the corpus.** The
  source *type* to capture: a systematic review / meta-analysis of
  randomized controlled dietary-cholesterol feeding trials reporting the
  serum-LDL-C response (the metabolic-ward literature, e.g. the
  Hegsted/Keys-equation lineage and its modern RCT meta-analyses). **Find
  and verify a live open-access URL** (PMC preferred) the way the corpus
  did for every other source, then slot it in as corpus source 25/26 and
  add worksheet rows. Do **not** reuse a URL from memory unchecked.
- **Fallback — scope the verdict to the corpus.** Several primaries
  (esp. 5, which "separates dietary from serum cholesterol" — a
  definitional-precision target) discuss the LDL-C mechanism in their
  background. If no dedicated source is added, narrow the confident
  verdict to what the captured corpus actually supports and say so in
  the caveat, or move the confident-correct showcase to the LHC case
  (win plan §4 names eggs-LDL-C as the LHC insurance, and vice-versa —
  they back each other up).

Flagging this now so it is a deliberate decision, not a silent gap the
judges find.

---

## 3. Ordered capture waves (checklist)

Source numbers are the **corpus** numbers (`EPISTACK_EGGS_CORPUS.md`) —
not renumbered here, so cross-reference stays clean. ★ = run a
**thorough** audit (spine); others get the quick pass. URLs: prefer the
PMC/PubMed mirror for primaries (open, stable, uniform).

### Wave 1 — the contradiction spine (capture first; a shippable core on its own)

| # | Source (short) | Preferred URL | ★ | captured | claims | audit | attested |
|---|---|---|---|---|---|---|---|
| 1 | Zhong 2019 JAMA — eggs **BAD** (pooled US cohorts) | PMC6439941 | ★ | [ ] | [ ] | [ ] | [ ] |
| 2 | Drouin-Chartier 2020 BMJ — eggs **FINE** | pubmed 32132002 | ★ | [ ] | [ ] | [ ] | [ ] |
| 3 | Qin 2018 Heart — eggs **PROTECTIVE** (China Kadoorie) | PMC6241631 | ★ | [ ] | [ ] | [ ] | [ ] |
| 4 | Heart 2018 editorial — benefit "most unlikely" | pubmed 30309867 | ★ | [ ] | [ ] | [ ] | [ ] |
| 7 | 2025 umbrella review — "critically low strength" (the ceiling) | nmcd-journal S0939-4753(25)00003-1 | ★ | [ ] | [ ] | [ ] | [ ] |

### Wave 2 — the institutional flip-flop timeline (`updates` edges)

| # | Source (short) | Preferred URL | ★ | captured | claims | audit | attested |
|---|---|---|---|---|---|---|---|
| 11 | DGA 2015–2020 drops the 300 mg limit (Health Affairs brief) | healthaffairs hpb20160331.683121 | | [ ] | [ ] | [ ] | [ ] |
| 9 | AHA Science Advisory 2019/2020 (Carson et al.) | ahajournals CIR.0000000000000743 | | [ ] | [ ] | [ ] | [ ] |
| 10 | ACC "Ten Points to Remember" digest of 9 | acc.org 2019/12/30 ten-points | | [ ] | [ ] | [ ] | [ ] |
| 13 | TIME 1984 — "Hold the Eggs and Butter" | time.com/archive/6855517 | | [ ] | [ ] | [ ] | [ ] |
| 14 | TIME 2014 — "Eat Butter" cover | time.com/magazine 2863200 | | [ ] | [ ] | [ ] | [ ] |

### Wave 3 — press-release drift + narrative-consistency (convergence targets)

| # | Source (short) | Preferred URL | ★ | captured | claims | audit | attested |
|---|---|---|---|---|---|---|---|
| 19 | ScienceDaily "may reduce" over Qin (clickbait tier) | sciencedaily 2018/05/180521184702 | ★ | [ ] | [ ] | [ ] | [ ] |
| 16 | Harvard covers the "bad" JAMA study (2019) | nutritionsource.hsph 2019/03/18 | | [ ] | [ ] | [ ] | [ ] |
| 17 | Harvard covers the "fine" BMJ study (2020) | hsph.harvard.edu/news moderate-egg-consumption | | [ ] | [ ] | [ ] | [ ] |
| 18 | tctmd "One Egg a Day? No Link" (confident headline) | tctmd.com/news one-egg-day | | [ ] | [ ] | [ ] | [ ] |

### Wave 4 — conflict-of-interest / critique (`undisclosed-interest` edges)

| # | Source (short) | Preferred URL | ★ | captured | claims | audit | attested |
|---|---|---|---|---|---|---|---|
| 20 | Marion Nestle — "Industry-funded study of the week: Eggs" (2025) | foodpolitics 2025/07 | ★ | [ ] | [ ] | [ ] | [ ] |
| 12 | American Egg Board — "Evolution of Dietary Cholesterol Recommendations" (industry) | incredibleegg evolution-of-dietary-cholesterol | | [ ] | [ ] | [ ] | [ ] |
| 24 | Egg Nutrition Center — Research Grants (funder's own words) | incredibleegg enc-research-grants | | [ ] | [ ] | [ ] | [ ] |
| 22 | Wikipedia — American Egg Board (Hampton Creek scandal) | en.wikipedia American_Egg_Board | | [ ] | [ ] | [ ] | [ ] |
| 23 | NutritionFacts.org — American Egg Board topic | nutritionfacts topics/american-egg-board | | [ ] | [ ] | [ ] | [ ] |

### Wave 5 — synthesis / support (depth; capture if ahead of the ~Jul 8 milestone)

| # | Source (short) | Preferred URL | ★ | captured | claims | audit | attested |
|---|---|---|---|---|---|---|---|
| 5 | Circulation 2022 SR+MA — dietary vs serum cholesterol | ahajournals CIRCULATIONAHA.121.057642 | | [ ] | [ ] | [ ] | [ ] |
| 6 | 2022 dose-response MA — split result (mortality vs CVD) | PMC9195585 | | [ ] | [ ] | [ ] | [ ] |
| 8 | 2023 narrative review — selective-citation target | PMC10285014 | | [ ] | [ ] | [ ] | [ ] |
| 15 | "The Fifty-Year Rehabilitation of the Egg" (2015) — meta-narrative | PMC4632449 | | [ ] | [ ] | [ ] | [ ] |
| 21 | Marion Nestle — eggs tag (COI index) | foodpolitics tag/eggs | | [ ] | [ ] | [ ] | [ ] |

> Full URLs live in `EPISTACK_EGGS_CORPUS.md` beside each numbered
> source; the short forms above are enough to find the row.

---

## 4. Edges to build (30055 relationships)

Build each once **both** endpoints are captured (all reproduced from the
corpus's "Contradictory pairs" section — the demo payload):

- **Pair A (three-way):** `1` —`contradicts`→ `2` —`contradicts`→ `3`
  (eggs bad / fine / protective; three defensible cohorts).
- **Pair B (same journal issue):** `4` —`contradicts`→ `3` (editorial vs
  Qin, adjacent expert disagreement).
- **Pair C (press-release drift):** `19` —overstates→ `3` (framing, not
  fact — a fidelity/omission finding).
- **Pair D (institutional reversal):** `13` —`updates`→ `14`; `11`
  —`updates`→ the older 300 mg guidance implied in `12`/`13`.
- **Pair E (interest vs critique):** `12`/`24` —`contradicts` /
  `undisclosed-interest`→ `20`.
- **Pair F (same institution, both sides):** `16` vs `17` — one messenger
  (Harvard), opposite studies; narrative-consistency check.
- **Aggregation caveat:** `7` —`updates`/caps→ everything above — the
  honest ceiling on what the corpus can conclude (feeds the egg→CVD
  `insufficient-evidence` verdict, §2).

---

## 5. Attestation-convergence targets (tick "attested" on these)

The independence measurement (`truth-attestation.js`
`attestationConvergence`) needs origin keys so correlated coverage
collapses to one source. Record origins for:

1. **Press-release cluster around Qin (source 3):** `19` (ScienceDaily
   "may reduce") — and any other outlet echoing the same
   press release — collapse to the **one** Qin-study origin. "Many
   outlets → one wire."
2. **Overlapping US-cohort methodology (Pair A):** `1` and `2` draw on
   overlapping US cohorts — flag the shared-data dependence so two
   "independent" studies are not counted as two independent signals.
3. **One-messenger consistency (Harvard):** `16` and `17` are the **same
   institution** covering opposite studies — one origin, two framings.

---

## 6. Paywall-reconstruction demo (the only hard sources)

Most primaries have an open PMC/PubMed mirror (used above). The
deliberate paywall-reconstruction exercises
(`archive-cache.js` path, CAPTURE_GUIDE §paywall):

- **Source 5** (Circulation 2022) — no open mirror; capture the abstract
  and note the paywall.
- **Source 1 / 2 / 3 primaries** (JAMA / BMJ / Heart landing pages) —
  optional: capture the paywalled journal landing *in addition to* the
  PMC mirror, to demonstrate reconstruction against a known-good
  open copy.

Capture the mirror first (it is the clean claim target); treat the
paywalled landing as the reconstruction showcase, not the primary
evidence.

---

## 7. Definition of done (eggs spine)

- **Milestone (~Jul 8, win plan §6):** Waves 1–2 fully captured, claims
  atomized, spine (★) sources thorough-audited, Pairs A/B/D built, and
  **both proposition verdicts authored** (egg→CVD
  `insufficient-evidence`; LDL-C `established-true` once the §2 gap is
  closed). This alone is a complete, submittable eggs entry.
- **Full eggs spine:** Waves 3–4 captured, Pairs C/E/F built, the three
  §5 convergence clusters recorded, at least one paywall-reconstruction
  (§6) demonstrated.
- **Upside (only if ahead):** Wave 5 depth sources.
- Publish is the human SMOKE §Phase 15 round trip to the §11 relays;
  the bundled raw signed-event JSON is the durability guarantee.

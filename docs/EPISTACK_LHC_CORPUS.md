# LHC black-hole-risk corpus — FLF Epistack competition

> Companion to [`docs/EPISTACK_ENTRY.md`](EPISTACK_ENTRY.md). This is the
> ranked source list to capture with X-Ray for the "Does the Large Hadron
> Collider risk creating Earth-destroying black holes?" case study. The
> case was chosen because it demonstrates the evidence shape the entry
> names as its acknowledged gap: a **confident mainstream answer resting
> on complex technical evidence**, challenged by a small set of named
> dissenters, amplified by doomsday media coverage, tested in court, and
> bookended by "we didn't die" retrospectives. Unlike COVID (live
> controversy) or eggs (flip-flop), the argument structure here is a
> spine of safety-case claims with dissent → rebuttal → legal → media
> branches hanging off it.
>
> **All URLs below were verified via web search on 2026-07-19.** Method
> note, stated honestly: the verification environment's outbound fetch is
> policy-restricted, so verification = the exact URL appearing
> live-indexed in search results with matching title and content (the
> same "verified via web search" method the eggs corpus used). Two
> robots-blocked outlets (nytimes.com, bbc.co.uk) could not be verified
> at all and were **replaced with verifiable equivalents** (noted in
> § Capture notes); the original tabloid doomsday pages (The Sun, Daily
> Mail, 2008) have link-rotted and are represented secondhand — itself an
> exhibit for the case. Any URL that fails at capture time should be
> dropped, not worked around.
>
> Target corpus size: ~19 numbered sources (24 URLs incl. mirrors).
> Better 19 verified than 25 padded. Rank within each group is
> most-epistemic-value-first.

## 1. The safety case (primary)

The confident mainstream answer and the technical evidence it rests on —
three generations of official analysis plus one independent expert
endorsement.

1. **CERN — "The Safety of the LHC"** (the official public reassurance
   page)
   - Current page: <https://home.web.cern.ch/science/accelerators/large-hadron-collider/safety-lhc>
   - 2008-era version (CERN public archive): <https://public-archive.web.cern.ch/en/LHC/Safety-en.html>
   - Type: institutional FAQ / position statement
   - Position: **LHC is safe** — microscopic black holes would decay
     instantly; even hypothetical stable ones are ruled out by the
     cosmic-ray argument (Earth and Sun still exist).
   - Enables: the institutional-anchor claim node; an `updates` edge
     between the archived 2008 wording and the current page (how the
     claim's phrasing evolved after the fact); a definitional-precision
     target ("safe" = "no conceivable threat" — what standard of proof
     is that?).

2. **LSAG 2008 — "Review of the Safety of LHC Collisions"** (Ellis,
   Giudice, Mangano, Tkachev, Wiedemann; J. Phys. G 35, 115004)
   - arXiv abs: <https://arxiv.org/abs/0806.3414>
   - Type: official safety review (the LHC Safety Assessment Group)
   - Conclusion: **no conceivable danger** — confirms, updates and
     extends the 2003 study; the cosmic-ray comparison is the load-bearing
     argument.
   - Enables: the central safety-case node — the anchor that Plaga
     (source 6) `contradicts`, Ord et al. (source 16) critique/`updates`,
     and the CERN page (source 1) popularizes; an `updates` edge onto
     the 2003 study (source 4).

3. **Giddings & Mangano 2008 — "Astrophysical implications of
   hypothetical stable TeV-scale black holes"** (Phys. Rev. D 78, 035009)
   - arXiv abs: <https://arxiv.org/abs/0806.3381>
   - Type: primary technical analysis (the deep evidence under LSAG)
   - Conclusion: even granting the worst hypotheticals (stable black
     holes, trapped in Earth), white-dwarf/neutron-star survival bounds
     show **no risk of any significance whatsoever**.
   - Enables: a `supports` edge under source 2 (the calculation the
     review rests on); the direct target of Plaga's dissent; shows the
     "complex technical evidence" shape — a lay reader cannot check it,
     which is exactly Ord et al.'s point.

4. **LHC Safety Study Group 2003 — "Study of potentially dangerous
   events during heavy-ion collisions at the LHC"** (Blaizot et al.,
   CERN-2003-001)
   - CERN Document Server record: <https://cds.cern.ch/record/613175>
   - Type: the earlier official safety study
   - Conclusion: "no basis for any conceivable threat" (strangelets,
     black holes, monopoles).
   - Enables: the superseded node — source 2 explicitly `updates` it;
     an omission/limitation target (the 2003 analysis leaned more on
     Hawking-radiation assumptions that the 2008 pair deliberately
     dropped — the safety case itself moved).

5. **APS Physics Viewpoint — "The end of the world at the Large Hadron
   Collider?"** (Physics 1, 14, 2008)
   - <https://physics.aps.org/articles/v1/14>
   - Type: independent expert commentary published alongside the PRD
     paper (source 3)
   - Position: endorses the Giddings–Mangano analysis as convincing.
   - Enables: a `supports` edge from outside CERN — tests whether the
     "mainstream consensus" is only self-attestation; source-quality
     contrast against the blog/tabloid tier.

## 2. The dissent (and its rebuttal)

A genuinely small set — two named dissenters with different mechanisms,
and the direct arXiv-level rebuttal exchange.

6. **Plaga 2008 — "On the potential catastrophic risk from metastable
   quantum-black holes produced at particle colliders"**
   - arXiv abs: <https://arxiv.org/abs/0808.1415>
   - Type: dissenting preprint (never journal-published)
   - Position: **risk not excluded** — a metastable quantum black hole
     could accrete at the Eddington limit and emit harmful radiation;
     existing risk analyses are incomplete; proposes operational
     mitigations.
   - Enables: the primary dissent node — `contradicts` sources 2 and 3;
     a source-quality target (preprint vs peer-reviewed, but engaging
     the technical argument on its own terms).

7. **Giddings & Mangano 2008 — "Comments on claimed risk from metastable
   black holes"**
   - arXiv abs: <https://arxiv.org/abs/0808.4087>
   - Type: direct rebuttal (4-page note, 29 Aug 2008)
   - Conclusion: Plaga's scenario is **internally inconsistent**.
   - Enables: `contradicts` source 6 — completing the cleanest
     three-node argument chain in the corpus (safety case → dissent →
     rebuttal, all on arXiv within one summer); an asymmetric-language
     target (the tone of expert dismissal vs Plaga's hedged framing).

8. **Otto Rössler — interview: "Professor Otto Rössler Takes On The
   LHC"** (Science 2.0, 2008)
   - <https://www.science20.com/big_science_gambles/blog/interview_professor_otto_r%C3%B6ssler_takes_lhc-31449>
   - Context + documented rebuttals (Wikipedia biography — Nicolai's
     "elementary misunderstanding of general relativity", the KET open
     letter): <https://en.wikipedia.org/wiki/Otto_R%C3%B6ssler>
   - Type: interview with the second named dissenter (+ encyclopedia
     documentation of the expert response)
   - Position: micro black holes could grow exponentially inside Earth
     (his reinterpretation of the Schwarzschild metric); demands an LHC
     safety conference.
   - Enables: a second, mechanistically distinct dissent node —
     `contradicts` sources 1–3; the Wikipedia page supplies the
     `contradicts` edges back onto Rössler (Nicolai, KET) that have no
     surviving standalone pages; a source-quality/credentials finding
     (chaos theorist ≠ general relativist — and whether that ad hominem
     is itself an audit-worthy move).

## 3. Legal challenges

The controversy's institutional stress test: two jurisdictions, both
dismissed — and, per the law-review analysis, **never on the merits**.

9. **NBC News (Alan Boyle) — "Doomsday fears spark lawsuit over
   collider"** (March 2008)
   - <https://www.nbcnews.com/id/wbna23844529>
   - Type: news coverage of the Sancho/Wagner federal filing (D. Hawaii)
   - Position: reports the plaintiffs' claims (black holes, strangelets,
     missing environmental review) and CERN's response.
   - Enables: the legal-filing event node; a headline-fidelity target
     ("doomsday fears" framing vs the complaint's actual procedural
     claims); replaces the robots-blocked NYT Overbye piece (see
     § Capture notes).

10. **phys.org — "LHC lawsuit case dismissed by US court"** (Sept 2010)
    - <https://phys.org/news/2010-09-lhc-lawsuit-case-dismissed-court.html>
    - Type: news coverage of the 9th Circuit affirmance
    - Conclusion: dismissal upheld — "speculative fear", no credible
      threat shown, no US jurisdiction over CERN.
    - Enables: an `updates` edge closing source 9's thread; note the
      court dismissed on standing/jurisdiction, **not** by adjudicating
      the physics — an omission target for any coverage saying "court
      ruled it safe".

11. **The German challenges — constitutional court (2010) and Münster
    appeal (2012)**
    - Sputnik (9 Mar 2010): "German court rejects lawsuit against Large
      Hadron Collider" — <https://sputnikglobe.com/20100309/158139815.html>
    - NBC News (2012): "German court rules that collider won't destroy
      Earth" — <https://www.nbcnews.com/id/wbna49483243>
    - Type: news coverage of the Rössler-linked German court track
      (Karlsruhe constitutional complaint rejected without hearing;
      Münster higher administrative court appeal rejected)
    - Enables: the second-jurisdiction `updates` chain; the NRW Justice
      Ministry's quote that a hazard "is impossible according to the
      state of science" is a prime over-claim / asymmetric-language
      target against source 16's argument that "impossible" is exactly
      what a safety analysis cannot deliver; Sputnik (Russian state
      media) is itself a deliberate source-quality exercise —
      corroborated here by NBC.

12. **Eric E. Johnson — "The Black Hole Case: The Injunction Against the
    End of the World"** (Tennessee Law Review 76:819, 2009)
    - arXiv abs: <https://arxiv.org/abs/0912.5480>
    - Journalistic companion — Physics World, "Law and the end of the
      world": <https://physicsworld.com/a/law-and-the-end-of-the-world/>
    - Type: peer-edited law-review article (a legal scholar takes the
      catastrophic-risk claim seriously as a question of judicial
      process)
    - Position: no court ever braved the factual terrain to reach the
      merits; how *should* law handle expert-dependent extinction
      claims?
    - Enables: the meta-legal node — `supports` source 16's
      methodological point from an independent discipline; documents
      that the legal system never actually evaluated the physics
      (an omission finding waiting for retrospectives that imply
      otherwise).

## 4. Media doomsday coverage (2008)

The amplification layer. The genuinely breathless tabloid originals have
link-rotted (see § Capture notes) — the corpus captures one preserved
secondhand, one mainstream fear-framing piece, and one sober same-period
explainer.

13. **TIME — "Collider Triggers End-of-World Fears"** (Eben Harrell,
    4 Sept 2008)
    - <https://time.com/archive/6932803/collider-triggers-end-of-world-fears/>
    - Type: mainstream newsmagazine treatment, one week before first beam
    - Position: frames the fears as a recurring social phenomenon
      (doomsday "Rorschach test") while airing them.
    - Enables: a headline-fidelity target — the headline sells
      "End-of-World Fears", the body largely debunks them; the
      mainstream-amplification node between tabloid and explainer tiers.

14. **Astroengine — "The LHC Could Spell Doomsday in 9 days! (Oh Please,
    Not Again!)"** (1 Sept 2008)
    - <https://astroengine.com/2008/09/01/the-lhc-could-spell-doomsday-in-9-days-oh-please-not-again/>
    - Type: science-blog rebuttal that quotes and preserves The Sun's
      "End of the World Due in 9 Days" coverage
    - Enables: the breathless-tabloid node, secondhand — the original
      Sun page is dead, so the *debunker is now the only capturable
      record of the claim it debunked* (a link-rot / archival-integrity
      exhibit tailor-made for X-Ray's pitch); a framing `contradicts`
      edge vs source 15.

15. **Christian Science Monitor — "Could the Large Hadron Collider
    destroy Earth?"** (1 July 2008)
    - <https://www.csmonitor.com/Technology/Horizons/2008/0701/could-the-large-hadron-collider-destory-earth>
    - Type: sober same-period explainer (note: "destory" typo is in the
      real URL slug)
    - Position: walks through the safety case; answer: no.
    - Enables: the fidelity baseline — same week, same facts, opposite
      framing from the tabloid tier; `supports` edge onto source 2;
      replaces the robots-blocked BBC Rincon explainer (see § Capture
      notes).

## 5. Philosophical / risk-theory layer

16. **Ord, Hillerbrand & Sandberg — "Probing the Improbable:
    Methodological Challenges for Risks with Low Probabilities and High
    Stakes"** (J. Risk Research 13(2), 2010)
    - arXiv abs: <https://arxiv.org/abs/0810.5515>
    - Type: risk-methodology paper written in direct response to the LHC
      safety debate
    - Position: a quoted probability is really P(disaster | the argument
      is sound) — and P(the argument is flawed) may dwarf the quoted
      number; safety cases need to account for their own fallibility.
    - Enables: the corpus's knowability-ceiling node — an
      `updates`/critique edge onto sources 2 and 3 that **does not
      contradict their conclusion**, only caps the confidence
      expressible in it; the direct foil for the "impossible" quote in
      source 11 — the cleanest asymmetric-language pairing in the case.

## 6. Retrospective — "we didn't die"

17. **NASA Science — "The Day the World Didn't End"** (Oct 2008)
    - NASA original: <https://science.nasa.gov/science-news/science-at-nasa/2008/10oct_lhc>
    - phys.org syndication: <https://phys.org/news/2008-10-day-world-didnt.html>
    - Type: post-first-beam reassurance piece (cosmic-ray argument)
    - Enables: a literal `duplicates` edge (same text, two outlets —
      a wire-syndication demo for the 30055 vocabulary); and a
      number-hygiene/omission catch: 10 Sept 2008 was **beam-only, no
      collisions** — "the world didn't end on switch-on day" tested
      nothing, yet carried the reassurance narrative.

18. **CERN Courier — "The day the world switched on to particle
    physics"** (2018, tenth-anniversary retrospective)
    - <https://cerncourier.com/a/the-day-the-world-switched-on-to-particle-physics/>
    - Type: institutional retrospective on the 2008 media frenzy and how
      CERN's communications handled the black-hole scare
    - Enables: the `updates` bookend over the whole 2008 media layer; an
      institutional self-narrative check (how the org that won the
      argument tells the story a decade later — compare against sources
      12 and 16 for what the victory-lap version omits).

## 7. Synthesis hub

19. **Wikipedia — "Safety of high-energy particle collision
    experiments"**
    - <https://en.wikipedia.org/wiki/Safety_of_high-energy_particle_collision_experiments>
    - Type: encyclopedia synthesis of the entire controversy (RHIC and
      LHC, safety studies, dissent, lawsuits, media)
    - Enables: the case map — a secondary-synthesis source to audit for
      selective citation against the primaries above (it surfaced in
      nearly every verification search; the single most-linked page on
      this topic).

## Contradictory pairs (the edges we expect to build)

The demo's payload — explicit 30055 edges. Unlike eggs, the shape is not
symmetric flip-flops but a **spine with branches**:

- **Chain A (the core exchange, all-arXiv, one summer):** source 6
  (Plaga: risk not excluded) ⟶ `contradicts` ⟶ sources 2/3 (LSAG,
  Giddings–Mangano: no conceivable danger); source 7 (G&M comments) ⟶
  `contradicts` ⟶ source 6. Three nodes, six weeks, fully capturable in
  clean arXiv HTML.
- **Chain B (second dissenter, different mechanism):** source 8
  (Rössler: exponential growth) ⟶ `contradicts` ⟶ sources 1/2; the
  Nicolai/KET rebuttals documented in source 8's Wikipedia companion ⟶
  `contradicts` ⟶ Rössler.
- **Edge C (the critique that is not a contradiction):** source 16 (Ord
  et al.) ⟶ `updates`/critiques ⟶ sources 2/3 — accepts the physics,
  caps the expressible certainty. The subtlest edge in the corpus and
  the best test of whether the tool can represent "challenges the
  argument, not the conclusion".
- **Chain D (the safety case updating itself):** source 2 (LSAG 2008) ⟶
  `updates` ⟶ source 4 (2003 study); source 1's current page ⟶ `updates`
  ⟶ source 1's archived 2008 version; source 3 ⟶ `supports` ⟶ source 2;
  source 5 (APS Viewpoint) ⟶ `supports` ⟶ source 3 from outside CERN.
- **Pair E (framing contradiction, same week):** source 14 (Sun
  "doomsday in 9 days", preserved secondhand) vs source 15 (CSMonitor
  sober explainer) — a contradiction of framing, not fact; plus
  source 13's headline-vs-body gap as a fidelity finding.
- **Pair F (literal duplicates):** source 17's NASA original ⟶
  `duplicates` ⟶ its phys.org syndication — the corpus's clean
  wire-copy demo.
- **Pair G (over-claim vs methodology):** the "impossible according to
  the state of science" quote in source 11 ⟶ asymmetric-language /
  over-claim finding against source 16's central thesis; and sources
  10/12 establish the courts dismissed on standing, never the merits —
  an omission finding for any node implying judicial validation of the
  physics.
- **Retrospective cap:** source 18 ⟶ `updates` ⟶ the 2008 media layer
  (13–15, 17); audit its victory-lap framing against sources 12 and 16
  for what the ten-years-later story leaves out.

## Capture notes (easy vs hard tier)

**Easy tier — clean, article-shaped HTML (X-Ray's happy path):**
arXiv abs pages (2, 3, 6, 7, 12, 16 — stable, uniform, no JS needed),
CERN pages (1 current + archived), CDS record page (4), APS Physics
Viewpoint (5), Wikipedia (8 companion, 19), phys.org (10, 17 mirror),
TIME archive (13), astroengine (14), CSMonitor (15), NASA (17),
CERN Courier (18), Physics World (12 companion — occasionally shows a
free-registration wall; the article page itself is article-shaped).

**Harder tier — JS-heavy, encoded, or fragile:**
- **NBC legacy pages (9, 11)** — old `wbna*` IDs render through a
  JS-heavy template; expect the Readability fallback to work but verify
  the byline/date survive extraction.
- **Science 2.0 (8)** — the URL contains a percent-encoded ö
  (`r%C3%B6ssler`); paste it exactly. 2008-era pages carry heavy widget
  chrome around a clean article body.
- **Sputnik (11)** — loads fine but is Russian state media: capture it
  *as* a source-quality exercise, corroborated by the NBC piece in the
  same bullet.
- **CDS (4)** — the record page is clean HTML but the report itself is a
  PDF; capture the record page (title/abstract/metadata) and treat the
  PDF as out of the article-shaped tier, like the eggs doc's
  worldeggorganisation PDF.
- **Journal landing pages** — J. Phys. G (source 2) and Phys. Rev. D
  (source 3) publisher pages are paywalled; **the arXiv abs page is the
  capture target throughout**, exactly as the eggs corpus prefers
  PMC/PubMed.

**Dropped as dead or unverifiable (do not capture without re-checking):**
- *The Sun*, "End of the World Due in 9 Days" and *Daily Mail* (Michael
  Hanlon), "Are we going to die next Wednesday?" — the 2008 tabloid
  originals are link-rotted / unindexed; represented secondhand via
  sources 13–14. This gap is itself part of the story the corpus tells.
- *NYT* (Overbye, 29 Mar 2008, "Asking a Judge to Save the World…") and
  *BBC* (Rincon, 23 Jun 2008, "Earth 'not at risk' from collider") —
  both almost certainly still live, but nytimes.com and bbc.co.uk block
  our verification crawler, so they could not be verified today;
  replaced by sources 9 and 15. If capturing interactively in a browser,
  they are worthwhile manual additions.
- The Bundesverfassungsgericht's official English decisions portal — the
  page our search surfaced turned out to be the unrelated *Honeywell*
  order (2 BvR 2661/06), not the LHC complaint; no verified official
  page for the LHC order exists in English, so the German track is
  documented via journalism (source 11).

**Recommendation:** capture the arXiv abs page for every paper, the
outlet page for journalism, and start with Chain A (sources 2, 3, 6, 7 —
four clean arXiv pages forming a complete contradict/rebut cycle) to get
the argument spine standing before adding the media and legal branches.

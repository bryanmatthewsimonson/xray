# Case brief — Will CERN generate a black hole?

> **This document is a rendered view, not the record.** It is a local, non-authoritative rendering of a signed NOSTR event corpus. The interrogable artifact is the signed event graph itself — the captures, claims, links, and audits it cites — fetchable and verifiable from the relays below without this file.
>
> **Publishing identity:** `npub1qyz453ryrzjqyje0kyd8w4g23tzurtm7nax5z26j8xemwwdl80lq2pfxt5` · hex `01055a446418a4024b2fb11a77550a8ac5c1af7e9f4d412b5239b3b739bf3bfe`
>
> **Relays:** `wss://relay.primal.net`, `wss://relay.nostr.net`, `wss://nos.lol`, `wss://nostr.mom`, `wss://nostr.oxtr.dev`, `wss://offchain.pub`
>
> **Query the corpus:** from any NOSTR client or a raw WebSocket, request events by author — e.g. `["REQ","xray",{"authors":["01055a446418a4024b2fb11a77550a8ac5c1af7e9f4d412b5239b3b739bf3bfe"],"kinds":[30023]}]`, one kind per query; the kind vocabulary is documented in X-Ray's NIP draft (`docs/NIP_DRAFT.md`).

*A synthesis of 10 captured sources. Of these, 7 were analyzed for this synthesis; 3 could not be processed and are absent from the sections below. Every quote below is verbatim from a captured source — open the linked source to read it in context. Positions cite their sources by number — the full list is under **Sources** at the end. Compiled with [X-Ray](https://github.com/bryanmatthewsimonson/xray); this is a map of the disagreement, **not** a ruling.*

## Summary

The corpus concerns whether the Large Hadron Collider (LHC) could generate a microscopic black hole (or related exotic object such as a strangelet, vacuum bubble, or magnetic monopole) capable of posing a danger to Earth. It includes official/consensus safety analyses (CERN's LSAG report, Giddings & Mangano and follow-up papers, the earlier atmospheric-ignition analog, and a heavy-ion safety review), critical/dissenting technical papers arguing the safety case has gaps (Plaga; Solomon; the paper reasserting a 'residual risk'), profiles/interviews with a public critic (Otto Rössler) who argues the LHC could destroy the Earth, a rebuttal explicitly refuting Rössler's and Plaga's reasoning, and purely descriptive technical background on what the LHC is and how it works. The articles disagree sharply on whether current physics and observational evidence (cosmic-ray survival, white dwarf/neutron star longevity, Hawking radiation theory) are sufficient to rule out danger, or whether unresolved theoretical possibilities (non-radiating/stable black holes, microcanonical suppression of Hawking radiation, exotic accretion scenarios) leave a residual, non-zero risk. The brief presents these positions and the specific disputed technical points side by side without resolving which is correct.

## Positions

### No conceivable danger / LHC is safe (mainstream consensus safety case)

Cosmic rays have already reproduced LHC-equivalent collisions vastly more times than the LHC ever will, and the continued survival of Earth, the Moon, the Sun, and ancient white dwarfs/neutron stars demonstrates that any black holes, strangelets, vacuum bubbles, or monopoles produced are either not produced or are harmless; any black holes produced are expected to decay via Hawking radiation before causing damage.

*Held by:* \[[1](https://arxiv.org/abs/0806.3414)\], \[[2](https://arxiv.org/abs/0806.3381)\], \[[3](https://physics.aps.org/articles/v1/14)\], \[[4](https://cds.cern.ch/record/613175/files/CERN-2003-001.pdf)\], \[[5](https://blog.nuclearsecrecy.com/wp-content/uploads/2018/06/1946-LA-602-Konopinski-Marvin-Teller-Ignition-fo-the-Atmsophere.pdf)\]

### Rebuttal of specific dissenting risk claims

A specific published warning (Plaga's metastable/suppressed-Hawking-radiation scenario) is mathematically inconsistent; once corrected, the predicted power output is negligible (differing by a factor of 10^23), so the original safety conclusions stand; similarly, a public critic's (Rössler's) arguments rest on a misunderstanding of general relativity.

*Held by:* \[[6](https://arxiv.org/abs/0808.4087)\], \[[7](https://en.wikipedia.org/wiki/Otto_R%C3%B6ssler)\]

### Residual/unresolved risk exists — safety case is incomplete

Existing risk analyses (Giddings & Mangano, Koch et al.) rest on unjustified assumptions (e.g., minimum black hole mass, exclusion of microcanonical suppression of Hawking radiation) and exclude plausible black-hole parameter ranges from consideration without adequate justification; under these excluded scenarios a metastable black hole could accrete at the Eddington limit and cause a locally catastrophic or planet-threatening event that would be undetectable in existing astrophysical data, so a definite residual risk remains at the current state of knowledge.

*Held by:* \[[8](https://arxiv.org/abs/0808.1415)\]

### LHC could plausibly generate a world-ending black hole (public critic / anti-LHC)

Artificial mini black holes produced at the LHC could be slow enough to be captured by Earth's gravity (unlike fast cosmic-ray-produced ones), grow (allegedly exponentially) rather than evaporate under a reinterpreted Schwarzschild metric, and are not excluded by CERN's neutron-star/superfluidity safety arguments, warranting a halt/safety conference until refuted.

*Held by:* \[[7](https://en.wikipedia.org/wiki/Otto_R%C3%B6ssler)\], \[[9](https://science20.com/big_science_gambles/blog/interview_professor_otto_r%25C3%25B6ssler_takes_lhc-31449)\]

### Descriptive / no position taken

Purely technical/factual description of the LHC's construction, operation, and experiments, without addressing black hole risk.

*Held by:* \[[10](https://home.cern/science/accelerators/large-hadron-collider)\]

### Historical precedent (atmospheric ignition analog)

An earlier analysis of whether a nuclear bomb detonation could ignite a self-propagating atmospheric nuclear reaction concluded such propagation was unreasonable to expect given radiative energy losses, though the calculated safety margin was not overwhelmingly large — offered as a template/precedent for assessing speculative catastrophic risk from new technology.

*Held by:* \[[5](https://blog.nuclearsecrecy.com/wp-content/uploads/2018/06/1946-LA-602-Konopinski-Marvin-Teller-Ignition-fo-the-Atmsophere.pdf)\]

## Cruxes of disagreement

### Do microscopic black holes produced at the LHC necessarily decay via Hawking radiation, or could Hawking radiation be suppressed or absent (allowing stable black holes)?

- **Hawking radiation is robust/universal:** Theoretical evidence for Hawking radiation is very strong, with numerous independent calculations agreeing on detailed formulae; any suggestion that decay may not be universal lacks a complete microphysical picture and appears to contradict basic quantum-mechanical principles.
- **Hawking radiation may be suppressed for some parameter ranges:** A microcanonical treatment (Casadio & Harms, cited via Plaga) suggests quantum black holes below a mass threshold live much longer than standard thermodynamic (Hawking) predictions, meaning suppression is plausible in some regimes and has not been adequately excluded by safety analyses.

> While this suggestion is not based on any complete microphysical picture, and furthermore appears contradictory to basic quantum-mechanical principles4, it does raise a possible question about stability of microscopic black holes that might be produced at the LHC
> — [0806.3381](https://arxiv.org/abs/0806.3381)

> the theoretical evidence for Hawking radiation is very strong. Numerous calculations from different points of view agree on the detailed formulae for the Hawking temperature and spectrum.
> — [The end of the world at the Large Hadron Collider?](https://physics.aps.org/articles/v1/14)

> There is no direct evidence for Hawking radiation.
> — [The end of the world at the Large Hadron Collider?](https://physics.aps.org/articles/v1/14)

*What would resolve it:* Direct observational detection (or exclusion) of Hawking radiation, or a complete, agreed-upon microphysical theory establishing whether/where suppression occurs.

### Does the cosmic-ray survival argument (Earth, Moon, Sun, white dwarfs, neutron stars have survived eons of cosmic-ray collisions) rule out LHC danger?

- **Cosmic-ray argument is decisive:** Nature has already conducted ~10^31 LHC-equivalent experimental programmes via cosmic rays, and the continued existence and health of Earth, the Moon, the Sun, and ancient white dwarfs/neutron stars over billions of years shows any black holes or strangelets produced are harmless or not produced at all.
- **Cosmic-ray argument has a loophole for slow/slippery black holes:** Cosmic-ray-produced black holes would be moving at relativistic speed and would zoom through Earth with only glancing interactions, so their survival says nothing about slower, LHC-produced ('slippery') black holes that could be captured and accrete; new astrophysical arguments (white dwarfs, neutron stars) were introduced specifically to close this gap, but critics still dispute whether the gap is fully closed.

> Nature has already completed about 1031 LHC experimental programmes since the beginning of the Universe. Moreover, each second, the Universe is continuing to repeat about 3x1013 complete LHC experiments.
> — [Microsoft Word - LSAG-JPG.doc](https://arxiv.org/abs/0806.3414)

> However, such a black hole produced by cosmic rays would zoom through the earth at the speed of light, suffering in the process only a few glancing collisions. In this picture, the cosmic-ray argument seems to lose its force.
> — [The end of the world at the Large Hadron Collider?](https://physics.aps.org/articles/v1/14)

*What would resolve it:* A definitive theoretical determination of whether LHC-produced black holes would in fact be captured (slow) versus escape (fast) Earth, combined with agreement on whether white-dwarf/neutron-star constraints fully substitute for the weakened Earth-based cosmic-ray argument.

### Does the astrophysical observation of white dwarfs and neutron stars conclusively exclude dangerous black hole production, or could a dangerous black hole evade detection in these objects?

- **White dwarfs/neutron stars conclusively exclude danger:** The observation of long-lived white dwarfs and neutron stars (some over a billion years old) that would have been destroyed by an accreting black hole tells us cosmic rays do not produce dangerous black holes, and hence neither will the LHC; a solar-mass white dwarf can efficiently stop black holes produced under the most conservative LHC scenarios.
- **White dwarf/neutron star exclusion is not established:** Giddings & Mangano did not demonstrate with reasonable certainty that white dwarfs stop cosmic-ray-produced black holes in general; a dangerous black hole's effect on a white dwarf or neutron star could be negligible and thus undetectable, meaning astrophysical observations cannot actually rule it out.

> The observation of white dwarfs and neutron stars that would have been destroyed in this way tells us that cosmic rays do not produce such black holes, and hence neither will the LHC.
> — [Microsoft Word - LSAG-JPG.doc](https://arxiv.org/abs/0806.3414)

> & M did not demonstrate with reasonable certainty that white dwarfs stop cosmic-ray produced mBHs in general. Their exclusion of dangerous
> — [0808.1415](https://arxiv.org/abs/0808.1415)

> The CERN argument looks like a good one, but it is demonstrably wrong.
> — [Interview: Professor Otto Rössler Takes On The LHC](https://science20.com/big_science_gambles/blog/interview_professor_otto_r%25C3%25B6ssler_takes_lhc-31449)

> Neutron stars are in a macroscopic quantum state called superfluidity. And this state protects them because it makes them transparent to fast particles.
> — [Interview: Professor Otto Rössler Takes On The LHC](https://science20.com/big_science_gambles/blog/interview_professor_otto_r%25C3%25B6ssler_takes_lhc-31449)

*What would resolve it:* A rigorous, generally accepted calculation of black hole accretion/stopping rates inside white dwarf and neutron star matter across the full range of disputed black hole parameters (mass, charge, radius).

### Was Plaga's claimed dangerous power output (~10^16 W) from a metastable black hole scenario correct, or the product of a mathematical error?

- **Claim is a mathematical error:** The large power output claimed stems from inconsistent application of the paper's own formula (2); using correct parameters the actual power output is negligible (about 0.1 microwatt), differing by a factor of 10^23 from the claim; the four-dimensional Schwarzschild radius for the considered mass range lies far below the claimed 10^-5 cm scale, and the paper misquoted the rebutted authors and selectively cited the literature.
- **Scenario remains plausible/unaddressed:** A subsequent paper argues that Casadio et al.'s work confirms the validity and plausibility of the scenario excluded from CERN's safety analysis without justification, and that the paper's objection about power output does not apply because the scenario does not use the canonical equation to calculate power output; the resulting Hawking radiation could reach an Eddington-limited luminosity of 5.1×10^16 W, 1300 times Earth's total seismic power, with catastrophic local consequences.

> one readily finds from the formula (1) a negligible power output of size dE dt differing by a factor of 1023 from the claim of \[1\]
> — [0808.4087](https://arxiv.org/abs/0808.4087)

> \[1\] has both misquoted our paper \[2\], and selectively quoted from the available literature.
> — [0808.4087](https://arxiv.org/abs/0808.4087)

*What would resolve it:* A resolved, peer-agreed calculation reconciling the microcanonical and standard Hawking treatments for the specific black hole mass/radius regime in dispute.

### Is the exclusion of certain black hole parameter ranges (e.g., minimal mass assumptions) from official safety analyses (Giddings & Mangano, Koch et al.) scientifically justified?

- **Exclusions are well-founded and conservative:** The safety bounds are conservative, with every encountered uncertainty replaced by a worst-case assumption; detailed calculations from multiple perspectives conclude there is no risk of any significance.
- **Exclusions are arbitrary/unjustified:** Giddings & Mangano's assumption that black holes have a minimal mass exceeding the new Planck scale by a factor of 3 is not justified for excluding smaller, potentially dangerous black holes; Casadio et al. treat certain mass values as an upper limit without giving any reason; the risk analyses are therefore incomplete because they exclude plausible black-hole parameter ranges from safety consideration without adequate justification, leaving a definite residual risk.

> We note that our bounds are conservative. In particular, at each point where we have encountered an uncertainty, we have replaced it by a conservative or “worst case” assumption.
> — [0806.3381](https://arxiv.org/abs/0806.3381)

> at the present stage of knowledge there is a definite residual risk from mBH production at colliders.
> — [0808.1415](https://arxiv.org/abs/0808.1415)

*What would resolve it:* An independent, agreed-upon derivation of the physically justified minimal/maximal black hole mass and parameter bounds relevant to LHC energies.

### Is Otto Rössler's specific technical reasoning (reinterpreted Schwarzschild metric, exponential black hole growth, superfluidity argument) valid physics?

- **Reasoning is invalid:** A leading quantum gravity physicist described Rössler's arguments as based on an elementary misunderstanding of general relativity; critics say Rössler lacks credentials in physics.
- **Reasoning is presented as valid by its author:** Rössler claims black holes cannot evaporate under his new interpretation of the Schwarzschild metric, that mini black holes would grow exponentially (shortening Earth's consumption to as little as 50 months), and that neutron star superfluidity would not protect Earth from artificial slow mini black holes, and that CERN's neutron-star safety argument is demonstrably wrong.

> Hermann Nicolai, director of the [Max Planck Institute for Gravitational Physics](<https://en.wikipedia.org/wiki/Max_Planck_Institute_for_Gravitational_Physics >)' quantum gravity division, later described Rössler's arguments as being "... based on an elementary misunderstanding of the theory of general
> — [Otto Rössler](https://en.wikipedia.org/wiki/Otto_R%C3%B6ssler)

> Black holes *cannot evaporate* because their horizon is effectively infinitely far away in spacetime according to my new interpretation of the Schwarzschild metric
> — [Interview: Professor Otto Rössler Takes On The LHC](https://science20.com/big_science_gambles/blog/interview_professor_otto_r%25C3%25B6ssler_takes_lhc-31449)

> Mini black holes grow *exponentially* rather than linearly inside the earth: “mini-quasar principle” \\\[2\\\]. Hence the time needed by a resident mini black hole to eat the earth is maximally shortened – perhaps down to “50 months”.
> — [Interview: Professor Otto Rössler Takes On The LHC](https://science20.com/big_science_gambles/blog/interview_professor_otto_r%25C3%25B6ssler_takes_lhc-31449)

> The CERN argument looks like a good one, but it is demonstrably wrong.
> — [Interview: Professor Otto Rössler Takes On The LHC](https://science20.com/big_science_gambles/blog/interview_professor_otto_r%25C3%25B6ssler_takes_lhc-31449)

> But unfortunately, superfluidity will not protect this planet from artificial sufficiently slow mini black holes, likely or possibly produced at the LHC.
> — [Interview: Professor Otto Rössler Takes On The LHC](https://science20.com/big_science_gambles/blog/interview_professor_otto_r%25C3%25B6ssler_takes_lhc-31449)

*What would resolve it:* Formal peer review and consensus among general relativity/quantum gravity specialists on Rössler's reinterpretation of the Schwarzschild metric and his black-hole growth model.

### Could a self-propagating catastrophic chain reaction/accretion event occur at all under the relevant physical constraints (drawing on the historical atmospheric-ignition precedent and the mBH accretion scenario)?

- **No propagation/catastrophe expected:** Radiative energy losses (inverse Compton effect) quench any nuclear chain reaction once it extends over a radius of a few hundred meters; no self-propagating chain of nuclear reactions is likely to start in the atmosphere no matter how hot a region is heated, and the calculated safety margin, while not overwhelmingly large, is positive.
- **Catastrophic local accretion is plausible in some scenarios:** Metastable quantum black holes could accrete ambient matter at the Eddington limit shortly after production, potentially producing a locally contained catastrophe at CERN equivalent to 12 Mt TNT per second if such a black hole accreted near Earth's surface.

*What would resolve it:* Direct experimental or observational data on Eddington-limited accretion behavior of hypothetical microscopic black holes, if such objects are ever produced or detected.

## Load-bearing claims

> In short, this study finds no basis for concerns that TeV-scale black holes from the LHC could pose a risk to Earth on time scales shorter than the Earth’s natural lifetime.
> — [0806.3381](https://arxiv.org/abs/0806.3381)
> *Why it matters:* This is the central conclusion of the primary technical safety paper underlying the entire 'no risk' position in the corpus.

> There is no basis for any concerns about the consequences of new particles or forms of matter that could possibly be produced by the LHC.
> — [Microsoft Word - LSAG-JPG.doc](https://arxiv.org/abs/0806.3414)
> *Why it matters:* This is CERN's own official safety conclusion, the anchor point that other articles either affirm, extend, or dispute.

> at the present stage of knowledge there is a definite residual risk from mBH production at colliders.
> — [0808.1415](https://arxiv.org/abs/0808.1415)
> *Why it matters:* This is the sole direct counter-conclusion in the corpus explicitly asserting a residual, non-excluded risk, making it the crux load-bearing claim for the dissenting position.

> We conclude that the conclusions of \[2\] on this subject, as stated there and as referred to in the LHC safety assessment report \[7\], remain robust.
> — [0808.4087](https://arxiv.org/abs/0808.4087)
> *Why it matters:* This rebuttal claim directly underwrites the corpus's argument that a specific dissenting risk claim (Plaga) was mistaken, reinforcing the mainstream safety conclusion.

> However, such a black hole produced by cosmic rays would zoom through the earth at the speed of light, suffering in the process only a few glancing collisions. In this picture, the cosmic-ray argument seems to lose its force.
> — [The end of the world at the Large Hadron Collider?](https://physics.aps.org/articles/v1/14)
> *Why it matters:* This is the key articulated loophole in the standard cosmic-ray safety argument that necessitated the additional white-dwarf/neutron-star analysis, central to understanding why the safety case required extension.

> The CERN argument looks like a good one, but it is demonstrably wrong.
> — [Interview: Professor Otto Rössler Takes On The LHC](https://science20.com/big_science_gambles/blog/interview_professor_otto_r%25C3%25B6ssler_takes_lhc-31449)
> *Why it matters:* This is the central claim of the public dissent position, directly challenging the neutron-star-based safety argument.

> Hermann Nicolai, director of the [Max Planck Institute for Gravitational Physics](<https://en.wikipedia.org/wiki/Max_Planck_Institute_for_Gravitational_Physics >)' quantum gravity division, later described Rössler's arguments as being "... based on an elementary misunderstanding of the theory of general
> — [Otto Rössler](https://en.wikipedia.org/wiki/Otto_R%C3%B6ssler)
> *Why it matters:* This is the corpus's direct expert rebuttal of the public dissent position, central to the disagreement over Rössler's credibility.

## Coverage gaps

- No article in the corpus provides a rebuttal specifically addressing the residual-risk paper's claim (Eddington-limited 12 Mt TNT/second scenario) beyond the general Giddings & Mangano/Plaga exchange; there is no direct point-by-point response to the specific Eddington-luminosity calculation.
- No peer-reviewed physics rebuttal of Rössler's specific 'exponential growth'/'mini-quasar principle' and reinterpreted Schwarzschild metric claims is included beyond a single dismissive quote from Hermann Nicolai; the detailed mathematical basis of Rössler's claims and any formal refutation are absent from the corpus.
- No independent third-party or regulatory-body assessment (e.g., a government agency, independent physics review board outside CERN-affiliated authors) is present; nearly all technical safety analyses originate from authors connected to Giddings, Mangano, Ellis, or CERN-commissioned reports.
- The corpus does not include the full peer-reviewed literature debate following these papers (e.g., subsequent responses to the 'residual risk' claim, or later Rössler rebuttals), so the current state of scientific consensus after these exchanges is not documented.
- No data or discussion of post-2008/2015 LHC operational experience (i.e., whether the actual running of the LHC at higher energies since these papers were written has produced any relevant empirical evidence) is included.
- No article addresses public risk-communication, regulatory, or legal/policy analysis of how such low-probability catastrophic-risk claims should be handled by courts or governments, beyond noting Rössler's failed lawsuit.
- No perspectives from strangelet or vacuum-bubble specialists critical of the mainstream safety consensus are present (all strangelet/vacuum-bubble content argues the 'no danger' position), so the corpus lacks any dissenting view analogous to Plaga's for these other exotic-object risks.

## Sources

1. [Microsoft Word - LSAG-JPG.doc](https://arxiv.org/abs/0806.3414) — arxiv.org
2. [0806.3381](https://arxiv.org/abs/0806.3381) — arxiv.org
3. [The end of the world at the Large Hadron Collider?](https://physics.aps.org/articles/v1/14) — physics.aps.org · 2008-08-18
4. [LHCsafety.tex](https://cds.cern.ch/record/613175/files/CERN-2003-001.pdf) — cds.cern.ch
5. [1946-LA-602-Konopinski-Marvin-Teller-Ignition-fo-the-Atmsophere](https://blog.nuclearsecrecy.com/wp-content/uploads/2018/06/1946-LA-602-Konopinski-Marvin-Teller-Ignition-fo-the-Atmsophere.pdf) — blog.nuclearsecrecy.com
6. [0808.4087](https://arxiv.org/abs/0808.4087) — arxiv.org
7. [Otto Rössler](https://en.wikipedia.org/wiki/Otto_R%C3%B6ssler) — en.wikipedia.org · 2006-05-01
8. [0808.1415](https://arxiv.org/abs/0808.1415) — arxiv.org
9. [Interview: Professor Otto Rössler Takes On The LHC](https://science20.com/big_science_gambles/blog/interview_professor_otto_r%25C3%25B6ssler_takes_lhc-31449) — science20.com · 2008-08-12
10. [Large Hadron Collider – Home](https://home.cern/science/accelerators/large-hadron-collider) — home.cern

## Appendix — entity index

*Claim counts are provenance and navigation aids — how many captured claims in this corpus mention each entity. They are not weight, importance, or credibility.*

### People

- **R. Plaga** — 37 claims · in 2 sources: \[[6](https://arxiv.org/abs/0808.4087)\], \[[8](https://arxiv.org/abs/0808.1415)\]
- **Michelangelo Mangano** — 23 claims · in 4 sources: \[[1](https://arxiv.org/abs/0806.3414)\], \[[2](https://arxiv.org/abs/0806.3381)\], \[[3](https://physics.aps.org/articles/v1/14)\], \[[6](https://arxiv.org/abs/0808.4087)\]
- **Steven B. Giddings** — 23 claims · in 3 sources: \[[2](https://arxiv.org/abs/0806.3381)\], \[[3](https://physics.aps.org/articles/v1/14)\], \[[6](https://arxiv.org/abs/0808.4087)\]
- **Otto Rössler** — 21 claims · in 2 sources: \[[7](https://en.wikipedia.org/wiki/Otto_R%C3%B6ssler)\], \[[9](https://science20.com/big_science_gambles/blog/interview_professor_otto_r%25C3%25B6ssler_takes_lhc-31449)\]
- **Giddings & Mangano** — 10 claims · in 1 source: \[[8](https://arxiv.org/abs/0808.1415)\]
- **Stephen Hawking** — 6 claims · in 3 sources: \[[1](https://arxiv.org/abs/0806.3414)\], \[[3](https://physics.aps.org/articles/v1/14)\], \[[9](https://science20.com/big_science_gambles/blog/interview_professor_otto_r%25C3%25B6ssler_takes_lhc-31449)\]
- **Casadio & Harms** — 2 claims · in 1 source: \[[8](https://arxiv.org/abs/0808.1415)\]
- **Koch et al.** — 2 claims · in 1 source: \[[8](https://arxiv.org/abs/0808.1415)\]
- **William Unruh** — 1 claim · in 2 sources: \[[3](https://physics.aps.org/articles/v1/14)\], \[[8](https://arxiv.org/abs/0808.1415)\]
- **Edwin Hubble** — 1 claim · in 1 source: \[[9](https://science20.com/big_science_gambles/blog/interview_professor_otto_r%25C3%25B6ssler_takes_lhc-31449)\]
- **Michael E. Peskin** — 1 claim · in 1 source: \[[3](https://physics.aps.org/articles/v1/14)\]
- **Rolf Landua** — 1 claim · in 1 source: \[[9](https://science20.com/big_science_gambles/blog/interview_professor_otto_r%25C3%25B6ssler_takes_lhc-31449)\]

### Organizations

- **CERN** — 9 claims · in 8 sources: \[[1](https://arxiv.org/abs/0806.3414)\], \[[2](https://arxiv.org/abs/0806.3381)\], \[[3](https://physics.aps.org/articles/v1/14)\], \[[4](https://cds.cern.ch/record/613175/files/CERN-2003-001.pdf)\], \[[6](https://arxiv.org/abs/0808.4087)\], \[[7](https://en.wikipedia.org/wiki/Otto_R%C3%B6ssler)\], \[[8](https://arxiv.org/abs/0808.1415)\], \[[9](https://science20.com/big_science_gambles/blog/interview_professor_otto_r%25C3%25B6ssler_takes_lhc-31449)\]
- **LHC Safety Study Group** — 3 claims · in 2 sources: \[[1](https://arxiv.org/abs/0806.3414)\], \[[4](https://cds.cern.ch/record/613175/files/CERN-2003-001.pdf)\]
- **E864 Experiment** — 1 claim · in 1 source: \[[4](https://cds.cern.ch/record/613175/files/CERN-2003-001.pdf)\]
- **International Institute for Advanced Studies** — 1 claim · in 1 source: \[[9](https://science20.com/big_science_gambles/blog/interview_professor_otto_r%25C3%25B6ssler_takes_lhc-31449)\]
- **NA52 Experiment** — 1 claim · in 1 source: \[[4](https://cds.cern.ch/record/613175/files/CERN-2003-001.pdf)\]

---

*Compiled from 10 sources with [X-Ray](https://github.com/bryanmatthewsimonson/xray). No single number stands in for the case — X-Ray maps disagreement and grounds every quote; it does not rank or rule.*

# Epistemic Auditing: Philosophy and Standards

**Document version:** 1.1.0
**Status:** Normative
**Date:** 2026-06-11 (concord amendment 2026-07-22)

This document is the organic statute of the X-Ray Epistemic Auditor — the audit family's governing law under the project constitution, `docs/CONSTITUTION.md`. It codifies the principles that every prompt, schema, scorer, rollup, dispute mechanism, and user-facing surface of the audit family must implement. Within its scope, unchanged: code expresses this document; when code and this document conflict, this document governs until it is formally amended (§13). Where this document and the constitution conflict, the constitution governs (CONSTITUTION Art. 14).

---

## How to use this document

**For agents (Claude Code) and human contributors alike:**

Read this document before making architectural, scoring, schema, or methodology decisions. When an implementation choice is ambiguous, resolve it via the Decision Heuristics (§11). When two principles appear to conflict, document the tension in the commit message or design note, cite the principles by number (e.g., "P9 over convenience"), and choose the option that best preserves auditability.

Recommended placement: repository root or `docs/PHILOSOPHY.md`, referenced from `CLAUDE.md` with an instruction to consult it before structural changes. Changes to this document follow the amendment process in §13 — the philosophy itself keeps an audit trail, because a system built on immutable history cannot have a mutable constitution.

---

## §0. Mission

Every score the system produces answers one question: **how much should a rational reader update their beliefs based on this artifact?**

That is the common axis. It is what makes a news report, an opinion column, an author's career, and a publication's decade of coverage comparable on a single scale. The system exists to make epistemic quality legible, comparable, and accountable — across articles, authors, beats, publications, and time.

We audit artifacts, not people. People accumulate records through their artifacts. A journalist is never scored for who they are; they are scored for the cumulative, evidence-anchored record of what they published and how it fared against reality.

We are outsiders by design. Outsider status is not a limitation to be apologized for — it is the structural feature that makes the audit trustworthy. No privileged access means no relationships to protect, no favors to trade, no embargoes to honor. Everything we know, the reader can know. Everything we conclude, the reader can re-derive.

---

## §1. The Twelve Principles

These are ranked roughly by how catastrophic their violation would be. P5, P9, and P10 are existential; the system does not survive their breach.

### P1 — Scores are probabilistic, not pronouncements

Every score ships with a confidence value. Every score has a vintage: the score-at-publication is preserved forever, distinct from the score-as-of-today, and the trajectory between them is itself a published artifact. A scoring system that pretends to omniscience destroys its own credibility on first failure. A system that publishes its uncertainty, its revisions, and its blind spots — and treats those as features rather than embarrassments — is the only kind that survives contact with reality.

### P2 — The claim is the atomic unit

An article is a vector of claims, each with its own provenance, verifiability, and post-hoc track record. Article scores roll up from claim-level and dimension-level findings; author and publication scores roll up from articles. This is what makes the system auditable: a challenger targets a specific sentence with specific evidence, never a vibe.

### P3 — No finding without verbatim evidence

Every finding, in every module, at every layer, must quote the artifact exactly. A finding that cannot point to the specific words it is about does not exist. This rule is what distinguishes an audit from an opinion, and it applies recursively: dispute filings, adjudications, and prediction resolutions are equally evidence-bound.

### P4 — Score the artifact as published

No charitable reformulation before scoring — do not mentally rewrite the article into the version its author should have written and then score that. No uncharitable strawmanning either. The published text, headline included, is the artifact. If the artifact was later edited, the new version is a new artifact with a new identity and a new audit lineage, and the diff between versions is itself a finding.

### P5 — Symmetry is existential

The same standards apply regardless of political valence, author identity, outlet, or whether the auditor's operators like the conclusion. Weights are never tuned to reach a desired outcome for a particular target. The practical test: if the scoreboard is not periodically uncomfortable for every political camp — including the camp of whoever runs the auditor — the calibration is broken. Political capture is the death of the system, and it dies quietly, one asymmetric judgment call at a time.

### P6 — Knowability bounds the score

Some subjects are inherently harder to verify than others. An article resting on classified intelligence or anonymous sources has a lower maximum achievable score than an article resting on public datasets and court filings — not as punishment, but as honesty about what can be known. The ceiling protects in both directions: careful work on hard beats is not penalized relative to its tractability class, and easy beats cannot coast on the absence of contestable claims. You cannot earn a 95 on three anonymous sources, no matter how elegant the prose.

### P7 — Calibration over correctness

Confident claims that turn out wrong cost more than hedged claims that turn out wrong. Confident claims that turn out right earn more than hedged claims that turn out right. This multiplier — applied through the prediction ledger as reality resolves — is the single most reliable mechanism for distinguishing honest journalists from confident bullshitters over time. Epistemic humility is measured, never assumed.

### P8 — Disagreement is data

When multiple auditors score the same artifact, every individual score is published alongside the variance. Disagreement is never averaged into false consensus. The meta-patterns — which reviewers run harsh, which lenient, which on which beats — are themselves published. The judges are judged, visibly.

### P9 — History is immutable

Nothing is ever overwritten. Scores update by supersession: a new audit is created, the old one is marked superseded with full lineage, and both remain permanently visible. Artifacts are content-addressed (the hash of the exact text is the identity; the URL is mere metadata), so audits remain anchored to precisely what was scored even when outlets stealth-edit. The mental model is append-only even where the storage layer is not.

### P10 — The auditor obeys its own standards, applied harder

The methodology is published before findings. The auditor's conflicts, priors, and exposures are disclosed. The auditor's corrections receive at least the prominence we score journalists on. The auditor keeps its own prediction ledger and publishes its own calibration. The auditor's outputs are themselves scoreable on the same dimensions, and others' scores of the auditor are published. Hypocrisy here is fatal: the system's entire claim to authority is unilateral, harder-than-thou self-application.

### P11 — Under-claim

Bounded findings survive; sweeping condemnations collapse at their weakest point. The honest output is usually modest: "this article shows surface markers of low quality in dimensions X, Y, Z; the substantive claims were not directly verified." Say exactly what the evidence shows, flag exactly what it cannot show, and let the record compound. Compounding bounded claims beat dramatic claims on every timescale that matters.

### P12 — Transparency is asymmetric

Disclose more than is comfortable: aggregation weights, methodology versions, dissenting reviewer notes, confidence intervals, the known-unknowns log (claims that could not be checked, parties who declined comment, documents requested and denied), and the financial and political exposures of everyone operating the system. The reader should be able to reconstruct any score from public materials. Anything less is a black box wearing a transparency costume.

---

## §2. The Outsider Stance

An epistemic auditor is not a fact-checker. A fact-checker re-reports the story; the auditor cannot — no one returns the auditor's calls, and that is fine. The auditor examines the published artifact for what it reveals about the process behind it. Well-reported work leaves a clean trail in the prose itself; sloppy or motivated work leaves fingerprints. The auditor reads fingerprints.

**What surface scanning can detect:** structural honesty (headline-body fidelity, internal coherence), language patterns (asymmetric framing, smuggled definitions, weasel quantifiers), sourcing architecture (named versus anonymous, justified versus bare, single-sourced contested claims), numerical context (denominators, base rates, comparison classes), and the geometry of who got the microphone.

**What surface scanning cannot detect:** the ground truth of contested facts, the actual reliability of anonymous sources, what was reported but cut, what was asked but unanswered, and the editorial pressures behind the text. The auditor never claims verification it did not perform.

Therefore every module output carries mandatory `auditor_caveats`: an explicit statement of what this scan could not determine about this artifact. A module that emits findings without caveats is broken, even when its findings are correct.

---

## §3. Dimensions of Judgment

### §3.1 News artifacts — the eight surface modules

| # | Module | The standard |
|---|--------|--------------|
| 1 | Headline-Body Fidelity | The headline and subhead accurately preview the body with proportional emphasis. Penalty-only: a headline cannot be better than accurate. |
| 2 | Asymmetric Language | Comparable parties and actions receive symmetric verbs, adjectives, and framing. Asymmetry is permitted only where the underlying facts are themselves asymmetric and established. |
| 3 | Number Hygiene | Every load-bearing number carries the denominator, base rate, and comparison class a numerate reader needs. Numbers used as emotional triggers fail regardless of arithmetic accuracy. |
| 4 | Source Quality | Sources are named where possible; anonymity is justified and described; contested claims are multi-sourced; cited documents are identified specifically enough to retrieve. Credit-bearing: linked primary sources earn points. |
| 5 | Internal Coherence | The article does not contradict itself — across paragraphs, between text and captions, between quotes and their characterization, between lede and body. |
| 6 | Definitional Precision | Contested, load-bearing terms are defined or scoped, never smuggled. Weasel quantifiers ("many," "growing") are backed or flagged. |
| 7 | Omission | The natural stakeholder set for the topic is heard from, or absences are explained. No party characterizes another party's position unanswered. |
| 8 | Prediction Extraction | Every testable prediction, explicit or implicit, is logged with hedge level, resolution horizon, and resolution criteria. Unscored at extraction; this module feeds the ledger. |

Detailed procedures, scoring anchors, and output schemas live in `prompts/01`–`prompts/08`. Those files implement this section; this section governs them.

### §3.2 Opinion artifacts — argument, never conclusion

Opinion is graded on whether the author reasoned honestly, never on whether the auditor agrees with where they landed. The dimensions: factual accuracy of premises (no arguing from false facts), logical validity, steel-manning (engaging the strongest version of the opposing position, not a strawman), explicit separation of fact from interpretation, disclosure of priors and conflicts, definitional precision, and originality versus restatement of talking points. **The system never scores an opinion's conclusion.** A column the operators find politically repugnant can earn 90; a column they cheer can earn 30. If that never happens, see P5.

### §3.3 Cross-cutting, time-resolved dimensions

These attach to authors and publications rather than single artifacts, and they resolve over time: the predictive track record (the ledger, graded by P7's calibration multiplier as reality arrives), correction behavior (speed, prominence, and whether corrections themselves mislead), independence and disclosure (the public exposure file: holdings, donations, prior employment, prior public commitments), and epistemic humility as a measured pattern across the corpus.

---

## §4. Scoring Philosophy

**Balance sheet, not deficit ledger.** Pure infraction-counting cannot distinguish careful work on hard topics from sloppy work on easy ones, and it cannot reward good practice. Each dimension has a direction: penalty-only (headline mismatch — you cannot beat accurate), credit-only (primary-source linking — affirmative good practice earns), or bidirectional. Findings record strengths as well as failures.

**The 0–100 anchors.** 50 is not the average article; 50 is a meaningfully concerning article. The expected mean for competent professional journalism is 70–85.

| Band | Meaning |
|------|---------|
| 90–100 | Exemplary; affirmative best practice visible |
| 75–89 | Solid; minor issues at most |
| 60–74 | Acceptable with noticeable concerns |
| 40–59 | Significant problems |
| 20–39 | Severe; the dimension is materially failed |
| 0–19 | The dimension is essentially abandoned |

**Weights are documented, versioned, and capped.** Aggregation weights are public constants in the codebase, versioned with the methodology. No single dimension may dominate an aggregate — gaming one dimension must not rescue an artifact, and failing one must not condemn it alone.

**Ceiling mechanics.** `final_score = min(raw_weighted_score, knowability_ceiling)`. When the ceiling binds, that fact is flagged in the output. The ceiling derives from the artifact's verifiability-in-principle, never from its topic's political sensitivity.

**Confidence stacking.** The aggregate is never more confident than its weakest contributing module, degraded further by any module failures. Pipeline uncertainty compounds; it does not average away.

**Shrinkage for small samples.** Rolled-up scores for low-volume subjects are pulled toward the population mean: `shrunk = (n/(n+k))·raw_mean + (k/(n+k))·population_mean`, with k ≈ 10 as the starting constant. The shrinkage factor applied is published with every rollup. A raw three-article mean is never presented as a stable reputation.

---

## §5. Time and Truth

The score-at-publication is preserved forever (P9). The current score lives beside it, and the delta between them is a first-class published artifact — an article that published at 78 and now sits at 61 tells a story the system must not hide.

Artifacts with resolvable claims are re-evaluated on a standing cadence — on the order of 30 days, 6 months, and 2 years after publication — and whenever a dispute, resolution, or methodology version-bump touches them.

**The prediction ledger is the compounding asset.** Predictions are extracted at audit time and resolved later — months or years later, possibly by a different auditor than extracted them. Resolutions are evidence-bound (P3) and disputable like everything else. From resolved predictions, the system computes per-author and per-publication calibration by hedge level, which feeds P7's multiplier. Nothing else the system produces is as irrefutable as a multi-year ledger graded against reality, because it is the one dimension where the outsider holds exactly the same information as the insider: time.

---

## §6. Triage

Attention is the scarce resource. The queueing function is **consequence × suspicion × tractability**: how much the artifact matters (reach, policy footprint, narrative durability), how many surface red flags it shows (extraordinary claims, anonymous sourcing on contested matters, headline-body tension, deviation from — or implausible unanimity with — other coverage), and whether the auditor can actually evaluate it honestly.

Three standing watches run regardless of the formula: anniversaries (did the dire prediction land? did the reform deliver?), retraction-adjacent work (a correction implies questions about the rest of the beat), and uniform narratives (unanimity across the press without visible dissent is a red flag, not reassurance).

Be ruthless about tractability. Declining to audit what cannot be audited honestly is more valuable than producing weak work on it. Cheap surface scans run broadly; expensive external verification runs only on triaged-up artifacts.

---

## §7. Disputes, Corrections, Supersession

Anyone may challenge any finding, score, or resolution — with evidence. Challenges without evidence quotes or verifiable references are returned, not adjudicated.

Disputes are triaged by reviewers independent of the original auditor, with their own conflicts disclosed. Adjudications publish their full reasoning. An upheld dispute produces a **new** audit that supersedes the original; the original remains permanently visible with its lineage (P9). A rejected dispute remains visible too — the record of what was challenged and survived is part of the score's credibility.

The auditor's own errors are corrected with at least the speed and prominence the system scores journalists on. Every self-correction is logged in a permanent, public corrections record. This is not optional housekeeping; it is P10 made operational, and it is the difference between a standard and a weapon.

---

## §8. Auditing the Auditors

Auditor identity is first-class throughout the system: a model (provider, model, version), a human (signing key), a pipeline (named orchestration with a manifest hash), or a consensus (constituent auditors enumerated). Every score, extraction, resolution, and adjudication carries its auditor.

Everyone who exercises judgment inside the system — verifiers, auditors, adjudicators — is scored on the same epistemic axes as the journalists they evaluate. Weight follows track record: contributors whose findings hold up gain influence; those whose findings collapse lose it. This symmetric application is the structural defense against brigading, ideological capture, and crowd-quality decay, and it is the only arrangement under which the system has earned the right to grade anyone.

Methodology is versioned. Stored audits remain valid under the methodology version that produced them; rescoring under a new version is explicit, attributed, and creates new lineage — never a silent recalculation.

---

## §9. Engineering Principles Derived From the Philosophy

These follow deductively from §1; an implementation that violates them violates the principles behind them.

**Content addressing.** The identity of an artifact is the hash of its normalized text. The URL is metadata. A stealth edit creates a new artifact, a new lineage, and a diff that is itself a finding. (P4, P9)

**Module independence.** Each dimension's results are stored, versioned, and recomputed independently. A methodology improvement to one module never silently invalidates or recalculates the others. (P9, §8)

**Mandatory finding fields.** Every persisted finding carries verbatim evidence quotes, auditor identity, methodology version, timestamp, confidence, and caveats. A record missing any of these is rejected at the persistence boundary, not patched downstream. (P1, P3, §2)

**Machine-readable first.** The canonical layer is structured data; human-readable reports are rendered from it, never the reverse. Anything that exists only as prose cannot be aggregated, disputed, or reproduced. (P12)

**Reproducible rollups.** Dossier snapshots are caches. The canonical truth is the underlying audits, and any third party must be able to re-derive every snapshot from public data using the published methodology. (P12)

**No silent mutation.** Append-only semantics everywhere, regardless of the storage engine. Supersession links, never UPDATE-in-place on published judgments. (P9)

**Decentralized publication preferred.** Signed, queryable, relay-distributed events (NOSTR in X-Ray's case) over a central scoreboard authority. The system's claims should be verifiable even if the system's operators disappear or defect. (P10, P12)

---

## §10. Red Lines

The system must never:

1. Average away disagreement between auditors into a single consensus number (P8).
2. Score an opinion piece's conclusion rather than its argument (§3.2).
3. Claim or imply verification that was not performed (P11, §2).
4. Erase, overwrite, or silently mutate any published score, finding, or resolution (P9).
5. Apply different standards by political valence, or tune weights to reach a desired outcome for any target (P5).
6. Penalize hard-knowability beats relative to their tractability class, or let easy beats coast (P6).
7. Publish a finding without verbatim evidence from the artifact (P3).
8. Hide weights, methodology versions, confidence values, or the known-unknowns log (P12).
9. Allow a single dimension to determine an aggregate score (§4).
10. Exempt the auditor, its operators, or its contributors from any standard applied to journalists (P10, §8).

A proposed feature that requires crossing a red line is not a feature; it is a different, worse system.

---

## §11. Decision Heuristics for Agents

When an implementation choice is ambiguous and this document does not resolve it directly, prefer, in order:

1. **Transparency over convenience.** If hiding something makes the build easier, don't.
2. **Evidence over inference.** When a finding could rest on a quote or on a model's impression, require the quote.
3. **Preserving history over cleanliness.** Ugly lineage beats tidy erasure, always.
4. **Under-claiming over coverage.** A narrower, defensible output beats a broader, fragile one.
5. **Reproducibility over performance.** A slower pipeline a stranger can re-run beats a fast one only we can.
6. **Symmetric treatment over situational nuance.** If a special case would apply differently across the political spectrum, reject the special case.
7. **Bounded confidence over impressive precision.** A score of "71 ± 8" is better engineering than "73.4".
8. **The reader's ability to verify over the system's ability to assert.** Every output should hand the reader the means to check it.

When two of these conflict, document the tension, cite this section, and choose the option that best preserves the reader's ability to audit the system itself.

---

## §12. Glossary

**Artifact** — the exact published text being audited, identified by content hash. **Atomization** — decomposing an artifact into discrete, individually evidenced claims. **Knowability ceiling** — the maximum score achievable given how verifiable the artifact's central claims are in principle. **Calibration multiplier** — the scoring adjustment that prices confidence: confident-wrong costs more than hedged-wrong, confident-right earns more than hedged-right. **Vintage** — the preserved score-at-publication, as distinct from the current score. **Shrinkage** — pulling small-sample rolled-up scores toward the population mean, with the applied factor published. **Supersession** — replacing a judgment by issuing a new one linked to the old, never by editing the old. **Exposure file** — the public record of an author's, publication's, or operator's relevant financial, political, and relational interests. **Known-unknowns log** — the published record of what could not be checked: unverifiable claims, declined comments, denied documents. **Evidence quote** — a verbatim excerpt from the artifact that grounds a finding; the unit of proof. **Auditor identity** — the attributed agent (model, human, pipeline, or consensus) behind every judgment in the system.

---

## §13. Amendment Log

Amendments to this document require: a version bump, a dated entry below, a written rationale, and — for any removal or weakening of a principle or red line — an explicit statement of what failure mode the change accepts. Silent edits to this document violate P9 and are void.

**v1.1.0 — 2026-07-22. Concord amendment.** This document's self-description changes from "the constitution of the X-Ray Epistemic Auditor" to the **organic statute of the audit family under `docs/CONSTITUTION.md`**. Rationale: two normative spines had grown in the repo — this document's estimated-score-with-ceiling and `TRUTH_ADJUDICATION_DESIGN.md` §1's measurements-never-estimations — with every post-Phase-15 design citing an unwritten bundle of both as "the epistemic constitution." The constitution writes that bundle down, adopts P2–P5 and P8–P12 as project-wide law verbatim, and harmonizes the spines via its Art. 5 (which licenses this document's score exactly as TRUTH_ADJUDICATION §1 always had). No principle, dimension, or red line is altered; P-numbering remains canonical project-wide. Accepted failure mode (§13 requirement): audit-family law can henceforth be overridden by a document written later than it — mitigated because the constitution adopts the universal principles verbatim and `tests/constitution-guards.test.mjs` pins the concord from both sides.

**v1.0.0 — 2026-06-11.** Initial codification. Twelve principles, eight news dimensions, opinion rubric, scoring philosophy, time/truth mechanics, triage, dispute process, auditor-of-auditors, engineering derivations, red lines, decision heuristics.

---

## Credo

A scoring system that pretends to omniscience destroys its own credibility on first failure. A system that publishes its uncertainty, its disagreements, its revisions, and its blind spots — and treats those as features rather than embarrassments — is the only kind that survives contact with reality.

An outsider with full transparency, modest claims, and a published method beats an insider with privileged access and unstated priors — not on any single story, but over the body of work, on every timescale that matters. That is the only game the outsider can win. It is also the only game worth playing.

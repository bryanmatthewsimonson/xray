# The Founding Transcript

**Document version:** 1.1.0
**Status:** Source material — non-normative
**Date packaged:** 2026-07-23
**Vendored:** `docs/FOUNDING_TRANSCRIPT.md`, 2026-08-02 — the framing sections (including the supersession log below) are maintained in-repo; the transcript body stays verbatim-frozen.

This is the verbatim record of the first three exchanges of the conversation that produced the X-Ray Epistemic Auditor. It predates every artifact in this repository: `PHILOSOPHY.md`, the prompt suite, the schema, the scorer, and all subsequent review-question (RQ1–RQ8) decisions. Claude Code has previously referenced "the unrecovered philosophy prose" — this is that prose.

---

## Provenance and how to read it

The three exchanges are reproduced exactly as written, including typos, double spaces, and conversational asides. The only mechanical edit: headers inside the responses are demoted one level (`##` → `###`) so this document's own structure stays navigable. Nothing else was altered.

Two of the exchanges are written in personas. Exchange 1 speaks as an alternate-universe editor-in-chief running a fully-resourced newsroom; Exchange 2 speaks as that figure's younger self, an outsider with no access and no budget. Read the personas as rhetorical vehicles for the standards, not as literal system requirements — the newsroom machinery of Exchange 1 (pre-publication red-team memos, two staff fact-checkers per article) describes the ideal the system approximates, while Exchange 2 describes the constraint set X-Ray actually operates under. Exchange 3 drops the frame and turns to deployment; it is the direct ancestor of the current architecture.

## Precedence rule

**Where this transcript conflicts with `PHILOSOPHY.md` (v1.0.0+) or the answered review questions, the later documents govern.** This transcript's value is intent, rationale, and mechanisms the codified documents compressed or dropped — not authority.

One known supersession, flagged so it is not accidentally "integrated": Exchange 3's pitfalls section suggests *"opaque weights on edge dimensions"* as an anti-gaming measure. `PHILOSOPHY.md` P12 and §4 deliberately reject this — all weights are published and versioned, and the anti-gaming defense is multi-dimensionality plus methodology versioning, never opacity. If other conflicts of this kind surface during integration, resolve them the same way and log them here.

### Supersession log

- **2026-07-23 (packaging):** *Opaque weights on edge dimensions* (Exchange 3) — superseded by `PHILOSOPHY.md` P12/§4, flagged above. Verified in code: `MODULE_WEIGHTS` are frozen, public, in-repo, and republished inside every aggregate event.
- **2026-08-02 (maintainer rulings, integration round):** The newsroom persona was a derivation device — X-Ray is a solo research tool, and mechanisms that only make sense inside a newsroom are superseded, not pending:
  - **Volatility metric** (Exchange 1) — dropped. A newsroom scoreboard statistic; scores attach to published text that is not expected to change.
  - **Standing re-evaluation cadence, 30d/6m/2y** (Exchange 1) — dropped in favor of event-driven re-evaluation; `PHILOSOPHY.md` §5 amended (v1.1.0).
  - **Adversarial / red-team reviewer** (Exchanges 1 + 3) — dropped as audit machinery; the falsifiability discipline lives on in the forensic family's mandatory counter-read.
  - **The auditor's own public dossier as a standing surface** (Exchange 2) — dropped; `PHILOSOPHY.md` P10 narrowed (v1.1.0). Anyone can audit the auditor with the same published method.
  - **Reach weighting in canonical aggregation** (Exchange 1) — demoted to an optional display view; the canonical rollup stays reach-blind, paired with a low-visibility view (low reach is itself a signal worth reading).
  - **Triage queue** (Exchange 2) — parked, not superseded: potentially useful as researcher guidance; the current workflow does not fit it.

## The integration mandate

X-Ray is now substantially more mature than when the original deliverables were drafted. The task this document supports: **audit the current implementation against this source prose.** For each mechanism in the mining checklist below, determine whether it is (a) codified and implemented, (b) codified but unimplemented, or (c) never codified at all. Produce an integration map proposing slices for the (b) and (c) items, citing `PHILOSOPHY.md` principles by number, and flag any place where the mature product has drifted from both this prose and the codified documents. Do not assume any item's status — several were partially recovered during the RQ round (accessibility tiers in RQ3, the calibration multiplier in RQ4), and the current codebase may have moved since.

## Mining checklist

Mechanisms present in this prose, to verify against the current implementation. These are verification targets, not status claims.

**From Exchange 1:**

1. **The opinion rubric as a discrete scoring tree** — premise accuracy, logical validity, steel-manning, fact/interpretation separation, disclosure, originality, definitional precision. The prompt suite (`prompts/01`–`08`) is news-only; opinion modules were never built. Likely the largest unmined item.
2. **Volatility metric** — expected future score movement, published alongside confidence ("Score: 71 ± 8, volatility: high"). Absent from the schema.
3. **Vintage display** — score-at-publication versus current score, with the delta as a first-class published artifact. Schema supports it; does the portal surface it?
4. **Known-unknowns log as a system artifact** — unverifiable claims, declined comments, documents requested and denied, with credit for asking. P12 names it; is there an entity or kind for it?
5. **Re-evaluation cadence scheduler** — 30 days / 6 months / 2 years. `PHILOSOPHY.md` §5 mandates it; is anything automated?
6. **Reviewer meta-patterns** — which auditors score harsh or lenient, on which beats, published. `AuditorDisagreement` exists in the schema; the analytics layer on top of it may not.
7. **Reach weighting and difficulty normalization in aggregation** — a wire story seen by ten million weighs more; hard beats normalized by tractability class. Never carried into the scorer or rollups.
8. **The adversarial reviewer** — a red-team pass that identifies the weakest claim, published alongside the audit. Maps to a multi-auditor adversarial mode.

**From Exchange 2:**

9. **The triage queue** — consequence × suspicion × tractability, with suspicion computable from surface features. `PHILOSOPHY.md` §6 states the formula; is there an implementation?
10. **The three standing watches** — anniversaries, retraction-adjacent stories, uniform narratives.
11. **The triangulation layer** — side-by-side divergence mapping across outlets covering the same event; the divergences are the diagnostic.
12. **Wire-copy detection** — similarity comparison yielding an independent-reporting count, because apparent fifty-outlet corroboration is often one wire story.
13. **Corpus sampling methodology** — defined corpus, random n≈30, blind scoring against the rubric, producing defensible outlet-and-beat-level claims. No schema entity exists for a sampled corpus audit.
14. **Correction-trail capture and correction scoring** — corrections themselves scored on speed, prominence, and whether they further mislead. The dossier has a corrections summary; is anything capturing correction events?
15. **The auditor's own public dossier** — self-scored outputs, the auditor's own prediction ledger and corrections log. P10 operationalized as a running surface, not just a principle.

**From Exchange 3:**

16. **The six-layer architecture as a maturity checklist** — ingestion → atomization → surface scans → external checks → aggregation/persistence → public surface. Layer 4 (primary-source fetch-and-compare, cited-study verification) was explicitly deferred in the prototype and is the biggest unbuilt layer.
17. **Dimension direction typing** — penalty-only / credit-only / bidirectional, encoded in the schema and aggregation math rather than living only as prose inside the prompts.
18. **The cheap accessibility tiers** — Read and Flag (Verify/Audit/Adjudicate were deferred post-v1 per RQ3). What is the status of the two cheap tiers?
19. **Cost tiering** — cheap surface scans run on everything; expensive external checks run only on triaged-up artifacts.

---
---

# The Transcript

## Exchange 1 — The rubric

**Founder:**

> You are the editor in chief of the most prestigious national daily periodical in the world in an alternate universe where journalistic standards have not only continued to be given the utmost respect, but where they have gotten even more transparent and mandatory. If William Randolph Hearst became a legend of yellow journalism, you are his equal or greater opposite. You have set the standard for truth, evidence, and transparency.
>
> You need a scoring rubrik for each article. Those scores can aggregate by author, category, date,  publication, and even across publications (because the same transparent standard can be applied). These scores can be aggregated even across publications. They are the kind of standards that can be used to judge, fairly and accurately, the quality of any given piece of news or opinion. News versus opinion likely need their own discrete standards, but ideally end up with a score that can be aggregated accurately across time, author, publication, news category, subject/story, etc.
>
> You can point to a transparent scoreboard and tell the world how you stack up on, for example, Iran war news coverage, for example.
>
> The score accounts for factual accuracy, context, contradictions, and might go down if facts are found to be incorrect.
>
> How do you approach this problem? What information do you gather to ensure you can calculate the score? What processes do you follow? How do you account for the fact that you cannot possibly know everything all the time at once, and account for inevitable imperfections transparently?
>
> What are all the dimensions to judge by? Including but not limited to factual accuracy, transparency, sufficient context, politically unbiased language, quality/"nutritiousness", etc.

**Response:**

Stepping into the role: the hardest part of this isn't designing the rubric. It's designing a *self-correcting system* that earns trust over time. Any rubric that produces a static score on publication day is theater. The system has to do four things simultaneously: score what's knowable now, flag what isn't yet knowable, update as reality reveals itself, and expose its own machinery to public audit. Let me work through it in that order.

### The governing philosophy

Three commitments shape every other choice:

**Scores are probabilistic, not pronouncements.** Every score ships with a confidence interval and a "vintage" — the score-at-publication versus the score-as-of-today. A scoop on a developing story might publish at 78 ± 12, drift to 84 as sources corroborate, then slide to 61 if a key claim collapses. The trajectory is itself a published artifact.

**The unit of measurement is the claim, not the article.** An article is a vector of claims, each with its own provenance, verifiability, and post-hoc track record. Article scores roll up from claim scores. This is what makes the system auditable: anyone can challenge a single sentence rather than waving at "the piece."

**Transparency is asymmetric.** We disclose more than is comfortable. Confidence intervals, dissenting reviewer notes, anonymous source justifications (in redacted form), corrections history, and the financial/political exposures of every author and every owner are public, machine-readable, and versioned.

### Two rubrics, one scale

News and opinion need separate scoring trees because they make different claims on the reader. But both produce a normalized 0–100 score on a common axis: *how much should a rational reader update their beliefs based on this piece?* That's the comparable quantity.

#### News dimensions

These break into three families.

*Evidentiary integrity* covers factual accuracy of every discrete claim, source quality (primary > secondary > tertiary; documented > on-record > anonymous-with-justification > anonymous-without), source diversity (no single-source stories on contested matters), verifiability (can a reader retrace the work from cited materials), and contradiction handling (were countervailing facts surfaced or buried).

*Contextual adequacy* covers historical context (is the event situated in its real lineage), statistical context (are numbers given denominators, base rates, error bars), comparative context (similar events, similar policies), and what I'd call "selection transparency" — disclosure of what was left out and why. A story about a single shocking statistic without the trend line is failing this dimension even if every word is true.

*Presentational fidelity* covers headline-to-body match (the single most-cheated dimension in real journalism), language neutrality (loaded verbs, asymmetric epithets, framing choices), image and chart honesty (truncated y-axes, cherry-picked stills), and sequencing (is the most important fact buried in paragraph fourteen).

#### Opinion dimensions

Opinion gets graded on *argument*, not *conclusion* — we never score whether the author was "right" politically; we score whether they reasoned honestly.

The dimensions: factual accuracy of premises (you don't get to argue from false facts), logical validity (formal and informal fallacy detection), steel-manning of the opposition (did the author engage the strongest version of the counter-position or a strawman), distinguishing fact from interpretation (clear typographical or rhetorical signals), disclosure (priors, conflicts, financial exposures, prior public commitments to this position), originality versus restatement (rehashed talking points score lower than novel synthesis), and definitional precision (loaded terms — "inflation," "freedom," "violence" — are explicitly defined or scored down).

#### The cross-cutting dimensions that apply to both

*Independence and disclosure* — every author has a public exposure file: financial holdings relevant to the beat, political donations, prior employment, family relationships. The article inherits its author's exposure context.

*Correction behavior* — how prominently and quickly errors are acknowledged, with corrections themselves scored (a buried, vague correction scores worse than a top-of-article one).

*Predictive track record* — when a piece makes implicit or explicit predictions, those are logged and graded over time. This is what gives opinion writers a *long-run* score independent of any single column.

*Epistemic humility* — does the piece acknowledge what it doesn't know? Hedged claims that turn out wrong cost less than confident claims that turn out wrong, and confident claims that turn out right earn more than hedged claims that turn out right. This calibration metric is the single most important defense against bullshit.

### The information we gather

For each article in the system, we maintain: the full text with every claim atomically tagged; the source ledger (every cited document, interview transcript, dataset, with hashes); the editorial trail (who edited, what was changed, what was challenged internally); the author's exposure file at time of writing; reviewer scoring sheets from at least two independent fact-checkers plus an adversarial "red-team" reviewer assigned to find the weakest claim; reader and expert challenges submitted post-publication; and a continuously updated "claim status" table — confirmed, disputed, refuted, superseded, unresolved.

### The process, in order

Pre-publication: every claim is tagged and assigned a verification status. The piece doesn't run until every claim is at least *attested* (sourced) and the contested ones are at least *corroborated* (multiple independent sources). The red-team reviewer files a public memo identifying the weakest link in the piece — this memo publishes alongside the article. Two fact-checkers score independently; their disagreement is itself a published metric.

At publication: initial score with confidence interval. The confidence interval widens on fast-moving stories and narrows on retrospectives.

Post-publication: a standing challenge mechanism. Any reader can flag a claim with evidence. Flags are triaged by an independent review desk (rotating, conflicts disclosed). Adjudications publish with reasoning. Score updates apply retroactively with timestamped audit trail — the *original* score is never erased; you see the full history.

Time-decay: scores re-evaluate at 30 days, 6 months, 2 years. A piece that looked solid at publication but where the central claim collapsed gets marked accordingly, with a permanent visible delta from its publication score.

### Handling the limits of our own knowledge

This is the part most "trust scores" get wrong. We can't know everything, so we publish what we can't know.

Every article carries a **knowability score** — an honest estimate of how verifiable its central claims are *in principle* given current evidence. A piece on yesterday's congressional vote has high knowability. A piece on classified intelligence assessments has low knowability and the score is bounded accordingly: you literally cannot earn a 95 on a piece whose core claims rest on three anonymous sources, no matter how carefully written.

Every score includes a **volatility metric** — how much has this score moved since publication, and how much do we expect it to move. Readers see "Score: 71 ± 8, volatility: high (developing story)."

Every aggregation publishes the **shrinkage factor** — small samples (a new author with three articles) get pulled toward the population mean to prevent flukes. An author with 500 articles gets her real average; an author with five gets a weighted estimate.

We publish a standing **known unknowns log**: claims we cannot currently verify, parties who declined to comment, documents we requested and were denied. This is itself a metric — a piece that asked the right questions and was stonewalled gets credit for asking; a piece that didn't ask is penalized.

And critically: **reviewer disagreement is published**. If our two fact-checkers gave a piece 82 and 64, the reader sees both, and sees the meta-pattern — which reviewers tend to score harshly, which leniently, which on which beats. The judges are themselves judged.

### Aggregation across author, beat, time, publication

Aggregation is weighted by article reach (a wire story seen by ten million matters more to the public record than a back-page item), normalized by subject-matter difficulty (foreign intelligence beats are inherently lower-knowability than municipal budgets — we don't punish reporters for working hard problems), and shrunk for sample size. Cross-publication comparison works because the rubric is published, the data is open, and any third party can reproduce the calculation.

The scoreboard for "Iran war coverage, March 2026" is just: every article tagged to that beat in that window, scored on the same dimensions, aggregated by publication and author, with each score showing its full audit trail. We can be wrong. We expose how we could be wrong. And when someone proves us wrong, the system updates and shows that it updated.

The deepest design principle is this: a scoring system that pretends to omniscience destroys its own credibility on first failure. A system that publishes its uncertainty, its disagreements, its revisions, and its blind spots — and treats those as features rather than embarrassments — is the only kind that can survive contact with reality.

---

## Exchange 2 — The outsider

**Founder:**

> That definitely demonstrates why you are such a legendary editor-in-chief. But it wasn't always this way. You used to be younger, and intent on changing the world before the world met you. You first got your start by trying to hold journalists accountable. The lack of quality news and opinion set you on a mission to change the world, and you did it. But before you did it, you needed to make your best attempt at judging the quality of other authors, publications, etc AFTER the story was already published. Obviously you couldn't investigate every story, but you worked hard to apply the best available standards as judged by an outsider to the process after it has already been published.
>
> How would you have approached this problem? Given limited attention, how would you have identified which stories to assign more human focus and will? To the best of your ability, how would you attempt to apply those same journalistic standards as an outsider?

**Response:**

Looking back at that period, the work resolved into three problems I had to solve in sequence: the **triage problem** (what's worth looking at), the **technique problem** (what I could actually detect from the outside), and the **credibility problem** (why anyone should listen to a critic with no press credentials and no insider access). I got worse before I got better, mostly because I assumed the hardest part was the analysis. It wasn't. The hardest part was the discipline of applying my own standards to myself before applying them to anyone else.

### The shift in posture

The first thing I had to internalize: I wasn't a fact-checker, I was an *epistemic auditor*. A fact-checker re-reports the story. I couldn't re-report — no one was returning my calls. What I could do was examine the published artifact for what it revealed about the process behind it. A well-reported story leaves a clean trail in the prose itself; a sloppy or motivated story leaves fingerprints. My job was to learn to read the fingerprints.

The second realization: most articles can't be deeply checked, and that's fine. The goal isn't to verify every claim in journalism. The goal is to produce a *fair, reproducible, and proportionate* signal about quality, with full disclosure of my own confidence. A surface scan with documented methodology is better than a deep dive on cherry-picked targets.

### Triage: where to spend the limited attention

I built a queueing system based on a simple product: *consequence × suspicion × tractability*.

**Consequence** is how much the story matters — measured by reach (citations, social spread, picked-up-by-other-outlets), policy footprint (was it cited in legislation, court filings, official statements), and durability (one-day story versus narrative-shaping). Coverage that becomes the lens through which a public issue is understood deserves more attention than a story that vanishes by Tuesday.

**Suspicion** is detectable a priori from surface features: extraordinary claims, anonymous sourcing on contested matters, headline-body tension visible at a glance, deviation from how other outlets covered the same event, or unanimity across outlets where unanimity seems implausible (groupthink is as much a red flag as outliers).

**Tractability** is whether I personally could meaningfully evaluate it. A story resting on classified intelligence I can't access is low tractability. A story resting on a public dataset, a court filing, or a peer-reviewed paper is high tractability. I learned to be ruthless about my own limits — passing on stories I couldn't audit honestly was more valuable than producing weak work on stories I couldn't really check.

I also kept a permanent watch on three categories regardless of the formula: anniversary moments (was the dire prediction right? did the reform deliver?), retraction-adjacent stories (a publication just corrected something — what does that imply about the rest of their work on this beat?), and *uniform narratives* across the press. When everyone agrees with no visible dissent, something is usually being missed, and the outsider is the only person positioned to notice.

### Surface techniques that work without insider access

A surprising amount can be evaluated from the article alone, before you ever touch a primary source.

**Headline-body fidelity.** Read the headline, write down what it implies. Then read the body and ask whether the implications hold. The most reliably-cheated dimension in journalism, and detectable in thirty seconds.

**Asymmetric language scan.** When a piece describes two sides of a conflict, are the verbs and adjectives parallel? Does one side "claim" while the other "explains"? Does one "lash out" while the other "responds"? Asymmetric framing is almost always invisible to the writer and visible to a reader scanning for it.

**Number hygiene.** Every numerical claim gets three questions: what's the denominator, what's the base rate, what's the comparison class? "Crime up 40%" without a denominator, base period, or category breakdown is a failed claim regardless of whether the number is technically accurate. Most numbers in news fail at least one of these three.

**Source quality audit.** Count the named sources, anonymous sources, primary documents, and "experts say"-style attributions. Note which contested claims rest on which kinds of sources. A contested claim resting solely on anonymous attribution from one side of the dispute is a structural failure visible from the prose.

**Internal coherence.** Does paragraph three contradict paragraph eleven? Do the numbers in the chart match the numbers in the text? Does the lede make a claim the article never substantiates? Internal inconsistency is the cheapest signal there is.

**The omission test.** Who is *not* quoted? On a piece about a labor dispute that quotes only management, the omission is the story. On a piece about a regulation that quotes only industry critics, same. The pattern of who gets the microphone is more revealing than what they say.

**Definitional sleight-of-hand.** Contested terms — "violence," "extremist," "expert," "inflation," "moderate" — are often quietly assumed in ways that prefigure the conclusion. Marking every contested term and asking whether it's defined or smuggled is one of the highest-yield exercises.

**The primary source rule.** When an article cites a study, a document, or a speech, find it. Read it. Compare what it actually says to how it's characterized. This single practice — and the willingness to publish the comparison verbatim — produced more of my early credibility than any analysis I wrote.

### Cross-publication and longitudinal techniques

For high-priority stories, I ran two more passes.

**Triangulation.** Pull every major outlet's version of the same event, lay them side by side, and identify where they diverge. The divergences are the diagnostic. When five outlets report different death tolls, different sequences of events, or different motivations from the same press conference, at least four of them are getting something wrong — and which ones are systematically over- or under-stating tells you about their priors.

**Wire-copy versus original reporting.** A surprising fraction of "different" coverage is the same wire copy reframed. Detecting this matters because it means apparent corroboration across outlets is illusory. The actual count of independent reporting on a story is often one or two, even when fifty publications run a piece.

**The prediction ledger.** Every article that makes implicit or explicit predictions gets logged with the testable claim and the resolution date. Six months later, twelve months later, you go back and grade. This is enormously powerful because it's the one dimension where the outsider has the same information as the insider — reality, in time, reveals who was right. A publication's prediction track record is something I could publish and defend with full rigor.

**The correction trail.** I read corrections systematically. Corrections are revealing in three ways: what kinds of errors does this outlet make, how prominently are they acknowledged, and how often does the correction itself further mislead? A back-page two-line correction for a front-page false claim is its own data point.

### Author and publication track records

I built dossiers, with the same standards I'd want applied to me. For each author or publication on a beat I covered seriously: their corpus of relevant work, their named recurring sources, their predictions and how those resolved, their public conflicts of interest from financial disclosures and prior employment, and their pattern of corrections. I scored individual articles, but the more durable claim was always at the author and outlet level — single articles vary; patterns are diagnostic.

I used statistical sampling rather than trying to read everything. A defined corpus (e.g., "all front-page Iran coverage from outlet X in 2003"), a random sample of n=30, scored blind against the rubric, produces a defensible claim about the outlet's coverage of that beat. Sampling is the outsider's superpower — it lets you make rigorous claims about a body of work without the impossible task of exhaustive review.

### The credibility problem, which is really a discipline problem

This is the part younger me got wrong for a long time. I thought the work would speak for itself. It didn't. What earned credibility was the *unilateral* application of my own standards to my own work, harder than I applied them to others.

I published my methodology before I published my findings. I published my own conflicts of interest, my priors, my prior public commitments on the topics I was auditing. I included the strongest steel-manned defense of every piece I criticized, in the critic's own preferred framing, before laying out the critique. When I got something wrong — and I did, frequently, early on — I corrected with the same prominence as the original claim and logged it permanently. I tracked my own prediction ledger publicly. I let people grade me on the same rubric I graded others on, and I published their grades.

I also learned to *under-claim*. Most of what I could honestly say was modest: "this article shows surface markers of low-quality work in dimensions X, Y, Z; I have not been able to verify the substantive claims directly." That kind of bounded, honest assessment ended up far more durable than the sweeping condemnations I wanted to write. Sweeping condemnations get attacked on their weakest point and collapse. Bounded, methodical assessments compound.

### The leverage that built over time

What none of this looked like, in the early years, was prestigious. It was tedious, lonely, and easy to dismiss. The leverage came from compounding: a prediction ledger gets more powerful every year it runs; a correction trail becomes undeniable when it's three years long; a methodology that anyone can reproduce becomes a standard rather than an opinion. I wasn't building arguments — those get rebutted. I was building a public record that other people could verify themselves.

The line I came back to, when I was tired and underfunded and the targets of my work were openly mocking me: an outsider with full transparency, modest claims, and a published method beats an insider with privileged access and unstated priors over a long enough timeframe. Not on any single story. Over the body of work. That's the only game the outsider can win, and it's the only game worth playing.

---

## Exchange 3 — Making it real

**Founder:**

> Great! Now we need to make the epistemic auditor a real thing. How can I deploy an epistemic auditor agent? Is there a scoring system that I can use to keep track of scores of authors, publications, etc? Is it just keeping an accurate count of various "infractions" that you outlined above? How do we make epistemic auditing more accessible to the masses?

**Response:**

The shift from theory to deployment changes the engineering calculus in three places: most surface-level checks are now machine-tractable in a way they weren't five years ago, persistence and aggregation are the real work (not the per-article scoring), and the hardest problem becomes auditing the auditor — making the system itself trustworthy enough that its scores carry weight.

Here's how I'd actually build it.

### The architecture, in layers

**Layer 1 — Ingestion.** URL fetching, clean text extraction, metadata capture (author, publication, date, headline, byline, last-modified, archive snapshot). Hash and store the article verbatim so future score updates are anchored to the exact text scored, not a silently-edited version. This is non-negotiable; outlets stealth-edit constantly and you need an immutable reference.

**Layer 2 — Atomization.** The article gets decomposed into a structured representation: each factual claim tagged separately, each quote attributed, each number extracted with its context, each source identified and classified (named-primary, named-secondary, anonymous-with-justification, anonymous-bare, document-cited, expert-says-vague). Predictions are extracted into a separate ledger with resolution dates if computable. This atomization is the hardest part to get right and the most valuable artifact — once you have the article as structured claims, every downstream check becomes tractable.

**Layer 3 — Surface scans.** A set of specialized LLM-driven checks, each producing a structured output with a score, evidence, and confidence:

- *Headline-body fidelity*: the model is given the headline alone and asked what it implies; then given the body and asked whether the implications hold. Mismatch is scored.
- *Asymmetric language detection*: identify parties in conflict, extract verbs and adjectives applied to each, flag asymmetric framing.
- *Number hygiene*: every numerical claim gets the denominator/base-rate/comparison-class test.
- *Source quality audit*: count and classify; flag contested claims resting on inadequate sourcing.
- *Internal coherence*: contradiction detection across the article.
- *Definitional audit*: contested terms identified, marked as defined or undefined.
- *Omission test*: who is quoted, who is referenced but not quoted, who is conspicuously absent given the topic.

Each runs as an independent module with its own prompt, output schema, and tunable weighting. Run them in parallel.

**Layer 4 — External checks.** Web search and fetch to verify primary sources cited in the piece (does the study actually say what they claim it says?), triangulate against other coverage of the same event, and detect wire-copy reuse via similarity comparison. This layer is more expensive and slower; it runs only on triaged-up pieces.

**Layer 5 — Aggregation and persistence.** Article scores roll up to author and publication and beat. Persistent dossiers track every article scored, every prediction logged, every correction issued. Statistical shrinkage applied to small-sample authors. Time-decay handled (a 5-year-old piece gets a knowability-at-time-of-writing score *and* a knowability-now score).

**Layer 6 — Public surface.** Scoreboard, individual article reports, author/publication pages, prediction ledger results as they resolve, and — critically — the audit trail for every score showing exactly which checks triggered which deductions or credits.

### The scoring system: balance sheet, not deficit ledger

Pure infraction-counting fails for a structural reason: it can't distinguish a careful piece on a hard topic from a sloppy piece on an easy topic, and it has no way to *reward* good practice. You need a balance sheet.

Each dimension produces three things: a score in a bounded range, a direction (penalty-only, credit-only, or bidirectional), and a confidence. *Headline-body mismatch* is penalty-only — you can lose points but not gain them. *Primary source linking* is credit-only — you gain points for actually citing and linking the underlying document. *Source diversity*, *language neutrality*, *contextual adequacy* are bidirectional. The article score aggregates these with documented weights.

Two further mechanics that matter:

**The knowability ceiling**, mentioned earlier, applies here too. An article on a topic that's structurally hard to verify gets its maximum achievable score capped — so a careful piece on classified intelligence might max at 75 and earn 72, while a careful piece on a public budget might max at 95 and earn 91. Both are excellent within their tractability, and the dossier rolls them up correctly.

**The calibration multiplier.** Confident claims that turn out wrong cost more than hedged claims that turn out wrong. Confident claims that turn out right earn more than hedged claims that turn out right. This is the single mechanism that most reliably distinguishes honest journalists from confident bullshitters over time, and it falls out naturally once you have the prediction ledger running.

So the answer to "is it just counting infractions" is no — it's a credit-and-debit system with confidence intervals, knowability ceilings, and a calibration multiplier that rewards epistemic humility.

### Aggregation and the dossier model

Author dossier: every scored article, time-series of scores, prediction track record with hit rate, correction history, recurring named sources, beat distribution, public conflicts-of-interest from external registries (donations, holdings, prior employment where available). Score with shrinkage — a new author with three articles gets pulled toward the population mean until the sample grows.

Publication dossier: same but rolled up across authors, with additional dimensions like correction-prominence patterns, headline-body fidelity at the institutional level (which is often an editor-driven failure, not a writer-driven one), and wire-copy ratio.

Beat dossier: cross-publication scoring on a defined topic. This is where the system produces its highest-value outputs — "Iran war coverage scoreboard, all major US outlets, last 90 days, methodology X" is the kind of artifact that earns durable influence.

### Making it accessible — tiers of participation

The system has to be useful to people who never contribute, and it has to invite the contributors who can scale it. Five tiers:

*Read.* Anyone can browse scoreboards, look up authors, check articles. Free, public, no account.

*Flag.* Logged-in users can flag a published article for audit, with a one-line reason. Flags feed the triage queue.

*Verify.* Users can claim a single open task — "verify whether this study supports this claim" — and submit a finding with evidence. Each finding is itself scored over time; verifiers build their own track record.

*Audit.* Trained or vetted users can complete full audits of articles using the published methodology. Audits are public, attributed, and reviewable.

*Adjudicate.* When auditors disagree, a higher-trust adjudication layer resolves with reasoning. Adjudicators are themselves graded.

The crucial design choice: **reviewers are scored on the same epistemic axes as journalists.** Verifiers who turn out wrong over time lose weight; those who turn out right gain weight. This is the mechanism that prevents brigading, ideological capture, and crowd-quality decay. Same standards applied symmetrically — which is the only way the system earns the right to grade anyone.

### What to build first

A defensible MVP, in order:

1. **Ingestion + atomization + surface scans** for a single article via paste-URL. Output a structured report with each dimension scored and explained. This alone is useful and can ship in weeks.

2. **Persistent storage and dossier rollups** for authors and publications. Now you can show "this is the third time this author has had a headline-body mismatch flag this quarter."

3. **Prediction ledger** as a separate product — extract predictions from articles, log resolution dates, grade as reality unfolds. This is the highest-leverage long-term asset because it produces irrefutable retrospective evidence.

4. **External verification layer** with search and primary-source comparison. Triage which articles get this treatment based on the consequence × suspicion × tractability formula.

5. **Public dashboards and crowd participation tiers.**

6. **Browser extension** for in-context scoring as users read.

A practical stack: an LLM API for the per-claim work, a vector store for similarity and cross-coverage matching, a structured database for dossiers, a search/fetch layer for external checks, and a static-rendered public site for the scoreboards. Per-article cost matters once you scale, so the cheap surface scans run on everything submitted, and the expensive external checks run only on triaged-up pieces.

### The pitfalls worth naming up front

The auditor will be wrong sometimes. Build in confidence intervals on every score, human review for high-stakes findings, and a public correction process for the auditor's own errors. The methodology doc must be public, versioned, and reproducible — not a black box. Apply your own published standards to your own work and publish those scores too; this is the move that earns the right to grade others.

Adversaries will try to game it. Mitigated by multi-dimensional scoring (gaming one dimension hurts another), opaque weights on edge dimensions, and methodology updates. Don't let any single dimension dominate the aggregate score.

Defamation exposure is real if scores are wrong. Stick to evidence-based, citation-backed findings. The system should be able to point to specific sentences in specific articles for every score component.

Political capture is the existential threat. The only defense is symmetric application — the auditor must score outlets across the political spectrum on the same dimensions, and must publish scores that hurt every camp. If your scoreboard is uncomfortable for everyone, you're probably calibrated.

---

*End of transcript. Subsequent exchanges in the founding conversation produced the prompt suite, schema, scorer prototype, `PHILOSOPHY.md`, and the RQ1–RQ8 decisions — all of which supersede this document where they conflict with it.*

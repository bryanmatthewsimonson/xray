// Office: the Editor-in-Chief (editor) — docs/PERSONAS.md §3.
// X-Ray — vendored per-module audit methodology prompts.
//
// GENERATED, verbatim, from docs/auditor-prototype/prompts/01-08 (the
// instruction portion before each file's "# ARTICLE" marker — exactly the
// CLI scorer's loadPrompt() slice). The extension can't read docs/ at
// runtime, so the per-module ("thorough") auditor vendors them here. These
// are the SAME methodology the findings schemas were derived from; the
// single-shot orchestrator uses a condensed summary instead.
//
// To regenerate after editing a prompt: node tools/gen-module-prompts.mjs
//
// Imported only by the background service worker (the audit runner), so it
// never weighs down the reader bundle.

export const MODULE_PROMPTS = Object.freeze({
    headline_body_fidelity:
`# Module 01 — Headline-Body Fidelity

**Purpose:** Determine whether the article's headline (and subhead, if present) accurately previews the body's actual content with proportional emphasis. This is the single most-cheated dimension in modern journalism and is detectable in seconds from the published artifact alone.

**Input:** Article markdown including headline, subhead (if any), byline, and body.

**Output:** A single JSON object, no preamble or fences.

---

You are an epistemic auditor performing a Headline-Body Fidelity check on a news article.

# Methodology

1. **Read the headline (and subhead) ALONE.** Do not look at the body yet. List every claim or implication a reasonable reader would take from the headline. Categorize each as factual, causal, evaluative, or predictive. Mark whether the implied strength is definite, likely, or hedged.

2. **Now read the body.** For each headline implication, locate the supporting (or contradicting) text and quote it exactly. If support is absent, say so.

3. **Score each implication's support status:** \`supported\`, \`partially_supported\`, \`unsupported\`, or \`contradicted\`.

4. **Identify structural issues:**
   - Buried qualifications (key hedge appears in paragraph 8+)
   - Inverted emphasis (the actual lead fact is buried)
   - Clickbait framing (headline poses a question or makes a claim the body cannot deliver)
   - Implicit-actor switching (headline ascribes action to one party, body reveals another)
   - Tense or modality drift (headline asserts what body says was alleged, expected, or possible)

5. **Compute an overall fidelity score 0–100:**
   - **90–100:** Every implication is fully supported with proportional emphasis.
   - **75–89:** Minor mismatches; small hedge gaps or proportional emphasis quibbles.
   - **60–74:** Noticeable gaps; the headline overstates or compresses meaningfully.
   - **40–59:** Significant mismatches; a careful reader of the body would not write this headline.
   - **20–39:** Severe; the headline materially misleads.
   - **0–19:** The headline contradicts or has no relationship to the body's actual claims.

6. **Confidence (0.0–1.0):** Lower confidence if the body is truncated, paywalled, or relies on visual/multimedia content you cannot evaluate.

# Output

Return only this JSON, no preamble, no markdown fences:

\`\`\`json
{
  "module": "headline_body_fidelity",
  "version": "1.0",
  "headline": "<exact headline>",
  "subhead": "<exact subhead or null>",
  "headline_implications": [
    {
      "id": 0,
      "implication": "<what a reader takes from the headline>",
      "type": "factual" | "causal" | "evaluative" | "predictive",
      "implied_strength": "definite" | "likely" | "hedged"
    }
  ],
  "body_findings": [
    {
      "implication_id": 0,
      "support_status": "supported" | "partially_supported" | "unsupported" | "contradicted",
      "evidence_quote": "<exact quote from body, or null>",
      "notes": "<1-2 sentence assessment>"
    }
  ],
  "structural_issues": [
    {
      "type": "buried_qualification" | "inverted_emphasis" | "clickbait_framing" | "actor_switching" | "modality_drift" | "other",
      "description": "<what was found>",
      "evidence_quote": "<exact quote>",
      "severity": "low" | "medium" | "high"
    }
  ],
  "score": 0-100,
  "confidence": 0.0-1.0,
  "confidence_notes": "<what limits confidence>",
  "auditor_caveats": ["<things this surface scan cannot determine>"]
}
\`\`\`

---`,

    asymmetric_language:
`# Module 02 — Asymmetric Language Detection

**Purpose:** Detect framing asymmetry — different verbs, adjectives, or rhetorical treatment applied to comparable parties or actions. This is almost always invisible to the writer and detectable to a reader scanning for it.

**Input:** Article markdown.

**Output:** A single JSON object, no preamble or fences.

---

You are an epistemic auditor performing an Asymmetric Language check on a news article.

# Methodology

1. **Identify the parties.** List every named party, faction, country, institution, or movement that appears in adversarial, contrasting, or comparable roles within the article. (If there is no contrast structure, the article scores 100 by default.)

2. **For each party, extract the language applied to them:**
   - Verbs (especially of action, speech, and motivation)
   - Adjectives and adjectival phrases
   - Epithets, labels, or category terms (e.g., "extremist," "moderate," "experts," "officials")
   - Sourcing verbs ("said," "claimed," "explained," "alleged," "admitted")

3. **Compare the language across parties for asymmetry on these dimensions:**
   - **Action verbs:** Does one party "lash out" while the other "responds"? Does one "attack" while the other "defends"? Does one "claim" while the other "explains"?
   - **Motivation attribution:** Are motives assigned to one party but not the other? Is one party's behavior explained while the other's is treated as self-evidently bad?
   - **Epithets and labels:** Is one side labeled with a contested term (e.g., "extremist," "radical") while the other gets a neutral term (e.g., "activist," "advocate")?
   - **Sourcing verbs:** Does one party "say" while the other "claims" or "alleges"?
   - **Visibility of agency:** Is one party's action described in active voice ("X attacked Y") while another's is described in passive voice ("Z were killed")?
   - **Quantitative framing:** Are similar numbers framed differently for different parties (e.g., "only" vs "as many as")?

4. **Score 0–100:**
   - **90–100:** Symmetric or essentially symmetric treatment. Any small asymmetries are explainable by the actual asymmetry of the events.
   - **75–89:** Minor asymmetries; possibly unintentional word choice.
   - **60–74:** Noticeable patterns; multiple asymmetric word choices in the same direction.
   - **40–59:** Systematic asymmetric framing visible across multiple dimensions.
   - **20–39:** Severe; the article reads as advocacy through word choice.
   - **0–19:** Pure rhetorical framing; the language alone tells the reader who to side with.

5. **Confidence (0.0–1.0):** Lower confidence on articles where there is genuinely asymmetric reality being reported (e.g., reporting on a confirmed atrocity by one party). Asymmetric language can be appropriate when the underlying facts are asymmetric.

# Important caveat

Asymmetry in language is not always wrong. If party A has been convicted of a crime and party B has not, different verbs may be appropriate. The standard is *unjustified* asymmetry — language choices that pre-stage a conclusion the article has not earned through evidence. Note when asymmetry tracks established fact versus when it simply tilts the framing.

# Output

Return only this JSON:

\`\`\`json
{
  "module": "asymmetric_language",
  "version": "1.0",
  "has_contrast_structure": true | false,
  "parties_identified": [
    {
      "name": "<party name>",
      "role": "<their role in the contrast>"
    }
  ],
  "language_applied": [
    {
      "party": "<party name>",
      "verbs": ["<verb 1>", "<verb 2>"],
      "adjectives": ["<adj 1>"],
      "epithets_or_labels": ["<label 1>"],
      "sourcing_verbs": ["<verb>"]
    }
  ],
  "asymmetry_findings": [
    {
      "dimension": "action_verbs" | "motivation_attribution" | "epithets" | "sourcing_verbs" | "voice_agency" | "quantitative_framing",
      "party_a": "<name>",
      "party_a_term": "<word/phrase>",
      "party_b": "<name>",
      "party_b_term": "<word/phrase>",
      "evidence_quote_a": "<exact quote>",
      "evidence_quote_b": "<exact quote>",
      "justified_by_underlying_facts": true | false,
      "justification_notes": "<if justified, why>",
      "severity": "low" | "medium" | "high"
    }
  ],
  "score": 0-100,
  "confidence": 0.0-1.0,
  "confidence_notes": "<what limits confidence>",
  "auditor_caveats": ["<things this scan cannot determine>"]
}
\`\`\`

---`,

    number_hygiene:
`# Module 03 — Number Hygiene

**Purpose:** Audit every numerical claim in the article against three tests: does it have a denominator (where ratio matters), a base rate (for comparison to background), and a comparison class (versus what)? Most numbers in news fail at least one.

**Input:** Article markdown.

**Output:** A single JSON object, no preamble or fences.

---

You are an epistemic auditor performing a Number Hygiene check on a news article.

# Methodology

1. **Extract every numerical claim** in the article body. This includes:
   - Counts and totals ("400 people attended")
   - Percentages and ratios ("up 40%")
   - Dollar/currency amounts
   - Dates and timeframes used as evidence
   - Comparisons ("twice as many," "the largest in a decade")
   - Probabilities and forecasts
   - Survey/poll results
   - Rankings and rates

2. **For each numerical claim, apply three tests:**

   - **Denominator test:** When the claim is a count or change, is the relevant total or population provided? "400 arrests" without "out of how many encounters" or "compared to how many last year" fails this test. "400 of 1,200 protests resulted in arrests" passes.

   - **Base rate test:** Is the historical or contextual baseline provided? "Crime up 40%" without prior years' levels, the long-run trend, or the absolute number fails. "Crime up 40% from a 30-year low" passes (and is a different story).

   - **Comparison class test:** Is the comparison set defined and appropriate? "The largest in a decade" — largest *what*, in *which* category, by *which* measure? "$2 billion in damages — comparable to the 2018 fires which caused $X billion" passes; "$2 billion — a staggering sum" fails.

3. **Note additional issues where present:**
   - Cherry-picked timeframe (start/end dates chosen to maximize the apparent change)
   - Survivorship bias (sample excludes relevant cases)
   - Causation implied without evidence ("after X policy, Y rose")
   - Precision mismatch (precise numbers reported with vague sourcing)
   - Conflation of stocks and flows
   - Aggregation hiding distribution (averages without ranges; totals without per-capita)

4. **Score 0–100:**
   - **90–100:** Numbers consistently contextualized with appropriate denominators, base rates, and comparisons.
   - **75–89:** Most numbers contextualized; minor gaps.
   - **60–74:** Mixed; some numbers well-handled, others bare.
   - **40–59:** Most numerical claims fail at least one test.
   - **20–39:** Numbers used rhetorically, with little context.
   - **0–19:** Numbers function purely as emotional triggers; no numerate reader could derive meaning from them.

5. **Confidence (0.0–1.0):** Lower if the article relies heavily on charts or tables you cannot evaluate.

# Important note

Not every number needs all three tests. A weather report saying "high of 78°F" needs no denominator. Apply the tests only where they are *relevant* to the claim's interpretive weight. The judgment call is whether a numerate reader could be misled by what's missing.

# Output

Return only this JSON:

\`\`\`json
{
  "module": "number_hygiene",
  "version": "1.0",
  "numerical_claims": [
    {
      "id": 0,
      "claim": "<the claim as it appears in context>",
      "value": "<the number>",
      "context": "<short summary of what the number is purporting to demonstrate>",
      "denominator_test": "passed" | "failed" | "not_applicable",
      "base_rate_test": "passed" | "failed" | "not_applicable",
      "comparison_class_test": "passed" | "failed" | "not_applicable",
      "additional_issues": ["cherry_picked_timeframe", "implied_causation", "precision_mismatch", "..."],
      "evidence_quote": "<exact quote>",
      "notes": "<what's done well or missing>"
    }
  ],
  "summary": {
    "total_claims": <integer>,
    "claims_failing_at_least_one_test": <integer>,
    "most_common_failure": "denominator" | "base_rate" | "comparison_class" | "none"
  },
  "score": 0-100,
  "confidence": 0.0-1.0,
  "confidence_notes": "<what limits confidence>",
  "auditor_caveats": ["<things this scan cannot determine>"]
}
\`\`\`

---`,

    source_quality:
`# Module 04 — Source Quality Audit

**Purpose:** Count and classify every source the article uses; identify contested claims that rest on inadequate sourcing; check whether anonymous sourcing is justified and whether primary documents (when cited) are linked or quoted.

**Input:** Article markdown.

**Output:** A single JSON object, no preamble or fences.

---

You are an epistemic auditor performing a Source Quality audit on a news article.

# Methodology

1. **Identify every source the article relies on.** A "source" is anyone or anything providing factual claims, including:
   - Named individuals quoted or paraphrased
   - Anonymous individuals (with or without justification)
   - Documents (court filings, government reports, leaked memos)
   - Studies and data (peer-reviewed, working papers, datasets)
   - Other media outlets (cited or republished)
   - Vague attributions ("experts say," "officials told reporters," "according to people familiar with the matter")

2. **Classify each source** into one of these categories:
   - \`named_primary\` — Named, directly involved, on the record (e.g., a quoted official with relevant authority)
   - \`named_secondary\` — Named, but commenting on events they were not directly part of (e.g., academics, analysts)
   - \`anonymous_justified\` — Anonymous with stated justification ("granted anonymity to discuss internal deliberations") AND with the source's relationship to the matter described
   - \`anonymous_bare\` — Anonymous with no justification or only a vague description
   - \`document_cited\` — Specific document referenced; ideally linked or quoted
   - \`study_cited\` — Specific study referenced; ideally with author, journal, date
   - \`expert_says_vague\` — Group attributions without specific individuals ("experts say," "many believe")

3. **Map sources to the claims they support.** For each major factual claim in the article, identify which sources back it.

4. **Identify single-sourced contested claims.** A "contested claim" is any claim that:
   - Other parties named in the article would likely dispute
   - Concerns motivation, intent, or private knowledge
   - Concerns events the source was not directly party to
   - Is presented as fact but is reasonably subject to dispute

   Single-sourcing such claims (especially via anonymous or vague sources) is a serious sourcing failure.

5. **Evaluate anonymous sourcing justification.** When sources are anonymous, the article should say *why* anonymity was granted (e.g., "because they were not authorized to speak publicly") and describe the source's relationship to the matter ("a senior official at X department"). Bare anonymity ("a source said") fails this standard.

6. **Evaluate primary source linking.** When the article cites documents, studies, or data, are they linked, quoted, or specifically identified such that a reader could retrieve them? Or are they characterized only by the article's framing?

7. **Score 0–100:**
   - **90–100:** Sources are predominantly named and primary; anonymous sourcing is sparse, justified, and described; documents are linked or quoted; contested claims are multi-sourced.
   - **75–89:** Mostly named sourcing; anonymous sources justified; some documents linked.
   - **60–74:** Mixed; reliance on \`expert_says_vague\` or unjustified anonymous sourcing in non-contested areas.
   - **40–59:** Multiple contested claims rest on anonymous or vague sourcing without justification.
   - **20–39:** Article essentially built on anonymous sourcing or single-sourced contested claims.
   - **0–19:** No identifiable sourcing for major claims, or sources presented in ways that prevent reader verification.

8. **Confidence (0.0–1.0):** Lower confidence on stories where anonymous sourcing may be genuinely necessary (national security, internal corporate matters, personal safety) and where the underlying sourcing quality is unverifiable from the article alone.

# Output

Return only this JSON:

\`\`\`json
{
  "module": "source_quality",
  "version": "1.0",
  "sources": [
    {
      "id": 0,
      "label": "<short identifier, e.g., 'unnamed senior official' or 'Sarah Chen, professor at MIT'>",
      "type": "named_primary" | "named_secondary" | "anonymous_justified" | "anonymous_bare" | "document_cited" | "study_cited" | "expert_says_vague",
      "anonymity_justification": "<exact quote, or null if not anonymous>",
      "relationship_to_matter": "<as described in article>",
      "evidence_quote": "<exact quote where source is introduced>"
    }
  ],
  "claim_to_source_map": [
    {
      "claim": "<the factual claim>",
      "source_ids": [0, 2],
      "is_contested": true | false,
      "contested_reason": "<why this claim is disputable, or null>",
      "evidence_quote": "<exact quote>"
    }
  ],
  "single_sourced_contested_claims": [
    {
      "claim": "<the claim>",
      "source_id": 0,
      "source_type": "anonymous_bare" | "named_secondary" | "...",
      "evidence_quote": "<exact quote>"
    }
  ],
  "primary_documents": [
    {
      "document": "<what document>",
      "linked_or_quoted": true | false,
      "specific_enough_to_retrieve": true | false,
      "evidence_quote": "<exact quote>"
    }
  ],
  "summary": {
    "total_sources": <integer>,
    "named_count": <integer>,
    "anonymous_count": <integer>,
    "anonymous_justified_count": <integer>,
    "expert_says_vague_count": <integer>,
    "documents_cited": <integer>,
    "documents_specifically_identified": <integer>
  },
  "score": 0-100,
  "confidence": 0.0-1.0,
  "confidence_notes": "<what limits confidence>",
  "auditor_caveats": ["<things this scan cannot determine, e.g., 'cannot verify the actual quality of anonymous sources from the article alone'>"]
}
\`\`\`

---`,

    internal_coherence:
`# Module 05 — Internal Coherence

**Purpose:** Detect contradictions and inconsistencies within the article itself — between paragraphs, between text and any embedded data references, between framing and evidence. Internal incoherence is the cheapest signal of editorial sloppiness or motivated framing.

**Input:** Article markdown.

**Output:** A single JSON object, no preamble or fences.

---

You are an epistemic auditor performing an Internal Coherence check on a news article.

# Methodology

1. **Read the full article carefully**, building a mental model of every factual, causal, and evaluative claim.

2. **Look for contradictions of these types:**

   - **Factual contradiction:** Two statements that cannot both be true. ("The protest had 5,000 attendees." Later: "The crowd of several hundred...")
   - **Numerical contradiction:** Numbers that don't reconcile. (Sum of subgroup totals doesn't match the stated total; percentages add to more than 100; chart caption disagrees with text.)
   - **Causal contradiction:** Cause-and-effect chains that conflict. ("X happened because of Y." Later: "Z, which began before Y, caused X.")
   - **Tonal/evaluative contradiction:** Different emotional or evaluative framings of the same event in different parts of the article.
   - **Modality contradiction:** Claim asserted as fact in one place and as allegation, possibility, or denial in another.
   - **Quote-paraphrase contradiction:** A direct quote that doesn't support the article's paraphrase or characterization of it.
   - **Caption-text contradiction:** Image or chart captions that contradict the body text.
   - **Lead-body contradiction:** The lede frames the story one way; the body's content supports a different (often more nuanced or contrary) framing.

3. **Look for logical inconsistencies even without direct contradiction:**
   - Conclusions that don't follow from the evidence presented
   - Claims that prove too much or too little
   - Premises that, if true, would undermine the article's framing

4. **Distinguish genuine contradiction from intentional dialectic.** A piece that fairly presents two opposing views and notes the conflict is not internally incoherent — that's the article doing its job. A piece that asserts both views as its own factual frame is.

5. **Score 0–100:**
   - **90–100:** Internally coherent throughout; any tensions are explicitly flagged and contextualized.
   - **75–89:** Minor inconsistencies; possibly editing artifacts.
   - **60–74:** Noticeable contradictions or logical gaps that a careful reader would catch.
   - **40–59:** Multiple significant inconsistencies; framing not supported by article's own content.
   - **20–39:** Severe; the article's own evidence contradicts its conclusions.
   - **0–19:** The article actively confuses or misleads through internal contradiction.

6. **Confidence (0.0–1.0):** Lower confidence on long articles, articles relying heavily on charts/images you cannot evaluate, or articles in highly technical domains where apparent contradiction may reflect specialized usage.

# Output

Return only this JSON:

\`\`\`json
{
  "module": "internal_coherence",
  "version": "1.0",
  "contradictions": [
    {
      "type": "factual" | "numerical" | "causal" | "tonal" | "modality" | "quote_paraphrase" | "caption_text" | "lead_body",
      "claim_a": "<first claim>",
      "claim_b": "<contradicting claim>",
      "evidence_quote_a": "<exact quote>",
      "evidence_quote_b": "<exact quote>",
      "is_dialectic_intent": true | false,
      "severity": "low" | "medium" | "high",
      "notes": "<short explanation>"
    }
  ],
  "logical_gaps": [
    {
      "description": "<the gap>",
      "evidence_quote": "<exact quote>",
      "severity": "low" | "medium" | "high"
    }
  ],
  "score": 0-100,
  "confidence": 0.0-1.0,
  "confidence_notes": "<what limits confidence>",
  "auditor_caveats": ["<things this scan cannot determine>"]
}
\`\`\`

---`,

    definitional_precision:
`# Module 06 — Definitional Precision

**Purpose:** Identify contested terms used in the article and check whether they are defined or smuggled. Undefined contested terms quietly prefigure conclusions; defining them forces the writer to make explicit what would otherwise be assumed.

**Input:** Article markdown.

**Output:** A single JSON object, no preamble or fences.

---

You are an epistemic auditor performing a Definitional Precision check on a news article.

# Methodology

1. **Identify contested terms** the article uses to characterize events, parties, or concepts. A term is "contested" when reasonable people disagree about what it means or when it applies. Examples:

   - **Political/social:** "extremist," "moderate," "radical," "mainstream," "fringe," "patriot," "insurgent," "terrorist," "freedom fighter," "activist," "advocate"
   - **Action-characterizing:** "violence," "peaceful protest," "riot," "uprising," "crackdown," "intervention," "invasion"
   - **Epistemic authority:** "expert," "scientist," "researcher," "official," "spokesperson"
   - **Quantitative-sounding but vague:** "many," "most," "few," "some," "widespread," "rare," "growing," "declining"
   - **Economic:** "inflation," "recession," "growth," "stimulus," "austerity," "free market," "regulation"
   - **Identity:** "left," "right," "progressive," "conservative," "liberal" (these mean different things in different contexts)
   - **Technical:** Any specialized term used without definition in a piece for general readers

2. **For each contested term, check:**
   - Is the term defined in the article (explicitly or via clear context)?
   - If defined, is the definition appropriate and disclosed (rather than buried)?
   - If not defined, what assumption is being smuggled? (e.g., calling a group "extremist" without definition assumes the reader shares the writer's threshold for that label.)
   - Is the term used consistently? Or does its meaning shift across the article?

3. **Look for "weasel quantifiers"** — words like "many," "some," "growing," "increasingly" — that imply quantitative claims without quantitative evidence. These should be backed by numbers or scoped explicitly.

4. **Look for category laundering** — using a contested category as if it were a settled one. ("Misinformation," "hate speech," "election denier," "national security threat" are often used this way.)

5. **Score 0–100:**
   - **90–100:** Contested terms are defined, scoped, or sourced. Weasel quantifiers are backed.
   - **75–89:** Most contested terms handled; minor smuggling.
   - **60–74:** Several contested terms used without definition; some load-bearing for the article's frame.
   - **40–59:** Contested terms central to the article's claims are not defined.
   - **20–39:** Article's frame depends on contested terms used as if settled.
   - **0–19:** The article is built on smuggled definitions; without them, its conclusions evaporate.

6. **Confidence (0.0–1.0):** High by default for this dimension — definitions are surface-detectable. Lower if the article is highly technical and you may be misjudging which terms are contested in that field.

# Important caveat

Not every word is contested. A piece on baseball using "shortstop" without definition is fine. Apply this lens only to terms whose meaning is *load-bearing* for the article's claims and where reasonable readers would diverge on application.

# Output

Return only this JSON:

\`\`\`json
{
  "module": "definitional_precision",
  "version": "1.0",
  "contested_terms": [
    {
      "term": "<the term>",
      "occurrences": <integer>,
      "first_use_quote": "<exact quote of first use>",
      "defined_in_text": true | false,
      "definition_quote": "<exact quote, or null>",
      "definition_quality": "explicit" | "contextual" | "absent",
      "smuggled_assumption": "<what is assumed when the term is used undefined, or null>",
      "load_bearing": true | false,
      "used_consistently": true | false,
      "severity_if_undefined": "low" | "medium" | "high"
    }
  ],
  "weasel_quantifiers": [
    {
      "term": "<e.g., 'many', 'growing', 'most'>",
      "evidence_quote": "<exact quote>",
      "backed_by_evidence": true | false,
      "severity": "low" | "medium" | "high"
    }
  ],
  "category_laundering": [
    {
      "category": "<the contested category>",
      "evidence_quote": "<exact quote>",
      "treatment": "<how the article treats it as if settled>",
      "severity": "low" | "medium" | "high"
    }
  ],
  "score": 0-100,
  "confidence": 0.0-1.0,
  "confidence_notes": "<what limits confidence>",
  "auditor_caveats": ["<things this scan cannot determine>"]
}
\`\`\`

---`,

    omission:
`# Module 07 — Omission Test

**Purpose:** Identify who is quoted, who is referenced but not given voice, and who is conspicuously absent given the article's topic. The pattern of who gets the microphone is often more revealing than what they say.

**Input:** Article markdown.

**Output:** A single JSON object, no preamble or fences.

---

You are an epistemic auditor performing an Omission Test on a news article.

# Methodology

1. **Catalog the voices that appear in the article:**
   - **Directly quoted:** Anyone whose words appear in quotation marks (with attribution).
   - **Paraphrased:** Anyone whose position is summarized by the article ("X said that...").
   - **Referenced but silent:** Parties named or alluded to but not given voice (e.g., "company representatives did not respond" or simply absent).
   - **Implicit:** Stakeholders whose existence is implied by the topic but who are not named.

2. **Identify the topic's natural stakeholder set.** For any given news topic, there are roles that a balanced piece would normally include. Examples:

   - A story about a labor dispute should include workers, management, union representation (if any), and ideally an outside observer.
   - A story about a regulation should include the regulator, the regulated industry, the proponents (often advocacy groups or affected populations), and critics.
   - A story about a court ruling should include both sides' counsel, the court's reasoning, and ideally legal commentators not party to the case.
   - A story about a study should include the study's authors, methodology context, and outside experts capable of evaluating the work.
   - A story about a foreign policy decision should include the originating government, affected parties, and (where reachable) those most affected by the policy.
   - A story about a community impact should include members of that community, not only officials describing the community.

3. **Compare the catalog to the natural stakeholder set.** Identify roles that should plausibly be heard from but are absent. For each absence, note whether the article addresses why (e.g., "X declined to comment," "Y could not be reached," "the agency has not responded to requests for comment") or whether the absence is unexplained.

4. **Look for asymmetric quotation density.** Even when both sides are technically represented, count column-inches or quote-density given to each. Heavy imbalance can be a form of omission.

5. **Check for "speaks-for" omission.** When the article allows one party to characterize another party's position rather than quoting that party directly, this is a common omission pattern. ("Critics worry that X..." with no critic actually quoted.)

6. **Check for community-versus-officials omission.** Stories about communities (e.g., a neighborhood, a profession, an affected population) that quote only officials, experts, or institutional spokespersons fail this dimension.

7. **Score 0–100:**
   - **90–100:** Stakeholder set well-represented; quotation density roughly balanced; absences (if any) explicitly addressed.
   - **75–89:** Most stakeholders heard from; minor imbalance.
   - **60–74:** One or two important voices missing; or one perspective dominates the quote density.
   - **40–59:** Significant absences; the story tells one side substantively.
   - **20–39:** Severe; the story is essentially one-sided through omission.
   - **0–19:** Article presents a topic while excluding the parties most relevant to it.

8. **Confidence (0.0–1.0):** Lower confidence when you cannot identify the natural stakeholder set with high confidence (e.g., highly technical or jurisdiction-specific stories). Higher when the topic has well-understood stakeholder geometry.

# Important caveat

Not every story needs every voice. A breaking-news report 30 minutes after an event cannot include all stakeholders; an investigative piece months in development should. Calibrate expectations to the article's apparent reporting timeline and scope. Use the article's own framing of itself as a guide.

# Output

Return only this JSON:

\`\`\`json
{
  "module": "omission",
  "version": "1.0",
  "topic_summary": "<one sentence on what the article is about>",
  "voices_directly_quoted": [
    {
      "name_or_role": "<who>",
      "perspective_summary": "<short summary>",
      "quote_density": "high" | "medium" | "low",
      "evidence_quote": "<exact quote of one of their statements>"
    }
  ],
  "voices_paraphrased_only": [
    {
      "name_or_role": "<who>",
      "perspective_summary": "<short summary>",
      "evidence_quote": "<exact quote of paraphrase>"
    }
  ],
  "voices_referenced_but_silent": [
    {
      "name_or_role": "<who>",
      "absence_addressed": true | false,
      "absence_explanation": "<exact quote, or null>"
    }
  ],
  "natural_stakeholder_set": [
    "<role 1>",
    "<role 2>"
  ],
  "voices_expected_but_absent": [
    {
      "role": "<who would normally be heard from>",
      "why_expected": "<reason this voice is normally part of this kind of story>",
      "absence_addressed": true | false,
      "severity": "low" | "medium" | "high"
    }
  ],
  "speaks_for_instances": [
    {
      "speaking_party": "<who>",
      "spoken_for_party": "<whose position is being characterized>",
      "evidence_quote": "<exact quote>",
      "severity": "low" | "medium" | "high"
    }
  ],
  "quotation_balance_notes": "<observations about quote density across perspectives>",
  "score": 0-100,
  "confidence": 0.0-1.0,
  "confidence_notes": "<what limits confidence; e.g., 'unfamiliar with full stakeholder set in this jurisdiction'>",
  "auditor_caveats": ["<things this scan cannot determine, e.g., 'cannot verify whether absent voices were actually contacted'>"]
}
\`\`\`

---`,

    prediction_extraction:
`# Module 08 — Prediction Extraction

**Purpose:** Extract every testable prediction the article makes (explicit or implicit) for the long-term prediction ledger. Predictions are *not scored at extraction* — they are scored later when reality resolves them. This module produces the input to the ledger; over time, the ledger produces the most powerful retrospective evidence about an author or publication's calibration.

**Input:** Article markdown.

**Output:** A single JSON object, no preamble or fences.

---

You are an epistemic auditor extracting predictions from a news article for a long-term prediction ledger.

# Methodology

1. **Identify every claim in the article that makes a prediction about the future.** Predictions can be:

   - **Explicit:** "X will happen by Y date." "Experts predict Z." "Analysts expect..."
   - **Implicit:** Claims that, while not framed as predictions, presuppose future outcomes. (e.g., "The new policy will reduce emissions by 20%" — this asserts a future outcome.)
   - **Conditional:** "If X, then Y will follow." (Log both the condition and the predicted consequence.)
   - **Negative:** "Z is unlikely to happen." "There is no evidence Y will occur."
   - **Counterfactual-with-future:** "Without X, Y would have happened" combined with "now Y will not happen."

2. **For each prediction, capture:**

   - **The prediction itself** in clear, testable language.
   - **Type:** explicit, implicit, conditional, negative, counterfactual.
   - **Hedge level:** confident, hedged ("could," "might," "may," "is expected to"), or speculative ("some worry that," "it's possible").
   - **Source within the article:** Is the prediction made by the article's own voice, or attributed to a named source, or attributed vaguely ("experts say")?
   - **Resolution horizon:** When could this be resolved? An ISO date if computable; otherwise a description ("within the next 12 months," "by the next election," "unspecified").
   - **Resolution criteria:** What observable event or measurement would resolve this true or false? Be concrete.
   - **Tractability:** Is this prediction *in principle* resolvable from public information? (Some predictions about classified or private matters may never resolve publicly.)

3. **Do not score the predictions.** Resolution and scoring happen later. Your job is to make the prediction ledger entry as clear and verifiable-later as possible.

4. **Skip non-predictions.** Speculation framed as analysis ("X means we should think about Y") is not a prediction. Past-tense claims are not predictions. Statements about ongoing trends without a future-pointing component are not predictions.

# Guidance on hedge levels

- **Confident:** No hedge language. ("X will happen.")
- **Hedged:** Modal verbs or qualifiers. ("X could happen," "X is likely to happen," "X is expected to happen.")
- **Speculative:** Multiple layers of distance. ("Some worry that X might happen.")

The hedge level matters because the calibration multiplier in the eventual scoring rewards hedged-and-wrong less harshly than confident-and-wrong, and rewards confident-and-right more than hedged-and-right.

# Output

Return only this JSON:

\`\`\`json
{
  "module": "prediction_extraction",
  "version": "1.0",
  "predictions": [
    {
      "id": 0,
      "prediction": "<clear, testable statement of the prediction>",
      "type": "explicit" | "implicit" | "conditional" | "negative" | "counterfactual",
      "hedge_level": "confident" | "hedged" | "speculative",
      "attributed_to": "article_voice" | "named_source" | "vague_attribution",
      "attributed_source_name": "<name if attributed, or null>",
      "condition": "<for conditional predictions, the antecedent; null otherwise>",
      "resolution_horizon": "<ISO date if computable, else descriptive string>",
      "resolution_criteria": "<concrete, observable criteria>",
      "tractability": "publicly_resolvable" | "requires_private_info" | "ambiguous",
      "evidence_quote": "<exact quote from article>"
    }
  ],
  "summary": {
    "total_predictions": <integer>,
    "explicit_count": <integer>,
    "implicit_count": <integer>,
    "confident_count": <integer>,
    "hedged_count": <integer>,
    "speculative_count": <integer>,
    "publicly_resolvable_count": <integer>
  },
  "auditor_caveats": ["<e.g., 'some implicit predictions may have been missed'>"]
}
\`\`\`

---`,

});

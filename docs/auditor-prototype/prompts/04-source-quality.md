# Module 04 — Source Quality Audit

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
   - `named_primary` — Named, directly involved, on the record (e.g., a quoted official with relevant authority)
   - `named_secondary` — Named, but commenting on events they were not directly part of (e.g., academics, analysts)
   - `anonymous_justified` — Anonymous with stated justification ("granted anonymity to discuss internal deliberations") AND with the source's relationship to the matter described
   - `anonymous_bare` — Anonymous with no justification or only a vague description
   - `document_cited` — Specific document referenced; ideally linked or quoted
   - `study_cited` — Specific study referenced; ideally with author, journal, date
   - `expert_says_vague` — Group attributions without specific individuals ("experts say," "many believe")

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
   - **60–74:** Mixed; reliance on `expert_says_vague` or unjustified anonymous sourcing in non-contested areas.
   - **40–59:** Multiple contested claims rest on anonymous or vague sourcing without justification.
   - **20–39:** Article essentially built on anonymous sourcing or single-sourced contested claims.
   - **0–19:** No identifiable sourcing for major claims, or sources presented in ways that prevent reader verification.

8. **Confidence (0.0–1.0):** Lower confidence on stories where anonymous sourcing may be genuinely necessary (national security, internal corporate matters, personal safety) and where the underlying sourcing quality is unverifiable from the article alone.

# Output

Return only this JSON:

```json
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
```

---

# ARTICLE


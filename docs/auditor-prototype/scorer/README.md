# X-Ray Auditor — Prototype Scorer

Orchestrates the eight surface-scan modules in parallel against the Anthropic API and aggregates results into a final article score conforming to `schema/audit-types.ts`.

## Install

```bash
cd scorer
npm install
export ANTHROPIC_API_KEY=sk-ant-...
```

## CLI usage

```bash
# Minimal — markdown only
node scorer.js --input path/to/article.md

# With metadata file (recommended)
node scorer.js --input article.md --metadata article-meta.json --output audit.json

# Choose a different model
node scorer.js --input article.md --model claude-opus-4-7
```

Sample `article-meta.json`:

```json
{
  "source_url": "https://example.com/article",
  "headline": "Article headline as published",
  "subhead": "Optional subhead",
  "byline": "By Sample Reporter",
  "publication_id": "example-publication",
  "publication_date": "2026-05-06",
  "language": "en",
  "capture_method": "xray_extension"
}
```

## Programmatic usage

```javascript
import { scoreArticle, formatSummary } from "./scorer.js";

const result = await scoreArticle({
  markdown: articleText,
  metadata: { headline: "...", byline: "...", /* ... */ },
  model: "claude-sonnet-4-6",  // optional; this is the default
});

// result.aggregate.final_score        — number 0–100
// result.aggregate.knowability_ceiling — number 0–100
// result.aggregate.overall_confidence  — number 0.0–1.0
// result.module_results                — array of 8 ModuleResult objects
// result.predictions                   — array of PredictionEntry objects
// result.article                       — Article object with hash and metadata

console.log(formatSummary(result));
```

## Try it now

```bash
node example-usage.js
```

Runs the scorer against a sample article (intentionally containing several auditor-detectable issues — anonymous bare sourcing, weasel quantifiers, asymmetric language) and writes `sample-audit.json`.

## How it works

1. **Normalize and hash.** Article markdown is normalized (LF line endings, trimmed trailing whitespace, collapsed blank lines) and hashed with SHA-256. The hash anchors every downstream entity to the exact text scored.

2. **Parallel module dispatch.** All eight prompts (`prompts/01`–`prompts/08`) are loaded and dispatched as parallel API calls. Each returns structured JSON conforming to its module's output schema.

3. **JSON extraction with fallback.** The scorer tolerates non-conforming model output (preamble text, code fences) via progressive fallback parsing.

4. **Knowability ceiling derivation.** The ceiling is computed heuristically from the source-quality findings: heavy named sourcing and document-linking → high ceiling; bare anonymous sourcing → lower ceiling. Replace this with a dedicated module (or human input) for production.

5. **Weighted aggregation.** Scoreable modules combine using documented weights (`MODULE_WEIGHTS` in `scorer.js`). If a module fails, weights are renormalized across successful modules. Final score is capped at the knowability ceiling.

6. **Confidence stacking.** Overall pipeline confidence is `min(module_confidences) × (successful_modules / total_modules)`. Pipeline-level uncertainty stacks; the aggregate is never more confident than its weakest contributor.

7. **Predictions extracted.** Module 08's output is restructured into `PredictionEntry` records with `resolution_status: "open"`, ready to feed the long-term ledger when resolutions arrive.

## Tunable knobs

In `scorer.js`:

- `DEFAULT_MODEL` — default Anthropic model (`claude-sonnet-4-6`). Use `claude-opus-4-7` for higher quality at higher cost; `claude-haiku-4-5-20251001` for fast/cheap triage scoring.
- `DEFAULT_MAX_TOKENS` — output cap per module call. Increase for very long articles.
- `MODULE_WEIGHTS` — aggregation weights. Sum must remain 1.0.
- The knowability heuristic in `aggregate()` is the most opinionated piece. Read it, disagree with it, replace it.

## Cost note

Eight parallel calls per article. With `claude-sonnet-4-6` and a typical 1,500-word article, expect roughly 1–3 cents per audit at current pricing. With `claude-opus-4-7`, several times that. Cache aggressively in production: the article hash is the cache key, and a cached audit needs no recomputation unless the methodology version changes.

## Wiring into X-Ray

The X-Ray extension already produces normalized markdown (Readability + Turndown) and rich metadata. Two integration paths:

- **Background-worker invocation.** When a user invokes the auditor from the capture panel, the service worker calls a hosted scorer endpoint (a thin wrapper around `scoreArticle`) with the captured markdown + metadata. Result is rendered in the panel and optionally published as a NOSTR audit event (kind 30050/30051).

- **Local-first.** For users with their own API keys, the scorer can run entirely client-side from the extension's background worker. No server required. The trade-off: API key handling moves to the user, and parallel call latency depends on their network.

Either path produces results in the same `audit-types.ts` shape, so downstream NOSTR publishing, dossier rollups, and dispute mechanisms are identical.

## Limitations of this prototype

- **No JSON Schema validation.** Module outputs are trusted to match the documented shape. Production should validate via per-module JSON Schemas (one per module, derived from the prompt output specs).
- **No persistence layer.** Results are returned and optionally written to disk. Production needs a store (Postgres, IndexedDB, NOSTR relay) and dossier-rollup queries.
- **No dispute mechanism.** The schema includes `AuditDispute` but the scorer doesn't yet handle re-scoring on dispute resolution.
- **Single-auditor.** No multi-model consensus or human-in-the-loop. Production gains a lot from running the same article through Claude + GPT + a human and surfacing the disagreement.
- **Knowability heuristic is crude.** It uses only source-quality findings. A dedicated knowability module (or beat-specific lookup table) would be more defensible.

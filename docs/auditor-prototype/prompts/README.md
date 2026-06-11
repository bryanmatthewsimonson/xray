# Surface-Scan Prompt Suite

Eight surface-detectable dimensions of journalistic quality, plus a single-shot orchestrator. Each prompt is self-contained and returns structured JSON that the downstream scorer aggregates into a per-article report.

## Files

| File | Purpose |
|---|---|
| `00-orchestrator-single-shot.md` | Runs all dimensions in one prompt. Use for browser testing in Claude.ai. |
| `01-headline-body-fidelity.md` | Does the headline accurately preview the body? |
| `02-asymmetric-language.md` | Symmetric verb/adjective/framing across comparable parties? |
| `03-number-hygiene.md` | Denominator, base rate, comparison class on every number? |
| `04-source-quality.md` | Named vs anonymous; primary vs vague; contested claims sourced? |
| `05-internal-coherence.md` | Contradictions, logical gaps, lead-body mismatch? |
| `06-definitional-precision.md` | Contested terms defined or smuggled? |
| `07-omission.md` | Who was quoted, who was missing, who spoke for whom? |
| `08-prediction-extraction.md` | Extract testable predictions for the long-term ledger. |

## Quickstart — testing in Claude.ai (browser)

1. Open a new chat in claude.ai.
2. Open `00-orchestrator-single-shot.md`. Copy the whole file.
3. Paste into Claude.ai.
4. Below it, paste the article markdown you want audited. (X-Ray's article capture produces the exact format expected.)
5. Send. You'll get a single JSON report covering all dimensions.

For deeper focus on one dimension, use the individual module prompts (`01`–`08`) the same way.

## Why per-module prompts exist alongside the orchestrator

The orchestrator is convenient but compresses; running modules independently gives:

- **More careful per-dimension reasoning** (the model isn't context-juggling eight tasks).
- **Parallel execution** in the production scorer (eight API calls in parallel = roughly the latency of one).
- **Independent versioning.** When a module's methodology improves, only that module's score needs to be recomputed.
- **Resilience.** If one module's call fails, the others still produce findings.
- **Auditor diversity.** Different modules can be assigned to different model providers if you want cross-vendor cross-checks.

In production the scorer runs the eight individual modules in parallel and aggregates the result. The orchestrator is for browser testing and quick spot-checks.

## Output schema invariant

Every module returns JSON with at minimum:

```json
{
  "module": "<module_name>",
  "version": "<semver>",
  "score": 0-100,            // omitted by 08-prediction-extraction
  "confidence": 0.0-1.0,     // omitted by 08-prediction-extraction
  "auditor_caveats": [...]
}
```

This invariant lets the scorer aggregate uniformly and lets the dossier track per-module drift over time.

## Notes on calibration

- A score of 50 is *not* the average article — it's a meaningfully concerning article. The expected mean for competent journalism is in the 70–85 range.
- Confidence below 0.6 should be treated as "this dimension needs human review or additional evidence to score reliably."
- All findings must include `evidence_quote` — direct quotes from the article. This is what makes the audit auditable.

## Module versioning

Each module declares a `version` field. When you change a prompt's methodology, bump the version. Stored audit results retain their version, so dossiers can show "rescored under v1.2" history. This is essential for long-term trust in the scorer itself.

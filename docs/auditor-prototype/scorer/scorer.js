// =============================================================================
// X-Ray Epistemic Auditor — Prototype Per-Article Scorer
// =============================================================================
//
// Orchestrates the 8 surface-scan modules in parallel, validates each output,
// aggregates into a final article score with knowability ceiling, and writes
// the result as a JSON file conforming to schema/audit-types.ts.
//
// USAGE:
//   export ANTHROPIC_API_KEY=sk-ant-...
//   node scorer.js --input article.md --metadata meta.json --output audit.json
//
// Or programmatically:
//   import { scoreArticle } from "./scorer.js";
//   const result = await scoreArticle({ markdown, metadata });
//
// =============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, "..", "prompts");

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 8192;

// Module → aggregation weight. Must sum to 1.0 across scoreable modules.
// prediction_extraction does not produce a score; it feeds the ledger.
const MODULE_WEIGHTS = {
  headline_body_fidelity:   0.15,
  asymmetric_language:      0.15,
  number_hygiene:           0.10,
  source_quality:           0.20,
  internal_coherence:       0.10,
  definitional_precision:   0.10,
  omission:                 0.20,
};

// Module → prompt file. Filenames match the prompts/ directory layout.
const MODULE_PROMPTS = {
  headline_body_fidelity:   "01-headline-body-fidelity.md",
  asymmetric_language:      "02-asymmetric-language.md",
  number_hygiene:           "03-number-hygiene.md",
  source_quality:           "04-source-quality.md",
  internal_coherence:       "05-internal-coherence.md",
  definitional_precision:   "06-definitional-precision.md",
  omission:                 "07-omission.md",
  prediction_extraction:    "08-prediction-extraction.md",
};

const SCOREABLE_MODULES = Object.keys(MODULE_WEIGHTS);
const ALL_MODULES = Object.keys(MODULE_PROMPTS);

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

/**
 * Normalize markdown for stable hashing across captures.
 * - LF line endings
 * - Trim trailing whitespace per line
 * - Collapse runs of blank lines to a single blank line
 * - Trim trailing whitespace at end of file
 */
function normalizeMarkdown(md) {
  return md
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+$/g, "");
}

function sha256Hex(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Strip a JSON object out of an LLM response that might (despite instructions)
 * include preamble text or fenced code blocks. Throws if no valid JSON object
 * can be extracted.
 */
function extractJson(text) {
  const trimmed = text.trim();

  // Try direct parse first (the happy path).
  try {
    return JSON.parse(trimmed);
  } catch (_) {}

  // Strip ```json or ``` fences.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch (_) {}
  }

  // Find first { and last } and try the slice.
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try { return JSON.parse(trimmed.slice(first, last + 1)); } catch (_) {}
  }

  throw new Error("Could not extract JSON from model response");
}

/**
 * Load a prompt file from prompts/ and split it at the "# ARTICLE" marker
 * so we can inject the article content for the API call.
 */
async function loadPrompt(filename) {
  const fullPath = join(PROMPTS_DIR, filename);
  const content = await readFile(fullPath, "utf8");
  // Each module prompt ends with a "# ARTICLE" header followed by where the
  // article body should go. Everything before that is the system instructions.
  const articleMarker = /^#+\s*ARTICLE\s*$/m;
  const match = content.match(articleMarker);
  if (!match) {
    throw new Error(`Prompt ${filename} is missing the '# ARTICLE' marker`);
  }
  return content.slice(0, match.index).trim();
}

// -----------------------------------------------------------------------------
// Module runner
// -----------------------------------------------------------------------------

/**
 * Run a single module against the article. Returns a ModuleResult-shaped object.
 */
async function runModule({ client, model, module, articleMarkdown, articleHash }) {
  const promptInstructions = await loadPrompt(MODULE_PROMPTS[module]);

  const userMessage =
    promptInstructions +
    "\n\n# ARTICLE\n\n" +
    articleMarkdown;

  const startedAt = nowIso();
  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: DEFAULT_MAX_TOKENS,
      messages: [{ role: "user", content: userMessage }],
    });
  } catch (err) {
    return {
      module,
      module_version: "1.0",
      auditor: { kind: "model", id: `anthropic/${model}` },
      run_at: startedAt,
      score: null,
      confidence: null,
      findings: { error: err.message },
      evidence_quotes: [],
      auditor_caveats: [`API call failed: ${err.message}`],
      _error: true,
    };
  }

  const textBlocks = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  let parsed;
  try {
    parsed = extractJson(textBlocks);
  } catch (err) {
    return {
      module,
      module_version: "1.0",
      auditor: { kind: "model", id: `anthropic/${model}` },
      run_at: startedAt,
      score: null,
      confidence: null,
      findings: { error: err.message, raw_response: textBlocks },
      evidence_quotes: [],
      auditor_caveats: [`JSON parse failed: ${err.message}`],
      _error: true,
    };
  }

  return {
    article_hash: articleHash,
    module,
    module_version: parsed.version || "1.0",
    auditor: { kind: "model", id: `anthropic/${model}` },
    run_at: startedAt,
    score: typeof parsed.score === "number" ? parsed.score : null,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
    findings: parsed,
    evidence_quotes: collectEvidenceQuotes(parsed),
    auditor_caveats: parsed.auditor_caveats || [],
  };
}

/**
 * Walk a module's findings object and collect every `evidence_quote` field
 * into a deduplicated list for cross-module reference.
 */
function collectEvidenceQuotes(findings) {
  const quotes = new Set();
  function walk(node) {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if ((k === "evidence_quote" || k === "evidence_quote_a" || k === "evidence_quote_b") && typeof v === "string") {
        quotes.add(v);
      } else {
        walk(v);
      }
    }
  }
  walk(findings);
  return [...quotes].map((quote) => ({ quote }));
}

// -----------------------------------------------------------------------------
// Aggregator
// -----------------------------------------------------------------------------

/**
 * Combine module results into an AggregateAudit using documented weights and
 * the knowability ceiling. The ceiling is heuristically derived here from the
 * source_quality module's findings (publicly verifiable sources → high ceiling;
 * heavy anonymous/classified sourcing → lower ceiling). For production, derive
 * from a dedicated knowability module or human input.
 */
function aggregate({ articleHash, moduleResults, model }) {
  const byModule = Object.fromEntries(moduleResults.map((r) => [r.module, r]));

  // Estimate knowability ceiling from source_quality findings.
  const sourceResult = byModule.source_quality;
  let knowabilityCeiling = 95;
  let knowabilityNotes = "Default ceiling; source_quality findings unavailable.";

  if (sourceResult && !sourceResult._error && sourceResult.findings?.summary) {
    const s = sourceResult.findings.summary;
    const totalSources = s.total_sources || 0;
    const namedRatio = totalSources > 0 ? (s.named_count || 0) / totalSources : 0;
    const anonymousJustifiedRatio = totalSources > 0 ? (s.anonymous_justified_count || 0) / totalSources : 0;
    const anonymousBareRatio = totalSources > 0
      ? ((s.anonymous_count || 0) - (s.anonymous_justified_count || 0)) / totalSources
      : 0;
    const docsLinkedRatio = (s.documents_cited || 0) > 0
      ? (s.documents_specifically_identified || 0) / s.documents_cited
      : 1;

    // Heuristic ceiling.
    knowabilityCeiling = Math.round(
      60 + 25 * namedRatio + 10 * docsLinkedRatio + 5 * anonymousJustifiedRatio - 15 * anonymousBareRatio
    );
    knowabilityCeiling = Math.max(40, Math.min(98, knowabilityCeiling));
    knowabilityNotes =
      `Ceiling derived from sourcing pattern: ${Math.round(namedRatio * 100)}% named, ` +
      `${Math.round(anonymousBareRatio * 100)}% bare anonymous, ` +
      `${Math.round(docsLinkedRatio * 100)}% of documents specifically identified.`;
  }

  // Weighted aggregate of scoreable modules.
  let weightedSum = 0;
  let totalWeightApplied = 0;
  const moduleContributions = [];

  for (const m of SCOREABLE_MODULES) {
    const r = byModule[m];
    const weight = MODULE_WEIGHTS[m];
    if (!r || r._error || typeof r.score !== "number") {
      moduleContributions.push({
        module: m, module_result_id: null,
        score: null, confidence: 0, weight: 0,
      });
      continue;
    }
    weightedSum += r.score * weight;
    totalWeightApplied += weight;
    moduleContributions.push({
      module: m,
      module_result_id: null, // would be set after persistence
      score: r.score,
      confidence: r.confidence ?? 0.5,
      weight,
    });
  }

  // Renormalize if some modules failed.
  const rawWeighted = totalWeightApplied > 0
    ? weightedSum / totalWeightApplied
    : 0;

  const ceilingBinding = rawWeighted > knowabilityCeiling;
  const finalScore = Math.min(rawWeighted, knowabilityCeiling);

  // Overall confidence: pipeline uncertainty stacks. Use min of module
  // confidences, multiplied by the fraction of modules that succeeded.
  const successfulModules = moduleContributions.filter((c) => c.score !== null);
  const minConfidence = successfulModules.length
    ? Math.min(...successfulModules.map((c) => c.confidence))
    : 0;
  const successFraction = successfulModules.length / SCOREABLE_MODULES.length;
  const overallConfidence = Number((minConfidence * successFraction).toFixed(2));

  // Surface top strengths and concerns.
  const topStrengths = [];
  const topConcerns = [];
  for (const m of SCOREABLE_MODULES) {
    const r = byModule[m];
    if (!r || r._error) continue;
    if (r.score >= 85) topStrengths.push(`${m}: ${r.score}`);
    if (r.score <= 55) topConcerns.push(`${m}: ${r.score}`);
  }

  return {
    article_hash: articleHash,
    auditor: {
      kind: "pipeline",
      id: `xray-auditor-prototype/anthropic/${model}`,
      display_name: "X-Ray Epistemic Auditor (prototype)",
      constituents: SCOREABLE_MODULES.map((m) => ({
        kind: "model",
        id: `anthropic/${model}`,
      })),
    },
    run_at: nowIso(),
    module_contributions: moduleContributions,
    knowability_ceiling: knowabilityCeiling,
    knowability_notes: knowabilityNotes,
    raw_weighted_score: Number(rawWeighted.toFixed(1)),
    final_score: Number(finalScore.toFixed(1)),
    ceiling_binding: ceilingBinding,
    overall_confidence: overallConfidence,
    top_strengths: topStrengths,
    top_concerns: topConcerns,
    disputes: [],
  };
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Score an article. Returns { article, module_results, predictions, aggregate }.
 *
 * @param {object} params
 * @param {string} params.markdown - The article markdown body.
 * @param {object} [params.metadata] - Optional headline/byline/publication/etc.
 * @param {string} [params.model] - Anthropic model id. Defaults to claude-sonnet-4-6.
 * @param {string} [params.apiKey] - Override the ANTHROPIC_API_KEY env var.
 */
export async function scoreArticle({
  markdown,
  metadata = {},
  model = DEFAULT_MODEL,
  apiKey,
}) {
  if (!markdown || typeof markdown !== "string") {
    throw new Error("scoreArticle requires `markdown` as a non-empty string");
  }

  const client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });

  const normalized = normalizeMarkdown(markdown);
  const articleHash = sha256Hex(normalized);

  // Build the article object that gets persisted alongside results.
  const article = {
    hash: articleHash,
    source_url: metadata.source_url || null,
    headline: metadata.headline || null,
    subhead: metadata.subhead || null,
    byline_raw: metadata.byline || null,
    author_ids: [],
    publication_id: metadata.publication_id || null,
    publication_date: metadata.publication_date || null,
    language: metadata.language || "en",
    word_count: normalized.split(/\s+/).filter(Boolean).length,
    body_markdown: normalized,
    captured_at: metadata.captured_at || nowIso(),
    captured_by: { kind: "pipeline", id: "xray-auditor-prototype" },
    capture_method: metadata.capture_method || "manual_paste",
    archive_url: metadata.archive_url,
  };

  // Run all 8 modules in parallel.
  console.error(`[scorer] Running ${ALL_MODULES.length} modules in parallel against ${model}...`);
  const moduleResults = await Promise.all(
    ALL_MODULES.map((module) =>
      runModule({ client, model, module, articleMarkdown: normalized, articleHash })
        .then((r) => {
          const status = r._error ? "FAIL" : `score=${r.score ?? "n/a"} conf=${r.confidence ?? "n/a"}`;
          console.error(`[scorer]   ${module.padEnd(28)} ${status}`);
          return r;
        })
    )
  );

  // Predictions are extracted by module 08 but stored separately.
  const predictionResult = moduleResults.find((r) => r.module === "prediction_extraction");
  const predictions = (predictionResult && !predictionResult._error)
    ? (predictionResult.findings.predictions || []).map((p, idx) => ({
        ...p,
        article_hash: articleHash,
        attributed_to_author_id: null,
        attributed_to_named_source: p.attributed_source_name || null,
        attribution_kind: p.attributed_to,
        prediction_text: p.prediction,
        prediction_type: p.type,
        resolution_horizon_iso: null, // would be parsed from horizon string
        extracted_by: predictionResult.auditor,
        extracted_at: predictionResult.run_at,
        resolution_status: "open",
        latest_resolution_id: null,
      }))
    : [];

  // Aggregate.
  const aggregate = aggregate_({ articleHash, moduleResults, model });

  return { article, module_results: moduleResults, predictions, aggregate };
}

// Renamed to avoid shadowing the `aggregate` const in the API return.
const aggregate_ = aggregate;

// -----------------------------------------------------------------------------
// Pretty-print summary for human consumption
// -----------------------------------------------------------------------------

export function formatSummary(result) {
  const { article, module_results, predictions, aggregate } = result;
  const lines = [];
  lines.push("=".repeat(72));
  lines.push("X-RAY EPISTEMIC AUDITOR — ARTICLE REPORT");
  lines.push("=".repeat(72));
  lines.push(`Headline:        ${article.headline || "(not provided)"}`);
  lines.push(`Publication:     ${article.publication_id || "(not provided)"}`);
  lines.push(`Date:            ${article.publication_date || "(not provided)"}`);
  lines.push(`Word count:      ${article.word_count}`);
  lines.push(`Article hash:    ${article.hash.slice(0, 16)}...`);
  lines.push("");
  lines.push("PER-MODULE SCORES");
  lines.push("-".repeat(72));
  for (const m of SCOREABLE_MODULES) {
    const r = module_results.find((x) => x.module === m);
    if (!r) continue;
    if (r._error) {
      lines.push(`  ${m.padEnd(28)} ERROR: ${r.findings.error || "unknown"}`);
    } else {
      const score = r.score ?? "n/a";
      const conf = r.confidence != null ? r.confidence.toFixed(2) : "n/a";
      lines.push(`  ${m.padEnd(28)} score=${String(score).padStart(3)}  conf=${conf}  weight=${MODULE_WEIGHTS[m]}`);
    }
  }
  lines.push("");
  lines.push("AGGREGATE");
  lines.push("-".repeat(72));
  lines.push(`  Raw weighted score:     ${aggregate.raw_weighted_score}`);
  lines.push(`  Knowability ceiling:    ${aggregate.knowability_ceiling}  (${aggregate.knowability_notes})`);
  lines.push(`  Final score:            ${aggregate.final_score}${aggregate.ceiling_binding ? "  (CEILING BINDING)" : ""}`);
  lines.push(`  Overall confidence:     ${aggregate.overall_confidence}`);
  lines.push("");
  if (aggregate.top_strengths.length) {
    lines.push("  Top strengths:");
    for (const s of aggregate.top_strengths) lines.push(`    + ${s}`);
  }
  if (aggregate.top_concerns.length) {
    lines.push("  Top concerns:");
    for (const c of aggregate.top_concerns) lines.push(`    - ${c}`);
  }
  lines.push("");
  lines.push(`PREDICTIONS EXTRACTED: ${predictions.length}`);
  lines.push("-".repeat(72));
  for (const p of predictions.slice(0, 5)) {
    lines.push(`  [${p.hedge_level.padEnd(11)}] ${p.prediction_text}`);
    lines.push(`               horizon: ${p.resolution_horizon}`);
  }
  if (predictions.length > 5) {
    lines.push(`  ... and ${predictions.length - 5} more`);
  }
  lines.push("");
  lines.push("=".repeat(72));
  return lines.join("\n");
}

// -----------------------------------------------------------------------------
// CLI entry point
// -----------------------------------------------------------------------------

async function main() {
  const { values } = parseArgs({
    options: {
      input:    { type: "string", short: "i" },
      metadata: { type: "string", short: "m" },
      output:   { type: "string", short: "o" },
      model:    { type: "string" },
      summary:  { type: "boolean", default: true },
    },
  });

  if (!values.input) {
    console.error("Usage: node scorer.js --input <article.md> [--metadata meta.json] [--output audit.json] [--model claude-sonnet-4-6]");
    process.exit(1);
  }

  const markdown = await readFile(values.input, "utf8");
  const metadata = values.metadata
    ? JSON.parse(await readFile(values.metadata, "utf8"))
    : {};

  const result = await scoreArticle({
    markdown,
    metadata,
    model: values.model || DEFAULT_MODEL,
  });

  if (values.output) {
    await writeFile(values.output, JSON.stringify(result, null, 2), "utf8");
    console.error(`[scorer] Wrote ${values.output}`);
  }

  if (values.summary) {
    console.log(formatSummary(result));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

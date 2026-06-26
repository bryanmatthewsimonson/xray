// X-Ray — in-extension epistemic auditor: prompt + tool + assembly
// (Phase 13.x, the LLM execution path alongside the CLI import).
//
// PURE module: no network, no chrome, no DOM. It mirrors the CLI
// scorer's contract so the two paths cannot drift:
//   - the single-shot orchestrator methodology
//     (docs/auditor-prototype/prompts/00-orchestrator-single-shot.md),
//     collapsed into ONE model call that emits all eight modules;
//   - the deterministic aggregate (weights + knowability ceiling +
//     confidence stacking) ported VERBATIM from
//     docs/auditor-prototype/scorer/scorer.js — the model NEVER supplies
//     the aggregate score (PHILOSOPHY §4: the weights are public
//     constants in the codebase, not a model's opinion);
//   - the canonical `{article, module_results, predictions, aggregate}`
//     shape that importAuditJson's firewall accepts.
//
// The LLM tool schema is built FROM findings-schemas.js's PAYLOADS, so
// the model is guided by the exact shapes validateFindings enforces.
//
// Single-shot is the orchestrator's documented tradeoff: faster/cheaper,
// lower rigor than independent per-module runs. Every module result
// carries a standing caveat saying so (P12 transparency); no PHILOSOPHY
// amendment is needed — §8 already makes a model a first-class auditor,
// and methodology version stays 1.0 because the findings schemas are
// unchanged.

import { articleHash, normalizeForHash } from './article-hash.js';
import {
    PAYLOADS, MODULE_NAMES, CURRENT_MODULE_VERSIONS, SCOREABLE_MODULES
} from './findings-schemas.js';
import { MODULE_PROMPTS } from './module-prompts.js';

export const AUDIT_TOOL_NAME = 'emit_audit';

// The standing transparency caveat stamped on every in-extension run.
export const STANDING_SINGLE_SHOT_CAVEAT =
    'Single-shot orchestration: all eight dimensions were scored in one model pass, '
    + 'which is faster but less rigorous than independent per-module audits. '
    + 'Treat scores as a screening signal, not a verdict.';

// The documented dimension weights — the CLI scorer's MODULE_WEIGHTS,
// verbatim. Public constants, not a model's choice (PHILOSOPHY §4).
export const MODULE_WEIGHTS = Object.freeze({
    headline_body_fidelity: 0.15,
    asymmetric_language:     0.15,
    number_hygiene:          0.10,
    source_quality:          0.20,
    internal_coherence:      0.10,
    definitional_precision:  0.10,
    omission:                0.20
});

// One-line orientation per module for the tool schema (the deep
// structure rides on the imported PAYLOADS shapes).
const MODULE_BLURBS = {
    headline_body_fidelity:
        'Do the headline/subhead accurately preview the body, with proportional emphasis?',
    asymmetric_language:
        'Are verbs, adjectives, epithets, and framing applied symmetrically to comparable parties?',
    number_hygiene:
        'Do numerical claims carry denominators, base rates, and comparison classes where relevant?',
    source_quality:
        'Are sources named where possible, anonymity justified, contested claims multi-sourced, documents cited?',
    internal_coherence:
        'Is the article internally consistent across paragraphs, captions, and between claim and evidence?',
    definitional_precision:
        'Are contested terms defined or smuggled (e.g. "extremist", "violence", "expert", "moderate")?',
    omission:
        'Who is quoted, who is referenced but unheard, and who is conspicuously absent given the topic?',
    prediction_extraction:
        'Extract testable predictions (explicit or implicit). NOT scored — this feeds the ledger.'
};

// ------------------------------------------------------------------
// Tool schema — built from PAYLOADS so it matches the validator
// ------------------------------------------------------------------

// One module's tool schema = its payload schema + the envelope fields
// the model supplies (score/confidence for 01-07; auditor_caveats on
// all). `module` and `version` are NOT asked of the model — they are
// deterministic and injected at assembly, so the model can't dangle the
// wire address with a wrong version.
function moduleToolSchema(name) {
    const payload = PAYLOADS[name];
    const properties = { ...payload.properties };
    const required = [...payload.required];

    properties.auditor_caveats = {
        type: 'array',
        items: { type: 'string' },
        description: 'What an outsider surface-scan could NOT determine for this dimension. '
            + 'Honest limits, not filler.'
    };
    required.push('auditor_caveats');

    if (name !== 'prediction_extraction') {
        properties.score = {
            type: 'integer', minimum: 0, maximum: 100,
            description: '0-100 calibrated score for this dimension. 90-100 exemplary; '
                + '75-89 solid; 60-74 acceptable; 40-59 significant problems; '
                + '20-39 severe; 0-19 catastrophic.'
        };
        properties.confidence = {
            type: 'number', minimum: 0, maximum: 1,
            description: 'Confidence in this score as a DECIMAL FRACTION between 0.0 and 1.0 '
                + '(e.g. 0.7 means 70% confident) — NOT a 0-100 percentage. It must never '
                + 'exceed 1. Lower it where surface evaluation is structurally limited, given '
                + 'how much is evaluable from the article alone.'
        };
        required.push('score', 'confidence');
    }

    return {
        type: 'object',
        description: MODULE_BLURBS[name] || name,
        properties,
        required
    };
}

/**
 * The single forced tool. Its input is one object per module under
 * `modules`, each conforming to its findings schema. The aggregate is
 * computed in code, never asked of the model.
 */
export function buildAuditTool() {
    const moduleProps = {};
    for (const name of MODULE_NAMES) moduleProps[name] = moduleToolSchema(name);
    return {
        name: AUDIT_TOOL_NAME,
        description:
            'Emit the complete eight-dimension epistemic audit of the article. Provide every '
            + 'dimension under `modules`, each matching its schema. Quote VERBATIM from the '
            + 'article in every evidence field. Do NOT compute an overall/aggregate score — the '
            + 'pipeline derives it from your per-dimension scores using fixed public weights.',
        input_schema: {
            type: 'object',
            properties: {
                modules: {
                    type: 'object',
                    description: 'One object per dimension. All eight are required.',
                    properties: moduleProps,
                    required: MODULE_NAMES.slice()
                }
            },
            required: ['modules']
        }
    };
}

// ------------------------------------------------------------------
// Prompts — the orchestrator methodology, adapted for tool output
// ------------------------------------------------------------------

/**
 * System prompt: the orchestrator's governing principles + scoring
 * calibration, pointed at the emit_audit tool. The per-dimension
 * definitions live in the tool schema descriptions, so they cannot
 * drift from the shapes the validator enforces.
 */
export function buildAuditSystemPrompt({ url = '', title = '' } = {}) {
    const meta = (title || url)
        ? `\nArticle under audit: ${title ? `"${title}"` : ''}${url ? ` <${url}>` : ''}`
        : '';
    return `You are X-Ray's epistemic auditor. You evaluate a published news article against eight transparent dimensions of journalistic quality. You are an OUTSIDER applying surface-detectable standards — you cannot re-report the story, only examine the published artifact.${meta}

GOVERNING PRINCIPLES (non-negotiable):
- Evidence-bound. Every finding must quote specific text from the article, verbatim. Never paraphrase inside an evidence quote; copy it character for character so it can be located on the page.
- Knowability-aware. If a dimension cannot be reliably evaluated from the article alone (e.g. source quality on a classified-intelligence story), say so in that dimension's auditor_caveats and lower its confidence rather than guessing.
- Symmetric. Apply identical standards regardless of the article's political valence, subject, or author.
- Calibrated. Express uncertainty honestly. A confident wrong score harms credibility more than a hedged one.
- No reformulation. Do not rewrite the article into a charitable version before scoring. Score what was published.

SCORING (dimensions 1-7 only; prediction_extraction is NOT scored):
- 90-100 exemplary, affirmative best practice visible; 75-89 solid, minor issues; 60-74 acceptable with noticeable concerns; 40-59 significant problems; 20-39 severe; 0-19 catastrophic.
- Each scored dimension also gets a confidence expressed as a DECIMAL FRACTION between 0.0 and 1.0 (e.g. 0.7, never 70) reflecting how much is evaluable from the article alone. Confidence must never exceed 1.

OUTPUT:
- Use the ${AUDIT_TOOL_NAME} tool and nothing else. Fill every dimension under \`modules\`, each matching its schema.
- For prediction_extraction, extract testable predictions and their resolution criteria; do NOT score it.
- Do NOT compute an overall or aggregate score — the pipeline derives it from your per-dimension scores using fixed public weights and a knowability ceiling.`;
}

/** The user turn: the article markdown the auditor evaluates. */
export function buildAuditUserPrompt({ articleText = '' } = {}) {
    return `Audit the following article. Quote verbatim; be symmetric; lower confidence where surface evaluation is limited.\n\n---\n${articleText}\n---`;
}

// ------------------------------------------------------------------
// Per-module ("thorough") path: one call per dimension, each with its
// FULL vendored methodology prompt and its own output budget — the
// orchestrator doc's production recommendation. Output shape is forced
// by a single-module tool (built from the same PAYLOADS).
// ------------------------------------------------------------------

/** A tool that emits ONE module's findings (envelope + payload). */
export function buildSingleModuleTool(name) {
    return {
        name: `emit_${name}`,
        description: `Emit the ${name} audit findings for the article, matching the schema. `
            + 'Quote VERBATIM from the article in every evidence field.',
        input_schema: moduleToolSchema(name)
    };
}

/**
 * System prompt for one module: the vendored 01-08 methodology verbatim,
 * pointed at that module's tool. This is the rigor the single-shot prompt
 * trades away — the full step-numbered methodology, one dimension at a time.
 */
export function buildModuleSystemPrompt(name, { url = '', title = '' } = {}) {
    const methodology = MODULE_PROMPTS[name] || '';
    const meta = (title || url)
        ? `\n\nArticle under audit: ${title ? `"${title}"` : ''}${url ? ` <${url}>` : ''}`
        : '';
    const scored = name === 'prediction_extraction'
        ? 'This module is NOT scored — do not emit a score or confidence.'
        : 'Provide the 0-100 score and 0.0-1.0 confidence the methodology describes.';
    return `${methodology}${meta}\n\nOUTPUT: use the emit_${name} tool and nothing else; fill its fields to match the schema rather than returning prose or JSON. Quote VERBATIM from the article in every evidence field. ${scored}`;
}

// ------------------------------------------------------------------
// Assembly: tool output → canonical scorer-export shape
// ------------------------------------------------------------------

/**
 * Walk a findings object and collect every evidence_quote / _a / _b into
 * a deduplicated list of {quote}. The CLI scorer's collectEvidenceQuotes,
 * verbatim, so the reader's "Evidence quotes (click to locate)" strip is
 * populated identically on both paths.
 */
export function collectEvidenceQuotes(findings) {
    const quotes = new Set();
    (function walk(node) {
        if (node === null || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        for (const [k, v] of Object.entries(node)) {
            if ((k === 'evidence_quote' || k === 'evidence_quote_a' || k === 'evidence_quote_b')
                && typeof v === 'string') {
                quotes.add(v);
            } else {
                walk(v);
            }
        }
    })(findings);
    return [...quotes].map((quote) => ({ quote }));
}

// Coerce a model-supplied score/confidence into the range the validator
// AND the aggregate require, BEFORE either consumes it. A recoverable
// model quirk (the common one: confidence emitted as a 0-100 percentage
// rather than a 0.0-1.0 fraction) must degrade a number, never discard
// the whole eight-module audit at the import firewall. This is NOT a
// tamper-gate relaxation — import.js still validates everything; we are
// keeping the value we hand it in-range so a quirk doesn't masquerade as
// corruption. A non-number stays non-number (assembleAudit nulls it,
// import takes the per-module failed posture).
function clampScore(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return v;
    return Math.max(0, Math.min(100, v));
}
function clampConfidence(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return v;
    // Clearly a percentage (1 < v <= 100) → it's a 0-100 value the model
    // mislabeled; recover the fraction. Anything still out of range
    // (negatives, >100) clamps to the bound.
    if (v > 1 && v <= 100) v = v / 100;
    return Math.max(0, Math.min(1, v));
}

// The deterministic aggregate — scorer.js aggregate(), ported. The
// knowability ceiling is derived from source_quality's summary counts;
// the weighted score uses only the scoreable modules; confidence stacks
// (min × success fraction). The model contributes NONE of this.
function buildAggregate({ hash, byModule, model, runAt }) {
    const sourceResult = byModule.source_quality;
    let knowabilityCeiling = 95;
    let knowabilityNotes = 'Default ceiling; source_quality findings unavailable.';

    if (sourceResult && !sourceResult._error && sourceResult.findings && sourceResult.findings.summary) {
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
        knowabilityCeiling = Math.round(
            60 + 25 * namedRatio + 10 * docsLinkedRatio + 5 * anonymousJustifiedRatio - 15 * anonymousBareRatio
        );
        knowabilityCeiling = Math.max(40, Math.min(98, knowabilityCeiling));
        knowabilityNotes =
            `Ceiling derived from sourcing pattern: ${Math.round(namedRatio * 100)}% named, `
            + `${Math.round(anonymousBareRatio * 100)}% bare anonymous, `
            + `${Math.round(docsLinkedRatio * 100)}% of documents specifically identified.`;
    }

    let weightedSum = 0;
    let totalWeightApplied = 0;
    const moduleContributions = [];
    for (const m of SCOREABLE_MODULES) {
        const r = byModule[m];
        const weight = MODULE_WEIGHTS[m];
        if (!r || r._error || typeof r.score !== 'number') {
            moduleContributions.push({ module: m, module_result_id: null, score: null, confidence: 0, weight: 0 });
            continue;
        }
        const score = clampScore(r.score);
        weightedSum += score * weight;
        totalWeightApplied += weight;
        moduleContributions.push({
            module: m, module_result_id: null,
            score, confidence: clampConfidence(typeof r.confidence === 'number' ? r.confidence : 0.5), weight
        });
    }

    const rawWeighted = totalWeightApplied > 0 ? weightedSum / totalWeightApplied : 0;
    const ceilingBinding = rawWeighted > knowabilityCeiling;
    const finalScore = Math.min(rawWeighted, knowabilityCeiling);

    const successful = moduleContributions.filter((c) => c.score !== null);
    const minConfidence = successful.length ? Math.min(...successful.map((c) => c.confidence)) : 0;
    const successFraction = successful.length / SCOREABLE_MODULES.length;
    const overallConfidence = clampConfidence(Number((minConfidence * successFraction).toFixed(2)));

    const topStrengths = [];
    const topConcerns = [];
    for (const m of SCOREABLE_MODULES) {
        const r = byModule[m];
        if (!r || r._error || typeof r.score !== 'number') continue;
        if (r.score >= 85) topStrengths.push(`${m}: ${r.score}`);
        if (r.score <= 55) topConcerns.push(`${m}: ${r.score}`);
    }

    return {
        article_hash: hash,
        auditor: {
            kind: 'pipeline',
            id: `xray-auditor-inext/anthropic/${model}`,
            display_name: 'X-Ray Epistemic Auditor (in-extension, single-shot)',
            constituents: SCOREABLE_MODULES.map((m) => ({ kind: 'model', id: `anthropic/${model}` }))
        },
        run_at: runAt,
        module_contributions: moduleContributions,
        knowability_ceiling: knowabilityCeiling,
        knowability_notes: knowabilityNotes,
        raw_weighted_score: Number(rawWeighted.toFixed(1)),
        final_score: Number(finalScore.toFixed(1)),
        ceiling_binding: ceilingBinding,
        // The ceiling is derived from source_quality — name that provenance
        // explicitly (importAuditJson would otherwise default it).
        ceiling_source: 'heuristic:source-quality/1.0',
        overall_confidence: overallConfidence,
        top_strengths: topStrengths,
        top_concerns: topConcerns,
        disputes: []
    };
}

/**
 * Transform one emit_audit tool output into the canonical scorer-export
 * object importAuditJson accepts: {article, module_results, predictions,
 * aggregate}. Deterministic and async only because the article hash is.
 *
 * @param {object} params
 * @param {object} params.toolInput  the emit_audit tool_use input
 * @param {string} params.model      the model id used (provenance)
 * @param {string} params.markdown   the article body markdown (the SAME
 *                                   text the reader hashes — the hash
 *                                   gate matches it against the capture)
 * @param {object} [params.metadata] headline / byline / url / etc.
 * @param {string|null} [params.standingCaveat] a caveat prepended to every
 *   module (the single-shot path passes its lower-rigor disclosure; the
 *   per-module path passes null — there is nothing to apologize for).
 * @returns {Promise<{article, module_results, predictions, aggregate}>}
 */
export async function assembleAudit({ toolInput, model, markdown, metadata = {}, standingCaveat = null }) {
    const modulesIn = (toolInput && typeof toolInput.modules === 'object' && toolInput.modules) || {};
    const normalized = normalizeForHash(markdown);
    const hash = await articleHash(markdown);
    const runAt = new Date().toISOString();
    const auditorModel = { kind: 'model', id: `anthropic/${model}` };

    const moduleResults = [];
    for (const name of MODULE_NAMES) {
        const version = CURRENT_MODULE_VERSIONS[name];
        const raw = modulesIn[name];

        // Absent module → a FAILED result so the run still imports and
        // the gap is visible (the scorer's per-module failure posture).
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            const absentCaveats = standingCaveat
                ? [standingCaveat, 'module absent from model output']
                : ['module absent from model output'];
            moduleResults.push({
                article_hash: hash, module: name, module_version: version,
                auditor: auditorModel, run_at: runAt, score: null, confidence: null,
                findings: { error: 'module absent from model output' },
                evidence_quotes: [],
                auditor_caveats: absentCaveats,
                _error: true
            });
            continue;
        }

        // Build the findings envelope. module/version are injected (never
        // model-supplied) so the wire address can't dangle.
        const findings = { module: name, version, ...raw };
        if (name === 'prediction_extraction') {
            // 08 is unscored — score/confidence are forbidden in findings.
            delete findings.score;
            delete findings.confidence;
        }

        const caveats = Array.isArray(raw.auditor_caveats) ? raw.auditor_caveats.slice() : [];
        if (standingCaveat && !caveats.includes(standingCaveat)) caveats.unshift(standingCaveat);
        findings.auditor_caveats = caveats;

        // Normalize score/confidence IN the findings object so the wrapper,
        // the validated findings, and buildAggregate all see one in-range
        // value (and import's tamper check, which requires wrapper ===
        // findings, still passes). A recovered percentage is noted so the
        // degrade is transparent (P12), not silent.
        if (name !== 'prediction_extraction') {
            if (typeof findings.confidence === 'number'
                && Number.isFinite(findings.confidence) && findings.confidence > 1) {
                caveats.push(
                    `confidence ${findings.confidence} was out of range and normalized into 0.0-1.0`);
            }
            findings.score = clampScore(findings.score);
            findings.confidence = clampConfidence(findings.confidence);
        }

        const score = typeof findings.score === 'number' ? findings.score : null;
        const confidence = typeof findings.confidence === 'number' ? findings.confidence : null;

        moduleResults.push({
            article_hash: hash, module: name, module_version: version,
            auditor: auditorModel, run_at: runAt,
            // Wrapper score/version are set EQUAL to findings' so import's
            // tamper check (top-level vs findings) passes cleanly.
            score, confidence, findings,
            evidence_quotes: collectEvidenceQuotes(findings),
            auditor_caveats: caveats
        });
    }

    const byModule = Object.fromEntries(moduleResults.map((r) => [r.module, r]));

    const predModule = modulesIn.prediction_extraction;
    const predictions = (predModule && Array.isArray(predModule.predictions)) ? predModule.predictions : [];

    const aggregate = buildAggregate({ hash, byModule, model, runAt });

    const article = {
        hash,
        source_url: metadata.source_url || metadata.url || null,
        headline: metadata.headline || metadata.title || null,
        subhead: metadata.subhead || null,
        byline_raw: metadata.byline || null,
        author_ids: [],
        publication_id: metadata.publication_id || null,
        publication_date: metadata.publication_date || null,
        language: metadata.language || 'en',
        word_count: normalized.split(/\s+/).filter(Boolean).length,
        body_markdown: normalized
    };

    return { article, module_results: moduleResults, predictions, aggregate };
}

// Office: the Editor-in-Chief (editor) — docs/PERSONAS.md §3.
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

import { PAYLOADS, MODULE_NAMES } from './findings-schemas.js';
import { MODULE_PROMPTS } from './module-prompts.js';

// The deterministic assembly half (weights, aggregate, assembleAudit,
// the auditable-input bound) lives in ./assemble.js so the READER can
// import it without this file's ~38KB module-prompts dependency (the
// lean-reader invariant). Re-exported here so existing callers and
// tests are unchanged.
export {
    MODULE_WEIGHTS, collectEvidenceQuotes, assembleAudit,
    MAX_AUDIT_INPUT_CHARS, auditableSlice
} from './assemble.js';

export const AUDIT_TOOL_NAME = 'emit_audit';

// The standing transparency caveat stamped on every in-extension run.
export const STANDING_SINGLE_SHOT_CAVEAT =
    'Single-shot orchestration: all eight dimensions were scored in one model pass, '
    + 'which is faster but less rigorous than independent per-module audits. '
    + 'Treat scores as a screening signal, not a verdict.';

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


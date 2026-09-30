// Standards: archival — docs/DISCIPLINES.md §12.
// LLM-assist configuration — Phase 14.5, slimmed by UA.3
// (docs/PHASE_14_5_LLM_ASSIST_KICKOFF.md,
// docs/UNIFIED_ARTICLE_PASS_KICKOFF.md).
//
// PURE module: no network, no chrome, no DOM. What remains after the
// UA.3 retirement of the standalone suggest pass: the model roster the
// Options picker offers, the LLM storage keys, the Anthropic API
// surface constants, the suggestable entity-type subset, and the
// per-kind Suggest preference (which now gates what the reader DERIVES
// from the article extract, not a prompt). The extraction prompt
// surface lives in corpus-prompts.js (the one article pass).

import { ENTITY_TYPES } from './entity-model.js';

// The entity types the MODEL may propose. A `case` is the RESEARCHER's
// investigation workspace — authored fields only (entity-field-schemas.js),
// never a thing named inside an article — so the model is structurally
// unable to mint one; humans create cases in the side panel, which
// remains the only path. Papers, lawsuits, books, products type as
// `thing`. (ENTITY_TYPES itself is untouched: it is wire-visible via
// the kind-0 `about` parse in adopt-entity.js and must keep `case`.)
export const SUGGESTABLE_ENTITY_TYPES = Object.freeze(
    ENTITY_TYPES.filter((t) => t !== 'case'));

// ------------------------------------------------------------------
// Model roster — exact ids only (no date suffixes). Default to the
// latest capable Claude; the Options picker renders these.
// ------------------------------------------------------------------

// Ordered most-capable-first; the Options picker renders this verbatim.
// Adding a model is this line, with its `force_tool` answer — every
// caller resolves through resolveModel(), and the corpus/lens/audit
// passes all read the user's stored choice. Cost note (per MTok in/out,
// Anthropic's list as of 2026-09-25): Fable 5.1 and Fable 5 $10/$50 ·
// Opus 5 and Opus 4.8 $5/$25 · Opus 5.5 $4/$20 · Sonnet 5.5 and
// Sonnet 5 $2/$10 · Sonnet 4.6 $3/$15 · Haiku 4.5 $1/$5.
//
// THINKING BUDGET (2026-08-12): every pass omits the `thinking` param,
// and what that means now varies by model — on Opus 4.8/4.7 it means
// no thinking, but on Opus 5, Sonnet 5, and Fable 5 adaptive thinking
// is ON and its tokens share the pass's `max_tokens`. That is why
// MAX_REDUCE_OUTPUT_TOKENS is 32768 (JOURNAL 2026-07-18); the 8192-cap
// passes (map, lens, audit module, vision, forensic, links) have not
// been re-measured against a thinking-on default. Fable 5.1, Opus 5.5
// and Sonnet 5.5 have adaptive thinking on by default too (on Fable
// 5.1 and Opus 5.5 it cannot be turned off), and no pass sets
// `effort`: Opus 5.5's default is `medium`, one step below Opus 5's
// `high` (JOURNAL 2026-09-29).
//
// `max_output` is the model's HARD per-response ceiling — sending a
// larger `max_tokens` is a 400, so every pass clamps to it
// (modelOutputCeiling). It is not a spend estimate: `max_tokens` is a
// ceiling, never a target, and unproduced tokens are never billed. That
// asymmetry is why the pass caps should sit HIGH — the only real cost of
// headroom is how long a call may run, which the timeouts own.
//
// `force_tool` says whether a pass may FORCE its one tool on the model
// (`tool_choice: {type: 'tool'}`, what every pass sent before 2026-09).
// Fable 5.1, Opus 5.5 and Sonnet 5.5 reject that with a 400; they, and
// any id missing from this list, get `auto` plus a system line naming
// the tool instead (withToolChoice below; JOURNAL 2026-09-29).
export const LLM_MODELS = Object.freeze([
    { id: 'claude-fable-5-1',  max_output: 128000, force_tool: false, label: 'Claude Fable 5.1 (most capable — highest cost)' },
    { id: 'claude-fable-5',    max_output: 128000, force_tool: true,  label: 'Claude Fable 5' },
    { id: 'claude-opus-5-5',   max_output: 128000, force_tool: false, label: 'Claude Opus 5.5' },
    { id: 'claude-opus-5',     max_output: 128000, force_tool: true,  label: 'Claude Opus 5' },
    { id: 'claude-opus-4-8',   max_output: 128000, force_tool: true,  label: 'Claude Opus 4.8' },
    { id: 'claude-opus-4-7',   max_output: 128000, force_tool: true,  label: 'Claude Opus 4.7' },
    { id: 'claude-sonnet-5-5', max_output: 128000, force_tool: false, label: 'Claude Sonnet 5.5' },
    { id: 'claude-sonnet-5',   max_output: 128000, force_tool: true,  label: 'Claude Sonnet 5 (near-Opus quality, Sonnet cost)' },
    { id: 'claude-sonnet-4-6', max_output: 128000, force_tool: true,  label: 'Claude Sonnet 4.6 (balanced)' },
    { id: 'claude-haiku-4-5',  max_output:  64000, force_tool: true,  label: 'Claude Haiku 4.5 (fastest / cheapest)' }
]);

// The lowest ceiling in the roster — the largest `max_tokens` that is
// valid on EVERY offered model. A pass cap at or below this can never
// 400 on a model switch.
export const SAFE_OUTPUT_CEILING = 64000;

/**
 * The model's hard output ceiling, for clamping a pass's `max_tokens`.
 * Unknown ids fall back to the safe floor rather than the optimistic
 * 128k: over-asking is a 400 that kills the call, under-asking only
 * risks a truncation the caller already reports honestly.
 */
export function modelOutputCeiling(id) {
    const m = LLM_MODELS.find((x) => x.id === id);
    return (m && m.max_output) || SAFE_OUTPUT_CEILING;
}

/** A pass's `max_tokens`: what it asks for, clamped to what the model allows. */
export function outputBudget(passCap, modelId) {
    return Math.min(passCap, modelOutputCeiling(modelId));
}

// Sonnet 5, not the top of the roster — a deliberate departure from
// "the latest capable Claude". The default has to be right for the
// DOMINANT workload, and that is now long-form: at the 400k map bound a
// four-hour transcript is ~63k INPUT tokens against ~20k output, so
// input price dominates the pass and Sonnet 5's $3/MTok against Opus
// 5's $5 (2026-08 prices) is where the saving actually lands (~$0.50
// vs ~$0.80 per episode). Sonnet 5 is near-Opus on exactly this shape of work —
// extraction against a supplied text, not open-ended reasoning. Opus 5
// and Fable 5 stay one click away for the passes that earn them
// (corpus reduce, forensic, lens). Only unset/unknown stored values
// land here; a user who has already picked a model keeps it.
export const DEFAULT_LLM_MODEL = 'claude-sonnet-5';

// Dedicated chrome.storage.local keys. The API key is a SECRET (its own
// key, never `preferences`, never exported, never logged); the model is
// a plain preference. Defined here (pure module) so the Options page and
// the SW client share them without the page importing the fetch client.
export const LLM_KEY_STORAGE   = 'xray:llm:key';
export const LLM_MODEL_STORAGE = 'xray:llm:model';

export function isKnownModel(id) {
    return LLM_MODELS.some((m) => m.id === id);
}

/** Map an arbitrary stored value to a real model id (defaulting). */
export function resolveModel(id) {
    return isKnownModel(id) ? id : DEFAULT_LLM_MODEL;
}

/**
 * Whether a pass may force its tool on this model. Only a roster line
 * that says so: an id the roster does not list gets `auto`, which every
 * model accepts, rather than a forced tool the newest models reject.
 */
export function modelForcesTool(id) {
    const m = LLM_MODELS.find((x) => x.id === id);
    return !!(m && m.force_tool === true);
}

/**
 * Require a one-tool pass's tool in the way `payload.model` accepts.
 * A model that takes a forced tool gets exactly what every pass sent
 * before 2026-09. Any other model gets `auto`, at most one call (so a
 * second call can never carry half the answer past extractToolInput),
 * and one system line naming the tool. Pure — returns a new payload.
 */
export function withToolChoice(payload, toolName) {
    if (modelForcesTool(payload.model)) {
        return { ...payload, tool_choice: { type: 'tool', name: toolName } };
    }
    // "In the tool call, not a text reply" — not "not in prose": most
    // tool fields ARE prose (summaries, captions, transcriptions).
    const line = `Answer by calling the ${toolName} tool. X-Ray reads only that tool's input, `
        + 'so put your whole answer in the tool call, not in a text reply.';
    const system = Array.isArray(payload.system)
        ? [...payload.system, { type: 'text', text: line }]
        : (payload.system ? `${payload.system}\n\n${line}` : line);
    return { ...payload, system, tool_choice: { type: 'auto', disable_parallel_tool_use: true } };
}

/** The one follow-up turn for an `auto` reply that ended without the tool. */
export function toolNudgeText(toolName) {
    return `That reply did not call the ${toolName} tool, and X-Ray reads only the tool's input. `
        + `Call ${toolName} now with your complete answer.`;
}

// The Anthropic Messages API surface this module targets. The client
// (src/shared/llm-client.js) is the only thing that reads these.
export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

// The set of artifact kinds a pass can request. 'all' covers them all.
//
// 2026-07-20 — Suggest IS the extraction pass. The judgment kinds are
// RETIRED from the per-capture Suggest because each has a strictly
// better corpus-level home where its evidence actually lives:
//   relationships → the cross-article links pass (28.3, case dashboard)
//   findings      → the per-subject forensic corpus pass (FA.1)
//   assessments   → the assess modal (a stance is the human's to own)
//   facts         → RETIRED OUTRIGHT (2026-07-20, with the whole Phase
//                   19 fact layer — the typed-field data model was too
//                   stringent to be useful; entity knowledge artifacts
//                   are being rebuilt claims-first)
// normalizeSuggestKinds drops retired values from stored settings, so
// existing installs migrate silently. The mental model: per capture,
// EXTRACT (atoms from this text); per corpus, CONNECT AND JUDGE.
export const SUGGEST_TASKS = Object.freeze([
    'all', 'entities', 'claims'
]);
export const RETIRED_SUGGEST_KINDS = Object.freeze(['assessments', 'relationships', 'findings', 'facts']);

// The selectable suggestion categories (SUGGEST_TASKS without the 'all'
// convenience). Each maps to an Options checkbox and gates which
// proposals the reader DERIVES from the article extract (UA.3 — the
// extract always carries both; the preference is consumer-side). Both
// are EXTRACTION kinds — a false-positive extraction is a one-click
// reject; judgment never rides this pass.
export const SUGGEST_KINDS = Object.freeze(SUGGEST_TASKS.filter((t) => t !== 'all'));
export const SUGGEST_DEFAULT_KINDS = Object.freeze(['entities', 'claims']);
export const LLM_SUGGEST_KINDS_STORAGE = 'xray:llm:suggest_kinds';

// Category metadata for the Options checkboxes (rendered in this order).
export const SUGGEST_KIND_LABELS = Object.freeze([
    { kind: 'entities', label: 'Entities',
        hint: 'people, organizations, places, and things named in the text' },
    { kind: 'claims', label: 'Claims',
        hint: 'atomized assertions the article makes, each anchored to a verbatim quote' },
]);

/**
 * Coerce a stored value into a valid enabled-kinds array. An ABSENT
 * value (not an array) falls back to the defaults; an explicit array is
 * filtered to known categories (and may be empty — the user turned
 * everything off, which the caller treats as "nothing to suggest").
 */
export function normalizeSuggestKinds(value) {
    if (!Array.isArray(value)) return SUGGEST_DEFAULT_KINDS.slice();
    return value.filter((k) => SUGGEST_KINDS.includes(k));
}

// (The Phase-28 vocabulary injection — SUGGEST_VOCAB_MAX /
// vocabularyFromRegistry, the registry riding the prompt as naming
// vocabulary — was RETIRED in UA.2: prompt-time vocabulary would
// poison the article pass's content-only cache key, so naming
// consistency now lives in the accept-time resolution ladder,
// shared/entity-resolution.js. Git-recoverable if UA.2 is killed.)

// (Everything below this point — the propose_capture tool schema with
// its is_key field, the suggest system/user prompt builders, the
// taxonomy rule blocks, and the UA.1 supplied-claim-index machinery —
// was RETIRED in UA.3 with the standalone xray:llm:suggest pass. The
// ONE article pass (corpus-prompts.js buildMapTool) is the extraction
// prompt surface now; the review modal, its validators
// (llm-proposals.js), and the kinds preference above all survive.
// Git-recoverable; Art. 3.)

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
// Adding a model is this line + nothing else — every caller resolves
// through resolveModel(), and the corpus/lens/audit passes all read the
// user's stored choice. Cost note (per MTok in/out, 2026-07): Fable 5
// $10/$50 · Opus 4.8 $5/$25 · Sonnet 5 $3/$15 · Haiku 4.5 $1/$5.
export const LLM_MODELS = Object.freeze([
    { id: 'claude-fable-5',    label: 'Claude Fable 5 (most capable — highest cost)' },
    { id: 'claude-opus-4-8',   label: 'Claude Opus 4.8 (most capable Opus)' },
    { id: 'claude-opus-4-7',   label: 'Claude Opus 4.7' },
    { id: 'claude-sonnet-5',   label: 'Claude Sonnet 5 (near-Opus quality, Sonnet cost)' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (balanced)' },
    { id: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5 (fastest / cheapest)' }
]);

export const DEFAULT_LLM_MODEL = 'claude-opus-4-8';

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

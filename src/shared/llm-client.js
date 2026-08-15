// LLM-assist client — Phase 14.5 (docs/PHASE_14_5_LLM_ASSIST_KICKOFF.md).
//
// The ONLY module that talks to the Anthropic Messages API. It runs in
// the background service worker (page CSP can't open this; the relay
// pool lives here for the same reason), reached via the xray:llm:* /
// xray:audit:* / xray:vision:* messages. Everything downstream consumes
// the validated RAW OUTPUT this returns — it never saves or publishes.
// (The original `xray:llm:suggest` standalone pass retired in UA.3;
// every Suggest surface rides the ONE article pass, runCorpusMapPass.)
//
// Consent gates (both must pass before any network call):
//   1. the `llmAssist` feature flag is on, AND
//   2. a user-supplied API key is present under the dedicated secret
//      key `xray:llm:key` (NEVER `preferences`, NEVER exported, NEVER
//      logged).
//
// The key is read fresh on each pass (MV3 SWs sleep/wake) and is never
// passed to Utils.log / Utils.error.

import { Utils } from './utils.js';
import { loadFlags, isEnabled } from './metadata/feature-flags.js';
import { createSseParser, createMessageAssembler } from './llm-stream.js';
import { coerceToSchema } from './schema-walker.js';
import {
    ANTHROPIC_API_URL, ANTHROPIC_VERSION, resolveModel, outputBudget,
    LLM_KEY_STORAGE, LLM_MODEL_STORAGE
} from './llm-prompts.js';
import {
    AUDIT_TOOL_NAME, STANDING_SINGLE_SHOT_CAVEAT, opinionStandingCaveat, STANDING_OPINION_CAVEAT,
    buildAuditTool, buildAuditSystemPrompt, buildAuditUserPrompt, assembleAudit,
    buildSingleModuleTool, buildModuleSystemPrompt, buildCorpusSourcesSection
} from './audit/audit-prompt.js';
import {
    EXTRACT_TOOL_NAME, buildExtractTool, buildExtractSystemPrompt, buildExtractUserContent
} from './llm-extract-prompts.js';
import { MAX_AUDIT_INPUT_CHARS } from './audit/assemble.js';
import { MODULE_NAMES, OPINION_MODULE_NAMES } from './audit/findings-schemas.js';
import {
    LENS_PROMPT_VERSION, LENS_TOOL_NAME,
    buildLensTool, buildLensSystemPrompt, buildLensUserPrompt
} from './lens-prompt.js';
import { lensPreflightRefusal, assembleJurisdictionReading } from './lens-engine.js';
import {
    MAX_ENTITY_AUDIT_OUTPUT_TOKENS,
    buildEntityAuditTool, buildEntityAuditSystemPrompt, buildEntityAuditUserPrompt
} from './llm-entity-audit.js';
import {
    MAX_FORENSIC_OUTPUT_TOKENS,
    buildForensicCorpusTool, buildForensicCorpusSystemPrompt, buildForensicCorpusUserPrompt
} from './forensic-corpus.js';
import { JurisdictionModel, treatAsLiving, admissibleAuthorities } from './jurisdiction-model.js';
import { isValidLensAssertionType, LENS_ASSERTION_TYPES } from './lens-taxonomy.js';
import { articleHash } from './audit/article-hash.js';
import {
    MAP_TOOL_NAME, REDUCE_TOOL_NAME,
    MAX_MEMBER_INPUT_CHARS, MAX_MAP_OUTPUT_TOKENS, MAX_REDUCE_OUTPUT_TOKENS,
    MAX_HYPOTHESIS_EDGE_OUTPUT_TOKENS, MAX_CLAIM_LINKS_OUTPUT_TOKENS,
    buildMapTool, buildMapSystemPrompt, buildMapUserPrompt,
    buildReduceTool, buildReduceSystemPrompt, buildReduceUserPrompt,
    buildHypothesisEdgeTool, buildHypothesisEdgeSystemPrompt, buildHypothesisEdgeUserPrompt,
    buildClaimLinksTool, buildClaimLinksSystemPrompt, buildClaimLinksUserPrompt
} from './corpus-prompts.js';
import {
    MAX_ENTITY_PAGE_OUTPUT_TOKENS,
    buildEntityPageTool, buildEntityPageSystemPrompt, buildEntityPageUserPrompt
} from './entity-page.js';
import {
    VISION_TOOL_NAME, VISION_MEDIA_TYPES, VISION_PROMPT_VERSION,
    buildVisionTool, buildVisionSystemPrompt, buildVisionUserContent
} from './vision-prompts.js';

// Re-exported for callers that wrote against the client (the keys are
// defined in the pure prompts module so the Options page can share them).
export { LLM_KEY_STORAGE, LLM_MODEL_STORAGE };

// Bound the article we send, so a pathologically long capture can't
// balloon the request. Aliases the shared auditable bound — the READER
// slices with auditableSlice before hashing and sending, so this
// SW-side slice is a defensive no-op on the audit path (the hash gate
// covers exactly the text that was scored).
const MAX_ARTICLE_CHARS = MAX_AUDIT_INPUT_CHARS;
// OUTPUT CAPS (raised 2026-08-13). These were each guessed at "how much
// will this pass need", and every guess was a silent quality ceiling: a
// cap that binds does not shorten the analysis, it DISCARDS a fully paid
// call (`stop_reason: 'max_tokens'` → the partial tool JSON is
// unparseable, so the pass reports failure and the spend is gone).
// `max_tokens` is a ceiling, never a target — unproduced tokens are not
// billed — so a cap that is too high costs nothing and a cap that is too
// low costs everything. They now sit high and are clamped per model by
// outputBudget(); the timeouts below own the only real cost of headroom.
const MAX_AUDIT_OUTPUT_TOKENS = 32768;
const MAX_MODULE_OUTPUT_TOKENS = 32768;
const MAX_LENS_OUTPUT_TOKENS = 32768;

// Timeouts DERIVED from the cap they guard, not hand-set beside it.
// Hand-set pairs drift: the map cap moved twice while its 120s timeout
// sat still, which would have traded a token-cap failure for an abort
// (JOURNAL 2026-07-18). ~50 tok/s is the conservative Opus-tier
// generation rate; the floor covers latency on small calls and the slack
// covers a slow first token.
const TOKENS_PER_SEC = 50;
function timeoutForBudget(maxTokens) {
    return Math.max(120000, Math.ceil(maxTokens / TOKENS_PER_SEC) * 1000 + 60000);
}
const AUDIT_TIMEOUT_MS  = timeoutForBudget(MAX_AUDIT_OUTPUT_TOKENS);
const MODULE_TIMEOUT_MS = timeoutForBudget(MAX_MODULE_OUTPUT_TOKENS);
const LENS_TIMEOUT_MS   = timeoutForBudget(MAX_LENS_OUTPUT_TOKENS);

// ------------------------------------------------------------------
// Storage helpers (callback → promise; SW-safe)
// ------------------------------------------------------------------

function storageGetRaw(keys) {
    return new Promise((resolve) => {
        try {
            const area = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local)
                || (typeof browser !== 'undefined' && browser.storage && browser.storage.local);
            if (!area) return resolve({});
            area.get(keys, (res) => resolve(res || {}));
        } catch (_) { resolve({}); }
    });
}

/** Read the secret key. Returns '' when unset. Never logged by callers. */
async function readApiKey() {
    const res = await storageGetRaw([LLM_KEY_STORAGE]);
    const raw = res[LLM_KEY_STORAGE];
    return typeof raw === 'string' ? raw.trim() : '';
}

async function readModel() {
    const res = await storageGetRaw([LLM_MODEL_STORAGE]);
    return resolveModel(res[LLM_MODEL_STORAGE]);
}

/**
 * Non-secret config snapshot for gating UIs — reports WHETHER a key is
 * present, never its value, plus the chosen model and flag state.
 */
export async function getLlmConfig() {
    await loadFlags();
    const [key, model] = await Promise.all([readApiKey(), readModel()]);
    return { enabled: isEnabled('llmAssist'), hasKey: key.length > 0, model };
}

// ------------------------------------------------------------------
// Error mapping
// ------------------------------------------------------------------

function mapHttpError(status, bodyText) {
    if (status === 401 || status === 403) {
        return 'The Anthropic API key was rejected (401/403). Check the key in Options → Advanced → LLM assist.';
    }
    if (status === 429) {
        return 'Anthropic rate limit hit (429). Wait a moment and try again.';
    }
    if (status >= 500) {
        return `Anthropic service error (${status}). Try again shortly.`;
    }
    // Surface a trimmed message for 400-class issues without dumping the
    // whole body (which echoes the request).
    let detail = '';
    try {
        const parsed = JSON.parse(bodyText);
        detail = parsed && parsed.error && parsed.error.message ? `: ${parsed.error.message}` : '';
    } catch (_) { /* ignore */ }
    return `Anthropic request failed (${status})${detail}.`;
}

// ------------------------------------------------------------------
// Shared request path
// ------------------------------------------------------------------

/**
 * POST one Messages payload and return the parsed response. Handles
 * network failure, HTTP errors, and unreadable bodies; the caller checks
 * stop_reason and pulls its tool out. NEVER logs the key or request body.
 *
 * ALWAYS STREAMS (`stream: true`), and reassembles the events into the
 * SAME object shape the non-streaming endpoint returns — callers are
 * unchanged by design (shared/llm-stream.js). Streaming is what makes
 * the raised output caps safe: a whole-response fetch must arrive
 * complete before it resolves, so a bigger cap raised the odds of a
 * timeout with nothing to show; a stream delivers continuously and the
 * AbortController stays the sole limiter.
 *
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @param {boolean} [opts.salvage]  recover a truncated tool call to its
 *        last COMPLETE element. Only for list-shaped payloads, and the
 *        caller MUST disclose the loss (`res.salvaged`).
 * @param {function} [opts.onProgress]
 * @returns {Promise<{ok:true, data:object, salvaged:boolean}
 *                  | {ok:false, error:string, status?:number, timeout?:boolean}>}
 */
async function postMessages(payload, apiKey, { signal, salvage = false, onProgress = null } = {}) {
    let resp;
    try {
        resp = await fetch(ANTHROPIC_API_URL, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': ANTHROPIC_VERSION,
                // Browser-origin calls require this opt-in; CORS is enabled
                // for it. The fetch runs in the SW, not a page with site CSP.
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({ ...payload, stream: true }),
            signal
        });
    } catch (err) {
        if (err && err.name === 'AbortError') {
            return { ok: false, timeout: true, error: 'The Anthropic call was aborted before completing (timeout).' };
        }
        // Network failure — DO NOT include the key or request body.
        Utils.error('[X-Ray LLM] network error:', err && err.message);
        return { ok: false, error: 'Could not reach the Anthropic API (network error). Check your connection and host permissions.' };
    }

    // An error response is JSON, not SSE — read it whole, as before.
    if (!resp.ok) {
        let bodyText = '';
        try { bodyText = await resp.text(); } catch (_) { /* ignore */ }
        const error = mapHttpError(resp.status, bodyText);
        Utils.error('[X-Ray LLM] HTTP', resp.status, error);
        return { ok: false, error, status: resp.status };
    }
    if (!resp.body || typeof resp.body.getReader !== 'function') {
        return { ok: false, error: 'Anthropic returned an unreadable response (no stream body).' };
    }

    const parser = createSseParser();
    const asm = createMessageAssembler({ salvage, onProgress });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            // stream:true keeps multi-byte characters whole across chunks.
            for (const ev of parser.push(decoder.decode(value, { stream: true }))) asm.handle(ev);
        }
        for (const ev of parser.push(decoder.decode())) asm.handle(ev);
    } catch (err) {
        // An abort mid-body is a timeout, not a malformed response.
        if (err && err.name === 'AbortError') {
            return { ok: false, timeout: true, error: 'The Anthropic call was aborted before completing (timeout).' };
        }
        Utils.error('[X-Ray LLM] stream error:', err && err.message);
        return { ok: false, error: 'The Anthropic response ended early (stream error). Try again.' };
    } finally {
        try { reader.releaseLock(); } catch (_) { /* already released */ }
    }

    const { message, error, salvaged } = asm.result();
    // A mid-stream `error` frame is the API reporting failure AFTER a
    // 200 — surface it as an error, never as an empty success.
    if (error) return { ok: false, error: `Anthropic stream error: ${error}` };
    return { ok: true, data: message, salvaged };
}

/**
 * A model-side safety guardrail declining the request is its OWN state,
 * never the generic "malformed output" error (the lens pass's §6 rule,
 * generalized here). Claude Fable 5 runs classifiers that can decline —
 * bio and cyber topics especially — and returns HTTP 200 with
 * `stop_reason: 'refusal'` and an empty/partial content array. Without
 * this check every caller falls through to extractToolInput() → null →
 * "the model did not return a structured extract", which blames the
 * wrong thing and sends the user hunting a bug that isn't there.
 *
 * Returns an `{ ok: false, refused: true, ... }` result to return as-is,
 * or null when the response was not a refusal.
 *
 * @param {object} data  the parsed Messages response
 * @param {string} what  what was being produced, for the message
 */
export function refusalResult(data, what) {
    if (!data || data.stop_reason !== 'refusal') return null;
    const category = (data.stop_details && data.stop_details.category) || null;
    return {
        ok: false, refused: true, code: 'model-refusal', category,
        error: `The model declined to produce ${what}`
            + (category ? ` (safety category: ${category})` : '')
            + '. This is a model-side guardrail — not a key, network, or X-Ray problem. '
            + 'Some models decline topics others allow; switching model in '
            + 'Options → Advanced → LLM assist is the usual workaround.'
    };
}

/**
 * Pull a forced tool's `input` out of a Messages response, by tool name.
 * Returns the input object, or null if no matching tool_use was found.
 * Exported for unit tests (no network involved).
 */
export function extractToolInput(data, toolName) {
    const blocks = (data && Array.isArray(data.content)) ? data.content : [];
    for (const block of blocks) {
        if (block && block.type === 'tool_use' && block.name === toolName) {
            return block.input || {};
        }
    }
    return null;
}

/**
 * The SAME extraction, NORMALIZED against the tool's own declared
 * `input_schema` — the single place model output enters this codebase.
 *
 * The tools are not `strict`, so the API guarantees nothing about the
 * shape; every consumer downstream was left to guard for itself, and the
 * 2026-08-13 audits found 38 places that did not. Normalizing here makes
 * the containers total ONCE, using declarations that already exist —
 * every pass already builds a tool with a full input_schema — instead of
 * a guard per consumer per field.
 *
 * `coercions` rides back deliberately. A silent fix is what made a
 * wrong-typed `entities` list into an article that was permanently
 * entity-blind behind a cache hit: the shape looked fine, so nothing
 * re-ran. Callers decide what a given coercion means — a top-level
 * container coercion says the response was malformed and the pass should
 * fail; a row-level drop is the per-row leniency the extract layer has
 * always had.
 *
 * @returns {{input: object|null, coercions: Array, topLevel: boolean}}
 */
export function toolInputOf(data, tool) {
    const name = (tool && tool.name) || tool;
    const raw = extractToolInput(data, name);
    if (raw === null) return { input: null, coercions: [], topLevel: false };
    const schema = tool && tool.input_schema;
    if (!schema) return { input: raw, coercions: [], topLevel: false };
    const { value, coercions } = coerceToSchema(raw, schema);
    if (coercions.length) {
        // Shape only — never the content (an extract carries article text).
        Utils.log('[X-Ray LLM] coerced model output:',
            coercions.map((c) => `${c.path.join('.') || '$'}: ${c.got}→${c.expected}`).join(', '));
    }
    return {
        input: value,
        coercions,
        // A coercion at depth 1 rewrote a whole declared field of the
        // answer — that is a malformed response, not model colour.
        topLevel: coercions.some((c) => c.path.length === 1)
    };
}

// ------------------------------------------------------------------
// (runSuggestionPass — the standalone suggestion pass — RETIRED in
// UA.3 with its xray:llm:suggest message: every Suggest surface now
// rides the ONE article pass (runCorpusMapPass via
// shared/article-pass.js). The reader modal, its validators, and the
// kinds preference all survive — they gate what DERIVES from the
// extract, not what is read.)
// ------------------------------------------------------------------

/**
 * Run one user-invoked ENTITY AUDIT pass (Phase 17 E2 —
 * docs/ENTITY_CORPUS_DESIGN.md §3.2). Same two consent gates as
 * Suggest (llmAssist flag + key); never scheduled, never automatic.
 * Returns RAW ops — the caller runs validateEntityOps and gates every
 * mutation behind a human Accept.
 *
 * @param {object} req { digest: string }  buildRegistryDigest output
 * @returns {Promise<{ok:true, model, ops:Array, usage?:object}
 *                  | {ok:false, error:string, status?:number}>}
 */
export async function runEntityAuditPass(req = {}) {
    await loadFlags();
    if (!isEnabled('llmAssist')) {
        return { ok: false, error: 'LLM assist is off. Enable it in Options → Advanced → LLM assist.' };
    }
    const apiKey = await readApiKey();
    if (!apiKey) {
        return { ok: false, error: 'No Anthropic API key set. Add one in Options → Advanced → LLM assist.' };
    }
    const digest = String(req.digest || '');
    if (!digest.trim()) {
        return { ok: false, error: 'No registry digest to audit.' };
    }

    const model = await readModel();
    const tool = buildEntityAuditTool();
    const payload = {
        model,
        max_tokens: outputBudget(MAX_ENTITY_AUDIT_OUTPUT_TOKENS, model),
        system: buildEntityAuditSystemPrompt(),
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: buildEntityAuditUserPrompt(digest) }]
    };
    Utils.log('[X-Ray LLM] entity audit pass:', { model, chars: digest.length });

    const res = await postMessages(payload, apiKey);
    if (!res.ok) return res;
    const data = res.data;
    { const r = refusalResult(data, 'an audit of this entity registry'); if (r) return r; }
    if (data && data.stop_reason === 'max_tokens') {
        return { ok: false, error: 'The audit hit its output limit before finishing.' };
    }
    const input = toolInputOf(data, tool).input;
    if (input === null || !Array.isArray(input.ops)) {
        return { ok: false, error: 'The model did not return a structured op list.' };
    }
    return { ok: true, model: (data && data.model) || model, ops: input.ops, usage: data && data.usage };
}

/**
 * Run one per-subject FORENSIC CORPUS pass (FA.1 —
 * docs/CORPUS_AUDIT_KICKOFF.md §4b). Same consent gates as Suggest;
 * raw findings out — the caller runs validateForensicProposals and
 * gates every mutation behind a human Accept (counter-read first).
 *
 * @param {object} req { bundle: string, subjectName?: string }
 */
export async function runForensicCorpusPass(req = {}) {
    await loadFlags();
    if (!isEnabled('llmAssist')) {
        return { ok: false, error: 'LLM assist is off. Enable it in Options → Advanced → LLM assist.' };
    }
    const apiKey = await readApiKey();
    if (!apiKey) {
        return { ok: false, error: 'No Anthropic API key set. Add one in Options → Advanced → LLM assist.' };
    }
    const bundle = String(req.bundle || '');
    if (!bundle.trim()) return { ok: false, error: 'No subject material to analyze.' };

    const model = await readModel();
    const tool = buildForensicCorpusTool();
    const payload = {
        model,
        max_tokens: outputBudget(MAX_FORENSIC_OUTPUT_TOKENS, model),
        system: buildForensicCorpusSystemPrompt(),
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: buildForensicCorpusUserPrompt(bundle) }]
    };
    Utils.log('[X-Ray LLM] forensic corpus pass:', { model, chars: bundle.length });
    const res = await postMessages(payload, apiKey);
    if (!res.ok) return res;
    const data = res.data;
    { const r = refusalResult(data, 'a behavioral analysis of this subject'); if (r) return r; }
    if (data && data.stop_reason === 'max_tokens') {
        return { ok: false, error: 'The pass hit its output limit before finishing.' };
    }
    const input = toolInputOf(data, tool).input;
    if (input === null || !Array.isArray(input.findings)) {
        return { ok: false, error: 'The model did not return a structured finding list.' };
    }
    return { ok: true, model: (data && data.model) || model, findings: input.findings, usage: data && data.usage };
}


/**
 * Run one user-invoked epistemic-audit pass: a single forced tool call
 * that scores all eight dimensions, assembled into the canonical
 * scorer-export shape the reader feeds to importAuditJson. The aggregate
 * is computed in code, never taken from the model.
 *
 * Same two consent gates as Suggest (llmAssist flag + key). This never
 * persists or publishes — the reader runs importAuditJson (which re-hashes
 * and schema-validates) and publishing stays behind `epistemicAuditing`.
 *
 * @param {object} req
 * @param {string} req.markdown        the article body markdown (the SAME
 *                                     text the reader hashes for the gate)
 * @param {object} [req.metadata]      headline / byline / url / etc.
 * @param {string} [req.articleUrl]
 * @param {string} [req.articleTitle]
 * @returns {Promise<{ok:true, model:string, audit:object, usage?:object}
 *                  | {ok:false, error:string, status?:number}>}
 */
export async function runAuditPass(req = {}) {
    await loadFlags();
    if (!isEnabled('llmAssist')) {
        return { ok: false, error: 'LLM assist is off. Enable it in Options → Advanced → LLM assist.' };
    }

    const apiKey = await readApiKey();
    if (!apiKey) {
        return { ok: false, error: 'No Anthropic API key set. Add one in Options → Advanced → LLM assist.' };
    }

    const markdown = String(req.markdown || '').slice(0, MAX_ARTICLE_CHARS);
    if (!markdown.trim()) {
        return { ok: false, error: 'No article text to audit.' };
    }

    const model = await readModel();

    // Thorough mode moved to reader-orchestrated per-module messages
    // (`xray:audit:module`) — one long-lived response channel behind a
    // single message is exactly what MV3 service-worker eviction kills
    // (JOURNAL 2026-07-09). Keep a clear error for any stale caller.
    if (req.mode === 'per_module') {
        return { ok: false, error: 'Thorough audits now run per module — send xray:audit:module calls (the reader orchestrates them).' };
    }

    const system = buildAuditSystemPrompt({ url: req.articleUrl || '', title: req.articleTitle || '' });
    const userContent = buildAuditUserPrompt({ articleText: markdown });
    const tool = buildAuditTool();

    const payload = {
        model,
        max_tokens: outputBudget(MAX_AUDIT_OUTPUT_TOKENS, model),
        system,
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: userContent }]
    };

    Utils.log('[X-Ray LLM] audit pass:', { model, chars: markdown.length });

    // Bounded so a hung request can't hold the response channel forever.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AUDIT_TIMEOUT_MS);
    let res;
    try {
        res = await postMessages(payload, apiKey, { signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
    if (!res.ok) return res;
    const data = res.data;

    { const r = refusalResult(data, 'this audit'); if (r) return r; }
    if (data && data.stop_reason === 'max_tokens') {
        return { ok: false, error: 'The model hit its output limit before finishing the audit. Try a shorter article.' };
    }

    const toolInput = toolInputOf(data, tool).input;
    if (toolInput === null) {
        return { ok: false, error: 'The model did not return a structured audit. Try again.' };
    }

    const usedModel = (data && data.model) || model;
    let audit;
    try {
        // The opinion caveat joins the single-shot one in two cases:
        // the artifact reads as opinion/analysis, or the OQ.4 forced
        // case — declared reporting overriding an opinion signal
        // (req.suggestedType carries the capture-time suggestion).
        const opinionCaveat = opinionStandingCaveat({ source_type: req.sourceType || null })
            || (req.suggestedType === 'analysis' && req.sourceType !== 'analysis'
                ? STANDING_OPINION_CAVEAT : null);
        audit = await assembleAudit({
            toolInput, model: usedModel, markdown, metadata: req.metadata || {},
            standingCaveat: opinionCaveat
                ? [STANDING_SINGLE_SHOT_CAVEAT, opinionCaveat]
                : STANDING_SINGLE_SHOT_CAVEAT
        });
    } catch (err) {
        Utils.error('[X-Ray LLM] audit assembly failed:', err && err.message);
        return { ok: false, error: 'Could not assemble the audit from the model output.' };
    }

    Utils.log('[X-Ray LLM] audit modules:', audit.module_results.length);
    return {
        ok: true,
        model: usedModel,
        audit,
        usage: data && data.usage ? data.usage : undefined
    };
}

/**
 * One thorough-audit MODULE call (the reader orchestrates eight of
 * these with bounded concurrency — run-orchestrator.js). Each call is
 * its own runtime message, so every response resets the MV3 idle timer
 * and a lost channel costs one retryable module, never the run (the
 * lens topology, applied to audits). Same consent gates as every LLM
 * pass; returns the RAW module findings — the reader draft-stores,
 * assembles, and imports through the firewall.
 *
 * @param {object} req  { module, markdown, articleUrl?, articleTitle? }
 * @returns {Promise<{ok:true, module:string, findings:object, model:string, usage?:object}
 *                  | {ok:false, module?:string, error:string, status?:number, timeout?:boolean}>}
 */
export async function runAuditModulePass(req = {}) {
    await loadFlags();
    if (!isEnabled('llmAssist')) {
        return { ok: false, error: 'LLM assist is off. Enable it in Options → Advanced → LLM assist.' };
    }
    const apiKey = await readApiKey();
    if (!apiKey) {
        return { ok: false, error: 'No Anthropic API key set. Add one in Options → Advanced → LLM assist.' };
    }

    const name = String(req.module || '');
    if (!MODULE_NAMES.includes(name) && !OPINION_MODULE_NAMES.includes(name)) {
        return { ok: false, error: `Unknown audit module: ${name || '(none)'}` };
    }
    // Defensive no-op when the reader pre-sliced (the hash-gate contract).
    const markdown = String(req.markdown || '').slice(0, MAX_ARTICLE_CHARS);
    if (!markdown.trim()) {
        return { ok: false, module: name, error: 'No article text to audit.' };
    }

    const model = await readModel();
    const tool = buildSingleModuleTool(name);
    // Corpus-held cited sources ride ONLY on module 04 (methodology 1.1
    // step 7); any other module ignores the field entirely.
    const corpusSection = name === 'source_quality'
        ? buildCorpusSourcesSection(req.corpusSources)
        : '';
    const payload = {
        model,
        max_tokens: outputBudget(MAX_MODULE_OUTPUT_TOKENS, model),
        system: buildModuleSystemPrompt(name, { url: req.articleUrl || '', title: req.articleTitle || '' }),
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: buildAuditUserPrompt({ articleText: markdown }) + corpusSection }]
    };

    Utils.log('[X-Ray LLM] audit module:', {
        module: name, model, chars: markdown.length,
        corpusSources: corpusSection ? (req.corpusSources || []).length : 0
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MODULE_TIMEOUT_MS);
    let res;
    try {
        res = await postMessages(payload, apiKey, { signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
    if (!res.ok) return { ...res, module: name };

    const data = res.data;
    { const r = refusalResult(data, `the ${name} audit module`); if (r) return { ...r, module: name }; }
    if (data && data.stop_reason === 'max_tokens') {
        return { ok: false, module: name, error: `The ${name} module hit its output limit before finishing.` };
    }
    const findings = toolInputOf(data, tool).input;
    if (findings === null) {
        return { ok: false, module: name, error: `The model did not return structured ${name} findings.` };
    }
    return {
        ok: true,
        module: name,
        findings,
        model: (data && data.model) || model,
        usage: data && data.usage ? data.usage : undefined
    };
}

// ------------------------------------------------------------------
// Case-corpus synthesis — Phase 20.4
// (docs/CASE_SYNTHESIS_DESIGN.md). Map/reduce over a case's member
// articles. Gated by `caseSynthesis` AND `llmAssist` AND the key: a
// corpus run is N suggest passes' worth of spend. Returns RAW tool
// output — validation, grounding, and the human-accept firewall all
// stay portal-side (the SW stays thin, the lens/audit pattern).
// ------------------------------------------------------------------

// Both derived from the cap they guard (timeoutForBudget) rather than
// hand-set: a full-budget emission must be able to FINISH, or a raised
// cap just converts a token-cap failure into an AbortError — the trade
// JOURNAL 2026-07-18 warned about, and the drift that hand-set pairs
// invite. Neither call is bounded by the MV3 lifetime: the map's two
// callers and the portal's synthesis run each hold a keepalive, so this
// AbortController is the sole limiter.
const CORPUS_MAP_TIMEOUT_MS = timeoutForBudget(MAX_MAP_OUTPUT_TOKENS);
const CORPUS_REDUCE_TIMEOUT_MS = timeoutForBudget(MAX_REDUCE_OUTPUT_TOKENS);

/** Gating snapshot for the portal's "Analyze corpus" control. */
export async function getCorpusConfig() {
    await loadFlags();
    const [key, model] = await Promise.all([readApiKey(), readModel()]);
    return { enabled: isEnabled('caseSynthesis') && isEnabled('llmAssist'), hasKey: key.length > 0, model };
}

async function corpusGate() {
    await loadFlags();
    if (!isEnabled('caseSynthesis')) {
        return { error: 'Case synthesis is off. Enable it in Options → Advanced → Case synthesis.' };
    }
    return assistGate();
}

// UA.1 — the MAP pass alone gates on llmAssist + key, WITHOUT
// caseSynthesis: since the One Article Pass, the reader's Suggest
// serves its claim half from the article extract, so the map call is
// part of the same llmAssist surface as the suggest call it replaces —
// same article text, same destination, same click consent. The reduce
// and every other corpus pass keep the full corpusGate (they are the
// synthesis feature).
async function assistGate() {
    await loadFlags();
    if (!isEnabled('llmAssist')) {
        return { error: 'LLM assist is off. Enable it in Options → Advanced → LLM assist.' };
    }
    const apiKey = await readApiKey();
    if (!apiKey) {
        return { error: 'No Anthropic API key set. Add one in Options → Advanced → LLM assist.' };
    }
    return { apiKey };
}

/**
 * MAP: one member article → its position + load-bearing assertions.
 * Mirrors runAuditModulePass. Echoes `member_id` for the orchestrator.
 * Case-free since corpus-v7 (MA.5): the request carries no frame — the
 * extract is article-intrinsic and shared across cases/entity pages.
 *
 * @param {object} req { member_id, memberText, memberMeta? }
 */
export async function runCorpusMapPass(req = {}) {
    const gate = await assistGate();   // UA.1 — see assistGate: the map rides the Suggest surface
    if (gate.error) return { ok: false, member_id: req.member_id, error: gate.error };

    const memberText = String(req.memberText || '').slice(0, MAX_MEMBER_INPUT_CHARS);
    if (!memberText.trim()) return { ok: false, member_id: req.member_id, error: 'No article text to analyze.' };

    const model = await readModel();
    const tool = buildMapTool();
    const payload = {
        model,
        max_tokens: outputBudget(MAX_MAP_OUTPUT_TOKENS, model),
        system: buildMapSystemPrompt(),
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: buildMapUserPrompt({
            memberText, memberMeta: req.memberMeta || {}
        }) }]
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CORPUS_MAP_TIMEOUT_MS);
    let res;
    // SALVAGE, map only. The extract is a LIST of independent atoms, so
    // "the first N of them" is a true statement about the article — a
    // partial audit or brief would instead read as a complete judgment
    // and those passes keep the honest failure. A cut-off call is
    // otherwise a total loss: fully paid, unparseable, discarded.
    try {
        res = await postMessages(payload, gate.apiKey, { signal: controller.signal, salvage: true });
    } finally { clearTimeout(timer); }
    if (!res.ok) return { ...res, member_id: req.member_id };

    const data = res.data;
    { const r = refusalResult(data, 'an extract for this article'); if (r) return { ...r, member_id: req.member_id }; }
    // Normalized against the map tool's own schema, so no consumer can be
    // handed a wrong-typed container. But a TOP-LEVEL coercion is not a
    // tidy-up to swallow: it means a whole declared field of the answer
    // arrived as the wrong type, and quietly turning that into an empty
    // list is exactly how one bad response made an article permanently
    // entity-blind behind a content-keyed cache hit (JOURNAL 2026-08-13).
    // Fail so the pass re-runs and nothing is cached.
    const { input: extract, topLevel, coercions } = toolInputOf(data, tool);
    if (extract !== null && topLevel) {
        const which = coercions.filter((c) => c.path.length === 1)
            .map((c) => `${c.path[0]} (${c.got}, expected ${c.expected})`).join(', ');
        return {
            ok: false, member_id: req.member_id,
            error: `The model returned a malformed extract — ${which}. `
                 + 'Nothing was cached; run Suggest again.'
        };
    }
    const cutShort = !!(data && data.stop_reason === 'max_tokens');
    if (extract === null) {
        return {
            ok: false, member_id: req.member_id,
            error: cutShort
                // Nothing survived the cut — the caps sit at the model
                // ceiling, so this means the article genuinely outruns
                // one call, not that a number needs nudging.
                ? 'The map call hit its output limit before a single complete assertion. This article is too long to atomize in one pass.'
                : 'The model did not return a structured extract.'
        };
    }
    // Disclosed, never silent: `partial` rides to the caller so the
    // review surface can say the extract stops early rather than
    // presenting it as the whole article.
    return {
        ok: true, member_id: req.member_id, extract,
        partial: cutShort || !!res.salvaged,
        model: (data && data.model) || model,
        usage: data && data.usage
    };
}

/**
 * REDUCE: the compact map extracts + the dossier digest → a case brief.
 * Single-shot (mirrors runAuditPass); returns the RAW brief tool input.
 *
 * @param {object} req { dossierDigest, extracts, caseName?, scopeQuestion? }
 */
export async function runCorpusReducePass(req = {}) {
    const gate = await corpusGate();
    if (gate.error) return { ok: false, error: gate.error };

    const extracts = Array.isArray(req.extracts) ? req.extracts : [];
    if (extracts.length === 0) return { ok: false, error: 'No article extracts to synthesize.' };

    const model = await readModel();
    const tool = buildReduceTool();
    const payload = {
        model,
        max_tokens: outputBudget(MAX_REDUCE_OUTPUT_TOKENS, model),
        system: buildReduceSystemPrompt({ caseName: req.caseName || '', scopeQuestion: req.scopeQuestion || '' }),
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: buildReduceUserPrompt({ dossierDigest: req.dossierDigest || '', extracts }) }]
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CORPUS_REDUCE_TIMEOUT_MS);
    let res;
    try { res = await postMessages(payload, gate.apiKey, { signal: controller.signal }); }
    finally { clearTimeout(timer); }
    if (!res.ok) return res;

    const data = res.data;
    { const r = refusalResult(data, 'the corpus brief'); if (r) return r; }
    if (data && data.stop_reason === 'max_tokens') {
        return { ok: false, error: 'The synthesis hit its output limit before finishing.' };
    }
    const briefInput = toolInputOf(data, tool).input;
    if (briefInput === null) return { ok: false, error: 'The model did not return a structured brief.' };
    return { ok: true, briefInput, model: (data && data.model) || model, usage: data && data.usage };
}

/**
 * ENTITY PAGE — EP.2 (docs/ENTITY_PAGE_KICKOFF.md): one reduce-shaped
 * call over the entity digest + the member extracts, producing the
 * grounded page tool output. Same triple gate as the corpus passes
 * (the page IS the synthesis engine pointed at a subject — same spend
 * class, same consent). Returns the RAW tool input — validation,
 * key-claim subset filtering, grounding, and the human review all
 * stay portal-side (entity-page.js + the dossier view).
 *
 * @param {object} req { entityDigest, extracts, entityName?, entityType?, caseName?, scopeQuestion? }
 */
export async function runEntityPagePass(req = {}) {
    const gate = await corpusGate();
    if (gate.error) return { ok: false, error: gate.error };

    const extracts = Array.isArray(req.extracts) ? req.extracts : [];
    if (extracts.length === 0) return { ok: false, error: 'No article extracts to synthesize a page from.' };

    const model = await readModel();
    const tool = buildEntityPageTool();
    const payload = {
        model,
        max_tokens: outputBudget(MAX_ENTITY_PAGE_OUTPUT_TOKENS, model),
        system: buildEntityPageSystemPrompt({
            entityName: req.entityName || '', entityType: req.entityType || '',
            caseName: req.caseName || '', scopeQuestion: req.scopeQuestion || ''
        }),
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: buildEntityPageUserPrompt({
            entityDigest: req.entityDigest || '', extracts
        }) }]
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CORPUS_REDUCE_TIMEOUT_MS);
    let res;
    try { res = await postMessages(payload, gate.apiKey, { signal: controller.signal }); }
    finally { clearTimeout(timer); }
    if (!res.ok) return res;

    const data = res.data;
    { const r = refusalResult(data, 'the entity page'); if (r) return r; }
    if (data && data.stop_reason === 'max_tokens') {
        return { ok: false, error: 'The page synthesis hit its output limit before finishing.' };
    }
    const pageInput = toolInputOf(data, tool).input;
    if (pageInput === null) return { ok: false, error: 'The model did not return a structured page.' };
    return { ok: true, pageInput, model: (data && data.model) || model, usage: data && data.usage };
}

/**
 * HYPOTHESIS EDGES — Phase 26 H.4: one reduce-shaped call over the
 * dossier digest + the hypothesis list, proposing claim→hypothesis
 * supports/undermines attachments. Same triple gate as the corpus
 * passes; returns the RAW tool input — validation, grounding, the
 * both-sides post-check, and the human-accept firewall all stay
 * portal-side (hypothesis-suggest.js).
 *
 * @param {object} req { dossierDigest, hypotheses, caseName?, scopeQuestion? }
 */
export async function runHypothesisEdgePass(req = {}) {
    const gate = await corpusGate();
    if (gate.error) return { ok: false, error: gate.error };

    const hypotheses = Array.isArray(req.hypotheses) ? req.hypotheses : [];
    if (hypotheses.length === 0) return { ok: false, error: 'No hypotheses to map edges onto.' };

    const model = await readModel();
    const tool = buildHypothesisEdgeTool();
    const payload = {
        model,
        max_tokens: outputBudget(MAX_HYPOTHESIS_EDGE_OUTPUT_TOKENS, model),
        system: buildHypothesisEdgeSystemPrompt({ caseName: req.caseName || '', scopeQuestion: req.scopeQuestion || '' }),
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: buildHypothesisEdgeUserPrompt({
            dossierDigest: req.dossierDigest || '', hypotheses
        }) }]
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CORPUS_REDUCE_TIMEOUT_MS);
    let res;
    try { res = await postMessages(payload, gate.apiKey, { signal: controller.signal }); }
    finally { clearTimeout(timer); }
    if (!res.ok) return res;

    const data = res.data;
    { const r = refusalResult(data, 'hypothesis edge proposals'); if (r) return r; }
    if (data && data.stop_reason === 'max_tokens') {
        return { ok: false, error: 'The edge-suggestion call hit its output limit before finishing.' };
    }
    const edgesInput = toolInputOf(data, tool).input;
    if (edgesInput === null) return { ok: false, error: 'The model did not return structured edge proposals.' };
    return { ok: true, edgesInput, model: (data && data.model) || model, usage: data && data.usage };
}

/**
 * CLAIM LINKS — Phase 28.3: standalone cross-article relationship
 * suggestion, decoupled from the full synthesis. One reduce-shaped
 * call over the case's claims index (+ the already-linked list) — no
 * member texts, no map pass. Same triple gate; returns the RAW tool
 * input — validation, existing-pair filtering, and the human-accept
 * firewall all stay portal-side (links-block.js).
 *
 * @param {object} req { claims, existing, caseName?, scopeQuestion? }
 */
export async function runClaimLinksPass(req = {}) {
    const gate = await corpusGate();
    if (gate.error) return { ok: false, error: gate.error };

    const claims = Array.isArray(req.claims) ? req.claims : [];
    if (claims.length < 2) return { ok: false, error: 'Fewer than two claims — nothing to link.' };

    const model = await readModel();
    const tool = buildClaimLinksTool();
    const payload = {
        model,
        max_tokens: outputBudget(MAX_CLAIM_LINKS_OUTPUT_TOKENS, model),
        system: buildClaimLinksSystemPrompt({ caseName: req.caseName || '', scopeQuestion: req.scopeQuestion || '' }),
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: buildClaimLinksUserPrompt({
            claims, existing: Array.isArray(req.existing) ? req.existing : []
        }) }]
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CORPUS_REDUCE_TIMEOUT_MS);
    let res;
    try { res = await postMessages(payload, gate.apiKey, { signal: controller.signal }); }
    finally { clearTimeout(timer); }
    if (!res.ok) return res;

    const data = res.data;
    { const r = refusalResult(data, 'claim relationship proposals'); if (r) return r; }
    if (data && data.stop_reason === 'max_tokens') {
        return { ok: false, error: 'The link-suggestion call hit its output limit before finishing.' };
    }
    const linksInput = toolInputOf(data, tool).input;
    if (linksInput === null) return { ok: false, error: 'The model did not return structured link proposals.' };
    return { ok: true, linksInput, model: (data && data.model) || model, usage: data && data.usage };
}

// ------------------------------------------------------------------
// AI vision pass — the "Describe images" surface
// ------------------------------------------------------------------

// One image, one caption, at most one page of transcription — a dense
// scanned magazine page runs ~3k output tokens, so the cap is pure
// headroom (unproduced tokens are never billed) and only exists so a
// full-page transcription can never be the thing that truncates.
const MAX_VISION_OUTPUT_TOKENS = 32768;
const VISION_TIMEOUT_MS = timeoutForBudget(MAX_VISION_OUTPUT_TOKENS);

/**
 * Non-secret gating snapshot for the reader's "Describe images"
 * control. NOT `getLlmConfig` — its `enabled` bit means `llmAssist`,
 * a different consent (the article TEXT leaving the device); this one
 * is `aiVision` (the article's IMAGES leaving the device). Same key.
 */
export async function getVisionConfig() {
    await loadFlags();
    const [key, model] = await Promise.all([readApiKey(), readModel()]);
    return { enabled: isEnabled('aiVision'), hasKey: key.length > 0, model };
}

/**
 * Describe ONE image: a factual caption always, a verbatim
 * transcription when the image carries legible text (the scanned-page
 * case). One image per call — the lens/audit-module topology: each
 * runtime message resets the MV3 idle timer, and a lost channel costs
 * one retryable image, never the run.
 *
 * Returns the RAW validated-shape result — the reader renders it for
 * per-image human Accept and owns the body merge (vision-notes.js);
 * nothing is saved or published here.
 *
 * @param {object} req
 * @param {string} req.imageBase64   API-ready bytes (vision-image.js)
 * @param {string} req.mediaType     one of VISION_MEDIA_TYPES
 * @param {string} [req.alt]
 * @param {string} [req.captionText]
 * @param {string} [req.articleTitle]
 * @param {string} [req.articleUrl]
 * @returns {Promise<{ok:true, model:string, result:object, usage?:object}
 *                  | {ok:false, error:string, status?:number, timeout?:boolean}>}
 */
export async function runVisionPass(req = {}) {
    await loadFlags();
    if (!isEnabled('aiVision')) {
        return { ok: false, error: 'AI vision is off. Enable it in Options → Advanced → AI vision.' };
    }
    const apiKey = await readApiKey();
    if (!apiKey) {
        return { ok: false, error: 'No Anthropic API key set. Add one in Options → Advanced → LLM assist.' };
    }

    const imageBase64 = typeof req.imageBase64 === 'string' ? req.imageBase64 : '';
    if (!imageBase64) {
        return { ok: false, error: 'No image bytes to describe.' };
    }
    if (!VISION_MEDIA_TYPES.includes(req.mediaType)) {
        return { ok: false, error: `Unsupported image type: ${req.mediaType || '(none)'}.` };
    }

    const model = await readModel();
    const tool = buildVisionTool();
    const payload = {
        model,
        max_tokens: outputBudget(MAX_VISION_OUTPUT_TOKENS, model),
        system: buildVisionSystemPrompt(),
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: buildVisionUserContent({
            imageBase64, mediaType: req.mediaType,
            alt: req.alt || '', captionText: req.captionText || '',
            articleTitle: req.articleTitle || '', articleUrl: req.articleUrl || ''
        }) }]
    };

    // Size only — never the payload (it embeds the image).
    Utils.log('[X-Ray LLM] vision pass:', { model, mediaType: req.mediaType, b64chars: imageBase64.length });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
    let res;
    try {
        res = await postMessages(payload, apiKey, { signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
    if (!res.ok) return res;
    const data = res.data;

    { const r = refusalResult(data, 'a description of this image'); if (r) return r; }
    if (data && data.stop_reason === 'max_tokens') {
        return { ok: false, error: 'The model hit its output limit before finishing this image.' };
    }
    const input = toolInputOf(data, tool).input;
    if (input === null || typeof input.caption !== 'string' || !input.caption.trim()) {
        return { ok: false, error: 'The model did not return a structured image description. Try again.' };
    }

    const usedModel = (data && data.model) || model;
    return {
        ok: true,
        model: usedModel,
        prompt_version: VISION_PROMPT_VERSION,
        result: {
            content_kind: typeof input.content_kind === 'string' ? input.content_kind : 'other',
            caption: input.caption.trim(),
            transcription: typeof input.transcription === 'string' ? input.transcription.trim() : '',
            transcription_complete: input.transcription_complete !== false
        },
        usage: data && data.usage ? data.usage : undefined
    };
}

// ------------------------------------------------------------------
// Lens-reading pass — Phase 16.2
// (docs/MORAL_LENS_JURISDICTION_DESIGN.md §6, §7)
// ------------------------------------------------------------------

/**
 * Non-secret gating snapshot for the reader's lens control. NOT
 * `getLlmConfig` — its `enabled` bit means `llmAssist`, which is a
 * different consent gate; the lens is gated by `moralLens` (and the
 * same key).
 */
export async function getLensConfig() {
    await loadFlags();
    const [key, model] = await Promise.all([readApiKey(), readModel()]);
    return { enabled: isEnabled('moralLens'), hasKey: key.length > 0, model };
}

/** Coerce the reader-supplied claim set into the §7 target shape. */
function normalizeLensClaims(value) {
    if (!Array.isArray(value)) return { error: 'No claims selected for the lens pass.' };
    const claims = [];
    for (const c of value) {
        const id = c && typeof c.id === 'string' ? c.id.trim() : '';
        const text = c && typeof c.text === 'string' ? c.text.trim() : '';
        const type = c && c.type;
        if (!id || !text) return { error: 'Every lens claim needs an id and its verbatim text.' };
        if (!isValidLensAssertionType(type)) {
            return { error: `Invalid lens assertion type "${type}" for claim ${id} (expected one of ${LENS_ASSERTION_TYPES.join(', ')}).` };
        }
        claims.push({ id, text, type });
    }
    if (claims.length === 0) return { error: 'No claims selected for the lens pass.' };
    return { claims };
}

/**
 * Run ONE jurisdiction's lens reading (§6 call topology: the reader
 * sends one xray:lens:read message per empaneled jurisdiction, so
 * partial results render incrementally and each message resets the
 * MV3 idle timer).
 *
 * Gate order is load-bearing:
 *   1. the `moralLens` flag (independent of `llmAssist`),
 *   2. input shape,
 *   3. the PRE-FLIGHT REFUSALS (ungrounded jurisdiction, living-person
 *      guardrail) — before the key gate, so they are testable without
 *      a key and no network is reachable past them,
 *   4. the API key,
 *   5. the bounded network call.
 *
 * Never persists anything: the result is a derived view the reader
 * session-caches (lens-engine.js). Input truncation is surfaced in the
 * grounding report's truncation_flags — never silent (§6).
 *
 * @param {object} req
 * @param {string} req.jurisdictionId   registry id of the jurisdiction
 * @param {string} req.articleText      the target text (hashed as sent)
 * @param {string} [req.articleTitle]
 * @param {string} [req.articleUrl]
 * @param {Array<{id, text, type}>} req.claims  the code-side target set
 * @returns {Promise<{ok:true, model, reading, provenance, target, usage?}
 *                  | {ok:false, error, refused?:boolean, code?:string, status?:number}>}
 */
export async function runLensPass(req = {}) {
    await loadFlags();
    if (!isEnabled('moralLens')) {
        return { ok: false, error: 'Moral lens is off. Enable it in Options → Advanced → Moral lens.' };
    }

    const norm = normalizeLensClaims(req.claims);
    if (norm.error) return { ok: false, error: norm.error };
    const claims = norm.claims;

    const rawText = String(req.articleText || '');
    if (!rawText.trim()) {
        return { ok: false, error: 'No article text to read.' };
    }

    const jurisdictionId = String(req.jurisdictionId || '').trim();
    const jurisdiction = await JurisdictionModel.get(jurisdictionId);
    if (!jurisdiction) {
        return { ok: false, error: `Unknown jurisdiction: ${jurisdictionId || '(none)'} — author it in the registry first.` };
    }

    // Pre-flight hard stops — code, pre-call, BEFORE the key gate (§7).
    const refusal = lensPreflightRefusal(jurisdiction);
    if (refusal) {
        return { ok: false, refused: true, code: refusal.code, error: refusal.message };
    }

    const apiKey = await readApiKey();
    if (!apiKey) {
        return { ok: false, error: 'No Anthropic API key set. Add one in Options → Advanced → LLM assist.' };
    }

    // The pinned input: the text actually sent, hashed as sent. A slice
    // is surfaced in the grounding report — never silent (§6).
    const sentText = rawText.slice(0, MAX_ARTICLE_CHARS);
    const truncationFlags = rawText.length > sentText.length
        ? [`article text truncated to ${MAX_ARTICLE_CHARS} of ${rawText.length} characters — readings cover the truncated text only`]
        : [];
    const contentHash = await articleHash(sentText);

    const model = await readModel();
    const tool = buildLensTool();
    const payload = {
        model,
        max_tokens: outputBudget(MAX_LENS_OUTPUT_TOKENS, model),
        system: buildLensSystemPrompt({
            jurisdiction,
            authorities: admissibleAuthorities(jurisdiction),
            living: treatAsLiving(jurisdiction)
        }),
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{
            role: 'user',
            content: buildLensUserPrompt({
                articleText: sentText,
                articleTitle: req.articleTitle || '',
                articleUrl: req.articleUrl || '',
                claims
            })
        }]
    };

    Utils.log('[X-Ray LLM] lens pass:', { jurisdiction: jurisdictionId, model, claims: claims.length, chars: sentText.length });

    // Bounded call — a hung request must not disable the lens control.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LENS_TIMEOUT_MS);
    let res;
    try {
        res = await postMessages(payload, apiKey, { signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
    if (!res.ok) {
        if (res.timeout) {
            return { ok: false, error: `The lens call for "${jurisdiction.display_name}" timed out. Try again, or select fewer claims.` };
        }
        return res;
    }
    const data = res.data;

    // A guardrail firing is its own state — never the generic
    // "Try again" (§6).
    if (data && data.stop_reason === 'refusal') {
        return {
            ok: false, refused: true, code: 'model-refusal',
            error: 'The model declined to produce this reading (a model-side safety guardrail, not a key or network problem). Try different claims or a different jurisdiction.'
        };
    }
    if (data && data.stop_reason === 'max_tokens') {
        return { ok: false, error: 'The model hit its output limit before finishing this reading. Select fewer claims and try again.' };
    }

    const toolInput = toolInputOf(data, tool).input;
    if (toolInput === null) {
        return { ok: false, error: 'The model did not return a structured reading for this jurisdiction. Run the pass again.' };
    }

    const usedModel = (data && data.model) || model;
    const { reading } = assembleJurisdictionReading({ jurisdiction, toolInput, claims, truncationFlags });

    Utils.log('[X-Ray LLM] lens readings:', reading.readings.length, 'valid,',
        reading.grounding.rejected_readings.length, 'rejected/absent');

    return {
        ok: true,
        model: usedModel,
        reading,
        provenance: { model: usedModel, prompt_version: LENS_PROMPT_VERSION, run_at: new Date().toISOString() },
        target: { content_hash: contentHash, truncated: truncationFlags.length > 0 },
        usage: data && data.usage ? data.usage : undefined
    };
}

// ------------------------------------------------------------------
// LLM extraction assist (Phase 18 C5 — COMPLEX_CONTENT_DESIGN.md §6)
// ------------------------------------------------------------------

// PDF vision over up to 100 pages is the slowest pass this client runs,
// and a 100-page transcription is genuinely large output — this is the
// pass most likely to want the whole budget.
const MAX_EXTRACT_OUTPUT_TOKENS = 64000;
const EXTRACT_TIMEOUT_MS = timeoutForBudget(MAX_EXTRACT_OUTPUT_TOKENS);

/**
 * One extraction pass over an archived PDF's bytes. RETURNS RAW SPANS —
 * the caller (the reader) runs the dual-substrate re-grounding in
 * shared/llm-extract.js, so the honesty mechanism is testable at the
 * seam that applies it and the SW stays a dumb pipe. Same consent gates
 * as every LLM pass; always an explicit user action upstream (the
 * "Reconstruct with LLM…" button — never automatic).
 *
 * @param {object} req
 * @param {string} req.pdfBase64            the document bytes, base64
 * @param {'structure'|'transcription'} req.mode
 * @returns {Promise<{ok:true, model:string, spans:Array, usage?:object}
 *                  | {ok:false, error:string, status?:number, timeout?:boolean}>}
 */
export async function runExtractPass(req = {}) {
    await loadFlags();
    if (!isEnabled('llmAssist')) {
        return { ok: false, error: 'LLM assist is off. Enable it in Options → Advanced → LLM assist.' };
    }
    const apiKey = await readApiKey();
    if (!apiKey) {
        return { ok: false, error: 'No Anthropic API key set. Add one in Options → Advanced → LLM assist.' };
    }

    const pdfBase64 = typeof req.pdfBase64 === 'string' ? req.pdfBase64 : '';
    if (!pdfBase64) {
        return { ok: false, error: 'No document bytes to extract.' };
    }
    const mode = req.mode === 'transcription' ? 'transcription' : 'structure';
    const model = await readModel();
    const extractTool = buildExtractTool();

    const payload = {
        model,
        max_tokens: outputBudget(MAX_EXTRACT_OUTPUT_TOKENS, model),
        system: buildExtractSystemPrompt(mode),
        tools: [extractTool],
        tool_choice: { type: 'tool', name: EXTRACT_TOOL_NAME },
        messages: [{ role: 'user', content: buildExtractUserContent(pdfBase64) }]
    };

    // Size only — never the payload (it embeds the whole document).
    Utils.log('[X-Ray LLM] extract pass:', { model, mode, b64chars: pdfBase64.length });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);
    let res;
    try {
        res = await postMessages(payload, apiKey, { signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
    if (!res.ok) return res;
    const data = res.data;

    if (data && data.stop_reason === 'max_tokens') {
        return { ok: false, error: 'The model hit its output limit before finishing the document. This document is too long for a single extraction pass.' };
    }
    const toolInput = toolInputOf(data, extractTool).input;
    if (toolInput === null || !Array.isArray(toolInput.spans)) {
        return { ok: false, error: 'The model did not return structured spans. Try again.' };
    }

    const usedModel = (data && data.model) || model;
    Utils.log('[X-Ray LLM] extract spans:', toolInput.spans.length);
    return {
        ok: true,
        model: usedModel,
        spans: toolInput.spans,
        usage: data && data.usage ? data.usage : undefined
    };
}

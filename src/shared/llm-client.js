// LLM-assist client — Phase 14.5 (docs/PHASE_14_5_LLM_ASSIST_KICKOFF.md).
//
// The ONLY module that talks to the Anthropic Messages API. It runs in
// the background service worker (page CSP can't open this; the relay
// pool lives here for the same reason), reached via the
// `xray:llm:suggest` message. Everything downstream consumes the
// validated PROPOSALS this returns — it never saves or publishes.
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
import {
    ANTHROPIC_API_URL, ANTHROPIC_VERSION, resolveModel,
    LLM_KEY_STORAGE, LLM_MODEL_STORAGE,
    buildSuggestTool, buildSystemPrompt, buildUserPrompt
} from './llm-prompts.js';
import {
    AUDIT_TOOL_NAME, STANDING_SINGLE_SHOT_CAVEAT,
    buildAuditTool, buildAuditSystemPrompt, buildAuditUserPrompt, assembleAudit,
    buildSingleModuleTool, buildModuleSystemPrompt
} from './audit/audit-prompt.js';
import { MODULE_NAMES } from './audit/findings-schemas.js';

// Re-exported for callers that wrote against the client (the keys are
// defined in the pure prompts module so the Options page can share them).
export { LLM_KEY_STORAGE, LLM_MODEL_STORAGE };

// Bound the article we send, so a pathologically long capture can't
// balloon the request. ~120k chars ≈ well within context for one pass.
const MAX_ARTICLE_CHARS = 120000;
// Output cap for the structured tool call. Generous enough for a rich
// proposal set; if the model still hits it we surface a clear error
// rather than feeding truncated JSON to the validators.
const MAX_OUTPUT_TOKENS = 8192;
// A full eight-module audit is much larger than a proposal set (eight
// nested findings payloads in one tool call), so it gets its own cap.
const MAX_AUDIT_OUTPUT_TOKENS = 16384;
// The per-module ("thorough") path emits ONE module's findings per call,
// so a smaller cap is plenty and keeps each call cheap.
const MAX_MODULE_OUTPUT_TOKENS = 8192;

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
 * @returns {Promise<{ok:true, data:object} | {ok:false, error:string, status?:number}>}
 */
async function postMessages(payload, apiKey) {
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
            body: JSON.stringify(payload)
        });
    } catch (err) {
        // Network failure — DO NOT include the key or request body.
        Utils.error('[X-Ray LLM] network error:', err && err.message);
        return { ok: false, error: 'Could not reach the Anthropic API (network error). Check your connection and host permissions.' };
    }

    if (!resp.ok) {
        let bodyText = '';
        try { bodyText = await resp.text(); } catch (_) { /* ignore */ }
        const error = mapHttpError(resp.status, bodyText);
        Utils.error('[X-Ray LLM] HTTP', resp.status, error);
        return { ok: false, error, status: resp.status };
    }

    let data;
    try {
        data = await resp.json();
    } catch (_) {
        return { ok: false, error: 'Anthropic returned an unreadable response.' };
    }
    return { ok: true, data };
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

// ------------------------------------------------------------------
// Public entry point
// ------------------------------------------------------------------

/**
 * Run one user-invoked suggestion pass.
 *
 * @param {object} req
 * @param {string} [req.task='all']     one of SUGGEST_TASKS
 * @param {string} req.articleText      the captured article body text
 * @param {string} [req.articleUrl]
 * @param {string} [req.articleTitle]
 * @param {string} [req.context]        optional extra context
 * @returns {Promise<{ok:true, model:string, proposals:Array, usage?:object}
 *                  | {ok:false, error:string, status?:number}>}
 */
export async function runSuggestionPass(req = {}) {
    await loadFlags();
    if (!isEnabled('llmAssist')) {
        return { ok: false, error: 'LLM assist is off. Enable it in Options → Advanced → LLM assist.' };
    }

    const apiKey = await readApiKey();
    if (!apiKey) {
        return { ok: false, error: 'No Anthropic API key set. Add one in Options → Advanced → LLM assist.' };
    }

    const articleText = String(req.articleText || '').slice(0, MAX_ARTICLE_CHARS);
    if (!articleText.trim()) {
        return { ok: false, error: 'No article text to analyze.' };
    }

    const model = await readModel();
    const task  = req.task || 'all';
    const system = buildSystemPrompt({ task, url: req.articleUrl || '', title: req.articleTitle || '' });
    const userContent = buildUserPrompt({ articleText, context: req.context || '' });
    const tool = buildSuggestTool();

    const payload = {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        tools: [tool],
        // Force the structured tool so we always get parseable JSON.
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: userContent }]
    };

    Utils.log('[X-Ray LLM] suggestion pass:', { task, model, chars: articleText.length });

    const res = await postMessages(payload, apiKey);
    if (!res.ok) return res;
    const data = res.data;

    if (data && data.stop_reason === 'max_tokens') {
        return { ok: false, error: 'The model hit its output limit before finishing. Try a shorter article or fewer tasks.' };
    }

    const proposals = extractProposals(data);
    if (proposals === null) {
        return { ok: false, error: 'The model did not return a structured proposal set. Try again.' };
    }

    Utils.log('[X-Ray LLM] proposals:', proposals.length);
    return {
        ok: true,
        model: (data && data.model) || model,
        proposals,
        usage: data && data.usage ? data.usage : undefined
    };
}

/**
 * Pull the `propose_capture` tool_use input out of a Messages response.
 * Returns the proposals array, or null if no usable tool call was found.
 * Exported for unit tests (no network involved).
 */
export function extractProposals(data) {
    const blocks = (data && Array.isArray(data.content)) ? data.content : [];
    for (const block of blocks) {
        if (block && block.type === 'tool_use' && block.name === 'propose_capture') {
            const input = block.input || {};
            if (Array.isArray(input.proposals)) return input.proposals;
            return [];
        }
    }
    return null;
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

    // Thorough mode: one independent call per dimension, each with its
    // full vendored methodology and its own output budget.
    if (req.mode === 'per_module') {
        return runPerModuleAudit({ apiKey, model, markdown, req });
    }

    const system = buildAuditSystemPrompt({ url: req.articleUrl || '', title: req.articleTitle || '' });
    const userContent = buildAuditUserPrompt({ articleText: markdown });
    const tool = buildAuditTool();

    const payload = {
        model,
        max_tokens: MAX_AUDIT_OUTPUT_TOKENS,
        system,
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: userContent }]
    };

    Utils.log('[X-Ray LLM] audit pass:', { model, chars: markdown.length });

    const res = await postMessages(payload, apiKey);
    if (!res.ok) return res;
    const data = res.data;

    if (data && data.stop_reason === 'max_tokens') {
        return { ok: false, error: 'The model hit its output limit before finishing the audit. Try a shorter article.' };
    }

    const toolInput = extractToolInput(data, AUDIT_TOOL_NAME);
    if (toolInput === null) {
        return { ok: false, error: 'The model did not return a structured audit. Try again.' };
    }

    const usedModel = (data && data.model) || model;
    let audit;
    try {
        audit = await assembleAudit({
            toolInput, model: usedModel, markdown, metadata: req.metadata || {},
            standingCaveat: STANDING_SINGLE_SHOT_CAVEAT
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
 * Thorough audit: eight independent module calls, run in parallel (they
 * are blind to each other — that's the point), each with its full
 * methodology prompt and a single-module tool. Successful modules are
 * collected and handed to the SAME assembleAudit; a failed call simply
 * leaves its module absent, which assembleAudit records as a FAILED
 * result (the rest still produce an aggregate). No standing single-shot
 * caveat — this IS the rigorous path.
 */
async function runPerModuleAudit({ apiKey, model, markdown, req }) {
    Utils.log('[X-Ray LLM] thorough audit:', { model, chars: markdown.length, modules: MODULE_NAMES.length });
    const userContent = buildAuditUserPrompt({ articleText: markdown });

    const results = await Promise.all(MODULE_NAMES.map(async (name) => {
        const tool = buildSingleModuleTool(name);
        const payload = {
            model,
            max_tokens: MAX_MODULE_OUTPUT_TOKENS,
            system: buildModuleSystemPrompt(name, { url: req.articleUrl || '', title: req.articleTitle || '' }),
            tools: [tool],
            tool_choice: { type: 'tool', name: tool.name },
            messages: [{ role: 'user', content: userContent }]
        };
        const res = await postMessages(payload, apiKey);
        if (!res.ok) { Utils.error('[X-Ray LLM] module failed', name, res.error); return { name }; }
        const data = res.data;
        if (data && data.stop_reason === 'max_tokens') { Utils.error('[X-Ray LLM] module truncated', name); return { name }; }
        const input = extractToolInput(data, tool.name);
        if (input === null) { Utils.error('[X-Ray LLM] module no tool output', name); return { name }; }
        return { name, findings: input, usedModel: (data && data.model) || model };
    }));

    const modules = {};
    let okCount = 0;
    let usedModel = model;
    for (const r of results) {
        if (r.findings) { modules[r.name] = r.findings; usedModel = r.usedModel || usedModel; okCount += 1; }
    }
    if (okCount === 0) {
        return { ok: false, error: 'Every module call failed — check your connection and key, then try again.' };
    }

    let audit;
    try {
        audit = await assembleAudit({
            toolInput: { modules }, model: usedModel, markdown,
            metadata: req.metadata || {}, standingCaveat: null
        });
    } catch (err) {
        Utils.error('[X-Ray LLM] thorough assembly failed:', err && err.message);
        return { ok: false, error: 'Could not assemble the audit from the model output.' };
    }

    Utils.log('[X-Ray LLM] thorough modules ok:', okCount);
    return { ok: true, model: usedModel, audit, modulesOk: okCount };
}

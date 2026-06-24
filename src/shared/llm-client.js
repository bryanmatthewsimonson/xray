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

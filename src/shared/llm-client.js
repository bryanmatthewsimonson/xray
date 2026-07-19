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
    LLM_KEY_STORAGE, LLM_MODEL_STORAGE, LLM_SUGGEST_KINDS_STORAGE,
    buildSuggestTool, buildSystemPrompt, buildUserPrompt,
    normalizeSuggestKinds, categoryOfProposalKind
} from './llm-prompts.js';
import {
    AUDIT_TOOL_NAME, STANDING_SINGLE_SHOT_CAVEAT,
    buildAuditTool, buildAuditSystemPrompt, buildAuditUserPrompt, assembleAudit,
    buildSingleModuleTool, buildModuleSystemPrompt
} from './audit/audit-prompt.js';
import {
    EXTRACT_TOOL_NAME, buildExtractTool, buildExtractSystemPrompt, buildExtractUserContent
} from './llm-extract-prompts.js';
import { MAX_AUDIT_INPUT_CHARS } from './audit/assemble.js';
import { MODULE_NAMES } from './audit/findings-schemas.js';
import {
    LENS_PROMPT_VERSION, LENS_TOOL_NAME,
    buildLensTool, buildLensSystemPrompt, buildLensUserPrompt
} from './lens-prompt.js';
import { lensPreflightRefusal, assembleJurisdictionReading } from './lens-engine.js';
import { JurisdictionModel, treatAsLiving, admissibleAuthorities } from './jurisdiction-model.js';
import { isValidLensAssertionType, LENS_ASSERTION_TYPES } from './lens-taxonomy.js';
import { articleHash } from './audit/article-hash.js';
import {
    MAP_TOOL_NAME, REDUCE_TOOL_NAME,
    MAX_MEMBER_INPUT_CHARS, MAX_MAP_OUTPUT_TOKENS, MAX_REDUCE_OUTPUT_TOKENS,
    MAX_HYPOTHESIS_EDGE_OUTPUT_TOKENS,
    buildMapTool, buildMapSystemPrompt, buildMapUserPrompt,
    buildReduceTool, buildReduceSystemPrompt, buildReduceUserPrompt,
    buildHypothesisEdgeTool, buildHypothesisEdgeSystemPrompt, buildHypothesisEdgeUserPrompt
} from './corpus-prompts.js';

// Re-exported for callers that wrote against the client (the keys are
// defined in the pure prompts module so the Options page can share them).
export { LLM_KEY_STORAGE, LLM_MODEL_STORAGE };

// Bound the article we send, so a pathologically long capture can't
// balloon the request. Aliases the shared auditable bound — the READER
// slices with auditableSlice before hashing and sending, so this
// SW-side slice is a defensive no-op on the audit path (the hash gate
// covers exactly the text that was scored).
const MAX_ARTICLE_CHARS = MAX_AUDIT_INPUT_CHARS;
// Output cap for the structured tool call. A dense, long capture — a book
// chapter is the pathological case — yields a big proposal set (entities +
// claims + optional relationships/assessments), and 8192 truncated it
// ("hit its output limit before finishing"). 32768 matches the extraction
// cap, fits a rich proposal set with headroom, and stays well under every
// current model's per-request output limit; the suggest call carries no
// client-side timeout, so a longer completion is not aborted. If the model
// still hits it we surface a clear error rather than feeding truncated JSON
// to the validators.
const MAX_OUTPUT_TOKENS = 32768;
// A full eight-module audit is much larger than a proposal set (eight
// nested findings payloads in one tool call), so it gets its own cap.
const MAX_AUDIT_OUTPUT_TOKENS = 16384;
// The per-module ("thorough") path emits ONE module's findings per call,
// so a smaller cap is plenty and keeps each call cheap.
const MAX_MODULE_OUTPUT_TOKENS = 8192;
// A lens pass emits ONE jurisdiction's readings per call (§6 call
// topology), so the per-module cap size is right for it too.
const MAX_LENS_OUTPUT_TOKENS = 8192;
// Audit call bounds. A single-shot (quick) audit emits up to 16384
// output tokens — the lens's 120s would abort legitimate calls, so it
// gets a generous cap; a per-module call emits one module and fits the
// lens-sized window. Both exist so a hung request can never wedge the
// reader's audit controls (the reader races its own slightly-longer
// timeout on top).
const AUDIT_TIMEOUT_MS = 300000;
const MODULE_TIMEOUT_MS = 120000;
// Each lens call is bounded so a hung request cannot permanently
// disable the reader's lens control (§6).
const LENS_TIMEOUT_MS = 120000;

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
 * @returns {Promise<{ok:true, data:object} | {ok:false, error:string, status?:number, timeout?:boolean}>}
 */
async function postMessages(payload, apiKey, { signal } = {}) {
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
            body: JSON.stringify(payload),
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
    } catch (err) {
        // The abort can also fire mid-body — that is still a timeout,
        // not a malformed response.
        if (err && err.name === 'AbortError') {
            return { ok: false, timeout: true, error: 'The Anthropic call was aborted before completing (timeout).' };
        }
        return { ok: false, error: 'Anthropic returned an unreadable response.' };
    }
    return { ok: true, data };
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

    // Which artifact categories to propose. Default ON = entities +
    // claims (extraction); relationships / assessments / findings are
    // opt-in via Options. We both SCOPE the prompt to the enabled kinds
    // (fewer off-target proposals, smaller prompt) and FILTER the result
    // (defense in depth — the model can't smuggle a disabled kind past it).
    const enabledKinds = normalizeSuggestKinds(
        (await storageGetRaw([LLM_SUGGEST_KINDS_STORAGE]))[LLM_SUGGEST_KINDS_STORAGE]);
    if (enabledKinds.length === 0) {
        return { ok: false, error: 'No suggestion types are enabled. Turn some on in Options → Advanced → LLM assist.' };
    }

    const model = await readModel();
    const system = buildSystemPrompt({ tasks: enabledKinds, url: req.articleUrl || '', title: req.articleTitle || '' });
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

    Utils.log('[X-Ray LLM] suggestion pass:', { kinds: enabledKinds, model, chars: articleText.length });

    const res = await postMessages(payload, apiKey);
    if (!res.ok) return res;
    const data = res.data;

    { const r = refusalResult(data, 'capture suggestions for this article'); if (r) return r; }
    if (data && data.stop_reason === 'max_tokens') {
        return { ok: false, error: 'The model hit its output limit before finishing. This can happen on a very long or dense capture — try narrowing the suggestion types in Options → Advanced → LLM assist, or run Suggest on a shorter section.' };
    }

    const proposals = extractProposals(data);
    if (proposals === null) {
        return { ok: false, error: 'The model did not return a structured proposal set. Try again.' };
    }

    // Drop anything outside the enabled categories (the model occasionally
    // volunteers an off-target kind even when unasked).
    const filtered = proposals.filter((p) => enabledKinds.includes(categoryOfProposalKind(p && p.kind)));

    Utils.log('[X-Ray LLM] proposals:', filtered.length, 'of', proposals.length);
    return {
        ok: true,
        model: (data && data.model) || model,
        proposals: filtered,
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
        max_tokens: MAX_AUDIT_OUTPUT_TOKENS,
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
    if (!MODULE_NAMES.includes(name)) {
        return { ok: false, error: `Unknown audit module: ${name || '(none)'}` };
    }
    // Defensive no-op when the reader pre-sliced (the hash-gate contract).
    const markdown = String(req.markdown || '').slice(0, MAX_ARTICLE_CHARS);
    if (!markdown.trim()) {
        return { ok: false, module: name, error: 'No article text to audit.' };
    }

    const model = await readModel();
    const tool = buildSingleModuleTool(name);
    const payload = {
        model,
        max_tokens: MAX_MODULE_OUTPUT_TOKENS,
        system: buildModuleSystemPrompt(name, { url: req.articleUrl || '', title: req.articleTitle || '' }),
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: buildAuditUserPrompt({ articleText: markdown }) }]
    };

    Utils.log('[X-Ray LLM] audit module:', { module: name, model, chars: markdown.length });

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
    const findings = extractToolInput(data, tool.name);
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

const CORPUS_MAP_TIMEOUT_MS = 120000;
// The reduce is the ONE long single fetch in the corpus flow (the map phase
// is many short calls). With MAX_REDUCE_OUTPUT_TOKENS raised to 32768, a
// full breadth brief can generate ~20-25k tokens, which on the slower
// (Opus-tier) models runs ~350-455s. The portal keeps the service worker
// alive across the whole run (synthesis-block startSwKeepalive), so this
// AbortController — not the SW lifetime — is the limiter; 8 min gives the
// largest breadth briefs headroom rather than trading a token-cap failure
// for an abort or an SW teardown ("no response").
const CORPUS_REDUCE_TIMEOUT_MS = 480000;

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
 *
 * @param {object} req { member_id, memberText, memberMeta?, claimsDigest?, caseName?, scopeQuestion? }
 */
export async function runCorpusMapPass(req = {}) {
    const gate = await corpusGate();
    if (gate.error) return { ok: false, member_id: req.member_id, error: gate.error };

    const memberText = String(req.memberText || '').slice(0, MAX_MEMBER_INPUT_CHARS);
    if (!memberText.trim()) return { ok: false, member_id: req.member_id, error: 'No article text to analyze.' };

    const model = await readModel();
    const tool = buildMapTool();
    const payload = {
        model,
        max_tokens: MAX_MAP_OUTPUT_TOKENS,
        system: buildMapSystemPrompt({ caseName: req.caseName || '', scopeQuestion: req.scopeQuestion || '' }),
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: buildMapUserPrompt({
            memberText, memberMeta: req.memberMeta || {}, claimsDigest: req.claimsDigest || ''
        }) }]
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CORPUS_MAP_TIMEOUT_MS);
    let res;
    try { res = await postMessages(payload, gate.apiKey, { signal: controller.signal }); }
    finally { clearTimeout(timer); }
    if (!res.ok) return { ...res, member_id: req.member_id };

    const data = res.data;
    { const r = refusalResult(data, 'an extract for this article'); if (r) return { ...r, member_id: req.member_id }; }
    if (data && data.stop_reason === 'max_tokens') {
        return { ok: false, member_id: req.member_id, error: 'The map call hit its output limit before finishing.' };
    }
    const extract = extractToolInput(data, tool.name);
    if (extract === null) return { ok: false, member_id: req.member_id, error: 'The model did not return a structured extract.' };
    return { ok: true, member_id: req.member_id, extract, model: (data && data.model) || model, usage: data && data.usage };
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
        max_tokens: MAX_REDUCE_OUTPUT_TOKENS,
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
    const briefInput = extractToolInput(data, tool.name);
    if (briefInput === null) return { ok: false, error: 'The model did not return a structured brief.' };
    return { ok: true, briefInput, model: (data && data.model) || model, usage: data && data.usage };
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
        max_tokens: MAX_HYPOTHESIS_EDGE_OUTPUT_TOKENS,
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
    const edgesInput = extractToolInput(data, tool.name);
    if (edgesInput === null) return { ok: false, error: 'The model did not return structured edge proposals.' };
    return { ok: true, edgesInput, model: (data && data.model) || model, usage: data && data.usage };
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
        max_tokens: MAX_LENS_OUTPUT_TOKENS,
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

    const toolInput = extractToolInput(data, LENS_TOOL_NAME);
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

// PDF vision over up to 100 pages is the slowest pass this client
// runs — same ceiling as the audit, no lower.
const EXTRACT_TIMEOUT_MS = 300000;
const MAX_EXTRACT_OUTPUT_TOKENS = 32768;

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

    const payload = {
        model,
        max_tokens: MAX_EXTRACT_OUTPUT_TOKENS,
        system: buildExtractSystemPrompt(mode),
        tools: [buildExtractTool()],
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
    const toolInput = extractToolInput(data, EXTRACT_TOOL_NAME);
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

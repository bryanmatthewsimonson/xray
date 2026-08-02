// Transcriber client — the ONLY module that talks to the two loopback
// services behind the "Transcribe locally" feature: the companion
// transcription API (companion/transcriber/, default 127.0.0.1:8756)
// and the optional LM Studio OpenAI-compatible endpoint for drafting
// claim candidates (default localhost:1234). Runs in the background
// service worker (the llm-client.js topology: pages reach it via
// xray:transcribe:* messages).
//
// Security invariant: both base URLs are PINNED TO LOOPBACK literals.
// Only the companion PORT and the LM Studio path/port are
// configurable — validating a fully user-configurable URL against
// itself would be circular, and a tampered stored value must never
// exfiltrate transcript text to a remote host.
//
// Every function returns result objects ({ok: true, …} /
// {ok: false, error}), never throws — the house LLM-client contract.

import { loadFlags, isEnabled } from './metadata/feature-flags.js';

export const TRANSCRIBER_DEFAULT_PORT = 8756;
export const TRANSCRIBER_PORT_STORAGE = 'xray:transcriber:port';
export const TRANSCRIBER_TOKEN_STORAGE = 'xray:transcriber:token';
export const LMSTUDIO_URL_STORAGE = 'xray:lmstudio:url';
export const LMSTUDIO_MODEL_STORAGE = 'xray:lmstudio:model';
export const LMSTUDIO_DEFAULT_URL = 'http://localhost:1234/v1';
export const LMSTUDIO_DEFAULT_MODEL = 'qwen/qwen3.6-27b';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

const START_HINT = 'Start it with `uv run xray-transcriber` — setup guide: companion/transcriber/README.md.';

// ------------------------------------------------------------------
// Storage + URL plumbing
// ------------------------------------------------------------------

function storageArea() {
    const api = (typeof browser !== 'undefined' && browser.storage) ? browser
        : (typeof chrome !== 'undefined' ? chrome : null);
    return api && api.storage && api.storage.local ? api.storage.local : null;
}

function storageGet(keys) {
    return new Promise((resolve) => {
        const area = storageArea();
        if (!area) { resolve({}); return; }
        try { area.get(keys, (res) => resolve(res || {})); }
        catch (_) { resolve({}); }
    });
}

/** Sanitize a stored port value; anything unusable → the default.
 *  Strict digit form — parseInt('80.5x') === 80 would silently accept
 *  a typo as a different port. */
export function sanitizePort(value) {
    const s = String(value ?? '').trim();
    if (!/^\d{1,5}$/.test(s)) return TRANSCRIBER_DEFAULT_PORT;
    const n = Number(s);
    return n >= 1 && n <= 65535 ? n : TRANSCRIBER_DEFAULT_PORT;
}

export async function getTranscriberPort() {
    const res = await storageGet([TRANSCRIBER_PORT_STORAGE]);
    return sanitizePort(res[TRANSCRIBER_PORT_STORAGE]);
}

export function transcriberBaseUrl(port) {
    return `http://127.0.0.1:${sanitizePort(port)}`;
}

/**
 * Enforce the loopback pin. Returns the parsed URL or null. Exported
 * for tests and for the LM Studio URL sanitizer below.
 */
export function loopbackUrl(urlString) {
    let u = null;
    try { u = new URL(String(urlString || '')); } catch (_) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!LOOPBACK_HOSTS.has(u.hostname.toLowerCase())) return null;
    return u;
}

/** The stored LM Studio base, pinned to loopback; bad values → default. */
export async function getLmStudioConfig() {
    const res = await storageGet([LMSTUDIO_URL_STORAGE, LMSTUDIO_MODEL_STORAGE]);
    const stored = String(res[LMSTUDIO_URL_STORAGE] || '').trim();
    const url = (stored && loopbackUrl(stored)) ? stored.replace(/\/+$/, '') : LMSTUDIO_DEFAULT_URL;
    const model = String(res[LMSTUDIO_MODEL_STORAGE] || '').trim() || LMSTUDIO_DEFAULT_MODEL;
    return { url, model };
}

// ------------------------------------------------------------------
// Companion API
// ------------------------------------------------------------------

function unreachable(port) {
    return {
        ok: false,
        unreachable: true,
        error: `Companion transcription service not reachable at ${transcriberBaseUrl(port)}. ${START_HINT}`
    };
}

async function companionFetch(path, { port, init = {}, timeoutMs = 0, fetchFn = fetch } = {}) {
    const base = transcriberBaseUrl(port);
    const opts = { ...init };
    // Optional shared secret (the companion's TRANSCRIBER_TOKEN):
    // sent on every call when configured — the server exempts only
    // /health, so a set-but-unsent token would brick the feature.
    const tokRes = await storageGet([TRANSCRIBER_TOKEN_STORAGE]);
    const token = String(tokRes[TRANSCRIBER_TOKEN_STORAGE] || '').trim();
    if (token) {
        opts.headers = { ...(opts.headers || {}), 'X-Transcriber-Token': token };
    }
    if (timeoutMs > 0 && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
        opts.signal = AbortSignal.timeout(timeoutMs);
    }
    let resp;
    try {
        resp = await fetchFn(`${base}${path}`, opts);
    } catch (_) {
        return unreachable(port);
    }
    let body = null;
    try { body = await resp.json(); } catch (_) { /* non-JSON error body */ }
    if (!resp.ok) {
        const detail = (body && (body.detail || body.error)) || `HTTP ${resp.status}`;
        return { ok: false, status: resp.status, error: `Transcriber request failed: ${detail}` };
    }
    return { ok: true, body };
}

/**
 * POST /transcribe. The companion dedupes an active job for the same
 * video, so re-sending after an SW restart is safe.
 */
export async function startTranscription(videoUrl, { port, fetchFn = fetch } = {}) {
    const res = await companionFetch('/transcribe', {
        port,
        fetchFn,
        init: {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url: String(videoUrl || '') })
        }
    });
    if (!res.ok) return res;
    const jobId = res.body && res.body.job_id;
    if (!jobId) return { ok: false, error: 'Transcriber returned no job id.' };
    return { ok: true, jobId };
}

/** GET /jobs/<id> — the poll unit. */
export async function getJobStatus(jobId, { port, fetchFn = fetch } = {}) {
    if (!jobId) return { ok: false, error: 'missing job id' };
    const res = await companionFetch(`/jobs/${encodeURIComponent(jobId)}`, { port, fetchFn });
    if (!res.ok) return res;
    return { ok: true, job: res.body };
}

/** GET /health with a short timeout — the reachability probe. */
export async function pingTranscriber({ port, fetchFn = fetch, timeoutMs = 3000 } = {}) {
    const res = await companionFetch('/health', { port, fetchFn, timeoutMs });
    if (!res.ok) return res;
    return { ok: true, health: res.body };
}

/**
 * The non-secret gate snapshot for UI setup (the xray:llm:config
 * shape): storage-only, deliberately NO network probe — reachability
 * is its own message (xray:transcribe:ping) so button setup can never
 * hang on a dead socket.
 */
export async function getTranscribeConfig() {
    await loadFlags();
    const port = await getTranscriberPort();
    const lm = await getLmStudioConfig();
    return {
        enabled: isEnabled('localTranscription'),
        port,
        drafts: { enabled: isEnabled('transcriptClaimDrafts'), url: lm.url, model: lm.model }
    };
}

// ------------------------------------------------------------------
// LM Studio claim-candidate drafts (optional post-pass)
// ------------------------------------------------------------------

const DRAFT_SYSTEM_PROMPT = [
    'You extract checkable factual claims from a speaker-diarized video transcript.',
    'Return ONLY a JSON array, no prose, no code fences. Each element:',
    '{"text": "<the claim in one clear sentence>", "quote": "<ONE contiguous VERBATIM span',
    'copied character-for-character from the transcript that grounds the claim>"}.',
    'Rules: 5-20 claims; quotes MUST be exact substrings of the transcript (they are',
    'machine-checked and a claim whose quote cannot be located is discarded); prefer',
    'specific, falsifiable statements (numbers, events, attributions) over vibes;',
    'never quote the timestamp links or speaker labels, only spoken words.'
].join(' ');

const DRAFT_MAX_PROPOSALS = 60;
const DRAFT_TIMEOUT_MS = 300000;

// Long transcripts overflow LM Studio's configured context (an
// hour-plus episode is ~100k+ chars; LM Studio rejects with HTTP 400).
// The pass therefore runs per-WINDOW — one SW message per window, the
// audit per-module topology — and a window that still 400s is halved
// and retried, so the pass self-tunes to whatever context length the
// user gave the model without a config knob.
export const DRAFT_WINDOW_CHARS = 16000;
export const DRAFT_MIN_WINDOW_CHARS = 4000;

/**
 * Split a transcript into windows of at most `windowChars`, breaking
 * on paragraph boundaries so quotes never straddle a window edge.
 * Every window is a VERBATIM substring of the input — accepted quotes
 * still ground against the full article text. Pure; exported for tests.
 */
export function chunkTranscript(text, windowChars = DRAFT_WINDOW_CHARS) {
    const body = String(text || '');
    if (body.length <= windowChars) return body.trim() ? [body] : [];
    const paras = body.split('\n\n');
    const out = [];
    let cur = '';
    for (const p of paras) {
        // A single paragraph over the window is split hard — rare
        // (paragraph budgets cap at ~900 chars) but never fatal.
        if (p.length > windowChars) {
            if (cur.trim()) { out.push(cur); cur = ''; }
            for (let i = 0; i < p.length; i += windowChars) out.push(p.slice(i, i + windowChars));
            continue;
        }
        const next = cur ? `${cur}\n\n${p}` : p;
        if (next.length > windowChars) {
            if (cur.trim()) out.push(cur);
            cur = p;
        } else {
            cur = next;
        }
    }
    if (cur.trim()) out.push(cur);
    return out;
}

/** Parse the model's reply into propose_capture-shaped claim proposals.
 *  Tolerates code fences and stray prose around the array. Exported
 *  for tests. */
export function coerceDraftProposals(replyText, transcriptText) {
    const raw = String(replyText || '');
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start === -1 || end <= start) return [];
    let parsed;
    try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch (_) { return []; }
    if (!Array.isArray(parsed)) return [];
    const body = String(transcriptText || '');
    const out = [];
    for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const text = String(item.text || '').trim();
        const quote = String(item.quote || '').trim();
        if (!text || !quote) continue;
        // Pre-filter obvious hallucinations; the review modal's
        // grounding index remains the real firewall.
        if (body && !body.includes(quote)) continue;
        out.push({ kind: 'claim', ref: `C${out.length + 1}`, text, quote, about: [], is_key: false });
        if (out.length >= DRAFT_MAX_PROPOSALS) break;
    }
    return out;
}

/**
 * Ask LM Studio for claim candidates over a finished transcript.
 * Free-tier local call — degrades to {ok:false, error} when LM Studio
 * is not running; never throws.
 */
export async function draftClaimCandidates({ transcriptText, title }, { fetchFn = fetch } = {}) {
    await loadFlags();
    if (!isEnabled('transcriptClaimDrafts')) {
        return { ok: false, error: 'Transcript claim drafts are off. Enable them in Options → Advanced → Local transcription.' };
    }
    const { url, model } = await getLmStudioConfig();
    const payload = {
        model,
        messages: [
            { role: 'system', content: DRAFT_SYSTEM_PROMPT },
            { role: 'user', content: `Transcript of "${String(title || 'video')}" follows.\n\n${String(transcriptText || '')}` }
        ],
        temperature: 0.2,
        stream: false
    };
    let resp;
    try {
        const opts = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload)
        };
        if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
            opts.signal = AbortSignal.timeout(DRAFT_TIMEOUT_MS);
        }
        resp = await fetchFn(`${url}/chat/completions`, opts);
    } catch (err) {
        if (err && err.name === 'TimeoutError') {
            return { ok: false, timeout: true, error: 'LM Studio call timed out. Long transcripts on a busy GPU can exceed the window — try again once the model is idle.' };
        }
        return { ok: false, unreachable: true, error: `LM Studio not reachable at ${url}. Start LM Studio, load the model, and enable its local server.` };
    }
    if (!resp.ok) {
        // Surface LM Studio's own reason — its 400 bodies name the cause
        // (model not loaded, context length exceeded, …).
        let detail = '';
        try {
            const body = await resp.json();
            detail = String((body && (body.error && body.error.message || body.error)) || '').trim();
        } catch (_) { /* body unreadable — status alone */ }
        const hint = resp.status === 400 && !detail
            ? ' Most often the prompt overflowed the model\'s context length.'
            : '';
        return {
            ok: false,
            status: resp.status,
            error: `LM Studio request failed (HTTP ${resp.status})${detail ? `: ${detail}` : '.'}${hint}`
        };
    }
    let data = null;
    try { data = await resp.json(); } catch (_) {
        return { ok: false, error: 'LM Studio returned an unreadable response.' };
    }
    const reply = data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content : '';
    // An empty window is a RESULT, not a failure — the chunked pass
    // aggregates; a transcript segment can genuinely hold no claims.
    return { ok: true, proposals: coerceDraftProposals(reply, transcriptText), model };
}

/**
 * The chunked drafts pass — the READER-side orchestrator (one
 * xray:transcribe:claims message per window; each delivery resets the
 * MV3 idle timer, the audit per-module topology). A window that 400s
 * re-chunks at half size and retries down to DRAFT_MIN_WINDOW_CHARS,
 * so the pass adapts to whatever context length the LM Studio model
 * was loaded with. Injectable `send` keeps it node-testable.
 *
 * @param {{transcriptText: string, title: string,
 *          send: (request: object) => Promise<object>,
 *          onProgress?: (p: {done: number, total: number}) => void,
 *          windowChars?: number}} p
 * @returns {Promise<{ok: boolean, proposals?: Array, model?: string, failures?: number, error?: string}>}
 */
export async function runDraftPass({ transcriptText, title, send, onProgress = () => {}, windowChars = DRAFT_WINDOW_CHARS } = {}) {
    const windows = chunkTranscript(transcriptText, windowChars);
    if (windows.length === 0) return { ok: false, error: 'Nothing to analyze.' };

    const seen = new Set();
    const all = [];
    let model = '';
    let failures = 0;
    let lastError = '';
    let done = 0;
    onProgress({ done, total: windows.length });

    for (const window of windows) {
        // Work queue for THIS window: halved re-chunks push back on.
        const queue = [{ text: window, size: windowChars }];
        while (queue.length) {
            const { text, size } = queue.shift();
            let resp;
            try { resp = await send({ transcriptText: text, title }); }
            catch (e) { resp = { ok: false, error: (e && e.message) || String(e) }; }
            if (resp && resp.ok) {
                model = resp.model || model;
                for (const p of resp.proposals || []) {
                    const key = String(p.quote || '').replace(/\s+/g, ' ').trim().toLowerCase();
                    if (!key || seen.has(key)) continue;
                    seen.add(key);
                    all.push({ ...p, ref: `C${all.length + 1}` });
                }
            } else if (resp && resp.status === 400 && Math.floor(size / 2) >= DRAFT_MIN_WINDOW_CHARS) {
                const half = Math.floor(size / 2);
                queue.unshift(...chunkTranscript(text, half).map((t) => ({ text: t, size: half })));
                continue;
            } else {
                failures += 1;
                lastError = (resp && resp.error) || 'LM Studio call failed.';
                if (resp && resp.status === 400) {
                    lastError += ' The window was already at the minimum size — raise the model\'s context length in LM Studio.';
                }
            }
        }
        done += 1;
        onProgress({ done, total: windows.length });
        if (all.length >= DRAFT_MAX_PROPOSALS) break;
    }

    if (all.length === 0) {
        return failures > 0
            ? { ok: false, failures, error: lastError }
            : { ok: false, error: 'The model found no claim candidates in this transcript.' };
    }
    return { ok: true, proposals: all.slice(0, DRAFT_MAX_PROPOSALS), model, failures };
}

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
import { SUGGESTABLE_ENTITY_TYPES, LLM_SUGGEST_KINDS_STORAGE, normalizeSuggestKinds } from './llm-prompts.js';
import { youtubeVideoId } from './media-key.js';

export const TRANSCRIBER_DEFAULT_PORT = 8756;
export const TRANSCRIBER_PORT_STORAGE = 'xray:transcriber:port';
export const TRANSCRIBER_TOKEN_STORAGE = 'xray:transcriber:token';
// Engine preference + cloud API keys (2026-08-02, maintainer decision
// reversing the launch posture): keys live in chrome.storage.local —
// the Anthropic LLM key precedent — and ride each POST /transcribe so
// switching engines needs no service restart. The companion holds them
// in memory only (child env, never disk). Options' "erase all" clears
// them like every other secret.
export const TRANSCRIBER_ENGINE_STORAGE = 'xray:transcriber:engine';
export const ASSEMBLYAI_KEY_STORAGE = 'xray:transcriber:assemblyai:key';
export const DEEPGRAM_KEY_STORAGE = 'xray:transcriber:deepgram:key';

/** Engine preference values: a concrete engine, or 'ask' = the reader
 *  offers the picker on every transcribe. */
export const TRANSCRIBE_ENGINES = ['local', 'assemblyai', 'deepgram'];

export function normalizeEngine(value) {
    const v = String(value || '').trim().toLowerCase();
    return (TRANSCRIBE_ENGINES.includes(v) || v === 'ask') ? v : 'local';
}
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

/** The stored cloud key for a provider, or '' (local needs none). */
async function storedProviderKey(provider) {
    const keyStorage = provider === 'assemblyai' ? ASSEMBLYAI_KEY_STORAGE
        : provider === 'deepgram' ? DEEPGRAM_KEY_STORAGE : null;
    if (!keyStorage) return '';
    const res = await storageGet([keyStorage]);
    return String(res[keyStorage] || '').trim();
}

/**
 * POST /transcribe. The companion dedupes an active job for the same
 * video, so re-sending after an SW restart is safe.
 *
 * `provider` overrides the stored engine preference (the reader's
 * runtime picker). The resolved engine is ALWAYS sent explicitly —
 * request beats the companion's env default — and a cloud engine
 * carries its saved API key in the same request (memory-only on the
 * companion side). A cloud engine with no saved key fails here, before
 * any network call, with the fix named. An 'ask' preference is the
 * reader's job to resolve; unresolved it degrades to 'local'.
 */
export async function startTranscription(videoUrl, { port, fetchFn = fetch, provider } = {}) {
    // Engine resolution (review round, 2026-08-02): an explicit per-run
    // choice wins; else the STORED preference; and when the user never
    // chose anything, NO provider is sent at all — the companion's env
    // default keeps ruling, byte-identical to the pre-engine-choice
    // contract. ('ask' reaching here unresolved defers the same way.)
    let engine = null;
    if (provider) {
        engine = normalizeEngine(provider);
    } else {
        const res = await storageGet([TRANSCRIBER_ENGINE_STORAGE]);
        const stored = res[TRANSCRIBER_ENGINE_STORAGE];
        engine = (stored == null || stored === '') ? null : normalizeEngine(stored);
    }
    if (engine === 'ask') engine = null;

    const body = { url: String(videoUrl || '') };
    // Generic-URL capability gate. The companion admitted YouTube URLs
    // only until the Transcribe Anywhere wave; an older build would 400
    // with its own wording, which reads like a broken feature rather
    // than an out-of-date service. A YouTube URL with no parseable id
    // is deliberately treated as generic (likely a typo; the companion
    // cannot run it either). Probe /health and name the fix. Unreachable
    // falls through — the POST below fails with the normal reachable
    // error, the one that already carries the setup hint.
    if (!youtubeVideoId(body.url)) {
        const probe = await companionFetch('/health', { port, fetchFn, timeoutMs: 3000 });
        if (probe.ok && !(probe.body && probe.body.generic_urls)) {
            return {
                ok: false,
                // Two different causes, and the common one is the cheap
                // one — field-found 2026-08-15: a service that had been
                // up for days was still serving pre-update code from
                // memory while the repo on disk was already current, and
                // the old wording sent the maintainer to git pull for a
                // problem a restart fixed. Lead with the restart.
                error: 'This companion service does not support non-YouTube URLs yet. '
                    + 'If you have already updated X-Ray, just RESTART the service — a running '
                    + 'service keeps serving the code it started with. If you have not: git pull '
                    + 'in the X-Ray repo, run `uv sync` in companion/transcriber/, then restart it.'
            };
        }
    }
    if (engine) {
        body.provider = engine;
        if (engine !== 'local') {
            const apiKey = await storedProviderKey(engine);
            if (!apiKey) {
                const label = engine === 'assemblyai' ? 'AssemblyAI' : 'Deepgram';
                return {
                    ok: false,
                    missingKey: engine,
                    error: `No ${label} API key saved. Add one in Settings → Advanced → Transcription, or pick a different engine.`
                };
            }
            body.api_key = apiKey;
        }
        // Capability gate (review finding — privacy inversion): an old
        // companion IGNORES these fields and runs its env default, so an
        // explicit "Local" pick could silently upload audio to a cloud
        // env default. Refuse unless the build honors per-request
        // engines OR its default already matches the choice. Unreachable
        // falls through — the POST fails with the normal reachable error.
        const ping = await companionFetch('/health', { port, fetchFn, timeoutMs: 3000 });
        if (ping.ok) {
            const h = ping.body || {};
            const envDefault = String(h.provider || 'local').trim().toLowerCase();
            if (!h.request_provider && envDefault !== engine) {
                return {
                    ok: false,
                    error: `The companion service is too old to honor a per-job engine choice — it would run its own default (${envDefault}) instead of ${engine}. Update it: git pull in the X-Ray repo, then restart the service.`
                };
            }
        }
    }
    const res = await companionFetch('/transcribe', {
        port,
        fetchFn,
        init: {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        }
    });
    if (!res.ok) return res;
    const jobId = res.body && res.body.job_id;
    if (!jobId) return { ok: false, error: 'Transcriber returned no job id.' };
    // Prefer the SERVER'S answer for which engine runs the job: on a
    // same-video dedupe the existing job's engine wins; its absence
    // (older companion / env default) leaves the requested engine (or
    // nothing) as the best available truth.
    const out = { ok: true, jobId };
    const actual = (res.body && res.body.provider) || engine;
    if (actual) out.provider = actual;
    if (engine) out.requested = engine;
    return out;
}

/** GET /jobs/<id> — the poll unit. */
export async function getJobStatus(jobId, { port, fetchFn = fetch } = {}) {
    if (!jobId) return { ok: false, error: 'missing job id' };
    const res = await companionFetch(`/jobs/${encodeURIComponent(jobId)}`, { port, fetchFn });
    if (!res.ok) return res;
    return { ok: true, job: res.body };
}

/**
 * GET /health with a short timeout — the reachability probe.
 *
 * With `probeAuth`, follows a healthy answer with one authenticated
 * call. This matters because the server EXEMPTS /health from its token
 * middleware (server.py `_require_token`): when TRANSCRIBER_TOKEN is
 * set on the service but not pasted into the extension, /health answers
 * 200 while every real call 401s. Without this probe a status light
 * would read "running" for a completely unusable configuration.
 * `authOk: false` means reachable-but-rejected; absent means unchecked.
 */
export async function pingTranscriber({ port, fetchFn = fetch, timeoutMs = 3000, probeAuth = false } = {}) {
    const res = await companionFetch('/health', { port, fetchFn, timeoutMs });
    if (!res.ok) return res;
    const out = { ok: true, health: res.body };
    if (probeAuth) {
        // Any token-guarded path works; an unknown job id is the
        // cheapest — it never mutates. 401 = token mismatch; 404 (or
        // anything else) = the token was accepted.
        const probe = await companionFetch('/jobs/xray-auth-probe', { port, fetchFn, timeoutMs });
        out.authOk = !(probe.status === 401);
    }
    return out;
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
    const res = await storageGet([TRANSCRIBER_ENGINE_STORAGE, ASSEMBLYAI_KEY_STORAGE, DEEPGRAM_KEY_STORAGE]);
    const storedEngine = res[TRANSCRIBER_ENGINE_STORAGE];
    return {
        enabled: isEnabled('localTranscription'),
        port,
        // Engine preference + key PRESENCE booleans (this snapshot goes
        // to pages — key values never leave the SW). `engine: null` =
        // never chosen: jobs carry no provider and the companion's own
        // default rules (the pre-engine-choice contract).
        engine: (storedEngine == null || storedEngine === '') ? null : normalizeEngine(storedEngine),
        keys: {
            assemblyai: String(res[ASSEMBLYAI_KEY_STORAGE] || '').trim().length > 0,
            deepgram: String(res[DEEPGRAM_KEY_STORAGE] || '').trim().length > 0
        },
        drafts: { enabled: isEnabled('transcriptClaimDrafts'), url: lm.url, model: lm.model },
        // The companion-free transport (shared/direct-transcribe.js).
        // Its own flag, reported separately, because it is reachable
        // with NO companion installed — the reader's Transcribe button
        // gates on `enabled || direct.enabled` for exactly that reason.
        // Consumers that predate this field see `undefined`, which is
        // falsy, so flag-off behavior is byte-identical to before.
        direct: { enabled: isEnabled('directCloudTranscription') }
    };
}

// ------------------------------------------------------------------
// LM Studio claim-candidate drafts (optional post-pass)
// ------------------------------------------------------------------

/** The system prompt, shaped by which suggestion kinds are enabled
 *  (the SAME per-kind toggles the Anthropic Suggest pass honors).
 *  Exported for tests. */
export function buildDraftSystemPrompt(kinds = ['entities', 'claims']) {
    const wantClaims = kinds.includes('claims');
    const wantEntities = kinds.includes('entities');
    const what = wantClaims && wantEntities
        ? 'checkable factual claims AND named entities'
        : wantClaims ? 'checkable factual claims' : 'named entities';
    const shapes = [];
    if (wantClaims) {
        shapes.push('{"kind": "claim", "text": "<the claim in one clear sentence>", '
            + '"quote": "<ONE contiguous VERBATIM span copied character-for-character from the transcript>"}');
    }
    if (wantEntities) {
        shapes.push('{"kind": "entity", "name": "<canonical name>", '
            + `"entity_type": "<one of: ${SUGGESTABLE_ENTITY_TYPES.join(' | ')}>", `
            + '"mention": "<ONE VERBATIM span from the transcript where this entity is named>"}');
    }
    return [
        `You extract ${what} from a speaker-diarized video transcript.`,
        'Return ONLY a JSON array, no prose, no code fences. Elements:',
        shapes.join(' or '),
        '. Rules:',
        wantClaims ? '5-20 claims; quotes MUST be exact substrings of the transcript (machine-checked; unlocatable quotes are discarded); prefer specific, falsifiable statements (numbers, events, attributions) over vibes;' : '',
        wantEntities ? 'up to 15 entities — distinct people, organizations, places, things NAMED in the spoken words; NEVER the diarization labels ("Speaker 1") themselves; mentions must be verbatim spans;' : '',
        'never quote timestamp links or speaker labels, only spoken words.'
    ].filter(Boolean).join(' ');
}

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

/** Parse the model's reply into propose_capture-shaped proposals
 *  (claims + entities — the Anthropic Suggest shapes, so the review
 *  modal needs zero changes). Tolerates code fences and stray prose
 *  around the array; a kind-less {text, quote} item is treated as a
 *  claim (older prompt / sloppy model). Exported for tests. */
export function coerceDraftProposals(replyText, transcriptText, kinds = ['entities', 'claims']) {
    const raw = String(replyText || '');
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start === -1 || end <= start) return [];
    let parsed;
    try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch (_) { return []; }
    if (!Array.isArray(parsed)) return [];
    const body = String(transcriptText || '');
    const out = [];
    let claims = 0;
    let ents = 0;
    for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const kind = String(item.kind || (item.text && item.quote ? 'claim' : '')).trim();
        if (kind === 'claim' && kinds.includes('claims')) {
            const text = String(item.text || '').trim();
            const quote = String(item.quote || '').trim();
            if (!text || !quote) continue;
            // Pre-filter obvious hallucinations; the review modal's
            // grounding index remains the real firewall.
            if (body && !body.includes(quote)) continue;
            claims += 1;
            out.push({ kind: 'claim', ref: `C${claims}`, text, quote, about: [], is_key: false });
        } else if (kind === 'entity' && kinds.includes('entities')) {
            const name = String(item.name || '').trim();
            const type = String(item.entity_type || '').trim();
            const mention = String(item.mention || '').trim();
            if (!name || !mention || !SUGGESTABLE_ENTITY_TYPES.includes(type)) continue;
            // Diarization labels are voices, not entities — the 🗣
            // Speakers modal owns those.
            if (/^speaker \d+$/i.test(name)) continue;
            ents += 1;
            out.push({ kind: 'entity', ref: `E${ents}`, name, entity_type: type, mention });
        }
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
        return { ok: false, error: 'Suggest (local) is off. Enable it in Options → Advanced → Local transcription.' };
    }
    // Honor the SAME per-kind toggles as the Anthropic Suggest pass —
    // one mental model for what "suggest" proposes.
    const kindsRes = await storageGet([LLM_SUGGEST_KINDS_STORAGE]);
    const kinds = normalizeSuggestKinds(kindsRes[LLM_SUGGEST_KINDS_STORAGE]);
    if (kinds.length === 0) {
        return { ok: false, error: 'All suggestion kinds are disabled in Options → Advanced → LLM assist.' };
    }
    const { url, model } = await getLmStudioConfig();
    const payload = {
        model,
        messages: [
            { role: 'system', content: buildDraftSystemPrompt(kinds) },
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
    return { ok: true, proposals: coerceDraftProposals(reply, transcriptText, kinds), model };
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
                    // Per-kind identity: claims by quote, entities by
                    // type+name — the same person named in three windows
                    // is ONE proposal.
                    const key = p.kind === 'entity'
                        ? `e:${p.entity_type}:${String(p.name || '').replace(/\s+/g, ' ').trim().toLowerCase()}`
                        : `c:${String(p.quote || '').replace(/\s+/g, ' ').trim().toLowerCase()}`;
                    if (key.length < 3 || seen.has(key)) continue;
                    seen.add(key);
                    const n = all.filter((x) => x.kind === p.kind).length + 1;
                    all.push({ ...p, ref: `${p.kind === 'entity' ? 'E' : 'C'}${n}` });
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
            : { ok: false, error: 'The model found no candidates in this transcript.' };
    }
    return { ok: true, proposals: all.slice(0, DRAFT_MAX_PROPOSALS), model, failures };
}

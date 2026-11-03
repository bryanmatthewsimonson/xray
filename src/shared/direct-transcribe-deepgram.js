// Deepgram direct — the SECOND companion-free transcription provider
// (DC.3). Runs in the background service worker, like its AssemblyAI
// sibling.
//
// A SIBLING, not an abstraction. Kickoff §8 refuses a provider-agnostic
// layer — "two providers is not enough evidence to design one; write
// the second concretely and extract later if a third arrives" — so the
// request shape, the payload mapping and the error strings are written
// out here rather than parameterized. The duplication of small helpers
// (scrub, clampToken) is the deliberate price of that ruling.
//
// The ONE thing that is NOT duplicated is `blockedDirectMediaUrl`. It is
// genuinely provider-neutral, it is a security gate, and a second copy
// would drift — so it is imported.
//
// THE STRUCTURAL DIFFERENCE FROM ASSEMBLYAI, and why this is not the
// same code with another host: Deepgram's pre-recorded call is
// SYNCHRONOUS. The HTTP response IS the transcript. There is no job id,
// no polling endpoint, and — their documentation is explicit — Deepgram
// does not store transcripts, so the response is the only opportunity
// to receive it.
//
// That inverts the property DC.1 established. An AssemblyAI run survives
// a service-worker teardown because the transcript id is on disk and the
// result is retrievable (smoke row DC-3 observed exactly that). Here a
// teardown mid-request is an unrecoverable loss of that request. It is
// bounded — measured 2026-08-16 on a live 48-minute episode: 12.9s,
// HTTP 200, roughly 225x realtime, so the exposure window is seconds,
// not minutes — but it is real, so the caller writes a pre-flight record
// and NEVER auto-retries. Losing money silently is the one thing this
// path must not do.

import { normalizeLanguage, utterancesToSegments } from './provider-normalize.js';
import { blockedDirectMediaUrl } from './direct-transcribe.js';
import { DEEPGRAM_KEY_STORAGE } from './transcriber-client.js';

/** Pinned; https only; NOT configurable and deliberately not stored. */
export const DEEPGRAM_API_URL = 'https://api.deepgram.com/v1/listen';
export const DEEPGRAM_ORIGIN = 'https://api.deepgram.com';

/** The picker's selection id. Like its AssemblyAI counterpart it is
 *  deliberately NOT a member of the persisted TRANSCRIBE_ENGINES enum —
 *  normalizeEngine would collapse it to 'local' and Options would
 *  re-persist that, destroying the preference. */
export const DEEPGRAM_ENGINE_ID = 'deepgram-direct';

/** The WIRE-VISIBLE provenance id — the same literal the companion
 *  stamps, so a direct run and a companion-routed run of the same audio
 *  publish the same `extraction-method` and compose the same heading.
 *  The transport is not wire-visible; see DIRECT_PROVIDER in
 *  direct-transcribe.js for the full reasoning. */
export const DEEPGRAM_PROVIDER = 'deepgram';

/** Mirrors the companion's `TRANSCRIBER_DEEPGRAM_MODEL` default. Both
 *  sides must request the SAME model or they publish different tags. */
export const DEEPGRAM_MODEL = 'nova-3';

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

async function storedApiKey() {
    const res = await storageGet([DEEPGRAM_KEY_STORAGE]);
    return String(res[DEEPGRAM_KEY_STORAGE] || '').trim();
}

function scrub(text, apiKey) {
    const s = String(text == null ? '' : text);
    return apiKey ? s.split(apiKey).join('***') : s;
}

function clampToken(value) {
    return String(value || '').toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function safeLanguageCode(code) {
    const normalized = normalizeLanguage(code);
    return /^[a-z]{2,8}$/.test(normalized) ? normalized : 'en';
}

/**
 * The request URL. Every option is a QUERY PARAMETER for Deepgram (the
 * body carries only the media URL), and this list mirrors the
 * companion's `_request_url()` exactly.
 *
 * `diarize=true` is deliberate even though Deepgram has deprecated the
 * flag in favour of `diarize_model`: the deprecated flag routes to their
 * v1 diarizer, which is what the companion gets, and switching would
 * change speaker segmentation for the same audio. That is a JOINT change
 * to both implementations, never a one-sided improvement here.
 */
function requestUrl() {
    const params = new URLSearchParams({
        model: DEEPGRAM_MODEL,
        diarize: 'true',
        utterances: 'true',
        smart_format: 'true',
        punctuate: 'true',
        detect_language: 'true'
    });
    return `${DEEPGRAM_API_URL}?${params.toString()}`;
}

/**
 * Deepgram payload → the common utterance shape provider-normalize
 * consumes. The JS twin of `deepgram.py _common_utterances`.
 *
 * Four differences from the AssemblyAI mapping, each pinned by a
 * fixture case generated from the reference:
 *
 * 1. **NO DIVISION.** Deepgram sends FLOAT SECONDS; start/end pass
 *    through verbatim. Copy-pasting AssemblyAI's ms÷1000 is the single
 *    most likely port error and would put every segment at ~1/1000 of
 *    its true offset.
 * 2. The utterance text key is `transcript`, not `text`.
 * 3. Word text is `punctuated_word || word` — Python `or`, so an EMPTY
 *    punctuated_word falls back. `??` would keep '' and the word would
 *    then be silently dropped downstream.
 * 4. The utterances branch is a TRUTHINESS test, so an empty array
 *    falls through to the channels stream. `Array.isArray()` would
 *    return [] and refuse a transcript that exists.
 */
export function commonUtterancesFromDeepgram(data) {
    const results = (data && data.results) || {};

    const wordsOf = (ws) => (Array.isArray(ws) ? ws : [])
        .filter((w) => w && typeof w === 'object')
        .map((w) => ({
            text: w.punctuated_word || w.word,   // (3) `||`, never `??`
            start: w.start,                      // (1) seconds already
            end: w.end
        }));

    const utterances = results.utterances;
    if (utterances && utterances.length) {       // (4) truthiness
        return utterances
            .filter((u) => u && typeof u === 'object')
            .map((u) => ({
                speaker: u.speaker,              // integer, 0 included
                start: u.start,
                end: u.end,
                text: u.transcript,              // (2) `transcript`
                words: wordsOf(u.words)
            }));
    }
    // Safety net (utterances=true should always populate them): the flat
    // word stream of the first channel, SPEAKER-LESS — never invent one.
    const channels = Array.isArray(results.channels) ? results.channels : [];
    const alts = (channels[0] && channels[0].alternatives) || [];
    const words = wordsOf(alts[0] && alts[0].words);
    if (!words.length) return [];
    return [{
        speaker: null,
        start: words[0].start,
        end: words[words.length - 1].end,
        text: alts[0] && alts[0].transcript,
        words
    }];
}

/**
 * The detected language, read from `channels[0].detected_language` EVEN
 * on the utterances branch — the utterances carry none.
 *
 * Documented divergence from the reference: Python's `channels[0].get()`
 * raises on a non-dict channel; this falls back to the default. It
 * differs only on payloads that would crash the reference.
 */
export function detectedLanguageFromDeepgram(data) {
    const channels = ((data && data.results) || {}).channels;
    const first = Array.isArray(channels) ? channels[0] : null;
    const code = first && typeof first === 'object' ? first.detected_language : null;
    return normalizeLanguage(code);
}

/**
 * A completed Deepgram response → the SAME result object the companion
 * returns, so the adoption seam consumes it untouched.
 *
 * `asr_model` stamps the REQUESTED model, matching `deepgram.py`
 * exactly. That looks wrong and is not: a live response reports
 * `general-nova-3` for a requested `nova-3`, so reading
 * `metadata.model_info` here would publish a different
 * `extraction-method` than the companion twin for identical audio — the
 * fork DC.1 spent its whole budget preventing. Preferring the reported
 * model (docs/NIP_DRAFT.md) is a JOINT change to both implementations.
 */
export function buildDeepgramResult(data) {
    const segments = utterancesToSegments(commonUtterancesFromDeepgram(data));
    if (!segments.length) throw new Error('Deepgram returned no usable segments');
    return {
        video_id: null,
        title: null,
        channel: null,
        duration: 0,
        language: safeLanguageCode(detectedLanguageFromDeepgram(data)),
        segments,
        model_info: {
            provider: DEEPGRAM_PROVIDER,
            asr_model: clampToken(DEEPGRAM_MODEL),
            diarization_model: 'deepgram-native',
            device: 'cloud',
            aligned: true,
            // LOCAL-ONLY, never published.
            route: 'direct',
            normalizer: 'js-1'
        }
    };
}

/**
 * Submit a media URL and RECEIVE THE TRANSCRIPT — one request, no
 * polling, no job id.
 *
 * Returns `{ok: true, result}` rather than a job handle, and the absence
 * of a `jobId` is deliberate: inventing one would imply this run is
 * resumable, and it is not.
 */
export async function transcribeDirectDeepgram(mediaUrl, { fetchFn = fetch } = {}) {
    const blocked = blockedDirectMediaUrl(mediaUrl);
    if (blocked) {
        return {
            ok: false,
            error: `That media address cannot be sent to a transcription provider — it is ${blocked}.`
        };
    }
    const apiKey = await storedApiKey();
    if (!apiKey) {
        return {
            ok: false,
            missingKey: 'deepgram',
            error: 'No Deepgram API key saved. Add one in Settings → Advanced → Transcription.'
        };
    }

    let resp;
    try {
        resp = await fetchFn(requestUrl(), {
            method: 'POST',
            // "Token <key>" — NOT the bare key AssemblyAI takes.
            headers: { Authorization: `Token ${apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({ url: String(mediaUrl) })
        });
    } catch (_) {
        // The caught message is DISCARDED, not forwarded: a network
        // stack that echoes the request can carry the key into it.
        return {
            ok: false,
            unreachable: true,
            error: 'Could not reach api.deepgram.com. Check your connection and try again.'
        };
    }

    let body = null;
    try { body = await resp.json(); } catch (_) { /* non-JSON error body */ }
    if (!resp.ok) {
        // Deepgram's own wording, verbatim — a 415 on a page URL or a
        // 403 from a hotlink-protected CDN is the diagnosis the user
        // needs, and paraphrasing it would destroy the evidence that
        // kill criterion 2 depends on.
        const detail = (body && (body.err_msg || body.error || body.message)) || `HTTP ${resp.status}`;
        return { ok: false, status: resp.status, error: `Deepgram request failed: ${scrub(detail, apiKey)}` };
    }

    try {
        return { ok: true, result: buildDeepgramResult(body || {}) };
    } catch (err) {
        return { ok: false, error: scrub((err && err.message) || String(err), apiKey) };
    }
}

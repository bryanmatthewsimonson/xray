// Direct cloud transcription — the ONLY module that talks to a
// transcription provider from the extension itself, with no companion
// service in the loop. Runs in the background service worker (the
// llm-client.js topology: pages reach it via xray:transcribe:direct:*
// messages).
//
// WHY IT EXISTS: the companion path needs a local file to upload, and
// it has one only because it downloads the media first. Given a direct
// media URL — which the Transcribe Anywhere wave made available as
// `mediaHints.fileUrl` → transcribeSourceUrl — there is nothing to
// download and nothing to upload: AssemblyAI's `audio_url` field takes
// a URL they fetch themselves, and `speaker_labels` means diarization
// comes from the provider (no pyannote, no HF_TOKEN, no GPU). So a
// user with an API key and NOTHING INSTALLED can transcribe.
//
// SECURITY INVARIANT — the mirror image of transcriber-client.js's.
// That module pins its base URLs to LOOPBACK literals because a
// tampered stored value must never exfiltrate transcript text to a
// remote host. This module is the deliberate exception, and it is
// bounded the same way: the provider origin is a PINNED https literal,
// there is no base-URL preference for it, and no request URL is ever
// built from stored state or from a provider response body.
//
// It is a SIBLING of transcriber-client.js, never an extension of it.
// It imports exactly one thing from that module — the NAME of the
// credential storage key — and no functions. That is not stylistic:
// `companionFetch` attaches the user's `X-Transcriber-Token` to EVERY
// request, so reusing it would send the companion's shared secret to
// AssemblyAI.
//
// PRIVACY, stated honestly because it is genuinely different from the
// companion cloud path and NOT simply better:
//   - Better: the audio never touches this machine, and the origin
//     site never sees the user's IP or cookies.
//   - Worse: the provider learns the ADDRESS of what is being
//     transcribed. The companion path uploads bytes, so it never
//     revealed the source URL at all.
// The picker sub-line says both halves; see reader/index.js.
//
// Every function returns result objects ({ok: true, …} / {ok: false,
// error}), never throws — the house LLM-client contract. The only
// deliberate exception is buildDirectResult, whose caller turns the
// throw into a job failure.

import { normalizeLanguage, utterancesToSegments } from './provider-normalize.js';
import { blockedImageUrl } from './vision-image.js';
import { ASSEMBLYAI_KEY_STORAGE } from './transcriber-client.js';

// ------------------------------------------------------------------
// The pin
// ------------------------------------------------------------------

/** Pinned; https only; NOT configurable and deliberately not stored. */
export const ASSEMBLYAI_API_BASE = 'https://api.assemblyai.com/v2';

/** Every origin this module may reach. The guard test asserts both
 *  that nothing else is fetched and that no stored value can widen it. */
export const DIRECT_PROVIDER_ORIGINS = Object.freeze(['https://api.assemblyai.com']);

/**
 * The engine id the PICKER uses to select this route. Deliberately
 * distinct from DIRECT_PROVIDER below, and deliberately NOT a member of
 * transcriber-client.js's TRANSCRIBE_ENGINES: that enum is persisted
 * under `xray:transcriber:engine`, and `normalizeEngine` collapses any
 * value it does not recognize to 'local' — which Options would then
 * re-persist, destroying the preference. Picker-only in DC.1
 * (maintainer ruling); DC.2 owns making it a storable default properly.
 */
export const DIRECT_ENGINE_ID = 'assemblyai-direct';

/**
 * The WIRE-VISIBLE provenance id, and the reason this constant exists
 * separately from the one above.
 *
 * `model_info.provider` flows into diarizedHeading(), which is composed
 * into `article.markdown` BEFORE the content hash is taken
 * (reader/index.js adoptDiarizedTranscript), and into
 * extractionMethodFor(), which is published as the `extraction-method`
 * tag. Stamping the transport here — 'assemblyai-direct' — would
 * permanently fork every direct transcript's `x` content address from
 * its companion-routed twin for the same audio, and publish a token no
 * consumer has seen.
 *
 * The tag documents HOW THE TEXT WAS PRODUCED, not who downloaded the
 * bytes. AssemblyAI's Universal model produced it either way, so the
 * honest value is the same either way. Pinned by
 * tests/direct-transcribe.test.mjs against the companion's own output.
 */
export const DIRECT_PROVIDER = 'assemblyai';

/** Preference list, in order — their API falls down it. Mirrors the
 *  companion's TRANSCRIBER_ASSEMBLYAI_MODEL default. */
export const ASSEMBLYAI_MODELS = Object.freeze(['universal-3-5-pro', 'universal-2']);

/** Provider transcript ids are opaque; admit only what can be safely
 *  interpolated into a path. */
export const JOB_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// ------------------------------------------------------------------
// Storage (own, deliberately — see the header note on companionFetch)
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

async function storedApiKey() {
    const res = await storageGet([ASSEMBLYAI_KEY_STORAGE]);
    return String(res[ASSEMBLYAI_KEY_STORAGE] || '').trim();
}

// ------------------------------------------------------------------
// Routing
// ------------------------------------------------------------------

/**
 * Which transport runs this engine, and may it run at all? PURE — the
 * handlers pass flags as data so the whole gate is testable without
 * stubbing the service worker.
 *
 * Both flags are checked on EVERY call including the poll, not just at
 * start: an MV3 worker wakes mid-job, and a credentialed GET to a third
 * party must not outlive the flag that authorized it.
 */
/** Every companion-free engine id. Both live behind the SAME flag —
 *  one consent decision covers "may X talk to a transcription provider
 *  directly", not one per vendor. */
export const DIRECT_ENGINE_IDS = Object.freeze(['assemblyai-direct', 'deepgram-direct']);

export function resolveTranscribeRoute({ engine, flags } = {}) {
    const f = flags || {};
    if (DIRECT_ENGINE_IDS.includes(engine)) {
        if (!f.directCloudTranscription) {
            return {
                route: 'refused',
                error: 'Direct cloud transcription is off. Enable it in Options → Advanced.'
            };
        }
        return { route: 'direct' };
    }
    if (!f.localTranscription) {
        return {
            route: 'refused',
            error: 'Local transcription is off. Enable it in Options → Advanced → Local transcription.'
        };
    }
    return { route: 'companion' };
}

// ------------------------------------------------------------------
// URL admission
// ------------------------------------------------------------------

// The well-known NAT64 prefix (RFC 6052). blockedImageUrl decodes
// v4-mapped v6 but not this; media_url.py's _embedded_ipv4 does, so
// leaving it out would make the direct path laxer than the companion
// path it replaces.
const NAT64_PREFIX = /^64:ff9b(:0*)*:/i;

function nat64EmbeddedV4(hostname) {
    if (!hostname.startsWith('[') || !hostname.endsWith(']')) return null;
    const inner = hostname.slice(1, -1).toLowerCase();
    if (!NAT64_PREFIX.test(inner)) return null;
    const groups = inner.split(':').filter(Boolean);
    if (groups.length < 2) return null;
    const hi = parseInt(groups[groups.length - 2], 16);
    const lo = parseInt(groups[groups.length - 1], 16);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/**
 * Is this media URL one X-Ray must not hand to a third-party provider?
 * Returns a short human-readable reason, or null when admissible.
 *
 * This is the extension-side port of the companion's
 * media_url.py validate_media_url, which the direct path otherwise
 * loses entirely — upstream, the only surviving check is
 * transcribe-flow.js's `/^https:\/\//i`.
 *
 * The URL is chosen by the CAPTURED PAGE (mediaHints.fileUrl is the
 * page's first media anchor), so it is untrusted input, and the three
 * refusals do different jobs:
 *
 *   1. https-only — the provider contract, and it keeps a downgrade off
 *      the table.
 *   2. NO EMBEDDED CREDENTIALS. This is the one that matters most and
 *      the one the address table cannot see: private podcast feeds
 *      really do use https://subscriber:token@cdn.example/ep.mp3, and
 *      submitting it would disclose the user's subscription secret to
 *      the provider AND persist it on their transcript record.
 *   3. The address table (delegated to blockedImageUrl, plus NAT64) —
 *      honest refusal and insurance, NOT an SSRF gate. On this path the
 *      fetch is the PROVIDER'S, from the provider's network, so a
 *      rebind would buy access to their internals, not ours; a service
 *      worker cannot pin DNS anyway. Its real value is that the user
 *      gets a clear local refusal instead of a baffling provider error.
 */
export function blockedDirectMediaUrl(raw) {
    let u;
    try { u = new URL(String(raw || '')); } catch (_) { return 'not a valid URL'; }
    if (u.protocol !== 'https:') return 'not an https:// URL';
    if (u.username || u.password) return 'a URL with embedded credentials';

    // FULLY-QUALIFIED trailing dot. The WHATWG parser canonicalizes the
    // numeric host forms for us — https://2130706433/, https://0x7f000001/
    // and https://127.1/ all arrive as "127.0.0.1" — but it does NOT
    // strip a trailing root label, so "localhost." resolves to the host
    // we mean to refuse while missing an equality check on it.
    // blockedImageUrl now normalizes this itself (fixed there after this
    // path found it), so this line is belt-and-braces: a credentialed
    // egress gate should not depend on another module's internals for a
    // refusal it states as its own.
    if (/\.$/.test(u.hostname)) u.hostname = u.hostname.replace(/\.+$/, '');

    const embedded = nat64EmbeddedV4(u.hostname.toLowerCase());
    if (embedded) {
        const reason = blockedImageUrl(`https://${embedded}/`);
        if (reason) return `a NAT64 address embedding ${reason}`;
    }
    // Pass the NORMALIZED url, never the raw string.
    return blockedImageUrl(u.href);
}

// ------------------------------------------------------------------
// Provider payload → the companion's result contract
// ------------------------------------------------------------------

/**
 * A last-resort clamp on the language code, applied HERE and not in
 * provider-normalize.js.
 *
 * The distinction matters. provider-normalize.js is the parity twin of
 * normalize.py and must reproduce it exactly — narrowing it there would
 * make the same audio compose a different body on the direct path than
 * on the companion path, forking the `x` content address. So the shared
 * normalizer keeps the reference's exact behavior, and this module adds
 * its own boundary check on top.
 *
 * Why any check at all: `language` is interpolated UNESCAPED into the
 * published `transcript_lang` tag as `<lang>:<kind>:<role>`
 * (event-builder.js), and normalizeLanguage only splits on `-`/`_` — a
 * value like "en:evil:role" survives it intact. Real BCP-47 primary
 * subtags are alphabetic, so this narrows only inputs that could never
 * be a genuine language code, and the two paths therefore agree on
 * every real provider response.
 *
 * The tag emitter now clamps its components too (event-builder.js
 * transcriptLangValue), which is the durable fix and covers the
 * companion path as well. This stays as a boundary check: it keeps a
 * junk language out of the composed HEADING (which the content hash
 * covers) and not merely out of the tag, and it fails closed at the
 * point the value enters the extension.
 */
function safeLanguageCode(code) {
    const normalized = normalizeLanguage(code);
    return /^[a-z]{2,8}$/.test(normalized) ? normalized : 'en';
}

/** Keep a published token inside the documented charset even if the
 *  provider returns something exotic (docs/NIP_DRAFT.md). */
function clampToken(value) {
    return String(value || '').toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'unknown';
}

const msToSeconds = (v) => (v === null || v === undefined ? null : v / 1000);

/**
 * AssemblyAI's payload → the common utterance shape provider-normalize
 * consumes (times in SECONDS; words carried for sentence splitting).
 * Mirrors the companion's assemblyai.py _common_utterances.
 */
export function commonUtterancesFromAssemblyAI(data) {
    const payload = data || {};
    const wordsOf = (ws) => (Array.isArray(ws) ? ws : [])
        .filter((w) => w && typeof w === 'object')
        .map((w) => ({
            text: w.text,
            start: msToSeconds(w.start),
            end: msToSeconds(w.end)
        }));

    const utterances = Array.isArray(payload.utterances) ? payload.utterances : null;
    if (utterances && utterances.length) {
        return utterances
            .filter((u) => u && typeof u === 'object')
            .map((u) => ({
                speaker: u.speaker,
                start: msToSeconds(u.start),
                end: msToSeconds(u.end),
                text: u.text,
                words: wordsOf(u.words)
            }));
    }
    // Diarization found nothing to split: fall back to the flat word
    // stream, SPEAKER-LESS — never invent a label.
    const words = wordsOf(payload.words);
    if (!words.length) return [];
    return [{
        speaker: null,
        start: words[0].start,
        end: words[words.length - 1].end,
        text: payload.text,
        words
    }];
}

/**
 * A completed AssemblyAI transcript → the SAME result object the
 * companion returns, so reader/index.js adoptDiarizedTranscript
 * consumes it untouched (guard-rail 3: adoption is reused, never
 * reimplemented).
 *
 * `model_info` is CONSTRUCTED here, never echoed from the payload — a
 * provider response must not be able to dictate what X-Ray publishes
 * about its own provenance.
 *
 * Throws when there is nothing usable; the caller turns that into a
 * failed job rather than adopting an empty transcript.
 */
export function buildDirectResult(data) {
    const payload = data || {};
    const segments = utterancesToSegments(commonUtterancesFromAssemblyAI(payload));
    if (!segments.length) throw new Error('AssemblyAI returned no usable segments');
    return {
        // No yt-dlp probe on this path — there is no download. Honest
        // nulls rather than invented metadata; the reader reads none of
        // these, and the portal panel DC.1 does not touch tolerates them.
        video_id: null,
        title: null,
        channel: null,
        duration: 0,
        language: safeLanguageCode(payload.language_code),
        segments,
        model_info: {
            provider: DIRECT_PROVIDER,
            // The model their API actually RAN, not the preference list
            // we asked for — they fall down the list, and echoing the
            // request would publish a model that did not run.
            asr_model: clampToken(payload.speech_model_used || ASSEMBLYAI_MODELS[0]),
            diarization_model: 'assemblyai-native',
            device: 'cloud',
            aligned: true,
            // LOCAL-ONLY provenance. Nothing publishes model_info
            // wholesale; these two record which code path produced the
            // segments, for a maintainer diffing two runs.
            route: 'direct',
            normalizer: 'js-1'
        }
    };
}

// ------------------------------------------------------------------
// HTTP
// ------------------------------------------------------------------

/** A pinned literal plus a validated path suffix — never a stored
 *  value, never a field from a response body. */
function providerUrl(path) {
    if (typeof path !== 'string' || path[0] !== '/' || path.includes('//')) {
        throw new Error('direct-transcribe: bad path');
    }
    return ASSEMBLYAI_API_BASE + path;
}

/** Belt and braces: no error object may carry the key, whatever a
 *  provider or a network stack decides to echo back. */
function scrub(text, apiKey) {
    const s = String(text == null ? '' : text);
    return apiKey ? s.split(apiKey).join('***') : s;
}

async function providerFetch(path, { apiKey, init = {}, fetchFn }) {
    let resp;
    try {
        resp = await fetchFn(providerUrl(path), {
            ...init,
            headers: { Authorization: apiKey, ...(init.headers || {}) }
        });
    } catch (_) {
        // The caught message is DISCARDED, not forwarded: a network
        // stack that echoes the request can carry the key into it.
        return {
            ok: false,
            unreachable: true,
            error: 'Could not reach api.assemblyai.com. Check your connection and try again.'
        };
    }
    let body = null;
    try { body = await resp.json(); } catch (_) { /* non-JSON error body */ }
    if (!resp.ok) {
        const detail = (body && (body.error || body.detail)) || `HTTP ${resp.status}`;
        return {
            ok: false,
            status: resp.status,
            error: `AssemblyAI request failed: ${scrub(detail, apiKey)}`
        };
    }
    return { ok: true, body };
}

/**
 * POST /transcript — submit the media URL for the provider to fetch.
 *
 * Returns the provider's transcript id as `jobId`, so the reader's
 * existing job record + resume machinery works unchanged. NOTE that the
 * id must be persisted before the first poll: it is the only handle to
 * an already-paid job.
 */
export async function startDirectTranscription(mediaUrl, { fetchFn = fetch } = {}) {
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
            missingKey: 'assemblyai',
            error: 'No AssemblyAI API key saved. Add one in Settings → Advanced → Transcription.'
        };
    }
    const res = await providerFetch('/transcript', {
        apiKey,
        fetchFn,
        init: {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                audio_url: String(mediaUrl),
                // Plural on purpose and a LIST: the singular
                // `speech_model` is hard-rejected (HTTP 400) since
                // ~2026-08 — see JOURNAL 2026-08-02.
                speech_models: ASSEMBLYAI_MODELS.slice(),
                speaker_labels: true,
                language_detection: true
            })
        }
    });
    if (!res.ok) return res;
    const jobId = res.body && res.body.id;
    if (!jobId) return { ok: false, error: 'AssemblyAI accepted the job but returned no transcript id.' };
    return { ok: true, jobId: String(jobId), provider: DIRECT_ENGINE_ID };
}

/**
 * GET /transcript/<id> — ONE request, mapped onto the companion's job
 * shape so reader/transcribe-flow.js polls it with the same loop.
 *
 * Deliberately NOT a polling loop. The reader drives the job — each
 * poll message resets the MV3 idle timer — and a service worker that
 * looped here would be killed mid-job, losing the transcript id and
 * orphaning an already-paid provider job (the corpus-reduce lesson,
 * JOURNAL 2026-07-18).
 */
export async function getDirectJobStatus(jobId, { fetchFn = fetch } = {}) {
    if (typeof jobId !== 'string' || !JOB_ID_RE.test(jobId)) {
        return { ok: false, error: 'missing or malformed job id' };
    }
    const apiKey = await storedApiKey();
    if (!apiKey) {
        return {
            ok: false,
            missingKey: 'assemblyai',
            error: 'No AssemblyAI API key saved. Add one in Settings → Advanced → Transcription.'
        };
    }
    const res = await providerFetch(`/transcript/${jobId}`, { apiKey, fetchFn });
    if (!res.ok) return res;

    const data = res.body || {};
    const job = { provider: DIRECT_ENGINE_ID };
    switch (String(data.status || '')) {
        case 'completed':
            try {
                job.status = 'done';
                job.result = buildDirectResult(data);
            } catch (err) {
                job.status = 'failed';
                job.error = scrub((err && err.message) || String(err), apiKey);
            }
            break;
        case 'error':
            job.status = 'failed';
            // The provider's OWN wording, verbatim: "Download error, the
            // hostname could not be resolved" is exactly the diagnosis a
            // hotlink-protected URL needs, and paraphrasing it would
            // convert the evidence this feature's kill criterion depends
            // on into a generic failure.
            job.error = scrub(data.error || 'unknown error', apiKey);
            break;
        case 'queued':
            job.status = 'queued';
            break;
        default:
            job.status = 'running';
            job.stage = 'transcribing';
            // NO progress field. The companion reports real stages and a
            // wall-clock estimate from a probed duration; here there is
            // no probe and no duration, so any number would be invented.
            // describeProgress omits the percentage when it is absent.
            break;
    }
    return { ok: true, job };
}

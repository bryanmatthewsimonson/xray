// Deepgram direct — the SECOND companion-free provider (DC.3).
//
// Deliberately a SIBLING module, not an abstraction over the first:
// kickoff §8 refuses a provider-agnostic layer until a third arrives.
// So the request shape, the payload mapping and the error strings are
// written concretely, and the ONE genuinely provider-neutral piece —
// the URL admission gate — is IMPORTED rather than copied.
//
// The structural difference from AssemblyAI, and the reason this file
// exists rather than a parameter: Deepgram's pre-recorded call is
// SYNCHRONOUS. The HTTP response IS the transcript, there is no job id,
// and their docs state they do not store transcripts — so the response
// is the only chance to receive it. Measured 2026-08-16 on a live
// 48-minute episode: 12.9s, HTTP 200 (~225x realtime).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

globalThis.fetch = () => { throw new Error('TRIPWIRE: deepgram-direct reached the real network'); };

const KEY = 'dg-secret-key-do-not-leak';
let storage = {};
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
                const out = {};
                for (const k of (Array.isArray(keys) ? keys : [keys])) if (k in storage) out[k] = storage[k];
                cb(out);
            },
            set(obj, cb) { Object.assign(storage, obj); cb && cb(); },
            remove(keys, cb) { for (const k of [].concat(keys)) delete storage[k]; cb && cb(); }
        }
    }
};

const {
    DEEPGRAM_API_URL, DEEPGRAM_ORIGIN, DEEPGRAM_ENGINE_ID, DEEPGRAM_PROVIDER, DEEPGRAM_MODEL,
    commonUtterancesFromDeepgram, detectedLanguageFromDeepgram, buildDeepgramResult,
    transcribeDirectDeepgram
} = await import('../src/shared/direct-transcribe-deepgram.js');
const { blockedDirectMediaUrl } = await import('../src/shared/direct-transcribe.js');
const { utterancesToSegments } = await import('../src/shared/provider-normalize.js');
const { extractionMethodFor, diarizedHeading } = await import('../src/shared/diarized-transcript.js');
const { DEEPGRAM_KEY_STORAGE } = await import('../src/shared/transcriber-client.js');

const repoUrl = (p) => new URL(`../${p}`, import.meta.url);
const FIXTURE = JSON.parse(readFileSync(repoUrl('tests/fixtures/normalizer-parity.json'), 'utf8'));
const CASES = FIXTURE.provider_cases.filter((c) => c.provider === 'deepgram');
const OK_URL = 'https://mcdn.podbean.com/mf/web/abc/Ep1.mp3';

function recorder(response) {
    const calls = [];
    const fetchFn = async (url, init) => {
        calls.push({ url, init });
        return typeof response === 'function' ? response(url, init) : response;
    };
    fetchFn.calls = calls;
    return fetchFn;
}
const jsonResponse = (body, status = 200) => ({
    ok: status >= 200 && status < 300, status, json: async () => body
});
const withKey = (v = KEY) => { storage = { [DEEPGRAM_KEY_STORAGE]: v }; };

// ------------------------------------------------------------------
// 1. Cross-language mapping parity — the layer nothing checked before
// ------------------------------------------------------------------

test('the Deepgram mapping functions have not changed under the fixture', () => {
    // Pins ONLY _common_utterances + _detected_language, so an edit to
    // the request URL or the progress ticker does not red this suite
    // spuriously while a mapping edit does.
    const ref = FIXTURE.provider_reference.deepgram;
    const src = readFileSync(repoUrl(ref.file), 'utf8');
    // The SAME textual rule the generator uses (see _extract_function
    // there): from `def <name>(` up to the next line starting in column
    // 0, trailing whitespace stripped. A text rule is the only
    // extraction both languages can implement identically.
    const grab = (name) => {
        const at = src.indexOf(`def ${name}(`);
        assert.ok(at > -1, `${name} not found in ${ref.file}`);
        const lines = src.slice(at).split('\n');
        const out = [];
        for (let i = 0; i < lines.length; i += 1) {
            if (i > 0 && lines[i] && !/^\s/.test(lines[i])) break;
            out.push(lines[i]);
        }
        return out.join('\n').replace(/\s+$/, '');
    };
    const sha = createHash('sha256')
        .update(ref.functions.map(grab).join('')).digest('hex');
    assert.equal(sha, ref.sha256,
        `${ref.file}'s mapping changed since the fixture was generated.\n`
        + 'Re-observe rather than assuming the twin still matches:\n'
        + `  ${FIXTURE.reference.regenerate}`);
});

test('every Deepgram payload case maps exactly as the reference maps it', () => {
    assert.ok(CASES.length > 0, 'fixture carries no Deepgram provider cases');
    for (const c of CASES) {
        assert.deepEqual(commonUtterancesFromDeepgram(c.payload), c.expected_utterances,
            `case "${c.name}" diverged from deepgram.py.\nWhy this case exists: ${c.why}`);
        assert.equal(detectedLanguageFromDeepgram(c.payload), c.expected_language,
            `case "${c.name}" language diverged. Why: ${c.why}`);
        assert.deepEqual(utterancesToSegments(commonUtterancesFromDeepgram(c.payload)),
            c.expected_segments, `case "${c.name}" end-to-end segments diverged`);
    }
});

test('float seconds pass through with NO division', () => {
    // The single most likely port error: copy-pasting AssemblyAI's
    // msToSeconds. A real slice carries 1.1999999 — divide it and the
    // segment lands at 0.001 instead of 1.2.
    const real = CASES.find((c) => c.name === 'deepgram_real_response_slice');
    assert.ok(real, 'the real-payload case is missing');
    const [first] = commonUtterancesFromDeepgram(real.payload);
    assert.equal(first.start, 1.1999999);
    assert.equal(first.words[0].start, 1.1999999);
    assert.equal(utterancesToSegments([first])[0].start, 1.2, 'rounds, never divides');
});

test('an integer speaker 0 survives, and labels follow global first appearance', () => {
    const c = CASES.find((x) => x.name === 'deepgram_speaker_one_before_zero');
    assert.deepEqual(utterancesToSegments(commonUtterancesFromDeepgram(c.payload)).map((s) => s.speaker),
        ['SPEAKER_00', 'SPEAKER_01']);
});

test('an EMPTY utterances array falls through to the channels stream', () => {
    // `if utterances:` is a truthiness test in the reference.
    const c = CASES.find((x) => x.name === 'deepgram_empty_utterances_falls_through_to_channels');
    const out = commonUtterancesFromDeepgram(c.payload);
    assert.equal(out.length, 1);
    assert.equal(out[0].speaker, null);
});

test('an empty punctuated_word falls back to word, not to an empty string', () => {
    const c = CASES.find((x) => x.name === 'deepgram_empty_punctuated_word_falls_back');
    assert.equal(commonUtterancesFromDeepgram(c.payload)[0].words[0].text, 'kept');
});

test('the text key is `transcript`, not `text`', () => {
    const out = commonUtterancesFromDeepgram({ results: { channels: [{ detected_language: 'en' }],
        utterances: [{ speaker: 0, start: 0, end: 1, transcript: 'from transcript', text: 'WRONG', words: [] }] } });
    assert.equal(out[0].text, 'from transcript');
});

// ------------------------------------------------------------------
// 2. Provenance
// ------------------------------------------------------------------

test('model_info stamps the REQUESTED model, matching the companion exactly', () => {
    // deepgram.py stamps config.DEEPGRAM_MODEL, not the model the
    // response reports. Reading metadata.model_info here would publish a
    // different extraction-method than the companion twin for the same
    // audio — the fork DC.1 spent its budget preventing. A real response
    // reports "general-nova-3" for a requested "nova-3", so this is not
    // hypothetical.
    const real = CASES.find((c) => c.name === 'deepgram_real_response_slice');
    const withMeta = { ...real.payload, metadata: { model_info: { x: { name: 'general-nova-3' } } } };
    const info = buildDeepgramResult(withMeta).model_info;
    assert.equal(info.provider, 'deepgram');
    assert.equal(info.asr_model, DEEPGRAM_MODEL);
    assert.equal(info.asr_model, 'nova-3');
    assert.equal(info.diarization_model, 'deepgram-native');
    assert.equal(info.device, 'cloud');
    assert.equal(extractionMethodFor(info), 'deepgram-nova-3');
    assert.ok(!extractionMethodFor(info).includes('direct'), 'the transport is not wire-visible');
    assert.equal(diarizedHeading('en', info.provider), 'Transcript — English (Deepgram, diarized)');
});

test('the selection id and the wire-visible provenance id stay distinct', () => {
    assert.equal(DEEPGRAM_ENGINE_ID, 'deepgram-direct');
    assert.equal(DEEPGRAM_PROVIDER, 'deepgram');
    assert.notEqual(DEEPGRAM_ENGINE_ID, DEEPGRAM_PROVIDER);
});

test('an empty payload refuses rather than adopting an empty transcript', () => {
    assert.throws(() => buildDeepgramResult({ results: { utterances: [], channels: [] } }),
        /no usable segments/i);
});

// ------------------------------------------------------------------
// 3. Request shape, admission, key hygiene
// ------------------------------------------------------------------

test('the request matches the companion contract exactly', async () => {
    withKey();
    const real = CASES.find((c) => c.name === 'deepgram_real_response_slice');
    const fetchFn = recorder(jsonResponse(real.payload));
    const out = await transcribeDirectDeepgram(OK_URL, { fetchFn });
    assert.equal(out.ok, true);

    const [call] = fetchFn.calls;
    const u = new URL(call.url);
    assert.equal(u.origin, DEEPGRAM_ORIGIN);
    assert.equal(u.pathname, '/v1/listen');
    // Same six params the companion sends. diarize=true on purpose:
    // Deepgram deprecated the flag in favour of diarize_model, and
    // switching would change speaker segmentation — a JOINT change to
    // both implementations, never a one-sided "improvement".
    for (const [k, v] of [['model', DEEPGRAM_MODEL], ['diarize', 'true'], ['utterances', 'true'],
        ['smart_format', 'true'], ['punctuate', 'true'], ['detect_language', 'true']]) {
        assert.equal(u.searchParams.get(k), v, `query param ${k}`);
    }
    assert.equal(call.init.method, 'POST');
    // "Token <key>" — NOT the bare key AssemblyAI takes. Swapping these
    // is a 401 on the first call.
    assert.equal(call.init.headers.Authorization, `Token ${KEY}`);
    assert.equal(JSON.parse(call.init.body).url, OK_URL);
    assert.deepEqual(Object.keys(JSON.parse(call.init.body)), ['url']);
});

test('it is SYNCHRONOUS — the submit returns the transcript, with no job id', async () => {
    withKey();
    const real = CASES.find((c) => c.name === 'deepgram_real_response_slice');
    const fetchFn = recorder(jsonResponse(real.payload));
    const out = await transcribeDirectDeepgram(OK_URL, { fetchFn });
    assert.equal(fetchFn.calls.length, 1, 'exactly one request — there is nothing to poll');
    assert.ok(out.result, 'the result arrives from the submit itself');
    assert.equal(out.jobId, undefined, 'Deepgram issues no id; pretending otherwise would imply resumability');
    assert.ok(out.result.segments.length > 0);
});

test('the URL admission gate is SHARED, not copied', async () => {
    // The one provider-neutral piece. A second copy would drift, and
    // the drift would be a security gate.
    const src = readFileSync(repoUrl('src/shared/direct-transcribe-deepgram.js'), 'utf8');
    assert.match(src, /import \{[^}]*blockedDirectMediaUrl[^}]*\} from '\.\/direct-transcribe\.js'/,
        'import the admission gate rather than reimplementing it');
    assert.ok(!/nat64EmbeddedV4|NAT64_PREFIX/.test(src), 'the address table must not be duplicated here');

    withKey();
    for (const bad of ['http://x/a.mp3', 'https://u:p@x/a.mp3', 'https://127.0.0.1/a.mp3',
        'https://localhost./a.mp3', 'not a url']) {
        const fetchFn = recorder(jsonResponse({}));
        const out = await transcribeDirectDeepgram(bad, { fetchFn });
        assert.equal(out.ok, false, `${bad} was submitted`);
        assert.equal(fetchFn.calls.length, 0, `${bad} reached the network`);
        assert.ok(blockedDirectMediaUrl(bad), 'the shared gate agrees');
    }
});

test('a missing key refuses before any network call', async () => {
    storage = {};
    const fetchFn = recorder(jsonResponse({}));
    const out = await transcribeDirectDeepgram(OK_URL, { fetchFn });
    assert.equal(out.ok, false);
    assert.equal(out.missingKey, 'deepgram');
    assert.match(out.error, /Settings/i);
    assert.equal(fetchFn.calls.length, 0);
});

test('the key never appears in any error, across every failure mode', async () => {
    withKey();
    const modes = [
        ['401', recorder(jsonResponse({ err_msg: 'bad key' }, 401))],
        ['415', recorder(jsonResponse({ err_msg: 'unsupported media' }, 415))],
        ['504', recorder(jsonResponse({ err_msg: 'timeout' }, 504))],
        ['non-JSON', recorder({ ok: false, status: 500, json: async () => { throw new Error('nope'); } })],
        ['throw', recorder(() => { throw new Error(`connect failed for Token ${KEY}`); })]
    ];
    for (const [label, fetchFn] of modes) {
        const out = await transcribeDirectDeepgram(OK_URL, { fetchFn });
        assert.equal(out.ok, false, label);
        assert.ok(!JSON.stringify(out).includes(KEY), `key leaked (${label})`);
    }
});

test("the provider's own failure text surfaces, so a fetch refusal is diagnosable", async () => {
    withKey();
    // 415 is exactly what a page URL produces — the shape DC-4 watches.
    const fetchFn = recorder(jsonResponse({ err_msg: 'failed to process audio: unsupported media type' }, 415));
    const out = await transcribeDirectDeepgram(OK_URL, { fetchFn });
    assert.match(out.error, /unsupported media type/);
    assert.ok(!/companion|not reachable/i.test(out.error));
});

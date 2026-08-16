// Direct cloud transcription — the module that talks to AssemblyAI
// from the service worker with NO companion service in the loop.
//
// What these tests are protecting, in order of how bad the failure is:
//
//  1. `model_info.provider` is the LITERAL 'assemblyai', never the
//     picker's selection id. That string reaches diarizedHeading(),
//     which is composed into article.markdown BEFORE the content hash
//     is taken — a transport-suffixed id would permanently fork every
//     direct transcript's `x` content address from its companion twin.
//  2. The URL admission gate. Every URL used to pass the companion's
//     media_url.py (https-only, no embedded credentials, globally
//     routable). The direct path never reaches it, and the only
//     surviving check upstream is /^https:\/\//i.
//  3. Key hygiene — the API key must not surface in any returned or
//     thrown error, across every failure mode.
//  4. The host pin — one literal origin, never a stored value, never a
//     URL taken from a response body.
//
// Everything is driven with an injected fetchFn; a module-level
// tripwire fails any test that reaches the real network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.fetch = () => { throw new Error('TRIPWIRE: direct-transcribe reached the real network'); };

const KEY = 'aai-secret-key-do-not-leak';
let storage = {};

globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
                const out = {};
                for (const k of (Array.isArray(keys) ? keys : [keys])) {
                    if (k in storage) out[k] = storage[k];
                }
                cb(out);
            },
            set(obj, cb) { Object.assign(storage, obj); cb && cb(); },
            remove(keys, cb) {
                for (const k of (Array.isArray(keys) ? keys : [keys])) delete storage[k];
                cb && cb();
            }
        }
    }
};

const {
    ASSEMBLYAI_API_BASE, DIRECT_PROVIDER_ORIGINS, DIRECT_ENGINE_ID, DIRECT_PROVIDER,
    ASSEMBLYAI_MODELS, blockedDirectMediaUrl, commonUtterancesFromAssemblyAI,
    buildDirectResult, startDirectTranscription, getDirectJobStatus, resolveTranscribeRoute
} = await import('../src/shared/direct-transcribe.js');
const { extractionMethodFor, diarizedHeading } = await import('../src/shared/diarized-transcript.js');
const { normalizeLanguage } = await import('../src/shared/provider-normalize.js');
const { ASSEMBLYAI_KEY_STORAGE } = await import('../src/shared/transcriber-client.js');

const OK_URL = 'https://media.blubrry.com/show/example.com/audio/ep217.mp3';

/** A fetchFn that records every call and never reaches the network. */
function recorder(responses) {
    const calls = [];
    const queue = Array.isArray(responses) ? responses.slice() : [responses];
    const fetchFn = async (url, init) => {
        calls.push({ url, init });
        const next = queue.length > 1 ? queue.shift() : queue[0];
        if (typeof next === 'function') return next(url, init);
        return next;
    };
    fetchFn.calls = calls;
    return fetchFn;
}

const jsonResponse = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
});

function withKey(value = KEY) {
    storage = { [ASSEMBLYAI_KEY_STORAGE]: value };
}

// A minimal completed AssemblyAI payload (their ms integers).
const COMPLETED = {
    status: 'completed',
    language_code: 'en_us',
    speech_model_used: 'universal-3-5-pro',
    text: 'Hello there. General Kenobi.',
    utterances: [
        {
            speaker: 'A', start: 0, end: 1500, text: 'Hello there.',
            words: [
                { text: 'Hello', start: 0, end: 700 },
                { text: 'there.', start: 700, end: 1500 }
            ]
        },
        {
            speaker: 'B', start: 1500, end: 3000, text: 'General Kenobi.',
            words: [
                { text: 'General', start: 1500, end: 2200 },
                { text: 'Kenobi.', start: 2200, end: 3000 }
            ]
        }
    ]
};

// ------------------------------------------------------------------
// 1. Provenance — the irreversible one
// ------------------------------------------------------------------

test('model_info.provider is the literal companion id, never the selection id', () => {
    const result = buildDirectResult(COMPLETED);
    assert.equal(result.model_info.provider, 'assemblyai');
    assert.equal(DIRECT_PROVIDER, 'assemblyai');
    assert.equal(DIRECT_ENGINE_ID, 'assemblyai-direct');
    assert.notEqual(result.model_info.provider, DIRECT_ENGINE_ID);
});

test('a direct run publishes the SAME extraction-method and heading as a companion run', () => {
    // The content address depends on the heading; the published tag on
    // the method. Both must be byte-identical to the companion-routed
    // AssemblyAI result for the same audio, or the two paths fork.
    const direct = buildDirectResult(COMPLETED).model_info;
    const companion = {
        provider: 'assemblyai',
        asr_model: 'universal-3-5-pro',
        diarization_model: 'assemblyai-native',
        device: 'cloud',
        aligned: true,
        yt_dlp_version: '2026.08.01'
    };
    assert.equal(extractionMethodFor(direct), extractionMethodFor(companion));
    assert.equal(extractionMethodFor(direct), 'assemblyai-universal-3-5-pro');
    assert.equal(diarizedHeading('en', direct.provider), diarizedHeading('en', companion.provider));
    assert.equal(diarizedHeading('en', direct.provider), 'Transcript — English (AssemblyAI, diarized)');
});

test('a hostile provider payload cannot dictate model_info', () => {
    const hostile = {
        ...COMPLETED,
        model_info: { provider: '../../evil', asr_model: 'x' },
        provider: 'evil'
    };
    const result = buildDirectResult(hostile);
    assert.equal(result.model_info.provider, 'assemblyai');
    assert.equal(result.model_info.diarization_model, 'assemblyai-native');
    assert.equal(result.model_info.device, 'cloud');
});

test('asr_model names the model AssemblyAI reports running, not the one requested', () => {
    // Their API falls down the speech_models preference list; echoing
    // the request publishes a model that did not run.
    const fellBack = { ...COMPLETED, speech_model_used: 'universal-2' };
    assert.equal(buildDirectResult(fellBack).model_info.asr_model, 'universal-2');
    const silent = { ...COMPLETED };
    delete silent.speech_model_used;
    assert.equal(buildDirectResult(silent).model_info.asr_model, ASSEMBLYAI_MODELS[0]);
});

test('a path-shaped or tag-breaking provider model is clamped to the documented charset', () => {
    const nasty = { ...COMPLETED, speech_model_used: '../../etc/passwd nova 3!' };
    const method = extractionMethodFor(buildDirectResult(nasty).model_info);
    assert.ok(/^[a-z0-9._-]+$/.test(method), `method not clamped: ${method}`);
    assert.ok(method.startsWith('assemblyai-'));
});

test('the provider language is normalized the same way the companion normalizes it', () => {
    // Parity first: for every language code a provider actually emits,
    // the direct path must produce exactly what normalize.py produces,
    // or the same audio composes a different heading and forks the `x`
    // content address.
    assert.equal(buildDirectResult(COMPLETED).language, normalizeLanguage('en_us'));
    assert.equal(buildDirectResult(COMPLETED).language, 'en');
    assert.equal(buildDirectResult({ ...COMPLETED, language_code: 'PT-br' }).language, 'pt');
    assert.equal(buildDirectResult({ ...COMPLETED, language_code: null }).language, 'en');
});

test('a language code that could never be real cannot reach the published tag', () => {
    // `transcript_lang` interpolates the language UNESCAPED as
    // <lang>:<kind>:<role>, and normalizeLanguage only splits on -/_ —
    // so "en:evil:role" survives the shared normalizer intact. The
    // clamp lives at this module's boundary, NOT in the shared twin,
    // precisely so parity above is preserved.
    assert.equal(normalizeLanguage('en:evil:role'), 'en:evil:role',
        'the shared twin must keep reference behavior — clamp at the boundary instead');
    assert.equal(buildDirectResult({ ...COMPLETED, language_code: 'en:evil:role' }).language, 'en');
    assert.equal(buildDirectResult({ ...COMPLETED, language_code: '../../x' }).language, 'en');
    assert.equal(buildDirectResult({ ...COMPLETED, language_code: 'e n' }).language, 'en');
});

test('segments come out in the companion contract shape', () => {
    const { segments } = buildDirectResult(COMPLETED);
    assert.deepEqual(segments, [
        { start: 0, end: 1.5, speaker: 'SPEAKER_00', text: 'Hello there.' },
        { start: 1.5, end: 3, speaker: 'SPEAKER_01', text: 'General Kenobi.' }
    ]);
    assert.equal(JSON.stringify(Object.keys(segments[0])), '["start","end","speaker","text"]');
});

test('a speaker-less payload falls back to the flat word stream without inventing a label', () => {
    const flat = {
        status: 'completed', language_code: 'en', text: 'Solo narration here.',
        words: [
            { text: 'Solo', start: 0, end: 500 },
            { text: 'narration', start: 500, end: 1000 },
            { text: 'here.', start: 1000, end: 1500 }
        ]
    };
    const { segments } = buildDirectResult(flat);
    assert.equal(segments.length, 1);
    assert.equal(segments[0].speaker, null);
    assert.equal(segments[0].text, 'Solo narration here.');
});

test('an empty payload refuses rather than adopting an empty transcript', () => {
    assert.throws(() => buildDirectResult({ status: 'completed' }), /no usable segments/i);
    assert.throws(() => buildDirectResult({ status: 'completed', utterances: [] }), /no usable segments/i);
});

test('AssemblyAI millisecond timings convert without dropping a zero start', () => {
    const common = commonUtterancesFromAssemblyAI(COMPLETED);
    assert.equal(common[0].start, 0);
    assert.equal(common[0].words[0].start, 0);
    assert.equal(common[0].end, 1.5);
    // Non-dict entries are filtered rather than throwing.
    assert.deepEqual(commonUtterancesFromAssemblyAI({ utterances: [null, 'nope'] }), []);
});

// ------------------------------------------------------------------
// 2. URL admission
// ------------------------------------------------------------------

const REFUSED_URLS = [
    ['http://example.com/ep.mp3', 'plain http — the provider contract and media_url.py are https-only'],
    ['ftp://example.com/ep.mp3', 'not http(s) at all'],
    ['https://user:pass@cdn.example.com/ep.mp3', 'embedded credentials would be disclosed to the provider'],
    ['https://:token@cdn.example.com/ep.mp3', 'password-only credentials'],
    ['https://127.0.0.1/ep.mp3', 'loopback'],
    ['https://10.0.0.1/ep.mp3', 'private v4'],
    ['https://172.16.0.1/ep.mp3', 'private v4'],
    ['https://192.168.1.1/ep.mp3', 'private v4'],
    ['https://169.254.169.254/latest/meta-data', 'link-local — the cloud metadata address'],
    ['https://0.0.0.0/ep.mp3', 'unspecified'],
    ['https://[::1]/ep.mp3', 'v6 loopback'],
    ['https://[::ffff:127.0.0.1]/ep.mp3', 'v4-mapped, dotted spelling'],
    ['https://[::ffff:7f00:1]/ep.mp3', 'v4-mapped, the hex form the URL parser canonicalizes to'],
    ['https://[fe80::1]/ep.mp3', 'v6 link-local'],
    ['https://[fc00::1]/ep.mp3', 'v6 unique-local'],
    ['https://[64:ff9b::a9fe:a9fe]/ep.mp3', 'NAT64-embedded link-local — media_url.py decodes this'],
    ['https://localhost/ep.mp3', 'local hostname'],
    ['https://box.local/ep.mp3', 'mDNS name'],
    ['https://localhost./ep.mp3', 'trailing root label — resolvers treat it as the same host'],
    ['https://box.local./ep.mp3', 'mDNS name with a trailing root label'],
    ['https://2130706433/ep.mp3', '127.0.0.1 written as a decimal integer'],
    ['https://0x7f000001/ep.mp3', '127.0.0.1 written as hex'],
    ['https://0177.0.0.1/ep.mp3', 'octal first octet'],
    ['https://127.1/ep.mp3', 'the short v4 form'],
    ['https://[::ffff:a9fe:a9fe]/ep.mp3', 'v4-mapped link-local in hex — the cloud metadata address'],
    ['not a url at all', 'unparseable'],
    ['', 'empty']
];

test('every inadmissible URL is refused with a reason', () => {
    for (const [url, why] of REFUSED_URLS) {
        const reason = blockedDirectMediaUrl(url);
        assert.ok(typeof reason === 'string' && reason.length > 0,
            `${url} was admitted but should be refused (${why})`);
    }
});

test('the numeric host forms are canonicalized by the parser, not by us', () => {
    // Documents WHY the refusal table above does not need its own
    // octal/hex/integer decoder: the WHATWG URL parser already
    // normalizes them, so blockedImageUrl's dotted-quad matcher sees a
    // dotted quad. If that ever stops being true, the table catches it.
    assert.equal(new URL('https://2130706433/x').hostname, '127.0.0.1');
    assert.equal(new URL('https://0x7f000001/x').hostname, '127.0.0.1');
    assert.equal(new URL('https://127.1/x').hostname, '127.0.0.1');
    // ...but a trailing root label is NOT normalized away, which is why
    // blockedDirectMediaUrl strips it before delegating.
    assert.equal(new URL('https://localhost./x').hostname, 'localhost.');
});

test('an ordinary podcast CDN URL is admitted', () => {
    assert.equal(blockedDirectMediaUrl(OK_URL), null);
    assert.equal(blockedDirectMediaUrl('https://example.com/a.mp3?token=abc'), null);
});

test('a refused URL costs ZERO network calls', async () => {
    withKey();
    for (const [url] of REFUSED_URLS) {
        const fetchFn = recorder(jsonResponse({ id: 'nope' }));
        const out = await startDirectTranscription(url, { fetchFn });
        assert.equal(out.ok, false, `${url} was submitted`);
        assert.equal(fetchFn.calls.length, 0, `${url} reached the network`);
    }
});

// ------------------------------------------------------------------
// 3. Gating and key handling
// ------------------------------------------------------------------

test('a missing API key refuses before any network call, naming the fix', async () => {
    storage = {};
    const fetchFn = recorder(jsonResponse({ id: 'x' }));
    const out = await startDirectTranscription(OK_URL, { fetchFn });
    assert.equal(out.ok, false);
    assert.equal(out.missingKey, 'assemblyai');
    assert.match(out.error, /Settings/i);
    assert.equal(fetchFn.calls.length, 0);
});

test('the API key never appears in any error, across every failure mode', async () => {
    withKey();
    const modes = [
        ['4xx', recorder(jsonResponse({ error: 'bad key' }, 401))],
        ['5xx', recorder(jsonResponse({ error: 'boom' }, 503))],
        ['non-JSON body', recorder({ ok: false, status: 500, json: async () => { throw new Error('not json'); } })],
        ['network throw', recorder(() => { throw new Error(`connect failed for key ${KEY}`); })]
    ];
    for (const [label, fetchFn] of modes) {
        const started = await startDirectTranscription(OK_URL, { fetchFn });
        assert.equal(started.ok, false, label);
        assert.ok(!JSON.stringify(started).includes(KEY), `key leaked in start error (${label})`);
        const polled = await getDirectJobStatus('abc123', { fetchFn });
        assert.ok(!JSON.stringify(polled).includes(KEY), `key leaked in status error (${label})`);
    }
});

test('the route resolver refuses a direct run when its flag is off', () => {
    const on = { localTranscription: true, directCloudTranscription: true };
    assert.equal(resolveTranscribeRoute({ engine: DIRECT_ENGINE_ID, flags: on }).route, 'direct');
    assert.equal(resolveTranscribeRoute({ engine: 'assemblyai', flags: on }).route, 'companion');
    assert.equal(resolveTranscribeRoute({ engine: null, flags: on }).route, 'companion');

    const directOnly = { localTranscription: false, directCloudTranscription: true };
    assert.equal(resolveTranscribeRoute({ engine: DIRECT_ENGINE_ID, flags: directOnly }).route, 'direct');
    assert.equal(resolveTranscribeRoute({ engine: 'local', flags: directOnly }).route, 'refused');

    const companionOnly = { localTranscription: true, directCloudTranscription: false };
    const refused = resolveTranscribeRoute({ engine: DIRECT_ENGINE_ID, flags: companionOnly });
    assert.equal(refused.route, 'refused');
    assert.match(refused.error, /Direct cloud transcription/i);

    const off = { localTranscription: false, directCloudTranscription: false };
    assert.equal(resolveTranscribeRoute({ engine: DIRECT_ENGINE_ID, flags: off }).route, 'refused');
    assert.equal(resolveTranscribeRoute({ engine: 'local', flags: off }).route, 'refused');
});

test('no direct-path refusal reads as a companion problem', () => {
    // reader/index.js attaches "install the companion, run uv run
    // xray-transcriber" to any error containing "not reachable".
    const strings = [
        resolveTranscribeRoute({ engine: DIRECT_ENGINE_ID, flags: { directCloudTranscription: false } }).error
    ];
    for (const [url] of REFUSED_URLS) strings.push(blockedDirectMediaUrl(url));
    for (const s of strings) {
        assert.ok(!/not reachable/i.test(String(s)), `"${s}" would attach companion setup advice`);
        assert.ok(!/companion/i.test(String(s)), `"${s}" mentions the companion on a companion-free path`);
    }
});

// ------------------------------------------------------------------
// 4. Request shape and the host pin
// ------------------------------------------------------------------

test('the create request matches the companion contract minus the upload', async () => {
    withKey();
    const fetchFn = recorder(jsonResponse({ id: 'transcript-1' }));
    const out = await startDirectTranscription(OK_URL, { fetchFn });
    assert.equal(out.ok, true);
    assert.equal(out.jobId, 'transcript-1');
    assert.equal(out.provider, DIRECT_ENGINE_ID);

    const [call] = fetchFn.calls;
    assert.equal(call.url, `${ASSEMBLYAI_API_BASE}/transcript`);
    assert.equal(call.init.method, 'POST');
    // Bare key — no "Bearer", no "Token" (that is Deepgram's form).
    assert.equal(call.init.headers.Authorization, KEY);

    const body = JSON.parse(call.init.body);
    assert.deepEqual(Object.keys(body).sort(),
        ['audio_url', 'language_detection', 'speaker_labels', 'speech_models']);
    assert.equal(body.audio_url, OK_URL);
    assert.ok(Array.isArray(body.speech_models), 'speech_models must be a LIST');
    assert.equal(body.speaker_labels, true);
    assert.equal(body.language_detection, true);
    // The singular form is a hard HTTP 400 since ~2026-08 (JOURNAL).
    assert.ok(!/"speech_model"/.test(call.init.body));
});

test('the outbound body carries the URL and nothing else about the capture', async () => {
    withKey();
    const fetchFn = recorder(jsonResponse({ id: 't' }));
    await startDirectTranscription(OK_URL, { fetchFn });
    const body = JSON.parse(fetchFn.calls[0].init.body);
    for (const leak of ['title', 'channel', 'case', 'article', 'url', 'markdown']) {
        assert.ok(!(leak in body), `outbound body carries ${leak}`);
    }
});

test('a create response with no id is an error, not a silent success', async () => {
    withKey();
    const fetchFn = recorder(jsonResponse({ status: 'queued' }));
    const out = await startDirectTranscription(OK_URL, { fetchFn });
    assert.equal(out.ok, false);
    assert.match(out.error, /no transcript id/i);
});

test('a malformed job id is refused before any fetch', async () => {
    withKey();
    for (const bad of ['', '../../foo', 'a'.repeat(65), 'has space', 'semi;colon', null]) {
        const fetchFn = recorder(jsonResponse({ status: 'completed' }));
        const out = await getDirectJobStatus(bad, { fetchFn });
        assert.equal(out.ok, false, `job id ${JSON.stringify(bad)} was accepted`);
        assert.equal(fetchFn.calls.length, 0, `job id ${JSON.stringify(bad)} reached the network`);
    }
});

test('polling maps provider states onto the companion job shape', async () => {
    withKey();
    const cases = [
        [{ status: 'queued' }, 'queued'],
        [{ status: 'processing' }, 'running'],
        [{ status: 'error', error: 'could not download the audio' }, 'failed']
    ];
    for (const [payload, expected] of cases) {
        const fetchFn = recorder(jsonResponse(payload));
        const out = await getDirectJobStatus('abc123', { fetchFn });
        assert.equal(out.ok, true);
        assert.equal(out.job.status, expected);
        assert.equal(out.job.provider, DIRECT_ENGINE_ID);
    }
    const done = await getDirectJobStatus('abc123', { fetchFn: recorder(jsonResponse(COMPLETED)) });
    assert.equal(done.job.status, 'done');
    assert.equal(done.job.result.model_info.provider, 'assemblyai');
});

test("a running job reports no percentage rather than a fabricated one", async () => {
    withKey();
    const fetchFn = recorder(jsonResponse({ status: 'processing' }));
    const { job } = await getDirectJobStatus('abc123', { fetchFn });
    assert.equal(job.stage, 'transcribing');
    assert.equal(job.progress, undefined, 'a guessed percentage is not honest here — omit it');
});

test("the provider's own failure text surfaces verbatim — no silent fallback", async () => {
    withKey();
    const fetchFn = recorder(jsonResponse({ status: 'error', error: 'Download error, the hostname could not be resolved' }));
    const { job } = await getDirectJobStatus('abc123', { fetchFn });
    assert.equal(job.status, 'failed');
    assert.match(job.error, /hostname could not be resolved/);
});

test('every request goes to the pinned origin over https', async () => {
    withKey();
    const fetchFn = recorder(jsonResponse({ id: 'abc123', status: 'completed', ...COMPLETED }));
    await startDirectTranscription(OK_URL, { fetchFn });
    await getDirectJobStatus('abc123', { fetchFn });
    assert.ok(fetchFn.calls.length >= 2);
    for (const { url } of fetchFn.calls) {
        const u = new URL(url);
        assert.equal(u.protocol, 'https:');
        assert.ok(DIRECT_PROVIDER_ORIGINS.includes(u.origin), `${u.origin} is not pinned`);
    }
});

test('a response body can never redirect the next request', async () => {
    withKey();
    // A completed payload larded with URL-shaped fields: none may be
    // followed, and no extra fetch may happen.
    const payload = {
        ...COMPLETED,
        webhook_url: 'https://evil.example/collect',
        next: 'https://evil.example/next',
        upload_url: 'https://evil.example/upload',
        redirect: 'https://evil.example'
    };
    const fetchFn = recorder(jsonResponse(payload));
    const out = await getDirectJobStatus('abc123', { fetchFn });
    assert.equal(out.job.status, 'done');
    assert.equal(fetchFn.calls.length, 1, 'a response field was followed');
    assert.ok(!JSON.stringify(out).includes('evil.example'));
});

// Local transcription — the loopback HTTP client. Pins the security
// invariant (both base URLs pinned to loopback literals; only the port
// varies), the {ok}/{ok:false,error} result contract, the companion
// API mapping, the LM Studio draft coercion (quotes machine-checked
// against the transcript), and the flag defaults (both OFF).

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Stateful storage stub — flags + config keys are read back.
const _store = {};
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
                const out = {};
                const list = Array.isArray(keys) ? keys : (keys == null ? Object.keys(_store) : [keys]);
                for (const k of list) if (k in _store) out[k] = _store[k];
                cb(out);
            },
            set(obj, cb) { Object.assign(_store, obj); cb && cb(); },
            remove(keys, cb) { for (const k of [].concat(keys)) delete _store[k]; cb && cb(); }
        }
    }
};
function resetStore() { for (const k of Object.keys(_store)) delete _store[k]; }

const {
    TRANSCRIBER_DEFAULT_PORT, TRANSCRIBER_PORT_STORAGE,
    TRANSCRIBER_ENGINE_STORAGE, ASSEMBLYAI_KEY_STORAGE, DEEPGRAM_KEY_STORAGE, normalizeEngine,
    LMSTUDIO_URL_STORAGE, LMSTUDIO_MODEL_STORAGE, LMSTUDIO_DEFAULT_URL, LMSTUDIO_DEFAULT_MODEL,
    sanitizePort, transcriberBaseUrl, loopbackUrl, getLmStudioConfig, getTranscriberPort,
    startTranscription, getJobStatus, pingTranscriber, getTranscribeConfig,
    coerceDraftProposals, draftClaimCandidates
} = await import('../src/shared/transcriber-client.js');
const { FLAGS_DEFAULTS } = await import('../src/shared/metadata/feature-flags.js');

const okJson = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test('flag defaults: both local-transcription flags ship OFF', () => {
    assert.ok(Object.prototype.hasOwnProperty.call(FLAGS_DEFAULTS, 'localTranscription'));
    assert.equal(FLAGS_DEFAULTS.localTranscription, false);
    assert.ok(Object.prototype.hasOwnProperty.call(FLAGS_DEFAULTS, 'transcriptClaimDrafts'));
    assert.equal(FLAGS_DEFAULTS.transcriptClaimDrafts, false);
});

test('sanitizePort: integers in range pass; garbage → default', () => {
    assert.equal(sanitizePort('8756'), 8756);
    assert.equal(sanitizePort(9000), 9000);
    for (const bad of ['', null, undefined, '0', '-1', '65536', 'abc', '80.5x']) {
        assert.equal(sanitizePort(bad), TRANSCRIBER_DEFAULT_PORT, `bad: ${bad}`);
    }
    assert.equal(transcriberBaseUrl(9000), 'http://127.0.0.1:9000');
    assert.equal(transcriberBaseUrl('junk'), 'http://127.0.0.1:8756');
});

test('loopbackUrl: the pin — loopback hosts only, http(s) only', () => {
    assert.ok(loopbackUrl('http://127.0.0.1:8756'));
    assert.ok(loopbackUrl('http://localhost:1234/v1'));
    assert.ok(loopbackUrl('http://[::1]:1234'));
    // A tampered stored value must never exfiltrate transcript text.
    assert.equal(loopbackUrl('http://192.168.1.5:1234'), null);
    assert.equal(loopbackUrl('https://evil.example/v1'), null);
    assert.equal(loopbackUrl('http://localhost.evil.example'), null);
    assert.equal(loopbackUrl('ftp://127.0.0.1'), null);
    assert.equal(loopbackUrl('not a url'), null);
});

test('getLmStudioConfig: loopback custom kept, non-loopback stored value → default', async () => {
    resetStore();
    assert.deepEqual(await getLmStudioConfig(), { url: LMSTUDIO_DEFAULT_URL, model: LMSTUDIO_DEFAULT_MODEL });
    _store[LMSTUDIO_URL_STORAGE] = 'http://127.0.0.1:5000/v1/';
    _store[LMSTUDIO_MODEL_STORAGE] = 'my/model';
    assert.deepEqual(await getLmStudioConfig(), { url: 'http://127.0.0.1:5000/v1', model: 'my/model' });
    _store[LMSTUDIO_URL_STORAGE] = 'https://evil.example/v1';
    assert.equal((await getLmStudioConfig()).url, LMSTUDIO_DEFAULT_URL, 'non-loopback silently falls back');
});

test('startTranscription: 202 → jobId; unreachable names the fix; HTTP error carries detail', async () => {
    resetStore();
    const calls = [];
    const res = await startTranscription('https://www.youtube.com/watch?v=x', {
        port: 8756,
        fetchFn: async (url, init) => { calls.push({ url, init }); return okJson({ job_id: 'j-1' }, 202); }
    });
    assert.deepEqual(res, { ok: true, jobId: 'j-1' });
    assert.equal(calls.length, 1, 'no engine sent ⇒ no capability ping either');
    assert.equal(calls[0].url, 'http://127.0.0.1:8756/transcribe');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.url, 'https://www.youtube.com/watch?v=x');
    // NO preference ever stored: no provider is sent at all — the
    // companion's env default rules, byte-identical to the
    // pre-engine-choice contract (review finding).
    assert.ok(!('provider' in body));
    assert.ok(!('api_key' in body));

    const down = await startTranscription('https://y', { port: 8756, fetchFn: async () => { throw new Error('ECONNREFUSED'); } });
    assert.equal(down.ok, false);
    assert.equal(down.unreachable, true);
    assert.match(down.error, /not reachable at http:\/\/127\.0\.0\.1:8756/);
    assert.match(down.error, /companion\/transcriber\/README\.md/, 'the error points at the setup guide');

    const full = await startTranscription('https://y', { port: 8756, fetchFn: async () => okJson({ detail: 'queue full' }, 429) });
    assert.equal(full.ok, false);
    assert.equal(full.status, 429);
    assert.match(full.error, /queue full/);
});

test('normalizeEngine: engines + ask pass, junk → local', () => {
    assert.equal(normalizeEngine('assemblyai'), 'assemblyai');
    assert.equal(normalizeEngine('DEEPGRAM'), 'deepgram');
    assert.equal(normalizeEngine('ask'), 'ask');
    assert.equal(normalizeEngine('local'), 'local');
    for (const junk of ['', null, undefined, 'whisper', 'assembly ai']) {
        assert.equal(normalizeEngine(junk), 'local', `junk: ${junk}`);
    }
});

// fetch stub for engine-carrying starts: answers /health (new-build
// shape) then /transcribe.
function engineFetch({ health = { request_provider: true, provider: 'local' }, job = {} } = {}) {
    const seen = { health: 0, bodies: [] };
    const fetchFn = async (url, init) => {
        if (String(url).includes('/health')) { seen.health += 1; return okJson(health); }
        seen.bodies.push(JSON.parse(init.body));
        return okJson({ job_id: 'j-x', ...job }, 202);
    };
    return { fetchFn, seen };
}

test('startTranscription: stored cloud engine sends provider + saved key (after the capability ping)', async () => {
    resetStore();
    _store[TRANSCRIBER_ENGINE_STORAGE] = 'assemblyai';
    _store[ASSEMBLYAI_KEY_STORAGE] = 'aai-key-123';
    const { fetchFn, seen } = engineFetch({ job: { job_id: 'j-2', provider: 'assemblyai' } });
    const res = await startTranscription('https://www.youtube.com/watch?v=x', { port: 8756, fetchFn });
    assert.equal(res.ok, true);
    assert.equal(res.jobId, 'j-2');
    assert.equal(res.provider, 'assemblyai');
    assert.equal(seen.health, 1, 'explicit engine ⇒ one capability ping');
    assert.equal(seen.bodies[0].provider, 'assemblyai');
    assert.equal(seen.bodies[0].api_key, 'aai-key-123');
});

test('startTranscription: an OLD companion with a mismatched default is REFUSED, never misrouted', async () => {
    resetStore();
    _store[ASSEMBLYAI_KEY_STORAGE] = 'k';
    // Old build: /health lacks request_provider; env default assemblyai.
    const { fetchFn, seen } = engineFetch({ health: { provider: 'assemblyai' } });
    const res = await startTranscription('https://y', { port: 8756, provider: 'local', fetchFn });
    assert.equal(res.ok, false);
    assert.match(res.error, /too old/);
    assert.match(res.error, /assemblyai/);
    assert.equal(seen.bodies.length, 0, 'the job must NOT be submitted');
    // Same old build, but the choice MATCHES its default: no misroute
    // is possible, so the job proceeds.
    const match = engineFetch({ health: { provider: 'assemblyai' }, job: { job_id: 'j-ok' } });
    const res2 = await startTranscription('https://y', { port: 8756, provider: 'assemblyai', fetchFn: match.fetchFn });
    assert.equal(res2.ok, true);
});

test("startTranscription: the SERVER'S engine answer wins (same-video dedupe truth)", async () => {
    resetStore();
    // Requested local, but an active AssemblyAI job for the video won
    // the dedupe — the result must say what will ACTUALLY run.
    const { fetchFn } = engineFetch({ job: { job_id: 'j-active', provider: 'assemblyai' } });
    const res = await startTranscription('https://y', { port: 8756, provider: 'local', fetchFn });
    assert.equal(res.provider, 'assemblyai');
    assert.equal(res.requested, 'local');
});

test('getTranscribeConfig: unset engine reports null (companion default tier)', async () => {
    resetStore();
    const cfg = await getTranscribeConfig();
    assert.equal(cfg.engine, null);
});

test('startTranscription: explicit provider overrides the stored preference', async () => {
    resetStore();
    _store[TRANSCRIBER_ENGINE_STORAGE] = 'assemblyai';
    _store[ASSEMBLYAI_KEY_STORAGE] = 'aai-key';
    _store[DEEPGRAM_KEY_STORAGE] = 'dg-key';
    const { fetchFn, seen } = engineFetch({ job: { job_id: 'j-3', provider: 'deepgram' } });
    const res = await startTranscription('https://y', { port: 8756, provider: 'deepgram', fetchFn });
    assert.equal(res.provider, 'deepgram');
    assert.equal(seen.bodies[0].provider, 'deepgram');
    assert.equal(seen.bodies[0].api_key, 'dg-key');
});

test('startTranscription: cloud engine without a saved key fails BEFORE any network call', async () => {
    resetStore();
    _store[TRANSCRIBER_ENGINE_STORAGE] = 'deepgram';
    let fetched = 0;
    const res = await startTranscription('https://y', {
        port: 8756,
        fetchFn: async () => { fetched += 1; return okJson({ job_id: 'nope' }, 202); }
    });
    assert.equal(res.ok, false);
    assert.equal(res.missingKey, 'deepgram');
    assert.match(res.error, /Deepgram API key/);
    assert.match(res.error, /Settings/);
    assert.equal(fetched, 0, 'no request may be sent without the key');
});

test("startTranscription: an unresolved 'ask' preference sends no engine (companion default rules)", async () => {
    resetStore();
    _store[TRANSCRIBER_ENGINE_STORAGE] = 'ask';
    let body = null;
    const res = await startTranscription('https://y', {
        port: 8756,
        fetchFn: async (_url, init) => { body = JSON.parse(init.body); return okJson({ job_id: 'j-4' }, 202); }
    });
    assert.equal(res.ok, true);
    assert.ok(!('provider' in body), "unresolved 'ask' must not invent a choice");
});

test('getTranscribeConfig: engine + key PRESENCE booleans, never values', async () => {
    resetStore();
    _store[TRANSCRIBER_ENGINE_STORAGE] = 'assemblyai';
    _store[ASSEMBLYAI_KEY_STORAGE] = 'secret-value';
    const cfg = await getTranscribeConfig();
    assert.equal(cfg.engine, 'assemblyai');
    assert.deepEqual(cfg.keys, { assemblyai: true, deepgram: false });
    assert.ok(!JSON.stringify(cfg).includes('secret-value'), 'key VALUES never leave the SW snapshot');
});

test('getJobStatus: passthrough + 404 surfaced as status', async () => {
    const res = await getJobStatus('j-1', { port: 8756, fetchFn: async () => okJson({ job_id: 'j-1', status: 'running', progress: 0.4 }) });
    assert.equal(res.ok, true);
    assert.equal(res.job.status, 'running');
    const gone = await getJobStatus('j-x', { port: 8756, fetchFn: async () => okJson({ detail: 'unknown job' }, 404) });
    assert.equal(gone.ok, false);
    assert.equal(gone.status, 404);
    assert.equal((await getJobStatus('', {})).ok, false);
});

test('pingTranscriber: health passthrough', async () => {
    const res = await pingTranscriber({ port: 8756, fetchFn: async () => okJson({ status: 'ok', device: 'cuda' }) });
    assert.equal(res.ok, true);
    assert.equal(res.health.device, 'cuda');
});

test('configured TRANSCRIBER_TOKEN is sent on every companion call (a set-but-unsent token bricks the feature)', async () => {
    resetStore();
    _store['xray:transcriber:token'] = 's3cret';
    let seen = null;
    await getJobStatus('j-1', {
        port: 8756,
        fetchFn: async (_url, init) => { seen = init && init.headers; return okJson({ status: 'running' }); }
    });
    assert.equal(seen && seen['X-Transcriber-Token'], 's3cret');
    resetStore();
    seen = null;
    await getJobStatus('j-1', {
        port: 8756,
        fetchFn: async (_url, init) => { seen = (init && init.headers) || {}; return okJson({ status: 'running' }); }
    });
    assert.ok(!('X-Transcriber-Token' in seen), 'no token stored → no header');
});

test('getTranscribeConfig: storage-only snapshot with defaults', async () => {
    resetStore();
    const cfg = await getTranscribeConfig();
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.port, TRANSCRIBER_DEFAULT_PORT);
    assert.deepEqual(cfg.drafts, { enabled: false, url: LMSTUDIO_DEFAULT_URL, model: LMSTUDIO_DEFAULT_MODEL });
    _store['xray:flags'] = JSON.stringify({ localTranscription: true });
    _store[TRANSCRIBER_PORT_STORAGE] = '9001';
    assert.deepEqual((await getTranscribeConfig()).port, 9001);
    assert.equal((await getTranscribeConfig()).enabled, true);
    resetStore();
});

test('coerceDraftProposals: fences tolerated, ungrounded quotes dropped, propose_capture shape', () => {
    const transcript = 'Alice said the budget doubled in 2024. Bob disagreed strongly.';
    const reply = 'Here you go:\n```json\n' + JSON.stringify([
        { text: 'The budget doubled in 2024.', quote: 'the budget doubled in 2024' },
        { text: 'Hallucinated.', quote: 'never said this' },
        { text: '', quote: 'Bob disagreed' },
        { text: 'Bob disagreed with the claim.', quote: 'Bob disagreed strongly.' }
    ]) + '\n```\nDone.';
    const out = coerceDraftProposals(reply, transcript);
    assert.equal(out.length, 2, 'ungrounded + empty-text entries dropped');
    assert.deepEqual(out[0], {
        kind: 'claim', ref: 'C1',
        text: 'The budget doubled in 2024.',
        quote: 'the budget doubled in 2024',
        about: [], is_key: false
    });
    assert.deepEqual(coerceDraftProposals('no json here', transcript), []);
    assert.deepEqual(coerceDraftProposals('[]', transcript), []);
});

test('chunkTranscript: paragraph-boundary windows, verbatim substrings, oversize paragraphs split hard', async () => {
    const { chunkTranscript, DRAFT_WINDOW_CHARS } = await import('../src/shared/transcriber-client.js');
    const para = 'A sentence of transcript text that repeats. ';
    const doc = Array.from({ length: 40 }, (_, i) => `[${i}] ${para.repeat(8)}`.trim()).join('\n\n');
    const windows = chunkTranscript(doc, 2000);
    assert.ok(windows.length > 1, 'long input splits');
    for (const w of windows) {
        assert.ok(w.length <= 2000, 'window under the cap');
        assert.ok(doc.includes(w), 'every window is a VERBATIM substring — quotes still ground');
    }
    assert.deepEqual(chunkTranscript('short text', 2000), ['short text']);
    assert.deepEqual(chunkTranscript('   ', 2000), []);
    // A single paragraph over the window still splits (never an
    // infinite loop, never a dropped tail).
    const one = 'x'.repeat(4500);
    assert.deepEqual(chunkTranscript(one, 2000).map((w) => w.length), [2000, 2000, 500]);
    assert.ok(DRAFT_WINDOW_CHARS > 0);
});

test('runDraftPass: merges windows, dedupes quotes, renumbers refs', async () => {
    const { runDraftPass } = await import('../src/shared/transcriber-client.js');
    const text = `${'alpha '.repeat(300)}\n\n${'beta '.repeat(300)}`;
    const sent = [];
    const out = await runDraftPass({
        transcriptText: text, title: 't', windowChars: 1900,
        send: async (req) => {
            sent.push(req.transcriptText);
            return {
                ok: true, model: 'qwen/test',
                proposals: [
                    { kind: 'claim', ref: 'C1', text: 'dup', quote: 'Shared  Quote', about: [], is_key: false },
                    { kind: 'claim', ref: 'C2', text: `uniq${sent.length}`, quote: `quote ${sent.length}`, about: [], is_key: false }
                ]
            };
        }
    });
    assert.equal(out.ok, true);
    assert.equal(sent.length, 2, 'two windows sent');
    assert.equal(out.model, 'qwen/test');
    // 'shared quote' dedupes across windows (whitespace/case-normalized).
    assert.deepEqual(out.proposals.map((p) => p.quote), ['Shared  Quote', 'quote 1', 'quote 2']);
    assert.deepEqual(out.proposals.map((p) => p.ref), ['C1', 'C2', 'C3'], 'refs renumbered');
    assert.equal(out.failures, 0);
});

test('runDraftPass: a 400 window halves and retries; success at the smaller size', async () => {
    const { runDraftPass, DRAFT_MIN_WINDOW_CHARS } = await import('../src/shared/transcriber-client.js');
    const text = 'word '.repeat(2400); // one ~12000-char window
    const sizes = [];
    const out = await runDraftPass({
        transcriptText: text, title: 't', windowChars: 12000,
        send: async (req) => {
            sizes.push(req.transcriptText.length);
            if (req.transcriptText.length > 6000) return { ok: false, status: 400, error: 'context overflow' };
            return { ok: true, model: 'm', proposals: [{ kind: 'claim', ref: 'C1', text: 'x', quote: `q${sizes.length}`, about: [], is_key: false }] };
        }
    });
    assert.equal(out.ok, true);
    assert.ok(sizes[0] > 6000, 'first attempt was the full window');
    assert.ok(sizes.slice(1).every((s) => s <= 6000), 'retries ran at the halved size');
    assert.ok(out.proposals.length >= 1);
    assert.ok(DRAFT_MIN_WINDOW_CHARS < 12000);
});

test('runDraftPass: 400 at the minimum window surfaces the raise-context hint; partial failures stay partial', async () => {
    const { runDraftPass } = await import('../src/shared/transcriber-client.js');
    const text = 'word '.repeat(2000);
    const out = await runDraftPass({
        transcriptText: text, title: 't', windowChars: 4000,
        send: async () => ({ ok: false, status: 400, error: 'LM Studio request failed (HTTP 400): context overflow' })
    });
    assert.equal(out.ok, false);
    assert.match(out.error, /raise the model's context length/i);

    // One window fails hard, the other succeeds → ok with a failure count.
    let n = 0;
    const partial = await runDraftPass({
        transcriptText: `${'a '.repeat(1200)}\n\n${'b '.repeat(1200)}`, title: 't', windowChars: 2500,
        send: async () => {
            n += 1;
            if (n === 1) return { ok: false, status: 500, error: 'server hiccup' };
            return { ok: true, model: 'm', proposals: [{ kind: 'claim', ref: 'C1', text: 'x', quote: 'q', about: [], is_key: false }] };
        }
    });
    assert.equal(partial.ok, true);
    assert.equal(partial.failures, 1);
    assert.equal(partial.proposals.length, 1);
});

test('coerceDraftProposals: entity items parsed + validated; kind toggles honored', async () => {
    const { coerceDraftProposals: coerce } = await import('../src/shared/transcriber-client.js');
    const transcript = 'Ed Nachel said the budget doubled. The FBI investigated Dublin, Ohio.';
    const reply = JSON.stringify([
        { kind: 'claim', text: 'Budget doubled.', quote: 'the budget doubled' },
        { kind: 'entity', name: 'Ed Nachel', entity_type: 'person', mention: 'Ed Nachel' },
        { kind: 'entity', name: 'FBI', entity_type: 'organization', mention: 'The FBI' },
        { kind: 'entity', name: 'Dublin, Ohio', entity_type: 'nonsense', mention: 'Dublin, Ohio' },
        { kind: 'entity', name: 'Speaker 1', entity_type: 'person', mention: 'Speaker 1' },
        { text: 'Kind-less legacy claim.', quote: 'The FBI investigated' }
    ]);
    const both = coerce(reply, transcript);
    assert.deepEqual(both.map((p) => `${p.kind}:${p.ref}`), ['claim:C1', 'entity:E1', 'entity:E2', 'claim:C2'],
        'valid claims + entities kept; bad type and diarization labels dropped; kind-less = claim');
    assert.deepEqual(both[1], { kind: 'entity', ref: 'E1', name: 'Ed Nachel', entity_type: 'person', mention: 'Ed Nachel' });

    assert.ok(coerce(reply, transcript, ['claims']).every((p) => p.kind === 'claim'), 'claims-only toggle');
    assert.ok(coerce(reply, transcript, ['entities']).every((p) => p.kind === 'entity'), 'entities-only toggle');
});

test('runDraftPass: entities dedupe across windows by type+name; refs number per kind', async () => {
    const { runDraftPass } = await import('../src/shared/transcriber-client.js');
    let n = 0;
    const out = await runDraftPass({
        transcriptText: `${'a '.repeat(1200)}\n\n${'b '.repeat(1200)}`, title: 't', windowChars: 2500,
        send: async () => {
            n += 1;
            return {
                ok: true, model: 'm',
                proposals: [
                    { kind: 'entity', ref: 'E1', name: 'Ed  Nachel', entity_type: 'person', mention: 'Ed Nachel' },
                    { kind: 'claim', ref: 'C1', text: `t${n}`, quote: `quote ${n}`, about: [], is_key: false }
                ]
            };
        }
    });
    assert.equal(out.ok, true);
    assert.equal(n, 2);
    assert.deepEqual(out.proposals.map((p) => p.ref), ['E1', 'C1', 'C2'],
        'one entity across both windows (name-normalized), claims renumbered per kind');
});

test('draftClaimCandidates: gated by the flag; unreachable degrades to a clear error', async () => {
    resetStore();
    const off = await draftClaimCandidates({ transcriptText: 'x', title: 't' }, { fetchFn: async () => okJson({}) });
    assert.equal(off.ok, false);
    assert.match(off.error, /off/i);

    _store['xray:flags'] = JSON.stringify({ transcriptClaimDrafts: true });
    const down = await draftClaimCandidates({ transcriptText: 'x', title: 't' },
        { fetchFn: async () => { throw new Error('ECONNREFUSED'); } });
    assert.equal(down.ok, false);
    assert.equal(down.unreachable, true);
    assert.match(down.error, /LM Studio not reachable/);

    const transcript = 'Alice said the budget doubled in 2024.';
    const good = await draftClaimCandidates({ transcriptText: transcript, title: 't' }, {
        fetchFn: async (url) => {
            assert.equal(url, LMSTUDIO_DEFAULT_URL + '/chat/completions');
            return okJson({ choices: [{ message: { content: JSON.stringify([
                { text: 'Budget doubled.', quote: 'the budget doubled in 2024' }
            ]) } }] });
        }
    });
    assert.equal(good.ok, true);
    assert.equal(good.proposals.length, 1);
    assert.equal(good.model, LMSTUDIO_DEFAULT_MODEL);
    resetStore();
});

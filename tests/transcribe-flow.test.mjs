// Local transcription — the reader-side job orchestration. Pure logic
// with injectable IO (the autoPreAnalyzeArticle seam): the resume
// decision table, the poll state machine, unreachable tolerance (the
// record survives so a later click resumes the same job), and the
// stale-record reaper. No chrome stub needed — everything arrives via io.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    JOB_RECORD_PREFIX, JOB_RECORD_TTL_MS, MAX_UNREACHABLE_POLLS,
    jobRecordKey, isRecordStale, describeProgress, providerPhrase, decideResume,
    reapStaleJobRecords, runTranscriptionJob, transcribeSourceUrl, directSubmissionProblem
} from '../src/reader/transcribe-flow.js';

// transcribeSourceUrl — smoke-failure diagnosis B2. A KNOWN platform
// (one with a src/shared/platforms/index.js handler) keeps sending its
// page URL always, because that's what yt-dlp resolves best and the
// signed-URL hazard (IG/FB) is real there. Anything else prefers a
// discovered mediaHints.fileUrl when it's https, falling back to the
// page URL otherwise. article.url itself is never touched by this
// function — only what gets POSTed to the job.
test('transcribeSourceUrl: a known platform (YouTube) always sends the page URL, fileUrl or not', () => {
    assert.equal(transcribeSourceUrl({
        url: 'https://www.youtube.com/watch?v=abc123DEF45',
        platform: 'youtube',
        mediaHints: { audio: false, video: true, embeds: [], fileUrl: 'https://cdn.example.com/decoy.mp4' }
    }), 'https://www.youtube.com/watch?v=abc123DEF45');
});

test('transcribeSourceUrl: a known platform with no fileUrl still sends the page URL', () => {
    assert.equal(transcribeSourceUrl({
        url: 'https://www.instagram.com/reel/abc/',
        platform: 'instagram'
    }), 'https://www.instagram.com/reel/abc/');
});

test('transcribeSourceUrl: an unknown platform with a discovered fileUrl sends the fileUrl', () => {
    assert.equal(transcribeSourceUrl({
        url: 'https://mormondiscussionpodcast.org/2026/08/some-episode/',
        platform: null,
        mediaHints: { audio: true, video: false, embeds: [], fileUrl: 'https://media.blubrry.com/x/ep.mp3' }
    }), 'https://media.blubrry.com/x/ep.mp3');
});

test('transcribeSourceUrl: an unknown platform with no fileUrl falls back to the page URL', () => {
    assert.equal(transcribeSourceUrl({
        url: 'https://example.com/some-article',
        platform: null
    }), 'https://example.com/some-article');
});

test('transcribeSourceUrl: an http:// fileUrl is not fetchable — falls back to the page URL', () => {
    assert.equal(transcribeSourceUrl({
        url: 'https://example.com/some-article',
        mediaHints: { audio: true, video: false, embeds: [], fileUrl: 'http://cdn.example.com/ep.mp3' }
    }), 'https://example.com/some-article');
});

test('transcribeSourceUrl: no article at all does not throw', () => {
    assert.equal(transcribeSourceUrl(null), undefined);
});

const NOW = 1_750_000_000_000;

/** Scripted io: sendMessage answers from a queue keyed by message type. */
function makeIo({ statusScript = [], startResp = { ok: true, jobId: 'j-new' }, store = {} } = {}) {
    const sent = [];
    let statusIdx = 0;
    return {
        sent,
        store,
        io: {
            sendMessage: async (msg) => {
                sent.push(msg);
                if (msg.type === 'xray:transcribe:start') return startResp;
                if (msg.type === 'xray:transcribe:status') {
                    const r = statusScript[Math.min(statusIdx, statusScript.length - 1)];
                    statusIdx += 1;
                    return typeof r === 'function' ? r() : r;
                }
                return { ok: false, error: 'unknown' };
            },
            storageGet: async (key) => store[key],
            storageSet: async (key, value) => { store[key] = value; },
            storageRemove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; },
            storageGetAll: async () => ({ ...store }),
            sleep: async () => {},
            now: () => NOW,
            onProgress: () => {}
        }
    };
}

test('jobRecordKey + isRecordStale: TTL boundary', () => {
    assert.equal(jobRecordKey('vid1'), JOB_RECORD_PREFIX + 'vid1');
    assert.equal(isRecordStale(null), true);
    assert.equal(isRecordStale({ startedAt: NOW - 1000 }, NOW), false);
    assert.equal(isRecordStale({ startedAt: NOW - JOB_RECORD_TTL_MS - 1 }, NOW), true);
});

test('describeProgress: queued position, stage labels, honest %', () => {
    assert.match(describeProgress(null), /Contacting/);
    assert.equal(describeProgress({ status: 'queued', queue_position: 2 }), 'Queued behind 2 jobs…');
    assert.equal(describeProgress({ status: 'running', stage: 'downloading', progress: 0.07 }), 'Downloading audio… 7%');
    assert.equal(describeProgress({ status: 'running', stage: 'diarizing', progress: 0.9 }), 'Identifying speakers… 90%');
});

test('describeProgress: cloud jobs — uploading stage, provider-named transcribing', () => {
    assert.equal(
        describeProgress({ status: 'running', stage: 'uploading', progress: 0.2, provider: 'assemblyai' }),
        'Uploading audio… 20%');
    assert.equal(
        describeProgress({ status: 'running', stage: 'transcribing', progress: 0.5, provider: 'assemblyai' }),
        'Transcribing (AssemblyAI)… 50%');
    assert.equal(
        describeProgress({ status: 'running', stage: 'transcribing', progress: 0.5, provider: 'deepgram' }),
        'Transcribing (Deepgram)… 50%');
    // No provider field (older companion) keeps the WhisperX label.
    assert.equal(
        describeProgress({ status: 'running', stage: 'transcribing', progress: 0.5 }),
        'Transcribing (WhisperX)… 50%');
    // Provider never changes the non-transcribing stage labels.
    assert.equal(
        describeProgress({ status: 'running', stage: 'downloading', progress: 0.1, provider: 'deepgram' }),
        'Downloading audio… 10%');
});

test('providerPhrase: banner/toast wording', () => {
    assert.equal(providerPhrase('assemblyai'), 'via AssemblyAI');
    assert.equal(providerPhrase('deepgram'), 'via Deepgram');
    assert.equal(providerPhrase('local'), 'locally');
    assert.equal(providerPhrase(undefined), 'locally');
});

test('runTranscriptionJob: the picked engine rides the start message and the job record', async () => {
    const { io, sent, store } = makeIo({
        startResp: { ok: true, jobId: 'j-cloud', provider: 'assemblyai' },
        statusScript: [{ ok: true, job: { status: 'done', result: { segments: [1] } } }]
    });
    const out = await runTranscriptionJob({ mediaUrl: 'https://v', mediaKey: 'vid9', provider: 'assemblyai', io });
    assert.equal(out.ok, true);
    const start = sent.find((m) => m.type === 'xray:transcribe:start');
    assert.equal(start.provider, 'assemblyai');
    assert.equal(store[jobRecordKey('vid9')].provider, 'assemblyai');
});

test('runTranscriptionJob: no provider given → none sent (SW resolves the stored preference)', async () => {
    const { io, sent } = makeIo({
        statusScript: [{ ok: true, job: { status: 'done', result: { segments: [1] } } }]
    });
    await runTranscriptionJob({ mediaUrl: 'https://v', mediaKey: 'vid10', io });
    const start = sent.find((m) => m.type === 'xray:transcribe:start');
    assert.ok(!('provider' in start), 'absent means the stored preference decides');
});

test('runTranscriptionJob: a missing cloud key surfaces missingKey for the picker', async () => {
    const { io } = makeIo({
        startResp: { ok: false, missingKey: 'deepgram', error: 'No Deepgram API key saved.' }
    });
    const out = await runTranscriptionJob({ mediaUrl: 'https://v', mediaKey: 'vid11', provider: 'deepgram', io });
    assert.equal(out.ok, false);
    assert.equal(out.missingKey, 'deepgram');
    assert.match(out.error, /Deepgram/);
});

test('decideResume: an explicit engine choice beats a mismatched prior record', () => {
    const rec = { jobId: 'j-aai', startedAt: NOW - 1000, provider: 'assemblyai' };
    const doneResp = { ok: true, job: { status: 'done', result: { segments: [1] } } };
    // Field-found 2026-08-02: picking Local must NOT adopt the old
    // AssemblyAI job's result.
    assert.deepEqual(decideResume(rec, doneResp, NOW, 'local'), { action: 'start' });
    // Same engine chosen: adoption still applies (no wasted re-run).
    assert.equal(decideResume(rec, doneResp, NOW, 'assemblyai').action, 'adopt');
    // No explicit choice (plain button with a stored default resolved
    // by the SW): the record stands, whatever engine it used.
    assert.equal(decideResume(rec, doneResp, NOW, undefined).action, 'adopt');
    // Pre-engine-choice record (no provider stamp): old behavior.
    const legacy = { jobId: 'j-old', startedAt: NOW - 1000 };
    assert.equal(decideResume(legacy, doneResp, NOW, 'local').action, 'adopt');
});

test('runTranscriptionJob: mismatched record skips the status probe and starts fresh', async () => {
    const { io, sent, store } = makeIo({
        startResp: { ok: true, jobId: 'j-new-local', provider: 'local' },
        statusScript: [{ ok: true, job: { status: 'done', result: { segments: [1] } } }],
        store: { [jobRecordKey('vidM')]: { jobId: 'j-aai', startedAt: NOW - 1000, provider: 'assemblyai' } }
    });
    const out = await runTranscriptionJob({ mediaUrl: 'https://v', mediaKey: 'vidM', provider: 'local', io });
    assert.equal(out.ok, true);
    // The old AssemblyAI job was never even asked about…
    const statusTargets = sent.filter((m) => m.type === 'xray:transcribe:status').map((m) => m.jobId);
    assert.ok(!statusTargets.includes('j-aai'), 'mismatched job must not be probed/resumed');
    // …and the fresh local job replaced the record.
    assert.equal(store[jobRecordKey('vidM')].jobId, 'j-new-local');
    assert.equal(store[jobRecordKey('vidM')].provider, 'local');
});

test('decideResume: the whole policy table', () => {
    const rec = { jobId: 'j-1', startedAt: NOW - 1000 };
    assert.deepEqual(decideResume(null, null, NOW), { action: 'start' });
    assert.deepEqual(decideResume({ startedAt: NOW - JOB_RECORD_TTL_MS - 1, jobId: 'j' }, null, NOW), { action: 'start' });
    assert.deepEqual(decideResume(rec, { ok: false, status: 404 }, NOW), { action: 'start' });
    assert.deepEqual(decideResume(rec, { ok: false, unreachable: true }, NOW), { action: 'resume', jobId: 'j-1' });
    assert.deepEqual(decideResume(rec, { ok: true, job: { status: 'running' } }, NOW), { action: 'resume', jobId: 'j-1' });
    assert.deepEqual(decideResume(rec, { ok: true, job: { status: 'failed' } }, NOW), { action: 'start' });
    assert.deepEqual(
        decideResume(rec, { ok: true, job: { status: 'done', result: { segments: [] } } }, NOW),
        { action: 'adopt', result: { segments: [] } });
});

test('reapStaleJobRecords: removes only stale prefixed keys', async () => {
    const store = {
        [jobRecordKey('old')]: { jobId: 'a', startedAt: NOW - JOB_RECORD_TTL_MS - 1 },
        [jobRecordKey('fresh')]: { jobId: 'b', startedAt: NOW - 1000 },
        'xray:flags': '{}'
    };
    const { io } = makeIo({ store });
    const n = await reapStaleJobRecords(io, NOW);
    assert.equal(n, 1);
    assert.ok(!(jobRecordKey('old') in store));
    assert.ok(jobRecordKey('fresh') in store);
    assert.ok('xray:flags' in store, 'non-prefixed keys untouched');
});

test('fresh run: start → persist record → poll to done; record KEPT for the caller', async () => {
    const result = { video_id: 'v', segments: [{ start: 0, end: 1, speaker: 'SPEAKER_00', text: 'hi' }] };
    const { io, sent, store } = makeIo({
        statusScript: [
            { ok: true, job: { status: 'queued', queue_position: 1 } },
            { ok: true, job: { status: 'running', stage: 'transcribing', progress: 0.4 } },
            { ok: true, job: { status: 'done', result } }
        ]
    });
    const out = await runTranscriptionJob({ mediaUrl: 'https://w', mediaKey: 'v', io });
    assert.equal(out.ok, true);
    assert.deepEqual(out.result, result);
    assert.equal(sent.filter((m) => m.type === 'xray:transcribe:start').length, 1);
    // The record is the only handle to the finished server-side result,
    // and adoption can still refuse (edit conflict) — the CALLER reaps
    // it only after a successful adoption.
    assert.ok(jobRecordKey('v') in store, 'record survives until adoption succeeds');
});

test('resume: live record + running job → NO second start message', async () => {
    const { io, sent } = makeIo({
        store: { [jobRecordKey('v')]: { jobId: 'j-1', startedAt: NOW - 1000 } },
        statusScript: [
            { ok: true, job: { status: 'running', stage: 'diarizing', progress: 0.9 } },
            { ok: true, job: { status: 'done', result: { segments: [1] } } }
        ]
    });
    const out = await runTranscriptionJob({ mediaUrl: 'https://w', mediaKey: 'v', io });
    assert.equal(out.ok, true);
    assert.equal(sent.filter((m) => m.type === 'xray:transcribe:start').length, 0, 'never double-submits');
});

test('done-while-away: reopening adopts the finished job without polling, record kept', async () => {
    const result = { segments: [1] };
    const { io, sent, store } = makeIo({
        store: { [jobRecordKey('v')]: { jobId: 'j-1', startedAt: NOW - 1000 } },
        statusScript: [{ ok: true, job: { status: 'done', result } }]
    });
    const out = await runTranscriptionJob({ mediaUrl: 'https://w', mediaKey: 'v', io });
    assert.equal(out.ok, true);
    assert.deepEqual(out.result, result);
    assert.equal(sent.length, 1, 'one status call, no start, no poll loop');
    assert.ok(jobRecordKey('v') in store, 'a refused adoption can still re-reach this result');
});

test('service down at start: clear error, nothing persisted', async () => {
    const { io, store } = makeIo({
        startResp: { ok: false, unreachable: true, error: 'Companion transcription service not reachable at http://127.0.0.1:8756. …' }
    });
    const out = await runTranscriptionJob({ mediaUrl: 'https://w', mediaKey: 'v', io });
    assert.equal(out.ok, false);
    assert.match(out.error, /not reachable/);
    assert.ok(!(jobRecordKey('v') in store));
});

test('unreachable mid-poll: tolerated briefly, then resumable failure that KEEPS the record', async () => {
    const { io, store } = makeIo({
        statusScript: [{ ok: false, unreachable: true, error: 'Companion transcription service not reachable…' }]
    });
    const out = await runTranscriptionJob({ mediaUrl: 'https://w', mediaKey: 'v', io });
    assert.equal(out.ok, false);
    assert.equal(out.resumable, true);
    assert.ok(jobRecordKey('v') in store, 'the record survives — a later click resumes the same job');
});

test('unreachable blips under the threshold recover', async () => {
    const blip = { ok: false, unreachable: true, error: 'down' };
    const { io } = makeIo({
        statusScript: [
            blip, blip,
            { ok: true, job: { status: 'done', result: { segments: [1] } } }
        ]
    });
    assert.ok(MAX_UNREACHABLE_POLLS > 2, 'precondition for this fixture');
    const out = await runTranscriptionJob({ mediaUrl: 'https://w', mediaKey: 'v', io });
    assert.equal(out.ok, true);
});

test('failed job: error surfaced, record reaped so the next click starts fresh', async () => {
    const { io, store } = makeIo({
        statusScript: [{ ok: true, job: { status: 'failed', error: 'HF_TOKEN is not set. …' } }]
    });
    const out = await runTranscriptionJob({ mediaUrl: 'https://w', mediaKey: 'v', io });
    assert.equal(out.ok, false);
    assert.match(out.error, /HF_TOKEN/);
    assert.ok(!(jobRecordKey('v') in store));
});

test('404 mid-poll (server restarted past retention): record reaped, clear error', async () => {
    const { io, store } = makeIo({
        statusScript: [
            { ok: true, job: { status: 'running', stage: 'transcribing', progress: 0.2 } },
            { ok: false, status: 404, error: 'Transcriber request failed: unknown job' }
        ]
    });
    const out = await runTranscriptionJob({ mediaUrl: 'https://w', mediaKey: 'v', io });
    assert.equal(out.ok, false);
    assert.match(out.error, /no longer knows this job/);
    assert.ok(!(jobRecordKey('v') in store));
});

test('runTranscriptionJob: a generic media key stores and resumes its own record', async () => {
    const KEY = 'u_0123456789abcdef';
    const { io, store, sent } = makeIo({
        startResp: { ok: true, jobId: 'j-generic', provider: 'local' },
        statusScript: [{ ok: true, job: { status: 'done', result: { segments: [{ start: 0, end: 1, text: 'hi' }] } } }]
    });
    const out = await runTranscriptionJob({
        mediaUrl: 'https://mormonstories.org/podcast/ep-1/', mediaKey: KEY, io
    });
    assert.equal(out.ok, true);
    // The record is keyed by the media key and SURVIVES success — the
    // caller drops it only after a successful adoption.
    assert.ok(store[JOB_RECORD_PREFIX + KEY], 'record kept under the media key');
    assert.equal(store[JOB_RECORD_PREFIX + KEY].jobId, 'j-generic');
    const start = sent.find((m) => m.type === 'xray:transcribe:start');
    assert.equal(start.url, 'https://mormonstories.org/podcast/ep-1/');
});

// ------------------------------------------------------------------
// Direct cloud transcription (DC.1) — routing the SAME driver at a
// different transport.
//
// The point of these tests is that runTranscriptionJob was NOT forked:
// one job driver, one page-driven poll loop, one tested lifecycle. The
// only things that vary are which message types it speaks and how often
// it polls. Every assertion above this line is the regression net for
// the companion path — none of them were modified.
// ------------------------------------------------------------------

const DIRECT_START = 'xray:transcribe:direct:start';
const DIRECT_STATUS = 'xray:transcribe:direct:status';

/** Scripted io for the direct message pair. */
function makeDirectIo({ statusScript = [], startResp = { ok: true, jobId: 'aai-1', provider: 'assemblyai-direct' }, store = {} } = {}) {
    const sent = [];
    let statusIdx = 0;
    return {
        sent,
        store,
        io: {
            sendMessage: async (msg) => {
                sent.push(msg);
                if (msg.type === DIRECT_START) return startResp;
                if (msg.type === DIRECT_STATUS) {
                    const r = statusScript[Math.min(statusIdx, statusScript.length - 1)];
                    statusIdx += 1;
                    return typeof r === 'function' ? r() : r;
                }
                return { ok: false, error: 'unknown' };
            },
            storageGet: async (key) => store[key],
            storageSet: async (key, value) => { store[key] = value; },
            storageRemove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; },
            storageGetAll: async () => ({ ...store }),
            sleep: async () => {},
            now: () => NOW,
            onProgress: () => {}
        }
    };
}

test('runTranscriptionJob defaults to the companion message types', async () => {
    // The parameterization must be invisible to every existing caller.
    const { sent, io } = makeIo({ statusScript: [{ ok: true, job: { status: 'done', result: { segments: [1] } } }] });
    await runTranscriptionJob({ mediaUrl: 'https://x/a.mp3', mediaKey: 'k', io });
    assert.deepEqual([...new Set(sent.map((m) => m.type))],
        ['xray:transcribe:start', 'xray:transcribe:status']);
});

test('runTranscriptionJob routes to the direct message types when asked', async () => {
    const { sent, store, io } = makeDirectIo({
        statusScript: [{ ok: true, job: { status: 'done', result: { segments: [1] }, provider: 'assemblyai-direct' } }]
    });
    const out = await runTranscriptionJob({
        mediaUrl: 'https://cdn.example.com/ep.mp3',
        mediaKey: 'k',
        provider: 'assemblyai-direct',
        route: 'direct',
        startType: DIRECT_START,
        statusType: DIRECT_STATUS,
        io
    });
    assert.equal(out.ok, true);
    assert.deepEqual([...new Set(sent.map((m) => m.type))], [DIRECT_START, DIRECT_STATUS]);
    // The provider transcript id must be persisted BEFORE the first
    // poll — it is the only handle to an already-paid job.
    assert.equal(store[jobRecordKey('k', 'direct')].jobId, 'aai-1');
    assert.equal(store[jobRecordKey('k', 'direct')].route, 'direct');
    // ...and it does NOT occupy the companion key.
    assert.equal(store[jobRecordKey('k')], undefined);
});

test('a companion job record never resumes on the direct transport, or vice versa', () => {
    // Routes are not interchangeable: a companion job id means nothing
    // to AssemblyAI, and polling the wrong one with a credential is
    // worse than starting fresh.
    const live = { ok: true, job: { status: 'running' } };
    const companionRecord = { jobId: 'j1', startedAt: NOW, route: 'companion' };
    const directRecord = { jobId: 'aai-1', startedAt: NOW, route: 'direct' };

    assert.equal(decideResume(companionRecord, live, NOW, null, 'companion').action, 'resume');
    assert.equal(decideResume(companionRecord, live, NOW, null, 'direct').action, 'start');
    assert.equal(decideResume(directRecord, live, NOW, null, 'direct').action, 'resume');
    assert.equal(decideResume(directRecord, live, NOW, null, 'companion').action, 'start');

    // Cross-route refusal must hold for a FINISHED job too — adopting a
    // companion result on a direct run would misreport which engine ran.
    const done = { ok: true, job: { status: 'done', result: { segments: [1] } } };
    assert.equal(decideResume(directRecord, done, NOW, null, 'direct').action, 'adopt');
    assert.equal(decideResume(directRecord, done, NOW, null, 'companion').action, 'start');
});

test('a pre-DC.1 record with no route still resumes on the companion path', () => {
    // Records written before this slice carry neither route nor
    // provider. They must behave exactly as they did.
    const legacy = { jobId: 'j1', startedAt: NOW };
    const live = { ok: true, job: { status: 'running' } };
    assert.equal(decideResume(legacy, live, NOW).action, 'resume');
    assert.equal(decideResume(legacy, live, NOW, null, 'companion').action, 'resume');
    // ...but it is not a direct job, so a direct run starts fresh.
    assert.equal(decideResume(legacy, live, NOW, null, 'direct').action, 'start');
});

test('a stored record for a DIFFERENT url starts fresh', () => {
    // The media key is a hash of the submitted URL, but a record can
    // outlive a page edit that changes which file URL is discovered.
    // Submitting job A's id against URL B would bill the wrong audio.
    const record = { jobId: 'aai-1', startedAt: NOW, route: 'direct', url: 'https://cdn/a.mp3' };
    const live = { ok: true, job: { status: 'running' } };
    assert.equal(decideResume(record, live, NOW, null, 'direct', 'https://cdn/a.mp3').action, 'resume');
    assert.equal(decideResume(record, live, NOW, null, 'direct', 'https://cdn/b.mp3').action, 'start');
});

test('describeProgress omits the percentage when there is no honest one', () => {
    // The direct path has no duration probe and no provider-reported
    // percentage, so "0%" would be a fabricated number that also reads
    // as a stuck job. Absent progress is not zero progress.
    assert.equal(
        describeProgress({ status: 'running', stage: 'transcribing', provider: 'assemblyai-direct' }),
        'Transcribing (AssemblyAI)…'
    );
    assert.equal(
        describeProgress({ status: 'running', stage: 'transcribing' }),
        'Transcribing (WhisperX)…'
    );
    // An EXPLICIT zero is still a real reading and still renders.
    assert.equal(
        describeProgress({ status: 'running', stage: 'downloading', progress: 0 }),
        'Downloading audio… 0%'
    );
});

test('the direct engine never announces itself as local', () => {
    // providerPhrase renders both the in-flight banner and the success
    // toast. Any engine it does not know says "locally" — which for a
    // run that handed a third party a URL is exactly the durable lie
    // the JOURNAL ruled against on 2026-08-02.
    assert.equal(providerPhrase('assemblyai-direct'), 'via AssemblyAI');
    assert.notEqual(providerPhrase('assemblyai-direct'), 'locally');
});

test('a companion run cannot clobber the record of an in-flight PAID direct job', async () => {
    // Found by adversarial review and REPRODUCED before this fix: the
    // cross-route guard correctly refuses to RESUME a direct record on
    // the companion transport, but the new companion job's record write
    // then overwrote it under the same key — destroying the only handle
    // to an already-paid provider job. Route-scoped keys make the two
    // records coexist.
    const store = {};
    const io = (startResp) => ({
        sendMessage: async (msg) => (msg.type.endsWith(':start')
            ? startResp
            : { ok: true, job: { status: 'done', result: { segments: [1] } } }),
        storageGet: async (k) => store[k],
        storageSet: async (k, v) => { store[k] = v; },
        storageRemove: async (ks) => { for (const k of [].concat(ks)) delete store[k]; },
        storageGetAll: async () => ({ ...store }),
        sleep: async () => {}, now: () => NOW, onProgress: () => {}
    });

    await runTranscriptionJob({
        mediaUrl: 'https://cdn/ep.mp3', mediaKey: 'K', provider: 'assemblyai-direct',
        route: 'direct', startType: DIRECT_START, statusType: DIRECT_STATUS,
        io: io({ ok: true, jobId: 'aai-PAID', provider: 'assemblyai-direct' })
    });
    await runTranscriptionJob({
        mediaUrl: 'https://cdn/ep.mp3', mediaKey: 'K',
        io: io({ ok: true, jobId: 'companion-99' })
    });

    assert.equal(store[jobRecordKey('K', 'direct')].jobId, 'aai-PAID',
        'the paid provider job id must survive an unrelated companion run');
    assert.equal(store[jobRecordKey('K')].jobId, 'companion-99');
});

test('the companion record key is unchanged, so pre-DC.1 records still resolve', () => {
    // Route-scoping must not re-key existing records: a companion job
    // recorded by a build that predates this slice has to keep resuming.
    assert.equal(jobRecordKey('K'), JOB_RECORD_PREFIX + 'K');
    assert.equal(jobRecordKey('K', 'companion'), JOB_RECORD_PREFIX + 'K');
    assert.equal(jobRecordKey('K', undefined), JOB_RECORD_PREFIX + 'K');
    assert.notEqual(jobRecordKey('K', 'direct'), jobRecordKey('K'));
    // Both still start with the reaper's prefix, so neither leaks past TTL.
    assert.ok(jobRecordKey('K', 'direct').startsWith(JOB_RECORD_PREFIX));
});

test('the stale reaper collects direct records too', async () => {
    const store = {
        [jobRecordKey('K')]: { jobId: 'a', startedAt: NOW - JOB_RECORD_TTL_MS - 1 },
        [jobRecordKey('K', 'direct')]: { jobId: 'b', startedAt: NOW - JOB_RECORD_TTL_MS - 1 },
        [jobRecordKey('L', 'direct')]: { jobId: 'c', startedAt: NOW }
    };
    const io = {
        storageGetAll: async () => ({ ...store }),
        storageRemove: async (ks) => { for (const k of [].concat(ks)) delete store[k]; }
    };
    assert.equal(await reapStaleJobRecords(io, NOW), 2);
    assert.deepEqual(Object.keys(store), [jobRecordKey('L', 'direct')]);
});

// ------------------------------------------------------------------
// The direct path cannot resolve a PAGE.
//
// Field failure 2026-08-15 (architectureofabuse.com/e/episode1, a
// PodBean-hosted episode): no fileUrl was discovered, transcribeSourceUrl
// fell back to the page URL as designed, and the direct route handed
// AssemblyAI an HTML document — "Transcoding failed. File type
// text/html". The user paid an API call to be told the obvious.
//
// The asymmetry is the point: the companion resolves pages, because
// yt-dlp does. A provider fetching a URL cannot. So the same fallback
// that is correct for the companion is guaranteed-useless for direct,
// and this refuses it locally instead of spending the call.
//
// The test is non-heuristic: the article's OWN url is definitionally a
// page, not a media file — unless the capture is itself a media file,
// which is why the extension check is there.
// ------------------------------------------------------------------

test('directSubmissionProblem: refuses to submit the captured page itself', () => {
    const article = { url: 'https://architectureofabuse.com/e/episode1' };
    const problem = directSubmissionProblem(article, article.url);
    assert.ok(problem, 'a page URL must be refused before the API call');
    assert.match(problem.short, /no direct media file/i);
    assert.match(problem.detail, /Media/i, 'the Media modal is the escape hatch off-platform — name it');
    // Must not read as a companion problem: the reader attaches
    // companion setup advice to anything containing "not reachable".
    assert.ok(!/not reachable/i.test(problem.short + problem.detail));
});

test('directSubmissionProblem: a discovered media file is admitted', () => {
    const article = {
        url: 'https://architectureofabuse.com/e/episode1',
        mediaHints: { fileUrl: 'https://mcdn.podbean.com/mf/web/abc/Ep1.mp3' }
    };
    assert.equal(directSubmissionProblem(article, transcribeSourceUrl(article)), null);
});

test('directSubmissionProblem: a capture whose own URL IS the media file is admitted', () => {
    const article = { url: 'https://cdn.example.com/ep.mp3' };
    assert.equal(directSubmissionProblem(article, article.url), null);
    const q = { url: 'https://cdn.example.com/ep.m4a?token=abc' };
    assert.equal(directSubmissionProblem(q, q.url), null);
});

test('directSubmissionProblem: YouTube gets the remedy that actually applies', () => {
    // Field report 2026-08-16. The DC.1 message advised two remedies,
    // and on YouTube BOTH are wrong: you cannot paste a stable direct
    // file URL (they are signed and expire — kickoff §8), and "run it
    // through the companion" is useless advice to the direct-only user
    // this feature exists for. What is TRUE on YouTube is that the
    // captions are already captured with the page, so the user is not
    // missing a transcript at all — only diarized speaker labels.
    const article = { url: 'https://www.youtube.com/watch?v=abc123DEF45', platform: 'youtube' };
    const problem = directSubmissionProblem(article, transcribeSourceUrl(article));
    assert.ok(problem);
    assert.match(problem.detail, /caption/i, 'say the captions are already captured');
    assert.match(problem.detail, /speaker label/i, 'say what transcribing would actually add');
    assert.ok(!/paste/i.test(problem.detail),
        'never advise pasting a direct file URL for a platform whose URLs are signed and expire');
});

test('directSubmissionProblem: other known platforms say signed URLs, not "no file found"', () => {
    const article = { url: 'https://www.instagram.com/reel/abc/', platform: 'instagram' };
    const problem = directSubmissionProblem(article, transcribeSourceUrl(article));
    assert.ok(problem);
    assert.match(problem.short, /sign|expir/i);
    assert.ok(!/caption/i.test(problem.detail), 'the captions line is YouTube-specific');
});

test('directSubmissionProblem: the short form is one line, fit for a menu row', () => {
    for (const article of [
        { url: 'https://example.com/e/1' },
        { url: 'https://www.youtube.com/watch?v=abc123DEF45', platform: 'youtube' }
    ]) {
        const { short } = directSubmissionProblem(article, transcribeSourceUrl(article));
        assert.ok(short.length <= 90, `too long for a menu row (${short.length}): ${short}`);
        assert.ok(!short.includes('\n'));
    }
});


test('directSubmissionProblem: platform names are human, and the grammar holds', () => {
    // Read the output, do not just assert a substring: the first cut
    // produced "cannot transcribe a instagram page" — lowercase id and
    // a broken article. Sentences are phrased to avoid a/an entirely.
    const cases = [['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['twitter', 'X'], ['youtube', 'YouTube']];
    for (const [id, label] of cases) {
        const article = { url: `https://${id}.example/x`, platform: id };
        const { short, detail } = directSubmissionProblem(article, transcribeSourceUrl(article));
        assert.ok(short.startsWith(label), `menu row should lead with "${label}": ${short}`);
        assert.ok(!new RegExp(`\\\\b${id}\\\\b`).test(short + detail),
            `the raw platform id "${id}" leaked into user-visible text`);
        // The a/an problem is removed STRUCTURALLY — the sentence says
        // "this <Platform> page", never "a <Platform> page" — so pin the
        // phrasing rather than trying to spell-check English articles
        // ("a URL" is correct; a naive vowel rule flags it).
        assert.match(detail, new RegExp(`cannot transcribe this ${label} page`));
    }
});

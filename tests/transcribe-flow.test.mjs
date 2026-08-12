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
    reapStaleJobRecords, runTranscriptionJob
} from '../src/reader/transcribe-flow.js';

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
    const out = await runTranscriptionJob({ videoUrl: 'https://v', videoId: 'vid9', provider: 'assemblyai', io });
    assert.equal(out.ok, true);
    const start = sent.find((m) => m.type === 'xray:transcribe:start');
    assert.equal(start.provider, 'assemblyai');
    assert.equal(store[jobRecordKey('vid9')].provider, 'assemblyai');
});

test('runTranscriptionJob: no provider given → none sent (SW resolves the stored preference)', async () => {
    const { io, sent } = makeIo({
        statusScript: [{ ok: true, job: { status: 'done', result: { segments: [1] } } }]
    });
    await runTranscriptionJob({ videoUrl: 'https://v', videoId: 'vid10', io });
    const start = sent.find((m) => m.type === 'xray:transcribe:start');
    assert.ok(!('provider' in start), 'absent means the stored preference decides');
});

test('runTranscriptionJob: a missing cloud key surfaces missingKey for the picker', async () => {
    const { io } = makeIo({
        startResp: { ok: false, missingKey: 'deepgram', error: 'No Deepgram API key saved.' }
    });
    const out = await runTranscriptionJob({ videoUrl: 'https://v', videoId: 'vid11', provider: 'deepgram', io });
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
    const out = await runTranscriptionJob({ videoUrl: 'https://v', videoId: 'vidM', provider: 'local', io });
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
    const out = await runTranscriptionJob({ videoUrl: 'https://w', videoId: 'v', io });
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
    const out = await runTranscriptionJob({ videoUrl: 'https://w', videoId: 'v', io });
    assert.equal(out.ok, true);
    assert.equal(sent.filter((m) => m.type === 'xray:transcribe:start').length, 0, 'never double-submits');
});

test('done-while-away: reopening adopts the finished job without polling, record kept', async () => {
    const result = { segments: [1] };
    const { io, sent, store } = makeIo({
        store: { [jobRecordKey('v')]: { jobId: 'j-1', startedAt: NOW - 1000 } },
        statusScript: [{ ok: true, job: { status: 'done', result } }]
    });
    const out = await runTranscriptionJob({ videoUrl: 'https://w', videoId: 'v', io });
    assert.equal(out.ok, true);
    assert.deepEqual(out.result, result);
    assert.equal(sent.length, 1, 'one status call, no start, no poll loop');
    assert.ok(jobRecordKey('v') in store, 'a refused adoption can still re-reach this result');
});

test('service down at start: clear error, nothing persisted', async () => {
    const { io, store } = makeIo({
        startResp: { ok: false, unreachable: true, error: 'Companion transcription service not reachable at http://127.0.0.1:8756. …' }
    });
    const out = await runTranscriptionJob({ videoUrl: 'https://w', videoId: 'v', io });
    assert.equal(out.ok, false);
    assert.match(out.error, /not reachable/);
    assert.ok(!(jobRecordKey('v') in store));
});

test('unreachable mid-poll: tolerated briefly, then resumable failure that KEEPS the record', async () => {
    const { io, store } = makeIo({
        statusScript: [{ ok: false, unreachable: true, error: 'Companion transcription service not reachable…' }]
    });
    const out = await runTranscriptionJob({ videoUrl: 'https://w', videoId: 'v', io });
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
    const out = await runTranscriptionJob({ videoUrl: 'https://w', videoId: 'v', io });
    assert.equal(out.ok, true);
});

test('failed job: error surfaced, record reaped so the next click starts fresh', async () => {
    const { io, store } = makeIo({
        statusScript: [{ ok: true, job: { status: 'failed', error: 'HF_TOKEN is not set. …' } }]
    });
    const out = await runTranscriptionJob({ videoUrl: 'https://w', videoId: 'v', io });
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
    const out = await runTranscriptionJob({ videoUrl: 'https://w', videoId: 'v', io });
    assert.equal(out.ok, false);
    assert.match(out.error, /no longer knows this job/);
    assert.ok(!(jobRecordKey('v') in store));
});

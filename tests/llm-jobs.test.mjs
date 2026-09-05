// LLM job records (shared/llm-jobs.js) — JOURNAL 2026-09-05.
//
// The field bug: the corpus reduce held ONE runtime message open across
// the whole Anthropic call; MV3 killed the worker at ~5 minutes and the
// paid result died with it ("the message channel closed before a
// response was received" — a ~$5 Fable run). The invariants pinned here
// are the ones that make that impossible to repeat:
//
//   1. `start` answers before the pass settles — no request ever waits
//      on the model.
//   2. The raw result is ON DISK before any status response carries it.
//   3. A fresh runner (a restarted worker) serves the persisted result,
//      finds it by scope, and REUSES it on the next start — never
//      re-invoking the pass.
//   4. A `running` record no live worker knows is `lost`, and is never
//      reused.
//   5. The page client survives dropped polls without a second start.
//
// Plus the receiver-side validation the threat model asks for, and the
// source guards that keep the three passes off the held-open path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
    createLlmJobRunner, runLlmJob, ackLlmJob, findLlmJob, llmJobScopeKey,
    isLlmJobKey, jobStorageKey, LLM_JOB_LOST_ERROR, LLM_JOB_PASSES, LLM_JOB_TTL_MS,
    LLM_JOB_STATUS_WAIT_MAX_MS, LLM_JOB_KEY_PREFIX
} from '../src/shared/llm-jobs.js';
import { memoryArea, createJobStub } from './helpers/llm-job-stub.mjs';

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A pass whose settlement the test controls. */
function deferredPass() {
    let resolve, reject;
    const calls = [];
    const p = new Promise((res, rej) => { resolve = res; reject = rej; });
    const pass = async (request) => { calls.push(request); return p; };
    return { pass, calls, resolve, reject };
}

function runnerOver(area, passes, extra = {}) {
    return createLlmJobRunner({
        passes, area,
        setInterval: () => 0, clearInterval: () => {},
        ...extra
    });
}

// ---- 1 + 2: start answers first; the result lands on disk before any hop ----

test('start returns a job id BEFORE the pass settles, with the running record already persisted', async () => {
    const area = memoryArea();
    const d = deferredPass();
    const runner = runnerOver(area, { 'corpus-reduce': d.pass });

    const started = await runner.start({ pass: 'corpus-reduce', request: { extracts: [1] }, scopeKey: 'case1:hash1' });
    assert.equal(started.ok, true);
    assert.equal(started.status, 'running');
    assert.equal(started.reused, false);
    assert.equal(started.jobId, 'corpus-reduce:case1:hash1', 'scope-derived id: find/dedupe is one get');
    assert.deepEqual(d.calls, [{ extracts: [1] }], 'the pass was invoked with the request');

    const rec = area.store[jobStorageKey(started.jobId)];
    assert.ok(rec, 'the running record is on disk before start answered');
    assert.equal(rec.status, 'running');
    assert.equal(rec.result, null);
    assert.ok(!('request' in rec) || rec.request === undefined, 'the request never rides the record');

    const st = await runner.status({ jobId: started.jobId, waitMs: 0 });
    assert.equal(st.ok, true);
    assert.equal(st.status, 'running');
    assert.equal(st.result, null);
});

test('the raw result is persisted under the job id BEFORE any status message asks for it', async () => {
    const area = memoryArea();
    const d = deferredPass();
    const runner = runnerOver(area, { 'corpus-reduce': d.pass });
    const { jobId } = await runner.start({ pass: 'corpus-reduce', request: {}, scopeKey: 'c:h' });

    d.resolve({ ok: true, briefInput: { summary: 'the brief' }, model: 'claude-test', usage: { output_tokens: 9 } });
    await tick(); await tick();

    // No status poll has been sent. The disk already has the answer.
    const rec = area.store[jobStorageKey(jobId)];
    assert.equal(rec.status, 'done');
    assert.deepEqual(rec.result, { ok: true, briefInput: { summary: 'the brief' }, model: 'claude-test', usage: { output_tokens: 9 } });
    assert.equal(runner._live().length, 0, 'the registry releases a settled job');

    // And the ordering on disk was running → done, never the reverse.
    const statuses = area.sets.filter((w) => w.key === jobStorageKey(jobId)).map((w) => w.status);
    assert.deepEqual(statuses, ['running', 'done']);

    const st = await runner.status({ jobId, waitMs: LLM_JOB_STATUS_WAIT_MAX_MS });
    assert.equal(st.status, 'done');
    assert.deepEqual(st.result, rec.result);
});

test('a status long-poll returns as soon as the job settles, and the wait is clamped', async () => {
    const area = memoryArea();
    const d = deferredPass();
    const runner = runnerOver(area, { 'corpus-map': d.pass }, { statusWaitMaxMs: 30 });
    const { jobId } = await runner.start({ pass: 'corpus-map', request: { memberText: 'x' } });

    // The clamp: a page asking for an hour gets the runner's maximum.
    const t0 = Date.now();
    const still = await runner.status({ jobId, waitMs: 3_600_000 });
    assert.equal(still.status, 'running');
    assert.ok(Date.now() - t0 < 2000, 'the wait was clamped, not honored');

    const pending = runner.status({ jobId, waitMs: 30 });
    d.resolve({ ok: true, extract: { position: { summary: 's' } }, model: 'm' });
    const done = await pending;
    assert.equal(done.status, 'done');
    assert.equal(done.result.extract.position.summary, 's');
});

// ---- 3: a restarted worker serves, finds, and reuses the persisted result ----

test('RESTART PICKUP: a fresh runner over the same storage serves the result, finds it by scope, and reuses it without re-running the pass', async () => {
    const area = memoryArea();
    const first = runnerOver(area, { 'corpus-reduce': async () => ({ ok: true, briefInput: { summary: 'paid' }, model: 'm' }) });
    const { jobId } = await first.start({ pass: 'corpus-reduce', request: {}, scopeKey: llmJobScopeKey('case-9', 'f'.repeat(64)) });
    await tick(); await tick();

    // The worker dies and comes back with an empty registry.
    let invoked = 0;
    const second = runnerOver(area, { 'corpus-reduce': async () => { invoked += 1; return { ok: true }; } });
    assert.equal(second._live().length, 0);

    const st = await second.status({ jobId, waitMs: 5000 });
    assert.equal(st.ok, true);
    assert.equal(st.status, 'done');
    assert.deepEqual(st.result, { ok: true, briefInput: { summary: 'paid' }, model: 'm' });

    const found = await second.find({ pass: 'corpus-reduce', scopeKey: llmJobScopeKey('case-9', 'f'.repeat(64)) });
    assert.equal(found.ok, true);
    assert.equal(found.job.status, 'done');
    assert.equal(found.job.jobId, jobId);
    assert.equal(found.job.result, undefined, 'find is presence-only — never the payload');

    const again = await second.start({ pass: 'corpus-reduce', request: {}, scopeKey: llmJobScopeKey('case-9', 'f'.repeat(64)) });
    assert.equal(again.ok, true);
    assert.equal(again.reused, true);
    assert.equal(again.status, 'done');
    assert.equal(again.jobId, jobId);
    assert.equal(invoked, 0, 'NEVER a re-spend for a result that was paid for and kept');

    // Ack releases it; the next start runs fresh.
    await second.ack({ jobId });
    assert.ok(!(jobStorageKey(jobId) in area.store));
    const fresh = await second.start({ pass: 'corpus-reduce', request: {}, scopeKey: llmJobScopeKey('case-9', 'f'.repeat(64)) });
    assert.equal(fresh.reused, false);
    assert.equal(invoked, 1);
});

test('a start with the same scope while the job is RUNNING attaches to it (one pass call, one id)', async () => {
    const area = memoryArea();
    const d = deferredPass();
    const runner = runnerOver(area, { 'corpus-map': d.pass });
    const a = await runner.start({ pass: 'corpus-map', request: { memberText: 'x' }, scopeKey: 'k1' });
    const b = await runner.start({ pass: 'corpus-map', request: { memberText: 'x' }, scopeKey: 'k1' });
    assert.equal(b.jobId, a.jobId);
    assert.equal(b.reused, true);
    assert.equal(b.status, 'running');
    assert.equal(d.calls.length, 1);
    d.resolve({ ok: true, extract: {} });
    await tick();
});

// ---- 4: a running record nobody owns is lost, and never reused ----

test('LOST: a running record with no live worker reads as lost, is persisted as lost, and is never reused', async () => {
    const area = memoryArea();
    const dead = jobStorageKey('corpus-reduce:c:h');
    area.store[dead] = {
        id: 'corpus-reduce:c:h', pass: 'corpus-reduce', scopeKey: 'c:h', workspace: 'default', status: 'running',
        createdAt: 1, updatedAt: 1, heartbeatAt: 1, result: null, error: null
    };
    let invoked = 0;
    const runner = runnerOver(area, { 'corpus-reduce': async () => { invoked += 1; return { ok: true, briefInput: {} }; } });

    const st = await runner.status({ jobId: 'corpus-reduce:c:h', waitMs: 5000 });
    assert.equal(st.status, 'lost');
    assert.equal(st.error, LLM_JOB_LOST_ERROR);
    assert.equal(area.store[dead].status, 'lost', 'the reconciliation is written back');

    const found = await runner.find({ pass: 'corpus-reduce', scopeKey: 'c:h' });
    assert.equal(found.job.status, 'lost');

    const again = await runner.start({ pass: 'corpus-reduce', request: {}, scopeKey: 'c:h' });
    assert.equal(again.reused, false, 'a lost record is replaced, not replayed');
    assert.equal(invoked, 1);
});

test('a done-but-unsuccessful result, or a thrown pass, is never reused either', async () => {
    const area = memoryArea();
    let invoked = 0;
    const runner = runnerOver(area, {
        'entity-page': async () => { invoked += 1; return invoked === 1 ? { ok: false, error: 'gate closed' } : { ok: true, pageInput: {} }; },
        'corpus-map': async () => { throw new Error('boom'); }
    });
    const a = await runner.start({ pass: 'entity-page', request: {}, scopeKey: 'e:h' });
    await tick(); await tick();
    const st = await runner.status({ jobId: a.jobId, waitMs: 100 });
    assert.equal(st.status, 'done');
    assert.equal(st.result.ok, false);
    const b = await runner.start({ pass: 'entity-page', request: {}, scopeKey: 'e:h' });
    assert.equal(b.reused, false, 'a failed result is not a saved spend');
    assert.equal(invoked, 2);

    const c = await runner.start({ pass: 'corpus-map', request: {}, scopeKey: 'm:h' });
    await tick(); await tick();
    const stc = await runner.status({ jobId: c.jobId, waitMs: 100 });
    assert.equal(stc.status, 'failed');
    assert.match(stc.error, /boom/);
    assert.equal(stc.result, null);
});

// ---- receiver-side validation (THREAT_MODEL B4) ----

test('validation: the pass allowlist, the request shape, scope keys, job ids, and unknown jobs all fail closed', async () => {
    const area = memoryArea();
    let invoked = 0;
    const runner = runnerOver(area, {
        'corpus-map': async () => { invoked += 1; return { ok: true }; },
        'corpus-reduce': async () => { invoked += 1; return { ok: true }; },
        'entity-page': async () => { invoked += 1; return { ok: true }; },
        'hypothesis-edges': async () => { invoked += 1; return { ok: true }; }   // present, NOT allowlisted
    });
    for (const bad of [
        { pass: 'hypothesis-edges', request: {} },
        { pass: 'constructor', request: {} },
        { pass: '', request: {} },
        { request: {} },
        { pass: 'corpus-map', request: [] },
        { pass: 'corpus-map', request: 'text' },
        { pass: 'corpus-map', request: null },
        { pass: 'corpus-map', request: {}, scopeKey: 'has space' },
        { pass: 'corpus-map', request: {}, scopeKey: 'x'.repeat(201) },
        { pass: 'corpus-map', request: {}, scopeKey: 42 },
        null, 'string', 7
    ]) {
        const res = await runner.start(bad);
        assert.equal(res.ok, false, `start accepted ${JSON.stringify(bad)}`);
        assert.ok(res.error);
    }
    assert.equal(invoked, 0, 'no pass ran for a refused start');
    assert.equal(Object.keys(area.store).length, 0, 'nothing was written for a refused start');

    for (const bad of [{ jobId: '../x' }, { jobId: 'corpus-map:has space' }, { jobId: '' }, { jobId: 5 }, {}, null]) {
        assert.equal((await runner.status(bad)).ok, false, `status accepted ${JSON.stringify(bad)}`);
        assert.equal((await runner.ack(bad)).ok, false, `ack accepted ${JSON.stringify(bad)}`);
    }
    const unknown = await runner.status({ jobId: 'corpus-map:never-started' });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.unknown, true);
    assert.equal((await runner.find({ pass: 'nope', scopeKey: 'k' })).ok, false);
    assert.equal((await runner.find({ pass: 'corpus-map', scopeKey: 'bad key' })).ok, false);
    assert.deepEqual([...LLM_JOB_PASSES], ['corpus-map', 'corpus-reduce', 'entity-page']);
});

test('llmJobScopeKey clamps each part to the key alphabet and joins with ":"', () => {
    assert.equal(llmJobScopeKey('case 1/x', 'a'.repeat(64)), `case_1_x:${'a'.repeat(64)}`);
    assert.equal(llmJobScopeKey(null, undefined), ':');
    assert.ok(llmJobScopeKey('x'.repeat(500)).length <= 200);
});

// ---- housekeeping: sweep, heartbeat, persist failure ----

test('the once-per-boot sweep drops records past the TTL and keeps the rest', async () => {
    const area = memoryArea();
    const now = 10_000_000_000;
    area.store[jobStorageKey('corpus-map:old')] = { id: 'corpus-map:old', pass: 'corpus-map', status: 'done', updatedAt: now - LLM_JOB_TTL_MS - 1, result: { ok: true } };
    area.store[jobStorageKey('corpus-map:fresh')] = { id: 'corpus-map:fresh', pass: 'corpus-map', status: 'done', updatedAt: now - 1000, result: { ok: true } };
    area.store['unrelated'] = { updatedAt: 0 };
    const runner = runnerOver(area, { 'corpus-map': async () => ({ ok: true }) }, { now: () => now });
    await runner.start({ pass: 'corpus-map', request: {} });
    assert.ok(!(jobStorageKey('corpus-map:old') in area.store), 'the expired record was swept');
    assert.ok(jobStorageKey('corpus-map:fresh') in area.store, 'a fresh record survives');
    assert.ok('unrelated' in area.store, 'the sweep touches only its own prefix');
});

test('the heartbeat re-persists the record while the job runs (an API call that resets the idle timer) and stops on settle', async () => {
    const area = memoryArea();
    const d = deferredPass();
    const timers = [];
    let cleared = 0;
    let t = 1000;
    const runner = createLlmJobRunner({
        passes: { 'corpus-reduce': d.pass }, area,
        now: () => t,
        setInterval: (fn) => { timers.push(fn); return 7; },
        clearInterval: (id) => { assert.equal(id, 7); cleared += 1; }
    });
    const { jobId } = await runner.start({ pass: 'corpus-reduce', request: {} });
    assert.equal(timers.length, 1);
    const before = area.sets.length;
    t = 21000;
    timers[0]();
    await tick();
    assert.ok(area.sets.length > before, 'the heartbeat wrote');
    assert.equal(area.store[jobStorageKey(jobId)].heartbeatAt, 21000);
    d.resolve({ ok: true });
    await tick(); await tick();
    assert.equal(cleared, 1, 'the interval is cleared exactly once, on settle');
});

test('a result the store refuses (quota) is still served from memory while this worker lives, with the failure named', async () => {
    const area = memoryArea();
    const realSet = area.set;
    let writes = 0;
    area.set = (obj, cb) => {
        writes += 1;
        if (writes === 2) {   // running lands; the RESULT write fails
            globalThis.chrome = { runtime: { lastError: { message: 'QUOTA_BYTES exceeded' } } };
            cb();
            delete globalThis.chrome;
            return;
        }
        realSet(obj, cb);
    };
    const runner = runnerOver(area, { 'corpus-reduce': async () => ({ ok: true, briefInput: { summary: 'big' } }) });
    const { jobId } = await runner.start({ pass: 'corpus-reduce', request: {} });
    // Hold the registry entry open until status has read it: the
    // settle path deletes it, so poll while it is settling.
    const st = await runner.status({ jobId, waitMs: 1000 });
    assert.equal(st.status, 'done');
    assert.deepEqual(st.result, { ok: true, briefInput: { summary: 'big' } });
    assert.match(st.persistError, /QUOTA/);
});

// ---- 5: the page client ----

test('runLlmJob: returns the pass result plus jobId, never acks a success itself, and ackLlmJob releases it', async () => {
    const stub = createJobStub({ passes: { 'corpus-reduce': async (req) => ({ ok: true, briefInput: { got: req.n }, model: 'm' }) } });
    const out = await runLlmJob({ sendMessage: stub.sendMessage, pass: 'corpus-reduce', request: { n: 3 }, scopeKey: 'c:h' });
    assert.equal(out.ok, true);
    assert.deepEqual(out.briefInput, { got: 3 });
    assert.equal(out.model, 'm');
    assert.equal(out.jobId, 'corpus-reduce:c:h');
    assert.ok(jobStorageKey(out.jobId) in stub.area.store, 'a success stays until the page has persisted it');
    assert.ok(!stub.messages.some((m) => m.type === 'xray:llm:job:ack'));
    const found = await findLlmJob(stub.sendMessage, { pass: 'corpus-reduce', scopeKey: 'c:h' });
    assert.equal(found.status, 'done');
    await ackLlmJob(stub.sendMessage, out.jobId);
    assert.ok(!(jobStorageKey(out.jobId) in stub.area.store));
    assert.equal(await findLlmJob(stub.sendMessage, { pass: 'corpus-reduce', scopeKey: 'c:h' }), null);
});

test('runLlmJob: a DROPPED status poll is retried and the persisted result is picked up — start is sent exactly once', async () => {
    const d = deferredPass();
    const stub = createJobStub({ passes: { 'corpus-reduce': d.pass } });
    let statusCalls = 0;
    const flaky = async (msg) => {
        if (msg.type === 'xray:llm:job:status') {
            statusCalls += 1;
            if (statusCalls === 1) { d.resolve({ ok: true, briefInput: { summary: 'kept' } }); return undefined; }   // the channel died
            if (statusCalls === 2) return { ok: false, error: 'The message port closed before a response was received.', swLost: true };
        }
        return stub.sendMessage(msg);
    };
    const out = await runLlmJob({ sendMessage: flaky, pass: 'corpus-reduce', request: {}, scopeKey: 'c:h', sleep: async () => {} });
    assert.equal(out.ok, true);
    assert.deepEqual(out.briefInput, { summary: 'kept' });
    assert.equal(stub.messages.filter((m) => m.type === 'xray:llm:job:start').length, 1, 'NEVER a second start');
    assert.ok(statusCalls >= 3);
});

test('runLlmJob: a LOST job returns the honest error with lost/swLost/timeout flags and is acked', async () => {
    const area = memoryArea();
    area.store[jobStorageKey('entity-page:e:h')] = { id: 'entity-page:e:h', pass: 'entity-page', scopeKey: 'e:h', workspace: 'default', status: 'running', createdAt: 1, updatedAt: 1, result: null, error: null };
    // A fresh worker: the record is orphaned. start() replaces it and
    // the new run is what we poll — so stage the loss on the poll side
    // instead: the pass never resolves, and the stub's runner "dies".
    const stub = createJobStub({ passes: { 'entity-page': async () => new Promise(() => {}) }, area });
    const started = await stub.sendMessage({ type: 'xray:llm:job:start', pass: 'entity-page', request: {}, scopeKey: 'e:h' });
    // Simulate the teardown: a new runner over the same store, nothing live.
    const reborn = createJobStub({ passes: { 'entity-page': async () => ({ ok: true }) }, area });
    const out = await runLlmJob({ sendMessage: reborn.sendMessage, pass: 'entity-page', request: {}, scopeKey: 'e:h', sleep: async () => {} });
    void started;
    // The reborn worker's own start replaces the lost record with a
    // fresh run (that IS the re-bill, made explicit) — so to observe
    // the lost path itself, poll the orphaned id directly:
    const orphanArea = memoryArea();
    orphanArea.store[jobStorageKey('corpus-reduce:c:h')] = { id: 'corpus-reduce:c:h', pass: 'corpus-reduce', scopeKey: 'c:h', workspace: 'default', status: 'running', createdAt: 1, updatedAt: 1, result: null, error: null };
    const orphanStub = createJobStub({ passes: { 'corpus-reduce': async () => ({ ok: true }) }, area: orphanArea });
    // A client that started against the OLD worker and only now polls:
    const pollOnly = async (msg) => msg.type === 'xray:llm:job:start'
        ? { ok: true, jobId: 'corpus-reduce:c:h', status: 'running', reused: true }
        : orphanStub.sendMessage(msg);
    const lost = await runLlmJob({ sendMessage: pollOnly, pass: 'corpus-reduce', request: {}, scopeKey: 'c:h', sleep: async () => {} });
    assert.equal(lost.ok, false);
    assert.equal(lost.lost, true);
    assert.equal(lost.swLost, true);
    assert.equal(lost.timeout, true, 'the map orchestrator may retry a lost unit exactly as a lost channel');
    assert.equal(lost.error, LLM_JOB_LOST_ERROR);
    await tick(); await tick();   // the ack is fire-and-forget
    assert.ok(!(jobStorageKey('corpus-reduce:c:h') in orphanArea.store), 'a lost record is acked away');
    assert.equal(out.ok, true, 'the reborn worker ran the job fresh (explicit re-bill, not a silent replay)');
});

test('runLlmJob: too many dropped polls gives up with swLost and no second start; a refused start returns without polling', async () => {
    let starts = 0, polls = 0;
    const dead = async (msg) => {
        if (msg.type === 'xray:llm:job:start') { starts += 1; return { ok: true, jobId: 'corpus-map:x', status: 'running' }; }
        polls += 1;
        return undefined;
    };
    const out = await runLlmJob({ sendMessage: dead, pass: 'corpus-map', request: {}, sleep: async () => {}, maxDroppedPolls: 3 });
    assert.equal(out.ok, false);
    assert.equal(out.swLost, true);
    assert.match(out.error, /kept/);
    assert.equal(starts, 1);
    assert.equal(polls, 4);

    let polled = false;
    const refuse = async (msg) => (msg.type === 'xray:llm:job:start'
        ? { ok: false, error: 'Unknown LLM job pass: nope' }
        : (polled = true, undefined));
    const r = await runLlmJob({ sendMessage: refuse, pass: 'nope', request: {} });
    assert.equal(r.ok, false);
    assert.match(r.error, /Unknown LLM job pass/);
    assert.equal(r.swLost, false, 'a refusal from the worker is not a transport loss');
    assert.equal(polled, false);

    const thrown = await runLlmJob({ sendMessage: async () => { throw new Error('The message port closed'); }, pass: 'corpus-map', request: {} });
    assert.equal(thrown.ok, false);
    assert.equal(thrown.swLost, true);
    assert.match(thrown.error, /message port closed/);
});

test('runLlmJob: an unsuccessful pass result is returned as-is (with jobId) and acked', async () => {
    const stub = createJobStub({ passes: { 'corpus-map': async () => ({ ok: false, error: 'LLM assist is off.', member_id: 'm' }) } });
    const out = await runLlmJob({ sendMessage: stub.sendMessage, pass: 'corpus-map', request: {}, scopeKey: 'k' });
    assert.equal(out.ok, false);
    assert.equal(out.error, 'LLM assist is off.');
    assert.equal(out.member_id, 'm');
    await tick();
    assert.ok(!(jobStorageKey(out.jobId) in stub.area.store), 'nothing worth keeping');
});

// ---- source guards ----

const strip = (x) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('GUARD: the three long passes never ride a held-open message in the service worker', () => {
    const bg = strip(read('src/background/index.js'));
    // The held-open shape: a direct handler awaiting the pass into sendResponse.
    for (const t of ['xray:llm:corpus-map', 'xray:llm:corpus-reduce', 'xray:llm:entity-page']) {
        assert.ok(!bg.includes(`message.type === '${t}'`), `${t} is handled as a single held-open message again`);
    }
    for (const fn of ['runCorpusMapPass', 'runCorpusReducePass', 'runEntityPagePass']) {
        assert.ok(!new RegExp(`${fn}\\(message`).test(bg), `${fn} is invoked straight from a message handler`);
        assert.ok(!new RegExp(`${fn}\\([^)]*\\)\\s*\\.then\\(\\s*\\(result\\) => sendResponse`).test(bg),
            `${fn} is awaited into sendResponse`);
        // The ONLY reference outside the import is the runner's pass table.
        const refs = bg.split(fn).length - 1;
        assert.equal(refs, 2, `${fn} referenced ${refs} times — expected the import + the pass table`);
    }
    for (const t of ['xray:llm:job:start', 'xray:llm:job:status', 'xray:llm:job:find', 'xray:llm:job:ack']) {
        assert.ok(bg.includes(`message.type === '${t}'`), `${t} handler missing`);
    }
    assert.match(bg, /createLlmJobRunner\(\{/);
});

test('GUARD: no page sends the retired single-message types; every map/reduce/page call goes through the job client', () => {
    const files = [];
    const walk = (dir) => {
        for (const name of readdirSync(dir)) {
            const p = join(dir, name);
            if (statSync(p).isDirectory()) walk(p);
            else if (p.endsWith('.js') && !p.endsWith('.bundle.js')) files.push(p);
        }
    };
    walk(new URL('../src', import.meta.url).pathname);
    const offenders = [];
    for (const f of files) {
        const src = strip(readFileSync(f, 'utf8'));
        for (const t of ["'xray:llm:corpus-map'", "'xray:llm:corpus-reduce'", "'xray:llm:entity-page'"]) {
            if (src.includes(`type: ${t}`)) offenders.push(`${f} sends ${t}`);
        }
    }
    assert.deepEqual(offenders, []);
    for (const rel of ['src/portal/synthesis-block.js', 'src/portal/entity-page-block.js', 'src/shared/article-pass.js', 'src/shared/entity-page.js']) {
        assert.match(strip(read(rel)), /runLlmJob\(\{/, `${rel} does not use the job client`);
        assert.match(strip(read(rel)), /ackLlmJob\(/, `${rel} never releases its job record`);
    }
});

test('GUARD (copy): the synthesis failure names the stage that re-runs and that the reduce re-bills', () => {
    const src = read('src/portal/synthesis-block.js');
    assert.ok(!src.includes('make the retry cheap'), 'the misleading "retry cheap" copy is back');
    assert.match(src, /re-runs only the synthesis stage/);
    assert.match(src, /billed again/);
    assert.match(src, /extracts are cached/);
});

test('GUARD: job records are a backup-excluded prefix class', () => {
    assert.ok(isLlmJobKey(`${LLM_JOB_KEY_PREFIX}corpus-map:x`));
    assert.ok(!isLlmJobKey('xray:llm:key'));
    assert.ok(!isLlmJobKey(null));
    const backup = strip(read('src/shared/backup.js'));
    assert.match(backup, /import \{ isLlmJobKey \} from '\.\/llm-jobs\.js'/);
    assert.match(backup, /return EXCLUDED_STORAGE_KEYS\.includes\(key\) \|\| isLlmJobKey\(key\)/);
    // Every exclusion site consults the helper, not the bare list.
    const bare = backup.match(/EXCLUDED_STORAGE_KEYS\.includes\(/g) || [];
    assert.equal(bare.length, 1, 'a backup path checks the bare list and would let a job record through');
});

// ---- workspace isolation (security-threat-modeler review, 2026-09-05) ----

test('WORKSPACE: a result produced in one workspace is never found, reused, or served in another — even for identical ids', async () => {
    const area = memoryArea();
    let ws = 'wsA';
    let invoked = 0;
    const runner = runnerOver(area,
        { 'corpus-reduce': async () => { invoked += 1; return { ok: true, briefInput: { summary: `from ${ws}` } }; } },
        { workspaceId: async () => ws });

    const a = await runner.start({ pass: 'corpus-reduce', request: {}, scopeKey: 'case1:hash1' });
    await tick(); await tick();
    assert.ok(jobStorageKey(a.jobId, 'wsA') in area.store, 'persisted under the workspace it started in');
    assert.ok(!(jobStorageKey(a.jobId, 'default') in area.store));

    ws = 'wsB';
    assert.equal(await runner.find({ pass: 'corpus-reduce', scopeKey: 'case1:hash1' }).then((r) => r.job), null,
        'B cannot see A\'s result');
    const stB = await runner.status({ jobId: a.jobId, waitMs: 10 });
    assert.equal(stB.ok, false, 'B cannot read A\'s result by id either');
    assert.equal(stB.unknown, true);
    const b = await runner.start({ pass: 'corpus-reduce', request: {}, scopeKey: 'case1:hash1' });
    assert.equal(b.reused, false, 'B never reuses A\'s paid result');
    assert.equal(b.jobId, a.jobId, 'same id, different workspace key');
    await tick(); await tick();
    assert.equal(invoked, 2);
    assert.equal(area.store[jobStorageKey(a.jobId, 'wsB')].result.briefInput.summary, 'from wsB');
    assert.equal(area.store[jobStorageKey(a.jobId, 'wsA')].result.briefInput.summary, 'from wsA', 'A\'s record untouched');

    // ack in B removes only B's.
    await runner.ack({ jobId: a.jobId });
    assert.ok(!(jobStorageKey(a.jobId, 'wsB') in area.store));
    assert.ok(jobStorageKey(a.jobId, 'wsA') in area.store);

    ws = 'wsA';
    const back = await runner.start({ pass: 'corpus-reduce', request: {}, scopeKey: 'case1:hash1' });
    assert.equal(back.reused, true, 'A still picks up its own result');
    assert.equal(invoked, 2);
});

test('WORKSPACE: the workspace is resolved at the receiver, never taken from the message', async () => {
    const area = memoryArea();
    const runner = runnerOver(area, { 'corpus-map': async () => ({ ok: true }) }, { workspaceId: async () => 'real' });
    const r = await runner.start({ pass: 'corpus-map', request: {}, scopeKey: 'k', workspace: 'forged', workspaceId: 'forged' });
    await tick(); await tick();
    assert.ok(jobStorageKey(r.jobId, 'real') in area.store);
    assert.ok(!(jobStorageKey(r.jobId, 'forged') in area.store));
    assert.equal(area.store[jobStorageKey(r.jobId, 'real')].workspace, 'real');
});

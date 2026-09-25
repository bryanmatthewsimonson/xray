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
// source guards that keep every job pass off the held-open path — #374's
// three and the five of the 2026-09-25 addendum (their consumers are
// driven end to end in tests/llm-job-consumers.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
    createLlmJobRunner, runLlmJob, ackLlmJob, findLlmJob, llmJobScopeKey, llmJobRequestHash,
    isLlmJobKey, jobStorageKey, LLM_JOB_LOST_ERROR, LLM_JOB_PASSES, LLM_JOB_REQUEST_SCOPED, LLM_JOB_TTL_MS,
    LLM_JOB_STATUS_WAIT_MAX_MS, LLM_JOB_KEY_PREFIX, jobElapsedSeconds, jobFailureNote
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
        'lens-read': async () => { invoked += 1; return { ok: true }; }   // present, NOT allowlisted
    });
    for (const bad of [
        { pass: 'lens-read', request: {} },
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
    // The allowlist is a security list: growing it is a deliberate,
    // reviewed edit here AND in the worker's pass table (the table/list
    // set-equality guard below keeps the two from drifting apart).
    assert.deepEqual([...LLM_JOB_PASSES], [
        'corpus-map', 'corpus-reduce', 'entity-page',
        'hypothesis-edges', 'corpus-links', 'forensic-corpus', 'entity-audit', 'audit-run'
    ]);
    for (const pass of LLM_JOB_PASSES) {
        assert.match(pass, /^[a-z-]+$/, `${pass}: a pass name must fit the job-id grammar`);
    }
});

test('llmJobScopeKey clamps each part to the key alphabet, joins with ":", and over the cap shortens the LEADING parts — never the content hash', () => {
    assert.equal(llmJobScopeKey('case 1/x', 'a'.repeat(64)), `case_1_x:${'a'.repeat(64)}`);
    assert.equal(llmJobScopeKey(null, undefined), ':');
    assert.ok(llmJobScopeKey('x'.repeat(500)).length <= 200);
    const h1 = 'c'.repeat(64);
    assert.equal(llmJobScopeKey('a', 'v1', h1), `a:v1:${h1}`, 'under the cap nothing moves');
    // An id that arrived by backup merge is not shape-checked. A plain cut
    // at 200 dropped the hash off the end, so two different requests
    // shared one key and one's kept result answered the other.
    const longId = `entity_${'x'.repeat(300)}`;
    const k1 = llmJobScopeKey(longId, 'claim-links-v1', h1);
    const k2 = llmJobScopeKey(longId, 'claim-links-v1', 'd'.repeat(64));
    assert.equal(k1.length, 200);
    assert.ok(k1.endsWith(`:${h1}`), k1);
    assert.notEqual(k1, k2, 'different requests, different keys, whatever the id length');
    assert.match(k1, /^[A-Za-z0-9:._-]{1,200}$/, 'still inside the runner\'s scope grammar');
    assert.equal(llmJobScopeKey('a', 'z'.repeat(300)), 'z'.repeat(200), 'a last part over the cap alone is clamped, never thrown on');
});

test('llmJobRequestHash: SHA-256 hex of the exact request — any changed byte is a different job; the widest key fits the grammar', async () => {
    const req = { mode: 'single', markdown: 'Body.', metadata: { url: 'https://x.test/a' } };
    const h = await llmJobRequestHash(req);
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(await llmJobRequestHash(JSON.parse(JSON.stringify(req))), h, 'deterministic over the same content');
    assert.notEqual(await llmJobRequestHash({ ...req, markdown: 'Body!' }), h, 'one character is a new job');
    assert.notEqual(await llmJobRequestHash({ ...req, metadata: { url: 'https://x.test/b' } }), h, 'nested fields count');
    // The known answer: sha256 of `null` (an absent request hashes as null).
    assert.equal(await llmJobRequestHash(undefined),
        '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b');
    // The widest scope a consumer builds (two 64-hex parts, the Quick
    // audit's) must survive the runner's grammar un-truncated.
    const scope = llmJobScopeKey('a'.repeat(64), h);
    assert.equal(scope.length, 129);
    const runner = runnerOver(memoryArea(), { 'audit-run': async () => ({ ok: true }) });
    const started = await runner.start({ pass: 'audit-run', request: req, scopeKey: scope });
    assert.equal(started.ok, true);
    assert.equal(started.jobId, `audit-run:${scope}`);
    assert.equal((await runner.status({ jobId: started.jobId, waitMs: 50 })).ok, true, 'the job id is inside JOB_ID_RE');
});

test('RECEIVER-VERIFIED SCOPE: a request-scoped pass refuses a key that does not end in the hash of the request it carries', async () => {
    // The reuse criterion is the key, so the worker checks it rather than
    // trusting it: a kept result is only ever served for the request it
    // answered — never for another request presented under its key.
    assert.deepEqual([...LLM_JOB_REQUEST_SCOPED],
        ['hypothesis-edges', 'corpus-links', 'forensic-corpus', 'entity-audit', 'audit-run'],
        'the 2026-09-25 passes scope by request hash; #374\'s three by fingerprints the worker cannot rebuild');
    for (const p of LLM_JOB_REQUEST_SCOPED) assert.ok(LLM_JOB_PASSES.includes(p), `${p} is not allowlisted`);

    const area = memoryArea();
    const calls = [];
    const passes = Object.fromEntries(LLM_JOB_PASSES.map((p) => [p, async (req) => {
        calls.push([p, req.n]);
        return { ok: true, answered: req.n };
    }]));
    const runner = runnerOver(area, passes);
    const reqA = { n: 'A' };
    const reqB = { n: 'B' };
    const hA = await llmJobRequestHash(reqA);
    const hB = await llmJobRequestHash(reqB);
    const MISMATCH = { ok: false, error: 'LLM job scope key does not match its request' };

    for (const pass of LLM_JOB_REQUEST_SCOPED) {
        const keyA = llmJobScopeKey('case', 'v1', hA);
        const a = await runner.start({ pass, request: reqA, scopeKey: keyA });
        assert.equal(a.ok, true, `${pass}: a key ending in its own request's hash starts`);
        await runner.status({ jobId: a.jobId, waitMs: 50 });
        const before = calls.length;
        for (const scopeKey of [keyA, 'case', hB, `case:${hB}x`, `case:${hB.slice(0, 63)}`, `case:x${hB}`]) {
            assert.deepEqual(await runner.start({ pass, request: reqB, scopeKey }), MISMATCH,
                `${pass} took ${scopeKey} for another request`);
        }
        assert.equal(calls.length, before, 'no pass ran for a refused start');
        const b = await runner.start({ pass, request: reqB, scopeKey: llmJobScopeKey('case', 'v1', hB) });
        assert.equal(b.ok, true);
        assert.equal(b.reused, false, 'B is its own job');
        const b2 = await runner.status({ jobId: b.jobId, waitMs: 50 });
        assert.equal(b2.result.answered, 'B', 'B is answered by a pass that saw B');
        const again = await runner.start({ pass, request: reqA, scopeKey: keyA });
        assert.equal(again.reused, true, 'A\'s kept result still serves A');
    }
    // #374's passes keep page-derived keys (content fingerprints the
    // worker cannot rebuild), and a scope-less start is a one-off job
    // that is never reused — neither carries a request hash.
    for (const pass of LLM_JOB_PASSES.filter((p) => !LLM_JOB_REQUEST_SCOPED.includes(p))) {
        assert.equal((await runner.start({ pass, request: reqB, scopeKey: 'fingerprint:abc' })).ok, true, pass);
    }
    assert.equal((await runner.start({ pass: 'corpus-links', request: reqB })).ok, true);
});

test('jobFailureNote: a LOST job names the re-bill; a lost CHANNEL names the free pickup; anything else adds nothing', () => {
    const lost = { ok: false, jobId: 'audit-run:k', lost: true, swLost: true, timeout: true, error: LLM_JOB_LOST_ERROR };
    assert.equal(jobFailureNote(lost, 'Suggest links…'), ' Suggest links… makes a new call, billed again.');
    // Polls exhausted on a STARTED job: the client's error already says
    // the result is kept — the note only names the control (no echo).
    assert.equal(jobFailureNote({ ok: false, jobId: 'audit-run:k', swLost: true, error: 'lost contact' }, 'Quick audit'),
        ' Quick audit with the same inputs picks it up without a new call.');
    // A dropped START: whether a job began is unknown, and the note says so.
    assert.equal(jobFailureNote({ ok: false, swLost: true, error: 'The message port closed' }, 'Quick audit'),
        ' If the call started, its result is kept: Quick audit with the same inputs picks it up without a new call.');
    assert.equal(jobFailureNote({ ok: false, error: 'LLM assist is off.' }, 'X'), '', 'the worker\'s own refusal explains itself');
    assert.equal(jobFailureNote({ ok: false, timeout: true, error: 'aborted' }, 'X'), '', 'a pass timeout is not a lost job');
    assert.equal(jobFailureNote({ ok: true }, 'X'), '');
    assert.equal(jobFailureNote(null, 'X'), '');
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

test('client: the elapsed counter is anchored to the RECORD\'s start, so a reattached tab does not restart at 0', () => {
    const now = 1_000_000;
    // A status reply carries createdAt (publicView) — that anchors the clock.
    assert.equal(jobElapsedSeconds({ createdAt: now - 95_000 }, now - 2_000, now), 95);
    // No createdAt on the reply → the page's own start.
    assert.equal(jobElapsedSeconds({}, now - 2_000, now), 2);
    assert.equal(jobElapsedSeconds(null, now - 2_000, now), 2);
    // A record from the future (clock skew) never reads as negative.
    assert.equal(jobElapsedSeconds({ createdAt: now + 5_000 }, now, now), 0);
});

// ---- source guards ----

const strip = (x) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// The worker's pass table (background/llm-jobs.js), parsed: name → function.
function passTable() {
    const jobs = strip(read('src/background/llm-jobs.js'));
    const open = jobs.indexOf('passes: {');
    assert.ok(open > 0, 'sanity: the runner is built with a `passes: {` table');
    const body = jobs.slice(open, jobs.indexOf('}', open));
    return Object.fromEntries([...body.matchAll(/'([a-z-]+)':\s*(run\w+Pass)\b/g)].map((m) => [m[1], m[2]]));
}

// Every single-message type an LLM pass rode before it became a job —
// #374's three and the 2026-09-25 addendum's five. Retired for good: the
// worker must not handle them and no page may send them.
const RETIRED_TYPES = Object.freeze([
    'xray:llm:corpus-map', 'xray:llm:corpus-reduce', 'xray:llm:entity-page',
    'xray:llm:hypothesis-edges', 'xray:llm:corpus-links', 'xray:llm:forensic-corpus',
    'xray:llm:entity-audit', 'xray:audit:run'
]);

// The LLM passes that still ride ONE held-open message, each carrying a
// single unit of a larger run. Each is bounded by its own abort, but
// every one of those bounds is longer than MV3's 5-minute request kill
// — so these are EXPOSED, deliberately and by name, not safe. Converting
// one is a pass-table line plus its caller (JOURNAL 2026-09-05). A new
// run*Pass lands in the pass table or here, with a reason — never
// silently as a held-open handler.
const HELD_OPEN_PASSES = Object.freeze({
    runAuditModulePass: 'xray:audit:module — one Thorough-audit module; the reader draft-persists each completed module',
    runLensPass: 'xray:lens:read — one jurisdiction; the lens panel renders per jurisdiction',
    runVisionPass: 'xray:vision:describe — one image',
    runExtractPass: 'xray:llm:extract — one archived PDF (Phase 18 C5)'
});

test('GUARD: the worker\'s pass table IS the allowlist — one function per allowlisted pass, nothing extra either way', () => {
    const table = passTable();
    assert.ok(Object.keys(table).length >= 3, 'sanity: the parser sees the table');
    assert.deepEqual(Object.keys(table).sort(), [...LLM_JOB_PASSES].sort(),
        'a pass allowlisted with no function is refused at start; a function with no allowlist entry is unreachable');
    assert.equal(new Set(Object.values(table)).size, Object.keys(table).length, 'one function per pass');
});

test('GUARD: every run*Pass the LLM client exports is a JOB, or a NAMED held-open exception', () => {
    const exported = [...strip(read('src/shared/llm-client.js')).matchAll(/export async function (run\w+Pass)\s*\(/g)]
        .map((m) => m[1]);
    assert.ok(exported.length >= 8, 'sanity: the scan sees the client\'s passes');
    const jobFns = new Set(Object.values(passTable()));
    for (const fn of exported) {
        const job = jobFns.has(fn);
        const held = Object.hasOwn(HELD_OPEN_PASSES, fn);
        assert.ok(job || held, `${fn} is neither in the pass table nor a named held-open exception — make it a job`);
        assert.ok(!(job && held), `${fn} is a job AND listed as held-open — drop the exception`);
    }
    for (const fn of Object.keys(HELD_OPEN_PASSES)) {
        assert.ok(exported.includes(fn), `HELD_OPEN_PASSES names ${fn}, which the client no longer exports — remove it`);
    }
});

test('GUARD: no job pass rides a held-open message in the service worker', () => {
    // The dispatch chain stays in index.js (the structure guard derives
    // the message registry from it); the runner and its pass table live
    // in background/llm-jobs.js (extracted under the surface ceiling).
    const bg = strip(read('src/background/index.js'));
    const jobs = strip(read('src/background/llm-jobs.js'));
    // The held-open shape: a direct handler awaiting the pass into sendResponse.
    for (const t of RETIRED_TYPES) {
        assert.ok(!bg.includes(`message.type === '${t}'`), `${t} is handled as a single held-open message again`);
    }
    const fns = Object.values(passTable());
    assert.equal(fns.length, LLM_JOB_PASSES.length);
    for (const fn of fns) {
        assert.ok(!bg.includes(fn), `${fn} is referenced from index.js — the chain reaches it only through ./llm-jobs.js`);
        assert.ok(!new RegExp(`${fn}\\(message`).test(jobs), `${fn} is invoked straight from a message handler`);
        assert.ok(!new RegExp(`${fn}\\([^)]*\\)\\s*\\.then\\(\\s*\\(result\\) => sendResponse`).test(jobs),
            `${fn} is awaited into sendResponse`);
        // The ONLY reference outside the import is the runner's pass table.
        const refs = jobs.split(fn).length - 1;
        assert.equal(refs, 2, `${fn} referenced ${refs} times in llm-jobs.js — expected the import + the pass table`);
    }
    for (const op of ['start', 'status', 'find', 'ack']) {
        assert.ok(bg.includes(`message.type === 'xray:llm:job:${op}'`), `xray:llm:job:${op} handler missing`);
        // With its sender: respondLlmJob refuses any sender that is not an
        // extension page (behavior pinned in llm-job-consumers.test.mjs).
        assert.ok(bg.includes(`return respondLlmJob('${op}', message, sendResponse, sender)`),
            `xray:llm:job:${op} does not delegate, with its sender, to background/llm-jobs.js`);
    }
    assert.match(jobs, /createLlmJobRunner\(\{/);
    assert.ok(!bg.includes('createLlmJobRunner'), 'the runner is built in background/llm-jobs.js, never in index.js');
    assert.ok(!/onMessage\.addListener/.test(jobs), 'background/llm-jobs.js must not open a second dispatch chain');
});

function srcFiles() {
    const files = [];
    const walk = (dir) => {
        for (const name of readdirSync(dir)) {
            const p = join(dir, name);
            if (statSync(p).isDirectory()) walk(p);
            else if (p.endsWith('.js') && !p.endsWith('.bundle.js')) files.push(p);
        }
    };
    walk(new URL('../src', import.meta.url).pathname);
    const root = new URL('..', import.meta.url).pathname;
    return files.map((abs) => abs.slice(root.length));
}

// Who drives each pass page-side. Every runLlmJob call site in src must
// be listed here (so it is pinned), and every allowlisted pass must have
// a consumer (so none is dead).
const JOB_CONSUMERS = Object.freeze({
    'src/portal/synthesis-block.js': ['corpus-map', 'corpus-reduce'],
    'src/portal/entity-page-block.js': ['entity-page'],
    'src/shared/article-pass.js': ['corpus-map'],
    'src/shared/entity-page.js': ['corpus-map'],
    'src/portal/links-block.js': ['corpus-links'],
    'src/portal/hypothesis-block.js': ['hypothesis-edges'],
    'src/portal/forensic-corpus-block.js': ['forensic-corpus'],
    'src/sidepanel/entity-audit.js': ['entity-audit'],
    'src/reader/quick-audit.js': ['audit-run']
});
// The 2026-09-25 consumers: content-derived scopes and a record-anchored
// elapsed counter, like the reduce (#374's two surfaces pin the latter below).
// The 2026-09-25 consumers → the prompt-version constant their scope
// carries, so a prompt revision never serves a result the old prompt
// produced (null: the Quick audit's result carries its own per-module
// versions, which the audit panel's staleness check reads).
const ADDENDUM_CONSUMERS = Object.freeze({
    'src/portal/links-block.js': 'CLAIM_LINKS_PROMPT_VERSION',
    'src/portal/hypothesis-block.js': 'HYPOTHESIS_EDGE_PROMPT_VERSION',
    'src/portal/forensic-corpus-block.js': 'FORENSIC_CORPUS_PROMPT_VERSION',
    'src/sidepanel/entity-audit.js': 'ENTITY_AUDIT_PROMPT_VERSION',
    'src/reader/quick-audit.js': null
});

test('GUARD: no page sends a retired single-message type — not as a send, not as any string literal', () => {
    const offenders = [];
    for (const f of srcFiles()) {
        const src = strip(read(f));
        for (const t of RETIRED_TYPES) {
            if (new RegExp(`['"\`]${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`).test(src)) offenders.push(`${f} names ${t}`);
        }
    }
    assert.deepEqual(offenders, []);
});

test('GUARD: every job consumer uses the job client, names an allowlisted pass, and releases its record', () => {
    const callers = srcFiles().filter((f) => f !== 'src/shared/llm-jobs.js' && /\brunLlmJob\(\{/.test(strip(read(f))));
    assert.ok(callers.length >= 4, 'sanity: the scan sees runLlmJob call sites');
    assert.deepEqual(callers.sort(), Object.keys(JOB_CONSUMERS).sort(),
        'a runLlmJob call site is not listed in JOB_CONSUMERS (or a listed one stopped using the client)');
    const driven = new Set();
    for (const [rel, passes] of Object.entries(JOB_CONSUMERS)) {
        const src = strip(read(rel));
        assert.match(src, /\brunLlmJob\(\{/, `${rel} does not use the job client`);
        assert.match(src, /\backLlmJob\(/, `${rel} never releases its job record`);
        const named = [...src.matchAll(/\bpass:\s*'([^']+)'/g)].map((m) => m[1]);
        for (const p of named) assert.ok(LLM_JOB_PASSES.includes(p), `${rel} starts '${p}', which the worker refuses`);
        for (const p of passes) {
            assert.ok(named.includes(p), `${rel} does not start '${p}'`);
            driven.add(p);
        }
    }
    assert.deepEqual([...driven].sort(), [...LLM_JOB_PASSES].sort(), 'an allowlisted pass has no page-side consumer');
});

test('GUARD: the 2026-09-25 consumers scope by CONTENT (id + prompt version + request hash) and time from the record', () => {
    assert.equal(Object.keys(ADDENDUM_CONSUMERS).length, LLM_JOB_REQUEST_SCOPED.length, 'one consumer per request-scoped pass');
    for (const [rel, version] of Object.entries(ADDENDUM_CONSUMERS)) {
        const src = strip(read(rel));
        const scope = src.match(/scopeKey:\s*llmJobScopeKey\(([^;]*?)await llmJobRequestHash\(request\)\)/);
        assert.ok(scope, `${rel}: the scope must end in the hash of the request it sends — the worker refuses any other key`);
        if (version) {
            assert.ok(new RegExp(`\\b${version}\\b`).test(scope[1]),
                `${rel}: the scope does not carry ${version} — a revised prompt would be served the old prompt's result`);
        }
        assert.match(src, /jobElapsedSeconds\(st,/, `${rel} times the job from a page-local clock`);
        assert.match(src, /jobFailureNote\(/, `${rel} fails without saying what a retry costs`);
    }
});

test('GUARD: the reader never reads ingestAuditResult as a boolean (it is tri-state, and \'failed\' is truthy), and only the import decides it', () => {
    // A truthiness read on the Thorough path would clear the resumable
    // module draft after a FAILED import — paid modules, gone.
    const src = strip(read('src/reader/index.js'));
    const sites = src.split('\n').filter((l) => /\bingestAuditResult\(/.test(l) && !/async function ingestAuditResult\(/.test(l));
    assert.equal(sites.length, 2, `sanity: the Quick and Thorough call sites (${sites.length} found)`);
    for (const l of sites) {
        assert.ok(/\)\) === INGEST_IMPORTED\b/.test(l) || /\bingest: \(audit, model\) => ingestAuditResult\(/.test(l),
            `a boolean read of ingestAuditResult: ${l.trim()}`);
    }
    // And the outcome is the IMPORT's alone: a panel repaint that throws
    // after a successful import must not report it failed — the kept job
    // record would be imported a second time on the next Quick audit.
    const fn = src.slice(src.indexOf('async function ingestAuditResult('));
    const classified = fn.slice(fn.indexOf('try {'), fn.indexOf('} catch (err) {'));
    assert.ok(classified.includes('importAuditJson('), 'sanity: the import is the classified call');
    assert.ok(!classified.includes('refreshAuditStatus('), 'the audit-panel repaint sits inside the import classification');
});

test('GUARD: #374\'s long-poll surfaces time the job from the record', () => {
    // The two long-poll surfaces show elapsed time — anchored to the
    // record, never a page-local clock (a reload restarted it at 0).
    for (const rel of ['src/portal/synthesis-block.js', 'src/portal/entity-page-block.js']) {
        assert.match(strip(read(rel)), /jobElapsedSeconds\(st,/, `${rel} times the job from a page-local clock`);
    }
});

test('GUARD: every portal/side-panel job consumer flags a dropped channel (lastError) as swLost, not as the worker\'s refusal', () => {
    // runLlmJob retries a poll only when the transport says the channel
    // DROPPED (`!resp || resp.swLost`). A helper that turns lastError
    // into a bare {ok:false} makes the first dropped poll abandon a live,
    // paid job (the pre-job forensic helper did exactly that).
    const pages = Object.keys(JOB_CONSUMERS).filter((f) => f.startsWith('src/portal/') || f.startsWith('src/sidepanel/'));
    assert.ok(pages.length >= 5, 'sanity');
    for (const rel of pages) {
        const helper = strip(read(rel)).match(/function (?:sendMessage|sendRuntimeMessage)\(msg\)\s*\{[\s\S]*?\n\}/);
        assert.ok(helper, `${rel}: no chrome.runtime sendMessage helper found`);
        assert.match(helper[0], /chrome\.runtime\.lastError/, `${rel}: the helper never reads chrome.runtime.lastError`);
        // Either drop signal the client accepts: `swLost: true`, or an empty resolve.
        assert.ok(/swLost:\s*true/.test(helper[0]) || /lastError\)\s*\{\s*resolve\((?:null|undefined)\)/.test(helper[0]),
            `${rel}: lastError resolves as the worker's refusal, not as a dropped channel`);
    }
});

test('GUARD (copy): the synthesis failure names the stage that re-runs and that the reduce re-bills', () => {
    const src = read('src/portal/synthesis-block.js');
    assert.ok(!src.includes('make the retry cheap'), 'the misleading "retry cheap" copy is back');
    assert.match(src, /re-runs only the synthesis stage/);
    assert.match(src, /billed again/);
    // A failure with an older brief still on screen says whose brief it is.
    assert.match(src, /from the previous run and is unchanged/);
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

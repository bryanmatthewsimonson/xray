// confirmed-publish.js tests — Phase 25.5 (KS.7 confirmed-OK).
// Stubbed publish matrices: confirmed / assumed-only / zero-success,
// retry behavior, and the IDENTITY_KINDS pin.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const _store = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) { const o = {}; for (const k of (Array.isArray(keys) ? keys : [keys])) if (_store.has(k)) o[k] = _store.get(k); cb(o); },
            set(obj, cb) { for (const [k, v] of Object.entries(obj)) _store.set(k, v); cb && cb(); },
            remove(keys, cb) { for (const k of (Array.isArray(keys) ? keys : [keys])) _store.delete(k); cb && cb(); }
        }
    }
};

const { publishConfirmed, IDENTITY_KINDS } = await import('../src/shared/confirmed-publish.js');

const RELAYS = ['wss://a.example', 'wss://b.example'];
const EVENT = { id: '1'.repeat(64), pubkey: '2'.repeat(64), sig: 's', kind: 0 };

function resultOf({ confirmed, successful }) {
    return { successful, confirmed, failed: RELAYS.length - successful, total: RELAYS.length, results: [] };
}

test('IDENTITY_KINDS is pinned exactly', () => {
    assert.deepEqual([...IDENTITY_KINDS], [0, 3, 10002, 30069, 32125, 32126]);
});

test('confirmed on the first attempt: ok, no retry', async () => {
    let calls = 0;
    const publish = async () => { calls++; return resultOf({ confirmed: 1, successful: 2 }); };
    const out = await publishConfirmed(RELAYS, EVENT, { publish, retries: 2, delayMs: 0 });
    assert.equal(out.ok, true);
    assert.equal(out.attempts, 1);
    assert.equal(calls, 1);
});

test('assumed-only first attempt retries and succeeds on confirmation', async () => {
    let calls = 0;
    const publish = async () => {
        calls++;
        return calls === 1 ? resultOf({ confirmed: 0, successful: 2 }) : resultOf({ confirmed: 2, successful: 2 });
    };
    const out = await publishConfirmed(RELAYS, EVENT, { publish, retries: 1, delayMs: 0 });
    assert.equal(out.ok, true);
    assert.equal(out.attempts, 2);
});

test('never confirmed: ok=false after first + retries attempts, result kept', async () => {
    let calls = 0;
    const publish = async () => { calls++; return resultOf({ confirmed: 0, successful: 1 }); };
    const out = await publishConfirmed(RELAYS, EVENT, { publish, retries: 2, delayMs: 0 });
    assert.equal(out.ok, false);
    assert.equal(out.attempts, 3);
    assert.equal(calls, 3);
    assert.equal(out.result.successful, 1);   // callers still see the last round
});

test('zero successes also retries (a dead round is not a confirmation)', async () => {
    let calls = 0;
    const publish = async () => { calls++; return resultOf({ confirmed: 0, successful: 0 }); };
    const out = await publishConfirmed(RELAYS, EVENT, { publish, retries: 1, delayMs: 0 });
    assert.equal(out.ok, false);
    assert.equal(calls, 2);
});

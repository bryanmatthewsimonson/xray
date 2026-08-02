// The publish gate (publish-gate.js, Phase 29.1 — EVENT_STORE_DESIGN
// §3.2). Load-bearing pins:
//   - storeFirstPublish defaults OFF, and flag-off is byte-for-byte
//     today's behavior: attempt first; journal ONLY when the site
//     journaled on success before 29.1 (legacyJournalOnSuccess), and
//     NEVER on a zero-success round (the pre-29.1 defect, preserved
//     until the flag flips).
//   - Flag ON: journal FIRST (a 'pending' row exists before the
//     transport runs), then the inline attempt, then the snapshot. A
//     zero-success attempt leaves the pending row — the signature is
//     never lost — and even a transport THROW leaves it.
//   - The ledger-marking rule is untouched: `confirmedOk` counts
//     CONFIRMED (non-assumed) OKs only.

import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('fake-indexeddb/auto');

// chrome.storage stub — the flags module reads `xray:flags` from it.
const _store = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
                const out = {};
                for (const k of Array.isArray(keys) ? keys : [keys]) {
                    if (_store.has(k)) out[k] = _store.get(k);
                }
                cb(out);
            },
            set(obj, cb) {
                for (const [k, v] of Object.entries(obj)) _store.set(k, v);
                cb && cb();
            },
            remove(keys, cb) {
                for (const k of Array.isArray(keys) ? keys : [keys]) _store.delete(k);
                cb && cb();
            }
        }
    }
};

const { gatePublish, confirmedCount } = await import('../src/shared/publish-gate.js');
const { countAll, getByEventId, listAll, clear } = await import('../src/shared/event-journal.js');
const { FLAGS_DEFAULTS } = await import('../src/shared/metadata/feature-flags.js');

const setFlag = (on) => _store.set('xray:flags', JSON.stringify({ storeFirstPublish: on }));

function signedEvent(over = {}) {
    return {
        id: 'e'.repeat(64), sig: 's'.repeat(128),
        kind: 30040, pubkey: 'p'.repeat(64), created_at: 1700000000,
        tags: [['d', 'claim_1']], content: 'c',
        ...over
    };
}

const RELAYS = ['wss://a.example', 'wss://b.example'];

const ZERO_SUCCESS = {
    successful: 0, confirmed: 0, failed: 2, total: 2,
    results: [
        { url: 'wss://a.example', success: false, assumed: false, error: 'down' },
        { url: 'wss://b.example', success: false, assumed: false, error: 'down' }
    ]
};
const ASSUMED_ONLY = {
    successful: 1, confirmed: 0, failed: 1, total: 2,
    results: [
        { url: 'wss://a.example', success: true, assumed: true },
        { url: 'wss://b.example', success: false, assumed: false, error: 'down' }
    ]
};
const CONFIRMED = {
    successful: 2, confirmed: 1, failed: 0, total: 2,
    results: [
        { url: 'wss://a.example', success: true, assumed: false },
        { url: 'wss://b.example', success: true, assumed: true }
    ]
};

// A transport spy that records its calls AND the journal state at
// call time — the journal-first ordering probe.
function spyTransport(result, { throws = false } = {}) {
    const calls = [];
    const fn = async (relays, event) => {
        calls.push({ relays, event, journalCountAtCall: await countAll() });
        if (throws) throw new Error('transport down');
        return result;
    };
    return { fn, calls };
}

test.beforeEach(async () => { await clear(); _store.delete('xray:flags'); });

test('storeFirstPublish defaults OFF (the §9 flag table)', () => {
    assert.equal(FLAGS_DEFAULTS.storeFirstPublish, false);
});

test('confirmedCount: confirmed field wins; falls back to counting non-assumed successes', () => {
    assert.equal(confirmedCount(CONFIRMED), 1);
    assert.equal(confirmedCount({ results: CONFIRMED.results }), 1);
    assert.equal(confirmedCount(ASSUMED_ONLY), 0);
    assert.equal(confirmedCount(null), 0);
});

test('gatePublish refuses unsigned events and missing transports', async () => {
    await assert.rejects(() => gatePublish({ signedEvent: { id: 'x'.repeat(64) }, relays: RELAYS, publish: async () => CONFIRMED }),
        /SIGNED event/);
    await assert.rejects(() => gatePublish({ signedEvent: signedEvent(), relays: RELAYS }),
        /transport/);
});

// ------------------------------------------------------------------
// Flag OFF — legacy equivalence
// ------------------------------------------------------------------

test('flag OFF: attempt-first, and a zero-success round journals NOTHING even for legacy-journaling sites', async () => {
    const { fn, calls } = spyTransport(ZERO_SUCCESS);
    const out = await gatePublish({
        signedEvent: signedEvent(), relays: RELAYS, publish: fn,
        ledger: { model: 'claim', localId: 'c1' }, legacyJournalOnSuccess: true
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].relays, RELAYS);
    assert.equal(out.results, ZERO_SUCCESS);
    assert.equal(out.confirmedOk, false);
    assert.equal(out.journaled, false);
    assert.equal(await countAll(), 0,
        'the pre-29.1 signature-loss defect is PRESERVED flag-off — flag-off must be indistinguishable from main');
});

test('flag OFF + legacyJournalOnSuccess:false: no journal write even on success (the sites that never journaled)', async () => {
    const { fn } = spyTransport(CONFIRMED);
    const out = await gatePublish({
        signedEvent: signedEvent(), relays: RELAYS, publish: fn,
        legacyJournalOnSuccess: false
    });
    assert.equal(out.confirmedOk, true);
    assert.equal(out.journaled, false);
    assert.equal(await countAll(), 0);
});

test('flag OFF + legacyJournalOnSuccess:true: successful>0 journals via the legacy path, AFTER the attempt', async () => {
    const { fn, calls } = spyTransport(ASSUMED_ONLY);
    const out = await gatePublish({
        signedEvent: signedEvent(), relays: RELAYS, publish: fn,
        articleUrl: 'https://example.com/a', legacyJournalOnSuccess: true
    });
    assert.equal(calls[0].journalCountAtCall, 0, 'attempt FIRST — nothing journaled before the transport ran');
    assert.equal(out.journaled, true);
    assert.equal(out.confirmedOk, false, 'assumed-only is not confirmation (JOURNAL 2026-07-10)');
    const row = await getByEventId('e'.repeat(64));
    assert.equal(row.articleUrl, 'https://example.com/a');
    assert.equal(row.flush.state, 'pending', 'the v2 fields are coherent even on the legacy path');
    assert.equal(row.ledger, null, 'the legacy path never wrote ledger descriptors — parity kept');
});

// ------------------------------------------------------------------
// Flag ON — store-first
// ------------------------------------------------------------------

test('flag ON: journal FIRST — the pending row exists before the transport runs', async () => {
    setFlag(true);
    const { fn, calls } = spyTransport(CONFIRMED);
    const ev = signedEvent();
    const out = await gatePublish({
        signedEvent: ev, relays: RELAYS, publish: fn,
        ledger: { model: 'claim', localId: 'claim_1', extra: null },
        articleUrl: 'https://example.com/a'
    });
    assert.equal(calls[0].journalCountAtCall, 1, 'signed ⇒ durable BEFORE any relay send (§3.2)');
    assert.equal(out.confirmedOk, true);
    assert.equal(out.journaled, true);
    const row = await getByEventId(ev.id);
    assert.equal(row.flush.state, 'flushed', 'the confirmed OK flushed the row');
    assert.equal(row.flush.attempts, 1);
    assert.deepEqual(row.ledger, { model: 'claim', localId: 'claim_1', extra: null, markedAt: null });
    assert.equal(row.articleUrl, 'https://example.com/a');
});

test('flag ON: a ZERO-SUCCESS attempt leaves the pending row — the signature is never lost (§1.1)', async () => {
    setFlag(true);
    const { fn } = spyTransport(ZERO_SUCCESS);
    const ev = signedEvent();
    const out = await gatePublish({ signedEvent: ev, relays: RELAYS, publish: fn });
    assert.equal(out.confirmedOk, false);
    const row = await getByEventId(ev.id);
    assert.equal(row.flush.state, 'pending');
    assert.equal(row.flush.attempts, 1);
    assert.ok(row.flush.nextAttemptAt > Math.floor(Date.now() / 1000), 'scheduled for the 29.2 flusher');
    assert.equal(row.relays.length, 2, 'the failed attempt snapshot is recorded');
    assert.deepEqual(row.event, ev, 'verbatim — rebroadcastable with no re-sign');
});

test('flag ON: assumed-only stays pending and confirmedOk stays false', async () => {
    setFlag(true);
    const { fn } = spyTransport(ASSUMED_ONLY);
    const ev = signedEvent();
    const out = await gatePublish({ signedEvent: ev, relays: RELAYS, publish: fn });
    assert.equal(out.confirmedOk, false);
    assert.equal((await getByEventId(ev.id)).flush.state, 'pending');
});

test('flag ON: a transport THROW still leaves the pending row, and rethrows for the caller', async () => {
    setFlag(true);
    const { fn } = spyTransport(null, { throws: true });
    const ev = signedEvent();
    await assert.rejects(
        () => gatePublish({ signedEvent: ev, relays: RELAYS, publish: fn }),
        /transport down/);
    const row = await getByEventId(ev.id);
    assert.equal(row.flush.state, 'pending', 'sign-time durability survives the error path');
    assert.equal(row.flush.attempts, 0, 'no attempt snapshot — the transport never answered');
});

test('flag ON: legacyJournalOnSuccess is irrelevant — no recordPublished double-write', async () => {
    setFlag(true);
    const { fn } = spyTransport(CONFIRMED);
    const ev = signedEvent();
    await gatePublish({
        signedEvent: ev, relays: RELAYS, publish: fn, legacyJournalOnSuccess: true
    });
    assert.equal(await countAll(), 1, 'one row, written by the store-first path');
    const rows = await listAll();
    assert.equal(rows[0].flush.attempts, 1, 'one attempt — recordPublished did not also run');
});

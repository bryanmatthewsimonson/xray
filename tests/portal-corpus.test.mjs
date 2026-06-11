// portal/corpus.js tests — Phase 12.1 (docs/PORTAL_DESIGN.md).
//
// The corpus fetcher is wire-adjacent (it speaks `xray:relay:query` to
// the background pool), so its contract is pinned against a scripted
// chrome.runtime.sendMessage shim: per-relay addressing for provenance,
// empty-page (not short-page) pagination, entity-author chunking, and
// failed relays degrading to an error entry instead of sinking the run.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Scripted relay backend: each test installs a handler that receives
// (relayUrl, filter) and returns the events for that page.
let scriptedHandler = null;
const sentMessages = [];

globalThis.chrome = {
    storage: {
        local: {
            get(_k, cb) { cb({}); },
            set(_o, cb) { cb && cb(); },
            remove(_k, cb) { cb && cb(); }
        }
    },
    runtime: {
        sendMessage(message, cb) {
            sentMessages.push(message);
            const relay = message.relays && message.relays[0];
            try {
                const result = scriptedHandler(relay, message.filter);
                if (result && result.error) { cb({ ok: false, error: result.error }); return; }
                cb({ ok: true, events: result, byRelay: { [relay]: { received: result.length, eose: true } } });
            } catch (err) {
                cb({ ok: false, error: err.message });
            }
        }
    }
};

const { fetchCorpus, CONTENT_KINDS, FALLBACK_RELAYS } = await import('../src/portal/corpus.js');

const PK = 'a'.repeat(64);
const RELAY_A = 'wss://relay-a.example';
const RELAY_B = 'wss://relay-b.example';

function ev(id, createdAt, kind = 30040) {
    return { id, kind, pubkey: PK, created_at: createdAt, tags: [['d', id]], content: '' };
}

function reset(handler) {
    scriptedHandler = handler;
    sentMessages.length = 0;
}

test('CONTENT_KINDS pins the full corpus kind list from the design note', () => {
    assert.deepEqual([...CONTENT_KINDS].sort((a, b) => a - b), [
        1985, 9803, 10002, 30023, 30040, 30041, 30050, 30051, 30052,
        30053, 30054, 30055, 30078, 32125, 32126
    ]);
});

test('FALLBACK_RELAYS mirrors the background hardcoded trio', () => {
    assert.deepEqual(FALLBACK_RELAYS,
        ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band']);
});

test('per-relay provenance: shared events accumulate both relays', async () => {
    reset((relay, filter) => {
        if (filter.until !== undefined) return []; // second page: empty everywhere
        if (relay === RELAY_A) return [ev('e1', 100), ev('e2', 90)];
        if (relay === RELAY_B) return [ev('e2', 90), ev('e3', 80)];
        return [];
    });
    const { records, relayErrors } = await fetchCorpus({
        pubkeys: [PK], entityPubkeys: [], relays: [RELAY_A, RELAY_B]
    });
    assert.deepEqual(relayErrors, {});
    const byId = new Map(records.map((r) => [r.event.id, r.relays.sort()]));
    assert.deepEqual(byId.get('e1'), [RELAY_A]);
    assert.deepEqual(byId.get('e2'), [RELAY_A, RELAY_B]);
    assert.deepEqual(byId.get('e3'), [RELAY_B]);
});

test('pagination stops on an EMPTY page, not a short one, and pages with until = oldest - 1', async () => {
    const pagesServed = [];
    reset((_relay, filter) => {
        pagesServed.push(filter.until);
        if (filter.until === undefined) return [ev('p1', 100), ev('p2', 90)];   // short page (relay cap)
        if (filter.until === 89) return [ev('p3', 50)];                          // older events still there
        if (filter.until === 49) return [];                                      // genuinely dry
        throw new Error(`unexpected until ${filter.until}`);
    });
    const { records } = await fetchCorpus({ pubkeys: [PK], entityPubkeys: [], relays: [RELAY_A] });
    assert.deepEqual(pagesServed, [undefined, 89, 49]);
    assert.equal(records.length, 3);
});

test('Q1 filter carries authors + the full kind list + a limit', async () => {
    reset(() => []);
    await fetchCorpus({ pubkeys: [PK], entityPubkeys: [], relays: [RELAY_A] });
    assert.equal(sentMessages.length, 1);
    const { type, filter, relays, timeoutMs } = sentMessages[0];
    assert.equal(type, 'xray:relay:query');
    assert.deepEqual(relays, [RELAY_A]);
    assert.deepEqual(filter.authors, [PK]);
    assert.deepEqual(filter.kinds, CONTENT_KINDS);
    assert.ok(filter.limit > 0);
    assert.ok(timeoutMs > 0);
});

test('Q2 chunks entity authors at 100 per kind-0 query, separate from Q1', async () => {
    reset(() => []);
    const entityPubkeys = Array.from({ length: 250 }, (_, i) =>
        i.toString(16).padStart(64, '0'));
    await fetchCorpus({ pubkeys: [PK], entityPubkeys, relays: [RELAY_A] });
    const q2 = sentMessages.filter((m) => m.filter.kinds.length === 1 && m.filter.kinds[0] === 0);
    assert.deepEqual(q2.map((m) => m.filter.authors.length), [100, 100, 50]);
    // entity queries never ride in the Q1 authors list
    const q1 = sentMessages.find((m) => m.filter.kinds.length > 1);
    assert.deepEqual(q1.filter.authors, [PK]);
});

test('a failing relay lands in relayErrors; the healthy relay still delivers', async () => {
    reset((relay, filter) => {
        if (relay === RELAY_A) return { error: 'connection refused' };
        return filter.until === undefined ? [ev('ok1', 10)] : [];
    });
    const { records, relayErrors } = await fetchCorpus({
        pubkeys: [PK], entityPubkeys: [], relays: [RELAY_A, RELAY_B]
    });
    assert.deepEqual(Object.keys(relayErrors), [RELAY_A]);
    assert.match(relayErrors[RELAY_A], /connection refused/);
    assert.equal(records.length, 1);
    assert.deepEqual(records[0].relays, [RELAY_B]);
});

test('no pubkeys and no entities sends nothing', async () => {
    reset(() => { throw new Error('should not be called'); });
    const { records } = await fetchCorpus({ pubkeys: [], entityPubkeys: [], relays: [RELAY_A] });
    assert.equal(sentMessages.length, 0);
    assert.deepEqual(records, []);
});

test('onProgress ticks with a running fetched count', async () => {
    reset((_relay, filter) => (filter.until === undefined ? [ev('x', 5)] : []));
    const ticks = [];
    await fetchCorpus({
        pubkeys: [PK], entityPubkeys: [], relays: [RELAY_A],
        onProgress: (p) => ticks.push(p.fetched)
    });
    assert.deepEqual(ticks, [1]);
});

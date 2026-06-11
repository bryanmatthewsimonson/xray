// portal/portal-cache.js tests — Phase 12.3 (docs/PORTAL_DESIGN.md).
//
// fake-indexeddb gives us a real-enough IDB in Node (same harness as
// archive-cache.test.mjs). The load-bearing behavior is write-time
// supersession: the store only ever holds the newest version per
// replaceable address, so readers never re-dedupe.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Install fake-indexeddb BEFORE the cache module is imported so the
// module's `globalThis.indexedDB` lookup lands on the fake.
await import('fake-indexeddb/auto');

const {
    openPortalDb, saveRecords, loadRecords, countEvents,
    getMeta, setMeta, clearAll
} = await import('../src/portal/portal-cache.js');

const PK = 'a'.repeat(64);
const NOW = 1_750_000_000;

function rec(id, kind, createdAt, { d, relays = ['wss://relay-a.example'] } = {}) {
    return {
        event: {
            id, kind, pubkey: PK, created_at: createdAt,
            tags: d !== undefined ? [['d', d]] : [],
            content: ''
        },
        relays
    };
}

// Wipe through the API on the live connection (the archive-cache test
// pattern) — deleteDatabase would block forever behind the module's
// open handle.
async function resetStore() {
    await clearAll();
}

test('save + load round-trips events and relay sets', async () => {
    await resetStore();
    const stats = await saveRecords([
        rec('e1', 30040, 100, { d: 'claim_x' }),
        rec('e2', 1985, 90, { relays: ['wss://relay-b.example'] })
    ], { now: NOW });
    assert.deepEqual(stats, { added: 2, updated: 0, superseded: 0, skippedStale: 0 });

    const records = await loadRecords();
    assert.equal(records.length, 2);
    const e1 = records.find((r) => r.event.id === 'e1');
    assert.equal(e1.event.kind, 30040);
    assert.deepEqual(e1.relays, ['wss://relay-a.example']);
    assert.equal(await countEvents(), 2);
});

test('same event id from another relay merges the relay sets', async () => {
    await resetStore();
    await saveRecords([rec('e1', 30040, 100, { d: 'claim_x' })], { now: NOW });
    const stats = await saveRecords(
        [rec('e1', 30040, 100, { d: 'claim_x', relays: ['wss://relay-b.example'] })],
        { now: NOW + 10 });
    assert.equal(stats.updated, 1);
    const [record] = await loadRecords();
    assert.deepEqual(record.relays.sort(),
        ['wss://relay-a.example', 'wss://relay-b.example']);
    assert.equal(await countEvents(), 1);
});

test('addressable: newer version supersedes, older incoming is skipped', async () => {
    await resetStore();
    await saveRecords([rec('old', 30040, 100, { d: 'claim_x' })], { now: NOW });

    const newerIn = await saveRecords([rec('new', 30040, 200, { d: 'claim_x' })], { now: NOW });
    assert.equal(newerIn.superseded, 1);
    assert.equal(newerIn.added, 1);
    let records = await loadRecords();
    assert.deepEqual(records.map((r) => r.event.id), ['new']);

    const staleIn = await saveRecords([rec('stale', 30040, 50, { d: 'claim_x' })], { now: NOW });
    assert.equal(staleIn.skippedStale, 1);
    records = await loadRecords();
    assert.deepEqual(records.map((r) => r.event.id), ['new']);
});

test('replaceable kind 0 collapses per (kind, pubkey) — no d tag involved', async () => {
    await resetStore();
    await saveRecords([rec('p1', 0, 100)], { now: NOW });
    await saveRecords([rec('p2', 0, 200)], { now: NOW });
    const records = await loadRecords();
    assert.deepEqual(records.map((r) => r.event.id), ['p2']);
});

test('regular kinds never supersede each other', async () => {
    await resetStore();
    await saveRecords([rec('l1', 1985, 100), rec('l2', 1985, 200)], { now: NOW });
    assert.equal(await countEvents(), 2);
});

test('equal created_at at the same address keeps the cached version', async () => {
    await resetStore();
    await saveRecords([rec('first', 30040, 100, { d: 'claim_x' })], { now: NOW });
    const stats = await saveRecords([rec('second', 30040, 100, { d: 'claim_x' })], { now: NOW });
    assert.equal(stats.skippedStale, 1);
    const records = await loadRecords();
    assert.deepEqual(records.map((r) => r.event.id), ['first']);
});

test('meta: get/set round-trip, missing key is null', async () => {
    await resetStore();
    assert.equal(await getMeta('sync'), null);
    await setMeta('sync', { lastSyncAt: NOW });
    assert.deepEqual(await getMeta('sync'), { lastSyncAt: NOW });
    await setMeta('sync', { lastSyncAt: NOW + 5 });
    assert.deepEqual(await getMeta('sync'), { lastSyncAt: NOW + 5 });
});

test('clearAll wipes events and meta — the Resync path', async () => {
    await resetStore();
    await saveRecords([rec('e1', 30040, 100, { d: 'claim_x' })], { now: NOW });
    await setMeta('sync', { lastSyncAt: NOW });
    await clearAll();
    assert.equal(await countEvents(), 0);
    assert.equal(await getMeta('sync'), null);
    assert.deepEqual(await loadRecords(), []);
});

test('malformed records are ignored, not fatal', async () => {
    await resetStore();
    const stats = await saveRecords([null, {}, { event: { kind: 1 } },
        rec('ok', 30040, 100, { d: 'claim_x' })], { now: NOW });
    assert.equal(stats.added, 1);
    assert.equal(await countEvents(), 1);
});

test('openPortalDb is memoized and reusable across calls', async () => {
    await resetStore();
    const a = await openPortalDb();
    const b = await openPortalDb();
    assert.equal(a, b);
});

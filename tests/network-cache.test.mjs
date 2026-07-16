// network/network-cache.js tests — Phase 25.2b. Same fake-indexeddb
// harness as portal-cache. Load-bearing behavior: write-time
// replaceable supersession, firstSeenAt bookkeeping (the awareness
// strip is firstSeenAt > lastLookedAt), and the profile meta rows.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Install fake-indexeddb BEFORE the cache module is imported so the
// module's `globalThis.indexedDB` lookup lands on the fake.
await import('fake-indexeddb/auto');

const {
    saveRecords, loadRecords, countEvents,
    getMeta, setMeta, getProfile, setProfile, clearAll, LAST_LOOKED_KEY
} = await import('../src/network/network-cache.js');

const PK = 'f'.repeat(64);

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

test('saveRecords + loadRecords round-trip with firstSeenAt', async () => {
    await clearAll();
    const stats = await saveRecords([rec('1'.repeat(64), 30023, 100, { d: 'a1' })], { now: 555 });
    assert.equal(stats.added, 1);
    const rows = await loadRecords();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event.id, '1'.repeat(64));
    assert.equal(rows[0].firstSeenAt, 555);
});

test('same id re-save merges relays and keeps firstSeenAt', async () => {
    await clearAll();
    await saveRecords([rec('2'.repeat(64), 30023, 100, { d: 'a2' })], { now: 100 });
    const stats = await saveRecords([rec('2'.repeat(64), 30023, 100, { d: 'a2', relays: ['wss://relay-b.example'] })], { now: 200 });
    assert.equal(stats.updated, 1);
    const [row] = await loadRecords();
    assert.deepEqual(row.relays.sort(), ['wss://relay-a.example', 'wss://relay-b.example']);
    assert.equal(row.firstSeenAt, 100);
});

test('replaceable supersession: newer replaces, stale skipped', async () => {
    await clearAll();
    await saveRecords([rec('3'.repeat(64), 30023, 100, { d: 'a3' })], { now: 1 });
    const newer = await saveRecords([rec('4'.repeat(64), 30023, 200, { d: 'a3' })], { now: 2 });
    assert.equal(newer.superseded, 1);
    assert.equal(newer.added, 1);
    const stale = await saveRecords([rec('5'.repeat(64), 30023, 150, { d: 'a3' })], { now: 3 });
    assert.equal(stale.skippedStale, 1);
    assert.equal(await countEvents(), 1);
    const [row] = await loadRecords();
    assert.equal(row.event.id, '4'.repeat(64));
});

test('meta cursor round-trips (the awareness substrate)', async () => {
    await clearAll();
    assert.equal(await getMeta(LAST_LOOKED_KEY), null);
    await setMeta(LAST_LOOKED_KEY, 1234);
    assert.equal(await getMeta(LAST_LOOKED_KEY), 1234);
});

test('profile rows round-trip and lowercase the key', async () => {
    await clearAll();
    await setProfile(PK.toUpperCase(), { name: 'Alice', updatedAt: 9 });
    const p = await getProfile(PK);
    assert.equal(p.name, 'Alice');
});

test('clearAll wipes events AND meta', async () => {
    await saveRecords([rec('6'.repeat(64), 30040, 10, { d: 'c1' })]);
    await setMeta(LAST_LOOKED_KEY, 7);
    await clearAll();
    assert.equal(await countEvents(), 0);
    assert.equal(await getMeta(LAST_LOOKED_KEY), null);
});

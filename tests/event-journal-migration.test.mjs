// Journal v1 → v2 migration (event-journal.js, EVENT_STORE_DESIGN
// §3.1): seed a REAL v1 database, then let the module open it at v2
// and assert the data pass — flush states derived from the stored
// relay snapshots (confirmed → 'flushed'; assumed-only → 'pending' so
// the retry promise survives 29.1's removal of the re-sign path),
// signedAt backfilled from publishedAt, pending rows deferred (no
// first-wake flood), ledger null, and EVERY address recomputed under
// replaceableKey — including the kind-0/3/10002 rows whose v1 address
// was null.

import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('fake-indexeddb/auto');

const P = 'p'.repeat(64);
const ID_CONFIRMED = 'a1'.padEnd(64, '0');
const ID_ASSUMED   = 'b1'.padEnd(64, '0');
const ID_KIND0     = 'c1'.padEnd(64, '0');
const ID_DLESS     = 'd1'.padEnd(64, '0');
const ID_EMPTYD    = 'f1'.padEnd(64, '0');

function ev(over = {}) {
    return {
        id: 'e'.repeat(64), sig: 's'.repeat(128),
        kind: 30023, pubkey: P, created_at: 1700000000,
        tags: [['d', 'article-1']], content: 'x',
        ...over
    };
}

// The v1 shape, byte-for-byte what pre-29.1 recordPublished wrote.
function v1Row(event, { publishedAt, relays, address }) {
    return {
        eventId: event.id, kind: event.kind, pubkey: event.pubkey,
        address, createdAt: event.created_at, event,
        publishedAt, relays, articleUrl: null
    };
}

const CONFIRMED_RELAYS = [
    { url: 'wss://a.example', success: true, assumed: false },
    { url: 'wss://b.example', success: false, assumed: false }
];
const ASSUMED_RELAYS = [
    { url: 'wss://a.example', success: true, assumed: true }
];

// Seed the v1 database EXACTLY as v1 code would have created it —
// schema (store + four indexes) and rows — before the module ever
// opens it.
await new Promise((resolve, reject) => {
    const open = indexedDB.open('xray-events', 1);
    open.onupgradeneeded = () => {
        const store = open.result.createObjectStore('published_events', { keyPath: 'eventId' });
        store.createIndex('kind', 'kind', { unique: false });
        store.createIndex('address', 'address', { unique: false });
        store.createIndex('articleUrl', 'articleUrl', { unique: false });
        store.createIndex('publishedAt', 'publishedAt', { unique: false });
    };
    open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('published_events', 'readwrite');
        const store = tx.objectStore('published_events');
        // 1. Addressable with a d-tag, one confirmed OK.
        const e1 = ev({ id: ID_CONFIRMED });
        store.put(v1Row(e1, { publishedAt: 1000, relays: CONFIRMED_RELAYS, address: `30023:${P}:article-1` }));
        // 2. Addressable, ASSUMED-only — the retry-promise rows.
        const e2 = ev({ id: ID_ASSUMED, kind: 30040, tags: [['d', 'claim_x']] });
        store.put(v1Row(e2, { publishedAt: 2000, relays: ASSUMED_RELAYS, address: `30040:${P}:claim_x` }));
        // 3. kind 0 — v1 address null.
        const e3 = ev({ id: ID_KIND0, kind: 0, tags: [] });
        store.put(v1Row(e3, { publishedAt: 3000, relays: CONFIRMED_RELAYS, address: null }));
        // 4. Addressable with NO d tag — v1 address null.
        const e4 = ev({ id: ID_DLESS, kind: 30078, tags: [] });
        store.put(v1Row(e4, { publishedAt: 4000, relays: ASSUMED_RELAYS, address: null }));
        // 5. Addressable with an EMPTY d tag — v1 address `kind:pubkey:`.
        const e5 = ev({ id: ID_EMPTYD, kind: 30040, tags: [['d', '']] });
        store.put(v1Row(e5, { publishedAt: 5000, relays: CONFIRMED_RELAYS, address: `30040:${P}:` }));
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
});

// NOW import the module — its first open runs the v1→v2 upgrade.
const {
    listAll, getByEventId, getByAddress, exportBundle, MIGRATION_DEFER_S
} = await import('../src/shared/event-journal.js');

test('migration: flush states derive from the stored relay snapshot', async () => {
    const confirmed = await getByEventId(ID_CONFIRMED);
    assert.equal(confirmed.flush.state, 'flushed', 'any confirmed OK → flushed');
    assert.equal(confirmed.flush.attempts, 1);
    assert.equal(confirmed.flush.nextAttemptAt, null);

    const assumed = await getByEventId(ID_ASSUMED);
    assert.equal(assumed.flush.state, 'pending',
        'assumed-only → pending: the queue inherits the retry promise the re-sign path used to keep');
    const now = Math.floor(Date.now() / 1000);
    assert.ok(assumed.flush.nextAttemptAt > now + MIGRATION_DEFER_S - 120
        && assumed.flush.nextAttemptAt <= now + MIGRATION_DEFER_S + 120,
        'migrated pending rows DEFER ~6h — no first-wake flood of the historical backlog');
});

test('migration: signedAt backfills from publishedAt; ledger backfills null', async () => {
    for (const [id, publishedAt] of [[ID_CONFIRMED, 1000], [ID_ASSUMED, 2000], [ID_KIND0, 3000]]) {
        const row = await getByEventId(id);
        assert.equal(row.signedAt, publishedAt, `${id.slice(0, 4)}… signedAt = old publishedAt`);
        assert.equal(row.publishedAt, publishedAt, 'publishedAt untouched');
        assert.equal(row.ledger, null);
        assert.deepEqual(row.event.sig, 's'.repeat(128), 'the signed event rides through verbatim');
    }
});

test('migration: EVERY address recomputes under replaceableKey', async () => {
    assert.equal((await getByEventId(ID_CONFIRMED)).address, `30023:${P}:article-1`,
        'non-empty d: unchanged');
    assert.equal((await getByEventId(ID_KIND0)).address, `0:${P}`,
        'kind 0 gains an address (was null)');
    assert.equal((await getByEventId(ID_DLESS)).address, `30078:${P}:${ID_DLESS}`,
        'missing d falls back to the event id (was null)');
    assert.equal((await getByEventId(ID_EMPTYD)).address, `30040:${P}:${ID_EMPTYD}`,
        'EMPTY d also falls back to the event id (was kind:pubkey:) — the documented divergence');
});

test('migration: reads work over the migrated rows — address lookup and bundle order', async () => {
    const rows = await getByAddress(`0:${P}`);
    assert.equal(rows.length, 1, 'the newly-addressed kind-0 row is findable by address');
    assert.equal(rows[0].eventId, ID_KIND0);

    const bundle = await exportBundle();
    assert.equal(bundle.count, 5, 'no row lost in migration');
    assert.deepEqual(bundle.events.map((e) => e.id),
        [ID_CONFIRMED, ID_ASSUMED, ID_KIND0, ID_DLESS, ID_EMPTYD],
        'oldest signed first (signedAt backfilled from publishedAt keeps the old order)');

    const all = await listAll();
    assert.ok(all.every((r) => r.flush && typeof r.flush.state === 'string'), 'every row is v2-shaped');
});

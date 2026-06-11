// Portal corpus cache (Phase 12.3, docs/PORTAL_DESIGN.md).
//
// IndexedDB `xray-portal` — deliberately a SEPARATE database from
// `xray-archive`: this cache is derived data, droppable and rebuildable
// from the relays at any time, while the archive holds precious local
// captures; coupling their schema versions and eviction stories buys
// nothing (recorded in JOURNAL 2026-06-10). Same open/upgrade/req
// idioms as archive-cache.js.
//
// One `events` row per LIVE event: raw signed event + the relay set
// that returned it + bookkeeping. Replaceable/addressable supersession
// happens at WRITE time keyed on the shared replaceableKey — the store
// only ever holds the newest version per address, so readers render
// straight from `loadRecords()` with no further dedupe. Raw events are
// the stored truth; parsing happens on read (parsers are cheap and
// cached data stays valid across parser evolution).

import { replaceableKey } from '../shared/nostr-events.js';

const DB_NAME = 'xray-portal';
const DB_VERSION = 1;
const EVENTS_STORE = 'events';
const META_STORE = 'meta';

function idb() {
    const target = globalThis.indexedDB || (typeof self !== 'undefined' && self.indexedDB);
    if (!target) throw new Error('portal-cache: no indexedDB in this context');
    return target;
}

function req(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror   = () => reject(request.error);
    });
}

function txDone(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror    = () => reject(transaction.error);
        transaction.onabort    = () => reject(transaction.error || new Error('transaction aborted'));
    });
}

let _dbPromise = null;

export function openPortalDb() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
        let open;
        try { open = idb().open(DB_NAME, DB_VERSION); }
        catch (err) { reject(err); return; }

        open.onupgradeneeded = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains(EVENTS_STORE)) {
                const store = db.createObjectStore(EVENTS_STORE, { keyPath: 'id' });
                store.createIndex('kind',       'kind',       { unique: false });
                store.createIndex('pubkey',     'pubkey',     { unique: false });
                store.createIndex('created_at', 'created_at', { unique: false });
                // addr is null for regular events; IDB indexes skip
                // rows whose key value is absent, so store '' instead.
                store.createIndex('addr',       'addr',       { unique: false });
            }
            if (!db.objectStoreNames.contains(META_STORE)) {
                db.createObjectStore(META_STORE, { keyPath: 'key' });
            }
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror   = () => reject(open.error);
    });
    return _dbPromise;
}

/** For tests — drop the memoized handle so the next open re-runs. */
export function _resetForTests() {
    _dbPromise = null;
}

function rowFromRecord(record, now) {
    const event = record.event;
    const dTag = (((event.tags || []).find((t) => t[0] === 'd')) || [])[1] || '';
    return {
        id: event.id,
        kind: event.kind,
        pubkey: event.pubkey || '',
        created_at: event.created_at || 0,
        dTag,
        addr: replaceableKey(event) || '',
        event,
        relays: [...new Set(record.relays || [])],
        firstSeenAt: now,
        lastSeenAt: now
    };
}

/**
 * Upsert fetched records. Per record:
 *   - same event id already cached → merge the relay sets, bump lastSeenAt
 *   - replaceable/addressable with a CACHED NEWER version at the same
 *     address → incoming is stale, skipped
 *   - replaceable/addressable superseding an older cached version →
 *     older row(s) deleted, incoming inserted
 *
 * @param {Array<{event: object, relays: string[]}>} records
 * @param {{now?: number}} [opts]  epoch seconds for bookkeeping (tests pass fixed values)
 * @returns {Promise<{added: number, updated: number, superseded: number, skippedStale: number}>}
 */
export async function saveRecords(records, { now = Math.floor(Date.now() / 1000) } = {}) {
    const db = await openPortalDb();
    const transaction = db.transaction([EVENTS_STORE], 'readwrite');
    const store = transaction.objectStore(EVENTS_STORE);
    const addrIndex = store.index('addr');
    const stats = { added: 0, updated: 0, superseded: 0, skippedStale: 0 };

    for (const record of (Array.isArray(records) ? records : [])) {
        if (!record || !record.event || !record.event.id) continue;
        const event = record.event;

        const existing = await req(store.get(event.id));
        if (existing) {
            const merged = new Set([...(existing.relays || []), ...(record.relays || [])]);
            existing.relays = [...merged];
            existing.lastSeenAt = now;
            await req(store.put(existing));
            stats.updated++;
            continue;
        }

        const addr = replaceableKey(event) || '';
        if (addr) {
            const siblings = await req(addrIndex.getAll(addr));
            const newer = siblings.find((row) => (row.created_at || 0) >= (event.created_at || 0));
            if (newer) { stats.skippedStale++; continue; }
            for (const row of siblings) {
                await req(store.delete(row.id));
                stats.superseded++;
            }
        }

        await req(store.put(rowFromRecord(record, now)));
        stats.added++;
    }

    await txDone(transaction);
    return stats;
}

/**
 * Everything cached, in the {event, relays} record shape the library
 * model consumes. Already latest-per-address by construction.
 */
export async function loadRecords() {
    const db = await openPortalDb();
    const rows = await req(db.transaction([EVENTS_STORE]).objectStore(EVENTS_STORE).getAll());
    return rows.map((row) => ({ event: row.event, relays: row.relays || [] }));
}

export async function countEvents() {
    const db = await openPortalDb();
    return await req(db.transaction([EVENTS_STORE]).objectStore(EVENTS_STORE).count());
}

export async function getMeta(key) {
    const db = await openPortalDb();
    const row = await req(db.transaction([META_STORE]).objectStore(META_STORE).get(key));
    return row ? row.value : null;
}

export async function setMeta(key, value) {
    const db = await openPortalDb();
    const transaction = db.transaction([META_STORE], 'readwrite');
    transaction.objectStore(META_STORE).put({ key, value });
    await txDone(transaction);
}

/** Wipe everything — the Resync path. The cache is derived; this is safe. */
export async function clearAll() {
    const db = await openPortalDb();
    const transaction = db.transaction([EVENTS_STORE, META_STORE], 'readwrite');
    transaction.objectStore(EVENTS_STORE).clear();
    transaction.objectStore(META_STORE).clear();
    await txDone(transaction);
}

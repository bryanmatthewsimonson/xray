// Network feed cache — Phase 25.2b (docs/NETWORK_CLIENT_DESIGN.md §3).
//
// IndexedDB `xray-network` — deliberately a SEPARATE database from
// `xray-archive` AND `xray-portal`: this cache is derived data,
// droppable and rebuildable from the relays at any time (the
// portal-cache posture, JOURNAL 2026-06-10). Like `xray-portal` it is
// deliberately NOT in WORKSPACE_DATABASES — that list doubles as the
// backup coverage list, and a rebuildable cache in a backup is dead
// weight; the page's "Clear cache" button is the wipe affordance. The
// follow list itself lives in chrome.storage (`follow_sets`, cleared
// by workspace reset) and must NEVER move here.
//
// One `events` row per LIVE event with write-time replaceable
// supersession (only the newest version per address is ever stored)
// plus `firstSeenAt` bookkeeping — the "new since you last looked"
// strip is `firstSeenAt > lastLookedAt` (TC §5). The `meta` store
// carries the read-state cursor and cached kind-0 profiles.

import { replaceableKey } from '../shared/nostr-events.js';
import { resolveActiveDbName } from '../shared/workspace-keys.js';

const DB_NAME = 'xray-network';
const DB_VERSION = 1;
const EVENTS_STORE = 'events';
const META_STORE = 'meta';

export const LAST_LOOKED_KEY = 'lastLookedAt';

function idb() {
    const target = globalThis.indexedDB || (typeof self !== 'undefined' && self.indexedDB);
    if (!target) throw new Error('network-cache: no indexedDB in this context');
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
let _dbName = null;   // the on-disk name _dbPromise opened (28.1)

export function openNetworkDb() {
    // 28.1: the DB name is workspace-suffixed; the memoized handle is
    // keyed by name so a workspace switch in a live context re-opens
    // the right database instead of reusing the old workspace's.
    return resolveActiveDbName(DB_NAME).then((dbName) => {
        if (_dbPromise && _dbName === dbName) return _dbPromise;
        if (_dbPromise) {
            _dbPromise.then((db) => { try { db.close(); } catch (_) { /* noop */ } }).catch(() => {});
            _dbPromise = null;   // never let openNamed short-circuit onto the old workspace's handle
        }
        _dbName = dbName;
        return openNamed(dbName);
    });
}

function openNamed(dbName) {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
        // (Rejections un-memoize below so one failed open doesn't
        // brick every later call.)
        let open;
        try { open = idb().open(dbName, DB_VERSION); }
        catch (err) { reject(err); return; }

        open.onupgradeneeded = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains(EVENTS_STORE)) {
                const store = db.createObjectStore(EVENTS_STORE, { keyPath: 'id' });
                store.createIndex('kind',       'kind',       { unique: false });
                store.createIndex('pubkey',     'pubkey',     { unique: false });
                store.createIndex('created_at', 'created_at', { unique: false });
                store.createIndex('addr',       'addr',       { unique: false });
            }
            if (!db.objectStoreNames.contains(META_STORE)) {
                db.createObjectStore(META_STORE, { keyPath: 'key' });
            }
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror   = () => reject(open.error);
    });
    _dbPromise.catch(() => { _dbPromise = null; });
    return _dbPromise;
}

/** For tests — drop the memoized handle so the next open re-runs. */
export function _resetForTests() {
    _dbPromise = null;
}

function rowFromRecord(record, now) {
    const event = record.event;
    return {
        id: event.id,
        kind: event.kind,
        pubkey: event.pubkey || '',
        created_at: event.created_at || 0,
        addr: replaceableKey(event) || '',
        event,
        relays: [...new Set(record.relays || [])],
        firstSeenAt: now,
        lastSeenAt: now
    };
}

/**
 * Upsert fetched records — same contract as portal-cache saveRecords:
 * id-match merges relay sets; a cached newer version at the same
 * address skips the incoming as stale; an older cached version is
 * superseded (deleted) before insert.
 */
export async function saveRecords(records, { now = Math.floor(Date.now() / 1000) } = {}) {
    const db = await openNetworkDb();
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
 * Everything cached, with the `firstSeenAt` bookkeeping the awareness
 * strip needs. Already latest-per-address by construction.
 * @returns {Promise<Array<{event: object, relays: string[], firstSeenAt: number}>>}
 */
export async function loadRecords() {
    const db = await openNetworkDb();
    const rows = await req(db.transaction([EVENTS_STORE]).objectStore(EVENTS_STORE).getAll());
    return rows.map((row) => ({ event: row.event, relays: row.relays || [], firstSeenAt: row.firstSeenAt || 0 }));
}

export async function countEvents() {
    const db = await openNetworkDb();
    return await req(db.transaction([EVENTS_STORE]).objectStore(EVENTS_STORE).count());
}

export async function getMeta(key) {
    const db = await openNetworkDb();
    const row = await req(db.transaction([META_STORE]).objectStore(META_STORE).get(key));
    return row ? row.value : null;
}

export async function setMeta(key, value) {
    const db = await openNetworkDb();
    const transaction = db.transaction([META_STORE], 'readwrite');
    transaction.objectStore(META_STORE).put({ key, value });
    await txDone(transaction);
}

/** Cached kind-0 profile for a pubkey, or null. */
export async function getProfile(pubkey) {
    return await getMeta(`profile:${String(pubkey || '').toLowerCase()}`);
}

/** Cache a kind-0 profile snapshot `{name?, about?, updatedAt}`. */
export async function setProfile(pubkey, profile) {
    await setMeta(`profile:${String(pubkey || '').toLowerCase()}`, profile);
}

/** Wipe everything — the "Clear feed cache" path. Derived data; safe. */
export async function clearAll() {
    const db = await openNetworkDb();
    const transaction = db.transaction([EVENTS_STORE, META_STORE], 'readwrite');
    transaction.objectStore(EVENTS_STORE).clear();
    transaction.objectStore(META_STORE).clear();
    await txDone(transaction);
}

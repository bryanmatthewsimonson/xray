// X-Ray — signed-event journal.
//
// IndexedDB database `xray-events`, following audit-cache.js's
// idempotent-open pattern (separate DB: different lifecycle, no
// coupled schema bumps). Every event X-Ray successfully publishes is
// appended here VERBATIM — the full signed JSON — which buys three
// things at once:
//
//   1. REPUBLISH: a signed event can be re-broadcast to relays as-is,
//      no re-signing, no NIP-07 prompt (the portal's rebroadcast
//      action and reconcile's "missing" repair).
//   2. DURABILITY: the journal export is the raw signed-event bundle —
//      "replayable by anyone" survives a relay outage or prune
//      (EPISTACK_WIN_PLAN §5.1, revived by owner decision 2026-07-10).
//   3. HONEST RECONCILE: what we actually sent, with the per-relay
//      outcome snapshot (confirmed vs assumed vs failed) at send time.
//
// PRECIOUS like the audit ledger: signatures cannot be regenerated for
// a NIP-07 identity, so journal rows are export-included and never
// auto-dropped. Rows are keyed by event id; a re-publish of the same
// addressable event (new id after an edit) is a NEW row — the journal
// is append-only history, `getByAddress` returns newest-first.

import { Utils } from './utils.js';
import { resolveActiveDbName } from './workspace-keys.js';

const DB_NAME = 'xray-events';
const DB_VERSION = 1;
const EVENTS_STORE = 'published_events';

function idb() {
    if (typeof indexedDB === 'undefined') {
        throw new Error('IndexedDB is not available in this context');
    }
    return indexedDB;
}

function req(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function tx(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
    });
}

let _dbPromise = null;
let _dbName = null;   // the on-disk name _dbPromise opened (28.1)

export function openEventJournalDb() {
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
        let open;
        try { open = idb().open(dbName, DB_VERSION); }
        catch (err) { reject(err); return; }

        open.onupgradeneeded = (ev) => {
            const db = open.result;
            const oldVersion = ev.oldVersion || 0;
            if (oldVersion < 1) {
                if (!db.objectStoreNames.contains(EVENTS_STORE)) {
                    const store = db.createObjectStore(EVENTS_STORE, { keyPath: 'eventId' });
                    store.createIndex('kind', 'kind', { unique: false });
                    store.createIndex('address', 'address', { unique: false });
                    store.createIndex('articleUrl', 'articleUrl', { unique: false });
                    store.createIndex('publishedAt', 'publishedAt', { unique: false });
                }
            }
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
    });
    return _dbPromise;
}

/** `kind:pubkey:d` for parameterized-replaceable kinds, else null. */
export function eventAddress(event) {
    if (!event || typeof event.kind !== 'number') return null;
    const parameterized = event.kind >= 30000 && event.kind < 40000;
    if (!parameterized) return null;
    const d = (event.tags || []).find((t) => Array.isArray(t) && t[0] === 'd');
    return d ? `${event.kind}:${event.pubkey}:${d[1] || ''}` : null;
}

/**
 * Normalize a NostrClient.publishToRelays result into the per-relay
 * outcome snapshot the journal stores: [{url, success, assumed}].
 */
function relaySnapshot(results) {
    const rows = (results && Array.isArray(results.results)) ? results.results : [];
    return rows.map((r) => ({
        url: (r && r.url) || '',
        success: !!(r && r.success),
        assumed: !!(r && r.assumed)
    }));
}

/**
 * Append (upsert by event id) one successfully-published signed event.
 * Callers pass the FULL signed event and the publishToRelays results;
 * a repeat broadcast of the same event id updates the relay snapshot
 * and publishedAt rather than duplicating.
 *
 * @param {object} signedEvent            the signed event, verbatim
 * @param {object|null} results          publishToRelays result summary
 * @param {{articleUrl?: string|null}} [opts]
 */
export async function recordPublished(signedEvent, results, { articleUrl = null } = {}) {
    if (!signedEvent || !signedEvent.id || !signedEvent.sig) {
        throw new Error('event-journal: a SIGNED event (id + sig) is required');
    }
    const record = {
        eventId: signedEvent.id,
        kind: signedEvent.kind,
        pubkey: signedEvent.pubkey,
        address: eventAddress(signedEvent),
        createdAt: signedEvent.created_at,
        event: signedEvent,
        publishedAt: Math.floor(Date.now() / 1000),
        relays: relaySnapshot(results),
        articleUrl: articleUrl || null
    };
    const db = await openEventJournalDb();
    const transaction = db.transaction(EVENTS_STORE, 'readwrite');
    transaction.objectStore(EVENTS_STORE).put(record);
    await tx(transaction);
    return record;
}

export async function getByEventId(eventId) {
    if (!eventId) return null;
    const db = await openEventJournalDb();
    const store = db.transaction(EVENTS_STORE, 'readonly').objectStore(EVENTS_STORE);
    return (await req(store.get(eventId))) || null;
}

/** All journal rows for one replaceable address, newest publish first. */
export async function getByAddress(address) {
    if (!address) return [];
    const db = await openEventJournalDb();
    const store = db.transaction(EVENTS_STORE, 'readonly').objectStore(EVENTS_STORE);
    const rows = await req(store.index('address').getAll(address));
    return rows.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
}

export async function listByArticleUrl(articleUrl) {
    if (!articleUrl) return [];
    const db = await openEventJournalDb();
    const store = db.transaction(EVENTS_STORE, 'readonly').objectStore(EVENTS_STORE);
    return req(store.index('articleUrl').getAll(articleUrl));
}

export async function listAll() {
    const db = await openEventJournalDb();
    const store = db.transaction(EVENTS_STORE, 'readonly').objectStore(EVENTS_STORE);
    return req(store.getAll());
}

export async function countAll() {
    const db = await openEventJournalDb();
    const store = db.transaction(EVENTS_STORE, 'readonly').objectStore(EVENTS_STORE);
    return req(store.count());
}

/**
 * The raw signed-event bundle: every journaled event verbatim, oldest
 * first — the durability artifact (win plan §5.1). Consumers can
 * verify every signature and replay the graph with no extension.
 */
export async function exportBundle() {
    const rows = await listAll();
    rows.sort((a, b) => (a.publishedAt || 0) - (b.publishedAt || 0));
    return {
        format: 'xray-events-bundle/1',
        exportedAt: new Date().toISOString(),
        count: rows.length,
        events: rows.map((r) => r.event)
    };
}

export async function clear() {
    const db = await openEventJournalDb();
    const transaction = db.transaction(EVENTS_STORE, 'readwrite');
    transaction.objectStore(EVENTS_STORE).clear();
    await tx(transaction);
}

/** Test hook: drop the memoized connection so a fresh fake DB attaches. */
export function _resetForTests() {
    if (_dbPromise) {
        _dbPromise.then((db) => { try { db.close(); } catch (_) { /* noop */ } })
            .catch((err) => Utils.error('event-journal: reset close failed', err));
    }
    _dbPromise = null;
}

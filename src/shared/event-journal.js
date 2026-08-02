// X-Ray — signed-event journal.
//
// IndexedDB database `xray-events`, following audit-cache.js's
// idempotent-open pattern (separate DB: different lifecycle, no
// coupled schema bumps). Since Phase 29.1 (docs/EVENT_STORE_DESIGN.md
// §3.1) the journal is the publish OUTBOX: behind the
// `storeFirstPublish` flag every event X-Ray signs is appended here
// VERBATIM — the full signed JSON — at SIGN time, before any relay
// attempt, which buys four things at once:
//
//   1. REPUBLISH: a signed event can be re-broadcast to relays as-is,
//      no re-signing, no NIP-07 prompt (the portal's rebroadcast
//      action and reconcile's "missing" repair).
//   2. DURABILITY: the journal export is the raw signed-event bundle —
//      "replayable by anyone" survives a relay outage or prune
//      (EPISTACK_WIN_PLAN §5.1, revived by owner decision 2026-07-10).
//   3. HONEST RECONCILE: what we actually sent, with the per-relay
//      outcome snapshot (confirmed vs assumed vs failed).
//   4. THE OUTBOX (v2): a publish that no relay accepts leaves a
//      `flush.state === 'pending'` row — the signature is never lost,
//      and the 29.2 flusher rebroadcasts it verbatim when due.
//
// PRECIOUS like the audit ledger: signatures cannot be regenerated for
// a NIP-07 identity, so journal rows are export-included and never
// auto-dropped. Rows are keyed by event id; a re-publish of the same
// addressable event (new id after an edit) is a NEW row — the journal
// is append-only history, `getByAddress` returns newest-first.
//
// v2 row (DB_VERSION 2, design §3.1):
//   { eventId, kind, pubkey, address, createdAt, event, articleUrl,
//     signedAt,            // epoch s — row creation is sign time
//     publishedAt,         // last flush attempt (null until the first)
//     relays,              // [{url, success, assumed}] merged snapshot
//     flush: { state,      // 'pending' | 'flushed' | 'held'
//              attempts, nextAttemptAt },
//     ledger: { model, localId, extra, markedAt } | null }
//
// `address` is computed with `replaceableKey` (nostr-events.js), NOT
// the older `eventAddress`: the two agree on addressable events with a
// non-empty `d` tag, but replaceableKey also addresses replaceable
// kinds (0/3/10002 → `kind:pubkey`) and falls back to the event id for
// a missing/empty `d` where eventAddress yielded null/`kind:pubkey:`.
// The v1→v2 migration recomputes every row's address under this rule.

import { Utils } from './utils.js';
import { resolveActiveDbName } from './workspace-keys.js';
import { replaceableKey } from './nostr-events.js';

const DB_NAME = 'xray-events';
const DB_VERSION = 2;
const EVENTS_STORE = 'published_events';

// Flush backoff schedule (design §3.3): attempt 1 is inline at sign
// time, then ~5 min, ~30 min, ~2 h, capped at ~6 h. The journal owns
// the schedule so the 29.2 flusher and the gate share one truth.
export const FLUSH_BACKOFF_S = Object.freeze([300, 1800, 7200, 21600]);

// Pending rows the v1→v2 MIGRATION derives — and v1-shaped backup
// imports normalized on the way in (normalizeImportedRow) — defer to
// the ceiling: no first-wake flood of the historical assumed-only
// backlog into a rate-limited relay (design §3.1). Already-v2 imports
// are NOT deferred: merge-imported pending rows keep their own
// schedule and join the queue as-is (§3.4, Q7 2026-08-02).
export const MIGRATION_DEFER_S = 21600;

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

const nowSec = () => Math.floor(Date.now() / 1000);

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
            if (oldVersion < 2) {
                const store = open.transaction.objectStore(EVENTS_STORE);
                if (!store.indexNames.contains('flushState')) {
                    // The 29.2 flusher's queue scan ('pending' rows due).
                    store.createIndex('flushState', 'flush.state', { unique: false });
                }
                if (oldVersion >= 1) {
                    // Data pass: rewrite every v1 row into the v2 shape
                    // inside the versionchange transaction.
                    const deferUntil = nowSec() + MIGRATION_DEFER_S;
                    store.openCursor().onsuccess = (e) => {
                        const cursor = e.target.result;
                        if (!cursor) return;
                        cursor.update(migrateRowToV2(cursor.value, deferUntil));
                        cursor.continue();
                    };
                }
            }
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
    });
    return _dbPromise;
}

/**
 * v1 → v2 row migration (design §3.1): flush.state derives from the
 * stored relay snapshot (any CONFIRMED — non-assumed — OK → 'flushed';
 * else 'pending', preserving the assumed-only retry doctrine now that
 * 29.1 retires the re-sign path). signedAt backfills from publishedAt
 * (approximate — v1 journaled after the first accepted send, which is
 * as close to sign time as the data gets). Pending rows defer their
 * nextAttemptAt; addresses recompute under replaceableKey for EVERY
 * row, giving historical kind-0/3/10002 rows addresses for the first
 * time. ledger backfills null (their marks already ran, or were
 * declined under the old rules).
 */
function migrateRowToV2(row, deferUntil) {
    const relays = Array.isArray(row.relays) ? row.relays : [];
    const confirmed = relays.some((r) => r && r.success && !r.assumed);
    return {
        ...row,
        address: replaceableKey(row.event),
        signedAt: row.signedAt != null ? row.signedAt
            : (row.publishedAt != null ? row.publishedAt : null),
        flush: (row.flush && row.flush.state) ? row.flush : {
            state: confirmed ? 'flushed' : 'pending',
            attempts: relays.length > 0 ? 1 : 0,
            nextAttemptAt: confirmed ? null : deferUntil
        },
        ledger: row.ledger || null
    };
}

/**
 * Normalize a journal row of ANY vintage into the v2 shape — the
 * backup import hook (backup.js applies it on both restore and
 * merge). Pre-29.1 backup files carry v1-shaped rows; put verbatim
 * into a v2 database they would never re-migrate (onupgradeneeded is
 * done) and — lacking the 'flush.state' keyPath — would be INVISIBLE
 * to the flushState index, stranding them from the 29.2 flusher: the
 * silent-strand failure §3.4 exists to rule out. v1-shaped rows take
 * the same treatment as the migration (they are migration-equivalent,
 * including the ~6h defer); v2-shaped rows pass through VERBATIM —
 * imported pending rows keep their own schedule and join the queue
 * (Q7 2026-08-02).
 */
export function normalizeImportedRow(row) {
    if (!row || typeof row !== 'object') return row;
    if (row.flush && row.flush.state) return row;
    return migrateRowToV2(row, nowSec() + MIGRATION_DEFER_S);
}

/**
 * LEGACY address: `kind:pubkey:d` for parameterized-replaceable kinds,
 * else null. Superseded by `replaceableKey` for the stored `address`
 * field (v2) — kept exported for callers comparing against the old
 * rule; do not use it for new journal reads.
 */
export function eventAddress(event) {
    if (!event || typeof event.kind !== 'number') return null;
    const parameterized = event.kind >= 30000 && event.kind < 40000;
    if (!parameterized) return null;
    const d = (event.tags || []).find((t) => Array.isArray(t) && t[0] === 'd');
    return d ? `${event.kind}:${event.pubkey}:${d[1] || ''}` : null;
}

/**
 * Normalize a relay-publish result summary into the per-relay outcome
 * snapshot the journal stores: [{url, success, assumed}].
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
 * Merge a fresh attempt's per-relay snapshot into the stored one, by
 * relay url. A CONFIRMED (success && !assumed) entry is never
 * downgraded by a later failed or assumed attempt against the same
 * relay — the relay HAS the event; history keeps that truth.
 */
function mergeRelaySnapshots(existing, fresh) {
    const byUrl = new Map();
    for (const r of Array.isArray(existing) ? existing : []) {
        if (r && r.url) byUrl.set(r.url, r);
    }
    for (const r of fresh) {
        if (!r.url) continue;
        const prior = byUrl.get(r.url);
        if (prior && prior.success && !prior.assumed) continue;   // confirmed stays confirmed
        byUrl.set(r.url, r);
    }
    return [...byUrl.values()];
}

const snapshotConfirmed = (relays) =>
    (Array.isArray(relays) ? relays : []).some((r) => r && r.success && !r.assumed);

/** Sanitize a call-site ledger descriptor into the stored shape, or null. */
function normalizeLedger(ledger) {
    if (!ledger || typeof ledger !== 'object' || !ledger.model) return null;
    return {
        model: String(ledger.model),
        localId: ledger.localId != null ? ledger.localId : null,
        extra: ledger.extra != null ? ledger.extra : null,
        markedAt: ledger.markedAt != null ? ledger.markedAt : null
    };
}

function backoffAfter(attempts) {
    const idx = Math.min(Math.max(attempts, 1) - 1, FLUSH_BACKOFF_S.length - 1);
    return FLUSH_BACKOFF_S[idx];
}

/**
 * Upsert a row at SIGN time (store-first publish, design §3.2): the
 * signed event lands as a 'pending' outbox row BEFORE any relay send,
 * carrying the ledger descriptor the flusher needs for a late
 * confirmation mark. Re-recording an event id that is already
 * journaled merges instead of clobbering: flush state is never
 * downgraded, the original signedAt stands, and an EXISTING
 * articleUrl/ledger always wins — the caller's values only fill
 * fields the stored row lacks.
 *
 * @param {object} signedEvent  the signed event, verbatim
 * @param {{ledger?: object|null, articleUrl?: string|null}} [opts]
 */
export async function recordSigned(signedEvent, { ledger = null, articleUrl = null } = {}) {
    if (!signedEvent || !signedEvent.id || !signedEvent.sig) {
        throw new Error('event-journal: a SIGNED event (id + sig) is required');
    }
    const db = await openEventJournalDb();
    const transaction = db.transaction(EVENTS_STORE, 'readwrite');
    const store = transaction.objectStore(EVENTS_STORE);
    const existing = await req(store.get(signedEvent.id));
    const now = nowSec();
    const record = existing ? {
        ...existing,
        address: replaceableKey(signedEvent),
        ledger: existing.ledger || normalizeLedger(ledger),
        articleUrl: existing.articleUrl || articleUrl || null
    } : {
        eventId: signedEvent.id,
        kind: signedEvent.kind,
        pubkey: signedEvent.pubkey,
        address: replaceableKey(signedEvent),
        createdAt: signedEvent.created_at,
        event: signedEvent,
        articleUrl: articleUrl || null,
        signedAt: now,
        publishedAt: null,
        relays: [],
        flush: { state: 'pending', attempts: 0, nextAttemptAt: now },
        ledger: normalizeLedger(ledger)
    };
    store.put(record);
    await tx(transaction);
    return record;
}

/**
 * Record one flush (relay-send) attempt against an already-journaled
 * event: merge the per-relay snapshot, bump publishedAt and
 * flush.attempts, and transition 'pending' → 'flushed' on any
 * CONFIRMED (non-assumed) OK. A zero-confirmation attempt leaves the
 * row 'pending' with a backed-off nextAttemptAt (§3.3 schedule).
 * 'held' rows keep their state — held is a policy, not an outcome.
 *
 * @param {string} eventId
 * @param {object|null} results  relay publish result summary
 * @returns {Promise<object|null>} the updated row, or null when the
 *          event was never journaled (recordSigned failed or was
 *          skipped) — callers log, they don't throw.
 */
export async function recordFlushAttempt(eventId, results) {
    if (!eventId) return null;
    const db = await openEventJournalDb();
    const transaction = db.transaction(EVENTS_STORE, 'readwrite');
    const store = transaction.objectStore(EVENTS_STORE);
    const existing = await req(store.get(eventId));
    if (!existing) return null;
    const now = nowSec();
    const relays = mergeRelaySnapshots(existing.relays, relaySnapshot(results));
    const prior = existing.flush || { state: 'pending', attempts: 0, nextAttemptAt: null };
    const attempts = (prior.attempts || 0) + 1;
    let state = prior.state || 'pending';
    let nextAttemptAt = prior.nextAttemptAt || null;
    if (state === 'pending') {
        if (snapshotConfirmed(relays)) {
            state = 'flushed';
            nextAttemptAt = null;
        } else {
            nextAttemptAt = now + backoffAfter(attempts);
        }
    }
    const record = {
        ...existing,
        publishedAt: now,
        relays,
        flush: { state, attempts, nextAttemptAt }
    };
    store.put(record);
    await tx(transaction);
    return record;
}

/**
 * LEGACY append (upsert by event id) of one successfully-published
 * signed event — the pre-29.1 write path, still used by the gate's
 * flag-off leg for the sites that journaled on success today. Keeps
 * its historical contract (replaces the relay snapshot, stamps
 * publishedAt) while populating the v2 fields coherently: flush.state
 * derives from the snapshot, signedAt backfills from the first write,
 * and an existing ledger descriptor survives.
 *
 * @param {object} signedEvent            the signed event, verbatim
 * @param {object|null} results          relay publish result summary
 * @param {{articleUrl?: string|null}} [opts]
 */
export async function recordPublished(signedEvent, results, { articleUrl = null } = {}) {
    if (!signedEvent || !signedEvent.id || !signedEvent.sig) {
        throw new Error('event-journal: a SIGNED event (id + sig) is required');
    }
    const db = await openEventJournalDb();
    const transaction = db.transaction(EVENTS_STORE, 'readwrite');
    const store = transaction.objectStore(EVENTS_STORE);
    const existing = await req(store.get(signedEvent.id));
    const now = nowSec();
    const relays = relaySnapshot(results);
    const confirmed = snapshotConfirmed(relays);
    const priorState = existing && existing.flush && existing.flush.state;
    const attempts = ((existing && existing.flush && existing.flush.attempts) || 0) + 1;
    const state = priorState === 'held' ? 'held'
        : (confirmed || priorState === 'flushed') ? 'flushed' : 'pending';
    const record = {
        eventId: signedEvent.id,
        kind: signedEvent.kind,
        pubkey: signedEvent.pubkey,
        address: replaceableKey(signedEvent),
        createdAt: signedEvent.created_at,
        event: signedEvent,
        articleUrl: articleUrl || (existing && existing.articleUrl) || null,
        signedAt: (existing && existing.signedAt != null) ? existing.signedAt : now,
        publishedAt: now,
        relays,
        flush: {
            state,
            attempts,
            nextAttemptAt: state === 'pending' ? now + backoffAfter(attempts) : null
        },
        ledger: (existing && existing.ledger) || null
    };
    store.put(record);
    await tx(transaction);
    return record;
}

export async function getByEventId(eventId) {
    if (!eventId) return null;
    const db = await openEventJournalDb();
    const store = db.transaction(EVENTS_STORE, 'readonly').objectStore(EVENTS_STORE);
    return (await req(store.get(eventId))) || null;
}

// Sort key: sign time, falling back to publish time for pre-v2 rows
// that never recorded a signedAt (pending rows have publishedAt null,
// so publishedAt alone would misplace them).
const rowTime = (r) => (r.signedAt != null ? r.signedAt : (r.publishedAt || 0));

/** All journal rows for one replaceable address, newest signed first. */
export async function getByAddress(address) {
    if (!address) return [];
    const db = await openEventJournalDb();
    const store = db.transaction(EVENTS_STORE, 'readonly').objectStore(EVENTS_STORE);
    const rows = await req(store.index('address').getAll(address));
    return rows.sort((a, b) => rowTime(b) - rowTime(a));
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
 * signed first — the durability artifact (win plan §5.1). Sign-time
 * journaling WIDENS the bundle: it contains everything you signed,
 * including pending rows no relay has accepted yet. Consumers can
 * verify every signature and replay the graph with no extension.
 */
export async function exportBundle() {
    const rows = await listAll();
    rows.sort((a, b) => rowTime(a) - rowTime(b));
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

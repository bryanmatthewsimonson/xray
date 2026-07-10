// backup.js — full-workspace export/restore for X-Ray.
//
// Covers everything the extension persists locally:
//   - chrome.storage.local  — all keys (content + config + identities,
//     including the primary nsec and per-entity keys) MINUS `xray:llm:key`,
//     which is a third-party API credential and must never leave the
//     machine inside a backup (its module forbids export).
//   - IndexedDB             — xray-archive (articles, metadata stores,
//     prior versions, source documents), xray-audits, and the xray-events
//     signed-event journal. Dumped generically: every object store, every
//     row, verbatim.
//
// Format `xray-backup/1` is a single JSON document. Binary payloads
// (ArrayBuffer / TypedArray, i.e. source-document bytes) are encoded as
// {__xrayBytes: <base64>} markers so the file survives JSON round-trips;
// restore decodes them back to ArrayBuffers.
//
// Restore semantics are REPLACE-ALL, not merge: storage.local is cleared
// (except `xray:llm:key`, which is preserved from the running profile) and
// rewritten from the backup; each covered database has every store cleared
// and re-filled. Callers are expected to take a safety backup first — the
// Options UI does.

import { WORKSPACE_DATABASES } from './identity-profiles.js';
import { openArchiveDb } from './archive-cache.js';
import { openAuditDb } from './audit/audit-cache.js';
import { openEventJournalDb } from './event-journal.js';

export const BACKUP_FORMAT = 'xray-backup/1';

// The one storage key a backup must never contain.
const EXCLUDED_STORAGE_KEYS = ['xray:llm:key'];

// Stores whose rows carry raw bytes; skipped when includeSourceBytes=false.
const BYTE_STORES = { 'xray-archive': ['source_documents'] };

// Openers that materialize each database's schema before a restore fills
// it. Restoring must never invent schemas — the owning module's opener is
// the single source of truth for stores + indexes.
const DB_OPENERS = {
    'xray-archive': openArchiveDb,
    'xray-audits': openAuditDb,
    'xray-events': openEventJournalDb
};

// ---------------------------------------------------------------------------
// Bytes <-> JSON-safe markers

const BYTES_MARK = '__xrayBytes';

function bufToBase64(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let out = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(out);
}

function base64ToBuf(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
}

/**
 * Deep-walk a value, replacing ArrayBuffer / TypedArray leaves with
 * {__xrayBytes: base64} markers. Everything else passes through.
 */
export function toSerializable(value) {
    if (value === null || value === undefined) return value;
    if (value instanceof ArrayBuffer) return { [BYTES_MARK]: bufToBase64(value) };
    if (ArrayBuffer.isView(value)) {
        return { [BYTES_MARK]: bufToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
    }
    if (Array.isArray(value)) return value.map(toSerializable);
    if (value instanceof Date) return value; // JSON handles Dates as ISO strings already
    if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = toSerializable(v);
        return out;
    }
    return value;
}

/**
 * Inverse of toSerializable: {__xrayBytes} markers become ArrayBuffers.
 */
export function fromSerializable(value) {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(fromSerializable);
    if (typeof value === 'object') {
        const keys = Object.keys(value);
        if (keys.length === 1 && keys[0] === BYTES_MARK && typeof value[BYTES_MARK] === 'string') {
            return base64ToBuf(value[BYTES_MARK]);
        }
        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = fromSerializable(v);
        return out;
    }
    return value;
}

// ---------------------------------------------------------------------------
// Generic IndexedDB dump / fill

function openCovered(name) {
    // ALWAYS open through the owning module's opener: opening a
    // never-created DB versionless would mint an empty v1 database and
    // permanently suppress the real opener's onupgradeneeded (it opens at
    // the same version), leaving the module without its stores. The
    // opener creates the canonical schema if absent, which is what the
    // extension would do on first use anyway.
    //
    // The returned connection is the opener's CACHED, shared handle —
    // never close() it here, or every later caller in this page gets a
    // dead connection.
    const opener = DB_OPENERS[name];
    if (!opener) return Promise.reject(new Error(`no opener for database ${name}`));
    return opener();
}

function getAllRows(db, storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error || new Error(`getAll ${storeName} failed`));
    });
}

/**
 * Dump one database: { storeName: [rows...] } for every object store.
 * Stores listed in skipStores are recorded as `null` (present but omitted)
 * so a restore knows the omission was deliberate, not data loss.
 */
export async function dumpDatabase(name, { skipStores = [] } = {}) {
    const db = await openCovered(name);
    const stores = Array.from(db.objectStoreNames);
    const out = {};
    for (const store of stores) {
        out[store] = skipStores.includes(store)
            ? null
            : toSerializable(await getAllRows(db, store));
    }
    return out;
}

function clearAndFill(db, storeName, rows) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.clear();
        for (const row of rows) store.put(fromSerializable(row));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error(`fill ${storeName} failed`));
        tx.onabort = () => reject(tx.error || new Error(`fill ${storeName} aborted`));
    });
}

/**
 * Restore one database from a dump. The owning module's opener runs first
 * so the schema exists at its current version; then each dumped store is
 * cleared and re-filled. Stores dumped as `null` (bytes omitted at export)
 * are cleared but left empty — the backup declared it had no bytes for
 * them. Dump stores that don't exist in the current schema are skipped
 * with a warning (forward-compat: older backup, renamed store).
 */
export async function restoreDatabase(name, dump, { warn = () => {} } = {}) {
    const db = await openCovered(name);
    const live = new Set(Array.from(db.objectStoreNames));
    for (const [storeName, rows] of Object.entries(dump || {})) {
        if (!live.has(storeName)) {
            warn(`backup restore: store ${name}/${storeName} not in current schema — skipped`);
            continue;
        }
        await clearAndFill(db, storeName, rows === null ? [] : rows);
    }
}

// ---------------------------------------------------------------------------
// storage.local collect / apply

// Same area pick + callback style as storage.js so Firefox's chrome.*
// shims never bite. Values are captured and restored RAW (the wrapper's
// JSON-string encoding included) so a restore is byte-identical.
function storageArea() {
    if (typeof browser !== 'undefined' && browser.storage) return browser.storage.local;
    if (typeof chrome !== 'undefined' && chrome.storage) return chrome.storage.local;
    throw new Error('extension storage unavailable');
}

function areaGetAll(area) {
    return new Promise((resolve) => area.get(null, (all) => resolve(all || {})));
}

function areaRemove(area, keys) {
    return new Promise((resolve) => area.remove(keys, () => resolve()));
}

function areaSet(area, obj) {
    return new Promise((resolve) => area.set(obj, () => resolve()));
}

async function collectStorage() {
    const all = await areaGetAll(storageArea());
    const out = {};
    for (const [k, v] of Object.entries(all)) {
        if (EXCLUDED_STORAGE_KEYS.includes(k)) continue;
        out[k] = v;
    }
    return out;
}

async function applyStorage(entries) {
    const area = storageArea();
    const current = await areaGetAll(area);
    const toRemove = Object.keys(current).filter((k) => !EXCLUDED_STORAGE_KEYS.includes(k));
    if (toRemove.length) await areaRemove(area, toRemove);
    // Never write the excluded keys even if a hand-edited file smuggles them in.
    const clean = {};
    for (const [k, v] of Object.entries(entries || {})) {
        if (EXCLUDED_STORAGE_KEYS.includes(k)) continue;
        clean[k] = v;
    }
    if (Object.keys(clean).length) await areaSet(area, clean);
}

// ---------------------------------------------------------------------------
// Public API

/**
 * Build the full backup object.
 * @param {object} opts
 * @param {boolean} [opts.includeSourceBytes=true] include raw source-document
 *   bytes (PDF payloads etc.). Off → those stores are recorded as omitted.
 */
export async function collectBackup({ includeSourceBytes = true } = {}) {
    const databases = {};
    for (const name of WORKSPACE_DATABASES) {
        const skipStores = includeSourceBytes ? [] : (BYTE_STORES[name] || []);
        databases[name] = await dumpDatabase(name, { skipStores });
    }
    return {
        format: BACKUP_FORMAT,
        exportedAt: new Date().toISOString(),
        includesSourceBytes: !!includeSourceBytes,
        storage: await collectStorage(),
        databases
    };
}

/**
 * Validate a parsed backup file. Returns a list of problems (empty = valid).
 */
export function validateBackup(backup) {
    const problems = [];
    if (!backup || typeof backup !== 'object') return ['not an object'];
    if (backup.format !== BACKUP_FORMAT) problems.push(`unknown format ${JSON.stringify(backup.format)} (expected ${BACKUP_FORMAT})`);
    if (!backup.storage || typeof backup.storage !== 'object') problems.push('missing storage section');
    if (!backup.databases || typeof backup.databases !== 'object') problems.push('missing databases section');
    return problems;
}

/**
 * Replace-all restore from a validated backup object.
 * Storage first (cheap, atomic-ish), then each database.
 */
export async function applyBackup(backup, { warn = () => {} } = {}) {
    const problems = validateBackup(backup);
    if (problems.length) throw new Error(`invalid backup: ${problems.join('; ')}`);
    await applyStorage(backup.storage);
    for (const [name, dump] of Object.entries(backup.databases || {})) {
        if (!WORKSPACE_DATABASES.includes(name)) {
            warn(`backup restore: database ${name} not covered — skipped`);
            continue;
        }
        await restoreDatabase(name, dump, { warn });
    }
}

/**
 * Rough size estimate for the export, in bytes, without building the whole
 * JSON string for the byte-heavy stores twice. Used by the Options UI to
 * label the source-bytes checkbox.
 * Returns { withBytes, withoutBytes, sourceDocCount }.
 */
export async function estimateBackupSize() {
    // Storage + non-byte stores: serialize once (they're text-sized).
    const light = await collectBackup({ includeSourceBytes: false });
    const withoutBytes = new Blob([JSON.stringify(light)]).size;

    // Source-document bytes: sum byteLength * 4/3 (base64 overhead).
    let byteTotal = 0;
    let sourceDocCount = 0;
    for (const [dbName, stores] of Object.entries(BYTE_STORES)) {
        for (const storeName of stores) {
            let rows = [];
            try {
                const db = await openCovered(dbName);
                if (Array.from(db.objectStoreNames).includes(storeName)) {
                    rows = await getAllRows(db, storeName);
                }
            } catch (_) { /* unreadable store → zero bytes */ }
            for (const row of rows) {
                sourceDocCount += 1;
                const bytes = row && (row.bytes || row.data || row.buffer);
                if (bytes instanceof ArrayBuffer) byteTotal += bytes.byteLength;
                else if (ArrayBuffer.isView(bytes)) byteTotal += bytes.byteLength;
                else if (typeof row?.size === 'number') byteTotal += row.size;
            }
        }
    }
    return {
        withoutBytes,
        withBytes: withoutBytes + Math.ceil(byteTotal * 4 / 3),
        sourceDocCount
    };
}

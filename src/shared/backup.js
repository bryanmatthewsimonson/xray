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
// TWO ways in (2026-07-25):
//   - applyBackup — REPLACE-ALL: storage.local is cleared (except
//     `xray:llm:key`, preserved from the running profile) and rewritten
//     from the backup; each covered database has every store cleared
//     and re-filled. Callers take a safety backup first — the Options
//     UI does.
//   - mergeBackup — ACCRUAL: the file's CONTENT folds into the live
//     workspace, deduplicated, and local data is never deleted or
//     overwritten. Content maps and stores add what's missing by id
//     (claim/entity ids are content-derived, so identical items dedup
//     naturally; distinct records from another install stay distinct —
//     no name-based identity merging, ever). The one deep merge is
//     `article-extractions` (span-level union via map-artifacts.js).
//     Install config and the primary identity are NEVER touched by a
//     merge — only WORKSPACE_CONTENT_KEYS accrue.

import { WORKSPACE_DATABASES } from './identity-profiles.js';
import { WORKSPACE_CONTENT_KEYS, activeWorkspaceId, workspaceDbName } from './workspace-keys.js';

const WORKSPACE_CONTENT = new Set(WORKSPACE_CONTENT_KEYS);
import { openArchiveDb } from './archive-cache.js';
import { openAuditDb } from './audit/audit-cache.js';
import { openEventJournalDb } from './event-journal.js';
import { mergeExtractionRecords } from './map-artifacts.js';

export const BACKUP_FORMAT = 'xray-backup/1';

// The one storage key a backup must never contain.
// 28.1: 'workspaces' + 'active_workspace' are install-level plumbing —
// a backup is a portable snapshot of ONE workspace (the active one)
// plus install config, restorable into whatever workspace is active at
// apply time. Carrying the registry/pointer would let one workspace's
// file stomp every other workspace on restore.
const EXCLUDED_STORAGE_KEYS = ['xray:llm:key', 'workspaces', 'active_workspace'];

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

// 28.1 scope: the backup carries the ACTIVE workspace's content keys
// under their LOGICAL (bare) names — the same view Storage exposes —
// plus install-level config. Other workspaces' `ws:*` keys never ride
// along, and (under a non-default workspace) neither does the default
// workspace's bare content. The databases section is already
// active-scoped the same way: openCovered routes through the module
// openers, which resolve the workspace-suffixed on-disk names.
async function collectStorage() {
    const ws = await activeWorkspaceId();
    const prefix = `ws:${ws}:`;
    const all = await areaGetAll(storageArea());
    const out = {};
    for (const [k, v] of Object.entries(all)) {
        if (k.startsWith('ws:')) {
            if (ws !== 'default' && k.startsWith(prefix)) {
                const bare = k.slice(prefix.length);
                if (!EXCLUDED_STORAGE_KEYS.includes(bare)) out[bare] = v;
            }
            continue;
        }
        if (EXCLUDED_STORAGE_KEYS.includes(k)) continue;
        if (ws !== 'default' && WORKSPACE_CONTENT.has(k)) continue;   // default ws's content
        out[k] = v;
    }
    return out;
}

async function applyStorage(entries) {
    const ws = await activeWorkspaceId();
    const prefix = `ws:${ws}:`;
    const area = storageArea();
    const current = await areaGetAll(area);
    const mapK = (k) => (ws !== 'default' && WORKSPACE_CONTENT.has(k)) ? prefix + k : k;
    // Replace-all WITHIN this workspace's logical scope: its own content
    // keys plus install config. Other workspaces are untouchable.
    const toRemove = Object.keys(current).filter((k) => {
        if (EXCLUDED_STORAGE_KEYS.includes(k)) return false;
        if (k.startsWith('ws:')) {
            return ws !== 'default' && k.startsWith(prefix)
                && !EXCLUDED_STORAGE_KEYS.includes(k.slice(prefix.length));
        }
        if (ws !== 'default' && WORKSPACE_CONTENT.has(k)) return false;   // default ws's content
        return true;
    });
    if (toRemove.length) await areaRemove(area, toRemove);
    // Never write the excluded keys even if a hand-edited file smuggles them in.
    const clean = {};
    for (const [k, v] of Object.entries(entries || {})) {
        if (EXCLUDED_STORAGE_KEYS.includes(k)) continue;
        clean[mapK(k)] = v;
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

// Versionless open for a workspace snapshot dump: an EXISTING database
// opens at its current version with its real schema; a missing one
// would mint an empty v1 — irrelevant in the one flow that uses this
// (delete-workspace backs up, then deletes the database anyway). Never
// use this for the covered/active path — openCovered's warning applies.
function openRaw(name) {
    return new Promise((resolve, reject) => {
        let open;
        try {
            const idb = globalThis.indexedDB || (typeof self !== 'undefined' && self.indexedDB);
            if (!idb) { reject(new Error('no indexedDB')); return; }
            open = idb.open(name);
        } catch (err) { reject(err); return; }
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
    });
}

/**
 * Snapshot ONE workspace by id — the delete-flow backup (§7 Q2: delete
 * = typed confirm + automatic backup first), usable on a NON-active
 * workspace, which `collectBackup` cannot reach (the module openers
 * resolve the active namespace). Same `xray-backup/1` format with
 * LOGICAL names throughout, so the file restores into whatever
 * workspace is active at apply time.
 */
export async function collectWorkspaceSnapshot(wsId) {
    const ws = String(wsId || '');
    if (!ws) throw new Error('collectWorkspaceSnapshot: workspace id required');
    const prefix = `ws:${ws}:`;
    const all = await areaGetAll(storageArea());
    const storage = {};
    for (const [k, v] of Object.entries(all)) {
        if (ws === 'default') {
            if (WORKSPACE_CONTENT.has(k)) storage[k] = v;
        } else if (k.startsWith(prefix)) {
            const bare = k.slice(prefix.length);
            if (!EXCLUDED_STORAGE_KEYS.includes(bare)) storage[bare] = v;
        }
    }
    const databases = {};
    for (const base of WORKSPACE_DATABASES) {
        const db = await openRaw(workspaceDbName(base, ws)).catch(() => null);
        if (!db) { databases[base] = {}; continue; }
        const out = {};
        for (const store of Array.from(db.objectStoreNames)) {
            out[store] = toSerializable(await getAllRows(db, store));
        }
        try { db.close(); } catch (_) { /* snapshot handle */ }
        databases[base] = out;
    }
    return {
        format: BACKUP_FORMAT,
        exportedAt: new Date().toISOString(),
        includesSourceBytes: true,
        workspaceId: ws,
        storage,
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

// ---------------------------------------------------------------------------
// Merge-import — accrual, not replacement
//
// The semantics, stated once (JOURNAL 2026-07-25):
//   - CONTENT ONLY. Storage keys outside WORKSPACE_CONTENT_KEYS
//     (preferences, relays, flags, the primary identity, the LLM key)
//     are ignored — a merge grows the corpus, it never reconfigures
//     the install or swaps identities.
//   - LOCAL WINS. An id present on both sides keeps the local record
//     verbatim. Dedup is BY ID ONLY: claim ids are content-derived
//     (sha256 of url|text) so identical claims collapse naturally;
//     entities from another install keep their own ids and arrive as
//     distinct records — merging them on name would be silent identity
//     laundering (the 28.6 lesson), so it never happens here. The
//     dedup-review surfaces exist for the human to unify them.
//   - NOTHING DELETED. A merge only ever adds rows/ids or (for
//     article-extractions) folds new atoms into an existing record.

// Per-database deep merges: stores where an existing row can absorb an
// incoming one instead of just winning. Must be synchronous and pure.
const DEEP_MERGE_STORES = {
    'xray-audits': { 'article-extractions': mergeExtractionRecords }
};

function decodeStorageValue(raw) {
    // Storage-wrapper values are JSON strings; tolerate legacy raw
    // objects. Returns null when the value isn't a mergeable id→record
    // map (arrays, scalars, malformed JSON).
    let val = raw;
    let wasString = false;
    if (typeof raw === 'string') {
        wasString = true;
        try { val = JSON.parse(raw); } catch (_) { return null; }
    }
    if (!val || typeof val !== 'object' || Array.isArray(val)) return null;
    return { obj: val, wasString };
}

/**
 * Merge one backup storage value into the local one. Local wins on
 * every shared id; incoming-only ids are added. Returns null when the
 * shapes aren't mergeable maps (caller keeps local), else
 * { value, added } with `value` encoded the way the LOCAL side was.
 */
export function mergeStorageValue(localRaw, incomingRaw) {
    const local = decodeStorageValue(localRaw);
    const incoming = decodeStorageValue(incomingRaw);
    if (!local || !incoming) return null;
    let added = 0;
    const out = { ...local.obj };
    for (const [id, rec] of Object.entries(incoming.obj)) {
        if (id in out) continue;
        out[id] = rec;
        added += 1;
    }
    return { added, value: local.wasString ? JSON.stringify(out) : out };
}

async function mergeStorage(entries) {
    const ws = await activeWorkspaceId();
    const prefix = `ws:${ws}:`;
    const area = storageArea();
    const current = await areaGetAll(area);
    const mapK = (k) => (ws !== 'default' && WORKSPACE_CONTENT.has(k)) ? prefix + k : k;
    const stats = { keysAdded: 0, keysMerged: 0, idsAdded: 0, keysUnchanged: 0, keysSkippedNonContent: 0 };
    const writes = {};
    for (const [k, v] of Object.entries(entries || {})) {
        if (EXCLUDED_STORAGE_KEYS.includes(k) || !WORKSPACE_CONTENT.has(k)) {
            stats.keysSkippedNonContent += 1;   // config/identity never merges
            continue;
        }
        const liveKey = mapK(k);
        const local = current[liveKey];
        if (local === undefined) {
            writes[liveKey] = v;
            stats.keysAdded += 1;
            continue;
        }
        const merged = mergeStorageValue(local, v);
        if (merged === null || merged.added === 0) {
            stats.keysUnchanged += 1;   // unmergeable shape or nothing new — local kept
            continue;
        }
        writes[liveKey] = merged.value;
        stats.keysMerged += 1;
        stats.idsAdded += merged.added;
    }
    if (Object.keys(writes).length) await areaSet(area, writes);
    return stats;
}

function mergeRows(db, storeName, rows, deepMerge) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const keyPath = store.keyPath;
        const stats = { added: 0, merged: 0, kept: 0, skipped: 0 };
        if (typeof keyPath !== 'string') {
            // No covered store uses out-of-line or compound keys; if one
            // ever does, refusing is safer than guessing (auto-keys
            // would duplicate rows on every merge).
            stats.skipped = (rows || []).length;
        } else {
            for (const raw of rows || []) {
                const row = fromSerializable(raw);
                const key = row && row[keyPath];
                if (key === undefined || key === null) { stats.skipped += 1; continue; }
                const getReq = store.get(key);
                getReq.onsuccess = () => {
                    const existing = getReq.result;
                    if (existing === undefined) {
                        store.put(row);
                        stats.added += 1;
                    } else if (deepMerge) {
                        const m = deepMerge(existing, row);
                        if (m && m.changed) { store.put(m.record); stats.merged += 1; }
                        else stats.kept += 1;
                    } else {
                        stats.kept += 1;   // local wins
                    }
                };
            }
        }
        tx.oncomplete = () => resolve(stats);
        tx.onerror = () => reject(tx.error || new Error(`merge ${storeName} failed`));
        tx.onabort = () => reject(tx.error || new Error(`merge ${storeName} aborted`));
    });
}

async function mergeIntoDatabase(name, dump, { warn = () => {} } = {}) {
    const db = await openCovered(name);
    const live = new Set(Array.from(db.objectStoreNames));
    const deep = DEEP_MERGE_STORES[name] || {};
    const out = {};
    for (const [storeName, rows] of Object.entries(dump || {})) {
        if (!live.has(storeName)) {
            warn(`backup merge: store ${name}/${storeName} not in current schema — skipped`);
            continue;
        }
        if (rows === null) {
            // Bytes omitted at export — deliberate, nothing to add.
            out[storeName] = { added: 0, merged: 0, kept: 0, skipped: 0, omitted: true };
            continue;
        }
        out[storeName] = await mergeRows(db, storeName, rows, deep[storeName] || null);
    }
    return out;
}

/**
 * Accrue a validated backup file into the live workspace. Never
 * deletes, never overwrites a local record, never touches config or
 * identity keys. Returns a summary:
 *   { storage: {keysAdded, keysMerged, idsAdded, keysUnchanged,
 *               keysSkippedNonContent},
 *     databases: { <db>: { <store>: {added, merged, kept, skipped} } } }
 */
export async function mergeBackup(backup, { warn = () => {} } = {}) {
    const problems = validateBackup(backup);
    if (problems.length) throw new Error(`invalid backup: ${problems.join('; ')}`);
    const storage = await mergeStorage(backup.storage);
    const databases = {};
    for (const [name, dump] of Object.entries(backup.databases || {})) {
        if (!WORKSPACE_DATABASES.includes(name)) {
            warn(`backup merge: database ${name} not covered — skipped`);
            continue;
        }
        databases[name] = await mergeIntoDatabase(name, dump, { warn });
    }
    return { storage, databases };
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

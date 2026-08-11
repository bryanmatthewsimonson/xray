// backup.js — full-workspace export/restore for X-Ray.
//
// Covers everything the extension persists locally:
//   - chrome.storage.local  — all keys (content + config + identities,
//     including the primary nsec and per-entity keys) MINUS the
//     CREDENTIAL class (`xray:llm:key`, the cloud transcription keys,
//     the companion token) — third-party API credentials and shared
//     secrets must never leave the machine inside ANY backup.
//   - IndexedDB             — xray-archive (articles, metadata stores,
//     prior versions, source documents), xray-audits, and the xray-events
//     signed-event journal. Dumped generically: every object store, every
//     row, verbatim.
//
// Format `xray-backup/1` is a single JSON document. Binary payloads
// (ArrayBuffer / TypedArray, i.e. source-document bytes) are encoded as
// {__xrayBytes: <base64>} markers so the file survives JSON round-trips;
// restore decodes them back to ArrayBuffers. Additive stamps (T1,
// 2026-08-10; absent in older files, which stay restorable):
//   - `xrayVersion`  — the extension version that wrote the file.
//   - `dbVersions`   — each covered database's IndexedDB version at
//     export. Restore/merge REFUSE a file whose database is newer than
//     this install understands (the case-bundle version-gate pattern):
//     newer schemas can carry rows whose keyPaths/indexes this code
//     cannot see, and planting them silently strands data.
//   - `shareable`    — true on a "shareable copy": the SAME format
//     minus every private key. Restore refuses shareable files (a
//     replace-all from a key-free file would erase the local
//     identities); Import & merge is their path in.
//
// TWO ways in (2026-07-25):
//   - applyBackup — REPLACE-ALL: storage.local is cleared (except the
//     credential class, preserved from the running profile) and
//     rewritten from the backup; each covered database has every store
//     cleared and re-filled. Callers take a safety backup first — the
//     Options UI does. Refuses shareable copies (no keys inside — a
//     replace-all would erase the local identities).
//   - mergeBackup — ACCRUAL: the file's CONTENT folds into the live
//     workspace, deduplicated, and local data is never deleted or
//     overwritten. Content maps and stores add what's missing by id
//     (claim/entity ids are content-derived, so identical items dedup
//     naturally; distinct records from another install stay distinct —
//     no name-based identity merging, ever). The one deep merge is
//     `article-extractions` (span-level union via map-artifacts.js).
//     Install config and the primary identity are NEVER touched by a
//     merge — only WORKSPACE_CONTENT_KEYS accrue, minus
//     MERGE_EXCLUDED_KEYS: `local_keys` (per-entity private keys and
//     the xray:user sync key) is content for backup and restore, but
//     merging it would install a colleague's signing keys.

import { WORKSPACE_DATABASES } from './identity-profiles.js';
import { WORKSPACE_CONTENT_KEYS, activeWorkspaceId, workspaceDbName } from './workspace-keys.js';
import { LLM_KEY_STORAGE } from './llm-prompts.js';
import {
    TRANSCRIBER_TOKEN_STORAGE, ASSEMBLYAI_KEY_STORAGE, DEEPGRAM_KEY_STORAGE
} from './transcriber-client.js';

const WORKSPACE_CONTENT = new Set(WORKSPACE_CONTENT_KEYS);

// Keys that are workspace CONTENT for backup/restore/clear purposes but
// must never ACCRUE from someone else's file.
//
// `local_keys` holds per-entity private keys plus the `xray:user` sync
// key. It is legitimately workspace content — a restore of your own
// backup must bring your entity keys back — but merging a colleague's
// bundle would silently install THEIR signing keys into your registry,
// letting you sign as their entities and decrypt their entity sync.
// The Options dialog has always told users "settings/identities in the
// file are ignored"; this is what makes that true. Their entity RECORDS
// still merge — you just cannot sign as them, which is the point.
const MERGE_EXCLUDED_KEYS = new Set(['local_keys']);
import { openArchiveDb } from './archive-cache.js';
import { openAuditDb } from './audit/audit-cache.js';
import { openEventJournalDb, normalizeImportedRow } from './event-journal.js';
// MA.7: the extraction merge is reached through its PLANNER, never
// directly — it needs the local article body, which lives in another
// IndexedDB database and so must be resolved before any transaction.
import { mergeExtractionRows } from './extraction-import.js';

// Per-store row normalizers, applied to every INCOMING row on BOTH
// restore (clearAndFill) and merge (mergeRows). A backup written by an
// older schema must not plant rows the current schema's indexes can't
// see: a v1-shaped journal row put verbatim into the v2 `xray-events`
// store lacks the 'flush.state' keyPath, drops out of the flushState
// index, and is silently stranded from the 29.2 flusher (the exact
// Mac ↔ Windows failure EVENT_STORE_DESIGN §3.4 rules out). The
// normalizer is the owning module's — schemas are never reinvented
// here (the DB_OPENERS principle, applied to rows).
const ROW_NORMALIZERS = {
    'xray-events': { published_events: normalizeImportedRow }
};

export const BACKUP_FORMAT = 'xray-backup/1';

// Third-party API credentials and shared secrets: never inside ANY
// export (B4b, 2026-08-10 — the old single-entry list excluded only
// the LLM key while options.html read as an assurance about the
// class). The names are IMPORTED from their owning modules, never
// restated as strings, so a renamed constant cannot silently fall out
// of the exclusion; the guard test asserts the class stays covered.
export const CREDENTIAL_STORAGE_KEYS = Object.freeze([
    LLM_KEY_STORAGE,             // Anthropic API key (its module forbids export)
    TRANSCRIBER_TOKEN_STORAGE,   // companion shared secret
    ASSEMBLYAI_KEY_STORAGE,      // cloud transcription keys
    DEEPGRAM_KEY_STORAGE
]);

// Storage keys a backup must never contain: the credential class, plus
// install-level plumbing (28.1: 'workspaces' + 'active_workspace' — a
// backup is a portable snapshot of ONE workspace plus install config,
// restorable into whatever workspace is active at apply time; carrying
// the registry/pointer would let one workspace's file stomp every
// other workspace on restore).
const EXCLUDED_STORAGE_KEYS = [...CREDENTIAL_STORAGE_KEYS, 'workspaces', 'active_workspace'];

// Keys holding PRIVATE KEY material, dropped from a shareable copy.
// `local_primary_identity` and `identity_profiles` carry the primary
// nsec(s); `local_keys` carries per-entity keys + the `xray:user` sync
// key. Everything else in a backup is content or plain config.
export const IDENTITY_STORAGE_KEYS = Object.freeze([
    'local_primary_identity', 'identity_profiles', 'local_keys'
]);

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

function clearAndFill(db, storeName, rows, normalize = null) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.clear();
        for (const row of rows) {
            const decoded = fromSerializable(row);
            store.put(normalize ? normalize(decoded) : decoded);
        }
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
    const normalizers = ROW_NORMALIZERS[name] || {};
    for (const [storeName, rows] of Object.entries(dump || {})) {
        if (!live.has(storeName)) {
            warn(`backup restore: store ${name}/${storeName} not in current schema — skipped`);
            continue;
        }
        await clearAndFill(db, storeName, rows === null ? [] : rows, normalizers[storeName] || null);
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

async function applyStorage(entries, warn = () => {}) {
    const ws = await activeWorkspaceId();
    const prefix = `ws:${ws}:`;
    const area = storageArea();
    const current = await areaGetAll(area);
    const mapK = (k) => (ws !== 'default' && WORKSPACE_CONTENT.has(k)) ? prefix + k : k;
    // Scope guard (T1 review, 2026-08-10): a file that carries no
    // signing identity — the delete-workspace snapshot, or a key-free
    // copy with its stamp stripped — must never take the identities
    // and install config DOWN with a replace-all it cannot re-fill.
    // When `local_primary_identity` is absent from the file, the
    // restore narrows to WORKSPACE CONTENT: content is replaced,
    // identity/config keys stay exactly as they are. The delete-flow
    // snapshot's "restorable into any workspace" promise depends on
    // this — restoring a snapshot used to erase the primary nsec,
    // every saved profile, preferences, and flags (the 2026-07-20
    // incident class, via a door the shareable refusal did not cover).
    const contentOnly = !Object.prototype.hasOwnProperty.call(entries || {}, 'local_primary_identity');
    if (contentOnly) {
        warn('the file carries no signing identity (a workspace snapshot or key-free copy) — '
            + 'workspace content was replaced; the identities, settings, and flags on this '
            + 'machine were left untouched');
    }
    const inScope = (bare) => !contentOnly || WORKSPACE_CONTENT.has(bare);
    // Replace-all WITHIN this workspace's logical scope: its own content
    // keys plus (identity-carrying files only) install config. Other
    // workspaces are untouchable.
    const toRemove = Object.keys(current).filter((k) => {
        if (EXCLUDED_STORAGE_KEYS.includes(k)) return false;
        if (k.startsWith('ws:')) {
            return ws !== 'default' && k.startsWith(prefix)
                && !EXCLUDED_STORAGE_KEYS.includes(k.slice(prefix.length))
                && inScope(k.slice(prefix.length));
        }
        if (ws !== 'default' && WORKSPACE_CONTENT.has(k)) return false;   // default ws's content
        return inScope(k);
    });
    if (toRemove.length) await areaRemove(area, toRemove);
    // Never write the excluded keys even if a hand-edited file smuggles them in.
    const clean = {};
    for (const [k, v] of Object.entries(entries || {})) {
        if (EXCLUDED_STORAGE_KEYS.includes(k)) {
            // Old backups (pre-B4) legitimately carry saved credentials.
            // Dropping one silently would read as "restored" — name it.
            if (CREDENTIAL_STORAGE_KEYS.includes(k)) {
                warn(`the file contains a saved credential (${k}); credentials never `
                    + 'restore — re-enter it under Settings ▸ Advanced');
            }
            continue;
        }
        if (!inScope(k)) continue;
        clean[mapK(k)] = v;
    }
    if (Object.keys(clean).length) await areaSet(area, clean);
}

// ---------------------------------------------------------------------------
// Public API

// The extension version writing this file — informational (the
// refusal gate below keys on database versions, which are mechanical).
// Null outside an extension context (Node tests).
function extensionVersion() {
    try {
        const api = (typeof browser !== 'undefined' && browser.runtime) ? browser
            : (typeof chrome !== 'undefined' && chrome.runtime ? chrome : null);
        const manifest = api && api.runtime.getManifest && api.runtime.getManifest();
        return (manifest && manifest.version) || null;
    } catch (_) { return null; }
}

// Each covered database's live IndexedDB version, via the owning
// module's opener (the DB_OPENERS principle — the opener IS the
// current schema version).
async function collectDbVersions() {
    const out = {};
    for (const name of WORKSPACE_DATABASES) {
        const db = await openCovered(name);
        out[name] = db.version;
    }
    return out;
}

/**
 * Build the full backup object.
 * @param {object} opts
 * @param {boolean} [opts.includeSourceBytes=true] include raw source-document
 *   bytes (PDF payloads etc.). Off → those stores are recorded as omitted.
 * @param {boolean} [opts.shareable=false] build a "shareable copy": the
 *   same file minus every private key (IDENTITY_STORAGE_KEYS) — the
 *   export the sharing/merge docs point at. Credentials are excluded
 *   from every export regardless. The file is stamped `shareable` and
 *   restore refuses it (merge is its path in).
 */
export async function collectBackup({ includeSourceBytes = true, shareable = false } = {}) {
    const databases = {};
    for (const name of WORKSPACE_DATABASES) {
        const skipStores = includeSourceBytes ? [] : (BYTE_STORES[name] || []);
        databases[name] = await dumpDatabase(name, { skipStores });
    }
    let storage = await collectStorage();
    if (shareable) {
        storage = Object.fromEntries(Object.entries(storage)
            .filter(([k]) => !IDENTITY_STORAGE_KEYS.includes(k)));
    }
    return {
        format: BACKUP_FORMAT,
        exportedAt: new Date().toISOString(),
        xrayVersion: extensionVersion(),
        dbVersions: await collectDbVersions(),
        includesSourceBytes: !!includeSourceBytes,
        ...(shareable ? { shareable: true } : {}),
        storage,
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
    const dbVersions = {};
    for (const base of WORKSPACE_DATABASES) {
        const db = await openRaw(workspaceDbName(base, ws)).catch(() => null);
        if (!db) { databases[base] = {}; continue; }
        dbVersions[base] = db.version;
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
        xrayVersion: extensionVersion(),
        dbVersions,
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

// Version pre-flight for restore AND merge, run BEFORE any write (the
// case-bundle.js importCaseBundle pattern, applied per database): a
// file written by a newer schema can hold rows this code's keyPaths/
// indexes cannot see, and both clearAndFill and mergeRows would plant
// them as silently-stranded data. Files without stamps (pre-T1) pass —
// they cannot be newer than the schema that has existed all along.
async function assertBackupNotNewer(backup) {
    const declared = backup && backup.dbVersions;
    if (!declared || typeof declared !== 'object') return;
    for (const name of WORKSPACE_DATABASES) {
        const theirs = Number(declared[name]);
        if (!Number.isFinite(theirs)) continue;
        const db = await openCovered(name);
        if (theirs > db.version) {
            const by = backup.xrayVersion ? `, written by X-Ray ${backup.xrayVersion}` : '';
            throw new Error(
                `Backup database "${name}" is v${theirs}${by} — newer than this `
                + `X-Ray understands (v${db.version}). Update X-Ray, then retry.`);
        }
    }
}

/**
 * Replace-all restore from a validated backup object.
 * Storage first (cheap, atomic-ish), then each database.
 */
export async function applyBackup(backup, { warn = () => {} } = {}) {
    const problems = validateBackup(backup);
    if (problems.length) throw new Error(`invalid backup: ${problems.join('; ')}`);
    if (backup.shareable) {
        throw new Error(
            'This file is a shareable copy — it holds no private keys, so a '
            + 'replace-all restore would ERASE the identities on this machine. '
            + 'Use "Import & merge" to bring its content in.');
    }
    await assertBackupNotNewer(backup);
    await applyStorage(backup.storage, warn);
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
//
// `article-extractions` deliberately is NOT here (MA.7). Its merge needs
// the LOCAL article body to re-locate every incoming quote, that body
// lives in a DIFFERENT IndexedDB database, and no lookup — sync or async
// — is possible from inside this one's transaction. It goes through
// MERGE_PLANNERS below instead, and this table is left without an entry
// on purpose: there is no code path that can reach the extraction merge
// without text, so trusting a foreign offset is not a mistake a future
// caller can make.
const DEEP_MERGE_STORES = {};

// Stores whose merge needs an ASYNC pre-resolution step before the
// transaction opens. The planner is handed a `runChunk` callback and
// drives the transactions itself, one chunk at a time.
const MERGE_PLANNERS = {
    'xray-audits': { 'article-extractions': mergeExtractionRows }
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
        if (EXCLUDED_STORAGE_KEYS.includes(k) || MERGE_EXCLUDED_KEYS.has(k) || !WORKSPACE_CONTENT.has(k)) {
            stats.keysSkippedNonContent += 1;   // config/identity/key material never merges
            continue;
        }
        const liveKey = mapK(k);
        const local = current[liveKey];
        if (local === undefined) {
            writes[liveKey] = v;
            stats.keysAdded += 1;
            // Count the RECORDS inside a wholly-new key too, or the
            // summary reports "1 item added" for a key carrying two
            // hundred claims (P12: the count must mean what it says).
            const decoded = decodeStorageValue(v);
            if (decoded) stats.idsAdded += Object.keys(decoded.obj).length;
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

function mergeRows(db, storeName, rows, deepMerge, normalize = null) {
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
                const decoded = fromSerializable(raw);
                const row = normalize ? normalize(decoded) : decoded;
                const key = row && row[keyPath];
                if (key === undefined || key === null) { stats.skipped += 1; continue; }
                const getReq = store.get(key);
                getReq.onsuccess = () => {
                    const existing = getReq.result;
                    // A deep merge runs on BOTH paths when present: it
                    // owns the decision to accept a brand-new row too
                    // (it may refuse — e.g. an extraction record whose
                    // key does not pin a text), so an add can never
                    // bypass its safety check.
                    if (deepMerge) {
                        const m = deepMerge(existing === undefined ? null : existing, row);
                        if (m && m.skipped) { stats.skipped += 1; return; }
                        if (m && m.changed) {
                            store.put(m.record);
                            if (existing === undefined) stats.added += 1;
                            else stats.merged += 1;
                        } else stats.kept += 1;
                        return;
                    }
                    if (existing === undefined) {
                        store.put(row);
                        stats.added += 1;
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

async function mergeIntoDatabase(name, dump, { warn = () => {}, onProgress = () => {} } = {}) {
    const db = await openCovered(name);
    const live = new Set(Array.from(db.objectStoreNames));
    const deep = DEEP_MERGE_STORES[name] || {};
    const planners = MERGE_PLANNERS[name] || {};
    const normalizers = ROW_NORMALIZERS[name] || {};
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
        // A planned store resolves what it needs (MA.7: the local article
        // bodies) BEFORE any transaction opens, then drives one
        // transaction per chunk through `mergeRows`. The row normalizer
        // is threaded through unchanged — a planned store gets the same
        // treatment as an unplanned one.
        const planner = planners[storeName];
        if (planner) {
            const plan = await planner(rows,
                (chunkRows, deepMerge) => mergeRows(db, storeName, chunkRows, deepMerge,
                    normalizers[storeName] || null),
                { onProgress: (p) => onProgress({ store: storeName, ...p }) });
            out[storeName] = { ...plan.stats, refusals: plan.refusals, unresolved: plan.unresolved };
            continue;
        }
        out[storeName] = await mergeRows(db, storeName, rows, deep[storeName] || null,
            normalizers[storeName] || null);
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
export async function mergeBackup(backup, { warn = () => {}, onProgress = () => {} } = {}) {
    const problems = validateBackup(backup);
    if (problems.length) throw new Error(`invalid backup: ${problems.join('; ')}`);
    await assertBackupNotNewer(backup);
    const storage = await mergeStorage(backup.storage);
    const databases = {};
    // A merge has NO cross-stage rollback: storage commits before the
    // databases, and each store commits in its own transaction. So a
    // later failure must never be reported as "nothing happened" — it
    // is collected per database and returned alongside what DID land,
    // and the caller states both (P12). Re-running the same file is
    // safe and idempotent, which is what makes partial completion
    // recoverable rather than corrupting.
    const errors = [];
    for (const [name, dump] of Object.entries(backup.databases || {})) {
        if (!WORKSPACE_DATABASES.includes(name)) {
            warn(`backup merge: database ${name} not covered — skipped`);
            continue;
        }
        try {
            databases[name] = await mergeIntoDatabase(name, dump, { warn, onProgress });
        } catch (err) {
            const message = (err && err.message) || String(err);
            errors.push({ database: name, error: message });
            warn(`backup merge: database ${name} failed — ${message}`);
        }
    }
    return { storage, databases, errors };
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

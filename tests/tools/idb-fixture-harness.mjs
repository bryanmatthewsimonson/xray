// Shared helpers for the golden IndexedDB fixtures — used by BOTH the
// generator (tests/tools/gen-idb-fixtures.mjs) and the generic test
// (tests/idb-fixtures.test.mjs), so the schema description, the raw
// open/seed/dump idiom and the DB_VERSION scanner are one code path.
//
// RESET_PLAN §7 R0 "Golden fixtures before any refactor thread starts"
// (audit finding WIRE-05, docs/audit-2026-09-05/wire-and-schema.md).
//
// Everything here opens IndexedDB RAW (indexedDB.open(name, N) with a
// hand-supplied schema) — never through a src/ module, whose opener
// would upgrade the database to HEAD. Nothing here calls deleteDatabase
// (fake-indexeddb honours versionchange blocking: it would hang behind
// a module's memoized handle).
//
// Provenance: INTERPRETATION (2026-09-08) — an agent artifact under
// RESET_PLAN R0; the maintainer has not ruled on it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURE_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'idb');

// The five IndexedDB-owning modules. The PATH is the only literal here:
// the database name and version are read from each file's source text
// (readDbConstants), so a DB_VERSION bump — or a DB_NAME change — is
// observed by the test rather than hard-coded in it.
export const DB_MODULES = Object.freeze([
    'src/shared/archive-cache.js',
    'src/shared/audit/audit-cache.js',
    'src/shared/event-journal.js',
    'src/portal/portal-cache.js',
    'src/network/network-cache.js'
]);

const DB_NAME_RE = /^const DB_NAME\s*=\s*'([^']+)';/m;
const DB_VERSION_RE = /^const DB_VERSION\s*=\s*(\d+);/m;

/** `{ module, db, version }` read from one module's source text. */
export function readDbConstants(modulePath) {
    const text = readFileSync(join(REPO_ROOT, modulePath), 'utf8');
    const name = text.match(DB_NAME_RE);
    const version = text.match(DB_VERSION_RE);
    if (!name || !version) {
        throw new Error(`${modulePath}: no parsable \`const DB_NAME = '...'\` / \`const DB_VERSION = N\``);
    }
    return { module: modulePath, db: name[1], version: Number(version[1]) };
}

export function readAllDbConstants() {
    return DB_MODULES.map(readDbConstants);
}

export function fixtureFileName(db, version) {
    return `${db}-v${version}.json`;
}

// ---------------------------------------------------------------------------
// Raw IndexedDB plumbing (promisified; no module involvement)

function factory() {
    const f = globalThis.indexedDB;
    if (!f) throw new Error('idb-fixture-harness: no indexedDB — import fake-indexeddb/auto first');
    return f;
}

export function req(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export function txDone(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('transaction aborted'));
    });
}

/**
 * Open `name` at exactly `version`; `onUpgrade(db, oldVersion, tx)` runs
 * inside the versionchange transaction when the database is created or
 * older. Rejects (VersionError) if the database is already NEWER.
 */
export function openRawAt(name, version, onUpgrade) {
    return new Promise((resolve, reject) => {
        let open;
        try { open = factory().open(name, version); }
        catch (err) { reject(err); return; }
        open.onupgradeneeded = (ev) => {
            try { onUpgrade(open.result, ev.oldVersion || 0, open.transaction); }
            catch (err) { reject(err); }
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
        open.onblocked = () => reject(new Error(`open ${name}@${version} blocked`));
    });
}

/** Versionless open: an EXISTING database at its current version, real schema, no upgrade. */
export function openRawVersionless(name) {
    return new Promise((resolve, reject) => {
        let open;
        try { open = factory().open(name); }
        catch (err) { reject(err); return; }
        open.onupgradeneeded = () => {
            // A versionless open that upgrades means the database did not
            // exist — the caller expected a seeded one.
            reject(new Error(`openRawVersionless(${name}): database did not exist`));
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
    });
}

// ---------------------------------------------------------------------------
// Schema description — the fixture's `schema` block

function sortByName(list) {
    return [...list].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * `{ <store>: { keyPath, autoIncrement, indexes: [{name, keyPath, unique}] } }`
 * for every object store of an open connection. Stores are emitted in
 * objectStoreNames order (sorted by IndexedDB), indexes sorted by name,
 * so two descriptions of the same schema are deep-equal.
 */
export function describeSchema(db) {
    const names = Array.from(db.objectStoreNames);
    const out = {};
    if (names.length === 0) return out;
    const transaction = db.transaction(names, 'readonly');
    for (const name of names) {
        const store = transaction.objectStore(name);
        const indexes = Array.from(store.indexNames).map((idx) => {
            const index = store.index(idx);
            return { name: index.name, keyPath: index.keyPath, unique: !!index.unique };
        });
        out[name] = {
            keyPath: store.keyPath,
            autoIncrement: !!store.autoIncrement,
            indexes: sortByName(indexes)
        };
    }
    return out;
}

/** Mint every store + index of a `schema` block on a database inside its versionchange transaction. */
export function createSchema(db, schema) {
    for (const [name, spec] of Object.entries(schema)) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, {
            keyPath: spec.keyPath,
            autoIncrement: !!spec.autoIncrement
        });
        for (const idx of spec.indexes || []) {
            store.createIndex(idx.name, idx.keyPath, { unique: !!idx.unique });
        }
    }
}

// ---------------------------------------------------------------------------
// Rows

export async function putRows(db, storeName, rows) {
    if (!rows.length) return;
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    for (const row of rows) store.put(row);
    await txDone(transaction);
}

export function getAllRows(db, storeName) {
    return req(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
}

export function indexGetAll(db, storeName, indexName, key) {
    return req(db.transaction(storeName, 'readonly').objectStore(storeName).index(indexName).getAll(key));
}

/**
 * Seed a fixture RAW under `name`: open at fixture.version, mint the
 * fixture's own schema block, put every row (already decoded by the
 * caller — `decode` is backup.js's fromSerializable), close. Returns
 * the version the database reported while open (the seed rung).
 */
export async function seedFixture(name, fixture, decode) {
    const db = await openRawAt(name, fixture.version, (target) => createSchema(target, fixture.schema));
    try {
        for (const [storeName, rows] of Object.entries(fixture.stores)) {
            await putRows(db, storeName, rows.map(decode));
        }
        return db.version;
    } finally {
        db.close();
    }
}

// ---------------------------------------------------------------------------
// Deterministic JSON

/** Rebuild a value with every object's keys sorted (arrays keep order). */
export function sortKeysDeep(value) {
    if (Array.isArray(value)) return value.map(sortKeysDeep);
    if (value && typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value).sort()) out[k] = sortKeysDeep(value[k]);
        return out;
    }
    return value;
}

/** Pretty JSON with sorted keys and a trailing newline — byte-stable across runs. */
export function stableStringify(value) {
    return JSON.stringify(sortKeysDeep(value), null, 2) + '\n';
}

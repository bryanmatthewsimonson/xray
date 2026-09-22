// Golden BACKUP fixtures — restore every checked-in `xray-backup/1` file
// through the CURRENT applyBackup, re-export it through collectBackup,
// and pin the round-trip invariants I1–I13 of the mapping pass's
// fixturePlan, plus a key-material hygiene sweep over the raw files.
//
// Pins (RESET_PLAN §7 R0 "Golden fixtures before any refactor thread
// starts"; audit finding WIRE-05 in docs/audit-2026-09-05/wire-and-
// schema.md — "zero persisted-shape fixtures"): a backup written by
// today's exporter must keep restoring byte-for-byte through any
// refactor of backup.js, the storage encoding, the row normalizers
// (normalizeImportedRow / normalizeExtractionRecord), the DB openers, or
// the WORKSPACE_CONTENT_KEYS boundary — and a DB_VERSION bump, a new
// object store, or a new content key without a regenerated fixture is a
// RED test, not a silent gap (I3 / I4 / I5).
//
// House idiom: a positive sanity test proves the loader sees the files
// and validateBackup accepts them, then the guards enforce. Order is
// load-bearing: fake-indexeddb/auto, then the Map-backed chrome.storage
// stub, then a DYNAMIC import of backup.js (storage.js probes
// chrome.storage at module load). Everything runs in the default
// workspace (bare DB names); no test switches active_workspace.
//
// Provenance: INTERPRETATION (2026-09-14) — an agent artifact under
// RESET_PLAN R0; the maintainer has not ruled on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

await import('fake-indexeddb/auto');

const _stateStore = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
                if (keys === null) { cb(Object.fromEntries(_stateStore)); return; }
                const out = {};
                for (const k of Array.isArray(keys) ? keys : [keys]) {
                    if (_stateStore.has(k)) out[k] = _stateStore.get(k);
                }
                cb(out);
            },
            set(obj, cb) {
                for (const [k, v] of Object.entries(obj)) _stateStore.set(k, v);
                cb && cb();
            },
            remove(keys, cb) {
                for (const k of Array.isArray(keys) ? keys : [keys]) _stateStore.delete(k);
                cb && cb();
            }
        }
    },
    // Non-null xrayVersion on collect, so the stamp path (not the null
    // fallback) is what the round trip exercises.
    runtime: { getManifest() { return { version: '0.0.0-test' }; } }
};

const {
    BACKUP_FORMAT, collectBackup, applyBackup, mergeBackup, validateBackup,
    fromSerializable, CREDENTIAL_STORAGE_KEYS, IDENTITY_STORAGE_KEYS
} = await import('../src/shared/backup.js');
const { WORKSPACE_CONTENT_KEYS, WORKSPACE_DATABASES } = await import('../src/shared/workspace-keys.js');
const { openArchiveDb, SOURCE_DOCS_STORE } = await import('../src/shared/archive-cache.js');
const { openAuditDb } = await import('../src/shared/audit/audit-cache.js');
const journal = await import('../src/shared/event-journal.js');
const { normalizeExtractionRecord } = await import('../src/shared/map-artifacts.js');
const { replaceableKey } = await import('../src/shared/nostr-events.js');
const { Crypto } = await import('../src/shared/crypto.js');
const { readAllDbConstants, sortKeysDeep } = await import('./tools/idb-fixture-harness.mjs');
const {
    TV1, TEST_KEYS, ALLOWED_PRIVATE_KEYS, ALLOWED_PUBKEYS, ALLOWED_NSECS, FIXED_ISO
} = await import('./tools/fixture-keys.mjs');
const generator = await import('./tools/gen-backup-fixtures.mjs');

const { FIXTURE_DIR, FIXTURE_FILES, STAMPED_FILES, FIXTURE_XRAY_VERSION, PDF_BYTES, emptyWorkspace } = generator;

const DB_OPENERS = {
    'xray-archive': openArchiveDb,
    'xray-audits': openAuditDb,
    'xray-events': journal.openEventJournalDb
};

// ------------------------------------------------------------------
// Loading
// ------------------------------------------------------------------

const rawText = {};
const fixtures = {};
for (const file of FIXTURE_FILES) {
    const path = join(FIXTURE_DIR, file);
    if (!existsSync(path)) continue;
    rawText[file] = readFileSync(path, 'utf8');
    fixtures[file] = JSON.parse(rawText[file]);
}
const FULL = fixtures['full-v1.json'];
const SHAREABLE = fixtures['shareable-v1.json'];
const BYTES_OMITTED = fixtures['bytes-omitted-v1.json'];
const LEGACY = fixtures['legacy-prestamp.json'];

/** Replace-all restore of a fixture; returns the warn channel. */
async function restore(fixture) {
    const warnings = [];
    await applyBackup(fixture, { warn: (m) => warnings.push(m) });
    return warnings;
}

/** Re-export with the fixture's own bytes setting. */
function reexport(fixture) {
    return collectBackup({ includeSourceBytes: fixture.includesSourceBytes !== false });
}

/** Canonical JSON with the two environment stamps removed. */
function canon(backup) {
    const { exportedAt, xrayVersion, ...rest } = backup;
    return JSON.stringify(sortKeysDeep(rest));
}

function idbGetAll(db, storeName) {
    return new Promise((resolve, reject) => {
        const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

async function liveStoreNames(dbName) {
    const db = await DB_OPENERS[dbName]();
    return Array.from(db.objectStoreNames).sort();
}

// ------------------------------------------------------------------
// Sanity
// ------------------------------------------------------------------

test('sanity: all four fixture files exist, parse, and pass validateBackup', () => {
    for (const file of FIXTURE_FILES) {
        assert.ok(fixtures[file], `${file} missing — run: node ${generator.GENERATOR}`);
        assert.deepEqual(validateBackup(fixtures[file]), [], `${file} validates`);
        assert.equal(fixtures[file].format, BACKUP_FORMAT, `${file} format`);
        assert.ok(rawText[file].endsWith('\n'), `${file} ends with a newline`);
        assert.equal(rawText[file], JSON.stringify(sortKeysDeep(fixtures[file]), null, 2) + '\n',
            `${file} is sorted-key pretty JSON`);
    }
    for (const file of STAMPED_FILES) {
        const f = fixtures[file];
        assert.equal(f.exportedAt, FIXED_ISO, `${file} exportedAt is the fixed stamp`);
        assert.equal(f.xrayVersion, FIXTURE_XRAY_VERSION, `${file} xrayVersion is the fixture stamp`);
        assert.equal(typeof f.includesSourceBytes, 'boolean', `${file} includesSourceBytes is boolean`);
        assert.deepEqual(Object.keys(f.dbVersions).sort(), [...WORKSPACE_DATABASES].sort(), `${file} dbVersions covers every DB`);
        assert.deepEqual(Object.keys(f.databases).sort(), [...WORKSPACE_DATABASES].sort(), `${file} databases covers every DB`);
    }
    assert.equal(FULL.includesSourceBytes, true);
    assert.equal(BYTES_OMITTED.includesSourceBytes, false);
    assert.equal(SHAREABLE.shareable, true);
    assert.ok(!('shareable' in FULL), 'full-v1 carries no shareable stamp');
    assert.ok(!('dbVersions' in LEGACY) && !('xrayVersion' in LEGACY) && !('includesSourceBytes' in LEGACY),
        'legacy-prestamp carries none of the T1 stamps');
});

// ------------------------------------------------------------------
// I1 – I11: full-v1 round trip
// ------------------------------------------------------------------

test('I1 full-v1 restores with an EMPTY warn channel', async () => {
    const warnings = await restore(FULL);
    assert.deepEqual(warnings, [], 'no scope narrowing, dropped rows, skipped stores, or credential warns');
});

test('I2 re-export keeps format, includesSourceBytes, and no shareable stamp', async () => {
    await restore(FULL);
    const C = await reexport(FULL);
    assert.equal(C.format, BACKUP_FORMAT);
    assert.equal(C.includesSourceBytes, FULL.includesSourceBytes);
    assert.ok(!('shareable' in C));
    assert.equal(C.xrayVersion, '0.0.0-test', 'xrayVersion is the running environment\'s, not the file\'s');
});

test('I3 dbVersions: live >= every fixture, and EQUAL to the newest fixture per DB (a DB_VERSION bump needs a new fixture)', async () => {
    await restore(FULL);
    const C = await reexport(FULL);
    const newest = {};
    for (const file of STAMPED_FILES) {
        for (const db of WORKSPACE_DATABASES) {
            const theirs = fixtures[file].dbVersions[db];
            assert.ok(Number.isInteger(theirs) && theirs >= 1, `${file} dbVersions[${db}] is a version`);
            assert.ok(C.dbVersions[db] >= theirs, `${file}: live ${db} v${C.dbVersions[db]} >= fixture v${theirs}`);
            newest[db] = Math.max(newest[db] || 0, theirs);
        }
    }
    const fromSource = Object.fromEntries(readAllDbConstants().map((c) => [c.db, c.version]));
    for (const db of WORKSPACE_DATABASES) {
        assert.equal(C.dbVersions[db], newest[db],
            `${db}: live DB_VERSION v${C.dbVersions[db]} has no fixture — regenerate tests/fixtures/backup (node ${generator.GENERATOR})`);
        assert.equal(newest[db], fromSource[db], `${db}: the fixture version equals the module's DB_VERSION constant`);
    }
});

test('I4 every fixture covers exactly the live object stores of every covered DB, each with rows', async () => {
    for (const file of STAMPED_FILES) {
        const f = fixtures[file];
        for (const db of WORKSPACE_DATABASES) {
            assert.deepEqual(Object.keys(f.databases[db]).sort(), await liveStoreNames(db),
                `${file}: ${db} store set equals the opener's objectStoreNames`);
            for (const [store, rows] of Object.entries(f.databases[db])) {
                if (file === 'bytes-omitted-v1.json' && db === 'xray-archive' && store === SOURCE_DOCS_STORE) {
                    assert.equal(rows, null, `${file}: ${store} recorded as null (bytes omitted)`);
                    continue;
                }
                assert.ok(Array.isArray(rows) && rows.length >= 1, `${file}: ${db}/${store} has >= 1 row`);
            }
        }
    }
});

test('I5 storage key coverage: every content key present; identity keys in full, absent in shareable', () => {
    for (const file of STAMPED_FILES) {
        for (const key of WORKSPACE_CONTENT_KEYS) {
            if (file === 'shareable-v1.json' && IDENTITY_STORAGE_KEYS.includes(key)) continue;
            assert.ok(key in fixtures[file].storage, `${file}: content key ${key} present — new content key needs a regenerated fixture`);
            const decoded = JSON.parse(fixtures[file].storage[key]);
            assert.ok(decoded && typeof decoded === 'object' && !Array.isArray(decoded) && Object.keys(decoded).length >= 1,
                `${file}: ${key} is a JSON-string id→record map with >= 1 id`);
        }
        assert.ok('preferences' in fixtures[file].storage && 'xray:flags' in fixtures[file].storage, `${file}: install config rides`);
    }
    for (const key of IDENTITY_STORAGE_KEYS) {
        assert.ok(key in FULL.storage, `full-v1 carries ${key}`);
        assert.ok(key in BYTES_OMITTED.storage, `bytes-omitted-v1 carries ${key}`);
        assert.ok(!(key in SHAREABLE.storage), `shareable-v1 lacks ${key}`);
    }
    // The identity shapes are the modules' REAL shapes, keyed by the vector keys.
    const primary = JSON.parse(FULL.storage.local_primary_identity);
    assert.deepEqual(Object.keys(primary).sort(), ['created', 'npub', 'nsec', 'privateKey', 'pubkey']);
    assert.equal(primary.pubkey, TV1.pubkey);
    const profiles = JSON.parse(FULL.storage.identity_profiles);
    assert.deepEqual(Object.keys(profiles), [TV1.pubkey], 'identity_profiles keyed by pubkey');
    const keys = JSON.parse(FULL.storage.local_keys);
    assert.ok('xray:user' in keys, 'local_keys carries the xray:user sync key');
    for (const [name, kd] of Object.entries(keys)) {
        assert.equal(kd.name, name);
        assert.deepEqual(Object.keys(kd).sort(), ['created', 'metadata', 'name', 'npub', 'nsec', 'privateKey', 'pubkey']);
    }
    assert.deepEqual(JSON.parse(FULL.storage.preferences).default_relays, ['wss://relay.example']);
});

test('I6 storage values are byte-identical after apply → collect, and the key set is equal', async () => {
    await restore(FULL);
    const C = await reexport(FULL);
    assert.deepEqual(Object.keys(C.storage).sort(), Object.keys(FULL.storage).sort());
    for (const k of Object.keys(FULL.storage)) {
        assert.equal(C.storage[k], FULL.storage[k], `storage[${k}] byte-identical`);
    }
});

test('I7 every store of every DB is deep-equal after the round trip (keyPath order)', async () => {
    await restore(FULL);
    const C = await reexport(FULL);
    for (const db of WORKSPACE_DATABASES) {
        for (const [store, rows] of Object.entries(FULL.databases[db])) {
            assert.deepEqual(C.databases[db][store], rows, `${db}/${store} round-trips`);
        }
    }
    assert.equal(canon(C), canon(FULL), 'the whole file round-trips modulo exportedAt/xrayVersion');
});

test('I8 normalizers are identities on the fixture rows', () => {
    const extractions = FULL.databases['xray-audits']['article-extractions'];
    assert.ok(extractions.length >= 1);
    for (const row of extractions) {
        assert.deepEqual(normalizeExtractionRecord(row), row, 'article-extractions row is pre-normalized');
        assert.match(row.articleHash, /^[0-9a-f]{64}$/, 'text-pinned key');
    }
    const articleHashes = new Set(FULL.databases['xray-archive'].articles.map((a) => a.articleHash));
    for (const row of extractions) {
        assert.ok(articleHashes.has(row.articleHash), 'the extraction shares its articleHash with an articles row');
    }
    for (const row of FULL.databases['xray-events'].published_events) {
        assert.equal(journal.normalizeImportedRow(row), row, 'v2-shaped journal row passes through verbatim');
        assert.ok(['pending', 'flushed', 'held'].includes(row.flush.state));
    }
    const states = FULL.databases['xray-events'].published_events.map((r) => r.flush.state).sort();
    assert.deepEqual(states, ['flushed', 'pending'], 'one flushed and one pending row');
});

test('I9 every journal event is REALLY signed by the fixture primary and self-consistent', async () => {
    for (const row of FULL.databases['xray-events'].published_events) {
        assert.equal(await Crypto.verifySignature(row.event), true, `event ${row.eventId} verifies`);
        assert.equal(row.event.id, await Crypto.getEventHash(row.event));
        assert.equal(row.eventId, row.event.id);
        assert.equal(row.pubkey, TV1.pubkey);
        assert.equal(row.event.pubkey, TV1.pubkey);
        assert.equal(row.address, replaceableKey(row.event), 'address under the v2 rule');
    }
    assert.equal(await Crypto.verifySignature(LEGACY.databases['xray-events'].published_events[0].event), true,
        'the legacy v1 row\'s event verifies too');
});

test('I10 source-document bytes decode to the known payload and restore as an ArrayBuffer', async () => {
    const row = FULL.databases['xray-archive'][SOURCE_DOCS_STORE][0];
    assert.equal(typeof row.bytes.__xrayBytes, 'string', 'bytes carried as the marker');
    assert.deepEqual(new Uint8Array(fromSerializable(row.bytes)), PDF_BYTES);
    assert.equal(row.size, PDF_BYTES.length);
    await restore(FULL);
    const live = await idbGetAll(await openArchiveDb(), SOURCE_DOCS_STORE);
    assert.equal(live.length, 1);
    assert.ok(live[0].bytes instanceof ArrayBuffer, 'restored bytes are an ArrayBuffer');
    assert.deepEqual(new Uint8Array(live[0].bytes), PDF_BYTES);
});

test('I11 stability: apply(C) → C2 equals C modulo the environment stamps', async () => {
    await restore(FULL);
    const C = await reexport(FULL);
    const warnings = await restore(C);
    assert.deepEqual(warnings, []);
    const C2 = await reexport(FULL);
    assert.equal(canon(C2), canon(C));
});

// ------------------------------------------------------------------
// I12: shareable + merge semantics on golden data
// ------------------------------------------------------------------

test('I12a applyBackup(shareable-v1) is refused and storage is untouched', async () => {
    await restore(FULL);
    const before = JSON.stringify(sortKeysDeep(Object.fromEntries(_stateStore)));
    await assert.rejects(() => applyBackup(SHAREABLE), /shareable copy/);
    assert.equal(JSON.stringify(sortKeysDeep(Object.fromEntries(_stateStore))), before);
});

test('I12b shareable-v1 is full-v1 minus the identity keys, with identical databases', () => {
    const expected = Object.fromEntries(Object.entries(FULL.storage).filter(([k]) => !IDENTITY_STORAGE_KEYS.includes(k)));
    assert.deepEqual(SHAREABLE.storage, expected);
    assert.deepEqual(SHAREABLE.databases, FULL.databases);
    assert.deepEqual(SHAREABLE.dbVersions, FULL.dbVersions);
});

test('I12c mergeBackup(shareable-v1) into an EMPTY workspace lands every content key verbatim and installs no identity or config', async () => {
    await emptyWorkspace();
    const warnings = [];
    const summary = await mergeBackup(SHAREABLE, { warn: (m) => warnings.push(m) });
    assert.deepEqual(warnings, []);
    assert.deepEqual(summary.errors, []);
    const C = await collectBackup();
    const contentKeys = Object.keys(SHAREABLE.storage).filter((k) => WORKSPACE_CONTENT_KEYS.includes(k));
    assert.ok(contentKeys.length >= WORKSPACE_CONTENT_KEYS.length - 1, 'every content key but local_keys rides in the shareable copy');
    for (const k of contentKeys) assert.equal(C.storage[k], SHAREABLE.storage[k], `${k} landed verbatim`);
    assert.equal(summary.storage.keysAdded, contentKeys.length);
    for (const k of IDENTITY_STORAGE_KEYS) assert.ok(!(k in C.storage), `${k} absent after merge`);
    assert.ok(!('preferences' in C.storage) && !('xray:flags' in C.storage), 'install config never merges');
    for (const db of WORKSPACE_DATABASES) {
        for (const [store, rows] of Object.entries(SHAREABLE.databases[db])) {
            assert.equal(summary.databases[db][store].added, rows.length, `${db}/${store} rows all added`);
            assert.equal(summary.databases[db][store].skipped, 0);
        }
    }
    const ex = summary.databases['xray-audits']['article-extractions'];
    assert.equal(ex.refusals.noLocalText, 0, 'the article body arrived first (xray-archive merges before xray-audits)');
    assert.equal(ex.refusals.regroundedQuotes, FULL.databases['xray-audits']['article-extractions'][0].assertions.length,
        'every quote re-located in the local body');
});

test('I12d mergeBackup(full-v1) after applyBackup(full-v1) is a fixed point: zero adds everywhere, twice', async () => {
    await restore(FULL);
    const C1 = canon(await reexport(FULL));
    for (const pass of [1, 2]) {
        const warnings = [];
        const s = await mergeBackup(FULL, { warn: (m) => warnings.push(m) });
        assert.deepEqual(warnings, [], `pass ${pass}: no warnings`);
        assert.deepEqual(s.errors, []);
        assert.equal(s.storage.keysAdded, 0, `pass ${pass}`);
        assert.equal(s.storage.keysMerged, 0, `pass ${pass}`);
        assert.equal(s.storage.idsAdded, 0, `pass ${pass}`);
        for (const db of WORKSPACE_DATABASES) {
            for (const [store, rows] of Object.entries(FULL.databases[db])) {
                const st = s.databases[db][store];
                assert.equal(st.added, 0, `pass ${pass}: ${db}/${store} added`);
                assert.equal(st.merged, 0, `pass ${pass}: ${db}/${store} merged`);
                assert.equal(st.kept, rows.length, `pass ${pass}: ${db}/${store} all kept`);
                assert.equal(st.skipped, 0, `pass ${pass}: ${db}/${store} skipped`);
            }
        }
        const ex = s.databases['xray-audits']['article-extractions'];
        assert.equal(ex.refusals.unlocatedQuotes, 0, `pass ${pass}: every quote located`);
        assert.equal(canon(await reexport(FULL)), C1, `pass ${pass}: state unchanged`);
    }
});

// ------------------------------------------------------------------
// I13: credentials
// ------------------------------------------------------------------

test('I13 a live credential survives applyBackup(full-v1) untouched and is absent from the export', async () => {
    const credKey = CREDENTIAL_STORAGE_KEYS[0];
    await restore(FULL);
    _stateStore.set(credKey, 'sk-ant-LIVE-NEVER-EXPORT');
    const warnings = await restore(FULL);
    assert.deepEqual(warnings, []);
    assert.equal(_stateStore.get(credKey), 'sk-ant-LIVE-NEVER-EXPORT', 'credential preserved by the replace-all');
    const C = await reexport(FULL);
    assert.ok(!(credKey in C.storage), 'credential absent from the export');
    assert.equal(canon(C), canon(FULL), 'and the export is otherwise unchanged');
    const S = await collectBackup({ shareable: true });
    assert.ok(!(credKey in S.storage));
    _stateStore.delete(credKey);
});

// ------------------------------------------------------------------
// bytes-omitted-v1 and legacy-prestamp
// ------------------------------------------------------------------

test('bytes-omitted-v1: a null store restores EMPTY, re-collects as [] with bytes on, and merge reports omitted', async () => {
    await restore(FULL);
    const warnings = await restore(BYTES_OMITTED);
    assert.deepEqual(warnings, []);
    const live = await idbGetAll(await openArchiveDb(), SOURCE_DOCS_STORE);
    assert.deepEqual(live, [], 'source_documents cleared and left empty');
    const withBytes = await collectBackup({ includeSourceBytes: true });
    assert.deepEqual(withBytes.databases['xray-archive'][SOURCE_DOCS_STORE], [], 'null re-collects as []');
    const without = await reexport(BYTES_OMITTED);
    assert.equal(canon(without), canon(BYTES_OMITTED), 'everything else round-trips');
    const s = await mergeBackup(BYTES_OMITTED);
    assert.equal(s.databases['xray-archive'][SOURCE_DOCS_STORE].omitted, true);
    // The bytes-omitted file is full-v1 with ONE store nulled — nothing else.
    const expected = { ...FULL, includesSourceBytes: false,
        databases: { ...FULL.databases, 'xray-archive': { ...FULL.databases['xray-archive'], [SOURCE_DOCS_STORE]: null } } };
    assert.equal(canon(BYTES_OMITTED), canon(expected));
});

test('legacy-prestamp: an unstamped file restores; the v1 journal row migrates; a raw-object storage value survives', async () => {
    await restore(FULL);
    const before = Math.floor(Date.now() / 1000);
    const warnings = await restore(LEGACY);
    assert.deepEqual(warnings, [], 'carries local_primary_identity, so no scope narrowing');
    const v1 = LEGACY.databases['xray-events'].published_events[0];
    assert.ok(!v1.flush, 'fixture row is v1-shaped');
    const row = await journal.getByEventId(v1.eventId);
    assert.equal(row.flush.state, 'pending', 'assumed-only v1 row → pending');
    assert.equal(row.signedAt, v1.publishedAt, 'signedAt backfilled from publishedAt');
    assert.equal(row.address, replaceableKey(v1.event), 'address recomputed under the v2 rule');
    assert.ok(row.flush.nextAttemptAt >= before + journal.MIGRATION_DEFER_S - 5, 'deferred by the migration ceiling');
    assert.equal(row.ledger, null);
    const C = await collectBackup();
    assert.deepEqual(C.storage.article_claims, LEGACY.storage.article_claims, 'raw object restored raw');
    assert.equal(typeof C.storage.article_claims, 'object');
    assert.deepEqual(C.databases['xray-archive'].articles, LEGACY.databases['xray-archive'].articles);
    assert.deepEqual(C.databases['xray-audits'].runs, FULL.databases['xray-audits'].runs,
        'a store absent from the file is left as it was');
});

test('legacy-prestamp merges into a full-v1 workspace: the raw-object claim map accrues by id into the string-encoded local', async () => {
    await restore(FULL);
    const s = await mergeBackup(LEGACY);
    assert.deepEqual(s.errors, []);
    assert.equal(s.storage.keysMerged, 1);
    assert.equal(s.storage.idsAdded, Object.keys(LEGACY.storage.article_claims).length);
    assert.equal(s.storage.keysSkippedNonContent, 2, 'preferences + local_primary_identity never merge');
    const local = _stateStore.get('article_claims');
    assert.equal(typeof local, 'string', 'local encoding kept');
    const ids = Object.keys(JSON.parse(local));
    for (const id of Object.keys(JSON.parse(FULL.storage.article_claims))) assert.ok(ids.includes(id));
    for (const id of Object.keys(LEGACY.storage.article_claims)) assert.ok(ids.includes(id));
    assert.equal(s.databases['xray-archive'].articles.added, 1);
    assert.equal(s.databases['xray-events'].published_events.added, 1);
    const row = await journal.getByEventId(LEGACY.databases['xray-events'].published_events[0].eventId);
    assert.equal(row.flush.state, 'pending', 'v1 row normalized on the way in');
});

// ------------------------------------------------------------------
// Hygiene over the RAW fixture text
// ------------------------------------------------------------------

const ALLOWED_NPUBS = TEST_KEYS.map((k) => k.npub);
const ALLOWED_HOSTS = ['example.com', 'example.org', 'relay.example'];
// Matches `"pubkey": "…"` at the outer JSON level AND `\"pubkey\":\"…\"`
// inside the wrapper's JSON-string storage values.
const KEY_FIELD_RE = /\\?"(pubkey|privateKey|nsec|npub)\\?":\s*\\?"([0-9a-zA-Z]*)\\?"/g;
const URL_RE = /(?:https?|wss?):\/\/([^/"'\s\\?#:]+)/g;

test('hygiene: every key-material field in every fixture is one of the three BIP-340 vector keys', () => {
    let seen = 0;
    for (const [file, text] of Object.entries(rawText)) {
        for (const m of text.matchAll(KEY_FIELD_RE)) {
            seen += 1;
            const [, field, value] = m;
            const allowed = field === 'pubkey' ? ALLOWED_PUBKEYS
                : field === 'privateKey' ? ALLOWED_PRIVATE_KEYS
                    : field === 'nsec' ? ALLOWED_NSECS : ALLOWED_NPUBS;
            assert.ok(allowed.includes(value), `${file}: ${field} ${value.slice(0, 12)}… is not a vector key`);
        }
        for (const m of text.matchAll(/nsec1[a-z0-9]{58}/g)) {
            assert.ok(ALLOWED_NSECS.includes(m[0]), `${file}: stray nsec ${m[0].slice(0, 12)}…`);
        }
        for (const m of text.matchAll(/npub1[a-z0-9]{58}/g)) {
            assert.ok(ALLOWED_NPUBS.includes(m[0]), `${file}: stray npub ${m[0].slice(0, 12)}…`);
        }
    }
    assert.ok(seen >= 20, `the scanner sees key fields (saw ${seen})`);
    // Positive: the full file really carries all three keys (else the allowlist proves nothing).
    for (const k of TEST_KEYS) assert.ok(rawText['full-v1.json'].includes(k.privateKey), `full-v1 carries scalar ${k.scalar}`);
});

test('hygiene: no credential key, secret marker, install-plumbing key, or non-RFC-2606 host in any fixture', () => {
    for (const [file, text] of Object.entries(rawText)) {
        const keys = Object.keys(fixtures[file].storage);
        for (const k of CREDENTIAL_STORAGE_KEYS) assert.ok(!keys.includes(k), `${file}: carries credential key ${k}`);
        for (const k of ['workspaces', 'active_workspace', 'xray:diagnostics']) assert.ok(!keys.includes(k), `${file}: carries ${k}`);
        for (const marker of ['sk-ant-', 'hf_', 'aai-', 'dg-']) assert.ok(!text.includes(marker), `${file}: contains ${marker}`);
        let urls = 0;
        for (const m of text.matchAll(URL_RE)) {
            urls += 1;
            assert.ok(ALLOWED_HOSTS.includes(m[1]), `${file}: URL host ${m[1]} is not an RFC 2606 host`);
        }
        assert.ok(urls >= 1, `${file}: the URL scanner sees URLs`);
    }
});

// ------------------------------------------------------------------
// Determinism
// ------------------------------------------------------------------

test('determinism: the generator regenerates every fixture in memory and they deep-equal the checked-in files', async () => {
    const built = await generator.buildAllFixtures();
    assert.deepEqual([...built.keys()].sort(), [...FIXTURE_FILES].sort());
    for (const [file, fixture] of built) {
        assert.deepEqual(fixture, fixtures[file], `${file} is stale — run: node ${generator.GENERATOR}`);
    }
    // Leave the workspace as full-v1 restores it.
    await restore(FULL);
});

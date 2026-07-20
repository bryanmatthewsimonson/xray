// Full-workspace backup/restore (backup.js). Load-bearing pins:
// `xray:llm:key` NEVER appears in a backup (and survives a restore
// untouched), restore is replace-all and byte-identical for storage
// values, and source-document bytes survive the base64 round trip.

import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('fake-indexeddb/auto');

// storage.js (pulled in via identity-profiles.js) touches chrome.storage
// at module load; stub it first. Callback-style, like the real API.
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
    }
};

const {
    BACKUP_FORMAT, collectBackup, applyBackup, validateBackup,
    estimateBackupSize, toSerializable, fromSerializable,
    dumpDatabase
} = await import('../src/shared/backup.js');
const { openArchiveDb, SOURCE_DOCS_STORE } = await import('../src/shared/archive-cache.js');
const { openAuditDb } = await import('../src/shared/audit/audit-cache.js');
const { recordPublished, countAll, clear: clearJournal } = await import('../src/shared/event-journal.js');

// ------------------------------------------------------------------
// Seeding helpers
// ------------------------------------------------------------------

function idbPut(db, storeName, row) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(row);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

function idbGetAll(db, storeName) {
    return new Promise((resolve, reject) => {
        const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

function idbClearAllStores(db) {
    const names = Array.from(db.objectStoreNames);
    if (!names.length) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(names, 'readwrite');
        for (const n of names) tx.objectStore(n).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x00, 0xff, 0x80, 0x7f]);

async function seedWorkspace() {
    _stateStore.clear();
    _stateStore.set('preferences', JSON.stringify({ debug: false, default_relays: ['wss://a.example'] }));
    _stateStore.set('article_claims', JSON.stringify({ 'https://example.com/a': [{ id: 'claim_1' }] }));
    _stateStore.set('local_primary_identity', JSON.stringify({ nsec: 'nsec1testonly', pubkey: 'p'.repeat(64) }));
    _stateStore.set('xray:llm:key', 'sk-ant-SECRET-NEVER-EXPORT');

    const archive = await openArchiveDb();
    await idbClearAllStores(archive);
    await idbPut(archive, 'articles', {
        urlHash: 'h1', url: 'https://example.com/a', title: 'A', markdown: '# A',
        publishedToRelay: true, publishedEventId: 'e'.repeat(64)
    });
    await idbPut(archive, SOURCE_DOCS_STORE, {
        hash: 'doc1', bytes: PDF_BYTES.buffer.slice(0), mime: 'application/pdf',
        url: 'https://example.com/a.pdf', size: PDF_BYTES.length, fetchedAt: 1700000000
    });

    const audits = await openAuditDb();
    await idbClearAllStores(audits);
    await idbPut(audits, 'runs', { id: 'run_1', articleHash: 'ah1', modules: [] });

    await clearJournal();
    await recordPublished(
        {
            id: 'e'.repeat(64), sig: 's'.repeat(128), kind: 30023,
            pubkey: 'p'.repeat(64), created_at: 1700000000,
            tags: [['d', 'article-1']], content: '# A'
        },
        { successful: 1, confirmed: 1, failed: 0, total: 1, results: [{ url: 'wss://a.example', success: true, assumed: false }] },
        { articleUrl: 'https://example.com/a' }
    );
}

// ------------------------------------------------------------------
// Bytes walker
// ------------------------------------------------------------------

test('toSerializable/fromSerializable round-trip nested binary', () => {
    const src = {
        plain: 'text', n: 7, list: [1, { deep: new Uint8Array([1, 2, 3]) }],
        buf: PDF_BYTES.buffer.slice(0), nothing: null
    };
    const wire = toSerializable(src);
    assert.equal(typeof wire.list[1].deep.__xrayBytes, 'string', 'TypedArray → marker');
    assert.equal(typeof wire.buf.__xrayBytes, 'string', 'ArrayBuffer → marker');
    const parsed = fromSerializable(JSON.parse(JSON.stringify(wire)));
    assert.deepEqual(new Uint8Array(parsed.buf), PDF_BYTES, 'bytes survive JSON');
    assert.deepEqual(new Uint8Array(parsed.list[1].deep), new Uint8Array([1, 2, 3]));
    assert.equal(parsed.plain, 'text');
    assert.equal(parsed.nothing, null);
});

// ------------------------------------------------------------------
// Collect
// ------------------------------------------------------------------

test('collectBackup: covers storage + all three databases; NEVER the LLM key', async () => {
    await seedWorkspace();
    const backup = await collectBackup({ includeSourceBytes: true });

    assert.equal(backup.format, BACKUP_FORMAT);
    assert.equal(backup.includesSourceBytes, true);
    assert.ok(backup.storage.preferences, 'storage captured');
    assert.ok(backup.storage.local_primary_identity, 'identity (incl. nsec) captured by decision');
    assert.equal(backup.storage['xray:llm:key'], undefined, 'LLM key excluded');
    assert.ok(!JSON.stringify(backup).includes('sk-ant-SECRET'), 'LLM key nowhere in the file');

    assert.deepEqual(Object.keys(backup.databases).sort(), ['xray-archive', 'xray-audits', 'xray-events']);
    assert.equal(backup.databases['xray-archive'].articles.length, 1);
    assert.equal(backup.databases['xray-audits'].runs.length, 1);
    assert.equal(backup.databases['xray-events'].published_events.length, 1);
    const doc = backup.databases['xray-archive'][SOURCE_DOCS_STORE][0];
    assert.equal(typeof doc.bytes.__xrayBytes, 'string', 'source bytes base64-marked');
});

test('collectBackup with includeSourceBytes=false marks the store omitted (null)', async () => {
    await seedWorkspace();
    const backup = await collectBackup({ includeSourceBytes: false });
    assert.equal(backup.includesSourceBytes, false);
    assert.equal(backup.databases['xray-archive'][SOURCE_DOCS_STORE], null, 'deliberate omission, not data loss');
    assert.equal(backup.databases['xray-archive'].articles.length, 1, 'articles still included');
});

// ------------------------------------------------------------------
// Restore
// ------------------------------------------------------------------

test('applyBackup: replace-all restore; LLM key preserved from the live profile', async () => {
    await seedWorkspace();
    const backup = JSON.parse(JSON.stringify(await collectBackup({ includeSourceBytes: true })));

    // Mutate everything: new storage state, extra DB rows.
    _stateStore.clear();
    _stateStore.set('preferences', JSON.stringify({ debug: true }));
    _stateStore.set('stray_key', JSON.stringify('should vanish'));
    _stateStore.set('xray:llm:key', 'sk-ant-CURRENT-KEY');
    const archive = await openArchiveDb();
    await idbPut(archive, 'articles', { urlHash: 'h2', url: 'https://example.com/b', title: 'B' });

    await applyBackup(backup);

    assert.equal(_stateStore.get('preferences'), backup.storage.preferences, 'byte-identical storage restore');
    assert.equal(_stateStore.has('stray_key'), false, 'replace-all: keys not in the backup vanish');
    assert.equal(_stateStore.get('xray:llm:key'), 'sk-ant-CURRENT-KEY', 'live LLM key untouched');

    const archive2 = await openArchiveDb();
    const articles = await idbGetAll(archive2, 'articles');
    assert.deepEqual(articles.map((a) => a.urlHash), ['h1'], 'extra row cleared, backup row back');
    const docs = await idbGetAll(archive2, SOURCE_DOCS_STORE);
    assert.equal(docs.length, 1);
    assert.ok(docs[0].bytes instanceof ArrayBuffer, 'bytes decoded back to ArrayBuffer');
    assert.deepEqual(new Uint8Array(docs[0].bytes), PDF_BYTES, 'PDF bytes byte-identical');

    assert.equal(await countAll(), 1, 'journal restored');
});

test('applyBackup refuses to smuggle an LLM key hidden in a backup file', async () => {
    await seedWorkspace();
    const backup = await collectBackup({ includeSourceBytes: false });
    backup.storage['xray:llm:key'] = 'sk-ant-SMUGGLED';
    await applyBackup(backup);
    assert.equal(_stateStore.get('xray:llm:key'), 'sk-ant-SECRET-NEVER-EXPORT', 'live key kept, smuggled key dropped');
});

test('applyBackup of a bytes-omitted backup clears source docs (documented replace-all)', async () => {
    await seedWorkspace();
    const backup = await collectBackup({ includeSourceBytes: false });
    await applyBackup(backup);
    const archive = await openArchiveDb();
    assert.equal((await idbGetAll(archive, SOURCE_DOCS_STORE)).length, 0);
    assert.equal((await idbGetAll(archive, 'articles')).length, 1);
});

test('applyBackup rejects malformed input; validateBackup names the problems', async () => {
    assert.deepEqual(validateBackup(null), ['not an object']);
    assert.ok(validateBackup({ format: 'nope' }).length >= 2, 'format + missing sections');
    assert.deepEqual(validateBackup({ format: BACKUP_FORMAT, storage: {}, databases: {} }), []);
    await assert.rejects(() => applyBackup({ format: 'nope' }), /invalid backup/);
});

test('applyBackup skips unknown stores/databases with a warning, restores the rest', async () => {
    await seedWorkspace();
    const backup = await collectBackup({ includeSourceBytes: true });
    backup.databases['xray-archive']['no_such_store'] = [{ x: 1 }];
    backup.databases['not-a-db'] = { stuff: [] };
    const warnings = [];
    await applyBackup(backup, { warn: (m) => warnings.push(m) });
    assert.equal(warnings.length, 2);
    assert.ok(warnings.some((w) => w.includes('no_such_store')));
    assert.ok(warnings.some((w) => w.includes('not-a-db')));
    const archive = await openArchiveDb();
    assert.equal((await idbGetAll(archive, 'articles')).length, 1, 'known stores still restored');
});

// ------------------------------------------------------------------
// Estimate + dump plumbing
// ------------------------------------------------------------------

test('estimateBackupSize: withBytes ≥ withoutBytes; counts source docs', async () => {
    await seedWorkspace();
    const est = await estimateBackupSize();
    assert.equal(est.sourceDocCount, 1);
    assert.ok(est.withoutBytes > 0);
    assert.ok(est.withBytes > est.withoutBytes, 'base64 overhead accounted');
});

test('dumpDatabase dumps every store of a covered database', async () => {
    await seedWorkspace();
    const dump = await dumpDatabase('xray-audits');
    // 20.4: case-briefs (DB v2) and corpus-extracts (DB v3) are dumped
    // generically too; 28.2 adds pending-suggestions (DB v4); 28.3 adds
    // case-link-suggestions (DB v5).
    assert.deepEqual(Object.keys(dump).sort(),
        ['case-briefs', 'case-link-suggestions', 'corpus-extracts', 'pending-suggestions',
         'predictions', 'resolutions', 'runs']);
    assert.equal(dump.runs.length, 1);
    await assert.rejects(() => dumpDatabase('unknown-db'), /no opener/);
});

// ---------------------------------------------------------------------
// 28.1 — workspace scoping: backups snapshot ONE workspace
// ---------------------------------------------------------------------

test('28.1: collectBackup under a non-default workspace carries ITS content under logical names, never other workspaces’', async () => {
    const { Storage } = await import('../src/shared/storage.js');
    // default workspace content + a foreign workspace's content
    _stateStore.set('entities', JSON.stringify({ home: 'default' }));
    _stateStore.set('ws:ws_other:entities', JSON.stringify({ home: 'other' }));
    _stateStore.set('preferences', JSON.stringify({ debug: true }));
    await Storage.setActiveWorkspaceId('ws_mine');
    _stateStore.set('ws:ws_mine:entities', JSON.stringify({ home: 'mine' }));
    try {
        const backup = await collectBackup();
        assert.equal(backup.storage.entities, JSON.stringify({ home: 'mine' }), 'active ws content, logical name');
        assert.equal(backup.storage.preferences, JSON.stringify({ debug: true }), 'install config rides');
        assert.ok(!('ws:ws_other:entities' in backup.storage), 'foreign ws content never rides');
        assert.ok(!('ws:ws_mine:entities' in backup.storage), 'no raw names in the file');
        assert.ok(!('workspaces' in backup.storage) && !('active_workspace' in backup.storage),
            'registry + pointer are install plumbing, excluded');

        // applyBackup while ws_mine is active: replaces ITS scope only.
        _stateStore.set('ws:ws_other:entities', JSON.stringify({ home: 'other' }));
        await applyBackup(backup);
        assert.equal(_stateStore.get('ws:ws_mine:entities'), JSON.stringify({ home: 'mine' }), 'restored mapped');
        assert.equal(_stateStore.get('ws:ws_other:entities'), JSON.stringify({ home: 'other' }), 'other ws untouched');
        assert.equal(_stateStore.get('entities'), JSON.stringify({ home: 'default' }), 'default ws untouched');
    } finally {
        await Storage.setActiveWorkspaceId('default');
        _stateStore.delete('ws:ws_mine:entities');
        _stateStore.delete('ws:ws_other:entities');
    }
});

test('28.1: collectWorkspaceSnapshot dumps a NON-active workspace under logical names (the delete-flow backup, §7 Q2)', async () => {
    const { collectWorkspaceSnapshot } = await import('../src/shared/backup.js');
    const { Storage } = await import('../src/shared/storage.js');
    assert.equal(await Storage.activeWorkspaceId(), 'default', 'precondition: default active');
    _stateStore.set('ws:ws_doomed:entities', JSON.stringify({ doomed: true }));
    _stateStore.set('ws:ws_doomed:article_claims', JSON.stringify({ c1: {} }));
    _stateStore.set('ws:ws_doomed:xray:llm:key', JSON.stringify('smuggled'));   // excluded even here
    try {
        const snap = await collectWorkspaceSnapshot('ws_doomed');
        assert.equal(snap.format, BACKUP_FORMAT, 'same restorable format');
        assert.equal(snap.workspaceId, 'ws_doomed');
        assert.equal(snap.storage.entities, JSON.stringify({ doomed: true }), 'logical names');
        assert.equal(snap.storage.article_claims, JSON.stringify({ c1: {} }));
        assert.ok(!('xray:llm:key' in snap.storage), 'excluded keys never ride, even prefixed');
        assert.equal(validateBackup(snap).length, 0, 'validates as a normal backup');
        // Its databases dump by BASE name (empty here — never created).
        assert.ok('xray-archive' in snap.databases);
    } finally {
        _stateStore.delete('ws:ws_doomed:entities');
        _stateStore.delete('ws:ws_doomed:article_claims');
        _stateStore.delete('ws:ws_doomed:xray:llm:key');
    }
});

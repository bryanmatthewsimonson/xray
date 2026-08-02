// Backup merge-import (backup.js mergeBackup) — accrual, not
// replacement. Load-bearing pins:
//   - CONTENT ONLY: config/identity keys in the file are ignored — a
//     merge grows the corpus, it never reconfigures the install.
//   - LOCAL WINS: shared ids keep the local record verbatim; dedup is
//     by id only (no name-based identity merging, ever).
//   - NOTHING DELETED: every pre-existing local row and id survives.
//   - article-extractions deep-merge at the assertion level.

import { test } from 'node:test';
import assert from 'node:assert/strict';

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
    }
};

const { BACKUP_FORMAT, mergeBackup, mergeStorageValue } = await import('../src/shared/backup.js');
const { openAuditDb, clear: clearAudits, getRun, listRuns, getArticleExtraction, saveArticleExtraction }
    = await import('../src/shared/audit/audit-cache.js');
const { openArchiveDb } = await import('../src/shared/archive-cache.js');
const {
    recordSigned, recordPublished, getByEventId: journalGet, clear: clearJournal,
    openEventJournalDb, MIGRATION_DEFER_S
} = await import('../src/shared/event-journal.js');

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

// A real 64-hex content hash — the merge only trusts spans under a
// text-pinned key (isTextPinnedKey), so a non-hex id would be skipped.
const HASH_X = 'e'.repeat(64);

// The local canonical body. MA.7 re-locates every imported quote HERE,
// so it must contain them — with different surrounding whitespace than
// the offsets in the fixture records, which is the point.
const LOCAL_BODY = 'Intro line.\n\nlocal span here.\n\nAnd then a foreign-only span here to find.\n';

const extractionRecord = (over = {}) => ({
    articleHash: HASH_X, url: 'https://ex.com/x', title: 'X',
    assertions: [{ key: 'a:0-10', quote: 'local span', start: 0, end: 10, why: 'local why',
                   status: 'open', accepted_claim_id: null, triaged_at: null,
                   first_seen: { model: 'm-local', promptVersion: 'corpus-v7', at: 100 } }],
    sources: [], open_questions: [], positions: [],
    merged_keys: ['k-local'], dropped_ungrounded: 0, updatedAt: 100,
    ...over
});

async function seedLocal() {
    _stateStore.clear();
    _stateStore.set('preferences', JSON.stringify({ debug: false, default_relays: ['wss://mine.example'] }));
    _stateStore.set('local_primary_identity', JSON.stringify({ nsec: 'nsec1MINE', pubkey: 'p'.repeat(64) }));
    _stateStore.set('xray:llm:key', 'sk-ant-LOCAL');
    _stateStore.set('article_claims', JSON.stringify({
        claim_shared: { id: 'claim_shared', text: 'LOCAL version', source_url: 'https://ex.com/a' },
        claim_local_only: { id: 'claim_local_only', text: 'only mine' }
    }));
    _stateStore.set('entities', JSON.stringify({
        entity_local: { id: 'entity_local', name: 'Mine', type: 'person' }
    }));

    const audits = await openAuditDb();
    await clearAudits();
    await idbPut(audits, 'runs', { id: 'run_shared', articleHash: 'ah1', note: 'LOCAL run' });
    await saveArticleExtraction(extractionRecord());

    // The archive DB must exist so its dump section merges cleanly — and
    // MA.7 needs an actual BODY under this record's hash, or the merge
    // (correctly) refuses to verify anything. The row's stored
    // articleHash is what the resolver keys on; it is deliberately not
    // re-derived (a published or PDF row's body no longer re-hashes to
    // its own identity, so a hash precondition would break the common
    // case).
    const archive = await openArchiveDb();
    await idbPut(archive, 'articles', {
        urlHash: 'x'.repeat(16), url: 'https://ex.com/x',
        article: { url: 'https://ex.com/x', title: 'X', content: LOCAL_BODY },
        articleHash: HASH_X, priorVersions: [],
        cachedAt: 1, lastAccessed: 1, source: 'capture',
        publishedToRelay: false, publishedEventId: null
    });
}

/** seedLocal, minus the archive body — the "I hold no copy" case. */
async function seedLocalWithoutBody() {
    await seedLocal();
    const archive = await openArchiveDb();
    await new Promise((resolve, reject) => {
        const tx = archive.transaction('articles', 'readwrite');
        tx.objectStore('articles').clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

function foreignBackup() {
    return {
        format: BACKUP_FORMAT,
        exportedAt: '2026-07-20T00:00:00.000Z',
        includesSourceBytes: true,
        storage: {
            // Config the merge must IGNORE:
            preferences: JSON.stringify({ debug: true, default_relays: ['wss://theirs.example'] }),
            local_primary_identity: JSON.stringify({ nsec: 'nsec1THEIRS', pubkey: 'q'.repeat(64) }),
            'xray:llm:key': 'sk-ant-SMUGGLED',
            // Content that accrues:
            article_claims: JSON.stringify({
                claim_shared: { id: 'claim_shared', text: 'FOREIGN version — must not win' },
                claim_foreign: { id: 'claim_foreign', text: 'theirs, new to me' }
            }),
            entities: JSON.stringify({
                entity_foreign: { id: 'entity_foreign', name: 'Theirs', type: 'organization' }
            }),
            // A content key the local side doesn't have at all:
            evidence_links: JSON.stringify({
                link_1: { id: 'link_1', source_claim_id: 'claim_foreign', target_claim_id: 'claim_shared', relationship: 'supports' }
            })
        },
        databases: {
            'xray-audits': {
                runs: [
                    { id: 'run_shared', articleHash: 'ah1', note: 'FOREIGN run — must not win' },
                    { id: 'run_foreign', articleHash: 'ah2', note: 'theirs' }
                ],
                'article-extractions': [extractionRecord({
                    assertions: [
                        { key: 'a:0-10', quote: 'local span', start: 0, end: 10, why: 'foreign why',
                          status: 'accepted', accepted_claim_id: 'claim_foreign', triaged_at: 500,
                          first_seen: { model: 'm-foreign', promptVersion: 'corpus-v7', at: 400 } },
                        { key: 'a:20-40', quote: 'a foreign-only span here', start: 20, end: 40, why: 'new atom',
                          status: 'open', accepted_claim_id: null, triaged_at: null,
                          first_seen: { model: 'm-foreign', promptVersion: 'corpus-v7', at: 400 } }
                    ],
                    merged_keys: ['k-foreign'], updatedAt: 400
                })]
            },
            'xray-archive': {
                source_documents: null   // bytes omitted at export — deliberate
            },
            'not-a-covered-db': { anything: [] }
        }
    };
}

test('mergeBackup: content accrues by id, local wins on conflict, nothing deleted', async () => {
    await seedLocal();
    const warns = [];
    const summary = await mergeBackup(foreignBackup(), { warn: (m) => warns.push(m) });

    // storage — the shared claim keeps the LOCAL text; the foreign one arrives.
    const claims = JSON.parse(_stateStore.get('article_claims'));
    assert.equal(claims.claim_shared.text, 'LOCAL version');
    assert.equal(claims.claim_foreign.text, 'theirs, new to me');
    assert.ok(claims.claim_local_only, 'nothing local deleted');
    // entities — foreign entity arrives as a DISTINCT record (id-only dedup).
    const ents = JSON.parse(_stateStore.get('entities'));
    assert.ok(ents.entity_local && ents.entity_foreign);
    // a wholly-new content key arrives verbatim.
    assert.ok(_stateStore.has('evidence_links'));
    assert.equal(JSON.parse(_stateStore.get('evidence_links')).link_1.relationship, 'supports');

    // databases — runs add-if-missing, local wins on the shared id.
    assert.equal((await getRun('run_shared')).note, 'LOCAL run');
    assert.equal((await getRun('run_foreign')).note, 'theirs');
    assert.equal((await listRuns()).length, 2);

    // the uncovered database was skipped with a warning, not an error.
    assert.ok(warns.some((w) => w.includes('not-a-covered-db')));

    // summary counts are honest.
    assert.equal(summary.storage.idsAdded >= 2, true, 'claim_foreign + entity_foreign at least');
    assert.equal(summary.storage.keysAdded >= 1, true, 'evidence_links was new');
    assert.equal(summary.databases['xray-audits'].runs.added, 1);
    assert.equal(summary.databases['xray-audits'].runs.kept, 1);
    assert.equal(summary.databases['xray-archive'].source_documents.omitted, true);
});

test('mergeBackup: config and identity in the file are NEVER applied', async () => {
    await seedLocal();
    await mergeBackup(foreignBackup());
    assert.equal(JSON.parse(_stateStore.get('preferences')).default_relays[0], 'wss://mine.example',
        'preferences untouched');
    assert.equal(JSON.parse(_stateStore.get('local_primary_identity')).nsec, 'nsec1MINE',
        'the primary identity can never be swapped by a merge');
    assert.equal(_stateStore.get('xray:llm:key'), 'sk-ant-LOCAL', 'a smuggled API key is ignored');
});

test('MA.7 merge-import: atoms accrue at LOCAL offsets; no foreign ruling is adopted', async () => {
    await seedLocal();
    const summary = await mergeBackup(foreignBackup());
    const rec = await getArticleExtraction(HASH_X);
    assert.equal(rec.assertions.length, 2, 'the foreign-only atom accrued');

    const localAtom = rec.assertions.find((a) => a.quote === 'local span');
    assert.equal(localAtom.why, 'local why', 'the local atom body is untouched');
    assert.equal(localAtom.status, 'open', 'a file does NOT rule for the user');
    assert.equal(localAtom.accepted_claim_id, null, 'no foreign claim id in a local field');
    assert.equal(localAtom.imported_ruling.status, 'accepted', 'it rides attributed instead');
    assert.equal(localAtom.imported_ruling.foreign_claim_id, 'claim_foreign');

    // The accrued atom's span indexes the LOCAL body, not the file's.
    const added = rec.assertions.find((a) => a.quote.includes('foreign-only span'));
    assert.ok(added, 'the new atom landed');
    assert.equal(LOCAL_BODY.slice(added.start, added.end), added.quote,
        'the stored span indexes THIS machine’s text');
    assert.notEqual(added.start, 20, 'the foreign offset was not adopted');
    assert.equal(added.first_seen.imported, true);

    // A foreign cache fingerprint must never land: corpusExtractKey omits
    // the model, so it would collide with a local key and permanently
    // suppress this machine's own fold of its own paid extract.
    assert.deepEqual(rec.merged_keys, ['k-local']);

    const st = summary.databases['xray-audits']['article-extractions'];
    assert.equal(st.refusals.regroundedQuotes, 2, 'both quotes were re-located locally');
    assert.equal(st.refusals.noLocalText, 0);
    assert.equal(st.refusals.importedRulings, 1);
});

test('MA.7 merge-import: no local copy of the text ⇒ REFUSED and named, never trusted', async () => {
    await seedLocalWithoutBody();
    const before = JSON.stringify(await getArticleExtraction(HASH_X));
    const summary = await mergeBackup(foreignBackup());
    assert.equal(JSON.stringify(await getArticleExtraction(HASH_X)), before,
        'nothing is written when nothing can be verified');
    const st = summary.databases['xray-audits']['article-extractions'];
    assert.equal(st.refusals.noLocalText, 1);
    assert.equal(st.skipped, 1);
    assert.equal(st.added, 0);
    assert.equal(st.merged, 0);
    // And the report names WHICH article, so the user can go capture it.
    assert.equal(st.unresolved.length, 1);
    assert.equal(st.unresolved[0].url, 'https://ex.com/x');
});

test('MA.7 merge-import: a quote absent from the local text is a FINDING, not a proposal', async () => {
    await seedLocal();
    const b = foreignBackup();
    b.databases['xray-audits']['article-extractions'] = [extractionRecord({
        assertions: [{ key: 'a:0-40', quote: 'THIS SENTENCE IS NOT IN THE LOCAL BODY',
                       start: 0, end: 38, why: 'w', status: 'accepted',
                       accepted_claim_id: 'claim_foreign', triaged_at: 500,
                       first_seen: { model: 'm-foreign', promptVersion: 'corpus-v7', at: 400 } }],
        merged_keys: ['k-foreign'], updatedAt: 400
    })];
    const summary = await mergeBackup(b);
    const rec = await getArticleExtraction(HASH_X);
    assert.ok(!rec.assertions.some((a) => a.quote.startsWith('THIS SENTENCE')),
        'an unlocatable quote never becomes a proposal (P3/P4)');
    assert.equal((rec.imported_unlocated || []).length, 1, 'but it is recorded as a finding');
    const st = summary.databases['xray-audits']['article-extractions'];
    assert.equal(st.refusals.unlocatedQuotes, 1);
    assert.equal(st.refusals.noLocalText, 0, 'distinct from "I hold no copy" — a different diagnosis');
});

test('mergeBackup: running the SAME merge twice is idempotent', async () => {
    await seedLocal();
    await mergeBackup(foreignBackup());
    const before = {
        claims: _stateStore.get('article_claims'),
        runs: (await listRuns()).length,
        rec: JSON.stringify(await getArticleExtraction(HASH_X))
    };
    const second = await mergeBackup(foreignBackup());
    assert.equal(_stateStore.get('article_claims'), before.claims);
    assert.equal((await listRuns()).length, before.runs);
    assert.equal(JSON.stringify(await getArticleExtraction(HASH_X)), before.rec);
    assert.equal(second.storage.idsAdded, 0);
    assert.equal(second.databases['xray-audits'].runs.added, 0);
});

test('mergeBackup: an invalid file throws before touching anything', async () => {
    await seedLocal();
    const claimsBefore = _stateStore.get('article_claims');
    await assert.rejects(() => mergeBackup({ format: 'wrong' }), /invalid backup/);
    assert.equal(_stateStore.get('article_claims'), claimsBefore);
});

test('mergeBackup: an UNPINNED (url:) extraction record is skipped, not merged or added', async () => {
    await seedLocal();
    const unpinned = extractionRecord({ articleHash: 'url:deadbeefdeadbeef' });
    const b = foreignBackup();
    b.databases['xray-audits']['article-extractions'] = [unpinned];
    const summary = await mergeBackup(b);
    assert.equal(await getArticleExtraction('url:deadbeefdeadbeef'), null,
        'a url:-keyed record never lands — its spans index the FOREIGN text');
    assert.equal(summary.databases['xray-audits']['article-extractions'].skipped, 1);
    assert.equal(summary.databases['xray-audits']['article-extractions'].added, 0);
});

test('mergeBackup: idsAdded counts the records INSIDE a wholly-new key (honest summary)', async () => {
    await seedLocal();
    _stateStore.delete('evidence_links');   // make the key wholly new
    const b = foreignBackup();
    b.storage.evidence_links = JSON.stringify({
        l1: { id: 'l1' }, l2: { id: 'l2' }, l3: { id: 'l3' }
    });
    const summary = await mergeBackup(b);
    assert.ok(summary.storage.keysAdded >= 1);
    // 3 links + claim_foreign + entity_foreign = 5 records, not "1 key".
    assert.ok(summary.storage.idsAdded >= 5,
        `idsAdded must count records inside new keys (got ${summary.storage.idsAdded})`);
});

test('mergeBackup: a failing database stage is COLLECTED, not thrown — partial completion is reported', async () => {
    await seedLocal();
    const b = foreignBackup();
    // A row whose keyPath value is an unclonable structure makes the
    // store.put throw inside the transaction → the stage rejects.
    b.databases['xray-audits'].runs = [{ id: 'run_boom', bad: () => {} }];
    const summary = await mergeBackup(b);
    assert.ok(Array.isArray(summary.errors));
    assert.equal(summary.errors.length, 1, 'the failure is surfaced, not swallowed and not thrown');
    assert.equal(summary.errors[0].database, 'xray-audits');
    // Storage committed BEFORE the databases, so it must still be there.
    assert.ok(JSON.parse(_stateStore.get('article_claims')).claim_foreign,
        'what landed before the failure stays landed — re-running is idempotent');
});

test('mergeBackup: under a NON-default workspace, content merges into THAT workspace only', async () => {
    const { Storage } = await import('../src/shared/storage.js');
    await seedLocal();
    // Another workspace's content must be untouchable, and the active
    // workspace's content lives under ws:<id>: prefixes.
    _stateStore.set('ws:ws_other:article_claims', JSON.stringify({ claim_other: { id: 'claim_other' } }));
    await Storage.setActiveWorkspaceId('ws_mine');
    _stateStore.set('ws:ws_mine:article_claims', JSON.stringify({
        claim_shared: { id: 'claim_shared', text: 'MINE under ws_mine' }
    }));
    try {
        await mergeBackup(foreignBackup());
        const mine = JSON.parse(_stateStore.get('ws:ws_mine:article_claims'));
        assert.equal(mine.claim_shared.text, 'MINE under ws_mine', 'local wins inside the active workspace');
        assert.ok(mine.claim_foreign, 'the foreign claim accrued under the ACTIVE workspace prefix');
        assert.equal(_stateStore.get('ws:ws_other:article_claims'),
            JSON.stringify({ claim_other: { id: 'claim_other' } }), 'another workspace is untouched');
        // The bare (default-workspace) key must not gain the foreign content.
        assert.ok(!JSON.parse(_stateStore.get('article_claims')).claim_foreign,
            'the default workspace\'s content is not written while ws_mine is active');
    } finally {
        await Storage.setActiveWorkspaceId('default');
        _stateStore.delete('ws:ws_mine:article_claims');
        _stateStore.delete('ws:ws_other:article_claims');
    }
});

test('mergeBackup: v2 journal rows — merged flush states resolve local-wins; foreign pending rows join the queue', async () => {
    await seedLocal();
    await clearJournal();
    const P = 'p'.repeat(64);
    const signed = (id, kind = 30040, tags = [['d', 'd-' + id.slice(0, 4)]]) => ({
        id, sig: 's'.repeat(128), kind, pubkey: P, created_at: 1700000000, tags, content: 'x'
    });

    // Local: a PENDING row (signed here, no relay has it yet).
    const sharedId = 'a9'.padEnd(64, '0');
    await recordSigned(signed(sharedId), { ledger: { model: 'claim', localId: 'c1' } });
    // Local: a flushed row that the incoming file also carries.
    const flushedId = 'b9'.padEnd(64, '0');
    await recordPublished(signed(flushedId), {
        successful: 1, confirmed: 1, failed: 0, total: 1,
        results: [{ url: 'wss://mine.example', success: true, assumed: false }]
    }, {});

    // Foreign: the SAME shared id but marked flushed on the other
    // machine, plus a foreign-only PENDING row (Q7: it must arrive
    // still pending, joining the local flush queue).
    const foreignPendingId = 'c9'.padEnd(64, '0');
    const b = foreignBackup();
    b.databases['xray-events'] = {
        published_events: [
            {
                eventId: sharedId, kind: 30040, pubkey: P,
                address: `30040:${P}:d-${sharedId.slice(0, 4)}`,
                createdAt: 1700000000, event: signed(sharedId), articleUrl: null,
                signedAt: 1700000000, publishedAt: 1700000500,
                relays: [{ url: 'wss://theirs.example', success: true, assumed: false }],
                flush: { state: 'flushed', attempts: 1, nextAttemptAt: null },
                ledger: null
            },
            {
                eventId: foreignPendingId, kind: 30040, pubkey: P,
                address: `30040:${P}:d-${foreignPendingId.slice(0, 4)}`,
                createdAt: 1700000000, event: signed(foreignPendingId), articleUrl: null,
                signedAt: 1700000100, publishedAt: null, relays: [],
                flush: { state: 'pending', attempts: 0, nextAttemptAt: 1700000100 },
                ledger: null
            }
        ]
    };
    const summary = await mergeBackup(b);

    // Local wins on the shared id: our pending state stands (costing
    // at most one redundant, idempotent re-flush later — §3.4).
    const local = await journalGet(sharedId);
    assert.equal(local.flush.state, 'pending', 'a local pending beats an incoming flushed (local wins)');
    assert.deepEqual(local.ledger, { model: 'claim', localId: 'c1', extra: null, markedAt: null },
        'the local ledger descriptor survives the merge');

    // The foreign pending row arrived INTACT — still pending, so it
    // joins the flush queue rather than stranding (Q7 2026-08-02).
    const arrived = await journalGet(foreignPendingId);
    assert.equal(arrived.flush.state, 'pending');
    assert.equal(arrived.event.sig, 's'.repeat(128), 'the signature rides the merge verbatim');

    assert.equal(summary.databases['xray-events'].published_events.added, 1);
    assert.equal(summary.databases['xray-events'].published_events.kept, 1);
    assert.equal((await journalGet(flushedId)).flush.state, 'flushed', 'untouched local rows survive');
    await clearJournal();
});

test('mergeBackup: a V1-SHAPED journal row normalizes on the way in — pending, deferred, and index-visible', async () => {
    // A pre-29.1 backup merged into a v2 install: the row must arrive
    // v2-shaped (put verbatim it would drop out of the flushState
    // index and strand from the 29.2 flusher — §3.4's silent-strand
    // failure, on the exact Mac ↔ Windows path).
    await seedLocal();
    await clearJournal();
    const P = 'p'.repeat(64);
    const V1_ID = 'e9'.padEnd(64, '0');
    const b = foreignBackup();
    b.databases['xray-events'] = {
        published_events: [{
            // Byte-for-byte the pre-29.1 recordPublished shape,
            // assumed-only, with a v1-rule null address (kind 0).
            eventId: V1_ID, kind: 0, pubkey: P,
            address: null, createdAt: 1700000000,
            event: {
                id: V1_ID, sig: 's'.repeat(128), kind: 0, pubkey: P,
                created_at: 1700000000, tags: [], content: '{}'
            },
            publishedAt: 3000,
            relays: [{ url: 'wss://theirs.example', success: true, assumed: true }],
            articleUrl: null
        }]
    };
    const now = Math.floor(Date.now() / 1000);
    await mergeBackup(b);

    const row = await journalGet(V1_ID);
    assert.equal(row.flush.state, 'pending', 'assumed-only v1 import → pending (migration-equivalent)');
    assert.equal(row.signedAt, 3000, 'signedAt backfilled from publishedAt');
    assert.equal(row.address, `0:${P}`, 'address recomputed under replaceableKey');
    assert.equal(row.ledger, null);
    assert.ok(row.flush.nextAttemptAt > now + MIGRATION_DEFER_S - 120
        && row.flush.nextAttemptAt <= now + MIGRATION_DEFER_S + 120,
        'v1 imports take the migration defer; v2-shaped imports keep their own schedule (Q7)');

    // The load-bearing part: visible to the 29.2 queue scan.
    const db = await openEventJournalDb();
    const pending = await new Promise((resolve, reject) => {
        const req = db.transaction('published_events', 'readonly')
            .objectStore('published_events').index('flushState').getAll('pending');
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
    assert.deepEqual(pending.map((r) => r.eventId), [V1_ID],
        'the normalized import is in the flushState index — the flusher can see it');
    await clearJournal();
});

test('mergeStorageValue: map-shape guard — non-maps and malformed JSON keep local', () => {
    assert.equal(mergeStorageValue(JSON.stringify({ a: 1 }), JSON.stringify([1, 2])), null, 'array incoming');
    assert.equal(mergeStorageValue(JSON.stringify([1]), JSON.stringify({ a: 1 })), null, 'array local');
    assert.equal(mergeStorageValue('not json', JSON.stringify({ a: 1 })), null, 'malformed local');
    assert.equal(mergeStorageValue(JSON.stringify({ a: 1 }), 'not json'), null, 'malformed incoming');
    // Legacy raw-object local values merge and stay raw objects.
    const legacy = mergeStorageValue({ a: 1 }, JSON.stringify({ a: 9, b: 2 }));
    assert.equal(legacy.added, 1);
    assert.deepEqual(legacy.value, { a: 1, b: 2 });
    // String-encoded local values stay string-encoded.
    const enc = mergeStorageValue(JSON.stringify({ a: 1 }), JSON.stringify({ b: 2 }));
    assert.equal(typeof enc.value, 'string');
    assert.deepEqual(JSON.parse(enc.value), { a: 1, b: 2 });
});
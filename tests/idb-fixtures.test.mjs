// Golden IndexedDB fixtures — open-and-upgrade every checked-in rung and
// read every row back through the CURRENT module API.
//
// Pins (RESET_PLAN §7 R0 "Golden fixtures before any refactor thread
// starts"; audit finding WIRE-05 in docs/audit-2026-09-05/wire-and-
// schema.md — "zero persisted-shape fixtures … xray-audits is at v7 with
// no upgrade-from-v(n) test"):
//   1. every tests/fixtures/idb/<db>-v<N>.json seeds RAW at its version
//      with its own schema block, the current module's opener upgrades it
//      to HEAD (the REAL onupgradeneeded, oldVersion = N), and every row
//      is still there and readable through the read API;
//   2. the xray-events v1 rung additionally pins the v1→v2 data pass
//      (flush.state from the relay snapshot, address recompute under
//      replaceableKey for the five address-rule cases, the flushState
//      index visible to the flusher);
//   3. the CI RULE — for every module with a DB_VERSION the fixture for
//      that version exists, and the current-version fixture's schema
//      block EQUALS the schema the module mints from scratch;
//   4. determinism — the generator, imported as a module, regenerates
//      every fixture in memory and they deep-equal the checked-in files.
//
// House idiom: a positive sanity test proves the scanner/loader sees the
// modules and the files, then the guards enforce. Never deleteDatabase
// (it hangs behind a memoized module handle); one workspace per fixture
// (module handles are memoized by resolved name); active_workspace is
// restored to 'default' at the end.
//
// Provenance: INTERPRETATION (2026-09-08) — an agent artifact under
// RESET_PLAN R0; the maintainer has not ruled on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

await import('fake-indexeddb/auto');

// storage.js (pulled in via backup.js / event-builder.js) touches
// chrome.storage at module load; stub it first. Callback-style, like the
// real API — and persisting, because workspace-keys.js reads
// `active_workspace` from it at EVERY module open.
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
const setWorkspace = (id) => _stateStore.set('active_workspace', JSON.stringify(id));

const {
    FIXTURE_DIR, readAllDbConstants, fixtureFileName, seedFixture, describeSchema,
    getAllRows, indexGetAll
} = await import('./tools/idb-fixture-harness.mjs');
const { workspaceDbName } = await import('../src/shared/workspace-keys.js');
const { toSerializable, fromSerializable } = await import('../src/shared/backup.js');
const { replaceableKey } = await import('../src/shared/nostr-events.js');
const archive = await import('../src/shared/archive-cache.js');
const audits = await import('../src/shared/audit/audit-cache.js');
const journal = await import('../src/shared/event-journal.js');
const portal = await import('../src/portal/portal-cache.js');
const network = await import('../src/network/network-cache.js');
const generator = await import('./tools/gen-idb-fixtures.mjs');

const OPENERS = {
    'xray-archive': archive.openArchiveDb,
    'xray-audits': audits.openAuditDb,
    'xray-events': journal.openEventJournalDb,
    'xray-portal': portal.openPortalDb,
    'xray-network': network.openNetworkDb
};

const REGEN_MESSAGE = 'DB_VERSION bumped without a fixture — run node tests/tools/gen-idb-fixtures.mjs and commit the new rung';

const modules = readAllDbConstants();
const versionOf = Object.fromEntries(modules.map((m) => [m.db, m.version]));

const fixtureFiles = existsSync(FIXTURE_DIR)
    ? readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')).sort()
    : [];
const fixtures = fixtureFiles.map((file) => ({ file, ...JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8')) }));

const decodeRows = (rows) => rows.map(fromSerializable);
const dTagOf = (event) => (((event.tags || []).find((t) => t[0] === 'd')) || [])[1];

// ---------------------------------------------------------------------------
// Sanity — the scanner sees the modules and the loader sees the files

test('sanity: the DB_VERSION scanner reads five modules and the fixture dir loads self-describing rungs', () => {
    assert.equal(modules.length, 5);
    assert.deepEqual(modules.map((m) => m.db).sort(),
        ['xray-archive', 'xray-audits', 'xray-events', 'xray-network', 'xray-portal']);
    for (const m of modules) assert.ok(Number.isInteger(m.version) && m.version >= 1, `${m.module} DB_VERSION`);

    assert.ok(fixtures.length >= 5, 'at least one fixture per database');
    for (const fx of fixtures) {
        assert.equal(fx.file, fixtureFileName(fx.db, fx.version), `${fx.file}: name matches its db/version`);
        assert.equal(fx.producedBy.generator, generator.GENERATOR);
        assert.match(fx.producedBy.commitOfRung, /^[0-9a-f]{7,40}$/);
        assert.ok(typeof fx.producedBy.note === 'string' && fx.producedBy.note.length > 0);
        assert.ok(Object.keys(fx.schema).length > 0, `${fx.file}: schema block`);
        assert.deepEqual(Object.keys(fx.stores).sort(), Object.keys(fx.schema).sort(),
            `${fx.file}: one row list per schema store`);
    }
});

// ---------------------------------------------------------------------------
// CI rule — a DB_VERSION without its fixture fails

test('CI rule: every module DB_VERSION has its fixture and the ladder of rungs is complete', () => {
    for (const m of modules) {
        const file = fixtureFileName(m.db, m.version);
        assert.ok(existsSync(join(FIXTURE_DIR, file)),
            `${m.module} is at DB_VERSION ${m.version} but tests/fixtures/idb/${file} is missing — ${REGEN_MESSAGE}`);
        const versions = fixtures.filter((f) => f.db === m.db).map((f) => f.version).sort((a, b) => a - b);
        assert.deepEqual(versions, Array.from({ length: m.version }, (_, i) => i + 1),
            `${m.db}: one fixture per shipped version 1..${m.version} (no gaps, none beyond DB_VERSION)`);
    }
});

test('CI rule: the current-version fixture schema EQUALS the schema the module mints from scratch', async () => {
    for (const m of modules) {
        const fx = fixtures.find((f) => f.db === m.db && f.version === m.version);
        assert.ok(fx, `${m.db} v${m.version} fixture — ${REGEN_MESSAGE}`);
        setWorkspace(`fx_live_${m.db}`);
        const db = await OPENERS[m.db]();
        assert.equal(db.name, workspaceDbName(m.db, `fx_live_${m.db}`), 'opener honours the workspace suffix');
        assert.equal(db.version, m.version);
        assert.deepEqual(describeSchema(db), fx.schema,
            `${m.db}: live schema (stores, keyPaths, index names+keyPaths+unique) drifted from ${fx.file} — a schema edit needs a new rung: ${REGEN_MESSAGE}`);
    }
});

// ---------------------------------------------------------------------------
// Per-fixture: seed RAW at N, upgrade through the module, read every row

const READERS = {
    'xray-archive': async (fx, db) => {
        for (const store of ['annotations', 'factchecks', 'ratings', 'helpfulness', 'trust_graph']) {
            if (!(store in fx.stores)) continue;
            assert.equal((await getAllRows(db, store)).length, fx.stores[store].length, `${store}: dead store, read raw`);
        }
        for (const row of decodeRows(fx.stores.articles)) {
            assert.equal(await archive.hasArticle(row.url), true, `hasArticle(${row.url})`);
            const rec = await archive.getArticle(row.url);
            assert.deepEqual(toSerializable(rec), toSerializable(row), `getArticle(${row.url}) returns the fixture row`);
        }
        assert.equal((await archive.listArticles()).length, fx.stores.articles.length);
        assert.equal(await archive.count(), fx.stores.articles.length);
        for (const row of decodeRows(fx.stores.source_documents || [])) {
            const rec = await archive.getSourceDocument(row.hash);
            assert.ok(rec && rec.bytes instanceof ArrayBuffer, 'source bytes decode to an ArrayBuffer');
            assert.deepEqual(toSerializable(rec), toSerializable(row));
        }
    },
    'xray-audits': async (fx, db) => {
        const same = async (label, got, row) => assert.deepEqual(got, row, `${label} returns the fixture row`);
        for (const row of decodeRows(fx.stores.runs)) {
            await same(`getRun(${row.id})`, await audits.getRun(row.id), row);
            assert.ok((await audits.runsByArticleHash(row.articleHash)).some((r) => r.id === row.id), 'runs.articleHash index');
        }
        assert.equal((await audits.listRuns()).length, fx.stores.runs.length);
        assert.equal(await audits.countRuns(), fx.stores.runs.length);
        for (const row of decodeRows(fx.stores.predictions)) {
            await same(`getPrediction(${row.id})`, await audits.getPrediction(row.id), row);
            assert.ok((await audits.predictionsByStatus(row.resolution_status)).some((r) => r.id === row.id),
                'index resolutionStatus → keyPath resolution_status still resolves');
            assert.ok((await audits.predictionsByArticleHash(row.articleHash)).some((r) => r.id === row.id));
        }
        assert.equal((await audits.listPredictions()).length, fx.stores.predictions.length);
        for (const row of decodeRows(fx.stores.resolutions)) {
            await same(`getResolution(${row.id})`, await audits.getResolution(row.id), row);
            assert.ok((await audits.resolutionsByPredictionCoord(row.prediction_coord)).some((r) => r.id === row.id),
                'index predictionCoord → keyPath prediction_coord still resolves');
        }
        assert.equal((await audits.listResolutions()).length, fx.stores.resolutions.length);
        const simple = [
            ['case-briefs', 'caseId', audits.getCaseBrief, audits.listCaseBriefs],
            ['corpus-extracts', 'key', audits.getCorpusExtract, audits.listCorpusExtracts],
            ['pending-suggestions', 'url', audits.getPendingSuggestions, audits.listPendingSuggestions],
            ['entity-pages', 'entityId', audits.getEntityPage, audits.listEntityPages],
            ['article-extractions', 'articleHash', audits.getArticleExtraction, audits.listArticleExtractions],
            ['case-link-suggestions', 'caseId', audits.getCaseLinkRun, null]   // no list export at HEAD
        ];
        for (const [store, key, get, list] of simple) {
            if (!(store in fx.stores)) continue;
            for (const row of decodeRows(fx.stores[store])) await same(`${store}.get(${row[key]})`, await get(row[key]), row);
            const n = list ? (await list()).length : (await getAllRows(db, store)).length;
            assert.equal(n, fx.stores[store].length, `${store}: every row listed`);
        }
        if ('corpus-extracts' in fx.stores) assert.equal(await audits.countCorpusExtracts(), fx.stores['corpus-extracts'].length);
        if ('article-extractions' in fx.stores) assert.equal(await audits.countArticleExtractions(), fx.stores['article-extractions'].length);
    },
    'xray-events': async (fx) => {
        const rows = decodeRows(fx.stores.published_events);
        for (const row of rows) {
            const live = await journal.getByEventId(row.eventId);
            assert.ok(live, `getByEventId(${row.eventId.slice(0, 8)}…)`);
            assert.deepEqual(live.event, row.event, 'the signed event rides through verbatim');
            if (row.articleUrl) {
                assert.ok((await journal.listByArticleUrl(row.articleUrl)).some((r) => r.eventId === row.eventId), 'articleUrl index');
            }
            const byAddr = await journal.getByAddress(live.address);
            assert.ok(byAddr.some((r) => r.eventId === row.eventId), `getByAddress(${live.address})`);
        }
        assert.equal((await journal.listAll()).length, rows.length);
        assert.equal(await journal.countAll(), rows.length);
        assert.equal((await journal.exportBundle()).count, rows.length);
    },
    'xray-network': async (fx, db) => {
        const rows = decodeRows(fx.stores.events);
        const loaded = await network.loadRecords();
        assert.equal(loaded.length, rows.length);
        for (const row of rows) {
            const hit = loaded.find((r) => r.event.id === row.id);
            assert.ok(hit, `loadRecords carries ${row.id.slice(0, 8)}…`);
            assert.deepEqual(hit, { event: row.event, relays: row.relays, firstSeenAt: row.firstSeenAt });
        }
        assert.equal(await network.countEvents(), rows.length);
        for (const row of decodeRows(fx.stores.meta)) {
            assert.deepEqual(await network.getMeta(row.key), row.value, `getMeta(${row.key})`);
            if (row.key.startsWith('profile:')) {
                assert.deepEqual(await network.getProfile(row.key.slice('profile:'.length)), row.value, 'getProfile');
            }
        }
        // The addr index carries the replaceable-supersession rule; '' for regular events.
        for (const row of rows) {
            assert.equal(row.addr, replaceableKey(row.event) || '');
            assert.ok((await indexGetAll(db, 'events', 'addr', row.addr)).some((r) => r.id === row.id), `addr index (${row.addr || "''"})`);
        }
    },
    'xray-portal': async (fx, db) => {
        const rows = decodeRows(fx.stores.events);
        const loaded = await portal.loadRecords();
        assert.equal(loaded.length, rows.length);
        for (const row of rows) {
            const hit = loaded.find((r) => r.event.id === row.id);
            assert.ok(hit, `loadRecords carries ${row.id.slice(0, 8)}…`);
            assert.deepEqual(hit, { event: row.event, relays: row.relays });
            assert.equal(row.dTag, dTagOf(row.event) || '', 'portal rows carry dTag');
            assert.ok((await indexGetAll(db, 'events', 'addr', row.addr)).some((r) => r.id === row.id), 'addr index');
        }
        assert.equal(await portal.countEvents(), rows.length);
        for (const row of decodeRows(fx.stores.meta)) {
            assert.deepEqual(await portal.getMeta(row.key), row.value, `getMeta(${row.key})`);
        }
    }
};

/** The xray-events v1 rung: assert the v2 shape the migration must produce (EVENT_STORE_DESIGN §3.1). */
async function assertJournalV1Migrated(fx, db) {
    const rows = decodeRows(fx.stores.published_events);
    const pk = rows[0].pubkey;
    const confirmedOf = (row) => row.relays.some((r) => r.success && !r.assumed);

    // The fixture itself must carry the five address-rule cases.
    const cases = {
        confirmed: rows.find((r) => r.kind === 30023 && dTagOf(r.event) === 'article-1' && confirmedOf(r)),
        assumedOnly: rows.find((r) => r.kind === 30040 && dTagOf(r.event) === 'claim_x' && !confirmedOf(r)),
        kind0: rows.find((r) => r.kind === 0),
        dless: rows.find((r) => r.kind >= 30000 && r.kind < 40000 && dTagOf(r.event) === undefined),
        emptyD: rows.find((r) => dTagOf(r.event) === '')
    };
    for (const [name, row] of Object.entries(cases)) assert.ok(row, `fixture carries the ${name} case`);
    assert.equal(cases.kind0.address, null, 'v1 kind-0 address was null');
    assert.equal(cases.dless.address, null, 'v1 d-less address was null');
    assert.equal(cases.emptyD.address, `30040:${pk}:`, 'v1 empty-d address was kind:pubkey:');

    const live = {};
    for (const [name, row] of Object.entries(cases)) live[name] = await journal.getByEventId(row.eventId);

    assert.equal(live.confirmed.address, `30023:${pk}:article-1`, 'non-empty d: unchanged');
    assert.equal(live.assumedOnly.address, `30040:${pk}:claim_x`);
    assert.equal(live.kind0.address, `0:${pk}`, 'kind 0 gains an address (was null)');
    assert.equal(live.dless.address, `30078:${pk}:${cases.dless.eventId}`, 'missing d falls back to the event id');
    assert.equal(live.emptyD.address, `30040:${pk}:${cases.emptyD.eventId}`, 'EMPTY d also falls back to the event id');

    const now = Math.floor(Date.now() / 1000);
    for (const row of rows) {
        const migrated = await journal.getByEventId(row.eventId);
        assert.equal(migrated.address, replaceableKey(row.event), 'every address recomputed under replaceableKey');
        assert.equal(migrated.signedAt, row.publishedAt, 'signedAt backfills from publishedAt');
        assert.equal(migrated.publishedAt, row.publishedAt, 'publishedAt untouched');
        assert.deepEqual(migrated.relays, row.relays, 'relay snapshot untouched');
        assert.equal(migrated.ledger, null, 'ledger backfills null');
        if (confirmedOf(row)) {
            assert.deepEqual(migrated.flush, { state: 'flushed', attempts: 1, nextAttemptAt: null });
        } else {
            assert.equal(migrated.flush.state, 'pending', 'assumed-only → pending');
            assert.equal(migrated.flush.attempts, 1);
            assert.ok(migrated.flush.nextAttemptAt > now + journal.MIGRATION_DEFER_S - 120
                && migrated.flush.nextAttemptAt <= now + journal.MIGRATION_DEFER_S + 120,
                'migrated pending rows DEFER ~6h (±120 s window; the stamp is Date.now()-relative)');
        }
    }

    // The flushState index (nested keyPath 'flush.state') sees every migrated row.
    const expectPending = rows.filter((r) => !confirmedOf(r)).map((r) => r.eventId).sort();
    const expectFlushed = rows.filter(confirmedOf).map((r) => r.eventId).sort();
    assert.deepEqual((await indexGetAll(db, 'published_events', 'flushState', 'pending')).map((r) => r.eventId).sort(), expectPending);
    assert.deepEqual((await indexGetAll(db, 'published_events', 'flushState', 'flushed')).map((r) => r.eventId).sort(), expectFlushed);
}

for (const fx of fixtures) {
    test(`${fx.db} v${fx.version}: seeds raw, upgrades to v${versionOf[fx.db]} through the module, every row readable`, async () => {
        const ws = `fx_${fx.db}_v${fx.version}`;
        const name = workspaceDbName(fx.db, ws);
        setWorkspace(ws);

        const seededAt = await seedFixture(name, fx, fromSerializable);
        assert.equal(seededAt, fx.version, 'seeded at the rung version, raw');

        const db = await OPENERS[fx.db]();
        assert.equal(db.name, name, 'the module opened the seeded workspace database');
        assert.equal(db.version, versionOf[fx.db], 'upgraded to the module DB_VERSION');

        const live = describeSchema(db);
        for (const [store, spec] of Object.entries(fx.schema)) {
            assert.ok(live[store], `store ${store} survives the upgrade`);
            assert.equal(live[store].keyPath, spec.keyPath, `${store} keyPath`);
            for (const idx of spec.indexes) {
                const liveIdx = live[store].indexes.find((i) => i.name === idx.name);
                assert.ok(liveIdx, `${store}.${idx.name} index survives the upgrade`);
                assert.equal(liveIdx.keyPath, idx.keyPath, `${store}.${idx.name} keyPath`);
                assert.equal(liveIdx.unique, idx.unique, `${store}.${idx.name} unique`);
            }
        }

        const migrated = fx.db === 'xray-events' && fx.version < 2;
        for (const [store, rows] of Object.entries(fx.stores)) {
            const raw = await getAllRows(db, store);
            assert.equal(raw.length, rows.length, `${store}: row count`);
            if (!migrated) assert.deepEqual(toSerializable(raw), rows, `${store}: rows byte-identical after upgrade`);
        }
        if (migrated) await assertJournalV1Migrated(fx, db);

        await READERS[fx.db](fx, db);
    });
}

// ---------------------------------------------------------------------------
// Determinism — the generator regenerates what is checked in

test('determinism: regenerating every fixture in memory deep-equals the checked-in files', async () => {
    const regenerated = await generator.buildAllFixtures();
    assert.deepEqual([...regenerated.keys()].sort(), fixtureFiles, 'the generator produces exactly the checked-in rung files');
    for (const fx of fixtures) {
        const { file, ...checkedIn } = fx;
        assert.deepEqual(checkedIn, regenerated.get(file), `${file} is stale — ${REGEN_MESSAGE}`);
    }
});

test('teardown: active_workspace restored to default', () => {
    setWorkspace('default');
    assert.equal(JSON.parse(_stateStore.get('active_workspace')), 'default');
});

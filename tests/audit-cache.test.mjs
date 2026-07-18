// Phase 13.1 — xray-audits IndexedDB cache.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Install fake-indexeddb BEFORE the cache module is imported so the
// module's `indexedDB` lookup lands on the fake.
await import('fake-indexeddb/auto');

const {
    openAuditDb, clear,
    saveRun, getRun, runsByArticleHash, listRuns, deleteRun, countRuns,
    savePrediction, getPrediction, predictionsByArticleHash, predictionsByStatus,
    saveResolution, getResolution, resolutionsByPredictionCoord,
    saveCaseBrief, getCaseBrief, deleteCaseBrief, listCaseBriefs,
    saveCorpusExtract, getCorpusExtract, deleteCorpusExtract, listCorpusExtracts, countCorpusExtracts
} = await import('../src/shared/audit/audit-cache.js');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

test.beforeEach(async () => { await clear(); });

test('openAuditDb is idempotent — one connection promise', async () => {
    const a = openAuditDb();
    const b = openAuditDb();
    assert.equal(a, b);
    const db = await a;
    assert.equal(db.name, 'xray-audits');
});

test('runs: CRUD + articleHash index', async () => {
    await saveRun({ id: 'audit_1', articleHash: HASH_A, runAt: '2026-06-11T20:00:00Z' });
    await saveRun({ id: 'audit_2', articleHash: HASH_A, runAt: '2026-06-11T21:00:00Z' });
    await saveRun({ id: 'audit_3', articleHash: HASH_B, runAt: '2026-06-11T22:00:00Z' });

    assert.equal((await getRun('audit_1')).runAt, '2026-06-11T20:00:00Z');
    assert.equal(await getRun('nope'), null);
    assert.equal((await runsByArticleHash(HASH_A)).length, 2);
    assert.equal((await listRuns()).length, 3);
    assert.equal(await countRuns(), 3);

    await deleteRun('audit_2');
    assert.equal((await runsByArticleHash(HASH_A)).length, 1);
});

test('runs: put replaces same id (idempotent republish of the record)', async () => {
    await saveRun({ id: 'audit_1', articleHash: HASH_A, note: 'v1' });
    await saveRun({ id: 'audit_1', articleHash: HASH_A, note: 'v2' });
    assert.equal(await countRuns(), 1);
    assert.equal((await getRun('audit_1')).note, 'v2');
});

test('predictions: indexes on articleHash and resolution_status', async () => {
    await savePrediction({ id: 'pred_1', articleHash: HASH_A, resolution_status: 'open', horizon_iso: '2026-12-31' });
    await savePrediction({ id: 'pred_2', articleHash: HASH_A, resolution_status: 'resolved_true', horizon_iso: null });
    await savePrediction({ id: 'pred_3', articleHash: HASH_B, resolution_status: 'open', horizon_iso: '2027-01-15' });

    assert.equal((await predictionsByArticleHash(HASH_A)).length, 2);
    const open = await predictionsByStatus('open');
    assert.deepEqual(open.map((p) => p.id).sort(), ['pred_1', 'pred_3']);
    assert.equal((await getPrediction('pred_2')).resolution_status, 'resolved_true');
});

test('index queries with undefined/null keys return [], never the whole store', async () => {
    await saveRun({ id: 'audit_1', articleHash: HASH_A });
    await saveRun({ id: 'audit_2', articleHash: HASH_B });
    await savePrediction({ id: 'pred_1', articleHash: HASH_A, resolution_status: 'open' });
    // IDBIndex.getAll(undefined) is an unbounded range — unguarded, a
    // caller bug would widen "audits for this article" into "every
    // audit in the ledger".
    assert.deepEqual(await runsByArticleHash(undefined), []);
    assert.deepEqual(await runsByArticleHash(null), []);
    assert.deepEqual(await predictionsByArticleHash(undefined), []);
    assert.deepEqual(await predictionsByStatus(null), []);
    assert.deepEqual(await resolutionsByPredictionCoord(undefined), []);
});

test('resolutions: predictionCoord index', async () => {
    const coord = `30058:${'c'.repeat(64)}:pred_1`;
    await saveResolution({ id: 'res_1', prediction_coord: coord, outcome: 'true' });
    await saveResolution({ id: 'res_2', prediction_coord: coord, outcome: 'false' });
    await saveResolution({ id: 'res_3', prediction_coord: 'other', outcome: 'partial' });

    assert.equal((await resolutionsByPredictionCoord(coord)).length, 2);
    assert.equal((await getResolution('res_3')).outcome, 'partial');
});

test('clear empties all stores', async () => {
    await saveRun({ id: 'audit_1', articleHash: HASH_A });
    await savePrediction({ id: 'pred_1', articleHash: HASH_A, resolution_status: 'open' });
    await saveResolution({ id: 'res_1', prediction_coord: 'x', outcome: 'true' });
    await saveCaseBrief({ caseId: 'case_1', brief: { summary: 's' } });
    await clear();
    assert.equal(await countRuns(), 0);
    assert.equal(await getPrediction('pred_1'), null);
    assert.equal(await getResolution('res_1'), null);
    assert.equal(await getCaseBrief('case_1'), null);
});

// v2 store — the case-corpus synthesis briefs (20.4).
test('case-briefs: CRUD keyed by caseId, coexists with runs (DB v2)', async () => {
    await saveRun({ id: 'audit_x', articleHash: HASH_A });   // v1 store still works
    await saveCaseBrief({ caseId: 'case_1', brief: { summary: 'hi' }, inputHash: 'h1', model: 'm' });
    const got = await getCaseBrief('case_1');
    assert.equal(got.brief.summary, 'hi');
    assert.equal(got.inputHash, 'h1');
    assert.equal((await getRun('audit_x')).articleHash, HASH_A, 'v1 store intact after v2 upgrade');
    // Overwrite (latest-wins per case).
    await saveCaseBrief({ caseId: 'case_1', brief: { summary: 'updated' } });
    assert.equal((await getCaseBrief('case_1')).brief.summary, 'updated');
    assert.equal((await listCaseBriefs()).length, 1);
    await deleteCaseBrief('case_1');
    assert.equal(await getCaseBrief('case_1'), null);
});

// v3 store — the per-article map-extract cache.
test('corpus-extracts: CRUD keyed by fingerprint, coexists with v1/v2 stores (DB v3)', async () => {
    await saveRun({ id: 'audit_y', articleHash: HASH_A });            // v1
    await saveCaseBrief({ caseId: 'case_2', brief: { summary: 'b' } }); // v2
    await saveCorpusExtract({ key: 'k1', extract: { position: { summary: 'p' } }, model: 'm', cachedAt: 100 });
    const got = await getCorpusExtract('k1');
    assert.equal(got.extract.position.summary, 'p');
    assert.equal(got.model, 'm');
    assert.equal(await countCorpusExtracts(), 1);
    assert.equal((await getRun('audit_y')).articleHash, HASH_A, 'v1 intact after v3 upgrade');
    assert.equal((await getCaseBrief('case_2')).brief.summary, 'b', 'v2 intact after v3 upgrade');
    // Overwrite by key (same fingerprint = same output = replace in place).
    await saveCorpusExtract({ key: 'k1', extract: { position: { summary: 'p2' } } });
    assert.equal((await getCorpusExtract('k1')).extract.position.summary, 'p2');
    assert.equal((await listCorpusExtracts()).length, 1);
    await deleteCorpusExtract('k1');
    assert.equal(await getCorpusExtract('k1'), null);
    // clear() drops it too.
    await saveCorpusExtract({ key: 'k2', extract: {} });
    await clear();
    assert.equal(await countCorpusExtracts(), 0);
});

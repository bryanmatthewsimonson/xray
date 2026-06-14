// Phase 13.1 — audit local models: deterministic ids, idempotent
// create, markPublished-never-bumps-updated, staleness/orphan display
// states, derived resolution fields, and auditor-kind parity (RQ3).

import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('fake-indexeddb/auto');

const { clear, saveRun, savePrediction, saveResolution } = await import('../src/shared/audit/audit-cache.js');
const {
    normalizePredictionText, generateAuditRunId, generatePredictionId,
    generateResolutionId, compareVersions,
    AuditRunModel, staleModules, isOrphaned,
    PredictionModel, deriveResolutionState, ResolutionModel
} = await import('../src/shared/audit/audit-model.js');

const HASH = 'a'.repeat(64);
const RUN_AT = '2026-06-11T20:14:00Z';

// "Never bumps updated" cannot be asserted by comparing two
// nowSeconds() values — create and mark run in the same second, so
// the assertion would pass even if the bump happened. Instead the
// stored record's `updated` is rewritten to a sentinel in the past;
// any bump moves it off the sentinel and the test bites.
const SENTINEL = 1_000_000;

// The four AuditorIdentity kinds — every model path must treat them
// identically (RQ3: nothing assumes model/pipeline).
const AUDITORS = [
    { kind: 'model', id: 'anthropic/claude-sonnet-4-6' },
    { kind: 'human', id: 'f'.repeat(64) },
    { kind: 'pipeline', id: 'xray-auditor/0.1.0/anthropic/claude-sonnet-4-6' },
    { kind: 'consensus', id: 'xray-panel-v1' }
];

test.beforeEach(async () => { await clear(); });

test('normalizePredictionText is the claim-id discipline, exactly', () => {
    assert.equal(normalizePredictionText('  Rates  Will\tFALL\n by  December '),
        'rates will fall by december');
    assert.equal(normalizePredictionText(''), '');
});

test('prediction id converges across phrasing noise — the ledger survives re-extraction', async () => {
    const a = await generatePredictionId(HASH, 'Rates will fall by December');
    const b = await generatePredictionId(HASH, '  rates  WILL fall   by december ');
    assert.equal(a, b);
    assert.match(a, /^pred_[0-9a-f]{16}$/);
    const otherHash = await generatePredictionId('b'.repeat(64), 'Rates will fall by December');
    assert.notEqual(a, otherHash, 'stealth edits fork the ledger per text version — deliberately');
});

test('compareVersions: numeric, not lexicographic', () => {
    assert.equal(compareVersions('1.0', '1.1'), -1);
    assert.equal(compareVersions('1.2', '1.10'), -1);
    assert.equal(compareVersions('1.0.0', '1.0'), 0);
    assert.equal(compareVersions('2.0', '1.9.9'), 1);
});

test('AuditRunModel.create: idempotent on (articleHash, auditorId, runAt)', async () => {
    const first = await AuditRunModel.create({
        articleHash: HASH, auditor: AUDITORS[0], runAt: RUN_AT,
        source: 'cli-import', moduleResults: [{ module: 'omission', module_version: '1.0', score: 70 }]
    });
    const again = await AuditRunModel.create({
        articleHash: HASH, auditor: AUDITORS[0], runAt: RUN_AT,
        source: 'cli-import', moduleResults: []
    });
    assert.equal(first.id, again.id);
    assert.equal(again.moduleResults.length, 1, 're-import of the same run is a no-op');

    const differentRun = await AuditRunModel.create({
        articleHash: HASH, auditor: AUDITORS[0], runAt: '2026-06-12T09:00:00Z', source: 'cli-import'
    });
    assert.notEqual(first.id, differentRun.id, 'a new run is a new record — time series, never overwrite');
});

test('auditor-kind parity: all four kinds flow create/publish identically (RQ3)', async () => {
    for (const auditor of AUDITORS) {
        const run = await AuditRunModel.create({
            articleHash: HASH, auditor, runAt: RUN_AT, source: 'manual'
        });
        assert.deepEqual(run.auditor, auditor);
        await saveRun({ ...run, updated: SENTINEL });
        const marked = await AuditRunModel.markEventPublished(run.id, 'agg', 'e'.repeat(64));
        assert.ok(marked.events.agg.publishedAt > 0);
        assert.equal(marked.updated, SENTINEL, `publish must not bump updated (${auditor.kind})`);
    }
});

test('per-event publish ledger: partial publish resumes, never duplicates', async () => {
    const run = await AuditRunModel.create({
        articleHash: HASH, auditor: AUDITORS[2], runAt: RUN_AT, source: 'cli-import'
    });
    await saveRun({ ...run, updated: SENTINEL });
    await AuditRunModel.markEventPublished(run.id, 'mod:omission', '1'.repeat(64));
    await AuditRunModel.markEventPublished(run.id, 'mod:source_quality', '2'.repeat(64));
    const after = await AuditRunModel.get(run.id);
    assert.deepEqual(Object.keys(after.events).sort(), ['mod:omission', 'mod:source_quality']);
    assert.equal(after.events['mod:omission'].publishedEventId, '1'.repeat(64));
    assert.equal(after.updated, SENTINEL, 'two ledger marks, zero updated bumps');
});

test('staleModules: version bump invalidates nothing, offers re-audit', () => {
    const run = {
        moduleResults: [
            { module: 'omission', module_version: '1.0' },
            { module: 'source_quality', module_version: '1.1' }
        ]
    };
    const stale = staleModules(run, { omission: '1.1', source_quality: '1.1' });
    assert.deepEqual(stale, [{ module: 'omission', storedVersion: '1.0', currentVersion: '1.1' }]);
    assert.deepEqual(staleModules(run, {}), [], 'no current versions → nothing stale');
});

test('isOrphaned: stealth-edit display state, hash outlives the capture', () => {
    const run = { articleHash: HASH };
    assert.equal(isOrphaned(run, HASH), false);
    assert.equal(isOrphaned(run, 'b'.repeat(64)), true);
    assert.equal(isOrphaned(run, null), false, 'no current capture → not orphaned, just unanchored');
});

test('PredictionModel: idempotent create; publish and derive never bump updated', async () => {
    const fields = {
        articleHash: HASH, text: 'Rates will fall by December.',
        type: 'explicit', hedge_level: 'confident', tractability: 'publicly_resolvable',
        evidence_quote: 'rates will come down', auditor: AUDITORS[0]
    };
    const p1 = await PredictionModel.create(fields);
    const p2 = await PredictionModel.create({ ...fields, hedge_level: 'speculative' });
    assert.equal(p1.id, p2.id);
    assert.equal(p2.hedge_level, 'confident', 'idempotent create returns the EXISTING record');
    assert.equal(p1.resolution_status, 'open');

    await savePrediction({ ...p1, updated: SENTINEL });
    const marked = await PredictionModel.markPublished(p1.id, 'e'.repeat(64));
    assert.equal(marked.updated, SENTINEL, 'publish must not bump updated');
    assert.ok(marked.publishedAt > 0);

    const derived = await PredictionModel.updateDerived(p1.id, [
        { id: 'res_x', outcome: 'true', resolved_at: 100 }
    ]);
    assert.equal(derived.resolution_status, 'resolved_true');
    assert.equal(derived.latest_resolution_id, 'res_x');
    assert.equal(derived.updated, SENTINEL, 'derivation is enrichment, not an edit');
});

test('deriveResolutionState: latest resolved_at wins; outcomes map to statuses', () => {
    assert.deepEqual(deriveResolutionState([]), { status: 'open', latestId: null });
    const state = deriveResolutionState([
        { id: 'r1', outcome: 'false', resolved_at: 100 },
        { id: 'r2', outcome: 'partial', resolved_at: 300 },
        { id: 'r3', outcome: 'true', resolved_at: 200 }
    ]);
    assert.deepEqual(state, { status: 'resolved_partial', latestId: 'r2' });
    assert.equal(deriveResolutionState([{ id: 'r', outcome: 'unresolvable', resolved_at: 1 }]).status,
        'unresolvable');
});

test('ResolutionModel: one per prediction coord; update bumps, markPublished does not', async () => {
    const coord = `30058:${'d'.repeat(64)}:pred_abc`;
    const r1 = await ResolutionModel.create({
        predictionCoord: coord, outcome: 'false', auditor: AUDITORS[1],
        evidence: [{ kind: 'url', value: 'https://e.x/outcome', description: 'the result' }]
    });
    const r2 = await ResolutionModel.create({ predictionCoord: coord, outcome: 'true' });
    assert.equal(r1.id, r2.id, 'one resolution per (resolver, prediction)');
    assert.equal(r2.outcome, 'false');

    await saveResolution({ ...r1, updated: SENTINEL });
    const marked = await ResolutionModel.markPublished(r1.id, 'e'.repeat(64));
    assert.equal(marked.updated, SENTINEL, 'publish must not bump updated');

    const updated = await ResolutionModel.update(r1.id, { outcome: 'partial' });
    assert.equal(updated.outcome, 'partial');
    assert.ok(updated.updated > SENTINEL, 'self-revision IS an edit — it re-emits');
});

test('create() guards: malformed input throws, never persists a garbage id', async () => {
    await assert.rejects(AuditRunModel.create({ auditor: AUDITORS[0], runAt: RUN_AT }),
        /articleHash required/);
    await assert.rejects(AuditRunModel.create({ articleHash: HASH, auditor: { kind: 'model' }, runAt: RUN_AT }),
        /auditor \{kind, id\} required/);
    await assert.rejects(AuditRunModel.create({ articleHash: HASH, auditor: AUDITORS[0] }),
        /runAt required/);
    await assert.rejects(AuditRunModel.create({ articleHash: HASH, auditor: AUDITORS[0], runAt: RUN_AT, source: 'import' }),
        /source must be one of/);
    await assert.rejects(PredictionModel.create({ articleHash: HASH }),
        /text required/);
    await assert.rejects(PredictionModel.create({ text: 'X will happen' }),
        /articleHash required/);
    await assert.rejects(ResolutionModel.create({ outcome: 'true' }),
        /predictionCoord required/);
});

test('resolution outcomes are validated, never defaulted — a typo must not vanish from calibration', async () => {
    const coord = `30058:${'e'.repeat(64)}:pred_xyz`;
    await assert.rejects(ResolutionModel.create({ predictionCoord: coord }),
        /outcome must be one of/, 'omitted outcome must throw, not default to unresolvable');
    await assert.rejects(ResolutionModel.create({ predictionCoord: coord, outcome: 'True' }),
        /outcome must be one of/);
    const r = await ResolutionModel.create({ predictionCoord: coord, outcome: 'true' });
    await assert.rejects(ResolutionModel.update(r.id, { outcome: 'resolved_true' }),
        /outcome must be one of/);
});

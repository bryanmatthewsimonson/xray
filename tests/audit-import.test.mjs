// Phase 13.5 — CLI-audit import: the RQ1 gate (re-hash +
// local-capture match + schema validation) enforced at the door, the
// per-module failure posture, and idempotent re-import.

import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('fake-indexeddb/auto');
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { importAuditJson } = await import('../src/shared/audit/import.js');
const { articleHash } = await import('../src/shared/audit/article-hash.js');
const { AuditRunModel, PredictionModel } = await import('../src/shared/audit/audit-model.js');
const { clear } = await import('../src/shared/audit/audit-cache.js');

const BODY = '# A Story\n\nThe minister said the program would end by December.';
const HASH = await articleHash(BODY);
const RUN_AT = '2026-06-11T20:14:05Z';
const PIPELINE = {
    kind: 'pipeline',
    id: 'xray-auditor-prototype/anthropic/claude-sonnet-4-6',
    constituents: [{ kind: 'model', id: 'anthropic/claude-sonnet-4-6' }]
};

function coherenceResult(overrides = {}) {
    return {
        article_hash: HASH,
        module: 'internal_coherence',
        module_version: '1.0',
        auditor: { kind: 'model', id: 'anthropic/claude-sonnet-4-6' },
        run_at: RUN_AT,
        score: 74,
        confidence: 0.8,
        findings: {
            module: 'internal_coherence', version: '1.0',
            score: 74, confidence: 0.8, confidence_notes: 'short piece',
            auditor_caveats: ['Surface scan only.'],
            contradictions: [], logical_gaps: []
        },
        evidence_quotes: [],
        auditor_caveats: ['Surface scan only.'],
        ...overrides
    };
}

function predictionExtraction() {
    return {
        article_hash: HASH,
        module: 'prediction_extraction',
        module_version: '1.0',
        auditor: { kind: 'model', id: 'anthropic/claude-sonnet-4-6' },
        run_at: RUN_AT,
        score: null,
        confidence: null,
        findings: {
            module: 'prediction_extraction', version: '1.0',
            auditor_caveats: ['Horizon approximate.'],
            predictions: [{
                prediction: 'The program will end by December.',
                type: 'explicit', hedge_level: 'confident',
                attributed_to: 'named_source', attributed_source_name: 'the minister',
                resolution_horizon: 'by December', resolution_criteria: 'program shut down by Dec 31',
                tractability: 'publicly_resolvable',
                evidence_quote: 'would end by December'
            }],
            summary: { total_predictions: 1 }
        },
        evidence_quotes: [{ quote: 'would end by December' }],
        auditor_caveats: ['Horizon approximate.']
    };
}

function scorerExport(overrides = {}) {
    return {
        article: {
            hash: HASH, source_url: 'https://example.com/story',
            headline: 'A Story', body_markdown: BODY,
            captured_at: RUN_AT, capture_method: 'xray_extension'
        },
        module_results: [coherenceResult(), predictionExtraction()],
        predictions: [{
            prediction: 'The program will end by December.',
            type: 'explicit', hedge_level: 'confident',
            attributed_to: 'named_source',
            resolution_horizon: 'by December', resolution_criteria: 'program shut down by Dec 31',
            tractability: 'publicly_resolvable', evidence_quote: 'would end by December',
            article_hash: HASH,
            prediction_text: 'The program will end by December.',
            attribution_kind: 'named_source',
            attributed_to_named_source: 'the minister',
            extracted_by: { kind: 'model', id: 'anthropic/claude-sonnet-4-6' },
            extracted_at: RUN_AT,
            resolution_status: 'open', latest_resolution_id: null
        }],
        aggregate: {
            article_hash: HASH, auditor: PIPELINE, run_at: RUN_AT,
            module_contributions: [{ module: 'internal_coherence', module_result_id: null, score: 74, confidence: 0.8, weight: 0.1 }],
            knowability_ceiling: 80, knowability_notes: 'mostly named sourcing',
            raw_weighted_score: 74, final_score: 74, ceiling_binding: false,
            overall_confidence: 0.72,
            top_strengths: [], top_concerns: [], disputes: []
        },
        ...overrides
    };
}

test.beforeEach(async () => { await clear(); });

test('happy path: imports, stores the run, creates the prediction', async () => {
    const summary = await importAuditJson(scorerExport(), { localArticleHash: HASH });
    assert.equal(summary.articleHash, HASH);
    assert.equal(summary.modulesValid, 2);
    assert.equal(summary.modulesFailed, 0);
    assert.equal(summary.predictionsImported, 1);
    assert.equal(summary.alreadyImported, false);

    const runs = await AuditRunModel.getByArticleHash(HASH);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].source, 'cli-import');
    assert.deepEqual(runs[0].auditor, { kind: 'pipeline', id: PIPELINE.id, constituents: PIPELINE.constituents });
    assert.equal(runs[0].aggregate.final_score, 74);
    assert.equal(runs[0].aggregate.ceiling_source, 'heuristic:source-quality/1.0',
        'RQ2 default when the export predates the ceiling-source field');
    assert.equal(runs[0].aggregate.model_estimated_ceiling, null);

    const preds = await PredictionModel.getByArticleHash(HASH);
    assert.equal(preds.length, 1);
    assert.equal(preds[0].hedge_level, 'confident');
    assert.equal(preds[0].attributed_to, 'named_source');
    assert.equal(preds[0].attributed_source_name, 'the minister');
    assert.equal(preds[0].horizon, 'by December');
    assert.equal(preds[0].criteria, 'program shut down by Dec 31');
    assert.equal(preds[0].evidence_quote, 'would end by December');
    assert.equal(preds[0].resolution_status, 'open');

    // Attribution survives at every level (RQ3): the module result and
    // the prediction keep their MODEL auditor; only the run carries
    // the pipeline. A silent fallback-to-pipeline would flatten the
    // identity layer the published events depend on.
    const coherence = runs[0].moduleResults.find((r) => r.module === 'internal_coherence');
    assert.deepEqual(coherence.auditor, { kind: 'model', id: 'anthropic/claude-sonnet-4-6' });
    assert.deepEqual(preds[0].auditor, { kind: 'model', id: 'anthropic/claude-sonnet-4-6' });
});

test('malformed predictions are skipped with reasons, never imported or failed-the-file', async () => {
    const json = scorerExport();
    json.predictions = [
        ...json.predictions,
        { ...json.predictions[0], prediction_text: 'Hedge chaos.', prediction: 'Hedge chaos.', hedge_level: 'certain' },
        { ...json.predictions[0], prediction_text: 'No criteria.', prediction: 'No criteria.', resolution_criteria: '' }
    ];
    const summary = await importAuditJson(json, { localArticleHash: HASH });
    assert.equal(summary.predictionsImported, 1);
    assert.equal(summary.predictionsSkipped, 2);
    assert.match(summary.skippedPredictions[0].reason, /invalid hedge_level/);
    assert.match(summary.skippedPredictions[1].reason, /no resolution criteria/,
        'a prediction the 30058 builder could never publish is not a ledger entry');
    assert.equal((await PredictionModel.getByArticleHash(HASH)).length, 1);
});

test('top-level score/confidence diverging from validated findings fails the module — no naked authority', async () => {
    const tampered = coherenceResult({ score: 95 });   // findings say 74
    const summary = await importAuditJson(scorerExport({
        module_results: [tampered, predictionExtraction()]
    }), { localArticleHash: HASH });
    assert.equal(summary.modulesFailed, 1);
    assert.match(summary.failedModules[0].reason, /diverge from findings/);

    // And the stored values come FROM the findings on the clean path.
    await clear();
    const clean = await importAuditJson(scorerExport(), { localArticleHash: HASH });
    assert.equal(clean.modulesFailed, 0);
    const run = (await AuditRunModel.getByArticleHash(HASH))[0];
    const coherence = run.moduleResults.find((r) => r.module === 'internal_coherence');
    assert.equal(coherence.score, 74);
    assert.equal(coherence.confidence, 0.8);
});

test('ceiling_binding is DERIVED from raw vs ceiling — the file flag is never trusted', async () => {
    // raw 92 > ceiling 80, final 80 — internally consistent, but the
    // file lies about binding. The badge's cap context depends on
    // this flag; derive it.
    const hidden = scorerExport();
    hidden.aggregate.raw_weighted_score = 92;
    hidden.aggregate.final_score = 80;
    hidden.aggregate.ceiling_binding = false;
    await importAuditJson(hidden, { localArticleHash: HASH });
    const run = (await AuditRunModel.getByArticleHash(HASH))[0];
    assert.equal(run.aggregate.ceiling_binding, true,
        'a tampered file cannot hide a binding ceiling');
});

test('an invalid ceiling_source rejects — provenance has a closed grammar (RQ2)', async () => {
    const bad = scorerExport();
    bad.aggregate.ceiling_source = 'banana';
    await assert.rejects(importAuditJson(bad, { localArticleHash: HASH }),
        /ceiling_source is not a valid provenance/);
});

test('the hash gate: corrupt and mismatched files never persist anything', async () => {
    // Claimed hash disagrees with the body — corrupt or tampered.
    const corrupt = scorerExport();
    corrupt.article.hash = 'f'.repeat(64);
    await assert.rejects(importAuditJson(corrupt), /does not match its body_markdown/);

    // The audit is internally consistent but about DIFFERENT text than
    // the local capture — refuse: the audit must be about text the
    // user actually captured.
    await assert.rejects(importAuditJson(scorerExport(), { localArticleHash: 'e'.repeat(64) }),
        /scored different text than your capture/);

    // Nothing persisted by either rejection.
    assert.equal((await AuditRunModel.getByArticleHash(HASH)).length, 0);
    assert.equal((await PredictionModel.getByArticleHash(HASH)).length, 0);
});

test('per-module failure posture: one bad module never rejects the file', async () => {
    const broken = coherenceResult();
    broken.findings.contradictions = [{ type: 'numerical' }];   // missing required fields
    const summary = await importAuditJson(scorerExport({
        module_results: [broken, predictionExtraction()]
    }), { localArticleHash: HASH });
    assert.equal(summary.modulesValid, 1);
    assert.equal(summary.modulesFailed, 1);
    assert.equal(summary.failedModules[0].module, 'internal_coherence');
    assert.match(summary.failedModules[0].reason, /schema validation/);

    const run = (await AuditRunModel.getByArticleHash(HASH))[0];
    const failed = run.moduleResults.find((r) => r.module === 'internal_coherence');
    assert.equal(failed.failed, true);
    assert.equal(failed.score, null, 'failed runs carry no score — excluded from aggregation');
    assert.ok(failed.auditor_caveats.some((c) => c.includes('failed schema validation')),
        'the failure is recorded as a caveat, never silent');
});

test('scorer-reported _error modules store as failed runs', async () => {
    const errored = {
        module: 'omission', module_version: '1.0',
        auditor: { kind: 'model', id: 'anthropic/claude-sonnet-4-6' },
        run_at: RUN_AT, score: null, confidence: null,
        findings: { error: 'API call failed: 529' },
        evidence_quotes: [], auditor_caveats: ['API call failed: 529'],
        _error: true
    };
    const summary = await importAuditJson(scorerExport({
        module_results: [coherenceResult(), errored]
    }), { localArticleHash: HASH });
    assert.equal(summary.modulesValid, 1);
    assert.equal(summary.failedModules[0].reason, 'scorer-reported error');
});

test('a file where EVERY module fails is rejected — nothing importable', async () => {
    const broken = coherenceResult();
    delete broken.findings.auditor_caveats;
    await assert.rejects(importAuditJson(scorerExport({ module_results: [broken] }),
        { localArticleHash: HASH }), /every module result failed/);
});

test('a contradictory aggregate rejects the import — it is the badge record', async () => {
    const bad = scorerExport();
    bad.aggregate.final_score = 90;   // > ceiling 80
    await assert.rejects(importAuditJson(bad, { localArticleHash: HASH }),
        /internally contradictory/);
    const noConf = scorerExport();
    delete noConf.aggregate.overall_confidence;
    await assert.rejects(importAuditJson(noConf, { localArticleHash: HASH }),
        /overall_confidence/);
});

test('re-import is idempotent: same run converges, predictions never duplicate', async () => {
    await importAuditJson(scorerExport(), { localArticleHash: HASH });
    const second = await importAuditJson(scorerExport(), { localArticleHash: HASH });
    assert.equal(second.alreadyImported, true);
    assert.equal((await AuditRunModel.getByArticleHash(HASH)).length, 1);
    assert.equal((await PredictionModel.getByArticleHash(HASH)).length, 1);
});

// ------------------------------------------------------------------
// 13.8 review hardening — version trust boundary + contribution rows
// ------------------------------------------------------------------

test('wrapper module_version diverging from findings.version fails the module (wire address would dangle)', async () => {
    const json = scorerExport({
        module_results: [coherenceResult({ module_version: '1.1' }), predictionExtraction()]
    });
    const summary = await importAuditJson(json, { localArticleHash: HASH });
    assert.equal(summary.modulesFailed, 1);
    assert.match(summary.failedModules[0].reason, /module_version diverges/);
    const runs = await AuditRunModel.getByArticleHash(HASH);
    const stored = runs[0].moduleResults.find((m) => m.module === 'internal_coherence');
    assert.equal(stored.failed, true);
    assert.equal(stored.score, null, 'failed posture — never publishes');
});

test('missing wrapper module_version adopts findings.version — the d-preimage source of truth', async () => {
    const result = coherenceResult({
        findings: {
            module: 'internal_coherence', version: '1.2',
            score: 74, confidence: 0.8,
            auditor_caveats: ['x'], contradictions: [], logical_gaps: []
        }
    });
    delete result.module_version;
    const summary = await importAuditJson(
        scorerExport({ module_results: [result, predictionExtraction()] }),
        { localArticleHash: HASH });
    assert.equal(summary.modulesFailed, 0);
    const runs = await AuditRunModel.getByArticleHash(HASH);
    const stored = runs[0].moduleResults.find((m) => m.module === 'internal_coherence');
    assert.equal(stored.module_version, '1.2',
        'stored version = findings.version, so every later address derivation agrees with the wire');
});

test('malformed module_contributions reject the import — never coerced to fabricated zeros at publish', async () => {
    const json = scorerExport();
    json.aggregate.module_contributions = [
        { module: 'internal_coherence', score: 74, confidence: '0.8', weight: 0.1 }
    ];
    await assert.rejects(importAuditJson(json, { localArticleHash: HASH }), /malformed row/);
});

test('imported predictions persist the extraction methodology version from their own run', async () => {
    const extraction = predictionExtraction();
    extraction.findings.version = '1.3';
    delete extraction.module_version;   // wrapper absent — findings win
    await importAuditJson(
        scorerExport({ module_results: [coherenceResult(), extraction] }),
        { localArticleHash: HASH });
    const preds = await PredictionModel.getByArticleHash(HASH);
    assert.equal(preds[0].module_version, '1.3',
        'the published 30058 states the version that actually produced it');
});

// ------------------------------------------------------------------
// 13.9 phase review — import-gate parity with the builders
// ------------------------------------------------------------------

test('lenient aggregate run_at (Date.parse-valid, builder-invalid) rejects at the door', async () => {
    for (const sloppy of ['2026-06-11T12:00:00', '2026-06-11 20:14:09Z', 'March 7, 2026']) {
        const json = scorerExport();
        json.aggregate.run_at = sloppy;
        await assert.rejects(importAuditJson(json, { localArticleHash: HASH }),
            /strict ISO-8601/, `must reject: ${sloppy}`);
    }
});

test('lenient PER-MODULE run_at fails that module (the rest import) — no permanently unpublishable runs', async () => {
    const summary = await importAuditJson(
        scorerExport({ module_results: [coherenceResult({ run_at: '2026-06-11T12:00:00' }), predictionExtraction()] }),
        { localArticleHash: HASH });
    assert.equal(summary.modulesFailed, 1);
    assert.match(summary.failedModules[0].reason, /strict ISO-8601/);
    assert.equal(summary.modulesValid, 1);
});

test('human auditor with a non-64-hex id is treated as absent — the run falls back, never imports unpublishable', async () => {
    const json = scorerExport();
    json.aggregate.auditor = { kind: 'human', id: 'bryan' };
    const summary = await importAuditJson(json, { localArticleHash: HASH });
    assert.equal(summary.modulesFailed, 0);
    const runs = await AuditRunModel.getByArticleHash(HASH);
    assert.equal(runs[0].auditor.kind, 'pipeline',
        'invalid human id → the import fallback, which the builders accept');
});

test('horizon_iso that is not strict YYYY-MM-DD degrades to null — the horizon STRING stays', async () => {
    const json = scorerExport();
    json.predictions[0].resolution_horizon_iso = '2026-12-31T00:00:00Z';
    await importAuditJson(json, { localArticleHash: HASH });
    const preds = await PredictionModel.getByArticleHash(HASH);
    assert.equal(preds[0].horizon_iso, null);
    assert.equal(preds[0].horizon, 'by December', 'display text survives');
});

test('corrected re-import (same run identity) updates the ledger and clears changed publish marks', async () => {
    const first = await importAuditJson(scorerExport(), { localArticleHash: HASH });
    assert.equal(first.alreadyImported, false);
    // Mark the module published, then re-import a CORRECTED file
    // whose findings changed for that module.
    await AuditRunModel.markEventPublished(first.runId, 'mod:internal_coherence', 'e'.repeat(64), 'f'.repeat(64));
    const corrected = scorerExport({
        module_results: [
            coherenceResult({
                score: 80,
                findings: {
                    module: 'internal_coherence', version: '1.0',
                    score: 80, confidence: 0.8,
                    auditor_caveats: ['Corrected.'], contradictions: [], logical_gaps: []
                }
            }),
            predictionExtraction()
        ]
    });
    const second = await importAuditJson(corrected, { localArticleHash: HASH });
    assert.equal(second.alreadyImported, true);
    assert.equal(second.ledgerUpdated, true, 'the corrected contents replace the stale record');
    const runs = await AuditRunModel.getByArticleHash(HASH);
    const stored = runs[0].moduleResults.find((m) => m.module === 'internal_coherence');
    assert.equal(stored.score, 80, 'the ledger holds the corrected findings');
    assert.equal(runs[0].events['mod:internal_coherence'], undefined,
        'the changed module\'s publish mark cleared — the next publish re-emits it');

    // And a byte-identical third import is the no-op it claims.
    const third = await importAuditJson(corrected, { localArticleHash: HASH });
    assert.equal(third.alreadyImported, true);
    assert.equal(third.ledgerUpdated, false);
});

test('run provenance: opts.source is recorded; in-extension runs say background', async () => {
    const summary = await importAuditJson(scorerExport(), { localArticleHash: HASH, source: 'background' });
    assert.equal(summary.modulesValid, 2);
    const runs = await AuditRunModel.getByArticleHash(HASH);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].source, 'background',
        'an in-reader run must not masquerade as a CLI import');
});

test('run provenance: an unknown source is rejected by the model, not silently stored', async () => {
    await assert.rejects(
        () => importAuditJson(scorerExport(), { localArticleHash: HASH, source: 'carrier-pigeon' }),
        /source must be one of/
    );
    assert.equal((await AuditRunModel.getByArticleHash(HASH)).length, 0, 'nothing persisted');
});

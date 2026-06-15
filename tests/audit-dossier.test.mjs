// Phase 13.3 — dossier rollup math: shrinkage, per-module means,
// the calibration rate table, and the logged-not-activated
// calibration_v1 block. Reproducibility is the contract: same inputs,
// same numbers, always.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_SHRINKAGE_K, shrink, normalizeEventBeats, computeDossier
} from '../src/shared/audit/dossier.js';

function close(actual, expected, label) {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} !== ~${expected}`);
}

test('shrink: the §4 formula exactly — n=0 fully shrunk, n=k halfway, n→∞ raw', () => {
    assert.equal(DEFAULT_SHRINKAGE_K, 10, 'the schema\'s recommended starting constant');
    assert.deepEqual(shrink(50, 0, 10, 77), { shrunk: 77, factor: 1 });
    const halfway = shrink(60, 10, 10, 80);
    close(halfway.shrunk, 70, 'n = k pulls exactly halfway');
    close(halfway.factor, 0.5, 'factor at n = k');
    const heavy = shrink(60, 1000, 10, 80);
    assert.ok(Math.abs(heavy.shrunk - 60) < 0.5, 'volume overwhelms the prior');
    assert.throws(() => shrink(60, -1, 10, 80), /non-negative integer/);
    assert.throws(() => shrink(60, 5, 0, 80), /k must be positive/);
});

test('normalizeEventBeats: canonical aggregates, aliases map, unmapped go to review — never mint (RQ8)', () => {
    const { canonical, unmapped } = normalizeEventBeats(
        ['monetary-policy', 'fed', 'crypto', 'novel-topic', 'monetary-policy']);
    assert.deepEqual(canonical, ['monetary-policy'], 'alias folded in, duplicate dropped');
    assert.deepEqual(unmapped, ['crypto', 'novel-topic'],
        'crypto is deliberately unmapped — review list, not bitcoin');
});

test('computeDossier: a worked rollup — every number recomputable by hand', () => {
    const rollup = computeDossier({
        aggregates: [
            { finalScore: 80, moduleContributions: [
                { module: 'omission', score: 75, confidence: 0.8 },
                { module: 'source_quality', score: 60, confidence: 0.7 },
                // Sub-0.6 confidence: a number the display rules
                // refuse to show must not move a reputation — the
                // aggregate-level rule, applied per module (13.9).
                { module: 'internal_coherence', score: 95, confidence: 0.4 }
            ] },
            { finalScore: 70, moduleContributions: [
                { module: 'omission', score: 65, confidence: 0.9 },
                { module: 'source_quality', score: null, confidence: 0.9 },
                // No confidence at all = unknown — unknown never
                // feeds a mean.
                { module: 'internal_coherence', score: 88 }
            ] },
            { finalScore: 90, moduleContributions: [] }
        ],
        resolvedPredictions: [
            { hedge_level: 'confident', outcome: 'true' },    // brier 0.01
            { hedge_level: 'confident', outcome: 'false' },   // brier 0.81
            { hedge_level: 'hedged', outcome: 'unresolvable' } // excluded
        ],
        totalPredictions: 5,
        k: 10,
        populationMean: 77
    });

    assert.equal(rollup.articleCount, 3);
    close(rollup.scoreMeanRaw, 80, 'raw mean of 80/70/90');
    // shrunk = (3/13)·80 + (10/13)·77 = 77.69…
    close(rollup.scoreMean, 77.69, 'shrunk toward population 77 at n=3, k=10');
    close(rollup.shrinkageFactor, 0.7692, 'factor published with every rollup');
    assert.equal(rollup.scoreMedian, 80);
    close(rollup.scoreStdev, 8.16, 'population stdev of 80/70/90');
    assert.deepEqual(rollup.perModuleMeans, { omission: 70, source_quality: 60 },
        'null scores, sub-0.6-confidence scores, and confidence-less scores all excluded, never zeroed');
    assert.equal(rollup.predictions.total, 5);
    assert.equal(rollup.predictions.resolved, 2, 'unresolvable excluded everywhere');
    assert.equal(rollup.predictions.calibration.confident.rate, 0.5);
    close(rollup.predictions.calibration_v1.mean_brier, 0.41, 'mean of 0.01 and 0.81');
    assert.equal(rollup.predictions.calibration_v1.multiplier, null,
        'logged, NOT activated — no rollup ever applies it in v1 (RQ4)');
});

test('computeDossier: zero articles = the population prior, honestly labeled', () => {
    const rollup = computeDossier({ aggregates: [], populationMean: 77 });
    assert.equal(rollup.articleCount, 0);
    assert.equal(rollup.scoreMeanRaw, null);
    assert.equal(rollup.scoreMean, 77, 'no data → the prior, factor 1');
    assert.equal(rollup.shrinkageFactor, 1);
    assert.equal(rollup.scoreMedian, null);
    assert.equal(rollup.predictions.resolved, 0);
});

test('computeDossier: default total is the RESOLVED count — unresolvables need an explicit total', () => {
    // When the caller doesn't supply totalPredictions, total defaults
    // to the resolved count (total ≥ resolved stays consistent);
    // unresolvable entries are excluded from both. A caller tracking
    // open + unresolvable predictions passes totalPredictions
    // explicitly.
    const rollup = computeDossier({
        aggregates: [],
        resolvedPredictions: [
            { hedge_level: 'confident', outcome: 'true' },
            { hedge_level: 'hedged', outcome: 'unresolvable' }
        ],
        populationMean: 77
    });
    assert.equal(rollup.predictions.resolved, 1);
    assert.equal(rollup.predictions.total, 1, 'default total = resolved count, never raw array length');
});

test('computeDossier: deterministic — same inputs, same rollup (reproducibility, P12)', () => {
    const inputs = {
        aggregates: [{ finalScore: 73.4 }, { finalScore: 81.2 }],
        resolvedPredictions: [{ hedge_level: 'speculative', outcome: 'partial' }],
        populationMean: 77
    };
    assert.deepEqual(computeDossier(inputs), computeDossier(inputs));
});

test('computeDossier: auditor-kind-agnostic — identity never enters the math (RQ3)', () => {
    const a = computeDossier({
        aggregates: [{ finalScore: 70, auditor: { kind: 'human', id: 'h'.repeat(64) } }],
        populationMean: 77
    });
    const b = computeDossier({
        aggregates: [{ finalScore: 70, auditor: { kind: 'pipeline', id: 'xray-auditor/0.1.0' } }],
        populationMean: 77
    });
    assert.deepEqual(a, b, 'a human-scored 70 rolls up exactly like a pipeline-scored 70');
});

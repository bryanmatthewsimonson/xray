// Phase 13.1 — calibration-v1 (RQ4): specified now, logged, NOT
// activated. These tests pin the published assumption and P7's
// ordering, and pin that the multiplier never activates in v1.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    CALIBRATION_VERSION, HEDGE_IMPLIED_PROBABILITY, MIN_RESOLVED_FOR_DISPLAY,
    brierScore, calibrationRateTable, calibrationV1, inactiveMultiplierV1
} from '../src/shared/audit/calibration.js';

function close(actual, expected, label) {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} !== ~${expected}`);
}

test('the published probability mapping (RQ4, verbatim)', () => {
    assert.equal(CALIBRATION_VERSION, 'calibration-v1');
    assert.deepEqual({ ...HEDGE_IMPLIED_PROBABILITY },
        { confident: 0.90, hedged: 0.70, speculative: 0.55 });
});

test('Brier worked costs from the RQ4 answer, exactly', () => {
    close(brierScore('confident', 'false'), 0.81, 'confident-wrong');
    close(brierScore('hedged', 'false'), 0.49, 'hedged-wrong');
    close(brierScore('confident', 'true'), 0.01, 'confident-right');
    close(brierScore('hedged', 'true'), 0.09, 'hedged-right');
});

test('P7 ordering falls out automatically', () => {
    // Confident-wrong costs more than hedged-wrong costs more than
    // speculative-wrong; confident-right beats hedged-right beats
    // speculative-right (lower Brier = better).
    assert.ok(brierScore('confident', 'false') > brierScore('hedged', 'false'));
    assert.ok(brierScore('hedged', 'false') > brierScore('speculative', 'false'));
    assert.ok(brierScore('confident', 'true') < brierScore('hedged', 'true'));
    assert.ok(brierScore('hedged', 'true') < brierScore('speculative', 'true'));
});

test('negative predictions need no special case — the inversion is algebraic', () => {
    // Confident "X won't happen", X happens → prediction false:
    // (0.10 − 1)² = (0.90 − 0)² = 0.81. Scoring the prediction as
    // stated covers both signs.
    close(brierScore('confident', 'false'), Math.pow(0.10 - 1, 2), 'inversion identity');
});

test('partial scores against 0.5; unresolvable and unknowns are excluded', () => {
    close(brierScore('confident', 'partial'), 0.16, 'confident-partial');
    close(brierScore('speculative', 'partial'), 0.0025, 'speculative-partial');
    assert.equal(brierScore('confident', 'unresolvable'), null);
    assert.equal(brierScore('confident', 'nonsense'), null);
    assert.equal(brierScore('bold', 'true'), null, 'unknown hedge level excluded, never defaulted');
});

test('rate table: the canonical v1 display — resolved/true/rate per hedge', () => {
    const table = calibrationRateTable([
        { hedge_level: 'confident', outcome: 'true' },
        { hedge_level: 'confident', outcome: 'false' },
        { hedge_level: 'confident', outcome: 'partial' },
        { hedge_level: 'hedged', outcome: 'true' },
        { hedge_level: 'hedged', outcome: 'unresolvable' },   // excluded
        { hedge_level: 'speculative', outcome: 'false' }
    ]);
    assert.deepEqual(table.confident, { resolved: 3, true_count: 1, rate: 1 / 3 });
    assert.deepEqual(table.hedged, { resolved: 1, true_count: 1, rate: 1 });
    assert.deepEqual(table.speculative, { resolved: 1, true_count: 0, rate: 0 });
});

test('rate table: empty ledger yields null rates, zero counts', () => {
    const table = calibrationRateTable([]);
    for (const level of ['confident', 'hedged', 'speculative']) {
        assert.deepEqual(table[level], { resolved: 0, true_count: 0, rate: null });
    }
});

test('calibrationV1: mean Brier + count, multiplier ALWAYS null in v1', () => {
    const block = calibrationV1([
        { hedge_level: 'confident', outcome: 'false' },   // 0.81
        { hedge_level: 'confident', outcome: 'true' },    // 0.01
        { hedge_level: 'hedged', outcome: 'unresolvable' } // excluded
    ]);
    assert.equal(block.version, 'calibration-v1');
    assert.equal(block.resolved_count, 2);
    close(block.mean_brier, 0.41, 'mean of 0.81 and 0.01');
    assert.equal(block.multiplier, null, 'logged, not activated — multiplier stays null');

    const empty = calibrationV1([]);
    assert.equal(empty.mean_brier, null);
    assert.equal(empty.resolved_count, 0);
    assert.equal(empty.multiplier, null);
});

test('inactiveMultiplierV1: shape pinned for the future activation decision', () => {
    assert.equal(MIN_RESOLVED_FOR_DISPLAY, 10);
    // Below the display gate: null, no matter how good the record.
    assert.equal(inactiveMultiplierV1(0.0, 0.5, 9), null);
    // clamp(1 + 0.5·(B_pop − B_subject), 0.85, 1.15):
    close(inactiveMultiplierV1(0.2, 0.3, 10), 1.05, 'better than population');
    close(inactiveMultiplierV1(0.3, 0.2, 10), 0.95, 'worse than population');
    assert.equal(inactiveMultiplierV1(0.0, 1.0, 10), 1.15, 'upper clamp');
    assert.equal(inactiveMultiplierV1(1.0, 0.0, 10), 0.85, 'lower clamp');
});

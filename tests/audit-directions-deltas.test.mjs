// R10a/b tests — dimension directions + run-score deltas
// (founding-transcript integration; JOURNAL 2026-08-02). Pins:
// MODULE_DIRECTIONS covers every module with the PHILOSOPHY-sourced
// classification (module 1 penalty-only and module 4 credit-bearing
// are §3.1's own words; module 8 unscored; the rest bidirectional per
// §4's default), and runScoreDeltas computes the vintage trajectory
// newest-first with nulls where a comparison is impossible.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { MODULE_DIRECTIONS } = await import('../src/shared/audit/assemble.js');
const { MODULE_NAMES, OPINION_MODULE_NAMES } = await import('../src/shared/audit/findings-schemas.js');
const { runScoreDeltas } = await import('../src/shared/audit/display.js');

test('R10a: every module classified; §3.1 explicit rows pinned', () => {
    // Both families exactly (extended when the opinion family joined,
    // R5/OP.3) — no stragglers, no strangers.
    assert.deepEqual(Object.keys(MODULE_DIRECTIONS).sort(),
        [...MODULE_NAMES, ...OPINION_MODULE_NAMES].sort());
    const allowed = new Set(['penalty-only', 'credit-bearing', 'bidirectional', 'unscored']);
    for (const [m, d] of Object.entries(MODULE_DIRECTIONS)) {
        assert.ok(allowed.has(d), `${m}: ${d}`);
    }
    assert.equal(MODULE_DIRECTIONS.headline_body_fidelity, 'penalty-only',
        '§3.1: a headline cannot be better than accurate');
    assert.equal(MODULE_DIRECTIONS.source_quality, 'credit-bearing',
        '§3.1: linked primary sources earn points');
    assert.equal(MODULE_DIRECTIONS.prediction_extraction, 'unscored');
});

const run = (runAt, score) => ({ runAt, aggregate: score === null ? {} : { final_score: score } });

test('R10b: deltas newest-first vs the run before; nulls at the edges', () => {
    const rows = runScoreDeltas([run('2026-08-02', 74), run('2026-07-01', 78), run('2026-06-01', 71)]);
    assert.deepEqual(rows, [
        { runAt: '2026-08-02', score: 74, delta: -4 },
        { runAt: '2026-07-01', score: 78, delta: 7 },
        { runAt: '2026-06-01', score: 71, delta: null }
    ]);
});

test('R10b: score-less runs break the chain without breaking neighbors', () => {
    const rows = runScoreDeltas([run('c', 80), run('b', null), run('a', 70)]);
    assert.equal(rows[0].delta, null, 'no comparison across a score-less run');
    assert.equal(rows[1].delta, null);
    assert.equal(rows[2].delta, null);
    assert.deepEqual(runScoreDeltas([]), []);
    assert.deepEqual(runScoreDeltas(null), []);
});

// X-Ray — prediction-ledger calibration (Phase 13, slice 13.1).
//
// Two layers, per RQ4 (docs/EPISTEMIC_AUDIT_DESIGN.md §Calibration):
//
//   1. The per-hedge RATE TABLE — canonical for v1. Per hedge level:
//      how many resolved, how many true, the rate. This is what the
//      dossier block displays and the 30060 content carries.
//
//   2. `calibration-v1` — SPECIFIED NOW, LOGGED, NOT ACTIVATED. A
//      proper scoring rule (Brier) over resolved predictions. The
//      probability mapping is a published assumption (P12); the
//      multiplier is never applied to any score in v1 — activation is
//      a future, explicit decision once the ledger has volume, and
//      display is gated behind MIN_RESOLVED_FOR_DISPLAY. There was no
//      lost formula to recover: the original prose fixed only P7's
//      ordering constraints (confident-wrong > hedged-wrong in cost;
//      confident-right > hedged-right in credit), which Brier
//      satisfies automatically.

export const CALIBRATION_VERSION = 'calibration-v1';

// Hedge level → implied probability assigned to the prediction as
// stated. A published assumption (P12) — empirically recalibrating it
// against the corpus later is itself a publishable finding.
export const HEDGE_IMPLIED_PROBABILITY = Object.freeze({
    confident: 0.90,
    hedged: 0.70,
    speculative: 0.55
});

// Below this many resolved predictions, a multiplier is noise dressed
// as judgment (RQ4) — display nothing.
export const MIN_RESOLVED_FOR_DISPLAY = 10;

// 30059 outcome → Brier outcome value for the prediction as stated.
// `unresolvable` is excluded from calibration entirely (null).
//
// Negative predictions need no special case: the answer's inversion
// (confident "X won't happen" → p(X) = 0.10, scored against whether X
// happened) is algebraically identical to scoring the prediction as
// stated with its hedge probability — (0.10 − 1)² = (0.90 − 0)² — so
// scoring p(prediction) against outcome(prediction) covers both signs.
const OUTCOME_VALUES = Object.freeze({
    'true': 1,
    'false': 0,
    'partial': 0.5
});

/**
 * Brier score for one resolved prediction: (p − outcome)², lower is
 * better. Returns null for unresolvable outcomes or unknown hedge
 * levels (excluded from calibration, never defaulted).
 *
 * P7's ordering, verified in tests: confident-wrong 0.81 >
 * hedged-wrong 0.49; confident-right 0.01 < hedged-right 0.09.
 *
 * @param {string} hedgeLevel - confident|hedged|speculative
 * @param {string} outcome - true|false|partial|unresolvable
 * @returns {number|null}
 */
export function brierScore(hedgeLevel, outcome) {
    const p = HEDGE_IMPLIED_PROBABILITY[hedgeLevel];
    if (p === undefined) return null;
    if (!Object.prototype.hasOwnProperty.call(OUTCOME_VALUES, outcome)) return null;
    const o = OUTCOME_VALUES[outcome];
    return (p - o) * (p - o);
}

/**
 * The canonical v1 rate table: per hedge level, {resolved, true_count,
 * rate}. `partial` counts as resolved but not true; `unresolvable` is
 * excluded. Input: [{hedge_level, outcome}].
 *
 * @param {Array<{hedge_level: string, outcome: string}>} resolutions
 * @returns {object} { confident: {resolved, true_count, rate}, hedged: …, speculative: … }
 */
export function calibrationRateTable(resolutions) {
    const table = {};
    for (const level of Object.keys(HEDGE_IMPLIED_PROBABILITY)) {
        table[level] = { resolved: 0, true_count: 0, rate: null };
    }
    for (const r of resolutions || []) {
        const row = table[r.hedge_level];
        if (!row) continue;
        if (!Object.prototype.hasOwnProperty.call(OUTCOME_VALUES, r.outcome)) continue;
        row.resolved += 1;
        if (r.outcome === 'true') row.true_count += 1;
    }
    for (const level of Object.keys(table)) {
        const row = table[level];
        row.rate = row.resolved > 0 ? row.true_count / row.resolved : null;
    }
    return table;
}

/**
 * The informational calibration-v1 block (RQ4): mean Brier over the
 * scoreable resolutions, the count, and `multiplier: null` — ALWAYS
 * null in v1; the field exists so the wire shape is stable when
 * activation happens, and stays null until that explicit decision.
 *
 * @param {Array<{hedge_level: string, outcome: string}>} resolutions
 * @returns {{version: string, mean_brier: number|null, resolved_count: number, multiplier: null}}
 */
export function calibrationV1(resolutions) {
    let sum = 0;
    let n = 0;
    for (const r of resolutions || []) {
        const b = brierScore(r.hedge_level, r.outcome);
        if (b === null) continue;
        sum += b;
        n += 1;
    }
    return {
        version: CALIBRATION_VERSION,
        mean_brier: n > 0 ? Number((sum / n).toFixed(4)) : null,
        resolved_count: n,
        multiplier: null
    };
}

/**
 * The eventual multiplier — NOT ACTIVATED IN v1, exported only so its
 * shape is pinned by tests and ready for the future activation
 * decision: clamp(1 + β·(B_population − B_subject), 0.85, 1.15),
 * β ≈ 0.5, applied to dossier rollups only — NEVER retroactively to
 * article vintage scores (P9) — and displayed only at
 * ≥ MIN_RESOLVED_FOR_DISPLAY resolved predictions. Nothing in v1
 * calls this with intent to apply it.
 *
 * @param {number} subjectMeanBrier
 * @param {number} populationMeanBrier
 * @param {number} resolvedCount
 * @param {number} [beta=0.5]
 * @returns {number|null} the would-be multiplier, or null below the
 *   display gate
 */
export function inactiveMultiplierV1(subjectMeanBrier, populationMeanBrier, resolvedCount, beta = 0.5) {
    if (!(resolvedCount >= MIN_RESOLVED_FOR_DISPLAY)) return null;
    if (typeof subjectMeanBrier !== 'number' || typeof populationMeanBrier !== 'number') return null;
    const raw = 1 + beta * (populationMeanBrier - subjectMeanBrier);
    return Math.min(1.15, Math.max(0.85, raw));
}

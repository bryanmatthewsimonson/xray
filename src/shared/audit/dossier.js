// X-Ray — dossier rollup math (Phase 13, slice 13.3).
//
// Dossiers are DERIVED, REPRODUCIBLE views over published audit
// events (the canonical form is computed-on-open in the portal; the
// 30060 snapshot is a cache). This module is the pure math: anyone
// with the same events and the same parameters derives the same
// numbers — PHILOSOPHY §9 "reproducible rollups".
//
// Shrinkage (§4): rolled-up scores for low-volume subjects are pulled
// toward the population mean —
//   shrunk = (n/(n+k))·raw_mean + (k/(n+k))·population_mean
// with k ≈ 10 as the starting constant. The applied factor is
// published with every rollup; a raw three-article mean is never
// presented as a stable reputation.

import { normalizeBeat } from './beats.js';
import { calibrationRateTable, calibrationV1 } from './calibration.js';

export const DEFAULT_SHRINKAGE_K = 10;

/**
 * Bayesian shrinkage toward the population mean. Returns
 * {shrunk, factor} where factor = k/(n+k) — 0 means no shrinkage,
 * 1 fully shrunk (n = 0).
 */
export function shrink(rawMean, n, k, populationMean) {
    if (!Number.isFinite(rawMean) || !Number.isFinite(populationMean)) {
        throw new Error('shrink: rawMean and populationMean must be finite numbers');
    }
    if (!Number.isInteger(n) || n < 0) throw new Error(`shrink: n must be a non-negative integer (got ${n})`);
    if (!Number.isFinite(k) || k <= 0) throw new Error(`shrink: k must be positive (got ${k})`);
    const factor = k / (n + k);
    const shrunk = (n / (n + k)) * rawMean + factor * populationMean;
    return { shrunk: Number(shrunk.toFixed(2)), factor: Number(factor.toFixed(4)) };
}

function median(values) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stdev(values, mean) {
    if (values.length === 0) return null;
    const variance = values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / values.length;
    return Math.sqrt(variance);
}

/**
 * Normalize an event's beat tags against beats-v1: canonical slugs
 * aggregate, unmapped tags go to the review list — they NEVER mint
 * dossier subjects (RQ8).
 *
 * @param {string[]} beats - raw t-tag values
 * @returns {{canonical: string[], unmapped: string[]}}
 */
export function normalizeEventBeats(beats) {
    const canonical = [];
    const unmapped = [];
    for (const b of beats || []) {
        const slug = normalizeBeat(b);
        if (slug) {
            if (!canonical.includes(slug)) canonical.push(slug);
        } else if (typeof b === 'string' && b && !unmapped.includes(b)) {
            unmapped.push(b);
        }
    }
    return { canonical, unmapped };
}

/**
 * Compute a dossier rollup from parsed aggregate audits (30057s, or
 * local equivalents carrying finalScore + moduleContributions) and
 * the subject's resolved predictions.
 *
 * The caller has already scoped the inputs to one subject and one
 * window — this function only does the math, so the same inputs
 * always produce the same rollup (reproducibility is the point).
 * Auditor-kind-agnostic by construction: nothing here reads auditor
 * identity (RQ3).
 *
 * @param {object} params
 * @param {Array<{finalScore: number, moduleContributions?: Array<{module: string, score: number|null}>}>} params.aggregates
 * @param {Array<{hedge_level: string, outcome: string}>} [params.resolvedPredictions]
 * @param {number} [params.totalPredictions] - open + resolved count for the summary
 * @param {number} [params.k] - shrinkage constant
 * @param {number} params.populationMean
 * @returns {object} the rollup, 30060-content-shaped where it overlaps
 */
export function computeDossier({
    aggregates,
    resolvedPredictions = [],
    totalPredictions = null,
    k = DEFAULT_SHRINKAGE_K,
    populationMean
}) {
    if (!Array.isArray(aggregates)) throw new Error('computeDossier: aggregates must be an array');
    const scores = aggregates
        .map((a) => a && a.finalScore)
        .filter((s) => typeof s === 'number' && Number.isFinite(s));
    const n = scores.length;
    const rawMean = n > 0 ? scores.reduce((a, b) => a + b, 0) / n : null;
    const { shrunk, factor } = n > 0
        ? shrink(rawMean, n, k, populationMean)
        : { shrunk: Number(populationMean.toFixed(2)), factor: 1 };

    // Per-module means over every contribution that carried a score.
    const byModule = {};
    for (const a of aggregates) {
        for (const c of (a && a.moduleContributions) || []) {
            if (typeof c.score !== 'number' || !Number.isFinite(c.score)) continue;
            (byModule[c.module] = byModule[c.module] || []).push(c.score);
        }
    }
    const perModuleMeans = {};
    for (const [mod, vals] of Object.entries(byModule)) {
        perModuleMeans[mod] = Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1));
    }

    const calibration = calibrationRateTable(resolvedPredictions);
    const resolvedCount = Object.values(calibration).reduce((acc, row) => acc + row.resolved, 0);

    return {
        articleCount: n,
        scoreMeanRaw: rawMean === null ? null : Number(rawMean.toFixed(2)),
        scoreMean: shrunk,                     // the shrunk mean — what displays
        scoreMedian: median(scores) === null ? null : Number(median(scores).toFixed(1)),
        scoreStdev: rawMean === null ? null : Number(stdev(scores, rawMean).toFixed(2)),
        shrinkageK: k,
        populationMean,
        shrinkageFactor: factor,
        perModuleMeans,
        predictions: {
            total: totalPredictions === null ? resolvedCount : totalPredictions,
            resolved: resolvedCount,
            calibration,
            calibration_v1: calibrationV1(resolvedPredictions)   // multiplier: null — logged, not activated (RQ4)
        }
    };
}

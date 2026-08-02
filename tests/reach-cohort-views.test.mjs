// R6/R7 tests — reach view + cohort context (founding-transcript
// integration; JOURNAL 2026-08-02). Pins: the reach view is
// coverage-honest (null when nothing carries reach; no-data counted,
// never guessed), log10 damping keeps a viral outlier from owning the
// weighted mean, least-visible sorts ascending; reachFromEventTags
// prefers view_count and never invents a number; the local population
// gates domains at n ≥ 3 and honors the same hash-join/confidence
// discipline as the dossier; and the canonical rollup fields are
// untouched by any of it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { computeReachView } = await import('../src/shared/audit/dossier.js');
const {
    reachFromEventTags, localAuditedPopulation, computeEntityDossier
} = await import('../src/portal/audit-data.js');

test('R6 reach view: log10 weighting, ascending least-visible, no-data disclosed', () => {
    const view = computeReachView([
        { finalScore: 60, reach: 0, label: 'quiet' },        // w = log10(10) = 1
        { finalScore: 90, reach: 990, label: 'viral' },      // w = log10(1000) = 3
        { finalScore: 80, reach: null, label: 'web article' }
    ]);
    assert.equal(view.weightedMean, 82.5, '(1·60 + 3·90) / 4');
    assert.equal(view.covered, 2);
    assert.equal(view.total, 3);
    assert.equal(view.noReachData, 1);
    assert.deepEqual(view.leastVisible.map((x) => x.label), ['quiet', 'viral']);
    assert.equal(computeReachView([{ finalScore: 70, reach: null, label: 'x' }]), null,
        'no covered rows → no view, never a guess');
    assert.equal(computeReachView([]), null);
});

test('R6 reach signal: view_count wins; engagement sums; absence stays null', () => {
    assert.equal(reachFromEventTags([['view_count', '5000'], ['engagement_likes', '10']]), 5000);
    assert.equal(reachFromEventTags([
        ['engagement_likes', '10'], ['engagement_shares', '5'], ['engagement_comments', '2']
    ]), 17);
    assert.equal(reachFromEventTags([['engagement_likes', '10']]), 10);
    assert.equal(reachFromEventTags([['t', 'article']]), null, 'ordinary web article: no reach');
    assert.equal(reachFromEventTags([['view_count', 'garbage']]), null);
});

const item = (url, domain, hash) => ({
    typeKey: 'article', url, domain, title: url,
    extra: { articleHash: hash }, event: { tags: [] }
});
const agg = (score, conf = 0.8, auditorId = 'a1') => ({
    finalScore: score, confidence: conf, auditor: { id: auditorId }, moduleContributions: []
});
const indexWith = (byHash) => ({
    aggregatesByHash: new Map(Object.entries(byHash)),
    aggregatesByUrl: new Map()
});

test('R7 local population: domain cohorts gate at n≥3; sub-0.6 excluded', () => {
    const items = [
        item('https://a.com/1', 'a.com', 'h1'),
        item('https://a.com/2', 'a.com', 'h2'),
        item('https://a.com/3', 'a.com', 'h3'),
        item('https://b.com/1', 'b.com', 'h4')
    ];
    const index = indexWith({
        h1: [agg(80)], h2: [agg(70)], h3: [agg(90)],
        h4: [agg(50, 0.4)]                    // below the display floor
    });
    const pop = localAuditedPopulation(items, index, new Map());
    assert.equal(pop.n, 3, 'the sub-0.6 judgment never moves a population either');
    assert.equal(pop.mean, 80);
    assert.deepEqual(pop.domains, { 'a.com': { n: 3, mean: 80 } }, 'b.com below the n≥3 gate');
    assert.equal(localAuditedPopulation([], index, new Map()), null);
});

test('R6/R7: views attach beside the rollup; canonical fields untouched', () => {
    const inputs = {
        aggregates: [{ finalScore: 80, moduleContributions: [] }],
        resolvedPredictions: [], totalPredictions: 0,
        auditedArticles: 1, excludedForReview: 0, unmappedBeats: [],
        reachRows: [{ finalScore: 80, reach: 100, label: 'a post' }],
        domains: ['a.com']
    };
    const dossier = computeEntityDossier(inputs, {
        localPopulation: { n: 5, mean: 76.2, domains: { 'a.com': { n: 3, mean: 74 } } }
    });
    assert.ok(dossier.views.reach);
    assert.equal(dossier.views.localPopulation.mean, 76.2);
    assert.deepEqual(dossier.views.domainCohorts, [{ domain: 'a.com', n: 3, mean: 74 }]);
    assert.equal(dossier.populationMean, 77, 'canonical shrink target unmoved');
    assert.equal(typeof dossier.scoreMean, 'number', 'canonical rollup intact');
    const bare = computeEntityDossier({ ...inputs, reachRows: [], domains: [] });
    assert.equal(bare.views, null, 'no signals → no views object at all');
});

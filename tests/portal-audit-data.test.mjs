// Phase 13.7 — the portal's audit data joins. Fixtures use the
// PRODUCTION item shape (extras spread FLAT, the buildItem contract);
// one test goes through the real buildItems pipeline end-to-end so
// the library↔audit-data seam can never silently split again.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// library.js transitively imports Storage (chrome at module load).
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const {
    buildAuditIndex, mergeLocalRuns, mergeLocalResolutions, auditsForArticle,
    latestAuditFor, dossierInputsForEntity, computeEntityDossier,
    predictionsDue, resolverIdentity, DEFAULT_POPULATION_MEAN
} = await import('../src/portal/audit-data.js');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const PK = 'c'.repeat(64);
const ENTITY_PK = 'd'.repeat(64);

// PRODUCTION SHAPE: extras flat on the item (buildItem's `...extra`).
function articleItem({ hash = HASH_A, url = 'https://example.com/a', pTags = [] } = {}) {
    return {
        typeKey: 'article',
        url,
        articleHash: hash,
        event: { kind: 30023, pubkey: PK, tags: [['r', url], ...(hash ? [['x', hash]] : []), ...pTags] }
    };
}

function aggregateItem({ hash = HASH_A, url = 'https://example.com/a', score = 74, conf = 0.8, runAt = '2026-06-11T20:00:00Z', auditorId = 'xray-auditor/0.1.0', d = 'agg:1234123412341234' } = {}) {
    return {
        typeKey: 'audit',
        articleHash: hash,
        auditRole: 'aggregate',
        parsedAudit: {
            id: d, articleHash: hash, url, runAt,
            finalScore: score, rawScore: score, ceiling: 90,
            ceilingBinding: false, ceilingSource: 'heuristic:source-quality/1.0',
            confidence: conf, knowabilityNotes: '',
            auditor: { kind: 'pipeline', id: auditorId },
            moduleContributions: [{ module: 'omission', score: 70 }]
        },
        event: { kind: 30057, pubkey: PK, tags: [] }
    };
}

function predictionItem({ hash = HASH_A, d = 'pred:1111111111111111', text = 'X by December.', hedge = 'confident', horizonIso = '2026-12-31' } = {}) {
    return {
        typeKey: 'prediction',
        articleHash: hash,
        parsedPrediction: { id: d, articleHash: hash, text, hedgeLevel: hedge, horizonIso, horizon: 'by December' },
        event: { kind: 30058, pubkey: PK, tags: [] }
    };
}

function resolutionItem({ coord = `30058:${PK}:pred:1111111111111111`, outcome = 'true', resolvedAt = '2027-01-02T00:00:00Z' } = {}) {
    return {
        typeKey: 'prediction',
        parsedResolution: { id: 'res:x', predictionCoord: coord, outcome, resolvedAt, articleHash: HASH_A },
        event: { kind: 30059, pubkey: PK, tags: [] }
    };
}

test('hash-first joins: scores never transfer across hashes — even when the hash finds nothing', () => {
    const index = buildAuditIndex([
        aggregateItem({ hash: HASH_A, url: 'https://example.com/a' }),
        aggregateItem({ hash: HASH_B, url: 'https://example.com/a', score: 30, conf: 0.9, runAt: '2026-06-12T08:00:00Z', d: 'agg:5678567856785678' })
    ]);
    const hashed = auditsForArticle(index, articleItem({ hash: HASH_A }));
    assert.equal(hashed.runs.length, 1);
    assert.equal(hashed.joinedBy, 'hash');
    assert.equal(latestAuditFor(index, articleItem({ hash: HASH_A })).final_score, 74);

    // THE invariant: an article WITH a hash that finds no audits gets
    // an empty result — never the URL-mates' scores.
    const miss = auditsForArticle(index, articleItem({ hash: 'e'.repeat(64) }));
    assert.deepEqual(miss.runs, []);
    assert.equal(miss.joinedBy, 'hash');

    // A pre-13.4 article (no x tag) falls back to URL — marked advisory.
    const legacy = auditsForArticle(index, articleItem({ hash: null }));
    assert.equal(legacy.runs.length, 2);
    assert.equal(legacy.joinedBy, 'url');
    assert.equal(latestAuditFor(index, articleItem({ hash: null })).joinedBy, 'url',
        'the chip layer can mark URL matches as text-unverified');
});

test('PRODUCTION pipeline: buildItems output joins without any fixture shimming', async () => {
    const { buildItems } = await import('../src/portal/library.js');
    const { buildModuleResultEvent, buildAggregateAuditEvent, buildPredictionEntryEvent } =
        await import('../src/shared/audit/builders.js');

    const findings = {
        module: 'internal_coherence', version: '1.0', score: 62, confidence: 0.78,
        auditor_caveats: ['x'], contradictions: [], logical_gaps: []
    };
    const mod = await buildModuleResultEvent({
        articleHash: HASH_A, module: 'internal_coherence', runAt: '2026-06-11T20:14:00Z',
        findings, articleUrl: 'https://example.com/a',
        auditor: { kind: 'model', id: 'anthropic/claude-sonnet-4-6' }
    });
    const agg = await buildAggregateAuditEvent({
        articleHash: HASH_A, runAt: '2026-06-11T20:14:05Z',
        finalScore: 64.5, rawScore: 71.2, ceiling: 80,
        ceilingSource: 'heuristic:source-quality/1.0', confidence: 0.71,
        articleUrl: 'https://example.com/a',
        auditor: { kind: 'pipeline', id: 'xray-auditor/0.1.0' }
    });
    const pred = await buildPredictionEntryEvent({
        articleHash: HASH_A, predictionText: 'X by December.',
        predictionType: 'explicit', hedgeLevel: 'confident', attribution: 'article_voice',
        horizon: 'by December', horizonIso: '2026-12-31', criteria: 'c',
        tractability: 'publicly_resolvable', evidenceQuote: 'q', moduleVersion: '1.0',
        auditor: { kind: 'model', id: 'anthropic/claude-sonnet-4-6' }
    });
    const articleEvent = {
        kind: 30023, pubkey: PK, created_at: 1765000000, id: '1'.repeat(64),
        tags: [['d', 'dddd'], ['title', 'T'], ['r', 'https://example.com/a'], ['x', HASH_A]],
        content: 'body'
    };
    const records = [articleEvent, { ...mod.event, pubkey: PK, id: '2'.repeat(64) },
        { ...agg.event, pubkey: PK, id: '3'.repeat(64) },
        { ...pred.event, pubkey: PK, id: '4'.repeat(64) }]
        .map((event) => ({ event, relays: [] }));

    const items = buildItems(records, { entityIndex: {} });
    const article = items.find((i) => i.typeKey === 'article');
    assert.equal(article.articleHash, HASH_A, 'buildItem extracts the x tag FLAT');

    const index = buildAuditIndex(items);
    const { runs, joinedBy } = auditsForArticle(index, article);
    assert.equal(joinedBy, 'hash', 'the hash join fires on real items');
    assert.equal(runs.length, 1);
    assert.equal(runs[0].finalScore, 64.5);
    assert.equal((index.modulesByHash.get(HASH_A) || []).length, 1);
    assert.equal(index.predictions.length, 1);
    assert.equal(index.predictions[0].coordinate, `30058:${PK}:${pred.dTag}`);
});

test('local runs merge without double-listing — including hashes with NO relay copy', () => {
    const index = buildAuditIndex([aggregateItem({ runAt: '2026-06-11T20:00:00Z' })]);
    mergeLocalRuns(index, [
        { id: 'audit_1', articleHash: HASH_A, runAt: '2026-06-11T20:00:00Z',
            auditor: { kind: 'pipeline', id: 'xray-auditor/0.1.0' },
            aggregate: { final_score: 74, overall_confidence: 0.8 } },
        // A never-published import on a hash the relays know nothing
        // about — the ONLY kind of run that exists before 13.8.
        { id: 'audit_2', articleHash: HASH_B, runAt: '2026-06-12T09:00:00Z',
            auditor: { kind: 'pipeline', id: 'xray-auditor/0.1.0' },
            aggregate: {
                final_score: 71, overall_confidence: 0.7, raw_weighted_score: 88,
                knowability_ceiling: 71, ceiling_binding: true,
                ceiling_source: 'heuristic:source-quality/1.0', knowability_notes: 'n'
            } }
    ]);
    assert.equal(index.aggregatesByHash.get(HASH_A).length, 1, 'published copy wins');
    const localOnly = auditsForArticle(index, articleItem({ hash: HASH_B }));
    assert.equal(localOnly.runs.length, 1, 'local-only hashes surface too');
    const a = localOnly.runs[0];
    assert.equal(a.source, 'local');
    // The 13.1-record → parsed-event field mapping, pinned.
    assert.equal(a.finalScore, 71);
    assert.equal(a.rawScore, 88);
    assert.equal(a.ceiling, 71);
    assert.equal(a.ceilingBinding, true);
    assert.equal(a.ceilingSource, 'heuristic:source-quality/1.0');
    assert.equal(a.confidence, 0.7);
});

test('entity dossier: per-article auditor dedup, hash-scoped predictions, honest counts', () => {
    const items = [
        articleItem({ hash: HASH_A, pTags: [['p', ENTITY_PK, '', 'author']] }),
        articleItem({ hash: HASH_B, url: 'https://example.com/b', pTags: [['p', ENTITY_PK, '', 'author']] }),
        aggregateItem({ hash: HASH_A, score: 80, runAt: '2026-06-12T08:00:00Z' }),
        aggregateItem({ hash: HASH_A, score: 60, runAt: '2026-06-10T08:00:00Z', d: 'agg:0000111100001111' }),  // older, same auditor — superseded
        aggregateItem({ hash: HASH_B, url: 'https://example.com/b', score: 70, runAt: '2026-06-12T09:00:00Z', d: 'agg:2222333322223333' }),  // SAME auditor, second article — counts
        predictionItem({ hash: HASH_A }),
        predictionItem({ hash: 'f'.repeat(64), d: 'pred:9999999999999999', text: 'Other article.' }),  // outside the entity — excluded
        resolutionItem({})
    ];
    const index = buildAuditIndex(items);
    const inputs = dossierInputsForEntity(items, index, ENTITY_PK);
    assert.equal(inputs.aggregates.length, 2, 'latest per (article, auditor) — dedup resets per article');
    assert.equal(inputs.auditedArticles, 2);
    assert.equal(inputs.totalPredictions, 1, 'predictions scope to the entity\'s audited hashes');
    assert.deepEqual(inputs.resolvedPredictions, [{ hedge_level: 'confident', outcome: 'true' }]);

    const dossier = computeEntityDossier(inputs);
    assert.equal(dossier.auditedArticles, 2);
    assert.equal(dossier.judgments, 2);
    assert.equal(dossier.populationMean, DEFAULT_POPULATION_MEAN);
    assert.equal(dossier.predictions.calibration_v1.multiplier, null, 'logged, never applied');

    assert.equal(dossierInputsForEntity(items, index, 'e'.repeat(64)), null,
        'no audited articles → no dossier, not an empty one');
    assert.equal(computeEntityDossier(null), null,
        'null passthrough — every unaudited entity view depends on this');
    assert.deepEqual(dossier.unmappedBeats, inputs.unmappedBeats);
});

test('sub-0.6-confidence aggregates are EXCLUDED from the rollup and counted', () => {
    const items = [
        articleItem({ pTags: [['p', ENTITY_PK, '', 'author']] }),
        aggregateItem({ score: 95, conf: 0.5, runAt: '2026-06-12T08:00:00Z' }),
        aggregateItem({ score: 70, conf: 0.8, runAt: '2026-06-11T08:00:00Z', auditorId: 'other-auditor/1.0', d: 'agg:4444555544445555' })
    ];
    const index = buildAuditIndex(items);
    const inputs = dossierInputsForEntity(items, index, ENTITY_PK);
    assert.equal(inputs.aggregates.length, 1, 'a number the display refuses must not move a reputation');
    assert.equal(inputs.aggregates[0].finalScore, 70);
    assert.equal(inputs.excludedForReview, 1);

    // ALL excluded → no dossier at all.
    const onlyReview = [
        articleItem({ pTags: [['p', ENTITY_PK, '', 'author']] }),
        aggregateItem({ score: 95, conf: 0.5 })
    ];
    assert.equal(dossierInputsForEntity(onlyReview, buildAuditIndex(onlyReview), ENTITY_PK), null);
});

test('predictions due: merged, deduped, windowed — overdue included, boundary inclusive, local resolutions clear', () => {
    const index = buildAuditIndex([
        predictionItem({ d: 'pred:1111111111111111', horizonIso: '2026-07-01' }),
        predictionItem({ d: 'pred:2222222222222222', text: 'Resolved on relay.', horizonIso: '2026-07-15' }),
        resolutionItem({ coord: `30058:${PK}:pred:2222222222222222` }),
        predictionItem({ d: 'pred:6666666666666666', text: 'OVERDUE.', horizonIso: '2026-05-01' }),
        predictionItem({ d: 'pred:7777777777777777', text: 'Exactly at limit.', horizonIso: '2026-09-09' }),
        predictionItem({ d: 'pred:3333333333333333', text: 'Far future.', horizonIso: '2027-06-01' }),
        predictionItem({ d: 'pred:4444444444444444', text: 'Unscheduled.', horizonIso: null })
    ]);
    const local = [
        { id: 'pred_1111111111111111', text: 'X by December.', hedge_level: 'confident',
            horizon_iso: '2026-07-01', resolution_status: 'open' },
        { id: 'pred_5555555555555555', text: 'Local-only call.', hedge_level: 'hedged',
            horizon_iso: '2026-06-20', resolution_status: 'open' },
        { id: 'pred_8888888888888888', text: 'Locally resolved.', hedge_level: 'hedged',
            horizon_iso: '2026-06-25', resolution_status: 'open' }
    ];
    // A locally-filed (unpublished) resolution under the resolver's
    // own coordinate — must clear the prediction by sha16 identity.
    mergeLocalResolutions(index, [{
        prediction_coord: `30058:${'9'.repeat(64)}:pred:8888888888888888`,
        outcome: 'false', resolved_at: 1765000000
    }]);

    const nowMs = Date.parse('2026-06-11T00:00:00Z');
    const { due, unscheduled, openCount } = predictionsDue(index, local, { nowMs, windowDays: 90 });

    assert.deepEqual(due.map((p) => p.key), [
        '6666666666666666',   // overdue leads — most important entry on the strip
        '5555555555555555',   // 2026-06-20 local-only
        '1111111111111111',   // 2026-07-01 (deduped — published copy)
        '7777777777777777'    // exactly at now+90d — inclusive
    ]);
    assert.equal(due[2].source, 'relay', 'published copy wins the dedup');
    assert.equal(unscheduled, 1);
    assert.equal(openCount, 6, 'open = due(4) + far-future(1) + unscheduled(1); resolved entries cleared');
});

test('resolverIdentity: signer first, never the bare sync key', () => {
    assert.equal(resolverIdentity([]), null);
    assert.equal(resolverIdentity([{ pubkey: 'k1', sources: ['sync-key'] }]), null,
        'the sync key signs entity blobs, never audit events');
    assert.equal(resolverIdentity([
        { pubkey: 'k1', sources: ['sync-key'] },
        { pubkey: 'k2', sources: ['publish-history'] },
        { pubkey: 'k3', sources: ['signer'] }
    ]).pubkey, 'k3', 'the signer wins regardless of order');
    assert.equal(resolverIdentity([
        { pubkey: 'k1', sources: ['sync-key'] },
        { pubkey: 'k2', sources: ['manual'] }
    ]).pubkey, 'k2');
});

// ------------------------------------------------------------------
// 13.9 phase review — prior-vintage joins, URL-join dossier purity,
// unscheduled Resolve reachability
// ------------------------------------------------------------------

test('prior-vintage hash join: audits anchored to an earlier capture surface, marked, never silently lost', () => {
    const index = buildAuditIndex([
        aggregateItem({ hash: HASH_B, url: 'https://example.com/a' })   // audited the OLD vintage
    ]);
    const current = articleItem({ hash: HASH_A, url: 'https://example.com/a' });   // republished, new x

    // Without the vintage map: silently empty (the pre-13.9 failure).
    const blind = auditsForArticle(index, current);
    assert.deepEqual(blind.runs, []);

    // With it: the audit surfaces as a HASH join to PRIOR text.
    const priorMap = new Map([['https://example.com/a', [HASH_A, HASH_B]]]);
    const found = auditsForArticle(index, current, priorMap);
    assert.equal(found.runs.length, 1);
    assert.equal(found.joinedBy, 'hash');
    assert.equal(found.vintage, 'prior', 'the chip layer marks it as anchored to earlier text');

    // Current-hash audits always win and read vintage: current.
    const both = buildAuditIndex([
        aggregateItem({ hash: HASH_A, url: 'https://example.com/a' }),
        aggregateItem({ hash: HASH_B, url: 'https://example.com/a', d: 'agg:9999999999999999' })
    ]);
    const fresh = auditsForArticle(both, current, priorMap);
    assert.equal(fresh.vintage, 'current');
    assert.equal(fresh.runs.length, 1);
});

test('dossier refuses URL-joined (advisory) audits — counted, never aggregated', () => {
    // A hashless pre-13.4 article whose URL matches a published
    // aggregate: the chip may show it (marked), the dossier must not
    // let an unverified-text score move a reputation.
    const agg = aggregateItem({ hash: HASH_B, url: 'https://example.com/legacy', conf: 0.9 });
    const index = buildAuditIndex([agg]);
    const legacyArticle = articleItem({ hash: null, url: 'https://example.com/legacy', pTags: [['p', ENTITY_PK, '', 'author']] });
    const inputs = dossierInputsForEntity([legacyArticle], index, ENTITY_PK);
    assert.equal(inputs, null, 'URL-joined runs alone produce NO dossier');

    // And alongside a hash-joined article, they are counted out.
    const hashedArticle = articleItem({ hash: HASH_A, url: 'https://example.com/a', pTags: [['p', ENTITY_PK, '', 'author']] });
    const index2 = buildAuditIndex([
        agg, aggregateItem({ hash: HASH_A, url: 'https://example.com/a' })
    ]);
    const inputs2 = dossierInputsForEntity([legacyArticle, hashedArticle], index2, ENTITY_PK);
    assert.equal(inputs2.aggregates.length, 1, 'only the hash-joined run aggregates');
    assert.equal(inputs2.excludedUrlJoined, 1, 'the advisory join is counted, not hidden');
});

test('predictionsDue returns the unscheduled OPEN list — the scorer never emits horizon_iso, and Resolve… must reach those', () => {
    const index = buildAuditIndex([
        predictionItem({ d: 'pred:2222222222222222', text: 'Unscheduled thing.', horizonIso: null })
    ]);
    const { due, unscheduled, unscheduledList } = predictionsDue(index, [], {
        nowMs: Date.parse('2026-06-12T00:00:00Z'), windowDays: 90
    });
    assert.equal(due.length, 0);
    assert.equal(unscheduled, 1);
    assert.equal(unscheduledList.length, 1);
    assert.equal(unscheduledList[0].text, 'Unscheduled thing.');
    assert.ok(unscheduledList[0].coordinate, 'relay-sourced entries carry the coordinate the Resolve form needs');
});

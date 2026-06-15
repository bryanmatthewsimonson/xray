// Phase 13.8 — the ordered audit publish batch.
//
// assembleAuditBatch is pure over passed-in ledger records (no
// IndexedDB), so these tests pin the contract directly: publish
// ordering (30056s → 30057 → 30058s → 30059s), the three skip rules
// (failed modules never publish, already-published events resume
// instead of duplicating, foreign-pubkey resolution coordinates are
// refused), per-event marks, and the claim back-reference (RQ6).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { assembleAuditBatch } from '../src/shared/audit/publish-batch.js';

const HASH = 'a'.repeat(64);
const USER_PK = 'f'.repeat(64);
const OTHER_PK = '9'.repeat(64);
const RUN_AT = '2026-06-11T20:14:05Z';
const MODEL = { kind: 'model', id: 'anthropic/claude-sonnet-4-6' };
const URL = 'https://example.com/story';

function sha16(s) {
    return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
}
function firstTag(event, name) { return event.tags.find((t) => t[0] === name); }
function tagsNamed(event, name) { return event.tags.filter((t) => t[0] === name); }

const COHERENCE_FINDINGS = {
    module: 'internal_coherence', version: '1.0',
    score: 62, confidence: 0.78,
    auditor_caveats: ['Surface scan only.'],
    contradictions: [], logical_gaps: []
};

const OMISSION_FINDINGS = {
    module: 'omission', version: '1.0', score: 70, confidence: 0.8,
    auditor_caveats: ['x'],
    topic_summary: 't', voices_directly_quoted: [], voices_paraphrased_only: [],
    voices_referenced_but_silent: [], natural_stakeholder_set: [],
    voices_expected_but_absent: [], speaks_for_instances: []
};

function makeRun(overrides = {}) {
    return {
        id: 'audit_1234567890abcdef',
        articleHash: HASH,
        auditor: MODEL,
        runAt: RUN_AT,
        source: 'cli-import',
        moduleResults: [
            {
                module: 'internal_coherence', module_version: '1.0',
                run_at: RUN_AT, auditor: MODEL,
                score: 62, confidence: 0.78,
                findings: COHERENCE_FINDINGS,
                evidence_quotes: [], failed: false
            },
            {
                module: 'omission', module_version: '1.0',
                run_at: RUN_AT, auditor: MODEL,
                score: 70, confidence: 0.8,
                findings: OMISSION_FINDINGS,
                evidence_quotes: [], failed: false
            },
            {
                module: 'source_quality', module_version: '1.0',
                run_at: RUN_AT, auditor: MODEL,
                score: null, confidence: null,
                findings: null, evidence_quotes: [], failed: true
            }
        ],
        aggregate: {
            final_score: 64.5, raw_weighted_score: 71.2,
            knowability_ceiling: 80, ceiling_source: 'heuristic:source-quality/1.0',
            overall_confidence: 0.71, knowability_notes: 'sourcing pattern',
            model_estimated_ceiling: null,
            module_contributions: [
                { module: 'internal_coherence', score: 62, confidence: 0.78, weight: 0.10 },
                { module: 'omission', score: 70, confidence: 0.8, weight: 0.15 },
                { module: 'source_quality', score: null, confidence: 0, weight: 0.20 }
            ],
            top_strengths: [], top_concerns: []
        },
        events: {},
        ...overrides
    };
}

const PRED_TEXT = 'Rates will fall by December.';
const PRED_ID = `pred_${sha16(`${HASH}|rates will fall by december.`)}`;

function makePrediction(overrides = {}) {
    return {
        id: PRED_ID,
        articleHash: HASH,
        text: PRED_TEXT,
        type: 'explicit',
        hedge_level: 'confident',
        attributed_to: 'article_voice',
        attributed_source_name: null,
        condition: null,
        horizon: 'by the end of the year',
        horizon_iso: '2026-12-31',
        criteria: 'target below current on Dec 31',
        tractability: 'publicly_resolvable',
        evidence_quote: 'rates will come down',
        anchor: null,
        claim_ref: null,
        auditor: MODEL,
        publishedAt: null,
        publishedEventId: null,
        ...overrides
    };
}

const OWN_PRED_COORD = `30058:${USER_PK}:pred:${sha16(`${HASH}|rates will fall by december.`)}`;

function makeResolution(overrides = {}) {
    return {
        id: `res_${sha16(OWN_PRED_COORD)}`,
        prediction_coord: OWN_PRED_COORD,
        outcome: 'true',
        evidence: [{ kind: 'url', value: 'https://example.com/followup', description: 'follow-up' }],
        notes: '',
        confidence: 0.95,
        auditor: { kind: 'human', id: USER_PK },
        resolved_at: 1781208845,        // 2026-06-11T20:14:05Z
        publishedAt: null,
        publishedEventId: null,
        ...overrides
    };
}

test('full batch: 30056s → 30057 → 30058 → 30059, with per-event marks', async () => {
    const { entries, skipped } = await assembleAuditBatch({
        articleHash: HASH, userPubkey: USER_PK,
        runs: [makeRun()],
        predictions: [makePrediction()],
        resolutions: [makeResolution()],
        articleUrl: URL
    });

    assert.deepEqual(entries.map((e) => e.event.kind), [30056, 30056, 30057, 30058, 30059],
        'the design ordering — referenced events always precede their referencers');

    // Marks: resumability is per event, keyed back into the ledger.
    assert.deepEqual(entries[0].mark, { type: 'run-event', runId: 'audit_1234567890abcdef', eventKey: 'mod:internal_coherence' });
    assert.deepEqual(entries[1].mark, { type: 'run-event', runId: 'audit_1234567890abcdef', eventKey: 'mod:omission' });
    assert.deepEqual(entries[2].mark, { type: 'run-event', runId: 'audit_1234567890abcdef', eventKey: 'agg' });
    assert.deepEqual(entries[3].mark, { type: 'prediction', id: PRED_ID });
    assert.deepEqual(entries[4].mark, { type: 'resolution', id: `res_${sha16(OWN_PRED_COORD)}` });

    // Dependency keys for the publisher's defer-on-failure discipline:
    // a resolution's predictionCoord must equal the coordinate its
    // prediction entry carries, or the publisher can't link them.
    assert.equal(entries[3].coord, OWN_PRED_COORD);
    assert.equal(entries[4].predictionCoord, OWN_PRED_COORD);

    // The failed module never publishes — counted, not silent.
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].reason, /failed result/);
    assert.match(skipped[0].what, /source_quality/);

    // The aggregate's contributions reference exactly the publishable
    // modules' coordinates (failed module contributes no coord).
    const agg = entries[2].event;
    const contribCoords = tagsNamed(agg, 'a')
        .filter((t) => t[1].startsWith('30056:'))
        .map((t) => t[1]);
    assert.equal(contribCoords.length, 2);
    const cohD = 'mod:' + sha16(`${HASH}|internal_coherence|1.0|${RUN_AT}`);
    assert.ok(contribCoords.includes(`30056:${USER_PK}:${cohD}`),
        'contribution coordinate recomputable from the record, minted under the signing pubkey');

    // Resolution timestamps convert epoch → strict ISO seconds.
    assert.deepEqual(firstTag(entries[4].event, 'resolved-at'),
        ['resolved-at', '2026-06-11T20:14:05Z']);
});

test('resume: already-published events skip, the rest still publish', async () => {
    const run = makeRun({
        events: {
            'mod:internal_coherence': { publishedAt: 1781208000, publishedEventId: '1'.repeat(64) }
        }
    });
    const { entries, skipped } = await assembleAuditBatch({
        articleHash: HASH, userPubkey: USER_PK,
        runs: [run],
        predictions: [makePrediction({ publishedAt: 1781208000, publishedEventId: '2'.repeat(64) })],
        resolutions: [],
        articleUrl: URL
    });

    assert.deepEqual(entries.map((e) => e.event.kind), [30056, 30057],
        'only the unpublished module + the aggregate go out');
    assert.equal(entries[0].mark.eventKey, 'mod:omission');

    // The resumed aggregate STILL references the previously-published
    // module's coordinate — replaceable addresses are stable.
    const cohD = 'mod:' + sha16(`${HASH}|internal_coherence|1.0|${RUN_AT}`);
    assert.ok(tagsNamed(entries[1].event, 'a').some((t) => t[1] === `30056:${USER_PK}:${cohD}`),
        'a resume must not orphan the aggregate from its already-published constituents');

    const reasons = skipped.map((s) => s.reason);
    assert.equal(reasons.filter((r) => /already published/.test(r)).length, 2,
        'one module + one prediction skipped as already published');
});

test('aggregate-only resume: published agg skips, run contributes nothing twice', async () => {
    const run = makeRun({
        events: {
            'mod:internal_coherence': { publishedAt: 1, publishedEventId: '1'.repeat(64) },
            'mod:omission': { publishedAt: 1, publishedEventId: '2'.repeat(64) },
            'agg': { publishedAt: 1, publishedEventId: '3'.repeat(64) }
        }
    });
    const { entries, skipped } = await assembleAuditBatch({
        articleHash: HASH, userPubkey: USER_PK,
        runs: [run], predictions: [], resolutions: [], articleUrl: URL
    });
    assert.equal(entries.length, 0);
    assert.equal(skipped.filter((s) => /already published/.test(s.reason)).length, 3);
});

test('run without a scored aggregate: modules publish, aggregate is a counted skip', async () => {
    const run = makeRun({ aggregate: null });
    const { entries, skipped } = await assembleAuditBatch({
        articleHash: HASH, userPubkey: USER_PK,
        runs: [run], predictions: [], resolutions: [], articleUrl: URL
    });
    assert.deepEqual(entries.map((e) => e.event.kind), [30056, 30056]);
    assert.ok(skipped.some((s) => /no scored aggregate/.test(s.reason)));
});

test('claim back-reference (RQ6): promoted prediction carries the 30040 coordinate at its PUBLISHED address', async () => {
    const pred = makePrediction({
        claim_ref: { claim_id: 'claim_1234567890abcdef', pred_d: `pred:${sha16(`${HASH}|rates will fall by december.`)}` }
    });
    // The claim was published under a DIFFERENT key than today's
    // signing key — the back-reference must use the claim's actual
    // address, not the current signer.
    const { entries } = await assembleAuditBatch({
        articleHash: HASH, userPubkey: USER_PK,
        runs: [], predictions: [pred], resolutions: [],
        claimPubkeys: { claim_1234567890abcdef: OTHER_PK },
        articleUrl: URL
    });
    assert.equal(entries.length, 1);
    const claimTag = tagsNamed(entries[0].event, 'a').find((t) => t[1].startsWith('30040:'));
    assert.deepEqual(claimTag, ['a', `30040:${OTHER_PK}:claim_1234567890abcdef`, '', 'claim']);
});

test('promoted prediction DEFERS when its claim has no published address — and drags its resolution with it', async () => {
    const pred = makePrediction({
        claim_ref: { claim_id: 'claim_1234567890abcdef', pred_d: `pred:${sha16(`${HASH}|rates will fall by december.`)}` }
    });
    const { entries, skipped } = await assembleAuditBatch({
        articleHash: HASH, userPubkey: USER_PK,
        runs: [], predictions: [pred], resolutions: [makeResolution()],
        claimPubkeys: {},     // the claim failed (or never published) this batch
        articleUrl: URL
    });
    assert.equal(entries.length, 0, 'neither the 30058 nor its 30059 publishes');
    assert.ok(skipped.some((s) => /no published address yet/.test(s.reason)));
    assert.ok(skipped.some((s) => /its prediction deferred this batch/.test(s.reason)));
});

test('unpromoted prediction carries NO 30040 reference', async () => {
    const { entries } = await assembleAuditBatch({
        articleHash: HASH, userPubkey: USER_PK,
        runs: [], predictions: [makePrediction()], resolutions: [], articleUrl: URL
    });
    assert.equal(tagsNamed(entries[0].event, 'a').filter((t) => t[1].startsWith('30040:')).length, 0);
});

test('stale-identity resolution is RE-KEYED to the prediction\'s real address; remote and own publish verbatim', async () => {
    // Same d as the local prediction, foreign pubkey: OUR prediction
    // filed under an older signing identity. That address will never
    // exist — the machine re-files under the address the prediction
    // actually gets this batch, instead of dead-ending the user with
    // a skip whose remedy (the strip's Resolve…) is already gone.
    const staleCoord = `30058:${OTHER_PK}:pred:${sha16(`${HASH}|rates will fall by december.`)}`;
    const stale = makeResolution({
        id: `res_${sha16(staleCoord)}`,
        prediction_coord: staleCoord
    });
    // Foreign pubkey AND no local prediction counterpart: someone
    // else's published prediction, resolved by this user — a designed
    // workflow; the coordinate exists on relays. Publishes verbatim,
    // anchored to the prediction's own article hash.
    const remoteCoord = `30058:${OTHER_PK}:pred:${'0'.repeat(16)}`;
    const remoteHash = 'b'.repeat(64);
    const remote = makeResolution({
        id: `res_${sha16(remoteCoord)}`,
        prediction_coord: remoteCoord,
        article_hash: remoteHash
    });
    const { entries } = await assembleAuditBatch({
        articleHash: HASH, userPubkey: USER_PK,
        runs: [], predictions: [makePrediction()],
        resolutions: [stale, remote],
        articleUrl: URL
    });
    const resolutionEntries = entries.filter((e) => e.label === 'resolution');
    assert.equal(resolutionEntries.length, 2, 'both publish — one re-keyed, one verbatim');
    assert.deepEqual(firstTag(resolutionEntries[0].event, 'a'),
        ['a', OWN_PRED_COORD, '', 'prediction'],
        'the stale coordinate is re-keyed to the signing identity');
    assert.equal(resolutionEntries[0].mark.rekeyedCoord, OWN_PRED_COORD,
        'the mark carries the re-key so the ledger record follows the wire');
    assert.deepEqual(firstTag(resolutionEntries[1].event, 'a'),
        ['a', remoteCoord, '', 'prediction']);
    assert.deepEqual(firstTag(resolutionEntries[1].event, 'x'), ['x', remoteHash],
        'remote-prediction resolution anchors to ITS article, not the batch article');
    assert.equal(resolutionEntries[1].mark.rekeyedCoord, undefined);
});

test('resolution of a prediction PUBLISHED under another key references that live address verbatim', async () => {
    // The prediction already published under key A; signing now as B.
    // The address 30058:A:… exists on relays — the resolution must
    // reference it, not mint a B-address that will never exist.
    const pred = makePrediction({
        publishedAt: 100, publishedEventId: '4'.repeat(64), publishedPubkey: OTHER_PK
    });
    const liveCoord = `30058:${OTHER_PK}:pred:${sha16(`${HASH}|rates will fall by december.`)}`;
    const res = makeResolution({
        id: `res_${sha16(liveCoord)}`,
        prediction_coord: liveCoord
    });
    const { entries, skipped } = await assembleAuditBatch({
        articleHash: HASH, userPubkey: USER_PK,
        runs: [], predictions: [pred], resolutions: [res], articleUrl: URL
    });
    assert.ok(skipped.some((s) => /already published/.test(s.reason)), 'the prediction itself resumes-skips');
    assert.equal(entries.length, 1);
    assert.deepEqual(firstTag(entries[0].event, 'a'), ['a', liveCoord, '', 'prediction']);
    assert.equal(entries[0].mark.rekeyedCoord, undefined, 'no re-key — the address is live');
});

test('revised resolution re-emits (updated > publishedAt); unrevised resume-skips', async () => {
    const revised = makeResolution({ publishedAt: 100, publishedEventId: '5'.repeat(64), updated: 200 });
    const { entries } = await assembleAuditBatch({
        articleHash: HASH, userPubkey: USER_PK,
        runs: [], predictions: [makePrediction()], resolutions: [revised], articleUrl: URL
    });
    assert.equal(entries.filter((e) => e.label === 'resolution (revision)').length, 1,
        'update() bumps `updated`; the same d replaces the prior event — the model contract');

    const unrevised = makeResolution({ publishedAt: 200, publishedEventId: '5'.repeat(64), updated: 100 });
    const second = await assembleAuditBatch({
        articleHash: HASH, userPubkey: USER_PK,
        runs: [], predictions: [makePrediction()], resolutions: [unrevised], articleUrl: URL
    });
    assert.equal(second.entries.filter((e) => e.label.startsWith('resolution')).length, 0);
    assert.ok(second.skipped.some((s) => /already published/.test(s.reason)));
});

test('late atomization re-emits the published 30058 with its claim back-reference', async () => {
    const pred = makePrediction({
        publishedAt: 100, publishedEventId: '6'.repeat(64), publishedPubkey: USER_PK,
        claim_ref: { claim_id: 'claim_late0000000001', pred_d: `pred:${sha16(`${HASH}|rates will fall by december.`)}` },
        claim_ref_at: 200
    });
    const { entries } = await assembleAuditBatch({
        articleHash: HASH, userPubkey: USER_PK,
        runs: [], predictions: [pred], resolutions: [],
        claimPubkeys: { claim_late0000000001: USER_PK },
        articleUrl: URL
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].label, 'prediction (re-emit: claim link)');
    const claimTag = entries[0].event.tags.find((t) => t[0] === 'a' && t[1].startsWith('30040:'));
    assert.deepEqual(claimTag, ['a', `30040:${USER_PK}:claim_late0000000001`, '', 'claim']);
});

test('aggregate DEFERS when a scored module\'s build refuses — never publishes with silently dropped contributions', async () => {
    const run = makeRun();
    // Make the second scored module unbuildable while it imported as
    // valid (strict-ISO run_at violation reachable via legacy records).
    run.moduleResults[1].run_at = '2026-06-11 20:14:05';
    const { entries, skipped } = await assembleAuditBatch({
        articleHash: HASH, userPubkey: USER_PK,
        runs: [run], predictions: [], resolutions: [], articleUrl: URL
    });
    assert.deepEqual(entries.map((e) => e.event.kind), [30056], 'only the healthy module publishes');
    assert.ok(skipped.some((s) => /build refused/.test(s.reason)));
    assert.ok(skipped.some((s) => /misstate the run/.test(s.reason)), 'the aggregate defers, counted');
});

test('one malformed record never blocks the batch — counted as a refused build', async () => {
    const broken = makeResolution({ evidence: [] });   // 30059s are evidence-bound; the builder throws
    const { entries, skipped } = await assembleAuditBatch({
        articleHash: HASH, userPubkey: USER_PK,
        runs: [makeRun()], predictions: [makePrediction()],
        resolutions: [broken],
        articleUrl: URL
    });
    assert.deepEqual(entries.map((e) => e.event.kind), [30056, 30056, 30057, 30058],
        'everything else still publishes');
    assert.ok(skipped.some((s) => /build refused/.test(s.reason)));
});

test('every event anchors to its OWN record\'s hash, not the publish-time hash', async () => {
    const oldHash = 'c'.repeat(64);
    const run = makeRun({ articleHash: oldHash });
    run.moduleResults = [run.moduleResults[0]];
    const pred = makePrediction({ articleHash: oldHash });
    const { entries } = await assembleAuditBatch({
        articleHash: HASH,    // the CURRENT capture hash — records predate it
        userPubkey: USER_PK,
        runs: [run], predictions: [pred], resolutions: [], articleUrl: URL
    });
    for (const e of entries) {
        assert.deepEqual(firstTag(e.event, 'x'), ['x', oldHash],
            `${e.label}: anchored to the audited vintage`);
    }
});

test('30058 module-version comes from the record; the published d matches the entry coord', async () => {
    const pred = makePrediction({ module_version: '1.4' });
    const { entries } = await assembleAuditBatch({
        articleHash: HASH, userPubkey: USER_PK,
        runs: [], predictions: [pred], resolutions: [], articleUrl: URL
    });
    assert.deepEqual(firstTag(entries[0].event, 'module-version'), ['module-version', '1.4']);
    // The event's actual d (derived from the TEXT by the builder) must
    // agree with the coord the marks/resolutions key on (derived from
    // the record id) — the two derivations share their sha16 input.
    const wireD = firstTag(entries[0].event, 'd')[1];
    assert.equal(`30058:${USER_PK}:${wireD}`, entries[0].coord);
});

test('articleCoord and relayHint thread through to the events when supplied', async () => {
    const coord30023 = `30023:${USER_PK}:${'7'.repeat(16)}`;
    const { entries } = await assembleAuditBatch({
        articleHash: HASH, userPubkey: USER_PK,
        runs: [makeRun()], predictions: [makePrediction()], resolutions: [],
        articleUrl: URL, articleCoord: coord30023, relayHint: 'wss://relay.example'
    });
    for (const e of entries) {
        const articleTag = tagsNamed(e.event, 'a').find((t) => t[1] === coord30023);
        assert.ok(articleTag, `${e.label}: carries the 30023 join`);
        assert.equal(articleTag[2], 'wss://relay.example');
    }
});

test('events carry the article hash and never a stance — the audit/assessment firewall holds', async () => {
    const { entries } = await assembleAuditBatch({
        articleHash: HASH, userPubkey: USER_PK,
        runs: [makeRun()],
        predictions: [makePrediction()],
        resolutions: [makeResolution()],
        articleUrl: URL
    });
    for (const e of entries) {
        assert.deepEqual(firstTag(e.event, 'x'), ['x', HASH], `${e.label}: x = article hash`);
        for (const banned of ['stance', 'rating-value', 'L', 'l']) {
            assert.equal(firstTag(e.event, banned), undefined,
                `${e.label}: audit kinds never carry '${banned}'`);
        }
    }
});

test('empty ledger: empty batch, nothing throws', async () => {
    const { entries, skipped } = await assembleAuditBatch({
        articleHash: HASH, userPubkey: USER_PK,
        runs: [], predictions: [], resolutions: [], articleUrl: URL
    });
    assert.deepEqual(entries, []);
    assert.deepEqual(skipped, []);
});

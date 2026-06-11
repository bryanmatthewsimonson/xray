// Phase 13.3 — wire builders + parsers for kinds 30058–30061.
// Pinned-tag-vocabulary tests, the Phase-11 idiom.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
    buildPredictionEntryEvent, parsePredictionEntryEvent,
    buildPredictionResolutionEvent, parsePredictionResolutionEvent,
    buildDossierSnapshotEvent, parseDossierSnapshotEvent,
    buildAuditDisputeEvent, parseAuditDisputeEvent,
    derivePredictionEntryDTag, derivePredictionResolutionDTag,
    deriveDossierSnapshotDTag, deriveAuditDisputeDTag
} from '../src/shared/audit/builders.js';

const HASH = 'a'.repeat(64);
const MODEL = { kind: 'model', id: 'anthropic/claude-sonnet-4-6' };
const HUMAN = { kind: 'human', id: 'b'.repeat(64) };
const PIPELINE = { kind: 'pipeline', id: 'xray-auditor/0.1.0/anthropic/claude-sonnet-4-6' };
const URL = 'https://example.com/story?utm_source=feed';

function sha16(s) {
    return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
}
function firstTag(event, name) { return event.tags.find((t) => t[0] === name); }
function tagsNamed(event, name) { return event.tags.filter((t) => t[0] === name); }

function predictionArgs(overrides = {}) {
    return {
        articleHash: HASH,
        predictionText: 'Rates will fall by December.',
        predictionType: 'explicit',
        hedgeLevel: 'confident',
        attribution: 'named_source',
        attributedName: 'Chair Powell',
        horizon: 'by the end of the year',
        horizonIso: '2026-12-31',
        criteria: 'Fed funds target below current on Dec 31',
        tractability: 'publicly_resolvable',
        evidenceQuote: 'rates will come down before December',
        moduleVersion: '1.0',
        articleUrl: URL,
        auditor: MODEL,
        ...overrides
    };
}

test('30058: full tag shape; content is the prediction text and NOTHING else', async () => {
    const { event, body, dTag } = await buildPredictionEntryEvent(predictionArgs({
        claimCoord: `30040:${'c'.repeat(64)}:claim_1234567890abcdef`,
        authorEntityPubkey: 'd'.repeat(64),
        anchor: [{ type: 'TextQuoteSelector', exact: 'rates will come down' }]
    }));

    assert.equal(event.kind, 30058);
    assert.equal(body, 'Rates will fall by December.');
    assert.equal(event.content, body, 'content = prediction text — the d is recomputable from the event');
    assert.equal(dTag, 'pred:' + sha16(`${HASH}|rates will fall by december.`),
        'd over hash|norm(text), the claim-id discipline');

    assert.deepEqual(firstTag(event, 'x'), ['x', HASH]);
    assert.deepEqual(tagsNamed(event, 'a').find((t) => t[3] === 'claim'),
        ['a', `30040:${'c'.repeat(64)}:claim_1234567890abcdef`, '', 'claim']);
    assert.deepEqual(firstTag(event, 'prediction-type'), ['prediction-type', 'explicit']);
    assert.deepEqual(firstTag(event, 'hedge'), ['hedge', 'confident']);
    assert.deepEqual(firstTag(event, 'attribution'), ['attribution', 'named_source']);
    assert.deepEqual(firstTag(event, 'attributed-name'), ['attributed-name', 'Chair Powell']);
    assert.deepEqual(firstTag(event, 'p'), ['p', 'd'.repeat(64), '', 'predicts']);
    assert.deepEqual(firstTag(event, 'horizon'), ['horizon', 'by the end of the year']);
    assert.deepEqual(firstTag(event, 'horizon-iso'), ['horizon-iso', '2026-12-31']);
    assert.deepEqual(firstTag(event, 'tractability'), ['tractability', 'publicly_resolvable']);
    assert.deepEqual(firstTag(event, 'quote'), ['quote', 'rates will come down before December']);
    assert.deepEqual(firstTag(event, 'criteria'), ['criteria', 'Fed funds target below current on Dec 31']);
    assert.deepEqual(firstTag(event, 'module-version'), ['module-version', '1.0']);
    assert.deepEqual(JSON.parse(firstTag(event, 'anchor')[1]),
        [{ type: 'TextQuoteSelector', exact: 'rates will come down' }]);
    assert.deepEqual(firstTag(event, 'r'), ['r', URL]);
    assert.deepEqual(firstTag(event, 'i'), ['i', 'https://example.com/story']);
    assert.deepEqual(firstTag(event, 'client'), ['client', 'xray']);
    for (const name of ['stance', 'rating-value', 'L', 'l', 'score', 'confidence']) {
        assert.equal(firstTag(event, name), undefined, `30058 never carries ${name}`);
    }
});

test('30058: d converges across phrasing noise — the ledger survives re-extraction', async () => {
    const a = await buildPredictionEntryEvent(predictionArgs());
    const b = await buildPredictionEntryEvent(predictionArgs({
        predictionText: '  rates  WILL fall   by december. '
    }));
    assert.equal(a.dTag, b.dTag, 'same normalized text, one ledger identity');
    assert.equal(await derivePredictionEntryDTag(HASH, 'Rates will fall by December.'), a.dTag);

    const otherHash = await buildPredictionEntryEvent(predictionArgs({ articleHash: 'e'.repeat(64) }));
    assert.notEqual(a.dTag, otherHash.dTag, 'stealth edits fork the ledger per text version');
});

test('30058: validation — enums, conditional antecedent, evidence-bound, claim kind', async () => {
    await assert.rejects(buildPredictionEntryEvent(predictionArgs({ hedgeLevel: 'certain' })),
        /hedgeLevel must be one of/);
    await assert.rejects(buildPredictionEntryEvent(predictionArgs({ predictionType: 'conditional', condition: null })),
        /conditional predictions require the condition/);
    await assert.rejects(buildPredictionEntryEvent(predictionArgs({ evidenceQuote: '' })),
        /evidenceQuote required/);
    await assert.rejects(buildPredictionEntryEvent(predictionArgs({ criteria: '' })),
        /criteria required/);
    await assert.rejects(buildPredictionEntryEvent(predictionArgs({ claimCoord: `30054:${'c'.repeat(64)}:assess_x` })),
        /claimCoord must be a 30040/);
    await assert.rejects(buildPredictionEntryEvent(predictionArgs({ horizonIso: 'December' })),
        /horizonIso must be YYYY-MM-DD/);
});

test('30058: round-trip incl. human auditor (RQ3); descriptive-horizon entries carry no horizon-iso', async () => {
    const { event, dTag } = await buildPredictionEntryEvent(predictionArgs({
        auditor: HUMAN, horizonIso: null, attribution: 'article_voice', attributedName: null
    }));
    assert.deepEqual(tagsNamed(event, 'p').find((t) => t[3] === 'auditor'),
        ['p', HUMAN.id, '', 'auditor']);
    assert.equal(firstTag(event, 'horizon-iso'), undefined, 'unscheduled — lists under "unscheduled"');

    const parsed = parsePredictionEntryEvent({ ...event, pubkey: HUMAN.id, id: '1'.repeat(64) });
    assert.ok(parsed);
    assert.equal(parsed.id, dTag);
    assert.equal(parsed.text, 'Rates will fall by December.');
    assert.equal(parsed.predictionType, 'explicit');
    assert.equal(parsed.hedgeLevel, 'confident');
    assert.equal(parsed.horizonIso, null);
    assert.deepEqual(parsed.auditor, HUMAN);
    assert.equal(parsed.evidenceQuote, 'rates will come down before December');
    assert.equal(await derivePredictionEntryDTag(parsed.articleHash, parsed.text), parsed.id,
        'd verifiable from the event itself');
});

test('30058 parser: null without d/x/auditor, empty content, or bad enums', async () => {
    const { event } = await buildPredictionEntryEvent(predictionArgs());
    for (const name of ['d', 'x', 'auditor']) {
        assert.equal(parsePredictionEntryEvent({ ...event, tags: event.tags.filter((t) => t[0] !== name) }),
            null, `must be null without ${name}`);
    }
    assert.equal(parsePredictionEntryEvent({ ...event, content: '   ' }), null);
    const badHedge = { ...event, tags: event.tags.map((t) => (t[0] === 'hedge' ? ['hedge', 'certain'] : t)) };
    assert.equal(parsePredictionEntryEvent(badHedge), null,
        'an unparseable hedge level would corrupt calibration — reject, never default');
    const badType = { ...event, tags: event.tags.map((t) => (t[0] === 'prediction-type' ? ['prediction-type', 'guess'] : t)) };
    assert.equal(parsePredictionEntryEvent(badType), null);
    assert.equal(parsePredictionEntryEvent({ ...event, tags: event.tags.filter((t) => t[0] !== 'attribution') }), null,
        'a missing attribution would silently book a named source\'s prediction against the author — reject');
    assert.equal(parsePredictionEntryEvent({ ...event, kind: 30057 }), null);
});

test('30058: maximal round-trip — every optional field survives parse, claim-a before article-a', async () => {
    const { event } = await buildPredictionEntryEvent(predictionArgs({
        predictionType: 'conditional',
        condition: 'if the Fed holds in November',
        claimCoord: `30040:${'c'.repeat(64)}:claim_1234567890abcdef`,
        articleCoord: `30023:${'d'.repeat(64)}:1234567890abcdef`,
        authorEntityPubkey: 'e'.repeat(64),
        anchor: [{ type: 'TextQuoteSelector', exact: 'rates will come down' }]
    }));
    // Foreign serialization: claim a-tag before article a-tag.
    const aTags = event.tags.filter((t) => t[0] === 'a');
    const reordered = {
        ...event, pubkey: MODEL.id, id: '8'.repeat(64),
        tags: [...event.tags.filter((t) => t[0] !== 'a'), ...aTags.reverse()]
    };
    const parsed = parsePredictionEntryEvent(reordered);
    assert.equal(parsed.claimCoord, `30040:${'c'.repeat(64)}:claim_1234567890abcdef`, 'role-marked claim ref');
    assert.equal(parsed.articleCoord, `30023:${'d'.repeat(64)}:1234567890abcdef`, 'prefix-matched article ref');
    assert.equal(parsed.authorEntityPubkey, 'e'.repeat(64));
    assert.equal(parsed.condition, 'if the Fed holds in November');
    assert.equal(parsed.attributedName, 'Chair Powell');
    assert.deepEqual(parsed.anchor, [{ type: 'TextQuoteSelector', exact: 'rates will come down' }]);
});

function resolutionArgs(overrides = {}) {
    return {
        predictionCoord: `30058:${'c'.repeat(64)}:pred:1111111111111111`,
        articleHash: HASH,
        outcome: 'false',
        confidence: 0.9,
        resolvedAt: '2027-01-15T00:00:00Z',
        evidence: [
            { kind: 'url', value: 'https://fred.example/data', description: 'the December print' },
            { kind: 'nostr_event', value: `30023:${'d'.repeat(64)}:abcd1234abcd1234`, description: 'captured follow-up' },
            { kind: 'quote', value: 'rates ended the year higher', description: 'from the follow-up' }
        ],
        notes: 'Rates rose; the prediction failed on its own criteria.',
        auditor: HUMAN,
        ...overrides
    };
}

test('30059: full tag shape — typed evidence, nostr_event gets an indexing a tag', async () => {
    const { event, body, dTag } = await buildPredictionResolutionEvent(resolutionArgs());

    assert.equal(event.kind, 30059);
    assert.equal(body, 'Rates rose; the prediction failed on its own criteria.');
    assert.equal(dTag, 'res:' + sha16(`30058:${'c'.repeat(64)}:pred:1111111111111111`),
        'd over the prediction coordinate verbatim');
    assert.deepEqual(firstTag(event, 'a'),
        ['a', `30058:${'c'.repeat(64)}:pred:1111111111111111`, '', 'prediction'],
        'role-marked — evidence also emits plain a tags');
    assert.deepEqual(firstTag(event, 'x'), ['x', HASH],
        'x is REQUIRED: pred-d is a one-way hash, so an x-less resolution is invisible to article queries');
    assert.deepEqual(firstTag(event, 'outcome'), ['outcome', 'false']);
    assert.deepEqual(firstTag(event, 'resolved-at'), ['resolved-at', '2027-01-15T00:00:00Z']);
    assert.deepEqual(tagsNamed(event, 'evidence'), [
        ['evidence', 'url', 'https://fred.example/data', 'the December print'],
        ['evidence', 'nostr_event', `30023:${'d'.repeat(64)}:abcd1234abcd1234`, 'captured follow-up'],
        ['evidence', 'quote', 'rates ended the year higher', 'from the follow-up']
    ], 'all three framework fields per entry — kind, value, description');
    assert.deepEqual(tagsNamed(event, 'a')[1], ['a', `30023:${'d'.repeat(64)}:abcd1234abcd1234`],
        'nostr_event evidence also gets a plain a tag for relay indexing');
    assert.deepEqual(tagsNamed(event, 'p').find((t) => t[3] === 'auditor'),
        ['p', HUMAN.id, '', 'auditor'], 'human resolver indexed');
});

test('30059: evidence-bound — no evidence, no resolution (P3)', async () => {
    await assert.rejects(buildPredictionResolutionEvent(resolutionArgs({ evidence: [] })),
        /at least one evidence entry required/);
    await assert.rejects(buildPredictionResolutionEvent(resolutionArgs({
        evidence: [{ kind: 'hearsay', value: 'trust me', description: '' }]
    })), /evidence kind must be one of/);
    await assert.rejects(buildPredictionResolutionEvent(resolutionArgs({ outcome: 'True' })),
        /outcome must be one of/);
    await assert.rejects(buildPredictionResolutionEvent(resolutionArgs({
        predictionCoord: `30040:${'c'.repeat(64)}:claim_x`
    })), /must be a 30058 coordinate/);
    await assert.rejects(buildPredictionResolutionEvent(resolutionArgs({ articleHash: null })),
        /articleHash must be 64 lowercase hex/, 'x is required on resolutions');
    await assert.rejects(buildPredictionResolutionEvent(resolutionArgs({ confidence: 1.5 })),
        /confidence must be a number/);
    await assert.rejects(buildPredictionResolutionEvent(resolutionArgs({ resolvedAt: 'last week' })),
        /must be an ISO-8601/);
    await assert.rejects(buildPredictionResolutionEvent(resolutionArgs({
        evidence: [{ kind: 'nostr_event', value: 'naddr1qqxyz', description: 'bech32 is not the wire grammar' }]
    })), /raw coordinate or 64-hex event id/);
});

test('30059: confidence 0 rides the wire and round-trips (falsy-safe)', async () => {
    const { event } = await buildPredictionResolutionEvent(resolutionArgs({ confidence: 0 }));
    assert.deepEqual(firstTag(event, 'confidence'), ['confidence', '0']);
    const parsed = parsePredictionResolutionEvent({ ...event, pubkey: HUMAN.id, id: '6'.repeat(64) });
    assert.equal(parsed.confidence, 0);
});

test('30059 parser: evidence-derived a/e tags are never the prediction reference (foreign order)', async () => {
    const { event } = await buildPredictionResolutionEvent(resolutionArgs({
        evidence: [
            { kind: 'nostr_event', value: `30058:${'f'.repeat(64)}:pred:9999999999999999`, description: 'cites another prediction' },
            { kind: 'nostr_event', value: '9'.repeat(64), description: 'an event id as evidence' }
        ]
    }));
    // Foreign serialization: evidence tags first.
    const reordered = {
        ...event, pubkey: HUMAN.id, id: '7'.repeat(64),
        tags: [...event.tags.filter((t) => t[0] === 'evidence' || (t[0] === 'a' && t.length === 2) || (t[0] === 'e' && t.length === 2)),
            ...event.tags.filter((t) => !(t[0] === 'evidence' || (t[0] === 'a' && t.length === 2) || (t[0] === 'e' && t.length === 2)))]
    };
    const parsed = parsePredictionResolutionEvent(reordered);
    assert.equal(parsed.predictionCoord, `30058:${'c'.repeat(64)}:pred:1111111111111111`,
        'the role-marked reference wins even when an evidence 30058 coordinate precedes it');
    assert.equal(parsed.predictionEventId, null,
        'an evidence event id is not the prediction event id');
});

test('30059: round-trip; same resolver + same prediction = same d (latest-wins by design)', async () => {
    const a = await buildPredictionResolutionEvent(resolutionArgs());
    const b = await buildPredictionResolutionEvent(resolutionArgs({ outcome: 'partial' }));
    assert.equal(a.dTag, b.dTag,
        'the resolver revising their resolution replaces — the accepted RQ5 P9 tension');

    const parsed = parsePredictionResolutionEvent({ ...a.event, pubkey: HUMAN.id, id: '2'.repeat(64) });
    assert.ok(parsed);
    assert.equal(parsed.outcome, 'false');
    assert.equal(parsed.confidence, 0.9);
    assert.equal(parsed.evidence.length, 3);
    assert.deepEqual(parsed.evidence[1],
        { kind: 'nostr_event', value: `30023:${'d'.repeat(64)}:abcd1234abcd1234`, description: 'captured follow-up' });
    assert.equal(await derivePredictionResolutionDTag(parsed.predictionCoord), parsed.id);
    assert.deepEqual(parsed.auditor, HUMAN);
});

test('30059 parser: null without d, the prediction a-coord, valid outcome, or auditor', async () => {
    const { event } = await buildPredictionResolutionEvent(resolutionArgs());
    for (const name of ['d', 'a', 'auditor']) {
        assert.equal(parsePredictionResolutionEvent({ ...event, tags: event.tags.filter((t) => t[0] !== name) }),
            null, `must be null without ${name}`);
    }
    const badOutcome = { ...event, tags: event.tags.map((t) => (t[0] === 'outcome' ? ['outcome', 'maybe'] : t)) };
    assert.equal(parsePredictionResolutionEvent(badOutcome), null);
    assert.equal(parsePredictionResolutionEvent({ ...event, kind: 30058 }), null);
});

function dossierArgs(overrides = {}) {
    return {
        subjectKind: 'publication_x_beat',
        entityPubkey: 'e'.repeat(64),
        beat: 'monetary-policy',
        windowStart: '2026-01-01T00:00:00Z',
        windowEnd: '2026-06-11T00:00:00Z',
        articleCount: 14,
        scoreMean: 73.5,
        scoreMedian: 75,
        scoreStdev: 8.1,
        shrinkageK: 10,
        populationMean: 77,
        shrinkageFactor: 0.42,
        perModuleMeans: { source_quality: 68.2, omission: 71.5 },
        predictions: {
            total: 9, resolved: 4,
            calibration: { confident: { resolved: 2, true_count: 1, rate: 0.5 }, hedged: { resolved: 2, true_count: 2, rate: 1 }, speculative: { resolved: 0, true_count: 0, rate: null } },
            calibration_v1: { version: 'calibration-v1', mean_brier: 0.305, resolved_count: 4, multiplier: null }
        },
        auditor: PIPELINE,
        ...overrides
    };
}

test('30060: full tag shape — latest-wins cache, parameters on the wire for re-derivation', async () => {
    const { event, body, dTag } = await buildDossierSnapshotEvent(dossierArgs());

    assert.equal(event.kind, 30060);
    assert.equal(dTag, 'dossier:' + sha16(`publication_x_beat|${'e'.repeat(64)}|monetary-policy`),
        'd over subjectKind|subjectId; pub×beat id = pubkey|slug');
    assert.deepEqual(firstTag(event, 'subject-kind'), ['subject-kind', 'publication_x_beat']);
    assert.deepEqual(firstTag(event, 'p'), ['p', 'e'.repeat(64)]);
    assert.deepEqual(firstTag(event, 't'), ['t', 'monetary-policy']);
    assert.deepEqual(firstTag(event, 'shrinkage-k'), ['shrinkage-k', '10']);
    assert.deepEqual(firstTag(event, 'population-mean'), ['population-mean', '77']);
    assert.deepEqual(firstTag(event, 'shrinkage-factor'), ['shrinkage-factor', '0.42']);
    const content = JSON.parse(body);
    assert.equal(content.predictions.calibration_v1.multiplier, null,
        'logged, not activated — the wire never carries an applied multiplier in v1');
    assert.equal(content.per_module_means.source_quality, 68.2);
});

test('30060: beat subjects MUST be canonical beats-v1 slugs — free-form never mints dossiers (RQ8)', async () => {
    await assert.rejects(buildDossierSnapshotEvent(dossierArgs({ subjectKind: 'beat', entityPubkey: null, beat: 'fed' })),
        /MUST be canonical beats-v1 slugs/, 'an alias is not a subject id — normalize first');
    await assert.rejects(buildDossierSnapshotEvent(dossierArgs({ subjectKind: 'beat', entityPubkey: null, beat: 'monetarypolicy' })),
        /MUST be canonical beats-v1 slugs/);
    const ok = await buildDossierSnapshotEvent(dossierArgs({ subjectKind: 'beat', entityPubkey: null, beat: 'monetary-policy' }));
    assert.equal(ok.dTag, 'dossier:' + sha16('beat|monetary-policy'));
    assert.equal(firstTag(ok.event, 'p'), undefined, 'a beat is a bare tag — no entity pubkey assumed');

    // Beat-only subjects parse and d-recompute like entity subjects.
    const parsed = parseDossierSnapshotEvent({ ...ok.event, pubkey: 'e'.repeat(64), id: '9'.repeat(64) });
    assert.ok(parsed);
    assert.equal(parsed.beat, 'monetary-policy');
    assert.equal(parsed.entityPubkey, null);
    assert.equal(await deriveDossierSnapshotDTag('beat', parsed.beat), parsed.id);
});

test('30060: empty dossiers are never published — articleCount 0 rejects', async () => {
    await assert.rejects(buildDossierSnapshotEvent(dossierArgs({ articleCount: 0 })),
        /empty dossiers are never published/,
        'a zero-article rollup is just the population prior — noise dressed as judgment');
});

test('30060: subject-kind requirements enforced; round-trips', async () => {
    await assert.rejects(buildDossierSnapshotEvent(dossierArgs({ subjectKind: 'author', entityPubkey: null })),
        /subjects need entityPubkey/);
    const { event, dTag } = await buildDossierSnapshotEvent(dossierArgs({
        subjectKind: 'author', entityPubkey: 'f'.repeat(64), beat: null
    }));
    const parsed = parseDossierSnapshotEvent({ ...event, pubkey: 'e'.repeat(64), id: '3'.repeat(64) });
    assert.ok(parsed);
    assert.equal(parsed.id, dTag);
    assert.equal(parsed.subjectKind, 'author');
    assert.equal(parsed.entityPubkey, 'f'.repeat(64));
    assert.equal(parsed.scoreMean, 73.5);
    assert.equal(parsed.shrinkageFactor, 0.42);
    assert.equal(parsed.predictions.calibration_v1.multiplier, null);
    assert.equal(await deriveDossierSnapshotDTag('author', 'f'.repeat(64)), parsed.id);
});

test('30060 parser: null when the subject anchors are missing', async () => {
    const { event } = await buildDossierSnapshotEvent(dossierArgs());
    for (const name of ['d', 'p', 't', 'subject-kind', 'auditor']) {
        assert.equal(parseDossierSnapshotEvent({ ...event, tags: event.tags.filter((t) => t[0] !== name) }),
            null, `pub×beat must be null without ${name}`);
    }
    assert.equal(parseDossierSnapshotEvent({ ...event, kind: 30054 }), null);
});

function disputeArgs(overrides = {}) {
    return {
        targetCoord: `30057:${'c'.repeat(64)}:agg:2222222222222222`,
        targetKind: 'aggregate_audit',
        articleHash: HASH,
        contested: ['the omission finding quoting "no parent was reached"'],
        evidence: [
            { kind: 'url', value: 'https://example.com/parents-statement', description: 'parents were quoted here' },
            { kind: 'quote', value: 'we spoke to the reporter on Tuesday', description: 'from the statement' }
        ],
        disputeSummary: 'The omission module missed a published stakeholder response.',
        auditor: HUMAN,
        ...overrides
    };
}

test('30061: full tag shape — wire-format-only kind, filer-asserted status', async () => {
    const { event, body, dTag } = await buildAuditDisputeEvent(disputeArgs());

    assert.equal(event.kind, 30061);
    assert.equal(body, 'The omission module missed a published stakeholder response.');
    assert.equal(dTag, 'dispute:' + sha16(`30057:${'c'.repeat(64)}:agg:2222222222222222`),
        'd over the target coordinate — one dispute per (filer, target)');
    assert.deepEqual(firstTag(event, 'a'),
        ['a', `30057:${'c'.repeat(64)}:agg:2222222222222222`, '', 'target'],
        'role-marked — evidence also emits plain a tags');
    assert.deepEqual(firstTag(event, 'target-kind'), ['target-kind', 'aggregate_audit']);
    assert.deepEqual(firstTag(event, 'status'), ['status', 'open']);
    assert.deepEqual(tagsNamed(event, 'contested'),
        [['contested', 'the omission finding quoting "no parent was reached"']]);
    assert.equal(tagsNamed(event, 'evidence').length, 2);
    assert.deepEqual(tagsNamed(event, 'p').find((t) => t[3] === 'auditor'),
        ['p', HUMAN.id, '', 'auditor'], 'the filer, indexed');
});

test('30061: challenges without evidence are returned, not adjudicated (§7)', async () => {
    await assert.rejects(buildAuditDisputeEvent(disputeArgs({ evidence: [] })),
        /at least one evidence entry required/);
    await assert.rejects(buildAuditDisputeEvent(disputeArgs({ contested: [] })),
        /contested must be a nonempty array/);
    await assert.rejects(buildAuditDisputeEvent(disputeArgs({ status: 'upheld' })),
        /status must be one of/,
        'upheld\\/rejected derive from adjudication events — the filer cannot self-assert them');
    await assert.rejects(buildAuditDisputeEvent(disputeArgs({ targetKind: 'assessment' })),
        /targetKind must be one of/);
});

test('30061: round-trip; withdrawal replaces (filer amendment pre-adjudication)', async () => {
    const open = await buildAuditDisputeEvent(disputeArgs());
    const withdrawn = await buildAuditDisputeEvent(disputeArgs({ status: 'withdrawn' }));
    assert.equal(open.dTag, withdrawn.dTag, 'same (filer, target) — amendment, not a new dispute');

    const parsed = parseAuditDisputeEvent({ ...open.event, pubkey: HUMAN.id, id: '4'.repeat(64) });
    assert.ok(parsed);
    assert.equal(parsed.targetKind, 'aggregate_audit');
    assert.equal(parsed.status, 'open');
    assert.equal(parsed.contested.length, 1);
    assert.equal(parsed.evidence.length, 2);
    assert.deepEqual(parsed.auditor, HUMAN);
    assert.equal(await deriveAuditDisputeDTag(parsed.targetCoord), parsed.id);

    // A withdrawn dispute must not re-present as live.
    const parsedWithdrawn = parseAuditDisputeEvent({ ...withdrawn.event, pubkey: HUMAN.id, id: '5'.repeat(64) });
    assert.equal(parsedWithdrawn.status, 'withdrawn');
    // Unknown/missing status defaults to open — a dispute of unknown
    // state is treated as live, the conservative pole.
    const noStatus = { ...open.event, pubkey: HUMAN.id, id: '6'.repeat(64),
        tags: open.event.tags.filter((t) => t[0] !== 'status') };
    assert.equal(parseAuditDisputeEvent(noStatus).status, 'open');
});

test('30061 parser: evidence a-tags are never the target — foreign tag order cannot misroute', async () => {
    const { event } = await buildAuditDisputeEvent(disputeArgs({
        evidence: [
            { kind: 'nostr_event', value: `30023:${'d'.repeat(64)}:abcd1234abcd1234`, description: 'a captured article as evidence' },
            { kind: 'url', value: 'https://example.com/x', description: 'context' }
        ]
    }));
    // Foreign serialization: evidence-derived plain a tag FIRST.
    const reordered = {
        ...event, pubkey: HUMAN.id, id: '7'.repeat(64),
        tags: [...event.tags.filter((t) => t[0] === 'evidence' || (t[0] === 'a' && t.length === 2)),
            ...event.tags.filter((t) => !(t[0] === 'evidence' || (t[0] === 'a' && t.length === 2)))]
    };
    const parsed = parseAuditDisputeEvent(reordered);
    assert.equal(parsed.targetCoord, `30057:${'c'.repeat(64)}:agg:2222222222222222`,
        'the role-marked target wins; the d-recompute discipline depends on it');
    assert.equal(await deriveAuditDisputeDTag(parsed.targetCoord), parsed.id);
});

test('30061 parser: null without d, target coord, valid target-kind, or auditor', async () => {
    const { event } = await buildAuditDisputeEvent(disputeArgs());
    for (const name of ['d', 'a', 'target-kind', 'auditor']) {
        assert.equal(parseAuditDisputeEvent({ ...event, tags: event.tags.filter((t) => t[0] !== name) }),
            null, `must be null without ${name}`);
    }
    assert.equal(parseAuditDisputeEvent({ ...event, kind: 30055 }), null);
});

test('cross-kind: every d derivation is deterministic and distinct per prefix', async () => {
    const pred = await derivePredictionEntryDTag(HASH, 'X will happen');
    const res = await derivePredictionResolutionDTag(`30058:${'c'.repeat(64)}:${pred}`);
    const dossier = await deriveDossierSnapshotDTag('beat', 'bitcoin');
    const dispute = await deriveAuditDisputeDTag(`30057:${'c'.repeat(64)}:agg:x`);
    assert.match(pred, /^pred:[0-9a-f]{16}$/);
    assert.match(res, /^res:[0-9a-f]{16}$/);
    assert.match(dossier, /^dossier:[0-9a-f]{16}$/);
    assert.match(dispute, /^dispute:[0-9a-f]{16}$/);
});

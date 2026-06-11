// Phase 13.2 — wire builders + parsers for kinds 30056/30057.
// Pinned-tag-vocabulary tests (the Phase-11 idiom): the exact tag
// shapes are wire format — anyone consuming X-Ray events depends on
// them, so every change here is deliberate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
    buildModuleResultEvent, buildAggregateAuditEvent,
    parseModuleResultEvent, parseAggregateAuditEvent,
    deriveModuleResultDTag, deriveAggregateAuditDTag,
    collectEvidenceQuotes
} from '../src/shared/audit/builders.js';

const HASH = 'a'.repeat(64);
const RUN_AT = '2026-06-11T20:14:00Z';
const PIPELINE = { kind: 'pipeline', id: 'xray-auditor/0.1.0/anthropic/claude-sonnet-4-6' };
const MODEL = { kind: 'model', id: 'anthropic/claude-sonnet-4-6' };
const HUMAN = { kind: 'human', id: 'b'.repeat(64) };
const URL = 'https://example.com/story?utm_source=feed';

function sha16(s) {
    return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
}

function firstTag(event, name) {
    return event.tags.find((t) => t[0] === name);
}

function tagsNamed(event, name) {
    return event.tags.filter((t) => t[0] === name);
}

const COHERENCE_FINDINGS = {
    module: 'internal_coherence', version: '1.0',
    score: 62, confidence: 0.78, confidence_notes: 'clean structure',
    auditor_caveats: ['Surface scan only.'],
    contradictions: [{
        type: 'numerical', claim_a: 'rose 12%', claim_b: 'nearly doubled',
        evidence_quote_a: 'rose 12 percent', evidence_quote_b: 'nearly doubled',
        is_dialectic_intent: false, severity: 'high'
    }],
    logical_gaps: []
};

const PREDICTION_FINDINGS = {
    module: 'prediction_extraction', version: '1.0',
    auditor_caveats: ['Horizons approximate.'],
    predictions: [{
        prediction: 'Rates will fall by December.', type: 'explicit',
        hedge_level: 'confident', attributed_to: 'article_voice',
        resolution_horizon: 'by the end of the year',
        resolution_criteria: 'target below current on Dec 31',
        tractability: 'publicly_resolvable',
        evidence_quote: 'rates will come down before December'
    }],
    summary: { total_predictions: 1 }
};

test('30056: full tag shape', async () => {
    const { event, body, dTag } = await buildModuleResultEvent({
        articleHash: HASH, module: 'internal_coherence', runAt: RUN_AT,
        findings: COHERENCE_FINDINGS,
        articleCoord: `30023:${'c'.repeat(64)}:1234567890abcdef`,
        relayHint: 'wss://relay.example',
        articleUrl: URL, beats: ['monetary-policy'],
        auditor: MODEL, modelParams: 'temperature=0'
    });

    assert.equal(event.kind, 30056);
    assert.equal(dTag, 'mod:' + sha16(`${HASH}|internal_coherence|1.0|${RUN_AT}`),
        'd recomputable by hand from hash|module|version|runAt');
    assert.deepEqual(firstTag(event, 'd'), ['d', dTag]);
    assert.deepEqual(firstTag(event, 'x'), ['x', HASH]);
    assert.deepEqual(firstTag(event, 'a'), ['a', `30023:${'c'.repeat(64)}:1234567890abcdef`, 'wss://relay.example']);
    // r verbatim + i normalized + k web — the Phase-11 URL rule.
    assert.deepEqual(firstTag(event, 'r'), ['r', URL]);
    assert.deepEqual(firstTag(event, 'i'), ['i', 'https://example.com/story']);
    assert.deepEqual(firstTag(event, 'k'), ['k', 'web']);
    // t carries the module name (indexed) + beat mirrors.
    assert.deepEqual(tagsNamed(event, 't'), [
        ['t', 'internal_coherence'],
        ['t', 'monetary-policy']
    ]);
    assert.deepEqual(firstTag(event, 'module-version'), ['module-version', '1.0']);
    assert.deepEqual(firstTag(event, 'run-at'), ['run-at', RUN_AT]);
    assert.deepEqual(firstTag(event, 'score'), ['score', '62']);
    assert.deepEqual(firstTag(event, 'confidence'), ['confidence', '0.78']);
    assert.deepEqual(firstTag(event, 'model-params'), ['model-params', 'temperature=0']);
    assert.deepEqual(firstTag(event, 'auditor'), ['auditor', 'model', MODEL.id]);
    assert.deepEqual(firstTag(event, 'client'), ['client', 'xray']);

    // Content = findings + the deduplicated evidence-quote index.
    const content = JSON.parse(body);
    assert.equal(content.score, 62);
    assert.deepEqual(content.evidence_quotes,
        [{ quote: 'rose 12 percent' }, { quote: 'nearly doubled' }]);

    // FIREWALL: no assessment vocabulary, ever. And no p tag for
    // non-human auditors — a model id is not a pubkey.
    for (const name of ['stance', 'rating-value', 'L', 'l', 'p']) {
        assert.equal(firstTag(event, name), undefined, `this event must not carry ${name}`);
    }
});

test('30056: invalid findings never build — you never sign what you have not verified (RQ1)', async () => {
    const broken = structuredClone(COHERENCE_FINDINGS);
    broken.contradictions[0].evidence_quote_a = '';
    await assert.rejects(buildModuleResultEvent({
        articleHash: HASH, module: 'internal_coherence', runAt: RUN_AT,
        findings: broken, auditor: MODEL
    }), /failed schema validation/);

    await assert.rejects(buildModuleResultEvent({
        articleHash: HASH, module: 'not_a_module', runAt: RUN_AT,
        findings: COHERENCE_FINDINGS, auditor: MODEL
    }), /module must be one of/);

    await assert.rejects(buildModuleResultEvent({
        articleHash: 'short', module: 'internal_coherence', runAt: RUN_AT,
        findings: COHERENCE_FINDINGS, auditor: MODEL
    }), /articleHash must be 64 lowercase hex/);

    await assert.rejects(buildModuleResultEvent({
        articleHash: HASH, module: 'internal_coherence', runAt: 'yesterday-ish',
        findings: COHERENCE_FINDINGS, auditor: MODEL
    }), /runAt must be an ISO-8601/);

    // Date.parse alone is lenient — strict ISO-8601 is the contract
    // (runAt feeds the |-delimited d preimage).
    for (const sloppy of ['2026', 'March 7, 2026', '2026-06-11', 'Jun 11 2026 (x|y)']) {
        await assert.rejects(buildModuleResultEvent({
            articleHash: HASH, module: 'internal_coherence', runAt: sloppy,
            findings: COHERENCE_FINDINGS, auditor: MODEL
        }), /runAt must be an ISO-8601/, `must reject: ${sloppy}`);
    }
});

test('30056: beats are validated — module-name collisions, empties, dupes never reach the wire', async () => {
    const base = {
        articleHash: HASH, module: 'omission', runAt: RUN_AT, auditor: MODEL,
        findings: {
            module: 'omission', version: '1.0', score: 70, confidence: 0.8,
            auditor_caveats: ['x'],
            topic_summary: 't', voices_directly_quoted: [], voices_paraphrased_only: [],
            voices_referenced_but_silent: [], natural_stakeholder_set: [],
            voices_expected_but_absent: [], speaks_for_instances: []
        }
    };
    await assert.rejects(buildModuleResultEvent({ ...base, beats: ['source_quality'] }),
        /collides with a module name/,
        'a beat equal to a module name would poison the indexed module filter');
    await assert.rejects(buildModuleResultEvent({ ...base, beats: [''] }),
        /nonempty strings/);
    await assert.rejects(buildModuleResultEvent({ ...base, beats: [{ a: 1 }] }),
        /nonempty strings/);

    const { event } = await buildModuleResultEvent({ ...base, beats: ['ai', 'ai', 'banking'] });
    assert.deepEqual(tagsNamed(event, 't'), [['t', 'omission'], ['t', 'ai'], ['t', 'banking']],
        'deduped, module t first');
});

test('30056: score 0 / confidence 0 ride the wire and round-trip (falsy-safe)', async () => {
    const zeroed = structuredClone(COHERENCE_FINDINGS);
    zeroed.score = 0;
    zeroed.confidence = 0;
    const { event } = await buildModuleResultEvent({
        articleHash: HASH, module: 'internal_coherence', runAt: RUN_AT,
        findings: zeroed, auditor: MODEL
    });
    assert.deepEqual(firstTag(event, 'score'), ['score', '0']);
    assert.deepEqual(firstTag(event, 'confidence'), ['confidence', '0']);
    const parsed = parseModuleResultEvent({ ...event, pubkey: 'e'.repeat(64), id: '9'.repeat(64) });
    assert.equal(parsed.score, 0, 'a zero score is a maximally failing dimension, not a missing one');
    assert.equal(parsed.confidence, 0);
});

test('30056: findings carrying their own evidence_quotes are overwritten by the collected index', async () => {
    const withStale = structuredClone(COHERENCE_FINDINGS);
    withStale.evidence_quotes = [{ quote: 'stale from a prior parse' }];
    const { body } = await buildModuleResultEvent({
        articleHash: HASH, module: 'internal_coherence', runAt: RUN_AT,
        findings: withStale, auditor: MODEL
    });
    const content = JSON.parse(body);
    assert.deepEqual(content.evidence_quotes,
        [{ quote: 'rose 12 percent' }, { quote: 'nearly doubled' }],
        'rebuild-from-parsed must not freeze a stale index');

    // The explicit override branch.
    const { body: overridden } = await buildModuleResultEvent({
        articleHash: HASH, module: 'internal_coherence', runAt: RUN_AT,
        findings: COHERENCE_FINDINGS, auditor: MODEL,
        evidenceQuotes: [{ quote: 'caller-supplied', source_span: { start: 1, end: 9 } }]
    });
    assert.deepEqual(JSON.parse(overridden).evidence_quotes,
        [{ quote: 'caller-supplied', source_span: { start: 1, end: 9 } }]);
});

test('30056: no articleUrl → no r/i/k on the wire, parsed.url null', async () => {
    const { event } = await buildModuleResultEvent({
        articleHash: HASH, module: 'internal_coherence', runAt: RUN_AT,
        findings: COHERENCE_FINDINGS, auditor: MODEL
    });
    for (const name of ['r', 'i', 'k']) {
        assert.equal(firstTag(event, name), undefined, `${name} absent without a URL`);
    }
    const parsed = parseModuleResultEvent({ ...event, pubkey: 'e'.repeat(64), id: '8'.repeat(64) });
    assert.equal(parsed.url, null);
    assert.equal(parsed.manifestHash, null, 'no manifest → null, not empty string');
});

test('30056 parser: findings.module is authoritative; t-tag order cannot mis-bucket (foreign events)', async () => {
    const { event } = await buildModuleResultEvent({
        articleHash: HASH, module: 'internal_coherence', runAt: RUN_AT,
        findings: COHERENCE_FINDINGS, auditor: MODEL, beats: ['banking']
    });
    // Foreign serialization: beat t BEFORE module t — must still parse
    // as internal_coherence with the beat intact.
    const reordered = {
        ...event,
        pubkey: 'e'.repeat(64), id: '7'.repeat(64),
        tags: [...event.tags.filter((t) => t[0] !== 't'),
            ['t', 'banking'], ['t', 'internal_coherence']]
    };
    const parsed = parseModuleResultEvent(reordered);
    assert.equal(parsed.module, 'internal_coherence');
    assert.deepEqual(parsed.beats, ['banking']);

    // No t tag at all: content envelope still identifies the module.
    const noT = { ...event, pubkey: 'e'.repeat(64), id: '6'.repeat(64),
        tags: event.tags.filter((t) => t[0] !== 't') };
    assert.equal(parseModuleResultEvent(noT).module, 'internal_coherence');

    // Content/t disagreement: structurally untrustworthy → null.
    const lying = { ...event, pubkey: 'e'.repeat(64), id: '5'.repeat(64),
        tags: [...event.tags.filter((t) => t[0] !== 't'), ['t', 'omission']] };
    assert.equal(parseModuleResultEvent(lying), null,
        'a mis-tagged audit is rejected, not soft-bucketed');

    // Array content is not a findings object.
    assert.equal(parseModuleResultEvent({ ...event, content: '[1,2]' }), null);
});

test('30056: prediction_extraction events carry NO score/confidence tags', async () => {
    const { event } = await buildModuleResultEvent({
        articleHash: HASH, module: 'prediction_extraction', runAt: RUN_AT,
        findings: PREDICTION_FINDINGS, auditor: MODEL
    });
    assert.equal(firstTag(event, 'score'), undefined);
    assert.equal(firstTag(event, 'confidence'), undefined);
});

test('30056: human auditor gets the indexed p tag; round-trips identically (RQ3)', async () => {
    const { event, dTag } = await buildModuleResultEvent({
        articleHash: HASH, module: 'internal_coherence', runAt: RUN_AT,
        findings: COHERENCE_FINDINGS, auditor: HUMAN
    });
    assert.deepEqual(firstTag(event, 'p'), ['p', HUMAN.id, '', 'auditor']);

    const parsed = parseModuleResultEvent({ ...event, pubkey: HUMAN.id, id: 'f'.repeat(64) });
    assert.ok(parsed);
    assert.equal(parsed.id, dTag);
    assert.deepEqual(parsed.auditor, HUMAN);
    assert.equal(parsed.score, 62, 'a human-scored module result carries scores like any other');
});

test('30056: deterministic d — same inputs, same d; new run, new d', async () => {
    const args = {
        articleHash: HASH, module: 'internal_coherence', runAt: RUN_AT,
        findings: COHERENCE_FINDINGS, auditor: MODEL
    };
    const a = await buildModuleResultEvent(args);
    const b = await buildModuleResultEvent(args);
    assert.equal(a.dTag, b.dTag, 'idempotent republish of the same run only');
    const c = await buildModuleResultEvent({ ...args, runAt: '2026-06-12T08:00:00Z' });
    assert.notEqual(a.dTag, c.dTag, 're-runs accumulate — never overwrite (the RQ5 constraint)');

    const v2 = structuredClone(COHERENCE_FINDINGS);
    v2.version = '1.1';
    const d = await buildModuleResultEvent({ ...args, findings: v2 });
    assert.notEqual(a.dTag, d.dTag, 'a methodology bump is a new d — prior audits persist');
});

test('30056: parser round-trips builder output; pipeline constituents survive', async () => {
    const { event, dTag } = await buildModuleResultEvent({
        articleHash: HASH, module: 'internal_coherence', runAt: RUN_AT,
        findings: COHERENCE_FINDINGS, articleUrl: URL,
        auditor: PIPELINE, constituents: [MODEL], manifestHash: 'd'.repeat(64)
    });
    const parsed = parseModuleResultEvent({ ...event, pubkey: 'e'.repeat(64), id: '1'.repeat(64) });
    assert.ok(parsed, 'parser must accept its own builder output');
    assert.equal(parsed.id, dTag);
    assert.equal(parsed.articleHash, HASH);
    assert.equal(parsed.module, 'internal_coherence');
    assert.equal(parsed.moduleVersion, '1.0');
    assert.equal(parsed.runAt, RUN_AT);
    assert.equal(parsed.confidence, 0.78);
    assert.deepEqual(parsed.auditor, PIPELINE);
    assert.deepEqual(parsed.constituents, [MODEL]);
    assert.equal(parsed.manifestHash, 'd'.repeat(64));
    assert.equal(parsed.findings.contradictions.length, 1);
    assert.equal(parsed.evidenceQuotes.length, 2);
    assert.equal(parsed.url, URL);

    // d is verifiable from the parsed event's own tags.
    assert.equal(await deriveModuleResultDTag(parsed.articleHash, parsed.module, parsed.moduleVersion, parsed.runAt),
        parsed.id);
});

test('30056 parser: null on wrong kind, missing anchors, or unparseable content', async () => {
    const { event } = await buildModuleResultEvent({
        articleHash: HASH, module: 'internal_coherence', runAt: RUN_AT,
        findings: COHERENCE_FINDINGS, auditor: MODEL
    });
    assert.equal(parseModuleResultEvent(null), null);
    assert.equal(parseModuleResultEvent({ ...event, kind: 30054 }), null);
    assert.equal(parseModuleResultEvent({ ...event, content: 'not json {' }), null);
    for (const name of ['d', 'x', 'module-version', 'run-at', 'auditor']) {
        const stripped = { ...event, tags: event.tags.filter((t) => t[0] !== name) };
        assert.equal(parseModuleResultEvent(stripped), null, `must be null without ${name}`);
    }
    // Stripping 't' alone does NOT null — the content envelope still
    // carries the authoritative module (see the foreign-events test).
    const noT = { ...event, tags: event.tags.filter((t) => t[0] !== 't') };
    assert.ok(parseModuleResultEvent(noT));
});

function aggregateArgs(overrides = {}) {
    return {
        articleHash: HASH, runAt: '2026-06-11T20:14:05Z',
        finalScore: 64.5, rawScore: 71.2, ceiling: 80,
        ceilingSource: 'heuristic:source-quality/1.0', confidence: 0.71,
        knowabilityNotes: 'Ceiling derived from sourcing pattern: 50% named.',
        moduleContributions: [
            { module: 'internal_coherence', coord: `30056:${'e'.repeat(64)}:mod:1111111111111111`, eventId: '2'.repeat(64), score: 62, confidence: 0.78, weight: 0.10 },
            { module: 'source_quality', coord: `30056:${'e'.repeat(64)}:mod:2222222222222222`, score: 58, confidence: 0.8, weight: 0.20 }
        ],
        topStrengths: ['headline_body_fidelity: 88'],
        topConcerns: ['source_quality: 58'],
        articleUrl: URL, beats: ['monetary-policy'],
        auditor: PIPELINE, constituents: [MODEL],
        ...overrides
    };
}

test('30057: full tag shape, ceiling-binding only when binding', async () => {
    const { event, body, dTag } = await buildAggregateAuditEvent(aggregateArgs());

    assert.equal(event.kind, 30057);
    assert.equal(dTag, 'agg:' + sha16(`${HASH}|${PIPELINE.id}|2026-06-11T20:14:05Z`),
        'd recomputable from hash|auditor-id|runAt');
    assert.deepEqual(firstTag(event, 'score'), ['score', '64.5']);
    assert.deepEqual(firstTag(event, 'raw-score'), ['raw-score', '71.2']);
    assert.deepEqual(firstTag(event, 'ceiling'), ['ceiling', '80']);
    assert.equal(firstTag(event, 'ceiling-binding'), undefined,
        'raw 71.2 < ceiling 80 — not binding, tag absent (presence IS the signal)');
    assert.deepEqual(firstTag(event, 'ceiling-source'), ['ceiling-source', 'heuristic:source-quality/1.0']);
    assert.deepEqual(firstTag(event, 'confidence'), ['confidence', '0.71']);

    // Module refs: a coordinates first (durable), role-marked; e optional.
    const moduleAs = tagsNamed(event, 'a').filter((t) => t[1].startsWith('30056:'));
    assert.equal(moduleAs.length, 2);
    assert.equal(moduleAs[0][3], 'internal_coherence');
    const moduleEs = tagsNamed(event, 'e').filter((t) => t[3] === 'internal_coherence');
    assert.deepEqual(moduleEs, [['e', '2'.repeat(64), '', 'internal_coherence']]);

    const content = JSON.parse(body);
    assert.equal(content.module_contributions.length, 2);
    assert.equal(content.module_contributions[0].ref, `30056:${'e'.repeat(64)}:mod:1111111111111111`);
    assert.equal(content.model_estimated_ceiling, null, 'advisory field present, null by default (RQ2)');
    assert.deepEqual(content.top_concerns, ['source_quality: 58']);

    for (const name of ['stance', 'rating-value', 'L', 'l', 'p']) {
        assert.equal(firstTag(event, name), undefined, `this event must not carry ${name}`);
    }
    assert.deepEqual(tagsNamed(event, 't'), [['t', 'monetary-policy']], 'beat rides 30057 too');
});

test('30057: ceiling-binding present iff raw > ceiling — and it parses back', async () => {
    const binding = await buildAggregateAuditEvent(aggregateArgs({ rawScore: 85, finalScore: 80 }));
    assert.deepEqual(firstTag(binding.event, 'ceiling-binding'), ['ceiling-binding', 'true']);
    const parsedBinding = parseAggregateAuditEvent({ ...binding.event, pubkey: 'e'.repeat(64), id: 'a'.repeat(64) });
    assert.equal(parsedBinding.ceilingBinding, true);
    assert.equal(parsedBinding.rawScore, 85);

    const notBinding = await buildAggregateAuditEvent(aggregateArgs({ rawScore: 71.2, finalScore: 71.2 }));
    assert.equal(firstTag(notBinding.event, 'ceiling-binding'), undefined,
        'absent when the ceiling does not bind — presence IS the signal');
});

test('30057: an internally contradictory score never builds — score = min(raw, ceiling) is wire semantics', async () => {
    await assert.rejects(buildAggregateAuditEvent(aggregateArgs({ finalScore: 90, rawScore: 85, ceiling: 80 })),
        /finalScore must not exceed min/);
    await assert.rejects(buildAggregateAuditEvent(aggregateArgs({ finalScore: 75, rawScore: 70 })),
        /finalScore must not exceed min/, 'final above raw is incoherent even under a high ceiling');
    // Pipeline degradation below min is allowed (≤, not ==).
    const ok = await buildAggregateAuditEvent(aggregateArgs({ finalScore: 64.5, rawScore: 71.2, ceiling: 80 }));
    assert.ok(ok.dTag);
});

test('30057: ceiling-source closed grammar enforced (RQ2)', async () => {
    for (const bad of ['banana', 'heuristic:', 'heuristic:source-quality', 'module:not-a-coord', '']) {
        await assert.rejects(buildAggregateAuditEvent(aggregateArgs({ ceilingSource: bad })),
            /ceilingSource must be/, `must reject: ${bad}`);
    }
    for (const good of ['model', 'human', 'heuristic:source-quality/1.0',
        `module:30062:${'f'.repeat(64)}:know:abc`]) {
        const { event } = await buildAggregateAuditEvent(aggregateArgs({ ceilingSource: good }));
        assert.deepEqual(firstTag(event, 'ceiling-source'), ['ceiling-source', good]);
    }
});

test('30057: contribution confidence is validated; wrong-kind coords rejected', async () => {
    await assert.rejects(buildAggregateAuditEvent(aggregateArgs({
        moduleContributions: [{ module: 'omission', coord: `30056:${'e'.repeat(64)}:mod:x`, score: 70, weight: 0.2 }]
    })), /contribution confidence/);
    await assert.rejects(buildAggregateAuditEvent(aggregateArgs({
        moduleContributions: [{ module: 'omission', coord: `30023:${'e'.repeat(64)}:abcd`, score: 70, confidence: 0.8, weight: 0.2 }]
    })), /must be a 30056 coordinate/, 'a 30023 coord is not a module result');
    await assert.rejects(buildAggregateAuditEvent(aggregateArgs({
        articleCoord: `30040:${'e'.repeat(64)}:claim_x`
    })), /must be a 30023/, 'the article pointer must be an article');
});

test('30057: supersession/dispute-resolution are forward e-roles on the NEW event — and parse back', async () => {
    const { event } = await buildAggregateAuditEvent(aggregateArgs({
        supersedesEventId: '3'.repeat(64),
        resolvesDisputeEventId: '4'.repeat(64)
    }));
    assert.deepEqual(tagsNamed(event, 'e').filter((t) => t[3] === 'supersedes'),
        [['e', '3'.repeat(64), '', 'supersedes']]);
    assert.deepEqual(tagsNamed(event, 'e').filter((t) => t[3] === 'resolves-dispute'),
        [['e', '4'.repeat(64), '', 'resolves-dispute']]);

    const parsed = parseAggregateAuditEvent({ ...event, pubkey: 'e'.repeat(64), id: 'b'.repeat(64) });
    assert.equal(parsed.supersedesEventId, '3'.repeat(64), 'P9 lineage is consumer-facing');
    assert.equal(parsed.resolvesDisputeEventId, '4'.repeat(64));

    const plain = await buildAggregateAuditEvent(aggregateArgs());
    const parsedPlain = parseAggregateAuditEvent({ ...plain.event, pubkey: 'e'.repeat(64), id: 'c'.repeat(64) });
    assert.equal(parsedPlain.supersedesEventId, null);
    assert.equal(parsedPlain.resolvesDisputeEventId, null);
});

test('30057: validation — no ceiling without provenance, ranges enforced', async () => {
    await assert.rejects(buildAggregateAuditEvent(aggregateArgs({ ceilingSource: '' })),
        /ceilingSource must be/);
    await assert.rejects(buildAggregateAuditEvent(aggregateArgs({ finalScore: 101 })),
        /finalScore must be a number in \[0, 100\]/);
    await assert.rejects(buildAggregateAuditEvent(aggregateArgs({ confidence: 1.2 })),
        /confidence must be a number in \[0, 1\]/);
    await assert.rejects(buildAggregateAuditEvent(aggregateArgs({
        moduleContributions: [{ module: 'internal_coherence', coord: 'not-a-coord', score: 62, confidence: 0.78, weight: 0.1 }]
    })), /contribution coord/);
    await assert.rejects(buildAggregateAuditEvent(aggregateArgs({ auditor: { kind: 'robot', id: 'x' } })),
        /auditor must be/);
});

test('30057: parser round-trips builder output, incl. human auditor (RQ3)', async () => {
    const { event, dTag } = await buildAggregateAuditEvent(aggregateArgs({
        auditor: HUMAN, constituents: []
    }));
    const parsed = parseAggregateAuditEvent({ ...event, pubkey: HUMAN.id, id: '5'.repeat(64) });
    assert.ok(parsed);
    assert.equal(parsed.id, dTag);
    assert.equal(parsed.finalScore, 64.5);
    assert.equal(parsed.rawScore, 71.2);
    assert.equal(parsed.ceiling, 80);
    assert.equal(parsed.ceilingBinding, false);
    assert.equal(parsed.ceilingSource, 'heuristic:source-quality/1.0');
    assert.deepEqual(parsed.auditor, HUMAN);
    assert.equal(parsed.moduleRefs.length, 2);
    assert.equal(parsed.moduleRefs[1].module, 'source_quality');
    assert.equal(parsed.moduleContributions.length, 2);
    assert.equal(parsed.modelEstimatedCeiling, null);
    assert.equal(parsed.url, URL);
    assert.deepEqual(parsed.beats, ['monetary-policy'], '30057 beats round-trip — dossiers read them');

    assert.equal(await deriveAggregateAuditDTag(parsed.articleHash, parsed.auditor.id, parsed.runAt),
        parsed.id, 'd verifiable from the event\'s own tags');
});

test('30057 parser: null without d/x/score/ceiling/ceiling-source/auditor', async () => {
    const { event } = await buildAggregateAuditEvent(aggregateArgs());
    for (const name of ['d', 'x', 'run-at', 'score', 'ceiling', 'ceiling-source', 'auditor']) {
        const stripped = { ...event, tags: event.tags.filter((t) => t[0] !== name) };
        assert.equal(parseAggregateAuditEvent(stripped), null, `must be null without ${name}`);
    }
    assert.equal(parseAggregateAuditEvent({ ...event, kind: 30051 }), null);
});

test('collectEvidenceQuotes: every array element walked, dedup, nesting, non-strings skipped', () => {
    const quotes = collectEvidenceQuotes({
        a: [{ evidence_quote: 'one' }, { evidence_quote: 'two' }, { evidence_quote: 'one' }],
        b: { nested: { evidence_quote_a: 'three', evidence_quote_b: 'four' } },
        c: [[{ evidence_quote: 'deep' }]],
        d: { evidence_quote: '' },
        e: { evidence_quote: 42 }
    });
    assert.deepEqual(quotes, [
        { quote: 'one' }, { quote: 'two' }, { quote: 'three' },
        { quote: 'four' }, { quote: 'deep' }
    ]);
});

test('30057: finalScore 0 parses as 0, never as missing', async () => {
    const { event } = await buildAggregateAuditEvent(aggregateArgs({
        finalScore: 0, rawScore: 0, ceiling: 40, confidence: 0.6,
        moduleContributions: []
    }));
    assert.deepEqual(firstTag(event, 'score'), ['score', '0']);
    const parsed = parseAggregateAuditEvent({ ...event, pubkey: 'e'.repeat(64), id: 'd'.repeat(64) });
    assert.ok(parsed, 'a zero score is a valid event');
    assert.equal(parsed.finalScore, 0);
});

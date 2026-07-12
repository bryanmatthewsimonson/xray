// Truth-adjudication wire tests — Phase 15.6
// (docs/TRUTH_ADJUDICATION_DESIGN.md wire; docs/NIP_DRAFT.md kinds
// 30063/30064). Round-trips pin the tag grammar; the guardrail tests
// pin the wire-level red lines: the firewall holds on build AND
// parse, no `p` exists on a 30063, caveats are required tags, and a
// 30064 gap cause travels only with its documentation.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
    KIND_ADJUDICATED_VERDICT, KIND_INTEGRITY_FINDING, KIND_PRECEDENT_RESERVED,
    ADJUDICATION_NAMESPACE,
    buildAdjudicatedVerdictEvent, parseAdjudicatedVerdictEvent,
    buildVerdictMirrorEvent, deriveVerdictDTag,
    buildIntegrityFindingEvent, parseIntegrityFindingEvent,
    deriveIntegrityFindingDTag
} = await import('../src/shared/truth-builders.js');
const { DISPUTE_TARGET_KINDS } = await import('../src/shared/audit/builders.js');
const { FLAGS_DEFAULTS } = await import('../src/shared/metadata/feature-flags.js');

const AUTHOR = 'a'.repeat(64);
const SUBJECT = 'b'.repeat(64);
const CLAIM = `30040:${AUTHOR}:claim_1234567890abcdef`;
const WORD = `30040:${AUTHOR}:claim_word000000000000`;
const DEED1 = `30040:${AUTHOR}:claim_deed100000000000`;
const DEED2 = `30040:${AUTHOR}:claim_deed200000000000`;

function baseVerdictArgs(over = {}) {
    return {
        claimCoord: CLAIM,
        propositionClass: 'event-fact',
        verdict: 'established-true',
        standardOfProof: 'preponderance',
        resolutionCriteria: { criteria: 'The official roll-call record.' },
        subjectRole: 'enacted',
        occurredAt: 1614729600,
        occurredPrecision: 'day',
        evidenceFor: [{ quote: 'Roll-call 71: Nay.', tier: 'tier-1', url: 'https://congress.example.gov/71' }],
        caveats: ['Could not verify a later motion.'],
        method: 'manual record check',
        rationale: 'Cross-checked against the certified journal.',
        sourceUrl: 'https://example.com/article',
        ...over
    };
}

function baseFindingArgs(over = {}) {
    return {
        subjectPubkey: SUBJECT,
        word: { coord: WORD, class: 'stated-commitment', occurredAt: 1600000000, occurredPrecision: 'day' },
        deeds: [
            { coord: DEED1, class: 'event-fact', occurredAt: 1614729600, occurredPrecision: 'day' },
            { coord: DEED2, class: 'state-fact' }
        ],
        match: 'broken',
        evidenceFor: [{ quote: 'Roll-call 88: Yea.', tier: 'tier-1' }],
        caveats: ['Single vote against a multi-year pledge.'],
        ...over
    };
}

// --- kind 30063 -----------------------------------------------------------

test('30063: build + parse round-trip; d recomputable; NO p tag exists', async () => {
    const { event, dTag } = await buildAdjudicatedVerdictEvent(baseVerdictArgs());
    assert.equal(event.kind, KIND_ADJUDICATED_VERDICT);
    assert.equal(dTag, await deriveVerdictDTag(CLAIM, 'event-fact'), 'd from (claim | class) alone');
    assert.equal(event.tags.find((t) => t[0] === 'd')[1], dTag);
    assert.equal(event.tags.some((t) => t[0] === 'p'), false,
        'verdicts attach to propositions, not persons (§5.3)');
    const a = event.tags.find((t) => t[0] === 'a');
    assert.equal(a[1], CLAIM);
    assert.equal(a[3], 'proposition-claim');
    const l = event.tags.find((t) => t[0] === 'l');
    assert.deepEqual([l[1], l[2]], ['established-true', ADJUDICATION_NAMESPACE]);
    assert.equal(event.tags.some((t) => t[0] === 'score' || t[0] === 'confidence'), false);

    const parsed = parseAdjudicatedVerdictEvent({ ...event, pubkey: AUTHOR, id: 'e'.repeat(64) });
    assert.equal(parsed.claimCoord, CLAIM);
    assert.equal(parsed.propositionClass, 'event-fact');
    assert.equal(parsed.verdict, 'established-true');
    assert.equal(parsed.standardOfProof, 'preponderance');
    assert.equal(parsed.subjectRole, 'enacted');
    assert.equal(parsed.criteria, 'The official roll-call record.');
    assert.equal(parsed.occurredAt, 1614729600);
    assert.equal(parsed.occurredPrecision, 'day');
    assert.equal(parsed.evidenceFor.length, 1);
    assert.equal(parsed.evidenceFor[0].tier, 'tier-1');
    // Grounded evidence (amendment 2026-07-12): the url slot survives
    // the wire round trip — a reader can follow the evidence.
    assert.equal(parsed.evidenceFor[0].url, 'https://congress.example.gov/71');
    assert.deepEqual(parsed.caveats, ['Could not verify a later motion.']);
    assert.equal(parsed.rationale, 'Cross-checked against the certified journal.');
    assert.equal(parsed.url, 'https://example.com/article');
});

test('30063: the firewall holds on the wire — build AND parse', async () => {
    await assert.rejects(() => buildAdjudicatedVerdictEvent(baseVerdictArgs({
        propositionClass: 'interpretation'
    })), /not adjudicable as true\/false/);
    await assert.rejects(() => buildAdjudicatedVerdictEvent(baseVerdictArgs({
        propositionClass: 'stated-value'
    })), /not adjudicable as true\/false/);

    // A crafted event that smuggles a firewalled class is null-parsed.
    const { event } = await buildAdjudicatedVerdictEvent(baseVerdictArgs());
    const smuggled = {
        ...event,
        tags: event.tags.map((t) => (t[0] === 'proposition-class' ? ['proposition-class', 'stated-value'] : t))
    };
    assert.equal(parseAdjudicatedVerdictEvent(smuggled), null,
        'read-side firewall: consumers never admit a value verdict');
});

test('30063: wire validation — caveats, adequacy, coords, prediction horizon, supersedes', async () => {
    await assert.rejects(() => buildAdjudicatedVerdictEvent(baseVerdictArgs({ caveats: [] })),
        /caveat required/);
    await assert.rejects(() => buildAdjudicatedVerdictEvent(baseVerdictArgs({ evidenceFor: [] })),
        /needs evidenceFor/);
    await assert.rejects(() => buildAdjudicatedVerdictEvent(baseVerdictArgs({
        verdict: 'contested', evidenceAgainst: []
    })), /BOTH ways/);
    await assert.rejects(() => buildAdjudicatedVerdictEvent(baseVerdictArgs({ claimCoord: '30062:x:y' })),
        /30040 coordinate/);
    await assert.rejects(() => buildAdjudicatedVerdictEvent(baseVerdictArgs({
        propositionClass: 'prediction', resolutionCriteria: { criteria: 'BLS rate.' }
    })), /requires a horizon/);
    await assert.rejects(() => buildAdjudicatedVerdictEvent(baseVerdictArgs({
        occurredAt: 1614729600, occurredPrecision: null
    })), /no false precision/);
    await assert.rejects(() => buildAdjudicatedVerdictEvent(baseVerdictArgs({ supersedesEventId: 'nope' })),
        /64-hex event id/);

    // Defaulted standard is still declared on the wire.
    const { event } = await buildAdjudicatedVerdictEvent(baseVerdictArgs({
        propositionClass: 'stated-commitment', standardOfProof: undefined, subjectRole: 'stated'
    }));
    assert.equal(event.tags.find((t) => t[0] === 'standard')[1], 'clear-and-convincing');

    const withChain = await buildAdjudicatedVerdictEvent(baseVerdictArgs({
        supersedesEventId: 'f'.repeat(64)
    }));
    const e = withChain.event.tags.find((t) => t[0] === 'e');
    assert.equal(e[3], 'supersedes');
});

test('30063 mirror: labels the claim coordinate, never a pubkey', () => {
    const { event } = buildVerdictMirrorEvent({
        claimCoord: CLAIM, verdict: 'established-false', sourceUrl: 'https://example.com/article'
    });
    assert.equal(event.kind, 1985);
    assert.equal(event.tags.some((t) => t[0] === 'p'), false, 'no person is labeled');
    assert.equal(event.tags.find((t) => t[0] === 'a')[1], CLAIM);
    const l = event.tags.find((t) => t[0] === 'l');
    assert.deepEqual([l[1], l[2]], ['established-false', ADJUDICATION_NAMESPACE]);
    assert.throws(() => buildVerdictMirrorEvent({ claimCoord: CLAIM, verdict: 'mostly-true' }),
        /invalid verdict/);
});

// --- kind 30064 -----------------------------------------------------------

test('30064: build + parse round-trip; d ignores deed order; subject is p-marked', async () => {
    const args = baseFindingArgs({
        gap: {
            cause: 'constraint',
            note: 'The pledged repeal was blocked in committee first.',
            constraintCoord: DEED2,
            evidence: [{ quote: 'Committee journal: tabled 9-4.', tier: 'tier-1' }]
        },
        supersedesEventId: 'f'.repeat(64),
        sourceUrl: 'https://example.com/article'
    });
    const { event, dTag } = await buildIntegrityFindingEvent(args);
    assert.equal(event.kind, KIND_INTEGRITY_FINDING);

    const reversed = await deriveIntegrityFindingDTag(
        { coord: WORD, class: 'stated-commitment' },
        [{ coord: DEED2, class: 'state-fact' }, { coord: DEED1, class: 'event-fact' }]);
    assert.equal(dTag, reversed, 'deed order is not identity');

    const p = event.tags.find((t) => t[0] === 'p');
    assert.deepEqual([p[1], p[3]], [SUBJECT, 'subject']);
    const wordTag = event.tags.find((t) => t[0] === 'word');
    assert.deepEqual(wordTag.slice(1), [WORD, 'stated-commitment', '1600000000', 'day']);
    assert.equal(event.tags.filter((t) => t[0] === 'deed').length, 2);
    assert.equal(event.tags.filter((t) => t[0] === 'a' && t[3] === 'deed').length, 2);
    assert.equal(event.tags.find((t) => t[0] === 'a' && t[3] === 'constraint')[1], DEED2);

    const parsed = parseIntegrityFindingEvent({ ...event, pubkey: AUTHOR, id: 'e'.repeat(64) });
    assert.equal(parsed.subjectPubkey, SUBJECT);
    assert.equal(parsed.match, 'broken');
    assert.equal(parsed.standardOfProof, 'clear-and-convincing', 'word-class default, declared');
    assert.equal(parsed.word.coord, WORD);
    assert.equal(parsed.word.occurredAt, 1600000000);
    assert.equal(parsed.deeds.length, 2);
    assert.equal(parsed.deeds[1].occurredAt, null, 'undated deed stays undated');
    assert.equal(parsed.gap.cause, 'constraint');
    assert.equal(parsed.gap.constraintCoord, DEED2);
    assert.equal(parsed.gap.evidence.length, 1);
    assert.equal(parsed.supersedesEventId, 'f'.repeat(64));
    assert.deepEqual(parsed.caveats, ['Single vote against a multi-year pledge.']);
});

test('30064: wire validation — sides, match vocabulary, documented gap, caveats', async () => {
    await assert.rejects(() => buildIntegrityFindingEvent(baseFindingArgs({ subjectPubkey: 'short' })),
        /64-hex pubkey/);
    await assert.rejects(() => buildIntegrityFindingEvent(baseFindingArgs({
        word: { coord: WORD, class: 'event-fact' }
    })), /word\.class/);
    await assert.rejects(() => buildIntegrityFindingEvent(baseFindingArgs({
        deeds: [{ coord: DEED1, class: 'stated-commitment' }]
    })), /deeds\[0\]\.class/);
    await assert.rejects(() => buildIntegrityFindingEvent(baseFindingArgs({ deeds: [] })),
        /nonempty array/);
    await assert.rejects(() => buildIntegrityFindingEvent(baseFindingArgs({ match: 'contradicted' })),
        /invalid match 'contradicted' for a stated-commitment/);
    await assert.rejects(() => buildIntegrityFindingEvent(baseFindingArgs({ match: 'broken', evidenceFor: [] })),
        /needs evidenceFor/);
    await assert.rejects(() => buildIntegrityFindingEvent(baseFindingArgs({ caveats: ['  '] })),
        /caveat required/);
    await assert.rejects(() => buildIntegrityFindingEvent(baseFindingArgs({
        match: 'fulfilled', gap: { cause: 'revision', note: 'x' }
    })), /gap only attaches/);
    await assert.rejects(() => buildIntegrityFindingEvent(baseFindingArgs({
        gap: { cause: 'lie', note: '' }
    })), /must be documented/);
    await assert.rejects(() => buildIntegrityFindingEvent(baseFindingArgs({
        gap: { cause: 'constraint', note: 'Blocked.' }
    })), /needs constraintCoord/);
    await assert.rejects(() => buildIntegrityFindingEvent(baseFindingArgs({
        gap: { cause: 'revision', note: 'Disclosed.', revisionCoord: '30040:bad:ref' }
    })), /30055 coordinate/);
});

test('30064: parser is defensive — wrong kind, smuggled match, missing caveat all null', async () => {
    const { event } = await buildIntegrityFindingEvent(baseFindingArgs());
    assert.equal(parseIntegrityFindingEvent({ ...event, kind: 30062 }), null);

    const smuggledMatch = {
        ...event,
        tags: event.tags.map((t) =>
            (t[0] === 'l' && t[2] === ADJUDICATION_NAMESPACE) ? ['l', 'contradicted', ADJUDICATION_NAMESPACE] : t)
    };
    assert.equal(parseIntegrityFindingEvent(smuggledMatch), null,
        'a contradicted match on a commitment word never parses');

    const noCaveat = { ...event, tags: event.tags.filter((t) => t[0] !== 'caveat') };
    assert.equal(parseIntegrityFindingEvent(noCaveat), null, 'caveats are structural, not decorative');

    assert.equal(parseAdjudicatedVerdictEvent(null), null);
    assert.equal(parseIntegrityFindingEvent(null), null);
});

// --- surrounding wiring -----------------------------------------------------

test('wire: kind constants, dispute targets extended, flag default off', () => {
    assert.equal(KIND_ADJUDICATED_VERDICT, 30063);
    assert.equal(KIND_INTEGRITY_FINDING, 30064);
    assert.equal(KIND_PRECEDENT_RESERVED, 30065, 'reserved, unimplemented (§3.6)');

    assert.deepEqual(DISPUTE_TARGET_KINDS.slice().sort(), [
        'aggregate_audit', 'claim', 'integrity_finding',
        'module_result', 'prediction_resolution', 'verdict'
    ], 'a 30061 can now target verdict/integrity coordinates — additive');

    assert.equal(FLAGS_DEFAULTS.truthAdjudicationPublishing, false,
        'publish paths gated off by default; the SW always accepts inbound');
});

// --- Slice A conformance: citations, right-of-reply, exposure, read-side adequacy ---

test('citations: precedents / reply refs / exposure round-trip on both kinds', async () => {
    const PRECEDENT = `30063:${AUTHOR}:verdict_abcdef1234567890`;
    const REPLY = 'c'.repeat(64);
    const { event } = await buildAdjudicatedVerdictEvent(baseVerdictArgs({
        precedents: [{ coord: PRECEDENT, weight: 'binding' }, { coord: `30064:${AUTHOR}:integrity_x` }],
        replyEventIds: [REPLY],
        exposure: 'Donor to the subject\'s opponent in 2024.'
    }));
    const pTags = event.tags.filter((t) => t[0] === 'a' && t[3] === 'precedent');
    assert.equal(pTags.length, 2);
    assert.equal(pTags[0][4], 'binding');
    assert.equal(pTags[1][4], 'persuasive', 'an unweighted citation defaults DOWN, never up');
    assert.deepEqual(event.tags.find((t) => t[0] === 'e' && t[3] === 'reply')[1], REPLY);
    assert.equal(event.tags.find((t) => t[0] === 'exposure')[1], 'Donor to the subject\'s opponent in 2024.');

    const parsed = parseAdjudicatedVerdictEvent({ ...event, pubkey: AUTHOR, id: 'e'.repeat(64) });
    assert.deepEqual(parsed.precedents, [
        { coord: PRECEDENT, weight: 'binding' },
        { coord: `30064:${AUTHOR}:integrity_x`, weight: 'persuasive' }
    ]);
    assert.deepEqual(parsed.replyEventIds, [REPLY]);
    assert.equal(parsed.exposure, 'Donor to the subject\'s opponent in 2024.');
    assert.equal(parsed.supersedesEventId, null, 'reply e-tags never masquerade as supersession');

    await assert.rejects(() => buildAdjudicatedVerdictEvent(baseVerdictArgs({
        precedents: [{ coord: '30040:bad:kind' }]
    })), /30063\/30064 coordinate/);
    await assert.rejects(() => buildAdjudicatedVerdictEvent(baseVerdictArgs({
        precedents: [{ coord: PRECEDENT, weight: 'decisive' }]
    })), /binding \| persuasive/);
    await assert.rejects(() => buildAdjudicatedVerdictEvent(baseVerdictArgs({
        replyEventIds: ['nope']
    })), /64-hex event id/);

    // Same fields on 30064.
    const finding = await buildIntegrityFindingEvent(baseFindingArgs({
        precedents: [{ coord: PRECEDENT, weight: 'persuasive' }],
        replyEventIds: [REPLY],
        exposure: 'Former staffer for the subject.'
    }));
    const fParsed = parseIntegrityFindingEvent({ ...finding.event, pubkey: AUTHOR, id: 'e'.repeat(64) });
    assert.equal(fParsed.precedents.length, 1);
    assert.deepEqual(fParsed.replyEventIds, [REPLY]);
    assert.equal(fParsed.exposure, 'Former staffer for the subject.');
});

test('read-side adequacy: evidence-less established/contested events null-parse', async () => {
    const { event } = await buildAdjudicatedVerdictEvent(baseVerdictArgs());
    const stripped = { ...event, tags: event.tags.filter((t) => t[0] !== 'evidence-for') };
    assert.equal(parseAdjudicatedVerdictEvent(stripped), null,
        'a foreign established-true with no evidence-for never renders');

    const contested = await buildAdjudicatedVerdictEvent(baseVerdictArgs({
        verdict: 'contested',
        evidenceAgainst: [{ quote: 'Counter-record.' }]
    }));
    const oneSided = { ...contested.event, tags: contested.event.tags.filter((t) => t[0] !== 'evidence-against') };
    assert.equal(parseAdjudicatedVerdictEvent(oneSided), null);

    // The honest states still parse evidence-less.
    const honest = await buildAdjudicatedVerdictEvent(baseVerdictArgs({
        verdict: 'insufficient-evidence', evidenceFor: []
    }));
    assert.ok(parseAdjudicatedVerdictEvent({ ...honest.event, pubkey: AUTHOR, id: 'e'.repeat(64) }));

    // 30064: a substantive match stripped of evidence-for null-parses.
    const finding = await buildIntegrityFindingEvent(baseFindingArgs());
    const fStripped = { ...finding.event, tags: finding.event.tags.filter((t) => t[0] !== 'evidence-for') };
    assert.equal(parseIntegrityFindingEvent(fStripped), null);
});

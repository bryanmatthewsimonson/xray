// Forensic wire builders — Phase 14.3 (docs/CRIMINOLOGY_DESIGN.md §30062).
// Build/parse round-trip for kind 30062 BehavioralFinding, the kind-1985
// maneuver mirror, the revision/* values on kind 30055, and the
// audit/assessment firewall (no stance / rating-value / xray/assessment).

import { test } from 'node:test';
import assert from 'node:assert/strict';

// storage.js touches chrome at import time; the parser lives in
// forensic-model.js, which pulls it in.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const {
    buildBehavioralFindingEvent, buildForensicFindingMirrorEvent,
    buildClaimRelationshipEvent, FORENSIC_COUNTER_HEADING
} = await import('../src/shared/metadata/builders.js');
const { parseBehavioralFindingEvent } = await import('../src/shared/forensic-model.js');

const PK = 'a'.repeat(64);
const SELECTOR = [{ type: 'TextQuoteSelector', exact: 'I care about the truth' }];

function baseArgs(over = {}) {
    return {
        subjectPubkey: PK,
        maneuver: 'defense/usefulness-pivot',
        role: 'apologist',
        anchors: [{ quote: 'I care about the truth, not what the church says.', selector: SELECTOR }],
        counterNote: 'He may simply be conceding utility alongside the truth claim.',
        note: 'Shifts the axis from is-it-true to is-it-useful.',
        basis: 'quoted',
        sourceUrl: 'https://example.com/clip?utm_source=x',
        ...over
    };
}

function tagsByName(ev, name) { return ev.tags.filter((t) => t[0] === name); }

test('30062: tag set matches the §30062 spec', async () => {
    const { event, dTag } = await buildBehavioralFindingEvent(baseArgs());
    assert.equal(event.kind, 30062);
    assert.match(dTag, /^find:[0-9a-f]{16}$/);
    assert.deepEqual(event.tags.find((t) => t[0] === 'd'), ['d', dTag]);
    assert.deepEqual(event.tags.find((t) => t[0] === 'p'), ['p', PK, '', 'subject']);
    assert.deepEqual(event.tags.find((t) => t[0] === 'L'), ['L', 'xray/forensic']);
    assert.deepEqual(event.tags.find((t) => t[0] === 'l'), ['l', 'defense/usefulness-pivot', 'xray/forensic']);
    assert.deepEqual(event.tags.find((t) => t[0] === 'role'), ['role', 'apologist']);
    assert.deepEqual(event.tags.find((t) => t[0] === 'r'), ['r', 'https://example.com/clip?utm_source=x']);
    assert.equal(event.tags.find((t) => t[0] === 'i')[1], 'https://example.com/clip', 'i is normalized (utm stripped)');
    assert.deepEqual(event.tags.find((t) => t[0] === 'k'), ['k', 'web']);
    assert.deepEqual(event.tags.find((t) => t[0] === 'basis'), ['basis', 'quoted']);
    assert.deepEqual(event.tags.find((t) => t[0] === 'suggested-by'), ['suggested-by', 'user']);
    assert.deepEqual(event.tags.find((t) => t[0] === 'client'), ['client', 'xray']);
    const step = event.tags.find((t) => t[0] === 'maneuver-step');
    assert.equal(step[1], '0');
    assert.equal(step[2], 'I care about the truth, not what the church says.');
    assert.equal(JSON.parse(step[3])[0].exact, 'I care about the truth');
});

test('30062: content carries note then the required counter-read', async () => {
    const { event, body } = await buildBehavioralFindingEvent(baseArgs());
    assert.ok(body.startsWith('Shifts the axis'));
    assert.ok(body.includes(FORENSIC_COUNTER_HEADING));
    assert.ok(body.trimEnd().endsWith('alongside the truth claim.'));
    assert.equal(event.content, body);
});

test('30062: the audit/assessment firewall holds (no stance / rating / xray/assessment)', async () => {
    const { event } = await buildBehavioralFindingEvent(baseArgs());
    assert.equal(tagsByName(event, 'stance').length, 0);
    assert.equal(tagsByName(event, 'rating-value').length, 0);
    for (const t of event.tags) {
        assert.notEqual(t[1], 'xray/assessment', 'never the assessment namespace');
        if (t[0] === 'l') assert.equal(t[2], 'xray/forensic');
    }
});

test('30062: d is deterministic and recomputable from the same inputs', async () => {
    const a = await buildBehavioralFindingEvent(baseArgs());
    const b = await buildBehavioralFindingEvent(baseArgs({ note: 'different note', createdAt: 123 }));
    assert.equal(a.dTag, b.dTag, 'd ignores note/createdAt — keys on subject|maneuver|anchors');
    const c = await buildBehavioralFindingEvent(baseArgs({ maneuver: 'darvo/attack' }));
    assert.notEqual(a.dTag, c.dTag, 'a different maneuver derives a different d');
});

test('30062: rejects missing counter-note / anchors / bad enums / bad subject', async () => {
    await assert.rejects(() => buildBehavioralFindingEvent(baseArgs({ counterNote: '  ' })), /counterNote required/);
    await assert.rejects(() => buildBehavioralFindingEvent(baseArgs({ anchors: [] })), /at least one evidence anchor/);
    await assert.rejects(() => buildBehavioralFindingEvent(baseArgs({ anchors: [{ quote: ' ' }] })), /non-empty quote/);
    await assert.rejects(() => buildBehavioralFindingEvent(baseArgs({ maneuver: 'Bad' })), /invalid maneuver/);
    await assert.rejects(() => buildBehavioralFindingEvent(baseArgs({ role: 'prosecutor' })), /invalid role/);
    await assert.rejects(() => buildBehavioralFindingEvent(baseArgs({ basis: 'vibes' })), /invalid basis/);
    await assert.rejects(() => buildBehavioralFindingEvent(baseArgs({ subjectPubkey: 'xyz' })), /64-hex/);
    await assert.rejects(() => buildBehavioralFindingEvent(baseArgs({ relationshipCoord: '30040:bad' })), /30055 coordinate/);
});

test('30062: build → parse round-trip', async () => {
    const relCoord = `30055:${'b'.repeat(64)}:rel:abc`;
    const { event } = await buildBehavioralFindingEvent(baseArgs({
        relationshipCoord: relCoord,
        anchors: [
            { quote: 'first step', selector: SELECTOR, timestamp: 12 },
            { quote: 'second step' }
        ]
    }));
    event.pubkey = 'f'.repeat(64);
    event.id = 'e'.repeat(64);
    const p = parseBehavioralFindingEvent(event);
    assert.equal(p.subjectPubkey, PK);
    assert.equal(p.maneuver, 'defense/usefulness-pivot');
    assert.equal(p.role, 'apologist');
    assert.equal(p.basis, 'quoted');
    assert.equal(p.note, 'Shifts the axis from is-it-true to is-it-useful.');
    assert.equal(p.counterNote, 'He may simply be conceding utility alongside the truth claim.');
    assert.equal(p.relationshipCoord, relCoord);
    assert.equal(p.anchors.length, 2);
    assert.equal(p.anchors[0].quote, 'first step');
    assert.equal(p.anchors[0].timestamp, 12);
    assert.equal(p.anchors[0].selector[0].exact, 'I care about the truth');
    assert.equal(p.anchors[1].quote, 'second step');
    assert.equal(p.anchors[1].selector, null);
    assert.equal(parseBehavioralFindingEvent({ kind: 30054 }), null, 'wrong kind → null');
});

test('30062 parse: role values beyond the original six are tolerated (NIP_DRAFT MUST, 27 F.6)', async () => {
    const { event } = await buildBehavioralFindingEvent(baseArgs({ role: 'journalist' }));
    event.pubkey = 'f'.repeat(64);
    event.id = 'e'.repeat(64);
    assert.equal(parseBehavioralFindingEvent(event).role, 'journalist');
    // A FOREIGN event with a role outside our taxonomy still parses —
    // consumers MUST tolerate unknown role values.
    const foreign = JSON.parse(JSON.stringify(event));
    for (const t of foreign.tags) if (t[0] === 'role') t[1] = 'prosecutor';
    assert.equal(parseBehavioralFindingEvent(foreign).role, 'prosecutor',
        'unknown role passes through on read; only the BUILD side validates');
});

test('1985 mirror: labels the SUBJECT pubkey under xray/forensic', async () => {
    const { event, dTag } = buildForensicFindingMirrorEvent({
        subjectPubkey: PK, maneuver: 'darvo/attack', sourceUrl: 'https://example.com/x'
    });
    assert.equal(event.kind, 1985);
    assert.equal(dTag, null);
    assert.deepEqual(event.tags.find((t) => t[0] === 'L'), ['L', 'xray/forensic']);
    assert.deepEqual(event.tags.find((t) => t[0] === 'l'), ['l', 'darvo/attack', 'xray/forensic']);
    assert.deepEqual(event.tags.find((t) => t[0] === 'p'), ['p', PK], 'the subject is the labeled target');
    assert.deepEqual(event.tags.find((t) => t[0] === 'r'), ['r', 'https://example.com/x']);
    assert.throws(() => buildForensicFindingMirrorEvent({ subjectPubkey: PK, maneuver: 'BAD' }), /invalid maneuver/);
});

test('30055: the directional revision/* values now build', async () => {
    const A = `30040:${'a'.repeat(64)}:claim_a`;
    const B = `30040:${'b'.repeat(64)}:claim_b`;
    for (const rel of ['narrative-patch', 'recharacterizes', 'walks-back']) {
        const { event } = await buildClaimRelationshipEvent({
            sourceCoord: A, targetCoord: B, relationship: rel,
            sourceUrl: 'https://ex.com/a', targetUrl: 'https://ex.com/b'
        });
        assert.equal(event.kind, 30055);
        assert.deepEqual(event.tags.find((t) => t[0] === 'relationship'), ['relationship', rel]);
        // directional: source stays first (not sorted like symmetric rels)
        assert.equal(event.tags.find((t) => t[0] === 'a' && t[3] === 'source')[1], A);
        assert.equal(event.tags.find((t) => t[0] === 'a' && t[3] === 'target')[1], B);
    }
    await assert.rejects(() => buildClaimRelationshipEvent({
        sourceCoord: A, targetCoord: B, relationship: 'vibes-shift'
    }), /relationship must be one of/);
});

// Portal forensic findings — Phase 14.4 (docs/CRIMINOLOGY_DESIGN.md).
// The 30062 → library item routing (subject-name resolution from the
// entity index) and the pure forensic-data joins/summaries the lens
// views render. Real builder → real parser → buildItems → forensic-data.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// library.js → forensic-model.js → storage.js probes chrome at load.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { buildItems } = await import('../src/portal/library.js');
const { buildBehavioralFindingEvent } = await import('../src/shared/metadata/builders.js');
const {
    findingsForEntity, maneuverTally, leadQuote, maneuverShort, FINDING_LENSES
} = await import('../src/portal/forensic-data.js');

const SUBJECT_PK = 'a'.repeat(64);
const OTHER_PK = 'c'.repeat(64);
const ENTITY_INDEX = { [SUBJECT_PK]: { entityId: 'ent_jacob', name: 'Jacob Hansen', type: 'person' } };

async function findingRecord({ maneuver, role = 'apologist', quote, createdAt }) {
    const { event } = await buildBehavioralFindingEvent({
        subjectPubkey: SUBJECT_PK, maneuver, role,
        anchors: [{ quote }], counterNote: 'A fair alternative reading.',
        note: 'structural', basis: 'quoted', sourceUrl: 'https://e.com/x',
        createdAt
    });
    return { event, relays: ['wss://relay.example'] };
}

test('30062 routes to the "finding" facet with subject name resolved', async () => {
    const recs = [await findingRecord({ maneuver: 'defense/usefulness-pivot', quote: 'I care about the truth.', createdAt: 100 })];
    const items = buildItems(recs, { entityIndex: ENTITY_INDEX });
    const item = items.find((i) => i.kind === 30062);
    assert.ok(item, 'a finding item exists');
    assert.equal(item.typeKey, 'finding');
    assert.equal(item.title, 'Finding — defense/usefulness-pivot');
    assert.match(item.sub, /Jacob Hansen · apologist/);
    assert.ok(item.parsedFinding, 'parsedFinding rides on the item');
    assert.equal(item.parsedFinding.subjectPubkey, SUBJECT_PK);
    assert.match(item.searchText, /jacob hansen/);
});

test('30062 with no local entity falls back to a short pubkey', async () => {
    const recs = [await findingRecord({ maneuver: 'darvo/attack', quote: 'You are biased.', createdAt: 100 })];
    const items = buildItems(recs, { entityIndex: {} });
    const item = items.find((i) => i.kind === 30062);
    assert.match(item.sub, /^aaaaaaaaaa… · apologist/);
});

test('findingsForEntity joins by subject pubkey, newest first', async () => {
    const recs = [
        await findingRecord({ maneuver: 'defense/ad-hoc-patch', quote: 'older', createdAt: 100 }),
        await findingRecord({ maneuver: 'darvo/attack', quote: 'newer', createdAt: 300 })
    ];
    const items = buildItems(recs, { entityIndex: ENTITY_INDEX });
    const mine = findingsForEntity(items, SUBJECT_PK);
    assert.equal(mine.length, 2);
    assert.equal(mine[0].anchors[0].quote, 'newer', 'sorted newest-first');
    assert.equal(findingsForEntity(items, OTHER_PK).length, 0, 'a different subject gets none');
    assert.equal(findingsForEntity(items, null).length, 0);
});

test('maneuverTally counts most-frequent first; leadQuote/maneuverShort', async () => {
    const findings = [
        { maneuver: 'defense/ad-hoc-patch', anchors: [{ quote: 'q1' }] },
        { maneuver: 'defense/ad-hoc-patch', anchors: [{ quote: 'q2' }] },
        { maneuver: 'darvo/attack', anchors: [] }
    ];
    assert.deepEqual(maneuverTally(findings), [
        { maneuver: 'defense/ad-hoc-patch', count: 2 },
        { maneuver: 'darvo/attack', count: 1 }
    ]);
    assert.equal(leadQuote(findings[0]), 'q1');
    assert.equal(leadQuote(findings[2]), '', 'no anchors → empty lead quote');
    assert.equal(maneuverShort('defense/ad-hoc-patch'), 'ad-hoc-patch');
    assert.deepEqual(FINDING_LENSES, ['evidentiary', 'executive', 'survivor', 'editor']);
});

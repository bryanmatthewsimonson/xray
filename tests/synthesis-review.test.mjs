// Proposal-triage partition tests — 27 S.3 review fix. The DOM render
// projects the pure `partitionProposals` seam 1:1; these pin the
// contract the persistence rides on: statuses key by proposalKey
// (content-derived, endpoint-order-insensitive), and anything without
// a RECOGNIZED status is OPEN — an unknown status must never hide a
// proposal.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { partitionProposals, describeProposal } = await import('../src/portal/synthesis-review.js');
const { DEPENDENCY_AUTHORING_TEST } = await import('../src/shared/assessment-taxonomy.js');
const { proposalKey } = await import('../src/shared/case-synthesis.js');

const rel = (s, t) => ({ kind: 'relationship', source_claim_id: s, target_claim_id: t, relationship: 'supports' });
const key = (p) => proposalKey(p);

test('synthesis-review: partition routes by triage status; missing/unknown statuses stay open', () => {
    const a = rel('c1', 'c2');
    const b = rel('c3', 'c4');
    const c = { kind: 'is_key', claim_id: 'c5' };
    const d = rel('c6', 'c7');
    const triage = {
        [key(a)]: 'accepted',
        [key(b)]: 'dismissed',
        [key(c)]: 'starred'   // unknown status → must stay open
    };
    const { open, accepted, dismissed } = partitionProposals([a, b, c, d], triage);
    assert.deepEqual(accepted, [a]);
    assert.deepEqual(dismissed.map((x) => x.p), [b]);
    assert.deepEqual(open.map((x) => x.p), [c, d], 'unknown status and no status both stay open');
    assert.equal(open[1].key, key(d), 'open rows carry the key the triage write will use');
});

test('synthesis-review: a flipped SYMMETRIC proposal keeps its triage status; a flipped DIRECTIONAL one is a new open row (D.5)', () => {
    // The reduce may emit a symmetric pair in either direction on a
    // re-run; the order-insensitive key means a dismissal survives the
    // flip. A directional pair reversed is a different claim about the
    // world, so it opens fresh.
    const sym = (s, t) => ({ kind: 'relationship', source_claim_id: s, target_claim_id: t, relationship: 'contradicts' });
    const triage = { [key(sym('c1', 'c2'))]: 'dismissed', [key(rel('c1', 'c2'))]: 'dismissed' };
    const flippedSym = partitionProposals([sym('c2', 'c1')], triage);
    assert.equal(flippedSym.open.length, 0);
    assert.equal(flippedSym.dismissed.length, 1);
    const flippedDir = partitionProposals([rel('c2', 'c1')], triage);
    assert.equal(flippedDir.open.length, 1, 'B supports A is not the dismissed A supports B');
    assert.equal(flippedDir.dismissed.length, 0);
});

test('synthesis-review: empty inputs partition to empty — the zero-proposals message is reachable', () => {
    const { open, accepted, dismissed } = partitionProposals([], {});
    assert.deepEqual([open, accepted, dismissed], [[], [], []]);
    const noTriage = partitionProposals([rel('c1', 'c2')]);
    assert.equal(noTriage.open.length, 1, 'triage map optional');
});

test('synthesis-review: a depends-on row shows the authoring test; a supports row does not (D.5)', () => {
    const claimsById = { c1: { text: 'Source says.' }, c2: { text: 'Target says.' } };
    const dep = describeProposal({ kind: 'relationship', source_claim_id: 'c1', target_claim_id: 'c2', relationship: 'depends-on' }, claimsById);
    assert.match(dep, /^Link: "Source says\." depends-on "Target says\."/);
    assert.ok(dep.endsWith(` — ${DEPENDENCY_AUTHORING_TEST}`));
    const sup = describeProposal(rel('c1', 'c2'), claimsById);
    assert.ok(!sup.includes('Could the source still be true'));
});

test('synthesis-review: a legacy sorted triage key never matches a new directional proposal (D.5 review)', () => {
    const triage = { 'rel:c1|c2:supports': 'dismissed' };   // written before D.5 for EITHER direction
    assert.equal(partitionProposals([rel('c1', 'c2')], triage).open.length, 1);
    assert.equal(partitionProposals([rel('c2', 'c1')], triage).open.length, 1);
});

test('synthesis-review: a rests_on row with no source claim says so and names its target (D.5 review)', () => {
    const row = { kind: 'relationship', source_claim_id: null, target_claim_id: 'c2', relationship: 'depends-on', from_rests_on: true, quote: 'The lab log.' };
    const text = describeProposal(row, { c2: { text: 'Target says.' } });
    assert.match(text, /^Dependency proposal with no source claim \(the brief quoted “The lab log\.” but named no claim\): rests on "Target says\."/);
});

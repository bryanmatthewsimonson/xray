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

const { partitionProposals } = await import('../src/portal/synthesis-review.js');
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

test('synthesis-review: a re-proposed relationship with flipped endpoints keeps its triage status', () => {
    // The reduce may emit the same logical pair in either direction on
    // a re-run; the endpoint-order-insensitive key means a dismissal
    // survives the flip.
    const triage = { [key(rel('c1', 'c2'))]: 'dismissed' };
    const { open, dismissed } = partitionProposals([rel('c2', 'c1')], triage);
    assert.equal(open.length, 0);
    assert.equal(dismissed.length, 1);
});

test('synthesis-review: empty inputs partition to empty — the zero-proposals message is reachable', () => {
    const { open, accepted, dismissed } = partitionProposals([], {});
    assert.deepEqual([open, accepted, dismissed], [[], [], []]);
    const noTriage = partitionProposals([rel('c1', 'c2')]);
    assert.equal(noTriage.open.length, 1, 'triage map optional');
});

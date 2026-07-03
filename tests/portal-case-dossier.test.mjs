// Case-dossier block — CD.2 pure shaping helpers
// (docs/CASE_DOSSIER_DESIGN.md §3.1/§3.4). Tests the presentation logic
// (shapeOfKnowledge / evidenceView) over a hand-built CD.1-shaped
// dossier; the DOM renderer and the assembler have their own coverage.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// case-dossier-block → case-dossier.js → storage.js probes chrome at load.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { shapeOfKnowledge, evidenceView } = await import('../src/portal/case-dossier-block.js');

function dossierFixture() {
    return {
        case: { id: 'entity_case', name: 'Eggs', type: 'case' },
        coverage: {
            articles: 3, claims: 6, claims_with_propositions: 5,
            propositions: 5, entities: 4
        },
        distribution: {
            total: 4,
            by_state: { 'insufficient-evidence': 2, 'established-true': 1, 'contested': 1 },
            by_standard: { 'preponderance': 1, 'beyond-reasonable-doubt': 2 },
            states_present: ['established-true', 'contested', 'insufficient-evidence'],
            unanimous: false
        },
        evidence: {
            articles: [
                { url: 'https://u1', claim_ids: ['c1', 'c2'], key_claim_count: 1 },
                { url: 'https://u2', claim_ids: ['c3'], key_claim_count: 0 }
            ],
            convergence: {
                total_attestations: 3,
                origin_count: 2,
                independent_count: 1,
                by_tier: { 'tier-2': 1 },
                origin_groups: [
                    { origin_key: 'wire-x', tier: 'tier-2', link_ids: ['a', 'b'],
                      baseline: true, demonstrated: true, independence_notes: [] },
                    { origin_key: 'wire-y', tier: 'tier-1', link_ids: ['c'],
                      baseline: false, demonstrated: false, independence_notes: [] }
                ]
            }
        }
    };
}

test('shapeOfKnowledge orders the distribution canonically, never as a score', () => {
    const s = shapeOfKnowledge(dossierFixture());
    // Canonical VERDICT_STATES order: true, false, contested, unresolved, insufficient.
    assert.deepEqual(s.distribution.map((d) => d.state),
        ['established-true', 'contested', 'insufficient-evidence']);
    assert.deepEqual(s.distribution.map((d) => d.count), [1, 1, 2]);
    assert.equal(s.total, 4);
    assert.equal('score' in s, false);         // no fused number
});

test('shapeOfKnowledge computes unruled = propositions - ruled, and passes coverage through', () => {
    const s = shapeOfKnowledge(dossierFixture());
    assert.equal(s.unruled, 1);                 // 5 propositions, 4 ruled
    assert.equal(s.coverage.articles, 3);
    assert.equal(s.coverage.propositions, 5);
    assert.equal(s.unanimous, false);
});

test('shapeOfKnowledge sorts standards by count desc, labels them', () => {
    const s = shapeOfKnowledge(dossierFixture());
    assert.deepEqual(s.standards.map((x) => x.standard),
        ['beyond-reasonable-doubt', 'preponderance']);   // 2 before 1
    assert.equal(s.standards[0].label, 'Beyond reasonable doubt');
});

test('shapeOfKnowledge tolerates an empty dossier', () => {
    const s = shapeOfKnowledge({});
    assert.deepEqual(s.distribution, []);
    assert.equal(s.total, 0);
    assert.equal(s.unruled, 0);
    assert.deepEqual(s.standards, []);
    assert.equal(s.coverage.articles, 0);
});

test('evidenceView surfaces origin groups with baseline/independence flags', () => {
    const e = evidenceView(dossierFixture());
    assert.equal(e.origin_groups.length, 2);
    assert.equal(e.origin_groups[0].origin_key, 'wire-x');
    assert.equal(e.origin_groups[0].baseline, true);
    assert.equal(e.origin_groups[0].link_count, 2);
    assert.equal(e.origin_groups[0].tier_label, 'Independent reporting');
    assert.equal(e.origin_groups[1].demonstrated, false);
});

test('evidenceView passes the convergence summary and articles through', () => {
    const e = evidenceView(dossierFixture());
    assert.equal(e.summary.origin_count, 2);
    assert.equal(e.summary.independent_count, 1);       // correlated coverage not counted independent
    assert.equal(e.summary.total_attestations, 3);
    assert.deepEqual(e.articles.map((a) => a.url), ['https://u1', 'https://u2']);
});

test('evidenceView tolerates a dossier with no attestation', () => {
    const e = evidenceView({ evidence: { articles: [], convergence: {} } });
    assert.deepEqual(e.origin_groups, []);
    assert.equal(e.summary.total_attestations, 0);
    assert.deepEqual(e.articles, []);
});

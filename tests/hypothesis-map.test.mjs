// Hypothesis map tests — H.1 (docs/HYPOTHESIS_MAP_DESIGN.md).
//
// The pure model + assembler: no storage, no DOM. The load-bearing
// invariants: positions seed hypotheses (label + statement); holders
// become article-level `supports` edges; human edges are carried or
// orphaned (never silently dropped, P6); a user edge supersedes a
// synthesis seed at the same target+role; determinism; and — the
// firewall — the produced object carries NO numeric score/weight/
// probability/likelihood/confidence/strength key anywhere (§6 guard).

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { buildHypothesisMap, hypothesisId, claimEdge, EDGE_ROLES } =
    await import('../src/shared/hypothesis-map.js');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const LOCAL_1 = 'claim_' + '1'.repeat(16);
const LOCAL_2 = 'claim_' + '2'.repeat(16);

const POSITIONS = [
    { label: 'Zoonotic spillover', core_argument: 'Natural jump at the market.', holders: [{ article_hash: HASH_A }, { article_hash: HASH_B }] },
    { label: 'Lab-associated', core_argument: 'A research-related incident.', holders: [{ article_hash: HASH_C }] }
];

// ------------------------------------------------------------------
// Seeding from positions
// ------------------------------------------------------------------

test('seeds one hypothesis per position with label + statement', () => {
    const map = buildHypothesisMap({ question: 'How did it start?', positions: POSITIONS });
    assert.equal(map.question, 'How did it start?');
    assert.equal(map.hypotheses.length, 2);
    assert.equal(map.hypotheses[0].label, 'Zoonotic spillover');
    assert.equal(map.hypotheses[0].statement, 'Natural jump at the market.');
    assert.equal(map.hypotheses[0].id, 'hyp_zoonotic-spillover');
    assert.equal(map.hypotheses[1].id, 'hyp_lab-associated');
});

test('holders become article-level supports edges (claim_ref null, provenance synthesis)', () => {
    const map = buildHypothesisMap({ positions: POSITIONS });
    const h0 = map.hypotheses[0];
    assert.equal(h0.edges.length, 2);
    for (const e of h0.edges) {
        assert.equal(e.role, 'supports');
        assert.equal(e.claim_ref, null);
        assert.equal(e.provenance, 'synthesis');
        assert.ok(e.article_hash);
    }
    assert.deepEqual(h0.edges.map((e) => e.article_hash), [HASH_A, HASH_B]);
});

test('duplicate holders within a position dedupe to one edge', () => {
    const map = buildHypothesisMap({ positions: [
        { label: 'X', core_argument: '', holders: [{ article_hash: HASH_A }, { article_hash: HASH_A }] }
    ] });
    assert.equal(map.hypotheses[0].edges.length, 1);
});

test('holder with no article_hash is skipped', () => {
    const map = buildHypothesisMap({ positions: [
        { label: 'X', holders: [{ article_hash: '' }, {}, { article_hash: HASH_A }] }
    ] });
    assert.equal(map.hypotheses[0].edges.length, 1);
    assert.equal(map.hypotheses[0].edges[0].article_hash, HASH_A);
});

test('label collisions get a disambiguating suffix', () => {
    const map = buildHypothesisMap({ positions: [
        { label: 'Same', core_argument: 'a' }, { label: 'Same', core_argument: 'b' }
    ] });
    assert.equal(map.hypotheses[0].id, 'hyp_same');
    assert.equal(map.hypotheses[1].id, 'hyp_same-2');
});

test('empty positions yields an empty map', () => {
    const map = buildHypothesisMap({});
    assert.deepEqual(map.hypotheses, []);
    assert.deepEqual(map.orphaned_edges, []);
    assert.equal(map.coverage.hypotheses, 0);
});

// ------------------------------------------------------------------
// Carrying human-drawn edges
// ------------------------------------------------------------------

test('human edges attach to their hypothesis at claim level', () => {
    const map = buildHypothesisMap({
        positions: POSITIONS,
        humanEdges: [
            { hypothesis_id: 'hyp_lab-associated', claim_ref: LOCAL_1, role: 'supports', quote: 'q' },
            { hypothesis_id: 'hyp_zoonotic-spillover', claim_ref: LOCAL_2, role: 'undermines' }
        ]
    });
    const lab = map.hypotheses.find((h) => h.id === 'hyp_lab-associated');
    const claimEdges = lab.edges.filter((e) => e.claim_ref === LOCAL_1);
    assert.equal(claimEdges.length, 1);
    assert.equal(claimEdges[0].role, 'supports');
    assert.equal(claimEdges[0].provenance, 'user');
    assert.equal(claimEdges[0].quote, 'q');

    const zoo = map.hypotheses.find((h) => h.id === 'hyp_zoonotic-spillover');
    assert.ok(zoo.edges.some((e) => e.claim_ref === LOCAL_2 && e.role === 'undermines'));
    assert.equal(map.coverage.human_edges, 2);
});

test('a human edge to an unknown hypothesis is orphaned, never dropped (P6)', () => {
    const map = buildHypothesisMap({
        positions: POSITIONS,
        humanEdges: [{ hypothesis_id: 'hyp_gone', claim_ref: LOCAL_1, role: 'supports' }]
    });
    assert.equal(map.orphaned_edges.length, 1);
    assert.equal(map.orphaned_edges[0].hypothesis_id, 'hyp_gone');
    assert.equal(map.orphaned_edges[0].claim_ref, LOCAL_1);
    assert.equal(map.coverage.orphaned_edges, 1);
    assert.equal(map.coverage.human_edges, 0);
});

test('a user edge supersedes a synthesis seed at the same target+role', () => {
    const map = buildHypothesisMap({
        positions: [{ label: 'X', holders: [{ article_hash: HASH_A }] }],
        humanEdges: [{ hypothesis_id: 'hyp_x', role: 'supports', article_hash: HASH_A, provenance: 'user' }]
    });
    const edges = map.hypotheses[0].edges.filter((e) => e.article_hash === HASH_A && e.role === 'supports');
    assert.equal(edges.length, 1, 'no duplicate seed+user edge');
    assert.equal(edges[0].provenance, 'user', 'user confirmation wins');
});

test('a same-target opposite-role human edge coexists (the disagreement is the point)', () => {
    const map = buildHypothesisMap({
        positions: [{ label: 'X', holders: [{ article_hash: HASH_A }] }],
        humanEdges: [{ hypothesis_id: 'hyp_x', role: 'undermines', article_hash: HASH_A }]
    });
    const roles = map.hypotheses[0].edges.filter((e) => e.article_hash === HASH_A).map((e) => e.role).sort();
    assert.deepEqual(roles, ['supports', 'undermines']);
});

test('malformed-role human edges are dropped', () => {
    const map = buildHypothesisMap({
        positions: POSITIONS,
        humanEdges: [{ hypothesis_id: 'hyp_lab-associated', claim_ref: LOCAL_1, role: 'weighs' }]
    });
    const lab = map.hypotheses.find((h) => h.id === 'hyp_lab-associated');
    assert.ok(!lab.edges.some((e) => e.claim_ref === LOCAL_1));
    assert.equal(map.orphaned_edges.length, 0);
});

// ------------------------------------------------------------------
// Coverage + determinism
// ------------------------------------------------------------------

test('coverage counts are corpus-wide neutral totals', () => {
    const map = buildHypothesisMap({
        positions: POSITIONS,
        humanEdges: [{ hypothesis_id: 'hyp_lab-associated', claim_ref: LOCAL_1, role: 'supports' }],
        dossierData: { orbit: { claims: [{ id: LOCAL_1 }, { id: LOCAL_2 }] } }
    });
    assert.deepEqual(map.coverage, {
        hypotheses: 2, seeded_from_positions: 3, human_edges: 1, orphaned_edges: 0, orbit_claims: 2
    });
});

test('assembly is deterministic (same input twice → deep equal)', () => {
    const a = buildHypothesisMap({ question: 'q', positions: POSITIONS, humanEdges: [{ hypothesis_id: 'hyp_x', role: 'supports', claim_ref: LOCAL_1 }] });
    const b = buildHypothesisMap({ question: 'q', positions: POSITIONS, humanEdges: [{ hypothesis_id: 'hyp_x', role: 'supports', claim_ref: LOCAL_1 }] });
    assert.deepEqual(a, b);
});

// ------------------------------------------------------------------
// claimEdge factory + id helper
// ------------------------------------------------------------------

test('claimEdge strips any numeric slot a caller sneaks in', () => {
    const edge = claimEdge({ claim_ref: LOCAL_1, role: 'supports', score: 0.9, weight: 5, probability: 0.7 });
    assert.deepEqual(Object.keys(edge).sort(), ['claim_ref', 'provenance', 'role']);
});

test('claimEdge rejects an unknown role', () => {
    assert.equal(claimEdge({ role: 'maybe' }), null);
});

test('EDGE_ROLES is exactly supports/undermines and frozen', () => {
    assert.deepEqual([...EDGE_ROLES], ['supports', 'undermines']);
    assert.ok(Object.isFrozen(EDGE_ROLES));
});

test('hypothesisId slugs deterministically', () => {
    assert.equal(hypothesisId('Lab-associated (leak)'), 'hyp_lab-associated-leak');
    assert.equal(hypothesisId(''), 'hyp_unlabeled');
    assert.equal(hypothesisId('   '), 'hyp_unlabeled');
});

// ------------------------------------------------------------------
// THE FIREWALL — no fused score anywhere (§6 guard; the constitution)
// ------------------------------------------------------------------

const FORBIDDEN_KEY = /^(score|weight|probability|likelihood|confidence|strength|rank|rating|percent|pct)$/i;

function collectKeys(node, out = new Set()) {
    if (Array.isArray(node)) { for (const v of node) collectKeys(v, out); return out; }
    if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) { out.add(k); collectKeys(v, out); }
    }
    return out;
}

test('the produced map carries no score/probability/weight key anywhere', () => {
    const map = buildHypothesisMap({
        question: 'How did it start?',
        positions: POSITIONS,
        humanEdges: [
            { hypothesis_id: 'hyp_zoonotic-spillover', claim_ref: LOCAL_1, role: 'supports', quote: 'q' },
            { hypothesis_id: 'hyp_gone', claim_ref: LOCAL_2, role: 'undermines' }
        ],
        dossierData: { orbit: { claims: [{ id: LOCAL_1 }] } }
    });
    for (const key of collectKeys(map)) {
        assert.ok(!FORBIDDEN_KEY.test(key), `forbidden numeric-scoring key present: ${key}`);
    }
});

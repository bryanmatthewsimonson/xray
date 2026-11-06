// Claim dependency D.2 — the pure walks over `depends-on` links
// (docs/CLAIM_DEPENDENCY_DESIGN.md §2.3, §3.1–§3.3). A link
// { source_ref, target_ref, relationship: 'depends-on' } means SOURCE
// DEPENDS ON TARGET. Every output is a count with a derivation; only
// falsity propagates (there is no upward walk); cycles terminate and
// are reported, never thrown on.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { dependentsOf, premisesOf, claimLoad, findDependencyCycles, sharedPremises } =
    await import('../src/shared/case-dependencies.js');

const A = 'claim_000000000000000a';
const B = 'claim_000000000000000b';
const C = 'claim_000000000000000c';
const D = 'claim_000000000000000d';
const R = 'claim_000000000000000r';
const X = 'claim_000000000000000x';
const Y = 'claim_000000000000000y';
const Q = 'claim_000000000000000q';
const Z = 'claim_000000000000000z';

function link(id, source, target) {
    return { id, source_claim_id: source, target_claim_id: target, source_ref: source, target_ref: target, relationship: 'depends-on' };
}

// B depends on A, C depends on B, D depends on A; X and Y depend on
// each other (a cycle); Q depends on Z (unrelated).
function deps() {
    return [
        link('link_ba', B, A),
        link('link_cb', C, B),
        link('link_da', D, A),
        link('link_xy', X, Y),
        link('link_yx', Y, X),
        link('link_qz', Q, Z)
    ];
}

// A diamond: A and B both depend on R; C depends on A and on B.
function diamond() {
    return [
        link('link_ar', A, R),
        link('link_br', B, R),
        link('link_ca', C, A),
        link('link_cb', C, B)
    ];
}

test('dependentsOf: transitive closure with one chain per dependent, sorted by ref', () => {
    const r = dependentsOf(deps(), A);
    assert.equal(r.count, 3);
    assert.deepEqual(r.derivation.map((d) => d.ref), [B, C, D]);
    const c = r.derivation.find((d) => d.ref === C);
    assert.deepEqual(c.chain, [A, B, C], 'chain runs from the premise to the dependent');
    assert.deepEqual(c.derivation, ['link_ba', 'link_cb'], 'the link ids along the chain');
    assert.deepEqual(r.derivation.find((d) => d.ref === D).chain, [A, D]);
});

test('dependentsOf: a diamond lists the dependent once, with one chain and both meeting link ids on the face', () => {
    const r = dependentsOf(diamond(), R);
    assert.deepEqual(r.derivation.map((d) => d.ref), [A, B, C]);
    const c = r.derivation.find((d) => d.ref === C);
    assert.equal(c.chain.length, 3, 'one chain, not two');
    assert.equal(c.chain[0], R);
    assert.equal(c.chain[2], C);
    assert.deepEqual(c.derivation, ['link_ar', 'link_ca'], 'the links along the one shown chain');
    assert.deepEqual(c.meeting_links, ['link_cb'], 'the other link into C is named even though only one chain is shown');
});

test('dependentsOf: a claim BELOW a diamond carries only its own chain links; meeting links stay on the diamond node', () => {
    // A and X both depend on R; C depends on A and on X; D depends on C.
    const links = [link('link_ar', A, R), link('link_xr', X, R), link('link_ca', C, A), link('link_cx', C, X), link('link_dc', D, C)];
    const r = dependentsOf(links, R);
    const c = r.derivation.find((d) => d.ref === C);
    const d = r.derivation.find((d) => d.ref === D);
    assert.deepEqual(c.derivation, ['link_ar', 'link_ca'], 'the links along the one shown chain');
    assert.deepEqual(c.meeting_links, ['link_cx'], 'the other link into C, named separately');
    assert.deepEqual(d.chain, [R, A, C, D]);
    assert.deepEqual(d.derivation, ['link_ar', 'link_ca', 'link_dc'], 'nothing from the other side of the diamond leaks into D');
    assert.deepEqual(d.meeting_links, []);
});

test('dependentsOf: a cycle terminates and lists each member once', () => {
    const r = dependentsOf(deps(), X);
    assert.equal(r.count, 1);
    assert.deepEqual(r.derivation.map((d) => d.ref), [Y]);
    assert.deepEqual(r.derivation[0].chain, [X, Y]);
});

test('premisesOf: the reverse walk, sorted by ref', () => {
    const r = premisesOf(deps(), C);
    assert.deepEqual(r.derivation.map((d) => d.ref), [A, B]);
    assert.deepEqual(r.derivation.find((d) => d.ref === A).chain, [C, B, A], 'chain runs from the dependent down to the premise');
    assert.equal(premisesOf(deps(), A).count, 0, 'a root has no premises');
});

test('claimLoad: is dependentsOf by another name (the §3.1 surface)', () => {
    assert.deepEqual(claimLoad(deps(), A), dependentsOf(deps(), A));
});

test('findDependencyCycles: strongly connected components of size >= 2 only, refs sorted, link ids on the face', () => {
    const r = findDependencyCycles(deps());
    assert.equal(r.count, 1);
    assert.deepEqual(r.derivation[0].refs, [X, Y].sort());
    assert.deepEqual([...r.derivation[0].derivation].sort(), ['link_xy', 'link_yx']);
    assert.equal(findDependencyCycles(diamond()).count, 0, 'a diamond is not a cycle');
});

test('walks: an unknown ref yields count 0 and never throws; empty input likewise', () => {
    assert.equal(dependentsOf(deps(), 'claim_0000000000000000').count, 0);
    assert.equal(premisesOf([], A).count, 0);
    assert.equal(findDependencyCycles([]).count, 0);
});

test('walks: deterministic — input order is irrelevant, same inputs deepEqual', () => {
    const shuffled = deps().reverse();
    assert.deepEqual(dependentsOf(shuffled, A), dependentsOf(deps(), A));
    assert.deepEqual(findDependencyCycles(shuffled), findDependencyCycles(deps()));
});

test('walks: no banned key anywhere, and every numeric sits beside a derivation', () => {
    const banned = /^(probability|likelihood|confidence|score|weight|strength)$/i;
    const walk = (v, path) => {
        if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
        if (v && typeof v === 'object') {
            for (const [k, x] of Object.entries(v)) {
                assert.ok(!banned.test(k), `${path}.${k} is a banned key`);
                if (typeof x === 'number') assert.ok(Array.isArray(v.derivation), `${path}.${k} is a numeric with no derivation beside it`);
                walk(x, `${path}.${k}`);
            }
        }
    };
    walk(dependentsOf(deps(), A), 'dependents');
    walk(findDependencyCycles(deps()), 'cycles');
});

// ------------------------------------------------------------------
// §3.3 shared premises
// ------------------------------------------------------------------

// D depends on C, C depends on B, B depends on A: two supporting
// edges for H1 (from B and from D) both rest on A, through chains of
// different length. C undermines H1. H2 has a single supporting edge.
function deps2() {
    return [link('link_ba', B, A), link('link_cb', C, B), link('link_dc', D, C)];
}
function edges() {
    return [
        { hypothesis_id: 'H1', label: 'Lab', ref: B, role: 'supports', edge_id: 'e_b' },
        { hypothesis_id: 'H1', label: 'Lab', ref: D, role: 'supports', edge_id: 'e_d' },
        { hypothesis_id: 'H1', label: 'Lab', ref: C, role: 'undermines', edge_id: 'e_c' },
        { hypothesis_id: 'H2', label: 'Market', ref: D, role: 'supports', edge_id: 'e_d2' }
    ];
}

test('sharedPremises: two supporting edges that both rest on a premise report it once, with both edges and their chains', () => {
    const r = sharedPremises(deps2(), edges());
    // A is shared by e_b (B→A) and e_d (D→C→B→A). B is shared too: e_b
    // IS the claim B, and e_d's claim D rests on B — two arguments that
    // are not independent (I-5). Rows sort by premise_ref: A then B.
    assert.equal(r.count, 2);
    const [rowA, rowB] = r.derivation;
    assert.equal(rowA.hypothesis_id, 'H1');
    assert.equal(rowA.label, 'Lab');
    assert.equal(rowA.premise_ref, A);
    assert.deepEqual(rowA.edges.map((e) => e.edge_id).sort(), ['e_b', 'e_d']);
    for (const e of rowA.edges) {
        assert.equal(e.chain[0], e.claim_ref);
        assert.equal(e.chain[e.chain.length - 1], A);
    }
    assert.ok(rowA.derivation.includes('link_ba') && rowA.derivation.includes('link_dc'), 'link ids of every chain');
    assert.equal(rowB.premise_ref, B);
    assert.deepEqual(rowB.edges.map((e) => e.edge_id).sort(), ['e_b', 'e_d']);
    assert.deepEqual(rowB.edges.find((e) => e.edge_id === 'e_b').chain, [B], 'the supporting claim itself');
    assert.deepEqual(rowB.edges.find((e) => e.edge_id === 'e_d').chain, [D, C, B]);
});

test('sharedPremises: undermines edges and single-edge hypotheses contribute nothing', () => {
    const r = sharedPremises(deps2(), edges());
    assert.ok(!r.derivation.some((row) => row.hypothesis_id === 'H2'));
    assert.ok(!r.derivation.some((row) => row.edges.some((e) => e.edge_id === 'e_c')));
});

test('sharedPremises: one claim attached twice is ONE argument — its premises are not shared (finding: alias edges)', () => {
    const twice = [
        { hypothesis_id: 'H1', label: 'Lab', ref: B, role: 'supports', edge_id: 'e_b' },
        { hypothesis_id: 'H1', label: 'Lab', ref: B, role: 'supports', edge_id: 'e_b2' }
    ];
    assert.equal(sharedPremises(deps2(), twice).count, 0, 'distinct supporting CLAIMS, not distinct edge ids');
    assert.equal(sharedPremises(deps2(), []).count, 0);
    assert.equal(sharedPremises([], edges()).count, 0);
});

test('sharedPremises: a supporting claim that another supporting claim rests on IS a shared premise (I-5)', () => {
    // A supports H directly; B supports H and B depends on A: the two
    // arguments are not independent, and A is the premise they share.
    const es = [
        { hypothesis_id: 'H1', label: 'Lab', ref: A, role: 'supports', edge_id: 'e_a' },
        { hypothesis_id: 'H1', label: 'Lab', ref: B, role: 'supports', edge_id: 'e_b' }
    ];
    const r = sharedPremises([link('link_ba', B, A)], es);
    assert.equal(r.count, 1);
    assert.equal(r.derivation[0].premise_ref, A);
    assert.deepEqual(r.derivation[0].edges.map((e) => e.edge_id).sort(), ['e_a', 'e_b']);
    assert.deepEqual(r.derivation[0].edges.find((e) => e.edge_id === 'e_a').chain, [A], 'the claim itself, zero links');
    assert.deepEqual(r.derivation[0].derivation, ['link_ba']);
});

test('sharedPremises: output passes the banned-key / numeric-beside-derivation walk', () => {
    const banned = /^(probability|likelihood|confidence|score|weight|strength)$/i;
    const walk = (v, path) => {
        if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
        if (v && typeof v === 'object') {
            for (const [k, x] of Object.entries(v)) {
                assert.ok(!banned.test(k), `${path}.${k} is a banned key`);
                if (typeof x === 'number') assert.ok(Array.isArray(v.derivation), `${path}.${k} is a numeric with no derivation beside it`);
                walk(x, `${path}.${k}`);
            }
        }
    };
    walk(sharedPremises(deps2(), edges()), 'shared');
});

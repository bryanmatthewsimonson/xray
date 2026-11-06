// Claim dependency D.2 — the pure walks over `depends-on` links
// (docs/CLAIM_DEPENDENCY_DESIGN.md §2.3, §3.1–§3.3). A link
// { source_ref, target_ref, relationship: 'depends-on' } means SOURCE
// DEPENDS ON TARGET. Every output is a count with a derivation; only
// falsity propagates (there is no upward walk); cycles terminate and
// are reported, never thrown on.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { dependentsOf, premisesOf, claimLoad, findDependencyCycles, sharedPremises, loadLabel, loadTooltip, premiseVerdictMarkers, premiseMarkerLabel, premiseMarkerTooltip, inconsistencyLabel, ownVerdictLabel, PREMISE_INCONSISTENCY_TITLE, MAX_PREMISE_MARKERS } =
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

// ------------------------------------------------------------------
// D.3 — the load chip (docs/CLAIM_DEPENDENCY_DESIGN.md §3.1, §5)
// ------------------------------------------------------------------

test('loadLabel / loadTooltip: a measured count with every dependent named by text and chain; empty when nothing depends', () => {
    const claimsById = { [B]: { text: 'B says.' }, [C]: { text: 'C says.' } };
    const load = claimLoad(deps(), A);
    assert.equal(loadLabel(load), 'Load-bearing (3 dependents)');
    assert.equal(loadLabel(claimLoad(deps(), Q)), '');
    const tip = loadTooltip(load, claimsById);
    assert.match(tip, /^Claims that cannot be true unless this one is:\n/);
    assert.match(tip, new RegExp(`“C says\\.” \\(via ${A} → ${B} → ${C}\\)`));
    assert.match(tip, new RegExp(`${D} \\(via ${A} → ${D}\\)`), 'an unresolved ref shows its id');
    assert.equal(loadLabel({ count: 1, derivation: [] }), 'Load-bearing (1 dependent)');
});

// ------------------------------------------------------------------
// D.4 — the live per-adjudicator badge (§3.4, R-026)
// ------------------------------------------------------------------

const PK1 = '1'.repeat(64), PK2 = '2'.repeat(64), PK3 = '3'.repeat(64);
// Parser-shaped wire rows: `id` is the d tag (the SAME for every
// author's verdict on one proposition); `eventId` is unique.
function wireRow(eventId, pubkey, verdict, standard, over = {}) {
    return { id: 'verdict:abcdef0123456789', proposition_id: 'p_a', verdict, standardOfProof: standard, pubkey, eventId: eventId.repeat(64), created_at: 100, ...over };
}

// A (premise) ← B ← C. p_a on A: v0 established-true SUPERSEDED by v1
// established-false (Dr Ferran, beyond reasonable doubt); two wire
// established-true verdicts on p_a from other authors. p_c on C: head
// established-true, no adjudicator (this X-Ray's own record).
function verdictData(over = {}) {
    return {
        claimsById: { [A]: { text: 'A says.' }, [B]: { text: 'B says.' }, [C]: { text: 'C says.' } },
        links: { dependencies: [link('link_ba', B, A), link('link_cb', C, B)] },
        propositions: { all: {
            p_a: { id: 'p_a', claim_id: A, proposition_class: 'event-fact' },
            p_c: { id: 'p_c', claim_id: C, proposition_class: 'event-fact' }
        } },
        verdicts: { byProposition: {
            p_a: [
                { id: 'v0', proposition_id: 'p_a', verdict: 'established-true', standard_of_proof: 'preponderance', adjudicator: null, superseded_by: 'v1' },
                { id: 'v1', proposition_id: 'p_a', verdict: 'established-false', standard_of_proof: 'beyond-reasonable-doubt', adjudicator: { label: 'Dr Ferran', pubkey: null }, superseded_by: null, supersedes: 'v0' }
            ],
            p_c: [{ id: 'v2', proposition_id: 'p_c', verdict: 'established-true', standard_of_proof: 'preponderance', adjudicator: null, superseded_by: null }]
        } },
        wire: { verdicts: [wireRow('e', PK1, 'established-true', 'preponderance'), wireRow('f', PK2, 'established-true', 'clear-and-convincing')] },
        ...over
    };
}

test('premiseVerdictMarkers: one marker per established-false verdict on a transitive premise, with the whole distribution beside it', () => {
    const r = premiseVerdictMarkers(verdictData(), C);
    assert.equal(r.count, 1);
    const row = r.derivation[0];
    assert.equal(row.premise_ref, A);
    assert.deepEqual(row.chain, [C, B, A]);
    assert.deepEqual(row.derivation, ['link_cb', 'link_ba']);
    assert.equal(row.author, 'Dr Ferran');
    assert.equal(row.standard, 'beyond-reasonable-doubt');
    assert.equal(row.source, 'local');
    assert.equal(row.verdict_id, 'v1');
    assert.deepEqual(row.distribution.by_state, { 'established-false': 1, 'established-true': 2 });
    assert.ok(!('unanimous' in row.distribution), 'no consensus-shaped flag rides on a row');
    assert.deepEqual(row.distribution.authors_by_state['established-true'].map((a) => a.author), ['111111111111…', '222222222222…']);
    assert.deepEqual(row.distribution.authors_by_state['established-true'].map((a) => a.id), ['e'.repeat(64), 'f'.repeat(64)], 'wire rows are keyed by event id, never the shared d tag');
});

test('premiseVerdictMarkers: the dependent\'s own verdicts are listed (local heads AND wire), and an own established-true head makes an inconsistency row that names both sides', () => {
    const r = premiseVerdictMarkers(verdictData(), C);
    assert.equal(r.own.length, 1);
    assert.equal(r.own[0].verdict, 'established-true');
    assert.equal(r.own[0].author, 'this X-Ray\'s record (no adjudicator named)');
    assert.equal(r.inconsistencies.length, 1);
    assert.equal(r.inconsistencies[0].same_author, false);
    assert.equal(r.inconsistency, true);
    assert.equal(inconsistencyLabel(r.inconsistencies[0]),
        'claim adjudicated true by this X-Ray\'s record (no adjudicator named) under Preponderance of the evidence; premise adjudicated false by Dr Ferran under Beyond reasonable doubt — two adjudicators disagree; neither corrects the other');
    assert.equal(ownVerdictLabel(r.own[0]), 'verdict: Established true — by this X-Ray\'s record (no adjudicator named) under Preponderance of the evidence');
});

test('premiseVerdictMarkers: the same adjudicator on both sides is an inconsistency, not a correction', () => {
    const d = verdictData();
    d.verdicts.byProposition.p_c[0].adjudicator = { label: 'Dr Ferran', pubkey: null };
    const r = premiseVerdictMarkers(d, C);
    assert.equal(r.inconsistencies[0].same_author, true);
    assert.match(inconsistencyLabel(r.inconsistencies[0]), /— an inconsistency, not a correction$/);
});

test('premiseVerdictMarkers: every proposition of the dependent is read, not the first by id', () => {
    const d = verdictData();
    // a second proposition on C whose id sorts FIRST and whose head is established-false
    d.propositions.all.a_first = { id: 'a_first', claim_id: C, proposition_class: 'state-fact' };
    d.verdicts.byProposition.a_first = [{ id: 'v5', proposition_id: 'a_first', verdict: 'established-false', standard_of_proof: 'preponderance', adjudicator: null, superseded_by: null }];
    const r = premiseVerdictMarkers(d, C);
    assert.equal(r.own.length, 2);
    assert.equal(r.inconsistencies.length, 1, 'the established-true head on p_c still makes the row');
    assert.equal(r.inconsistencies[0].own.proposition_id, 'p_c');
});

test('premiseVerdictMarkers: supersession — a false superseded by true vanishes; every un-superseded local head is listed (merge can leave two)', () => {
    const d = verdictData({ wire: { verdicts: [] } });
    d.verdicts.byProposition.p_a = [
        { id: 'v1', proposition_id: 'p_a', verdict: 'established-false', standard_of_proof: 'preponderance', adjudicator: null, superseded_by: 'v6' },
        { id: 'v6', proposition_id: 'p_a', verdict: 'established-true', standard_of_proof: 'preponderance', adjudicator: null, superseded_by: null, supersedes: 'v1' }
    ];
    assert.equal(premiseVerdictMarkers(d, C).count, 0, 'the false verdict was superseded by true');
    d.verdicts.byProposition.p_a.push({ id: 'v7', proposition_id: 'p_a', verdict: 'established-false', standard_of_proof: 'clear-and-convincing', adjudicator: { label: 'Colleague' }, superseded_by: null });
    const r = premiseVerdictMarkers(d, C);
    assert.equal(r.count, 1, 'a second un-superseded head (a merged-in chain) is its own marker');
    assert.deepEqual(r.derivation[0].distribution.by_state, { 'established-false': 1, 'established-true': 1 }, 'both heads are in the distribution');
});

test('premiseVerdictMarkers: stale wire rows are dropped — an older version of one author\'s verdict, and a row another row supersedes', () => {
    const d = verdictData({ verdicts: { byProposition: {} } });
    d.wire.verdicts = [
        wireRow('a', PK3, 'established-false', 'preponderance', { created_at: 10 }),
        wireRow('b', PK3, 'established-true', 'preponderance', { created_at: 20 }),            // same author, same d, newer
        wireRow('c', PK1, 'established-false', 'preponderance', { created_at: 30 }),
        wireRow('d', PK1, 'established-true', 'preponderance', { created_at: 40, supersedesEventId: 'c'.repeat(64) })
    ];
    const r = premiseVerdictMarkers(d, C);
    assert.equal(r.count, 0, 'no live established-false verdict remains');
    assert.deepEqual(r.derivation, []);
});

test('premiseVerdictMarkers: a wire established-false verdict is its own marker, local markers sort before wire, and no premises / no verdicts / null data give nothing', () => {
    const d = verdictData();
    d.wire.verdicts.push(wireRow('a', PK3, 'established-false', 'preponderance'));
    const r = premiseVerdictMarkers(d, C);
    assert.equal(r.count, 2);
    assert.deepEqual(r.derivation.map((x) => x.source), ['local', 'wire']);
    assert.equal(r.derivation[1].author, '333333333333…');
    assert.equal(r.derivation[1].verdict_id, 'a'.repeat(64));
    assert.equal(premiseVerdictMarkers(verdictData(), A).count, 0, 'A has no premises');
    const noVerdicts = verdictData({ verdicts: { byProposition: {} }, wire: { verdicts: [] } });
    assert.equal(premiseVerdictMarkers(noVerdicts, C).count, 0, 'propositions without verdicts');
    assert.equal(premiseVerdictMarkers(null, C).count, 0);
    const bare = premiseVerdictMarkers({ links: { dependencies: [link('link_ba', B, A)] } }, B);
    assert.deepEqual([bare.count, bare.own, bare.inconsistency], [0, [], false]);
});

test('premiseMarkerLabel / premiseMarkerTooltip: who and by what standard, every state listed, the fixed closing line', () => {
    const row = premiseVerdictMarkers(verdictData(), C).derivation[0];
    assert.equal(premiseMarkerLabel(row), 'premise adjudicated false by Dr Ferran under Beyond reasonable doubt');
    const tip = premiseMarkerTooltip(row, { [A]: { text: 'A says.' } });
    assert.match(tip, new RegExp(`^Premise: “A says\\.” \\(via ${C} → ${B} → ${A}\\)\\n`));
    assert.match(tip, /Established false ×1 — Dr Ferran \(Beyond reasonable doubt\)/);
    assert.match(tip, /Established true ×2 — 111111111111… \(Preponderance of the evidence\), 222222222222… \(Clear and convincing\)/);
    assert.ok(tip.endsWith('One adjudicator\'s verdict, shown beside the others. No verdict on this claim is recomputed.'));
});

test('premise markers: no consensus / majority / tally / likelihood / "is false" phrasing in any string, across every verdict state', () => {
    const d = verdictData();
    d.wire.verdicts.push(
        wireRow('a', PK3, 'contested', 'preponderance'),
        wireRow('b', '4'.repeat(64), 'unresolved', 'preponderance'),
        wireRow('c', '5'.repeat(64), 'insufficient-evidence', 'preponderance')
    );
    const r = premiseVerdictMarkers(d, C);
    const banned = /consensus|majority|most adjudicators|\bagree|outvoted|\bwins?\b|likel|probab|confidence|score|unanimous|tally|overall|settled|%|premise is false|claim is true/i;
    const strings = [
        ...r.derivation.map(premiseMarkerLabel),
        ...r.derivation.map((row) => premiseMarkerTooltip(row, d.claimsById)),
        ...r.inconsistencies.map(inconsistencyLabel),
        ...r.own.map(ownVerdictLabel),
        PREMISE_INCONSISTENCY_TITLE
    ];
    assert.ok(strings.length >= 5);
    for (const s of strings) assert.doesNotMatch(s, banned, s);
    assert.ok(Number.isInteger(MAX_PREMISE_MARKERS) && MAX_PREMISE_MARKERS >= 2);
});

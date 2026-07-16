// Structural counterfactual tests — Phase 26 CF.1
// (docs/COUNTERFACTUAL_DESIGN.md §2–§4). Pure diffs over hand-built
// `collectCaseDossierData`-shaped data (the case-graph fixture
// pattern). Load-bearing invariants: knot dissolution/split/shrink
// with removed-edge derivations, only-support loss, attestation
// origin-count deltas (incl. the honest baseline shift), entity and
// timeline losses (remove only — negate reports TRUE zeros),
// hypothesis-edge deltas (removed vs role-flipped), determinism, and
// the §4 guard — banned keys nowhere, and EVERY numeric sits beside a
// derivation.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { traceClaimDependencies, COUNTERFACTUAL_MODES } =
    await import('../src/shared/case-counterfactual.js');

const CASE_ID = 'entity_00000000000000aa';
const C1 = 'claim_00000000000000c1';
const C2 = 'claim_00000000000000c2';
const C3 = 'claim_00000000000000c3';
const C4 = 'claim_00000000000000c4';
const C5 = 'claim_00000000000000c5';
const C6 = 'claim_00000000000000c6';

function makeClaim(id, over = {}) {
    return {
        id, text: `Claim ${id}`, about: [CASE_ID], source: null, is_key: false,
        source_url: `https://example.com/${id}`, created: 100, ...over
    };
}

function link(id, source, target, relationship, over = {}) {
    return {
        id, source_claim_id: source, target_claim_id: target,
        source_ref: source, target_ref: target,
        relationship, note: '', suggested_by: 'user', created: 50, ...over
    };
}

function att(id, source, target, originKey, created, note = '') {
    return link(id, source, target, 'supports', {
        created,
        attestation: { tier: 'tier-1', origin_key: originKey, independence_note: note }
    });
}

// One rich case:
//  - knot: c1—c2, c2—c3 (removing c2 splits it apart entirely);
//  - support: c1 supports c3 (its ONLY support) and c5 (also held by
//    c6); c4 is attested by both c1 and c6, so it never loses support;
//  - attestations: proposition on c4, attested by c1 (earliest origin,
//    the baseline) and by c6 (independent, note) — removing c1 drops
//    origins 2→1 and promotes c6's origin to baseline;
//  - entities: eOnly appears only on c2; eBoth on c1 and c2;
//  - timeline: every claim carries a capture event; c4's proposition a
//    world event; a verdict chain a judgment event.
function makeData(over = {}) {
    const claims = [
        makeClaim(C1, { created: 100, about: [CASE_ID, 'entity_00000000000000bb'] }),
        makeClaim(C2, { created: 110, about: [CASE_ID, 'entity_00000000000000bb', 'entity_00000000000000cc'] }),
        makeClaim(C3, { created: 120 }),
        makeClaim(C4, { created: 130 }),
        makeClaim(C5, { created: 140 }),
        makeClaim(C6, { created: 150 })
    ];
    return {
        case: { id: CASE_ID, name: 'Origins', type: 'case', pubkey: null },
        membership_ids: [CASE_ID],
        entitiesById: {
            [CASE_ID]: { id: CASE_ID, name: 'Origins', type: 'case' },
            entity_00000000000000bb: { id: 'entity_00000000000000bb', name: 'Both', type: 'person' },
            entity_00000000000000cc: { id: 'entity_00000000000000cc', name: 'Only', type: 'person' }
        },
        articles: [],
        orbit: {
            entity_ids: [CASE_ID, 'entity_00000000000000bb', 'entity_00000000000000cc'],
            entities: [
                { id: 'entity_00000000000000bb', name: 'Both', type: 'person' },
                { id: 'entity_00000000000000cc', name: 'Only', type: 'person' }
            ],
            dangling_entity_ids: [], claims
        },
        claimsById: Object.fromEntries(claims.map((c) => [c.id, c])),
        propositions: {
            all: { prop_4: { id: 'prop_4', claim_id: C4, proposition_class: 'event-fact', occurred_at: 1600000000, occurred_precision: 'day' } },
            orbit: [{ id: 'prop_4', claim_id: C4, proposition_class: 'event-fact', occurred_at: 1600000000, occurred_precision: 'day' }]
        },
        verdicts: { byProposition: { prop_4: [
            { id: 'v1', proposition_id: 'prop_4', verdict: 'contested', superseded_by: null, created: 200 }
        ] } },
        integrity: [], integrityAll: [], forensic: [],
        predictions: [], resolutions: [],
        links: {
            contradicts: [
                link('link_00000000000000k1', C1, C2, 'contradicts'),
                link('link_00000000000000k2', C2, C3, 'contradicts')
            ],
            attestations: [
                att('link_00000000000000a1', C1, C4, 'origin-alpha', 10),
                att('link_00000000000000a2', C6, C4, 'origin-beta', 20, 'separate chain of custody')
            ],
            related: [
                link('link_00000000000000s1', C1, C3, 'supports'),
                link('link_00000000000000s2', C1, C5, 'supports'),
                link('link_00000000000000s3', C6, C5, 'supports'),
                att('link_00000000000000a1', C1, C4, 'origin-alpha', 10),
                att('link_00000000000000a2', C6, C4, 'origin-beta', 20, 'separate chain of custody')
            ]
        },
        wire: { verdicts: [], findings: [], articles: [] },
        ...over
    };
}

// ------------------------------------------------------------------

test('case-counterfactual: modes pinned; bad mode and empty ref throw', () => {
    assert.deepEqual([...COUNTERFACTUAL_MODES], ['remove', 'negate']);
    assert.throws(() => traceClaimDependencies(makeData(), C1, { mode: 'simulate' }), /Invalid counterfactual mode/);
    assert.throws(() => traceClaimDependencies(makeData(), ''), /claimRef is required/);
});

test('case-counterfactual: removing the knot bridge splits it — fragments and removed edges on the face', () => {
    const delta = traceClaimDependencies(makeData(), C2, { mode: 'remove' });
    assert.equal(delta.knots.count, 1);
    const k = delta.knots.derivation[0];
    assert.equal(k.size_before, 3);
    assert.equal(k.change, 'dissolved', 'both edges touched c2 — nothing ≥2 survives');
    assert.deepEqual(k.derivation.sort(), ['link_00000000000000k1', 'link_00000000000000k2']);
    assert.equal(k.edge_treatment, 'removed');
});

test('case-counterfactual: removing an end node shrinks the knot, keeping the surviving fragment', () => {
    const delta = traceClaimDependencies(makeData(), C1, { mode: 'remove' });
    const k = delta.knots.derivation[0];
    assert.equal(k.change, 'shrunk');
    assert.equal(k.fragments_after.length, 1);
    assert.deepEqual(k.fragments_after[0].refs.sort(), [C2, C3]);
    assert.deepEqual(k.derivation, ['link_00000000000000k1']);
});

test('case-counterfactual: only-support loss — c3 loses its sole support; c5 and attested c4 keep theirs', () => {
    const delta = traceClaimDependencies(makeData(), C1, { mode: 'remove' });
    // c1's removed related links: s1, s2 + attestation a1 (supports).
    assert.equal(delta.support.links_removed.count, 3);
    const losers = delta.support.claims_losing_only_support;
    assert.equal(losers.count, 1);
    assert.equal(losers.derivation[0].ref, C3);
    assert.deepEqual(losers.derivation[0].derivation, ['link_00000000000000s1']);
});

test('case-counterfactual: attestation delta — origins 2→1 and the baseline honestly shifts', () => {
    const delta = traceClaimDependencies(makeData(), C1, { mode: 'remove' });
    assert.equal(delta.propositions.attestation_deltas.length, 1);
    const d = delta.propositions.attestation_deltas[0];
    assert.equal(d.proposition_id, 'prop_4');
    assert.equal(d.origin_count_before, 2);
    assert.equal(d.origin_count_after, 1);
    assert.deepEqual(d.derivation.removed_link_ids, ['link_00000000000000a1']);
    assert.deepEqual(d.derivation.surviving_origin_groups, [
        { origin_key: 'origin-beta', link_ids: ['link_00000000000000a2'] }
    ]);
});

test('case-counterfactual: the claim\'s own propositions fall with their chain lengths as derivation', () => {
    const delta = traceClaimDependencies(makeData(), C4, { mode: 'remove' });
    assert.equal(delta.propositions.own.count, 1);
    assert.deepEqual(delta.propositions.own.derivation, [
        { proposition_id: 'prop_4', proposition_class: 'event-fact', verdict_chain_length: 1 }
    ]);
    assert.equal(delta.propositions.attestation_deltas.length, 0,
        'its own proposition is not double-reported as an attestation delta');
});

test('case-counterfactual: entity losing its only claim is named; shared entities are not', () => {
    const delta = traceClaimDependencies(makeData(), C2, { mode: 'remove' });
    const gone = delta.entities.losing_only_claim;
    assert.equal(gone.count, 1);
    assert.equal(gone.derivation[0].entity_id, 'entity_00000000000000cc');
    assert.equal(gone.derivation[0].name, 'Only');
});

test('case-counterfactual: timeline loses the claim\'s capture event; axes empty only when it was alone', () => {
    const delta = traceClaimDependencies(makeData(), C2, { mode: 'remove' });
    assert.equal(delta.timeline.events_removed.count, 1);
    assert.deepEqual(delta.timeline.events_removed.derivation, [
        { axis: 'capture', kind: 'claim-captured', at: 110, precision: 'exact' }
    ]);
    assert.equal(delta.timeline.axes_emptied.count, 0, 'other claims still populate the capture axis');
    // c4 carries the only world event (its proposition falls with it).
    const worldGone = traceClaimDependencies(makeData(), C4, { mode: 'remove' });
    assert.deepEqual(worldGone.timeline.axes_emptied.derivation, ['judgment', 'world'],
        'the proposition took its verdict (judgment) and world band with it');
});

test('case-counterfactual: hypothesis edges — removed on remove, role-flipped on negate', () => {
    const hypothesisEdges = [
        { hypothesis_id: 'hyp_1', label: 'Zoonotic', ref: C1, role: 'supports', edge_id: 'hedge_1' },
        { hypothesis_id: 'hyp_2', label: 'Lab', ref: C1, role: 'undermines', edge_id: 'hedge_2' },
        { hypothesis_id: 'hyp_2', label: 'Lab', ref: C2, role: 'supports', edge_id: 'hedge_3' }
    ];
    const removed = traceClaimDependencies(makeData(), C1, { mode: 'remove', hypothesisEdges });
    assert.equal(removed.hypotheses.count, 2);
    const [h1, h2] = removed.hypotheses.derivation;
    assert.equal(h1.supports_affected, 1);
    assert.equal(h1.edge_treatment, 'removed');
    assert.deepEqual(h2.derivation, ['hedge_2']);
    const negated = traceClaimDependencies(makeData(), C1, { mode: 'negate', hypothesisEdges });
    assert.equal(negated.hypotheses.derivation[0].edge_treatment, 'role-flipped');
});

test('case-counterfactual: negate keeps the claim — entities and timeline report TRUE zeros, edges flip', () => {
    const delta = traceClaimDependencies(makeData(), C2, { mode: 'negate' });
    assert.equal(delta.entities.losing_only_claim.count, 0);
    assert.equal(delta.timeline.events_removed.count, 0);
    assert.equal(delta.knots.derivation[0].edge_treatment, 'flipped-to-concordance');
    assert.equal(delta.support.links_removed.count, 0, 'c2 sources no supports link');
    assert.equal(delta.propositions.own.count, 0);
});

test('case-counterfactual: a claim outside the graph yields zero-count sections, not errors', () => {
    const delta = traceClaimDependencies(makeData(), 'claim_00000000000000ff', { mode: 'remove' });
    assert.equal(delta.claim.in_orbit, false);
    assert.equal(delta.claim.text, null);
    assert.equal(delta.knots.count, 0);
    assert.equal(delta.support.links_removed.count, 0);
    assert.equal(delta.entities.losing_only_claim.count, 0);
});

test('case-counterfactual: deterministic — same inputs deepEqual', () => {
    const a = traceClaimDependencies(makeData(), C1, { mode: 'remove' });
    const b = traceClaimDependencies(makeData(), C1, { mode: 'remove' });
    assert.deepEqual(a, b);
});

test('case-counterfactual: §4 guard — banned keys nowhere, and EVERY numeric sits beside a derivation', () => {
    const hypothesisEdges = [
        { hypothesis_id: 'hyp_1', label: 'Zoonotic', ref: C1, role: 'supports', edge_id: 'hedge_1' }
    ];
    for (const mode of COUNTERFACTUAL_MODES) {
        const delta = traceClaimDependencies(makeData(), C1, { mode, hypothesisEdges });
        const banned = /probabilit|likelihood|confidence|score|weight|strength|rating|grade|mean/i;
        const walk = (node, path, insideDerivation) => {
            if (Array.isArray(node)) {
                node.forEach((v, i) => walk(v, `${path}[${i}]`, insideDerivation));
                return;
            }
            if (node && typeof node === 'object') {
                for (const [k, v] of Object.entries(node)) {
                    assert.doesNotMatch(k, banned, `forbidden key at ${path}.${k}`);
                    if (typeof v === 'number' && !insideDerivation) {
                        assert.ok('derivation' in node,
                            `numeric ${path}.${k} = ${v} has no derivation beside it`);
                    }
                    walk(v, `${path}.${k}`, insideDerivation || k === 'derivation');
                }
            }
        };
        walk(delta, '$', false);
    }
});

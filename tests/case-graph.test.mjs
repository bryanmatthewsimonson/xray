// Local case entity graph tests — Phase 20.3. Pure: buildCaseGraph /
// layoutCaseGraph over hand-built `collectCaseDossierData`-shaped data,
// no chrome, no IDB. Mirrors the case-dossier data contract.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// case-graph → case-dossier → models probe chrome.storage at load.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { buildCaseGraph, layoutCaseGraph } = await import('../src/shared/case-graph.js');

// Minimal data shape buildCaseGraph reads: case, membership_ids,
// entitiesById, articles (archive recs), orbit.claims, claimsById,
// links.contradicts, propositions/integrity (empty for knots).
function makeData(over = {}) {
    return {
        case: { id: 'case1', name: 'Origins', type: 'case' },
        membership_ids: ['case1'],
        entitiesById: {
            case1: { id: 'case1', name: 'Origins', type: 'case' },
            eP:    { id: 'eP', name: 'Dr P', type: 'person' },
            eO:    { id: 'eO', name: 'Institute', type: 'organization' }
        },
        articles: [
            { url: 'https://x/a', articleHash: 'a'.repeat(64), cachedAt: 10,
              article: { title: 'A', entities: [{ entity_id: 'case1', context: '' }, { entity_id: 'eP', context: '' }] } },
            { url: 'https://x/b', articleHash: 'b'.repeat(64), cachedAt: 20,
              article: { title: 'B', entities: [{ entity_id: 'case1', context: '' }, { entity_id: 'eP', context: '' }, { entity_id: 'eO', context: '' }] } }
        ],
        orbit: { claims: [], entities: [], dangling_entity_ids: [] },
        claimsById: {},
        links: { contradicts: [], attestations: [] },
        propositions: { all: {}, orbit: [] },
        verdicts: { byProposition: {} },
        integrity: [], integrityAll: [], forensic: [],
        wire: { verdicts: [], findings: [], articles: [] },
        ...over
    };
}

test('case-graph: tag-only articles become nodes; case links to each; entities from tags', () => {
    const g = buildCaseGraph(makeData());
    const ids = g.nodes.map((n) => n.id).sort();
    assert.ok(ids.includes('article:https://x/a'));
    assert.ok(ids.includes('article:https://x/b'));
    assert.ok(ids.includes('entity:eP'));
    assert.ok(ids.includes('entity:eO'));
    // case → article membership edges.
    const memberEdges = g.edges.filter((e) => e.kind === 'member');
    assert.equal(memberEdges.length, 2);
    // tag edges article↔entity.
    const tagEdges = g.edges.filter((e) => e.kind === 'tag');
    assert.ok(tagEdges.some((e) => e.from === 'article:https://x/a' && e.to === 'entity:eP'));
    assert.equal(g.counts.articles, 2);
    assert.equal(g.counts.entities, 2);
});

test('case-graph: co-tag weight = shared member articles', () => {
    const g = buildCaseGraph(makeData());
    // eP and eO co-occur only on article B → weight 1.
    const cotag = g.edges.filter((e) => e.kind === 'cotag');
    assert.equal(cotag.length, 1);
    assert.equal(cotag[0].weight, 1);
    assert.deepEqual([cotag[0].from, cotag[0].to].sort(), ['entity:eO', 'entity:eP']);
});

test('case-graph: about edge + weight from orbit claims', () => {
    const data = makeData({
        orbit: { claims: [
            { id: 'c1', source_url: 'https://x/a', about: ['case1', 'eO'], source: null }
        ], entities: [], dangling_entity_ids: [] }
    });
    const g = buildCaseGraph(data);
    // Article A now also has an "about" edge to eO (claim), plus its tag to eP.
    const aeEO = g.edges.find((e) => e.from === 'article:https://x/a' && e.to === 'entity:eO');
    assert.ok(aeEO, 'about edge to eO present');
    assert.equal(aeEO.kind, 'about');
});

test('case-graph: contradiction knot → article↔article warn edge, ghost for off-corpus endpoint', () => {
    const data = makeData({
        orbit: { claims: [
            { id: 'c1', source_url: 'https://x/a', about: ['case1'], source: null },
            { id: 'c2', source_url: 'https://x/b', about: ['case1'], source: null }
        ], entities: [], dangling_entity_ids: [] },
        claimsById: {
            c1: { id: 'c1', source_url: 'https://x/a', text: 'A says' },
            c2: { id: 'c2', source_url: 'https://x/b', text: 'B says' }
        },
        links: { contradicts: [
            { id: 'l1', relationship: 'contradicts', source_claim_id: 'c1', target_claim_id: 'c2',
              source_ref: 'c1', target_ref: 'c2', note: 'clash' }
        ], attestations: [] }
    });
    const g = buildCaseGraph(data);
    const contra = g.edges.filter((e) => e.kind === 'contradiction');
    assert.equal(contra.length, 1);
    assert.equal(contra[0].warn, true);
    assert.deepEqual([contra[0].from, contra[0].to].sort(), ['article:https://x/a', 'article:https://x/b']);
    assert.equal(g.counts.contradictions, 1);
});

test('case-graph: entity cap + overflow node', () => {
    const entitiesById = { case1: { id: 'case1', name: 'C', type: 'case' } };
    const entities = [];
    for (let i = 0; i < 5; i++) { const id = `e${i}`; entitiesById[id] = { id, name: `E${i}`, type: 'person' }; entities.push({ entity_id: id, context: '' }); }
    const data = makeData({
        entitiesById,
        articles: [{ url: 'https://x/a', articleHash: 'a'.repeat(64), cachedAt: 10,
                     article: { title: 'A', entities: [{ entity_id: 'case1', context: '' }, ...entities] } }]
    });
    const g = buildCaseGraph(data, { maxEntities: 3 });
    assert.equal(g.counts.entities, 3);
    assert.equal(g.counts.entities_dropped, 2);
    assert.ok(g.nodes.some((n) => n.type === 'more' && n.count === 2));
});

test('case-graph: deterministic — same data deep-equal graph + layout', () => {
    const g1 = buildCaseGraph(makeData());
    const g2 = buildCaseGraph(makeData());
    assert.deepEqual(g1, g2);
    const l1 = layoutCaseGraph(g1, { size: 600 });
    const l2 = layoutCaseGraph(g2, { size: 600 });
    assert.deepEqual(l1, l2);
    assert.deepEqual(l1.case, { x: 300, y: 300 }, 'case at center');
});

test('case-graph: includeClaims adds claim nodes + edges', () => {
    const data = makeData({
        orbit: { claims: [{ id: 'c1', source_url: 'https://x/a', about: ['case1'], source: null, text: 'a claim' }], entities: [], dangling_entity_ids: [] }
    });
    const g = buildCaseGraph(data, { includeClaims: true });
    assert.ok(g.nodes.some((n) => n.type === 'claim' && n.claimId === 'c1'));
    assert.ok(g.edges.some((e) => e.kind === 'claim' && e.to === 'claim:c1'));
});

// Claim dependency D.3 (docs/CLAIM_DEPENDENCY_DESIGN.md §5): directed
// dependency arrows, from the dependent's article to the premise's.
function dataWithDependencies() {
    return makeData({
        orbit: { claims: [
            { id: 'c1', source_url: 'https://x/a', about: ['case1'], source: null },
            { id: 'c1b', source_url: 'https://x/a', about: ['case1'], source: null },
            { id: 'c2', source_url: 'https://x/b', about: ['case1'], source: null }
        ], entities: [], dangling_entity_ids: [] },
        claimsById: {
            c1:  { id: 'c1', source_url: 'https://x/a', text: 'A says' },
            c1b: { id: 'c1b', source_url: 'https://x/a', text: 'A also says' },
            c2:  { id: 'c2', source_url: 'https://x/b', text: 'B says' }
        },
        links: { contradicts: [], attestations: [], related: [], dependencies: [
            // c2 (article b) depends on c1 (article a)
            { id: 'd1', relationship: 'depends-on', source_claim_id: 'c2', target_claim_id: 'c1', source_ref: 'c2', target_ref: 'c1', note: 'rests on the lab log' },
            // c1 depends on an off-corpus premise
            { id: 'd2', relationship: 'depends-on', source_claim_id: 'c1', target_claim_id: 'claim_off', source_ref: 'c1', target_ref: 'claim_off', note: '' },
            // two claims of the SAME article: no self-edge
            { id: 'd3', relationship: 'depends-on', source_claim_id: 'c1b', target_claim_id: 'c1', source_ref: 'c1b', target_ref: 'c1', note: '' }
        ] }
    });
}

test('case-graph: depends-on links become directed article→article dependency edges; ghost for an off-corpus premise; same-article pairs skipped', () => {
    const g = buildCaseGraph(dataWithDependencies());
    const deps = g.edges.filter((e) => e.kind === 'dependency');
    assert.equal(deps.length, 2);
    assert.ok(deps.every((e) => e.directed === true));
    assert.ok(deps.some((e) => e.from === 'article:https://x/b' && e.to === 'article:https://x/a'), 'from the dependent to the premise');
    assert.ok(deps.some((e) => e.from === 'article:https://x/a' && e.to.startsWith('ghost:')), 'off-corpus premise is a ghost node');
    assert.equal(deps.find((e) => e.to === 'article:https://x/a').note, 'rests on the lab log');
    assert.equal(g.counts.dependencies, 2);
    assert.ok(!g.edges.some((e) => e.kind === 'dependency' && e.from === e.to), 'no self-edge');
    // Deterministic, and the layout places the ghost.
    assert.deepEqual(buildCaseGraph(dataWithDependencies()), g);
    const pos = layoutCaseGraph(g);
    assert.ok(Object.keys(pos).some((k) => k.startsWith('ghost:')));
});

test('case-graph: a dependency chain running off the case draws only the edge that touches a member article', () => {
    const data = dataWithDependencies();
    data.links.dependencies = [
        { id: 'd1', relationship: 'depends-on', source_claim_id: 'c1', target_claim_id: 'x1', source_ref: 'c1', target_ref: 'x1', note: '' },
        { id: 'd2', relationship: 'depends-on', source_claim_id: 'x1', target_claim_id: 'x2', source_ref: 'x1', target_ref: 'x2', note: '' },
        { id: 'd3', relationship: 'depends-on', source_claim_id: 'x2', target_claim_id: 'x3', source_ref: 'x2', target_ref: 'x3', note: '' }
    ];
    const g = buildCaseGraph(data);
    const deps = g.edges.filter((e) => e.kind === 'dependency');
    assert.equal(deps.length, 1, 'ghost→ghost edges are not drawn');
    assert.equal(g.counts.dependencies, 1);
    assert.equal(g.nodes.filter((n) => n.type === 'ghost').length, 1, 'one ghost premise, not a web');
});

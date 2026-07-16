// Hypothesis block view-model tests — Phase 26 H.2
// (docs/HYPOTHESIS_MAP_DESIGN.md §4, §6.2). The DOM layer is a 1:1
// projection of `buildHypothesisBlockModel` (pure), so the
// no-scoreboard guard walks the model's strings: the ONLY count
// beside a role is each section's own size, no cross-hypothesis
// comparison phrasing exists anywhere, and the required
// maps-not-picks / verdict-does-not-weight disclaimers are present
// (the corpus-publish.test.mjs negative+positive pairing).

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { buildHypothesisBlockModel, AUTHORING_STRINGS } = await import('../src/portal/hypothesis-block.js');
const { buildHypothesisMap } = await import('../src/shared/hypothesis-map.js');

const CASE_ID = 'entity_00000000000000aa';
const HASH_A = 'a'.repeat(64);

function makeClaim(id, over = {}) {
    return {
        id, text: `Claim ${id}`, about: [CASE_ID], source: null, is_key: false,
        source_url: `https://example.com/${id}`, created: 100, ...over
    };
}

function makeData(over = {}) {
    const c1 = makeClaim('claim_00000000000000c1');
    const c2 = makeClaim('claim_00000000000000c2');
    return {
        case: { id: CASE_ID, name: 'Origins', type: 'case', pubkey: null },
        membership_ids: [CASE_ID],
        entitiesById: {
            [CASE_ID]: {
                id: CASE_ID, name: 'Origins', type: 'case',
                authored_fields: { scope_question: { value: 'Where did it begin?' } }
            }
        },
        articles: [{ url: 'https://x/a', articleHash: HASH_A, cachedAt: 10, article: { title: 'Article A' } }],
        orbit: { entity_ids: [CASE_ID], entities: [], dangling_entity_ids: [], claims: [c1, c2] },
        claimsById: { [c1.id]: c1, [c2.id]: c2 },
        propositions: { all: {
            prop_1: { id: 'prop_1', claim_id: c1.id, proposition_class: 'event-fact' }
        }, orbit: [] },
        verdicts: { byProposition: {
            prop_1: [{ id: 'v1', proposition_id: 'prop_1', verdict: 'contested', superseded_by: null }]
        } },
        integrity: [], integrityAll: [], forensic: [],
        links: { contradicts: [], attestations: [] },
        wire: { verdicts: [], findings: [], articles: [] },
        ...over
    };
}

function hyp(id, label, over = {}) {
    return {
        id, case_id: CASE_ID, label, statement: `${label} statement`, note: '',
        suggested_by: 'user', created: 50, updated: 50, ...over
    };
}

function edge(id, hypothesisId, ref, role, over = {}) {
    return {
        id, hypothesis_id: hypothesisId, claim_ref: ref, ref, role,
        note: '', suggested_by: 'user', quote: null, article_hash: null,
        claim_snapshot: null, created: 60, updated: 60, ...over
    };
}

function richModel() {
    const h1 = hyp('hyp_00000000000000ab', 'Zoonotic');
    const h2 = hyp('hyp_00000000000000cd', 'Lab origin', { created: 55, suggested_by: 'llm:claude-x' });
    const map = buildHypothesisMap({
        data: makeData(),
        brief: { caseId: CASE_ID, brief: { summary: 's', positions: [
            { label: 'Zoonotic', core_argument: 'Spillover.', holders: [{ article_hash: HASH_A }] },
            { label: '  ', holders: [] }
        ] } },
        hypotheses: [h1, h2],
        edges: [
            edge('hedge_1', h1.id, 'claim_00000000000000c1', 'supports', { quote: 'verbatim', note: 'why it matters' }),
            edge('hedge_2', h2.id, 'claim_00000000000000c1', 'undermines', { suggested_by: 'llm:claude-x' }),
            edge('hedge_3', h1.id, 'claim_00000000000000c2', 'supports'),
            edge('hedge_4', 'hyp_gone', 'claim_00000000000000c2', 'supports')
        ]
    }, null);
    return buildHypothesisBlockModel(map);
}

function allStrings(node, out = []) {
    if (typeof node === 'string') { out.push(node); return out; }
    if (Array.isArray(node)) { node.forEach((v) => allStrings(v, out)); return out; }
    if (node && typeof node === 'object') { Object.values(node).forEach((v) => allStrings(v, out)); }
    return out;
}

// ------------------------------------------------------------------

test('hypothesis-block: no-scoreboard guard — no comparison phrasing or judgment number in ANY rendered string', () => {
    // The model's strings PLUS the H.3 authoring copy (button labels,
    // placeholders, the attach explainer) — everything the block puts
    // on screen.
    const strings = [...allStrings(richModel()), ...AUTHORING_STRINGS];
    assert.ok(strings.length > 10);
    const banned = /\d+\s*%|\d+\s*\/\s*100|more likely|less likely|stronger|weaker|winner|wins\b|leads\b|ahead of|best.supported|top hypothesis|score|probabilit|confidence|likelihood/i;
    for (const s of strings) {
        assert.doesNotMatch(s, banned, `forbidden phrasing in: "${s}"`);
    }
});

test('hypothesis-block: the required disclaimers are present (positive half of the firewall pairing)', () => {
    const model = richModel();
    assert.match(model.heading, /not a ranking/);
    assert.match(model.explainer, /does not pick one/);
    assert.match(model.explainer, /order is not a ranking/);
    assert.match(model.explainer, /does not weight the edge/);
    assert.match(model.explainer, /never compared across hypotheses/);
});

test('hypothesis-block: the only role-adjacent count is each section\'s own size', () => {
    const model = richModel();
    for (const card of model.cards) {
        assert.equal(card.sections.length, 2);
        for (const s of card.sections) {
            assert.match(s.heading, /^(Supporting|Undermining) evidence \(\d+\)$/);
        }
        // No card-level string carries another hypothesis's label.
        const otherLabels = model.cards.filter((c) => c !== card).map((c) => c.title);
        for (const s of allStrings(card)) {
            for (const other of otherLabels) {
                assert.ok(!s.includes(other), `cross-hypothesis reference in "${s}"`);
            }
        }
    }
    // The map-level counts line names totals, not any hypothesis.
    for (const card of model.cards) {
        assert.ok(!model.countsLine.includes(card.title));
    }
});

test('hypothesis-block: model carries the map faithfully — crux badge, verdict chip, quote, provenance, dangling, unlabeled', () => {
    const model = richModel();
    assert.equal(model.empty, false);
    assert.equal(model.cards.length, 2);
    const [z, l] = model.cards;
    assert.equal(z.title, 'Zoonotic');
    assert.equal(z.holders[0].label, 'Article A');
    assert.equal(z.holders[0].url, 'https://x/a');
    const zSup = z.sections.find((s) => s.role === 'supports');
    assert.equal(zSup.heading, 'Supporting evidence (2)');
    const cruxEdge = zSup.edges.find((e) => e.crux);
    assert.ok(cruxEdge, 'the claim shared with Lab origin is badged as crux');
    assert.match(cruxEdge.id, /^hedge_/, 'edge id rides for the H.3 detach affordance');
    assert.deepEqual(cruxEdge.verdictChips, ['Event fact: Contested']);
    assert.equal(cruxEdge.quote, 'verbatim');
    assert.equal(cruxEdge.note, 'why it matters');
    assert.equal(l.provenance, 'llm:claude-x');
    const lUnd = l.sections.find((s) => s.role === 'undermines');
    assert.equal(lUnd.edges[0].crux, true);
    assert.match(model.danglingLine, /1 attachment reference/);
    assert.equal(model.dangling.length, 1);
    assert.match(model.unlabeledLine, /1 brief position had no label/);
});

test('hypothesis-block: empty map → empty model (the block self-removes)', () => {
    const map = buildHypothesisMap({ data: makeData(), brief: null, hypotheses: [], edges: [] }, null);
    const model = buildHypothesisBlockModel(map);
    assert.equal(model.empty, true);
    assert.deepEqual(model.cards, []);
});

test('hypothesis-block: unresolved claim and unresolved holder degrade honestly, never fabricated', () => {
    const h1 = hyp('hyp_00000000000000ab', 'Zoonotic');
    const map = buildHypothesisMap({
        data: makeData({ articles: [] }),
        brief: { caseId: CASE_ID, brief: { summary: 's', positions: [
            { label: 'Zoonotic', holders: [{ article_hash: HASH_A }] }
        ] } },
        hypotheses: [h1],
        edges: [edge('hedge_1', h1.id, `30040:${'f'.repeat(64)}:bare`, 'undermines')]
    }, null);
    const model = buildHypothesisBlockModel(map);
    const card = model.cards[0];
    assert.match(card.holders[0].label, /not in local archive/);
    assert.equal(card.holders[0].url, null);
    const und = card.sections.find((s) => s.role === 'undermines');
    assert.match(und.edges[0].text, /unresolved claim/);
    assert.equal(und.edges[0].url, null);
});

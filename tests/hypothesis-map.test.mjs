// Hypothesis map assembler tests — Phase 26 H.1
// (docs/HYPOTHESIS_MAP_DESIGN.md §2–§3, §6). Pure builder over
// hand-built `collectCaseDossierData`-shaped data (the case-graph
// fixture pattern) plus injected brief/hypotheses/edges; the dossier
// data is always injected, and fake-indexeddb backs only the one
// live-brief collector test. Load-bearing invariants: seed↔persisted
// merge on normalized label (duplicate positions union, blank ones
// disclosed), order is presentation not rank, roles never netted,
// opposing-edge crux detection, dangling disclosure (P6), verdict
// chips are chain-head context only, determinism, and the §6 grep
// guard — NO weight/score/probability/confidence/strength key
// anywhere, no allowlist.

import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const _stateStore = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
                const out = {};
                for (const k of Array.isArray(keys) ? keys : [keys]) {
                    if (_stateStore.has(k)) out[k] = _stateStore.get(k);
                }
                cb(out);
            },
            set(obj, cb) {
                for (const [k, v] of Object.entries(obj)) _stateStore.set(k, v);
                cb && cb();
            },
            remove(keys, cb) {
                for (const k of Array.isArray(keys) ? keys : [keys]) _stateStore.delete(k);
                cb && cb();
            }
        }
    }
};

const {
    buildHypothesisMap, collectHypothesisMapData
} = await import('../src/shared/hypothesis-map.js');
const { HypothesisModel, HypothesisEdgeModel } = await import('../src/shared/hypothesis-model.js');
const { ClaimModel } = await import('../src/shared/claim-model.js');

function resetState() { _stateStore.clear(); }

const GENERATED = '2026-07-16T12:00:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const PUBKEY_F = 'f'.repeat(64);
const CASE_ID = 'entity_00000000000000aa';

function makeClaim(id, over = {}) {
    return {
        id, text: `Claim ${id}`, about: [CASE_ID], source: null, is_key: false,
        source_url: `https://example.com/${id}`, created: 100, ...over
    };
}

// Minimal collectCaseDossierData-shaped envelope (the case-graph
// fixture pattern), extended with the authored scope question.
function makeData(over = {}) {
    const c1 = makeClaim('claim_00000000000000c1', { is_key: true });
    const c2 = makeClaim('claim_00000000000000c2');
    return {
        case: { id: CASE_ID, name: 'Origins', type: 'case', pubkey: null },
        membership_ids: [CASE_ID],
        entitiesById: {
            [CASE_ID]: {
                id: CASE_ID, name: 'Origins', type: 'case',
                authored_fields: { scope_question: { value: 'Where did the outbreak begin?' } }
            }
        },
        articles: [
            { url: 'https://x/a', articleHash: HASH_A, cachedAt: 10, article: { title: 'Article A' } }
        ],
        orbit: { entity_ids: [CASE_ID], entities: [], dangling_entity_ids: [], claims: [c1, c2] },
        claimsById: { [c1.id]: c1, [c2.id]: c2 },
        propositions: { all: {}, orbit: [] },
        verdicts: { byProposition: {} },
        integrity: [], integrityAll: [], forensic: [],
        links: { contradicts: [], attestations: [] },
        wire: { verdicts: [], findings: [], articles: [] },
        ...over
    };
}

function makeBrief(positions, over = {}) {
    return { caseId: CASE_ID, brief: { summary: 's', positions, ...over } };
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

const build = (input, at = GENERATED) => buildHypothesisMap({
    data: makeData(), brief: null, hypotheses: [], edges: [], ...input
}, at);

// ------------------------------------------------------------------

test('hypothesis-map: empty case — zero-count sections and the authored question, not errors', () => {
    const map = build({});
    assert.equal(map.question.text, 'Where did the outbreak begin?');
    assert.equal(map.question.provenance, 'authored');
    assert.deepEqual(map.hypotheses, []);
    assert.deepEqual(map.shared_claims, []);
    assert.deepEqual(map.dangling.edges, []);
    assert.equal(map.coverage.hypotheses, 0);
    assert.equal(map.coverage.edges, 0);
    assert.equal(map.generated_at, GENERATED);
});

test('hypothesis-map: missing scope question is empty with null provenance — never fabricated', () => {
    const data = makeData();
    delete data.entitiesById[CASE_ID].authored_fields;
    const map = build({ data });
    assert.deepEqual(map.question, { text: '', provenance: null });
});

test('hypothesis-map: brief positions seed hypotheses in brief order; holders join the archive honestly', () => {
    const map = build({
        brief: makeBrief([
            { label: 'Zoonotic', core_argument: 'Spillover at the market.',
              holders: [{ article_hash: HASH_A }, { article_hash: HASH_B }] },
            { label: 'Lab origin', holders: [] }
        ])
    });
    assert.equal(map.hypotheses.length, 2);
    const [z, l] = map.hypotheses;
    assert.equal(z.id, 'seed:zoonotic');
    assert.equal(z.statement, 'Spillover at the market.');
    assert.equal(z.suggested_by, 'seed:brief');
    assert.equal(z.persisted, false);
    assert.equal(z.seeded, true);
    // Resolved holder carries url+title; the unresolved hash is KEPT
    // with nulls (P6/P4: never dropped, never fabricated).
    assert.deepEqual(z.holders, [
        { article_hash: HASH_A, url: 'https://x/a', title: 'Article A' },
        { article_hash: HASH_B, url: null, title: null }
    ]);
    assert.equal(l.statement, 'Lab origin', 'statement falls back to the label');
    assert.equal(map.coverage.seeded, 2);
    assert.equal(map.coverage.persisted, 0);
});

test('hypothesis-map: duplicate-normalizing position labels union into ONE hypothesis — nothing dropped', () => {
    const map = build({
        brief: makeBrief([
            { label: 'Lab Origin', holders: [{ article_hash: HASH_A }] },
            { label: ' lab   origin ', core_argument: 'Second framing.',
              holders: [{ article_hash: HASH_A }, { article_hash: HASH_B }] }
        ])
    });
    assert.equal(map.hypotheses.length, 1);
    const row = map.hypotheses[0];
    assert.equal(row.label, 'Lab Origin', 'first spelling wins');
    assert.deepEqual(row.holders.map((h) => h.article_hash), [HASH_A, HASH_B],
        'holders union, deduped by hash');
    assert.equal(row.core_argument, 'Second framing.',
        'a later core_argument fills an empty one');
    assert.equal(map.coverage.seeded, 1);
});

test('hypothesis-map: a blank-label position cannot seed — disclosed as a count, never silent (P6)', () => {
    const map = build({
        brief: makeBrief([
            { label: 'Zoonotic', holders: [] },
            { label: '   ', core_argument: 'orphaned framing', holders: [{ article_hash: HASH_A }] }
        ])
    });
    assert.equal(map.hypotheses.length, 1);
    assert.equal(map.coverage.unlabeled_positions, 1);
});

test('hypothesis-map: a persisted hypothesis merges with its seed on normalized label — statement wins, holders ride', () => {
    const persisted = hyp('hyp_00000000000000ab', 'ZOONOTIC ', {
        statement: 'My sharper framing.', suggested_by: 'user'
    });
    const later = hyp('hyp_00000000000000cd', 'Cold chain', { created: 70 });
    const map = build({
        brief: makeBrief([
            { label: 'Zoonotic', core_argument: 'Spillover.', holders: [{ article_hash: HASH_A }] }
        ]),
        hypotheses: [persisted, later]
    });
    assert.equal(map.hypotheses.length, 2);
    const [merged, tail] = map.hypotheses;
    assert.equal(merged.id, 'hyp_00000000000000ab');
    assert.equal(merged.statement, 'My sharper framing.');
    assert.equal(merged.persisted, true);
    assert.equal(merged.seeded, true);
    assert.equal(merged.core_argument, 'Spillover.');
    assert.equal(merged.holders.length, 1);
    assert.equal(tail.id, 'hyp_00000000000000cd', 'persisted-only rows follow the seeds in creation order');
    assert.equal(tail.seeded, false);
    assert.equal(map.coverage.persisted, 2);
});

test('hypothesis-map: edges group under their hypothesis by role; section sizes match their lists', () => {
    const h1 = hyp('hyp_00000000000000ab', 'Zoonotic');
    const map = build({
        hypotheses: [h1],
        edges: [
            edge('hedge_1', h1.id, 'claim_00000000000000c1', 'supports'),
            edge('hedge_2', h1.id, 'claim_00000000000000c2', 'supports'),
            edge('hedge_3', h1.id, 'claim_00000000000000c2', 'undermines')
        ]
    });
    const row = map.hypotheses[0];
    assert.equal(row.edges.supports.length, 2);
    assert.equal(row.edges.undermines.length, 1);
    assert.deepEqual(row.coverage, { supports: 2, undermines: 1 });
    assert.equal(map.coverage.edges, 3);
    assert.equal(map.coverage.supports, 2);
    assert.equal(map.coverage.undermines, 1);
    assert.equal(map.coverage.claims, 2);
    const sup = row.edges.supports[0];
    assert.equal(sup.claim.local, true);
    assert.equal(sup.claim.is_key, true);
    assert.equal(sup.in_orbit, true);
});

test('hypothesis-map: an edge to a vanished hypothesis is disclosed as dangling, never dropped', () => {
    const map = build({
        hypotheses: [hyp('hyp_00000000000000ab', 'Zoonotic')],
        edges: [edge('hedge_9', 'hyp_gone', 'claim_00000000000000c1', 'supports')]
    });
    assert.equal(map.dangling.edges.length, 1);
    assert.equal(map.dangling.edges[0].hypothesis_id, 'hyp_gone');
    assert.equal(map.coverage.dangling_edges, 1);
    assert.equal(map.coverage.edges, 0, 'dangling edges are not counted as attached');
});

test('hypothesis-map: foreign edge renders from its snapshot; unknown claim with no snapshot is null', () => {
    const h1 = hyp('hyp_00000000000000ab', 'Zoonotic');
    const coord = `30040:${PUBKEY_F}:their-claim`;
    const map = build({
        hypotheses: [h1],
        edges: [
            edge('hedge_1', h1.id, coord, 'supports', {
                claim_snapshot: { url: 'https://foreign.example/x', url_raw: 'https://foreign.example/x', text: 'their claim', author_pubkey: PUBKEY_F }
            }),
            edge('hedge_2', h1.id, `30040:${PUBKEY_F}:bare`, 'undermines')
        ]
    });
    const [sup] = map.hypotheses[0].edges.supports;
    assert.equal(sup.claim.local, false);
    assert.equal(sup.claim.text, 'their claim');
    assert.equal(sup.in_orbit, false);
    assert.equal(map.hypotheses[0].edges.undermines[0].claim, null, 'renderers must tolerate null');
});

test('hypothesis-map: verdict chips are the chain head (find !superseded_by), unruled is null — context only', () => {
    const c1 = 'claim_00000000000000c1';
    const data = makeData({
        propositions: { all: {
            prop_1: { id: 'prop_1', claim_id: c1, proposition_class: 'event-fact' },
            prop_2: { id: 'prop_2', claim_id: c1, proposition_class: 'causal' }
        }, orbit: [] },
        verdicts: { byProposition: {
            prop_1: [
                { id: 'v1', proposition_id: 'prop_1', verdict: 'contested', superseded_by: 'v2' },
                { id: 'v2', proposition_id: 'prop_1', verdict: 'established-true', superseded_by: null }
            ]
        } }
    });
    const h1 = hyp('hyp_00000000000000ab', 'Zoonotic');
    const map = build({ data, hypotheses: [h1], edges: [edge('hedge_1', h1.id, c1, 'supports')] });
    const chips = map.hypotheses[0].edges.supports[0].verdicts;
    assert.deepEqual(chips, [
        { proposition_id: 'prop_1', proposition_class: 'event-fact', state: 'established-true' },
        { proposition_id: 'prop_2', proposition_class: 'causal', state: null }
    ]);
});

test('hypothesis-map: a claim under opposing roles across hypotheses is a crux; same-role sharing is not', () => {
    const h1 = hyp('hyp_00000000000000ab', 'Zoonotic');
    const h2 = hyp('hyp_00000000000000cd', 'Lab origin', { created: 55 });
    const map = build({
        hypotheses: [h1, h2],
        edges: [
            edge('hedge_1', h1.id, 'claim_00000000000000c1', 'supports'),
            edge('hedge_2', h2.id, 'claim_00000000000000c1', 'undermines'),
            edge('hedge_3', h1.id, 'claim_00000000000000c2', 'supports'),
            edge('hedge_4', h2.id, 'claim_00000000000000c2', 'supports')
        ]
    });
    assert.equal(map.shared_claims.length, 2);
    const opposing = map.shared_claims.find((s) => s.ref === 'claim_00000000000000c1');
    assert.equal(opposing.opposing, true);
    assert.deepEqual(opposing.entries, [
        { hypothesis_id: h1.id, role: 'supports' },
        { hypothesis_id: h2.id, role: 'undermines' }
    ]);
    assert.equal(map.shared_claims.find((s) => s.ref === 'claim_00000000000000c2').opposing, false);
    assert.equal(map.coverage.shared_claims, 2);
    assert.equal(map.coverage.opposing_claims, 1);
});

test('hypothesis-map: both roles on ONE hypothesis stay visible in its own sections — not a shared claim', () => {
    const h1 = hyp('hyp_00000000000000ab', 'Zoonotic');
    const map = build({
        hypotheses: [h1],
        edges: [
            edge('hedge_1', h1.id, 'claim_00000000000000c1', 'supports'),
            edge('hedge_2', h1.id, 'claim_00000000000000c1', 'undermines')
        ]
    });
    assert.deepEqual(map.hypotheses[0].coverage, { supports: 1, undermines: 1 });
    assert.deepEqual(map.shared_claims, [], 'sharing means 2+ hypotheses');
});

test('hypothesis-map: a shared claim keeps the first RESOLVABLE view — a null never shadows a sibling snapshot', () => {
    const h1 = hyp('hyp_00000000000000ab', 'Zoonotic');
    const h2 = hyp('hyp_00000000000000cd', 'Lab origin', { created: 55 });
    const coord = `30040:${PUBKEY_F}:their-claim`;
    const map = build({
        hypotheses: [h1, h2],
        edges: [
            // First-seen edge has NO snapshot (claim view null)…
            edge('hedge_1', h1.id, coord, 'supports'),
            // …the sibling on the other hypothesis carries one.
            edge('hedge_2', h2.id, coord, 'undermines', {
                claim_snapshot: { url: 'https://foreign.example/x', url_raw: 'https://foreign.example/x', text: 'their claim', author_pubkey: PUBKEY_F }
            })
        ]
    });
    const crux = map.shared_claims.find((s) => s.ref === coord);
    assert.equal(crux.opposing, true);
    assert.equal(crux.claim.text, 'their claim', 'the resolvable sibling view wins');
});

test('hypothesis-map: deterministic — same inputs deepEqual', () => {
    const input = {
        brief: makeBrief([{ label: 'Zoonotic', holders: [{ article_hash: HASH_A }] }]),
        hypotheses: [hyp('hyp_00000000000000cd', 'Lab origin')],
        edges: [edge('hedge_1', 'hyp_00000000000000cd', 'claim_00000000000000c1', 'supports')]
    };
    assert.deepEqual(build(input), build(input));
});

test('hypothesis-map: §6 grep guard — no fused-number key anywhere, no allowlist', () => {
    const h1 = hyp('hyp_00000000000000ab', 'Zoonotic');
    const h2 = hyp('hyp_00000000000000cd', 'Lab origin');
    const map = build({
        brief: makeBrief([{ label: 'Zoonotic', core_argument: 'x', holders: [{ article_hash: HASH_A }] }]),
        hypotheses: [h1, h2],
        edges: [
            edge('hedge_1', h1.id, 'claim_00000000000000c1', 'supports'),
            edge('hedge_2', h2.id, 'claim_00000000000000c1', 'undermines'),
            edge('hedge_3', 'hyp_gone', 'claim_00000000000000c2', 'supports')
        ]
    });
    const banned = /weight|score|probabilit|confidence|strength|rating|grade|likelihood|mean/i;
    const walk = (node, path) => {
        if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
        if (node && typeof node === 'object') {
            for (const [k, v] of Object.entries(node)) {
                if (banned.test(k)) assert.fail(`forbidden fused-number key at ${path}.${k}`);
                walk(v, `${path}.${k}`);
            }
        }
    };
    walk(map, '$');
});

// ------------------------------------------------------------------
// Collector (storage-aware; data + brief injected, models live)
// ------------------------------------------------------------------

test('hypothesis-map: collector reads the models and re-canonicalizes stored edge refs at read time', async () => {
    resetState();
    const h = await HypothesisModel.create({ case_id: CASE_ID, label: 'Zoonotic' });
    const claim = await ClaimModel.create({
        text: 'The first cluster centered on the market.',
        source_url: 'https://example.com/report', about: [CASE_ID]
    });
    // Edge stored under a coordinate that only later becomes collapsible.
    const coord = `30040:${PUBKEY_F}:${claim.id}`;
    await HypothesisEdgeModel.create({
        hypothesis_id: h.id, claim_ref: coord, role: 'supports',
        claim_snapshot: { url: 'https://example.com/report', text: 'their view' }
    });
    await ClaimModel.markPublished(claim.id, 'e'.repeat(64), PUBKEY_F);

    const data = makeData({ claimsById: { [claim.id]: claim }, orbit: { entity_ids: [], entities: [], dangling_entity_ids: [], claims: [claim] } });
    const input = await collectHypothesisMapData(CASE_ID, { data, brief: null });
    assert.equal(input.edges.length, 1);
    assert.equal(input.edges[0].claim_ref, coord, 'stored ref untouched');
    assert.equal(input.edges[0].ref, claim.id, 'canonicalized at read time');

    const map = buildHypothesisMap(input, GENERATED);
    assert.equal(map.hypotheses[0].edges.supports[0].claim.local, true, 'drifted ref reaches the local claim');
});

test('hypothesis-map: assembleHypothesisMap composes collect+build and forwards generatedAt', async () => {
    resetState();
    await HypothesisModel.create({ case_id: CASE_ID, label: 'Zoonotic' });
    const { assembleHypothesisMap } = await import('../src/shared/hypothesis-map.js');
    const map = await assembleHypothesisMap(CASE_ID, {
        data: makeData(), brief: null, generatedAt: GENERATED
    });
    assert.equal(map.generated_at, GENERATED);
    assert.equal(map.hypotheses.length, 1);
    assert.equal(map.hypotheses[0].label, 'Zoonotic');
});

test('hypothesis-map: collector reads a LIVE stored brief when none is injected (fake-indexeddb)', async () => {
    resetState();
    const { saveCaseBrief } = await import('../src/shared/audit/audit-cache.js');
    // The exact record shape synthesis-block.js persists.
    await saveCaseBrief({
        caseId: CASE_ID,
        brief: { summary: 's', positions: [{ label: 'From storage', holders: [{ article_hash: HASH_A }] }] },
        grounding: { checked: 1, dropped: 0 }, inputHash: 'x', model: 'm',
        promptVersion: 'corpus-v1', members: [], analyzed: 1, failed: 0, usage: {}
    });
    const input = await collectHypothesisMapData(CASE_ID, { data: makeData() });
    const map = buildHypothesisMap(input, GENERATED);
    assert.equal(map.hypotheses.length, 1);
    assert.equal(map.hypotheses[0].label, 'From storage');
    assert.equal(map.hypotheses[0].holders[0].url, 'https://x/a');
});

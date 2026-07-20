// Cross-workspace graph tests — Phase 28.6
// (docs/CASE_BOUND_WORKSPACES_KICKOFF.md §6 slice 6).
//
// Three surfaces: the pure per-workspace slice math (the 20.1 union
// re-derived over injected data), the pure multi-case graph builder
// (shared names as first-class edges that the per-case cap can never
// drop), and the read-only workspace readers — including the pin that
// reading a workspace whose archive DB does not exist NEVER mints an
// empty shell (which would break the real versioned open's
// oldVersion===0 schema creation forever).

import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('fake-indexeddb/auto');

const _store = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
                const out = {};
                for (const k of Array.isArray(keys) ? keys : [keys]) {
                    if (_store.has(k)) out[k] = _store.get(k);
                }
                cb(out);
            },
            set(obj, cb) { for (const [k, v] of Object.entries(obj)) _store.set(k, v); cb && cb(); },
            remove(keys, cb) { for (const k of Array.isArray(keys) ? keys : [keys]) _store.delete(k); cb && cb(); }
        }
    }
};

const { buildCaseSlice, buildCrossCaseGraph, layoutCrossCaseGraph } =
    await import('../src/shared/cross-case-graph.js');
const { readWorkspaceKey, readWorkspaceArticles } =
    await import('../src/shared/workspace-read.js');

// ---------------------------------------------------------------------
// buildCaseSlice — pure union membership over injected data
// ---------------------------------------------------------------------

function sliceFixture() {
    const entities = {
        case_1: { id: 'case_1', name: 'Origin of Covid', type: 'case' },
        case_2: { id: 'case_2', name: 'Covid (alt)', type: 'case', canonical_id: 'case_1' },
        ent_a: { id: 'ent_a', name: 'Alice Adams', type: 'person' },
        ent_b: { id: 'ent_b', name: 'Wuhan Institute', type: 'organization' }
    };
    const articles = [
        // member via TAG — and tagged with the ALIAS, not the root
        { url: 'https://ex.com/a', article: { entities: [{ entity_id: 'case_2' }, { entity_id: 'ent_a' }] } },
        // member via CLAIM only
        { url: 'https://ex.com/b', article: { entities: [] } },
        // not a member
        { url: 'https://ex.com/c', article: { entities: [{ entity_id: 'ent_a' }] } }
    ];
    const claims = {
        cl_1: { id: 'cl_1', source_url: 'https://ex.com/b', about: ['case_1', 'ent_b'] },
        cl_2: { id: 'cl_2', source_url: 'https://ex.com/a', about: ['ent_a'] }
    };
    return { workspace: { id: 'ws_x', label: 'Covid WS' }, caseEntity: entities.case_1, entities, claims, articles };
}

test('28.6: buildCaseSlice — tag ∪ claim membership over the alias family, degrees, family excluded', () => {
    const slice = buildCaseSlice(sliceFixture());
    assert.equal(slice.kase.id, 'case_1');
    assert.equal(slice.kase.name, 'Origin of Covid');
    assert.equal(slice.counts.articles, 2, 'a (alias tag) + b (claim) are members; c is not');
    assert.deepEqual([...slice.entities.keys()].sort(), ['ent_a', 'ent_b'],
        'the case family never appears as an orbit entity');
    assert.equal(slice.entities.get('ent_a').degree, 1, 'on member a only — c is not a member');
    assert.equal(slice.entities.get('ent_b').degree, 1, 'via the claim about on member b');
    assert.equal(slice.entities.get('ent_a').type, 'person');
});

test('28.6: buildCaseSlice — resolving from an ALIAS id lands on the same root slice', () => {
    const fx = sliceFixture();
    const viaAlias = buildCaseSlice({ ...fx, caseEntity: fx.entities.case_2 });
    const viaRoot = buildCaseSlice(fx);
    assert.deepEqual(JSON.parse(JSON.stringify({ ...viaAlias, entities: [...viaAlias.entities] })),
        JSON.parse(JSON.stringify({ ...viaRoot, entities: [...viaRoot.entities] })));
});

// ---------------------------------------------------------------------
// buildCrossCaseGraph — shared names as first-class, uncappable edges
// ---------------------------------------------------------------------

function mkSlice(wsId, wsLabel, caseName, ents) {
    return {
        workspace: { id: wsId, label: wsLabel },
        kase: { id: `case_${wsId}`, name: caseName },
        counts: { articles: 9, claims: 9 },
        entities: new Map(ents.map((e) => [e.id, e]))
    };
}

const SLICE_A = () => mkSlice('ws_a', 'Covid', 'Origin of Covid', [
    { id: 'a1', name: 'Alice Adams', type: 'person', degree: 3 },
    { id: 'a2', name: 'Bob Brown', type: 'person', degree: 2 },
    { id: 'a3', name: 'Carol Cruz', type: 'person', degree: 1 }
]);
const SLICE_B = () => mkSlice('ws_b', 'Eggs', 'Are eggs bad?', [
    { id: 'b1', name: 'Dave Diaz', type: 'person', degree: 5 },
    // same normalized name as A's Alice, LOW degree, different type
    { id: 'b2', name: 'alice  adams', type: 'organization', degree: 1 }
]);

test('28.6: shared names survive the per-case cap and edge cross-case only', () => {
    const graph = buildCrossCaseGraph([SLICE_A(), SLICE_B()], { maxEntitiesPerCase: 1 });

    const ids = graph.nodes.map((n) => n.id);
    assert.ok(ids.includes('entity:ws_a:a1'), 'top-degree kept in A');
    assert.ok(ids.includes('entity:ws_b:b1'), 'top-degree kept in B');
    assert.ok(ids.includes('entity:ws_b:b2'),
        'the SHARED low-degree entity is kept past the cap — sharing is the signal');
    assert.ok(!ids.includes('entity:ws_a:a2') && !ids.includes('entity:ws_a:a3'),
        'unshared tail entities drop');
    const moreA = graph.nodes.find((n) => n.id === 'more:ws_a');
    assert.equal(moreA.count, 2, 'the drop is disclosed, never silent');

    const shared = graph.edges.filter((e) => e.kind === 'shared');
    assert.equal(shared.length, 1);
    assert.equal(shared[0].from, 'entity:ws_a:a1');
    assert.equal(shared[0].to, 'entity:ws_b:b2');
    assert.equal(shared[0].match, 'name', 'a name match, never an identity assertion');
    assert.equal(shared[0].typeMismatch, true, 'person vs organization disclosed');

    assert.deepEqual(graph.counts, {
        cases: 2, entities: 3, entities_dropped: 2, shared_names: 1, shared_edges: 1
    });

    // No intra-slice shared edges even if a slice repeated a name.
    for (const e of shared) {
        const fromWs = graph.nodes.find((n) => n.id === e.from).wsId;
        const toWs = graph.nodes.find((n) => n.id === e.to).wsId;
        assert.notEqual(fromWs, toWs);
    }
});

test('28.6: builder and layout are deterministic', () => {
    const g1 = buildCrossCaseGraph([SLICE_A(), SLICE_B()]);
    const g2 = buildCrossCaseGraph([SLICE_A(), SLICE_B()]);
    assert.deepEqual(g1, g2);
    assert.deepEqual(layoutCrossCaseGraph(g1), layoutCrossCaseGraph(g2));
});

test('28.6: layout — one column per case in slice order, every node placed', () => {
    const graph = buildCrossCaseGraph([SLICE_A(), SLICE_B()], { maxEntitiesPerCase: 1 });
    const { positions, extent } = layoutCrossCaseGraph(graph, { colWidth: 400, height: 600 });
    assert.deepEqual(extent, { w: 800, h: 600 });
    for (const n of graph.nodes) assert.ok(positions[n.id], `position for ${n.id}`);
    assert.ok(positions['case:ws_a'].x < positions['case:ws_b'].x, 'side by side, slice order');
    // Each entity sits in its own case's column.
    assert.ok(positions['entity:ws_a:a1'].x < 400);
    assert.ok(positions['entity:ws_b:b1'].x > 400);
});

// ---------------------------------------------------------------------
// workspace-read — the read-only door
// ---------------------------------------------------------------------

test('28.6: readWorkspaceKey — default is the bare key, others the ws: prefix, JSON parsed', async () => {
    _store.clear();
    _store.set('entities', JSON.stringify({ e1: { id: 'e1' } }));
    _store.set('ws:ws_z:entities', JSON.stringify({ e2: { id: 'e2' } }));

    assert.deepEqual(await readWorkspaceKey('default', 'entities'), { e1: { id: 'e1' } });
    assert.deepEqual(await readWorkspaceKey('ws_z', 'entities'), { e2: { id: 'e2' } });
    assert.equal(await readWorkspaceKey('ws_nope', 'entities', null), null, 'missing → default');
});

test('28.6: readWorkspaceArticles — reads an existing store, and a missing DB is NOT minted', async () => {
    // Seed a foreign workspace's archive DB directly.
    await new Promise((resolve, reject) => {
        const open = indexedDB.open('xray-archive::ws_seeded', 1);
        open.onupgradeneeded = () => {
            open.result.createObjectStore('articles', { keyPath: 'urlHash' });
        };
        open.onsuccess = () => {
            const tx = open.result.transaction('articles', 'readwrite');
            tx.objectStore('articles').put({ urlHash: 'h1', url: 'https://ex.com/a', article: { title: 'A' } });
            tx.oncomplete = () => { open.result.close(); resolve(); };
            tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
    });

    const rows = await readWorkspaceArticles('ws_seeded');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].url, 'https://ex.com/a');

    // A workspace with no archive yet: [] — and no database appears.
    assert.deepEqual(await readWorkspaceArticles('ws_absent'), []);
    const names = (await indexedDB.databases()).map((d) => d.name);
    assert.ok(!names.includes('xray-archive::ws_absent'),
        'the read must never mint an empty shell — it would break the real open\'s schema creation');
});

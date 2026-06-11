// portal/graph.js tests — Phase 12.5 (docs/PORTAL_DESIGN.md).
//
// The ego graph is the headline "explore visually" surface, so its
// selection rules are pinned: which claims spoke off the focus, how
// assessments decorate (never node-ify), when a 30055 endpoint becomes
// a ghost, sector caps with "+K more", and layout determinism.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { buildEgoGraph, layoutEgoGraph } = await import('../src/portal/graph.js');
const { buildItems } = await import('../src/portal/library.js');

const USER_PK = 'a'.repeat(64);
const FOCUS_PK = 'b'.repeat(64);   // person entity in the registry
const OTHER_PK = 'c'.repeat(64);   // second person
const CASE_PK = 'd'.repeat(64);    // case entity
const ACCT_PK = 'e'.repeat(64);    // synthetic account pubkey

const ENTITY_INDEX = {
    [FOCUS_PK]: { entityId: 'entity_focus00000000', name: 'John Dehlin', type: 'person' },
    [OTHER_PK]: { entityId: 'entity_other00000000', name: 'LDS Church', type: 'organization' },
    [CASE_PK]:  { entityId: 'entity_case000000000', name: 'Excommunication', type: 'case' }
};

let nextId = 0;
function rec(kind, tags, content = '', createdAt = 1000) {
    return {
        event: { id: `ev${nextId++}`, kind, pubkey: USER_PK, created_at: createdAt, tags, content },
        relays: ['wss://r']
    };
}

function claimRec(d, { about = [], source = [], createdAt = 1000, text = `claim ${d}` } = {}) {
    const tags = [['d', d], ['r', 'https://example.com/v'], ['title', 'Src']];
    for (const pk of about) tags.push(['p', pk, '', 'about']);
    for (const pk of source) tags.push(['p', pk, '', 'source']);
    return rec(30040, tags, text, createdAt);
}

function coord(d) { return `30040:${USER_PK}:${d}`; }

function baseItems(records) {
    nextId = 0;
    return buildItems(records, { entityIndex: ENTITY_INDEX });
}

test('spokes: claims about vs sourced-by are distinct node types', () => {
    const items = baseItems([
        claimRec('claim_about1', { about: [FOCUS_PK], createdAt: 900 }),
        claimRec('claim_about2', { about: [FOCUS_PK], createdAt: 800 }),
        claimRec('claim_said1', { source: [FOCUS_PK], createdAt: 700 }),
        claimRec('claim_unrelated', { about: [OTHER_PK], createdAt: 600 })
    ]);
    const g = buildEgoGraph(items, { focusPubkey: FOCUS_PK, entityIndex: ENTITY_INDEX });
    const types = g.nodes.map((n) => n.nodeType).sort();
    assert.deepEqual(types.filter((t) => t === 'claim'), ['claim', 'claim']);
    assert.deepEqual(types.filter((t) => t === 'sourced-claim'), ['sourced-claim']);
    assert.equal(g.counts.claimsAbout, 2);
    assert.equal(g.counts.claimsSourced, 1);
    // The unrelated claim never appears.
    assert.ok(!g.nodes.some((n) => n.id === `claim:${coord('claim_unrelated')}`));
    // Every ring node has a spoke from the focus.
    for (const node of g.nodes) {
        assert.ok(g.edges.some((e) => e.from === 'focus' && e.to === node.id),
            `missing spoke for ${node.id}`);
    }
});

test('co-tagged entities and cases ring the focus', () => {
    const items = baseItems([
        claimRec('claim_1', { about: [FOCUS_PK, OTHER_PK, CASE_PK] }),
        claimRec('claim_2', { about: [FOCUS_PK, OTHER_PK] })
    ]);
    const g = buildEgoGraph(items, { focusPubkey: FOCUS_PK, entityIndex: ENTITY_INDEX });
    const entityNode = g.nodes.find((n) => n.nodeType === 'entity');
    assert.equal(entityNode.label, 'LDS Church');
    assert.equal(entityNode.count, 2);
    const caseNode = g.nodes.find((n) => n.nodeType === 'case');
    assert.equal(caseNode.label, 'Excommunication');
    // The co-tagged entity wires to the claims it shares with the focus.
    const mentions = g.edges.filter((e) => e.kind === 'mention' && e.to === entityNode.id);
    assert.equal(mentions.length, 2);
});

test('assessments decorate their claim node — latest wins, never a node', () => {
    const records = [claimRec('claim_1', { about: [FOCUS_PK] })];
    records.push(rec(30054, [
        ['d', 'assess:1'], ['a', coord('claim_1')], ['r', 'https://example.com/v'],
        ['stance', '1'], ['L', 'xray/assessment'], ['l', 'misleading', 'xray/assessment']
    ], 'old judgment', 500));
    records.push(rec(30054, [
        ['d', 'assess:1b'], ['a', coord('claim_1')], ['r', 'https://example.com/v'],
        ['stance', '-2'], ['L', 'xray/assessment'],
        ['l', 'misleading', 'xray/assessment'], ['l', 'flip-flop', 'xray/assessment']
    ], 'newer judgment', 900));
    const g = buildEgoGraph(baseItems(records), { focusPubkey: FOCUS_PK, entityIndex: ENTITY_INDEX });
    const claimNode = g.nodes.find((n) => n.nodeType === 'claim');
    assert.equal(claimNode.stance, -2);
    assert.equal(claimNode.labelCount, 2);
    assert.ok(!g.nodes.some((n) => n.nodeType === 'assessment'));
});

test('30055 contradiction: both endpoints visible → warn edge between them', () => {
    const records = [
        claimRec('claim_1', { about: [FOCUS_PK] }),
        claimRec('claim_2', { about: [FOCUS_PK] }),
        rec(30055, [
            ['d', 'rel:1'],
            ['a', coord('claim_1'), '', 'source'], ['a', coord('claim_2'), '', 'target'],
            ['relationship', 'contradicts'], ['r', 'https://example.com/v']
        ], '', 100)
    ];
    const g = buildEgoGraph(baseItems(records), { focusPubkey: FOCUS_PK, entityIndex: ENTITY_INDEX });
    const rel = g.edges.find((e) => e.kind === 'relationship');
    assert.equal(rel.warn, true);
    assert.equal(rel.from, `claim:${coord('claim_1')}`);
    assert.equal(rel.to, `claim:${coord('claim_2')}`);
    assert.ok(!g.nodes.some((n) => n.nodeType === 'ghost-claim'));
});

test('30055 with an out-of-ego endpoint grows a ghost node — the ⚠ is never hidden', () => {
    const records = [
        claimRec('claim_1', { about: [FOCUS_PK] }),
        claimRec('claim_far', { about: [OTHER_PK] }),  // visible in corpus, not in ego
        rec(30055, [
            ['d', 'rel:1'],
            ['a', coord('claim_1'), '', 'source'], ['a', coord('claim_far'), '', 'target'],
            ['relationship', 'contradicts'], ['r', 'https://example.com/v']
        ], '', 100)
    ];
    const g = buildEgoGraph(baseItems(records), { focusPubkey: FOCUS_PK, entityIndex: ENTITY_INDEX });
    const ghost = g.nodes.find((n) => n.nodeType === 'ghost-claim');
    assert.ok(ghost, 'ghost endpoint expected');
    assert.equal(ghost.coord, coord('claim_far'));
    const rel = g.edges.find((e) => e.kind === 'relationship');
    assert.equal(rel.warn, true);
    assert.equal(rel.to, ghost.id);
});

test('sector cap: newest N kept, "+K more" node appears, expansion lifts it', () => {
    const records = [];
    for (let i = 0; i < 30; i++) {
        records.push(claimRec(`claim_${String(i).padStart(2, '0')}`, { about: [FOCUS_PK], createdAt: 1000 + i }));
    }
    const items = baseItems(records);
    const capped = buildEgoGraph(items, { focusPubkey: FOCUS_PK, entityIndex: ENTITY_INDEX, sectorCap: 24 });
    assert.equal(capped.nodes.filter((n) => n.nodeType === 'claim').length, 24);
    const more = capped.nodes.find((n) => n.nodeType === 'more' && n.forType === 'claim');
    assert.equal(more.label, '+6 more');
    // Newest first: claim_29 kept, claim_00 dropped.
    assert.ok(capped.nodes.some((n) => n.id === `claim:${coord('claim_29')}`));
    assert.ok(!capped.nodes.some((n) => n.id === `claim:${coord('claim_00')}`));

    const expanded = buildEgoGraph(items, {
        focusPubkey: FOCUS_PK, entityIndex: ENTITY_INDEX, sectorCap: 24,
        expandedTypes: new Set(['claim'])
    });
    assert.equal(expanded.nodes.filter((n) => n.nodeType === 'claim').length, 30);
    assert.ok(!expanded.nodes.some((n) => n.nodeType === 'more'));
});

test('linked accounts spoke off the focus via linked-entity', () => {
    const records = [
        rec(32126, [
            ['d', 'youtube:UC1'], ['p', ACCT_PK, '', 'account'],
            ['account-platform', 'youtube'], ['account-id', 'UC1'],
            ['account-username', 'mormonstories'],
            ['linked-entity', 'entity_focus00000000']
        ], '', 100),
        rec(32126, [
            ['d', 'youtube:UC2'], ['p', 'f'.repeat(64), '', 'account'],
            ['account-platform', 'youtube'], ['account-id', 'UC2'],
            ['linked-entity', 'entity_other00000000']
        ], '', 90)
    ];
    const g = buildEgoGraph(baseItems(records), { focusPubkey: FOCUS_PK, entityIndex: ENTITY_INDEX });
    const accounts = g.nodes.filter((n) => n.nodeType === 'account');
    assert.equal(accounts.length, 1);
    assert.match(accounts[0].label, /mormonstories/);
});

test('focus falls back to the kind-0 profile name when not in the registry', () => {
    const stranger = '9'.repeat(64);
    const records = [rec(0, [], JSON.stringify({ name: 'Mystery Guest' }), 50)];
    records[0].event.pubkey = stranger;
    const g = buildEgoGraph(baseItems(records), { focusPubkey: stranger, entityIndex: ENTITY_INDEX });
    assert.equal(g.focus.name, 'Mystery Guest');
});

test('layout is deterministic, centered, and gives every node a distinct position', () => {
    const records = [
        claimRec('claim_1', { about: [FOCUS_PK, OTHER_PK, CASE_PK] }),
        claimRec('claim_2', { about: [FOCUS_PK] }),
        claimRec('claim_3', { source: [FOCUS_PK] })
    ];
    const items = baseItems(records);
    const g = buildEgoGraph(items, { focusPubkey: FOCUS_PK, entityIndex: ENTITY_INDEX });
    const a = layoutEgoGraph(g, { size: 720 });
    const b = layoutEgoGraph(g, { size: 720 });
    assert.deepEqual(a, b);
    assert.deepEqual(a.focus, { x: 360, y: 360 });
    const seen = new Set();
    for (const node of g.nodes) {
        const pos = a[node.id];
        assert.ok(pos, `no position for ${node.id}`);
        assert.ok(pos.x >= 0 && pos.x <= 720 && pos.y >= 0 && pos.y <= 720, `out of bounds: ${node.id}`);
        const key = `${Math.round(pos.x)}:${Math.round(pos.y)}`;
        assert.ok(!seen.has(key), `overlapping nodes at ${key}`);
        seen.add(key);
    }
});

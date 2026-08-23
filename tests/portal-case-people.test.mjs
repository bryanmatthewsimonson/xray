// Portal case view — the "People & organizations" section, made
// LOCAL-FIRST (field-found 2026-08-23, PR #347 soak walk step 4): a
// case with several people entities tagged on its member articles
// rendered NO people section, because the section was built ONLY from
// `p` tags on PUBLISHED claim events. This is docs/PORTAL_UX_REVIEW.md
// finding C1's local-vs-relay split in another form.
//
// Three seams, per seam-and-invariant-check:
//   1. the pure builder consumes the LOCAL dossier data (the bug);
//   2. the rendered chip strings, read through a minimal DOM stub —
//      one vocabulary ("sources" / "published claims"), no bare counts;
//   3. the wiring in case-view.js actually passes the local data in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// case-people → case-graph → case-dossier → models probe chrome.storage at load.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { buildCasePeople, renderCasePeople, peopleChipLabel } = await import('../src/portal/case-people.js');

const PK = (c) => c.repeat(64);   // hex-ish pubkey stand-ins

// collectCaseDossierData-shaped LOCAL data: a tag-built case (the real
// COVID workspace shape — member articles tagged, zero published claims).
function makeData(over = {}) {
    return {
        case: { id: 'case1', name: 'Origins', type: 'case', pubkey: PK('c') },
        membership_ids: ['case1', 'case1alias'],
        entitiesById: {
            case1:      { id: 'case1', name: 'Origins', type: 'case', keypair: { pubkey: PK('c') } },
            case1alias: { id: 'case1alias', name: 'Origins (alias)', type: 'case', canonical_id: 'case1' },
            eP:   { id: 'eP', name: 'Dr P', type: 'person', keypair: { pubkey: PK('a') } },
            eO:   { id: 'eO', name: 'Institute', type: 'organization', keypair: { pubkey: PK('b') } },
            eRef: { id: 'eRef', name: 'Reference Only', type: 'person' },          // keyless (no pubkey at all)
            eF:   { id: 'eF', name: 'Foreign Person', type: 'person', foreign_pubkey: PK('f') }
        },
        articles: [
            { url: 'https://x/a', articleHash: 'a'.repeat(64), cachedAt: 10,
              article: { title: 'A', entities: [{ entity_id: 'case1' }, { entity_id: 'eP' }, { entity_id: 'eRef' }] } },
            { url: 'https://x/b', articleHash: 'b'.repeat(64), cachedAt: 20,
              article: { title: 'B', entities: [{ entity_id: 'case1alias' }, { entity_id: 'eP' }, { entity_id: 'eO' }] } },
            { url: 'https://x/c', articleHash: 'c'.repeat(64), cachedAt: 30,
              article: { title: 'C', entities: [{ entity_id: 'case1' }, { entity_id: 'eP' }, { entity_id: 'eF' }, { entity_id: 'eDangling' }] } }
        ],
        orbit: { claims: [], entities: [], dangling_entity_ids: ['eDangling'] },
        claimsById: {},
        links: { contradicts: [], attestations: [], related: [] },
        propositions: { all: {}, orbit: [] },
        verdicts: { byProposition: {} },
        integrity: [], integrityAll: [], forensic: [],
        wire: { verdicts: [], findings: [], articles: [] },
        ...over
    };
}

// Portal entityIndex: pubkey → {entityId, name, type} (identity.js).
const entityIndex = {
    [PK('c')]: { pubkey: PK('c'), entityId: 'case1', name: 'Origins', type: 'case' },
    [PK('a')]: { pubkey: PK('a'), entityId: 'eP', name: 'Dr P', type: 'person' },
    [PK('b')]: { pubkey: PK('b'), entityId: 'eO', name: 'Institute', type: 'organization' },
    [PK('d')]: { pubkey: PK('d'), entityId: 'eWire', name: 'Wire Only', type: 'person' }
};

// Library items: a published claim event p-tagging people.
function claimItem(pTags) {
    return { typeKey: 'claim', event: { kind: 30040, tags: [['p', PK('c'), '', 'about'], ...pTags.map((pk) => ['p', pk, '', 'about'])] } };
}

// ------------------------------------------------------------------
// Seam 1 — the builder is local-first
// ------------------------------------------------------------------

test('people: a tag-built case with ZERO published claims still lists its people (the field bug)', () => {
    const rows = buildCasePeople({ caseItems: [], casePubkey: PK('c'), entityIndex, data: makeData() });
    const byId = Object.fromEntries(rows.map((r) => [r.entityId, r]));
    assert.ok(rows.length > 0, 'no rows — the section would not render at all (the 2026-08-23 field report)');
    assert.equal(byId.eP.sources, 3, 'Dr P is tagged on all three member sources');
    assert.equal(byId.eO.sources, 1);
    assert.equal(byId.eP.mentions, 0, 'nothing published yet');
    assert.equal(byId.eP.pubkey, PK('a'), 'local pubkey rides along for the spokes chip');
    assert.equal(byId.eP.name, 'Dr P');
    assert.equal(byId.eP.type, 'person');
});

test('people: the case itself, its alias family, and dangling ids never become rows', () => {
    const rows = buildCasePeople({ caseItems: [], casePubkey: PK('c'), entityIndex, data: makeData() });
    const ids = rows.map((r) => r.entityId);
    assert.ok(!ids.includes('case1'));
    assert.ok(!ids.includes('case1alias'));
    assert.ok(!ids.includes('eDangling'), 'dangling ids have no name to show; the dossier coverage line reports them');
});

test('people: a published-claim mention MERGES into the same row as the local tag, counts kept separate', () => {
    const items = [claimItem([PK('a')]), claimItem([PK('a'), PK('a')]), claimItem([PK('d')])];
    const rows = buildCasePeople({ caseItems: items, casePubkey: PK('c'), entityIndex, data: makeData() });
    const byId = Object.fromEntries(rows.map((r) => [r.entityId, r]));
    assert.equal(rows.filter((r) => r.entityId === 'eP').length, 1, 'one row per entity, keyed by entity id');
    assert.equal(byId.eP.sources, 3);
    assert.equal(byId.eP.mentions, 2, 'two published CLAIMS name Dr P (a claim p-tagging twice counts once)');
    assert.equal(byId.eWire.sources, 0, 'wire-only person: on no local source');
    assert.equal(byId.eWire.mentions, 1);
});

test('people: no local data (wire-only case) degrades to the published-claim p-tags exactly as before', () => {
    const items = [claimItem([PK('a'), PK('d')])];
    const rows = buildCasePeople({ caseItems: items, casePubkey: PK('c'), entityIndex, data: null });
    assert.deepEqual(rows.map((r) => r.entityId).sort(), ['eP', 'eWire']);
    assert.ok(rows.every((r) => r.sources === 0 && r.mentions === 1));
    // The case's own p-tag never becomes a row; unknown pubkeys are skipped.
    const stranger = buildCasePeople({ caseItems: [claimItem([PK('9')])], casePubkey: PK('c'), entityIndex, data: null });
    assert.equal(stranger.length, 0);
});

test('people: a claim ABOUT an entity on a member source counts that source (same presence rule as the case graph)', () => {
    const data = makeData({
        orbit: { claims: [{ id: 'c1', source_url: 'https://x/a', about: ['case1', 'eO'], source: null }], entities: [], dangling_entity_ids: [] }
    });
    const rows = buildCasePeople({ caseItems: [], casePubkey: PK('c'), entityIndex, data });
    const byId = Object.fromEntries(rows.map((r) => [r.entityId, r]));
    assert.equal(byId.eO.sources, 2, 'tagged on B, named by a claim on A');
});

test('people: pubkey resolution — local key, then foreign key, else null', () => {
    const rows = buildCasePeople({ caseItems: [], casePubkey: PK('c'), entityIndex, data: makeData() });
    const byId = Object.fromEntries(rows.map((r) => [r.entityId, r]));
    assert.equal(byId.eF.pubkey, PK('f'), 'foreign entity: its wire pubkey');
    assert.equal(byId.eRef.pubkey, null, 'keyless reference entity: no pubkey');
});

test('people: rows sort by sources desc, then published mentions desc, then name', () => {
    const items = [claimItem([PK('b')]), claimItem([PK('d')])];
    const rows = buildCasePeople({ caseItems: items, casePubkey: PK('c'), entityIndex, data: makeData() });
    assert.deepEqual(rows.map((r) => r.entityId), ['eP', 'eO', 'eF', 'eRef', 'eWire']);
    // eP: 3 sources; eO: 1 source + 1 mention; eF/eRef: 1 source, 0 mentions (alphabetical:
    // "Foreign Person" < "Reference Only"); eWire: 0 sources, 1 mention.
});

// ------------------------------------------------------------------
// Seam 2 — the rendered strings (read, not asserted-present)
// ------------------------------------------------------------------

test('people: chip label speaks ONE vocabulary — "sources" / "published claims" — never a bare count', () => {
    assert.equal(peopleChipLabel({ name: 'Dr P', sources: 3, mentions: 1 }), 'Dr P · 3 sources · 1 published claim');
    assert.equal(peopleChipLabel({ name: 'Institute', sources: 1, mentions: 0 }), 'Institute · 1 source');
    assert.equal(peopleChipLabel({ name: 'Wire Only', sources: 0, mentions: 2 }), 'Wire Only · 2 published claims');
    assert.doesNotMatch(peopleChipLabel({ name: 'X', sources: 2, mentions: 2 }), /·\s*\d+\s*(·|$)/,
        'a number must always carry its noun');
});

// A minimal DOM stub — enough for portal/dom.js `el` and the chip
// renderer. Behavior mirrors the DOM: createElement → node with
// className/textContent/title/type, appendChild, addEventListener
// (click handlers kept so the test can fire them). Stubbed per
// verification-engineer Standard 3 against MDN's Element/Node APIs.
function installDomStub() {
    const mk = (tag) => {
        const node = {
            tagName: tag.toUpperCase(), className: '', textContent: '', title: '', type: '',
            children: [], handlers: {}, parentElement: null,
            appendChild(c) { c.parentElement = node; node.children.push(c); return c; },
            addEventListener(ev, fn) { (node.handlers[ev] ||= []).push(fn); },
            click() { for (const fn of node.handlers.click || []) fn(); },
            get firstChild() { return node.children[0] || null; },
            removeChild(c) { node.children = node.children.filter((x) => x !== c); },
            remove() { if (node.parentElement) node.parentElement.removeChild(node); }
        };
        return node;
    };
    globalThis.document = { createElement: mk, createElementNS: (_ns, tag) => mk(tag) };
    return mk('div');
}
const walk = (node, out = []) => { out.push(node); for (const c of node.children) walk(c, out); return out; };

test('people: rendered chips — spokes for a keyed entity, dossier → for every local entity, a keyless entity degrades to a non-clickable name', () => {
    const host = installDomStub();
    const focused = [], dossiers = [];
    const rows = [
        { entityId: 'eP',   pubkey: PK('a'), name: 'Dr P', type: 'person', sources: 3, mentions: 1 },
        { entityId: 'eRef', pubkey: null,    name: 'Reference Only', type: 'person', sources: 1, mentions: 0 }
    ];
    renderCasePeople(host, rows, {
        callbacks: { onFocusEntity: (pk) => focused.push(pk), onOpenEntityDossier: (id) => dossiers.push(id) }
    });
    const nodes = walk(host);
    const chipP = nodes.find((n) => n.textContent === 'Dr P · 3 sources · 1 published claim');
    assert.ok(chipP, 'keyed entity chip renders with the full label');
    assert.equal(chipP.tagName, 'BUTTON');
    chipP.click();
    assert.deepEqual(focused, [PK('a')], 'the name chip opens the spokes graph by pubkey');

    const chipRef = nodes.find((n) => n.textContent === 'Reference Only · 1 source');
    assert.ok(chipRef, 'keyless entity still renders');
    assert.equal(chipRef.tagName, 'SPAN', 'no pubkey → no spokes graph to open → not a button');
    assert.ok(!/clickable/.test(chipRef.className));
    assert.match(chipRef.title, /dossier/i, 'the tooltip points at the affordance that DOES work');

    const dossierChips = nodes.filter((n) => n.textContent === 'dossier →');
    assert.equal(dossierChips.length, 2, 'every local entity gets a dossier link, keyed or not');
    dossierChips.forEach((c) => c.click());
    assert.deepEqual(dossiers.sort(), ['eP', 'eRef']);
});

// ------------------------------------------------------------------
// Seam 3 — the wiring: case-view passes the LOCAL data in
// ------------------------------------------------------------------

function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}
const CASE_VIEW = stripComments(readFileSync(new URL('../src/portal/case-view.js', import.meta.url), 'utf8'));

test('people: case-view builds the section through the shared builder AND hands it the local dossier data', () => {
    assert.match(CASE_VIEW, /from '\.\/case-people\.js'/, 'case-view must import the shared builder/renderer');
    const calls = [...CASE_VIEW.matchAll(/buildCasePeople\(\{([\s\S]*?)\}\)/g)];
    assert.ok(calls.length >= 1, 'case-view must call buildCasePeople');
    for (const c of calls) {
        for (const key of ['caseItems', 'casePubkey', 'entityIndex', 'data']) {
            assert.match(c[1], new RegExp(`\\b${key}\\b`), `buildCasePeople call must pass ${key}`);
        }
        assert.doesNotMatch(c[1], /data:\s*(null|undefined|\{\})/,
            'passing empty local data re-creates the relay-only section');
    }
    assert.match(CASE_VIEW, /renderCasePeople\(/, 'the chips must render through the shared renderer');
    // The old inline relay-only loop must not survive beside the builder.
    assert.doesNotMatch(CASE_VIEW, /const members = new Map\(\)/,
        'a second, relay-only people loop would reintroduce the split');
});

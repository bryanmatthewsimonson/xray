// portal/library.js tests — Phase 12.2 (docs/PORTAL_DESIGN.md).
//
// The Library item model is pure, so these tests drive it with
// hand-built events per kind: typeKey routing (including case-vs-entity
// via the local entity index), facet extraction, token-AND search, and
// the filter semantics the view leans on.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Parsers imported by library.js transitively touch Storage, which
// probes chrome.storage.local at module load.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const {
    buildItems, applyFilters, typeCounts, facetValues, isOtherClient,
    kindLabel, TYPE_DEFS, EMPTY_FILTERS, OUR_CLIENT_TAGS
} = await import('../src/portal/library.js');

const USER_PK = 'a'.repeat(64);
const CASE_PK = 'b'.repeat(64);
const PERSON_PK = 'c'.repeat(64);

const ENTITY_INDEX = {
    [CASE_PK]:   { entityId: 'entity_case000000000', name: 'Dehlin excommunication', type: 'case' },
    [PERSON_PK]: { entityId: 'entity_person0000000', name: 'John Dehlin', type: 'person' }
};

let nextId = 0;
function rec(kind, tags, content = '', createdAt = 1000) {
    return {
        event: { id: `ev${nextId++}`, kind, pubkey: USER_PK, created_at: createdAt, tags, content },
        relays: ['wss://relay-a.example']
    };
}

function corpus() {
    nextId = 0;
    return [
        rec(30023, [
            ['d', 'abc'], ['title', 'The Big Story'], ['r', 'https://example.substack.com/p/big'],
            ['platform', 'substack'], ['t', 'history'], ['client', 'xray'], ['p', CASE_PK, '', 'about']
        ], '# md', 500),
        rec(30040, [
            ['d', 'claim_1'], ['r', 'https://youtube.com/watch?v=x'], ['title', 'Video'],
            ['entity', 'John Dehlin', 'about'], ['p', PERSON_PK, '', 'about'], ['p', CASE_PK, '', 'about'],
            ['source', 'LDS Newsroom'], ['key', 'true'], ['client', 'xray']
        ], 'The church said X about him.', 900),
        rec(30041, [
            ['d', 'cmt:youtube:1'], ['r', 'https://youtube.com/watch?v=x'], ['title', 'Video'],
            ['comment-text', 'this aged badly'], ['comment-author', 'Watcher'], ['platform', 'youtube'],
            ['client', 'xray']
        ], 'this aged badly', 800),
        rec(30054, [
            ['d', 'assess:1'], ['a', `30040:${USER_PK}:claim_1`], ['r', 'https://youtube.com/watch?v=x'],
            ['stance', '-2'], ['L', 'xray/assessment'], ['l', 'misleading', 'xray/assessment'],
            ['p', CASE_PK, '', 'about'], ['client', 'xray']
        ], 'Contradicts the 2015 statement.', 700),
        rec(30055, [
            ['d', 'rel:1'], ['a', `30040:${USER_PK}:claim_1`, '', 'source'],
            ['a', `30040:${USER_PK}:claim_2`, '', 'target'], ['relationship', 'contradicts'],
            ['r', 'https://youtube.com/watch?v=x'], ['client', 'xray']
        ], 'They cannot both be true.', 600),
        rec(0, [], JSON.stringify({ name: 'Dehlin excommunication', about: 'Case profile' }), 400),
        rec(32126, [
            ['d', 'youtube:UC123'], ['p', 'd'.repeat(64), '', 'account'],
            ['account-platform', 'youtube'], ['account-id', 'UC123'],
            ['account-username', 'mormonstories'], ['client', 'xray']
        ], '', 300),
        rec(10002, [['r', 'wss://relay.damus.io'], ['r', 'wss://nos.lol']], '', 200),
        rec(30023, [
            ['d', 'hab'], ['title', 'Posted from Habla'], ['r', 'https://habla.news/a'],
            ['client', 'habla.news']
        ], '', 100)
    ];
}

// The kind-0 case profile is signed by the CASE entity's key.
function corpusWithCaseProfile() {
    const records = corpus();
    records[5].event.pubkey = CASE_PK;
    return records;
}

test('buildItems routes every corpus kind to its type, newest first', () => {
    const items = buildItems(corpusWithCaseProfile(), { entityIndex: ENTITY_INDEX });
    assert.deepEqual(items.map((i) => i.typeKey),
        ['claim', 'comment', 'assessment', 'link', 'article', 'case', 'account', 'other', 'article']);
    assert.deepEqual(items.map((i) => i.created_at),
        [900, 800, 700, 600, 500, 400, 300, 200, 100]);
});

test('a kind-0 profile is a case only when the local registry says so', () => {
    const asCase = buildItems(corpusWithCaseProfile(), { entityIndex: ENTITY_INDEX });
    assert.equal(asCase.find((i) => i.kind === 0).typeKey, 'case');
    // Same corpus, no local registry → plain entity profile.
    const asEntity = buildItems(corpusWithCaseProfile(), { entityIndex: {} });
    assert.equal(asEntity.find((i) => i.kind === 0).typeKey, 'entity');
});

test('case facet derives from p-tags ∩ local case entities', () => {
    const items = buildItems(corpusWithCaseProfile(), { entityIndex: ENTITY_INDEX });
    const inCase = items.filter((i) => i.cases.includes('Dehlin excommunication'));
    assert.deepEqual(inCase.map((i) => i.typeKey).sort(),
        ['article', 'assessment', 'case', 'claim']);
    // The person p-tag does NOT create a case facet.
    const claim = items.find((i) => i.typeKey === 'claim');
    assert.deepEqual(claim.cases, ['Dehlin excommunication']);
});

test('claim items carry entity names, source, and key-claim in the haystack', () => {
    const items = buildItems(corpus(), { entityIndex: ENTITY_INDEX });
    const claim = items.find((i) => i.typeKey === 'claim');
    assert.match(claim.sub, /LDS Newsroom/);
    assert.match(claim.sub, /John Dehlin/);
    assert.match(claim.sub, /key claim/);
    assert.ok(claim.searchText.includes('john dehlin'));
});

test('search is token-AND over the haystack', () => {
    const items = buildItems(corpus(), { entityIndex: ENTITY_INDEX });
    // 'dehlin' hits the claim (entity name) AND the profile (JSON name).
    assert.equal(applyFilters(items, { query: 'dehlin' }).length, 2);
    assert.equal(applyFilters(items, { query: 'dehlin church' }).length, 1);
    assert.equal(applyFilters(items, { query: 'dehlin zebra' }).length, 0);
    assert.equal(applyFilters(items, { query: '  ' }).length, items.length);
});

test('filters: type, platform, domain, case, client', () => {
    const items = buildItems(corpusWithCaseProfile(), { entityIndex: ENTITY_INDEX });
    assert.equal(applyFilters(items, { type: 'comment' }).length, 1);
    assert.equal(applyFilters(items, { platform: 'youtube' }).length, 2); // comment + account
    assert.equal(applyFilters(items, { domain: 'youtube.com' }).length, 4); // claim + comment + assessment + link
    assert.equal(applyFilters(items, { caseName: 'Dehlin excommunication' }).length, 4);
    const other = applyFilters(items, { client: 'other' });
    assert.deepEqual(other.map((i) => i.title), ['Posted from Habla']);
    // 'ours' keeps untagged events (no client tag ≠ foreign client).
    assert.equal(applyFilters(items, { client: 'ours' }).length, items.length - 1);
});

test('typeCounts and facetValues drive the tab badges and selects', () => {
    const items = buildItems(corpusWithCaseProfile(), { entityIndex: ENTITY_INDEX });
    const counts = typeCounts(items);
    assert.equal(counts.all, items.length);
    assert.equal(counts.article, 2);
    assert.equal(counts.case, 1);
    assert.equal(counts.other, 1); // the 10002 relay list

    const domains = facetValues(items, 'domain');
    assert.equal(domains[0].value, 'youtube.com');
    assert.ok(domains[0].count >= 3);
    const cases = facetValues(items, 'cases');
    assert.deepEqual(cases, [{ value: 'Dehlin excommunication', count: 4 }]);
});

test('isOtherClient: badge only when a client tag exists and is not ours', () => {
    const items = buildItems(corpus(), { entityIndex: {} });
    const habla = items.find((i) => i.client === 'habla.news');
    const relayList = items.find((i) => i.kind === 10002); // no client tag
    assert.equal(isOtherClient(habla), true);
    assert.equal(isOtherClient(relayList), false);
    assert.ok(OUR_CLIENT_TAGS.has('xray') && OUR_CLIENT_TAGS.has('nostr-article-capture'));
});

test('EMPTY_FILTERS and TYPE_DEFS are pinned', () => {
    assert.deepEqual(EMPTY_FILTERS,
        { type: 'all', platform: '', domain: '', caseName: '', client: 'all', query: '', after: 0, before: 0 });
    assert.deepEqual(TYPE_DEFS.map((d) => d.key),
        ['article', 'claim', 'comment', 'assessment', 'link', 'entity', 'case', 'account', 'other']);
    assert.equal(kindLabel(30040), 'Claim');
    assert.equal(kindLabel(12345), 'kind 12345');
});

test('malformed events degrade to other-typed generic items, never vanish', () => {
    const broken = [
        rec(30041, [['d', 'x']], ''),                       // textless comment
        rec(30054, [['d', 'assess:x']], 'no a tag'),        // assessment without coordinate
        rec(0, [], 'not json at all')
    ];
    const items = buildItems(broken, { entityIndex: {} });
    assert.equal(items.length, 3);
    for (const item of items) assert.ok(item.title.length > 0);
    assert.deepEqual(items.map((i) => i.typeKey).sort(), ['entity', 'other', 'other']);
});

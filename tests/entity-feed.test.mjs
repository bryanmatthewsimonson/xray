// Entity network feed tests — Knowledge Sharing KS.4 (read layer).
//
// Pure helpers: filter shapes, claim-coordinate extraction, and the
// per-kind assembly incl. latest-per-coordinate dedup, malformed-event
// drops, author counts, two-hop verdict classification, and
// adopt-on-sight candidate discovery.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const _store = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) { const o = {}; for (const k of (Array.isArray(keys) ? keys : [keys])) if (_store.has(k)) o[k] = _store.get(k); cb(o); },
            set(obj, cb) { for (const [k, v] of Object.entries(obj)) _store.set(k, v); cb && cb(); },
            remove(keys, cb) { for (const k of (Array.isArray(keys) ? keys : [keys])) _store.delete(k); cb && cb(); }
        }
    }
};

const { FEED_HOP1_KINDS, FEED_HOP2_KINDS, buildFeedFilters, claimCoords, buildJudgmentFilter, assembleFeed } =
    await import('../src/shared/entity-feed.js');
const { buildAdjudicatedVerdictEvent } = await import('../src/shared/truth-builders.js');

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);
const ENTITY_PK = 'e'.repeat(64);

let _id = 0;
function ev(kind, tags, over = {}) {
    _id++;
    return {
        id: String(_id).padStart(64, '0'),
        pubkey: PK_A,
        kind,
        tags,
        content: '',
        created_at: 1700000000 + _id,
        ...over
    };
}

test('buildFeedFilters: one #p filter over the hop-1 kinds', () => {
    const [f] = buildFeedFilters([ENTITY_PK, ENTITY_PK, null]);
    assert.deepEqual(f.kinds, FEED_HOP1_KINDS);
    assert.deepEqual(f['#p'], [ENTITY_PK]);
    assert.equal(typeof f.limit, 'number');
    assert.deepEqual(buildFeedFilters([]), []);
});

test('claimCoords: coordinates from 30040s, deduped + capped', () => {
    const claims = [
        ev(30040, [['d', 'claim_1']]),
        ev(30040, [['d', 'claim_1']]),                    // replaceable dup
        ev(30040, [['d', 'claim_2']], { pubkey: PK_B }),
        ev(30040, []),                                    // no d → skipped
        ev(30023, [['d', 'not-a-claim']])                 // wrong kind
    ];
    const coords = claimCoords(claims);
    assert.deepEqual(new Set(coords), new Set([
        `30040:${PK_A}:claim_1`, `30040:${PK_B}:claim_2`
    ]));
    assert.equal(claimCoords(claims, { cap: 1 }).length, 1);
});

test('buildJudgmentFilter: #a over the hop-2 kinds; null when empty', () => {
    const f = buildJudgmentFilter(['30040:x:y']);
    assert.deepEqual(f.kinds, FEED_HOP2_KINDS);
    assert.deepEqual(f['#a'], ['30040:x:y']);
    assert.equal(buildJudgmentFilter([]), null);
});

test('assembleFeed: groups per kind', async () => {
    const article = ev(30023, [['title', 'T'], ['r', 'https://example.com/a'], ['x', 'f'.repeat(64)]]);
    const claim = ev(30040, [['d', 'claim_1'], ['claim-text', 'A said B'], ['r', 'https://example.com/a']]);
    const account = ev(32126, [['d', 'twitter:jane'], ['account-platform', 'twitter'],
        ['p', 'c'.repeat(64), '', 'account'], ['p', ENTITY_PK, '', 'linked-entity']]);
    const assessment = ev(30054, [['d', 'assess_1'], ['a', `30040:${PK_A}:claim_1`], ['stance', '1']]);
    const link = ev(30055, [['d', 'rel_1'], ['relationship', 'contradicts'],
        ['a', '30040:x:1', '', 'source'], ['a', '30040:x:2', '', 'target']]);
    const label = ev(1985, [['L', 'xray/assessment'], ['l', 'misleading', 'xray/assessment'], ['a', `30040:${PK_A}:claim_1`]]);

    const feed = assembleFeed([article, claim, account, assessment, link, label]);
    assert.equal(feed.articles.length, 1);
    assert.equal(feed.claims.length, 1);
    assert.equal(feed.accounts.length, 1);
    assert.equal(feed.assessments.length, 1);
    assert.equal(feed.links.length, 1);
    assert.equal(feed.labels.length, 1);

    assert.equal(feed.articles[0].parsed.title, 'T');
    assert.equal(feed.articles[0].parsed.hash, 'f'.repeat(64));
    assert.equal(feed.accounts[0].parsed.linkedEntityPubkey, ENTITY_PK);
    assert.equal(feed.claims[0].coord, `30040:${PK_A}:claim_1`);
});

test('assembleFeed: latest-per-coordinate wins', () => {
    const older = ev(30040, [['d', 'claim_1'], ['claim-text', 'old']]);
    const newer = ev(30040, [['d', 'claim_1'], ['claim-text', 'new']]);
    newer.created_at = older.created_at + 100;
    const feed = assembleFeed([older, newer]);
    assert.equal(feed.claims.length, 1);
    assert.equal(feed.claims[0].parsed.text, 'new');
});

test('assembleFeed: malformed events drop, valid siblings survive', () => {
    const bad54 = ev(30054, [['d', 'assess_x']]);          // no `a` → parser nulls
    const good = ev(30040, [['d', 'claim_1'], ['claim-text', 'fine']]);
    const junk = { kind: 30054 };                          // no pubkey
    const feed = assembleFeed([bad54, good, junk, null]);
    assert.equal(feed.assessments.length, 0);
    assert.equal(feed.claims.length, 1);
});

test('assembleFeed: author counts span hops', () => {
    const a1 = ev(30040, [['d', 'c1'], ['claim-text', 'x']]);
    const a2 = ev(30023, [['title', 'T'], ['r', 'https://e.com']]);
    const b1 = ev(30040, [['d', 'c2'], ['claim-text', 'y']], { pubkey: PK_B });
    const feed = assembleFeed([a1, a2], [b1]);
    assert.equal(feed.authors.get(PK_A), 2);
    assert.equal(feed.authors.get(PK_B), 1);
});

test('assembleFeed: hop-2 verdicts classify into verdicts', async () => {
    const { event } = await buildAdjudicatedVerdictEvent({
        claimCoord: `30040:${PK_B}:claim_9`,
        propositionClass: 'event-fact',
        verdict: 'established-true',
        standardOfProof: 'preponderance',
        resolutionCriteria: { criteria: 'The official record.' },
        subjectRole: 'enacted',
        evidenceFor: [{ quote: 'Roll-call 71: Nay.', tier: 'tier-1', url: 'https://example.gov/71' }],
        caveats: ['Could not verify a later motion.'],
        method: 'manual record check',
        rationale: 'Cross-checked.',
        sourceUrl: 'https://example.com/article'
    });
    const verdictEv = { ...event, id: '9'.repeat(64), pubkey: PK_B };
    const feed = assembleFeed([], [verdictEv]);
    assert.equal(feed.verdicts.length, 1);
    assert.equal(feed.verdicts[0].parsed.verdict, 'established-true');
    assert.equal(feed.verdicts[0].parsed.standardOfProof, 'preponderance');
});

test('assembleFeed: adopt candidates = unknown entity-ish pubkeys only', () => {
    const knownEntity = ENTITY_PK;
    const unknownEntity = 'd'.repeat(64);
    const accountPk = 'c'.repeat(64);
    const claim = ev(30040, [
        ['d', 'c1'], ['claim-text', 'x'],
        ['p', knownEntity, '', 'about'],
        ['p', unknownEntity, '', 'about']
    ]);
    const article = ev(30023, [
        ['title', 'T'], ['r', 'https://e.com'],
        ['p', accountPk, '', 'author'],          // authorship role → never a candidate
        ['p', unknownEntity, '', 'about']
    ]);
    const feed = assembleFeed([claim, article], [], { knownPubkeys: [knownEntity] });
    assert.equal(feed.candidates.length, 1);
    assert.equal(feed.candidates[0].pubkey, unknownEntity);
    assert.equal(feed.candidates[0].count, 2);
    assert.deepEqual(feed.candidates[0].roles, ['about']);
});

test('assembleFeed: empty input → empty groups', () => {
    const feed = assembleFeed([], []);
    assert.equal(feed.claims.length + feed.articles.length + feed.verdicts.length, 0);
    assert.deepEqual(feed.candidates, []);
    assert.equal(feed.authors.size, 0);
});

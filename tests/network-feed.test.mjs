// Network follows-feed tests — Phase 25.2a (the KS §5 authors axis;
// docs/NETWORK_CLIENT_DESIGN.md §3–§4). Kinds pin, filter shapes,
// trust bucketing (incl. the evil-relay collapse), newest-first
// no-ranking order, per-author cap, provenance-propagation marker,
// and shared-parser parity with the entity feed.

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

const { NETWORK_FEED_KINDS, AUTHOR_ITEM_CAP, buildAuthorFilters, assembleNetworkFeed } =
    await import('../src/shared/network-feed.js');
const { parseFeedEvent } = await import('../src/shared/entity-feed.js');

const SELF = 'c'.repeat(64);
const FOLLOWED = 'f'.repeat(64);
const FOLLOWED_2 = 'e'.repeat(64);
const STRANGER = 'a'.repeat(64);

let _id = 0;
function ev(kind, tags, over = {}) {
    _id++;
    return {
        id: String(_id).padStart(64, '0'),
        pubkey: FOLLOWED,
        kind,
        tags,
        content: '',
        created_at: 1700000000 + _id,
        ...over
    };
}

function article(over = {}) {
    return ev(30023, [['d', `art-${_id + 1}`], ['title', 'T'], ['r', 'https://x.example/a']], over);
}

// ------------------------------------------------------------------
// Pins
// ------------------------------------------------------------------

test('NETWORK_FEED_KINDS is pinned exactly', () => {
    assert.deepEqual([...NETWORK_FEED_KINDS], [30023, 30040, 30054, 30055, 30062, 30063, 30064, 30068, 32126, 1985]);
});

test('AUTHOR_ITEM_CAP is pinned', () => {
    assert.equal(AUTHOR_ITEM_CAP, 100);
});

// ------------------------------------------------------------------
// Filters
// ------------------------------------------------------------------

test('buildAuthorFilters: dedicated claims filter + the rest, authors deduped/validated', () => {
    const filters = buildAuthorFilters([FOLLOWED, FOLLOWED.toUpperCase(), 'garbage', null, FOLLOWED_2]);
    assert.equal(filters.length, 2);
    assert.deepEqual(filters[0].kinds, [30040]);
    assert.deepEqual(filters[0].authors, [FOLLOWED, FOLLOWED_2]);
    assert.ok(!filters[1].kinds.includes(30040));
    assert.deepEqual(filters[1].kinds, NETWORK_FEED_KINDS.filter((k) => k !== 30040));
    assert.deepEqual(filters[1].authors, [FOLLOWED, FOLLOWED_2]);
    assert.deepEqual(buildAuthorFilters([]), []);
    assert.deepEqual(buildAuthorFilters(['nope']), []);
});

// ------------------------------------------------------------------
// Assembly — bucketing and the evil-relay collapse
// ------------------------------------------------------------------

test('followed and self items are rows; strangers collapse to counts', () => {
    const feed = assembleNetworkFeed([
        article(),
        article({ pubkey: SELF }),
        article({ pubkey: STRANGER }),
        ev(30040, [['d', 'c1'], ['claim', 'X said Y']], { pubkey: STRANGER })
    ], { followedPubkeys: [FOLLOWED], selfPubkeys: [SELF] });

    assert.equal(feed.items.length, 2);
    assert.deepEqual(feed.items.map((i) => i.bucket).sort(), ['followed', 'self']);
    // The stranger's events never appear as rows — the authors-axis
    // filter didn't ask for them (unsolicited relay data).
    assert.ok(feed.items.every((i) => i.author !== STRANGER));
    assert.equal(feed.collapsed.length, 1);
    assert.equal(feed.collapsed[0].pubkey, STRANGER);
    assert.equal(feed.collapsed[0].count, 2);
    assert.deepEqual(feed.collapsed[0].kinds, { 30023: 1, 30040: 1 });
});

test('items are strictly newest-first — no other ordering exists', () => {
    const a = article();                       // oldest
    const b = article({ pubkey: FOLLOWED_2 });
    const c = article();                       // newest
    const feed = assembleNetworkFeed([a, b, c], { followedPubkeys: [FOLLOWED, FOLLOWED_2] });
    assert.deepEqual(feed.items.map((i) => i.event.id), [c.id, b.id, a.id]);
});

test('id-level and replaceable dedup both run', () => {
    const a = article();
    const newer = { ...a, id: 'ff'.repeat(32), created_at: a.created_at + 10 };
    const feed = assembleNetworkFeed([a, a, newer], { followedPubkeys: [FOLLOWED] });
    // Same d-coordinate → replaceable dedup keeps only the newest.
    assert.equal(feed.items.length, 1);
    assert.equal(feed.items[0].event.id, newer.id);
});

test('per-author cap keeps the newest items and reports the drop', () => {
    const events = [];
    for (let i = 0; i < AUTHOR_ITEM_CAP + 5; i++) events.push(article());
    const newest = events[events.length - 1];
    const feed = assembleNetworkFeed(events, { followedPubkeys: [FOLLOWED] });
    assert.equal(feed.items.length, AUTHOR_ITEM_CAP);
    assert.equal(feed.items[0].event.id, newest.id);
    assert.deepEqual(feed.capped, [{ pubkey: FOLLOWED, dropped: 5 }]);
});

test('malformed and unknown-kind events drop', () => {
    const feed = assembleNetworkFeed([
        ev(30068, [['d', 'xray-brief:x']], { content: '{not json' }),  // brief with broken payload → parser nulls
        ev(12345, [['d', 'x']]),                                       // unknown kind
        article()
    ], { followedPubkeys: [FOLLOWED] });
    assert.equal(feed.items.length, 1);
    assert.equal(feed.items[0].key, 'articles');
});

// ------------------------------------------------------------------
// Provenance propagation (TC §3.3)
// ------------------------------------------------------------------

test('buildsOnUnfollowed marks a-refs outside self+follows', () => {
    const onTrusted = ev(30054, [['d', 'a1'], ['a', `30040:${FOLLOWED}:c1`], ['stance', 'corroborates']]);
    const onStranger = ev(30054, [['d', 'a2'], ['a', `30040:${STRANGER}:c9`], ['stance', 'disputes']]);
    const feed = assembleNetworkFeed([onTrusted, onStranger], { followedPubkeys: [FOLLOWED], selfPubkeys: [SELF] });
    const byCoord = Object.fromEntries(feed.items.map((i) => [i.coord, i.buildsOnUnfollowed]));
    assert.equal(byCoord[`30054:${FOLLOWED}:a1`], false);
    assert.equal(byCoord[`30054:${FOLLOWED}:a2`], true);
});

// ------------------------------------------------------------------
// Verdicts arrive first-class on this axis (amended KS §12.2)
// ------------------------------------------------------------------

test('a followee 30063 verdict is a first-class row', async () => {
    const { buildAdjudicatedVerdictEvent } = await import('../src/shared/truth-builders.js');
    const { event } = await buildAdjudicatedVerdictEvent({
        claimCoord: `30040:${FOLLOWED}:claim_9`,
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
    const verdictEv = { ...event, id: '9'.repeat(64), pubkey: FOLLOWED, created_at: 1700009999 };
    const feed = assembleNetworkFeed([verdictEv], { followedPubkeys: [FOLLOWED] });
    assert.equal(feed.items.length, 1);
    assert.equal(feed.items[0].key, 'verdicts');
    assert.equal(feed.items[0].bucket, 'followed');
    assert.equal(feed.items[0].parsed.verdict, 'established-true');
});

// ------------------------------------------------------------------
// Shared-parser parity: same event, same parsed row in both feeds
// ------------------------------------------------------------------

test('parseFeedEvent parity: network rows reuse the entity-feed dispatch', () => {
    const a = article();
    const viaShared = parseFeedEvent(a);
    const feed = assembleNetworkFeed([a], { followedPubkeys: [FOLLOWED] });
    assert.equal(feed.items[0].key, viaShared.key);
    assert.deepEqual(feed.items[0].parsed, viaShared.parsed);
});

// ------------------------------------------------------------------
// Candidates (adopt-on-sight substrate for 25.2b)
// ------------------------------------------------------------------

test('entity-ish p-tags on followed items surface as candidates', () => {
    const subject = 'b'.repeat(64);
    const feed = assembleNetworkFeed([
        ev(30040, [['d', 'c1'], ['claim', 'X'], ['p', subject, '', 'about']])
    ], { followedPubkeys: [FOLLOWED] });
    assert.equal(feed.candidates.length, 1);
    assert.equal(feed.candidates[0].pubkey, subject);
});

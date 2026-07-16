// network-trust.js tests — Phase 25.7 (KS.8: the trust graph as a
// reader-side feed filter). The local registry is the graph's
// contact list; the filter narrows and never reorders; FoF counts
// are discovery, never ranking.

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

const { synthesizeContactList, buildReaderGraph, followedByCounts, filterFeedByTrust } =
    await import('../src/shared/network-trust.js');
const { assembleNetworkFeed } = await import('../src/shared/network-feed.js');
const { trustedAuthors } = await import('../src/shared/metadata/trust-graph.js');

const ME = 'c'.repeat(64);
const FOLLOWED = 'f'.repeat(64);
const FOLLOWED_2 = 'e'.repeat(64);
const STRANGER = 'a'.repeat(64);
const STRANGER_2 = 'b'.repeat(64);

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
// Graph seeding — the LOCAL registry is primary
// ------------------------------------------------------------------

test('synthesizeContactList: registry entries → NIP-02 shape; garbage drops', () => {
    const cl = synthesizeContactList([
        { pubkey: FOLLOWED }, { pubkey: FOLLOWED_2.toUpperCase() }, { pubkey: 'nope' }, null
    ], ME);
    assert.equal(cl.kind, 3);
    assert.deepEqual(cl.tags, [['p', FOLLOWED], ['p', FOLLOWED_2]]);
});

test('buildReaderGraph: follows land in firstOrderFollows / trustedAuthors', () => {
    const graph = buildReaderGraph({ ownerPubkey: ME, followEntries: [{ pubkey: FOLLOWED }] });
    assert.ok(graph.firstOrderFollows.has(FOLLOWED));
    assert.ok(trustedAuthors(graph).has(FOLLOWED));
    assert.ok(!trustedAuthors(graph).has(STRANGER));
});

// ------------------------------------------------------------------
// FoF counts — discovery, never ranking
// ------------------------------------------------------------------

test('followedByCounts: distinct follows counted once each; unknown keys only', () => {
    const k3 = (author, follows) => ({ kind: 3, pubkey: author, tags: follows.map((p) => ['p', p]), content: '' });
    const counts = followedByCounts([STRANGER, STRANGER_2], [
        k3(FOLLOWED, [STRANGER, STRANGER, ME]),          // dupe p counted once
        k3(FOLLOWED_2, [STRANGER]),
        k3(FOLLOWED_2, [STRANGER_2]),                     // second list from the same author ignored
        { kind: 10002, pubkey: 'x', tags: [['p', STRANGER]] }   // wrong kind ignored
    ]);
    assert.equal(counts.get(STRANGER), 2);
    assert.equal(counts.get(STRANGER_2), undefined);
    assert.equal(counts.get(ME), undefined);              // not asked about
});

// ------------------------------------------------------------------
// The narrow-only filter
// ------------------------------------------------------------------

test('filterFeedByTrust: hides builds-on-unfollowed + the collapsed strip; keeps order', () => {
    const clean = article();
    const dirty = ev(30054, [['d', 'a1'], ['a', `30040:${STRANGER}:c9`], ['stance', '1']]);
    const newest = article();
    const feed = assembleNetworkFeed([clean, dirty, newest, article({ pubkey: STRANGER })],
        { followedPubkeys: [FOLLOWED], selfPubkeys: [ME] });
    assert.equal(feed.items.length, 3);
    assert.equal(feed.collapsed.length, 1);

    const graph = buildReaderGraph({ ownerPubkey: ME, followEntries: [{ pubkey: FOLLOWED }] });
    const { feed: narrowed, hiddenItems, hiddenAuthors } = filterFeedByTrust(feed, graph);
    assert.equal(hiddenItems, 1);                        // the builds-on-stranger assessment
    assert.equal(hiddenAuthors, 1);                      // the collapsed stranger
    assert.deepEqual(narrowed.collapsed, []);
    // Order preserved: still newest-first, untouched relative order.
    assert.deepEqual(narrowed.items.map((i) => i.event.id), [newest.id, clean.id]);
});

test('filterFeedByTrust never drops self items', () => {
    const mine = article({ pubkey: ME });
    const feed = assembleNetworkFeed([mine], { followedPubkeys: [FOLLOWED], selfPubkeys: [ME] });
    const graph = buildReaderGraph({ ownerPubkey: ME, followEntries: [] });
    const { feed: narrowed } = filterFeedByTrust(feed, graph);
    assert.equal(narrowed.items.length, 1);
    assert.equal(narrowed.items[0].bucket, 'self');
});

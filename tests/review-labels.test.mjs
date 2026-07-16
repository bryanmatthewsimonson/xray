// Review-request labels + queue tests — Phase 25.4 (KS.6 / TC §5).
// Vocabulary pin, build/parse round-trip, the no-`p` rule, and the
// pure review-queue assembly (inbound joins + open/closed requests).

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

const { REVIEW_LABEL_NAMESPACE, REVIEW_LABEL_VALUES, buildReviewRequestLabelEvent, parseReviewLabelEvent } =
    await import('../src/shared/metadata/builders.js');
const { assembleReviewQueue } = await import('../src/shared/review-queue.js');
const { assembleNetworkFeed } = await import('../src/shared/network-feed.js');

const ME = 'c'.repeat(64);
const FOLLOWED = 'f'.repeat(64);
const COORD_MINE = `30040:${ME}:claim_1`;
const COORD_THEIRS = `30040:${FOLLOWED}:claim_9`;

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

function reviewLabel(value, target, over = {}) {
    return ev(1985, [
        ['L', REVIEW_LABEL_NAMESPACE],
        ['l', value, REVIEW_LABEL_NAMESPACE],
        ['a', target]
    ], over);
}

// ------------------------------------------------------------------
// Vocabulary + builder
// ------------------------------------------------------------------

test('REVIEW_LABEL_VALUES is pinned exactly', () => {
    assert.equal(REVIEW_LABEL_NAMESPACE, 'xray/review');
    assert.deepEqual([...REVIEW_LABEL_VALUES], ['review-requested', 'review-done']);
});

test('build/parse round-trip; never a p tag', () => {
    const { event } = buildReviewRequestLabelEvent({
        value: 'review-requested',
        targetCoord: COORD_MINE,
        targetEventId: 'e'.repeat(64),
        url: 'https://x.example/a'
    });
    assert.equal(event.kind, 1985);
    assert.ok(!event.tags.some((t) => t[0] === 'p'), 'a p on a 1985 would label the AUTHOR');
    const parsed = parseReviewLabelEvent({ ...event, pubkey: ME });
    assert.equal(parsed.value, 'review-requested');
    assert.equal(parsed.targetCoord, COORD_MINE);
    assert.equal(parsed.targetEventId, 'e'.repeat(64));
    assert.equal(parsed.url, 'https://x.example/a');
});

test('builder rejects unknown values and malformed coordinates', () => {
    assert.throws(() => buildReviewRequestLabelEvent({ value: 'review-maybe', targetCoord: COORD_MINE }), /value must be one of/);
    assert.throws(() => buildReviewRequestLabelEvent({ value: 'review-done', targetCoord: 'not-a-coord' }), /coordinate/);
});

test('parseReviewLabelEvent nulls on other namespaces and missing targets', () => {
    const other = ev(1985, [['L', 'xray/assessment'], ['l', 'unsupported', 'xray/assessment'], ['a', COORD_MINE]]);
    assert.equal(parseReviewLabelEvent(other), null);
    const noTarget = ev(1985, [['L', REVIEW_LABEL_NAMESPACE], ['l', 'review-requested', REVIEW_LABEL_NAMESPACE]]);
    assert.equal(parseReviewLabelEvent(noTarget), null);
});

// ------------------------------------------------------------------
// Queue assembly
// ------------------------------------------------------------------

function feedOf(events) {
    return assembleNetworkFeed(events, { followedPubkeys: [FOLLOWED], selfPubkeys: [ME] });
}

test('inbound review: followee judgments targeting MY coordinates', () => {
    const onMine = ev(30054, [['d', 'a1'], ['a', COORD_MINE], ['stance', '1']]);
    const onTheirs = ev(30054, [['d', 'a2'], ['a', COORD_THEIRS], ['stance', '1']]);
    const feed = feedOf([onMine, onTheirs]);
    const { inbound } = assembleReviewQueue(feed, { myCoords: [COORD_MINE] });
    assert.equal(inbound.length, 1);
    assert.equal(inbound[0].coord, `30054:${FOLLOWED}:a1`);
});

test('open requests: requested without a newer done; done closes; re-request re-opens', () => {
    // Request → open.
    let feed = feedOf([reviewLabel('review-requested', COORD_THEIRS)]);
    let q = assembleReviewQueue(feed, {});
    assert.equal(q.openRequests.length, 1);
    assert.equal(q.openRequests[0].targetCoord, COORD_THEIRS);
    assert.equal(q.openRequests[0].requestedBy, FOLLOWED);

    // Request then done → closed.
    feed = feedOf([reviewLabel('review-requested', COORD_THEIRS), reviewLabel('review-done', COORD_THEIRS)]);
    q = assembleReviewQueue(feed, {});
    assert.equal(q.openRequests.length, 0);

    // Done then a NEWER request → open again.
    feed = feedOf([
        reviewLabel('review-done', COORD_THEIRS),
        reviewLabel('review-requested', COORD_THEIRS)
    ]);
    q = assembleReviewQueue(feed, {});
    assert.equal(q.openRequests.length, 1);
});

test('assembly is pure: no storage writes', () => {
    const before = [..._store.keys()].sort();
    const feed = feedOf([reviewLabel('review-requested', COORD_THEIRS)]);
    assembleReviewQueue(feed, { myCoords: [COORD_MINE] });
    assert.deepEqual([..._store.keys()].sort(), before);
});

test('flag default: reviewCoordination ships off', async () => {
    const { FLAGS_DEFAULTS } = await import('../src/shared/metadata/feature-flags.js');
    assert.equal(FLAGS_DEFAULTS.reviewCoordination, false);
});

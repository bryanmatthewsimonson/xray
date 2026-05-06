// Metadata builders tests — Phase 9a Day 5.
//
// Covers all five builders + the responds-to tag helper. Each builder
// is verified for:
//   - tag shape (NIP-22/NIP-73 anchor tags + builder-specific tags)
//   - deterministic d-tag (same inputs → same d-tag)
//   - URL normalization on inputs
//   - argument validation

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  buildAnnotationEvent,
  buildFactCheckEvent,
  buildRatingEvent,
  buildHelpfulnessEvent,
  buildRespondsToTag,
  RESPONDS_TO_RELATIONSHIPS
} = await import('../src/shared/metadata/builders.js');
const { buildTopicTrustEvent } = await import('../src/shared/metadata/topic-trust-builder.js');

const URL = 'https://example.com/article';
const TARGET_PUBKEY = 'a'.repeat(64);

// ------------------------------------------------------------------
// Annotation — kind 30050
// ------------------------------------------------------------------

test('annotation: kind 30050 with anchor tags + motivation + lang', async () => {
  const out = await buildAnnotationEvent({
    url: URL,
    motivation: 'rebutting',
    bodyMarkdown: 'Counter-argument here.',
    selectors: [{ type: 'TextQuoteSelector', exact: 'foo' }],
    topic: 'bitcoin',
    lang: 'en',
    createdAt: 1700000000
  });
  assert.equal(out.event.kind, 30050);
  assert.equal(out.event.created_at, 1700000000);
  // Required NIP-73 anchor pattern: r/i/k=web/I/K=web
  const tagMap = tagsAsMap(out.event.tags);
  assert.equal(tagMap.r[0], URL);
  assert.equal(tagMap.i[0], URL);
  assert.equal(tagMap.k[0], 'web');
  assert.equal(tagMap.I[0], URL);
  assert.equal(tagMap.K[0], 'web');
  assert.equal(tagMap.motivation[0], 'rebutting');
  assert.equal(tagMap.t[0], 'bitcoin');
  assert.equal(tagMap.lang[0], 'en');
  assert.match(tagMap.d[0], /^ann:[0-9a-f]{16}$/);
});

test('annotation: deterministic d-tag (same inputs → same d-tag)', async () => {
  const args = {
    url: URL,
    motivation: 'commenting',
    bodyMarkdown: 'A',
    selectors: [{ type: 'TextQuoteSelector', exact: 'foo' }]
  };
  const a = await buildAnnotationEvent(args);
  const b = await buildAnnotationEvent(args);
  assert.equal(a.dTag, b.dTag);
});

test('annotation: d-tag changes when selector changes', async () => {
  const a = await buildAnnotationEvent({
    url: URL, motivation: 'commenting', bodyMarkdown: 'x',
    selectors: [{ type: 'TextQuoteSelector', exact: 'foo' }]
  });
  const b = await buildAnnotationEvent({
    url: URL, motivation: 'commenting', bodyMarkdown: 'x',
    selectors: [{ type: 'TextQuoteSelector', exact: 'bar' }]
  });
  assert.notEqual(a.dTag, b.dTag);
});

test('annotation: d-tag stable across body edits (replaceable semantics)', async () => {
  const a = await buildAnnotationEvent({
    url: URL, motivation: 'commenting', bodyMarkdown: 'first draft',
    selectors: [{ type: 'TextQuoteSelector', exact: 'foo' }]
  });
  const b = await buildAnnotationEvent({
    url: URL, motivation: 'commenting', bodyMarkdown: 'second draft',
    selectors: [{ type: 'TextQuoteSelector', exact: 'foo' }]
  });
  assert.equal(a.dTag, b.dTag);
});

test('annotation: URL normalization runs (UTM stripped + host lowercased)', async () => {
  const out = await buildAnnotationEvent({
    url: 'HTTPS://Example.COM/article?utm_source=foo&id=5',
    motivation: 'commenting',
    bodyMarkdown: 'x'
  });
  const tagMap = tagsAsMap(out.event.tags);
  assert.equal(tagMap.r[0], 'https://example.com/article?id=5');
  assert.equal(tagMap.i[0], 'https://example.com/article?id=5');
});

test('annotation: multiple motivations supported', async () => {
  const out = await buildAnnotationEvent({
    url: URL,
    motivation: 'correcting',
    motivations: ['contextualizing'],
    bodyMarkdown: 'x'
  });
  const motivationTags = out.event.tags.filter((t) => t[0] === 'motivation');
  assert.deepEqual(motivationTags.map((t) => t[1]).sort(), ['contextualizing', 'correcting']);
});

test('annotation: respondsToArticleAddress emits `a` tag', async () => {
  const out = await buildAnnotationEvent({
    url: URL,
    motivation: 'responding-to',
    bodyMarkdown: 'see my response',
    respondsToArticleAddress: '30023:abc:my-slug'
  });
  const tagMap = tagsAsMap(out.event.tags);
  assert.equal(tagMap.a[0], '30023:abc:my-slug');
});

test('annotation: targetEvent emits `e` tag with relay hint', async () => {
  const out = await buildAnnotationEvent({
    url: URL,
    motivation: 'commenting',
    bodyMarkdown: 'x',
    targetEvent: { id: 'event123', relayHint: 'wss://relay.example' }
  });
  const eTag = out.event.tags.find((t) => t[0] === 'e');
  assert.deepEqual(eTag, ['e', 'event123', 'wss://relay.example']);
});

test('annotation: body content is JSON-LD with anno + xray contexts', async () => {
  const out = await buildAnnotationEvent({
    url: URL,
    motivation: 'commenting',
    bodyMarkdown: 'Hello',
    selectors: [{ type: 'TextQuoteSelector', exact: 'world' }]
  });
  const body = JSON.parse(out.event.content);
  assert.deepEqual(body['@context'], [
    'http://www.w3.org/ns/anno.jsonld',
    'https://x-ray.dev/ns/v1.jsonld'
  ]);
  assert.equal(body.type, 'Annotation');
  assert.equal(body.body.value, 'Hello');
  assert.equal(body.body.format, 'text/markdown');
  assert.equal(body.target.source, URL);
  assert.deepEqual(body.target.selector[0], { type: 'TextQuoteSelector', exact: 'world' });
});

test('annotation: rejects missing url / motivation', async () => {
  await assert.rejects(() => buildAnnotationEvent({ motivation: 'x', bodyMarkdown: 'y' }));
  await assert.rejects(() => buildAnnotationEvent({ url: URL, bodyMarkdown: 'y' }));
});

// ------------------------------------------------------------------
// FactCheck — kind 30051
// ------------------------------------------------------------------

test('factcheck: kind 30051 with claim-reviewed + rating tags', async () => {
  const out = await buildFactCheckEvent({
    url: URL,
    claimReviewed: 'The Earth is flat.',
    ratingValue: 1,
    ratingName: 'False',
    ratingExplanation: 'Geodesy disagrees.',
    topic: 'science'
  });
  assert.equal(out.event.kind, 30051);
  const tagMap = tagsAsMap(out.event.tags);
  assert.equal(tagMap['claim-reviewed'][0], 'The Earth is flat.');
  assert.equal(tagMap['rating-value'][0], '1');
  assert.equal(tagMap['rating-best'][0], '5');
  assert.equal(tagMap['rating-worst'][0], '1');
  assert.equal(tagMap['rating-name'][0], 'False');
  assert.equal(tagMap['rating-scale'][0], 'x-ray.dev/scale/v1');
  assert.equal(tagMap.r[0], URL);
});

test('factcheck: deterministic d-tag (url + claim)', async () => {
  const a = await buildFactCheckEvent({
    url: URL, claimReviewed: 'X', ratingValue: 3, ratingName: 'Mixed'
  });
  const b = await buildFactCheckEvent({
    url: URL, claimReviewed: 'X', ratingValue: 5, ratingName: 'True'
  });
  // Same URL + claim → same d-tag (re-rating the same claim updates).
  assert.equal(a.dTag, b.dTag);
});

test('factcheck: different claim → different d-tag', async () => {
  const a = await buildFactCheckEvent({
    url: URL, claimReviewed: 'X', ratingValue: 1, ratingName: 'False'
  });
  const b = await buildFactCheckEvent({
    url: URL, claimReviewed: 'Y', ratingValue: 1, ratingName: 'False'
  });
  assert.notEqual(a.dTag, b.dTag);
});

test('factcheck: evidence tags emitted', async () => {
  const out = await buildFactCheckEvent({
    url: URL, claimReviewed: 'X', ratingValue: 1, ratingName: 'False',
    evidence: ['https://primarysource.example.org/data', 'nostr:naddr1xyz']
  });
  const evTags = out.event.tags.filter((t) => t[0] === 'evidence');
  assert.equal(evTags.length, 2);
  assert.equal(evTags[0][1], 'https://primarysource.example.org/data');
});

test('factcheck: body is ClaimReview JSON-LD', async () => {
  const out = await buildFactCheckEvent({
    url: URL,
    claimReviewed: 'A claim.',
    ratingValue: 2,
    ratingName: 'Mostly False',
    ratingExplanation: 'Because.',
    appearance: { headline: "Headline", datePublished: '2026-01-01' }
  });
  const body = JSON.parse(out.event.content);
  assert.equal(body['@context'], 'https://schema.org');
  assert.equal(body.type, 'ClaimReview');
  assert.equal(body.claimReviewed, 'A claim.');
  assert.equal(body.itemReviewed.appearance.url, URL);
  assert.equal(body.itemReviewed.appearance.headline, 'Headline');
  assert.equal(body.reviewRating.ratingValue, 2);
  assert.equal(body.reviewRating.alternateName, 'Mostly False');
  assert.equal(body.reviewRating.ratingExplanation, 'Because.');
});

test('factcheck: rejects missing required fields', async () => {
  await assert.rejects(() => buildFactCheckEvent({ url: URL, ratingValue: 1, ratingName: 'X' }));
  await assert.rejects(() => buildFactCheckEvent({ url: URL, claimReviewed: 'X', ratingName: 'F' }));
  await assert.rejects(() => buildFactCheckEvent({ url: URL, claimReviewed: 'X', ratingValue: 1 }));
});

test('factcheck: custom rating-scale namespace passes through', async () => {
  const out = await buildFactCheckEvent({
    url: URL, claimReviewed: 'X', ratingValue: 3, ratingName: 'Half True',
    ratingScale: 'politifact.com/scale/v1'
  });
  const tagMap = tagsAsMap(out.event.tags);
  assert.equal(tagMap['rating-scale'][0], 'politifact.com/scale/v1');
});

// ------------------------------------------------------------------
// Rating — kind 30052
// ------------------------------------------------------------------

test('rating: kind 30052 with rating-* tags', async () => {
  const out = await buildRatingEvent({
    url: URL, ratingValue: 4, ratingName: 'Strong analysis',
    content: 'Solid empirical work.', topic: 'bitcoin',
    authorPubkey: TARGET_PUBKEY
  });
  assert.equal(out.event.kind, 30052);
  assert.equal(out.event.content, 'Solid empirical work.');
  const tagMap = tagsAsMap(out.event.tags);
  assert.equal(tagMap['rating-value'][0], '4');
  assert.equal(tagMap['rating-best'][0], '5');
  assert.equal(tagMap['rating-name'][0], 'Strong analysis');
  assert.equal(tagMap.t[0], 'bitcoin');
  assert.match(tagMap.d[0], /^rating:[0-9a-f]{16}$/);
});

test('rating: same author + url → same d-tag (replaceable)', async () => {
  const args = { url: URL, ratingValue: 4, ratingName: 'X', content: 'a', authorPubkey: TARGET_PUBKEY };
  const a = await buildRatingEvent(args);
  const b = await buildRatingEvent({ ...args, ratingValue: 5, ratingName: 'Y', content: 'b' });
  assert.equal(a.dTag, b.dTag);
});

test('rating: different author → different d-tag', async () => {
  const args = { url: URL, ratingValue: 4, ratingName: 'X', content: 'a' };
  const a = await buildRatingEvent({ ...args, authorPubkey: 'a'.repeat(64) });
  const b = await buildRatingEvent({ ...args, authorPubkey: 'b'.repeat(64) });
  assert.notEqual(a.dTag, b.dTag);
});

test('rating: rejects missing fields', async () => {
  await assert.rejects(() => buildRatingEvent({ ratingValue: 1, ratingName: 'X', authorPubkey: TARGET_PUBKEY }));
  await assert.rejects(() => buildRatingEvent({ url: URL, ratingName: 'X', authorPubkey: TARGET_PUBKEY }));
  await assert.rejects(() => buildRatingEvent({ url: URL, ratingValue: 1, authorPubkey: TARGET_PUBKEY }));
  await assert.rejects(() => buildRatingEvent({ url: URL, ratingValue: 1, ratingName: 'X' }));
});

// ------------------------------------------------------------------
// HelpfulnessVote — kind 9803
// ------------------------------------------------------------------

test('helpfulness: kind 9803 with `a`, `p`, `helpful` tags', () => {
  const out = buildHelpfulnessEvent({
    targetCoord: '30050:abc:dxyz',
    targetEventId: 'event123',
    targetAuthor: 'authorabc',
    relayHint: 'wss://relay.example',
    helpful: 1,
    rationale: 'Yes, this is well-sourced.'
  });
  assert.equal(out.event.kind, 9803);
  assert.equal(out.event.content, 'Yes, this is well-sourced.');
  const aTag = out.event.tags.find((t) => t[0] === 'a');
  assert.deepEqual(aTag, ['a', '30050:abc:dxyz', 'wss://relay.example']);
  const pTag = out.event.tags.find((t) => t[0] === 'p');
  assert.equal(pTag[1], 'authorabc');
  const helpfulTag = out.event.tags.find((t) => t[0] === 'helpful');
  assert.equal(helpfulTag[1], '1');
  // dTag is null because 9803 is regular (not addressable).
  assert.equal(out.dTag, null);
});

test('helpfulness: `helpful: -1` and `helpful: 0` accepted', () => {
  const a = buildHelpfulnessEvent({ targetCoord: 'x', helpful: -1 });
  const b = buildHelpfulnessEvent({ targetCoord: 'x', helpful: 0 });
  assert.equal(a.event.tags.find((t) => t[0] === 'helpful')[1], '-1');
  assert.equal(b.event.tags.find((t) => t[0] === 'helpful')[1], '0');
});

test('helpfulness: rejects invalid helpful value', () => {
  assert.throws(() => buildHelpfulnessEvent({ targetCoord: 'x', helpful: 2 }));
  assert.throws(() => buildHelpfulnessEvent({ targetCoord: 'x', helpful: 'yes' }));
});

test('helpfulness: rejects missing targetCoord', () => {
  assert.throws(() => buildHelpfulnessEvent({ helpful: 1 }));
});

// ------------------------------------------------------------------
// TopicTrust — kind 30053
// ------------------------------------------------------------------

test('topic-trust: kind 30053 with p/t/weight + d-tag', () => {
  const out = buildTopicTrustEvent({
    targetPubkey: TARGET_PUBKEY,
    topic: 'bitcoin',
    weight: 85,
    rationale: 'Long-time domain expert.'
  });
  assert.equal(out.event.kind, 30053);
  assert.equal(out.event.content, 'Long-time domain expert.');
  const tagMap = tagsAsMap(out.event.tags);
  assert.equal(tagMap.p[0], TARGET_PUBKEY);
  assert.equal(tagMap.t[0], 'bitcoin');
  assert.equal(tagMap.weight[0], '85');
  assert.match(tagMap.d[0], /^trust:bitcoin:[0-9a-f]{16}$/);
});

test('topic-trust: emits `expires` when provided', () => {
  const out = buildTopicTrustEvent({
    targetPubkey: TARGET_PUBKEY, topic: 'x', weight: 50, expires: 1798761600
  });
  const tagMap = tagsAsMap(out.event.tags);
  assert.equal(tagMap.expires[0], '1798761600');
});

test('topic-trust: omits `expires` when not provided', () => {
  const out = buildTopicTrustEvent({ targetPubkey: TARGET_PUBKEY, topic: 'x', weight: 50 });
  const tagMap = tagsAsMap(out.event.tags);
  assert.equal(tagMap.expires, undefined);
});

test('topic-trust: same target + topic → same d-tag (replaceable)', () => {
  const a = buildTopicTrustEvent({ targetPubkey: TARGET_PUBKEY, topic: 'bitcoin', weight: 50 });
  const b = buildTopicTrustEvent({ targetPubkey: TARGET_PUBKEY, topic: 'bitcoin', weight: 80 });
  assert.equal(a.dTag, b.dTag);
});

test('topic-trust: different topic → different d-tag', () => {
  const a = buildTopicTrustEvent({ targetPubkey: TARGET_PUBKEY, topic: 'bitcoin', weight: 50 });
  const b = buildTopicTrustEvent({ targetPubkey: TARGET_PUBKEY, topic: 'cooking', weight: 50 });
  assert.notEqual(a.dTag, b.dTag);
});

test('topic-trust: rejects bad target pubkey', () => {
  assert.throws(() => buildTopicTrustEvent({
    targetPubkey: 'too-short', topic: 'x', weight: 50
  }));
});

test('topic-trust: rejects out-of-range weight', () => {
  assert.throws(() => buildTopicTrustEvent({ targetPubkey: TARGET_PUBKEY, topic: 'x', weight: -1 }));
  assert.throws(() => buildTopicTrustEvent({ targetPubkey: TARGET_PUBKEY, topic: 'x', weight: 101 }));
  assert.throws(() => buildTopicTrustEvent({ targetPubkey: TARGET_PUBKEY, topic: 'x', weight: NaN }));
});

// ------------------------------------------------------------------
// responds-to tag (kind 30023 extension)
// ------------------------------------------------------------------

test('respondsTo: emits canonical 3-tuple form', () => {
  const t = buildRespondsToTag('https://example.com/a', 'rebuts');
  assert.deepEqual(t, ['responds-to', 'https://example.com/a', 'rebuts']);
});

test('respondsTo: emits 4-tuple with relay hint', () => {
  const t = buildRespondsToTag('nostr:naddr1xyz', 'extends', 'wss://relay.example');
  assert.deepEqual(t, ['responds-to', 'nostr:naddr1xyz', 'extends', 'wss://relay.example']);
});

test('respondsTo: normalizes URL targets', () => {
  const t = buildRespondsToTag('HTTPS://Example.COM/a?utm_source=x', 'supports');
  assert.equal(t[1], 'https://example.com/a');
});

test('respondsTo: leaves nostr: refs alone', () => {
  const t = buildRespondsToTag('nostr:naddr1abc', 'supports');
  assert.equal(t[1], 'nostr:naddr1abc');
});

test('respondsTo: rejects unknown relationship', () => {
  assert.throws(() => buildRespondsToTag('https://x', 'destroys'));
});

test('respondsTo: rejects missing target', () => {
  assert.throws(() => buildRespondsToTag('', 'rebuts'));
});

test('respondsTo: relationships set is exposed for UIs', () => {
  assert.deepEqual(
    [...RESPONDS_TO_RELATIONSHIPS].sort(),
    ['contextualizes', 'corrects', 'extends', 'rebuts', 'supports']
  );
});

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function tagsAsMap(tags) {
  const out = {};
  for (const t of tags) {
    if (!Array.isArray(t) || t.length === 0) continue;
    if (!out[t[0]]) out[t[0]] = [];
    out[t[0]].push(...t.slice(1));
  }
  return out;
}

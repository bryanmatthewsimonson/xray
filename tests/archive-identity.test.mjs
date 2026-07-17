// Archive-reconstruction identity — the `#r` over-match that served
// the WRONG ARTICLE.
//
// `xray:archive:reconstruct` asks relays for `{kinds:[30023],
// '#r':[url]}` and renders the newest hit under `url`. But `#r` is not
// an identity index: buildArticleEvent co-emits an indexed `r` for
// `responds-to` targets and for the first 25 OUTBOUND LINKS of every
// article, so an event matches merely by LINKING to `url`. When no
// capture of `url` was ever published, a linking article is the ONLY
// candidate — it wins 100% of the time, with `altCount: 0` offering no
// tell — and its body renders under the requested URL, where claims and
// comments then key to it.
//
// `articleAnswersTo` is the gate: an article answers to its identity
// URL and its `capture_url` mirror address, and to nothing else.
//
// The end-to-end test below is the real repro: it runs the actual
// builder and the actual reconstruct inverse, asserts the poisoned `r`
// tag IS present (so the relay filter really would return this event),
// and then asserts the gate rejects it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// EventBuilder transitively imports Storage, which probes
// `chrome.storage.local` at module-load time.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { articleAddresses, articleAnswersTo } = await import('../src/shared/url-identity.js');
const { EventBuilder } = await import('../src/shared/event-builder.js');
const { normalize } = await import('../src/shared/metadata/url-normalizer.js');

const PUBKEY = '6daa7f3b0f5a4c8e9b2d1a7c3e5f80916d4b2a8c7e1f3059d8b6a4c2e0f19375';

// --- the gate, as a unit ------------------------------------------------------

test('an article answers to its identity URL', () => {
    assert.equal(articleAnswersTo({ url: 'https://example.com/story' },
        'https://example.com/story'), true);
});

test('an article answers to its capture_url mirror, so a probe from the mirror still finds it', () => {
    // Original-as-identity (url-identity policy, 2026-07-09): the piece
    // keys to the recovered original, and archive.is is provenance. A
    // reader sitting ON the archive page probes with the archive
    // address — that must still resolve to this article.
    const archived = {
        url: 'https://www.wsj.com/articles/three-researchers',
        capture_url: 'https://archive.is/7gYpy'
    };
    assert.equal(articleAnswersTo(archived, 'https://archive.is/7gYpy'), true);
    assert.equal(articleAnswersTo(archived, 'https://www.wsj.com/articles/three-researchers'), true);
    assert.deepEqual(articleAddresses(archived), [
        normalize('https://www.wsj.com/articles/three-researchers'),
        normalize('https://archive.is/7gYpy')
    ], 'identity first, mirror second, both normalized');
});

test('an article does NOT answer to a URL it merely links to', () => {
    const linking = {
        url: 'https://substack.example/p/a-critique',
        links: [{ url: 'https://example.com/story', text: 'the piece' }]
    };
    assert.equal(articleAnswersTo(linking, 'https://example.com/story'), false,
        'linking to X does not make you X');
});

test('normalization applies to BOTH sides — a tracking param does not fork identity', () => {
    assert.equal(articleAnswersTo({ url: 'https://example.com/story' },
        'https://example.com/story?utm_source=twitter'), true);
    assert.equal(articleAnswersTo({ url: 'https://example.com/story?utm_source=rss' },
        'https://example.com/story'), true);
});

test('a different path is not the same article, however similar', () => {
    assert.equal(articleAnswersTo({ url: 'https://example.com/story-2' },
        'https://example.com/story'), false);
});

test('junk degrades to false, never to a false match', () => {
    assert.equal(articleAnswersTo(null, 'https://example.com/x'), false);
    assert.equal(articleAnswersTo({}, 'https://example.com/x'), false);
    assert.equal(articleAnswersTo({ url: 'https://example.com/x' }, ''), false);
    assert.equal(articleAnswersTo({ url: 'https://example.com/x' }, null), false);
    assert.equal(articleAnswersTo({ url: 123 }, 'https://example.com/x'), false);
    // `normalize` is fail-open: an unparseable string passes through
    // unchanged rather than throwing. So an unparseable address matches
    // ITSELF (harmless and consistent — the probe URL always comes from
    // a live capture), but never a real URL.
    assert.equal(articleAnswersTo({ url: 'not a url' }, 'https://example.com/x'), false);
    assert.deepEqual(articleAddresses(null), []);
    assert.deepEqual(articleAddresses({ url: null, capture_url: null }), []);
});

test('addresses dedupe when capture_url equals the identity URL', () => {
    assert.deepEqual(
        articleAddresses({ url: 'https://example.com/a', capture_url: 'https://example.com/a' }),
        [normalize('https://example.com/a')]);
});

// --- the repro: real builder → real inverse → the gate -------------------------

test('REPRO: a linking article carries the victim URL in `r`, yet is rejected by the gate', async () => {
    const VICTIM = 'https://www.wsj.com/articles/three-researchers-sick';

    // An ordinary article that merely cites the WSJ piece. Nothing
    // unusual: this is what every commentary capture looks like.
    const critique = {
        url: 'https://substack.example/p/why-that-wsj-piece-is-wrong',
        title: 'Why that WSJ piece is wrong',
        content: '<p>The reporting rests on unnamed sources.</p>',
        markdown: 'The reporting rests on unnamed sources.',
        links: [{ url: VICTIM, text: 'the WSJ article', internal: false }]
    };

    const ev = await EventBuilder.buildArticleEvent(critique, [], PUBKEY);

    // 1. The poison is real: this event WOULD come back from
    //    `{kinds:[30023], '#r':[VICTIM]}`.
    const rTags = ev.tags.filter((t) => t[0] === 'r').map((t) => t[1]);
    assert.ok(rTags.includes(normalize(VICTIM)),
        'the outbound link co-emits an indexed r for the victim URL — this is the over-match');
    assert.equal(rTags[0], critique.url,
        'the FIRST r is still the article\'s own URL (reconstruct invariant)');

    // 2. The inverse recovers the critique — NOT the WSJ piece.
    const rebuilt = EventBuilder.reconstructArticleFromEvent(ev);
    assert.equal(rebuilt.url, critique.url);

    // 3. The gate rejects it for the victim URL. Before this gate, the
    //    handler took events[0] and served THIS body under VICTIM.
    assert.equal(articleAnswersTo(rebuilt, VICTIM), false,
        'the critique must never be served as the WSJ article');
    assert.equal(articleAnswersTo(rebuilt, critique.url), true,
        'and it must still be findable as itself');
});

test('REPRO: a genuine capture of the victim URL still resolves', async () => {
    const VICTIM = 'https://www.wsj.com/articles/three-researchers-sick';
    const real = {
        url: VICTIM,
        title: 'Three researchers fell ill',
        content: '<p>Body.</p>',
        markdown: 'Body.'
    };
    const ev = await EventBuilder.buildArticleEvent(real, [], PUBKEY);
    const rebuilt = EventBuilder.reconstructArticleFromEvent(ev);
    assert.equal(articleAnswersTo(rebuilt, VICTIM), true,
        'the gate must not cost us the true positive');
});

// Phase 13.4 — capture-time canonical hashing: the x tag on 30023s,
// the header-strip invariant, header-field sanitization, and the
// archive record's articleHash.
//
// THE load-bearing invariant: for every article,
//   stripMetadataHeader(event.content) === assembleArticleBody(article)
// byte-for-byte — that equality is what lets any third party verify
// the x tag from the published event alone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

await import('fake-indexeddb/auto');

// Storage probes chrome.storage.local at module-load time.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { EventBuilder } = await import('../src/shared/event-builder.js');
const { normalizeForHash, articleHash, stripMetadataHeader } = await import('../src/shared/audit/article-hash.js');
const ArchiveCache = await import('../src/shared/archive-cache.js');

const PUBKEY = '4ba5145ddce7322c3422096997fdf9d5cf9198312d7567b0dda275e580654a9f';

function expectedHash(body) {
    return createHash('sha256').update(normalizeForHash(body), 'utf8').digest('hex');
}

function articleFixture(overrides = {}) {
    return {
        url: 'https://example.com/story',
        title: 'A Perfectly Normal Title',
        byline: 'Jane Reporter',
        siteName: 'The Example Times',
        publishedAt: 1765000000,
        content: '# Heading\n\nBody paragraph one.\n\nBody paragraph two.',
        domain: 'example.com',
        ...overrides
    };
}

test('30023 carries the x tag, verifiable from the event alone', async () => {
    const article = articleFixture();
    const ev = await EventBuilder.buildArticleEvent(article, [], PUBKEY, []);
    const xTag = ev.tags.find((t) => t[0] === 'x');
    assert.ok(xTag, 'x tag present');
    assert.match(xTag[1], /^[0-9a-f]{64}$/);

    // Verifiable two independent ways: from the assembly, and from the
    // published content via the header strip.
    const body = EventBuilder.assembleArticleBody(article);
    assert.equal(xTag[1], expectedHash(body));
    assert.equal(stripMetadataHeader(ev.content), body,
        'strip(content) must recover the exact hash input');
    assert.equal(xTag[1], await articleHash(stripMetadataHeader(ev.content)),
        'a third party recomputes the x tag from the event alone');
});

test('header-field newlines cannot forge the header terminator — every call site', async () => {
    // A hostile value smuggling "\n---\n" would end the header strip
    // early and leak header residue (the Archived date) into a third
    // party's recomputation — the one thing a content address must
    // never depend on. Every interpolated field is hostile here so a
    // single unsanitized call site fails the invariant.
    const hostile = articleFixture({
        title: 'Evil\n---\n\nInjected body line',
        byline: 'Line\n---\nBreaker',
        siteName: 'News\n---\nCorp'
    });
    const ev = await EventBuilder.buildArticleEvent(hostile, [], PUBKEY, []);
    const body = EventBuilder.assembleArticleBody(hostile);
    assert.equal(stripMetadataHeader(ev.content), body,
        'sanitized header fields keep the strip exact');
    assert.equal(ev.tags.find((t) => t[0] === 'x')[1], expectedHash(body));
    // The header itself flattened the newlines rather than dropping the fields.
    assert.ok(ev.content.includes('Evil --- Injected body line'),
        'title survives, flattened to one line');

    // The video Channel line is a SEPARATE call site, and channel
    // names come from third-party platforms — attacker-influenced.
    const hostileVideo = articleFixture({
        contentType: 'video',
        byline: 'Sneaky\n---\nChannel',
        title: 'Evil\n---\nVideo'
    });
    const evVideo = await EventBuilder.buildArticleEvent(hostileVideo, [], PUBKEY, []);
    const videoBody = EventBuilder.assembleArticleBody(hostileVideo);
    assert.equal(stripMetadataHeader(evVideo.content), videoBody);
    assert.equal(evVideo.tags.find((t) => t[0] === 'x')[1], expectedHash(videoBody));
});

test('legacy non-video transcript: the fenced block (with its own ---) keeps the strip lazy', async () => {
    // The only body shape that naturally contains "\n---\n" — a GREEDY
    // header-strip regex would eat through it and silently fork the
    // hash recomputation for every article with a markdown hr.
    const article = articleFixture({
        transcript: 'Spoken words, raw and unchunked.'
    });
    const ev = await EventBuilder.buildArticleEvent(article, [], PUBKEY, []);
    const body = EventBuilder.assembleArticleBody(article);
    assert.ok(body.includes('\n---\n'), 'the legacy transcript separator is in the body');
    assert.ok(body.includes('```\nSpoken words'), 'fenced transcript block assembled');
    assert.equal(stripMetadataHeader(ev.content), body,
        'the strip must stop at the FIRST header terminator, never a body hr');
    assert.equal(ev.tags.find((t) => t[0] === 'x')[1], expectedHash(body));
});

test('video Description/Transcript sections are INSIDE the hash input', async () => {
    const plain = articleFixture();
    const video = articleFixture({
        contentType: 'video',
        description: 'A talk about rates.',
        transcript: 'First sentence. Second sentence. Third sentence. Fourth one here. Fifth too.'
    });
    const evPlain = await EventBuilder.buildArticleEvent(plain, [], PUBKEY, []);
    const evVideo = await EventBuilder.buildArticleEvent(video, [], PUBKEY, []);
    const xPlain = evPlain.tags.find((t) => t[0] === 'x')[1];
    const xVideo = evVideo.tags.find((t) => t[0] === 'x')[1];
    assert.notEqual(xPlain, xVideo, 'the audited text is the published text, in full');

    const videoBody = EventBuilder.assembleArticleBody(video);
    assert.ok(videoBody.includes('## Transcript'), 'chunked transcript is part of the body');
    assert.equal(stripMetadataHeader(evVideo.content), videoBody,
        'strip invariant holds for assembled video bodies too');
    assert.equal(xVideo, expectedHash(videoBody));
});

test('reconstructArticleFromEvent carries the published hash as _articleHash', async () => {
    const article = articleFixture();
    const ev = await EventBuilder.buildArticleEvent(article, [], PUBKEY, []);
    const xValue = ev.tags.find((t) => t[0] === 'x')[1];
    const reconstructed = EventBuilder.reconstructArticleFromEvent({ ...ev, id: 'e'.repeat(64) });
    assert.equal(reconstructed._articleHash, xValue,
        'carried as published, never recomputed after the HTML round trip');

    // Pre-13.4 events (no x tag) reconstruct with null, not undefined.
    const legacy = { ...ev, id: 'f'.repeat(64), tags: ev.tags.filter((t) => t[0] !== 'x') };
    assert.equal(EventBuilder.reconstructArticleFromEvent(legacy)._articleHash, null);
});

test('a promoted claim back-references its prediction (RQ6, additive 30040 wire change)', async () => {
    const claim = {
        id: 'claim_1234567890abcdef',
        text: 'Rates will fall by December.',
        about: [], source: null, is_key: false, anchor: null
    };
    const withRef = EventBuilder.buildClaimEvent(
        claim, 'https://example.com/story', 'A Story', PUBKEY, {},
        { pred_d: 'pred:abcdef0123456789' });
    const aTag = withRef.tags.find((t) => t[0] === 'a');
    assert.deepEqual(aTag, ['a', `30058:${PUBKEY}:pred:abcdef0123456789`, '', 'prediction'],
        'lineage runs both directions — the claim points back at the ledger entry');

    // Additive and optional: unpromoted claims are byte-identical to
    // the pre-13.6 shape (no a tag at all).
    const without = EventBuilder.buildClaimEvent(
        claim, 'https://example.com/story', 'A Story', PUBKEY, {});
    assert.equal(without.tags.find((t) => t[0] === 'a'), undefined);
});

test('CURRENT_MODULE_VERSIONS covers every module (the staleness reference)', async () => {
    const { CURRENT_MODULE_VERSIONS, MODULE_NAMES } = await import('../src/shared/audit/findings-schemas.js');
    assert.deepEqual(Object.keys(CURRENT_MODULE_VERSIONS).sort(), [...MODULE_NAMES].sort());
    for (const v of Object.values(CURRENT_MODULE_VERSIONS)) {
        assert.match(v, /^\d+\.\d+(\.\d+)?$/);
    }
});

test('archive records carry articleHash, agreeing with the publish-path x tag', async () => {
    await ArchiveCache.clear().catch(() => { /* fresh db */ });
    const article = articleFixture({ url: 'https://example.com/archived-story' });
    const record = await ArchiveCache.saveArticle({ article, source: 'capture' });
    assert.equal(record.articleHash, expectedHash(EventBuilder.assembleArticleBody(article)),
        'local capture and publish path hash the same bytes');

    // Relay-reconstructed articles carry the PUBLISHED hash through
    // _articleHash rather than recomputing post-round-trip.
    const reconstructed = articleFixture({
        url: 'https://example.com/relay-story',
        _articleHash: 'a'.repeat(64)
    });
    const relayRecord = await ArchiveCache.saveArticle({ article: reconstructed, source: 'relay' });
    assert.equal(relayRecord.articleHash, 'a'.repeat(64));
});

test('a re-capture with changed content changes the record hash — and RETAINS the displaced text', async () => {
    const url = 'https://example.com/edited-story';
    const v1 = await ArchiveCache.saveArticle({
        article: articleFixture({ url, content: 'The minister said yes.' }), source: 'capture'
    });
    assert.deepEqual(v1.priorVersions, [], 'first capture displaces nothing');

    const v2 = await ArchiveCache.saveArticle({
        article: articleFixture({ url, content: 'The minister said no.' }), source: 'capture'
    });
    assert.notEqual(v1.articleHash, v2.articleHash);
    // The banner promises "your previous capture stays in the archive" —
    // the displaced version must actually survive (the design's
    // "capturing both versions is its own diagnostic").
    assert.equal(v2.priorVersions.length, 1);
    assert.equal(v2.priorVersions[0].articleHash, v1.articleHash);
    assert.equal(v2.priorVersions[0].article.content, 'The minister said yes.',
        'the prior TEXT survives, not just its hash');
    assert.ok(v2.priorVersions[0].displacedAt > 0);

    // Formatting noise does NOT change the hash — and snapshots nothing.
    const v3 = await ArchiveCache.saveArticle({
        article: articleFixture({ url, content: 'The minister said no.   \n\n\n' }), source: 'capture'
    });
    assert.equal(v2.articleHash, v3.articleHash);
    assert.equal(v3.priorVersions.length, 1, 'same hash, no new snapshot');

    // Retention is bounded: distinct versions beyond the cap drop oldest-first.
    let last = v3;
    for (const text of ['v4 text.', 'v5 text.', 'v6 text.', 'v7 text.']) {
        last = await ArchiveCache.saveArticle({
            article: articleFixture({ url, content: text }), source: 'capture'
        });
    }
    assert.equal(last.priorVersions.length, 3, 'capped');
    assert.equal(last.priorVersions[2].article.content, 'v6 text.', 'newest displaced kept');
    assert.ok(!last.priorVersions.some((v) => v.article.content === 'The minister said yes.'),
        'oldest dropped beyond the cap');
});

test('hash failure never blocks archiving — and never inherits the prior hash', async () => {
    const url = 'https://example.com/fragile-story';
    const good = await ArchiveCache.saveArticle({
        article: articleFixture({ url, content: 'Good text.' }), source: 'capture'
    });
    assert.ok(good.articleHash);

    // A non-string content makes the body assembly throw; the record
    // must still persist — with articleHash NULL, not the prior row's
    // (the hash labels THIS body; inheriting would mislabel new
    // content with old identity).
    const broken = await ArchiveCache.saveArticle({
        article: articleFixture({ url, content: 12345 }), source: 'capture'
    });
    assert.equal(broken.articleHash, null);
    const reread = await ArchiveCache.getArticle(url);
    assert.equal(reread.articleHash, null, 'persisted, unhashed, honest');
});

// ------------------------------------------------------------------
// 13.9 phase review (blocking): load↔publish hash parity. The reader
// hashes the ONCE-converted markdown at load; publish feeds the
// markdown draft back through assembleArticleBody. htmlToMarkdown is
// NOT idempotent and markdown legitimately contains '<' (small
// inline images, code fences) — without the explicit marker the
// second pass mangles the body and forks the published x from the
// hash every audit anchors to.
// ------------------------------------------------------------------

test('publish-path body is byte-identical to the load-path body when the markdown contains <', async () => {
    const { ContentExtractor } = await import('../src/shared/content-extractor.js');
    const html = '<h1>Heading</h1><p>By <img src="https://x.example/a.png" width="48"> Jane Doe</p>'
        + '<p>Body paragraph one with <em>emphasis</em>.</p><p>Code: <code>&lt;div&gt;</code></p>';

    // Load path: content is extractor HTML, converted once.
    const loadBody = EventBuilder.assembleArticleBody(articleFixture({ content: html }));
    assert.ok(loadBody.includes('<'), 'precondition: the converted markdown retains a literal <');

    // Publish path: the reader derives the markdown draft and marks it.
    const md = ContentExtractor.htmlToMarkdown(html);
    const publishBody = EventBuilder.assembleArticleBody(articleFixture({
        content: md, markdown: md, _contentIsMarkdown: true
    }));

    assert.equal(publishBody, loadBody,
        'one conversion ever — the published x must equal the capture hash for an unedited body');
});

test('without the marker, markdown content containing < still converts (capture-time behavior unchanged)', () => {
    const html = '<p>Hello <em>world</em></p>';
    const viaHtml = EventBuilder.assembleArticleBody(articleFixture({ content: html }));
    assert.ok(!viaHtml.includes('<em>'), 'HTML input is converted exactly as before');
});

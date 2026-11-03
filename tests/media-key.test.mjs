// Media identity, extension side — the MIRROR of the companion's
// media_url.media_key_for. Two rules matter: a YouTube capture keeps
// its bare video id (existing xray:transcribe:job:<videoId> records
// must resume, not orphan), and two distinct media never collapse.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { youtubeVideoId, mediaKeyForUrl, mediaKeyForArticle } =
    await import('../src/shared/media-key.js');

test('youtubeVideoId: watch / youtu.be / shorts forms, null otherwise', () => {
    assert.equal(youtubeVideoId('https://www.youtube.com/watch?v=abc123DEF45'), 'abc123DEF45');
    assert.equal(youtubeVideoId('https://youtu.be/abc123DEF45'), 'abc123DEF45');
    assert.equal(youtubeVideoId('https://www.youtube.com/shorts/abc123DEF45'), 'abc123DEF45');
    assert.equal(youtubeVideoId('https://mormonstories.org/podcast/ep-1/'), null);
    assert.equal(youtubeVideoId('junk'), null);
});

test('mediaKeyForUrl: YouTube keeps the bare video id (record back-compat)', async () => {
    assert.equal(await mediaKeyForUrl('https://www.youtube.com/watch?v=abc123DEF45'), 'abc123DEF45');
});

test('mediaKeyForUrl: a generic URL hashes to u_<16 hex>', async () => {
    const key = await mediaKeyForUrl('https://mormonstories.org/podcast/ep-1/');
    assert.match(key, /^u_[0-9a-f]{16}$/);
});

test('mediaKeyForUrl: tracking params, case, port and fragment do not fork the key', async () => {
    const base = await mediaKeyForUrl('https://mormonstories.org/podcast/ep-1/');
    for (const variant of [
        'https://MormonStories.org/podcast/ep-1/',
        'https://mormonstories.org/podcast/ep-1/?utm_source=twitter',
        'https://mormonstories.org/podcast/ep-1/#t=30',
        'https://mormonstories.org:443/podcast/ep-1/'
    ]) {
        assert.equal(await mediaKeyForUrl(variant), base, variant);
    }
});

test('mediaKeyForUrl: meaningful params still separate episodes; order does not', async () => {
    assert.notEqual(
        await mediaKeyForUrl('https://example.com/player?episode=1'),
        await mediaKeyForUrl('https://example.com/player?episode=2')
    );
    assert.equal(
        await mediaKeyForUrl('https://example.com/p?a=1&b=2'),
        await mediaKeyForUrl('https://example.com/p?b=2&a=1')
    );
});

test('mediaKeyForArticle: youtube.videoId wins, else the URL rule', async () => {
    assert.equal(
        await mediaKeyForArticle({ url: 'https://www.youtube.com/watch?v=abc123DEF45', youtube: { videoId: 'abc123DEF45' } }),
        'abc123DEF45'
    );
    assert.match(
        await mediaKeyForArticle({ url: 'https://mormonstories.org/podcast/ep-1/' }),
        /^u_[0-9a-f]{16}$/
    );
});

test('mediaKeyForArticle: an explicit sourceUrl override keys off the URL actually transcribed, not article.url', async () => {
    // B2 (transcribe-flow.js transcribeSourceUrl): when the companion is
    // sent a discovered mediaHints.fileUrl instead of the page URL, the
    // job record must key off THAT url — otherwise a re-run recomputes a
    // different key from article.url and can never resume the same job.
    const article = { url: 'https://mormondiscussionpodcast.org/2026/08/some-episode/' };
    const pageKey = await mediaKeyForArticle(article);
    const fileKey = await mediaKeyForArticle(article, 'https://media.blubrry.com/x/ep.mp3');
    assert.notEqual(pageKey, fileKey);
    assert.equal(fileKey, await mediaKeyForUrl('https://media.blubrry.com/x/ep.mp3'));
    // Repeating the same override is stable (resumability).
    assert.equal(await mediaKeyForArticle(article, 'https://media.blubrry.com/x/ep.mp3'), fileKey);
});

test('mediaKeyForArticle: youtube.videoId still wins over a sourceUrl override (never orphan a YouTube job record)', async () => {
    assert.equal(
        await mediaKeyForArticle(
            { url: 'https://www.youtube.com/watch?v=abc123DEF45', youtube: { videoId: 'abc123DEF45' } },
            'https://some-other-cdn.example.com/decoy.mp4'
        ),
        'abc123DEF45'
    );
});

test('mediaKeyForUrl: query encoding matches Python quote_plus (companion agreement)', async () => {
    // Empirically verified agreement: both sides produce identical keys
    // for the same URLs. JS encodeURIComponent → quote_plus transformation.
    assert.equal(
        await mediaKeyForUrl('https://example.com/player?q=a!b'),
        'u_65849da18f09412c'
    );
    assert.equal(
        await mediaKeyForUrl('https://example.com/player?q=a*b'),
        'u_18aab5f759da9ef5'
    );
    assert.equal(
        await mediaKeyForUrl('https://example.com/player?q=a\'b'),
        'u_5d99c50f93fe4046'
    );
    assert.equal(
        await mediaKeyForUrl('https://example.com/player?q=a(b)c'),
        'u_53190519058ce30b'
    );
    assert.equal(
        await mediaKeyForUrl('https://example.com/player?q=hello world'),
        'u_b9a286078770daaf'
    );
});

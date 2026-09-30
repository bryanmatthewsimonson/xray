// Capturing a page must not change the user's open tab (JOURNAL
// 2026-09-30). ContentExtractor.extractArticle clones the page FIRST and
// runs every pre-pass on the clone: the lazy-image and srcset swaps, the
// noscript fallback, the small-image stamps, the tweet stand-in and the
// avatar sizing. The live page is only READ, for the image sizes that
// need layout, and those reads are written onto the matching clone image.
//
// The real extractArticle runs on a hand-built LIVE page and its CLONE
// (tests/helpers/capture-page-stub.mjs). The two mirror each other node
// for node, so a pass left on `document` writes to the live twin and
// shows up in page.writes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { h, mirrorPage, runCapture } from './helpers/capture-page-stub.mjs';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { ContentExtractor } = await import('../src/shared/content-extractor.js');

const PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
const LAZY = 'https://cdn.example/lazy.jpg';
const NOSCRIPT_REAL = 'https://cdn.example/real.jpg';
const BODY = '<p>' + 'Body text. '.repeat(30) + '</p>';

// One of every pre-pass target. Only `icon` (index 3 of the page's
// images) is small on the live page, so a size read from the wrong live
// image stamps the wrong clone image.
function storyPage() {
    return mirrorPage([
        h('html', {},
            h('head', {}, h('meta', { property: 'og:title', content: 'Story' })),
            h('body', {},
                h('article', {},
                    h('img', { $key: 'hero', src: PLACEHOLDER, 'data-src': LAZY, $live: { offsetWidth: 640 } }),
                    h('img', { $key: 'srcsetImg', srcset: 'https://cdn.example/s-1x.jpg 1x, https://cdn.example/s-2x.jpg 2x', $live: { offsetWidth: 300 } }),
                    h('figure', { $key: 'nsParent' },
                        h('img', { $key: 'nsImg', src: PLACEHOLDER, $live: { offsetWidth: 500 } }),
                        h('noscript', {}, `<img src="${NOSCRIPT_REAL}" alt="Real" onerror="alert(1)">`)),
                    h('img', { $key: 'icon', src: 'https://cdn.example/icon.png', $live: { naturalWidth: 40, naturalHeight: 30 } }),
                    h('div', { $key: 'tweetParent' },
                        h('blockquote', { $key: 'tweet', class: 'twitter-tweet' },
                            h('p', {}, 'hello world'),
                            '— Some One (@someone) ',
                            h('a', { href: 'https://twitter.com/someone/status/1' }, 'May 1, 2024'))),
                    h('img', { $key: 'avatar', src: 'https://pbs.twimg.com/profile_images/1/a.jpg', $live: { naturalWidth: 200, naturalHeight: 200 } }),
                    h('p', {}, 'Body text.'))))
    ]);
}

const parsed = () => ({ title: 'Story', content: BODY, textContent: 'Body text. '.repeat(30), byline: '' });

test('a capture leaves the user\'s tab untouched: every pre-pass lands on the clone', () => {
    const page = storyPage();
    const article = runCapture(ContentExtractor, page, { parse: parsed });

    assert.deepEqual(page.errors, [], 'sanity: no swallowed error');
    assert.equal(typeof article, 'object', 'sanity: the capture got past the stubbed parse');
    assert.equal(page.liveDoc.cloneCalls, 1);
    assert.deepEqual(page.writes, [], 'no write reached any node of the live page');

    const c = page.clone$;
    assert.equal(c.hero.src, LAZY, 'lazy-image swap, on the clone');
    assert.equal(c.srcsetImg.src, 'https://cdn.example/s-1x.jpg', 'srcset fallback, on the clone');
    assert.equal(c.nsImg.src, NOSCRIPT_REAL, 'noscript fallback, on the clone');
    assert.equal(c.nsImg.alt, 'Real');
    assert.deepEqual([c.icon.getAttribute('width'), c.icon.getAttribute('height'), c.icon.classList.contains('xr-inline-img')],
        ['40', '30', true], 'the live icon\'s natural size is stamped on the CLONE icon');
    for (const k of ['hero', 'srcsetImg', 'nsImg']) {
        assert.equal(c[k].getAttribute('width'), null, `${k} is not small on the live page and gets no stamp`);
    }
    assert.deepEqual({ ...c.avatar.style }, { width: '48px', height: '48px', borderRadius: '50%' }, 'avatar sizing, on the clone');
    assert.equal(c.tweetParent.replaced.length, 1, 'the tweet is swapped for a stand-in on the clone');
    assert.equal(c.tweetParent.replaced[0].old, c.tweet);
    assert.equal(c.tweetParent.replaced[0].nw.owner, 'clone', 'the stand-in belongs to the clone document');

    // The live page is exactly as the user left it.
    const l = page.live$;
    assert.equal(l.hero.src, PLACEHOLDER);
    assert.equal(l.nsImg.src, PLACEHOLDER);
    assert.equal(l.icon.getAttribute('width'), null);
    assert.ok(l.tweetParent.childNodes.includes(l.tweet), 'the live tweet is still in the live page');

    // The featured image sees the clone's lazy swap (it used to see it
    // only because the swap was made on the live page).
    assert.equal(article.featuredImage, LAZY);
    assert.equal(article.content, BODY);
});

test('the image lists are paired before any pass runs; unpaired lists read no layout and never throw', () => {
    const page = storyPage();
    // An image only the clone has: the lists no longer pair index for index.
    const extra = page.clone.createElement('img');
    extra.setAttribute('width', '20');
    page.clone$.nsParent.appendChild(extra);

    const article = runCapture(ContentExtractor, page, { parse: parsed });
    assert.deepEqual(page.errors, []);
    assert.equal(typeof article, 'object');
    assert.deepEqual(page.writes, []);
    assert.deepEqual(page.layoutReads, [], 'no live size is read when the lists do not pair');
    assert.deepEqual([extra.getAttribute('width'), extra.getAttribute('height')], ['20', '20'],
        'the width attribute alone still stamps a small image');
    assert.equal(page.clone$.icon.getAttribute('width'), null, 'the icon, sized only by layout, is left alone');
});

test('a capture that fails, or falls back, leaves the tab untouched too', () => {
    const tooShort = storyPage();
    assert.equal(runCapture(ContentExtractor, tooShort, { parse: () => null }), null);
    assert.deepEqual(tooShort.writes, [], 'Readability found nothing: the tab is still untouched');

    // The REAL Readability refuses the stub clone (no documentElement),
    // so this is the catch → extractSimple path.
    const fallback = storyPage();
    assert.equal(runCapture(ContentExtractor, fallback), 'fell-back');
    assert.equal(fallback.errors.length, 1, 'sanity: the catch path ran');
    assert.deepEqual(fallback.writes, []);
    assert.equal(fallback.clone$.hero.src, LAZY, 'the passes ran (on the clone) before the parse threw');
});

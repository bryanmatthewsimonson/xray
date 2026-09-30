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
const NOSCRIPT_HTML = `<img src="${NOSCRIPT_REAL}" alt="Real" onerror="alert(1)">`;
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
                        h('noscript', {}, NOSCRIPT_HTML)),
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

// Markup parsed into an element the LIVE document owns loads its images
// and runs its inline handlers in the page's context, even detached. The
// clone is inert (no browsing context), so both parses happen there.
test('the noscript fallback and the post-Readability fix-up parse in the clone, never in the live page', () => {
    const page = storyPage();
    const article = runCapture(ContentExtractor, page, { parse: parsed });
    assert.deepEqual(page.errors, []);
    assert.equal(typeof article, 'object');
    assert.deepEqual(page.liveDoc.created, [], 'the live document creates no element at all');
    assert.deepEqual(page.parses.map(({ owner, tag, html }) => ({ owner, tag, html })), [
        { owner: 'clone', tag: 'DIV', html: NOSCRIPT_HTML },
        { owner: 'clone', tag: 'DIV', html: BODY },
    ], 'exactly two parses, both in elements the clone owns');
    assert.equal(page.clone$.nsImg.src, NOSCRIPT_REAL, 'the noscript image still replaces its placeholder');
    assert.equal(article.content, BODY, 'the fixed-up content is what the parse produced');
});

// A pass that gives a clone image a new source (the lazy swap, the
// srcset fallback, the noscript fallback) leaves its live twin showing
// the OLD one: a 1x1 placeholder, an alt-text box, a broken-image icon.
// That layout says nothing about the new image, so those images are
// sized from their width/height attributes alone. Measured in Chromium
// 141, the live twins read as below (nw = naturalWidth, ow = offsetWidth).
test('an image a pass re-points is never stamped with its live placeholder\'s size', () => {
    const page = mirrorPage([
        h('html', {},
            h('body', {},
                h('article', {},
                    // <img data-src alt="Photo">: no src, an alt-text box (nw 0, ow 53x18)
                    h('img', { $key: 'altBox', 'data-src': 'https://cdn.example/photo.jpg', alt: 'Photo', $live: { offsetWidth: 53, offsetHeight: 18 } }),
                    // <img data-srcset alt="Chart">: the same, through the srcset pass
                    h('img', { $key: 'srcsetBox', 'data-srcset': 'https://cdn.example/chart.png 1x', alt: 'Chart', $live: { offsetWidth: 52, offsetHeight: 18 } }),
                    // a valid 1x1 placeholder (nw 1): stamped 1x1 before, on the live page too
                    h('img', { $key: 'onePx', src: PLACEHOLDER, 'data-src': 'https://cdn.example/big.jpg', $live: { naturalWidth: 1, naturalHeight: 1, offsetWidth: 1, offsetHeight: 1 } }),
                    // a broken placeholder: the broken-image icon (nw 0, ow 16x16)
                    h('img', { $key: 'broken', src: 'https://cdn.example/blank.png', 'data-src': 'https://cdn.example/big2.jpg', $live: { offsetWidth: 16, offsetHeight: 16 } }),
                    // the noscript fallback over a broken placeholder (nw 0, ow 36x18)
                    h('figure', {},
                        h('img', { $key: 'nsBox', src: 'https://cdn.example/placeholder.png', alt: 'N', $live: { offsetWidth: 36, offsetHeight: 18 } }),
                        h('noscript', {}, `<img src="${NOSCRIPT_REAL}" alt="Real">`)),
                    // a re-pointed image the page sizes itself: its attributes still count
                    h('img', { $key: 'sizedLazy', src: PLACEHOLDER, 'data-src': 'https://cdn.example/emoji.png', width: '20', height: '18', $live: { naturalWidth: 1, naturalHeight: 1, offsetWidth: 20 } }),
                    // control: an ordinary small image is still stamped from the live page
                    h('img', { $key: 'icon', src: 'https://cdn.example/icon.png', $live: { naturalWidth: 40, naturalHeight: 30 } }))))
    ]);
    const article = runCapture(ContentExtractor, page, { parse: parsed });
    assert.deepEqual(page.errors, []);
    assert.equal(typeof article, 'object', 'sanity: the capture got past the stubbed parse');
    assert.deepEqual(page.writes, []);

    const c = page.clone$;
    assert.equal(c.altBox.src, 'https://cdn.example/photo.jpg', 'sanity: the lazy pass re-pointed it');
    assert.equal(c.srcsetBox.src, 'https://cdn.example/chart.png', 'sanity: the srcset pass re-pointed it');
    assert.equal(c.nsBox.src, NOSCRIPT_REAL, 'sanity: the noscript pass re-pointed it');
    for (const k of ['altBox', 'srcsetBox', 'onePx', 'broken', 'nsBox']) {
        assert.deepEqual([c[k].getAttribute('width'), c[k].getAttribute('height'), c[k].classList.contains('xr-inline-img')],
            [null, null, false], `${k}: no stamp from the live placeholder`);
    }
    assert.deepEqual([c.sizedLazy.getAttribute('width'), c.sizedLazy.getAttribute('height'), c.sizedLazy.classList.contains('xr-inline-img')],
        ['20', '18', true], 'a re-pointed image with its own width/height is stamped from them');
    assert.deepEqual([c.icon.getAttribute('width'), c.icon.getAttribute('height')], ['40', '30'], 'control: the icon is stamped');
    const readFrom = new Set(page.layoutReads.map((r) => r.split('.')[0]));
    assert.deepEqual([...readFrom], ['icon'], 'layout is read only for the image no pass re-pointed');
});

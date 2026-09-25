// The Instagram capture's URL identity — field-found 2026-08-28.
//
// The maintainer captured a reel and the reader showed:
//     URL     https://www.instagram.com/latterdailysaints/reels/
//     AUTHOR  The Cougar Chronicle (@thecougchron)
// — the content of one account filed under ANOTHER account's address.
//
// Cause: `src/shared/platforms/instagram.js:843` read
//     const canonicalUrl = meta.url || canonicalUrlFor(postKind, shortcode, handle);
// so the page's unvalidated `og:url` OUTRANKED the URL X-Ray derives from
// window.location. og:url is page-controlled: it is not checked for host,
// for scheme, or for naming the shortcode the handler just resolved. The
// sibling Facebook handler already uses the safe order
// (src/shared/platforms/facebook.js:970 — construct first).
//
// This matters because that value becomes the event's `d` and `r` tags
// (src/shared/event-builder.js:178,181): a signed, public, machine-queryable
// assertion that content at address A is the content of address B.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};
globalThis.window = globalThis.window || {
    location: { hostname: 'www.instagram.com', pathname: '/reel/AbCdEf123/' }
};

const { canonicalPostUrl } = await import('../src/shared/platforms/instagram.js');

test('THE FIELD CASE: an og:url naming another account never becomes the identity', () => {
    const url = canonicalPostUrl({
        metaUrl: 'https://www.instagram.com/latterdailysaints/reels/',
        postKind: 'reel',
        shortcode: 'AbCdEf123'
    });
    assert.equal(url, 'https://www.instagram.com/reel/AbCdEf123/');
    assert.ok(!url.includes('latterdailysaints'),
        'the captured content is thecougchron’s reel; it must never be filed under another account’s address');
});

test('a hostile og:url on a foreign host can never reach the wire', () => {
    // og:url is fully page-controlled. Before the fix a page could name ANY
    // third-party address and X-Ray would publish a signed 30023 claiming it.
    for (const hostile of [
        'https://evil.example/nytimes.com/article',
        'http://www.instagram.com.evil.example/reel/AbCdEf123/',
        'javascript:alert(1)',
        'https://www.nytimes.com/2026/01/01/us/politics/story.html'
    ]) {
        const url = canonicalPostUrl({ metaUrl: hostile, postKind: 'reel', shortcode: 'AbCdEf123' });
        assert.equal(url, 'https://www.instagram.com/reel/AbCdEf123/', `hostile og:url survived: ${hostile}`);
    }
});

test('the constructed URL is derived from the path the user actually navigated to', () => {
    assert.equal(canonicalPostUrl({ metaUrl: '', postKind: 'reel', shortcode: 'X1' }),
        'https://www.instagram.com/reel/X1/');
    assert.equal(canonicalPostUrl({ metaUrl: '', postKind: 'igtv', shortcode: 'X2' }),
        'https://www.instagram.com/tv/X2/');
    assert.equal(canonicalPostUrl({ metaUrl: '', postKind: 'post', shortcode: 'X3' }),
        'https://www.instagram.com/p/X3/');
});

test('a user-prefixed path still normalizes to the stable post address', () => {
    // /<username>/reel/<shortcode>/ and /reel/<shortcode>/ are the same post;
    // one address keeps the archive and the wire from double-keying it.
    assert.equal(canonicalPostUrl({
        metaUrl: 'https://www.instagram.com/thecougchron/reel/AbCdEf123/',
        postKind: 'reel', shortcode: 'AbCdEf123'
    }), 'https://www.instagram.com/reel/AbCdEf123/');
});

test('with NO shortcode, a well-formed instagram og:url may stand in — anything else is null', () => {
    // Unreachable from synthesizeArticle (isInstagramPostPage guarantees a
    // shortcode), but the function must not fabricate ".../reel/null/".
    assert.equal(canonicalPostUrl({ metaUrl: 'https://www.instagram.com/p/Zz9/', postKind: 'post', shortcode: null }),
        'https://www.instagram.com/p/Zz9/');
    assert.equal(canonicalPostUrl({ metaUrl: 'https://evil.example/x', postKind: 'post', shortcode: null }), null);
    assert.equal(canonicalPostUrl({ metaUrl: '', postKind: 'post', shortcode: null }), null);
});

test('SEAM: synthesizeArticle uses the helper, and the raw og:url precedence is gone', () => {
    const src = readFileSync(new URL('../src/shared/platforms/instagram.js', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.ok(!/const canonicalUrl = meta\.url \|\|/.test(src),
        'the og:url-first precedence must not survive');
    assert.match(src, /const canonicalUrl = canonicalPostUrl\(/,
        'synthesizeArticle must resolve its URL through the guarded helper');
});

test('the Facebook sibling keeps the safe order this fix adopts', () => {
    const fb = readFileSync(new URL('../src/shared/platforms/facebook.js', import.meta.url), 'utf8');
    assert.match(fb, /const canonicalUrl = canonicalUrlFor\(postKind, postId, handle\) \|\| meta\.url/,
        'facebook.js is the in-repo precedent — if it changes, revisit instagram.js together');
});

// ------------------------------------------------------------------
// The Reels viewer — field-found 2026-09-25 (maintainer smoke of #368).
//
// A reel reached by in-app navigation inside Instagram's Reels viewer
// captured with AUTHOR blank, no Instagram header, and URL
// `https://www.instagram.com/reel/DcwbjmXy0B5` (no trailing slash — the
// generic extractor's normalizeUrl). The viewer's address is
// `/reels/<shortcode>/` (PLURAL): the URL grammar did not know it, so
// isInstagramPostPage() was false, synthesizeArticle() returned null, and
// the capture fell through to the GENERIC extractor, which takes its URL
// from link[rel=canonical] → og:url — the page head #368 exists to stop
// trusting.
// ------------------------------------------------------------------

const ig = await import('../src/shared/platforms/instagram.js');
const REELS_VIEWER = 'https://www.instagram.com/reels/DcwbjmXy0B5/';

test('REELS VIEWER: /reels/<shortcode>/ resolves the shortcode', () => {
    assert.equal(ig.shortcodeFromUrl(REELS_VIEWER), 'DcwbjmXy0B5');
    assert.equal(ig.shortcodeFromUrl('https://m.instagram.com/reels/DcwbjmXy0B5'), 'DcwbjmXy0B5');
});

test('REELS VIEWER: /reels/<shortcode>/ is a reel, and its address is the singular /reel/<shortcode>/', () => {
    assert.equal(typeof ig.postKindFromPath, 'function', 'the post kind needs a pure surface');
    assert.equal(ig.postKindFromPath('/reels/DcwbjmXy0B5/'), 'reel');
    assert.equal(ig.postKindFromPath('/reel/DcwbjmXy0B5/'), 'reel');
    assert.equal(ig.postKindFromPath('/tv/DcwbjmXy0B5/'), 'igtv');
    assert.equal(ig.postKindFromPath('/p/DcwbjmXy0B5/'), 'post');
    assert.equal(ig.canonicalPostUrl({
        metaUrl: '',
        postKind: ig.postKindFromPath(new URL(REELS_VIEWER).pathname),
        shortcode: ig.shortcodeFromUrl(REELS_VIEWER)
    }), 'https://www.instagram.com/reel/DcwbjmXy0B5/');
});

test('REELS VIEWER: the grammar admits ONLY /reels/<code>/ — listing pages stay non-posts', () => {
    for (const path of [
        '/reels/',                        // the Reels feed landing page — no code
        '/latterdailysaints/reels/',      // a profile's reels GRID — #368's stale og:url
        '/latterdailysaints/reels/DcwbjmXy0B5/', // user-prefixed plural is not a shape Instagram serves
        '/reels/audio/1234567890/',       // the audio page lists reels by sound — "audio" is not a code
        '/explore/',
        '/latterdailysaints/',
        '/stories/latterdailysaints/3456789012345678901/'
    ]) {
        assert.equal(ig.shortcodeFromUrl('https://www.instagram.com' + path), null, `${path} must not resolve a shortcode`);
    }
});

// ------------------------------------------------------------------
// The stale head — same bug class as #368, one layer down.
//
// When the head's og:url names a DIFFERENT page than window.location (a
// profile grid, another reel, a foreign host), the head was rendered for
// that page and never updated across the SPA navigation. Every og field
// then describes that other page: its author, its caption, its image, its
// counts. An absent author is honest; a wrong one is the bug.
// ------------------------------------------------------------------

test('headMatchesLocation: the head speaks for this capture only when its og:url names the same shortcode', () => {
    assert.equal(typeof ig.headMatchesLocation, 'function');
    const h = ig.headMatchesLocation;
    assert.equal(h('', 'DcwbjmXy0B5'), true, 'no og:url — nothing contradicts the head (unchanged behaviour)');
    assert.equal(h('https://www.instagram.com/reel/DcwbjmXy0B5/', 'DcwbjmXy0B5'), true);
    assert.equal(h('https://www.instagram.com/jeffdye/reel/DcwbjmXy0B5/', 'DcwbjmXy0B5'), true);
    assert.equal(h('https://www.instagram.com/p/DcwbjmXy0B5/', 'DcwbjmXy0B5'), true);
    assert.equal(h('https://www.instagram.com/latterdailysaints/reels/', 'DcwbjmXy0B5'), false, 'a profile grid head');
    assert.equal(h('https://www.instagram.com/reel/SomeOtherReel/', 'DcwbjmXy0B5'), false, 'the previous reel');
    assert.equal(h('https://evil.example/reel/DcwbjmXy0B5/', 'DcwbjmXy0B5'), false, 'a foreign host');
});

// SEAM — synthesizeArticle itself, under a stubbed location + head. The
// helpers above can be right while the handler ignores them; these drive
// the function the content script actually calls.
function at(url, metaTags) {
    const u = new URL(url);
    globalThis.window.location = { href: u.href, hostname: u.hostname, pathname: u.pathname };
    globalThis.document = {
        querySelector(sel) {
            const m = sel.match(/^meta\[(property|name)="([^"]+)"\]$/);
            if (!m || !(m[2] in metaTags)) return null;
            return { getAttribute: () => metaTags[m[2]] };
        },
        querySelectorAll: () => []
    };
}
async function capture(url, metaTags) {
    at(url, metaTags);
    const log = console.log, warn = console.warn;
    console.log = console.warn = () => {};
    try { return await ig.synthesizeArticle(); }
    finally { console.log = log; console.warn = warn; }
}

// Instagram's real head formats (instagram.js extractMetaFields /
// extractHandleFromMeta / extractAuthorFromTitle comments).
const JEFF_REEL_HEAD = {
    'og:url':         'https://www.instagram.com/reel/DcwbjmXy0B5/',
    'og:title':       'Jeff Dye on Instagram: "No one cares about self driving cars"',
    'og:description': '12K likes, 150 comments - jeffdye on September 20, 2026: "No one cares about self driving cars"',
    'og:image':       'https://scontent.cdninstagram.com/v/jeff-reel-cover.jpg',
    'og:type':        'video.other',
    'og:site_name':   'Instagram'
};
// The head of ANOTHER account's reel, still in place after an in-app hop.
const STALE_OTHER_REEL_HEAD = {
    'og:url':         'https://www.instagram.com/reel/PrevReel99/',
    'og:title':       'Latter Daily Saints on Instagram: "Sunday thoughts"',
    'og:description': '999 likes, 42 comments - Latter Daily Saints (@latterdailysaints) on Instagram: "Sunday thoughts"',
    'og:image':       'https://scontent.cdninstagram.com/v/prev-reel-cover.jpg',
    'og:video':       'https://scontent.cdninstagram.com/v/prev-reel.mp4',
    'twitter:label1': 'Likes',    'twitter:data1': '999',
    'twitter:label2': 'Comments', 'twitter:data2': '42'
};
// The head of a profile's Reels grid — #368's field case.
const STALE_GRID_HEAD = {
    'og:url':         'https://www.instagram.com/latterdailysaints/reels/',
    'og:title':       'Latter Daily Saints (@latterdailysaints) • Instagram photos and videos',
    'og:description': '12K Followers, 300 Following, 500 Posts - See Instagram photos and videos from Latter Daily Saints (@latterdailysaints)',
    'og:image':       'https://scontent.cdninstagram.com/v/latterdailysaints-avatar.jpg'
};

function assertNothingFrom(a, who, why) {
    const blob = JSON.stringify({ byline: a.byline, title: a.title, author: a.instagram.author,
        excerpt: a.excerpt, markdown: a.markdown, featuredImage: a.featuredImage, video: a.instagram.videoUrl });
    for (const needle of who) assert.ok(!blob.includes(needle), `${why}: "${needle}" leaked into the capture`);
}

test('SEAM: the Reels viewer runs the INSTAGRAM path — constructed URL (trailing slash), author from a fresh head', async () => {
    const a = await capture(REELS_VIEWER, JEFF_REEL_HEAD);
    assert.ok(a, 'synthesizeArticle must handle /reels/<code>/ — null means the generic extractor took it');
    assert.equal(a.platform, 'instagram');
    assert.equal(a.url, 'https://www.instagram.com/reel/DcwbjmXy0B5/');
    assert.equal(a.instagram.postKind, 'reel');
    assert.equal(a.instagram.author.nickname, 'Jeff Dye');
    assert.equal(a.instagram.author.handle, 'jeffdye');
    assert.equal(a.featuredImage, JEFF_REEL_HEAD['og:image'], 'a matching head keeps its image');
});

test('SEAM: a stale head from ANOTHER reel contributes nothing — author, caption, image, video, counts', async () => {
    for (const url of ['https://www.instagram.com/reel/DcwbjmXy0B5/', REELS_VIEWER]) {
        const a = await capture(url, STALE_OTHER_REEL_HEAD);
        assert.ok(a, `${url} must be handled by the Instagram path`);
        assert.equal(a.url, 'https://www.instagram.com/reel/DcwbjmXy0B5/');
        assertNothingFrom(a, ['latterdailysaints', 'Latter Daily Saints', 'Sunday thoughts', 'prev-reel'], url);
        assert.equal(a.featuredImage, null);
        assert.deepEqual(a.engagement, { likes: 0, comments: 0, views: 0 }, 'the previous reel’s counts are not this reel’s');
    }
});

test('SEAM: a stale profile-grid head (#368 field case) contributes no author and no caption', async () => {
    const a = await capture('https://www.instagram.com/reel/DcwbjmXy0B5/', STALE_GRID_HEAD);
    assert.equal(a.url, 'https://www.instagram.com/reel/DcwbjmXy0B5/');
    assertNothingFrom(a, ['latterdailysaints', 'Latter Daily Saints', 'Followers', 'avatar'], 'grid head');
    assert.equal(a.instagram.author.handle, null, 'an absent author is honest; a wrong one is the bug');
});

test('SEAM: the location-derived handle survives a stale head', async () => {
    const a = await capture('https://www.instagram.com/jeffdye/reel/DcwbjmXy0B5/', STALE_GRID_HEAD);
    assert.equal(a.instagram.author.handle, 'jeffdye');
    assertNothingFrom(a, ['latterdailysaints', 'Latter Daily Saints'], 'user-prefixed path under a grid head');
});

test('SEAM: with NO og:url the head is used exactly as before', async () => {
    const { 'og:url': _drop, ...noUrl } = JEFF_REEL_HEAD;
    const a = await capture('https://www.instagram.com/reel/DcwbjmXy0B5/', noUrl);
    assert.equal(a.instagram.author.nickname, 'Jeff Dye');
    assert.equal(a.instagram.author.handle, 'jeffdye');
    assert.equal(a.featuredImage, JEFF_REEL_HEAD['og:image']);
});

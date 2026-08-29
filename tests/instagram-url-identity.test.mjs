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

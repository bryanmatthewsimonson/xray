// URL identity (url-identity.js): recovering the ORIGINAL URL from
// archive/mirror captures — original-as-identity with fail-open
// provenance honesty. Stub-document pattern (no jsdom): the DOM-marker
// path gets hand-built querySelector/querySelectorAll objects.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { resolveUrlIdentity, resolveUrlIdentityFromUrl } =
    await import('../src/shared/url-identity.js');
const { normalize } = await import('../src/shared/metadata/url-normalizer.js');

// A stub document: `hidden` fills input#HIDDEN_URL, `headerHrefs`
// fills the #HEADER anchor list in order.
function stubDoc({ hidden = null, headerHrefs = [] } = {}) {
    return {
        querySelector: (sel) =>
            (sel === 'input#HIDDEN_URL' && hidden) ? { value: hidden } : null,
        querySelectorAll: (sel) =>
            sel === '#HEADER a[href]'
                ? headerHrefs.map((h) => ({ getAttribute: () => h }))
                : []
    };
}

// --- ordinary pages: not our business -----------------------------------------

test('ordinary pages resolve to null', () => {
    assert.equal(resolveUrlIdentityFromUrl('https://example.com/story'), null);
    assert.equal(resolveUrlIdentityFromUrl('https://www.nytimes.com/2020/03/01/x.html'), null);
    assert.equal(resolveUrlIdentityFromUrl(''), null);
    assert.equal(resolveUrlIdentityFromUrl(null), null);
    assert.equal(resolveUrlIdentityFromUrl('not a url'), null);
    assert.equal(resolveUrlIdentityFromUrl('file:///tmp/paper.pdf'), null);
    assert.equal(resolveUrlIdentity(stubDoc(), 'https://example.com/story'), null);
});

test('arxiv abs pages are already canonical — null, not an alias of themselves', () => {
    assert.equal(resolveUrlIdentityFromUrl('https://arxiv.org/abs/2301.12345'), null);
});

// --- wayback: original embedded in the path ------------------------------------

test('wayback: plain timestamp form recovers the original', () => {
    const r = resolveUrlIdentityFromUrl(
        'https://web.archive.org/web/20200301000000/https://example.com/story?b=2&a=1');
    assert.ok(r);
    assert.equal(r.archiveHost, 'web.archive.org');
    assert.equal(r.original, 'https://example.com/story?a=1&b=2',
        'recovered original runs through the unified normalizer');
    assert.equal(r.captureUrl,
        'https://web.archive.org/web/20200301000000/https://example.com/story?b=2&a=1',
        'the capture URL stays as fetched — it must keep working as an address');
});

test('wayback: rendering modifiers (if_, im_, id_) select a rendering, not a document', () => {
    for (const mod of ['if_', 'im_', 'id_', 'js_']) {
        const r = resolveUrlIdentityFromUrl(
            `https://web.archive.org/web/20200301000000${mod}/https://example.com/story`);
        assert.equal(r.original, 'https://example.com/story', mod);
    }
});

test('wayback: collapsed https:/ scheme is repaired', () => {
    const r = resolveUrlIdentityFromUrl(
        'https://web.archive.org/web/20200301000000/https:/example.com/story');
    assert.equal(r.original, 'https://example.com/story');
});

test('wayback: tracking params inside the embedded original are stripped from identity', () => {
    const r = resolveUrlIdentityFromUrl(
        'https://web.archive.org/web/2020/https://example.com/story?utm_source=tw&id=5');
    assert.equal(r.original, 'https://example.com/story?id=5');
});

test('wayback: unparseable embed fails OPEN — archive noted, nothing claimed', () => {
    const r = resolveUrlIdentityFromUrl('https://web.archive.org/web/20200301000000/garbage');
    assert.ok(r);
    assert.equal(r.archiveHost, 'web.archive.org');
    assert.equal(r.original, null);

    const bare = resolveUrlIdentityFromUrl('https://web.archive.org/');
    assert.ok(bare);
    assert.equal(bare.original, null);
});

test('wayback: an embedded archive-family URL is never adopted as the original', () => {
    const r = resolveUrlIdentityFromUrl(
        'https://web.archive.org/web/2020/https://archive.ph/AbC12');
    assert.equal(r.original, null, 'archive-of-an-archive claims nothing');
});

// --- archive.today family: path forms ------------------------------------------

test('archive.today deep links (newest/oldest/timestamp) recover the original', () => {
    for (const host of ['archive.ph', 'archive.is', 'archive.today', 'archive.md']) {
        const r = resolveUrlIdentityFromUrl(`https://${host}/newest/https://example.com/story`);
        assert.ok(r, host);
        assert.equal(r.archiveHost, host);
        assert.equal(r.original, 'https://example.com/story');
    }
    const ts = resolveUrlIdentityFromUrl(
        'https://archive.ph/20200301000000/https://example.com/story/');
    assert.equal(ts.original, 'https://example.com/story', 'trailing slash normalized');
    const oldest = resolveUrlIdentityFromUrl('https://archive.ph/oldest/https://example.com/a');
    assert.equal(oldest.original, 'https://example.com/a');
});

test('archive.today short-code URL alone recovers nothing (needs the DOM)', () => {
    const r = resolveUrlIdentityFromUrl('https://archive.ph/AbC12');
    assert.ok(r);
    assert.equal(r.archiveHost, 'archive.ph');
    assert.equal(r.original, null);
});

// --- archive.today family: DOM markers ------------------------------------------

test('archive.today DOM: input#HIDDEN_URL is the first-trust marker', () => {
    const doc = stubDoc({ hidden: 'https://example.com/story?utm_source=share&b=2&a=1' });
    const r = resolveUrlIdentity(doc, 'https://archive.ph/AbC12');
    assert.ok(r);
    assert.equal(r.original, 'https://example.com/story?a=1&b=2', 'normalized');
    assert.equal(r.captureUrl, 'https://archive.ph/AbC12');
});

test('archive.today DOM: header anchors are the fallback; self-links rejected', () => {
    const doc = stubDoc({
        headerHrefs: [
            'https://archive.ph/',                    // self — rejected
            'https://archive.ph/AbC12/again',         // self — rejected
            'https://archive.md/other-snapshot',      // sibling mirror — rejected
            'https://example.com/story',              // the "saved from" link
            'https://example.com/other'               // later candidates ignored
        ]
    });
    const r = resolveUrlIdentity(doc, 'https://archive.ph/AbC12');
    assert.equal(r.original, 'https://example.com/story');
});

test('archive.today DOM: HIDDEN_URL wins over header anchors', () => {
    const doc = stubDoc({
        hidden: 'https://example.com/from-input',
        headerHrefs: ['https://example.com/from-header']
    });
    const r = resolveUrlIdentity(doc, 'https://archive.ph/AbC12');
    assert.equal(r.original, 'https://example.com/from-input');
});

test('archive.today DOM: marker drift fails OPEN — never a wrong original', () => {
    // No markers at all.
    const empty = resolveUrlIdentity(stubDoc(), 'https://archive.ph/AbC12');
    assert.equal(empty.original, null);
    assert.equal(empty.archiveHost, 'archive.ph');
    // Markers present but garbage / non-http.
    const junk = resolveUrlIdentity(stubDoc({
        hidden: 'javascript:void(0)',
        headerHrefs: ['/relative/path', 'mailto:x@y.z', 'https://archive.ph/self']
    }), 'https://archive.ph/AbC12');
    assert.equal(junk.original, null);
    // A null/DOM-less call degrades the same way.
    const noDoc = resolveUrlIdentity(null, 'https://archive.ph/AbC12');
    assert.equal(noDoc.original, null);
});

test('DOM markers are consulted ONLY for archive.today hosts', () => {
    // A wayback page whose DOM happens to carry a HIDDEN_URL-shaped
    // input must not have it adopted — wayback originals come from the
    // URL structure alone. The host still reads as an archive (honest
    // "not recovered"), but the planted marker is never consulted.
    const doc = stubDoc({ hidden: 'https://attacker.example/planted' });
    const r = resolveUrlIdentity(doc, 'https://web.archive.org/web/notatimestamp/x');
    assert.ok(r);
    assert.equal(r.archiveHost, 'web.archive.org');
    assert.equal(r.original, null, 'the planted DOM marker is not adopted');
    const bare = resolveUrlIdentity(doc, 'https://web.archive.org/');
    assert.ok(bare);
    assert.equal(bare.original, null);
});

// --- arXiv rendering variants ----------------------------------------------------

test('arxiv: pdf/html variants collapse to the abs page', () => {
    const cases = [
        ['https://arxiv.org/pdf/2301.12345',        'https://arxiv.org/abs/2301.12345'],
        ['https://arxiv.org/pdf/2301.12345.pdf',    'https://arxiv.org/abs/2301.12345'],
        ['https://arxiv.org/pdf/2301.12345v2',      'https://arxiv.org/abs/2301.12345v2'],
        ['https://www.arxiv.org/pdf/2301.12345',    'https://arxiv.org/abs/2301.12345'],
        ['https://arxiv.org/html/2301.12345',       'https://arxiv.org/abs/2301.12345'],
        ['https://arxiv.org/pdf/math/0309136',      'https://arxiv.org/abs/math/0309136'],
        ['https://ar5iv.org/abs/2301.12345',        'https://arxiv.org/abs/2301.12345'],
        ['https://ar5iv.labs.arxiv.org/html/2301.12345', 'https://arxiv.org/abs/2301.12345']
    ];
    for (const [input, expected] of cases) {
        const r = resolveUrlIdentityFromUrl(input);
        assert.ok(r, input);
        assert.equal(r.original, expected, input);
        assert.equal(r.captureUrl, input);
    }
});

test('arxiv: non-paper paths are not aliases', () => {
    assert.equal(resolveUrlIdentityFromUrl('https://arxiv.org/list/cs.AI/recent'), null);
    assert.equal(resolveUrlIdentityFromUrl('https://arxiv.org/'), null);
});

// --- the load-bearing property ---------------------------------------------------

test('an archive capture keys IDENTICALLY to a direct capture of the original', () => {
    const direct = normalize('https://Example.COM/story/?utm_source=x&b=2&a=1');
    const viaWayback = resolveUrlIdentityFromUrl(
        'https://web.archive.org/web/2020/https://Example.COM/story/?utm_source=x&b=2&a=1').original;
    const viaArchiveToday = resolveUrlIdentity(
        stubDoc({ hidden: 'https://Example.COM/story/?utm_source=x&b=2&a=1' }),
        'https://archive.ph/AbC12').original;
    assert.equal(viaWayback, direct);
    assert.equal(viaArchiveToday, direct);
});

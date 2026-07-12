// URL identity (url-identity.js): recovering the ORIGINAL URL from
// archive/mirror captures — original-as-identity with fail-open
// provenance honesty. Stub-document pattern (no jsdom): the DOM-marker
// path gets hand-built querySelector/querySelectorAll objects.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { resolveUrlIdentity, resolveUrlIdentityFromUrl } =
    await import('../src/shared/url-identity.js');
const { normalize } = await import('../src/shared/metadata/url-normalizer.js');

// A stub document: `hidden` fills input#HIDDEN_URL, `headerAnchors`
// fills the #HEADER anchor list in order. Entries are either a bare
// string (an anchor whose visible text IS its href — the "saved from"
// shape) or {href, text} for labeled links (logo/share/donate).
function stubDoc({ hidden = null, headerAnchors = [] } = {}) {
    const anchors = headerAnchors.map((a) => {
        const { href, text } = typeof a === 'string' ? { href: a, text: a } : a;
        return { getAttribute: () => href, textContent: text };
    });
    return {
        querySelector: (sel) =>
            (sel === 'input#HIDDEN_URL' && hidden) ? { value: hidden } : null,
        querySelectorAll: (sel) => (sel === '#HEADER a[href]' ? anchors : [])
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

test('archive.today DOM: only the text-equals-href ("saved from") anchor qualifies', () => {
    const doc = stubDoc({
        headerAnchors: [
            'https://archive.ph/',                                          // self — rejected
            'https://archive.ph/AbC12/again',                               // self — rejected
            'https://archive.md/other-snapshot',                            // sibling mirror — rejected
            { href: 'https://blog.archive.today/announce', text: 'blog' },  // archive SUBDOMAIN — rejected
            { href: 'https://buymeacoffee.example/donate', text: 'donate' },// labeled link — never a candidate
            'https://example.com/story'                                     // saved-from: text IS the href
        ]
    });
    const r = resolveUrlIdentity(doc, 'https://archive.ph/AbC12');
    assert.equal(r.original, 'https://example.com/story');
});

test('archive.today DOM: two distinct qualifying header URLs = ambiguous = fail open', () => {
    const doc = stubDoc({
        headerAnchors: ['https://example.com/story', 'https://elsewhere.example/other']
    });
    const r = resolveUrlIdentity(doc, 'https://archive.ph/AbC12');
    assert.equal(r.original, null,
        'first-plausible-wins would adopt whichever came first — a wrong original');
});

test('archive.today DOM: archive-family subdomains are never adopted (even via HIDDEN_URL)', () => {
    const r = resolveUrlIdentity(
        stubDoc({ hidden: 'https://blog.archive.today/announcement' }),
        'https://archive.ph/AbC12');
    assert.equal(r.original, null);
});

test('archive.today DOM: HIDDEN_URL wins over header anchors', () => {
    const doc = stubDoc({
        hidden: 'https://example.com/from-input',
        headerAnchors: ['https://example.com/from-header']
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
        headerAnchors: ['/relative/path', 'mailto:x@y.z', 'https://archive.ph/self']
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

// --- embedded originals are canonicalized (review 2026-07-10) -----------------

test('an arXiv variant embedded in an archive path canonicalizes to /abs/', () => {
    // Without this, an archived arXiv PDF keys to /pdf/ while a direct
    // capture keys to /abs/ — the exact fork the module prevents.
    const wb = resolveUrlIdentityFromUrl(
        'https://web.archive.org/web/2020/https://arxiv.org/pdf/2301.12345');
    assert.equal(wb.original, 'https://arxiv.org/abs/2301.12345');

    const at = resolveUrlIdentityFromUrl(
        'https://archive.ph/newest/https://arxiv.org/pdf/2301.12345v2.pdf');
    assert.equal(at.original, 'https://arxiv.org/abs/2301.12345v2');

    const dom = resolveUrlIdentity(
        stubDoc({ hidden: 'https://ar5iv.org/abs/2301.12345' }),
        'https://archive.ph/AbC12');
    assert.equal(dom.original, 'https://arxiv.org/abs/2301.12345');
});

// --- rewriteArchivedLinks (the link-tag fix for archive captures) --------------

const { rewriteArchivedLinks } = await import('../src/shared/url-identity.js');

test('rewriteArchivedLinks: wayback-wrapped links unwrap to their originals', () => {
    // Wayback rewrites every body anchor onto its own host — as
    // extracted, every outbound link reads archive-internal and ZERO
    // link tags would publish. After the identity rewrite they re-key.
    const links = [
        { url: 'https://web.archive.org/web/2020/https://other.org/paper', text: 'the study', count: 1, internal: true },
        { url: 'https://web.archive.org/web/2020if_/https://example.com/related', text: 'related', count: 2, internal: true },
        { url: 'https://web.archive.org/web/2020/https://arxiv.org/pdf/2301.12345', text: 'preprint', count: 1, internal: true },
        // Archive navigation chrome — no embedded target — dropped.
        { url: 'https://web.archive.org/about', text: 'about the archive', count: 1, internal: true },
        // A plain link that was never archive-wrapped passes through.
        { url: 'https://plain.example/x', text: 'plain', count: 1, internal: false }
    ];
    const out = rewriteArchivedLinks(links, 'example.com');
    assert.deepEqual(out, [
        { url: 'https://other.org/paper', text: 'the study', count: 1, internal: false },
        { url: 'https://example.com/related', text: 'related', count: 2, internal: true },
        { url: 'https://arxiv.org/abs/2301.12345', text: 'preprint', count: 1, internal: false },
        { url: 'https://plain.example/x', text: 'plain', count: 1, internal: false }
    ]);
});

test('rewriteArchivedLinks: unwrapped duplicates re-merge, counts summed', () => {
    const out = rewriteArchivedLinks([
        { url: 'https://web.archive.org/web/2020/https://other.org/paper?utm_source=x', text: 'first', count: 2, internal: true },
        { url: 'https://other.org/paper', text: 'second', count: 3, internal: false }
    ], 'example.com');
    assert.equal(out.length, 1);
    assert.equal(out[0].url, 'https://other.org/paper');
    assert.equal(out[0].count, 5);
    assert.equal(out[0].text, 'first');
});

test('rewriteArchivedLinks: degrades safely on junk', () => {
    assert.deepEqual(rewriteArchivedLinks(null, 'example.com'), []);
    assert.deepEqual(rewriteArchivedLinks([null, { text: 'no url' }], 'example.com'), []);
});

// --- the archive.ph field bug (JOURNAL 2026-07-10, screenshots) ----------------

test('archive.today DOTTED long form (its own rel=canonical shape) recovers', () => {
    // The exact capture that failed in the field: archive.ph emits
    // /YYYY.MM.DD-HHMMSS/<original> in its canonical URL; the regex
    // only accepted digit runs (the Wayback shape).
    const r = resolveUrlIdentityFromUrl(
        'https://archive.ph/2021.03.29-224620/https://www.nytimes.com/2021/03/29/world/asia/china-virus-WHO-report.html');
    assert.ok(r);
    assert.equal(r.original, 'https://www.nytimes.com/2021/03/29/world/asia/china-virus-WHO-report.html');
});

test('short-code tab + long-form canonical: the canonical URL recovers the original', () => {
    // Tab = archive.ph/RTy0g (no embedded original); the extractor's
    // canonical pick is the long form. Pure URL structure — no DOM.
    const r = resolveUrlIdentity(
        stubDoc(),   // no DOM markers at all
        'https://archive.ph/RTy0g',
        'https://archive.ph/2021.03.29-224620/https://www.nytimes.com/2021/03/29/world/asia/china-virus-WHO-report.html');
    assert.ok(r);
    assert.equal(r.original, 'https://www.nytimes.com/2021/03/29/world/asia/china-virus-WHO-report.html');
    assert.equal(r.captureUrl, 'https://archive.ph/RTy0g',
        'captureUrl stays the address actually fetched');
});

test('canonical fallback never crosses archive families or invents originals', () => {
    // A canonical on a DIFFERENT archive family is not trusted.
    const cross = resolveUrlIdentity(stubDoc(), 'https://archive.ph/AbC12',
        'https://web.archive.org/web/2020/https://example.com/x');
    assert.equal(cross.original, null);
    // A non-archive canonical contributes nothing.
    const plain = resolveUrlIdentity(stubDoc(), 'https://archive.ph/AbC12',
        'https://example.com/direct');
    assert.equal(plain.original, null);
});

test('archive.today "saved from" INPUT value is a qualifying marker', () => {
    // The live archive.ph header renders the original in a form INPUT
    // (screenshot-verified), not an anchor.
    const doc = {
        querySelector: () => null,   // no HIDDEN_URL
        querySelectorAll: (sel) => sel === '#HEADER input, form input'
            ? [{ value: 'https://www.nytimes.com/2021/03/29/world/asia/china-virus-WHO-report.html' }]
            : []
    };
    const r = resolveUrlIdentity(doc, 'https://archive.ph/RTy0g');
    assert.equal(r.original, 'https://www.nytimes.com/2021/03/29/world/asia/china-virus-WHO-report.html');
});

test('saved-from input: two distinct qualifying values = ambiguous = fail open', () => {
    const doc = {
        querySelector: () => null,
        querySelectorAll: (sel) => sel === '#HEADER input, form input'
            ? [{ value: 'https://a.example/one' }, { value: 'https://b.example/two' }]
            : []
    };
    const r = resolveUrlIdentity(doc, 'https://archive.ph/RTy0g');
    assert.equal(r.original, null);
});

// ── Mirror registry: Google cache / 12ft / AMP caches / ghostarchive ──

test('google cache: /search?q=cache:<url> unwraps; digest and scheme-less forms too', () => {
    const direct = resolveUrlIdentityFromUrl(
        'https://webcache.googleusercontent.com/search?q=cache:https://example.com/story?id=2');
    assert.equal(direct.original, normalize('https://example.com/story?id=2'));
    assert.equal(direct.archiveHost, 'webcache.googleusercontent.com');

    const schemeless = resolveUrlIdentityFromUrl(
        'https://webcache.googleusercontent.com/search?q=cache:example.com/story');
    assert.equal(schemeless.original, normalize('https://example.com/story'));

    const digest = resolveUrlIdentityFromUrl(
        'https://webcache.googleusercontent.com/search?q=cache:AbCdEf123xyz:https://example.com/story');
    assert.equal(digest.original, normalize('https://example.com/story'));

    // Not a cache query — recognized host, nothing recoverable.
    const noCache = resolveUrlIdentityFromUrl(
        'https://webcache.googleusercontent.com/search?q=plain+words');
    assert.equal(noCache.original, null);
});

test('12ft.io: /proxy?q= and path-appended forms unwrap; bare page does not', () => {
    const proxy = resolveUrlIdentityFromUrl('https://12ft.io/proxy?q=https://example.com/story');
    assert.equal(proxy.original, normalize('https://example.com/story'));
    assert.equal(proxy.archiveHost, '12ft.io');

    // RAW-string path form: the inner URL's query must survive.
    const path = resolveUrlIdentityFromUrl('https://12ft.io/https://example.com/story?id=2');
    assert.equal(path.original, normalize('https://example.com/story?id=2'));

    assert.equal(resolveUrlIdentityFromUrl('https://12ft.io/').original, null);
});

test('AMP cache: /c/s/ (https) and /c/ (http) unwrap; cache-owned params dropped', () => {
    const https = resolveUrlIdentityFromUrl(
        'https://example-com.cdn.ampproject.org/c/s/example.com/news/story.amp.html');
    assert.equal(https.original, normalize('https://example.com/news/story.amp.html'));
    assert.equal(https.archiveHost, 'example-com.cdn.ampproject.org');

    const http = resolveUrlIdentityFromUrl(
        'https://example-com.cdn.ampproject.org/c/example.com/legacy/story');
    assert.equal(http.original, normalize('http://example.com/legacy/story'));

    const params = resolveUrlIdentityFromUrl(
        'https://example-com.cdn.ampproject.org/v/s/example.com/story?id=2&amp_js_v=a6&usqp=mq331AQA');
    assert.equal(params.original, normalize('https://example.com/story?id=2'),
        'the original keeps its own params, loses the cache viewer params');
});

test('ghostarchive: /varchive/<id> recovers the YouTube URL; /archive/<code> honestly does not', () => {
    const video = resolveUrlIdentityFromUrl('https://ghostarchive.org/varchive/dQw4w9WgXcQ');
    assert.equal(video.original, normalize('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
    assert.equal(video.archiveHost, 'ghostarchive.org');

    const snapshot = resolveUrlIdentityFromUrl('https://ghostarchive.org/archive/AbC12');
    assert.equal(snapshot.original, null, 'opaque snapshot — recognized host, no original');
    assert.equal(snapshot.archiveHost, 'ghostarchive.org');
});

test('nested wrappers unwrap: wayback-of-12ft-of-X keys to X', () => {
    const nested = resolveUrlIdentityFromUrl(
        'https://web.archive.org/web/20240101000000/https://12ft.io/proxy?q=https://example.com/story');
    assert.equal(nested.original, normalize('https://example.com/story'));
    assert.equal(nested.archiveHost, 'web.archive.org', 'provenance names the outer host');
});

test('a mirror host is never adopted as "the original"', () => {
    // Wayback of a bare 12ft page (nothing to unwrap inside).
    const r = resolveUrlIdentityFromUrl(
        'https://web.archive.org/web/20240101000000/https://12ft.io/');
    assert.equal(r.original, null);
});

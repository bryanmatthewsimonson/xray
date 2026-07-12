// Outbound-link extraction (ContentExtractor.extractOutboundLinks):
// the structured source for the `link` wire tag. Stub-element
// pattern — the extractor is pure over the passed root, so tests drive
// it with hand-built anchor objects (no jsdom).

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { ContentExtractor } = await import('../src/shared/content-extractor.js');
const { normalize } = await import('../src/shared/metadata/url-normalizer.js');

function anchor(href, text = '') {
    return { getAttribute: (n) => (n === 'href' ? href : null), textContent: text };
}

function stubRoot(anchors) {
    return { querySelectorAll: (sel) => (sel === 'a[href]' ? anchors : []) };
}

const BASE = 'https://example.com/story';

test('extracts, resolves relative, and classifies internal vs external', () => {
    const { links, truncated } = ContentExtractor.extractOutboundLinks(stubRoot([
        anchor('https://other.org/paper', 'the study'),
        anchor('/about', 'about us'),
        anchor('https://www.example.com/related', 'related piece')
    ]), BASE, 'example.com');
    assert.equal(truncated, false);
    assert.equal(links.length, 3);
    assert.deepEqual(links[0], { url: 'https://other.org/paper', text: 'the study', count: 1, internal: false });
    assert.equal(links[1].url, 'https://example.com/about', 'relative resolved against the base');
    assert.equal(links[1].internal, true);
    assert.equal(links[2].internal, true, 'www. prefix is the same host');
});

test('dedupes through the unified normalizer; repeats count', () => {
    const { links } = ContentExtractor.extractOutboundLinks(stubRoot([
        anchor('https://other.org/paper?utm_source=tw&b=2&a=1', 'first text wins'),
        anchor('https://other.org/paper?a=1&b=2', 'second text ignored'),
        anchor('https://other.org/paper?b=2&a=1#frag', 'third')
    ]), BASE, 'example.com');
    assert.equal(links.length, 1, 'one target, three surface forms');
    assert.equal(links[0].url, normalize('https://other.org/paper?b=2&a=1'));
    assert.equal(links[0].text, 'first text wins');
    assert.equal(links[0].count, 3);
});

test('skips fragments, mailto, javascript, tel, and unparseable hrefs', () => {
    const { links } = ContentExtractor.extractOutboundLinks(stubRoot([
        anchor('#footnote-3'),
        anchor('mailto:tips@example.com'),
        anchor('javascript:void(0)'),
        anchor('tel:+15551234567'),
        anchor(''),
        anchor('https://kept.org/x', 'kept')
    ]), BASE, 'example.com');
    assert.equal(links.length, 1);
    assert.equal(links[0].url, 'https://kept.org/x');
});

test('anchor text is whitespace-collapsed and bounded to 200 chars', () => {
    const { links } = ContentExtractor.extractOutboundLinks(stubRoot([
        anchor('https://other.org/a', '  the\n\n  quick   study\t'),
        anchor('https://other.org/b', 'y'.repeat(500))
    ]), BASE, 'example.com');
    assert.equal(links[0].text, 'the quick study');
    assert.equal(links[1].text.length, 200);
});

test('cap: first N distinct targets kept in document order, honest truncated flag', () => {
    const anchors = [];
    for (let i = 0; i < 8; i++) anchors.push(anchor(`https://site${i}.org/x`, `s${i}`));
    // A repeat of an already-KEPT target still counts after the cap.
    anchors.push(anchor('https://site0.org/x', 'repeat'));
    const { links, truncated } = ContentExtractor.extractOutboundLinks(
        stubRoot(anchors), BASE, 'example.com', { cap: 5 });
    assert.equal(truncated, true);
    assert.equal(links.length, 5);
    assert.deepEqual(links.map((l) => l.url),
        [0, 1, 2, 3, 4].map((i) => `https://site${i}.org/x`), 'document order');
    assert.equal(links[0].count, 2, 'repeat of a kept target still counted');
});

test('degrades to empty on a missing/incapable root', () => {
    assert.deepEqual(ContentExtractor.extractOutboundLinks(null, BASE, 'example.com'),
        { links: [], truncated: false });
    assert.deepEqual(ContentExtractor.extractOutboundLinks({}, BASE, 'example.com'),
        { links: [], truncated: false });
});

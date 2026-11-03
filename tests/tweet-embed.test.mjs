// Embedded-tweet clean-up in ContentExtractor.extractArticle: before
// cloning, the pre-pass swaps each embedded tweet ON THE LIVE PAGE for
// a plain <blockquote class="xr-tweet-embed">. It used to build that
// stand-in with innerHTML from the tweet's textContent, so a tweet that
// READS "<img src=x onerror=…>" became live markup that ran on the
// captured site (JOURNAL 2026-09-30). The first test drives the real
// extractArticle through the pre-pass with stub elements (no jsdom) and
// is the regression proof. The last one characterizes what happens to
// the stand-in's text downstream, which this fix did not change.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { ContentExtractor, buildTweetEmbed } = await import('../src/shared/content-extractor.js');

const HOSTILE = '<img src=x onerror=alert(1)>';

// A stub element that records every innerHTML write instead of parsing.
function stubDoc() {
    const innerHTMLWrites = [];
    function createElement(tag) {
        return {
            tagName: tag.toUpperCase(),
            className: '',
            children: [],
            attrs: {},
            _text: '',
            setAttribute(n, v) { this.attrs[n] = String(v); },
            getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; },
            appendChild(c) { this.children.push(c); return c; },
            get textContent() {
                return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text;
            },
            set textContent(v) { this.children = []; this._text = String(v); },
            get innerHTML() { return ''; },
            set innerHTML(v) { innerHTMLWrites.push(v); },
        };
    }
    return { createElement, innerHTMLWrites };
}

function shape(node) {
    return {
        tag: node.tagName,
        ...(node.className ? { className: node.className } : {}),
        ...(Object.keys(node.attrs).length ? { attrs: node.attrs } : {}),
        ...(node.children.length ? { children: node.children.map(shape) } : { text: node._text }),
    };
}

test('extractArticle keeps a tweet\'s displayed text as text on the live page', () => {
    const doc = stubDoc();
    const url = 'https://twitter.com/someone/status/1';
    // The tweet and its parent record any HTML write too, so a parse
    // anywhere in the pre-pass is observed, not just on created elements.
    // (Accessors are defined, not spread: a spread would copy them as
    // plain data properties and stop recording.)
    const withHtmlSinks = (obj) => Object.defineProperties(obj, {
        innerHTML: { set(v) { doc.innerHTMLWrites.push(v); } },
        outerHTML: { set(v) { doc.innerHTMLWrites.push(v); } },
        insertAdjacentHTML: { value(_pos, v) { doc.innerHTMLWrites.push(v); } },
    });
    const parent = withHtmlSinks({ replaced: null, replaceChild(n, o) { this.replaced = { n, o }; } });
    const tweet = withHtmlSinks({
        textContent: HOSTILE,
        parentNode: parent,
        querySelector(sel) {
            if (sel === 'p') return { textContent: ` ${HOSTILE} ` };
            if (sel.startsWith('a[href*="twitter.com"]')) return { href: url };
            if (sel.startsWith('a:not')) return { textContent: '<b>Some One</b>' };
            return null;
        },
    });
    const saved = { document: globalThis.document, simple: ContentExtractor.extractSimple, error: console.error };
    globalThis.document = {
        createElement: doc.createElement,
        querySelectorAll: (sel) => (sel.includes('blockquote.twitter-tweet') ? [tweet] : []),
        // Stop after the pre-clone passes: the catch hands off to extractSimple.
        cloneNode() { throw new Error('stop after the pre-clone passes'); },
    };
    ContentExtractor.extractSimple = () => 'fell-back';
    console.error = () => {};
    try {
        assert.equal(ContentExtractor.extractArticle(), 'fell-back', 'sanity: the stub stops at the clone');
    } finally {
        globalThis.document = saved.document;
        ContentExtractor.extractSimple = saved.simple;
        console.error = saved.error;
    }

    assert.ok(parent.replaced, 'the tweet was swapped for a stand-in');
    assert.equal(parent.replaced.o, tweet);
    assert.deepEqual(doc.innerHTMLWrites, [], 'no innerHTML write: the tweet text is never parsed as HTML');
    assert.deepEqual(shape(parent.replaced.n), {
        tag: 'BLOCKQUOTE', className: 'xr-tweet-embed', attrs: { 'data-tweet-url': url },
        children: [
            { tag: 'P', text: HOSTILE },
            { tag: 'FOOTER', text: '— <b>Some One</b>' },
            { tag: 'CITE', children: [{ tag: 'A', attrs: { href: url }, text: url }] },
        ],
    });
});

test('buildTweetEmbed leaves out the footer and cite when there is no author or URL', () => {
    const doc = stubDoc();
    const quote = buildTweetEmbed(doc, { text: 'just text' });
    assert.deepEqual(doc.innerHTMLWrites, []);
    assert.deepEqual(shape(quote), {
        tag: 'BLOCKQUOTE', className: 'xr-tweet-embed', attrs: { 'data-tweet-url': '' },
        children: [{ tag: 'P', text: 'just text' }],
    });
});

test('downstream (unchanged by this fix): the text reaches Markdown verbatim and X-Ray\'s renderer escapes it', () => {
    // The stand-in as it comes out of Readability in Chromium: Readability
    // drops the xr-tweet-embed class and the <footer>, and the text node's
    // "<" and ">" serialize escaped. The Markdown then carries the text
    // verbatim and unescaped, as any paragraph's text already does.
    const html = '<blockquote data-tweet-url="https://twitter.com/a/status/1">'
        + '<p>&lt;img src=x onerror=alert(1)&gt;</p>'
        + '<cite><a href="https://twitter.com/a/status/1">https://twitter.com/a/status/1</a></cite></blockquote>';
    const md = ContentExtractor.htmlToMarkdown(html);
    assert.match(md, /> <img src=x onerror=alert\(1\)>/, 'the tweet line keeps the literal text');
    assert.match(md, /\[View on Twitter\/X\]\(https:\/\/twitter\.com\/a\/status\/1\)/);
    const back = ContentExtractor.markdownToHtml(md);
    assert.ok(!/<img/i.test(back), 'no live <img> comes back out of the renderer');
    assert.match(back, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

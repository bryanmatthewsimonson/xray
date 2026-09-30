// Embedded-tweet clean-up in ContentExtractor.extractArticle: the
// pre-pass swaps each embedded tweet ON THE CLONE for a plain
// <blockquote class="xr-tweet-embed"> (the live page is never written;
// tests/capture-clone-first.test.mjs). It used to build that stand-in
// with innerHTML from the tweet's textContent, so a tweet that READS
// "<img src=x onerror=…>" became live markup that ran on the captured
// site (JOURNAL 2026-09-30). The first test drives the real
// extractArticle on a hand-built live page and its clone
// (tests/helpers/capture-page-stub.mjs) and is the regression proof.
// The last one characterizes what happens to the stand-in's text
// downstream.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { h, mirrorPage, runCapture } from './helpers/capture-page-stub.mjs';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { ContentExtractor, buildTweetEmbed } = await import('../src/shared/content-extractor.js');

const HOSTILE = '<img src=x onerror=alert(1)>';

// A node as a plain tree: elements as { tag, attrs?, children }, text as a string.
function shape(node) {
    if (node.nodeType === 3) return node.nodeValue;
    return {
        tag: node.tagName,
        ...(Object.keys(node.attrs).length ? { attrs: { ...node.attrs } } : {}),
        children: node.childNodes.map(shape),
    };
}

test('extractArticle keeps a tweet\'s displayed text as text', () => {
    const url = 'https://twitter.com/someone/status/1';
    const page = mirrorPage([
        h('body', {},
            h('div', { $key: 'parent' },
                h('blockquote', { $key: 'tweet', class: 'twitter-tweet' },
                    h('p', {}, ` ${HOSTILE} `),
                    h('a', { href: url }, 'May 1, 2024'),
                    h('a', { href: 'https://twitter.com/someone' }, '<b>Some One</b>'))))
    ]);
    // The stub clone has no documentElement, so the real Readability
    // refuses it and the catch hands off to extractSimple: the run stops
    // right after the pre-passes.
    assert.equal(runCapture(ContentExtractor, page), 'fell-back', 'sanity: the stub stops at the parse');

    const { replaced } = page.clone$.parent;
    assert.equal(replaced.length, 1, 'the tweet was swapped for a stand-in');
    assert.equal(replaced[0].old, page.clone$.tweet);
    assert.equal(replaced[0].nw.owner, 'clone', 'built by the clone document');
    assert.deepEqual(page.writes, [], 'the live page is untouched');
    assert.deepEqual(page.parses, [], 'no HTML write anywhere: the tweet text is never parsed as HTML');
    assert.deepEqual(shape(replaced[0].nw), {
        tag: 'BLOCKQUOTE', attrs: { class: 'xr-tweet-embed', 'data-tweet-url': url },
        children: [
            { tag: 'P', children: [HOSTILE] },
            { tag: 'FOOTER', children: ['— <b>Some One</b>'] },
            { tag: 'CITE', children: [{ tag: 'A', attrs: { href: url }, children: [url] }] },
        ],
    });
});

test('buildTweetEmbed leaves out the footer and cite when there is no author or URL', () => {
    const page = mirrorPage([]);
    const quote = buildTweetEmbed(page.clone, { text: 'just text' });
    assert.deepEqual(page.parses, []);
    assert.deepEqual(shape(quote), {
        tag: 'BLOCKQUOTE', attrs: { class: 'xr-tweet-embed', 'data-tweet-url': '' },
        children: [{ tag: 'P', children: ['just text'] }],
    });
});

test('downstream: the text reaches Markdown verbatim and X-Ray\'s renderer escapes it', () => {
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

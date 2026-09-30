// Embedded-tweet clean-up in ContentExtractor.extractArticle: the
// pre-pass swaps each embedded tweet ON THE CLONE for a plain
// <blockquote class="xr-tweet-embed"> (the live page is never written;
// tests/capture-clone-first.test.mjs). It used to build that stand-in
// with innerHTML from the tweet's textContent, so a tweet that READS
// "<img src=x onerror=…>" became live markup that ran on the captured
// site (JOURNAL 2026-09-30). The first test drives the real
// extractArticle on a hand-built live page and its clone
// (tests/helpers/capture-page-stub.mjs) and is the regression proof.
// The tests after it pin how the pre-pass reads a tweet (its status
// link, printed author and line breaks), then follow the stand-in into
// Markdown and back out through X-Ray's renderer.

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
                    '— <b>Some One</b> (@someone) ',
                    h('a', { href: url }, 'May 1, 2024'))))
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
        tag: 'BLOCKQUOTE',
        attrs: { class: 'xr-tweet-embed', 'data-tweet-url': url, 'data-tweet-author': '<b>Some One</b> (@someone)' },
        children: [
            { tag: 'P', children: [HOSTILE] },
            { tag: 'CITE', children: ['— <b>Some One</b> (@someone)'] },
            { tag: 'CITE', children: [{ tag: 'A', attrs: { href: url }, children: [url] }] },
        ],
    });
});

test('buildTweetEmbed leaves out the author and link when there are none', () => {
    const page = mirrorPage([]);
    const quote = buildTweetEmbed(page.clone, { text: 'just text' });
    assert.deepEqual(page.parses, []);
    assert.deepEqual(shape(quote), {
        tag: 'BLOCKQUOTE', attrs: { class: 'xr-tweet-embed', 'data-tweet-url': '' },
        children: [{ tag: 'P', children: ['just text'] }],
    });
});

// Run the pre-pass over one tweet and return its stand-in.
function standInFor(tweet) {
    const page = mirrorPage([h('body', {}, h('div', { $key: 'parent' }, tweet))]);
    assert.equal(runCapture(ContentExtractor, page), 'fell-back', 'sanity: the stub stops at the parse');
    assert.deepEqual(page.writes, []);
    assert.equal(page.clone$.parent.replaced.length, 1, 'sanity: the tweet was swapped');
    return page.clone$.parent.replaced[0].nw;
}

const REF = '?ref_src=twsrc%5Etfw';
const STATUS = `https://twitter.com/example/status/1790000000000000000${REF}`;

test('a standard embed: the status link, the printed author and the line breaks reach the stand-in', () => {
    // The publish.twitter.com markup: the text in <p>, then the author
    // as bare text, then the date link, which is the status link.
    const standIn = standInFor(
        h('blockquote', { class: 'twitter-tweet' },
            h('p', { lang: 'en', dir: 'ltr' },
                'Big news today.', h('br'), h('br'),
                'Read more ', h('a', { href: 'https://t.co/AbCdEf123' }, 'https://t.co/AbCdEf123'),
                ' ', h('a', { href: `https://twitter.com/hashtag/Launch?src=hash&ref_src=twsrc%5Etfw` }, '#Launch'),
                ' with\n  ', h('a', { href: `https://twitter.com/someone${REF}` }, '@someone'),
                h('br'), 'line two'),
            '\n  — Example Org (@example) ',
            h('a', { href: STATUS }, 'May 1, 2024')));
    assert.deepEqual(shape(standIn), {
        tag: 'BLOCKQUOTE',
        attrs: { class: 'xr-tweet-embed', 'data-tweet-url': STATUS, 'data-tweet-author': 'Example Org (@example)' },
        children: [
            { tag: 'P', children: ['Big news today.'] },
            { tag: 'P', children: ['Read more https://t.co/AbCdEf123 #Launch with @someone', { tag: 'BR', children: [] }, 'line two'] },
            { tag: 'CITE', children: ['— Example Org (@example)'] },
            { tag: 'CITE', children: [{ tag: 'A', attrs: { href: STATUS }, children: [STATUS] }] },
        ],
    });
});

test('the status link is the tweet\'s own: never a mention, hashtag, t.co, quoted tweet or look-alike host', () => {
    const cases = [
        ['a tweet that opens with a mention',
            h('blockquote', { class: 'twitter-tweet' },
                h('p', {}, h('a', { href: `https://twitter.com/nytimes${REF}` }, '@nytimes'), ' thanks for the coverage'),
                '— Replier (@replier) ', h('a', { href: `https://twitter.com/replier/status/1790000000000000001${REF}` }, 'May 2, 2024')),
            `https://twitter.com/replier/status/1790000000000000001${REF}`, 'Replier (@replier)'],
        ['an x.com embed that links a quoted tweet and a t.co link in its text',
            h('blockquote', { class: 'twitter-tweet' },
                h('p', {}, 'Worth reading ', h('a', { href: 'https://t.co/xyz' }, 'vox.com/a'),
                    ' and ', h('a', { href: 'https://twitter.com/other/status/5' }, 'twitter.com/other/status/5')),
                '— Someone (@someone) ', h('a', { href: `https://x.com/someone/status/1790000000000000002${REF}` }, 'May 3, 2024')),
            `https://x.com/someone/status/1790000000000000002${REF}`, 'Someone (@someone)'],
        ['a look-alike host and no status link: no URL, no author',
            h('div', { class: 'tweet-embed' },
                h('p', {}, 'A post'), h('a', { href: 'https://www.vox.com/someone/status/1' }, 'Vox')),
            '', null],
        ['no anchors: the blockquote cite, and the handle from it',
            h('blockquote', { cite: 'https://twitter.com/jack/status/20' }, h('p', {}, 'just setting up my twttr')),
            'https://twitter.com/jack/status/20', '@jack'],
    ];
    for (const [label, tweet, url, author] of cases) {
        const standIn = standInFor(tweet);
        assert.equal(standIn.getAttribute('data-tweet-url'), url, `${label}: URL`);
        assert.equal(standIn.getAttribute('data-tweet-author'), author, `${label}: author`);
    }
});

test('the stand-in\'s author and line breaks reach the Markdown and the reader', () => {
    // The stand-in as Readability returns it: the class is gone, the data
    // attributes and both <cite>s stay, each paragraph is its own <p>.
    const html = `<blockquote data-tweet-url="${STATUS}" data-tweet-author="Example Org (@example)">`
        + '<p>Big news today.</p><p>Read more #Launch<br>line two</p>'
        + `<cite>— Example Org (@example)</cite><cite><a href="${STATUS}">${STATUS}</a></cite></blockquote>`;
    const md = ContentExtractor.htmlToMarkdown(html);
    assert.equal(md, [
        '> 🐦 **Tweet by Example Org (@example)**',
        '> ',
        '> Big news today.',
        '> ',
        '> Read more #Launch  ',
        '> line two',
        '> ',
        `> [View on Twitter/X](${STATUS})`,
    ].join('\n'));
    const back = ContentExtractor.markdownToHtml(md);
    assert.match(back, /Tweet by Example Org \(@example\)/);
    assert.match(back, /Read more #Launch<br>\s*line two/, 'the line break survives into the reader');
});

test('downstream: text that reads as HTML reaches Markdown literally and X-Ray\'s renderer escapes it', () => {
    // The stand-in as it comes out of Readability in Chromium: Readability
    // drops the xr-tweet-embed class, and the text node's "<" and ">"
    // serialize escaped. The Markdown then carries "<" and ">" literally,
    // as any paragraph's text already does: Turndown's escape leaves them.
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

// Item 2: a tweet may not plant markup in the capture. Its text and
// author are escaped exactly as an ordinary paragraph's text is (the
// parity is the invariant; Turndown's own escaping is the reference),
// and the link is an http(s) URL encoded so it cannot end early.
const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tweetHtml = (paragraphHtml, { url = STATUS, author = '' } = {}) =>
    `<blockquote data-tweet-url="${escHtml(url)}"${author ? ` data-tweet-author="${escHtml(author)}"` : ''}>`
    + `<p>${paragraphHtml}</p></blockquote>`;
// The tweet's text lines, "> " stripped: everything between the header
// (and its spacer) and the link (and its spacer).
function tweetBody(md) {
    const lines = md.split('\n').slice(2);
    if (/^> \[View on Twitter\/X\]/.test(lines[lines.length - 1] || '')) lines.splice(-2);
    return lines.map((l) => l.replace(/^> /, '')).join('\n');
}
const PLANTED = [
    '![](https://tracker.example/p.gif)',
    '[x](https://evil.example/)',
    '# not a heading',
    '> not a quote',
    '1. not a list',
    '- not a list',
    '*not emphasis* and __not bold__',
    '`not code`',
];

test('tweet text is escaped exactly as an ordinary paragraph\'s text is', () => {
    for (const line of PLANTED) {
        const asParagraph = ContentExtractor.htmlToMarkdown(`<p>${escHtml(line)}</p>`);
        assert.notEqual(asParagraph, line, `sanity: Turndown escapes ${line}`);
        const md = ContentExtractor.htmlToMarkdown(tweetHtml(escHtml(line)));
        assert.equal(tweetBody(md), asParagraph, line);
    }
    // Every line of a multi-line tweet, not just the first.
    const multi = `ok<br>${escHtml(PLANTED[0])}<br>${escHtml(PLANTED[2])}`;
    assert.equal(tweetBody(ContentExtractor.htmlToMarkdown(tweetHtml(multi))),
        ContentExtractor.htmlToMarkdown(`<p>${multi}</p>`));
});

test('the tweet author is escaped the same way', () => {
    const author = '*[x](https://evil.example/)* ![](https://tracker.example/p.gif)';
    const md = ContentExtractor.htmlToMarkdown(tweetHtml('hello', { author }));
    const asParagraph = ContentExtractor.htmlToMarkdown(`<p>${escHtml(author)}</p>`);
    assert.equal(md.split('\n')[0], `> 🐦 **Tweet by ${asParagraph}**`);
    // A newline in the attribute cannot start a line of its own.
    const split = ContentExtractor.htmlToMarkdown(tweetHtml('hello', { author: 'Some One\n# heading' }));
    assert.equal(split.split('\n')[0], '> 🐦 **Tweet by Some One # heading**');
});

test('in X-Ray\'s reader, a tweet plants no image and no link an ordinary paragraph would not', () => {
    const hrefs = (html) => [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map((m) => m[1]).sort();
    for (const line of PLANTED) {
        const tweet = ContentExtractor.markdownToHtml(ContentExtractor.htmlToMarkdown(tweetHtml(escHtml(line))));
        const para = ContentExtractor.markdownToHtml(ContentExtractor.htmlToMarkdown(`<p>${escHtml(line)}</p>`));
        assert.ok(!/<img/i.test(tweet), `${line}: no <img> in the reader`);
        assert.deepEqual(hrefs(tweet).filter((u) => u !== STATUS), hrefs(para), `${line}: the same targets as a paragraph`);
    }
});

test('the tweet link is an http(s) URL that cannot be broken out of', () => {
    const md = (url) => ContentExtractor.htmlToMarkdown(tweetHtml('hello', { url }));
    const link = (url) => md(url).split('\n').find((l) => l.includes('View on Twitter/X')) || null;

    assert.equal(link(STATUS), `> [View on Twitter/X](${STATUS})`, 'an ordinary status URL is byte-for-byte unchanged');

    const breakout = 'https://twitter.com/a/status/1)![](https://tracker.example/p.gif';
    assert.equal(link(breakout), '> [View on Twitter/X](https://twitter.com/a/status/1%29!%5B%5D%28https://tracker.example/p.gif)');
    const html = ContentExtractor.markdownToHtml(md(breakout));
    assert.ok(!/<img/i.test(html), 'no tracking image in the reader');
    assert.deepEqual([...html.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]),
        ['https://twitter.com/a/status/1%29!%5B%5D%28https://tracker.example/p.gif'], 'one link, the whole URL');

    const starred = ContentExtractor.markdownToHtml(md('https://twitter.com/a/status/1?q=*x*'));
    assert.match(starred, /<a href="https:\/\/twitter\.com\/a\/status\/1\?q=%2Ax%2A">/, 'no emphasis inside the href');

    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', '//evil.example/a/status/1', 'twitter.com/a/status/1']) {
        assert.equal(link(bad), null, `${bad}: no link at all`);
    }
});

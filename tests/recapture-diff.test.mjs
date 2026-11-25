// Recapture diff: the stealth-edit banner is raised by a WORD change,
// never by extraction noise alone, and its diff shows what changed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// Before the archive cache is imported: its indexedDB lookup must land
// on the fake.
await import('fake-indexeddb/auto');

// EventBuilder transitively imports Storage, which probes
// chrome.storage.local at module-load time. The archive cache reads the
// workspace pointer through the CALLBACK form, so the stub must answer
// it — one that only returns a promise leaves every save waiting.
globalThis.chrome = globalThis.chrome || {
    storage: {
        local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } },
        onChanged: { addListener() {} }
    }
};
const {
    normalizeForComparison, diffBodies, diffWords, summarizeDiff, renderDiffHtml,
    priorBodyDiff, renderRecaptureBanner
} = await import('../src/reader/recapture-diff.js');
const { EventBuilder } = await import('../src/shared/event-builder.js');
const { articleHash: canonicalArticleHash } = await import('../src/shared/audit/article-hash.js');
const { ContentExtractor } = await import('../src/shared/content-extractor.js');
const { composeMarkdownBody } = await import('../src/shared/platforms/youtube.js');
const { buildTranscriptSection } = await import('../src/shared/transcript-article.js');
const { saveArticle } = await import('../src/shared/archive-cache.js');

const BODY = [
    '# The headline',
    'Posted 3 hours ago · 1,204 likes · 87 comments',
    'The council voted “yes” on the measure — a first.',
    '![A map of the district](https://cdn.example.com/img/w_1456,c_limit/abc.jpg?sig=111)',
    'Read the [full report](https://example.com/report?utm_source=x#top).',
    'Officials said the cost was $4 million.'
].join('\n\n');

// The same unedited page on a later load, as extraction sees it.
const NOISY = [
    '# The headline',
    'Posted 5 hours ago · 1.3K likes · 92 comments',
    'The council voted "yes" on the measure - a first.  ',
    '![A map of the district](https://cdn.example.com/img/w_728,f_webp/abc.jpg?sig=999)',
    'Read the [full report](https://example.com/report?utm_source=y).',
    'Officials said the cost was $4 million\\.'
].join('\n\n');

test('the fixture noise really moves the canonical hash — the false positive this fixes', async () => {
    assert.notEqual(await canonicalArticleHash(BODY), await canonicalArticleHash(NOISY));
});

test('noise-only recapture: not substantive, no hunks', () => {
    const d = diffBodies(BODY, NOISY);
    assert.equal(d.substantive, false);
    assert.deepEqual(d.hunks, []);
    assert.deepEqual(d.stats, { added: 0, removed: 0, changed: 0 });
});

test('a changed number is substantive and shows as an edited paragraph', () => {
    const edited = NOISY.replace('$4 million', '$40 million');
    const d = diffBodies(BODY, edited);
    assert.equal(d.substantive, true);
    assert.deepEqual(d.stats, { added: 0, removed: 0, changed: 1 });
    const change = d.hunks.flat().find((r) => r.op === 'change');
    assert.ok(change.words.some((w) => w.op === 'del' && w.text.includes('$4')));
    assert.ok(change.words.some((w) => w.op === 'ins' && w.text.includes('$40')));
});

test('added and removed paragraphs are counted', () => {
    const prior = 'A one.\n\nB two.\n\nC three.';
    const current = 'A one.\n\nC three.\n\nD four.';
    const d = diffBodies(prior, current);
    assert.equal(d.substantive, true);
    // B removed and D added sit in separate runs (C between them) —
    // never paired into a fake edit.
    assert.deepEqual(d.stats, { added: 1, removed: 1, changed: 0 });
});

test('a changed link target is substantive (only query/fragment are noise)', () => {
    const d = diffBodies('See [it](https://a.example/x).', 'See [it](https://b.example/x).');
    assert.equal(d.substantive, true);
});

test('normalization keeps the words: a negation flip is never noise', () => {
    assert.notEqual(normalizeForComparison('It was safe.'), normalizeForComparison('It was not safe.'));
    assert.equal(diffBodies('It was safe.', 'It was not safe.').substantive, true);
});

test('context collapses: one edit deep in a long body yields one small hunk', () => {
    const paras = Array.from({ length: 200 }, (_, i) => `Paragraph ${i} text.`);
    const after = paras.slice(); after[100] = 'Paragraph 100 rewritten.';
    const d = diffBodies(paras.join('\n\n'), after.join('\n\n'));
    assert.equal(d.hunks.length, 1);
    assert.ok(d.hunks[0].length <= 3, `hunk has ${d.hunks[0].length} rows`);
});

test('two distant edits render as two hunks with a gap marker', () => {
    const paras = Array.from({ length: 50 }, (_, i) => `P${i}.`);
    const after = paras.slice(); after[5] = 'P5 changed.'; after[40] = 'P40 changed.';
    const html = renderDiffHtml(diffBodies(paras.join('\n\n'), after.join('\n\n')));
    assert.equal((html.match(/xr-recap-diff__hunk/g) || []).length, 2);
    assert.match(html, /xr-recap-diff__gap/);
});

test('an oversized changed middle degrades to a coarse count, never a hang', () => {
    const a = Array.from({ length: 2500 }, (_, i) => `a${i}`).join('\n\n');
    const b = Array.from({ length: 2500 }, (_, i) => `b${i}`).join('\n\n');
    const d = diffBodies(a, b);
    assert.equal(d.coarse, true);
    assert.equal(d.substantive, true);
    assert.match(renderDiffHtml(d), /Too many paragraphs/);
});

test('rendered diff escapes page text', () => {
    const d = diffBodies('Safe.', '<img src=x onerror=alert(1)>');
    const html = renderDiffHtml(d);
    assert.ok(!html.includes('<img'), html);
    assert.match(html, /&lt;img/);
});

test('word diff marks only the changed words', () => {
    const w = diffWords('the cat sat', 'the dog sat');
    assert.deepEqual(w.filter((x) => x.op !== 'same').map((x) => [x.op, x.text]), [['del', 'cat'], ['ins', 'dog']]);
});

test('summary names what changed', () => {
    assert.equal(summarizeDiff({ stats: { changed: 2, added: 1, removed: 0 } }), '2 paragraphs edited, 1 added');
});

// --- the same words, cut into paragraphs differently ---------------------
//
// A paragraph break is not a word. Transcript paragraphs are X-Ray's own
// invention (the composers glue timed caption cues together), so the same
// speech arrives broken at other points whenever the cues do.

test('the same words in paragraphs split or merged differently are not a change', () => {
    const prior = 'One fact here. Two facts there.\n\nThree facts more.\n\nThe end.';
    const current = 'One fact here.\n\nTwo facts there. Three facts more.\n\nThe end.';
    const d = diffBodies(prior, current);
    assert.equal(d.substantive, false);
    assert.deepEqual(d.stats, { added: 0, removed: 0, changed: 0 });
});

test('paragraphs in another order are still a change', () => {
    assert.equal(diffBodies('A one.\n\nB two.', 'B two.\n\nA one.').substantive, true);
});

test('an oversized re-cut is not a change either — it never reaches the coarse count', () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}.`);
    const b = [];
    for (let i = 0; i < a.length; i += 2) b.push(`${a[i]} ${a[i + 1]}`);
    const d = diffBodies(a.join('\n\n'), b.join('\n\n'));
    assert.equal(d.substantive, false);
    assert.equal(d.coarse, false);
});

// --- time anchors ---------------------------------------------------------

test("a transcript paragraph's leading time anchor is a position, not a word", () => {
    const turns = (shiftMs) => [
        { speaker: 'Chair', startMs: 5000 + shiftMs, text: 'The quay is sound.' },
        { speaker: 'Engineer', startMs: 9000 + shiftMs, text: 'The outer wall is not.' }
    ];
    // The three stamp forms the transcript composers write.
    const forms = {
        'a YouTube deep link': { meta: { url: 'https://www.youtube.com/watch?v=abc' }, linkFor: (s) => `https://www.youtube.com/watch?v=abc&t=${s}s` },
        'a media-fragment link': { meta: { url: 'https://example.org/episode.mp3' } },
        'a bare stamp': { meta: {} }
    };
    for (const [name, opts] of Object.entries(forms)) {
        const a = buildTranscriptSection({ turns: turns(0), ...opts });
        const b = buildTranscriptSection({ turns: turns(3000), ...opts });
        assert.notEqual(a, b, `${name}: the fixture must move the stamps`);
        assert.equal(diffBodies(a, b).substantive, false, name);
    }
});

test('a clock time inside a sentence is a word', () => {
    assert.equal(diffBodies('The board met at 9:30 on Tuesday.', 'The board met at 10:30 on Tuesday.').substantive, true);
    assert.equal(diffBodies('Set the timer to `9:30` and wait.', 'Set the timer to `10:30` and wait.').substantive, true);
});

// --- counts the capture header carries ------------------------------------

const headerWith = (line) => `---\n\n**Video**: [T](https://example.com/v)  \n${line}  \n**Video ID**: \`x\`\n\n---`;

test('a count on a header line of its own is noise; the same text inside a sentence is not', () => {
    assert.equal(diffBodies(headerWith('**Views**: 1,734,097'), headerWith('**Views**: 1,773,844')).substantive, false);
    assert.equal(diffBodies('The clip passed Views: 12 by noon.', 'The clip passed Views: 99 by noon.').substantive, true);
});

// Every capture header is written by a composer under
// src/shared/platforms/. A count one of them writes that this module
// does not treat as noise raises the banner on EVERY re-capture of that
// platform — which is how "**Views**: 1,204" got past a filter that knew
// only "1,204 views". So this reads the composers' own templates instead
// of a list kept here. It finds a count by its `.toLocaleString()`; one
// written any other way is outside what this can see.
test('every count a platform composer writes into a body is noise to the comparison', () => {
    const dir = new URL('../src/shared/platforms/', import.meta.url);
    const found = [];
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
        const src = readFileSync(new URL(name, dir), 'utf8');
        for (const line of src.split('\n')) {
            if (!/\.push\(/.test(line) || !/toLocaleString\(\)/.test(line) || /new Date\(/.test(line)) continue;
            const tpl = (line.match(/`([^`]*)`/) || [])[1];
            assert.ok(tpl, `${name}: could not read the template in: ${line.trim()}`);
            found.push({ name, tpl });
        }
    }
    assert.ok(found.length >= 15, `only ${found.length} count templates found — did the composers change shape?`);
    for (const { name, tpl } of found) {
        const render = (n) => {
            const out = tpl.replace(/\$\{[^}]*toLocaleString\(\)\}/g, n);
            assert.ok(!out.includes('${'), `${name}: unrendered part in ${tpl}`);
            // A labelled field is a header line of its own; anything
            // else is one bit of a " · "-joined stats line.
            return headerWith(out.startsWith('**') ? out : `**Stats**: ${out} · Verified`);
        };
        assert.equal(normalizeForComparison(render('1,204')), normalizeForComparison(render('98,765')), `${name}: ${tpl}`);
    }
});

// --- video re-capture: what the YouTube composer really writes -----------
//
// Held to the composer's real output, round-tripped the way the reader
// assembles a video body, so the comparison and the composer cannot
// drift apart unnoticed.

const SENTENCES = Array.from({ length: 40 }, (_, i) =>
    `Sentence number ${i} says something specific about the harbour and berth ${i} today.`);

// `per` sentences to a caption cue: the same words, cut at other points —
// so the composer ends its paragraphs after other sentences.
function cues(sentences, per) {
    const out = [];
    for (let i = 0; i < sentences.length; i += per) {
        out.push({ startMs: i * 4000, durationMs: per * 4000, text: sentences.slice(i, i + per).join(' ') });
    }
    return out;
}

function videoArticle({ views, events }) {
    const markdown = composeMarkdownBody({
        title: 'Harbour board meeting', channelName: 'Harbour Desk',
        canonicalUrl: 'https://www.youtube.com/watch?v=abc123XYZ_-', videoId: 'abc123XYZ_-',
        durationSeconds: 160, viewCount: views, publishDate: '2026-09-01T12:00:00Z',
        category: 'News & Politics', description: 'The full meeting.', keywords: ['harbour'],
        transcripts: [{ kind: 'scraped', displayName: 'YouTube panel', role: 'origin-scraped', events }],
        isShort: false
    });
    // What a capture stores: the rendered HTML. A video is not
    // markdown-canonical, so the reader turns it back into markdown.
    return { contentType: 'video', content: ContentExtractor.markdownToHtml(markdown) };
}
const bodyOf = (article) => EventBuilder.assembleArticleBody(article);

const OLD_VIDEO = videoArticle({ views: 1734097, events: cues(SENTENCES, 1) });
const NEW_VIDEO = videoArticle({ views: 1773844, events: cues(SENTENCES, 2) });

test('the video fixture: the same speech, more views, paragraphs cut at other points', async () => {
    const a = bodyOf(OLD_VIDEO), b = bodyOf(NEW_VIDEO);
    assert.notEqual(await canonicalArticleHash(a), await canonicalArticleHash(b));
    assert.match(a, /\*\*Views\*\*: 1,734,097/);
    assert.match(a, /\[`0:20`\]\([^)]*\) Sentence number 5 /);
    assert.match(b, /\[`0:24`\]\([^)]*\) Sentence number 6 /);
    const spoken = (body) => body.slice(body.indexOf('## Transcript'))
        .replace(/\[`[\d:]+`\]\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    assert.equal(spoken(a), spoken(b));
});

test('video re-capture: more views and re-cut paragraphs are not a change', () => {
    const d = diffBodies(bodyOf(OLD_VIDEO), bodyOf(NEW_VIDEO));
    assert.equal(d.substantive, false);
    assert.deepEqual(d.stats, { added: 0, removed: 0, changed: 0 });
    assert.deepEqual(d.hunks, []);
});

test('video re-capture: one changed word in a re-cut transcript is found, and only its stretch is marked', () => {
    const edited = SENTENCES.slice();
    edited[33] = edited[33].replace('harbour', 'marina');
    const d = diffBodies(bodyOf(OLD_VIDEO), bodyOf(videoArticle({ views: 1773844, events: cues(edited, 2) })));
    assert.equal(d.substantive, true);
    // Both cuts break after sentences 29 and 39; the edit sits between,
    // in two paragraphs on each side. Sentences 0–29 are only re-cut.
    assert.deepEqual(d.stats, { added: 0, removed: 0, changed: 2 });
    const marked = d.hunks.flat().filter((r) => r.op === 'change')
        .flatMap((r) => r.words).filter((w) => w.op !== 'same').map((w) => w.text).join(' ');
    assert.match(marked, /marina/);
    assert.ok(!/berth 12 /.test(marked), 'a paragraph far from the edit was marked');
});

// --- the seam: the banner the reader calls ------------------------------

const isMarkdownCanonical = (a) => !!(a && a.markdown && a.contentType === 'pdf');

test('priorBodyDiff assembles the prior body the way the reader assembles the current one', async () => {
    // A PDF row: markdown is canonical, `content` a derived rendering
    // that would NOT match — diffing it would false-flag every revisit.
    const prior = { article: { contentType: 'pdf', markdown: 'Same text.', content: '<p>Rendered differently</p>' } };
    const d = await priorBodyDiff(prior, 'Same text.', isMarkdownCanonical);
    assert.equal(d.substantive, false);
});

test('priorBodyDiff includes the video transcript section in the comparison', async () => {
    const article = { contentType: 'video', content: 'Desc.', transcript: 'One. Two. Three. Four.' };
    const current = EventBuilder.assembleArticleBody({ ...article, transcript: 'One. Two. Three. Five.' });
    assert.equal((await priorBodyDiff({ article }, current, isMarkdownCanonical)).substantive, true);
});

test('priorBodyDiff returns null (banner without detail) when there is no prior article', async () => {
    assert.equal(await priorBodyDiff({}, 'x', isMarkdownCanonical), null);
});

// Minimal DOM stub — the reader's own banner wiring, no jsdom.
function stubDoc() {
    const byId = new Map();
    const el = (tag) => {
        const node = {
            tagName: tag, id: '', className: '', hidden: false, parentElement: null, _html: '',
            listeners: {}, attrs: {}, textContent: '',
            set innerHTML(h) { this._html = h; this._kids = parseKids(h); },
            get innerHTML() { return this._html; },
            insertBefore(child) { child.parentElement = this; if (child.id) byId.set(child.id, child); },
            addEventListener(t, f) { this.listeners[t] = f; },
            setAttribute(k, v) { this.attrs[k] = v; },
            remove() { byId.delete(this.id); this.removed = true; },
            querySelector(sel) { return (this._kids || {})[sel.slice(1)] || null; }
        };
        return node;
    };
    const parseKids = (h) => {
        const kids = {};
        for (const m of h.matchAll(/id="([^"]+)"/g)) {
            const k = el('x'); k.id = m[1]; k.hidden = new RegExp(`id="${m[1]}" hidden`).test(h); kids[m[1]] = k;
        }
        return kids;
    };
    const main = el('main'); main.id = 'xr-main'; main.parentElement = el('div');
    byId.set('xr-main', main);
    return { getElementById: (id) => byId.get(id) || null, createElement: el };
}

test('banner: noise-only recapture renders nothing', async () => {
    const doc = stubDoc();
    const shown = await renderRecaptureBanner({ article: { content: BODY }, cachedAt: 1 }, NOISY, isMarkdownCanonical, doc);
    assert.equal(shown, false);
    assert.equal(doc.getElementById('xr-hash-banner'), null);
});

test('banner: a video re-captured with more views and re-cut paragraphs renders nothing', async () => {
    const doc = stubDoc();
    const shown = await renderRecaptureBanner({ article: OLD_VIDEO, cachedAt: 1 }, bodyOf(NEW_VIDEO), isMarkdownCanonical, doc);
    assert.equal(shown, false);
    assert.equal(doc.getElementById('xr-hash-banner'), null);
});

test('banner: a real edit renders the summary and a working Show changes toggle', async () => {
    const doc = stubDoc();
    const edited = BODY.replace('$4 million', '$40 million');
    const shown = await renderRecaptureBanner({ article: { content: BODY }, cachedAt: 1 }, edited, isMarkdownCanonical, doc);
    assert.equal(shown, true);
    const banner = doc.getElementById('xr-hash-banner');
    assert.match(banner.innerHTML, /1 paragraph edited/);
    const toggle = banner.querySelector('#xr-hash-diff-toggle');
    const panel = banner.querySelector('#xr-hash-diff');
    assert.equal(panel.hidden, true);
    toggle.listeners.click();
    assert.equal(panel.hidden, false);
    assert.equal(toggle.textContent, 'Hide changes');
});

test('banner: no prior article still raises the banner, without detail', async () => {
    const doc = stubDoc();
    assert.equal(await renderRecaptureBanner({ cachedAt: 1 }, 'x', isMarkdownCanonical, doc), true);
    const html = doc.getElementById('xr-hash-banner').innerHTML;
    assert.ok(!html.includes('xr-hash-diff-toggle'));
});

// --- a published row ------------------------------------------------------
//
// A publish rewrites the archive row. `content` becomes a RENDERING of
// the markdown that was published (every publish since 2026-07-07), and
// that markdown rides beside it. The rendering is not the page's HTML:
// markdownToHtml leaves turndown's escape backslashes as text, cannot
// read a link whose text holds a bracket, and breaks a nested list.
// Turned back into markdown it is another body than the one published,
// so an unedited page read as edited (issue #468).
//
// Rows of this shape are already in every archive, so these fixtures
// stay valid whatever a later publish path stores. They are built by the
// reader's own two writes, through the real event builder and the real
// archive cache; only the lines of reader/index.js that cannot be
// imported are repeated here.

const PUBKEY = '6daa7f3b0f5a4c8e9b2d1a7c3e5f80916d4b2a8c7e1f3059d8b6a4c2e0f19375';
// The reader's own predicate (reader/index.js, isMarkdownCanonical).
const readerIsMarkdownCanonical = (a) => !!(a && a.markdown && ['pdf', 'transcript', 'epub'].includes(a.contentType));
// The body a capture's hash covers (reader/index.js, hashableArticle).
const hashedBody = (a) => EventBuilder.assembleArticleBody(
    readerIsMarkdownCanonical(a) ? { ...a, content: a.markdown, _contentIsMarkdown: true } : a);

let rowSeq = 0;
// A capture: the article, saved under the hash of its assembled body.
async function capturedRow(article) {
    const a = { url: `https://example.com/story-${++rowSeq}`, title: 'Quay Road', ...article };
    return saveArticle({ article: { ...a, _articleHash: await canonicalArticleHash(hashedBody(a)) }, source: 'capture' });
}
// The same capture, then published untouched. `strip` names what a row
// written by an older build lacks.
async function publish(article, { strip = [] } = {}) {
    const captured = (await capturedRow(article)).article;
    const draft = readerIsMarkdownCanonical(captured) ? captured.markdown : ContentExtractor.htmlToMarkdown(captured.content);
    const shipped = { ...captured, content: draft, markdown: draft, _publishedDraft: draft, _contentIsMarkdown: true };
    const event = await EventBuilder.buildArticleEvent(shipped, [], PUBKEY);
    shipped._articleHash = event.tags.find((t) => t[0] === 'x')[1];
    const archived = { ...shipped, content: ContentExtractor.markdownToHtml(draft) };
    delete archived._contentIsMarkdown;
    for (const key of strip) delete archived[key];
    return { event, row: await saveArticle({ article: archived, source: 'capture', publishedToRelay: true }) };
}
const publishedRow = async (article, opts) => (await publish(article, opts)).row;
// "Load archive" on a relay copy: the reconstruction of the published
// event becomes the row, under the event's own hash.
async function relayLoadedRow(event) {
    const rebuilt = EventBuilder.reconstructArticleFromEvent({ ...event, id: 'e'.repeat(64) });
    return saveArticle({ article: { ...rebuilt, url: `https://example.com/story-${++rowSeq}` }, source: 'capture' });
}

const THEN = 'Updated 3 hours ago · 1,204 views';
const NOW = 'Updated 5 hours ago · 1,377 views';
// Prose turndown escapes: `*`, `[`, `]`, `_`. Plain sentences come back
// from the rendering byte for byte and pass against the bug — do not
// tidy these.
const quayPage = (stamp, verdict = 'safe') => `<p>${stamp}</p>`
    + '<p>Trucks heavier than 5 * 3 tonnes will use Quay Road [1].</p>'
    + `<p>The file final_budget_v2_draft called the old quay ${verdict} [2].</p>`;
const articleOf = (html) => ({ contentType: 'article', content: html });
const bodyOfPage = (html) => hashedBody(articleOf(html));
const marksOf = (d) => d.hunks.flat().filter((r) => r.op === 'change').flatMap((r) => r.words)
    .filter((w) => w.op !== 'same').map((w) => [w.op, w.text]);
const say = (d) => `${summarizeDiff(d)} ${JSON.stringify(marksOf(d))}`;

test('the published-row fixture: the row keeps the escapes as text, turning it back doubles them, and the hash moved', async () => {
    const row = await publishedRow(articleOf(quayPage(THEN)));
    // One backslash in the published markdown and, as text, in the row.
    assert.ok(row.article.markdown.includes('5 \\* 3 tonnes'), row.article.markdown);
    assert.ok(row.article.content.includes('5 \\* 3 tonnes'), row.article.content);
    // Three once the row's rendering is turned back into markdown.
    assert.ok(EventBuilder.assembleArticleBody(row.article).includes('5 \\\\\\* 3 tonnes'));
    // The row's hash is the published body's, and the page's moved.
    assert.equal(row.articleHash, await canonicalArticleHash(row.article.markdown));
    assert.notEqual(row.articleHash, await canonicalArticleHash(bodyOfPage(quayPage(NOW))));
});

test('control — a capture never published, re-captured with only a time and a view count moved, is not a change', async () => {
    const row = await capturedRow(articleOf(quayPage(THEN)));
    const d = await priorBodyDiff(row, bodyOfPage(quayPage(NOW)), readerIsMarkdownCanonical);
    assert.equal(d.substantive, false, say(d));
});

test('a published article re-captured with only a time and a view count moved is not a change', async () => {
    const row = await publishedRow(articleOf(quayPage(THEN)));
    const now = bodyOfPage(quayPage(NOW));
    const d = await priorBodyDiff(row, now, readerIsMarkdownCanonical);
    assert.equal(d.substantive, false, say(d));
    assert.deepEqual(d.stats, { added: 0, removed: 0, changed: 0 });
    // The seam: what the reader calls, with the row the cache returns.
    const doc = stubDoc();
    assert.equal(await renderRecaptureBanner(row, now, readerIsMarkdownCanonical, doc), false);
    assert.equal(doc.getElementById('xr-hash-banner'), null);
});

test('a published article with one word changed: one paragraph edited, and only that word is marked', async () => {
    const row = await publishedRow(articleOf(quayPage(THEN)));
    const now = bodyOfPage(quayPage(NOW, 'unsafe'));
    const d = await priorBodyDiff(row, now, readerIsMarkdownCanonical);
    assert.equal(d.substantive, true);
    assert.deepEqual(d.stats, { added: 0, removed: 0, changed: 1 }, say(d));
    assert.deepEqual(marksOf(d), [['del', 'safe'], ['ins', 'unsafe']]);
    const doc = stubDoc();
    assert.equal(await renderRecaptureBanner(row, now, readerIsMarkdownCanonical, doc), true);
    const html = doc.getElementById('xr-hash-banner').innerHTML;
    assert.match(html, /1 paragraph edited/);
    assert.deepEqual(html.match(/<(del|ins)>[^<]*<\/\1>/g), ['<del>safe</del>', '<ins>unsafe</ins>']);
});

test('a row published before rows carried `_publishedDraft` is read from its `markdown`', async () => {
    // 2026-07-07 to 2026-07-16: the rendering in `content`, the published
    // markdown under `markdown` only.
    const row = await publishedRow(articleOf(quayPage(THEN)), { strip: ['_publishedDraft'] });
    assert.equal(row.article._publishedDraft, undefined);
    const d = await priorBodyDiff(row, bodyOfPage(quayPage(NOW)), readerIsMarkdownCanonical);
    assert.equal(d.substantive, false, say(d));
});

// What else the rendering cannot hold: each of these comes back from
// markdownToHtml and turndown as other markdown than went in, and no
// folding of backslashes puts a broken list back together.
const UNSTABLE_SHAPES = {
    'a nested list': '<ul><li>Outer one<ul><li>Inner a</li><li>Inner b</li></ul></li><li>Outer two</li></ul>',
    'a bracket inside a link': '<p>Read the <a href="https://example.com/report_v2">full report [PDF]</a> today.</p>',
    'a backtick in prose': '<p>Type `make` and wait.</p>',
    'a literal backslash': '<p>Saved under C:\\Users\\harbour, with a shrug ¯\\_(ツ)_/¯.</p>',
    'lines that open like a list, a heading or a quote': '<p>14. The defendant denies it.</p><p># not a heading</p><p>&gt; not a quote</p><p>- not a list</p>'
};
for (const [name, html] of Object.entries(UNSTABLE_SHAPES)) {
    test(`a published article holding ${name}, re-captured unedited, is not a change`, async () => {
        const page = (stamp) => `<p>${stamp}</p>${html}`;
        const row = await publishedRow(articleOf(page(THEN)));
        assert.notEqual(EventBuilder.assembleArticleBody(row.article), row.article.markdown,
            'the fixture must be one the rendering does not survive');
        const d = await priorBodyDiff(row, bodyOfPage(page(NOW)), readerIsMarkdownCanonical);
        assert.equal(d.substantive, false, say(d));
    });
}

// A video: the composer's markdown rendered to HTML, as the YouTube
// handler stores it. Captions say "[Music]" in most videos.
const CAPTIONS = ['[Music] Welcome back to the harbour_desk stream.', ...SENTENCES.slice(0, 10),
    '[Applause] That makes 5 * 3 berths.'];
function youtubeArticle(views, lines = CAPTIONS) {
    const markdown = composeMarkdownBody({
        title: 'Harbour board meeting', channelName: 'Harbour Desk',
        canonicalUrl: 'https://www.youtube.com/watch?v=abc123XYZ_-', videoId: 'abc123XYZ_-',
        durationSeconds: 48, viewCount: views, publishDate: '2026-09-01T12:00:00Z',
        category: 'News & Politics', description: 'The full meeting [live].', keywords: ['harbour'],
        transcripts: [{ kind: 'scraped', displayName: 'YouTube panel', role: 'origin-scraped', events: cues(lines, 1) }],
        isShort: false
    });
    return { contentType: 'video', markdown, content: ContentExtractor.markdownToHtml(markdown) };
}

test('a published video re-captured with more views is not a change', async () => {
    const row = await publishedRow(youtubeArticle(1734097));
    assert.ok(row.article.content.includes('\\[Music\\]'), 'the fixture must store an escape as text');
    const d = await priorBodyDiff(row, hashedBody(youtubeArticle(1773844)), readerIsMarkdownCanonical);
    assert.equal(d.substantive, false, say(d));
});

test('a published video with one caption word changed: only that word is marked', async () => {
    const row = await publishedRow(youtubeArticle(1734097));
    const edited = CAPTIONS.slice();
    edited[11] = edited[11].replace('berths', 'cranes');
    const d = await priorBodyDiff(row, hashedBody(youtubeArticle(1773844, edited)), readerIsMarkdownCanonical);
    assert.deepEqual(d.stats, { added: 0, removed: 0, changed: 1 }, say(d));
    assert.deepEqual(marksOf(d), [['del', 'berths.'], ['ins', 'cranes.']]);
});

// --- the row's own markdown is used only when the row's hash proves it ----
//
// "It has a markdown field" is not enough, and neither is "it carries a
// published draft". Each of these rows holds markdown its hash does NOT
// cover; taking it for the prior body reports an edit nobody made.

test('a video never published keeps its composer markdown, but its hash covers the rendering: compared through the rendering', async () => {
    // The composer's nested list does not survive the rendering, on
    // either capture. The two rendered bodies agree; the composer's
    // markdown and a rendered body do not.
    const nested = (views) => {
        const markdown = `**Views**: ${views}\n\n-   Outer one\n    -   Inner a\n    -   Inner b\n-   Outer two`;
        return { contentType: 'video', markdown, content: ContentExtractor.markdownToHtml(markdown) };
    };
    const row = await capturedRow(nested('1,204'));
    assert.equal(diffBodies(row.article.markdown, hashedBody(row.article)).substantive, true,
        'the fixture must be one whose markdown and hashed body differ in words');
    const d = await priorBodyDiff(row, hashedBody(nested('1,377')), readerIsMarkdownCanonical);
    assert.equal(d.substantive, false, say(d));
});

test('a published draft left on a row whose body has since been replaced is not the prior body', async () => {
    const stale = 'The old quay is safe, the survey says.';
    const row = await capturedRow({ ...articleOf(quayPage(THEN, 'unsafe')), markdown: stale, _publishedDraft: stale });
    const d = await priorBodyDiff(row, bodyOfPage(quayPage(NOW, 'unsafe')), readerIsMarkdownCanonical);
    assert.equal(d.substantive, false, say(d));
});

// --- markdown-canonical captures, and rows loaded back from a relay -------
//
// A PDF's or a transcript's markdown is its body; the rendering is never
// turned back, captured or published. What a relay hands back is another
// matter: a reconstruction has no `markdown`, so its body used to come
// from the rendering, whatever the type.

// Raw extractor markdown: nothing escaped, a numbered run and a nested
// list the rendering would renumber and break.
const filing = (stamp) => [
    `Retrieved ${stamp}`,
    '## 1. Findings',
    'Trucks heavier than 5 * 3 tonnes will use Quay Road [1]. See final_budget_v2_draft.',
    '14. The defendant denies the allegation.\n15. The plaintiff repeats it.',
    '-   Outer one\n    -   Inner a\n    -   Inner b\n-   Outer two'
].join('\n\n');
const pdfArticle = (stamp) => ({ contentType: 'pdf', markdown: filing(stamp), content: ContentExtractor.markdownToHtml(filing(stamp)) });
const hearing = (views) => buildTranscriptSection({
    turns: [
        { speaker: 'Chair', startMs: 5000, text: `[Music] Welcome to harbour_desk, now at ${views} views.` },
        { speaker: 'Engineer', startMs: 9000, text: 'That makes 5 * 3 berths.' }
    ],
    meta: { url: 'https://example.org/episode.mp3' }
});
const transcriptArticle = (views) => ({ contentType: 'transcript', markdown: hearing(views), content: ContentExtractor.markdownToHtml(hearing(views)) });

for (const [type, make, then, now] of [
    ['PDF', pdfArticle, '3 hours ago', '5 hours ago'],
    ['transcript', transcriptArticle, '1,204', '1,377']
]) {
    test(`a ${type}, captured or published, re-captured with only noise moved is not a change`, async () => {
        const current = hashedBody(make(now));
        for (const row of [await capturedRow(make(then)), await publishedRow(make(then))]) {
            assert.notEqual(row.articleHash, await canonicalArticleHash(current), 'the fixture must move the hash');
            const d = await priorBodyDiff(row, current, readerIsMarkdownCanonical);
            assert.equal(d.substantive, false, say(d));
        }
    });
}

test('a published article loaded back from a relay copy, then re-captured unedited, is not a change', async () => {
    const { event } = await publish(articleOf(quayPage(THEN)));
    const row = await relayLoadedRow(event);
    assert.equal(row.article.markdown, undefined, 'a reconstruction carries no `markdown`');
    const d = await priorBodyDiff(row, bodyOfPage(quayPage(NOW)), readerIsMarkdownCanonical);
    assert.equal(d.substantive, false, say(d));
});

test('a published PDF loaded back from a relay copy, then re-captured unedited, is not a change', async () => {
    const { event } = await publish(pdfArticle('3 hours ago'));
    const row = await relayLoadedRow(event);
    assert.equal(readerIsMarkdownCanonical(row.article), false, 'a reconstruction is not markdown-canonical');
    const d = await priorBodyDiff(row, hashedBody(pdfArticle('5 hours ago')), readerIsMarkdownCanonical);
    assert.equal(d.substantive, false, say(d));
});

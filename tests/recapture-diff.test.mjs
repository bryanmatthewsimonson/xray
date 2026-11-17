// Recapture diff: the stealth-edit banner is raised by a WORD change,
// never by extraction noise alone, and its diff shows what changed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// EventBuilder transitively imports Storage, which probes
// chrome.storage.local at module-load time.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } }
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

test('priorBodyDiff assembles the prior body the way the reader assembles the current one', () => {
    // A PDF row: markdown is canonical, `content` a derived rendering
    // that would NOT match — diffing it would false-flag every revisit.
    const prior = { article: { contentType: 'pdf', markdown: 'Same text.', content: '<p>Rendered differently</p>' } };
    const d = priorBodyDiff(prior, 'Same text.', isMarkdownCanonical);
    assert.equal(d.substantive, false);
});

test('priorBodyDiff includes the video transcript section in the comparison', () => {
    const article = { contentType: 'video', content: 'Desc.', transcript: 'One. Two. Three. Four.' };
    const current = EventBuilder.assembleArticleBody({ ...article, transcript: 'One. Two. Three. Five.' });
    assert.equal(priorBodyDiff({ article }, current, isMarkdownCanonical).substantive, true);
});

test('priorBodyDiff returns null (banner without detail) when there is no prior article', () => {
    assert.equal(priorBodyDiff({}, 'x', isMarkdownCanonical), null);
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

test('banner: noise-only recapture renders nothing', () => {
    const doc = stubDoc();
    const shown = renderRecaptureBanner({ article: { content: BODY }, cachedAt: 1 }, NOISY, isMarkdownCanonical, doc);
    assert.equal(shown, false);
    assert.equal(doc.getElementById('xr-hash-banner'), null);
});

test('banner: a video re-captured with more views and re-cut paragraphs renders nothing', () => {
    const doc = stubDoc();
    const shown = renderRecaptureBanner({ article: OLD_VIDEO, cachedAt: 1 }, bodyOf(NEW_VIDEO), isMarkdownCanonical, doc);
    assert.equal(shown, false);
    assert.equal(doc.getElementById('xr-hash-banner'), null);
});

test('banner: a real edit renders the summary and a working Show changes toggle', () => {
    const doc = stubDoc();
    const edited = BODY.replace('$4 million', '$40 million');
    const shown = renderRecaptureBanner({ article: { content: BODY }, cachedAt: 1 }, edited, isMarkdownCanonical, doc);
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

test('banner: no prior article still raises the banner, without detail', () => {
    const doc = stubDoc();
    assert.equal(renderRecaptureBanner({ cachedAt: 1 }, 'x', isMarkdownCanonical, doc), true);
    const html = doc.getElementById('xr-hash-banner').innerHTML;
    assert.ok(!html.includes('xr-hash-diff-toggle'));
});

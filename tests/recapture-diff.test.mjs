// Recapture diff: the stealth-edit banner is raised by a WORD change,
// never by extraction noise alone, and its diff shows what changed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

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

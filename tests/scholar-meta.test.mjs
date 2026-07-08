// Scholarly-metadata tests — Phase 18 C2
// (docs/COMPLEX_CONTENT_DESIGN.md §4.3). Stub-document pattern.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractScholarlyMeta } from '../src/shared/platforms/scholar-meta.js';

function meta(name, content) {
    return { getAttribute: (n) => (n === 'name' ? name : n === 'content' ? content : null) };
}
function doc(metas) {
    return { querySelectorAll: () => metas };
}

test('extracts DOI, journal, authors, date from citation_* tags', () => {
    const s = extractScholarlyMeta(doc([
        meta('citation_doi', '10.1234/abc.567'),
        meta('citation_journal_title', 'Journal of Examples'),
        meta('citation_author', 'Ada Lovelace'),
        meta('citation_author', 'Charles Babbage'),
        meta('citation_publication_date', '2026/01/15'),
        meta('viewport', 'width=device-width')
    ]), 'https://journal.test/article/567');
    assert.equal(s.doi, '10.1234/abc.567');
    assert.equal(s.journal, 'Journal of Examples');
    assert.deepEqual(s.authors, ['Ada Lovelace', 'Charles Babbage']);
    assert.equal(s.published, '2026/01/15');
});

test('DOI from a doi.org URL; trailing punctuation stripped', () => {
    const s = extractScholarlyMeta(doc([]), 'https://doi.org/10.5555/12345678).');
    assert.equal(s.doi, '10.5555/12345678');
});

test('arXiv id + version from meta and from URL shapes', () => {
    const viaMeta = extractScholarlyMeta(doc([meta('citation_arxiv_id', '2406.01234v3')]), '');
    assert.equal(viaMeta.arxiv_id, '2406.01234');
    assert.equal(viaMeta.arxiv_version, 3);

    const viaAbs = extractScholarlyMeta(doc([]), 'https://arxiv.org/abs/2406.01234v2');
    assert.equal(viaAbs.arxiv_id, '2406.01234');
    assert.equal(viaAbs.arxiv_version, 2);

    const viaPdf = extractScholarlyMeta(doc([]), 'https://arxiv.org/pdf/2406.01234');
    assert.equal(viaPdf.arxiv_id, '2406.01234');
});

test('non-scholarly pages return null', () => {
    assert.equal(extractScholarlyMeta(doc([meta('og:title', 'A blog post')]), 'https://blog.test/post'), null);
    assert.equal(extractScholarlyMeta(null, ''), null);
});

test('30023 builder emits additive doi/i/arxiv tags from article.scholar', async () => {
    globalThis.chrome = globalThis.chrome || {
        storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
    };
    const { EventBuilder } = await import('../src/shared/event-builder.js');
    const article = {
        url: 'https://journal.test/article/567',
        title: 'A Paper',
        textContent: 'Body text of the paper.',
        scholar: { doi: '10.1234/ABC.567', arxiv_id: '2406.01234', arxiv_version: 2 }
    };
    const ev = await EventBuilder.buildArticleEvent(article, [], 'f'.repeat(64));
    assert.equal(ev.pubkey, 'f'.repeat(64));
    assert.deepEqual(ev.tags.find((t) => t[0] === 'doi'), ['doi', '10.1234/ABC.567']);
    assert.deepEqual(ev.tags.find((t) => t[0] === 'i'), ['i', 'doi:10.1234/abc.567']);
    assert.deepEqual(ev.tags.find((t) => t[0] === 'arxiv'), ['arxiv', '2406.01234v2']);

    // Absent scholar → no tags (additive means absent, not empty).
    const bare = await EventBuilder.buildArticleEvent({ url: 'https://x.test/a', title: 'T', textContent: 'B' }, [], 'f'.repeat(64));
    for (const name of ['doi', 'i', 'arxiv']) {
        assert.equal(bare.tags.find((t) => t[0] === name), undefined, `no ${name} tag`);
    }
});

test('arxiv: old-style (pre-2007) ids match from URLs — 7 digits, subject classes', () => {
    const a = extractScholarlyMeta(doc([]), 'https://arxiv.org/abs/math.GT/0309136');
    assert.equal(a.arxiv_id, 'math.GT/0309136');
    const b = extractScholarlyMeta(doc([]), 'https://arxiv.org/pdf/hep-th/9901001v3');
    assert.equal(b.arxiv_id, 'hep-th/9901001');
    assert.equal(b.arxiv_version, 3);
});

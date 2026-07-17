// PubMed Central enrich handler tests — Phase 18 C2 tail
// (docs/COMPLEX_CONTENT_DESIGN.md §4.3). Stub-document pattern (see
// tests/scholar-meta.test.mjs) — no DOM, no jsdom.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isPmcPage, enrichArticle } from '../src/shared/platforms/pmc.js';

function el(text, children = {}, attrs = {}) {
    return {
        textContent: text,
        getAttribute: (n) => (n in attrs ? attrs[n] : null),
        querySelectorAll: (sel) => children[sel] || []
    };
}
function meta(name, content) {
    return { getAttribute: (n) => (n === 'name' ? name : n === 'content' ? content : null) };
}
function metaProp(property, content) {
    return { getAttribute: (n) => (n === 'property' ? property : n === 'content' ? content : null) };
}
function doc(map) {
    return { querySelectorAll: (sel) => map[sel] || [] };
}

const PMC_URL = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7095418/';
const LEGACY_URL = 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1234567/';

// Realistic current-PMC shape: section.ref-list > ul > li, each li a
// <cite> wrapping the whole citation plus a DOI anchor; PMID in text.
function pmcDoc() {
    const cite1 = 'Zhu N, Zhang D, Wang W, et al. A novel coronavirus from patients '
        + 'with pneumonia in China, 2019. N Engl J Med. 2020;382(8):727-733. PMID: 31978945.';
    const li1 = el(cite1, {
        cite: [el(cite1)],
        a: [el('DOI', {}, { href: 'https://doi.org/10.1056/NEJMoa2001017' })]
    });
    const cite2 = 'Huang C, Wang Y, Li X, et al. Clinical features of patients infected '
        + 'with 2019 novel coronavirus in Wuhan, China. Lancet. 2020;395:497-506.';
    const li2 = el(cite2, { cite: [el(cite2)] });
    const refRoot = el('', { li: [li1, li2] });

    const fig = el('', {
        figcaption: [el('Fig. 1. Viral load over time in upper respiratory specimens.')],
        '.obj_head': [el('Fig. 1.')]
    });

    return doc({
        meta: [
            meta('citation_pmid', '32109013'),
            meta('citation_doi', '10.1056/NEJMoa2001017'),
            meta('citation_journal_title', 'The New England Journal of Medicine'),
            metaProp('og:url', PMC_URL),
            meta('viewport', 'width=device-width')
        ],
        'section.ref-list': [refRoot],
        'figure, .fig': [fig]
    });
}

test('isPmcPage: both hosts, only article paths', () => {
    assert.equal(isPmcPage(PMC_URL), true);
    assert.equal(isPmcPage('https://pmc.ncbi.nlm.nih.gov/articles/PMC7095418'), true);
    assert.equal(isPmcPage('https://pmc.ncbi.nlm.nih.gov/articles/PMC7095418/?report=classic'), true);
    assert.equal(isPmcPage(LEGACY_URL), true);

    assert.equal(isPmcPage('https://pubmed.ncbi.nlm.nih.gov/32109013/'), false);
    assert.equal(isPmcPage('https://www.ncbi.nlm.nih.gov/gene/1489680'), false);
    assert.equal(isPmcPage('https://pmc.ncbi.nlm.nih.gov/about/'), false);
    assert.equal(isPmcPage('https://evil.example/pmc.ncbi.nlm.nih.gov/articles/PMC1/'), false);
    assert.equal(isPmcPage(''), false);
    assert.equal(isPmcPage(null), false);
});

test('enrichArticle: ids, references, and figure captions from a realistic PMC page', () => {
    const article = { title: 'A novel coronavirus', platform: null };
    const out = enrichArticle(article, pmcDoc(), PMC_URL);

    assert.equal(out, article);                       // same object, enrich contract
    assert.equal(out.platform, null);                 // platform untouched

    assert.equal(out.pmc.pmcid, 'PMC7095418');
    assert.equal(out.pmc.pmid, '32109013');
    assert.equal(out.pmc.doi, '10.1056/NEJMoa2001017');

    assert.equal(out.references.length, 2);
    assert.equal(out.references[0].doi, '10.1056/NEJMoa2001017');   // from the anchor
    assert.equal(out.references[0].pmid, '31978945');
    assert.equal(out.references[0].year, 2020);
    assert.equal(out.references[0].title, undefined); // whole-citation cite is not a title
    assert.equal(out.references[1].year, 2020);
    assert.equal(out.references_truncated, undefined);

    assert.deepEqual(out.pmc.figures, [
        { label: 'Fig. 1.', caption: 'Fig. 1. Viral load over time in upper respiratory specimens.' }
    ]);
});

test('enrichArticle: article.scholar.doi wins over the citation_doi meta', () => {
    const article = { scholar: { doi: '10.9999/from-scholar-meta' } };
    enrichArticle(article, pmcDoc(), PMC_URL);
    assert.equal(article.pmc.doi, '10.9999/from-scholar-meta');
    assert.equal(article.scholar.doi, '10.9999/from-scholar-meta');  // untouched
});

test('enrichArticle: legacy host URL yields the pmcid', () => {
    const article = {};
    enrichArticle(article, doc({}), LEGACY_URL);
    assert.equal(article.pmc.pmcid, 'PMC1234567');
    assert.equal(article.pmc.pmid, undefined);
    assert.equal(article.pmc.doi, undefined);
});

test('enrichArticle: page with no references and no figures — no empty arrays appear', () => {
    const article = { title: 'T' };
    enrichArticle(article, doc({ meta: [meta('citation_pmid', '11111111')] }), PMC_URL);
    assert.equal('references' in article, false);
    assert.equal('references_truncated' in article, false);
    assert.equal('figures' in article.pmc, false);
    assert.equal(article.pmc.pmid, '11111111');
});

test('enrichArticle: pre-existing article.references is left alone', () => {
    const existing = [{ raw: 'existing entry' }];
    const article = { references: existing };
    enrichArticle(article, pmcDoc(), PMC_URL);
    assert.equal(article.references, existing);       // same array, not replaced
    assert.equal(article.references.length, 1);
});

test('enrichArticle: legacy .ref-cit-blk shape with no list root parses', () => {
    const blocks = [el('Doe J. Legacy citation. J Old. 1999;1:1. PMID: 10500123.')];
    const article = {};
    enrichArticle(article, doc({ '.ref-cit-blk': blocks }), PMC_URL);
    assert.equal(article.references.length, 1);
    assert.equal(article.references[0].pmid, '10500123');
});

test('enrichArticle: reference cap (200 + truncated flag) and figure cap (40, no flag)', () => {
    const lis = [];
    for (let i = 0; i < 201; i++) lis.push(el(`Doe J. Paper ${i}. J Rep. 2020;1:${i}.`));
    const figs = [];
    for (let i = 0; i < 45; i++) {
        figs.push(el('', { figcaption: [el(`Figure ${i} caption text.`)] }));
    }
    const article = {};
    enrichArticle(article, doc({
        'section.ref-list': [el('', { li: lis })],
        'figure, .fig': [figs].flat()
    }), PMC_URL);
    assert.equal(article.references.length, 200);
    assert.equal(article.references_truncated, true);
    assert.equal(article.pmc.figures.length, 40);
});

test('enrichArticle: figure without caption text is skipped, label-only is not enough', () => {
    const article = {};
    enrichArticle(article, doc({
        'figure, .fig': [
            el('', { '.obj_head': [el('Fig. 2.')] }),           // no caption → skipped
            el('', { '.caption': [el('  A real caption. ')] })  // legacy .caption shape
        ]
    }), PMC_URL);
    assert.deepEqual(article.pmc.figures, [{ caption: 'A real caption.' }]);
});

test('enrichArticle: fail-open — throwing doc, null doc, null article', () => {
    const boom = { querySelectorAll() { throw new Error('boom'); } };
    const article = { title: 'T' };
    assert.equal(enrichArticle(article, boom, PMC_URL), article);
    assert.equal(article.pmc.pmcid, 'PMC7095418');    // URL id still recovered
    assert.equal('references' in article, false);

    const bare = { title: 'B' };
    assert.equal(enrichArticle(bare, null, ''), bare);
    assert.equal('pmc' in bare, false);               // nothing found → nothing set

    assert.equal(enrichArticle(null, pmcDoc(), PMC_URL), null);
});

// ------------------------------------------------------------------
// Adversarial-review regressions (Phase 18 C2 verify pass).
// ------------------------------------------------------------------

test('REGRESSION: a reference root with zero parseable entries sets NO references key', () => {
    // The reachable case the earlier no-references test masked: the
    // ref-list root EXISTS but yields nothing (empty/non-li items).
    // "Absent, not empty" — an empty array would read as "this paper
    // cites nothing", which is false.
    const emptyRoot = el('', { li: [el('   ')] });
    const d = doc({
        meta: [meta('citation_pmid', '32109013')],
        'section.ref-list': [emptyRoot]
    });
    const article = { title: 'T' };
    enrichArticle(article, d, PMC_URL);
    assert.equal('references' in article, false);
    assert.equal('references_truncated' in article, false);
});

test('REGRESSION: the modern-PMC anchor set does not put Google Scholar in entry.url', () => {
    // The full real decoration: [DOI] [PubMed] [PMC free article]
    // [Google Scholar]. Pre-fix, the Scholar SEARCH link became
    // entry.url on essentially every reference.
    const cite = 'Zhu N, et al. A novel coronavirus. N Engl J Med. 2020;382:727. PMID: 31978945.';
    const li = el(cite, {
        cite: [el(cite)],
        a: [
            el('DOI', {}, { href: 'https://doi.org/10.1056/NEJMoa2001017' }),
            el('PubMed', {}, { href: 'https://pubmed.ncbi.nlm.nih.gov/31978945' }),
            el('PMC free article', {}, { href: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7092803/' }),
            el('Google Scholar', {}, { href: 'https://scholar.google.com/scholar_lookup?journal=N+Engl+J+Med' })
        ]
    });
    const d = doc({ 'section.ref-list': [el('', { li: [li] })] });
    const article = { title: 'T' };
    enrichArticle(article, d, PMC_URL);
    assert.equal(article.references[0].url, undefined,
        'every anchor here is citation plumbing — no work URL exists on this entry');
    assert.equal(article.references[0].doi, '10.1056/NEJMoa2001017');
    assert.equal(article.references[0].pmid, '31978945');
});

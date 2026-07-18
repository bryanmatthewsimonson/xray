// arXiv enrich handler tests — Phase 18 C2
// (docs/COMPLEX_CONTENT_DESIGN.md §4.3). Pure-module pattern: every
// effect (fetchHtml, extract) is a stub; no DOM, no chrome.*.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isArxivAbsPage, ar5ivUrlFor, enrichArticle } from '../src/shared/platforms/arxiv.js';

const ABS_URL = 'https://arxiv.org/abs/2401.12345';

function absArticle(overrides = {}) {
    return {
        url: ABS_URL,
        title: 'A Paper',
        content: '<p>Abstract: we prove a thing.</p>',
        textContent: 'Abstract: we prove a thing.',
        scholar: { arxiv_id: '2401.12345', arxiv_version: 2 },
        ...overrides
    };
}

const FULL_TEXT = 'Full body of the paper. '.repeat(200); // ~4,800 chars

function goodDeps(calls = {}) {
    return {
        url: ABS_URL,
        fetchHtml: async (u) => { calls.fetched = u; return '<html>ar5iv body</html>'; },
        extract: (html, baseUrl) => {
            calls.extracted = { html, baseUrl };
            return { content: '<p>' + FULL_TEXT + '</p>', textContent: FULL_TEXT, title: 'A Paper' };
        }
    };
}

// ------------------------------------------------------------------
// isArxivAbsPage
// ------------------------------------------------------------------

test('isArxivAbsPage: abs shapes match, www and version and query tolerated', () => {
    assert.equal(isArxivAbsPage('https://arxiv.org/abs/2401.12345'), true);
    assert.equal(isArxivAbsPage('https://www.arxiv.org/abs/2401.12345'), true);
    assert.equal(isArxivAbsPage('https://arxiv.org/abs/2401.12345v3'), true);
    assert.equal(isArxivAbsPage('https://arxiv.org/abs/2401.12345?context=cs.LG'), true);
    assert.equal(isArxivAbsPage('https://arxiv.org/abs/math/0309136'), true);
    assert.equal(isArxivAbsPage('https://arxiv.org/abs/math.GT/0309136'), true);
    assert.equal(isArxivAbsPage('https://arxiv.org/abs/cond-mat.mes-hall/0212413'), true);
});

test('isArxivAbsPage: non-abs shapes do not match', () => {
    assert.equal(isArxivAbsPage('https://arxiv.org/pdf/2401.12345'), false);
    assert.equal(isArxivAbsPage('https://arxiv.org/html/2401.12345'), false);
    assert.equal(isArxivAbsPage('https://ar5iv.labs.arxiv.org/html/2401.12345'), false);
    assert.equal(isArxivAbsPage('https://arxiv.org/list/cs.LG/recent'), false);
    assert.equal(isArxivAbsPage('https://arxiv.org/abs/'), false);
    assert.equal(isArxivAbsPage('https://example.com/abs/2401.12345'), false);
    assert.equal(isArxivAbsPage('not a url'), false);
    assert.equal(isArxivAbsPage(''), false);
    assert.equal(isArxivAbsPage(null), false);
});

// ------------------------------------------------------------------
// ar5ivUrlFor
// ------------------------------------------------------------------

test('ar5ivUrlFor: new-style id, with and without version', () => {
    assert.equal(ar5ivUrlFor('2401.12345'), 'https://ar5iv.labs.arxiv.org/html/2401.12345');
    assert.equal(ar5ivUrlFor('2401.12345', 3), 'https://ar5iv.labs.arxiv.org/html/2401.12345v3');
});

test('ar5ivUrlFor: old-style ids preserved verbatim (slash not encoded)', () => {
    assert.equal(ar5ivUrlFor('math/0309136'), 'https://ar5iv.labs.arxiv.org/html/math/0309136');
    assert.equal(ar5ivUrlFor('math.GT/0309136', 2), 'https://ar5iv.labs.arxiv.org/html/math.GT/0309136v2');
});

// ------------------------------------------------------------------
// enrichArticle — adopt path
// ------------------------------------------------------------------

test('adopts the ar5iv rendition: content swapped, capture_url + rendition set', async () => {
    const calls = {};
    const article = absArticle();
    const out = await enrichArticle(article, goodDeps(calls));

    assert.equal(out, article, 'same object back (enrich contract)');
    assert.equal(calls.fetched, 'https://ar5iv.labs.arxiv.org/html/2401.12345v2', 'version rides into the fetch URL');
    assert.equal(calls.extracted.baseUrl, calls.fetched, 'extract sees the ar5iv base URL');
    assert.equal(out.content, '<p>' + FULL_TEXT + '</p>');
    assert.equal(out.textContent, FULL_TEXT);
    assert.equal(out.capture_url, 'https://ar5iv.labs.arxiv.org/html/2401.12345v2', 'provenance: what was actually fetched');
    assert.equal(out.url, ABS_URL, 'identity stays the /abs/ URL');
    assert.equal(out.scholar.rendition, 'ar5iv');
    assert.equal(out.scholar.arxiv_id, '2401.12345', 'scholar fields preserved');
    assert.equal(out.scholar.arxiv_version, 2);
    assert.equal(out.title, 'A Paper', 'title not adopted from the rendition');
});

test('adopts at the exact thresholds (>= 2x and >= 2000 chars)', async () => {
    const cur = 'a'.repeat(1000);
    const next = 'b'.repeat(2000);
    const article = absArticle({ textContent: cur, content: '<p>' + cur + '</p>' });
    const out = await enrichArticle(article, {
        url: ABS_URL,
        fetchHtml: async () => '<html/>',
        extract: () => ({ content: '<p>' + next + '</p>', textContent: next, title: 'T' })
    });
    assert.equal(out.textContent, next);
    assert.equal(out.scholar.rendition, 'ar5iv');
});

test('adopts when the current capture has no textContent at all', async () => {
    const article = absArticle({ textContent: undefined, content: undefined });
    const out = await enrichArticle(article, goodDeps());
    assert.equal(out.textContent, FULL_TEXT);
    assert.equal(out.scholar.rendition, 'ar5iv');
});

test('async extract is awaited', async () => {
    const article = absArticle();
    const out = await enrichArticle(article, {
        url: ABS_URL,
        fetchHtml: async () => '<html/>',
        extract: async () => ({ content: '<p>' + FULL_TEXT + '</p>', textContent: FULL_TEXT, title: 'T' })
    });
    assert.equal(out.textContent, FULL_TEXT);
});

// ------------------------------------------------------------------
// enrichArticle — fail-open paths (article byte-identical)
// ------------------------------------------------------------------

async function assertUnchanged(article, deps, label) {
    const snapshot = structuredClone(article);
    const out = await enrichArticle(article, deps);
    assert.equal(out, article, `${label}: same object back`);
    assert.deepEqual(out, snapshot, `${label}: article byte-identical`);
}

test('fail-open: fetchHtml returns null', async () => {
    await assertUnchanged(absArticle(), {
        url: ABS_URL,
        fetchHtml: async () => null,
        extract: () => { throw new Error('must not be called'); }
    }, 'fetch null');
});

test('fail-open: fetchHtml throws', async () => {
    await assertUnchanged(absArticle(), {
        url: ABS_URL,
        fetchHtml: async () => { throw new Error('network down'); },
        extract: () => { throw new Error('must not be called'); }
    }, 'fetch throw');
});

test('fail-open: extract returns null', async () => {
    await assertUnchanged(absArticle(), {
        url: ABS_URL,
        fetchHtml: async () => '<html/>',
        extract: () => null
    }, 'extract null');
});

test('fail-open: extract throws', async () => {
    await assertUnchanged(absArticle(), {
        url: ABS_URL,
        fetchHtml: async () => '<html/>',
        extract: () => { throw new Error('parse failed'); }
    }, 'extract throw');
});

test('fail-open: body below the absolute floor (< 2000 chars)', async () => {
    const short = 'c'.repeat(1999);
    await assertUnchanged(absArticle({ textContent: 'tiny abstract' }), {
        url: ABS_URL,
        fetchHtml: async () => '<html/>',
        extract: () => ({ content: '<p>' + short + '</p>', textContent: short, title: 'T' })
    }, 'below floor');
});

test('fail-open: body not >= 2x the current capture', async () => {
    const cur = 'a'.repeat(3000);
    const next = 'b'.repeat(5999); // >= 2000 but < 2x
    await assertUnchanged(absArticle({ textContent: cur }), {
        url: ABS_URL,
        fetchHtml: async () => '<html/>',
        extract: () => ({ content: '<p>' + next + '</p>', textContent: next, title: 'T' })
    }, 'below ratio');
});

test('never touches a non-abs page (fetchHtml not called)', async () => {
    for (const url of [
        'https://arxiv.org/pdf/2401.12345',
        'https://ar5iv.labs.arxiv.org/html/2401.12345',
        'https://example.com/abs/2401.12345'
    ]) {
        let fetched = false;
        await assertUnchanged(absArticle({ url }), {
            url,
            fetchHtml: async () => { fetched = true; return '<html/>'; },
            extract: () => ({ content: '<p>x</p>', textContent: FULL_TEXT, title: 'T' })
        }, `non-abs ${url}`);
        assert.equal(fetched, false, `no fetch for ${url}`);
    }
});

test('fail-open: no scholar / no arxiv_id (fetchHtml not called)', async () => {
    let fetched = false;
    const deps = {
        url: ABS_URL,
        fetchHtml: async () => { fetched = true; return '<html/>'; },
        extract: () => ({ content: '<p>x</p>', textContent: FULL_TEXT, title: 'T' })
    };
    await assertUnchanged(absArticle({ scholar: undefined }), deps, 'no scholar');
    await assertUnchanged(absArticle({ scholar: { doi: '10.1/x' } }), deps, 'no arxiv_id');
    assert.equal(fetched, false);
});

test('fail-open: missing injected deps', async () => {
    await assertUnchanged(absArticle(), { url: ABS_URL }, 'no fetchHtml/extract');
    await assertUnchanged(absArticle(), undefined, 'no deps bag');
});

test('null article passes through', async () => {
    assert.equal(await enrichArticle(null, goodDeps()), null);
});

test('url falls back to article.url when not injected', async () => {
    const article = absArticle();
    const out = await enrichArticle(article, {
        fetchHtml: async () => '<html/>',
        extract: () => ({ content: '<p>' + FULL_TEXT + '</p>', textContent: FULL_TEXT, title: 'T' })
    });
    assert.equal(out.scholar.rendition, 'ar5iv');
});

test('old-style id builds an old-style ar5iv URL on the adopt path', async () => {
    let fetched = null;
    const article = absArticle({
        url: 'https://arxiv.org/abs/math.GT/0309136',
        scholar: { arxiv_id: 'math.GT/0309136' }
    });
    const out = await enrichArticle(article, {
        url: 'https://arxiv.org/abs/math.GT/0309136',
        fetchHtml: async (u) => { fetched = u; return '<html/>'; },
        extract: () => ({ content: '<p>' + FULL_TEXT + '</p>', textContent: FULL_TEXT, title: 'T' })
    });
    assert.equal(fetched, 'https://ar5iv.labs.arxiv.org/html/math.GT/0309136');
    assert.equal(out.capture_url, 'https://ar5iv.labs.arxiv.org/html/math.GT/0309136');
    assert.equal(out.scholar.rendition, 'ar5iv');
});

// ------------------------------------------------------------------
// Adversarial-review regressions (Phase 18 C2 verify pass): the adopt
// block must re-derive everything DERIVED from the old body. wordCount
// and links are WIRE-BOUND — event-builder publishes word_count and
// link tags from them — so leaving them describing the abstract ships
// wrong metadata on a full-text capture.
// ------------------------------------------------------------------

test('REGRESSION: adoption recomputes wordCount and readingTimeMinutes from the new body', async () => {
    const article = absArticle({ wordCount: 5, readingTimeMinutes: 1 });
    await enrichArticle(article, goodDeps());
    assert.equal(article.scholar.rendition, 'ar5iv', 'sanity: adoption happened');
    const expectedWords = FULL_TEXT.split(/\s+/).filter((w) => w.length > 0).length;
    assert.equal(article.wordCount, expectedWords,
        'word_count is a 30023 wire tag — it must describe the shipped body');
    assert.equal(article.readingTimeMinutes, Math.ceil(expectedWords / 225));
});

test('REGRESSION: adoption replaces links when extract provides them, nulls when it cannot', async () => {
    // Provided: the outbound links of the ADOPTED body ride along.
    const newLinks = [{ url: 'https://example.com/cited', text: 'cited', count: 1, internal: false }];
    const withLinks = absArticle({ links: [{ url: 'https://arxiv.org/list/cs.LG', text: 'listing', count: 1, internal: true }] });
    const deps = goodDeps();
    const baseExtract = deps.extract;
    deps.extract = (h, b) => ({ ...baseExtract(h, b), links: newLinks });
    await enrichArticle(withLinks, deps);
    assert.deepEqual(withLinks.links, newLinks, 'link tags publish from article.links');

    // Not provided: the abs page's links describe a body we no longer
    // ship — null is the established "not captured" value.
    const withoutLinks = absArticle({ links: [{ url: 'https://arxiv.org/list/cs.LG', text: 'listing', count: 1, internal: true }], links_truncated: true });
    await enrichArticle(withoutLinks, goodDeps());
    assert.equal(withoutLinks.links, null);
    assert.equal('links_truncated' in withoutLinks, false, 'a stale truncation flag must not survive the swap');
});

test('REGRESSION: the fail-open paths still leave wordCount/links byte-identical', async () => {
    const article = absArticle({ wordCount: 5, readingTimeMinutes: 1, links: [{ url: 'https://x.example/a', text: 'a', count: 1, internal: false }] });
    const before = structuredClone(article);
    await enrichArticle(article, { url: ABS_URL, fetchHtml: async () => null, extract: () => null });
    assert.deepEqual(article, before, 'no partial writes on a failed fetch — including the derived fields');
});

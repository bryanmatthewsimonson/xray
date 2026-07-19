// URL-list import tests — Phase 28.1 (corpus intake automation).
//
// parseUrlList / pickDocMeta / computeWebArticleHash are pure;
// importUrlList runs against fake-indexeddb (the real saveArticle /
// hasArticle / addArticlesToCase) with the network fetch and the
// DOM-needing extractor INJECTED. Load-bearing invariants: input-order
// results, batch continues past failures, PDFs skip (never archived),
// re-runs are idempotent ('already-archived', no re-fetch), thin
// extractions import WITH the flag (a paywalled abstract is a real
// capture), case tagging lands on the archive row, and the hash is
// the ordinary-capture recipe (assembleArticleBody over HTML content).

import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const _stateStore = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
                const out = {};
                for (const k of Array.isArray(keys) ? keys : [keys]) {
                    if (_stateStore.has(k)) out[k] = _stateStore.get(k);
                }
                cb(out);
            },
            set(obj, cb) {
                for (const [k, v] of Object.entries(obj)) _stateStore.set(k, v);
                cb && cb();
            },
            remove(keys, cb) {
                for (const k of Array.isArray(keys) ? keys : [keys]) _stateStore.delete(k);
                cb && cb();
            }
        }
    }
};

const { parseUrlList, pickDocMeta, computeWebArticleHash, importUrlList } =
    await import('../src/shared/url-import.js');
const { getArticle, _resetForTests } = await import('../src/shared/archive-cache.js');
const { EntityModel } = await import('../src/shared/entity-model.js');
const { EventBuilder } = await import('../src/shared/event-builder.js');
const { articleHash: canonicalArticleHash } = await import('../src/shared/audit/article-hash.js');

// ------------------------------------------------------------------
// parseUrlList
// ------------------------------------------------------------------

test('url-import: parseUrlList — plain lines, order kept', () => {
    assert.deepEqual(parseUrlList('https://a.example/x\nhttps://b.example/y\n'), [
        'https://a.example/x', 'https://b.example/y'
    ]);
});

test('url-import: parseUrlList — markdown worksheet forms', () => {
    const text = [
        '- PubMed: <https://pubmed.ncbi.nlm.nih.gov/30874756/>',
        '1. **Some title** [full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC6439941/)',
        'bare https://time.com/archive/6855517/hold-the-eggs-and-butter/.',
    ].join('\n');
    assert.deepEqual(parseUrlList(text), [
        'https://pubmed.ncbi.nlm.nih.gov/30874756/',
        'https://pmc.ncbi.nlm.nih.gov/articles/PMC6439941/',
        'https://time.com/archive/6855517/hold-the-eggs-and-butter/'
    ]);
});

test('url-import: parseUrlList — fragment-stripped dedupe; non-http dropped', () => {
    const text = 'https://a.example/x#frag\nhttps://a.example/x\nftp://a.example/z\nnot a url';
    assert.deepEqual(parseUrlList(text), ['https://a.example/x']);
});

test('url-import: parseUrlList — empty and null-ish input', () => {
    assert.deepEqual(parseUrlList(''), []);
    assert.deepEqual(parseUrlList(null), []);
});

// ------------------------------------------------------------------
// pickDocMeta (stub document)
// ------------------------------------------------------------------

function stubDoc(map) {
    return {
        querySelector(sel) {
            if (!(sel in map)) return null;
            const v = map[sel];
            return {
                getAttribute: (name) => (v && typeof v === 'object' ? (v[name] ?? null) : v),
                textContent: (v && typeof v === 'object' && v.text) || ''
            };
        }
    };
}

test('url-import: pickDocMeta — og/article/citation meta cascade', () => {
    const meta = pickDocMeta(stubDoc({
        'meta[name="author"]': { content: 'Jane Roe' },
        'meta[property="article:published_time"]': { content: '2019-03-15T00:00:00Z' },
        'meta[property="og:site_name"]': { content: 'JAMA' },
        'meta[property="og:description"]': { content: 'A pooled cohort analysis.' }
    }));
    assert.deepEqual(meta, {
        byline: 'Jane Roe', publishedTime: '2019-03-15T00:00:00Z',
        siteName: 'JAMA', description: 'A pooled cohort analysis.'
    });
});

test('url-import: pickDocMeta — missing fields stay empty, never fabricated', () => {
    assert.deepEqual(pickDocMeta(stubDoc({})), {
        byline: '', publishedTime: '', siteName: '', description: ''
    });
});

// ------------------------------------------------------------------
// Hash recipe
// ------------------------------------------------------------------

test('url-import: computeWebArticleHash is the ordinary-capture recipe', async () => {
    const article = { content: '<h1>Title</h1><p>Body text here.</p>', contentType: 'article' };
    const h = await computeWebArticleHash(article);
    assert.equal(h, await canonicalArticleHash(EventBuilder.assembleArticleBody(article)));
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(await computeWebArticleHash(article), h, 'deterministic');
});

// ------------------------------------------------------------------
// importUrlList (fake-indexeddb + injected fetch/extract)
// ------------------------------------------------------------------

const PAGE = (n) => `https://site${n}.example/article`;

function fakeExtract({ html, url }) {
    // Deterministic stand-in for the DOM extractor: html is the "body".
    if (html === 'EMPTY') return null;
    return {
        article: {
            url, title: `Title of ${url}`, byline: '', siteName: 'site.example',
            excerpt: html.slice(0, 50), wordCount: html.split(/\s+/).length,
            content: `<p>${html}</p>`, contentType: 'article', platform: null,
            entities: [], imported: { via: 'url-import' }
        },
        thin: html.length < 20,
        text: html
    };
}

function fetcherFromMap(map, calls = []) {
    return async (url) => {
        calls.push(url);
        const r = map[url];
        if (!r) return { ok: false, error: 'unmapped' };
        if (typeof r === 'function') return r();
        return r;
    };
}

test('url-import: importUrlList — happy path imports, archives, input order', async () => {
    _resetForTests();
    const calls = [];
    const fetcher = fetcherFromMap({
        [PAGE(1)]: { ok: true, html: 'A long enough body for a full import.', finalUrl: PAGE(1) },
        [PAGE(2)]: { ok: true, html: 'Another sufficiently long body text.', finalUrl: PAGE(2) }
    }, calls);
    const rows = await importUrlList([PAGE(1), PAGE(2)], { fetcher, extract: fakeExtract });

    assert.deepEqual(rows.map((r) => [r.url, r.status]), [
        [PAGE(1), 'imported'], [PAGE(2), 'imported']
    ]);
    assert.ok(rows[0].articleHash && /^[0-9a-f]{64}$/.test(rows[0].articleHash));
    const rec = await getArticle(PAGE(1));
    assert.ok(rec && rec.article, 'archived');
    assert.equal(rec.article.title, `Title of ${PAGE(1)}`);
    assert.equal(rec.articleHash, rows[0].articleHash, 'stored hash = returned hash');
});

test('url-import: thin extraction imports WITH the flag', async () => {
    _resetForTests();
    const fetcher = fetcherFromMap({ [PAGE(3)]: { ok: true, html: 'short', finalUrl: PAGE(3) } });
    const rows = await importUrlList([PAGE(3)], { fetcher, extract: fakeExtract });
    assert.equal(rows[0].status, 'thin');
    assert.ok(await getArticle(PAGE(3)), 'thin still archives — a paywalled abstract is a real capture');
});

test('url-import: PDF responses skip without archiving; batch continues', async () => {
    _resetForTests();
    const fetcher = fetcherFromMap({
        [PAGE(4)]: { ok: false, pdf: true, error: 'PDF response' },
        [PAGE(5)]: { ok: true, html: 'A long enough body for a full import.', finalUrl: PAGE(5) }
    });
    const rows = await importUrlList([PAGE(4), PAGE(5)], { fetcher, extract: fakeExtract });
    assert.equal(rows[0].status, 'pdf');
    assert.equal(await getArticle(PAGE(4)), null, 'pdf never archived');
    assert.equal(rows[1].status, 'imported', 'batch continued');
});

test('url-import: HTTP failure is final (no retry), carries the error', async () => {
    _resetForTests();
    const calls = [];
    const fetcher = fetcherFromMap({
        [PAGE(6)]: { ok: false, status: 404, error: 'HTTP 404' }
    }, calls);
    const rows = await importUrlList([PAGE(6)], { fetcher, extract: fakeExtract });
    assert.equal(rows[0].status, 'failed');
    assert.equal(rows[0].error, 'HTTP 404');
    assert.equal(calls.length, 1, '404 is not retried');
});

test('url-import: transport failure retries once, then failed row', async () => {
    _resetForTests();
    const calls = [];
    const fetcher = fetcherFromMap({
        [PAGE(7)]: () => ({ ok: false, error: 'network down' })   // no status → throw path
    }, calls);
    const rows = await importUrlList([PAGE(7)], {
        fetcher, extract: fakeExtract, retryDelayMs: 1
    });
    assert.equal(rows[0].status, 'failed');
    assert.equal(calls.length, 2, 'one retry on transport-shaped failure');
});

test('url-import: extraction failure → failed with Readability note', async () => {
    _resetForTests();
    const fetcher = fetcherFromMap({ [PAGE(8)]: { ok: true, html: 'EMPTY', finalUrl: PAGE(8) } });
    const rows = await importUrlList([PAGE(8)], { fetcher, extract: fakeExtract });
    assert.equal(rows[0].status, 'failed');
    assert.match(rows[0].error, /no article content/);
});

test('url-import: re-run is idempotent — already-archived, no re-fetch', async () => {
    _resetForTests();
    const calls = [];
    const fetcher = fetcherFromMap({
        [PAGE(9)]: { ok: true, html: 'A long enough body for a full import.', finalUrl: PAGE(9) }
    }, calls);
    await importUrlList([PAGE(9)], { fetcher, extract: fakeExtract });
    const rows2 = await importUrlList([PAGE(9)], { fetcher, extract: fakeExtract });
    assert.equal(rows2[0].status, 'already-archived');
    assert.equal(calls.length, 1, 'second run never fetched');
});

test('url-import: caseEntityId tags the archived row into the case', async () => {
    _resetForTests();
    _stateStore.clear();
    const kase = await EntityModel.create({ name: 'Egg corpus', type: 'case' });
    const fetcher = fetcherFromMap({
        [PAGE(10)]: { ok: true, html: 'A long enough body for a full import.', finalUrl: PAGE(10) }
    });
    const rows = await importUrlList([PAGE(10)], {
        fetcher, extract: fakeExtract, caseEntityId: kase.id
    });
    assert.equal(rows[0].status, 'imported');
    const rec = await getArticle(PAGE(10));
    assert.ok((rec.article.entities || []).some((e) => e.entity_id === kase.id && e.type === 'case'),
        'archive row carries the case tag');
});

test('url-import: redirect — the FINAL url is the identity, disclosed on the row', async () => {
    _resetForTests();
    const finalUrl = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC1/';
    const fetcher = fetcherFromMap({
        [PAGE(11)]: { ok: true, html: 'A long enough body for a full import.', finalUrl }
    });
    const rows = await importUrlList([PAGE(11)], { fetcher, extract: fakeExtract });
    assert.equal(rows[0].status, 'imported');
    assert.equal(rows[0].finalUrl, finalUrl);
    assert.ok(await getArticle(finalUrl), 'archived under the final url');
});

test('url-import: onImported fires only for imported/thin rows, with article + text', async () => {
    _resetForTests();
    const seen = [];
    const fetcher = fetcherFromMap({
        [PAGE(12)]: { ok: true, html: 'A long enough body for a full import.', finalUrl: PAGE(12) },
        [PAGE(13)]: { ok: false, pdf: true, error: 'PDF response' },
        [PAGE(14)]: { ok: false, status: 404, error: 'HTTP 404' }
    });
    const rows = await importUrlList([PAGE(12), PAGE(13), PAGE(14)], {
        fetcher, extract: fakeExtract,
        onImported: async ({ row, article, text }) => { seen.push({ url: row.url, title: article.title, text }); }
    });
    assert.equal(seen.length, 1, 'only the imported row');
    assert.equal(seen[0].url, PAGE(12));
    assert.equal(seen[0].title, `Title of ${PAGE(12)}`);
    assert.ok(seen[0].text.length > 0, 'text substrate carried');
    assert.equal(rows[0].status, 'imported');
});

test('url-import: a throwing onImported marks row.post but never un-imports', async () => {
    _resetForTests();
    const fetcher = fetcherFromMap({
        [PAGE(15)]: { ok: true, html: 'A long enough body for a full import.', finalUrl: PAGE(15) }
    });
    const rows = await importUrlList([PAGE(15)], {
        fetcher, extract: fakeExtract,
        onImported: async () => { throw new Error('suggest exploded'); }
    });
    assert.equal(rows[0].status, 'imported', 'import status unaffected');
    assert.equal(rows[0].post, 'suggest exploded');
    assert.ok(await getArticle(PAGE(15)), 'article stays archived');
});

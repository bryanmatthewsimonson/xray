// Transcript import flow — Phase 21.2. The portal's direct-save-first
// sequence: build → hash → saveArticle → addArticlesToCase, then the
// reader re-saves the identical hash. fake-indexeddb + persisting
// chrome shim (the case-membership.test.mjs idiom).

import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('fake-indexeddb/auto');

const _store = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) { const out = {}; for (const k of Array.isArray(keys) ? keys : [keys]) if (_store.has(k)) out[k] = _store.get(k); cb(out); },
            set(obj, cb) { for (const [k, v] of Object.entries(obj)) _store.set(k, v); cb && cb(); },
            remove(keys, cb) { for (const k of Array.isArray(keys) ? keys : [keys]) _store.delete(k); cb && cb(); }
        }
    }
};

const { EntityModel } = await import('../src/shared/entity-model.js');
const { LocalKeyManager } = await import('../src/shared/local-key-manager.js');
const { saveArticle, getArticle, clear: clearArchive } = await import('../src/shared/archive-cache.js');
const { addArticlesToCase, memberUrlSets } = await import('../src/shared/case-membership.js');
const { EventBuilder } = await import('../src/shared/event-builder.js');
const { articleHash: canonicalArticleHash } = await import('../src/shared/audit/article-hash.js');
const { parseTranscript } = await import('../src/shared/transcript-parse.js');
const { buildTranscriptArticle, computeTranscriptArticleHash } = await import('../src/shared/transcript-article.js');

async function reset() {
    _store.clear();
    LocalKeyManager.keys.clear();
    try { await clearArchive(); } catch (_) { /* db may not exist yet */ }
}

const SRT = '1\n00:00:00,000 --> 00:00:04,000\nALICE: We sequenced it.\n\n2\n00:00:04,000 --> 00:00:08,000\nBOB: I disagree.';

function buildFromPaste(text, meta) {
    const parsed = parseTranscript(text);
    return buildTranscriptArticle({ turns: parsed.turns, speakers: parsed.speakers, format: parsed.format, meta });
}

test('import: save stores the precomputed hash (archive did not re-derive over HTML)', async () => {
    await reset();
    const article = buildFromPaste(SRT, { title: 'Ep 1', url: 'https://pod.example/1' });
    article._articleHash = await computeTranscriptArticleHash(article);
    const saved = await saveArticle({ article, source: 'capture' });
    assert.equal(saved.articleHash, article._articleHash, 'row carries the transcript-markdown hash, not an HTML round-trip');
});

test('import: hash recipe matches the reader/publish recipe exactly', async () => {
    await reset();
    const article = buildFromPaste(SRT, { title: 'Ep', url: 'https://pod.example/1' });
    const mine = await computeTranscriptArticleHash(article);
    // The reader's hashableArticle('transcript') + publish path:
    const readerRecipe = await canonicalArticleHash(EventBuilder.assembleArticleBody(
        { ...article, content: article.markdown, _contentIsMarkdown: true }));
    assert.equal(mine, readerRecipe);
});

test('import: direct-save then addArticlesToCase makes the record a member immediately', async () => {
    await reset();
    const kase = await EntityModel.create({ name: 'Origins', type: 'case' });
    const article = buildFromPaste(SRT, { title: 'Ep', url: 'https://pod.example/1' });
    article._articleHash = await computeTranscriptArticleHash(article);
    await saveArticle({ article, source: 'capture' });
    await addArticlesToCase(kase.id, [article.url]);

    const sets = await memberUrlSets(kase.id);
    assert.ok(sets.tagUrls.has('https://pod.example/1'), 'imported transcript is a tag member of the case');
    const rec = await getArticle('https://pod.example/1');
    assert.equal(rec.article.entities[0].entity_id, kase.id);
    assert.equal(rec.article.entities[0].context, '');
});

test('import: the reader re-save keeps the same hash + preserves the case ref (no stealth-edit snapshot)', async () => {
    await reset();
    const kase = await EntityModel.create({ name: 'Origins', type: 'case' });
    const article = buildFromPaste(SRT, { title: 'Ep', url: 'https://pod.example/1' });
    article._articleHash = await computeTranscriptArticleHash(article);
    await saveArticle({ article, source: 'capture' });
    await addArticlesToCase(kase.id, [article.url]);

    // Simulate adoptArticle: merge the prior row's entities into the
    // incoming (fresh) article, then re-save with the same hash.
    const prior = await getArticle('https://pod.example/1');
    const merged = { ...article, entities: prior.article.entities, _articleHash: article._articleHash };
    const resaved = await saveArticle({ article: merged, source: 'capture' });
    assert.equal(resaved.articleHash, article._articleHash);
    assert.deepEqual(resaved.priorVersions, [], 'no false stealth-edit snapshot on an identical-hash re-save');
    assert.equal(resaved.article.entities[0].entity_id, kase.id, 'case ref survived the re-save');
});

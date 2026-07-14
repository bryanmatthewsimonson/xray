// Case membership authoring tests — Phase 20.2.
//
// Combines fake-indexeddb (archive cache) with a PERSISTING
// chrome.storage.local shim (EntityModel / ClaimModel live there), so
// the union-membership candidate math and the RMW entity-tag mutation
// can be exercised end to end.

import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('fake-indexeddb/auto');

const _store = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
                const out = {};
                for (const k of Array.isArray(keys) ? keys : [keys]) {
                    if (_store.has(k)) out[k] = _store.get(k);
                }
                cb(out);
            },
            set(obj, cb) { for (const [k, v] of Object.entries(obj)) _store.set(k, v); cb && cb(); },
            remove(keys, cb) { for (const k of Array.isArray(keys) ? keys : [keys]) _store.delete(k); cb && cb(); }
        }
    }
};

const { EntityModel } = await import('../src/shared/entity-model.js');
const { ClaimModel } = await import('../src/shared/claim-model.js');
const { LocalKeyManager } = await import('../src/shared/local-key-manager.js');
const { saveArticle, getArticle, clear: clearArchive } = await import('../src/shared/archive-cache.js');
const {
    memberUrlSets, listAddableArticles, addArticlesToCase, removeArticleFromCase
} = await import('../src/shared/case-membership.js');

async function reset() {
    _store.clear();
    LocalKeyManager.keys.clear();
    try { await clearArchive(); } catch (_) { /* db may not exist yet */ }
}

async function seedArchive(url, extra = {}) {
    return await saveArticle({ article: { url, title: url, content: '<p>x</p>', entities: [], ...extra }, ...extra.saveOpts });
}

test('membership: candidates exclude both tag- and claim-members', async () => {
    await reset();
    const kase = await EntityModel.create({ name: 'Case', type: 'case' });
    // a: tag member; b: claim member; c: addable.
    await seedArchive('https://ex.com/a', { entities: [{ entity_id: kase.id, context: '' }] });
    await seedArchive('https://ex.com/b');
    await seedArchive('https://ex.com/c');
    await ClaimModel.create({ text: 'x', source_url: 'https://ex.com/b', about: [kase.id] });

    const sets = await memberUrlSets(kase.id);
    assert.ok(sets.tagUrls.has('https://ex.com/a'));
    assert.ok(sets.claimUrls.has('https://ex.com/b'));

    const { candidates } = await listAddableArticles(kase.id);
    const urls = candidates.map((r) => r.url);
    assert.deepEqual(urls, ['https://ex.com/c']);
});

test('membership: add tags the canonical root with empty context, idempotent', async () => {
    await reset();
    const kase = await EntityModel.create({ name: 'Case', type: 'case' });
    await seedArchive('https://ex.com/c');
    const res = await addArticlesToCase(kase.id, ['https://ex.com/c']);
    assert.deepEqual(res.added, ['https://ex.com/c']);
    assert.deepEqual(res.published, []);

    const rec = await getArticle('https://ex.com/c');
    assert.equal(rec.article.entities.length, 1);
    assert.equal(rec.article.entities[0].entity_id, kase.id);
    assert.equal(rec.article.entities[0].context, '', 'empty context — never marks body text');

    // Idempotent: second add is a skip, no duplicate ref.
    const again = await addArticlesToCase(kase.id, ['https://ex.com/c']);
    assert.deepEqual(again.added, []);
    assert.deepEqual(again.skipped, ['https://ex.com/c']);
    const rec2 = await getArticle('https://ex.com/c');
    assert.equal(rec2.article.entities.length, 1);
});

test('membership: adding via an ALIAS id resolves to the canonical root', async () => {
    await reset();
    const kase = await EntityModel.create({ name: 'Case', type: 'case' });
    const alias = await EntityModel.create({ name: 'Case (alt)', type: 'case', canonical_id: kase.id });
    await seedArchive('https://ex.com/c');
    await addArticlesToCase(alias.id, ['https://ex.com/c']);
    const rec = await getArticle('https://ex.com/c');
    assert.equal(rec.article.entities[0].entity_id, kase.id, 'tagged the root, not the alias');

    // And a candidate tagged with the alias id counts as a member.
    await seedArchive('https://ex.com/d', { entities: [{ entity_id: alias.id, context: '' }] });
    const sets = await memberUrlSets(kase.id);
    assert.ok(sets.tagUrls.has('https://ex.com/d'), 'alias-tagged record is a member of the root case');
});

test('membership: remove strips the whole family; published flag surfaced on add', async () => {
    await reset();
    const kase = await EntityModel.create({ name: 'Case', type: 'case' });
    const alias = await EntityModel.create({ name: 'Case (alt)', type: 'case', canonical_id: kase.id });
    await seedArchive('https://ex.com/p', {
        entities: [{ entity_id: alias.id, context: '' }],
        saveOpts: { publishedToRelay: true, publishedEventId: 'evt1', source: 'capture' }
    });

    // Add reports the already-published record.
    const res = await addArticlesToCase(kase.id, ['https://ex.com/p']);
    // Already family-tagged (via alias) → skipped, but nothing removed.
    assert.deepEqual(res.skipped, ['https://ex.com/p']);

    const removed = await removeArticleFromCase(kase.id, 'https://ex.com/p');
    assert.equal(removed.removed, true);
    const rec = await getArticle('https://ex.com/p');
    assert.deepEqual(rec.article.entities, [], 'family ref stripped');
    // Provenance preserved across the RMW.
    assert.equal(rec.publishedToRelay, true);
    assert.equal(rec.publishedEventId, 'evt1');
});

test('membership: RMW preserves publishedToRelay + articleHash on a published add', async () => {
    await reset();
    const kase = await EntityModel.create({ name: 'Case', type: 'case' });
    const before = await saveArticle({
        article: { url: 'https://ex.com/pub', title: 'Pub', content: '<p>y</p>', entities: [] },
        publishedToRelay: true, publishedEventId: 'evtX', source: 'capture'
    });
    const res = await addArticlesToCase(kase.id, ['https://ex.com/pub']);
    assert.deepEqual(res.published, ['https://ex.com/pub'], 'add flags the published record');
    const rec = await getArticle('https://ex.com/pub');
    assert.equal(rec.publishedToRelay, true);
    assert.equal(rec.publishedEventId, 'evtX');
    assert.equal(rec.articleHash, before.articleHash, 'content hash unchanged by a tag mutation');
});

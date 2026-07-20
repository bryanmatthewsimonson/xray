// Mention-note tests — Phase 17 E4 (ENTITY_CORPUS_DESIGN.md §4.2).
// The wire shape is pinned exactly (consumers exist the moment a note
// relays), the quote selection never paraphrases, and the idempotence
// ledger keys on (entity, url, article hash) — a changed hash is a NEW
// note by design.

import { test } from 'node:test';
import assert from 'node:assert/strict';

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

const {
    buildMentionNoteEvent, selectMentionQuote, mentionKey, MentionLedger,
    PUBLISHED_MENTIONS_KEY, MENTION_NOTE_CAP_PER_ARTICLE
} = await import('../src/shared/mention-notes.js');
const { WORKSPACE_CONTENT_KEYS } = await import('../src/shared/workspace-keys.js');

test('E4: the kind-1 wire shape is §4.2 exactly', () => {
    const ev = buildMentionNoteEvent({
        entityPubkey: 'e'.repeat(64), entityType: 'person',
        publisherPubkey: 'u'.repeat(64),
        articleTitle: 'The stolen Legos',
        articleUrl: 'https://ex.com/a',
        articleCoord: `30023:${'u'.repeat(64)}:d-tag`,
        articleHash: 'h'.repeat(64),
        quote: 'store owner Bob Smith reported the theft',
        createdAt: 1234567890
    });
    assert.equal(ev.kind, 1);
    assert.equal(ev.pubkey, 'e'.repeat(64));
    assert.equal(ev.created_at, 1234567890);
    assert.equal(ev.content,
        'Mentioned in "The stolen Legos"\n\n"store owner Bob Smith reported the theft"\n\nhttps://ex.com/a');
    assert.deepEqual(ev.tags, [
        ['r', 'https://ex.com/a'],
        ['a', `30023:${'u'.repeat(64)}:d-tag`, '', 'mention'],
        ['x', 'h'.repeat(64)],
        ['p', 'u'.repeat(64), '', 'publisher'],
        ['quote', 'store owner Bob Smith reported the theft'],
        ['client', 'xray']
    ]);
});

test('E4: optional parts degrade honestly — no coord/hash/quote tags when absent, content keeps its shape', () => {
    const ev = buildMentionNoteEvent({
        entityPubkey: 'e'.repeat(64), entityType: 'organization',
        publisherPubkey: 'u'.repeat(64),
        articleTitle: '', articleUrl: 'https://ex.com/a'
    });
    assert.equal(ev.content, 'Mentioned in "https://ex.com/a"\n\nhttps://ex.com/a');
    assert.deepEqual(ev.tags.map((t) => t[0]), ['r', 'p', 'client'], 'no a/x/quote when unknown');
});

test('E4: selectMentionQuote — the grounded ref context first, else the strongest claim quote, never a paraphrase', () => {
    const claims = [
        { id: 'c1', quote: 'ordinary quote', about: ['ent_a'], source_url: 'https://ex.com/a', created: 2 },
        { id: 'c2', quote: 'THE key quote', about: ['ent_a'], source_url: 'https://ex.com/a', is_key: true, created: 3 },
        { id: 'c3', quote: 'other article', about: ['ent_a'], source_url: 'https://ex.com/b', is_key: true },
        { id: 'c4', quote: 'other entity', about: ['ent_b'], source_url: 'https://ex.com/a' },
        { id: 'c5', about: ['ent_a'], source_url: 'https://ex.com/a' }   // no quote
    ];
    assert.equal(selectMentionQuote({
        ref: { context: 'the mention span' }, entityId: 'ent_a', articleUrl: 'https://ex.com/a', claims
    }), 'the mention span', 'ref context wins');
    assert.equal(selectMentionQuote({
        ref: {}, entityId: 'ent_a', articleUrl: 'https://ex.com/a', claims
    }), 'THE key quote', 'is_key claim quote from THIS article');
    assert.equal(selectMentionQuote({
        ref: {}, entityId: 'ent_c', articleUrl: 'https://ex.com/a', claims
    }), null, 'nothing stored → null, never a paraphrase');
});

test('E4: the ledger — keyed on (entity, url, hash); a changed hash is a NEW note; workspace content', async () => {
    _store.clear();
    const k1 = mentionKey('ent_a', 'https://ex.com/a', 'hash1');
    const k2 = mentionKey('ent_a', 'https://ex.com/a', 'hash2');
    assert.notEqual(k1, k2, 'edition provenance: a changed hash mints a new key');
    assert.equal(await MentionLedger.has(k1), false);
    await MentionLedger.record(k1, { eventId: 'ev1' });
    assert.equal(await MentionLedger.has(k1), true);
    assert.equal(await MentionLedger.has(k2), false);
    // The ledger is workspace content: namespaced, reset-cleared, backed up.
    assert.ok(WORKSPACE_CONTENT_KEYS.includes(PUBLISHED_MENTIONS_KEY));
    // The cap exists and is sane.
    assert.ok(MENTION_NOTE_CAP_PER_ARTICLE >= 1);
});

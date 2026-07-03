// Claim model tests — thin model (Phase 10.1).
//
// Same chrome.storage.local shim pattern as entity-model.test.mjs.

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

const { ClaimModel, generateClaimId, parseClaimEvent } = await import('../src/shared/claim-model.js');

function resetState() { _stateStore.clear(); }

const URL_A = 'https://example.com/article-a';
const URL_B = 'https://example.com/article-b';
const ENT_1 = 'entity_aaaaaaaaaaaaaaaa';
const ENT_2 = 'entity_bbbbbbbbbbbbbbbb';

// ---------------------------------------------------------------------

test('claim: deterministic id generation (stable across the redesign)', async () => {
    const a = await generateClaimId(URL_A, 'The sky is blue.');
    const b = await generateClaimId(URL_A, '  the   sky   is   BLUE.  ');
    const c = await generateClaimId(URL_A, 'The sky is green.');
    const d = await generateClaimId(URL_B, 'The sky is blue.');
    assert.equal(a, b, 'whitespace + case normalization must produce same id');
    assert.notEqual(a, c, 'different text → different id');
    assert.notEqual(a, d, 'different source URL → different id');
    assert.match(a, /^claim_[0-9a-f]{16}$/);
});

test('claim: thin create + get round-trip', async () => {
    resetState();
    const claim = await ClaimModel.create({
        text: 'Democracy is under threat.',
        source_url: URL_A,
        about: [ENT_1, ENT_2],
        source: ENT_1,
        is_key: true
    });
    assert.match(claim.id, /^claim_[0-9a-f]{16}$/);
    assert.deepEqual(claim.about, [ENT_1, ENT_2]);
    assert.equal(claim.source, ENT_1);
    assert.equal(claim.is_key, true);

    const fetched = await ClaimModel.get(claim.id);
    assert.deepEqual(fetched, claim);
});

test('claim: about dedups + drops empties; defaults are sane', async () => {
    resetState();
    const claim = await ClaimModel.create({
        text: 'A.', source_url: URL_A, about: [ENT_1, ENT_1, '', null, ENT_2]
    });
    assert.deepEqual(claim.about, [ENT_1, ENT_2]);
    assert.equal(claim.source, null);   // no source → "the article"
    assert.equal(claim.is_key, false);
    assert.deepEqual(claim.anchor, null);
});

test('claim: source can be free text (a quoted name) or null', async () => {
    resetState();
    const quoted = await ClaimModel.create({ text: 'A.', source_url: URL_A, source: '  Jane Roe  ' });
    assert.equal(quoted.source, 'Jane Roe');
    const article = await ClaimModel.create({ text: 'B.', source_url: URL_A, source: '' });
    assert.equal(article.source, null);
});

test('claim: create is idempotent on same (url, normalized-text)', async () => {
    resetState();
    const a = await ClaimModel.create({ text: 'Same claim.',  source_url: URL_A });
    const b = await ClaimModel.create({ text: 'SAME   claim.', source_url: URL_A });
    assert.equal(a.id, b.id);
});

test('claim: rejects empty text / missing url', async () => {
    resetState();
    await assert.rejects(() => ClaimModel.create({ text: '',  source_url: URL_A }), /text is required/);
    await assert.rejects(() => ClaimModel.create({ text: 'X', source_url: ''     }), /source_url is required/);
});

test('claim: update patches thin fields, refuses immutable ones', async () => {
    resetState();
    const claim = await ClaimModel.create({ text: 'Original.', source_url: URL_A, about: [ENT_1] });
    const updated = await ClaimModel.update(claim.id, {
        about: [ENT_2],
        source: 'A spokesperson',
        is_key: true,
        // immutable — ignored:
        text: 'CHANGED', source_url: URL_B, id: 'claim_fake'
    });
    assert.equal(updated.id, claim.id);
    assert.equal(updated.text, 'Original.');
    assert.equal(updated.source_url, URL_A);
    assert.deepEqual(updated.about, [ENT_2]);
    assert.equal(updated.source, 'A spokesperson');
    assert.equal(updated.is_key, true);
    assert.ok(updated.updated >= claim.updated);
});

test('claim: getBySourceUrl filters and sorts key claims first', async () => {
    resetState();
    const earlyNonKey = await ClaimModel.create({ text: 'Early non-key.', source_url: URL_A });
    const lateKey     = await ClaimModel.create({ text: 'Late key.',      source_url: URL_A, is_key: true });
    await ClaimModel.create({ text: 'Different article.', source_url: URL_B });

    const forA = await ClaimModel.getBySourceUrl(URL_A);
    assert.equal(forA.length, 2);
    assert.equal(forA[0].id, lateKey.id, 'key claim sorts first regardless of creation order');
    assert.equal(forA[1].id, earlyNonKey.id);
});

test('claim: legacy records normalize to thin fields on read', async () => {
    resetState();
    // Simulate a pre-10.1 record written straight into storage.
    const legacyId = await generateClaimId(URL_A, 'Legacy claim.');
    _stateStore.set('article_claims', {
        [legacyId]: {
            id: legacyId, text: 'Legacy claim.', source_url: URL_A,
            type: 'causal', is_crux: true, confidence: 80, attribution: 'paraphrase',
            subject_entity_ids: [ENT_1], object_entity_ids: [ENT_2],
            claimant_entity_id: ENT_1, predicate: 'causes',
            created: 1, updated: 1, publishedAt: null, publishedEventId: null
        }
    });
    const got = await ClaimModel.get(legacyId);
    assert.deepEqual(got.about, [ENT_1, ENT_2], 'about backfilled from subject ∪ object');
    assert.equal(got.is_key, true, 'is_key backfilled from is_crux');
    assert.equal(got.source, ENT_1, 'source backfilled from claimant');
});

test('parseClaimEvent: reads the thin (10.2) vocabulary', () => {
    const ev = {
        id: 'evid', pubkey: 'a'.repeat(64), created_at: 100,
        content: 'Jane runs Acme.',
        tags: [
            ['d', 'claim_1'], ['r', 'https://x.test/a'], ['title', 'A Title'],
            ['p', 'b'.repeat(64), '', 'about'], ['entity', 'Jane Roe', 'about'],
            ['entity', 'Acme Corp', 'about'],
            ['source', 'Jane Roe'], ['key', 'true']
        ]
    };
    const c = parseClaimEvent(ev);
    assert.equal(c.id, 'claim_1');
    assert.equal(c.text, 'Jane runs Acme.');
    assert.deepEqual(c.about, ['Jane Roe', 'Acme Corp']);
    assert.equal(c.source, 'Jane Roe');
    assert.equal(c.isKey, true);
    assert.equal(c.url, 'https://x.test/a');
    assert.equal(c.title, 'A Title');
    assert.equal(c.pubkey, 'a'.repeat(64));
});

test('parseClaimEvent: reads the legacy vocabulary', () => {
    const ev = {
        pubkey: 'c'.repeat(64), created_at: 50,
        content: 'ignored body',
        tags: [
            ['claim-text', 'Old-style claim.'], ['claim-type', 'factual'],
            ['subject', 'Old Subject'], ['object', 'Old Object'],
            ['claimant', 'A Reporter'], ['crux', 'true']
        ]
    };
    const c = parseClaimEvent(ev);
    assert.equal(c.text, 'Old-style claim.', 'prefers claim-text tag over content');
    assert.deepEqual(c.about, ['Old Subject', 'Old Object'], 'about backfilled from subject ∪ object');
    assert.equal(c.source, 'A Reporter', 'source from claimant');
    assert.equal(c.isKey, true, 'isKey from crux');
});

test('claim: delete + markPublished', async () => {
    resetState();
    const claim = await ClaimModel.create({ text: 'Publishable.', source_url: URL_A });
    const marked = await ClaimModel.markPublished(claim.id, 'e'.repeat(64));
    assert.ok(marked.publishedAt > 0);
    assert.equal(marked.updated, claim.updated, 'publish must not bump updated');

    assert.equal(await ClaimModel.delete(claim.id), true);
    assert.equal(await ClaimModel.get(claim.id), null);
    assert.equal(await ClaimModel.delete(claim.id), false);
});

test('claim: markPublished records the publishing pubkey (Phase 11.1)', async () => {
    resetState();
    const PUBKEY = 'a'.repeat(64);
    const claim = await ClaimModel.create({ text: 'Coordinate-bearing.', source_url: URL_A });
    assert.equal(claim.publishedPubkey, undefined, 'unset before publish');

    const marked = await ClaimModel.markPublished(claim.id, 'e'.repeat(64), PUBKEY);
    assert.equal(marked.publishedPubkey, PUBKEY);
    assert.equal(marked.updated, claim.updated, 'publish must not bump updated');

    // Omitting the pubkey (legacy call shape) must not clear it.
    const again = await ClaimModel.markPublished(claim.id, 'f'.repeat(64));
    assert.equal(again.publishedPubkey, PUBKEY, 'pubkey survives a pubkey-less re-publish call');
});

// ---------------------------------------------------------------------
// Text provenance (Phase 14.5 hardening): quote + article_hash
// ---------------------------------------------------------------------

test('claim: stores quote + article_hash, cleaned', async () => {
    resetState();
    const HASH = 'AB'.repeat(32);
    const claim = await ClaimModel.create({
        text: 'Provenance-bearing.', source_url: URL_A,
        quote: '  the verbatim span  ', article_hash: HASH
    });
    assert.equal(claim.quote, 'the verbatim span');
    assert.equal(claim.article_hash, 'ab'.repeat(32), 'hash lowercased');

    // Bad values collapse to null, never garbage.
    const bare = await ClaimModel.create({
        text: 'No provenance.', source_url: URL_A,
        quote: '   ', article_hash: 'not-a-hash'
    });
    assert.equal(bare.quote, null);
    assert.equal(bare.article_hash, null);
});

test('claim: quote/article_hash are patchable, and quote is capped', async () => {
    resetState();
    const claim = await ClaimModel.create({ text: 'Patch me.', source_url: URL_A });
    const patched = await ClaimModel.update(claim.id, {
        quote: 'x'.repeat(5000), article_hash: 'f'.repeat(64)
    });
    assert.equal(patched.quote.length, 4000, 'quote capped at 4000');
    assert.equal(patched.article_hash, 'f'.repeat(64));
});

test('parseClaimEvent: tolerates a malformed anchor tag', () => {
    const c = parseClaimEvent({
        tags: [['d', 'claim_x'], ['anchor', '{not json'], ['quote', 'q']],
        content: 'T'
    });
    assert.equal(c.anchor, null);
    assert.equal(c.quote, 'q');
});

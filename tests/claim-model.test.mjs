// Claim model tests — Phase 5 C1 (issue #16).
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

const { ClaimModel, CLAIM_TYPES, CLAIM_ATTRIBUTIONS, generateClaimId } =
    await import('../src/shared/claim-model.js');

function resetState() { _stateStore.clear(); }

const URL_A = 'https://example.com/article-a';
const URL_B = 'https://example.com/article-b';

// ---------------------------------------------------------------------

test('claim: deterministic id generation', async () => {
    const a = await generateClaimId(URL_A, 'The sky is blue.');
    const b = await generateClaimId(URL_A, '  the   sky   is   BLUE.  ');
    const c = await generateClaimId(URL_A, 'The sky is green.');
    const d = await generateClaimId(URL_B, 'The sky is blue.');
    assert.equal(a, b, 'whitespace + case normalization must produce same id');
    assert.notEqual(a, c, 'different text → different id');
    assert.notEqual(a, d, 'different source URL → different id');
    assert.match(a, /^claim_[0-9a-f]{16}$/);
});

test('claim: create + get round-trip', async () => {
    resetState();
    const claim = await ClaimModel.create({
        text: 'Democracy is under threat.',
        type: 'evaluative',
        source_url: URL_A,
        is_crux: true,
        confidence: 75,
        attribution: 'thesis',
        predicate: 'is threatened by',
        subject_text: 'Democracy',
        object_text: 'Authoritarianism'
    });
    assert.match(claim.id, /^claim_[0-9a-f]{16}$/);
    assert.equal(claim.type, 'evaluative');
    assert.equal(claim.is_crux, true);
    assert.equal(claim.confidence, 75);
    assert.equal(claim.attribution, 'thesis');

    const fetched = await ClaimModel.get(claim.id);
    assert.deepEqual(fetched, claim);
});

test('claim: create is idempotent on same (url, normalized-text)', async () => {
    resetState();
    const a = await ClaimModel.create({
        text: 'Same claim.',
        type: 'factual',
        source_url: URL_A
    });
    const b = await ClaimModel.create({
        text: 'SAME   claim.',   // whitespace + case
        type: 'factual',
        source_url: URL_A
    });
    assert.equal(a.id, b.id, 'idempotent create must collide on the same id');
});

test('claim: rejects invalid type / attribution / empty text / bad confidence', async () => {
    resetState();
    await assert.rejects(() => ClaimModel.create({ text: 'X', type: 'bogus',    source_url: URL_A }), /Invalid claim type/);
    await assert.rejects(() => ClaimModel.create({ text: '',  type: 'factual',  source_url: URL_A }), /text is required/);
    await assert.rejects(() => ClaimModel.create({ text: 'X', type: 'factual',  source_url: ''     }), /source_url is required/);
    await assert.rejects(() => ClaimModel.create({
        text: 'X', type: 'factual', source_url: URL_A, attribution: 'bogus'
    }), /Invalid attribution/);
    await assert.rejects(() => ClaimModel.create({
        text: 'X', type: 'factual', source_url: URL_A, confidence: 150
    }), /Invalid confidence/);
    await assert.rejects(() => ClaimModel.create({
        text: 'X', type: 'factual', source_url: URL_A, confidence: -5
    }), /Invalid confidence/);
});

test('claim: confidence gets rounded; null is preserved', async () => {
    resetState();
    const a = await ClaimModel.create({ text: 'A', type: 'factual', source_url: URL_A, confidence: 87.4 });
    assert.equal(a.confidence, 87);
    const b = await ClaimModel.create({ text: 'B', type: 'factual', source_url: URL_A, confidence: null });
    assert.equal(b.confidence, null);
});

test('claim: update patches mutable fields but refuses immutable ones', async () => {
    resetState();
    const claim = await ClaimModel.create({
        text: 'Original.', type: 'factual', source_url: URL_A
    });
    const originalId = claim.id;
    const originalText = claim.text;
    const updated = await ClaimModel.update(claim.id, {
        type: 'causal',
        is_crux: true,
        confidence: 50,
        predicate: 'causes',
        subject_text: 'A',
        object_text: 'B',
        // text + source_url + id are immutable — Updater ignores them.
        text: 'CHANGED',
        source_url: URL_B,
        id: 'claim_fake'
    });
    assert.equal(updated.id, originalId,     'id stays stable');
    assert.equal(updated.text, originalText, 'text stays stable');
    assert.equal(updated.source_url, URL_A,  'source_url stays stable');
    assert.equal(updated.type, 'causal');
    assert.equal(updated.is_crux, true);
    assert.equal(updated.confidence, 50);
    assert.equal(updated.predicate, 'causes');
    assert.ok(updated.updated >= claim.updated);
});

test('claim: getBySourceUrl filters and sorts cruxes first', async () => {
    resetState();
    const earlyNonCrux = await ClaimModel.create({ text: 'Early non-crux.', type: 'factual', source_url: URL_A });
    const lateCrux     = await ClaimModel.create({ text: 'Late crux.',     type: 'evaluative', source_url: URL_A, is_crux: true });
    await ClaimModel.create({ text: 'Different article.', type: 'factual', source_url: URL_B });

    const forA = await ClaimModel.getBySourceUrl(URL_A);
    assert.equal(forA.length, 2);
    assert.equal(forA[0].id, lateCrux.id,      'crux sorts first regardless of creation order');
    assert.equal(forA[1].id, earlyNonCrux.id);

    const forB = await ClaimModel.getBySourceUrl(URL_B);
    assert.equal(forB.length, 1);
});

test('claim: delete removes record; no cascade on evidence links (C4 handles those)', async () => {
    resetState();
    const claim = await ClaimModel.create({ text: 'Deletable.', type: 'factual', source_url: URL_A });
    assert.ok(await ClaimModel.get(claim.id));
    const ok = await ClaimModel.delete(claim.id);
    assert.equal(ok, true);
    assert.equal(await ClaimModel.get(claim.id), null);
    const notFound = await ClaimModel.delete(claim.id);
    assert.equal(notFound, false);
});

test('claim: markPublished records publishedAt without bumping updated', async () => {
    resetState();
    const claim = await ClaimModel.create({ text: 'Publishable.', type: 'factual', source_url: URL_A });
    const updatedBefore = claim.updated;
    const marked = await ClaimModel.markPublished(claim.id, 'eventid' + '0'.repeat(57));
    assert.ok(marked.publishedAt > 0);
    assert.ok(marked.publishedEventId && marked.publishedEventId.length === 64);
    assert.equal(marked.updated, updatedBefore, 'publish must not bump updated');
});

test('claim: type + attribution enums are exhaustive', () => {
    assert.deepEqual(CLAIM_TYPES.slice().sort(), ['causal', 'evaluative', 'factual', 'predictive']);
    assert.deepEqual(CLAIM_ATTRIBUTIONS.slice().sort(), ['direct_quote', 'editorial', 'paraphrase', 'thesis']);
});

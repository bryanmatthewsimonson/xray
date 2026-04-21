// Evidence linker tests — Phase 5 C4 (issue #16).

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

const { EvidenceLinker, EVIDENCE_RELATIONSHIPS, generateEvidenceLinkId } =
    await import('../src/shared/evidence-linker.js');

function resetState() { _stateStore.clear(); }

// Valid-looking claim IDs for validation. Real ones are sha256-derived,
// but the validator only enforces the `claim_<16 hex>` shape.
const A = 'claim_aaaaaaaaaaaaaaaa';
const B = 'claim_bbbbbbbbbbbbbbbb';
const C = 'claim_cccccccccccccccc';

// ---------------------------------------------------------------------

test('evidence: deterministic id derivation', async () => {
    const idAB_supports = await generateEvidenceLinkId(A, B, 'supports');
    const idBA_supports = await generateEvidenceLinkId(B, A, 'supports');
    const idAB_contradicts = await generateEvidenceLinkId(A, B, 'contradicts');
    assert.notEqual(idAB_supports, idBA_supports,      'direction matters');
    assert.notEqual(idAB_supports, idAB_contradicts,   'relationship included in hash');
    assert.match(idAB_supports, /^link_[0-9a-f]{16}$/);
});

test('evidence: create + get round-trip', async () => {
    resetState();
    const link = await EvidenceLinker.create({
        source_claim_id: A,
        target_claim_id: B,
        relationship: 'supports',
        note: 'Cites the same study.'
    });
    assert.match(link.id, /^link_[0-9a-f]{16}$/);
    assert.equal(link.relationship, 'supports');
    assert.equal(link.note, 'Cites the same study.');
    const fetched = await EvidenceLinker.get(link.id);
    assert.deepEqual(fetched, link);
});

test('evidence: create is idempotent on same triple', async () => {
    resetState();
    const first = await EvidenceLinker.create({
        source_claim_id: A, target_claim_id: B, relationship: 'supports'
    });
    const second = await EvidenceLinker.create({
        source_claim_id: A, target_claim_id: B, relationship: 'supports',
        note: 'should be ignored — link already exists'
    });
    assert.equal(first.id, second.id);
    assert.equal(second.note, '', 'idempotent create returns the EXISTING record (without new note)');
});

test('evidence: rejects self-link, invalid relationship, malformed claim ids', async () => {
    resetState();
    await assert.rejects(() => EvidenceLinker.create({
        source_claim_id: A, target_claim_id: A, relationship: 'supports'
    }), /Cannot link a claim to itself/);
    await assert.rejects(() => EvidenceLinker.create({
        source_claim_id: A, target_claim_id: B, relationship: 'loves'
    }), /Invalid relationship/);
    await assert.rejects(() => EvidenceLinker.create({
        source_claim_id: 'not-a-claim', target_claim_id: B, relationship: 'supports'
    }), /must be a claim id/);
    await assert.rejects(() => EvidenceLinker.create({
        source_claim_id: '', target_claim_id: B, relationship: 'supports'
    }), /source_claim_id is required/);
});

test('evidence: update patches note, preserves structural fields', async () => {
    resetState();
    const link = await EvidenceLinker.create({
        source_claim_id: A, target_claim_id: B, relationship: 'supports', note: 'original'
    });
    const updated = await EvidenceLinker.update(link.id, {
        note: 'revised',
        // source / target / relationship should be IGNORED (immutable)
        source_claim_id: 'claim_0000000000000000',
        target_claim_id: 'claim_0000000000000000',
        relationship: 'contradicts'
    });
    assert.equal(updated.note, 'revised');
    assert.equal(updated.source_claim_id, A);
    assert.equal(updated.target_claim_id, B);
    assert.equal(updated.relationship, 'supports');
});

test('evidence: getForClaim returns both source-side and target-side links', async () => {
    resetState();
    const ab_supports = await EvidenceLinker.create({ source_claim_id: A, target_claim_id: B, relationship: 'supports' });
    const ab_context  = await EvidenceLinker.create({ source_claim_id: A, target_claim_id: B, relationship: 'contextualizes' });
    const ba_contra   = await EvidenceLinker.create({ source_claim_id: B, target_claim_id: A, relationship: 'contradicts' });
    const cb_support  = await EvidenceLinker.create({ source_claim_id: C, target_claim_id: B, relationship: 'supports' });

    const forA = await EvidenceLinker.getForClaim(A);
    const ids = forA.map((l) => l.id).sort();
    assert.deepEqual(ids.sort(), [ab_supports.id, ab_context.id, ba_contra.id].sort());
});

test('evidence: delete removes the specific link', async () => {
    resetState();
    const link = await EvidenceLinker.create({ source_claim_id: A, target_claim_id: B, relationship: 'supports' });
    assert.ok(await EvidenceLinker.get(link.id));
    const ok = await EvidenceLinker.delete(link.id);
    assert.equal(ok, true);
    assert.equal(await EvidenceLinker.get(link.id), null);
});

test('evidence: deleteForClaim removes all links touching a claim', async () => {
    resetState();
    await EvidenceLinker.create({ source_claim_id: A, target_claim_id: B, relationship: 'supports' });
    await EvidenceLinker.create({ source_claim_id: B, target_claim_id: A, relationship: 'contradicts' });
    await EvidenceLinker.create({ source_claim_id: C, target_claim_id: B, relationship: 'supports' });

    const removed = await EvidenceLinker.deleteForClaim(A);
    assert.equal(removed, 2);
    const remaining = await EvidenceLinker.getAll();
    // Only the C→B link (neither endpoint is A) should survive.
    assert.equal(Object.keys(remaining).length, 1);
});

test('evidence: markPublished records publishedAt without bumping updated', async () => {
    resetState();
    const link = await EvidenceLinker.create({ source_claim_id: A, target_claim_id: B, relationship: 'supports' });
    const updatedBefore = link.updated;
    const marked = await EvidenceLinker.markPublished(link.id, 'eventid' + '0'.repeat(57));
    assert.ok(marked.publishedAt > 0);
    assert.equal(marked.updated, updatedBefore, 'publish must not bump updated');
});

test('evidence: relationship enum is exhaustive', () => {
    assert.deepEqual(
        EVIDENCE_RELATIONSHIPS.slice().sort(),
        ['contextualizes', 'contradicts', 'supports']
    );
});

// Assessment model tests — Phase 11.1 (docs/ASSESSMENTS_DESIGN.md).
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

const { AssessmentModel, generateAssessmentId } = await import('../src/shared/assessment-model.js');
const { ClaimModel } = await import('../src/shared/claim-model.js');
const { buildClaimCoord } = await import('../src/shared/claim-ref.js');

function resetState() { _stateStore.clear(); }

const PUBKEY_A = 'a'.repeat(64);
const PUBKEY_B = 'b'.repeat(64);
const URL_1 = 'https://example.com/video-1';

async function seedClaim(text = 'The collection was worth $200,000.', url = URL_1) {
    return await ClaimModel.create({ text, source_url: url });
}

// ---------------------------------------------------------------------

test('assessment: deterministic id derivation', async () => {
    const a = await generateAssessmentId('claim_aaaaaaaaaaaaaaaa');
    const b = await generateAssessmentId('claim_bbbbbbbbbbbbbbbb');
    assert.match(a, /^assess_[0-9a-f]{16}$/);
    assert.notEqual(a, b, 'different refs derive different ids');
    assert.equal(a, await generateAssessmentId('claim_aaaaaaaaaaaaaaaa'), 'stable');
});

test('assessment: create + get round-trip on an own claim', async () => {
    resetState();
    // utm params must be stripped from the snapshot url (the URL rule).
    const claim = await seedClaim('Quote.', 'https://example.com/video-1?utm_source=feed');
    const assessment = await AssessmentModel.create({
        claim_ref: { claim_id: claim.id },
        stance:    -1,
        labels:    [{ label: 'misleading', note: 'closure framed as neutral' }],
        rationale: 'Both sides confirm it was not mutual.'
    });

    assert.match(assessment.id, /^assess_[0-9a-f]{16}$/);
    assert.equal(assessment.claim_ref.claim_id, claim.id);
    assert.equal(assessment.claim_ref.coord, null, 'no coordinate before the claim publishes');
    assert.equal(assessment.claim_ref.url, 'https://example.com/video-1', 'snapshot url normalized');
    assert.equal(assessment.claim_ref.text, 'Quote.');
    assert.equal(assessment.stance, -1);
    assert.deepEqual(assessment.labels, [{
        label: 'misleading', anchor: null, note: 'closure framed as neutral', suggested_by: 'user'
    }]);
    assert.equal(assessment.suggested_by, 'user');
    assert.equal(assessment.publishedAt, null);

    const fetched = await AssessmentModel.get(assessment.id);
    assert.deepEqual(fetched, assessment);
});

test('assessment: own-claim refs must exist in the registry', async () => {
    resetState();
    await assert.rejects(() => AssessmentModel.create({
        claim_ref: { claim_id: 'claim_aaaaaaaaaaaaaaaa' }, stance: 1
    }), /Claim not found/);
});

test('assessment: foreign claims by coordinate, with required snapshots', async () => {
    resetState();
    const coord = buildClaimCoord(PUBKEY_B, 'their-claim-d');
    const assessment = await AssessmentModel.create({
        claim_ref: {
            coord,
            event_id: 'f'.repeat(64),
            url:  'https://example.com/their-video?fbclid=track',
            text: 'We parted ways by mutual agreement.'
        },
        labels: ['euphemism', 'misleading']
    });
    assert.equal(assessment.claim_ref.claim_id, null);
    assert.equal(assessment.claim_ref.coord, coord);
    assert.equal(assessment.claim_ref.event_id, 'f'.repeat(64), 'event_id rides along');
    assert.equal(assessment.claim_ref.author_pubkey, PUBKEY_B);
    assert.equal(assessment.claim_ref.url, 'https://example.com/their-video', 'normalized');
    assert.equal(assessment.stance, null, 'label-only assessment is valid');
    assert.deepEqual(assessment.labels.map((l) => l.label), ['euphemism', 'misleading']);

    await assert.rejects(() => AssessmentModel.create({
        claim_ref: { coord: buildClaimCoord(PUBKEY_B, 'other-d'), text: 'no url' }, stance: 0
    }), /claim_ref\.url is required/);
    await assert.rejects(() => AssessmentModel.create({
        claim_ref: { coord: buildClaimCoord(PUBKEY_B, 'other-d'), url: URL_1 }, stance: 0
    }), /claim_ref\.text is required/);
});

test('assessment: idempotent create — one assessment per claim', async () => {
    resetState();
    const claim = await seedClaim();
    const first = await AssessmentModel.create({ claim_ref: { claim_id: claim.id }, stance: 2 });
    const second = await AssessmentModel.create({
        claim_ref: { claim_id: claim.id }, stance: -2, rationale: 'ignored — record exists'
    });
    assert.equal(first.id, second.id);
    assert.equal(second.stance, 2, 'idempotent create returns the EXISTING record');
});

test('assessment: identity survives the publish boundary (local id ↔ coordinate)', async () => {
    resetState();
    const claim = await seedClaim();
    const prePublish = await AssessmentModel.create({
        claim_ref: { claim_id: claim.id }, stance: 1
    });

    await ClaimModel.markPublished(claim.id, 'e'.repeat(64), PUBKEY_A);
    const coord = buildClaimCoord(PUBKEY_A, claim.id);

    // Re-encountering our own published claim by coordinate must hit
    // the SAME record — the canonical-ref rule, not a second record.
    const postPublish = await AssessmentModel.create({
        claim_ref: { coord, url: URL_1, text: claim.text }, stance: -2
    });
    assert.equal(postPublish.id, prePublish.id, 'same record across the publish boundary');
    assert.equal(postPublish.stance, 1, 'existing judgment wins');

    const byCoord = await AssessmentModel.getByClaimRef(coord);
    assert.equal(byCoord.id, prePublish.id);
    const byId = await AssessmentModel.getByClaimRef(claim.id);
    assert.equal(byId.id, prePublish.id);

    // Same d under a different pubkey is a DIFFERENT (foreign) claim.
    const foreign = await AssessmentModel.create({
        claim_ref: { coord: buildClaimCoord(PUBKEY_B, claim.id), url: URL_1, text: claim.text },
        stance: 0
    });
    assert.notEqual(foreign.id, prePublish.id);
});

test('assessment: drift — a coordinate-keyed record stays reachable once the claim gains publishedPubkey', async () => {
    resetState();
    const claim = await seedClaim('Drifting claim.', 'https://example.com/video-9');
    // Published pre-11.1 style: publishedAt recorded, but no pubkey —
    // the claim's own coordinate does NOT collapse, so an assessment
    // created against it is keyed by the coordinate.
    await ClaimModel.markPublished(claim.id, 'e'.repeat(64));
    const coord = buildClaimCoord(PUBKEY_A, claim.id);
    const a = await AssessmentModel.create({
        claim_ref: { coord, url: 'https://example.com/video-9', text: claim.text }, stance: -1
    });
    assert.equal(a.claim_ref.coord, coord);
    assert.equal(a.claim_ref.claim_id, null, 'stored as a foreign-style coordinate ref');

    // The pubkey lands later (a republish) — the stored coordinate is
    // now collapsible. Matching must canonicalize the STORED side too,
    // or the record is orphaned by both representations.
    await ClaimModel.markPublished(claim.id, 'f'.repeat(64), PUBKEY_A);
    const byId    = await AssessmentModel.getByClaimRef(claim.id);
    const byCoord = await AssessmentModel.getByClaimRef(coord);
    assert.ok(byId, 'reachable by local id after drift');
    assert.ok(byCoord, 'reachable by coordinate after drift');
    assert.equal(byId.id, a.id);
    assert.equal(byCoord.id, a.id);

    // …and idempotent create must find the drifted record, not mint a
    // second assessment for the same logical claim.
    const again = await AssessmentModel.create({ claim_ref: { claim_id: claim.id }, stance: 2 });
    assert.equal(again.id, a.id, 'one assessment per claim — even after drift');
    assert.equal(again.stance, -1, 'existing judgment wins');
    assert.equal(Object.keys(await AssessmentModel.getAll()).length, 1);
});

test('assessment: validation — stance range, judgment invariant, labels', async () => {
    resetState();
    const claim = await seedClaim();
    const ref = { claim_id: claim.id };

    await assert.rejects(() => AssessmentModel.create({ claim_ref: ref }),
        /needs a stance or at least one label/);
    for (const bad of [3, -3, 1.5, '1']) {
        await assert.rejects(() => AssessmentModel.create({ claim_ref: ref, stance: bad }),
            /Invalid stance/, `stance ${bad} rejected`);
    }
    await assert.rejects(() => AssessmentModel.create({
        claim_ref: ref, labels: ['misleading', 'misleading']
    }), /Duplicate label/);
    await assert.rejects(() => AssessmentModel.create({
        claim_ref: ref, labels: ['Has Space']
    }), /Invalid label/);
    await assert.rejects(() => AssessmentModel.create({
        claim_ref: ref, stance: 1, suggested_by: 'bot'
    }), /Invalid suggested_by/);
    await assert.rejects(() => AssessmentModel.create({
        claim_ref: ref, stance: 1, labels: [{ label: 'misleading', suggested_by: 'robot' }]
    }), /Invalid label suggested_by/);

    // Custom labels and llm provenance ride the same rails.
    const ok = await AssessmentModel.create({
        claim_ref: ref,
        stance: null,
        labels: [{ label: 'pinky-promise', suggested_by: 'llm:claude-fable-5' }],
        suggested_by: 'llm:claude-fable-5'
    });
    assert.equal(ok.labels[0].suggested_by, 'llm:claude-fable-5');
});

test('assessment: update patches judgment fields, never claim_ref', async () => {
    resetState();
    const claim = await seedClaim();
    const a = await AssessmentModel.create({ claim_ref: { claim_id: claim.id }, stance: 0 });

    const updated = await AssessmentModel.update(a.id, {
        stance: 2,
        labels: ['cherry-picked'],
        rationale: 'On reflection, the quote is real but selective.',
        claim_ref: { claim_id: 'claim_ffffffffffffffff' }   // must be IGNORED
    });
    assert.equal(updated.stance, 2);
    assert.deepEqual(updated.labels.map((l) => l.label), ['cherry-picked']);
    assert.equal(updated.claim_ref.claim_id, claim.id, 'claim_ref is immutable');
    assert.ok(updated.updated >= a.updated);

    await assert.rejects(() => AssessmentModel.update(a.id, { stance: null, labels: [] }),
        /needs a stance or at least one label/);
    await assert.rejects(() => AssessmentModel.update('assess_0000000000000000', { stance: 1 }),
        /Assessment not found/);
});

test('assessment: backfillCoord records the coordinate without bumping updated', async () => {
    resetState();
    const claim = await seedClaim();
    const a = await AssessmentModel.create({ claim_ref: { claim_id: claim.id }, stance: 1 });
    const coord = buildClaimCoord(PUBKEY_A, claim.id);

    const filled = await AssessmentModel.backfillCoord(a.id, coord);
    assert.equal(filled.claim_ref.coord, coord);
    assert.equal(filled.claim_ref.author_pubkey, PUBKEY_A);
    assert.equal(filled.updated, a.updated, 'backfill is enrichment, not an edit');
    assert.equal(filled.claim_ref.claim_id, claim.id, 'canonical key unchanged');

    await assert.rejects(() => AssessmentModel.backfillCoord(a.id, buildClaimCoord(PUBKEY_A, 'claim_0000000000000000')),
        /does not match the assessed claim/);
    await assert.rejects(() => AssessmentModel.backfillCoord(a.id, 'garbage'),
        /Invalid coordinate/);
    assert.equal(await AssessmentModel.backfillCoord('assess_0000000000000000', coord), null);
});

test('assessment: markPublished records publishedAt without bumping updated', async () => {
    resetState();
    const claim = await seedClaim();
    const a = await AssessmentModel.create({ claim_ref: { claim_id: claim.id }, stance: 1 });
    const marked = await AssessmentModel.markPublished(a.id, 'e'.repeat(64));
    assert.ok(marked.publishedAt > 0);
    assert.equal(marked.publishedEventId, 'e'.repeat(64));
    assert.equal(marked.updated, a.updated, 'publish must not bump updated');
});

test('assessment: getByClaimRef returns null for unassessed claims; delete works', async () => {
    resetState();
    const claim = await seedClaim();
    assert.equal(await AssessmentModel.getByClaimRef(claim.id), null);

    const a = await AssessmentModel.create({ claim_ref: { claim_id: claim.id }, stance: 1 });
    assert.equal(await AssessmentModel.delete(a.id), true);
    assert.equal(await AssessmentModel.get(a.id), null);
    assert.equal(await AssessmentModel.delete(a.id), false);
});

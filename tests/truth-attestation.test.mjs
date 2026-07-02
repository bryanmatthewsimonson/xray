// Attestation graph tests — Phase 15.2
// (docs/TRUTH_ADJUDICATION_DESIGN.md §3.2). Same chrome.storage.local
// shim as truth-adjudication-model.test.mjs. The convergence numbers
// are MEASUREMENTS — every assertion here checks not just the count
// but that the derivation (groups, links, notes) travels with it.

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

const {
    attestProposition, attestationsForProposition,
    attestationConvergence, convergenceForProposition
} = await import('../src/shared/truth-attestation.js');
const { TruthAdjudicationModel } = await import('../src/shared/truth-adjudication-model.js');
const { ClaimModel } = await import('../src/shared/claim-model.js');
const { EvidenceLinker } = await import('../src/shared/evidence-linker.js');
const {
    EVIDENCE_TIERS, EVIDENCE_TIER_LABELS, isValidEvidenceTier, evidenceTierRank
} = await import('../src/shared/truth-taxonomy.js');

function resetState() { _stateStore.clear(); }

async function seedActionFact() {
    const claim = await ClaimModel.create({
        text: 'The senator voted against the bill on March 3.',
        source_url: 'https://example.com/article',
        about: ['entity_abc123']
    });
    const proposition = await TruthAdjudicationModel.create({
        claim_id: claim.id,
        proposition_class: 'event-fact',
        resolution_criteria: { criteria: 'The official roll-call record.' },
        subject_role: 'enacted'
    });
    return { claim, proposition };
}

async function seedAttestingClaim(text, url) {
    return await ClaimModel.create({ text, source_url: url });
}

// --- taxonomy pins -----------------------------------------------------

test('tiers: the §3.2 ladder is exhaustive and ranked', () => {
    assert.deepEqual(EVIDENCE_TIERS.slice(), ['tier-1', 'tier-2', 'tier-3']);
    for (const t of EVIDENCE_TIERS) {
        assert.equal(isValidEvidenceTier(t), true);
        assert.ok(EVIDENCE_TIER_LABELS[t], `${t} has a display label`);
    }
    assert.equal(isValidEvidenceTier('tier-0'), false);
    assert.equal(isValidEvidenceTier('primary'), false);
    assert.ok(evidenceTierRank('tier-1') < evidenceTierRank('tier-2'));
    assert.ok(evidenceTierRank('tier-2') < evidenceTierRank('tier-3'));
    assert.ok(evidenceTierRank('bogus') > evidenceTierRank('tier-3'), 'unknown ranks below everything');
});

// --- the linker carries attestation metadata ---------------------------

test('linker: attestation metadata rides supports links only, validated', async () => {
    resetState();
    const A = 'claim_aaaaaaaaaaaaaaaa';
    const B = 'claim_bbbbbbbbbbbbbbbb';

    const link = await EvidenceLinker.create({
        source_claim_id: A, target_claim_id: B, relationship: 'supports',
        attestation: { tier: 'tier-1', origin_key: '  Court-Record-19-cv-01234  ' }
    });
    assert.equal(link.attestation.tier, 'tier-1');
    assert.equal(link.attestation.origin_key, 'court-record-19-cv-01234',
        'origin key trimmed + lowercased so the wire-collapse matches');
    assert.equal(link.attestation.independence_note, '');

    await assert.rejects(() => EvidenceLinker.create({
        source_claim_id: A, target_claim_id: B, relationship: 'contradicts',
        attestation: { tier: 'tier-1', origin_key: 'x' }
    }), /only valid on a supports link/);
    await assert.rejects(() => EvidenceLinker.create({
        source_claim_id: A, target_claim_id: 'claim_cccccccccccccccc', relationship: 'supports',
        attestation: { tier: 'gold', origin_key: 'x' }
    }), /Invalid attestation tier/);
    await assert.rejects(() => EvidenceLinker.create({
        source_claim_id: A, target_claim_id: 'claim_dddddddddddddddd', relationship: 'supports',
        attestation: { tier: 'tier-2', origin_key: '   ' }
    }), /origin_key is required/);

    // A plain supports link (no attestation) is unchanged behavior.
    const plain = await EvidenceLinker.create({
        source_claim_id: A, target_claim_id: 'claim_eeeeeeeeeeeeeeee', relationship: 'supports'
    });
    assert.equal(plain.attestation, null);

    // update() can patch it — on the right relationship only.
    const patched = await EvidenceLinker.update(link.id, {
        attestation: { tier: 'tier-2', origin_key: 'ap-wire', independence_note: 'distinct filer' }
    });
    assert.equal(patched.attestation.tier, 'tier-2');
    assert.equal(patched.attestation.independence_note, 'distinct filer');

    const contradicts = await EvidenceLinker.create({
        source_claim_id: A, target_claim_id: 'claim_9999999999999999', relationship: 'contradicts'
    });
    await assert.rejects(
        () => EvidenceLinker.update(contradicts.id, {
            attestation: { tier: 'tier-1', origin_key: 'x' }
        }),
        /only valid on a supports link/);
});

// --- authoring surface --------------------------------------------------

test('attest: creates the supports edge to the proposition\'s claim', async () => {
    resetState();
    const { claim, proposition } = await seedActionFact();
    const artifact = await seedAttestingClaim(
        'Roll-call vote 71: Nay recorded for the senator.',
        'https://congress.example.gov/roll-call/71');

    const link = await attestProposition(proposition.id, {
        claim_ref: artifact.id,
        tier: 'tier-1',
        origin_key: 'congress-roll-call-71'
    });
    assert.equal(link.relationship, 'supports');
    assert.equal(link.source_claim_id, artifact.id);
    assert.equal(link.target_claim_id, claim.id);
    assert.equal(link.attestation.tier, 'tier-1');

    const found = await attestationsForProposition(proposition.id);
    assert.equal(found.length, 1);
    assert.equal(found[0].id, link.id);

    await assert.rejects(() => attestProposition('prop_nope', {
        claim_ref: artifact.id, tier: 'tier-1', origin_key: 'x'
    }), /Proposition not found/);
    await assert.rejects(() => attestationsForProposition('prop_nope'), /Proposition not found/);
});

test('attest: idempotent on the edge; backfills missing metadata, never overwrites', async () => {
    resetState();
    const { claim, proposition } = await seedActionFact();
    const artifact = await seedAttestingClaim('AP: senator votes nay.', 'https://ap.example.com/1');

    // A pre-existing PLAIN supports edge gets its metadata backfilled...
    const plain = await EvidenceLinker.create({
        source_claim_id: artifact.id, target_claim_id: claim.id, relationship: 'supports'
    });
    assert.equal(plain.attestation, null);
    const stamped = await attestProposition(proposition.id, {
        claim_ref: artifact.id, tier: 'tier-2', origin_key: 'ap-wire'
    });
    assert.equal(stamped.id, plain.id, 'same edge');
    assert.equal(stamped.attestation.origin_key, 'ap-wire');

    // ...and re-attesting does NOT silently overwrite what's there.
    const again = await attestProposition(proposition.id, {
        claim_ref: artifact.id, tier: 'tier-3', origin_key: 'somewhere-else'
    });
    assert.equal(again.id, plain.id);
    assert.equal(again.attestation.origin_key, 'ap-wire', 're-assessment is an explicit update()');
    assert.equal((await attestationsForProposition(proposition.id)).length, 1);
});

test('attest: only supports-edges TO the claim count as attestations', async () => {
    resetState();
    const { claim, proposition } = await seedActionFact();
    const artifact = await seedAttestingClaim('AP: senator votes nay.', 'https://ap.example.com/1');
    await attestProposition(proposition.id, {
        claim_ref: artifact.id, tier: 'tier-2', origin_key: 'ap-wire'
    });
    // The proposition's claim SUPPORTING something else is not an attestation of it.
    await EvidenceLinker.create({
        source_claim_id: claim.id, target_claim_id: 'claim_ffffffffffffffff',
        relationship: 'supports',
        attestation: { tier: 'tier-3', origin_key: 'other' }
    });
    // Neither is a contradicts edge, nor a plain supports edge.
    await EvidenceLinker.create({
        source_claim_id: 'claim_1111111111111111', target_claim_id: claim.id,
        relationship: 'contradicts'
    });
    await EvidenceLinker.create({
        source_claim_id: 'claim_2222222222222222', target_claim_id: claim.id,
        relationship: 'supports'
    });
    const found = await attestationsForProposition(proposition.id);
    assert.equal(found.length, 1);
    assert.equal(found[0].attestation.origin_key, 'ap-wire');
});

// --- the convergence measurement ----------------------------------------

function fakeLink(id, created, tier, originKey, note = '') {
    return {
        id, created, relationship: 'supports',
        attestation: { tier, origin_key: originKey, independence_note: note }
    };
}

test('convergence: two outlets on one wire are ONE source', () => {
    const result = attestationConvergence([
        fakeLink('link_a', 100, 'tier-2', 'ap-wire'),
        fakeLink('link_b', 200, 'tier-2', 'ap-wire'),   // second outlet, same wire
        fakeLink('link_c', 300, 'tier-2', 'reuters', 'Own byline, dateline on scene; not an AP pickup.')
    ]);
    assert.equal(result.total_attestations, 3);
    assert.equal(result.origin_count, 2, 'ap-wire collapses');
    assert.equal(result.independent_count, 2, 'baseline + one demonstrated');
    assert.deepEqual(result.undemonstrated, []);
    const ap = result.origin_groups.find((g) => g.origin_key === 'ap-wire');
    assert.deepEqual(ap.link_ids, ['link_a', 'link_b'], 'derivation: the collapsed links are listed');
    assert.equal(ap.baseline, true, 'earliest group is the baseline');
});

test('convergence: independence is demonstrated, not assumed', () => {
    const result = attestationConvergence([
        fakeLink('link_a', 100, 'tier-1', 'court-record'),
        fakeLink('link_b', 200, 'tier-2', 'reuters'),                       // no note
        fakeLink('link_c', 300, 'tier-2', 'local-paper', 'Local courtroom reporter, first-hand.')
    ]);
    assert.equal(result.origin_count, 3);
    assert.equal(result.independent_count, 2,
        'baseline + demonstrated only — the unnoted origin is not counted');
    assert.deepEqual(result.undemonstrated, ['reuters'], 'visible, just not counted');
    const reuters = result.origin_groups.find((g) => g.origin_key === 'reuters');
    assert.equal(reuters.demonstrated, false);
    assert.equal(reuters.baseline, false);
});

test('convergence: by_tier counts demonstrated groups at their BEST tier', () => {
    const result = attestationConvergence([
        fakeLink('link_a', 100, 'tier-3', 'court-record'),
        fakeLink('link_b', 150, 'tier-1', 'court-record'),   // same origin, better artifact
        fakeLink('link_c', 200, 'tier-2', 'reuters', 'Independent verification note.')
    ]);
    const court = result.origin_groups.find((g) => g.origin_key === 'court-record');
    assert.equal(court.tier, 'tier-1', 'a group reports its strongest provenance');
    assert.deepEqual(result.by_tier, { 'tier-1': 1, 'tier-2': 1 });
});

test('convergence: empty and single-source cases stay honest', () => {
    const empty = attestationConvergence([]);
    assert.equal(empty.total_attestations, 0);
    assert.equal(empty.origin_count, 0);
    assert.equal(empty.independent_count, 0);
    assert.deepEqual(empty.origin_groups, []);

    const single = attestationConvergence([fakeLink('link_a', 100, 'tier-3', 'anon-tip')]);
    assert.equal(single.independent_count, 1,
        'a lone source needs no demonstration — and 1 is all it measures');
    assert.deepEqual(single.by_tier, { 'tier-3': 1 });
});

test('convergence: end-to-end over stored records', async () => {
    resetState();
    const { proposition } = await seedActionFact();
    const rollCall = await seedAttestingClaim('Roll-call 71: Nay.', 'https://congress.example.gov/71');
    const ap1 = await seedAttestingClaim('AP: senator votes nay.', 'https://ap.example.com/1');
    const ap2 = await seedAttestingClaim('Tribune (AP): senator votes nay.', 'https://tribune.example.com/2');

    await attestProposition(proposition.id, {
        claim_ref: rollCall.id, tier: 'tier-1', origin_key: 'congress-roll-call-71'
    });
    await attestProposition(proposition.id, {
        claim_ref: ap1.id, tier: 'tier-2', origin_key: 'ap-wire',
        independence_note: 'Wire reporting, not derived from the roll-call scrape.'
    });
    await attestProposition(proposition.id, {
        claim_ref: ap2.id, tier: 'tier-2', origin_key: 'ap-wire'
    });

    const result = await convergenceForProposition(proposition.id);
    assert.equal(result.total_attestations, 3);
    assert.equal(result.origin_count, 2);
    assert.equal(result.independent_count, 2);
    assert.equal(result.origin_groups.length, 2);
    // Derivation is fully enumerable back to the stored links.
    const allIds = result.origin_groups.flatMap((g) => g.link_ids);
    assert.equal(allIds.length, 3);
});

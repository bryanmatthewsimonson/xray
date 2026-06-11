// Assessment publish-selection tests — Phase 11.7 (the flag-gated
// publish slice; docs/ASSESSMENTS_DESIGN.md).
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

const { claimWireInfo, selectAssessmentsToPublish, selectLinksToPublish, selectMirrors } =
    await import('../src/shared/assessment-publish.js');
const { ClaimModel } = await import('../src/shared/claim-model.js');
const { AssessmentModel } = await import('../src/shared/assessment-model.js');
const { EvidenceLinker } = await import('../src/shared/evidence-linker.js');
const { makeClaimRefCanonicalizer, buildClaimCoord } = await import('../src/shared/claim-ref.js');

function resetState() { _stateStore.clear(); }

const PUBKEY_A = 'a'.repeat(64);
const PUBKEY_B = 'b'.repeat(64);

async function ctx() {
    return {
        claims: await ClaimModel.getAll(),
        assessments: await AssessmentModel.getAll(),
        links: await EvidenceLinker.getAll(),
        canon: await makeClaimRefCanonicalizer()
    };
}

// ---------------------------------------------------------------------

test('publish-select: claimWireInfo gates on the recorded publishing pubkey', async () => {
    resetState();
    const claim = await ClaimModel.create({ text: 'Own claim.', source_url: 'https://example.com/a' });
    let { claims } = await ctx();
    assert.equal(claimWireInfo(claims, claim.id), null, 'unpublished own claim is not wire-ready');

    // Published pre-11.1 style (no pubkey recorded) — still not ready.
    await ClaimModel.markPublished(claim.id, 'e'.repeat(64));
    ({ claims } = await ctx());
    assert.equal(claimWireInfo(claims, claim.id), null, 'publishedAt alone is insufficient');

    await ClaimModel.markPublished(claim.id, 'f'.repeat(64), PUBKEY_A);
    ({ claims } = await ctx());
    const info = claimWireInfo(claims, claim.id);
    assert.equal(info.coord, buildClaimCoord(PUBKEY_A, claim.id));
    assert.equal(info.url, 'https://example.com/a');
    assert.equal(info.eventId, 'f'.repeat(64));

    // Foreign coordinates are always wire-ready; fallback carries url.
    const foreign = claimWireInfo(claims, buildClaimCoord(PUBKEY_B, 'their-d'), { url: 'https://example.com/b' });
    assert.equal(foreign.coord, buildClaimCoord(PUBKEY_B, 'their-d'));
    assert.equal(foreign.url, 'https://example.com/b');
});

test('publish-select: assessments — readiness, staleness, and coord backfill flag', async () => {
    resetState();
    const unpub = await ClaimModel.create({ text: 'Unpublished.', source_url: 'https://example.com/u' });
    const pub   = await ClaimModel.create({ text: 'Published.', source_url: 'https://example.com/p' });
    await ClaimModel.markPublished(pub.id, 'e'.repeat(64), PUBKEY_A);

    const aUnpub = await AssessmentModel.create({ claim_ref: { claim_id: unpub.id }, stance: 1 });
    const aPub   = await AssessmentModel.create({ claim_ref: { claim_id: pub.id }, stance: -1, labels: ['misleading'] });
    const aForeign = await AssessmentModel.create({
        claim_ref: { coord: buildClaimCoord(PUBKEY_B, 'their-d'), url: 'https://example.com/f', text: 'Foreign.' },
        labels: ['euphemism']
    });

    let sel = selectAssessmentsToPublish(await ctx());
    const ids = sel.map((s) => s.assessment.id);
    assert.ok(!ids.includes(aUnpub.id), 'own-unpublished-claim assessment waits');
    assert.ok(ids.includes(aPub.id));
    assert.ok(ids.includes(aForeign.id));
    assert.equal(sel.length, 2);

    const pubSel = sel.find((s) => s.assessment.id === aPub.id);
    assert.equal(pubSel.coord, buildClaimCoord(PUBKEY_A, pub.id));
    assert.equal(pubSel.needsCoordBackfill, false,
        'assessed AFTER publish → the model auto-filled the coordinate at create');
    assert.deepEqual(pubSel.aboutIds, [], 'no about entities on this fixture');

    // The backfill flag DOES fire when the assessment predates the
    // claim's publish (the coordinate wasn't knowable at create time).
    const early = await ClaimModel.create({ text: 'Assessed first.', source_url: 'https://example.com/e' });
    const aEarly = await AssessmentModel.create({ claim_ref: { claim_id: early.id }, stance: 2 });
    await ClaimModel.markPublished(early.id, '9'.repeat(64), PUBKEY_A);
    const selEarly = selectAssessmentsToPublish(await ctx())
        .find((s) => s.assessment.id === aEarly.id);
    assert.equal(selEarly.needsCoordBackfill, true, 'record predates the coordinate');
    assert.equal(selEarly.coord, buildClaimCoord(PUBKEY_A, early.id));

    // Once published and unchanged, an assessment drops out…
    await AssessmentModel.markPublished(aPub.id, '1'.repeat(64));
    sel = selectAssessmentsToPublish(await ctx());
    assert.ok(!sel.map((s) => s.assessment.id).includes(aPub.id), 'published + unchanged → skipped');

    // …and re-enters after an edit (updated > publishedAt).
    await new Promise((r) => setTimeout(r, 1100));
    await AssessmentModel.update(aPub.id, { stance: -2 });
    sel = selectAssessmentsToPublish(await ctx());
    assert.ok(sel.map((s) => s.assessment.id).includes(aPub.id), 'edited → re-emits');
});

test('publish-select: links need BOTH endpoints wire-ready; legacy contextualizes never publishes', async () => {
    resetState();
    const pubClaim = await ClaimModel.create({ text: 'Ours, published.', source_url: 'https://example.com/p' });
    await ClaimModel.markPublished(pubClaim.id, 'e'.repeat(64), PUBKEY_A);
    const unpubClaim = await ClaimModel.create({ text: 'Ours, local.', source_url: 'https://example.com/u' });
    const foreignCoord = buildClaimCoord(PUBKEY_B, 'their-d');

    const ready = await EvidenceLinker.create({
        source_claim_id: pubClaim.id, target_claim_id: foreignCoord,
        relationship: 'contradicts',
        target_snapshot: { url: 'https://example.com/f', text: 'Foreign.' }
    });
    const half = await EvidenceLinker.create({
        source_claim_id: unpubClaim.id, target_claim_id: foreignCoord,
        relationship: 'supports',
        target_snapshot: { url: 'https://example.com/f', text: 'Foreign.' }
    });
    // Legacy record written straight into storage.
    _stateStore.set('evidence_links', JSON.stringify({
        ...JSON.parse(_stateStore.get('evidence_links')),
        link_0123456789abcdef: {
            id: 'link_0123456789abcdef',
            source_claim_id: pubClaim.id, target_claim_id: foreignCoord,
            relationship: 'contextualizes', note: '', created: 1, updated: 1,
            publishedAt: null, publishedEventId: null
        }
    }));

    const sel = selectLinksToPublish(await ctx());
    assert.equal(sel.length, 1, 'half-ready and legacy links are skipped');
    assert.equal(sel[0].link.id, ready.id);
    // contradicts is symmetric — endpoints were stored sorted, so the
    // foreign coordinate ('30040:bbbb…' < 'claim_…') is the source.
    assert.deepEqual(
        [sel[0].source.coord, sel[0].target.coord].sort(),
        [buildClaimCoord(PUBKEY_A, pubClaim.id), foreignCoord].sort()
    );
    const foreignSide = sel[0].source.coord === foreignCoord ? sel[0].source : sel[0].target;
    assert.equal(foreignSide.url, 'https://example.com/f', 'snapshot url rides along');

    await EvidenceLinker.markPublished(ready.id, '2'.repeat(64));
    assert.equal(selectLinksToPublish(await ctx()).length, 0, 'published + unchanged → skipped');
});

test('publish-select: drift-stored refs still resolve (coordinate stored, pubkey recorded later)', async () => {
    resetState();
    const claim = await ClaimModel.create({ text: 'Drifter.', source_url: 'https://example.com/d' });
    await ClaimModel.markPublished(claim.id, 'e'.repeat(64));   // no pubkey yet
    const coord = buildClaimCoord(PUBKEY_A, claim.id);
    const a = await AssessmentModel.create({
        claim_ref: { coord, url: 'https://example.com/d', text: claim.text }, stance: 0
    });
    assert.equal(a.claim_ref.claim_id, null, 'stored coordinate-keyed');

    // Not selectable yet: the coordinate canonicalizes to itself, and
    // claimWireInfo can't verify a foreign coord? It CAN — foreign
    // coords are always wire-ready. This is the known pre-backfill
    // ambiguity: until the pubkey is recorded, our own coordinate is
    // indistinguishable from a foreign one and publishes as foreign.
    let sel = selectAssessmentsToPublish(await ctx());
    assert.equal(sel.length, 1);
    assert.equal(sel[0].coord, coord);

    // After the pubkey lands, the same record selects via the LOCAL
    // claim (canonicalization collapses), picking up registry data.
    await ClaimModel.markPublished(claim.id, 'f'.repeat(64), PUBKEY_A);
    sel = selectAssessmentsToPublish(await ctx());
    assert.equal(sel.length, 1);
    assert.equal(sel[0].coord, coord, 'same coordinate either way');
    assert.equal(sel[0].eventId, 'f'.repeat(64), 'registry event id now available');
});

test('publish-select: mirrors — labeled, first-publish only', async () => {
    resetState();
    const claim = await ClaimModel.create({ text: 'Mirrored.', source_url: 'https://example.com/m' });
    await ClaimModel.markPublished(claim.id, 'e'.repeat(64), PUBKEY_A);
    const labeled   = await AssessmentModel.create({ claim_ref: { claim_id: claim.id }, labels: ['misleading'] });

    const claim2 = await ClaimModel.create({ text: 'Stance only.', source_url: 'https://example.com/m2' });
    await ClaimModel.markPublished(claim2.id, 'e'.repeat(64), PUBKEY_A);
    await AssessmentModel.create({ claim_ref: { claim_id: claim2.id }, stance: 2 });

    let sel = selectAssessmentsToPublish(await ctx());
    assert.equal(sel.length, 2);
    let mirrors = selectMirrors(sel);
    assert.equal(mirrors.length, 1, 'stance-only assessments do not mirror');
    assert.equal(mirrors[0].assessment.id, labeled.id);

    // A REpublish (edit after first publish) must not re-mirror. The
    // stance-only assessment is still unpublished, so it stays in the
    // selection alongside the edited one.
    await AssessmentModel.markPublished(labeled.id, '1'.repeat(64));
    await new Promise((r) => setTimeout(r, 1100));
    await AssessmentModel.update(labeled.id, { labels: ['misleading', 'outdated'] });
    sel = selectAssessmentsToPublish(await ctx());
    assert.ok(sel.map((s) => s.assessment.id).includes(labeled.id), 'edited assessment re-selects');
    mirrors = selectMirrors(sel);
    assert.equal(mirrors.length, 0, 'mirrors are first-publish only (1985 is non-replaceable)');
});

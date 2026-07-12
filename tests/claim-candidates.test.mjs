// Claim-candidates pool tests — the shared collector behind every
// "cite a captured claim/quote" surface (evidence-link modal, the
// adjudicate/integrity evidence pickers; amendment §5.5a). Pins pool
// merging, canonical-ref dedupe, exclusion, and speaker resolution.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// --- chrome.storage.local shim (before the module graph loads) --------
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

const { collectClaimCandidates, candidateHay, matchesCandidateQuery } =
    await import('../src/shared/claim-candidates.js');
const { ClaimModel } = await import('../src/shared/claim-model.js');
const { AssessmentModel } = await import('../src/shared/assessment-model.js');
const { EntityModel } = await import('../src/shared/entity-model.js');
const { buildClaimCoord } = await import('../src/shared/claim-ref.js');

function resetState() { _stateStore.clear(); }

const PUBKEY_A = 'a'.repeat(64);
const FOREIGN_COORD = `30040:${'f'.repeat(64)}:their-claim-1`;

// ---------------------------------------------------------------------

test('claim-candidates: pool merges local claims, assessed-foreign snapshots, and extras', async () => {
    resetState();
    const local = await ClaimModel.create({
        text: 'Masks reduce transmission.',
        quote: 'masks are effective at reducing transmission',
        source_url: 'https://who.example/brief'
    });
    await AssessmentModel.create({
        claim_ref: { coord: FOREIGN_COORD, url: 'https://them.example/post', text: 'A foreign counter-claim.' },
        stance:    -1
    });
    // An assessment ON a local claim must NOT mint a second candidate.
    await AssessmentModel.create({ claim_ref: { claim_id: local.id }, stance: 1 });

    const pool = await collectClaimCandidates({
        extra: [{ ref: `30040:${'e'.repeat(64)}:net-1`, text: 'Seen on the network.', url: 'https://net.example/x', origin: 'network' }]
    });

    assert.equal(pool.length, 3, 'one local + one assessed-foreign + one extra');
    const byOrigin = Object.fromEntries(pool.map((c) => [c.origin, c]));
    assert.equal(byOrigin.local.ref, local.id);
    assert.equal(byOrigin.local.quote, 'masks are effective at reducing transmission');
    assert.equal(byOrigin.assessed.ref, FOREIGN_COORD);
    assert.equal(byOrigin.assessed.text, 'A foreign counter-claim.');
    assert.equal(byOrigin.assessed.url, 'https://them.example/post');
    assert.equal(byOrigin.network.text, 'Seen on the network.');
});

test('claim-candidates: speaker resolves entity ids to names; free text passes through', async () => {
    resetState();
    const who = await EntityModel.create({ name: 'W.H.O.', type: 'organization' });
    const spoken = await ClaimModel.create({
        text: 'Masks work.', quote: 'masks work',
        source: who.id, source_url: 'https://who.example/brief'
    });
    const freeText = await ClaimModel.create({
        text: 'Vaccines too.', source: 'Dr. Example',
        source_url: 'https://who.example/brief2'
    });
    const silent = await ClaimModel.create({
        text: 'Unattributed.', source_url: 'https://who.example/brief3'
    });

    const pool = await collectClaimCandidates({});
    const byRef = Object.fromEntries(pool.map((c) => [c.ref, c]));
    assert.equal(byRef[spoken.id].speaker, 'W.H.O.', 'entity id resolves to the entity name');
    assert.equal(byRef[freeText.id].speaker, 'Dr. Example', 'free-text source passes through');
    assert.equal(byRef[silent.id].speaker, '', 'no source → empty speaker');
});

test('claim-candidates: dedupes by canonical ref — a published claim cited by coordinate collapses onto the local record', async () => {
    resetState();
    const claim = await ClaimModel.create({ text: 'Published claim.', source_url: 'https://ex.example/a' });
    await ClaimModel.markPublished(claim.id, 'e'.repeat(64), PUBKEY_A);
    const coord = buildClaimCoord(PUBKEY_A, claim.id);

    const pool = await collectClaimCandidates({
        extra: [{ ref: coord, text: 'Published claim (network copy).', origin: 'network' }]
    });
    assert.equal(pool.length, 1, 'coord representation collapses onto the local claim');
    assert.equal(pool[0].origin, 'local', 'the local record wins the dedupe');
});

test('candidateHay covers text, quote, speaker, and url — lowercased', () => {
    const hay = candidateHay({
        text: 'Masks Reduce Transmission.', quote: 'MASKS ARE EFFECTIVE',
        speaker: 'W.H.O.', url: 'https://WHO.example/Brief'
    });
    for (const needle of ['masks reduce transmission.', 'masks are effective', 'w.h.o.', 'https://who.example/brief']) {
        assert.ok(hay.includes(needle), `hay carries "${needle}"`);
    }
    assert.equal(candidateHay(null), '   ', 'null-safe');
});

test('matchesCandidateQuery: tokens match in any order across fields; empty query matches all', () => {
    const hay = candidateHay({ text: 'Masks reduce transmission.', quote: 'masks are effective', speaker: 'W.H.O.', url: 'https://who.example/brief' });
    assert.ok(matchesCandidateQuery(hay, 'masks'), 'single token');
    assert.ok(matchesCandidateQuery(hay, 'W.H.O. masks'), 'tokens spanning speaker + text, out of field order');
    assert.ok(matchesCandidateQuery(hay, 'effective transmission'), 'tokens spanning quote + text');
    assert.ok(matchesCandidateQuery(hay, '  MASKS   w.h.o. '), 'case-insensitive, whitespace-tolerant');
    assert.ok(matchesCandidateQuery(hay, ''), 'empty query matches everything');
    assert.ok(matchesCandidateQuery(hay, '   '), 'whitespace-only query matches everything');
    assert.equal(matchesCandidateQuery(hay, 'masks gloves'), false, 'one unmatched token fails the row');
    assert.equal(matchesCandidateQuery(undefined, 'x'), false, 'null-safe hay');
});

test('claim-candidates: exclude drops the ref under any representation', async () => {
    resetState();
    const adjudicated = await ClaimModel.create({ text: 'Being adjudicated.', source_url: 'https://ex.example/a' });
    await ClaimModel.markPublished(adjudicated.id, 'e'.repeat(64), PUBKEY_A);
    const other = await ClaimModel.create({ text: 'Citable.', source_url: 'https://ex.example/b' });

    // Exclude by COORDINATE — the local-id candidate must still drop.
    const pool = await collectClaimCandidates({ exclude: [buildClaimCoord(PUBKEY_A, adjudicated.id)] });
    assert.deepEqual(pool.map((c) => c.ref), [other.id],
        'the adjudicated claim is gone; the citable one remains');
});

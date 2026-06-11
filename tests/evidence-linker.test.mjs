// Evidence linker tests — Phase 5 C4 (issue #16); cross-source
// repurpose in Phase 11.1 (docs/ASSESSMENTS_DESIGN.md).

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
    EvidenceLinker, EVIDENCE_RELATIONSHIPS,
    EVIDENCE_RELATIONSHIP_LABELS, EVIDENCE_RELATIONSHIP_ICONS,
    generateEvidenceLinkId, parseRelationshipEvent
} = await import('../src/shared/evidence-linker.js');
const { buildClaimRelationshipEvent } = await import('../src/shared/metadata/builders.js');
const { ClaimModel } = await import('../src/shared/claim-model.js');
const { buildClaimCoord } = await import('../src/shared/claim-ref.js');

function resetState() { _stateStore.clear(); }

// Valid-looking claim IDs for validation. Real ones are sha256-derived,
// but the validator only enforces the `claim_<16 hex>` shape.
const A = 'claim_aaaaaaaaaaaaaaaa';
const B = 'claim_bbbbbbbbbbbbbbbb';
const C = 'claim_cccccccccccccccc';

const PUBKEY_A = 'a'.repeat(64);
const PUBKEY_B = 'b'.repeat(64);

// ---------------------------------------------------------------------

test('evidence: deterministic id derivation — directional vs symmetric', async () => {
    const idAB_supports = await generateEvidenceLinkId(A, B, 'supports');
    const idBA_supports = await generateEvidenceLinkId(B, A, 'supports');
    const idAB_contradicts = await generateEvidenceLinkId(A, B, 'contradicts');
    const idBA_contradicts = await generateEvidenceLinkId(B, A, 'contradicts');
    const idAB_duplicates = await generateEvidenceLinkId(A, B, 'duplicates');
    const idBA_duplicates = await generateEvidenceLinkId(B, A, 'duplicates');

    assert.notEqual(idAB_supports, idBA_supports,        'supports is directional');
    assert.equal(idAB_contradicts, idBA_contradicts,     'contradicts is symmetric — A↔B === B↔A');
    assert.equal(idAB_duplicates, idBA_duplicates,       'duplicates is symmetric');
    assert.notEqual(idAB_supports, idAB_contradicts,     'relationship included in hash');
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
    assert.equal(link.suggested_by, 'user');
    assert.equal(link.source_snapshot, null, 'fake ids have no registry snapshot');
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

test('evidence: symmetric relationships collapse both creation directions', async () => {
    resetState();
    const ab = await EvidenceLinker.create({
        source_claim_id: A, target_claim_id: B, relationship: 'contradicts', note: 'first'
    });
    const ba = await EvidenceLinker.create({
        source_claim_id: B, target_claim_id: A, relationship: 'contradicts', note: 'second — ignored'
    });
    assert.equal(ab.id, ba.id, 'one logical contradiction, one record');
    assert.equal(ba.note, 'first');
    assert.equal(ab.source_claim_id, A, 'endpoints stored in sorted order');
    assert.equal(ab.target_claim_id, B);

    // Directional relationships still produce two distinct records.
    const sup = await EvidenceLinker.create({ source_claim_id: A, target_claim_id: B, relationship: 'supports' });
    const pus = await EvidenceLinker.create({ source_claim_id: B, target_claim_id: A, relationship: 'supports' });
    assert.notEqual(sup.id, pus.id);
});

test('evidence: rejects self-link, invalid/legacy relationship, malformed refs', async () => {
    resetState();
    await assert.rejects(() => EvidenceLinker.create({
        source_claim_id: A, target_claim_id: A, relationship: 'supports'
    }), /Cannot link a claim to itself/);
    await assert.rejects(() => EvidenceLinker.create({
        source_claim_id: A, target_claim_id: B, relationship: 'loves'
    }), /Invalid relationship/);
    await assert.rejects(() => EvidenceLinker.create({
        source_claim_id: A, target_claim_id: B, relationship: 'contextualizes'
    }), /Invalid relationship/, 'legacy contextualizes is read-only');
    await assert.rejects(() => EvidenceLinker.create({
        source_claim_id: 'not-a-claim', target_claim_id: B, relationship: 'supports'
    }), /must be a claim id or a 30040 coordinate/);
    await assert.rejects(() => EvidenceLinker.create({
        source_claim_id: '', target_claim_id: B, relationship: 'supports'
    }), /source_claim_id is required/);
});

test('evidence: cross-source links — coordinate endpoints and canonicalization', async () => {
    resetState();
    // A real local claim, published — so its coordinate collapses to
    // the local id (claim-ref canonical rule).
    const local = await ClaimModel.create({
        text: 'Police dislocated my shoulder.', source_url: 'https://example.com/video-3'
    });
    await ClaimModel.markPublished(local.id, 'e'.repeat(64), PUBKEY_A);
    const ourCoord = buildClaimCoord(PUBKEY_A, local.id);

    // A foreign claim, referenced by coordinate with a snapshot.
    const foreignCoord = buildClaimCoord(PUBKEY_B, 'their-claim-d');
    const link = await EvidenceLinker.create({
        source_claim_id: ourCoord,
        target_claim_id: foreignCoord,
        relationship: 'contradicts',
        target_snapshot: { url: 'https://example.com/charges?utm_source=x', text: 'Charges: trespassing.' }
    });

    // Symmetric sort is deterministic: '30040:bbbb…' < 'claim_…', so
    // the foreign coordinate lands in the source slot — and the
    // snapshots must travel with their endpoints through the swap.
    assert.equal(link.source_claim_id, foreignCoord, 'foreign coordinate stored as-is, sorted first');
    assert.equal(link.target_claim_id, local.id, 'our coordinate collapsed to the local id');
    assert.deepEqual(link.source_snapshot, {
        url: 'https://example.com/charges',          // normalized
        url_raw: 'https://example.com/charges?utm_source=x',  // verbatim, for the wire r
        text: 'Charges: trespassing.',
        author_pubkey: PUBKEY_B                       // backfilled from the coord
    });
    assert.deepEqual(link.target_snapshot, {
        url: 'https://example.com/video-3',           // auto-filled from the registry
        url_raw: 'https://example.com/video-3',
        text: 'Police dislocated my shoulder.',
        author_pubkey: PUBKEY_A
    });

    // Lookup by any representation of either endpoint finds it.
    const byId      = await EvidenceLinker.getForClaim(local.id);
    const byCoord   = await EvidenceLinker.getForClaim(ourCoord);
    const byForeign = await EvidenceLinker.getForClaim(foreignCoord);
    assert.deepEqual([byId.length, byCoord.length, byForeign.length], [1, 1, 1]);
    assert.equal(byId[0].id, link.id);
    assert.equal(byCoord[0].id, link.id);
    assert.equal(byForeign[0].id, link.id);

    // Malformed refs now throw (pre-11.1 returned [] for any string).
    await assert.rejects(() => EvidenceLinker.getForClaim('not-a-ref'),
        /must be a claim id or a 30040 coordinate/);

    // deleteForClaim works by coordinate too.
    assert.equal(await EvidenceLinker.deleteForClaim(foreignCoord), 1);
    assert.deepEqual(await EvidenceLinker.getForClaim(local.id), []);
});

test('evidence: publish-boundary idempotency — link pre-publish, re-create by coordinate', async () => {
    resetState();
    const local = await ClaimModel.create({
        text: 'We cooperated for 20 years.', source_url: 'https://example.com/video-4'
    });
    const foreignCoord = buildClaimCoord(PUBKEY_B, 'their-claim-d');

    // Link while OUR claim is unpublished (ref = local id)…
    const before = await EvidenceLinker.create({
        source_claim_id: local.id, target_claim_id: foreignCoord,
        relationship: 'contradicts', note: 'original'
    });

    // …then publish and re-create the same logical link by coordinate.
    await ClaimModel.markPublished(local.id, 'e'.repeat(64), PUBKEY_A);
    const after = await EvidenceLinker.create({
        source_claim_id: buildClaimCoord(PUBKEY_A, local.id), target_claim_id: foreignCoord,
        relationship: 'contradicts', note: 'should be ignored'
    });
    assert.equal(after.id, before.id, 'same record across the publish boundary');
    assert.equal(after.note, 'original');
});

test('evidence: drift — coordinate-stored endpoints stay reachable once the claim gains publishedPubkey', async () => {
    resetState();
    const local = await ClaimModel.create({
        text: 'Drifting claim.', source_url: 'https://example.com/video-5'
    });
    // Published pre-11.1 style: publishedAt recorded, but no pubkey —
    // so the claim's own coordinate does NOT collapse yet.
    await ClaimModel.markPublished(local.id, 'e'.repeat(64));
    const ourCoord = buildClaimCoord(PUBKEY_A, local.id);
    const foreignCoord = buildClaimCoord(PUBKEY_B, 'their-claim-d');

    const link = await EvidenceLinker.create({
        source_claim_id: ourCoord, target_claim_id: foreignCoord,
        relationship: 'contradicts', note: 'keyed by coordinate',
        source_snapshot: { url: 'https://example.com/video-5', text: 'Drifting claim.' }
    });
    assert.ok([link.source_claim_id, link.target_claim_id].includes(ourCoord),
        'endpoint stored as a coordinate while the pubkey is unknown');

    // The pubkey lands later (a republish) — the stored coordinate is
    // now collapsible, and matching must canonicalize the STORED side
    // too or the record is orphaned by both representations.
    await ClaimModel.markPublished(local.id, 'f'.repeat(64), PUBKEY_A);
    const byId    = await EvidenceLinker.getForClaim(local.id);
    const byCoord = await EvidenceLinker.getForClaim(ourCoord);
    assert.equal(byId.length, 1, 'reachable by local id after drift');
    assert.equal(byCoord.length, 1, 'reachable by coordinate after drift');

    // …and idempotent create must find the drifted record, not mint a
    // duplicate for the same logical pair.
    const again = await EvidenceLinker.create({
        source_claim_id: local.id, target_claim_id: foreignCoord,
        relationship: 'contradicts', note: 'should be ignored'
    });
    assert.equal(again.id, link.id, 'one logical link, one record — even after drift');
    assert.equal(Object.keys(await EvidenceLinker.getAll()).length, 1);

    // deleteForClaim must not orphan it either.
    assert.equal(await EvidenceLinker.deleteForClaim(local.id), 1);
});

test('evidence: legacy contextualizes records normalize on read', async () => {
    resetState();
    // A pre-11.1 record written straight into storage: no suggested_by,
    // no snapshots, legacy relationship value.
    _stateStore.set('evidence_links', {
        link_0123456789abcdef: {
            id: 'link_0123456789abcdef',
            source_claim_id: A,
            target_claim_id: B,
            relationship: 'contextualizes',
            note: 'old link',
            created: 100, updated: 100,
            publishedAt: null, publishedEventId: null
        }
    });
    const link = await EvidenceLinker.get('link_0123456789abcdef');
    assert.equal(link.relationship, 'contextualizes', 'legacy records stay readable');
    assert.equal(link.suggested_by, 'user', 'backfilled');
    assert.equal(link.source_snapshot, null);
    const forA = await EvidenceLinker.getForClaim(A);
    assert.equal(forA.length, 1);

    // getAll normalizes too.
    const all = await EvidenceLinker.getAll();
    assert.equal(all.link_0123456789abcdef.suggested_by, 'user');

    // update is the one path that PERSISTS the normalized shape while
    // patching the note and preserving the legacy relationship.
    const updated = await EvidenceLinker.update('link_0123456789abcdef', { note: 'revised' });
    assert.equal(updated.note, 'revised');
    assert.equal(updated.relationship, 'contextualizes');
    assert.equal(updated.suggested_by, 'user');
    // Storage.set JSON-serializes values — parse the raw store entry.
    const rawStored = _stateStore.get('evidence_links');
    const stored = typeof rawStored === 'string' ? JSON.parse(rawStored) : rawStored;
    assert.equal(stored.link_0123456789abcdef.suggested_by, 'user',
        'normalized shape persisted to storage');

    // markPublished returns the normalized record as well.
    const marked = await EvidenceLinker.markPublished('link_0123456789abcdef', 'e'.repeat(64));
    assert.equal(marked.suggested_by, 'user');
});

test('evidence: relationship label/icon maps cover the enum + legacy contextualizes', () => {
    for (const r of [...EVIDENCE_RELATIONSHIPS, 'contextualizes']) {
        assert.ok(EVIDENCE_RELATIONSHIP_LABELS[r], `label for ${r}`);
        assert.ok(EVIDENCE_RELATIONSHIP_ICONS[r], `icon for ${r}`);
    }
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
    const ab_updates  = await EvidenceLinker.create({ source_claim_id: A, target_claim_id: B, relationship: 'updates' });
    const ba_contra   = await EvidenceLinker.create({ source_claim_id: B, target_claim_id: A, relationship: 'contradicts' });
    const cb_support  = await EvidenceLinker.create({ source_claim_id: C, target_claim_id: B, relationship: 'supports' });

    const forA = await EvidenceLinker.getForClaim(A);
    const ids = forA.map((l) => l.id).sort();
    assert.deepEqual(ids.sort(), [ab_supports.id, ab_updates.id, ba_contra.id].sort());
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
        ['contradicts', 'duplicates', 'supports', 'updates']
    );
});

test('evidence: parseRelationshipEvent round-trips the kind-30055 builder', async () => {
    const srcCoord = `30040:${PUBKEY_A}:claim_aaaaaaaaaaaaaaaa`;
    const tgtCoord = `30040:${PUBKEY_B}:claim_bbbbbbbbbbbbbbbb`;
    const { event, dTag } = await buildClaimRelationshipEvent({
        sourceCoord: srcCoord, targetCoord: tgtCoord, relationship: 'contradicts',
        sourceUrl: 'https://example.com/a', targetUrl: 'https://example.com/b',
        sourceEventId: 'e'.repeat(64),
        note: 'Same events, incompatible narrations.'
    });

    const parsed = parseRelationshipEvent({ ...event, pubkey: PUBKEY_A, id: 'f'.repeat(64) });
    assert.equal(parsed.id, dTag);
    assert.equal(parsed.relationship, 'contradicts');
    // contradicts is symmetric: the builder sorted the endpoints.
    assert.equal(parsed.source.coord, srcCoord);
    assert.equal(parsed.target.coord, tgtCoord);
    assert.equal(parsed.source.eventId, 'e'.repeat(64));
    assert.equal(parsed.target.eventId, null);
    assert.equal(parsed.note, 'Same events, incompatible narrations.');
    assert.equal(parsed.suggestedBy, 'user');
    assert.deepEqual(parsed.urls, ['https://example.com/a', 'https://example.com/b']);
    assert.equal(parsed.pubkey, PUBKEY_A);
});

test('evidence: parseRelationshipEvent does not misattribute a lone role-marked tag', async () => {
    // A directional link with ONLY a target event id: the single e tag
    // carries the 'target' marker, and the positional fallback must NOT
    // hand it to the source side.
    const { event } = await buildClaimRelationshipEvent({
        sourceCoord: `30040:${PUBKEY_A}:claim_aaaaaaaaaaaaaaaa`,
        targetCoord: `30040:${PUBKEY_B}:claim_bbbbbbbbbbbbbbbb`,
        relationship: 'supports',
        targetEventId: 'f'.repeat(64)
    });
    const parsed = parseRelationshipEvent(event);
    assert.equal(parsed.source.eventId, null, 'source has no event id');
    assert.equal(parsed.target.eventId, 'f'.repeat(64));
});

test('evidence: parseRelationshipEvent rejects non-30055 events, tolerates missing markers', () => {
    assert.equal(parseRelationshipEvent(null), null);
    assert.equal(parseRelationshipEvent({ kind: 30043, tags: [] }), null);

    // Unmarked a-tags fall back to tag order.
    const parsed = parseRelationshipEvent({
        kind: 30055,
        tags: [
            ['d', 'rel_x'],
            ['a', `30040:${PUBKEY_A}:claim_aaaaaaaaaaaaaaaa`],
            ['a', `30040:${PUBKEY_B}:claim_bbbbbbbbbbbbbbbb`],
            ['relationship', 'updates']
        ],
        content: ''
    });
    assert.equal(parsed.source.coord, `30040:${PUBKEY_A}:claim_aaaaaaaaaaaaaaaa`);
    assert.equal(parsed.target.coord, `30040:${PUBKEY_B}:claim_bbbbbbbbbbbbbbbb`);
    assert.equal(parsed.suggestedBy, 'user', 'defaults when absent');
});

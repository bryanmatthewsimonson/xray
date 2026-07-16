// Hypothesis map storage tests — Phase 26 H.1
// (docs/HYPOTHESIS_MAP_DESIGN.md §2). Same chrome.storage.local shim
// pattern as case-dossier.test.mjs. The load-bearing invariants:
// deterministic label-derived ids (idempotent create), immutable
// structural fields, canonical-ref matching with drift tolerance,
// cascade deletes (edges never orphaned), and NO score-bearing or
// wire-publish field on either record.

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
    HypothesisModel, HypothesisEdgeModel,
    HYPOTHESIS_EDGE_ROLES, generateHypothesisId, normalizeHypothesisLabel
} = await import('../src/shared/hypothesis-model.js');
const { ClaimModel } = await import('../src/shared/claim-model.js');
const { buildClaimCoord } = await import('../src/shared/claim-ref.js');

function resetState() { _stateStore.clear(); }

const CASE_ID = 'entity_00000000000000aa';
const PUBKEY_F = 'f'.repeat(64);

async function seedHypothesis(over = {}) {
    return HypothesisModel.create({
        case_id: CASE_ID, label: 'Zoonotic origin',
        statement: 'The outbreak began with an animal spillover.',
        ...over
    });
}

async function seedClaim(over = {}) {
    return ClaimModel.create({
        text: 'The first cluster centered on the market.',
        source_url: 'https://example.com/report',
        about: [CASE_ID],
        ...over
    });
}

// ------------------------------------------------------------------
// Hypotheses
// ------------------------------------------------------------------

test('hypothesis-model: create derives a deterministic label id; idempotent across label spacing/case', async () => {
    resetState();
    const first = await seedHypothesis();
    assert.match(first.id, /^hyp_[0-9a-f]{16}$/);
    assert.equal(first.id, await generateHypothesisId(CASE_ID, 'Zoonotic origin'));
    const again = await seedHypothesis({ label: '  zoonotic   ORIGIN ', statement: 'Different text' });
    assert.equal(again.id, first.id);
    assert.equal(again.statement, first.statement, 'idempotent create returns the existing record');
    assert.equal(Object.keys(await HypothesisModel.getAll()).length, 1);
});

test('hypothesis-model: case_id and label are required; suggested_by is validated', async () => {
    resetState();
    await assert.rejects(() => HypothesisModel.create({ label: 'X' }), /case_id is required/);
    await assert.rejects(() => HypothesisModel.create({ case_id: CASE_ID, label: '   ' }), /label is required/);
    await assert.rejects(() => seedHypothesis({ suggested_by: 'bogus' }), /Invalid suggested_by/);
    assert.equal((await seedHypothesis()).suggested_by, 'user');
    assert.equal((await seedHypothesis({ label: 'B', suggested_by: 'llm:claude-x' })).suggested_by, 'llm:claude-x');
    assert.equal((await seedHypothesis({ label: 'C', suggested_by: `nostr:${PUBKEY_F}` })).suggested_by, `nostr:${PUBKEY_F}`);
});

test('hypothesis-model: update patches statement/note only — label and case are identity', async () => {
    resetState();
    const h = await seedHypothesis();
    const patched = await HypothesisModel.update(h.id, {
        statement: 'Sharper phrasing.', note: 'why', label: 'Renamed', case_id: 'entity_00000000000000bb'
    });
    assert.equal(patched.statement, 'Sharper phrasing.');
    assert.equal(patched.note, 'why');
    assert.equal(patched.label, 'Zoonotic origin');
    assert.equal(patched.case_id, CASE_ID);
    await assert.rejects(() => HypothesisModel.update('hyp_missing', {}), /not found/);
});

test('hypothesis-model: getForCase filters and orders (created, id) — presentation, not rank', async () => {
    resetState();
    const a = await seedHypothesis({ label: 'A' });
    const b = await seedHypothesis({ label: 'B' });
    await seedHypothesis({ label: 'Other case', case_id: 'entity_00000000000000bb' });
    // Same-second creations tie on `created` — set distinct stamps
    // directly so the (created, id) comparator is actually asserted.
    const all = await HypothesisModel.getAll();
    all[a.id].created = 200;
    all[b.id].created = 100;
    _stateStore.set('case_hypotheses', JSON.stringify(all));
    const list = await HypothesisModel.getForCase(CASE_ID);
    assert.deepEqual(list.map((h) => h.id), [b.id, a.id], 'oldest-first, regardless of insertion order');
});

test('hypothesis-edge: getForCase joins via the case\'s hypotheses and excludes other cases', async () => {
    resetState();
    const mine = await seedHypothesis({ label: 'Mine' });
    const theirs = await seedHypothesis({ label: 'Theirs', case_id: 'entity_00000000000000bb' });
    const c = await seedClaim();
    const kept = await HypothesisEdgeModel.create({ hypothesis_id: mine.id, claim_ref: c.id, role: 'supports' });
    await HypothesisEdgeModel.create({ hypothesis_id: theirs.id, claim_ref: c.id, role: 'supports' });
    const list = await HypothesisEdgeModel.getForCase(CASE_ID);
    assert.deepEqual(list.map((e) => e.id), [kept.id]);
});

test('hypothesis-model: no score-bearing and no wire-publish field on either record', async () => {
    resetState();
    const h = await seedHypothesis();
    const c = await seedClaim();
    const e = await HypothesisEdgeModel.create({
        hypothesis_id: h.id, claim_ref: c.id, role: 'supports'
    });
    const banned = /weight|score|probabilit|confidence|strength|rating|grade|likelihood/i;
    // Recursive: nested objects (claim_snapshot) must not smuggle a
    // banned slot past a top-level-only scan.
    const walkKeys = (node, path) => {
        if (Array.isArray(node)) { node.forEach((v, i) => walkKeys(v, `${path}[${i}]`)); return; }
        if (node && typeof node === 'object') {
            for (const [k, v] of Object.entries(node)) {
                assert.doesNotMatch(k, banned, `forbidden key at ${path}.${k}`);
                walkKeys(v, `${path}.${k}`);
            }
        }
    };
    for (const rec of [h, e]) {
        walkKeys(rec, '$');
        assert.equal('publishedAt' in rec, false, 'no wire fields until H.5 is a decision');
        assert.equal('publishedEventId' in rec, false);
    }
});

// ------------------------------------------------------------------
// Edges
// ------------------------------------------------------------------

test('hypothesis-edge: roles pinned; create validates hypothesis, ref and role', async () => {
    resetState();
    assert.deepEqual([...HYPOTHESIS_EDGE_ROLES], ['supports', 'undermines']);
    const h = await seedHypothesis();
    const c = await seedClaim();
    await assert.rejects(
        () => HypothesisEdgeModel.create({ hypothesis_id: 'hyp_missing', claim_ref: c.id, role: 'supports' }),
        /Hypothesis not found/);
    await assert.rejects(
        () => HypothesisEdgeModel.create({ hypothesis_id: h.id, claim_ref: 'nonsense', role: 'supports' }),
        /claim id or a 30040 coordinate/);
    await assert.rejects(
        () => HypothesisEdgeModel.create({ hypothesis_id: h.id, claim_ref: c.id, role: 'contradicts' }),
        /Invalid edge role/);
});

test('hypothesis-edge: idempotent on (hypothesis, ref, role); roles stay distinct — never netted', async () => {
    resetState();
    const h = await seedHypothesis();
    const c = await seedClaim();
    const sup = await HypothesisEdgeModel.create({ hypothesis_id: h.id, claim_ref: c.id, role: 'supports' });
    const dup = await HypothesisEdgeModel.create({ hypothesis_id: h.id, claim_ref: c.id, role: 'supports', note: 'x' });
    assert.equal(dup.id, sup.id);
    assert.equal(dup.note, '', 'idempotent create returns the existing record');
    const und = await HypothesisEdgeModel.create({ hypothesis_id: h.id, claim_ref: c.id, role: 'undermines' });
    assert.notEqual(und.id, sup.id, 'a supports and an undermines attachment coexist');
    assert.equal((await HypothesisEdgeModel.getForHypothesis(h.id)).length, 2);
});

test('hypothesis-edge: snapshot auto-fills from the local claim registry', async () => {
    resetState();
    const h = await seedHypothesis();
    const c = await seedClaim();
    const e = await HypothesisEdgeModel.create({ hypothesis_id: h.id, claim_ref: c.id, role: 'supports' });
    assert.equal(e.claim_snapshot.text, c.text);
    assert.equal(e.claim_snapshot.url_raw, 'https://example.com/report');
});

test('hypothesis-edge: foreign coordinate — caller snapshot kept, author pubkey backfilled', async () => {
    resetState();
    const h = await seedHypothesis();
    const coord = buildClaimCoord(PUBKEY_F, 'claim_00000000000000ff');
    const e = await HypothesisEdgeModel.create({
        hypothesis_id: h.id, claim_ref: coord, role: 'undermines',
        quote: 'verbatim span', article_hash: 'a'.repeat(64),
        claim_snapshot: { url: 'https://foreign.example/x', text: 'their claim' }
    });
    assert.equal(e.claim_ref, coord, 'unpublished-elsewhere coordinate stays canonical');
    assert.equal(e.claim_snapshot.author_pubkey, PUBKEY_F);
    assert.equal(e.quote, 'verbatim span');
});

test('hypothesis-edge: drift dedupe — a stored coordinate that later collapses still dedupes and matches', async () => {
    resetState();
    const h = await seedHypothesis();
    const c = await seedClaim();
    const coord = buildClaimCoord(PUBKEY_F, c.id);
    // Stored while the coordinate is still foreign-shaped (claim not
    // yet published under that pubkey) — kept verbatim.
    const before = await HypothesisEdgeModel.create({
        hypothesis_id: h.id, claim_ref: coord, role: 'supports',
        claim_snapshot: { url: 'https://example.com/report', text: 'their view of it' }
    });
    assert.equal(before.claim_ref, coord);
    await ClaimModel.markPublished(c.id, 'e'.repeat(64), PUBKEY_F);
    // Same logical edge via the now-canonical local id: the drift pass
    // must find the stored record instead of minting a sibling.
    const after = await HypothesisEdgeModel.create({ hypothesis_id: h.id, claim_ref: c.id, role: 'supports' });
    assert.equal(after.id, before.id);
    // And canonical-ref matching reaches it from either representation.
    assert.equal((await HypothesisEdgeModel.getForClaim(c.id)).length, 1);
    assert.equal((await HypothesisEdgeModel.getForClaim(coord)).length, 1);
});

test('hypothesis-edge: update patches note only; structural fields immutable', async () => {
    resetState();
    const h = await seedHypothesis();
    const c = await seedClaim();
    const e = await HypothesisEdgeModel.create({ hypothesis_id: h.id, claim_ref: c.id, role: 'supports' });
    const patched = await HypothesisEdgeModel.update(e.id, { note: 'because', role: 'undermines' });
    assert.equal(patched.note, 'because');
    assert.equal(patched.role, 'supports');
});

// ------------------------------------------------------------------
// Cascades
// ------------------------------------------------------------------

test('hypothesis-model: deleting a hypothesis cascades its edges', async () => {
    resetState();
    const h = await seedHypothesis();
    const keep = await seedHypothesis({ label: 'Lab origin' });
    const c = await seedClaim();
    await HypothesisEdgeModel.create({ hypothesis_id: h.id, claim_ref: c.id, role: 'supports' });
    const kept = await HypothesisEdgeModel.create({ hypothesis_id: keep.id, claim_ref: c.id, role: 'undermines' });
    assert.equal(await HypothesisModel.delete(h.id), true);
    assert.equal(await HypothesisModel.get(h.id), null);
    const remaining = Object.values(await HypothesisEdgeModel.getAll());
    assert.deepEqual(remaining.map((e) => e.id), [kept.id]);
});

test('hypothesis-model: deleteForCase removes the case\'s hypotheses and edges, nothing else', async () => {
    resetState();
    const h = await seedHypothesis();
    const other = await seedHypothesis({ label: 'Elsewhere', case_id: 'entity_00000000000000bb' });
    const c = await seedClaim();
    await HypothesisEdgeModel.create({ hypothesis_id: h.id, claim_ref: c.id, role: 'supports' });
    const otherEdge = await HypothesisEdgeModel.create({ hypothesis_id: other.id, claim_ref: c.id, role: 'supports' });
    assert.equal(await HypothesisModel.deleteForCase(CASE_ID), 1);
    assert.equal(await HypothesisModel.get(h.id), null);
    assert.ok(await HypothesisModel.get(other.id));
    assert.deepEqual(Object.keys(await HypothesisEdgeModel.getAll()), [otherEdge.id]);
});

test('hypothesis-edge: deleteForClaim removes edges by either representation', async () => {
    resetState();
    const h = await seedHypothesis();
    const c = await seedClaim();
    await ClaimModel.markPublished(c.id, 'e'.repeat(64), PUBKEY_F);
    await HypothesisEdgeModel.create({ hypothesis_id: h.id, claim_ref: c.id, role: 'supports' });
    await HypothesisEdgeModel.create({ hypothesis_id: h.id, claim_ref: c.id, role: 'undermines' });
    const removed = await HypothesisEdgeModel.deleteForClaim(buildClaimCoord(PUBKEY_F, c.id));
    assert.equal(removed, 2);
    assert.deepEqual(await HypothesisEdgeModel.getForHypothesis(h.id), []);
});

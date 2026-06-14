// Forensic finding model tests — Phase 13.1 (docs/CRIMINOLOGY_DESIGN.md).
// Same chrome.storage.local shim pattern as assessment-model.test.mjs.

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
    ForensicModel, ForensicBaseline,
    generateFindingId, subjectRefKey
} = await import('../src/shared/forensic-model.js');
const { EvidenceLinker } = await import('../src/shared/evidence-linker.js');

function resetState() { _stateStore.clear(); }

const SUBJECT = { pubkey: 'a'.repeat(64), label: 'Jacob Hansen' };

function anchor(quote, extra = {}) {
    return { quote, source_ref: { url: 'https://example.com/clip-1' }, ...extra };
}

function baseFinding(over = {}) {
    return {
        subject_ref:  SUBJECT,
        role:         'apologist',
        maneuver:     'defense/usefulness-pivot',
        anchors:      [anchor('I care about the truth, not what the church says.')],
        note:         'Shifts the axis from is-it-true to is-it-useful.',
        counter_note: 'He may simply be conceding utility alongside the truth claim.',
        basis:        'quoted',
        ...over
    };
}

// ---------------------------------------------------------------------

test('finding: deterministic id derivation', async () => {
    const anchors = [{ quote: 'q', selector: null, timestamp: null }];
    const a = await generateFindingId('jacob', 'defense/ad-hoc-patch', anchors);
    const b = await generateFindingId('jacob', 'defense/manufactured-doubt', anchors);
    assert.match(a, /^find_[0-9a-f]{16}$/);
    assert.notEqual(a, b, 'different maneuvers derive different ids');
    assert.equal(a, await generateFindingId('jacob', 'defense/ad-hoc-patch', anchors), 'stable');
});

test('finding: subjectRefKey prefers the most durable identifier', () => {
    assert.equal(subjectRefKey({ identity_id: 'id-1', pubkey: 'b'.repeat(64), label: 'X' }), 'id-1');
    assert.equal(subjectRefKey({ pubkey: 'B'.repeat(64) }), 'b'.repeat(64), 'lowercased');
    assert.equal(subjectRefKey({ account: 'yt:@jacob' }), 'yt:@jacob');
    assert.equal(subjectRefKey({ label: 'Jacob Hansen' }), 'jacob hansen');
    assert.equal(subjectRefKey({}), '');
});

test('finding: create + get round-trip; no stance/intent field exists', async () => {
    resetState();
    const f = await ForensicModel.create(baseFinding());
    assert.match(f.id, /^find_[0-9a-f]{16}$/);
    assert.equal(f.maneuver, 'defense/usefulness-pivot');
    assert.equal(f.role, 'apologist');
    assert.equal(f.basis, 'quoted');
    assert.equal(f.anchors.length, 1);
    assert.equal(f.anchors[0].quote, 'I care about the truth, not what the church says.');
    assert.equal(f.anchors[0].source_ref.url, 'https://example.com/clip-1', 'url normalized + stored');
    assert.equal(f.counter_note.length > 0, true);
    assert.equal(f.suggested_by, 'user');
    assert.equal(f.publishedAt, null);
    // The no-verdict guarantee: the model carries no honesty/intent/score.
    assert.equal('stance' in f, false);
    assert.equal('intent' in f, false);
    assert.equal('confidence' in f, false);
    assert.equal('lying' in f, false);

    const got = await ForensicModel.get(f.id);
    assert.deepEqual(got, f);
});

test('finding: idempotent on (subject, maneuver, anchors)', async () => {
    resetState();
    const a = await ForensicModel.create(baseFinding());
    const b = await ForensicModel.create(baseFinding({ note: 'different note, same evidence' }));
    assert.equal(a.id, b.id, 'same evidence ⇒ same record');
    assert.equal(b.note, a.note, 'idempotent create returns the existing record (note unchanged)');
    assert.equal(Object.keys(await ForensicModel.getAll()).length, 1);
});

test('finding: Rule 2 — at least one anchor with a quote is required', async () => {
    resetState();
    await assert.rejects(() => ForensicModel.create(baseFinding({ anchors: [] })),
        /at least one evidence anchor/);
    await assert.rejects(() => ForensicModel.create(baseFinding({ anchors: [{ quote: '   ' }] })),
        /non-empty quote/);
});

test('finding: Rule 6 — a counter_note is required', async () => {
    resetState();
    await assert.rejects(() => ForensicModel.create(baseFinding({ counter_note: '' })),
        /counter_note/);
    await assert.rejects(() => ForensicModel.create(baseFinding({ counter_note: '   ' })),
        /counter_note/);
});

test('finding: rejects invalid maneuver / role / basis', async () => {
    resetState();
    await assert.rejects(() => ForensicModel.create(baseFinding({ maneuver: 'Bad Maneuver' })),
        /Invalid maneuver/);
    await assert.rejects(() => ForensicModel.create(baseFinding({ role: 'prosecutor' })),
        /Invalid role/);
    await assert.rejects(() => ForensicModel.create(baseFinding({ basis: 'vibes' })),
        /Invalid basis/);
});

test('finding: getForSubject matches across representations sharing a key', async () => {
    resetState();
    await ForensicModel.create(baseFinding({ maneuver: 'defense/ad-hoc-patch' }));
    await ForensicModel.create(baseFinding({
        maneuver: 'darvo/attack',
        anchors: [anchor('You are just biased.')]
    }));
    // A subject ref with only the pubkey (no label) resolves to the same key.
    const found = await ForensicModel.getForSubject({ pubkey: 'a'.repeat(64) });
    assert.equal(found.length, 2);
    const other = await ForensicModel.getForSubject({ pubkey: 'c'.repeat(64) });
    assert.equal(other.length, 0);
});

test('finding: update patches mutable fields; counter_note stays required', async () => {
    resetState();
    const f = await ForensicModel.create(baseFinding());
    const updated = await ForensicModel.update(f.id, {
        note: 'sharper', basis: 'structural-inference', role: 'institution'
    });
    assert.equal(updated.note, 'sharper');
    assert.equal(updated.basis, 'structural-inference');
    assert.equal(updated.role, 'institution');
    assert.ok(updated.updated >= f.updated);
    await assert.rejects(() => ForensicModel.update(f.id, { counter_note: '' }),
        /counter_note/, 'cannot blank the counter-note via update');
});

test('finding: markPublished stamps publish fields without bumping updated', async () => {
    resetState();
    const f = await ForensicModel.create(baseFinding());
    const before = f.updated;
    const pub = await ForensicModel.markPublished(f.id, 'evt123', 'd'.repeat(64));
    assert.ok(pub.publishedAt > 0);
    assert.equal(pub.publishedEventId, 'evt123');
    assert.equal(pub.publishedPubkey, 'd'.repeat(64));
    assert.equal(pub.updated, before, 'publish is not an edit — updated unchanged');
});

test('finding: delete', async () => {
    resetState();
    const f = await ForensicModel.create(baseFinding());
    assert.equal(await ForensicModel.delete(f.id), true);
    assert.equal(await ForensicModel.get(f.id), null);
    assert.equal(await ForensicModel.delete(f.id), false);
});

// --- baselines (Rule 3) ----------------------------------------------

test('baseline: create idempotent on (subject, url) + deviation ref', async () => {
    resetState();
    const b = await ForensicBaseline.create({
        subject_ref: SUBJECT,
        source_url: 'https://example.com/clip-1',
        note: 'Even, fact-anchored register across the first three sessions.'
    });
    assert.match(b.id, /^baseline_[0-9a-f]{16}$/);
    const b2 = await ForensicBaseline.create({
        subject_ref: SUBJECT,
        source_url: 'https://example.com/clip-1',
        note: 'updated register note'
    });
    assert.equal(b2.id, b.id, 'same subject+url ⇒ same baseline');
    assert.equal(b2.note, 'updated register note', 're-marking updates the note in place');
    assert.equal((await ForensicBaseline.getForSubject(SUBJECT)).length, 1);

    // A finding can deviate from it.
    const f = await ForensicModel.create(baseFinding({ baseline_ref: b.id }));
    assert.equal(f.baseline_ref, b.id);
});

// --- the revision/* edge substrate (kind 30055) ----------------------

test('revision: the linker accepts directional revision/* edges', async () => {
    resetState();
    const A = 'claim_aaaaaaaaaaaaaaaa';
    const B = 'claim_bbbbbbbbbbbbbbbb';
    const link = await EvidenceLinker.create({
        source_claim_id: A, target_claim_id: B, relationship: 'narrative-patch',
        note: 'the catalyst-theory cover story, added after the translation evidence failed'
    });
    assert.equal(link.relationship, 'narrative-patch');
    assert.equal(link.source_claim_id, A, 'directional: source = earlier statement');
    assert.equal(link.target_claim_id, B, 'directional: target = later statement');

    // Directional ⇒ the reverse is a distinct edge (not collapsed).
    const reverse = await EvidenceLinker.create({
        source_claim_id: B, target_claim_id: A, relationship: 'narrative-patch'
    });
    assert.notEqual(reverse.id, link.id);

    // recharacterizes + walks-back are accepted too.
    const rc = await EvidenceLinker.create({
        source_claim_id: A, target_claim_id: B, relationship: 'recharacterizes'
    });
    assert.equal(rc.relationship, 'recharacterizes');
    // ...but a bogus relationship is still rejected.
    await assert.rejects(() => EvidenceLinker.create({
        source_claim_id: A, target_claim_id: B, relationship: 'vibes-shift'
    }), /Invalid relationship/);
});

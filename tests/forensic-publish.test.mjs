// Forensic publish selection — Phase 14 publish wiring.
// Wire-readiness of findings, mirrors, and revision/* edges, plus the
// split that keeps revision edges OUT of the assessment link batch.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// claim-ref.js (pulled in via assessment-publish.js) touches chrome at import.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const {
    resolveSubjectPubkey, selectFindingsToPublish, selectFindingMirrors,
    selectRevisionEdgesToPublish
} = await import('../src/shared/forensic-publish.js');
const { selectLinksToPublish } = await import('../src/shared/assessment-publish.js');

const PK = 'a'.repeat(64);
const ENT_PK = 'b'.repeat(64);
const entities = { 'ent-1': { id: 'ent-1', keypair: { pubkey: ENT_PK } }, 'ent-2': { id: 'ent-2' } };
const canon = (x) => x;

function finding(over = {}) {
    return {
        id: 'find_1', subject_ref: { identity_id: 'ent-1', label: 'Jacob' },
        maneuver: 'defense/usefulness-pivot', role: 'apologist', basis: 'quoted',
        anchors: [{ quote: 'q', selector: null, timestamp: null, source_ref: { url: 'https://e.com/x', url_raw: 'https://e.com/x?utm=1' } }],
        note: 'n', counter_note: 'c', created: 1, updated: 1, publishedAt: null,
        ...over
    };
}

test('resolveSubjectPubkey: external pubkey wins, else entity keypair, else null', () => {
    assert.equal(resolveSubjectPubkey({ pubkey: PK, identity_id: 'ent-1' }, entities), PK);
    assert.equal(resolveSubjectPubkey({ identity_id: 'ent-1' }, entities), ENT_PK);
    assert.equal(resolveSubjectPubkey({ identity_id: 'ent-2' }, entities), null, 'entity without a keypair');
    assert.equal(resolveSubjectPubkey({ label: 'Jacob' }, entities), null, 'label-only is not publishable');
    assert.equal(resolveSubjectPubkey({ pubkey: 'nothex' }, entities), null);
});

test('selectFindingsToPublish: resolves subject, applies staleness, carries verbatim url', () => {
    const sel = selectFindingsToPublish({ findings: { f: finding() }, entities });
    assert.equal(sel.length, 1);
    assert.equal(sel[0].subjectPubkey, ENT_PK);
    assert.equal(sel[0].sourceUrl, 'https://e.com/x?utm=1', 'verbatim url_raw for the wire r');
    assert.equal(sel[0].anchors[0].quote, 'q');

    // staleness: published and not edited → skipped
    assert.equal(selectFindingsToPublish({ findings: { f: finding({ publishedAt: 5, updated: 3 }) }, entities }).length, 0);
    // edited after publish → re-selected
    assert.equal(selectFindingsToPublish({ findings: { f: finding({ publishedAt: 5, updated: 9 }) }, entities }).length, 1);
    // unresolvable subject → skipped
    assert.equal(selectFindingsToPublish({ findings: { f: finding({ subject_ref: { label: 'x' } }) }, entities }).length, 0);
});

test('selectFindingMirrors: keyed on mirroredAt, needs a resolvable subject', () => {
    assert.equal(selectFindingMirrors({ findings: { f: finding() }, entities }).length, 1);
    assert.equal(selectFindingMirrors({ findings: { f: finding({ mirroredAt: 7 }) }, entities }).length, 0);
    // a published-but-unmirrored finding still mirrors
    assert.equal(selectFindingMirrors({ findings: { f: finding({ publishedAt: 5, updated: 3 }) }, entities }).length, 1);
});

// --- the revision-edge split ----------------------------------------

const A = 'claim_aaaaaaaaaaaaaaaa', B = 'claim_bbbbbbbbbbbbbbbb';
const claims = {
    [A]: { id: A, publishedPubkey: PK, source_url: 'https://e.com/a' },
    [B]: { id: B, publishedPubkey: ENT_PK, source_url: 'https://e.com/b' }
};
function link(rel, over = {}) {
    return { id: `link_${rel}`, relationship: rel, source_claim_id: A, target_claim_id: B, created: 1, updated: 1, publishedAt: null, ...over };
}

test('selectRevisionEdgesToPublish: only revision/* edges, both endpoints wire-ready', () => {
    const links = { r: link('narrative-patch'), c: link('contradicts') };
    const sel = selectRevisionEdgesToPublish({ links, claims, canon });
    assert.equal(sel.length, 1);
    assert.equal(sel[0].link.relationship, 'narrative-patch');
    assert.equal(sel[0].source.coord, `30040:${PK}:${A}`);
    assert.equal(sel[0].target.coord, `30040:${ENT_PK}:${B}`);
    // an unpublished endpoint defers the edge
    const claims2 = { [A]: claims[A], [B]: { id: B, source_url: 'x' } };
    assert.equal(selectRevisionEdgesToPublish({ links: { r: link('walks-back') }, claims: claims2, canon }).length, 0);
});

test('the assessment link batch now SKIPS revision/* (they publish under forensicPublishing)', () => {
    const links = { r: link('narrative-patch'), c: link('contradicts'), x: link('contextualizes') };
    const sel = selectLinksToPublish({ links, claims, canon });
    assert.deepEqual(sel.map((s) => s.link.relationship).sort(), ['contradicts'],
        'only the truth-relationship publishes here; revision/* and legacy contextualizes are excluded');
});

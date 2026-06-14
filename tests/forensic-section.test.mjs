// Forensic findings render tests — Phase 13.2 (docs/CRIMINOLOGY_DESIGN.md).
//
// The modal itself is DOM-driven (smoke-tested manually), but the badge
// strip and the reader findings bar are pure HTML-string builders, so
// they're unit-testable in node. ensureStyles() no-ops when `document`
// is undefined, so importing the modal module here is safe.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// storage.js touches chrome.* at import time; the modal's import chain
// pulls it in even though these pure renderers never read storage.
globalThis.chrome = { storage: { local: {
    get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); }
} } };

const { renderFindingBadges } = await import('../src/shared/forensic-modal.js');
const { renderFindingsBar } = await import('../src/reader/findings-section.js');

function finding(over = {}) {
    return {
        id: 'find_0123456789abcdef',
        subject_ref: { identity_id: 'ent-1', label: 'Jacob Hansen' },
        role: 'apologist',
        maneuver: 'defense/usefulness-pivot',
        basis: 'quoted',
        anchors: [{ quote: 'I care about the truth, not what the church says.' }],
        ...over
    };
}

test('badges: null renders nothing', () => {
    assert.equal(renderFindingBadges(null), '');
});

test('badges: maneuver + role + basis, with published + custom + sequence markers', () => {
    const html = renderFindingBadges(finding());
    assert.match(html, /defense\/usefulness-pivot/);
    assert.match(html, /apologist/);
    assert.match(html, /quoted/);
    assert.doesNotMatch(html, /xr-finding-badge--pub/, 'no publish marker when unpublished');

    const pub = renderFindingBadges(finding({ publishedAt: 1 }));
    assert.match(pub, /xr-finding-badge--pub/);

    const custom = renderFindingBadges(finding({ maneuver: 'defense/gish-gallop' }));
    assert.match(custom, /xr-finding-badge--custom/, 'non-standard maneuver flagged custom');

    const seq = renderFindingBadges(finding({
        maneuver: 'grooming/build-vulnerability',
        anchors: [{ quote: 'a' }, { quote: 'b' }, { quote: 'c' }]
    }));
    assert.match(seq, /·3/, 'sequence step count shown');
});

test('bar: empty state prompts the no-verdict capture flow', () => {
    const html = renderFindingsBar([]);
    assert.match(html, /\+ Finding/);
    assert.match(html, /Set baseline/);
    assert.match(html, /counter-read/i, 'empty hint states the falsifiability discipline');
    assert.doesNotMatch(html, /xr-findings__item\b/, 'no rows');
});

test('bar: a row carries the subject, maneuver, lead quote, and actions', () => {
    const html = renderFindingsBar([finding()]);
    assert.match(html, /Forensic findings \(1\)/);
    assert.match(html, /data-id="find_0123456789abcdef"/);
    assert.match(html, /Jacob Hansen/);
    assert.match(html, /defense\/usefulness-pivot/);
    assert.match(html, /I care about the truth/);
    assert.match(html, /data-action="edit"/);
    assert.match(html, /data-action="delete"/);
});

test('bar: long lead quotes are truncated with an ellipsis', () => {
    const long = 'x'.repeat(400);
    const html = renderFindingsBar([finding({ anchors: [{ quote: long }] })]);
    assert.match(html, /…/, 'truncated');
    assert.doesNotMatch(html, new RegExp('x{300}'), 'not the full 400-char quote');
});

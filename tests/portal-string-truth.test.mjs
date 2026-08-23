// PR-2 of docs/PORTAL_UX_REVIEW.md — the string truth pass.
// Every assertion here is a sentence the interface used to say that was
// false, misleading, or internal jargon shown as UI. They are pinned so
// the lies cannot quietly return.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const repoUrl = (p) => new URL(`../${p}`, import.meta.url);
const readRepo = (p) => readFileSync(repoUrl(p), 'utf8');
// Grep CODE, not comments — a comment legitimately names the string it
// explains removing, which is exactly what these guards look for.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const PORTAL = stripComments(readRepo('src/portal/index.js'));

test('A3: the empty state no longer sends your own npub to the viewer box', () => {
    // identity.js fences a manual-only pubkey as a VIEWER (never "me"),
    // so "paste your npub above" was a misdirection into read-only.
    assert.ok(!/Paste your npub above/.test(PORTAL), 'the misdirecting line must be gone');
    assert.match(PORTAL, /Configure signing in Settings, or publish a capture once/,
        'the real recovery options, in order');
    // Source carries the apostrophe as a \u2019 escape (house style).
    assert.match(PORTAL, /someone else(\\u2019|.)s archive/,
        'the viewer box is named for what it is');
});

test('C4: the inspector opener says it is read-only', () => {
    const inspector = stripComments(readRepo('src/portal/inspector.js'));
    assert.ok(!/'Open in reader'/.test(inspector),
        'two same-looking "Open in reader" actions with opposite write semantics lost claim work-intent');
    assert.match(inspector, /'View published copy \(read-only\)'/);
    assert.match(inspector, /field\('Event address'/, '"Coordinate" is wire vocabulary, not UI');
});

test('E1: the page is "Archive" — the ratified one-noun name', () => {
    const html = readRepo('src/portal/index.html');
    assert.ok(!/My Archive/.test(html), 'ROAD_TO_1_0 ratified the one-noun rule');
    assert.match(html, /<title>X-Ray — Archive<\/title>/);
});

test('D2 (strings): provenance tokens render as words, tokens kept as tooltips', () => {
    assert.match(PORTAL, /IDENTITY_SOURCE_LABELS = \{/);
    for (const token of ['sync-key', 'publish-history', 'manual', 'signer']) {
        assert.match(PORTAL, new RegExp(`['"]?${token}['"]?:\\s*'[^']+'`), `${token} has a plain label`);
    }
    assert.match(PORTAL, /IDENTITY_SOURCE_LABELS\[src\] \|\| src/, 'unknown tokens still render rather than vanish');
    assert.match(PORTAL, /srcEl\.title = src/, 'the raw token stays available to the expert');
});

test('jargon table: the pure-string rows are applied', () => {
    const lib = readRepo('src/portal/library.js');
    for (const [gone, now] of [
        ['readable corpus brief', 'case summary (readable article)'],
        ['encrypted — listed, not decrypted', 'encrypted backup entry (contents not shown)'],
        ['NIP-02 follow list (opt-in mirror)', 'your follow list'],
        ['creator-binding manifest', 'key ownership proof']
    ]) {
        assert.ok(!lib.includes(gone), `library.js still says "${gone}"`);
        assert.ok(lib.includes(now), `library.js should say "${now}"`);
    }
    assert.ok(!/13\.8 batch/.test(PORTAL), 'phase numbers are not user vocabulary');
    assert.match(PORTAL, /Unpublished local items \(/, '"artifact" stays in docs and wire, "item" in chrome');
});

test('PR-9 vocabulary is deliberately UNTOUCHED (sequenced behind Phase 29.5)', () => {
    // The publish-state words — ledger / remote-only / No ledger — are
    // finding C1 and must change TOGETHER in or after the reconcile
    // repoint, never piecemeal here. Pinning that this pass left them.
    assert.match(PORTAL, /Local ledger says/, 'the summary line vocabulary is C1, not PR-2');
    assert.match(readRepo('src/portal/index.html'), /No ledger/, 'the facet vocabulary is C1, not PR-2');
});

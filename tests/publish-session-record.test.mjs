// A missing session record must not block publishing — field-found
// 2026-08-28, mid-corpus-capture.
//
// The maintainer had a reader tab open with hours of extracted claims,
// hit Publish, and got "Publish failed: Session record missing". The
// record had been evicted by the quota discipline added in PR #359 —
// which is correct behaviour for a full session area, but the failure
// it produced was not.
//
// The record carries exactly ONE thing the publish path reads:
// `record.sourceTabId`. And sourceTabId is load-bearing for exactly one
// signing method: NIP-07, whose `window.nostr` lives in the source
// page. Local and NSecBunker sign in the worker through the Signer
// façade and need no tab at all — which is why PDFs, imported EPUB
// chapters, transcript imports and portal reconstructions already
// publish fine with `sourceTabId: null`.
//
// So both handlers refused unconditionally on a missing record, then —
// two lines later — branched correctly on `sourceTabId == null`. The
// refusal was strictly redundant for every method except NIP-07, and
// for NIP-07 the null branch already produces the honest "needs a web
// page — switch to Local" error. A missing record must therefore
// degrade to the tabless path, never to a refusal.
//
// Grep-guard, matching tests/publish-transport-guard.test.mjs's idiom:
// these handlers live in the service worker and cannot be imported.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/background/index.js', import.meta.url), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('no handler refuses a publish because the session record is gone', () => {
    assert.ok(!/return \{ ok: false, error: 'Session record missing/.test(CODE),
        'handleCapturePublish must degrade to the tabless path, not refuse');
    assert.ok(!/sendResponse\(\{ ok: false, error: 'Session record missing'/.test(CODE),
        'the getPubkey handler must degrade to the façade, not refuse');
});

test('both handlers read sourceTabId defensively — a missing record means "no tab"', () => {
    // The exact shape matters: `record && record.sourceTabId` yields
    // undefined when the record is gone, and `== null` (loose) catches
    // both undefined and null, which is what the existing tabless
    // branches already test.
    const uses = CODE.match(/record && record\.sourceTabId/g) || [];
    assert.ok(uses.length >= 2, `both handlers must read the tab id defensively (found ${uses.length})`);
});

test('the tabless branches that make this safe are still intact', () => {
    // If these ever stop handling a null tab id, the degradation above
    // becomes a silent NIP-07 failure instead of an honest one.
    const branches = CODE.match(/!Signer\.methodRequiresPageContext\(method\) \|\| sourceTabId == null/g) || [];
    const legacy = CODE.match(/!Signer\.methodRequiresPageContext\(method\) \|\| record\.sourceTabId == null/g) || [];
    assert.equal(branches.length + legacy.length, 2,
        'both the publish and the getPubkey path must keep their tabless branch');
});

test('NIP-07 with no tab still gets the honest, actionable error', () => {
    // The degradation must not turn a real NIP-07 problem into silence:
    // the façade raises, and tablessSignError words it.
    assert.match(CODE, /function tablessSignError/);
    assert.match(SRC, /needs a normal web page[\s\S]{0,120}Switch Settings → Signing to Local/,
        'the NIP-07-without-a-page error must stay actionable');
});

test('the eviction comment no longer promises a failure that cannot happen', () => {
    const notes = readFileSync(new URL('../src/shared/session-articles.js', import.meta.url), 'utf8');
    assert.ok(!/publishes as "Session record missing" and\s*\n\/\/ recovers by re-capture/.test(notes),
        'the module header must not still claim eviction costs a publish');
});

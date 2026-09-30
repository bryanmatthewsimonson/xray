// One "is this sender an extension page?" check in the worker:
// fromExtensionPage (src/background/llm-jobs.js). Three doors use it —
// the LLM-job ops, xray:llm:models (llm-models.js), and the capture
// handoff's source-tab rule (xray:reader:open in background/index.js).
// Before 2026-09-29 the handoff carried its own inline copy; a copied
// boundary check drifts from the tested one (architect skill,
// Standard 10), so this file pins both the behavior and the single site.
//
// What makes this file fail: an inline `getURL('')` origin test
// reappearing anywhere else under src/background/, or the predicate
// accepting a web page, a look-alike origin, or a missing sender.
//
// Provenance: INTERPRETATION (2026-09-29) — expires 2026-12-28

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

await import('fake-indexeddb/auto');
globalThis.chrome = globalThis.chrome || {
    storage: {
        local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } },
        session: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); } }
    },
    runtime: { getURL: (p = '') => `chrome-extension://xray-test/${p}` }
};

const { fromExtensionPage } = await import('../src/background/llm-jobs.js');

test('only a sender on the extension\'s own origin is an extension page', () => {
    assert.equal(fromExtensionPage({ url: 'chrome-extension://xray-test/src/reader/reader.html', tab: { id: 4 } }), true);
    for (const sender of [
        { url: 'https://example.com/article', tab: { id: 4 } },     // the content script's sender
        { url: 'chrome-extension://xray-test.evil/page.html' },      // a look-alike origin
        { url: '' },
        { tab: { id: 4 } },
        undefined
    ]) {
        assert.equal(fromExtensionPage(sender), false, JSON.stringify(sender));
    }
});

test('the worker tests a sender\'s origin in exactly one place', () => {
    const dir = new URL('../src/background/', import.meta.url);
    const sites = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
        const src = readFileSync(new URL(f, dir), 'utf8');
        const hits = src.match(/runtime\.getURL\(\s*(['"])\1\s*\)/g) || [];
        for (let i = 0; i < hits.length; i++) sites.push(f);
    }
    assert.deepEqual(sites, ['llm-jobs.js'],
        'an extension-page check outside fromExtensionPage — import it from ./llm-jobs.js instead');
});

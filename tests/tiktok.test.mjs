// TikTok handler tests — Phase 8b.
//
// `synthesizeArticle` requires a live document + content-script
// context; smoke-test that end-to-end. What we CAN unit-test in
// isolation: the SSR-state extractor and the itemStruct path
// resolution. Pin the three SSR shapes (universal /
// SIGI / next-data) so format drift across TikTok versions doesn't
// silently zero our extraction.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// The handler imports content-extractor + screenshot, both of
// which touch chrome.* / DOM globals at module-load. Stub those
// before importing.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};
globalThis.window = globalThis.window || {
    location: { hostname: 'www.tiktok.com', pathname: '/@user/video/1234' }
};

const { parseSsrState, extractItemStruct } = await import('../src/shared/platforms/tiktok.js');

// Minimal `document.getElementById` shim returning a fake script
// element with a controllable JSON body.
function fakeDoc(scriptsById) {
    return {
        getElementById(id) {
            const body = scriptsById[id];
            if (typeof body === 'undefined') return null;
            return { textContent: body };
        }
    };
}

test('parseSsrState prefers __UNIVERSAL_DATA_FOR_REHYDRATION__ when present', () => {
    const universal = JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: { id: '1', desc: 'u' } } } } });
    const sigi      = JSON.stringify({ ItemModule: { '1': { id: '1', desc: 's' } } });
    const doc = fakeDoc({
        '__UNIVERSAL_DATA_FOR_REHYDRATION__': universal,
        'SIGI_STATE': sigi
    });
    const out = parseSsrState(doc);
    assert.equal(out.source, 'universal');
});

test('parseSsrState falls back to SIGI_STATE when universal is missing', () => {
    const sigi = JSON.stringify({ ItemModule: { '1': { desc: 's' } } });
    const out = parseSsrState(fakeDoc({ 'SIGI_STATE': sigi }));
    assert.equal(out.source, 'sigi');
});

test('parseSsrState falls back to __NEXT_DATA__ as last resort', () => {
    const next = JSON.stringify({ props: { pageProps: { itemInfo: { itemStruct: { desc: 'n' } } } } });
    const out = parseSsrState(fakeDoc({ '__NEXT_DATA__': next }));
    assert.equal(out.source, 'nextdata');
});

test('parseSsrState returns null when no SSR script is present', () => {
    assert.equal(parseSsrState(fakeDoc({})), null);
});

test('parseSsrState returns null when present script is malformed JSON', () => {
    const out = parseSsrState(fakeDoc({ '__UNIVERSAL_DATA_FOR_REHYDRATION__': 'not json' }));
    assert.equal(out, null);
});

test('extractItemStruct handles the universal shape', () => {
    const state = {
        source: 'universal',
        data: { __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: { id: 'x', desc: 'caption' } } } } }
    };
    const item = extractItemStruct(state);
    assert.equal(item.desc, 'caption');
});

test('extractItemStruct handles the SIGI shape, keyed by url video id', () => {
    // The handler uses videoIdFromLocation() which reads
    // window.location.pathname. We stubbed it to /@user/video/1234.
    const state = {
        source: 'sigi',
        data: { ItemModule: { '1234': { id: '1234', desc: 'sigi-keyed' } } }
    };
    const item = extractItemStruct(state);
    assert.equal(item.desc, 'sigi-keyed');
});

test('extractItemStruct falls back to first ItemModule entry when id-keyed lookup misses', () => {
    const state = {
        source: 'sigi',
        data: { ItemModule: { '99999': { id: '99999', desc: 'first-only' } } }
    };
    const item = extractItemStruct(state);
    assert.equal(item.desc, 'first-only');
});

test('extractItemStruct handles the __NEXT_DATA__ shape', () => {
    const state = {
        source: 'nextdata',
        data: { props: { pageProps: { itemInfo: { itemStruct: { desc: 'nextdata-cap' } } } } }
    };
    const item = extractItemStruct(state);
    assert.equal(item.desc, 'nextdata-cap');
});

test('extractItemStruct returns null on malformed shape', () => {
    assert.equal(extractItemStruct(null), null);
    assert.equal(extractItemStruct({}), null);
    assert.equal(extractItemStruct({ source: 'universal', data: {} }), null);
    assert.equal(extractItemStruct({ source: 'sigi', data: {} }), null);
    assert.equal(extractItemStruct({ source: 'unknown', data: {} }), null);
});

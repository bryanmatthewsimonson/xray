// PDF figure-placement geometry — Phase 18 C4.2 (PR #108 follow-up).
//
// unitSquareBBox must take the bbox over ALL FOUR transformed corners
// of the image's unit square: the naive w=|a|, h=|d|, corner=(e,f)
// read misplaced top-down draws and zero-sized rotated images.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// chrome shim — pdf-capture transitively imports storage-backed modules.
const _store = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) { const o = {}; for (const k of (Array.isArray(keys) ? keys : [keys])) if (_store.has(k)) o[k] = _store.get(k); cb(o); },
            set(obj, cb) { for (const [k, v] of Object.entries(obj)) _store.set(k, v); cb && cb(); },
            remove(keys, cb) { for (const k of (Array.isArray(keys) ? keys : [keys])) _store.delete(k); cb && cb(); }
        }
    },
    runtime: { getURL: (p) => 'chrome-extension://test/' + p }
};

const { unitSquareBBox } = await import('../src/reader/pdf-capture.js');

test('axis-aligned placement: corner + extents', () => {
    // cm: 200-wide, 150-tall image with bottom-left at (72, 500)
    assert.deepEqual(unitSquareBBox([200, 0, 0, 150, 72, 500]),
        { x: 72, y: 500, w: 200, h: 150 });
});

test('negative-d (top-down) draw: f is the TOP edge, not the bottom', () => {
    // Same image drawn flipped: e,f name the top-left corner.
    const box = unitSquareBBox([200, 0, 0, -150, 72, 650]);
    assert.deepEqual(box, { x: 72, y: 500, w: 200, h: 150 });
});

test('90°-rotated image keeps its real extent (was ~0 and dropped)', () => {
    // a=d=0, extent lives in b/c.
    const box = unitSquareBBox([0, 120, -80, 0, 200, 300]);
    assert.deepEqual(box, { x: 120, y: 300, w: 80, h: 120 });
});

test('negative-a (mirrored) draw normalizes to the min corner', () => {
    const box = unitSquareBBox([-200, 0, 0, 150, 272, 500]);
    assert.deepEqual(box, { x: 72, y: 500, w: 200, h: 150 });
});

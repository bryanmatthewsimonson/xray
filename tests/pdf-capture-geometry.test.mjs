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

const { unitSquareBBox, viewportBBox, channelsToRgba } = await import('../src/reader/pdf-capture.js');

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

// ------------------------------------------------------------------
// viewportBBox — figure bboxes must live in the VIEWED page's space
// (operator CTMs are raw user space; /Rotate + MediaBox origin are
// viewport-only in pdf.js).
// ------------------------------------------------------------------

test('viewportBBox: identity on an unrotated origin-0 page', () => {
    // pdf.js viewport.transform for rotation 0, scale 1, viewBox
    // [0,0,612,792] is [1, 0, 0, -1, 0, 792] (y-flip only).
    const viewport = { transform: [1, 0, 0, -1, 0, 792], height: 792 };
    assert.deepEqual(viewportBBox([200, 0, 0, 150, 72, 500], viewport),
        { x: 72, y: 500, w: 200, h: 150 });
});

test('viewportBBox: /Rotate 90 maps the bbox into viewed coordinates', () => {
    // pdf.js viewport.transform for rotation 90, scale 1, viewBox
    // [0,0,612,792] is [0, 1, 1, 0, 0, 0] (verified against pdf.js
    // 6.1.200: convertToViewportPoint(72,700) → (700,72)); the viewed
    // page is 792×612. A 100×50 image at user (72,500) must land at
    // viewed x 500..550, y-up 440..540 — the raw-CTM read left it in
    // coordinates the (viewport-mapped) text no longer occupies.
    const viewport = { transform: [0, 1, 1, 0, 0, 0], height: 612 };
    assert.deepEqual(viewportBBox([100, 0, 0, 50, 72, 500], viewport),
        { x: 500, y: 440, w: 50, h: 100 });
});

// ------------------------------------------------------------------
// channelsToRgba — raw pdf.js image shapes.
// ------------------------------------------------------------------

test('channelsToRgba: GRAYSCALE_1BPP expands packed bits (MSB first, 1=white)', () => {
    // 10×2 px → 2 padded bytes per row (pdf.js packs rows to byte
    // boundaries). Inferring channels from data.length rounded to 0
    // and dropped 1-bit line art entirely.
    const data = Uint8Array.from([0b10000000, 0b01000000, 0b11111111, 0b11000000]);
    const rgba = channelsToRgba(data, 10, 2, 1);
    assert.ok(rgba, '1bpp data must decode');
    assert.equal(rgba.length, 10 * 2 * 4);
    const px = (x, y) => [rgba[(y * 10 + x) * 4], rgba[(y * 10 + x) * 4 + 3]];
    assert.deepEqual(px(0, 0), [255, 255], 'row 0 bit 0 is white');
    assert.deepEqual(px(1, 0), [0, 255], 'row 0 bit 1 is black');
    assert.deepEqual(px(8, 0), [0, 255], 'second byte, bit 7');
    assert.deepEqual(px(9, 0), [255, 255], 'second byte, bit 6');
    assert.deepEqual(px(7, 1), [255, 255], 'row padding respected');
    assert.deepEqual(px(9, 1), [255, 255]);
});

test('channelsToRgba: truncated 1bpp data is rejected, not misread', () => {
    assert.equal(channelsToRgba(Uint8Array.from([0xff]), 10, 2, 1), null);
});

test('channelsToRgba: RGB_24BPP and RGBA_32BPP still decode', () => {
    const rgb = channelsToRgba(Uint8Array.from([10, 20, 30, 40, 50, 60]), 2, 1, 2);
    assert.deepEqual([...rgb], [10, 20, 30, 255, 40, 50, 60, 255]);
    const rgba = channelsToRgba(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), 2, 1, 3);
    assert.deepEqual([...rgba], [1, 2, 3, 4, 5, 6, 7, 8]);
});

// Screenshot crop-math tests — Phase 8a.
//
// `capturePostScreenshot` and `handleScreenshotCapture` cross
// chrome.runtime + chrome.tabs + Canvas + crypto.subtle, so they're
// validated end-to-end in the smoke test rather than unit tests.
//
// What we CAN unit-test in isolation: `computeCropBox`. That's the
// load-bearing math: the difference between "crop the right
// pixels" and "crop nothing" or "draw a black bar" is whether DPR
// scaling and viewport clamping are applied correctly. Pin every
// edge case the chrome.tabs.captureVisibleTab + Retina + scrolled
// viewport combination might produce.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCropBox } from '../src/shared/screenshot.js';

test('computeCropBox at DPR 1 returns rect rounded to ints', () => {
    const box = computeCropBox(
        { x: 100.4, y: 50.6, width: 200.5, height: 100.4 },
        1, 1920, 1080
    );
    assert.deepEqual(box, { x: 100, y: 51, width: 201, height: 100 });
});

test('computeCropBox at DPR 2 (Retina) doubles the rect', () => {
    const box = computeCropBox(
        { x: 100, y: 50, width: 200, height: 100 },
        2, 3840, 2160
    );
    assert.deepEqual(box, { x: 200, y: 100, width: 400, height: 200 });
});

test('computeCropBox clamps width/height to bitmap bounds', () => {
    // Element claims to be 500×500 starting at (1000,500), but the
    // bitmap is only 1200×800. Crop must stop at the edge.
    const box = computeCropBox(
        { x: 1000, y: 500, width: 500, height: 500 },
        1, 1200, 800
    );
    assert.equal(box.x, 1000);
    assert.equal(box.y, 500);
    assert.equal(box.width, 200);    // 1200 - 1000
    assert.equal(box.height, 300);   // 800 - 500
});

test('computeCropBox clamps negative x/y to zero (element scrolled past viewport top)', () => {
    const box = computeCropBox(
        { x: -50, y: -30, width: 200, height: 100 },
        1, 1920, 1080
    );
    assert.equal(box.x, 0);
    assert.equal(box.y, 0);
    // Width/height in the bitmap-pixel domain are the originally-
    // requested 200×100 (rect.width is in CSS px, not "from x").
    // Caller is responsible for re-aligning — computeCropBox doesn't
    // try to compensate for the offset.
    assert.equal(box.width, 200);
    assert.equal(box.height, 100);
});

test('computeCropBox returns null for zero-size rect', () => {
    assert.equal(computeCropBox({ x: 0, y: 0, width: 0, height: 100 }, 1, 100, 100), null);
    assert.equal(computeCropBox({ x: 0, y: 0, width: 100, height: 0 }, 1, 100, 100), null);
});

test('computeCropBox returns null for invalid inputs', () => {
    assert.equal(computeCropBox(null, 1, 100, 100), null);
    assert.equal(computeCropBox({ x: 0, y: 0, width: 10, height: 10 }, 0, 100, 100), null);
    assert.equal(computeCropBox({ x: 0, y: 0, width: 10, height: 10 }, 1, 0, 100), null);
    assert.equal(computeCropBox({ x: 0, y: 0, width: 10, height: 10 }, 1, 100, 0), null);
});

test('computeCropBox returns null when element is entirely past the bitmap edge', () => {
    // x is past bitmap width; clamping leaves zero-width crop.
    const box = computeCropBox(
        { x: 2000, y: 50, width: 200, height: 100 },
        1, 1200, 800
    );
    assert.equal(box, null);
});

test('computeCropBox at fractional DPR (1.5, common on some Linux + Windows scaled displays)', () => {
    const box = computeCropBox(
        { x: 100, y: 50, width: 200, height: 100 },
        1.5, 2880, 1620
    );
    // 100 * 1.5 = 150, etc.
    assert.deepEqual(box, { x: 150, y: 75, width: 300, height: 150 });
});

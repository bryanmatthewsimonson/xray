// Missing-API shims for the pinned pdf.js (pdf-collection-polyfill.js).
//
// pdf.js 6.x calls Map.getOrInsertComputed, Promise.try, Math.sumPrecise
// and Uint8Array.fromBase64/toBase64 unconditionally; all are absent
// from the Firefox 128 ESR floor (and from this node), so the shims ARE
// the implementation under test here. Promise.try matters most: it sits
// in pdf.js's MessageHandler — the main↔worker RPC every call crosses —
// so without the shim PDF capture is dead on Firefox 128–133 entirely.

import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/reader/pdf-collection-polyfill.js');

test('polyfill: Promise.try resolves sync values and calls with arguments', async () => {
    assert.equal(typeof Promise.try, 'function');
    assert.equal(await Promise.try((a, b) => a + b, 2, 3), 5);
});

test('polyfill: Promise.try turns a sync throw into a rejection', async () => {
    await assert.rejects(
        Promise.try(() => { throw new Error('sync boom'); }),
        /sync boom/);
});

test('polyfill: Promise.try unwraps returned promises', async () => {
    assert.equal(await Promise.try(() => Promise.resolve('ok')), 'ok');
});

test('polyfill: getOrInsertComputed computes once on miss, never on hit', () => {
    const m = new Map();
    let calls = 0;
    const make = (key) => { calls += 1; return key + '!'; };
    assert.equal(m.getOrInsertComputed('a', make), 'a!');
    assert.equal(m.getOrInsertComputed('a', make), 'a!');
    assert.equal(calls, 1);
});

test('polyfill: getOrInsertComputed inserts nothing when the callback throws', () => {
    const m = new Map();
    assert.throws(() => m.getOrInsertComputed('k', () => { throw new Error('nope'); }));
    assert.equal(m.has('k'), false);
});

test('polyfill: getOrInsert stores the default only on miss', () => {
    const m = new Map([['x', 1]]);
    assert.equal(m.getOrInsert('x', 99), 1);
    assert.equal(m.getOrInsert('y', 2), 2);
    assert.equal(m.get('y'), 2);
});

test('polyfill: Math.sumPrecise beats naive summation on cancellation', () => {
    // Naive left-to-right float addition loses the 1s against 1e100.
    assert.equal(Math.sumPrecise([1e100, 1, -1e100, 1]), 2);
    assert.equal(Math.sumPrecise([]), 0);
});

test('polyfill: Uint8Array base64 round-trips (the shapes pdf.js uses)', () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const b64 = bytes.toBase64();
    assert.equal(typeof b64, 'string');
    assert.deepEqual([...Uint8Array.fromBase64(b64)], [...bytes]);
    // Spec: ASCII whitespace in the input is ignored on decode.
    assert.deepEqual([...Uint8Array.fromBase64(' A A ==')], [...Uint8Array.fromBase64('AA==')]);
});

test('polyfill: Uint8Array.toHex — the worker fingerprints getter needs it on every load', () => {
    assert.equal(Uint8Array.from([0, 15, 16, 255]).toHex(), '000f10ff');
    assert.equal(new Uint8Array(0).toHex(), '');
});

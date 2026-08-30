// Margin S1 guards — MARGIN_DESIGN.md §5.4 + the flag-default pin.
// Idiom: positive sanity assertion first, then the enforcing negative
// (the constitution-guards convention; helpers stay test-local).
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { FLAGS_DEFAULTS } = await import('../src/shared/metadata/feature-flags.js');

test('guard: marginView defaults OFF (MARGIN_DESIGN §9 — S1 ships behind its own default-off flag)', () => {
    assert.ok(Object.prototype.hasOwnProperty.call(FLAGS_DEFAULTS, 'marginView'),
        'the marginView key is registered in FLAGS_DEFAULTS');
    assert.equal(FLAGS_DEFAULTS.marginView, false);
});

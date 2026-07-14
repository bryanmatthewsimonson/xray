// Phase 19.5 — the reader "Add fact" popover button is gated behind
// the `readerAddFact` feature flag, default OFF. This pins the
// hidden-by-default contract (and the flag's registration, which the
// Options setOverride call depends on — setOverride throws on an
// unknown flag).

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { FLAGS_DEFAULTS } = await import('../src/shared/metadata/feature-flags.js');

test('readerAddFact is a registered flag, default OFF', () => {
    assert.equal(
        Object.prototype.hasOwnProperty.call(FLAGS_DEFAULTS, 'readerAddFact'),
        true,
        'readerAddFact must be registered — Options setOverride rejects unknown flags'
    );
    assert.equal(FLAGS_DEFAULTS.readerAddFact, false,
        'the Add-fact popover row is opt-in; hidden until the user enables it');
});

// isLicensedEstimate (src/shared/estimate.js) — the one schema check
// RESET_PLAN §7 R1 adds with it. A licensed estimate carries
// `estimate: true`, a method, a spread and n; take any one away and it
// is not licensed.
//
// Provenance: R-019 (estimate, method, spread, n); non-blank method, whole n ≥ 1 and spread at n = 1: INTERPRETATION (2026-09-26) — expires 2026-12-25

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isLicensedEstimate } from '../src/shared/estimate.js';

test('schema: a licensed estimate carries estimate: true, a method, a spread and n — each one required', () => {
    const licensed = { estimate: true, method: 'average of the audited final scores', spread: { min: 40, max: 70 }, n: 3, value: 55 };
    assert.equal(isLicensedEstimate(licensed), true, 'sanity: the full shape passes');

    const without = (key) => { const o = { ...licensed }; delete o[key]; return o; };
    for (const key of ['estimate', 'method', 'spread', 'n']) {
        assert.equal(isLicensedEstimate(without(key)), false, `missing ${key}`);
    }
    assert.equal(isLicensedEstimate({ ...licensed, estimate: 'yes' }), false, 'estimate must be exactly true');
    assert.equal(isLicensedEstimate({ ...licensed, method: '  ' }), false, 'a blank method is no method');
    assert.equal(isLicensedEstimate({ ...licensed, spread: null }), false, 'a null spread is no spread');
    assert.equal(isLicensedEstimate({ ...licensed, n: 0 }), false, 'n counts at least one input');
    assert.equal(isLicensedEstimate({ ...licensed, n: 2.5 }), false, 'n is a whole number');
    for (const v of [null, undefined, 55, 'estimate', [licensed]]) {
        assert.equal(isLicensedEstimate(v), false, `not an object: ${JSON.stringify(v)}`);
    }
});

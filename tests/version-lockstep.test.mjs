// Version lockstep — pins scripts/check-version-lockstep.mjs (the ci.yml
// step that makes CLAUDE.md's "CI rejects a mismatch" true on every PR,
// RESET_PLAN §7 R0 / ROAD_TO_1_0 "Version lockstep is only checked after
// the immutable tag is pushed"). Synthetic inputs only: the real files
// are compared by the CI step, once, where the §8 gate order puts it.
//
// Provenance: INTERPRETATION (2026-09-25) — an agent artifact under
// RESET_PLAN R0; the maintainer has not ruled on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkVersions } from '../scripts/check-version-lockstep.mjs';

test('equal semver versions are in lockstep', () => {
    assert.deepEqual(checkVersions({ pkg: { version: '0.8.0' }, manifest: { version: '0.8.0' } }), []);
    assert.deepEqual(checkVersions({ pkg: { version: '1.0.0-rc.1' }, manifest: { version: '1.0.0-rc.1' } }), []);
});

test('a mismatch is red and names both versions and the fix', () => {
    const errors = checkVersions({ pkg: { version: '0.9.0' }, manifest: { version: '0.8.0' } });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /package\.json \(0\.9\.0\) and manifest\.json \(0\.8\.0\) disagree .*npm run version:set/);
});

test('a missing or non-semver version is red even when both sides agree', () => {
    assert.equal(checkVersions({ pkg: {}, manifest: {} }).length, 2);
    assert.equal(checkVersions({ pkg: { version: 'v0.8' }, manifest: { version: 'v0.8' } }).length, 2);
    assert.equal(checkVersions({ pkg: { version: '0.8.0' }, manifest: {} }).length, 2);
});

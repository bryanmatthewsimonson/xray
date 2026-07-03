// Build-info tests — the stamp formatter degrades segment by segment
// (raw source has no esbuild define and node has no chrome, so
// getBuildInfo() here exercises exactly the fallback path).

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { getBuildInfo, formatBuildInfo } = await import('../src/shared/build-info.js');

test('build-info: raw source (no define, no chrome) degrades to unknown', () => {
    const info = getBuildInfo();
    assert.deepEqual(info, { version: '', branch: null, commit: null, builtAt: null });
    assert.equal(formatBuildInfo(info), 'unknown build');
});

test('build-info: full stamp formats one line, segments degrade independently', () => {
    assert.equal(formatBuildInfo({
        version: '0.6.0', branch: 'claude/phase-15-x', commit: '88d4a66',
        builtAt: '2026-07-02T06:12:34.000Z'
    }), 'v0.6.0 · claude/phase-15-x @ 88d4a66 · built 2026-07-02 06:12 UTC');

    assert.equal(formatBuildInfo({ version: '0.6.0', branch: null, commit: null, builtAt: null }),
        'v0.6.0');
    assert.equal(formatBuildInfo({ version: '0.6.0', branch: null, commit: 'abc1234+dirty', builtAt: null }),
        'v0.6.0 · @ abc1234+dirty');
    assert.equal(formatBuildInfo({ version: '', branch: 'main', commit: 'abc', builtAt: 'not-a-date' }),
        'main @ abc', 'a garbage timestamp is dropped, not rendered');
});

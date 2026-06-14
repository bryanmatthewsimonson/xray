// Phase 13.1 — beats-v1 vocabulary (RQ8).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { BEATS, BEAT_ALIASES, BEATS_VERSION, isCanonicalBeat, normalizeBeat } from '../src/shared/audit/beats.js';

test('beats-v1: 24 canonical kebab-case slugs, maintainer-curated', () => {
    assert.equal(BEATS.length, 24);
    for (const slug of BEATS) {
        assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, `non-kebab slug: ${slug}`);
    }
    assert.ok(BEATS.includes('monetary-policy'));
    assert.ok(BEATS.includes('civil-asset-forfeiture'));
    assert.ok(BEATS.includes('ai'));
});

test('beats-v1: every alias maps to a canonical slug', () => {
    for (const [alias, target] of Object.entries(BEAT_ALIASES)) {
        assert.ok(isCanonicalBeat(target), `alias ${alias} → non-canonical ${target}`);
        assert.ok(!isCanonicalBeat(alias), `alias ${alias} must not itself be canonical`);
    }
});

test('normalizeBeat: canonical slugs pass through; aliases map', () => {
    assert.equal(normalizeBeat('bitcoin'), 'bitcoin');
    assert.equal(normalizeBeat('fed'), 'monetary-policy');
    assert.equal(normalizeBeat('federal-reserve'), 'monetary-policy');
    assert.equal(normalizeBeat('m2'), 'monetary-policy');
    assert.equal(normalizeBeat('btc'), 'bitcoin');
    assert.equal(normalizeBeat('lds'), 'religion');
    assert.equal(normalizeBeat('mormon'), 'religion');
});

test('normalizeBeat: cleans case, whitespace, underscores before lookup', () => {
    assert.equal(normalizeBeat('  Federal Reserve '), 'monetary-policy');
    assert.equal(normalizeBeat('MONETARY_POLICY'), 'monetary-policy');
    assert.equal(normalizeBeat('Tech Policy'), 'tech-policy');
});

test('normalizeBeat: crypto is DELIBERATELY not bitcoin (RQ8 verbatim)', () => {
    assert.equal(normalizeBeat('crypto'), null);
});

test('normalizeBeat: unmapped tags return null — review list, never a new beat', () => {
    assert.equal(normalizeBeat('monetarypolicy'), null);
    assert.equal(normalizeBeat('some-novel-topic'), null);
    assert.equal(normalizeBeat(''), null);
    assert.equal(normalizeBeat(null), null);
});

test('beats-v1.json artifact never drifts from the code vocabulary', async () => {
    const artifact = JSON.parse(await readFile(
        new URL('../src/shared/audit/beats-v1.json', import.meta.url), 'utf8'));
    assert.equal(artifact.version, BEATS_VERSION);
    assert.deepEqual(artifact.beats, [...BEATS]);
    assert.deepEqual(artifact.aliases, { ...BEAT_ALIASES });
    assert.ok(artifact.non_aliases && 'crypto' in artifact.non_aliases,
        'the deliberate crypto non-alias must stay documented in the artifact');
});

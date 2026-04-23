// Utils.normalizeUrl + getDomain tests — issue #9.
//
// normalizeUrl is the canonicalizer used to dedupe URL-keyed events
// (archive cache, kind-30023 lookups). Wrong normalization →
// duplicate cache entries or missed archive lookups, both painful
// and silent. Pin the behavior here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Utils } from '../src/shared/utils.js';

test('normalizeUrl strips utm_* and other tracking params', () => {
    const cases = [
        ['https://example.com/x?utm_source=foo', 'https://example.com/x'],
        ['https://example.com/x?utm_medium=a&utm_campaign=b', 'https://example.com/x'],
        ['https://example.com/x?fbclid=zzz', 'https://example.com/x'],
        ['https://example.com/x?gclid=qqq', 'https://example.com/x'],
        // Mixed: tracking stripped, real params kept.
        ['https://example.com/x?id=1&utm_source=foo', 'https://example.com/x?id=1']
    ];
    for (const [input, expected] of cases) {
        assert.equal(Utils.normalizeUrl(input), expected, `input: ${input}`);
    }
});

test('normalizeUrl strips fragment hash', () => {
    assert.equal(
        Utils.normalizeUrl('https://example.com/x#section-2'),
        'https://example.com/x'
    );
});

test('normalizeUrl lowercases hostname only (path stays case-sensitive)', () => {
    assert.equal(
        Utils.normalizeUrl('https://Example.COM/Path'),
        'https://example.com/Path'
    );
});

test('normalizeUrl strips default port for scheme', () => {
    assert.equal(Utils.normalizeUrl('https://example.com:443/x'), 'https://example.com/x');
    assert.equal(Utils.normalizeUrl('http://example.com:80/x'), 'http://example.com/x');
    // Non-default port preserved.
    assert.equal(Utils.normalizeUrl('https://example.com:8443/x'), 'https://example.com:8443/x');
});

test('normalizeUrl strips trailing slash on non-root paths', () => {
    assert.equal(Utils.normalizeUrl('https://example.com/x/'), 'https://example.com/x');
    // Root path keeps the slash.
    assert.equal(Utils.normalizeUrl('https://example.com/'), 'https://example.com/');
});

test('normalizeUrl returns input unchanged on parse failure', () => {
    assert.equal(Utils.normalizeUrl('not-a-url'), 'not-a-url');
    assert.equal(Utils.normalizeUrl(''), '');
});

test('getDomain strips www. prefix', () => {
    assert.equal(Utils.getDomain('https://www.example.com/x'), 'example.com');
    assert.equal(Utils.getDomain('https://example.com/x'), 'example.com');
    assert.equal(Utils.getDomain('https://sub.example.com/x'), 'sub.example.com');
});

test('escapeHtml protects against the canonical XSS payload', () => {
    const out = Utils.escapeHtml('<script>alert("x")</script>');
    assert.ok(!out.includes('<script>'), 'must not contain raw <script>');
    assert.ok(out.includes('&lt;script&gt;'), 'must encode < and >');
});

test('escapeHtml handles null/undefined safely', () => {
    assert.equal(Utils.escapeHtml(null), '');
    assert.equal(Utils.escapeHtml(undefined), '');
});

// API-interceptor pattern-match tests — Phase 8a.
//
// Pin the rules:
//   - empty patterns matches nothing
//   - urlIncludes alone matches on substring
//   - headerIncludes alone matches on any header value's substring
//   - both fields are AND'd within a pattern, OR'd across patterns
//   - Headers iterable can be Map/Object/Array; matcher must accept
//     any of them (because fetch's Headers vs init.headers shape
//     differs from XHR's accumulated request-header object)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesAnyPattern } from '../src/shared/api-pattern.js';

test('empty pattern set matches nothing', () => {
    assert.equal(matchesAnyPattern('https://x', {}, []), false);
    assert.equal(matchesAnyPattern('https://x', {}, undefined), false);
    assert.equal(matchesAnyPattern('https://x', {}, null), false);
});

test('urlIncludes matches when substring present', () => {
    const ps = [{ urlIncludes: '/api/graphql' }];
    assert.equal(matchesAnyPattern('https://www.facebook.com/api/graphql', {}, ps), true);
    assert.equal(matchesAnyPattern('https://www.facebook.com/feed/', {}, ps), false);
});

test('urlIncludes is case-sensitive', () => {
    const ps = [{ urlIncludes: '/api/GraphQL' }];
    assert.equal(matchesAnyPattern('https://x/api/graphql', {}, ps), false);
});

test('headerIncludes matches when any header value contains any needle', () => {
    const ps = [{ headerIncludes: ['CometFeedStory'] }];
    assert.equal(
        matchesAnyPattern('https://x', { 'x-fb-friendly-name': 'CometFeedStoryQuery' }, ps),
        true
    );
    assert.equal(
        matchesAnyPattern('https://x', { 'x-fb-friendly-name': 'OtherQuery' }, ps),
        false
    );
});

test('within a pattern, urlIncludes AND headerIncludes both required', () => {
    const ps = [{ urlIncludes: '/api/graphql', headerIncludes: ['FbFeedQuery'] }];
    // URL matches but header doesn't.
    assert.equal(
        matchesAnyPattern('https://x/api/graphql',
            { 'x-fb-friendly-name': 'OtherQuery' }, ps),
        false
    );
    // Header matches but URL doesn't.
    assert.equal(
        matchesAnyPattern('https://x/api/other',
            { 'x-fb-friendly-name': 'FbFeedQuery' }, ps),
        false
    );
    // Both match.
    assert.equal(
        matchesAnyPattern('https://x/api/graphql',
            { 'x-fb-friendly-name': 'FbFeedQuery' }, ps),
        true
    );
});

test('across patterns, any one matching wins', () => {
    const ps = [
        { urlIncludes: '/api/graphql' },
        { urlIncludes: '/api/comments' }
    ];
    assert.equal(matchesAnyPattern('https://x/api/comments?id=1', {}, ps), true);
});

test('accepts Map-style headers (Headers.entries)', () => {
    const headers = new Map([['x-fb-friendly-name', 'CometFeedStory']]);
    headers.entries = function* () { for (const e of Map.prototype.entries.call(this)) yield e; };
    const ps = [{ headerIncludes: ['CometFeedStory'] }];
    assert.equal(matchesAnyPattern('https://x', headers, ps), true);
});

test('accepts array-of-tuples headers', () => {
    const ps = [{ headerIncludes: ['needle'] }];
    assert.equal(matchesAnyPattern('https://x', [['x-thing', 'has needle here']], ps), true);
});

test('safely ignores non-string header values', () => {
    const ps = [{ headerIncludes: ['needle'] }];
    assert.equal(
        matchesAnyPattern('https://x', { 'x-thing': 42, 'x-other': null }, ps),
        false
    );
});

test('empty headerIncludes array means "no header constraint"', () => {
    const ps = [{ urlIncludes: '/x', headerIncludes: [] }];
    assert.equal(matchesAnyPattern('https://host/x', {}, ps), true);
});

// Responds-to tag (kind 30023 extension).
//
// Formerly tests/metadata-builders.test.mjs, which covered the five
// Phase-9a metadata builders retired 2026-08-09 (T3, ratified). Those
// 42 tests went with the builders; these seven stayed, because the
// responds-to TAG is live — emitted on every kind-30023 by
// event-builder.js:262-273. Only the flag of the same name was dead,
// and a grep-and-delete on "respondsTo" would have taken the wire
// feature with it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRespondsToTag,
  RESPONDS_TO_RELATIONSHIPS
} from '../src/shared/metadata/builders.js';

test('respondsTo: emits canonical 3-tuple form', () => {
  const t = buildRespondsToTag('https://example.com/a', 'rebuts');
  assert.deepEqual(t, ['responds-to', 'https://example.com/a', 'rebuts']);
});

test('respondsTo: emits 4-tuple with relay hint', () => {
  const t = buildRespondsToTag('nostr:naddr1xyz', 'extends', 'wss://relay.example');
  assert.deepEqual(t, ['responds-to', 'nostr:naddr1xyz', 'extends', 'wss://relay.example']);
});

test('respondsTo: normalizes URL targets', () => {
  const t = buildRespondsToTag('HTTPS://Example.COM/a?utm_source=x', 'supports');
  assert.equal(t[1], 'https://example.com/a');
});

test('respondsTo: leaves nostr: refs alone', () => {
  const t = buildRespondsToTag('nostr:naddr1abc', 'supports');
  assert.equal(t[1], 'nostr:naddr1abc');
});

test('respondsTo: rejects unknown relationship', () => {
  assert.throws(() => buildRespondsToTag('https://x', 'destroys'));
});

test('respondsTo: rejects missing target', () => {
  assert.throws(() => buildRespondsToTag('', 'rebuts'));
});

test('respondsTo: relationships set is exposed for UIs', () => {
  assert.deepEqual(
    [...RESPONDS_TO_RELATIONSHIPS].sort(),
    ['contextualizes', 'corrects', 'extends', 'rebuts', 'supports']
  );
});

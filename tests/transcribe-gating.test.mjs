// Which captures offer Transcribe. The predicate is deliberately
// generous — a false positive costs one clear "no media found at this
// URL" error, a false negative hides the feature on exactly the
// long-tail pages the wave exists for.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hasMediaSignal } from '../src/reader/transcribe-flow.js';

test('hasMediaSignal: a YouTube capture always qualifies', () => {
    assert.equal(hasMediaSignal({ platform: 'youtube', youtube: { videoId: 'abc123DEF45' } }), true);
});

test('hasMediaSignal: contentType video qualifies (tiktok, IG reels, FB video)', () => {
    assert.equal(hasMediaSignal({ platform: 'tiktok', contentType: 'video' }), true);
});

test('hasMediaSignal: a user-declared media type qualifies', () => {
    assert.equal(hasMediaSignal({ platform: 'substack', media: 'podcast' }), true);
});

test('hasMediaSignal: declared podcast identity qualifies', () => {
    assert.equal(hasMediaSignal({ podcast: { feed_guid: 'abc' } }), true);
});

test('hasMediaSignal: capture-time media hints qualify', () => {
    assert.equal(hasMediaSignal({ mediaHints: { audio: true, video: false, embeds: ['megaphone'] } }), true);
});

test('hasMediaSignal: a plain article does not', () => {
    assert.equal(hasMediaSignal({ platform: 'substack', contentType: 'article' }), false);
    assert.equal(hasMediaSignal(null), false);
});

test('hasMediaSignal: a capture with no URL never qualifies', () => {
    // Nothing to hand the companion — the flow would fail immediately.
    assert.equal(hasMediaSignal({ url: '', mediaHints: { audio: true, video: false, embeds: [] } }), false);
});

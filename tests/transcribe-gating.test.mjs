// Which captures offer Transcribe. The predicate is deliberately
// generous — a false positive costs one clear "no media found at this
// URL" error, a false negative hides the feature on exactly the
// long-tail pages the wave exists for. The one hard floor: the url
// must be a fetchable https:// address, because the companion's
// validate_media_url (media_url.py) admits https only — an http:// or
// file:// source (including the synthetic file:///imported/... identity
// a URL-less Phase-21 transcript import gets) would fail there every
// single time, so those never qualify regardless of any other signal.
//
// Fixtures below carry a realistic https url on every positive case —
// real captures always have one (every platform handler sets it), so
// omitting it here would test something that can't happen in practice.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hasMediaSignal } from '../src/reader/transcribe-flow.js';

test('hasMediaSignal: a YouTube capture always qualifies', () => {
    assert.equal(hasMediaSignal({
        url: 'https://www.youtube.com/watch?v=abc123DEF45',
        platform: 'youtube', youtube: { videoId: 'abc123DEF45' }
    }), true);
});

test('hasMediaSignal: contentType video qualifies (tiktok, IG reels, FB video)', () => {
    assert.equal(hasMediaSignal({
        url: 'https://www.tiktok.com/@user/video/123456',
        platform: 'tiktok', contentType: 'video'
    }), true);
});

test('hasMediaSignal: a user-declared media type qualifies', () => {
    assert.equal(hasMediaSignal({
        url: 'https://example.substack.com/p/an-episode',
        platform: 'substack', media: 'podcast'
    }), true);
});

test('hasMediaSignal: declared podcast identity qualifies', () => {
    assert.equal(hasMediaSignal({
        url: 'https://example.com/episodes/1',
        podcast: { feed_guid: 'abc' }
    }), true);
});

test('hasMediaSignal: capture-time media hints qualify', () => {
    assert.equal(hasMediaSignal({
        url: 'https://example.com/some-article',
        mediaHints: { audio: true, video: false, embeds: ['megaphone'] }
    }), true);
});

test('hasMediaSignal: a fileUrl-only hint qualifies (B1 — PowerPress download anchor, no <audio>/embed)', () => {
    assert.equal(hasMediaSignal({
        url: 'https://mormondiscussionpodcast.org/2026/08/some-episode/',
        mediaHints: { audio: true, video: false, embeds: [], fileUrl: 'https://media.blubrry.com/x/ep.mp3' }
    }), true);
});

test('hasMediaSignal: a plain article does not', () => {
    assert.equal(hasMediaSignal({
        url: 'https://example.substack.com/p/plain-post',
        platform: 'substack', contentType: 'article'
    }), false);
    assert.equal(hasMediaSignal(null), false);
});

test('hasMediaSignal: a capture with no URL never qualifies', () => {
    // Nothing to hand the companion — the flow would fail immediately.
    assert.equal(hasMediaSignal({ url: '', mediaHints: { audio: true, video: false, embeds: [] } }), false);
});

test('hasMediaSignal: a Phase-21 import with a synthetic file:// identity never qualifies', () => {
    // syntheticTranscriptUrl (transcript-article.js) gives a URL-less
    // pasted-transcript import a file:///imported/<hash>/<slug>.transcript
    // identity — truthy, and here even carrying a real podcast-identity
    // signal, but not something the companion (https-only) can ever
    // fetch. Pinned so this never regresses back to a guaranteed-failure
    // button.
    assert.equal(hasMediaSignal({
        url: 'file:///imported/abc123/episode.transcript',
        podcast: { feed_guid: 'abc' }
    }), false);
});

test('hasMediaSignal: an http:// URL does not qualify', () => {
    // The companion's validate_media_url rejects any non-https scheme
    // outright (media_url.py: "only https:// media URLs are supported"),
    // so http:// fails identically to file:// — offering the button
    // here would be just as guaranteed to fail.
    assert.equal(hasMediaSignal({
        url: 'http://example.com/episode.mp3',
        mediaHints: { audio: true, video: false, embeds: [] }
    }), false);
});

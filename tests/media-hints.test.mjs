// Capture-time media signals — what makes the reader offer Transcribe
// on a page that is not YouTube. Pure over a document-shaped stub: the
// house idiom for DOM code (no jsdom in this suite).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectMediaHints } from '../src/shared/media-hints.js';

/** Minimal document stub: selector → matching "elements". */
function docWith(map) {
    return {
        querySelectorAll: (sel) => map[sel] || [],
        querySelector: (sel) => (map[sel] || [])[0] || null
    };
}

test('detectMediaHints: null when the page has no media at all', () => {
    assert.equal(detectMediaHints(docWith({})), null);
});

test('detectMediaHints: a bare <audio> element is an audio signal', () => {
    const hints = detectMediaHints(docWith({ 'audio, video': [{ tagName: 'AUDIO' }] }));
    assert.deepEqual(hints, { audio: true, video: false, embeds: [] });
});

test('detectMediaHints: a <video> element is a video signal', () => {
    const hints = detectMediaHints(docWith({ 'audio, video': [{ tagName: 'VIDEO' }] }));
    assert.deepEqual(hints, { audio: false, video: true, embeds: [] });
});

test('detectMediaHints: a known player iframe is named, unknown ones are ignored', () => {
    const hints = detectMediaHints(docWith({
        'iframe[src]': [
            { getAttribute: () => 'https://www.youtube.com/embed/abc123DEF45' },
            { getAttribute: () => 'https://player.vimeo.com/video/1234' },
            { getAttribute: () => 'https://ads.example.com/banner' }
        ]
    }));
    assert.equal(hints.video, true);
    assert.deepEqual(hints.embeds, ['youtube', 'vimeo']);
});

test('detectMediaHints: a podcast player iframe reads as audio', () => {
    const hints = detectMediaHints(docWith({
        'iframe[src]': [{ getAttribute: () => 'https://player.megaphone.fm/ABC1234' }]
    }));
    assert.equal(hints.audio, true);
    assert.deepEqual(hints.embeds, ['megaphone']);
});

test('detectMediaHints: og:video / og:audio meta count as signals', () => {
    const video = detectMediaHints(docWith({
        'meta[property="og:video"], meta[property="og:video:url"]': [{ getAttribute: () => 'https://cdn.example/v.mp4' }]
    }));
    assert.equal(video.video, true);
    const audio = detectMediaHints(docWith({
        'meta[property="og:audio"], meta[property="og:audio:url"]': [{ getAttribute: () => 'https://cdn.example/a.mp3' }]
    }));
    assert.equal(audio.audio, true);
});

test('detectMediaHints: an empty meta content is not a signal', () => {
    assert.equal(detectMediaHints(docWith({
        'meta[property="og:video"], meta[property="og:video:url"]': [{ getAttribute: () => '' }]
    })), null);
});

test('detectMediaHints: embeds are deduplicated and capped', () => {
    const many = Array.from({ length: 40 }, () => ({
        getAttribute: () => 'https://www.youtube.com/embed/abc123DEF45'
    }));
    const hints = detectMediaHints(docWith({ 'iframe[src]': many }));
    assert.deepEqual(hints.embeds, ['youtube']);
});

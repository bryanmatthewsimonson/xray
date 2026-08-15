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

test('detectMediaHints: repeated embeds of the same player are deduplicated', () => {
    // Same host repeated many times — dedup must collapse it to one
    // label regardless of how many iframes carry it. Using a single
    // shared src (as this test previously did for BOTH dedup and the
    // scan cap) cannot by itself prove the cap does anything: dedup
    // alone already collapses the result to one entry. This test now
    // covers dedup only; the scan-cap regression lives in the
    // "ad-heavy page" test below, which uses DISTINCT hosts so nothing
    // but the scan itself can produce the right answer.
    const many = Array.from({ length: 40 }, () => ({
        getAttribute: () => 'https://www.youtube.com/embed/abc123DEF45'
    }));
    const hints = detectMediaHints(docWith({ 'iframe[src]': many }));
    assert.deepEqual(hints.embeds, ['youtube']);
});

test('detectMediaHints: every iframe on the page is scanned, not just the first N', () => {
    // Regression for a real false negative: the pre-fix MAX_IFRAMES=30
    // scan cap sliced the iframe list BEFORE matching, so a page with
    // 30+ ad/tracker iframes ahead of the actual player iframe returned
    // null — exactly an ad-heavy podcast page, the long-tail case this
    // feature exists for. 35 distinct unmatched hosts (so dedup cannot
    // mask a truncated scan) followed by one real, distinctly-hosted
    // player at index 35 — well past the old cap.
    const ads = Array.from({ length: 35 }, (_, i) => ({
        getAttribute: () => `https://ads${i}.example.com/slot`
    }));
    const real = { getAttribute: () => 'https://player.megaphone.fm/EP5678' };
    const hints = detectMediaHints(docWith({ 'iframe[src]': [...ads, real] }));
    assert.notEqual(hints, null);
    assert.equal(hints.audio, true);
    assert.deepEqual(hints.embeds, ['megaphone']);
});

test('detectMediaHints: a PowerPress-shaped page (mp3 download anchor, no player) yields a fileUrl hint', () => {
    // The smoke-failure fixture: no <audio>, no player iframe, no
    // og:audio/og:video — only "Play in new window" / "Download" anchors
    // pointing at the CDN file. B1 in
    // .superpowers/sdd/2026-08-13-transcribe-anywhere/smoke-failure-diagnosis.md.
    const mp3 = 'https://media.blubrry.com/mormondiscussions/ins.blubrry.com/mormondiscussions/EP.mp3';
    const hints = detectMediaHints(docWith({
        'a[href]': [
            { getAttribute: () => mp3, href: mp3, className: 'powerpress_link_pinw' },
            { getAttribute: () => mp3, href: mp3, className: 'powerpress_link_d' }
        ]
    }));
    assert.deepEqual(hints, { audio: true, video: false, embeds: [], fileUrl: mp3 });
});

test('detectMediaHints: an mp4 anchor is a video signal', () => {
    const mp4 = 'https://cdn.example.com/clip.mp4';
    const hints = detectMediaHints(docWith({
        'a[href]': [{ getAttribute: () => mp4, href: mp4 }]
    }));
    assert.deepEqual(hints, { audio: false, video: true, embeds: [], fileUrl: mp4 });
});

test('detectMediaHints: a query-stringed mp3 link still matches', () => {
    const url = 'https://cdn.example.com/ep.mp3?_=1';
    const hints = detectMediaHints(docWith({
        'a[href]': [{ getAttribute: () => url, href: url }]
    }));
    assert.equal(hints.audio, true);
    assert.equal(hints.fileUrl, url);
});

test('detectMediaHints: a plain .html link is not a media file', () => {
    const url = 'https://example.com/episode/transcript.html';
    assert.equal(detectMediaHints(docWith({
        'a[href]': [{ getAttribute: () => url, href: url }]
    })), null);
});

test('detectMediaHints: a link to a page merely mentioning media (mp3 in the query, not the path) does not match', () => {
    const url = 'https://example.com/watch?video=file.mp3';
    assert.equal(detectMediaHints(docWith({
        'a[href]': [{ getAttribute: () => url, href: url }]
    })), null);
});

test('detectMediaHints: a relative-only href (no absolute .href, stub getAttribute) is skipped, not guessed at', () => {
    assert.equal(detectMediaHints(docWith({
        'a[href]': [{ getAttribute: () => '/episode.mp3' }]
    })), null);
});

test('detectMediaHints: every anchor on the page is scanned — a late real link past many unmatched ones is still found', () => {
    // Equivalent of the iframe "35 ads then the real player" regression:
    // an ad-heavy podcast page's real download link can sit well past
    // whatever nav/social/tracker anchors precede it in the DOM. A
    // pre-slice cap here would reproduce exactly the B1 false negative.
    const decoys = Array.from({ length: 40 }, (_, i) => ({
        getAttribute: () => `https://example.com/page${i}.html`,
        href: `https://example.com/page${i}.html`
    }));
    const mp3 = 'https://media.blubrry.com/mormondiscussions/late-link.mp3';
    const real = { getAttribute: () => mp3, href: mp3 };
    const hints = detectMediaHints(docWith({ 'a[href]': [...decoys, real] }));
    assert.notEqual(hints, null);
    assert.equal(hints.audio, true);
    assert.equal(hints.fileUrl, mp3);
});

test('detectMediaHints: fileUrl records the FIRST match, not a later one', () => {
    const first = 'https://cdn.example.com/first.mp3';
    const second = 'https://cdn.example.com/second.mp4';
    const hints = detectMediaHints(docWith({
        'a[href]': [
            { getAttribute: () => first, href: first },
            { getAttribute: () => second, href: second }
        ]
    }));
    assert.equal(hints.audio, true);
    assert.equal(hints.video, true);
    assert.equal(hints.fileUrl, first);
});

test('detectMediaHints: many DISTINCT known players are all found, none masked by an earlier match', () => {
    // A page can legitimately embed several different players (a video
    // essay quoting a podcast clip, a roundup post, etc.). Every known
    // host present must be named — using DISTINCT hosts (not one
    // repeated) so dedup collapsing to a single entry can never make
    // this test pass vacuously the way the old shared-src fixture did.
    const iframes = [
        { getAttribute: () => 'https://player.vimeo.com/video/1234' },
        { getAttribute: () => 'https://rumble.com/embed/xyz' },
        { getAttribute: () => 'https://open.spotify.com/embed/episode/1' },
        { getAttribute: () => 'https://player.megaphone.fm/EP1' },
        { getAttribute: () => 'https://podbean.com/e/1' }
    ];
    const hints = detectMediaHints(docWith({ 'iframe[src]': iframes }));
    assert.notEqual(hints, null);
    assert.deepEqual(hints.embeds, ['vimeo', 'rumble', 'spotify', 'megaphone', 'podbean']);
});

// Transcript → article tests — Phase 21.1. The markdown body is the
// hash substrate, so its layout is pinned byte-exact.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// content-extractor → event-builder → storage probe chrome at load.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const {
    buildTranscriptMarkdown, buildTranscriptSection, buildTranscriptArticle,
    syntheticTranscriptUrl, computeTranscriptArticleHash
} = await import('../src/shared/transcript-article.js');

const TURNS = [
    { speaker: 'Alice Smith', startMs: 0, text: 'We sequenced it on the 30th.' },
    { speaker: 'Alice Smith', startMs: 5000, text: 'It matched the market samples.' },
    { speaker: 'Bob Jones', startMs: 12000, text: 'I disagree with that read.' }
];

test('buildTranscriptMarkdown: linked stamps + bold speakers + merged same-speaker turns (golden)', () => {
    const md = buildTranscriptMarkdown({
        turns: TURNS,
        meta: { title: 'Origins Debate', url: 'https://pod.example/ep1', show: 'The Show', format: 'speaker-lines' }
    });
    const expected = [
        '---',
        '**Podcast**: [Origins Debate](https://pod.example/ep1)',
        '**Show**: The Show',
        '**Transcript**: imported speaker-labeled · 2 turns · 2 speakers',
        '---',
        '',
        '## Transcript',
        '',
        '[`0:00`](https://pod.example/ep1#t=0) **Alice Smith:** We sequenced it on the 30th. It matched the market samples.',
        '',
        '[`0:12`](https://pod.example/ep1#t=12) **Bob Jones:** I disagree with that read.',
        ''
    ].join('\n');
    assert.equal(md, expected);
});

test('buildTranscriptMarkdown: no URL → plain code stamps, plain-title header', () => {
    const md = buildTranscriptMarkdown({
        turns: [{ speaker: 'Host', startMs: 63000, text: 'Welcome.' }],
        meta: { title: 'Ep', format: 'plain' }
    });
    assert.ok(md.includes('**Podcast**: Ep'));
    assert.ok(!md.includes(']('), 'no markdown links without a URL');
    assert.ok(md.includes('`1:03` **Host:** Welcome.'));
});

test('buildTranscriptMarkdown: speakerless turn has no bold label; no-stamp turn has no stamp', () => {
    const md = buildTranscriptMarkdown({
        turns: [{ speaker: null, startMs: null, text: 'Just some narration.' }],
        meta: { title: 'X', format: 'plain' }
    });
    assert.ok(md.includes('\nJust some narration.\n'));
    assert.ok(!md.includes('**:**'));
});

// --- buildTranscriptSection (Phase 22 — the reader-attach unit) ------

test('buildTranscriptSection: section-only output, linked stamps with a URL', () => {
    const section = buildTranscriptSection({
        turns: TURNS,
        meta: { url: 'https://pod.example/ep1' }
    });
    const expected = [
        '## Transcript',
        '',
        '[`0:00`](https://pod.example/ep1#t=0) **Alice Smith:** We sequenced it on the 30th. It matched the market samples.',
        '',
        '[`0:12`](https://pod.example/ep1#t=12) **Bob Jones:** I disagree with that read.',
        ''
    ].join('\n');
    assert.equal(section, expected);
    assert.ok(!section.includes('---'), 'no header block in the section');
});

test('buildTranscriptSection: bare stamps without a URL; no stamp without startMs', () => {
    const section = buildTranscriptSection({
        turns: [
            { speaker: 'Host', startMs: 63000, text: 'Welcome.' },
            { speaker: 'Guest', startMs: null, text: 'Thanks.' }
        ],
        meta: {}
    });
    assert.ok(section.includes('`1:03` **Host:** Welcome.'));
    assert.ok(section.includes('\n**Guest:** Thanks.'));
    assert.ok(!section.includes(']('));
});

test('buildTranscriptMarkdown composes over buildTranscriptSection (golden invariance)', () => {
    const args = {
        turns: TURNS,
        meta: { title: 'Origins Debate', url: 'https://pod.example/ep1', show: 'The Show', format: 'speaker-lines' }
    };
    const md = buildTranscriptMarkdown(args);
    assert.ok(md.endsWith(buildTranscriptSection(args)),
        'the full body must end with the exact section output');
});

test('buildTranscriptArticle: shape, contentType, podcast block, NO legacy transcript field', () => {
    const article = buildTranscriptArticle({
        turns: TURNS, speakers: ['Alice Smith', 'Bob Jones'], format: 'speaker-lines',
        meta: { title: 'Origins', url: 'https://pod.example/ep1#play', show: 'Show',
                feedGuid: 'ABC-123', itunesId: 999 }
    });
    assert.equal(article.contentType, 'transcript');
    assert.equal(article.platform, 'podcast');
    assert.equal(article.url, 'https://pod.example/ep1', 'fragment stripped');
    assert.equal(article.podcast.feed_guid, 'ABC-123');
    assert.equal(article.podcast.itunes_id, '999', 'coerced to string');
    assert.equal(article.podcast.episode_url, 'https://pod.example/ep1');
    assert.equal(article.transcript_meta.turn_count, 3);
    assert.equal(article.transcript_meta.speaker_count, 2);
    assert.equal(article.transcript, undefined, 'legacy string channel never set');
    assert.ok(article.content.includes('Alice Smith'));
});

test('buildTranscriptArticle: throws without a title', () => {
    assert.throws(() => buildTranscriptArticle({ turns: TURNS, meta: { url: 'https://x/y' } }), /title is required/);
});

test('syntheticTranscriptUrl: stable per text, differs across text, slug from title', async () => {
    const a = await syntheticTranscriptUrl('same text', 'My Episode!');
    const b = await syntheticTranscriptUrl('same text', 'My Episode!');
    const c = await syntheticTranscriptUrl('different text', 'My Episode!');
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.match(a, /^file:\/\/\/imported\/[0-9a-f]{16}\/my-episode\.transcript$/);
});

test('computeTranscriptArticleHash: stable, and changes when the body changes', async () => {
    const art1 = buildTranscriptArticle({ turns: TURNS, speakers: ['Alice Smith', 'Bob Jones'],
        format: 'speaker-lines', meta: { title: 'T', url: 'https://x/y' } });
    const h1 = await computeTranscriptArticleHash(art1);
    const h1b = await computeTranscriptArticleHash(art1);
    assert.equal(h1, h1b);
    assert.match(h1, /^[0-9a-f]{64}$/);
    const art2 = buildTranscriptArticle({ turns: [{ speaker: 'Z', startMs: 0, text: 'other' }],
        speakers: ['Z'], format: 'speaker-lines', meta: { title: 'T', url: 'https://x/y' } });
    assert.notEqual(h1, await computeTranscriptArticleHash(art2));
});

// Local transcription — the diarized-transcript composition layer.
// Pins: segments→turns mapping (speaker display names, null speakers),
// the YouTube &t=Ns link form, the MANDATORY `## Description — YouTube`
// rename (the relay round-trip trap), the suffixed section heading the
// Phase 22 upsert can never clobber, the offset→time map, and the
// Media-Fragments selector pair (builder + claim-model reader).

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const {
    speakerDisplayMap, turnsFromSegments, timeFragmentSelector, timeRangeOfSpan,
    diarizedHeading, buildDiarizedBody, diarizedTrackEntry, extractionMethodFor
} = await import('../src/shared/diarized-transcript.js');
const { timeRangeFromAnchor, pageFromAnchor } = await import('../src/shared/claim-model.js');
const { buildTranscriptSection, upsertTranscriptSection } = await import('../src/shared/transcript-article.js');

const WATCH = 'https://www.youtube.com/watch?v=abc123DEF45';

// A captured (skipTranscripts) composeMarkdownBody-shaped base body.
const CAPTURED = [
    '---',
    '**Video**: [T](https://www.youtube.com/watch?v=abc123DEF45)  ',
    '**Channel**: Chan  ',
    '**Video ID**: `abc123DEF45`',
    '---',
    '',
    '## Description',
    '',
    'A description with facts.',
    '',
    '## Tags',
    '',
    '`one` `two`'
].join('\n');

function segs() {
    return [
        { start: 0, end: 4.5, speaker: 'SPEAKER_00', text: 'Hello there, welcome to the show.' },
        { start: 4.5, end: 9.25, speaker: 'SPEAKER_01', text: 'Thanks for having me on today.' },
        { start: 9.25, end: 15, speaker: 'SPEAKER_00', text: 'Let us start with the big claim.' },
        { start: 15, end: 18, speaker: null, text: '[applause] indistinct crosstalk' }
    ];
}

test('speakerDisplayMap: first-appearance order, nulls never mapped', () => {
    const m = speakerDisplayMap(segs());
    assert.equal(m.get('SPEAKER_00'), 'Speaker 1');
    assert.equal(m.get('SPEAKER_01'), 'Speaker 2');
    assert.equal(m.size, 2);
});

test('turnsFromSegments: seconds→ms, display names, null speakers preserved', () => {
    const turns = turnsFromSegments(segs());
    assert.equal(turns.length, 4);
    assert.deepEqual(
        turns.map((t) => t.speaker),
        ['Speaker 1', 'Speaker 2', 'Speaker 1', null]);
    assert.equal(turns[1].startMs, 4500);
    assert.equal(turns[1].endMs, 9250);
    // Empty text is skipped, never emitted as a blank turn.
    assert.equal(turnsFromSegments([{ start: 0, end: 1, speaker: 'SPEAKER_00', text: '  ' }]).length, 0);
});

test('timeFragmentSelector: W3C Media-Fragments shape, ms precision, no trailing zeros', () => {
    assert.deepEqual(timeFragmentSelector(12, 45.5), {
        type: 'FragmentSelector',
        conformsTo: 'http://www.w3.org/TR/media-frags/',
        value: 't=12,45.5'
    });
    assert.equal(timeFragmentSelector(0, 0.1234).value, 't=0,0.123');
});

test('timeRangeFromAnchor: strict read-back; unknown selectors skipped both ways', () => {
    const anchor = [
        { type: 'TextQuoteSelector', exact: 'q' },
        timeFragmentSelector(12, 45.5)
    ];
    assert.deepEqual(timeRangeFromAnchor(anchor), { startSec: 12, endSec: 45.5 });
    // The page reader skips the time selector; the time reader skips page=.
    assert.equal(pageFromAnchor(anchor), null);
    assert.equal(timeRangeFromAnchor([{ type: 'FragmentSelector', value: 'page=3' }]), null);
    // Strict form only — a start-only or malformed t= is unknown.
    assert.equal(timeRangeFromAnchor([{ type: 'FragmentSelector', value: 't=12' }]), null);
    assert.equal(timeRangeFromAnchor([{ type: 'FragmentSelector', value: 't=a,b' }]), null);
    assert.equal(timeRangeFromAnchor(null), null);
});

test('timeRangeOfSpan: covers the full span across paragraphs', () => {
    const map = [
        { start: 0, end: 100, startSec: 0, endSec: 10 },
        { start: 102, end: 200, startSec: 10, endSec: 20 },
        { start: 202, end: 300, startSec: 20, endSec: 30 }
    ];
    assert.deepEqual(timeRangeOfSpan(map, 50, 60), { startSec: 0, endSec: 10 });
    assert.deepEqual(timeRangeOfSpan(map, 90, 210), { startSec: 0, endSec: 30 });
    // Caret (zero-width) span inside a paragraph still resolves.
    assert.deepEqual(timeRangeOfSpan(map, 150, 150), { startSec: 10, endSec: 20 });
    assert.equal(timeRangeOfSpan(map, 400, 410), null);
    assert.equal(timeRangeOfSpan([], 0, 10), null);
});

test('diarizedHeading: language label when known, bare local form otherwise', () => {
    assert.equal(diarizedHeading('en'), 'Transcript — English (local, diarized)');
    assert.equal(diarizedHeading(''), 'Transcript — local (diarized)');
});

test('buildDiarizedBody: Description renamed, suffixed heading, &t=Ns links, speakers bolded', () => {
    const { markdown, transcriptMeta, heading } = buildDiarizedBody({
        capturedMarkdown: CAPTURED, watchUrl: WATCH,
        result: { language: 'en', segments: segs() }
    });
    // 1. The relay round-trip trap: the bare heading must be GONE
    //    (reconstructArticleFromEvent cuts bare `## Description` and
    //    assembleArticleBody re-appends it only for contentType video).
    assert.ok(!/^## Description$/m.test(markdown), 'bare Description heading must not survive');
    assert.ok(markdown.includes('## Description — YouTube'), 'renamed heading present');
    assert.ok(markdown.includes('A description with facts.'), 'description body intact');
    // 2. Suffixed transcript heading.
    assert.ok(markdown.includes(`## ${heading}`), 'suffixed heading present');
    assert.equal(heading, 'Transcript — English (local, diarized)');
    // 3. YouTube deep-link form on the watch URL (&t=Ns, not #t=).
    assert.ok(markdown.includes(`](${WATCH}&t=0s)`), '&t=Ns link form');
    assert.ok(!markdown.includes('#t='), 'no media-fragment #t= links on YouTube');
    // 4. Speaker labels; the unassigned segment stays unlabeled.
    assert.ok(markdown.includes('**Speaker 1:**'));
    assert.ok(markdown.includes('**Speaker 2:**'));
    assert.deepEqual(transcriptMeta, {
        format: 'diarized', turn_count: 4, speaker_count: 2,
        speakers: ['Speaker 1', 'Speaker 2']
    });
});

test('buildDiarizedBody: native transcript sections are dropped, prior versions carry them', () => {
    const withNative = CAPTURED + '\n\n## Transcript — English (auto-generated, origin language)\n\n'
        + '[`0:00`](https://www.youtube.com/watch?v=abc123DEF45&t=0s) old unlabeled cues here\n';
    const { markdown } = buildDiarizedBody({
        capturedMarkdown: withNative, watchUrl: WATCH,
        result: { language: 'en', segments: segs() }
    });
    assert.ok(!markdown.includes('old unlabeled cues here'), 'native auto-cue section superseded');
    assert.ok(markdown.includes('**Speaker 1:**'), 'diarized section present');
});

test('buildDiarizedBody: timeMap offsets index the FINAL markdown exactly', () => {
    const { markdown, timeMap } = buildDiarizedBody({
        capturedMarkdown: CAPTURED, watchUrl: WATCH,
        result: { language: 'en', segments: segs() }
    });
    assert.ok(timeMap.length > 0);
    for (const e of timeMap) {
        const slice = markdown.slice(e.start, e.end);
        assert.ok(slice.startsWith('[`'), 'entry starts at its rendered paragraph');
        assert.ok(e.startSec != null);
    }
    // Paragraph end times survive the merge (last contributing turn).
    const last = timeMap[timeMap.length - 1];
    assert.equal(last.endSec, 18);
});

test('buildDiarizedBody: throws on empty segments (never adopt an empty body)', () => {
    assert.throws(() => buildDiarizedBody({
        capturedMarkdown: CAPTURED, watchUrl: WATCH, result: { segments: [] }
    }), /no usable segments/);
});

test('the Phase 22 bare-heading upsert can never clobber the diarized section', () => {
    const { markdown } = buildDiarizedBody({
        capturedMarkdown: CAPTURED, watchUrl: WATCH,
        result: { language: 'en', segments: segs() }
    });
    const attached = upsertTranscriptSection(markdown, '## Transcript\n\npasted attach\n');
    assert.ok(attached.includes('**Speaker 1:**'), 'diarized section survives an attach');
    assert.ok(attached.includes('pasted attach'), 'the attach landed as its own section');
});

test('buildTranscriptSection defaults are byte-stable (options must not drift Phase 22 output)', () => {
    const turns = [
        { speaker: 'Alice', startMs: 723000, text: 'Hello.' },
        { speaker: 'Bob', startMs: 821000, text: 'Hi.' }
    ];
    const out = buildTranscriptSection({ turns, meta: { url: 'https://x.example/e' } });
    assert.equal(out,
        '## Transcript\n\n'
        + '[`12:03`](https://x.example/e#t=723) **Alice:** Hello.\n\n'
        + '[`13:41`](https://x.example/e#t=821) **Bob:** Hi.\n');
});

test('diarizedTrackEntry: events populated (the transcript_lang gate), durations derived', () => {
    const entry = diarizedTrackEntry({ language: 'en', segments: segs() });
    assert.equal(entry.kind, 'whisperx');
    assert.equal(entry.role, 'local-diarized');
    assert.equal(entry.languageCode, 'en');
    assert.equal(entry.events.length, 4);
    assert.deepEqual(entry.events[0], { startMs: 0, durationMs: 4500, text: 'Hello there, welcome to the show.' });
});

test('extractionMethodFor: whisperx + shortened diarization model', () => {
    assert.equal(extractionMethodFor({
        asr_model: 'large-v3',
        diarization_model: 'pyannote/speaker-diarization-community-1'
    }), 'whisperx-large-v3+pyannote-community-1');
    assert.equal(extractionMethodFor(null), 'whisperx-large-v3+pyannote');
});

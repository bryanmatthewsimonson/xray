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
    diarizedHeading, buildDiarizedBody, diarizedTrackEntry, extractionMethodFor,
    providerDisplayName, capturedBodyFor
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
        capturedMarkdown: CAPTURED, mediaUrl: WATCH, platform: 'youtube',
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
        capturedMarkdown: withNative, mediaUrl: WATCH, platform: 'youtube',
        result: { language: 'en', segments: segs() }
    });
    assert.ok(!markdown.includes('old unlabeled cues here'), 'native auto-cue section superseded');
    assert.ok(markdown.includes('**Speaker 1:**'), 'diarized section present');
});

test('buildDiarizedBody: timeMap offsets index the FINAL markdown exactly', () => {
    const { markdown, timeMap } = buildDiarizedBody({
        capturedMarkdown: CAPTURED, mediaUrl: WATCH, platform: 'youtube',
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
        capturedMarkdown: CAPTURED, mediaUrl: WATCH, platform: 'youtube', result: { segments: [] }
    }), /no usable segments/);
});

test('the Phase 22 bare-heading upsert can never clobber the diarized section', () => {
    const { markdown } = buildDiarizedBody({
        capturedMarkdown: CAPTURED, mediaUrl: WATCH, platform: 'youtube',
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
    // An explicit local provider stamp (newer companions) changes nothing.
    assert.equal(extractionMethodFor({
        provider: 'local', asr_model: 'large-v3',
        diarization_model: 'pyannote/speaker-diarization-community-1'
    }), 'whisperx-large-v3+pyannote-community-1');
});

test('extractionMethodFor: cloud providers publish one <provider>-<model> token', () => {
    assert.equal(
        extractionMethodFor({ provider: 'assemblyai', asr_model: 'universal' }),
        'assemblyai-universal');
    assert.equal(
        extractionMethodFor({ provider: 'deepgram', asr_model: 'nova-3' }),
        'deepgram-nova-3');
    // Token charset is enforced on the published value.
    assert.equal(
        extractionMethodFor({ provider: 'deepgram', asr_model: 'Nova 3!' }),
        'deepgram-nova-3');
    assert.equal(extractionMethodFor({ provider: 'assemblyai' }), 'assemblyai-unknown');
});

test('providerDisplayName: cloud names, local/absent null, unknown names itself', () => {
    assert.equal(providerDisplayName('assemblyai'), 'AssemblyAI');
    assert.equal(providerDisplayName('deepgram'), 'Deepgram');
    assert.equal(providerDisplayName('local'), null);
    assert.equal(providerDisplayName('whisperx'), null);
    assert.equal(providerDisplayName(''), null);
    assert.equal(providerDisplayName(undefined), null);
    assert.equal(providerDisplayName('otherco'), 'otherco');
});

test('diarizedHeading: cloud providers are named — the body is durable, "local" would lie', () => {
    assert.equal(diarizedHeading('en', 'assemblyai'), 'Transcript — English (AssemblyAI, diarized)');
    assert.equal(diarizedHeading('', 'deepgram'), 'Transcript — Deepgram (diarized)');
    assert.equal(diarizedHeading('en', 'local'), 'Transcript — English (local, diarized)');
});

test('buildDiarizedBody: a cloud result names its provider in the heading', () => {
    const { markdown, heading } = buildDiarizedBody({
        capturedMarkdown: CAPTURED, mediaUrl: WATCH, platform: 'youtube',
        result: {
            language: 'en', segments: segs(),
            model_info: { provider: 'assemblyai', asr_model: 'universal' }
        }
    });
    assert.equal(heading, 'Transcript — English (AssemblyAI, diarized)');
    assert.ok(markdown.includes('## Transcript — English (AssemblyAI, diarized)'));
});

test('diarizedTrackEntry: cloud runs name the engine, keep the replace-slot role', () => {
    const entry = diarizedTrackEntry({
        language: 'en', segments: segs(),
        model_info: { provider: 'deepgram', asr_model: 'nova-3' }
    });
    assert.equal(entry.kind, 'deepgram');
    assert.equal(entry.displayName, 'Deepgram (diarized, en)');
    assert.equal(entry.role, 'local-diarized');
    assert.equal(entry.events.length, 4);
});

test('buildDiarizedBody: a generic media URL gets #t= links and no Description rename', () => {
    const EPISODE = 'https://mormonstories.org/podcast/ep-1/';
    const captured = '# Episode 1\n\n## Description\n\nShow notes here.\n';
    const { markdown, heading } = buildDiarizedBody({
        capturedMarkdown: captured, mediaUrl: EPISODE, platform: 'podcast',
        result: { language: 'en', segments: segs() }
    });
    // The YouTube-only round-trip rename must NOT fire off YouTube.
    assert.ok(/^## Description$/m.test(markdown), 'bare Description heading left alone');
    assert.ok(!markdown.includes('## Description — YouTube'), 'no YouTube rename off YouTube');
    // Generic Media-Fragments deep links, never the &t=Ns form.
    assert.ok(markdown.includes(`](${EPISODE}#t=0)`), 'generic #t= link form');
    assert.ok(!markdown.includes('&t=0s'), 'no YouTube &t=Ns links off YouTube');
    // The suffixed heading still protects against a later paste-attach.
    assert.equal(heading, 'Transcript — English (local, diarized)');
    assert.ok(markdown.includes(`## ${heading}`));
});

test('buildDiarizedBody: the legacy watchUrl parameter still works', () => {
    const { markdown } = buildDiarizedBody({
        capturedMarkdown: CAPTURED, watchUrl: WATCH, platform: 'youtube',
        result: { language: 'en', segments: segs() }
    });
    assert.ok(markdown.includes(`](${WATCH}&t=0s)`));
});

test('adoption APPENDS the transcript — the captured body survives verbatim', () => {
    // Field question 2026-08-16: "the transcription appears to completely
    // replace the article content rather than being added to it."
    // The composer does not: base is preserved and the section appended.
    // Locked explicitly, because the show notes on a podcast capture are
    // the only human-written context the transcript sits in, and losing
    // them silently would be a content-loss bug rather than a display one.
    const base = [
        '# Episode 6: Healing',
        '',
        'What does healing look like after childhood sexual abuse?',
        '',
        'Episode Transcript: https://drive.google.com/file/d/abc/view',
        '',
        'Additional resources at ArchitectureOfAbuse.com'
    ].join('\n');
    const { markdown } = buildDiarizedBody({
        capturedMarkdown: base,
        mediaUrl: 'https://cdn.example.com/ep.mp3',
        platform: '',
        result: {
            language: 'en',
            segments: [{ start: 1, end: 2, speaker: 'SPEAKER_00', text: 'Hi.' }],
            model_info: { provider: 'deepgram' }
        }
    });
    // Every line of the capture is still there, in order, before the
    // transcript heading.
    const cut = markdown.indexOf('## Transcript');
    assert.ok(cut > 0, 'the transcript section must be appended, not prepended');
    const head = markdown.slice(0, cut);
    for (const line of base.split('\n').filter(Boolean)) {
        assert.ok(head.includes(line), `the capture lost: ${line}`);
    }
    assert.match(markdown, /## Transcript — English \(Deepgram, diarized\)/);
});

test('a RE-transcription replaces only the prior transcript section', () => {
    // The one thing adoption is allowed to remove. Everything above the
    // old heading must survive a second run.
    const base = '# Ep\n\nShow notes that must survive.\n\n'
        + '## Transcript — English (AssemblyAI, diarized)\n\nold turn text\n';
    const { markdown } = buildDiarizedBody({
        capturedMarkdown: base,
        mediaUrl: 'https://cdn.example.com/ep.mp3',
        platform: '',
        result: {
            language: 'en',
            segments: [{ start: 1, end: 2, speaker: 'SPEAKER_00', text: 'New.' }],
            model_info: { provider: 'deepgram' }
        }
    });
    assert.ok(markdown.includes('Show notes that must survive.'), 'the capture was dropped');
    assert.ok(!markdown.includes('old turn text'), 'the prior transcript should be replaced');
    assert.ok(!markdown.includes('(AssemblyAI, diarized)'));
    assert.match(markdown, /\(Deepgram, diarized\)/);
});

// ------------------------------------------------------------------
// The captured body a transcript composes ONTO.
//
// Field-found 2026-08-16: a transcribed podcast episode lost its entire
// show notes — in the Markdown tab, not just the render. The cause is
// upstream of every transcript path: `content-extractor.js` keeps
// `content` as HTML at capture time and lets markdown "happen
// downstream", so a GENERIC capture (Readability — which is every
// podcast page) carries no `.markdown` at all. Adoption read
// `a.markdown || ''` and therefore composed onto an EMPTY base,
// silently discarding the article.
//
// It was invisible until now because the companion path was
// YouTube-first, and the YouTube handler composes its own markdown.
// Direct cloud transcription made podcast pages the main case.
// ------------------------------------------------------------------

test('capturedBodyFor: a capture with markdown uses it verbatim', () => {
    assert.equal(capturedBodyFor({ markdown: '# Kept', content: '<p>ignored</p>' }, () => 'WRONG'),
        '# Kept');
});

test('capturedBodyFor: a capture with only HTML is converted, never dropped', () => {
    // The bug. Before the fix this returned '' and the transcript
    // replaced the article.
    const html = '<p>Show notes that must survive.</p>';
    assert.equal(capturedBodyFor({ content: html }, (h) => `MD(${h})`), `MD(${html})`);
});

test('capturedBodyFor: an empty capture is empty, not a crash', () => {
    assert.equal(capturedBodyFor({}, () => 'x'), '');
    assert.equal(capturedBodyFor(null, () => 'x'), '');
    assert.equal(capturedBodyFor({ content: '<p>hi</p>' }, null), '');
});

test('a transcript composed onto an HTML-only capture keeps the body', () => {
    // End to end through the composer, which is what adoption calls.
    const body = capturedBodyFor(
        { content: '<p>What does healing look like after childhood sexual abuse?</p>' },
        (h) => h.replace(/<\/?p>/g, '')
    );
    const { markdown } = buildDiarizedBody({
        capturedMarkdown: body,
        mediaUrl: 'https://cdn.example.com/ep.mp3',
        platform: '',
        result: {
            language: 'en',
            segments: [{ start: 1, end: 2, speaker: 'SPEAKER_00', text: 'Hi.' }],
            model_info: { provider: 'deepgram' }
        }
    });
    assert.ok(markdown.includes('What does healing look like'),
        'the captured article must survive a transcription');
    assert.ok(markdown.indexOf('What does healing') < markdown.indexOf('## Transcript'));
});

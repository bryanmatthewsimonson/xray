// Transcript parser tests — Phase 21.1. Pure: no chrome, no DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
    detectTranscriptFormat, parseTranscript, parseTimestampMs, speakerFromParagraphText
} = await import('../src/shared/transcript-parse.js');

// ---- timestamps ---------------------------------------------------

test('parseTimestampMs: all accepted grammars', () => {
    assert.equal(parseTimestampMs('00:01:02,500'), 62500);   // SRT comma
    assert.equal(parseTimestampMs('00:01:02.500'), 62500);   // VTT dot
    assert.equal(parseTimestampMs('01:02.5'), 62500);        // MM:SS.mmm, right-padded
    assert.equal(parseTimestampMs('1:02:03'), 3723000);      // H:MM:SS
    assert.equal(parseTimestampMs('12:03'), 723000);         // MM:SS
    assert.equal(parseTimestampMs('1:2:3:4'), null);         // rejected
    assert.equal(parseTimestampMs('nope'), null);
});

// ---- format detection --------------------------------------------

test('detectTranscriptFormat: VTT with and without BOM', () => {
    assert.equal(detectTranscriptFormat('WEBVTT\n\n00:00.000 --> 00:02.000\nHi'), 'vtt');
    assert.equal(detectTranscriptFormat('﻿WEBVTT\n\n00:00.000 --> 00:02.000\nHi'), 'vtt');
});

test('detectTranscriptFormat: SRT via arrow timing (header-less VTT too)', () => {
    assert.equal(detectTranscriptFormat('1\n00:00:00,000 --> 00:00:02,000\nHi'), 'srt');
    assert.equal(detectTranscriptFormat('00:00.000 --> 00:02.000\nHi there'), 'srt');
});

test('detectTranscriptFormat: prose with a lone "Note:" is NOT speaker-lines', () => {
    const prose = 'Note: this is a preface.\n\nThe rest is ordinary prose with no speakers at all, '
        + 'running for several sentences. It should read as plain text.';
    assert.equal(detectTranscriptFormat(prose), 'plain');
});

test('detectTranscriptFormat: a two-speaker interview is speaker-lines', () => {
    const t = 'Host: Welcome.\nGuest: Thanks for having me.\nHost: Let us begin.';
    assert.equal(detectTranscriptFormat(t), 'speaker-lines');
});

// ---- SRT ----------------------------------------------------------

test('parseTranscript: SRT label sets speaker and carries to unlabeled cues', () => {
    const srt = [
        '1', '00:00:00,000 --> 00:00:02,000', '- ALICE: We sequenced it.',
        '', '2', '00:00:02,000 --> 00:00:04,000', 'It matched the market samples.',
        '', '3', '00:00:04,000 --> 00:00:06,000', 'BOB: I disagree.'
    ].join('\n');
    const { format, turns, speakers } = parseTranscript(srt);
    assert.equal(format, 'srt');
    assert.equal(turns[0].speaker, 'ALICE');
    assert.equal(turns[0].startMs, 0);
    assert.equal(turns[1].speaker, 'ALICE', 'unlabeled cue carries the prior speaker');
    assert.equal(turns[2].speaker, 'BOB');
    assert.deepEqual(speakers, ['ALICE', 'BOB']);
});

test('parseTranscript: SRT strips inline markup', () => {
    const srt = '1\n00:00:00,000 --> 00:00:02,000\n<i>Hello</i> <b>world</b>';
    const { turns } = parseTranscript(srt);
    assert.equal(turns[0].text, 'Hello world');
});

// ---- WebVTT -------------------------------------------------------

test('parseTranscript: VTT voice tags, multi-voice split, NOTE skipped', () => {
    const vtt = [
        'WEBVTT', '', 'NOTE this is metadata', '',
        '00:00:00.000 --> 00:00:03.000', '<v Alice>We sequenced it.</v>',
        '', '00:00:03.000 --> 00:00:06.000', '<v Alice>Right.</v> <v Bob>No.</v>'
    ].join('\n');
    const { format, turns, speakers } = parseTranscript(vtt);
    assert.equal(format, 'vtt');
    assert.equal(turns[0].speaker, 'Alice');
    assert.equal(turns[0].text, 'We sequenced it.');
    // multi-voice cue at 00:00:03.000 → two turns, same startMs.
    const t2 = turns.filter((t) => t.startMs === 3000);
    assert.equal(t2.length, 2);
    assert.deepEqual(t2.map((t) => t.speaker), ['Alice', 'Bob']);
    assert.deepEqual(speakers, ['Alice', 'Bob']);
});

test('parseTranscript: VTT karaoke stamps stripped', () => {
    const vtt = 'WEBVTT\n\n00:00.000 --> 00:02.000\n<00:00:00.500>Hello <00:00:01.000>world';
    const { turns } = parseTranscript(vtt);
    assert.equal(turns[0].text, 'Hello world');
});

// ---- speaker-lines ------------------------------------------------

test('parseTranscript: the three speaker-line patterns + continuation', () => {
    const t = [
        '[12:03] Alice Smith: opening statement',      // P1
        'and a continuation line',                     // appends
        'Bob Jones [12:30]: a reply',                  // P2
        'DR. FAUCI: a third voice'                     // P3
    ].join('\n');
    const { turns, speakers } = parseTranscript(t);
    assert.equal(turns[0].speaker, 'Alice Smith');
    assert.equal(turns[0].startMs, 723000);
    assert.equal(turns[0].text, 'opening statement and a continuation line');
    assert.equal(turns[1].speaker, 'Bob Jones');
    assert.equal(turns[1].startMs, 750000);
    assert.equal(turns[2].speaker, 'DR. FAUCI');
    assert.deepEqual(speakers, ['Alice Smith', 'Bob Jones', 'DR. FAUCI']);
});

test('parseTranscript: blank line closes a turn, same speaker continues', () => {
    const t = 'Alice: first paragraph.\n\nsecond paragraph, still Alice.\n\nBob: over to me.';
    const { turns } = parseTranscript(t);
    assert.equal(turns[0].speaker, 'Alice');
    assert.equal(turns[0].text, 'first paragraph.');
    assert.equal(turns[1].speaker, 'Alice', 'unlabeled paragraph after a blank keeps the speaker');
    assert.equal(turns[1].text, 'second paragraph, still Alice.');
    assert.equal(turns[2].speaker, 'Bob');
});

// ---- plain --------------------------------------------------------

test('parseTranscript: plain paragraphs become speakerless turns + a warning', () => {
    const t = 'A first paragraph of prose.\n\nA second paragraph.';
    const { format, turns, speakers, warnings } = parseTranscript(t);
    assert.equal(format, 'plain');
    assert.equal(turns.length, 2);
    assert.equal(turns[0].speaker, null);
    assert.deepEqual(speakers, []);
    assert.ok(warnings.includes('no speakers detected'));
});

// ---- speakerFromParagraphText (reader prefill seam) ---------------

test('speakerFromParagraphText: extracts the leading label, tolerates a stamp', () => {
    assert.equal(speakerFromParagraphText('Alice Smith: hello there'), 'Alice Smith');
    assert.equal(speakerFromParagraphText('12:03 Alice Smith: hello'), 'Alice Smith');
    assert.equal(speakerFromParagraphText('just some prose, no label'), null);
});

test('speakerFromParagraphText: knownSpeakers gates the match', () => {
    assert.equal(speakerFromParagraphText('Bob: hi', ['Alice', 'Bob']), 'Bob');
    assert.equal(speakerFromParagraphText('Carol: hi', ['Alice', 'Bob']), null);
    // ≤6-word gate rejects a long bold-leading prose sentence.
    assert.equal(speakerFromParagraphText('This is a very long leading clause indeed: text'), null);
});

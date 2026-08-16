// Provider normalizer — the JS twin of the companion's
// providers/normalize.py, and the parity that keeps them one contract.
//
// Guard-rail 2 of docs/DIRECT_CLOUD_TRANSCRIBE_KICKOFF.md: two
// implementations of one contract, in two languages, maintained
// forever. Drift here is NOT cosmetic — the segment boundaries decide
// the composed body bytes (and therefore the published `x` content
// address) and the t=<start>,<end> values inside kind-30040 claim
// anchors. So the expected values below are not authored here: they
// live in tests/fixtures/normalizer-parity.json, OBSERVED by running
// normalize.py (tests/tools/regen-normalizer-fixture.py), and the same
// file is read by companion/transcriber/tests/test_shared_fixtures.py.
//
// This module must import with no chrome stub and touch no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Tripwire: a pure normalizer that reaches the network is a bug no
// assertion below would otherwise notice.
globalThis.fetch = () => { throw new Error('TRIPWIRE: provider-normalize.js reached the network'); };

const {
    MAX_SEGMENT_S, SENTENCE_END, roundHalfEven, speakerLabel, stableSpeakerLabels,
    normalizeLanguage, splitWordsIntoSegments, utterancesToSegments
} = await import('../src/shared/provider-normalize.js');

const repoUrl = (p) => new URL(`../${p}`, import.meta.url);
const FIXTURE = JSON.parse(readFileSync(repoUrl('tests/fixtures/normalizer-parity.json'), 'utf8'));

// ------------------------------------------------------------------
// The staleness guard — the half a frozen snapshot cannot provide
// ------------------------------------------------------------------

test('the reference implementation has not changed under the fixture', () => {
    const ref = readFileSync(repoUrl(FIXTURE.reference.file));
    const sha = createHash('sha256').update(ref).digest('hex');
    assert.equal(sha, FIXTURE.reference.sha256,
        `${FIXTURE.reference.file} changed since the parity fixture was generated.\n`
        + 'Re-observe the reference rather than assuming the twin still matches:\n'
        + `  ${FIXTURE.reference.regenerate}\n`
        + 'then re-run BOTH suites (node --test tests/provider-normalize.test.mjs and, from\n'
        + "companion/transcriber/, python3 -m unittest discover -s tests -p 'test_shared_fixtures.py').");
});

// ------------------------------------------------------------------
// The shared cases
// ------------------------------------------------------------------

test('every fixture case matches the reference output', () => {
    assert.ok(FIXTURE.cases.length > 0, 'fixture carries no cases');
    for (const c of FIXTURE.cases) {
        assert.deepEqual(
            utterancesToSegments(c.utterances, c.max_s),
            c.expected,
            `case "${c.name}" diverged from normalize.py.\nWhy this case exists: ${c.why}`
        );
    }
});

test('segment key order is start/end/speaker/text', () => {
    // The Python projection re-orders keys deliberately so a human
    // diffing a direct result against jobs/<id>.json sees the same
    // shape. JSON.stringify is the only assertion that observes it.
    const c = FIXTURE.cases.find((x) => x.expected.length > 0);
    const [first] = utterancesToSegments(c.utterances, c.max_s);
    assert.equal(JSON.stringify(Object.keys(first)), '["start","end","speaker","text"]');
});

test('every emitted speaker is null or a SPEAKER_NN label', () => {
    for (const c of FIXTURE.cases) {
        for (const s of utterancesToSegments(c.utterances, c.max_s)) {
            assert.ok(s.speaker === null || /^SPEAKER_\d{2,}$/.test(s.speaker),
                `case "${c.name}" emitted speaker ${JSON.stringify(s.speaker)}`);
        }
    }
});

test('every language case matches the reference output', () => {
    for (const c of FIXTURE.language_cases) {
        assert.equal(normalizeLanguage(c.input), c.expected,
            `language case ${JSON.stringify(c.input)} diverged. Why: ${c.why}`);
    }
});

// ------------------------------------------------------------------
// The traps, named individually so a failure reads as a diagnosis
// rather than as "some fixture case broke"
// ------------------------------------------------------------------

const caseNamed = (name) => {
    const c = FIXTURE.cases.find((x) => x.name === name);
    assert.ok(c, `fixture is missing the "${name}" case`);
    return c;
};

test('banker rounding: 1.0625 rounds to 1.062, not 1.063', () => {
    // Math.round(1.0625 * 1000) / 1000 === 1.063. Python's round() is
    // round-half-to-even over the exact double. Latent for AssemblyAI
    // (integer ms in, so halves never arise) and LIVE for Deepgram's
    // float seconds — the twin is written once, so it is settled here.
    assert.equal(roundHalfEven(1.0625, 3), 1.062);
    assert.equal(roundHalfEven(0.0625, 3), 0.062);
    assert.equal(roundHalfEven(2.5, 0), 2);
    assert.equal(roundHalfEven(3.5, 0), 4);
    assert.equal(roundHalfEven(-1.0625, 3), -1.062);
    const c = caseNamed('banker_rounding_half_to_even');
    assert.deepEqual(utterancesToSegments(c.utterances, c.max_s), c.expected);
    assert.equal(c.expected[0].end, 1.062);
});

test('integer speaker 0 is labelled, not dropped', () => {
    // Python `0 == ""` is False; JS `0 == ''` is true. A twin using
    // loose equality makes the first speaker of every Deepgram
    // transcript null.
    assert.deepEqual([...stableSpeakerLabels([0, 1, 0]).entries()],
        [['0', 'SPEAKER_00'], ['1', 'SPEAKER_01']]);
    assert.deepEqual([...stableSpeakerLabels([null, '', 'A']).entries()],
        [['A', 'SPEAKER_00']]);
    const c = caseNamed('integer_speaker_zero_is_labelled');
    assert.equal(utterancesToSegments(c.utterances, c.max_s)[0].speaker, 'SPEAKER_00');
});

test('the max_s break is tested AFTER the word is appended', () => {
    // So an emitted segment legitimately EXCEEDS max_s. A twin that
    // breaks before appending produces different boundaries — and
    // therefore different published claim anchors for the same audio.
    const c = caseNamed('thirty_second_break_tested_after_append');
    const segs = utterancesToSegments(c.utterances, c.max_s);
    assert.equal(segs.length, 2);
    assert.equal(segs[0].end, 30.9);
    assert.ok(segs[0].end - segs[0].start > MAX_SEGMENT_S);
});

test('an untimed LEADING sentence carries forward; an untimed TRAILING run is dropped', () => {
    // The asymmetry is real and is in the reference: flush() returns
    // WITHOUT resetting when cur_start is null, and the final flush
    // hits that same early return. Pinned in neither language before
    // this fixture existed.
    const lead = caseNamed('untimed_leading_sentence_carries_forward');
    assert.deepEqual(utterancesToSegments(lead.utterances, lead.max_s), lead.expected);
    assert.equal(lead.expected[0].text, 'Hello. World.');

    const tail = caseNamed('trailing_untimed_run_is_dropped');
    assert.deepEqual(utterancesToSegments(tail.utterances, tail.max_s), tail.expected);
    assert.equal(tail.expected.length, 1);
    assert.ok(!JSON.stringify(tail.expected).includes('tail'));
});

test('a wordless utterance starting at 0 is kept', () => {
    // The reference tests `u.start is None`, not truthiness. A twin
    // using `!u.start` drops the first utterance of every transcript.
    const c = caseNamed('wordless_utterance_at_zero_is_kept');
    const segs = utterancesToSegments(c.utterances, c.max_s);
    assert.equal(segs.length, 1);
    assert.equal(segs[0].start, 0);
});

test('utterance-level start/end/text are ignored when word timings are usable', () => {
    const c = caseNamed('utterance_fields_ignored_when_words_usable');
    const segs = utterancesToSegments(c.utterances, c.max_s);
    assert.ok(!segs.some((s) => s.text.includes('IGNORED')));
    assert.equal(segs[0].start, 1);
});

test('an empty-text word is skipped entirely — its timing never widens the segment', () => {
    const c = caseNamed('empty_word_text_skipped_timing_not_absorbed');
    const segs = utterancesToSegments(c.utterances, c.max_s);
    // The blank carries end: 50 — absorbing it would both stretch the
    // segment and trip the max_s break into a second piece.
    assert.equal(segs.length, 1);
    assert.equal(segs[0].end, 3);
    assert.equal(segs[0].text, 'One Three.');
});

test('speaker labels are assigned globally by first appearance', () => {
    const c = caseNamed('speaker_labels_are_global_first_appearance');
    assert.deepEqual(utterancesToSegments(c.utterances, c.max_s).map((s) => s.speaker),
        ['SPEAKER_00', 'SPEAKER_01', 'SPEAKER_00', null]);
});

test('the full 12-form sentence-end set splits, not just . ! ?', () => {
    const c = caseNamed('full_sentence_end_tuple');
    assert.equal(utterancesToSegments(c.utterances, c.max_s).length, 4);
    assert.equal(SENTENCE_END.length, 12);
});

test('speakerLabel widens past 99 rather than truncating', () => {
    assert.equal(speakerLabel(0), 'SPEAKER_00');
    assert.equal(speakerLabel(11), 'SPEAKER_11');
    assert.equal(speakerLabel(100), 'SPEAKER_100');
});

test('splitWordsIntoSegments tolerates junk input without throwing', () => {
    assert.deepEqual(splitWordsIntoSegments(null), []);
    assert.deepEqual(splitWordsIntoSegments([]), []);
    assert.deepEqual(splitWordsIntoSegments([null, undefined, {}]), []);
    assert.deepEqual(utterancesToSegments(null), []);
});

test('rounding parity: every observed Python round() case matches', () => {
    // Six of these diverge from Math.round(x * 10**d) / 10**d — the
    // whole reason roundHalfEven exists rather than a one-liner.
    for (const c of FIXTURE.rounding_cases) {
        assert.equal(roundHalfEven(c.value, c.digits), c.expected,
            `round(${c.value}, ${c.digits}) diverged from the reference`);
    }
});

test('roundHalfEven passes non-finite values through unchanged', () => {
    assert.ok(Number.isNaN(roundHalfEven(NaN, 3)));
    assert.equal(roundHalfEven(Infinity, 3), Infinity);
    assert.equal(roundHalfEven(-Infinity, 3), -Infinity);
});

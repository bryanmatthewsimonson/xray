"""Regenerate tests/fixtures/normalizer-parity.json FROM the reference
implementation (companion/transcriber/.../normalize.py), so every expected
value is OBSERVED rather than transcribed by hand.

Run from the repo root:  python3 tests/tools/regen-normalizer-fixture.py

Run this whenever normalize.py changes on purpose: the JS parity test
pins the reference's sha256 and fails until the fixture is regenerated,
which is the point — a deliberate reference change must be re-observed,
not assumed compatible. Pure stdlib; no uv, no venv.
"""

import hashlib
import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "companion" / "transcriber"))

from transcriber.providers.normalize import (  # noqa: E402
    normalize_language,
    utterances_to_segments,
)

REF = REPO / "companion/transcriber/transcriber/providers/normalize.py"


def w(text, start=None, end=None):
    return {"text": text, "start": start, "end": end}


# Forty words at one per second, no punctuation anywhere: the 30 s break
# is tested AFTER the word is appended, so the first segment legitimately
# spans past MAX_SEGMENT_S.
long_run = [w(f"word{i}", float(i), float(i) + 0.9) for i in range(40)]

CASES = [
    {
        "name": "integer_speaker_zero_is_labelled",
        "why": "Python `0 == \"\"` is False so speaker 0 is labelled; a JS twin using `raw == ''` "
               "drops it (JS `0 == ''` is true) and every first speaker becomes null.",
        "utterances": [
            {"speaker": 0, "start": 0.0, "end": 1.0, "text": "First.",
             "words": [w("First.", 0.0, 1.0)]},
            {"speaker": 1, "start": 1.0, "end": 2.0, "text": "Second.",
             "words": [w("Second.", 1.0, 2.0)]},
        ],
    },
    {
        "name": "banker_rounding_half_to_even",
        "why": "Python round() is round-half-to-even over the exact double: round(1.0625,3) is "
               "1.062, while Math.round(1.0625*1000)/1000 is 1.063. Latent for AssemblyAI "
               "(integer ms) and live for Deepgram (float seconds).",
        "utterances": [
            {"speaker": "A", "start": 0.0625, "end": 1.0625, "text": "Edge.",
             "words": [w("Edge.", 0.0625, 1.0625)]},
        ],
    },
    {
        "name": "thirty_second_break_tested_after_append",
        "why": "normalize.py appends the word THEN tests the duration, so an emitted segment "
               "legitimately exceeds max_s. A twin that breaks before appending produces "
               "different boundaries — and different published t=start,end anchors.",
        "utterances": [
            {"speaker": "A", "start": 0.0, "end": 39.9, "text": "no punctuation at all",
             "words": long_run},
        ],
    },
    {
        "name": "untimed_leading_sentence_carries_forward",
        "why": "flush() RETURNS WITHOUT RESETTING when cur_start is None, so an untimed opening "
               "sentence is carried into the next timed segment rather than dropped.",
        "utterances": [
            {"speaker": "A", "start": 5.0, "end": 6.0, "text": "Hello. World.",
             "words": [w("Hello."), w("World.", 5.0, 6.0)]},
        ],
    },
    {
        "name": "trailing_untimed_run_is_dropped",
        "why": "The same early return at the FINAL flush silently drops a trailing untimed run. "
               "Asymmetric with the leading case above, and pinned in neither language today.",
        "utterances": [
            {"speaker": "A", "start": 1.0, "end": 2.0, "text": "Hello. tail",
             "words": [w("Hello.", 1.0, 2.0), w("tail")]},
        ],
    },
    {
        "name": "empty_word_text_skipped_timing_not_absorbed",
        "why": "A word whose stripped text is empty is skipped ENTIRELY — its start/end never "
               "widen the running segment. The blank here carries a wild end (50 s): absorbing "
               "it would both stretch the segment AND trip the max_s break, so a twin that "
               "merely filters empty text after reading timings fails this case.",
        "utterances": [
            {"speaker": "A", "start": 0.0, "end": 3.0, "text": "One Three.",
             "words": [w("One", 0.0, 1.0), w("   ", 1.0, 50.0), w("Three.", 2.0, 3.0)]},
        ],
    },
    {
        "name": "utterance_fields_ignored_when_words_usable",
        "why": "When word timings produce pieces, the utterance's own start/end/text are ignored "
               "entirely — a twin that prefers them publishes wrong anchors.",
        "utterances": [
            {"speaker": "A", "start": 99.0, "end": 99.5, "text": "IGNORED",
             "words": [w("Real", 1.0, 1.5), w("words.", 1.5, 2.0)]},
        ],
    },
    {
        "name": "wordless_utterance_at_zero_is_kept",
        "why": "The wordless fallback tests `u.start is None`, not truthiness, so start == 0 is "
               "KEPT. A twin using `!u.start` drops the first utterance of every transcript.",
        "utterances": [
            {"speaker": "A", "start": 0, "end": 2.0, "text": "Zero start.", "words": []},
        ],
    },
    {
        "name": "wordless_utterance_missing_end_uses_start",
        "why": "end falls back to start when absent.",
        "utterances": [
            {"speaker": "A", "start": 4.0, "end": None, "text": "No end.", "words": []},
        ],
    },
    {
        "name": "speaker_labels_are_global_first_appearance",
        "why": "The label map is computed ONCE over the WHOLE list before emitting, so ordering "
               "is global — not per-utterance, not sorted.",
        "utterances": [
            {"speaker": "C", "start": 0.0, "end": 1.0, "text": "Third speaker first.",
             "words": [w("Third speaker first.", 0.0, 1.0)]},
            {"speaker": "A", "start": 1.0, "end": 2.0, "text": "Then A.",
             "words": [w("Then A.", 1.0, 2.0)]},
            {"speaker": "C", "start": 2.0, "end": 3.0, "text": "C again.",
             "words": [w("C again.", 2.0, 3.0)]},
            {"speaker": None, "start": 3.0, "end": 4.0, "text": "Unlabelled stays null.",
             "words": [w("Unlabelled stays null.", 3.0, 4.0)]},
        ],
    },
    {
        "name": "full_sentence_end_tuple",
        "why": "The sentence-end set is a 12-tuple including quote- and paren-wrapped forms; "
               "a twin testing only .!? merges these into one segment.",
        "utterances": [
            {"speaker": "A", "start": 0.0, "end": 4.0, "text": "quoted and parenthesised",
             "words": [
                 w('He said "go."', 0.0, 1.0),
                 w("(aside.)", 1.0, 2.0),
                 w("'quoted.'", 2.0, 3.0),
                 w("plain?", 3.0, 4.0),
             ]},
        ],
    },
    {
        "name": "empty_input",
        "why": "No utterances at all yields no segments — the caller turns this into the "
               "'no usable segments' refusal.",
        "utterances": [],
    },
    {
        "name": "wordless_utterance_without_start_is_skipped",
        "why": "text present but start None: skipped, never emitted with an invented time.",
        "utterances": [
            {"speaker": "A", "start": None, "end": None, "text": "No timing.", "words": []},
            {"speaker": "A", "start": 1.0, "end": 2.0, "text": "Timed.", "words": []},
        ],
    },
]

LANGUAGE_CASES = [
    {"input": "en_us", "why": "AssemblyAI's underscore form; Intl.DisplayNames chokes on it."},
    {"input": "PT-br", "why": "hyphenated BCP-47, mixed case."},
    {"input": "es", "why": "plain passthrough."},
    {"input": "", "why": "empty falls back."},
    {"input": None, "why": "null falls back."},
    {"input": "_en", "why": "leading separator yields an empty primary subtag -> fallback."},
    {"input": "  EN  ", "why": "surrounding whitespace is stripped."},
    {"input": 0, "why": "the reference is `str(code or \"\")`, so a FALSY non-string collapses to "
                        "empty and falls back. A JS twin using `code ?? \"\"` yields \"0\" instead."},
    {"input": False, "why": "same falsy-collapse path."},
]

# Rounding parity, observed from Python's round() — round-half-to-even
# over the EXACT double, which Math.round(x*10**d)/10**d does not
# reproduce. Latent for AssemblyAI (integer ms) and live for Deepgram.
ROUNDING_CASES = [
    {"value": 1.0625, "digits": 3},
    {"value": 0.0625, "digits": 3},
    {"value": -1.0625, "digits": 3},
    {"value": 2.5, "digits": 0},
    {"value": 3.5, "digits": 0},
    {"value": -2.5, "digits": 0},
    {"value": 2.675, "digits": 2},
    {"value": 1.005, "digits": 2},
    {"value": 0.125, "digits": 2},
    {"value": 0.375, "digits": 2},
    {"value": 1.5e-7, "digits": 3},
    {"value": 12345.6785, "digits": 3},
    {"value": 0.0, "digits": 3},
    {"value": 39.9, "digits": 3},
    {"value": 30.900000000000002, "digits": 3},
]

for c in CASES:
    c["max_s"] = 30.0
    c["expected"] = utterances_to_segments(c["utterances"], max_s=c["max_s"])

for c in LANGUAGE_CASES:
    c["expected"] = normalize_language(c["input"])

for c in ROUNDING_CASES:
    c["expected"] = round(c["value"], c["digits"])

doc = {
    "_comment": (
        "GENERATED from the reference implementation, then checked in. The expected values "
        "were OBSERVED by running normalize.py, never transcribed by hand. Both suites read "
        "this file: tests/provider-normalize.test.mjs (the JS twin) and "
        "companion/transcriber/tests/test_shared_fixtures.py (the reference). Guard-rail 2 of "
        "docs/DIRECT_CLOUD_TRANSCRIBE_KICKOFF.md is the reason it exists — two implementations "
        "of one contract in two languages drift otherwise, and the drift would be silent: the "
        "segment boundaries decide the composed body bytes (the published `x` content address) "
        "AND the t=<start>,<end> values inside kind-30040 claim anchors."
    ),
    "reference": {
        "file": "companion/transcriber/transcriber/providers/normalize.py",
        "sha256": hashlib.sha256(REF.read_bytes()).hexdigest(),
        "regenerate": "python3 tests/tools/regen-normalizer-fixture.py",
    },
    "max_segment_s": 30.0,
    "cases": CASES,
    "language_cases": LANGUAGE_CASES,
    "rounding_cases": ROUNDING_CASES,
}

out = REPO / "tests/fixtures/normalizer-parity.json"
out.write_text(json.dumps(doc, indent=2) + "\n")
print(f"wrote {out} — {len(CASES)} segment, {len(LANGUAGE_CASES)} language, "
      f"{len(ROUNDING_CASES)} rounding cases")
print(f"reference sha256 {doc['reference']['sha256']}")

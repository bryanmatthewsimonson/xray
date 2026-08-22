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

from transcriber.providers import deepgram as dg  # noqa: E402
from transcriber.providers.normalize import (  # noqa: E402
    normalize_language,
    utterances_to_segments,
)

REF = REPO / "companion/transcriber/transcriber/providers/normalize.py"


def _extract_function(source: str, name: str) -> str:
    """Slice one top-level function out of a source file, TEXTUALLY.

    Deliberately not inspect.getsource: the JavaScript parity test has to
    compute the identical bytes, and a text rule is the only thing both
    languages can implement the same way. From `def <name>(` up to the
    next line that starts in column 0, trailing whitespace stripped.
    """
    at = source.index(f"def {name}(")
    rest = source[at:]
    out = []
    for i, line in enumerate(rest.split("\n")):
        if i > 0 and line and not line[0].isspace():
            break
        out.append(line)
    return "\n".join(out).rstrip()


def _mapping_sha() -> str:
    """Pin the MAPPING functions only, not the whole deepgram.py — an edit
    to the request URL or the progress ticker must not red the JS parity
    suite, while an edit to the payload mapping must."""
    src = (REPO / "companion/transcriber/transcriber/providers/deepgram.py").read_text(encoding="utf-8")
    joined = "".join(_extract_function(src, n) for n in ("_common_utterances", "_detected_language"))
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


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

# ---------------------------------------------------------------------
# Provider MAPPING cases (DC.3).
#
# The shared normalizer above is only half the contract. Each provider
# has its own layer turning a raw API payload into the common utterance
# shape, and THAT is where the units differ — AssemblyAI sends integer
# milliseconds, Deepgram sends float seconds. Before DC.3 that layer was
# tested independently in each language against hand-built payloads and
# cross-checked nowhere, which is exactly the drift guard-rail 2 exists
# to prevent.
#
# The first case is a REAL slice of a live 48-minute Deepgram response,
# not an invention: float seconds with visible precision noise
# (1.1999999), an integer speaker 0, and a punctuated_word.
# ---------------------------------------------------------------------

DEEPGRAM_REAL_SLICE = {
    "results": {
        "channels": [
            {
                "detected_language": "en",
                "alternatives": [
                    {
                        "transcript": "unused when utterances are present",
                        "words": []
                    }
                ]
            }
        ],
        "utterances": [
            {
                "start": 1.1999999,
                "end": 10.16,
                "transcript": "Hi. I'm your host, Alyssa Grenfell. Before the episode begins, we have a few notes for listeners. This podcast is hosted by me and veteran attorney Tim Kosnoff.",
                "words": [
                    {
                        "word": "hi",
                        "start": 1.1999999,
                        "end": 1.5999999,
                        "confidence": 0.95410156,
                        "speaker": 0,
                        "speaker_confidence": 0.37427926,
                        "punctuated_word": "Hi."
                    },
                    {
                        "word": "i'm",
                        "start": 1.5999999,
                        "end": 1.8399999,
                        "confidence": 0.9995117,
                        "speaker": 0,
                        "speaker_confidence": 0.37427926,
                        "punctuated_word": "I'm"
                    },
                    {
                        "word": "your",
                        "start": 1.8399999,
                        "end": 1.92,
                        "confidence": 0.99902344,
                        "speaker": 0,
                        "speaker_confidence": 0.37427926,
                        "punctuated_word": "your"
                    }
                ],
                "speaker": 0
            },
            {
                "start": 10.24,
                "end": 32.35,
                "transcript": "But you'll also hear other voices from our production team introducing topics and guests. Our team produced this podcast with the mission to educate people on the issue of child abuse in the LDS community, help victims of abuse, and encourage us all to work together to help fix this issue. We occasionally use excerpts of speeches by leaders of The Church of Jesus Christ of Latter day Saints publicly available on their website.",
                "words": [
                    {
                        "word": "but",
                        "start": 10.24,
                        "end": 10.4,
                        "confidence": 0.99902344,
                        "speaker": 0,
                        "speaker_confidence": 0.3667938,
                        "punctuated_word": "But"
                    },
                    {
                        "word": "you'll",
                        "start": 10.4,
                        "end": 10.719999,
                        "confidence": 0.9838867,
                        "speaker": 0,
                        "speaker_confidence": 0.3667938,
                        "punctuated_word": "you'll"
                    },
                    {
                        "word": "also",
                        "start": 10.719999,
                        "end": 10.88,
                        "confidence": 1.0,
                        "speaker": 0,
                        "speaker_confidence": 0.3667938,
                        "punctuated_word": "also"
                    }
                ],
                "speaker": 1
            }
        ]
    }
}

PROVIDER_CASES = [
    {
        "name": "deepgram_real_response_slice",
        "provider": "deepgram",
        "why": "A real slice of a live Deepgram run. Float seconds pass through with NO division "
               "(copy-pasting AssemblyAI's msToSeconds is the single most likely port error), text "
               "comes from `transcript` not `text`, and the integer speaker 0 must survive.",
        "payload": DEEPGRAM_REAL_SLICE,
    },
    {
        "name": "deepgram_speaker_one_before_zero",
        "provider": "deepgram",
        "why": "Speaker labels are assigned by GLOBAL first appearance, so 1 -> SPEAKER_00 and "
               "0 -> SPEAKER_01. Pins the ordering and the `0 == \"\"` trap at the payload level.",
        "payload": {"results": {"channels": [{"detected_language": "en", "alternatives": []}],
                    "utterances": [
                        {"speaker": 1, "start": 0.0, "end": 1.0, "transcript": "Second speaker first.",
                         "words": [{"word": "Second", "start": 0.0, "end": 1.0}]},
                        {"speaker": 0, "start": 1.0, "end": 2.0, "transcript": "Then zero.",
                         "words": [{"word": "Then", "start": 1.0, "end": 2.0}]}]}},
    },
    {
        "name": "deepgram_empty_utterances_falls_through_to_channels",
        "provider": "deepgram",
        "why": "The reference branches on TRUTHINESS (`if utterances:`), so an empty list falls "
               "through to the channels fallback. A twin using Array.isArray() returns [] and "
               "refuses a transcript that exists.",
        "payload": {"results": {"utterances": [], "channels": [{"detected_language": "en",
                    "alternatives": [{"transcript": "From the flat stream.",
                    "words": [{"word": "From", "start": 0.0, "end": 0.5},
                              {"word": "stream.", "start": 0.5, "end": 1.0}]}]}]}},
    },
    {
        "name": "deepgram_empty_punctuated_word_falls_back",
        "provider": "deepgram",
        "why": "`punctuated_word or word` — Python `or`, so an EMPTY punctuated_word falls back to "
               "`word`. A twin using `??` keeps the empty string and splitWordsIntoSegments then "
               "silently drops the word.",
        "payload": {"results": {"channels": [{"detected_language": "en", "alternatives": []}],
                    "utterances": [{"speaker": 0, "start": 0.0, "end": 1.0, "transcript": "Kept.",
                    "words": [{"word": "kept", "punctuated_word": "", "start": 0.0, "end": 1.0}]}]}},
    },
    {
        "name": "deepgram_language_comes_from_channels",
        "provider": "deepgram",
        "why": "Language is read from channels[0].detected_language EVEN on the utterances branch.",
        "payload": {"results": {"channels": [{"detected_language": "pt-BR", "alternatives": []}],
                    "utterances": [{"speaker": 0, "start": 0.0, "end": 1.0, "transcript": "Ola.",
                    "words": [{"word": "Ola.", "start": 0.0, "end": 1.0}]}]}},
    },
    {
        "name": "deepgram_channels_fallback_with_no_words",
        "provider": "deepgram",
        "why": "No utterances and no words -> [] -> the caller's 'no usable segments' refusal, "
               "rather than adopting an empty transcript.",
        "payload": {"results": {"utterances": [], "channels": [{"detected_language": "en",
                    "alternatives": [{"transcript": "", "words": []}]}]}},
    },
    {
        "name": "deepgram_unlabelled_speaker_stays_null",
        "provider": "deepgram",
        "why": "A null speaker is never given an invented label.",
        "payload": {"results": {"channels": [{"detected_language": "en", "alternatives": []}],
                    "utterances": [{"speaker": None, "start": 0.0, "end": 1.0, "transcript": "Nobody.",
                    "words": [{"word": "Nobody.", "start": 0.0, "end": 1.0}]}]}},
    },
]

for c in PROVIDER_CASES:
    c["expected_utterances"] = dg._common_utterances(c["payload"])
    c["expected_language"] = dg._detected_language(c["payload"])
    # Mapping THEN the shared normalizer — what the extension adopts.
    c["expected_segments"] = utterances_to_segments(c["expected_utterances"])

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
    "provider_cases": PROVIDER_CASES,
    "provider_reference": {
        "deepgram": {
            "file": "companion/transcriber/transcriber/providers/deepgram.py",
            "functions": ["_common_utterances", "_detected_language"],
            "sha256": _mapping_sha(),
        }
    },
    "language_cases": LANGUAGE_CASES,
    "rounding_cases": ROUNDING_CASES,
}

out = REPO / "tests/fixtures/normalizer-parity.json"
out.write_text(json.dumps(doc, indent=2) + "\n")
print(f"wrote {out} — {len(CASES)} segment, {len(LANGUAGE_CASES)} language, "
      f"{len(ROUNDING_CASES)} rounding, {len(PROVIDER_CASES)} provider-mapping cases")
print(f"reference sha256 {doc['reference']['sha256']}")

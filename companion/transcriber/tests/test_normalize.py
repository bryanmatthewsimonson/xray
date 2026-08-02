"""Unit tests for the pure normalization layer (providers/normalize.py).

Run from companion/transcriber/:  uv run python -m unittest discover tests
(never part of the extension's CI — the companion is not in the zip).
"""

import unittest

from transcriber.providers.normalize import (
    normalize_language,
    speaker_label,
    split_words_into_segments,
    stable_speaker_labels,
    utterances_to_segments,
)


class StableSpeakerLabels(unittest.TestCase):
    def test_letters_first_appearance_order(self):
        self.assertEqual(
            stable_speaker_labels(["B", "A", "B", "C"]),
            {"B": "SPEAKER_00", "A": "SPEAKER_01", "C": "SPEAKER_02"},
        )

    def test_integers_and_mixed_types_key_by_str(self):
        self.assertEqual(
            stable_speaker_labels([0, 1, 0]),
            {"0": "SPEAKER_00", "1": "SPEAKER_01"},
        )

    def test_none_and_empty_skipped(self):
        self.assertEqual(stable_speaker_labels([None, "", "A"]), {"A": "SPEAKER_00"})

    def test_label_format(self):
        self.assertEqual(speaker_label(0), "SPEAKER_00")
        self.assertEqual(speaker_label(11), "SPEAKER_11")


class NormalizeLanguage(unittest.TestCase):
    def test_underscore_form_reduces_to_primary_subtag(self):
        self.assertEqual(normalize_language("en_us"), "en")

    def test_hyphen_form_and_case(self):
        self.assertEqual(normalize_language("PT-br"), "pt")

    def test_plain_passthrough(self):
        self.assertEqual(normalize_language("es"), "es")

    def test_empty_falls_back(self):
        self.assertEqual(normalize_language(""), "en")
        self.assertEqual(normalize_language(None), "en")


class SplitWords(unittest.TestCase):
    def test_sentence_boundary_split(self):
        words = [
            {"text": "Hello", "start": 0.0, "end": 0.4},
            {"text": "there.", "start": 0.5, "end": 0.9},
            {"text": "Next", "start": 1.0, "end": 1.4},
            {"text": "sentence?", "start": 1.5, "end": 2.0},
        ]
        segs = split_words_into_segments(words)
        self.assertEqual(
            segs,
            [
                {"start": 0.0, "end": 0.9, "text": "Hello there."},
                {"start": 1.0, "end": 2.0, "text": "Next sentence?"},
            ],
        )

    def test_hard_break_past_max_duration(self):
        # 40 s of words with no punctuation: must split at the 30 s cap.
        words = [{"text": f"w{i}", "start": float(i), "end": float(i) + 0.9} for i in range(40)]
        segs = split_words_into_segments(words, max_s=30.0)
        self.assertEqual(len(segs), 2)
        self.assertEqual(segs[0]["start"], 0.0)
        self.assertLessEqual(segs[0]["end"] - segs[0]["start"], 31.0)
        self.assertEqual(segs[1]["end"], 39.9)

    def test_quote_wrapped_sentence_end(self):
        words = [
            {"text": 'said,', "start": 0.0, "end": 0.4},
            {"text": '"stop."', "start": 0.5, "end": 0.9},
            {"text": "Then", "start": 1.0, "end": 1.3},
            {"text": "left.", "start": 1.4, "end": 1.8},
        ]
        segs = split_words_into_segments(words)
        self.assertEqual(len(segs), 2)
        self.assertEqual(segs[0]["text"], 'said, "stop."')

    def test_empty_words(self):
        self.assertEqual(split_words_into_segments([]), [])
        self.assertEqual(split_words_into_segments(None), [])

    def test_rounding_to_ms(self):
        words = [{"text": "hi.", "start": 0.123456, "end": 0.98765}]
        self.assertEqual(
            split_words_into_segments(words),
            [{"start": 0.123, "end": 0.988, "text": "hi."}],
        )


class UtterancesToSegments(unittest.TestCase):
    def test_speakers_remapped_and_words_split(self):
        utterances = [
            {
                "speaker": "B",
                "start": 0.0,
                "end": 2.0,
                "text": "Hi there. How are you?",
                "words": [
                    {"text": "Hi", "start": 0.0, "end": 0.3},
                    {"text": "there.", "start": 0.4, "end": 0.8},
                    {"text": "How", "start": 0.9, "end": 1.1},
                    {"text": "are", "start": 1.2, "end": 1.4},
                    {"text": "you?", "start": 1.5, "end": 2.0},
                ],
            },
            {
                "speaker": "A",
                "start": 2.1,
                "end": 3.0,
                "text": "Fine.",
                "words": [{"text": "Fine.", "start": 2.1, "end": 3.0}],
            },
        ]
        segs = utterances_to_segments(utterances)
        self.assertEqual(
            segs,
            [
                {"start": 0.0, "end": 0.8, "speaker": "SPEAKER_00", "text": "Hi there."},
                {"start": 0.9, "end": 2.0, "speaker": "SPEAKER_00", "text": "How are you?"},
                {"start": 2.1, "end": 3.0, "speaker": "SPEAKER_01", "text": "Fine."},
            ],
        )

    def test_wordless_utterance_stays_whole(self):
        segs = utterances_to_segments(
            [{"speaker": 0, "start": 1.0, "end": 4.0, "text": "One block.", "words": []}]
        )
        self.assertEqual(
            segs,
            [{"start": 1.0, "end": 4.0, "speaker": "SPEAKER_00", "text": "One block."}],
        )

    def test_unlabelled_speaker_stays_none(self):
        segs = utterances_to_segments(
            [{"speaker": None, "start": 0.0, "end": 1.0, "text": "Who said this.", "words": []}]
        )
        self.assertEqual(segs[0]["speaker"], None)

    def test_empty_input(self):
        self.assertEqual(utterances_to_segments([]), [])
        self.assertEqual(utterances_to_segments(None), [])


if __name__ == "__main__":
    unittest.main()

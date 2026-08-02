"""Unit tests for the cloud provider payload normalization + the
AssemblyAI poll loop, with the HTTP layer stubbed.

Run from companion/transcriber/:  uv run python -m unittest discover tests
"""

import unittest
from unittest import mock

from transcriber.providers import assemblyai, deepgram

INFO = {"id": "vid123", "title": "Episode", "channel": "Show", "uploader": "up", "duration": 3600}


class AssemblyAINormalization(unittest.TestCase):
    def test_build_result_full_payload(self):
        data = {
            "status": "completed",
            "language_code": "en_us",
            "utterances": [
                {
                    "speaker": "A",
                    "start": 30,
                    "end": 1900,
                    "text": "Hello there. Second thought?",
                    "words": [
                        {"text": "Hello", "start": 30, "end": 400},
                        {"text": "there.", "start": 450, "end": 900},
                        {"text": "Second", "start": 1000, "end": 1400},
                        {"text": "thought?", "start": 1500, "end": 1900},
                    ],
                },
                {
                    "speaker": "B",
                    "start": 2000,
                    "end": 2600,
                    "text": "Yes.",
                    "words": [{"text": "Yes.", "start": 2000, "end": 2600}],
                },
            ],
        }
        result = assemblyai._build_result(INFO, data, 3600.0)
        self.assertEqual(result["video_id"], "vid123")
        self.assertEqual(result["language"], "en")
        self.assertEqual(result["duration"], 3600.0)
        self.assertEqual(
            result["segments"],
            [
                {"start": 0.03, "end": 0.9, "speaker": "SPEAKER_00", "text": "Hello there."},
                {"start": 1.0, "end": 1.9, "speaker": "SPEAKER_00", "text": "Second thought?"},
                {"start": 2.0, "end": 2.6, "speaker": "SPEAKER_01", "text": "Yes."},
            ],
        )
        mi = result["model_info"]
        self.assertEqual(mi["provider"], "assemblyai")
        self.assertEqual(mi["asr_model"], "universal")
        self.assertEqual(mi["device"], "cloud")
        self.assertTrue(mi["aligned"])

    def test_no_utterances_falls_back_to_flat_words_unlabelled(self):
        data = {
            "status": "completed",
            "language_code": "en",
            "text": "Only words.",
            "words": [
                {"text": "Only", "start": 0, "end": 300},
                {"text": "words.", "start": 350, "end": 800},
            ],
        }
        result = assemblyai._build_result(INFO, data, 10.0)
        self.assertEqual(
            result["segments"],
            [{"start": 0.0, "end": 0.8, "speaker": None, "text": "Only words."}],
        )

    def test_empty_payload_raises(self):
        with self.assertRaises(RuntimeError):
            assemblyai._build_result(INFO, {"status": "completed"}, 10.0)


class AssemblyAIPolling(unittest.TestCase):
    def test_poll_until_completed(self):
        responses = [
            {"id": "t1", "status": "queued"},  # create
            {"status": "queued"},
            {"status": "processing"},
            {"status": "completed", "utterances": [], "text": "x", "words": []},
        ]
        events = []
        with mock.patch.object(assemblyai.http, "request_json", side_effect=responses) as rj, \
                mock.patch.object(assemblyai.time, "sleep") as slept, \
                mock.patch.object(assemblyai.config, "ASSEMBLYAI_API_KEY", "k"):
            data = assemblyai._create_and_poll("https://upload/x", 600.0, events.append)
        self.assertEqual(data["status"], "completed")
        self.assertEqual(rj.call_count, 4)
        self.assertEqual(slept.call_count, 2)
        # Every progress event sits inside the transcribing band.
        for e in events:
            self.assertEqual(e["stage"], "transcribing")
            self.assertGreaterEqual(e["progress"], 0.30)
            self.assertLessEqual(e["progress"], 0.99)

    def test_error_status_raises_with_provider_message(self):
        responses = [
            {"id": "t1", "status": "queued"},
            {"status": "error", "error": "bad audio"},
        ]
        with mock.patch.object(assemblyai.http, "request_json", side_effect=responses), \
                mock.patch.object(assemblyai.time, "sleep"), \
                mock.patch.object(assemblyai.config, "ASSEMBLYAI_API_KEY", "k"):
            with self.assertRaisesRegex(RuntimeError, "bad audio"):
                assemblyai._create_and_poll("https://upload/x", 600.0, lambda e: None)

    def test_create_without_id_raises(self):
        with mock.patch.object(assemblyai.http, "request_json", return_value={}), \
                mock.patch.object(assemblyai.config, "ASSEMBLYAI_API_KEY", "k"):
            with self.assertRaisesRegex(RuntimeError, "no transcript id"):
                assemblyai._create_and_poll("https://upload/x", 600.0, lambda e: None)

    def test_transient_poll_failures_are_retried(self):
        responses = [
            {"id": "t1", "status": "queued"},  # create
            RuntimeError("could not reach"),  # network blip
            assemblyai.http.HttpStatusError(503, "busy", "u"),  # provider 5xx
            {"status": "completed", "utterances": [], "text": "x", "words": []},
        ]
        with mock.patch.object(assemblyai.http, "request_json", side_effect=responses), \
                mock.patch.object(assemblyai.time, "sleep"), \
                mock.patch.object(assemblyai.config, "ASSEMBLYAI_API_KEY", "k"):
            data = assemblyai._create_and_poll("https://upload/x", 600.0, lambda e: None)
        self.assertEqual(data["status"], "completed")

    def test_4xx_poll_failure_is_fatal(self):
        responses = [
            {"id": "t1", "status": "queued"},
            assemblyai.http.HttpStatusError(401, "bad key", "u"),
        ]
        with mock.patch.object(assemblyai.http, "request_json", side_effect=responses), \
                mock.patch.object(assemblyai.time, "sleep"), \
                mock.patch.object(assemblyai.config, "ASSEMBLYAI_API_KEY", "k"):
            with self.assertRaisesRegex(RuntimeError, "HTTP 401"):
                assemblyai._create_and_poll("https://upload/x", 600.0, lambda e: None)

    def test_persistent_transient_failures_eventually_fail(self):
        responses = [{"id": "t1", "status": "queued"}] + [RuntimeError("down")] * 10
        with mock.patch.object(assemblyai.http, "request_json", side_effect=responses), \
                mock.patch.object(assemblyai.time, "sleep"), \
                mock.patch.object(assemblyai.config, "ASSEMBLYAI_API_KEY", "k"):
            with self.assertRaisesRegex(RuntimeError, "down"):
                assemblyai._create_and_poll("https://upload/x", 600.0, lambda e: None)


class DeepgramNormalization(unittest.TestCase):
    def test_build_result_full_payload(self):
        data = {
            "results": {
                "channels": [{"detected_language": "en", "alternatives": [{"transcript": ""}]}],
                "utterances": [
                    {
                        "speaker": 1,
                        "start": 0.5,
                        "end": 2.5,
                        "transcript": "First one. Then two.",
                        "words": [
                            {"word": "first", "punctuated_word": "First", "start": 0.5, "end": 0.9},
                            {"word": "one", "punctuated_word": "one.", "start": 1.0, "end": 1.3},
                            {"word": "then", "punctuated_word": "Then", "start": 1.4, "end": 1.8},
                            {"word": "two", "punctuated_word": "two.", "start": 1.9, "end": 2.5},
                        ],
                    },
                    {
                        "speaker": 0,
                        "start": 3.0,
                        "end": 3.5,
                        "transcript": "Reply.",
                        "words": [
                            {"word": "reply", "punctuated_word": "Reply.", "start": 3.0, "end": 3.5}
                        ],
                    },
                ],
            }
        }
        result = deepgram._build_result(INFO, data, 3600.0)
        self.assertEqual(result["language"], "en")
        self.assertEqual(
            result["segments"],
            [
                {"start": 0.5, "end": 1.3, "speaker": "SPEAKER_00", "text": "First one."},
                {"start": 1.4, "end": 2.5, "speaker": "SPEAKER_00", "text": "Then two."},
                {"start": 3.0, "end": 3.5, "speaker": "SPEAKER_01", "text": "Reply."},
            ],
        )
        mi = result["model_info"]
        self.assertEqual(mi["provider"], "deepgram")
        self.assertEqual(mi["asr_model"], "nova-3")
        self.assertEqual(mi["diarization_model"], "deepgram-native")

    def test_no_utterances_falls_back_to_channel_words(self):
        data = {
            "results": {
                "channels": [
                    {
                        "detected_language": "es",
                        "alternatives": [
                            {
                                "transcript": "hola mundo",
                                "words": [
                                    {"word": "hola", "start": 0.0, "end": 0.4},
                                    {"word": "mundo", "start": 0.5, "end": 1.0},
                                ],
                            }
                        ],
                    }
                ]
            }
        }
        result = deepgram._build_result(INFO, data, 10.0)
        self.assertEqual(result["language"], "es")
        self.assertEqual(
            result["segments"],
            [{"start": 0.0, "end": 1.0, "speaker": None, "text": "hola mundo"}],
        )

    def test_empty_payload_raises(self):
        with self.assertRaises(RuntimeError):
            deepgram._build_result(INFO, {"results": {}}, 10.0)

    def test_request_url_carries_model_and_diarize(self):
        with mock.patch.object(deepgram.config, "DEEPGRAM_MODEL", "nova-3"):
            url = deepgram._request_url()
        self.assertIn("model=nova-3", url)
        self.assertIn("diarize=true", url)
        self.assertIn("utterances=true", url)
        self.assertTrue(url.startswith("https://api.deepgram.com/v1/listen?"))


class ProviderRegistry(unittest.TestCase):
    def test_get_runner_dispatch(self):
        from transcriber import providers

        self.assertIs(providers.get_runner("assemblyai"), assemblyai.run)
        self.assertIs(providers.get_runner("deepgram"), deepgram.run)
        with self.assertRaises(RuntimeError):
            providers.get_runner("nope")

    def test_validate_active_missing_key(self):
        from transcriber import config, providers

        with mock.patch.object(config, "PROVIDER", "assemblyai"), \
                mock.patch.object(config, "ASSEMBLYAI_API_KEY", ""):
            self.assertIn("ASSEMBLYAI_API_KEY", providers.validate_active())
        with mock.patch.object(config, "PROVIDER", "unknown-thing"):
            self.assertIn("not a known provider", providers.validate_active())
        with mock.patch.object(config, "PROVIDER", "deepgram"), \
                mock.patch.object(config, "DEEPGRAM_API_KEY", "k"):
            self.assertIsNone(providers.validate_active())


if __name__ == "__main__":
    unittest.main()

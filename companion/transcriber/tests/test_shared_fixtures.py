"""Cross-language parity: the REFERENCE half of the shared normalizer
fixture.

The extension ships a JavaScript twin of providers/normalize.py
(src/shared/provider-normalize.js) because the direct-cloud
transcription path talks to a provider from the service worker with no
companion service in the loop. Guard-rail 2 of
docs/DIRECT_CLOUD_TRANSCRIBE_KICKOFF.md names the risk: two
implementations of one contract, in two languages, drifting silently.

Both suites read tests/fixtures/normalizer-parity.json at the REPO
root. The JS side additionally pins this file's sha256, so editing
normalize.py fails the JS suite until the fixture is regenerated with
tests/tools/regen-normalizer-fixture.py — which re-OBSERVES the
expected values from this module rather than assuming they still hold.

This file is deliberately PURE STDLIB and imports nothing from the
service (no fastapi, no yt-dlp, no torch), so npm CI can run it with a
bare `python3` — no uv, no venv:

    cd companion/transcriber
    python3 -m unittest discover -s tests -p 'test_shared_fixtures.py'

The discover pattern is scoped to this file on purpose: its siblings
import provider runners and would drag the whole dependency set into
CI.

Run the full companion suite the usual way:
    uv run python -m unittest discover tests
"""

import json
import pathlib
import unittest

from transcriber.providers.normalize import normalize_language, utterances_to_segments

# tests/ -> transcriber/ -> companion/ -> repo root
REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
FIXTURE_PATH = REPO_ROOT / "tests" / "fixtures" / "normalizer-parity.json"

REGEN_HINT = (
    "\n\nIf this divergence is intentional, regenerate the shared fixture from the "
    "reference and re-run BOTH suites:\n"
    "    python3 tests/tools/regen-normalizer-fixture.py\n"
    "    node --test tests/provider-normalize.test.mjs"
)


def load_fixture() -> dict:
    with FIXTURE_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


class SharedFixtureIsReachable(unittest.TestCase):
    def test_fixture_file_exists(self):
        self.assertTrue(
            FIXTURE_PATH.is_file(),
            f"shared parity fixture not found at {FIXTURE_PATH}. This test must run "
            "from a full checkout — the companion is not distributed standalone.",
        )

    def test_fixture_declares_this_module_as_the_reference(self):
        ref = load_fixture()["reference"]["file"]
        self.assertEqual(ref, "companion/transcriber/transcriber/providers/normalize.py")


class SegmentParity(unittest.TestCase):
    def test_every_case_matches_this_implementation(self):
        fixture = load_fixture()
        self.assertGreater(len(fixture["cases"]), 0, "fixture carries no cases")
        for case in fixture["cases"]:
            with self.subTest(case=case["name"]):
                self.assertEqual(
                    utterances_to_segments(case["utterances"], max_s=case["max_s"]),
                    case["expected"],
                    f'case "{case["name"]}" diverged.\nWhy this case exists: '
                    f'{case["why"]}{REGEN_HINT}',
                )

    def test_key_order_is_start_end_speaker_text(self):
        # The JS twin pins this with JSON.stringify; dicts preserve
        # insertion order here, so the same projection is observable.
        fixture = load_fixture()
        case = next(c for c in fixture["cases"] if c["expected"])
        first = utterances_to_segments(case["utterances"], max_s=case["max_s"])[0]
        self.assertEqual(list(first.keys()), ["start", "end", "speaker", "text"])


class LanguageParity(unittest.TestCase):
    def test_every_language_case_matches(self):
        for case in load_fixture()["language_cases"]:
            with self.subTest(code=case["input"]):
                self.assertEqual(
                    normalize_language(case["input"]),
                    case["expected"],
                    f'language case {case["input"]!r} diverged. Why: '
                    f'{case["why"]}{REGEN_HINT}',
                )


class RoundingParity(unittest.TestCase):
    """The JS twin implements round-half-to-even by hand (JavaScript has
    no equivalent of Python's round()), so the checked-in expectations
    must keep matching THIS interpreter's round()."""

    def test_every_rounding_case_matches_python_round(self):
        for case in load_fixture()["rounding_cases"]:
            with self.subTest(value=case["value"], digits=case["digits"]):
                self.assertEqual(
                    round(case["value"], case["digits"]),
                    case["expected"],
                    f'round({case["value"]}, {case["digits"]}) diverged{REGEN_HINT}',
                )


if __name__ == "__main__":
    unittest.main()

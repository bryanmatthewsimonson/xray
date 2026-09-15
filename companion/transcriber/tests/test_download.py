"""The pre-/post-download duration guard (smoke-failure diagnosis B3).

A direct media-file URL (a podcast .mp3, verified against a real Blubrry
episode) has NO duration in yt-dlp's pre-download probe -- that's the
NORMAL case, not an error. The old guard refused every such URL before
downloading anything, which killed the whole "transcribe anywhere" path
for exactly the files it exists to serve. The fix: only refuse up front
when the probe DOES know the duration and it's over the cap; otherwise
download, then establish the real duration (yt-dlp's own download info,
falling back to ffprobe) and enforce the cap against THAT before any GPU
work -- so an over-long file still fails before the expensive stage, and
an unknown-duration file after download proceeds (loudly logged) rather
than blocking forever.

Network-free by construction: these tests exercise the extracted decision
functions directly (_check_duration_before_download /
_check_duration_after_download / _ffprobe_duration), never yt-dlp or a
real download.

Run from companion/transcriber/:  uv run --no-sync python -m unittest discover tests
"""

import json
import subprocess
import unittest
from pathlib import Path
from unittest import mock

from transcriber.download import (
    _check_duration_after_download,
    _check_duration_before_download,
    _ffprobe_duration,
)


class CheckDurationBeforeDownload(unittest.TestCase):
    def test_none_duration_does_not_refuse(self):
        # The Blubrry .mp3 case: yt-dlp's pre-download probe returns
        # duration: None for a plain direct media-file URL. Must NOT
        # raise -- this is the whole point of the fix.
        _check_duration_before_download(None, max_duration_s=14400)  # no raise

    def test_zero_duration_does_not_refuse(self):
        _check_duration_before_download(0, max_duration_s=14400)  # no raise

    def test_known_duration_under_cap_does_not_refuse(self):
        _check_duration_before_download(3600, max_duration_s=14400)  # no raise

    def test_known_duration_over_cap_refuses_before_download(self):
        with self.assertRaises(RuntimeError) as ctx:
            _check_duration_before_download(20000, max_duration_s=14400)
        msg = str(ctx.exception)
        self.assertIn("20000", msg)
        self.assertIn("14400", msg)

    def test_known_duration_exactly_at_cap_does_not_refuse(self):
        _check_duration_before_download(14400, max_duration_s=14400)  # no raise


class CheckDurationAfterDownload(unittest.TestCase):
    def test_real_duration_under_cap_proceeds(self):
        _check_duration_after_download(3600, max_duration_s=14400, audio_path=Path("/tmp/x.mp3"))

    def test_real_duration_over_cap_refuses_before_any_gpu_work(self):
        with self.assertRaises(RuntimeError) as ctx:
            _check_duration_after_download(
                20000, max_duration_s=14400, audio_path=Path("/tmp/x.mp3")
            )
        msg = str(ctx.exception)
        self.assertIn("20000", msg)
        self.assertIn("14400", msg)

    def test_still_unknown_duration_proceeds_rather_than_refuses(self):
        # The file exists; WhisperX will decode it regardless. This must
        # NOT raise -- the guard's job is to protect the GPU stage when it
        # CAN, not to block forever when it genuinely can't tell.
        with self.assertLogs("xray-transcriber.download", level="WARNING") as cm:
            _check_duration_after_download(
                None, max_duration_s=14400, audio_path=Path("/tmp/x.mp3")
            )
        # The warning must say the cap could not be enforced -- silence
        # here would be a silently-skipped safety cap.
        self.assertTrue(any("could not be enforced" in line for line in cm.output))


class FfprobeDuration(unittest.TestCase):
    def test_no_ffprobe_on_path_returns_none(self):
        with mock.patch("transcriber.download.shutil.which", return_value=None):
            self.assertIsNone(_ffprobe_duration(Path("/tmp/x.mp3")))

    def test_parses_ffprobe_json_output(self):
        completed = subprocess.CompletedProcess(
            args=["ffprobe"], returncode=0,
            stdout=json.dumps({"format": {"duration": "123.45"}}), stderr="",
        )
        with mock.patch("transcriber.download.shutil.which", return_value="/usr/bin/ffprobe"), \
                mock.patch("transcriber.download.subprocess.run", return_value=completed):
            self.assertEqual(_ffprobe_duration(Path("/tmp/x.mp3")), 123.45)

    def test_ffprobe_failure_returns_none_not_raise(self):
        with mock.patch("transcriber.download.shutil.which", return_value="/usr/bin/ffprobe"), \
                mock.patch(
                    "transcriber.download.subprocess.run",
                    side_effect=subprocess.CalledProcessError(1, ["ffprobe"]),
                ):
            self.assertIsNone(_ffprobe_duration(Path("/tmp/x.mp3")))

    def test_ffprobe_timeout_returns_none_not_raise(self):
        with mock.patch("transcriber.download.shutil.which", return_value="/usr/bin/ffprobe"), \
                mock.patch(
                    "transcriber.download.subprocess.run",
                    side_effect=subprocess.TimeoutExpired(["ffprobe"], 30),
                ):
            self.assertIsNone(_ffprobe_duration(Path("/tmp/x.mp3")))

    def test_malformed_ffprobe_output_returns_none_not_raise(self):
        completed = subprocess.CompletedProcess(
            args=["ffprobe"], returncode=0, stdout="not json", stderr="",
        )
        with mock.patch("transcriber.download.shutil.which", return_value="/usr/bin/ffprobe"), \
                mock.patch("transcriber.download.subprocess.run", return_value=completed):
            self.assertIsNone(_ffprobe_duration(Path("/tmp/x.mp3")))

    def test_zero_duration_from_ffprobe_is_treated_as_unknown(self):
        completed = subprocess.CompletedProcess(
            args=["ffprobe"], returncode=0,
            stdout=json.dumps({"format": {"duration": "0"}}), stderr="",
        )
        with mock.patch("transcriber.download.shutil.which", return_value="/usr/bin/ffprobe"), \
                mock.patch("transcriber.download.subprocess.run", return_value=completed):
            self.assertIsNone(_ffprobe_duration(Path("/tmp/x.mp3")))


class RealBlubrryUrlProbe(unittest.TestCase):
    """Proves the decision logic against the ACTUAL smoke-failure input --
    not just an asserted None literal. The probe metadata below is pasted
    straight from a real run of the read-only yt-dlp binary against the
    Blubrry URL named in the smoke-failure diagnosis (B3):

        yt-dlp --no-warnings -j --skip-download <url>
        -> {'duration': None, 'filesize': None, 'extractor': 'generic',
            'title': 'LDS_Church_Lawsuit_Gets_Pushback_From_ACLU_EFF', 'ext': 'mp3'}

    See .superpowers/sdd/2026-08-13-transcribe-anywhere/smoke-fix-report.md
    for the full captured command + output.
    """

    def test_real_blubrry_probe_duration_proceeds_rather_than_refuses(self):
        real_probe_info = {
            "duration": None,
            "filesize": None,
            "extractor": "generic",
            "title": "LDS_Church_Lawsuit_Gets_Pushback_From_ACLU_EFF",
            "ext": "mp3",
        }
        # This is exactly what download_audio does with `info` before the
        # old code's blanket refusal: no raise means the download proceeds.
        _check_duration_before_download(real_probe_info["duration"], max_duration_s=14400)


if __name__ == "__main__":
    unittest.main()

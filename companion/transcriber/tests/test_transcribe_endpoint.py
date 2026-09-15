"""POST /transcribe admission + dedupe, and the /health capability flag.

Pins the generic-URL funnel: any admitted https URL enqueues, a refused
URL 400s with the reason, YouTube dedupe still keys on the video id (so
youtu.be/X and watch?v=X remain ONE job), and two DIFFERENT generic URLs
never collapse into one.

Endpoints are called as plain functions — no TestClient, no httpx dep
(the test_server_keys.py rule).  DNS is never touched: the admission
gate's resolver is patched out.

Run from companion/transcriber/:  uv run python -m unittest discover tests
"""

import unittest
from unittest import mock

from fastapi import HTTPException

from transcriber import server
from transcriber.jobs import JobStore


class TranscribeEndpoint(unittest.TestCase):
    def setUp(self):
        # A fresh store per test so dedupe assertions are independent.
        # (The module-level queues just accumulate ids; no worker thread
        # runs in tests — threads start only in server.main().)
        self._real_store = server.store
        server.store = JobStore()
        self.addCleanup(lambda: setattr(server, "store", self._real_store))
        # Admission must never hit the network.
        resolve = mock.patch.object(
            server.media_url, "_addresses_are_global", return_value=True)
        self.addCleanup(resolve.stop)
        resolve.start()

    def post(self, url):
        return server.transcribe(server.TranscribeRequest(url=url))

    def test_generic_https_url_is_accepted(self):
        resp = self.post("https://mormonstories.org/podcast/ep-1/")
        self.assertIn("job_id", resp)
        job = server.store.get(resp["job_id"])
        self.assertTrue(job.media_key.startswith("u_"))
        # The URL handed to yt-dlp is the one the user gave, unrewritten.
        self.assertEqual(job.url, "https://mormonstories.org/podcast/ep-1/")

    def test_http_url_is_refused_with_the_reason(self):
        with self.assertRaises(HTTPException) as ctx:
            self.post("http://example.com/a.mp3")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("https", ctx.exception.detail)

    def test_private_address_is_refused(self):
        with mock.patch.object(server.media_url, "_addresses_are_global",
                               return_value=False):
            with self.assertRaises(HTTPException) as ctx:
                self.post("https://internal.example/a.mp3")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("private", ctx.exception.detail)

    def test_youtube_dedupe_still_keys_on_the_video_id(self):
        first = self.post("https://www.youtube.com/watch?v=abc123DEF45")
        second = self.post("https://youtu.be/abc123DEF45")
        self.assertEqual(first["job_id"], second["job_id"])
        self.assertEqual(server.store.get(first["job_id"]).media_key, "abc123DEF45")

    def test_distinct_generic_urls_do_not_collapse(self):
        first = self.post("https://example.com/player?episode=1")
        second = self.post("https://example.com/player?episode=2")
        self.assertNotEqual(first["job_id"], second["job_id"])

    def test_health_advertises_generic_urls(self):
        body = server.health()
        self.assertIs(body["generic_urls"], True)
        self.assertIs(body["request_provider"], True)  # unchanged

    def test_health_reports_cookie_config_without_leaking_values(self):
        """2026-08-23: a paid-Substack session failed identically with
        and without TRANSCRIBER_COOKIES_FILE set, and nothing showed
        whether the service had loaded it.  Presence + readability +
        the host list only — never the file path, never cookie values."""
        import tempfile
        from transcriber import config

        body = server.health()
        self.assertIn("cookies", body)
        self.assertFalse(body["cookies"]["configured"])

        with tempfile.NamedTemporaryFile(suffix=".txt") as f:
            old_file, old_hosts = config.COOKIES_FILE, config.COOKIES_HOSTS
            try:
                config.COOKIES_FILE = f.name
                config.COOKIES_HOSTS = "youtube.com, WWW.WeTheFifth.com"
                body = server.health()
                self.assertTrue(body["cookies"]["configured"])
                self.assertTrue(body["cookies"]["readable"])
                self.assertEqual(body["cookies"]["hosts"],
                                 ["www.wethefifth.com", "youtube.com"])
                self.assertNotIn(f.name, str(body), "the file path never rides /health")
                config.COOKIES_FILE = "/nonexistent/cookies.txt"
                self.assertFalse(server.health()["cookies"]["readable"])
            finally:
                config.COOKIES_FILE, config.COOKIES_HOSTS = old_file, old_hosts


if __name__ == "__main__":
    unittest.main()

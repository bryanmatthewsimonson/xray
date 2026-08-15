"""URL admission + media identity for the generic transcribe funnel.

The invariants: https only, no embedded credentials, public unicast
hosts only (the SSRF gate on a loopback service that shells out to
yt-dlp), YouTube URLs keep their bare video id as the media key so
existing job records and server-side dedupe are unchanged, and the key
normalization strips tracking noise WITHOUT merging distinct episodes.

Run from companion/transcriber/:  uv run python -m unittest discover tests
"""

import socket
import unittest

from transcriber.media_url import (
    cookies_allowed_for,
    media_key_for,
    validate_media_url,
    youtube_video_id,
)


def fake_resolver(addresses):
    """A getaddrinfo stand-in returning fixed addresses (no network)."""
    def _resolve(host, port, *args, **kwargs):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", (addr, 443))
            for addr in addresses
        ]
    return _resolve


PUBLIC = fake_resolver(["93.184.216.34"])


class YoutubeVideoId(unittest.TestCase):
    def test_watch_short_and_path_forms(self):
        self.assertEqual(
            youtube_video_id("https://www.youtube.com/watch?v=abc123DEF45"),
            "abc123DEF45",
        )
        self.assertEqual(youtube_video_id("https://youtu.be/abc123DEF45"), "abc123DEF45")
        self.assertEqual(
            youtube_video_id("https://www.youtube.com/shorts/abc123DEF45"),
            "abc123DEF45",
        )

    def test_non_youtube_is_none_not_an_error(self):
        self.assertIsNone(youtube_video_id("https://mormonstories.org/podcast/ep-1/"))
        self.assertIsNone(youtube_video_id("not a url at all"))


class Admission(unittest.TestCase):
    def test_accepts_a_public_https_url_unmodified(self):
        url = "https://mormonstories.org/podcast/ep-1/?utm_source=x"
        self.assertEqual(validate_media_url(url, resolver=PUBLIC), url)

    def test_strips_surrounding_whitespace_only(self):
        self.assertEqual(
            validate_media_url("  https://example.com/a.mp3  ", resolver=PUBLIC),
            "https://example.com/a.mp3",
        )

    def test_rejects_http(self):
        with self.assertRaises(ValueError) as ctx:
            validate_media_url("http://example.com/a.mp3", resolver=PUBLIC)
        self.assertIn("https", str(ctx.exception))

    def test_rejects_embedded_credentials(self):
        with self.assertRaises(ValueError):
            validate_media_url("https://user:pw@example.com/a.mp3", resolver=PUBLIC)

    def test_rejects_loopback_private_and_link_local(self):
        for addr in ("127.0.0.1", "10.0.0.5", "192.168.1.9", "169.254.169.254"):
            with self.assertRaises(ValueError, msg=addr):
                validate_media_url("https://internal.example/a.mp3",
                                   resolver=fake_resolver([addr]))

    def test_rejects_when_any_resolved_address_is_private(self):
        # A host that resolves to both public and private addresses is
        # refused: yt-dlp may pick either.
        with self.assertRaises(ValueError):
            validate_media_url("https://mixed.example/a.mp3",
                               resolver=fake_resolver(["93.184.216.34", "10.0.0.5"]))

    def test_rejects_an_unresolvable_host(self):
        def boom(*args, **kwargs):
            raise socket.gaierror("nope")
        with self.assertRaises(ValueError):
            validate_media_url("https://nx.example/a.mp3", resolver=boom)

    def test_rejects_junk(self):
        for bad in ("", "   ", "not a url", "ftp://example.com/a.mp3"):
            with self.assertRaises(ValueError, msg=bad):
                validate_media_url(bad, resolver=PUBLIC)


class MediaKey(unittest.TestCase):
    def test_youtube_keeps_the_bare_video_id(self):
        # Back-compat: existing xray:transcribe:job:<videoId> records and
        # server-side dedupe must behave exactly as before.
        self.assertEqual(
            media_key_for("https://www.youtube.com/watch?v=abc123DEF45"),
            "abc123DEF45",
        )
        self.assertEqual(media_key_for("https://youtu.be/abc123DEF45"), "abc123DEF45")

    def test_generic_url_gets_a_prefixed_hash(self):
        key = media_key_for("https://mormonstories.org/podcast/ep-1/")
        self.assertTrue(key.startswith("u_"))
        self.assertEqual(len(key), 18)  # "u_" + 16 hex

    def test_tracking_params_and_case_do_not_fork_the_key(self):
        base = media_key_for("https://mormonstories.org/podcast/ep-1/")
        for variant in (
            "https://MormonStories.org/podcast/ep-1/",
            "https://mormonstories.org/podcast/ep-1/?utm_source=twitter",
            "https://mormonstories.org/podcast/ep-1/#t=30",
            "https://mormonstories.org:443/podcast/ep-1/",
        ):
            self.assertEqual(media_key_for(variant), base, variant)

    def test_meaningful_query_params_still_separate_episodes(self):
        # Under-normalize rather than merge distinct media (the recorded
        # trap: over-normalization collapses two episodes into one job).
        a = media_key_for("https://example.com/player?episode=1")
        b = media_key_for("https://example.com/player?episode=2")
        self.assertNotEqual(a, b)

    def test_param_order_does_not_fork_the_key(self):
        a = media_key_for("https://example.com/p?a=1&b=2")
        b = media_key_for("https://example.com/p?b=2&a=1")
        self.assertEqual(a, b)


class CookieScope(unittest.TestCase):
    """The cookie jar is a credential. It goes to YouTube and nowhere
    else unless the user names the host — widening the URL funnel must
    not widen who gets the user's cookies."""

    DEFAULT = "youtube.com,www.youtube.com,m.youtube.com,music.youtube.com,youtu.be"

    def test_youtube_still_gets_cookies(self):
        self.assertTrue(cookies_allowed_for(
            "https://www.youtube.com/watch?v=abc123DEF45", self.DEFAULT))
        self.assertTrue(cookies_allowed_for("https://youtu.be/abc123DEF45", self.DEFAULT))

    def test_an_arbitrary_host_does_not(self):
        self.assertFalse(cookies_allowed_for(
            "https://mormonstories.org/podcast/ep-1/", self.DEFAULT))
        self.assertFalse(cookies_allowed_for("https://evil.example/steal", self.DEFAULT))

    def test_a_named_host_does(self):
        self.assertTrue(cookies_allowed_for(
            "https://mormonstories.org/podcast/ep-1/",
            self.DEFAULT + ",mormonstories.org"))

    def test_matching_is_case_insensitive_and_whitespace_tolerant(self):
        self.assertTrue(cookies_allowed_for(
            "https://MormonStories.org/x", " mormonstories.org , foo.example "))

    def test_a_subdomain_is_not_the_named_host(self):
        # Exact host match only: "example.com" must not authorize
        # "evil.example.com".
        self.assertFalse(cookies_allowed_for("https://evil.example.com/x", "example.com"))

    def test_empty_list_means_no_cookies_anywhere(self):
        self.assertFalse(cookies_allowed_for("https://www.youtube.com/watch?v=a", ""))


if __name__ == "__main__":
    unittest.main()

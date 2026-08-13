# Transcribe Anywhere Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let X-Ray's "Transcribe" feature produce a diarized transcript from **any https media URL** — podcast episodes, alt-platform video, social video, and long-tail pages with embedded players — not only YouTube.

**Architecture:** The companion's yt-dlp downloader is already source-generic; the YouTube lock is one server-side URL validator plus five extension-side gates. This plan replaces the validator with an https + public-host admission check, generalizes job identity from `video_id` to a `media_key` (YouTube URLs keep their video id, so existing resume records and dedupe behave identically), advertises the new capability on `/health` so old companions are refused client-side with the fix named, and un-gates the extension trigger/adoption path. Two entry points ship: capture-first (reader button on media signals + a "Transcribe from source" action in the Media modal) and a portal "Transcribe a URL" panel.

**Tech Stack:** MV3 WebExtension, plain ES modules, no transpile (esbuild bundles only). Companion: Python 3.11–3.13, FastAPI, uv-managed, `unittest`. Extension tests: `node --test` over `.mjs`.

## Global Constraints

Every task's requirements implicitly include this section.

- **Wire format: NONE.** No new NOSTR kinds, no new tags, no new tag values. The Phase-22 `media` whitelist stays exactly `'podcast'|'video'` (`src/shared/event-builder.js:374-376`). `transcript_lang` emission stays sourced from `article.youtube.transcripts` **only** — a non-YouTube diarized capture emits no `transcript_lang`, exactly as Phase-21 imports and Phase-22 attaches do today. Task 7 machine-checks this.
- **Loopback pin is untouchable.** `src/shared/transcriber-client.js` base URLs stay pinned to loopback literals; only the port is configurable. No task may introduce a configurable remote host.
- **The absent-companion degradation contract is tested, not aspirational.** Flag off ⇒ no surface exists. Companion absent ⇒ `{ok: false, unreachable: true, error}` naming the fix. Old companion + non-YouTube URL ⇒ refused client-side before any POST.
- **Result-object contract:** every `transcriber-client.js` function returns `{ok: true, …}` / `{ok: false, error}` and **never throws**.
- **Indentation: 4 spaces** in JS authored here; **2 spaces** in files ported from the userscript (`content-extractor.js`, `content/ui.js`, `crypto.js`, `event-builder.js`). Match the file you are editing. Python: 4 spaces.
- **Logging:** `Utils.log` / `Utils.error` in extension code (never bare `console.log`; existing `console.warn` inside `reader/index.js` catch blocks is pre-existing and may be matched). Python: the module `log` logger.
- **User-visible strings** use "X-Ray" (hyphenated). CSS classes are `xr-*`.
- **Companion tests are `unittest`, NOT pytest.** Run from `companion/transcriber/`: `uv run python -m unittest discover tests`. Extension tests: `npm test`, single file `node --test tests/<file>.test.mjs`.
- **`npm install` must have been run** or extension tests fail with `ERR_MODULE_NOT_FOUND` — that is not a regression.
- **Never paste private-key material** (`local_primary_identity`, `local_keys`) into commits or logs. Cloud API keys are never logged and never leave the SW as values — presence booleans only.
- **Commit style:** imperative present, `feat:`/`fix:`/`docs:`/`test:` prefix with scope, e.g. `feat(transcribe): accept any https media URL`.

---

### Task 1: Companion — URL admission + media identity module

**Files:**
- Create: `companion/transcriber/transcriber/media_url.py`
- Test: `companion/transcriber/tests/test_media_url.py`

**Interfaces:**
- Consumes: nothing (pure stdlib).
- Produces, for Task 2:
  - `youtube_video_id(url: str) -> str | None` — the video id for a YouTube URL, else `None`. Never raises.
  - `validate_media_url(url: str, resolver=socket.getaddrinfo) -> str` — returns the URL to hand yt-dlp (stripped, unmodified otherwise), or raises `ValueError` with a user-facing message.
  - `media_key_for(url: str) -> str` — stable dedupe/identity key. YouTube URLs return the bare video id (back-compat with existing job records); everything else returns `"u_" + sha256(normalized)[:16]`.
  - `cookies_allowed_for(url: str, allowed_hosts: str) -> bool` — **the credential-scoping gate**. `download.py` passes `config.COOKIES_FILE` to yt-dlp unconditionally today; that was safe only because YouTube was the sole admissible host. Once any host is admissible, an unscoped cookie jar (typically a full browser export) would be offered to whatever host the user pastes. Cookies are therefore sent **only** to hosts on an explicit list, defaulting to the YouTube hosts — byte-identical to today's behavior.

- [ ] **Step 1: Write the failing test**

Create `companion/transcriber/tests/test_media_url.py`:

```python
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
```


- [ ] **Step 2: Run the test to verify it fails**

Run from `companion/transcriber/`:

```bash
uv run python -m unittest tests.test_media_url -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'transcriber.media_url'`.

- [ ] **Step 3: Write the implementation**

Create `companion/transcriber/transcriber/media_url.py`:

```python
"""URL admission and media identity for the transcribe funnel.

The service hands whatever URL it accepts to yt-dlp, which resolves
page URLs, embedded players, and direct media files alike.  What this
module decides is which URLs are allowed in at all, and what stable key
identifies the media behind one.

SECURITY (the honest statement, mirrored in docs/THREAT_MODEL.md): this
is a loopback service that shells out to yt-dlp, so admitting arbitrary
user-designated URLs creates a blind-SSRF surface.  The gate below is
best-effort — it resolves the hostname and refuses non-global addresses,
but yt-dlp re-resolves DNS and follows redirects itself, so rebinding is
NOT closed.  What bounds the residual risk: the service binds loopback
only, CORS admits browser-extension origins only, an optional shared
token guards every non-/health endpoint, responses never reach a third
party, and the URL is always one the user personally chose to transcribe.

This module never imports heavy dependencies — server.py imports it.
"""

import hashlib
import ipaddress
import re
import socket
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

_YOUTUBE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
}
_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,20}$")
_PATH_PREFIXES = ("/shorts/", "/live/", "/embed/")

# Query parameters that identify a REFERRAL, not the media.  Stripped
# for key purposes only — the URL handed to yt-dlp is never rewritten.
_TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "fbclid", "gclid", "msclkid", "mc_cid", "mc_eid",
    "si", "ref", "ref_src", "ref_url", "source",
}


def youtube_video_id(url: str) -> "str | None":
    """The YouTube video id for ``url``, or None when it is not one."""
    try:
        parsed = urlparse(str(url or "").strip())
    except ValueError:
        return None
    host = (parsed.hostname or "").lower()
    if host not in _YOUTUBE_HOSTS:
        return None
    if host == "youtu.be":
        video_id = parsed.path.lstrip("/").split("/")[0]
    elif parsed.path == "/watch":
        video_id = dict(parse_qsl(parsed.query)).get("v", "")
    else:
        video_id = ""
        for prefix in _PATH_PREFIXES:
            if parsed.path.startswith(prefix):
                video_id = parsed.path[len(prefix):].split("/")[0]
                break
    return video_id if _VIDEO_ID_RE.match(video_id) else None


def _addresses_are_global(host: str, resolver) -> bool:
    """True when EVERY address ``host`` resolves to is global unicast."""
    try:
        infos = resolver(host, 443, 0, socket.SOCK_STREAM)
    except Exception:
        raise ValueError(f"could not resolve {host!r}")
    addresses = [info[4][0] for info in infos if info and len(info) >= 5 and info[4]]
    if not addresses:
        raise ValueError(f"could not resolve {host!r}")
    for addr in addresses:
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            return False
        # is_global is False for private, loopback, link-local,
        # reserved, and multicast ranges — exactly the deny set.
        if not ip.is_global:
            return False
    return True


def validate_media_url(url: str, resolver=socket.getaddrinfo) -> str:
    """Return the URL to hand yt-dlp, or raise ValueError.

    ``resolver`` is injectable so tests never touch the network.
    """
    candidate = str(url or "").strip()
    if not candidate:
        raise ValueError("no URL given")
    try:
        parsed = urlparse(candidate)
    except ValueError:
        raise ValueError("that does not look like a URL")
    if parsed.scheme != "https":
        raise ValueError("only https:// media URLs are supported")
    if parsed.username or parsed.password:
        raise ValueError("URLs with embedded credentials are not accepted")
    host = (parsed.hostname or "").lower()
    if not host:
        raise ValueError("that URL has no host")
    if not _addresses_are_global(host, resolver):
        raise ValueError(
            f"{host} resolves to a private or loopback address; "
            "only public media URLs are accepted"
        )
    return candidate


def media_key_for(url: str) -> str:
    """A stable identity for the media behind ``url``.

    YouTube keeps its BARE video id — the extension's existing
    ``xray:transcribe:job:<videoId>`` records and this server's dedupe
    must not fork when the funnel widens.  Everything else hashes a
    normalized form: lowercase scheme+host, default port and fragment
    dropped, tracking parameters removed, remaining parameters sorted.
    Deliberately UNDER-normalized otherwise — merging two distinct
    episodes into one job is worse than running two jobs.
    """
    video_id = youtube_video_id(url)
    if video_id:
        return video_id
    parsed = urlparse(str(url or "").strip())
    host = (parsed.hostname or "").lower()
    if parsed.port and not ((parsed.scheme == "https" and parsed.port == 443)
                            or (parsed.scheme == "http" and parsed.port == 80)):
        host = f"{host}:{parsed.port}"
    params = sorted(
        (k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True)
        if k.lower() not in _TRACKING_PARAMS
    )
    normalized = urlunparse((
        parsed.scheme.lower(), host, parsed.path, parsed.params,
        urlencode(params), "",
    ))
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return f"u_{digest[:16]}"


def cookies_allowed_for(url: str, allowed_hosts: str) -> bool:
    """May the configured cookie file be used when fetching ``url``?

    THE COOKIE JAR IS A CREDENTIAL.  ``TRANSCRIBER_COOKIES_FILE`` is
    normally a full browser cookie export, and yt-dlp sends whatever
    cookies match the host it fetches.  That was safe while YouTube was
    the only admissible host; once any host is admissible, an unscoped
    jar would hand the user's session cookies to whatever URL they
    pasted — including one chosen for them by a page they were reading.

    So cookies are opt-in PER HOST, defaulting to the YouTube hosts:
    identical behavior to before the funnel widened.  Exact hostname
    match only — a named ``example.com`` must never authorize
    ``evil.example.com``.
    """
    host = (urlparse(str(url or "").strip()).hostname or "").lower()
    if not host:
        return False
    allowed = {
        h.strip().lower()
        for h in str(allowed_hosts or "").split(",")
        if h.strip()
    }
    return host in allowed
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
uv run python -m unittest tests.test_media_url -v
```

Expected: PASS, all cases.

- [ ] **Step 5: Run the whole companion suite (nothing else may regress)**

```bash
uv run python -m unittest discover tests
```

Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add companion/transcriber/transcriber/media_url.py companion/transcriber/tests/test_media_url.py
git commit -m "feat(transcribe): URL admission + media identity module for the generic funnel"
```

---

### Task 2: Companion — accept generic URLs, key jobs by media_key, advertise the capability

**Files:**
- Modify: `companion/transcriber/transcriber/server.py:101-198` (delete the YouTube validator, rewrite the endpoint), `:229-246` (`/health`), `:299-323` (`_run_job` spec + log)
- Modify: `companion/transcriber/transcriber/jobs.py:36` (field rename), `:70-84` (dedupe)
- Modify: `companion/transcriber/transcriber/config.py:36` (the new cookie-host knob, beside `COOKIES_FILE`)
- Modify: `companion/transcriber/transcriber/download.py:35-38` (scope the cookie jar)
- Modify: `companion/transcriber/transcriber/providers/__init__.py:12-13` (docstring accuracy)
- Modify: `companion/transcriber/tests/test_server_keys.py:20-25, :60-70, :140-145`
- Test: `companion/transcriber/tests/test_transcribe_endpoint.py` (new)

**Interfaces:**
- Consumes from Task 1: `validate_media_url(url, resolver=...)`, `media_key_for(url)`, `cookies_allowed_for(url, allowed_hosts)`.
- Produces, for Tasks 4 and 5:
  - `POST /transcribe` accepts any admitted https URL; 400 with the ValueError text otherwise.
  - `GET /health` gains `"generic_urls": True` (additive; older extensions ignore it).
  - `Job.media_key` replaces `Job.video_id`; dedupe is by `media_key`.
  - `config.COOKIES_HOSTS` — the hosts the cookie jar may be used for, default the YouTube set.

**Note for the implementer:** `spec.json`'s `video_id` field is **written but never read** — `pipeline.py` and both cloud providers derive the result's `video_id` from yt-dlp's own `info.get("id")`. Renaming it is therefore safe; the result object's `video_id` field is untouched, so the extension-facing result shape does not change.

- [ ] **Step 1: Write the failing test**

Create `companion/transcriber/tests/test_transcribe_endpoint.py`. **House idiom:** the
endpoint is called as a plain function, never through `fastapi.testclient.TestClient`
— `httpx` is not a dependency and `tests/test_server_keys.py:80` states the rule
("POST /transcribe called as a plain function (no TestClient dep)"). Follow it.

```python
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


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to verify it fails**

```bash
uv run python -m unittest tests.test_transcribe_endpoint -v
```

Expected: FAIL — `AttributeError: module 'transcriber.server' has no attribute 'media_url'` (the patch target does not exist yet).

- [ ] **Step 3: Replace the validator and wire the module in**

In `companion/transcriber/transcriber/server.py`, replace the entire `# --- URL validation ---` block (lines 101-137: `_ALLOWED_HOSTS`, `_VIDEO_ID_RE`, `_PATH_PREFIXES`, `extract_video_id`) with:

```python
# --- URL validation ------------------------------------------------------
# Admission and media identity live in media_url.py (import kept module-
# level so tests can patch `server.media_url.<fn>`).  The funnel accepts
# any public https URL: yt-dlp resolves page URLs, embedded players, and
# direct media files alike.  See that module's docstring for the honest
# SSRF statement.
```

Add `from . import media_url` to the relative-import block at line 38, making it:

```python
from . import __version__, config, media_url, providers
```

Remove the now-unused `re` and `parse_qs` imports **only if nothing else in the file uses them** — check with `grep -n 'parse_qs\|re\.' companion/transcriber/transcriber/server.py` before deleting; `urlparse` stays if still referenced.

- [ ] **Step 4: Rewrite the endpoint's admission + identity**

In `server.py`, replace lines 154-198 (`transcribe`) with:

```python
@app.post("/transcribe", status_code=202)
def transcribe(body: TranscribeRequest) -> dict:
    try:
        url = media_url.validate_media_url(body.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    media_key = media_url.media_key_for(url)

    provider = (body.provider or config.PROVIDER).strip().lower()
    api_key = (body.api_key or "").strip() or None
    problem = providers.validate_job(provider, has_request_key=api_key is not None)
    if problem is not None:
        raise HTTPException(status_code=400, detail=problem)

    job = Job(
        job_id=str(uuid.uuid4()),
        url=url,
        media_key=media_key,
        provider=provider,
        api_key=api_key if providers.is_cloud(provider) else None,
    )
    job, created = store.add_or_get_active(job)
    if not created:
        # An active (queued/running) job for this media already exists —
        # whatever engine it was started with wins (dedupe by media).
        # The response names that engine so the client can tell the
        # user the truth instead of assuming its request was honored.
        return {"job_id": job.job_id, "provider": job.provider}
    # Cap ACTIVE jobs (this one included), so cancelling really frees
    # capacity — PER POOL: a full local backlog must not reject cloud
    # jobs that idle cloud workers could run immediately. Loopback
    # single-user service: the tiny add-then-check window between
    # concurrent POSTs is acceptable.
    pool_is_cloud = providers.is_cloud(provider)
    if store.active_count_in_pool(pool_is_cloud) > config.QUEUE_MAX:
        store.remove(job.job_id)
        raise HTTPException(
            status_code=429,
            detail=(
                f"the {'cloud' if pool_is_cloud else 'local'} queue is full "
                f"({config.QUEUE_MAX} jobs); cancel one or try again later"
            ),
        )
    _queue_for(provider).put(job.job_id)
    log.info("queued job %s for media %s (%s)", job.job_id, media_key, job.provider)
    return {"job_id": job.job_id, "provider": job.provider}
```

- [ ] **Step 5: Rename the job field and its dedupe**

In `companion/transcriber/transcriber/jobs.py` line 36, replace `video_id: str` with:

```python
    # Stable identity for the MEDIA behind the URL (media_url.media_key_for):
    # a YouTube video id, or "u_<hash>" for any other admitted URL.  The
    # dedupe unit — two requests for the same media join one job.
    media_key: str
```

In `jobs.py` `add_or_get_active` (lines 70-84), replace the docstring and comparison:

```python
    def add_or_get_active(self, job: Job) -> "tuple[Job, bool]":
        """Add ``job`` unless an ACTIVE job for the same media exists.

        Returns ``(job, True)`` when the new job was added, or
        ``(existing, False)`` when a queued/running job for the same media
        was found — the caller returns that job's id instead of enqueueing
        a duplicate.
        """
        with self.lock:
            for existing in self._jobs.values():
                if (
                    existing.media_key == job.media_key
                    and existing.status in ("queued", "running")
                ):
                    return existing, False
            self._jobs[job.job_id] = job
            self._prune_locked()
            return job, True
```

In `server.py` `_run_job` (lines 305-315 and 323), update the spec write and the log line:

```python
    spec_path.write_text(
        json.dumps(
            {
                "job_id": job.job_id,
                "url": job.url,
                "media_key": job.media_key,
                "provider": job.provider,
            }
        ),
        encoding="utf-8",
    )
```

and

```python
    log.info("starting job %s (%s)", job.job_id, job.media_key)
```

In `providers/__init__.py` lines 12-13, correct the docstring:

```python
taking the job spec ({job_id, url, media_key, provider}) and returning
the result object the extension consumes ({video_id, title, channel,
```

- [ ] **Step 5b: Scope the cookie jar to named hosts**

This is the step that keeps widening the URL funnel from also widening
who receives the user's cookies. In `companion/transcriber/transcriber/config.py`,
beside `COOKIES_FILE` (line ~33), add:

```python
# WHICH HOSTS the cookie file may be used for.  yt-dlp sends whatever
# cookies match the host it fetches, and TRANSCRIBER_COOKIES_FILE is
# normally a full browser export — so once the service admits arbitrary
# URLs (the Transcribe Anywhere wave), an unscoped jar would offer the
# user's sessions to any host they paste.  Default = the YouTube hosts,
# i.e. exactly the pre-wave behavior.  Comma-separated, exact hostnames.
COOKIES_HOSTS: str = os.environ.get(
    "TRANSCRIBER_COOKIES_HOSTS",
    "youtube.com,www.youtube.com,m.youtube.com,music.youtube.com,youtu.be",
)
```

In `companion/transcriber/transcriber/download.py`, replace lines 35-37:

```python
    base_opts = {"quiet": True, "no_warnings": True, "noplaylist": True}
    # Cookies are a credential: only for hosts the user named
    # (TRANSCRIBER_COOKIES_HOSTS, default YouTube) — never for every URL
    # the widened funnel now admits.  See media_url.cookies_allowed_for.
    if config.COOKIES_FILE and media_url.cookies_allowed_for(url, config.COOKIES_HOSTS):
        base_opts["cookiefile"] = config.COOKIES_FILE
```

and extend `download.py`'s import (line 18) to:

```python
from . import config, media_url
```

Add a test to `companion/transcriber/tests/test_media_url.py`'s `CookieScope`
class asserting the shipped default authorizes YouTube and nothing else:

```python
    def test_the_shipped_default_authorizes_youtube_only(self):
        from transcriber import config
        self.assertTrue(cookies_allowed_for(
            "https://www.youtube.com/watch?v=abc123DEF45", config.COOKIES_HOSTS))
        self.assertFalse(cookies_allowed_for(
            "https://mormonstories.org/podcast/ep-1/", config.COOKIES_HOSTS))
```

- [ ] **Step 6: Add the capability flag to /health**

In `server.py` `health()`, add one field after `"request_provider": True,`:

```python
        # Capability flag: this build admits ANY public https media URL
        # (yt-dlp resolves it), not just YouTube.  The extension refuses
        # to send a non-YouTube URL to a build without this.
        "generic_urls": True,
```

- [ ] **Step 7: Update the existing key-hygiene tests to the renamed field**

In `companion/transcriber/tests/test_server_keys.py`, change the three `video_id` sites:

- line ~23 in `make_job`: `video_id="abc123DEF45"` → `media_key="abc123DEF45"`
- line ~64 (the spec-dict assertion): `"video_id": job.video_id,` → `"media_key": job.media_key,`
- line ~142: `video_id=f"{tag}{i}"` → `media_key=f"{tag}{i}"`

- [ ] **Step 8: Run both suites**

```bash
uv run python -m unittest discover tests
```

Expected: OK — the new endpoint tests pass and `test_server_keys` / `test_cloud_providers` / `test_normalize` stay green.

- [ ] **Step 9: Commit**

```bash
git add companion/transcriber/transcriber/ companion/transcriber/tests/
git commit -m "feat(transcribe): accept any public https media URL, key jobs by media_key

Scopes the yt-dlp cookie jar to TRANSCRIBER_COOKIES_HOSTS (default: the
YouTube hosts) in the same change — widening which URLs are admissible
must not widen which hosts receive the user's cookies."
```

---

### Task 3: Extension — the mirrored media-key module

**Files:**
- Create: `src/shared/media-key.js`
- Test: `tests/media-key.test.mjs`

**Interfaces:**
- Consumes: `Crypto.sha256(message) -> Promise<hexString>` from `src/shared/crypto.js`.
- Produces, for Tasks 5, 9, 11, 12:
  - `youtubeVideoId(url) -> string|null`
  - `mediaKeyForUrl(url) -> Promise<string>` — mirrors the companion's rule exactly.
  - `mediaKeyForArticle(article) -> Promise<string>` — prefers `article.youtube.videoId`, else `mediaKeyForUrl(article.url)`.

- [ ] **Step 1: Write the failing test**

Create `tests/media-key.test.mjs`:

```javascript
// Media identity, extension side — the MIRROR of the companion's
// media_url.media_key_for. Two rules matter: a YouTube capture keeps
// its bare video id (existing xray:transcribe:job:<videoId> records
// must resume, not orphan), and two distinct media never collapse.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

globalThis.crypto = globalThis.crypto || webcrypto;

const { youtubeVideoId, mediaKeyForUrl, mediaKeyForArticle } =
    await import('../src/shared/media-key.js');

test('youtubeVideoId: watch / youtu.be / shorts forms, null otherwise', () => {
    assert.equal(youtubeVideoId('https://www.youtube.com/watch?v=abc123DEF45'), 'abc123DEF45');
    assert.equal(youtubeVideoId('https://youtu.be/abc123DEF45'), 'abc123DEF45');
    assert.equal(youtubeVideoId('https://www.youtube.com/shorts/abc123DEF45'), 'abc123DEF45');
    assert.equal(youtubeVideoId('https://mormonstories.org/podcast/ep-1/'), null);
    assert.equal(youtubeVideoId('junk'), null);
});

test('mediaKeyForUrl: YouTube keeps the bare video id (record back-compat)', async () => {
    assert.equal(await mediaKeyForUrl('https://www.youtube.com/watch?v=abc123DEF45'), 'abc123DEF45');
});

test('mediaKeyForUrl: a generic URL hashes to u_<16 hex>', async () => {
    const key = await mediaKeyForUrl('https://mormonstories.org/podcast/ep-1/');
    assert.match(key, /^u_[0-9a-f]{16}$/);
});

test('mediaKeyForUrl: tracking params, case, port and fragment do not fork the key', async () => {
    const base = await mediaKeyForUrl('https://mormonstories.org/podcast/ep-1/');
    for (const variant of [
        'https://MormonStories.org/podcast/ep-1/',
        'https://mormonstories.org/podcast/ep-1/?utm_source=twitter',
        'https://mormonstories.org/podcast/ep-1/#t=30',
        'https://mormonstories.org:443/podcast/ep-1/'
    ]) {
        assert.equal(await mediaKeyForUrl(variant), base, variant);
    }
});

test('mediaKeyForUrl: meaningful params still separate episodes; order does not', async () => {
    assert.notEqual(
        await mediaKeyForUrl('https://example.com/player?episode=1'),
        await mediaKeyForUrl('https://example.com/player?episode=2')
    );
    assert.equal(
        await mediaKeyForUrl('https://example.com/p?a=1&b=2'),
        await mediaKeyForUrl('https://example.com/p?b=2&a=1')
    );
});

test('mediaKeyForArticle: youtube.videoId wins, else the URL rule', async () => {
    assert.equal(
        await mediaKeyForArticle({ url: 'https://www.youtube.com/watch?v=abc123DEF45', youtube: { videoId: 'abc123DEF45' } }),
        'abc123DEF45'
    );
    assert.match(
        await mediaKeyForArticle({ url: 'https://mormonstories.org/podcast/ep-1/' }),
        /^u_[0-9a-f]{16}$/
    );
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --test tests/media-key.test.mjs
```

Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `../src/shared/media-key.js`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/media-key.js`:

```javascript
// Media identity — the extension-side MIRROR of the companion's
// transcriber/media_url.py `media_key_for`. Both sides must agree: the
// companion dedupes active jobs by this key and the reader stores its
// resumable job record under `xray:transcribe:job:<mediaKey>`.
//
// The one rule that is not merely aesthetic: a YouTube URL yields its
// BARE video id, because that is what existing job records are keyed
// by — changing it would orphan every in-flight transcription.
//
// Deliberately UNDER-normalizes everything else: merging two distinct
// episodes into one job is worse than running two jobs.

import { Crypto } from './crypto.js';

const YOUTUBE_HOSTS = new Set([
    'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'
]);
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;
const PATH_PREFIXES = ['/shorts/', '/live/', '/embed/'];

// Referral noise, not media identity. Mirrors _TRACKING_PARAMS.
const TRACKING_PARAMS = new Set([
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'fbclid', 'gclid', 'msclkid', 'mc_cid', 'mc_eid',
    'si', 'ref', 'ref_src', 'ref_url', 'source'
]);

function parse(url) {
    try { return new URL(String(url || '').trim()); } catch (_) { return null; }
}

/** The YouTube video id for `url`, or null when it is not one. */
export function youtubeVideoId(url) {
    const u = parse(url);
    if (!u || !YOUTUBE_HOSTS.has(u.hostname.toLowerCase())) return null;
    let id = '';
    if (u.hostname.toLowerCase() === 'youtu.be') {
        id = u.pathname.replace(/^\/+/, '').split('/')[0];
    } else if (u.pathname === '/watch') {
        id = u.searchParams.get('v') || '';
    } else {
        for (const prefix of PATH_PREFIXES) {
            if (u.pathname.startsWith(prefix)) {
                id = u.pathname.slice(prefix.length).split('/')[0];
                break;
            }
        }
    }
    return VIDEO_ID_RE.test(id) ? id : '';
}

/** Stable identity for the media behind `url`. */
export async function mediaKeyForUrl(url) {
    const videoId = youtubeVideoId(url);
    if (videoId) return videoId;
    const u = parse(url);
    if (!u) return `u_${(await Crypto.sha256(String(url || ''))).slice(0, 16)}`;
    const params = [...u.searchParams.entries()]
        .filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const query = params.length
        ? `?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`
        : '';
    const port = (u.port && !((u.protocol === 'https:' && u.port === '443')
        || (u.protocol === 'http:' && u.port === '80'))) ? `:${u.port}` : '';
    const normalized = `${u.protocol.toLowerCase()}//${u.hostname.toLowerCase()}${port}${u.pathname}${query}`;
    return `u_${(await Crypto.sha256(normalized)).slice(0, 16)}`;
}

/** The media key for a captured article. */
export async function mediaKeyForArticle(article) {
    const a = article || {};
    if (a.youtube && a.youtube.videoId) return String(a.youtube.videoId);
    return mediaKeyForUrl(a.url);
}
```

**Note:** `youtubeVideoId` returns `''` (falsy) rather than `null` when the host is YouTube but no id parses — the test asserts `null` only for non-YouTube hosts, and every caller treats both as "no id". Keep the empty string; do not "tidy" it into `null` without updating the test.

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/media-key.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/media-key.js tests/media-key.test.mjs
git commit -m "feat(transcribe): mirror the companion's media identity rule extension-side"
```

---

### Task 4: Extension — refuse a generic URL on an old companion

**Files:**
- Modify: `src/shared/transcriber-client.js:172-230` (`startTranscription`)
- Test: `tests/transcriber-client.test.mjs` (append)

**Interfaces:**
- Consumes from Task 3: `youtubeVideoId(url)`.
- Produces: `startTranscription(mediaUrl, {port, fetchFn, provider})` unchanged in shape, with one new refusal path — a non-YouTube URL against a companion whose `/health` lacks `generic_urls` returns `{ok: false, error}` **before** any POST.

- [ ] **Step 1: Write the failing test**

Append to `tests/transcriber-client.test.mjs`:

```javascript
test('startTranscription: a non-YouTube URL is refused on a companion without generic_urls', async () => {
    const calls = [];
    const fetchFn = async (url, init) => {
        calls.push(url);
        if (url.endsWith('/health')) {
            return { ok: true, json: async () => ({ status: 'ok', request_provider: true }) };
        }
        return { ok: true, json: async () => ({ job_id: 'j1' }) };
    };
    const out = await startTranscription('https://mormonstories.org/podcast/ep-1/', { port: 8756, fetchFn });
    assert.equal(out.ok, false);
    assert.match(out.error, /too old/i);
    assert.ok(!calls.some((u) => u.endsWith('/transcribe')), 'never POSTs to an incapable companion');
});

test('startTranscription: a non-YouTube URL posts when generic_urls is advertised', async () => {
    const fetchFn = async (url) => {
        if (url.endsWith('/health')) {
            return { ok: true, json: async () => ({ status: 'ok', request_provider: true, generic_urls: true }) };
        }
        return { ok: true, json: async () => ({ job_id: 'j2', provider: 'local' }) };
    };
    const out = await startTranscription('https://mormonstories.org/podcast/ep-1/', { port: 8756, fetchFn });
    assert.equal(out.ok, true);
    assert.equal(out.jobId, 'j2');
});

test('startTranscription: a YouTube URL never pays the generic capability probe', async () => {
    const calls = [];
    const fetchFn = async (url) => {
        calls.push(url);
        return { ok: true, json: async () => ({ job_id: 'j3' }) };
    };
    const out = await startTranscription('https://www.youtube.com/watch?v=abc123DEF45', { port: 8756, fetchFn });
    assert.equal(out.ok, true);
    assert.ok(!calls.some((u) => u.endsWith('/health')), 'no health probe for the YouTube path with no engine chosen');
});

test('startTranscription: an unreachable companion falls through to the normal error', async () => {
    const fetchFn = async () => { throw new Error('ECONNREFUSED'); };
    const out = await startTranscription('https://mormonstories.org/podcast/ep-1/', { port: 8756, fetchFn });
    assert.equal(out.ok, false);
    assert.equal(out.unreachable, true);
    assert.match(out.error, /not reachable/i);
});
```

Check the file's existing import line and add `startTranscription` to it if absent; check whether the suite defines a `chrome` storage stub at the top (it does for stored-key reads) and reuse it rather than adding a second.

- [ ] **Step 2: Run it to verify it fails**

```bash
node --test tests/transcriber-client.test.mjs
```

Expected: FAIL — the first test's `out.ok` is `true` (no capability gate exists yet).

- [ ] **Step 3: Add the gate**

In `src/shared/transcriber-client.js`, add the import beside the existing ones at the top:

```javascript
import { youtubeVideoId } from './media-key.js';
```

Then in `startTranscription`, immediately **after** the `const body = { url: String(videoUrl || '') };` line and **before** the `if (engine) {` block, insert:

```javascript
    // Generic-URL capability gate. The companion admitted YouTube URLs
    // only until the Transcribe Anywhere wave; an older build would 400
    // with its own wording, which reads like a broken feature rather
    // than an out-of-date service. Probe /health and name the fix.
    // Unreachable falls through — the POST below fails with the normal
    // reachable error, the one that already carries the setup hint.
    if (!youtubeVideoId(body.url)) {
        const probe = await companionFetch('/health', { port, fetchFn, timeoutMs: 3000 });
        if (probe.ok && !(probe.body && probe.body.generic_urls)) {
            return {
                ok: false,
                error: 'The companion service is too old to transcribe anything but YouTube. '
                    + 'Update it: git pull in the X-Ray repo, run `uv sync` in companion/transcriber/, '
                    + 'then restart the service.'
            };
        }
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test tests/transcriber-client.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/transcriber-client.js tests/transcriber-client.test.mjs
git commit -m "feat(transcribe): refuse a generic URL on a companion that predates the funnel"
```

---

### Task 5: Extension — job identity by media key

**Files:**
- Modify: `src/reader/transcribe-flow.js:1-33` (header + `jobRecordKey`), `:117-178` (`runTranscriptionJob` params)
- Modify: `src/reader/index.js:2179` and `:2191` (call site + record removal)
- Test: `tests/transcribe-flow.test.mjs` (modify existing calls, add one)

**Interfaces:**
- Consumes from Task 3: nothing directly — the caller computes the key.
- Produces, for Tasks 9, 11, 12: `runTranscriptionJob({ mediaUrl, mediaKey, provider, io }) -> Promise<{ok, result}|{ok:false, error, resumable?, missingKey?}>`. `jobRecordKey(mediaKey)` unchanged in shape.

**Note:** the parameter rename is the whole change — the state machine is already source-agnostic. Do **not** alter the resume policy, the unreachable tolerance, or the record-retention rule (the caller still removes the record only after a successful adoption).

- [ ] **Step 1: Update the tests first**

In `tests/transcribe-flow.test.mjs`, every `runTranscriptionJob({ videoUrl: …, videoId: … })` call becomes `runTranscriptionJob({ mediaUrl: …, mediaKey: … })`. Find them with:

```bash
grep -n 'videoUrl\|videoId' tests/transcribe-flow.test.mjs
```

Then append one new test:

```javascript
test('runTranscriptionJob: a generic media key stores and resumes its own record', async () => {
    const KEY = 'u_0123456789abcdef';
    const { io, store, sent } = makeIo({
        startResp: { ok: true, jobId: 'j-generic', provider: 'local' },
        statusScript: [{ ok: true, job: { status: 'done', result: { segments: [{ start: 0, end: 1, text: 'hi' }] } } }]
    });
    const out = await runTranscriptionJob({
        mediaUrl: 'https://mormonstories.org/podcast/ep-1/', mediaKey: KEY, io
    });
    assert.equal(out.ok, true);
    // The record is keyed by the media key and SURVIVES success — the
    // caller drops it only after a successful adoption.
    assert.ok(store[JOB_RECORD_PREFIX + KEY], 'record kept under the media key');
    assert.equal(store[JOB_RECORD_PREFIX + KEY].jobId, 'j-generic');
    const start = sent.find((m) => m.type === 'xray:transcribe:start');
    assert.equal(start.url, 'https://mormonstories.org/podcast/ep-1/');
});
```

- [ ] **Step 2: Run to verify the new test fails**

```bash
node --test tests/transcribe-flow.test.mjs
```

Expected: FAIL — the record lands under `xray:transcribe:job:undefined` because the function still reads `videoId`.

- [ ] **Step 3: Rename the parameters**

In `src/reader/transcribe-flow.js`, update the module header (lines 8-11) to read:

```javascript
// itself runs in the loopback companion service and survives everything
// on our side; a job record in chrome.storage.local
// (`xray:transcribe:job:<mediaKey>` — a YouTube video id, or the
// shared/media-key.js hash for any other media URL) lets a closed
// reader, an SW restart, or a re-capture RESUME polling instead of
// double-submitting (the companion also dedupes active jobs by media
// key as a backstop).
```

Change `jobRecordKey` (line 31-33) to:

```javascript
export function jobRecordKey(mediaKey) {
    return JOB_RECORD_PREFIX + String(mediaKey || '');
}
```

Change the `runTranscriptionJob` signature (line 133) and the three body references:

```javascript
export async function runTranscriptionJob({ mediaUrl, mediaKey, provider, io }) {
    const key = jobRecordKey(mediaKey);
```

and inside the start branch (lines 163-177):

```javascript
        const started = await io.sendMessage({
            type: 'xray:transcribe:start',
            url: mediaUrl,
            // Engine for THIS job (picker choice / stored preference);
            // undefined lets the SW fall back to the stored preference.
            ...(provider ? { provider } : {})
        });
        if (!started || !started.ok) {
            return { ok: false, missingKey: started && started.missingKey, error: (started && started.error) || 'Could not start the transcription job.' };
        }
        jobId = started.jobId;
        await io.storageSet(key, {
            jobId, url: mediaUrl, mediaKey, startedAt: io.now(),
            ...(started.provider ? { provider: started.provider } : {})
        });
```

Also update the JSDoc above `runTranscriptionJob` (line 118) — "for a video" becomes "for one media URL".

- [ ] **Step 4: Update the reader call site**

In `src/reader/index.js`, line 2179 becomes (the surrounding `runTranscribeFlow` body is rewritten fully in Task 9 — this step only keeps the tree green):

```javascript
        const out = await runTranscriptionJob({ mediaUrl: a.url, mediaKey: videoId, provider, io });
```

Line 2191 is unchanged (`jobRecordKey(videoId)` still resolves correctly).

- [ ] **Step 5: Run the tests and the build**

```bash
node --test tests/transcribe-flow.test.mjs && npm run build
```

Expected: PASS, and the build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/reader/transcribe-flow.js src/reader/index.js tests/transcribe-flow.test.mjs
git commit -m "refactor(transcribe): key jobs by media key instead of video id"
```

---

### Task 6: Extension — platform-neutral body composition

**Files:**
- Modify: `src/shared/diarized-transcript.js:153-232` (`buildDiarizedBody`)
- Test: `tests/diarized-transcript.test.mjs` (modify + add)

**Interfaces:**
- Produces, for Task 7: `buildDiarizedBody({capturedMarkdown, mediaUrl, result, platform}) -> {markdown, timeMap, transcriptMeta, heading}`.
  - `platform === 'youtube'` keeps today's behavior byte-identically: `## Description` → `## Description — YouTube`, and `&t=<s>s` deep links.
  - Any other platform: no Description rename (a non-YouTube capture has no such section), and generic Media-Fragments `<url>#t=<s>` links via `buildTranscriptSection`'s existing fallback.
  - The `watchUrl` parameter is renamed `mediaUrl`; **both** names are accepted for one release so no caller breaks mid-wave.

- [ ] **Step 1: Update and extend the tests**

In `tests/diarized-transcript.test.mjs`, add `platform: 'youtube'` to the five existing `buildDiarizedBody({…})` calls (lines ~114, ~142, ~151, ~167, ~173, ~247) and rename `watchUrl:` to `mediaUrl:` in each. Then append:

```javascript
test('buildDiarizedBody: a generic media URL gets #t= links and no Description rename', () => {
    const EPISODE = 'https://mormonstories.org/podcast/ep-1/';
    const captured = '# Episode 1\n\n## Description\n\nShow notes here.\n';
    const { markdown, heading } = buildDiarizedBody({
        capturedMarkdown: captured, mediaUrl: EPISODE, platform: 'podcast',
        result: { language: 'en', segments: segs() }
    });
    // The YouTube-only round-trip rename must NOT fire off YouTube.
    assert.ok(/^## Description$/m.test(markdown), 'bare Description heading left alone');
    assert.ok(!markdown.includes('## Description — YouTube'), 'no YouTube rename off YouTube');
    // Generic Media-Fragments deep links, never the &t=Ns form.
    assert.ok(markdown.includes(`](${EPISODE}#t=0)`), 'generic #t= link form');
    assert.ok(!markdown.includes('&t=0s'), 'no YouTube &t=Ns links off YouTube');
    // The suffixed heading still protects against a later paste-attach.
    assert.equal(heading, 'Transcript — English (local, diarized)');
    assert.ok(markdown.includes(`## ${heading}`));
});

test('buildDiarizedBody: the legacy watchUrl parameter still works', () => {
    const { markdown } = buildDiarizedBody({
        capturedMarkdown: CAPTURED, watchUrl: WATCH, platform: 'youtube',
        result: { language: 'en', segments: segs() }
    });
    assert.ok(markdown.includes(`](${WATCH}&t=0s)`));
});
```

Also update `tests/diarized-wire.test.mjs:75-78` to pass `platform: 'youtube'` and `mediaUrl: WATCH` so the wire fixture keeps exercising the YouTube path.

- [ ] **Step 2: Run to verify the new tests fail**

```bash
node --test tests/diarized-transcript.test.mjs
```

Expected: FAIL — the generic case still renames Description and emits `&t=0s`.

- [ ] **Step 3: Make composition platform-aware**

In `src/shared/diarized-transcript.js`, replace the `buildDiarizedBody` JSDoc and signature block (lines 153-207) with:

```javascript
/**
 * Compose the diarized capture body from the captured (transcript-less)
 * markdown plus the companion result. Returns the new canonical
 * markdown, the offset→time map over it, and the transcript_meta the
 * article needs for the speaker→claim prefill.
 *
 * Two transforms are UNIVERSAL:
 * 1. Any native `## Transcript — …` sections are dropped — unlabeled
 *    auto-cues are superseded by the diarized transcript (the archive's
 *    prior-version snapshot keeps them, honest versioning).
 * 2. The diarized section is appended under the suffixed heading, so a
 *    later Phase-22 paste-attach (which replaces only the BARE
 *    `## Transcript`) can never clobber it.
 *
 * One is YOUTUBE-ONLY (`platform === 'youtube'`):
 * 3. `## Description` → `## Description — YouTube`. MANDATORY there:
 *    reconstructArticleFromEvent cuts any bare `## Description` section
 *    and assembleArticleBody re-appends it only for contentType
 *    'video' — on a 'transcript' capture the bytes would vanish on
 *    relay round-trip and fork the x-hash (the JOURNAL
 *    markdown-canonical trap). Off YouTube there is no such section to
 *    rename, and renaming one that a site happened to author would be
 *    a lie.
 *
 * Deep links follow the same split: YouTube gets its `&t=<s>s` watch-URL
 * form, everything else the generic W3C Media-Fragments `<url>#t=<s>`
 * that buildTranscriptSection already emits for an http(s) meta.url.
 *
 * @param {{capturedMarkdown: string, mediaUrl?: string, watchUrl?: string,
 *          platform?: string, result: {language?: string, segments: Array}}} p
 * @returns {{markdown: string, timeMap: Array, transcriptMeta: object, heading: string}}
 */
export function buildDiarizedBody({
    capturedMarkdown = '', mediaUrl = '', watchUrl = '', platform = '', result = {}
} = {}) {
    const url = mediaUrl || watchUrl;   // watchUrl: the pre-wave name
    const isYouTube = String(platform || '').toLowerCase() === 'youtube';
    const segments = Array.isArray(result.segments) ? result.segments : [];
    const turns = turnsFromSegments(segments);
    if (turns.length === 0) throw new Error('Transcription returned no usable segments');

    let base = String(capturedMarkdown || '').replace(/\s+$/, '');

    // (3) YouTube only — the round-trip rename.
    if (isYouTube) {
        base = base.replace(/^## Description[ \t]*$/m, '## Description — YouTube');
    }

    // (1) Drop native transcript sections (start-of-line suffixed
    // heading through the next same-level heading or EOF).
    base = base.replace(/^## Transcript — [^\n]*$[\s\S]*?(?=^## |$(?![\s\S]))/gm, '').replace(/\s+$/, '');

    const heading = diarizedHeading(result.language, result.model_info && result.model_info.provider);
    // linkFor is YouTube's watch-URL form; null lets buildTranscriptSection
    // fall back to the generic Media-Fragments `<url>#t=<s>`.
    const linkFor = isYouTube ? (secs) => `${url}&t=${secs}s` : null;

    // Assemble first WITHOUT offsets to learn where the section lands,
    // then re-render with the observer to place each paragraph. Cheaper:
    // render once, then locate each rendered paragraph by indexOf from a
    // moving cursor — paragraphs are unique-ordered substrings of the
    // section we just built, so the scan can never mismatch.
    const paras = [];
    const section = buildTranscriptSection({
        turns,
        meta: { url },
        heading,
        linkFor,
        onParagraph: (p, rendered) => paras.push({ p, rendered })
    });
```

Everything below that point (the `markdown`/`timeMap`/`transcriptMeta` assembly, lines 207-232) is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test tests/diarized-transcript.test.mjs && node --test tests/diarized-wire.test.mjs
```

Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add src/shared/diarized-transcript.js tests/diarized-transcript.test.mjs tests/diarized-wire.test.mjs
git commit -m "feat(transcribe): platform-neutral diarized body composition"
```

---

### Task 7: Extension — platform-neutral adoption, with the wire promise machine-checked

**Files:**
- Modify: `src/reader/index.js:2013-2065` (`adoptDiarizedTranscript`)
- Test: `tests/diarized-wire.test.mjs` (append)

**Interfaces:**
- Consumes from Task 6: `buildDiarizedBody({capturedMarkdown, mediaUrl, platform, result})`.
- Produces: adoption that works on any capture. Three rules:
  1. **Track slot.** A YouTube capture keeps writing `a.youtube.transcripts` (so `transcript_lang` tags and the header chips are byte-identical). Any other capture writes the local-only `a.transcripts`, which **no builder reads** — that is what keeps the wire promise.
  2. **Media declaration.** `a.media = 'video'` only on a platform that is genuinely video (`youtube`, `tiktok`) or where the user already declared it. Off those, adoption leaves `a.media` untouched — media type is user-declared (the Media modal nudge already fires after adoption).
  3. **Guard.** The old `if (!a || !a.youtube) throw` becomes a URL check.

- [ ] **Step 1: Write the failing wire test**

Append to `tests/diarized-wire.test.mjs`:

```javascript
test('a NON-YouTube diarized capture emits no transcript_lang tag (wire promise)', async () => {
    // The neutral `article.transcripts` slot is LOCAL-ONLY. If a future
    // change teaches event-builder to read it, this test fails — which
    // is the point: that would be a wire-format change needing the
    // ecosystem-pm callout, not a silent additive tag on a new class of
    // events.
    const EPISODE = 'https://mormonstories.org/podcast/ep-1/';
    const { markdown, transcriptMeta } = buildDiarizedBody({
        capturedMarkdown: '# Episode 1\n\nShow notes.\n',
        mediaUrl: EPISODE, platform: 'podcast', result: RESULT
    });
    const article = {
        url: EPISODE,
        title: 'Episode 1',
        byline: '',
        domain: 'mormonstories.org',
        siteName: 'Mormon Stories',
        contentType: 'transcript',
        platform: 'podcast',
        markdown,
        content: ContentExtractor.markdownToHtml(markdown),
        _contentIsMarkdown: false,
        transcript_meta: transcriptMeta,
        extraction: { method: extractionMethodFor(RESULT.model_info) },
        // The neutral slot the reader writes off YouTube.
        transcripts: [diarizedTrackEntry(RESULT)],
        entities: []
    };
    const event = await EventBuilder.buildArticleEvent(article, PUBKEY);
    const names = event.tags.map((t) => t[0]);
    assert.ok(!names.includes('transcript_lang'),
        'no transcript_lang off YouTube — the neutral slot is local-only');
    // The manifest that DOES publish is unchanged and honest.
    assert.ok(names.includes('transcript_meta'), 'transcript_meta still emits');
    assert.ok(names.includes('extraction-method'), 'extraction-method still emits');
    // And no `media` tag, because adoption never declares it off a
    // genuinely-video platform.
    assert.ok(!names.includes('media'), 'media stays user-declared off video platforms');
});
```

If `buildArticleEvent`'s exact name or signature differs in this file, match the call already used by the neighbouring YouTube wire test rather than the shape above.

- [ ] **Step 2: Run to verify it fails or errors**

```bash
node --test tests/diarized-wire.test.mjs
```

Expected: FAIL — `buildDiarizedBody` rejects the unknown parameter shape only if Task 6 was skipped; otherwise this test may already pass, in which case **keep it** as the regression pin and proceed (it is guarding a promise, not driving a change).

- [ ] **Step 3: Rewrite the adoption guard, track slot and media declaration**

In `src/reader/index.js`, replace line 2015:

```javascript
    if (!a || !a.url) throw new Error('This capture has no source URL to transcribe.');
```

Replace lines 2030-2034 (the compose call):

```javascript
    const { markdown, timeMap, transcriptMeta } = buildDiarizedBody({
        capturedMarkdown: a.markdown || '',
        mediaUrl: a.url,
        platform: a.platform,
        result
    });
```

Replace lines 2040-2045 (`contentType` + media declaration) with:

```javascript
    // contentType flips BEFORE hashing: 'transcript' joins the
    // markdown-canonical set, so the hash covers the markdown substrate
    // (the ordering trap — hashing first would cover the old turndown
    // side). platform is untouched (header + tag block unaffected).
    a.contentType = 'transcript';
    // The Phase 22 whitelisted user-declared media tag. Choosing
    // "Transcribe" on a platform that IS video is the declaration, and
    // it keeps those captures findable by consumers filtering on
    // video-ness now that content_format reads 'transcript'. OFF those
    // platforms we declare NOTHING: media type is the user's to state
    // (the 🎙 Media modal), and a podcast episode is not a video. The
    // post-adoption refreshMediaNudge() surfaces that prompt.
    if (!a.media && (a.platform === 'youtube' || a.platform === 'tiktok')) {
        a.media = 'video';
    }
```

Replace lines 2059-2065 (the track write) with:

```javascript
    // The transcript_lang manifest + header chip both gate on non-empty
    // events — the diarized track carries them (locally; never as tags).
    // YOUTUBE keeps the youtube-nested slot, which is the ONLY slot
    // event-builder reads: writing the neutral slot below for other
    // platforms is deliberately wire-inert (tests/diarized-wire.test.mjs
    // pins that a non-YouTube diarized capture emits no transcript_lang).
    const trackSlot = a.platform === 'youtube' && a.youtube ? a.youtube : a;
    trackSlot.transcripts = [
        ...(Array.isArray(trackSlot.transcripts) ? trackSlot.transcripts : [])
            .filter((t) => t && t.role !== 'local-diarized'),
        diarizedTrackEntry(result)
    ];
```

- [ ] **Step 4: Run the wire + transcript suites and build**

```bash
node --test tests/diarized-wire.test.mjs && node --test tests/diarized-transcript.test.mjs && npm run build
```

Expected: PASS, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/reader/index.js tests/diarized-wire.test.mjs
git commit -m "feat(transcribe): platform-neutral adoption with the no-new-tag promise pinned"
```

---

### Task 8: Extension — capture-time media hints

**Files:**
- Create: `src/shared/media-hints.js`
- Modify: `src/content/ui.js:74-91` (2-space indent — match the file)
- Test: `tests/media-hints.test.mjs`

**Interfaces:**
- Produces, for Task 9: `detectMediaHints(doc) -> {audio: boolean, video: boolean, embeds: string[]}|null` — `null` when the page shows no media signal at all. Stored as `article.mediaHints`, **local-only** (no builder reads it).

- [ ] **Step 1: Write the failing test**

Create `tests/media-hints.test.mjs`:

```javascript
// Capture-time media signals — what makes the reader offer Transcribe
// on a page that is not YouTube. Pure over a document-shaped stub: the
// house idiom for DOM code (no jsdom in this suite).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectMediaHints } from '../src/shared/media-hints.js';

/** Minimal document stub: selector → matching "elements". */
function docWith(map) {
    return {
        querySelectorAll: (sel) => map[sel] || [],
        querySelector: (sel) => (map[sel] || [])[0] || null
    };
}

test('detectMediaHints: null when the page has no media at all', () => {
    assert.equal(detectMediaHints(docWith({})), null);
});

test('detectMediaHints: a bare <audio> element is an audio signal', () => {
    const hints = detectMediaHints(docWith({ 'audio, video': [{ tagName: 'AUDIO' }] }));
    assert.deepEqual(hints, { audio: true, video: false, embeds: [] });
});

test('detectMediaHints: a <video> element is a video signal', () => {
    const hints = detectMediaHints(docWith({ 'audio, video': [{ tagName: 'VIDEO' }] }));
    assert.deepEqual(hints, { audio: false, video: true, embeds: [] });
});

test('detectMediaHints: a known player iframe is named, unknown ones are ignored', () => {
    const hints = detectMediaHints(docWith({
        'iframe[src]': [
            { getAttribute: () => 'https://www.youtube.com/embed/abc123DEF45' },
            { getAttribute: () => 'https://player.vimeo.com/video/1234' },
            { getAttribute: () => 'https://ads.example.com/banner' }
        ]
    }));
    assert.equal(hints.video, true);
    assert.deepEqual(hints.embeds, ['youtube', 'vimeo']);
});

test('detectMediaHints: a podcast player iframe reads as audio', () => {
    const hints = detectMediaHints(docWith({
        'iframe[src]': [{ getAttribute: () => 'https://player.megaphone.fm/ABC1234' }]
    }));
    assert.equal(hints.audio, true);
    assert.deepEqual(hints.embeds, ['megaphone']);
});

test('detectMediaHints: og:video / og:audio meta count as signals', () => {
    const video = detectMediaHints(docWith({
        'meta[property="og:video"], meta[property="og:video:url"]': [{ getAttribute: () => 'https://cdn.example/v.mp4' }]
    }));
    assert.equal(video.video, true);
    const audio = detectMediaHints(docWith({
        'meta[property="og:audio"], meta[property="og:audio:url"]': [{ getAttribute: () => 'https://cdn.example/a.mp3' }]
    }));
    assert.equal(audio.audio, true);
});

test('detectMediaHints: an empty meta content is not a signal', () => {
    assert.equal(detectMediaHints(docWith({
        'meta[property="og:video"], meta[property="og:video:url"]': [{ getAttribute: () => '' }]
    })), null);
});

test('detectMediaHints: embeds are deduplicated and capped', () => {
    const many = Array.from({ length: 40 }, () => ({
        getAttribute: () => 'https://www.youtube.com/embed/abc123DEF45'
    }));
    const hints = detectMediaHints(docWith({ 'iframe[src]': many }));
    assert.deepEqual(hints.embeds, ['youtube']);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --test tests/media-hints.test.mjs
```

Expected: FAIL — `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/media-hints.js`:

```javascript
// Capture-time media signals — the answer to "should this capture
// offer Transcribe?" on a page that is not a known video platform.
//
// LOCAL-ONLY by construction: the result rides `article.mediaHints`
// into session storage and archive rows, and no event builder reads it.
// It is a UI affordance, never a claim about the page — the honest
// fallback for anything this misses is the 🎙 Media & source modal's
// "Transcribe from source" action, which is offered on every capture.
//
// Pure over a document-shaped object so node tests need no DOM.

// Players worth naming. The value is the label stored in `embeds`;
// matching is a plain hostname/substring test on the iframe src.
const PLAYER_HOSTS = [
    ['youtube.com/embed', 'youtube', 'video'],
    ['youtube-nocookie.com/embed', 'youtube', 'video'],
    ['player.vimeo.com', 'vimeo', 'video'],
    ['rumble.com/embed', 'rumble', 'video'],
    ['odysee.com/$/embed', 'odysee', 'video'],
    ['dailymotion.com/embed', 'dailymotion', 'video'],
    ['bitchute.com/embed', 'bitchute', 'video'],
    ['open.spotify.com/embed', 'spotify', 'audio'],
    ['player.megaphone.fm', 'megaphone', 'audio'],
    ['playlist.megaphone.fm', 'megaphone', 'audio'],
    ['podbean.com', 'podbean', 'audio'],
    ['libsyn.com', 'libsyn', 'audio'],
    ['simplecast.com', 'simplecast', 'audio'],
    ['buzzsprout.com', 'buzzsprout', 'audio'],
    ['art19.com', 'art19', 'audio'],
    ['captivate.fm', 'captivate', 'audio'],
    ['transistor.fm', 'transistor', 'audio'],
    ['soundcloud.com/player', 'soundcloud', 'audio'],
    ['anchor.fm', 'anchor', 'audio'],
    ['omny.fm', 'omny', 'audio'],
    ['spreaker.com', 'spreaker', 'audio'],
    ['audioboom.com', 'audioboom', 'audio'],
    ['redcircle.com', 'redcircle', 'audio'],
    ['iheart.com', 'iheart', 'audio'],
    ['blubrry.com', 'blubrry', 'audio'],
    ['fireside.fm', 'fireside', 'audio']
];

// Scanning every iframe on a heavy page is wasteful; a page with more
// players than this is not a page whose media we can identify anyway.
const MAX_IFRAMES = 30;

function metaHasValue(doc, selector) {
    for (const node of doc.querySelectorAll(selector) || []) {
        const value = node && typeof node.getAttribute === 'function'
            ? String(node.getAttribute('content') || '').trim() : '';
        if (value) return true;
    }
    return false;
}

/**
 * Media signals on a captured page.
 *
 * @param {Document|{querySelectorAll: Function}} doc
 * @returns {{audio: boolean, video: boolean, embeds: string[]}|null}
 *   null when nothing suggests playable media.
 */
export function detectMediaHints(doc) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return null;
    let audio = false;
    let video = false;
    const embeds = [];

    for (const node of doc.querySelectorAll('audio, video') || []) {
        const tag = String((node && node.tagName) || '').toUpperCase();
        if (tag === 'AUDIO') audio = true;
        else if (tag === 'VIDEO') video = true;
    }

    const iframes = [...(doc.querySelectorAll('iframe[src]') || [])].slice(0, MAX_IFRAMES);
    for (const frame of iframes) {
        const src = frame && typeof frame.getAttribute === 'function'
            ? String(frame.getAttribute('src') || '').toLowerCase() : '';
        if (!src) continue;
        for (const [needle, label, kind] of PLAYER_HOSTS) {
            if (!src.includes(needle)) continue;
            if (!embeds.includes(label)) embeds.push(label);
            if (kind === 'audio') audio = true; else video = true;
            break;
        }
    }

    if (metaHasValue(doc, 'meta[property="og:video"], meta[property="og:video:url"]')) video = true;
    if (metaHasValue(doc, 'meta[property="og:audio"], meta[property="og:audio:url"]')) audio = true;

    if (!audio && !video && embeds.length === 0) return null;
    return { audio, video, embeds };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/media-hints.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Attach the hints at capture time**

In `src/content/ui.js` (**2-space indent** — this file is userscript-ported), add the import beside the others at line 16:

```javascript
import { detectMediaHints } from '../shared/media-hints.js';
```

Then, between the existing step 2 block (ending line 81) and step 3 (line 83), insert:

```javascript
      // 2b. Media signals for the reader's Transcribe affordance —
      //     LOCAL-ONLY (no builder reads mediaHints). Absent = the page
      //     showed no playable media; the 🎙 Media modal's "Transcribe
      //     from source" is the fallback for anything this misses.
      try {
        const hints = detectMediaHints(document);
        if (hints) enriched.mediaHints = hints;
      } catch (err) {
        Utils.error('media hint detection failed', err);
      }
```

- [ ] **Step 6: Build and run the full suite**

```bash
npm run build && npm test
```

Expected: build succeeds, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/shared/media-hints.js src/content/ui.js tests/media-hints.test.mjs
git commit -m "feat(transcribe): detect capture-time media signals for the Transcribe affordance"
```

---

### Task 9: Extension — reader gating, media key, and honest cost estimates

**Files:**
- Modify: `src/reader/index.js:2110-2119` (flow guard), `:2179` + `:2191` (media key), `:2260-2287` (tooltip + estimate), `:2395-2438` (`setupTranscribeControl`)
- Modify: `src/reader/index.html:50-60` (button copy)
- Test: `tests/transcribe-gating.test.mjs` (new — pure predicate extracted for testability)

**Interfaces:**
- Consumes from Tasks 3 and 8: `mediaKeyForArticle(article)`, `article.mediaHints`.
- Produces: `hasMediaSignal(article) -> boolean`, exported from `src/reader/transcribe-flow.js` (it belongs with the flow's other pure decision logic, and that module is already import-free of chrome).

- [ ] **Step 1: Write the failing test**

Create `tests/transcribe-gating.test.mjs`:

```javascript
// Which captures offer Transcribe. The predicate is deliberately
// generous — a false positive costs one clear "no media found at this
// URL" error, a false negative hides the feature on exactly the
// long-tail pages the wave exists for.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hasMediaSignal } from '../src/reader/transcribe-flow.js';

test('hasMediaSignal: a YouTube capture always qualifies', () => {
    assert.equal(hasMediaSignal({ platform: 'youtube', youtube: { videoId: 'abc123DEF45' } }), true);
});

test('hasMediaSignal: contentType video qualifies (tiktok, IG reels, FB video)', () => {
    assert.equal(hasMediaSignal({ platform: 'tiktok', contentType: 'video' }), true);
});

test('hasMediaSignal: a user-declared media type qualifies', () => {
    assert.equal(hasMediaSignal({ platform: 'substack', media: 'podcast' }), true);
});

test('hasMediaSignal: declared podcast identity qualifies', () => {
    assert.equal(hasMediaSignal({ podcast: { feed_guid: 'abc' } }), true);
});

test('hasMediaSignal: capture-time media hints qualify', () => {
    assert.equal(hasMediaSignal({ mediaHints: { audio: true, video: false, embeds: ['megaphone'] } }), true);
});

test('hasMediaSignal: a plain article does not', () => {
    assert.equal(hasMediaSignal({ platform: 'substack', contentType: 'article' }), false);
    assert.equal(hasMediaSignal(null), false);
});

test('hasMediaSignal: a capture with no URL never qualifies', () => {
    // Nothing to hand the companion — the flow would fail immediately.
    assert.equal(hasMediaSignal({ url: '', mediaHints: { audio: true, video: false, embeds: [] } }), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --test tests/transcribe-gating.test.mjs
```

Expected: FAIL — `hasMediaSignal` is not exported.

- [ ] **Step 3: Add the predicate**

Append to `src/reader/transcribe-flow.js` (after `providerPhrase`, keeping the module import-free):

```javascript
/**
 * Does this capture look like it has media a transcriber could fetch?
 *
 * Deliberately GENEROUS. A false positive costs one clear error from
 * the companion ("no media found at this URL"); a false negative hides
 * the feature on exactly the long-tail pages this exists for. The
 * escape hatch for anything missed is the 🎙 Media & source modal's
 * "Transcribe from source", offered on every capture.
 */
export function hasMediaSignal(article) {
    const a = article || {};
    // Nothing to send: a URL-less capture (a pasted transcript import)
    // has no source for the companion to fetch.
    if (!a.url) return false;
    if (a.platform === 'youtube' && a.youtube && a.youtube.videoId) return true;
    if (a.contentType === 'video' || a.contentType === 'audio') return true;
    if (a.media === 'video' || a.media === 'podcast') return true;
    if (a.podcast && Object.keys(a.podcast).length > 0) return true;
    const h = a.mediaHints;
    if (h && (h.audio || h.video || (Array.isArray(h.embeds) && h.embeds.length > 0))) return true;
    return false;
}
```

**Note:** the YouTube branch is redundant with `contentType === 'video'` today, but it is the load-bearing case and states itself.

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/transcribe-gating.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Wire the predicate and the media key into the reader**

In `src/reader/index.js`, extend the transcribe-flow import at line 87:

```javascript
import { runTranscriptionJob, chromeIo as transcribeChromeIo, describeProgress, providerPhrase, reapStaleJobRecords, jobRecordKey, hasMediaSignal } from './transcribe-flow.js';
```

Add the media-key import beside it:

```javascript
import { mediaKeyForArticle } from '../shared/media-key.js';
```

Replace the `runTranscribeFlow` guard (lines 2112-2114) with:

```javascript
    const a = state.article;
    if (!a || !a.url) { toast('This capture has no source URL to transcribe.', 'error'); return; }
    const mediaKey = await mediaKeyForArticle(a);
```

Replace line 2179 with:

```javascript
        const out = await runTranscriptionJob({ mediaUrl: a.url, mediaKey, provider, io });
```

Replace line 2191 with:

```javascript
        await io.storageRemove([jobRecordKey(mediaKey)]).catch(() => {});
```

Also, in the archive-recall block at lines 2125-2157, the wording "This video already has a local transcription" becomes "This capture already has a local transcription" and the confirm's trailing line "Cancel — re-transcribe from scratch." is unchanged.

- [ ] **Step 6: Replace the YouTube-only button gate**

In `setupTranscribeControl` (lines 2399-2405), replace the `isYouTube` gate with:

```javascript
    // An explicit "Capture & transcribe" gesture IS the signal — show
    // the control even when the page's media hints came back empty.
    const qualifies = hasMediaSignal(state.article) || state.transcribeRequested;
    if (!qualifies || state.readOnlyOpen) {
        btn.hidden = true;
        if (caret) caret.hidden = true;
        return;
    }
```

- [ ] **Step 7: Make the tooltip and cost estimate honest off YouTube**

Replace `transcribeTooltip`'s `head` (lines 2261-2264):

```javascript
    const rerun = !!(state.article && state.article.transcription);
    const head = rerun
        ? 'Re-run the diarized transcription (replaces the current transcript section)'
        : 'Transcribe the media at this URL';
```

Replace `engineEstimate` (lines 2275-2287) with:

```javascript
/** Per-engine time/cost line for the picker. Duration is only known
 *  before the job on platforms that report it (YouTube, TikTok) or from
 *  a podcast feed; elsewhere we say so rather than invent a number —
 *  the companion probes the real duration and enforces the 4-hour cap. */
function engineEstimate(engine) {
    const a = state.article || {};
    const secs = Number((a.youtube && a.youtube.durationSeconds)
        || (a.video && a.video.durationSeconds)
        || (a.podcast && a.podcast.duration_seconds)) || 0;
    const meta = ENGINE_META[engine];
    if (engine === 'local') {
        if (!secs) return 'Runs on your GPU; speed depends on the card and the length of the media.';
        const mins = Math.max(1, Math.ceil(secs / 900 + secs / 3600 * 2));
        return `~${mins} min on your GPU (transcribe + diarize) — free.`;
    }
    if (!secs) return 'Usually 2–5 minutes, metered per audio-hour (length unknown until the companion probes it).';
    const cost = Math.max(0.01, (secs / 3600) * meta.rate);
    return `~2–5 min — about $${cost.toFixed(2)} for this media.`;
}
```

- [ ] **Step 8: Update the button copy**

In `src/reader/index.html`, replace the comment and title on lines 50-60 so they no longer promise YouTube:

- The comment "on AND this is a YouTube capture" becomes "on AND this capture shows a media signal (or you asked for it explicitly)".
- The chevron's `title="Choose the transcription engine for this video"` becomes `title="Choose the transcription engine for this media"`.

- [ ] **Step 9: Build and run the full suite**

```bash
npm run build && npm test
```

Expected: build succeeds, all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/reader/index.js src/reader/index.html src/reader/transcribe-flow.js tests/transcribe-gating.test.mjs
git commit -m "feat(transcribe): offer Transcribe on any capture with a media signal"
```

---

### Task 10: Extension — widen the capture-and-transcribe trigger

**Files:**
- Modify: `src/background/index.js:120-128` (context-menu patterns), `:183-188` (title refresh — verify the copy)
- Modify: `src/content/ui.js:31-35` (doc comment) and `:66-70` (the YouTube condition; 2-space indent)

**Interfaces:**
- Consumes: nothing new.
- Produces: "Capture & transcribe with X-Ray" available on every https page; the capture path passes `transcribe: true` regardless of platform.

**Note:** the menu is registered only when `localTranscription` is on — that gate at `src/background/index.js:111-129` is unchanged. `https://*/*` (not `*://*/*`) because the companion admits https only, so an http page could never succeed.

- [ ] **Step 1: Widen the menu pattern**

In `src/background/index.js`, replace the `documentUrlPatterns` array (lines 124-127) with:

```javascript
                documentUrlPatterns: [
                    // Any https page: the companion hands the URL to
                    // yt-dlp, which resolves page URLs, embedded players
                    // and direct media files alike. https only — the
                    // companion admits nothing else. A page with no
                    // media fails the job with a named error, which is
                    // cheaper than hiding the item on the long-tail
                    // sites this exists for.
                    'https://*/*'
                ]
```

- [ ] **Step 2: Un-gate the capture path**

In `src/content/ui.js` (**2-space indent**), replace line 66:

```javascript
      const wantsTranscription = transcribe;
```

and update the `openReader` doc comment (lines 31-35) to:

```javascript
  // `transcribe: true` (the "Capture & transcribe" menu item) skips the
  // native transcript strategies where a platform has them — the
  // diarized companion transcript supersedes them — and rides the flag
  // to the SW on the session record (NOT on the article, which persists
  // into archive rows) so the reader knows to start the job.
```

The `skipTranscripts` option keeps flowing to `captureForPlatform`; handlers that do not know it ignore it (`src/shared/platforms/index.js` passes opts straight through).

- [ ] **Step 3: Verify the menu title copy**

Read `src/background/index.js:180-190` (`refreshTranscribeMenuTitle`). If any string says "video" or "YouTube", change it to "media". Report the exact before/after in the commit body if you change it.

- [ ] **Step 4: Build and run the suite**

```bash
npm run build && npm test && npm run lint
```

Expected: build, tests, and `web-ext lint --self-hosted` all clean. **`lint` matters here** — a broadened `documentUrlPatterns` is exactly the kind of manifest-adjacent change the linter comments on.

- [ ] **Step 5: Commit**

```bash
git add src/background/index.js src/content/ui.js
git commit -m "feat(transcribe): offer capture-and-transcribe on any https page"
```

---

### Task 11: Extension — "Transcribe from source" in the Media & source modal

**Files:**
- Modify: `src/reader/media-modal.js` (the actions row in `buildHtml`, and the save handler's `close({…})` at ~line 391)
- Modify: `src/reader/index.js:3188-3192` (the modal call site) and `applyMediaResult` (~line 3293)

**Interfaces:**
- Consumes from Task 9: `runTranscribeFlow(provider)`.
- Produces: `openMediaModal` resolves with one added field — `transcribe: boolean` (default `false`). The reader applies the metadata first, then starts the job.

- [ ] **Step 1: Add the button to the modal**

In `src/reader/media-modal.js`, find the actions row in `buildHtml` (the element holding the Save and Cancel buttons — locate it with `grep -n 'xr-media__actions\|Save' src/reader/media-modal.js`). Add, before the Save button:

```javascript
        <button type="button" class="xr-media__btn xr-media__btn--ghost" id="xr-media-transcribe"
                title="Save this metadata, then fetch the media at this URL and transcribe it">
          🎙 Transcribe from source
        </button>
```

Match the exact class names already used by the neighbouring buttons in that file rather than the placeholder above.

- [ ] **Step 2: Wire its handler**

In the same file, beside the existing Save handler, add:

```javascript
        // "Transcribe from source": the same save, plus a request to
        // run the companion job on this capture's URL. Deliberately
        // exclusive with a pasted transcript — attaching one transcript
        // while fetching another is a contradiction the user should
        // resolve, not something to silently order.
        $('#xr-media-transcribe').addEventListener('click', () => {
            if ($('#xr-media-text').value.trim()) {
                showError('Attach a pasted transcript OR transcribe from source — not both in one save.');
                return;
            }
            if (!/^https?:\/\//i.test((article && article.url) || '')) {
                showError('This capture has no web URL to fetch media from.');
                return;
            }
            $('#xr-media-save').click();   // reuse the one save path
            // The save handler closes with its own result; re-close is
            // a no-op, so stamp the intent before delegating instead.
        });
```

**Implementation note:** the delegate-to-save trick above must not double-resolve. Implement it as a flag instead: declare `let transcribeRequested = false;` next to `let lastParse = null;`, set it to `true` in this handler **before** calling the save path, and have the save handler's `close({…})` include `transcribe: transcribeRequested`. Verify by reading the save handler you are editing — there is exactly one `close({…})` call for the save path (around line 391).

- [ ] **Step 3: Include the field in the result**

In the save handler's `close({…})` (~line 391), add the field and update the JSDoc `@returns` at line 186:

```javascript
            close({
                media,
                sourceType,
                linkRoles,
                podcast: Object.keys(podcast).length ? podcast : null,
                parse,
                transcribe: transcribeRequested
            });
```

JSDoc:

```javascript
 * @returns {Promise<{media: string|null, sourceType: string|null, linkRoles: object, podcast: object|null, parse: object|null, transcribe: boolean}|null>}
```

- [ ] **Step 4: Act on it in the reader**

In `src/reader/index.js`, replace the modal call site (lines 3188-3192):

```javascript
        const result = await openMediaModal(state.article);
        if (result) {
            await applyMediaResult(result);
            // Metadata first, THEN the job: adoption re-hashes, and a
            // half-applied declaration would be lost by the reload the
            // adoption performs.
            if (result.transcribe) await runTranscribeFlow(_transcribeCfg.engine || undefined);
        }
```

Apply the same shape at the second call site (line ~3229, the nudge's `autoFind` path).

- [ ] **Step 5: Build, lint, and walk the modal**

```bash
npm run build && npm test
```

Then load the unpacked extension (Chrome `chrome://extensions` → reload the card **and** reload the test tab), open any capture in the reader with `localTranscription` on, and confirm: the 🎙 modal shows the new button; pasting a transcript **and** clicking it shows the exclusivity error; clicking it on a plain capture saves the metadata and starts a job.

- [ ] **Step 6: Commit**

```bash
git add src/reader/media-modal.js src/reader/index.js
git commit -m "feat(transcribe): add Transcribe from source to the Media & source modal"
```

---

### Task 12: Portal — "Transcribe a URL" panel

**Files:**
- Create: `src/portal/import-media.js`
- Modify: `src/portal/index.js:26-28` (import) and `:1224-1231` (mount beside the transcript import)
- Modify: `src/portal/index.html` (the button beside `#xr-import-transcript`)
- Modify: `src/shared/transcript-article.js:136-159` (`buildTranscriptMarkdown` label) and `:218-266` (`buildTranscriptArticle` platform)
- Test: `tests/transcript-article.test.mjs` (append). Related suites that must stay green because they exercise the same builder: `tests/transcript-import-flow.test.mjs`, `tests/transcript-attach.test.mjs`.

**Interfaces:**
- Consumes: `runTranscriptionJob`, `chromeIo` (Task 5), `mediaKeyForUrl` (Task 3), `turnsFromSegments` (`src/shared/diarized-transcript.js`), `buildTranscriptArticle` + `computeTranscriptArticleHash` (`src/shared/transcript-article.js`), `saveArticle`, `addArticlesToCase`.
- Produces: `mountMediaTranscribe(host, {caseEntityId, onDone})` — the `mountTranscriptImport` idiom exactly.
- Extends `buildTranscriptArticle`'s `meta` with two **optional** fields, both defaulting to today's behavior byte-identically: `meta.platform` (default `'podcast'`) and `meta.sourceLabel` (default `'Podcast'`, the first header line's label).

- [ ] **Step 1: Write the failing test for the meta extension**

Append to the transcript-article test file:

```javascript
test('buildTranscriptArticle: platform and sourceLabel default to the Phase-21 shape', () => {
    const article = buildTranscriptArticle({
        turns: [{ speaker: 'A', startMs: 0, endMs: 1000, text: 'hello' }],
        speakers: ['A'], format: 'plain',
        meta: { title: 'Ep 1', url: 'https://example.com/ep1' }
    });
    assert.equal(article.platform, 'podcast');
    assert.ok(article.markdown.includes('**Podcast**: [Ep 1](https://example.com/ep1)'));
});

test('buildTranscriptArticle: a non-podcast source labels itself honestly', () => {
    const article = buildTranscriptArticle({
        turns: [{ speaker: 'A', startMs: 0, endMs: 1000, text: 'hello' }],
        speakers: ['A'], format: 'diarized',
        meta: {
            title: 'Rally speech', url: 'https://rumble.com/v123',
            platform: 'media', sourceLabel: 'Media'
        }
    });
    assert.equal(article.platform, 'media');
    assert.ok(article.markdown.includes('**Media**: [Rally speech](https://rumble.com/v123)'));
    assert.ok(!article.markdown.includes('**Podcast**:'));
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node --test tests/transcript-article.test.mjs
```

Expected: FAIL on the second test — the label is hardcoded `**Podcast**`.

- [ ] **Step 3: Extend the two functions**

In `src/shared/transcript-article.js`, in `buildTranscriptMarkdown`, replace line 140:

```javascript
    const sourceLabel = String(meta.sourceLabel || 'Podcast').trim() || 'Podcast';
    lines.push(isHttp ? `**${sourceLabel}**: [${title}](${meta.url})` : `**${sourceLabel}**: ${title}`);
```

In `buildTranscriptArticle`, pass the label through to the markdown builder (it already spreads `meta`, so no change is needed there — verify) and replace the `platform: 'podcast',` line in the returned object with:

```javascript
        // 'podcast' unless the caller states otherwise (the Transcribe-a-URL
        // panel builds records for video and generic media too).
        platform: String(meta.platform || 'podcast'),
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/transcript-article.test.mjs tests/transcript-import-flow.test.mjs tests/transcript-attach.test.mjs
```

Expected: PASS — including the two neighbouring suites, which pin that the Phase-21 default shape did not move.

- [ ] **Step 5: Write the panel**

Create `src/portal/import-media.js`:

```javascript
// Transcribe-a-URL panel — the Transcribe Anywhere wave's second entry
// point. Paste any https media URL (a podcast episode, an off-platform
// video, a page with an embedded player), run the companion job, and
// land the diarized result as an ordinary archive record — which then
// joins cases and feeds corpus synthesis exactly like the Phase-21
// transcript import beside it.
//
// The import-transcript.js idiom: el() builders, self-managed
// lifecycle, no innerHTML. Shares ONE hash recipe with every other
// transcript producer (computeTranscriptArticleHash) so the portal, the
// reader, and publish can never fork.

import { el } from './dom.js';
import { Utils } from '../shared/utils.js';
import { saveArticle } from '../shared/archive-cache.js';
import { addArticlesToCase } from '../shared/case-membership.js';
import { buildTranscriptArticle, computeTranscriptArticleHash } from '../shared/transcript-article.js';
import { turnsFromSegments, providerDisplayName } from '../shared/diarized-transcript.js';
import { runTranscriptionJob, chromeIo, describeProgress } from '../reader/transcribe-flow.js';
import { mediaKeyForUrl } from '../shared/media-key.js';

function labelField(labelText, input, hint) {
    const wrap = el('label', 'xr-import__field');
    wrap.appendChild(el('span', 'xr-import__label', labelText));
    wrap.appendChild(input);
    if (hint) wrap.appendChild(el('span', 'xr-import__hint', hint));
    return wrap;
}

function textInput(placeholder) {
    const i = el('input', 'xr-import__input');
    i.type = 'text';
    i.spellcheck = false;
    if (placeholder) i.placeholder = placeholder;
    return i;
}

function isHttpsUrl(v) {
    try { return new URL(v).protocol === 'https:'; } catch (_) { return false; }
}

/**
 * @param {HTMLElement} host
 * @param {object} opts
 * @param {string|null} [opts.caseEntityId]  when set, the record is also tagged into this case
 * @param {function}   [opts.onDone]         called after a successful transcription
 */
export function mountMediaTranscribe(host, { caseEntityId = null, onDone } = {}) {
    const panel = el('div', 'xr-import');
    host.appendChild(panel);

    panel.appendChild(el('h4', 'xr-case__heading', 'Transcribe a URL'));
    panel.appendChild(el('p', 'xr-import__hint',
        'Any https link to media — a podcast episode, an off-platform video, or a page with '
        + 'an embedded player. The companion service fetches the audio and returns a diarized '
        + 'transcript. Needs the companion running (Settings → Advanced → Transcription).'));

    const urlI = textInput('https://…');
    const titleI = textInput('Episode or video title (optional — the fetch usually knows it)');
    const showI = textInput('Show / channel (optional)');

    const fields = el('div', 'xr-import__fields');
    fields.appendChild(labelField('Media URL *', urlI));
    fields.appendChild(labelField('Title', titleI));
    fields.appendChild(labelField('Show / channel', showI));

    const runBtn = el('button', 'xr-portal__btn', 'Transcribe');
    runBtn.type = 'button';
    runBtn.disabled = true;
    const closeBtn = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Close');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', () => panel.remove());
    const actions = el('div', 'xr-import__actions');
    actions.appendChild(runBtn);
    actions.appendChild(closeBtn);
    const status = el('div', 'xr-import__status');

    panel.appendChild(fields);
    panel.appendChild(actions);
    panel.appendChild(status);

    const refresh = () => { runBtn.disabled = !isHttpsUrl(urlI.value.trim()); };
    urlI.addEventListener('input', refresh);

    runBtn.addEventListener('click', async () => {
        const url = urlI.value.trim();
        if (!isHttpsUrl(url)) return;
        runBtn.disabled = true;
        status.textContent = 'Contacting the transcription service…';
        try {
            const mediaKey = await mediaKeyForUrl(url);
            const io = chromeIo(chrome, (job) => {
                status.textContent = describeProgress(job);
            });
            const out = await runTranscriptionJob({ mediaUrl: url, mediaKey, io });
            if (!out.ok) {
                status.textContent = out.error;
                refresh();
                return;
            }
            const result = out.result || {};
            const turns = turnsFromSegments(result.segments);
            if (!turns.length) {
                status.textContent = 'The transcription returned no usable segments.';
                refresh();
                return;
            }
            const speakers = [...new Set(turns.map((t) => t.speaker).filter(Boolean))];
            const via = providerDisplayName(result.model_info && result.model_info.provider);
            const article = buildTranscriptArticle({
                turns,
                speakers,
                format: 'diarized',
                meta: {
                    title: titleI.value.trim() || result.title || url,
                    url,
                    show: showI.value.trim() || result.channel || '',
                    // Neither 'podcast' nor a platform handler's domain:
                    // the user told us only that there is media here.
                    // The reader's 🎙 modal is where they DECLARE which.
                    platform: 'media',
                    sourceLabel: 'Media'
                }
            });
            // Local-only provenance, the reader's a.transcription shape.
            article.transcription = {
                segments: Array.isArray(result.segments) ? result.segments : [],
                model_info: result.model_info || null,
                language: result.language || null
            };
            // The ONE hash recipe — never forked (transcript-article.js).
            article._articleHash = await computeTranscriptArticleHash(article);
            await saveArticle({ article, source: 'capture' });
            if (caseEntityId) await addArticlesToCase(caseEntityId, [article.url]);

            const id = crypto.randomUUID();
            chrome.runtime.sendMessage({ type: 'xray:reader:open', id, article, readOnly: false }, (resp) => {
                if (!resp || !resp.ok) Utils.error('Transcribe a URL: reader open failed', resp && resp.error);
            });
            status.textContent = `Transcribed ${via ? `via ${via}` : 'locally'} · ${turns.length} turns · `
                + `${speakers.length} speaker(s)` + (caseEntityId ? ' · added to case' : '') + ' · opened in the reader.';
            if (typeof onDone === 'function') onDone();
        } catch (err) {
            Utils.error('Transcribe a URL failed', err);
            status.textContent = `Transcription failed: ${err.message || err}`;
            refresh();
        }
    });
}
```

- [ ] **Step 6: Mount it, flag-gated**

In `src/portal/index.js`, add the import beside line 26:

```javascript
import { mountMediaTranscribe } from './import-media.js';
```

Beside the existing `#xr-import-transcript` handler (lines 1227-1231), add — and read the surrounding code first to match how this file reads flags (`grep -n 'isEnabled\|loadFlags' src/portal/index.js`; if it has no flag plumbing yet, import `loadFlags, isEnabled` from `../shared/metadata/feature-flags.js` and await `loadFlags()` where the other startup awaits happen):

```javascript
    // 🎙 Transcribe a URL — the companion-backed sibling of the paste
    // import. Hidden entirely when localTranscription is off (the flag
    // gates SURFACES; the button would only ever error).
    const transcribeUrlBtn = $('#xr-transcribe-url');
    if (transcribeUrlBtn) {
        if (!isEnabled('localTranscription')) {
            transcribeUrlBtn.hidden = true;
        } else {
            transcribeUrlBtn.addEventListener('click', () => {
                const importHost = $('#xr-import-host');
                if (importHost.childElementCount > 0) { importHost.replaceChildren(); return; }
                mountMediaTranscribe(importHost, { onDone: null });
            });
        }
    }
```

In `src/portal/index.html`, add the button next to `#xr-import-transcript` (match that button's exact classes):

```html
      <button type="button" id="xr-transcribe-url" class="xr-portal__btn xr-portal__btn--ghost" hidden>
        🎙 Transcribe a URL
      </button>
```

- [ ] **Step 7: Build, test, and walk it**

```bash
npm run build && npm test && npm run lint
```

Then reload the extension, open the portal ("My Archive"), turn `localTranscription` on in Settings, and confirm the button appears, the panel mounts, a bad URL keeps the Transcribe button disabled, and a real https media URL runs to a transcript record. With the flag **off**, confirm the button is absent.

- [ ] **Step 8: Commit**

```bash
git add src/portal/import-media.js src/portal/index.js src/portal/index.html src/shared/transcript-article.js tests/transcript-article.test.mjs
git commit -m "feat(transcribe): add the portal Transcribe-a-URL panel"
```

---

### Task 13: Docs, threat model, smoke rows, and the consent-table fix

**Files:**
- Modify: `docs/THREAT_MODEL.md` (boundaries B9/B10)
- Modify: `docs/USER_GUIDE.md:176+` (the flag table — add `localTranscription` and `transcriptClaimDrafts`)
- Modify: `docs/SMOKE_TEST.md` (new transcribe section + the "Not yet walked" note)
- Modify: `docs/CAPTURE_GUIDE.md:197-201` (the YouTube-only wording)
- Modify: `companion/transcriber/README.md` (scope: no longer YouTube-only; the SSRF posture)
- Modify: `src/options/options.html:584-596` (checkbox label + hint copy)
- Modify: `docs/ROADMAP.md` (the wave's entry) and `docs/JOURNAL.md` (one tight entry)
- Modify: `docs/TRANSCRIBE_ANYWHERE_KICKOFF.md` (status line → code-complete, walks outstanding)

**Interfaces:** none — documentation and copy only.

- [ ] **Step 1: Options copy**

In `src/options/options.html`, replace the label on line 584-585:

```html
        <span>Enable "Transcribe" for media captures</span>
```

In the hint paragraph below it, replace `Adds a "Capture &amp; transcribe" right-click item on YouTube videos and a Transcribe button in the reader (the ▾ next to it picks an engine per video, with time and cost estimates).` with:

```html
        Adds a "Capture &amp; transcribe" right-click item on any https
        page and a Transcribe button in the reader wherever a capture
        shows media (the ▾ next to it picks an engine, with time and
        cost estimates). The companion hands the URL to yt-dlp, so
        podcast episodes, off-platform video, and pages with embedded
        players all work — not only YouTube.
```

- [ ] **Step 2: Threat model**

In `docs/THREAT_MODEL.md`, update boundaries B9/B10 (find them with `grep -n 'B9\|B10\|companion' docs/THREAT_MODEL.md`). The delta must state, in the doc's existing row style:

- **What changed:** the companion now accepts any user-designated public https URL, not a YouTube allowlist, and shells out to yt-dlp with it.
- **Mitigations:** https-only; embedded-credential refusal; hostname resolution with a non-global-address deny (`transcriber/media_url.py`); loopback bind; extension-origin-only CORS; optional shared token on every non-`/health` endpoint; the 4-hour duration cap and live-stream refusal.
- **Cookie scoping (new row or a clause on the companion row):** `TRANSCRIBER_COOKIES_FILE` is typically a full browser cookie export, and yt-dlp sends whatever cookies match the host it fetches. Before this wave that was bounded by the YouTube-only allowlist; now it is bounded by `TRANSCRIBER_COOKIES_HOSTS` (default: the YouTube hosts, exact-match, no subdomain wildcard). A user who widens that list is deliberately trusting those hosts with those cookies.
- **Residual risk, stated plainly:** blind SSRF. The address check is best-effort — yt-dlp re-resolves DNS and follows redirects, so rebinding is **not** closed. Bounded by: the service is loopback-only and single-user, no response body reaches a third party, and the URL is always one the user personally chose to transcribe.
- **Not mitigated / accepted:** a malicious page cannot reach the companion (CORS + token), but a user pasting a hostile URL into the portal panel is trusting that URL exactly as they trust any URL they capture.

- [ ] **Step 3: The flag table (closes this wave's share of B11)**

In `docs/USER_GUIDE.md`, add rows to the flag table at line 176:

```markdown
| `localTranscription` | off | The "Transcribe" surfaces: a "Capture & transcribe" right-click item on https pages, the reader's 🎙 button on captures with media, and the portal's "Transcribe a URL" panel. All of them talk to the loopback companion service (`companion/transcriber/`), which downloads audio with yt-dlp and transcribes it locally (WhisperX) or — only if you pick a cloud engine and save its key — by uploading the audio to AssemblyAI or Deepgram. |
| `transcriptClaimDrafts` | off | The optional LM Studio pass over a finished transcript: drafts claim candidates through a loopback endpoint (localhost:1234). Local-only and free; every suggestion still needs your Accept. |
```

- [ ] **Step 4: Smoke rows**

In `docs/SMOKE_TEST.md`, add a new section (numbered to follow the existing sections — read the file's section numbering first) covering the surfaces that **have no rows at all today**:

```markdown
## N. Local transcription (flag `localTranscription`)

Needs the companion running: from `companion/transcriber/`, `uv run xray-transcriber`.

- [ ] **N.1 Flag off ⇒ no surface.** With `localTranscription` off: no
  "Capture & transcribe" right-click item, no 🎙 Transcribe button in the
  reader on a YouTube capture, no "Transcribe a URL" button in the portal.
- [ ] **N.2 Companion absent ⇒ named fix.** Flag on, service stopped.
  Click Transcribe: the banner says the service is not reachable **and
  names `uv run xray-transcriber`**. Nothing hangs.
- [ ] **N.3 YouTube (the unchanged path).** Capture a short YouTube
  video, press 🎙 Transcribe. Result: diarized body with `**Speaker 1:**`
  labels, `&t=Ns` links, a `## Description — YouTube` heading, and a
  transcript chip in the header.
- [ ] **N.4 Engine picker.** The ▾ shows three engines with time/cost
  estimates; a cloud engine with no saved key routes to Settings.
- [ ] **N.5 Speakers modal.** On a diarized capture, 🎙 Speakers binds a
  voice to a person entity and the label decorates in the body.
- [ ] **N.6 Transcribe Anywhere — the wave's acceptance walk.** Capture a
  **Mormon Stories episode page**, confirm the 🎙 Transcribe button
  appears (media hints found the embedded player), run it, and confirm:
  a diarized transcript adopts as the body, timestamps deep-link as
  `<url>#t=<s>`, **no** `## Description — YouTube` heading was invented,
  and the capture publishes without a `transcript_lang` tag.
- [ ] **N.7 Media modal escape hatch.** On a capture with no media hints,
  🎙 Media & source → "Transcribe from source" starts a job.
- [ ] **N.8 Portal panel.** "Transcribe a URL" with a podcast episode URL
  produces a transcript record, opened in the reader and (in a case
  context) added to the case.
- [ ] **N.9 Old-companion refusal.** With a pre-wave companion running,
  a non-YouTube URL is refused client-side naming `git pull` + `uv sync`,
  and no POST is made.
```

Then update the **"Not yet walked"** paragraph near the top: remove nothing that is still true, and add that the Transcribe Anywhere §N walks are owed until run. Do **not** add a walk-ledger row — the ledger records walks **performed**, and this task performs none.

- [ ] **Step 5: Capture guide + companion README**

In `docs/CAPTURE_GUIDE.md:197-201`, replace the YouTube-only wording with the generalized trigger description (right-click on any https page; the reader button on captures with media signals; the portal panel), and note that anti-bot sites may need the companion's `TRANSCRIBER_COOKIES_FILE`.

In `companion/transcriber/README.md`, update the scope sentence (it currently says YouTube), document `generic_urls` in the `/health` response table, and add a short "What URLs are accepted" section stating: https only, public hosts only, no embedded credentials, live streams refused, 4-hour default cap (`TRANSCRIBER_MAX_DURATION_S`), and that yt-dlp resolves page URLs / embedded players / direct media files. Document `TRANSCRIBER_COOKIES_HOSTS` in the environment table next to `TRANSCRIBER_COOKIES_FILE`, and say plainly why it exists: the cookie file is a credential, it is sent only to the hosts listed there (default YouTube), and widening the list is a deliberate decision to trust those hosts with those cookies.

- [ ] **Step 6: ROADMAP + JOURNAL + kickoff status**

Add the wave to `docs/ROADMAP.md` in the house style, pointing at `docs/TRANSCRIBE_ANYWHERE_KICKOFF.md`.

Add one tight `docs/JOURNAL.md` entry dated the merge day covering: (a) that the YouTube lock was gating, not machinery — one validator plus five gates; (b) the media_key back-compat rule (YouTube keeps its bare video id so in-flight records resume); (c) the decision that the neutral `article.transcripts` slot stays **local-only** so a non-YouTube diarized capture emits no `transcript_lang` — the reason the wave is "Wire format: none", pinned by `tests/diarized-wire.test.mjs`; (d) the SSRF residual risk accepted, with the bounding facts; (e) **the cookie-scope finding** — `download.py` passed `COOKIES_FILE` to yt-dlp unconditionally, which was safe only because the host allowlist was YouTube; the funnel would have silently turned a browser cookie export into a credential offered to any pasted host, so `TRANSCRIBER_COOKIES_HOSTS` landed in the same change. Worth recording because it is the general shape of the trap: a control that was load-bearing for a second, undocumented reason.

Update `docs/TRANSCRIBE_ANYWHERE_KICKOFF.md`'s status line to code-complete with the §5 acceptance walks outstanding, mirroring `docs/UNIFIED_ARTICLE_PASS_KICKOFF.md`'s status-line style.

- [ ] **Step 7: Final full verification**

```bash
npm run build && npm test && npm run lint
```

and from `companion/transcriber/`:

```bash
uv run python -m unittest discover tests
```

Expected: all four green. **Report the actual output** — do not claim green without it.

- [ ] **Step 8: Commit**

```bash
git add docs/ companion/transcriber/README.md src/options/options.html
git commit -m "docs(transcribe): Transcribe Anywhere — threat model, flag table, smoke rows, scope copy"
```

---

## Wire format: none

**Required PR callout** (ecosystem-pm owns the wording; this is the classification this plan implements): no new kinds, no new tags, no new tag values, no changed tag semantics. The `media` whitelist stays `'podcast'|'video'`. `transcript_lang` continues to emit only from `article.youtube.transcripts`; the neutral `article.transcripts` slot introduced in Task 7 is local-only and machine-checked as wire-inert by `tests/diarized-wire.test.mjs`. Task 12's `meta.platform` / `meta.sourceLabel` affect the local article object and the markdown body only — and the body is already the hash substrate for transcript captures, so a record built with them hashes honestly by the one shared recipe.

## Discipline routing

- **security-threat-modeler** — required on Task 2 (new network-destination class **and** the cookie-scope change) and Task 13 (the THREAT_MODEL delta). Task 2's cookie scoping is the finding this plan's own code recon produced: `download.py` set `cookiefile` for every URL, which was a YouTube-only exposure purely because the validator admitted nothing else.
- **ecosystem-pm** — certifies the "Wire format: none" callout across Tasks 6, 7, 12.
- **schema-evolution** — Tasks 2, 5, 7 (the `media_key` rename, the job-record key, the neutral track slot). No `DB_VERSION` bump and no backup-format change; the migration story is "YouTube keys are unchanged, so no in-flight record is stranded".
- **architect** — no new kinds, storage namespaces, manifest permissions, or `xray:*` message types; Task 10 widens `documentUrlPatterns`, which is the one manifest-adjacent change.
- **verification-engineer** — owns Task 13's smoke rows and the walk ledger; the walks themselves are the maintainer's and stay outstanding until run.

## Self-review

**Spec coverage** — every kickoff slice maps to tasks: TA.1 → Tasks 1, 2, 4, 5, 6, 7, 11 (plus the THREAT_MODEL delta in 13); TA.2 → Tasks 8, 9, 10; TA.3 → Task 12; TA.4 → Task 13. One item is in this plan that the kickoff does **not** contain: the cookie-jar scoping in Tasks 1 and 2. It came out of reading `download.py`, which sets yt-dlp's `cookiefile` for every URL — invisible in the kickoff's file-level analysis, and a credential-exposure bug the moment the host allowlist opens. It is in-scope because it is a direct consequence of TA.1, not new appetite; if the maintainer disagrees, the honest alternative is to keep the YouTube allowlist for cookies **only** and say so in the README, which is what the default already does. The kickoff's §3 guard rails are carried as the Global Constraints plus the explicit tests in Tasks 4, 6, 7, and 9. Kickoff §10's open questions are settled here: `media_key` normalization is fixed with tests in Task 1; the address check is injectable and Windows-agnostic (`socket.getaddrinfo` via the `resolver` seam); the cookies posture is documented in Task 13 rather than built; the portal's long-job resume rides the existing job record, with the panel's status line as its surface. Wave 2 (local files) and wave 3 are deliberately **not** in this plan — they are gated on the §5 success criterion.

**Placeholder scan** — no TBDs. Three steps deliberately instruct the implementer to *read before editing* rather than quoting a line verbatim (Task 10 Step 3's menu-title copy, Task 11 Step 1's button classes, Task 12 Step 6's portal flag plumbing); each names the exact grep to run and what to match, because quoting a line this plan has not verified would be the worse failure.

**House-idiom corrections made during review** — the first draft of Task 2's test used `fastapi.testclient.TestClient`; the companion suite deliberately calls endpoints as plain functions and carries no `httpx` dependency (`tests/test_server_keys.py:80` states the rule). The test was rewritten to the plain-function idiom. Task 11's "delegate to the save button" sketch was likewise corrected to a flag set before delegation, because the naive version would have resolved the modal's promise twice.

**Type consistency** — `mediaKey` (JS) / `media_key` (Python) are used consistently; `mediaUrl` replaces `videoUrl` in `runTranscriptionJob` and `mediaUrl`/`watchUrl` are both accepted by `buildDiarizedBody` for one release; `hasMediaSignal` and `mediaKeyForArticle` are exported from the modules the reader imports them from; the companion's result object keeps its `video_id` field (untouched, still derived from yt-dlp's `info.get("id")`), so no extension code that reads results needs changing.

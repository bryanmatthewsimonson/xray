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

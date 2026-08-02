"""Tiny stdlib HTTP layer for the cloud providers (worker child only).

Deliberately urllib, no new dependency: the cloud path is optional and
the companion's dependency set is already heavy.  Both providers pin
their API base URLs as module constants (https, fixed hosts) — nothing
here takes a caller-supplied host.  Every call has a timeout and a
bounded response read.

Errors raise RuntimeError with a message fit for the job's `error`
field (the reader banner shows it verbatim).
"""

import http.client as _http_client
import json
import os
import urllib.error
import urllib.request
from typing import Callable, Optional

# Bound response reads: a 2 h episode's word-level JSON is ~10 MB;
# anything approaching this cap is a malfunction, not a transcript.
MAX_RESPONSE_BYTES = 256 * 1024 * 1024

UPLOAD_CHUNK = 64 * 1024


class HttpStatusError(RuntimeError):
    """Non-2xx response; .status and .body_text carry the details."""

    def __init__(self, status: int, body_text: str, url: str) -> None:
        snippet = " ".join(body_text.split())[:300]
        super().__init__(f"HTTP {status} from {url}" + (f": {snippet}" if snippet else ""))
        self.status = status
        self.body_text = body_text


def _read_bounded(resp) -> bytes:
    data = resp.read(MAX_RESPONSE_BYTES + 1)
    if len(data) > MAX_RESPONSE_BYTES:
        raise RuntimeError("response exceeded the size cap; aborting")
    return data


def request_json(
    method: str,
    url: str,
    *,
    headers: Optional[dict] = None,
    json_body: Optional[dict] = None,
    data=None,
    timeout_s: float = 60.0,
) -> dict:
    """One JSON-in/JSON-out request.  ``data`` (bytes or file-like with
    a Content-Length header supplied via ``headers``) wins over
    ``json_body``."""
    hdrs = dict(headers or {})
    body = data
    if body is None and json_body is not None:
        body = json.dumps(json_body).encode("utf-8")
        hdrs.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            raw = _read_bounded(resp)
    except urllib.error.HTTPError as exc:
        try:
            # Snippet only — bounded like every other response read.
            body_text = exc.read(65536).decode("utf-8", "replace")
        except Exception:
            body_text = ""
        raise HttpStatusError(exc.code, body_text, url) from None
    except urllib.error.URLError as exc:
        raise RuntimeError(f"could not reach {url} ({exc.reason})") from None
    except TimeoutError:
        raise RuntimeError(f"request to {url} timed out") from None
    except (OSError, _http_client.HTTPException) as exc:
        # urllib only wraps errors from sending the request; a reset or
        # short read while RECEIVING (RemoteDisconnected, IncompleteRead,
        # ConnectionResetError) escapes raw — map it too, or the module's
        # "errors are RuntimeError" contract (and the AssemblyAI poll's
        # transient-retry) misses exactly the blips it exists for.
        raise RuntimeError(
            f"request to {url} failed ({exc.__class__.__name__}: {exc})"
        ) from None
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except ValueError:
        raise RuntimeError(f"non-JSON response from {url}") from None
    if not isinstance(parsed, dict):
        raise RuntimeError(f"unexpected response shape from {url}")
    return parsed


class _ProgressFile:
    """File reader that reports upload progress to a callback.

    http.client reads request bodies via read() in blocks; counting
    those reads IS the upload progress (to the socket buffer — close
    enough for a progress bar)."""

    def __init__(self, fh, total: int, on_progress: Optional[Callable[[float], None]]) -> None:
        self._fh = fh
        self._total = max(total, 1)
        self._sent = 0
        self._on_progress = on_progress
        self._last = -1.0

    def read(self, n: int = -1) -> bytes:
        chunk = self._fh.read(n)
        if chunk and self._on_progress:
            self._sent += len(chunk)
            frac = min(self._sent / self._total, 1.0)
            if frac - self._last >= 0.01 or frac >= 1.0:  # throttle
                self._last = frac
                self._on_progress(frac)
        return chunk


def upload_file(
    url: str,
    path,
    *,
    headers: Optional[dict] = None,
    content_type: str = "application/octet-stream",
    on_progress: Optional[Callable[[float], None]] = None,
    timeout_s: float = 600.0,
) -> dict:
    """POST a file as the raw request body; returns the parsed JSON.

    Content-Length is set explicitly so http.client streams the file
    in blocks (no chunked encoding, no whole-file buffering)."""
    size = os.path.getsize(path)
    hdrs = dict(headers or {})
    hdrs["Content-Type"] = content_type
    hdrs["Content-Length"] = str(size)
    with open(path, "rb") as fh:
        return request_json(
            "POST",
            url,
            headers=hdrs,
            data=_ProgressFile(fh, size, on_progress),
            timeout_s=timeout_s,
        )

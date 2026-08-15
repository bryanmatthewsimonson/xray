"""Configuration for the X-Ray transcriber service.

Every knob is an environment variable with a sensible default; nothing in
this module imports heavy dependencies, so both the server process and the
worker child can load it instantly.  Working files live under
``%LOCALAPPDATA%/xray-transcriber`` (``~/.xray-transcriber`` when
LOCALAPPDATA is unset, e.g. on non-Windows machines).
"""

import os
from pathlib import Path


def _int_env(name: str, default: int) -> int:
    """Read an integer env var, falling back to the default on junk."""
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


# --- network -------------------------------------------------------------
HOST: str = "127.0.0.1"  # loopback only, deliberately not configurable
PORT: int = _int_env("TRANSCRIBER_PORT", 8756)

# --- pipeline knobs ------------------------------------------------------
COMPUTE_TYPE: str = os.environ.get("TRANSCRIBER_COMPUTE_TYPE", "float16")
BATCH_SIZE: int = _int_env("TRANSCRIBER_BATCH_SIZE", 8)
MAX_DURATION_S: int = _int_env("TRANSCRIBER_MAX_DURATION_S", 14400)
DIARIZE_MODEL: str = os.environ.get(
    "TRANSCRIBER_DIARIZE_MODEL", "pyannote/speaker-diarization-community-1"
)
COOKIES_FILE: str = os.environ.get("TRANSCRIBER_COOKIES_FILE", "")
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

# --- auth ----------------------------------------------------------------
TOKEN: str = os.environ.get("TRANSCRIBER_TOKEN", "")
HF_TOKEN: str = os.environ.get("HF_TOKEN", "")

# --- provider selection --------------------------------------------------
# Which engine turns audio into a diarized transcript. "local" is the
# existing WhisperX+pyannote path; "assemblyai" / "deepgram" send the
# DOWNLOADED AUDIO to that provider's API (the episode audio leaves this
# machine — see README "Cloud providers").  The keys below are the
# SERVER-SIDE DEFAULTS, used only for requests that carry no key of
# their own; the worker child inherits them from this process.  Since
# 2026-08-02 the preferred path is the extension holding the key and
# sending it per job (server.py TranscribeRequest.api_key -> _child_env),
# which overrides these.  Either way a key is never written to
# spec.json on disk and never logged.
PROVIDER: str = (os.environ.get("TRANSCRIBER_PROVIDER", "").strip().lower() or "local")
ASSEMBLYAI_API_KEY: str = os.environ.get("ASSEMBLYAI_API_KEY", "")
DEEPGRAM_API_KEY: str = os.environ.get("DEEPGRAM_API_KEY", "")
# Comma-separated preference list for AssemblyAI's `speech_models`
# (their API tries them in order).  The singular `speech_model` param
# was hard-deprecated by AssemblyAI (HTTP 400) — field-found 2026-08-02.
ASSEMBLYAI_MODEL: str = os.environ.get(
    "TRANSCRIBER_ASSEMBLYAI_MODEL", "universal-3-5-pro,universal-2"
)
DEEPGRAM_MODEL: str = os.environ.get("TRANSCRIBER_DEEPGRAM_MODEL", "nova-3")

# --- job handling --------------------------------------------------------
QUEUE_MAX: int = 10  # queued jobs beyond this get HTTP 429
# Cloud jobs hold no GPU, so a few may run at once; local jobs stay
# strictly serialized regardless (the VRAM discipline).
CLOUD_CONCURRENCY: int = _int_env("TRANSCRIBER_CLOUD_CONCURRENCY", 3)


def _base_dir() -> Path:
    local = os.environ.get("LOCALAPPDATA", "").strip()
    if local:
        return Path(local) / "xray-transcriber"
    return Path.home() / ".xray-transcriber"


BASE_DIR: Path = _base_dir()
TMP_DIR: Path = BASE_DIR / "tmp"    # per-job scratch: tmp/<job_id>/
JOBS_DIR: Path = BASE_DIR / "jobs"  # durable results: jobs/<job_id>.json


def ensure_dirs() -> None:
    """Create the working directories if they do not exist yet."""
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    JOBS_DIR.mkdir(parents=True, exist_ok=True)

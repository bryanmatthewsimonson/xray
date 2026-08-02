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

# --- auth ----------------------------------------------------------------
TOKEN: str = os.environ.get("TRANSCRIBER_TOKEN", "")
HF_TOKEN: str = os.environ.get("HF_TOKEN", "")

# --- job handling --------------------------------------------------------
QUEUE_MAX: int = 10  # queued jobs beyond this get HTTP 429


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

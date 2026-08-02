"""Deepgram provider: one synchronous POST of the downloaded audio to
/v1/listen (diarize + utterances), normalized into the local result
shape.

Privacy note (mirrored in the README): this path sends the episode
AUDIO to api.deepgram.com.  The download still happens locally via
yt-dlp.

Deepgram pre-recorded is synchronous — the upload IS the job, and the
response arrives when processing finishes.  So the uploading band
(0.15-0.30) tracks real bytes onto the socket, and a wall-clock
ProgressTicker covers the transcribing band (0.30-0.99) while the
request blocks on the response.

Runs in the worker child only.  DEEPGRAM_API_KEY is read from the
inherited environment, never from the spec file on disk.
"""

import logging
import shutil
import urllib.parse
from importlib import metadata as _im
from pathlib import Path
from typing import Callable

from .. import config
from ..download import download_audio
from ..progress import ProgressTicker
from . import http
from .normalize import normalize_language, utterances_to_segments

log = logging.getLogger("xray-transcriber.deepgram")

API_URL = "https://api.deepgram.com/v1/listen"  # pinned; https only

# Deepgram's synchronous pre-recorded endpoint allows ~10 minutes of
# processing; the socket timeout must comfortably outlast that.
REQUEST_TIMEOUT_S = 15 * 60

KEY_MESSAGE = (
    "DEEPGRAM_API_KEY is not set. Get a key at https://deepgram.com/, "
    "`setx DEEPGRAM_API_KEY ...`, and restart the service from a NEW terminal."
)

_CONTENT_TYPES = {
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".webm": "audio/webm",
    ".mp3": "audio/mpeg",
    ".opus": "audio/ogg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
}

Emit = Callable[[dict], None]


def run(spec: dict, emit: Emit) -> dict:
    """The provider entrypoint — same contract as pipeline.run."""
    if not config.DEEPGRAM_API_KEY:
        raise RuntimeError(KEY_MESSAGE)
    tmp_dir = config.TMP_DIR / spec["job_id"]
    tmp_dir.mkdir(parents=True, exist_ok=True)
    try:
        info, audio_path = download_audio(spec["url"], tmp_dir, emit)
        duration = float(info.get("duration") or 0.0)
        data = _transcribe(audio_path, duration, emit)
        return _build_result(info, data, duration)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _request_url() -> str:
    params = {
        "model": config.DEEPGRAM_MODEL,
        "diarize": "true",
        "utterances": "true",
        "smart_format": "true",
        "punctuate": "true",
        "detect_language": "true",
    }
    return f"{API_URL}?{urllib.parse.urlencode(params)}"


def _transcribe(audio_path: Path, duration: float, emit: Emit) -> dict:
    emit({"stage": "uploading", "progress": 0.15})
    # nova-class models process far faster than realtime; the estimate
    # only shapes the progress bar.
    ticker = ProgressTicker(
        emit, "transcribing", 0.30, 0.99, estimate_s=max(duration / 10.0, 20.0)
    )
    ticker_started = {"v": False}

    def on_progress(frac: float) -> None:
        emit({"stage": "uploading", "progress": round(0.15 + 0.15 * frac, 4)})
        if frac >= 1.0 and not ticker_started["v"]:
            # Body fully handed to the socket: Deepgram is now working
            # while we block on the response.
            ticker_started["v"] = True
            emit({"stage": "transcribing", "progress": 0.30})
            ticker.start()

    content_type = _CONTENT_TYPES.get(audio_path.suffix.lower(), "application/octet-stream")
    try:
        data = http.upload_file(
            _request_url(),
            audio_path,
            headers={"Authorization": f"Token {config.DEEPGRAM_API_KEY}"},
            content_type=content_type,
            on_progress=on_progress,
            timeout_s=REQUEST_TIMEOUT_S,
        )
    finally:
        if ticker_started["v"]:
            ticker.stop()
    emit({"stage": "transcribing", "progress": 0.99})
    return data


def _common_utterances(data: dict) -> list:
    """Deepgram payload -> the normalize.py common utterance shape."""
    results = data.get("results") or {}

    def words_of(ws) -> list:
        return [
            {
                "text": w.get("punctuated_word") or w.get("word"),
                "start": w.get("start"),
                "end": w.get("end"),
            }
            for w in ws or []
            if isinstance(w, dict)
        ]

    utterances = results.get("utterances")
    if utterances:
        return [
            {
                "speaker": u.get("speaker"),  # integer 0/1/... or None
                "start": u.get("start"),
                "end": u.get("end"),
                "text": u.get("transcript"),
                "words": words_of(u.get("words")),
            }
            for u in utterances
            if isinstance(u, dict)
        ]
    # Safety net (utterances=true should always populate them): the
    # flat word stream of the first channel, speaker-less.
    channels = results.get("channels") or []
    alts = (channels[0].get("alternatives") if channels else None) or []
    words = words_of(alts[0].get("words") if alts else None)
    if not words:
        return []
    return [
        {
            "speaker": None,
            "start": words[0]["start"],
            "end": words[-1]["end"],
            "text": alts[0].get("transcript"),
            "words": words,
        }
    ]


def _detected_language(data: dict) -> str:
    channels = (data.get("results") or {}).get("channels") or []
    code = channels[0].get("detected_language") if channels else None
    return normalize_language(code)


def _build_result(info: dict, data: dict, duration: float) -> dict:
    segments = utterances_to_segments(_common_utterances(data))
    if not segments:
        raise RuntimeError("Deepgram returned no usable segments")
    return {
        "video_id": info.get("id"),
        "title": info.get("title"),
        "channel": info.get("channel") or info.get("uploader"),
        "duration": duration,
        "language": _detected_language(data),
        "segments": segments,
        "model_info": {
            "provider": "deepgram",
            "asr_model": config.DEEPGRAM_MODEL,
            "diarization_model": "deepgram-native",
            "device": "cloud",
            "aligned": True,
            "yt_dlp_version": _dist_version("yt-dlp"),
        },
    }


def _dist_version(name: str) -> str:
    try:
        return _im.version(name)
    except Exception:
        return "unknown"

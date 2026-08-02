"""AssemblyAI provider: upload the downloaded audio, poll their job,
normalize utterances into the local result shape.

Privacy note (mirrored in the README): this path sends the episode
AUDIO to api.assemblyai.com.  The download still happens locally via
yt-dlp — cloud APIs take audio files, not YouTube URLs.

Progress bands: downloading 0.00-0.15 (shared), uploading 0.15-0.30
(real bytes), transcribing 0.30-0.99 (their job; wall-clock estimate
between polls).  No separate diarize stage — speaker labels are part
of the one cloud job.

Runs in the worker child only.  ASSEMBLYAI_API_KEY is read from the
inherited environment, never from the spec file on disk.
"""

import logging
import shutil
import time
from importlib import metadata as _im
from typing import Callable

from .. import config
from ..download import download_audio
from . import http
from .normalize import normalize_language, utterances_to_segments

log = logging.getLogger("xray-transcriber.assemblyai")

API_BASE = "https://api.assemblyai.com/v2"  # pinned; https only

POLL_INTERVAL_S = 3.0
# A cloud job stuck past this is failed, not waited on forever.
POLL_TIMEOUT_S = 45 * 60
# Transient poll failures (network blip, provider 5xx) tolerated before
# the job fails — a blip after download+upload should not burn the job.
POLL_MAX_TRANSIENT = 5

KEY_MESSAGE = (
    "ASSEMBLYAI_API_KEY is not set. Get a key at https://www.assemblyai.com/, "
    "`setx ASSEMBLYAI_API_KEY ...`, and restart the service from a NEW terminal."
)

Emit = Callable[[dict], None]


def run(spec: dict, emit: Emit) -> dict:
    """The provider entrypoint — same contract as pipeline.run."""
    if not config.ASSEMBLYAI_API_KEY:
        raise RuntimeError(KEY_MESSAGE)
    tmp_dir = config.TMP_DIR / spec["job_id"]
    tmp_dir.mkdir(parents=True, exist_ok=True)
    try:
        info, audio_path = download_audio(spec["url"], tmp_dir, emit)
        upload_url = _upload(audio_path, emit)
        # The audio has left the machine; the local copy can go now —
        # keeps scratch usage down while the cloud job runs.
        shutil.rmtree(tmp_dir, ignore_errors=True)
        duration = float(info.get("duration") or 0.0)
        transcript = _create_and_poll(upload_url, duration, emit)
        return _build_result(info, transcript, duration)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _headers() -> dict:
    return {"Authorization": config.ASSEMBLYAI_API_KEY}


def _upload(audio_path, emit: Emit) -> str:
    emit({"stage": "uploading", "progress": 0.15})

    def on_progress(frac: float) -> None:
        emit({"stage": "uploading", "progress": round(0.15 + 0.15 * frac, 4)})

    resp = http.upload_file(
        f"{API_BASE}/upload",
        audio_path,
        headers=_headers(),
        on_progress=on_progress,
    )
    upload_url = resp.get("upload_url")
    if not upload_url:
        raise RuntimeError("AssemblyAI upload returned no upload_url")
    emit({"stage": "uploading", "progress": 0.30})
    return upload_url


def _requested_models() -> list:
    """TRANSCRIBER_ASSEMBLYAI_MODEL as their `speech_models` preference
    list (comma-separated; the API tries entries in order)."""
    return [m.strip() for m in config.ASSEMBLYAI_MODEL.split(",") if m.strip()]


def _create_and_poll(upload_url: str, duration: float, emit: Emit) -> dict:
    created = http.request_json(
        "POST",
        f"{API_BASE}/transcript",
        headers=_headers(),
        json_body={
            "audio_url": upload_url,
            # Plural on purpose: the singular `speech_model` is
            # hard-rejected (HTTP 400) since ~2026-08 — see JOURNAL.
            "speech_models": _requested_models(),
            "speaker_labels": True,
            "language_detection": True,
        },
    )
    tid = created.get("id")
    if not tid:
        raise RuntimeError("AssemblyAI accepted the job but returned no transcript id")

    # Universal turns most files around well under duration/10; the
    # estimate only shapes the progress bar, never the timeout.
    estimate_s = max(duration / 10.0, 20.0)
    t0 = time.monotonic()
    transient = 0
    status = None
    while True:
        try:
            data = http.request_json("GET", f"{API_BASE}/transcript/{tid}", headers=_headers())
            transient = 0
        except http.HttpStatusError as exc:
            # 4xx is a real answer (bad id, revoked key) — fail now.
            if exc.status < 500:
                raise
            transient += 1
            if transient >= POLL_MAX_TRANSIENT:
                raise
            log.warning("poll for %s got HTTP %s; retrying", tid, exc.status)
            data = None
        except RuntimeError as exc:  # network blip / timeout
            transient += 1
            if transient >= POLL_MAX_TRANSIENT:
                raise
            log.warning("poll for %s failed (%s); retrying", tid, exc)
            data = None
        if data is not None:
            status = data.get("status")
            if status == "completed":
                return data
            if status == "error":
                raise RuntimeError(f"AssemblyAI transcription failed: {data.get('error') or 'unknown error'}")
        elapsed = time.monotonic() - t0
        if elapsed > POLL_TIMEOUT_S:
            raise RuntimeError(
                f"AssemblyAI job {tid} still {status or 'pending'} after "
                f"{int(POLL_TIMEOUT_S / 60)} minutes; giving up"
            )
        frac = min(elapsed / estimate_s, 1.0)
        emit({"stage": "transcribing", "progress": round(0.30 + 0.69 * frac, 4)})
        time.sleep(POLL_INTERVAL_S)


def _common_utterances(data: dict) -> list:
    """AssemblyAI payload -> the normalize.py common utterance shape
    (times in seconds; words carried for sentence splitting)."""

    def words_of(ws) -> list:
        return [
            {
                "text": w.get("text"),
                "start": (w["start"] / 1000.0) if w.get("start") is not None else None,
                "end": (w["end"] / 1000.0) if w.get("end") is not None else None,
            }
            for w in ws or []
            if isinstance(w, dict)
        ]

    utterances = data.get("utterances")
    if utterances:
        return [
            {
                "speaker": u.get("speaker"),
                "start": (u["start"] / 1000.0) if u.get("start") is not None else None,
                "end": (u["end"] / 1000.0) if u.get("end") is not None else None,
                "text": u.get("text"),
                "words": words_of(u.get("words")),
            }
            for u in utterances
            if isinstance(u, dict)
        ]
    # No utterances (diarization found nothing to split): fall back to
    # the flat word stream, speaker-less — never invent a label.
    words = words_of(data.get("words"))
    if not words:
        return []
    return [
        {
            "speaker": None,
            "start": words[0]["start"],
            "end": words[-1]["end"],
            "text": data.get("text"),
            "words": words,
        }
    ]


def _build_result(info: dict, data: dict, duration: float) -> dict:
    segments = utterances_to_segments(_common_utterances(data))
    if not segments:
        raise RuntimeError("AssemblyAI returned no usable segments")
    return {
        "video_id": info.get("id"),
        "title": info.get("title"),
        "channel": info.get("channel") or info.get("uploader"),
        "duration": duration,
        "language": normalize_language(data.get("language_code")),
        "segments": segments,
        "model_info": {
            "provider": "assemblyai",
            # The model their API actually ran (`speech_model_used`),
            # not the requested preference list — honest provenance for
            # the published extraction-method tag.
            "asr_model": data.get("speech_model_used")
            or (_requested_models() or ["unknown"])[0],
            "diarization_model": "assemblyai-native",
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

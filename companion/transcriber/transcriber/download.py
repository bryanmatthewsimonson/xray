"""Stage 1 for EVERY provider: yt-dlp download of the episode audio.

Extracted from pipeline.py so the cloud providers (assemblyai/deepgram)
can run the download without importing the WhisperX pipeline module.
The yt-dlp import stays function-local: importing THIS module is cheap;
only calling it pays.  Runs inside the worker child only — never import
from server.py.

The download is always local (cloud APIs take audio files, not YouTube
URLs), so yt-dlp cookies/throttling behavior is identical across
providers.
"""

import logging
from pathlib import Path
from typing import Callable

from . import config

log = logging.getLogger("xray-transcriber.download")

Emit = Callable[[dict], None]


def download_audio(url: str, tmp_dir: Path, emit: Emit) -> "tuple[dict, Path]":
    """Probe metadata, enforce the duration cap, download bestaudio.

    Emits `downloading` progress in the 0.00-0.15 band (real download
    percentage).  Returns (yt-dlp info dict, audio file path).
    """
    import yt_dlp

    emit({"stage": "downloading", "progress": 0.0})

    base_opts = {"quiet": True, "no_warnings": True, "noplaylist": True}
    if config.COOKIES_FILE:
        base_opts["cookiefile"] = config.COOKIES_FILE

    with yt_dlp.YoutubeDL(dict(base_opts)) as ydl:
        info = ydl.extract_info(url, download=False)

    if info.get("is_live"):
        raise RuntimeError("live streams are not supported")
    duration = info.get("duration")
    if not duration:
        raise RuntimeError("could not determine video duration; refusing to download")
    if duration > config.MAX_DURATION_S:
        raise RuntimeError(
            f"video is {int(duration)} s long, over the limit of "
            f"{config.MAX_DURATION_S} s (raise TRANSCRIBER_MAX_DURATION_S to allow it)"
        )

    last_emitted = {"progress": -1.0}

    def hook(d: dict) -> None:
        if d.get("status") != "downloading":
            return
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        downloaded = d.get("downloaded_bytes")
        if not total or not downloaded:
            return
        progress = 0.15 * min(downloaded / total, 1.0)
        if progress - last_emitted["progress"] >= 0.005:  # throttle event spam
            last_emitted["progress"] = progress
            emit({"stage": "downloading", "progress": round(progress, 4)})

    dl_opts = dict(base_opts)
    dl_opts.update(
        {
            # No postprocessor on purpose: whisperx's ffmpeg decode handles
            # m4a/webm/opus directly (and the cloud APIs accept the same
            # containers), so we skip a lossy re-encode.
            "format": "bestaudio[ext=m4a]/bestaudio/best",
            "outtmpl": str(tmp_dir / "%(id)s.%(ext)s"),
            "noprogress": True,
            "progress_hooks": [hook],
        }
    )
    with yt_dlp.YoutubeDL(dl_opts) as ydl:
        dl_info = ydl.extract_info(url, download=True)
        audio_path = Path(ydl.prepare_filename(dl_info))

    if not audio_path.is_file():
        candidates = [p for p in tmp_dir.iterdir() if p.is_file() and p.name != "spec.json"]
        candidates.sort(key=lambda p: p.stat().st_size, reverse=True)
        if not candidates:
            raise RuntimeError("download produced no audio file")
        audio_path = candidates[0]

    emit({"stage": "downloading", "progress": 0.15})
    return info, audio_path

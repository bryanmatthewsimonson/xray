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

import json
import logging
import shutil
import subprocess
from pathlib import Path
from typing import Callable, Optional

from . import config, media_url

log = logging.getLogger("xray-transcriber.download")

Emit = Callable[[dict], None]


def _check_duration_before_download(duration: Optional[float], max_duration_s: int) -> None:
    """The pre-download guard. Only refuses when the probe DOES know the
    duration and it's over the cap — a falsy duration (None or 0) is the
    NORMAL case for a direct media-file URL (verified against a real
    Blubrry .mp3: yt-dlp's pre-download probe returns duration: None for
    it, filesize: None too), not a reason to refuse. Refusing here for
    every unknown-duration URL, as this guard originally did, killed the
    whole "transcribe anywhere" path for exactly the files it exists to
    serve (smoke-failure diagnosis B3). The real duration gets
    established and enforced AFTER download instead — see
    _check_duration_after_download.
    """
    if duration and duration > max_duration_s:
        raise RuntimeError(
            f"video is {int(duration)} s long, over the limit of "
            f"{max_duration_s} s (raise TRANSCRIBER_MAX_DURATION_S to allow it)"
        )


def _check_duration_after_download(
    real_duration: Optional[float], max_duration_s: int, audio_path: Path
) -> None:
    """The post-download guard, reached only when the pre-download probe
    had no duration to check. Enforces the cap against the REAL duration
    BEFORE returning, so an over-long file still fails before any GPU
    work — the wasted cost is one download, not a wasted transcribe. When
    the real duration still can't be determined, proceeds rather than
    refuses (the file exists and WhisperX will decode it regardless), but
    says so loudly: the cap could not be enforced for this file.
    """
    if not real_duration:
        log.warning(
            "could not determine duration for %s after download -- the %s s "
            "cap could not be enforced for this file; proceeding anyway",
            audio_path, max_duration_s,
        )
        return
    if real_duration > max_duration_s:
        raise RuntimeError(
            f"downloaded audio is {int(real_duration)} s long, over the limit of "
            f"{max_duration_s} s (raise TRANSCRIBER_MAX_DURATION_S to allow it)"
        )


def _ffprobe_duration(path: Path) -> Optional[float]:
    """Best-effort duration via ffprobe for a file on disk, for when
    neither the pre-download probe nor yt-dlp's own download info knew
    it (the case for a plain, non-yt-dlp-native media file). ffmpeg is
    already a hard startup requirement (server.py exits without it), so
    ffprobe should be right alongside it on PATH -- but this must never
    raise; any failure just means the cap can't be enforced, handled by
    the caller.
    """
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        log.warning("ffprobe not found on PATH; cannot establish duration for %s", path)
        return None
    try:
        proc = subprocess.run(
            [
                ffprobe, "-v", "error", "-show_entries", "format=duration",
                "-of", "json", str(path),
            ],
            capture_output=True, text=True, timeout=30, check=True,
        )
        data = json.loads(proc.stdout)
        duration = float(data["format"]["duration"])
        return duration if duration > 0 else None
    except Exception as exc:  # noqa: BLE001 - best-effort probe, never fatal
        log.warning("ffprobe failed for %s: %s", path, exc)
        return None


def download_audio(url: str, tmp_dir: Path, emit: Emit) -> "tuple[dict, Path]":
    """Probe metadata, enforce the duration cap, download bestaudio.

    Emits `downloading` progress in the 0.00-0.15 band (real download
    percentage).  Returns (yt-dlp info dict, audio file path).
    """
    import yt_dlp

    emit({"stage": "downloading", "progress": 0.0})

    base_opts = {"quiet": True, "no_warnings": True, "noplaylist": True}
    # Cookies are a credential: only for hosts the user named
    # (TRANSCRIBER_COOKIES_HOSTS, default YouTube) — never for every URL
    # the widened funnel now admits.  See media_url.cookies_allowed_for.
    if config.COOKIES_FILE and media_url.cookies_allowed_for(url, config.COOKIES_HOSTS):
        base_opts["cookiefile"] = config.COOKIES_FILE

    with yt_dlp.YoutubeDL(dict(base_opts)) as ydl:
        info = ydl.extract_info(url, download=False)

    if info.get("is_live"):
        raise RuntimeError("live streams are not supported")
    duration = info.get("duration")
    _check_duration_before_download(duration, config.MAX_DURATION_S)

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

    # The pre-download probe already enforced the cap when it knew the
    # duration. When it didn't (the normal case for a direct media-file
    # URL), establish the REAL duration now that the file exists and
    # enforce the cap against it before any GPU work runs.
    if not duration:
        real_duration = dl_info.get("duration") or _ffprobe_duration(audio_path)
        _check_duration_after_download(real_duration, config.MAX_DURATION_S, audio_path)

    emit({"stage": "downloading", "progress": 0.15})
    return info, audio_path

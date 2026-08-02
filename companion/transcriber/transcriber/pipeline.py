"""Download -> transcribe -> align -> diarize pipeline.

Imported ONLY by ``transcriber.worker`` inside the throwaway child process;
never import this from server.py — it drags in torch/whisperx/yt-dlp.

VRAM discipline: each model is loaded, used, deleted, and the CUDA cache
emptied before the next one loads (ASR -> align -> diarize), which keeps
the peak around 6 GB.  Getting VRAM back to ZERO is the child process
exiting, handled by the worker.

Progress bands emitted to the parent:

* downloading   0.00 - 0.15  (real download percentage)
* transcribing  0.15 - 0.70  (wall clock vs a duration/18 estimate, capped)
* aligning      0.70 - 0.85
* diarizing     0.85 - 0.99
* done          1.0
"""

import gc
import logging
import shutil
import threading
import time
from importlib import metadata
from pathlib import Path
from typing import Callable

from . import config

log = logging.getLogger("xray-transcriber.pipeline")

ASR_MODEL = "large-v3"

HF_TOKEN_MESSAGE = (
    "HF_TOKEN is not set. Create a read token at "
    "https://hf.co/settings/tokens, accept the model terms at "
    "https://huggingface.co/pyannote/speaker-diarization-community-1, "
    "then `setx HF_TOKEN hf_...` and restart the service from a NEW terminal."
)

Emit = Callable[[dict], None]


def run(spec: dict, emit: Emit) -> dict:
    """Run the whole job described by ``spec``; returns the result object.

    The per-job scratch directory (tmp/<job_id>/ under the app data dir)
    is ALWAYS removed in the finally, success or failure.
    """
    job_id = spec["job_id"]
    tmp_dir = config.TMP_DIR / job_id
    tmp_dir.mkdir(parents=True, exist_ok=True)
    # Fail fast on the one knowable-before-work prerequisite: without
    # HF_TOKEN the job is GUARANTEED to fail at the diarize stage —
    # after minutes of download + GPU transcription on a long video.
    # (The diarize stage keeps its own check as the backstop.)
    if not config.HF_TOKEN:
        raise RuntimeError(HF_TOKEN_MESSAGE)
    try:
        info, audio_path = _download(spec["url"], tmp_dir, emit)
        return _transcribe_align_diarize(info, audio_path, emit)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


# --- stage 1: download ---------------------------------------------------


def _download(url: str, tmp_dir: Path, emit: Emit) -> "tuple[dict, Path]":
    """Probe metadata, enforce the duration cap, download bestaudio."""
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
            # m4a/webm/opus directly, so we skip a lossy re-encode.
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


# --- stages 2-4: transcribe, align, diarize ------------------------------


def _transcribe_align_diarize(info: dict, audio_path: Path, emit: Emit) -> dict:
    import torch
    import whisperx

    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = config.COMPUTE_TYPE
    if device == "cpu" and compute_type == "float16":
        compute_type = "int8"  # float16 is CUDA-only in ctranslate2
        log.info("no CUDA device; falling back to compute_type=int8 on CPU")

    duration = float(info.get("duration") or 0.0)

    def free_vram() -> None:
        gc.collect()
        if device == "cuda":
            try:
                torch.cuda.empty_cache()
            except Exception:
                pass

    # -- transcribe -------------------------------------------------------
    emit({"stage": "transcribing", "progress": 0.15})
    audio = whisperx.load_audio(str(audio_path))
    model = whisperx.load_model(ASR_MODEL, device, compute_type=compute_type)
    ticker = _ProgressTicker(
        emit, "transcribing", 0.15, 0.70, estimate_s=max(duration / 18.0, 1.0)
    )
    ticker.start()
    try:
        result = model.transcribe(audio, batch_size=config.BATCH_SIZE)
    finally:
        ticker.stop()
    language = result.get("language") or "en"
    del model
    free_vram()

    # -- align ------------------------------------------------------------
    emit({"stage": "aligning", "progress": 0.70})
    aligned = False
    align_model = align_meta = None
    try:
        align_model, align_meta = whisperx.load_align_model(
            language_code=language, device=device
        )
    except Exception as exc:
        # No alignment model for this language: keep Whisper's segment
        # timestamps and diarize at segment granularity.
        log.info("no align model for language %r (%s); skipping alignment", language, exc)
    if align_model is not None:
        aligned_result = whisperx.align(
            result["segments"],
            align_model,
            align_meta,
            audio,
            device,
            return_char_alignments=False,
        )
        result = {**result, **aligned_result}  # keep the language key
        aligned = True
        del align_model, align_meta
        free_vram()
    emit({"stage": "aligning", "progress": 0.85})

    # -- diarize ----------------------------------------------------------
    emit({"stage": "diarizing", "progress": 0.85})
    if not config.HF_TOKEN:
        raise RuntimeError(HF_TOKEN_MESSAGE)
    from whisperx.diarize import DiarizationPipeline

    diarizer = DiarizationPipeline(
        model_name=config.DIARIZE_MODEL, token=config.HF_TOKEN, device=device
    )
    diarize_segments = diarizer(audio)
    result = whisperx.assign_word_speakers(diarize_segments, result)
    del diarizer, diarize_segments
    free_vram()
    emit({"stage": "diarizing", "progress": 0.99})

    return _build_result(info, result, language, device, compute_type, aligned, duration)


def _build_result(
    info: dict,
    result: dict,
    language: str,
    device: str,
    compute_type: str,
    aligned: bool,
    duration: float,
) -> dict:
    segments = []
    for seg in result.get("segments", []):
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        segments.append(
            {
                "start": round(float(seg["start"]), 3),
                "end": round(float(seg["end"]), 3),
                # Raw SPEAKER_NN label from diarization, or null when the
                # overlap assignment left the segment unlabelled — never
                # invent a label.
                "speaker": seg.get("speaker") or None,
                "text": text,
            }
        )

    return {
        "video_id": info.get("id"),
        "title": info.get("title"),
        "channel": info.get("channel") or info.get("uploader"),
        "duration": duration,
        "language": language,
        "segments": segments,
        "model_info": {
            "asr_model": ASR_MODEL,
            "compute_type": compute_type,
            "batch_size": config.BATCH_SIZE,
            "diarization_model": config.DIARIZE_MODEL,
            "device": device,
            "aligned": aligned,
            "whisperx_version": _dist_version("whisperx"),
            "yt_dlp_version": _dist_version("yt-dlp"),
        },
    }


def _dist_version(name: str) -> str:
    try:
        return metadata.version(name)
    except Exception:
        return "unknown"


class _ProgressTicker:
    """Emits wall-clock-estimated progress for a blocking stage.

    ``model.transcribe`` offers no progress callback, so we estimate:
    elapsed wall clock over an expected runtime (duration/18 for large-v3
    at ~18x realtime), mapped into the [lo, hi] band and capped at hi.
    """

    def __init__(
        self,
        emit: Emit,
        stage: str,
        lo: float,
        hi: float,
        estimate_s: float,
        interval_s: float = 2.0,
    ) -> None:
        self._emit = emit
        self._stage = stage
        self._lo = lo
        self._hi = hi
        self._estimate_s = max(estimate_s, 1.0)
        self._interval_s = interval_s
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._t0 = 0.0

    def start(self) -> None:
        self._t0 = time.monotonic()
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=5.0)

    def _loop(self) -> None:
        while not self._stop.wait(self._interval_s):
            frac = min((time.monotonic() - self._t0) / self._estimate_s, 1.0)
            progress = self._lo + (self._hi - self._lo) * frac
            self._emit({"stage": self._stage, "progress": round(progress, 4)})

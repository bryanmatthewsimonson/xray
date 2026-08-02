"""HTTP front end for the X-Ray local transcriber.

Deliberately tiny: this module NEVER imports torch/whisperx/yt_dlp, so the
server starts in well under a second.  All heavy lifting happens in a child
process (``python -m transcriber.worker``) spawned by a single daemon worker
thread — one job at a time.  The child's exit is what guarantees VRAM
returns to zero between jobs (``torch.cuda.empty_cache`` cannot release the
CUDA context), so a large LM Studio model can coexist on the same GPU.

Serves 127.0.0.1:<port> for the X-Ray browser extension:

* ``POST /transcribe``          — enqueue a YouTube URL, 202 + job id
* ``GET  /jobs/{id}``           — status / progress / result
* ``POST /jobs/{id}/cancel``    — drop a queued job or terminate a running one
* ``GET  /health``              — device / queue / dependency probe
"""

import argparse
import json
import logging
import re
import shutil
import subprocess
import sys
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import __version__, config, providers
from .jobs import STAGES, Job, JobStore

log = logging.getLogger("xray-transcriber")

app = FastAPI(title="X-Ray Transcriber", version=__version__)

store = JobStore()
# Job execution pool.  Local jobs stay STRICTLY serialized (one worker
# — the VRAM discipline: one child process at a time on the GPU).
# Cloud jobs hold no GPU, so a few may run concurrently.  The pool's
# internal queue is unbounded on purpose: the 429 cap is enforced
# against the STORE's active (queued+running) count, not queue slots —
# bounded slots would let cancelled entries block new submissions.
_JOB_WORKERS = max(1, config.CLOUD_CONCURRENCY) if providers.is_cloud(config.PROVIDER) else 1
_executor = ThreadPoolExecutor(max_workers=_JOB_WORKERS, thread_name_prefix="job")
_device_state = {"device": "unknown"}  # resolved once, by a startup probe


# --- middleware ----------------------------------------------------------
# Order matters: the token check is added first, the CORS middleware after,
# which makes CORS the OUTERMOST layer — 401s still carry CORS headers.

@app.middleware("http")
async def _require_token(request: Request, call_next):
    """When TRANSCRIBER_TOKEN is set, require the matching header.

    /health stays open (it is the extension's reachability probe) and
    OPTIONS is exempt because CORS preflights cannot carry custom headers.
    """
    if (
        config.TOKEN
        and request.url.path != "/health"
        and request.method != "OPTIONS"
    ):
        if request.headers.get("x-transcriber-token") != config.TOKEN:
            return JSONResponse(
                {"detail": "missing or invalid X-Transcriber-Token header"},
                status_code=401,
            )
    return await call_next(request)


# Reflect the Origin header ONLY for browser-extension origins.  Never
# Access-Control-Allow-Origin: * — any web page could hit loopback.
# (Chrome host-permission fetches bypass CORS entirely; this is the
# Firefox / fallback path.)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(chrome-extension|moz-extension)://.+$",
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Transcriber-Token"],
)


# --- URL validation ------------------------------------------------------

_ALLOWED_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
}
_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,20}$")
_PATH_PREFIXES = ("/shorts/", "/live/", "/embed/")


def extract_video_id(url: str) -> str:
    """Return the YouTube video id for ``url``, or raise ValueError."""
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise ValueError("only https:// YouTube URLs are supported")
    host = (parsed.hostname or "").lower()
    if host not in _ALLOWED_HOSTS:
        raise ValueError(
            "unsupported host; expected youtube.com / youtu.be (and variants)"
        )
    if host == "youtu.be":
        video_id = parsed.path.lstrip("/").split("/")[0]
    elif parsed.path == "/watch":
        video_id = (parse_qs(parsed.query).get("v") or [""])[0]
    else:
        for prefix in _PATH_PREFIXES:
            if parsed.path.startswith(prefix):
                video_id = parsed.path[len(prefix):].split("/")[0]
                break
        else:
            raise ValueError("could not find a video id in that URL")
    if not _VIDEO_ID_RE.match(video_id):
        raise ValueError("could not find a video id in that URL")
    return video_id


# --- endpoints -----------------------------------------------------------


class TranscribeRequest(BaseModel):
    url: str


@app.post("/transcribe", status_code=202)
def transcribe(body: TranscribeRequest) -> dict:
    try:
        video_id = extract_video_id(body.url.strip())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    job = Job(
        job_id=str(uuid.uuid4()),
        url=body.url.strip(),
        video_id=video_id,
        provider=config.PROVIDER,
    )
    job, created = store.add_or_get_active(job)
    if not created:
        # An active (queued/running) job for this video already exists.
        return {"job_id": job.job_id}
    # Cap ACTIVE jobs (this one included), so cancelling really frees
    # capacity. Loopback single-user service: the tiny add-then-check
    # window between concurrent POSTs is acceptable.
    if store.active_count() > config.QUEUE_MAX:
        store.remove(job.job_id)
        raise HTTPException(
            status_code=429,
            detail=f"queue is full ({config.QUEUE_MAX} jobs); cancel one or try again later",
        )
    _executor.submit(_execute_job, job.job_id)
    log.info("queued job %s for video %s (%s)", job.job_id, video_id, job.provider)
    return {"job_id": job.job_id}


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = store.get(job_id)
    if job is not None:
        return store.snapshot(job)
    from_disk = store.load_from_disk(job_id)
    if from_disk is not None:
        return from_disk
    raise HTTPException(status_code=404, detail="unknown job id")


@app.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict:
    status = store.cancel(job_id)
    if status is not None:
        log.info("cancel requested for job %s -> %s", job_id, status)
        return {"status": status}
    from_disk = store.load_from_disk(job_id)
    if from_disk is not None:
        return {"status": from_disk["status"]}
    raise HTTPException(status_code=404, detail="unknown job id")


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "device": _device_state["device"],
        "queue_depth": store.active_count(),
        "version": __version__,
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "hf_token": bool(config.HF_TOKEN),
        # The active engine and which providers have their credential
        # set (never the credentials themselves).  Additive fields —
        # older extensions ignore them.
        "provider": config.PROVIDER,
        "providers": {name: providers.key_ready(name) for name in providers.PROVIDERS},
    }


# --- device probe --------------------------------------------------------


def _probe_device() -> None:
    """Resolve cuda/cpu ONCE by importing torch in a throwaway child.

    Runs on a background thread so the server is reachable immediately;
    /health reports "unknown" until the probe lands (or forever, if it
    fails — tolerated by design).
    """
    code = "import torch; print('cuda' if torch.cuda.is_available() else 'cpu')"
    try:
        proc = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            timeout=120,
        )
        value = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else ""
        if proc.returncode == 0 and value in ("cuda", "cpu"):
            _device_state["device"] = value
            log.info("device probe: %s", value)
            return
        log.warning("device probe failed (rc=%s); reporting unknown", proc.returncode)
    except Exception as exc:
        log.warning("device probe failed (%s); reporting unknown", exc)


# --- job execution -------------------------------------------------------


def _execute_job(job_id: str) -> None:
    """Pool task: run one job in a child process; never raises."""
    job = store.get(job_id)
    if job is None or job.status != "queued":
        return  # cancelled (or pruned) while waiting for a pool slot
    try:
        _run_job(job)
    except Exception as exc:
        log.exception("job %s crashed its worker thread", job.job_id)
        if job.status in ("queued", "running"):
            store.update(job, status="failed", stage=None, error=str(exc))


def _run_job(job: Job) -> None:
    job_tmp = config.TMP_DIR / job.job_id
    job_tmp.mkdir(parents=True, exist_ok=True)
    spec_path = job_tmp / "spec.json"
    # The spec deliberately carries NO credentials — it is written to
    # disk; API keys reach the child via inherited environment only.
    spec_path.write_text(
        json.dumps(
            {
                "job_id": job.job_id,
                "url": job.url,
                "video_id": job.video_id,
                "provider": job.provider,
            }
        ),
        encoding="utf-8",
    )
    # CAS queued -> running: a cancel that landed between dequeue and
    # here already answered "cancelled" to the client — spawning now (or
    # clobbering the status back to running) would end the job "failed".
    if not store.begin_running(job):
        shutil.rmtree(job_tmp, ignore_errors=True)
        log.info("job %s cancelled before start", job.job_id)
        return
    log.info("starting job %s (%s)", job.job_id, job.video_id)

    proc = subprocess.Popen(
        [sys.executable, "-m", "transcriber.worker", str(spec_path)],
        stdout=subprocess.PIPE,
        stderr=None,  # inherit: library chatter lands in the server console
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    with store.lock:
        job.process = proc
        cancelled_early = job.cancel_requested
    if cancelled_early:
        try:
            proc.terminate()
        except Exception:
            pass

    last_error = None
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue  # stray non-protocol output; ignore
            if not isinstance(event, dict):
                continue
            if "error" in event:
                last_error = str(event["error"])
            updates = {}
            if event.get("stage") in STAGES:
                updates["stage"] = event["stage"]
            progress = event.get("progress")
            if isinstance(progress, (int, float)):
                updates["progress"] = min(max(float(progress), 0.0), 1.0)
            if updates and job.status == "running":
                store.update(job, **updates)
        returncode = proc.wait()

        if job.status == "cancelled":
            log.info("job %s cancelled", job.job_id)
        elif returncode == 0:
            result = _read_result(job.job_id)
            if result is not None:
                store.update(
                    job, status="done", stage=None, progress=1.0,
                    error=None, result=result,
                )
                log.info("job %s done", job.job_id)
            else:
                store.update(
                    job, status="failed", stage=None,
                    error="worker exited cleanly but wrote no result file",
                )
        else:
            store.update(
                job, status="failed", stage=None,
                error=last_error or f"worker exited with code {returncode}",
            )
            log.warning("job %s failed: %s", job.job_id, job.error)
    finally:
        with store.lock:
            job.process = None
        try:
            proc.kill()  # no-op if already exited
        except Exception:
            pass
        # The child cleans its tmp dir in a finally, but a terminate()d
        # child never gets there — sweep it from the parent as well.
        shutil.rmtree(job_tmp, ignore_errors=True)


def _read_result(job_id: str) -> "dict | None":
    path = config.JOBS_DIR / f"{job_id}.json"
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


# --- entrypoint ----------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="xray-transcriber",
        description="Local transcription companion service for the X-Ray extension.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=config.PORT,
        help=f"listen port (default: TRANSCRIBER_PORT or {config.PORT})",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    if shutil.which("ffmpeg") is None:
        print(
            "xray-transcriber: ffmpeg was not found on PATH.\n"
            "Install it with `winget install Gyan.FFmpeg`, open a NEW "
            "terminal so PATH updates land, and start the service again.",
            file=sys.stderr,
        )
        sys.exit(1)

    # Provider misconfiguration fails HERE, not minutes into a job
    # (unknown TRANSCRIBER_PROVIDER, or a cloud provider without its
    # API key — the HF_TOKEN fail-fast precedent).
    provider_error = providers.validate_active()
    if provider_error is not None:
        print(f"xray-transcriber: {provider_error}", file=sys.stderr)
        sys.exit(1)

    config.ensure_dirs()
    threading.Thread(target=_probe_device, name="device-probe", daemon=True).start()

    if providers.is_cloud(config.PROVIDER):
        log.info(
            "provider: %s (cloud — episode audio is sent to the provider; "
            "up to %d concurrent jobs)",
            config.PROVIDER,
            _JOB_WORKERS,
        )
    else:
        log.info("provider: local (WhisperX + pyannote; jobs run one at a time)")
    log.info("X-Ray transcriber %s listening on http://%s:%d", __version__, config.HOST, args.port)
    uvicorn.run(app, host=config.HOST, port=args.port, log_level="info")


if __name__ == "__main__":
    main()

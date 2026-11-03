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
import os
import queue
import shutil
import subprocess
import sys
import threading
import uuid
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import __version__, config, media_url, providers
from .jobs import STAGES, Job, JobStore

log = logging.getLogger("xray-transcriber")

app = FastAPI(title="X-Ray Transcriber", version=__version__)

store = JobStore()
# Job execution: daemon consumer threads over TWO queues, routed by the
# job's OWN provider (per-request engines, 2026-08-02 — a single server
# runs local and cloud jobs side by side).  Local jobs stay STRICTLY
# serialized (one consumer — the VRAM discipline: one child process at
# a time on the GPU); cloud jobs hold no GPU, so a few consumers run
# concurrently.  DAEMON threads on purpose (a ThreadPoolExecutor's
# non-daemon workers would make Ctrl+C block until every queued job ran
# to completion): on shutdown, queued jobs die and only an
# already-running child survives as an orphan — the behavior the
# service has always had.  Queues are unbounded on purpose: the 429 cap
# is enforced against the STORE's active (queued+running) count, not
# queue slots — bounded slots would let cancelled entries block new
# submissions.
_CLOUD_WORKERS = max(1, config.CLOUD_CONCURRENCY)
_local_queue: "queue.Queue[str]" = queue.Queue()
_cloud_queue: "queue.Queue[str]" = queue.Queue()
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
# Admission and media identity live in media_url.py (import kept module-
# level so tests can patch `server.media_url.<fn>`).  The funnel accepts
# any public https URL: yt-dlp resolves page URLs, embedded players, and
# direct media files alike.  See that module's docstring for the honest
# SSRF statement.


# --- endpoints -----------------------------------------------------------


class TranscribeRequest(BaseModel):
    url: str
    # Optional per-request engine + credential (the extension's engine
    # picker / settings).  Absent -> the TRANSCRIBER_PROVIDER env
    # default, exactly the pre-2026-08-02 behavior.  The key is held in
    # memory and handed to the worker child via its environment — never
    # written to disk, never logged, never echoed in any response.
    provider: "str | None" = None
    api_key: "str | None" = None


@app.post("/transcribe", status_code=202)
def transcribe(body: TranscribeRequest) -> dict:
    try:
        url = media_url.validate_media_url(body.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    media_key = media_url.media_key_for(url)

    provider = (body.provider or config.PROVIDER).strip().lower()
    api_key = (body.api_key or "").strip() or None
    problem = providers.validate_job(provider, has_request_key=api_key is not None)
    if problem is not None:
        raise HTTPException(status_code=400, detail=problem)

    job = Job(
        job_id=str(uuid.uuid4()),
        url=url,
        media_key=media_key,
        provider=provider,
        api_key=api_key if providers.is_cloud(provider) else None,
    )
    job, created = store.add_or_get_active(job)
    if not created:
        # An active (queued/running) job for this media already exists —
        # whatever engine it was started with wins (dedupe by media).
        # The response names that engine so the client can tell the
        # user the truth instead of assuming its request was honored.
        return {"job_id": job.job_id, "provider": job.provider}
    # Cap ACTIVE jobs (this one included), so cancelling really frees
    # capacity — PER POOL: a full local backlog must not reject cloud
    # jobs that idle cloud workers could run immediately. Loopback
    # single-user service: the tiny add-then-check window between
    # concurrent POSTs is acceptable.
    pool_is_cloud = providers.is_cloud(provider)
    if store.active_count_in_pool(pool_is_cloud) > config.QUEUE_MAX:
        store.remove(job.job_id)
        raise HTTPException(
            status_code=429,
            detail=(
                f"the {'cloud' if pool_is_cloud else 'local'} queue is full "
                f"({config.QUEUE_MAX} jobs); cancel one or try again later"
            ),
        )
    _queue_for(provider).put(job.job_id)
    log.info("queued job %s for media %s (%s)", job.job_id, media_key, job.provider)
    return {"job_id": job.job_id, "provider": job.provider}


def _queue_for(provider: str) -> "queue.Queue[str]":
    """Cloud jobs and local jobs run in separate pools (VRAM rule)."""
    return _cloud_queue if providers.is_cloud(provider) else _local_queue


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
        # Capability flag: this build honors per-request provider/api_key
        # on POST /transcribe (older builds silently ignore the fields).
        "request_provider": True,
        # Capability flag: this build admits ANY public https media URL
        # (yt-dlp resolves it), not just YouTube.  The extension refuses
        # to send a non-YouTube URL to a build without this.
        "generic_urls": True,
        # Cookie-jar CONFIG visibility (2026-08-23: a paid-Substack
        # session failed identically with and without the env set, and
        # nothing anywhere showed whether the service had even loaded
        # it).  Presence + readability + host count only — never the
        # cookie values, and the path only in the startup log where the
        # operator already is.
        "cookies": {
            "configured": bool(config.COOKIES_FILE),
            "readable": bool(config.COOKIES_FILE) and os.path.isfile(config.COOKIES_FILE),
            "hosts": sorted(
                h.strip().lower()
                for h in str(config.COOKIES_HOSTS or "").split(",")
                if h.strip()
            ),
        },
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


def _worker_loop(q: "queue.Queue[str]") -> None:
    """Daemon consumer: dequeue and run jobs, one at a time per thread."""
    while True:
        _execute_job(q.get())


def _execute_job(job_id: str) -> None:
    """Run one job in a child process; never raises."""
    job = store.get(job_id)
    if job is None or job.status != "queued":
        return  # cancelled (or pruned) while waiting in the queue
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
                "media_key": job.media_key,
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
    log.info("starting job %s (%s)", job.job_id, job.media_key)

    proc = subprocess.Popen(
        [sys.executable, "-m", "transcriber.worker", str(spec_path)],
        stdout=subprocess.PIPE,
        stderr=None,  # inherit: library chatter lands in the server console
        text=True,
        encoding="utf-8",
        errors="replace",
        env=_child_env(job),  # None = inherit unchanged
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


def _child_env(job: Job) -> "dict | None":
    """The worker child's environment for ``job``.

    A request-supplied cloud key rides the CHILD'S ENVIRONMENT — the
    one channel that touches neither disk nor logs — and overrides any
    env-configured key for the same provider (explicit user intent).
    None = inherit the server's environment unchanged."""
    if not job.api_key:
        return None
    env = dict(os.environ)
    env_var = {"assemblyai": "ASSEMBLYAI_API_KEY", "deepgram": "DEEPGRAM_API_KEY"}.get(job.provider)
    if env_var:
        env[env_var] = job.api_key
    return env


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

    # An unknown TRANSCRIBER_PROVIDER still fails at startup; a cloud
    # default without its env key is only a WARNING now — the extension
    # can send the provider and key with each request (2026-08-02).
    provider_error = providers.validate_active()
    if provider_error is not None:
        print(f"xray-transcriber: {provider_error}", file=sys.stderr)
        sys.exit(1)
    key_warning = providers.env_key_warning()
    if key_warning:
        log.warning("%s", key_warning)

    config.ensure_dirs()
    threading.Thread(target=_probe_device, name="device-probe", daemon=True).start()
    # Both worker pools always run: any request may carry any engine.
    threading.Thread(
        target=_worker_loop, args=(_local_queue,), name="job-local", daemon=True
    ).start()
    for i in range(_CLOUD_WORKERS):
        threading.Thread(
            target=_worker_loop, args=(_cloud_queue,), name=f"job-cloud-{i}", daemon=True
        ).start()

    log.info(
        "engines: local (serialized) + cloud up to %d concurrent; "
        "default engine: %s (requests may override per job)",
        _CLOUD_WORKERS,
        config.PROVIDER,
    )
    if config.COOKIES_FILE:
        log.info(
            "cookies: %s (%s) for hosts: %s",
            config.COOKIES_FILE,
            "readable" if os.path.isfile(config.COOKIES_FILE) else "NOT FOUND — check the path",
            config.COOKIES_HOSTS,
        )
    else:
        log.info("cookies: none configured (TRANSCRIBER_COOKIES_FILE unset)")
    log.info("X-Ray transcriber %s listening on http://%s:%d", __version__, config.HOST, args.port)
    uvicorn.run(app, host=config.HOST, port=args.port, log_level="info")


if __name__ == "__main__":
    main()

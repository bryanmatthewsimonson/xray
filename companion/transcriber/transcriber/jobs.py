"""Job model and thread-safe in-memory job store.

The store tracks every job the server knows about.  Finished jobs
(done / failed / cancelled) are pruned by a cap (~100, oldest-finished
evicted first) and a 24 h TTL.  Completed results are also written by the
worker child to ``jobs/<job_id>.json`` under the app data dir, so
``GET /jobs/{id}`` can still answer after pruning or a server restart via
:meth:`JobStore.load_from_disk`.

This module never imports torch/whisperx/yt_dlp.
"""

import json
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from . import config

STAGES = ("downloading", "uploading", "transcribing", "aligning", "diarizing")
TERMINAL_STATUSES = ("done", "failed", "cancelled")


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class Job:
    """One transcription job, from enqueue to (pruned) completion."""

    job_id: str
    url: str
    video_id: str
    provider: str = "local"  # which engine runs this job (config.PROVIDER at enqueue)
    status: str = "queued"  # queued | running | done | failed | cancelled
    stage: Optional[str] = None  # one of STAGES, or None
    progress: float = 0.0
    created_at: datetime = field(default_factory=_now)
    finished_at: Optional[datetime] = None
    error: Optional[str] = None
    result: Optional[dict] = None
    cancel_requested: bool = False
    # Popen handle while running; owned by the worker thread, terminated on cancel.
    process: Any = field(default=None, repr=False)


class JobStore:
    """Insertion-ordered job dict guarded by a single lock."""

    MAX_FINISHED = 100
    TTL = timedelta(hours=24)

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self._jobs: "dict[str, Job]" = {}

    # --- create / read ---------------------------------------------------

    def add_or_get_active(self, job: Job) -> "tuple[Job, bool]":
        """Add ``job`` unless an ACTIVE job for the same video id exists.

        Returns ``(job, True)`` when the new job was added, or
        ``(existing, False)`` when a queued/running job for the same video
        was found — the caller returns that job's id instead of enqueueing
        a duplicate.
        """
        with self.lock:
            for existing in self._jobs.values():
                if (
                    existing.video_id == job.video_id
                    and existing.status in ("queued", "running")
                ):
                    return existing, False
            self._jobs[job.job_id] = job
            self._prune_locked()
            return job, True

    def get(self, job_id: str) -> Optional[Job]:
        with self.lock:
            return self._jobs.get(job_id)

    def remove(self, job_id: str) -> None:
        with self.lock:
            self._jobs.pop(job_id, None)

    def active_count(self) -> int:
        """Number of queued + running jobs (the /health queue_depth)."""
        with self.lock:
            return sum(
                1 for j in self._jobs.values() if j.status in ("queued", "running")
            )

    # --- update ----------------------------------------------------------

    def begin_running(self, job: Job) -> bool:
        """Compare-and-set queued -> running, under the lock.

        Returns False when a cancel won the race between the worker's
        dequeue and this call — the API already confirmed "cancelled" to
        the client, so nothing may be spawned and the status must not be
        clobbered back to running (which would end the job as a
        confusing "failed" instead).
        """
        with self.lock:
            if job.status != "queued" or job.cancel_requested:
                return False
            job.status = "running"
            job.stage = "downloading"
            job.progress = 0.0
            return True

    def update(self, job: Job, **fields: Any) -> None:
        """Apply field updates; stamps finished_at on terminal transitions."""
        with self.lock:
            for name, value in fields.items():
                setattr(job, name, value)
            if job.status in TERMINAL_STATUSES and job.finished_at is None:
                job.finished_at = _now()
            self._prune_locked()

    def cancel(self, job_id: str) -> Optional[str]:
        """Cancel a job; returns the resulting status, or None if unknown.

        Queued jobs flip straight to cancelled (the worker thread skips
        them on dequeue).  Running jobs are cancelled and their child
        process terminated.  Already-finished jobs are left alone and
        their current status returned.
        """
        proc = None
        with self.lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            if job.status == "queued":
                job.cancel_requested = True
                job.status = "cancelled"
                job.stage = None
                job.finished_at = _now()
            elif job.status == "running":
                job.cancel_requested = True
                job.status = "cancelled"
                job.stage = None
                job.finished_at = _now()
                proc = job.process
            status = job.status
        if proc is not None:
            try:
                proc.terminate()
            except Exception:
                pass
        return status

    # --- views -----------------------------------------------------------

    def snapshot(self, job: Job) -> dict:
        """The GET /jobs/{id} response body for an in-memory job."""
        with self.lock:
            position = (
                self._queue_position_locked(job) if job.status == "queued" else None
            )
            return {
                "job_id": job.job_id,
                "status": job.status,
                "stage": job.stage,
                "progress": round(job.progress, 4),
                "queue_position": position,
                "created_at": job.created_at.isoformat(),
                # Additive: lets the extension label the banner honestly
                # (local vs cloud); older extensions ignore it.
                "provider": job.provider,
                "error": job.error,
                "result": job.result,
            }

    def _queue_position_locked(self, job: Job) -> int:
        """1-based position among queued jobs; 1 means next to run."""
        position = 1
        for other in self._jobs.values():
            if other.status != "queued":
                continue
            if other is job:
                break
            position += 1
        return position

    # --- disk fallback ---------------------------------------------------

    @staticmethod
    def load_from_disk(job_id: str) -> Optional[dict]:
        """Serve a completed result from jobs/<job_id>.json, if present.

        Used for ids the in-memory store no longer (or never) knew —
        pruned jobs and jobs from before a server restart.  The id is
        validated as a UUID before touching the filesystem.
        """
        try:
            uuid.UUID(job_id)
        except (ValueError, AttributeError, TypeError):
            return None
        path = config.JOBS_DIR / f"{job_id}.json"
        try:
            if not path.is_file():
                return None
            result = json.loads(path.read_text(encoding="utf-8"))
            created = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
        except (OSError, ValueError):
            return None
        model_info = result.get("model_info") if isinstance(result, dict) else None
        return {
            "job_id": job_id,
            "status": "done",
            "stage": None,
            "progress": 1.0,
            "queue_position": None,
            "created_at": created.isoformat(),
            "provider": (model_info or {}).get("provider") or "local",
            "error": None,
            "result": result,
        }

    # --- pruning ---------------------------------------------------------

    def _prune_locked(self) -> None:
        """Drop finished jobs past the TTL, then enforce the finished cap."""
        now = _now()
        expired = [
            j.job_id
            for j in self._jobs.values()
            if j.status in TERMINAL_STATUSES
            and j.finished_at is not None
            and now - j.finished_at > self.TTL
        ]
        for job_id in expired:
            del self._jobs[job_id]

        finished = [
            j for j in self._jobs.values() if j.status in TERMINAL_STATUSES
        ]
        overflow = len(finished) - self.MAX_FINISHED
        if overflow > 0:
            finished.sort(key=lambda j: j.finished_at or j.created_at)
            for job in finished[:overflow]:
                del self._jobs[job.job_id]

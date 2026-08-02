"""Child-process entrypoint: ``python -m transcriber.worker <spec.json>``.

Runs exactly one transcription job.  Protocol with the parent server:

* stdout — one JSON object per line: ``{"stage": ..., "progress": 0.42}``
  progress events, and on failure a final ``{"error": "..."}`` line.
* exit 0 — success; the result JSON has been written to
  ``jobs/<job_id>.json`` under the app data dir before exiting.
* exit nonzero — failure (after the error line).

The real stdout is reserved for that protocol: before any heavy import,
``sys.stdout`` is redirected to stderr so library chatter (yt-dlp, tqdm,
warnings printed by torch/pyannote) can never corrupt the event stream.

This process exiting is what guarantees VRAM returns to zero — the CUDA
context cannot be released from inside a live process.
"""

import json
import os
import sys
import threading


def main() -> None:
    if len(sys.argv) != 2:
        print(json.dumps({"error": "usage: python -m transcriber.worker <spec.json>"}), flush=True)
        sys.exit(2)

    real_stdout = sys.stdout
    sys.stdout = sys.stderr  # keep library prints off the protocol channel
    emit_lock = threading.Lock()

    def emit(event: dict) -> None:
        with emit_lock:
            print(json.dumps(event), file=real_stdout, flush=True)

    try:
        with open(sys.argv[1], "r", encoding="utf-8") as fh:
            spec = json.load(fh)

        # Heavy imports (torch / whisperx / yt-dlp) happen inside pipeline,
        # here in the child only — the server process never pays for them.
        from . import config, pipeline

        result = pipeline.run(spec, emit)
        _write_result(config, spec["job_id"], result)
        emit({"stage": "done", "progress": 1.0})
    except Exception as exc:  # the whole job funnels through here
        emit({"error": str(exc) or exc.__class__.__name__})
        sys.exit(1)


def _write_result(config, job_id: str, result: dict) -> None:
    """Atomically write the result JSON before the process exits."""
    config.ensure_dirs()
    path = config.JOBS_DIR / f"{job_id}.json"
    tmp_path = config.JOBS_DIR / f"{job_id}.json.tmp"
    tmp_path.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp_path, path)


if __name__ == "__main__":
    main()

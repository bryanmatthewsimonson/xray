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


def _register_cuda12_dlls() -> None:
    """Put the nvidia-*-cu12 wheels' DLL dirs on the loader path.

    ctranslate2 (faster-whisper's engine) is a CUDA-12 binary; torch
    2.13's cu130 wheels bundle only the CUDA-13 DLL set, so the cu12
    cublas/cudnn now come from NVIDIA's own wheels (pyproject).  Must
    run BEFORE any heavy import.  Windows-only; best-effort — when the
    wheels are absent the original loader error surfaces unchanged.
    """
    if sys.platform != "win32":
        return
    try:
        import importlib.util

        # Register every nvidia/*/bin dir EXCEPT cudnn (cublas/nvrtc —
        # their DLL names are CUDA-major-suffixed, cublas64_12 vs _13,
        # so they coexist with torch's cu13 set).  cuDNN is deliberately
        # EXCLUDED: its DLL names carry no CUDA-major suffix, and one
        # process gets exactly one cudnn — torch hard-loads its own
        # CUDA-13 build by full path at import, so that build must own
        # the name space.  Registering (or worse, PATH-prepending) the
        # cu12 cudnn dir made the cu13 CORE resolve its sublibraries to
        # cu12 copies -> CUDNN_STATUS_SUBLIBRARY_VERSION_MISMATCH;
        # preloading the cu12 set instead broke torch's full-path load
        # with WinError 127 (both field-hit 2026-08-02).  ctranslate2
        # (a cu12 binary) binds torch's already-loaded cu13 cudnn by
        # name — cross-runtime, but sharing the one CUDA primary
        # context, which the passing post-fix smoke exercises across
        # transcribe (ct2), align (torch), and diarize (pyannote).
        spec = importlib.util.find_spec("nvidia")
        for loc in (spec.submodule_search_locations or []) if spec else []:
            for entry in os.listdir(loc):
                if entry == "cudnn":
                    continue
                bin_dir = os.path.join(loc, entry, "bin")
                if os.path.isdir(bin_dir):
                    os.add_dll_directory(bin_dir)
                    # ctranslate2 resolves some libraries through the
                    # LEGACY search (plain LoadLibrary), which consults
                    # PATH but not add_dll_directory — cover both.
                    os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")
    except Exception:
        pass


def main() -> None:
    if len(sys.argv) != 2:
        print(json.dumps({"error": "usage: python -m transcriber.worker <spec.json>"}), flush=True)
        sys.exit(2)

    _register_cuda12_dlls()
    real_stdout = sys.stdout
    sys.stdout = sys.stderr  # keep library prints off the protocol channel
    emit_lock = threading.Lock()

    def emit(event: dict) -> None:
        with emit_lock:
            print(json.dumps(event), file=real_stdout, flush=True)

    try:
        with open(sys.argv[1], "r", encoding="utf-8") as fh:
            spec = json.load(fh)

        # Heavy imports (torch / whisperx / yt-dlp) happen inside the
        # provider runners, here in the child only — the server process
        # never pays for them.  Cloud runners never import torch at
        # all, so a cloud child starts fast and holds zero VRAM.
        from . import config, providers

        runner = providers.get_runner(spec.get("provider") or "local")
        result = runner(spec, emit)
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

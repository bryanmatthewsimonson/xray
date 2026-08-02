"""Provider registry: which engine turns downloaded audio into segments.

Deliberately LIGHT — server.py imports this for validation and /health,
so nothing here (or in key_ready/validate_active) may import heavy
dependencies.  The runner modules import lazily, inside the worker
child only.

Every runner has the same contract as pipeline.run:

    run(spec: dict, emit: Callable[[dict], None]) -> dict

taking the job spec ({job_id, url, video_id, provider}) and returning
the result object the extension consumes ({video_id, title, channel,
duration, language, segments, model_info}).  API keys are read from the
environment inside the child (inherited from the server process) —
never from the spec, which is written to disk.
"""

from .. import config

PROVIDERS = ("local", "assemblyai", "deepgram")
CLOUD_PROVIDERS = ("assemblyai", "deepgram")


def is_cloud(name: str) -> bool:
    return name in CLOUD_PROVIDERS


def key_ready(name: str) -> bool:
    """Whether the provider's credential is present in the environment.

    "local" reports HF_TOKEN (its one credential, needed for pyannote
    diarization) — the same fact /health has always exposed as hf_token.
    """
    if name == "local":
        return bool(config.HF_TOKEN)
    if name == "assemblyai":
        return bool(config.ASSEMBLYAI_API_KEY)
    if name == "deepgram":
        return bool(config.DEEPGRAM_API_KEY)
    return False


def validate_active() -> "str | None":
    """Startup check: is config.PROVIDER a known name?  FATAL when not.

    A missing env API key is deliberately NOT fatal any more
    (2026-08-02): the extension can supply the provider and key
    per-request, so the env default being un-keyed only matters for
    requests that rely on it — env_key_warning() covers the log."""
    name = config.PROVIDER
    if name not in PROVIDERS:
        return (
            f"TRANSCRIBER_PROVIDER={name!r} is not a known provider; "
            f"expected one of: {', '.join(PROVIDERS)}"
        )
    return None


def env_key_warning() -> "str | None":
    """A startup WARNING when the env default engine lacks its env key."""
    name = config.PROVIDER
    if name in CLOUD_PROVIDERS and not key_ready(name):
        env_var = "ASSEMBLYAI_API_KEY" if name == "assemblyai" else "DEEPGRAM_API_KEY"
        return (
            f"TRANSCRIBER_PROVIDER={name} but {env_var} is not set — jobs will "
            "only run when the extension sends a key with the request "
            "(Settings → Advanced → Transcription)."
        )
    return None


def validate_job(provider: str, has_request_key: bool) -> "str | None":
    """Per-request check at POST /transcribe; an error message, or None.

    A cloud job needs a key from SOMEWHERE — the request (extension
    storage) or this process's environment.  Checked before enqueue so
    the failure is an immediate 400 naming the fix, not a dead job."""
    if provider not in PROVIDERS:
        return (
            f"unknown provider {provider!r}; expected one of: {', '.join(PROVIDERS)}"
        )
    if provider in CLOUD_PROVIDERS and not has_request_key and not key_ready(provider):
        label = "AssemblyAI" if provider == "assemblyai" else "Deepgram"
        return (
            f"no {label} API key: save one in the extension "
            f"(Settings → Advanced → Transcription) or set the service's "
            f"{'ASSEMBLYAI_API_KEY' if provider == 'assemblyai' else 'DEEPGRAM_API_KEY'} "
            "environment variable"
        )
    return None


def get_runner(name: str):
    """Resolve a provider name to its run() — worker child only."""
    if name == "assemblyai":
        from . import assemblyai

        return assemblyai.run
    if name == "deepgram":
        from . import deepgram

        return deepgram.run
    if name == "local" or not name:
        from .. import pipeline

        return pipeline.run
    raise RuntimeError(f"unknown transcription provider: {name!r}")

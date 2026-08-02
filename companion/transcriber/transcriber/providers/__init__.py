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
    """Startup check for config.PROVIDER; an error message, or None.

    Missing cloud keys fail HERE, at server start, not minutes into a
    job (the HF_TOKEN fail-fast precedent).  Local's HF_TOKEN check
    stays at job time — the server has always been allowed to start
    without it so /health can report the gap.
    """
    name = config.PROVIDER
    if name not in PROVIDERS:
        return (
            f"TRANSCRIBER_PROVIDER={name!r} is not a known provider; "
            f"expected one of: {', '.join(PROVIDERS)}"
        )
    if name == "assemblyai" and not config.ASSEMBLYAI_API_KEY:
        return (
            "TRANSCRIBER_PROVIDER=assemblyai but ASSEMBLYAI_API_KEY is not set. "
            "Get a key at https://www.assemblyai.com/, `setx ASSEMBLYAI_API_KEY ...`, "
            "and restart from a NEW terminal."
        )
    if name == "deepgram" and not config.DEEPGRAM_API_KEY:
        return (
            "TRANSCRIBER_PROVIDER=deepgram but DEEPGRAM_API_KEY is not set. "
            "Get a key at https://deepgram.com/, `setx DEEPGRAM_API_KEY ...`, "
            "and restart from a NEW terminal."
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

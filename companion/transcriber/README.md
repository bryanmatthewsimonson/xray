# X-Ray Transcriber (local companion service)

A small local HTTP service that turns a YouTube URL into a
speaker-labelled transcript, entirely on your own machine: yt-dlp
downloads the audio, WhisperX (faster-whisper `large-v3`) transcribes and
word-aligns it, and pyannote diarization labels the speakers. It listens
on `127.0.0.1:8756` and serves the X-Ray extension's **"Transcribe
locally"** capture — nothing ever leaves your computer.

Expect about **15 minutes of hands-on time**; the ~7 GB of one-time
downloads (≈3 GB of CUDA wheels at setup, ≈3.5 GB of models on the first
job) run unattended and can take longer on slow links.

## Requirements

- Windows 10/11
- An NVIDIA GPU with a **driver of version 570 or newer** — no CUDA
  toolkit or cuDNN install needed; the cu128 wheels bundle everything
- ~7 GB of one-time downloads (wheels + models), cached forever
- No Python install needed — `uv` provisions its own

## Setup

1. **Install uv** (the Python package manager this project uses):

   ```
   winget install --id astral-sh.uv -e
   ```

   Then open a **NEW terminal** so the PATH update lands.

2. **Install ffmpeg**:

   ```
   winget install Gyan.FFmpeg
   ```

   Again, open a **NEW terminal** afterwards — winget edits PATH, and
   already-open terminals never see the change.

3. **Hugging Face token** (needed for speaker diarization):

   - Create a **read** token at <https://hf.co/settings/tokens>
   - Accept the model terms on
     <https://huggingface.co/pyannote/speaker-diarization-community-1>
     (note: if you pin `pyannote/speaker-diarization-3.1` via
     `TRANSCRIBER_DIARIZE_MODEL`, also accept the terms on
     `pyannote/segmentation-3.0`)
   - Store the token and open a NEW terminal:

     ```
     setx HF_TOKEN hf_your_token_here
     ```

4. **Install the service** (from the repo root):

   ```
   cd companion\transcriber
   uv sync
   ```

   This downloads ~3 GB of CUDA-enabled wheels. uv auto-installs
   Python 3.12 into its own managed store — no system Python needed.

5. **Run it**:

   ```
   uv run xray-transcriber
   ```

   …or double-click `start-transcriber.bat`. The **first job**
   additionally downloads ~3.5 GB of models (Whisper large-v3, the align
   model, the diarization pipeline); they are cached forever after that.

## Verify

```
curl http://127.0.0.1:8756/health
```

Expected shape:

```json
{"status": "ok", "device": "cuda", "queue_depth": 0, "version": "0.1.0", "ffmpeg": true, "hf_token": true}
```

`device` may read `"unknown"` for the first seconds after startup while
the probe (a child process importing torch) finishes.

## API reference

All endpoints are JSON over `http://127.0.0.1:8756`.

### `POST /transcribe`

Body: `{"url": "https://www.youtube.com/watch?v=..."}`

- `202` → `{"job_id": "<uuid4>"}`. If an **active** (queued or running)
  job already exists for the same video id, that job's id is returned
  instead of enqueueing a duplicate.
- `400` — invalid or unsupported URL (https YouTube URLs only:
  `youtube.com`, `www.`/`m.`/`music.youtube.com`, `youtu.be`)
- `429` — queue full (10 jobs)

### `GET /jobs/{job_id}`

```json
{
  "job_id": "…",
  "status": "queued" | "running" | "done" | "failed" | "cancelled",
  "stage": "downloading" | "transcribing" | "aligning" | "diarizing" | null,
  "progress": 0.42,
  "queue_position": 1,
  "created_at": "2026-08-01T17:03:12+00:00",
  "error": null,
  "result": null
}
```

- `progress` runs 0..1 across the whole job (download 0–0.15,
  transcribe 0.15–0.70, align 0.70–0.85, diarize 0.85–0.99, done 1.0).
- `queue_position` is 1-based among queued jobs (1 = next to run); null
  once the job is running or finished.
- `result` is set when `status` is `"done"` (see below).
- `404` — unknown id. Completed results are also written to
  `%LOCALAPPDATA%\xray-transcriber\jobs\<job_id>.json` and remain
  readable through this endpoint after a server restart.

### `POST /jobs/{job_id}/cancel`

Returns `{"status": ...}` — `"cancelled"` for a queued or running job
(a running job's worker process is terminated), or the unchanged
terminal status for a job that already finished.

### `GET /health`

`{"status": "ok", "device": "cuda"|"cpu"|"unknown", "queue_depth": n,
"version": "...", "ffmpeg": true|false, "hf_token": true|false}` —
`queue_depth` counts queued + running jobs. `/health` never requires the
auth token.

### Result object

```json
{
  "video_id": "dQw4w9WgXcQ",
  "title": "…",
  "channel": "…",
  "duration": 212.0,
  "language": "en",
  "segments": [
    {"start": 0.031, "end": 4.562, "speaker": "SPEAKER_00", "text": "…"},
    {"start": 4.601, "end": 7.882, "speaker": null, "text": "…"}
  ],
  "model_info": {
    "asr_model": "large-v3",
    "compute_type": "float16",
    "batch_size": 8,
    "diarization_model": "pyannote/speaker-diarization-community-1",
    "device": "cuda",
    "aligned": true,
    "whisperx_version": "…",
    "yt_dlp_version": "…"
  }
}
```

`speaker` is the raw diarization label (`SPEAKER_00`, …) or `null` when
no speaker could be assigned. `aligned: false` means the language had no
word-alignment model, so timestamps are at Whisper's segment granularity.

### CORS and authentication

The service reflects the request `Origin` **only** for
`chrome-extension://` and `moz-extension://` origins — never `*`, so
ordinary web pages cannot call the loopback API from a browser. (Chrome
extension fetches with a host permission bypass CORS entirely; the CORS
path exists for Firefox and as a fallback.)

If the `TRANSCRIBER_TOKEN` environment variable is set, every endpoint
except `/health` requires a matching `X-Transcriber-Token` header.

## Configuration

All via environment variables (set them with `setx NAME value`, then use
a **new** terminal):

| Variable | Default | Meaning |
| --- | --- | --- |
| `TRANSCRIBER_PORT` | `8756` | Listen port (`--port` CLI flag overrides) |
| `TRANSCRIBER_COMPUTE_TYPE` | `float16` | ctranslate2 compute type for the ASR model (falls back to `int8` when no CUDA device) |
| `TRANSCRIBER_BATCH_SIZE` | `8` | WhisperX transcription batch size |
| `TRANSCRIBER_MAX_DURATION_S` | `14400` | Refuse videos longer than this (seconds) |
| `TRANSCRIBER_DIARIZE_MODEL` | `pyannote/speaker-diarization-community-1` | Diarization pipeline name |
| `TRANSCRIBER_COOKIES_FILE` | *(unset)* | Path to a Netscape-format cookies.txt for yt-dlp (see Troubleshooting) |
| `TRANSCRIBER_TOKEN` | *(unset)* | When set, require `X-Transcriber-Token` on all endpoints except `/health` |
| `HF_TOKEN` | *(unset)* | Hugging Face read token; required for diarization |

Working files live in `%LOCALAPPDATA%\xray-transcriber\` (`tmp\` for
per-job audio, always deleted after the job; `jobs\` for result JSON).

## Performance

On an RTX 3090 with the defaults (`float16`, batch 8): transcription runs
at roughly **15–20× realtime** (a 1-hour video in ~3–4 minutes);
diarization adds a few minutes on long videos. VRAM peaks around
**~6 GB** and — because each job runs in a child process that exits — is
**fully released between jobs**, so a ~17 GB LM Studio model can stay
loaded on the same card. One job runs at a time; further requests queue
(up to 10).

## Security

- Binds **127.0.0.1 only** — nothing on your network can reach it.
- Any local process can use the API; set `TRANSCRIBER_TOKEN` if that
  matters on your machine.
- CORS never allows plain-web origins (see above).

## Troubleshooting

- **`cudnn_ops64_9.dll` (or similar cuDNN DLL) not found** — this
  happens when running pieces by hand in the wrong order. Run the job
  through the service: the worker imports torch first, which puts the
  bundled cuDNN DLLs on the loader path before faster-whisper needs them.
- **`fbgemm.dll` / `c10.dll` load errors** — install the
  **Microsoft Visual C++ 2015–2022 x64 redistributable** and retry.
- **YouTube download failures** (403s, "Sign in to confirm you're not a
  bot", throttling): first update yt-dlp —

  ```
  uv lock --upgrade-package yt-dlp
  uv sync
  ```

  If it persists, export cookies from **Firefox** (e.g. the
  "cookies.txt" extension) and point `TRANSCRIBER_COOKIES_FILE` at the
  file. Use Firefox for the export — Chrome's app-bound cookie
  encryption defeats cookie extraction on Windows.
- **HTTP 429 from `/transcribe`** — the queue is full (10 jobs); wait
  for jobs to finish or cancel some.
- **`hf_token: false` in `/health` or a diarization failure telling you
  to set HF_TOKEN** — complete Setup step 3, then restart the service
  from a **new** terminal (`setx` never updates already-open shells).
- **ffmpeg missing** — the service refuses to start and says so; that's
  Setup step 2 (new terminal afterwards).

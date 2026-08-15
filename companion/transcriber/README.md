# X-Ray Transcriber (local companion service)

A small local HTTP service that turns a media URL — a YouTube video, a
podcast episode, or any other public **https** page or direct media
file yt-dlp can resolve — into a speaker-labelled transcript, entirely
on your own machine: yt-dlp downloads the audio, WhisperX
(faster-whisper `large-v3`) transcribes and word-aligns it, and
pyannote diarization labels the speakers. It listens on
`127.0.0.1:8756` and serves the X-Ray extension's **"Transcribe"**
capture (not YouTube-only since the Transcribe Anywhere wave,
2026-08) — nothing ever leaves your computer.

Optionally, the service can hand transcription to a **cloud provider**
(AssemblyAI or Deepgram) instead of the local GPU — minutes per episode
for a few tens of cents, but **the episode audio leaves your machine**.
See [Cloud providers](#cloud-providers-optional) below; the default is
and remains fully local.

Expect about **15 minutes of hands-on time**; the ~7 GB of one-time
downloads (≈3 GB of CUDA wheels at setup, ≈3.5 GB of models on the first
job) run unattended and can take longer on slow links.

## Requirements

- Windows 10/11
- **ffmpeg** — required for *every* engine, cloud included; the service
  exits at startup without it
- **For the local engine only:** an NVIDIA GPU with a **driver of
  version R580 or newer** (CUDA 13 class) — no CUDA toolkit or cuDNN
  install needed; the cu130 wheels bundle everything. Check with
  `nvidia-smi`.
- Several GB of one-time downloads (wheels + models), cached forever
- No Python install needed — `uv` provisions its own

**Cloud engines still need this service.** AssemblyAI and Deepgram let
you skip the GPU, the Hugging Face token, and the model downloads — but
not the companion: yt-dlp runs locally, and this service is what uploads
the audio. `uv sync` installs the CUDA wheel set regardless of which
engine you use.

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

3. **Hugging Face token** — **required for the local engine.** Without
   it a local job fails immediately, before the download: you get *no
   transcript*, not a transcript missing its speaker labels. Cloud
   engines don't use it.

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

## Stopping it

It runs in the foreground, so **`Ctrl+C` in its window** stops it —
closing the window does the same. There is deliberately no shutdown
endpoint: nothing that can reach loopback should be able to kill the
service.

If it is running detached and you have no window for it, stop whatever
holds the port:

```
powershell -Command "Get-NetTCPConnection -LocalPort 8756 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"
```

Stopping mid-job abandons that job — cancel it in the reader first, or
expect to re-run it. Finished results survive a restart; they live in
`%LOCALAPPDATA%\xray-transcriber\jobs\`.

The extension notices within a few seconds either way: Options →
Advanced → Transcription turns red on its own, with the restart command.

## Verify

```
curl http://127.0.0.1:8756/health
```

Expected shape:

```json
{"status": "ok", "device": "cuda", "queue_depth": 0, "version": "0.1.0", "ffmpeg": true, "hf_token": true,
 "provider": "local", "providers": {"local": true, "assemblyai": false, "deepgram": false},
 "request_provider": true}
```

`device` may read `"unknown"` for the first seconds after startup while
the probe (a child process importing torch) finishes. `provider` is the
active engine; `providers` reports which engines have their credential
set (never the credentials themselves).

## API reference

All endpoints are JSON over `http://127.0.0.1:8756`.

### `POST /transcribe`

Body: `{"url": "https://www.youtube.com/watch?v=..." (or any admitted
media URL — see "What URLs are accepted" below),
"provider": "local" | "assemblyai" | "deepgram" (optional),
"api_key": "..." (optional)}`

- `provider` picks the engine **for this job** (the extension's engine
  picker / settings). Absent → the `TRANSCRIBER_PROVIDER` env default.
- `api_key` supplies the cloud credential with the request. It is held
  in memory, handed to the worker child via its process environment,
  and **never written to disk, logged, or echoed**. It overrides an
  env-configured key for the same provider. A cloud job with no key
  from either source is refused with `400` naming the fix.
- `202` → `{"job_id": "<uuid4>"}`. If an **active** (queued or running)
  job already exists for the same media (same `media_key` — see
  "What URLs are accepted" below), that job's id is returned instead
  of enqueueing a duplicate — whatever engine it started with wins.
- `400` — the URL fails admission (see "What URLs are accepted"
  below), unknown provider, or a cloud provider with no API key
  available
- `400` detail names the specific admission failure: not https, an
  embedded credential (`user:pass@host`), or a hostname that resolves
  to a private/loopback/reserved address
- `429` — that engine's queue is full (10 jobs per pool; the local and
  cloud pools are capped independently)

### `GET /jobs/{job_id}`

```json
{
  "job_id": "…",
  "status": "queued" | "running" | "done" | "failed" | "cancelled",
  "stage": "downloading" | "uploading" | "transcribing" | "aligning" | "diarizing" | null,
  "progress": 0.42,
  "queue_position": 1,
  "created_at": "2026-08-01T17:03:12+00:00",
  "provider": "local" | "assemblyai" | "deepgram",
  "error": null,
  "result": null
}
```

- `progress` runs 0..1 across the whole job. Local: download 0–0.15,
  transcribe 0.15–0.70, align 0.70–0.85, diarize 0.85–0.99, done 1.0.
  Cloud: download 0–0.15, upload 0.15–0.30, transcribe 0.30–0.99 (the
  provider diarizes inside its one job — no separate stages), done 1.0.
- `uploading` and `provider` are additive fields (older extension
  builds ignore them); `uploading` only ever appears on cloud jobs.
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
"version": "...", "ffmpeg": true|false, "hf_token": true|false,
"provider": "...", "providers": {...}, "request_provider": true,
"generic_urls": true}` — `queue_depth` counts queued + running jobs;
`request_provider: true` marks a build that honors per-request
`provider`/`api_key` on `POST /transcribe`; `generic_urls: true`
marks a build that admits any public https media URL, not only
YouTube (see "What URLs are accepted" below) — the extension checks
this flag before sending a non-YouTube URL, and refuses client-side
(naming `git pull` + `uv sync`) against an older service that lacks
it, rather than let the request 400. `/health` never requires the
auth token.

### What URLs are accepted

`POST /transcribe` admits a URL when **all** of the following hold
(`transcriber/media_url.py`, `validate_media_url`):

- **Scheme is `https`.** No `http://`, no `file://`, no anything else.
- **No embedded credentials** (`https://user:pass@host/...` is
  refused outright).
- **Every address the hostname resolves to is public unicast.**
  Private, loopback, link-local, reserved, and multicast ranges are
  all refused — including addresses embedded in an RFC 6052 NAT64
  (`64:ff9b::/96`) or IPv4-mapped (`::ffff:0:0/96`) IPv6 address, so a
  hostname whose AAAA record smuggles `169.254.169.254` (the cloud
  metadata address) inside a NAT64 wrapper is still caught.
- **Not a live stream** — refused rather than run unbounded.
- **Under the duration cap** — `TRANSCRIBER_MAX_DURATION_S` (default
  `14400`, 4 hours); raise it to allow longer media.

Once admitted, the URL goes to yt-dlp exactly as given — yt-dlp
resolves page URLs, embedded players, and direct media files alike,
so a podcast episode page, an off-platform video page, or a link
straight to an `.mp3`/`.mp4` file all work the same way. **This
admission check is best-effort, not a closed SSRF gate**: it resolves
DNS once, at admission time, but yt-dlp re-resolves DNS and follows
redirects on its own afterward, so DNS rebinding is not closed. See
`docs/THREAT_MODEL.md` (B10, gap G8) for the full accounting of what
bounds that residual risk and what doesn't.

### Result object

`video_id` keeps its name for every media source, not only YouTube —
it is whatever yt-dlp's `info.get("id")` returns for the resolved
media (an extension-facing field, unchanged by the Transcribe
Anywhere wave so no client code needed to change). Job identity
(`media_key`, used for dedupe and the extension's resume records) is
a separate value: the bare YouTube video id for a YouTube URL, or
`u_<16 hex>` — a hash of a normalized form of the URL — for
everything else.

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

Cloud jobs emit the same shape; `model_info` differs:

```json
{
  "provider": "assemblyai",
  "asr_model": "universal-3-5-pro",
  "diarization_model": "assemblyai-native",
  "device": "cloud",
  "aligned": true,
  "yt_dlp_version": "…"
}
```

(`asr_model` is the model the provider reports it actually used —
AssemblyAI's `speech_model_used` — not the requested preference list.)

Cloud speaker labels (`A`/`B`, `0`/`1`) are normalized to the same
`SPEAKER_00` form, first-appearance ordered, and long speaker turns are
split into sentence-level segments using the provider's word
timestamps — so downstream treatment (speaker naming, claim time
provenance) is identical to a local run.

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
| `TRANSCRIBER_MAX_DURATION_S` | `14400` | Refuse media longer than this (seconds) |
| `TRANSCRIBER_DIARIZE_MODEL` | `pyannote/speaker-diarization-community-1` | Diarization pipeline name |
| `TRANSCRIBER_COOKIES_FILE` | *(unset)* | Path to a Netscape-format cookies.txt for yt-dlp (see Troubleshooting). **This is a credential** — typically a full browser cookie export — so it is only ever sent to the hosts `TRANSCRIBER_COOKIES_HOSTS` names, never to every URL this service fetches |
| `TRANSCRIBER_COOKIES_HOSTS` | the five YouTube hosts (`youtube.com,www.youtube.com,m.youtube.com,music.youtube.com,youtu.be`) | Comma-separated, **exact-hostname-match** allowlist of which hosts `TRANSCRIBER_COOKIES_FILE` may be sent to (`example.com` never authorizes `evil.example.com`). Before the Transcribe Anywhere wave, cookies went to yt-dlp unconditionally — safe only because the URL admission gate was YouTube-only. Once any public https URL is admitted, an unscoped cookie jar would hand your session cookies to whatever host you paste, so this now defaults to exactly the old YouTube-only behavior. **Widening this list is a deliberate decision to trust those hosts with those cookies** — only add a host whose session you're comfortable handing to whatever URL you transcribe from it |
| `TRANSCRIBER_TOKEN` | *(unset)* | When set, require `X-Transcriber-Token` on all endpoints except `/health` |
| `HF_TOKEN` | *(unset)* | Hugging Face read token; required for local diarization |
| `TRANSCRIBER_PROVIDER` | `local` | Transcription engine: `local`, `assemblyai`, or `deepgram` (see Cloud providers) |
| `ASSEMBLYAI_API_KEY` | *(unset)* | AssemblyAI API key; required when the provider is `assemblyai` |
| `DEEPGRAM_API_KEY` | *(unset)* | Deepgram API key; required when the provider is `deepgram` |
| `TRANSCRIBER_ASSEMBLYAI_MODEL` | `universal-3-5-pro,universal-2` | AssemblyAI `speech_models` preference list (comma-separated; their API tries entries in order) |
| `TRANSCRIBER_DEEPGRAM_MODEL` | `nova-3` | Deepgram `model` |
| `TRANSCRIBER_CLOUD_CONCURRENCY` | `3` | Concurrent cloud jobs (local jobs always run one at a time) |

Working files live in `%LOCALAPPDATA%\xray-transcriber\` (`tmp\` for
per-job audio, always deleted after the job; `jobs\` for result JSON).

## Cloud providers (optional)

By default everything runs locally and **nothing leaves your machine**.
Setting `TRANSCRIBER_PROVIDER` to `assemblyai` or `deepgram` trades that
away for speed and zero GPU load:

- **What leaves your machine**: the episode's downloaded AUDIO is
  uploaded to the provider's API, which processes it under *their*
  terms and retention policies. The download itself still happens
  locally via yt-dlp, whatever the source (cloud APIs take audio
  files, not URLs) — cookies, if configured, are never sent to the
  cloud provider, only to the hosts `TRANSCRIBER_COOKIES_HOSTS` names.
- **What it costs**: both providers meter per audio-hour, in the
  **~$0.15–0.40 / hour** range at 2026 list prices (AssemblyAI
  `universal` and Deepgram `nova-3` both sit near the low end; check
  current pricing). A 2-hour episode is therefore tens of cents.
- **What you get**: a 2-hour episode in a couple of minutes with no
  VRAM use (LM Studio can keep the GPU), including speaker labels —
  both providers diarize inside the same job. Up to
  `TRANSCRIBER_CLOUD_CONCURRENCY` jobs run at once.
- **What the extension shows**: the reader banner reads "Transcribing
  via AssemblyAI/Deepgram", the transcript section heading names the
  provider (e.g. `Transcript — English (AssemblyAI, diarized)`), and a
  published capture carries `extraction-method:
  assemblyai-universal-3-5-pro` (or `deepgram-nova-3`) instead of the
  `whisperx-…` form — provenance stays honest.

**Setup — the easy way (in the extension, 2026-08-02+):** open X-Ray's
Settings → Advanced → Transcription, pick the engine (or "Ask each
time", which turns the reader's 🎙 button into a per-video picker with
time/cost estimates), and paste the provider's API key. Keys are stored
by the browser on that device, sent to this loopback service with each
job, kept in memory, and passed to the worker child via its
environment — never written to disk and never logged. No service
restart needed; local and cloud jobs run side by side (local strictly
one at a time, cloud up to `TRANSCRIBER_CLOUD_CONCURRENCY`).

**Setup — the env-var way (server-side defaults):**

```
setx ASSEMBLYAI_API_KEY your_key_here
setx TRANSCRIBER_PROVIDER assemblyai
```

Open a **NEW terminal** and start the service. The env default applies
to requests that don't name an engine; a request-supplied key overrides
the env key for that job. A cloud env default without its env key now
starts with a warning (extension-supplied keys still work); an unknown
`TRANSCRIBER_PROVIDER` still refuses to start.

Notes:

- **Update the extension build first** (rebuild `dist/`, reload it in
  the browser, reopen reader tabs) before using cloud engines: an
  older extension build doesn't know the `provider` field and would
  label a cloud transcript as local — in the published heading and
  `extraction-method` tag, durably.
- Cancelling a cloud job stops the local side; a request already
  submitted to the provider finishes (and bills) on their side.
- `TRANSCRIBER_MAX_DURATION_S` applies to cloud jobs too and doubles
  as a cost guard.

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
- This service fetches whatever public https URL you (or the
  extension, on your behalf) hand it — see "What URLs are accepted"
  above for the admission rule, and `docs/THREAT_MODEL.md` (B10/B12,
  gap G8) for the full accounting, including the honest statement
  that the admission check does not close DNS rebinding.

## Development

Unit tests (normalization + provider plumbing; no network, no GPU):

```
uv run python -m unittest discover tests
```

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

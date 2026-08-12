// Transcribe flow — the reader-side orchestration of a local
// transcription job (the "Transcribe locally" capture path).
//
// MV3 topology (the audit-orchestrator lesson): the PAGE drives the
// job — one short xray:transcribe:* message per step, each delivery
// resetting the SW idle timer — never one long-lived SW call. The job
// itself runs in the loopback companion service and survives everything
// on our side; a job record in chrome.storage.local
// (`xray:transcribe:job:<videoId>`) lets a closed reader, an SW
// restart, or a re-capture RESUME polling instead of double-submitting
// (the companion also dedupes active jobs by video as a backstop).
//
// Pure decision logic + injectable IO (the autoPreAnalyzeArticle test
// seam): everything chrome-flavored arrives via `io`, so node tests
// drive the whole state machine with stubs.

export const JOB_RECORD_PREFIX = 'xray:transcribe:job:';

// A local record with no live server job behind it goes stale: server
// restarts drop queued jobs, and disk results last ~24h. Reap anything
// older than this on flow init so dead records can't pin the UI.
export const JOB_RECORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const POLL_INTERVAL_MS = 3000;

// Tolerate a companion restart mid-job: this many consecutive
// unreachable polls before surfacing the failure (the record persists,
// so the button resumes the same job once the service is back).
export const MAX_UNREACHABLE_POLLS = 5;

export function jobRecordKey(videoId) {
    return JOB_RECORD_PREFIX + String(videoId || '');
}

/** True when a stored job record is too old to trust. */
export function isRecordStale(record, now = Date.now()) {
    if (!record || typeof record !== 'object') return true;
    const started = Number(record.startedAt) || 0;
    return now - started > JOB_RECORD_TTL_MS;
}

const STAGE_LABELS = {
    downloading: 'Downloading audio',
    uploading: 'Uploading audio',
    transcribing: 'Transcribing (WhisperX)',
    aligning: 'Aligning timestamps',
    diarizing: 'Identifying speakers'
};

// Mirror of providerDisplayName in shared/diarized-transcript.js — kept
// inline because this module deliberately imports nothing (its tests
// run without a chrome stub).
const PROVIDER_LABELS = { assemblyai: 'AssemblyAI', deepgram: 'Deepgram' };

/** 'locally' / 'via AssemblyAI' — the banner + toast wording for a
 *  job/model_info provider field. Absent provider = older companion =
 *  local (the only engine that existed). */
export function providerPhrase(provider) {
    const label = PROVIDER_LABELS[String(provider || '').trim().toLowerCase()];
    return label ? `via ${label}` : 'locally';
}

/** Human progress line for the banner: stage + honest %. */
export function describeProgress(job) {
    if (!job || typeof job !== 'object') return 'Contacting the transcription service…';
    if (job.status === 'queued') {
        const pos = Number(job.queue_position);
        return pos > 0 ? `Queued behind ${pos} job${pos === 1 ? '' : 's'}…` : 'Queued…';
    }
    let label = STAGE_LABELS[job.stage] || 'Working';
    const via = PROVIDER_LABELS[String(job.provider || '').trim().toLowerCase()];
    if (via && job.stage === 'transcribing') label = `Transcribing (${via})`;
    const pct = Math.round(Math.min(1, Math.max(0, Number(job.progress) || 0)) * 100);
    return `${label}… ${pct}%`;
}

/**
 * Decide the next move from a stored record + (when it held a jobId)
 * the server's answer about that job. Returns one of:
 *   {action: 'adopt', result}    — the job finished; adopt its result
 *   {action: 'resume', jobId}    — a live job exists; poll it
 *   {action: 'start'}            — no usable prior job; POST a new one
 * Pure — the whole resume policy in one testable place.
 *
 * `provider`: the engine EXPLICITLY chosen for this run (the picker).
 * A prior job recorded under a DIFFERENT engine must not hijack an
 * explicit choice — field-found 2026-08-02: picking Local silently
 * adopted an earlier AssemblyAI job's record. Records without a
 * provider stamp (pre-engine-choice builds) keep the old behavior.
 */
export function decideResume(record, statusResp, now = Date.now(), provider) {
    if (!record || isRecordStale(record, now) || !record.jobId) return { action: 'start' };
    if (provider && record.provider && record.provider !== provider) return { action: 'start' };
    if (!statusResp || !statusResp.ok) {
        // Unknown job (server restarted past its disk retention) or the
        // service is down — the caller distinguishes: unreachable keeps
        // the record and errors out; a clean 404 starts fresh.
        return statusResp && statusResp.status === 404
            ? { action: 'start' }
            : { action: 'resume', jobId: record.jobId };
    }
    const job = statusResp.job || {};
    if (job.status === 'done' && job.result) return { action: 'adopt', result: job.result };
    if (job.status === 'failed' || job.status === 'cancelled') return { action: 'start' };
    return { action: 'resume', jobId: record.jobId };
}

/** Drop every stale job record (fire on flow init). */
export async function reapStaleJobRecords(io, now = Date.now()) {
    const all = await io.storageGetAll();
    const dead = Object.keys(all || {}).filter((k) =>
        k.startsWith(JOB_RECORD_PREFIX) && isRecordStale(all[k], now));
    if (dead.length) await io.storageRemove(dead);
    return dead.length;
}

/**
 * Run (or resume) the transcription job for a video, polling until a
 * terminal state. Resolves {ok: true, result} on success and
 * {ok: false, error, resumable?} on failure — never throws, never
 * leaves the UI hanging (the acceptance's no-silent-hang rule).
 *
 * io contract:
 *   sendMessage(msg) → Promise<resp>       (chrome.runtime.sendMessage)
 *   storageGet(key) → Promise<value>       (chrome.storage.local)
 *   storageSet(key, value) → Promise
 *   storageRemove(keys) → Promise
 *   storageGetAll() → Promise<object>
 *   sleep(ms) → Promise
 *   now() → epoch ms
 *   onProgress(job|null) → void            (banner repaint)
 */
export async function runTranscriptionJob({ videoUrl, videoId, provider, io }) {
    const key = jobRecordKey(videoId);
    const record = await io.storageGet(key);

    // Resume decision: ask the server about a remembered job first —
    // unless an explicit engine choice already disqualifies the record
    // (different engine), in which case the status is irrelevant.
    let statusResp = null;
    const mismatched = provider && record && record.provider && record.provider !== provider;
    if (record && !mismatched && !isRecordStale(record, io.now()) && record.jobId) {
        statusResp = await io.sendMessage({ type: 'xray:transcribe:status', jobId: record.jobId });
        if (statusResp && !statusResp.ok && statusResp.unreachable) {
            return {
                ok: false,
                resumable: true,
                error: statusResp.error || 'Companion transcription service not reachable.'
            };
        }
    }
    // NOTE: the job record is NEVER removed on success here — adoption
    // can still refuse (edit conflict), and the record is the only
    // handle to the finished server-side result. The CALLER removes it
    // after a successful adoption; failed/cancelled/404 reap here.
    const decision = decideResume(record, statusResp, io.now(), provider);
    if (decision.action === 'adopt') {
        return { ok: true, result: decision.result };
    }

    let jobId = decision.action === 'resume' ? decision.jobId : null;
    if (!jobId) {
        const started = await io.sendMessage({
            type: 'xray:transcribe:start',
            url: videoUrl,
            // Engine for THIS job (picker choice / stored preference);
            // undefined lets the SW fall back to the stored preference.
            ...(provider ? { provider } : {})
        });
        if (!started || !started.ok) {
            return { ok: false, missingKey: started && started.missingKey, error: (started && started.error) || 'Could not start the transcription job.' };
        }
        jobId = started.jobId;
        await io.storageSet(key, {
            jobId, url: videoUrl, videoId, startedAt: io.now(),
            ...(started.provider ? { provider: started.provider } : {})
        });
    }

    // Poll until terminal. Each message doubles as the SW keepalive.
    let unreachable = 0;
    for (;;) {
        const resp = await io.sendMessage({ type: 'xray:transcribe:status', jobId });
        if (!resp || !resp.ok) {
            if (resp && resp.status === 404) {
                await io.storageRemove([key]);
                return { ok: false, error: 'The transcription service no longer knows this job (it may have restarted). Try again.' };
            }
            unreachable += 1;
            if (unreachable >= MAX_UNREACHABLE_POLLS) {
                // Keep the record: the job may still be running server-side;
                // the next click resumes it once the service is back.
                return {
                    ok: false,
                    resumable: true,
                    error: (resp && resp.error) || 'Lost contact with the transcription service mid-job. The job may still be running — try again once the service is back.'
                };
            }
            await io.sleep(POLL_INTERVAL_MS);
            continue;
        }
        unreachable = 0;
        const job = resp.job || {};
        io.onProgress(job);
        if (job.status === 'done') {
            if (!job.result) {
                await io.storageRemove([key]);
                return { ok: false, error: 'The transcription finished but returned no result.' };
            }
            // Record kept — see the note above the resume decision.
            return { ok: true, result: job.result };
        }
        if (job.status === 'failed' || job.status === 'cancelled') {
            await io.storageRemove([key]);
            return { ok: false, error: job.error || `Transcription ${job.status}.` };
        }
        await io.sleep(POLL_INTERVAL_MS);
    }
}

/** The chrome-backed io used by the reader (kept here so index.js just
 *  wires callbacks; node tests build their own). */
export function chromeIo(browserApi, onProgress) {
    const area = browserApi.storage.local;
    return {
        sendMessage: async (msg) => {
            try {
                const resp = await browserApi.runtime.sendMessage(msg);
                // A dropped channel yields undefined — never let the loop
                // treat that as a mystery (JOURNAL: corpus-reduce SW loss).
                return resp || { ok: false, error: 'No response (service worker restarted?)', swLost: true };
            } catch (e) {
                return { ok: false, error: (e && e.message) || String(e) };
            }
        },
        storageGet: (key) => new Promise((r) => area.get([key], (res) => r(res && res[key]))),
        storageSet: (key, value) => new Promise((r) => area.set({ [key]: value }, () => r())),
        storageRemove: (keys) => new Promise((r) => area.remove(keys, () => r())),
        storageGetAll: () => new Promise((r) => area.get(null, (res) => r(res || {}))),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        now: () => Date.now(),
        onProgress
    };
}

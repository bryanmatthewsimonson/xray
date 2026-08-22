// Transcribe flow — the reader-side orchestration of a local
// transcription job (the "Transcribe locally" capture path).
//
// MV3 topology (the audit-orchestrator lesson): the PAGE drives the
// job — one short xray:transcribe:* message per step, each delivery
// resetting the SW idle timer — never one long-lived SW call. The job
// itself runs in the loopback companion service and survives everything
// on our side; a job record in chrome.storage.local
// (`xray:transcribe:job:<mediaKey>` — a YouTube video id, or the
// shared/media-key.js hash for any other media URL) lets a closed
// reader, an SW restart, or a re-capture RESUME polling instead of
// double-submitting (the companion also dedupes active jobs by media
// key as a backstop).
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

/**
 * The storage key for one media's job record, SCOPED BY TRANSPORT.
 *
 * The companion form is unsuffixed and therefore byte-identical to what
 * every pre-DC.1 build wrote — those records must keep resuming.
 * A direct job gets its own key so the two can coexist.
 *
 * That separation is not tidiness. Found by adversarial review and
 * reproduced: with one key per media, starting a companion job after a
 * direct one OVERWROTE the record holding the provider transcript id.
 * decideResume correctly refused to resume across transports, but the
 * new job's record write still destroyed the only handle to a job the
 * user had ALREADY PAID FOR. Refusing to resume it is not enough —
 * the handle has to survive.
 */
export function jobRecordKey(mediaKey, route) {
    const base = JOB_RECORD_PREFIX + String(mediaKey || '');
    return (route && route !== 'companion') ? `${base}:${route}` : base;
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
//
// EVERY selectable engine id must appear here. An id that is missing
// falls through to 'locally' in providerPhrase below, which renders the
// in-flight banner and the success toast — so a run that handed a third
// party a URL would announce itself as local. That is the durable lie
// the JOURNAL ruled against on 2026-08-02, and
// tests/engine-vocabulary.test.mjs machine-checks it now rather than
// trusting this comment.
//
// 'assemblyai-direct' is the SELECTION id for the companion-free
// transport; it maps to the same human label as the companion-routed
// AssemblyAI engine because it is the same provider doing the same
// work. (The wire-visible provenance id is plain 'assemblyai' for both
// — see DIRECT_PROVIDER in shared/direct-transcribe.js.)
const PROVIDER_LABELS = {
    assemblyai: 'AssemblyAI',
    deepgram: 'Deepgram',
    'assemblyai-direct': 'AssemblyAI'
};

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
    // ABSENT progress is not zero progress. The companion reports real
    // stages plus a wall-clock estimate from a probed duration; the
    // direct path has neither (nothing is downloaded, so nothing probes
    // the length, and the provider reports no percentage). Rendering
    // "0%" there would be a fabricated number that also reads as a
    // stuck job. An explicit 0 still renders — that is a real reading.
    if (job.progress == null) return `${label}…`;
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
 *
 * `route`: which TRANSPORT this run uses — 'companion' (a job id the
 * loopback service issued) or 'direct' (a provider transcript id).
 * Checked INDEPENDENTLY of the provider clause, because the two ids
 * are not interchangeable in either direction: polling AssemblyAI with
 * a companion job id spends a credential on a meaningless request, and
 * adopting a companion result on a direct run would misreport which
 * engine ran. A record with no route stamp is a pre-DC.1 companion
 * record and resumes on the companion path exactly as before.
 *
 * `mediaUrl`: the URL THIS run would submit. A record can outlive a
 * re-capture that discovers a different `mediaHints.fileUrl`, and
 * resuming then would adopt a transcript of different audio.
 */
export function decideResume(record, statusResp, now = Date.now(), provider, route, mediaUrl) {
    if (!record || isRecordStale(record, now) || !record.jobId) return { action: 'start' };
    if (provider && record.provider && record.provider !== provider) return { action: 'start' };
    if (route && (record.route || 'companion') !== route) return { action: 'start' };
    if (mediaUrl && record.url && record.url !== mediaUrl) return { action: 'start' };
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

// DC.2: the driver is shared, its failure strings were not. On the
// direct route "the transcription service" is AssemblyAI, and "try
// again once the service is back" names something the user does not
// run. Companion wording is preserved byte-for-byte — a companion user
// must read exactly what they always did.
const JOB_LOST_MESSAGE = {
    companion: 'The transcription service no longer knows this job (it may have restarted). Try again.',
    direct: 'AssemblyAI no longer knows this transcript (their record of it may have expired). Start a new transcription.'
};
const CONTACT_LOST_MESSAGE = {
    companion: 'Lost contact with the transcription service mid-job. The job may still be running — try again once the service is back.',
    direct: 'Lost contact with AssemblyAI mid-job. The transcription may still be running on their side — try again in a moment; it will resume rather than start over.'
};
const UNREACHABLE_MESSAGE = {
    companion: 'Companion transcription service not reachable.',
    direct: 'Could not reach AssemblyAI.'
};

/**
 * Run (or resume) the transcription job for one media URL, polling until a
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
export async function runTranscriptionJob({
    mediaUrl, mediaKey, provider, io,
    // The TRANSPORT this run speaks. Defaults reproduce the companion
    // path byte-for-byte, so every pre-DC.1 call site is unchanged and
    // its tests stay green unmodified. The driver itself is NOT forked:
    // one job loop, one resume policy, one tested lifecycle — the only
    // things that vary are which messages it sends and how often.
    route = 'companion',
    startType = 'xray:transcribe:start',
    statusType = 'xray:transcribe:status',
    pollMs = POLL_INTERVAL_MS
}) {
    const key = jobRecordKey(mediaKey, route);
    const record = await io.storageGet(key);

    // Resume decision: ask the server about a remembered job first —
    // unless an explicit engine choice already disqualifies the record
    // (different engine, different transport, or a different source
    // URL), in which case the status is irrelevant and asking would
    // spend a credential on a meaningless request.
    let statusResp = null;
    const mismatched = (provider && record && record.provider && record.provider !== provider)
        || (record && (record.route || 'companion') !== route)
        || (record && record.url && mediaUrl && record.url !== mediaUrl);
    if (record && !mismatched && !isRecordStale(record, io.now()) && record.jobId) {
        statusResp = await io.sendMessage({ type: statusType, jobId: record.jobId });
        if (statusResp && !statusResp.ok && statusResp.unreachable) {
            return {
                ok: false,
                resumable: true,
                error: statusResp.error || UNREACHABLE_MESSAGE[route] || UNREACHABLE_MESSAGE.companion
            };
        }
    }
    // NOTE: the job record is NEVER removed on success here — adoption
    // can still refuse (edit conflict), and the record is the only
    // handle to the finished server-side result. The CALLER removes it
    // after a successful adoption; failed/cancelled/404 reap here.
    const decision = decideResume(record, statusResp, io.now(), provider, route, mediaUrl);
    if (decision.action === 'adopt') {
        return { ok: true, result: decision.result };
    }

    let jobId = decision.action === 'resume' ? decision.jobId : null;
    if (!jobId) {
        const started = await io.sendMessage({
            type: startType,
            url: mediaUrl,
            // Engine for THIS job (picker choice / stored preference);
            // undefined lets the SW fall back to the stored preference.
            ...(provider ? { provider } : {})
        });
        if (!started || !started.ok) {
            return { ok: false, missingKey: started && started.missingKey, error: (started && started.error) || 'Could not start the transcription job.' };
        }
        jobId = started.jobId;
        // Written BEFORE the first poll on purpose: on the direct
        // transport this id is the only handle to an already-paid
        // provider job, and an MV3 worker can be torn down between the
        // submit and the next tick.
        await io.storageSet(key, {
            jobId, url: mediaUrl, mediaKey, startedAt: io.now(), route,
            ...(started.provider ? { provider: started.provider } : {})
        });
    }

    // Poll until terminal. Each message doubles as the SW keepalive.
    let unreachable = 0;
    for (;;) {
        const resp = await io.sendMessage({ type: statusType, jobId });
        if (!resp || !resp.ok) {
            if (resp && resp.status === 404) {
                await io.storageRemove([key]);
                return { ok: false, error: JOB_LOST_MESSAGE[route] || JOB_LOST_MESSAGE.companion };
            }
            unreachable += 1;
            if (unreachable >= MAX_UNREACHABLE_POLLS) {
                // Keep the record: the job may still be running server-side;
                // the next click resumes it once the service is back.
                return {
                    ok: false,
                    resumable: true,
                    error: (resp && resp.error) || CONTACT_LOST_MESSAGE[route] || CONTACT_LOST_MESSAGE.companion
                };
            }
            await io.sleep(pollMs);
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
        await io.sleep(pollMs);
    }
}

/** Is `url` something the companion could actually fetch? The companion's
 *  validate_media_url (media_url.py) admits https:// only — not http,
 *  not file:// — so this is a plain scheme check, never a URL parse
 *  (keeps this module import-free). Shared by hasMediaSignal (the
 *  button's show/hide gate) and runTranscribeFlow's own guard (the
 *  path the auto-start / re-run flow reaches independent of the
 *  button), so the two can never disagree. */
export function isFetchableMediaUrl(url) {
    return /^https:\/\//i.test(String(url || ''));
}

// Platform ids with a dedicated capture handler (src/shared/platforms/
// index.js HANDLERS). Mirrored here as a literal list rather than
// imported — this module is deliberately import-free (its tests run
// with no chrome stub) — so keep it in sync with that file's HANDLERS
// keys when a platform handler is added or removed.
const KNOWN_PLATFORMS = new Set([
    'substack', 'youtube', 'twitter', 'tiktok', 'instagram', 'facebook', 'pmc', 'arxiv'
]);

/**
 * The URL to hand the companion for THIS transcription — smoke-failure
 * diagnosis B2 (.superpowers/sdd/2026-08-13-transcribe-anywhere/
 * smoke-failure-diagnosis.md). The wave sends the PAGE url on purpose
 * (kickoff Approach A): IG/FB media URLs are signed and expire, so the
 * page is the only stable address there, and yt-dlp resolves it. A
 * podcast CDN file is the opposite case — the page itself often can't
 * be resolved by yt-dlp at all (PowerPress/Blubrry sites 403 non-browser
 * agents), but the direct file URL is both stable AND fetchable.
 *
 * Deterministic, no trial-and-error: a KNOWN platform (one with a
 * capture handler — yt-dlp handles those best, and the signed-URL
 * hazard is real there, YouTube included) always keeps sending its page
 * URL; anything else falls back to a discovered `mediaHints.fileUrl`
 * when there is one and it's https, else the page URL as before.
 *
 * Never touches `article.url` itself — that stays the article's
 * identity (archive keying, re-capture dedup, the `a` tag on anything
 * published). This only decides what gets POSTed to the transcription
 * job.
 */
export function transcribeSourceUrl(article) {
    const a = article || {};
    if (a.platform && KNOWN_PLATFORMS.has(a.platform)) return a.url;
    const fileUrl = a.mediaHints && a.mediaHints.fileUrl;
    return isFetchableMediaUrl(fileUrl) ? fileUrl : a.url;
}

// Media-file extensions, mirrored from shared/media-hints.js
// mediaKindForHref — this module deliberately imports nothing (its
// tests run with no chrome stub), so keep the two in sync.
// Human names for the KNOWN_PLATFORMS ids. Inline for the same reason
// PROVIDER_LABELS is: this module deliberately imports nothing. Keep in
// sync with KNOWN_PLATFORMS above.
const PLATFORM_LABELS = {
    substack: 'Substack', youtube: 'YouTube', twitter: 'X', tiktok: 'TikTok',
    instagram: 'Instagram', facebook: 'Facebook', pmc: 'PMC', arxiv: 'arXiv'
};

const MEDIA_EXT_RE = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|mp4|m4v|webm|mov)$/i;

/**
 * Why THIS url cannot be submitted to a direct cloud provider, or null.
 *
 * Returns `{short, detail}` — `short` is a menu-row reason so the picker
 * can mark the engine unavailable BEFORE the user clicks, `detail` is
 * the full explanation for the refusal toast.
 *
 * The direct route's one structural limit: a provider fetches a URL, it
 * does not resolve a page. The companion has yt-dlp and genuinely can,
 * which is why transcribeSourceUrl falls back to the page URL — correct
 * there, guaranteed-useless here.
 *
 * Deliberately NOT a heuristic about what a media URL looks like: the
 * test is whether we are about to submit the CAPTURED PAGE'S OWN
 * address, which is definitionally a page — unless the capture is
 * itself a media file, which is the one exception.
 *
 * The REMEDY is platform-specific, which the first version got wrong
 * (field report 2026-08-16, on YouTube). Advice has to be true for the
 * page in front of the user AND reachable in their configuration:
 *
 *  - YouTube: do not suggest pasting a direct file URL — those are
 *    signed and expire (kickoff §8). And do not lead with "use the
 *    companion" to the direct-only user this feature exists for. What
 *    is actually true is better news: YouTube captions are already
 *    fetched with the capture (platforms/youtube.js fetchTranscript),
 *    so nothing is missing except diarized speaker labels.
 *  - Other known platforms: signed, expiring URLs; the companion is
 *    genuinely the only path, so say that plainly.
 *  - Off-platform: a direct file URL exists somewhere and simply was
 *    not discovered — the Media modal is a real, reachable fix.
 */
export function directSubmissionProblem(article, sourceUrl) {
    const a = article || {};
    const url = String(sourceUrl || '');
    if (!url || url !== a.url) return null;
    if (MEDIA_EXT_RE.test(url.split(/[?#]/)[0])) return null;

    const platform = a.platform && KNOWN_PLATFORMS.has(a.platform) ? a.platform : '';
    const label = PLATFORM_LABELS[platform] || platform;

    if (platform === 'youtube') {
        return {
            short: 'YouTube media URLs are signed and expire — a provider cannot fetch them.',
            detail: 'AssemblyAI (direct) cannot transcribe this YouTube page: a cloud provider '
                + 'downloads a URL, and YouTube\u2019s media URLs are signed and expire. '
                + 'You are not missing a transcript, though \u2014 YouTube\u2019s own captions '
                + 'are captured with the page. Transcribing would only add diarized speaker '
                + 'labels, and on YouTube that needs the companion service, which resolves the '
                + 'page with yt-dlp.'
        };
    }
    if (platform) {
        return {
            short: `${label} media URLs are signed and expire — a provider cannot fetch them.`,
            detail: `AssemblyAI (direct) cannot transcribe this ${label} page: a cloud provider `
                + `downloads a URL, and ${label}\u2019s media URLs are signed and expire. `
                + 'The companion service resolves these pages with yt-dlp; the direct route '
                + 'cannot.'
        };
    }
    return {
        short: 'No direct media file was found on this page.',
        detail: 'AssemblyAI (direct) needs a media file, and no direct media file was found on '
            + 'this page, so this capture falls back to its page address. A cloud provider '
            + 'downloads a URL; it cannot open a page and find the audio. Use the '
            + '\u{1F399} Media & source modal to paste the episode\u2019s direct file URL.'
    };
}

/**
 * Does this capture look like it has media a transcriber could fetch?
 *
 * Deliberately GENEROUS. A false positive costs one clear error from
 * the companion ("no media found at this URL"); a false negative hides
 * the feature on exactly the long-tail pages this exists for. The
 * escape hatch for anything missed is the 🎙 Media & source modal's
 * "Transcribe from source", offered on every capture.
 */
export function hasMediaSignal(article) {
    const a = article || {};
    // Only a fetchable web address qualifies. A Phase-21 transcript
    // import with no episode URL carries a synthetic file:///imported/
    // identity (transcript-article.js syntheticTranscriptUrl) — truthy,
    // but the companion admits https only, so offering Transcribe there
    // (or on an http:// source) is a button that cannot ever succeed.
    // An import WITH a real https episode URL still qualifies, which is
    // the case we want.
    if (!isFetchableMediaUrl(a.url)) return false;
    if (a.platform === 'youtube' && a.youtube && a.youtube.videoId) return true;
    if (a.contentType === 'video' || a.contentType === 'audio') return true;
    if (a.media === 'video' || a.media === 'podcast') return true;
    if (a.podcast && Object.keys(a.podcast).length > 0) return true;
    const h = a.mediaHints;
    // fileUrl (B1's PowerPress signal) qualifies on its own — a page can
    // expose only a direct download anchor with no <audio>/<video>/embed.
    if (h && (h.audio || h.video || (Array.isArray(h.embeds) && h.embeds.length > 0) || h.fileUrl)) return true;
    return false;
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

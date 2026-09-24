// LLM job records — the durable seam between a long service-worker LLM
// call and the extension page that asked for it.
//
// WHY THIS EXISTS (JOURNAL 2026-09-05). The corpus reduce, the corpus
// map, and the entity-page reduce each used to ride ONE runtime message:
// the page sent the request, the worker's handler returned `true` and
// held `sendResponse` open across the whole Anthropic call. MV3 kills a
// worker whose single request runs past ~5 minutes, whatever the page's
// keepalive pings do to the idle timer — so a long reduce (87 members on
// Fable 5) died with "the message channel closed before a response was
// received", and the completed, PAID result had nowhere to land. A ~$5
// run, gone.
//
// The shape here is the repo's transcribe precedent
// (xray:transcribe:{start,status}), applied to the in-worker LLM passes:
//
//   start  → returns a job id IMMEDIATELY (the request never waits on
//            the model); the worker runs the pass detached.
//   PERSIST → the raw pass result is written to chrome.storage.local
//            under the job id BEFORE any response hop carries it.
//   status → the page long-polls (≤15s per message, well under the
//            5-minute request rule); each poll also resets the idle
//            timer. A poll after a worker restart still finds the
//            persisted record — a dropped channel costs a refresh, never
//            a re-spend.
//   ack    → the page deletes the record once IT has persisted the
//            result (brief saved, extract cached). Un-acked results
//            survive for LLM_JOB_TTL_MS and are REUSED by the next start
//            with the same scope key (dedupe), so a result that was paid
//            for but never delivered is picked up, not re-bought.
//
// While a job runs the worker also heartbeats the record every
// LLM_JOB_HEARTBEAT_MS: a chrome.storage write is an extension API call,
// which resets the MV3 idle timer from INSIDE the worker — so the job
// outlives a page reload gap that the page-side keepalive could not.
//
// What a record holds: the pass name, the scope key, the status, and
// the pass's RAW result (model output — B8-class data the page still
// validates, grounds, and human-gates exactly as before). It never holds
// the request (member texts would bloat storage for nothing; a lost job
// is re-requested by the page, which owns the inputs) and never key
// material. Records are excluded from backups (`isLlmJobKey`) and
// scoped to the workspace they were started in (`jobStorageKey`).
//
// Chrome-free at import: the storage area and timers are injectable so
// the runner is unit-tested against a stub, including the worker-restart
// paths that no live test can stage deterministically.

import { activeWorkspaceId } from './workspace-keys.js';

export const LLM_JOB_KEY_PREFIX = 'xray:llm-job:';

/** The passes a page may start by name. Fail-closed: anything else is
 *  rejected at the receiver before any function is looked up. */
export const LLM_JOB_PASSES = Object.freeze(['corpus-map', 'corpus-reduce', 'entity-page']);

/** Un-acked records older than this are swept (once per worker boot). A
 *  paid result should not evaporate in an hour; a week is generous. */
export const LLM_JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Longest a single status message may wait for the job to settle. Kept
 *  far below MV3's 5-minute single-request kill. */
export const LLM_JOB_STATUS_WAIT_MAX_MS = 15000;

/** Worker-side heartbeat cadence while any job runs (see header). */
export const LLM_JOB_HEARTBEAT_MS = 20000;

/** How many consecutive dropped status polls the client tolerates before
 *  giving up (the worker may be restarting between them). */
export const LLM_JOB_MAX_DROPPED_POLLS = 6;

export const LLM_JOB_STATUSES = Object.freeze(['running', 'done', 'failed', 'lost']);

/** The one honest sentence for a job whose worker died mid-call. The
 *  page appends which stage that means for ITS surface. */
export const LLM_JOB_LOST_ERROR = 'the service worker restarted during the call, so its result was never produced';

const SCOPE_KEY_RE = /^[A-Za-z0-9:._-]{1,200}$/;
const JOB_ID_RE = /^[a-z-]+:[A-Za-z0-9:._-]{1,240}$/;

/**
 * Records are WORKSPACE-SCOPED, like every other piece of casework
 * state (the registries carry a `ws:<id>:` prefix; the databases a
 * workspace suffix): a result produced in one workspace is never found,
 * reused, or served in another, even for a case bundle imported into
 * both with identical ids. The workspace is resolved at the receiver
 * from the active-workspace pointer, never taken from the message.
 */
export function jobStorageKey(jobId, workspace = 'default') {
    return `${LLM_JOB_KEY_PREFIX}${workspace || 'default'}:${jobId}`;
}

/** True for any storage key the job layer owns (backup exclusion). */
export function isLlmJobKey(key) {
    return typeof key === 'string' && key.startsWith(LLM_JOB_KEY_PREFIX);
}

/**
 * Build a scope key from id/hash parts. Parts are joined with `:` after
 * clamping each to the key alphabet, so an id with an unexpected
 * character degrades to a still-unique key instead of a refused start.
 */
export function llmJobScopeKey(...parts) {
    return parts.map((p) => String(p == null ? '' : p).replace(/[^A-Za-z0-9._-]/g, '_'))
        .join(':').slice(0, 200);
}

function defaultArea() {
    const api = (typeof browser !== 'undefined' && browser.storage) ? browser
        : (typeof chrome !== 'undefined' ? chrome : null);
    return api && api.storage && api.storage.local ? api.storage.local : null;
}

function lastErrorMessage() {
    try {
        const api = (typeof chrome !== 'undefined') ? chrome : null;
        const err = api && api.runtime && api.runtime.lastError;
        return err ? (err.message || 'storage error') : null;
    } catch (_) { return null; }
}

/** Promise wrappers over a callback-style storage area. `set` rejects on
 *  a reported lastError (a quota failure must not read as persisted). */
function wrapArea(area) {
    return {
        get: (keys) => new Promise((resolve) => {
            try { area.get(keys, (res) => resolve(res || {})); }
            catch (_) { resolve({}); }
        }),
        set: (obj) => new Promise((resolve, reject) => {
            try {
                area.set(obj, () => {
                    const msg = lastErrorMessage();
                    if (msg) reject(new Error(msg)); else resolve();
                });
            } catch (err) { reject(err); }
        }),
        remove: (keys) => new Promise((resolve) => {
            try { area.remove(keys, () => resolve()); }
            catch (_) { resolve(); }
        })
    };
}

function defaultNewId() {
    const c = (typeof globalThis.crypto !== 'undefined') ? globalThis.crypto : null;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    // Non-cryptographic fallback — a job id is a lookup handle, not a secret.
    return 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

function errMessage(err, fallback) {
    return (err && err.message) || (typeof err === 'string' ? err : '') || fallback;
}

/** The public view of a record — everything but nothing the page did not
 *  ask for. `withResult` false for `find` (presence only). */
function publicView(rec, withResult) {
    const out = {
        ok: true,
        jobId: rec.id,
        pass: rec.pass,
        status: rec.status,
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
        heartbeatAt: rec.heartbeatAt || null,
        error: rec.error || null
    };
    if (withResult) out.result = rec.status === 'done' ? (rec.result || null) : null;
    return out;
}

/**
 * The worker-side runner. One per service-worker instance; its in-memory
 * registry is exactly "the jobs THIS worker is running" — a record whose
 * status is `running` but whose id is not in the registry belongs to a
 * worker that died, and reads as `lost` on the next status/find/start.
 *
 * @param {object} opts
 * @param {Object<string, function>} opts.passes  name → async (request) → result
 * @param {object} [opts.area]        chrome.storage.local-like (callback style)
 * @param {function} [opts.now]       () → ms epoch
 * @param {function} [opts.newId]     () → unique id string
 * @param {function} [opts.setInterval], [opts.clearInterval]  timer injection
 * @param {number} [opts.heartbeatMs]
 * @param {number} [opts.ttlMs]
 * @param {number} [opts.statusWaitMaxMs]  the clamp on a status poll's wait
 * @param {function} [opts.workspaceId]  async () → the active workspace id
 */
export function createLlmJobRunner({
    passes = {},
    area = null,
    now = () => Date.now(),
    newId = defaultNewId,
    workspaceId = activeWorkspaceId,
    setInterval: setIntervalFn = (fn, ms) => setInterval(fn, ms),
    clearInterval: clearIntervalFn = (t) => clearInterval(t),
    heartbeatMs = LLM_JOB_HEARTBEAT_MS,
    ttlMs = LLM_JOB_TTL_MS,
    statusWaitMaxMs = LLM_JOB_STATUS_WAIT_MAX_MS
} = {}) {
    const storage = () => {
        const a = area || defaultArea();
        if (!a) throw new Error('extension storage unavailable');
        return wrapArea(a);
    };

    // id → { record, settled: Promise<void> } for jobs THIS worker runs.
    const registry = new Map();
    // id → record for results the store REFUSED (quota): served from
    // memory for this worker's lifetime so the paid answer still reaches
    // the page; the running record on disk would otherwise read as lost.
    const unpersisted = new Map();
    let swept = false;

    const currentWorkspace = async () => {
        try { return String((await workspaceId()) || 'default'); }
        catch (_) { return 'default'; }
    };

    // A job persists under the workspace it STARTED in (`rec.workspace`,
    // fixed once), so a mid-run workspace switch can never split its
    // running and done records across two workspaces.
    const persist = async (rec) => {
        rec.updatedAt = now();
        await storage().set({ [jobStorageKey(rec.id, rec.workspace)]: rec });
    };

    // Reads resolve the ACTIVE workspace: a page only ever sees the
    // records of the workspace it is in.
    const readRecord = async (id) => {
        const ws = await currentWorkspace();
        const mem = unpersisted.get(id);
        if (mem && mem.workspace === ws) return mem;
        const key = jobStorageKey(id, ws);
        const res = await storage().get([key]);
        const rec = res[key];
        if (!isPlainObject(rec) || rec.id !== id) {
            const live = registry.get(id);
            return live && live.record.workspace === ws ? live.record : null;
        }
        return rec;
    };

    /** Read a record and reconcile `running` against liveness. */
    const readLive = async (id) => {
        const rec = await readRecord(id);
        if (!rec) return null;
        const live = registry.get(id);
        if (rec.status === 'running' && !(live && live.record.workspace === rec.workspace)) {
            rec.status = 'lost';
            rec.error = LLM_JOB_LOST_ERROR;
            rec.result = null;
            await persist(rec).catch(() => {});
        }
        return rec;
    };

    /** Once per worker boot: drop records past the TTL. Best-effort. */
    const sweep = async () => {
        if (swept) return;
        swept = true;
        try {
            const all = await storage().get(null);
            const cutoff = now() - ttlMs;
            const dead = Object.keys(all).filter((k) => {
                if (!isLlmJobKey(k)) return false;
                const rec = all[k];
                const t = isPlainObject(rec) && Number.isFinite(rec.updatedAt) ? rec.updatedAt : 0;
                return t < cutoff;
            });
            if (dead.length) await storage().remove(dead);
        } catch (_) { /* a failed sweep is never a failed job */ }
    };

    const jobIdFor = (pass, scopeKey) => `${pass}:${scopeKey || newId()}`;

    const launch = (rec, run, request) => {
        let heartbeat = null;
        let resolveStarted = null;
        const entry = { record: rec, settled: null, started: new Promise((r) => { resolveStarted = r; }) };
        // Registered BEFORE any await so a poll racing the start can
        // never read this worker's own job as lost.
        registry.set(rec.id, entry);
        entry.settled = (async () => {
            try {
                // The `running` record lands first, strictly before the
                // pass can settle — the two writes are ordered, never raced.
                try { await persist(rec); }
                catch (err) { rec.persistError = errMessage(err, 'storage write failed'); }
                resolveStarted();
                heartbeat = setIntervalFn(() => {
                    rec.heartbeatAt = now();
                    persist(rec).catch(() => {});
                }, heartbeatMs);
                let result;
                try {
                    result = await run(request);
                    rec.status = 'done';
                    rec.result = isPlainObject(result) ? result : { ok: false, error: 'the pass returned no result object' };
                    rec.error = null;
                } catch (err) {
                    rec.status = 'failed';
                    rec.result = null;
                    rec.error = errMessage(err, 'the pass threw');
                }
                // THE point of the module: the result is on disk before
                // any status response can carry it.
                try { await persist(rec); }
                catch (err) {
                    rec.persistError = errMessage(err, 'storage write failed');
                    unpersisted.set(rec.id, rec);
                }
            } finally {
                if (heartbeat !== null) clearIntervalFn(heartbeat);
                registry.delete(rec.id);
            }
        })();
        return entry;
    };

    return {
        /**
         * @param {object} msg { pass, request, scopeKey? }
         * @returns {Promise<{ok:boolean, jobId?:string, status?:string, reused?:boolean, error?:string}>}
         */
        async start(msg) {
            const m = isPlainObject(msg) ? msg : {};
            const pass = typeof m.pass === 'string' ? m.pass : '';
            if (!LLM_JOB_PASSES.includes(pass) || typeof passes[pass] !== 'function') {
                return { ok: false, error: `Unknown LLM job pass: ${pass || '(none)'}` };
            }
            if (!isPlainObject(m.request)) {
                return { ok: false, error: 'LLM job request must be an object' };
            }
            let scopeKey = null;
            if (m.scopeKey != null) {
                if (typeof m.scopeKey !== 'string' || !SCOPE_KEY_RE.test(m.scopeKey)) {
                    return { ok: false, error: 'LLM job scope key is malformed' };
                }
                scopeKey = m.scopeKey;
            }
            await sweep();

            const id = jobIdFor(pass, scopeKey);
            if (scopeKey) {
                // Dedupe on the scope: attach to a live run, or hand back
                // a finished-but-undelivered result. A failed / lost /
                // unsuccessful record never replays — it is replaced.
                const existing = await readLive(id);
                if (existing && existing.status === 'running') {
                    return { ok: true, jobId: id, status: 'running', reused: true };
                }
                if (existing && existing.status === 'done' && existing.result && existing.result.ok === true) {
                    return { ok: true, jobId: id, status: 'done', reused: true };
                }
            }

            const t = now();
            const rec = {
                id, pass, scopeKey, workspace: await currentWorkspace(), status: 'running',
                createdAt: t, updatedAt: t, heartbeatAt: t,
                result: null, error: null
            };
            const entry = launch(rec, passes[pass], m.request);
            await entry.started;   // the `running` record is on disk
            return { ok: true, jobId: id, status: 'running', reused: false };
        },

        /**
         * Long-poll one job. Waits up to `waitMs` (clamped) for a job
         * this worker is running to settle, then reports the record —
         * from storage, so a restarted worker serves the persisted
         * result exactly like the one that produced it.
         *
         * @param {object} msg { jobId, waitMs? }
         */
        async status(msg) {
            const m = isPlainObject(msg) ? msg : {};
            const id = typeof m.jobId === 'string' && JOB_ID_RE.test(m.jobId) ? m.jobId : '';
            if (!id) return { ok: false, error: 'LLM job id is malformed' };
            const waitMs = Math.max(0, Math.min(statusWaitMaxMs, Number(m.waitMs) || 0));
            const live = registry.get(id);
            if (live && waitMs > 0 && live.record.workspace === await currentWorkspace()) {
                let timer = null;
                await Promise.race([
                    live.settled,
                    new Promise((r) => { timer = setTimeout(r, waitMs); })
                ]);
                if (timer !== null) clearTimeout(timer);
            }
            const rec = await readLive(id);
            if (!rec) return { ok: false, error: 'Unknown LLM job (finished and cleared, or never started)', unknown: true };
            const out = publicView(rec, true);
            if (rec.persistError) out.persistError = rec.persistError;
            return out;
        },

        /** Presence check by scope — status only, never the result. */
        async find(msg) {
            const m = isPlainObject(msg) ? msg : {};
            const pass = typeof m.pass === 'string' ? m.pass : '';
            if (!LLM_JOB_PASSES.includes(pass)) return { ok: false, error: `Unknown LLM job pass: ${pass || '(none)'}` };
            if (typeof m.scopeKey !== 'string' || !SCOPE_KEY_RE.test(m.scopeKey)) {
                return { ok: false, error: 'LLM job scope key is malformed' };
            }
            const rec = await readLive(jobIdFor(pass, m.scopeKey));
            return { ok: true, job: rec ? publicView(rec, false) : null };
        },

        /** Delete a record. Idempotent; a live job keeps running (its
         *  result is re-persisted on settle and swept by TTL). */
        async ack(msg) {
            const m = isPlainObject(msg) ? msg : {};
            const id = typeof m.jobId === 'string' && JOB_ID_RE.test(m.jobId) ? m.jobId : '';
            if (!id) return { ok: false, error: 'LLM job id is malformed' };
            const ws = await currentWorkspace();
            const mem = unpersisted.get(id);
            if (mem && mem.workspace === ws) unpersisted.delete(id);
            await storage().remove([jobStorageKey(id, ws)]);
            return { ok: true };
        },

        /** Test seam: the ids this worker instance is running. */
        _live() { return [...registry.keys()]; }
    };
}

// ---------------------------------------------------------------------------
// Page-side client

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A dropped channel: no response at all, or the page's sendMessage
 *  helper flagged lastError. A `{ok:false}` WITHOUT that flag is the
 *  worker answering — a real refusal, not a transport loss. */
function dropped(resp) {
    return !resp || resp.swLost === true;
}

/**
 * Run one LLM pass as a job and return the pass's result object exactly
 * as the old single-message call did — plus `jobId`, which the caller
 * hands to `ackLlmJob` AFTER persisting a successful result (an un-acked
 * success is deliberately kept for pickup). Failed, lost, and
 * unsuccessful results are acked here; nothing in them is worth keeping.
 *
 * A dropped status poll is retried (the worker may be mid-restart and
 * the record is on disk); `start` itself is never retried, since a
 * dropped start could mean a job already launched.
 *
 * @param {object} opts
 * @param {function} opts.sendMessage  (msg) → Promise<response|null|undefined>
 * @param {string} opts.pass
 * @param {object} opts.request
 * @param {string|null} [opts.scopeKey]  dedupe/pickup key (see runner)
 * @param {function} [opts.onTick]       (statusResponse) per poll
 * @param {function} [opts.sleep]
 * @param {number} [opts.waitMs]
 */
export async function runLlmJob({
    sendMessage, pass, request, scopeKey = null, onTick = null,
    sleep = defaultSleep, waitMs = LLM_JOB_STATUS_WAIT_MAX_MS,
    maxDroppedPolls = LLM_JOB_MAX_DROPPED_POLLS, dropRetryMs = 2000
}) {
    let started;
    try { started = await sendMessage({ type: 'xray:llm:job:start', pass, request, scopeKey }); }
    catch (err) { started = { ok: false, error: errMessage(err, 'start failed'), swLost: true }; }
    if (!started || !started.ok || typeof started.jobId !== 'string') {
        return {
            ok: false,
            error: (started && started.error) || 'no response from the service worker when starting the call',
            swLost: dropped(started)
        };
    }
    const jobId = started.jobId;
    const ack = () => { ackLlmJob(sendMessage, jobId).catch(() => {}); };

    let droppedPolls = 0;
    for (;;) {
        let st;
        try { st = await sendMessage({ type: 'xray:llm:job:status', jobId, waitMs }); }
        catch (err) { st = { ok: false, error: errMessage(err, 'status failed'), swLost: true }; }
        if (dropped(st)) {
            droppedPolls += 1;
            if (droppedPolls > maxDroppedPolls) {
                return {
                    ok: false, jobId, swLost: true,
                    error: 'lost contact with the service worker while waiting for the call; '
                        + 'its result, if it finished, is kept and will be picked up by the next run'
                };
            }
            await sleep(dropRetryMs);
            continue;
        }
        droppedPolls = 0;
        if (!st.ok) { return { ok: false, jobId, error: st.error || 'status refused' }; }
        if (typeof onTick === 'function') { try { onTick(st); } catch (_) { /* UI only */ } }
        if (st.status === 'running') continue;
        if (st.status === 'done') {
            const result = isPlainObject(st.result) ? st.result : { ok: false, error: 'the call returned no result' };
            if (result.ok !== true) ack();
            return { ...result, jobId };
        }
        if (st.status === 'lost') {
            ack();
            // `timeout: true` lets the map orchestrator's one-retry rule
            // treat a lost unit like a lost channel (it always did).
            return { ok: false, jobId, error: LLM_JOB_LOST_ERROR, swLost: true, lost: true, timeout: true };
        }
        ack();   // failed
        return { ok: false, jobId, error: st.error || 'the call failed' };
    }
}

/** Delete a job record once its result is safely persisted page-side. */
export async function ackLlmJob(sendMessage, jobId) {
    if (typeof jobId !== 'string' || !jobId) return { ok: false };
    try { return (await sendMessage({ type: 'xray:llm:job:ack', jobId })) || { ok: false }; }
    catch (_) { return { ok: false }; }
}

/** Is a job for this scope running or waiting? `null` when none. */
export async function findLlmJob(sendMessage, { pass, scopeKey }) {
    let res;
    try { res = await sendMessage({ type: 'xray:llm:job:find', pass, scopeKey }); }
    catch (_) { res = null; }
    if (!res || !res.ok || !res.job) return null;
    return res.job;
}

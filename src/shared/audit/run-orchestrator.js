// Thorough-audit orchestration — the reader-side scheduler for
// per-module audit calls (the fix for the MV3 lost-results bug; see
// JOURNAL 2026-07-09).
//
// PURE module: no chrome, no network, no DOM, no clock reads beyond
// the injected delay. The reader injects `send` (one runtime message
// per module — each message delivery resets the MV3 service-worker
// idle timer, the lens precedent) and drives UI from `onProgress`.
// Bounded concurrency keeps 429 storms down (JOURNAL: eight parallel
// Opus calls on a tight key rate-limit each other); one automatic
// retry per module on 429 / 5xx / timeout.
//
// The orchestrator never assembles or persists — it returns the raw
// per-module findings for the caller to draft-store, assemble, and
// run through the importAuditJson firewall.

/**
 * @param {object} opts
 * @param {string[]} opts.moduleNames      modules to run (resume passes
 *                                         only the missing ones)
 * @param {(name: string) => Promise<object>} opts.send
 *        performs one module call; resolves to the module response
 *        ({ok:true, module, findings, model} | {ok:false, error,
 *        status?, timeout?}). A thrown error is treated as a
 *        retryable transport failure.
 * @param {number} [opts.concurrency=3]
 * @param {number} [opts.retryDelayMs=15000]
 * @param {(p: {module:string, phase:'start'|'done'|'failed'|'retry',
 *              okCount:number, total:number}) => void} [opts.onProgress]
 * @param {(ms: number) => Promise<void>} [opts.wait]  injectable delay
 * @returns {Promise<{modules: Object<string,object>,
 *                    failures: Array<{module:string, error:string, status?:number}>,
 *                    model: string|null}>}
 */
export async function orchestrateModuleRuns({
    moduleNames,
    send,
    concurrency = 3,
    retryDelayMs = 15000,
    onProgress = () => {},
    wait = (ms) => new Promise((r) => setTimeout(r, ms))
} = {}) {
    const names = Array.isArray(moduleNames) ? moduleNames.filter(Boolean) : [];
    const modules = {};
    const failures = [];
    let model = null;
    let okCount = 0;
    const total = names.length;

    const retryable = (res) => !!res
        && (res.timeout === true || res.status === 429 || (typeof res.status === 'number' && res.status >= 500));

    const attempt = async (name) => {
        try {
            return await send(name) || { ok: false, error: 'empty response' };
        } catch (err) {
            // Transport death (message channel closed, SW hiccup) — the
            // whole point of per-module messages is that ONE lost call
            // costs one module, retried once, not the run.
            return { ok: false, error: (err && err.message) || String(err), timeout: true };
        }
    };

    const runOne = async (name) => {
        onProgress({ module: name, phase: 'start', okCount, total });
        let res = await attempt(name);
        if (!res.ok && retryable(res)) {
            onProgress({ module: name, phase: 'retry', okCount, total });
            await wait(retryDelayMs);
            res = await attempt(name);
        }
        if (res.ok && res.findings) {
            modules[name] = res.findings;
            if (res.model) model = res.model;
            okCount += 1;
            onProgress({ module: name, phase: 'done', okCount, total });
        } else {
            failures.push({ module: name, error: res.error || 'unknown error', ...(res.status ? { status: res.status } : {}) });
            onProgress({ module: name, phase: 'failed', okCount, total });
        }
    };

    // Simple bounded pool: N workers pull from one queue.
    const queue = [...names];
    const workers = [];
    const workerCount = Math.max(1, Math.min(concurrency, queue.length));
    for (let i = 0; i < workerCount; i++) {
        workers.push((async () => {
            while (queue.length > 0) {
                const name = queue.shift();
                if (name === undefined) break;
                await runOne(name);
            }
        })());
    }
    await Promise.all(workers);

    return { modules, failures, model };
}

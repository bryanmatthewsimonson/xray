// Diagnostics buffer — the extension's own black box.
//
// Maintainer directive 2026-08-23: "How do we be proactive about making
// it easy to capture the data we know we'll need to fix potential
// bugs?" During the direct-cloud wave every field bug arrived as a
// screenshot and a sentence; the evidence a fix needed (which context,
// which error, what order) lived only in devtools consoles nobody had
// open. This module keeps the last errors in chrome.storage.local so a
// bug report can carry its own evidence: Options → Advanced → Copy
// diagnostics.
//
// Design constraints, each pinned by tests/diagnostics.test.mjs:
//  - ERRORS ONLY, always on. Utils.log stays debug-gated and is never
//    recorded — this is evidence for failures, not telemetry of use.
//    Nothing here ever leaves the machine except by the user copying it.
//  - BOUNDED RING (newest win). An error storm must not grow storage.
//  - BEST-EFFORT EVERYWHERE. A logger that can throw is a new failure
//    source; every path here swallows its own errors.
//  - LOCAL ONLY. Excluded from backups (backup.js): backups travel,
//    and error text can carry URLs the user never chose to export.
//    Credentials never appear because they never appear in error text
//    (the key-hygiene tests on every provider module enforce that
//    upstream).

export const DIAGNOSTICS_STORAGE = 'xray:diagnostics';
export const MAX_DIAGNOSTIC_ENTRIES = 200;

// Writes are queued and serialized: Utils.error can fire in bursts from
// several contexts, and unserialized read-modify-write would drop
// entries. Within one JS context this chain makes writes lossless; over
// simultaneous contexts (a tab and the SW erroring in the same instant)
// last-write-wins can drop a burst — accepted, this is a diagnostic
// aid, not a ledger.
let pending = [];
let flushChain = Promise.resolve();

function storageArea() {
    try {
        const api = (typeof browser !== 'undefined' && browser.storage) ? browser
            : (typeof chrome !== 'undefined' ? chrome : null);
        return api && api.storage && api.storage.local ? api.storage.local : null;
    } catch (_) { return null; }
}

function safeString(value) {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.message || String(value);
    try { return JSON.stringify(value); }
    catch (_) { try { return String(value); } catch (_) { return '[unprintable]'; } }
}

/**
 * Record one error-level event. Fire-and-forget: callers never await
 * (Utils.error is synchronous everywhere) — tests await
 * flushDiagnostics() to observe the result.
 */
export function recordDiagnostic(ctx, ...args) {
    try {
        pending.push({
            t: Date.now(),
            ctx: safeString(ctx == null ? '' : ctx).slice(0, 60),
            msg: args.map(safeString).join(' ').slice(0, 2000)
        });
        flushChain = flushChain.then(flushOnce).catch(() => {});
    } catch (_) { /* a failing logger must never become the failure */ }
}

function flushOnce() {
    return new Promise((resolve) => {
        const area = storageArea();
        const batch = pending;
        pending = [];
        if (!area || batch.length === 0) { resolve(); return; }
        try {
            area.get([DIAGNOSTICS_STORAGE], (res) => {
                try {
                    const prior = (res && Array.isArray(res[DIAGNOSTICS_STORAGE])) ? res[DIAGNOSTICS_STORAGE] : [];
                    const next = prior.concat(batch).slice(-MAX_DIAGNOSTIC_ENTRIES);
                    area.set({ [DIAGNOSTICS_STORAGE]: next }, () => {
                        try { void chrome.runtime?.lastError; } catch (_) { /* absent */ }
                        resolve();
                    });
                } catch (_) { resolve(); }
            });
        } catch (_) { resolve(); }
    });
}

/** Await all queued writes — a test seam; production never waits. */
export function flushDiagnostics() {
    return flushChain.then(() => flushOnce());
}

export function readDiagnostics() {
    return new Promise((resolve) => {
        const area = storageArea();
        if (!area) { resolve([]); return; }
        try {
            area.get([DIAGNOSTICS_STORAGE], (res) => {
                resolve((res && Array.isArray(res[DIAGNOSTICS_STORAGE])) ? res[DIAGNOSTICS_STORAGE] : []);
            });
        } catch (_) { resolve([]); }
    });
}

export function clearDiagnostics() {
    return new Promise((resolve) => {
        const area = storageArea();
        if (!area) { resolve(); return; }
        try { area.remove([DIAGNOSTICS_STORAGE], () => resolve()); }
        catch (_) { resolve(); }
    });
}

/** The copy-button payload: build identity first (a report without a
 *  build is undiagnosable), then one ISO-stamped line per entry. */
export function formatDiagnostics(entries, buildInfo = {}) {
    const head = [
        'X-Ray diagnostics',
        `build: ${buildInfo.version || 'unknown'} ${buildInfo.commit || ''}`.trim(),
        `copied: ${new Date().toISOString()}`,
        ''
    ];
    const rows = (entries || []).map((e) =>
        `${new Date(e.t).toISOString()} [${e.ctx || '-'}] ${e.msg}`);
    return head.concat(rows.length ? rows : ['No errors recorded.']).join('\n');
}

// A `sendMessage` that speaks the xray:llm:job:* protocol over the REAL
// runner (shared/llm-jobs.js) and an in-memory storage stub — so a test
// of a page-side consumer (article-pass, entity-page) exercises the same
// start → persist → status → ack path the extension runs, not a
// hand-rolled stand-in that would go green while the seam drifted.
//
// `jobSendMessage(legacy)` adapts an old-style stub — a function that
// received `{ type: 'xray:llm:corpus-map', request }` and returned the
// pass result — so existing tests keep their assertions on the
// synthesized legacy type and request while running through the jobs.

import { createLlmJobRunner, LLM_JOB_PASSES } from '../../src/shared/llm-jobs.js';

/** A callback-style chrome.storage.local stand-in over a plain object. */
export function memoryArea(store = {}) {
    const area = {
        store,
        sets: [],
        get(keys, cb) {
            const out = {};
            const list = keys === null || keys === undefined
                ? Object.keys(store)
                : (Array.isArray(keys) ? keys : [keys]);
            for (const k of list) {
                // Snapshot on read, like the real API (a caller mutating
                // the returned object must not mutate the store).
                if (k in store) out[k] = JSON.parse(JSON.stringify(store[k]));
            }
            cb(out);
        },
        set(obj, cb) {
            for (const [k, v] of Object.entries(obj)) {
                store[k] = JSON.parse(JSON.stringify(v));   // serialize at set time, like the real API
                area.sets.push({ key: k, status: v && v.status });
            }
            cb && cb();
        },
        remove(keys, cb) {
            for (const k of (Array.isArray(keys) ? keys : [keys])) delete store[k];
            cb && cb();
        }
    };
    return area;
}

/**
 * @param {object} opts
 * @param {Object<string, function>} opts.passes  name → async (request) → result
 * @param {object} [opts.area]   share a store across "worker restarts"
 * @param {object} [opts.runner] extra createLlmJobRunner options
 * @returns {{ sendMessage, runner, area, messages: Array }}
 */
export function createJobStub({ passes, area = memoryArea(), runner: runnerOpts = {} } = {}) {
    const runner = createLlmJobRunner({
        passes,
        area,
        // No heartbeat timers in unit tests unless a test injects them.
        setInterval: () => 0,
        clearInterval: () => {},
        ...runnerOpts
    });
    const messages = [];
    const sendMessage = async (msg) => {
        messages.push(msg);
        switch (msg && msg.type) {
            case 'xray:llm:job:start': return runner.start(msg);
            case 'xray:llm:job:status': return runner.status(msg);
            case 'xray:llm:job:find': return runner.find(msg);
            case 'xray:llm:job:ack': return runner.ack(msg);
            default: return { ok: false, error: `unhandled message type ${msg && msg.type}` };
        }
    };
    return { sendMessage, runner, area, messages };
}

/**
 * Adapt an old single-message stub to the job protocol. Every pass the
 * runner allows is routed to `legacy({ type: 'xray:llm:<pass>', request })`.
 */
export function jobSendMessage(legacy, opts = {}) {
    const passes = {};
    for (const pass of LLM_JOB_PASSES) {
        passes[pass] = (request) => legacy({ type: `xray:llm:${pass}`, request });
    }
    return createJobStub({ passes, ...opts }).sendMessage;
}

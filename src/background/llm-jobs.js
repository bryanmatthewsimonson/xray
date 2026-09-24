// LLM job dispatch for the service worker — the long in-worker LLM
// passes as JOBS (JOURNAL 2026-09-05): the corpus map (one per member
// article; the portal, the reader's Suggest, and the entity page all
// drive it), the corpus reduce (Phase 20.4, one synthesis call), and
// the entity-page reduce (EP.2).
//
// None of these may hold a chrome.runtime message open across the
// model call: MV3 kills a worker whose single request outlives ~5
// minutes, and the paid result died with it. So `start` answers with a
// job id at once, the pass runs detached, its RAW result is persisted
// under the id BEFORE any response hop, and the page long-polls
// `status` (<=15s a message). `find` is a presence check by scope;
// `ack` clears a record the page has persisted itself.
//
// One runner per worker instance: its registry is exactly "the jobs
// THIS worker is running", so a `running` record it does not know
// belongs to a worker that died and reads as `lost`. The pass table
// here is the ONLY way a page reaches these three passes. Validated at
// shared/llm-jobs.js: pass allowlist, object request, clamped scope
// key / job id / wait. The passes keep their own gates (flags + key)
// and still return RAW model output; the page keeps the whole firewall
// (validate -> ground -> human Accept). Nothing is saved or published
// here.
//
// This module sits BESIDE index.js rather than in it: the dispatch
// chain in index.js keeps the four `message.type ===` compares (the
// structure guard derives the message registry from that chain) and
// delegates each to respondLlmJob, under the surface ceiling of
// tests/structure-guards.test.mjs rule 5 ("extract, never raise").

import { runCorpusMapPass, runCorpusReducePass, runEntityPagePass } from '../shared/llm-client.js';
import { createLlmJobRunner } from '../shared/llm-jobs.js';

const llmJobs = createLlmJobRunner({
    passes: {
        'corpus-map': runCorpusMapPass,
        'corpus-reduce': runCorpusReducePass,
        'entity-page': runEntityPagePass
    }
});

// op -> [runner method, the fixed error string when it throws]. The op
// is a literal at each call site in index.js's dispatch chain, never
// read from the message.
const OPS = Object.freeze({
    start: [(message) => llmJobs.start(message), 'LLM job start failed'],
    status: [(message) => llmJobs.status(message), 'LLM job status failed'],
    find: [(message) => llmJobs.find(message), 'LLM job lookup failed'],
    ack: [(message) => llmJobs.ack(message), 'LLM job ack failed']
});

/**
 * Answer one xray:llm:job:<op> message. Always returns true so the
 * caller holds the channel for the async sendResponse — which resolves
 * as soon as the record is written (start), within
 * LLM_JOB_STATUS_WAIT_MAX_MS (status), or at once (find / ack); never
 * across a model call.
 *
 * @param {'start'|'status'|'find'|'ack'} op
 * @param {object} message   the raw runtime message (validated by the runner)
 * @param {function} sendResponse
 * @returns {true}
 */
export function respondLlmJob(op, message, sendResponse) {
    if (!Object.hasOwn(OPS, op)) throw new Error(`respondLlmJob: unknown op ${String(op)}`);
    const [run, failed] = OPS[op];
    run(message).then(
        (result) => sendResponse(result),
        (err) => sendResponse({ ok: false, error: (err && err.message) || failed })
    );
    return true;
}

// X-Ray reader — the Quick (single-shot) epistemic audit's RUN, as an
// LLM JOB (JOURNAL 2026-09-05 and its 2026-09-25 addendum). The pass used to
// ride one held-open `xray:audit:run` message raced against a 330 s
// page-side timeout; MV3 kills a worker whose single request passes ~5
// minutes, and the paid audit died with it. As the `audit-run` job the
// worker persists the raw audit under the job id before any response
// hop, this page long-polls, and a Quick audit of the same text picks
// up a result this tab never received instead of billing it again.
//
// Split out of reader/index.js, which sits at its structure-guard line
// ceiling (tests/structure-guards.test.mjs rule 5 — "extract a module,
// never raise the ceiling"). The page-side effects are injected, so the
// job seam — and the ack rule below — is testable in node.

import {
    runLlmJob, ackLlmJob, llmJobScopeKey, llmJobRequestHash, jobElapsedSeconds, jobFailureNote
} from '../shared/llm-jobs.js';

/** What `ingest` reports: the run is in the audit ledger; the import
 *  firewall REFUSED it (deterministic — the same audit is refused on
 *  every try); or anything else went wrong (a storage write). */
export const INGEST_IMPORTED = 'imported';
export const INGEST_REJECTED = 'rejected';
export const INGEST_FAILED = 'failed';

/**
 * @param {object} args
 * @param {object} args.request    { mode: 'single', markdown, ...auditRequestMeta() }
 * @param {string} args.localHash  the audited slice's canonical hash — the scope's id half
 * @param {object} deps
 * @param {function} deps.sendMessage  (msg) → Promise<response>; a dropped channel rejects or resolves empty
 * @param {function} deps.ingest       (audit, model) → Promise<INGEST_*> — never throws
 * @param {function} deps.onFailure    (message) → void
 * @param {function} [deps.onElapsed]  (seconds) → void, while the job runs
 * @returns {Promise<string|null>} the ingest outcome, or null when the call failed
 */
export async function runQuickAuditJob({ request, localHash }, { sendMessage, ingest, onFailure, onElapsed = null }) {
    const startedAt = Date.now();
    const resp = await runLlmJob({
        sendMessage, pass: 'audit-run', request,
        scopeKey: llmJobScopeKey(localHash, await llmJobRequestHash(request)),
        onTick: (st) => {
            // Anchored to the record's own start: a reader reopened onto
            // a running audit shows the real elapsed time, not 0.
            if (st.status === 'running' && onElapsed) onElapsed(jobElapsedSeconds(st, startedAt));
        }
    });
    if (!resp.ok) {
        onFailure(`Audit failed: ${String(resp.error || 'unknown error').replace(/\.$/, '')}.`
            + jobFailureNote(resp, 'Quick audit'));
        return null;
    }
    const outcome = await ingest(resp.audit, resp.model);
    // Imported: the run is in the audit ledger — release the record.
    // Rejected by the firewall: a reuse would be refused the same way,
    // forever — release it too. Any other failure (a storage write)
    // keeps it: the next Quick audit of this text picks it up without a
    // new call (the TTL is the net).
    if (outcome !== INGEST_FAILED) ackLlmJob(sendMessage, resp.jobId).catch(() => {});
    return outcome;
}

// X-Ray side panel — the RUN of the E2 LLM entity audit (Phase 17 E2,
// docs/ENTITY_CORPUS_DESIGN.md §3.2): gates → disclosure → one call →
// firewall → hand the ops to the review. Moved out of
// sidepanel/index.js when the call became an LLM JOB (JOURNAL
// 2026-09-05 and its 2026-09-25 addendum): index.js sits near its
// structure-guard line ceiling (tests/structure-guards.test.mjs rule 5
// — "extract a module, never raise the ceiling"), and every page-side
// effect here (the review host, the renderer, toast, confirm, the
// transport) is injected, so the job seam is testable in node. The
// review renderer and the op → model mapping stay in index.js with the
// health view.

import { buildRegistryDigest, validateEntityOps, ENTITY_AUDIT_PROMPT_VERSION } from '../shared/llm-entity-audit.js';
import {
    runLlmJob, ackLlmJob, llmJobScopeKey, llmJobRequestHash, jobElapsedSeconds, jobFailureNote
} from '../shared/llm-jobs.js';

/**
 * chrome.runtime.sendMessage as a promise. A torn-down worker fires the
 * callback with lastError set: that resolves as a DROPPED channel
 * (`swLost`), so the job client retries its poll instead of reading the
 * drop as the worker's refusal and abandoning a live job.
 */
function sendRuntimeMessage(msg) {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage(msg, (resp) => {
                const err = chrome.runtime.lastError;
                if (err) { resolve({ ok: false, error: err.message, swLost: true }); return; }
                resolve(resp);
            });
        } catch (_) { resolve(null); }
    });
}

/** One muted line in the review host (textContent — an error string
 *  from the worker never reaches innerHTML). */
function paintLine(host, text) {
    const line = host.ownerDocument.createElement('div');
    line.className = 'xr-side__empty';
    line.textContent = text;
    host.replaceChildren(line);
}

/**
 * Run the E2 audit. Gates (llmAssist + key) are checked BEFORE the
 * disclosure so nobody consents into a missing-key error; the
 * disclosure names exactly what leaves the device (the §3.2 privacy
 * note: names, types, descriptions, and stored mention snippets — no
 * new class of data). Raw ops go through the validateEntityOps
 * firewall; every mutation is a human Accept in the review.
 *
 * The call is the `entity-audit` job, scoped to the prompt version and
 * this exact registry digest: a result this panel never received
 * (closed mid-call, a worker restart between polls) is picked up by the
 * next identical audit instead of billed again. The record is released
 * once the review renders on a live host, or when the result is
 * unusable; a host that is gone keeps it for that pickup.
 *
 * @param {object} args  { entities, archiveRecords }
 * @param {object} deps
 * @param {function} deps.host    () → the review host element, or null when the health view is gone
 * @param {function} deps.render  ({ accepted, rejected, model, entities }) → void — the review
 * @param {function} deps.toast   (message, type?) → void
 * @param {function} [deps.sendMessage]
 * @param {function} [deps.confirm]
 * @throws {Error} when a gate is closed — the caller toasts it
 */
export async function runEntityAudit({ entities, archiveRecords }, {
    host, render, toast,
    sendMessage = sendRuntimeMessage,
    confirm = (text) => globalThis.confirm(text)
}) {
    const cfg = (await sendMessage({ type: 'xray:llm:config' })) || {};
    if (!cfg.enabled) throw new Error('LLM assist is off. Enable it in Settings → Advanced → LLM assist.');
    if (!cfg.hasKey) throw new Error('No Anthropic API key set. Add one in Settings → Advanced → LLM assist.');

    const { digest, included, truncated, mentionTextByEntity } =
        buildRegistryDigest({ entities, articles: archiveRecords });
    if (!digest.trim()) { toast('Nothing to audit — the registry is empty.'); return; }

    if (!confirm(`Audit ${included} entit${included === 1 ? 'y' : 'ies'} with the LLM?\n\n`
        + 'This sends entity names, types, descriptions, and stored mention snippets '
        + '(already-captured article fragments) to the Anthropic API under your key — '
        + 'no new class of data, but it leaves this device.'
        + (truncated ? `\n\n${truncated} entit${truncated === 1 ? 'y' : 'ies'} did not fit the size budget and are excluded.` : '')
        + '\n\nEvery proposal is reviewed here before anything changes.')) return;

    const paint = (text) => { const h = host(); if (h) paintLine(h, text); };
    paint('Auditing the registry…');
    const request = { digest };
    const startedAt = Date.now();
    const resp = await runLlmJob({
        sendMessage, pass: 'entity-audit', request,
        scopeKey: llmJobScopeKey('registry', ENTITY_AUDIT_PROMPT_VERSION, await llmJobRequestHash(request)),
        onTick: (st) => {
            // Anchored to the record's own start (survives a reopen).
            if (st.status === 'running') paint(`Auditing the registry… ${jobElapsedSeconds(st, startedAt)}s`);
        }
    });
    if (!resp.ok) {
        // Persistent, beside the button — a timed toast is too short
        // to read what a retry costs.
        const message = `Entity audit failed: ${String(resp.error || 'no response').replace(/\.$/, '')}.`
            + jobFailureNote(resp, 'Audit with LLM…');
        const h = host();
        if (h) paintLine(h, message); else toast(message, 'error');
        return;
    }

    const release = () => { ackLlmJob(sendMessage, resp.jobId).catch(() => {}); };
    let accepted, rejected;
    try {
        ({ accepted, rejected } = validateEntityOps(resp.ops, { entities, mentionTextByEntity }));
    } catch (err) {
        release();   // a result this code throws on would throw on every reuse
        throw err;
    }
    // The health view is gone: keep the record — the next identical
    // audit picks it up without a new call (the TTL is the net).
    if (!host()) return;
    try { render({ accepted, rejected, model: resp.model, entities }); }
    finally { release(); }
}

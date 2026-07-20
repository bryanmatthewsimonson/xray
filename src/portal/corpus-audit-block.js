// Corpus audit block — CA.1 (docs/CORPUS_AUDIT_KICKOFF.md). "Audit
// corpus…" on the case dashboard: every archive-backed member through
// all eight audit dimensions, cache-first (already-audited members are
// free), draft-resumable (the reader's own draft keys), every run
// imported through the SAME importAuditJson firewall the reader uses.
//
// Local ledger only — publishing stays the reader's human-gated
// per-article batch. Gated by `epistemicAuditing` (block absent when
// off) + `llmAssist` + key (button disabled with a pointer). No fused
// corpus score exists here or anywhere (§10.1/.9) — this block RUNS
// audits; the distributions render in the dossier/epistemics surfaces.

import { el } from './dom.js';
import { Utils } from '../shared/utils.js';
import { loadFlags, isEnabled } from '../shared/metadata/feature-flags.js';
import { MODULE_NAMES } from '../shared/audit/findings-schemas.js';
import { orchestrateModuleRuns } from '../shared/audit/run-orchestrator.js';
import { assembleAudit } from '../shared/audit/assemble.js';
import { importAuditJson } from '../shared/audit/import.js';
import { listRuns } from '../shared/audit/audit-cache.js';
import {
    planCorpusAudit,
    loadAuditDraft, appendAuditDraft, clearAuditDraft
} from '../shared/audit/corpus-audit.js';

function sendMessage(msg) {
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

// Keep the MV3 SW awake across the long run (the synthesis block's
// idiom — module calls message frequently, but a slow tail call is
// covered too).
function startSwKeepalive() {
    const timer = setInterval(() => {
        try {
            const p = chrome.runtime.sendMessage({ type: 'xray:llm:config' });
            if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (_) { /* SW restarting */ }
    }, 20000);
    return { stop: () => clearInterval(timer) };
}

/**
 * @param {HTMLElement} host
 * @param {object} params
 * @param {object} params.data       collectCaseDossierData output
 * @param {object} params.callbacks  {onReloadCase(), onAnalysisState(v, token), isCurrentRun(token)}
 */
export function renderCorpusAuditBlock(host, { data, callbacks = {} }) {
    (async () => {
        await loadFlags();
        if (!isEnabled('epistemicAuditing')) return;   // flag off ⇒ block absent
        const cfg = await sendMessage({ type: 'xray:llm:config' }) || {};

        const block = el('div', 'xr-caudit');
        host.appendChild(block);
        block.appendChild(el('h3', 'xr-case__heading', 'Corpus audit — every member, all eight dimensions'));
        block.appendChild(el('div', 'xr-case__explainer',
            'Runs the reader\'s per-module epistemic audit over every archive-backed member of this '
            + 'case. Already-audited members are reused for free; a crashed run resumes from its '
            + 'saved modules. Results land in the local audit ledger (publishing stays per-article, '
            + 'from the reader). Distributions render in the dossier — there is no corpus score.'));

        const controls = el('div', 'xr-synth__controls');
        const runBtn = el('button', 'xr-portal__btn', 'Audit corpus…');
        runBtn.type = 'button';
        if (!cfg.enabled || !cfg.hasKey) {
            runBtn.disabled = true;
            runBtn.title = !cfg.enabled
                ? 'LLM assist is off — enable it in Options → Advanced → LLM assist'
                : 'Set an Anthropic API key in Options → Advanced → LLM assist';
        }
        const status = el('span', 'xr-synth__status');
        controls.appendChild(runBtn);
        controls.appendChild(status);
        block.appendChild(controls);

        runBtn.addEventListener('click', async () => {
            runBtn.disabled = true;
            const runToken = {};
            const setAnalysis = (v) => {
                if (typeof callbacks.onAnalysisState === 'function') callbacks.onAnalysisState(v, runToken);
            };
            const stillCurrent = () => typeof callbacks.isCurrentRun !== 'function' || callbacks.isCurrentRun(runToken);
            setAnalysis(true);
            const keepalive = startSwKeepalive();
            try {
                status.textContent = 'Planning (checking the runs ledger)…';
                const runs = await listRuns();
                const plan = await planCorpusAudit({ records: data.articles || [], runs });
                if (plan.pending.length === 0) {
                    status.textContent = plan.audited.length
                        ? `All ${plan.audited.length} member${plan.audited.length === 1 ? '' : 's'} already audited — nothing to spend.`
                        : 'No archive-backed members to audit.';
                    return;
                }
                const calls = plan.pending.length * MODULE_NAMES.length;
                const chars = plan.pending.reduce((a, m) => a + m.chars, 0);
                const truncatedCount = plan.pending.filter((m) => m.truncated).length;
                if (!confirm(`Audit ${plan.pending.length} member${plan.pending.length === 1 ? '' : 's'} of this corpus?\n\n`
                    + (plan.audited.length ? `${plan.audited.length} already audited — reused for free.\n` : '')
                    + `This sends about ${calls} module calls (~${Math.round(chars / 1000)}k characters × 8 dimensions) to Anthropic.\n`
                    + (truncatedCount ? `${truncatedCount} over-limit member${truncatedCount === 1 ? ' is' : 's are'} audited on their first ~120k characters (keyed to that slice).\n` : '')
                    + 'Each member imports as it completes — a failure keeps everything already paid for.')) {
                    status.textContent = '';
                    return;
                }

                let done = 0;
                let failedMembers = 0;
                let moduleFailures = 0;
                for (const m of plan.pending) {
                    if (!stillCurrent()) { status.textContent = 'Stopped — the view changed; completed members are saved.'; return; }
                    status.textContent = `Auditing member ${done + 1}/${plan.pending.length}: ${m.title.slice(0, 60)}…`;
                    const draft = await loadAuditDraft(m.localHash);
                    const existing = (draft && draft.modules) || {};
                    const missing = MODULE_NAMES.filter((n) => !existing[n]);
                    const { modules, failures, model } = await orchestrateModuleRuns({
                        moduleNames: missing,
                        send: async (name) => {
                            const res = await sendMessage({
                                type: 'xray:audit:module',
                                request: { module: name, markdown: m.markdown, articleUrl: m.url, articleTitle: m.title }
                            });
                            if (res && res.ok && res.findings) {
                                await appendAuditDraft(m.localHash, name, res.findings, res.model);
                            }
                            return res;
                        },
                        onProgress: (p) => {
                            status.textContent = `Auditing member ${done + 1}/${plan.pending.length}`
                                + ` (${Object.keys(existing).length + p.okCount}/${MODULE_NAMES.length} modules): ${m.title.slice(0, 60)}…`;
                        }
                    });
                    const merged = { ...existing, ...modules };
                    moduleFailures += failures.length;
                    if (Object.keys(merged).length === 0) { failedMembers++; done++; continue; }
                    try {
                        const audit = await assembleAudit({
                            toolInput: { modules: merged },
                            model: model || (draft && draft.model) || 'unknown',
                            markdown: m.markdown,
                            metadata: m.metadata,
                            standingCaveat: null
                        });
                        await importAuditJson(audit, {
                            localArticleHash: m.localHash,
                            source: 'background',
                            captureArticleHash: m.captureHash
                        });
                        if (failures.length === 0) await clearAuditDraft(m.localHash);
                    } catch (err) {
                        Utils.error('Corpus audit: member import failed', m.url, err);
                        failedMembers++;
                    }
                    done++;
                }
                const okMembers = plan.pending.length - failedMembers;
                status.textContent = `Audited ${okMembers}/${plan.pending.length} member${plan.pending.length === 1 ? '' : 's'}`
                    + (plan.audited.length ? ` (${plan.audited.length} already cached)` : '')
                    + (moduleFailures ? `; ${moduleFailures} module call${moduleFailures === 1 ? '' : 's'} failed — re-run to fill the gaps (completed modules are saved)` : '')
                    + '. Refresh the case to see the audit surfaces update.';
                if (typeof callbacks.onReloadCase === 'function') callbacks.onReloadCase();
            } catch (err) {
                Utils.error('Corpus audit failed', err);
                status.textContent = `Corpus audit failed: ${(err && err.message) || 'unknown error'}`;
            } finally {
                keepalive.stop();
                runBtn.disabled = false;
                setAnalysis(false);
            }
        });
    })().catch((err) => Utils.error('Corpus audit block render failed', err));
}

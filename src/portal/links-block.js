// Standalone link-suggestion block — Phase 28.3. The case-dashboard
// surface that proposes cross-article claim relationships WITHOUT
// running the full corpus synthesis: one claims-index LLM call
// (xray:llm:corpus-links, the corpus triple gate), reviewed through
// the SAME proposals UI as the synthesis (renderProposals → Accept →
// EvidenceLinker, stamped llm:<model>). Decoupled on purpose: argument
// structure built here BEFORE an Analyze-corpus run enriches the
// dossier digest that run consumes.
//
// The run + its triage persist per case in the case-link-suggestions
// store (xray-audits v5), so reopening the case view neither loses the
// proposals nor resurrects triaged rows. No wire kind; nothing
// auto-applies; a proposal whose pair+relationship already exists is
// rejected with an honest reason, never silently dropped.

import { el } from './dom.js';
import { Utils } from '../shared/utils.js';
import { EvidenceLinker } from '../shared/evidence-linker.js';
import { getCaseLinkRun, saveCaseLinkRun } from '../shared/audit/audit-cache.js';
import { prepareLinkProposals, linkRecordKey } from '../shared/case-synthesis.js';
import { CLAIM_LINKS_PROMPT_VERSION, MAX_CLAIM_LINKS_CLAIMS } from '../shared/corpus-prompts.js';
import { renderProposals } from './synthesis-review.js';

function sendMessage(msg) {
    return new Promise((resolve) => {
        try { chrome.runtime.sendMessage(msg, (resp) => resolve(resp)); }
        catch (_) { resolve(null); }
    });
}

/**
 * @param {HTMLElement} host
 * @param {object} params
 * @param {object} params.data      collectCaseDossierData output
 * @param {object} params.dossier   buildCaseDossier output (scope only)
 * @param {object} params.callbacks {onReloadCase()}
 */
export function renderLinksBlock(host, { data, dossier, callbacks = {} }) {
    const caseId = data.case && data.case.id;
    if (!caseId) return;
    const block = el('div', 'xr-synth');
    host.appendChild(block);

    (async () => {
        const cfg = await sendMessage({ type: 'xray:llm:corpus-config' });
        if (!cfg || !cfg.enabled) { block.remove(); return; }   // flag off ⇒ no surface

        block.appendChild(el('h3', 'xr-case__heading',
            'Cross-article links — suggested relationships, not a ruling'));
        block.appendChild(el('p', 'xr-case__explainer',
            'Proposes supports / contradicts / updates / duplicates relationships between '
            + 'captured claims from different sources — reviewable structure the corpus '
            + 'analysis then builds on. Accepting a link never judges which claim is right.'));

        const controls = el('div', 'xr-synth__controls');
        const runBtn = el('button', 'xr-portal__btn', 'Suggest links…');
        runBtn.type = 'button';
        if (!cfg.hasKey) {
            runBtn.disabled = true;
            runBtn.title = 'Set an Anthropic API key in Options → Advanced → LLM assist';
        }
        controls.appendChild(runBtn);
        const status = el('span', 'xr-synth__status');
        controls.appendChild(status);
        block.appendChild(controls);

        const proposalHost = el('div');
        block.appendChild(proposalHost);

        // The claims index: the case's orbit claims (id + text +
        // article), capped at the digest bound with the cut disclosed.
        const orbitClaims = (data.orbit && data.orbit.claims) || [];
        const claims = orbitClaims.slice(0, MAX_CLAIM_LINKS_CLAIMS).map((c) => ({
            id: c.id, text: c.text || '', article_hash: c.article_hash || null
        }));
        const truncatedClaims = orbitClaims.length - claims.length;
        const claimsById = {};
        for (const c of orbitClaims) claimsById[c.id] = c;

        // memberByHash for the shared renderer (labels only here — the
        // links pass emits no `claim` proposals).
        const memberByHash = {};
        for (const rec of data.articles || []) {
            if (rec && rec.articleHash && !memberByHash[rec.articleHash]) {
                memberByHash[rec.articleHash] = {
                    url: rec.url || null,
                    title: (rec.article && rec.article.title) || null,
                    caseId
                };
            }
        }

        const renderStored = (record) => {
            proposalHost.replaceChildren();
            if (!record) return;
            const prov = el('div', 'xr-synth__prov',
                `${record.model || 'model'} · ${record.promptVersion || CLAIM_LINKS_PROMPT_VERSION} · `
                + `${record.claimCount} claim${record.claimCount === 1 ? '' : 's'} indexed`
                + (record.truncatedClaims ? ` (${record.truncatedClaims} beyond the cap not sent)` : ''));
            proposalHost.appendChild(prov);
            renderProposals(proposalHost, {
                acceptable: record.acceptable || [],
                rejected: record.rejected || [],
                claimsById, memberByHash, model: record.model,
                triage: record.triage || {},
                onTriage: async (key, statusVal) => {
                    record.triage = { ...(record.triage || {}), [key]: statusVal };
                    await saveCaseLinkRun(record);
                }
            });
        };

        const existing = await getCaseLinkRun(caseId);
        if (existing) renderStored(existing);

        runBtn.addEventListener('click', async () => {
            if (claims.length < 2) { status.textContent = 'Fewer than two captured claims — nothing to link.'; return; }
            if (!confirm(`Suggest cross-article claim links with the LLM?\n\n`
                + `This sends the case's claims index (${claims.length} claim${claims.length === 1 ? '' : 's'}, text only — no article bodies) to Anthropic in one call.`)) return;

            runBtn.disabled = true;
            status.textContent = 'Scanning the claims index…';
            try {
                // The already-linked list, so the model doesn't re-propose
                // and the filter can honestly reject anything it does.
                const links = Object.values(await EvidenceLinker.getAll() || {});
                const existingKeys = new Set(links.map(linkRecordKey));
                const existingLines = links.map((l) =>
                    `${l.source_claim_id} ${l.relationship} ${l.target_claim_id}`);

                const resp = await sendMessage({ type: 'xray:llm:corpus-links', request: {
                    claims, existing: existingLines,
                    caseName: data.case.name || '',
                    scopeQuestion: (dossier.scope && dossier.scope.question) || ''
                } });
                if (!resp || !resp.ok) {
                    status.textContent = `Suggestion failed: ${(resp && resp.error) || 'no response'}`;
                    return;
                }
                const { acceptable, rejected } = prepareLinkProposals(resp.linksInput, { claimsById, existingKeys });

                // Carry prior triage forward so a re-run keeps decisions
                // on re-proposed pairs (the 27 S.3 brief pattern).
                const prior = await getCaseLinkRun(caseId);
                const record = {
                    caseId, acceptable, rejected,
                    model: resp.model || null, promptVersion: CLAIM_LINKS_PROMPT_VERSION,
                    claimCount: claims.length, truncatedClaims,
                    triage: (prior && prior.triage) || {},
                    createdAt: Math.floor(Date.now() / 1000)
                };
                try { await saveCaseLinkRun(record); }
                catch (err) { Utils.error('saveCaseLinkRun failed', err); }

                status.textContent = `Done — ${acceptable.length} proposal${acceptable.length === 1 ? '' : 's'}`
                    + (rejected.length ? ` (${rejected.length} rejected)` : '') + '.';
                renderStored(record);
            } finally {
                runBtn.disabled = false;
            }
        });
    })().catch((err) => {
        Utils.error('Links block render failed', err);
        block.remove();
    });
}

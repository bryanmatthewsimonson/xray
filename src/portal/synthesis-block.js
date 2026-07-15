// Case-corpus synthesis block — Phase 20.4
// (docs/CASE_SYNTHESIS_DESIGN.md). The portal case-dashboard surface
// that runs the LLM map/reduce over a case's member articles and
// renders the grounded brief + reviewable proposals. Gated by
// `caseSynthesis` + `llmAssist` + key (via xray:llm:corpus-config):
// flag off ⇒ block absent; on-but-keyless ⇒ disabled with an Options
// hint. The brief is stored in the precious audit DB (case-briefs) and
// re-rendered on open with a stale chip when the corpus has changed.
//
// The map stage uses orchestrateModuleRuns (the audit-module bounded
// pool) with member ids as the unit list; the reduce is one call. Every
// quote is grounded against the same member texts the map used, drops
// disclosed. No fused score, no verdict — the brief renders BESIDE the
// deterministic dossier, never above it.

import { el, truncate } from './dom.js';
import { Utils } from '../shared/utils.js';
import { AssessmentModel } from '../shared/assessment-model.js';
import { orchestrateModuleRuns } from '../shared/audit/run-orchestrator.js';
import { getCaseBrief, saveCaseBrief } from '../shared/audit/audit-cache.js';
import { createGroundingIndex } from '../shared/quote-grounding.js';
import { CORPUS_PROMPT_VERSION } from '../shared/corpus-prompts.js';
import {
    buildMemberUnits, corpusInputHash, digestDossier,
    validateCorpusExtract, validateCaseBrief, groundCaseBrief, filterProposals
} from '../shared/case-synthesis.js';
import { renderProposals } from './synthesis-review.js';

function sendMessage(msg) {
    return new Promise((resolve) => {
        try { chrome.runtime.sendMessage(msg, (resp) => resolve(resp)); }
        catch (_) { resolve(null); }
    });
}

function section(brief) {
    const wrap = el('div', 'xr-synth__brief');
    if (brief.summary) {
        const s = el('details', 'xr-synth__sec'); s.open = true;
        s.appendChild(el('summary', null, 'Summary'));
        s.appendChild(el('p', 'xr-synth__text', brief.summary));
        wrap.appendChild(s);
    }
    if ((brief.positions || []).length) {
        const s = el('details', 'xr-synth__sec'); s.open = true;
        s.appendChild(el('summary', null, `Positions (${brief.positions.length})`));
        for (const p of brief.positions) {
            const d = el('div', 'xr-synth__pos');
            d.appendChild(el('span', 'xr-badge', p.label || 'position'));
            if (p.core_argument) d.appendChild(el('span', 'xr-synth__text', p.core_argument));
            s.appendChild(d);
        }
        wrap.appendChild(s);
    }
    if ((brief.cruxes || []).length) {
        const s = el('details', 'xr-synth__sec'); s.open = true;
        s.appendChild(el('summary', null, `Cruxes of disagreement (${brief.cruxes.length})`));
        for (const c of brief.cruxes) {
            const d = el('div', 'xr-synth__crux');
            d.appendChild(el('div', 'xr-synth__crux-q', c.question || ''));
            for (const side of c.sides || []) {
                const sd = el('div', 'xr-synth__side');
                if (side.position_label) sd.appendChild(el('span', 'xr-badge xr-badge--muted', side.position_label));
                sd.appendChild(el('span', 'xr-synth__text', side.view || ''));
                d.appendChild(sd);
            }
            if (c.what_would_resolve) d.appendChild(el('div', 'xr-synth__resolve', `Would resolve: ${c.what_would_resolve}`));
            s.appendChild(d);
        }
        wrap.appendChild(s);
    }
    if ((brief.load_bearing || []).length) {
        const s = el('details', 'xr-synth__sec');
        s.appendChild(el('summary', null, `Load-bearing claims (${brief.load_bearing.length})`));
        for (const lb of brief.load_bearing) {
            const d = el('div', 'xr-synth__lb');
            d.appendChild(el('blockquote', 'xr-finding-row__quote', truncate(lb.quote || '', 200)));
            if (lb.why) d.appendChild(el('span', 'xr-synth__text', lb.why));
            s.appendChild(d);
        }
        wrap.appendChild(s);
    }
    if ((brief.coverage_gaps || []).length) {
        const s = el('details', 'xr-synth__sec');
        s.appendChild(el('summary', null, `Coverage gaps (${brief.coverage_gaps.length})`));
        const ul = el('ul', 'xr-list');
        for (const g of brief.coverage_gaps) ul.appendChild(el('li', 'xr-synth__text', g));
        s.appendChild(ul);
        wrap.appendChild(s);
    }
    return wrap;
}

/**
 * @param {HTMLElement} host
 * @param {object} params
 * @param {object} params.data      collectCaseDossierData output (carries entitiesById/articles)
 * @param {object} params.dossier   buildCaseDossier output (for the digest + coverage)
 * @param {object} params.callbacks {onReloadCase()}
 */
export function renderSynthesisBlock(host, { data, dossier, callbacks = {} }) {
    const caseId = data.case && data.case.id;
    if (!caseId) return;
    const block = el('div', 'xr-synth');
    host.appendChild(block);

    (async () => {
        const cfg = await sendMessage({ type: 'xray:llm:corpus-config' });
        if (!cfg || !cfg.enabled) { block.remove(); return; }   // flag off ⇒ no surface

        block.appendChild(el('h3', 'xr-case__heading', 'Corpus synthesis — grounded brief, not a verdict'));
        const controls = el('div', 'xr-synth__controls');
        const runBtn = el('button', 'xr-portal__btn', 'Analyze corpus…');
        runBtn.type = 'button';
        if (!cfg.hasKey) {
            runBtn.disabled = true;
            runBtn.title = 'Set an Anthropic API key in Options → Advanced → LLM assist';
        }
        controls.appendChild(runBtn);
        const status = el('span', 'xr-synth__status');
        controls.appendChild(status);
        block.appendChild(controls);

        const briefHost = el('div');
        const proposalHost = el('div');
        block.appendChild(briefHost);
        block.appendChild(proposalHost);

        // Assemble member units + the live input hash (for staleness).
        const assessAll = await AssessmentModel.getAll();
        const assessmentsByClaim = {};
        for (const a of Object.values(assessAll)) {
            const cid = a && a.claim_ref && a.claim_ref.claim_id;
            if (cid && typeof a.stance === 'number') assessmentsByClaim[cid] = a.stance;
        }
        const members = await buildMemberUnits(data, { assessmentsByClaim });
        const orbitClaimIds = (dossier.orbit && dossier.orbit.claim_ids) || [];
        const liveHash = await corpusInputHash(members, orbitClaimIds);

        const claimsById = {};
        // The claim index handed to the reduce stage — id + text +
        // the member article it came from. Same set claimsById accepts,
        // so an id the model pulls from here always validates (20.6).
        const claimIndex = [];
        for (const m of members) {
            for (const c of m.claims) {
                claimsById[c.id] = c;
                claimIndex.push({ id: c.id, text: c.text, article_hash: m.article_hash });
            }
        }
        const memberByHash = {};
        for (const m of members) memberByHash[m.article_hash] = { url: m.url, caseId };
        const memberHashes = new Set(members.map((m) => m.article_hash));

        const renderStored = (record) => {
            briefHost.replaceChildren();
            proposalHost.replaceChildren();
            if (!record || !record.brief) return;
            const g = record.grounding || { checked: 0, dropped: 0 };
            const stale = record.inputHash && record.inputHash !== liveHash;
            const prov = el('div', 'xr-synth__prov',
                `${record.model || 'model'} · ${record.promptVersion || CORPUS_PROMPT_VERSION} · `
                + `${g.checked} quote${g.checked === 1 ? '' : 's'} checked, ${g.dropped} dropped · `
                + `${(record.members || members.length)} members`);
            if (stale) {
                const chip = el('span', 'xr-badge xr-badge--warn', 'stale — corpus changed since this brief');
                prov.appendChild(chip);
            }
            briefHost.appendChild(prov);
            briefHost.appendChild(section(record.brief));
            const filtered = filterProposals(record.brief, { claimsById, memberHashes });
            renderProposals(proposalHost, {
                acceptable: filtered.acceptable, rejected: filtered.rejected,
                claimsById, memberByHash, model: record.model,
                onChanged: () => callbacks.onReloadCase && callbacks.onReloadCase()
            });
        };

        const existing = await getCaseBrief(caseId);
        if (existing) renderStored(existing);

        runBtn.addEventListener('click', async () => {
            if (members.length === 0) { status.textContent = 'No archived member articles to analyze.'; return; }
            const approxChars = members.reduce((a, m) => a + m.text.length, 0);
            if (!confirm(`Analyze this corpus with the LLM?\n\n`
                + `This sends ${members.length} member article${members.length === 1 ? '' : 's'} `
                + `(~${Math.round(approxChars / 1000)}k characters) to Anthropic — one call per article, then one synthesis call.`)) return;

            runBtn.disabled = true;
            const caseName = data.case.name || '';
            const scopeQuestion = (dossier.scope && dossier.scope.question) || '';
            const unitById = {};
            for (const m of members) unitById[m.article_hash] = m;

            // MAP — bounded pool over member ids (the audit-module pattern).
            status.textContent = `Analyzing 0/${members.length} articles…`;
            const { modules, failures } = await orchestrateModuleRuns({
                moduleNames: members.map((m) => m.article_hash),
                concurrency: 2,
                onProgress: (p) => {
                    if (p.phase === 'done') status.textContent = `Analyzing ${p.okCount}/${p.total} articles…`;
                },
                send: async (id) => {
                    const u = unitById[id];
                    const res = await sendMessage({ type: 'xray:llm:corpus-map', request: {
                        member_id: id, memberText: u.text,
                        memberMeta: { title: u.title, url: u.url },
                        claimsDigest: u.claims.map((c) => `${c.id} — ${c.text}`).join('\n'),
                        caseName, scopeQuestion
                    } });
                    if (!res || !res.ok) return { ...(res || {}), ok: false };
                    const v = validateCorpusExtract(res.extract);
                    if (!v.ok) return { ok: false, error: 'invalid extract' };
                    return { ok: true, findings: res.extract, model: res.model };
                }
            });

            const extracts = Object.entries(modules).map(([hash, extract]) => ({
                article_hash: hash, title: (unitById[hash] || {}).title || null, extract
            }));
            if (extracts.length === 0) {
                status.textContent = `No articles could be analyzed (${failures.length} failed).`;
                runBtn.disabled = false;
                return;
            }

            // REDUCE — one synthesis call over the extracts + dossier digest.
            status.textContent = `Synthesizing ${extracts.length} extract${extracts.length === 1 ? '' : 's'}…`;
            const reduce = await sendMessage({ type: 'xray:llm:corpus-reduce', request: {
                dossierDigest: digestDossier(dossier, { claims: claimIndex }), extracts, caseName, scopeQuestion
            } });
            if (!reduce || !reduce.ok) {
                status.textContent = `Synthesis failed: ${(reduce && reduce.error) || 'no response'}`;
                runBtn.disabled = false;
                return;
            }
            const v = validateCaseBrief(reduce.briefInput);
            if (!v.ok) {
                status.textContent = 'The synthesis returned a malformed brief.';
                Utils.error('case brief validation', v.errors);
                runBtn.disabled = false;
                return;
            }

            // Ground every quote against the member texts the map used.
            const indexByMember = {};
            for (const m of members) indexByMember[m.article_hash] = createGroundingIndex(m.text);
            const grounded = groundCaseBrief(reduce.briefInput, indexByMember);

            const record = {
                caseId, brief: grounded.brief,
                grounding: { checked: grounded.checked, dropped: grounded.dropped },
                inputHash: liveHash, model: reduce.model, promptVersion: CORPUS_PROMPT_VERSION,
                members: members.length,
                analyzed: extracts.length, failed: failures.length,
                usage: reduce.usage || null
            };
            try { await saveCaseBrief(record); }
            catch (err) { Utils.error('saveCaseBrief failed', err); }

            const coverageNote = failures.length
                ? ` (${extracts.length} of ${members.length} members analyzed; ${failures.length} failed)`
                : '';
            status.textContent = `Done${coverageNote}.`;
            runBtn.disabled = false;
            renderStored(record);
        });
    })().catch((err) => {
        Utils.error('Synthesis block render failed', err);
        block.remove();
    });
}

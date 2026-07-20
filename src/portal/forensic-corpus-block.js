// Forensic corpus block — FA.1 (docs/CORPUS_AUDIT_KICKOFF.md §4b).
// Per-SUBJECT cross-article behavioral analysis on the case dashboard.
// The highest-stakes surface in the product, so the review discipline
// is structural: the COUNTER-READ renders first, the per-subject cap
// is enforced in the firewall, and Accept routes through the existing
// idempotent ForensicModel.create with llm:<model> provenance. Gated
// by `forensicPublishing`'s sibling authoring surfaces' flag pattern:
// llmAssist + key; block absent without the epistemicAuditing-style
// opt-in is deliberately NOT reused — findings are local until the
// separately-flagged publish batch.

import { el } from './dom.js';
import { Utils } from '../shared/utils.js';
import { ForensicModel } from '../shared/forensic-model.js';
import {
    buildSubjectBundle, validateForensicProposals, forensicSubjectRollup,
    MAX_FINDINGS_PER_SUBJECT
} from '../shared/forensic-corpus.js';

function sendMessage(msg) {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage(msg, (resp) => {
                const err = chrome.runtime.lastError;
                if (err) { resolve({ ok: false, error: err.message }); return; }
                resolve(resp);
            });
        } catch (_) { resolve(null); }
    });
}

/**
 * @param {HTMLElement} host
 * @param {object} params
 * @param {object} params.data       collectCaseDossierData output
 * @param {object} params.callbacks  {onReloadCase()}
 */
export function renderForensicCorpusBlock(host, { data, callbacks = {} }) {
    (async () => {
        const cfg = await sendMessage({ type: 'xray:llm:config' }) || {};
        // Subjects: orbit persons/orgs with material in ≥2 members —
        // one source cannot show a cross-source pattern.
        const entities = data.entitiesById || {};
        const subjects = (data.orbit && data.orbit.entities ? data.orbit.entities : Object.values(entities))
            .filter((e) => e && (e.type === 'person' || e.type === 'organization'));
        if (subjects.length === 0) return;

        const block = el('div', 'xr-caudit');
        host.appendChild(block);
        block.appendChild(el('h3', 'xr-case__heading', 'Forensic corpus pass — cross-source maneuvers, per subject'));
        block.appendChild(el('div', 'xr-case__explainer',
            'One analysis per subject over everything this corpus holds about them — the '
            + 'cross-source patterns a per-article pass cannot see. Structure, never intent: no '
            + 'honesty score exists; every anchor quote is machine-checked against stored text; '
            + `every proposal carries its own counter-read (shown first) and you accept at most ${MAX_FINDINGS_PER_SUBJECT} per subject.`));

        // FA.3 — what's already recorded, per subject: maneuver counts
        // and sources touched. Counts are structure; there is no
        // honesty score and never will be (Rule 1).
        try {
            const roll = forensicSubjectRollup({ findings: Object.values(await ForensicModel.getAll()) });
            if (roll.length) {
                block.appendChild(el('div', 'xr-view__dossier-line',
                    'Recorded findings: ' + roll.slice(0, 6).map((s) =>
                        `${s.label} — ${s.total} (${Object.entries(s.byManeuver)
                            .map(([m, n]) => `${m}×${n}`).join(', ')}) across ${s.sources} source${s.sources === 1 ? '' : 's'}`)
                        .join(' · ')));
            }
        } catch (_) { /* rollup is enrichment */ }

        const controls = el('div', 'xr-synth__controls');
        const sel = el('select', 'xr-portal__case');
        for (const s of subjects) sel.appendChild(new Option(`${s.name} (${s.type})`, s.id));
        const runBtn = el('button', 'xr-portal__btn', 'Analyze subject…');
        runBtn.type = 'button';
        if (!cfg.enabled || !cfg.hasKey) {
            runBtn.disabled = true;
            runBtn.title = !cfg.enabled
                ? 'LLM assist is off — enable it in Options → Advanced → LLM assist'
                : 'Set an Anthropic API key in Options → Advanced → LLM assist';
        }
        const status = el('span', 'xr-synth__status');
        controls.appendChild(sel);
        controls.appendChild(runBtn);
        controls.appendChild(status);
        block.appendChild(controls);
        const reviewHost = el('div');
        block.appendChild(reviewHost);

        runBtn.addEventListener('click', async () => {
            const subject = entities[sel.value];
            if (!subject) return;
            runBtn.disabled = true;
            try {
                status.textContent = 'Assembling the evidence bundle…';
                const { bundle, memberTexts, sources, truncated } = buildSubjectBundle({
                    subject,
                    claims: Object.values(data.claimsById || {}),
                    articles: data.articles || []
                });
                if (sources < 2) {
                    status.textContent = `Only ${sources} source${sources === 1 ? '' : 's'} hold${sources === 1 ? 's' : ''} material on ${subject.name} — a cross-source pattern needs at least two.`;
                    return;
                }
                if (!confirm(`Analyze ${subject.name} across ${sources} sources?\n\n`
                    + `This sends the subject's stored claims and mention snippets (~${Math.round(bundle.length / 1000)}k characters) to Anthropic.`
                    + (truncated ? '\nSome sources did not fit the size budget and are excluded.' : '')
                    + '\n\nEvery proposal is reviewed here — counter-read first — before anything is saved.')) {
                    status.textContent = '';
                    return;
                }
                status.textContent = `Analyzing ${subject.name}…`;
                const resp = await sendMessage({ type: 'xray:llm:forensic-corpus', request: { bundle, subjectName: subject.name } });
                if (!resp || !resp.ok) { status.textContent = (resp && resp.error) || 'Pass failed.'; return; }
                const { accepted, rejected } = validateForensicProposals(resp.findings, { memberTexts });
                status.textContent = `${accepted.length} proposal${accepted.length === 1 ? '' : 's'}`
                    + (rejected.length ? ` · ${rejected.length} rejected by the firewall` : '');
                renderReview(reviewHost, { subject, accepted, rejected, model: resp.model, callbacks });
            } catch (err) {
                Utils.error('Forensic corpus pass failed', err);
                status.textContent = `Failed: ${(err && err.message) || 'unknown error'}`;
            } finally {
                runBtn.disabled = false;
            }
        });
    })().catch((err) => Utils.error('Forensic corpus block render failed', err));
}

function renderReview(host, { subject, accepted, rejected, model, callbacks }) {
    host.replaceChildren();
    const wrap = el('div', 'xr-caudit');
    host.appendChild(wrap);
    for (const f of accepted) {
        const row = el('div', 'xr-row');
        // Rule 6 made structural: the innocent reading leads.
        row.appendChild(el('div', 'xr-case__explainer', `Counter-read: ${f.counter_note}`));
        row.appendChild(el('div', 'xr-row__title', `${f.maneuver} · ${f.role} · ${f.basis} — ${f.note || ''}`));
        for (const a of (f.anchors || []).slice(0, 4)) {
            row.appendChild(el('blockquote', 'xr-finding-row__quote', `“${String(a.quote).slice(0, 200)}” — ${a.url}`));
        }
        const act = el('div', 'xr-synth__controls');
        const ok = el('button', 'xr-portal__btn', 'Accept');
        ok.type = 'button';
        ok.addEventListener('click', async () => {
            ok.disabled = true;
            try {
                await ForensicModel.create({
                    subject_ref: {
                        label: subject.name,
                        pubkey: (subject.keypair && subject.keypair.pubkey) || null
                    },
                    role: f.role,
                    maneuver: f.maneuver,
                    basis: f.basis,
                    counter_note: f.counter_note,
                    anchors: (f.anchors || []).map((a) => ({
                        quote: a.quote, source_ref: { url: a.url }
                    })),
                    suggested_by: `llm:${model || 'model'}`
                });
                row.remove();
                if (typeof callbacks.onReloadCase === 'function') callbacks.onReloadCase();
            } catch (err) {
                Utils.error('Finding accept failed', err);
                ok.disabled = false;
            }
        });
        const no = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Reject');
        no.type = 'button';
        no.addEventListener('click', () => row.remove());
        act.appendChild(ok);
        act.appendChild(no);
        row.appendChild(act);
        wrap.appendChild(row);
    }
    if (rejected.length) {
        const det = document.createElement('details');
        const sum = document.createElement('summary');
        sum.textContent = `${rejected.length} rejected by the firewall`;
        det.appendChild(sum);
        for (const r of rejected) det.appendChild(el('div', 'xr-inspector__mono', `${(r.finding && r.finding.maneuver) || '?'}: ${r.reason}`));
        wrap.appendChild(det);
    }
    if (accepted.length === 0 && rejected.length === 0) {
        wrap.appendChild(el('div', 'xr-view__empty', 'No proposals — the model found no defensible cross-source pattern.'));
    }
}

// LLM-assist review panel — Phase 14.5.3
// (docs/PHASE_14_5_LLM_ASSIST_KICKOFF.md).
//
// The human-in-the-loop surface. It takes the raw proposals from a
// `xray:llm:suggest` pass, groups + validates them (llm-proposals), and
// renders a modal grouped by artifact type. For each proposal the user
// can Accept / Edit / Reject:
//
//   - Accept funnels the proposal through the EXISTING capture model
//     (EntityModel / ClaimModel / AssessmentModel / EvidenceLinker /
//     ForensicModel / ForensicBaseline) with provenance
//     `suggested_by: 'llm:<model>'`. The model's create() is the real
//     validation firewall.
//   - Edit toggles a compact inline form over the proposal's editable
//     fields — including the claim quote and finding evidence quotes,
//     so an unlocatable quote can be re-anchored in place. Applying a
//     content edit flips that proposal's provenance to 'user' (honest
//     record-keeping); a quote-only edit keeps 'llm:<model>' — the
//     assertion is still the model's, and the anchor is machine-
//     verified against the article either way.
//   - Reject discards it.
//
// Provenance is grounded (Phase 14.5 hardening): ONE grounding index is
// built over the article text, every quote a proposal stakes provenance
// on is located through it (exact → typography-normalized → guarded
// fuzzy), each row shows how its quotes grounded, and displayed/stored
// quote text is the ARTICLE'S OWN span — the model's rendition is only
// a search key. A claim or finding whose quote cannot be located is
// invalid (rejected-with-reason) until re-anchored.
//
// Nothing here saves without an explicit Accept, and nothing publishes —
// publishing stays behind assessmentPublishing / forensicPublishing.
// Invalid proposals render "rejected-with-reason" and cannot be accepted
// until fixed.

import { EntityModel } from '../shared/entity-model.js';
import { ClaimModel } from '../shared/claim-model.js';
import { AssessmentModel } from '../shared/assessment-model.js';
import { EvidenceLinker } from '../shared/evidence-linker.js';
import { ForensicModel, ForensicBaseline } from '../shared/forensic-model.js';
import { ENTITY_TYPES } from '../shared/entity-model.js';
import { STANCE_VALUES, STANCE_LABELS, CLAIM_RELATIONSHIPS, REVISION_RELATIONSHIPS } from '../shared/assessment-taxonomy.js';
import { ROLES, BASIS_VALUES } from '../shared/forensic-taxonomy.js';
import {
    normalizeProposals, validateProposal, subjectLabelOf, PROPOSAL_ORDER,
    buildEntityInput, buildClaimInput, buildAssessmentInput, buildLinkInput,
    buildFindingInput, buildBaselineInput
} from '../shared/llm-proposals.js';
import { createGroundingIndex } from '../shared/quote-grounding.js';

const KIND_TITLES = {
    entity: 'Entities', claim: 'Claims', assessment: 'Assessments',
    relationship: 'Relationships', revision: 'Revisions',
    finding: 'Findings', baseline: 'Baselines'
};

// Compact, data-driven inline editor — the editable fields per kind.
// Quotes are editable in place (claims' quote, findings' anchor
// quotes) so an unlocatable quote can be re-anchored without
// rejecting the whole proposal; labels stay as proposed (the full
// pickers live in the capture modals).
const EDIT_FIELDS = {
    entity: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'entity_type', label: 'Type', type: 'select', options: ENTITY_TYPES }
    ],
    claim: [
        { key: 'text', label: 'Claim text', type: 'textarea' },
        { key: 'quote', label: 'Verbatim quote (checked against the article)', type: 'textarea' },
        { key: 'is_key', label: 'Key claim', type: 'checkbox' }
    ],
    assessment: [
        { key: 'stance', label: 'Stance', type: 'stance' },
        { key: 'rationale', label: 'Rationale', type: 'textarea' }
    ],
    relationship: [
        { key: 'relationship', label: 'Relationship', type: 'select', options: CLAIM_RELATIONSHIPS },
        { key: 'note', label: 'Note', type: 'text' }
    ],
    revision: [
        { key: 'relationship', label: 'Revision', type: 'select', options: REVISION_RELATIONSHIPS },
        { key: 'note', label: 'Note', type: 'text' }
    ],
    finding: [
        { key: 'role', label: 'Role', type: 'select', options: ROLES },
        { key: 'maneuver', label: 'Maneuver', type: 'text' },
        { key: 'basis', label: 'Basis', type: 'select', options: BASIS_VALUES },
        { key: 'anchors', label: 'Evidence quotes (checked against the article)', type: 'anchors' },
        { key: 'note', label: 'Note', type: 'textarea' },
        { key: 'counter_note', label: 'Counter-read (required)', type: 'textarea' }
    ],
    baseline: [
        { key: 'subject_label', label: 'Subject', type: 'text' },
        { key: 'note', label: 'Note', type: 'textarea' }
    ]
};

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function truncate(s, n) {
    const str = String(s || '');
    return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

/**
 * Open the review modal.
 *
 * @param {object} opts
 * @param {Array<object>} opts.proposals  raw proposals from the SW pass
 * @param {string} opts.model             the model id used (for provenance)
 * @param {string} opts.articleText       body text, for quote→anchor resolution
 * @param {string} opts.sourceUrl
 * @param {object} [opts.sourceRef]        { url, title }
 * @param {function} [opts.onAccepted]     called after each accept (refresh bars)
 * @returns {Promise<{accepted: number}>}
 */
export function openLlmReview(opts) {
    const { proposals, model, articleText = '', sourceUrl = '', sourceRef = {}, onAccepted } = opts;
    const suggestedByLlm = `llm:${model}`;
    const norm = normalizeProposals(proposals);
    // ONE grounding index for the whole panel — validation, badges, and
    // the accept-time builders all locate quotes through it (memoized).
    const grounding = createGroundingIndex(articleText);
    const ctx = { claimRefs: norm.claimRefs, entityRefs: norm.entityRefs, entityLabelByRef: norm.entityLabelByRef, grounding };

    // Nice summaries: claim text by ref.
    const claimTextByRef = {};
    for (const c of norm.byKind.claim) if (c.ref) claimTextByRef[c.ref] = c.text;

    // Accept-time maps, filled as the user accepts in dependency order.
    const entityIdByRef = {};
    const claimIdByRef = {};

    // One mutable row per proposal.
    const rows = norm.all.map((p) => ({
        pid: p.pid, kind: p.kind, ref: p.ref,
        prop: { ...p },
        status: 'pending',         // pending | accepted | rejected
        suggestedBy: suggestedByLlm,
        editing: false,
        message: ''
    }));
    const rowByPid = new Map(rows.map((r) => [r.pid, r]));

    return new Promise((resolve) => {
        const host = document.createElement('div');
        host.className = 'xr-llm';
        document.body.appendChild(host);
        let acceptedCount = 0;

        const close = () => {
            document.removeEventListener('keydown', onKey);
            if (host.parentNode) host.parentNode.removeChild(host);
            resolve({ accepted: acceptedCount });
        };
        const onKey = (ev) => { if (ev.key === 'Escape') close(); };
        document.addEventListener('keydown', onKey);

        function validityOf(row) {
            return validateProposal(row.prop, ctx);
        }

        // How a quote grounded, as a chip. The displayed/stored text is
        // the article's own span; the model's rendition survives only
        // as the chip tooltip when it was repaired.
        function anchorChip(g) {
            if (!g || g.status === 'missing') {
                return `<span class="xr-llm__anchor xr-llm__anchor--bad" title="This text could not be located in the article — edit the quote to match it exactly">⚓ not found in article</span>`;
            }
            if (g.status === 'exact') {
                return `<span class="xr-llm__anchor xr-llm__anchor--ok" title="Found in the article verbatim">⚓ verbatim</span>`;
            }
            if (g.status === 'normalized') {
                return `<span class="xr-llm__anchor xr-llm__anchor--ok" title="Found after normalizing punctuation/whitespace — the anchor stores the article's own text">⚓ verbatim (typography normalized)</span>`;
            }
            return `<span class="xr-llm__anchor xr-llm__anchor--warn" title="Close match (${Math.round(g.score * 100)}%) — the anchor stores the article's own text; check it says what the item needs">⚓ close match ${Math.round(g.score * 100)}%</span>`;
        }

        // Grounded quote display: the article's span when located, the
        // model's text (flagged by the chip) when not.
        function quoteHtml(quote, { max = 140 } = {}) {
            const q = String(quote || '').trim();
            if (!q) return '';
            const g = grounding.ground(q);
            const shown = g.status === 'missing' ? q : g.exact;
            const repaired = g.status !== 'missing' && g.status !== 'exact' && g.exact !== q;
            const tip = repaired ? ` title="Model wrote: ${escapeHtml(truncate(q, 300))}"` : '';
            return `<blockquote class="xr-llm__quote"${tip}>${escapeHtml(truncate(shown, max))}</blockquote>${anchorChip(g)}`;
        }

        function summarize(row) {
            const p = row.prop;
            switch (row.kind) {
                case 'entity':
                    return `${escapeHtml(p.name || '(unnamed)')} <span class="xr-llm__dim">· ${escapeHtml(p.entity_type || '?')}</span>`;
                case 'claim': {
                    const about = (p.about || []).map((r) => norm.entityLabelByRef[r]).filter(Boolean);
                    const star = p.is_key ? '⭐ ' : '';
                    const ab = about.length ? ` <span class="xr-llm__dim">about ${escapeHtml(about.join(', '))}</span>` : '';
                    return `${star}${escapeHtml(truncate(p.text, 160))}${ab}${quoteHtml(p.quote)}`;
                }
                case 'assessment': {
                    const st = (p.stance === null || p.stance === undefined) ? '' : `stance: ${escapeHtml(STANCE_LABELS[String(p.stance)] || String(p.stance))}`;
                    const labels = (p.labels || []).map((l) => l.label).filter(Boolean);
                    const lb = labels.length ? `labels: ${escapeHtml(labels.join(', '))}` : '';
                    // Label quotes are optional anchors: an unlocatable one
                    // is saved WITHOUT an anchor (never fabricated) — say so.
                    const lost = (p.labels || []).filter((l) => l && String(l.quote || '').trim()
                        && grounding.ground(String(l.quote).trim()).status === 'missing').length;
                    const warn = lost ? `<br><small class="xr-llm__anchor xr-llm__anchor--warn">⚓ ${lost} label quote${lost > 1 ? 's' : ''} not found — those labels save without an anchor</small>` : '';
                    return `<span class="xr-llm__dim">on</span> ${escapeHtml(truncate(claimTextByRef[p.claim_ref] || p.claim_ref, 90))}<br><small>${[st, lb].filter(Boolean).join(' · ')}</small>${warn}`;
                }
                case 'relationship':
                case 'revision':
                    return `${escapeHtml(truncate(claimTextByRef[p.source_claim_ref] || p.source_claim_ref, 60))} <strong>${escapeHtml(p.relationship)}</strong> ${escapeHtml(truncate(claimTextByRef[p.target_claim_ref] || p.target_claim_ref, 60))}`;
                case 'finding': {
                    const anchors = (p.anchors || []).filter((a) => a && String(a.quote || '').trim());
                    const quotes = anchors.map((a) => quoteHtml(a.quote)).join('');
                    return `<strong>${escapeHtml(subjectLabelOf(p, ctx) || '(subject)')}</strong> — <span class="xr-llm__man">${escapeHtml(p.maneuver || '?')}</span> <span class="xr-llm__dim">(${escapeHtml(p.role || '?')}, ${escapeHtml(p.basis || '?')})</span>${quotes}<small class="xr-llm__counter">↔ ${escapeHtml(truncate(p.counter_note || '(no counter-read)', 140))}</small>`;
                }
                case 'baseline':
                    return `<strong>${escapeHtml(subjectLabelOf(p, ctx) || '(subject)')}</strong> — ${escapeHtml(truncate(p.note, 160))}`;
                default:
                    return escapeHtml(row.kind);
            }
        }

        function editorHtml(row) {
            const fields = EDIT_FIELDS[row.kind] || [];
            const p = row.prop;
            const inputs = fields.map((f) => {
                const id = `${row.pid}__${f.key}`;
                if (f.type === 'textarea') {
                    return `<label class="xr-llm__f"><span>${escapeHtml(f.label)}</span><textarea data-k="${f.key}" rows="2">${escapeHtml(p[f.key] || '')}</textarea></label>`;
                }
                if (f.type === 'checkbox') {
                    return `<label class="xr-llm__f xr-llm__f--inline"><input type="checkbox" data-k="${f.key}" ${p[f.key] ? 'checked' : ''}/><span>${escapeHtml(f.label)}</span></label>`;
                }
                if (f.type === 'select') {
                    const opts = f.options.map((o) => `<option value="${escapeHtml(o)}" ${p[f.key] === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('');
                    return `<label class="xr-llm__f"><span>${escapeHtml(f.label)}</span><select data-k="${f.key}">${opts}</select></label>`;
                }
                if (f.type === 'stance') {
                    const cur = (p.stance === undefined ? null : p.stance);
                    const opts = [`<option value="" ${cur === null ? 'selected' : ''}>(no stance)</option>`]
                        .concat(STANCE_VALUES.map((v) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${escapeHtml(STANCE_LABELS[String(v)])}</option>`)).join('');
                    return `<label class="xr-llm__f"><span>${escapeHtml(f.label)}</span><select data-k="stance">${opts}</select></label>`;
                }
                if (f.type === 'anchors') {
                    const anchors = Array.isArray(p.anchors) ? p.anchors : [];
                    if (anchors.length === 0) return '';
                    const areas = anchors.map((a, i) =>
                        `<textarea data-k="anchor-quote" data-i="${i}" rows="2">${escapeHtml((a && a.quote) || '')}</textarea>`
                    ).join('');
                    return `<label class="xr-llm__f"><span>${escapeHtml(f.label)}</span>${areas}</label>`;
                }
                // text
                return `<label class="xr-llm__f"><span>${escapeHtml(f.label)}</span><input type="text" data-k="${f.key}" value="${escapeHtml(p[f.key] || '')}"/></label>`;
            }).join('');
            return `<div class="xr-llm__editor">${inputs}
                <div class="xr-llm__editor-actions">
                  <button type="button" class="xr-llm__btn" data-act="edit-cancel">Cancel</button>
                  <button type="button" class="xr-llm__btn xr-llm__btn--primary" data-act="edit-apply">Apply edits</button>
                </div></div>`;
        }

        function rowHtml(row) {
            const v = validityOf(row);
            let badge = '';
            if (row.status === 'accepted') badge = `<span class="xr-llm__badge xr-llm__badge--ok">✓ accepted</span>`;
            else if (row.status === 'rejected') badge = `<span class="xr-llm__badge xr-llm__badge--rej">✕ rejected</span>`;
            else if (!v.ok) badge = `<span class="xr-llm__badge xr-llm__badge--bad" title="${escapeHtml(v.reason)}">✗ ${escapeHtml(v.reason)}</span>`;
            else if (row.suggestedBy === 'user') badge = `<span class="xr-llm__badge xr-llm__badge--edit">✎ edited (you)</span>`;

            const actions = (row.status === 'pending') ? `
                <div class="xr-llm__row-actions">
                  <button type="button" class="xr-llm__btn xr-llm__btn--primary" data-act="accept" ${v.ok ? '' : 'disabled'}>Accept</button>
                  <button type="button" class="xr-llm__btn" data-act="edit">Edit</button>
                  <button type="button" class="xr-llm__btn xr-llm__btn--ghost" data-act="reject">Reject</button>
                </div>` : '';

            return `<div class="xr-llm__row xr-llm__row--${row.status}" data-pid="${row.pid}">
                <div class="xr-llm__row-main">
                  <div class="xr-llm__summary">${summarize(row)}</div>
                  ${badge}
                  ${row.message ? `<div class="xr-llm__msg${row.messageKind === 'info' ? ' xr-llm__msg--info' : ''}">${escapeHtml(row.message)}</div>` : ''}
                  ${row.editing ? editorHtml(row) : ''}
                </div>
                ${actions}
              </div>`;
        }

        function sectionsHtml() {
            const parts = [];
            for (const kind of PROPOSAL_ORDER) {
                const list = rows.filter((r) => r.kind === kind);
                if (list.length === 0) continue;
                const pending = list.filter((r) => r.status === 'pending').length;
                parts.push(`<section class="xr-llm__section">
                    <h3 class="xr-llm__section-title">${escapeHtml(KIND_TITLES[kind] || kind)} <span class="xr-llm__dim">(${list.length})</span></h3>
                    ${list.map(rowHtml).join('')}
                  </section>`);
            }
            return parts.join('') || `<p class="xr-llm__empty">The model returned no proposals for this article.</p>`;
        }

        function render() {
            const total = rows.length;
            const acc = rows.filter((r) => r.status === 'accepted').length;
            const pendingValid = rows.filter((r) => r.status === 'pending' && validityOf(r).ok).length;
            host.innerHTML = `
              <div class="xr-llm__backdrop"></div>
              <div class="xr-llm__card" role="dialog" aria-label="LLM suggestions">
                <header class="xr-llm__head">
                  <h2 class="xr-llm__title">✨ Suggestions <span class="xr-llm__dim">(${total})</span></h2>
                  <span class="xr-llm__model" title="Model used">${escapeHtml(model)}</span>
                  <span class="xr-llm__gap"></span>
                  <button type="button" class="xr-llm__close" aria-label="Close">✕</button>
                </header>
                <p class="xr-llm__disclosure">These are <strong>drafts</strong> — nothing is saved until you Accept, and nothing is published. Every quote is checked against the article text (⚓): stored anchors carry the article's own words, and an item whose quote can't be located must be re-anchored (Edit) or rejected. Accepted items appear in the claims / findings bars, tagged <code>suggested_by: ${escapeHtml(suggestedByLlm)}</code>.</p>
                <div class="xr-llm__body">${sectionsHtml()}</div>
                <footer class="xr-llm__foot">
                  <span class="xr-llm__status">${acc} accepted</span>
                  <span class="xr-llm__gap"></span>
                  <button type="button" class="xr-llm__btn" data-act="accept-all" ${pendingValid ? '' : 'disabled'}>Accept all valid (${pendingValid})</button>
                  <button type="button" class="xr-llm__btn xr-llm__btn--primary" data-act="done">Done</button>
                </footer>
              </div>`;
            wire();
        }

        function wire() {
            host.querySelector('.xr-llm__close').addEventListener('click', close);
            host.querySelector('.xr-llm__backdrop').addEventListener('click', close);
            host.querySelector('[data-act="done"]').addEventListener('click', close);
            host.querySelector('[data-act="accept-all"]').addEventListener('click', acceptAllValid);

            host.querySelectorAll('.xr-llm__row').forEach((el) => {
                const row = rowByPid.get(el.dataset.pid);
                if (!row) return;
                const on = (act, fn) => { const b = el.querySelector(`[data-act="${act}"]`); if (b) b.addEventListener('click', fn); };
                on('accept', () => acceptRow(row));
                on('reject', () => { row.status = 'rejected'; render(); });
                on('edit', () => { row.editing = true; render(); });
                on('edit-cancel', () => { row.editing = false; row.message = ''; render(); });
                on('edit-apply', () => applyEdit(row, el));
            });
        }

        function applyEdit(row, el) {
            const fields = EDIT_FIELDS[row.kind] || [];
            const changed = new Set();
            for (const f of fields) {
                if (f.type === 'anchors') {
                    el.querySelectorAll('[data-k="anchor-quote"]').forEach((ta) => {
                        const i = Number(ta.dataset.i);
                        const a = Array.isArray(row.prop.anchors) ? row.prop.anchors[i] : null;
                        if (!a || String(a.quote || '') === ta.value) return;
                        a.quote = ta.value;
                        changed.add('anchors');
                    });
                    continue;
                }
                const input = el.querySelector(`[data-k="${f.key === 'stance' ? 'stance' : f.key}"]`);
                if (!input) continue;
                if (f.type === 'checkbox') {
                    const next = input.checked;
                    if ((row.prop[f.key] === true) !== next) { row.prop[f.key] = next; changed.add(f.key); }
                } else if (f.type === 'stance') {
                    const next = input.value === '' ? null : Number(input.value);
                    const cur = row.prop.stance === undefined ? null : row.prop.stance;
                    if (cur !== next) { row.prop.stance = next; changed.add('stance'); }
                } else {
                    if (String(row.prop[f.key] ?? '') !== input.value) { row.prop[f.key] = input.value; changed.add(f.key); }
                }
            }
            // Provenance honesty: a substantive (content) edit makes the
            // artifact the user's. A quote-only edit does NOT — the
            // assertion is still the model's; the quote is just being
            // re-anchored, and it is machine-verified either way.
            const quoteOnly = changed.size > 0
                && [...changed].every((k) => k === 'quote' || k === 'anchors');
            if (changed.size > 0 && !quoteOnly) row.suggestedBy = 'user';
            row.editing = false;
            row.message = quoteOnly ? 'Quote re-checked against the article.' : '';
            row.messageKind = quoteOnly ? 'info' : '';
            render();
        }

        // Accept gating: an item can only be created once the items it
        // references have been accepted (their ids are in the maps).
        function blockedReason(row) {
            const p = row.prop;
            if (row.kind === 'assessment' && !claimIdByRef[p.claim_ref]) return 'Accept its claim first.';
            if ((row.kind === 'relationship' || row.kind === 'revision')
                && (!claimIdByRef[p.source_claim_ref] || !claimIdByRef[p.target_claim_ref])) {
                return 'Accept both linked claims first.';
            }
            return '';
        }

        async function acceptRow(row) {
            if (row.status !== 'pending') return;
            const v = validityOf(row);
            if (!v.ok) { row.message = v.reason; render(); return; }
            const blocked = blockedReason(row);
            if (blocked) { row.message = blocked; render(); return; }
            try {
                await createFor(row);
                row.status = 'accepted';
                row.message = '';
                acceptedCount += 1;
                if (typeof onAccepted === 'function') { try { await onAccepted(row.kind); } catch (_) { /* refresh best-effort */ } }
            } catch (err) {
                // The model is the ultimate firewall — surface its reason.
                row.message = (err && err.message) || String(err);
            }
            render();
        }

        async function acceptAllValid() {
            // Dependency order so refs resolve as we go.
            for (const kind of PROPOSAL_ORDER) {
                for (const row of rows.filter((r) => r.kind === kind && r.status === 'pending')) {
                    if (!validityOf(row).ok) continue;
                    if (blockedReason(row)) continue;
                    try {
                        await createFor(row);
                        row.status = 'accepted';
                        row.message = '';
                        acceptedCount += 1;
                    } catch (err) {
                        row.message = (err && err.message) || String(err);
                    }
                }
            }
            if (typeof onAccepted === 'function') { try { await onAccepted('all'); } catch (_) { /* best-effort */ } }
            render();
        }

        // Funnel one accepted proposal through the real model.
        async function createFor(row) {
            const p = row.prop;
            const sb = row.suggestedBy;
            switch (row.kind) {
                case 'entity': {
                    const e = await EntityModel.create(buildEntityInput(p, { suggestedBy: sb }));
                    if (row.ref) entityIdByRef[row.ref] = e.id;
                    return;
                }
                case 'claim': {
                    // The builders duck-type the grounding index in the
                    // articleText slot — same text, memoized lookups.
                    const c = await ClaimModel.create(buildClaimInput(p, { entityIdByRef, articleText: grounding, sourceUrl, suggestedBy: sb }));
                    if (row.ref) claimIdByRef[row.ref] = c.id;
                    return;
                }
                case 'assessment':
                    await AssessmentModel.create(buildAssessmentInput(p, { claimIdByRef, articleText: grounding, suggestedBy: sb }));
                    return;
                case 'relationship':
                case 'revision':
                    await EvidenceLinker.create(buildLinkInput(p, { claimIdByRef, suggestedBy: sb }));
                    return;
                case 'finding':
                    await ForensicModel.create(buildFindingInput(p, {
                        articleText: grounding, sourceRef, suggestedBy: sb, subjectLabel: subjectLabelOf(p, ctx)
                    }));
                    return;
                case 'baseline':
                    await ForensicBaseline.create(buildBaselineInput(p, { sourceRef, subjectLabel: subjectLabelOf(p, ctx) }));
                    return;
                default:
                    throw new Error(`Unknown kind: ${row.kind}`);
            }
        }

        render();
    });
}

// Reader findings section — Phase 14.2 (docs/CRIMINOLOGY_DESIGN.md).
//
// Renders the per-article "Forensic findings" bar beneath the claims
// bar: a header with the capture affordances (+ Finding / Set baseline)
// and one row per finding (subject + maneuver badges + the lead quote).
// Pure HTML string, like renderClaimsBar; index.js owns the wiring.

import { renderFindingBadges } from '../shared/forensic-modal.js';

/**
 * @param {Array<object>} findings  findings whose evidence is on this article
 * @param {Array<object>} baselines baselines recorded against this article's
 *                                  URL (27 F.4 — previously write-only)
 * @returns {string} HTML
 */
export function renderFindingsBar(findings, baselines = []) {
    const list = Array.isArray(findings) ? findings : [];
    const bases = Array.isArray(baselines) ? baselines : [];
    const baseById = new Map(bases.map((b) => [b.id, b]));
    const header = `
      <div class="xr-findings__head">
        <span class="xr-findings__title">Forensic findings${list.length ? ` (${list.length})` : ''}</span>
        <span class="xr-findings__gap"></span>
        <button type="button" class="xr-findings__btn" id="xr-findings-baseline" title="Record a subject's baseline register">Set baseline…</button>
        <button type="button" class="xr-findings__btn xr-findings__btn--primary" id="xr-findings-add" title="Name a maneuver for the selected span">+ Finding</button>
      </div>`;

    // Baselines on this source — descriptive register, never a score.
    // Re-running "Set baseline…" for the same subject updates in place.
    const baselineRows = bases.length === 0 ? '' : `
      <div class="xr-findings__baselines">
        ${bases.map((b) => `
          <div class="xr-findings__baseline" data-id="${escapeHtml(b.id)}">
            <span class="xr-findings__baseline-tag">baseline</span>
            <span class="xr-findings__subject">${escapeHtml((b.subject_ref && b.subject_ref.label) || '(subject)')}</span>
            <span class="xr-findings__baseline-note">${escapeHtml(truncate(b.note || '', 140))}</span>
            <button type="button" class="xr-findings__row-btn" data-action="baseline-delete" title="Remove baseline">🗑</button>
          </div>`).join('')}
      </div>`;

    if (list.length === 0) {
        return `<div class="xr-findings">${header}${baselineRows}
          <div class="xr-findings__empty">Select a span in the article, then <strong>+ Finding</strong> to name a maneuver and bind it to evidence. No verdicts — structure only, with a required counter-read.</div>
        </div>`;
    }

    const rows = list.map((f) => {
        const lead = (f.anchors && f.anchors[0] && f.anchors[0].quote) || '';
        const subject = (f.subject_ref && f.subject_ref.label) || '(subject)';
        const base = f.baseline_ref ? baseById.get(f.baseline_ref) : null;
        const baselineChip = f.baseline_ref
            ? `<span class="xr-findings__baseline-chip" title="${escapeHtml(base ? `Baseline: ${base.note}` : 'Deviates from a recorded baseline (context — not a weight)')}">deviates from baseline</span>`
            : '';
        return `
          <div class="xr-findings__item" data-id="${escapeHtml(f.id)}">
            <div class="xr-findings__item-main">
              <span class="xr-findings__subject">${escapeHtml(subject)}</span>
              ${renderFindingBadges(f)}${baselineChip}
              ${lead ? `<blockquote class="xr-findings__quote">${escapeHtml(truncate(lead, 160))}</blockquote>` : ''}
            </div>
            <div class="xr-findings__item-actions">
              <button type="button" class="xr-findings__row-btn" data-action="edit" title="Edit finding">✎</button>
              <button type="button" class="xr-findings__row-btn" data-action="delete" title="Delete finding">🗑</button>
            </div>
          </div>`;
    }).join('');

    return `<div class="xr-findings">${header}${baselineRows}<div class="xr-findings__list">${rows}</div></div>`;
}

function truncate(s, n) {
    const str = String(s || '');
    return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

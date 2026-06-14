// Reader findings section — Phase 13.2 (docs/CRIMINOLOGY_DESIGN.md).
//
// Renders the per-article "Forensic findings" bar beneath the claims
// bar: a header with the capture affordances (+ Finding / Set baseline)
// and one row per finding (subject + maneuver badges + the lead quote).
// Pure HTML string, like renderClaimsBar; index.js owns the wiring.

import { renderFindingBadges } from '../shared/forensic-modal.js';

/**
 * @param {Array<object>} findings  findings whose evidence is on this article
 * @returns {string} HTML
 */
export function renderFindingsBar(findings) {
    const list = Array.isArray(findings) ? findings : [];
    const header = `
      <div class="xr-findings__head">
        <span class="xr-findings__title">Forensic findings${list.length ? ` (${list.length})` : ''}</span>
        <span class="xr-findings__gap"></span>
        <button type="button" class="xr-findings__btn" id="xr-findings-baseline" title="Record a subject's baseline register">Set baseline…</button>
        <button type="button" class="xr-findings__btn xr-findings__btn--primary" id="xr-findings-add" title="Name a maneuver for the selected span">+ Finding</button>
      </div>`;

    if (list.length === 0) {
        return `<div class="xr-findings">${header}
          <div class="xr-findings__empty">Select a span in the article, then <strong>+ Finding</strong> to name a maneuver and bind it to evidence. No verdicts — structure only, with a required counter-read.</div>
        </div>`;
    }

    const rows = list.map((f) => {
        const lead = (f.anchors && f.anchors[0] && f.anchors[0].quote) || '';
        const subject = (f.subject_ref && f.subject_ref.label) || '(subject)';
        return `
          <div class="xr-findings__item" data-id="${escapeHtml(f.id)}">
            <div class="xr-findings__item-main">
              <span class="xr-findings__subject">${escapeHtml(subject)}</span>
              ${renderFindingBadges(f)}
              ${lead ? `<blockquote class="xr-findings__quote">${escapeHtml(truncate(lead, 160))}</blockquote>` : ''}
            </div>
            <div class="xr-findings__item-actions">
              <button type="button" class="xr-findings__row-btn" data-action="edit" title="Edit finding">✎</button>
              <button type="button" class="xr-findings__row-btn" data-action="delete" title="Delete finding">🗑</button>
            </div>
          </div>`;
    }).join('');

    return `<div class="xr-findings">${header}<div class="xr-findings__list">${rows}</div></div>`;
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

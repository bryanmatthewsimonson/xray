// Assess modal — Phase 11.3 (docs/ASSESSMENTS_DESIGN.md).
//
// The judgment-capture UI for one claim: five stance chips (-2..+2),
// a label picker grouped by taxonomy category (+ a custom-label input
// that normalizes rather than rejects), a per-label note and optional
// span anchor, and a free-text rationale. Saving goes through
// AssessmentModel (create or update — the modal looks up any existing
// assessment for the claim itself).
//
// UI-in-shared exception: unlike the rest of src/shared/ this module
// renders DOM, because it is the one judgment surface used by BOTH
// extension pages (the reader's claims bar / others'-claims modal and
// the side panel's network rows). It injects its own <style> element
// (xr-assess-* classes only) so neither surface's stylesheet needs to
// carry — or drift from — the modal styles. It must NOT be imported
// by the content script.
//
// Span anchoring is capability-gated: pass `anchorContext.container`
// (the reader's article body element) to enable the per-label
// "mark span" flow — the modal minimizes to a floating pill, the user
// selects the offending passage, and `captureFromRange` builds the
// selector array (the 10.3 mechanism; a modal with a backdrop has no
// live selection, hence the minimize step). The side panel has no
// article DOM and passes null.

import { AssessmentModel } from './assessment-model.js';
import { makeClaimRefCanonicalizer } from './claim-ref.js';
import { captureFromRange } from './metadata/anchor-capture.js';
import {
    ASSESSMENT_LABEL_GROUPS, isStandardLabel, isValidLabel,
    STANCE_VALUES, STANCE_LABELS
} from './assessment-taxonomy.js';

// ------------------------------------------------------------------
// Shared rendering helpers (claims bar / others' modal / side panel)
// ------------------------------------------------------------------

const STANCE_ICONS = {
    '-2': '👎👎', '-1': '👎', '0': '🤔', '1': '👍', '2': '👍👍'
};

/**
 * Compact badge strip for an assessment: stance chip + label pills.
 * Returns '' for null. Pure HTML string; callers drop it into any
 * claim row (styles ride the injected sheet).
 */
export function renderAssessmentBadges(assessment) {
    if (!assessment) return '';
    ensureStyles();
    const bits = [];
    if (assessment.stance !== null && assessment.stance !== undefined) {
        const key = String(assessment.stance);
        bits.push(`<span class="xr-assess-badge xr-assess-badge--stance" title="Your stance">${STANCE_ICONS[key] || ''} ${escapeHtml(STANCE_LABELS[key] || key)}</span>`);
    }
    for (const l of assessment.labels || []) {
        const custom = isStandardLabel(l.label) ? '' : ' xr-assess-badge--custom';
        const anchored = l.anchor ? ' 📍' : '';
        const note = l.note ? ` — ${l.note}` : '';
        bits.push(`<span class="xr-assess-badge xr-assess-badge--label${custom}" title="${escapeHtml(l.label + note)}">${escapeHtml(l.label)}${anchored}</span>`);
    }
    return bits.length ? `<div class="xr-assess-badges">${bits.join('')}</div>` : '';
}

/**
 * Build the canonical-keyed assessment lookup used by every surface
 * that overlays badges: Map<canonicalRef, assessment>.
 */
export async function assessmentsByCanonicalRef() {
    const [all, canon] = await Promise.all([
        AssessmentModel.getAll(),
        makeClaimRefCanonicalizer()
    ]);
    const map = new Map();
    for (const a of Object.values(all)) {
        const ref = a.claim_ref && (a.claim_ref.claim_id || a.claim_ref.coord);
        if (ref) map.set(canon(ref), a);
    }
    return map;
}

// ------------------------------------------------------------------
// The modal
// ------------------------------------------------------------------

/**
 * Open the assess modal for one claim. Looks up any existing
 * assessment itself (by either ref representation).
 *
 * @param {{
 *   claimRef: { claim_id?: string, coord?: string, url?: string,
 *               text?: string, event_id?: string },
 *   claimText?: string,            // display fallback when ref has no text
 *   anchorContext?: { container: Element } | null
 * }} opts
 * @returns {Promise<object | {deleted: true} | null>} the saved record,
 *   a deletion marker, or null on cancel.
 */
export async function openAssessModal({ claimRef, claimText = '', anchorContext = null }) {
    ensureStyles();
    const refValue = claimRef.claim_id || claimRef.coord;
    const existing = await AssessmentModel.getByClaimRef(refValue);

    // Working state, seeded from the existing record.
    const state = {
        stance: existing ? existing.stance : null,
        labels: new Map((existing ? existing.labels : []).map((l) => [l.label, {
            note: l.note || '', anchor: l.anchor || null, suggested_by: l.suggested_by || 'user'
        }])),
        rationale: existing ? existing.rationale : ''
    };
    const displayText = claimText || (claimRef.text || '') || (existing && existing.claim_ref.text) || '';

    return new Promise((resolve) => {
        const host = document.createElement('div');
        host.className = 'xr-assess';
        host.innerHTML = buildHtml(displayText, state, !!existing, !!(anchorContext && anchorContext.container));
        document.body.appendChild(host);

        const $ = (sel) => host.querySelector(sel);
        const card = $('.xr-assess__card');
        const pill = $('.xr-assess__pill');

        let markingLabel = null;       // label currently in "mark span" mode
        let markedRange = null;        // last cloned non-collapsed selection

        const close = (result) => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('mouseup', onMouseUp);
            if (host.parentNode) host.parentNode.removeChild(host);
            resolve(result);
        };

        const onKey = (ev) => {
            if (ev.key !== 'Escape') return;
            if (markingLabel) { exitMarkMode(); return; }
            close(null);
        };

        // While minimized, remember the latest selection inside the
        // article container (cloned — button clicks clear live selections).
        const onMouseUp = () => {
            if (!markingLabel || !anchorContext) return;
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return;
            const range = sel.getRangeAt(0);
            if (range.collapsed) return;
            if (!anchorContext.container.contains(range.commonAncestorContainer)) return;
            markedRange = range.cloneRange();
            pill.querySelector('[data-action="mark-done"]').disabled = false;
        };

        function enterMarkMode(label) {
            markingLabel = label;
            markedRange = null;
            host.classList.add('xr-assess--marking');
            pill.querySelector('.xr-assess__pill-label').textContent = label;
            pill.querySelector('[data-action="mark-done"]').disabled = true;
        }

        function exitMarkMode(save = false) {
            if (save && markedRange && markingLabel) {
                const captured = captureFromRange(markedRange, anchorContext.container);
                const entry = state.labels.get(markingLabel);
                if (captured && entry) entry.anchor = captured.selectors;
            }
            markingLabel = null;
            markedRange = null;
            host.classList.remove('xr-assess--marking');
            renderSelected();
        }

        const showError = (msg) => {
            const err = $('.xr-assess__err');
            err.textContent = msg;
            err.hidden = false;
        };

        // ---- stance chips ------------------------------------------
        const syncStance = () => {
            host.querySelectorAll('.xr-assess__stance-btn').forEach((b) => {
                b.classList.toggle('xr-assess__stance-btn--active',
                    state.stance !== null && String(state.stance) === b.dataset.stance);
            });
        };
        host.querySelectorAll('.xr-assess__stance-btn').forEach((b) => {
            b.addEventListener('click', () => {
                const v = parseInt(b.dataset.stance, 10);
                state.stance = (state.stance === v) ? null : v;   // re-click clears
                syncStance();
            });
        });

        // ---- label picker ------------------------------------------
        const syncPicker = () => {
            host.querySelectorAll('.xr-assess__label-btn').forEach((b) => {
                b.classList.toggle('xr-assess__label-btn--active', state.labels.has(b.dataset.label));
            });
        };
        const toggleLabel = (label) => {
            if (state.labels.has(label)) state.labels.delete(label);
            else state.labels.set(label, { note: '', anchor: null, suggested_by: 'user' });
            syncPicker();
            renderSelected();
        };
        host.querySelectorAll('.xr-assess__label-btn').forEach((b) => {
            b.addEventListener('click', () => toggleLabel(b.dataset.label));
        });

        // Custom label: normalize (lowercase, trim, spaces→hyphens)
        // rather than reject; only structurally invalid input errors.
        const customInput = $('.xr-assess__custom-input');
        const addCustom = () => {
            const normalized = String(customInput.value || '')
                .trim().toLowerCase().replace(/\s+/g, '-');
            if (!normalized) return;
            if (!isValidLabel(normalized)) {
                showError(`Not a valid label: ${normalized} (lowercase a-z0-9-, one optional "family/" prefix, ≤64 chars)`);
                return;
            }
            $('.xr-assess__err').hidden = true;
            if (!state.labels.has(normalized)) {
                state.labels.set(normalized, { note: '', anchor: null, suggested_by: 'user' });
            }
            customInput.value = '';
            syncPicker();
            renderSelected();
        };
        $('.xr-assess__custom-add').addEventListener('click', addCustom);
        customInput.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); addCustom(); }
        });

        // ---- selected-labels detail rows ---------------------------
        function renderSelected() {
            const wrap = $('.xr-assess__selected');
            if (state.labels.size === 0) { wrap.innerHTML = ''; return; }
            const canAnchor = !!(anchorContext && anchorContext.container);
            wrap.innerHTML = [...state.labels.entries()].map(([label, entry]) => `
              <div class="xr-assess__sel-row" data-label="${escapeHtml(label)}">
                <span class="xr-assess__sel-name${isStandardLabel(label) ? '' : ' xr-assess__sel-name--custom'}">${escapeHtml(label)}</span>
                <input type="text" class="xr-assess__sel-note" placeholder="note (optional)"
                       value="${escapeHtml(entry.note)}" />
                ${canAnchor ? `<button type="button" class="xr-assess__sel-mark" title="${entry.anchor ? 'Re-mark the offending span' : 'Mark the offending span in the article'}">📍${entry.anchor ? '✓' : ''}</button>` : ''}
                ${entry.anchor ? `<button type="button" class="xr-assess__sel-clear" title="Clear the span">✕📍</button>` : ''}
                <button type="button" class="xr-assess__sel-remove" title="Remove label">✕</button>
              </div>`).join('');
            wrap.querySelectorAll('.xr-assess__sel-row').forEach((row) => {
                const label = row.dataset.label;
                row.querySelector('.xr-assess__sel-note').addEventListener('input', (ev) => {
                    const entry = state.labels.get(label);
                    if (entry) entry.note = ev.target.value;
                });
                const mark = row.querySelector('.xr-assess__sel-mark');
                if (mark) mark.addEventListener('click', () => enterMarkMode(label));
                const clear = row.querySelector('.xr-assess__sel-clear');
                if (clear) clear.addEventListener('click', () => {
                    const entry = state.labels.get(label);
                    if (entry) entry.anchor = null;
                    renderSelected();
                });
                row.querySelector('.xr-assess__sel-remove').addEventListener('click', () => toggleLabel(label));
            });
        }

        // ---- footer ------------------------------------------------
        $('[data-action="cancel"]').addEventListener('click', () => close(null));
        $('.xr-assess__close').addEventListener('click', () => close(null));
        $('.xr-assess__backdrop').addEventListener('click', () => {
            if (!markingLabel) close(null);
        });
        pill.querySelector('[data-action="mark-done"]').addEventListener('click', () => exitMarkMode(true));
        pill.querySelector('[data-action="mark-cancel"]').addEventListener('click', () => exitMarkMode(false));

        const removeBtn = $('[data-action="remove"]');
        if (removeBtn) removeBtn.addEventListener('click', async () => {
            try {
                await AssessmentModel.delete(existing.id);
                close({ deleted: true });
            } catch (err) { showError(err.message || String(err)); }
        });

        $('[data-action="save"]').addEventListener('click', async () => {
            const fields = {
                stance:    state.stance,
                rationale: $('.xr-assess__rationale').value,
                labels:    [...state.labels.entries()].map(([label, e]) => ({
                    label, note: e.note, anchor: e.anchor, suggested_by: e.suggested_by
                }))
            };
            try {
                const saved = existing
                    ? await AssessmentModel.update(existing.id, fields)
                    : await AssessmentModel.create({ claim_ref: claimRef, ...fields });
                close(saved);
            } catch (err) {
                showError(err.message || String(err));
            }
        });

        document.addEventListener('keydown', onKey);
        document.addEventListener('mouseup', onMouseUp);
        syncStance();
        syncPicker();
        renderSelected();
    });
}

// ------------------------------------------------------------------
// Markup + styles
// ------------------------------------------------------------------

function buildHtml(claimText, state, isExisting, canAnchor) {
    const stanceBtns = STANCE_VALUES.map((v) => `
        <button type="button" class="xr-assess__stance-btn" data-stance="${v}"
                title="${escapeHtml(STANCE_LABELS[String(v)])}">
          ${STANCE_ICONS[String(v)]}<span>${escapeHtml(STANCE_LABELS[String(v)])}</span>
        </button>`).join('');

    const groups = Object.entries(ASSESSMENT_LABEL_GROUPS).map(([group, labels]) => `
        <div class="xr-assess__group">
          <span class="xr-assess__group-name">${escapeHtml(group)}</span>
          <div class="xr-assess__group-labels">
            ${labels.map((l) => `<button type="button" class="xr-assess__label-btn" data-label="${escapeHtml(l)}">${escapeHtml(l)}</button>`).join('')}
          </div>
        </div>`).join('');

    return `
      <div class="xr-assess__backdrop"></div>
      <div class="xr-assess__card">
        <header class="xr-assess__head">
          <h2 class="xr-assess__title">${isExisting ? 'Edit assessment' : 'Assess claim'}</h2>
          <button type="button" class="xr-assess__close" aria-label="Cancel">✕</button>
        </header>
        <div class="xr-assess__body">
          <div class="xr-assess__err" hidden></div>
          <blockquote class="xr-assess__claim">${escapeHtml(claimText || '(claim)')}</blockquote>

          <div class="xr-assess__field">
            <span class="xr-assess__field-label">Stance <em>(optional — click again to clear)</em></span>
            <div class="xr-assess__stances">${stanceBtns}</div>
          </div>

          <div class="xr-assess__field">
            <span class="xr-assess__field-label">Labels</span>
            ${groups}
            <div class="xr-assess__custom">
              <input type="text" class="xr-assess__custom-input" placeholder="custom label…" spellcheck="false" />
              <button type="button" class="xr-assess__custom-add">Add</button>
            </div>
          </div>

          <div class="xr-assess__selected"></div>
          ${canAnchor ? '' : ''}

          <label class="xr-assess__field">
            <span class="xr-assess__field-label">Rationale <em>(optional, markdown)</em></span>
            <textarea class="xr-assess__rationale" rows="3"
                      placeholder="Why do you judge it this way?">${escapeHtml(state.rationale)}</textarea>
          </label>
        </div>
        <footer class="xr-assess__foot">
          ${isExisting ? '<button type="button" class="xr-assess__btn xr-assess__btn--danger" data-action="remove">Remove</button>' : ''}
          <span class="xr-assess__foot-gap"></span>
          <button type="button" class="xr-assess__btn xr-assess__btn--ghost" data-action="cancel">Cancel</button>
          <button type="button" class="xr-assess__btn xr-assess__btn--primary" data-action="save">Save</button>
        </footer>
      </div>
      <div class="xr-assess__pill">
        📍 Select the offending span for <strong class="xr-assess__pill-label"></strong> in the article, then
        <button type="button" data-action="mark-done" disabled>Done</button>
        <button type="button" data-action="mark-cancel">Cancel</button>
      </div>`;
}

let stylesInjected = false;
function ensureStyles() {
    if (stylesInjected || typeof document === 'undefined') return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.id = 'xr-assess-styles';
    style.textContent = `
.xr-assess { position: fixed; inset: 0; z-index: 10010; }
.xr-assess__backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.55); }
.xr-assess__card {
  position: relative; margin: 5vh auto 0; width: min(580px, calc(100vw - 32px));
  max-height: 88vh; display: flex; flex-direction: column;
  background: var(--xr-surface, #242424); color: var(--xr-text, #e6e6e6);
  border: 1px solid var(--xr-border, #333); border-radius: 10px;
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.xr-assess--marking .xr-assess__card, .xr-assess--marking .xr-assess__backdrop { display: none; }
.xr-assess__pill {
  display: none; position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
  background: var(--xr-surface, #242424); color: var(--xr-text, #e6e6e6);
  border: 1px solid var(--xr-primary, #8b5cf6); border-radius: 999px;
  padding: 8px 14px; z-index: 10011; box-shadow: 0 4px 18px rgba(0,0,0,.4);
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.xr-assess--marking .xr-assess__pill { display: block; }
.xr-assess__pill button { margin-left: 6px; }
.xr-assess__head, .xr-assess__foot {
  display: flex; align-items: center; gap: 8px; padding: 12px 16px;
}
.xr-assess__head { border-bottom: 1px solid var(--xr-border, #333); }
.xr-assess__foot { border-top: 1px solid var(--xr-border, #333); }
.xr-assess__foot-gap { flex: 1; }
.xr-assess__title { margin: 0; font-size: 15px; flex: 1; }
.xr-assess__close { background: none; border: none; color: inherit; cursor: pointer; font-size: 14px; }
.xr-assess__body { padding: 12px 16px; overflow-y: auto; }
.xr-assess__err {
  background: color-mix(in srgb, var(--xr-danger, #f87171) 18%, transparent);
  border: 1px solid var(--xr-danger, #f87171); border-radius: 6px;
  padding: 6px 10px; margin-bottom: 10px; font-size: 12.5px;
}
.xr-assess__claim {
  margin: 0 0 12px; padding: 8px 12px; border-left: 3px solid var(--xr-primary, #8b5cf6);
  background: var(--xr-surface-2, #2e2e2e); border-radius: 0 6px 6px 0;
  font-style: italic; max-height: 90px; overflow-y: auto;
}
.xr-assess__field { display: block; margin-bottom: 14px; }
.xr-assess__field-label { display: block; font-size: 11px; text-transform: uppercase;
  letter-spacing: .04em; color: var(--xr-text-dim, #9a9a9a); margin-bottom: 6px; }
.xr-assess__field-label em { text-transform: none; letter-spacing: 0; }
.xr-assess__stances { display: flex; gap: 6px; flex-wrap: wrap; }
.xr-assess__stance-btn {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 6px 10px; border-radius: 8px; cursor: pointer; font-size: 12px;
  background: var(--xr-surface-2, #2e2e2e); color: inherit;
  border: 1px solid var(--xr-border, #333);
}
.xr-assess__stance-btn span { font-size: 10.5px; color: var(--xr-text-dim, #9a9a9a); }
.xr-assess__stance-btn--active {
  border-color: var(--xr-primary, #8b5cf6);
  background: color-mix(in srgb, var(--xr-primary, #8b5cf6) 22%, transparent);
}
.xr-assess__stance-btn--active span { color: inherit; }
.xr-assess__group { margin-bottom: 6px; }
.xr-assess__group-name { font-size: 10.5px; color: var(--xr-text-dim, #9a9a9a);
  text-transform: capitalize; display: inline-block; width: 86px; vertical-align: top; padding-top: 4px; }
.xr-assess__group-labels { display: inline-flex; gap: 4px; flex-wrap: wrap; width: calc(100% - 92px); }
.xr-assess__label-btn {
  padding: 2px 8px; border-radius: 999px; font-size: 11.5px; cursor: pointer;
  background: var(--xr-surface-2, #2e2e2e); color: inherit;
  border: 1px solid var(--xr-border, #333);
}
.xr-assess__label-btn--active {
  border-color: var(--xr-warning, #fbbf24);
  background: color-mix(in srgb, var(--xr-warning, #fbbf24) 20%, transparent);
}
.xr-assess__custom { display: flex; gap: 6px; margin-top: 6px; }
.xr-assess__custom-input {
  flex: 1; padding: 4px 8px; border-radius: 6px; font-size: 12px;
  background: var(--xr-surface-2, #2e2e2e); color: inherit;
  border: 1px solid var(--xr-border, #333);
}
.xr-assess__custom-add { padding: 4px 10px; border-radius: 6px; cursor: pointer;
  background: var(--xr-surface-2, #2e2e2e); color: inherit; border: 1px solid var(--xr-border, #333); }
.xr-assess__selected { margin-bottom: 12px; }
.xr-assess__sel-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.xr-assess__sel-name { font-size: 12px; min-width: 130px;
  color: var(--xr-warning, #fbbf24); }
.xr-assess__sel-name--custom::after { content: ' (custom)'; color: var(--xr-text-dim, #9a9a9a); font-size: 10px; }
.xr-assess__sel-note { flex: 1; padding: 3px 8px; border-radius: 6px; font-size: 12px;
  background: var(--xr-surface-2, #2e2e2e); color: inherit; border: 1px solid var(--xr-border, #333); }
.xr-assess__sel-mark, .xr-assess__sel-clear, .xr-assess__sel-remove {
  background: none; border: 1px solid var(--xr-border, #333); border-radius: 6px;
  color: inherit; cursor: pointer; font-size: 11px; padding: 3px 6px;
}
.xr-assess__rationale { width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 6px;
  font: 13px/1.4 inherit; background: var(--xr-surface-2, #2e2e2e); color: inherit;
  border: 1px solid var(--xr-border, #333); resize: vertical; }
.xr-assess__btn { padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px;
  border: 1px solid var(--xr-border, #333); background: var(--xr-surface-2, #2e2e2e); color: inherit; }
.xr-assess__btn--primary { background: var(--xr-primary, #8b5cf6); border-color: var(--xr-primary, #8b5cf6); color: #fff; }
.xr-assess__btn--danger { border-color: var(--xr-danger, #f87171); color: var(--xr-danger, #f87171); background: none; }
/* badge strip (claims bar / others' modal / side panel) */
.xr-assess-badges { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
.xr-assess-badge {
  display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px;
  background: var(--xr-surface-2, #2e2e2e); border: 1px solid var(--xr-border, #333);
  color: var(--xr-text, #e6e6e6);
}
.xr-assess-badge--stance { border-color: var(--xr-primary, #8b5cf6); }
.xr-assess-badge--label { border-color: var(--xr-warning, #fbbf24); }
.xr-assess-badge--custom { border-style: dashed; }
.xr-assess-badge--warn { border-color: var(--xr-danger, #f87171); }
`;
    document.head.appendChild(style);
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

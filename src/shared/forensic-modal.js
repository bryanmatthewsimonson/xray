// Forensic finding modal — Phase 14.2 (docs/CRIMINOLOGY_DESIGN.md).
//
// The capture UI for one behavioral finding: a subject + role, a single
// maneuver from the canon-seeded taxonomy (+ a custom escape hatch), an
// ORDERED evidence chain (each step a quote + optional marked span), a
// structural `note`, the REQUIRED `counter_note` (the alternative
// reading), and the `basis` enum that stands in for a score. Saving
// goes through ForensicModel (create or update).
//
// The methodology rules are surfaced in the UI, not just enforced at
// save: the selected maneuver shows its definition + counter-indicators
// inline (the falsifiability prompt), the counter-note field is marked
// required, and there is no stance/score control anywhere — there is no
// score.
//
// UI-in-shared exception, exactly like assess-modal.js: this renders DOM
// because the finding surface is shared between extension pages. It
// injects its own <style> (xr-finding-* only) and must NOT be imported
// by the content script. Span anchoring is capability-gated on
// `anchorContext.container` (the reader's article body) — the modal
// minimizes to a pill, the user selects the offending passage, and
// `captureFromRange` builds the selector array.

import { ForensicModel, ForensicBaseline } from './forensic-model.js';
import { captureFromRange } from './metadata/anchor-capture.js';
import {
    FORENSIC_MANEUVER_GROUPS, MANEUVER_GUIDE, isStandardManeuver, isValidManeuver,
    ROLES, BASIS_VALUES, isValidBasis
} from './forensic-taxonomy.js';

const BASIS_LABELS = {
    quoted:                 'Quoted — a verbatim span',
    paraphrased:            'Paraphrased — my summary of what was said',
    'behavioral-cue':       'Behavioral cue — tone / body language (weakest)',
    'structural-inference': 'Structural inference — the move the structure makes'
};

// ------------------------------------------------------------------
// Badges (findings bar)
// ------------------------------------------------------------------

/**
 * Compact badge strip for a finding: maneuver pill + role + basis +
 * published marker. Pure HTML string. Renders nothing for null.
 */
export function renderFindingBadges(finding) {
    if (!finding) return '';
    ensureStyles();
    const bits = [];
    if (finding.publishedAt) {
        bits.push(`<span class="xr-finding-badge xr-finding-badge--pub" title="Published ${new Date(finding.publishedAt * 1000).toLocaleString()}">🌐</span>`);
    }
    const custom = isStandardManeuver(finding.maneuver) ? '' : ' xr-finding-badge--custom';
    const n = (finding.anchors || []).length;
    const steps = n > 1 ? ` ·${n}` : '';
    bits.push(`<span class="xr-finding-badge xr-finding-badge--maneuver${custom}" title="${escapeHtml(finding.maneuver)}">${escapeHtml(finding.maneuver)}${steps}</span>`);
    if (finding.role) bits.push(`<span class="xr-finding-badge xr-finding-badge--role">${escapeHtml(finding.role)}</span>`);
    if (finding.basis) bits.push(`<span class="xr-finding-badge xr-finding-badge--basis" title="Evidence basis">${escapeHtml(finding.basis)}</span>`);
    return `<div class="xr-finding-badges">${bits.join('')}</div>`;
}

// ------------------------------------------------------------------
// The finding modal
// ------------------------------------------------------------------

/**
 * Open the finding modal.
 *
 * @param {{
 *   subjectChoices?: Array<{ key: string, label: string }>,  // tagged entities
 *   anchorContext?: { container: Element } | null,
 *   seedAnchor?: { quote?: string, selector?: any, source_ref?: object } | null,
 *   existing?: object | null,        // a finding to edit
 *   sourceRef?: { url?: string, title?: string } | null  // default per-anchor source
 * }} opts
 * @returns {Promise<object | {deleted: true} | null>}
 */
export async function openFindingModal({
    subjectChoices = [], anchorContext = null, seedAnchor = null,
    existing = null, sourceRef = null
} = {}) {
    ensureStyles();

    const initialSubjectKey = existing
        ? (subjectKeyOf(existing.subject_ref) || '__custom__')
        : (subjectChoices[0] ? subjectChoices[0].key : '__custom__');

    const state = {
        subjectKey:  initialSubjectKey,
        customLabel: existing && !subjectChoices.some((c) => c.key === initialSubjectKey)
            ? (existing.subject_ref.label || '') : '',
        role:        existing ? existing.role : 'apologist',
        maneuver:    existing ? existing.maneuver : null,
        basis:       existing ? existing.basis : 'quoted',
        note:        existing ? existing.note : '',
        counter:     existing ? existing.counter_note : '',
        anchors:     seedAnchors(existing, seedAnchor)
    };

    return new Promise((resolve) => {
        const host = document.createElement('div');
        host.className = 'xr-finding';
        host.innerHTML = buildHtml(state, subjectChoices, !!existing,
            !!(anchorContext && anchorContext.container));
        document.body.appendChild(host);

        const $ = (sel) => host.querySelector(sel);
        const pill = $('.xr-finding__pill');
        let markingIndex = null;
        let markedRange = null;

        const close = (result) => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('mouseup', onMouseUp);
            if (host.parentNode) host.parentNode.removeChild(host);
            resolve(result);
        };
        const onKey = (ev) => {
            if (ev.key !== 'Escape') return;
            if (markingIndex !== null) { exitMarkMode(false); return; }
            close(null);
        };
        const onMouseUp = () => {
            if (markingIndex === null || !anchorContext) return;
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return;
            const range = sel.getRangeAt(0);
            if (range.collapsed) return;
            if (!anchorContext.container.contains(range.commonAncestorContainer)) return;
            markedRange = range.cloneRange();
            pill.querySelector('[data-action="mark-done"]').disabled = false;
        };

        function enterMarkMode(i) {
            markingIndex = i;
            markedRange = null;
            host.classList.add('xr-finding--marking');
            pill.querySelector('[data-action="mark-done"]').disabled = true;
        }
        function exitMarkMode(save) {
            if (save && markedRange && markingIndex !== null && anchorContext) {
                const captured = captureFromRange(markedRange, anchorContext.container);
                const a = state.anchors[markingIndex];
                if (captured && a) {
                    a.selector = captured.selectors;
                    if (!a.quote) a.quote = String(markedRange.toString() || '').trim();
                }
            }
            markingIndex = null;
            markedRange = null;
            host.classList.remove('xr-finding--marking');
            renderAnchors();
        }

        const showError = (msg) => { const e = $('.xr-finding__err'); e.textContent = msg; e.hidden = false; };
        const clearError = () => { $('.xr-finding__err').hidden = true; };

        // ---- subject + role ----------------------------------------
        const subjectSel = $('.xr-finding__subject');
        const customWrap = $('.xr-finding__custom-subject');
        const syncSubject = () => {
            state.subjectKey = subjectSel.value;
            customWrap.hidden = state.subjectKey !== '__custom__';
        };
        subjectSel.addEventListener('change', syncSubject);
        $('.xr-finding__custom-subject-input').addEventListener('input', (ev) => {
            state.customLabel = ev.target.value;
        });
        $('.xr-finding__role').addEventListener('change', (ev) => { state.role = ev.target.value; });

        // ---- maneuver (single-select) ------------------------------
        const syncManeuver = () => {
            host.querySelectorAll('.xr-finding__man-btn').forEach((b) => {
                b.classList.toggle('xr-finding__man-btn--active', b.dataset.man === state.maneuver);
            });
            renderGuide();
        };
        host.querySelectorAll('.xr-finding__man-btn').forEach((b) => {
            b.addEventListener('click', () => {
                state.maneuver = (state.maneuver === b.dataset.man) ? null : b.dataset.man;
                $('.xr-finding__custom-man-input').value = '';
                syncManeuver();
            });
        });
        const customManInput = $('.xr-finding__custom-man-input');
        const addCustomMan = () => {
            const normalized = String(customManInput.value || '').trim().toLowerCase().replace(/\s+/g, '-');
            if (!normalized) return;
            if (!isValidManeuver(normalized)) {
                showError(`Not a valid maneuver: ${normalized} (lowercase a-z0-9-, one optional "family/" prefix, ≤64 chars)`);
                return;
            }
            clearError();
            state.maneuver = normalized;
            syncManeuver();
        };
        $('.xr-finding__custom-man-add').addEventListener('click', addCustomMan);
        customManInput.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); addCustomMan(); }
        });

        function renderGuide() {
            const wrap = $('.xr-finding__guide');
            const g = state.maneuver ? MANEUVER_GUIDE[state.maneuver] : null;
            if (!g) {
                wrap.innerHTML = state.maneuver
                    ? `<em>Custom maneuver — describe it in the note, and give the alternative reading below.</em>`
                    : '';
                return;
            }
            wrap.innerHTML = `
              <div class="xr-finding__guide-def"><strong>${escapeHtml(state.maneuver)}</strong>${g.alias ? ` <span class="xr-finding__guide-alias">(${escapeHtml(g.alias)})</span>` : ''} — ${escapeHtml(g.definition)} <span class="xr-finding__guide-src">${escapeHtml(g.source)}</span></div>
              <div class="xr-finding__guide-counter"><span>Would make it NOT this:</span> ${g.counterIndicators.map((c) => escapeHtml(c)).join('; ')}</div>`;
        }

        // ---- basis -------------------------------------------------
        $('.xr-finding__basis').addEventListener('change', (ev) => { state.basis = ev.target.value; });

        // ---- ordered evidence chain --------------------------------
        const canAnchor = !!(anchorContext && anchorContext.container);
        function renderAnchors() {
            const wrap = $('.xr-finding__anchors');
            wrap.innerHTML = state.anchors.map((a, i) => `
              <div class="xr-finding__anchor" data-i="${i}">
                <span class="xr-finding__anchor-n">${state.anchors.length > 1 ? `Step ${i + 1}` : 'Evidence'}</span>
                <input type="text" class="xr-finding__anchor-quote" placeholder="quote the span…" value="${escapeHtml(a.quote || '')}" />
                ${canAnchor ? `<button type="button" class="xr-finding__anchor-mark" title="${a.selector ? 'Re-mark the span' : 'Mark the span in the article'}">📍${a.selector ? '✓' : ''}</button>` : ''}
                ${state.anchors.length > 1 ? `<button type="button" class="xr-finding__anchor-del" title="Remove step">✕</button>` : ''}
              </div>`).join('');
            wrap.querySelectorAll('.xr-finding__anchor').forEach((row) => {
                const i = Number(row.dataset.i);
                row.querySelector('.xr-finding__anchor-quote').addEventListener('input', (ev) => {
                    state.anchors[i].quote = ev.target.value;
                });
                const mark = row.querySelector('.xr-finding__anchor-mark');
                if (mark) mark.addEventListener('click', () => enterMarkMode(i));
                const del = row.querySelector('.xr-finding__anchor-del');
                if (del) del.addEventListener('click', () => {
                    state.anchors.splice(i, 1);
                    renderAnchors();
                });
            });
        }
        $('.xr-finding__anchor-add').addEventListener('click', () => {
            state.anchors.push({ quote: '', selector: null, source_ref: sourceRef ? { ...sourceRef } : null });
            renderAnchors();
        });

        // ---- note + counter ----------------------------------------
        $('.xr-finding__note').addEventListener('input', (ev) => { state.note = ev.target.value; });
        $('.xr-finding__counter').addEventListener('input', (ev) => { state.counter = ev.target.value; });

        // ---- footer ------------------------------------------------
        $('[data-action="cancel"]').addEventListener('click', () => close(null));
        $('.xr-finding__close').addEventListener('click', () => close(null));
        $('.xr-finding__backdrop').addEventListener('click', () => { if (markingIndex === null) close(null); });
        pill.querySelector('[data-action="mark-done"]').addEventListener('click', () => exitMarkMode(true));
        pill.querySelector('[data-action="mark-cancel"]').addEventListener('click', () => exitMarkMode(false));

        const removeBtn = $('[data-action="remove"]');
        if (removeBtn) removeBtn.addEventListener('click', async () => {
            try { await ForensicModel.delete(existing.id); close({ deleted: true }); }
            catch (err) { showError(err.message || String(err)); }
        });

        $('[data-action="save"]').addEventListener('click', async () => {
            clearError();
            const subject_ref = resolveSubjectRef(state, subjectChoices);
            const anchors = state.anchors
                .map((a) => ({
                    quote: a.quote, selector: a.selector,
                    source_ref: a.source_ref || (sourceRef ? { ...sourceRef } : null)
                }))
                .filter((a) => String(a.quote || '').trim());
            // Friendly pre-checks (the model enforces these too).
            if (!state.maneuver) return showError('Pick a maneuver.');
            if (anchors.length === 0) return showError('Add at least one evidence step with a quote.');
            if (!String(state.counter || '').trim()) {
                return showError('A counter-note is required — give the alternative / exonerating reading.');
            }
            const fields = {
                subject_ref, role: state.role, maneuver: state.maneuver,
                anchors, note: state.note, counter_note: state.counter, basis: state.basis
            };
            try {
                const saved = existing
                    ? await ForensicModel.update(existing.id, {
                        role: fields.role, note: fields.note,
                        counter_note: fields.counter_note, basis: fields.basis
                    })
                    : await ForensicModel.create(fields);
                close(saved);
            } catch (err) { showError(err.message || String(err)); }
        });

        document.addEventListener('keydown', onKey);
        document.addEventListener('mouseup', onMouseUp);
        syncSubject();
        syncManeuver();
        renderAnchors();

        // Honest immutability (27 F.1): subject / maneuver / anchors
        // DERIVE the finding's id — ForensicModel.update silently
        // ignores edits to them, and until now this modal rendered
        // them editable and discarded the changes on save. Freeze the
        // structural controls on edit and say why.
        if (existing) {
            host.querySelectorAll(
                '.xr-finding__subject, .xr-finding__custom-subject-input,'
                + ' .xr-finding__man-btn, .xr-finding__custom-man-input,'
                + ' .xr-finding__custom-man-add, .xr-finding__anchor-quote,'
                + ' .xr-finding__anchor-mark, .xr-finding__anchor-del,'
                + ' .xr-finding__anchor-add'
            ).forEach((n) => { n.disabled = true; });
            const hint = document.createElement('div');
            hint.className = 'xr-finding__immutable-note';
            hint.textContent = 'Subject, maneuver, and evidence anchors are this finding\'s identity '
                + '— to change them, delete the finding and create a new one. '
                + 'Role, note, counter-read, and basis stay editable.';
            const err = host.querySelector('.xr-finding__err');
            err.parentNode.insertBefore(hint, err.nextSibling);
        }
    });
}

// ------------------------------------------------------------------
// Baseline modal (Rule 3 — a deviation needs something to deviate from)
// ------------------------------------------------------------------

/**
 * Open the baseline-marking modal: a subject + a descriptive register
 * note (no score). Saves through ForensicBaseline.
 */
export async function openBaselineModal({ subjectChoices = [], sourceRef = null } = {}) {
    ensureStyles();
    const state = {
        subjectKey: subjectChoices[0] ? subjectChoices[0].key : '__custom__',
        customLabel: '', note: ''
    };
    return new Promise((resolve) => {
        const host = document.createElement('div');
        host.className = 'xr-finding';
        host.innerHTML = `
          <div class="xr-finding__backdrop"></div>
          <div class="xr-finding__card">
            <header class="xr-finding__head">
              <h2 class="xr-finding__title">Set behavioral baseline</h2>
              <button type="button" class="xr-finding__close" aria-label="Cancel">✕</button>
            </header>
            <div class="xr-finding__body">
              <div class="xr-finding__err" hidden></div>
              <label class="xr-finding__field">
                <span class="xr-finding__field-label">Subject</span>
                ${subjectSelectHtml(subjectChoices, state.subjectKey)}
              </label>
              <div class="xr-finding__custom-subject" ${state.subjectKey === '__custom__' ? '' : 'hidden'}>
                <input type="text" class="xr-finding__custom-subject-input" placeholder="subject name…" />
              </div>
              <label class="xr-finding__field">
                <span class="xr-finding__field-label">Baseline register <em>(descriptive — not a score)</em></span>
                <textarea class="xr-finding__note" rows="3" placeholder="e.g. even tone, fact-anchored, held across the first three sessions"></textarea>
              </label>
            </div>
            <footer class="xr-finding__foot">
              <span class="xr-finding__foot-gap"></span>
              <button type="button" class="xr-finding__btn xr-finding__btn--ghost" data-action="cancel">Cancel</button>
              <button type="button" class="xr-finding__btn xr-finding__btn--primary" data-action="save">Save</button>
            </footer>
          </div>`;
        document.body.appendChild(host);
        const $ = (s) => host.querySelector(s);
        const close = (r) => { if (host.parentNode) host.parentNode.removeChild(host); resolve(r); };
        const showError = (m) => { const e = $('.xr-finding__err'); e.textContent = m; e.hidden = false; };

        const subjectSel = $('.xr-finding__subject');
        const customWrap = $('.xr-finding__custom-subject');
        subjectSel.addEventListener('change', () => {
            state.subjectKey = subjectSel.value;
            customWrap.hidden = state.subjectKey !== '__custom__';
        });
        $('.xr-finding__custom-subject-input').addEventListener('input', (ev) => { state.customLabel = ev.target.value; });
        $('.xr-finding__note').addEventListener('input', (ev) => { state.note = ev.target.value; });
        $('.xr-finding__close').addEventListener('click', () => close(null));
        $('[data-action="cancel"]').addEventListener('click', () => close(null));
        $('.xr-finding__backdrop').addEventListener('click', () => close(null));
        $('[data-action="save"]').addEventListener('click', async () => {
            const subject_ref = resolveSubjectRef(state, subjectChoices);
            if (!String(state.note || '').trim()) return showError('Describe the baseline register.');
            try {
                const saved = await ForensicBaseline.create({
                    subject_ref, note: state.note,
                    source_url: (sourceRef && sourceRef.url) || ''
                });
                close(saved);
            } catch (err) { showError(err.message || String(err)); }
        });
    });
}

// ------------------------------------------------------------------
// Subject-ref helpers
// ------------------------------------------------------------------

function subjectKeyOf(ref) {
    return ref && (ref.identity_id || ref.pubkey || ref.account) || '';
}

function resolveSubjectRef(state, subjectChoices) {
    if (state.subjectKey === '__custom__') {
        return { label: String(state.customLabel || '').trim() };
    }
    const choice = subjectChoices.find((c) => c.key === state.subjectKey);
    return { identity_id: state.subjectKey, label: choice ? choice.label : state.subjectKey };
}

function seedAnchors(existing, seedAnchor) {
    if (existing && Array.isArray(existing.anchors) && existing.anchors.length) {
        return existing.anchors.map((a) => ({
            quote: a.quote || '', selector: a.selector || null, source_ref: a.source_ref || null
        }));
    }
    if (seedAnchor) {
        return [{ quote: seedAnchor.quote || '', selector: seedAnchor.selector || null,
                  source_ref: seedAnchor.source_ref || null }];
    }
    return [{ quote: '', selector: null, source_ref: null }];
}

// ------------------------------------------------------------------
// Markup
// ------------------------------------------------------------------

function subjectSelectHtml(subjectChoices, selectedKey) {
    const opts = subjectChoices.map((c) =>
        `<option value="${escapeHtml(c.key)}" ${c.key === selectedKey ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('');
    const customSelected = selectedKey === '__custom__' ? 'selected' : '';
    return `<select class="xr-finding__subject">${opts}<option value="__custom__" ${customSelected}>Other…</option></select>`;
}

function buildHtml(state, subjectChoices, isExisting, canAnchor) {
    const roleOpts = ROLES.map((r) =>
        `<option value="${r}" ${r === state.role ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('');
    const basisOpts = BASIS_VALUES.map((b) =>
        `<option value="${b}" ${b === state.basis ? 'selected' : ''}>${escapeHtml(BASIS_LABELS[b] || b)}</option>`).join('');
    const manGroups = Object.entries(FORENSIC_MANEUVER_GROUPS).map(([group, mans]) => `
        <div class="xr-finding__man-group">
          <span class="xr-finding__man-group-name">${escapeHtml(group)}</span>
          <div class="xr-finding__man-labels">
            ${mans.map((m) => {
                const g = MANEUVER_GUIDE[m] || {};
                const short = m.split('/')[1] || m;
                return `<button type="button" class="xr-finding__man-btn" data-man="${escapeHtml(m)}" title="${escapeHtml(g.definition || m)}">${escapeHtml(short)}</button>`;
            }).join('')}
          </div>
        </div>`).join('');

    return `
      <div class="xr-finding__backdrop"></div>
      <div class="xr-finding__card">
        <header class="xr-finding__head">
          <h2 class="xr-finding__title">${isExisting ? 'Edit finding' : 'Name a maneuver'}</h2>
          <button type="button" class="xr-finding__close" aria-label="Cancel">✕</button>
        </header>
        <div class="xr-finding__body">
          <div class="xr-finding__err" hidden></div>

          <div class="xr-finding__row">
            <label class="xr-finding__field xr-finding__field--grow">
              <span class="xr-finding__field-label">Subject</span>
              ${subjectSelectHtml(subjectChoices, state.subjectKey)}
            </label>
            <label class="xr-finding__field">
              <span class="xr-finding__field-label">Role</span>
              <select class="xr-finding__role">${roleOpts}</select>
            </label>
          </div>
          <div class="xr-finding__custom-subject" ${state.subjectKey === '__custom__' ? '' : 'hidden'}>
            <input type="text" class="xr-finding__custom-subject-input" placeholder="subject name…"
                   value="${escapeHtml(state.customLabel)}" />
          </div>

          <div class="xr-finding__field">
            <span class="xr-finding__field-label">Maneuver <em>(one)</em></span>
            ${manGroups}
            <div class="xr-finding__custom">
              <input type="text" class="xr-finding__custom-man-input" placeholder="custom maneuver…" spellcheck="false" />
              <button type="button" class="xr-finding__custom-man-add">Add</button>
            </div>
            <div class="xr-finding__guide"></div>
          </div>

          <div class="xr-finding__field">
            <span class="xr-finding__field-label">Evidence <em>(ordered — add steps for a sequence)</em></span>
            <div class="xr-finding__anchors"></div>
            <button type="button" class="xr-finding__anchor-add">+ evidence step</button>
          </div>

          <label class="xr-finding__field">
            <span class="xr-finding__field-label">Basis <em>(how we know — not a score)</em></span>
            <select class="xr-finding__basis">${basisOpts}</select>
          </label>

          <label class="xr-finding__field">
            <span class="xr-finding__field-label">Note <em>(what the structure does, optional)</em></span>
            <textarea class="xr-finding__note" rows="2" placeholder="Describe the move — structure, not intent.">${escapeHtml(state.note)}</textarea>
          </label>

          <label class="xr-finding__field">
            <span class="xr-finding__field-label xr-finding__field-label--req">Counter-note <em>(required — the alternative reading)</em></span>
            <textarea class="xr-finding__counter" rows="2" placeholder="What would make this NOT this? The exonerating read.">${escapeHtml(state.counter)}</textarea>
          </label>
        </div>
        <footer class="xr-finding__foot">
          ${isExisting ? '<button type="button" class="xr-finding__btn xr-finding__btn--danger" data-action="remove">Remove</button>' : ''}
          <span class="xr-finding__foot-gap"></span>
          <button type="button" class="xr-finding__btn xr-finding__btn--ghost" data-action="cancel">Cancel</button>
          <button type="button" class="xr-finding__btn xr-finding__btn--primary" data-action="save">Save</button>
        </footer>
      </div>
      <div class="xr-finding__pill">
        📍 Select the span in the article, then
        <button type="button" data-action="mark-done" disabled>Done</button>
        <button type="button" data-action="mark-cancel">Cancel</button>
      </div>`;
}

// ------------------------------------------------------------------
// Styles
// ------------------------------------------------------------------

let stylesInjected = false;
function ensureStyles() {
    if (stylesInjected || typeof document === 'undefined') return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.id = 'xr-finding-styles';
    style.textContent = `
.xr-finding { position: fixed; inset: 0; z-index: 10010; }
.xr-finding__backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.55); }
.xr-finding__card {
  position: relative; margin: 5vh auto 0; width: min(600px, calc(100vw - 32px));
  max-height: 88vh; display: flex; flex-direction: column;
  background: var(--xr-surface, #242424); color: var(--xr-text, #e6e6e6);
  border: 1px solid var(--xr-border, #333); border-radius: 10px;
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.xr-finding--marking .xr-finding__card, .xr-finding--marking .xr-finding__backdrop { display: none; }
.xr-finding__pill {
  display: none; position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
  background: var(--xr-surface, #242424); color: var(--xr-text, #e6e6e6);
  border: 1px solid var(--xr-primary, #8b5cf6); border-radius: 999px;
  padding: 8px 14px; z-index: 10011; box-shadow: 0 4px 18px rgba(0,0,0,.4); font-size: 13px;
}
.xr-finding--marking .xr-finding__pill { display: block; }
.xr-finding__pill button { margin-left: 6px; }
.xr-finding__head, .xr-finding__foot { display: flex; align-items: center; gap: 8px; padding: 12px 16px; }
.xr-finding__head { border-bottom: 1px solid var(--xr-border, #333); }
.xr-finding__foot { border-top: 1px solid var(--xr-border, #333); }
.xr-finding__foot-gap { flex: 1; }
.xr-finding__title { margin: 0; font-size: 15px; flex: 1; }
.xr-finding__close { background: none; border: none; color: inherit; cursor: pointer; font-size: 14px; }
.xr-finding__body { padding: 12px 16px; overflow-y: auto; }
.xr-finding__immutable-note {
  border: 1px dashed var(--xr-border, #334155); border-radius: 6px;
  padding: 6px 10px; margin-bottom: 10px; font-size: 12px; opacity: 0.85;
}
.xr-finding__err {
  background: color-mix(in srgb, var(--xr-danger, #f87171) 18%, transparent);
  border: 1px solid var(--xr-danger, #f87171); border-radius: 6px;
  padding: 6px 10px; margin-bottom: 10px; font-size: 12.5px;
}
.xr-finding__row { display: flex; gap: 10px; }
.xr-finding__field { display: block; margin-bottom: 14px; }
.xr-finding__field--grow { flex: 1; }
.xr-finding__field-label { display: block; font-size: 11px; text-transform: uppercase;
  letter-spacing: .04em; color: var(--xr-text-dim, #9a9a9a); margin-bottom: 6px; }
.xr-finding__field-label em { text-transform: none; letter-spacing: 0; }
.xr-finding__field-label--req { color: var(--xr-warning, #fbbf24); }
.xr-finding__subject, .xr-finding__role, .xr-finding__basis,
.xr-finding__custom-subject-input, .xr-finding__note, .xr-finding__counter,
.xr-finding__anchor-quote, .xr-finding__custom-man-input {
  width: 100%; box-sizing: border-box; padding: 5px 8px; border-radius: 6px; font: 13px/1.4 inherit;
  background: var(--xr-surface-2, #2e2e2e); color: inherit; border: 1px solid var(--xr-border, #333);
}
.xr-finding__note, .xr-finding__counter { resize: vertical; }
.xr-finding__custom-subject { margin: -8px 0 12px; }
.xr-finding__man-group { margin-bottom: 6px; }
.xr-finding__man-group-name { font-size: 10.5px; color: var(--xr-text-dim, #9a9a9a);
  text-transform: capitalize; display: inline-block; width: 100px; vertical-align: top; padding-top: 4px; }
.xr-finding__man-labels { display: inline-flex; gap: 4px; flex-wrap: wrap; width: calc(100% - 106px); }
.xr-finding__man-btn {
  padding: 2px 8px; border-radius: 999px; font-size: 11.5px; cursor: pointer;
  background: var(--xr-surface-2, #2e2e2e); color: inherit; border: 1px solid var(--xr-border, #333);
}
.xr-finding__man-btn--active {
  border-color: var(--xr-warning, #fbbf24);
  background: color-mix(in srgb, var(--xr-warning, #fbbf24) 22%, transparent);
}
.xr-finding__custom { display: flex; gap: 6px; margin-top: 6px; }
.xr-finding__custom-man-add { padding: 4px 10px; border-radius: 6px; cursor: pointer;
  background: var(--xr-surface-2, #2e2e2e); color: inherit; border: 1px solid var(--xr-border, #333); }
.xr-finding__guide { margin-top: 8px; font-size: 12px; }
.xr-finding__guide-def { color: var(--xr-text, #e6e6e6); margin-bottom: 4px; }
.xr-finding__guide-alias { color: var(--xr-text-dim, #9a9a9a); }
.xr-finding__guide-src { color: var(--xr-text-dim, #9a9a9a); font-style: italic; }
.xr-finding__guide-counter { color: var(--xr-text-dim, #9a9a9a); }
.xr-finding__guide-counter span { color: var(--xr-warning, #fbbf24); }
.xr-finding__anchor { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.xr-finding__anchor-n { font-size: 11px; color: var(--xr-text-dim, #9a9a9a); min-width: 56px; }
.xr-finding__anchor-mark, .xr-finding__anchor-del {
  background: none; border: 1px solid var(--xr-border, #333); border-radius: 6px;
  color: inherit; cursor: pointer; font-size: 11px; padding: 4px 6px; flex: none;
}
.xr-finding__anchor-add { margin-top: 4px; padding: 3px 10px; border-radius: 6px; cursor: pointer;
  background: var(--xr-surface-2, #2e2e2e); color: inherit; border: 1px solid var(--xr-border, #333); font-size: 12px; }
.xr-finding__btn { padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px;
  border: 1px solid var(--xr-border, #333); background: var(--xr-surface-2, #2e2e2e); color: inherit; }
.xr-finding__btn--primary { background: var(--xr-primary, #8b5cf6); border-color: var(--xr-primary, #8b5cf6); color: #fff; }
.xr-finding__btn--danger { border-color: var(--xr-danger, #f87171); color: var(--xr-danger, #f87171); background: none; }
/* badge strip */
.xr-finding-badges { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
.xr-finding-badge {
  display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px;
  background: var(--xr-surface-2, #2e2e2e); border: 1px solid var(--xr-border, #333); color: var(--xr-text, #e6e6e6);
}
.xr-finding-badge--maneuver { border-color: var(--xr-warning, #fbbf24); }
.xr-finding-badge--custom { border-style: dashed; }
.xr-finding-badge--role { color: var(--xr-text-dim, #9a9a9a); }
.xr-finding-badge--basis { color: var(--xr-text-dim, #9a9a9a); }
.xr-finding-badge--pub { border-color: var(--xr-success, #34d399); padding: 1px 5px; }
`;
    document.head.appendChild(style);
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// `isValidBasis` is imported for parity with the model's validation
// surface; the <select> can only emit valid values, but a future
// programmatic caller may not.
export { isValidBasis };

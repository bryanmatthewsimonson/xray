// Inline overlay — pure HTML renderers for the card iframe
// (overlay-card.html) and the side panel's CSP fallback. No DOM, no
// chrome.*: every function returns a string, and EVERY value that came
// from storage (claim text, note text, verdicts, rationale, quotes) goes
// through `esc()`. Items are FullItems as returned by the background's
// `xray:overlay:card` handler (`detail` carries the content), plus an
// optional `unlocated: true` the card sets from the parent's report.

export const REVIEW_LABELS = Object.freeze({
    unreviewed: 'unreviewed model proposal',
    accepted: 'accepted',
    rejected: 'rejected'
});

export const UNLOCATED_LABEL = 'Could not be located on this page';

const KIND_LABELS = Object.freeze({
    claim: 'Claim',
    finding: 'Forensic finding',
    extraction: 'Extraction',
    note: 'Your note'
});

const MAX_RENDER_CHARS = 20000;
// Mirrors page-notes.js MAX_NOTE_TEXT (kept literal so this module stays
// import-free; a test pins the two together). The background enforces it.
export const NOTE_MAXLENGTH = 10000;

export function esc(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** A displayable scalar, or '' for anything else (objects never render as "[object Object]"). */
function str(v) {
    if (typeof v === 'string') return v.length > MAX_RENDER_CHARS ? v.slice(0, MAX_RENDER_CHARS) + '…' : v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return '';
}

function list(v) {
    return Array.isArray(v) ? v : [];
}

function formatSeconds(s) {
    if (typeof s !== 'number' || !Number.isFinite(s) || s < 0) return '';
    const t = Math.floor(s);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const sec = String(t % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function row(label, value) {
    const v = str(value);
    if (!v) return '';
    return `<div class="xr-ov-row"><span class="xr-ov-row-label">${esc(label)}</span>`
        + `<span class="xr-ov-row-value">${esc(v)}</span></div>`;
}

function stanceText(stance) {
    if (typeof stance === 'number' && Number.isInteger(stance)) return (stance > 0 ? '+' : '') + stance;
    return str(stance);
}

function assessmentRows(a) {
    if (!a || typeof a !== 'object') return '';
    const labels = list(a.labels)
        .map((l) => (l && typeof l === 'object' ? str(l.label) : str(l)))
        .filter(Boolean);
    return '<div class="xr-ov-judgment xr-ov-judgment-assessment">'
        + '<div class="xr-ov-judgment-kind">Assessment</div>'
        + row('Stance', stanceText(a.stance))
        + row('Labels', labels.join(', '))
        + row('Rationale', a.rationale)
        + '</div>';
}

function verdictRows(v) {
    if (!v || typeof v !== 'object') return '';
    const caveats = list(v.caveats).map(str).filter(Boolean);
    return '<div class="xr-ov-judgment xr-ov-judgment-verdict">'
        + '<div class="xr-ov-judgment-kind">Verdict</div>'
        + row('State', v.verdict)
        + row('Standard of proof', v.standard_of_proof)
        + row('Caveats', caveats.join('; '))
        + row('Rationale', v.rationale)
        + '</div>';
}

function bodyFor(item) {
    const d = item.detail && typeof item.detail === 'object' ? item.detail : {};
    switch (item.kind) {
        case 'claim': {
            const judged = list(d.assessments).map(assessmentRows).join('')
                + list(d.verdicts).map(verdictRows).join('');
            return `<p class="xr-ov-text">${esc(str(d.text))}</p>`
                + (d.is_key ? '<span class="xr-ov-badge">Key claim</span>' : '')
                + judged;
        }
        case 'finding':
            return row('Maneuver', d.maneuver)
                + row('Role', d.role)
                + row('Counter-read', d.counter_note);
        case 'extraction': {
            const state = REVIEW_LABELS[item.reviewState] || REVIEW_LABELS.unreviewed;
            return `<p class="xr-ov-text">${esc(str(d.text))}</p>`
                + `<div class="xr-ov-review xr-ov-review-${esc(item.reviewState || 'unreviewed')}">`
                + `Review state: ${esc(state)}</div>`
                + row('Why', d.why);
        }
        case 'note':
            return `<p class="xr-ov-text xr-ov-note-text">${esc(str(d.text))}</p>`;
        default:
            return '';
    }
}

function actionsFor(item, opts) {
    if (!opts.actions || item.kind !== 'note') return '';
    const id = esc(item.id);
    return '<div class="xr-ov-actions">'
        + `<button type="button" class="xr-ov-btn" data-xr-ov-action="edit" data-xr-ov-id="${id}">Edit</button>`
        + `<button type="button" class="xr-ov-btn xr-ov-btn-danger" data-xr-ov-action="delete" data-xr-ov-id="${id}">Delete</button>`
        + '</div>';
}

function renderCard(item, opts) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string') return '';
    const kind = KIND_LABELS[item.kind] ? item.kind : null;
    if (!kind) return '';
    const quote = str(item.quote);
    const when = formatSeconds(item.seconds);
    return `<article class="xr-ov-card xr-ov-card-${kind}" data-xr-ov-id="${esc(item.id)}">`
        + `<header class="xr-ov-card-head"><span class="xr-ov-kind">${esc(KIND_LABELS[kind])}</span>`
        + (when ? `<span class="xr-ov-time">${esc(when)}</span>` : '')
        + '</header>'
        + (item.unlocated ? `<div class="xr-ov-unlocated">${esc(UNLOCATED_LABEL)}</div>` : '')
        + (quote ? `<blockquote class="xr-ov-quote">${esc(quote)}</blockquote>` : '')
        + bodyFor(item)
        + actionsFor(item, opts)
        + '</article>';
}

/**
 * Cards for the items a pin opened. Every item the caller passes is
 * shown (the user clicked it), rejected extraction rows included.
 */
export function renderCards(items, opts = {}) {
    const o = { actions: opts.actions !== false };
    return list(items).map((it) => renderCard(it, o)).join('');
}

/**
 * Every item on the page (chip "Show all", side panel). Rejected
 * extraction rows are hidden unless `showRejected` — hidden, never
 * dropped: the toggle says how many there are (CONSTITUTION Art. 3).
 */
export function renderList(items, opts = {}) {
    const all = list(items).filter((it) => it && typeof it === 'object');
    const rejected = all.filter((it) => it.kind === 'extraction' && it.reviewState === 'rejected');
    const shown = opts.showRejected ? all : all.filter((it) => !rejected.includes(it));
    const o = { actions: opts.actions !== false };
    const toggle = rejected.length
        ? `<button type="button" class="xr-ov-btn xr-ov-toggle-rejected" data-xr-ov-action="toggle-rejected">`
            + (opts.showRejected ? 'Hide rejected' : `Show rejected (${rejected.length})`) + '</button>'
        : '';
    const body = shown.length
        ? shown.map((it) => renderCard(it, o)).join('')
        : '<p class="xr-ov-empty">No X-Ray items to show for this page.</p>';
    return `<div class="xr-ov-list">${toggle}${body}</div>`;
}

/**
 * The note editor. `draft` is PREFILL ONLY (already validated by the
 * caller): `quote` renders as escaped text, `text` as the textarea's
 * escaped content. Saving is a user click handled by the card script.
 */
export function renderEditor(draft = {}) {
    const d = draft && typeof draft === 'object' ? draft : {};
    const quote = str(d.quote);
    const when = formatSeconds(d.seconds);
    return '<form class="xr-ov-editor" data-xr-ov-form="note">'
        + `<header class="xr-ov-card-head"><span class="xr-ov-kind">${d.id ? 'Edit X-Ray note' : 'New X-Ray note'}</span>`
        + (when ? `<span class="xr-ov-time">${esc(when)}</span>` : '')
        + '</header>'
        + (quote ? `<blockquote class="xr-ov-quote">${esc(quote)}</blockquote>` : '')
        + '<label class="xr-ov-label" for="xr-ov-note-text">Note (stays on this device)</label>'
        + `<textarea id="xr-ov-note-text" class="xr-ov-textarea" maxlength="${NOTE_MAXLENGTH}" rows="5">${esc(str(d.text))}</textarea>`
        + '<div class="xr-ov-actions">'
        + '<button type="submit" class="xr-ov-btn xr-ov-btn-primary" data-xr-ov-action="save">Save</button>'
        + '<button type="button" class="xr-ov-btn" data-xr-ov-action="cancel">Cancel</button>'
        + '</div>'
        + '<p class="xr-ov-status" role="status"></p>'
        + '</form>';
}

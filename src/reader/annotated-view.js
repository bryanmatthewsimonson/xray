// Margin S1 — the Annotated view's renderers (docs/MARGIN_DESIGN.md
// §3/§4). String renderers here are pure (guard-testable in node);
// hydrateAnnotatedView (DOM) joins below in Task 7. This module never
// imports from index.js and never touches the Reader's editable draft
// body element or state.htmlDraft — the annotated container is a
// read-only sibling.

import { createGroundingIndex } from '../shared/quote-grounding.js';
import { groundNotes, partitionSegments } from '../shared/annotations/segments.js';

const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const FAMILY_LABELS = Object.freeze({
    claim: 'Claims', extraction: 'Claim proposals', forensic: 'Forensic findings',
    audit: 'Audit evidence', prediction: 'Predictions', comment: 'Page comments'
});
export const FAMILY_ORDER = Object.freeze(['claim', 'extraction', 'forensic', 'prediction']);

const ACTION_LABELS = Object.freeze({
    locate: 'Show in text', assess: 'Assess', adjudicate: 'Adjudicate',
    edit: 'Edit', accept: 'Accept as claim…', dismiss: 'Dismiss'
});

export function renderStrip({ notes = [], visibility = {} } = {}) {
    if (notes.length === 0) {
        return `<div class="xr-ann-strip">
            <span class="xr-ann-zero">No notes yet — select any passage to add one</span>
            <span class="xr-ann-modelabel">Reading view — <button type="button" class="xr-ann-linkbtn" data-action="switch-reader">edit in Reader</button></span>
            <button type="button" class="xr-ann-help" data-action="legend" title="What am I looking at?">?</button>
        </div>`;
    }
    const byFamily = {};
    let anchored = 0;
    let paged = 0;
    for (const n of notes) {
        byFamily[n.family] = (byFamily[n.family] || 0) + 1;
        if (n.pageReason) paged += 1;
        else if (n.grounding) anchored += 1;
    }
    // Per-family chips only — never a summed insight total (§5.4
    // guard 2). Only populated families render a chip; chips are
    // toggles with their state visible (hide-with-disclosure).
    const chips = [...FAMILY_ORDER, 'audit', 'comment']
        .filter((f) => byFamily[f])
        .map((f) => {
            const on = visibility[f] !== false;
            return `<button type="button" class="xr-ann-chip${on ? '' : ' xr-ann-chip--off'}"
                data-family="${f}" aria-pressed="${on}">${esc(FAMILY_LABELS[f])} · ${byFamily[f]}</button>`;
        }).join('');
    return `<div class="xr-ann-strip">
        ${chips}
        <span class="xr-ann-coverage" title="Coverage — how many notes anchor to a passage vs sit at page level">${anchored} anchored · ${paged} page notes</span>
        <span class="xr-ann-modelabel">Reading view — <button type="button" class="xr-ann-linkbtn" data-action="switch-reader">edit in Reader</button></span>
        <button type="button" class="xr-ann-help" data-action="legend" title="What am I looking at?">?</button>
    </div>
    <div class="xr-ann-legend" data-role="legend" hidden>${legendHtml()}</div>`;
}

export function legendHtml() {
    return `<ol class="xr-ann-legend-list">
        <li>Tinted text has notes — click a tint to read them.</li>
        <li>A darker tint means several notes of one kind overlap there.</li>
        <li>Gutter marks: ● claims &amp; proposals, ▷ forensic, ▢ audit evidence — click one to jump.</li>
        <li>Select any text to add your own note.</li>
    </ol>`;
}

function subCardHtml(sub) {
    if (sub.kind === 'assessment') {
        const r = sub.record || {};
        const stance = (typeof r.stance === 'number') ? ('stance ' + (r.stance > 0 ? '+' : '') + r.stance) : 'no stance';
        return `<div class="xr-ann-sub xr-ann-sub--assessment"><span class="xr-ann-sub-kind">Assessment</span> — ${esc(stance)}${r.rationale ? ' · ' + esc(r.rationale) : ''}</div>`;
    }
    // Truth family — the ONLY template lawfully carrying reserved
    // vocabulary (§5.3); it renders inside .xr-ann-truth exclusively.
    const v = sub.record || {};
    return `<div class="xr-ann-truth"><span class="xr-ann-sub-kind">Verdict</span>: ${esc(v.verdict || '')}${v.standard_of_proof ? ' · standard: ' + esc(v.standard_of_proof) : ''}</div>`;
}

export function renderCard(note) {
    const actions = (note.actions || [])
        .map((a) => `<button type="button" class="xr-ann-act xr-ann-act--${esc(a)}" data-action="${esc(a)}" data-note="${esc(note.id)}">${esc(ACTION_LABELS[a] || a)}</button>`)
        .join('');
    const review = note.reviewState
        ? `<span class="xr-ann-review xr-ann-review--${esc(note.reviewState)}">${note.reviewState === 'open' ? 'Unreviewed' : note.reviewState === 'accepted' ? 'Accepted' : 'Dismissed'}</span>`
        : '';
    const reason = note.pageReason
        ? `<span class="xr-ann-reason">${esc(note.pageReason)}</span>` : '';
    return `<article class="xr-ann-card" data-note="${esc(note.id)}" data-family="${esc(note.family)}">
        <header class="xr-ann-card-head">${review}<span class="xr-ann-card-title">${esc(note.title)}</span>${reason}</header>
        ${note.quote && !note.pageReason ? `<blockquote class="xr-ann-quote" data-action="locate" data-note="${esc(note.id)}">${esc(note.quote)}</blockquote>` : ''}
        ${note.body ? `<p class="xr-ann-card-body">${esc(note.body)}</p>` : ''}
        ${(note.sub || []).map(subCardHtml).join('')}
        <footer class="xr-ann-card-actions">${actions}</footer>
    </article>`;
}

const byStart = (a, b) =>
    ((a.grounding && a.grounding.start) ?? Infinity) - ((b.grounding && b.grounding.start) ?? Infinity);

export function renderCardsPanel(notes = []) {
    const anchored = notes.filter((n) => !n.pageReason && n.grounding);
    const groups = FAMILY_ORDER
        .map((f) => ({ f, rows: anchored.filter((n) => n.family === f).sort(byStart) }))
        .filter((g) => g.rows.length)
        .map((g) => `<section class="xr-ann-group" data-family="${g.f}">
            <h3 class="xr-ann-group-title">${esc(FAMILY_LABELS[g.f])}</h3>
            ${g.rows.map(renderCard).join('')}
        </section>`).join('');
    // The audit family renders LAST inside its own fenced block —
    // never interleaved (the reader's visual firewall, MARGIN_DESIGN
    // §5.3 / index.html:119-131 carried forward; Task 6 guard).
    const auditRows = anchored.filter((n) => n.family === 'audit').sort(byStart);
    const auditGroup = auditRows.length
        ? `<section class="xr-ann-group xr-ann-group--audit" data-family="audit">
            <h3 class="xr-ann-group-title">${esc(FAMILY_LABELS.audit)}</h3>
            ${auditRows.map(renderCard).join('')}
        </section>` : '';
    return `<div class="xr-ann-panel">${groups}${auditGroup}</div>`;
}

export function renderPageNotes(notes = []) {
    const rows = notes.filter((n) => n.pageReason);
    if (!rows.length) return '';
    // The audit family stays fenced in EVERY layout (MARGIN_DESIGN
    // §5.3), not just the anchored cards panel — a note demoted to the
    // page lane must not interleave with other families here either.
    const nonAudit = rows.filter((n) => n.family !== 'audit');
    const auditRows = rows.filter((n) => n.family === 'audit');
    const auditGroup = auditRows.length
        ? `<section class="xr-ann-group xr-ann-group--audit" data-family="audit">
            <h3 class="xr-ann-group-title">${esc(FAMILY_LABELS.audit)}</h3>
            ${auditRows.map(renderCard).join('')}
        </section>` : '';
    return `<section class="xr-ann-pagenotes">
        <h3 class="xr-ann-group-title">Page notes · ${rows.length}</h3>
        ${nonAudit.map(renderCard).join('')}
        ${auditGroup}
    </section>`;
}

export function annotatedShellHtml({ title, bodyHtml }) {
    // The body container is read-only BY CONSTRUCTION — never
    // contenteditable, never synced back to any draft.
    return `<div class="xr-ann" id="xr-ann">
        <div class="xr-ann-striphost" data-role="striphost"></div>
        <div class="xr-ann-grid">
            <div class="xr-ann-rail" data-role="rail" aria-hidden="true"></div>
            <article class="xr-article xr-ann-article">
                <h1 class="xr-article__title">${esc(title || 'Untitled')}</h1>
                <div class="xr-ann-body" data-role="body" contenteditable="false"></div>
            </article>
            <aside class="xr-ann-side" data-role="side"></aside>
        </div>
    </div>`;
}

const MARK_SHAPES = Object.freeze({
    claim: 'dot', extraction: 'dot', prediction: 'dot',
    forensic: 'triangle', audit: 'square'
});

// Wrap each disjoint [start,end) segment of the body's textContent in
// a display-only span. Safe HERE and only here: this container is a
// read-only sibling — nothing syncs it back to any draft.
function wrapSegments(bodyEl, segments, notesById) {
    // hydrate expects a freshly-set body; refuse to double-wrap.
    if (bodyEl.querySelector('.xr-ann-seg')) return;
    let segIdx = 0;
    let offset = 0;
    const walker = document.createTreeWalker(bodyEl, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && segIdx < segments.length) {
        const seg = segments[segIdx];
        const nodeStart = offset;
        const nodeEnd = offset + node.nodeValue.length;
        if (seg.end <= nodeStart) { segIdx += 1; continue; }
        if (seg.start >= nodeEnd) { offset = nodeEnd; node = walker.nextNode(); continue; }
        // The segment intersects this text node — isolate the slice.
        const sliceStart = Math.max(seg.start, nodeStart) - nodeStart;
        const sliceEnd = Math.min(seg.end, nodeEnd) - nodeStart;
        let target = node;
        if (sliceStart > 0) target = node.splitText(sliceStart);
        if (sliceEnd - sliceStart < target.nodeValue.length) target.splitText(sliceEnd - sliceStart);
        const span = document.createElement('span');
        span.className = segClass(seg, notesById);
        span.dataset.ids = seg.ids.join(' ');
        span.setAttribute('tabindex', '0');
        target.parentNode.insertBefore(span, target);
        span.appendChild(target);
        offset = nodeStart + sliceEnd;
        walker.currentNode = target;
        node = walker.nextNode();
        if (seg.end <= offset) segIdx += 1;
    }
}

function segClass(seg, notesById) {
    const families = seg.ids.map((id) => (notesById.get(id) || {}).family);
    const cls = ['xr-ann-seg'];
    // Audit never tints the body (the firewall carrier is the rail);
    // a segment covered ONLY by audit notes stays visually silent.
    if (families.every((f) => f === 'audit')) cls.push('xr-ann-seg--silent');
    // Darker step where >=3 notes of ONE family overlap — never a
    // cross-family density number (§10 row 1).
    const perFamily = {};
    for (const f of families) perFamily[f] = (perFamily[f] || 0) + 1;
    if (Object.values(perFamily).some((c) => c >= 3)) cls.push('xr-ann-seg--dense');
    return cls.join(' ');
}

function placeRailMarkers(container, grounded) {
    const rail = container.querySelector('[data-role="rail"]');
    const body = container.querySelector('[data-role="body"]');
    if (!rail || !body) return;
    rail.innerHTML = '';
    const railTop = rail.getBoundingClientRect().top;
    for (const n of grounded) {
        if (!n.grounding || n.pageReason) continue;
        const first = body.querySelector(`.xr-ann-seg[data-ids~="${CSS.escape(n.id)}"]`);
        if (!first) continue;
        const mark = document.createElement('button');
        mark.type = 'button';
        mark.className = `xr-ann-mark xr-ann-mark--${MARK_SHAPES[n.family] || 'dot'}`;
        mark.dataset.note = n.id;
        mark.title = n.title;
        mark.style.top = Math.max(0, first.getBoundingClientRect().top - railTop) + 'px';
        rail.appendChild(mark);
    }
}

export function hydrateAnnotatedView(container, notes) {
    const body = container.querySelector('[data-role="body"]');
    const index = createGroundingIndex(body ? body.textContent : '');
    const grounded = groundNotes(notes, index);
    const notesById = new Map(grounded.map((n) => [n.id, n]));
    if (body) wrapSegments(body, partitionSegments(grounded), notesById);
    const striphost = container.querySelector('[data-role="striphost"]');
    if (striphost) striphost.innerHTML = renderStrip({ notes: grounded, visibility: {} });
    const side = container.querySelector('[data-role="side"]');
    if (side) side.innerHTML = renderCardsPanel(grounded) + renderPageNotes(grounded);
    placeRailMarkers(container, grounded);
    return { grounded };
}

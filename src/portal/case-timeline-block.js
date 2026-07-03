// Case timeline — CD.3 (docs/CASE_DOSSIER_DESIGN.md §3.3).
//
// The four-axis case timeline: a WORLD-TIME spine (when things happened,
// rendered as precision BANDS — a year-precision event is a year-wide
// band, never a fake day) with PUBLICATION / CAPTURE / JUDGMENT as
// toggleable overlays. The value no flat link folder has is the GAP
// CALLOUTS between axes — a story published before the event it
// describes, a ruling that changed after a world event, evidence
// captured long after it was published.
//
// World-time + judgment come from case-dossier.js (CD.1). Publication +
// capture are joined here from the portal library items the case view
// already holds: publication from the 30023 `published_at` tag, capture
// from the event `created_at`. All time math is UTC and deterministic.

import { el, svgEl, clear, truncate } from './dom.js';
import { assembleCaseDossier } from '../shared/case-dossier.js';

const DAY = 86400;

// A gap this wide between capture and publication reads as "late
// preservation" — a weaker archival claim worth flagging.
const LATE_CAPTURE_DAYS = 30;

export const TIMELINE_AXES = Object.freeze(['world', 'publication', 'capture', 'judgment']);
export const AXIS_LABELS = Object.freeze({
    world:       'World time',
    publication: 'Publication',
    capture:     'Capture',
    judgment:    'Judgment'
});

// ------------------------------------------------------------------
// Pure helpers (tested)
// ------------------------------------------------------------------

/**
 * The [start, end) band for a world-time event at its declared
 * precision — the no-false-precision rule made geometric. A year
 * precision spans the whole UTC year; exact collapses to a point.
 *
 * @param {number} at - epoch seconds
 * @param {string} precision - 'exact' | 'day' | 'month' | 'year'
 * @returns {{start: number, end: number}}
 */
export function precisionBand(at, precision) {
    if (!Number.isFinite(at)) return { start: 0, end: 0 };
    const d = new Date(at * 1000);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const day = d.getUTCDate();
    if (precision === 'year')  return { start: Date.UTC(y, 0, 1) / 1000,        end: Date.UTC(y + 1, 0, 1) / 1000 };
    if (precision === 'month') return { start: Date.UTC(y, m, 1) / 1000,        end: Date.UTC(y, m + 1, 1) / 1000 };
    if (precision === 'day')   return { start: Date.UTC(y, m, day) / 1000,      end: Date.UTC(y, m, day + 1) / 1000 };
    return { start: at, end: at };   // exact — a point
}

/** The 30023 original publication date (null for non-articles / no tag). */
export function publicationOf(item) {
    if (!item || !item.event || item.kind !== 30023) return null;
    const tag = (item.event.tags || []).find((t) => t[0] === 'published_at');
    const v = tag ? parseInt(tag[1], 10) : NaN;
    return Number.isFinite(v) ? v : null;
}

/**
 * Merge CD.1's world/judgment events with publication/capture events
 * derived from the case's library items into one axis-tagged series,
 * world events carrying precision bands. Deterministic ordering.
 *
 * @param {object} dossier - assembleCaseDossier output
 * @param {Array} caseItems - portal library items for this case
 * @returns {{events: Array, span: {start:number,end:number}|null, axis_counts: object}}
 */
export function caseTimeline(dossier, caseItems) {
    const events = [];

    for (const e of (dossier && dossier.timeline) || []) {
        if (e.axis === 'world' && e.at != null) {
            const band = precisionBand(e.at, e.precision);
            events.push({ ...e, start: band.start, end: band.end });
        } else if (e.at != null) {
            events.push({ ...e, start: e.at, end: e.at });   // judgment: a point
        }
    }

    for (const item of (Array.isArray(caseItems) ? caseItems : [])) {
        const pub = publicationOf(item);
        if (pub != null) {
            events.push({
                axis: 'publication', kind: 'article', at: pub, start: pub, end: pub,
                ref: item.id, label: item.title || item.url || ''
            });
        }
        if (Number.isFinite(item.created_at) && item.created_at > 0) {
            events.push({
                axis: 'capture', kind: 'capture', at: item.created_at,
                start: item.created_at, end: item.created_at,
                ref: item.id, label: item.title || item.url || ''
            });
        }
    }

    events.sort((a, b) => (a.start - b.start)
                       || (TIMELINE_AXES.indexOf(a.axis) - TIMELINE_AXES.indexOf(b.axis))
                       || (`${a.kind}:${a.ref}` < `${b.kind}:${b.ref}` ? -1 : 1));

    const axisCounts = {};
    let lo = Infinity, hi = -Infinity;
    for (const e of events) {
        axisCounts[e.axis] = (axisCounts[e.axis] || 0) + 1;
        if (e.start < lo) lo = e.start;
        if (e.end > hi) hi = e.end;
    }
    const span = events.length ? { start: lo, end: hi } : null;
    return { events, span, axis_counts: axisCounts };
}

/**
 * The gap callouts (§3.3) — the cross-axis facts a flat list can't show.
 * Joins publication dates (by article url) to the propositions' world
 * time, so each gap names a concrete article/proposition.
 *
 * @param {object} dossier - assembleCaseDossier output
 * @param {Array} caseItems - portal library items for this case
 * @returns {Array<{type, ref, detail}>}
 */
export function detectGaps(dossier, caseItems) {
    const gaps = [];
    // url → earliest publication date among its library items.
    const pubByUrl = new Map();
    const capByUrl = new Map();
    for (const item of (Array.isArray(caseItems) ? caseItems : [])) {
        const pub = publicationOf(item);
        if (pub != null && (!pubByUrl.has(item.url) || pub < pubByUrl.get(item.url))) {
            pubByUrl.set(item.url, pub);
        }
        if (Number.isFinite(item.created_at) && item.created_at > 0
            && (!capByUrl.has(item.url) || item.created_at < capByUrl.get(item.url))) {
            capByUrl.set(item.url, item.created_at);
        }
    }

    // published-before-occurred + story-changed-after-event, per proposition.
    for (const row of (dossier && dossier.propositions) || []) {
        const p = row.proposition;
        const url = row.claim && row.claim.source_url;
        if (p.occurred_at != null && url && pubByUrl.has(url)) {
            const pub = pubByUrl.get(url);
            if (pub < p.occurred_at) {
                gaps.push({
                    type: 'published-before-occurred', ref: p.id,
                    detail: `An article was published before the event this proposition describes — prediction, or the record predates the claim.`
                });
            }
        }
        if (row.superseded_count > 0 && p.occurred_at != null) {
            gaps.push({
                type: 'story-changed-after-event', ref: p.id,
                detail: `The ruling on a dated proposition was superseded — the story changed after the event.`
            });
        }
    }

    // capture-long-after-publication, per article url.
    for (const [url, pub] of pubByUrl) {
        const cap = capByUrl.get(url);
        if (cap != null && cap - pub > LATE_CAPTURE_DAYS * DAY) {
            const days = Math.round((cap - pub) / DAY);
            gaps.push({
                type: 'capture-long-after-publication', ref: url,
                detail: `Captured ${days} days after publication — a later, weaker archival claim.`
            });
        }
    }
    return gaps;
}

// ------------------------------------------------------------------
// DOM renderer
// ------------------------------------------------------------------

const AXIS_ROW_H = 22;
const SPINE_W = 640;

/**
 * Render the case timeline block into `host`. Async-loads the dossier
 * (like the CD.2 block) and merges it with the case's library items.
 *
 * @param {HTMLElement} host
 * @param {string} caseEntityId - local entity id
 * @param {Array} caseItems - portal library items for this case
 */
export function renderCaseTimelineBlock(host, caseEntityId, caseItems) {
    const block = el('div', 'xr-case-timeline');
    block.appendChild(el('p', 'xr-case-timeline__loading', 'Assembling timeline…'));
    host.appendChild(block);
    if (!caseEntityId) { clear(block); return block; }

    assembleCaseDossier(caseEntityId)
        .then((dossier) => {
            clear(block);
            paintTimeline(block, caseTimeline(dossier, caseItems), detectGaps(dossier, caseItems));
        })
        .catch(() => {
            clear(block);
            block.appendChild(el('p', 'xr-view__empty', 'Timeline unavailable.'));
        });
    return block;
}

function paintTimeline(block, model, gaps) {
    block.appendChild(el('h3', 'xr-case__heading', 'Timeline — four axes'));

    if (!model.span) {
        block.appendChild(el('p', 'xr-case-dossier__empty', 'No dated events in this case yet.'));
        return;
    }

    const { start, end } = model.span;
    const width = Math.max(1, end - start);
    const x = (t) => ((t - start) / width) * SPINE_W;

    // Axis visibility toggles — world is the spine, the rest overlay.
    const present = TIMELINE_AXES.filter((a) => model.axis_counts[a]);
    const visible = new Set(present);
    const controls = el('div', 'xr-case-timeline__axes');
    const boxes = {};
    for (const axis of present) {
        const label = el('label', `xr-case-timeline__axis xr-axis--${axis}`);
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.addEventListener('change', () => {
            if (cb.checked) visible.add(axis); else visible.delete(axis);
            draw();
        });
        boxes[axis] = cb;
        label.appendChild(cb);
        label.appendChild(el('span', null, `${AXIS_LABELS[axis]} (${model.axis_counts[axis]})`));
        controls.appendChild(label);
    }
    block.appendChild(controls);

    const svgHost = el('div', 'xr-case-timeline__spine');
    block.appendChild(svgHost);

    function draw() {
        clear(svgHost);
        const rows = TIMELINE_AXES.filter((a) => present.includes(a) && visible.has(a));
        const h = Math.max(AXIS_ROW_H, rows.length * AXIS_ROW_H + 8);
        const svg = svgEl('svg', {
            class: 'xr-case-timeline__svg',
            viewBox: `0 0 ${SPINE_W} ${h}`,
            preserveAspectRatio: 'none'
        });
        rows.forEach((axis, ri) => {
            const y = ri * AXIS_ROW_H + 4;
            for (const e of model.events) {
                if (e.axis !== axis) continue;
                const bandW = Math.max(2, x(e.end) - x(e.start));
                const rect = svgEl('rect', {
                    x: x(e.start), y,
                    width: e.axis === 'world' ? bandW : 3,
                    height: AXIS_ROW_H - 8,
                    class: `xr-tl-ev xr-tl-ev--${e.axis}`
                });
                const tip = svgEl('title', {});
                tip.textContent = `${AXIS_LABELS[axis]}: ${truncate(e.label || e.ref || '', 60)}`;
                rect.appendChild(tip);
                svg.appendChild(rect);
            }
        });
        svgHost.appendChild(svg);
    }
    draw();

    // Gap callouts — the cross-axis evidence.
    if (gaps.length > 0) {
        const list = el('ul', 'xr-case-timeline__gaps');
        list.appendChild(el('h4', 'xr-case-timeline__gaps-head', `Gap callouts (${gaps.length})`));
        for (const g of gaps) {
            const li = el('li', `xr-case-timeline__gap xr-gap--${g.type}`);
            li.appendChild(el('span', 'xr-chip', g.type));
            li.appendChild(el('span', 'xr-case-timeline__gap-detail', g.detail));
            list.appendChild(li);
        }
        block.appendChild(list);
    }
}

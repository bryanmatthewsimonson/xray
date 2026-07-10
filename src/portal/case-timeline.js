// Four-axis case timeline — CD.3 (docs/CASE_DOSSIER_DESIGN.md §3.3).
// The LOCAL structured analysis laid out over four time axes on one
// shared proportional scale: the world-time spine (with precision
// bands — a year-precision event is a year-wide band, never a fake
// point), plus publication / capture / judgment overlays, the undated
// tail (counted, never dropped), and the cross-axis gap callouts. A
// thin projection of the pure dossier timeline; the layout math is
// `layoutWorldSpine` (pure, tested) and the gap detection is
// `buildTimelineGaps` (pure, tested) — this file only paints.

import { el, svgEl, truncate } from './dom.js';
import { assembleCaseDossier } from '../shared/case-dossier.js';
import { layoutWorldSpine } from './timeline.js';
import { Utils } from '../shared/utils.js';

const VB_W = 600;
const PAD_LEFT = 78;
const TRACK_W = VB_W - PAD_LEFT - 8;
const LANES = [
    { axis: 'world', label: 'world', y: 14 },
    { axis: 'publication', label: 'published', y: 32 },
    { axis: 'capture', label: 'captured', y: 50 },
    { axis: 'judgment', label: 'judged', y: 68 }
];
const VB_H = 84;

function isoDay(at) {
    return new Date(at * 1000).toISOString().slice(0, 10);
}

function humanizeDuration(seconds) {
    const days = Math.round(Math.abs(seconds) / 86400);
    if (days >= 365) {
        const y = (days / 365);
        return `${y >= 10 ? Math.round(y) : y.toFixed(1)}y`;
    }
    if (days >= 30) return `${Math.round(days / 30)}mo`;
    return `${days}d`;
}

const GAP_TEXT = {
    'published-before-occurred': (g) =>
        `Source published before the event occurred — ${humanizeDuration(g.lead_seconds)} lead`,
    'capture-long-after-publication': (g) =>
        `Captured ${humanizeDuration(g.lag_seconds)} after publication — late preservation`,
    'story-changed-after-event': (g) =>
        `Ruling revised after the event — a chain of ${g.chain_length}`
};
const GAP_SEVERITY = {
    'published-before-occurred': 'danger',
    'capture-long-after-publication': 'warning',
    'story-changed-after-event': 'warning'
};

export function renderCaseTimeline(host, caseEntityId) {
    if (!caseEntityId) return;
    const block = el('div', 'xr-case__timeline');
    host.appendChild(block);

    (async () => {
        const caseDossier = await assembleCaseDossier(caseEntityId);
        const tl = caseDossier.timeline;
        if (tl.events.length === 0 && tl.gaps.length === 0 && tl.undated.length === 0) {
            block.remove();
            return;
        }

        block.appendChild(el('h4', 'xr-case__heading',
            'Four-axis timeline — world · publication · capture · judgment'));

        if (tl.events.length > 0) {
            // One shared time scale across every axis, so events line up.
            const laid = layoutWorldSpine(tl.events, TRACK_W);
            const byAxis = new Map();
            for (const e of laid) {
                (byAxis.get(e.axis) || byAxis.set(e.axis, []).get(e.axis)).push(e);
            }
            const svg = svgEl('svg', {
                class: 'xr-case__timeline-svg',
                viewBox: `0 0 ${VB_W} ${VB_H}`,
                preserveAspectRatio: 'none'
            });
            for (const lane of LANES) {
                svg.appendChild(svgEl('line', {
                    x1: PAD_LEFT, y1: lane.y + 5, x2: VB_W - 8, y2: lane.y + 5,
                    class: 'xr-tl-lane'
                }));
                const label = svgEl('text', { x: 4, y: lane.y + 8, class: 'xr-tl-lane-label' });
                label.textContent = lane.label;
                svg.appendChild(label);
                for (const e of byAxis.get(lane.axis) || []) {
                    const isWorld = lane.axis === 'world';
                    const w = isWorld ? Math.max(e.bandWidth, 2) : 2;
                    const rect = svgEl('rect', {
                        x: PAD_LEFT + e.x - (isWorld ? 0 : 1), y: lane.y,
                        width: w, height: 10,
                        class: isWorld ? 'xr-tl-band' : 'xr-tl-mark'
                    });
                    const tip = svgEl('title', {});
                    tip.textContent = `${isoDay(e.at)} (${e.precision}) · ${e.kind} · ${truncate(e.label || '', 60)}`;
                    rect.appendChild(tip);
                    svg.appendChild(rect);
                }
            }
            block.appendChild(svg);
        }

        if (tl.undated.length > 0) {
            block.appendChild(el('div', 'xr-inspector__mono',
                `${tl.undated.length} undated event(s) — kept, never placed on a fabricated date`));
        }

        // Gap callouts — the value-add no flat folder has.
        if (tl.gaps.length > 0) {
            block.appendChild(el('h4', 'xr-inspector__sub', `Gap callouts (${tl.gaps.length})`));
            for (const g of tl.gaps.slice(0, 12)) {
                const row = el('div', 'xr-case__gap');
                row.appendChild(el('span', `xr-case__gap-dot xr-case__gap-dot--${GAP_SEVERITY[g.kind] || 'warning'}`, ''));
                const text = (GAP_TEXT[g.kind] || (() => g.kind))(g);
                const detail = g.article_url ? truncate(g.article_url, 60) : '';
                row.appendChild(el('span', 'xr-case__gap-text', detail ? `${text} · ${detail}` : text));
                block.appendChild(row);
            }
            if (tl.gaps.length > 12) {
                block.appendChild(el('div', 'xr-inspector__mono', `… +${tl.gaps.length - 12} more`));
            }
        }
    })().catch((err) => {
        Utils.error('Case timeline render failed', err);
        block.remove();
    });
}

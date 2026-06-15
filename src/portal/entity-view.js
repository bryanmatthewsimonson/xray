// Portal entity spokes view (Phase 12.5, docs/PORTAL_DESIGN.md).
//
// Renders the ego graph from graph.js as hand-rolled SVG: spokes from
// the focused entity, claim nodes tinted by their latest assessment
// stance, ⚠ contradiction edges drawn hot (with ghost endpoints when
// the counterpart claim isn't in the ego set), pan via drag, zoom via
// wheel, locate-by-text pulse. Clicking an entity or case node
// refocuses; clicking a claim/account opens a detail card below.
//
// All state that must survive a re-render (expanded sectors, the
// detail selection) lives in the params the router passes back in.

import { el, svgEl, clear, truncate, shortKey } from './dom.js';
import { buildEgoGraph, layoutEgoGraph } from './graph.js';
import { kindLabel } from './library.js';
import { renderDossierBlock } from './dossier-block.js';

const SIZE = 720;

function stanceClass(node) {
    if (node.stance === null || node.stance === undefined) return '';
    if (node.stance > 0) return ' xr-gnode--agree';
    if (node.stance < 0) return ' xr-gnode--disagree';
    return ' xr-gnode--neutral';
}

const NODE_RADIUS = {
    claim: 7, 'sourced-claim': 7, entity: 9, case: 11, account: 8,
    'ghost-claim': 6, more: 9
};

/**
 * @param {HTMLElement} host
 * @param {object} params
 * @param {Array}   params.items         library items
 * @param {object}  params.entityIndex   pubkey → {entityId, name, type}
 * @param {string}  params.focusPubkey
 * @param {Set}     params.expandedTypes
 * @param {object}  params.callbacks     {onFocusEntity(pubkey), onOpenCase(pubkey),
 *                                        onBack(), onExpand(type)}
 */
export function renderEntityView(host, params) {
    const { items, entityIndex, focusPubkey, expandedTypes, callbacks, dossier, populationMean } = params;
    clear(host);

    const graph = buildEgoGraph(items, { focusPubkey, entityIndex, expandedTypes });
    const positions = layoutEgoGraph(graph, { size: SIZE });

    // --- header ---
    const head = el('div', 'xr-view__head');
    const back = el('button', 'xr-portal__btn xr-portal__btn--ghost', '← Library');
    back.type = 'button';
    back.addEventListener('click', () => callbacks.onBack());
    head.appendChild(back);
    const title = el('span', 'xr-view__title', graph.focus.name);
    title.title = focusPubkey;
    head.appendChild(title);
    head.appendChild(el('span', 'xr-badge', graph.focus.type));
    const c = graph.counts;
    head.appendChild(el('span', 'xr-view__counts',
        `${c.claimsAbout} claim(s) · ${c.entities} co-tagged · ${c.cases} case(s) · ${c.accounts} account(s)`
        + (c.claimsSourced ? ` · sourced ${c.claimsSourced}` : '')));

    const locate = el('input', 'xr-view__locate');
    locate.type = 'search';
    locate.placeholder = 'Locate in graph…';
    head.appendChild(locate);
    host.appendChild(head);

    // --- Audit dossier (13.7) — shared block, also on case views.
    renderDossierBlock(host, dossier, populationMean);

    if (graph.nodes.length === 0) {
        host.appendChild(el('p', 'xr-view__empty',
            'Nothing published references this entity yet — no claims, accounts, or cases found in the corpus.'));
        return;
    }

    // --- svg ---
    const view = { x: 0, y: 0, w: SIZE, h: SIZE };
    const svg = svgEl('svg', { class: 'xr-view__svg', viewBox: `0 0 ${SIZE} ${SIZE}` });
    const applyView = () => svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);

    const edgeLayer = svgEl('g', {});
    const nodeLayer = svgEl('g', {});
    svg.appendChild(edgeLayer);
    svg.appendChild(nodeLayer);

    for (const edge of graph.edges) {
        const from = positions[edge.from];
        const to = positions[edge.to];
        if (!from || !to) continue;
        const cls = edge.kind === 'relationship'
            ? (edge.warn ? 'xr-gedge xr-gedge--warn' : 'xr-gedge xr-gedge--rel')
            : (edge.kind === 'mention' ? 'xr-gedge xr-gedge--mention' : 'xr-gedge');
        const line = svgEl('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, class: cls });
        if (edge.relationship) {
            const tip = svgEl('title', {});
            tip.textContent = edge.relationship;
            line.appendChild(tip);
        }
        edgeLayer.appendChild(line);
        if (edge.warn) {
            const mark = svgEl('text', {
                x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 4,
                class: 'xr-gedge__warnmark', 'text-anchor': 'middle'
            });
            mark.textContent = '⚠';
            edgeLayer.appendChild(mark);
        }
    }

    const nodeEls = new Map();
    const drawNode = (id, nodeType, label, extraClass, titleText) => {
        const pos = positions[id];
        if (!pos) return null;
        const g = svgEl('g', { class: `xr-gnode xr-gnode--${nodeType}${extraClass || ''}`, 'data-id': id });
        const circle = svgEl('circle', { cx: pos.x, cy: pos.y, r: NODE_RADIUS[nodeType] || 7 });
        const tip = svgEl('title', {});
        tip.textContent = titleText || label;
        circle.appendChild(tip);
        g.appendChild(circle);
        const text = svgEl('text', {
            x: pos.x, y: pos.y + (NODE_RADIUS[nodeType] || 7) + 11,
            'text-anchor': 'middle', class: 'xr-gnode__label'
        });
        text.textContent = truncate(label, 28);
        g.appendChild(text);
        nodeLayer.appendChild(g);
        nodeEls.set(id, g);
        return g;
    };

    // focus node
    const focusG = svgEl('g', { class: 'xr-gnode xr-gnode--focus' });
    const fc = positions.focus;
    const focusCircle = svgEl('circle', { cx: fc.x, cy: fc.y, r: 16 });
    const focusTip = svgEl('title', {});
    focusTip.textContent = `${graph.focus.name} (${graph.focus.type})`;
    focusCircle.appendChild(focusTip);
    focusG.appendChild(focusCircle);
    const focusText = svgEl('text', { x: fc.x, y: fc.y + 32, 'text-anchor': 'middle', class: 'xr-gnode__label xr-gnode__label--focus' });
    focusText.textContent = truncate(graph.focus.name, 30);
    focusG.appendChild(focusText);
    nodeLayer.appendChild(focusG);

    for (const node of graph.nodes) {
        const extra = (node.nodeType === 'claim' || node.nodeType === 'sourced-claim')
            ? stanceClass(node) : '';
        const tip = node.labelCount
            ? `${node.label}\n${node.labelCount} label(s) on latest assessment`
            : node.label;
        drawNode(node.id, node.nodeType, node.label, extra, tip);
    }

    // --- interactions ---
    nodeLayer.addEventListener('click', (e) => {
        const g = e.target.closest && e.target.closest('.xr-gnode[data-id]');
        if (!g) return;
        const id = g.getAttribute('data-id');
        const node = graph.nodes.find((n) => n.id === id);
        if (!node) return;
        if (node.nodeType === 'entity') callbacks.onFocusEntity(node.pubkey);
        else if (node.nodeType === 'case') callbacks.onOpenCase(node.pubkey);
        else if (node.nodeType === 'more') callbacks.onExpand(node.forType);
        else renderDetail(node);
    });

    // Pan: drag anywhere that isn't a node; Zoom: wheel.
    let panFrom = null;
    svg.addEventListener('mousedown', (e) => {
        if (e.target.closest && e.target.closest('.xr-gnode')) return;
        panFrom = { mx: e.clientX, my: e.clientY, x: view.x, y: view.y };
        e.preventDefault();
    });
    svg.addEventListener('mousemove', (e) => {
        if (!panFrom) return;
        const scale = view.w / svg.clientWidth;
        view.x = panFrom.x - (e.clientX - panFrom.mx) * scale;
        view.y = panFrom.y - (e.clientY - panFrom.my) * scale;
        applyView();
    });
    svg.addEventListener('mouseup', () => { panFrom = null; });
    svg.addEventListener('mouseleave', () => { panFrom = null; });
    svg.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
        const newW = Math.min(SIZE * 3, Math.max(SIZE / 8, view.w * factor));
        const ratio = newW / view.w;
        view.x += (view.w - newW) / 2;
        view.y += (view.h - view.h * ratio) / 2;
        view.w = newW;
        view.h = view.h * ratio;
        applyView();
    }, { passive: false });

    // Locate: pulse the first matching node.
    locate.addEventListener('input', () => {
        const q = locate.value.trim().toLowerCase();
        for (const g of nodeEls.values()) g.classList.remove('xr-gnode--pulse');
        if (!q) return;
        const hit = graph.nodes.find((n) => (n.label || '').toLowerCase().includes(q));
        if (hit && nodeEls.has(hit.id)) nodeEls.get(hit.id).classList.add('xr-gnode--pulse');
    });

    host.appendChild(svg);

    // --- detail card (claim / account / ghost) ---
    const detail = el('div', 'xr-view__detail');
    host.appendChild(detail);

    function renderDetail(node) {
        clear(detail);
        if (node.item) {
            const card = el('div', 'xr-row');
            const headRow = el('div', 'xr-row__head');
            headRow.appendChild(el('span', 'xr-row__kind', kindLabel(node.item.kind)));
            headRow.appendChild(el('span', 'xr-row__title', truncate(node.item.title, 200)));
            if (node.item.created_at) {
                headRow.appendChild(el('span', 'xr-row__date',
                    new Date(node.item.created_at * 1000).toLocaleString()));
            }
            card.appendChild(headRow);
            if (node.item.sub) card.appendChild(el('div', 'xr-row__sub', truncate(node.item.sub, 300)));
            const details = el('details');
            details.appendChild(el('summary', null, 'Raw event'));
            const pre = el('pre');
            details.addEventListener('toggle', () => {
                if (details.open && !pre.textContent) pre.textContent = JSON.stringify(node.item.event, null, 2);
            });
            details.appendChild(pre);
            card.appendChild(details);
            detail.appendChild(card);
        } else if (node.nodeType === 'ghost-claim') {
            detail.appendChild(el('p', 'xr-view__empty',
                `Linked claim ${shortKey(node.coord.split(':')[1] || '')}:${node.coord.split(':')[2] || ''} isn't in this entity's spokes — `
                + 'it lives on another entity (or another author). Its relationship edge is shown so the contradiction stays visible.'));
        }
    }
}

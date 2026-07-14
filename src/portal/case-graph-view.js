// Local case entity graph render — Phase 20.3. Hand-rolled SVG over
// the pure `buildCaseGraph` / `layoutCaseGraph` output (case-graph.js):
// the case at center, its member articles, tagged/claimed entities,
// co-tag adjacency, and contradiction warn-edges. Mirrors the entity
// spokes view's pan/zoom/tooltip idiom; clicking an entity opens its
// dossier, an article opens it in the reader. Self-removes when the
// case has no member articles.

import { el, svgEl, truncate } from './dom.js';
import { buildCaseGraph, layoutCaseGraph } from '../shared/case-graph.js';
import { Utils } from '../shared/utils.js';

const SIZE = 720;
const NODE_RADIUS = { case: 14, article: 8, entity: 9, ghost: 6, more: 9, claim: 6 };

/**
 * @param {HTMLElement} host
 * @param {object} params
 * @param {object} params.data       collectCaseDossierData output
 * @param {object} params.callbacks  {onOpenEntityDossier(entityId), onOpenArticle(url)}
 */
export function renderCaseGraph(host, { data, callbacks = {} }) {
    const block = el('div', 'xr-cgraph');
    host.appendChild(block);

    let graph;
    try { graph = buildCaseGraph(data); }
    catch (err) { Utils.error('Case graph build failed', err); block.remove(); return; }

    if (!graph.nodes.some((n) => n.type === 'article')) { block.remove(); return; }

    const positions = layoutCaseGraph(graph, { size: SIZE });

    block.appendChild(el('h3', 'xr-case__heading', 'Case graph — articles, entities, and how they connect'));
    const c = graph.counts;
    block.appendChild(el('div', 'xr-view__dossier-line',
        `${c.articles} article${c.articles === 1 ? '' : 's'} · ${c.entities} entit${c.entities === 1 ? 'y' : 'ies'} · `
        + `${c.cotag_edges} co-tag link${c.cotag_edges === 1 ? '' : 's'} · ${c.contradictions} contradiction${c.contradictions === 1 ? '' : 's'}`));

    const view = { x: 0, y: 0, w: SIZE, h: SIZE };
    const svg = svgEl('svg', { class: 'xr-view__svg xr-cgraph__svg', viewBox: `0 0 ${SIZE} ${SIZE}` });
    const applyView = () => svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);

    const edgeLayer = svgEl('g', {});
    const nodeLayer = svgEl('g', {});
    svg.appendChild(edgeLayer);
    svg.appendChild(nodeLayer);

    const edgeClass = (kind) => {
        if (kind === 'contradiction') return 'xr-gedge xr-gedge--warn';
        if (kind === 'cotag') return 'xr-gedge xr-cgedge--cotag';
        if (kind === 'member') return 'xr-gedge xr-cgedge--member';
        if (kind === 'about' || kind === 'both') return 'xr-gedge xr-cgedge--about';
        return 'xr-gedge';
    };

    for (const edge of graph.edges) {
        const from = positions[edge.from];
        const to = positions[edge.to];
        if (!from || !to) continue;
        const line = svgEl('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, class: edgeClass(edge.kind) });
        if (edge.note || edge.kind === 'contradiction') {
            const tip = svgEl('title', {});
            tip.textContent = edge.note || 'contradiction';
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
    for (const node of graph.nodes) {
        const pos = positions[node.id];
        if (!pos) continue;
        const extra = node.type === 'article' && node.processed === false ? ' xr-cgnode--unprocessed' : '';
        const g = svgEl('g', { class: `xr-gnode xr-cgnode--${node.type}${extra}`, 'data-id': node.id });
        const circle = svgEl('circle', { cx: pos.x, cy: pos.y, r: NODE_RADIUS[node.type] || 7 });
        const tip = svgEl('title', {});
        tip.textContent = node.type === 'article' && node.processed === false
            ? `${node.label} (no claims yet)` : node.label;
        circle.appendChild(tip);
        g.appendChild(circle);
        const text = svgEl('text', {
            x: pos.x, y: pos.y + (NODE_RADIUS[node.type] || 7) + 11,
            'text-anchor': 'middle', class: 'xr-gnode__label'
        });
        text.textContent = truncate(node.label, 26);
        g.appendChild(text);
        nodeLayer.appendChild(g);
        nodeEls.set(node.id, g);
    }

    nodeLayer.addEventListener('click', (e) => {
        const g = e.target.closest && e.target.closest('.xr-gnode[data-id]');
        if (!g) return;
        const node = graph.nodes.find((n) => n.id === g.getAttribute('data-id'));
        if (!node) return;
        if (node.type === 'entity' && callbacks.onOpenEntityDossier) callbacks.onOpenEntityDossier(node.entityId);
        else if (node.type === 'case' && callbacks.onOpenEntityDossier) callbacks.onOpenEntityDossier(node.entityId);
        else if (node.type === 'article' && callbacks.onOpenArticle) callbacks.onOpenArticle(node.url);
    });

    // Pan + zoom (the entity-view idiom).
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

    const locate = el('input', 'xr-view__locate');
    locate.type = 'search';
    locate.placeholder = 'Locate in graph…';
    locate.addEventListener('input', () => {
        const q = locate.value.trim().toLowerCase();
        for (const g of nodeEls.values()) g.classList.remove('xr-gnode--pulse');
        if (!q) return;
        const hit = graph.nodes.find((n) => (n.label || '').toLowerCase().includes(q));
        if (hit && nodeEls.has(hit.id)) nodeEls.get(hit.id).classList.add('xr-gnode--pulse');
    });
    block.appendChild(locate);
    block.appendChild(svg);
}

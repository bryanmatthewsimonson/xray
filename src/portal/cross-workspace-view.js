// Cross-workspace view — Phase 28.6
// (docs/CASE_BOUND_WORKSPACES_KICKOFF.md §6 slice 6). The one
// deliberate window across workspace boundaries: every workspace with
// a bound case, side by side (P8), shared names as first-class
// cross-case edges. STRICTLY read-only — it renders from
// workspace-read.js snapshots and mutates nothing; opening an entity
// works only for the ACTIVE workspace (the others' dossiers live
// behind a workspace switch, and the view says so instead of silently
// crossing).

import { el, svgEl, clear, truncate } from './dom.js';
import { Utils } from '../shared/utils.js';
import { Workspaces } from '../shared/identity-profiles.js';
import { Storage } from '../shared/storage.js';
import { canonicalIdOf } from '../shared/entity-model.js';
import { readWorkspaceKey, readWorkspaceArticles } from '../shared/workspace-read.js';
import { buildCaseSlice, buildCrossCaseGraph, layoutCrossCaseGraph } from '../shared/cross-case-graph.js';

const NODE_RADIUS = { case: 14, entity: 9, more: 9 };

async function collectSlices() {
    const workspaces = await Workspaces.list();
    const slices = [];
    const excluded = [];
    for (const ws of workspaces) {
        if (!ws.case_entity_id) { excluded.push({ ws, why: 'no bound case' }); continue; }
        const entities = await readWorkspaceKey(ws.id, 'entities', {}) || {};
        const rootId = canonicalIdOf(ws.case_entity_id, entities);
        const root = entities[rootId];
        if (!root || root.type !== 'case') {
            excluded.push({ ws, why: 'bound case not found in its registry' });
            continue;
        }
        const [claims, articles] = await Promise.all([
            readWorkspaceKey(ws.id, 'article_claims', {}),
            readWorkspaceArticles(ws.id)
        ]);
        slices.push(buildCaseSlice({
            workspace: ws, caseEntity: root,
            entities, claims: claims || {}, articles
        }));
    }
    return { slices, excluded };
}

/**
 * @param {HTMLElement} host
 * @param {object} params
 * @param {object} params.callbacks  {onBack(), onOpenEntityDossier(entityId)}
 */
export function renderCrossWorkspaceView(host, { callbacks = {} } = {}) {
    clear(host);

    const head = el('div', 'xr-view__head');
    const back = el('button', 'xr-portal__btn xr-portal__btn--ghost', '← Library');
    back.type = 'button';
    back.addEventListener('click', () => callbacks.onBack && callbacks.onBack());
    head.appendChild(back);
    head.appendChild(el('span', 'xr-view__title', 'Across workspaces'));
    head.appendChild(el('span', 'xr-badge xr-badge--muted', 'read-only'));
    host.appendChild(head);

    host.appendChild(el('div', 'xr-case__explainer',
        'Every workspace with a bound case, side by side. A dashed edge marks a SHARED NAME — '
        + 'both corpora name the same entity name. That is a signal to investigate, not an identity '
        + 'assertion: each workspace keeps its own entity record and keys, and nothing here merges '
        + 'or writes anything.'));

    const body = el('div', 'xr-xws');
    host.appendChild(body);
    body.appendChild(el('div', 'xr-inspector__mono', 'Reading workspaces…'));

    (async () => {
        const [{ slices, excluded }, activeId] = await Promise.all([
            collectSlices(), Storage.activeWorkspaceId()
        ]);
        clear(body);

        if (excluded.length > 0) {
            body.appendChild(el('div', 'xr-view__dossier-line',
                'Not shown: ' + excluded.map((x) => `${x.ws.label} (${x.why})`).join(' · ')));
        }
        if (slices.length === 0) {
            body.appendChild(el('p', 'xr-view__empty',
                'No workspace has a bound case yet. Bind cases to workspaces in Settings ▸ Workspaces.'));
            return;
        }
        if (slices.length === 1) {
            body.appendChild(el('p', 'xr-view__empty',
                `Only "${slices[0].workspace.label}" has a bound case — there is nothing to compare `
                + 'across workspaces yet. The case view already graphs a single case.'));
            return;
        }

        const graph = buildCrossCaseGraph(slices);
        const { positions, extent } = layoutCrossCaseGraph(graph);
        const c = graph.counts;
        body.appendChild(el('div', 'xr-view__dossier-line',
            `${c.cases} cases · ${c.entities} entit${c.entities === 1 ? 'y' : 'ies'} shown`
            + (c.entities_dropped > 0 ? ` (+${c.entities_dropped} more not shown)` : '')
            + ` · ${c.shared_names} shared name${c.shared_names === 1 ? '' : 's'}`));

        const view = { x: 0, y: 0, w: extent.w, h: extent.h };
        const svg = svgEl('svg', { class: 'xr-view__svg xr-xws__svg', viewBox: `0 0 ${extent.w} ${extent.h}` });
        const applyView = () => svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
        const edgeLayer = svgEl('g', {});
        const nodeLayer = svgEl('g', {});
        svg.appendChild(edgeLayer);
        svg.appendChild(nodeLayer);

        for (const edge of graph.edges) {
            const from = positions[edge.from];
            const to = positions[edge.to];
            if (!from || !to) continue;
            const cls = edge.kind === 'shared' ? 'xr-gedge xr-xwsedge--shared' : 'xr-gedge xr-cgedge--member';
            const line = svgEl('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, class: cls });
            if (edge.kind === 'shared') {
                const tip = svgEl('title', {});
                tip.textContent = `Shared name: ${edge.name}`
                    + (edge.typeMismatch ? ' (typed differently in the two workspaces)' : '');
                line.appendChild(tip);
            }
            edgeLayer.appendChild(line);
        }

        for (const node of graph.nodes) {
            const pos = positions[node.id];
            if (!pos) continue;
            const sharedCls = node.shared ? ' xr-xwsnode--shared' : '';
            const g = svgEl('g', { class: `xr-gnode xr-cgnode--${node.type}${sharedCls}`, 'data-id': node.id });
            const circle = svgEl('circle', { cx: pos.x, cy: pos.y, r: NODE_RADIUS[node.type] || 7 });
            const tip = svgEl('title', {});
            if (node.type === 'case') {
                tip.textContent = `${node.label} — workspace "${node.wsLabel}"`
                    + ` · ${node.counts.articles} source${node.counts.articles === 1 ? '' : 's'}`;
            } else if (node.type === 'entity') {
                tip.textContent = `${node.label} (${node.subtype}) — on ${node.degree} source${node.degree === 1 ? '' : 's'}`
                    + (node.wsId === activeId
                        ? ' · click to open dossier'
                        : ` · in workspace "${wsLabelOf(graph, node.wsId)}" — switch workspaces to open`);
            } else {
                tip.textContent = node.label;
            }
            circle.appendChild(tip);
            g.appendChild(circle);
            const text = svgEl('text', {
                x: pos.x, y: pos.y + (NODE_RADIUS[node.type] || 7) + 11,
                'text-anchor': 'middle',
                class: node.type === 'case' ? 'xr-gnode__label xr-gnode__label--focus' : 'xr-gnode__label'
            });
            text.textContent = truncate(node.label, 26);
            g.appendChild(text);
            if (node.type === 'case') {
                const sub = svgEl('text', {
                    x: pos.x, y: pos.y + NODE_RADIUS.case + 24,
                    'text-anchor': 'middle', class: 'xr-gnode__label'
                });
                sub.textContent = truncate(node.wsLabel, 30);
                g.appendChild(sub);
            }
            nodeLayer.appendChild(g);
        }

        // Click opens dossiers ONLY inside the active workspace — the
        // boundary stays visible instead of being silently crossed.
        nodeLayer.addEventListener('click', (e) => {
            const g = e.target.closest && e.target.closest('.xr-gnode[data-id]');
            if (!g) return;
            const node = graph.nodes.find((n) => n.id === g.getAttribute('data-id'));
            if (!node || node.wsId !== activeId) return;
            if ((node.type === 'entity' || node.type === 'case') && callbacks.onOpenEntityDossier) {
                callbacks.onOpenEntityDossier(node.entityId);
            }
        });

        // Pan + zoom (the case-graph idiom).
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
            const newW = Math.min(extent.w * 3, Math.max(extent.w / 8, view.w * factor));
            const ratio = newW / view.w;
            view.x += (view.w - newW) / 2;
            view.y += (view.h - view.h * ratio) / 2;
            view.w = newW;
            view.h = view.h * ratio;
            applyView();
        }, { passive: false });

        body.appendChild(svg);

        // The shared names again as TEXT, side by side — the signal
        // should not require reading a graph.
        const sharedEdges = graph.edges.filter((e) => e.kind === 'shared');
        if (sharedEdges.length > 0) {
            const section = el('div', 'xr-xws__shared');
            section.appendChild(el('h3', 'xr-case__heading', `Shared names (${graph.counts.shared_names})`));
            const seen = new Set();
            const list = el('ul', 'xr-portal__list');
            for (const edge of sharedEdges) {
                if (seen.has(edge.name)) continue;
                seen.add(edge.name);
                const cases = graph.nodes
                    .filter((n) => n.type === 'entity' && n.label === edge.name)
                    .map((n) => wsLabelOf(graph, n.wsId));
                const li = el('li', 'xr-row');
                li.appendChild(el('span', 'xr-row__title', edge.name));
                li.appendChild(el('span', 'xr-row__sub',
                    [...new Set(cases)].join(' ↔ ')
                    + (edge.typeMismatch ? ' · typed differently per workspace' : '')));
                list.appendChild(li);
            }
            section.appendChild(list);
            body.appendChild(section);
        } else {
            body.appendChild(el('div', 'xr-view__dossier-line',
                'No shared names — these corpora are disjoint (which is itself worth knowing).'));
        }
    })().catch((err) => {
        Utils.error('Cross-workspace view failed', err);
        clear(body);
        body.appendChild(el('p', 'xr-view__empty', 'Could not read the workspaces.'));
    });
}

function wsLabelOf(graph, wsId) {
    const c = graph.nodes.find((n) => n.type === 'case' && n.wsId === wsId);
    return (c && c.wsLabel) || wsId;
}

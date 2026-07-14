// Local case entity graph — Phase 20.3.
//
// The portal's spokes graph (portal/graph.js) is built from PUBLISHED
// events only, so a case built by tagging local captures — the common
// path — renders empty. This module builds a graph from the LOCAL case
// dossier `data`: the case at the center, its member articles, the
// entities tagged on / claimed about those articles, entity↔entity
// co-tag adjacency, and the contradiction edges the dossier's knots
// already compute but nothing draws.
//
// Pure and deterministic: same `data` → deep-equal graph and layout.
// No storage, no DOM, no clock. `data` is `collectCaseDossierData`'s
// output (it carries `entitiesById`, `articles`, `orbit`, `links`,
// `membership_ids`, `case`). The renderer is portal/case-graph-view.js.

import { deriveArticleRows, buildKnots } from './case-dossier.js';
import { Utils } from './utils.js';

const TAU = Math.PI * 2;

/**
 * @param {object} data  collectCaseDossierData output
 * @param {object} [opts]
 * @param {boolean} [opts.includeClaims=false] add per-claim nodes
 * @param {number}  [opts.maxEntities=40]      entity node cap (degree-ranked)
 * @param {number}  [opts.maxCotagEdges=30]    co-tag edge cap (weight-ranked)
 * @returns {{nodes: Array, edges: Array, counts: object}}
 */
export function buildCaseGraph(data, { includeClaims = false, maxEntities = 40, maxCotagEdges = 30 } = {}) {
    const memberIds = new Set(data.membership_ids || [data.case.id]);
    const entitiesById = data.entitiesById || {};
    const nameOf = (id) => (entitiesById[id] && entitiesById[id].name) || id;
    const typeOf = (id) => (entitiesById[id] && entitiesById[id].type) || 'entity';

    const { rows } = deriveArticleRows(data);

    // Archive record lookup by normalized url, for the tagged entities.
    const recByUrl = new Map();
    for (const rec of data.articles || []) {
        if (rec && rec.url) recByUrl.set(Utils.normalizeUrl(rec.url), rec);
    }

    // Per-article entity set: tagged (record entities in the member
    // family) ∪ claimed (orbit claim about/source on this row), minus
    // the case itself. This set drives the tag/about edges AND the
    // co-tag weights.
    const articleNodes = [];
    const entityIds = new Set();
    const articleEntitySets = new Map();   // article node id → Set<entityId>
    const tagPairs = new Set();            // `${url} ${entityId}` present-as-tag
    const aboutWeight = new Map();         // `${url} ${entityId}` → claim count

    for (const row of rows) {
        const aid = `article:${row.url}`;
        articleNodes.push({
            id: aid, type: 'article', url: row.url,
            label: row.title || hostOf(row.url),
            processed: row.processed !== false
        });
        const set = new Set();
        articleEntitySets.set(aid, set);

        const rec = recByUrl.get(row.url);
        for (const e of (rec && rec.article && rec.article.entities) || []) {
            if (!e || !e.entity_id || e.entity_id === data.case.id) continue;
            set.add(e.entity_id);
            entityIds.add(e.entity_id);
            tagPairs.add(`${row.url} ${e.entity_id}`);
        }
        for (const c of row.claims || []) {
            const refs = [...(c.about || []), ...(c.source ? [c.source] : [])];
            for (const id of refs) {
                if (!id || id === data.case.id) continue;
                set.add(id);
                entityIds.add(id);
                const k = `${row.url} ${id}`;
                aboutWeight.set(k, (aboutWeight.get(k) || 0) + 1);
            }
        }
    }

    // Entity degree = number of member articles it appears on. Rank,
    // cap, and collect an overflow marker.
    const degree = new Map();
    for (const set of articleEntitySets.values()) {
        for (const id of set) degree.set(id, (degree.get(id) || 0) + 1);
    }
    const rankedEntities = [...entityIds].sort((a, b) =>
        (degree.get(b) || 0) - (degree.get(a) || 0) || (a < b ? -1 : a > b ? 1 : 0));
    const keptEntityIds = new Set(rankedEntities.slice(0, maxEntities));
    const droppedEntities = rankedEntities.length - keptEntityIds.size;

    const nodes = [{ id: 'case', type: 'case', label: data.case.name, entityId: data.case.id }];
    for (const n of articleNodes.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) nodes.push(n);
    for (const id of [...keptEntityIds].sort()) {
        nodes.push({ id: `entity:${id}`, type: 'entity', entityId: id, label: nameOf(id), subtype: typeOf(id) });
    }
    if (droppedEntities > 0) {
        nodes.push({ id: 'more:entity', type: 'more', label: `+${droppedEntities} more`, count: droppedEntities });
    }

    const edges = [];
    // case → each member article (membership spine).
    for (const a of articleNodes) edges.push({ id: `member:${a.url}`, from: 'case', to: a.id, kind: 'member' });

    // article ↔ entity: tag and/or about (one edge per pair, kind merged).
    for (const a of articleNodes) {
        const set = articleEntitySets.get(a.id);
        for (const id of [...set].sort()) {
            if (!keptEntityIds.has(id)) continue;
            const key = `${a.url} ${id}`;
            const isTag = tagPairs.has(key);
            const w = aboutWeight.get(key) || 0;
            const kind = isTag && w > 0 ? 'both' : isTag ? 'tag' : 'about';
            edges.push({ id: `ae:${a.url} ${id}`, from: a.id, to: `entity:${id}`, kind, weight: Math.max(1, w) });
        }
    }

    // entity ↔ entity co-tag: weight = shared member articles.
    const cotag = new Map();   // `${idA} ${idB}` (sorted) → weight
    for (const set of articleEntitySets.values()) {
        const present = [...set].filter((id) => keptEntityIds.has(id)).sort();
        for (let i = 0; i < present.length; i++) {
            for (let j = i + 1; j < present.length; j++) {
                const k = `${present[i]} ${present[j]}`;
                cotag.set(k, (cotag.get(k) || 0) + 1);
            }
        }
    }
    const cotagRanked = [...cotag.entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .slice(0, maxCotagEdges);
    for (const [k, w] of cotagRanked) {
        const [x, y] = k.split(' ');
        edges.push({ id: `cotag:${k}`, from: `entity:${x}`, to: `entity:${y}`, kind: 'cotag', weight: w });
    }

    // Contradiction edges (from the dossier knots), mapped from claim
    // refs to the article nodes their source_urls resolve to. Endpoints
    // with no member article become ghost nodes.
    const knots = buildKnots(data);
    const urlOfRef = (ref) => {
        const rec = data.claimsById && data.claimsById[ref];
        const u = rec && rec.source_url ? Utils.normalizeUrl(rec.source_url) : '';
        return u && rows.some((r) => r.url === u) ? u : null;
    };
    const ghostSeen = new Set();
    const contraPairs = new Set();
    for (const knot of knots.contradictions || []) {
        for (const e of knot.edges || []) {
            const su = urlOfRef(e.source_ref);
            const tu = urlOfRef(e.target_ref);
            const endpoint = (u, ref) => {
                if (u) return `article:${u}`;
                const gid = `ghost:${ref}`;
                if (!ghostSeen.has(gid)) {
                    ghostSeen.add(gid);
                    nodes.push({ id: gid, type: 'ghost', label: 'off-corpus claim', ref });
                }
                return gid;
            };
            const from = endpoint(su, e.source_ref);
            const to = endpoint(tu, e.target_ref);
            if (from === to) continue;
            const pk = [from, to].sort().join(' ');
            if (contraPairs.has(pk)) continue;
            contraPairs.add(pk);
            edges.push({ id: `contra:${pk}`, from, to, kind: 'contradiction', warn: true, note: e.note || '' });
        }
    }

    // Optional per-claim nodes (off by default; a denser view).
    if (includeClaims) {
        for (const row of rows) {
            for (const c of row.claims || []) {
                const cid = `claim:${c.id}`;
                const text = c.text || '';
                nodes.push({ id: cid, type: 'claim', label: text.length > 60 ? text.slice(0, 57) + '…' : text, claimId: c.id });
                edges.push({ id: `ca:${c.id}`, from: `article:${row.url}`, to: cid, kind: 'claim' });
            }
        }
    }

    return {
        nodes,
        edges,
        counts: {
            articles:       articleNodes.length,
            entities:       keptEntityIds.size,
            entities_dropped: droppedEntities,
            tag_edges:      edges.filter((e) => e.kind === 'tag' || e.kind === 'both').length,
            cotag_edges:    cotagRanked.length,
            contradictions: contraPairs.size
        }
    };
}

function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url || ''; }
}

// Ring radii per node type (fraction of the layout size).
const RINGS = { article: 0.30, entity: 0.52, ghost: 0.62, claim: 0.40, more: 0.56 };

/**
 * Deterministic concentric layout: the case at center, then a ring per
 * node type sorted by id, with a small alternating radial stagger so
 * adjacent labels don't sit exactly on one circle (the ego-graph
 * idiom). No physics.
 *
 * @returns {Object<string,{x:number,y:number}>} including 'case'
 */
export function layoutCaseGraph(graph, { size = 720 } = {}) {
    const cx = size / 2;
    const cy = size / 2;
    const positions = { case: { x: cx, y: cy } };

    const byType = new Map();
    for (const node of graph.nodes) {
        if (node.id === 'case') continue;
        const t = node.type === 'claim' ? 'claim' : node.type;
        (byType.get(t) || byType.set(t, []).get(t)).push(node);
    }
    // Stable ring order so radii don't reshuffle between builds.
    const order = ['article', 'entity', 'more', 'claim', 'ghost'];
    for (const t of order) {
        const nodes = (byType.get(t) || []).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        const baseR = RINGS[t] || 0.5;
        nodes.forEach((node, i) => {
            const angle = ((i + 0.5) / nodes.length) * TAU;
            const stagger = (i % 2 === 0 ? 0 : 0.045);
            const r = (baseR + stagger) * size;
            positions[node.id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
        });
    }
    return positions;
}

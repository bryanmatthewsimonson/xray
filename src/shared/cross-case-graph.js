// Cross-workspace case graph — Phase 28.6
// (docs/CASE_BOUND_WORKSPACES_KICKOFF.md §6 slice 6; the prior
// kickoff's §3.5). The deliberate, read-only view across workspaces:
// one node per bound case, each case's tagged/claimed entities beside
// it, and SHARED entities — the same name appearing in two corpora —
// as first-class cross-case edges.
//
// Sharing is a NAME MATCH, surfaced as signal to investigate, never an
// identity assertion: workspaces hold separate entity records with
// separate derived keys (kickoff §5.1), and this module merges
// nothing — the cases render side by side (P8), the edge just says
// "these two corpora both name this". A shared entity is exactly the
// thing a hard partition would delete, so the per-case entity cap
// NEVER drops one.
//
// Pure and deterministic like case-graph.js: same slices → deep-equal
// graph and layout. No storage, no DOM, no clock. Callers assemble the
// slices with workspace-read.js (the portal's cross-workspace view).

import { canonicalIdOf, normalizeName } from './entity-model.js';
import { Utils } from './utils.js';

/**
 * One workspace's member/entity math — the 20.1 union (tag ∪ claim)
 * computed PURELY over injected data, mirroring memberUrlSets /
 * buildCaseGraph without touching the active workspace's models.
 *
 * @param {object} input
 * @param {{id:string,label:string}} input.workspace
 * @param {object} input.caseEntity  the bound case's record (any family member)
 * @param {object} input.entities    id → record (that workspace's registry)
 * @param {object} input.claims      id → claim
 * @param {Array}  input.articles    that workspace's archive records
 * @returns {{workspace, kase:{id,name}, counts:{articles:number,claims:number},
 *            entities: Map<string,{id,name,type,degree}>}}
 */
export function buildCaseSlice({ workspace, caseEntity, entities = {}, claims = {}, articles = [] }) {
    const rootId = canonicalIdOf(caseEntity.id, entities);
    const root = entities[rootId] || caseEntity;
    const familyIds = new Set(Object.values(entities)
        .filter((rec) => rec && rec.id && canonicalIdOf(rec.id, entities) === rootId)
        .map((rec) => rec.id));
    if (familyIds.size === 0) familyIds.add(caseEntity.id);

    // Member urls: tagged with a family member ∪ claimed about one.
    const tagUrls = new Set();
    for (const rec of articles) {
        if (!rec || !rec.url) continue;
        const tagged = ((rec.article && rec.article.entities) || [])
            .some((e) => e && familyIds.has(e.entity_id));
        if (tagged) tagUrls.add(Utils.normalizeUrl(rec.url));
    }
    const claimsByUrl = new Map();   // member-relevant claims, keyed by url
    const claimUrls = new Set();
    let memberClaims = 0;
    for (const c of Object.values(claims)) {
        if (!c || !c.source_url) continue;
        const url = Utils.normalizeUrl(c.source_url);
        if ((c.about || []).some((id) => familyIds.has(id))) claimUrls.add(url);
        (claimsByUrl.get(url) || claimsByUrl.set(url, []).get(url)).push(c);
    }
    const memberUrls = new Set([...tagUrls, ...claimUrls]);

    // Entity degree = member articles the entity appears on (record tag
    // or claim about/source ref), the case family itself excluded —
    // the buildCaseGraph definition.
    const recByUrl = new Map();
    for (const rec of articles) {
        if (rec && rec.url) recByUrl.set(Utils.normalizeUrl(rec.url), rec);
    }
    const degree = new Map();
    for (const url of memberUrls) {
        const onThis = new Set();
        const rec = recByUrl.get(url);
        for (const e of ((rec && rec.article && rec.article.entities) || [])) {
            if (e && e.entity_id && !familyIds.has(e.entity_id)) onThis.add(e.entity_id);
        }
        for (const c of claimsByUrl.get(url) || []) {
            memberClaims++;
            for (const id of [...(c.about || []), ...(c.source ? [c.source] : [])]) {
                if (id && !familyIds.has(id)) onThis.add(id);
            }
        }
        for (const id of onThis) degree.set(id, (degree.get(id) || 0) + 1);
    }

    const entityMap = new Map();
    for (const [id, d] of degree) {
        const rec = entities[id];
        entityMap.set(id, {
            id,
            name: (rec && rec.name) || id,
            type: (rec && rec.type) || 'entity',
            degree: d
        });
    }

    return {
        workspace: { id: workspace.id, label: workspace.label || workspace.id },
        kase: { id: rootId, name: root.name || caseEntity.name || rootId },
        counts: { articles: memberUrls.size, claims: memberClaims },
        entities: entityMap
    };
}

const byDegreeThenName = (a, b) =>
    b.degree - a.degree
    || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The multi-case root. Nodes: one case per slice + each case's kept
 * entities (+ a per-case overflow marker). Edges: case→entity
 * membership spokes, and `shared` entity↔entity edges across cases on
 * a normalized-name match. Shared entities are the signal, so the
 * per-case cap keeps them unconditionally; only unshared tail entities
 * drop into the overflow marker.
 *
 * @param {Array} slices  buildCaseSlice outputs, caller order preserved
 * @param {object} [opts]
 * @param {number} [opts.maxEntitiesPerCase=12]
 * @returns {{nodes:Array, edges:Array, counts:object}}
 */
export function buildCrossCaseGraph(slices, { maxEntitiesPerCase = 12 } = {}) {
    // Name-match keys per slice (a slice can hold several distinct
    // records under one normalized name — deliberate non-merge; the
    // highest-degree one carries that slice's end of the shared edge).
    const keysBySlice = slices.map((s) => {
        const byKey = new Map();
        for (const ent of s.entities.values()) {
            const key = normalizeName(ent.name);
            if (!key) continue;
            (byKey.get(key) || byKey.set(key, []).get(key)).push(ent);
        }
        for (const list of byKey.values()) list.sort(byDegreeThenName);
        return byKey;
    });
    const keyCount = new Map();
    for (const byKey of keysBySlice) {
        for (const key of byKey.keys()) keyCount.set(key, (keyCount.get(key) || 0) + 1);
    }
    const sharedKeys = new Set([...keyCount.entries()].filter(([, n]) => n >= 2).map(([k]) => k));

    const nodes = [];
    const edges = [];
    let keptTotal = 0;
    let droppedTotal = 0;

    for (const s of slices) {
        const wsId = s.workspace.id;
        nodes.push({
            id: `case:${wsId}`, type: 'case', wsId, wsLabel: s.workspace.label,
            entityId: s.kase.id, label: s.kase.name,
            counts: { articles: s.counts.articles, claims: s.counts.claims }
        });
        const ranked = [...s.entities.values()].sort(byDegreeThenName);
        const kept = [];
        let dropped = 0;
        for (const ent of ranked) {
            const shared = sharedKeys.has(normalizeName(ent.name));
            if (shared || kept.length < maxEntitiesPerCase) kept.push({ ent, shared });
            else dropped++;
        }
        for (const { ent, shared } of kept.sort((a, b) => (a.ent.id < b.ent.id ? -1 : a.ent.id > b.ent.id ? 1 : 0))) {
            nodes.push({
                id: `entity:${wsId}:${ent.id}`, type: 'entity', wsId,
                entityId: ent.id, label: ent.name, subtype: ent.type,
                degree: ent.degree, shared
            });
            edges.push({
                id: `member:${wsId}:${ent.id}`, from: `case:${wsId}`,
                to: `entity:${wsId}:${ent.id}`, kind: 'member', weight: ent.degree
            });
        }
        if (dropped > 0) {
            nodes.push({ id: `more:${wsId}`, type: 'more', wsId, label: `+${dropped} more`, count: dropped });
        }
        keptTotal += kept.length;
        droppedTotal += dropped;
    }

    // Shared edges: each cross-case slice pair naming the key, endpoint
    // = that slice's highest-degree record for the name.
    let sharedEdges = 0;
    for (const key of [...sharedKeys].sort()) {
        const present = [];
        slices.forEach((s, i) => {
            const list = keysBySlice[i].get(key);
            if (list && list.length) present.push({ wsId: s.workspace.id, ent: list[0] });
        });
        for (let a = 0; a < present.length; a++) {
            for (let b = a + 1; b < present.length; b++) {
                const A = present[a];
                const B = present[b];
                edges.push({
                    id: `shared:${key}:${A.wsId}:${B.wsId}`,
                    from: `entity:${A.wsId}:${A.ent.id}`,
                    to: `entity:${B.wsId}:${B.ent.id}`,
                    kind: 'shared', match: 'name', name: A.ent.name,
                    typeMismatch: A.ent.type !== B.ent.type
                });
                sharedEdges++;
            }
        }
    }

    return {
        nodes,
        edges,
        counts: {
            cases: slices.length,
            entities: keptTotal,
            entities_dropped: droppedTotal,
            shared_names: sharedKeys.size,
            shared_edges: sharedEdges
        }
    };
}

/**
 * Side-by-side layout (P8): one column per case in slice order, the
 * case node at each column's center with its entities on a ring around
 * it, the overflow marker at the column's foot. Shared edges span the
 * gap between columns. Deterministic, no physics.
 *
 * @returns {{positions: Object<string,{x,y}>, extent: {w:number, h:number}}}
 */
export function layoutCrossCaseGraph(graph, { colWidth = 460, height = 640 } = {}) {
    const TAU = Math.PI * 2;
    const caseNodes = graph.nodes.filter((n) => n.type === 'case');
    const colOf = new Map(caseNodes.map((n, i) => [n.wsId, i]));
    const positions = {};

    for (const n of caseNodes) {
        const i = colOf.get(n.wsId);
        positions[n.id] = { x: colWidth * (i + 0.5), y: height * 0.46 };
    }
    for (const n of caseNodes) {
        const i = colOf.get(n.wsId);
        const cx = colWidth * (i + 0.5);
        const cy = height * 0.46;
        const ring = graph.nodes
            .filter((m) => m.type === 'entity' && m.wsId === n.wsId)
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const baseR = colWidth * 0.32;
        ring.forEach((m, j) => {
            const angle = ((j + 0.5) / ring.length) * TAU - Math.PI / 2;
            const r = baseR + (j % 2 === 0 ? 0 : colWidth * 0.045);
            positions[m.id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
        });
        const more = graph.nodes.find((m) => m.type === 'more' && m.wsId === n.wsId);
        if (more) positions[more.id] = { x: cx, y: height - 28 };
    }

    return { positions, extent: { w: colWidth * Math.max(1, caseNodes.length), h: height } };
}

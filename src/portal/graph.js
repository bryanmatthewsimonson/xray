// Portal ego graph (Phase 12.5, docs/PORTAL_DESIGN.md).
//
// The signed-off graph design: an entity-centric SPOKES view, not a
// free-floating force graph. One focused entity at the center;
// one-hop ring nodes grouped by type; deterministic radial layout
// (same data ⇒ same picture, no physics to tune). Pure module — the
// SVG lives in entity-view.js.
//
// Node sources, all from library items:
//   claim          — 30040 whose `p …about` includes the focus pubkey
//   sourced-claim  — 30040 whose `p …source` includes it
//   entity         — co-tagged about-entities on those claims (local registry)
//   case           — case entities clustering those claims
//   account        — 32126 whose linked-entity is the focus entity id
//   ghost-claim    — a 30055 endpoint outside the visible claim set;
//                    rendered so a ⚠ contradiction is never hidden
//   more           — per-type overflow ("+K more"), expandable
//
// Assessments don't become nodes — they DECORATE their claim (stance,
// label count), newest per coordinate wins.

const TAU = Math.PI * 2;

function pTagRoles(event, pubkey) {
    const roles = new Set();
    for (const t of (event.tags || [])) {
        if (t[0] === 'p' && t[1] === pubkey) roles.add(t[3] || '');
    }
    return roles;
}

function newestFirst(a, b) { return b.created_at - a.created_at; }

/**
 * @param {Array<object>} items       library items (buildItems output)
 * @param {object} opts
 * @param {string} opts.focusPubkey   the centered entity's pubkey
 * @param {object} opts.entityIndex   pubkey → {entityId, name, type}
 * @param {Set<string>} [opts.expandedTypes]  sectors the user expanded
 * @param {number} [opts.sectorCap=24]
 * @returns {{focus, nodes: Array, edges: Array, counts: object}}
 */
export function buildEgoGraph(items, { focusPubkey, entityIndex = {}, expandedTypes = new Set(), sectorCap = 24 } = {}) {
    const list = Array.isArray(items) ? items : [];
    const known = entityIndex[focusPubkey];
    const profileItem = list.find((i) => i.kind === 0 && i.event.pubkey === focusPubkey) || null;
    let profileName = '';
    if (profileItem) {
        try { profileName = JSON.parse(profileItem.event.content || '{}').name || ''; } catch (_) { /* ignore */ }
    }
    const focus = {
        pubkey: focusPubkey,
        name: (known && known.name) || profileName || focusPubkey.slice(0, 12) + '…',
        type: (known && known.type) || 'entity',
        entityId: (known && known.entityId) || null,
        profileItem
    };

    const claimsAbout = [];
    const claimsSourced = [];
    for (const item of list) {
        if (item.typeKey !== 'claim') continue;
        const roles = pTagRoles(item.event, focusPubkey);
        if (roles.has('about') || roles.has('')) claimsAbout.push(item);
        else if (roles.has('source')) claimsSourced.push(item);
    }
    claimsAbout.sort(newestFirst);
    claimsSourced.sort(newestFirst);

    const accounts = list
        .filter((i) => i.typeKey === 'account' && focus.entityId && i.linkedEntityId === focus.entityId)
        .sort(newestFirst);

    // Latest assessment per claim coordinate.
    const assessmentByCoord = new Map();
    for (const item of list) {
        if (item.typeKey !== 'assessment' || !item.claimCoord) continue;
        const seen = assessmentByCoord.get(item.claimCoord);
        if (!seen || item.created_at > seen.created_at) assessmentByCoord.set(item.claimCoord, item);
    }

    // Co-tagged entities + containing cases, counted across the about-claims.
    const coTagged = new Map(); // pubkey → {entity, count}
    const caseNames = new Map(); // name → count
    for (const claim of claimsAbout) {
        for (const t of (claim.event.tags || [])) {
            if (t[0] !== 'p' || t[1] === focusPubkey) continue;
            const ent = entityIndex[t[1]];
            if (!ent) continue;
            if (ent.type === 'case') continue; // cases get their own ring via item.cases
            const cur = coTagged.get(t[1]) || { entity: ent, pubkey: t[1], count: 0 };
            cur.count++;
            coTagged.set(t[1], cur);
        }
        for (const name of claim.cases) caseNames.set(name, (caseNames.get(name) || 0) + 1);
    }
    const casePubkeyByName = {};
    for (const [pk, ent] of Object.entries(entityIndex)) {
        if (ent.type === 'case') casePubkeyByName[ent.name] = pk;
    }

    const nodes = [];
    const edges = [];
    const nodeIds = new Set();
    const addNode = (node) => {
        if (nodeIds.has(node.id)) return false;
        nodeIds.add(node.id);
        nodes.push(node);
        return true;
    };

    const capList = (typeKey, fullList) =>
        expandedTypes.has(typeKey) ? fullList : fullList.slice(0, sectorCap);

    // --- claims about the focus ---
    const keptClaims = capList('claim', claimsAbout);
    const claimNodeByCoord = new Map();
    for (const item of keptClaims) {
        const id = `claim:${item.claimCoord || item.id}`;
        const assessment = item.claimCoord ? assessmentByCoord.get(item.claimCoord) : null;
        addNode({
            id, nodeType: 'claim', label: item.title, item,
            stance: assessment ? assessment.stance : null,
            labelCount: assessment ? assessment.labelCount : 0
        });
        if (item.claimCoord) claimNodeByCoord.set(item.claimCoord, id);
        edges.push({ from: 'focus', to: id, kind: 'spoke' });
    }
    if (claimsAbout.length > keptClaims.length) {
        addNode({ id: 'more:claim', nodeType: 'more', forType: 'claim', label: `+${claimsAbout.length - keptClaims.length} more` });
        edges.push({ from: 'focus', to: 'more:claim', kind: 'spoke' });
    }

    // --- claims the focus is the source of ---
    const keptSourced = capList('sourced-claim', claimsSourced);
    for (const item of keptSourced) {
        const id = `claim:${item.claimCoord || item.id}`;
        if (!addNode({ id, nodeType: 'sourced-claim', label: item.title, item, stance: null, labelCount: 0 })) continue;
        if (item.claimCoord) claimNodeByCoord.set(item.claimCoord, id);
        edges.push({ from: 'focus', to: id, kind: 'spoke', role: 'source' });
    }
    if (claimsSourced.length > keptSourced.length) {
        addNode({ id: 'more:sourced-claim', nodeType: 'more', forType: 'sourced-claim', label: `+${claimsSourced.length - keptSourced.length} more` });
        edges.push({ from: 'focus', to: 'more:sourced-claim', kind: 'spoke' });
    }

    // --- co-tagged entities (ranked by shared-claim count) ---
    const rankedEntities = [...coTagged.values()].sort((a, b) => b.count - a.count);
    const keptEntities = capList('entity', rankedEntities);
    for (const { entity, pubkey, count } of keptEntities) {
        const id = `entity:${pubkey}`;
        addNode({ id, nodeType: 'entity', label: entity.name, pubkey, entityType: entity.type, count });
        // Wire the entity to the claims it shares with the focus.
        for (const claim of keptClaims) {
            if (pTagRoles(claim.event, pubkey).size > 0 && claim.claimCoord && claimNodeByCoord.has(claim.claimCoord)) {
                edges.push({ from: claimNodeByCoord.get(claim.claimCoord), to: id, kind: 'mention' });
            }
        }
    }
    if (rankedEntities.length > keptEntities.length) {
        addNode({ id: 'more:entity', nodeType: 'more', forType: 'entity', label: `+${rankedEntities.length - keptEntities.length} more` });
    }

    // --- cases clustering these claims ---
    for (const [name, count] of [...caseNames.entries()].sort((a, b) => b[1] - a[1])) {
        const pk = casePubkeyByName[name];
        if (!pk) continue;
        const id = `case:${pk}`;
        addNode({ id, nodeType: 'case', label: name, pubkey: pk, count });
        edges.push({ from: 'focus', to: id, kind: 'spoke' });
    }

    // --- linked platform accounts ---
    const keptAccounts = capList('account', accounts);
    for (const item of keptAccounts) {
        const id = `account:${item.id}`;
        addNode({ id, nodeType: 'account', label: item.title, item });
        edges.push({ from: 'focus', to: id, kind: 'spoke' });
    }

    // --- 30055 relationships among visible claims (+ ghosts) ---
    for (const item of list) {
        if (item.typeKey !== 'link' || !item.sourceCoord || !item.targetCoord) continue;
        const srcVisible = claimNodeByCoord.get(item.sourceCoord);
        const tgtVisible = claimNodeByCoord.get(item.targetCoord);
        if (!srcVisible && !tgtVisible) continue;
        const warn = item.relationship === 'contradicts';
        const endpoint = (coord, visibleId) => {
            if (visibleId) return visibleId;
            const ghostId = `ghost:${coord}`;
            addNode({ id: ghostId, nodeType: 'ghost-claim', label: coord.split(':')[2] || coord, coord });
            return ghostId;
        };
        edges.push({
            from: endpoint(item.sourceCoord, srcVisible),
            to: endpoint(item.targetCoord, tgtVisible),
            kind: 'relationship',
            relationship: item.relationship,
            warn,
            item
        });
    }

    return {
        focus,
        nodes,
        edges,
        counts: {
            claimsAbout: claimsAbout.length,
            claimsSourced: claimsSourced.length,
            entities: rankedEntities.length,
            cases: caseNames.size,
            accounts: accounts.length
        }
    };
}

// Sector allocation (degrees, 0° = east, clockwise in SVG space) and
// ring radius per node type. Deterministic by construction.
const SECTORS = {
    'claim':         { start: -80, end: 80,  radius: 0.42 },
    'entity':        { start: 95,  end: 175, radius: 0.46 },
    'case':          { start: 182, end: 232, radius: 0.34 },
    'account':       { start: 238, end: 280, radius: 0.30 },
    'sourced-claim': { start: 286, end: 352, radius: 0.42 }
};
const GHOST_RADIUS = 0.58;

/**
 * Deterministic radial layout. Nodes spread evenly within their
 * type's sector with a small alternating radial stagger so adjacent
 * labels don't sit on one circle; ghosts hang outside the claim that
 * references them.
 *
 * @returns {Object<string, {x: number, y: number}>} including 'focus'
 */
export function layoutEgoGraph(graph, { size = 720 } = {}) {
    const cx = size / 2;
    const cy = size / 2;
    const positions = { focus: { x: cx, y: cy } };

    const byType = new Map();
    for (const node of graph.nodes) {
        const type = node.nodeType === 'more' ? node.forType : node.nodeType;
        if (node.nodeType === 'ghost-claim') continue; // placed after their anchors
        if (!byType.has(type)) byType.set(type, []);
        byType.get(type).push(node);
    }

    for (const [type, nodes] of byType) {
        const sector = SECTORS[type] || SECTORS.claim;
        const span = sector.end - sector.start;
        nodes.forEach((node, i) => {
            const angle = (sector.start + ((i + 0.5) / nodes.length) * span) * (TAU / 360);
            const stagger = (i % 2 === 0 ? 0 : 0.05) + (node.nodeType === 'more' ? 0.08 : 0);
            const r = (sector.radius + stagger) * size;
            positions[node.id] = {
                x: cx + r * Math.cos(angle),
                y: cy + r * Math.sin(angle)
            };
        });
    }

    // Ghosts: just beyond the claim that links to them (first edge wins).
    for (const node of graph.nodes) {
        if (node.nodeType !== 'ghost-claim') continue;
        const edge = graph.edges.find((e) =>
            e.kind === 'relationship' && (e.from === node.id || e.to === node.id));
        const anchorId = edge ? (edge.from === node.id ? edge.to : edge.from) : null;
        const anchor = (anchorId && positions[anchorId]) || { x: cx, y: cy };
        const dx = anchor.x - cx;
        const dy = anchor.y - cy;
        const len = Math.hypot(dx, dy) || 1;
        positions[node.id] = {
            x: cx + (dx / len) * GHOST_RADIUS * size,
            y: cy + (dy / len) * GHOST_RADIUS * size
        };
    }
    return positions;
}

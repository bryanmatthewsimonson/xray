// Portal case view — "People & organizations", LOCAL-FIRST.
//
// Field-found 2026-08-23 (PR #347 soak walk, step 4): a case with
// several people entities tagged on its member articles rendered NO
// people section, because the section was built ONLY from `p` tags on
// PUBLISHED claim events — docs/PORTAL_UX_REVIEW.md finding C1's
// local-vs-relay split in another form (a local-first case dashboard
// with a relay-only people section).
//
// Now one row per entity, unioned from two sources and counted
// SEPARATELY so the number never lies about where it came from:
//   sources  — how many of this case's member sources the entity
//              appears on (tagged on the source, or named by one of
//              its claims) — the case graph's presence rule, shared
//              verbatim via `sourceEntityPresence`;
//   mentions — how many PUBLISHED claim events p-tag the entity.
// One vocabulary in the chip: "N sources · M published claims".
//
// The builder is pure (tested directly); the renderer takes the portal
// callbacks and degrades honestly — a keyless entity has no spokes
// graph to open, so its name is not a button, while "dossier →" works
// for every local entity (it needs only an entity id).

import { el } from './dom.js';
import { sourceEntityPresence } from '../shared/case-graph.js';

/**
 * @param {object} p
 * @param {Array}  p.caseItems    library items whose case facet is this case
 * @param {string} p.casePubkey   the case entity's pubkey (its own p-tag is skipped)
 * @param {object} p.entityIndex  pubkey → {entityId, name, type} (portal identity scan)
 * @param {object|null} p.data    collectCaseDossierData output, or null when
 *                                the case has no local record (wire-only view)
 * @returns {Array<{entityId, pubkey, name, type, sources, mentions}>}
 *          sorted: sources desc, mentions desc, name asc
 */
export function buildCasePeople({ caseItems = [], casePubkey = null, entityIndex = {}, data = null } = {}) {
    const rows = new Map();   // entityId → row
    const rowFor = (entityId, { name, type, pubkey }) => {
        if (!rows.has(entityId)) {
            rows.set(entityId, { entityId, pubkey: pubkey || null, name: name || '', type: type || '', sources: 0, mentions: 0 });
        }
        const row = rows.get(entityId);
        if (!row.pubkey && pubkey) row.pubkey = pubkey;
        return row;
    };

    // Local: who appears on the member sources.
    if (data && data.case) {
        const excluded = new Set([data.case.id, ...(data.membership_ids || [])]);
        const entitiesById = data.entitiesById || {};
        for (const { tagged, about } of sourceEntityPresence(data)) {
            for (const id of new Set([...tagged, ...about.keys()])) {
                if (excluded.has(id)) continue;
                const ent = entitiesById[id];
                // Dangling ids carry no name; the dossier's coverage
                // line already reports them. Alias cases never list.
                if (!ent || ent.type === 'case') continue;
                const pubkey = (ent.keypair && ent.keypair.pubkey) || ent.foreign_pubkey || null;
                rowFor(id, { name: ent.name, type: ent.type, pubkey }).sources += 1;
            }
        }
    }

    // Published: p-tags on the case's claim events (one count per claim).
    for (const item of caseItems) {
        if (!item || item.typeKey !== 'claim') continue;
        const seen = new Set();
        for (const t of (item.event && item.event.tags) || []) {
            if (!Array.isArray(t) || t[0] !== 'p' || !t[1] || t[1] === casePubkey) continue;
            const ent = entityIndex[t[1]];
            if (!ent || !ent.entityId || ent.type === 'case' || seen.has(ent.entityId)) continue;
            seen.add(ent.entityId);
            rowFor(ent.entityId, { name: ent.name, type: ent.type, pubkey: t[1] }).mentions += 1;
        }
    }

    return [...rows.values()].sort((a, b) =>
        b.sources - a.sources
        || b.mentions - a.mentions
        || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const plural = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** "Dr P · 3 sources · 1 published claim" — every number carries its noun. */
export function peopleChipLabel(row) {
    const parts = [row.name];
    if (row.sources > 0) parts.push(plural(row.sources, 'source'));
    if (row.mentions > 0) parts.push(plural(row.mentions, 'published claim'));
    return parts.join(' · ');
}

/**
 * Render the chips into `host`. Name chip → spokes graph (by pubkey)
 * when the entity has one; "dossier →" → the entity dossier (by id).
 * A keyless entity's name renders as a plain chip whose tooltip points
 * at the affordance that does work.
 */
export function renderCasePeople(host, rows, { callbacks = {} } = {}) {
    const wrap = el('div', 'xr-portal__chips');
    for (const r of rows) {
        const label = peopleChipLabel(r);
        const canSpokes = !!(r.pubkey && callbacks.onFocusEntity);
        if (canSpokes) {
            const chip = el('button', 'xr-chip xr-chip--clickable', label);
            chip.type = 'button';
            chip.title = `${r.type} — open spokes graph`;
            chip.addEventListener('click', () => callbacks.onFocusEntity(r.pubkey));
            wrap.appendChild(chip);
        } else {
            const chip = el('span', 'xr-chip', label);
            chip.title = `${r.type} — no NOSTR key yet, so no spokes graph to draw; use dossier → for the local record`;
            wrap.appendChild(chip);
        }
        // 19.8 (§7.3): the case surfaces each orbit entity as a LINK
        // into its own dossier — routing, never inlining.
        if (r.entityId && callbacks.onOpenEntityDossier) {
            const dossierLink = el('button', 'xr-chip xr-chip--clickable', 'dossier →');
            dossierLink.type = 'button';
            dossierLink.title = `Open ${r.name}'s full dossier (claims, evidence, history)`;
            dossierLink.addEventListener('click', () => callbacks.onOpenEntityDossier(r.entityId));
            wrap.appendChild(dossierLink);
        }
    }
    host.appendChild(wrap);
    return wrap;
}

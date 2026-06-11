// Portal case dashboard (Phase 12.5, docs/PORTAL_DESIGN.md).
//
// The publish-side complement of the side panel's local case dashboard
// (Phase 11.5): for one case entity, the published artifacts grouped
// and badged — counts per kind, the case's claims with stance/⚠
// affordances, the people and orgs tagged alongside, and a mini
// publish-density strip. A case IS an entity, so "its items" are the
// library items whose case facet carries this case's name.

import { el, svgEl, clear, truncate } from './dom.js';
import { kindLabel, TYPE_DEFS } from './library.js';
import { buildBuckets } from './timeline.js';

function latestAssessmentByCoord(items) {
    const map = new Map();
    for (const item of items) {
        if (item.typeKey !== 'assessment' || !item.claimCoord) continue;
        const seen = map.get(item.claimCoord);
        if (!seen || item.created_at > seen.created_at) map.set(item.claimCoord, item);
    }
    return map;
}

function contradictedCoords(items) {
    const out = new Set();
    for (const item of items) {
        if (item.typeKey !== 'link' || item.relationship !== 'contradicts') continue;
        if (item.sourceCoord) out.add(item.sourceCoord);
        if (item.targetCoord) out.add(item.targetCoord);
    }
    return out;
}

/**
 * @param {HTMLElement} host
 * @param {object} params
 * @param {Array}  params.items        ALL library items
 * @param {object} params.entityIndex  pubkey → {entityId, name, type}
 * @param {string} params.casePubkey
 * @param {object} params.callbacks    {onBack(), onFocusEntity(pubkey),
 *                                      onOpenGraph(pubkey), onOpenItem(item)}
 */
export function renderCaseView(host, params) {
    const { items, entityIndex, casePubkey, callbacks } = params;
    clear(host);

    const caseEnt = entityIndex[casePubkey];
    const caseName = caseEnt ? caseEnt.name : null;

    const head = el('div', 'xr-view__head');
    const back = el('button', 'xr-portal__btn xr-portal__btn--ghost', '← Library');
    back.type = 'button';
    back.addEventListener('click', () => callbacks.onBack());
    head.appendChild(back);
    head.appendChild(el('span', 'xr-view__title', caseName || 'Unknown case'));
    head.appendChild(el('span', 'xr-badge', 'case'));
    const graphBtn = el('button', 'xr-portal__btn', 'Spokes graph');
    graphBtn.type = 'button';
    graphBtn.addEventListener('click', () => callbacks.onOpenGraph(casePubkey));
    head.appendChild(graphBtn);
    host.appendChild(head);

    if (!caseName) {
        host.appendChild(el('p', 'xr-view__empty',
            'This case isn\'t in the local entity registry, so its published artifacts can\'t be clustered here.'));
        return;
    }

    // Everything published under this case + relationship links whose
    // endpoints are case claims (links carry no p-tags of their own).
    const caseItems = items.filter((i) => i.cases.includes(caseName));
    const caseClaimCoords = new Set(caseItems.filter((i) => i.claimCoord && i.typeKey === 'claim').map((i) => i.claimCoord));
    const caseLinks = items.filter((i) => i.typeKey === 'link'
        && ((i.sourceCoord && caseClaimCoords.has(i.sourceCoord)) || (i.targetCoord && caseClaimCoords.has(i.targetCoord))));
    const everything = [...caseItems, ...caseLinks.filter((l) => !caseItems.includes(l))];

    // --- artifact rollup ---
    const rollup = el('div', 'xr-case__rollup');
    const counts = new Map();
    for (const item of everything) counts.set(item.typeKey, (counts.get(item.typeKey) || 0) + 1);
    for (const def of TYPE_DEFS) {
        const n = counts.get(def.key) || 0;
        if (n === 0) continue;
        rollup.appendChild(el('span', 'xr-badge', `${def.label}: ${n}`));
    }
    host.appendChild(rollup);

    // --- publish-density strip ---
    const { buckets } = buildBuckets(everything);
    if (buckets.length > 1) {
        const maxCount = Math.max(...buckets.map((b) => b.count), 1);
        const strip = svgEl('svg', {
            class: 'xr-case__strip',
            viewBox: `0 0 ${buckets.length * 6} 32`,
            preserveAspectRatio: 'none'
        });
        buckets.forEach((b, i) => {
            const h = b.count === 0 ? 0 : Math.max(2, Math.round((b.count / maxCount) * 28));
            const bar = svgEl('rect', {
                x: i * 6, y: 32 - h, width: 4, height: Math.max(h, 0.5),
                class: b.count === 0 ? 'xr-tl-bar xr-tl-bar--empty' : 'xr-tl-bar'
            });
            const tip = svgEl('title', {});
            tip.textContent = `${new Date(b.start * 1000).toLocaleDateString()} — ${b.count} item(s)`;
            bar.appendChild(tip);
            strip.appendChild(bar);
        });
        host.appendChild(strip);
    }

    // --- members: people/orgs tagged alongside the case ---
    const members = new Map(); // pubkey → {name, type, count}
    for (const item of caseItems) {
        if (item.typeKey !== 'claim') continue;
        for (const t of (item.event.tags || [])) {
            if (t[0] !== 'p' || t[1] === casePubkey) continue;
            const ent = entityIndex[t[1]];
            if (!ent || ent.type === 'case') continue;
            const cur = members.get(t[1]) || { name: ent.name, type: ent.type, count: 0 };
            cur.count++;
            members.set(t[1], cur);
        }
    }
    if (members.size > 0) {
        const section = el('div', 'xr-case__members');
        section.appendChild(el('h3', 'xr-case__heading', 'People & organizations'));
        const wrap = el('div', 'xr-portal__chips');
        for (const [pk, m] of [...members.entries()].sort((a, b) => b[1].count - a[1].count)) {
            const chip = el('button', 'xr-chip xr-chip--clickable', `${m.name} · ${m.count}`);
            chip.type = 'button';
            chip.title = `${m.type} — open spokes graph`;
            chip.addEventListener('click', () => callbacks.onFocusEntity(pk));
            wrap.appendChild(chip);
        }
        section.appendChild(wrap);
        host.appendChild(section);
    }

    // --- claims with stance/⚠ badges ---
    const assessments = latestAssessmentByCoord(items);
    const contradicted = contradictedCoords(items);
    const claims = caseItems.filter((i) => i.typeKey === 'claim');
    const section = el('div', 'xr-case__claims');
    section.appendChild(el('h3', 'xr-case__heading', `Claims (${claims.length})`));
    const list = el('ol', 'xr-portal__list');
    for (const item of claims) {
        const row = el('li', 'xr-row');
        const headRow = el('div', 'xr-row__head');
        headRow.appendChild(el('span', 'xr-row__kind', kindLabel(item.kind)));
        const titleEl = el('button', 'xr-row__title xr-row__title--link', truncate(item.title, 160));
        titleEl.type = 'button';
        titleEl.title = 'Inspect — raw event, relays holding it, ledger status';
        titleEl.addEventListener('click', () => callbacks.onOpenItem(item));
        headRow.appendChild(titleEl);
        const badges = el('span', 'xr-row__badges');
        const assessment = item.claimCoord ? assessments.get(item.claimCoord) : null;
        if (assessment && assessment.stance !== null && assessment.stance !== undefined) {
            const cls = assessment.stance > 0 ? 'xr-badge--agree' : (assessment.stance < 0 ? 'xr-badge--disagree' : '');
            badges.appendChild(el('span', `xr-badge ${cls}`,
                `stance ${assessment.stance > 0 ? '+' : ''}${assessment.stance}`));
        }
        if (assessment && assessment.labelCount > 0) {
            badges.appendChild(el('span', 'xr-badge', `${assessment.labelCount} label(s)`));
        }
        if (item.claimCoord && contradicted.has(item.claimCoord)) {
            badges.appendChild(el('span', 'xr-badge xr-badge--warn', '⚠ contradicted'));
        }
        headRow.appendChild(badges);
        if (item.created_at) {
            headRow.appendChild(el('span', 'xr-row__date', new Date(item.created_at * 1000).toLocaleString()));
        }
        row.appendChild(headRow);
        if (item.sub) row.appendChild(el('div', 'xr-row__sub', truncate(item.sub, 240)));
        list.appendChild(row);
    }
    if (claims.length === 0) {
        list.appendChild(el('li', 'xr-view__empty', 'No published claims reference this case yet.'));
    }
    section.appendChild(list);
    host.appendChild(section);

    // --- the rest of the artifacts, compact ---
    const rest = everything.filter((i) => i.typeKey !== 'claim');
    if (rest.length > 0) {
        const other = el('div', 'xr-case__rest');
        other.appendChild(el('h3', 'xr-case__heading', `Other artifacts (${rest.length})`));
        const ul = el('ol', 'xr-portal__list');
        for (const item of rest) {
            const row = el('li', 'xr-row');
            const headRow = el('div', 'xr-row__head');
            headRow.appendChild(el('span', 'xr-row__kind', kindLabel(item.kind)));
            const titleEl = el('button', 'xr-row__title xr-row__title--link', truncate(item.title, 160));
            titleEl.type = 'button';
            titleEl.title = 'Inspect — raw event, relays holding it, ledger status';
            titleEl.addEventListener('click', () => callbacks.onOpenItem(item));
            headRow.appendChild(titleEl);
            if (item.created_at) {
                headRow.appendChild(el('span', 'xr-row__date', new Date(item.created_at * 1000).toLocaleString()));
            }
            row.appendChild(headRow);
            ul.appendChild(row);
        }
        other.appendChild(ul);
        host.appendChild(other);
    }
}

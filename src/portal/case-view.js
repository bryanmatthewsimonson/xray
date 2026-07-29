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
import { renderDossierBlock } from './dossier-block.js';
import { renderFindingsBlock } from './findings-block.js';
import { renderShapeBlock } from './shape-block.js';
import { renderEvidenceBlock } from './evidence-block.js';
import { renderCaseTimeline } from './case-timeline.js';
import { EntityModel } from '../shared/entity-model.js';
import { collectCaseDossierData, buildCaseDossier } from '../shared/case-dossier.js';
import { EvidenceLinker } from '../shared/evidence-linker.js';
import { ClaimModel } from '../shared/claim-model.js';
import { makeClaimRefCanonicalizer } from '../shared/claim-ref.js';
import { getArticle } from '../shared/archive-cache.js';
import { removeArticleFromCase } from '../shared/case-membership.js';
import { mountSourceManager } from './source-manager.js';
import { mountTranscriptImport } from './import-transcript.js';
import { mountUrlImport } from './import-urls.js';
import { renderCaseGraph } from './case-graph-view.js';
import { renderSynthesisBlock } from './synthesis-block.js';
import { renderExtractionBlock } from './extraction-block.js';
import { renderCorpusAuditBlock } from './corpus-audit-block.js';
import { renderEpistemicsBlock } from './epistemics-block.js';
import { renderForensicCorpusBlock } from './forensic-corpus-block.js';
import { renderLinksBlock } from './links-block.js';
import { renderHypothesesBlock } from './hypothesis-block.js';
import { collectHypothesisEdgeJoins } from '../shared/hypothesis-map.js';
import { Utils } from '../shared/utils.js';

// Open a LOCAL archived record in the reader to extract claims from a
// claimless case member (20.1). Unlike the inspector's read-only relay
// reconstruction, this opens the real archive record writable so tags
// and newly-extracted claims save back.
async function openArchivedInReader(url) {
    try {
        const rec = await getArticle(url);
        if (!rec || !rec.article) { Utils.error('Extract claims: no archive record', url); return; }
        const article = { ...rec.article, _articleHash: rec.articleHash };
        const id = crypto.randomUUID();
        chrome.runtime.sendMessage({ type: 'xray:reader:open', id, article, readOnly: false }, (resp) => {
            if (!resp || !resp.ok) Utils.error('Extract claims: reader open failed', resp && resp.error);
        });
    } catch (err) {
        Utils.error('Extract claims: open failed', err);
    }
}

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

// Claim titles by coordinate — so a cross-article link can name the
// claim it points at (built from the case's own claim items).
function claimTitleByCoord(items) {
    const map = new Map();
    for (const item of items) {
        if (item.typeKey === 'claim' && item.claimCoord) map.set(item.claimCoord, item.title || '');
    }
    return map;
}

// Non-contradiction relationship links (supports / updates / duplicates)
// touching each claim coordinate, both directions — the cross-article
// links the dashboard never surfaced. Contradiction keeps its own ⚠
// badge; the diachronic revision/* edges are a forensic surface,
// excluded here. Returns coord → [{relationship, dir, otherCoord}].
const RELATED_RELATIONSHIPS = new Set(['supports', 'updates', 'duplicates']);
function relatedLinksByCoord(items) {
    const map = new Map();
    const add = (coord, entry) => {
        if (!coord) return;
        if (!map.has(coord)) map.set(coord, []);
        map.get(coord).push(entry);
    };
    for (const item of items) {
        if (item.typeKey !== 'link' || !RELATED_RELATIONSHIPS.has(item.relationship)) continue;
        add(item.sourceCoord, { relationship: item.relationship, dir: 'out', otherCoord: item.targetCoord });
        add(item.targetCoord, { relationship: item.relationship, dir: 'in', otherCoord: item.sourceCoord });
    }
    return map;
}

// "supports →" / "← supported by" phrasing per relationship + direction.
const RELATED_PHRASE = {
    supports:   { out: 'supports', in: 'supported by' },
    updates:    { out: 'updates', in: 'updated by' },
    duplicates: { out: 'duplicates', in: 'duplicated by' }
};

// 2026-07-20 declutter — collapsible sections with per-case memory.
// Everything stays one click away; the scroll becomes readable. The
// open/closed choice persists per case (localStorage), so the view
// reopens the way the researcher left it.
function collapsibleSection(host, { id, title, casePubkey, open = false }) {
    const key = `xr-case-sec:${casePubkey}:${id}`;
    const det = document.createElement('details');
    det.className = 'xr-case__sec';
    let stored = null;
    try { stored = localStorage.getItem(key); } catch (_) { /* private mode */ }
    det.open = stored === null ? open : stored === '1';
    const sum = document.createElement('summary');
    sum.className = 'xr-case__sec-head';
    sum.textContent = title;
    det.appendChild(sum);
    const body = el('div', 'xr-case__sec-body');
    det.appendChild(body);
    det.addEventListener('toggle', () => {
        try { localStorage.setItem(key, det.open ? '1' : '0'); } catch (_) { /* best effort */ }
    });
    host.appendChild(det);
    return body;
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
    const { items, entityIndex, casePubkey, callbacks, dossier, populationMean, findings = [] } = params;
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
    // Declutter: the three source affordances fold into ONE menu (the
    // head-button diet). Selecting an action mounts its panel below.
    const addSourcesHost = el('div');
    if (caseEnt && caseEnt.entityId) {
        const srcSel = el('select', 'xr-portal__case');
        srcSel.title = 'Manage or import this case\'s sources';
        srcSel.appendChild(new Option('Sources ▾', ''));
        srcSel.appendChild(new Option('Manage sources…', 'manage'));
        srcSel.appendChild(new Option('Import transcript…', 'transcript'));
        srcSel.appendChild(new Option('Import URLs…', 'urls'));
        srcSel.addEventListener('change', () => {
            const v = srcSel.value;
            srcSel.value = '';
            addSourcesHost.replaceChildren();
            const done = () => callbacks.onReloadCase && callbacks.onReloadCase();
            if (v === 'manage') {
                mountSourceManager(addSourcesHost, { caseEntityId: caseEnt.entityId, onChanged: done });
            } else if (v === 'transcript') {
                mountTranscriptImport(addSourcesHost, { caseEntityId: caseEnt.entityId, onDone: done });
            } else if (v === 'urls') {
                mountUrlImport(addSourcesHost, { caseEntityId: caseEnt.entityId, onDone: done });
            }
        });
        head.appendChild(srcSel);
    }
    host.appendChild(head);
    host.appendChild(addSourcesHost);

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

    // --- case scope (19.8): the authored framing in the header —
    // explicitly the author's question/status, never a sourced fact.
    // Computed on open from the local record; renders nothing when
    // no framing has been written.
    if (caseEnt.entityId) {
        const scopeHost = el('div', 'xr-case__scope');
        host.appendChild(scopeHost);
        EntityModel.get(caseEnt.entityId).then((record) => {
            const af = record && record.authored_fields;
            if (!af || Object.keys(af).length === 0) { scopeHost.remove(); return; }
            if (af.scope_question) {
                scopeHost.appendChild(el('div', 'xr-view__dossier-line',
                    `Scope (author's framing): ${af.scope_question.value}`));
            }
            const chips = el('div', 'xr-case__dist');
            if (af.status) chips.appendChild(el('span', 'xr-badge', `status: ${af.status.value}`));
            if (af.opened) chips.appendChild(el('span', 'xr-badge xr-badge--muted', `opened ${af.opened.value}`));
            if (af.closed) chips.appendChild(el('span', 'xr-badge xr-badge--muted', `closed ${af.closed.value}`));
            if (chips.childElementCount > 0) scopeHost.appendChild(chips);
        }).catch(() => scopeHost.remove());
    }

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

    // --- Audit dossier (13.7) — the design assigns the block to
    // entity AND case views; a case is a pubkey-keyed entity.
    const publishedSec = collapsibleSection(host, {
        id: 'published-record', casePubkey,
        title: 'Published audit & forensic record', open: false
    });
    renderDossierBlock(publishedSec, dossier, populationMean);
    // --- Forensic findings (14.4) — the four lenses, beside the dossier.
    renderFindingsBlock(publishedSec, findings, { subjectName: caseName || 'this case' });

    // --- Case dossier (CD.2/CD.3) — the shape-of-knowledge header, the
    // convergence-collapsed evidence table, and the four-axis timeline,
    // assembled ONCE from the LOCAL union-membership spine (20.1) and
    // shared across all three blocks (was three separate assembly
    // passes). Placeholder hosts hold each block's slot; the shared
    // assembly self-removes empty blocks and fills the local-counts line.
    const localCountsHost = el('div', 'xr-view__dossier-line xr-case__localcounts');
    let shapeHost = el('div');
    let evidenceHost = el('div');
    let graphViewHost = el('div');
    let analysisHost = el('div');
    let hypothesesHost = el('div');
    let timelineHost = el('div');
    if (caseEnt && caseEnt.entityId) {
        host.appendChild(localCountsHost);
        // The workflow order, as sections: evidence (open — the daily
        // surface), analysis (open — the LLM passes in ONE place),
        // then the derived reading views, collapsed until wanted.
        evidenceHost = collapsibleSection(host, {
            id: 'evidence', casePubkey, title: 'Evidence — sources & claims', open: true
        });
        analysisHost = collapsibleSection(host, {
            id: 'analysis', casePubkey, title: 'Analysis — the LLM passes over this corpus', open: true
        });
        shapeHost = collapsibleSection(host, {
            id: 'shape', casePubkey, title: 'Shape of knowledge', open: false
        });
        graphViewHost = collapsibleSection(host, {
            id: 'graph', casePubkey, title: 'Case graph', open: false
        });
        hypothesesHost = collapsibleSection(host, {
            id: 'hypotheses', casePubkey, title: 'Hypothesis map', open: false
        });
        timelineHost = collapsibleSection(host, {
            id: 'timeline', casePubkey, title: 'Timeline & publish density', open: false
        });
        (async () => {
            // Collect once, then build the dossier AND the local graph
            // from the same `data` (the graph needs entitiesById/articles
            // that only the collector output carries).
            const data = await collectCaseDossierData(caseEnt.entityId);
            const dossier = buildCaseDossier(data, null);
            // 26 CF.2 — the hypothesis-edge joins the per-claim trace
            // expander folds into its deltas (one read, shared below).
            const hypothesisEdges = await collectHypothesisEdgeJoins(caseEnt.entityId)
                .catch(() => []);
            const c = dossier.coverage;
            localCountsHost.textContent =
                `Local corpus: ${c.articles} source${c.articles === 1 ? '' : 's'} · `
                + `${c.articles_with_claims} with claims · ${c.claims} claim${c.claims === 1 ? '' : 's'} · `
                + `${c.propositions} proposition${c.propositions === 1 ? '' : 's'}`;
            if (c.articles === 0) localCountsHost.remove();
            renderShapeBlock(shapeHost, dossier);
            renderEvidenceBlock(evidenceHost, dossier, {
                data, hypothesisEdges,
                onExtractClaims: openArchivedInReader,
                onRemoveFromCase: async (url) => {
                    try {
                        await removeArticleFromCase(caseEnt.entityId, url);
                        if (callbacks.onReloadCase) callbacks.onReloadCase();
                    } catch (err) { Utils.error('Remove from case failed', err); }
                }
            });
            renderCaseGraph(graphViewHost, {
                data,
                callbacks: {
                    onOpenEntityDossier: callbacks.onOpenEntityDossier,
                    onOpenArticle: openArchivedInReader
                }
            });
            // 28.3 — standalone cross-article link suggestion (same
            // gate as the synthesis, decoupled from it: structure can
            // be proposed BEFORE the brief run and feeds its digest).
            renderLinksBlock(analysisHost, {
                data, dossier,
                callbacks: { onReloadCase: callbacks.onReloadCase }
            });
            // 20.4 — LLM corpus synthesis (gated by caseSynthesis + key;
            // absent otherwise). Self-manages its own gating call.
            renderSynthesisBlock(analysisHost, {
                data, dossier,
                callbacks: {
                    onReloadCase: callbacks.onReloadCase,
                    onAnalysisState: callbacks.onAnalysisState,
                    isCurrentRun: callbacks.isCurrentRun
                }
            });
            // MA.2 — the durable map-artifact review queue: atomized
            // assertions from every analysis pass, parked until a human
            // mints or dismisses them. No LLM call; absent until records
            // exist (docs/MAP_ARTIFACT_KICKOFF.md).
            renderExtractionBlock(analysisHost, {
                data, callbacks: { onReloadCase: callbacks.onReloadCase }
            });
            // CA.3 — the corpus epistemics distributions (absent until
            // something is audited; no corpus score exists anywhere).
            renderEpistemicsBlock(analysisHost, { data });
            // FA.1 — the per-subject forensic corpus pass (counter-read
            // first; findings local until the forensicPublishing batch).
            renderForensicCorpusBlock(analysisHost, {
                data, callbacks: { onReloadCase: callbacks.onReloadCase }
            });
            // CA.1 — the corpus audit runner (epistemicAuditing-gated;
            // absent when off). Same run-ownership guard as synthesis.
            renderCorpusAuditBlock(analysisHost, {
                data,
                callbacks: {
                    onReloadCase: callbacks.onReloadCase,
                    onAnalysisState: callbacks.onAnalysisState,
                    isCurrentRun: callbacks.isCurrentRun
                }
            });
            // 26 H.2/H.3/H.4 — the hypothesis map, assembled from the
            // same shared `data`, with the manual authoring affordances
            // and the gated LLM edge suggestion (dossier feeds its
            // digest). Renders nothing on a claimless case with no map.
            renderHypothesesBlock(hypothesesHost, {
                data, dossier,
                callbacks: { onReloadCase: callbacks.onReloadCase }
            });
            renderCaseTimeline(timelineHost, dossier);
        })().catch((err) => {
            Utils.error('Case dossier assembly failed', err);
            localCountsHost.remove();
        });
    }

    // --- publish-density strip (network publish activity over wire) ---
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
        if (!timelineHost.parentElement) host.appendChild(timelineHost);   // wire-only case: no sections
        timelineHost.appendChild(strip);
    }

    // (The four-axis timeline renders into its section body, created
    // above — the density strip lands in the same section.)

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
            // 19.8 (§7.3): the case surfaces each orbit entity as a
            // LINK into its own dossier — routing, never inlining.
            const entRec = entityIndex[pk];
            if (entRec && entRec.entityId && callbacks.onOpenEntityDossier) {
                const dossierLink = el('button', 'xr-chip xr-chip--clickable', 'dossier →');
                dossierLink.type = 'button';
                dossierLink.title = `Open ${m.name}'s full dossier (claims, evidence, history)`;
                dossierLink.addEventListener('click', () => callbacks.onOpenEntityDossier(entRec.entityId));
                wrap.appendChild(dossierLink);
            }
        }
        section.appendChild(wrap);
        collapsibleSection(host, { id: 'people', casePubkey, title: 'People & organizations', open: false })
            .appendChild(section);
    }

    // --- claims with stance/⚠ badges ---
    const assessments = latestAssessmentByCoord(items);
    const contradicted = contradictedCoords(items);
    const relatedLinks = relatedLinksByCoord(items);
    const claimTitles = claimTitleByCoord(items);
    const claims = caseItems.filter((i) => i.typeKey === 'claim');
    const section = el('div', 'xr-case__claims');
    section.appendChild(el('h3', 'xr-case__heading', `Claims (${claims.length})`));
    const list = el('ol', 'xr-portal__list');
    const rowByCoord = new Map();   // 27 S.4 — local-link chip targets
    for (const item of claims) {
        const row = el('li', 'xr-row');
        if (item.claimCoord) rowByCoord.set(item.claimCoord, row);
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
        // Cross-article relationship links (supports/updates/duplicates)
        // touching this claim — the links the dashboard never surfaced.
        const related = item.claimCoord ? relatedLinks.get(item.claimCoord) : null;
        if (related && related.length) {
            const relRow = el('div', 'xr-case__related');
            for (const r of related.slice(0, 6)) {
                const phrase = (RELATED_PHRASE[r.relationship] || {})[r.dir] || r.relationship;
                const other = (r.otherCoord && claimTitles.get(r.otherCoord)) || 'another claim';
                relRow.appendChild(el('span', 'xr-badge xr-badge--muted',
                    `${r.dir === 'out' ? '→' : '←'} ${phrase}: ${truncate(other, 60)}`));
            }
            row.appendChild(relRow);
        }
        list.appendChild(row);
    }
    if (claims.length === 0) {
        list.appendChild(el('li', 'xr-view__empty', 'No published claims reference this case yet.'));
    }
    section.appendChild(list);
    collapsibleSection(host, { id: 'published-claims', casePubkey, title: `Published claims (${claims.length})`, open: true })
        .appendChild(section);

    // 27 S.4 — LOCAL relationship links (accepted proposals, hand-drawn
    // links) that haven't published yet: the published-30055 chips
    // above can't show them, so an accepted link looked like nothing
    // happened. Async enrichment; chips carry a "local" marker.
    if (rowByCoord.size > 0) {
        (async () => {
            const [allLinks, allClaims, canon] = await Promise.all([
                EvidenceLinker.getAll(), ClaimModel.getAll(), makeClaimRefCanonicalizer()
            ]);
            const nameOf = (ref, link, side) => {
                const c = allClaims[ref];
                if (c && c.text) return c.text;
                const snap = side === 'source' ? link.source_snapshot : link.target_snapshot;
                return (snap && snap.text) || 'another claim';
            };
            // Canonical endpoints are row-invariant: index the global
            // registry ONCE (O(links)), then each row is a map lookup —
            // not rows × links × canon() re-parses.
            const byEndpoint = new Map();   // canonical ref → [{link, src, tgt}]
            for (const link of Object.values(allLinks)) {
                if (link.publishedAt) continue;   // already a wire chip
                const entry = { link, src: canon(link.source_claim_id), tgt: canon(link.target_claim_id) };
                for (const ref of entry.src === entry.tgt ? [entry.src] : [entry.src, entry.tgt]) {
                    if (!byEndpoint.has(ref)) byEndpoint.set(ref, []);
                    byEndpoint.get(ref).push(entry);
                }
            }
            const MAX_LOCAL_CHIPS = 6;   // the published-chip cap, matched
            for (const [coord, row] of rowByCoord) {
                const canonical = canon(coord);
                const entries = byEndpoint.get(canonical) || [];
                let shown = 0;
                let over = 0;
                let relRow = null;
                for (const { link, src, tgt } of entries) {
                    const isContradicts = link.relationship === 'contradicts';
                    if (!isContradicts && !RELATED_RELATIONSHIPS.has(link.relationship)) continue;
                    if (shown >= MAX_LOCAL_CHIPS) { over++; continue; }
                    if (!relRow) {
                        relRow = row.querySelector('.xr-case__related');
                        if (!relRow) { relRow = el('div', 'xr-case__related'); row.appendChild(relRow); }
                    }
                    const dir = src === canonical ? 'out' : 'in';
                    if (isContradicts) {
                        const b = el('span', 'xr-badge xr-badge--warn', '⚠ contradicted (local)');
                        b.title = 'A local contradiction link — not yet published';
                        relRow.appendChild(b);
                    } else {
                        const otherRef = dir === 'out' ? tgt : src;
                        const otherSide = dir === 'out' ? 'target' : 'source';
                        const phrase = (RELATED_PHRASE[link.relationship] || {})[dir] || link.relationship;
                        const b = el('span', 'xr-badge xr-badge--muted',
                            `${dir === 'out' ? '→' : '←'} ${phrase} (local): ${truncate(nameOf(otherRef, link, otherSide), 60)}`);
                        b.title = 'A local link — not yet published to relays';
                        relRow.appendChild(b);
                    }
                    shown++;
                }
                if (over > 0 && relRow) {
                    relRow.appendChild(el('span', 'xr-inspector__mono', `… +${over} more local`));
                }
            }
        })().catch((err) => Utils.error('Local link chips failed', err));
    }

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
        collapsibleSection(host, { id: 'artifacts', casePubkey, title: `Other artifacts (${rest.length})`, open: false })
            .appendChild(other);
    }
}

// X-Ray portal — "My Archive" (Phase 12, docs/PORTAL_DESIGN.md).
//
// View layer only: identity chips, the Library (type tabs + facets +
// cross-cutting search, Phase 12.2), and the flat row list with raw
// events a click away. The item model, filtering, and search live in
// ./library.js; identity resolution in ./identity.js; relay fetch in
// ./corpus.js. Caching (12.3), the timeline (12.4), entity/case views
// (12.5), and reconciliation (12.6) land on top of this.
//
// All DOM here is built with createElement/textContent — no dynamic
// innerHTML (keeps web-ext's UNSAFE_VAR_ASSIGNMENT warnings from
// multiplying and makes escaping a non-issue).

import { Storage } from '../shared/storage.js';
import { Utils } from '../shared/utils.js';
import { dedupeReplaceable } from '../shared/nostr-events.js';
import { resolveIdentities, addManualIdentity, removeManualIdentity } from './identity.js';
import { fetchCorpus, FALLBACK_RELAYS } from './corpus.js';
import { saveRecords, loadRecords, getMeta, setMeta, clearAll } from './portal-cache.js';
import {
    buildItems, applyFilters, typeCounts, facetValues, isOtherClient,
    kindLabel, pageWindow, TYPE_DEFS, EMPTY_FILTERS
} from './library.js';
import { buildBuckets, brushRange } from './timeline.js';
import { el, svgEl, clear, truncate, shortKey } from './dom.js';
import { mountTranscriptImport } from './import-transcript.js';
import { mountUrlImport } from './import-urls.js';
import { mountBookImport } from './import-book.js';
import { renderEntityView } from './entity-view.js';
import { renderCaseView } from './case-view.js';
import { renderEntityDossierView } from './entity-dossier-view.js';
import { renderCrossWorkspaceView } from './cross-workspace-view.js';
import { renderEntityCorpusView } from './entity-corpus-view.js';
import { Workspaces } from '../shared/identity-profiles.js';
import { describeActiveContext } from '../shared/case-membership.js';
import { findingsForEntity } from './forensic-data.js';
import { loadLocalLedger, reconcile, countLocalOnly, listLocalArtifacts } from './reconcile.js';
import { getByEventId as journalGetByEventId } from '../shared/event-journal.js';
import { renderInspector } from './inspector.js';
import {
    buildAuditIndex, mergeLocalRuns, mergeLocalResolutions, auditsForArticle,
    latestAuditFor, dossierInputsForEntity, computeEntityDossier,
    predictionsDue, resolverIdentity, DEFAULT_POPULATION_MEAN
} from './audit-data.js';
import { auditCardChipData } from '../shared/audit/display.js';
import { SOURCE_TYPE_LABELS, isPrimarySourceType } from '../shared/truth-taxonomy.js';
import { computeCreatorBinding } from '../shared/identity-builders.js';
import { listRuns, listPredictions, listResolutions } from '../shared/audit/audit-cache.js';
import { PredictionModel } from '../shared/audit/audit-model.js';
import { listArticles as listArchiveArticles } from '../shared/archive-cache.js';
import { openResolveForm } from './resolve-form.js';

const $ = (sel) => document.querySelector(sel);

const state = {
    identities: [],      // [{pubkey, sources}] — "me"
    viewers: [],         // [{pubkey, sources}] — pasted read-only archives (28.4)
    entities: [],        // [{pubkey, entityId, name, type}]
    entityIndex: {},     // pubkey → {entityId, name, type}
    signer: null,        // {method, pubkey, reason}
    relays: [],
    records: [],         // [{event, relays}] — raw, pre-dedupe
    items: [],           // library items (deduped, parsed, sorted)
    localArtifacts: [],  // itemized never-published local records
    filters: { ...EMPTY_FILTERS },
    groupByDomain: false,
    view: { name: 'library' },   // | {name:'entity', pubkey} | {name:'case', pubkey}
    expandedTypes: new Set(),    // graph sectors the user expanded
    reconciliation: null,        // {summary, missing, statusByEventId} (12.6)
    rowLimit: 200,               // incremental-reveal window (12.7)
    cacheBroken: false,          // IndexedDB unavailable → live-only mode (12.7)
    relayErrors: {},
    truncated: false,
    loading: false
};

const ROW_PAGE_SIZE = 200;

// ------------------------------------------------------------------
// Header / identity / status
// ------------------------------------------------------------------

function setStatus(text, isError) {
    const node = $('#xr-status');
    node.hidden = !text;
    node.textContent = text || '';
    node.classList.toggle('xr-portal__status--error', !!isError);
}

function renderIdentityChips() {
    const host = $('#xr-identity-chips');
    clear(host);
    for (const id of state.identities) {
        const chip = el('span', 'xr-chip');
        chip.appendChild(el('span', 'xr-chip__key', shortKey(id.pubkey)));
        chip.title = id.pubkey;
        for (const src of id.sources) {
            chip.appendChild(el('span', `xr-chip__src xr-chip__src--${src}`, src));
        }
        if (id.sources.includes('manual')) {
            const btn = el('button', 'xr-chip__remove', '✕');
            btn.type = 'button';
            btn.title = 'Remove this identity';
            btn.addEventListener('click', async () => {
                await removeManualIdentity(id.pubkey);
                await boot();
            });
            chip.appendChild(btn);
        }
        host.appendChild(chip);
    }
    // 28.4 — pasted archives render as VIEWER chips: fetched and
    // browsable, never "me" (excluded from reconcile/binding/resolver).
    for (const v of state.viewers) {
        const chip = el('span', 'xr-chip xr-chip--viewer');
        chip.appendChild(el('span', 'xr-chip__key', shortKey(v.pubkey)));
        chip.title = `${v.pubkey}\nRead-only viewer — this archive is browsed, never treated as yours.`;
        chip.appendChild(el('span', 'xr-chip__src xr-chip__src--viewer', 'viewer'));
        const btn = el('button', 'xr-chip__remove', '✕');
        btn.type = 'button';
        btn.title = 'Stop viewing this archive';
        btn.addEventListener('click', async () => {
            await removeManualIdentity(v.pubkey);
            await boot();
        });
        chip.appendChild(btn);
        host.appendChild(chip);
    }
    if (state.entities.length > 0) {
        const chip = el('span', 'xr-chip xr-chip--entity');
        chip.appendChild(el('span', 'xr-chip__key', `${state.entities.length} entity key(s)`));
        chip.title = state.entities.map((e) => `${e.name} (${e.type})`).join('\n');
        host.appendChild(chip);
    }
}

function renderEmpty(heading, lines) {
    const host = $('#xr-empty');
    clear(host);
    host.hidden = false;
    $('#xr-list').hidden = true;
    host.appendChild(el('h2', null, heading));
    for (const line of lines) host.appendChild(el('p', null, line));
}

function renderFooter() {
    $('#xr-footer-relays').textContent = state.relays.length
        ? `Relays: ${state.relays.join('  ')}`
        : 'No relays configured.';
}

// ------------------------------------------------------------------
// Library: tabs + facets + rows (Phase 12.2)
// ------------------------------------------------------------------

function renderTabs() {
    const host = $('#xr-tabs');
    host.hidden = false;
    clear(host);
    // Counts respect search + facets so the tab numbers answer "what
    // would I see if I clicked this" — type itself excluded, of course.
    const counted = applyFilters(state.items, { ...state.filters, type: 'all' });
    const counts = typeCounts(counted);

    const defs = [{ key: 'all', label: 'All' }, ...TYPE_DEFS];
    for (const def of defs) {
        const count = counts[def.key] || 0;
        if (count === 0 && def.key !== 'all' && state.filters.type !== def.key) continue;
        const btn = el('button', 'xr-tab', `${def.label} `);
        btn.type = 'button';
        btn.appendChild(el('span', 'xr-tab__count', String(count)));
        btn.classList.toggle('xr-tab--active', state.filters.type === def.key);
        btn.addEventListener('click', () => {
            state.filters.type = def.key;
            state.rowLimit = ROW_PAGE_SIZE;
            renderLibrary();
        });
        host.appendChild(btn);
    }
}

function fillFacetSelect(select, values, selected, allLabel) {
    clear(select);
    const allOpt = el('option', null, allLabel);
    allOpt.value = '';
    select.appendChild(allOpt);
    for (const { value, count } of values) {
        const opt = el('option', null, `${truncate(value, 40)} (${count})`);
        opt.value = value;
        select.appendChild(opt);
    }
    select.value = values.some((v) => v.value === selected) ? selected : '';
    select.hidden = values.length === 0;
}

function renderFacets() {
    const host = $('#xr-facets');
    host.hidden = false;
    // Options reflect the current type + search + client cut, ignoring
    // the value selects themselves (standard faceting, kept simple).
    const base = applyFilters(state.items, { ...state.filters, platform: '', domain: '', caseName: '' });
    fillFacetSelect($('#xr-facet-platform'), facetValues(base, 'platform'), state.filters.platform, 'All platforms');
    fillFacetSelect($('#xr-facet-domain'), facetValues(base, 'domain'), state.filters.domain, 'All sources');
    fillFacetSelect($('#xr-facet-case'), facetValues(base, 'cases'), state.filters.caseName, 'All cases');
    $('#xr-facet-client').value = state.filters.client;
    // Status facet only means something once the ledger diff has run.
    $('#xr-facet-status').hidden = !state.reconciliation;
    $('#xr-facet-status').value = state.filters.status;
    // Sync any select whose remembered value vanished from the options.
    state.filters.platform = $('#xr-facet-platform').value;
    state.filters.domain = $('#xr-facet-domain').value;
    state.filters.caseName = $('#xr-facet-case').value;
}

function casePubkeyFor(name) {
    for (const [pk, ent] of Object.entries(state.entityIndex)) {
        if (ent.type === 'case' && ent.name === name) return pk;
    }
    return null;
}

function openInspector(item) {
    const status = state.reconciliation
        ? state.reconciliation.statusByEventId[item.id] || 'no-ledger'
        : 'no-ledger';
    // 13.7: articles get their audit record in the drawer — every
    // run, side-by-side, never averaged, with module results and
    // dispute lineage joined in.
    let audit = null;
    if (item.typeKey === 'article' && state.auditIndex) {
        const { runs, joinedBy, vintage } = auditsForArticle(state.auditIndex, item, state.priorHashesByUrl);
        if (runs.length) {
            // Module rows join through the RUNS' anchor hash — a
            // prior-vintage join would otherwise show the aggregate
            // with its module rows silently missing.
            const hash = (runs[0] && runs[0].articleHash)
                || item.articleHash || (item.extra && item.extra.articleHash) || null;
            audit = {
                runs,
                joinedBy,
                vintage,
                modules: hash ? (state.auditIndex.modulesByHash.get(hash) || []) : [],
                disputesByTarget: state.auditIndex.disputesByTarget
            };
        }
    }
    renderInspector($('#xr-inspector'), item, { status, audit });
}

function buildRow(item) {
    const row = el('li', 'xr-row');
    const head = el('div', 'xr-row__head');
    head.appendChild(el('span', 'xr-row__kind', kindLabel(item.kind)));
    const titleEl = el('button', 'xr-row__title xr-row__title--link', truncate(item.title, 160));
    titleEl.type = 'button';
    titleEl.title = 'Inspect — raw event, relays holding it, ledger status';
    titleEl.addEventListener('click', () => openInspector(item));
    head.appendChild(titleEl);

    const badges = el('span', 'xr-row__badges');
    const status = state.reconciliation && state.reconciliation.statusByEventId[item.id];
    if (status === 'confirmed') {
        const b = el('span', 'xr-badge xr-badge--agree', '✓');
        b.title = 'In the local publish ledger and on the relays';
        badges.appendChild(b);
    } else if (status === 'remote-only') {
        const b = el('span', 'xr-badge xr-badge--case', '◌ remote-only');
        b.title = 'On the relays but not in this device\'s publish ledger — published from another device, or before the ledger existed';
        badges.appendChild(b);
    }
    const relayBadge = el('span', 'xr-badge', `${item.relays.length} relay${item.relays.length === 1 ? '' : 's'}`);
    relayBadge.title = item.relays.join('\n');
    badges.appendChild(relayBadge);
    // Audit chip (13.7) — the latest aggregate anchored to this
    // article. Display rules hold at chip size: review states show no
    // number, bands follow the rubric. URL joins (pre-13.4 hashless
    // articles only) are ADVISORY and say so.
    if (item.typeKey === 'article' && state.auditIndex) {
        const latest = latestAuditFor(state.auditIndex, item, state.priorHashesByUrl);
        const chip = auditCardChipData(latest);
        if (chip) {
            const advisory = latest.joinedBy === 'url';
            const prior = latest.vintage === 'prior';
            const b = el('span', `xr-badge xr-badge--audit-${chip.bandKey}`,
                chip.text + (advisory ? ' (URL match)' : prior ? ' (prior version)' : ''));
            b.title = chip.title + (advisory
                ? ' — joined by URL, text unverified: this capture predates content hashing'
                : prior
                    ? ' — anchored to an earlier capture of this article; the current text is unaudited'
                    : '');
            badges.appendChild(b);
        }
    }
    // Phase 23.1 — source-type badge (provenance). Primary sources get
    // a highlighted badge; the rest a subtle one. Absent when undeclared.
    if (item.sourceType && SOURCE_TYPE_LABELS[item.sourceType]) {
        const primary = isPrimarySourceType(item.sourceType);
        const b = el('span',
            `xr-badge ${primary ? 'xr-badge--primary-source' : ''}`,
            (primary ? '★ ' : '') + SOURCE_TYPE_LABELS[item.sourceType]);
        b.title = primary
            ? 'Declared a primary source — the originating record/research, not a write-up'
            : 'Declared source type';
        badges.appendChild(b);
    }
    if (isOtherClient(item)) {
        badges.appendChild(el('span', 'xr-badge xr-badge--warn', `via ${truncate(item.client, 24)}`));
    }
    for (const caseName of item.cases) {
        const pk = casePubkeyFor(caseName);
        const badge = el(pk ? 'button' : 'span', 'xr-badge xr-badge--case', truncate(caseName, 32));
        if (pk) {
            badge.type = 'button';
            badge.title = 'Open the case dashboard';
            badge.addEventListener('click', () => viewCallbacks.onOpenCase(pk));
        }
        badges.appendChild(badge);
    }
    // 24.2 — creator-binding badge on entity/case rows: ✓ when the
    // pubkey is manifest-listed AND token-verified, ◐ when only one
    // check passes. Absent = unbound (pre-24.2 posture).
    if ((item.typeKey === 'entity' || item.typeKey === 'case')
            && item.event.pubkey && state.creatorBinding) {
        const level = state.creatorBinding.get(item.event.pubkey);
        if (level === 'full') {
            const b = el('span', 'xr-badge xr-badge--agree', '✓ creator-bound');
            b.title = 'Listed in your signed OwnedKeys manifest AND carries a valid NIP-26 delegation token';
            badges.appendChild(b);
        } else if (level === 'partial') {
            const b = el('span', 'xr-badge', '◐ partially bound');
            b.title = 'Only one of the two binding checks passed (manifest listing / delegation token)';
            badges.appendChild(b);
        }
    }
    if ((item.typeKey === 'entity' || item.typeKey === 'case') && item.event.pubkey) {
        const btn = el('button', 'xr-badge xr-badge--action',
            item.typeKey === 'case' ? '☰ Dashboard' : '✳ Spokes');
        btn.type = 'button';
        btn.title = item.typeKey === 'case'
            ? 'Open this case\'s published-artifact dashboard'
            : 'Open this entity\'s spokes graph';
        btn.addEventListener('click', () => {
            if (item.typeKey === 'case') viewCallbacks.onOpenCase(item.event.pubkey);
            else viewCallbacks.onFocusEntity(item.event.pubkey);
        });
        badges.appendChild(btn);
    }
    head.appendChild(badges);

    if (item.created_at) {
        head.appendChild(el('span', 'xr-row__date', new Date(item.created_at * 1000).toLocaleString()));
    }
    row.appendChild(head);
    if (item.sub) row.appendChild(el('div', 'xr-row__sub', truncate(item.sub, 240)));

    // Raw event, relay holdings, and ledger status live in the
    // inspector drawer (12.6) — click the row title.
    return row;
}

function renderRows(allVisible) {
    const list = $('#xr-list');
    const empty = $('#xr-empty');
    empty.hidden = true;
    list.hidden = false;
    clear(list);

    // Incremental reveal (12.7): cap the DOM at rowLimit rows; counts,
    // facets, and the timeline still see the full filtered set.
    const { shown: visible, remaining } = pageWindow(allVisible, state.rowLimit);

    if (allVisible.length === 0) {
        if (state.items.length === 0) {
            renderEmpty('Nothing found on the relays', [
                'The configured relays returned no events for the resolved identities. '
                + 'If you publish from another device, add that identity above; otherwise publish a capture and refresh.'
            ]);
        } else {
            renderEmpty('No matches', ['Nothing matches the current search and filters.']);
        }
        return;
    }

    if (state.groupByDomain) {
        const groups = new Map(); // domain → items (insertion order = newest first)
        for (const item of visible) {
            const key = item.domain || '(no source URL)';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(item);
        }
        for (const [domain, items] of groups) {
            const header = el('li', 'xr-portal__group-head', `${domain} `);
            header.appendChild(el('span', 'xr-tab__count', String(items.length)));
            list.appendChild(header);
            for (const item of items) list.appendChild(buildRow(item));
        }
    } else {
        for (const item of visible) list.appendChild(buildRow(item));
    }

    if (remaining > 0) {
        const li = el('li', 'xr-portal__more-row');
        const btn = el('button', 'xr-portal__btn xr-portal__btn--ghost',
            `Show ${Math.min(ROW_PAGE_SIZE, remaining)} more (${remaining} remaining)`);
        btn.type = 'button';
        btn.addEventListener('click', () => {
            state.rowLimit += ROW_PAGE_SIZE;
            renderRows(applyFilters(state.items, state.filters));
        });
        li.appendChild(btn);
        list.appendChild(li);
    }
}

// ------------------------------------------------------------------
// Timeline (Phase 12.4): publish-date density + brush-to-filter
// ------------------------------------------------------------------

const TL_BAR_W = 6;     // viewBox units per bucket (4 bar + 2 gap)
const TL_HEIGHT = 56;

function fmtDay(ts) {
    return new Date(ts * 1000).toLocaleDateString();
}

// The predictions-due strip (13.7). Merges published 30058s with the
// local ledger (deduped by their shared sha16 identity); each open,
// scheduled entry offers Resolve… — resolutions file locally
// (ResolutionModel); the 30059 publishes in 13.8 behind the flag.
function renderPredictionsStrip(host) {
    if (!state.auditIndex) return;
    const { due, unscheduled, unscheduledList = [] } = predictionsDue(state.auditIndex, state.localPredictions, {
        nowMs: Date.now(), windowDays: 90
    });
    if (due.length === 0 && unscheduled === 0) return;

    const strip = el('div', 'xr-predue');
    const label = el('span', 'xr-predue__label',
        `Predictions due (90d): ${due.length}` + (unscheduled ? ` · ${unscheduled} unscheduled` : ''));
    strip.appendChild(label);

    // The resolver identity: the signer when known, never the
    // reserved sync key — a coordinate minted under the wrong key
    // would never match the 13.8 publish.
    const resolver = resolverIdentity(state.identities);
    // Dated rows first, then unscheduled open ones (the scorer never
    // emits horizon_iso, so CLI-imported predictions live here — the
    // Resolve… affordance must reach them too or the resolution arm
    // is unreachable for exactly the designed import flow).
    const rows = due.slice(0, 6);
    for (const u of unscheduledList) {
        if (rows.length >= 6) break;
        rows.push(u);
    }
    for (const p of rows) {
        const row = el('span', 'xr-predue__item');
        row.appendChild(el('span', 'xr-predue__date', p.horizonIso || 'unscheduled'));
        const text = el('span', 'xr-predue__text', truncate(p.text, 70));
        text.title = p.text;
        row.appendChild(text);
        // Coordinate: published entries carry it; local unpublished
        // ones resolve under the resolver identity (the v1 flow signs
        // predictions and resolutions with one key).
        const coordinate = p.coordinate
            || (resolver && p.localId ? `30058:${resolver.pubkey}:pred:${p.key}` : null);
        if (coordinate) {
            const btn = el('button', 'xr-badge xr-badge--action', 'Resolve…');
            btn.type = 'button';
            btn.title = 'File an evidence-bound resolution for this prediction';
            btn.addEventListener('click', async () => {
                const record = await openResolveForm({
                    text: p.text,
                    coordinate,
                    articleHash: p.articleHash || null,
                    resolverAuditor: resolver ? { kind: 'human', id: resolver.pubkey } : null
                });
                if (record) {
                    // Make the resolution visible NOW, not at next
                    // boot: derive the local prediction's status,
                    // merge the record into the index, refresh the
                    // local snapshots.
                    try {
                        if (p.localId) await PredictionModel.updateDerived(p.localId, [record]);
                        mergeLocalResolutions(state.auditIndex, [record]);
                        state.localPredictions = await listPredictions();
                    } catch (err) {
                        Utils.error('Portal: resolution refresh failed', err);
                    }
                    setStatus(`Resolution filed (${record.outcome}) — publishes with the 13.8 batch.`);
                    renderLibrary();
                }
            });
            row.appendChild(btn);
        } else {
            const why = el('span', 'xr-badge', 'no signing identity');
            why.title = 'Resolving needs a signing identity (not the sync key) — connect a signer or add one above.';
            row.appendChild(why);
        }
        strip.appendChild(row);
    }
    const totalOpen = due.length + unscheduledList.length;
    if (totalOpen > rows.length) {
        strip.appendChild(el('span', 'xr-predue__more', `+${totalOpen - rows.length} more`));
    }
    host.appendChild(strip);
}

function renderTimeline() {
    const host = $('#xr-timeline');
    clear(host);
    if (state.items.length === 0) { host.hidden = true; return; }
    host.hidden = false;

    // Density reflects every filter EXCEPT the brush itself, so the
    // bars show where the current cut lives in time.
    const base = applyFilters(state.items, { ...state.filters, after: 0, before: 0 });
    const { bucket, buckets } = buildBuckets(base);
    if (buckets.length === 0) { host.hidden = true; return; }

    const maxCount = Math.max(...buckets.map((b) => b.count), 1);
    const brushed = state.filters.after || state.filters.before;

    const head = el('div', 'xr-portal__timeline-head');
    head.appendChild(el('span', 'xr-portal__timeline-label',
        `${fmtDay(buckets[0].start)} – ${fmtDay(buckets[buckets.length - 1].end - 1)} · ${bucket} buckets`));
    if (brushed) {
        const chip = el('button', 'xr-portal__timeline-clear',
            `✕ ${fmtDay(state.filters.after)} – ${fmtDay(state.filters.before - 1)}`);
        chip.type = 'button';
        chip.title = 'Clear the time filter';
        chip.addEventListener('click', () => {
            state.filters.after = 0;
            state.filters.before = 0;
            state.rowLimit = ROW_PAGE_SIZE;
            renderLibrary();
        });
        head.appendChild(chip);
    }
    host.appendChild(head);

    // Predictions coming due (13.7) — the long-game asset made
    // visible: open ledger entries with a horizon inside 90 days,
    // each with the Resolve… affordance.
    renderPredictionsStrip(host);

    const svg = svgEl('svg', {
        viewBox: `0 0 ${buckets.length * TL_BAR_W} ${TL_HEIGHT}`,
        preserveAspectRatio: 'none',
        class: 'xr-portal__timeline-svg'
    });

    buckets.forEach((b, i) => {
        const h = b.count === 0 ? 0 : Math.max(2, Math.round((b.count / maxCount) * (TL_HEIGHT - 4)));
        const inBrush = brushed
            && b.start >= (state.filters.after || -Infinity)
            && b.end <= (state.filters.before || Infinity);
        const bar = svgEl('rect', {
            x: i * TL_BAR_W,
            y: TL_HEIGHT - h,
            width: TL_BAR_W - 2,
            height: Math.max(h, 0.5),  // zero-count buckets stay hoverable
            'data-index': i,
            class: 'xr-tl-bar'
                + (inBrush ? ' xr-tl-bar--active' : '')
                + (b.count === 0 ? ' xr-tl-bar--empty' : '')
        });
        const tip = svgEl('title', {});
        tip.textContent = `${fmtDay(b.start)} — ${b.count} item(s)`;
        bar.appendChild(tip);
        svg.appendChild(bar);
    });

    // Drag-to-brush: indices come from the bars' data attributes; a
    // plain click selects the single bucket.
    let dragStart = null;
    const indexFromEvent = (e) => {
        const idx = e.target && e.target.getAttribute && e.target.getAttribute('data-index');
        return idx === null || idx === undefined ? null : Number(idx);
    };
    svg.addEventListener('mousedown', (e) => {
        const idx = indexFromEvent(e);
        if (idx !== null) { dragStart = idx; e.preventDefault(); }
    });
    svg.addEventListener('mouseup', (e) => {
        if (dragStart === null) return;
        const idx = indexFromEvent(e);
        const range = brushRange(buckets, dragStart, idx === null ? dragStart : idx);
        dragStart = null;
        if (!range) return;
        state.filters.after = range.after;
        state.filters.before = range.before;
        state.rowLimit = ROW_PAGE_SIZE;
        renderLibrary();
    });
    svg.addEventListener('mouseleave', () => { dragStart = null; });

    host.appendChild(svg);
}

// ------------------------------------------------------------------
// Reconciliation (12.6): ledger vs relay truth, display-only
// ------------------------------------------------------------------

async function updateReconciliation() {
    try {
        const ledger = await loadLocalLedger({ pubkeys: state.identities.map((i) => i.pubkey) });
        state.reconciliation = reconcile(ledger, state.items);
        // ITEMIZED never-published local artifacts (the "My Archive
        // shows everything" requirement) — the count stays for the
        // summary line; the list renders below it.
        state.localArtifacts = await listLocalArtifacts();
        state.reconciliation.summary.localOnly = state.localArtifacts.length;
        // Annotate items so the status facet can filter on plain fields.
        for (const item of state.items) {
            item.reconStatus = state.reconciliation.statusByEventId[item.id] || 'no-ledger';
        }
    } catch (err) {
        Utils.error('Portal reconciliation failed:', err);
        state.reconciliation = null;
        state.localArtifacts = [];
    }
}

// Rebroadcast a journaled signed event VERBATIM (no re-signing, no
// NIP-07 prompt) — the repair action for reconcile's "missing" rows.
// The journal is the durability substrate; a missing journal row means
// the event predates the journal and needs a reader re-publish instead.
async function rebroadcastMissing(entry, statusEl) {
    try {
        statusEl.textContent = 'rebroadcasting…';
        const row = entry.publishedEventId ? await journalGetByEventId(entry.publishedEventId) : null;
        if (!row || !row.event) {
            statusEl.textContent = 'not in the journal (pre-journal publish) — re-publish from the reader';
            return;
        }
        const resp = await new Promise((resolve) => {
            chrome.runtime.sendMessage(
                { type: 'xray:relay:publish', event: row.event, relays: state.relays },
                (r) => resolve(r)
            );
        });
        if (resp && resp.ok && resp.results && resp.results.successful > 0) {
            const confirmed = typeof resp.results.confirmed === 'number' ? resp.results.confirmed : 0;
            statusEl.textContent = confirmed > 0
                ? `rebroadcast — ${confirmed}/${resp.results.total} relays confirmed`
                : `rebroadcast sent — no relay confirmed (may still land)`;
        } else {
            statusEl.textContent = 'rebroadcast failed: ' + ((resp && resp.error) || 'no relays accepted');
        }
    } catch (err) {
        Utils.error('Rebroadcast failed:', err);
        statusEl.textContent = 'rebroadcast failed: ' + (err.message || String(err));
    }
}

function renderReconPanel() {
    const host = $('#xr-recon');
    clear(host);
    const r = state.reconciliation;
    if (!r || (r.summary.ledgerPublished === 0 && r.summary.remoteOnly === 0
        && !(r.summary.localOnly > 0))) {
        host.hidden = true;
        return;
    }
    host.hidden = false;
    const s = r.summary;
    const line = el('div', 'xr-recon__line',
        `Local ledger says ${s.ledgerPublished} published; the relays confirm ${s.confirmed}`
        + (s.missing ? `; ${s.missing} missing` : '')
        + (s.remoteOnly ? `; ${s.remoteOnly} on relays only (another device, or pre-ledger)` : '')
        + (s.localOnly > 0 ? `; ${s.localOnly} local only (never published)` : '')
        + '.');
    line.classList.toggle('xr-recon__line--warn', s.missing > 0);
    host.appendChild(line);
    host.appendChild(el('div', 'xr-recon__legend',
        'Comments, linked accounts, and entity↔article links have no local publish ledger — '
        + 'they appear from relays only and are never counted as missing.'));

    if (r.missing.length > 0) {
        const details = el('details');
        const summary = el('summary', null, `Missing from the relays (${r.missing.length})`);
        details.appendChild(summary);
        const ul = el('ol', 'xr-portal__list');
        const statusEls = [];
        for (const entry of r.missing) {
            const row = el('li', 'xr-row');
            const head = el('div', 'xr-row__head');
            head.appendChild(el('span', 'xr-row__kind', entry.source));
            head.appendChild(el('span', 'xr-row__title', truncate(entry.label, 140)));
            if (entry.publishedAt) {
                head.appendChild(el('span', 'xr-row__date',
                    'marked published ' + new Date(entry.publishedAt * 1000).toLocaleString()));
            }
            const status = el('span', 'xr-recon__action-status', '');
            const btn = el('button', 'xr-portal__btn', 'Rebroadcast');
            btn.title = 'Re-send the journaled signed event verbatim — no re-signing';
            btn.addEventListener('click', () => {
                btn.disabled = true;
                rebroadcastMissing(entry, status).finally(() => { btn.disabled = false; });
            });
            head.appendChild(btn);
            head.appendChild(status);
            statusEls.push({ entry, status, btn });
            row.appendChild(head);
            row.appendChild(el('div', 'xr-row__sub',
                `event ${entry.publishedEventId ? entry.publishedEventId.slice(0, 16) + '…' : '?'} — `
                + 'no configured relay returned it. It may have been rejected, expired, or published to relays not configured here.'));
            ul.appendChild(row);
        }
        details.appendChild(ul);
        if (r.missing.length > 1) {
            const all = el('button', 'xr-portal__btn', `Rebroadcast all missing (${r.missing.length})`);
            all.addEventListener('click', async () => {
                all.disabled = true;
                for (const { entry, status, btn } of statusEls) {
                    btn.disabled = true;
                    await rebroadcastMissing(entry, status);
                    btn.disabled = false;
                }
                all.disabled = false;
            });
            details.appendChild(all);
        }
        host.appendChild(details);
    }

    // The itemized never-published bucket — every local artifact with
    // no publish mark, browsable instead of a bare count. Articles
    // (and anything URL-anchored) link back into the reader, where
    // Publish re-runs the selectors: that IS the re-sign path for
    // events that were never signed.
    const locals = state.localArtifacts || [];
    if (locals.length > 0) {
        const details = el('details');
        details.appendChild(el('summary', null, `Unpublished local artifacts (${locals.length})`));
        const ul = el('ol', 'xr-portal__list');
        for (const it of locals.slice(0, 200)) {
            const row = el('li', 'xr-row');
            const head = el('div', 'xr-row__head');
            head.appendChild(el('span', 'xr-row__kind', it.type));
            head.appendChild(el('span', 'xr-row__title', truncate(it.label || it.id, 140)));
            if (it.created) {
                head.appendChild(el('span', 'xr-row__date', new Date(it.created * 1000).toLocaleDateString()));
            }
            row.appendChild(head);
            if (it.url) {
                row.appendChild(el('div', 'xr-row__sub',
                    `${it.url} — open this article in the reader and Publish to emit it (and its judgments).`));
            }
            ul.appendChild(row);
        }
        if (locals.length > 200) {
            ul.appendChild(el('li', 'xr-inspector__mono', `… +${locals.length - 200} more`));
        }
        details.appendChild(ul);
        host.appendChild(details);
    }
}

function renderLibrary() {
    renderTabs();
    renderFacets();
    renderTimeline();
    renderReconPanel();
    renderRows(applyFilters(state.items, state.filters));
}

// ------------------------------------------------------------------
// View router (Phase 12.5): library | entity spokes | case dashboard
// ------------------------------------------------------------------

function libraryChromeVisible(visible) {
    $('#xr-tabs').hidden = !visible;
    $('#xr-facets').hidden = !visible;
    $('#xr-timeline').hidden = !visible || state.items.length === 0;
    $('#xr-recon').hidden = !visible || !state.reconciliation;
    $('#xr-list').hidden = !visible;
    $('#xr-empty').hidden = true;
    $('#xr-view').hidden = visible;
}

function closeInspector() {
    const host = $('#xr-inspector');
    host.hidden = true;
    clear(host);
}

// A running corpus analysis OWNS the case-view DOM. A re-render — the
// relay refresh landing, the audit-ledger / creator-binding /
// archive-vintage enrichments in rebuildItems, or a membership change
// (onReloadCase) — would tear the in-flight synthesis block out of the
// tree, orphaning the analysis (it keeps writing to detached nodes, so
// it looks "stopped") and jumping the scroll. Those renders route
// through scheduleRender() (display-only background) or
// scheduleUserRender() (an explicit edit), both of which DEFER while an
// analysis is in flight.
//
// On completion the two DEFERRED classes are treated differently:
//   - background renders are DROPPED — their data is display-only and in
//     state already, so it lands on the next render; re-rendering here
//     would tear the freshly-shown brief out and jump the scroll (the
//     case body re-mounts async, so no single-frame scroll restore is
//     reliable).
//   - a user EDIT (add/remove source, hypothesis authoring) is FLUSHED —
//     an explicit change must become visible; a scroll reset is the
//     acceptable price for that (and only happens if the user edited
//     mid-run, which is rare).
//
// Ownership is scoped to a per-run TOKEN, not a bare flag: navigating
// away calls render() directly, which unmounts the block and RESETS the
// guard (the abandoned run is gone with its DOM). That abandoned run's
// async chain still finishes and calls onAnalysisState(false, itsToken),
// but its token is no longer current, so it can neither clear the guard
// for a NEWER run nor flush a render that would tear the new run down.
let analysisInFlight = false;
let userEditQueuedDuringAnalysis = false;
let currentAnalysisToken = null;

// Display-only background/boot renders: dropped (not queued) during a
// run — the data is in state and repaints on the next render.
function scheduleRender() {
    if (analysisInFlight) return;
    render();
}

// Explicit user edits (membership / hypothesis authoring): deferred
// during a run, then FLUSHED on completion so the edit becomes visible.
function scheduleUserRender() {
    if (analysisInFlight) { userEditQueuedDuringAnalysis = true; return; }
    render();
}

// Called by the synthesis block at run start (running=true) and end
// (running=false), each with the SAME per-run token.
function setAnalysisState(running, token) {
    if (running) {
        currentAnalysisToken = token;
        analysisInFlight = true;
        return;
    }
    // Only the run that currently owns the guard may release it — a
    // stale/abandoned run's end is a no-op (its block is already gone).
    if (token !== currentAnalysisToken) return;
    analysisInFlight = false;
    currentAnalysisToken = null;
    if (userEditQueuedDuringAnalysis) {
        userEditQueuedDuringAnalysis = false;
        render();   // a deferred user edit must repaint; scroll reset is acceptable here
    }
}

const viewCallbacks = {
    onBack: () => { state.view = { name: 'library' }; closeInspector(); render(); },
    onFocusEntity: (pubkey) => { state.view = { name: 'entity', pubkey }; state.expandedTypes = new Set(); closeInspector(); render(); },
    onOpenCase: (pubkey) => { state.view = { name: 'case', pubkey }; closeInspector(); render(); },
    // 20.2: re-render the current case view after a local membership
    // change (add/remove sources). An explicit edit, so it defers during
    // a run and flushes on completion (scheduleUserRender) rather than
    // orphaning the run (direct render) or being dropped (scheduleRender).
    onReloadCase: () => { scheduleUserRender(); },
    onOpenGraph: (pubkey) => { state.view = { name: 'entity', pubkey }; state.expandedTypes = new Set(); closeInspector(); render(); },
    onExpand: (type) => { state.expandedTypes.add(type); render(); },
    onOpenItem: (item) => { openInspector(item); },
    // 19.4: the entity dossier is LOCAL-id addressed (local-first view
    // — the subject need not be published).
    onOpenEntityDossier: (entityId) => { state.view = { name: 'entity-dossier', entityId }; closeInspector(); render(); },
    // E5: the wire-first corpus view — works on any pubkey.
    onOpenEntityCorpus: (pubkey) => { state.view = { name: 'entity-corpus', pubkey }; closeInspector(); render(); },
    // The synthesis block signals its run boundaries (with a per-run
    // token) so background re-renders defer while it runs (scheduleRender).
    onAnalysisState: (running, token) => setAnalysisState(running, token),
    // The synthesis block queries this before persisting its result: an
    // abandoned run (user navigated away / started a newer run — render()
    // cleared the token) must not clobber the current brief or render to
    // its detached block.
    isCurrentRun: (token) => token === currentAnalysisToken
};

function render() {
    // Rebuilding #xr-view unmounts any live synthesis block, so a run
    // that was deferring renders is abandoned along with its DOM — drop
    // the guard so the NEW view renders freely. (The abandoned run's own
    // end-signal is ignored: its token is no longer current.)
    analysisInFlight = false;
    userEditQueuedDuringAnalysis = false;
    currentAnalysisToken = null;
    if (state.view.name === 'entity-dossier') {
        libraryChromeVisible(false);
        renderEntityDossierView($('#xr-view'), {
            entityId: state.view.entityId,
            relays: state.relays,
            callbacks: viewCallbacks
        });
    } else if (state.view.name === 'entity') {
        libraryChromeVisible(false);
        renderEntityView($('#xr-view'), {
            items: state.items,
            entityIndex: state.entityIndex,
            focusPubkey: state.view.pubkey,
            expandedTypes: state.expandedTypes,
            // 13.7: the audit dossier — derived, computed-on-open,
            // reproducible from the same events by anyone (the 30060
            // snapshot is just a cache of this).
            dossier: state.auditIndex
                ? computeEntityDossier(dossierInputsForEntity(state.items, state.auditIndex, state.view.pubkey, state.priorHashesByUrl))
                : null,
            findings: findingsForEntity(state.items, state.view.pubkey),
            populationMean: DEFAULT_POPULATION_MEAN,
            callbacks: viewCallbacks
        });
    } else if (state.view.name === 'entity-corpus') {
        // E5 — wire-first: renders from relay data, local names enrich.
        libraryChromeVisible(false);
        renderEntityCorpusView($('#xr-view'), {
            pubkey: state.view.pubkey,
            relays: state.relays.length ? state.relays : FALLBACK_RELAYS,
            entityIndex: state.entityIndex,
            callbacks: viewCallbacks
        });
    } else if (state.view.name === 'cross-workspace') {
        // 28.6 — the read-only view across workspaces; independent of
        // the relay corpus, it reads workspace snapshots itself.
        libraryChromeVisible(false);
        renderCrossWorkspaceView($('#xr-view'), { callbacks: viewCallbacks });
    } else if (state.view.name === 'case') {
        libraryChromeVisible(false);
        renderCaseView($('#xr-view'), {
            items: state.items,
            entityIndex: state.entityIndex,
            casePubkey: state.view.pubkey,
            dossier: state.auditIndex
                ? computeEntityDossier(dossierInputsForEntity(state.items, state.auditIndex, state.view.pubkey, state.priorHashesByUrl))
                : null,
            findings: findingsForEntity(state.items, state.view.pubkey),
            populationMean: DEFAULT_POPULATION_MEAN,
            callbacks: viewCallbacks
        });
    } else {
        libraryChromeVisible(true);
        renderLibrary();
    }
}

// ------------------------------------------------------------------
// Boot + refresh (cache-first since 12.3: render what we have, then
// refresh incrementally in the background and re-render the union)
// ------------------------------------------------------------------

// Clock-skew overlap for incremental refresh: re-ask for the last hour
// before the recorded sync point so a relay whose clock trails ours
// can't hide an event in the seam. Duplicates merge by event id.
const SYNC_OVERLAP_SECONDS = 3600;

function rebuildItems(records) {
    state.records = records;
    state.entityIndex = {};
    for (const e of state.entities) state.entityIndex[e.pubkey] = e;
    // The cache stores only the latest version per replaceable address,
    // so records arrive pre-deduped.
    state.items = buildItems(records, { entityIndex: state.entityIndex });

    // 13.7: the audit index — published audit events joined to
    // articles by canonical hash (URL fallback for pre-13.4 events),
    // then merged with the LOCAL xray-audits ledger (imported but
    // possibly unpublished runs). Async enrichment: render proceeds,
    // surfaces refresh when it lands.
    state.auditIndex = buildAuditIndex(state.items);
    state.localPredictions = [];
    Promise.all([listRuns(), listPredictions(), listResolutions()])
        .then(([runs, preds, resolutions]) => {
            mergeLocalRuns(state.auditIndex, runs);
            mergeLocalResolutions(state.auditIndex, resolutions);
            state.localPredictions = preds;
            scheduleRender();
        })
        .catch((err) => Utils.error('Portal: audit ledger load failed', err));

    // 24.2 — creator binding: which entity pubkeys are cryptographically
    // bound to the user's primary identity (OwnedKeys manifest + valid
    // NIP-26 token = full; one of the two = partial). Async enrichment:
    // badges land on the next render.
    state.creatorBinding = null;
    (async () => {
        const merged = new Map();
        for (const id of state.identities) {
            const bound = await computeCreatorBinding(records, id.pubkey);
            for (const [pk, level] of bound) {
                if (level === 'full' || !merged.has(pk)) merged.set(pk, level);
            }
        }
        state.creatorBinding = merged;
        scheduleRender();
    })().catch((err) => Utils.error('Portal: creator binding failed', err));
    // Prior capture vintages per URL (read-only archive lookup):
    // 13.8 anchors published audit events to the vintage they
    // audited, and the 30023 is replaceable — after a re-capture +
    // republish, a current-hash-only join would silently lose every
    // earlier audit. Prior vintages are still text-verified hash
    // joins, marked as joining OLDER text.
    state.priorHashesByUrl = null;
    listArchiveArticles()
        .then((records) => {
            const map = new Map();
            for (const rec of records || []) {
                if (!rec || !rec.url) continue;
                const hashes = [rec.articleHash,
                    ...((rec.priorVersions || []).map((v) => v && v.articleHash))].filter(Boolean);
                if (hashes.length) map.set(rec.url, hashes);
            }
            state.priorHashesByUrl = map;
            scheduleRender();
        })
        .catch((err) => Utils.error('Portal: archive vintage map failed', err));
}

function setBusy(busy) {
    state.loading = busy;
    $('#xr-refresh').disabled = busy;
    $('#xr-resync').disabled = busy;
    // The identity form re-boots on submit; mid-refresh that submit
    // would silently no-op (boot() early-returns while loading), so
    // make the unavailability visible instead (12.7 review fix).
    $('#xr-identity-input').disabled = busy;
    $('#xr-identity-form button').disabled = busy;
}

/**
 * @param {{full?: boolean}} [opts]  full=true drops the sync cursor
 *        (the cache itself is cleared by the Resync handler first)
 */
async function boot({ full = false } = {}) {
    if (state.loading) return;
    setBusy(true);
    try {
        setStatus('Resolving identity…');
        const { identities, viewers, entities, signer } = await resolveIdentities();
        state.identities = identities;
        state.viewers = viewers;
        state.entities = entities;
        state.signer = signer;
        renderIdentityChips();

        const prefs = await Storage.preferences.get() || {};
        state.relays = Array.isArray(prefs.default_relays) && prefs.default_relays.length > 0
            ? prefs.default_relays
            : FALLBACK_RELAYS;
        renderFooter();

        // Cache first: anything we already hold renders immediately.
        // A broken IndexedDB (quota, private mode) must not brick the
        // portal — degrade to live-only mode (12.7 review fix).
        let cached = [];
        state.cacheBroken = false;
        try {
            cached = await loadRecords();
        } catch (err) {
            Utils.error('Portal cache unavailable — running live-only:', err);
            state.cacheBroken = true;
        }
        if (cached.length > 0) {
            rebuildItems(cached);
            scheduleRender();
            setStatus(`${state.items.length} item(s) from cache — refreshing…`);
            // Ledger diff against the cached view while the refresh runs.
            updateReconciliation().then(() => renderReconPanel());
        }

        if (state.identities.length === 0 && state.viewers.length === 0 && state.entities.length === 0) {
            if (cached.length === 0) {
                setStatus('');
                const reason = state.signer && state.signer.reason
                    ? `Signing (${state.signer.method}): ${state.signer.reason}`
                    : 'No signing identity, sync key, publish history, or manual identity found.';
                renderEmpty('No identity resolved', [
                    reason,
                    'Paste your npub above, configure signing in Settings, or publish a capture once — then refresh.'
                ]);
            } else {
                setStatus(`${state.items.length} cached item(s) — no identity resolved, refresh skipped`, true);
            }
            return;
        }

        // Incremental only when the cursor is trustworthy: it must
        // exist AND have been written for the SAME identity and relay
        // sets — a new pubkey or relay needs its full history, not the
        // last hour (12.7 review fix). Cache-broken mode always runs full.
        const authorsKey = [
            ...state.identities.map((i) => i.pubkey),
            ...state.viewers.map((v) => v.pubkey),   // a viewer change needs its full history
            ...state.entities.map((e) => e.pubkey)
        ].sort().join(',');
        const relaysKey = [...state.relays].sort().join(',');
        let sync = null;
        if (!full && !state.cacheBroken) {
            try { sync = await getMeta('sync'); } catch (_) { /* live-only */ }
        }
        const cursorValid = sync && Number.isFinite(sync.lastSyncAt)
            && sync.authorsKey === authorsKey && sync.relaysKey === relaysKey;
        const since = cursorValid ? sync.lastSyncAt - SYNC_OVERLAP_SECONDS : undefined;
        const fetchStartedAt = Math.floor(Date.now() / 1000);

        setStatus(`Querying ${state.relays.length} relay(s)${since ? ' for new events' : ''}…`);
        // Viewers' events are FETCHED (that is the read-only-archive
        // feature) but viewers never join state.identities — reconcile,
        // creator binding, and the resolver identity stay "me"-only (28.4).
        const { records, relayErrors, truncated } = await fetchCorpus({
            pubkeys: [...state.identities, ...state.viewers].map((i) => i.pubkey),
            entityPubkeys: state.entities.map((e) => e.pubkey),
            relays: state.relays,
            since,
            onProgress: ({ fetched }) => setStatus(`Querying ${state.relays.length} relay(s)… ${fetched} event(s) so far`)
        });
        state.relayErrors = relayErrors;
        state.truncated = truncated;

        let stats = { added: records.length, updated: 0, superseded: 0, skippedStale: 0 };
        if (state.cacheBroken) {
            // Live-only mode: the cache normally dedupes at write time,
            // so collapse replaceable versions here instead.
            const live = dedupeReplaceable(records.map((r) => r.event));
            const liveIds = new Set(live.map((e) => e.id));
            rebuildItems(records.filter((r) => liveIds.has(r.event.id)));
        } else {
            try {
                stats = await saveRecords(records);
                rebuildItems(await loadRecords());
            } catch (err) {
                Utils.error('Portal cache write failed — rendering live results:', err);
                state.cacheBroken = true;
                const live = dedupeReplaceable(records.map((r) => r.event));
                const liveIds = new Set(live.map((e) => e.id));
                rebuildItems(records.filter((r) => liveIds.has(r.event.id)));
            }
        }
        await updateReconciliation();
        scheduleRender();

        const failed = Object.keys(relayErrors);
        // Advance the cursor only on a CLEAN pass: every relay answered
        // and no relay hit the page ceiling. Failure and truncation are
        // per-relay while the cursor is global — advancing it over a
        // partial fetch would hide the unfetched window from every
        // future incremental refresh (12.7 review fix).
        if (!state.cacheBroken && failed.length === 0 && !truncated) {
            try {
                await setMeta('sync', { lastSyncAt: fetchStartedAt, authorsKey, relaysKey });
            } catch (_) { /* live-only */ }
        }

        const parts = [`${state.items.length} item(s)`];
        if (stats.added > 0) parts.push(`+${stats.added} new`);
        if (stats.superseded > 0) parts.push(`${stats.superseded} replaced by newer versions`);
        parts.push(`${state.relays.length - failed.length}/${state.relays.length} relay(s)`);
        if (failed.length) parts.push(`failed: ${failed.join(', ')}`);
        if (truncated) parts.push('some relays hit the page ceiling — older events not shown');
        setStatus(parts.join(' — '), failed.length > 0);
    } catch (err) {
        Utils.error('Portal boot failed:', err);
        setStatus('Portal failed to load: ' + (err && err.message ? err.message : String(err)), true);
    } finally {
        setBusy(false);
    }
}

// The active-case switcher in the header (kickoff §4: the active case
// name always visible). The select's chosen option IS the chip; picking
// another case runs the same confirmed atomic switch as Options ▸ Cases
// and reloads. "Manage cases…" routes to Options.
async function renderCaseSwitcher() {
    const sel = $('#xr-case-switch');
    if (!sel) return;
    try {
        const [list, ctx] = await Promise.all([Workspaces.list(), describeActiveContext()]);
        sel.replaceChildren();
        for (const ws of list) {
            const label = ws.id === ctx.wsId
                ? `🗂 ${ctx.caseName || ctx.wsLabel}${ctx.profileLabel ? ` · ${ctx.profileLabel}` : ''}`
                : ws.label;
            const opt = new Option(label, ws.id);
            if (ws.id === ctx.wsId) opt.selected = true;
            sel.appendChild(opt);
        }
        sel.appendChild(new Option('⚙ Manage cases…', '__manage'));
        sel.dataset.active = ctx.wsId;
        sel.hidden = false;
        sel.onchange = async () => {
            const picked = sel.value;
            const active = sel.dataset.active;
            if (picked === '__manage') {
                sel.value = active;
                try { chrome.runtime.openOptionsPage(); } catch (_) { /* non-extension context */ }
                return;
            }
            if (picked === active) return;
            const target = list.find((w) => w.id === picked);
            if (!confirm(`Switch to "${(target && target.label) || picked}"?\n\nThis moves the storage namespace AND the signing identity together. Reload any other open X-Ray tabs afterwards.`)) {
                sel.value = active;
                return;
            }
            try {
                await Workspaces.activate(picked);
                location.reload();
            } catch (e) {
                sel.value = active;
                setStatus('Switch failed: ' + (e && e.message), true);
            }
        };
    } catch (err) {
        Utils.error('Case switcher failed', err);
        sel.hidden = true;
    }
}

function wireChrome() {
    renderCaseSwitcher();
    $('#xr-refresh').addEventListener('click', () => { boot(); });

    // 21.2 — import a podcast transcript into the archive (standalone;
    // it appears in case views + the local-artifacts list, not the relay
    // library, so no corpus reload). Toggle: a second click closes it.
    $('#xr-import-transcript').addEventListener('click', () => {
        const importHost = $('#xr-import-host');
        if (importHost.childElementCount > 0) { importHost.replaceChildren(); return; }
        mountTranscriptImport(importHost, { onDone: null });
    });

    // Import an EPUB book — each chapter becomes a capture grouped under a
    // book `thing` entity. Toggle-close like the transcript import; a
    // successful import refreshes the library so the book appears.
    $('#xr-import-book').addEventListener('click', () => {
        const importHost = $('#xr-import-host');
        if (importHost.childElementCount > 0) { importHost.replaceChildren(); return; }
        mountBookImport(importHost, { onDone: () => { boot(); } });
    });

    // 28.1 — batch-import a pasted URL list (standalone; the case-view
    // mount tags into the case). Toggle-close like the others.
    $('#xr-import-urls').addEventListener('click', () => {
        const importHost = $('#xr-import-host');
        if (importHost.childElementCount > 0) { importHost.replaceChildren(); return; }
        mountUrlImport(importHost, { onDone: null });
    });

    // 28.6 — the read-only cross-workspace graph.
    $('#xr-cross-ws').addEventListener('click', () => {
        state.view = { name: 'cross-workspace' };
        closeInspector();
        render();
    });

    $('#xr-resync').addEventListener('click', async () => {
        if (state.loading) return;
        try {
            await clearAll();
        } catch (err) {
            // A failed clear means the refetch would MERGE into the stale
            // cache and render the old corpus as if the resync worked —
            // say so on the page and stop, never silently (console-only
            // was how a fresh workspace kept showing the prior project).
            Utils.error('Portal resync: cache clear failed', err);
            setStatus('Cache clear failed — close every other X-Ray tab and retry Full resync', true);
            return;
        }
        boot({ full: true });
    });

    $('#xr-identity-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = $('#xr-identity-input');
        const result = await addManualIdentity(input.value);
        if (!result.ok) {
            setStatus(result.error, true);
            return;
        }
        input.value = '';
        await boot();
    });

    // Identity is MANAGED in Settings ▸ Signing; the input above only
    // adds read-only viewer npubs for other archives.
    $('#xr-identity-settings').addEventListener('click', () => {
        try { chrome.runtime.openOptionsPage(); } catch (_) { /* non-extension context */ }
    });

    let searchTimer = null;
    $('#xr-search').addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            state.filters.query = e.target.value;
            state.rowLimit = ROW_PAGE_SIZE;
            renderLibrary();
        }, 150);
    });

    // 'client' and 'status' are enum facets whose empty value means
    // 'all'; the value facets fall back to '' (no filter).
    const facetWiring = [
        ['#xr-facet-platform', 'platform', ''],
        ['#xr-facet-domain', 'domain', ''],
        ['#xr-facet-case', 'caseName', ''],
        ['#xr-facet-client', 'client', 'all'],
        ['#xr-facet-status', 'status', 'all']
    ];
    for (const [sel, field, fallback] of facetWiring) {
        $(sel).addEventListener('change', (e) => {
            state.filters[field] = e.target.value || fallback;
            state.rowLimit = ROW_PAGE_SIZE;
            renderLibrary();
        });
    }

    $('#xr-group-domain').addEventListener('change', (e) => {
        state.groupByDomain = e.target.checked;
        renderLibrary();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    wireChrome();
    // 19.4 deep-link: `#dossier=<entityId>` (the side panel's "Open
    // full dossier" hand-off). Parsed ONCE at boot; a dangling id
    // falls back silently to the library; no history writes.
    const dossierMatch = /#dossier=(entity_[0-9a-f]{16})/.exec(location.hash || '');
    if (dossierMatch) {
        state.view = { name: 'entity-dossier', entityId: dossierMatch[1] };
        render();
    }
    boot();
});

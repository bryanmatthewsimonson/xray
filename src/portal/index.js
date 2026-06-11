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
import { resolveIdentities, addManualIdentity, removeManualIdentity } from './identity.js';
import { fetchCorpus, FALLBACK_RELAYS } from './corpus.js';
import { saveRecords, loadRecords, getMeta, setMeta, clearAll } from './portal-cache.js';
import {
    buildItems, applyFilters, typeCounts, facetValues, isOtherClient,
    kindLabel, TYPE_DEFS, EMPTY_FILTERS
} from './library.js';
import { buildBuckets, brushRange } from './timeline.js';
import { el, svgEl, clear, truncate, shortKey } from './dom.js';
import { renderEntityView } from './entity-view.js';
import { renderCaseView } from './case-view.js';
import { loadLocalLedger, reconcile } from './reconcile.js';
import { renderInspector } from './inspector.js';

const $ = (sel) => document.querySelector(sel);

const state = {
    identities: [],      // [{pubkey, sources}]
    entities: [],        // [{pubkey, entityId, name, type}]
    entityIndex: {},     // pubkey → {entityId, name, type}
    signer: null,        // {method, pubkey, reason}
    relays: [],
    records: [],         // [{event, relays}] — raw, pre-dedupe
    items: [],           // library items (deduped, parsed, sorted)
    filters: { ...EMPTY_FILTERS },
    groupByDomain: false,
    view: { name: 'library' },   // | {name:'entity', pubkey} | {name:'case', pubkey}
    expandedTypes: new Set(),    // graph sectors the user expanded
    reconciliation: null,        // {summary, missing, statusByEventId} (12.6)
    relayErrors: {},
    truncated: false,
    loading: false
};

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
    renderInspector($('#xr-inspector'), item, { status });
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

function renderRows(visible) {
    const list = $('#xr-list');
    const empty = $('#xr-empty');
    empty.hidden = true;
    list.hidden = false;
    clear(list);

    if (visible.length === 0) {
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
}

// ------------------------------------------------------------------
// Timeline (Phase 12.4): publish-date density + brush-to-filter
// ------------------------------------------------------------------

const TL_BAR_W = 6;     // viewBox units per bucket (4 bar + 2 gap)
const TL_HEIGHT = 56;

function fmtDay(ts) {
    return new Date(ts * 1000).toLocaleDateString();
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
            renderLibrary();
        });
        head.appendChild(chip);
    }
    host.appendChild(head);

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
    } catch (err) {
        Utils.error('Portal reconciliation failed:', err);
        state.reconciliation = null;
    }
}

function renderReconPanel() {
    const host = $('#xr-recon');
    clear(host);
    const r = state.reconciliation;
    if (!r || (r.summary.ledgerPublished === 0 && r.summary.remoteOnly === 0)) {
        host.hidden = true;
        return;
    }
    host.hidden = false;
    const s = r.summary;
    const line = el('div', 'xr-recon__line',
        `Local ledger says ${s.ledgerPublished} published; the relays confirm ${s.confirmed}`
        + (s.missing ? `; ${s.missing} missing` : '')
        + (s.remoteOnly ? `; ${s.remoteOnly} on relays only (another device, or pre-ledger)` : '')
        + '.');
    line.classList.toggle('xr-recon__line--warn', s.missing > 0);
    host.appendChild(line);

    if (r.missing.length > 0) {
        const details = el('details');
        details.appendChild(el('summary', null, `Missing from the relays (${r.missing.length})`));
        const ul = el('ol', 'xr-portal__list');
        for (const entry of r.missing) {
            const row = el('li', 'xr-row');
            const head = el('div', 'xr-row__head');
            head.appendChild(el('span', 'xr-row__kind', entry.source));
            head.appendChild(el('span', 'xr-row__title', truncate(entry.label, 140)));
            if (entry.publishedAt) {
                head.appendChild(el('span', 'xr-row__date',
                    'marked published ' + new Date(entry.publishedAt * 1000).toLocaleString()));
            }
            row.appendChild(head);
            row.appendChild(el('div', 'xr-row__sub',
                `event ${entry.publishedEventId ? entry.publishedEventId.slice(0, 16) + '…' : '?'} — `
                + 'no configured relay returned it. It may have been rejected, expired, or published to relays not configured here.'));
            ul.appendChild(row);
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

const viewCallbacks = {
    onBack: () => { state.view = { name: 'library' }; closeInspector(); render(); },
    onFocusEntity: (pubkey) => { state.view = { name: 'entity', pubkey }; state.expandedTypes = new Set(); closeInspector(); render(); },
    onOpenCase: (pubkey) => { state.view = { name: 'case', pubkey }; closeInspector(); render(); },
    onOpenGraph: (pubkey) => { state.view = { name: 'entity', pubkey }; state.expandedTypes = new Set(); closeInspector(); render(); },
    onExpand: (type) => { state.expandedTypes.add(type); render(); }
};

function render() {
    if (state.view.name === 'entity') {
        libraryChromeVisible(false);
        renderEntityView($('#xr-view'), {
            items: state.items,
            entityIndex: state.entityIndex,
            focusPubkey: state.view.pubkey,
            expandedTypes: state.expandedTypes,
            callbacks: viewCallbacks
        });
    } else if (state.view.name === 'case') {
        libraryChromeVisible(false);
        renderCaseView($('#xr-view'), {
            items: state.items,
            entityIndex: state.entityIndex,
            casePubkey: state.view.pubkey,
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
}

function setBusy(busy) {
    state.loading = busy;
    $('#xr-refresh').disabled = busy;
    $('#xr-resync').disabled = busy;
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
        const { identities, entities, signer } = await resolveIdentities();
        state.identities = identities;
        state.entities = entities;
        state.signer = signer;
        renderIdentityChips();

        const prefs = await Storage.preferences.get() || {};
        state.relays = Array.isArray(prefs.default_relays) && prefs.default_relays.length > 0
            ? prefs.default_relays
            : FALLBACK_RELAYS;
        renderFooter();

        // Cache first: anything we already hold renders immediately.
        const cached = await loadRecords();
        if (cached.length > 0) {
            rebuildItems(cached);
            render();
            setStatus(`${state.items.length} item(s) from cache — refreshing…`);
            // Ledger diff against the cached view while the refresh runs.
            updateReconciliation().then(() => renderReconPanel());
        }

        if (state.identities.length === 0 && state.entities.length === 0) {
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

        // Incremental unless asked for a full pass or never synced.
        const sync = full ? null : await getMeta('sync');
        const since = sync && Number.isFinite(sync.lastSyncAt)
            ? sync.lastSyncAt - SYNC_OVERLAP_SECONDS
            : undefined;
        const fetchStartedAt = Math.floor(Date.now() / 1000);

        setStatus(`Querying ${state.relays.length} relay(s)${since ? ' for new events' : ''}…`);
        const { records, relayErrors, truncated } = await fetchCorpus({
            pubkeys: state.identities.map((i) => i.pubkey),
            entityPubkeys: state.entities.map((e) => e.pubkey),
            relays: state.relays,
            since,
            onProgress: ({ fetched }) => setStatus(`Querying ${state.relays.length} relay(s)… ${fetched} event(s) so far`)
        });
        state.relayErrors = relayErrors;
        state.truncated = truncated;

        const stats = await saveRecords(records);
        rebuildItems(await loadRecords());
        await updateReconciliation();
        render();

        const failed = Object.keys(relayErrors);
        // Only advance the cursor when at least one relay answered in
        // full — an all-failed refresh must not eat the window.
        if (failed.length < state.relays.length) {
            await setMeta('sync', { lastSyncAt: fetchStartedAt });
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

function wireChrome() {
    $('#xr-refresh').addEventListener('click', () => { boot(); });

    $('#xr-resync').addEventListener('click', async () => {
        if (state.loading) return;
        try {
            await clearAll();
        } catch (err) {
            Utils.error('Portal resync: cache clear failed', err);
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

    let searchTimer = null;
    $('#xr-search').addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            state.filters.query = e.target.value;
            renderLibrary();
        }, 150);
    });

    const facetWiring = [
        ['#xr-facet-platform', 'platform'],
        ['#xr-facet-domain', 'domain'],
        ['#xr-facet-case', 'caseName'],
        ['#xr-facet-client', 'client']
    ];
    for (const [sel, field] of facetWiring) {
        $(sel).addEventListener('change', (e) => {
            state.filters[field] = e.target.value || (field === 'client' ? 'all' : '');
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
    boot();
});

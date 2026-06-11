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

const $ = (sel) => document.querySelector(sel);

const state = {
    identities: [],      // [{pubkey, sources}]
    entities: [],        // [{pubkey, entityId, name, type}]
    signer: null,        // {method, pubkey, reason}
    relays: [],
    records: [],         // [{event, relays}] — raw, pre-dedupe
    items: [],           // library items (deduped, parsed, sorted)
    filters: { ...EMPTY_FILTERS },
    groupByDomain: false,
    relayErrors: {},
    truncated: false,
    loading: false
};

// ------------------------------------------------------------------
// Small DOM helpers
// ------------------------------------------------------------------

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
}

function shortKey(pubkey) {
    return pubkey.slice(0, 8) + '…' + pubkey.slice(-4);
}

function truncate(s, n) {
    const str = String(s || '').trim();
    return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

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

function buildRow(item) {
    const row = el('li', 'xr-row');
    const head = el('div', 'xr-row__head');
    head.appendChild(el('span', 'xr-row__kind', kindLabel(item.kind)));
    head.appendChild(el('span', 'xr-row__title', truncate(item.title, 160)));

    const badges = el('span', 'xr-row__badges');
    const relayBadge = el('span', 'xr-badge', `${item.relays.length} relay${item.relays.length === 1 ? '' : 's'}`);
    relayBadge.title = item.relays.join('\n');
    badges.appendChild(relayBadge);
    if (isOtherClient(item)) {
        badges.appendChild(el('span', 'xr-badge xr-badge--warn', `via ${truncate(item.client, 24)}`));
    }
    for (const caseName of item.cases) {
        badges.appendChild(el('span', 'xr-badge xr-badge--case', truncate(caseName, 32)));
    }
    head.appendChild(badges);

    if (item.created_at) {
        head.appendChild(el('span', 'xr-row__date', new Date(item.created_at * 1000).toLocaleString()));
    }
    row.appendChild(head);
    if (item.sub) row.appendChild(el('div', 'xr-row__sub', truncate(item.sub, 240)));

    const details = el('details');
    details.appendChild(el('summary', null, 'Raw event'));
    const pre = el('pre');
    // Serialize lazily — hundreds of large 30023s stringified up front
    // would make first paint pay for JSON nobody opened.
    details.addEventListener('toggle', () => {
        if (details.open && !pre.textContent) {
            pre.textContent = JSON.stringify(item.event, null, 2);
        }
    });
    details.appendChild(pre);
    row.appendChild(details);
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

function renderLibrary() {
    renderTabs();
    renderFacets();
    renderRows(applyFilters(state.items, state.filters));
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
    const entityIndex = {};
    for (const e of state.entities) entityIndex[e.pubkey] = e;
    // The cache stores only the latest version per replaceable address,
    // so records arrive pre-deduped.
    state.items = buildItems(records, { entityIndex });
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
            renderLibrary();
            setStatus(`${state.items.length} item(s) from cache — refreshing…`);
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
        renderLibrary();

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

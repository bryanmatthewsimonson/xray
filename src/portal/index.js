// X-Ray portal — "My Archive" (Phase 12.1, docs/PORTAL_DESIGN.md).
//
// Slice 12.1 is the end-to-end pipe: resolve who "me" is, pull the
// published corpus off the configured relays through the background
// pool, collapse replaceable versions, and render a flat newest-first
// list with per-kind one-line summaries and the raw signed event a
// click away. Type views, search, caching, the graph, and
// reconciliation land in later slices on top of this.
//
// All DOM here is built with createElement/textContent — no dynamic
// innerHTML (keeps web-ext's UNSAFE_VAR_ASSIGNMENT warnings from
// multiplying and makes escaping a non-issue).

import { Storage } from '../shared/storage.js';
import { Utils } from '../shared/utils.js';
import { EventBuilder } from '../shared/event-builder.js';
import { parseClaimEvent } from '../shared/claim-model.js';
import { parseAssessmentEvent } from '../shared/assessment-model.js';
import { parseRelationshipEvent } from '../shared/evidence-linker.js';
import { dedupeReplaceable } from '../shared/nostr-events.js';
import { resolveIdentities, addManualIdentity, removeManualIdentity } from './identity.js';
import { fetchCorpus, FALLBACK_RELAYS } from './corpus.js';

const $ = (sel) => document.querySelector(sel);

// Tags written by this extension (current + userscript-era value).
const OUR_CLIENT_TAGS = new Set(['xray', 'nostr-article-capture']);

const KIND_LABELS = {
    30023: 'Article',
    30040: 'Claim',
    30041: 'Comment',
    30054: 'Assessment',
    30055: 'Link',
    1985:  'Label',
    0:     'Profile',
    32125: 'Entity link',
    32126: 'Account',
    10002: 'Relay list',
    30078: 'Entity sync',
    30050: 'Annotation',
    30051: 'Fact-check',
    30052: 'Rating',
    30053: 'Topic trust',
    9803:  'Vote'
};

const state = {
    identities: [],      // [{pubkey, sources}]
    entities: [],        // [{pubkey, entityId, name, type}]
    signer: null,        // {method, pubkey, reason}
    relays: [],
    records: [],         // [{event, relays}]
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

// ------------------------------------------------------------------
// Per-kind one-line summaries (the 12.1 generic rows; richer per-type
// renderers arrive with the Library slice)
// ------------------------------------------------------------------

function firstTag(event, name) {
    const t = (event.tags || []).find((x) => x[0] === name);
    return t ? t[1] : '';
}

function truncate(s, n) {
    const str = String(s || '').trim();
    return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function domainOf(url) {
    try { return new URL(url).hostname; } catch (_) { return ''; }
}

/** @returns {{title: string, sub: string}} */
function summarize(event) {
    switch (event.kind) {
        case 30023: {
            const title = firstTag(event, 'title') || '(untitled capture)';
            const url = firstTag(event, 'r');
            return { title, sub: domainOf(url) || url };
        }
        case 30040: {
            const c = parseClaimEvent(event);
            return { title: truncate(c.text, 140) || '(empty claim)', sub: c.source ? `source: ${c.source}` : '' };
        }
        case 30041: {
            const c = EventBuilder.parseCommentEvent(event);
            if (!c) return { title: '(unparsable comment)', sub: '' };
            return { title: truncate(c.text, 140), sub: `${c.author} · ${c.platform}` };
        }
        case 30054: {
            const a = parseAssessmentEvent(event);
            if (!a) return { title: '(unparsable assessment)', sub: '' };
            const bits = [];
            if (a.stance !== null) bits.push(`stance ${a.stance > 0 ? '+' : ''}${a.stance}`);
            if (a.labels.length) bits.push(a.labels.map((l) => l.label).join(', '));
            return { title: bits.join(' · ') || '(judgment)', sub: truncate(a.rationale, 120) };
        }
        case 30055: {
            const r = parseRelationshipEvent(event);
            if (!r) return { title: '(unparsable link)', sub: '' };
            return { title: r.relationship || '(link)', sub: truncate(r.note, 120) || `${r.urls.length} source(s)` };
        }
        case 1985: {
            const labels = (event.tags || []).filter((t) => t[0] === 'l').map((t) => t[1]);
            return { title: labels.join(', ') || '(label)', sub: firstTag(event, 'r') };
        }
        case 0: {
            let name = '';
            let about = '';
            try {
                const profile = JSON.parse(event.content || '{}');
                name = profile.name || '';
                about = profile.about || '';
            } catch (_) { /* malformed profile content */ }
            return { title: name || '(profile)', sub: truncate(about, 120) };
        }
        case 32125: {
            return {
                title: `${firstTag(event, 'entity-name') || '(entity)'} — ${firstTag(event, 'relationship') || 'related'}`,
                sub: firstTag(event, 'r')
            };
        }
        case 32126: {
            const acct = EventBuilder.reconstructPlatformAccount(event);
            if (!acct) return { title: '(unparsable account)', sub: '' };
            return {
                title: `${acct.platform}: ${acct.handle || acct.displayName || acct.stableId}`,
                sub: acct.linkedEntityId ? `linked to ${acct.linkedEntityId}` : ''
            };
        }
        case 10002: {
            const relays = (event.tags || []).filter((t) => t[0] === 'r').map((t) => t[1]);
            return { title: `${relays.length} relay(s) declared`, sub: relays.join('  ') };
        }
        case 30078: {
            return { title: firstTag(event, 'd') || '(entity sync)', sub: 'encrypted — listed, not decrypted' };
        }
        default: {
            const d = firstTag(event, 'd');
            const r = firstTag(event, 'r');
            return { title: d || event.id || '(event)', sub: r };
        }
    }
}

// ------------------------------------------------------------------
// Rendering
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

function renderEmpty() {
    const host = $('#xr-empty');
    clear(host);
    host.hidden = false;
    $('#xr-list').hidden = true;
    host.appendChild(el('h2', null, 'No identity resolved'));
    const reason = state.signer && state.signer.reason
        ? `Signing (${state.signer.method}): ${state.signer.reason}`
        : 'No signing identity, sync key, publish history, or manual identity found.';
    host.appendChild(el('p', null, reason));
    host.appendChild(el('p', null,
        'Paste your npub above, configure signing in Settings, or publish a capture once — then refresh.'));
}

function renderRows() {
    const list = $('#xr-list');
    const empty = $('#xr-empty');
    empty.hidden = true;
    list.hidden = false;
    clear(list);

    const relaysByEventId = new Map(state.records.map((r) => [r.event.id, r.relays]));
    const display = dedupeReplaceable(state.records.map((r) => r.event))
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    for (const event of display) {
        const row = el('li', 'xr-row');
        const head = el('div', 'xr-row__head');
        head.appendChild(el('span', 'xr-row__kind', KIND_LABELS[event.kind] || `kind ${event.kind}`));

        const { title, sub } = summarize(event);
        head.appendChild(el('span', 'xr-row__title', title));

        const badges = el('span', 'xr-row__badges');
        const relays = relaysByEventId.get(event.id) || [];
        const relayBadge = el('span', 'xr-badge', `${relays.length} relay${relays.length === 1 ? '' : 's'}`);
        relayBadge.title = relays.join('\n');
        badges.appendChild(relayBadge);
        const client = firstTag(event, 'client');
        if (client && !OUR_CLIENT_TAGS.has(client)) {
            badges.appendChild(el('span', 'xr-badge xr-badge--warn', `via ${truncate(client, 24)}`));
        }
        head.appendChild(badges);

        if (event.created_at) {
            head.appendChild(el('span', 'xr-row__date', new Date(event.created_at * 1000).toLocaleString()));
        }
        row.appendChild(head);
        if (sub) row.appendChild(el('div', 'xr-row__sub', sub));

        const details = el('details');
        details.appendChild(el('summary', null, 'Raw event'));
        const pre = el('pre');
        // Serialize lazily — hundreds of large 30023s stringified up
        // front would make first paint pay for JSON nobody opened.
        details.addEventListener('toggle', () => {
            if (details.open && !pre.textContent) {
                pre.textContent = JSON.stringify(event, null, 2);
            }
        }, { once: false });
        details.appendChild(pre);
        row.appendChild(details);

        list.appendChild(row);
    }

    if (display.length === 0) {
        const host = empty;
        clear(host);
        host.hidden = false;
        list.hidden = true;
        host.appendChild(el('h2', null, 'Nothing found on the relays'));
        host.appendChild(el('p', null,
            'The configured relays returned no events for the resolved identities. '
            + 'If you publish from another device, add that identity above; otherwise publish a capture and refresh.'));
    }
}

function renderFooter() {
    $('#xr-footer-relays').textContent = state.relays.length
        ? `Relays: ${state.relays.join('  ')}`
        : 'No relays configured.';
}

// ------------------------------------------------------------------
// Boot + refresh
// ------------------------------------------------------------------

async function boot() {
    if (state.loading) return;
    state.loading = true;
    $('#xr-refresh').disabled = true;
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

        if (state.identities.length === 0 && state.entities.length === 0) {
            setStatus('');
            renderEmpty();
            return;
        }

        setStatus(`Querying ${state.relays.length} relay(s)…`);
        const { records, relayErrors, truncated } = await fetchCorpus({
            pubkeys: state.identities.map((i) => i.pubkey),
            entityPubkeys: state.entities.map((e) => e.pubkey),
            relays: state.relays,
            onProgress: ({ fetched }) => setStatus(`Querying ${state.relays.length} relay(s)… ${fetched} event(s) so far`)
        });
        state.records = records;
        state.relayErrors = relayErrors;
        state.truncated = truncated;

        renderRows();

        const failed = Object.keys(relayErrors);
        const parts = [`${records.length} event(s) from ${state.relays.length - failed.length}/${state.relays.length} relay(s)`];
        if (failed.length) parts.push(`failed: ${failed.join(', ')}`);
        if (truncated) parts.push('some relays hit the page ceiling — older events not shown');
        setStatus(parts.join(' — '), failed.length > 0);
    } catch (err) {
        Utils.error('Portal boot failed:', err);
        setStatus('Portal failed to load: ' + (err && err.message ? err.message : String(err)), true);
    } finally {
        state.loading = false;
        $('#xr-refresh').disabled = false;
    }
}

function wireChrome() {
    $('#xr-refresh').addEventListener('click', () => { boot(); });
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
}

document.addEventListener('DOMContentLoaded', () => {
    wireChrome();
    boot();
});

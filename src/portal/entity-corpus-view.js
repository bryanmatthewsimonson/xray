// Entity corpus view — Phase 17 E5 (ENTITY_CORPUS_DESIGN.md §4.4).
// Given ANY entity pubkey — yours or a stranger's — two relay queries:
//
//   { authors: [P], kinds: [0, 1] }                 the entity's own voice
//   { '#p': [P], kinds: [30023, 30040, 30054,       what the network says
//               30062, 30063, 32125] }              about it
//
// merged into one timeline: mentioned in… / quoted saying… / claim
// about… / verdict on… Everything renders from WIRE data (the 30040
// quote tag shipped for exactly this), so the view works identically
// for entities you didn't create; the local registry only enriches
// names when present. Read-only — nothing here writes or publishes.

import { el, clear, truncate, shortKey } from './dom.js';
import { Utils } from '../shared/utils.js';
import { dedupeReplaceable } from '../shared/nostr-events.js';

// Exported: these two filters ARE the §4.4 wire contract.
// (kind 30067 fact sheets retired 2026-07-20 — no longer requested;
// foreign sheets still on relays are simply never fetched.)
export const AUTHORED_FILTER = (pk) => ({ authors: [pk], kinds: [0, 1], limit: 200 });
export const ABOUT_FILTER = (pk) => ({ '#p': [pk], kinds: [30023, 30040, 30054, 30062, 30063, 32125], limit: 300 });

const KIND_LABELS = {
    1: 'mention note',
    30023: 'article',
    30040: 'claim about',
    30054: 'assessment',
    30062: 'forensic finding',
    30063: 'verdict',
    32125: 'article link'
};

function firstTag(ev, name) {
    const t = (ev.tags || []).find((x) => x[0] === name);
    return t ? t[1] : '';
}

export function rowText(ev) {
    if (ev.kind === 1) return (ev.content || '').split('\n')[0];
    if (ev.kind === 30023) return firstTag(ev, 'title') || firstTag(ev, 'r') || '(untitled article)';
    if (ev.kind === 30040) return ev.content || firstTag(ev, 'claim-text') || '(claim)';
    if (ev.kind === 32125) return firstTag(ev, 'r') || '(article relationship)';
    return (ev.content || '').slice(0, 200) || `kind ${ev.kind}`;
}

function query(relays, filter, timeoutMs) {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ type: 'xray:relay:query', relays, filter, timeoutMs }, (r) => resolve(r));
        } catch (_) { resolve(null); }
    });
}

/**
 * @param {HTMLElement} host
 * @param {object} params
 * @param {string} params.pubkey       the entity pubkey (64-hex)
 * @param {Array}  params.relays
 * @param {object} [params.entityIndex] pubkey → {name,type} local enrichment
 * @param {object} params.callbacks    {onBack()}
 */
export function renderEntityCorpusView(host, { pubkey, relays, entityIndex = {}, callbacks = {} }) {
    clear(host);
    const local = entityIndex[pubkey];

    const head = el('div', 'xr-view__head');
    const back = el('button', 'xr-portal__btn xr-portal__btn--ghost', '← Back');
    back.type = 'button';
    back.addEventListener('click', () => callbacks.onBack && callbacks.onBack());
    head.appendChild(back);
    head.appendChild(el('span', 'xr-view__title', local ? `${local.name} — corpus` : 'Entity corpus'));
    head.appendChild(el('span', 'xr-badge xr-badge--muted', 'wire-first · read-only'));
    const key = el('span', 'xr-view__counts', shortKey(pubkey));
    key.title = pubkey;
    head.appendChild(key);
    host.appendChild(head);

    host.appendChild(el('div', 'xr-case__explainer',
        'The entity\'s corpus as the NETWORK sees it: its own profile, mention notes, and fact '
        + 'sheet (signed by the entity key), plus every article, claim, assessment, finding, and '
        + 'verdict that p-tags it. Rendered from relay data — this view works the same for an '
        + 'entity you did not create.'));

    const body = el('div', 'xr-ecorpus');
    host.appendChild(body);
    body.appendChild(el('div', 'xr-inspector__mono', `Querying ${relays.length} relay${relays.length === 1 ? '' : 's'}…`));

    (async () => {
        if (!relays.length) {
            clear(body);
            body.appendChild(el('p', 'xr-view__empty', 'No relays configured — add some in Settings → Relays.'));
            return;
        }
        const [authored, about] = await Promise.all([
            query(relays, AUTHORED_FILTER(pubkey), 8000),
            query(relays, ABOUT_FILTER(pubkey), 8000)
        ]);
        clear(body);
        if ((!authored || !authored.ok) && (!about || !about.ok)) {
            body.appendChild(el('p', 'xr-view__empty',
                `Relay query failed: ${(authored && authored.error) || (about && about.error) || 'no response'}`));
            return;
        }

        const events = dedupeReplaceable([
            ...((authored && authored.events) || []),
            ...((about && about.events) || [])
        ].filter((ev) => ev && ev.id));

        // The entity's own kind-0 heads the view.
        const profile = events.find((ev) => ev.kind === 0 && ev.pubkey === pubkey);
        if (profile) {
            let meta = {};
            try { meta = JSON.parse(profile.content) || {}; } catch (_) { /* raw */ }
            const card = el('div', 'xr-ecorpus__profile');
            card.appendChild(el('div', 'xr-view__title', meta.name || '(unnamed)'));
            if (meta.about) card.appendChild(el('div', 'xr-view__dossier-line', meta.about));
            const ids = (profile.tags || []).filter((t) => t[0] === 'i').map((t) => t[1]);
            if (ids.length) {
                card.appendChild(el('div', 'xr-view__dossier-line', `External ids: ${ids.join(' · ')}`));
            }
            const refersTo = firstTag(profile, 'refers_to');
            if (refersTo) card.appendChild(el('div', 'xr-view__dossier-line', `Alias of ${refersTo}`));
            body.appendChild(card);
        } else {
            body.appendChild(el('div', 'xr-view__dossier-line',
                'No kind-0 profile found on these relays — the timeline below is what p-tags this key.'));
        }

        const rows = events
            .filter((ev) => ev.kind !== 0)
            .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        const counts = new Map();
        for (const ev of rows) counts.set(ev.kind, (counts.get(ev.kind) || 0) + 1);
        body.appendChild(el('div', 'xr-view__dossier-line',
            rows.length === 0
                ? 'Nothing on these relays yet.'
                : [...counts.entries()].sort((a, b) => a[0] - b[0])
                    .map(([k, n]) => `${n} ${KIND_LABELS[k] || `kind ${k}`}${n === 1 ? '' : 's'}`).join(' · ')));

        const list = el('ol', 'xr-portal__list');
        for (const ev of rows.slice(0, 200)) {
            const row = el('li', 'xr-row');
            const headRow = el('div', 'xr-row__head');
            const own = ev.pubkey === pubkey;
            headRow.appendChild(el('span', 'xr-row__kind',
                (KIND_LABELS[ev.kind] || `kind ${ev.kind}`) + (own ? ' · entity-signed' : '')));
            headRow.appendChild(el('span', 'xr-row__title', truncate(rowText(ev), 160)));
            if (ev.created_at) {
                headRow.appendChild(el('span', 'xr-row__date', new Date(ev.created_at * 1000).toLocaleString()));
            }
            row.appendChild(headRow);
            const quote = firstTag(ev, 'quote');
            if (quote) row.appendChild(el('div', 'xr-row__sub', `“${truncate(quote, 200)}”`));
            const url = firstTag(ev, 'r');
            if (url && /^https?:\/\//.test(url)) {
                const a = el('a', 'xr-synth__src', truncate(url, 80));
                a.href = url;
                a.target = '_blank';
                a.rel = 'noreferrer noopener';
                const sub = el('div', 'xr-row__sub');
                sub.appendChild(a);
                row.appendChild(sub);
            }
            list.appendChild(row);
        }
        if (rows.length > 200) {
            list.appendChild(el('li', 'xr-inspector__mono', `… +${rows.length - 200} more (relay limit)`));
        }
        body.appendChild(list);
    })().catch((err) => {
        Utils.error('Entity corpus view failed', err);
        clear(body);
        body.appendChild(el('p', 'xr-view__empty', 'Could not load the corpus.'));
    });
}

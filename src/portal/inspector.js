// Portal item inspector (Phase 12.6, docs/PORTAL_DESIGN.md).
//
// The provenance drawer: for any item — parsed summary, the
// addressable coordinate, which relays actually hold it, its
// reconciliation status against the local ledger, the raw signed
// event (copyable), a jump to the source URL, and for articles a
// read-only round-trip back into the reader via the existing
// `xray:reader:open` message (the event reconstructs to an article
// object; nothing is written anywhere).

import { el, clear, truncate, shortKey } from './dom.js';
import { kindLabel } from './library.js';
import { replaceableKey } from '../shared/nostr-events.js';
import { EventBuilder } from '../shared/event-builder.js';
import { Utils } from '../shared/utils.js';

const STATUS_TEXT = {
    'confirmed':   ['✓ in ledger & on relays', 'xr-badge--agree'],
    'remote-only': ['◌ remote-only — not in this device\'s ledger', 'xr-badge--case'],
    'no-ledger':   ['— no local publish ledger for this kind', '']
};

/**
 * @param {HTMLElement} host    the drawer container (#xr-inspector)
 * @param {object} item         library item
 * @param {object} opts
 * @param {string} opts.status  reconciliation status for this event id
 * @param {function} opts.onClose
 */
export function renderInspector(host, item, { status = 'no-ledger', onClose } = {}) {
    clear(host);
    host.hidden = false;

    const head = el('div', 'xr-inspector__head');
    head.appendChild(el('span', 'xr-row__kind', kindLabel(item.kind)));
    head.appendChild(el('span', 'xr-inspector__title', truncate(item.title, 120)));
    const close = el('button', 'xr-chip__remove', '✕');
    close.type = 'button';
    close.title = 'Close';
    close.addEventListener('click', () => { host.hidden = true; clear(host); if (onClose) onClose(); });
    head.appendChild(close);
    host.appendChild(head);

    const [statusText, statusClass] = STATUS_TEXT[status] || STATUS_TEXT['no-ledger'];
    host.appendChild(el('div', `xr-badge xr-inspector__status ${statusClass}`, statusText));

    const dl = el('dl', 'xr-inspector__fields');
    const field = (label, value, mono) => {
        if (!value) return;
        dl.appendChild(el('dt', null, label));
        const dd = el('dd', mono ? 'xr-inspector__mono' : null, value);
        dl.appendChild(dd);
    };
    field('Published', item.created_at ? new Date(item.created_at * 1000).toLocaleString() : '');
    const addr = replaceableKey(item.event);
    field('Coordinate', addr, true);
    field('Event id', item.event.id, true);
    field('Author', shortKey(item.event.pubkey || ''), true);
    if (item.cases.length) field('Cases', item.cases.join(', '));
    host.appendChild(dl);

    const relaySection = el('div', 'xr-inspector__relays');
    relaySection.appendChild(el('h3', 'xr-case__heading', `Held by ${item.relays.length} relay(s)`));
    for (const url of item.relays) relaySection.appendChild(el('div', 'xr-inspector__mono', url));
    if (item.relays.length === 0) {
        relaySection.appendChild(el('div', 'xr-view__empty', 'No relay returned this event in the last sync.'));
    }
    host.appendChild(relaySection);

    const actions = el('div', 'xr-inspector__actions');
    if (item.url) {
        const a = el('a', 'xr-portal__btn xr-portal__btn--ghost', '↗ Source URL');
        a.href = item.url;
        a.target = '_blank';
        a.rel = 'noreferrer noopener';
        actions.appendChild(a);
    }
    const copy = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Copy raw event');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(JSON.stringify(item.event, null, 2));
            copy.textContent = 'Copied ✓';
            setTimeout(() => { copy.textContent = 'Copy raw event'; }, 1500);
        } catch (err) {
            Utils.error('Inspector: clipboard write failed', err);
        }
    });
    actions.appendChild(copy);

    if (item.kind === 30023) {
        const open = el('button', 'xr-portal__btn', 'Open in reader');
        open.type = 'button';
        open.title = 'Reconstruct this capture from its signed event and open it read-only in the reader';
        open.addEventListener('click', () => {
            const article = EventBuilder.reconstructArticleFromEvent(item.event);
            if (!article) {
                open.textContent = 'Could not reconstruct';
                return;
            }
            const id = crypto.randomUUID();
            chrome.runtime.sendMessage({ type: 'xray:reader:open', id, article }, (resp) => {
                if (!resp || !resp.ok) {
                    Utils.error('Inspector: reader open failed', resp && resp.error);
                    open.textContent = 'Reader open failed';
                }
            });
        });
        actions.appendChild(open);
    }
    host.appendChild(actions);

    const details = el('details', 'xr-inspector__raw');
    details.open = true;
    details.appendChild(el('summary', null, 'Raw signed event'));
    const pre = el('pre');
    pre.textContent = JSON.stringify(item.event, null, 2);
    details.appendChild(pre);
    host.appendChild(details);
}

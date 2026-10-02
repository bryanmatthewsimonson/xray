// The portal's identity strip — the provenance chips behind the folded
// "Showing events signed by …" line, the signer-vs-case warning beneath
// it, and the footer's relay line. Moved out of index.js (its 1500-line
// ceiling, tests/structure-guards rule 5) when the strip gained the case
// identity, the warning, and the publish-history relays (JOURNAL
// 2026-10-01). DOM built with createElement/textContent only, like the
// rest of the portal.

import { el, clear, shortKey } from './dom.js';
import { identitySummaryLine } from './header-chrome.js';
import { signerBindingWarning, SIGNER_BINDING_FIX } from '../shared/case-membership.js';

// How an identity was established, in words a first-session user can
// read. The raw tokens stay as tooltips and CSS hooks.
export const IDENTITY_SOURCE_LABELS = {
    signer: 'your signer',
    'sync-key': 'backup key',
    'publish-history': 'seen in your published events',
    journal: 'signed this case\u2019s publishes',
    'case-identity': 'bound to this case',
    manual: 'added by you'
};

/**
 * Render the summary line + chips for one resolved identity picture.
 * `onRemove(pubkey)` removes a pasted (manual) key and re-boots.
 */
export function renderIdentityStrip({ identities = [], viewers = [], entities = [] }, { onRemove } = {}) {
    // PR-8 (D2): the one line that stays visible when the strip is
    // folded. Identities listed, viewers named as viewing — the words
    // keep identity.js's fence visible.
    const summary = document.querySelector('#xr-identity-summary');
    if (summary) summary.textContent = identitySummaryLine({ identities, viewers });
    const host = document.querySelector('#xr-identity-chips');
    if (!host) return;
    clear(host);
    const removeButton = (pubkey, title) => {
        const btn = el('button', 'xr-chip__remove', '✕');
        btn.type = 'button';
        btn.title = title;
        btn.addEventListener('click', () => { if (typeof onRemove === 'function') onRemove(pubkey); });
        return btn;
    };
    for (const id of identities) {
        const chip = el('span', 'xr-chip');
        chip.appendChild(el('span', 'xr-chip__key', shortKey(id.pubkey)));
        chip.title = id.pubkey;
        for (const src of id.sources) {
            // Plain label, raw token kept as the tooltip and the CSS hook
            // (docs/PORTAL_UX_REVIEW.md §5 — provenance tokens were
            // rendering verbatim as UI).
            const srcEl = el('span', `xr-chip__src xr-chip__src--${src}`, IDENTITY_SOURCE_LABELS[src] || src);
            srcEl.title = src;
            chip.appendChild(srcEl);
        }
        if (id.sources.includes('manual')) chip.appendChild(removeButton(id.pubkey, 'Remove this identity'));
        host.appendChild(chip);
    }
    // 28.4 — pasted archives render as VIEWER chips: fetched and
    // browsable, never "me" (excluded from reconcile/binding/resolver).
    for (const v of viewers) {
        const chip = el('span', 'xr-chip xr-chip--viewer');
        chip.appendChild(el('span', 'xr-chip__key', shortKey(v.pubkey)));
        chip.title = `${v.pubkey}\nRead-only viewer — this archive is browsed, never treated as yours.`;
        chip.appendChild(el('span', 'xr-chip__src xr-chip__src--viewer', 'viewer'));
        chip.appendChild(removeButton(v.pubkey, 'Stop viewing this archive'));
        host.appendChild(chip);
    }
    if (entities.length > 0) {
        const chip = el('span', 'xr-chip xr-chip--entity');
        chip.appendChild(el('span', 'xr-chip__key', `${entities.length} entity key(s)`));
        chip.title = entities.map((e) => `${e.name} (${e.type})`).join('\n');
        host.appendChild(chip);
    }
}

/**
 * The live signer is not the case's identity: say so under the header,
 * with the way out. Hidden (and emptied) whenever there is no mismatch.
 */
export function renderSignerWarning(host, binding, { onOpenSettings } = {}) {
    if (!host) return;
    clear(host);
    const warning = signerBindingWarning(binding);
    host.hidden = !warning;
    if (!warning) return;
    host.appendChild(el('span', 'xr-portal__signer-warning-text', `⚠ ${warning} ${SIGNER_BINDING_FIX}`));
    const btn = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Open settings');
    btn.type = 'button';
    btn.addEventListener('click', () => { if (typeof onOpenSettings === 'function') onOpenSettings(); });
    host.appendChild(btn);
}

/**
 * The footer's relay line: the configured relays, then any relay the
 * portal also reads because it confirmed one of this case's publishes
 * (publish-history.js) — so every relay the page asks is named.
 */
export function relayFooterText(configured, history) {
    const base = (configured && configured.length) ? `Relays: ${configured.join('  ')}` : 'No relays configured.';
    return (history && history.length)
        ? `${base}  · Also read, from this case's publish history: ${history.join('  ')}`
        : base;
}

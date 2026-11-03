// Options → Advanced: the plain on/off flag checkboxes that need nothing
// beyond the flag itself — capture automation (Phase 27 K.4) and the
// inline overlay (spec 2026-11-02), plus the overlay's hidden-sites list.
// Extracted from options/index.js (structure-guards rule 5 line ceiling).
// Unchecked clears the override, so the flag falls back to its default.

import { Storage } from '../shared/storage.js';
import { isEnabled, setOverride } from '../shared/metadata/feature-flags.js';

const TOGGLES = [
    ['pref-capture-automation', 'captureAutomation'],
    ['pref-inline-overlay', 'inlineOverlay']
];

// Inline overlay: hosts the user hid via the overlay's own menu. Read and
// written through the Storage facade (same key the content script writes).
const OVERLAY_SITE_OFF_KEY = 'overlay_site_off';

async function renderOverlaySiteOff() {
    const ul = document.getElementById('overlay-site-off-list');
    const empty = document.getElementById('overlay-site-off-empty');
    if (!ul || !empty) return;
    let hosts = await Storage.get(OVERLAY_SITE_OFF_KEY, []);
    hosts = Array.isArray(hosts) ? hosts.filter((h) => typeof h === 'string' && h) : [];
    ul.textContent = '';
    empty.hidden = hosts.length > 0;
    for (const host of hosts) {
        const li = document.createElement('li');
        li.style.margin = '4px 0';
        const name = document.createElement('code');
        name.textContent = host;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'xr-opt__btn xr-opt__btn--small';
        btn.textContent = 'Remove';
        btn.style.marginLeft = '8px';
        btn.addEventListener('click', async () => {
            const cur = await Storage.get(OVERLAY_SITE_OFF_KEY, []);
            const next = (Array.isArray(cur) ? cur : []).filter((h) => h !== host);
            await Storage.set(OVERLAY_SITE_OFF_KEY, next);
            await renderOverlaySiteOff();
        });
        li.append(name, btn);
        ul.appendChild(li);
    }
}

/** Fill the checkboxes from the current flags and render the hidden-sites list. */
export async function loadAdvancedToggles() {
    for (const [id, flag] of TOGGLES) document.getElementById(id).checked = isEnabled(flag);
    await renderOverlaySiteOff();
}

/** Write each checkbox back as an override (unchecked clears it). */
export async function saveAdvancedToggles() {
    for (const [id, flag] of TOGGLES) {
        await setOverride(flag, document.getElementById(id).checked ? true : null);
    }
}

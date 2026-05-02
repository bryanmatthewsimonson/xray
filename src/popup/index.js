// X-Ray popup for the toolbar action. Keeps state minimal: shows
// signing + relay info, and offers shortcuts that delegate to the
// content script in the active tab (via the background worker's
// forward-relay).

const browserApi = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

function setVersion() {
    const manifest = browserApi.runtime.getManifest();
    document.getElementById('footer-version').textContent = 'v' + manifest.version;
}

async function loadStatus() {
    // Signing status. With the user-pickable `signing_method` preference
    // we trust that as the source of truth and use `xr_signing_state`
    // (written by the content script on init) only to enrich the line
    // with the active pubkey/npub.
    try {
        const { xr_signing_state, preferences, local_primary_identity } = await new Promise((resolve) => {
            browserApi.storage.local.get(
                ['xr_signing_state', 'preferences', 'local_primary_identity'],
                resolve
            );
        });

        const signingEl = document.getElementById('status-signing');
        const prefs = typeof preferences === 'string' ? safeParse(preferences) : preferences;
        const state = typeof xr_signing_state === 'string'
            ? safeParse(xr_signing_state)
            : xr_signing_state;
        const identity = typeof local_primary_identity === 'string'
            ? safeParse(local_primary_identity)
            : local_primary_identity;

        const method = prefs && prefs.signing_method;
        const configured = prefs && prefs.signing_method_configured === true;

        if (!configured) {
            signingEl.textContent = 'set up signing';
            signingEl.classList.add('xr-popup__status-value--warn');
        } else if (method === 'local') {
            if (identity && identity.npub) {
                const truncated = identity.npub.slice(0, 14) + '…';
                signingEl.textContent = `Local (${truncated})`;
                signingEl.classList.add('xr-popup__status-value--ok');
            } else {
                signingEl.textContent = 'Local — no key';
                signingEl.classList.add('xr-popup__status-value--warn');
            }
        } else if (method === 'nip07') {
            const detected = state && state.method === 'nip07';
            signingEl.textContent = detected ? 'NIP-07' : 'NIP-07 (not detected)';
            signingEl.classList.add(detected ? 'xr-popup__status-value--ok' : 'xr-popup__status-value--warn');
        } else if (method === 'nsecbunker') {
            const connected = state && state.method === 'nsecbunker';
            signingEl.textContent = connected ? 'NSecBunker' : 'NSecBunker (offline)';
            signingEl.classList.add(connected ? 'xr-popup__status-value--ok' : 'xr-popup__status-value--warn');
        } else {
            signingEl.textContent = 'unknown';
            signingEl.classList.add('xr-popup__status-value--warn');
        }

        const relaysEl = document.getElementById('status-relays');
        const relays = prefs && prefs.default_relays;
        relaysEl.textContent = Array.isArray(relays) ? `${relays.length} configured` : '—';
    } catch (e) {
        console.warn('[X-Ray popup] status load failed', e);
    }
}

function safeParse(s) {
    try { return JSON.parse(s); } catch (_) { return null; }
}

function forwardToActiveTab(type) {
    return new Promise((resolve) => {
        browserApi.runtime.sendMessage({ type: 'xray:forward:' + type }, (resp) => resolve(resp));
    });
}

function wireButtons() {
    document.getElementById('btn-open-capture').addEventListener('click', async () => {
        await forwardToActiveTab('xray:open');
        window.close();
    });
    document.getElementById('btn-open-entities').addEventListener('click', async () => {
        // Three openers, in preference order:
        //   1. browser.sidebarAction.toggle()  — Firefox sidebar (MV3)
        //   2. chrome.sidePanel.open()         — Chrome / Edge / Brave
        //   3. tabs.create()                   — last-resort tab
        // Both panel APIs require a user gesture; the popup click qualifies.
        try {
            if (browserApi.sidebarAction && browserApi.sidebarAction.toggle) {
                await browserApi.sidebarAction.toggle();
            } else if (browserApi.sidePanel && browserApi.sidePanel.open) {
                const win = await new Promise((resolve) => browserApi.windows.getCurrent(resolve));
                await browserApi.sidePanel.open({ windowId: win.id });
            } else {
                browserApi.tabs.create({ url: browserApi.runtime.getURL('src/sidepanel/index.html') });
            }
        } catch (err) {
            console.warn('[X-Ray popup] entity-browser open failed:', err);
            browserApi.tabs.create({ url: browserApi.runtime.getURL('src/sidepanel/index.html') });
        }
        window.close();
    });
    document.getElementById('btn-view-keypairs').addEventListener('click', async () => {
        await forwardToActiveTab('xray:viewKeypairs');
        window.close();
    });
    document.getElementById('btn-export-keypairs').addEventListener('click', async () => {
        await forwardToActiveTab('xray:exportKeypairs');
        window.close();
    });
    document.getElementById('btn-open-options').addEventListener('click', () => {
        if (browserApi.runtime.openOptionsPage) {
            browserApi.runtime.openOptionsPage();
        }
        window.close();
    });
    document.getElementById('btn-capture-tips').addEventListener('click', () => {
        // Link to the capture guide on GitHub so users discover the
        // platform-specific instructions (Instagram: open a post URL;
        // Facebook: scroll to render images; etc.). In-reader hints
        // already catch the common bad-capture cases; this is the
        // "I want to learn how this works" entry point.
        const url = 'https://github.com/bryanmatthewsimonson/xray/blob/main/docs/CAPTURE_GUIDE.md';
        if (browserApi.tabs && browserApi.tabs.create) {
            browserApi.tabs.create({ url });
        } else {
            window.open(url, '_blank', 'noopener');
        }
        window.close();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    setVersion();
    loadStatus();
    wireButtons();
});

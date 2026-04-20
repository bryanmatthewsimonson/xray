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
    // Signing status: we can't directly ask the content script (would
    // require it to be loaded), so we infer from preferences storage.
    // The content script sets a volatile `xr_signing_state` key when
    // NIP-07/NSecBunker becomes available.
    try {
        const { xr_signing_state, preferences } = await new Promise((resolve) => {
            browserApi.storage.local.get(['xr_signing_state', 'preferences'], resolve);
        });

        const signingEl = document.getElementById('status-signing');
        if (xr_signing_state) {
            const parsed = typeof xr_signing_state === 'string'
                ? safeParse(xr_signing_state)
                : xr_signing_state;
            if (parsed?.method === 'nip07') {
                signingEl.textContent = 'NIP-07';
                signingEl.classList.add('xr-popup__status-value--ok');
            } else if (parsed?.method === 'nsecbunker') {
                signingEl.textContent = 'NSecBunker';
                signingEl.classList.add('xr-popup__status-value--ok');
            } else {
                signingEl.textContent = 'not configured';
                signingEl.classList.add('xr-popup__status-value--warn');
            }
        } else {
            signingEl.textContent = 'not detected';
            signingEl.classList.add('xr-popup__status-value--warn');
        }

        const relaysEl = document.getElementById('status-relays');
        const prefs = typeof preferences === 'string' ? safeParse(preferences) : preferences;
        const relays = prefs?.default_relays;
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
    document.getElementById('btn-open-metadata').addEventListener('click', async () => {
        await forwardToActiveTab('xray:openMetadata');
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
}

document.addEventListener('DOMContentLoaded', () => {
    setVersion();
    loadStatus();
    wireButtons();
});

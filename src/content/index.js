// Content-script bundle entry. esbuild wraps this (and every file it
// transitively imports) into a single IIFE loaded into every tab's
// isolated world per manifest.content_scripts.
//
// Part of the v4.2 parity push — see roadmap: #20.

import { CONFIG } from '../shared/config.js';
import { Utils } from '../shared/utils.js';
import { Storage } from '../shared/storage.js';
import { LocalKeyManager } from '../shared/local-key-manager.js';
import { NSecBunkerClient } from '../shared/nsecbunker-client.js';
import { NIP07Client } from './nip07-client.js';
import { UI } from './ui.js';

async function init() {
    // Initialize storage (migrates from any legacy GM storage if present).
    await Storage.initialize();

    // Apply runtime debug preference — off by default; opt-in via options page.
    try {
        const prefs = await Storage.get('preferences', {});
        if (prefs && typeof prefs.debug === 'boolean') Utils.setDebug(prefs.debug);
    } catch (_) { /* preferences may not exist on first run */ }

    Utils.log('Starting X-Ray content script v' + CONFIG.version);

    // Initialize local key manager.
    await LocalKeyManager.init();

    // Initialize Article Capture UI (FAB and panel).
    UI.init();

    // Check for NIP-07 extension availability.
    // NIP-07 lives on the page's `window.nostr`, which the isolated
    // content-script world cannot see directly. The MAIN-world bridge
    // (src/page/nip07-bridge.js) exposes it to us via postMessage.
    const nip07Available = NIP07Client.checkAvailability();
    if (nip07Available) {
        Utils.log('NIP-07 extension detected');
        UI.updateSigningStatus();
        UI.showToast('NIP-07 extension detected - Ready to publish!', 'success');
    } else {
        // Try to connect to NSecBunker in background as fallback.
        Utils.log('No NIP-07 extension, trying NSecBunker...');
        NSecBunkerClient.connect().then(() => {
            Utils.log('NSecBunker connected');
            UI.updateSigningStatus();
            UI.updatePublishButton();
            UI.showToast('Connected to NSecBunker', 'success');
        }).catch((e) => {
            Utils.log('NSecBunker not available:', e.message);
            UI.updateSigningStatus();
            Utils.log('No signing method available. Install a NIP-07 extension (nos2x, Alby) or run NSecBunker.');
        });
    }

    Utils.log('Initialization complete');
}

// Wire message handler for background-service-worker commands.
// The background worker dispatches:
//   { type: 'xray:open' }           — open the capture panel (v1 FAB path)
//   { type: 'xray:toggle' }         — toggle the capture panel
//   { type: 'xray:exportKeypairs' } — export keypair registry
//   { type: 'xray:viewKeypairs' }   — view keypair registry
//   { type: 'xray:sign', event }    — sign an unsigned event via NIP-07.
//                                    The SW uses this to round-trip the
//                                    reader-page publish flow through
//                                    a content-script tab that has the
//                                    MAIN-world NIP-07 bridge loaded.
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        try {
            switch (msg && msg.type) {
                case 'xray:open':
                    UI.open();
                    sendResponse({ ok: true });
                    break;
                case 'xray:toggle':
                    UI.toggle();
                    sendResponse({ ok: true });
                    break;
                case 'xray:exportKeypairs':
                    UI.exportKeypairs();
                    sendResponse({ ok: true });
                    break;
                case 'xray:viewKeypairs':
                    UI.viewKeypairs();
                    sendResponse({ ok: true });
                    break;
                case 'xray:getPubkey':
                    NIP07Client.getPublicKey()
                        .then((pubkey) => sendResponse({ ok: true, pubkey }))
                        .catch((err) => sendResponse({ ok: false, error: err && err.message }));
                    return true;
                case 'xray:sign':
                    NIP07Client.signEvent(msg.event)
                        .then((signed) => sendResponse({ ok: true, event: signed }))
                        .catch((err) => sendResponse({ ok: false, error: err && err.message }));
                    return true; // keep channel open for the async response
                default:
                    sendResponse({ ok: false, error: 'unknown message type' });
            }
        } catch (e) {
            Utils.error('onMessage handler failed:', e);
            sendResponse({ ok: false, error: e && e.message });
        }
        return true;
    });
}

// Wait for DOM to be ready.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

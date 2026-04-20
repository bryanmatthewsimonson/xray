// Content-script bootstrap. Part of the v4.2 parity push — v1 URL-metadata
// display (MetadataUI, URLMetadataService, kinds 32123–32144) has been
// removed from this init path; see roadmap: #20, Phase 0: #11.

(async function initXRayContent() {
    async function init() {
        Utils.log('Starting X-Ray content script v' + CONFIG.version);

        // Initialize storage (migrates from any legacy GM storage if present).
        await Storage.initialize();

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
    //   { type: 'xray:open' }           — open the capture panel
    //   { type: 'xray:toggle' }         — toggle the capture panel
    //   { type: 'xray:exportKeypairs' } — export keypair registry
    //   { type: 'xray:viewKeypairs' }   — view keypair registry
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
                    default:
                        sendResponse({ ok: false, error: 'unknown message type' });
                }
            } catch (e) {
                Utils.error('onMessage handler failed:', e);
                sendResponse({ ok: false, error: e && e.message });
            }
            // Return true to keep the message channel open for async responses
            // (not strictly needed here since all branches respond synchronously,
            // but it's forward-compatible).
            return true;
        });
    }

    // Wait for DOM to be ready.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

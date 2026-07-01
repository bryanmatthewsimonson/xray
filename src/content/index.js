// Content-script bundle entry. esbuild wraps this (and every file it
// transitively imports) into a single IIFE loaded into every tab's
// isolated world per manifest.content_scripts.
//
// Part of the v4.2 parity push — see roadmap: #20.

import { CONFIG, applyConfigOverrides } from '../shared/config.js';
import { Utils } from '../shared/utils.js';
import { Storage } from '../shared/storage.js';
import { LocalKeyManager } from '../shared/local-key-manager.js';
import { NSecBunkerClient } from '../shared/nsecbunker-client.js';
import { Signer } from '../shared/signer.js';
import { NIP07Client } from './nip07-client.js';
import { UI } from './ui.js';
import { installBufferListener, configureInterceptor } from '../shared/api-hook-buffer.js';

async function init() {
    // Initialize storage (migrates from any legacy GM storage if present).
    await Storage.initialize();

    // Apply runtime debug preference — off by default; opt-in via options page.
    // Also apply user-supplied CONFIG overrides from Settings → Advanced.
    try {
        const prefs = await Storage.get('preferences', {});
        if (prefs && typeof prefs.debug === 'boolean') Utils.setDebug(prefs.debug);
        if (prefs && prefs.config_overrides) applyConfigOverrides(prefs.config_overrides);
    } catch (_) { /* preferences may not exist on first run */ }

    Utils.log('Starting X-Ray content script v' + CONFIG.version);

    // Phase 8c/8d — Wire the MAIN-world api-interceptor on platforms
    // where structured extraction needs API responses we missed.
    // The interceptor itself is loaded by a manifest content_script
    // at document_start (so it's in place before page JS fires);
    // here we install our buffer listener and configure which
    // request patterns to capture.
    const host = window.location.hostname;
    if (/(?:^|\.)instagram\.com$/i.test(host)) {
        installBufferListener();
        configureInterceptor([
            // Instagram has three GraphQL-flavored endpoints, all
            // routed at slightly different paths. Match any URL
            // containing `graphql` to cover all three:
            //   /api/graphql           — the main post-detail query
            //                             (fb_dtsg-signed POST)
            //   /graphql/query         — some other operations
            //                             (signup/etc; lightweight)
            //   /api/v1/media/<id>/... — older REST-ish path; carries
            //                             the same carousel_media shape
            { urlIncludes: 'graphql' },
            { urlIncludes: '/api/v1/media/' }
        ]);
    } else if (/(?:^|\.)(?:facebook|fb)\.com$/i.test(host)) {
        // Facebook routes all structured post data through a single
        // `/api/graphql/` POST endpoint (plus a few variants:
        // `/graphql/`, `/ajax/...`). Capture any URL containing
        // `graphql` — most responses we care about are posted
        // during initial page load before the user clicks the FAB.
        installBufferListener();
        configureInterceptor([
            { urlIncludes: 'graphql' }
        ]);
    } else if (/(?:^|\.)youtube\.com$/i.test(host)) {
        // YouTube comments lazy-load as the user scrolls, via POSTs to
        // the InnerTube `/youtubei/v1/next` continuation endpoint. The
        // MAIN-world interceptor (installed at document_start by the
        // manifest content_script) buffers those response bodies;
        // youtube.js#extractComments parses them at capture time.
        // Comments only land in the buffer once the user has scrolled
        // to them — hence the reader's "scroll to load comments" hint.
        installBufferListener();
        configureInterceptor([
            { urlIncludes: '/youtubei/v1/next' }
        ]);
    }

    // Initialize local key manager.
    await LocalKeyManager.init();

    // Wire the Signer façade to this context's NIP-07 client. Local and
    // NSecBunker work without injection.
    Signer.configure({ nip07Client: NIP07Client });

    // Resolve the user's chosen signing method and persist the result to
    // `xr_signing_state` so the options Signing tab can show an honest
    // status. There is no in-page signing UI any more — capture and
    // publish both happen in the reader page.
    const method = await Signer.getMethod();
    const configured = await Signer.isConfigured();

    if (!configured) {
        Utils.log('Signing method not yet configured by user');
        recordSigningState('unconfigured');
        // Still probe NIP-07 so the bridge ready event lands; this keeps
        // the options "detected?" indicator honest even before setup.
        NIP07Client.probe().catch(() => { /* ignore */ });
    } else if (method === 'local') {
        const id = await Storage.primaryIdentity.get();
        if (id && id.privateKey) {
            Utils.log('Local signing identity ready:', id.npub);
            recordSigningState('local', id.pubkey);
        } else {
            recordSigningState('local-missing');
            Utils.log('Local signing selected but no key present. Open Settings → Signing.');
        }
    } else if (method === 'nip07') {
        const nip07Available = await NIP07Client.probe();
        if (nip07Available) {
            Utils.log('NIP-07 extension detected');
            try {
                const pubkey = await NIP07Client.getPublicKey();
                recordSigningState('nip07', pubkey);
            } catch (_) {
                recordSigningState('nip07');
            }
        } else {
            recordSigningState('nip07-missing');
            Utils.log('NIP-07 selected but no provider. Install nos2x / Alby or switch method.');
        }
    } else if (method === 'nsecbunker') {
        Utils.log('Connecting to NSecBunker...');
        const prefs = await Storage.get('preferences', {});
        NSecBunkerClient.connect(prefs && prefs.nsecbunker_url).then(() => {
            Utils.log('NSecBunker connected');
            recordSigningState('nsecbunker');
        }).catch((e) => {
            Utils.log('NSecBunker not available:', e.message);
            recordSigningState('nsecbunker-missing');
        });
    }

    Utils.log('Initialization complete');
}

/**
 * Persist the resolved signing state to chrome.storage.local so the
 * options Signing tab can show an honest status instead of always
 * falling through to "not detected" — the bug closed by issue #2.
 *
 * Writes the value JSON-stringified to match the convention of every
 * other key written through `Storage` (see `src/shared/storage.js` —
 * `set` always JSON.stringifies). The popup's `safeParse` handles
 * the round-trip.
 */
function recordSigningState(method, pubkey = null) {
    try {
        const payload = JSON.stringify({
            method,                       // 'local' | 'nip07' | 'nsecbunker' | 'unconfigured' | '<x>-missing'
            pubkey,                       // hex pubkey when known, else null
            detectedAt: Date.now()
        });
        chrome.storage.local.set({ xr_signing_state: payload });
    } catch (err) {
        // Best-effort — never let a popup-visibility nicety crash the
        // content script's init.
        Utils.log('Failed to persist signing state:', err && err.message);
    }
}

// Wire message handler for background-service-worker commands.
// The background worker dispatches:
//   { type: 'xray:capture' }        — capture this page and open the reader
//   { type: 'xray:sign', event }    — sign an unsigned event via NIP-07.
//                                    The SW uses this to round-trip the
//                                    reader-page publish flow through
//                                    a content-script tab that has the
//                                    MAIN-world NIP-07 bridge loaded.
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        try {
            switch (msg && msg.type) {
                case 'xray:capture':
                    UI.openReader();
                    sendResponse({ ok: true });
                    break;
                case 'xray:getPubkey':
                    Signer.getPublicKey()
                        .then((pubkey) => sendResponse({ ok: true, pubkey }))
                        .catch((err) => sendResponse({ ok: false, error: err && err.message }));
                    return true;
                case 'xray:sign':
                    Signer.signEvent(msg.event)
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

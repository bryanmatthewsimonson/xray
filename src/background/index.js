// X-Ray background service worker (MV3) — bundle entry.
//
// Phase 0 responsibilities:
//   - Register context-menu items on install/update.
//   - Forward context-menu clicks to the content script in the active tab.
//   - Relay popup-driven actions (e.g. "Open Article Capture") to the
//     content script in the current tab.
//   - Bridge xray:notify → chrome.notifications.
//   - Handle the keyboard-shortcut `command` (`Ctrl/Cmd+Shift+X`) by
//     dispatching `xray:toggle` to the active tab.
//   - **Publish signed events to NOSTR relays** on behalf of the content
//     script. Moving the WebSocket pool here matters because:
//       (a) relay connections survive tab navigations and can be kept
//           warm across publishes;
//       (b) the SW is not subject to page CSP, so relay connections work
//           on Facebook / Instagram / TikTok / YouTube where the page's
//           `connect-src` policy would block them from content scripts.
//
// Phase 1 (real crypto) and Phase 2 (capture parity) add more shared
// imports. Phase 3+ moves query subscriptions here alongside publish.

import { Utils } from '../shared/utils.js';
import { NostrClient } from '../shared/nostr-client.js';
import { fetchSubstackPost, fetchSubstackComments } from '../shared/platforms/substack-api.js';

// Pull the debug preference on SW startup. MV3 service workers sleep
// and wake, so this runs each time the SW reloads. A chrome.storage
// onChanged listener below keeps it current across changes.
(function applyDebugPreference() {
    try {
        chrome.storage.local.get(['preferences'], (res) => {
            const raw = res && res.preferences;
            const prefs = typeof raw === 'string' ? safeParse(raw) : (raw || {});
            if (prefs && typeof prefs.debug === 'boolean') Utils.setDebug(prefs.debug);
        });
    } catch (_) { /* best-effort */ }
})();

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.preferences) return;
    const raw = changes.preferences.newValue;
    const prefs = typeof raw === 'string' ? safeParse(raw) : (raw || {});
    if (prefs && typeof prefs.debug === 'boolean') Utils.setDebug(prefs.debug);
});

function safeParse(s) { try { return JSON.parse(s); } catch (_) { return null; } }

const MENU_IDS = {
    OPEN_CAPTURE: 'xray:open-capture',
    EXPORT_KEYPAIRS: 'xray:export-keypairs',
    VIEW_KEYPAIRS: 'xray:view-keypairs'
};

// ------------------------------------------------------------------
// Context menus
// ------------------------------------------------------------------

function registerContextMenus() {
    // Remove any stale entries first (e.g. after a reload during development).
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: MENU_IDS.OPEN_CAPTURE,
            title: 'Open Article Capture',
            contexts: ['page', 'action']
        });
        chrome.contextMenus.create({
            id: 'xray:separator-1',
            type: 'separator',
            contexts: ['action']
        });
        chrome.contextMenus.create({
            id: MENU_IDS.EXPORT_KEYPAIRS,
            title: 'Export Keypair Registry',
            contexts: ['action']
        });
        chrome.contextMenus.create({
            id: MENU_IDS.VIEW_KEYPAIRS,
            title: 'View Keypair Registry',
            contexts: ['action']
        });
    });
}

chrome.runtime.onInstalled.addListener(registerContextMenus);
// Also re-register on browser startup so the menus survive a cold launch
// (Firefox clears MV3 context menus on suspension in some versions).
chrome.runtime.onStartup?.addListener(registerContextMenus);

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab || !tab.id) return;

    const messageForMenuId = {
        [MENU_IDS.OPEN_CAPTURE]: { type: 'xray:open' },
        [MENU_IDS.EXPORT_KEYPAIRS]: { type: 'xray:exportKeypairs' },
        [MENU_IDS.VIEW_KEYPAIRS]: { type: 'xray:viewKeypairs' }
    };

    const message = messageForMenuId[info.menuItemId];
    if (!message) return;

    chrome.tabs.sendMessage(tab.id, message).catch(err => {
        // Content script may not be loaded on this page (e.g. chrome:// URLs).
        console.warn('[X-Ray] Failed to deliver context-menu command:', err);
    });
});

// ------------------------------------------------------------------
// Message routing between popup / content / worker
// ------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) {
        sendResponse({ ok: false, error: 'missing message type' });
        return false;
    }

    // Popup → active tab's content script. Popup doesn't know the active
    // tab id, so we look it up here.
    if (message.type?.startsWith('xray:forward:')) {
        const forwarded = { ...message, type: message.type.slice('xray:forward:'.length) };
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs && tabs[0];
            if (!tab || !tab.id) {
                sendResponse({ ok: false, error: 'no active tab' });
                return;
            }
            chrome.tabs.sendMessage(tab.id, forwarded)
                .then(resp => sendResponse({ ok: true, resp }))
                .catch(err => sendResponse({ ok: false, error: err && err.message }));
        });
        return true; // async sendResponse
    }

    // Content script → worker: open the reader page in a new tab,
    // with the extracted article pre-loaded via session storage.
    if (message.type === 'xray:reader:open') {
        const { id, article } = message;
        if (!id || !article) {
            sendResponse({ ok: false, error: 'missing id or article' });
            return false;
        }
        // Track the source tab so the reader's publish flow can route
        // NIP-07 signing back through a tab that has the content script
        // + MAIN-world bridge loaded.
        const sourceTabId = sender && sender.tab && sender.tab.id;
        const record = { article, sourceTabId, createdAt: Date.now() };
        const area = chrome.storage.session || chrome.storage.local;
        area.set({ ['xray:article:' + id]: record }, () => {
            const url = chrome.runtime.getURL('src/reader/index.html') + '?id=' + encodeURIComponent(id);
            chrome.tabs.create({ url }).then(
                () => sendResponse({ ok: true }),
                (err) => sendResponse({ ok: false, error: err && err.message })
            );
        });
        return true; // async sendResponse
    }

    // Reader page → worker: fetch the NIP-07 pubkey from the source tab.
    // Used to stamp the unsigned event with the correct author before
    // the round-trip sign call.
    if (message.type === 'xray:capture:getPubkey') {
        const id = message.id;
        (async () => {
            const area = chrome.storage.session || chrome.storage.local;
            const record = await new Promise((r) => {
                area.get(['xray:article:' + id], (res) => r(res && res['xray:article:' + id]));
            });
            if (!record) return sendResponse({ ok: false, error: 'Session record missing' });
            try {
                const resp = await chrome.tabs.sendMessage(record.sourceTabId, { type: 'xray:getPubkey' });
                if (!resp || !resp.ok) {
                    return sendResponse({ ok: false, error: (resp && resp.error) || 'Source tab refused' });
                }
                sendResponse({ ok: true, pubkey: resp.pubkey });
            } catch (err) {
                sendResponse({ ok: false, error: 'Source tab unreachable (likely closed)' });
            }
        })();
        return true;
    }

    // Reader page → worker: sign + publish a capture event.
    //
    // Orchestrates:
    //   1. Look up the source tab id from the session-storage record.
    //   2. Ask that tab's content script to sign the event via NIP-07.
    //   3. Publish the signed event through NostrClient.
    //   4. Respond to the reader with the aggregated per-relay results.
    if (message.type === 'xray:capture:publish') {
        const { id, event } = message;
        if (!id || !event) {
            sendResponse({ ok: false, error: 'missing id or event' });
            return false;
        }
        handleCapturePublish(id, event).then(
            (result) => sendResponse(result),
            (err) => sendResponse({ ok: false, error: err && err.message })
        );
        return true; // async sendResponse
    }

    // Content script → worker: fetch a YouTube transcript (timedtext API).
    //
    // The SW's fetch has two advantages over a content-script fetch:
    //   1. It's outside the content-script's isolated world, so the
    //      standard Chrome networking stack handles cookies the way
    //      YouTube's own client expects.
    //   2. A declarativeNetRequest rule (rules/referer-youtube.json)
    //      rewrites the outgoing Referer header to
    //      https://www.youtube.com/. Without that, the signed baseUrl
    //      silently returns HTTP 200 with a 0-byte body even for logged-in
    //      users — the 0-byte response is YouTube's "sorry, wrong caller"
    //      signal.
    if (message.type === 'xray:youtube:fetchTranscript') {
        const url = message.url;
        if (!url) {
            sendResponse({ ok: false, error: 'missing url' });
            return false;
        }
        (async () => {
            try {
                const res = await fetch(url, {
                    method: 'GET',
                    credentials: 'include',
                    headers: { Accept: 'application/json,*/*' },
                    signal: AbortSignal.timeout(15000)
                });
                const body = await res.text();
                sendResponse({ ok: true, status: res.status, body });
            } catch (err) {
                sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
            }
        })();
        return true;
    }

    // Content script OR reader page → worker: fetch Substack post metadata
    // by slug. Uses credentials:'include' so the user's Substack session
    // cookie unlocks paywalled bodies automatically.
    if (message.type === 'xray:substack:fetchPost') {
        const { apiOrigin, slug } = message;
        fetchSubstackPost(apiOrigin, slug)
            .then((post) => sendResponse({ ok: true, post }))
            .catch((err) => sendResponse({ ok: false, error: err && err.message }));
        return true;
    }

    // Content script OR reader page → worker: fetch Substack comments.
    // Same credentials treatment as the post fetch so gated comment
    // threads on paid publications resolve for authed users.
    if (message.type === 'xray:substack:fetchComments') {
        const { apiOrigin, postId } = message;
        fetchSubstackComments(apiOrigin, postId)
            .then((result) => sendResponse({ ok: true, ...result }))
            .catch((err) => sendResponse({ ok: false, error: err && err.message }));
        return true; // async
    }

    // Content script → worker: publish a signed event to relays.
    if (message.type === 'xray:relay:publish') {
        const relays = Array.isArray(message.relays) ? message.relays : [];
        const event = message.event;
        if (!event || !event.id || !event.pubkey || !event.sig) {
            sendResponse({ ok: false, error: 'missing or unsigned event' });
            return false;
        }
        if (relays.length === 0) {
            sendResponse({ ok: false, error: 'no relays configured' });
            return false;
        }
        NostrClient.publishToRelays(relays, event)
            .then((results) => sendResponse({ ok: true, results }))
            .catch((err) => sendResponse({ ok: false, error: err && err.message }));
        return true; // async
    }

    // Content script → worker: surface a desktop notification.
    if (message.type === 'xray:notify') {
        const opts = {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
            title: message.title || 'X-Ray',
            message: message.body || ''
        };
        chrome.notifications.create(opts, (id) => {
            sendResponse({ ok: true, id });
        });
        return true; // async
    }

    sendResponse({ ok: false, error: 'unknown message type' });
    return false;
});

// ------------------------------------------------------------------
// Keyboard commands
// ------------------------------------------------------------------

chrome.commands?.onCommand.addListener((command) => {
    if (command !== 'xray:toggle') return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab || !tab.id) return;
        chrome.tabs.sendMessage(tab.id, { type: 'xray:toggle' }).catch((err) => {
            console.warn('[X-Ray] Failed to deliver shortcut command:', err);
        });
    });
});

// ------------------------------------------------------------------
// Reader → sign → publish orchestration
// ------------------------------------------------------------------

async function handleCapturePublish(id, unsignedEvent) {
    // 1. Pull the source-tab id from the session-storage record the FAB
    //    click saved. That's where the content script + NIP-07 bridge live.
    const area = chrome.storage.session || chrome.storage.local;
    const record = await new Promise((resolve) => {
        area.get(['xray:article:' + id], (res) => resolve(res && res['xray:article:' + id]));
    });
    if (!record) {
        return { ok: false, error: 'Session record missing (reader opened without a source tab)' };
    }
    const sourceTabId = record.sourceTabId;

    // 2. Ask that tab to sign via its NIP-07 bridge.
    let signed;
    try {
        signed = await chrome.tabs.sendMessage(sourceTabId, {
            type: 'xray:sign',
            event: unsignedEvent
        });
    } catch (err) {
        return {
            ok: false,
            error: 'Source tab unreachable (likely closed). Keep the article tab open while publishing.'
        };
    }
    if (!signed || !signed.ok || !signed.event) {
        return { ok: false, error: (signed && signed.error) || 'Signing failed' };
    }

    // 3. Collect the configured relay list.
    const prefs = await new Promise((resolve) => {
        (chrome.storage.local).get(['preferences'], (res) => {
            const raw = res && res.preferences;
            try { resolve(typeof raw === 'string' ? JSON.parse(raw) : (raw || {})); }
            catch (_) { resolve({}); }
        });
    });
    const relays = Array.isArray(prefs.default_relays) && prefs.default_relays.length > 0
        ? prefs.default_relays
        : ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'];

    // 4. Publish.
    let results;
    try {
        results = await NostrClient.publishToRelays(relays, signed.event);
    } catch (err) {
        return { ok: false, error: 'Relay publish failed: ' + (err && err.message) };
    }

    // 5. Surface a native notification in addition to the reader toast.
    try {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
            title: 'X-Ray — Published',
            message: `Event ${signed.event.id.slice(0, 8)}… published to ${results.successful}/${results.total} relays.`
        });
    } catch (_) { /* notifications permission may be declined */ }

    return { ok: true, signedEvent: signed.event, results };
}

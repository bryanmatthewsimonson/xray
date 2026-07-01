// X-Ray background service worker (MV3) — bundle entry.
//
// Phase 0 responsibilities:
//   - Register context-menu items on install/update.
//   - Forward context-menu clicks to the content script in the active tab.
//   - Toolbar-icon click → `xray:capture` to the active tab (mirrors the
//     keyboard shortcut): capture the page and open it in the reader. On
//     non-injectable pages the click falls back to opening the options
//     page so it's never a silent no-op.
//   - Bridge xray:notify → chrome.notifications.
//   - Handle the keyboard-shortcut `command` (`Ctrl/Cmd+Shift+X`) by
//     capturing the active tab.
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
import { EventBuilder } from '../shared/event-builder.js';
import { fetchSubstackPost, fetchSubstackComments } from '../shared/platforms/substack-api.js';
import { handleScreenshotCapture } from '../shared/screenshot.js';
import { runSuggestionPass, runAuditPass, getLlmConfig } from '../shared/llm-client.js';

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
    OPEN_ENTITIES: 'xray:open-entities',
    OPEN_PORTAL: 'xray:open-portal',
    OPEN_SETTINGS: 'xray:open-settings',
    CAPTURE_TIPS: 'xray:capture-tips'
};

const CAPTURE_TIPS_URL = 'https://github.com/bryanmatthewsimonson/xray/blob/main/docs/CAPTURE_GUIDE.md';

// ------------------------------------------------------------------
// Context menus
// ------------------------------------------------------------------

function registerContextMenus() {
    // The browser-action click captures the active tab and opens it in
    // the reader (see chrome.action.onClicked below). The right-click
    // menu hosts the same capture action plus the jump-to-other-surfaces
    // actions that used to live in the popup.
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: MENU_IDS.OPEN_CAPTURE,
            title: 'Capture this page with X-Ray',
            contexts: ['page', 'action']
        });
        chrome.contextMenus.create({
            id: MENU_IDS.OPEN_ENTITIES,
            title: 'Open Entity Browser',
            contexts: ['action']
        });
        chrome.contextMenus.create({
            id: MENU_IDS.OPEN_PORTAL,
            title: 'Open My Archive',
            contexts: ['action']
        });
        chrome.contextMenus.create({
            id: MENU_IDS.OPEN_SETTINGS,
            title: 'Settings…',
            contexts: ['action']
        });
        chrome.contextMenus.create({
            id: 'xray:separator-1',
            type: 'separator',
            contexts: ['action']
        });
        chrome.contextMenus.create({
            id: MENU_IDS.CAPTURE_TIPS,
            title: 'Capture tips (Instagram, Facebook, …)',
            contexts: ['action']
        });
    });
}

/**
 * Open the entity browser. Three openers, in preference order:
 *   1. browser.sidebarAction.toggle()   — Firefox sidebar (MV3)
 *   2. chrome.sidePanel.open()          — Chrome / Edge / Brave
 *   3. tabs.create()                    — last-resort tab
 * Both panel APIs require a user gesture; the menu/icon click qualifies.
 */
async function openEntityBrowser() {
    try {
        if (typeof browser !== 'undefined' && browser.sidebarAction && browser.sidebarAction.toggle) {
            await browser.sidebarAction.toggle();
            return;
        }
        if (chrome.sidePanel && chrome.sidePanel.open) {
            const win = await new Promise((resolve) => chrome.windows.getCurrent(resolve));
            await chrome.sidePanel.open({ windowId: win.id });
            return;
        }
    } catch (err) {
        console.warn('[X-Ray] entity-browser open failed:', err);
    }
    chrome.tabs.create({ url: chrome.runtime.getURL('src/sidepanel/index.html') });
}

/**
 * Open the "My Archive" portal (Phase 12) — a full-tab extension page,
 * same pattern as the reader: no manifest entry needed.
 */
function openPortal() {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/portal/index.html') });
}

/**
 * Capture the active tab and open it in the reader. If the content
 * script isn't loaded (chrome://, file://, extension pages, the
 * WebStore…) fall back to opening the options page so the icon click is
 * never a no-op the user can't recover from.
 */
function captureActiveTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab || !tab.id) {
            chrome.runtime.openOptionsPage?.();
            return;
        }
        chrome.tabs.sendMessage(tab.id, { type: 'xray:capture' }).catch((err) => {
            console.warn('[X-Ray] xray:capture delivery failed, opening Settings:', err && err.message);
            chrome.runtime.openOptionsPage?.();
        });
    });
}

chrome.runtime.onInstalled.addListener(registerContextMenus);
// Also re-register on browser startup so the menus survive a cold launch
// (Firefox clears MV3 context menus on suspension in some versions).
chrome.runtime.onStartup?.addListener(registerContextMenus);

chrome.contextMenus.onClicked.addListener((info, tab) => {
    // Settings / Entity Browser / Capture tips don't need an active tab —
    // they target the extension itself.
    if (info.menuItemId === MENU_IDS.OPEN_SETTINGS) {
        chrome.runtime.openOptionsPage?.();
        return;
    }
    if (info.menuItemId === MENU_IDS.OPEN_ENTITIES) {
        openEntityBrowser();
        return;
    }
    if (info.menuItemId === MENU_IDS.OPEN_PORTAL) {
        openPortal();
        return;
    }
    if (info.menuItemId === MENU_IDS.CAPTURE_TIPS) {
        chrome.tabs.create({ url: CAPTURE_TIPS_URL });
        return;
    }

    if (!tab || !tab.id) return;

    const messageForMenuId = {
        [MENU_IDS.OPEN_CAPTURE]: { type: 'xray:capture' }
    };

    const message = messageForMenuId[info.menuItemId];
    if (!message) return;

    chrome.tabs.sendMessage(tab.id, message).catch(err => {
        // Content script may not be loaded on this page (e.g. chrome:// URLs).
        console.warn('[X-Ray] Failed to deliver context-menu command:', err);
        if (message.type === 'xray:capture') {
            chrome.runtime.openOptionsPage?.();
        }
    });
});

// ------------------------------------------------------------------
// Toolbar-icon click — capture the active tab and open the reader (no popup).
// ------------------------------------------------------------------
chrome.action?.onClicked.addListener(captureActiveTab);

// ------------------------------------------------------------------
// Message routing between popup / content / worker
// ------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) {
        sendResponse({ ok: false, error: 'missing message type' });
        return false;
    }

    // FAB / context-menu shortcuts that target the extension itself.
    // No tab routing needed; the SW just opens the relevant surface.
    if (message.type === 'xray:openSettings') {
        chrome.runtime.openOptionsPage?.();
        sendResponse({ ok: true });
        return false;
    }
    if (message.type === 'xray:openEntities') {
        openEntityBrowser();
        sendResponse({ ok: true });
        return false;
    }
    if (message.type === 'xray:openPortal') {
        openPortal();
        sendResponse({ ok: true });
        return false;
    }
    if (message.type === 'xray:openCaptureTips') {
        chrome.tabs.create({ url: CAPTURE_TIPS_URL });
        sendResponse({ ok: true });
        return false;
    }

    // Forwarders — historically used by the popup. Kept because the
    // options page also forwards a couple of things into the active tab.
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
        // readOnly (Phase 12.7): set by the portal's "Open in reader" —
        // the article is a relay reconstruction for VIEWING, and the
        // reader must not let it touch the local archive cache.
        const record = { article, sourceTabId, createdAt: Date.now(), readOnly: !!message.readOnly };
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

    // Reader page → worker: run an LLM-assist suggestion pass against
    // the open article. The Anthropic call lives here (not the reader
    // page) because the SW is outside page CSP, and the key never leaves
    // the SW. Gated by the `llmAssist` flag + a user-supplied key inside
    // runSuggestionPass; returns validated-shape proposals only — nothing
    // is saved or published here.
    if (message.type === 'xray:llm:suggest') {
        runSuggestionPass(message.request || {}).then(
            (result) => sendResponse(result),
            (err) => sendResponse({ ok: false, error: (err && err.message) || 'LLM pass failed' })
        );
        return true; // async sendResponse
    }

    // Reader page → worker: run an in-extension epistemic-audit pass
    // against the open article. Same home as Suggest (SW outside page
    // CSP, key never leaves the SW), gated identically inside
    // runAuditPass. Returns the canonical scorer-export object only —
    // the reader runs importAuditJson (re-hash + schema-validate) and
    // nothing is published here (that stays behind `epistemicAuditing`).
    if (message.type === 'xray:audit:run') {
        runAuditPass(message.request || {}).then(
            (result) => sendResponse(result),
            (err) => sendResponse({ ok: false, error: (err && err.message) || 'Audit pass failed' })
        );
        return true; // async sendResponse
    }

    // Reader page → worker: LLM-assist gating snapshot — whether the flag
    // is on, whether a key is present (NEVER the key value), and the
    // chosen model. The reader uses it to show/enable the Suggest control.
    if (message.type === 'xray:llm:config') {
        getLlmConfig().then(
            (cfg) => sendResponse({ ok: true, ...cfg }),
            () => sendResponse({ ok: false, enabled: false, hasKey: false })
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
        const tabId = sender && sender.tab && sender.tab.id;
        if (!url)   { sendResponse({ ok: false, error: 'missing url' });   return false; }
        if (!tabId) { sendResponse({ ok: false, error: 'missing tabId' }); return false; }

        // YouTube gates the timedtext endpoint on browser context that
        // can only be satisfied from the page's own JS — cookies alone,
        // cookies + Referer, and cookies + Referer + client-version
        // headers all return HTTP 200 with a 0-byte body. The only
        // technique that reliably works is running the fetch in the
        // page's MAIN world via chrome.scripting.executeScript. That
        // makes the request indistinguishable from YouTube's own
        // client calls (Sec-Fetch-*, cookies, Origin, timing — all
        // identical because it IS the page).
        (async () => {
            console.error('[X-Ray SW] fetchTranscript via page-world injection, tab', tabId, 'url', url);
            try {
                const [injection] = await chrome.scripting.executeScript({
                    target: { tabId },
                    world: 'MAIN',
                    // Tries multiple URL variants and returns a breakdown
                    // so we can see which (if any) produce content. YouTube
                    // has been tightening the timedtext endpoint with
                    // PO-token gating since mid-2024; the signed baseUrl
                    // from ytInitialPlayerResponse is no longer always
                    // honoured even from the page's own JS context.
                    func: async (fetchUrl) => {
                        const variants = {
                            json3:    fetchUrl,
                            xml:      fetchUrl.replace(/(\?|&)fmt=json3/, ''),
                            srv3:     fetchUrl.replace(/(\?|&)fmt=json3/, '$1fmt=srv3'),
                            vtt:      fetchUrl.replace(/(\?|&)fmt=json3/, '$1fmt=vtt')
                        };
                        const out = {};
                        for (const [label, u] of Object.entries(variants)) {
                            try {
                                const r = await fetch(u, { credentials: 'include' });
                                const body = await r.text();
                                out[label] = {
                                    status: r.status, ok: r.ok,
                                    bodyLen: body.length,
                                    bodyStart: body.slice(0, 80)
                                };
                                // If one variant returns content, stop and
                                // deliver that.
                                if (r.ok && body.length > 8) {
                                    out.winner = label;
                                    out.body = body;
                                    out.status = r.status;
                                    return { ok: true, ...out };
                                }
                            } catch (err) {
                                out[label] = { error: err && err.message ? err.message : String(err) };
                            }
                        }
                        // Every variant came back empty (or threw). Include
                        // the full breakdown so the caller can surface a
                        // specific error.
                        return { ok: false, variants: out, error: 'All transcript URL variants returned empty (PO-token gating)' };
                    },
                    args: [url]
                });
                const result = injection && injection.result;
                if (!result) {
                    sendResponse({ ok: false, error: 'no result from page-world injection' });
                    return;
                }
                console.error('[X-Ray SW] fetchTranscript response:', {
                    ok: result.ok,
                    winner: result.winner,
                    status: result.status,
                    bodyLen: result.body ? result.body.length : 0,
                    bodyStart: result.body ? result.body.slice(0, 120) : null,
                    variants: result.variants,
                    error: result.error
                });
                if (result.ok) {
                    sendResponse({ ok: true, status: result.status, body: result.body, winner: result.winner });
                } else {
                    sendResponse({ ok: false, error: result.error, variants: result.variants });
                }
            } catch (err) {
                console.error('[X-Ray SW] executeScript threw:', err);
                sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
            }
        })();
        return true;
    }

    // Content script → worker: intercept YouTube's own InnerTube
    // `/youtubei/v1/get_transcript` POST response by patching
    // `window.fetch` in the page's MAIN world, then programmatically
    // clicking YouTube's "Show transcript" button to trigger the call.
    //
    // This is our primary transcript path since mid-2024: the signed
    // baseUrl from ytInitialPlayerResponse silently returns HTTP 200
    // with 0-byte bodies under PO-token gating even from the page's
    // own JS, so we piggyback on the request YouTube makes for its own
    // transcript panel. The response is structured InnerTube JSON —
    // cleaner than scraping the rendered DOM and immune to CSS-selector
    // churn.
    if (message.type === 'xray:youtube:captureTranscriptViaHook') {
        const tabId = sender && sender.tab && sender.tab.id;
        if (!tabId) { sendResponse({ ok: false, error: 'missing tabId' }); return false; }
        (async () => {
            console.error('[X-Ray SW] captureTranscriptViaHook, tab', tabId);
            try {
                const [injection] = await chrome.scripting.executeScript({
                    target: { tabId },
                    world: 'MAIN',
                    func: captureTranscriptInPage
                });
                const result = injection && injection.result;
                if (!result) { sendResponse({ ok: false, error: 'no result from page-world injection' }); return; }
                console.error('[X-Ray SW] captureTranscriptViaHook result:', {
                    ok: result.ok,
                    source: result.source,
                    eventCount: result.events ? result.events.length : 0,
                    error: result.error,
                    diag: result.diag
                });
                sendResponse(result);
            } catch (err) {
                console.error('[X-Ray SW] captureTranscriptViaHook executeScript threw:', err);
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

    // Reader → worker: archive-reader flow. Given a URL, query the
    // configured relay pool for kind-30023 events tagged with that
    // URL, pick the most recent, reconstruct the article, and hand
    // it back. Phase 7 C4+C5 (issue #18).
    // Element-cropped screenshot capture. Content script measures
    // the rect; SW does the captureVisibleTab + crop because the
    // tabs API isn't available in content scripts. Phase 8a.
    if (message.type === 'xray:screenshot:capture') {
        handleScreenshotCapture(message, sender)
            .then((res) => sendResponse(res))
            .catch((err) => sendResponse({ ok: false, error: err && err.message }));
        return true;
    }

    if (message.type === 'xray:archive:reconstruct') {
        const url = message.url;
        if (!url) { sendResponse({ ok: false, error: 'missing url' }); return false; }
        (async () => {
            try {
                const prefs = await new Promise((r) => {
                    (chrome.storage.local).get(['preferences'], (res) => {
                        const raw = res && res.preferences;
                        try { r(typeof raw === 'string' ? JSON.parse(raw) : (raw || {})); }
                        catch (_) { r({}); }
                    });
                });
                const relays = Array.isArray(prefs.default_relays) && prefs.default_relays.length > 0
                    ? prefs.default_relays
                    : ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'];
                const { events } = await NostrClient.queryRelays(
                    relays,
                    { kinds: [30023], '#r': [url], limit: 20 },
                    6000
                );
                if (events.length === 0) {
                    sendResponse({ ok: true, found: false });
                    return;
                }
                // Most recent event wins. kind-30023 is NIP-33 replaceable
                // per (pubkey, d-tag), so ties should be rare but real.
                events.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
                const pick = events[0];
                const article = EventBuilder.reconstructArticleFromEvent(pick);
                sendResponse({
                    ok: true,
                    found: true,
                    article,
                    eventId: pick.id,
                    authorPubkey: pick.pubkey,
                    createdAt: pick.created_at,
                    altCount: events.length - 1
                });
            } catch (err) {
                sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
            }
        })();
        return true; // async
    }

    // Reader / content script → worker: one-shot query across the
    // configured relay pool. Returns the de-duplicated set of events
    // + per-relay receive/EOSE stats. Used by Phase 5 C5's
    // "View others' claims" flow and the Phase 7 archive reader.
    if (message.type === 'xray:relay:query') {
        const relays  = Array.isArray(message.relays) ? message.relays : [];
        const filter  = message.filter;
        const timeout = Number.isFinite(message.timeoutMs) ? message.timeoutMs : 5000;
        if (!filter || typeof filter !== 'object') {
            sendResponse({ ok: false, error: 'missing or invalid filter' });
            return false;
        }
        if (relays.length === 0) {
            sendResponse({ ok: false, error: 'no relays configured' });
            return false;
        }
        NostrClient.queryRelays(relays, filter, timeout)
            .then((out) => sendResponse({ ok: true, events: out.events, byRelay: out.byRelay }))
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
    // The manifest command id stays `xray:toggle` so existing user key
    // bindings survive; it now triggers a capture rather than a toggle.
    if (command !== 'xray:toggle') return;
    captureActiveTab();
});

// ------------------------------------------------------------------
// Reader → sign → publish orchestration
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Page-world transcript capture (injected via chrome.scripting)
// ------------------------------------------------------------------
//
// Runs INSIDE the YouTube tab's MAIN world — not the SW, not the
// content-script isolated world. It must be fully self-contained: no
// closures over outer scope, no imports, no references to `chrome.*`.
// Everything needed at runtime has to live inside the function body.
//
// Strategy:
//   1. Monkey-patch window.fetch once per tab (idempotent). The patch
//      captures any `/youtubei/v1/get_transcript` or `/get_panel`
//      response and stores the parsed JSON on a global hook object.
//   2. Locate the "Show transcript" button (expanding the description
//      first if it's collapsed) and programmatically click it. This
//      triggers YouTube's own get_transcript POST, which the fetch
//      patch intercepts.
//   3. Await the first captured response (8-second timeout).
//   4. Parse the InnerTube JSON into [{ startMs, durationMs, text }]
//      events.
//
// Returns the same shape the content script expects:
//   { ok: true,  events, source }     on success
//   { ok: false, error, diag }        on failure (diag aids debugging)

async function captureTranscriptInPage() {
    // ---- 1. Install the fetch hook (once per tab) ------------------
    if (!window.__xrayTranscriptHook) {
        const hook = {
            responses: [],                 // [{ url, json }]
            pendingResolvers: [],          // functions waiting for the next response
            installedAt: Date.now()
        };
        window.__xrayTranscriptHook = hook;

        const origFetch = window.fetch;
        window.fetch = async function (...args) {
            const resp = await origFetch.apply(this, args);
            try {
                const input = args[0];
                const url = typeof input === 'string'
                    ? input
                    : (input && (input.url || String(input))) || '';
                if (url && /\/youtubei\/v1\/(get_transcript|get_panel)\b/.test(url)) {
                    const clone = resp.clone();
                    clone.text().then((body) => {
                        try {
                            const json = JSON.parse(body);
                            hook.responses.push({ url, json, at: Date.now() });
                            const resolvers = hook.pendingResolvers.splice(0);
                            resolvers.forEach((r) => { try { r(json); } catch (_) {} });
                        } catch (_) { /* not JSON, ignore */ }
                    }).catch(() => { /* read failure, ignore */ });
                }
            } catch (_) { /* never let the hook break the page */ }
            return resp;
        };
    }
    const hook = window.__xrayTranscriptHook;

    // ---- Helpers ---------------------------------------------------

    // Walk InnerTube JSON for the transcript segments. YouTube has two
    // shipped shapes; support both.
    const extractEvents = (json) => {
        const events = [];

        // Unwrap a text node: either { simpleText } or { runs: [{ text }] }.
        const textOf = (node) => {
            if (!node) return '';
            if (typeof node.simpleText === 'string') return node.simpleText;
            if (Array.isArray(node.runs)) {
                return node.runs.map((r) => (r && r.text) || '').join('');
            }
            return '';
        };

        // Newer shape: initialSegments[].transcriptSegmentRenderer
        //   { startMs, endMs, snippet: { runs | simpleText } }
        const pushNew = (segments) => {
            if (!Array.isArray(segments)) return;
            for (const seg of segments) {
                const r = seg && seg.transcriptSegmentRenderer;
                if (!r) continue;
                const startMs = parseInt(r.startMs, 10);
                const endMs   = parseInt(r.endMs, 10);
                const text = textOf(r.snippet).trim();
                if (!text) continue;
                events.push({
                    startMs: Number.isFinite(startMs) ? startMs : 0,
                    durationMs: Number.isFinite(endMs) && Number.isFinite(startMs)
                        ? Math.max(0, endMs - startMs)
                        : 0,
                    text
                });
            }
        };

        // Older shape: body.transcriptBodyRenderer.cueGroups[]
        //   .transcriptCueGroupRenderer.cues[].transcriptCueRenderer
        //     { startOffsetMs, durationMs, cue: { simpleText } }
        const pushOld = (groups) => {
            if (!Array.isArray(groups)) return;
            for (const g of groups) {
                const gr = g && g.transcriptCueGroupRenderer;
                if (!gr || !Array.isArray(gr.cues)) continue;
                for (const c of gr.cues) {
                    const cr = c && c.transcriptCueRenderer;
                    if (!cr) continue;
                    const startMs = parseInt(cr.startOffsetMs, 10) || 0;
                    const durationMs = parseInt(cr.durationMs, 10) || 0;
                    const text = textOf(cr.cue).trim();
                    if (!text) continue;
                    events.push({ startMs, durationMs, text });
                }
            }
        };

        // Try both known paths. Support updateEngagementPanelAction
        // (get_panel / get_transcript) and the bare transcriptRenderer
        // (direct get_transcript at top level).
        const visit = (renderer) => {
            if (!renderer) return;
            const body = renderer.content
                && renderer.content.transcriptSearchPanelRenderer
                && renderer.content.transcriptSearchPanelRenderer.body;
            if (body && body.transcriptSegmentListRenderer) {
                pushNew(body.transcriptSegmentListRenderer.initialSegments);
            }
            const legacy = renderer.body && renderer.body.transcriptBodyRenderer;
            if (legacy) pushOld(legacy.cueGroups);
        };

        try {
            const actions = Array.isArray(json && json.actions) ? json.actions : [];
            for (const a of actions) {
                const up = a && a.updateEngagementPanelAction;
                if (up && up.content && up.content.transcriptRenderer) {
                    visit(up.content.transcriptRenderer);
                }
            }
            if (json && json.content && json.content.transcriptRenderer) {
                visit(json.content.transcriptRenderer);
            }
            if (json && json.transcriptRenderer) visit(json.transcriptRenderer);
        } catch (_) { /* ignore */ }

        return events;
    };

    const findEventsInCache = () => {
        for (const rec of hook.responses) {
            const evs = extractEvents(rec.json);
            if (evs && evs.length > 0) return { events: evs, url: rec.url };
        }
        return null;
    };

    // Locate and click "Show transcript". Returns one of:
    //   'clicked' | 'no-button' | 'click-failed'
    const clickShowTranscript = () => {
        const candidates = document.querySelectorAll(
            'button, yt-button-shape, tp-yt-paper-button, ytd-button-renderer, ytd-menu-service-item-renderer'
        );
        for (const el of candidates) {
            const aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
            const txt = (el.textContent || '').trim();
            if (/show\s+transcript/i.test(aria) || /show\s+transcript/i.test(txt)) {
                try { el.click(); return 'clicked'; }
                catch (_) { return 'click-failed'; }
            }
        }
        return 'no-button';
    };

    // Try to expand the description so "Show transcript" is rendered.
    const expandDescription = () => {
        const sel = [
            'tp-yt-paper-button#expand',
            '#expand',
            'ytd-text-inline-expander #expand',
            'ytd-watch-metadata #expand'
        ];
        for (const s of sel) {
            const el = document.querySelector(s);
            if (el) { try { el.click(); return true; } catch (_) {} }
        }
        return false;
    };

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // ---- 2. Check if a prior fetch already landed ------------------

    let cached = findEventsInCache();
    if (cached) {
        return { ok: true, events: cached.events, source: 'fetch-hook-cached',
                 diag: { hookAgeMs: Date.now() - hook.installedAt, responseCount: hook.responses.length } };
    }

    // ---- 3. Arm a waiter, then click Show transcript ---------------

    const waitForNext = new Promise((resolve) => {
        hook.pendingResolvers.push(resolve);
    });

    const expanded = expandDescription();
    let clickResult = clickShowTranscript();
    if (clickResult === 'no-button') {
        // Description may not have rendered its transcript button yet.
        await sleep(400);
        clickResult = clickShowTranscript();
    }

    // ---- 4. Wait for the hook to fire ------------------------------

    const timedJson = await Promise.race([
        waitForNext,
        sleep(8000).then(() => null)
    ]);

    if (timedJson) {
        const events = extractEvents(timedJson);
        if (events.length > 0) {
            return { ok: true, events, source: 'fetch-hook',
                     diag: { expanded, clickResult, responseCount: hook.responses.length } };
        }
    }

    // Final sweep — a response may have arrived after the race resolved,
    // or before our waiter was registered.
    cached = findEventsInCache();
    if (cached) {
        return { ok: true, events: cached.events, source: 'fetch-hook-postwait',
                 diag: { expanded, clickResult, responseCount: hook.responses.length } };
    }

    // ---- 5. Report what we saw so the caller can diagnose ----------

    const responseSummary = hook.responses.map((rec) => ({
        url: rec.url,
        topKeys: rec.json && typeof rec.json === 'object' ? Object.keys(rec.json).slice(0, 8) : null,
        hasActions: !!(rec.json && Array.isArray(rec.json.actions))
    }));

    let error;
    if (clickResult === 'no-button') {
        error = '"Show transcript" button not found in the page. Videos without captions will not expose one; otherwise try manually clicking "…more" to expand the description, then re-run X-Ray.';
    } else if (clickResult === 'click-failed') {
        error = 'Found "Show transcript" button but click() threw (possibly disabled). Try clicking it manually, then re-run X-Ray.';
    } else if (hook.responses.length === 0) {
        error = 'Clicked "Show transcript" but YouTube did not fire a get_transcript fetch within 8s. Transcript panel may be cached from a prior open; close the panel and retry.';
    } else {
        error = 'Intercepted ' + hook.responses.length + ' InnerTube response(s) but none contained transcript segments. YouTube may have changed the JSON schema.';
    }

    return {
        ok: false,
        events: null,
        error,
        diag: { expanded, clickResult, responseCount: hook.responses.length, responseSummary }
    };
}

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

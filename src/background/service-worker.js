// X-Ray background service worker (MV3).
//
// Responsibilities:
//   - Register context-menu items on install/update.
//   - Forward context-menu clicks to the content script in the active tab.
//   - Bridge notifications (the userscript used GM_notification; we use
//     chrome.notifications). Content scripts send us a structured message
//     and we pop the native OS notification.
//   - Relay popup-driven actions (e.g. "Open Article Capture") to the
//     content script in the current tab.
//
// The actual UI logic stays in the content scripts — this worker is a
// thin dispatcher so we don't have to re-implement the capture panel here.

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

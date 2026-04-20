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
//
// Phase 1 (crypto) and Phase 2 (capture) add imports from ../shared/*.
// Phase 3+ moves the relay client and more heavy lifting here. For now,
// this worker is a thin dispatcher.

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

// Read-only foreign-workspace readers — Phase 28.6
// (docs/CASE_BOUND_WORKSPACES_KICKOFF.md §6 slice 6). The ONE module
// that reads across the workspace boundary, and it can only READ: a
// raw prefix-mapped storage get and a non-minting IDB open. Every
// write path stays bound to the active workspace through Storage — the
// fail-closed namespace (28.1) is not weakened here; it is crossed at
// a single deliberate, read-only door (§7 Q4: cross-workspace
// visibility arrives only as this surface).

import { workspaceDbName } from './workspace-keys.js';
import { ARTICLES_STORE } from './archive-cache.js';

function storageArea() {
    if (typeof browser !== 'undefined' && browser.storage) return browser.storage.local;
    if (typeof chrome !== 'undefined' && chrome.storage) return chrome.storage.local;
    return null;
}

/**
 * Read one key from workspace `wsId`'s storage namespace, parsed the
 * way Storage writes it (JSON string, raw tolerated). The default
 * workspace's namespace IS the bare key (28.1 — existing installs'
 * data is the default workspace).
 */
export async function readWorkspaceKey(wsId, key, defaultValue = null) {
    const area = storageArea();
    if (!area) return defaultValue;
    const raw = (!wsId || wsId === 'default') ? key : `ws:${wsId}:${key}`;
    const value = await new Promise((resolve) => {
        try { area.get([raw], (res) => resolve(res ? res[raw] : undefined)); }
        catch (_) { resolve(undefined); }
    });
    if (value === undefined || value === null) return defaultValue;
    if (typeof value === 'string') {
        try { return JSON.parse(value); } catch (_) { return value; }
    }
    return value;
}

// Open an EXISTING database or nothing. A versionless open only runs
// onupgradeneeded when the database did not exist (a fresh v1) — abort
// that transaction so this read path never mints an empty shell. A
// minted shell would be worse than junk: the real versioned open runs
// its schema creation off oldVersion===0, so an empty v1 would make it
// skip store creation and break the workspace's archive for good.
function openExistingDb(name) {
    return new Promise((resolve) => {
        const idb = globalThis.indexedDB || (typeof self !== 'undefined' && self.indexedDB);
        if (!idb) { resolve(null); return; }
        let open;
        try { open = idb.open(name); } catch (_) { resolve(null); return; }
        let minted = false;
        open.onupgradeneeded = (e) => {
            minted = true;
            try { e.target.transaction.abort(); } catch (_) { /* onerror follows */ }
        };
        open.onsuccess = () => {
            if (minted) {
                try { open.result.close(); } catch (_) { /* best effort */ }
                resolve(null);
                return;
            }
            resolve(open.result);
        };
        open.onerror = () => resolve(null);
        open.onblocked = () => resolve(null);
    });
}

/**
 * Every archive record in workspace `wsId`'s article store, read-only.
 * A workspace whose archive database does not exist yet reads as []
 * and the database is NOT created by the read.
 */
export async function readWorkspaceArticles(wsId) {
    const db = await openExistingDb(workspaceDbName('xray-archive', wsId));
    if (!db) return [];
    try {
        if (!Array.from(db.objectStoreNames).includes(ARTICLES_STORE)) return [];
        return await new Promise((resolve, reject) => {
            const req = db.transaction(ARTICLES_STORE, 'readonly')
                .objectStore(ARTICLES_STORE).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    } catch (_) {
        return [];
    } finally {
        try { db.close(); } catch (_) { /* read handle */ }
    }
}

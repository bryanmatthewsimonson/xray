// The capture→publish session records and their quota discipline —
// field-found 2026-08-25.
//
// Every capture stashes `xray:article:<id>` in chrome.storage.session
// so the reader (?id=<uuid>) and the publish/sign flows can look it up.
// The record must OUTLIVE its reads — a reader reload re-reads it, and
// sign-time reads it again — so nothing deletes on read, and before
// this module nothing deleted EVER. chrome.storage.session holds ~10MB;
// one heavy casework day (long transcripts, an EPUB, court PDFs) filled
// it, after which every new capture failed to register: "publish will
// fail until the browser is restarted".
//
// The rule here: write; on a QUOTA failure only, evict the oldest
// records in this one namespace — never the newest KEEP_NEWEST, never
// another namespace (the lens session cache shares the area) — and
// retry ONCE. A still-failing write, or any non-quota failure, returns
// the honest error for the caller's toast. An evicted record's reader
// tab (necessarily hours old) publishes as "Session record missing" and
// recovers by re-capture — strictly better than every NEW capture
// failing, which is what the leak produced.

/** How many of the newest records eviction must never touch — the
 *  captures the user is plausibly still working in. */
export const KEEP_NEWEST = 5;

const PREFIX = 'xray:article:';

function isQuotaError(message) {
    return /quota/i.test(String(message || ''));
}

/**
 * Write one capture record with quota-triggered eviction.
 * @param {object} area  chrome.storage.session (or .local fallback)
 * @param {string} key   'xray:article:<id>'
 * @param {object} record
 * @returns {Promise<{ok: boolean, error?: string, evicted: string[]}>}
 */
export function putSessionArticle(area, key, record) {
    const lastError = () => {
        const chrome = globalThis.chrome || globalThis.browser;
        const err = chrome && chrome.runtime && chrome.runtime.lastError;
        return err ? (err.message || String(err)) : null;
    };
    const setOnce = () => new Promise((resolve) => {
        area.set({ [key]: record }, () => resolve(lastError()));
    });
    return new Promise((resolve) => {
        setOnce().then((err) => {
            if (!err) return resolve({ ok: true, evicted: [] });
            if (!isQuotaError(err)) return resolve({ ok: false, error: err, evicted: [] });
            // Quota: evict oldest-first within the namespace, keep the
            // newest KEEP_NEWEST, retry once.
            area.get(null, (all) => {
                const rows = Object.entries(all || {})
                    .filter(([k]) => k.startsWith(PREFIX) && k !== key)
                    .map(([k, v]) => ({ key: k, createdAt: (v && v.createdAt) || 0 }))
                    .sort((a, b) => a.createdAt - b.createdAt);
                const evictable = rows.slice(0, Math.max(0, rows.length - KEEP_NEWEST));
                if (evictable.length === 0) {
                    return resolve({ ok: false, error: err, evicted: [] });
                }
                const keys = evictable.map((r) => r.key);
                area.remove(keys, () => {
                    setOnce().then((err2) => resolve(err2
                        ? { ok: false, error: err2, evicted: keys }
                        : { ok: true, evicted: keys }));
                });
            });
        });
    });
}

// Open a LOCAL archived record in the reader — the ONE opener every
// portal surface routes through.
//
// Field-found 2026-08-23: imported book chapters were unreachable. The
// "Unpublished local artifacts" rows rendered the INSTRUCTION "open
// this article in the reader" as plain text with no way to do it, and
// the book entity's "Captured content" list was equally inert. The only
// working opener was a private function inside case-view.js. A row that
// tells the user to do something the UI cannot do is a broken promise,
// not a hint — so the opener is extracted here and every surface that
// names an archived article routes through it.
//
// Injectable deps (the transcribe-flow io pattern) so node tests drive
// the whole decision path with stubs; the chrome-backed defaults are
// used by every real caller.

import { getArticle } from '../shared/archive-cache.js';

export async function openArchivedInReader(url, deps = {}) {
    const get = deps.getArticle || getArticle;
    const send = deps.sendMessage || ((msg) => new Promise((resolve) => {
        try { chrome.runtime.sendMessage(msg, (resp) => resolve(resp)); }
        catch (err) { resolve({ ok: false, error: (err && err.message) || String(err) }); }
    }));
    const newId = deps.newId || (() => crypto.randomUUID());

    let rec;
    try { rec = await get(url); }
    catch (err) { return { ok: false, error: `archive read failed: ${(err && err.message) || err}` }; }
    if (!rec || !rec.article) {
        return { ok: false, error: 'No local archive record for this article — it may have been pruned or imported in another workspace.' };
    }
    // Writable on purpose (the case-view precedent): tags and
    // newly-extracted claims must save back to the real record.
    const article = { ...rec.article, _articleHash: rec.articleHash };
    const resp = await send({ type: 'xray:reader:open', id: newId(), article, readOnly: false });
    if (!resp || !resp.ok) {
        return { ok: false, error: (resp && resp.error) || 'The reader did not open (service worker restarted?). Try again.' };
    }
    return { ok: true };
}

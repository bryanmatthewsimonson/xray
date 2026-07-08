// PDF tab detection — Phase 18 C3 (docs/COMPLEX_CONTENT_DESIGN.md §5.1).
//
// PURE module. Content scripts never run inside the browsers' PDF
// viewers, so a toolbar click on a PDF tab lands in the background's
// sendMessage-failure branch. This module answers: does this tab URL
// name a PDF document, and if so, what is the DOCUMENT's own URL?
//
// Shapes handled:
//   - direct: https://…/paper.pdf(?query)(#hash)   → itself
//   - Firefox's viewer keeps the document URL as the tab URL (its
//     pdf.js viewer is internal) — covered by the direct case.
//   - pdf.js-style wrapper pages: …/viewer.html?file=<enc-url>
//     (also `src=` — some embed wrappers use it)               → the
//     unwrapped file URL, when it is itself http(s).
//
// URLs this can't prove (no .pdf extension, no wrapper) are the
// caller's job via a Content-Type sniff — see the background router.

/** Does this URL's *path* end in .pdf (query/hash ignored)? */
export function looksLikePdfUrl(url) {
    try {
        const u = new URL(String(url || ''));
        return /\.pdf$/i.test(u.pathname);
    } catch (_) {
        return false;
    }
}

/**
 * The PDF document URL named by a tab URL, or null. Only ever returns
 * http(s) URLs — a viewer wrapper pointing at anything else (file:,
 * blob:, chrome:) is not fetchable by the reader and returns null.
 *
 * @param {string} tabUrl
 * @returns {string|null}
 */
export function pdfDocumentUrl(tabUrl) {
    let u;
    try { u = new URL(String(tabUrl || '')); } catch (_) { return null; }

    // Direct document URL FIRST. A URL that itself names a PDF is the
    // document — a `file=`/`src=` param on it is the document's own
    // query string, not a viewer wrapper. Unwrapping before this check
    // let `https://host/real.pdf?file=<decoy>` capture the decoy: a
    // wrong-document provenance failure.
    //
    // The fragment is dropped everywhere here: `#page=3` is a viewer
    // instruction, never sent to the server — same bytes, same
    // document. Keeping it forked the capture identity (the d-tag is
    // a hash of the RAW url), so a deep link and the bare URL yielded
    // two competing article events for one PDF.
    if ((u.protocol === 'https:' || u.protocol === 'http:') && /\.pdf$/i.test(u.pathname)) {
        u.hash = '';
        return u.href;
    }

    // Wrapper pages: unwrap file=/src= ONLY when the outer URL looks
    // like a pdf.js-style viewer shell. An arbitrary web page carrying
    // a pdf-ish `file=` param (error pages, search results) must not
    // be treated as a viewer.
    if (!isViewerShellUrl(u)) return null;
    for (const param of ['file', 'src']) {
        const raw = u.searchParams.get(param);
        if (!raw) continue;
        let inner;
        try { inner = new URL(raw, u.href); } catch (_) { continue; }
        if ((inner.protocol === 'https:' || inner.protocol === 'http:')
            && /\.pdf$/i.test(inner.pathname)) {
            inner.hash = '';
            return inner.href;
        }
    }
    return null;
}

/**
 * Google Drive PDF preview → the document's direct-download URL, or
 * null. Drive's preview is a text/html web app (NOT an application/pdf
 * document), so neither the content-type guard nor the background's
 * sendMessage-failure fallback can route it — capturing it as HTML
 * scraped the viewer chrome ("Page 2 of 27" became the title) and
 * shredded the text layer line-per-paragraph. Drive previews many
 * file types, so this routes only when the tab title names a .pdf;
 * the reader's fetch carries cookies, so files the user can see
 * usually download (a virus-scan interstitial or auth wall fails
 * pdf.js parse and falls back to the import picker, with the reason).
 *
 * @param {string} tabUrl    the drive.google.com tab URL
 * @param {string} [title]   the tab/document title ("name.pdf - Google Drive")
 * @returns {string|null}
 */
export function googleDrivePdfUrl(tabUrl, title = '') {
    let u;
    try { u = new URL(String(tabUrl || '')); } catch (_) { return null; }
    if (u.hostname !== 'drive.google.com') return null;
    const m = /^\/file\/d\/([\w-]+)/.exec(u.pathname);
    const id = (m && m[1])
        || (u.pathname === '/open' ? u.searchParams.get('id') : null);
    if (!id || !/\.pdf\b/i.test(String(title || ''))) return null;
    return 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(id);
}

// A URL shaped like a PDF viewer shell: an extension/resource-hosted
// viewer (Firefox's pdf.js wrapper, extension viewers), or an html
// page whose filename says viewer (pdf.js's canonical web/viewer.html
// and publisher-embedded copies).
function isViewerShellUrl(u) {
    if (u.protocol === 'chrome-extension:' || u.protocol === 'moz-extension:'
        || u.protocol === 'edge-extension:' || u.protocol === 'resource:') {
        return true;
    }
    const last = (u.pathname.split('/').pop() || '').toLowerCase();
    return /viewer[^/]*\.x?html?$/.test(last) || /^pdf(js)?[^/]*\.x?html?$/.test(last);
}

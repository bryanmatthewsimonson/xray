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

    // Wrapper pages (pdf.js viewer.html and friends): unwrap file=/src=.
    for (const param of ['file', 'src']) {
        const raw = u.searchParams.get(param);
        if (!raw) continue;
        let inner;
        try { inner = new URL(raw, u.href); } catch (_) { continue; }
        if ((inner.protocol === 'https:' || inner.protocol === 'http:')
            && /\.pdf$/i.test(inner.pathname)) {
            return inner.href;
        }
    }

    // Direct document URL.
    if ((u.protocol === 'https:' || u.protocol === 'http:') && /\.pdf$/i.test(u.pathname)) {
        return u.href;
    }
    return null;
}

// Anchors the browser smoke (tools/smoke/) observes, shared with the
// product so each seam is ONE constant, not two strings that must agree.
//
// Two kinds:
//   SMOKE_ANCHORS — `data-xr="…"` values a scenario selects by. Product
//     code sets them from this table (never a literal), the scenarios
//     import the same table, and tests/smoke-selectors.test.mjs fails
//     when a value here is set nowhere in src/.
//   the ready stamp — `<html data-xr-ready="<page>">`, set by every
//     extension page as the LAST act of its init, on every exit path
//     (an empty state is a rendered state). The `pages` scenario waits
//     for it: a bundle that never runs, an init that throws before
//     finishing, or a page that forgets to stamp, goes red.
//
// Pure module: no chrome.*, no DOM touched at import time, so the
// node-side scenarios and the unit suite import it directly.
// Provenance: INTERPRETATION (2026-09-07) — an agent convention under
// RESET_PLAN R0; the maintainer has not ruled on it.

export const SMOKE_ANCHORS = Object.freeze({
    extractionBlock: 'extraction-block'
});

/** dataset key of the ready stamp (the attribute is `data-xr-ready`). */
export const READY_KEY = 'xrReady';

/** Stamp the page ready. Idempotent; a no-op where there is no DOM. */
export function markReady(page) {
    try { document.documentElement.dataset[READY_KEY] = page; } catch (_) { /* no DOM */ }
}

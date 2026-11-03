// Inline overlay wiring for the content-script entry (flag inlineOverlay,
// default OFF). Kept out of content/index.js, which is under a line
// ceiling (structure-guards rule 5): index.js calls bootOverlay() at the
// end of init, routes every capture through capturePage(), and forwards
// the `xray:overlay:addNote` command to overlayAddNote().

import { Utils } from '../shared/utils.js';
import { UI } from './ui.js';
import { loadFlags, isEnabled } from '../shared/metadata/feature-flags.js';
import { startOverlay, withOverlaySuspended } from './overlay.js';
import { mountFrame } from './overlay-frame.js';
import { isWatchPage, videoSeconds } from './overlay-youtube.js';

// The overlay's handle, once started. Every capture runs with it
// suspended, so no overlay node can reach the extracted DOM.
let overlayHandle = null;

/**
 * Capture this page (UI.openReader) with the inline overlay suspended.
 * Fire-and-forget: a failure is logged here, never thrown to the caller.
 */
export function capturePage(opts) {
    return withOverlaySuspended(overlayHandle, () => UI.openReader(opts))
        .catch((err) => Utils.error('Capture failed:', err));
}

/** The "Add X-Ray note" command: a no-op while the overlay is off. */
export function overlayAddNote() {
    if (overlayHandle) overlayHandle.addNote();
}

/** Start the overlay when the flag is on. Failure never affects capture. */
export async function bootOverlay() {
    try {
        await loadFlags();
        if (!isEnabled('inlineOverlay')) return;
        // The card iframe (extension origin) renders all content; the
        // overlay hands it ids through an isolated-world callback.
        let overlay = null;
        const frame = mountFrame({
            window, document, chrome,
            notify: (m) => UI.showToast(m, 'warning'),
            onChanged: () => overlay && overlay.refresh()
        });
        overlay = overlayHandle = startOverlay({
            window, document, chrome,
            onOpen: (d) => frame.open(d),
            onClose: () => frame.close(),
            getVideoSeconds: () => (isWatchPage(window.location.href) ? videoSeconds(document) : null)
        });
    } catch (err) {
        Utils.error('Inline overlay failed to start:', err);
    }
}

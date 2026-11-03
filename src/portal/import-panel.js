// The header's import-panel switch — PR-3 of docs/PORTAL_UX_REVIEW.md
// (the mechanical half of finding D1).
//
// Four header buttons (Import transcript / Transcribe a URL / Import
// book / Import URLs) share ONE mount point, #xr-import-host. Each used
// to run the same first line — "if anything is open, close it and
// return" — which made a click on a DIFFERENT importer merely close
// the open one; the importer you asked for took a second click. This
// module owns the rule instead:
//
//   same panel open  → close it          (the toggle everyone expects)
//   other panel open → swap in ONE click
//   nothing open     → open
//
// It keys on the LIVE child count, not only on the name it stamped,
// because every panel's own Close button does panel.remove() without
// telling anyone — a name-only check would then "close" an already
// empty host on the next click of the same button.
//
// Pure over a host-shaped object (childElementCount / dataset /
// replaceChildren) so node tests drive it without a DOM.

/**
 * @param {HTMLElement} host  the shared mount point
 * @returns {{ open(name: string, mount: (host: HTMLElement) => void): 'opened'|'closed' }}
 */
export function createImportPanelSwitch(host) {
    return {
        open(name, mount) {
            const isOpen = host.childElementCount > 0;
            if (isOpen && host.dataset.xrPanel === name) {
                host.replaceChildren();
                delete host.dataset.xrPanel;
                return 'closed';
            }
            host.replaceChildren();
            host.dataset.xrPanel = name;
            mount(host);
            return 'opened';
        }
    };
}

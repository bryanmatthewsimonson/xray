// Small, shared row chrome — PR-5 of docs/PORTAL_UX_REVIEW.md.
//
// C2: the inspector's opener was a secret. A row's TITLE opened the
// drawer, disclosed only by a hover tooltip — invisible on touch and to
// anyone who does not hover. Every row builder now puts a visible ⓘ
// beside the title, bound to the same handler; the title click stays.
// One builder here so the three row sites (library rows, case-view
// claim rows, case-view local rows) cannot drift.
//
// B3: drag-to-brush on the timeline existed only as mouse handlers and
// an HTML comment. The caption text lives here so the render site and
// the guard test share one string.
//
// Pure DOM construction via document.createElement — no imports, so a
// node test can drive it with a stub document.

export const TIMELINE_HINT = 'Drag across the bars to filter by time';

/**
 * The visible inspector opener: a small ⓘ icon-button.
 * @param {() => void} onOpen  the SAME handler the title click uses
 * @returns {HTMLButtonElement}
 */
export function inspectButton(onOpen) {
    const btn = document.createElement('button');
    btn.className = 'xr-row__inspect';
    btn.setAttribute('type', 'button');
    btn.setAttribute('aria-label', 'Inspect this item — raw event, relays holding it, publish status');
    btn.textContent = 'ⓘ';   // ⓘ
    btn.addEventListener('click', (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        onOpen();
    });
    return btn;
}

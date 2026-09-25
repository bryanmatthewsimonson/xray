// X-Ray side panel — pure text formatters (escapeHtml, fmtRelative,
// hostOf). Moved verbatim out of sidepanel/index.js, which imports them
// back: none of them touches the DOM or closes over module state, so the
// move is behaviour-identical. Extracted to keep index.js under its
// structure-guard line ceiling (tests/structure-guards.test.mjs rule 5 —
// "extract a module, never raise the ceiling"). Only pure, DOM-free
// helpers belong here; anything that reads state or the page stays in
// index.js.

export function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

export function fmtRelative(unixSec) {
    if (!unixSec) return '';
    const diffSec = Math.floor(Date.now() / 1000) - unixSec;
    if (diffSec < 60)      return 'just now';
    if (diffSec < 3600)    return Math.floor(diffSec / 60)   + 'm ago';
    if (diffSec < 86400)   return Math.floor(diffSec / 3600) + 'h ago';
    if (diffSec < 2592000) return Math.floor(diffSec / 86400) + 'd ago';
    return new Date(unixSec * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function hostOf(url) {
    try { return new URL(url).host; } catch { return String(url || ''); }
}

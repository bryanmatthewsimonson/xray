// Margin S1 — grounding + disjoint-segment partition (pure).
// docs/MARGIN_DESIGN.md §3/§5.2. Offsets index the TEXT HANDED IN
// (the annotated container's textContent) and never persist — the
// quote is the identity; stored offsets are hints only (the
// two-substrate invariant, reader/index.js:3308-3315).
import { PAGE_REASONS } from './notes.js';

export function groundNotes(notes, index) {
    return notes.map((n) => {
        if (n.pageReason) return { ...n };
        const quote = String(n.quote || '').trim();
        if (!quote) return { ...n, pageReason: PAGE_REASONS.noAnchorRecorded };
        // A claim whose only groundable text is its paraphrase (no
        // first-class verbatim quote) gets the strict exact/normalized
        // tiers — a miss demotes honestly instead of fuzzy-guessing
        // the wrong sentence.
        const verbatim = n.family !== 'claim' || !!(n.meta && n.meta.quote);
        const g = verbatim ? index.ground(quote) : index.locate(quote);
        if (!g || g.status === 'missing') {
            return { ...n, pageReason: verbatim ? PAGE_REASONS.couldNotLocate : PAGE_REASONS.noAnchorRecorded };
        }
        return { ...n, grounding: { status: g.status, start: g.start, end: g.end, exact: g.exact } };
    });
}

export function partitionSegments(notes) {
    const anchored = notes.filter((n) => n.grounding && !n.pageReason);
    const bounds = new Set();
    for (const n of anchored) {
        bounds.add(n.grounding.start);
        bounds.add(n.grounding.end);
    }
    const cuts = [...bounds].sort((a, b) => a - b);
    const segments = [];
    for (let i = 0; i < cuts.length - 1; i++) {
        const start = cuts[i];
        const end = cuts[i + 1];
        const ids = anchored
            .filter((n) => n.grounding.start < end && n.grounding.end > start)
            .map((n) => n.id);
        if (ids.length) segments.push({ start, end, ids });
    }
    return segments;
}

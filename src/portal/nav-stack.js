// The portal's navigation memory — PR-6 of docs/PORTAL_UX_REVIEW.md
// (finding B1, harm class "task blocked").
//
// Before this existed, every "back" was a hard-coded jump to the
// library, so the dominant casework loop — case → person → dossier →
// back — LOST THE CASE on every exploration and paid a re-find each
// time; browser Back exited the portal entirely.
//
// Pure and injectable-free: a bounded LIFO of view objects. The portal
// keeps exactly one instance; every forward navigation pushes the view
// being left, and back pops. An empty stack falls back to the library —
// the pre-existing behavior, now the floor instead of the whole story.

export const NAV_STACK_MAX = 50;

export function createNavStack({ max = NAV_STACK_MAX } = {}) {
    const stack = [];
    return {
        /** Record the view being LEFT. Consecutive duplicates are
         *  dropped so re-clicking the link you are already on cannot
         *  make Back a no-op loop. */
        push(view) {
            if (!view || typeof view !== 'object') return;
            const top = stack[stack.length - 1];
            if (top && JSON.stringify(top) === JSON.stringify(view)) return;
            stack.push(view);
            // Bounded: a long session must not grow memory without
            // limit; the OLDEST history rolls off.
            if (stack.length > max) stack.shift();
        },
        /** The view to return to — or the library floor. */
        pop() {
            return stack.pop() || { name: 'library' };
        },
        /** For labeling: where would Back go right now? */
        peek() {
            return stack[stack.length - 1] || { name: 'library' };
        },
        size() { return stack.length; }
    };
}

/** A short human name for a view, for the Back button's label. */
export function viewLabel(view) {
    const names = {
        library: 'Library',
        case: 'Case',
        entity: 'Entity',
        'entity-dossier': 'Dossier',
        'entity-corpus': 'Corpus',
        'cross-workspace': 'Workspaces'
    };
    return names[(view && view.name) || 'library'] || 'Back';
}

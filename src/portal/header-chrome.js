// The portal header's pure pieces — PR-8 of docs/PORTAL_UX_REVIEW.md.
//
// D1 (layout half): the header mixed three action families in one row
// — four import buttons, a graph view, two sync buttons. It is now ONE
// "Add ▾" menu (the case view's "Sources ▾" idiom), a visible Refresh,
// and a "⋯" overflow for Full resync + Across workspaces. The option
// list lives here, pure, so the flag gate on "Transcribe a URL" is
// unit-tested instead of walked.
//
// D2 (fold half): the identity strip — provenance chips, the viewer
// input, the settings button — folds behind one summary line. The line
// is composed here so the distinction identity.js enforces (a pasted
// npub is a VIEWER, never "me") stays visible in the words.
//
// No DOM, no imports beyond the short-key formatter.

import { shortKey } from './dom.js';

/**
 * The Add ▾ menu, placeholder first. "Transcribe a URL" is flag-gated
 * (localTranscription) and ABSENT when off — hidden, not greyed — the
 * same posture the header button it replaces had.
 * @param {{transcribeEnabled: boolean}} flags
 * @returns {Array<{value: string, label: string, title: string}>}
 */
export function addMenuOptions({ transcribeEnabled }) {
    const opts = [
        { value: '', label: 'Add ▾', title: 'Add to the archive — a transcript, a book, or a list of URLs' },
        { value: 'transcript', label: 'Import transcript…',
            title: 'Paste or upload a podcast transcript into the archive' }
    ];
    if (transcribeEnabled) {
        opts.push({ value: 'media', label: '🎙 Transcribe a URL…',
            title: 'Paste any https media URL and run the companion transcription service' });
    }
    opts.push(
        { value: 'book', label: 'Import book…',
            title: 'Import an EPUB book — each chapter becomes a capture, grouped under the book' },
        { value: 'urls', label: 'Import URLs…',
            title: 'Paste a URL list — each page is fetched, extracted, and archived' }
    );
    return opts;
}

/**
 * The "⋯" overflow: the two actions that are neither daily nor
 * first-paint. Placeholder first.
 */
export function moreMenuOptions() {
    return [
        { value: '', label: '⋯', title: 'More — across workspaces, full resync' },
        { value: 'cross-ws', label: 'Across workspaces',
            title: 'Read-only graph across workspaces — shared names as cross-case signal' },
        { value: 'resync', label: 'Full resync',
            title: 'Drop the local cache and re-fetch everything from the relays' }
    ];
}

/**
 * One line that says whose events are on screen. Identities are
 * LISTED (you should see whose), viewers are named as viewing — never
 * folded into "signed by", because identity.js keeps them out of the
 * "me" set for reconcile/binding/resolver and the words must agree.
 * @param {{identities: Array<{pubkey: string}>, viewers: Array<{pubkey: string}>}} s
 * @returns {string}
 */
export function identitySummaryLine({ identities = [], viewers = [] }) {
    const mine = identities.map((i) => shortKey(i.pubkey));
    const theirs = viewers.map((v) => shortKey(v.pubkey));
    let line = mine.length
        ? `Showing events signed by ${mine.join(', ')}`
        : 'No archive identity yet';
    if (theirs.length) line += ` · viewing ${theirs.join(', ')}`;
    return line;
}

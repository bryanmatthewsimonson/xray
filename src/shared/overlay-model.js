// Inline overlay model: assembles the user's records for one URL into
// overlay items, and projects them down to what a content script on a
// third-party page may see.
//
// PRIVACY BOUNDARY: `toLookupItems` is an explicit allow-list. Everything
// a card needs to display (claim text, notes, verdicts, assessments, ...)
// lives in `detail`, which never leaves the background / extension pages.
// Pure module: no storage, no chrome.*.

import { normalize as normalizeUrl } from './metadata/url-normalizer.js';

export const LOOKUP_ALLOWED_KEYS = Object.freeze([
    'id', 'kind', 'anchor', 'quote', 'seconds', 'judgmentKinds', 'reviewState'
]);

const EXTRACTION_REVIEW = { open: 'unreviewed', accepted: 'accepted', dismissed: 'rejected' };

function judgments(assessments, verdicts) {
    const kinds = [];
    if (assessments && assessments.length) kinds.push('assessment');
    if (verdicts && verdicts.length) kinds.push('verdict');
    return kinds;
}

/**
 * @param {string} url
 * @param {{claims?:Array, assessmentsByClaim?:Map, verdictsByClaim?:Map,
 *          findings?:Array, extraction?:object|null, notes?:Array,
 *          secondsFor?:function}} sources
 * @returns {Array} FullItem[]
 */
export function buildOverlay(url, sources = {}) {
    const {
        claims = [], assessmentsByClaim = new Map(), verdictsByClaim = new Map(),
        findings = [], extraction = null, notes = [], secondsFor = null
    } = sources;
    const target = normalizeUrl(url);
    const items = [];
    const push = (item, timestamp) => {
        let seconds = typeof timestamp === 'number' ? timestamp : null;
        if (seconds === null && item.quote && typeof secondsFor === 'function') {
            const s = secondsFor(item.quote);
            seconds = typeof s === 'number' ? s : null;
        }
        items.push({ ...item, seconds });
    };

    const claimIds = new Set();
    for (const c of claims) {
        claimIds.add(c.id);
        const assessments = assessmentsByClaim.get(c.id) || [];
        const verdicts = verdictsByClaim.get(c.id) || [];
        push({
            id: `claim:${c.id}`, kind: 'claim',
            anchor: c.anchor || null, quote: c.quote || '',
            judgmentKinds: judgments(assessments, verdicts),
            reviewState: null,
            detail: { claim: c, text: c.text, is_key: !!c.is_key, assessments, verdicts }
        });
    }

    for (const f of findings) {
        (f.anchors || []).forEach((a, i) => {
            const ref = a && a.source_ref;
            if (!ref || !ref.url || normalizeUrl(ref.url) !== target) return;
            push({
                id: `finding:${f.id}:${i}`, kind: 'finding',
                anchor: a.selector || null, quote: a.quote || '',
                judgmentKinds: [], reviewState: null,
                detail: {
                    finding: f, counter_note: f.counter_note, maneuver: f.maneuver, role: f.role
                }
            }, a.timestamp);
        });
    }

    if (extraction && Array.isArray(extraction.assertions)) {
        for (const a of extraction.assertions) {
            // Already surfaced as its claim card: don't show it twice.
            if (a.status === 'accepted' && a.accepted_claim_id && claimIds.has(a.accepted_claim_id)) continue;
            push({
                id: `extraction:${a.key}`, kind: 'extraction',
                anchor: null, quote: a.quote || '',
                judgmentKinds: [],
                reviewState: EXTRACTION_REVIEW[a.status] || 'unreviewed',
                detail: { assertion: a, text: a.text || a.quote || '', why: a.why || '' }
            });
        }
    }

    for (const n of notes) {
        push({
            id: `note:${n.id}`, kind: 'note',
            anchor: n.anchor || null, quote: n.quote || '',
            judgmentKinds: [], reviewState: null,
            detail: { note: n, text: n.text || '' }
        }, n.seconds);
    }
    return items;
}

/** Project FullItems to the allow-listed shape sent to content scripts. */
export function toLookupItems(items) {
    return (items || []).map((it) => {
        const out = {};
        for (const k of LOOKUP_ALLOWED_KEYS) out[k] = it[k];
        return out;
    });
}

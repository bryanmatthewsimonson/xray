// network-trust.js — KS.8: the trust graph wired as a reader-side
// feed filter (Phase 25.7; NETWORK_CLIENT_DESIGN §7). The dormant
// Phase-9a trust-graph module finally gets its consumer.
//
// Discipline (KS §8 / TC §3.8): per-reader filtering ONLY — the
// toggle NARROWS, never reorders, and counts are discovery, never
// ranking. The LOCAL follow registry is primary: the graph's contact
// list is synthesized from `follow_sets`, not from the user's own
// published kind 3 (which may be stale or absent). `ranker.js` stays
// unwired — feed order remains strictly newest-first.

import { composeGraph, trustedAuthors } from './metadata/trust-graph.js';

const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * A Kind3Event-shaped contact list synthesized from the local global
 * follow set, so composeGraph can consume the registry directly.
 * Local data, never published — the wire mirror is 25.6's job.
 */
export function synthesizeContactList(followEntries, ownerPubkey) {
    return {
        kind: 3,
        pubkey: ownerPubkey || '',
        created_at: 0,
        id: '',
        tags: (followEntries || [])
            .filter((e) => e && HEX64.test(String(e.pubkey || '')))
            .map((e) => ['p', e.pubkey.toLowerCase()])
    };
}

/**
 * Compose the reader's trust graph: local follows as the contact
 * list (+ any topic-trust events the caller has — none are fetched
 * in v1; the parameter keeps the seam open).
 */
export function buildReaderGraph({ ownerPubkey, followEntries, topicTrustEvents = [] }) {
    return composeGraph({
        pubkey: ownerPubkey || 'local',
        contactList: synthesizeContactList(followEntries, ownerPubkey),
        topicTrustEvents
    });
}

/**
 * "Followed by N of your follows" — the FoF discovery counts for
 * collapsed unfollowed authors and adopt candidates. Consumes the
 * follows' FETCHED kind 3s (each already the newest per author via
 * cache supersession). Counts only — never ranking (TC §3.8).
 *
 * @param {Iterable<string>} pubkeys        the unknown keys to look up
 * @param {Array<object>} followContactLists the follows' kind-3 events
 * @returns {Map<string, number>}           pubkey → distinct-follower count
 */
export function followedByCounts(pubkeys, followContactLists) {
    const wanted = new Set([...(pubkeys || [])].map((p) => String(p).toLowerCase()).filter((p) => HEX64.test(p)));
    const counts = new Map();
    if (wanted.size === 0) return counts;
    const seenAuthors = new Set();
    for (const ev of (followContactLists || [])) {
        if (!ev || ev.kind !== 3 || !ev.pubkey) continue;
        const author = ev.pubkey.toLowerCase();
        if (seenAuthors.has(author)) continue;   // one list per follow
        seenAuthors.add(author);
        const inList = new Set();
        for (const t of ev.tags || []) {
            if (!Array.isArray(t) || t[0] !== 'p' || typeof t[1] !== 'string') continue;
            const pk = t[1].toLowerCase();
            if (wanted.has(pk)) inList.add(pk);
        }
        for (const pk of inList) counts.set(pk, (counts.get(pk) || 0) + 1);
    }
    return counts;
}

/**
 * The narrow-only filter (KS.8): with the toggle ON, the feed keeps
 * only items whose provenance is entirely inside the trusted set —
 * items that build on unfollowed material drop, and the collapsed
 * unsolicited strip empties. Order is untouched (never reorders);
 * nothing is ever promoted. Returns a NEW feed object plus the hidden
 * counts for honest disclosure.
 *
 * @param {{items: Array, collapsed: Array}} feed  assembleNetworkFeed output
 * @param {object} graph                           buildReaderGraph output
 * @returns {{feed: object, hiddenItems: number, hiddenAuthors: number}}
 */
export function filterFeedByTrust(feed, graph) {
    const trusted = trustedAuthors(graph);
    const items = (feed.items || []).filter((item) =>
        !item.buildsOnUnfollowed
        && (item.bucket === 'self' || trusted.has(item.author)));
    return {
        feed: { ...feed, items, collapsed: [] },
        hiddenItems: (feed.items || []).length - items.length,
        hiddenAuthors: (feed.collapsed || []).length
    };
}

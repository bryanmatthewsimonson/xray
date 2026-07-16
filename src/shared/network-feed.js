// Network follows feed — Phase 25.2a (the KS §5 `authors` query class
// over the global follow set; docs/NETWORK_CLIENT_DESIGN.md §3–§4).
//
// Pure helpers, sibling of entity-feed.js: filters out, verified relay
// events in (signature verification happened upstream in queryRelays —
// KS.1), render-ready rows back. Per-kind parsing is shared verbatim
// with the entity feed via parseFeedEvent, so the two feeds render
// identical rows for the same event.
//
// Rendering-discipline substrate (KS §8 / TC §3), computed here so the
// page just renders:
//   - every item is bucketed `self | followed | unfollowed`;
//   - `unfollowed` items are NEVER returned as rows — only as collapsed
//     per-author counts. The authors-axis filter asked for followed
//     authors, so an unfollowed author in the response means a relay
//     returned unsolicited (if validly signed) events; collapsing them
//     is the evil-relay defense, not just aesthetics;
//   - items are strictly newest-first — no other ordering, no ranking;
//   - `buildsOnUnfollowed` marks items whose `a`-refs point at authors
//     outside self+follows (TC §3.3 provenance propagation; `e`/`x`
//     refs can't be attributed without an event index — a named v1
//     limit).
//
// On this axis 30063 verdicts arrive FIRST-CLASS (author-signed) — the
// KS §12.2 two-hop limit applies only to the entity feed's #p axis.

import { dedupeReplaceable } from './nostr-events.js';
import { parseFeedEvent, collectCandidatePubkeys } from './entity-feed.js';

// Pinned by test. Deliberately a subset of the portal's CONTENT_KINDS:
// no 30041 comment bodies, no 30078 ciphertext, no dormant metadata
// kinds. 30068 case briefs are the Phase-23 publishable synthesis — a
// followee's brief is exactly what a truth-seeker follows them for.
export const NETWORK_FEED_KINDS = [30023, 30040, 30054, 30055, 30062, 30063, 30064, 30068, 32126, 1985];

// Per-author render cap (NETWORK_CLIENT_DESIGN §3): a flooding
// followee saturates their own group, not the feed.
export const AUTHOR_ITEM_CAP = 100;

// Total relay cap after NIP-65 widening (25.5) — a few good relays
// beat a long tail of dead ones, and each extra relay is another
// socket per refresh.
export const WIDENED_RELAY_CAP = 8;

/**
 * NIP-65 relay widening (KS.7 / Phase 25.5): union the configured
 * relays with followees' harvested hints, configured-first, capped at
 * WIDENED_RELAY_CAP. Pure — never mutates the user's relay prefs
 * (the offerRelayListAdoption posture). `normalize` is injectable so
 * this module stays dependency-light; pass entity-sync's
 * normalizeRelayUrl for real use.
 */
export function widenRelays(configured, hintLists, { cap = WIDENED_RELAY_CAP, normalize = (u) => u } = {}) {
    const out = [];
    const seen = new Set();
    const push = (url) => {
        if (typeof url !== 'string' || !/^wss?:\/\//i.test(url)) return;
        const key = normalize(url);
        if (seen.has(key) || out.length >= cap) return;
        seen.add(key);
        out.push(url);
    };
    for (const u of (configured || [])) push(u);
    for (const list of (hintLists || [])) {
        for (const u of (Array.isArray(list) ? list : [])) push(u);
    }
    return out;
}

/**
 * Authors-axis relay filters. Claims get their own filter so
 * high-volume kinds never crowd 30040s out of a shared newest-first
 * relay window — the same lesson as entity-feed's buildFeedFilters.
 */
export function buildAuthorFilters(pubkeys, { claimLimit = 200, limit = 300 } = {}) {
    const pks = [...new Set((pubkeys || []).filter((pk) => /^[0-9a-f]{64}$/i.test(String(pk || ''))).map((pk) => pk.toLowerCase()))];
    if (pks.length === 0) return [];
    return [
        { kinds: [30040], authors: pks, limit: claimLimit },
        { kinds: NETWORK_FEED_KINDS.filter((k) => k !== 30040), authors: pks, limit }
    ];
}

function trustBucket(pubkey, selfSet, followSet) {
    const pk = String(pubkey || '').toLowerCase();
    if (selfSet.has(pk)) return 'self';
    if (followSet.has(pk)) return 'followed';
    return 'unfollowed';
}

/** True when any `a`-tag coordinate's author is outside the trusted set. */
function buildsOnUnfollowed(event, trusted) {
    for (const t of event.tags || []) {
        if (!Array.isArray(t) || t[0] !== 'a' || typeof t[1] !== 'string') continue;
        const parts = t[1].split(':');
        if (parts.length < 3 || !/^[0-9a-f]{64}$/i.test(parts[1])) continue;
        if (!trusted.has(parts[1].toLowerCase())) return true;
    }
    return false;
}

/**
 * Assemble verified authors-axis events into the render substrate.
 *
 * @param {Array<object>} events  verified events from the author filters
 * @param {{followedPubkeys?: string[], selfPubkeys?: string[]}} [opts]
 * @returns {{
 *   items: Array<{event, parsed, key, coord, author, bucket, buildsOnUnfollowed}>,
 *   collapsed: Array<{pubkey: string, count: number, kinds: Object<string, number>}>,
 *   authors: Map<string, number>,
 *   capped: Array<{pubkey: string, dropped: number}>,
 *   candidates: Array<{pubkey: string, roles: string[], count: number}>
 * }}
 */
export function assembleNetworkFeed(events, { followedPubkeys = [], selfPubkeys = [] } = {}) {
    const followSet = new Set((followedPubkeys || []).map((pk) => String(pk).toLowerCase()));
    const selfSet = new Set((selfPubkeys || []).map((pk) => String(pk).toLowerCase()));
    const trusted = new Set([...selfSet, ...followSet]);

    const seenIds = new Set();
    const merged = [];
    for (const ev of (Array.isArray(events) ? events : [])) {
        if (!ev || (ev.id && seenIds.has(ev.id))) continue;
        if (ev.id) seenIds.add(ev.id);
        merged.push(ev);
    }
    const deduped = dedupeReplaceable(merged);

    const items = [];
    const collapsedMap = new Map();   // unfollowed author → {count, kinds}
    const authors = new Map();
    const perAuthor = new Map();
    const candidateMap = new Map();

    // Newest-first BEFORE the per-author cap so the cap keeps each
    // author's newest items, not their relay-arrival-order ones.
    deduped.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    const capped = new Map();
    for (const ev of deduped) {
        const res = parseFeedEvent(ev);
        if (!res) continue;
        const author = ev.pubkey.toLowerCase();
        const bucket = trustBucket(author, selfSet, followSet);
        authors.set(author, (authors.get(author) || 0) + 1);

        if (bucket === 'unfollowed') {
            const cur = collapsedMap.get(author) || { count: 0, kinds: {} };
            cur.count++;
            cur.kinds[ev.kind] = (cur.kinds[ev.kind] || 0) + 1;
            collapsedMap.set(author, cur);
            continue;
        }

        const n = (perAuthor.get(author) || 0) + 1;
        perAuthor.set(author, n);
        if (n > AUTHOR_ITEM_CAP) {
            capped.set(author, (capped.get(author) || 0) + 1);
            continue;
        }

        const d = ((ev.tags || []).find((t) => Array.isArray(t) && t[0] === 'd') || [])[1];
        items.push({
            event: ev,
            parsed: res.parsed,
            key: res.key,
            coord: d ? `${ev.kind}:${ev.pubkey}:${d}` : null,
            author,
            bucket,
            buildsOnUnfollowed: buildsOnUnfollowed(ev, trusted)
        });
        collectCandidatePubkeys(ev, trusted, candidateMap);
    }

    return {
        items,
        collapsed: [...collapsedMap.entries()]
            .map(([pubkey, m]) => ({ pubkey, count: m.count, kinds: m.kinds }))
            .sort((a, b) => b.count - a.count),
        authors,
        capped: [...capped.entries()].map(([pubkey, dropped]) => ({ pubkey, dropped })),
        candidates: [...candidateMap.entries()]
            .map(([pubkey, m]) => ({ pubkey, roles: [...m.roles].sort(), count: m.count }))
            .sort((a, b) => b.count - a.count)
    };
}

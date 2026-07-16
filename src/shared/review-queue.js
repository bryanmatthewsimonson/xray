// review-queue.js — KS.6 thin coordination, the read side (Phase 25.4;
// TEAM_CASE §5). Pure assembly over an already-assembled network feed:
//
//   (a) INBOUND REVIEW — followed authors' judgment items whose `a`
//       targets resolve to coordinates YOU authored ("someone engaged
//       with my work"). Coordinates are the durable join; `e`-only
//       references can't be attributed without an event index — a
//       named v1 limit, same as the feed's provenance marker.
//   (b) OPEN REVIEW REQUESTS — `xray/review` labels among follows:
//       a target with a `review-requested` label and no NEWER
//       `review-done` is open. Done-closes-request is matched per
//       target coordinate, not per author — anyone's done closes it
//       (the requester re-opens by re-labeling if they disagree).
//
// No storage, no DOM, no publish — the publish half (stamping labels,
// re-broadcast) lives in the surfaces behind `reviewCoordination`.

import { REVIEW_LABEL_NAMESPACE, REVIEW_LABEL_VALUES } from './metadata/builders.js';

// Feed bucket keys that count as judgments for inbound review.
const JUDGMENT_KEYS = new Set(['assessments', 'links', 'verdicts', 'integrity', 'findings']);

function aCoords(event) {
    return (event.tags || [])
        .filter((t) => Array.isArray(t) && t[0] === 'a' && typeof t[1] === 'string')
        .map((t) => t[1]);
}

/**
 * @param {{items: Array}} feed        assembleNetworkFeed output
 * @param {{myCoords?: Iterable<string>}} opts  coordinates you authored
 *        (event-journal addresses; `<kind>:<pubkey>:<d>`)
 * @returns {{inbound: Array, openRequests: Array<{targetCoord: string,
 *   requestedBy: string, requestedAt: number, url: string|null}>}}
 */
export function assembleReviewQueue(feed, { myCoords = [] } = {}) {
    const mine = new Set(myCoords);
    const items = (feed && Array.isArray(feed.items)) ? feed.items : [];

    const inbound = [];
    // Per target coordinate: newest requested row + newest done row.
    const requests = new Map();

    for (const item of items) {
        if (item.bucket !== 'followed') continue;

        if (JUDGMENT_KEYS.has(item.key) && mine.size > 0) {
            if (aCoords(item.event).some((c) => mine.has(c))) inbound.push(item);
        }

        if (item.key === 'labels'
            && item.parsed
            && item.parsed.namespace === REVIEW_LABEL_NAMESPACE) {
            const values = Array.isArray(item.parsed.values) ? item.parsed.values : [];
            const value = REVIEW_LABEL_VALUES.find((v) => values.includes(v));
            const target = aCoords(item.event)[0] || item.parsed.target || null;
            if (!value || !target) continue;
            const cur = requests.get(target) || { requested: null, done: null };
            const slot = value === 'review-requested' ? 'requested' : 'done';
            const at = item.event.created_at || 0;
            const rTag = (item.event.tags || []).find((t) => Array.isArray(t) && t[0] === 'r');
            if (!cur[slot] || at > cur[slot].at) {
                cur[slot] = { at, by: item.author, url: (rTag && rTag[1]) || null };
            }
            requests.set(target, cur);
        }
    }

    const openRequests = [];
    for (const [targetCoord, { requested, done }] of requests) {
        if (!requested) continue;
        if (done && done.at >= requested.at) continue;   // closed
        openRequests.push({
            targetCoord,
            requestedBy: requested.by,
            requestedAt: requested.at,
            url: requested.url
        });
    }
    openRequests.sort((a, b) => b.requestedAt - a.requestedAt);

    return { inbound, openRequests };
}

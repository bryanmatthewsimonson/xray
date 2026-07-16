// incorporation.js — the KS.5 incorporation queue (Phase 25.3;
// KNOWLEDGE_SHARING §6, NETWORK_CLIENT_DESIGN §5).
//
// Followed artifacts arrive as PROPOSALS, not facts — the same
// human-in-the-loop seam the LLM Suggest flow uses. Accepting is a
// per-artifact review; declining persists (a declined coordinate never
// re-surfaces); rendering the feed never writes anything — this module
// is the only door from the network into local models.
//
// Accept dispatch (25.0 recorded decision №1):
//   - claims  → ClaimModel.create with suggested_by 'nostr:<author>'
//               (they are CONTENT; local entity refs stay empty — the
//               adopt flow, not bulk accept, wires entities);
//   - links   → EvidenceLinker.create, same provenance;
//   - assessments / verdicts → the read-only `incorporated_artifacts`
//               store, NEVER the native models — foreign judgments in
//               `claim_assessments`/`adjudicated_verdicts` would
//               pollute "my judgments" rollups, exports, and publish
//               inventories. They render side-by-side, never averaged.
//
// Every accept ALSO records into `incorporated_artifacts` (claims and
// links store their local record id) so the queue can hide what's
// already in. Unfollowing keeps everything incorporated (TC §10.4).
// Publish selectors exclude 'nostr:'-suggested records — you never
// republish someone else's work as yours (guard-tested in the claim
// and link publish paths).

import { Storage } from './storage.js';
import { ClaimModel } from './claim-model.js';
import { EvidenceLinker } from './evidence-linker.js';

export const INCORPORATED_KEY = 'incorporated_artifacts';
export const DISMISSALS_KEY = 'incorporation_dismissals';

// Proposal classes, pinned by test. Maps 1:1 onto the feed bucket
// keys that may be incorporated — articles/labels/accounts/briefs are
// read-only context, not incorporable artifacts (articles reconstruct
// transiently; persisting them on accept is the KS §6 v1 non-goal).
export const PROPOSAL_CLASSES = Object.freeze(['claim', 'link', 'assessment', 'verdict']);

const CLASS_BY_FEED_KEY = Object.freeze({
    claims: 'claim',
    links: 'link',
    assessments: 'assessment',
    verdicts: 'verdict'
});

/** The stable identity of a proposal: coordinate, else event id. */
export function proposalRef(item) {
    return item.coord || (item.event && item.event.id) || null;
}

export async function loadDismissals() {
    const d = await Storage.get(DISMISSALS_KEY, {});
    return (d && typeof d === 'object') ? d : {};
}

export async function loadIncorporated() {
    const d = await Storage.get(INCORPORATED_KEY, {});
    return (d && typeof d === 'object') ? d : {};
}

/**
 * Pure: turn an assembled network feed into the review queue.
 * Only FOLLOWED authors' incorporable kinds become proposals — self
 * items are yours already, and unfollowed items never reach the item
 * list (network-feed collapses them). Dismissed and already-
 * incorporated refs are hidden. Grouped per author with counts so a
 * flooding followee is one collapsed group with a bulk decline
 * (TC §3.2).
 *
 * @returns {{proposals: Array, byAuthor: Array<{author: string, count: number, proposals: Array}>}}
 */
export function extractProposals(feed, { dismissals = {}, incorporated = {} } = {}) {
    const proposals = [];
    for (const item of (feed && Array.isArray(feed.items) ? feed.items : [])) {
        if (item.bucket !== 'followed') continue;
        const cls = CLASS_BY_FEED_KEY[item.key];
        if (!cls) continue;
        const ref = proposalRef(item);
        if (!ref || dismissals[ref] || incorporated[ref]) continue;
        proposals.push({
            class: cls,
            ref,
            coord: item.coord || null,
            eventId: item.event.id || null,
            author: item.author,
            parsed: item.parsed,
            event: item.event
        });
    }
    const byAuthorMap = new Map();
    for (const p of proposals) {
        if (!byAuthorMap.has(p.author)) byAuthorMap.set(p.author, []);
        byAuthorMap.get(p.author).push(p);
    }
    return {
        proposals,
        byAuthor: [...byAuthorMap.entries()]
            .map(([author, list]) => ({ author, count: list.length, proposals: list }))
            .sort((a, b) => b.count - a.count)
    };
}

async function recordIncorporated(proposal, extra = {}) {
    const all = await loadIncorporated();
    all[proposal.ref] = {
        class: proposal.class,
        coord: proposal.coord,
        eventId: proposal.eventId,
        author: proposal.author,
        incorporatedAt: Math.floor(Date.now() / 1000),
        // Judgment classes keep the parsed payload here — this IS
        // their store. Content classes keep the local record pointer.
        ...extra
    };
    await Storage.set(INCORPORATED_KEY, all);
    return all[proposal.ref];
}

/**
 * Accept one proposal. Returns
 * `{status: 'incorporated'|'failed', class, localId?, record?, error?}`.
 */
export async function acceptProposal(proposal) {
    if (!proposal || !PROPOSAL_CLASSES.includes(proposal.class) || !proposal.ref) {
        return { status: 'failed', error: new Error('invalid proposal') };
    }
    const provenance = `nostr:${proposal.author}`;
    try {
        if (proposal.class === 'claim') {
            const p = proposal.parsed || {};
            const claim = await ClaimModel.create({
                text: p.text,
                source_url: p.url,          // the FOREIGN article the claim was drawn from
                about: [],                  // local entity wiring is the adopt flow's job
                source: p.source && !/^entity_/.test(p.source) ? p.source : null,
                quote: p.quote || null,
                article_hash: p.articleHash || null,
                suggested_by: provenance
            });
            await recordIncorporated(proposal, { localId: claim.id });
            return { status: 'incorporated', class: 'claim', localId: claim.id };
        }
        if (proposal.class === 'link') {
            const p = proposal.parsed || {};
            if (!p.source || !p.source.coord || !p.target || !p.target.coord) {
                return { status: 'failed', error: new Error('link event lacks both endpoint coordinates') };
            }
            const link = await EvidenceLinker.create({
                source_claim_id: p.source.coord,
                target_claim_id: p.target.coord,
                relationship: p.relationship,
                note: p.note || '',
                suggested_by: provenance
            });
            await recordIncorporated(proposal, { localId: link.id });
            return { status: 'incorporated', class: 'link', localId: link.id };
        }
        // Judgment classes: the dedicated read-only store, never the
        // native models (25.0 decision №1).
        const record = await recordIncorporated(proposal, { parsed: proposal.parsed || null });
        return { status: 'incorporated', class: proposal.class, record };
    } catch (err) {
        return { status: 'failed', class: proposal.class, error: err };
    }
}

/** Decline one proposal — persisted; it never re-surfaces. */
export async function declineProposal(proposal) {
    const ref = proposal && proposal.ref;
    if (!ref) return false;
    const all = await loadDismissals();
    all[ref] = { dismissedAt: Math.floor(Date.now() / 1000), class: proposal.class || null };
    await Storage.set(DISMISSALS_KEY, all);
    return true;
}

/** Bulk decline — one flooding followee, one click (TC §3.2). */
export async function declineAll(proposals) {
    const all = await loadDismissals();
    const now = Math.floor(Date.now() / 1000);
    let n = 0;
    for (const p of (proposals || [])) {
        if (!p || !p.ref || all[p.ref]) continue;
        all[p.ref] = { dismissedAt: now, class: p.class || null };
        n++;
    }
    if (n > 0) await Storage.set(DISMISSALS_KEY, all);
    return n;
}

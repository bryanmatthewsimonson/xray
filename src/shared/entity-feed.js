// Entity network feed — Knowledge Sharing KS.4 (the read layer of the
// follow/incorporation engine; docs/KNOWLEDGE_SHARING_DESIGN.md §5).
//
// Pure helpers: filters out, verified relay events in (signature
// verification already happened upstream in queryRelays — KS.1),
// grouped parsed rows back. No storage, no DOM. The side panel's
// "Network activity" section is the consumer; the KS.5 incorporation
// queue reuses the same assembly.
//
// Two hops:
//   hop 1  {kinds: FEED_HOP1_KINDS, '#p': equivalencePubkeys}
//          — everything that references the entity's equivalence set
//            (articles tag entity + account pubkeys; claims tag entity
//            pubkeys; 32126 accounts tag account + linked-entity
//            pubkeys; forensic/integrity findings tag subjects).
//   hop 2  {kinds: FEED_HOP2_KINDS, '#a': hop-1 claim coordinates}
//          — judgments on the discovered claims. Verdicts (30063) are
//            reachable ONLY this way: they deliberately carry no `p`
//            (they attach to the proposition, never the person), so
//            feed coverage of verdicts is two-hop by design — a named
//            v1 limit (design doc §12.2).

import { dedupeReplaceable } from './nostr-events.js';
import { parseClaimEvent } from './claim-model.js';
import { parseAssessmentEvent } from './assessment-model.js';
import { parseRelationshipEvent } from './evidence-linker.js';
import { parseBehavioralFindingEvent } from './forensic-model.js';
import { parseAdjudicatedVerdictEvent, parseIntegrityFindingEvent } from './truth-builders.js';

export const FEED_HOP1_KINDS = [30023, 30040, 32126, 30054, 30062, 30064, 1985];
export const FEED_HOP2_KINDS = [30054, 30055, 30063, 1985];

// p-tag roles that never reference an entity: authorship/identity
// plumbing. Everything else (about / subject / linked-entity / tagger
// contexts on 30023) is treated as an entity reference for
// adopt-on-sight candidate discovery.
const NON_ENTITY_P_ROLES = new Set(['author', 'commenter', 'account', 'auditor']);

/** Hop-1 relay filters for an equivalence pubkey set. */
export function buildFeedFilters(pubkeys, { limit = 300 } = {}) {
    const pks = [...new Set((pubkeys || []).filter(Boolean))];
    if (pks.length === 0) return [];
    return [{ kinds: [...FEED_HOP1_KINDS], '#p': pks, limit }];
}

/** Addressable coordinates of the kind-30040 claims in an event set. */
export function claimCoords(events, { cap = 50 } = {}) {
    const coords = [];
    const claims = (Array.isArray(events) ? events : []).filter((e) => e && e.kind === 30040);
    for (const ev of dedupeReplaceable(claims)) {
        const d = ((ev.tags || []).find((t) => Array.isArray(t) && t[0] === 'd') || [])[1];
        if (!d || !ev.pubkey) continue;
        const coord = `30040:${ev.pubkey}:${d}`;
        if (!coords.includes(coord)) coords.push(coord);
        if (coords.length >= cap) break;
    }
    return coords;
}

/** Hop-2 judgment filter over claim coordinates, or null when empty. */
export function buildJudgmentFilter(coords, { limit = 200 } = {}) {
    const cs = [...new Set((coords || []).filter(Boolean))];
    if (cs.length === 0) return null;
    return { kinds: [...FEED_HOP2_KINDS], '#a': cs, limit };
}

function firstTag(event, name) {
    const t = (event.tags || []).find((x) => Array.isArray(x) && x[0] === name);
    return t ? t[1] : '';
}

/** Minimal 30023 row — metadata only; bodies never render in the panel. */
function parseArticleMeta(event) {
    if (!event || event.kind !== 30023) return null;
    return {
        title:      firstTag(event, 'title') || '(untitled)',
        url:        firstTag(event, 'r'),
        hash:       firstTag(event, 'x') || null,
        created_at: event.created_at || 0
    };
}

/** Minimal 32126 row incl. the KS.2 linked-entity pubkey tag. */
function parseAccountRow(event) {
    if (!event || event.kind !== 32126) return null;
    const key = firstTag(event, 'd');
    if (!key) return null;
    const linkP = (event.tags || []).find((t) => Array.isArray(t) && t[0] === 'p' && t[3] === 'linked-entity');
    return {
        key,
        platform:           firstTag(event, 'account-platform'),
        handle:             firstTag(event, 'account-username'),
        displayName:        firstTag(event, 'account-name'),
        linkedEntityPubkey: linkP ? linkP[1] : null,
        created_at:         event.created_at || 0
    };
}

/** Minimal 1985 row: namespace, label values, target coordinate/URL. */
function parseLabelRow(event) {
    if (!event || event.kind !== 1985) return null;
    const namespace = firstTag(event, 'L');
    const values = (event.tags || []).filter((t) => Array.isArray(t) && t[0] === 'l').map((t) => t[1]);
    if (!namespace && values.length === 0) return null;
    return {
        namespace,
        values,
        target:     firstTag(event, 'a') || firstTag(event, 'r') || null,
        created_at: event.created_at || 0
    };
}

function collectCandidatePubkeys(event, known, out) {
    for (const t of event.tags || []) {
        if (!Array.isArray(t) || t[0] !== 'p' || !t[1] || !/^[0-9a-f]{64}$/i.test(t[1])) continue;
        const role = t[3] || '';
        if (NON_ENTITY_P_ROLES.has(role)) continue;
        // A roleless p on judgment kinds is an author/actor reference,
        // not an entity; only 30023's tagger contexts may be roleless.
        if (!role && event.kind !== 30023) continue;
        const pk = t[1].toLowerCase();
        if (known.has(pk) || pk === (event.pubkey || '').toLowerCase()) continue;
        const cur = out.get(pk) || { roles: new Set(), count: 0 };
        cur.roles.add(role || 'ref');
        cur.count++;
        out.set(pk, cur);
    }
}

/**
 * Assemble the verified hop-1 + hop-2 events into render-ready groups.
 *
 * Latest-per-coordinate dedup runs first; malformed events null-parse
 * and drop. `candidates` are entity-ish pubkeys referenced by the feed
 * that are NOT in the reader's equivalence set — the adopt-on-sight
 * hook (KS.3).
 *
 * @param {Array<object>} hop1Events
 * @param {Array<object>} [hop2Events]
 * @param {{knownPubkeys?: string[]}} [opts]
 * @returns {{articles: Array, accounts: Array, claims: Array,
 *   assessments: Array, links: Array, findings: Array, integrity: Array,
 *   verdicts: Array, labels: Array, authors: Map<string, number>,
 *   candidates: Array<{pubkey: string, roles: string[], count: number}>}}
 */
export function assembleFeed(hop1Events, hop2Events = [], { knownPubkeys = [] } = {}) {
    const known = new Set((knownPubkeys || []).map((pk) => String(pk).toLowerCase()));
    const events = dedupeReplaceable([
        ...(Array.isArray(hop1Events) ? hop1Events : []),
        ...(Array.isArray(hop2Events) ? hop2Events : [])
    ]);

    const feed = {
        articles: [], accounts: [], claims: [], assessments: [], links: [],
        findings: [], integrity: [], verdicts: [], labels: [],
        authors: new Map(), candidates: []
    };
    const candidateMap = new Map();

    for (const ev of events) {
        if (!ev || typeof ev.kind !== 'number' || !ev.pubkey) continue;
        let parsed = null;
        let bucket = null;
        try {
            switch (ev.kind) {
                case 30023: parsed = parseArticleMeta(ev);            bucket = feed.articles;    break;
                case 30040: parsed = parseClaimEvent(ev);             bucket = feed.claims;      break;
                case 32126: parsed = parseAccountRow(ev);             bucket = feed.accounts;    break;
                case 30054: parsed = parseAssessmentEvent(ev);        bucket = feed.assessments; break;
                case 30055: parsed = parseRelationshipEvent(ev);      bucket = feed.links;       break;
                case 30062: parsed = parseBehavioralFindingEvent(ev); bucket = feed.findings;    break;
                case 30063: parsed = parseAdjudicatedVerdictEvent(ev); bucket = feed.verdicts;   break;
                case 30064: parsed = parseIntegrityFindingEvent(ev);  bucket = feed.integrity;   break;
                case 1985:  parsed = parseLabelRow(ev);               bucket = feed.labels;      break;
                default: continue;
            }
        } catch (_) {
            parsed = null;   // a throwing parser counts as malformed
        }
        if (!parsed) continue;

        const d = ((ev.tags || []).find((t) => Array.isArray(t) && t[0] === 'd') || [])[1];
        feed.authors.set(ev.pubkey, (feed.authors.get(ev.pubkey) || 0) + 1);
        bucket.push({ event: ev, parsed, coord: d ? `${ev.kind}:${ev.pubkey}:${d}` : null });
        collectCandidatePubkeys(ev, known, candidateMap);
    }

    feed.candidates = [...candidateMap.entries()]
        .map(([pubkey, m]) => ({ pubkey, roles: [...m.roles].sort(), count: m.count }))
        .sort((a, b) => b.count - a.count);
    return feed;
}

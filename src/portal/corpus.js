// Portal corpus fetch (Phase 12.1, docs/PORTAL_DESIGN.md).
//
// Extension pages have no relay access — every read goes through the
// background pool via `xray:relay:query`. Two query classes:
//
//   Q1 — my content:  { authors: myPubkeys,    kinds: CONTENT_KINDS }
//   Q2 — my entities: { authors: entityPubkeys, kinds: [0] } (chunked;
//        kept a SEPARATE subscription from Q1 — design note, privacy)
//
// Each relay is queried INDIVIDUALLY (relays: [url]) rather than in one
// fan-out: the background's queryRelays dedups by event id before
// responding, so a pooled query can't tell us which relay actually
// holds which event — and "which relays hold it" is the provenance the
// inspector and reconciliation views are built on. Per-relay queries
// cost the same number of REQs and make one slow relay's timeout
// independent of the others.
//
// Backfill: relays cap responses silently (often below our `limit`),
// so each relay pages backward with `until = oldest` — NIP-01 `until`
// is INCLUSIVE, so the boundary second is re-asked-for and a cap that
// landed mid-second can't silently drop its siblings (12.7 review
// fix). Termination is "this page produced no event we hadn't already
// seen", not "empty page", which also makes the tie-heavy case
// converge. Residual edge: a single same-second run longer than the
// relay's own cap can still hide its overflow; accepted.

import { Utils } from '../shared/utils.js';

export const CONTENT_KINDS = [
    30023, // articles
    30040, // claims
    30041, // captured comments
    30054, // assessments
    30055, // claim relationships
    1985,  // assessment label mirrors
    32125, // entity↔article relationships
    32126, // platform accounts
    10002, // NIP-65 relay list (signed by the xray:user sync key)
    30078, // entity-sync blobs (ciphertext; listed, never decrypted)
    30050, 30051, 30052, 30053, 9803, // dormant metadata kinds (flag-gated writers)
    30056, 30057, 30058, 30059, 30060, 30061, // Phase 13 audit kinds (publish lands in 13.8; read always)
    30062, // Phase 14 behavioral findings (docs/CRIMINOLOGY_DESIGN.md)
    30063, 30064 // Phase 15 adjudicated verdicts + integrity findings (docs/TRUTH_ADJUDICATION_DESIGN.md)
];

// Mirrors the background service worker's hardcoded fallback
// (src/background/index.js) — the portal needs the concrete list
// client-side because provenance requires addressing relays one at a
// time, so it can't lean on the worker's internal default.
export const FALLBACK_RELAYS = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.nostr.band'
];

const PAGE_LIMIT = 1000;
const MAX_PAGES_PER_QUERY = 10;
const QUERY_TIMEOUT_MS = 6000;
const ENTITY_AUTHOR_CHUNK = 100;

/** One `xray:relay:query` round-trip. Resolves `{ok,...}`, never rejects. */
function relayQuery(filter, relays, timeoutMs = QUERY_TIMEOUT_MS) {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ type: 'xray:relay:query', relays, filter, timeoutMs }, (resp) => {
                if (chrome.runtime.lastError) {
                    resolve({ ok: false, error: chrome.runtime.lastError.message });
                    return;
                }
                resolve(resp || { ok: false, error: 'No response from service worker' });
            });
        } catch (err) {
            resolve({ ok: false, error: (err && err.message) || String(err) });
        }
    });
}

/**
 * Page one relay backward through one base filter, feeding every event
 * into `collect(event, relayUrl)`. Pagination terminates when a page
 * contains nothing THIS RELAY hasn't already served — per-relay, not
 * global, because relays page concurrently and one relay's coverage
 * must never truncate another's backfill (or its provenance).
 */
async function backfillRelay(relayUrl, baseFilter, collect, onProgress) {
    let until;
    let pages = 0;
    const served = new Set(); // event ids this relay has returned
    for (;;) {
        const filter = { ...baseFilter, limit: PAGE_LIMIT };
        if (until !== undefined) filter.until = until;
        const resp = await relayQuery(filter, [relayUrl]);
        if (!resp.ok) return { ok: false, error: resp.error || 'query failed', pages };
        // The background resolves ok:true even when the WebSocket never
        // connected (queryRelays marks the relay EOSE to avoid blocking
        // the pool) — the per-relay stat carries the truth (12.7).
        const stat = resp.byRelay && resp.byRelay[relayUrl];
        if (stat && stat.failed) {
            return { ok: false, error: stat.error || 'relay unreachable', pages };
        }
        const events = Array.isArray(resp.events) ? resp.events : [];
        const invalid = typeof resp.invalid === 'number' ? resp.invalid : 0;
        pages++;
        if (events.length === 0) {
            // KS.1: a page whose events were ALL dropped by signature
            // verification is not proof the relay is drained — older
            // valid history may sit behind the poisoned window. Flag
            // truncation so the sync cursor never records a clean pass.
            if (invalid > 0) {
                Utils.log('Portal corpus: page fully dropped by verification on', relayUrl, '— marking truncated');
                return { ok: true, pages, truncated: true };
            }
            break;
        }
        let oldest = Infinity;
        let fresh = 0;
        for (const ev of events) {
            if (!ev || !ev.id) continue;
            if (typeof ev.created_at === 'number' && ev.created_at < oldest) oldest = ev.created_at;
            if (!served.has(ev.id)) { served.add(ev.id); fresh++; }
            collect(ev, relayUrl);
        }
        if (typeof onProgress === 'function') onProgress();
        // `until` is inclusive, so the boundary page always re-serves
        // events we already hold — a page with nothing NEW means this
        // relay is drained (or capped inside one second; see header).
        if (fresh === 0) {
            if (invalid > 0) {
                Utils.log('Portal corpus:', invalid, 'event(s) dropped by verification on', relayUrl, 'with nothing fresh — marking truncated');
                return { ok: true, pages, truncated: true };
            }
            break;
        }
        if (!Number.isFinite(oldest)) break;
        if (pages >= MAX_PAGES_PER_QUERY) {
            Utils.log('Portal corpus: page ceiling hit on', relayUrl, '— older events not fetched');
            return { ok: true, pages, truncated: true };
        }
        until = oldest;
    }
    return { ok: true, pages, truncated: false };
}

function chunk(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

/**
 * Fetch the full published corpus across the given relays.
 *
 * @param {object}   opts
 * @param {string[]} opts.pubkeys        the user's resolved author pubkeys
 * @param {string[]} opts.entityPubkeys  entity pubkeys (kind-0 authors)
 * @param {string[]} opts.relays         relay URLs (callers resolve config/fallback)
 * @param {number}   [opts.since]        epoch seconds — incremental refresh window
 *                                       (callers subtract their clock-skew overlap)
 * @param {function} [opts.onProgress]   ({fetched}) per page, for the status line
 * @returns {Promise<{
 *   records: Array<{event: object, relays: string[]}>,
 *   relayErrors: Object<string,string>,
 *   truncated: boolean
 * }>}
 */
export async function fetchCorpus({ pubkeys = [], entityPubkeys = [], relays = [], since, onProgress } = {}) {
    const byId = new Map(); // event id → { event, relays:Set }
    const relayErrors = {};
    let truncated = false;

    const collect = (ev, relayUrl) => {
        const seen = byId.get(ev.id);
        if (seen) { seen.relays.add(relayUrl); return; }
        byId.set(ev.id, { event: ev, relays: new Set([relayUrl]) });
    };
    const tick = () => {
        if (typeof onProgress === 'function') onProgress({ fetched: byId.size });
    };

    const sinceFilter = Number.isFinite(since) && since > 0 ? { since } : {};

    await Promise.all(relays.map(async (url) => {
        if (pubkeys.length > 0) {
            const r = await backfillRelay(url,
                { authors: pubkeys, kinds: CONTENT_KINDS, ...sinceFilter }, collect, tick);
            if (!r.ok) relayErrors[url] = r.error;
            if (r.truncated) truncated = true;
        }
        for (const authors of chunk(entityPubkeys, ENTITY_AUTHOR_CHUNK)) {
            const r = await backfillRelay(url, { authors, kinds: [0], ...sinceFilter }, collect, tick);
            if (!r.ok) relayErrors[url] = relayErrors[url] || r.error;
            if (r.truncated) truncated = true;
        }
    }));

    const records = [...byId.values()].map((r) => ({ event: r.event, relays: [...r.relays] }));
    return { records, relayErrors, truncated };
}

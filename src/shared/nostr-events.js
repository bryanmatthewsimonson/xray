// Shared NIP-01 event-set helpers (Phase 12.1).
//
// `dedupeReplaceable` started life inside the side panel's network-claims
// view (Phase 10.4), keyed everything by `kind:pubkey:(d || id)`, and was
// correct there because its input was kind-30040 only. The portal feeds a
// mixed corpus through it, so this shared version is NIP-01-class-aware:
//
//   - replaceable  (0, 3, 10000–19999)  → latest wins per (kind, pubkey)
//   - addressable  (30000–39999)        → latest wins per (kind, pubkey, d)
//   - regular      (everything else)    → every event kept
//
// For an all-addressable input this is byte-for-byte the side panel's old
// behavior (missing `d` still falls back to the event id, so a malformed
// addressable event never swallows its siblings). Ties on `created_at`
// keep the first-seen event, and output preserves input order — both
// properties the old implementation had and callers may lean on.

/** NIP-01 storage class for a kind: 'replaceable' | 'addressable' | 'regular'. */
export function eventClass(kind) {
    if (kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000)) return 'replaceable';
    if (kind >= 30000 && kind < 40000) return 'addressable';
    return 'regular';
}

/** Dedupe key for an event, or null when the event is regular (keep all). */
export function replaceableKey(ev) {
    if (!ev) return null;
    const cls = eventClass(ev.kind);
    if (cls === 'regular') return null;
    if (cls === 'replaceable') return `${ev.kind}:${ev.pubkey}`;
    const d = ((ev.tags || []).find((t) => t[0] === 'd') || [])[1] || ev.id;
    return `${ev.kind}:${ev.pubkey}:${d}`;
}

/**
 * Collapse replaceable/addressable events to their latest version,
 * preserving input order and keeping every regular event.
 *
 * @param {Array<object>} events  raw NOSTR events
 * @returns {Array<object>}
 */
export function dedupeReplaceable(events) {
    const list = Array.isArray(events) ? events : [];
    const best = new Map(); // key → winning event
    for (const ev of list) {
        if (!ev) continue;
        const key = replaceableKey(ev);
        if (key === null) continue;
        const seen = best.get(key);
        if (!seen || (ev.created_at || 0) > (seen.created_at || 0)) best.set(key, ev);
    }
    const out = [];
    const emitted = new Set();
    for (const ev of list) {
        if (!ev) continue;
        const key = replaceableKey(ev);
        if (key === null) { out.push(ev); continue; }
        if (emitted.has(key)) continue;
        if (best.get(key) === ev) { out.push(ev); emitted.add(key); }
    }
    return out;
}

// ---------------------------------------------------------------------
// Verify-on-ingest (Knowledge Sharing KS.1).
//
// Relay-supplied events are untrusted input: `queryRelays` accepts any
// frame with an `.id`, and until KS.1 nothing in any read path called
// `Crypto.verifySignature`. Every event handed back to a caller must
// pass BIP-340 verification (id = hash of the serialized event, and
// the Schnorr signature binds that id to its pubkey).
//
// A module-level cache of already-verified event ids keeps repeat
// syncs cheap (the portal re-fetches overlapping pages on every
// refresh). A cache hit still recomputes the id hash — an event whose
// content does not hash to its claimed id is dropped even when that
// id verified before — so the cache only ever skips the expensive
// Schnorr math, never the content-integrity check.

import { Crypto } from './crypto.js';

const VERIFIED_IDS_MAX = 20000;
const _verifiedIds = new Set(); // insertion-ordered → cheap FIFO eviction

/**
 * Partition events into signature-valid and dropped.
 *
 * Verification is chunked with an event-loop yield between chunks so
 * a large portal sync doesn't starve the service worker.
 *
 * @param {Array<object>} events
 * @param {{chunkSize?: number}} [opts]
 * @returns {Promise<{valid: Array<object>, dropped: number}>}
 */
export async function verifyEvents(events, { chunkSize = 25 } = {}) {
    const list = Array.isArray(events) ? events : [];
    const valid = [];
    let dropped = 0;

    for (let i = 0; i < list.length; i += chunkSize) {
        const chunk = list.slice(i, i + chunkSize);
        for (const ev of chunk) {
            if (!ev
                || typeof ev.id !== 'string'
                || typeof ev.pubkey !== 'string'
                || typeof ev.sig !== 'string') {
                dropped++;
                continue;
            }
            let ok = false;
            try {
                if (_verifiedIds.has(ev.id)) {
                    // Cache hit: skip Schnorr, keep the hash check.
                    ok = (await Crypto.getEventHash(ev)) === ev.id;
                } else {
                    ok = await Crypto.verifySignature(ev);
                    if (ok) {
                        _verifiedIds.add(ev.id);
                        if (_verifiedIds.size > VERIFIED_IDS_MAX) {
                            _verifiedIds.delete(_verifiedIds.values().next().value);
                        }
                    }
                }
            } catch (_) {
                ok = false;
            }
            if (ok) valid.push(ev);
            else dropped++;
        }
        if (i + chunkSize < list.length) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }
    return { valid, dropped };
}

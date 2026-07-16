// Creator-binding wire — Phase 24.2 (docs/ENTITY_IDENTITY_DESIGN.md §4).
//
// Two artifacts bind entity keys to their creator's primary identity:
//
//   1. the kind-30069 OwnedKeys MANIFEST — a replaceable event signed
//      by the primary listing every owned entity pubkey. Revocation is
//      republish-without-the-key; rotation is republish-under-the-new-
//      primary. Works with ordinary author filters.
//   2. a NIP-26-format `delegation` tag on entity-signed events — the
//      strongest SELF-CONTAINED proof the primary authorized this key.
//      X-Ray mints and verifies these itself; no relay support is
//      assumed (the ecosystem objections to NIP-26 are about others
//      having to implement it — X-Ray is its own primary consumer).
//
// Verification rule: creator-bound = manifest-listed AND token-valid;
// either alone is "partial"; neither is unbound. Pure module — no
// chrome, no DOM; signing stays with the callers.

import { Crypto } from './crypto.js';

export const OWNED_KEYS_KIND = 30069;
export const OWNED_KEYS_D = 'xray-owned-keys';

function nowSeconds() { return Math.floor(Date.now() / 1000); }

// ------------------------------------------------------------------
// The OwnedKeys manifest (kind 30069)
// ------------------------------------------------------------------

/**
 * Build the unsigned manifest. `entities` = [{pubkey, id, name}] for
 * every OWNED entity (foreign/reference entities have no key of ours
 * and never appear). Deterministic order (by pubkey) so republish
 * comparisons are stable.
 */
export function buildOwnedKeysManifest({ entities = [], createdAt = nowSeconds() } = {}) {
    const rows = [...entities]
        .filter((e) => e && e.pubkey)
        .sort((a, b) => (a.pubkey < b.pubkey ? -1 : a.pubkey > b.pubkey ? 1 : 0));
    const tags = [
        ['d', OWNED_KEYS_D],
        ['client', 'xray']
    ];
    for (const e of rows) {
        tags.push(['p', e.pubkey, '', 'owned']);
        tags.push(['owned', e.pubkey, String(e.id || ''), String(e.name || '')]);
    }
    return { kind: OWNED_KEYS_KIND, created_at: createdAt, tags, content: '' };
}

/** Parse a (signature-verified) 30069 back to its owned-key rows. */
export function parseOwnedKeysManifest(event) {
    if (!event || event.kind !== OWNED_KEYS_KIND) return null;
    const owned = (event.tags || [])
        .filter((t) => t[0] === 'owned' && t[1])
        .map((t) => ({ pubkey: t[1], id: t[2] || null, name: t[3] || null }));
    return {
        creatorPubkey: event.pubkey || null,
        createdAt: event.created_at || 0,
        owned,
        ownedPubkeys: new Set(owned.map((o) => o.pubkey))
    };
}

// ------------------------------------------------------------------
// NIP-26 delegation tokens
// ------------------------------------------------------------------

/**
 * The NIP-26 conditions string for X-Ray entity keys: the kinds
 * entities actually sign, plus a bounded created_at window.
 * Deterministic field order (kinds sorted, then window).
 */
export function entityDelegationConditions({ kinds = [0, 30067], from, until } = {}) {
    const parts = [...kinds].sort((a, b) => a - b).map((k) => `kind=${k}`);
    if (from != null) parts.push(`created_at>${from}`);
    if (until != null) parts.push(`created_at<${until}`);
    return parts.join('&');
}

/** The exact NIP-26 string the token signs. */
export function delegationString(delegateePubkey, conditions) {
    return `nostr:delegation:${delegateePubkey}:${conditions}`;
}

/**
 * Mint a NIP-26 delegation tag: the primary signs
 * sha256("nostr:delegation:<delegatee>:<conditions>").
 * Returns ['delegation', <delegator pubkey>, <conditions>, <token>].
 */
export async function mintDelegationTag(primaryPrivHex, delegateePubkey, conditions) {
    const delegatorPubkey = Crypto.getPublicKey(primaryPrivHex);
    const hash = await Crypto.sha256(delegationString(delegateePubkey, conditions));
    const token = await Crypto.schnorrSignHash(hash, primaryPrivHex);
    return ['delegation', delegatorPubkey, conditions, token];
}

/**
 * Verify a delegation tag against the event that carries it:
 *   - the token is a valid BIP-340 signature by tag[1] (the delegator)
 *     over the NIP-26 string recomputed from the EVENT's pubkey (the
 *     delegatee) + tag[2] (the conditions), and
 *   - the event actually satisfies every condition (kind whitelist,
 *     created_at window).
 * Fails closed on anything malformed.
 */
export async function verifyDelegationTag(event, { expectedDelegator = null } = {}) {
    try {
        const tag = (event.tags || []).find((t) => t[0] === 'delegation');
        if (!tag || !tag[1] || !tag[3]) return { ok: false, reason: 'no delegation tag' };
        const [, delegator, conditions = '', token] = tag;
        if (expectedDelegator && delegator !== expectedDelegator) {
            return { ok: false, reason: 'unexpected delegator' };
        }

        // Conditions must hold for THIS event.
        const kinds = [];
        for (const part of conditions.split('&').filter(Boolean)) {
            let m;
            if ((m = /^kind=(\d+)$/.exec(part))) {
                kinds.push(parseInt(m[1], 10));
            } else if ((m = /^created_at>(\d+)$/.exec(part))) {
                if (!(event.created_at > parseInt(m[1], 10))) return { ok: false, reason: 'created_at below window' };
            } else if ((m = /^created_at<(\d+)$/.exec(part))) {
                if (!(event.created_at < parseInt(m[1], 10))) return { ok: false, reason: 'created_at above window' };
            } else {
                return { ok: false, reason: `unknown condition: ${part}` };
            }
        }
        if (kinds.length && !kinds.includes(event.kind)) {
            return { ok: false, reason: 'kind outside delegation' };
        }

        const hash = await Crypto.sha256(delegationString(event.pubkey, conditions));
        const valid = await Crypto.schnorrVerifyHash(hash, delegator, token);
        return valid ? { ok: true, delegator } : { ok: false, reason: 'bad token signature' };
    } catch (_) {
        return { ok: false, reason: 'malformed' };
    }
}

// ------------------------------------------------------------------
// Creator-binding classification (portal ingest)
// ------------------------------------------------------------------

/**
 * Classify entity pubkeys against a creator's manifest + their events'
 * delegation tags. `records` are relay records ({event}) ALREADY
 * signature-verified on ingest (the KS posture). Returns
 * Map<entityPubkey, 'full'|'partial'> — absent means unbound.
 *
 * full    = manifest-listed AND at least one entity-signed event
 *           carries a valid token from the creator
 * partial = exactly one of the two
 */
export async function computeCreatorBinding(records, creatorPubkey) {
    // Latest manifest by the creator wins (replaceable semantics).
    let manifest = null;
    for (const r of records || []) {
        const ev = r && r.event;
        if (!ev || ev.kind !== OWNED_KEYS_KIND || ev.pubkey !== creatorPubkey) continue;
        const dTag = ((ev.tags || []).find((t) => t[0] === 'd') || [])[1];
        if (dTag !== OWNED_KEYS_D) continue;
        if (!manifest || (ev.created_at || 0) > (manifest.createdAt || 0)) {
            manifest = parseOwnedKeysManifest(ev);
        }
    }
    const listed = manifest ? manifest.ownedPubkeys : new Set();

    // Token validity per entity pubkey, over their own signed events.
    const tokenOk = new Set();
    for (const r of records || []) {
        const ev = r && r.event;
        if (!ev || !ev.pubkey || tokenOk.has(ev.pubkey)) continue;
        if (!(ev.tags || []).some((t) => t[0] === 'delegation')) continue;
        const res = await verifyDelegationTag(ev, { expectedDelegator: creatorPubkey });
        if (res.ok) tokenOk.add(ev.pubkey);
    }

    const out = new Map();
    for (const pk of new Set([...listed, ...tokenOk])) {
        const both = listed.has(pk) && tokenOk.has(pk);
        out.set(pk, both ? 'full' : 'partial');
    }
    return out;
}

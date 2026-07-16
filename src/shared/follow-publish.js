// follow-publish.js — the kind-3 follow-list mirror's selection and
// clobber protection (Phase 25.6; amended KNOWLEDGE_SHARING §9,
// NETWORK_CLIENT_DESIGN §6). The phase's only wire change: an
// existing STANDARD kind (NIP-02) gains an opt-in publisher behind
// the default-off `followListPublishing` flag.
//
// Two invariants, both guard-tested:
//   1. **Global scope only.** Case- and entity-anchored follow sets
//      NEVER publish — the TC §2.2 watched-workspace closure holds by
//      construction for casework. selectFollowsToPublish is the only
//      selector and it reads exactly the 'global' anchor.
//   2. **Merge, never clobber.** Kind 3 is replaceable, and the user
//      may maintain a contact list in ANOTHER client under the same
//      nsec — publishing blindly would wipe it. Every publish first
//      fetches the current remote kind 3 and UNIONs unknown remote
//      `p` entries into the publish set; the caller shows the diff
//      before signing, and must warn loudly when the fetch failed on
//      every relay.

import { FollowModel } from './follow-model.js';

const HEX64 = /^[0-9a-f]{64}$/;

/** The publishable set — the GLOBAL anchor, nothing else. */
export async function selectFollowsToPublish() {
    return FollowModel.getSet({ scope: 'global' });
}

/**
 * Read-side inverse of buildFollowListEvent — the standard NIP-02
 * shape. Returns `[{pubkey, relayHint, petname}]` (deduped, first
 * occurrence wins) or [] for a non-kind-3 event.
 */
export function parseFollowListEvent(event) {
    if (!event || event.kind !== 3) return [];
    const out = [];
    const seen = new Set();
    for (const t of event.tags || []) {
        if (!Array.isArray(t) || t[0] !== 'p' || typeof t[1] !== 'string') continue;
        const pk = t[1].toLowerCase();
        if (!HEX64.test(pk) || seen.has(pk)) continue;
        seen.add(pk);
        out.push({ pubkey: pk, relayHint: t[2] || '', petname: t[3] || '' });
    }
    return out;
}

/**
 * Clobber protection: union remote-only `p` entries into the local
 * publish set. Remote entries keep their relay hint and petname (the
 * other client's data is preserved verbatim on re-publish).
 *
 * @param {Array} localEntries      follow-model entries
 * @param {object|null} remoteEvent the newest remote kind 3, or null
 * @returns {{entries: Array, remoteOnly: Array<string>, localCount: number}}
 *          `entries` is publish-ready (local first, then remote-only);
 *          `remoteOnly` lists the preserved foreign pubkeys for the
 *          caller's diff display.
 */
export function mergeWithRemote(localEntries, remoteEvent) {
    const local = (localEntries || []).filter((e) => e && HEX64.test(String(e.pubkey || '')));
    const have = new Set(local.map((e) => e.pubkey.toLowerCase()));
    const remoteOnly = [];
    const entries = [...local];
    for (const r of parseFollowListEvent(remoteEvent)) {
        if (have.has(r.pubkey)) continue;
        have.add(r.pubkey);
        remoteOnly.push(r.pubkey);
        entries.push({
            pubkey: r.pubkey,
            relayHints: r.relayHint ? [r.relayHint] : [],
            // A petname the OTHER client published stays published —
            // dropping it would clobber their data; it is already
            // public, so re-emitting it discloses nothing new.
            label: r.petname || undefined,
            remoteOnly: true
        });
    }
    return { entries, remoteOnly, localCount: local.length };
}

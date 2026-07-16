// follow-model.js — the follow-set registry (Knowledge Sharing KS.5,
// engine half; Phase 25.1).
//
// One storage shape for every follow anchor, per KS §5 (amended
// 2026-07-16): a registry under the `follow_sets` key mapping an
// anchor key — 'case:<id>' | 'entity:<id>' | 'global' — to an array
// of entries `{pubkey, label?, addedAt, relayHints[]}`. The 'global'
// anchor carries person-level follows for the Network feed; 'case'
// and 'entity' anchors are TEAM_CASE TC.2 / entity-watcher instances
// of the same registry.
//
// The registry is LOCAL-PRIMARY and workspace content (cleared by
// fresh-workspace reset — identity-profiles.js WORKSPACE_CLEAR_KEYS).
// Nothing here publishes: the opt-in kind-3 mirror (Phase 25.6,
// amended KS §9) projects the global scope only and lives in its own
// module. Case- and entity-anchored sets never touch a relay, so
// team/interest composition disclosure stays closed by construction
// (TEAM_CASE §2.2).
//
// Relay hints ride each entry (harvested from the followee's NIP-65
// kind 10002 via entity-sync's pullRelayListFor) so feed queries can
// widen to where the followee actually publishes (KS.7 / Phase 25.5).

import { Storage } from './storage.js';
import { Crypto } from './crypto.js';

const KEY = 'follow_sets';

// Anchor scopes, pinned by test. 'global' was added by the 2026-07-16
// KS §5 amendment for person-level Network follows.
export const FOLLOW_SCOPES = Object.freeze(['case', 'entity', 'global']);

// Defensive bound on stored NIP-65 hints per entry — feed widening
// unions across follows, so a few good hints beat a long stale list.
export const MAX_RELAY_HINTS = 4;

const HEX64 = /^[0-9a-f]{64}$/;
const MAX_LABEL = 60;

/**
 * Canonical registry key for an anchor. 'case' and 'entity' scopes
 * require the entityId (a case is an entity record); 'global' takes
 * none. Throws on anything else — anchors are code-supplied, never
 * free text.
 */
export function anchorKey(anchor) {
    const scope = anchor && anchor.scope;
    if (!FOLLOW_SCOPES.includes(scope)) {
        throw new Error(`follow-model: unknown scope "${scope}"`);
    }
    if (scope === 'global') return 'global';
    const id = anchor.entityId;
    if (typeof id !== 'string' || !id.trim()) {
        throw new Error(`follow-model: ${scope} anchor requires entityId`);
    }
    return `${scope}:${id.trim()}`;
}

/**
 * Accepts a 64-hex pubkey (any case) or an npub1… string; returns
 * lowercase hex, or null when the input decodes to nothing valid.
 */
export function normalizeFollowPubkey(input) {
    const s = String(input || '').trim();
    if (!s) return null;
    if (HEX64.test(s.toLowerCase())) return s.toLowerCase();
    if (s.toLowerCase().startsWith('npub1')) {
        const hex = Crypto.npubToHex(s.toLowerCase());
        return (hex && HEX64.test(hex)) ? hex : null;
    }
    return null;
}

function cleanLabel(label) {
    if (label === undefined || label === null) return undefined;
    const trimmed = String(label).trim();
    if (!trimmed) return undefined;
    return trimmed.slice(0, MAX_LABEL);
}

function cleanHints(hints) {
    if (!Array.isArray(hints)) return [];
    const out = [];
    for (const h of hints) {
        if (typeof h === 'string' && /^wss?:\/\//i.test(h) && !out.includes(h)) {
            out.push(h);
            if (out.length >= MAX_RELAY_HINTS) break;
        }
    }
    return out;
}

async function loadRegistry() {
    const reg = await Storage.get(KEY, {});
    return (reg && typeof reg === 'object' && !Array.isArray(reg)) ? reg : {};
}

async function saveRegistry(reg) {
    await Storage.set(KEY, reg);
}

export const FollowModel = {
    anchorKey,

    /** Entries for one anchor, in insertion order. */
    async getSet(anchor) {
        const reg = await loadRegistry();
        const list = reg[anchorKey(anchor)];
        return Array.isArray(list) ? list.slice() : [];
    },

    /** Every anchor that has at least one entry. */
    async listAnchors() {
        const reg = await loadRegistry();
        const out = [];
        for (const [key, list] of Object.entries(reg)) {
            if (!Array.isArray(list) || list.length === 0) continue;
            const sep = key.indexOf(':');
            out.push(sep === -1
                ? { key, scope: key, entityId: null, count: list.length }
                : { key, scope: key.slice(0, sep), entityId: key.slice(sep + 1), count: list.length });
        }
        return out;
    },

    /**
     * Add a follow. Idempotent on pubkey: re-adding never duplicates
     * and keeps the original addedAt; a provided label or hints
     * refresh the stored ones. Returns the stored entry.
     */
    async addFollow(anchor, { pubkey, label, relayHints } = {}) {
        const hex = normalizeFollowPubkey(pubkey);
        if (!hex) throw new Error('follow-model: invalid pubkey/npub');
        const key = anchorKey(anchor);
        const reg = await loadRegistry();
        const list = Array.isArray(reg[key]) ? reg[key] : [];
        let entry = list.find((e) => e && e.pubkey === hex);
        if (entry) {
            const newLabel = cleanLabel(label);
            if (newLabel !== undefined) entry.label = newLabel;
            if (relayHints !== undefined) entry.relayHints = cleanHints(relayHints);
        } else {
            entry = {
                pubkey: hex,
                addedAt: Date.now(),
                relayHints: cleanHints(relayHints)
            };
            const newLabel = cleanLabel(label);
            if (newLabel !== undefined) entry.label = newLabel;
            list.push(entry);
        }
        reg[key] = list;
        await saveRegistry(reg);
        return { ...entry };
    },

    /**
     * Remove a follow. Deliberately does NOT touch anything the
     * follow brought in — unfollowing keeps incorporated artifacts
     * (TEAM_CASE §10.4); removing them would be its own memory-hole.
     */
    async removeFollow(anchor, pubkey) {
        const hex = normalizeFollowPubkey(pubkey);
        if (!hex) return false;
        const key = anchorKey(anchor);
        const reg = await loadRegistry();
        const list = Array.isArray(reg[key]) ? reg[key] : [];
        const next = list.filter((e) => !(e && e.pubkey === hex));
        if (next.length === list.length) return false;
        if (next.length === 0) delete reg[key];
        else reg[key] = next;
        await saveRegistry(reg);
        return true;
    },

    /** Update the local label on an existing entry. */
    async relabel(anchor, pubkey, label) {
        const hex = normalizeFollowPubkey(pubkey);
        if (!hex) return false;
        const key = anchorKey(anchor);
        const reg = await loadRegistry();
        const entry = (reg[key] || []).find((e) => e && e.pubkey === hex);
        if (!entry) return false;
        const cleaned = cleanLabel(label);
        if (cleaned === undefined) delete entry.label;
        else entry.label = cleaned;
        await saveRegistry(reg);
        return true;
    },

    /** Just the pubkeys for one anchor (feed `authors` filters). */
    async followedPubkeys(anchor) {
        const set = await this.getSet(anchor);
        return set.map((e) => e.pubkey);
    },

    async isFollowed(anchor, pubkey) {
        const hex = normalizeFollowPubkey(pubkey);
        if (!hex) return false;
        const set = await this.getSet(anchor);
        return set.some((e) => e.pubkey === hex);
    },

    /**
     * Fetch the followee's NIP-65 relay list and store the hints on
     * their entry (capped at MAX_RELAY_HINTS). Best-effort: returns
     * the stored hints, or [] when nothing was found / the entry
     * doesn't exist. `pull` is injectable for tests and defaults to
     * entity-sync's pullRelayListFor at the call site — kept as a
     * parameter so this module doesn't drag the relay client into
     * every consumer.
     */
    async harvestRelayHints(anchor, pubkey, { relays, timeoutMs, pull } = {}) {
        const hex = normalizeFollowPubkey(pubkey);
        if (!hex || typeof pull !== 'function') return [];
        let found;
        try {
            found = await pull({ pubkey: hex, relays, timeoutMs });
        } catch (_) {
            return [];
        }
        if (!found || !found.found || !Array.isArray(found.relays)) return [];
        const hints = cleanHints(found.relays);
        const key = anchorKey(anchor);
        const reg = await loadRegistry();
        const entry = (reg[key] || []).find((e) => e && e.pubkey === hex);
        if (!entry) return hints;
        entry.relayHints = hints;
        await saveRegistry(reg);
        return hints;
    }
};

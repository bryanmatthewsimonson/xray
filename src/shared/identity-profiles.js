// Identity profiles + workspace reset — the single home for "who am I"
// (Options ▸ Signing ▸ Identity) and for starting a clean workspace
// (Options ▸ Advanced ▸ Workspace).
//
// Design (see JOURNAL 2026-07-03):
//
//   - `local_primary_identity` stays the ONE live slot every signing
//     path already reads (signer.js, content script, options). Profiles
//     are a registry of SAVED identities keyed by pubkey; "active" is
//     DERIVED by matching the live slot against the registry, so there
//     is no second source of truth to drift.
//   - Switching identity does NOT touch content records. Publish stamps
//     live on the records themselves (claims' publishedPubkeys, ledger
//     marks), so an identity switch without a workspace reset would
//     make the portal/reconcile attribute the old npub's publishes to
//     the new one. `resetWorkspace()` is the paired half: it clears the
//     content stores + caches and keeps settings and identities.
//   - Entity keypairs (LocalKeyManager `local_keys`, incl. the reserved
//     `xray:user` entity-sync slot) are workspace content, not user
//     identity: reset clears them; the sync key is lazily re-minted by
//     the next sync.
//
// Storage shape under `identity_profiles`:
//   { [pubkey]: { pubkey, npub, label, privateKey, nsec, created } }

import { Storage } from './storage.js';
import { Crypto } from './crypto.js';

const PROFILES_KEY = 'identity_profiles';
const HEX64 = /^[0-9a-f]{64}$/;

// What "Start fresh workspace" clears — every store that holds captured
// or authored CONTENT (and its publish stamps), plus the per-workspace
// key registry and the portal's pasted viewer npubs. Exported so tests
// pin the list; extend it when a new content store ships.
export const WORKSPACE_CLEAR_KEYS = Object.freeze([
    'entities',                 // entity records (keypairs joined from local_keys)
    'local_keys',               // per-entity keys + the xray:user sync key
    'article_claims',           // claims + their publish stamps
    'evidence_links',           // 30055 edges + attestation metadata
    'claim_assessments',        // 30054 assessments
    'behavioral_findings',      // 30062 forensic findings
    'adjudicable_propositions', // Phase 15 propositions
    'adjudicated_verdicts',     // Phase 15 verdict chains
    'integrity_findings',       // Phase 15 words-vs-deeds findings
    'platform_accounts',        // Phase 9 account registry
    'portal_identities',        // portal viewer npubs (pasted, read-only)
    'lens_jurisdictions'        // Phase 16 jurisdiction registry + corpora
]);

// What reset deliberately KEEPS — configuration and identity. Exported
// for the same pin-test reason. (`xray:llm:key` is config too: kept,
// but never included in backups — its module forbids export.)
export const WORKSPACE_KEEP_KEYS = Object.freeze([
    'preferences',              // relays, signing method, debug, …
    'local_primary_identity',   // the active identity
    'identity_profiles',        // saved identities (this module)
    'xr_signing_state',         // last-detected NIP-07 state
    'xray:flags',               // feature-flag overrides
    'xray:llm:key',             // Anthropic key (never exported)
    'xray:llm:model',
    'xray:llm:suggest-kinds'
]);

// IndexedDB databases holding workspace content.
export const WORKSPACE_DATABASES = Object.freeze([
    'xray-archive',             // captured article cache (archive-cache.js)
    'xray-audits'               // audit records — PRECIOUS, hence the
                                // export-first flow in the options UI
]);

function normalizeLabel(label) {
    const trimmed = String(label || '').trim();
    if (!trimmed) throw new Error('Profile label required');
    if (trimmed.length > 60) throw new Error('Profile label too long (max 60 chars)');
    return trimmed;
}

function profileFromIdentity(identity, label) {
    return {
        pubkey: identity.pubkey,
        npub: identity.npub,
        label,
        privateKey: identity.privateKey,
        nsec: identity.nsec,
        created: identity.created || Math.floor(Date.now() / 1000)
    };
}

export const IdentityProfiles = {

    /** Raw registry map: { [pubkey]: profile }. */
    async getAll() {
        const all = await Storage.get(PROFILES_KEY, {});
        return (all && typeof all === 'object') ? all : {};
    },

    /** Profiles as a list, oldest first (stable picker order). */
    async list() {
        const all = await IdentityProfiles.getAll();
        return Object.values(all).sort((a, b) => (a.created || 0) - (b.created || 0));
    },

    /**
     * Resolve the active picture: the live `local_primary_identity`
     * plus whether (and as what) it is saved in the registry.
     *
     * @returns {{identity: object|null, profile: object|null, saved: boolean}}
     */
    async active() {
        const identity = await Storage.primaryIdentity.get();
        if (!identity || !identity.pubkey) return { identity: null, profile: null, saved: false };
        const all = await IdentityProfiles.getAll();
        const profile = all[identity.pubkey] || null;
        return { identity, profile, saved: !!profile };
    },

    /**
     * Save the CURRENT live identity into the registry under a label.
     * Idempotent per pubkey (re-saving relabels).
     */
    async saveCurrent(label) {
        const clean = normalizeLabel(label);
        const identity = await Storage.primaryIdentity.get();
        if (!identity || !identity.privateKey) throw new Error('No active identity to save');
        const all = await IdentityProfiles.getAll();
        all[identity.pubkey] = profileFromIdentity(identity, clean);
        await Storage.set(PROFILES_KEY, all);
        return all[identity.pubkey];
    },

    /**
     * Generate a brand-new identity, save it under `label`, and (by
     * default) activate it. With `activate: false` the previously
     * active identity (if any) is restored after the save.
     */
    async create(label, { activate = true } = {}) {
        const clean = normalizeLabel(label);
        const prev = await Storage.primaryIdentity.get();
        const identity = await Storage.primaryIdentity.set(Crypto.generatePrivateKey());
        const all = await IdentityProfiles.getAll();
        all[identity.pubkey] = profileFromIdentity(identity, clean);
        await Storage.set(PROFILES_KEY, all);
        if (!activate && prev && prev.privateKey) {
            await Storage.primaryIdentity.set(prev.privateKey);
        }
        return all[identity.pubkey];
    },

    /**
     * Import an nsec/hex private key, save it under `label`, activate
     * it. Validation is `Storage.primaryIdentity.importNsec`'s.
     */
    async importNsec(label, nsecOrHex) {
        const clean = normalizeLabel(label);
        const identity = await Storage.primaryIdentity.importNsec(nsecOrHex);
        const all = await IdentityProfiles.getAll();
        all[identity.pubkey] = profileFromIdentity(identity, clean);
        await Storage.set(PROFILES_KEY, all);
        return all[identity.pubkey];
    },

    /** Make a saved profile the live signing identity. */
    async activate(pubkey) {
        const key = String(pubkey || '').toLowerCase();
        if (!HEX64.test(key)) throw new Error('activate: 64-hex pubkey required');
        const all = await IdentityProfiles.getAll();
        const profile = all[key];
        if (!profile) throw new Error('No saved profile for that pubkey');
        await Storage.primaryIdentity.set(profile.privateKey);
        return profile;
    },

    /** Relabel a saved profile. */
    async rename(pubkey, label) {
        const clean = normalizeLabel(label);
        const all = await IdentityProfiles.getAll();
        const profile = all[String(pubkey || '').toLowerCase()];
        if (!profile) throw new Error('No saved profile for that pubkey');
        profile.label = clean;
        await Storage.set(PROFILES_KEY, all);
        return profile;
    },

    /**
     * Remove a saved profile. Refuses to remove the ACTIVE identity —
     * switch first, so the live slot never dangles without its backup
     * copy in the registry.
     */
    async remove(pubkey) {
        const key = String(pubkey || '').toLowerCase();
        const all = await IdentityProfiles.getAll();
        if (!all[key]) return false;
        const { identity } = await IdentityProfiles.active();
        if (identity && identity.pubkey === key) {
            throw new Error('Cannot remove the active identity — switch to another profile first');
        }
        delete all[key];
        await Storage.set(PROFILES_KEY, all);
        return true;
    }
};

/**
 * Build the backup snapshot for download BEFORE a reset: every
 * workspace content store plus preferences and saved identities.
 * Contains private keys (profiles/nsec) by design — it is the user's
 * own recovery file; the UI warns. `xray:llm:key` is deliberately
 * absent (its module forbids export).
 */
export async function workspaceBackup() {
    const snapshot = { format: 'xray-workspace-backup', exported_at: new Date().toISOString(), data: {} };
    const keys = [...WORKSPACE_CLEAR_KEYS, 'preferences', 'local_primary_identity', 'identity_profiles'];
    for (const key of keys) {
        snapshot.data[key] = await Storage.get(key, null);
    }
    return snapshot;
}

/**
 * Clear the workspace content stores + IndexedDB caches. Keeps
 * everything in WORKSPACE_KEEP_KEYS untouched. `idb` is injectable for
 * tests; defaults to the global indexedDB when present.
 *
 * @returns {{cleared: string[], databases: string[]}}
 */
export async function resetWorkspace({ idb } = {}) {
    const cleared = [];
    for (const key of WORKSPACE_CLEAR_KEYS) {
        await Storage.delete(key);
        cleared.push(key);
    }
    const databases = [];
    const factory = idb || (typeof indexedDB !== 'undefined' ? indexedDB : null);
    if (factory && typeof factory.deleteDatabase === 'function') {
        for (const name of WORKSPACE_DATABASES) {
            try { factory.deleteDatabase(name); databases.push(name); } catch (_) { /* best-effort */ }
        }
    }
    return { cleared, databases };
}

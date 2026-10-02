// Portal identity resolution (Phase 12.1, docs/PORTAL_DESIGN.md).
//
// "Me" is a resolved SET of author pubkeys, not one key. The portal runs
// outside any capture context, so the reader's source-tab path
// (`xray:capture:getPubkey`) is unavailable and NIP-07 cannot answer
// from an extension page at all. Instead we union six sources, each
// tagged with its provenance so the UI can show honest chips:
//
//   'signer'          — Signer.getPublicKey(): Local reads the primary
//                       identity from storage; NSecBunker connects out
//                       (bounded by a timeout so a dead bunker can't
//                       hang the portal); NIP-07 is skipped entirely.
//   'sync-key'        — the reserved `xray:user` LocalKeyManager slot
//                       (signs entity-sync 30078 + the 10002 relay list).
//   'publish-history' — the union of `publishedPubkeys` recorded on
//                       claims (append-only since Phase 11.1) plus any
//                       `publishedPubkey` singletons.
//   'journal'         — every saved identity profile that signed an
//                       event in this case's signed-event journal
//                       (publish-history.js; JOURNAL 2026-10-01). Only
//                       PROFILES: a merge-import carries a collaborator's
//                       journal rows in, and their key must not become
//                       "me".
//   'case-identity'   — the identity the active case is bound to
//                       (JOURNAL 2026-10-01): the live signer can move
//                       on its own, the case's binding cannot.
//   'manual'          — npubs/hex the user pasted into the portal
//                       header, persisted under `portal_identities`.
//
// Entity pubkeys are resolved separately (they author only entity
// kind-0 profiles and are queried in their own subscription — see the
// design note's privacy section).

import { Storage } from '../shared/storage.js';
import { Signer } from '../shared/signer.js';
import { LocalKeyManager } from '../shared/local-key-manager.js';
import { ClaimModel } from '../shared/claim-model.js';
import { EntityModel } from '../shared/entity-model.js';
import { Workspaces, IdentityProfiles } from '../shared/identity-profiles.js';
import { Crypto } from '../shared/crypto.js';
import { Utils } from '../shared/utils.js';
import { loadJournalRows, summarizeJournal, rankHistoryRelays } from './publish-history.js';

const MANUAL_KEY = 'portal_identities';
const SYNC_KEY_NAME = 'xray:user'; // sidepanel/index.js USER_KEY_NAME
const HEX64 = /^[0-9a-f]{64}$/;
const SIGNER_TIMEOUT_MS = 4000;
// The sources whose keys may contribute read relays (JOURNAL 2026-10-01).
const RELAY_SOURCES = new Set(['signer', 'sync-key', 'case-identity', 'journal']);

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))
    ]);
}

/**
 * Resolve the signer-derived pubkey, or explain why we couldn't.
 * Never throws.
 *
 * @returns {Promise<{method: string, pubkey: string|null, reason: string|null}>}
 */
async function resolveSignerPubkey() {
    let method = 'local';
    try { method = await Signer.getMethod(); } catch (_) { /* default */ }
    if (method === 'nip07') {
        return {
            method,
            pubkey: null,
            reason: 'NIP-07 signs in page tabs only — paste your npub below, or publish once so the portal can use your publish history.'
        };
    }
    try {
        const pubkey = await withTimeout(Signer.getPublicKey(), SIGNER_TIMEOUT_MS);
        return HEX64.test(pubkey || '')
            ? { method, pubkey, reason: null }
            : { method, pubkey: null, reason: 'Signer returned an unusable key.' };
    } catch (err) {
        return { method, pubkey: null, reason: err && err.message ? err.message : String(err) };
    }
}

/**
 * Resolve the full identity picture for the portal.
 *
 * @param {{readJournal?: () => Promise<Array<object>>}} [opts]  the
 *        journal reader (tests inject one; default: the active
 *        workspace's event-journal listAll)
 * @returns {Promise<{
 *   identities: Array<{pubkey: string, sources: string[]}>,   // "me"
 *   viewers:    Array<{pubkey: string, sources: string[]}>,   // pasted read-only archives (28.4)
 *   entities:   Array<{pubkey: string, entityId: string, name: string, type: string}>,
 *   signer:     {method: string, pubkey: string|null, reason: string|null},
 *   historyRelays: string[]   // relays that confirmed events "me" signed in this case, ranked
 * }>}
 */
export async function resolveIdentities({ readJournal } = {}) {
    const sourcesByPubkey = new Map(); // pubkey → Set(source)
    const add = (pubkey, source) => {
        if (typeof pubkey !== 'string' || !HEX64.test(pubkey)) return;
        if (!sourcesByPubkey.has(pubkey)) sourcesByPubkey.set(pubkey, new Set());
        sourcesByPubkey.get(pubkey).add(source);
    };

    // Started first, awaited last: the journal holds every signed event
    // in full, so its read overlaps the storage reads below.
    const journalRows = loadJournalRows(readJournal);

    const signer = await resolveSignerPubkey();
    if (signer.pubkey) add(signer.pubkey, 'signer');

    // EntityModel.getAll() joins keypairs from LocalKeyManager, so the
    // key registry must be hydrated before either lookup below.
    try { await LocalKeyManager.init(); } catch (err) {
        Utils.error('Portal identity: LocalKeyManager init failed', err);
    }
    const syncKey = LocalKeyManager.getKey(SYNC_KEY_NAME);
    if (syncKey && syncKey.pubkey) add(syncKey.pubkey, 'sync-key');

    try {
        const claims = await ClaimModel.getAll();
        for (const claim of Object.values(claims || {})) {
            if (claim && claim.publishedPubkey) add(claim.publishedPubkey, 'publish-history');
            for (const pk of (claim && Array.isArray(claim.publishedPubkeys)) ? claim.publishedPubkeys : []) {
                add(pk, 'publish-history');
            }
        }
    } catch (err) {
        Utils.error('Portal identity: claim history scan failed', err);
    }

    for (const pk of await getManualIdentities()) add(pk, 'manual');

    // The case's own identity, and the saved profiles that signed in its
    // journal (JOURNAL 2026-10-01). A profile is a key this install holds
    // the nsec for, so a collaborator's merged-in rows never qualify.
    let profileKeys = new Set();   // pubkeys only — the profiles' nsecs are not kept
    try {
        const [ws, all] = await Promise.all([Workspaces.active(), IdentityProfiles.getAll()]);
        profileKeys = new Set(Object.keys((all && typeof all === 'object') ? all : {}));
        if (ws && typeof ws.identity_pubkey === 'string') add(ws.identity_pubkey.toLowerCase(), 'case-identity');
    } catch (err) {
        Utils.log('Portal identity: case binding unreadable:', err && err.message);
    }
    const journal = summarizeJournal(await journalRows);
    for (const pk of journal.keys()) {
        if (profileKeys.has(pk)) add(pk, 'journal');
    }

    const entities = [];
    try {
        const all = await EntityModel.getAll();
        for (const entity of Object.values(all || {})) {
            // Foreign keyless entities (KS.3) synthesize a read-only
            // keypair; their pubkeys belong to OTHER users and must
            // not enter the "my entity keys" set — the Q2 kind-0
            // fetch would present a stranger's profile as the user's,
            // and every adoption would churn the sync cursor.
            if (EntityModel.isForeign(entity)) continue;
            const pk = entity && entity.keypair && entity.keypair.pubkey;
            if (typeof pk !== 'string' || !HEX64.test(pk)) continue;
            entities.push({ pubkey: pk, entityId: entity.id, name: entity.name || '', type: entity.type || '' });
        }
    } catch (err) {
        Utils.error('Portal identity: entity scan failed', err);
    }

    // 28.4 — the FENCE: a pubkey whose ONLY source is 'manual' is a
    // pasted VIEWER — someone else's archive to look at, never "me".
    // It must not enter the identities set: reconcile expected-sets,
    // creator binding, and the resolver identity all treat that set as
    // the user, and unioning a viewer into it is exactly how two
    // projects' ledgers interlocked (CASE_WORKSPACE_KICKOFF §1.4). A
    // pasted npub that ALSO has a me-source (signer / sync-key /
    // publish-history / journal / case-identity) stays an identity,
    // chip provenance intact.
    const identities = [];
    const viewers = [];
    for (const [pubkey, sources] of sourcesByPubkey.entries()) {
        const row = { pubkey, sources: [...sources] };
        if (sources.size === 1 && sources.has('manual')) viewers.push(row);
        else identities.push(row);
    }
    // Relays that confirmed what "me" signed here — taken only from keys
    // this install holds or chose. A claim's publish stamp can arrive by
    // merge-import (a collaborator's claims), so a key that is "me" only
    // through 'publish-history' adds no relay; nor does a viewer.
    const relaySigners = identities
        .filter((i) => i.sources.some((s) => RELAY_SOURCES.has(s)))
        .map((i) => i.pubkey);
    const historyRelays = rankHistoryRelays(journal, relaySigners);
    return { identities, viewers, entities, signer, historyRelays };
}

/** The persisted manual pubkeys (hex, validated on write). */
export async function getManualIdentities() {
    const stored = await Storage.get(MANUAL_KEY, []);
    return (Array.isArray(stored) ? stored : []).filter((pk) => typeof pk === 'string' && HEX64.test(pk));
}

/**
 * Add a manual identity from user input — an `npub1…` or 64-hex pubkey.
 *
 * @returns {Promise<{ok: true, pubkey: string} | {ok: false, error: string}>}
 */
export async function addManualIdentity(input) {
    const raw = String(input || '').trim();
    if (!raw) return { ok: false, error: 'Paste an npub or 64-char hex pubkey.' };
    let pubkey = null;
    if (/^npub1/i.test(raw)) {
        pubkey = Crypto.npubToHex(raw.toLowerCase());
        if (!pubkey || !HEX64.test(pubkey)) return { ok: false, error: 'That npub did not decode.' };
    } else if (HEX64.test(raw.toLowerCase())) {
        pubkey = raw.toLowerCase();
    } else {
        return { ok: false, error: 'Not an npub or 64-char hex pubkey.' };
    }
    const existing = await getManualIdentities();
    if (!existing.includes(pubkey)) {
        await Storage.set(MANUAL_KEY, [...existing, pubkey]);
    }
    return { ok: true, pubkey };
}

/** Remove a manually-added identity. No-op for pubkeys from other sources. */
export async function removeManualIdentity(pubkey) {
    const existing = await getManualIdentities();
    const next = existing.filter((pk) => pk !== pubkey);
    if (next.length !== existing.length) await Storage.set(MANUAL_KEY, next);
}

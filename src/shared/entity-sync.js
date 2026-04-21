// Entity sync — Phase 6 of the v4.2 parity push (issue #17).
//
// Cross-device sync of the entity registry via encrypted
// kind-30078 (NIP-78 app-specific data) events. Each entity ships
// as its own event, addressable by `d: <entity_id>`, with content =
// NIP-44 v2 encrypt-to-self payload of the full entity record
// (including the entity's private key).
//
// Why encrypt-to-self: the user is both writer AND reader. They sign
// with their primary identity; they decrypt with it too. NIP-44 v2
// with ECDH(userPrivkey, userPubkey) produces a stable conversation
// key derived only from the user's keypair — no relay or third party
// ever sees the plaintext.
//
// Flow:
//
//   Device A (Push):
//     for entity in Storage.entities:
//       payload = JSON.stringify({ ...entity, keypair: {...}, schemaVersion: 1 })
//       ct      = nip44Encrypt(payload, conversationKey)
//       event   = buildEntitySyncEvent(entity.id, ct, entity.type, userPubkey)
//       sign(event, userPrivkey)
//       publish(relays, event)
//
//   Device B (Pull):
//     events = queryRelays({ kinds:[30078], authors:[userPubkey], '#L':['nac/entity-sync'] })
//     for event in events:
//       payload = nip44Decrypt(event.content, conversationKey)
//       record  = JSON.parse(payload)
//       if record.updated > localRecord.updated:  // last-write-wins
//         upsert entity row + LocalKeyManager keypair
//
// A deliberate simplification: NIP-04 read-path fallback for events
// produced by pre-NIP-44 userscript versions is NOT implemented here.
// Real-world need is effectively zero (MV3 port, no pre-existing
// users with v1-era sync events). Easy to add later if it comes up.

import { Storage } from './storage.js';
import { Crypto } from './crypto.js';
import { Utils } from './utils.js';
import { EventBuilder } from './event-builder.js';
import { NostrClient } from './nostr-client.js';
import { EntityModel } from './entity-model.js';
import { LocalKeyManager } from './local-key-manager.js';

const SCHEMA_VERSION = 1;
const SYNC_LABEL     = 'nac/entity-sync';   // NIP-32 L/l tags for namespacing

// ------------------------------------------------------------------
// Encryption helpers
// ------------------------------------------------------------------

/**
 * NIP-44 v2 conversation key for encrypt-to-self. ECDH with your own
 * privkey and pubkey produces a stable shared secret that only holders
 * of the privkey can regenerate.
 */
async function selfConversationKey(userPrivkeyHex) {
    if (!userPrivkeyHex || !/^[0-9a-f]{64}$/i.test(userPrivkeyHex)) {
        throw new Error('entity-sync: need a 32-byte hex user privkey');
    }
    const userPubkey = Crypto.getPublicKey(userPrivkeyHex);
    return await Crypto.nip44GetConversationKey(userPrivkeyHex, userPubkey);
}

// ------------------------------------------------------------------
// Serialization
// ------------------------------------------------------------------

/**
 * Pack an entity (merged form, with keypair) into the JSON payload we
 * encrypt into the kind-30078 content. Includes schemaVersion so we
 * can evolve the format without breaking pulls from older senders.
 */
export function serializeEntityForSync(entity) {
    if (!entity || !entity.id) throw new Error('serializeEntityForSync: missing entity.id');
    if (!entity.keypair || !entity.keypair.privateKey) {
        throw new Error('serializeEntityForSync: entity is missing a local keypair — cannot sync an entity we don\'t own the keys for');
    }
    return JSON.stringify({
        schemaVersion:     SCHEMA_VERSION,
        id:                entity.id,
        name:              entity.name,
        type:              entity.type,
        description:       entity.description || '',
        nip05:             entity.nip05       || '',
        canonical_id:      entity.canonical_id || null,
        created:           entity.created || Math.floor(Date.now() / 1000),
        updated:           entity.updated || Math.floor(Date.now() / 1000),
        publishedAt:       entity.publishedAt || null,
        publishedEventId:  entity.publishedEventId || null,
        keypair: {
            privateKey: entity.keypair.privateKey,
            pubkey:     entity.keypair.pubkey,
            npub:       entity.keypair.npub,
            nsec:       entity.keypair.nsec
        }
    });
}

/**
 * Inverse of serializeEntityForSync. Does minimal validation — enough
 * to reject obvious garbage. Bad records don't throw; they return null
 * so the pull loop can count-and-continue.
 */
export function deserializeEntityFromSync(payloadJson) {
    let parsed;
    try { parsed = JSON.parse(payloadJson); }
    catch (_) { return null; }
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.id || !/^entity_[0-9a-f]{16}$/.test(parsed.id)) return null;
    if (!parsed.name || typeof parsed.name !== 'string') return null;
    if (!parsed.type || typeof parsed.type !== 'string') return null;
    if (!parsed.keypair || !parsed.keypair.privateKey || !parsed.keypair.pubkey) return null;
    return parsed;
}

// ------------------------------------------------------------------
// Push / Pull
// ------------------------------------------------------------------

/**
 * Build + sign + publish one kind-30078 per entity in the local
 * registry. Caller supplies the user's private key (as hex) so we
 * can both derive the conversation key AND sign the events. Returns
 * per-entity publish results.
 *
 * Only entities with a local keypair get pushed — remote-pulled
 * entities that we don't own the keys for are skipped (nothing to
 * encrypt, nothing to sign, nothing new to say).
 *
 * @param {{ userPrivkey: string, relays: string[] }} opts
 * @returns {Promise<{ pushed, skipped, failed, perEntity }>}
 */
export async function pushEntities({ userPrivkey, relays }) {
    if (!Array.isArray(relays) || relays.length === 0) {
        throw new Error('push: no relays');
    }
    const userPubkey = Crypto.getPublicKey(userPrivkey);
    const convKey = await selfConversationKey(userPrivkey);

    const all = await EntityModel.getAll();
    const out = { pushed: 0, skipped: 0, failed: 0, perEntity: [] };

    for (const entity of Object.values(all)) {
        try {
            if (!entity.keypair || !entity.keypair.privateKey) {
                out.skipped++;
                out.perEntity.push({ id: entity.id, ok: false, reason: 'no local keypair' });
                continue;
            }
            const payload = serializeEntityForSync(entity);
            const ct      = await Crypto.nip44Encrypt(payload, convKey);
            const unsigned = EventBuilder.buildEntitySyncEvent(entity.id, ct, entity.type, userPubkey);
            const signed   = await Crypto.signEvent(unsigned, userPrivkey);
            const result   = await NostrClient.publishToRelays(relays, signed);
            if (result && result.successful > 0) {
                out.pushed++;
                out.perEntity.push({ id: entity.id, ok: true, relays: result.successful, total: result.total });
            } else {
                out.failed++;
                out.perEntity.push({ id: entity.id, ok: false, reason: 'no relays accepted' });
            }
        } catch (err) {
            out.failed++;
            out.perEntity.push({ id: entity.id, ok: false, reason: err.message || String(err) });
            Utils.error('push failed for', entity.id, err);
        }
    }
    return out;
}

/**
 * Pull kind-30078 events for the user's own pubkey, decrypt, and
 * merge into local storage. Conflicts resolved by the payload's
 * `updated` field (last-write-wins on the user's intent, not the
 * relay's receipt timestamp).
 *
 * Returns a merge summary. `added` / `updated` / `unchanged` counts
 * reflect local-storage outcomes after comparing payload.updated
 * against local record.updated.
 *
 * @param {{ userPrivkey: string, relays: string[], timeoutMs?: number }} opts
 */
export async function pullEntities({ userPrivkey, relays, timeoutMs = 8000 }) {
    if (!Array.isArray(relays) || relays.length === 0) {
        throw new Error('pull: no relays');
    }
    const userPubkey = Crypto.getPublicKey(userPrivkey);
    const convKey = await selfConversationKey(userPrivkey);

    const { events } = await NostrClient.queryRelays(
        relays,
        { kinds: [30078], authors: [userPubkey], '#L': [SYNC_LABEL], limit: 500 },
        timeoutMs
    );

    const out = {
        fetched:    events.length,
        added:      0,
        updated:    0,
        unchanged:  0,
        malformed:  0,
        failed:     0
    };

    const localAll = await Storage.get('entities', {});

    for (const event of events) {
        try {
            const plaintext = await Crypto.nip44Decrypt(event.content, convKey);
            const record    = deserializeEntityFromSync(plaintext);
            if (!record) { out.malformed++; continue; }

            const local = localAll[record.id];
            // Last-write-wins by payload.updated. If the local record
            // is at least as fresh, do nothing.
            if (local && (local.updated || 0) >= (record.updated || 0)) {
                out.unchanged++;
                continue;
            }

            // Persist the entity row (without the keypair — LocalKeyManager
            // owns that).
            const keyName = local?.keyName || `entity:${record.id}`;
            localAll[record.id] = {
                id:                record.id,
                name:              record.name,
                type:              record.type,
                description:       record.description || '',
                nip05:             record.nip05 || '',
                canonical_id:      record.canonical_id || null,
                keyName,
                created:           record.created          || Math.floor(Date.now() / 1000),
                updated:           record.updated          || Math.floor(Date.now() / 1000),
                publishedAt:       record.publishedAt      || null,
                publishedEventId:  record.publishedEventId || null
            };

            // Install or overwrite the keypair in LocalKeyManager.
            // We bypass `createKey` (which throws on duplicate) and
            // write directly, so repeated pulls are idempotent.
            LocalKeyManager.keys.set(keyName, {
                name:       keyName,
                privateKey: record.keypair.privateKey,
                pubkey:     record.keypair.pubkey,
                npub:       record.keypair.npub,
                nsec:       record.keypair.nsec,
                metadata:   { entityId: record.id, entityType: record.type, entityName: record.name, source: 'sync' },
                created:    record.created || Math.floor(Date.now() / 1000)
            });

            if (local) out.updated++;
            else       out.added++;
        } catch (err) {
            out.failed++;
            Utils.error('pull decrypt failed for event', event.id, err);
        }
    }

    await Storage.set('entities', localAll);
    try { await LocalKeyManager.save(); } catch (_) { /* best-effort */ }

    return out;
}

/**
 * Clear sync state on relays. Publishes NIP-09 (kind 5) delete
 * requests targeting the user's own kind-30078 events — good relays
 * honor these and drop the matching events from their storage.
 *
 * Not all relays implement NIP-09. Partial success is the norm.
 *
 * Local storage is NOT touched by this — the user's registry on this
 * device is still the truth. "Clear remote" is specifically about the
 * cloud-shaped view.
 *
 * @param {{ userPrivkey: string, relays: string[] }} opts
 */
export async function clearRemote({ userPrivkey, relays }) {
    if (!Array.isArray(relays) || relays.length === 0) throw new Error('clear: no relays');
    const userPubkey = Crypto.getPublicKey(userPrivkey);

    // Query our own kind-30078 events to find the ids to delete.
    const { events } = await NostrClient.queryRelays(
        relays,
        { kinds: [30078], authors: [userPubkey], '#L': [SYNC_LABEL], limit: 500 },
        5000
    );

    const out = { targeted: events.length, published: 0, failed: 0 };
    if (events.length === 0) return out;

    const now = Math.floor(Date.now() / 1000);
    const eTags = events.map((ev) => ['e', ev.id]);
    // Single kind-5 delete referencing every kind-30078 we want
    // removed. Chunk at 100 e-tags per event so the request stays
    // under typical relay size limits.
    const CHUNK = 100;
    for (let i = 0; i < eTags.length; i += CHUNK) {
        const slice = eTags.slice(i, i + CHUNK);
        const unsigned = {
            kind: 5,
            pubkey: userPubkey,
            created_at: now,
            tags: [...slice, ['k', '30078']],
            content: 'X-Ray entity sync — clear remote'
        };
        try {
            const signed = await Crypto.signEvent(unsigned, userPrivkey);
            const result = await NostrClient.publishToRelays(relays, signed);
            if (result && result.successful > 0) out.published++;
            else                                 out.failed++;
        } catch (err) {
            Utils.error('clearRemote chunk failed:', err);
            out.failed++;
        }
    }
    return out;
}

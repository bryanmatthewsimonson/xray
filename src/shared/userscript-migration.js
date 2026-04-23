// Userscript migration — accept a JSON blob exported from the
// `nostr-article-capture` userscript's GM_setValue storage and
// normalize it into X-Ray's chrome.storage.local layout.
//
// Why: the userscript and X-Ray have several schema differences
// that bit us during cross-device sync (see 2026-04-22 journal):
//   - keypair field is `privkey` (userscript) vs `privateKey` (X-Ray)
//   - entity ids are `entity_<64-hex>` (userscript) vs `entity_<16-hex>` (X-Ray)
//   - relay config is wrapped in `{ relays: [{url, enabled, read, write}] }`
//
// This importer accepts either a single combined blob (one JSON
// object whose top-level keys are userscript storage keys) or a
// single-key blob, normalizes shapes on the way in, and writes to
// X-Ray's storage. Returns a per-key result summary so the UI can
// show what landed.
//
// Userscript storage keys we handle:
//   - user_identity     → LocalKeyManager['xray:user']
//   - entity_registry   → entities + LocalKeyManager (one key per entity)
//   - relay_config      → preferences.default_relays
//   - article_claims    → article_claims (pass-through, schema is identical enough)
//   - evidence_links    → evidence_links (pass-through)
//
// Anything else in the blob is ignored with a note.

import { Storage } from './storage.js';
import { LocalKeyManager } from './local-key-manager.js';
import { Crypto } from './crypto.js';

const USER_KEY_NAME = 'xray:user';

/**
 * Identity shape from userscript:
 *   { pubkey, privkey, npub, nsec, signer_type, created_at }
 * Maps to LocalKeyManager['xray:user'] with `privateKey` (the field
 * name X-Ray uses internally).
 */
async function importIdentity(payload) {
    if (!payload || typeof payload !== 'object') return { ok: false, reason: 'no payload' };
    const privateKey = payload.privateKey || payload.privkey;
    const pubkey     = payload.pubkey;
    if (!privateKey || !/^[0-9a-f]{64}$/i.test(privateKey)) {
        return { ok: false, reason: 'invalid privkey hex' };
    }
    if (!pubkey) return { ok: false, reason: 'missing pubkey' };
    // Derive pubkey from privkey to verify they match — protects
    // against accidentally pasting two halves of different identities.
    const derivedPub = Crypto.getPublicKey(privateKey);
    if (derivedPub !== pubkey.toLowerCase()) {
        return { ok: false, reason: `pubkey mismatch: payload says ${pubkey.slice(0, 12)}…, privkey derives ${derivedPub.slice(0, 12)}…` };
    }
    LocalKeyManager.keys.set(USER_KEY_NAME, {
        name:       USER_KEY_NAME,
        privateKey,
        pubkey:     derivedPub,
        npub:       payload.npub || Crypto.hexToNpub(derivedPub),
        nsec:       payload.nsec || Crypto.hexToNsec(privateKey),
        metadata:   { role: 'user-primary', source: 'userscript-migration' },
        created:    payload.created_at || Math.floor(Date.now() / 1000)
    });
    await LocalKeyManager.save();
    return { ok: true, npub: Crypto.hexToNpub(derivedPub) };
}

/**
 * Entity registry from userscript: `{ [entityId]: entity }`. Each
 * entity has the userscript's keypair shape (`privkey` not
 * `privateKey`). We split into the two stores X-Ray uses:
 *   - entities[id] = { ...entity, keyName }     (no keypair material)
 *   - LocalKeyManager.keys.set(keyName, {...})  (the secret material)
 */
async function importEntities(payload) {
    if (!payload || typeof payload !== 'object') return { ok: false, reason: 'no payload' };
    const ids = Object.keys(payload);
    if (ids.length === 0) return { ok: true, added: 0, updated: 0, skipped: 0 };

    const existing = (await Storage.get('entities', {})) || {};
    let added = 0, updated = 0, skipped = 0;
    for (const id of ids) {
        const e = payload[id];
        if (!e || typeof e !== 'object' || !e.id || !e.name || !e.type) { skipped++; continue; }
        const kp = e.keypair || {};
        const privateKey = kp.privateKey || kp.privkey || null;
        const pubkey     = kp.pubkey;
        if (!pubkey) { skipped++; continue; }

        const keyName = (existing[e.id] && existing[e.id].keyName) || `entity:${e.id}`;
        const wasNew  = !existing[e.id];
        existing[e.id] = {
            id:               e.id,
            name:             e.name,
            type:             e.type,
            description:      e.description || '',
            nip05:            e.nip05 || '',
            canonical_id:     e.canonical_id || null,
            keyName,
            created:          e.created          || Math.floor(Date.now() / 1000),
            updated:          e.updated          || Math.floor(Date.now() / 1000),
            publishedAt:      e.publishedAt      || null,
            publishedEventId: e.publishedEventId || null
        };
        if (privateKey) {
            LocalKeyManager.keys.set(keyName, {
                name:       keyName,
                privateKey,
                pubkey,
                npub:       kp.npub || Crypto.hexToNpub(pubkey),
                nsec:       kp.nsec || Crypto.hexToNsec(privateKey),
                metadata:   { entityId: e.id, entityType: e.type, entityName: e.name, source: 'userscript-migration' },
                created:    e.created || Math.floor(Date.now() / 1000)
            });
        }
        if (wasNew) added++; else updated++;
    }
    await Storage.set('entities', existing);
    try { await LocalKeyManager.save(); } catch (_) { /* best-effort */ }
    return { ok: true, added, updated, skipped };
}

/**
 * Relay config from userscript: `{ relays: [{url, enabled, read, write}] }`.
 * Maps to preferences.default_relays (a flat URL array). Only
 * enabled relays come across — disabled rows in the userscript
 * suggest the user already opted out.
 */
async function importRelays(payload) {
    if (!payload || typeof payload !== 'object') return { ok: false, reason: 'no payload' };
    const list = Array.isArray(payload.relays) ? payload.relays : Array.isArray(payload) ? payload : [];
    const incoming = [];
    for (const r of list) {
        if (typeof r === 'string' && /^wss?:\/\//i.test(r)) incoming.push(r.trim());
        else if (r && typeof r.url === 'string' && /^wss?:\/\//i.test(r.url) && r.enabled !== false) {
            incoming.push(r.url.trim());
        }
    }
    if (incoming.length === 0) return { ok: true, merged: 0, total: 0 };

    const prefs = (await Storage.get('preferences', {})) || {};
    const existing = Array.isArray(prefs.default_relays) ? prefs.default_relays : [];
    const merged = [...new Set([...existing, ...incoming])];
    const newCount = merged.length - existing.length;
    prefs.default_relays = merged;
    await Storage.set('preferences', prefs);
    return { ok: true, merged: newCount, total: merged.length };
}

/**
 * Pass-through importers for shapes that are already storage-shape
 * compatible. We merge into existing rather than replace so a
 * partial migration on one device doesn't clobber unique-to-this-
 * device records from a prior run.
 */
async function importPassThrough(storageKey, payload) {
    if (!payload || typeof payload !== 'object') return { ok: false, reason: 'no payload' };
    const incomingKeys = Object.keys(payload);
    if (incomingKeys.length === 0) return { ok: true, added: 0 };
    const existing = (await Storage.get(storageKey, {})) || {};
    const before = Object.keys(existing).length;
    const merged = { ...existing, ...payload };
    await Storage.set(storageKey, merged);
    const after = Object.keys(merged).length;
    return { ok: true, added: after - before, total: after, replaced: incomingKeys.length - (after - before) };
}

/**
 * Top-level entry point. Accepts either:
 *   1. A single object with userscript storage keys at the top level:
 *      { user_identity: {...}, entity_registry: {...}, ... }
 *   2. A single keyed payload nested under a known key: identical to
 *      the above with one entry.
 *
 * Returns { perKey: { user_identity: {...}, ... }, errors: [...] }.
 */
export async function migrateUserscriptBlob(blob) {
    if (!blob || typeof blob !== 'object') {
        return { perKey: {}, errors: ['Top-level value must be a JSON object'] };
    }
    const out = { perKey: {}, errors: [] };

    const handlers = {
        user_identity:   importIdentity,
        entity_registry: importEntities,
        relay_config:    importRelays,
        article_claims:  (p) => importPassThrough('article_claims', p),
        evidence_links:  (p) => importPassThrough('evidence_links', p)
    };

    for (const [key, handler] of Object.entries(handlers)) {
        if (!(key in blob)) continue;
        try {
            out.perKey[key] = await handler(blob[key]);
        } catch (err) {
            out.perKey[key] = { ok: false, reason: err.message || String(err) };
            out.errors.push(`${key}: ${err.message || err}`);
        }
    }

    // Note any unrecognized top-level keys so the user knows what
    // didn't import (vs silently dropping data).
    const unknown = Object.keys(blob).filter((k) => !(k in handlers));
    if (unknown.length > 0) out.errors.push(`Ignored unknown keys: ${unknown.join(', ')}`);

    return out;
}

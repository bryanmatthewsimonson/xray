// Entity model — Phase 4 of the v4.2 parity push (issue #15).
//
// An "entity" is a real-world thing the user cares about: a person,
// an organization, a place, or a thing (product, concept, artifact).
// Each entity gets:
//
//   - a stable id          (sha256 of type + ':' + normalized name)
//   - its own NOSTR keypair (secp256k1, stored locally)
//   - an optional canonical_id link to another entity — the alias
//     mechanism. E.g. "Donald J. Trump" is an alias of canonical
//     "Donald Trump"; both get p-tagged on articles that mention
//     either.
//
// Storage:
//   Storage.entities (chrome.storage.local key 'entities')  — the
//     entity record itself: id, name, type, canonical_id, nip05,
//     description, keyName, created, updated.
//   LocalKeyManager   (chrome.storage.local key 'local_keys') — the
//     actual keypair, stored under keyName = 'entity:<id>'. This lets
//     us reuse LocalKeyManager.signEvent for signing kind-0 profile
//     events without the user being prompted (the user's primary
//     identity comes from NIP-07 / NSecBunker; entity identities are
//     local-managed).
//
// `EntityModel.get(id)` merges the two so callers see one object:
//   { id, name, type, canonical_id, keypair: { pubkey, privkey, npub,
//     nsec }, ... }
// which is the shape `event-builder.buildArticleEvent` already
// expects at src/shared/event-builder.js:113.

import { Storage } from './storage.js';
import { Crypto } from './crypto.js';
import { Utils } from './utils.js';
import { LocalKeyManager } from './local-key-manager.js';

export const ENTITY_TYPES = ['person', 'organization', 'place', 'thing'];

/**
 * Map entity type → tag name used in kind-30023 article events.
 * Matches the shape event-builder.js:121 already produces.
 */
export function entityTypeToTag(type) {
    switch (type) {
        case 'person':       return 'person';
        case 'organization': return 'org';
        case 'place':        return 'place';
        case 'thing':        return 'thing';
        default:             return 'thing';
    }
}

/**
 * Emoji icon for each entity type. Used by the tagger popover and the
 * side-panel browser. Kept as a single source of truth so adding a new
 * type later (unlikely) touches one map.
 */
export const ENTITY_ICONS = {
    person:       '👤',
    organization: '🏢',
    place:        '📍',
    thing:        '🔷'
};

/**
 * Normalize a display name for ID derivation. Aggressive trim +
 * casefold + whitespace collapse so "Donald J. Trump  " and
 * "donald j. trump" hash to the same id — the alias mechanism handles
 * the *intentional* disambiguation cases.
 */
function normalizeName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Derive a deterministic id from {type, name}. Async because Crypto.sha256
 * uses crypto.subtle. 16-hex-char truncation gives a 64-bit space, way
 * more than enough for entity collisions under a single user's registry.
 */
export async function generateEntityId(type, name) {
    const key = `${type}:${normalizeName(name)}`;
    const hash = await Crypto.sha256(key);
    return `entity_${hash.slice(0, 16)}`;
}

function assertValidType(type) {
    if (!ENTITY_TYPES.includes(type)) {
        throw new Error(`Invalid entity type: ${type} (expected one of ${ENTITY_TYPES.join(', ')})`);
    }
}

function assertValidName(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('Entity name is required');
    if (trimmed.length > 200) throw new Error('Entity name too long (max 200 chars)');
    return trimmed;
}

export const EntityModel = {
    /**
     * Return the merged entity record for `id`, or null if not found.
     * Merges the persisted entity row with its LocalKeyManager keypair
     * so callers see:
     *   { id, name, type, canonical_id, keypair: { pubkey, privkey,
     *     npub, nsec }, nip05, description, created, updated, keyName }
     */
    get: async (id) => {
        if (!id) return null;
        const all = await Storage.get('entities', {});
        const record = all[id];
        if (!record) return null;
        const key = record.keyName ? LocalKeyManager.getKey(record.keyName) : null;
        return {
            ...record,
            keypair: key ? {
                pubkey:     key.pubkey,
                privateKey: key.privateKey,
                npub:       key.npub,
                nsec:       key.nsec
            } : null
        };
    },

    getAll: async () => {
        const all = await Storage.get('entities', {});
        const out = {};
        for (const [id, record] of Object.entries(all)) {
            const key = record.keyName ? LocalKeyManager.getKey(record.keyName) : null;
            out[id] = {
                ...record,
                keypair: key ? {
                    pubkey:     key.pubkey,
                    privateKey: key.privateKey,
                    npub:       key.npub,
                    nsec:       key.nsec
                } : null
            };
        }
        return out;
    },

    /**
     * Create a new entity. Generates a secp256k1 keypair and a hash-based
     * id. Returns the full merged record (same shape as `get`). Throws
     * if an entity already exists at the derived id — the caller should
     * either reuse it or create an alias.
     *
     * @param {{name: string, type: string, description?: string, nip05?: string, canonical_id?: string}} fields
     */
    create: async (fields) => {
        const name = assertValidName(fields.name);
        const type = fields.type;
        assertValidType(type);

        const id = await generateEntityId(type, name);
        const all = await Storage.get('entities', {});
        if (all[id]) {
            const existing = all[id];
            // If somebody is creating the *same* entity twice, that's
            // idempotent — return the existing record rather than
            // surprising the caller with an error.
            if (existing.type === type && normalizeName(existing.name) === normalizeName(name)) {
                return await EntityModel.get(id);
            }
            throw new Error(`Id collision: entity_${id.slice(7, 15)}… already exists with different type/name`);
        }

        // Validate canonical_id if supplied — must point at an existing entity
        // of the same type. Cycle detection is EntityModel.linkAlias's job;
        // on create we're always a fresh node so no cycle is possible yet.
        if (fields.canonical_id) {
            const canonical = all[fields.canonical_id];
            if (!canonical) throw new Error(`canonical_id not found: ${fields.canonical_id}`);
            if (canonical.type !== type) throw new Error(`canonical_id points to a ${canonical.type} entity; this entity is a ${type}`);
        }

        // Generate keypair via LocalKeyManager so we can reuse its
        // signEvent path later. Key name is derived from the entity id
        // so it's stable under `get`-merge.
        const keyName = `entity:${id}`;
        await LocalKeyManager.createKey(keyName, { entityId: id, entityName: name, entityType: type });

        const now = Math.floor(Date.now() / 1000);
        const record = {
            id,
            name,
            type,
            description:  fields.description || '',
            nip05:        fields.nip05 || '',
            canonical_id: fields.canonical_id || null,
            keyName,
            created: now,
            updated: now
        };

        all[id] = record;
        await Storage.set('entities', all);
        Utils.log('Created entity:', id, name, type);
        return await EntityModel.get(id);
    },

    /**
     * Patch an existing entity. Keypair and id are immutable. Name and
     * type changes don't rederive the id — this is intentional: the id
     * is the stable identifier for relay-published kind-0 events.
     */
    update: async (id, updates) => {
        const all = await Storage.get('entities', {});
        const record = all[id];
        if (!record) throw new Error(`Entity not found: ${id}`);

        const patched = { ...record };
        if (updates.name != null)        patched.name = assertValidName(updates.name);
        if (updates.type != null)      { assertValidType(updates.type); patched.type = updates.type; }
        if (updates.description != null) patched.description = updates.description;
        if (updates.nip05 != null)       patched.nip05 = updates.nip05;
        if ('canonical_id' in updates)   patched.canonical_id = updates.canonical_id || null;
        patched.updated = Math.floor(Date.now() / 1000);

        all[id] = patched;
        await Storage.set('entities', all);
        return await EntityModel.get(id);
    },

    /**
     * Delete an entity and its keypair. Any other entity aliased to this
     * one loses its canonical link (set to null) rather than being
     * orphan-deleted — cascading deletes on a knowledge graph are rude.
     */
    delete: async (id) => {
        const all = await Storage.get('entities', {});
        const record = all[id];
        if (!record) return false;

        // Unlink aliases that pointed here.
        let unlinkedAliases = 0;
        for (const [otherId, other] of Object.entries(all)) {
            if (other.canonical_id === id) {
                other.canonical_id = null;
                other.updated = Math.floor(Date.now() / 1000);
                unlinkedAliases++;
            }
        }

        delete all[id];
        await Storage.set('entities', all);

        // Delete the keypair too — the entity no longer signs for
        // anything. The relay-published kind-0 stays, of course.
        if (record.keyName) {
            try { await LocalKeyManager.deleteKey(record.keyName); } catch (_) { /* best-effort */ }
        }

        if (unlinkedAliases > 0) {
            Utils.log('Deleted entity', id, '— unlinked', unlinkedAliases, 'alias(es)');
        }
        return true;
    },

    /**
     * Substring search, case-insensitive, over names. For the tagger's
     * autocomplete. Returns the merged records so callers can render the
     * type icon + name directly. Sorted: exact match first, then
     * prefix match, then anywhere-in-name, then by name.
     */
    search: async (query, { limit = 20 } = {}) => {
        const q = normalizeName(query);
        if (!q) return [];
        const all = await EntityModel.getAll();

        const scored = [];
        for (const entity of Object.values(all)) {
            const n = normalizeName(entity.name);
            let score = -1;
            if (n === q)                 score = 3;
            else if (n.startsWith(q))    score = 2;
            else if (n.includes(q))      score = 1;
            if (score >= 0) scored.push({ entity, score });
        }
        scored.sort((a, b) => b.score - a.score || a.entity.name.localeCompare(b.entity.name));
        return scored.slice(0, limit).map((s) => s.entity);
    },

    /**
     * Follow the canonical_id chain from `entity` and return the
     * ultimate canonical entity (the one whose canonical_id is null).
     * Guards against cycles by hard-capping chain depth.
     *
     * Returns the entity itself if it has no canonical_id.
     */
    resolveAlias: async (entity) => {
        if (!entity) return null;
        let current = entity;
        const MAX_DEPTH = 8;
        const seen = new Set([current.id]);
        for (let i = 0; i < MAX_DEPTH && current.canonical_id; i++) {
            const next = await EntityModel.get(current.canonical_id);
            if (!next) break;                         // dangling link
            if (seen.has(next.id)) break;             // cycle
            seen.add(next.id);
            current = next;
        }
        return current;
    },

    /**
     * Set entity `aliasId`'s canonical_id to `canonicalId`. Validates:
     *   - both entities exist
     *   - they share a type (can't alias a place to a person)
     *   - does not introduce a cycle
     *   - canonicalId isn't itself aliased further (resolve to root)
     *
     * Returns the updated alias record.
     */
    linkAlias: async (aliasId, canonicalId) => {
        if (aliasId === canonicalId) throw new Error('Cannot alias an entity to itself');

        const all = await Storage.get('entities', {});
        const alias = all[aliasId];
        const canonical = all[canonicalId];
        if (!alias)     throw new Error(`Alias entity not found: ${aliasId}`);
        if (!canonical) throw new Error(`Canonical entity not found: ${canonicalId}`);
        if (alias.type !== canonical.type) {
            throw new Error(`Type mismatch: alias is ${alias.type}, canonical is ${canonical.type}`);
        }

        // Cycle check — walk canonicalId's alias chain, ensure we never
        // reach aliasId. If `canonical` is itself aliased, we follow to
        // its root and use *that* as the real canonical, so the graph
        // stays shallow.
        const MAX = 16;
        let cursor = canonical;
        const visited = new Set([aliasId]);
        for (let i = 0; i < MAX && cursor.canonical_id; i++) {
            if (visited.has(cursor.canonical_id)) {
                throw new Error(`Cycle detected linking ${aliasId} → ${canonicalId}`);
            }
            visited.add(cursor.canonical_id);
            const next = all[cursor.canonical_id];
            if (!next) break;
            cursor = next;
        }
        // cursor is now the deepest canonical we can reach. Point alias at it.
        alias.canonical_id = cursor.id;
        alias.updated = Math.floor(Date.now() / 1000);
        all[aliasId] = alias;
        await Storage.set('entities', all);
        return await EntityModel.get(aliasId);
    },

    /**
     * Convenience: clear an alias link (make an aliased entity canonical
     * again).
     */
    unlinkAlias: async (id) => {
        return await EntityModel.update(id, { canonical_id: null });
    }
};

// Swap Storage.entities stub for a real implementation that matches the
// shape event-builder consumes. The stub at storage.js:206–212 just
// returns null and throws on save; this replaces it with a pass-through
// that delegates to EntityModel. Safe to call on module import because
// both modules are singletons.
export function installEntityStorageBridge() {
    Storage.entities = {
        get:     async (id) => await EntityModel.get(id),
        getAll:  async ()   => await EntityModel.getAll(),
        save:    async (id, data) => {
            // Back-compat with v4 callers that expected a save(id, data)
            // shape. In our model, creation is split from update for
            // validation clarity — adapt here.
            const existing = await EntityModel.get(id);
            if (existing) return await EntityModel.update(id, data);
            return await EntityModel.create({ ...data });
        },
        delete:  async (id) => await EntityModel.delete(id)
    };
}

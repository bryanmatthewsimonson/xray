// Evidence linker — Phase 5 C4 of the v4.2 parity push (issue #16).
//
// An "evidence link" connects two claims with a typed relationship —
// the user is asserting that one claim relates to another in a
// specific way:
//
//   - supports         (source supports target)
//   - contradicts      (source contradicts target)
//   - contextualizes   (source provides context for target)
//
// Links are directional. (A supports B) is a different link from
// (B supports A); the model doesn't auto-mirror. Separately, we
// allow multiple links between the same claim pair with different
// relationship types — the user can state both "A supports B on
// point X" and "A contextualizes B on point Y" — so the hash-based
// id includes the relationship so the combinations don't collide.
//
// Published as kind-30043 events. `event-builder.buildEvidenceLinkEvent`
// has been stubbed since Phase 2 and consumes this exact shape.

import { Storage } from './storage.js';
import { Crypto } from './crypto.js';
import { Utils } from './utils.js';

// ------------------------------------------------------------------
// Enums
// ------------------------------------------------------------------

export const EVIDENCE_RELATIONSHIPS = ['supports', 'contradicts', 'contextualizes'];

export const EVIDENCE_RELATIONSHIP_LABELS = {
    supports:       'Supports',
    contradicts:    'Contradicts',
    contextualizes: 'Contextualizes'
};

export const EVIDENCE_RELATIONSHIP_ICONS = {
    supports:       '↗',
    contradicts:    '⚔',
    contextualizes: '◇'
};

// ------------------------------------------------------------------
// ID derivation
// ------------------------------------------------------------------

/**
 * Deterministic id from (source, target, relationship). Same triple
 * always produces the same id — so a second `create()` with identical
 * inputs is idempotent, matching the entity / claim pattern.
 */
export async function generateEvidenceLinkId(sourceClaimId, targetClaimId, relationship) {
    const key = `${String(sourceClaimId || '')}|${String(targetClaimId || '')}|${String(relationship || '')}`;
    const hash = await Crypto.sha256(key);
    return `link_${hash.slice(0, 16)}`;
}

// ------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------

function assertValidRelationship(relationship) {
    if (!EVIDENCE_RELATIONSHIPS.includes(relationship)) {
        throw new Error(`Invalid relationship: ${relationship} (expected one of ${EVIDENCE_RELATIONSHIPS.join(', ')})`);
    }
}

function assertValidClaimId(id, label) {
    const trimmed = String(id || '').trim();
    if (!trimmed) throw new Error(`${label} is required`);
    if (!/^claim_[0-9a-f]{16}$/.test(trimmed)) {
        throw new Error(`${label} must be a claim id (got ${trimmed})`);
    }
    return trimmed;
}

// ------------------------------------------------------------------
// CRUD
// ------------------------------------------------------------------

export const EvidenceLinker = {
    get: async (id) => {
        if (!id) return null;
        const all = await Storage.get('evidence_links', {});
        return all[id] || null;
    },

    getAll: async () => {
        return await Storage.get('evidence_links', {});
    },

    /**
     * Every link where `claimId` is either source OR target. Used by
     * the reader's claim card to show outgoing + incoming links.
     */
    getForClaim: async (claimId) => {
        if (!claimId) return [];
        const all = await Storage.get('evidence_links', {});
        const out = [];
        for (const link of Object.values(all)) {
            if (link.source_claim_id === claimId || link.target_claim_id === claimId) {
                out.push(link);
            }
        }
        out.sort((a, b) => (a.created || 0) - (b.created || 0));
        return out;
    },

    /**
     * Create a new evidence link. Idempotent on the
     * (source, target, relationship) triple — second create with the
     * same triple returns the existing record rather than surprising
     * the caller.
     */
    create: async ({ source_claim_id, target_claim_id, relationship, note }) => {
        const source = assertValidClaimId(source_claim_id, 'source_claim_id');
        const target = assertValidClaimId(target_claim_id, 'target_claim_id');
        assertValidRelationship(relationship);

        if (source === target) {
            throw new Error('Cannot link a claim to itself');
        }

        const id = await generateEvidenceLinkId(source, target, relationship);
        const all = await Storage.get('evidence_links', {});
        if (all[id]) return all[id];

        const now = Math.floor(Date.now() / 1000);
        const record = {
            id,
            source_claim_id: source,
            target_claim_id: target,
            relationship,
            note: note || '',
            created: now,
            updated: now,
            publishedAt: null,
            publishedEventId: null
        };
        all[id] = record;
        await Storage.set('evidence_links', all);
        Utils.log('Created evidence link:', id, relationship);
        return record;
    },

    /**
     * Patch a link. Source / target / relationship are IMMUTABLE —
     * they derive the id. Only `note` can be edited in place. To
     * change anything structural, delete + recreate.
     */
    update: async (id, updates) => {
        const all = await Storage.get('evidence_links', {});
        const record = all[id];
        if (!record) throw new Error(`Evidence link not found: ${id}`);
        const patched = { ...record };
        if ('note' in updates) patched.note = updates.note || '';
        patched.updated = Math.floor(Date.now() / 1000);
        all[id] = patched;
        await Storage.set('evidence_links', all);
        return patched;
    },

    delete: async (id) => {
        const all = await Storage.get('evidence_links', {});
        if (!all[id]) return false;
        delete all[id];
        await Storage.set('evidence_links', all);
        return true;
    },

    /**
     * Delete every link that references `claimId`. Called by the
     * reader's claim-delete flow so links aren't orphaned. Returns
     * the number of links removed.
     */
    deleteForClaim: async (claimId) => {
        const all = await Storage.get('evidence_links', {});
        let removed = 0;
        for (const [id, link] of Object.entries(all)) {
            if (link.source_claim_id === claimId || link.target_claim_id === claimId) {
                delete all[id];
                removed++;
            }
        }
        if (removed > 0) await Storage.set('evidence_links', all);
        return removed;
    },

    markPublished: async (id, eventId) => {
        const all = await Storage.get('evidence_links', {});
        const record = all[id];
        if (!record) return null;
        record.publishedAt = Math.floor(Date.now() / 1000);
        if (eventId) record.publishedEventId = eventId;
        all[id] = record;
        await Storage.set('evidence_links', all);
        return record;
    }
};

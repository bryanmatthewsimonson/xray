// Claim linker — Phase 5 C4, repurposed cross-source in Phase 11.1
// (docs/ASSESSMENTS_DESIGN.md).
//
// A link connects two claims with a typed relationship:
//
//   - contradicts   (SYMMETRIC — the Phase 11 core: ⚠ on both claims)
//   - supports      (directional: source supports target)
//   - updates       (directional: source updates/replaces target)
//   - duplicates    (SYMMETRIC — same assertion, different capture)
//
// The legacy `contextualizes` is read-only: pre-11.1 records still
// load and render, but new links can't use it.
//
// Endpoints take CANONICAL claim refs (see claim-ref.js): a local
// claim id for claims we authored, a `30040:<pubkey>:<d>` coordinate
// for foreign ones — so links work against claims we didn't author.
// Refs are canonicalized before hashing, and symmetric relationships
// sort their endpoints first, so one logical link always derives one
// id (A↔B contradicts === B↔A contradicts). Directional links remain
// distinct per direction, and multiple relationship types between the
// same pair coexist (the id includes the relationship).
//
// Each endpoint may carry a `{ url, text, author_pubkey }` snapshot so
// links against foreign claims render and export without a relay
// round-trip; for local endpoints the snapshot auto-fills from the
// claim registry.
//
// Wire: the legacy kind-30043 publish path is RETIRED as of 11.1; the
// cross-source kind-30055 builder lands in 11.2 and publishes behind
// the `assessmentPublishing` flag in a later slice.

import { Storage } from './storage.js';
import { Crypto } from './crypto.js';
import { Utils } from './utils.js';
import { ClaimModel } from './claim-model.js';
import { normalize as normalizeUrl } from './metadata/url-normalizer.js';
import {
    CLAIM_RELATIONSHIPS, REVISION_RELATIONSHIPS,
    isSymmetricRelationship, isValidSuggestedBy
} from './assessment-taxonomy.js';
import {
    isLocalClaimId, parseClaimCoord, assertValidClaimRef,
    canonicalizeClaimRef, makeClaimRefCanonicalizer
} from './claim-ref.js';

// ------------------------------------------------------------------
// Enums
// ------------------------------------------------------------------

export const EVIDENCE_RELATIONSHIPS = CLAIM_RELATIONSHIPS;

// Every relationship the linker will STORE: the Phase-11 four plus the
// Phase-13 diachronic `revision/*` values. `EVIDENCE_RELATIONSHIPS`
// (above) is deliberately the original four so the Phase-11 link picker
// is unchanged; create() validates against this wider union.
const ALL_LINK_RELATIONSHIPS = Object.freeze([
    ...CLAIM_RELATIONSHIPS, ...REVISION_RELATIONSHIPS
]);

// Legacy `contextualizes` keeps label/icon entries so pre-11.1
// records render; it is not offered for new links. The `revision/*`
// values get entries too so diachronic edges render.
export const EVIDENCE_RELATIONSHIP_LABELS = {
    contradicts:       'Contradicts',
    supports:          'Supports',
    updates:           'Updates',
    duplicates:        'Duplicates',
    contextualizes:    'Contextualizes',
    'narrative-patch': 'Patches',
    recharacterizes:   'Recharacterizes',
    'walks-back':      'Walks back'
};

export const EVIDENCE_RELATIONSHIP_ICONS = {
    contradicts:       '⚔',
    supports:          '↗',
    updates:           '↻',
    duplicates:        '≡',
    contextualizes:    '◇',
    'narrative-patch': '▥',
    recharacterizes:   '✎',
    'walks-back':      '↩'
};

// ------------------------------------------------------------------
// Wire parse — kind 30055 (Phase 11.2)
// ------------------------------------------------------------------

/**
 * Parse a foreign kind-30055 ClaimRelationship event into a
 * display-ready object (the parseClaimEvent sibling — pure; no DOM,
 * no storage). Endpoints come from the `a` tags' `source`/`target`
 * markers, falling back to tag order; for symmetric relationships the
 * markers carry no meaning. Returns null for anything that isn't a
 * kind-30055 event.
 *
 * @param {{kind?: number, tags?: Array, content?: string, pubkey?: string, created_at?: number, id?: string}} event
 * @returns {{id, relationship, source: {coord, eventId}, target: {coord, eventId}, note, suggestedBy, urls: string[], pubkey, created_at} | null}
 */
export function parseRelationshipEvent(event) {
    if (!event || event.kind !== 30055) return null;
    const tags = event.tags || [];
    const first = (name) => { const t = tags.find((x) => x[0] === name); return t ? t[1] : ''; };
    // Positional fallback applies only to UNMARKED tags — a lone tag
    // carrying the opposite marker must not be misattributed (e.g. a
    // link with only a target event id).
    const marked = (name, marker, fallbackIndex) => {
        const list = tags.filter((x) => x[0] === name);
        const hit = list.find((x) => x[3] === marker);
        if (hit) return hit;
        const fallback = list[fallbackIndex];
        return (fallback && !fallback[3]) ? fallback : null;
    };
    const srcA = marked('a', 'source', 0);
    const tgtA = marked('a', 'target', 1);
    const srcE = marked('e', 'source', 0);
    const tgtE = marked('e', 'target', 1);
    return {
        id:           first('d') || (event.id || ''),
        relationship: first('relationship'),
        source:       { coord: (srcA && srcA[1]) || '', eventId: (srcE && srcE[1]) || null },
        target:       { coord: (tgtA && tgtA[1]) || '', eventId: (tgtE && tgtE[1]) || null },
        note:         event.content || '',
        suggestedBy:  first('suggested-by') || 'user',
        urls:         tags.filter((x) => x[0] === 'r').map((x) => x[1]),
        pubkey:       event.pubkey || '',
        created_at:   event.created_at || 0
    };
}

// ------------------------------------------------------------------
// ID derivation
// ------------------------------------------------------------------

/**
 * Deterministic id from (source, target, relationship). Expects
 * already-canonical refs (create() canonicalizes first). Symmetric
 * relationships sort the endpoints so both directions derive the same
 * id; the relationship is in the hash so different types between the
 * same pair don't collide. NOTE: this is the LOCAL id; the kind-30055
 * wire d-tag hashes coordinates only and is derived at publish time.
 */
export async function generateEvidenceLinkId(sourceRef, targetRef, relationship) {
    let a = String(sourceRef || '');
    let b = String(targetRef || '');
    if (isSymmetricRelationship(relationship) && b < a) [a, b] = [b, a];
    const key = `${a}|${b}|${String(relationship || '')}`;
    const hash = await Crypto.sha256(key);
    return `link_${hash.slice(0, 16)}`;
}

// ------------------------------------------------------------------
// Validation + normalization
// ------------------------------------------------------------------

function assertValidRelationship(relationship) {
    if (!ALL_LINK_RELATIONSHIPS.includes(relationship)) {
        throw new Error(`Invalid relationship: ${relationship} (expected one of ${ALL_LINK_RELATIONSHIPS.join(', ')})`);
    }
}

function assertValidSuggestedBy(value) {
    const v = value === undefined || value === null ? 'user' : value;
    if (!isValidSuggestedBy(v)) {
        throw new Error(`Invalid suggested_by: ${v} (expected 'user' or 'llm:<model>')`);
    }
    return v;
}

/**
 * Endpoint snapshot: caller-supplied for foreign refs, auto-filled
 * from the claim registry for local ones. Null when neither source
 * has it (e.g. tests with fake ids) — renderers must tolerate that.
 * A coordinate ref carries its author pubkey, so that backfills when
 * the caller didn't supply one.
 */
async function resolveSnapshot(ref, given) {
    if (given && (given.url || given.text)) {
        const coord = parseClaimCoord(ref);
        const rawUrl = given.url ? String(given.url) : '';
        return {
            url:           rawUrl ? normalizeUrl(rawUrl) : '',
            url_raw:       given.url_raw || rawUrl,   // verbatim, for the wire `r`
            text:          String(given.text || ''),
            author_pubkey: given.author_pubkey || (coord ? coord.pubkey : null)
        };
    }
    if (isLocalClaimId(ref)) {
        const claim = await ClaimModel.get(ref);
        if (claim) {
            return {
                url:           normalizeUrl(claim.source_url),
                url_raw:       claim.source_url || '',
                text:          claim.text,
                author_pubkey: claim.publishedPubkey || null
            };
        }
    }
    return null;
}

// Backfill fields for records written before 11.x, read-time only.
function normalizeLink(record) {
    if (!record) return record;
    let out = record;
    if (!('suggested_by' in out)) {
        out = {
            ...out,
            suggested_by:    'user',
            source_snapshot: out.source_snapshot || null,
            target_snapshot: out.target_snapshot || null
        };
    }
    // 30043→30055 republish migration (Phase 11.7): a link whose only
    // prior publish was the RETIRED kind 30043 carries a publishedAt
    // but no publishedKind. Clear its publish marker so the first
    // kind-30055 batch re-emits it; markPublished stamps
    // publishedKind=30055 going forward, so this runs once.
    if (out.publishedAt && !out.publishedKind) {
        out = { ...out, publishedAt: null, publishedEventId: null };
    }
    return out;
}

// ------------------------------------------------------------------
// CRUD
// ------------------------------------------------------------------

export const EvidenceLinker = {
    get: async (id) => {
        if (!id) return null;
        const all = await Storage.get('evidence_links', {});
        return all[id] ? normalizeLink(all[id]) : null;
    },

    getAll: async () => {
        const all = await Storage.get('evidence_links', {});
        const out = {};
        for (const [id, rec] of Object.entries(all)) out[id] = normalizeLink(rec);
        return out;
    },

    /**
     * Every link where `ref` is either endpoint. BOTH the query ref
     * and the stored endpoints are canonicalized before matching —
     * canonicality is time-dependent (a stored coordinate becomes
     * collapsible once its claim records a publishedPubkey), so a
     * drifted endpoint must still match. Used by the reader's claim
     * card and the ⚠ badge logic.
     */
    getForClaim: async (ref) => {
        if (!ref) return [];
        const canonical = await canonicalizeClaimRef(ref);
        const canon = await makeClaimRefCanonicalizer();
        const all = await Storage.get('evidence_links', {});
        const out = [];
        for (const link of Object.values(all)) {
            if (canon(link.source_claim_id) === canonical || canon(link.target_claim_id) === canonical) {
                out.push(normalizeLink(link));
            }
        }
        out.sort((a, b) => (a.created || 0) - (b.created || 0));
        return out;
    },

    /**
     * Create a link. Endpoints accept local claim ids or 30040
     * coordinates; idempotent on the canonical (source, target,
     * relationship) triple — for symmetric relationships, on the
     * unordered pair.
     */
    create: async ({ source_claim_id, target_claim_id, relationship, note, suggested_by,
                     source_snapshot, target_snapshot }) => {
        assertValidClaimRef(source_claim_id, 'source_claim_id');
        assertValidClaimRef(target_claim_id, 'target_claim_id');
        assertValidRelationship(relationship);

        let source = await canonicalizeClaimRef(source_claim_id, 'source_claim_id');
        let target = await canonicalizeClaimRef(target_claim_id, 'target_claim_id');
        let sourceSnap = source_snapshot || null;
        let targetSnap = target_snapshot || null;

        if (source === target) {
            throw new Error('Cannot link a claim to itself');
        }

        // Symmetric relationships store endpoints in sorted order so
        // both creation directions land on the same record.
        if (isSymmetricRelationship(relationship) && target < source) {
            [source, target] = [target, source];
            [sourceSnap, targetSnap] = [targetSnap, sourceSnap];
        }

        const id = await generateEvidenceLinkId(source, target, relationship);
        const all = await Storage.get('evidence_links', {});
        if (all[id]) return normalizeLink(all[id]);
        // Match-based dedupe too: an endpoint stored under a ref whose
        // canonicality has since drifted derives a different id for the
        // same logical pair — it must still win.
        {
            const canon = await makeClaimRefCanonicalizer();
            let qa = canon(source), qb = canon(target);
            if (isSymmetricRelationship(relationship) && qb < qa) [qa, qb] = [qb, qa];
            for (const link of Object.values(all)) {
                if (link.relationship !== relationship) continue;
                let sa = canon(link.source_claim_id), sb = canon(link.target_claim_id);
                if (isSymmetricRelationship(relationship) && sb < sa) [sa, sb] = [sb, sa];
                if (sa === qa && sb === qb) return normalizeLink(link);
            }
        }

        const now = Math.floor(Date.now() / 1000);
        const record = {
            id,
            source_claim_id: source,
            target_claim_id: target,
            relationship,
            note:            note || '',
            suggested_by:    assertValidSuggestedBy(suggested_by),
            source_snapshot: await resolveSnapshot(source, sourceSnap),
            target_snapshot: await resolveSnapshot(target, targetSnap),
            created:         now,
            updated:         now,
            publishedAt:     null,
            publishedEventId: null
        };
        all[id] = record;
        await Storage.set('evidence_links', all);
        Utils.log('Created claim link:', id, relationship);
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
        const patched = normalizeLink({ ...record });
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
     * Delete every link that references the claim (by either
     * representation — stored endpoints are canonicalized too, so
     * drifted refs still match). Called by the reader's claim-delete
     * flow so links aren't orphaned. Returns the number removed.
     */
    deleteForClaim: async (ref) => {
        if (!ref) return 0;
        const canonical = await canonicalizeClaimRef(ref);
        const canon = await makeClaimRefCanonicalizer();
        const all = await Storage.get('evidence_links', {});
        let removed = 0;
        for (const [id, link] of Object.entries(all)) {
            if (canon(link.source_claim_id) === canonical || canon(link.target_claim_id) === canonical) {
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
        // Stamp the kind so the 30043→30055 read-time migration knows
        // this was published under the current vocabulary.
        record.publishedKind = 30055;
        all[id] = record;
        await Storage.set('evidence_links', all);
        return normalizeLink(record);
    }
};

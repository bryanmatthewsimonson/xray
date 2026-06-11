// Assessment model — Phase 11.1 (docs/ASSESSMENTS_DESIGN.md).
//
// A personal judgment on a single claim — ours or a foreign one. Two
// orthogonal axes:
//
//   - stance    — graded agree↔disagree, integer -2..+2, or null for
//                 a label-only assessment
//   - labels[]  — typed issues ({ label, anchor?, note?, suggested_by }),
//                 at most one entry per label value (keeps the wire
//                 round-trip lossless)
//
// plus a free-text markdown `rationale` and a `suggested_by`
// provenance field ('user' | 'llm:<model>') — the manual-now /
// LLM-ready seam: an LLM-suggestion pass can call this same API later.
//
// One assessment per claim: the id hashes the CANONICAL claim ref
// (see claim-ref.js), so create() is idempotent across the publish
// boundary — a claim assessed pre-publish (keyed by local id) and
// re-encountered post-publish by coordinate keys identically.
//
// `claim_ref` carries url/text snapshots so assessments of foreign
// claims render and export without a relay round-trip. The url is
// stored normalized (metadata/url-normalizer) per the design's URL
// rule.
//
// Storage: Storage.get('claim_assessments', {}) keyed by assessment
// id — same single-key id→record map pattern as 'article_claims'.
// Wire mapping (kind 30054) lands in slice 11.2; publishing is gated
// behind the `assessmentPublishing` flag in a later slice.

import { Storage } from './storage.js';
import { Crypto } from './crypto.js';
import { Utils } from './utils.js';
import { ClaimModel } from './claim-model.js';
import { normalize as normalizeUrl } from './metadata/url-normalizer.js';
import {
    isValidLabel, isValidStance, isValidSuggestedBy
} from './assessment-taxonomy.js';
import {
    isLocalClaimId, parseClaimCoord, canonicalizeClaimRef,
    makeClaimRefCanonicalizer
} from './claim-ref.js';

// ------------------------------------------------------------------
// ID derivation
// ------------------------------------------------------------------

/**
 * Deterministic id from the canonical claim ref. NOTE: this is the
 * LOCAL id; the kind-30054 wire d-tag hashes the claim *coordinate*
 * and is derived at publish time (slice 11.2) — local ids never hit
 * the wire.
 */
export async function generateAssessmentId(canonicalRef) {
    const hash = await Crypto.sha256(String(canonicalRef || ''));
    return `assess_${hash.slice(0, 16)}`;
}

// ------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------

function assertValidStanceOrNull(stance) {
    if (stance === null || stance === undefined) return null;
    if (!isValidStance(stance)) {
        throw new Error(`Invalid stance: ${stance} (expected integer -2..2 or null)`);
    }
    return stance;
}

function assertValidSuggestedBy(value, label) {
    const v = value === undefined || value === null ? 'user' : value;
    if (!isValidSuggestedBy(v)) {
        throw new Error(`Invalid ${label}: ${v} (expected 'user' or 'llm:<model>')`);
    }
    return v;
}

function cleanLabels(labels) {
    if (labels === undefined || labels === null) return [];
    if (!Array.isArray(labels)) throw new Error('labels must be an array');
    const seen = new Set();
    const out = [];
    for (const entry of labels) {
        const rec = typeof entry === 'string' ? { label: entry } : (entry || {});
        if (!isValidLabel(rec.label)) {
            throw new Error(`Invalid label: ${rec.label}`);
        }
        if (seen.has(rec.label)) {
            throw new Error(`Duplicate label: ${rec.label} (one entry per label value)`);
        }
        seen.add(rec.label);
        out.push({
            label:        rec.label,
            anchor:       rec.anchor || null,
            note:         rec.note || '',
            suggested_by: assertValidSuggestedBy(rec.suggested_by, 'label suggested_by')
        });
    }
    return out;
}

function assertHasJudgment(stance, labels) {
    if (stance === null && labels.length === 0) {
        throw new Error('Assessment needs a stance or at least one label');
    }
}

/**
 * Resolve the caller's claim_ref into the stored shape. For local
 * claim ids the url/text snapshots come from the claim registry; for
 * coordinates the caller must supply them (it always has the event in
 * hand). Returns `{ canonicalRef, claim_ref }`.
 */
async function resolveClaimRef(input) {
    const given = input || {};
    const raw = given.claim_id || given.coord;
    const canonicalRef = await canonicalizeClaimRef(raw, 'claim_ref');

    if (isLocalClaimId(canonicalRef)) {
        const claim = await ClaimModel.get(canonicalRef);
        if (!claim) throw new Error(`Claim not found: ${canonicalRef}`);
        return {
            canonicalRef,
            claim_ref: {
                claim_id:      canonicalRef,
                coord:         claim.publishedPubkey
                                   ? `30040:${claim.publishedPubkey}:${canonicalRef}`
                                   : null,
                event_id:      given.event_id || null,
                url:           normalizeUrl(claim.source_url),
                // url_raw preserves the verbatim source URL — own claims
                // publish their `r` raw, so the 30054's `r` must match it
                // verbatim for the #r join (about_pubkeys come from the
                // registry at publish time, so none stored here).
                url_raw:       claim.source_url || '',
                text:          claim.text,
                author_pubkey: claim.publishedPubkey || null
            }
        };
    }

    // Foreign claim — coordinate form. Snapshots required.
    const coord = parseClaimCoord(canonicalRef);
    const url  = String(given.url || '').trim();
    const text = String(given.text || '').trim();
    if (!url)  throw new Error('claim_ref.url is required for foreign claims');
    if (!text) throw new Error('claim_ref.text is required for foreign claims');
    // about_pubkeys: the assessed claim's about-entity pubkeys, so the
    // published 30054 can mirror them and a single
    // {kinds:[30040,30054], "#p":[entity]} filter pulls both.
    const aboutPubkeys = Array.isArray(given.about_pubkeys)
        ? given.about_pubkeys.filter((p) => /^[0-9a-f]{64}$/.test(p))
        : [];
    return {
        canonicalRef,
        claim_ref: {
            claim_id:      null,
            coord:         canonicalRef,
            event_id:      given.event_id || null,
            url:           normalizeUrl(url),
            url_raw:       url,                // verbatim, as the 30040 published it
            text,
            author_pubkey: coord.pubkey,
            about_pubkeys: aboutPubkeys
        }
    };
}

/**
 * The canonical key a stored record answers to. Canonicality is
 * time-dependent (a stored coordinate becomes collapsible once its
 * claim records a publishedPubkey), so the stored ref is run through
 * the supplied canonicalizer rather than trusted verbatim — otherwise
 * a drifted record would match NEITHER representation.
 */
function recordCanonicalRef(record, canon) {
    const raw = (record && record.claim_ref &&
                 (record.claim_ref.claim_id || record.claim_ref.coord)) || '';
    return raw ? canon(raw) : '';
}

/** Match-based lookup over a storage snapshot (drift-robust). */
async function findByCanonicalRef(all, canonicalRef) {
    const canon = await makeClaimRefCanonicalizer();
    const canonical = canon(canonicalRef);
    for (const record of Object.values(all)) {
        if (recordCanonicalRef(record, canon) === canonical) return record;
    }
    return null;
}

// ------------------------------------------------------------------
// CRUD
// ------------------------------------------------------------------

const STORAGE_KEY = 'claim_assessments';

export const AssessmentModel = {
    get: async (id) => {
        if (!id) return null;
        const all = await Storage.get(STORAGE_KEY, {});
        return all[id] || null;
    },

    getAll: async () => {
        return await Storage.get(STORAGE_KEY, {});
    },

    /**
     * The assessment for a claim, looked up by either representation
     * (local id or coordinate) — BOTH the query ref and the stored
     * refs are canonicalized before matching. Returns null when the
     * claim is unassessed.
     */
    getByClaimRef: async (ref) => {
        const canonical = await canonicalizeClaimRef(ref, 'claim ref');
        const all = await Storage.get(STORAGE_KEY, {});
        return await findByCanonicalRef(all, canonical);
    },

    /**
     * Create an assessment. Required: `claim_ref` with one of
     * `claim_id` (ours) or `coord` (foreign; plus url/text snapshots),
     * and at least one of `stance` / `labels`. Idempotent on the
     * canonical claim ref — one assessment per claim.
     */
    create: async (fields) => {
        const given = fields || {};
        const { canonicalRef, claim_ref } = await resolveClaimRef(given.claim_ref);

        const id = await generateAssessmentId(canonicalRef);
        const all = await Storage.get(STORAGE_KEY, {});
        if (all[id]) return all[id];   // idempotent
        // Match-based dedupe too: a record stored under a ref whose
        // canonicality has since drifted derives a different id for
        // the same logical claim — it must still win.
        const drifted = await findByCanonicalRef(all, canonicalRef);
        if (drifted) return drifted;

        const stance = assertValidStanceOrNull(given.stance);
        const labels = cleanLabels(given.labels);
        assertHasJudgment(stance, labels);

        const now = Math.floor(Date.now() / 1000);
        const record = {
            id,
            claim_ref,
            stance,
            rationale:        String(given.rationale || ''),
            labels,
            suggested_by:     assertValidSuggestedBy(given.suggested_by, 'suggested_by'),
            created:          now,
            updated:          now,
            publishedAt:      null,
            publishedEventId: null
        };

        all[id] = record;
        await Storage.set(STORAGE_KEY, all);
        Utils.log('Created assessment:', id, canonicalRef);
        return record;
    },

    /**
     * Patch an assessment. `claim_ref` is IMMUTABLE (it derives the
     * id) — use `backfillCoord` for the publish-time coordinate.
     * Patchable: stance, labels, rationale, suggested_by. The
     * stance-or-labels invariant is re-checked after the patch.
     */
    update: async (id, updates) => {
        const all = await Storage.get(STORAGE_KEY, {});
        const record = all[id];
        if (!record) throw new Error(`Assessment not found: ${id}`);

        const patched = { ...record };
        if ('stance' in updates)       patched.stance = assertValidStanceOrNull(updates.stance);
        if ('labels' in updates)       patched.labels = cleanLabels(updates.labels);
        if ('rationale' in updates)    patched.rationale = String(updates.rationale || '');
        if ('suggested_by' in updates) {
            patched.suggested_by = assertValidSuggestedBy(updates.suggested_by, 'suggested_by');
        }
        assertHasJudgment(patched.stance, patched.labels);

        patched.updated = Math.floor(Date.now() / 1000);
        all[id] = patched;
        await Storage.set(STORAGE_KEY, all);
        return patched;
    },

    /**
     * Record the claim's coordinate once it's known (our claim
     * published). Enrichment, not an edit: does NOT bump `updated`.
     * The coordinate's d must match the record's local claim id.
     */
    backfillCoord: async (id, coord) => {
        const all = await Storage.get(STORAGE_KEY, {});
        const record = all[id];
        if (!record) return null;
        const parsed = parseClaimCoord(coord);
        if (!parsed) throw new Error(`Invalid coordinate: ${coord}`);
        if (!record.claim_ref.claim_id || parsed.d !== record.claim_ref.claim_id) {
            throw new Error('Coordinate does not match the assessed claim');
        }
        record.claim_ref = {
            ...record.claim_ref,
            coord:         coord,
            author_pubkey: parsed.pubkey
        };
        all[id] = record;
        await Storage.set(STORAGE_KEY, all);
        return record;
    },

    delete: async (id) => {
        const all = await Storage.get(STORAGE_KEY, {});
        if (!all[id]) return false;
        delete all[id];
        await Storage.set(STORAGE_KEY, all);
        return true;
    },

    /**
     * Record a successful kind-30054 publish. Does NOT bump `updated`,
     * so edits after a publish correctly re-emit next time.
     */
    markPublished: async (id, eventId) => {
        const all = await Storage.get(STORAGE_KEY, {});
        const record = all[id];
        if (!record) return null;
        record.publishedAt = Math.floor(Date.now() / 1000);
        if (eventId) record.publishedEventId = eventId;
        all[id] = record;
        await Storage.set(STORAGE_KEY, all);
        return record;
    },

    /**
     * Record a successful kind-1985 label-mirror publish. Tracked
     * SEPARATELY from `publishedAt`: kind 1985 is non-replaceable, so a
     * mirror that was rejected (while its 30054 landed) must be
     * retryable, and selection keys on `mirroredAt` not the
     * assessment's publish state. Does not bump `updated`.
     */
    markMirrored: async (id) => {
        const all = await Storage.get(STORAGE_KEY, {});
        const record = all[id];
        if (!record) return null;
        record.mirroredAt = Math.floor(Date.now() / 1000);
        all[id] = record;
        await Storage.set(STORAGE_KEY, all);
        return record;
    }
};

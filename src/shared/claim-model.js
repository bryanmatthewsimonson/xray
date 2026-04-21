// Claim model — Phase 5 C1 of the v4.2 parity push (issue #16).
//
// A "claim" is a structured factual assertion the user has extracted
// from an article. Each claim has:
//
//   - a stable hash-based id           (derived from source URL + text)
//   - a classification type            (factual / causal / evaluative / predictive)
//   - optional "crux" flag + confidence (0–100) — this is the central
//     claim the whole piece hinges on
//   - a claimant, subject, object triple — each either a specific
//     entity (by id, from Phase 4's `EntityModel`) or free text
//   - a predicate — the relationship verb
//   - an attribution — direct_quote / paraphrase / editorial / thesis
//   - an optional quote_date — when the claim was ORIGINALLY made (may
//     predate the article reporting it)
//   - the surrounding context text — becomes the kind-30040 event body
//
// Storage:
//   Storage.get('article_claims', {})  — keyed by claim id. Same
//     pattern as entities.
//
// Publication (Phase 5 C3): the reader's publish flow will emit a
// kind-30040 event per claim via `event-builder.buildClaimEvent()`,
// already built in Phase 2 and consuming this exact shape.

import { Storage } from './storage.js';
import { Crypto } from './crypto.js';
import { Utils } from './utils.js';

// ------------------------------------------------------------------
// Enums
// ------------------------------------------------------------------

export const CLAIM_TYPES = ['factual', 'causal', 'evaluative', 'predictive'];

export const CLAIM_TYPE_LABELS = {
    factual:    'Factual',
    causal:     'Causal',
    evaluative: 'Evaluative',
    predictive: 'Predictive'
};

export const CLAIM_TYPE_ICONS = {
    factual:    '📋',
    causal:     '➡️',
    evaluative: '⚖️',
    predictive: '🔮'
};

export const CLAIM_ATTRIBUTIONS = ['direct_quote', 'paraphrase', 'editorial', 'thesis'];

export const CLAIM_ATTRIBUTION_LABELS = {
    direct_quote: 'Direct quote',
    paraphrase:   'Paraphrase',
    editorial:    'Editorial',
    thesis:       'Thesis'
};

// ------------------------------------------------------------------
// ID derivation
// ------------------------------------------------------------------

/**
 * Collapse whitespace + casefold the claim text for id derivation.
 * Two capture sessions that extract the same claim from the same URL —
 * even with minor whitespace differences — get the same id. Explicit
 * variant claims live at different URLs or have substantively different
 * text.
 */
function normalizeClaimText(text) {
    return String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function generateClaimId(sourceUrl, text) {
    const key = `${String(sourceUrl || '').trim()}|${normalizeClaimText(text)}`;
    const hash = await Crypto.sha256(key);
    return `claim_${hash.slice(0, 16)}`;
}

// ------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------

function assertValidType(type) {
    if (!CLAIM_TYPES.includes(type)) {
        throw new Error(`Invalid claim type: ${type} (expected one of ${CLAIM_TYPES.join(', ')})`);
    }
}

function assertValidAttribution(attribution) {
    if (!CLAIM_ATTRIBUTIONS.includes(attribution)) {
        throw new Error(`Invalid attribution: ${attribution} (expected one of ${CLAIM_ATTRIBUTIONS.join(', ')})`);
    }
}

function assertValidText(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) throw new Error('Claim text is required');
    if (trimmed.length > 2000) throw new Error('Claim text too long (max 2000 chars)');
    return trimmed;
}

function assertValidConfidence(confidence) {
    if (confidence == null) return null;
    const n = Number(confidence);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
        throw new Error(`Invalid confidence: ${confidence} (expected 0..100)`);
    }
    return Math.round(n);
}

function assertValidUrl(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed) throw new Error('source_url is required');
    return trimmed;
}

// ------------------------------------------------------------------
// CRUD
// ------------------------------------------------------------------

export const ClaimModel = {
    /**
     * Fetch a single claim by id, or null if not found.
     */
    get: async (id) => {
        if (!id) return null;
        const all = await Storage.get('article_claims', {});
        return all[id] || null;
    },

    /**
     * All claims, keyed by id.
     */
    getAll: async () => {
        return await Storage.get('article_claims', {});
    },

    /**
     * All claims whose `source_url` exactly matches the given URL.
     * Used by the reader's claims-bar to show the list of claims for
     * the currently-open article.
     */
    getBySourceUrl: async (url) => {
        if (!url) return [];
        const all = await Storage.get('article_claims', {});
        const out = [];
        for (const claim of Object.values(all)) {
            if (claim.source_url === url) out.push(claim);
        }
        out.sort((a, b) => (b.is_crux ? 1 : 0) - (a.is_crux ? 1 : 0)   // cruxes first
                          || (a.created || 0) - (b.created || 0));     // then by creation
        return out;
    },

    /**
     * Create a new claim. Generates a hash-based id from
     * `source_url + text`, so the same claim on the same article is
     * idempotent — second `create()` with identical text + URL returns
     * the existing record without surprise.
     *
     * Required fields: `text`, `type`, `source_url`.
     * Optional:        `is_crux`, `confidence` (0-100), `attribution`
     *                  (default 'editorial'), `claimant_entity_id`,
     *                  `subject_entity_ids` | `subject_text`,
     *                  `object_entity_ids` | `object_text`,
     *                  `predicate`, `quote_date`, `context`.
     */
    create: async (fields) => {
        const text = assertValidText(fields.text);
        const type = fields.type;
        assertValidType(type);
        const sourceUrl = assertValidUrl(fields.source_url);
        const attribution = fields.attribution || 'editorial';
        assertValidAttribution(attribution);
        const confidence = assertValidConfidence(fields.confidence);

        const id = await generateClaimId(sourceUrl, text);
        const all = await Storage.get('article_claims', {});
        if (all[id]) {
            // Idempotent create if the URL + normalized text already
            // produced this id — return the existing record. If the
            // caller wanted to update, they should call `update()`.
            return all[id];
        }

        const now = Math.floor(Date.now() / 1000);
        const record = {
            id,
            text,
            type,
            is_crux:             fields.is_crux === true,
            confidence:          confidence,
            claimant_entity_id:  fields.claimant_entity_id || null,
            subject_entity_ids:  Array.isArray(fields.subject_entity_ids) ? fields.subject_entity_ids.slice() : [],
            subject_text:        fields.subject_text || '',
            object_entity_ids:   Array.isArray(fields.object_entity_ids)  ? fields.object_entity_ids.slice()  : [],
            object_text:         fields.object_text || '',
            predicate:           fields.predicate   || '',
            attribution,
            quote_date:          fields.quote_date  || null,
            source_url:          sourceUrl,
            context:             fields.context     || '',
            created:             now,
            updated:             now,
            publishedAt:         null,
            publishedEventId:    null
        };

        all[id] = record;
        await Storage.set('article_claims', all);
        Utils.log('Created claim:', id, text.slice(0, 60));
        return record;
    },

    /**
     * Patch a claim. Id, source_url, and text are IMMUTABLE — they
     * derive the id together, so changing them would orphan any
     * already-published kind-30040 event. If you need to change the
     * text, delete the old claim and create a new one.
     */
    update: async (id, updates) => {
        const all = await Storage.get('article_claims', {});
        const record = all[id];
        if (!record) throw new Error(`Claim not found: ${id}`);

        const patched = { ...record };
        if (updates.type != null) { assertValidType(updates.type); patched.type = updates.type; }
        if (updates.attribution != null) {
            assertValidAttribution(updates.attribution);
            patched.attribution = updates.attribution;
        }
        if ('is_crux' in updates)            patched.is_crux           = updates.is_crux === true;
        if ('confidence' in updates)         patched.confidence        = assertValidConfidence(updates.confidence);
        if ('claimant_entity_id' in updates) patched.claimant_entity_id = updates.claimant_entity_id || null;
        if ('subject_entity_ids' in updates) patched.subject_entity_ids = Array.isArray(updates.subject_entity_ids) ? updates.subject_entity_ids.slice() : [];
        if ('subject_text' in updates)       patched.subject_text       = updates.subject_text || '';
        if ('object_entity_ids' in updates)  patched.object_entity_ids  = Array.isArray(updates.object_entity_ids)  ? updates.object_entity_ids.slice()  : [];
        if ('object_text' in updates)        patched.object_text        = updates.object_text || '';
        if ('predicate' in updates)          patched.predicate          = updates.predicate || '';
        if ('quote_date' in updates)         patched.quote_date         = updates.quote_date || null;
        if ('context' in updates)            patched.context            = updates.context || '';

        patched.updated = Math.floor(Date.now() / 1000);
        all[id] = patched;
        await Storage.set('article_claims', all);
        return patched;
    },

    /**
     * Delete a claim. Any evidence links that reference it should be
     * orphan-cleaned in Phase 5 C4's `EvidenceLinker.deleteForClaim`;
     * not our concern here.
     */
    delete: async (id) => {
        const all = await Storage.get('article_claims', {});
        if (!all[id]) return false;
        delete all[id];
        await Storage.set('article_claims', all);
        return true;
    },

    /**
     * Record a successful kind-30040 publish so `resolveClaimsToPublish`
     * on the reader side can skip unchanged claims. Matches
     * `EntityModel.markPublished` semantics: does NOT bump `updated`,
     * so the user's edits after a publish correctly re-emit next time.
     */
    markPublished: async (id, eventId) => {
        const all = await Storage.get('article_claims', {});
        const record = all[id];
        if (!record) return null;
        record.publishedAt = Math.floor(Date.now() / 1000);
        if (eventId) record.publishedEventId = eventId;
        all[id] = record;
        await Storage.set('article_claims', all);
        return record;
    }
};

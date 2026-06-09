// Claim model — thin, entity-centric claim (Phase 10.1).
//
// See docs/CLAIMS_REDESIGN.md. A claim is now just:
//
//   - text       — the assertion (required; immutable after creation)
//   - about[]    — the entity ids the claim concerns (the queryable core)
//   - source     — who asserts it: null = "the article/author", else an
//                  entity id or free-text name (absorbs the old
//                  attribution + claimant)
//   - is_key     — a single ⭐ flag (replaces crux + the 0–100 confidence)
//   - anchor     — optional W3C text-range selector (wired in slice 10.3)
//   - source_url + context — unchanged
//
// The old structured fields (type / confidence / attribution / predicate /
// subject / object / claimant / quote_date) are gone from the capture UX.
//
// TRANSITIONAL MIRROR: until slice 10.2 rewrites `buildClaimEvent` to read
// the thin fields directly, `create`/`update` also populate the legacy
// fields the unchanged event-builder + reader publish flow read:
//   subject_entity_ids ← about, claimant_entity_id ← source (when an
//   entity), is_crux ← is_key, type ← 'factual', attribution ← 'editorial'.
// `normalizeClaim` does the inverse for records written before this slice,
// so old claims render in the thin UI. Both go away in 10.2.
//
// Storage: Storage.get('article_claims', {}) keyed by claim id (unchanged).

import { Storage } from './storage.js';
import { Crypto } from './crypto.js';
import { Utils } from './utils.js';

// ------------------------------------------------------------------
// Enums — retained for rendering legacy + foreign (others') claims that
// still carry a type/attribution. The thin model does not require them.
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
// ID derivation (unchanged — keeps published-event ids stable)
// ------------------------------------------------------------------

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

function assertValidText(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) throw new Error('Claim text is required');
    if (trimmed.length > 2000) throw new Error('Claim text too long (max 2000 chars)');
    return trimmed;
}

function assertValidUrl(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed) throw new Error('source_url is required');
    return trimmed;
}

function isEntityId(s) {
    return typeof s === 'string' && /^entity_/.test(s);
}

function cleanAbout(about) {
    if (!Array.isArray(about)) return [];
    // Keep unique, non-empty entity ids only.
    return [...new Set(about.filter((id) => typeof id === 'string' && id))];
}

// Derive the transitional legacy mirror from the thin fields, so the
// (as-yet-unchanged) event-builder + publish flow keep working.
function legacyMirror(about, source, isKey) {
    return {
        subject_entity_ids: about.slice(),
        object_entity_ids:  [],
        subject_text:       '',
        object_text:        '',
        claimant_entity_id: isEntityId(source) ? source : null,
        predicate:          '',
        is_crux:            isKey,
        confidence:         null,
        type:               'factual',
        attribution:        'editorial',
        quote_date:         null
    };
}

// Backfill thin fields for records written before slice 10.1, so old
// claims render in the thin UI. Non-destructive (read-time only).
function normalizeClaim(record) {
    if (!record) return record;
    if ('about' in record && 'is_key' in record && 'source' in record) return record;
    const about = cleanAbout(
        Array.isArray(record.about)
            ? record.about
            : [...(record.subject_entity_ids || []), ...(record.object_entity_ids || [])]
    );
    const source = ('source' in record)
        ? record.source
        : (record.claimant_entity_id || null);
    const isKey = ('is_key' in record) ? record.is_key === true : record.is_crux === true;
    return { ...record, about, source, is_key: isKey };
}

// ------------------------------------------------------------------
// CRUD
// ------------------------------------------------------------------

export const ClaimModel = {
    get: async (id) => {
        if (!id) return null;
        const all = await Storage.get('article_claims', {});
        return all[id] ? normalizeClaim(all[id]) : null;
    },

    getAll: async () => {
        const all = await Storage.get('article_claims', {});
        const out = {};
        for (const [id, rec] of Object.entries(all)) out[id] = normalizeClaim(rec);
        return out;
    },

    /**
     * All claims for a URL, key claims first then by creation time.
     */
    getBySourceUrl: async (url) => {
        if (!url) return [];
        const all = await Storage.get('article_claims', {});
        const out = [];
        for (const claim of Object.values(all)) {
            if (claim.source_url === url) out.push(normalizeClaim(claim));
        }
        out.sort((a, b) => (b.is_key ? 1 : 0) - (a.is_key ? 1 : 0)   // key claims first
                          || (a.created || 0) - (b.created || 0));   // then by creation
        return out;
    },

    /**
     * Create a thin claim. Required: `text`, `source_url`.
     * Optional: `about` (entity id[]), `source` (entity id | free text |
     * null), `is_key` (bool), `anchor`, `context`. Idempotent on
     * (source_url, normalized text).
     */
    create: async (fields) => {
        const text = assertValidText(fields.text);
        const sourceUrl = assertValidUrl(fields.source_url);

        const id = await generateClaimId(sourceUrl, text);
        const all = await Storage.get('article_claims', {});
        if (all[id]) return normalizeClaim(all[id]);   // idempotent

        const about = cleanAbout(fields.about);
        const source = fields.source != null && String(fields.source).trim() !== ''
            ? (isEntityId(fields.source) ? fields.source : String(fields.source).trim())
            : null;
        const isKey = fields.is_key === true;

        const now = Math.floor(Date.now() / 1000);
        const record = {
            id,
            text,
            about,
            source,
            is_key:           isKey,
            anchor:           fields.anchor || null,
            source_url:       sourceUrl,
            context:          fields.context || '',
            ...legacyMirror(about, source, isKey),   // transitional — removed in 10.2
            created:          now,
            updated:          now,
            publishedAt:      null,
            publishedEventId: null
        };

        all[id] = record;
        await Storage.set('article_claims', all);
        Utils.log('Created claim:', id, text.slice(0, 60));
        return record;
    },

    /**
     * Patch a claim. id / source_url / text are IMMUTABLE (they derive
     * the id). Patchable: about, source, is_key, anchor, context.
     */
    update: async (id, updates) => {
        const all = await Storage.get('article_claims', {});
        const record = all[id];
        if (!record) throw new Error(`Claim not found: ${id}`);

        const patched = normalizeClaim({ ...record });
        if ('about' in updates)   patched.about   = cleanAbout(updates.about);
        if ('source' in updates) {
            patched.source = updates.source != null && String(updates.source).trim() !== ''
                ? (isEntityId(updates.source) ? updates.source : String(updates.source).trim())
                : null;
        }
        if ('is_key' in updates)  patched.is_key  = updates.is_key === true;
        if ('anchor' in updates)  patched.anchor  = updates.anchor || null;
        if ('context' in updates) patched.context = updates.context || '';

        // Re-derive the transitional legacy mirror from the patched thin fields.
        Object.assign(patched, legacyMirror(patched.about, patched.source, patched.is_key));

        patched.updated = Math.floor(Date.now() / 1000);
        all[id] = patched;
        await Storage.set('article_claims', all);
        return patched;
    },

    delete: async (id) => {
        const all = await Storage.get('article_claims', {});
        if (!all[id]) return false;
        delete all[id];
        await Storage.set('article_claims', all);
        return true;
    },

    /**
     * Record a successful kind-30040 publish. Does NOT bump `updated`,
     * so edits after a publish correctly re-emit next time.
     */
    markPublished: async (id, eventId) => {
        const all = await Storage.get('article_claims', {});
        const record = all[id];
        if (!record) return null;
        record.publishedAt = Math.floor(Date.now() / 1000);
        if (eventId) record.publishedEventId = eventId;
        all[id] = record;
        await Storage.set('article_claims', all);
        return normalizeClaim(record);
    }
};

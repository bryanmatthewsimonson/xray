// Jurisdiction registry — Phase 16.1
// (docs/MORAL_LENS_JURISDICTION_DESIGN.md §4, §5.3, §9 Q1, §10).
//
// A jurisdiction is a named perspective a lens-reading is grounded in:
// `codified` (a legal code), `worldview` (a tradition, pluralism
// encoded), or `persona` (an author's corpus). Jurisdictions live in a
// LOCAL registry — a single chrome.storage.local key holding an
// id→record map, the Storage.platformAccounts registry precedent. They
// are registry-primary: no entity record, no keypair, no kind-0
// exposure ("Christianity" and "US federal law" must not inherit the
// entity machinery). `entity_id` is optional and PERSONA-ONLY, a dedup
// link to an existing person entity.
//
// An authority is a bibliographic citation record inside `corpus[]`:
// `{ citation: { work, edition?, isbn?, locator, tradition?, language? },
//    excerpt, admissibility, claim_id?, anchor? }`. The citation is the
// general case; a captured claim + W3C anchor is the web-only
// specialization. Corpus rows are NEVER bound via `claim.about[]` —
// that would sweep lens-layer artifacts into truth/entity/case
// surfaces (§4).
//
// Quoting discipline (§10): the per-authority `excerpt` is capped at
// 500 characters (the anchor-capture EXACT_LENGTH_CAP precedent) and
// over-cap input is REJECTED at create with a clear error — an
// authority quote is never silently truncated. Corpora share the
// ~10 MB chrome.storage.local quota, so the cap is load-bearing.
//
// Living-person guardrail (§9 Q1, fail-closed): for a persona,
// `is_living_person` absent/unknown is TREATED AS LIVING; a living
// persona's admissible corpus is the editorially published subset
// only (social captures excluded). The pre-flight refusal that
// consumes these predicates lives in lens-engine.js (16.2).
//
// Zero built-in jurisdictions ship (§9 Q3) — the Appendix A templates
// are docs + test fixtures only.
//
// Storage: Storage.get('lens_jurisdictions', {}) — the house
// single-key id→record map. The key is listed in WORKSPACE_CLEAR_KEYS
// (identity-profiles.js) so workspace backup/reset covers it.

import { Storage } from './storage.js';
import { Crypto } from './crypto.js';
import { Utils } from './utils.js';
import { ClaimModel } from './claim-model.js';
import { EntityModel } from './entity-model.js';
import {
    JURISDICTION_TYPES, isValidJurisdictionType,
    ADMISSIBILITIES, isValidAdmissibility, isAdmissibleForLivingPersona
} from './lens-taxonomy.js';

const JURISDICTIONS_KEY = 'lens_jurisdictions';

// §10 — the anchor-capture EXACT_LENGTH_CAP precedent.
export const AUTHORITY_EXCERPT_CAP = 500;

// Registry ids are human-readable slugs (the §7 examples use
// "bell-hooks"), same grammar as assessment labels minus the
// namespace segment.
const JURISDICTION_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const JURISDICTION_ID_MAX = 64;

// ------------------------------------------------------------------
// ID derivation
// ------------------------------------------------------------------

/** Slugify a display name into a registry id ('bell hooks' → 'bell-hooks'). */
export function slugifyJurisdictionId(name) {
    return String(name || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')   // strip diacritics
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, JURISDICTION_ID_MAX);
}

/**
 * Deterministic authority id from the citation + excerpt, so re-adding
 * the same authority converges on the same row (idempotent within a
 * corpus). Exported for tests.
 */
export async function generateAuthorityId(citation, excerpt) {
    const c = citation || {};
    const hash = await Crypto.sha256(
        `${c.work || ''}|${c.edition || ''}|${c.locator || ''}|${excerpt || ''}`);
    return `auth_${hash.slice(0, 16)}`;
}

// ------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------

function assertValidType(value) {
    if (!isValidJurisdictionType(value)) {
        throw new Error(`Invalid jurisdiction_type: ${value} (expected one of ${JURISDICTION_TYPES.join(', ')})`);
    }
    return value;
}

function cleanId(given, displayName) {
    const id = String(given || '').trim() || slugifyJurisdictionId(displayName);
    if (!id) throw new Error('A jurisdiction needs an id (or a display_name it can be derived from)');
    if (id.length > JURISDICTION_ID_MAX || !JURISDICTION_ID_RE.test(id)) {
        throw new Error(`Invalid jurisdiction id: ${id} (lowercase-hyphenated, ≤${JURISDICTION_ID_MAX} chars)`);
    }
    return id;
}

/**
 * Living-person tri-state for personas: true / false / null (unknown —
 * treated as living, §9 Q1 fail-closed). Non-personas store null; the
 * guardrail never applies to them.
 */
function cleanIsLivingPerson(value, jurisdictionType) {
    if (jurisdictionType !== 'persona') return null;
    if (value === true || value === false) return value;
    return null;   // absent/unknown — treatAsLiving() reads this as living
}

function cleanInternalDivisions(value) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error('internal_divisions must be an array of strings');
    return value.map((d) => {
        const s = String(d || '').trim();
        if (!s) throw new Error('internal_divisions entries must be non-empty strings');
        return s;
    });
}

/**
 * The §5.3 curation disclosure, self-attested by the curator: who
 * selected the authorities, from what candidate pool, on what basis.
 * All optional — absence renders as "not stated", which is itself a
 * disclosure.
 */
function cleanCorpusProvenance(value) {
    const given = value || {};
    const field = (v) => {
        const s = String(v || '').trim();
        return s || null;
    };
    return {
        curated_by:      field(given.curated_by),
        candidate_pool:  field(given.candidate_pool),
        selection_basis: field(given.selection_basis)
    };
}

async function cleanAuthority(input) {
    const given = input || {};
    const citation = given.citation || {};

    const work = String(citation.work || '').trim();
    if (!work) throw new Error('authority.citation.work is required — authorities are cited, not vibes');
    const locator = String(citation.locator || '').trim();
    if (!locator) throw new Error('authority.citation.locator is required — cite by locator (§10)');

    const excerpt = String(given.excerpt || '').trim();
    if (!excerpt) {
        throw new Error('authority.excerpt is required — the stored verbatim text is what grounds a reading (A.1 principle 1)');
    }
    if (excerpt.length > AUTHORITY_EXCERPT_CAP) {
        throw new Error(`authority.excerpt exceeds ${AUTHORITY_EXCERPT_CAP} characters (${excerpt.length}) — `
            + 'split it across multiple authorities or cite by locator + paraphrase; '
            + 'an authority quote is never silently truncated (§10)');
    }

    const admissibility = given.admissibility;
    if (!isValidAdmissibility(admissibility)) {
        throw new Error(`Invalid admissibility: ${admissibility} (expected one of ${ADMISSIBILITIES.join(', ')})`);
    }

    // Web-only specialization: a captured claim (+ optional W3C anchor).
    let claimId = null;
    if (given.claim_id !== undefined && given.claim_id !== null && given.claim_id !== '') {
        claimId = String(given.claim_id).trim();
        const claim = await ClaimModel.get(claimId);
        if (!claim) throw new Error(`Claim not found: ${claimId} — an authority may only reference an existing capture`);
    }
    let anchor = null;
    if (given.anchor !== undefined && given.anchor !== null) {
        if (!claimId) throw new Error('authority.anchor requires claim_id — the anchor is the web-capture specialization');
        if (!Array.isArray(given.anchor)) throw new Error('authority.anchor must be a W3C selector array');
        anchor = given.anchor;
    }

    const cleanCitation = {
        work,
        edition:   citation.edition ? String(citation.edition).trim() : null,
        isbn:      citation.isbn ? String(citation.isbn).trim() : null,
        locator,
        tradition: citation.tradition ? String(citation.tradition).trim() : null,
        language:  citation.language ? String(citation.language).trim() : null
    };

    return {
        authority_id: await generateAuthorityId(cleanCitation, excerpt),
        citation:     cleanCitation,
        excerpt,
        admissibility,
        claim_id:     claimId,
        anchor
    };
}

async function cleanCorpus(value) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error('corpus must be an array of authority records');
    const out = [];
    const seen = new Set();
    for (const row of value) {
        const authority = await cleanAuthority(row);
        if (seen.has(authority.authority_id)) continue;   // identical row — converge
        seen.add(authority.authority_id);
        out.push(authority);
    }
    return out;
}

async function cleanEntityId(value, jurisdictionType) {
    if (value === undefined || value === null || value === '') return null;
    if (jurisdictionType !== 'persona') {
        throw new Error('entity_id is persona-only (§4) — codified/worldview jurisdictions get no entity record in v1');
    }
    const entityId = String(value).trim();
    const entity = await EntityModel.get(entityId);
    if (!entity) throw new Error(`Entity not found: ${entityId} — link an existing person entity or omit entity_id`);
    return entityId;
}

// ------------------------------------------------------------------
// Guardrail predicates (consumed by the 16.2 pre-flight)
// ------------------------------------------------------------------

/**
 * Is this jurisdiction subject to the living-person guardrail? True
 * for a persona whose `is_living_person` is anything but an explicit
 * `false` — absence/unknown FAILS CLOSED (§9 Q1). Never true for
 * codified/worldview jurisdictions.
 */
export function treatAsLiving(jurisdiction) {
    const j = jurisdiction || {};
    return j.jurisdiction_type === 'persona' && j.is_living_person !== false;
}

/**
 * The corpus rows a lens pass may actually load for this jurisdiction:
 * everything for a non-living jurisdiction; only editorially published
 * authorities for a (treated-as-)living persona (§9 Q1).
 */
export function admissibleAuthorities(jurisdiction) {
    const corpus = (jurisdiction && Array.isArray(jurisdiction.corpus)) ? jurisdiction.corpus : [];
    if (!treatAsLiving(jurisdiction)) return corpus.slice();
    return corpus.filter((a) => a && isAdmissibleForLivingPersona(a.admissibility));
}

// ------------------------------------------------------------------
// Read-time backfill (the normalizeClaim idiom) — defensive defaults
// for records written by earlier/foreign code paths. Non-destructive.
// ------------------------------------------------------------------

function normalizeJurisdiction(record) {
    if (!record) return record;
    return {
        ...record,
        is_living_person:   record.jurisdiction_type === 'persona'
            ? (record.is_living_person === true || record.is_living_person === false
                ? record.is_living_person : null)
            : null,
        internal_divisions: Array.isArray(record.internal_divisions) ? record.internal_divisions : [],
        corpus:             Array.isArray(record.corpus) ? record.corpus : [],
        corpus_provenance:  cleanCorpusProvenance(record.corpus_provenance),
        entity_id:          record.entity_id || null
    };
}

// ------------------------------------------------------------------
// CRUD
// ------------------------------------------------------------------

export const JurisdictionModel = {
    get: async (id) => {
        if (!id) return null;
        const all = await Storage.get(JURISDICTIONS_KEY, {});
        return all[id] ? normalizeJurisdiction(all[id]) : null;
    },

    /** Every jurisdiction, sorted by creation time. */
    list: async () => {
        const all = await Storage.get(JURISDICTIONS_KEY, {});
        const out = Object.values(all).map(normalizeJurisdiction);
        out.sort((a, b) => (a.created || 0) - (b.created || 0));
        return out;
    },

    /**
     * Author a jurisdiction. Required: `jurisdiction_type` and
     * `display_name`. Optional: `id` (defaults to a slug of the
     * display name; must be unique), `is_living_person` (persona-only
     * tri-state; absent = unknown = treated as living),
     * `internal_divisions`, `corpus` (validated per-authority),
     * `corpus_provenance` (§5.3 self-attested disclosure), `entity_id`
     * (persona-only).
     */
    create: async (fields) => {
        const given = fields || {};

        const jurisdictionType = assertValidType(given.jurisdiction_type);
        const displayName = String(given.display_name || '').trim();
        if (!displayName) throw new Error('display_name is required — a lens must be nameable');

        const id = cleanId(given.id, displayName);
        const all = await Storage.get(JURISDICTIONS_KEY, {});
        if (all[id]) {
            throw new Error(`Jurisdiction already exists: ${id} — pass a distinct id or update the existing record`);
        }

        const record = {
            id,
            jurisdiction_type:  jurisdictionType,
            display_name:       displayName,
            is_living_person:   cleanIsLivingPerson(given.is_living_person, jurisdictionType),
            internal_divisions: cleanInternalDivisions(given.internal_divisions),
            corpus:             await cleanCorpus(given.corpus),
            corpus_provenance:  cleanCorpusProvenance(given.corpus_provenance),
            entity_id:          await cleanEntityId(given.entity_id, jurisdictionType),
            created:            Math.floor(Date.now() / 1000),
            updated:            Math.floor(Date.now() / 1000)
        };
        all[id] = record;
        await Storage.set(JURISDICTIONS_KEY, all);
        Utils.log('Created jurisdiction:', id, jurisdictionType,
            `(${record.corpus.length} authorities)`);
        return record;
    },

    /**
     * Patch a jurisdiction. `id` and `jurisdiction_type` are IMMUTABLE
     * (retyping changes the guardrail semantics — delete and recreate).
     * Patchable: display_name, is_living_person, internal_divisions,
     * corpus (wholesale, revalidated), corpus_provenance, entity_id.
     */
    update: async (id, updates) => {
        const all = await Storage.get(JURISDICTIONS_KEY, {});
        const record = all[id];
        if (!record) throw new Error(`Jurisdiction not found: ${id}`);
        const given = updates || {};

        if ('id' in given || 'jurisdiction_type' in given) {
            throw new Error('id and jurisdiction_type are immutable — delete and recreate to retype');
        }

        const patched = normalizeJurisdiction(record);
        if ('display_name' in given) {
            const name = String(given.display_name || '').trim();
            if (!name) throw new Error('display_name cannot be emptied');
            patched.display_name = name;
        }
        if ('is_living_person' in given) {
            patched.is_living_person = cleanIsLivingPerson(given.is_living_person, record.jurisdiction_type);
        }
        if ('internal_divisions' in given) {
            patched.internal_divisions = cleanInternalDivisions(given.internal_divisions);
        }
        if ('corpus' in given) {
            patched.corpus = await cleanCorpus(given.corpus);
        }
        if ('corpus_provenance' in given) {
            patched.corpus_provenance = cleanCorpusProvenance(given.corpus_provenance);
        }
        if ('entity_id' in given) {
            patched.entity_id = await cleanEntityId(given.entity_id, record.jurisdiction_type);
        }

        patched.updated = Math.floor(Date.now() / 1000);
        all[id] = patched;
        await Storage.set(JURISDICTIONS_KEY, all);
        return patched;
    },

    delete: async (id) => {
        const all = await Storage.get(JURISDICTIONS_KEY, {});
        if (!all[id]) return false;
        delete all[id];
        await Storage.set(JURISDICTIONS_KEY, all);
        return true;
    },

    /**
     * Add one authority to a jurisdiction's corpus. Idempotent on the
     * derived authority_id (identical citation + excerpt converge).
     * Returns the authority record.
     */
    addAuthority: async (jurisdictionId, authorityInput) => {
        const all = await Storage.get(JURISDICTIONS_KEY, {});
        const record = all[jurisdictionId];
        if (!record) throw new Error(`Jurisdiction not found: ${jurisdictionId}`);

        const authority = await cleanAuthority(authorityInput);
        const corpus = Array.isArray(record.corpus) ? record.corpus : [];
        const existing = corpus.find((a) => a && a.authority_id === authority.authority_id);
        if (existing) return existing;   // idempotent

        record.corpus = [...corpus, authority];
        record.updated = Math.floor(Date.now() / 1000);
        all[jurisdictionId] = record;
        await Storage.set(JURISDICTIONS_KEY, all);
        Utils.log('Added authority to jurisdiction:', jurisdictionId, authority.authority_id);
        return authority;
    },

    removeAuthority: async (jurisdictionId, authorityId) => {
        const all = await Storage.get(JURISDICTIONS_KEY, {});
        const record = all[jurisdictionId];
        if (!record) throw new Error(`Jurisdiction not found: ${jurisdictionId}`);
        const corpus = Array.isArray(record.corpus) ? record.corpus : [];
        const next = corpus.filter((a) => !a || a.authority_id !== authorityId);
        if (next.length === corpus.length) return false;
        record.corpus = next;
        record.updated = Math.floor(Date.now() / 1000);
        all[jurisdictionId] = record;
        await Storage.set(JURISDICTIONS_KEY, all);
        return true;
    }
};

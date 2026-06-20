// Forensic finding model — Phase 14.1 (docs/CRIMINOLOGY_DESIGN.md).
//
// A BehavioralFinding names a MANEUVER a subject performs around the
// truth — an evasion, an immunizing defense, a self-serving revision —
// and binds it to evidence. It is the companion to the Phase 11
// assessment: where an assessment grades whether a CLAIM is true, a
// finding describes what a SUBJECT is doing, and renders no verdict on
// honesty or intent.
//
// The six methodology rules (CRIMINOLOGY_DESIGN.md) are enforced here,
// not just documented:
//   1. Structure, not intent — there is NO lying/intent/confidence field.
//   2. Evidence-bound       — at least one anchor (with a quote) is required.
//   6. Falsifiability       — a non-empty `counter_note` is required.
// `basis` (quoted | paraphrased | behavioral-cue | structural-inference)
// records HOW WE KNOW, in place of a numeric score.
//
// The id hashes (subject | maneuver | anchors), so create() is
// idempotent — re-recording the same maneuver against the same subject
// with the same evidence returns the existing record.
//
// Storage: Storage.get('behavioral_findings', {}) keyed by finding id —
// the same single-key id→record map as 'claim_assessments'. Baselines
// live under 'forensic_baselines'. Wire mapping (kind 30062) lands in
// slice 14.3; publishing is gated behind the `forensicPublishing` flag.

import { Storage } from './storage.js';
import { Crypto } from './crypto.js';
import { Utils } from './utils.js';
import { normalize as normalizeUrl } from './metadata/url-normalizer.js';
import {
    isValidManeuver, isValidRole, isValidBasis, isValidSuggestedBy
} from './forensic-taxonomy.js';

const FINDINGS_KEY  = 'behavioral_findings';
const BASELINES_KEY = 'forensic_baselines';

const FORENSIC_NAMESPACE = 'xray/forensic';
const COUNTER_HEADING = '### Counter-read';

// ------------------------------------------------------------------
// Wire read-back (Phase 14.3)
// ------------------------------------------------------------------

/**
 * Inverse of metadata/builders.js `buildBehavioralFindingEvent` —
 * reconstruct a finding from a kind-30062 event, for the portal's
 * read-back path. Pure and defensive (the parseAssessmentEvent style):
 * returns null for a wrong-kind event or one with no maneuver (the
 * structural minimum). `note`/`counter_note` split on the LAST
 * `### Counter-read` heading in content; `maneuver-step` tags are read
 * in their declared index order.
 */
export function parseBehavioralFindingEvent(event) {
    if (!event || event.kind !== 30062) return null;
    const tags = event.tags || [];
    const first = (name) => { const t = tags.find((x) => x[0] === name); return t ? t[1] : ''; };

    const lTag = tags.find((x) => x[0] === 'l' && x[2] === FORENSIC_NAMESPACE);
    const maneuver = lTag ? lTag[1] : '';
    if (!maneuver) return null;

    const subjectP = tags.find((x) => x[0] === 'p' && x[3] === 'subject')
        || tags.find((x) => x[0] === 'p');

    const anchors = tags
        .filter((x) => x[0] === 'maneuver-step')
        .sort((a, b) => (Number(a[1]) || 0) - (Number(b[1]) || 0))
        .map((x) => {
            let selector = null;
            if (x[3]) { try { selector = JSON.parse(x[3]); } catch (_) { /* stays null */ } }
            const ts = x[4] !== undefined && x[4] !== '' ? Number(x[4]) : null;
            return { quote: x[2] || '', selector, timestamp: Number.isFinite(ts) ? ts : null };
        });

    const content = event.content || '';
    const idx = content.lastIndexOf(COUNTER_HEADING);
    let note = content, counterNote = '';
    if (idx >= 0) {
        note = content.slice(0, idx).trim();
        counterNote = content.slice(idx + COUNTER_HEADING.length).trim();
    }

    const relA = tags.find((x) => x[0] === 'a' && /^30055:/.test(x[1] || ''));
    return {
        id:                 first('d') || event.id || '',
        subjectPubkey:      (subjectP && subjectP[1]) || null,
        maneuver,
        role:               first('role') || null,
        anchors,
        note,
        counterNote,
        basis:              first('basis') || null,
        url:                first('r') || null,
        relationshipCoord:  (relA && relA[1]) || null,
        suggestedBy:        first('suggested-by') || 'user',
        pubkey:             event.pubkey || '',
        created_at:         event.created_at || 0,
        eventId:            event.id || null
    };
}

// ------------------------------------------------------------------
// Subject ref + canonical key
// ------------------------------------------------------------------

/**
 * The stable string a subject answers to, for id derivation and
 * lookup. Prefers the most durable identifier present: a resolved
 * identity id, then a pubkey, then a platform account handle, then the
 * display label as a last resort. Mirrors the claim-ref "one logical
 * thing ⇒ one canonical key" idea without needing the relay round-trip.
 */
export function subjectRefKey(ref) {
    const r = ref || {};
    const pick = r.identity_id || r.pubkey || r.account || r.label || '';
    return String(pick).trim().toLowerCase();
}

function cleanSubjectRef(input) {
    const r = input || {};
    const identity_id = r.identity_id ? String(r.identity_id) : null;
    const pubkey      = (typeof r.pubkey === 'string' && /^[0-9a-f]{64}$/.test(r.pubkey)) ? r.pubkey : null;
    const account     = r.account ? String(r.account) : null;
    const label       = String(r.label || '').trim();
    if (!identity_id && !pubkey && !account && !label) {
        throw new Error('subject_ref needs one of identity_id / pubkey / account / label');
    }
    return { identity_id, pubkey, account, label };
}

// ------------------------------------------------------------------
// Anchors (the evidence chain)
// ------------------------------------------------------------------

/**
 * Normalize the ordered evidence chain. At least one anchor is
 * required, and each anchor must carry a non-empty `quote` — a finding
 * with no quotable evidence cannot be saved (Rule 2). `selector` is
 * optional (tests and not-yet-anchored captures may omit it); the
 * source URL is stored normalized + verbatim like the assessment URL
 * rule.
 */
function cleanAnchors(anchors) {
    if (!Array.isArray(anchors) || anchors.length === 0) {
        throw new Error('A finding needs at least one evidence anchor');
    }
    return anchors.map((a, i) => {
        const rec = a || {};
        const quote = String(rec.quote || '').trim();
        if (!quote) throw new Error(`Anchor ${i} needs a non-empty quote`);
        const src = rec.source_ref || {};
        const rawUrl = src.url ? String(src.url) : '';
        const source_ref = (src && (src.url || src.coord || src.event_id || src.title)) ? {
            url:      rawUrl ? normalizeUrl(rawUrl) : '',
            url_raw:  src.url_raw || rawUrl,
            title:    src.title || null,
            coord:    src.coord || null,
            event_id: src.event_id || null
        } : null;
        const ts = (rec.timestamp === 0 || rec.timestamp)
            ? Number(rec.timestamp) : null;
        return {
            selector:  rec.selector || null,
            quote,
            source_ref,
            timestamp: Number.isFinite(ts) ? ts : null,
            step_note: rec.step_note ? String(rec.step_note) : ''
        };
    });
}

async function anchorsHash(anchors) {
    // Stable over the load-bearing parts only (selector + quote + ts),
    // so an edited step-note doesn't fork the id.
    const key = JSON.stringify(anchors.map((a) => [a.selector, a.quote, a.timestamp]));
    return await Crypto.sha256(key);
}

// ------------------------------------------------------------------
// ID derivation
// ------------------------------------------------------------------

/**
 * Deterministic id from (subjectKey | maneuver | anchorsHash). NOTE:
 * this is the LOCAL id; the kind-30062 wire d-tag hashes the subject
 * ref + maneuver + anchors at publish time (slice 14.3) — local ids
 * never hit the wire.
 */
export async function generateFindingId(subjectKey, maneuver, anchors) {
    const ah = await anchorsHash(anchors);
    const hash = await Crypto.sha256(`${subjectKey}|${maneuver}|${ah}`);
    return `find_${hash.slice(0, 16)}`;
}

// ------------------------------------------------------------------
// Validation helpers
// ------------------------------------------------------------------

function assertValidManeuver(maneuver) {
    if (!isValidManeuver(maneuver)) throw new Error(`Invalid maneuver: ${maneuver}`);
    return maneuver;
}

function assertValidRole(role) {
    if (!isValidRole(role)) throw new Error(`Invalid role: ${role}`);
    return role;
}

function assertValidBasis(basis) {
    const v = basis || 'structural-inference';
    if (!isValidBasis(v)) throw new Error(`Invalid basis: ${v}`);
    return v;
}

function assertValidSuggestedBy(value) {
    const v = value === undefined || value === null ? 'user' : value;
    if (!isValidSuggestedBy(v)) {
        throw new Error(`Invalid suggested_by: ${v} (expected 'user' or 'llm:<model>')`);
    }
    return v;
}

function assertCounterNote(value) {
    const v = String(value || '').trim();
    // Rule 6 — the falsifiability discipline. A finding that implicates a
    // subject cannot be saved without the alternative reading.
    if (!v) throw new Error('A finding needs a counter_note (the alternative reading)');
    return v;
}

// ------------------------------------------------------------------
// CRUD — findings
// ------------------------------------------------------------------

export const ForensicModel = {
    get: async (id) => {
        if (!id) return null;
        const all = await Storage.get(FINDINGS_KEY, {});
        return all[id] || null;
    },

    getAll: async () => {
        return await Storage.get(FINDINGS_KEY, {});
    },

    /** Every finding about a subject, matched on the canonical subject key. */
    getForSubject: async (ref) => {
        const key = subjectRefKey(ref);
        if (!key) return [];
        const all = await Storage.get(FINDINGS_KEY, {});
        const out = Object.values(all).filter((f) => subjectRefKey(f.subject_ref) === key);
        out.sort((a, b) => (a.created || 0) - (b.created || 0));
        return out;
    },

    /**
     * Create a finding. Required: `subject_ref` (one durable id +
     * label), `role`, `maneuver`, a non-empty `anchors` chain, and a
     * `counter_note`. No stance, no score, no intent field exists to
     * supply. Idempotent on (subject, maneuver, anchors).
     */
    create: async (fields) => {
        const given = fields || {};
        const subject_ref = cleanSubjectRef(given.subject_ref);
        const role        = assertValidRole(given.role);
        const maneuver    = assertValidManeuver(given.maneuver);
        const anchors     = cleanAnchors(given.anchors);
        const counter_note = assertCounterNote(given.counter_note);
        const basis       = assertValidBasis(given.basis);
        const suggested_by = assertValidSuggestedBy(given.suggested_by);

        const id = await generateFindingId(subjectRefKey(subject_ref), maneuver, anchors);
        const all = await Storage.get(FINDINGS_KEY, {});
        if (all[id]) return all[id];   // idempotent

        const now = Math.floor(Date.now() / 1000);
        const record = {
            id,
            subject_ref,
            role,
            maneuver,
            anchors,
            baseline_ref: given.baseline_ref ? String(given.baseline_ref) : null,
            note:         String(given.note || ''),
            counter_note,
            basis,
            related_rel:  given.related_rel ? String(given.related_rel) : null,
            suggested_by,
            created:          now,
            updated:          now,
            publishedAt:      null,
            publishedEventId: null,
            publishedPubkey:  null
        };
        all[id] = record;
        await Storage.set(FINDINGS_KEY, all);
        Utils.log('Created forensic finding:', id, maneuver);
        return record;
    },

    /**
     * Patch a finding. `subject_ref` / `maneuver` / `anchors` are
     * IMMUTABLE — they derive the id; to change them, delete + recreate.
     * Patchable: role, note, counter_note (still required non-empty),
     * basis, baseline_ref, related_rel, suggested_by.
     */
    update: async (id, updates) => {
        const all = await Storage.get(FINDINGS_KEY, {});
        const record = all[id];
        if (!record) throw new Error(`Finding not found: ${id}`);
        const patched = { ...record };
        if ('role' in updates)         patched.role = assertValidRole(updates.role);
        if ('note' in updates)         patched.note = String(updates.note || '');
        if ('counter_note' in updates) patched.counter_note = assertCounterNote(updates.counter_note);
        if ('basis' in updates)        patched.basis = assertValidBasis(updates.basis);
        if ('baseline_ref' in updates) patched.baseline_ref = updates.baseline_ref ? String(updates.baseline_ref) : null;
        if ('related_rel' in updates)  patched.related_rel = updates.related_rel ? String(updates.related_rel) : null;
        if ('suggested_by' in updates) patched.suggested_by = assertValidSuggestedBy(updates.suggested_by);
        patched.updated = Math.floor(Date.now() / 1000);
        all[id] = patched;
        await Storage.set(FINDINGS_KEY, all);
        return patched;
    },

    delete: async (id) => {
        const all = await Storage.get(FINDINGS_KEY, {});
        if (!all[id]) return false;
        delete all[id];
        await Storage.set(FINDINGS_KEY, all);
        return true;
    },

    /**
     * Record a successful kind-30062 publish. Does NOT bump `updated`,
     * so edits after a publish correctly re-emit next time.
     */
    markPublished: async (id, eventId, pubkey, dTag) => {
        const all = await Storage.get(FINDINGS_KEY, {});
        const record = all[id];
        if (!record) return null;
        record.publishedAt = Math.floor(Date.now() / 1000);
        if (eventId) record.publishedEventId = eventId;
        if (pubkey)  record.publishedPubkey = pubkey;
        // The wire d-tag (find:<sha16…>) — recorded so the portal can
        // rebuild the 30062 coordinate for reconciliation without
        // re-deriving the anchors hash.
        if (dTag) record.publishedDTag = dTag;
        all[id] = record;
        await Storage.set(FINDINGS_KEY, all);
        return record;
    },

    /**
     * Record a successful kind-1985 maneuver-mirror publish. Tracked
     * SEPARATELY from `publishedAt` (kind 1985 is non-replaceable), so a
     * rejected mirror retries while its 30062 stays published. Does not
     * bump `updated`.
     */
    markMirrored: async (id) => {
        const all = await Storage.get(FINDINGS_KEY, {});
        const record = all[id];
        if (!record) return null;
        record.mirroredAt = Math.floor(Date.now() / 1000);
        all[id] = record;
        await Storage.set(FINDINGS_KEY, all);
        return record;
    }
};

// ------------------------------------------------------------------
// CRUD — baselines (Rule 3: deviation needs something to deviate from)
// ------------------------------------------------------------------

/** Deterministic baseline id from (subjectKey | sourceUrl). */
export async function generateBaselineId(subjectKey, sourceUrl) {
    const hash = await Crypto.sha256(`${subjectKey}|${normalizeUrl(sourceUrl || '')}`);
    return `baseline_${hash.slice(0, 16)}`;
}

export const ForensicBaseline = {
    get: async (id) => {
        if (!id) return null;
        const all = await Storage.get(BASELINES_KEY, {});
        return all[id] || null;
    },

    getForSubject: async (ref) => {
        const key = subjectRefKey(ref);
        if (!key) return [];
        const all = await Storage.get(BASELINES_KEY, {});
        return Object.values(all).filter((b) => subjectRefKey(b.subject_ref) === key);
    },

    /**
     * Record a subject's established register for a source — descriptive
     * prose (+ optional illustrative anchors), never a score. Idempotent
     * on (subject, source url): re-marking updates the note in place.
     */
    create: async (fields) => {
        const given = fields || {};
        const subject_ref = cleanSubjectRef(given.subject_ref);
        const sourceUrlRaw = String((given.source_ref && given.source_ref.url) || given.source_url || '');
        const note = String(given.note || '').trim();
        if (!note) throw new Error('A baseline needs a descriptive note');

        const id = await generateBaselineId(subjectRefKey(subject_ref), sourceUrlRaw);
        const all = await Storage.get(BASELINES_KEY, {});
        const now = Math.floor(Date.now() / 1000);
        const anchors = Array.isArray(given.anchors) && given.anchors.length
            ? cleanAnchors(given.anchors) : [];
        if (all[id]) {
            const patched = { ...all[id], note, anchors, updated: now };
            all[id] = patched;
            await Storage.set(BASELINES_KEY, all);
            return patched;
        }
        const record = {
            id,
            subject_ref,
            source_ref: sourceUrlRaw ? {
                url: normalizeUrl(sourceUrlRaw), url_raw: sourceUrlRaw
            } : null,
            note,
            anchors,
            created: now,
            updated: now
        };
        all[id] = record;
        await Storage.set(BASELINES_KEY, all);
        Utils.log('Created forensic baseline:', id);
        return record;
    },

    delete: async (id) => {
        const all = await Storage.get(BASELINES_KEY, {});
        if (!all[id]) return false;
        delete all[id];
        await Storage.set(BASELINES_KEY, all);
        return true;
    }
};

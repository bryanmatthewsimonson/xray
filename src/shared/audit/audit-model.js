// X-Ray — audit local models (Phase 13, slice 13.1).
//
// The Phase-11 model discipline, applied to the audit ledger:
// deterministic local ids, idempotent create, a `markPublished` family
// that never bumps `updated`, and derived fields homed where mutation
// is safe (the local record, never the wire). Storage is the
// `xray-audits` IndexedDB (audit-cache.js).
//
// Auditor identity is auditor-KIND-agnostic throughout (RQ3): every
// record carries `auditor: {kind, id}` opaquely — model, human,
// pipeline, and consensus identities flow the same paths, and tests
// pin that nothing here special-cases the kind.
//
// Identity notes (docs/EPISTEMIC_AUDIT_DESIGN.md §"Local model and
// ledger"):
//   - AuditRun:    audit_<sha16(articleHash|auditorId|runAt)>
//   - Prediction:  pred_<sha16(articleHash|norm(text))> — local and
//     wire identity coincide deliberately (no pre/post-publish ref
//     duality: the article hash is known at extraction). `norm` is the
//     claim-id discipline, exactly.
//   - Resolution:  res_<sha16(predictionCoord)> — one per (resolver,
//     prediction); the local record is the user's own authorship.

import { Crypto } from '../crypto.js';
import {
    saveRun, getRun, runsByArticleHash,
    savePrediction, getPrediction, predictionsByArticleHash,
    saveResolution, getResolution, resolutionsByPredictionCoord
} from './audit-cache.js';

function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

export const RESOLUTION_OUTCOMES = Object.freeze(['true', 'false', 'partial', 'unresolvable']);
export const RUN_SOURCES = Object.freeze(['cli-import', 'background', 'manual']);

function assertOutcome(outcome, fn) {
    if (!RESOLUTION_OUTCOMES.includes(outcome)) {
        throw new Error(`${fn}: outcome must be one of ${RESOLUTION_OUTCOMES.join(', ')} (got ${outcome})`);
    }
}

async function sha16(s) {
    return (await Crypto.sha256(String(s))).slice(0, 16);
}

// The claim-id discipline (claim-model.js), exactly: trim, collapse
// every whitespace run to a single space, lowercase.
export function normalizePredictionText(text) {
    return String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function generateAuditRunId(articleHash, auditorId, runAt) {
    return `audit_${await sha16(`${articleHash}|${auditorId}|${runAt}`)}`;
}

export async function generatePredictionId(articleHash, predictionText) {
    return `pred_${await sha16(`${articleHash}|${normalizePredictionText(predictionText)}`)}`;
}

export async function generateResolutionId(predictionCoord) {
    return `res_${await sha16(String(predictionCoord || '').trim())}`;
}

/**
 * Compare two dotted version strings ("1.0", "1.2.1") numerically.
 * Returns -1 | 0 | 1.
 */
export function compareVersions(a, b) {
    const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const da = pa[i] || 0;
        const db = pb[i] || 0;
        if (da < db) return -1;
        if (da > db) return 1;
    }
    return 0;
}

// --- AuditRun -------------------------------------------------------------------

export const AuditRunModel = {
    /**
     * Idempotent create keyed on (articleHash, auditorId, runAt).
     * `source` is one of 'cli-import' | 'background' | 'manual'.
     * Returns the existing record untouched when the id already
     * exists — re-importing the same run JSON is a no-op.
     */
    create: async ({ articleHash, auditor, runAt, source, moduleResults = [], aggregate = null }) => {
        if (!articleHash || typeof articleHash !== 'string') {
            throw new Error('AuditRunModel.create: articleHash required');
        }
        if (!auditor || typeof auditor.kind !== 'string' || typeof auditor.id !== 'string') {
            throw new Error('AuditRunModel.create: auditor {kind, id} required');
        }
        if (!runAt) throw new Error('AuditRunModel.create: runAt required');
        const src = source || 'manual';
        if (!RUN_SOURCES.includes(src)) {
            throw new Error(`AuditRunModel.create: source must be one of ${RUN_SOURCES.join(', ')} (got ${source})`);
        }
        const id = await generateAuditRunId(articleHash, auditor.id, runAt);
        const existing = await getRun(id);
        if (existing) return existing;
        const record = {
            id,
            articleHash,
            auditor: { ...auditor },
            runAt,
            source: src,
            moduleResults,
            aggregate,
            // Per-event publish ledger: eventKey → {publishedAt,
            // publishedEventId}. Keys: 'mod:<module>' ×8, 'agg',
            // 'pred:<predictionId>' ×N — so a partially-published run
            // (relay hiccup mid-batch) resumes rather than duplicating.
            events: {},
            created: nowSeconds(),
            updated: nowSeconds()
        };
        await saveRun(record);
        return record;
    },

    get: (id) => getRun(id),
    getByArticleHash: (hash) => runsByArticleHash(hash),

    /**
     * Record one event's publication in the per-event ledger. Never
     * bumps `updated` — publishing is not an edit, so post-publish
     * edits still re-emit (the Phase 11 rule, per event).
     */
    markEventPublished: async (id, eventKey, eventId) => {
        const record = await getRun(id);
        if (!record) return null;
        record.events = record.events || {};
        record.events[eventKey] = {
            publishedAt: nowSeconds(),
            publishedEventId: eventId || null
        };
        await saveRun(record);
        return record;
    }
};

/**
 * Pure staleness check: which of a run's module results were produced
 * under an older methodology than the current vendored prompts?
 * Returns [{module, storedVersion, currentVersion}]. Staleness is a
 * DISPLAY state ("re-audit under v1.1 offered"), never an
 * auto-recompute trigger — recompute costs the user money, and old
 * results stay valid under their recorded version (P9, §8).
 */
export function staleModules(run, currentVersions) {
    const out = [];
    for (const r of (run && run.moduleResults) || []) {
        const current = currentVersions && currentVersions[r.module];
        if (!current || !r.module_version) continue;
        if (compareVersions(r.module_version, current) < 0) {
            out.push({ module: r.module, storedVersion: r.module_version, currentVersion: current });
        }
    }
    return out;
}

/**
 * Pure orphan check: a stored run is orphaned when the current capture
 * of its URL hashes differently (stealth-edit surface). Display state
 * only. Audits reference the hash, which outlives the capture — an
 * orphaned audit is still a valid record of what was scored.
 */
export function isOrphaned(run, currentArticleHash) {
    if (!run || !currentArticleHash) return false;
    return run.articleHash !== currentArticleHash;
}

// --- Prediction -------------------------------------------------------------------

export const PredictionModel = {
    /**
     * Idempotent create keyed on (articleHash, normalized text) — the
     * wire `d` derivation, so local and wire identity coincide.
     * `resolution_status` and `latest_resolution_id` are LOCAL DERIVED
     * fields (audit-types' mutable fields, homed where mutation is
     * safe); they start open/null and recompute from resolutions.
     */
    create: async (fields) => {
        const { articleHash, text } = fields || {};
        if (!articleHash || typeof articleHash !== 'string') {
            throw new Error('PredictionModel.create: articleHash required');
        }
        if (!text || typeof text !== 'string') {
            throw new Error('PredictionModel.create: text required');
        }
        const id = await generatePredictionId(articleHash, text);
        const existing = await getPrediction(id);
        if (existing) return existing;
        const record = {
            id,
            articleHash,
            text,
            type: fields.type || 'explicit',
            hedge_level: fields.hedge_level || 'hedged',
            attributed_to: fields.attributed_to || 'article_voice',
            attributed_source_name: fields.attributed_source_name || null,
            condition: fields.condition || null,
            horizon: fields.horizon || '',
            horizon_iso: fields.horizon_iso || null,
            criteria: fields.criteria || '',
            tractability: fields.tractability || 'ambiguous',
            evidence_quote: fields.evidence_quote || '',
            anchor: fields.anchor || null,
            // prediction_extraction's methodology version, persisted
            // so the published 30058 states the version that actually
            // produced it (P9) — never re-stamped at publish time.
            module_version: fields.module_version || null,
            claim_ref: fields.claim_ref || null,   // set on promotion (RQ6)
            auditor: fields.auditor ? { ...fields.auditor } : null,
            extracted_at: fields.extracted_at || null,
            resolution_status: 'open',
            latest_resolution_id: null,
            publishedAt: null,
            publishedEventId: null,
            created: nowSeconds(),
            updated: nowSeconds()
        };
        await savePrediction(record);
        return record;
    },

    get: (id) => getPrediction(id),
    getByArticleHash: (hash) => predictionsByArticleHash(hash),

    /** Publish ledger mark — never bumps `updated`. */
    markPublished: async (id, eventId) => {
        const record = await getPrediction(id);
        if (!record) return null;
        record.publishedAt = nowSeconds();
        if (eventId) record.publishedEventId = eventId;
        await savePrediction(record);
        return record;
    },

    /**
     * Record the promotion link (RQ6): this prediction was atomized
     * into a 30040 claim. `claimRef` carries `{claim_id, pred_d}` —
     * the local claim id plus this prediction's wire `d`, so the
     * claim builder can emit the `a` back-reference without an async
     * derivation. Enrichment, never bumps `updated`.
     */
    setClaimRef: async (id, claimRef) => {
        const record = await getPrediction(id);
        if (!record) return null;
        record.claim_ref = claimRef || null;
        await savePrediction(record);
        return record;
    },

    /**
     * Recompute the derived resolution fields from a set of resolution
     * records (own + incoming 30059s). Persists without bumping
     * `updated` — derivation is enrichment, not an edit.
     */
    updateDerived: async (id, resolutions) => {
        const record = await getPrediction(id);
        if (!record) return null;
        const derived = deriveResolutionState(resolutions);
        record.resolution_status = derived.status;
        record.latest_resolution_id = derived.latestId;
        await savePrediction(record);
        return record;
    }
};

/**
 * Pure: derive {status, latestId} from resolution records
 * [{id, outcome, resolved_at}]. Latest `resolved_at` wins — the
 * audit-types rule ("multiple resolutions may exist; latest wins
 * unless a dispute is open"; the dispute exception defers with the
 * adjudication runtime, flagged in the design note).
 */
export function deriveResolutionState(resolutions) {
    const usable = (resolutions || []).filter((r) => r && r.outcome && r.id);
    if (usable.length === 0) return { status: 'open', latestId: null };
    let latest = usable[0];
    for (const r of usable) {
        if ((r.resolved_at || 0) > (latest.resolved_at || 0)) latest = r;
    }
    const statusByOutcome = {
        'true': 'resolved_true',
        'false': 'resolved_false',
        'partial': 'resolved_partial',
        'unresolvable': 'unresolvable'
    };
    return {
        status: statusByOutcome[latest.outcome] || 'open',
        latestId: latest.id
    };
}

// --- Resolution -------------------------------------------------------------------

export const ResolutionModel = {
    /**
     * Idempotent create keyed on the prediction coordinate — one
     * resolution per (resolver, prediction); editing your own
     * resolution replaces it (the type's own latest-wins semantics).
     */
    create: async (fields) => {
        const { predictionCoord } = fields || {};
        if (!predictionCoord || typeof predictionCoord !== 'string') {
            throw new Error('ResolutionModel.create: predictionCoord required');
        }
        // The outcome is the record's entire point — never defaulted,
        // never stored unvalidated: an invalid value would silently
        // degrade to "open" downstream and vanish from calibration.
        assertOutcome(fields.outcome, 'ResolutionModel.create');
        const id = await generateResolutionId(predictionCoord);
        const existing = await getResolution(id);
        if (existing) return existing;
        const record = {
            id,
            prediction_coord: predictionCoord.trim(),
            // The PREDICTION's article hash (x on the published 30059)
            // — without it, a resolution of a remote prediction can't
            // be scoped to an article at publish time.
            article_hash: fields.articleHash || null,
            outcome: fields.outcome,
            evidence: Array.isArray(fields.evidence) ? fields.evidence : [],
            notes: fields.notes || '',
            confidence: typeof fields.confidence === 'number' ? fields.confidence : null,
            auditor: fields.auditor ? { ...fields.auditor } : null,
            resolved_at: fields.resolved_at || nowSeconds(),
            publishedAt: null,
            publishedEventId: null,
            created: nowSeconds(),
            updated: nowSeconds()
        };
        await saveResolution(record);
        return record;
    },

    get: (id) => getResolution(id),
    getByPredictionCoord: (coord) => resolutionsByPredictionCoord(coord),

    /** Publish ledger mark — never bumps `updated`. */
    markPublished: async (id, eventId) => {
        const record = await getResolution(id);
        if (!record) return null;
        record.publishedAt = nowSeconds();
        if (eventId) record.publishedEventId = eventId;
        await saveResolution(record);
        return record;
    },

    /**
     * The one mutable path: the resolver revising their own resolution
     * (outcome/evidence/notes/confidence). DOES bump `updated`, so a
     * post-publish revision re-emits — and the same `d` replaces the
     * prior event on relays, by design (see the RQ5 tension note).
     */
    update: async (id, updates) => {
        const record = await getResolution(id);
        if (!record) return null;
        if (updates && 'outcome' in updates) {
            assertOutcome(updates.outcome, 'ResolutionModel.update');
        }
        const allowed = ['outcome', 'evidence', 'notes', 'confidence', 'resolved_at', 'article_hash'];
        for (const key of allowed) {
            if (updates && key in updates) record[key] = updates[key];
        }
        record.updated = nowSeconds();
        await saveResolution(record);
        return record;
    }
};

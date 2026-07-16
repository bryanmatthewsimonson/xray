// Assessment publish selection — Phase 11.7 (docs/ASSESSMENTS_DESIGN.md,
// the flag-gated publish slice).
//
// Pure selection logic for which judgment records are wire-ready in a
// publish batch, kept out of the reader so it's unit-testable:
//
//   - an ASSESSMENT publishes when its claim's coordinate is known:
//     foreign refs carry it; own claims need a recorded
//     publishedPubkey (claims publish before assessments in the
//     batch, so a claim published moments ago qualifies). The
//     coordinate is derived from the RECORDED publishing pubkey,
//     never the current signer.
//   - a LINK publishes when BOTH endpoints' coordinates are known.
//   - the usual `updated > publishedAt` staleness gate applies, so
//     edits re-emit (NIP-01 replaceable semantics on the wire d-tag).
//
// Callers pass plain dictionaries (model getAll() results) plus a
// snapshot canonicalizer — no storage access here.

import { isLocalClaimId, parseClaimCoord, buildClaimCoord } from './claim-ref.js';
import { REVISION_RELATIONSHIPS } from './assessment-taxonomy.js';

/**
 * Wire-readiness of one claim ref. Returns
 * `{ coord, url, eventId, aboutIds, aboutPubkeys }` or null when the
 * claim can't be referenced on the wire yet (our own claim, not yet
 * published). `url` is the VERBATIM claim `r` (own claims publish raw
 * URLs; the join is raw), so callers emit it as the wire `r`.
 * `aboutIds` are local entity ids the caller resolves to pubkeys via
 * the registry (own claims); `aboutPubkeys` are pre-resolved foreign
 * pubkeys snapshotted at assess time.
 */
export function claimWireInfo(claims, canonicalRef, fallback = {}) {
    if (isLocalClaimId(canonicalRef)) {
        const claim = claims[canonicalRef];
        if (!claim || !claim.publishedPubkey) return null;
        return {
            coord:        buildClaimCoord(claim.publishedPubkey, claim.id),
            url:          claim.source_url || '',   // verbatim
            eventId:      claim.publishedEventId || null,
            aboutIds:     claim.about || [],
            aboutPubkeys: []
        };
    }
    if (!parseClaimCoord(canonicalRef)) return null;
    return {
        coord:        canonicalRef,
        url:          fallback.url_raw || fallback.url || '',   // verbatim if snapshotted
        eventId:      fallback.event_id || null,
        aboutIds:     [],
        aboutPubkeys: Array.isArray(fallback.about_pubkeys) ? fallback.about_pubkeys : []
    };
}

/**
 * Assessments that are wire-ready and stale. Sorted by creation time
 * so batches are stable. Each entry: `{ assessment, coord, url,
 * eventId, aboutIds, needsCoordBackfill }`.
 */
export function selectAssessmentsToPublish({ assessments, claims, canon }) {
    const out = [];
    for (const a of Object.values(assessments || {})) {
        // Belt-and-braces (Phase 25.3): incorporated foreign judgments
        // live in the dedicated incorporated_artifacts store, never in
        // this model — but if that ever changes, they still must not
        // publish under the user's key.
        if (String(a.suggested_by || '').startsWith('nostr:')) continue;
        if (a.publishedAt && (a.updated || 0) <= a.publishedAt) continue;
        const rawRef = a.claim_ref && (a.claim_ref.claim_id || a.claim_ref.coord);
        if (!rawRef) continue;
        const ref = canon(rawRef);
        const info = claimWireInfo(claims, ref, a.claim_ref || {});
        if (!info) continue;   // own claim still unpublished — a later batch
        out.push({
            assessment: a,
            ...info,
            needsCoordBackfill: !!(a.claim_ref && a.claim_ref.claim_id
                                   && a.claim_ref.coord !== info.coord)
        });
    }
    out.sort((x, y) => (x.assessment.created || 0) - (y.assessment.created || 0));
    return out;
}

/**
 * Links that are wire-ready (both endpoints) and stale. Legacy
 * `contextualizes` records never publish — the relationship isn't in
 * the kind-30055 vocabulary. Each entry: `{ link, source, target }`
 * with per-endpoint `{ coord, url, eventId }`.
 */
export function selectLinksToPublish({ links, claims, canon }) {
    const out = [];
    for (const link of Object.values(links || {})) {
        // Incorporated foreign links never publish (Phase 25.3) —
        // reviewed-in copies of someone else's signed work.
        if (String(link.suggested_by || '').startsWith('nostr:')) continue;
        if (link.relationship === 'contextualizes') continue;
        // The Phase-14 `revision/*` story-change edges publish under
        // `forensicPublishing` (forensic-publish.js), not here.
        if (REVISION_RELATIONSHIPS.includes(link.relationship)) continue;
        if (link.publishedAt && (link.updated || 0) <= link.publishedAt) continue;
        const source = claimWireInfo(claims, canon(link.source_claim_id), link.source_snapshot || {});
        const target = claimWireInfo(claims, canon(link.target_claim_id), link.target_snapshot || {});
        if (!source || !target) continue;
        out.push({ link, source, target });
    }
    out.sort((x, y) => (x.link.created || 0) - (y.link.created || 0));
    return out;
}

/**
 * The kind-1985 label mirrors to publish: every labeled, wire-ready
 * assessment that has NOT yet been mirrored (`mirroredAt` unset).
 * Keyed on `mirroredAt`, NOT the assessment's publish state, so a
 * mirror rejected while its 30054 landed is retried next batch, and a
 * label-added-after-first-publish still mirrors once — while a label
 * EDIT never re-mirrors (1985 is non-replaceable; markMirrored is set
 * once). Selected independently of `selectAssessmentsToPublish`, so it
 * also covers assessments published in a PRIOR batch.
 *
 * The reader must still gate a same-batch first publish: don't emit a
 * mirror whose 30054 was attempted this batch and failed.
 */
export function selectMirrors({ assessments, claims, canon }) {
    const out = [];
    for (const a of Object.values(assessments || {})) {
        if (a.mirroredAt) continue;
        if (!Array.isArray(a.labels) || a.labels.length === 0) continue;
        const rawRef = a.claim_ref && (a.claim_ref.claim_id || a.claim_ref.coord);
        if (!rawRef) continue;
        const info = claimWireInfo(claims, canon(rawRef), a.claim_ref || {});
        if (!info) continue;
        out.push({ assessment: a, coord: info.coord, url: info.url });
    }
    out.sort((x, y) => (x.assessment.created || 0) - (y.assessment.created || 0));
    return out;
}

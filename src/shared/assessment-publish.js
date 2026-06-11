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

/**
 * Wire-readiness of one claim ref. Returns
 * `{ coord, url, eventId, aboutIds }` or null when the claim can't be
 * referenced on the wire yet (our own claim, not yet published).
 */
export function claimWireInfo(claims, canonicalRef, fallback = {}) {
    if (isLocalClaimId(canonicalRef)) {
        const claim = claims[canonicalRef];
        if (!claim || !claim.publishedPubkey) return null;
        return {
            coord:    buildClaimCoord(claim.publishedPubkey, claim.id),
            url:      claim.source_url || '',
            eventId:  claim.publishedEventId || null,
            aboutIds: claim.about || []
        };
    }
    if (!parseClaimCoord(canonicalRef)) return null;
    return {
        coord:    canonicalRef,
        url:      fallback.url || '',
        eventId:  fallback.event_id || null,
        aboutIds: []
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
        if (link.relationship === 'contextualizes') continue;
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
 * The kind-1985 mirrors for a batch: one per labeled assessment on
 * its FIRST publish only. Kind 1985 is a regular (non-replaceable)
 * event, so re-mirroring on every edit would accumulate duplicates in
 * naive aggregators; the trade-off (a label edit after first publish
 * leaves the mirror stale until a NIP-09 cleanup pass exists) is
 * recorded in the JOURNAL.
 */
export function selectMirrors(assessmentSelections) {
    return (assessmentSelections || []).filter((s) =>
        !s.assessment.publishedAt
        && Array.isArray(s.assessment.labels)
        && s.assessment.labels.length > 0
    );
}

// Attestation graph — Phase 15.2 (docs/TRUTH_ADJUDICATION_DESIGN.md §3.2).
//
// "Actions are not textual artifacts." An action-fact enters the
// system only as the CORROBORATED CONVERGENCE of independent attesting
// artifacts — never as one primary artifact. In X-Ray terms each
// attesting artifact is a captured claim (it has text, a URL, an
// anchor), linked `supports` → the proposition's underlying claim with
// attestation metadata on the edge (evidence-linker.js: tier,
// origin_key, independence_note). This module is the authoring surface
// for those edges and the MEASUREMENT over them.
//
// The measurement discipline (§1): every number this module produces
// is a count that ships its own derivation — the origin groups, their
// links, their notes. Nothing here estimates; nothing here is a score.
//
// Independence is demonstrated, not assumed (§2 brigading/Sybil row):
//   - links sharing an origin_key collapse to ONE origin group ("two
//     outlets on one wire are one source");
//   - the EARLIEST origin group is the baseline — with nothing prior
//     to be independent OF, it needs no demonstration;
//   - every later group counts as independent only if it carries a
//     non-empty independence_note (the per-verdict authoring
//     discipline: the author records WHY it is independent).
// Undemonstrated groups are still listed — visible, just not counted.
// Network-level Sybil resistance over the same fields is deferred to
// the aggregation layer (§2), exactly as the design scopes v1.

import { EvidenceLinker } from './evidence-linker.js';
import { TruthAdjudicationModel } from './truth-adjudication-model.js';
import { canonicalizeClaimRef, makeClaimRefCanonicalizer } from './claim-ref.js';
import { evidenceTierRank } from './truth-taxonomy.js';

/**
 * Attest a proposition: record that `claim_ref` (a local claim id or
 * a 30040 coordinate) is an attesting artifact for the proposition's
 * underlying claim. Creates the `supports` edge carrying the
 * attestation metadata; validation (tier, origin_key) happens in the
 * linker. Idempotent on the edge: re-attesting an existing edge
 * backfills missing attestation metadata but never silently
 * overwrites existing metadata (re-assessment is an explicit
 * `EvidenceLinker.update`).
 *
 * @param {string} propositionId
 * @param {{claim_ref: string, tier: string, origin_key: string,
 *          independence_note?: string, note?: string,
 *          suggested_by?: string, source_snapshot?: object}} fields
 * @returns {Promise<object>} the supports link record
 */
export async function attestProposition(propositionId, fields) {
    const given = fields || {};
    const proposition = await TruthAdjudicationModel.get(propositionId);
    if (!proposition) throw new Error(`Proposition not found: ${propositionId}`);

    const attestation = {
        tier:              given.tier,
        origin_key:        given.origin_key,
        independence_note: given.independence_note
    };
    const link = await EvidenceLinker.create({
        source_claim_id: given.claim_ref,
        target_claim_id: proposition.claim_id,
        relationship:    'supports',
        note:            given.note || '',
        suggested_by:    given.suggested_by,
        source_snapshot: given.source_snapshot,
        attestation
    });
    // create() is idempotent on the edge — if the edge pre-existed
    // WITHOUT attestation metadata, stamp it now.
    if (!link.attestation) {
        return await EvidenceLinker.update(link.id, { attestation });
    }
    return link;
}

/**
 * Every attestation edge for a proposition: supports links whose
 * TARGET is the proposition's underlying claim and that carry
 * attestation metadata. Endpoints are canonicalized before matching
 * (the getForClaim discipline), so drifted refs still match.
 *
 * @param {string} propositionId
 * @returns {Promise<object[]>} link records, oldest first
 */
export async function attestationsForProposition(propositionId) {
    const proposition = await TruthAdjudicationModel.get(propositionId);
    if (!proposition) throw new Error(`Proposition not found: ${propositionId}`);
    const canonical = await canonicalizeClaimRef(proposition.claim_id);
    const canon = await makeClaimRefCanonicalizer();
    const links = await EvidenceLinker.getForClaim(proposition.claim_id);
    return links.filter((l) =>
        l.relationship === 'supports'
        && l.attestation
        && canon(l.target_claim_id) === canonical);
}

/**
 * The convergence MEASUREMENT over a set of attestation edges — pure,
 * synchronous, fully derivable from its own output:
 *
 *   - origin_groups     — links collapsed by origin_key, oldest group
 *                         first; each group carries its best tier, its
 *                         link ids, its independence notes, and whether
 *                         it is demonstrated (baseline or noted).
 *   - origin_count      — distinct origins.
 *   - independent_count — THE corroboration strength: the baseline
 *                         group plus every demonstrated later group.
 *   - undemonstrated    — origin keys excluded from independent_count
 *                         (visible, not counted).
 *   - by_tier           — demonstrated-independent groups per best
 *                         tier.
 *
 * @param {object[]} links - attestation-carrying supports links
 * @returns {{total_attestations: number, origin_count: number,
 *            independent_count: number, undemonstrated: string[],
 *            by_tier: object, origin_groups: object[]}}
 */
export function attestationConvergence(links) {
    const withMeta = (links || []).filter((l) => l && l.attestation);

    const byOrigin = new Map();
    let nextIndex = 0;
    for (const link of withMeta) {
        const key = link.attestation.origin_key;
        if (!byOrigin.has(key)) {
            byOrigin.set(key, {
                origin_key:         key,
                tier:               link.attestation.tier,
                link_ids:           [],
                independence_notes: [],
                earliest_created:   link.created || 0,
                _first_index:       nextIndex++
            });
        }
        const group = byOrigin.get(key);
        group.link_ids.push(link.id);
        if (link.attestation.independence_note) {
            group.independence_notes.push(link.attestation.independence_note);
        }
        // The group's tier is the BEST provenance among its links.
        if (evidenceTierRank(link.attestation.tier) < evidenceTierRank(group.tier)) {
            group.tier = link.attestation.tier;
        }
        if ((link.created || 0) < group.earliest_created) {
            group.earliest_created = link.created || 0;
        }
    }

    // Oldest origin first; created-at has second granularity, so ties
    // break on first appearance in the input (for stored links that is
    // authoring order) — never alphabetically, which would make the
    // baseline choice arbitrary.
    const groups = [...byOrigin.values()]
        .sort((a, b) => a.earliest_created - b.earliest_created
                     || a._first_index - b._first_index);
    groups.forEach((group, i) => {
        group.baseline = i === 0;
        group.demonstrated = i === 0 || group.independence_notes.length > 0;
        delete group._first_index;
    });

    const demonstrated = groups.filter((g) => g.demonstrated);
    const byTier = {};
    for (const g of demonstrated) byTier[g.tier] = (byTier[g.tier] || 0) + 1;

    return {
        total_attestations: withMeta.length,
        origin_count:       groups.length,
        independent_count:  demonstrated.length,
        undemonstrated:     groups.filter((g) => !g.demonstrated).map((g) => g.origin_key),
        by_tier:            byTier,
        origin_groups:      groups
    };
}

/**
 * Convenience: fetch + measure in one call.
 *
 * @param {string} propositionId
 * @returns {Promise<object>} the attestationConvergence result
 */
export async function convergenceForProposition(propositionId) {
    return attestationConvergence(await attestationsForProposition(propositionId));
}

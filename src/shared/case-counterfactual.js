// Structural counterfactual — Phase 26 CF.1
// (docs/COUNTERFACTUAL_DESIGN.md §2–§3). "What depends on this claim":
// given one claim in a case, report what in the case graph STRUCTURALLY
// changes if that claim is removed (`mode: 'remove'`) or negated
// (`mode: 'negate'`) — as COUNTS THAT SHOW THEIR DERIVATION, never an
// estimated probability. A measurement over deterministic graph
// structure, not a simulation of belief (§1): the constitution's
// admissible category. The probabilistic Monte Carlo remains refused
// (§4 — a separate, constitution-amending decision, not planned).
//
// Pure: a diff over the SAME exported builders the dossier renders
// from (buildKnots, buildTimelineEvents, buildEntitiesInvolved,
// attestationConvergence) run on `data` and on `data`-without-the-
// claim. No LLM, no storage, no clock, no wire kind, nothing
// persisted. Every numeric in the output sits beside a `derivation`
// carrying the specific edges/claims/events that produced it — a
// number with no derivation is a bug, not a feature (§4); the guard
// test walks the output and enforces exactly that, plus the banned
// key set (no probability/likelihood/confidence/score/weight).
//
// Negate semantics (§2): the claim still EXISTS — entities and
// timeline honestly report zero change — but its truth-bearing edges
// flip: each contradicts edge becomes concordance (the knot recomputes
// without it, disclosed as flipped, not removed), its supports /
// attestation edges no longer support (same structural loss as
// removal), and any claim→hypothesis edges swap supports↔undermines.
// No verdict is recomputed — truth stays with the verdict layer (§5).
//
// `claimRef` must arrive CANONICAL (the collector pre-canonicalizes
// every stored endpoint into source_ref/target_ref; CF.2 canonicalizes
// the query side). `options.hypothesisEdges` is the optional
// hypothesis-map join: [{ hypothesis_id, label, ref, role, edge_id }].

import {
    buildKnots, buildTimelineEvents, buildEntitiesInvolved
} from './case-dossier.js';
import { attestationConvergence } from './truth-attestation.js';

export const COUNTERFACTUAL_MODES = Object.freeze(['remove', 'negate']);

const touches = (link, ref) => link.source_ref === ref || link.target_ref === ref;

/** `data` with the claim (and, for remove, its propositions) taken out. */
function dataWithout(data, ref) {
    const claims = ((data.orbit && data.orbit.claims) || []).filter((c) => c.id !== ref);
    const claimsById = { ...(data.claimsById || {}) };
    delete claimsById[ref];
    const allProps = {};
    for (const [id, p] of Object.entries((data.propositions && data.propositions.all) || {})) {
        if (p.claim_id !== ref) allProps[id] = p;
    }
    return {
        ...data,
        orbit: { ...(data.orbit || {}), claims },
        claimsById,
        propositions: {
            all: allProps,
            orbit: ((data.propositions && data.propositions.orbit) || []).filter((p) => p.claim_id !== ref)
        },
        links: {
            ...(data.links || {}),
            contradicts: ((data.links && data.links.contradicts) || []).filter((l) => !touches(l, ref)),
            attestations: ((data.links && data.links.attestations) || []).filter((l) => !touches(l, ref)),
            related: ((data.links && data.links.related) || []).filter((l) => !touches(l, ref))
        }
    };
}

const knotRefs = (k) => (k.nodes || []).map((n) => n.ref);

/**
 * Diff the contradiction knots: for each before-knot the claim sits
 * in, which fragments survive once its edges are gone. `change`:
 * 'dissolved' (nothing ≥2 survives), 'split' (2+ fragments), 'shrunk'.
 */
function diffKnots(data, ref, mode) {
    const before = buildKnots(data).contradictions || [];
    const after = buildKnots(dataWithout(data, ref)).contradictions || [];
    const affected = [];
    for (const k of before) {
        const refs = knotRefs(k);
        if (!refs.includes(ref)) continue;
        const refSet = new Set(refs);
        const fragments = after
            .filter((a) => knotRefs(a).every((r) => refSet.has(r)))
            .map((a) => ({ size: a.size, refs: knotRefs(a), derivation: (a.edges || []).map((e) => e.link_id) }));
        const removedEdges = (k.edges || []).filter((e) => e.source_ref === ref || e.target_ref === ref);
        affected.push({
            size_before: k.size,
            refs_before: refs,
            fragments_after: fragments,
            change: fragments.length === 0 ? 'dissolved' : fragments.length > 1 ? 'split' : 'shrunk',
            edge_treatment: mode === 'negate' ? 'flipped-to-concordance' : 'removed',
            derivation: removedEdges.map((e) => e.link_id)
        });
    }
    return { count: affected.length, derivation: affected };
}

/**
 * The typed-edge losses over `links.related`: which links go, and
 * which claims lose their ONLY incoming support (a supports edge is
 * directional source→target).
 */
function diffSupport(data, ref) {
    const related = (data.links && data.links.related) || [];
    const removed = related.filter((l) => touches(l, ref));
    const surviving = related.filter((l) => !touches(l, ref));
    const losers = [];
    for (const l of removed) {
        if (l.relationship !== 'supports' || l.source_ref !== ref) continue;
        const target = l.target_ref;
        const stillSupported = surviving.some(
            (s) => s.relationship === 'supports' && s.target_ref === target);
        if (!stillSupported) losers.push({ ref: target, derivation: [l.id] });
    }
    return {
        links_removed: {
            count: removed.length,
            derivation: removed.map((l) => ({ link_id: l.id, relationship: l.relationship }))
        },
        claims_losing_only_support: { count: losers.length, derivation: losers }
    };
}

/**
 * Propositions: the claim's OWN propositions (they fall on remove;
 * on negate their verdict chains now rest on a negated claim — the
 * truth call stays with the verdict layer), and the per-proposition
 * attestation-convergence deltas when the claim was an attesting
 * artifact for someone else's proposition. The attestation list
 * arrives in authoring order and the diff preserves it — removing the
 * earliest origin honestly promotes the next-oldest to baseline.
 */
function diffPropositions(data, ref) {
    const allProps = Object.values((data.propositions && data.propositions.all) || {});
    const chains = (data.verdicts && data.verdicts.byProposition) || {};
    const own = allProps
        .filter((p) => p.claim_id === ref)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((p) => ({
            proposition_id: p.id,
            proposition_class: p.proposition_class,
            verdict_chain_length: (chains[p.id] || []).length
        }));

    const attestations = (data.links && data.links.attestations) || [];
    const orbitProps = (data.propositions && data.propositions.orbit) || [];
    const deltas = [];
    for (const p of orbitProps) {
        if (p.claim_id === ref) continue;   // its own fall is reported above
        const links = attestations.filter((l) => l.target_ref === p.claim_id);
        const removed = links.filter((l) => l.source_ref === ref);
        if (removed.length === 0) continue;
        const beforeConv = attestationConvergence(links);
        const afterConv = attestationConvergence(links.filter((l) => l.source_ref !== ref));
        deltas.push({
            proposition_id: p.id,
            origin_count_before: beforeConv.origin_count,
            origin_count_after: afterConv.origin_count,
            independent_before: beforeConv.independent_count,
            independent_after: afterConv.independent_count,
            derivation: {
                removed_link_ids: removed.map((l) => l.id),
                surviving_origin_groups: (afterConv.origin_groups || []).map((g) => ({
                    origin_key: g.origin_key, link_ids: g.link_ids
                }))
            }
        });
    }
    return {
        own: { count: own.length, derivation: own },
        attestation_deltas: deltas
    };
}

/** Entities whose ONLY orbit claim was this one (remove mode). */
function diffEntities(data, ref) {
    const beforeRows = buildEntitiesInvolved(data).rows || [];
    const afterIds = new Set((buildEntitiesInvolved(dataWithout(data, ref)).rows || [])
        .map((r) => r.entity_id));
    const gone = beforeRows
        .filter((r) => !afterIds.has(r.entity_id))
        .map((r) => ({ entity_id: r.entity_id, name: r.name, derivation: [ref] }));
    return { losing_only_claim: { count: gone.length, derivation: gone } };
}

/** Timeline events the claim carried, and axes it alone populated. */
function diffTimeline(data, ref) {
    const before = buildTimelineEvents(data);
    const after = buildTimelineEvents(dataWithout(data, ref));
    const key = (e) => JSON.stringify([e.axis, e.at, e.kind, e.ref, e.label]);
    const afterKeys = new Set(((after && after.events) || []).map(key));
    const removed = ((before && before.events) || []).filter((e) => !afterKeys.has(key(e)));
    const axesBefore = new Set(((before && before.events) || []).map((e) => e.axis));
    const axesAfter = new Set(((after && after.events) || []).map((e) => e.axis));
    const emptied = [...axesBefore].filter((a) => !axesAfter.has(a)).sort();
    return {
        events_removed: {
            count: removed.length,
            derivation: removed.map((e) => ({ axis: e.axis, kind: e.kind, at: e.at ?? null, precision: e.precision ?? null }))
        },
        axes_emptied: { count: emptied.length, derivation: emptied }
    };
}

/** Hypothesis-map joins: per hypothesis, edges lost (remove) or role-flipped (negate). */
function diffHypotheses(hypothesisEdges, ref, mode) {
    const byHyp = new Map();
    for (const e of hypothesisEdges || []) {
        if (e.ref !== ref) continue;
        if (!byHyp.has(e.hypothesis_id)) {
            byHyp.set(e.hypothesis_id, { label: e.label || e.hypothesis_id, supports: [], undermines: [] });
        }
        const slot = byHyp.get(e.hypothesis_id);
        if (e.role === 'supports' || e.role === 'undermines') slot[e.role].push(e.edge_id);
    }
    const deltas = [...byHyp.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([id, slot]) => ({
            hypothesis_id: id,
            label: slot.label,
            edge_treatment: mode === 'negate' ? 'role-flipped' : 'removed',
            supports_affected: slot.supports.length,
            undermines_affected: slot.undermines.length,
            derivation: [...slot.supports, ...slot.undermines]
        }));
    return { count: deltas.length, derivation: deltas };
}

/**
 * The structural delta for one claim. `data` is the
 * `collectCaseDossierData` envelope (with the CF.1 `links.related`
 * family); `claimRef` is canonical; `options`:
 *   mode            — 'remove' (default) | 'negate'
 *   hypothesisEdges — optional [{hypothesis_id, label, ref, role, edge_id}]
 */
export function traceClaimDependencies(data, claimRef, options = {}) {
    const mode = options.mode || 'remove';
    if (!COUNTERFACTUAL_MODES.includes(mode)) {
        throw new Error(`Invalid counterfactual mode: ${mode} (expected ${COUNTERFACTUAL_MODES.join(' | ')})`);
    }
    const ref = String(claimRef || '').trim();
    if (!ref) throw new Error('traceClaimDependencies: claimRef is required');
    const claim = (data.claimsById || {})[ref] || null;
    const inOrbit = ((data.orbit && data.orbit.claims) || []).some((c) => c.id === ref);

    const zero = { count: 0, derivation: [] };
    return {
        mode,
        claim: { ref, text: claim ? claim.text : null, in_orbit: inOrbit },
        knots: diffKnots(data, ref, mode),
        support: diffSupport(data, ref),
        propositions: diffPropositions(data, ref),
        // Negate leaves the claim in place: membership and dating are
        // untouched, and a zero here is the TRUE measurement.
        entities: mode === 'remove' ? diffEntities(data, ref) : { losing_only_claim: zero },
        timeline: mode === 'remove' ? diffTimeline(data, ref) : { events_removed: zero, axes_emptied: zero },
        hypotheses: diffHypotheses(options.hypothesisEdges, ref, mode)
    };
}

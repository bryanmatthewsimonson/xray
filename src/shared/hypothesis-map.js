// Hypothesis map — Phase 26 H.1, the map assembler
// (docs/HYPOTHESIS_MAP_DESIGN.md §2–§3).
//
// DERIVED, COMPUTED ON READ — no new wire kind, nothing persisted
// here, no publish path, no relay fetch. The case-dossier split: a
// storage-aware collector (`collectHypothesisMapData`) and a pure
// builder (`buildHypothesisMap`), `generatedAt` injected, no clock
// read in this module.
//
// The map is structure, not judgment (§6):
//   - hypotheses render side by side; ORDER IS NOT RANK (brief
//     position order, then creation order);
//   - every number is a section size whose derivation is the sibling
//     list it counts; nothing is weighted, fused, or cross-compared —
//     the no-scoreboard rule lives in the RENDER guard (H.2), and no
//     weight/score/probability/confidence/strength key exists in this
//     output (grep-tested);
//   - a claim supporting one hypothesis and undermining another is
//     surfaced as a shared/crux claim, never netted;
//   - a verdict-state chip beside an edge is CONTEXT: the maintainer
//     decision (§8) is show-with-note — a verdict never weights or
//     filters an edge;
//   - dangling references (an edge whose hypothesis vanished, a ref
//     with no local claim and no snapshot) are disclosed, never
//     silently dropped (P6).
//
// Seeding (§2 "Where the pieces map on"): synthesis brief positions
// become seed hypotheses — label + core_argument as the statement,
// article-hash `holders` carried as provenance (holders are ARTICLE
// level; claim edges are only ever human-drawn or human-accepted).
// A persisted hypothesis whose normalized label matches a position
// merges with it (the persisted statement wins; the seed contributes
// holders). Seed-only hypotheses get a `seed:` id — edges can only
// reference PERSISTED hypotheses, so the two id spaces never collide.
//
// The scope question reads from the case entity's
// `authored_fields.scope_question.value` — deliberately NOT
// `dossier.scope` (never populated; see substrate note C1).

import { getCaseBrief } from './audit/audit-cache.js';
import { collectCaseDossierData } from './case-dossier.js';
import { HypothesisModel, HypothesisEdgeModel, normalizeHypothesisLabel } from './hypothesis-model.js';
import { makeClaimRefCanonicalizer } from './claim-ref.js';

// ------------------------------------------------------------------
// Gather (storage-aware)
// ------------------------------------------------------------------

/**
 * Collect everything the pure builder needs for one case's map.
 *
 * options:
 *   data       — an already-collected `collectCaseDossierData` envelope
 *                (the case view collects it once; `?? ` live read)
 *   brief      — the stored case-brief record ({ caseId, brief, ... }
 *                or null); defaults to the live IDB read
 *   hypotheses — injected hypothesis records (`??` model read)
 *   edges      — injected edge records (`??` model read); each edge's
 *                stored ref is re-canonicalized here (canonicality is
 *                time-dependent) and stamped as `ref`
 */
export async function collectHypothesisMapData(caseEntityId, options = {}) {
    const data = options.data ?? await collectCaseDossierData(caseEntityId, options.dossierOptions || {});
    const briefRecord = options.brief !== undefined
        ? options.brief
        : (await getCaseBrief(caseEntityId) || null);
    const hypotheses = options.hypotheses ?? await HypothesisModel.getForCase(caseEntityId);
    const rawEdges = options.edges ?? await HypothesisEdgeModel.getForCase(caseEntityId);
    const canon = await makeClaimRefCanonicalizer();
    const edges = rawEdges.map((e) => ({ ...e, ref: canon(e.claim_ref) }));
    return { data, brief: briefRecord, hypotheses, edges };
}

// ------------------------------------------------------------------
// Pure builders
// ------------------------------------------------------------------

/** The case's scope question, from the entity's authored fields. */
function readScopeQuestion(data) {
    const entity = (data.entitiesById || {})[data.case && data.case.id] || null;
    const field = entity && entity.authored_fields && entity.authored_fields.scope_question;
    const text = field && field.value ? String(field.value).trim() : '';
    return { text, provenance: text ? 'authored' : null };
}

/** article_hash → { url, title } over the archive records that ride the envelope. */
function articleIndex(data) {
    const byHash = new Map();
    for (const rec of data.articles || []) {
        const hash = rec.articleHash || (rec.article && rec.article.canonicalHash) || null;
        if (!hash || byHash.has(hash)) continue;
        byHash.set(hash, {
            url:   rec.url || null,
            title: (rec.article && rec.article.title) || null
        });
    }
    return byHash;
}

/**
 * Verdict-state chips for one local claim: its propositions joined to
 * each chain's ACTIVE verdict (`find !superseded_by` — the
 * getActiveForProposition idiom). `state: null` = unruled. Chips are
 * CONTEXT beside an edge; nothing downstream may weight or filter on
 * them (§8 decision).
 */
function verdictChipsForClaim(data, claimId) {
    const out = [];
    const all = (data.propositions && data.propositions.all) || {};
    const byProposition = (data.verdicts && data.verdicts.byProposition) || {};
    const props = Object.values(all)
        .filter((p) => p.claim_id === claimId)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const p of props) {
        const chain = byProposition[p.id] || [];
        const head = chain.find((v) => !v.superseded_by) || null;
        out.push({
            proposition_id:    p.id,
            proposition_class: p.proposition_class,
            state:             head ? head.verdict : null
        });
    }
    return out;
}

/** Resolve an edge's claim for display: local registry first, snapshot fallback. */
function resolveEdgeClaim(data, edge) {
    const claim = (data.claimsById || {})[edge.ref] || null;
    if (claim) {
        return {
            local:  true,
            text:   claim.text || '',
            url:    claim.source_url || null,
            is_key: !!claim.is_key
        };
    }
    if (edge.claim_snapshot && (edge.claim_snapshot.text || edge.claim_snapshot.url)) {
        return {
            local:  false,
            text:   edge.claim_snapshot.text || '',
            url:    edge.claim_snapshot.url_raw || edge.claim_snapshot.url || null,
            is_key: false
        };
    }
    return null;
}

function edgeView(data, edge, orbitClaimIds) {
    return {
        edge_id:      edge.id,
        ref:          edge.ref,
        role:         edge.role,
        note:         edge.note || '',
        suggested_by: edge.suggested_by || 'user',
        quote:        edge.quote || null,
        article_hash: edge.article_hash || null,
        claim:        resolveEdgeClaim(data, edge),
        in_orbit:     orbitClaimIds.has(edge.ref),
        verdicts:     verdictChipsForClaim(data, edge.ref)
    };
}

/**
 * Build the hypothesis map. `input` is the collector envelope
 * ({ data, brief, hypotheses, edges }); `generatedAt` is injected.
 *
 * Output shape (§2, all sizes are section counts whose derivation is
 * the sibling list):
 *
 *   { case, generated_at, question,
 *     hypotheses: [{ id, label, statement, note, suggested_by,
 *                    persisted, seeded, core_argument, holders,
 *                    edges: { supports: [...], undermines: [...] },
 *                    coverage: { supports, undermines } }],
 *     shared_claims: [{ ref, claim, entries: [{hypothesis_id, role}],
 *                       opposing }],
 *     dangling: { edges: [...] },
 *     coverage: { hypotheses, seeded, persisted, edges, supports,
 *                 undermines, claims, shared_claims, opposing_claims,
 *                 dangling_edges } }
 */
export function buildHypothesisMap(input, generatedAt = null) {
    const { data } = input;
    const brief = (input.brief && input.brief.brief) || null;
    const persisted = input.hypotheses || [];
    const edges = input.edges || [];

    const articles = articleIndex(data);
    const orbitClaimIds = new Set(((data.orbit && data.orbit.claims) || []).map((c) => c.id));

    // ---- hypotheses: seeds (brief position order) merged with
    //      persisted records (normalized-label join), then
    //      persisted-only rows in creation order. Order is NOT rank.
    const persistedByLabel = new Map();
    for (const h of persisted) persistedByLabel.set(normalizeHypothesisLabel(h.label), h);

    const rows = [];
    const rowByNorm = new Map();
    const consumed = new Set();
    let unlabeledPositions = 0;
    for (const pos of (brief && brief.positions) || []) {
        const label = String(pos.label || '').trim();
        const coreArgument = String(pos.core_argument || '').trim() || null;
        const holders = (pos.holders || []).map((h) => ({
            article_hash: h.article_hash,
            url:          (articles.get(h.article_hash) || {}).url || null,
            title:        (articles.get(h.article_hash) || {}).title || null
        }));
        if (!label) {
            // A position the brief emitted without a label cannot seed
            // a hypothesis — disclosed as a count, never silently
            // dropped (P6). Its holders have nothing to attach to.
            unlabeledPositions++;
            continue;
        }
        const norm = normalizeHypothesisLabel(label);
        // Two positions normalizing to one label (an LLM emitting
        // 'Lab origin' / 'Lab Origin') are ONE hypothesis: union the
        // holders, keep the first core_argument — nothing dropped.
        const existing = rowByNorm.get(norm);
        if (existing) {
            const seen = new Set(existing.holders.map((h) => h.article_hash));
            for (const h of holders) {
                if (!seen.has(h.article_hash)) { existing.holders.push(h); seen.add(h.article_hash); }
            }
            if (!existing.core_argument && coreArgument) existing.core_argument = coreArgument;
            continue;
        }
        const match = persistedByLabel.get(norm) || null;
        if (match) consumed.add(match.id);
        const row = {
            id:            match ? match.id : `seed:${norm}`,
            label:         match ? match.label : label,
            statement:     match && match.statement
                               ? match.statement
                               : coreArgument || label,
            note:          match ? (match.note || '') : '',
            suggested_by:  match ? match.suggested_by : 'seed:brief',
            persisted:     !!match,
            seeded:        true,
            core_argument: coreArgument,
            holders
        };
        rows.push(row);
        rowByNorm.set(norm, row);
    }
    for (const h of persisted) {
        if (consumed.has(h.id)) continue;
        rows.push({
            id:            h.id,
            label:         h.label,
            statement:     h.statement || h.label,
            note:          h.note || '',
            suggested_by:  h.suggested_by || 'user',
            persisted:     true,
            seeded:        false,
            core_argument: null,
            holders:       []
        });
    }

    // ---- edges grouped under their hypothesis by role; an edge whose
    //      hypothesis is not in the map is DISCLOSED, never dropped.
    const rowById = new Map(rows.map((r) => [r.id, r]));
    for (const r of rows) r.edges = { supports: [], undermines: [] };
    const danglingEdges = [];
    for (const e of edges) {
        const view = edgeView(data, e, orbitClaimIds);
        const row = rowById.get(e.hypothesis_id);
        if (row && (e.role === 'supports' || e.role === 'undermines')) {
            row.edges[e.role].push(view);
        } else {
            danglingEdges.push({ ...view, hypothesis_id: e.hypothesis_id });
        }
    }
    for (const r of rows) {
        r.coverage = {
            supports:   r.edges.supports.length,
            undermines: r.edges.undermines.length
        };
    }

    // ---- shared claims: one claim edged under 2+ hypotheses. When
    //      the roles diverge (supports somewhere, undermines
    //      elsewhere) it is a CRUX made legible — flagged, not netted.
    const byRef = new Map();
    for (const r of rows) {
        for (const role of ['supports', 'undermines']) {
            for (const v of r.edges[role]) {
                if (!byRef.has(v.ref)) byRef.set(v.ref, { claim: v.claim, entries: [] });
                const agg = byRef.get(v.ref);
                // Sibling edges to one ref may differ in resolvability
                // (one carries a snapshot, one doesn't) — keep the
                // first resolvable view rather than a first-seen null.
                if (!agg.claim && v.claim) agg.claim = v.claim;
                agg.entries.push({ hypothesis_id: r.id, role });
            }
        }
    }
    const sharedClaims = [];
    for (const [ref, agg] of byRef) {
        const hypIds = new Set(agg.entries.map((x) => x.hypothesis_id));
        if (hypIds.size < 2) continue;
        const roles = new Set(agg.entries.map((x) => x.role));
        sharedClaims.push({
            ref,
            claim:    agg.claim,
            entries:  agg.entries,
            opposing: roles.has('supports') && roles.has('undermines')
        });
    }
    sharedClaims.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));

    const edgeCount = rows.reduce(
        (n, r) => n + r.edges.supports.length + r.edges.undermines.length, 0);

    return {
        case: { id: data.case.id, name: data.case.name },
        generated_at: generatedAt,
        question: readScopeQuestion(data),
        hypotheses: rows,
        shared_claims: sharedClaims,
        dangling: { edges: danglingEdges },
        coverage: {
            hypotheses:          rows.length,
            seeded:              rows.filter((r) => r.seeded).length,
            persisted:           rows.filter((r) => r.persisted).length,
            edges:               edgeCount,
            supports:            rows.reduce((n, r) => n + r.edges.supports.length, 0),
            undermines:          rows.reduce((n, r) => n + r.edges.undermines.length, 0),
            claims:              byRef.size,
            shared_claims:       sharedClaims.length,
            opposing_claims:     sharedClaims.filter((s) => s.opposing).length,
            dangling_edges:      danglingEdges.length,
            unlabeled_positions: unlabeledPositions
        }
    };
}

/** Collect + build. `options.generatedAt` injected for determinism. */
export async function assembleHypothesisMap(caseEntityId, options = {}) {
    const input = await collectHypothesisMapData(caseEntityId, options);
    return buildHypothesisMap(input, options.generatedAt ?? null);
}

/**
 * The hypothesis-edge join rows the structural counterfactual consumes
 * (CF.1 `options.hypothesisEdges`): one storage read of both models,
 * refs re-canonicalized, labels resolved.
 */
export async function collectHypothesisEdgeJoins(caseEntityId) {
    const hypotheses = await HypothesisModel.getForCase(caseEntityId);
    const labelById = new Map(hypotheses.map((h) => [h.id, h.label]));
    const edges = await HypothesisEdgeModel.getForCase(caseEntityId);
    const canon = await makeClaimRefCanonicalizer();
    return edges.map((e) => ({
        hypothesis_id: e.hypothesis_id,
        label:         labelById.get(e.hypothesis_id) || e.hypothesis_id,
        ref:           canon(e.claim_ref),
        role:          e.role,
        edge_id:       e.id
    }));
}

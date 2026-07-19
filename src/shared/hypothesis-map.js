// Hypothesis map — Phase 26 / H.1 (docs/HYPOTHESIS_MAP_DESIGN.md).
//
// A STRUCTURAL argument map: competing answers to a case's scope
// question (hypotheses), each with captured claims (or whole holder
// sources) attached as SUPPORTING or UNDERMINING edges. Rendered side
// by side; the model NEVER picks a winner; there is NO score,
// probability, likelihood, weight, confidence, or strength anywhere —
// on a hypothesis or an edge — ever. That is the epistemic firewall
// (PHILOSOPHY.md P8 + Red Lines; TRUTH_ADJUDICATION_DESIGN.md §1 "never
// '73% true'"; CASE_DOSSIER_DESIGN.md §2.2 "no case-level score, ever").
// A key-grep test in tests/hypothesis-map.test.mjs forbids the numeric
// slots.
//
// This is the PURE half (H.1): the model + a deterministic assembler
// over a stored synthesis brief's `positions` (+ collectCaseDossierData
// for coverage) + any human-drawn edges. No DOM, no LLM, no storage, no
// wire kind. Rendering is H.2; the manual attach affordance is H.3; the
// LLM edge-suggestion path (map/reduce firewall, human-accept) is H.4.
//
// Seed granularity (a deliberate, second-guessable call — see
// docs/JOURNAL.md): a synthesis `position` asserts membership at the
// ARTICLE level ("this whole source holds this position"), so its
// `holders` seed ARTICLE-LEVEL `supports` edges (claim_ref = null,
// article_hash set, provenance 'synthesis'). Promotion to specific
// claim→hypothesis edges is exactly the human (H.3) / LLM (H.4) step
// the design calls "promote to claim-level" — H.1 never fabricates a
// per-claim assertion the synthesis did not make.

// The only two edge roles. Frozen so no third "neutral"/"weight"-shaped
// role can slip in and become a tally axis.
export const EDGE_ROLES = Object.freeze(['supports', 'undermines']);

// Provenance vocabulary. `synthesis` = seeded from the stored corpus
// brief (itself LLM-generated, human-reviewed at brief-acceptance);
// `user` = a human drew the edge; `llm:<model>` = an accepted H.4
// suggestion. Never a number — provenance is who drew it, not how strong.
function isValidProvenance(p) {
    return p === 'user' || p === 'synthesis'
        || (typeof p === 'string' && p.startsWith('llm:') && p.length > 4);
}

/**
 * Deterministic, human-readable, label-derived hypothesis id. Stable
 * across re-assembly as long as the position label is unchanged, so a
 * human edge keyed by `hypothesis_id` survives re-synthesis. Collisions
 * are disambiguated by the assembler (a `-2`, `-3` suffix).
 */
export function hypothesisId(label) {
    const slug = String(label == null ? '' : label)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    return 'hyp_' + (slug || 'unlabeled');
}

/**
 * Normalize one edge to EXACTLY the allowed keys — no numeric slot can
 * ride along even if a caller passes one. Returns null for a malformed
 * edge (unknown role), which the assembler drops (authoring UI only
 * ever emits valid roles; this is defensive).
 */
export function claimEdge({ claim_ref = null, role, provenance = 'user', article_hash = null, quote = null } = {}) {
    if (!EDGE_ROLES.includes(role)) return null;
    const prov = isValidProvenance(provenance) ? provenance : 'user';
    const edge = { claim_ref: claim_ref || null, role, provenance: prov };
    if (article_hash) edge.article_hash = article_hash;
    if (quote) edge.quote = quote;
    return edge;
}

// A stable identity for an edge WITHIN a hypothesis, for dedup. An
// article-level seed (claim_ref null) and a claim-level edge never
// collide; two edges to the same target + same role do.
function edgeKey(edge) {
    const target = edge.claim_ref || (edge.article_hash ? `article:${edge.article_hash}` : 'none');
    return `${target}|${edge.role}`;
}

/**
 * Assemble the structural hypothesis map. PURE + deterministic: same
 * inputs → deep-equal output.
 *
 * @param {object}   params
 * @param {string?}  params.question    the case scope question (author's framing)
 * @param {Array}    params.positions   stored brief positions
 *                     [{label, core_argument, holders:[{article_hash}]}]
 * @param {Array}    params.humanEdges  carried human-drawn edges
 *                     [{hypothesis_id, claim_ref?, role, provenance?, article_hash?, quote?}]
 *                     (hypothesis_label optional, used to re-anchor if the
 *                      id-slug ever changes; persistence is H.3)
 * @param {object?}  params.dossierData collectCaseDossierData output — used
 *                     only for neutral corpus-wide coverage counts.
 * @returns {{question, hypotheses, orphaned_edges, coverage}}
 */
export function buildHypothesisMap({ question = null, positions = [], humanEdges = [], dossierData = null } = {}) {
    // --- Seed hypotheses from positions (label + statement), each with
    //     article-level `supports` edges from its holders. Order is
    //     presentation, NEVER rank (the render says so).
    const hypotheses = [];
    const byId = new Map();
    const usedIds = new Set();
    let seededEdgeCount = 0;

    for (const p of positions || []) {
        if (!p) continue;
        let id = hypothesisId(p.label);
        if (usedIds.has(id)) {
            let n = 2;
            while (usedIds.has(`${id}-${n}`)) n += 1;
            id = `${id}-${n}`;
        }
        usedIds.add(id);

        const hyp = {
            id,
            label: String(p.label || 'Position'),
            statement: String(p.core_argument || ''),
            edges: []
        };
        const seen = new Set();
        for (const h of p.holders || []) {
            const hash = h && h.article_hash;
            if (!hash) continue;
            const edge = claimEdge({ role: 'supports', provenance: 'synthesis', article_hash: hash });
            const k = edgeKey(edge);
            if (seen.has(k)) continue;
            seen.add(k);
            hyp.edges.push(edge);
            seededEdgeCount += 1;
        }
        hypotheses.push(hyp);
        byId.set(id, { hyp, seen });
    }

    // --- Carry human-drawn edges onto their hypotheses. An edge whose
    //     `hypothesis_id` matches no seeded hypothesis is NOT dropped
    //     (P6 — never silently lose coverage): it lands in
    //     `orphaned_edges` for the render to surface ("N human edges no
    //     longer attach to a current position").
    const orphaned = [];
    let carriedEdgeCount = 0;
    for (const he of humanEdges || []) {
        if (!he) continue;
        const edge = claimEdge({
            claim_ref: he.claim_ref, role: he.role,
            provenance: he.provenance || 'user',
            article_hash: he.article_hash, quote: he.quote
        });
        if (!edge) continue;   // malformed role — defensive drop
        const target = byId.get(he.hypothesis_id);
        if (!target) {
            orphaned.push({ hypothesis_id: he.hypothesis_id || null, ...edge });
            continue;
        }
        const k = edgeKey(edge);
        if (target.seen.has(k)) {
            // A user confirmation supersedes a synthesis seed at the same
            // target+role: replace the seeded edge in place.
            const idx = target.hyp.edges.findIndex((e) => edgeKey(e) === k);
            if (idx >= 0 && target.hyp.edges[idx].provenance === 'synthesis' && edge.provenance !== 'synthesis') {
                target.hyp.edges[idx] = edge;
            }
            continue;
        }
        target.seen.add(k);
        target.hyp.edges.push(edge);
        carriedEdgeCount += 1;
    }

    // Corpus-wide, NEUTRAL totals only — never a per-hypothesis
    // scoreboard (each hypothesis's supporting/undermining section size
    // is a render-time count, never cross-compared here).
    const coverage = {
        hypotheses: hypotheses.length,
        seeded_from_positions: seededEdgeCount,
        human_edges: carriedEdgeCount,
        orphaned_edges: orphaned.length
    };
    if (dossierData && dossierData.orbit) {
        coverage.orbit_claims = (dossierData.orbit.claims || []).length;
    }

    return {
        question: question || null,
        hypotheses,
        orphaned_edges: orphaned,
        coverage
    };
}

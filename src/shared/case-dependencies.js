// Case dependencies — the pure walks (claim dependency D.2,
// docs/CLAIM_DEPENDENCY_DESIGN.md §2.3, §3.1–§3.3).
//
// Substrate: `links.dependencies` from collectCaseDossierData — every
// kind-30055 `depends-on` link with an orbit endpoint, endpoints
// pre-canonicalized. A link { source_ref, target_ref } means SOURCE
// DEPENDS ON TARGET: the source claim cannot be true unless the target
// claim is true (a necessary condition — distinct from `supports`,
// which is evidential). Several dependencies behave like AND.
//
// What this module computes, all as COUNTS WITH DERIVATIONS and
// nothing else (CONSTITUTION Art. 5.3 — dependency counts are
// measurements):
//   - dependentsOf / claimLoad — the claims that transitively depend on
//     one claim (§3.1 "load-bearing (n dependents)"; §3.2 the set
//     undercut if the claim were false);
//   - premisesOf — the reverse walk;
//   - findDependencyCycles — circular reasoning, reported never
//     refused (§2.3);
//   - sharedPremises — one premise under two or more of a hypothesis's
//     supporting edges (§3.3: the I-5 independence rule, structural).
//
// ONLY FALSITY PROPAGATES. There is no "assume true" walk here and
// none may be added: the truth of a premise establishes nothing about
// its dependents (§3.2, §6 red line 1). No output carries a
// probability, likelihood, confidence, score, weight or strength; a
// number with no derivation beside it is a bug (§2.4).
//
// Pure and synchronous: no storage, no clock, no DOM. Every walk uses
// a visited set and terminates on any graph; neighbors are visited in
// sorted link-id order so the one chain shown per claim is
// deterministic whatever order the links arrived in.

import { STANDARD_OF_PROOF_LABELS, VERDICT_STATE_LABELS, VERDICT_STATES } from './truth-taxonomy.js';

const byRef = (a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const isDependency = (l) => l && l.relationship === 'depends-on' && l.source_ref && l.target_ref;

/**
 * Adjacency keyed on the walk's origin side. `direction: 'dependents'`
 * steps target → source (who rests on me); `'premises'` steps
 * source → target (what I rest on). Links sorted by id per key.
 */
function adjacency(dependencies, direction) {
    const map = new Map();
    const from = direction === 'dependents' ? 'target_ref' : 'source_ref';
    for (const l of (dependencies || []).filter(isDependency)) {
        if (!map.has(l[from])) map.set(l[from], []);
        map.get(l[from]).push(l);
    }
    for (const list of map.values()) list.sort(byId);
    return map;
}

/**
 * Breadth-first closure from `ref`. Each reached claim gets ONE chain
 * (the first found in sorted order), `derivation` = the link ids
 * along THAT chain, and `meeting_links` = every other link that also
 * reached it (a diamond shows one path and still names both edges).
 * The chain's links are copied per row, never shared, so a meeting
 * link on one node never leaks into the rows below it. `ref` itself
 * is never listed.
 */
function closure(dependencies, ref, direction) {
    const start = String(ref || '').trim();
    if (!start) return { count: 0, derivation: [] };
    const adj = adjacency(dependencies, direction);
    const next = direction === 'dependents' ? 'source_ref' : 'target_ref';
    const reached = new Map();          // ref → { ref, chain, derivation, meeting_links }
    const queue = [{ ref: start, chain: [start], path: [] }];
    const visited = new Set([start]);
    for (let i = 0; i < queue.length; i += 1) {
        const cur = queue[i];
        for (const l of adj.get(cur.ref) || []) {
            const to = l[next];
            if (reached.has(to)) {
                const row = reached.get(to);
                if (!row.derivation.includes(l.id) && !row.meeting_links.includes(l.id)) row.meeting_links.push(l.id);
                continue;
            }
            if (visited.has(to)) continue;   // the start node, on a cycle back to it
            visited.add(to);
            const path = [...cur.path, l.id];
            reached.set(to, { ref: to, chain: [...cur.chain, to], derivation: path, meeting_links: [] });
            queue.push({ ref: to, chain: [...cur.chain, to], path });
        }
    }
    const derivation = [...reached.values()].sort(byRef);
    return { count: derivation.length, derivation };
}

/** Every claim that transitively depends on `ref` (chain: ref … dependent). */
export function dependentsOf(dependencies, ref) {
    return closure(dependencies, ref, 'dependents');
}

/** Every claim `ref` transitively depends on (chain: ref … premise). */
export function premisesOf(dependencies, ref) {
    return closure(dependencies, ref, 'premises');
}

/** The §3.1 surface: a claim's load IS its transitive dependents. */
export function claimLoad(dependencies, ref) {
    return dependentsOf(dependencies, ref);
}

/**
 * Strongly connected components of size >= 2 over the dependency
 * graph — circular reasoning. Tarjan (recursive) over sorted refs.
 * Each component: { refs (sorted), derivation: the link ids inside it }.
 */
export function findDependencyCycles(dependencies) {
    const links = (dependencies || []).filter(isDependency).slice().sort(byId);
    const adj = new Map();
    const nodes = new Set();
    for (const l of links) {
        nodes.add(l.source_ref); nodes.add(l.target_ref);
        if (!adj.has(l.source_ref)) adj.set(l.source_ref, []);
        adj.get(l.source_ref).push(l.target_ref);
    }
    const index = new Map(); const low = new Map(); const onStack = new Set();
    const stack = []; let counter = 0; const components = [];
    const strongconnect = (v) => {
        index.set(v, counter); low.set(v, counter); counter += 1;
        stack.push(v); onStack.add(v);
        for (const w of adj.get(v) || []) {
            if (!index.has(w)) { strongconnect(w); low.set(v, Math.min(low.get(v), low.get(w))); }
            else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
        }
        if (low.get(v) === index.get(v)) {
            const comp = [];
            let w;
            do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
            if (comp.length >= 2) components.push(comp.sort());
        }
    };
    for (const v of [...nodes].sort()) if (!index.has(v)) strongconnect(v);
    const derivation = components
        .map((refs) => {
            const inside = new Set(refs);
            return {
                refs,
                derivation: links.filter((l) => inside.has(l.source_ref) && inside.has(l.target_ref)).map((l) => l.id)
            };
        })
        .sort((a, b) => (a.refs[0] < b.refs[0] ? -1 : a.refs[0] > b.refs[0] ? 1 : 0));
    return { count: derivation.length, derivation };
}

/**
 * §3.3 — shared premises, the I-5 independence rule made structural:
 * for each hypothesis, every claim that TWO OR MORE of its supporting
 * ARGUMENTS rest on — where an argument is a distinct supporting
 * CLAIM (two edges from one claim, e.g. an alias and its canonical
 * ref, are one argument), and a claim counts as resting on itself
 * (chain `[claim]`, no links): a supporting claim that another
 * supporting claim depends on is itself the premise they share. Two
 * arguments resting on one premise are not independent; the surface
 * names the premise, never discounts or re-sorts the edges.
 * `undermines` edges are ignored (the rule is about correlated
 * support). Rows sorted by hypothesis_id, then premise_ref.
 *
 * `hypothesisEdges`: [{ hypothesis_id, label, ref, role, edge_id }]
 * as collectHypothesisEdgeJoins returns them.
 */
export function sharedPremises(dependencies, hypothesisEdges) {
    const byHyp = new Map();
    for (const e of hypothesisEdges || []) {
        if (!e || e.role !== 'supports' || !e.ref || !e.hypothesis_id) continue;
        if (!byHyp.has(e.hypothesis_id)) byHyp.set(e.hypothesis_id, { label: e.label || e.hypothesis_id, edges: [] });
        byHyp.get(e.hypothesis_id).edges.push(e);
    }
    const byEdgeId = (a, b) => (a.edge_id < b.edge_id ? -1 : a.edge_id > b.edge_id ? 1 : 0);
    const rows = [];
    for (const [hypothesisId, { label, edges }] of byHyp) {
        if (new Set(edges.map((e) => e.ref)).size < 2) continue;
        const byPremise = new Map();          // premise_ref → [{ edge_id, claim_ref, chain, links }]
        const hit = (premiseRef, row) => {
            if (!byPremise.has(premiseRef)) byPremise.set(premiseRef, []);
            byPremise.get(premiseRef).push(row);
        };
        for (const e of edges.slice().sort(byEdgeId)) {
            hit(e.ref, { edge_id: e.edge_id, claim_ref: e.ref, chain: [e.ref], links: [] });
            for (const p of premisesOf(dependencies, e.ref).derivation) {
                hit(p.ref, { edge_id: e.edge_id, claim_ref: e.ref, chain: p.chain, links: p.derivation });
            }
        }
        for (const [premiseRef, hits] of byPremise) {
            if (new Set(hits.map((h) => h.claim_ref)).size < 2) continue;
            const derivation = [];
            for (const h of hits) for (const id of h.links) if (!derivation.includes(id)) derivation.push(id);
            rows.push({
                hypothesis_id: hypothesisId,
                label,
                premise_ref: premiseRef,
                edges: hits.map(({ edge_id, claim_ref, chain }) => ({ edge_id, claim_ref, chain })),
                derivation
            });
        }
    }
    rows.sort((a, b) => (a.hypothesis_id < b.hypothesis_id ? -1 : a.hypothesis_id > b.hypothesis_id ? 1
        : a.premise_ref < b.premise_ref ? -1 : a.premise_ref > b.premise_ref ? 1 : 0));
    return { count: rows.length, derivation: rows };
}

// ------------------------------------------------------------------
// D.3 — the load chip's strings (§3.1, §5). Pure: the DOM projects
// them 1:1. "Load-bearing" in the UI means THIS measured count and
// nothing else; it is a per-claim section size, never compared
// across claims.
// ------------------------------------------------------------------

/** `Load-bearing (n dependents)`, or '' when nothing depends on the claim. */
export function loadLabel(load) {
    const n = (load && load.count) || 0;
    if (n === 0) return '';
    return `Load-bearing (${n} ${n === 1 ? 'dependent' : 'dependents'})`;
}

/** One line per dependent — its text (or ref) and the chain that reaches it. */
export function loadTooltip(load, claimsById = {}) {
    const rows = ((load && load.derivation) || []).map((d) => {
        const c = claimsById[d.ref];
        const name = c && c.text ? `“${String(c.text).slice(0, 120)}”` : d.ref;
        return `${name} (via ${d.chain.join(' → ')})`;
    });
    return ['Claims that cannot be true unless this one is:', ...rows].join('\n');
}

// ------------------------------------------------------------------
// D.4 — the live per-adjudicator badge (§3.4; R-026). A derived view
// over ONE family's published record (kind 30063): no number is
// produced, no state is written onto any claim, and every marker names
// WHO adjudicated and BY WHAT STANDARD, beside the full distribution of
// the other verdicts on that premise. One marker per established-false
// verdict — never merged, no majority, no consensus, no threshold. The
// dependent's own verdicts are listed beside the markers and read only
// to name an inconsistency (same adjudicator on both sides) or a
// disagreement (different adjudicators); none is recomputed (§6 red
// lines 3 and 3a).
//
// Verdicts in view, one shape: every un-superseded LOCAL record on a
// proposition (a merge-import can leave two heads — both are listed,
// neither dropped) and every live WIRE row (parsed kind-30063 events:
// the newest per (author, d) and none another row supersedes). A local
// record with no adjudicator is "an unnamed adjudicator (local
// record)" — this X-Ray usually, but a merge-import can carry someone
// else's, so the label names the record, never a person. Wire rows are keyed by
// EVENT id: the parser's `id` is the d tag, the same for every author's
// verdict on one proposition.
//
// Still pure: labels from truth-taxonomy.js only; counts by state and
// standard are computed here (the adjudication model's verdictVariance
// would pull storage into this module).
// ------------------------------------------------------------------

export const PREMISE_INCONSISTENCY_TITLE =
    'Both verdicts stand as their adjudicators left them: the claim\'s own and the premise\'s. Nothing here corrects, weighs or recomputes either.';
const PREMISE_MARKER_CLOSING =
    'One adjudicator\'s verdict, shown beside the others. No verdict on this claim is recomputed.';
export const MAX_PREMISE_MARKERS = 4;

const shortPubkey = (pk) => (pk ? `${String(pk).slice(0, 12)}…` : null);
const standardLabel = (st) => STANDARD_OF_PROOF_LABELS[st] || st || 'no standard stated';
const stateLabel = (st) => VERDICT_STATE_LABELS[st] || st;

function localAuthor(v) {
    const a = v && v.adjudicator;
    if (a && a.label) return a.label;
    if (a && a.pubkey) return shortPubkey(a.pubkey);
    return 'this X-Ray\'s record (no adjudicator named)';
}

/** Live wire rows on one proposition: newest per (pubkey, d), minus any row another row supersedes. */
function liveWireRows(data, propositionId) {
    const rows = ((data.wire && data.wire.verdicts) || []).filter((w) => w && w.proposition_id === propositionId && w.verdict);
    const newest = new Map();
    for (const w of rows) {
        const key = `${w.pubkey || ''}|${w.id || ''}`;
        const prev = newest.get(key);
        if (!prev || (w.created_at || 0) > (prev.created_at || 0)) newest.set(key, w);
    }
    const kept = [...newest.values()];
    const superseded = new Set(kept.map((w) => w.supersedesEventId).filter(Boolean));
    return kept.filter((w) => !superseded.has(w.eventId));
}

/** Every verdict in view on one proposition: local heads + live wire rows, one shape. */
function verdictsInView(data, propositionId) {
    const chain = ((data.verdicts && data.verdicts.byProposition) || {})[propositionId] || [];
    const rows = [];
    for (const v of chain.filter((x) => x && !x.superseded_by && x.verdict).sort(byId)) {
        rows.push({ id: v.id, verdict: v.verdict, standard: v.standard_of_proof || null, author: localAuthor(v),
            author_key: (v.adjudicator && (v.adjudicator.pubkey || v.adjudicator.label)) || null, source: 'local', proposition_id: propositionId });
    }
    for (const w of liveWireRows(data, propositionId).sort((a, b) => ((a.eventId || '') < (b.eventId || '') ? -1 : 1))) {
        rows.push({ id: w.eventId || `${w.pubkey || ''}:${w.id || ''}`, verdict: w.verdict, standard: w.standardOfProof || w.standard_of_proof || null,
            author: shortPubkey(w.pubkey) || 'unknown author', author_key: w.pubkey || null, source: 'wire', proposition_id: propositionId });
    }
    return rows;
}

/** Counts by state and by standard, each state's authors — no flag that reads as agreement. */
function distributionOf(rows) {
    const byState = {}; const byStandard = {}; const authorsByState = {};
    for (const r of rows) {
        byState[r.verdict] = (byState[r.verdict] || 0) + 1;
        if (r.standard) byStandard[r.standard] = (byStandard[r.standard] || 0) + 1;
        (authorsByState[r.verdict] ||= []).push({ author: r.author, standard: r.standard, source: r.source, id: r.id });
    }
    return { total: rows.length, by_state: byState, by_standard: byStandard, authors_by_state: authorsByState };
}

const propsOf = (data, ref) => Object.values((data.propositions && data.propositions.all) || {})
    .filter((p) => p && p.claim_id === ref).sort(byId);

/**
 * One row per established-false verdict on any transitive premise of
 * `ref`, each carrying the premise's whole distribution; `own` = every
 * verdict in view on the dependent's own propositions (listed, never
 * changed); `inconsistencies` = one row per (own established-true
 * verdict × false premise verdict), stamped `same_author`.
 */
export function premiseVerdictMarkers(data, ref) {
    const empty = { count: 0, derivation: [], own: [], inconsistencies: [], inconsistency: false };
    if (!data) return empty;
    const deps = (data.links && data.links.dependencies) || [];
    const premises = premisesOf(deps, ref).derivation;
    if (premises.length === 0) return empty;
    const rows = [];
    for (const p of premises) {
        for (const prop of propsOf(data, p.ref)) {
            const inView = verdictsInView(data, prop.id);
            if (inView.length === 0) continue;
            const distribution = distributionOf(inView);
            for (const v of inView) {
                if (v.verdict !== 'established-false') continue;
                rows.push({
                    premise_ref: p.ref, chain: p.chain, proposition_id: prop.id, proposition_class: prop.proposition_class,
                    verdict_id: v.id, source: v.source, author: v.author, author_key: v.author_key, standard: v.standard,
                    distribution, derivation: p.derivation
                });
            }
        }
    }
    rows.sort((a, b) => (a.premise_ref < b.premise_ref ? -1 : a.premise_ref > b.premise_ref ? 1
        : a.source !== b.source ? (a.source === 'local' ? -1 : 1)
            : a.verdict_id < b.verdict_id ? -1 : a.verdict_id > b.verdict_id ? 1 : 0));
    const own = [];
    for (const prop of propsOf(data, ref)) {
        for (const v of verdictsInView(data, prop.id)) own.push({ ...v, proposition_class: prop.proposition_class });
    }
    const inconsistencies = [];
    for (const o of own) {
        if (o.verdict !== 'established-true') continue;
        for (const premise of rows) {
            inconsistencies.push({ own: o, premise, same_author: Boolean(o.author_key) && o.author_key === premise.author_key });
        }
    }
    return { count: rows.length, derivation: rows, own, inconsistencies, inconsistency: inconsistencies.length > 0 };
}

/** `premise adjudicated false by <author> under <standard>` — never "is false". */
export function premiseMarkerLabel(row) {
    return `premise adjudicated false by ${row.author} under ${standardLabel(row.standard)}`;
}

/** The premise, every state in view with its authors and standards, and the fixed closing line. */
export function premiseMarkerTooltip(row, claimsById = {}) {
    const c = claimsById[row.premise_ref];
    const name = c && c.text ? `“${String(c.text).slice(0, 120)}”` : row.premise_ref;
    const lines = [`Premise: ${name} (via ${row.chain.join(' → ')})`];
    for (const state of VERDICT_STATES) {
        const authors = row.distribution.authors_by_state[state];
        if (!authors || authors.length === 0) continue;
        lines.push(`${stateLabel(state)} ×${authors.length} — ${authors.map((a) => `${a.author} (${standardLabel(a.standard)})`).join(', ')}`);
    }
    lines.push(PREMISE_MARKER_CLOSING);
    return lines.join('\n');
}

/** `verdict: <state> — by <author> under <standard>` for one of the dependent's own verdicts. */
export function ownVerdictLabel(o) {
    return `verdict: ${stateLabel(o.verdict)} — by ${o.author} under ${standardLabel(o.standard)}`;
}

/** Both sides named; the same adjudicator is an inconsistency, two adjudicators are a disagreement. */
export function inconsistencyLabel(i) {
    const head = `claim adjudicated true by ${i.own.author} under ${standardLabel(i.own.standard)}; `
        + `premise adjudicated false by ${i.premise.author} under ${standardLabel(i.premise.standard)}`;
    return i.same_author
        ? `${head} — an inconsistency, not a correction`
        : `${head} — two adjudicators disagree; neither corrects the other`;
}

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

import { verdictVariance } from './truth-adjudication-model.js';
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
// dependent's own verdict is read only to name an inconsistency; it is
// never recomputed (§6 red lines 3 and 3a).
// ------------------------------------------------------------------

export const PREMISE_INCONSISTENCY_LABEL =
    'claim adjudicated true, premise adjudicated false — an inconsistency, not a correction';
const PREMISE_MARKER_CLOSING =
    'One adjudicator\'s verdict, shown beside the others. No verdict on this claim is recomputed.';

const shortPubkey = (pk) => (pk ? `${String(pk).slice(0, 12)}…` : null);

/** Local chain head: adjudicator label, else its pubkey, else this X-Ray. */
function localAuthor(v) {
    const a = v && v.adjudicator;
    if (a && a.label) return a.label;
    if (a && a.pubkey) return shortPubkey(a.pubkey);
    return 'you (this X-Ray)';
}

/** Every verdict in view on one proposition: local chain head + wire rows, one shape. */
function verdictsInView(data, propositionId) {
    const chain = ((data.verdicts && data.verdicts.byProposition) || {})[propositionId] || [];
    const head = chain.find((v) => !v.superseded_by) || null;
    const rows = [];
    if (head) {
        rows.push({ id: head.id, verdict: head.verdict, standard: head.standard_of_proof || null,
            author: localAuthor(head), author_pubkey: (head.adjudicator && head.adjudicator.pubkey) || null, source: 'local' });
    }
    for (const w of ((data.wire && data.wire.verdicts) || []).filter((x) => x && x.proposition_id === propositionId)) {
        rows.push({ id: w.id || w.eventId || '', verdict: w.verdict, standard: w.standardOfProof || w.standard_of_proof || null,
            author: shortPubkey(w.pubkey) || 'unknown author', author_pubkey: w.pubkey || null, source: 'wire' });
    }
    return rows;
}

function distributionOf(rows) {
    const variance = verdictVariance(rows.map((r) => ({ verdict: r.verdict, standard_of_proof: r.standard })));
    const authorsByState = {};
    for (const r of rows) {
        (authorsByState[r.verdict] ||= []).push({ author: r.author, standard: r.standard, source: r.source, id: r.id });
    }
    return { ...variance, authors_by_state: authorsByState };
}

/** The dependent's own chain-head state (first proposition by id), or null. */
function ownState(data, ref) {
    const all = (data.propositions && data.propositions.all) || {};
    const props = Object.values(all).filter((p) => p.claim_id === ref).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const p of props) {
        const head = verdictsInView(data, p.id).find((r) => r.source === 'local');
        if (head) return head.verdict;
    }
    return null;
}

/**
 * One row per established-false verdict on any transitive premise of
 * `ref`, each carrying the premise's whole distribution. `inconsistency`
 * when the dependent's own head is established-true (its state is
 * reported, never changed).
 */
export function premiseVerdictMarkers(data, ref) {
    const deps = (data && data.links && data.links.dependencies) || [];
    const premises = premisesOf(deps, ref).derivation;
    const all = (data && data.propositions && data.propositions.all) || {};
    const rows = [];
    for (const p of premises) {
        const props = Object.values(all).filter((x) => x.claim_id === p.ref).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        for (const prop of props) {
            const inView = verdictsInView(data, prop.id);
            const distribution = distributionOf(inView);
            for (const v of inView) {
                if (v.verdict !== 'established-false') continue;
                rows.push({
                    premise_ref: p.ref, chain: p.chain, proposition_id: prop.id, proposition_class: prop.proposition_class,
                    verdict_id: v.id, source: v.source, author: v.author, author_pubkey: v.author_pubkey, standard: v.standard,
                    distribution, derivation: p.derivation
                });
            }
        }
    }
    rows.sort((a, b) => (a.premise_ref < b.premise_ref ? -1 : a.premise_ref > b.premise_ref ? 1
        : a.verdict_id < b.verdict_id ? -1 : a.verdict_id > b.verdict_id ? 1 : 0));
    const own = data ? ownState(data, ref) : null;
    return { count: rows.length, derivation: rows, own_state: own, inconsistency: own === 'established-true' && rows.length > 0 };
}

const standardLabel = (s) => STANDARD_OF_PROOF_LABELS[s] || s || 'no standard stated';

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
        lines.push(`${VERDICT_STATE_LABELS[state] || state} ×${authors.length} — `
            + authors.map((a) => `${a.author} (${standardLabel(a.standard)})`).join(', '));
    }
    lines.push(PREMISE_MARKER_CLOSING);
    return lines.join('\n');
}

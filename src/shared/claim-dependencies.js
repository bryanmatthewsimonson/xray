// Claim dependencies — the pure walks (claim dependency D.2,
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
 * (the first found in sorted order) and a derivation listing every
 * link that reached it — so a diamond shows one path but names both
 * meeting edges. `ref` itself is never listed.
 */
function closure(dependencies, ref, direction) {
    const start = String(ref || '').trim();
    if (!start) return { count: 0, derivation: [] };
    const adj = adjacency(dependencies, direction);
    const next = direction === 'dependents' ? 'source_ref' : 'target_ref';
    const reached = new Map();          // ref → { ref, chain, derivation }
    const queue = [{ ref: start, chain: [start], links: [] }];
    const visited = new Set([start]);
    while (queue.length) {
        const cur = queue.shift();
        for (const l of adj.get(cur.ref) || []) {
            const to = l[next];
            if (reached.has(to)) {
                const row = reached.get(to);
                if (!row.derivation.includes(l.id)) row.derivation.push(l.id);
                continue;
            }
            if (visited.has(to)) continue;   // the start node, on a cycle back to it
            visited.add(to);
            const row = { ref: to, chain: [...cur.chain, to], derivation: [...cur.links, l.id] };
            reached.set(to, row);
            queue.push({ ref: to, chain: row.chain, links: row.derivation });
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
 * graph — circular reasoning. Tarjan, iterative over sorted refs.
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

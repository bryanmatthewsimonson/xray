// entity-health.js — the deterministic entity-dedupe report (Phase 17
// Part A, slice E1; docs/ENTITY_CORPUS_DESIGN.md §3.1). Pure detectors
// over passed snapshots + one storage surface (dismissals).
//
// The report SORTS BY SUSPICION, nothing more: every action (Merge…,
// Not duplicates, Unlink) is a human's. No LLM here — the designed
// LLM entity audit (E2) is a separate, gated pass. Detectors are
// conservative by construction (whole-token containment, never
// substring; within-type only) because a false merge is far more
// expensive than a missed duplicate — merges are undoable
// (unlinkAlias) but only when noticed.

import { Storage } from './storage.js';
import { canonicalIdOf } from './entity-model.js';
import { dismissalKey } from './entity-facts.js';
import { nameTokens } from './llm-proposals.js';

// ------------------------------------------------------------------
// Pair helpers
// ------------------------------------------------------------------

function pairKey(a, b) {
    return dismissalKey(a, b);
}

// Union-find over entity ids, for collapsing pairwise evidence into
// clusters. Tiny registries — no rank/path-compression heroics needed,
// but path halving keeps long chains honest.
function makeUnionFind() {
    const parent = new Map();
    const find = (x) => {
        if (!parent.has(x)) parent.set(x, x);
        let r = x;
        while (parent.get(r) !== r) r = parent.get(r);
        while (parent.get(x) !== r) { const next = parent.get(x); parent.set(x, r); x = next; }
        return r;
    };
    const union = (a, b) => { parent.set(find(a), find(b)); };
    return { find, union };
}

// ------------------------------------------------------------------
// Detectors — each returns evidence PAIRS:
//   { a, b, detector, reason, evidence }
// with a < b (id order) for determinism.
// ------------------------------------------------------------------

/**
 * (a) Name clusters: same type + normalized-name equality or
 * whole-token containment ("Mayor Elena Vargas" ⊇ "Elena Vargas") —
 * the disambiguation-word drift that mints duplicate ids. Bucketed by
 * shared first token to keep the pairwise pass off O(n²) registries.
 */
export function nameClusterPairs(entities) {
    const rows = (Array.isArray(entities) ? entities : Object.values(entities || {}))
        .filter((e) => e && e.id && e.name && e.type);
    const buckets = new Map();   // token → rows (a row lands in every token bucket)
    for (const e of rows) {
        for (const tok of nameTokens(e.name)) {
            if (!buckets.has(tok)) buckets.set(tok, []);
            buckets.get(tok).push(e);
        }
    }
    const out = new Map();       // pairKey → pair (dedupe across buckets)
    for (const group of buckets.values()) {
        if (group.length < 2) continue;
        for (let i = 0; i < group.length; i++) {
            for (let j = i + 1; j < group.length; j++) {
                const A = group[i], B = group[j];
                if (A.id === B.id || A.type !== B.type) continue;
                const key = pairKey(A.id, B.id);
                if (out.has(key)) continue;
                const ta = nameTokens(A.name), tb = nameTokens(B.name);
                const aInB = [...ta].every((x) => tb.has(x));
                const bInA = [...tb].every((x) => ta.has(x));
                if (!aInB && !bInA) continue;
                const [a, b] = [A, B].sort((x, y) => x.id < y.id ? -1 : 1);
                out.set(key, {
                    a: a.id, b: b.id, detector: 'name',
                    reason: (aInB && bInA) ? 'exact-normalized' : 'token-containment',
                    evidence: { name_a: a.name, name_b: b.name, type: a.type }
                });
            }
        }
    }
    return [...out.values()].sort((x, y) => (x.a + x.b) < (y.a + y.b) ? -1 : 1);
}

/**
 * (b) Shared platform accounts: two entities linked to account records
 * that carry the same platform identity (same platform + handle or
 * stableId). The registry key is deterministic per (platform,
 * stableId), so this catches the CROSS-key duplicates — e.g. one
 * record minted from a channelId and one from a handle, hand-linked to
 * two different entities.
 */
export function sharedAccountPairs(entities, accounts) {
    const entIndex = {};
    for (const e of (Array.isArray(entities) ? entities : Object.values(entities || {}))) {
        if (e && e.id) entIndex[e.id] = e;
    }
    const rows = (Array.isArray(accounts) ? accounts : Object.values(accounts || {}))
        .filter((a) => a && a.linkedEntityId && entIndex[a.linkedEntityId]);
    const groups = new Map();    // identity signal → account rows
    for (const acc of rows) {
        const signals = new Set();
        if (acc.stableId) signals.add(`${acc.platform}:id:${String(acc.stableId).toLowerCase()}`);
        if (acc.handle)   signals.add(`${acc.platform}:h:${String(acc.handle).toLowerCase()}`);
        for (const sig of signals) {
            if (!groups.has(sig)) groups.set(sig, []);
            groups.get(sig).push(acc);
        }
    }
    const out = new Map();
    for (const [sig, group] of groups) {
        const linked = [...new Set(group.map((a) => a.linkedEntityId))];
        if (linked.length < 2) continue;
        for (let i = 0; i < linked.length; i++) {
            for (let j = i + 1; j < linked.length; j++) {
                const [a, b] = [linked[i], linked[j]].sort();
                const key = pairKey(a, b);
                if (out.has(key)) continue;
                out.set(key, {
                    a, b, detector: 'account', reason: 'shared-platform-identity',
                    evidence: {
                        platform: group[0].platform,
                        signal: sig,
                        handles: [...new Set(group.map((x) => x.handle || x.stableId))]
                    }
                });
            }
        }
    }
    return [...out.values()].sort((x, y) => (x.a + x.b) < (y.a + y.b) ? -1 : 1);
}

/**
 * (c) Co-mention overlap: two same-type entities whose grounded
 * mention spans in the SAME article contain each other (whole-token
 * containment of one context inside the other). A tagger that marked
 * "Dr. Elena Vargas" and a second pass that marked "Elena Vargas" in
 * the same sentence is the classic double-mint.
 */
export function coMentionPairs(entities, articles) {
    const entIndex = {};
    for (const e of (Array.isArray(entities) ? entities : Object.values(entities || {}))) {
        if (e && e.id) entIndex[e.id] = e;
    }
    const out = new Map();
    for (const article of (Array.isArray(articles) ? articles : [])) {
        const refs = (article && Array.isArray(article.entities) ? article.entities : [])
            .filter((r) => r && r.entity_id && r.context && entIndex[r.entity_id]);
        for (let i = 0; i < refs.length; i++) {
            for (let j = i + 1; j < refs.length; j++) {
                const A = refs[i], B = refs[j];
                if (A.entity_id === B.entity_id) continue;
                const ea = entIndex[A.entity_id], eb = entIndex[B.entity_id];
                if (ea.type !== eb.type) continue;
                const ta = nameTokens(A.context), tb = nameTokens(B.context);
                if (ta.size === 0 || tb.size === 0) continue;
                const contained = [...ta].every((x) => tb.has(x)) || [...tb].every((x) => ta.has(x));
                if (!contained) continue;
                const [a, b] = [A.entity_id, B.entity_id].sort();
                const key = pairKey(a, b);
                if (out.has(key)) continue;
                out.set(key, {
                    a, b, detector: 'co-mention', reason: 'containing-spans',
                    evidence: {
                        article_url: article.url || '',
                        context_a: A.context, context_b: B.context
                    }
                });
            }
        }
    }
    return [...out.values()].sort((x, y) => (x.a + x.b) < (y.a + y.b) ? -1 : 1);
}

// ------------------------------------------------------------------
// The report
// ------------------------------------------------------------------

/**
 * The registry-wide duplicate report the Entity health panel renders.
 * Pairs already inside one alias family (canonicalIdOf equality) and
 * pairs the user dismissed ("Not duplicates") are filtered BEFORE
 * clustering. Deterministic over its inputs.
 *
 * @returns {{ clusters: [{ids, detectors, pairs, dismissal_keys}], counts }}
 */
export function dedupeReport({ entities = {}, accounts = {}, articles = [], dismissals = {} } = {}) {
    const records = Array.isArray(entities)
        ? Object.fromEntries(entities.map((e) => [e.id, e]))
        : entities;

    const allPairs = [
        ...nameClusterPairs(records),
        ...sharedAccountPairs(records, accounts),
        ...coMentionPairs(records, articles)
    ].filter((p) =>
        canonicalIdOf(p.a, records) !== canonicalIdOf(p.b, records)   // already one family
        && !dismissals[pairKey(p.a, p.b)]                              // human said no
    );

    const uf = makeUnionFind();
    for (const p of allPairs) uf.union(p.a, p.b);

    const byRoot = new Map();
    for (const p of allPairs) {
        const root = uf.find(p.a);
        if (!byRoot.has(root)) byRoot.set(root, []);
        byRoot.get(root).push(p);
    }

    const clusters = [...byRoot.values()].map((pairs) => {
        const ids = [...new Set(pairs.flatMap((p) => [p.a, p.b]))].sort();
        return {
            ids,
            detectors: [...new Set(pairs.map((p) => p.detector))].sort(),
            pairs,
            dismissal_keys: pairs.map((p) => pairKey(p.a, p.b))
        };
    }).sort((x, y) => y.ids.length - x.ids.length || (x.ids[0] < y.ids[0] ? -1 : 1));

    return {
        clusters,
        counts: {
            clusters: clusters.length,
            pairs: allPairs.length,
            by_detector: allPairs.reduce((acc, p) => {
                acc[p.detector] = (acc[p.detector] || 0) + 1;
                return acc;
            }, {})
        }
    };
}

/**
 * Recent merges (alias records, newest first) — feeds the panel's
 * Unlink list, the §3.3 undo. Pure over a snapshot.
 */
export function recentMerges(entities, { limit = 20 } = {}) {
    const rows = Array.isArray(entities) ? entities : Object.values(entities || {});
    return rows
        .filter((e) => e && e.canonical_id)
        .sort((a, b) => (b.updated || 0) - (a.updated || 0))
        .slice(0, limit)
        .map((e) => ({ id: e.id, name: e.name, type: e.type,
                       canonical_id: e.canonical_id, updated: e.updated || 0 }));
}

// ------------------------------------------------------------------
// Dismissals — "Not duplicates" is a judgment worth remembering.
// Key `entity_dedupe_dismissals` (WORKSPACE_CLEAR_KEYS-pinned).
// ------------------------------------------------------------------

const DISMISSALS_KEY = 'entity_dedupe_dismissals';

export const DedupeDismissals = {
    getAll: async () => await Storage.get(DISMISSALS_KEY, {}),

    dismiss: async (idA, idB, note = '') => {
        const all = await Storage.get(DISMISSALS_KEY, {});
        const key = pairKey(idA, idB);
        all[key] = { dismissed_at: Math.floor(Date.now() / 1000), note: String(note || '') };
        await Storage.set(DISMISSALS_KEY, all);
        return all[key];
    },

    undismiss: async (idA, idB) => {
        const all = await Storage.get(DISMISSALS_KEY, {});
        const key = pairKey(idA, idB);
        if (!all[key]) return false;
        delete all[key];
        await Storage.set(DISMISSALS_KEY, all);
        return true;
    }
};

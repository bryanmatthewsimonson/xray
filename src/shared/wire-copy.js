// Wire-copy scan — local shared-text detection across corpus members
// (founding-transcript integration R8; JOURNAL 2026-08-02).
//
// "Fifty outlets reported it" is often one wire story lightly
// re-headlined — apparent corroboration that is really one independent
// report. The corpus already refuses to MERGE artifacts on similarity
// (foldMemberAliases: different hashes never merge, P4/P9) and counts
// independence only from human-attested origin_keys
// (truth-attestation). This module is the third leg: a mechanical,
// local, no-LLM scan measuring verbatim token-shingle overlap between
// member texts, SUGGESTING origin groupings for a human to attest
// through the ordinary evidence-linker flow. It asserts nothing —
// output is pairs and connected groups with their overlap fractions on
// the face — and it never touches storage.
//
// Containment, not Jaccard, is the load-bearing number: a 400-word
// wire story embedded verbatim in a 2000-word piece is near-total
// containment of the shorter text at modest Jaccard. Both are
// reported; the threshold runs on containment.
//
// Pure: no chrome, no network, no DOM, no storage.

// Tokens per shingle. Eight consecutive tokens is long enough that a
// shared shingle is verbatim copying, not idiom ("the president said
// on Tuesday that the" barely clears five).
export const SHINGLE_SIZE = 8;

// Below this containment a pair is noise, not a suggestion.
export const CONTAINMENT_MIN = 0.5;

// Members with fewer shingles than this are skipped (and the skip is
// disclosed): overlap fractions over tiny texts are meaningless.
// ~100 shingles ≈ a 110-token text.
export const MIN_SHINGLES = 100;

function tokens(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

/** The member text's set of token shingles. Exported for tests. */
export function shingleSet(text, size = SHINGLE_SIZE) {
    const toks = tokens(text);
    const out = new Set();
    for (let i = 0; i + size <= toks.length; i += 1) {
        out.add(toks.slice(i, i + size).join(''));
    }
    return out;
}

/** Overlap stats for two shingle sets: jaccard + containment
 *  (shared / smaller set — the wire-copy-shaped number). */
export function pairOverlap(a, b) {
    if (!a || !b || a.size === 0 || b.size === 0) {
        return { shared: 0, jaccard: 0, containment: 0 };
    }
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    let shared = 0;
    for (const s of small) if (large.has(s)) shared += 1;
    return {
        shared,
        jaccard: shared / (a.size + b.size - shared),
        containment: shared / small.size
    };
}

/**
 * Scan corpus members for shared verbatim text.
 *
 * O(N²) pairwise over shingle sets — run on a click, not on paint.
 * At a few hundred members of ordinary article length this is well
 * under a second; the cost is memory for the shingle sets, which are
 * discarded on return.
 *
 * @param {Array<{articleHash, url, title, text}>} members
 * @param {object} [opts]
 * @param {number} [opts.shingleSize]
 * @param {number} [opts.containmentMin]
 * @param {number} [opts.minShingles]
 * @returns {{pairs: Array, groups: Array, scanned: number, skipped: Array}}
 *   pairs — above-threshold pairs, strongest first:
 *     {a, b, shared, jaccard, containment} (a/b = {articleHash, url, title})
 *   groups — connected components over qualifying pairs, largest first:
 *     {members: [{articleHash, url, title}], size, maxContainment, minContainment}
 *   skipped — [{articleHash, url, title, shingles}] below the floor
 */
export function scanForSharedText(members, {
    shingleSize = SHINGLE_SIZE,
    containmentMin = CONTAINMENT_MIN,
    minShingles = MIN_SHINGLES
} = {}) {
    const eligible = [];
    const skipped = [];
    for (const m of members || []) {
        if (!m || !m.articleHash) continue;
        const set = shingleSet(m.text, shingleSize);
        const brief = { articleHash: m.articleHash, url: m.url || null, title: m.title || null };
        if (set.size < minShingles) skipped.push({ ...brief, shingles: set.size });
        else eligible.push({ ...brief, set });
    }

    const pairs = [];
    for (let i = 0; i < eligible.length; i += 1) {
        for (let j = i + 1; j < eligible.length; j += 1) {
            const stats = pairOverlap(eligible[i].set, eligible[j].set);
            if (stats.containment < containmentMin) continue;
            const { set: _a, ...a } = eligible[i];
            const { set: _b, ...b } = eligible[j];
            pairs.push({
                a, b,
                shared: stats.shared,
                jaccard: Math.round(stats.jaccard * 100) / 100,
                containment: Math.round(stats.containment * 100) / 100
            });
        }
    }
    pairs.sort((x, y) => y.containment - x.containment);

    // Connected components over qualifying pairs — a three-outlet
    // reprint chain groups even when the two ends only clear the
    // threshold against the middle.
    const parent = new Map();
    const find = (k) => {
        let r = k;
        while (parent.get(r) !== r) r = parent.get(r);
        let c = k;
        while (parent.get(c) !== c) { const n = parent.get(c); parent.set(c, r); c = n; }
        return r;
    };
    const union = (x, y) => {
        if (!parent.has(x)) parent.set(x, x);
        if (!parent.has(y)) parent.set(y, y);
        const rx = find(x);
        const ry = find(y);
        if (rx !== ry) parent.set(rx, ry);
    };
    for (const p of pairs) union(p.a.articleHash, p.b.articleHash);

    const briefByHash = new Map();
    for (const e of eligible) briefByHash.set(e.articleHash, { articleHash: e.articleHash, url: e.url, title: e.title });
    const byRoot = new Map();
    for (const hash of parent.keys()) {
        const root = find(hash);
        if (!byRoot.has(root)) byRoot.set(root, []);
        byRoot.get(root).push(briefByHash.get(hash));
    }
    const groups = [];
    for (const groupMembers of byRoot.values()) {
        if (groupMembers.length < 2) continue;
        const hashes = new Set(groupMembers.map((m) => m.articleHash));
        const groupPairs = pairs.filter((p) => hashes.has(p.a.articleHash) && hashes.has(p.b.articleHash));
        groups.push({
            members: groupMembers,
            size: groupMembers.length,
            maxContainment: Math.max(...groupPairs.map((p) => p.containment)),
            minContainment: Math.min(...groupPairs.map((p) => p.containment))
        });
    }
    groups.sort((x, y) => y.size - x.size || y.maxContainment - x.maxContainment);

    return { pairs, groups, scanned: eligible.length, skipped };
}

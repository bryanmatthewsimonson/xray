// Corpus epistemics rollup — CA.3 (docs/CORPUS_AUDIT_KICKOFF.md §4).
// A DERIVED view over the case's audited members: per-member scores,
// the corpus score RANGE, per-module ranges, ceiling counts. The §10
// red lines hold structurally: there is no mean, no fused corpus
// score, no field a renderer could mistake for one — distributions
// only (P8), reproducible from the runs ledger by anyone (§9).
//
// Pure: rows are deriveArticleRows output (article_hashes carry the
// run join), runs are the ledger (listRuns()); the captureArticleHash
// alias joins truncated-capture runs exactly as everywhere else.

export function corpusAuditRollup({ rows = [], runs = [] } = {}) {
    const byHash = new Map();
    for (const r of runs) {
        if (!r) continue;
        if (r.articleHash) byHash.set(r.articleHash, r);
        if (r.captureArticleHash) byHash.set(r.captureArticleHash, r);
    }

    const members = [];
    let unaudited = 0;
    for (const row of rows) {
        if (!row || !row.url) continue;
        const run = (row.article_hashes || []).map((h) => byHash.get(h)).find(Boolean);
        if (!run) { unaudited++; continue; }
        const ag = run.aggregate || {};
        members.push({
            url: row.url,
            title: row.title || row.url,
            score: Number.isFinite(ag.final_score) ? ag.final_score : null,
            confidence: Number.isFinite(ag.overall_confidence) ? ag.overall_confidence : null,
            ceiling: Number.isFinite(ag.knowability_ceiling) ? ag.knowability_ceiling : null,
            ceilingBinding: !!ag.ceiling_binding,
            concerns: Array.isArray(ag.top_concerns) ? ag.top_concerns.length : 0,
            _run: run
        });
    }
    // Lowest score first — the reading order that matters for review;
    // scoreless runs (all modules failed validation) sort last.
    members.sort((a, b) => ((a.score ?? 101) - (b.score ?? 101))
        || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));

    const scores = members.map((m) => m.score).filter((s) => s != null).sort((a, b) => a - b);

    const moduleStats = new Map();
    for (const m of members) {
        for (const mr of (m._run.moduleResults || [])) {
            if (!mr || !mr.module) continue;
            const s = moduleStats.get(mr.module)
                || { module: mr.module, n: 0, min: null, max: null, failed: 0 };
            if (Number.isFinite(mr.score)) {
                s.n++;
                s.min = s.min == null ? mr.score : Math.min(s.min, mr.score);
                s.max = s.max == null ? mr.score : Math.max(s.max, mr.score);
            } else if (mr.failed) {
                s.failed++;
            }
            moduleStats.set(mr.module, s);
        }
    }

    return {
        audited: members.length,
        unaudited,
        scoreRange: scores.length
            ? { min: scores[0], max: scores[scores.length - 1], scores }
            : null,
        ceilingBound: members.filter((m) => m.ceilingBinding).length,
        members: members.map(({ _run, ...m }) => m),
        // Lowest-minimum module first — where the corpus is weakest.
        modules: [...moduleStats.values()].sort((a, b) => ((a.min ?? 101) - (b.min ?? 101))
            || (a.module < b.module ? -1 : 1))
    };
}

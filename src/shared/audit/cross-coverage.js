// Cross-coverage language — R4a of the founding-transcript integration
// (JOURNAL 2026-08-02). The per-member audits already extract
// asymmetric-language findings and contested terms with verbatim
// quotes; what no surface showed is the CROSS-ARTICLE pattern — the
// founding transcript's triangulation instinct applied to language:
// which parties are framed asymmetrically across the coverage, and
// which contested terms drift (defined here, smuggled there) across
// outlets covering the same case.
//
// DERIVED ONLY: aggregates findings the audits already produced —
// no LLM call, no wire kind, no storage. Distributions and verbatim
// examples, never a fused score (the CA.3 discipline). Party grouping
// is by normalized name string — mechanical, disclosed; wiring the
// identity layer's alias graph in is future work, not silently faked.
//
// Pure: no chrome, no network, no DOM.

// Caps keep the derived view readable; overflow is counted, never
// silently dropped.
export const MAX_EXAMPLES_PER_DIMENSION = 4;
export const MAX_TERM_EXAMPLES = 4;

function normIdent(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Latest run per member row, via the corpus-rollup join idiom
 *  (article_hashes ∪ captureArticleHash alias). */
function runByRow(rows, runs) {
    const byHash = new Map();
    for (const r of runs || []) {
        if (!r) continue;
        if (r.articleHash && !byHash.has(r.articleHash)) byHash.set(r.articleHash, r);
        if (r.captureArticleHash && !byHash.has(r.captureArticleHash)) byHash.set(r.captureArticleHash, r);
    }
    const out = [];
    for (const row of rows || []) {
        const hashes = row && Array.isArray(row.article_hashes) ? row.article_hashes : [];
        const run = hashes.map((h) => byHash.get(h)).find(Boolean);
        if (run) out.push({ row, run });
    }
    return out;
}

function moduleFindings(run, moduleName) {
    const mr = (run.moduleResults || []).find((m) => m && m.module === moduleName);
    return (mr && mr.findings) || null;
}

/**
 * Asymmetric framing aggregated by party across audited members.
 *
 * @param {object} input {rows, runs} — deriveArticleRows rows + runs ledger
 * @returns {{parties: Array, memberCount: number}}
 *   parties[]: { name, display, memberCount, findingCount,
 *                dimensions: Array<{dimension, count, severities: {low,medium,high},
 *                                   examples: Array<{member, quote, otherParty, term, otherTerm, severity}>,
 *                                   overflow: number}> }
 *   Sorted: most-members first, then most findings. A party appearing
 *   in ONE member is noise for a cross-coverage view and is dropped.
 */
export function crossCoverageAsymmetry({ rows = [], runs = [] } = {}) {
    const joined = runByRow(rows, runs);
    const byParty = new Map();

    for (const { row, run } of joined) {
        const findings = moduleFindings(run, 'asymmetric_language');
        if (!findings || !Array.isArray(findings.asymmetry_findings)) continue;
        const member = row.title || row.url || '';
        for (const f of findings.asymmetry_findings) {
            if (!f || !f.dimension) continue;
            // One finding names two parties; each accrues it from its
            // own side (its term first, the counterpart alongside).
            const sides = [
                { name: f.party_a, term: f.party_a_term, other: f.party_b, otherTerm: f.party_b_term, quote: f.evidence_quote_a },
                { name: f.party_b, term: f.party_b_term, other: f.party_a, otherTerm: f.party_a_term, quote: f.evidence_quote_b }
            ];
            for (const side of sides) {
                const key = normIdent(side.name);
                if (!key) continue;
                if (!byParty.has(key)) {
                    byParty.set(key, { name: key, display: side.name, members: new Set(), dimensions: new Map(), findingCount: 0 });
                }
                const p = byParty.get(key);
                p.members.add(row.url || member);
                p.findingCount += 1;
                if (!p.dimensions.has(f.dimension)) {
                    p.dimensions.set(f.dimension, { dimension: f.dimension, count: 0,
                        severities: { low: 0, medium: 0, high: 0 }, examples: [], overflow: 0 });
                }
                const d = p.dimensions.get(f.dimension);
                d.count += 1;
                if (f.severity && d.severities[f.severity] !== undefined) d.severities[f.severity] += 1;
                if (d.examples.length < MAX_EXAMPLES_PER_DIMENSION) {
                    d.examples.push({
                        member, quote: side.quote || '',
                        term: side.term || '', otherParty: side.other || '', otherTerm: side.otherTerm || '',
                        severity: f.severity || null
                    });
                } else {
                    d.overflow += 1;
                }
            }
        }
    }

    const parties = [...byParty.values()]
        .map((p) => ({
            name: p.name,
            display: p.display,
            memberCount: p.members.size,
            findingCount: p.findingCount,
            dimensions: [...p.dimensions.values()].sort((a, b) => b.count - a.count)
        }))
        // Cross-coverage means CROSS: a party flagged in one member
        // belongs to that member's own audit panel, not here.
        .filter((p) => p.memberCount >= 2)
        .sort((a, b) => b.memberCount - a.memberCount || b.findingCount - a.findingCount);

    return { parties, memberCount: joined.length };
}

/**
 * Definitional drift: contested terms aggregated across audited
 * members — where a load-bearing term is defined in one outlet and
 * smuggled in another, the drift IS the finding.
 *
 * @returns {{terms: Array, memberCount: number}}
 *   terms[]: { term, memberCount, loadBearingCount,
 *              quality: {explicit, contextual, absent},
 *              examples: Array<{member, defined, quality, quote, severity}>,
 *              overflow: number }
 *   Sorted: terms present in most members first, absent-definition
 *   count breaking ties. Single-member terms dropped (same rule).
 */
export function definitionalDrift({ rows = [], runs = [] } = {}) {
    const joined = runByRow(rows, runs);
    const byTerm = new Map();

    for (const { row, run } of joined) {
        const findings = moduleFindings(run, 'definitional_precision');
        if (!findings || !Array.isArray(findings.contested_terms)) continue;
        const member = row.title || row.url || '';
        for (const t of findings.contested_terms) {
            if (!t || !t.term) continue;
            const key = normIdent(t.term);
            if (!key) continue;
            if (!byTerm.has(key)) {
                byTerm.set(key, { term: t.term, members: new Set(), loadBearingCount: 0,
                    quality: { explicit: 0, contextual: 0, absent: 0 }, examples: [], overflow: 0 });
            }
            const rec = byTerm.get(key);
            rec.members.add(row.url || member);
            if (t.load_bearing === true) rec.loadBearingCount += 1;
            if (t.definition_quality && rec.quality[t.definition_quality] !== undefined) {
                rec.quality[t.definition_quality] += 1;
            }
            if (rec.examples.length < MAX_TERM_EXAMPLES) {
                rec.examples.push({
                    member,
                    defined: t.defined_in_text === true,
                    quality: t.definition_quality || null,
                    quote: t.first_use_quote || '',
                    severity: t.severity_if_undefined || null
                });
            } else {
                rec.overflow += 1;
            }
        }
    }

    const terms = [...byTerm.values()]
        .map((t) => ({
            term: t.term,
            memberCount: t.members.size,
            loadBearingCount: t.loadBearingCount,
            quality: t.quality,
            examples: t.examples,
            overflow: t.overflow
        }))
        .filter((t) => t.memberCount >= 2)
        .sort((a, b) => b.memberCount - a.memberCount || b.quality.absent - a.quality.absent);

    return { terms, memberCount: joined.length };
}

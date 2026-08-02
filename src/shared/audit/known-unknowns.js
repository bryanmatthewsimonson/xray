// Known unknowns — R9 of the founding-transcript integration
// (JOURNAL 2026-08-02). P12 names the log: "claims that could not be
// checked, parties who declined comment, documents requested and
// denied." The outsider's version of that log is what module 04
// already extracts and admits per member — bare-anonymous sources,
// single-sourced contested claims, documents cited but not retrievable,
// vague attributions, and each module's own caveats. This aggregates
// them case-level, joined with the corpus brief's coverage_gaps when
// one exists. What the corpus could NOT verify, on one face.
//
// DERIVED ONLY: no LLM call, no wire kind, no storage. Distributions
// and verbatim quotes, never a score. Standing run-mode caveats (the
// single-shot and opinion disclosures) are filtered — they describe
// the RUN, not the article's unknowns.
//
// Pure: no chrome, no network, no DOM.

import { STANDING_OPINION_CAVEAT } from './assemble.js';
import { STANDING_SINGLE_SHOT_CAVEAT } from './audit-prompt.js';

export const MAX_ITEMS_PER_LIST = 4;

// Caveats that describe run mechanics rather than article unknowns.
const MECHANICAL_CAVEATS = new Set([
    STANDING_SINGLE_SHOT_CAVEAT,
    STANDING_OPINION_CAVEAT,
    'module absent from model output'
]);
const isMechanicalCaveat = (c) =>
    MECHANICAL_CAVEATS.has(c) || /^confidence \d/.test(String(c || ''));

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

const capped = (list) => ({
    items: list.slice(0, MAX_ITEMS_PER_LIST),
    overflow: Math.max(0, list.length - MAX_ITEMS_PER_LIST)
});

/**
 * The case-level known-unknowns record.
 *
 * @param {object} input
 * @param {Array}  input.rows  deriveArticleRows rows
 * @param {Array}  input.runs  the runs ledger
 * @param {Array}  [input.coverageGaps]  the stored brief's coverage_gaps
 * @returns {{ members: Array, totals: object, coverageGaps: string[],
 *             auditedCount: number }}
 */
export function collectKnownUnknowns({ rows = [], runs = [], coverageGaps = [] } = {}) {
    const joined = runByRow(rows, runs);
    const members = [];
    const totals = { anonymousBare: 0, singleSourced: 0, unretrievableDocs: 0, vague: 0 };

    for (const { row, run } of joined) {
        const mr = (run.moduleResults || []).find((m) => m && m.module === 'source_quality');
        const f = (mr && mr.findings) || {};

        const anonymousBare = (f.sources || [])
            .filter((s) => s && s.type === 'anonymous_bare')
            .map((s) => ({ label: s.label || '', quote: s.evidence_quote || '' }));
        const singleSourced = (f.single_sourced_contested_claims || [])
            .filter(Boolean)
            .map((c) => ({ claim: c.claim || '', sourceType: c.source_type || '', quote: c.evidence_quote || '' }));
        const unretrievableDocs = (f.primary_documents || [])
            .filter((d) => d && (d.specific_enough_to_retrieve === false || d.linked_or_quoted === false))
            .map((d) => ({
                document: d.document || '',
                linked: d.linked_or_quoted === true,
                retrievable: d.specific_enough_to_retrieve === true,
                quote: d.evidence_quote || ''
            }));
        const vague = (f.sources || []).filter((s) => s && s.type === 'expert_says_vague').length;

        const caveatSet = new Set();
        for (const m of run.moduleResults || []) {
            for (const c of (m && m.auditor_caveats) || []) {
                if (typeof c === 'string' && c && !isMechanicalCaveat(c)) caveatSet.add(c);
            }
        }
        const caveats = [...caveatSet];

        if (anonymousBare.length + singleSourced.length + unretrievableDocs.length
            + vague + caveats.length === 0) continue;

        totals.anonymousBare += anonymousBare.length;
        totals.singleSourced += singleSourced.length;
        totals.unretrievableDocs += unretrievableDocs.length;
        totals.vague += vague;

        members.push({
            url: row.url || '',
            title: row.title || row.url || '',
            anonymousBare: capped(anonymousBare),
            singleSourced: capped(singleSourced),
            unretrievableDocs: capped(unretrievableDocs),
            vagueCount: vague,
            caveats: capped(caveats)
        });
    }

    members.sort((a, b) =>
        (b.anonymousBare.items.length + b.singleSourced.items.length + b.unretrievableDocs.items.length)
        - (a.anonymousBare.items.length + a.singleSourced.items.length + a.unretrievableDocs.items.length));

    return {
        members,
        totals,
        coverageGaps: (coverageGaps || []).filter((g) => typeof g === 'string' && g),
        auditedCount: joined.length
    };
}

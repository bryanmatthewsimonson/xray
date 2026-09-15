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
//
// DATA TOLERANCE (field bug 2026-08-30, three portal crashes): the
// runs ledger is STORED data — a malformed module-04 finding that
// predates or slipped past findings-schemas.js validation can carry a
// string where the schema says array. `(x || []).filter` is defeated
// by any truthy non-array, so every list read here goes through
// `list()` (Array.isArray or nothing) and every displayed scalar
// through `text()`. Malformed fields degrade to empty — the member
// still renders its well-formed unknowns — and nothing throws. The
// portal renderer is a 1:1 projection of this record and relies on
// these guarantees (items are plain objects, every string field IS a
// string), so the tolerance lives HERE, once, not in the DOM layer.

import { STANDING_OPINION_CAVEAT } from './assemble.js';
import { STANDING_SINGLE_SHOT_CAVEAT } from './audit-prompt.js';

export const MAX_ITEMS_PER_LIST = 4;

// Stored-data coercions. `list` is the only way an array is read from a
// run / finding / brief in this module: a string, number, or object in
// an array slot is malformed and reads as empty, never as iterable
// characters and never as a TypeError. `record` narrows a findings
// payload to a plain object (a string payload has no fields). `text`
// admits only strings — the schema types these fields `str`/`quote`,
// and the renderer slices them.
const list = (v) => (Array.isArray(v) ? v : []);
const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const record = (v) => (isRecord(v) ? v : {});
const text = (v) => (typeof v === 'string' ? v : '');

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
    for (const r of list(runs)) {
        if (!r || typeof r !== 'object') continue;
        if (r.articleHash && !byHash.has(r.articleHash)) byHash.set(r.articleHash, r);
        if (r.captureArticleHash && !byHash.has(r.captureArticleHash)) byHash.set(r.captureArticleHash, r);
    }
    const out = [];
    for (const row of list(rows)) {
        const hashes = row && Array.isArray(row.article_hashes) ? row.article_hashes : [];
        const run = hashes.map((h) => byHash.get(h)).find(Boolean);
        if (run) out.push({ row, run });
    }
    return out;
}

const capped = (items) => ({
    items: items.slice(0, MAX_ITEMS_PER_LIST),
    overflow: Math.max(0, items.length - MAX_ITEMS_PER_LIST)
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
        const moduleResults = list(run.moduleResults);
        const mr = moduleResults.find((m) => isRecord(m) && m.module === 'source_quality');
        const f = record(mr && mr.findings);

        // A finding-list item worth reading is a plain object; strings,
        // numbers and nulls in a list slot are malformed rows and drop.
        const sources = list(f.sources).filter(isRecord);
        const anonymousBare = sources
            .filter((s) => s.type === 'anonymous_bare')
            .map((s) => ({ label: text(s.label), quote: text(s.evidence_quote) }));
        const singleSourced = list(f.single_sourced_contested_claims)
            .filter(isRecord)
            .map((c) => ({ claim: text(c.claim), sourceType: text(c.source_type), quote: text(c.evidence_quote) }));
        const unretrievableDocs = list(f.primary_documents)
            .filter(isRecord)
            .filter((d) => d.specific_enough_to_retrieve === false || d.linked_or_quoted === false)
            .map((d) => ({
                document: text(d.document),
                linked: d.linked_or_quoted === true,
                retrievable: d.specific_enough_to_retrieve === true,
                quote: text(d.evidence_quote)
            }));
        const vague = sources.filter((s) => s.type === 'expert_says_vague').length;

        const caveatSet = new Set();
        for (const m of moduleResults) {
            for (const c of list(isRecord(m) && m.auditor_caveats)) {
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
            url: text(row.url),
            title: text(row.title) || text(row.url),
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
        coverageGaps: list(coverageGaps).filter((g) => typeof g === 'string' && g),
        auditedCount: joined.length
    };
}

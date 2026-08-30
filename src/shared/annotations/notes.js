// Margin S1 — pure projectors: existing records -> MarginNote[].
// docs/MARGIN_DESIGN.md §5.1. Computed on read, never persisted,
// never on the wire. No storage access, no DOM: callers fetch, we
// shape. Family separation is structural — each projector emits one
// family and the renderer keys templates off it (§5.3).
import { collectEvidenceFindings } from '../audit/assemble.js';
import { normalize } from '../metadata/url-normalizer.js';

export const PAGE_REASONS = Object.freeze({
    pageLevelByDesign: 'About the whole page, not a passage',
    couldNotLocate: 'Could not find this text in your copy — the article may have changed',
    noAnchorRecorded: 'No anchor was recorded when this was made',
    sourceNotCaptured: 'From a source you have not captured here',
    editedAway: 'No longer matches the text after your edit'
});

const note = (fields) => ({
    id: '', family: '', quote: '', grounding: null, pageReason: null,
    title: '', body: '', meta: {}, actions: ['locate'], reviewState: null,
    sub: [], ...fields
});

export function projectClaimNotes({ claims = [], assessmentsByClaimId = {}, verdictsByClaimId = {} }) {
    return claims.map((claim) => {
        const sub = [];
        const assessment = assessmentsByClaimId[claim.id];
        if (assessment) sub.push({ kind: 'assessment', record: assessment });
        for (const v of verdictsByClaimId[claim.id] || []) {
            sub.push({ kind: 'verdict', record: v });
        }
        return note({
            id: 'claim:' + claim.id,
            family: 'claim',
            // Prefer the untruncated first-class quote; fall back to the
            // claim text (pre-14.5 records) — segments.js grounds the
            // fallback with the strict tiers and demotes a miss to the
            // page lane rather than first-occurrence guessing.
            quote: String(claim.quote || claim.text || ''),
            title: claim.is_key ? 'Key claim' : 'Claim',
            body: String(claim.text || ''),
            meta: claim,
            actions: ['locate', 'assess', 'adjudicate', 'edit'],
            sub
        });
    });
}

export function projectExtractionNotes(record) {
    if (!record || !Array.isArray(record.assertions)) return [];
    return record.assertions.map((row) => {
        const state = (row.status === 'accepted' || row.status === 'dismissed') ? row.status : 'open';
        return note({
            id: 'extract:' + row.key,
            family: 'extraction',
            quote: String(row.quote || ''),
            title: 'Claim proposal',
            body: String((row.text || row.why) || ''),
            meta: row,
            reviewState: state,
            actions: state === 'open' ? ['locate', 'accept', 'dismiss'] : ['locate']
        });
    });
}

export function projectForensicNotes(findings, pageUrl) {
    const wanted = normalize(String(pageUrl || ''));
    const out = [];
    for (const f of Object.values(findings || {})) {
        for (let i = 0; i < (f.anchors || []).length; i++) {
            const a = f.anchors[i];
            const anchorUrl = a && a.source_ref && a.source_ref.url ? normalize(a.source_ref.url) : null;
            if (!anchorUrl || anchorUrl !== wanted) continue;
            out.push(note({
                id: 'forensic:' + f.id + ':' + i,
                family: 'forensic',
                quote: String(a.quote || ''),
                title: 'Forensic finding — ' + String(f.maneuver || '').replace(/_/g, ' '),
                // Structural observation with its counter-read beside it
                // (CONSTITUTION Art. 7; the counter_note discipline).
                body: [f.note, f.counter_note ? ('Counter-read: ' + f.counter_note) : '']
                    .filter(Boolean).join(' — '),
                meta: { finding: f, anchor: a }
            }));
        }
    }
    return out;
}

export function projectAuditNotes(runs = []) {
    const out = [];
    for (const run of runs) {
        for (const mr of run.moduleResults || []) {
            const found = collectEvidenceFindings((mr && mr.findings) || {});
            for (let i = 0; i < found.length; i++) {
                out.push(note({
                    id: 'audit:' + run.id + ':' + (mr.module || 'm') + ':' + i,
                    family: 'audit',
                    quote: String(found[i].quote || ''),
                    title: 'Audit evidence — ' + String(mr.module || ''),
                    body: String(found[i].kind || ''),
                    meta: { runId: run.id, module: mr.module, severity: found[i].severity || null }
                }));
            }
        }
    }
    return out;
}

export function projectPredictionNotes(predictions = []) {
    return predictions.map((p) => note({
        id: 'prediction:' + p.id,
        family: 'prediction',
        quote: String(p.evidence_quote || ''),
        title: 'Prediction',
        body: String(p.text || ''),
        meta: p
    }));
}

export function projectCommentNotes(comments = []) {
    return comments.map((c, i) => note({
        id: 'comment:' + i,
        family: 'comment',
        quote: '',
        pageReason: PAGE_REASONS.pageLevelByDesign,
        title: 'Platform comment',
        body: String(c.text || ''),
        meta: c,
        actions: []
    }));
}

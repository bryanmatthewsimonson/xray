// Margin S1 — pure projectors: existing records -> MarginNote[].
// docs/MARGIN_DESIGN.md §5.1. Computed on read, never persisted,
// never on the wire. No storage access, no DOM: callers fetch, we
// shape. Family separation is structural — each projector emits one
// family and the renderer keys templates off it (§5.3).
import { collectEvidenceFindings } from '../audit/assemble.js';
import { prettyModule } from '../audit/display.js';
import { normalize } from '../metadata/url-normalizer.js';

export const PAGE_REASONS = Object.freeze({
    pageLevelByDesign: 'About the whole page, not a passage',
    couldNotLocate: 'Could not find this text in your copy — the article may have changed',
    noAnchorRecorded: 'No anchor was recorded when this was made',
    // `sourceNotCaptured` was removed 2026-08-30: S1 has no producer for
    // it, and a reason string nothing can emit is a promise the UI cannot
    // keep. S3's foreign ring reintroduces it WITH its producer.
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
            // Maneuver is user-authored and lives in body (the user-content region).
            // Title stays closed-vocabulary for CONSTITUTION Art. 7 compliance.
            const maneuverLabel = String(f.maneuver || '').replace(/_/g, ' ');
            const parts = [];
            if (maneuverLabel) parts.push(maneuverLabel);
            if (f.note) parts.push(f.note);
            if (f.counter_note) parts.push('Counter-read: ' + f.counter_note);
            out.push(note({
                id: 'forensic:' + f.id + ':' + i,
                family: 'forensic',
                quote: String(a.quote || ''),
                title: 'Forensic finding',
                // Structural observation with its counter-read beside it
                // (CONSTITUTION Art. 7; the counter_note discipline).
                body: parts.filter(Boolean).join(' — '),
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
                    // Module ids and finding kinds are snake_case storage
                    // keys; the card is prose read by a person. prettyModule
                    // is the repo's one de-snaking helper — reuse it rather
                    // than growing a second spelling of the same rule.
                    title: 'Audit evidence — ' + prettyModule(mr.module || ''),
                    body: String(found[i].kind || '').replace(/_/g, ' '),
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

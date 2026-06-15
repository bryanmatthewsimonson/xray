// X-Ray — audit display helpers (Phase 13.6/13.7).
//
// The display rules are wire-adjacent law (docs/EPISTEMIC_AUDIT_DESIGN.md
// §"Score display — honest by construction"), so the helpers that
// enforce them live in ONE place and every surface (reader panel,
// portal chips/inspector/dossier) imports them:
//
//   1. No naked numbers — a score renders with its confidence, and a
//      score with UNKNOWN confidence renders the review chip (unknown
//      must never look more authoritative than 0.59).
//   2. Confidence < 0.6 renders "needs human review", not a number.
//   3. Badge bands are the framework rubric (90/75/60/40/20) — the
//      scale anchors at 70–85 normal, so nothing below 75 reads as
//      good and there is no green at 50.

const ESCAPE_RE = /[&<>"']/g;
const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeAuditHtml(value) {
    return String(value == null ? '' : value).replace(ESCAPE_RE, (c) => ESCAPE_MAP[c]);
}

/** The framework rubric bands (prompts/00; PHILOSOPHY §4). */
export function auditBand(score) {
    if (score >= 90) return { key: 'exemplary',    label: 'Exemplary' };
    if (score >= 75) return { key: 'solid',        label: 'Solid' };
    if (score >= 60) return { key: 'acceptable',   label: 'Acceptable, with concerns' };
    if (score >= 40) return { key: 'significant',  label: 'Significant problems' };
    if (score >= 20) return { key: 'severe',       label: 'Severe' };
    return { key: 'catastrophic', label: 'Catastrophic' };
}

/**
 * The score-with-confidence chip, rules 1+2 enforced structurally.
 * Returns HTML using the xr-audit__* vocabulary (the reader and the
 * portal share these class names; each surface styles them).
 */
export function scoreChipHtml(score, confidence) {
    if (typeof score !== 'number') {
        return '<span class="xr-audit__chip xr-audit__chip--failed">failed</span>';
    }
    if (typeof confidence !== 'number') {
        return '<span class="xr-audit__chip xr-audit__chip--review" title="this result carries no confidence value — treat as unreviewed">needs human review · no confidence recorded</span>';
    }
    if (confidence < 0.6) {
        return '<span class="xr-audit__chip xr-audit__chip--review" title="confidence ' +
            escapeAuditHtml(String(confidence)) + ' — below the 0.6 reliability threshold">needs human review</span>';
    }
    return `<span class="xr-audit__score">${escapeAuditHtml(String(score))} · conf ${escapeAuditHtml(String(confidence))}</span>`;
}

export function prettyModule(name) {
    return String(name || '').replace(/_/g, ' ');
}

/**
 * The compact card-chip as DATA — {text, bandKey, title} or null —
 * for surfaces that build DOM with createElement (the portal's
 * no-innerHTML discipline). Same rules as everything else here.
 */
export function auditCardChipData(aggregate) {
    if (!aggregate) return null;
    const score = typeof aggregate.final_score === 'number' ? aggregate.final_score : null;
    const conf = typeof aggregate.overall_confidence === 'number' ? aggregate.overall_confidence : null;
    if (score === null) return null;
    if (conf === null || conf < 0.6) {
        return { text: 'audit: review', bandKey: 'review', title: 'audit needs human review' };
    }
    const band = auditBand(score);
    return {
        text: `audit ${score} · ${conf}`,
        bandKey: band.key,
        title: `${band.label} · confidence ${conf}`
    };
}

/** The same chip as HTML (reader surfaces). */
export function auditCardChipHtml(aggregate) {
    const data = auditCardChipData(aggregate);
    if (!data) return null;
    if (data.bandKey === 'review') {
        return `<span class="xr-audit__chip xr-audit__chip--review" title="${escapeAuditHtml(data.title)}">${escapeAuditHtml(data.text)}</span>`;
    }
    return `<span class="xr-audit__chip xr-audit__chip--band-${escapeAuditHtml(data.bandKey)}" title="${escapeAuditHtml(data.title)}">${escapeAuditHtml(data.text)}</span>`;
}

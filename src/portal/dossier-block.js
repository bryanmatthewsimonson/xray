// The Audit-dossier block (Phase 13.7) — shared by the entity and
// case views (the design assigns it to both). Derived,
// computed-on-open, and the shrinkage is SHOWN with its parameters
// (§4): a raw three-article mean is not a stable reputation and must
// not read like one.

import { el } from './dom.js';

export function renderDossierBlock(host, dossier, populationMean) {
    if (!dossier) return;
    const block = el('div', 'xr-view__dossier');
    block.appendChild(el('h3', 'xr-case__heading', 'Audit dossier (derived — recompute, don\'t trust)'));

    if (dossier.scoreMeanRaw === null) {
        block.appendChild(el('div', 'xr-view__dossier-line',
            'No scored aggregates yet.'));
    } else {
        block.appendChild(el('div', 'xr-view__dossier-line',
            `raw mean ${dossier.scoreMeanRaw} over ${dossier.auditedArticles} audited article(s) `
            + `(${dossier.judgments} auditor judgment(s)), `
            + `shrunk to ${dossier.scoreMean} toward population ${populationMean} `
            + `(k=${dossier.shrinkageK}, factor ${dossier.shrinkageFactor}) · `
            + `median ${dossier.scoreMedian} · stdev ${dossier.scoreStdev}`));
    }
    if (dossier.excludedForReview > 0) {
        block.appendChild(el('div', 'xr-view__dossier-line xr-view__dossier-line--dim',
            `${dossier.excludedForReview} run(s) excluded pending review (confidence < 0.6 — `
            + 'a number the display rules refuse to show must not move a reputation either)'));
    }

    const moduleEntries = Object.entries(dossier.perModuleMeans || {});
    if (moduleEntries.length) {
        const chips = el('div', 'xr-view__dossier-modules');
        for (const [mod, mean] of moduleEntries) {
            chips.appendChild(el('span', 'xr-badge', `${mod.replace(/_/g, ' ')}: ${mean}`));
        }
        block.appendChild(chips);
    }

    const preds = dossier.predictions || {};
    if (preds.total > 0) {
        const cal = preds.calibration || {};
        const rate = (row) => (row && row.resolved > 0
            ? `${row.true_count}/${row.resolved} true` : '—');
        block.appendChild(el('div', 'xr-view__dossier-line',
            `predictions: ${preds.resolved}/${preds.total} resolved · `
            + `confident ${rate(cal.confident)} · hedged ${rate(cal.hedged)} · speculative ${rate(cal.speculative)}`));
        const calV1 = preds.calibration_v1 || {};
        if (calV1.resolved_count > 0) {
            block.appendChild(el('div', 'xr-view__dossier-line xr-view__dossier-line--dim',
                `calibration-v1 (informational, not applied): mean Brier ${calV1.mean_brier} over ${calV1.resolved_count} · multiplier ${calV1.multiplier === null ? 'inactive' : calV1.multiplier}`));
        }
    }
    if (dossier.unmappedBeats && dossier.unmappedBeats.length) {
        block.appendChild(el('div', 'xr-view__dossier-line xr-view__dossier-line--dim',
            `unmapped beat tags (review — these never mint dossiers): ${dossier.unmappedBeats.join(', ')}`));
    }
    host.appendChild(block);
}

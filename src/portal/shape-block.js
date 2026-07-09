// Shape-of-knowledge block — CD.2 (docs/CASE_DOSSIER_DESIGN.md §3.1).
// The case dossier's header: the verdict-state DISTRIBUTION over the
// case's propositions (never a fused score — P2), the coverage line
// that caps every impression, standards-of-proof chips, and the
// prediction ledger tally. A thin projection of the pure
// `assembleCaseDossier` output — all logic lives in case-dossier.js;
// this file only paints. Computes on open, renders nothing when the
// case carries no propositions or predictions.

import { el } from './dom.js';
import { assembleCaseDossier } from '../shared/case-dossier.js';
import { VERDICT_STATE_LABELS, STANDARD_OF_PROOF_LABELS } from '../shared/truth-taxonomy.js';
import { Utils } from '../shared/utils.js';

export function renderShapeBlock(host, caseEntityId) {
    if (!caseEntityId) return;
    const block = el('div', 'xr-view__dossier');
    host.appendChild(block);

    (async () => {
        const caseDossier = await assembleCaseDossier(caseEntityId);
        const shape = caseDossier.shape_of_knowledge;
        const dist = shape.distribution;
        const preds = shape.predictions;
        const hasAny = dist.total > 0 || preds.entries.length > 0;
        if (!hasAny) { block.remove(); return; }

        block.appendChild(el('h3', 'xr-case__heading', 'Shape of knowledge — the distribution, not a score'));

        // The distribution: one chip per verdict state present, plus the
        // unadjudicated remainder. Never merged into a single number.
        const distRow = el('div', 'xr-case__dist');
        for (const state of dist.states_present) {
            const label = VERDICT_STATE_LABELS[state] || state;
            distRow.appendChild(el('span', 'xr-badge', `${label}: ${dist.by_state[state]}`));
        }
        if (dist.unadjudicated > 0) {
            distRow.appendChild(el('span', 'xr-badge xr-badge--muted', `unadjudicated: ${dist.unadjudicated}`));
        }
        if (dist.total === 0) {
            distRow.appendChild(el('span', 'xr-badge xr-badge--muted', 'no propositions yet'));
        }
        block.appendChild(distRow);

        // Coverage on its face — counts, never ratios (P6).
        block.appendChild(el('div', 'xr-view__dossier-line',
            `Coverage: ${shape.coverage.claims} claims · `
            + `${shape.coverage.claims_with_propositions} with propositions · `
            + `${shape.coverage.propositions} propositions`));

        // Standards of proof — "established at preponderance" is not
        // "established beyond reasonable doubt".
        const stds = Object.entries(dist.by_standard);
        if (stds.length > 0) {
            const stdRow = el('div', 'xr-case__dist');
            for (const [std, n] of stds) {
                stdRow.appendChild(el('span', 'xr-badge xr-badge--muted',
                    `${STANDARD_OF_PROOF_LABELS[std] || std}: ${n}`));
            }
            block.appendChild(stdRow);
        }

        // The prediction ledger — the structural calibration loop.
        if (preds.entries.length > 0) {
            block.appendChild(el('div', 'xr-view__dossier-line',
                `Predictions: ${preds.open} open · ${preds.resolved} resolved`));
        }
    })().catch((err) => {
        Utils.error('Shape-of-knowledge block render failed', err);
        block.remove();
    });
}

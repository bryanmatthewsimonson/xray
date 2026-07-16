// Trace-dependencies expander — Phase 26 CF.2
// (docs/COUNTERFACTUAL_DESIGN.md §3, resolved §7: inline in the case
// view as a per-claim expander). A native <details> that, on first
// open, runs the PURE traceClaimDependencies over the already-
// collected case data and renders `traceLines` 1:1 — plain counts
// with their derivations on the face. A Remove/Negate mode toggle
// recomputes; nothing is persisted, nothing is estimated, and the
// copy is guard-tested in shared/case-counterfactual.js's traceLines
// (no "more/less likely", no "stronger/weaker", no "% chance").

import { el } from './dom.js';
import { traceClaimDependencies, traceLines, COUNTERFACTUAL_MODES } from '../shared/case-counterfactual.js';
import { Utils } from '../shared/utils.js';

export const TRACE_SUMMARY = 'Trace dependencies';
export const TRACE_EXPLAINER =
    'What in this case\'s graph structurally rests on this claim — counts with their '
    + 'derivations, measured over the local graph. Not a probability of anything.';
export const TRACE_MODE_LABELS = { remove: 'If removed', negate: 'If negated' };

/**
 * Mount the expander for one claim. `data` is the shared collector
 * envelope; `hypothesisEdges` the optional pre-collected join rows
 * (collectHypothesisEdgeJoins). Computation is lazy — nothing runs
 * until the reader opens the expander.
 */
export function mountTraceExpander(host, { data, claimId, hypothesisEdges = [] }) {
    if (!data || !claimId) return;
    const sec = el('details', 'xr-synth__sec xr-trace');
    sec.appendChild(el('summary', null, TRACE_SUMMARY));
    const body = el('div');
    sec.appendChild(body);
    host.appendChild(sec);

    let mode = 'remove';
    let opened = false;

    const render = () => {
        body.replaceChildren();
        body.appendChild(el('div', 'xr-case__explainer', TRACE_EXPLAINER));
        const toggles = el('div', 'xr-trace__modes');
        for (const m of COUNTERFACTUAL_MODES) {
            const b = el('button',
                `xr-portal__btn${m === mode ? '' : ' xr-portal__btn--ghost'}`,
                TRACE_MODE_LABELS[m]);
            b.type = 'button';
            b.addEventListener('click', () => { if (m !== mode) { mode = m; render(); } });
            toggles.appendChild(b);
        }
        body.appendChild(toggles);
        try {
            const delta = traceClaimDependencies(data, claimId, { mode, hypothesisEdges });
            for (const line of traceLines(delta, { claimsById: data.claimsById || {} })) {
                const row = el('div', 'xr-trace__line');
                row.appendChild(el('div', null, line.text));
                if (line.derivation) {
                    row.appendChild(el('div', 'xr-inspector__mono', line.derivation));
                }
                body.appendChild(row);
            }
        } catch (err) {
            Utils.error('Trace dependencies failed', err);
            body.appendChild(el('div', 'xr-inspector__mono', 'Trace failed — see console.'));
        }
    };

    sec.addEventListener('toggle', () => {
        if (sec.open && !opened) { opened = true; render(); }
    });
}

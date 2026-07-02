// The entity integrity-record block (Phase 15.9) — the §3.5 render
// seam: dimension-separated descriptive records with COVERAGE ON THE
// FACE, the integrity timeline (pattern, not instance), and the
// coverage-gated optional rollup. Hung on the entity view beside the
// audit dossier and forensic findings blocks.
//
// Posture, inherited from the models it renders:
//   - counts sit beside the lists that derive them; no fused score
//     exists anywhere in this block;
//   - the rollup only renders after the operator DECLARES coverage
//     (assessed / universe / method) — the declaration is session-only,
//     deliberately not persisted: coverage is a per-reading assertion
//     by whoever is looking, not stored state that goes stale;
//   - the block computes on open (the dossier posture) and renders
//     nothing at all when the entity has no adjudication data.

import { el, truncate } from './dom.js';
import { entityIntegrityRecord, declaredCoverage, optionalRollup } from '../shared/truth-entity-record.js';
import { IntegrityModel } from '../shared/integrity-model.js';
import { TruthAdjudicationModel } from '../shared/truth-adjudication-model.js';
import { ClaimModel } from '../shared/claim-model.js';
import { INTEGRITY_MATCH_LABELS } from '../shared/truth-taxonomy.js';
import { Utils } from '../shared/utils.js';

async function wordText(propositionId) {
    try {
        const prop = await TruthAdjudicationModel.get(propositionId);
        const claim = prop && await ClaimModel.get(prop.claim_id);
        return (claim && claim.text) || propositionId;
    } catch (_) { return propositionId; }
}

function dimensionRows(section, dimension) {
    const counts = Object.entries(dimension.counts)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k} ${n}`)
        .join(' · ');
    section.appendChild(el('div', 'xr-inspector__mono', counts || 'none'));
}

export function renderIntegrityBlock(host, entityId) {
    if (!entityId) return;
    const block = el('div', 'xr-view__findings');
    host.appendChild(block);

    (async () => {
        const record = await entityIntegrityRecord(entityId);
        const timeline = await IntegrityModel.timelineForEntity(entityId);
        const calN = record.calibration.resolutions.length + record.calibration.unscoreable.length;
        const hasAny = record.commitments.entries.length > 0
            || record.values.entries.length > 0
            || calN > 0 || timeline.length > 0;
        if (!hasAny) { block.remove(); return; }

        block.appendChild(el('h3', 'xr-case__heading',
            'Integrity record — dimension-separated, coverage-bound'));
        block.appendChild(el('div', 'xr-inspector__mono',
            record.coverage.status === 'undetermined'
                ? 'Coverage: undetermined — sample, not census; caps every aggregate'
                : `Coverage: ${record.coverage.assessed_count}/${record.coverage.universe_estimate} (${record.coverage.method})`));

        // --- commitments + values: a count and a list, never a score.
        for (const [label, dim] of [['Commitments', record.commitments], ['Stated values', record.values]]) {
            if (dim.entries.length === 0) continue;
            block.appendChild(el('h4', 'xr-inspector__sub', `${label} (${dim.entries.length})`));
            dimensionRows(block, dim);
            for (const entry of dim.entries.slice(0, 12)) {
                const row = el('div', 'xr-inspector__finding-anchor');
                const states = entry.matches.length
                    ? entry.matches.map((m) => INTEGRITY_MATCH_LABELS[m.match] || m.match).join(', ')
                    : 'pending';
                row.appendChild(el('span', 'xr-inspector__mono', states));
                const text = el('span', null, '…');
                row.appendChild(text);
                wordText(entry.word_proposition_id).then((t) => { text.textContent = truncate(t, 110); });
                block.appendChild(row);
            }
            if (dim.entries.length > 12) {
                block.appendChild(el('div', 'xr-inspector__mono', `… +${dim.entries.length - 12} more`));
            }
        }

        // --- calibration: measurements with their derivation counts.
        if (calN > 0) {
            block.appendChild(el('h4', 'xr-inspector__sub', 'Calibration (resolved predictions only)'));
            const s = record.calibration.summary;
            block.appendChild(el('div', 'xr-inspector__mono',
                `${s.resolved_count} scoreable · mean Brier ${s.mean_brier === null ? '—' : s.mean_brier}`
                + ` · ${record.calibration.unscoreable.length} unscoreable (listed, never dropped)`));
        }

        // --- corrections.
        const corr = record.corrections;
        if (corr.verdict_supersessions.count + corr.finding_supersessions.count
            + corr.disclosed_revisions.count > 0) {
            block.appendChild(el('h4', 'xr-inspector__sub', 'Correction behavior'));
            block.appendChild(el('div', 'xr-inspector__mono',
                `verdict supersessions ${corr.verdict_supersessions.count}`
                + ` · finding supersessions ${corr.finding_supersessions.count}`
                + ` · disclosed revisions (credit) ${corr.disclosed_revisions.count}`));
        }

        // --- timeline: pattern, not instance.
        if (timeline.length > 0) {
            block.appendChild(el('h4', 'xr-inspector__sub', `Integrity timeline (${timeline.length})`));
            for (const t of timeline.slice(0, 12)) {
                const when = t.occurred_at
                    ? `${new Date(t.occurred_at * 1000).toISOString().slice(0, 10)} (${t.occurred_precision})`
                    : 'undated';
                block.appendChild(el('div', 'xr-inspector__mono',
                    `${when} · ${t.finding.match} · ${t.finding.standard_of_proof}`));
            }
        }

        // --- the coverage-gated rollup: declare, then compute.
        block.appendChild(el('h4', 'xr-inspector__sub', 'Optional rollup (coverage- and standard-gated)'));
        const form = el('div', 'xr-inspector__finding-anchor');
        const assessed = el('input', 'xr-view__locate');
        assessed.type = 'number'; assessed.min = '0'; assessed.placeholder = 'assessed';
        const universe = el('input', 'xr-view__locate');
        universe.type = 'number'; universe.min = '1'; universe.placeholder = 'universe';
        const method = el('input', 'xr-view__locate');
        method.type = 'text'; method.placeholder = 'how the universe was bounded';
        const go = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Declare coverage → rollup');
        go.type = 'button';
        const out = el('div', 'xr-inspector__mono',
            'No aggregate without declared coverage — the default is "undetermined; sample, not census". '
            + 'Declarations are per-reading, not stored.');
        go.addEventListener('click', () => {
            try {
                const coverage = declaredCoverage({
                    assessed_count: parseInt(assessed.value, 10),
                    universe_estimate: parseInt(universe.value, 10),
                    method: method.value
                });
                entityIntegrityRecord(entityId, { coverage }).then((r) => {
                    const rollup = optionalRollup(r);
                    out.textContent = rollup ? rollup.text : 'No rollup (no resolved high-standard matches).';
                });
            } catch (err) {
                out.textContent = err.message || String(err);
            }
        });
        form.appendChild(assessed); form.appendChild(universe); form.appendChild(method); form.appendChild(go);
        block.appendChild(form);
        block.appendChild(out);
    })().catch((err) => {
        Utils.error('Integrity block render failed', err);
        block.remove();
    });
}

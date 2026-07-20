// Corpus epistemics block — CA.3 (docs/CORPUS_AUDIT_KICKOFF.md).
// Renders corpusAuditRollup on the case dashboard: coverage, the score
// RANGE, the lowest-scoring members, per-module ranges. Distributions
// only — no mean exists in the rollup and none is computed here
// (§10.1/.9). Derived view, no wire kind, removes itself when nothing
// is audited.

import { el } from './dom.js';
import { Utils } from '../shared/utils.js';
import { deriveArticleRows } from '../shared/case-dossier.js';
import { corpusAuditRollup } from '../shared/audit/corpus-rollup.js';

const MAX_MEMBER_ROWS = 12;

export function renderEpistemicsBlock(host, { data }) {
    try {
        const { rows } = deriveArticleRows(data);
        const roll = corpusAuditRollup({ rows, runs: data.auditRuns || [] });
        if (roll.audited === 0) return;   // nothing audited — block absent

        const block = el('div', 'xr-caudit');
        host.appendChild(block);
        block.appendChild(el('h3', 'xr-case__heading', 'Corpus epistemics — distributions, never an average'));
        block.appendChild(el('div', 'xr-case__explainer',
            'The epistemic audits across this case\'s members, side by side. Scores are per-article '
            + 'and stay per-article — there is deliberately no corpus score and no mean; the range '
            + 'and the weak end are the signal. Every number is reproducible from the audit ledger.'));

        const cov = `${roll.audited} of ${roll.audited + roll.unaudited} members audited`
            + (roll.scoreRange ? ` · scores ${roll.scoreRange.min}–${roll.scoreRange.max}` : '')
            + (roll.ceilingBound ? ` · ${roll.ceilingBound} capped by knowability` : '');
        block.appendChild(el('div', 'xr-view__dossier-line', cov));

        const list = el('ul', 'xr-list');
        for (const m of roll.members.slice(0, MAX_MEMBER_ROWS)) {
            const li = el('li', 'xr-row');
            const headRow = el('div', 'xr-row__head');
            headRow.appendChild(el('span', 'xr-row__kind',
                m.score == null ? 'unscored' : `${m.score}${m.confidence != null ? ` ±${Math.round((1 - m.confidence) * 100)}` : ''}`));
            headRow.appendChild(el('span', 'xr-row__title', m.title));
            if (m.ceilingBinding) {
                const cap = el('span', 'xr-badge xr-badge--muted', `ceiling ${m.ceiling}`);
                cap.title = 'The knowability ceiling binds: the raw score exceeded what this subject can support (P6).';
                headRow.appendChild(cap);
            }
            if (m.concerns) headRow.appendChild(el('span', 'xr-badge', `${m.concerns} concern${m.concerns === 1 ? '' : 's'}`));
            li.appendChild(headRow);
            list.appendChild(li);
        }
        if (roll.members.length > MAX_MEMBER_ROWS) {
            list.appendChild(el('li', 'xr-inspector__mono', `… +${roll.members.length - MAX_MEMBER_ROWS} more (lowest scores shown first)`));
        }
        block.appendChild(list);

        const modLines = roll.modules
            .filter((s) => s.n > 0)
            .map((s) => `${s.module}: ${s.min}–${s.max} (${s.n})${s.failed ? ` · ${s.failed} failed` : ''}`);
        if (modLines.length) {
            block.appendChild(el('div', 'xr-view__dossier-line',
                'Per-dimension ranges (weakest minimum first): ' + modLines.join(' · ')));
        }
    } catch (err) {
        Utils.error('Epistemics block failed', err);
    }
}

// Cross-coverage language block — R4a (founding-transcript
// integration; JOURNAL 2026-08-02). The derived case-dashboard view
// over what the per-member audits already found: asymmetric framing
// aggregated BY PARTY across members, and contested-term definitional
// drift across outlets. The founding transcript's triangulation
// instinct applied to language — the divergences are the diagnostic.
//
// Costs NO LLM call and is therefore not consent-gated: it reads runs
// already bought. Absent until at least two audited members carry the
// relevant findings. Distributions + verbatim quotes, never a fused
// score; party grouping is by name string (mechanical, said on the
// face — the identity layer's alias graph is future work).

import { el, truncate } from './dom.js';
import { Utils } from '../shared/utils.js';
import { deriveArticleRows } from '../shared/case-dossier.js';
import { crossCoverageAsymmetry, definitionalDrift } from '../shared/audit/cross-coverage.js';

const MAX_PARTIES = 8;
const MAX_TERMS = 10;

const sevBadge = (severities) => {
    const bits = [];
    if (severities.high) bits.push(`${severities.high} high`);
    if (severities.medium) bits.push(`${severities.medium} medium`);
    if (severities.low) bits.push(`${severities.low} low`);
    return bits.join(' · ');
};

/**
 * @param {HTMLElement} host
 * @param {object} params
 * @param {object} params.data  collectCaseDossierData output
 */
export function renderCrossCoverageBlock(host, { data }) {
    try {
        const { rows } = deriveArticleRows(data);
        const runs = data.auditRuns || [];
        const asym = crossCoverageAsymmetry({ rows, runs });
        const drift = definitionalDrift({ rows, runs });
        if (asym.parties.length === 0 && drift.terms.length === 0) return;

        const block = el('div', 'xr-synth');
        host.appendChild(block);
        block.appendChild(el('h3', 'xr-case__heading',
            'Cross-coverage language — framing and definitions across members'));
        block.appendChild(el('p', 'xr-case__explainer',
            'Aggregated from the per-member audits (no new analysis was run): which parties '
            + 'draw asymmetric framing across the coverage, and which contested terms drift — '
            + 'defined in one outlet, smuggled in another. Parties group by name string; '
            + 'observations of the coverage, never verdicts on anyone.'));

        if (asym.parties.length) {
            const sec = el('details', 'xr-synth__sec');
            sec.open = true;
            sec.appendChild(el('summary', null,
                `Asymmetric framing by party (${asym.parties.length}, across ${asym.memberCount} audited members)`));
            for (const p of asym.parties.slice(0, MAX_PARTIES)) {
                const row = el('div', 'xr-synth__prop');
                const head = el('div', 'xr-row__head');
                head.appendChild(el('span', 'xr-row__title', truncate(p.display, 60)));
                head.appendChild(el('span', 'xr-badge xr-badge--muted',
                    `${p.memberCount} members · ${p.findingCount} findings`));
                row.appendChild(head);
                for (const d of p.dimensions) {
                    const line = el('div', 'xr-synth__prop-note',
                        `${d.dimension}: ${d.count}${sevBadge(d.severities) ? ` (${sevBadge(d.severities)})` : ''}`
                        + (d.overflow ? ` · +${d.overflow} more` : ''));
                    line.title = d.examples.map((e) =>
                        `[${truncate(e.member, 50)}${e.severity ? ` · ${e.severity}` : ''}] `
                        + `"${truncate(e.term, 40)}" vs ${truncate(e.otherParty, 30)} "${truncate(e.otherTerm, 40)}"`
                        + (e.quote ? ` — “${e.quote.slice(0, 100)}”` : '')).join('\n');
                    row.appendChild(line);
                }
                sec.appendChild(row);
            }
            if (asym.parties.length > MAX_PARTIES) {
                sec.appendChild(el('div', 'xr-inspector__mono',
                    `…and ${asym.parties.length - MAX_PARTIES} more parties`));
            }
            block.appendChild(sec);
        }

        if (drift.terms.length) {
            const sec = el('details', 'xr-synth__sec');
            sec.appendChild(el('summary', null,
                `Definitional drift (${drift.terms.length} contested term${drift.terms.length === 1 ? '' : 's'} across members)`));
            const ul = el('ul', 'xr-list');
            for (const t of drift.terms.slice(0, MAX_TERMS)) {
                const li = el('li', 'xr-row');
                const head = el('div', 'xr-row__head');
                head.appendChild(el('span', 'xr-row__title', `“${truncate(t.term, 50)}”`));
                head.appendChild(el('span', 'xr-badge xr-badge--muted',
                    `${t.memberCount} members · defined ${t.quality.explicit} · contextual ${t.quality.contextual} · absent ${t.quality.absent}`
                    + (t.loadBearingCount ? ` · load-bearing ×${t.loadBearingCount}` : '')));
                li.appendChild(head);
                li.title = t.examples.map((e) =>
                    `[${truncate(e.member, 50)}] ${e.defined ? `defined (${e.quality})` : `undefined${e.severity ? ` · ${e.severity}` : ''}`}`
                    + (e.quote ? ` — “${e.quote.slice(0, 100)}”` : '')).join('\n')
                    + (t.overflow ? `\n…and ${t.overflow} more uses` : '');
                ul.appendChild(li);
            }
            if (drift.terms.length > MAX_TERMS) {
                ul.appendChild(el('li', 'xr-inspector__mono',
                    `…and ${drift.terms.length - MAX_TERMS} more terms`));
            }
            sec.appendChild(ul);
            block.appendChild(sec);
        }
    } catch (err) {
        Utils.error('Cross-coverage block failed', err);
    }
}

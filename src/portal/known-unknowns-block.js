// Known-unknowns block — R9 (founding-transcript integration;
// JOURNAL 2026-08-02). P12's log, case-level: what this corpus could
// NOT verify — bare-anonymous sources, single-sourced contested
// claims, cited-but-unretrievable documents, vague attributions, the
// modules' own caveats — joined with the stored brief's coverage gaps.
// Publishing what cannot be checked is the difference between a
// scorecard and an honest record.
//
// Costs NO LLM call and is therefore not consent-gated: it reads runs
// and the stored brief. Absent until an audited member carries
// unknowns. Counts and verbatim quotes, never a score.

import { el, truncate } from './dom.js';
import { Utils } from '../shared/utils.js';
import { deriveArticleRows } from '../shared/case-dossier.js';
import { getCaseBrief } from '../shared/audit/audit-cache.js';
import { collectKnownUnknowns } from '../shared/audit/known-unknowns.js';

const MAX_MEMBER_ROWS = 10;

const listTip = (cap, line) => cap.items.map(line).join('\n')
    + (cap.overflow ? `\n…and ${cap.overflow} more` : '');

/**
 * @param {HTMLElement} host
 * @param {object} params
 * @param {object} params.data  collectCaseDossierData output
 */
export function renderKnownUnknownsBlock(host, { data }) {
    const caseId = data.case && data.case.id;
    if (!caseId) return;
    const block = el('div', 'xr-synth');
    host.appendChild(block);

    (async () => {
        const briefRec = await getCaseBrief(caseId).catch(() => null);
        const coverageGaps = (briefRec && briefRec.brief && briefRec.brief.coverage_gaps) || [];
        const { rows } = deriveArticleRows(data);
        const ku = collectKnownUnknowns({ rows, runs: data.auditRuns || [], coverageGaps });
        if (ku.members.length === 0 && ku.coverageGaps.length === 0) { block.remove(); return; }

        block.appendChild(el('h3', 'xr-case__heading',
            'Known unknowns — what this corpus could not verify'));
        block.appendChild(el('p', 'xr-case__explainer',
            'The published record of what could not be checked (P12): unjustified anonymous '
            + 'sources, contested claims resting on one source, documents cited but not '
            + 'retrievable, vague attributions, and the audit’s own caveats — plus the '
            + 'corpus brief’s coverage gaps when a brief exists. Absence of verification '
            + 'is disclosed, never scored.'));
        block.appendChild(el('div', 'xr-synth__prov', [
            `${ku.members.length} of ${ku.auditedCount} audited member${ku.auditedCount === 1 ? '' : 's'} carry unknowns`,
            `${ku.totals.anonymousBare} bare-anonymous source${ku.totals.anonymousBare === 1 ? '' : 's'}`,
            `${ku.totals.singleSourced} single-sourced contested claim${ku.totals.singleSourced === 1 ? '' : 's'}`,
            `${ku.totals.unretrievableDocs} unretrievable document${ku.totals.unretrievableDocs === 1 ? '' : 's'}`,
            `${ku.totals.vague} vague attribution${ku.totals.vague === 1 ? '' : 's'}`
        ].join(' · ')));

        if (ku.members.length) {
            const sec = el('details', 'xr-synth__sec');
            sec.open = true;
            sec.appendChild(el('summary', null, `By member (${ku.members.length})`));
            const ul = el('ul', 'xr-list');
            for (const m of ku.members.slice(0, MAX_MEMBER_ROWS)) {
                const li = el('li', 'xr-row');
                const head = el('div', 'xr-row__head');
                head.appendChild(el('span', 'xr-row__title', truncate(m.title, 70)));
                const bits = [];
                if (m.anonymousBare.items.length) bits.push(`${m.anonymousBare.items.length + m.anonymousBare.overflow} anon-bare`);
                if (m.singleSourced.items.length) bits.push(`${m.singleSourced.items.length + m.singleSourced.overflow} single-sourced`);
                if (m.unretrievableDocs.items.length) bits.push(`${m.unretrievableDocs.items.length + m.unretrievableDocs.overflow} unretrievable`);
                if (m.vagueCount) bits.push(`${m.vagueCount} vague`);
                if (m.caveats.items.length) bits.push(`${m.caveats.items.length + m.caveats.overflow} caveats`);
                head.appendChild(el('span', 'xr-badge xr-badge--muted', bits.join(' · ')));
                li.appendChild(head);
                const tips = [];
                if (m.anonymousBare.items.length) {
                    tips.push('ANON-BARE:\n' + listTip(m.anonymousBare,
                        (s) => `• ${truncate(s.label, 60)}${s.quote ? ` — “${s.quote.slice(0, 90)}”` : ''}`));
                }
                if (m.singleSourced.items.length) {
                    tips.push('SINGLE-SOURCED:\n' + listTip(m.singleSourced,
                        (c) => `• ${truncate(c.claim, 80)} (${c.sourceType})`));
                }
                if (m.unretrievableDocs.items.length) {
                    tips.push('UNRETRIEVABLE:\n' + listTip(m.unretrievableDocs,
                        (d) => `• ${truncate(d.document, 70)}${d.linked ? '' : ' — not linked'}${d.retrievable ? '' : ' — not identifiable'}`));
                }
                if (m.caveats.items.length) {
                    tips.push('CAVEATS:\n' + listTip(m.caveats, (c) => `• ${truncate(c, 110)}`));
                }
                li.title = tips.join('\n\n');
                ul.appendChild(li);
            }
            if (ku.members.length > MAX_MEMBER_ROWS) {
                ul.appendChild(el('li', 'xr-inspector__mono',
                    `…and ${ku.members.length - MAX_MEMBER_ROWS} more members`));
            }
            sec.appendChild(ul);
            block.appendChild(sec);
        }

        if (ku.coverageGaps.length) {
            const sec = el('details', 'xr-synth__sec');
            sec.appendChild(el('summary', null,
                `Coverage gaps from the corpus brief (${ku.coverageGaps.length})`));
            const ul = el('ul', 'xr-list');
            for (const g of ku.coverageGaps) ul.appendChild(el('li', 'xr-synth__text', g));
            sec.appendChild(ul);
            block.appendChild(sec);
        }
    })().catch((err) => {
        Utils.error('Known-unknowns block failed', err);
        block.remove();
    });
}

// The forensic-findings block (Phase 14.4) — the same findings rendered
// through Dawn McCarty's four report lenses (evidentiary / executive /
// survivor / editor). Hung on the entity (subject) view and the case
// view, beside the audit dossier. No score, no average — the lenses are
// render MODES over the same evidence-anchored findings, and every
// finding keeps its required counter-read in view (no verdict).

import { el, truncate } from './dom.js';
import { MANEUVER_GUIDE } from '../shared/forensic-taxonomy.js';
import { FINDING_LENSES, maneuverTally, leadQuote, maneuverShort } from './forensic-data.js';

const LENS_LABELS = {
    evidentiary: 'Evidentiary',
    executive:   'Executive',
    survivor:    'Survivor',
    editor:      'Editor'
};

export function renderFindingsBlock(host, findings, { subjectName = 'this subject' } = {}) {
    if (!findings || findings.length === 0) return;
    const block = el('div', 'xr-view__findings');
    block.appendChild(el('h3', 'xr-case__heading',
        `Forensic findings (${findings.length}) — named maneuvers, no verdict`));

    let lens = 'evidentiary';
    const lensBar = el('div', 'xr-findings-lens');
    const body = el('div', 'xr-findings-lens__body');
    const buttons = {};
    for (const k of FINDING_LENSES) {
        const b = el('button', 'xr-findings-lens__btn', LENS_LABELS[k]);
        b.type = 'button';
        b.title = `${LENS_LABELS[k]} lens`;
        b.addEventListener('click', () => { lens = k; sync(); });
        buttons[k] = b;
        lensBar.appendChild(b);
    }
    function sync() {
        for (const k of FINDING_LENSES) {
            buttons[k].classList.toggle('xr-findings-lens__btn--active', k === lens);
        }
        renderLens(body, lens, findings, subjectName);
    }
    block.appendChild(lensBar);
    block.appendChild(body);
    sync();
    host.appendChild(block);
}

function renderLens(body, lens, findings, subjectName) {
    body.textContent = '';
    if (lens === 'executive') return renderExecutive(body, findings);
    if (lens === 'survivor')  return renderSurvivor(body, findings);
    if (lens === 'editor')    return renderEditor(body, findings, subjectName);
    return renderEvidentiary(body, findings);
}

function definition(maneuver) {
    const g = MANEUVER_GUIDE[maneuver];
    return g ? g.definition : '';
}

// Evidentiary — the full record: every finding, every anchor quote, the
// counter-read, for the file.
function renderEvidentiary(body, findings) {
    for (const f of findings) {
        const row = el('div', 'xr-finding-row');
        row.appendChild(el('div', 'xr-finding-row__head',
            `${f.maneuver} · ${f.role || 'subject'} · basis ${f.basis || '—'}`));
        for (const a of f.anchors || []) {
            if (!a.quote) continue;
            row.appendChild(el('blockquote', 'xr-finding-row__quote', a.quote));
        }
        if (f.note) row.appendChild(el('div', 'xr-finding-row__note', f.note));
        row.appendChild(el('div', 'xr-finding-row__counter', `Counter-read: ${f.counterNote || '—'}`));
        body.appendChild(row);
    }
}

// Executive — the rollup: a maneuver tally + one compact line per finding.
function renderExecutive(body, findings) {
    const chips = el('div', 'xr-finding-tally');
    for (const t of maneuverTally(findings)) {
        chips.appendChild(el('span', 'xr-badge', `${t.count}× ${maneuverShort(t.maneuver)}`));
    }
    body.appendChild(chips);
    for (const f of findings) {
        body.appendChild(el('div', 'xr-finding-line',
            `${maneuverShort(f.maneuver)} — “${truncate(leadQuote(f), 90)}”`));
    }
}

// Survivor — plain language, validation-oriented: the pattern was named
// with evidence AND a fair counter-read (real, but bounded).
function renderSurvivor(body, findings) {
    body.appendChild(el('p', 'xr-finding-lens-intro',
        'Each pattern was named with evidence and a fair counter-read — the move is real, and bounded.'));
    for (const f of findings) {
        const row = el('div', 'xr-finding-row');
        const d = definition(f.maneuver);
        row.appendChild(el('div', 'xr-finding-row__head', `${maneuverShort(f.maneuver)}${d ? ` — ${d}` : ''}`));
        const q = leadQuote(f);
        if (q) row.appendChild(el('blockquote', 'xr-finding-row__quote', `“${q}”`));
        row.appendChild(el('div', 'xr-finding-row__counter', `The fair counter-read: ${f.counterNote || '—'}`));
        body.appendChild(row);
    }
}

// Editor — a prose draft an editor could lift into an article. Every
// sentence is anchored to the evidence above; nothing asserts intent.
function renderEditor(body, findings, subjectName) {
    const parts = [];
    const tally = maneuverTally(findings);
    if (tally.length) {
        parts.push(`Across this material, ${subjectName} reached for the same moves — `
            + tally.map((t) => `${maneuverShort(t.maneuver)} (${t.count}×)`).join(', ') + '.');
    }
    for (const f of findings.slice(0, 6)) {
        const q = leadQuote(f);
        parts.push(`When pressed, ${subjectName} ${describe(f.maneuver)}${q ? ` — “${truncate(q, 120)}.”` : '.'} `
            + `In fairness: ${f.counterNote || 'an alternative reading is possible.'}`);
    }
    body.appendChild(el('pre', 'xr-finding-editor', parts.join('\n\n')));
    body.appendChild(el('div', 'xr-finding-row__note xr-view__dossier-line--dim',
        'A draft for an editor — every sentence is anchored to the evidence above; nothing asserts intent.'));
}

function describe(maneuver) {
    const g = MANEUVER_GUIDE[maneuver];
    return g
        ? g.definition.charAt(0).toLowerCase() + g.definition.slice(1).replace(/\.$/, '')
        : `used ${maneuverShort(maneuver)}`;
}

// Evidence block — CD.2 (docs/CASE_DOSSIER_DESIGN.md §3.4).
// The convergence-collapsed evidence table: one row per source, with
// its capture completeness, its per-claim verbatim quotes, its origin
// convergence (twelve outlets on one wire count as one), and its raw
// per-article audit band run through the SHARED display rules
// (`auditCardChipData` — no naked numbers, sub-0.6 → review) so the
// classification can never fork from the reader's. Plus the §7.1
// "unprocessed sources" backlog. Thin projection of the pure dossier;
// all text goes through `el()`/textContent (no innerHTML).

import { el, truncate } from './dom.js';
import { assembleCaseDossier } from '../shared/case-dossier.js';
import { auditCardChipData } from '../shared/audit/display.js';
import { Utils } from '../shared/utils.js';

const MAX_ROWS = 40;
const MAX_CLAIMS_PER_ROW = 4;

function captureChips(row) {
    const wrap = el('span', 'xr-ev__caps');
    const chip = (on, label) => {
        wrap.appendChild(el('span', on ? 'xr-badge xr-badge--muted' : 'xr-badge xr-badge--off', label));
    };
    chip(row.capture.archived, 'archived');
    chip(row.capture.screenshot, 'screenshot');
    chip(row.capture.published_to_relay, 'relayed');
    return wrap;
}

// `dossierOrId`: a pre-built case dossier (shared assembly, 20.1) or a
// case entity id. `opts.onExtractClaims(url)` opens a claimless member
// row's archived article in the reader to extract claims (20.1).
export function renderEvidenceBlock(host, dossierOrId, opts = {}) {
    if (!dossierOrId) return;
    const { onExtractClaims, onRemoveFromCase } = opts;
    const block = el('div', 'xr-view__dossier');
    host.appendChild(block);

    (async () => {
        const caseDossier = typeof dossierOrId === 'string'
            ? await assembleCaseDossier(dossierOrId) : dossierOrId;
        const ev = caseDossier.evidence;
        // Convergence summary indexed by the claim ids it collapses, so a
        // row can show the independence structure of its sources.
        const convByProp = ev.by_proposition;
        if (ev.articles.length === 0 && ev.unprocessed_sources.length === 0) { block.remove(); return; }

        block.appendChild(el('h3', 'xr-case__heading', 'Evidence — sources collapsed by origin'));
        block.appendChild(el('div', 'xr-view__dossier-line',
            `${ev.coverage.articles} sources · ${ev.coverage.attested_articles} attested · `
            + `${ev.coverage.articles_with_audit} audited · ${ev.coverage.unprocessed} unprocessed`));

        const list = el('ul', 'xr-list');
        for (const row of ev.articles.slice(0, MAX_ROWS)) {
            const li = el('li', 'xr-row xr-case__evrow');
            const head = el('div', 'xr-row__head');
            head.appendChild(el('span', 'xr-row__title', row.title || row.url));
            head.appendChild(captureChips(row));
            if (row.origin_keys.length > 0) {
                head.appendChild(el('span', 'xr-badge xr-badge--muted',
                    `${row.origin_keys.length} origin${row.origin_keys.length === 1 ? '' : 's'}`));
            }
            // Tag-only member (20.1 union membership): no claims extracted
            // yet — a first-class row with a nudge, not a footnote.
            if (row.processed === false) {
                head.appendChild(el('span', 'xr-badge xr-badge--off', 'no claims yet'));
                if (typeof onExtractClaims === 'function') {
                    const btn = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Extract claims →');
                    btn.type = 'button';
                    btn.addEventListener('click', () => onExtractClaims(row.url));
                    head.appendChild(btn);
                }
            }
            // 20.2 — a tag-membership row can be detached from the case
            // here. Rows that are ALSO claim-referenced (membership
            // 'both'/'claims') keep their membership through the claims,
            // so removing the tag wouldn't detach them — show a note.
            if (row.membership === 'tag' && typeof onRemoveFromCase === 'function') {
                const rm = el('button', 'xr-portal__btn xr-portal__btn--ghost', '✕ remove');
                rm.type = 'button';
                rm.title = 'Remove this article\'s case tag (local only)';
                rm.addEventListener('click', () => onRemoveFromCase(row.url));
                head.appendChild(rm);
            } else if (row.membership === 'both') {
                const note = el('span', 'xr-badge xr-badge--muted', 'tagged + claimed');
                note.title = 'Also a member via its claims — remove those to detach';
                head.appendChild(note);
            }
            // Raw per-article audit aggregate → the shared band/review rule.
            for (const run of row.audit_runs) {
                const chip = auditCardChipData(run.aggregate);
                if (!chip) continue;
                const b = el('span', `xr-badge xr-badge--audit-${chip.bandKey}`, chip.text);
                b.title = chip.title;
                head.appendChild(b);
            }
            li.appendChild(head);

            // Link edges (both sides): outbound external links as
            // captured, and corpus articles that link back to this
            // one. Silent when the capture predates link extraction
            // AND nothing links to it — absence of the line is not
            // "zero links".
            const lnk = row.links;
            if (lnk && (lnk.captured || lnk.linked_by.length > 0)) {
                const bits = [];
                if (lnk.captured) {
                    bits.push(`links to ${lnk.external} external source${lnk.external === 1 ? '' : 's'}`
                        + (lnk.corpus_links.length ? ` (${lnk.corpus_links.length} in this case)` : ''));
                }
                if (lnk.linked_by.length > 0) {
                    bits.push(`linked from ${lnk.linked_by.length} case article${lnk.linked_by.length === 1 ? '' : 's'}`);
                }
                li.appendChild(el('div', 'xr-inspector__mono', bits.join(' · ')));
            }

            for (const c of row.claims.slice(0, MAX_CLAIMS_PER_ROW)) {
                if (c.quote) {
                    li.appendChild(el('blockquote', 'xr-finding-row__quote', truncate(c.quote, 160)));
                } else {
                    li.appendChild(el('div', 'xr-ev__claim', truncate(c.text || '', 140)));
                }
            }
            if (row.claims.length > MAX_CLAIMS_PER_ROW) {
                li.appendChild(el('div', 'xr-inspector__mono', `… +${row.claims.length - MAX_CLAIMS_PER_ROW} more claim(s)`));
            }
            list.appendChild(li);
        }
        if (ev.articles.length > MAX_ROWS) {
            list.appendChild(el('li', 'xr-inspector__mono', `… +${ev.articles.length - MAX_ROWS} more source(s)`));
        }
        block.appendChild(list);

        // Convergence: how many origins collapse, and how many are
        // demonstrably independent (derivation, not a slogan).
        const propIds = Object.keys(convByProp);
        if (propIds.length > 0) {
            const collapsed = propIds.reduce((a, id) => a + convByProp[id].total_attestations, 0);
            const origins = propIds.reduce((a, id) => a + convByProp[id].origin_count, 0);
            const independent = propIds.reduce((a, id) => a + convByProp[id].independent_count, 0);
            block.appendChild(el('div', 'xr-view__dossier-line',
                `Convergence: ${collapsed} attestations collapse to ${origins} origin(s), `
                + `${independent} demonstrably independent`));
        }

        // The visible backlog — sources in the orbit with zero claims yet.
        if (ev.unprocessed_sources.length > 0) {
            block.appendChild(el('h4', 'xr-inspector__sub', `Unprocessed sources (${ev.unprocessed_sources.length})`));
            for (const u of ev.unprocessed_sources.slice(0, 12)) {
                block.appendChild(el('div', 'xr-inspector__mono', `${u.source} · ${truncate(u.title || u.url, 100)}`));
            }
        }
    })().catch((err) => {
        Utils.error('Evidence block render failed', err);
        block.remove();
    });
}

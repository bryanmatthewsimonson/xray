// Hypothesis map block — Phase 26 H.2 (docs/HYPOTHESIS_MAP_DESIGN.md
// §4). Side-by-side competing answers with their supporting and
// undermining claim attachments. Thin projection of the pure map
// (`buildHypothesisMap`); all text goes through `el()`/textContent
// (no innerHTML).
//
// The §6 render red lines, enforced by `buildHypothesisBlockModel`
// (pure, node-testable — the DOM layer maps it 1:1):
//   - hypotheses render side by side; the visible copy says the order
//     is not a ranking and X-Ray does not pick a winner;
//   - the ONLY counts beside a role are each section's own size
//     ("Supporting evidence (N)") — no cross-hypothesis comparison
//     string exists anywhere in the model (guard-tested);
//   - verdict chips are context; the copy says they do not weight the
//     edge;
//   - no progress bars, no meters, no per-hypothesis totals compared.

import { el, truncate } from './dom.js';
import { collectHypothesisMapData, buildHypothesisMap } from '../shared/hypothesis-map.js';
import { VERDICT_STATE_LABELS, PROPOSITION_CLASS_LABELS } from '../shared/truth-taxonomy.js';
import { Utils } from '../shared/utils.js';

const MAX_EDGES_PER_SECTION = 12;
const MAX_DANGLING = 6;

export const HYPOTHESIS_BLOCK_HEADING = 'Hypotheses — competing answers, not a ranking';
export const HYPOTHESIS_BLOCK_EXPLAINER =
    'Competing answers to the case question, with the specific claims each one rests on. '
    + 'X-Ray maps the answers side by side; it does not pick one, the order is not a ranking, '
    + 'and section sizes are never compared across hypotheses. A verdict chip is context for '
    + 'the claim it sits on — it does not weight the edge, and a contested claim can still be '
    + 'load-bearing.';

const ROLE_HEADINGS = { supports: 'Supporting evidence', undermines: 'Undermining evidence' };

function provenanceBadge(suggestedBy) {
    if (!suggestedBy || suggestedBy === 'user') return null;
    if (suggestedBy === 'seed:brief') return 'from brief';
    if (suggestedBy.startsWith('llm:')) return suggestedBy;
    if (suggestedBy.startsWith('nostr:')) return `nostr:${suggestedBy.slice(6, 14)}…`;
    return suggestedBy;
}

/**
 * Pure view model: every user-facing string the block will render,
 * derived from a built hypothesis map. Exported so the no-scoreboard
 * guard test can walk the strings without a DOM.
 */
export function buildHypothesisBlockModel(map) {
    const empty = map.hypotheses.length === 0 && map.dangling.edges.length === 0;
    const c = map.coverage;
    const model = {
        empty,
        heading: HYPOTHESIS_BLOCK_HEADING,
        explainer: HYPOTHESIS_BLOCK_EXPLAINER,
        // Map-level totals only — never a per-hypothesis figure.
        countsLine: `${c.hypotheses} hypothes${c.hypotheses === 1 ? 'is' : 'es'} · `
            + `${c.edges} claim attachment${c.edges === 1 ? '' : 's'} · `
            + `${c.claims} distinct claim${c.claims === 1 ? '' : 's'}`,
        questionLine: map.question.text ? `Case question (author's framing): ${map.question.text}` : null,
        cards: [],
        danglingLine: null,
        dangling: [],
        unlabeledLine: null
    };
    if (empty) return model;

    const cruxRefs = new Set(map.shared_claims.map((s) => s.ref));
    for (const h of map.hypotheses) {
        const card = {
            id: h.id,
            title: h.label,
            statement: h.statement,
            provenance: provenanceBadge(h.suggested_by),
            holders: h.holders.map((hold) => ({
                label: hold.title || hold.url || `${hold.article_hash.slice(0, 12)}… (not in local archive)`,
                url:   hold.url
            })),
            sections: []
        };
        for (const role of ['supports', 'undermines']) {
            const edges = h.edges[role];
            card.sections.push({
                role,
                // The one place a count is allowed: this section's own size.
                heading: `${ROLE_HEADINGS[role]} (${edges.length})`,
                edges: edges.slice(0, MAX_EDGES_PER_SECTION).map((e) => ({
                    text:  e.claim ? truncate(e.claim.text, 140) : `${e.ref} (unresolved claim)`,
                    url:   e.claim ? e.claim.url : null,
                    quote: e.quote ? truncate(e.quote, 200) : null,
                    note:  e.note || null,
                    crux:  cruxRefs.has(e.ref),
                    provenance: provenanceBadge(e.suggested_by),
                    verdictChips: e.verdicts
                        .filter((v) => v.state !== null)
                        .map((v) => `${PROPOSITION_CLASS_LABELS[v.proposition_class] || v.proposition_class}: `
                            + `${VERDICT_STATE_LABELS[v.state] || v.state}`)
                })),
                overflow: edges.length > MAX_EDGES_PER_SECTION
                    ? `… +${edges.length - MAX_EDGES_PER_SECTION} more` : null
            });
        }
        model.cards.push(card);
    }

    if (map.dangling.edges.length > 0) {
        model.danglingLine = `${map.dangling.edges.length} attachment${map.dangling.edges.length === 1 ? '' : 's'} `
            + 'reference a hypothesis that no longer exists — kept visible for disclosure.';
        model.dangling = map.dangling.edges.slice(0, MAX_DANGLING).map((e) =>
            `${e.role} · ${e.claim ? truncate(e.claim.text, 100) : e.ref}`);
    }
    if (c.unlabeled_positions > 0) {
        model.unlabeledLine = `${c.unlabeled_positions} brief position${c.unlabeled_positions === 1 ? '' : 's'} `
            + 'had no label and could not seed a hypothesis.';
    }
    return model;
}

// ------------------------------------------------------------------
// DOM layer — a 1:1 projection of the model.
// ------------------------------------------------------------------

function sourceLink(url, label) {
    const a = el('a', 'xr-synth__src', label);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noreferrer noopener';
    a.title = url;
    return a;
}

/**
 * Render the hypothesis map for a case. `data` is the shared
 * `collectCaseDossierData` envelope (assembled once by the case view);
 * the brief and the hypothesis/edge models are read live.
 */
export function renderHypothesesBlock(host, { data }) {
    if (!data || !data.case) return;
    const block = el('div', 'xr-view__dossier xr-hyp');
    host.appendChild(block);

    (async () => {
        const input = await collectHypothesisMapData(data.case.id, { data });
        const map = buildHypothesisMap(input, null);
        const model = buildHypothesisBlockModel(map);
        if (model.empty) { block.remove(); return; }

        block.appendChild(el('h3', 'xr-case__heading', model.heading));
        block.appendChild(el('div', 'xr-case__explainer', model.explainer));
        if (model.questionLine) block.appendChild(el('div', 'xr-view__dossier-line', model.questionLine));
        block.appendChild(el('div', 'xr-view__dossier-line', model.countsLine));

        const grid = el('div', 'xr-hyp__grid');
        for (const card of model.cards) {
            const cardEl = el('div', 'xr-hyp__card');
            const head = el('div', 'xr-row__head');
            head.appendChild(el('h4', 'xr-inspector__sub', card.title));
            if (card.provenance) head.appendChild(el('span', 'xr-badge xr-badge--muted', card.provenance));
            cardEl.appendChild(head);
            if (card.statement && card.statement !== card.title) {
                cardEl.appendChild(el('div', 'xr-hyp__statement', card.statement));
            }
            if (card.holders.length > 0) {
                const holders = el('div', 'xr-hyp__holders');
                holders.appendChild(el('span', 'xr-inspector__mono', 'held by: '));
                card.holders.forEach((hold, i) => {
                    if (i > 0) holders.appendChild(el('span', 'xr-inspector__mono', ' · '));
                    holders.appendChild(hold.url
                        ? sourceLink(hold.url, hold.label)
                        : el('span', 'xr-inspector__mono', hold.label));
                });
                cardEl.appendChild(holders);
            }
            for (const section of card.sections) {
                const sec = el('details', 'xr-synth__sec');
                sec.open = true;
                sec.appendChild(el('summary', null, section.heading));
                for (const edge of section.edges) {
                    const row = el('div', 'xr-hyp__edge');
                    const line = el('div', 'xr-hyp__edgeline');
                    line.appendChild(edge.url
                        ? sourceLink(edge.url, edge.text)
                        : el('span', null, edge.text));
                    if (edge.crux) {
                        const b = el('span', 'xr-badge xr-badge--warn', 'crux');
                        b.title = 'This claim is attached to more than one hypothesis — the disagreement, made legible.';
                        line.appendChild(b);
                    }
                    if (edge.provenance) line.appendChild(el('span', 'xr-badge xr-badge--muted', edge.provenance));
                    for (const chip of edge.verdictChips) {
                        const v = el('span', 'xr-badge xr-badge--muted', chip);
                        v.title = 'Verdict context for this claim — it does not weight the edge.';
                        line.appendChild(v);
                    }
                    row.appendChild(line);
                    if (edge.quote) row.appendChild(el('blockquote', 'xr-finding-row__quote', edge.quote));
                    if (edge.note) row.appendChild(el('div', 'xr-inspector__mono', edge.note));
                    sec.appendChild(row);
                }
                if (section.edges.length === 0) {
                    sec.appendChild(el('div', 'xr-inspector__mono', 'none attached yet'));
                }
                if (section.overflow) sec.appendChild(el('div', 'xr-inspector__mono', section.overflow));
                cardEl.appendChild(sec);
            }
            grid.appendChild(cardEl);
        }
        block.appendChild(grid);

        if (model.danglingLine) {
            block.appendChild(el('div', 'xr-view__dossier-line', model.danglingLine));
            for (const line of model.dangling) {
                block.appendChild(el('div', 'xr-inspector__mono', line));
            }
        }
        if (model.unlabeledLine) {
            block.appendChild(el('div', 'xr-inspector__mono', model.unlabeledLine));
        }
    })().catch((err) => {
        Utils.error('Hypothesis block render failed', err);
        block.remove();
    });
}

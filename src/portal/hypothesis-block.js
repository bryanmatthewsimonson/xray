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
import { HypothesisModel, HypothesisEdgeModel, HYPOTHESIS_EDGE_ROLES, HYPOTHESIS_EDGE_ROLE_LABELS } from '../shared/hypothesis-model.js';
import { VERDICT_STATE_LABELS, PROPOSITION_CLASS_LABELS } from '../shared/truth-taxonomy.js';
import { Utils } from '../shared/utils.js';

const MAX_EDGES_PER_SECTION = 12;
const MAX_DANGLING = 6;

// Every DOM-layer-only string (H.3 authoring copy, badge tooltips) —
// exported so the no-scoreboard guard test walks these alongside the
// model's strings; nothing the block puts on screen escapes the guard.
export const CRUX_BADGE_TITLE =
    'This claim is attached to more than one hypothesis — the disagreement, made legible.';
export const VERDICT_CHIP_TITLE =
    'Verdict context for this claim — it does not weight the edge.';
export const AUTHORING_STRINGS = Object.freeze([
    'Add hypothesis…', 'Attach claim…', 'Add', 'Attach', 'Cancel',
    '✕ detach', '✕ delete hypothesis',
    'Remove this claim attachment (local only)',
    'Label (identity — cannot be renamed later)',
    'Statement (the competing answer, editable)',
    'Note (optional — why this claim bears on this answer)',
    'A claim can support one hypothesis and undermine another — attach it to each; nothing is netted.',
    CRUX_BADGE_TITLE, VERDICT_CHIP_TITLE
]);

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
            persisted: h.persisted,
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
                    id:    e.edge_id,
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

/** Inline "add hypothesis" form (H.3). */
function mountAddHypothesis(host, { caseId, onChanged }) {
    host.replaceChildren();
    const form = el('div', 'xr-hyp__form');
    const labelInput = el('input', 'xr-hyp__input');
    labelInput.placeholder = 'Label (identity — cannot be renamed later)';
    const stmtInput = el('input', 'xr-hyp__input');
    stmtInput.placeholder = 'Statement (the competing answer, editable)';
    const add = el('button', 'xr-portal__btn', 'Add');
    add.type = 'button';
    const cancel = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => host.replaceChildren());
    add.addEventListener('click', async () => {
        try {
            const label = labelInput.value.trim();
            if (!label) { labelInput.focus(); return; }
            await HypothesisModel.create({
                case_id: caseId, label, statement: stmtInput.value.trim(), suggested_by: 'user'
            });
            onChanged();
        } catch (err) { Utils.error('Add hypothesis failed', err); }
    });
    form.appendChild(labelInput);
    form.appendChild(stmtInput);
    form.appendChild(add);
    form.appendChild(cancel);
    host.appendChild(form);
    labelInput.focus();
}

/**
 * Inline "attach claim" form for one hypothesis card (H.3). A seed
 * card is PROMOTED on first attach: the hypothesis record is created
 * (idempotent — label is identity) and the edge lands on it.
 */
function mountAttachClaim(host, { caseId, card, claims, onChanged }) {
    host.replaceChildren();
    const form = el('div', 'xr-hyp__form');
    form.appendChild(el('div', 'xr-inspector__mono',
        'A claim can support one hypothesis and undermine another — attach it to each; nothing is netted.'));
    const claimSel = el('select', 'xr-hyp__input');
    for (const c of claims) {
        const opt = el('option', null, truncate(c.text, 110));
        opt.value = c.id;
        claimSel.appendChild(opt);
    }
    const roleSel = el('select', 'xr-hyp__input');
    for (const role of HYPOTHESIS_EDGE_ROLES) {
        const opt = el('option', null, HYPOTHESIS_EDGE_ROLE_LABELS[role]);
        opt.value = role;
        roleSel.appendChild(opt);
    }
    const noteInput = el('input', 'xr-hyp__input');
    noteInput.placeholder = 'Note (optional — why this claim bears on this answer)';
    const attach = el('button', 'xr-portal__btn', 'Attach');
    attach.type = 'button';
    const cancel = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => host.replaceChildren());
    attach.addEventListener('click', async () => {
        try {
            if (!claimSel.value) return;
            const hyp = await HypothesisModel.create({
                case_id: caseId, label: card.title,
                statement: card.statement === card.title ? '' : card.statement,
                suggested_by: 'user'
            });
            await HypothesisEdgeModel.create({
                hypothesis_id: hyp.id, claim_ref: claimSel.value,
                role: roleSel.value, note: noteInput.value.trim(), suggested_by: 'user'
            });
            onChanged();
        } catch (err) { Utils.error('Attach claim failed', err); }
    });
    form.appendChild(claimSel);
    form.appendChild(roleSel);
    form.appendChild(noteInput);
    form.appendChild(attach);
    form.appendChild(cancel);
    host.appendChild(form);
}

/**
 * Render the hypothesis map for a case. `data` is the shared
 * `collectCaseDossierData` envelope (assembled once by the case view);
 * the brief and the hypothesis/edge models are read live.
 * `callbacks.onReloadCase` re-renders the case view after authoring.
 */
export function renderHypothesesBlock(host, { data, callbacks = {} }) {
    if (!data || !data.case) return;
    const block = el('div', 'xr-view__dossier xr-hyp');
    host.appendChild(block);
    const onChanged = () => { if (callbacks.onReloadCase) callbacks.onReloadCase(); };

    (async () => {
        const input = await collectHypothesisMapData(data.case.id, { data });
        const map = buildHypothesisMap(input, null);
        const model = buildHypothesisBlockModel(map);
        const orbitClaims = (data.orbit && data.orbit.claims) || [];
        // An empty map on a claimless case renders nothing; with claims
        // present, the compact authoring block keeps the map startable.
        if (model.empty && orbitClaims.length === 0) { block.remove(); return; }

        block.appendChild(el('h3', 'xr-case__heading', model.heading));
        block.appendChild(el('div', 'xr-case__explainer', model.explainer));
        if (model.questionLine) block.appendChild(el('div', 'xr-view__dossier-line', model.questionLine));
        if (!model.empty) block.appendChild(el('div', 'xr-view__dossier-line', model.countsLine));

        // H.3 — add a competing answer by hand.
        const addHost = el('div');
        const addBtn = el('button', 'xr-portal__btn', 'Add hypothesis…');
        addBtn.type = 'button';
        addBtn.addEventListener('click', () =>
            mountAddHypothesis(addHost, { caseId: data.case.id, onChanged }));
        block.appendChild(addBtn);
        block.appendChild(addHost);
        if (model.empty) return;

        const grid = el('div', 'xr-hyp__grid');
        for (const card of model.cards) {
            const cardEl = el('div', 'xr-hyp__card');
            const head = el('div', 'xr-row__head');
            head.appendChild(el('h4', 'xr-inspector__sub', card.title));
            if (card.provenance) head.appendChild(el('span', 'xr-badge xr-badge--muted', card.provenance));
            // H.3 authoring: attach a claim (promotes a seed card on
            // first attach); delete a persisted hypothesis + its edges.
            const attachHost = el('div');
            if (orbitClaims.length > 0) {
                const attachBtn = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Attach claim…');
                attachBtn.type = 'button';
                attachBtn.addEventListener('click', () => mountAttachClaim(attachHost, {
                    caseId: data.case.id, card, claims: orbitClaims, onChanged
                }));
                head.appendChild(attachBtn);
            }
            if (card.persisted) {
                const delBtn = el('button', 'xr-portal__btn xr-portal__btn--ghost', '✕ delete hypothesis');
                delBtn.type = 'button';
                delBtn.addEventListener('click', async () => {
                    const n = card.sections.reduce((a, s) => a + s.edges.length, 0);
                    const msg = n > 0
                        ? `Delete hypothesis "${card.title}"? Its ${n} claim attachment${n === 1 ? '' : 's'} will also be removed.`
                        : `Delete hypothesis "${card.title}"?`;
                    if (!confirm(msg)) return;
                    try { await HypothesisModel.delete(card.id); onChanged(); }
                    catch (err) { Utils.error('Delete hypothesis failed', err); }
                });
                head.appendChild(delBtn);
            }
            cardEl.appendChild(head);
            cardEl.appendChild(attachHost);
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
                    if (edge.id) {
                        const detach = el('button', 'xr-portal__btn xr-portal__btn--ghost', '✕ detach');
                        detach.type = 'button';
                        detach.title = 'Remove this claim attachment (local only)';
                        detach.addEventListener('click', async () => {
                            try { await HypothesisEdgeModel.delete(edge.id); onChanged(); }
                            catch (err) { Utils.error('Detach edge failed', err); }
                        });
                        line.appendChild(detach);
                    }
                    if (edge.crux) {
                        const b = el('span', 'xr-badge xr-badge--warn', 'crux');
                        b.title = CRUX_BADGE_TITLE;
                        line.appendChild(b);
                    }
                    if (edge.provenance) line.appendChild(el('span', 'xr-badge xr-badge--muted', edge.provenance));
                    for (const chip of edge.verdictChips) {
                        const v = el('span', 'xr-badge xr-badge--muted', chip);
                        v.title = VERDICT_CHIP_TITLE;
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

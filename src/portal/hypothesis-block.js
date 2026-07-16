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
import {
    validateHypothesisEdges, groundEdgeQuotes, filterEdgeProposals, unopposedHypotheses
} from '../shared/hypothesis-suggest.js';
import { digestDossier, DIGEST_CLAIM_CAP } from '../shared/case-synthesis.js';
import { VERDICT_STATE_LABELS, PROPOSITION_CLASS_LABELS } from '../shared/truth-taxonomy.js';
import { Utils } from '../shared/utils.js';

function sendMessage(msg) {
    return new Promise((resolve) => {
        try { chrome.runtime.sendMessage(msg, (resp) => resolve(resp)); }
        catch (_) { resolve(null); }
    });
}

const MAX_EDGES_PER_SECTION = 12;
const MAX_DANGLING = 6;

// Every DOM-layer-only string (H.3 authoring copy, badge tooltips) —
// exported so the no-scoreboard guard test walks these alongside the
// model's strings; nothing the block puts on screen escapes the guard.
export const CRUX_BADGE_TITLE =
    'This claim is attached to more than one hypothesis — the disagreement, made legible.';
export const VERDICT_CHIP_TITLE =
    'Verdict context for this claim — it does not weight the edge.';
export const SUGGEST_STATUS_PROPOSING = 'Proposing edges…';
export const SUGGEST_STATUS_MALFORMED = 'The model returned malformed edge proposals.';
export const SUGGEST_STATUS_FAILED = 'Edge suggestion failed';

/** The suggest pass's disclosure line — pure, so the guard walks it. */
export function suggestStatusLine({ checked, dropped, rejected, proposals }) {
    return `${checked} quote${checked === 1 ? '' : 's'} checked · `
        + `${dropped} ungrounded (dropped) · ${rejected} rejected · `
        + `${proposals} proposal${proposals === 1 ? '' : 's'}`;
}

export const AUTHORING_STRINGS = Object.freeze([
    'Add hypothesis…', 'Attach claim…', 'Add', 'Attach', 'Cancel',
    '✕ detach', '✕ delete hypothesis',
    'Remove this claim attachment (local only)',
    'Label (identity — cannot be renamed later)',
    'Statement (the competing answer, editable)',
    'Note (optional — why this claim bears on this answer)',
    'A claim can support one hypothesis and undermine another — attach it to each; nothing is netted.',
    // H.4 suggest-edges surface (static fragments; counts are appended
    // as plain numbers of the map's own sections).
    'Suggest edges (LLM)…',
    'Set an Anthropic API key in Options → Advanced → LLM assist',
    'Proposed attachments — nothing applies without your Accept.',
    'Accept', 'Accepted ✓', 'Dismiss', 'Refresh map',
    'rejected:',
    'received no undermining scrutiny in this pass — treat their support as unexamined, not established:',
    SUGGEST_STATUS_PROPOSING, SUGGEST_STATUS_MALFORMED, SUGGEST_STATUS_FAILED,
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
            // The UNCAPPED per-role counts (the map row's coverage) —
            // the delete confirm must state the full blast radius even
            // when the rendered lists are truncated.
            coverage: { supports: h.coverage.supports, undermines: h.coverage.undermines },
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
 * H.4 — the LLM edge-suggestion surface. One reduce-shaped pass over
 * the dossier digest + the map's hypothesis rows (seeds included; a
 * seed is promoted at accept time). Everything the model returns goes
 * validate → ground → filter → both-sides disclosure, and each
 * surviving proposal lands only on a human Accept, stamped
 * `suggested_by: 'llm:<model>'`.
 */
function mountSuggestPanel(panelHost, { data, dossier, onChanged, onSettled, model }) {
    panelHost.replaceChildren();
    const status = el('div', 'xr-inspector__mono', SUGGEST_STATUS_PROPOSING);
    panelHost.appendChild(status);
    const settle = () => { if (onSettled) onSettled(); };

    (async () => {
        // Re-collect the map FRESH: edges accepted in a previous panel
        // (and seeds promoted by them) must reach `existingEdges` and
        // `rows`, or a re-run would re-propose already-applied work
        // instead of rejecting it as 'already attached'.
        const input = await collectHypothesisMapData(data.case.id, { data });
        const map = buildHypothesisMap(input, null);
        // Digest set === validation/grounding set (the 20.6 discipline):
        // digestDossier caps its claim index, so cap the SAME list here.
        const orbitClaims = ((data.orbit && data.orbit.claims) || []).slice(0, DIGEST_CLAIM_CAP);
        const claimsById = {};
        for (const c of orbitClaims) claimsById[c.id] = c;
        const rows = map.hypotheses.map((h) => ({ id: h.id, label: h.label, statement: h.statement }));
        const existingEdges = map.hypotheses.flatMap((h) =>
            [...h.edges.supports, ...h.edges.undermines].map((e) => ({
                hypothesis_id: h.id, ref: e.ref, role: e.role
            })));

        const res = await sendMessage({ type: 'xray:llm:hypothesis-edges', request: {
            dossierDigest: digestDossier(dossier, { claims: orbitClaims }),
            hypotheses: rows,
            caseName: data.case.name || '',
            scopeQuestion: map.question.text || ''
        } });
        if (!res || !res.ok) {
            status.textContent = `${SUGGEST_STATUS_FAILED}: ${(res && res.error) || 'no response'}`;
            settle();
            return;
        }
        const v = validateHypothesisEdges(res.edgesInput);
        if (!v.ok) {
            status.textContent = SUGGEST_STATUS_MALFORMED;
            Utils.error('hypothesis edge validation', v.errors);
            settle();
            return;
        }

        const grounded = groundEdgeQuotes(res.edgesInput.edges, claimsById);
        const { acceptable, rejected } = filterEdgeProposals(grounded.edges, {
            hypotheses: rows, claimsById, existingEdges
        });
        const unopposed = unopposedHypotheses(rows, acceptable, existingEdges);
        const passModel = res.model || model;

        settle();
        status.textContent = suggestStatusLine({
            checked: grounded.checked, dropped: grounded.dropped,
            rejected: rejected.length, proposals: acceptable.length
        });
        if (unopposed.length > 0) {
            panelHost.appendChild(el('div', 'xr-view__dossier-line',
                `${unopposed.length} hypothes${unopposed.length === 1 ? 'is' : 'es'} `
                + 'received no undermining scrutiny in this pass — treat their support as unexamined, not established: '
                + unopposed.map((u) => u.label).join(' · ')));
        }
        if (acceptable.length === 0 && rejected.length === 0) return;

        panelHost.appendChild(el('div', 'xr-case__explainer',
            'Proposed attachments — nothing applies without your Accept.'));
        const rowById = new Map(rows.map((r) => [r.id, r]));
        for (const p of acceptable) {
            const row = el('div', 'xr-hyp__edge');
            const line = el('div', 'xr-hyp__edgeline');
            line.appendChild(el('span', 'xr-badge xr-badge--muted', HYPOTHESIS_EDGE_ROLE_LABELS[p.role]));
            line.appendChild(el('span', null,
                `${(rowById.get(p.hypothesis_id) || {}).label || p.hypothesis_id} ← ${truncate((claimsById[p.claim_ref] || {}).text || p.claim_ref, 120)}`));
            const accept = el('button', 'xr-portal__btn', 'Accept');
            accept.type = 'button';
            accept.addEventListener('click', async () => {
                try {
                    accept.disabled = true;
                    const target = rowById.get(p.hypothesis_id);
                    const hyp = await HypothesisModel.create({
                        case_id: data.case.id, label: target.label,
                        statement: target.statement === target.label ? '' : target.statement,
                        suggested_by: `llm:${passModel}`
                    });
                    await HypothesisEdgeModel.create({
                        hypothesis_id: hyp.id, claim_ref: p.claim_ref, role: p.role,
                        note: p.why || '', quote: p.quote, suggested_by: `llm:${passModel}`
                    });
                    accept.textContent = 'Accepted ✓';
                } catch (err) {
                    accept.disabled = false;
                    Utils.error('Accept edge failed', err);
                }
            });
            line.appendChild(accept);
            const dismiss = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Dismiss');
            dismiss.type = 'button';
            dismiss.addEventListener('click', () => row.remove());
            line.appendChild(dismiss);
            row.appendChild(line);
            if (p.quote) row.appendChild(el('blockquote', 'xr-finding-row__quote', truncate(p.quote, 200)));
            if (p.why) row.appendChild(el('div', 'xr-inspector__mono', p.why));
            panelHost.appendChild(row);
        }
        for (const r of rejected.slice(0, 8)) {
            panelHost.appendChild(el('div', 'xr-inspector__mono',
                `rejected: ${r.hypothesis_id} ← ${r.claim_ref} (${r.reason})`));
        }
        const refresh = el('button', 'xr-portal__btn', 'Refresh map');
        refresh.type = 'button';
        refresh.addEventListener('click', () => onChanged());
        panelHost.appendChild(refresh);
    })().catch((err) => {
        Utils.error('Suggest edges failed', err);
        status.textContent = `${SUGGEST_STATUS_FAILED}.`;
        settle();
    });
}

/**
 * Render the hypothesis map for a case. `data` is the shared
 * `collectCaseDossierData` envelope (assembled once by the case view);
 * `dossier` the built case dossier (for the H.4 digest); the brief and
 * the hypothesis/edge models are read live.
 * `callbacks.onReloadCase` re-renders the case view after authoring.
 */
export function renderHypothesesBlock(host, { data, dossier, callbacks = {} }) {
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

        // H.3 — add a competing answer by hand; H.4 — the gated LLM
        // suggestion (caseSynthesis + llmAssist + key, checked in the
        // worker too; this button is advisory surface-gating only).
        const controls = el('div', 'xr-synth__controls');
        const addHost = el('div');
        const addBtn = el('button', 'xr-portal__btn', 'Add hypothesis…');
        addBtn.type = 'button';
        addBtn.addEventListener('click', () =>
            mountAddHypothesis(addHost, { caseId: data.case.id, onChanged }));
        controls.appendChild(addBtn);
        const suggestHost = el('div');
        if (!model.empty && dossier && orbitClaims.length > 0) {
            const cfg = await sendMessage({ type: 'xray:llm:corpus-config' });
            if (cfg && cfg.enabled) {
                const suggestBtn = el('button', 'xr-portal__btn', 'Suggest edges (LLM)…');
                suggestBtn.type = 'button';
                if (!cfg.hasKey) {
                    suggestBtn.disabled = true;
                    suggestBtn.title = 'Set an Anthropic API key in Options → Advanced → LLM assist';
                }
                suggestBtn.addEventListener('click', () => {
                    // The digest carries at most DIGEST_CLAIM_CAP claims —
                    // the confirm states what is actually sent.
                    const sent = Math.min(orbitClaims.length, DIGEST_CLAIM_CAP);
                    const capNote = orbitClaims.length > DIGEST_CLAIM_CAP
                        ? ` (the first ${sent} of ${orbitClaims.length} claims — the digest is capped)` : '';
                    if (!confirm(`Suggest claim→hypothesis edges with the LLM?\n\n`
                        + `This sends the case's dossier digest (${sent} claim${sent === 1 ? '' : 's'}${capNote}) `
                        + `and ${map.hypotheses.length} hypothes${map.hypotheses.length === 1 ? 'is' : 'es'} to Anthropic — one call. `
                        + `Every proposal still needs your Accept.`)) return;
                    // One pass at a time — a second click mid-flight would
                    // spend a second API call and interleave panels.
                    suggestBtn.disabled = true;
                    mountSuggestPanel(suggestHost, {
                        data, dossier, onChanged,
                        onSettled: () => { suggestBtn.disabled = !cfg.hasKey; },
                        model: cfg.model
                    });
                });
                controls.appendChild(suggestBtn);
            }
        }
        block.appendChild(controls);
        block.appendChild(addHost);
        block.appendChild(suggestHost);
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
                    // The UNCAPPED count — the rendered lists truncate at
                    // MAX_EDGES_PER_SECTION, but delete removes them all.
                    const n = card.coverage.supports + card.coverage.undermines;
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

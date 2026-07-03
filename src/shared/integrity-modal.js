// Integrity modal — Phase 15.10 (docs/TRUTH_ADJUDICATION_DESIGN.md §3.4).
//
// The words-vs-deeds authoring UI: pick a STATED commitment/value
// proposition (the word), pick ENACTED action-fact propositions about
// the same entity (the deeds), and adjudicate the match. Everything
// the model enforces surfaces here as structure:
//
//   - only word-eligible propositions appear in the word list, only
//     deed-eligible ones in the deed list (integrityRole — ascribed/
//     unclassified never even render as options);
//   - deed options filter to the word's about-entities (the
//     same-entity rule shown, not just thrown);
//   - the match vocabulary is per word class; gap decomposition only
//     unlocks on broken/contradicted, demands a documented note, and
//     a constraint cause demands a corroborated action-fact pick;
//   - when an ACTIVE finding exists for the same (word, deed set),
//     Save becomes a superseding finding and the form starts blank.
//
// UI-in-shared exception, same as assess/forensic/adjudicate modals.
// Must NOT be imported by the content script.

import { TruthAdjudicationModel } from './truth-adjudication-model.js';
import { IntegrityModel } from './integrity-model.js';
import { ClaimModel } from './claim-model.js';
import { EntityModel } from './entity-model.js';
import {
    integrityRole,
    matchStatesForWordClass, INTEGRITY_MATCH_LABELS,
    GAP_CAUSES, GAP_CAUSE_LABELS, GAP_MATCH_STATES,
    STANDARDS_OF_PROOF, STANDARD_OF_PROOF_LABELS, defaultStandardOfProof,
    EVIDENCE_TIERS, EVIDENCE_TIER_LABELS
} from './truth-taxonomy.js';

async function propositionOptions() {
    const [props, claims] = await Promise.all([
        TruthAdjudicationModel.list(), ClaimModel.getAll()
    ]);
    const words = [];
    const deeds = [];
    for (const p of props) {
        const role = integrityRole(p);
        if (!role) continue;
        const claim = claims[p.claim_id];
        const entry = {
            proposition: p,
            text: (claim && claim.text) || p.claim_id,
            about: (claim && claim.about) || []
        };
        (role === 'word' ? words : deeds).push(entry);
    }
    return { words, deeds };
}

/**
 * Open the integrity modal. Self-contained: collects candidates
 * itself; resolves with the saved finding or null on cancel.
 *
 * @returns {Promise<object|null>}
 */
export async function openIntegrityModal() {
    ensureStyles();
    const { words, deeds } = await propositionOptions();
    const entityNames = {};
    for (const list of [words, deeds]) {
        for (const e of list) {
            for (const id of e.about) {
                if (!(id in entityNames)) {
                    const ent = await EntityModel.get(id);
                    entityNames[id] = (ent && ent.name) || id;
                }
            }
        }
    }

    const state = {
        word: null,           // words[] entry
        deedIds: new Set(),   // proposition ids
        match: null,
        activeFinding: null,
        evidenceFor: [],
        evidenceAgainst: []
    };

    return new Promise((resolve) => {
        const host = document.createElement('div');
        host.className = 'xr-integrity';
        host.innerHTML = buildHtml(words);
        document.body.appendChild(host);
        const $ = (sel) => host.querySelector(sel);

        const close = (result) => {
            document.removeEventListener('keydown', onKey);
            if (host.parentNode) host.parentNode.removeChild(host);
            resolve(result);
        };
        const onKey = (ev) => { if (ev.key === 'Escape') close(null); };
        const showError = (msg) => {
            const err = $('.xr-integrity__err');
            err.textContent = msg;
            err.hidden = false;
        };

        // ---- word pick → deed candidates + match vocabulary ---------
        function eligibleDeeds() {
            if (!state.word) return [];
            const wordAbout = new Set(state.word.about);
            return deeds.filter((d) => d.about.some((id) => wordAbout.has(id)));
        }

        async function syncAfterSelection() {
            // Active chain head for this exact (word, deed set)?
            state.activeFinding = null;
            if (state.word && state.deedIds.size > 0) {
                const chain = await IntegrityModel.getForWordProposition(state.word.proposition.id);
                const wanted = [...state.deedIds].sort().join(',');
                state.activeFinding = chain.find((f) => !f.superseded_by
                    && f.deed_proposition_ids.slice().sort().join(',') === wanted) || null;
            }
            const banner = $('.xr-integrity__chain');
            if (state.activeFinding) {
                banner.hidden = false;
                banner.innerHTML = `Active match: <strong>${escapeHtml(INTEGRITY_MATCH_LABELS[state.activeFinding.match] || state.activeFinding.match)}</strong>`
                    + ' — saving <strong>supersedes</strong> it; the old finding is kept, never edited.';
                $('[data-action="save"]').textContent = 'Save superseding finding';
            } else {
                banner.hidden = true;
                $('[data-action="save"]').textContent = 'Save finding';
            }
        }

        function renderDeeds() {
            const wrap = $('.xr-integrity__deeds');
            const options = eligibleDeeds();
            if (!state.word) { wrap.innerHTML = '<div class="xr-integrity__hint">Pick the word first.</div>'; return; }
            if (options.length === 0) {
                wrap.innerHTML = '<div class="xr-integrity__hint">No enacted action-facts share an entity with this word — '
                    + 'capture the deed as a claim about the same entity, adjudicate it as an enacted fact, then return.</div>';
                return;
            }
            wrap.innerHTML = options.map((d) => `
                <label class="xr-integrity__deed">
                  <input type="checkbox" data-prop="${escapeHtml(d.proposition.id)}"
                         ${state.deedIds.has(d.proposition.id) ? 'checked' : ''} />
                  <span>${escapeHtml(truncate(d.text, 110))}</span>
                  <span class="xr-integrity__mono">${d.proposition.occurred_at
                    ? new Date(d.proposition.occurred_at * 1000).toISOString().slice(0, 10) : 'undated'}</span>
                </label>`).join('');
            wrap.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
                cb.addEventListener('change', () => {
                    if (cb.checked) state.deedIds.add(cb.dataset.prop);
                    else state.deedIds.delete(cb.dataset.prop);
                    syncAfterSelection();
                });
            });
        }

        function renderMatches() {
            const wrap = $('.xr-integrity__matches');
            if (!state.word) { wrap.innerHTML = ''; return; }
            const cls = state.word.proposition.proposition_class;
            wrap.innerHTML = matchStatesForWordClass(cls).map((m) => `
                <button type="button" class="xr-integrity__match-btn" data-match="${m}">
                  ${escapeHtml(INTEGRITY_MATCH_LABELS[m] || m)}
                </button>`).join('');
            wrap.querySelectorAll('.xr-integrity__match-btn').forEach((b) => {
                b.addEventListener('click', () => {
                    wrap.querySelectorAll('.xr-integrity__match-btn').forEach((x) =>
                        x.classList.remove('xr-integrity__match-btn--active'));
                    b.classList.add('xr-integrity__match-btn--active');
                    state.match = b.dataset.match;
                    $('.xr-integrity__gap').hidden = !GAP_MATCH_STATES.includes(state.match);
                });
            });
            $('.xr-integrity__standard').value = defaultStandardOfProof(cls);
        }

        $('.xr-integrity__word').addEventListener('change', (ev) => {
            const idx = Number(ev.target.value);
            state.word = Number.isInteger(idx) && words[idx] ? words[idx] : null;
            state.deedIds.clear();
            state.match = null;
            $('.xr-integrity__gap').hidden = true;
            const about = state.word
                ? state.word.about.map((id) => entityNames[id] || id).join(', ')
                : '';
            $('.xr-integrity__word-about').textContent = about ? `about: ${about}` : '';
            renderDeeds();
            renderMatches();
            syncAfterSelection();
        });

        // ---- gap: constraint picker fills from deed-eligible props --
        const gapCause = $('.xr-integrity__gap-cause');
        gapCause.addEventListener('change', () => {
            $('.xr-integrity__gap-constraint-row').hidden = gapCause.value !== 'constraint';
        });
        const constraintSel = $('.xr-integrity__gap-constraint');
        constraintSel.innerHTML = '<option value="">— pick the corroborated action-fact —</option>'
            + deeds.map((d) => `<option value="${escapeHtml(d.proposition.id)}">${escapeHtml(truncate(d.text, 80))}</option>`).join('');

        // ---- evidence rows (the adjudicate-modal pattern) ------------
        function renderEvidence() {
            for (const side of ['For', 'Against']) {
                const list = state[`evidence${side}`];
                const wrap = $(`.xr-integrity__ev-${side.toLowerCase()}`);
                wrap.innerHTML = list.map((e, i) => `
                  <div class="xr-integrity__ev-row" data-i="${i}">
                    <input type="text" class="xr-integrity__ev-quote" placeholder="verbatim quote" value="${escapeHtml(e.quote)}" />
                    <select class="xr-integrity__ev-tier">
                      <option value="">tier —</option>
                      ${EVIDENCE_TIERS.map((t) => `<option value="${t}" ${e.tier === t ? 'selected' : ''}>${escapeHtml(EVIDENCE_TIER_LABELS[t])}</option>`).join('')}
                    </select>
                    <button type="button" class="xr-integrity__ev-del">✕</button>
                  </div>`).join('');
                wrap.querySelectorAll('.xr-integrity__ev-row').forEach((row) => {
                    const i = Number(row.dataset.i);
                    row.querySelector('.xr-integrity__ev-quote').addEventListener('input', (ev) => { list[i].quote = ev.target.value; });
                    row.querySelector('.xr-integrity__ev-tier').addEventListener('change', (ev) => { list[i].tier = ev.target.value || null; });
                    row.querySelector('.xr-integrity__ev-del').addEventListener('click', () => { list.splice(i, 1); renderEvidence(); });
                });
            }
        }
        $('[data-action="add-for"]').addEventListener('click', () => { state.evidenceFor.push({ quote: '', tier: null }); renderEvidence(); });
        $('[data-action="add-against"]').addEventListener('click', () => { state.evidenceAgainst.push({ quote: '', tier: null }); renderEvidence(); });

        // ---- footer ---------------------------------------------------
        $('[data-action="cancel"]').addEventListener('click', () => close(null));
        $('.xr-integrity__close').addEventListener('click', () => close(null));
        $('.xr-integrity__backdrop').addEventListener('click', () => close(null));

        $('[data-action="save"]').addEventListener('click', async () => {
            if (!state.word) { showError('Pick the word — a stated commitment or value.'); return; }
            if (state.deedIds.size === 0) { showError('Pick at least one enacted action-fact.'); return; }
            if (!state.match) { showError('Pick the match — it is a ruling, with the same discipline as a verdict.'); return; }
            try {
                let gap;
                if (GAP_MATCH_STATES.includes(state.match) && gapCause.value) {
                    gap = {
                        cause: gapCause.value,
                        note: $('.xr-integrity__gap-note').value,
                        constraint_ref: gapCause.value === 'constraint' ? constraintSel.value : undefined,
                        revision_ref: $('.xr-integrity__gap-revision').value.trim() || undefined
                    };
                }
                const finding = await IntegrityModel.create({
                    word_proposition_id:  state.word.proposition.id,
                    deed_proposition_ids: [...state.deedIds],
                    match:                state.match,
                    standard_of_proof:    $('.xr-integrity__standard').value,
                    evidence_for:         state.evidenceFor.filter((e) => e.quote.trim()).map((e) => ({ quote: e.quote, tier: e.tier })),
                    evidence_against:     state.evidenceAgainst.filter((e) => e.quote.trim()).map((e) => ({ quote: e.quote, tier: e.tier })),
                    caveats:              String($('.xr-integrity__caveats').value || '').split('\n').map((s) => s.trim()).filter(Boolean),
                    gap,
                    method:               $('.xr-integrity__method').value,
                    exposure:             $('.xr-integrity__exposure').value,
                    rationale:            $('.xr-integrity__rationale').value,
                    supersedes:           state.activeFinding ? state.activeFinding.id : null
                });
                close(finding);
            } catch (err) {
                showError(err.message || String(err));
            }
        });

        document.addEventListener('keydown', onKey);
        renderDeeds();
    });
}

function buildHtml(words) {
    const wordOptions = words.length
        ? '<option value="">— pick a stated commitment / value —</option>'
            + words.map((w, i) => `<option value="${i}">[${w.proposition.proposition_class}] ${escapeHtml(truncate(w.text, 90))}</option>`).join('')
        : '<option value="">No word-eligible propositions yet — adjudicate a claim as stated-commitment/stated-value with role “stated” first</option>';

    const standardOpts = STANDARDS_OF_PROOF.map((s) =>
        `<option value="${s}">${escapeHtml(STANDARD_OF_PROOF_LABELS[s])}</option>`).join('');
    const causeOpts = '<option value="">— none recorded —</option>'
        + GAP_CAUSES.map((c) => `<option value="${c}">${escapeHtml(GAP_CAUSE_LABELS[c])}</option>`).join('');

    return `
      <div class="xr-integrity__backdrop"></div>
      <div class="xr-integrity__card">
        <header class="xr-integrity__head">
          <h2 class="xr-integrity__title">Integrity finding — words vs deeds</h2>
          <button type="button" class="xr-integrity__close" aria-label="Cancel">✕</button>
        </header>
        <div class="xr-integrity__body">
          <div class="xr-integrity__err" hidden></div>

          <label class="xr-integrity__field">
            <span class="xr-integrity__label">The word <em>(their stated commitment or value — ascribed/unclassified never qualify)</em></span>
            <select class="xr-integrity__word">${wordOptions}</select>
            <span class="xr-integrity__word-about xr-integrity__mono"></span>
          </label>

          <div class="xr-integrity__field">
            <span class="xr-integrity__label">The deeds <em>(enacted action-facts about the same entity)</em></span>
            <div class="xr-integrity__deeds"></div>
          </div>

          <div class="xr-integrity__chain" hidden></div>

          <div class="xr-integrity__field">
            <span class="xr-integrity__label">Match <em>(a ruling on the observable gap — never on the value itself)</em></span>
            <div class="xr-integrity__matches"></div>
          </div>

          <label class="xr-integrity__field">
            <span class="xr-integrity__label">Standard of proof</span>
            <select class="xr-integrity__standard">${standardOpts}</select>
          </label>

          <div class="xr-integrity__field">
            <span class="xr-integrity__label">Evidence for
              <button type="button" class="xr-integrity__ev-add" data-action="add-for">+ add</button></span>
            <div class="xr-integrity__ev-for"></div>
          </div>
          <div class="xr-integrity__field">
            <span class="xr-integrity__label">Evidence against
              <button type="button" class="xr-integrity__ev-add" data-action="add-against">+ add</button></span>
            <div class="xr-integrity__ev-against"></div>
          </div>

          <label class="xr-integrity__field">
            <span class="xr-integrity__label">Caveats <em>(REQUIRED — one per line)</em></span>
            <textarea class="xr-integrity__caveats" rows="2"
                      placeholder="e.g. single vote against a multi-year pledge — pattern needs more instances"></textarea>
          </label>

          <div class="xr-integrity__gap" hidden>
            <span class="xr-integrity__label">Gap decomposition <em>(optional — DOCUMENTED only; intent is never inferred)</em></span>
            <select class="xr-integrity__gap-cause">${causeOpts}</select>
            <input type="text" class="xr-integrity__gap-note" placeholder="the documented explanation (required with a cause)" />
            <div class="xr-integrity__gap-constraint-row" hidden>
              <select class="xr-integrity__gap-constraint"></select>
              <span class="xr-integrity__hint">constraint = evidence that DISCOUNTS the finding; it must be a corroborated action-fact</span>
            </div>
            <input type="text" class="xr-integrity__gap-revision" placeholder="revision ref (optional — a 30055 coordinate or link id; disclosed revision is credit)" />
          </div>

          <label class="xr-integrity__field">
            <span class="xr-integrity__label">Method <em>(optional)</em></span>
            <input type="text" class="xr-integrity__method" />
          </label>
          <label class="xr-integrity__field">
            <span class="xr-integrity__label">Disclosure <em>(optional — your relevant interests; published with the finding)</em></span>
            <input type="text" class="xr-integrity__exposure" />
          </label>
          <label class="xr-integrity__field">
            <span class="xr-integrity__label">Rationale <em>(optional, markdown)</em></span>
            <textarea class="xr-integrity__rationale" rows="2"></textarea>
          </label>
        </div>
        <footer class="xr-integrity__foot">
          <span class="xr-integrity__foot-gap"></span>
          <button type="button" class="xr-integrity__btn xr-integrity__btn--ghost" data-action="cancel">Cancel</button>
          <button type="button" class="xr-integrity__btn xr-integrity__btn--primary" data-action="save">Save finding</button>
        </footer>
      </div>`;
}

function truncate(s, n) {
    const str = String(s || '');
    return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

let stylesInjected = false;
function ensureStyles() {
    if (stylesInjected || typeof document === 'undefined') return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.id = 'xr-integrity-styles';
    style.textContent = `
.xr-integrity { position: fixed; inset: 0; z-index: 10010; }
.xr-integrity__backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.55); }
.xr-integrity__card {
  position: relative; margin: 4vh auto 0; width: min(640px, calc(100vw - 32px));
  max-height: 90vh; display: flex; flex-direction: column;
  background: var(--xr-surface, #242424); color: var(--xr-text, #e6e6e6);
  border: 1px solid var(--xr-border, #333); border-radius: 10px;
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.xr-integrity__head, .xr-integrity__foot { display: flex; align-items: center; gap: 8px; padding: 12px 16px; }
.xr-integrity__head { border-bottom: 1px solid var(--xr-border, #333); }
.xr-integrity__foot { border-top: 1px solid var(--xr-border, #333); }
.xr-integrity__foot-gap { flex: 1; }
.xr-integrity__title { margin: 0; font-size: 15px; flex: 1; }
.xr-integrity__close { background: none; border: none; color: inherit; cursor: pointer; font-size: 14px; }
.xr-integrity__body { padding: 12px 16px; overflow-y: auto; }
.xr-integrity__err {
  background: color-mix(in srgb, var(--xr-danger, #f87171) 18%, transparent);
  border: 1px solid var(--xr-danger, #f87171); border-radius: 6px;
  padding: 6px 10px; margin-bottom: 10px; font-size: 12.5px;
}
.xr-integrity__field { display: block; margin-bottom: 12px; }
.xr-integrity__label { display: block; font-size: 11px; text-transform: uppercase;
  letter-spacing: .04em; color: var(--xr-text-dim, #9a9a9a); margin-bottom: 6px; }
.xr-integrity__label em { text-transform: none; letter-spacing: 0; }
.xr-integrity__word, .xr-integrity__standard, .xr-integrity__gap-cause, .xr-integrity__gap-constraint {
  width: 100%; box-sizing: border-box; padding: 5px 8px; border-radius: 6px; font-size: 12.5px;
  background: var(--xr-surface-2, #2e2e2e); color: inherit; border: 1px solid var(--xr-border, #333);
}
.xr-integrity__word-about { display: block; margin-top: 4px; }
.xr-integrity__mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px; color: var(--xr-text-dim, #9a9a9a); }
.xr-integrity__deeds { display: flex; flex-direction: column; gap: 4px; }
.xr-integrity__deed { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
.xr-integrity__hint { font-size: 12px; color: var(--xr-text-dim, #9a9a9a); }
.xr-integrity__chain {
  border: 1px solid var(--xr-primary, #8b5cf6); border-radius: 8px;
  padding: 8px 12px; font-size: 12.5px; margin-bottom: 12px;
}
.xr-integrity__matches { display: flex; gap: 6px; flex-wrap: wrap; }
.xr-integrity__match-btn {
  padding: 4px 10px; border-radius: 999px; font-size: 12px; cursor: pointer;
  background: var(--xr-surface-2, #2e2e2e); color: inherit; border: 1px solid var(--xr-border, #333);
}
.xr-integrity__match-btn--active {
  border-color: var(--xr-primary, #8b5cf6);
  background: color-mix(in srgb, var(--xr-primary, #8b5cf6) 22%, transparent);
}
.xr-integrity__ev-add { margin-left: 8px; padding: 1px 8px; border-radius: 999px; font-size: 11px;
  cursor: pointer; background: var(--xr-surface-2, #2e2e2e); color: inherit; border: 1px solid var(--xr-border, #333); }
.xr-integrity__ev-row { display: flex; gap: 6px; margin-bottom: 4px; }
.xr-integrity__ev-quote { flex: 1; padding: 4px 8px; border-radius: 6px; font-size: 12px;
  background: var(--xr-surface-2, #2e2e2e); color: inherit; border: 1px solid var(--xr-border, #333); }
.xr-integrity__ev-tier, .xr-integrity__ev-del { padding: 3px 6px; border-radius: 6px; font-size: 11.5px;
  background: var(--xr-surface-2, #2e2e2e); color: inherit; border: 1px solid var(--xr-border, #333); cursor: pointer; }
.xr-integrity__caveats, .xr-integrity__rationale, .xr-integrity__gap-note,
.xr-integrity__gap-revision, .xr-integrity__method, .xr-integrity__exposure {
  width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 6px;
  font: 13px/1.4 inherit; background: var(--xr-surface-2, #2e2e2e); color: inherit;
  border: 1px solid var(--xr-border, #333); resize: vertical; margin-bottom: 6px;
}
.xr-integrity__gap { border: 1px dashed var(--xr-border, #333); border-radius: 8px;
  padding: 10px 12px; margin-bottom: 12px; }
.xr-integrity__gap-constraint-row { margin: 6px 0; }
.xr-integrity__btn { padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px;
  border: 1px solid var(--xr-border, #333); background: var(--xr-surface-2, #2e2e2e); color: inherit; }
.xr-integrity__btn--primary { background: var(--xr-primary, #8b5cf6); border-color: var(--xr-primary, #8b5cf6); color: #fff; }
`;
    document.head.appendChild(style);
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

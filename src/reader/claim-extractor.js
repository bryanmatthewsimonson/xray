// Reader-side claim extractor — Phase 5 C2 (issue #16).
//
// The entity tagger popover (entity-tagger.js) now includes an
// "📋 Add as claim" row. Clicking it hands off to this module's
// `openClaimModal()`, which opens a bigger form for the structured
// claim fields: type, crux + confidence, subject/predicate/object
// triple, attribution, claimant, quote-date.
//
// Save → `ClaimModel.create()` persists the record and returns it.
// The reader then re-renders its claims bar (below the article body)
// and wraps the selection in a `<span class="xr-claim xr-claim--<type>">`
// so the passage is visibly linked to a claim.
//
// Edit flow: clicking an existing claim's ✎ in the claims bar opens
// the same modal seeded with the current values — actually calls
// `ClaimModel.update()` on save.
//
// Unlike the entity model, we DO NOT track claim refs on
// `state.article.claims`. Claims are keyed in storage by their
// `source_url`, and `ClaimModel.getBySourceUrl(article.url)` is the
// single source of truth at render and publish time.

import {
    ClaimModel,
    CLAIM_TYPE_ICONS
} from '../shared/claim-model.js';
import {
    EvidenceLinker,
    EVIDENCE_RELATIONSHIPS,
    EVIDENCE_RELATIONSHIP_LABELS,
    EVIDENCE_RELATIONSHIP_ICONS
} from '../shared/evidence-linker.js';
import { EntityModel, ENTITY_ICONS } from '../shared/entity-model.js';
import { resolveSelectors } from '../shared/metadata/anchor-resolver.js';
import { openAssessModal, renderAssessmentBadges, assessmentsByCanonicalRef } from '../shared/assess-modal.js';
import { makeClaimRefCanonicalizer } from '../shared/claim-ref.js';

// ------------------------------------------------------------------
// Modal — used for create AND edit
// ------------------------------------------------------------------

/**
 * Open the claim form modal. Returns a promise that resolves with
 * the saved claim on success, or null on cancel.
 *
 * @param {{
 *   sourceUrl:    string,
 *   initialText?: string,
 *   initialClaim?: object,   // pass to pre-populate for edit mode
 *   context?:     string     // surrounding-paragraph text for the `context` field
 * }} opts
 */
export function openClaimModal(opts) {
    return new Promise((resolve) => {
        const { sourceUrl, initialText = '', initialClaim = null, context = '', anchor = null,
                initialAbout = [] } = opts;

        const isEdit = !!initialClaim;
        const initial = initialClaim || {
            text:    initialText,
            about:   initialAbout,    // sticky session default (Phase 11.3)
            source:  null,
            is_key:  false,
            context
        };

        const modal = document.createElement('div');
        modal.className = 'xr-claim-modal';
        modal.innerHTML = buildModalHtml(initial, isEdit);
        document.body.appendChild(modal);

        wireModal(modal, initial, isEdit, async (saved) => {
            if (!saved) { closeModal(); resolve(null); return; }
            try {
                const result = isEdit
                    ? await ClaimModel.update(initialClaim.id, saved)
                    : await ClaimModel.create({ ...saved, source_url: sourceUrl, anchor });
                closeModal();
                resolve(result);
            } catch (err) {
                showModalError(modal, err.message || String(err));
            }
        });

        function closeModal() { if (modal.parentNode) modal.parentNode.removeChild(modal); }
    });
}

function buildModalHtml(initial, isEdit) {
    const title = isEdit ? 'Edit claim' : 'Add claim';
    // `source` is an entity id, free text, or null (= the article).
    const sourceIsEntity = typeof initial.source === 'string' && /^entity_/.test(initial.source);
    const sourceText = (initial.source && !sourceIsEntity) ? initial.source : '';

    return `
      <div class="xr-claim-modal__backdrop"></div>
      <div class="xr-claim-modal__card">
        <header class="xr-claim-modal__head">
          <h2 class="xr-claim-modal__title">${escapeHtml(title)}</h2>
          <button type="button" class="xr-claim-modal__close" aria-label="Cancel">✕</button>
        </header>

        <div class="xr-claim-modal__body">
          <div class="xr-claim-modal__err" hidden></div>

          <label class="xr-claim-modal__field">
            <span class="xr-claim-modal__label">Claim text</span>
            <textarea class="xr-claim-modal__text" rows="3"
              ${isEdit ? 'readonly' : ''}
              placeholder="The exact wording of the claim">${escapeHtml(initial.text || '')}</textarea>
            ${isEdit ? '<small class="xr-claim-modal__hint">Text is immutable after creation. Delete + recreate to change it.</small>' : ''}
          </label>

          ${buildAboutPicker(initial.about)}

          ${buildEntityOrTextPicker('source', 'Who said it (optional — defaults to the article)',
                                    sourceIsEntity ? [initial.source] : [], sourceText)}

          <div class="xr-claim-modal__field xr-claim-modal__field--inline">
            <label class="xr-claim-modal__checkbox">
              <input type="checkbox" class="xr-claim-modal__key" ${initial.is_key ? 'checked' : ''} />
              <span>⭐ Key claim — central to the piece</span>
            </label>
          </div>
        </div>

        <footer class="xr-claim-modal__foot">
          <button type="button" class="xr-claim-modal__btn xr-claim-modal__btn--ghost" data-action="cancel">Cancel</button>
          <button type="button" class="xr-claim-modal__btn xr-claim-modal__btn--primary" data-action="save">${isEdit ? 'Save changes' : 'Save claim'}</button>
        </footer>
      </div>
    `;
}

/**
 * "About" picker — a multi-select of the entities this claim concerns.
 * Entity-only (the queryable core); if an entity isn't tagged yet the
 * search shows a hint to tag it from the article body first.
 */
function buildAboutPicker(entityIds) {
    return `
      <div class="xr-claim-modal__field xr-claim-modal__picker" data-prefix="about">
        <span class="xr-claim-modal__label">About <em>(the people / orgs / things this claim concerns)</em></span>
        <div class="xr-claim-modal__picker-entity">
          <div class="xr-claim-modal__picked" data-role="picked">
            ${(entityIds || []).map((id) => `<span class="xr-claim-modal__pill" data-id="${escapeHtml(id)}">Loading…<button type="button" class="xr-claim-modal__pill-x">×</button></span>`).join('')}
          </div>
          <input type="text" class="xr-claim-modal__picker-search" data-role="search"
                 placeholder="Search entities by name…" spellcheck="false" />
          <div class="xr-claim-modal__picker-results" data-role="results" hidden></div>
        </div>
      </div>
    `;
}

/**
 * Subject / Object field: radio between "Pick entity" and "Free text"
 * — structured when possible, prose when not. Internally we render
 * the entity picker as a search input with a dropdown of matches.
 */
function buildEntityOrTextPicker(prefix, label, entityIds, textValue) {
    const isEntityMode = Array.isArray(entityIds) && entityIds.length > 0;
    return `
      <div class="xr-claim-modal__field xr-claim-modal__picker" data-prefix="${prefix}">
        <span class="xr-claim-modal__label">${escapeHtml(label)}</span>
        <div class="xr-claim-modal__picker-mode">
          <label class="xr-claim-modal__radio">
            <input type="radio" name="${prefix}-mode" value="entity" ${isEntityMode ? 'checked' : ''} />
            <span>Entity</span>
          </label>
          <label class="xr-claim-modal__radio">
            <input type="radio" name="${prefix}-mode" value="text" ${isEntityMode ? '' : 'checked'} />
            <span>Free text</span>
          </label>
        </div>
        <div class="xr-claim-modal__picker-entity" ${isEntityMode ? '' : 'hidden'}>
          <div class="xr-claim-modal__picked" data-role="picked">
            ${(entityIds || []).map((id) => `<span class="xr-claim-modal__pill" data-id="${escapeHtml(id)}">Loading…<button type="button" class="xr-claim-modal__pill-x">×</button></span>`).join('')}
          </div>
          <input type="text" class="xr-claim-modal__picker-search" data-role="search"
                 placeholder="Search entities by name…" spellcheck="false" />
          <div class="xr-claim-modal__picker-results" data-role="results" hidden></div>
        </div>
        <input type="text" class="xr-claim-modal__picker-text" ${isEntityMode ? 'hidden' : ''}
               placeholder="Free-text ${escapeHtml(label.toLowerCase())}"
               value="${escapeHtml(textValue || '')}" />
      </div>
    `;
}

// ------------------------------------------------------------------
// Modal wiring
// ------------------------------------------------------------------

function wireModal(modal, initial, isEdit, onSubmit) {
    const $ = (sel) => modal.querySelector(sel);

    // Close / cancel
    const close = () => onSubmit(null);
    $('.xr-claim-modal__close').addEventListener('click', close);
    $('.xr-claim-modal__backdrop').addEventListener('click', close);
    modal.querySelector('[data-action="cancel"]').addEventListener('click', close);
    document.addEventListener('keydown', escHandler);
    function escHandler(ev) { if (ev.key === 'Escape') { document.removeEventListener('keydown', escHandler); close(); } }

    const keyCb = $('.xr-claim-modal__key');

    // Pickers: `about` is a multi-select of entities (no text mode);
    // `source` is single, entity-or-text ("who said it").
    const sourceIsEntity = typeof initial.source === 'string' && /^entity_/.test(initial.source);
    const pickerState = {
        about:  { mode: 'entity', ids: (initial.about || []).slice(), text: '' },
        source: {
            mode: sourceIsEntity ? 'entity' : 'text',
            ids:  sourceIsEntity ? [initial.source] : [],
            text: (initial.source && !sourceIsEntity) ? initial.source : ''
        }
    };

    modal.querySelectorAll('.xr-claim-modal__picker').forEach((picker) => {
        const prefix = picker.dataset.prefix;
        // `source` is single-select; `about` is multi.
        wirePicker(picker, pickerState[prefix], prefix, prefix === 'source');
    });

    // Hydrate entity pills async so the user sees real names instead of "Loading…".
    hydratePills(modal).catch((err) => console.warn('[X-Ray Claim] pill hydrate failed:', err));

    // Save
    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
        const text = $('.xr-claim-modal__text').value.trim();
        if (!text) { showModalError(modal, 'Claim text is required'); return; }

        // `source`: an entity id (entity mode), free text (text mode), or
        // null (= the article).
        let source = null;
        if (pickerState.source.mode === 'entity' && pickerState.source.ids[0]) {
            source = pickerState.source.ids[0];
        } else if (pickerState.source.mode === 'text' && pickerState.source.text.trim()) {
            source = pickerState.source.text.trim();
        }

        const record = {
            text,
            about:   pickerState.about.ids.slice(),
            source,
            is_key:  keyCb.checked,
            context: initial.context || ''
        };

        document.removeEventListener('keydown', escHandler);
        onSubmit(record);
    });
}

function wirePicker(pickerEl, state, prefix, isSingle) {
    const modeRadios = pickerEl.querySelectorAll(`input[name="${prefix}-mode"]`);
    const entityWrap = pickerEl.querySelector('.xr-claim-modal__picker-entity');
    const textInput  = pickerEl.querySelector('.xr-claim-modal__picker-text');
    const search     = pickerEl.querySelector('[data-role="search"]');
    const picked     = pickerEl.querySelector('[data-role="picked"]');
    const results    = pickerEl.querySelector('[data-role="results"]');

    if (modeRadios.length > 0) {
        modeRadios.forEach((r) => {
            r.addEventListener('change', () => {
                state.mode = r.value;
                if (entityWrap) entityWrap.hidden = state.mode !== 'entity';
                if (textInput)  textInput.hidden  = state.mode !== 'text';
            });
        });
    }

    if (textInput) {
        textInput.addEventListener('input', () => { state.text = textInput.value; });
    }

    // Entity search + pick
    search.addEventListener('input', async () => {
        const q = search.value.trim();
        if (!q) { results.hidden = true; results.innerHTML = ''; return; }
        const matches = await EntityModel.search(q, { limit: 6 });
        if (matches.length === 0) {
            results.innerHTML = `<div class="xr-claim-modal__picker-empty">No match — tag an entity from the article body first.</div>`;
            results.hidden = false;
            return;
        }
        results.innerHTML = matches.map((e) => `
          <button type="button" class="xr-claim-modal__picker-match" data-id="${escapeHtml(e.id)}">
            <span>${ENTITY_ICONS[e.type] || '🔷'}</span>
            <span>${escapeHtml(e.name)}</span>
          </button>
        `).join('');
        results.hidden = false;

        results.querySelectorAll('.xr-claim-modal__picker-match').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                if (isSingle) state.ids = [id];
                else if (!state.ids.includes(id)) state.ids.push(id);
                await rerenderPicked(picked, state.ids);
                search.value = '';
                results.hidden = true;
                results.innerHTML = '';
            });
        });
    });

    // Remove-pill delegation
    picked.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('.xr-claim-modal__pill-x');
        if (!btn) return;
        const pill = btn.closest('.xr-claim-modal__pill');
        const id = pill && pill.dataset.id;
        state.ids = state.ids.filter((x) => x !== id);
        await rerenderPicked(picked, state.ids);
    });
}

async function rerenderPicked(container, ids) {
    if (!ids || ids.length === 0) { container.innerHTML = ''; return; }
    const rows = await Promise.all(ids.map(async (id) => {
        const e = await EntityModel.get(id);
        const label = e ? `${ENTITY_ICONS[e.type] || '🔷'} ${e.name}` : `⚠️ missing (${id.slice(0, 12)}…)`;
        return `<span class="xr-claim-modal__pill" data-id="${escapeHtml(id)}">${escapeHtml(label)}<button type="button" class="xr-claim-modal__pill-x">×</button></span>`;
    }));
    container.innerHTML = rows.join('');
}

async function hydratePills(modal) {
    const pills = modal.querySelectorAll('.xr-claim-modal__pill[data-id]');
    for (const pill of pills) {
        const id = pill.dataset.id;
        const e = await EntityModel.get(id);
        const label = e ? `${ENTITY_ICONS[e.type] || '🔷'} ${e.name}` : `⚠️ missing`;
        pill.innerHTML = `${escapeHtml(label)}<button type="button" class="xr-claim-modal__pill-x">×</button>`;
    }
}

function showModalError(modal, msg) {
    const el = modal.querySelector('.xr-claim-modal__err');
    el.textContent = msg;
    el.hidden = false;
}

// ------------------------------------------------------------------
// Evidence-link modal
// ------------------------------------------------------------------

/**
 * Open the evidence-link modal. User picks a target claim (restricted
 * to the candidate list we pass in — typically all other claims on
 * this article), picks a relationship, optionally adds a note, saves.
 *
 * Returns the saved link on success, null on cancel.
 *
 * @param {{
 *   sourceClaim: object,
 *   candidates:  object[]   // every other claim on this article
 * }} opts
 */
export function openEvidenceLinkModal({ sourceClaim, candidates }) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'xr-claim-modal';
        modal.innerHTML = buildLinkModalHtml(sourceClaim, candidates);
        document.body.appendChild(modal);

        const $ = (sel) => modal.querySelector(sel);
        const close = () => {
            document.removeEventListener('keydown', escHandler);
            if (modal.parentNode) modal.parentNode.removeChild(modal);
            resolve(null);
        };
        function escHandler(ev) { if (ev.key === 'Escape') close(); }
        document.addEventListener('keydown', escHandler);
        $('.xr-claim-modal__close').addEventListener('click', close);
        $('.xr-claim-modal__backdrop').addEventListener('click', close);
        modal.querySelector('[data-action="cancel"]').addEventListener('click', close);

        // Pick target
        let targetId = null;
        modal.querySelectorAll('.xr-link-modal__target').forEach((btn) => {
            btn.addEventListener('click', () => {
                modal.querySelectorAll('.xr-link-modal__target').forEach((b) =>
                    b.classList.remove('xr-link-modal__target--active'));
                btn.classList.add('xr-link-modal__target--active');
                targetId = btn.dataset.id;
                // Auto-scroll so the user sees the relationship picker below.
                const relRow = $('.xr-link-modal__rel-row');
                if (relRow) relRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
            });
        });

        // Pick relationship
        let rel = 'supports';
        modal.querySelectorAll('.xr-link-modal__rel-btn').forEach((btn) => {
            if (btn.dataset.rel === rel) btn.classList.add('xr-link-modal__rel-btn--active');
            btn.addEventListener('click', () => {
                modal.querySelectorAll('.xr-link-modal__rel-btn').forEach((b) =>
                    b.classList.remove('xr-link-modal__rel-btn--active'));
                btn.classList.add('xr-link-modal__rel-btn--active');
                rel = btn.dataset.rel;
            });
        });

        modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
            if (!targetId) {
                showModalError(modal, 'Pick a target claim first.');
                return;
            }
            try {
                const link = await EvidenceLinker.create({
                    source_claim_id: sourceClaim.id,
                    target_claim_id: targetId,
                    relationship:    rel,
                    note:            $('.xr-link-modal__note').value.trim()
                });
                document.removeEventListener('keydown', escHandler);
                if (modal.parentNode) modal.parentNode.removeChild(modal);
                resolve(link);
            } catch (err) {
                showModalError(modal, err.message || String(err));
            }
        });
    });
}

function buildLinkModalHtml(sourceClaim, candidates) {
    const srcType = CLAIM_TYPE_ICONS[sourceClaim.type] || '📋';

    const candidateHtml = candidates.length === 0
        ? `<div class="xr-claim-modal__picker-empty">No other claims on this article. Add a second claim first, then come back to link them.</div>`
        : candidates.map((c) => `
            <button type="button" class="xr-link-modal__target" data-id="${escapeHtml(c.id)}">
              <span class="xr-link-modal__target-type">${CLAIM_TYPE_ICONS[c.type] || '📋'}</span>
              <span class="xr-link-modal__target-text">${escapeHtml(c.text)}</span>
            </button>`).join('');

    const relHtml = EVIDENCE_RELATIONSHIPS.map((r) => `
      <button type="button" class="xr-link-modal__rel-btn" data-rel="${r}">
        ${EVIDENCE_RELATIONSHIP_ICONS[r]} ${escapeHtml(EVIDENCE_RELATIONSHIP_LABELS[r])}
      </button>
    `).join('');

    return `
      <div class="xr-claim-modal__backdrop"></div>
      <div class="xr-claim-modal__card xr-link-modal__card">
        <header class="xr-claim-modal__head">
          <h2 class="xr-claim-modal__title">Link evidence</h2>
          <button type="button" class="xr-claim-modal__close" aria-label="Cancel">✕</button>
        </header>

        <div class="xr-claim-modal__body">
          <div class="xr-claim-modal__err" hidden></div>

          <div class="xr-claim-modal__field">
            <span class="xr-claim-modal__label">From this claim</span>
            <div class="xr-link-modal__source">
              <span class="xr-link-modal__target-type">${srcType}</span>
              <span class="xr-link-modal__target-text">${escapeHtml(sourceClaim.text)}</span>
            </div>
          </div>

          <div class="xr-claim-modal__field">
            <span class="xr-claim-modal__label">To target claim <em>(on this article)</em></span>
            <div class="xr-link-modal__target-list">${candidateHtml}</div>
          </div>

          <div class="xr-claim-modal__field xr-link-modal__rel-row">
            <span class="xr-claim-modal__label">Relationship</span>
            <div class="xr-link-modal__rels">${relHtml}</div>
          </div>

          <label class="xr-claim-modal__field">
            <span class="xr-claim-modal__label">Note <em>(optional — stored with the link)</em></span>
            <textarea class="xr-link-modal__note" rows="2"
                      placeholder="Why does this link hold?"></textarea>
          </label>
        </div>

        <footer class="xr-claim-modal__foot">
          <button type="button" class="xr-claim-modal__btn xr-claim-modal__btn--ghost" data-action="cancel">Cancel</button>
          <button type="button" class="xr-claim-modal__btn xr-claim-modal__btn--primary" data-action="save">Save link</button>
        </footer>
      </div>
    `;
}

// ------------------------------------------------------------------
// Claims bar — below the article body
// ------------------------------------------------------------------

/**
 * Render the list of claims attached to the current article. Returns
 * the HTML string for an outer element that the reader replaces
 * wholesale on re-render.
 */
export async function renderClaimsBar(claims) {
    if (!claims || claims.length === 0) {
        return `
          <section class="xr-claims" id="xr-claims">
            <header class="xr-claims__head">
              <h2 class="xr-claims__title">Claims</h2>
            </header>
            <div class="xr-claims__empty">No claims on this article yet. Select text in the body and pick “Add as claim”.</div>
          </section>`;
    }

    // Resolve entity display for each claim's `about` set + its `source`
    // plus its evidence links in parallel so the bar renders quickly
    // for typical ~dozen-claim cases. Assessments come as one
    // canonical-keyed map for the whole bar (Phase 11.3).
    const assessMap = await assessmentsByCanonicalRef();
    const rows = await Promise.all(claims.map(async (c) => {
        const [about, source, links] = await Promise.all([
            describeParty(c.about, ''),
            describeSource(c.source),
            EvidenceLinker.getForClaim(c.id)
        ]);
        const assessment = assessMap.get(c.id) || null;
        const key = c.is_key
            ? `<span class="xr-claims__crux" title="Key claim — central to the piece">⭐ key</span>`
            : '';
        const aboutLine = about
            ? `<div class="xr-claims__triple">About <em>${escapeHtml(about)}</em></div>`
            : '';
        const sourceLine = source
            ? `<div class="xr-claims__claimant">Per <em>${escapeHtml(source)}</em></div>`
            : '';
        const pubDot = c.publishedAt
            ? `<span class="xr-claims__pub" title="Published ${new Date(c.publishedAt * 1000).toLocaleString()}">🌐</span>`
            : '';
        const linksBlock = links.length > 0
            ? `<div class="xr-claims__links">${
                (await Promise.all(links.map(async (l) => {
                    const isOutgoing = l.source_claim_id === c.id;
                    const otherId    = isOutgoing ? l.target_claim_id : l.source_claim_id;
                    const other      = claims.find((x) => x.id === otherId);
                    const otherLabel = other ? escapeHtml(other.text.slice(0, 80)) : escapeHtml(`(claim ${otherId.slice(0, 12)}…)`);
                    const arrow      = isOutgoing ? '→' : '←';
                    const relIcon    = EVIDENCE_RELATIONSHIP_ICONS[l.relationship] || '◇';
                    const relLabel   = EVIDENCE_RELATIONSHIP_LABELS[l.relationship] || l.relationship;
                    const linkPub    = l.publishedAt ? ' 🌐' : '';
                    const noteLine   = l.note ? `<span class="xr-claims__link-note"> — ${escapeHtml(l.note)}</span>` : '';
                    return `<div class="xr-claims__link" data-link-id="${escapeHtml(l.id)}">
                              <span class="xr-claims__link-rel">${relIcon} ${escapeHtml(relLabel)}${linkPub}</span>
                              <span class="xr-claims__link-arrow">${arrow}</span>
                              <span class="xr-claims__link-other">${otherLabel}</span>
                              ${noteLine}
                              <button type="button" class="xr-claims__link-del" data-link-id="${escapeHtml(l.id)}" title="Remove this link">✕</button>
                            </div>`;
                }))).join('')
              }</div>`
            : '';
        return `
          <article class="xr-claims__item ${c.is_key ? 'xr-claims__item--crux' : ''}" data-id="${escapeHtml(c.id)}">
            <div class="xr-claims__row-top">
              ${key}
              ${pubDot}
              <div class="xr-claims__row-actions">
                <button type="button" class="xr-claims__btn" data-action="assess" title="${assessment ? 'Edit your assessment' : 'Assess this claim'}">${assessment ? '⚖✓' : '⚖'}</button>
                <button type="button" class="xr-claims__btn" data-action="link" title="Link to another claim">🔗</button>
                <button type="button" class="xr-claims__btn" data-action="edit" title="Edit claim">✎</button>
                <button type="button" class="xr-claims__btn xr-claims__btn--danger" data-action="delete" title="Delete claim">🗑</button>
              </div>
            </div>
            <div class="xr-claims__text">${escapeHtml(c.text)}</div>
            ${renderAssessmentBadges(assessment)}
            ${aboutLine}
            ${sourceLine}
            ${linksBlock}
          </article>`;
    }));

    return `
      <section class="xr-claims" id="xr-claims">
        <header class="xr-claims__head">
          <h2 class="xr-claims__title">Claims <span class="xr-claims__count">${claims.length}</span></h2>
          <button type="button" class="xr-claims__others-btn" id="xr-claims-others"
                  title="Fetch kind-30040 events for this article from the configured relays">
            🌐 Others' claims
          </button>
        </header>
        <div class="xr-claims__list">${rows.join('')}</div>
      </section>`;
}

async function describeParty(entityIds, freetext) {
    if (Array.isArray(entityIds) && entityIds.length > 0) {
        const names = await Promise.all(entityIds.map(describeEntity));
        return names.filter(Boolean).join(', ');
    }
    return freetext || '';
}

async function describeEntity(id) {
    const e = await EntityModel.get(id);
    if (!e) return '(missing entity)';
    return `${ENTITY_ICONS[e.type] || '🔷'} ${e.name}`;
}

// `source` is an entity id, free text, or null (= the article — render
// nothing). Resolves entity ids to their display name.
async function describeSource(source) {
    if (!source) return '';
    if (/^entity_/.test(source)) return await describeEntity(source);
    return String(source);
}

// ------------------------------------------------------------------
// Others' claims — relay query + modal render (Phase 5 C5)
// ------------------------------------------------------------------

/**
 * Render a modal populated by a kind-30040 relay query filtered by
 * the article URL. Two-state UI:
 *
 *   loading  — skeleton with a spinner + "Querying N relays…"
 *   result   — one card per distinct event, grouped by author npub.
 *
 * Kind-30040 events include the full structured tag set produced by
 * `event-builder.buildClaimEvent` — we reuse that tag vocabulary to
 * reconstruct the display (claim-text, claim-type, crux, confidence,
 * attribution, subject, object, predicate, claimant, claim-ref on
 * evidence links).
 *
 * @param {{ url: string, relays: string[] }} opts
 */
export function openOthersClaimsModal({ url, relays }) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'xr-claim-modal';
        modal.innerHTML = `
          <div class="xr-claim-modal__backdrop"></div>
          <div class="xr-claim-modal__card xr-others-modal__card">
            <header class="xr-claim-modal__head">
              <h2 class="xr-claim-modal__title">Others' claims on this article</h2>
              <button type="button" class="xr-claim-modal__close" aria-label="Close">✕</button>
            </header>
            <div class="xr-claim-modal__body">
              <div class="xr-others-modal__url">
                <span class="xr-claim-modal__label">URL</span>
                <code>${escapeHtml(url)}</code>
              </div>
              <div class="xr-others-modal__body" id="xr-others-body">
                <div class="xr-others-modal__loading">
                  <span class="xr-others-modal__spinner"></span>
                  Querying ${relays.length} relay${relays.length === 1 ? '' : 's'}…
                </div>
              </div>
            </div>
            <footer class="xr-claim-modal__foot">
              <button type="button" class="xr-claim-modal__btn xr-claim-modal__btn--ghost" data-action="close">Close</button>
            </footer>
          </div>
        `;
        document.body.appendChild(modal);

        let anyAssessed = false;
        const close = () => {
            document.removeEventListener('keydown', esc);
            if (modal.parentNode) modal.parentNode.removeChild(modal);
            // Tell the caller whether any judgment changed, so the
            // claims bar can refresh its badges (a "foreign" claim can
            // be one of ours seen from the network).
            resolve(anyAssessed ? { assessed: true } : null);
        };
        function esc(ev) { if (ev.key === 'Escape') close(); }
        document.addEventListener('keydown', esc);
        modal.querySelector('.xr-claim-modal__close').addEventListener('click', close);
        modal.querySelector('.xr-claim-modal__backdrop').addEventListener('click', close);
        modal.querySelector('[data-action="close"]').addEventListener('click', close);

        const body = modal.querySelector('#xr-others-body');

        // Render + wire the foreign-claim cards (re-run after each
        // assessment so badges update in place).
        const paint = async (events, byRelay) => {
            body.innerHTML = await renderOthersClaims(events, byRelay);
            body.querySelectorAll('[data-action="assess-foreign"]').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    const ref = lastSeenForeignClaims()[Number(btn.dataset.fidx)];
                    if (!ref) return;
                    const result = await openAssessModal({
                        claimRef: { coord: ref.coord, url: ref.url, text: ref.text, event_id: ref.event_id },
                        claimText: ref.text
                        // no anchorContext: the article DOM isn't this page's
                    });
                    if (result) {
                        anyAssessed = true;
                        await paint(events, byRelay);
                    }
                });
            });
        };

        // Kick off the query via the SW — it owns the relay pool.
        chrome.runtime.sendMessage({
            type: 'xray:relay:query',
            relays,
            filter:    { kinds: [30040], '#r': [url], limit: 200 },
            timeoutMs: 6000
        }, (resp) => {
            if (!resp || !resp.ok) {
                body.innerHTML = `<div class="xr-others-modal__empty xr-others-modal__empty--err">Query failed: ${escapeHtml((resp && resp.error) || 'no response from service worker')}</div>`;
                return;
            }
            paint(resp.events, resp.byRelay).catch((err) => {
                body.innerHTML = `<div class="xr-others-modal__empty xr-others-modal__empty--err">Render failed: ${escapeHtml(err.message || String(err))}</div>`;
            });
        });
    });
}

/**
 * Group kind-30040 events by author pubkey, parse tags into
 * display-ready rows, and render cards. Async since 11.3: fetches the
 * canonical-keyed assessment map so already-judged foreign claims
 * render their badges.
 */
async function renderOthersClaims(events, byRelay) {
    const [assessMap, canon] = await Promise.all([
        assessmentsByCanonicalRef(),
        makeClaimRefCanonicalizer()
    ]);
    foreignClaimRefs = [];
    const relayCount = Object.keys(byRelay || {}).length;
    const eventCount = (events || []).length;

    // Summary strip: how many events came from how many relays.
    const summary = `<div class="xr-others-modal__summary">
      ${eventCount} claim${eventCount === 1 ? '' : 's'} across ${relayCount} relay${relayCount === 1 ? '' : 's'}.
      ${Object.entries(byRelay || {}).map(([url, s]) => {
        const dot = s.received > 0 ? '🟢' : (s.eose ? '⚪' : '🔴');
        return `<span class="xr-others-modal__relay" title="${escapeHtml(url)} — ${s.received} event${s.received === 1 ? '' : 's'}">${dot} ${escapeHtml(url.replace(/^wss?:\/\//, ''))}</span>`;
      }).join('')}
    </div>`;

    if (eventCount === 0) {
        return summary + `<div class="xr-others-modal__empty">No kind-30040 events for this URL on the queried relays — you may be first, or the piece hasn't been tagged yet.</div>`;
    }

    // Group by pubkey so one author's batch of claims renders together.
    const byAuthor = new Map();
    for (const ev of events) {
        if (!byAuthor.has(ev.pubkey)) byAuthor.set(ev.pubkey, []);
        byAuthor.get(ev.pubkey).push(ev);
    }

    const authorCards = [...byAuthor.entries()].map(([pubkey, evs]) => {
        evs.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        const shortNpub = pubkey.slice(0, 12);
        const claims = evs.map((ev) => renderForeignClaim(ev, assessMap, canon)).join('');
        return `
          <section class="xr-others-modal__author">
            <header class="xr-others-modal__author-head">
              <span class="xr-others-modal__author-pub" title="${escapeHtml(pubkey)}">👤 ${escapeHtml(shortNpub)}…</span>
              <span class="xr-others-modal__author-count">${evs.length} claim${evs.length === 1 ? '' : 's'}</span>
            </header>
            ${claims}
          </section>`;
    }).join('');

    return summary + authorCards;
}

// Foreign claims rendered by the most recent others'-claims query, as
// assessable refs: { coord, url, text }. Module state so the assess
// wiring (and 11.4's link-candidate search) can reach them without
// stuffing claim text into data attributes.
let foreignClaimRefs = [];

/** Foreign claims seen in the most recent others'-claims render. */
export function lastSeenForeignClaims() {
    return [...foreignClaimRefs];
}

// Render one foreign (others') kind-30040. Dual-read: understands both the
// thin vocabulary (Phase 10.2 — content=text, `entity …about`, `source`,
// `key`) and the legacy one (`claim-text`, `subject`/`object`, `claimant`,
// `crux`) so claims published before the redesign still display.
// Phase 11.3: each row carries an Assess action + any existing
// assessment's badges (matched by the event's coordinate — which
// collapses to the local id when the claim is actually ours).
function renderForeignClaim(event, assessMap, canon) {
    const tags = event.tags || [];
    const firstOf = (name) => {
        const t = tags.find((x) => x[0] === name);
        return t ? t[1] : '';
    };
    // `entity` name tags carry their role in slot 2 ('about'); fall back to
    // the legacy subject/object tags.
    const entityNames = (role) => tags.filter((x) => x[0] === 'entity' && x[2] === role).map((x) => x[1]);

    // Text: thin events put it in content; legacy used a claim-text tag.
    const text    = firstOf('claim-text') || (event.content || '');
    const isKey   = firstOf('key') === 'true' || firstOf('crux') === 'true';
    const about   = entityNames('about');
    if (about.length === 0) {                       // legacy fallback
        for (const n of [...tagVals(tags, 'subject'), ...tagVals(tags, 'object')]) about.push(n);
    }
    const source  = firstOf('source') || firstOf('claimant');
    const when    = event.created_at ? new Date(event.created_at * 1000).toLocaleDateString() : '';

    const keyLine    = isKey ? `<span class="xr-claims__crux">⭐ key</span>` : '';
    const aboutLine  = about.length ? `<div class="xr-claims__triple">About <em>${escapeHtml(about.join(', '))}</em></div>` : '';
    const sourceLine = source    ? `<div class="xr-claims__claimant">Per <em>${escapeHtml(source)}</em></div>` : '';

    // Assessability needs a coordinate (d + author pubkey) and the
    // url/text snapshots the assessment record stores.
    const dTag = firstOf('d');
    const url = firstOf('r');
    let assessBlock = '';
    let badges = '';
    if (dTag && event.pubkey && text && url) {
        const coord = `30040:${event.pubkey}:${dTag}`;
        const idx = foreignClaimRefs.push({ coord, url, text, event_id: event.id || null }) - 1;
        const existing = assessMap && canon ? assessMap.get(canon(coord)) : null;
        badges = renderAssessmentBadges(existing);
        assessBlock = `<button type="button" class="xr-claims__btn" data-action="assess-foreign" data-fidx="${idx}"
                          title="${existing ? 'Edit your assessment' : 'Assess this claim'}">${existing ? '⚖✓' : '⚖'}</button>`;
    }

    return `
      <article class="xr-claims__item ${isKey ? 'xr-claims__item--crux' : ''}">
        <div class="xr-claims__row-top">
          ${keyLine}
          <span class="xr-others-modal__when">${escapeHtml(when)}</span>
          <div class="xr-claims__row-actions">${assessBlock}</div>
        </div>
        <div class="xr-claims__text">${escapeHtml(text)}</div>
        ${badges}
        ${aboutLine}
        ${sourceLine}
      </article>`;
}

function tagVals(tags, name) {
    return tags.filter((x) => x[0] === name).map((x) => x[1]);
}

// ------------------------------------------------------------------
// Rehydrate visual marks on the article body
// ------------------------------------------------------------------

export function rehydrateClaimMarks(container, claims) {
    if (!container || !Array.isArray(claims) || claims.length === 0) return;
    for (const claim of claims) {
        if (!claim || !claim.text) continue;
        // Prefer the precise text-anchor (prefix/exact/suffix disambiguates
        // which occurrence) captured at claim time. Fall back to the
        // first-occurrence search for claims with no anchor (pre-10.3) or
        // when the anchor can't be resolved (the body was edited).
        if (Array.isArray(claim.anchor) && claim.anchor.length > 0) {
            const resolved = resolveSelectors(claim.anchor, container);
            if (resolved && resolved.range && wrapByOffsets(container, resolved.range.textStart, resolved.range.textEnd, claim)) {
                continue;
            }
        }
        wrapFirstTextOccurrence(container, claim.text, claim);
    }
}

/**
 * Map a [textStart, textEnd) range over `container.textContent` to a DOM
 * Range and wrap it with the claim mark. Returns true on success. Skips
 * spans already inside an `.xr-claim` mark (idempotent across re-renders).
 */
function wrapByOffsets(container, textStart, textEnd, claim) {
    if (!Number.isFinite(textStart) || !Number.isFinite(textEnd) || textEnd <= textStart) return false;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node, pos = 0;
    let startNode = null, startOff = 0, endNode = null, endOff = 0;
    while ((node = walker.nextNode())) {
        const len = node.nodeValue.length;
        if (!startNode && textStart < pos + len) {
            startNode = node;
            startOff = textStart - pos;
        }
        if (startNode && textEnd <= pos + len) {
            endNode = node;
            endOff = textEnd - pos;
            break;
        }
        pos += len;
    }
    if (!startNode || !endNode) return false;
    if (startNode.parentElement && startNode.parentElement.closest('.xr-claim')) return false; // already marked
    const range = document.createRange();
    try {
        range.setStart(startNode, startOff);
        range.setEnd(endNode, endOff);
        wrapRangeWithClaimMark(range, claim);
        return true;
    } catch (_) {
        return false;
    }
}

function wrapFirstTextOccurrence(container, needle, claim) {
    // Search inside text nodes not already inside a claim or entity mark
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node;
    // Normalize the needle for searching — collapse whitespace so a
    // claim saved with pasted-in line breaks still finds its source.
    const normNeedle = needle.replace(/\s+/g, ' ').trim();
    if (!normNeedle) return;
    while ((node = walker.nextNode())) {
        if (node.parentElement && node.parentElement.closest('.xr-claim')) continue;
        const hay = node.nodeValue.replace(/\s+/g, ' ');
        const idx = hay.indexOf(normNeedle);
        if (idx < 0) continue;
        // Map back from normalized offset to raw-text offset is
        // imprecise when the raw text has weird whitespace. Cheap
        // approximation: find the first run of characters in the raw
        // string whose collapsed form matches the needle.
        const raw = node.nodeValue;
        const startRaw = rawIndexOf(raw, normNeedle);
        if (startRaw < 0) continue;
        const endRaw = startRaw + approxLength(raw, startRaw, normNeedle.length);
        const range = document.createRange();
        try {
            range.setStart(node, startRaw);
            range.setEnd(node, Math.min(endRaw, raw.length));
            wrapRangeWithClaimMark(range, claim);
        } catch (_) { /* ignore */ }
        return;
    }
}

function rawIndexOf(raw, normalizedNeedle) {
    const collapsed = raw.replace(/\s+/g, ' ');
    const normIdx = collapsed.indexOf(normalizedNeedle);
    if (normIdx < 0) return -1;
    // Walk raw up to `normIdx` of non-leading-whitespace-collapsed characters.
    let rawIdx = 0;
    let collapsedIdx = 0;
    while (rawIdx < raw.length && collapsedIdx < normIdx) {
        const ch = raw[rawIdx];
        const next = raw[rawIdx + 1];
        if (/\s/.test(ch)) {
            collapsedIdx++;
            // Skip any contiguous whitespace that would've been collapsed.
            while (rawIdx + 1 < raw.length && /\s/.test(next)) { rawIdx++; }
        } else {
            collapsedIdx++;
        }
        rawIdx++;
    }
    return rawIdx;
}

function approxLength(raw, startRaw, normalizedLen) {
    // Expand from startRaw until the collapsed run length reaches normalizedLen.
    let i = startRaw, collapsedCount = 0, inWs = false;
    while (i < raw.length && collapsedCount < normalizedLen) {
        if (/\s/.test(raw[i])) {
            if (!inWs) { collapsedCount++; inWs = true; }
        } else {
            collapsedCount++;
            inWs = false;
        }
        i++;
    }
    return i - startRaw;
}

function wrapRangeWithClaimMark(range, claim) {
    const mark = document.createElement('span');
    mark.className = `xr-claim${claim.is_key ? ' xr-claim--crux' : ''}`;
    mark.setAttribute('data-claim-id', claim.id);
    mark.setAttribute('title', `${claim.is_key ? '⭐ key claim' : 'Claim'}: ${claim.text.slice(0, 180)}`);
    try { range.surroundContents(mark); }
    catch (_) {
        const frag = range.extractContents();
        mark.appendChild(frag);
        range.insertNode(mark);
    }
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

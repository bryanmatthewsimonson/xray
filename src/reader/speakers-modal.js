// Speakers modal — voice → entity identification for transcripts.
//
// Provenance for spoken media means knowing WHO spoke. Diarization
// yields automatic labels ("Speaker 1", "Speaker 2" — or real names on
// VTT imports); this modal binds each label to a person entity. The
// binding IS an ordinary entity ref whose mention context is the label
// itself ({entity_id, context: 'Speaker 1'}), so the EXISTING wire
// machinery carries it: ['p', <pk>, '', '<label>'] + ['person',
// <name>, '<label>'] on the kind-30023, entity aliases co-tag the
// canonical, and reconstructEntityRefsFromEvent round-trips it. Zero
// new tags, zero new kinds.
//
// Voice-split aliasing (the same real person detected as two labels):
// bind BOTH labels to the same entity — the ref dedupe keys on the
// entity_id+context PAIR, so one entity may carry many labels. The
// transcript body keeps its automatic labels untouched (metadata-only;
// the hash never moves).
//
// The adjudicate-modal idiom: Promise-returning, body-appended overlay
// + backdrop + Escape, self-injected <style> (xr-speakers-* only).

import { EntityModel } from '../shared/entity-model.js';

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ------------------------------------------------------------------
// Pure helpers (node-tested; no DOM)
// ------------------------------------------------------------------

/** The entity id bound to a speaker label, or null: the ref whose
 *  mention context EXACTLY equals the label. The claim-prefill
 *  resolution consults this before any registry name-matching. */
export function speakerEntityId(entities, label) {
    if (!Array.isArray(entities) || !label) return null;
    const ref = entities.find((e) => e && e.entity_id && e.context === label);
    return ref ? ref.entity_id : null;
}

/** label → entity_id map for the modal rows (labels without a binding
 *  are absent). */
export function speakerBindings(entities, speakers) {
    const out = new Map();
    for (const label of speakers || []) {
        const id = speakerEntityId(entities, label);
        if (id) out.set(label, id);
    }
    return out;
}

/**
 * Per-label voice facts from the raw companion segments (diarized
 * captures only — imports without segments get empty facts). Segments
 * carry RAW pyannote labels; the display map mirrors
 * diarized-transcript.js speakerDisplayMap (first-appearance order).
 *
 * @returns Map<displayLabel, {turns, firstStartSec, firstText}>
 */
export function speakerFacts(segments) {
    const facts = new Map();
    const names = new Map();
    for (const s of segments || []) {
        const raw = s && s.speaker;
        const text = String((s && s.text) || '').trim();
        if (!raw || !text) continue;
        if (!names.has(raw)) names.set(raw, `Speaker ${names.size + 1}`);
        const label = names.get(raw);
        if (!facts.has(label)) {
            facts.set(label, {
                turns: 0,
                firstStartSec: Math.max(0, Number(s.start) || 0),
                firstText: text.slice(0, 120)
            });
        }
        facts.get(label).turns += 1;
    }
    return facts;
}

/**
 * Diff the modal's chosen bindings against the article's current refs.
 * Returns the refs to upsert and the labels whose binding was removed
 * (index.js filters those refs out). Unchanged bindings still appear
 * in `refs` — the reader's dedupe makes re-upserting them a no-op.
 *
 * @param {{entities: Array, speakers: string[], chosen: Map<string, {entityId: string, type: string, name: string}>}} p
 * @returns {{refs: Array<{entity_id: string, type: string, name: string, context: string}>, removed: string[]}}
 */
export function diffSpeakerRefs({ entities = [], speakers = [], chosen = new Map() } = {}) {
    const refs = [];
    const removed = [];
    for (const label of speakers) {
        const pick = chosen.get(label);
        const current = speakerEntityId(entities, label);
        if (pick && pick.entityId) {
            refs.push({ entity_id: pick.entityId, type: pick.type || 'person', name: pick.name || '', context: label });
            if (current && current !== pick.entityId) removed.push(label);
        } else if (current) {
            removed.push(label);
        }
    }
    return { refs, removed };
}

/**
 * Decorate the RENDERED transcript with identified entity names — the
 * research-orientation layer ("who said what"). The canonical text
 * keeps its automatic labels; the name rides as a data attribute that
 * CSS renders via ::after, so it is invisible to turndown/innerText
 * and can never leak into the published body (the entity-mark
 * text-neutrality bar). Idempotent and self-clearing: re-run after a
 * binding change and stale decorations drop.
 *
 * @returns {number} labels decorated
 */
export function decorateSpeakerLabels(bodyEl, article) {
    if (!bodyEl || !article) return 0;
    const speakers = (article.transcript_meta && article.transcript_meta.speakers) || [];
    const refs = Array.isArray(article.entities) ? article.entities : [];
    const nameByLabelColon = new Map();
    for (const label of speakers) {
        const ref = refs.find((e) => e && e.entity_id && e.context === label);
        if (ref && ref.name && ref.name !== label) nameByLabelColon.set(`${label}:`, ref.name);
    }
    let count = 0;
    for (const el of bodyEl.querySelectorAll('strong, b')) {
        const name = nameByLabelColon.get((el.textContent || '').trim());
        if (name) {
            el.classList.add('xr-speaker-id');
            el.setAttribute('data-xr-speaker-entity', name);
            el.setAttribute('title', `Identified: ${name}`);
            count += 1;
        } else if (el.classList.contains('xr-speaker-id')) {
            el.classList.remove('xr-speaker-id');
            el.removeAttribute('data-xr-speaker-entity');
            el.removeAttribute('title');
        }
    }
    return count;
}

/** Group labels by chosen entity — the voice-split display note
 *  ("same voice as Speaker N"). */
export function voiceSplitGroups(chosen) {
    const byEntity = new Map();
    for (const [label, pick] of chosen || []) {
        if (!pick || !pick.entityId) continue;
        if (!byEntity.has(pick.entityId)) byEntity.set(pick.entityId, []);
        byEntity.get(pick.entityId).push(label);
    }
    return [...byEntity.values()].filter((labels) => labels.length > 1);
}

// ------------------------------------------------------------------
// Modal
// ------------------------------------------------------------------

const NEW_PERSON = '__new__';

function formatStamp(sec) {
    const total = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const two = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

function rowHtml(label, idx, facts, boundId, registryOpts, watchUrl) {
    const f = facts.get(label);
    const jump = (f && watchUrl)
        ? ` · <a href="${escapeHtml(`${watchUrl}&t=${Math.floor(f.firstStartSec)}s`)}" target="_blank" rel="noopener"
             title="Jump to this voice's first turn">listen ${escapeHtml(formatStamp(f.firstStartSec))}</a>`
        : '';
    const meta = f
        ? `<span class="xr-speakers__meta">${f.turns} turn${f.turns === 1 ? '' : 's'}${jump}</span>
           <span class="xr-speakers__quote">“${escapeHtml(f.firstText)}${f.firstText.length >= 120 ? '…' : ''}”</span>`
        : '';
    return `
      <div class="xr-speakers__row" data-label="${escapeHtml(label)}">
        <div class="xr-speakers__who">
          <span class="xr-speakers__name">${escapeHtml(label)}</span>
          ${meta}
        </div>
        <div class="xr-speakers__pick">
          <select data-role="speaker-entity" data-idx="${idx}">
            <option value="">— unidentified —</option>
            ${registryOpts(boundId)}
            <option value="${NEW_PERSON}">＋ new person…</option>
          </select>
          <input type="text" data-role="speaker-new" data-idx="${idx}" hidden
                 placeholder="Person's name" spellcheck="false" />
          <span class="xr-speakers__alias" data-role="speaker-alias" data-idx="${idx}" hidden></span>
        </div>
      </div>`;
}

/**
 * Open the modal. Never mutates the article — returns
 * {refs, removed} for reader/index.js to apply (or null on cancel).
 * New-person entities ARE minted at save time (the registry is the
 * durable store either way; an unused person is harmless and visible
 * in the entity browser).
 *
 * @param {{article: object, registry: Array}} p  registry = EntityModel list (persons/orgs)
 */
export function openSpeakersModal({ article, registry = [] } = {}) {
    ensureStyles();
    const speakers = (article && article.transcript_meta && article.transcript_meta.speakers) || [];
    const entities = (article && article.entities) || [];
    const segments = (article && article.transcription && article.transcription.segments) || [];
    const watchUrl = /^https?:\/\//i.test(article && article.url || '') ? article.url : null;

    const facts = speakerFacts(segments);
    const bindings = speakerBindings(entities, speakers);
    const people = registry
        .filter((e) => e && (e.type === 'person' || e.type === 'organization'))
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'person' ? -1 : 1));
    const byId = new Map(people.map((e) => [e.id, e]));

    const registryOpts = (selectedId) => people.map((e) =>
        `<option value="${escapeHtml(e.id)}" ${e.id === selectedId ? 'selected' : ''}>
           ${escapeHtml(e.name)}${e.type === 'organization' ? ' (org)' : ''}</option>`).join('');

    return new Promise((resolve) => {
        const host = document.createElement('div');
        host.className = 'xr-speakers';
        host.innerHTML = `
          <div class="xr-speakers__backdrop"></div>
          <div class="xr-speakers__card" role="dialog" aria-label="Identify speakers">
            <header class="xr-speakers__head"><h3 class="xr-speakers__title">🗣 Identify speakers</h3></header>
            <div class="xr-speakers__body">
              <p class="xr-speakers__hint">
                Bind each detected voice to the person who spoke — that binding is the
                claim provenance for everything they said, and it publishes with the
                capture. Pick the SAME person for two labels when diarization split
                one voice. The transcript text keeps its automatic labels.
              </p>
              ${speakers.map((label, i) => rowHtml(label, i, facts, bindings.get(label) || '', registryOpts, watchUrl)).join('')}
              <div class="xr-speakers__err" hidden></div>
            </div>
            <footer class="xr-speakers__foot">
              <button type="button" class="xr-reader__btn xr-reader__btn--ghost" data-action="cancel">Cancel</button>
              <button type="button" class="xr-reader__btn" data-action="save">Save speakers</button>
            </footer>
          </div>`;
        document.body.appendChild(host);
        const $ = (sel) => host.querySelector(sel);
        const $$ = (sel) => [...host.querySelectorAll(sel)];

        const close = (result) => {
            document.removeEventListener('keydown', onKey);
            if (host.parentNode) host.parentNode.removeChild(host);
            resolve(result);
        };
        const onKey = (ev) => { if (ev.key === 'Escape') close(null); };
        document.addEventListener('keydown', onKey);
        $('.xr-speakers__backdrop').addEventListener('click', () => close(null));
        $('[data-action="cancel"]').addEventListener('click', () => close(null));

        // Live voice-split notes + the new-person input reveal.
        const repaint = () => {
            const picks = new Map();
            $$('[data-role="speaker-entity"]').forEach((sel) => {
                const label = sel.closest('.xr-speakers__row').dataset.label;
                if (sel.value && sel.value !== NEW_PERSON) picks.set(label, { entityId: sel.value });
            });
            $$('.xr-speakers__row').forEach((row) => {
                const label = row.dataset.label;
                const note = row.querySelector('[data-role="speaker-alias"]');
                const mine = picks.get(label);
                if (!mine) { note.hidden = true; return; }
                const twins = [...picks].filter(([l, p]) => l !== label && p.entityId === mine.entityId).map(([l]) => l);
                note.hidden = twins.length === 0;
                note.textContent = twins.length ? `same voice as ${twins.join(', ')}` : '';
            });
        };
        $$('[data-role="speaker-entity"]').forEach((sel) => {
            sel.addEventListener('change', () => {
                const input = sel.parentElement.querySelector('[data-role="speaker-new"]');
                input.hidden = sel.value !== NEW_PERSON;
                if (!input.hidden) input.focus();
                repaint();
            });
        });
        repaint();

        $('[data-action="save"]').addEventListener('click', async () => {
            const err = $('.xr-speakers__err');
            err.hidden = true;
            try {
                const chosen = new Map();
                for (const row of $$('.xr-speakers__row')) {
                    const label = row.dataset.label;
                    const sel = row.querySelector('[data-role="speaker-entity"]');
                    if (!sel.value) continue;
                    if (sel.value === NEW_PERSON) {
                        const name = row.querySelector('[data-role="speaker-new"]').value.trim();
                        if (!name) { throw new Error(`Name the new person for ${label} (or set them back to unidentified).`); }
                        // Idempotent on (type, name) — re-saving never duplicates.
                        const e = await EntityModel.create({ type: 'person', name });
                        chosen.set(label, { entityId: e.id, type: e.type, name: e.name });
                    } else {
                        const e = byId.get(sel.value);
                        if (e) chosen.set(label, { entityId: e.id, type: e.type, name: e.name });
                    }
                }
                close(diffSpeakerRefs({ entities, speakers, chosen }));
            } catch (ex) {
                err.textContent = (ex && ex.message) || String(ex);
                err.hidden = false;
            }
        });
    });
}

let stylesInjected = false;
function ensureStyles() {
    if (stylesInjected || typeof document === 'undefined') return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.id = 'xr-speakers-styles';
    style.textContent = `
.xr-speakers { position: fixed; inset: 0; z-index: 10010; }
.xr-speakers__backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.55); }
.xr-speakers__card {
  position: relative; margin: 6vh auto 0; width: min(600px, calc(100vw - 32px));
  max-height: 86vh; display: flex; flex-direction: column;
  background: var(--xr-surface, #242424); color: var(--xr-text, #e6e6e6);
  border: 1px solid var(--xr-border, #333); border-radius: 10px;
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.xr-speakers__head { padding: 14px 18px 0; }
.xr-speakers__title { margin: 0; font-size: 16px; }
.xr-speakers__body { padding: 10px 18px; overflow-y: auto; }
.xr-speakers__hint { color: var(--xr-text-dim, #9a9a9a); font-size: 12.5px; margin: 0 0 12px; }
.xr-speakers__row {
  display: flex; gap: 14px; align-items: flex-start; padding: 10px 0;
  border-top: 1px solid var(--xr-border, #333);
}
.xr-speakers__who { flex: 1 1 50%; min-width: 0; }
.xr-speakers__name { font-weight: 600; display: block; }
.xr-speakers__meta { color: var(--xr-text-dim, #9a9a9a); font-size: 12px; display: block; }
.xr-speakers__meta a { color: var(--xr-accent, #7aa2f7); }
.xr-speakers__quote {
  color: var(--xr-text-dim, #9a9a9a); font-size: 12px; font-style: italic;
  display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.xr-speakers__pick { flex: 1 1 50%; display: flex; flex-direction: column; gap: 6px; }
.xr-speakers__pick select, .xr-speakers__pick input {
  width: 100%; background: var(--xr-surface-2, #1c1c1c); color: inherit;
  border: 1px solid var(--xr-border, #333); border-radius: 6px; padding: 6px 8px;
}
.xr-speakers__alias { color: var(--xr-accent, #7aa2f7); font-size: 12px; }
.xr-speakers__err { color: #f7768e; font-size: 12.5px; margin-top: 10px; }
.xr-speakers__foot {
  display: flex; justify-content: flex-end; gap: 10px; padding: 12px 18px 16px;
  border-top: 1px solid var(--xr-border, #333);
}
`;
    document.head.appendChild(style);
}

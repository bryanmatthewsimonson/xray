// Reader-side text-selection entity tagger — Phase 4 C2 (issue #15).
//
// Flow:
//   1. User selects a span of text in the article body.
//   2. `mouseup` inside the body, if the selection is non-empty and
//      the selection's common ancestor is inside the body, opens the
//      tagger popover anchored near the bottom-right corner of the
//      selection bounding rect.
//   3. Popover shows: an autocomplete search box (pre-filled with the
//      selected text), the top existing-entity matches grouped by
//      type, and a "Create new as …" row of four type-icon buttons
//      that create a brand-new entity (name = the search box value)
//      and tag the selection with it.
//   4. Tagging:
//        - wraps the selected range in
//          `<span class="xr-entity xr-entity--<type>"
//                 data-entity-id data-entity-type>…</span>`
//          so the mark is visible in the reader (and legibly
//          distinguishable by type).
//        - invokes the caller-supplied onTag callback with the
//          `{entity_id, context, type, name}` ref so the reader can
//          push it onto `state.article.entities`.
//
// Escape key or click-outside closes the popover. The popover is a
// plain DOM node appended to document.body, positioned absolutely.

import { EntityModel, ENTITY_ICONS } from '../shared/entity-model.js';

let popover = null;
let currentSelectionRange = null;
let currentSelectionText  = '';
let onTagCallback         = null;

/**
 * Wire the tagger up to a container element (typically the article
 * body). Returns an uninstall function.
 *
 * @param {{ container: HTMLElement, onTag: (ref) => void }} opts
 */
export function installEntityTagger({ container, onTag }) {
    if (!container) return () => {};
    onTagCallback = onTag;

    const onMouseUp = (ev) => {
        // Small delay so selection state has settled — some browsers
        // clear the selection on mousedown of a subsequent click and
        // the popover itself is a subsequent click.
        setTimeout(() => {
            handleSelection(container, ev);
        }, 0);
    };

    const onKeyDown = (ev) => {
        if (ev.key === 'Escape' && popover) {
            closePopover();
            ev.preventDefault();
        }
    };

    const onDocClick = (ev) => {
        if (!popover) return;
        if (popover.contains(ev.target)) return;    // click inside popover
        if (container.contains(ev.target))  return; // new selection underway
        closePopover();
    };

    container.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onDocClick, true);

    return () => {
        container.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('mousedown', onDocClick, true);
        closePopover();
    };
}

function handleSelection(container) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        // click without a selection — if the popover is still open from
        // a prior selection, leave it alone; closePopover is handled by
        // the outside-click listener.
        return;
    }

    const range = sel.getRangeAt(0);
    // Only fire if the selection is entirely inside the container.
    // `commonAncestorContainer` may be a text node; walk up to an
    // element node for the contains() check.
    const anc = range.commonAncestorContainer.nodeType === 1
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    if (!anc || !container.contains(anc)) return;

    const text = sel.toString().trim();
    if (!text || text.length > 500) return;   // reject empty or comically long

    currentSelectionRange = range.cloneRange();
    currentSelectionText  = text;

    const rect = range.getBoundingClientRect();
    openPopover({ x: rect.right, y: rect.bottom, initialText: text });
}

// ------------------------------------------------------------------
// Popover DOM
// ------------------------------------------------------------------

function openPopover({ x, y, initialText }) {
    closePopover();

    popover = document.createElement('div');
    popover.className = 'xr-tagger-popover';
    popover.innerHTML = `
      <div class="xr-tagger-popover__head">
        <input type="text" class="xr-tagger-popover__search"
               placeholder="Search or create entity" spellcheck="false"
               value="${escapeHtml(initialText)}" />
        <button type="button" class="xr-tagger-popover__close"
                aria-label="Close" tabindex="-1">×</button>
      </div>
      <div class="xr-tagger-popover__results"></div>
      <div class="xr-tagger-popover__create">
        <span class="xr-tagger-popover__create-label">New as:</span>
        <button type="button" class="xr-tagger-popover__type-btn" data-type="person"
                title="Person">${ENTITY_ICONS.person}</button>
        <button type="button" class="xr-tagger-popover__type-btn" data-type="organization"
                title="Organization">${ENTITY_ICONS.organization}</button>
        <button type="button" class="xr-tagger-popover__type-btn" data-type="place"
                title="Place">${ENTITY_ICONS.place}</button>
        <button type="button" class="xr-tagger-popover__type-btn" data-type="thing"
                title="Thing">${ENTITY_ICONS.thing}</button>
      </div>
    `;

    // Position — near the selection's bottom-right, clamped to viewport.
    const POPOVER_WIDTH = 320;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(Math.max(8, x), vw - POPOVER_WIDTH - 8);
    const top  = Math.min(y + 6, vh - 200);
    popover.style.left = `${left + window.scrollX}px`;
    popover.style.top  = `${top  + window.scrollY}px`;

    document.body.appendChild(popover);

    const search = popover.querySelector('.xr-tagger-popover__search');
    const results = popover.querySelector('.xr-tagger-popover__results');

    search.addEventListener('input', async () => {
        renderResults(results, search.value);
    });

    search.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            // Default action: if there's exactly one result, pick it;
            // otherwise create a new person (the most common type).
            const first = results.querySelector('.xr-tagger-popover__result');
            if (first) { first.click(); ev.preventDefault(); return; }
            const personBtn = popover.querySelector('.xr-tagger-popover__type-btn[data-type="person"]');
            personBtn && personBtn.click();
            ev.preventDefault();
        }
    });

    popover.querySelectorAll('.xr-tagger-popover__type-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const type = btn.dataset.type;
            const name = (search.value || '').trim() || currentSelectionText;
            if (!name) return;
            try {
                const entity = await EntityModel.create({ name, type });
                applyTag(entity);
            } catch (err) {
                console.warn('[X-Ray Tagger] create failed:', err);
            }
        });
    });

    popover.querySelector('.xr-tagger-popover__close')
        .addEventListener('click', closePopover);

    search.focus();
    search.select();
    // Initial render — seed autocomplete with the pre-filled text.
    renderResults(results, search.value);
}

function closePopover() {
    if (popover && popover.parentNode) popover.parentNode.removeChild(popover);
    popover = null;
}

async function renderResults(container, query) {
    const matches = await EntityModel.search(query, { limit: 8 });
    if (matches.length === 0) {
        container.innerHTML = `<div class="xr-tagger-popover__empty">No matching entities — create one below.</div>`;
        return;
    }
    container.innerHTML = matches.map((e) => `
      <button type="button" class="xr-tagger-popover__result" data-id="${escapeAttr(e.id)}">
        <span class="xr-tagger-popover__result-icon">${ENTITY_ICONS[e.type] || '🔷'}</span>
        <span class="xr-tagger-popover__result-name">${escapeHtml(e.name)}</span>
        ${e.canonical_id
            ? '<span class="xr-tagger-popover__result-alias" title="Alias">→</span>'
            : ''}
      </button>
    `).join('');
    container.querySelectorAll('.xr-tagger-popover__result').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            const entity = await EntityModel.get(id);
            if (entity) applyTag(entity);
        });
    });
}

// ------------------------------------------------------------------
// Apply tag: wrap the stored range, call onTag, close popover
// ------------------------------------------------------------------

function applyTag(entity) {
    if (!currentSelectionRange || !entity) { closePopover(); return; }
    try {
        wrapRangeWithEntityMark(currentSelectionRange, entity);
    } catch (err) {
        // surroundContents throws for selections that cross element
        // boundaries. In that case we skip the visual mark but still
        // fire onTag so the publish flow p-tags the entity — the
        // metadata is more important than the highlight.
        console.warn('[X-Ray Tagger] could not wrap range; tagging without visual mark:', err);
    }
    if (typeof onTagCallback === 'function') {
        onTagCallback({
            entity_id: entity.id,
            type:      entity.type,
            name:      entity.name,
            context:   currentSelectionText
        });
    }
    closePopover();
    // Clear the selection so a subsequent mouseup without re-selection
    // doesn't reopen the popover.
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
    currentSelectionRange = null;
    currentSelectionText  = '';
}

/**
 * Wrap the given Range in an entity-mark span.
 *
 * `range.surroundContents()` only works when the range doesn't partially
 * enclose a non-text node. For cross-element selections we fall back to
 * extract + insert.
 */
function wrapRangeWithEntityMark(range, entity) {
    const mark = document.createElement('span');
    mark.className = `xr-entity xr-entity--${entity.type}`;
    mark.setAttribute('data-entity-id',   entity.id);
    mark.setAttribute('data-entity-type', entity.type);
    mark.setAttribute('data-entity-name', entity.name);
    mark.setAttribute('title', `${entity.type}: ${entity.name}`);

    try {
        range.surroundContents(mark);
    } catch (_) {
        const frag = range.extractContents();
        mark.appendChild(frag);
        range.insertNode(mark);
    }
}

// ------------------------------------------------------------------
// Rehydration — apply marks for refs already on state.article.entities
// when the reader re-renders.
// ------------------------------------------------------------------

/**
 * Given a container that's just been filled with article HTML and an
 * array of `{entity_id, context, type, name}` refs, find occurrences
 * of each `context` text inside the container and wrap the first
 * unwrapped match in an entity-mark span. Best-effort: later matches
 * and contexts that moved under user editing may go unmarked. The
 * publish-time p-tag doesn't depend on the visual mark — this is
 * purely display chrome.
 */
export async function rehydrateEntityMarks(container, entityRefs) {
    if (!container || !Array.isArray(entityRefs) || entityRefs.length === 0) return;
    for (const ref of entityRefs) {
        if (!ref || !ref.context || !ref.entity_id) continue;
        // Look up the entity so the mark's data-entity-type is accurate
        // even if the ref was saved without one (back-compat).
        const entity = await EntityModel.get(ref.entity_id);
        if (!entity) continue;
        wrapFirstTextOccurrence(container, ref.context, entity);
    }
}

function wrapFirstTextOccurrence(container, needle, entity) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
        if (node.parentElement && node.parentElement.closest('.xr-entity')) continue;
        const idx = node.nodeValue.indexOf(needle);
        if (idx < 0) continue;
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node,   idx + needle.length);
        try {
            wrapRangeWithEntityMark(range, entity);
        } catch (_) { /* ignore */ }
        return;
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

function escapeAttr(s) {
    return escapeHtml(s);
}

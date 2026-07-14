// "Add sources…" picker — Phase 20.2. An inline panel over the portal
// case view that lists archived articles NOT yet in the case (neither
// tag- nor claim-mediated) and tags the chosen ones with the case
// entity. Local-only: it never republishes, so an already-published
// capture keeps its old wire p-tags until re-published from the reader
// (the panel shows a hint after adding such a record).

import { el } from './dom.js';
import { Utils } from '../shared/utils.js';
import { listAddableArticles, addArticlesToCase } from '../shared/case-membership.js';

function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url || ''; }
}

/**
 * Mount the picker into `host`. `caseEntityId` is the LOCAL case id;
 * `onChanged()` is called after a successful add (the case view
 * re-renders). Returns nothing — the panel manages its own lifecycle.
 */
export function mountAddSources(host, { caseEntityId, onChanged }) {
    const panel = el('div', 'xr-addcase');
    host.appendChild(panel);

    const status = el('div', 'xr-addcase__status');
    const filter = el('input', 'xr-addcase__filter');
    filter.type = 'text';
    filter.placeholder = 'Filter archived articles…';
    filter.spellcheck = false;
    const listWrap = el('div', 'xr-addcase__list');
    const actions = el('div', 'xr-addcase__actions');
    const addBtn = el('button', 'xr-portal__btn', 'Add to case');
    addBtn.type = 'button';
    addBtn.disabled = true;
    const cancelBtn = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Close');
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', () => panel.remove());
    actions.appendChild(addBtn);
    actions.appendChild(cancelBtn);

    panel.appendChild(el('h4', 'xr-case__heading', 'Add archived articles to this case'));
    panel.appendChild(filter);
    panel.appendChild(listWrap);
    panel.appendChild(actions);
    panel.appendChild(status);

    const selected = new Set();
    let candidates = [];

    const refreshAddBtn = () => {
        addBtn.disabled = selected.size === 0;
        addBtn.textContent = selected.size ? `Add ${selected.size} to case` : 'Add to case';
    };

    const renderList = () => {
        listWrap.replaceChildren();
        const q = filter.value.trim().toLowerCase();
        const shown = candidates.filter((rec) => {
            if (!q) return true;
            const t = ((rec.article && rec.article.title) || rec.url || '').toLowerCase();
            return t.includes(q) || (rec.url || '').toLowerCase().includes(q);
        });
        if (shown.length === 0) {
            listWrap.appendChild(el('div', 'xr-inspector__mono',
                candidates.length === 0 ? 'No archived articles are outside this case.' : 'No matches.'));
            return;
        }
        for (const rec of shown.slice(0, 200)) {
            const row = el('label', 'xr-addcase__row');
            const cb = el('input', 'xr-addcase__cb');
            cb.type = 'checkbox';
            cb.checked = selected.has(rec.url);
            cb.addEventListener('change', () => {
                if (cb.checked) selected.add(rec.url); else selected.delete(rec.url);
                refreshAddBtn();
            });
            row.appendChild(cb);
            const meta = el('span', 'xr-addcase__meta');
            meta.appendChild(el('span', 'xr-addcase__title', (rec.article && rec.article.title) || rec.url));
            const sub = el('span', 'xr-addcase__sub', hostOf(rec.url)
                + (rec.publishedToRelay ? ' · published' : ''));
            meta.appendChild(sub);
            row.appendChild(meta);
            listWrap.appendChild(row);
        }
        if (shown.length > 200) {
            listWrap.appendChild(el('div', 'xr-inspector__mono', `… +${shown.length - 200} more (filter to narrow)`));
        }
    };

    filter.addEventListener('input', renderList);

    addBtn.addEventListener('click', async () => {
        addBtn.disabled = true;
        try {
            const res = await addArticlesToCase(caseEntityId, [...selected]);
            let msg = `Added ${res.added.length} source${res.added.length === 1 ? '' : 's'}.`;
            if (res.published.length > 0) {
                msg += ` ${res.published.length} already published — the wire copy won't carry this case`
                    + ' until re-published from the reader.';
            }
            status.textContent = msg;
            if (typeof onChanged === 'function') onChanged();
        } catch (err) {
            Utils.error('Add sources failed', err);
            status.textContent = `Add failed: ${err.message || err}`;
            refreshAddBtn();
        }
    });

    (async () => {
        try {
            const { candidates: cands } = await listAddableArticles(caseEntityId);
            candidates = cands;
            renderList();
        } catch (err) {
            Utils.error('Add sources: candidate load failed', err);
            listWrap.appendChild(el('div', 'xr-inspector__mono', 'Could not load archived articles.'));
        }
    })();
}

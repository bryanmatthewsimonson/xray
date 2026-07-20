// Case source manager — Phase 28.5. Replaces the 20.2 "Add sources…"
// checkbox strip with one coherent panel over the case view:
//
//   - CURRENT MEMBERS, with membership chips (`tag` / `claims`) so a
//     reader sees HOW each source belongs. Tag membership removes per
//     row; claim membership is edited through claims in the reader and
//     is never silently stripped — a tag+claims row that loses its tag
//     STAYS a member, and the panel says so.
//   - ADD, the filterable not-yet-member archive picker (unchanged
//     mechanics, coherent styling).
//
// Local-only, like every membership author: adds/removes never
// republish; an already-published capture keeps its old wire p-tags
// until re-published from the reader (the panel hints when that
// applies).

import { el } from './dom.js';
import { Utils } from '../shared/utils.js';
import {
    memberUrlSets, describeMembership, listAddableArticles,
    addArticlesToCase, removeArticleFromCase
} from '../shared/case-membership.js';
import { listArticles } from '../shared/archive-cache.js';

function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url || ''; }
}

function chip(text, title) {
    const c = el('span', `xr-srcmgr__chip xr-srcmgr__chip--${text}`, text);
    if (title) c.title = title;
    return c;
}

/**
 * Mount the manager into `host`. `caseEntityId` is the LOCAL case id;
 * `onChanged()` fires after any successful add/remove (the case view
 * re-renders). The panel manages its own lifecycle.
 */
export function mountSourceManager(host, { caseEntityId, onChanged }) {
    const panel = el('div', 'xr-srcmgr');
    host.appendChild(panel);

    const status = el('div', 'xr-srcmgr__status');
    const membersHead = el('h4', 'xr-case__heading', 'Sources in this case');
    const membersWrap = el('div', 'xr-srcmgr__members');
    const addHead = el('h4', 'xr-case__heading', 'Add archived articles');
    const filter = el('input', 'xr-srcmgr__filter');
    filter.type = 'text';
    filter.placeholder = 'Filter archived articles…';
    filter.spellcheck = false;
    const addWrap = el('div', 'xr-srcmgr__list');
    const actions = el('div', 'xr-srcmgr__actions');
    const addBtn = el('button', 'xr-portal__btn', 'Add to case');
    addBtn.type = 'button';
    addBtn.disabled = true;
    const closeBtn = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Close');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', () => panel.remove());
    actions.appendChild(addBtn);
    actions.appendChild(closeBtn);

    panel.appendChild(membersHead);
    panel.appendChild(membersWrap);
    panel.appendChild(addHead);
    panel.appendChild(filter);
    panel.appendChild(addWrap);
    panel.appendChild(actions);
    panel.appendChild(status);

    const selected = new Set();
    let candidates = [];
    const notifyChanged = () => { if (typeof onChanged === 'function') onChanged(); };

    const refreshAddBtn = () => {
        addBtn.disabled = selected.size === 0;
        addBtn.textContent = selected.size ? `Add ${selected.size} to case` : 'Add to case';
    };

    const renderMembers = async () => {
        membersWrap.replaceChildren();
        const [sets, articles] = await Promise.all([memberUrlSets(caseEntityId), listArticles()]);
        const { rows, counts } = describeMembership(articles, sets);
        membersHead.textContent = `Sources in this case (${counts.members})`;
        if (counts.members) {
            membersWrap.appendChild(el('div', 'xr-srcmgr__counts',
                `${counts.tagOnly} tagged only · ${counts.claimBacked} claim-backed — membership is the union of both`));
        } else {
            membersWrap.appendChild(el('div', 'xr-srcmgr__counts', 'No sources yet — add some below, or capture with this case active.'));
        }
        for (const row of rows) {
            const r = el('div', 'xr-srcmgr__row');
            const meta = el('span', 'xr-srcmgr__meta');
            const title = el('span', 'xr-srcmgr__title', (row.rec.article && row.rec.article.title) || row.rec.url);
            title.title = row.rec.url;
            meta.appendChild(title);
            meta.appendChild(el('span', 'xr-srcmgr__sub', hostOf(row.rec.url)
                + (row.rec.publishedToRelay ? ' · published' : '')));
            r.appendChild(meta);
            if (row.viaTag) r.appendChild(chip('tag', 'Tagged with the case entity (tag membership)'));
            if (row.viaClaims) r.appendChild(chip('claims', 'A claim about this case cites this source (claim membership)'));
            const act = el('span', 'xr-srcmgr__rowact');
            if (row.viaTag) {
                const rm = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Remove tag');
                rm.type = 'button';
                rm.title = row.viaClaims
                    ? 'Removes the case tag. This source STAYS a member via its claims — edit those in the reader.'
                    : 'Removes the case tag — this source leaves the case.';
                rm.addEventListener('click', async () => {
                    rm.disabled = true;
                    try {
                        await removeArticleFromCase(caseEntityId, row.rec.url);
                        status.textContent = row.viaClaims
                            ? 'Tag removed — the source remains a member via its claims.'
                            : 'Removed from the case.';
                        await refreshAll();
                        notifyChanged();
                    } catch (err) {
                        Utils.error('Source manager: remove failed', err);
                        status.textContent = `Remove failed: ${err.message || err}`;
                        rm.disabled = false;
                    }
                });
                act.appendChild(rm);
            } else {
                const note = el('span', 'xr-srcmgr__sub', 'via claims — edit in the reader');
                note.title = 'Claim-mediated membership: this source belongs because claims about the case cite it. Deleting or re-targeting those claims is the removal path.';
                act.appendChild(note);
            }
            r.appendChild(act);
            membersWrap.appendChild(r);
        }
    };

    const renderCandidates = () => {
        addWrap.replaceChildren();
        const q = filter.value.trim().toLowerCase();
        const shown = candidates.filter((rec) => {
            if (!q) return true;
            const t = ((rec.article && rec.article.title) || rec.url || '').toLowerCase();
            return t.includes(q) || (rec.url || '').toLowerCase().includes(q);
        });
        if (shown.length === 0) {
            addWrap.appendChild(el('div', 'xr-inspector__mono',
                candidates.length === 0 ? 'Every archived article is already in this case.' : 'No matches.'));
            return;
        }
        for (const rec of shown.slice(0, 200)) {
            const row = el('label', 'xr-srcmgr__row xr-srcmgr__row--pick');
            const cb = el('input', 'xr-srcmgr__cb');
            cb.type = 'checkbox';
            cb.checked = selected.has(rec.url);
            cb.addEventListener('change', () => {
                if (cb.checked) selected.add(rec.url); else selected.delete(rec.url);
                refreshAddBtn();
            });
            row.appendChild(cb);
            const meta = el('span', 'xr-srcmgr__meta');
            meta.appendChild(el('span', 'xr-srcmgr__title', (rec.article && rec.article.title) || rec.url));
            meta.appendChild(el('span', 'xr-srcmgr__sub', hostOf(rec.url)
                + (rec.publishedToRelay ? ' · published' : '')));
            row.appendChild(meta);
            addWrap.appendChild(row);
        }
        if (shown.length > 200) {
            addWrap.appendChild(el('div', 'xr-inspector__mono', `… +${shown.length - 200} more (filter to narrow)`));
        }
    };

    const refreshAll = async () => {
        const { candidates: cands } = await listAddableArticles(caseEntityId);
        candidates = cands;
        selected.clear();
        refreshAddBtn();
        renderCandidates();
        await renderMembers();
    };

    filter.addEventListener('input', renderCandidates);

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
            await refreshAll();
            notifyChanged();
        } catch (err) {
            Utils.error('Source manager: add failed', err);
            status.textContent = `Add failed: ${err.message || err}`;
            refreshAddBtn();
        }
    });

    refreshAll().catch((err) => {
        Utils.error('Source manager: load failed', err);
        status.textContent = 'Could not load the archive.';
    });
}

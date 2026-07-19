// URL-list import panel — Phase 28.1 (corpus intake automation).
// Paste a URL list (or a whole worksheet — markdown links are parsed
// out), preview the count, and batch-import every URL as an ordinary
// archive record tagged into the case. The import-transcript.js mount
// idiom: el() builders, self-managed lifecycle, no innerHTML. All the
// actual work lives in shared/url-import.js; this file is rows +
// buttons.
//
// No LLM here (28.2 adds the optional suggest-after-import). Failures
// render per-row and never stop the batch; the panel stays open so a
// partial run can be retried by re-clicking Import (already-archived
// rows are idempotent).

import { el } from './dom.js';
import { Utils } from '../shared/utils.js';
import { parseUrlList, importUrlList } from '../shared/url-import.js';
import { savePendingSuggestions } from '../shared/audit/audit-cache.js';

const STATUS_LABEL = {
    'imported':         '✓ imported',
    'thin':             '✓ imported (thin — possible paywall/abstract)',
    'already-archived': '✓ already archived',
    'pdf':              '↷ PDF — open via the reader',
    'failed':           '✗ failed'
};

function sendMessage(msg) {
    return new Promise((resolve) => {
        try { chrome.runtime.sendMessage(msg, (resp) => resolve(resp)); }
        catch (_) { resolve(null); }
    });
}

/**
 * @param {HTMLElement} host
 * @param {object} opts
 * @param {string|null} [opts.caseEntityId]  when set, imports are tagged into this case
 * @param {function}   [opts.onDone]         called after a batch finishes (case view reloads)
 */
export function mountUrlImport(host, { caseEntityId = null, onDone } = {}) {
    const panel = el('div', 'xr-import');
    host.appendChild(panel);

    panel.appendChild(el('h4', 'xr-case__heading', 'Import URLs'));
    panel.appendChild(el('p', 'xr-import__hint',
        'Paste URLs — one per line, or a whole worksheet (markdown links are parsed out). '
        + 'Each page is fetched, extracted like a normal capture, archived'
        + (caseEntityId ? ', and added to this case.' : '.')
        + ' Paywalled pages import as thin abstracts; PDFs are skipped (use the reader’s "Open a PDF by URL").'));

    const textarea = el('textarea', 'xr-import__text');
    textarea.placeholder = 'https://example.com/article-1\nhttps://example.com/article-2\n…';
    textarea.rows = 8;

    const preview = el('div', 'xr-import__preview');

    // 28.2 — optional suggest-after-import. Auto-RUN, never auto-accept:
    // suggestions land as pending records reviewed in the reader (the
    // 14.5.3 modal remains the only path to a saved artifact). Shown
    // only when llmAssist is on; disabled without a key.
    const suggestWrap = el('label', 'xr-import__suggest');
    suggestWrap.hidden = true;
    const suggestCheck = el('input');
    suggestCheck.type = 'checkbox';
    suggestWrap.appendChild(suggestCheck);
    suggestWrap.appendChild(el('span', 'xr-import__hint',
        ' Suggest entities & claims for each imported page (LLM) — suggestions wait in the reader for your review; nothing is saved without an Accept.'));
    (async () => {
        const cfg = await sendMessage({ type: 'xray:llm:config' });
        if (!cfg || !cfg.enabled) return;   // flag off ⇒ absent
        suggestWrap.hidden = false;
        if (!cfg.hasKey) {
            suggestCheck.disabled = true;
            suggestWrap.title = 'Set an Anthropic API key in Options → Advanced → LLM assist';
        }
    })();

    const importBtn = el('button', 'xr-portal__btn', 'Import');
    importBtn.type = 'button';
    importBtn.disabled = true;
    const closeBtn = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Close');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', () => panel.remove());
    const actions = el('div', 'xr-import__actions');
    actions.appendChild(importBtn);
    actions.appendChild(closeBtn);
    const status = el('div', 'xr-import__status');
    const rowsHost = el('div', 'xr-import__rows');

    panel.appendChild(textarea);
    panel.appendChild(preview);
    panel.appendChild(suggestWrap);
    panel.appendChild(actions);
    panel.appendChild(status);
    panel.appendChild(rowsHost);

    let urls = [];
    let running = false;

    const refresh = () => {
        urls = parseUrlList(textarea.value);
        // Never a silent no-op: pasted text that yields zero importable
        // URLs must SAY so — an empty preview beside a disabled Import
        // button reads as "the button is broken" (2026-07-19).
        preview.textContent = urls.length
            ? `${urls.length} URL${urls.length === 1 ? '' : 's'} detected`
            : textarea.value.trim()
                ? 'No importable URLs found — one web address per line (bare "example.com/page" lines are auto-prefixed with https://)'
                : '';
        importBtn.disabled = running || urls.length === 0;
    };
    textarea.addEventListener('input', refresh);

    importBtn.addEventListener('click', async () => {
        if (running || urls.length === 0) return;
        const suggest = !suggestWrap.hidden && suggestCheck.checked && !suggestCheck.disabled;
        // Spend confirmation (the corpus-synthesis discipline): the
        // suggest option sends each imported page's text to Anthropic.
        if (suggest && !confirm(`Import ${urls.length} URL${urls.length === 1 ? '' : 's'} and suggest artifacts for each?\n\n`
            + `This sends each successfully imported page's extracted text to Anthropic — up to ${urls.length} calls.`)) return;
        running = true;
        importBtn.disabled = true;
        rowsHost.replaceChildren();
        status.textContent = `Importing 0/${urls.length}…`;

        // One row per URL, updated in place as results land.
        const rowEls = new Map();
        for (const url of urls) {
            const row = el('div', 'xr-import__row');
            row.appendChild(el('span', 'xr-import__row-status', '…'));
            const label = el('span', 'xr-import__row-url', url);
            label.title = url;
            row.appendChild(label);
            rowsHost.appendChild(row);
            rowEls.set(url, row);
        }

        let done = 0;
        let parked = 0;
        try {
            const rows = await importUrlList(urls, {
                caseEntityId,
                // 28.2 — run the reader's suggest pass per imported page
                // and PARK the proposals for in-reader review. The SW
                // gates on llmAssist + key; a failure marks the row and
                // never un-imports the article.
                onImported: !suggest ? null : async ({ row, article, text }) => {
                    if (!text || !text.trim()) return;
                    const resp = await sendMessage({ type: 'xray:llm:suggest', request: {
                        articleText: text,
                        articleUrl: article.url || '',
                        articleTitle: article.title || ''
                    } });
                    if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'suggest failed');
                    if (!Array.isArray(resp.proposals) || resp.proposals.length === 0) return;
                    await savePendingSuggestions({
                        url: article.url,
                        articleHash: article._articleHash || null,
                        title: article.title || '',
                        proposals: resp.proposals,
                        model: resp.model || null,
                        source: 'url-import',
                        createdAt: Math.floor(Date.now() / 1000)
                    });
                    row.suggestions = resp.proposals.length;
                    parked += 1;
                },
                onProgress: (p) => {
                    if (p.phase === 'done' || p.phase === 'failed') {
                        done += 1;
                        status.textContent = `Importing ${done}/${urls.length}…`;
                    }
                },
                onResult: (r) => {
                    const row = rowEls.get(r.url);
                    if (!row) return;
                    const chip = row.querySelector('.xr-import__row-status');
                    chip.textContent = STATUS_LABEL[r.status] || r.status;
                    chip.className = `xr-import__row-status xr-import__row-status--${r.status}`;
                    if (r.title) {
                        const label = row.querySelector('.xr-import__row-url');
                        label.textContent = r.title;
                        label.title = r.url;
                    }
                    if (r.error && r.status !== 'pdf') row.appendChild(el('span', 'xr-import__row-err', r.error));
                    if (r.status === 'pdf') row.appendChild(el('span', 'xr-import__row-err', r.error || ''));
                    if (r.suggestions) {
                        row.appendChild(el('span', 'xr-import__row-sugg',
                            `✨ ${r.suggestions} suggestion${r.suggestions === 1 ? '' : 's'} — review in the reader`));
                    }
                    if (r.post) row.appendChild(el('span', 'xr-import__row-err', `suggest: ${r.post}`));
                }
            });

            const ok = rows.filter((r) => r.status === 'imported' || r.status === 'thin').length;
            const dup = rows.filter((r) => r.status === 'already-archived').length;
            const failed = rows.filter((r) => r.status === 'failed').length;
            const pdf = rows.filter((r) => r.status === 'pdf').length;
            status.textContent = `Done — ${ok} imported`
                + (dup ? `, ${dup} already archived` : '')
                + (pdf ? `, ${pdf} PDF skipped` : '')
                + (failed ? `, ${failed} failed` : '')
                + (caseEntityId ? ' · added to case' : '')
                + (parked ? ` · suggestions parked for ${parked} page${parked === 1 ? '' : 's'} — open each in the reader to review` : '')
                + '.';
            if (typeof onDone === 'function') onDone();
        } catch (err) {
            Utils.error('URL import failed', err);
            status.textContent = `Import failed: ${(err && err.message) || err}`;
        } finally {
            running = false;
            refresh();
        }
    });
}

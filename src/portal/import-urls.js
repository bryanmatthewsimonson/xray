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

const STATUS_LABEL = {
    'imported':         '✓ imported',
    'thin':             '✓ imported (thin — possible paywall/abstract)',
    'already-archived': '✓ already archived',
    'pdf':              '↷ PDF — open via the reader',
    'failed':           '✗ failed'
};

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
    panel.appendChild(actions);
    panel.appendChild(status);
    panel.appendChild(rowsHost);

    let urls = [];
    let running = false;

    const refresh = () => {
        urls = parseUrlList(textarea.value);
        preview.textContent = urls.length
            ? `${urls.length} URL${urls.length === 1 ? '' : 's'} detected`
            : '';
        importBtn.disabled = running || urls.length === 0;
    };
    textarea.addEventListener('input', refresh);

    importBtn.addEventListener('click', async () => {
        if (running || urls.length === 0) return;
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
        try {
            const rows = await importUrlList(urls, {
                caseEntityId,
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
                + (caseEntityId ? ' · added to case' : '') + '.';
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

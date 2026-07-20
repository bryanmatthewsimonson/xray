// Transcript import panel — Phase 21.2. Paste or upload a podcast
// transcript, preview the detected format/turns/speakers, and import it
// as an ordinary archive record — which then joins cases (20.2) and
// feeds corpus synthesis (20.4) untouched. Two mounts (library header +
// case view) share this one implementation; the case mount also tags
// the imported record into the case. The source-manager.js idiom: el()
// builders, self-managed lifecycle, no innerHTML.

import { el } from './dom.js';
import { Utils } from '../shared/utils.js';
import { saveArticle } from '../shared/archive-cache.js';
import { addArticlesToCase } from '../shared/case-membership.js';
import { parseTranscript, describeTranscriptParse } from '../shared/transcript-parse.js';
import {
    buildTranscriptArticle, syntheticTranscriptUrl, computeTranscriptArticleHash
} from '../shared/transcript-article.js';

function labelField(labelText, input, hint) {
    const wrap = el('label', 'xr-import__field');
    wrap.appendChild(el('span', 'xr-import__label', labelText));
    wrap.appendChild(input);
    if (hint) wrap.appendChild(el('span', 'xr-import__hint', hint));
    return wrap;
}

function textInput(placeholder) {
    const i = el('input', 'xr-import__input');
    i.type = 'text';
    i.spellcheck = false;
    if (placeholder) i.placeholder = placeholder;
    return i;
}

function isHttpUrl(v) {
    try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; }
    catch (_) { return false; }
}

/**
 * @param {HTMLElement} host
 * @param {object} opts
 * @param {string|null} [opts.caseEntityId]  when set, the import is also tagged into this case
 * @param {function}   [opts.onDone]         called after a successful import (case view reloads)
 */
export function mountTranscriptImport(host, { caseEntityId = null, onDone } = {}) {
    const panel = el('div', 'xr-import');
    host.appendChild(panel);

    panel.appendChild(el('h4', 'xr-case__heading', 'Import a podcast transcript'));

    const textarea = el('textarea', 'xr-import__text');
    textarea.placeholder = 'Paste a transcript — SRT, WebVTT, or "Speaker: text" lines…';
    textarea.rows = 8;

    // Upload → read into the textarea (one parse path; user can trim).
    const fileInput = el('input');
    fileInput.type = 'file';
    fileInput.accept = '.txt,.srt,.vtt,text/plain,text/vtt';
    fileInput.style.display = 'none';
    const uploadBtn = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Upload .txt / .srt / .vtt');
    uploadBtn.type = 'button';
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!file) return;
        try { textarea.value = await file.text(); schedulePreview(); }
        catch (err) { Utils.error('Transcript upload read failed', err); }
    });

    const preview = el('div', 'xr-import__preview');

    // Metadata fields.
    const titleI = textInput('Episode title (required)');
    const urlI = textInput('https://… (optional)');
    const showI = textInput('Podcast / show name');
    const hostI = textInput('Host or guest byline');
    const dateI = textInput('YYYY-MM-DD');
    const feedGuidI = textInput('podcast:guid feed GUID');
    const epGuidI = textInput('episode GUID');
    const feedUrlI = textInput('RSS feed URL');
    const itunesI = textInput('iTunes / Apple collection ID');

    const fields = el('div', 'xr-import__fields');
    fields.appendChild(labelField('Title *', titleI));
    fields.appendChild(labelField('Episode URL', urlI, 'Blank → a local file:///imported/… id you can edit in the reader.'));
    fields.appendChild(labelField('Show', showI));
    fields.appendChild(labelField('Host', hostI));
    fields.appendChild(labelField('Published', dateI));

    const idsWrap = el('details', 'xr-import__ids');
    idsWrap.appendChild(el('summary', null, 'Podcast IDs (optional)'));
    idsWrap.appendChild(labelField('Feed GUID', feedGuidI));
    idsWrap.appendChild(labelField('Episode GUID', epGuidI));
    idsWrap.appendChild(labelField('Feed URL', feedUrlI));
    idsWrap.appendChild(labelField('iTunes ID', itunesI));

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

    panel.appendChild(textarea);
    panel.appendChild(uploadBtn);
    panel.appendChild(fileInput);
    panel.appendChild(preview);
    panel.appendChild(fields);
    panel.appendChild(idsWrap);
    panel.appendChild(actions);
    panel.appendChild(status);

    let lastParse = null;

    const refresh = () => {
        const hasTitle = titleI.value.trim().length > 0;
        const hasTurns = !!(lastParse && lastParse.turns.length > 0);
        const urlOk = !urlI.value.trim() || isHttpUrl(urlI.value.trim());
        const feedOk = !feedUrlI.value.trim() || isHttpUrl(feedUrlI.value.trim());
        importBtn.disabled = !(hasTitle && hasTurns && urlOk && feedOk);
    };

    let previewTimer = null;
    const schedulePreview = () => {
        if (previewTimer) clearTimeout(previewTimer);
        previewTimer = setTimeout(() => {
            const text = textarea.value;
            if (!text.trim()) { preview.replaceChildren(); lastParse = null; refresh(); return; }
            lastParse = parseTranscript(text);
            preview.replaceChildren();
            preview.appendChild(el('div', 'xr-import__detected', describeTranscriptParse(lastParse)));
            for (const w of lastParse.warnings) preview.appendChild(el('div', 'xr-import__warn', `⚠ ${w}`));
            refresh();
        }, 300);
    };

    textarea.addEventListener('input', schedulePreview);
    titleI.addEventListener('input', refresh);
    urlI.addEventListener('input', refresh);
    feedUrlI.addEventListener('input', refresh);

    importBtn.addEventListener('click', async () => {
        if (!lastParse) return;
        importBtn.disabled = true;
        try {
            const rawText = textarea.value;
            const dateVal = dateI.value.trim();
            let publishedAt = null;
            if (dateVal) { const d = new Date(dateVal); if (!isNaN(d.getTime())) publishedAt = Math.floor(d.getTime() / 1000); }
            const url = urlI.value.trim() || await syntheticTranscriptUrl(rawText, titleI.value.trim());
            const meta = {
                title: titleI.value.trim(), url, show: showI.value.trim(), byline: hostI.value.trim(),
                publishedAt, feedGuid: feedGuidI.value.trim(), episodeGuid: epGuidI.value.trim(),
                feedUrl: feedUrlI.value.trim(), itunesId: itunesI.value.trim()
            };
            const article = buildTranscriptArticle({
                turns: lastParse.turns, speakers: lastParse.speakers, format: lastParse.format, meta
            });

            // Direct-save-first (the race, resolved): the reader archives
            // asynchronously in a new tab, so tag-after-open would race an
            // absent row. Save here with the precomputed hash so the row —
            // and its case membership — exist immediately; the reader's
            // adopt-save re-saves the identical hash (no false stealth-edit)
            // and merges the case ref forward.
            article._articleHash = await computeTranscriptArticleHash(article);
            await saveArticle({ article, source: 'capture' });
            if (caseEntityId) await addArticlesToCase(caseEntityId, [article.url]);

            const id = crypto.randomUUID();
            chrome.runtime.sendMessage({ type: 'xray:reader:open', id, article, readOnly: false }, (resp) => {
                if (!resp || !resp.ok) Utils.error('Transcript import: reader open failed', resp && resp.error);
            });

            status.textContent = 'Imported' + (caseEntityId ? ' · added to case' : '') + ' · opened in the reader.';
            if (typeof onDone === 'function') onDone();
        } catch (err) {
            Utils.error('Transcript import failed', err);
            status.textContent = `Import failed: ${err.message || err}`;
            refresh();
        }
    });
}

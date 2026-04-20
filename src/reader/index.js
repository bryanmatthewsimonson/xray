// X-Ray Reader — extension-page article capture UI.
// Replaces the v1 in-panel capture with a real browser page.
//
// Flow:
//   1. Content script extracted an article and stashed it via
//      chrome.storage.session keyed by a UUID.
//   2. Content script opened this page with ?id=<uuid> on the URL.
//   3. This script pulls the article, renders it, owns the editor state.
//   4. On publish, sends a message to the background service worker
//      with the unsigned event. (Publish wiring lands in the next
//      commit; for now the button shows an "about to publish" toast.)

import { ContentExtractor } from '../shared/content-extractor.js';
import { EventBuilder } from '../shared/event-builder.js';

const browserApi = typeof browser !== 'undefined' && browser.runtime ? browser : chrome;

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------

const state = {
    id: null,            // session-storage id for this article
    article: null,       // the article object as extracted
    viewMode: 'reader',  // 'reader' | 'markdown' | 'preview'
    // Working copies. Reader mode edits `htmlDraft`. Markdown mode edits
    // `markdownDraft`. Whichever was last edited is the source of truth
    // on publish.
    htmlDraft: '',
    markdownDraft: '',
    dirtySource: 'reader' // which draft is canonical
};

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function $(sel, root = document) { return root.querySelector(sel); }

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function toast(message, type = 'success', timeoutMs = 3200) {
    const el = $('#xr-toast');
    el.textContent = message;
    el.className = 'xr-reader__toast xr-reader__toast--' + type;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, timeoutMs);
}

function fmtDate(tsSec) {
    if (!tsSec) return '';
    return new Date(tsSec * 1000).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
    });
}

function parseDate(str) {
    const t = Date.parse(str);
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

// ------------------------------------------------------------------
// Load article from session storage
// ------------------------------------------------------------------

async function loadArticle() {
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    if (!id) throw new Error('Missing ?id= parameter. Open the reader via the X-Ray FAB.');
    state.id = id;

    const key = 'xray:article:' + id;
    const stored = await new Promise((resolve) => {
        // chrome.storage.session is the natural home for one-shot article
        // hand-off between content script and extension page. Falls back
        // to storage.local if session isn't available (Firefox < 115
        // shipped session later than local).
        const area = browserApi.storage.session || browserApi.storage.local;
        area.get([key], (res) => resolve(res && res[key]));
    });
    if (!stored) {
        throw new Error('Article not found. The reader tab may have been reopened after the source tab was closed.');
    }

    state.article = stored;
    state.markdownDraft = stored.markdown || stored.content || '';
    state.htmlDraft = stored.content || ContentExtractor.markdownToHtml(state.markdownDraft);
}

// ------------------------------------------------------------------
// Render — READER mode
// ------------------------------------------------------------------

function renderReader() {
    const a = state.article;
    const main = $('#xr-main');
    main.innerHTML = `
      <article class="xr-article">
        <header class="xr-article__meta">
          <h1 class="xr-article__title" contenteditable="true" spellcheck="false" data-field="title">${escapeHtml(a.title || 'Untitled')}</h1>
          <div class="xr-article__byline-row">
            ${field('Author',      'byline',      a.byline)}
            ${field('Publication', 'siteName',    a.siteName)}
            ${field('Published',   'publishedAt', fmtDate(a.publishedAt))}
            ${field('URL',         'url',         a.url)}
          </div>
        </header>
        ${a.featuredImage ? `<img class="xr-article__featured" src="${escapeHtml(a.featuredImage)}" alt="" loading="lazy" />` : ''}
        <div class="xr-article__body" contenteditable="true" spellcheck="true" data-field="content"></div>
      </article>
    `;
    // Inject the stored HTML without re-escaping, since it came from
    // Readability which already sanitizes to a safe HTML fragment.
    $('.xr-article__body').innerHTML = state.htmlDraft;

    // Wire metadata-field edits back to the article object.
    main.querySelectorAll('[contenteditable]').forEach((el) => {
        el.addEventListener('input', onReaderFieldInput);
        el.addEventListener('blur', onReaderFieldBlur);
    });
}

function field(label, key, value) {
    return `
      <div class="xr-article__field">
        <span class="xr-article__field-label">${escapeHtml(label)}</span>
        <span class="xr-article__field-value" contenteditable="true" spellcheck="false" data-field="${key}">${escapeHtml(value || '')}</span>
      </div>`;
}

function onReaderFieldInput() {
    state.dirtySource = 'reader';
}

function onReaderFieldBlur(ev) {
    const key = ev.target.dataset.field;
    const val = ev.target.textContent.trim();
    switch (key) {
        case 'title':       state.article.title       = val; break;
        case 'byline':      state.article.byline      = val; break;
        case 'siteName':    state.article.siteName    = val; break;
        case 'url':         state.article.url         = val; break;
        case 'publishedAt': {
            const secs = parseDate(val);
            if (secs) state.article.publishedAt = secs;
            else {
                // Reset UI to the last-valid value
                ev.target.textContent = fmtDate(state.article.publishedAt);
                toast('Could not parse date — reverted', 'warning');
            }
            break;
        }
        case 'content': state.htmlDraft = $('.xr-article__body').innerHTML; break;
    }
}

// ------------------------------------------------------------------
// Render — MARKDOWN mode
// ------------------------------------------------------------------

function renderMarkdown() {
    // If the reader view is where we last edited, refresh the markdown
    // draft from the current HTML before handing off to the textarea.
    if (state.dirtySource === 'reader') {
        state.markdownDraft = ContentExtractor.htmlToMarkdown(state.htmlDraft);
    }
    const main = $('#xr-main');
    main.innerHTML = `
      <div class="xr-markdown-area">
        <textarea class="xr-markdown-area__textarea" id="xr-md" spellcheck="true">${escapeHtml(state.markdownDraft)}</textarea>
        <p class="xr-markdown-area__hint">
          This is the source that gets published to NOSTR as the kind-30023 event body.
          Switch to <strong>Preview</strong> to see how it will render.
        </p>
      </div>
    `;
    const ta = $('#xr-md');
    ta.addEventListener('input', () => {
        state.markdownDraft = ta.value;
        state.dirtySource = 'markdown';
    });
    ta.focus();
}

// ------------------------------------------------------------------
// Render — PREVIEW mode (HTML → MD → HTML roundtrip)
// ------------------------------------------------------------------

function renderPreview() {
    // Make sure markdownDraft is current.
    if (state.dirtySource === 'reader') {
        state.markdownDraft = ContentExtractor.htmlToMarkdown(state.htmlDraft);
    }
    const roundtripHtml = ContentExtractor.markdownToHtml(state.markdownDraft);
    const a = state.article;
    const main = $('#xr-main');
    main.innerHTML = `
      <article class="xr-article xr-preview">
        <div class="xr-preview__banner">
          <strong>Preview.</strong> This is the HTML → Markdown → HTML round-trip — exactly
          what NOSTR clients will render from your kind-30023 event body.
        </div>
        <header class="xr-article__meta">
          <h1 class="xr-article__title">${escapeHtml(a.title || 'Untitled')}</h1>
          <div class="xr-article__byline-row">
            ${previewField('Author',      a.byline)}
            ${previewField('Publication', a.siteName)}
            ${previewField('Published',   fmtDate(a.publishedAt))}
            ${previewField('URL',         a.url)}
          </div>
        </header>
        <div class="xr-article__body">${roundtripHtml}</div>
      </article>
    `;
}

function previewField(label, value) {
    if (!value) return '';
    return `
      <div class="xr-article__field">
        <span class="xr-article__field-label">${escapeHtml(label)}</span>
        <span>${escapeHtml(value)}</span>
      </div>`;
}

// ------------------------------------------------------------------
// View mode controller
// ------------------------------------------------------------------

function setViewMode(mode) {
    if (mode === state.viewMode) return;
    state.viewMode = mode;

    document.querySelectorAll('.xr-reader__mode-btn').forEach((btn) => {
        const active = btn.dataset.mode === mode;
        btn.classList.toggle('xr-reader__mode-btn--active', active);
        btn.setAttribute('aria-selected', String(active));
    });

    switch (mode) {
        case 'reader':   renderReader();   break;
        case 'markdown': renderMarkdown(); break;
        case 'preview':  renderPreview();  break;
    }
}

// ------------------------------------------------------------------
// Publish — C3 will wire this to the SW + relay client
// ------------------------------------------------------------------

async function publish() {
    const btn = $('#xr-publish');
    const originalLabel = btn.textContent;
    btn.disabled = true;

    try {
        // Collect the canonical content before building the event.
        if (state.dirtySource === 'reader') {
            state.markdownDraft = ContentExtractor.htmlToMarkdown(state.htmlDraft);
        }

        btn.textContent = 'Signing…';
        toast('Approving signature in your NOSTR extension…', 'warning');

        // Step 1: ask the source tab for its NIP-07 pubkey so we can
        // stamp the unsigned event correctly. The SW forwards this to
        // the content script which calls NIP07Client.getPublicKey().
        const pubResp = await browserApi.runtime.sendMessage({
            type: 'xray:capture:getPubkey',
            id: state.id
        });
        if (!pubResp || !pubResp.ok) {
            throw new Error((pubResp && pubResp.error) || 'Could not fetch signing public key');
        }
        const userPubkey = pubResp.pubkey;

        // Step 2: build the unsigned kind-30023 event.
        const article = { ...state.article, content: state.markdownDraft, markdown: state.markdownDraft };
        const unsigned = await EventBuilder.buildArticleEvent(article, [], userPubkey, []);

        // Step 3: ship it. The SW orchestrates sign (via source tab's
        // NIP-07 bridge) then publish (via its own relay pool).
        btn.textContent = 'Publishing…';
        const resp = await browserApi.runtime.sendMessage({
            type: 'xray:capture:publish',
            id: state.id,
            event: unsigned
        });
        if (!resp || !resp.ok) {
            throw new Error((resp && resp.error) || 'No response from background worker');
        }
        const r = resp.results;
        if (r.successful > 0) {
            toast(`Published to ${r.successful}/${r.total} relays.`, 'success', 5000);
        } else {
            toast('No relays accepted the event. Check the Options page.', 'error', 7000);
        }
    } catch (err) {
        console.error('[X-Ray Reader] publish failed:', err);
        toast('Publish failed: ' + (err.message || err), 'error', 7000);
    } finally {
        btn.textContent = originalLabel;
        btn.disabled = false;
    }
}

// ------------------------------------------------------------------
// Init
// ------------------------------------------------------------------

async function init() {
    try {
        await loadArticle();
    } catch (err) {
        console.error('[X-Ray Reader] Load failed:', err);
        $('#xr-main').innerHTML = `
          <div class="xr-reader__loading">
            <p><strong>Could not load the article.</strong></p>
            <p>${escapeHtml(err.message || String(err))}</p>
          </div>`;
        return;
    }

    renderReader();

    document.querySelectorAll('.xr-reader__mode-btn').forEach((btn) => {
        btn.addEventListener('click', () => setViewMode(btn.dataset.mode));
    });

    $('#xr-publish').addEventListener('click', () => {
        publish().catch((err) => {
            console.error('[X-Ray Reader] publish failed:', err);
            toast('Publish failed: ' + (err.message || err), 'error', 6000);
        });
    });

    $('#xr-close').addEventListener('click', () => {
        window.close();
    });
}

document.addEventListener('DOMContentLoaded', init);

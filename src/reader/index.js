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
    dirtySource: 'reader', // which draft is canonical
    // Platform comments — Substack today, YouTube/Twitter/etc. in later
    // phases. The tree is whatever the platform-specific fetcher returns
    // via `xray:substack:fetchComments` (or equivalent).
    comments: {
        platform: null,   // 'substack' | ...
        tree: [],
        total: 0,
        status: 'idle',   // 'idle' | 'loading' | 'ready' | 'error'
        error: null,
        includeInPublish: false
    }
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
// Comments (Substack — Phase 3a)
// ------------------------------------------------------------------

async function loadSubstackComments() {
    const sub = state.article.substack;
    if (!sub || !sub.postId || !sub.apiOrigin) return;

    state.comments.platform = 'substack';
    state.comments.status = 'loading';
    renderCommentsSection();

    try {
        const resp = await browserApi.runtime.sendMessage({
            type: 'xray:substack:fetchComments',
            apiOrigin: sub.apiOrigin,
            postId: sub.postId
        });
        if (!resp || !resp.ok) {
            throw new Error((resp && resp.error) || 'No response from service worker');
        }
        state.comments.tree = resp.comments || [];
        state.comments.total = resp.total || 0;
        state.comments.status = 'ready';
    } catch (err) {
        console.warn('[X-Ray Reader] Substack comments fetch failed:', err);
        state.comments.status = 'error';
        state.comments.error = err.message || String(err);
    }
    renderCommentsSection();
}

function renderCommentsSection() {
    const sec = $('#xr-comments');
    const body = $('#xr-comments-body');
    const title = $('#xr-comments-title');
    const includeChk = $('#xr-comments-include');
    const includeLabel = $('#xr-comments-include-label');

    if (!state.comments.platform) {
        sec.hidden = true;
        return;
    }
    sec.hidden = false;

    if (state.comments.status === 'loading') {
        title.textContent = 'Comments';
        body.innerHTML = `<div class="xr-comments__status">Loading comments…</div>`;
        includeChk.disabled = true;
        includeLabel.textContent = 'Include in publish';
        return;
    }
    if (state.comments.status === 'error') {
        title.textContent = 'Comments';
        body.innerHTML = `<div class="xr-comments__status xr-comments__status--error">Comment fetch failed: ${escapeHtml(state.comments.error)}</div>`;
        includeChk.disabled = true;
        return;
    }
    if (state.comments.tree.length === 0) {
        title.textContent = 'Comments (0)';
        body.innerHTML = `<div class="xr-comments__status">No comments on this post.</div>`;
        includeChk.disabled = true;
        return;
    }

    title.textContent = `Comments (${state.comments.total})`;
    body.innerHTML = renderCommentList(state.comments.tree);

    includeChk.disabled = false;
    includeChk.checked = state.comments.includeInPublish;
    includeLabel.textContent = `Include all ${state.comments.total} in publish (requires ${state.comments.total + 1} signatures)`;
}

function renderCommentList(list) {
    if (!list || list.length === 0) return '';
    return `<ol>${list.map(renderCommentItem).join('')}</ol>`;
}

function renderCommentItem(c) {
    const deletedCls = c.deleted ? ' xr-comment--deleted' : '';
    const handle = c.author.handle ? '@' + c.author.handle : '';
    const profileUrl = c.author.profileUrl || '#';
    const headerHtml = c.author.handle
        ? `<a class="xr-comment__handle" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener">${escapeHtml(handle)}</a>`
        : `<span class="xr-comment__handle">${escapeHtml(c.author.name || 'Unknown')}</span>`;

    const nameHtml = c.author.name && c.author.name !== c.author.handle
        ? `<span class="xr-comment__name">${escapeHtml(c.author.name)}</span>`
        : '';

    const dateHtml = c.date
        ? `<time class="xr-comment__date" datetime="${escapeHtml(c.date)}">${escapeHtml(fmtCommentDate(c.date))}</time>`
        : '';

    const avatarHtml = c.author.avatarUrl
        ? `<img class="xr-comment__avatar" src="${escapeHtml(c.author.avatarUrl)}" alt="" loading="lazy">`
        : `<span class="xr-comment__avatar"></span>`;

    const body = c.deleted
        ? `<em>(comment deleted or flagged)</em>`
        : escapeHtml(c.body || '').replace(/\n/g, '<br>');

    const meta = [];
    if (c.reactionCount > 0) meta.push(`❤ ${c.reactionCount}`);
    if (c.restacks > 0)      meta.push(`⟲ ${c.restacks} restack${c.restacks === 1 ? '' : 's'}`);
    const metaHtml = meta.length ? `<footer class="xr-comment__meta">${meta.map(escapeHtml).join(' · ')}</footer>` : '';

    const childrenHtml = c.children && c.children.length ? renderCommentList(c.children) : '';

    return `
      <li class="xr-comment${deletedCls}" data-comment-id="${escapeHtml(String(c.id))}">
        <header class="xr-comment__header">
          ${avatarHtml}
          ${headerHtml}
          ${nameHtml}
          ${dateHtml}
        </header>
        <div class="xr-comment__body">${body}</div>
        ${metaHtml}
        ${childrenHtml}
      </li>`;
}

function fmtCommentDate(iso) {
    try {
        const d = new Date(iso);
        return d.toLocaleString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit'
        });
    } catch { return iso; }
}

// ------------------------------------------------------------------
// Publish — C3 full flow
// ------------------------------------------------------------------

async function publish() {
    const btn = $('#xr-publish');
    const originalLabel = btn.textContent;
    btn.disabled = true;

    const includeComments = state.comments.includeInPublish && state.comments.tree.length > 0;
    const commentList = includeComments ? flattenCommentTree(state.comments.tree) : [];
    const totalEvents = 1 + commentList.length;

    try {
        if (state.dirtySource === 'reader') {
            state.markdownDraft = ContentExtractor.htmlToMarkdown(state.htmlDraft);
        }

        btn.textContent = 'Signing…';
        toast(totalEvents > 1
            ? `Signing ${totalEvents} events — approve each in your NOSTR extension.`
            : 'Approving signature in your NOSTR extension…', 'warning');

        // Resolve the signing pubkey once.
        const pubResp = await browserApi.runtime.sendMessage({
            type: 'xray:capture:getPubkey',
            id: state.id
        });
        if (!pubResp || !pubResp.ok) {
            throw new Error((pubResp && pubResp.error) || 'Could not fetch signing public key');
        }
        const userPubkey = pubResp.pubkey;

        // Article event.
        const article = { ...state.article, content: state.markdownDraft, markdown: state.markdownDraft };
        const unsignedArticle = await EventBuilder.buildArticleEvent(article, [], userPubkey, []);

        btn.textContent = totalEvents > 1 ? `Publishing article (1/${totalEvents})…` : 'Publishing…';
        const articleResp = await browserApi.runtime.sendMessage({
            type: 'xray:capture:publish',
            id: state.id,
            event: unsignedArticle
        });
        if (!articleResp || !articleResp.ok) {
            throw new Error((articleResp && articleResp.error) || 'No response from background worker');
        }
        const articleResults = articleResp.results;

        // Comment events — only if the user opted in.
        const commentResults = { ok: 0, fail: 0, errors: [] };
        if (includeComments) {
            const articleUrl = article.url;
            const articleTitle = article.title || 'Untitled';

            // Map Substack comment id → the `d`-tag value we use on NOSTR,
            // so children can reference parents that were published earlier
            // in this same run.
            const idToDTag = new Map();

            for (let i = 0; i < commentList.length; i++) {
                const c = commentList[i];
                btn.textContent = `Publishing comments (${i + 2}/${totalEvents})…`;

                if (c.deleted || !c.body) continue;

                const dTag = makeCommentDTag(state.comments.platform, c.id);
                idToDTag.set(c.id, dTag);

                const replyTo = c.parentId != null ? idToDTag.get(c.parentId) : null;
                const unsignedComment = EventBuilder.buildCommentEvent({
                    id:            dTag,
                    text:          c.body,
                    authorName:    c.author.name,
                    authorHandle:  c.author.handle,
                    authorUrl:     c.author.profileUrl,
                    platform:      state.comments.platform,
                    timestamp:     c.date ? Date.parse(c.date) : null, // ms
                    replyTo,
                    reactionCount: c.reactionCount,
                    restacks:      c.restacks
                }, articleUrl, articleTitle, userPubkey);

                try {
                    const resp = await browserApi.runtime.sendMessage({
                        type: 'xray:capture:publish',
                        id: state.id,
                        event: unsignedComment
                    });
                    if (resp && resp.ok && resp.results.successful > 0) {
                        commentResults.ok++;
                    } else {
                        commentResults.fail++;
                        commentResults.errors.push((resp && resp.error) || 'unknown');
                    }
                } catch (err) {
                    commentResults.fail++;
                    commentResults.errors.push(err.message || String(err));
                }
            }
        }

        // Surface an aggregated result.
        if (includeComments) {
            const msg = `Article: ${articleResults.successful}/${articleResults.total} relays. ` +
                        `Comments: ${commentResults.ok} published, ${commentResults.fail} failed.`;
            toast(msg, commentResults.fail === 0 ? 'success' : 'warning', 8000);
        } else {
            if (articleResults.successful > 0) {
                toast(`Published to ${articleResults.successful}/${articleResults.total} relays.`, 'success', 5000);
            } else {
                toast('No relays accepted the event. Check the Options page.', 'error', 7000);
            }
        }
    } catch (err) {
        console.error('[X-Ray Reader] publish failed:', err);
        toast('Publish failed: ' + (err.message || err), 'error', 7000);
    } finally {
        btn.textContent = originalLabel;
        btn.disabled = false;
    }
}

/**
 * Build a deterministic `d`-tag for a comment event. Using platform
 * namespacing protects against numeric-id collisions across platforms
 * (Substack and YouTube both use numeric ids; we don't want them to
 * alias to the same NOSTR event).
 */
function makeCommentDTag(platform, commentId) {
    return `cmt:${platform}:${String(commentId)}`;
}

/**
 * Depth-first flatten of the comment tree — parents precede children,
 * which guarantees `reply-to` references resolve during sequential
 * publishing.
 */
function flattenCommentTree(tree) {
    const out = [];
    const walk = (list) => {
        for (const c of list) {
            out.push(c);
            if (c.children && c.children.length) walk(c.children);
        }
    };
    walk(tree);
    return out;
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

    // Comments include-in-publish toggle
    $('#xr-comments-include').addEventListener('change', (ev) => {
        state.comments.includeInPublish = ev.target.checked;
    });

    // Kick off the platform-specific comment fetch, if any.
    // Non-blocking — the reader is already interactive.
    if (state.article.platform === 'substack') {
        loadSubstackComments().catch((err) => {
            console.warn('[X-Ray Reader] comment load errored out:', err);
        });
    }
}

document.addEventListener('DOMContentLoaded', init);

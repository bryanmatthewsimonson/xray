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

    // The SW stores `{ article, sourceTabId, createdAt }` — unwrap the
    // article payload. Tolerate the pre-v0.2.1 flat shape in case anyone
    // has a stale session record open from before this fix.
    const article = (stored && typeof stored === 'object' && stored.article)
        ? stored.article
        : stored;
    if (!article || typeof article !== 'object' || !article.title && !article.content) {
        throw new Error(
            'The stored article has no content. ' +
            'This likely means Readability could not extract a body from the source page. ' +
            'Try reloading the source tab and capturing again.'
        );
    }

    state.article = article;
    state.markdownDraft = article.markdown || article.content || '';
    state.htmlDraft = article.content || ContentExtractor.markdownToHtml(state.markdownDraft);
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

/**
 * Two-stage API load for Substack:
 *   1) /api/v1/posts/<slug>  — rich metadata + full body (paywall unlock
 *                               when the user has a Substack session)
 *   2) /api/v1/post/<id>/comments  — comment tree
 *
 * Runs non-blocking after the reader is already rendered from Readability.
 * Each stage is independent: if stage 1 fails we still have Readability's
 * content; if stage 2 fails we still have stage 1's metadata.
 */
async function loadSubstackData() {
    const sub = state.article.substack;
    if (!sub || !sub.slug || !sub.apiOrigin) return;

    state.comments.platform = 'substack';
    state.comments.status = 'loading';
    renderCommentsSection();

    // Stage 1: post metadata.
    let post = null;
    try {
        const resp = await browserApi.runtime.sendMessage({
            type: 'xray:substack:fetchPost',
            apiOrigin: sub.apiOrigin,
            slug:      sub.slug
        });
        if (resp && resp.ok && resp.post) {
            post = resp.post;
            mergeSubstackPost(post);
        } else {
            console.warn('[X-Ray Reader] Substack post fetch failed:', resp && resp.error);
        }
    } catch (err) {
        console.warn('[X-Ray Reader] Substack post fetch threw:', err);
    }

    // Stage 2: comments (only if stage 1 gave us a postId).
    const postId = state.article.substack.postId;
    if (!postId) {
        state.comments.status = 'error';
        state.comments.error = 'No post id — Substack post API fetch failed. Confirm you have a Substack session and try again.';
        renderCommentsSection();
        return;
    }

    try {
        const resp = await browserApi.runtime.sendMessage({
            type: 'xray:substack:fetchComments',
            apiOrigin: sub.apiOrigin,
            postId
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

/**
 * Merge Substack post-API fields onto the live article and re-render.
 * Readability produced an initial extraction; the API response is
 * authoritative for everything except user-edited fields. We treat
 * fields already touched by the user (dirtySource === 'reader' or
 * 'markdown') as preserved — the merge only fills gaps.
 */
function mergeSubstackPost(post) {
    const a = state.article;

    // Always-on routing-ish fields.
    a.substack.postId        = post.id;
    a.substack.publicationId = post.publicationId;
    a.substack.sectionId     = post.sectionId;
    a.substack.audience      = post.audience;
    a.substack.type          = post.type;
    a.substack.wordcount     = post.wordcount;
    a.substack.subtitle      = post.subtitle;
    a.substack.postTags      = post.postTags;
    a.substack.podcast       = post.podcast;
    a.substack.hasVoiceover  = post.hasVoiceover;
    a.substack.audioItems    = post.audioItems;
    a.substack.allBylines    = post.allBylines;
    a.substack._raw          = post._raw;

    // Fields where the API is authoritative. Only override if the user
    // hasn't touched that view yet AND the API's value is non-empty.
    const userEditedReader   = state.dirtySource !== 'reader'   ? false : isReaderDirty();
    const userEditedMarkdown = state.dirtySource !== 'markdown' ? false : true;

    if (!userEditedReader && !userEditedMarkdown) {
        if (post.title)        a.title       = post.title;
        if (post.byline?.name) a.byline      = post.byline.name;
        if (post.coverImage)   a.featuredImage = post.coverImage;
        if (post.postDate)     a.publishedAt = Math.floor(Date.parse(post.postDate) / 1000);

        // Body replacement only if the API body is non-empty AND longer
        // than what Readability got (the "paywall unlock" case).
        if (post.bodyHtml && (!a.content || post.bodyHtml.length > a.content.length * 1.05)) {
            a.content = post.bodyHtml;
            state.htmlDraft = post.bodyHtml;
            state.markdownDraft = ContentExtractor.htmlToMarkdown(post.bodyHtml);
        }
    }

    // Authoritative engagement + publication regardless of edit state.
    a.engagement = {
        likes:    post.reactionCount,
        restacks: post.restacks,
        comments: post.commentCount
    };
    a.siteName = resolveSiteName(post, a.siteName);

    // Re-render whatever view the user is in, so the new data shows up.
    switch (state.viewMode) {
        case 'reader':   renderReader();   break;
        case 'markdown': renderMarkdown(); break;
        case 'preview':  renderPreview();  break;
    }
}

function isReaderDirty() {
    // We haven't tracked fine-grained edit state yet — treat the reader
    // as "not edited" unless the user made markdown-mode changes. A
    // better signal (onInput diffing) comes in a future commit.
    return false;
}

function resolveSiteName(post, currentSiteName) {
    // Prefer Readability's siteName if it's a real publication name (not
    // just the domain). Otherwise fall back to the first byline's
    // handle-based publication (e.g. "The Free Press" if configured on
    // the Substack publication record).
    if (currentSiteName && !currentSiteName.match(/\.(com|org|net|blog|io)$/i)) {
        return currentSiteName;
    }
    // Substack's post API doesn't give us the publication name directly
    // here; the raw payload has it nested via sectionPins or postTheme
    // but those paths are fragile. Keep current or let the caller
    // supply og:site_name from elsewhere.
    return currentSiteName;
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

// Inter-event delay when publishing a batch. Some relays rate-limit
// bursty writes (nostr.oxtr.dev in particular); a small pause keeps
// them happy without meaningfully slowing the batch.
const BATCH_PUBLISH_DELAY_MS = 200;

async function publish() {
    const btn = $('#xr-publish');
    const originalLabel = btn.textContent;
    btn.disabled = true;

    const includeComments = state.comments.includeInPublish && state.comments.tree.length > 0;
    const commentList = includeComments ? flattenCommentTree(state.comments.tree) : [];
    const totalEvents = 1 + commentList.length;

    // Per-relay rollup across the entire batch.
    const relayStats = new Map(); // url → { ok, fail, lastError }
    const recordRelayResults = (results) => {
        if (!results || !Array.isArray(results.results)) return;
        for (const r of results.results) {
            const stat = relayStats.get(r.url) || { ok: 0, fail: 0, lastError: null };
            if (r.success) stat.ok++;
            else          { stat.fail++; if (r.error) stat.lastError = r.error; }
            relayStats.set(r.url, stat);
        }
    };

    const setProgress = (current, total) => {
        const bar = $('#xr-progress-bar');
        const wrap = $('#xr-progress');
        if (!bar || !wrap) return;
        wrap.hidden = total <= 1;
        bar.style.width = total > 0 ? `${Math.min(100, (current / total) * 100)}%` : '0%';
    };

    try {
        if (state.dirtySource === 'reader') {
            state.markdownDraft = ContentExtractor.htmlToMarkdown(state.htmlDraft);
        }

        btn.textContent = 'Signing…';
        toast(totalEvents > 1
            ? `Publishing ${totalEvents} events (article + ${commentList.length} comments)…`
            : 'Approving signature in your NOSTR extension…', 'warning', 5000);

        setProgress(0, totalEvents);

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

        btn.textContent = totalEvents > 1 ? `Publishing (1/${totalEvents})…` : 'Publishing…';
        const articleResp = await browserApi.runtime.sendMessage({
            type: 'xray:capture:publish',
            id: state.id,
            event: unsignedArticle
        });
        if (!articleResp || !articleResp.ok) {
            throw new Error((articleResp && articleResp.error) || 'No response from background worker');
        }
        recordRelayResults(articleResp.results);
        const articleResults = articleResp.results;
        setProgress(1, totalEvents);

        // Comment events — only if the user opted in.
        const commentResults = { ok: 0, fail: 0, skipped: 0, errors: [] };
        if (includeComments) {
            const articleUrl = article.url;
            const articleTitle = article.title || 'Untitled';

            // Map comment id → its `d`-tag so replies can reference
            // parents that were just published in this run.
            const idToDTag = new Map();

            for (let i = 0; i < commentList.length; i++) {
                const c = commentList[i];

                if (c.deleted || !c.body) { commentResults.skipped++; continue; }

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

                btn.textContent = `Publishing (${i + 2}/${totalEvents})…`;

                try {
                    const resp = await browserApi.runtime.sendMessage({
                        type: 'xray:capture:publish',
                        id: state.id,
                        event: unsignedComment
                    });
                    if (resp && resp.ok && resp.results) {
                        recordRelayResults(resp.results);
                        if (resp.results.successful > 0) {
                            commentResults.ok++;
                        } else {
                            commentResults.fail++;
                        }
                    } else {
                        commentResults.fail++;
                        commentResults.errors.push((resp && resp.error) || 'unknown');
                    }
                } catch (err) {
                    commentResults.fail++;
                    commentResults.errors.push(err.message || String(err));
                }

                setProgress(i + 2, totalEvents);

                // Pause briefly between events — keeps bursty-unfriendly
                // relays like nostr.oxtr.dev from rate-limiting our writes.
                if (i < commentList.length - 1) {
                    await sleep(BATCH_PUBLISH_DELAY_MS);
                }
            }
        }

        // Build + surface the end-of-batch summary.
        showPublishSummary({
            includeComments,
            totalEvents,
            articleResults,
            commentResults,
            relayStats
        });
    } catch (err) {
        console.error('[X-Ray Reader] publish failed:', err);
        toast('Publish failed: ' + (err.message || err), 'error', 7000);
    } finally {
        btn.textContent = originalLabel;
        btn.disabled = false;
        // Leave the progress bar at 100% briefly so the user sees completion.
        setTimeout(() => { const w = $('#xr-progress'); if (w) w.hidden = true; }, 1200);
    }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Compose a per-relay rollup toast and log a detailed breakdown to the
 * console. Consistently-failing relays are called out by name so the
 * user knows which ones to consider removing.
 */
function showPublishSummary({ includeComments, totalEvents, articleResults, commentResults, relayStats }) {
    // Console breakdown (always useful for debugging)
    console.group('[X-Ray Reader] publish summary');
    console.log('total events:', totalEvents);
    if (includeComments) {
        console.log('comments:', commentResults);
    }
    console.log('per relay:', Object.fromEntries(relayStats));
    console.groupEnd();

    // Identify dead relays — ones that rejected 100% of our events.
    const dead = [];
    for (const [url, s] of relayStats) {
        if (s.ok === 0 && s.fail > 0) dead.push({ url, fail: s.fail, reason: s.lastError });
    }

    // Primary line.
    const landed = totalEvents - (commentResults.fail || 0) - (articleResults.successful === 0 ? 1 : 0);
    let line = includeComments
        ? `Published article + ${commentResults.ok}/${commentResults.ok + commentResults.fail} comments.`
        : (articleResults.successful > 0
            ? `Published to ${articleResults.successful}/${articleResults.total} relays.`
            : 'No relays accepted the event.');

    // Per-relay aggregate: "N relays accepted all events, M relays failed".
    const acceptedAll = [...relayStats.values()].filter((s) => s.fail === 0 && s.ok > 0).length;
    const anyFail    = [...relayStats.values()].filter((s) => s.fail > 0).length;
    if (relayStats.size > 0) {
        line += ` ${acceptedAll}/${relayStats.size} relays accepted everything.`;
    }

    // Call out consistently-failing relays with a hint to remove them.
    if (dead.length > 0) {
        const names = dead.map((d) => d.url.replace(/^wss?:\/\//, '')).join(', ');
        line += ` Rejected by ${names} — consider removing in Options.`;
    }

    const level = (dead.length > 0 || commentResults.fail > 0 || articleResults.successful === 0)
        ? (articleResults.successful > 0 ? 'warning' : 'error')
        : 'success';
    toast(line, level, 9000);
    return landed;
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

    // Kick off the platform-specific data fetch, if any.
    // Non-blocking — the reader is already interactive.
    if (state.article.platform === 'substack') {
        loadSubstackData().catch((err) => {
            console.warn('[X-Ray Reader] Substack data load errored out:', err);
        });
    }
}

document.addEventListener('DOMContentLoaded', init);

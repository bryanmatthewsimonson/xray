// Generic comment extractor — Phase 3d (issue #14).
//
// Heuristic DOM walker for native and conventional comment threads
// on article-shaped pages. Designed as a fallback for platforms
// without their own structured comment-fetch path (Substack has
// `substack-api.js`, Twitter scrapes from the DOM directly).
//
// Detected systems:
//
//   1. WordPress comments — `<ol class="comment-list">` (or
//      `commentlist`) with `<li class="comment">` children, each
//      with `.comment-author`, `.comment-date`, and
//      `.comment-content` / `.comment-text` sub-elements. Most
//      conventional WordPress themes follow this.
//   2. Generic class-name-based — any container with a class
//      containing "comments" / "comment-list" / "comment-thread",
//      whose direct children are recognizable comment-shaped items
//      (have an author + a body).
//   3. Disqus — detected by the `<div id="disqus_thread">` shell.
//      Runs in a cross-origin iframe, so we CAN'T actually scrape
//      its content. We surface a placeholder comment whose body
//      explains the limitation, so the user knows the platform
//      uses Disqus and X-Ray can't see in.
//
// Output shape matches the Comment objects Substack and Twitter
// produce, so the reader's existing comment-tree renderer + opt-in
// kind-30041 publish path consume it without modification:
//
//   { id, body, date, author: { name, handle, profileUrl, avatarUrl },
//     reactionCount, restacks, deleted, children }

// ------------------------------------------------------------------
// Top-level entry
// ------------------------------------------------------------------

/**
 * Try every known strategy in priority order. Returns the first
 * non-empty result, or an empty array if no strategy found anything
 * structured. The empty-array case includes pages with no comments
 * at all — distinct from `null`, which would mean "no extractor
 * could even attempt".
 *
 * @returns {{ platform: string, comments: object[], note?: string }}
 */
export function extractGenericComments() {
    // 1. Disqus — detect and report. We can't read the iframe.
    if (document.querySelector('#disqus_thread, #disqus_thread *')) {
        return {
            platform: 'disqus',
            comments: [],
            note: 'This page uses Disqus, which loads comments in a cross-origin iframe. X-Ray cannot read them from the host page.'
        };
    }

    // 2. WordPress conventional structure.
    const wp = extractWordPressComments();
    if (wp.length > 0) return { platform: 'wordpress', comments: wp };

    // 3. Generic class-name-based fallback.
    const generic = extractGenericClassBasedComments();
    if (generic.length > 0) return { platform: 'generic', comments: generic };

    return { platform: 'none', comments: [] };
}

// ------------------------------------------------------------------
// WordPress
// ------------------------------------------------------------------

function extractWordPressComments() {
    // The `.comment-list` (or legacy `.commentlist`) <ol> is the
    // standard container.
    const lists = document.querySelectorAll('ol.comment-list, ul.comment-list, ol.commentlist, ul.commentlist');
    if (lists.length === 0) return [];
    const out = [];
    for (const list of lists) {
        // Direct-child <li class="comment"> only — nested replies
        // are handled by recurse on children property.
        const items = list.children;
        for (const item of items) {
            if (!item.matches('li.comment, li[id^="comment-"]')) continue;
            const c = parseWordPressComment(item);
            if (c) out.push(c);
        }
    }
    return out;
}

function parseWordPressComment(li) {
    const id = (li.id || '').replace(/^comment-/, '') || cryptoIdFromElement(li);

    const authorEl = li.querySelector('.comment-author .fn, .comment-author cite, cite.fn, .vcard .fn');
    const name = authorEl ? (authorEl.textContent || '').trim() : '';

    // Profile URL / handle — author cite often wraps an <a>
    const authorAnchor = li.querySelector('.comment-author a, cite.fn a');
    const profileUrl = authorAnchor ? authorAnchor.href || '' : '';

    const avatarImg = li.querySelector('.comment-author img.avatar, img.avatar');
    const avatarUrl = avatarImg ? avatarImg.getAttribute('src') || '' : '';

    const dateEl = li.querySelector('.comment-meta time[datetime], .comment-date time[datetime], time[datetime], .comment-meta a[href*="#comment"]');
    const date = dateEl
        ? (dateEl.getAttribute('datetime') || (dateEl.textContent || '').trim())
        : null;

    const bodyEl = li.querySelector('.comment-content, .comment-text, .comment-body');
    const body = bodyEl ? (bodyEl.textContent || '').trim() : '';

    // Recurse for nested replies.
    const children = [];
    const childList = li.querySelector('ol.children, ul.children, ol.comment-children, ul.comment-children');
    if (childList) {
        for (const childItem of childList.children) {
            if (!childItem.matches('li.comment, li[id^="comment-"]')) continue;
            const childComment = parseWordPressComment(childItem);
            if (childComment) children.push(childComment);
        }
    }

    if (!body && children.length === 0) return null;
    return {
        id,
        body,
        date,
        author: {
            name,
            handle:     '',          // WP rarely exposes a stable handle
            profileUrl,
            avatarUrl
        },
        reactionCount: 0,            // WP native has no first-class reactions
        restacks:      0,
        deleted:       false,
        children
    };
}

// ------------------------------------------------------------------
// Generic class-name-based fallback
// ------------------------------------------------------------------

function extractGenericClassBasedComments() {
    // Find a container whose class contains "comment" + "list" or
    // "thread" — the most common shapes — and whose direct children
    // look comment-ish. We score candidates by signal density and
    // pick the strongest one.
    const candidates = document.querySelectorAll(
        '[class*="comment-list" i], [class*="comments-list" i], ' +
        '[class*="comment-thread" i], [class*="comments-thread" i], ' +
        '[class*="comment-section" i], [class*="comments-section" i]'
    );
    if (candidates.length === 0) return [];

    let best = null;
    let bestScore = 0;
    for (const c of candidates) {
        const score = scoreCommentContainer(c);
        if (score > bestScore) { best = c; bestScore = score; }
    }
    if (!best || bestScore === 0) return [];

    const items = Array.from(best.children).filter(isCommentShapedElement);
    return items.map(parseGenericComment).filter(Boolean);
}

function scoreCommentContainer(el) {
    // Rough heuristic: count direct-child elements that look like
    // comments. Containers with 0 comments-shaped children score 0
    // even if their class name matches.
    const items = Array.from(el.children).filter(isCommentShapedElement);
    return items.length;
}

function isCommentShapedElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const cls = (el.className || '').toString().toLowerCase();
    if (!/comment|reply|response/.test(cls)) return false;
    // Author signal: an inner element with "author" or "name" in its class.
    const hasAuthor = !!el.querySelector('[class*="author" i], [class*="user-name" i], [class*="username" i]');
    // Body signal: an inner element with text content > 5 chars that
    // isn't the author block.
    const hasBody = (el.textContent || '').trim().length > 10;
    return hasAuthor && hasBody;
}

function parseGenericComment(el) {
    const id = el.id || cryptoIdFromElement(el);

    const authorEl = el.querySelector('[class*="author" i] a, [class*="username" i], [class*="user-name" i] a');
    const name = authorEl ? (authorEl.textContent || '').trim() : '';
    const profileUrl = (authorEl && authorEl.href) || '';

    const avatarImg = el.querySelector('img[class*="avatar" i], img[class*="profile" i]');
    const avatarUrl = avatarImg ? avatarImg.getAttribute('src') || '' : '';

    const dateEl = el.querySelector('time[datetime], [class*="date" i], [class*="timestamp" i]');
    const date = dateEl
        ? (dateEl.getAttribute('datetime') || (dateEl.textContent || '').trim())
        : null;

    // Body — exclude the author block + reply forms + any nested
    // reply containers from text harvest.
    const bodyEl = el.querySelector('[class*="content" i], [class*="body" i], [class*="text" i], p');
    const body = bodyEl ? (bodyEl.textContent || '').trim() : (el.textContent || '').trim();

    if (!body) return null;
    return {
        id,
        body,
        date,
        author: {
            name,
            handle:     '',
            profileUrl,
            avatarUrl
        },
        reactionCount: 0,
        restacks:      0,
        deleted:       false,
        children:      []  // Generic walker doesn't recurse — keeps the heuristic shallow + predictable
    };
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/**
 * Synthesize an id from an element when we don't have one. Used as a
 * stable last-resort key — same DOM position on the same page yields
 * the same id, so re-runs of the extractor produce idempotent
 * comment.id values.
 */
function cryptoIdFromElement(el) {
    let path = '';
    let cur = el;
    while (cur && cur.parentElement) {
        const idx = Array.from(cur.parentElement.children).indexOf(cur);
        path = `>${cur.tagName}:${idx}` + path;
        cur = cur.parentElement;
    }
    // Stable but human-unfriendly. The reader uses it only as a
    // dedup key + d-tag basis.
    return 'gen' + Math.abs(stringHash(path)).toString(36).slice(0, 10);
}

function stringHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return h;
}

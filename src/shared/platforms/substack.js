// Substack platform handler — article-level enrichment.
//
// Runs in the content script (needs DOM access for selector queries
// + access to the `post_id` that Substack embeds in preloaded state).
// Called by UI.openReader *after* ContentExtractor.extractArticle so we
// get Readability's clean output and can enrich rather than compete.
//
// Scope of this module (Tier 1): publication name, author bio,
// engagement counts, author handle, post ID, canonical API origin.
//
// Comment fetching (Tier 2) lives in `./substack-comments.js` and runs
// in the background service worker to bypass CORS. The reader page is
// what actually consumes + renders comments.
//
// See docs: https://github.com/bryanmatthewsimonson/xray/issues/14
// and the Substack investigation report in conversation #2026-04-20.

// ------------------------------------------------------------------
// Detection
// ------------------------------------------------------------------

export function isSubstackPage() {
    const host = window.location.hostname;
    // .substack.com subdomain is unambiguous.
    if (host.endsWith('.substack.com') || host === 'substack.com') return true;
    // Custom domains: sniff DOM signals. Substack publications on custom
    // domains still ship the same bundle + meta tags.
    if (document.querySelector('meta[name="generator"][content*="Substack"]')) return true;
    if (document.querySelector('link[rel="stylesheet"][href*="substackcdn.com"]')) return true;
    if (document.querySelector('script[src*="substackcdn.com"]')) return true;
    return false;
}

// ------------------------------------------------------------------
// Post ID + API origin extraction
// ------------------------------------------------------------------

/**
 * Substack embeds the current post's numeric id inside a preloaded-state
 * JSON blob. We scan the document's raw HTML for the first match — this
 * is stable across Substack's UI refactors because the preload shape is
 * what the client bundle consumes on hydration.
 *
 * @returns {number|null} the numeric post id, or null if not found.
 */
export function extractPostId() {
    // The blob has escaped quotes inside a <script>, so match on the
    // escaped form: "post_id":165417845
    const html = document.documentElement.outerHTML;
    const m = html.match(/"post_id"\s*:\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
    // Fallback: unescaped, in case Substack ever serves a non-escaped state.
    const m2 = html.match(/\bpost_id\b\s*[:=]\s*(\d+)/);
    return m2 ? parseInt(m2[1], 10) : null;
}

/**
 * Substack's public read API is served from the publication's canonical
 * origin. For custom-domain Substacks (e.g. slowboring.com) both the
 * custom origin *and* the `<subdomain>.substack.com` variant typically
 * work; we prefer the canonical one the page advertises because that's
 * what the page's own client talks to.
 *
 * @returns {string} origin URL like "https://garymarcus.substack.com"
 */
export function getCanonicalOrigin() {
    const canonLink = document.querySelector('link[rel="canonical"]');
    if (canonLink && canonLink.href) {
        try { return new URL(canonLink.href).origin; } catch (_) { /* fallthrough */ }
    }
    return window.location.origin;
}

/**
 * Author handle for subdomain Substacks: `garymarcus` from
 * `garymarcus.substack.com`. Custom-domain publications have no equivalent
 * handle — this returns null for them.
 */
export function extractAuthorHandle() {
    const host = window.location.hostname;
    if (host.endsWith('.substack.com') && host !== 'substack.com') {
        return host.replace(/\.substack\.com$/, '');
    }
    return null;
}

// ------------------------------------------------------------------
// DOM metadata extraction
// ------------------------------------------------------------------

function firstText(selectors) {
    for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent) {
            const t = el.textContent.trim();
            if (t) return t;
        }
    }
    return null;
}

function firstIntText(selectors) {
    const raw = firstText(selectors);
    if (!raw) return 0;
    // Substack sometimes renders counts as "1.2k" / "3.4M"; handle those.
    const m = raw.match(/^(\d+(?:\.\d+)?)\s*([kmb]?)/i);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    const suffix = m[2].toLowerCase();
    const mul = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : suffix === 'b' ? 1_000_000_000 : 1;
    return Math.round(n * mul);
}

function extractPublicationName() {
    return firstText([
        '.publication-name',
        '[class*="PublicationName"]',
        '.navbar-title',
        'meta[property="og:site_name"]'
    ]) || document.querySelector('meta[property="og:site_name"]')?.content?.trim() || null;
}

function extractAuthorBio() {
    // Substack author subtitle lives on the post page as the "tagline"
    // style element. Not every post has one; we tolerate nulls.
    return firstText([
        '.author-bio',
        '[class*="AuthorBio"]',
        '.subtitle'
    ]);
}

function extractEngagement() {
    return {
        likes:    firstIntText(['[class*="like-count"]',    '[class*="LikeCount"]']),
        restacks: firstIntText(['[class*="restack-count"]', '[class*="RestackCount"]']),
        comments: firstIntText(['[class*="comment-count"]', '[class*="CommentCount"]'])
    };
}

// ------------------------------------------------------------------
// Main enricher
// ------------------------------------------------------------------

/**
 * Given an article already extracted by the generic Readability
 * pipeline, layer Substack-specific fields on top. Never throws —
 * every enrichment is defensive so a selector regression degrades
 * to missing data, not a broken capture.
 *
 * Adds:
 *   article.platform           'substack'
 *   article.substack.postId    (number)
 *   article.substack.handle    (string|null)
 *   article.substack.apiOrigin (string) — where to fetch comments
 *   article.substack.authorBio (string|null)
 *   article.substack.publicationName  (string|null — replaces siteName if richer)
 *   article.engagement         { likes, restacks, comments }  (numbers)
 *
 * Does NOT fetch comments here — that's the SW's job (see substack-comments.js).
 */
export function enrichArticle(article) {
    if (!article) return article;

    article.platform = 'substack';

    const substack = {
        postId: null,
        handle: null,
        apiOrigin: null,
        authorBio: null,
        publicationName: null
    };

    try { substack.postId = extractPostId(); } catch (_) {}
    try { substack.handle = extractAuthorHandle(); } catch (_) {}
    try { substack.apiOrigin = getCanonicalOrigin(); } catch (_) {}
    try { substack.authorBio = extractAuthorBio(); } catch (_) {}
    try { substack.publicationName = extractPublicationName(); } catch (_) {}

    article.substack = substack;

    if (substack.publicationName && (!article.siteName || article.siteName === new URL(article.url).hostname)) {
        article.siteName = substack.publicationName;
    }

    try { article.engagement = extractEngagement(); } catch (_) {}

    return article;
}

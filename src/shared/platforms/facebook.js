// Facebook platform handler — Phase 8d (issue #19).
//
// Runs in the content script on `facebook.com` post / video / reel
// / photo pages. Synthesizes the article from scratch — Facebook is
// fully SPA-loaded, the initial HTML barely carries anything, and
// Readability returns noise.
//
// Why Facebook is the hardest of the three hard-tier platforms:
//   - No SSR JSON blob (vs TikTok's `__UNIVERSAL_DATA_FOR_REHYDRATION__`).
//   - OG tags are sometimes rich (public pages, share links) and
//     sometimes empty (private posts, feed items the user is scrolled
//     into). Can't rely on them alone.
//   - Class names are fully randomized and churn often.
//   - The stable signals are: ARIA roles, `aria-label` on actor links,
//     `<a>` with `/posts/`|`/videos/`|`/reel/` in href, `<abbr>` with
//     `data-utime` (legacy) or `aria-label` with a timestamp, and the
//     `fb_api_req_friendly_name` / `doc_id` header on GraphQL calls.
//   - Anti-replay: `fb_dtsg` tokens rotate; replaying a GraphQL call
//     is pointless even if we could. That's why we *intercept* the
//     response rather than firing our own fetch.
//
// Capture strategy (in priority order):
//
//   1. **GraphQL response interception** — the api-hook buffer
//      (Phase 8a) captures `fb_api_req_friendly_name`-tagged calls
//      during page load. `extractFromBuffer(postId)` walks the buffer
//      for a response whose payload carries a story/post node matching
//      the focal post id. This is the load-bearing path for private
//      posts and posts with empty OG tags.
//
//   2. **Open Graph + Twitter card meta tags** — server-rendered
//      when Facebook thinks the post is public. Carries author name,
//      post text (in `og:description`), primary image URL, canonical
//      URL. Most-reliable path for public pages and share-link URLs.
//
//   3. **Defensive DOM scrape** — fill in fields the other layers
//      don't cover (post date via `<abbr data-utime>` or similar,
//      verified flag, like/comment counts from the action bar). All
//      wrapped in try/catch so a layout change can't break capture.
//
//   4. **HTML snapshot + screenshot** — the Phase 8a evidence layer.
//      Always-on safety net; even if all three extraction paths
//      degrade, we've still preserved a faithful artifact.
//
// Deliberately NOT in v1:
//   - Comment thread extraction. Comments are paginated, auth-gated,
//     and threaded in ways that GraphQL reshapes across FB UI versions.
//   - Stories. Ephemeral by design.
//   - Watch-party / live-stream metadata. Specialized subtypes, low
//     evidentiary value relative to cost.
//   - Groups feed captures where no single post is focal. The handler
//     only fires when there's a recognizable post/video/reel/photo id
//     in the URL.

import { snapshot, snapshotHash } from '../html-snapshot.js';
import { capturePostScreenshot, dataUrlHash } from '../screenshot.js';
import { ContentExtractor } from '../content-extractor.js';
import { findApiHookEvents, tryParseJson } from '../api-hook-buffer.js';

// ------------------------------------------------------------------
// Detection
// ------------------------------------------------------------------

export function isFacebookPage() {
    const host = window.location.hostname;
    // Facebook is served off facebook.com, fb.com, m.facebook.com,
    // and regional subdomains. `*.facebook.com` catches them all; we
    // additionally accept `fb.com` which redirects into facebook.com
    // but may briefly run our content script on the way through.
    return /(?:^|\.)facebook\.com$/i.test(host) ||
           /(?:^|\.)fb\.com$/i.test(host);
}

export function isFacebookPostPage() {
    if (!isFacebookPage()) return false;
    return postRefFromLocation() !== null;
}

/**
 * Extract `{ id, kind }` for the focal post from the current URL.
 * Handles the major URL shapes:
 *   /<user>/posts/<id>
 *   /<user>/videos/<id>
 *   /watch/?v=<id>
 *   /reel/<id>
 *   /permalink.php?story_fbid=<id>&id=<page_id>
 *   /story.php?story_fbid=<id>&id=<page_id>
 *   /share/p/<shortcode>/        (modern share links, post)
 *   /share/v/<shortcode>/        (share link, video)
 *   /share/r/<shortcode>/        (share link, reel)
 *   /photo/?fbid=<id>            (photo detail)
 *   /photo.php?fbid=<id>
 *   /groups/<group>/posts/<id>/
 *   /groups/<group>/permalink/<id>/
 *
 * The `id` may be a numeric story id (`1234567890`), a `pfbid*`
 * opaque id, or a share shortcode. Downstream code treats all three
 * as opaque identifiers — they're only used for buffer-matching and
 * canonical URL reconstruction.
 *
 * Pure function — exported so tests can pin the URL grammar.
 */
export function postRefFromUrl(url = window.location.href) {
    try {
        const u = new URL(url);
        if (!/(?:^|\.)(?:facebook|fb)\.com$/i.test(u.hostname)) return null;

        const path = u.pathname;
        const qs   = u.searchParams;

        // /reel/<id>
        let m = path.match(/^\/reel\/([A-Za-z0-9_.-]+)/);
        if (m) return { id: m[1], kind: 'reel' };

        // /watch/?v=<id>
        if (/^\/watch\/?$/.test(path)) {
            const v = qs.get('v');
            if (v) return { id: v, kind: 'video' };
        }

        // /share/p|v|r/<shortcode>/
        m = path.match(/^\/share\/(p|v|r)\/([A-Za-z0-9_-]+)/);
        if (m) {
            const KIND = { p: 'post', v: 'video', r: 'reel' };
            return { id: m[2], kind: KIND[m[1]] || 'post' };
        }

        // /permalink.php, /story.php — story_fbid + id
        if (/^\/(?:permalink|story)\.php\/?$/.test(path)) {
            const id = qs.get('story_fbid');
            if (id) return { id, kind: 'post' };
        }

        // /photo/?fbid=<id> and /photo.php?fbid=<id>
        if (/^\/photo(?:\/|\.php)?\/?$/.test(path)) {
            const id = qs.get('fbid');
            if (id) return { id, kind: 'photo' };
        }

        // /groups/<g>/posts/<id>/ and /groups/<g>/permalink/<id>/
        m = path.match(/^\/groups\/[^/]+\/(?:posts|permalink)\/([A-Za-z0-9_.-]+)/);
        if (m) return { id: m[1], kind: 'post' };

        // /<user>/posts/<id>, /<user>/videos/<id>, /<user>/photos/<set>/<id>
        m = path.match(/^\/[^/]+\/posts\/([A-Za-z0-9_.-]+)/);
        if (m) return { id: m[1], kind: 'post' };
        m = path.match(/^\/[^/]+\/videos\/([A-Za-z0-9_.-]+)/);
        if (m) return { id: m[1], kind: 'video' };
        m = path.match(/^\/[^/]+\/photos\/(?:[^/]+\/)?([A-Za-z0-9_.-]+)/);
        if (m) return { id: m[1], kind: 'photo' };

        return null;
    } catch (_) { return null; }
}

function postRefFromLocation() {
    return postRefFromUrl(window.location.href);
}

/**
 * Try to recover the author page handle from the URL path when the
 * URL is user-prefixed (`/<user>/posts/<id>` etc.). Falls back to
 * null on share-link and watch-style URLs where the handle isn't in
 * the path.
 */
function handleFromUrl(url = window.location.href) {
    try {
        const path = new URL(url).pathname;
        const m = path.match(/^\/([A-Za-z0-9.][A-Za-z0-9._-]*)\/(?:posts|videos|photos)\//);
        return m ? m[1] : null;
    } catch (_) { return null; }
}

// ------------------------------------------------------------------
// Meta-tag extraction
// ------------------------------------------------------------------

/**
 * Read Facebook's Open Graph + Twitter Card meta tags into a
 * normalized object. Facebook's tags are less structured than
 * Instagram's — the description sometimes carries the post body,
 * sometimes just the page name. We accept both and let downstream
 * code decide which to surface.
 *
 * Pure function — accepts a `doc` so tests can pass a fake DOM.
 */
export function extractMetaFields(doc = document) {
    const meta = {};
    const get = (selector) => {
        const el = doc.querySelector(selector);
        return el ? (el.getAttribute('content') || '').trim() : '';
    };
    meta.title       = get('meta[property="og:title"]');
    meta.description = get('meta[property="og:description"]') ||
                       get('meta[name="description"]');
    meta.image       = get('meta[property="og:image"]');
    meta.video       = get('meta[property="og:video"]') ||
                       get('meta[property="og:video:secure_url"]');
    meta.url         = get('meta[property="og:url"]');
    meta.type        = get('meta[property="og:type"]');
    meta.siteName    = get('meta[property="og:site_name"]') || 'Facebook';
    // Facebook emits a few of its own `fb:*` props on public pages.
    meta.fbPageId    = get('meta[property="al:android:url"]') ||
                       get('meta[property="fb:page_id"]');
    return meta;
}

/**
 * Parse Facebook's og:description into structured fields. Facebook
 * uses a handful of shapes depending on page type:
 *   "<N> likes, <M> comments, <K> shares — <Author>: \"<body>\""
 *   "<Author> wrote on Facebook..."
 *   "<Page name> is on Facebook. To connect with <Page>, join..."
 *   "<post body>"  (plain, when rich meta isn't available)
 *
 * Pure function — testable with synthetic descriptions.
 */
export function parseOgDescription(desc) {
    const out = { author: null, body: null, engagement: {} };
    if (typeof desc !== 'string' || !desc) return out;

    // Strip leading engagement counts if present. Only consume the
    // prefix when it actually looks like "<N> likes"-style text —
    // otherwise an em-dash inside the post body would be mistaken
    // for the count/body separator.
    let head = desc;
    const engMatch = desc.match(
        /^([^—\-]*?(?:\d[\d.,KMB]*\s*(?:likes?|comments?|shares?|reactions?)[^—\-]*))\s[—-]\s/i
    );
    if (engMatch) {
        const prefix = engMatch[1];
        head = desc.slice(engMatch[0].length);
        const likeM    = prefix.match(/([\d.,]+\s*[KMB]?)\s+likes?/i);
        const commentM = prefix.match(/([\d.,]+\s*[KMB]?)\s+comments?/i);
        const shareM   = prefix.match(/([\d.,]+\s*[KMB]?)\s+shares?/i);
        if (likeM)    out.engagement.likes    = toCount(likeM[1]);
        if (commentM) out.engagement.comments = toCount(commentM[1]);
        if (shareM)   out.engagement.shares   = toCount(shareM[1]);
    }

    // Try the "<Author>: \"<body>\"" form. Straight and smart quotes.
    let m = head.match(/^(.+?):\s+["“](.+)["”]\s*$/s);
    if (m) {
        out.author = m[1].trim() || null;
        out.body   = m[2].trim() || null;
        return out;
    }
    // "<Author> wrote on Facebook: <body>"
    m = head.match(/^(.+?)\s+wrote\s+on\s+Facebook:\s+(.+)$/si);
    if (m) {
        out.author = m[1].trim() || null;
        out.body   = m[2].trim() || null;
        return out;
    }
    // Fallback: treat the whole thing as the body. Better than
    // dropping content outright — downstream can still render it.
    out.body = desc.trim();
    return out;
}

function toCount(s) {
    if (typeof s !== 'string') return null;
    const trimmed = s.trim();
    const numericMatch = trimmed.match(/^([\d.,]+)\s*([KMB])?$/i);
    if (!numericMatch) return null;
    const raw = numericMatch[1].replace(/,/g, '');
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    const suffix = (numericMatch[2] || '').toUpperCase();
    if (suffix === 'K') return Math.round(n * 1_000);
    if (suffix === 'M') return Math.round(n * 1_000_000);
    if (suffix === 'B') return Math.round(n * 1_000_000_000);
    return Math.round(n);
}

// ------------------------------------------------------------------
// DOM scrape — fields the other layers don't cover
// ------------------------------------------------------------------

function scrapePostDate(scope) {
    const root = scope || document;
    // Legacy `<abbr data-utime>` still shows up on some pages — when
    // present it's the cleanest unix-seconds timestamp signal.
    const abbr = root.querySelector('abbr[data-utime]');
    if (abbr) {
        const t = Number(abbr.getAttribute('data-utime'));
        if (Number.isFinite(t) && t > 0) return Math.floor(t);
    }
    // Current React shell: the post timestamp lives in a permalink
    // `<a>` near the author row. The anchor's visible text is
    // relative ("12h"), but the accessible name or a nested tooltip
    // often has a full parseable date string.
    //
    // Candidate selectors, in priority order:
    //   1. `<a href>` whose href contains `/posts/<id>` / `/videos/<id>`
    //      / etc. — that's the canonical post permalink. Check its
    //      aria-label for a full date.
    //   2. Any `<time datetime>` in the article container.
    //   3. Relative-time fallback ("12h", "3d") parsed against now.
    const article = root.querySelector('[role="article"]') || root;

    // 1. Permalink anchor with aria-label.
    const permalinks = article.querySelectorAll('a[href*="/posts/"], a[href*="/videos/"], a[href*="/reel/"], a[href*="/photos/"], a[href*="story_fbid="], a[href*="/share/p/"], a[href*="/share/v/"], a[href*="/share/r/"]');
    for (const a of permalinks) {
        const label = a.getAttribute('aria-label') || '';
        const parsed = parseFacebookDateString(label);
        if (parsed) return parsed;
    }

    // 2. `<time datetime>` element.
    const t = article.querySelector('time[datetime]');
    if (t) {
        const iso = t.getAttribute('datetime');
        const ts = Date.parse(iso || '');
        if (Number.isFinite(ts)) return Math.floor(ts / 1000);
    }

    // 3. Relative-time fallback. Facebook renders "12h" / "3d" /
    // "45m" inside the timestamp anchor. Parse loosely against
    // current time — accuracy is approximate (hour-bucket) but that
    // beats leaving the field empty.
    for (const a of permalinks) {
        const text = (a.textContent || '').trim();
        const rel = parseRelativeTime(text);
        if (rel) return rel;
    }
    // 4. Last-resort relative-time scan. The post-header timestamp
    // is usually inside a short-text element (2-5 chars like "12h"
    // or "3d") near the top of the article. Walk short text nodes
    // in the focal scope and pick the first one matching the
    // relative-time pattern. The "short text" floor (< 20 chars)
    // filters out body sentences that incidentally contain "3h" /
    // "1d" as words.
    const walker = article.querySelectorAll('a, span');
    for (const el of walker) {
        const t = (el.textContent || '').trim();
        if (t.length === 0 || t.length > 20) continue;
        const rel = parseRelativeTime(t);
        if (rel) return rel;
    }
    return null;
}

/**
 * Parse a Facebook-rendered absolute date string. The exact format
 * varies by locale and UI version; supported shapes (English):
 *   "Monday, April 21, 2026 at 9:30 PM"
 *   "April 21, 2026 at 9:30 PM"
 *   "April 21 at 9:30 PM"        (current year implied)
 *   "21 April 2026, 21:30"        (some non-US locales)
 * Returns unix seconds or null. Uses `Date.parse` as a one-shot —
 * it handles the English forms above and degrades gracefully.
 *
 * Pure function — exported so tests can pin the grammar.
 */
export function parseFacebookDateString(s) {
    if (typeof s !== 'string' || !s) return null;
    // Date.parse handles most English variants directly. For the
    // "at HH:MM" separator, strip the preamble down to a parseable
    // form by replacing ` at ` with ` `.
    const normalized = s.replace(/\s+at\s+/i, ' ');
    const ts = Date.parse(normalized);
    if (Number.isFinite(ts) && ts > 0) return Math.floor(ts / 1000);
    return null;
}

/**
 * Parse Facebook's short relative-time strings ("12h", "45m", "3d",
 * "2w") into an approximate unix timestamp. Accuracy is the string's
 * granularity — "12h" lands within the hour, "3d" within the day.
 *
 * The anchor text often contains extra junk (privacy-indicator
 * icons, · separators, emoji, trailing whitespace), so we match
 * the first token of the pattern anywhere in the string rather
 * than requiring a whole-string match.
 *
 * Pure function — exported so tests can pin the grammar.
 */
export function parseRelativeTime(s, nowMs = Date.now()) {
    if (typeof s !== 'string' || !s) return null;
    // \b anchors prevent matching inside longer words — "12hr" and
    // "12hour" won't trigger, but "12h" / "12h ·" / "12h ago" will.
    const m = s.match(/\b(\d+)\s*(s|m|h|d|w|y)\b/i);
    if (!m) return null;
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    if (!Number.isFinite(n) || n <= 0) return null;
    const SECONDS = {
        s: 1,
        m: 60,
        h: 3_600,
        d: 86_400,
        w: 604_800,
        y: 31_536_000
    };
    const deltaSec = n * (SECONDS[unit] || 0);
    if (deltaSec === 0) return null;
    return Math.floor(nowMs / 1000) - deltaSec;
}

function scrapeAuthorFromDom(scope) {
    // Actor links inside `<strong>` with role="link" are the most
    // stable selector for the post's author. Search within the
    // focal scope (dialog on modals, article on feeds) — the
    // nested [role="article"] inside is for the header + text row.
    const root = scope || document;
    const article = root.querySelector('[role="article"]') || root;
    const link = article.querySelector('strong a[role="link"]') ||
                 article.querySelector('h2 strong a, h3 strong a, h4 strong a');
    if (!link) return { name: null, handle: null };
    const name = (link.textContent || '').trim() || null;
    // The href typically points at the profile/page URL: `/<handle>/`
    // or `/profile.php?id=<id>`. Extract the handle when the path is
    // a single segment.
    let handle = null;
    const href = link.getAttribute('href') || '';
    try {
        const u = new URL(href, 'https://www.facebook.com/');
        const m = u.pathname.match(/^\/([A-Za-z0-9.][A-Za-z0-9._-]*)\/?$/);
        if (m) handle = m[1];
    } catch (_) { /* keep null */ }
    return { name, handle };
}

function scrapeVerifiedFlag(scope) {
    // Facebook renders the blue-check as an `<svg>` with an aria-label
    // "Verified Page", "Verified account", or similar. Match loosely.
    const root = scope || document;
    const svg = root.querySelector('svg[aria-label^="Verified"]');
    return !!svg;
}

/**
 * Attempt to pull the post body text from the DOM. Facebook renders
 * post text inside `[data-ad-comet-preview="message"]` when the
 * composer/preview markup is in play, or in `<div dir="auto">` inside
 * the article container. Neither selector is bulletproof across FB
 * redesigns, but together they cover the common cases — pair with
 * OG description + GraphQL and at least one of them tends to hit.
 *
 * Returns the extracted text (trimmed) or empty string.
 */
/**
 * Scrape the focal post's body text from the DOM. Scoped to the
 * focal-post container (`[role="dialog"]` on modal views,
 * `[role="article"]` elsewhere) so we don't accidentally pick up
 * sibling posts visible in the feed behind a modal.
 *
 * The whole-document scan that used to live here had a nasty
 * regression: when Facebook renders the post-detail modal overlay
 * on top of the user's profile feed, every other post of theirs
 * in the DOM competes for "longest div" — and a *different*
 * post's body would win if it happened to be longer. Scoping to
 * the dialog fixes that class of bug categorically.
 */
function scrapePostBodyFromDom(scope) {
    const root = scope || document;

    // Explicit hook first — this is the post body verbatim when
    // present (FB's composer/preview layer).
    const preview = root.querySelector('[data-ad-comet-preview="message"]');
    if (preview) {
        const txt = (preview.textContent || '').trim();
        if (txt.length > 0) return txt;
    }

    // Fallback: scan `<div dir="auto">` inside the focal scope and
    // pick the longest text. FB uses this element for bidi-aware
    // text rendering — the post body is reliably the longest one
    // *inside the post container*. Skip tiny nodes (button labels,
    // timestamps, engagement counts) via a 40-char floor. Skip
    // aria-hidden subtrees (screen-reader chrome that bulks the
    // match).
    let best = '';
    let bestLen = 40;
    for (const el of root.querySelectorAll('div[dir="auto"]')) {
        if (el.closest('[aria-hidden="true"]')) continue;
        const t = (el.textContent || '').trim();
        if (t.length > bestLen) { best = t; bestLen = t.length; }
    }
    return best;
}

/**
 * Find content image URLs on the page. Facebook renders post images
 * as `<img>` tags pointing at `scontent.*.fbcdn.net` or similar CDN
 * hosts. Filter to that CDN family, skip small thumbnails / avatars
 * (≥ 200px on both sides), dedup by canonical path (FB appends
 * different query-string signing tokens across reloads).
 *
 * RETURNS the full URL including query string — without the
 * `?_nc_oh=…&oe=…` signing params, the CDN returns 403 to any
 * cross-origin loader (including chrome-extension://). Same pattern
 * as Instagram's content-image extractor.
 *
 * Pure function — accepts an `imgs` iterable so tests can pass a
 * synthetic list.
 */
export function extractContentImageUrls(imgs) {
    const seen = new Set();  // canonical paths we've already emitted
    const out  = [];         // full URLs, in iteration order
    for (const img of imgs || []) {
        const src = resolveImageSrc(img);
        if (!isFacebookCdnUrl(src)) continue;
        if (looksLikeAvatarOrIcon(src, img)) continue;
        const key = canonicalImageKey(src);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(src);
    }
    return out;
}

/**
 * Pick a usable src from an `<img>`, accounting for FB's lazy-load
 * patterns. Order:
 *   1. `currentSrc` — post-srcset resolution, populated after decode.
 *   2. `src` — usually set once the image enters viewport.
 *   3. `data-src` / `data-lazy-src` — placeholders before load.
 *   4. Largest candidate from `srcset` — FB emits a descending list
 *      `url1 40w, url2 80w, ...`; pick the last (highest-density).
 */
function resolveImageSrc(img) {
    if (!img) return null;
    if (img.currentSrc) return img.currentSrc;
    if (img.src) return img.src;
    const lazy = img.getAttribute?.('data-src') ||
                 img.getAttribute?.('data-lazy-src') ||
                 img.getAttribute?.('data-orig-src');
    if (lazy) return lazy;
    const srcset = img.getAttribute?.('srcset');
    if (srcset) {
        const entries = srcset.split(',').map((s) => s.trim()).filter(Boolean);
        const last = entries[entries.length - 1];
        if (last) return last.split(/\s+/)[0] || null;
    }
    return null;
}

function isFacebookCdnUrl(src) {
    if (typeof src !== 'string' || !src) return false;
    if (!/^https?:\/\//i.test(src)) return false;
    const host = hostnameOf(src);
    // Facebook CDN is `scontent-*.xx.fbcdn.net` and sometimes
    // `video-*.fbcdn.net` (video posters). Accept the family.
    return /(?:^|\.)fbcdn\.net$/i.test(host);
}

function hostnameOf(url) {
    try { return new URL(url).hostname; } catch (_) { return ''; }
}

function looksLikeAvatarOrIcon(src, img) {
    // Content images are typically ≥ 300px on the long edge; avatars
    // and icons render around 40-60px. Use rendered size first, fall
    // back to natural dimensions.
    if (img && typeof img === 'object') {
        const r = img.getBoundingClientRect
            ? img.getBoundingClientRect()
            : { width: 0, height: 0 };
        const w = r.width  || img.naturalWidth  || Number(img.width  || img.getAttribute?.('width')  || 0);
        const h = r.height || img.naturalHeight || Number(img.height || img.getAttribute?.('height') || 0);
        if (w > 0 && w < 200) return true;
        if (h > 0 && h < 200) return true;
    }
    return false;
}

function canonicalImageKey(src) {
    try {
        const u = new URL(src);
        return u.origin + u.pathname;
    } catch (_) { return src; }
}

// ------------------------------------------------------------------
// GraphQL response → post data (Phase 8d — api-interceptor wiring)
// ------------------------------------------------------------------

/**
 * Walk a parsed Facebook GraphQL response and return the first node
 * that looks like a story/post. Facebook's responses are deeply
 * nested (`data.node`, `data.story_feedback_card`, `data.viewer...`,
 * etc.) and shift across UI versions. We don't try to understand
 * the envelope — just recursively find the first object that quacks
 * like a post.
 *
 * Pure function — accepts parsed JSON so tests can pass synthetic
 * shapes. Returns `{ story, user, engagement }` or null.
 */
export function extractPostFromGraphQL(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    // Collect every story-shaped node, then pick the best candidate
    // instead of the first match. Facebook responses often contain
    // multiple stories (focal post + suggested + feed context); the
    // focal post is reliably the one with the longest `message.text`
    // — comments and suggested units have much shorter bodies.
    const candidates = [];
    collectStoriesRecursively(parsed, 0, candidates);
    if (candidates.length === 0) return null;
    const story = pickBestStory(candidates);
    if (!story) return null;

    // Actors are the post's author(s). Usually a single-element array.
    let user = null;
    if (Array.isArray(story.actors) && story.actors[0]) {
        user = story.actors[0];
    } else if (story.owner && typeof story.owner === 'object') {
        user = story.owner;
    } else if (story.author && typeof story.author === 'object') {
        user = story.author;
    }

    // Engagement lives on `feedback.reaction_count` / `comments.count`
    // / `share_count`. Different shapes across queries; walk defensively.
    const engagement = {};
    const fb = story.feedback;
    if (fb && typeof fb === 'object') {
        if (fb.reaction_count && Number.isFinite(Number(fb.reaction_count.count))) {
            engagement.reactions = Number(fb.reaction_count.count);
        } else if (fb.reactors && Number.isFinite(Number(fb.reactors.count))) {
            engagement.reactions = Number(fb.reactors.count);
        }
        if (fb.comments && Number.isFinite(Number(fb.comments.total_count))) {
            engagement.comments = Number(fb.comments.total_count);
        } else if (fb.top_level_comments && Number.isFinite(Number(fb.top_level_comments.total_count))) {
            engagement.comments = Number(fb.top_level_comments.total_count);
        }
        if (fb.share_count && Number.isFinite(Number(fb.share_count.count))) {
            engagement.shares = Number(fb.share_count.count);
        }
    }

    return { story, user, engagement };
}

/**
 * Walk the tree and push every story-shaped node into `out`. Bounded
 * depth + no visited-set (FB payloads aren't cyclic in practice).
 * Unlike a first-match walk, this lets the caller pick the best
 * candidate — typically the one with the longest `message.text`,
 * which is the focal post.
 */
function collectStoriesRecursively(obj, depth, out) {
    if (!obj || typeof obj !== 'object' || depth > 14) return;
    if (looksLikeStory(obj)) out.push(obj);
    if (Array.isArray(obj)) {
        for (const v of obj) collectStoriesRecursively(v, depth + 1, out);
        return;
    }
    for (const k of Object.keys(obj)) {
        collectStoriesRecursively(obj[k], depth + 1, out);
    }
}

/**
 * Pick the most-focal-looking story from a list of candidates.
 * Heuristic: longest `message.text` wins. Post bodies are usually
 * an order of magnitude longer than comments or feed-chrome stories.
 * Ties broken by presence of `feedback` (reactions/comments metadata
 * → definitely a real post, not a sub-node).
 */
function pickBestStory(candidates) {
    let best = null;
    let bestScore = -1;
    for (const s of candidates) {
        const text = s && s.message && typeof s.message.text === 'string'
            ? s.message.text : '';
        let score = text.length;
        if (s && s.feedback && typeof s.feedback === 'object') score += 1;
        if (Array.isArray(s && s.attachments) && s.attachments.length > 0) score += 10;
        if (score > bestScore) { best = s; bestScore = score; }
    }
    return best;
}

/**
 * Recursively search a GraphQL story subtree for a `creation_time`
 * field. FB's story node nests the timestamp under
 * `comet_sections.timestamp.story.creation_time` in current UI
 * versions, `creation_story.creation_time` in older ones, and plain
 * `creation_time` at the top level in some permalink responses. A
 * bounded recursive walk picks up all three without hardcoding
 * paths. Returns unix seconds or null.
 *
 * Pure function — exported so tests can pin the grammar.
 */
export function findCreationTime(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 10) return null;
    // Direct hit at this level.
    const n = Number(obj.creation_time);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
    // Walk arrays and object values. We skip `feedback` (has its own
    // `created_at` for comments that we don't want to mistake for the
    // post time) and `comments` / `replies`.
    const SKIP_KEYS = new Set(['feedback', 'comments', 'replies', 'attachments']);
    if (Array.isArray(obj)) {
        for (const v of obj) {
            const t = findCreationTime(v, depth + 1);
            if (t) return t;
        }
        return null;
    }
    for (const k of Object.keys(obj)) {
        if (SKIP_KEYS.has(k)) continue;
        const t = findCreationTime(obj[k], depth + 1);
        if (t) return t;
    }
    return null;
}

function looksLikeStory(obj) {
    if (!obj || typeof obj !== 'object') return false;
    const hasMessageObj = obj.message && typeof obj.message === 'object' &&
                          typeof obj.message.text === 'string' &&
                          obj.message.text.length > 0;
    const hasActors  = Array.isArray(obj.actors) && obj.actors.length > 0;
    const hasCreation = Number.isFinite(Number(obj.creation_time));
    // Typical post node: actors + message.text.
    if (hasActors && hasMessageObj) return true;
    // Permalink-style: creation_time + message.
    if (hasCreation && hasMessageObj) return true;
    // Attachment-carrying story wrapper.
    if (hasActors && Array.isArray(obj.attachments) && obj.attachments.length > 0) {
        return true;
    }
    // Looser fallback: an object that *has* a non-trivial message.text
    // AND a feedback/comments/reaction-count block. Catches feed-style
    // story wrappers where `actors` is hoisted into a sibling node.
    if (hasMessageObj && obj.feedback && typeof obj.feedback === 'object') {
        return true;
    }
    return false;
}

/**
 * Scan the api-hook buffer for any captured Facebook GraphQL
 * response that looks like it carries the focal post. Newest event
 * wins (freshest response after any navigation).
 *
 * Returns `{ story, user, engagement }` or null.
 */
function extractFromBuffer() {
    const events = findApiHookEvents((e) =>
        e.url.includes('/api/graphql') ||
        e.url.includes('/graphql/'));
    if (events.length === 0) return null;
    console.log('[X-Ray Facebook] buffer scan: walking', events.length, 'graphql events');
    for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        // FB responses are sometimes newline-delimited multi-JSON.
        // Try a plain parse first; on failure, split on newlines and
        // try each fragment.
        let post = null;
        const direct = tryParseJson(ev.body);
        if (direct) {
            post = extractPostFromGraphQL(direct);
        }
        if (!post) {
            const lines = (ev.body || '').split(/\r?\n/).filter((l) => l.trim());
            for (const line of lines) {
                const parsed = tryParseJson(line);
                if (!parsed) continue;
                post = extractPostFromGraphQL(parsed);
                if (post) break;
            }
        }
        if (!post) continue;
        console.log('[X-Ray Facebook] buffer event matched:', ev.url,
            '— actor:', post.user ? (post.user.name || post.user.username) : null);
        return post;
    }
    return null;
}

// ------------------------------------------------------------------
// Evidence target selection
// ------------------------------------------------------------------

function pickEvidenceElement() {
    // Strategy in priority order:
    //   1. Explicit post containers via role + data-ad preview hooks
    //   2. Any `[role="article"]`
    //   3. `<main>` as a last resort (may include chrome — inferior
    //      but better than the entire body)
    const SELECTORS = [
        '[role="article"][aria-posinset]',
        '[role="article"]',
        '[data-pagelet^="FeedUnit"]',
        'main [role="main"]',
        'main'
    ];
    for (const sel of SELECTORS) {
        const el = document.querySelector(sel);
        if (el) return el;
    }
    return document.body || null;
}

/**
 * Pick the DOM container that bounds the focal post. Used by every
 * DOM scraper (body text, author, images, dates, verified flag) so
 * none of them can accidentally pick up sibling posts visible in
 * the feed behind a modal.
 *
 * This is distinct from `pickEvidenceElement` because FB's layout
 * splits the post across siblings: the `[role="article"]` only
 * holds the header + text, while the image gallery is a sibling
 * inside the enclosing dialog / feed unit. Scoping to the dialog
 * gets both the text AND the images AND the timestamp — and
 * excludes the profile feed rendered underneath.
 *
 * Priority:
 *   1. `[role="dialog"]` — post-detail modal overlay. Wraps the
 *      focal post's text + images + comments as a self-contained
 *      unit, excluding the feed rendered behind it.
 *   2. `[role="article"][aria-posinset]` — feed view of a post.
 *      Feed units are self-contained and include their images.
 *   3. `[role="article"]` — loose fallback.
 *   4. `document` — last resort; will likely pull in adjacent posts.
 */
function pickFocalScope() {
    const dialog = document.querySelector('[role="dialog"][aria-label]') ||
                   document.querySelector('[role="dialog"]');
    if (dialog) return dialog;
    const feedItem = document.querySelector('[role="article"][aria-posinset]');
    if (feedItem) return feedItem;
    const article = document.querySelector('[role="article"]');
    if (article) return article;
    return document;
}

/**
 * Pick a tighter target for the screenshot — full posts include
 * reactions + comment composer + suggested posts, which blow past
 * the viewport. Prefer the inner media container when one is
 * present; otherwise the full post element.
 */
function pickScreenshotTarget(postEl) {
    if (!postEl || !postEl.querySelectorAll) return postEl;
    // Find the largest media element inside the post. Require a
    // floor of 400×400 so we don't mistake thumbnail strips or
    // avatar rows for the post media — capturing a 680×80 sliver
    // is worse than capturing the whole post.
    const mediaRect = (el) => el && el.getBoundingClientRect
        ? el.getBoundingClientRect()
        : { width: 0, height: 0 };
    let largest = null;
    let largestArea = 0;
    for (const el of postEl.querySelectorAll('video, img')) {
        const r = mediaRect(el);
        const area = (r.width || 0) * (r.height || 0);
        if (area > largestArea && r.width >= 400 && r.height >= 400) {
            largest = el;
            largestArea = area;
        }
    }
    // No large media → screenshot the whole post container. Yes,
    // this may run tall (caption + reactions + some comments), but
    // a faithful tall screenshot beats a 680×80 sliver that's
    // nothing but margin.
    if (!largest) return postEl;
    // Walk up to the nearest container that's larger than the media
    // element, capped at 4 hops. Gives us the media + slide chrome
    // (nav arrows, dots) without the whole comment thread.
    let target = largest;
    for (let i = 0; i < 4; i++) {
        const parent = target.parentElement;
        if (!parent || parent === postEl) break;
        target = parent;
    }
    return target;
}

// ------------------------------------------------------------------
// Article synthesis
// ------------------------------------------------------------------

/**
 * Full Facebook capture: GraphQL buffer + meta tags + DOM scrape +
 * Phase 8a evidence. Returns null for any page that isn't a
 * recognized post / video / reel / photo URL.
 */
export async function synthesizeArticle() {
    if (!isFacebookPostPage()) return null;

    const ref      = postRefFromLocation();
    const postId   = ref.id;
    const postKind = ref.kind;              // 'post' | 'video' | 'reel' | 'photo'

    // Layer 1: GraphQL interception (load-bearing for private posts).
    const fromApi = extractFromBuffer();

    // Layer 2: Open Graph meta tags.
    const meta = extractMetaFields();
    const desc = parseOgDescription(meta.description);

    // Layer 3: DOM scrape (defensive — fill gaps the other layers miss).
    // The focal scope pinned by pickFocalScope() bounds every scraper
    // to the post-detail container so sibling posts in the feed
    // behind a modal can't leak into the capture.
    const focalScope = pickFocalScope();
    const domAuthor     = scrapeAuthorFromDom(focalScope);
    const domBody       = scrapePostBodyFromDom(focalScope);
    // Publication time: GraphQL story wins when present (exact), then
    // DOM scrape (absolute date from aria-label → relative-time
    // approximation). FB nests `creation_time` deep —
    // `comet_sections.timestamp.story.creation_time` and similar —
    // so we walk the story subtree rather than reading only the top.
    const graphqlCreationTime = fromApi && fromApi.story
        ? findCreationTime(fromApi.story)
        : null;
    const domCreationTime = scrapePostDate(focalScope);
    const publishedAt = graphqlCreationTime || domCreationTime || null;
    console.log('[X-Ray Facebook] publishedAt sources:',
        'graphql=', graphqlCreationTime,
        '· dom=', domCreationTime,
        '· chosen=', publishedAt);
    const verifiedDom = scrapeVerifiedFlag(focalScope);

    // Reconcile author info — GraphQL wins (structured), then OG
    // description parse, then DOM scrape, then handle-from-URL.
    // Track which source won so the reader's provenance chip reflects
    // reality rather than a default.
    const apiUser = fromApi && fromApi.user ? fromApi.user : null;
    let author = null, authorSource = null;
    if (apiUser && (apiUser.name || apiUser.full_name)) {
        author = apiUser.name || apiUser.full_name;
        authorSource = 'graphql';
    } else if (desc.author) {
        author = desc.author;
        authorSource = 'og-meta';
    } else if (domAuthor.name) {
        author = domAuthor.name;
        authorSource = 'dom-scrape';
    } else {
        const fromTitle = extractAuthorFromTitle(meta.title);
        if (fromTitle) { author = fromTitle; authorSource = 'og-title'; }
    }
    let handle = null;
    if (apiUser && apiUser.username)      handle = apiUser.username;
    else if (domAuthor.handle)            handle = domAuthor.handle;
    else                                  handle = handleFromUrl();
    const verified = (apiUser && apiUser.is_verified === true) || verifiedDom;

    // Body text — prefer the richest source available. Track the
    // winning source for provenance.
    const graphqlBody = fromApi && fromApi.story &&
                        fromApi.story.message &&
                        typeof fromApi.story.message.text === 'string'
        ? fromApi.story.message.text
        : '';
    let bodyText = '', extractedFrom = 'none';
    if (graphqlBody)     { bodyText = graphqlBody;  extractedFrom = 'graphql'; }
    else if (desc.body)  { bodyText = desc.body;    extractedFrom = 'og-meta'; }
    else if (domBody)    { bodyText = domBody;      extractedFrom = 'dom-scrape'; }

    // Engagement: GraphQL wins, then OG description.
    const engagement = (fromApi && fromApi.engagement) || {};
    if (engagement.reactions == null && desc.engagement.likes != null) {
        engagement.reactions = desc.engagement.likes;
    }
    if (engagement.comments == null && desc.engagement.comments != null) {
        engagement.comments = desc.engagement.comments;
    }
    if (engagement.shares == null && desc.engagement.shares != null) {
        engagement.shares = desc.engagement.shares;
    }

    const canonicalUrl = canonicalUrlFor(postKind, postId, handle) || meta.url || window.location.href;
    const titleLine    = composeTitle(author, handle, bodyText, postKind);

    // Evidence layer — always try to grab both. Neither failure
    // should sink the capture.
    const evidenceTarget = pickEvidenceElement();

    // Image URLs inside the post-detail container. Facebook's modal
    // overlay (role="dialog") wraps the focal post including its
    // image gallery as a sibling of the role="article" text block —
    // so scoping to the dialog catches the images that evidenceTarget
    // misses, WITHOUT pulling in feed posts visible behind the modal
    // and sidebar profile chrome. Feed views fall back to the
    // aria-posinset article; inline post URLs fall back to the whole
    // document as a last resort.
    const allImgs = focalScope.querySelectorAll('img');
    const scrapedImages = extractContentImageUrls(allImgs);
    console.log('[X-Ray Facebook] image scan:',
        'scope=' + (focalScope === document ? 'document' : focalScope.tagName),
        '·', allImgs.length, 'img tags →',
        scrapedImages.length, 'content images');
    const postImages = scrapedImages.length > 0
        ? scrapedImages
        : (meta.image ? [meta.image] : []);
    const mediaProvenance = scrapedImages.length > 0
        ? 'dom-scrape'
        : (meta.image ? 'og-meta' : 'none');
    const htmlSnapshotStr = evidenceTarget ? snapshot(evidenceTarget, { maxBytes: 50 * 1024 }) : '';
    const htmlSnapshotHashStr = htmlSnapshotStr ? await snapshotHash(htmlSnapshotStr) : null;

    const screenshotTarget = evidenceTarget ? pickScreenshotTarget(evidenceTarget) : null;
    let screenshotDataUrl = null;
    let screenshotHashStr = null;
    if (screenshotTarget) {
        try {
            screenshotDataUrl = await capturePostScreenshot(screenshotTarget);
            if (screenshotDataUrl) screenshotHashStr = await dataUrlHash(screenshotDataUrl);
        } catch (err) {
            console.warn('[X-Ray Facebook] screenshot capture failed:', err);
        }
    }

    console.log('[X-Ray Facebook] capture diagnostic:', {
        postId,
        postKind,
        evidenceTarget: evidenceTarget ? evidenceTarget.tagName : null,
        graphqlMatched: !!fromApi,
        ogMetaPresent: !!meta.description,
        hasBodyText: !!bodyText,
        extractedFrom
    });

    const bodyMarkdown = composeMarkdownBody({
        title: titleLine,
        canonicalUrl,
        postId,
        postKind,
        author,
        handle,
        verified,
        bodyText,
        publishedAt,
        engagement,
        images: postImages,
        videoUrl: meta.video || null
    });

    return {
        title:       titleLine,
        url:         canonicalUrl,
        domain:      'facebook.com',
        siteName:    'Facebook',
        // When author is missing (e.g. personal profile with no OG
        // tags), fall back to "@handle" rather than "null (@handle)".
        // A raw `author + (handle ? ...)` string-concats `null` when
        // author is null, producing visible garbage in the reader.
        byline:      author
                       ? author + (handle ? ` (@${handle})` : '')
                       : (handle ? `@${handle}` : ''),
        publishedAt,
        extractedAt: Math.floor(Date.now() / 1000),
        // Prefer the first scraped image as the featured image when
        // og:image didn't fire (private profiles). og:image is 1:1
        // cropped; the scraped full-size version is usually better.
        featuredImage: postImages[0] || meta.image || null,

        content:  ContentExtractor.markdownToHtml(bodyMarkdown),
        markdown: bodyMarkdown,

        excerpt: (bodyText || '').slice(0, 500),
        contentType: postKind === 'photo' ? 'image'
                    : postKind === 'post'  ? 'text'
                    : 'video',
        platform:    'facebook',

        engagement: {
            likes:    engagement.reactions || 0,
            comments: engagement.comments  || 0,
            shares:   engagement.shares    || 0
        },

        facebook: {
            postId,
            postKind,
            author: {
                handle:        handle || null,
                nickname:      author || null,
                verified,
                profileUrl:    handle ? `https://www.facebook.com/${handle}/` : null,
                // Provenance for the author name. URL-only handle (no
                // author name at all) gets 'url' so the reader chip
                // doesn't misattribute to og-meta.
                source:        authorSource || (handle ? 'url' : null)
            },
            mediaUrl:   meta.video || postImages[0] || meta.image || null,
            mediaType:  meta.video ? 'video'
                      : (postImages.length > 0 || meta.image) ? 'image'
                      : null,
            // Full set of content images (DOM scrape, then og:image
            // fallback). Same shape Instagram emits so downstream
            // tooling can treat FB and IG posts uniformly.
            images:         postImages,
            mediaSource:    mediaProvenance,  // 'dom-scrape' | 'og-meta' | 'none'
            videoUrl:       meta.video || null,
            extractedFrom
        },

        evidence: {
            screenshot:       screenshotDataUrl,
            screenshotHash:   screenshotHashStr,
            htmlSnapshot:     htmlSnapshotStr || null,
            htmlSnapshotHash: htmlSnapshotHashStr
        }
    };
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function extractAuthorFromTitle(title) {
    if (!title) return '';
    // og:title commonly is "<Author> | Facebook" or "<Author> -
    // Facebook" — accept either separator.
    const m = title.match(/^(.+?)\s*[|\-–—]\s*Facebook\s*$/);
    if (m) return m[1].trim();
    return '';
}

function canonicalUrlFor(postKind, postId, handle) {
    if (!postId) return null;
    if (postKind === 'video')  return `https://www.facebook.com/watch/?v=${postId}`;
    if (postKind === 'reel')   return `https://www.facebook.com/reel/${postId}`;
    if (postKind === 'photo')  return `https://www.facebook.com/photo/?fbid=${postId}`;
    if (handle)                return `https://www.facebook.com/${handle}/posts/${postId}`;
    return `https://www.facebook.com/${postId}`;
}

function composeTitle(author, handle, bodyText, postKind) {
    const kindLabel = postKind === 'reel'  ? 'Reel'
                    : postKind === 'video' ? 'Video'
                    : postKind === 'photo' ? 'Photo'
                    :                        'Post';
    if (author) {
        const handleSuffix = handle ? ` (@${handle})` : '';
        return bodyText
            ? `${author}${handleSuffix} on Facebook: "${truncate(bodyText, 80)}"`
            : `${kindLabel} by ${author}${handleSuffix} on Facebook`;
    }
    // No author name — use the handle alone (or body excerpt) so the
    // reader shows something more useful than "Facebook Post".
    if (handle) {
        return bodyText
            ? `@${handle} on Facebook: "${truncate(bodyText, 80)}"`
            : `${kindLabel} by @${handle} on Facebook`;
    }
    if (bodyText) return `Facebook ${kindLabel}: "${truncate(bodyText, 80)}"`;
    return `Facebook ${kindLabel}`;
}

function truncate(s, max) {
    if (typeof s !== 'string') return '';
    // Collapse all whitespace (newlines, tabs, runs of spaces) to a
    // single space before measuring. Titles that preserve newlines
    // get rendered as multi-line by downstream markdown, which splits
    // a single title into multiple link lines in the reader.
    const flat = s.replace(/\s+/g, ' ').trim();
    if (flat.length <= max) return flat;
    // Truncate at the last word boundary before `max` so we don't
    // cut mid-word (`"hormonal acn…"`). Fall back to a hard slice
    // if there's no space in the first `max` chars.
    const hard = flat.slice(0, max - 1);
    const lastSpace = hard.lastIndexOf(' ');
    const cut = lastSpace >= max * 0.6 ? hard.slice(0, lastSpace) : hard;
    return cut.trimEnd() + '…';
}

function composeMarkdownBody(opts) {
    const {
        title, canonicalUrl, postId, postKind, author, handle,
        verified, bodyText, publishedAt, engagement,
        images, videoUrl
    } = opts;

    const parts = [];

    const kindLabel = postKind === 'reel'  ? 'Facebook Reel'
                    : postKind === 'video' ? 'Facebook Video'
                    : postKind === 'photo' ? 'Facebook Photo'
                    :                        'Facebook Post';

    const hdr = [];
    hdr.push(`**${kindLabel}**: [${title}](${canonicalUrl})`);
    if (author || handle) {
        const verifiedMark = verified ? ' ✓' : '';
        const profileLink = handle ? ` ([@${handle}](https://www.facebook.com/${handle}/))` : '';
        const displayName = author || handle;
        hdr.push(`**Author**: ${displayName}${verifiedMark}${profileLink}`);
    }
    if (publishedAt)                         hdr.push(`**Posted**: ${new Date(publishedAt * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`);
    if (engagement && engagement.reactions != null) hdr.push(`**Reactions**: ${engagement.reactions.toLocaleString()}`);
    if (engagement && engagement.comments  != null) hdr.push(`**Comments**: ${engagement.comments.toLocaleString()}`);
    if (engagement && engagement.shares    != null) hdr.push(`**Shares**: ${engagement.shares.toLocaleString()}`);
    hdr.push(`**Post ID**: \`${postId}\``);
    parts.push(`---\n${hdr.join('  \n')}\n---\n`);

    // Media section. Facebook CDN URLs are signed + ephemeral, so
    // the embedded image is a best-effort snapshot; the screenshot
    // evidence is the durable artifact. Single-image posts get no
    // slide labels; multi-image posts get `**Image N**` labels so
    // the order is preserved through the reader's round-trip.
    if (Array.isArray(images) && images.length > 0) {
        parts.push(`## Media\n`);
        if (images.length === 1) {
            parts.push(`![Facebook post image](${images[0]})\n`);
        } else {
            for (let i = 0; i < images.length; i++) {
                parts.push(`**Image ${i + 1}**\n\n![Facebook post image ${i + 1}](${images[i]})\n`);
            }
        }
    }
    if (videoUrl) {
        parts.push(`## Video\n\n[Open video](${videoUrl}) — *Facebook video URLs are signed and may expire; the screenshot above is the durable artifact.*\n`);
    }

    if (bodyText && bodyText.trim()) {
        parts.push(`## Post\n\n${bodyText.trim()}\n`);
    }

    return parts.join('\n');
}

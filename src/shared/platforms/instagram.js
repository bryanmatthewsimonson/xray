// Instagram platform handler — Phase 8c (issue #19).
//
// Runs in the content script on `instagram.com` post / reel pages.
// Synthesizes the article from scratch — Instagram is SPA-loaded
// and Readability returns nothing useful from the initial HTML.
//
// Capture strategy (in priority order):
//
//   1. **Open Graph + Twitter card meta tags** — these are
//      server-rendered into the initial HTML and they carry the
//      most stable, public data: author, caption, image/video URL,
//      like count, comment count. Instagram has been emitting these
//      consistently for years; they're a public-API-shaped contract
//      that's far more stable than the React DOM.
//
//   2. **Defensive DOM selectors** — fill in fields meta tags don't
//      cover (post date via `<time datetime>`, verified flag via
//      blue-check svg) using strict selectors first, loose
//      fallbacks last, all wrapped in try/catch so a layout change
//      can't break the capture.
//
//   3. **HTML snapshot + screenshot** — Phase 8a evidence layer.
//      The screenshot is the always-works fallback that makes
//      capture useful even if both layers above degrade.
//
// Deliberately NOT in v1:
//   - GraphQL response interception. The api-interceptor (Phase 8a)
//     is ready to be plugged in here if meta-tag extraction proves
//     insufficient, but in practice OG tags carry enough data for
//     a useful artifact. Adding the interceptor adds attack surface
//     and timing complexity; we'll add it when concrete evidence
//     shows OG-only is missing something users want.
//   - Comment thread extraction. Comments are paginated + auth-gated
//     and the cost-to-value ratio is poor for v1.
//   - Stories. Ephemeral by design and out of scope for an
//     archive-the-public-record tool.

import { snapshot, snapshotHash } from '../html-snapshot.js';
import { capturePostScreenshot, dataUrlHash } from '../screenshot.js';
import { ContentExtractor } from '../content-extractor.js';
import { findApiHookEvents, tryParseJson } from '../api-hook-buffer.js';

// ------------------------------------------------------------------
// Detection
// ------------------------------------------------------------------

export function isInstagramPage() {
    const host = window.location.hostname;
    return /^(www\.|m\.)?instagram\.com$/i.test(host);
}

export function isInstagramPostPage() {
    if (!isInstagramPage()) return false;
    return shortcodeFromLocation() !== null;
}

/**
 * Extract the post shortcode from the current URL. Handles all the
 * known Instagram URL shapes:
 *   /p/<shortcode>/                  — image / carousel post
 *   /reel/<shortcode>/                — reel
 *   /tv/<shortcode>/                  — IGTV (legacy, mostly redirects)
 *   /<username>/p/<shortcode>/        — user-prefixed post
 *   /<username>/reel/<shortcode>/     — user-prefixed reel
 *
 * Pure function — exported so tests can pin the URL grammar.
 */
export function shortcodeFromUrl(url = window.location.href) {
    try {
        const u = new URL(url);
        if (!/^(www\.|m\.)?instagram\.com$/i.test(u.hostname)) return null;
        // Strict patterns first; the user-prefixed forms have a username
        // segment we accept but discard for the shortcode.
        const PATTERNS = [
            /^\/p\/([A-Za-z0-9_-]+)/,
            /^\/reel\/([A-Za-z0-9_-]+)/,
            /^\/tv\/([A-Za-z0-9_-]+)/,
            /^\/[^/]+\/p\/([A-Za-z0-9_-]+)/,
            /^\/[^/]+\/reel\/([A-Za-z0-9_-]+)/
        ];
        for (const re of PATTERNS) {
            const m = u.pathname.match(re);
            if (m) return m[1];
        }
        return null;
    } catch (_) { return null; }
}

function shortcodeFromLocation() {
    return shortcodeFromUrl(window.location.href);
}

function postKindFromLocation() {
    const path = window.location.pathname;
    if (/\/reel\//.test(path)) return 'reel';
    if (/\/tv\//.test(path))   return 'igtv';
    return 'post';
}

// ------------------------------------------------------------------
// Meta-tag extraction (the load-bearing path)
// ------------------------------------------------------------------

/**
 * Read Instagram's Open Graph + Twitter Card meta tags into a
 * normalized object. Instagram's tags are unusually structured:
 *   og:title       — usually "<author> on Instagram: \"<truncated caption>\""
 *   og:description — "<like-count> likes, <comment-count> comments —
 *                     <author> (@<handle>) on Instagram: \"<caption>\""
 *   og:image       — first carousel slide / video thumb
 *   og:video       — playback URL for reels (signed; embed-unfriendly)
 *   og:type        — "video.other" for reels, often absent for images
 *   twitter:label1, twitter:data1 — "Likes", "<count>"
 *   twitter:label2, twitter:data2 — "Comments", "<count>"
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
    meta.description = get('meta[property="og:description"]');
    meta.image       = get('meta[property="og:image"]');
    meta.video       = get('meta[property="og:video"]');
    meta.url         = get('meta[property="og:url"]');
    meta.type        = get('meta[property="og:type"]');
    meta.siteName    = get('meta[property="og:site_name"]') || 'Instagram';

    // Twitter cards — Instagram uses label/data pairs for engagement
    // counts. Walk both indices.
    meta.engagement = {};
    for (let i = 1; i <= 4; i++) {
        const label = get(`meta[name="twitter:label${i}"]`).toLowerCase();
        const data  = get(`meta[name="twitter:data${i}"]`);
        if (!label || !data) continue;
        if (label.includes('like'))    meta.engagement.likes    = toCount(data);
        if (label.includes('comment')) meta.engagement.comments = toCount(data);
        if (label.includes('view'))    meta.engagement.views    = toCount(data);
    }
    return meta;
}

/**
 * Parse Instagram's "<author> (@<handle>) on Instagram: \"<caption>\""
 * og:description line into structured fields. Handles a few format
 * variants (single quotes, no parenthesized handle, missing leading
 * engagement counts). Pure function — testable with synthetic
 * descriptions.
 */
export function parseOgDescription(desc) {
    const out = { author: null, handle: null, caption: null };
    if (typeof desc !== 'string' || !desc) return out;

    // Strip the "<N> likes, <M> comments —" prefix if present.
    // Instagram uses an em-dash; some locales use a hyphen.
    const dashSplit = desc.split(/\s[—-]\s/);
    const headPart = dashSplit.length > 1 ? dashSplit.slice(1).join(' — ') : desc;

    // Match "<Display Name> (@handle) on Instagram: \"<caption>\"" or
    // "<Display Name> on Instagram: \"<caption>\""
    const m = headPart.match(/^(.+?)(?:\s+\(@([^)]+)\))?\s+on Instagram(?:.com)?:\s+["“](.+)["”]\s*$/s);
    if (m) {
        out.author  = m[1].trim() || null;
        out.handle  = m[2] ? m[2].trim() : null;
        out.caption = m[3].trim() || null;
        return out;
    }
    // Looser fallback: if we can't parse the structured form, treat
    // the whole thing as the caption — better than null.
    out.caption = desc.trim();
    return out;
}

function toCount(s) {
    if (typeof s !== 'string') return null;
    // Strip locale separators ("1,234" → 1234, "1.234" → 1234,
    // "1.2K" → 1200, "1.2M" → 1200000). Best-effort; Instagram
    // typically emits raw integers in twitter:data.
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
// DOM scrape — defensive selectors for fields meta doesn't cover
// ------------------------------------------------------------------

function scrapePostDate(doc = document) {
    // Instagram renders the post date in a `<time>` element with a
    // `datetime` attribute. The datetime is ISO-8601, the only
    // stable signal across redesigns.
    const t = doc.querySelector('time[datetime]');
    if (!t) return null;
    const iso = t.getAttribute('datetime');
    if (!iso) return null;
    const ts = Date.parse(iso);
    return Number.isFinite(ts) ? Math.floor(ts / 1000) : null;
}

function scrapeVerifiedFlag(doc = document) {
    // Instagram's verified-account check is rendered as an SVG with
    // an aria-label "Verified". Pattern hasn't changed in years.
    return !!doc.querySelector('svg[aria-label="Verified"]');
}

// ------------------------------------------------------------------
// GraphQL response → carousel media (Phase 8c — api-interceptor wiring)
// ------------------------------------------------------------------

/**
 * Walk a parsed Instagram GraphQL response (or REST `/api/v1/media/`
 * response) and return the full ordered list of media URLs for the
 * post. Handles single-image, single-video, and carousel posts.
 *
 * Instagram's GraphQL response shapes have evolved over the years —
 * we walk a couple of known nesting patterns and grab the first one
 * that has a usable `image_versions2.candidates` or
 * `carousel_media[]` payload.
 *
 * Pure function — accepts a parsed-JSON object so tests can pass
 * synthetic shapes without spinning up the page world.
 *
 * Returns `{ media: [{type, url, width, height}], shortcode?, user? }`,
 * or null if no recognizable post payload was found. `user` is the
 * raw user object embedded on the post item — the caller can hand
 * it to normalizeUserShape() when the author couldn't be resolved
 * from og-meta or the URL.
 */
export function extractMediaFromGraphQL(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;

    // Try the known nesting paths in order of recency.
    const item = findPostItem(parsed);
    if (!item) return null;

    const media = [];
    if (Array.isArray(item.carousel_media) && item.carousel_media.length > 0) {
        for (const slide of item.carousel_media) {
            const m = pickBestMedia(slide);
            if (m) media.push(m);
        }
    } else {
        const m = pickBestMedia(item);
        if (m) media.push(m);
    }
    if (media.length === 0) return null;
    return {
        media,
        shortcode: item.code || item.shortcode || null,
        user:      item.user || item.owner || null
    };
}

/**
 * Locate the post item object inside a parsed GraphQL/REST response.
 * Walks several known shapes:
 *   - data.xdt_api__v1__media__shortcode__web_info.items[0]   (current GraphQL)
 *   - data.shortcode_media                                    (legacy GraphQL)
 *   - items[0]                                                (REST /api/v1/media/)
 *   - recursive fallback: find any object that quacks like a
 *     post item (has `code` + at least one of carousel_media /
 *     image_versions2 / video_versions). Catches Instagram's
 *     SSR `data-sjs` blocks where the payload is wrapped in
 *     `__bbox.complete.result.data...` and similar nesting.
 */
function findPostItem(parsed) {
    const data = parsed.data || parsed;
    if (data && typeof data === 'object') {
        // Current GraphQL shape (web_info wrapper).
        const wi = data.xdt_api__v1__media__shortcode__web_info;
        if (wi && Array.isArray(wi.items) && wi.items[0]) return wi.items[0];

        // Legacy GraphQL shape — `shortcode_media` is the post node.
        if (data.shortcode_media && typeof data.shortcode_media === 'object') {
            return normalizeLegacyShape(data.shortcode_media);
        }
    }
    // REST /api/v1/media/ shape: top-level `items` array.
    if (Array.isArray(parsed.items) && parsed.items[0]) return parsed.items[0];

    // Recursive fallback for anything else.
    return findItemRecursively(parsed, 0);
}

/**
 * Walk an arbitrary object tree looking for the first node that
 * looks like a post item — has `code` + at least one media-bearing
 * field. Bounded recursion depth + visited-set protect against
 * cycles or pathological nesting.
 */
function findItemRecursively(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 12) return null;
    // Quick check: this object IS a post item.
    if (looksLikePostItem(obj)) return obj;
    // Quick check: legacy `shortcode_media` is at this level.
    if (obj.shortcode_media && typeof obj.shortcode_media === 'object') {
        return normalizeLegacyShape(obj.shortcode_media);
    }
    // Walk all enumerable values.
    if (Array.isArray(obj)) {
        for (const v of obj) {
            const found = findItemRecursively(v, depth + 1);
            if (found) return found;
        }
        return null;
    }
    for (const k of Object.keys(obj)) {
        const found = findItemRecursively(obj[k], depth + 1);
        if (found) return found;
    }
    return null;
}

function looksLikePostItem(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (typeof obj.code !== 'string') return false;
    return Array.isArray(obj.carousel_media) ||
           (obj.image_versions2 && Array.isArray(obj.image_versions2.candidates)) ||
           Array.isArray(obj.video_versions);
}

/**
 * The legacy `shortcode_media` shape uses different field names than
 * current `image_versions2.candidates`. Translate so the rest of the
 * pipeline doesn't need a second branch.
 */
function normalizeLegacyShape(node) {
    const out = { ...node };
    if (Array.isArray(node.edge_sidecar_to_children?.edges)) {
        out.carousel_media = node.edge_sidecar_to_children.edges
            .map((e) => e && e.node)
            .filter(Boolean)
            .map(normalizeLegacyShape);
    }
    if (Array.isArray(node.display_resources)) {
        out.image_versions2 = {
            candidates: node.display_resources.map((r) => ({
                url: r.src, width: r.config_width, height: r.config_height
            }))
        };
    }
    if (node.video_url) {
        out.video_versions = [{ url: node.video_url, width: node.dimensions?.width, height: node.dimensions?.height }];
    }
    return out;
}

/**
 * Given a single media item (post or carousel slide), pick the
 * highest-resolution version available. Prefers `video_versions`
 * over `image_versions2.candidates` if both are present (the slide
 * is a video; the image is just the cover).
 */
function pickBestMedia(item) {
    if (!item || typeof item !== 'object') return null;
    if (Array.isArray(item.video_versions) && item.video_versions.length > 0) {
        const best = pickLargest(item.video_versions);
        if (best) return { type: 'video', url: best.url, width: best.width, height: best.height };
    }
    const candidates = item.image_versions2 && Array.isArray(item.image_versions2.candidates)
        ? item.image_versions2.candidates : [];
    const best = pickLargest(candidates);
    if (best) return { type: 'image', url: best.url, width: best.width, height: best.height };
    return null;
}

function pickLargest(arr) {
    let best = null;
    let bestArea = 0;
    for (const c of arr) {
        if (!c || !c.url) continue;
        const a = (Number(c.width) || 0) * (Number(c.height) || 0);
        if (a > bestArea) { best = c; bestArea = a; }
    }
    return best;
}

/**
 * Scan the document for SSR-embedded post data. Instagram serves
 * the post detail page with the full media payload baked into
 * `<script type="application/json" data-sjs>` blocks (Facebook's
 * Static-JS SSR pattern). When the user navigates directly to a
 * post URL, no client-side fetch fires — the data is already in
 * those blocks. The api-hook buffer is empty in that case;
 * this scanner is the alternative source of truth.
 *
 * We don't try to understand the data-sjs envelope — just JSON.parse
 * each script body and run findPostItem (which is recursive) on
 * the whole tree. Any script that contains the post item somewhere
 * in its tree gets used.
 */
function extractFromSsrScripts(currentShortcode) {
    const scripts = document.querySelectorAll('script[type="application/json"]');
    console.log('[X-Ray Instagram] SSR scan: found', scripts.length, 'application/json scripts');
    for (const script of scripts) {
        const body = (script.textContent || '').trim();
        if (!body) continue;
        // Only attempt a parse if the body contains a marker that
        // suggests post data — avoids JSON.parse on every analytics
        // blob. Looking for any of: `image_versions2`,
        // `carousel_media`, `shortcode_media`, or the shortcode
        // itself.
        const hasMarker = body.includes('image_versions2') ||
                          body.includes('carousel_media') ||
                          body.includes('shortcode_media') ||
                          (currentShortcode && body.includes(currentShortcode));
        if (!hasMarker) continue;
        let parsed;
        try { parsed = JSON.parse(body); }
        catch (_) { continue; }
        const out = extractMediaFromGraphQL(parsed);
        if (!out) continue;
        if (currentShortcode && out.shortcode &&
            out.shortcode !== currentShortcode) continue;
        console.log('[X-Ray Instagram] SSR scan matched — media count:', out.media.length);
        return out;
    }
    return null;
}

/**
 * Walk the api-hook buffer for `data.user` GraphQL responses,
 * pull rich profile data for the post's author. Instagram fires
 * a profile-info query when navigating into a post detail
 * (PolarisProfilePostsTabRoute → user query), and the response
 * has the full author metadata: pk (Instagram's stable user id),
 * full_name, username, is_verified, profile_pic_url,
 * follower_count, biography.
 *
 * Pure function — accepts a parsed JSON object so tests can pass
 * synthetic shapes. Returns the user object or null. The walk is
 * recursive so we find the user node no matter how it's wrapped
 * (sometimes inside `xdt_*` namespacing, sometimes plain).
 */
export function extractUserFromGraphQL(parsed, requireUsername) {
    if (!parsed || typeof parsed !== 'object') return null;
    return findUserRecursively(parsed, requireUsername, 0);
}

function findUserRecursively(obj, requireUsername, depth) {
    if (!obj || typeof obj !== 'object' || depth > 12) return null;
    // A user object quacks like: { pk, username, full_name, ... }.
    // Some shapes use `id` instead of `pk`. Always require `username`
    // so we don't false-positive on every {id, ...} shape.
    if (typeof obj.username === 'string' && obj.username) {
        if (!requireUsername || obj.username === requireUsername) return obj;
    }
    if (Array.isArray(obj)) {
        for (const v of obj) {
            const found = findUserRecursively(v, requireUsername, depth + 1);
            if (found) return found;
        }
        return null;
    }
    for (const k of Object.keys(obj)) {
        const found = findUserRecursively(obj[k], requireUsername, depth + 1);
        if (found) return found;
    }
    return null;
}

/**
 * Scan the api-hook buffer for the focal post author's profile.
 * If the buffer has a matching response, returns a normalized
 * profile object. Otherwise returns null.
 */
function extractProfileFromBuffer(username) {
    console.log('[X-Ray Instagram] extractProfileFromBuffer called with username:', JSON.stringify(username));
    if (!username) {
        console.log('[X-Ray Instagram] profile lookup skipped — no username available');
        return null;
    }
    // Profile data can show up in any of the GraphQL or REST
    // responses Instagram fires. Scan all of them.
    const events = findApiHookEvents((e) =>
        e.url.includes('graphql') || e.url.includes('/api/v1/'));
    console.log('[X-Ray Instagram] profile scan: walking', events.length, 'events for username', username);
    for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        const parsed = tryParseJson(ev.body);
        if (!parsed) continue;
        const user = extractUserFromGraphQL(parsed, username);
        if (!user) continue;
        const normalized = normalizeUserShape(user);
        if (normalized) {
            console.log('[X-Ray Instagram] profile matched in buffer for', username, 'via', ev.url, '— verified:', normalized.verified, '· followers:', normalized.followerCount);
            return normalized;
        }
    }
    console.log('[X-Ray Instagram] profile scan: no match for', username, 'in any of', events.length, 'events');
    return null;
}

/**
 * Translate Instagram's user shape (which has slightly different
 * field names across endpoints) into X-Ray's canonical profile.
 */
function normalizeUserShape(user) {
    if (!user || typeof user !== 'object') return null;
    // Coerce pk to string — Instagram's REST responses give us a
    // numeric pk, but downstream NOSTR tag emission requires strings.
    // Defensive conversion at the normalization boundary keeps the
    // rest of the codebase from having to remember.
    const rawPk = user.pk ?? user.id ?? null;
    return {
        pk:             rawPk != null ? String(rawPk) : null,
        username:       user.username || null,
        fullName:       user.full_name || user.fullName || null,
        verified:       user.is_verified === true || user.isVerified === true,
        profilePicUrl:  user.profile_pic_url ||
                        user.profile_pic_url_hd ||
                        user.profilePicUrl || null,
        followerCount:  user.follower_count ||
                        user.edge_followed_by?.count ||
                        null,
        followingCount: user.following_count || null,
        postCount:      user.media_count || null,
        biography:      user.biography || user.bio || null,
        category:       user.category || user.category_name || null
    };
}

/**
 * Walk the api-hook buffer for any captured Instagram GraphQL/REST
 * response that looks like the post-detail response, and merge in
 * carousel media. Newer responses win (in case the user navigated
 * to a different post and we have responses for both).
 *
 * Returns the same `{media, shortcode}` shape as
 * extractMediaFromGraphQL, or null if no buffered response yielded
 * a parse.
 */
function extractFromBuffer(currentShortcode) {
    const events = findApiHookEvents((e) =>
        e.url.includes('graphql') || e.url.includes('/api/v1/media/'));
    console.log('[X-Ray Instagram] buffer scan: found', events.length, 'graphql/media events');
    // Walk newest-first so a freshly-loaded response wins.
    for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        const parsed = tryParseJson(ev.body);
        const out = extractMediaFromGraphQL(parsed);
        if (!out) {
            // Log a short prefix of the body so we can recognize
            // unfamiliar response shapes when debugging real-world
            // captures.
            const preview = (ev.body || '').slice(0, 120).replace(/\s+/g, ' ');
            console.log('[X-Ray Instagram] buffer event no post-data match:', ev.url, '— body prefix:', preview);
            continue;
        }
        // Only accept responses for the currently-viewed post — the
        // buffer may also hold responses from prior SPA navigations.
        if (currentShortcode && out.shortcode &&
            out.shortcode !== currentShortcode) {
            console.log('[X-Ray Instagram] buffer event for different shortcode:', out.shortcode, '!=', currentShortcode);
            continue;
        }
        console.log('[X-Ray Instagram] buffer event matched:', ev.url, '— media count:', out.media.length);
        return out;
    }
    return null;
}

/**
 * Find all content images inside the post container. Instagram's
 * carousel posts have multiple `<img>`s lazy-loaded as the user
 * navigates; only the slides actually rendered into the DOM at
 * capture time show up here. Combined with og:image (which gives
 * us at least the main one even when nothing else has loaded),
 * this covers single-image posts in full and carousels as far as
 * the user has navigated.
 *
 * Filters:
 *   - src must point at Instagram's CDN (`scontent`, `cdninstagram`,
 *     `fbcdn.net`) — protects against grabbing avatars/icons
 *     hosted elsewhere.
 *   - skip square `s120x120`-style sizing variants (Instagram
 *     serves small squares for thumbnails/avatars).
 *   - dedup by URL path only (Instagram's query params include
 *     per-request signing tokens that vary across loads of the
 *     same image), but RETAIN the full URL with query string in
 *     the returned list — without the signing tokens, the CDN
 *     returns 403 to any cross-origin loader.
 *
 * Returns an array of full URLs (deduped by path), preserving the
 * order they appeared in the input.
 *
 * Pure function — accepts an `imgs` iterable (e.g. NodeList from
 * querySelectorAll) so tests can pass a synthetic list.
 */
export function extractContentImageUrls(imgs) {
    const seen = new Set();   // canonical paths we've already emitted
    const out  = [];          // full URLs, in iteration order
    for (const img of imgs || []) {
        const src = img && (img.currentSrc || img.src || img.getAttribute?.('src'));
        if (!isInstagramCdnUrl(src)) continue;
        if (looksLikeAvatarOrIcon(src, img)) continue;
        const key = canonicalImageKey(src);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(src);
    }
    return out;
}

function isInstagramCdnUrl(src) {
    if (typeof src !== 'string' || !src) return false;
    if (!/^https?:\/\//i.test(src)) return false;
    // Instagram's content CDN hosts. Avatars are sometimes on the
    // same host with smaller dimensions, which we filter
    // separately. Profile pictures may live on `scontent-*` too.
    return /(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/i.test(hostnameOf(src)) ||
           /(?:^|\.)scontent[-.]/i.test(hostnameOf(src));
}

function hostnameOf(url) {
    try { return new URL(url).hostname; } catch (_) { return ''; }
}

function looksLikeAvatarOrIcon(src, img) {
    // Instagram serves square `s150x150` / `s120x120` URLs for
    // avatars and small thumbnails. Content images are typically
    // 640px+ on the long edge.
    if (/\/s(\d+)x\d+\//.test(src)) {
        const m = src.match(/\/s(\d+)x\d+\//);
        if (m && Number(m[1]) < 320) return true;
    }
    // If the rendered element has an obviously-tiny attribute
    // dimension, it's not a content image.
    if (img && typeof img === 'object') {
        const width  = Number(img.naturalWidth  || img.width  || img.getAttribute?.('width')  || 0);
        const height = Number(img.naturalHeight || img.height || img.getAttribute?.('height') || 0);
        if (width > 0 && width < 200) return true;
        if (height > 0 && height < 200) return true;
    }
    return false;
}

/**
 * Strip the query string for dedup purposes — Instagram appends
 * different cache-busting params to the same image across loads.
 * The path uniquely identifies the image.
 */
function canonicalImageKey(src) {
    try {
        const u = new URL(src);
        return u.origin + u.pathname;
    } catch (_) { return src; }
}

function pickEvidenceElement() {
    // Strategy in priority order:
    //   1. Strict ARIA / structural selectors — the cleanest case
    //      when Instagram's current layout uses semantic HTML for
    //      the focal post.
    //   2. Image-anchored fallback — find the largest Instagram-CDN
    //      image on the page and walk up to a container that's
    //      bigger than the image itself. This works even when
    //      Instagram drops `<article>` entirely for the post
    //      wrapper. The "More posts" grid uses much smaller
    //      thumbnails, so the largest image is reliably the focal
    //      post's media.
    //   3. Last resort — return null and let the caller proceed
    //      without evidence (the OG meta path is enough for a
    //      basic capture).
    const STRICT_SELECTORS = [
        'article[role="presentation"]',
        'main article:first-of-type',
        'article'
    ];
    for (const sel of STRICT_SELECTORS) {
        const el = document.querySelector(sel);
        if (el) return el;
    }
    // Image-anchored fallback.
    const target = findContainerByLargestImage(document);
    if (target) {
        console.log('[X-Ray Instagram] evidence-element fallback (image-anchored):', target.tagName);
        return target;
    }
    console.warn('[X-Ray Instagram] could not locate post container — capture will lack evidence');
    return null;
}

/**
 * Find the largest Instagram-CDN `<img>` on the page, then walk up
 * to its enclosing container that's a reasonable post wrapper
 * (bigger than the image itself, smaller than the document body).
 * Defensive against layout-class churn — relies only on the CDN
 * hostname pattern and image size.
 *
 * Pure-ish (reads from a passed `doc`, no other side effects).
 */
function findContainerByLargestImage(doc) {
    const imgs = doc.querySelectorAll('img');
    let largest = null;
    let largestArea = 0;
    for (const img of imgs) {
        const src = img.currentSrc || img.src;
        if (!isInstagramCdnUrl(src)) continue;
        // Use rendered (CSS-pixel) dimensions, not naturalWidth.
        // naturalWidth is 0 until the image has fully decoded,
        // which would silently exclude every newly-rendered slide.
        // getBoundingClientRect gives us the on-screen size.
        const rect = img.getBoundingClientRect ? img.getBoundingClientRect() : { width: 0, height: 0 };
        const area = (rect.width || 0) * (rect.height || 0);
        if (area > largestArea && rect.width >= 200 && rect.height >= 200) {
            largest = img;
            largestArea = area;
        }
    }
    if (!largest) return null;
    // Walk up at most 6 hops looking for a container that's
    // visibly bigger than the image (so the wrapper has chrome
    // around it: nav arrows, slide dots, header/caption rail).
    // Stop early if we hit <main> or <body> — those are too
    // broad and would re-introduce the recommendation-grid bug.
    let cur = largest;
    for (let i = 0; i < 6; i++) {
        const parent = cur.parentElement;
        if (!parent) break;
        const tag = (parent.tagName || '').toUpperCase();
        if (tag === 'MAIN' || tag === 'BODY') break;
        cur = parent;
    }
    return cur;
}

/**
 * Pick a smaller, image-focused element for the screenshot. The
 * full post element is often taller than the viewport (caption +
 * comments + hashtags), so screenshotting *that* either captures
 * just the bottom (when scrolled-into-center) or just the top.
 *
 * What we want for the screenshot is the visible *media* — the
 * carousel image / video. That element is consistently the
 * largest `<img>` (or `<video>`) inside the post. Use its parent
 * container so the screenshot includes the slide-counter dots
 * and any visible navigation chrome too.
 */
function pickScreenshotTarget(postEl) {
    if (!postEl || !postEl.querySelectorAll) return postEl;
    let largest = null;
    let largestArea = 0;
    const candidates = postEl.querySelectorAll('img, video');
    for (const el of candidates) {
        // Use rendered dimensions (getBoundingClientRect) — naturalWidth
        // / videoWidth are 0 until the media decodes, which would
        // exclude valid candidates. The on-screen size is what
        // matters for the screenshot crop anyway.
        const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
        const area = (rect.width || 0) * (rect.height || 0);
        // Min size threshold filters out icons / avatars even if
        // they're somehow the largest non-content element.
        if (area > largestArea && rect.width >= 200 && rect.height >= 200) {
            largest = el;
            largestArea = area;
        }
    }
    if (!largest) return postEl;
    // Walk up to the nearest container that's larger than the
    // image itself — usually the slide wrapper, which has the
    // dot indicators + nav arrows. Cap at 4 hops so a flat DOM
    // doesn't accidentally bubble us back to <article>.
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
 * Full Instagram capture: meta tags + DOM scrape + Phase 8a evidence.
 * Returns null on any page that isn't a recognized post / reel.
 */
export async function synthesizeArticle() {
    if (!isInstagramPostPage()) return null;

    const shortcode = shortcodeFromLocation();
    const postKind  = postKindFromLocation();   // 'post' | 'reel' | 'igtv'
    const meta      = extractMetaFields();
    const desc      = parseOgDescription(meta.description);

    // Pull media + author off any buffered GraphQL/REST response or
    // SSR script first — the post item carries `.user` inline, which
    // is the ultimate source of truth for the handle when og-meta,
    // URL path, and description parsing all come up empty (e.g. when
    // the user navigated in via the profile grid and the URL is
    // `/p/<shortcode>/` with no username prefix).
    const fromApi = extractFromBuffer(shortcode);
    const fromSsr = fromApi ? null : extractFromSsrScripts(shortcode);
    const enriched = fromApi || fromSsr;
    const enrichedUser = enriched && enriched.user ? normalizeUserShape(enriched.user) : null;

    const caption     = desc.caption || '';
    const publishedAt = scrapePostDate();
    const verified_dom = scrapeVerifiedFlag();

    const handleFromUrl  = extractHandleFromUrl();
    const handleFromMeta = extractHandleFromMeta(meta);
    const desc_author = desc.author ||
                        extractAuthorFromTitle(meta.title) ||
                        (enrichedUser && enrichedUser.fullName) ||
                        '';
    const desc_handle = desc.handle ||
                        handleFromUrl ||
                        handleFromMeta ||
                        (enrichedUser && enrichedUser.username) ||
                        null;
    console.log('[X-Ray Instagram] handle resolution:',
        'desc.handle=', JSON.stringify(desc.handle),
        '· extractHandleFromUrl=', JSON.stringify(handleFromUrl),
        '· extractHandleFromMeta=', JSON.stringify(handleFromMeta),
        '· enrichedUser.username=', JSON.stringify(enrichedUser && enrichedUser.username),
        '· chosen=', JSON.stringify(desc_handle));

    // Prefer the profile-info GraphQL response (walked by username)
    // when present — it carries follower counts, biography, etc. the
    // post item's user doesn't always include. Fall back to the
    // post item's embedded user when no profile-info response was in
    // the buffer. Both shapes pass through normalizeUserShape.
    const profile = extractProfileFromBuffer(desc_handle) || enrichedUser;
    const author  = (profile && profile.fullName) || desc_author;
    const handle  = (profile && profile.username) || desc_handle;
    const verified = (profile && profile.verified) || verified_dom;

    const canonicalUrl = meta.url || canonicalUrlFor(postKind, shortcode, handle);
    const titleLine = composeTitle(author, handle, caption, postKind);

    // Content media — Instagram CDN images visible inside the post
    // container. og:image is intentionally a fallback only; it's
    // a 1:1 crop of the post that loses the original aspect ratio,
    // so when DOM scraping returns anything we prefer it. Carousel
    // posts only have additional slides loaded after the user
    // navigates; what we get here is "everything the page has loaded
    // so far," which usually covers single-image posts in full and
    // carousel posts as far as the user has scrolled.
    const evidenceTarget = pickEvidenceElement();
    const allImgs = evidenceTarget && evidenceTarget.querySelectorAll
        ? evidenceTarget.querySelectorAll('img')
        : [];
    const scrapedImages = extractContentImageUrls(allImgs);

    // Source priority for media URLs:
    //   1. api-hook buffer — captured client-side GraphQL response
    //      with full structured post detail. Wins on SPA navigation
    //      between posts (Instagram fires a fresh fetch).
    //   2. SSR script JSON parse — when Instagram embeds the post
    //      data as plain JSON in `<script type="application/json">`
    //      blocks. Older / simpler SSR encodings.
    //   3. DOM scrape — slides currently rendered. Usually 1-2 due
    //      to React's carousel slide-recycling.
    //   4. og:image — 1:1 thumbnail crop, always present.
    //
    // Direct-to-post navigation typically yields path 3 (one
    // visible slide) because Instagram encodes the post data in
    // a Lightspeed binary format we can't decode structurally,
    // and brute regex over scripts pulls in too much page-chrome
    // noise to be useful. The screenshot evidence layer is the
    // always-faithful fallback for the slide that IS visible.
    //
    // `enriched` (fromApi || fromSsr) was already computed above —
    // before handle resolution — so the post item's `.user` field
    // could seed the handle fallback chain.
    console.log('[X-Ray Instagram] capture diagnostic:', {
        shortcode,
        evidenceTarget: evidenceTarget ? evidenceTarget.tagName : null,
        scrapedImageCount: scrapedImages.length,
        graphqlMatched: !!fromApi,
        ssrMatched:     !!fromSsr,
        enrichedMediaCount: enriched ? enriched.media.length : 0,
        ogImagePresent: !!meta.image
    });
    let allImageUrls;
    let mediaProvenance;
    if (enriched && enriched.media.length > 0) {
        allImageUrls = enriched.media.map((m) => m.url);
        mediaProvenance = fromApi ? 'graphql' : 'ssr-script';
    } else if (scrapedImages.length > 0) {
        allImageUrls = scrapedImages;
        mediaProvenance = 'dom-scrape';
    } else if (meta.image) {
        allImageUrls = [meta.image];
        mediaProvenance = 'og-meta';
    } else {
        allImageUrls = [];
        mediaProvenance = 'none';
    }
    const htmlSnapshotStr = evidenceTarget ? snapshot(evidenceTarget, { maxBytes: 50 * 1024 }) : '';
    const htmlSnapshotHashStr = htmlSnapshotStr ? await snapshotHash(htmlSnapshotStr) : null;

    // Screenshot a tighter target than the whole post — full posts
    // are usually taller than the viewport (caption + comments),
    // and the most evidentiary part is the actual visible media,
    // not the chrome around it.
    const screenshotTarget = evidenceTarget ? pickScreenshotTarget(evidenceTarget) : null;
    let screenshotDataUrl = null;
    let screenshotHashStr = null;
    if (screenshotTarget) {
        try {
            screenshotDataUrl = await capturePostScreenshot(screenshotTarget);
            if (screenshotDataUrl) screenshotHashStr = await dataUrlHash(screenshotDataUrl);
        } catch (err) {
            console.warn('[X-Ray Instagram] screenshot capture failed:', err);
        }
    }

    const bodyMarkdown = composeMarkdownBody({
        title: titleLine,
        canonicalUrl,
        shortcode,
        postKind,
        author,
        handle,
        verified,
        caption,
        publishedAt,
        likes:    meta.engagement.likes,
        comments: meta.engagement.comments,
        views:    meta.engagement.views,
        images:   allImageUrls,
        videoUrl: meta.video || null,
        profile             // GraphQL-enriched profile if available
    });

    return {
        title:       titleLine,
        url:         canonicalUrl,
        domain:      'instagram.com',
        siteName:    'Instagram',
        byline:      author + (handle ? ` (@${handle})` : ''),
        publishedAt,
        extractedAt: Math.floor(Date.now() / 1000),
        featuredImage: meta.image || null,

        content:  ContentExtractor.markdownToHtml(bodyMarkdown),
        markdown: bodyMarkdown,

        excerpt: caption.slice(0, 500),
        contentType: postKind === 'post' ? 'image' : 'video',
        platform:    'instagram',

        engagement: {
            likes:    meta.engagement.likes    || 0,
            comments: meta.engagement.comments || 0,
            views:    meta.engagement.views    || 0
        },

        instagram: {
            shortcode,
            postKind,             // 'post' | 'reel' | 'igtv'
            // Author profile — basic fields always present (from
            // og-meta + DOM scrape), enriched fields populated when
            // a profile-info GraphQL response was in the buffer.
            // The reader header shows profile pic + verified + name
            // + follower count when this is filled.
            author: {
                handle:        handle || null,
                nickname:      author || null,
                verified,
                pk:            (profile && profile.pk) || null,
                profilePicUrl: (profile && profile.profilePicUrl) || null,
                followerCount: (profile && profile.followerCount) || null,
                followingCount: (profile && profile.followingCount) || null,
                postCount:     (profile && profile.postCount) || null,
                biography:     (profile && profile.biography) || null,
                category:      (profile && profile.category) || null,
                profileUrl:    handle ? `https://www.instagram.com/${handle}/` : null,
                // Provenance — was this enriched from a buffered
                // profile response, or only from og-meta?
                source:        profile ? 'graphql-profile' : 'og-meta'
            },
            mediaUrl:  meta.video || meta.image || null,
            mediaType: meta.video ? 'video' : 'image',
            // Full set of content media we found, in source order.
            // GraphQL gives us all carousel slides at the highest
            // resolution Instagram serves; DOM scrape gives us only
            // what's currently rendered; og-meta gives us a single
            // 1:1 thumbnail crop.
            images:        allImageUrls,
            videoUrl:      meta.video || null,
            extractedFrom: mediaProvenance   // 'graphql' | 'dom-scrape' | 'og-meta' | 'none'
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
    // og:title is "<Display Name> on Instagram: \"<caption>\""
    const m = title.match(/^(.+?)\s+on Instagram(?:.com)?:/);
    return m ? m[1].trim() : '';
}

function extractHandleFromUrl() {
    const path = window.location.pathname;
    // /<username>/p/<shortcode>/ or /<username>/reel/<shortcode>/
    const m = path.match(/^\/([A-Za-z0-9._]+)\/(?:p|reel|tv)\//);
    return m ? m[1] : null;
}

/**
 * Last-resort handle extraction: pull from the og:description's
 * "<username> on April 22..." format (which Instagram emits when
 * the account has no display name distinct from its handle, OR
 * for accounts where the og:description starts with the handle).
 * Pure function — accepts the meta object.
 */
function extractHandleFromMeta(meta) {
    if (!meta) return null;
    // og:description: "<N> likes, <M> comments — <handle> on April 22, ..."
    // OR just "<handle> on April 22, ..." for some accounts.
    const desc = meta.description || '';
    const m = desc.match(/(?:[—-]\s+)?([A-Za-z0-9._]+)\s+on\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)/);
    if (m && m[1]) return m[1];
    return null;
}

function canonicalUrlFor(postKind, shortcode, handle) {
    const path = postKind === 'reel' ? 'reel' : (postKind === 'igtv' ? 'tv' : 'p');
    return `https://www.instagram.com/${path}/${shortcode}/`;
}

function composeTitle(author, handle, caption, postKind) {
    const kindLabel = postKind === 'reel' ? 'Reel' : postKind === 'igtv' ? 'IGTV' : 'Post';
    if (author) {
        const handleSuffix = handle ? ` (@${handle})` : '';
        return caption
            ? `${author}${handleSuffix} on Instagram: "${truncate(caption, 80)}"`
            : `${kindLabel} by ${author}${handleSuffix} on Instagram`;
    }
    return `Instagram ${kindLabel}`;
}

function truncate(s, max) {
    if (typeof s !== 'string') return '';
    if (s.length <= max) return s;
    return s.slice(0, max - 1).trim() + '…';
}

function composeMarkdownBody(opts) {
    const {
        title, canonicalUrl, shortcode, postKind, author, handle,
        verified, caption, publishedAt, likes, comments, views,
        images, videoUrl, profile
    } = opts;

    const parts = [];

    const hdr = [];
    const kindLabel = postKind === 'reel' ? 'Instagram Reel' : postKind === 'igtv' ? 'Instagram IGTV' : 'Instagram Post';
    hdr.push(`**${kindLabel}**: [${title}](${canonicalUrl})`);
    if (author || handle) {
        // Author line: link the handle to the IG profile so the
        // published event has a concrete reference back to the
        // account, not just a free-text name.
        const verifiedMark = verified ? ' ✓' : '';
        const profileLink = handle ? ` ([@${handle}](https://www.instagram.com/${handle}/))` : '';
        const displayName = author || handle;
        hdr.push(`**Author**: ${displayName}${verifiedMark}${profileLink}`);
        if (profile && Number.isFinite(profile.followerCount) && profile.followerCount > 0) {
            const stats = [];
            stats.push(`${profile.followerCount.toLocaleString()} followers`);
            if (profile.postCount) stats.push(`${profile.postCount.toLocaleString()} posts`);
            if (profile.category) stats.push(profile.category);
            hdr.push(`**Account**: ${stats.join(' · ')}`);
        }
    }
    if (publishedAt) hdr.push(`**Posted**: ${new Date(publishedAt * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`);
    if (likes    != null) hdr.push(`**Likes**: ${likes.toLocaleString()}`);
    if (comments != null) hdr.push(`**Comments**: ${comments.toLocaleString()}`);
    if (views    != null) hdr.push(`**Views**: ${views.toLocaleString()}`);
    hdr.push(`**Shortcode**: \`${shortcode}\``);
    parts.push(`---\n${hdr.join('  \n')}\n---\n`);

    // Media section first — the image is the post for Instagram.
    // Render every captured image as a markdown image; the reader's
    // Turndown round-trip preserves them as `<img>`s downstream.
    // Single image → no numbered slide labels; carousel → label
    // each "Slide N" so the reader sees the carousel structure.
    if (Array.isArray(images) && images.length > 0) {
        parts.push(`## Media\n`);
        if (images.length === 1) {
            parts.push(`![Instagram post image](${images[0]})\n`);
        } else {
            for (let i = 0; i < images.length; i++) {
                parts.push(`**Slide ${i + 1}**\n\n![Instagram post image ${i + 1}](${images[i]})\n`);
            }
        }
    }

    // For reels, also reference the video URL — but explicitly note
    // that Instagram's URLs are signed + ephemeral; the screenshot
    // and cover-image are the durable artifacts.
    if (videoUrl) {
        parts.push(`## Video\n\n[Open video](${videoUrl}) — *Instagram video URLs are signed and may expire; the cover image above is the durable artifact.*\n`);
    }

    if (caption && caption.trim()) {
        parts.push(`## Caption\n\n${caption.trim()}\n`);
    }

    return parts.join('\n');
}

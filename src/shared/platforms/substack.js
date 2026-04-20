// Substack platform handler — runs in the content script after
// ContentExtractor.extractArticle has produced its Readability output.
//
// Responsibilities (this file):
//   - Detect Substack (subdomain OR custom-domain)
//   - Extract the three things we need to talk to Substack's public API:
//       * slug        — from the URL path (/p/<slug>)
//       * handle      — null on custom-domain, else the subdomain
//       * apiOrigin   — prefers <link rel="canonical"> origin
//
// Everything else (post metadata, body, engagement, comments) now comes
// from Substack's /api/v1/posts/<slug> endpoint. See substack-api.js.
// That's a strict upgrade over DOM scraping: richer data, works on both
// subdomain and custom-domain publications, and — most importantly —
// fetching with credentials:'include' automatically unlocks full content
// for paywalled posts when the user is logged into Substack.

// ------------------------------------------------------------------
// Detection
// ------------------------------------------------------------------

export function isSubstackPage() {
    const host = window.location.hostname;
    if (host.endsWith('.substack.com') || host === 'substack.com') return true;
    // Custom-domain signals. Any one of these is diagnostic on its own —
    // no real-site publisher uses Substack's CDN unless they're hosted
    // on Substack.
    if (document.querySelector('meta[name="generator"][content*="Substack"]')) return true;
    if (document.querySelector('link[rel="stylesheet"][href*="substackcdn.com"]')) return true;
    if (document.querySelector('script[src*="substackcdn.com"]')) return true;
    return false;
}

// ------------------------------------------------------------------
// URL / origin extraction
// ------------------------------------------------------------------

/**
 * Parse the Substack post slug from the current URL. Substack post URLs
 * have the shape `/p/<slug>` (sometimes `/i/<id>/<slug>` on legacy paths).
 * Returns null on pages that aren't post-shaped (e.g. the home feed).
 */
export function extractSlug() {
    const path = window.location.pathname;
    // Standard: /p/<slug>
    let m = path.match(/^\/p\/([^/?#]+)/);
    if (m) return m[1];
    // Legacy: /i/<id>/<slug>
    m = path.match(/^\/i\/\d+\/([^/?#]+)/);
    if (m) return m[1];
    return null;
}

/**
 * Substack's public read API is served from the publication's canonical
 * origin. For custom-domain Substacks (e.g. thefp.com) both the custom
 * origin and the <subdomain>.substack.com variant typically work; we
 * prefer the canonical origin advertised by the page because that's
 * what the page's own client talks to — saves a CORS hop.
 */
export function getApiOrigin() {
    const canonLink = document.querySelector('link[rel="canonical"]');
    if (canonLink && canonLink.href) {
        try { return new URL(canonLink.href).origin; } catch (_) { /* fallthrough */ }
    }
    return window.location.origin;
}

/**
 * Author handle for subdomain Substacks. Returns null for custom-domain
 * publications — the only "handle" there is the publication id, which
 * comes back from the API.
 */
export function extractSubdomainHandle() {
    const host = window.location.hostname;
    if (host.endsWith('.substack.com') && host !== 'substack.com') {
        return host.replace(/\.substack\.com$/, '');
    }
    return null;
}

// ------------------------------------------------------------------
// Main enricher
// ------------------------------------------------------------------

/**
 * Layer Substack-specific routing hints onto a Readability-extracted
 * article. The actual content upgrade (full body, accurate engagement,
 * etc.) happens in the reader once the API fetch resolves — see
 * reader/index.js `loadSubstackData`.
 *
 * Never throws — missing fields degrade to null, the original article
 * still makes it to the reader.
 */
export function enrichArticle(article) {
    if (!article) return article;

    article.platform = 'substack';
    article.substack = {
        slug:      safe(extractSlug),
        handle:    safe(extractSubdomainHandle),
        apiOrigin: safe(getApiOrigin),
        // Populated by the reader when the /api/v1/posts/<slug> fetch
        // resolves. Kept here so downstream event-builder code that
        // expects article.substack.postId still has a known location.
        postId: null
    };

    return article;
}

function safe(fn) {
    try { return fn(); } catch (_) { return null; }
}

// Platform handler dispatch.
//
// Each platform registers a handler object with up to two methods:
//
//   synthesize() → article   for platforms where the page isn't
//                            article-shaped and Readability returns
//                            garbage (YouTube, Twitter, etc.). Builds
//                            the article object from scratch — often
//                            from an embedded preloaded-state JSON
//                            and/or the platform's public API.
//
//   enrich(article) → article for platforms where Readability does a
//                            decent baseline job and the handler just
//                            layers platform-specific fields on top
//                            (Substack).
//
// UI.openReader calls `captureForPlatform(platform)` first. If that
// returns an article, we ship it. Otherwise we fall back to
// Readability + `enrichArticleForPlatform(article, platform)`.
//
// Currently registered:
//   substack   ✓ Phase 3a (#14)   — enrich-only
//   youtube    ✓ Phase 3b (#14)   — synthesize-only
//   twitter    ☐ Phase 3c
//   facebook/instagram/tiktok ☐ Phase 8

import * as substack from './substack.js';
import * as youtube  from './youtube.js';

/** @typedef {{ synthesize?: () => Promise<object|null>, enrich?: (article: object) => Promise<object|null> | object|null }} PlatformHandler */

/** @type {Record<string, PlatformHandler>} */
const HANDLERS = {
    substack: {
        enrich: (article) => substack.enrichArticle(article)
    },
    youtube: {
        synthesize: () => youtube.synthesizeArticle()
    }
};

/**
 * Try to build an article from scratch via the platform's handler.
 * Returns null if there's no handler, no synthesize method, or the
 * method declined (e.g. not a recognized page shape on that platform).
 */
export async function captureForPlatform(platform) {
    if (!platform) return null;
    const h = HANDLERS[platform];
    if (!h || typeof h.synthesize !== 'function') return null;
    try {
        return (await h.synthesize()) || null;
    } catch (err) {
        console.warn('[X-Ray] Platform synthesize failed for', platform, err);
        return null;
    }
}

/**
 * Layer platform-specific enrichment onto an already-extracted article.
 * Unknown platforms pass the article through unchanged.
 */
export async function enrichArticleForPlatform(article, platform) {
    if (!article || !platform) return article;
    const h = HANDLERS[platform];
    if (!h || typeof h.enrich !== 'function') return article;
    try {
        const enriched = await h.enrich(article);
        return enriched || article;
    } catch (err) {
        console.warn('[X-Ray] Platform enrichment failed for', platform, err);
        return article;
    }
}

/**
 * DOM-based platform detection as a fallback when ContentDetector's
 * URL-only pass can't decide (e.g. custom-domain Substacks).
 */
export function detectPlatformFromDom() {
    if (substack.isSubstackPage()) return 'substack';
    if (youtube.isYouTubeVideoPage()) return 'youtube';
    return null;
}

export { HANDLERS as _HANDLERS };

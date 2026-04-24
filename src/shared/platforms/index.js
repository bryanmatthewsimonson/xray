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
//   twitter    ✓ Phase 3c (#14)   — synthesize-only
//   tiktok     ✓ Phase 8b (#19)   — synthesize-only, screenshot-evidence
//   instagram  ✓ Phase 8c (#19)   — synthesize-only, og-meta + screenshot
//   facebook   ✓ Phase 8d (#19)   — synthesize-only, graphql + og-meta + screenshot

import * as substack  from './substack.js';
import * as youtube   from './youtube.js';
import * as twitter   from './twitter.js';
import * as tiktok    from './tiktok.js';
import * as instagram from './instagram.js';
import * as facebook  from './facebook.js';
import { extractGenericComments } from './comment-extractor.js';

/** @typedef {{ synthesize?: () => Promise<object|null>, enrich?: (article: object) => Promise<object|null> | object|null }} PlatformHandler */

/** @type {Record<string, PlatformHandler>} */
const HANDLERS = {
    substack: {
        enrich: (article) => substack.enrichArticle(article)
    },
    youtube: {
        synthesize: () => youtube.synthesizeArticle()
    },
    twitter: {
        synthesize: () => twitter.synthesizeArticle()
    },
    tiktok: {
        synthesize: () => tiktok.synthesizeArticle()
    },
    instagram: {
        synthesize: () => instagram.synthesizeArticle()
    },
    facebook: {
        synthesize: () => facebook.synthesizeArticle()
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
 *
 * After platform-specific enrichment runs, also try the generic
 * comment extractor — it's a no-op on pages without a recognizable
 * comment system, and a useful fallback on WordPress / generic sites
 * that don't have a dedicated handler. If the platform handler
 * already populated `article.comments`, we leave them alone (their
 * own extraction is authoritative).
 */
export async function enrichArticleForPlatform(article, platform) {
    if (!article) return article;
    let enriched = article;
    if (platform) {
        const h = HANDLERS[platform];
        if (h && typeof h.enrich === 'function') {
            try {
                enriched = (await h.enrich(article)) || article;
            } catch (err) {
                console.warn('[X-Ray] Platform enrichment failed for', platform, err);
            }
        }
    }
    if (!enriched.comments || enriched.comments.length === 0) {
        try {
            const result = extractGenericComments();
            if (result && result.comments && result.comments.length > 0) {
                enriched.comments = result.comments;
                enriched._commentsSource = result.platform;     // for diagnostics
            } else if (result && result.note) {
                enriched._commentsNote = result.note;            // surfaceable in the reader
            }
        } catch (err) {
            console.warn('[X-Ray] Generic comment extraction failed:', err);
        }
    }
    return enriched;
}

/**
 * DOM-based platform detection as a fallback when ContentDetector's
 * URL-only pass can't decide (e.g. custom-domain Substacks).
 */
export function detectPlatformFromDom() {
    if (substack.isSubstackPage()) return 'substack';
    if (youtube.isYouTubeVideoPage()) return 'youtube';
    if (twitter.isTwitterPage()) return 'twitter';
    return null;
}

export { HANDLERS as _HANDLERS };

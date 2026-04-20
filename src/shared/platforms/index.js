// Platform handler dispatch.
//
// Given an article extracted by the generic pipeline and a platform
// identifier from ContentDetector, layer platform-specific enrichments
// on top before handing off to the reader. Each platform is a small
// module exporting `enrichArticle(article)` — we avoid the userscript's
// registry indirection because, in X-Ray, the set of platforms is
// compile-time fixed and auto-dispatched.
//
// Currently supported:
//   substack   ✓ Phase 3a (#14)
//   youtube    ☐ Phase 3b
//   twitter    ☐ Phase 3c
//   facebook/instagram/tiktok ☐ Phase 8 (anti-obfuscation stack)
//
// Unknown / unsupported platforms pass the article through untouched
// so the generic Readability extraction stands on its own.

import { enrichArticle as enrichSubstack, isSubstackPage } from './substack.js';

const HANDLERS = {
    substack: enrichSubstack
};

/**
 * Apply the platform-specific enricher, if we have one, to a
 * generically-extracted article. Safe to call with any platform id —
 * unknown platforms return the article unchanged.
 *
 * @param {object}  article  Output of ContentExtractor.extractArticle()
 * @param {string=} platform Platform id from ContentDetector.detect()
 * @returns {Promise<object>} the (possibly enriched) article
 */
export async function enrichArticleForPlatform(article, platform) {
    if (!article || !platform) return article;
    const fn = HANDLERS[platform];
    if (!fn) return article;
    try {
        const enriched = await fn(article);
        return enriched || article;
    } catch (err) {
        console.warn('[X-Ray] Platform enrichment failed for', platform, err);
        return article;
    }
}

/**
 * DOM-based platform detection as a fallback when ContentDetector's
 * URL-only pass can't decide. Called by the content script if
 * ContentDetector returns platform: null.
 */
export function detectPlatformFromDom() {
    if (isSubstackPage()) return 'substack';
    return null;
}

export { HANDLERS as _HANDLERS };

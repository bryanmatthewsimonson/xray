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
//   pmc        ✓ Phase 18 C2 tail — enrich-only, references + figure captions
//   arxiv      ✓ Phase 18 C2 tail — enrich-only, ar5iv full-text preference

import * as substack  from './substack.js';
import * as youtube   from './youtube.js';
import * as twitter   from './twitter.js';
import * as tiktok    from './tiktok.js';
import * as instagram from './instagram.js';
import * as facebook  from './facebook.js';
import * as pmc       from './pmc.js';
import * as arxiv     from './arxiv.js';
import { extractGenericComments } from './comment-extractor.js';
import { extractScholarlyMeta } from './scholar-meta.js';
import { ContentExtractor } from '../content-extractor.js';
import { resolveUrlIdentity, rewriteArchivedLinks } from '../url-identity.js';
import { recordAlias } from '../url-aliases.js';
import { Utils } from '../utils.js';

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
    },
    // Phase 18 C2 tail — scholarly enrich handlers. Both are pure
    // modules; the real DOM / URL / fetch are closed over HERE, so the
    // handlers stay node-testable with stubs.
    pmc: {
        enrich: (article) => pmc.enrichArticle(
            article,
            typeof document !== 'undefined' ? document : null,
            (typeof window !== 'undefined' && window.location && window.location.href) || ''
        )
    },
    arxiv: {
        enrich: (article) => arxiv.enrichArticle(article, {
            url: (typeof window !== 'undefined' && window.location && window.location.href) || '',
            // Content scripts cannot cross-origin fetch under MV3 —
            // the SW fetches on our behalf (host-allowlisted there).
            fetchHtml: async (u) => {
                try {
                    const resp = await chrome.runtime.sendMessage({ type: 'xray:scholar:fetch', url: u });
                    return (resp && resp.ok && typeof resp.html === 'string') ? resp.html : null;
                } catch (_) { return null; }
            },
            extract: (html, baseUrl) => ContentExtractor.extractFromHtmlString(html, baseUrl)
        })
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
    // Phase 18 C2 — scholarly metadata (DOI / arXiv / journal /
    // citation authors) from standard meta tags. Generic like the
    // comment pass below: a no-op on non-scholarly pages. Runs BEFORE
    // handler dispatch on purpose (C2 tail): the arxiv handler reads
    // article.scholar.arxiv_id to decide what to fetch, and pmc reads
    // scholar ids to avoid re-deriving them — with the old ordering
    // (scholar after dispatch) the arxiv enrich was a permanent no-op.
    // Safe to hoist: this pass is side-effect-free and substack, the
    // only other enrich handler, never reads article.scholar.
    if (!enriched.scholar && typeof document !== 'undefined') {
        try {
            const scholar = extractScholarlyMeta(document,
                (typeof window !== 'undefined' && window.location && window.location.href) || '');
            if (scholar) enriched.scholar = scholar;
        } catch (err) {
            console.warn('[X-Ray] Scholarly metadata extraction failed:', err);
        }
    }
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
    // URL identity — a capture made on an archive/mirror re-keys to the
    // recovered ORIGINAL (original-as-identity; JOURNAL 2026-07-09) and
    // keeps the fetched address as provenance. Fail-open: when the
    // original can't be verified, only archive_host is noted (the
    // reader chip says "original URL not recovered") and identity stays
    // with the address actually fetched.
    if (typeof document !== 'undefined' && typeof window !== 'undefined' && window.location) {
        try {
            // Pass the extractor's canonical pick too: archive.today's
            // rel=canonical is the LONG form embedding the original,
            // recoverable by pure URL structure even on short-code tabs.
            const identity = resolveUrlIdentity(document, window.location.href, enriched.url || null);
            if (identity) {
                enriched.archive_host = identity.archiveHost;
                if (identity.original) {
                    enriched.capture_url = identity.captureUrl;
                    enriched.url = identity.original;
                    // A successful recovery IS an alias observation —
                    // record it so URL-keyed joins heal through either
                    // address (url-aliases.js). Fire-and-forget.
                    recordAlias(identity.captureUrl, identity.original).catch(() => {});
                    // Everything derived from the pre-identity URL must
                    // re-key with it. domain fed the links' internal
                    // classification; the links themselves were
                    // extracted from a DOM whose anchors the archive
                    // rewrote onto its own host — without the rewrite,
                    // every outbound link reads archive-internal and
                    // the publish path emits ZERO link tags.
                    enriched.domain = Utils.getDomain(identity.original) || enriched.domain;
                    if (Array.isArray(enriched.links)) {
                        enriched.links = rewriteArchivedLinks(enriched.links, enriched.domain);
                    }
                }
            }
        } catch (err) {
            console.warn('[X-Ray] URL identity resolution failed:', err);
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

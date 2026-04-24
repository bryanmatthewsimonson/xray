// TikTok platform handler — Phase 8b (issue #19).
//
// Runs in the content script on `tiktok.com` video pages.
// Synthesizes the article from scratch — TikTok pages are video-
// shaped, not article-shaped, and Readability returns nothing
// useful. Composes a NIP-23 (`kind: 30023`) event with rich
// metadata + a video-shaped reader header (mirrors the YouTube
// handler's structure).
//
// Why TikTok is the easiest hard-tier platform:
//   - Most metadata lives in a server-side-rendered JSON blob
//     (`__UNIVERSAL_DATA_FOR_REHYDRATION__`, `SIGI_STATE`, or
//     `__NEXT_DATA__` depending on the route + recency). No need
//     to hook fetch/XHR — just parse the script tag.
//   - URL pattern is canonical: `/@<user>/video/<id>` for desktop;
//     `vm.tiktok.com/<short>` redirects (we don't follow redirects
//     here — capture works on the resolved URL only).
//   - DOM scraping isn't needed for the metadata path; the screenshot
//     fallback handles "page changed shape under us" cases.
//
// Three-layer capture model (Phase 8a infra):
//   1. Structured extraction from the embedded JSON blob (this file)
//   2. HTML snapshot of the video container (always-on safety net)
//   3. Screenshot of the video card (always-on safety net)

import { snapshot, snapshotHash } from '../html-snapshot.js';
import { capturePostScreenshot, dataUrlHash } from '../screenshot.js';
import { ContentExtractor } from '../content-extractor.js';

// ------------------------------------------------------------------
// Detection
// ------------------------------------------------------------------

export function isTikTokPage() {
    const host = window.location.hostname;
    return /^(www\.|m\.)?tiktok\.com$/i.test(host);
}

export function isTikTokVideoPage() {
    if (!isTikTokPage()) return false;
    return videoIdFromLocation() !== null;
}

/**
 * Pull the video id out of the URL. Handles the canonical desktop
 * shape; short-link domains (`vm.tiktok.com/<short>`) aren't
 * supported here because they require a redirect we'd have to
 * follow before extraction even makes sense.
 */
function videoIdFromLocation() {
    const path = window.location.pathname;
    // /@username/video/1234567890 — the canonical detail page.
    const m = path.match(/\/@[^/]+\/video\/(\d+)/);
    return m ? m[1] : null;
}

function usernameFromLocation() {
    const path = window.location.pathname;
    const m = path.match(/\/@([^/]+)/);
    return m ? m[1] : null;
}

// ------------------------------------------------------------------
// State extraction — defensive across TikTok's three SSR script tags
// ------------------------------------------------------------------

/**
 * Walk the page's known SSR script tags in order of recency and
 * return the first one whose JSON parse succeeds. Each variant is
 * tagged so callers can branch on shape.
 *
 * Returns `{ source, data }` or null if no script was usable.
 */
export function parseSsrState(doc = document) {
    // Order matters: newest format first. TikTok serves multiple
    // formats simultaneously on some routes; we want the freshest.
    const VARIANTS = [
        { id: '__UNIVERSAL_DATA_FOR_REHYDRATION__', source: 'universal' },
        { id: 'SIGI_STATE',                          source: 'sigi'      },
        { id: '__NEXT_DATA__',                       source: 'nextdata'  }
    ];
    for (const v of VARIANTS) {
        const el = doc.getElementById(v.id);
        if (!el) continue;
        try {
            return { source: v.source, data: JSON.parse(el.textContent || '') };
        } catch (_) { /* try next */ }
    }
    return null;
}

/**
 * Reach into the SSR blob and pull out the canonical `itemStruct`
 * for the focal video. The path differs per SSR variant — handle
 * each. Pure function; testable with synthetic blobs.
 *
 * Returns the itemStruct object or null if not found.
 */
export function extractItemStruct(state) {
    if (!state || typeof state !== 'object') return null;
    const { source, data } = state;
    if (!data || typeof data !== 'object') return null;

    if (source === 'universal') {
        // data.__DEFAULT_SCOPE__["webapp.video-detail"].itemInfo.itemStruct
        const scope = data['__DEFAULT_SCOPE__'];
        const detail = scope && scope['webapp.video-detail'];
        const info = detail && detail.itemInfo;
        return (info && info.itemStruct) || null;
    }
    if (source === 'sigi') {
        // SIGI_STATE.ItemModule[<id>] — keyed by video id, may have many items
        const mod = data.ItemModule;
        if (!mod || typeof mod !== 'object') return null;
        const id = videoIdFromLocation();
        if (id && mod[id]) return mod[id];
        // Fallback: first item in the module if id-keyed lookup misses.
        const first = Object.values(mod).find((v) => v && typeof v === 'object');
        return first || null;
    }
    if (source === 'nextdata') {
        // props.pageProps.itemInfo.itemStruct (older Next.js routes)
        const pp = data.props && data.props.pageProps;
        const info = pp && pp.itemInfo;
        return (info && info.itemStruct) || null;
    }
    return null;
}

// ------------------------------------------------------------------
// Article synthesis
// ------------------------------------------------------------------

/**
 * Full TikTok capture: parse SSR state, compose article object the
 * existing reader + event-builder consume. Returns null on any page
 * that isn't a TikTok video page.
 *
 * Phase 8b composition:
 *   1. Structured extraction from itemStruct
 *   2. HTML snapshot of the video container subtree
 *   3. Element-cropped screenshot of the same container
 * Layers 2 + 3 land in `article.evidence` — best-effort, never
 * fail the capture if either is unavailable.
 */
export async function synthesizeArticle() {
    if (!isTikTokVideoPage()) return null;

    const state = parseSsrState();
    const item  = extractItemStruct(state);
    const videoId = videoIdFromLocation();
    const username = usernameFromLocation();

    // Even when the SSR blob is missing or its shape changed, ship
    // SOMETHING. Screenshot + URL is still an evidentiary artifact.
    const fallbackTitle = item
        ? (item.desc || `TikTok video by @${username || 'unknown'}`)
        : `TikTok video by @${username || 'unknown'}`;

    const author = item && item.author ? item.author : {};
    const stats  = item && item.stats  ? item.stats  : {};
    const music  = item && item.music  ? item.music  : {};
    const video  = item && item.video  ? item.video  : {};

    const description    = (item && item.desc) || '';
    const hashtags       = extractHashtags(item);
    const createdAtUnix  = item && item.createTime ? toUnix(item.createTime) : null;
    const durationSeconds = video.duration ? Number(video.duration) : null;
    const cover          = video.cover || video.originCover || video.dynamicCover || null;

    const canonicalUrl = `https://www.tiktok.com/@${username || (author.uniqueId || 'user')}/video/${videoId}`;
    const channelName  = author.nickname || (author.uniqueId ? `@${author.uniqueId}` : '');

    // Layer 2 + 3: HTML snapshot + screenshot of the video container.
    // Be defensive about which element we target — TikTok's class
    // names churn but the video player + meta block share a stable
    // ancestor with `[data-e2e="browse-video"]` or
    // `[data-e2e="video-detail"]`.
    const evidenceTarget = pickEvidenceElement();
    const htmlSnapshotStr = evidenceTarget ? snapshot(evidenceTarget, { maxBytes: 50 * 1024 }) : '';
    const htmlSnapshotHashStr = htmlSnapshotStr ? await snapshotHash(htmlSnapshotStr) : null;

    let screenshotDataUrl = null;
    let screenshotHashStr = null;
    if (evidenceTarget) {
        try {
            screenshotDataUrl = await capturePostScreenshot(evidenceTarget);
            if (screenshotDataUrl) screenshotHashStr = await dataUrlHash(screenshotDataUrl);
        } catch (err) {
            console.warn('[X-Ray TikTok] screenshot capture failed:', err);
        }
    }

    const bodyMarkdown = composeMarkdownBody({
        title: fallbackTitle,
        canonicalUrl,
        videoId,
        username:        author.uniqueId || username || '',
        channelName,
        verified:        author.verified === true,
        description,
        hashtags,
        createdAtUnix,
        durationSeconds,
        viewCount:    stats.playCount    || null,
        likeCount:    stats.diggCount    || null,
        commentCount: stats.commentCount || null,
        shareCount:   stats.shareCount   || null,
        music: music && (music.title || music.authorName) ? {
            title:      music.title      || '',
            authorName: music.authorName || ''
        } : null
    });

    return {
        title:        fallbackTitle,
        url:          canonicalUrl,
        domain:       'tiktok.com',
        siteName:     'TikTok',
        byline:       channelName,
        publishedAt:  createdAtUnix,
        extractedAt:  Math.floor(Date.now() / 1000),
        featuredImage: cover,

        content:  ContentExtractor.markdownToHtml(bodyMarkdown),
        markdown: bodyMarkdown,

        excerpt: description.slice(0, 500),
        contentType: 'video',
        platform:    'tiktok',

        keywords: hashtags,

        engagement: {
            views:    stats.playCount    || 0,
            likes:    stats.diggCount    || 0,
            comments: stats.commentCount || 0,
            shares:   stats.shareCount   || 0
        },

        // Platform-specific block — mirrors article.youtube /
        // article.tweetMeta. Reader's TikTok header reads from here.
        tiktok: {
            videoId,
            author: {
                username: author.uniqueId || username || null,
                nickname: author.nickname || null,
                verified: author.verified === true,
                avatar:   author.avatarLarger || author.avatarThumb || null
            },
            durationSeconds,
            playCount:    stats.playCount    || null,
            likeCount:    stats.diggCount    || null,
            commentCount: stats.commentCount || null,
            shareCount:   stats.shareCount   || null,
            music:        item && item.music ? {
                title:      music.title      || '',
                authorName: music.authorName || '',
                musicId:    music.id         || null
            } : null,
            createdAtUnix,
            sourceShape:  state ? state.source : null   // 'universal'|'sigi'|'nextdata'|null
        },

        // Phase 8a evidence layer.
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

function toUnix(value) {
    // TikTok's createTime is sometimes a numeric string, sometimes a
    // number. Either way, treat as unix seconds.
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function extractHashtags(item) {
    if (!item) return [];
    // textExtra is the canonical structured source — has hashtagName
    // for each # mention with start/end offsets into desc.
    if (Array.isArray(item.textExtra)) {
        const tags = item.textExtra
            .map((t) => t && t.hashtagName)
            .filter((s) => typeof s === 'string' && s.length > 0);
        if (tags.length > 0) return [...new Set(tags)];
    }
    // Fallback: regex over desc.
    const desc = item.desc || '';
    const matches = desc.match(/#([\p{L}0-9_]+)/gu) || [];
    return [...new Set(matches.map((m) => m.slice(1)))];
}

function pickEvidenceElement() {
    // Strict selectors first (TikTok's `data-e2e` attrs are
    // relatively stable), loose fallback last.
    const SELECTORS = [
        '[data-e2e="browse-video"]',
        '[data-e2e="video-detail"]',
        'article',
        'main'
    ];
    for (const sel of SELECTORS) {
        const el = document.querySelector(sel);
        if (el) return el;
    }
    return document.body || null;
}

function composeMarkdownBody(opts) {
    const {
        title, canonicalUrl, videoId, username, channelName, verified,
        description, hashtags, createdAtUnix, durationSeconds,
        viewCount, likeCount, commentCount, shareCount, music
    } = opts;

    const parts = [];

    const hdr = [];
    hdr.push(`**TikTok video**: [${title}](${canonicalUrl})`);
    if (channelName)             hdr.push(`**Author**: ${channelName}${verified ? ' ✓' : ''}${username ? ` (@${username})` : ''}`);
    if (createdAtUnix)           hdr.push(`**Posted**: ${new Date(createdAtUnix * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`);
    if (durationSeconds != null) hdr.push(`**Duration**: ${formatDuration(durationSeconds)}`);
    if (viewCount    != null)    hdr.push(`**Views**: ${viewCount.toLocaleString()}`);
    if (likeCount    != null)    hdr.push(`**Likes**: ${likeCount.toLocaleString()}`);
    if (commentCount != null)    hdr.push(`**Comments**: ${commentCount.toLocaleString()}`);
    if (shareCount   != null)    hdr.push(`**Shares**: ${shareCount.toLocaleString()}`);
    if (music) {
        const m = music.title && music.authorName
            ? `${music.title} — ${music.authorName}`
            : (music.title || music.authorName);
        if (m) hdr.push(`**Music**: ${m}`);
    }
    hdr.push(`**Video ID**: \`${videoId}\``);
    parts.push(`---\n${hdr.join('  \n')}\n---\n`);

    if (description && description.trim()) {
        parts.push(`## Description\n\n${description.trim()}\n`);
    }

    if (hashtags.length > 0) {
        parts.push(`## Hashtags\n\n${hashtags.map((t) => `\`#${t}\``).join(' ')}\n`);
    }

    return parts.join('\n');
}

function formatDuration(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
}

// YouTube platform handler — builds an article from scratch (no Readability).
//
// Runs in the content script on `www.youtube.com/watch?v=…` pages.
// Called by UI.openReader BEFORE the generic Readability path, because
// YouTube pages aren't article-shaped and Readability returns garbage.
//
// Data model source: `ytInitialPlayerResponse`, a JSON blob YouTube
// embeds in the watch-page HTML. Contains videoDetails (title, author,
// channelId, viewCount, keywords, thumbnails, short description),
// microformat (publishDate, category, country list), and the full
// caption-track list with signed baseUrls.
//
// Transcript selection rule: capture every track in the ORIGIN language
// and every track in the USER'S PREFERRED language, both kinds (human +
// auto-generated) when each exists. Origin is signalled by the ASR
// track's `languageCode` — YouTube runs auto-transcription on the
// original audio, so whatever language it emits in IS the source.
//
// Transcript fetch is done same-origin from the content script (we're
// already on youtube.com), which makes the signed baseUrl's signature
// + cookie requirements satisfied automatically. No CORS, no Referer
// rewriting needed for this path.

import { ContentExtractor } from '../content-extractor.js';

// ------------------------------------------------------------------
// Detection
// ------------------------------------------------------------------

export function isYouTubeVideoPage() {
    const host = window.location.hostname;
    if (!/^(www\.|m\.)?youtube\.com$/i.test(host)) return false;
    if (!/^\/watch\b/.test(window.location.pathname)) return false;
    const v = new URLSearchParams(window.location.search).get('v');
    return typeof v === 'string' && v.length > 0;
}

// ------------------------------------------------------------------
// ytInitialPlayerResponse extraction
// ------------------------------------------------------------------

/**
 * Parse the `ytInitialPlayerResponse` JSON blob out of the watch-page
 * HTML. Uses a single-pass brace-depth walk to find the matching
 * closing brace since the blob is large and interleaved with other
 * JS statements.
 *
 * @returns {object|null}
 */
export function parsePlayerResponse() {
    const html = document.documentElement.outerHTML;
    // The blob follows `var ytInitialPlayerResponse = ` on the watch
    // page. Other pages use `window["ytInitialPlayerResponse"] =`; we
    // check both shapes.
    const m =
        html.match(/var\s+ytInitialPlayerResponse\s*=\s*(\{)/) ||
        html.match(/window\["ytInitialPlayerResponse"\]\s*=\s*(\{)/);
    if (!m) return null;

    const start = m.index + m[0].length - 1; // points at the opening '{'
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < html.length; i++) {
        const ch = html[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"')  { inString = !inString; continue; }
        if (inString)    continue;
        if (ch === '{')  depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                try {
                    return JSON.parse(html.slice(start, i + 1));
                } catch (err) {
                    console.warn('[X-Ray YouTube] JSON parse failed:', err);
                    return null;
                }
            }
        }
    }
    return null;
}

// ------------------------------------------------------------------
// InnerTube client version — extracted from the page's embedded
// INNERTUBE_CONTEXT_CLIENT_VERSION string. YouTube's timedtext
// endpoint rejects requests that don't identify as a known WEB
// client; the version we send as X-YouTube-Client-Version must be
// a plausible current build or the request silently drops.
// ------------------------------------------------------------------

export function extractClientVersion() {
    const html = document.documentElement.outerHTML;
    const m = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION"\s*:\s*"([^"]+)"/);
    return m ? m[1] : null;
}

// ------------------------------------------------------------------
// Language detection
// ------------------------------------------------------------------

export function normalizeLangBase(code) {
    return String(code || '').split('-')[0].toLowerCase();
}

/**
 * Detect the origin (spoken) language of the video.
 *
 * Primary: the ASR track's `languageCode`. Auto-transcription always
 * runs on the original audio, so this is the spoken language by
 * construction.
 *
 * Fallback: the first non-ASR track's `languageCode` — channels that
 * uploaded a primary caption track typically put the original-language
 * one first.
 */
export function detectOriginLanguage(tracks) {
    if (!Array.isArray(tracks) || tracks.length === 0) return null;
    const asr = tracks.find((t) => t && t.kind === 'asr' && t.languageCode);
    if (asr) return asr.languageCode;
    const firstHuman = tracks.find((t) => t && t.kind !== 'asr' && t.languageCode);
    return (firstHuman && firstHuman.languageCode) || null;
}

/**
 * User's preferred UI language, base only ('en-US' → 'en').
 */
export function detectUserLanguage() {
    const raw =
        (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) ||
        (typeof navigator !== 'undefined' && navigator.language) ||
        'en';
    return normalizeLangBase(raw);
}

/**
 * Select caption tracks to capture, per the user-confirmed rule:
 *   (origin language) ∪ (user-preferred language)
 * In each selected language, keep every available kind (human + ASR).
 *
 * Returns tracks in a deliberate order:
 *   1. origin-language human (canonical)
 *   2. origin-language auto-generated (verbatim backup)
 *   3. user-language human (if different from origin)
 *   4. user-language auto-generated (if different from origin)
 */
export function selectTracks(tracks, originLang, userLang) {
    if (!Array.isArray(tracks)) return [];
    const bases = new Set([originLang, userLang].filter(Boolean).map(normalizeLangBase));

    const matchLang = (t) => bases.has(normalizeLangBase(t.languageCode));
    const filtered = tracks.filter(matchLang);

    const pick = (lang, kind) =>
        filtered.find((t) => normalizeLangBase(t.languageCode) === lang && (t.kind || 'human') === kind);

    const ordered = [];
    const originBase = normalizeLangBase(originLang);
    const userBase   = normalizeLangBase(userLang);

    // Origin-language tracks first.
    const originHuman = pick(originBase, 'human');
    const originAsr   = pick(originBase, 'asr');
    if (originHuman) ordered.push({ ...originHuman, role: 'origin-human' });
    if (originAsr)   ordered.push({ ...originAsr,   role: 'origin-asr' });

    // User-language tracks (only if different from origin).
    if (userBase && userBase !== originBase) {
        const userHuman = pick(userBase, 'human');
        const userAsr   = pick(userBase, 'asr');
        if (userHuman) ordered.push({ ...userHuman, role: 'user-human' });
        if (userAsr)   ordered.push({ ...userAsr,   role: 'user-asr' });
    }

    return ordered;
}

// ------------------------------------------------------------------
// Transcript fetch + parse (json3 format)
// ------------------------------------------------------------------

/**
 * Fetch a caption track. Delegates to the background service worker
 * (xray:youtube:fetchTranscript message) which:
 *   1. issues the request with credentials:'include' so cookies travel,
 *   2. has its Referer header rewritten to https://www.youtube.com/
 *      by a declarativeNetRequest rule — the signed baseUrl silently
 *      returns 0 bytes without that specific Referer, even with
 *      session cookies and a browser user-agent.
 *
 * Returns { events: [{ startMs, durationMs, text }, …] } on success,
 * or { events: null, error: <string> } on failure. The synthesizer
 * propagates that error into the composed transcript block so the
 * reader surfaces a specific reason, not a generic "fetch failed".
 */
export async function fetchTranscript(baseUrl) {
    try {
        const url = new URL(baseUrl, window.location.origin);
        url.searchParams.set('fmt', 'json3');

        const clientVersion = extractClientVersion();

        // Diagnostic breadcrumb — confirms the SW-routed code path is
        // live. If a user reports "fetch failed" without this log
        // appearing in the YouTube tab console, the tab is still
        // running the pre-73e75af bundle and needs a hard reload.
        console.error('[X-Ray YouTube] fetchTranscript via SW:', url.toString(),
            'client-version:', clientVersion);

        const resp = await chrome.runtime.sendMessage({
            type: 'xray:youtube:fetchTranscript',
            url: url.toString(),
            clientVersion
        });

        console.error('[X-Ray YouTube] SW response:',
            resp ? { ok: resp.ok, status: resp.status, bodyLen: resp.body?.length || 0, error: resp.error } : null);

        if (!resp || !resp.ok) {
            const reason = (resp && resp.error) || 'no response from service worker';
            console.warn('[X-Ray YouTube] transcript fetch failed:', reason, 'for', baseUrl);
            return { events: null, error: reason };
        }
        if (!resp.body || resp.body.length < 8) {
            console.warn('[X-Ray YouTube] transcript fetch returned empty body. HTTP status', resp.status,
                'variants:', resp.variants);
            // Since mid-2024 YouTube's timedtext endpoint requires a
            // PO (Proof-of-Origin) token generated by the page's JS
            // challenge system. Without it, the endpoint returns
            // HTTP 200 with empty body — including via the signed
            // baseUrl embedded in ytInitialPlayerResponse. Use YouTube's
            // own "Show transcript" button to verify the video actually
            // has an accessible transcript.
            return {
                events: null,
                error: 'YouTube returned an empty transcript (likely PO-token gated since 2024). Use the video\'s own "Show transcript" button to verify captions exist.'
            };
        }
        let data;
        try { data = JSON.parse(resp.body); }
        catch (err) {
            console.warn('[X-Ray YouTube] transcript body was not JSON:', err, 'first 120 chars:', resp.body.slice(0, 120));
            return { events: null, error: 'malformed JSON response' };
        }
        const shaped = shapeTranscript(data);
        if (!shaped.events || shaped.events.length === 0) {
            return { events: [], error: 'transcript returned with no content' };
        }
        return shaped;
    } catch (err) {
        console.warn('[X-Ray YouTube] transcript fetch exception:', err, 'for', baseUrl);
        return { events: null, error: err && err.message ? err.message : String(err) };
    }
}

function shapeTranscript(raw) {
    const events = Array.isArray(raw && raw.events) ? raw.events : [];
    const out = [];
    for (const ev of events) {
        if (!ev || !Array.isArray(ev.segs)) continue;
        const text = ev.segs.map((s) => (s && typeof s.utf8 === 'string') ? s.utf8 : '').join('');
        if (!text.trim()) continue; // YouTube emits empty "pause" events; skip
        const startMs   = Number.isFinite(ev.tStartMs) ? ev.tStartMs : 0;
        const durationMs = Number.isFinite(ev.dDurationMs) ? ev.dDurationMs : 0;
        out.push({ startMs, durationMs, text });
    }
    return { events: out };
}

// ------------------------------------------------------------------
// DOM-scrape fallback: YouTube's own transcript panel
// ------------------------------------------------------------------
//
// Since YouTube tightened /api/timedtext with PO-token gating in 2024,
// the signed baseUrls from ytInitialPlayerResponse return HTTP 200 with
// 0-byte bodies — including from the page's own JS context. But the
// transcript data is accessible through YouTube's own UI panel: the
// "Show transcript" button under the video description opens a side
// panel populated with `<ytd-transcript-segment-renderer>` elements
// (current shape as of late 2025; YouTube iterates on this).
//
// This function programmatically opens the panel, waits for segments
// to render, and reads them out. Falls back to whatever's already in
// the DOM if the panel is already open. Returns null if the panel
// can't be found or doesn't populate within the timeout.

export async function scrapeVisibleTranscript() {
    try {
        // Primary strategy: intercept YouTube's own get_transcript POST
        // and parse its JSON response. Falls through to DOM scraping if
        // the intercept didn't catch anything (e.g. the transcript panel
        // was already open before we loaded).
        const intercepted = await captureTranscriptViaFetchHook();
        if (intercepted && intercepted.events && intercepted.events.length > 0) {
            return intercepted;
        }

        // Secondary strategy: scrape DOM once the panel is open.
        return await scrapeDomTranscript();
    } catch (err) {
        console.warn('[X-Ray YouTube] scrapeVisibleTranscript exception:', err);
        return { events: null, error: (err && err.message) || String(err) };
    }
}

/**
 * Inject a fetch/XHR proxy into the page's MAIN world that captures
 * YouTube's own `/youtubei/v1/get_transcript` response when it fires,
 * then click "Show transcript" to trigger it. The response is the
 * structured InnerTube JSON used by YouTube's own UI — cleaner than
 * scraping the rendered DOM and immune to CSS-selector churn.
 */
async function captureTranscriptViaFetchHook() {
    if (!chrome?.runtime?.sendMessage) return null;
    const resp = await chrome.runtime.sendMessage({
        type: 'xray:youtube:captureTranscriptViaHook',
        tabId: null // SW picks up from sender.tab.id
    });
    if (resp && resp.ok && resp.events) {
        return { events: resp.events, error: null, source: 'fetch-hook', footerText: resp.label || '' };
    }
    if (resp && resp.events === null) {
        console.warn('[X-Ray YouTube] fetch-hook returned no events:', resp.error);
    }
    return null;
}

/**
 * DOM scrape fallback. Logs aggressive diagnostics so that when
 * YouTube renames its custom elements (periodically happens), we can
 * diagnose from a user's paste.
 */
async function scrapeDomTranscript() {
    // Broad probe: what transcript-shaped elements are in the DOM right now?
    const probe = () => {
        const all = document.querySelectorAll('*');
        const buckets = {};
        all.forEach((el) => {
            const t = (el.tagName || '').toLowerCase();
            if (t.includes('transcript')) buckets[t] = (buckets[t] || 0) + 1;
        });
        return buckets;
    };

    console.error('[X-Ray YouTube] DOM probe before click:', probe());

    let segments = pickTranscriptSegments();

    if (segments.length === 0) {
        const button = findTranscriptButton();
        if (!button) {
            return {
                events: null,
                error: 'YouTube\'s "Show transcript" button not found in the description. Expand the description ("…more") and try again.'
            };
        }
        try { button.click(); }
        catch (err) { return { events: null, error: 'Could not click "Show transcript" button: ' + (err && err.message) }; }

        // Wait up to 8 seconds for the panel to populate. YouTube's
        // get_panel POST can take a couple seconds on cold cache.
        await waitForSegments(8000);
        console.error('[X-Ray YouTube] DOM probe after click + wait:', probe());
        segments = pickTranscriptSegments();
    }

    if (segments.length === 0) {
        // One last snapshot so we can see what IS in the panel.
        const panel = document.querySelector('ytd-engagement-panel-section-list-renderer, ytd-transcript-renderer, [target-id*="transcript" i]');
        const panelSnippet = panel ? panel.outerHTML.slice(0, 600) : '(no transcript panel element found)';
        console.error('[X-Ray YouTube] panel snippet:', panelSnippet);
        return {
            events: null,
            error: 'Transcript panel did not populate with segments. YouTube may have renamed its custom elements; selectors need updating.'
        };
    }

    console.error('[X-Ray YouTube] found', segments.length, 'transcript segments');

    // Extract cues. Uses a text-walk strategy so it works across both the
    // legacy `ytd-transcript-segment-renderer` shape (with #segment-timestamp
    // / .segment-text children) and the current `transcript-segment-view-model`
    // shape, whose internals have different class names but the same visible
    // pattern: one text node is a timestamp, the rest is caption text.
    const TS_RE = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/;
    const events = [];
    segments.forEach((seg) => {
        // 1. Try the legacy named selectors first — cheap and exact.
        let tsText = '';
        let capText = '';
        const tsEl  = seg.querySelector('#segment-timestamp, .segment-timestamp, [class*="timestamp" i]');
        const txtEl = seg.querySelector('yt-formatted-string.segment-text, #segment-text, .segment-text, [class*="segment-text" i]');
        if (tsEl && txtEl) {
            tsText  = (tsEl.textContent || '').trim();
            capText = (txtEl.textContent || '').trim();
        } else {
            // 2. Fallback: walk text nodes. The first node whose trimmed
            //    content matches a mm:ss (or h:mm:ss) timestamp is the
            //    timestamp; everything else concatenated is the caption.
            const walker = document.createTreeWalker(seg, NodeFilter.SHOW_TEXT);
            const parts = [];
            let node;
            while ((node = walker.nextNode())) {
                const t = (node.nodeValue || '').trim();
                if (!t) continue;
                if (!tsText && /^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) {
                    tsText = t;
                    continue;
                }
                parts.push(t);
            }
            capText = parts.join(' ').replace(/\s{2,}/g, ' ').trim();
        }

        if (!tsText || !capText) return;
        const m = tsText.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (!m) return;
        const h  = m[3] !== undefined ? parseInt(m[1], 10) : 0;
        const mm = m[3] !== undefined ? parseInt(m[2], 10) : parseInt(m[1], 10);
        const ss = m[3] !== undefined ? parseInt(m[3], 10) : parseInt(m[2], 10);
        const startMs = (h * 3600 + mm * 60 + ss) * 1000;

        events.push({ startMs, durationMs: 0, text: capText });
    });

    for (let i = 0; i < events.length - 1; i++) {
        events[i].durationMs = Math.max(0, events[i + 1].startMs - events[i].startMs);
    }
    if (events.length > 0) events[events.length - 1].durationMs = 3000;

    const footerText = (() => {
        const el = document.querySelector('ytd-transcript-footer-renderer');
        return el ? (el.textContent || '').trim() : '';
    })();

    return { events, error: null, source: 'dom-scrape', footerText };
}

// Union selector for transcript segments, covering every shape YouTube
// has shipped in the live-TV/kevlar UI. Order doesn't matter here —
// querySelectorAll returns a combined NodeList.
const TRANSCRIPT_SEGMENT_SELECTOR =
    'transcript-segment-view-model, ' +            // current shape (late 2025)
    'ytd-transcript-segment-renderer, ' +           // legacy shape
    'ytd-transcript-body-renderer ytd-transcript-segment-renderer, ' +
    '[class*="transcript-segment" i]';

/**
 * Try several selectors for the transcript segments. YouTube has
 * changed these over time — handling a few variants keeps the scraper
 * alive across updates.
 */
function pickTranscriptSegments() {
    return document.querySelectorAll(TRANSCRIPT_SEGMENT_SELECTOR);
}

function findTranscriptButton() {
    // 1. Typical placement: inside the description's "Show transcript"
    //    button. Locale-agnostic via aria-label if present.
    let btn = document.querySelector(
        'button[aria-label*="transcript" i], button[aria-label*="Transcript"]'
    );
    if (btn) return btn;

    // 2. Fallback: match visible text on any button.
    const all = document.querySelectorAll('button, yt-button-shape, tp-yt-paper-button');
    for (const el of all) {
        const txt = (el.textContent || '').trim();
        const label = (el.getAttribute && el.getAttribute('aria-label')) || '';
        if (/show\s+transcript/i.test(txt) || /show\s+transcript/i.test(label)) return el;
    }

    // 3. Last resort: the "more actions" button → then the transcript
    //    item in its menu. Requires two clicks; we bail rather than
    //    automate that now (user can click "Show transcript" once).
    return null;
}

function waitForSegments(timeoutMs) {
    return new Promise((resolve) => {
        if (document.querySelector(TRANSCRIPT_SEGMENT_SELECTOR)) return resolve();
        const start = Date.now();
        const obs = new MutationObserver(() => {
            if (document.querySelector(TRANSCRIPT_SEGMENT_SELECTOR)) {
                obs.disconnect(); resolve();
            } else if (Date.now() - start > timeoutMs) {
                obs.disconnect(); resolve();
            }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => { obs.disconnect(); resolve(); }, timeoutMs);
    });
}

// ------------------------------------------------------------------
// Article synthesis
// ------------------------------------------------------------------

/**
 * Full YouTube capture: parse player response, select + fetch
 * transcripts, compose an article object that the existing reader +
 * event-builder can consume.
 *
 * Returns null on any page that isn't a YouTube watch page.
 */
export async function synthesizeArticle() {
    if (!isYouTubeVideoPage()) return null;

    const player = parsePlayerResponse();
    if (!player) return null;

    const vd = player.videoDetails || {};
    const mf = (player.microformat || {}).playerMicroformatRenderer || {};
    const renderer = (player.captions || {}).playerCaptionsTracklistRenderer || {};
    const tracks = Array.isArray(renderer.captionTracks) ? renderer.captionTracks : [];

    const videoId = vd.videoId || new URLSearchParams(window.location.search).get('v');
    const originLang = detectOriginLanguage(tracks);
    const userLang   = detectUserLanguage();
    const selected   = selectTracks(tracks, originLang, userLang);

    // Fetch each selected track's timestamped events. Parallel since
    // they're independent same-origin GETs.
    let transcripts = await Promise.all(
        selected.map(async (t) => {
            const data = await fetchTranscript(t.baseUrl);
            return {
                kind:         t.kind || 'human',
                languageCode: t.languageCode,
                displayName:  trackDisplayName(t),
                role:         t.role,
                events:       data && Array.isArray(data.events) ? data.events : null,
                error:        (data && data.error) || null,
                baseUrl:      t.baseUrl
            };
        })
    );

    // Fallback: if every /api/timedtext fetch came back empty (the PO-token
    // case), scrape YouTube's own transcript panel out of the DOM. It
    // only yields one track — whichever language is currently selected
    // in the panel — but the content is ground-truth: this is what
    // YouTube's UI shows a human viewer.
    const allEmpty = transcripts.length > 0 &&
                     transcripts.every((t) => !t.events || t.events.length === 0);
    if (allEmpty) {
        console.warn('[X-Ray YouTube] All signed-URL fetches returned empty. Falling back to DOM scrape.');
        const scraped = await scrapeVisibleTranscript();
        if (scraped && Array.isArray(scraped.events) && scraped.events.length > 0) {
            // The scraped track replaces the failed signed-URL entries.
            // Label it honestly — we don't know exactly which caption
            // track YouTube's UI had selected, but the footer text
            // often indicates it.
            transcripts = [{
                kind:         'scraped',
                languageCode: originLang,
                displayName:  scraped.footerText
                    ? `YouTube panel (${scraped.footerText.slice(0, 60)})`
                    : 'YouTube panel',
                role:         'origin-scraped',
                events:       scraped.events,
                error:        null,
                source:       'dom-scrape'
            }];
        } else {
            // Scrape also failed. Leave the originals in place so the
            // reader surfaces the PO-token error message.
            if (scraped && scraped.error) {
                for (const t of transcripts) {
                    t.error = t.error + ' | DOM fallback: ' + scraped.error;
                }
            }
        }
    }

    const thumbnails = (vd.thumbnail && Array.isArray(vd.thumbnail.thumbnails))
        ? vd.thumbnail.thumbnails.slice() : [];
    const bestThumb = thumbnails.length > 0
        ? thumbnails[thumbnails.length - 1].url
        : null;

    const publishedAtUnix = mf.publishDate
        ? Math.floor(Date.parse(mf.publishDate) / 1000)
        : null;

    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const title = vd.title || 'Untitled YouTube Video';
    const channelName = vd.author || mf.ownerChannelName || '';

    const durationSeconds = parseInt(vd.lengthSeconds, 10) || null;
    const viewCount       = parseInt(vd.viewCount, 10) || null;
    const keywords        = Array.isArray(vd.keywords) ? vd.keywords : [];

    // Compose the markdown body that becomes the kind-30023 content.
    // Faithfulness-first: every captured transcript gets its own
    // labeled section with language + kind + role clearly marked, and
    // every timestamp is a clickable `&t=Ns` deep link back to the
    // exact second in the source video — so any downstream NOSTR
    // client can jump a reader straight to the cited moment.
    const bodyMarkdown = composeMarkdownBody({
        title,
        channelName,
        canonicalUrl,
        videoId,
        durationSeconds,
        viewCount,
        publishDate:     mf.publishDate || null,
        category:        mf.category || null,
        description:     vd.shortDescription || '',
        keywords,
        transcripts
    });

    return {
        title,
        url: canonicalUrl,
        domain: 'youtube.com',
        siteName: 'YouTube',
        byline: channelName,
        publishedAt: publishedAtUnix,
        extractedAt: Math.floor(Date.now() / 1000),
        featuredImage: bestThumb,

        // Proper markdown renderer so transcript `[link](url)` anchors
        // render as real `<a>` elements in the reader view — not as
        // escaped literal brackets. The reader's publish-time
        // htmlToMarkdown roundtrip (via Turndown) preserves `<a>` tags,
        // so the timestamp links survive through to the relay.
        content:  ContentExtractor.markdownToHtml(bodyMarkdown),
        markdown: bodyMarkdown,

        excerpt: (vd.shortDescription || '').slice(0, 500),
        contentType: 'video',
        platform: 'youtube',

        // Top-level keywords so the event-builder's generic `t` tag loop
        // (for `if (article.keywords?.length)`) picks them up — same as
        // any other article's tags.
        keywords,

        // Back-compat shape consumed by the event-builder's legacy
        // `article.videoMeta` block. Duplicates a few of the richer
        // `article.youtube` fields but costs basically nothing and keeps
        // pre-C2 tooling working.
        videoMeta: {
            videoId,
            duration: durationSeconds != null ? String(durationSeconds) : '',
            channelName
        },

        engagement: {
            views: viewCount || 0
        },

        youtube: {
            videoId,
            channel: {
                name: channelName,
                channelId: vd.channelId || null
            },
            durationSeconds,
            viewCount,
            keywords,
            category:        mf.category || null,
            publishDate:     mf.publishDate || null,
            uploadDate:      mf.uploadDate || null,
            thumbnails,
            isLive:          vd.isLiveContent === true,
            originLanguage:  originLang,
            userLanguage:    userLang,
            transcripts
        }
    };
}

function trackDisplayName(track) {
    const rawName = (track.name && (track.name.simpleText ||
                     (Array.isArray(track.name.runs) && track.name.runs[0] && track.name.runs[0].text))) || '';
    // YouTube embeds "(auto-generated)" into the ASR track's own
    // display name. We rebuild the label ourselves, so strip it here
    // to avoid "English (auto-generated) (auto-generated, origin language)".
    const cleaned = rawName.replace(/\s*\(auto-generated\)\s*$/i, '').trim();
    return cleaned || track.languageCode || 'caption';
}

/**
 * Compose the markdown body that the publish flow will put into the
 * kind-30023 event. Prioritizes faithfulness + machine-readability —
 * every transcript is labeled with language, kind, role, and
 * timestamped lines are preserved.
 */
function composeMarkdownBody(opts) {
    const { title, channelName, canonicalUrl, videoId, durationSeconds,
            viewCount, publishDate, category, description, keywords,
            transcripts } = opts;

    const parts = [];

    // Header — visible metadata block in the published article.
    const hdr = [];
    hdr.push(`**Video**: [${title}](${canonicalUrl})`);
    if (channelName)    hdr.push(`**Channel**: ${channelName}`);
    if (publishDate)    hdr.push(`**Published**: ${new Date(publishDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`);
    if (durationSeconds != null) hdr.push(`**Duration**: ${formatDuration(durationSeconds)}`);
    if (viewCount != null)       hdr.push(`**Views**: ${viewCount.toLocaleString()}`);
    if (category)       hdr.push(`**Category**: ${category}`);
    hdr.push(`**Video ID**: \`${videoId}\``);
    parts.push(`---\n${hdr.join('  \n')}\n---\n`);

    if (description && description.trim()) {
        parts.push(`## Description\n\n${description.trim()}\n`);
    }

    if (Array.isArray(keywords) && keywords.length > 0) {
        parts.push(`## Tags\n\n${keywords.slice(0, 40).map((k) => `\`${k}\``).join(' ')}\n`);
    }

    // Transcripts — one section per captured track, clearly labeled.
    for (const t of transcripts) {
        const roleLabel = roleToLabel(t.role);
        const kindLabel = t.kind === 'asr' ? 'auto-generated' : 'human-authored';
        const langLabel = t.displayName || t.languageCode || '';
        parts.push(`## Transcript — ${langLabel} (${kindLabel}${roleLabel ? ', ' + roleLabel : ''})\n`);
        if (!t.events || t.events.length === 0) {
            parts.push(t.error
                ? `*Transcript fetch failed: ${t.error}*\n`
                : `*No transcript content.*\n`);
            continue;
        }
        // One line per event. Timestamps are rendered as clickable
        // markdown links to the exact second in the source video
        // (`youtube.com/watch?v=<id>&t=<s>s`) so NOSTR clients and the
        // reader view both let you jump straight to the cited moment.
        const lines = t.events.map((ev) => {
            const stamp = formatTimestamp(ev.startMs);
            const secs  = Math.max(0, Math.floor((ev.startMs || 0) / 1000));
            const jumpUrl = `${canonicalUrl}&t=${secs}s`;
            return `[\`${stamp}\`](${jumpUrl}) ${ev.text.replace(/\n+/g, ' ')}`;
        });
        parts.push(lines.join('\n') + '\n');
    }

    return parts.join('\n');
}

function roleToLabel(role) {
    switch (role) {
        case 'origin-human': return 'origin language';
        case 'origin-asr':   return 'origin language';
        case 'user-human':   return 'your language';
        case 'user-asr':     return 'your language';
        default:             return '';
    }
}

function formatDuration(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
}

function formatTimestamp(ms) {
    const s = Math.max(0, Math.floor((ms || 0) / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
}

// The rudimentary `markdownToBasicHtml` helper used here pre-C2 has
// been replaced by `ContentExtractor.markdownToHtml`, which renders
// the link syntax `[…](url)` as real `<a>` tags — essential for our
// clickable transcript timestamps.

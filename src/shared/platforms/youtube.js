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
 * Fetch a caption track by baseUrl and parse into timestamped events.
 * Same-origin on youtube.com, so session cookies + Referer are correct
 * automatically.
 *
 * Returns: { events: [{ startMs, durationMs, text }, …], raw }
 * Returns null on any fetch/parse failure.
 */
export async function fetchTranscript(baseUrl) {
    try {
        const url = new URL(baseUrl, window.location.origin);
        url.searchParams.set('fmt', 'json3');
        const res = await fetch(url.toString(), {
            credentials: 'include',
            signal: AbortSignal.timeout(15000)
        });
        if (!res.ok) return null;
        const body = await res.text();
        if (!body || body.length < 8) return null; // YouTube returns 0-byte on auth/session fail
        const data = JSON.parse(body);
        return shapeTranscript(data);
    } catch (err) {
        console.warn('[X-Ray YouTube] transcript fetch failed:', err);
        return null;
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
    const transcripts = await Promise.all(
        selected.map(async (t) => {
            const data = await fetchTranscript(t.baseUrl);
            return {
                kind:         t.kind || 'human',
                languageCode: t.languageCode,
                displayName:  trackDisplayName(t),
                role:         t.role,
                events:       data ? data.events : null,
                error:        data ? null : 'fetch failed',
                baseUrl:      t.baseUrl
            };
        })
    );

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

    // Compose the markdown body that becomes the kind-30023 content.
    // Faithfulness-first: every captured transcript gets its own
    // labeled section with language + kind + role clearly marked.
    const bodyMarkdown = composeMarkdownBody({
        title,
        channelName,
        canonicalUrl,
        videoId,
        durationSeconds: parseInt(vd.lengthSeconds, 10) || null,
        viewCount:       parseInt(vd.viewCount, 10) || null,
        publishDate:     mf.publishDate || null,
        category:        mf.category || null,
        description:     vd.shortDescription || '',
        keywords:        Array.isArray(vd.keywords) ? vd.keywords : [],
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
        content: markdownToBasicHtml(bodyMarkdown),  // gives the reader something to render
        markdown: bodyMarkdown,
        excerpt: (vd.shortDescription || '').slice(0, 500),
        contentType: 'video',
        platform: 'youtube',
        engagement: {
            views: parseInt(vd.viewCount, 10) || 0
        },
        youtube: {
            videoId,
            channel: {
                name: channelName,
                channelId: vd.channelId || null
            },
            durationSeconds: parseInt(vd.lengthSeconds, 10) || null,
            viewCount:       parseInt(vd.viewCount, 10) || null,
            keywords:        Array.isArray(vd.keywords) ? vd.keywords : [],
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
    const name = (track.name && (track.name.simpleText ||
                   (Array.isArray(track.name.runs) && track.name.runs[0] && track.name.runs[0].text))) || '';
    return name || track.languageCode || 'caption';
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
        // One line per event with [M:SS] timestamp. Readable and
        // preserves the timeline for any downstream consumer.
        const lines = t.events.map((ev) =>
            `\`[${formatTimestamp(ev.startMs)}]\` ${ev.text.replace(/\n+/g, ' ')}`
        );
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

/**
 * Rudimentary markdown → HTML for the reader's initial render. The
 * proper round-trip (via ContentExtractor.markdownToHtml) happens
 * when the user toggles Preview; this just gives the reader a
 * starting point in Reader mode that looks reasonable.
 */
function markdownToBasicHtml(md) {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return md
        .split(/\n{2,}/)
        .map((block) => {
            if (block.startsWith('## ')) {
                return `<h2>${esc(block.slice(3).trim())}</h2>`;
            }
            if (block.startsWith('---') || block === '---') {
                return `<hr />`;
            }
            // Paragraph with line breaks preserved
            return `<p>${esc(block).replace(/\n/g, '<br>')}</p>`;
        })
        .join('\n');
}

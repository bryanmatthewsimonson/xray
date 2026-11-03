// Capture-time media signals — the answer to "should this capture
// offer Transcribe?" on a page that is not a known video platform.
//
// LOCAL-ONLY by construction: the result rides `article.mediaHints`
// into session storage and archive rows, and no event builder reads it.
// It is a UI affordance, never a claim about the page — the honest
// fallback for anything this misses is the 🎙 Media & source modal's
// "Transcribe from source" action, which is offered on every capture.
//
// Pure over a document-shaped object so node tests need no DOM.

// Players worth naming. The value is the label stored in `embeds`;
// matching is a plain hostname/substring test on the iframe src.
const PLAYER_HOSTS = [
    ['youtube.com/embed', 'youtube', 'video'],
    ['youtube-nocookie.com/embed', 'youtube', 'video'],
    ['player.vimeo.com', 'vimeo', 'video'],
    ['rumble.com/embed', 'rumble', 'video'],
    ['odysee.com/$/embed', 'odysee', 'video'],
    ['dailymotion.com/embed', 'dailymotion', 'video'],
    ['bitchute.com/embed', 'bitchute', 'video'],
    ['open.spotify.com/embed', 'spotify', 'audio'],
    ['player.megaphone.fm', 'megaphone', 'audio'],
    ['playlist.megaphone.fm', 'megaphone', 'audio'],
    ['podbean.com', 'podbean', 'audio'],
    ['libsyn.com', 'libsyn', 'audio'],
    ['simplecast.com', 'simplecast', 'audio'],
    ['buzzsprout.com', 'buzzsprout', 'audio'],
    ['art19.com', 'art19', 'audio'],
    ['captivate.fm', 'captivate', 'audio'],
    ['transistor.fm', 'transistor', 'audio'],
    ['soundcloud.com/player', 'soundcloud', 'audio'],
    ['anchor.fm', 'anchor', 'audio'],
    ['omny.fm', 'omny', 'audio'],
    ['spreaker.com', 'spreaker', 'audio'],
    ['audioboom.com', 'audioboom', 'audio'],
    ['redcircle.com', 'redcircle', 'audio'],
    ['iheart.com', 'iheart', 'audio'],
    ['blubrry.com', 'blubrry', 'audio'],
    ['fireside.fm', 'fireside', 'audio']
];

function metaHasValue(doc, selector) {
    for (const node of doc.querySelectorAll(selector) || []) {
        const value = node && typeof node.getAttribute === 'function'
            ? String(node.getAttribute('content') || '').trim() : '';
        if (value) return true;
    }
    return false;
}

// Direct media-file links — the PowerPress/Blubrry signal (smoke-failure
// diagnosis B1): a WordPress podcast page exposes its episode through
// none of the three signals above (no <audio>, no player iframe, no
// og:audio/og:video) — only a plain <a href> ending in a media
// extension ("Play in new window" / "Download"). Extension match only
// (a link to a PAGE that merely embeds media must not match); the
// query string is stripped before testing so `foo.mp3?x=1` still
// matches and `/watch?video=foo.mp3` (extension only in the query,
// not the path) does not.
const AUDIO_EXT_RE = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/i;
const VIDEO_EXT_RE = /\.(mp4|m4v|webm|mov)$/i;

/** 'audio' | 'video' | null for an href, ignoring any query/hash. */
function mediaKindForHref(href) {
    const path = String(href || '').split(/[?#]/)[0];
    if (AUDIO_EXT_RE.test(path)) return 'audio';
    if (VIDEO_EXT_RE.test(path)) return 'video';
    return null;
}

// Real DOM anchors resolve `.href` to an absolute URL against the
// document's base automatically; node-test stubs only implement
// getAttribute, whose raw value may be relative. There is no document
// base to resolve a relative href against in this pure function, and a
// relative fileUrl would be useless to the reader downstream (it needs
// something the companion can fetch directly) — so a relative-only
// href is skipped rather than guessed at.
function absoluteAnchorHref(node) {
    if (!node) return null;
    if (typeof node.href === 'string' && /^https?:\/\//i.test(node.href)) return node.href;
    if (typeof node.getAttribute === 'function') {
        const raw = node.getAttribute('href');
        if (raw && /^https?:\/\//i.test(raw)) return raw;
    }
    return null;
}

// Media-file URLs hide in more places than the PowerPress anchor.
// Field failure 2026-08-15: a PodBean episode page carried its mp3 ONLY
// in schema.org JSON-LD (`associatedMedia.contentUrl`) — no anchor, no
// <audio>, no og:audio — so no fileUrl was recorded, transcribeSourceUrl
// fell back to the PAGE url, and the direct cloud path asked AssemblyAI
// to transcribe an HTML document.
//
// JSON-LD is the standards-based place to look (schema.org
// PodcastEpisode / AudioObject / VideoObject), so reading it fixes the
// whole class rather than one host. Every candidate still has to pass
// mediaKindForHref — a `contentUrl` pointing at a PAGE (some publishers
// do that) must never be submitted as if it were audio, which is the
// very failure being fixed.

/** Walk an arbitrarily-nested JSON-LD value, yielding every string
 *  under a `contentUrl` key. Depth-bounded: JSON-LD is
 *  publisher-controlled input. */
function contentUrlsFromLd(value, out = [], depth = 0) {
    if (!value || depth > 6) return out;
    if (Array.isArray(value)) {
        for (const item of value) contentUrlsFromLd(item, out, depth + 1);
        return out;
    }
    if (typeof value !== 'object') return out;
    for (const [key, child] of Object.entries(value)) {
        if (key === 'contentUrl' && typeof child === 'string') out.push(child);
        else contentUrlsFromLd(child, out, depth + 1);
    }
    return out;
}

/** Every absolute media-file URL declared in the page's JSON-LD blocks,
 *  in document order. Malformed JSON is skipped, never thrown. */
function jsonLdMediaUrls(doc) {
    const urls = [];
    for (const node of doc.querySelectorAll('script[type="application/ld+json"]') || []) {
        const raw = node && typeof node.textContent === 'string' ? node.textContent.trim() : '';
        if (!raw) continue;
        let parsed;
        try { parsed = JSON.parse(raw); } catch (_) { continue; }
        for (const url of contentUrlsFromLd(parsed)) {
            if (/^https?:\/\//i.test(url) && mediaKindForHref(url)) urls.push(url);
        }
    }
    return urls;
}

/**
 * Media signals on a captured page.
 *
 * @param {Document|{querySelectorAll: Function}} doc
 * @returns {{audio: boolean, video: boolean, embeds: string[], fileUrl?: string}|null}
 *   null when nothing suggests playable media. `fileUrl` is present only
 *   when a direct media-file link was found (the first one, in document
 *   order) — never null or ''.
 */
export function detectMediaHints(doc) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return null;
    let audio = false;
    let video = false;
    const embeds = [];
    let fileUrl = null;

    // Candidate file URLs from every source EXCEPT the download anchor,
    // in fallback order. The anchor stays the winner (see below).
    const fallbackUrls = [];
    const noteCandidate = (raw) => {
        const url = String(raw || '').trim();
        if (/^https?:\/\//i.test(url) && mediaKindForHref(url)) fallbackUrls.push(url);
    };

    for (const node of doc.querySelectorAll('audio, video') || []) {
        const tag = String((node && node.tagName) || '').toUpperCase();
        if (tag === 'AUDIO') audio = true;
        else if (tag === 'VIDEO') video = true;
        if (node && typeof node.getAttribute === 'function') noteCandidate(node.getAttribute('src'));
    }
    for (const node of doc.querySelectorAll('audio source[src], video source[src]') || []) {
        if (node && typeof node.getAttribute === 'function') noteCandidate(node.getAttribute('src'));
    }

    // No cap on how many iframes get scanned: a fixed slice here (the
    // pre-fix MAX_IFRAMES=30) silently dropped signal rather than
    // bounding work — an ad-heavy page with 30+ throwaway ad iframes
    // ahead of the real player iframe would scan only the ads and
    // return null, hiding Transcribe on exactly the long-tail pages
    // this exists for (review finding, reproduced against a
    // 30-ad-iframes-then-megaphone fixture). The scan itself is cheap
    // (a handful of substring checks per iframe against PLAYER_HOSTS),
    // and the output is self-bounding regardless of input size — embeds
    // dedupes into at most PLAYER_HOSTS.length distinct labels.
    const iframes = [...(doc.querySelectorAll('iframe[src]') || [])];
    for (const frame of iframes) {
        const src = frame && typeof frame.getAttribute === 'function'
            ? String(frame.getAttribute('src') || '').toLowerCase() : '';
        if (!src) continue;
        for (const [needle, label, kind] of PLAYER_HOSTS) {
            if (!src.includes(needle)) continue;
            if (!embeds.includes(label)) embeds.push(label);
            if (kind === 'audio') audio = true; else video = true;
            break;
        }
    }

    if (metaHasValue(doc, 'meta[property="og:video"], meta[property="og:video:url"]')) video = true;
    if (metaHasValue(doc, 'meta[property="og:audio"], meta[property="og:audio:url"]')) audio = true;
    for (const sel of ['meta[property="og:audio"], meta[property="og:audio:url"]',
        'meta[property="og:video"], meta[property="og:video:url"]']) {
        for (const node of doc.querySelectorAll(sel) || []) {
            if (node && typeof node.getAttribute === 'function') noteCandidate(node.getAttribute('content'));
        }
    }
    for (const url of jsonLdMediaUrls(doc)) fallbackUrls.push(url);

    // No pre-slice here either, same reasoning and same regression shape
    // as the iframe scan above: a fixed cap applied BEFORE matching would
    // silently drop the real link on an ad/tracker-heavy page — exactly
    // the PowerPress pattern this exists for (three plain anchors after
    // however much page chrome). The per-anchor check is a cheap regex
    // test, so the scan bounds itself the same way the iframe one does;
    // only the recorded `fileUrl` is capped, to the FIRST match found.
    const anchors = [...(doc.querySelectorAll('a[href]') || [])];
    for (const node of anchors) {
        const href = absoluteAnchorHref(node);
        if (!href) continue;
        const kind = mediaKindForHref(href);
        if (!kind) continue;
        if (kind === 'audio') audio = true; else video = true;
        if (!fileUrl) fileUrl = href;
    }

    // The explicit download ANCHOR wins when a page offers several — it
    // is the most direct answer, it is the case the PowerPress fix was
    // built and tested against, and keeping it first means adding the
    // sources above cannot regress any page that already worked.
    if (!fileUrl && fallbackUrls.length) {
        fileUrl = fallbackUrls[0];
        // A page can declare media only in JSON-LD or og: tags, with no
        // element and no player iframe — that is the PodBean shape, and
        // it must still register as a media signal or hasMediaSignal
        // hides Transcribe on exactly the pages this exists for.
        if (mediaKindForHref(fileUrl) === 'audio') audio = true; else video = true;
    }

    if (!audio && !video && embeds.length === 0) return null;
    const result = { audio, video, embeds };
    if (fileUrl) result.fileUrl = fileUrl;
    return result;
}

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

    for (const node of doc.querySelectorAll('audio, video') || []) {
        const tag = String((node && node.tagName) || '').toUpperCase();
        if (tag === 'AUDIO') audio = true;
        else if (tag === 'VIDEO') video = true;
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

    if (!audio && !video && embeds.length === 0) return null;
    const result = { audio, video, embeds };
    if (fileUrl) result.fileUrl = fileUrl;
    return result;
}

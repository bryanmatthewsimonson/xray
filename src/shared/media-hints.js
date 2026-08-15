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

// Scanning every iframe on a heavy page is wasteful; a page with more
// players than this is not a page whose media we can identify anyway.
const MAX_IFRAMES = 30;

function metaHasValue(doc, selector) {
    for (const node of doc.querySelectorAll(selector) || []) {
        const value = node && typeof node.getAttribute === 'function'
            ? String(node.getAttribute('content') || '').trim() : '';
        if (value) return true;
    }
    return false;
}

/**
 * Media signals on a captured page.
 *
 * @param {Document|{querySelectorAll: Function}} doc
 * @returns {{audio: boolean, video: boolean, embeds: string[]}|null}
 *   null when nothing suggests playable media.
 */
export function detectMediaHints(doc) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return null;
    let audio = false;
    let video = false;
    const embeds = [];

    for (const node of doc.querySelectorAll('audio, video') || []) {
        const tag = String((node && node.tagName) || '').toUpperCase();
        if (tag === 'AUDIO') audio = true;
        else if (tag === 'VIDEO') video = true;
    }

    const iframes = [...(doc.querySelectorAll('iframe[src]') || [])].slice(0, MAX_IFRAMES);
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

    if (!audio && !video && embeds.length === 0) return null;
    return { audio, video, embeds };
}

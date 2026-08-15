// Media identity — the extension-side MIRROR of the companion's
// transcriber/media_url.py `media_key_for`. Both sides must agree: the
// companion dedupes active jobs by this key and the reader stores its
// resumable job record under `xray:transcribe:job:<mediaKey>`.
//
// The one rule that is not merely aesthetic: a YouTube URL yields its
// BARE video id, because that is what existing job records are keyed
// by — changing it would orphan every in-flight transcription.
//
// Deliberately UNDER-normalizes everything else: merging two distinct
// episodes into one job is worse than running two jobs.

import { Crypto } from './crypto.js';

const YOUTUBE_HOSTS = new Set([
    'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'
]);
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;
const PATH_PREFIXES = ['/shorts/', '/live/', '/embed/'];

// Referral noise, not media identity. Mirrors _TRACKING_PARAMS.
const TRACKING_PARAMS = new Set([
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'fbclid', 'gclid', 'msclkid', 'mc_cid', 'mc_eid',
    'si', 'ref', 'ref_src', 'ref_url', 'source'
]);

function parse(url) {
    try { return new URL(String(url || '').trim()); } catch (_) { return null; }
}

/** The YouTube video id for `url`, or null when it is not one. */
export function youtubeVideoId(url) {
    const u = parse(url);
    if (!u || !YOUTUBE_HOSTS.has(u.hostname.toLowerCase())) return null;
    let id = '';
    if (u.hostname.toLowerCase() === 'youtu.be') {
        id = u.pathname.replace(/^\/+/, '').split('/')[0];
    } else if (u.pathname === '/watch') {
        id = u.searchParams.get('v') || '';
    } else {
        for (const prefix of PATH_PREFIXES) {
            if (u.pathname.startsWith(prefix)) {
                id = u.pathname.slice(prefix.length).split('/')[0];
                break;
            }
        }
    }
    return VIDEO_ID_RE.test(id) ? id : null;
}

/** Stable identity for the media behind `url`. */
export async function mediaKeyForUrl(url) {
    const videoId = youtubeVideoId(url);
    if (videoId) return videoId;
    const u = parse(url);
    if (!u) return `u_${(await Crypto.sha256(String(url || ''))).slice(0, 16)}`;
    const params = [...u.searchParams.entries()]
        .filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const query = params.length
        ? `?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`
        : '';
    const port = (u.port && !((u.protocol === 'https:' && u.port === '443')
        || (u.protocol === 'http:' && u.port === '80'))) ? `:${u.port}` : '';
    const normalized = `${u.protocol.toLowerCase()}//${u.hostname.toLowerCase()}${port}${u.pathname}${query}`;
    return `u_${(await Crypto.sha256(normalized)).slice(0, 16)}`;
}

/** The media key for a captured article. */
export async function mediaKeyForArticle(article) {
    const a = article || {};
    if (a.youtube && a.youtube.videoId) return String(a.youtube.videoId);
    return mediaKeyForUrl(a.url);
}

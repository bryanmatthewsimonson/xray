// Inline overlay — YouTube progress-bar ticks and auto-pop (content script,
// isolated world). Items that carry `seconds` get a tick on the player's
// progress bar; clicking a tick seeks the video, and playback crossing an
// item (within +-POP_WINDOW_S) pops its card through the same isolated-world
// `env.onOpen` callback the pins use — never a DOM event. The strip and the
// ticks are ours (xr-ov-yt-*, stripped from captures by overlay-strip.js);
// ticks carry only ids and an "X-Ray note at m:ss" accessible label.
//
// YouTube reuses and re-renders the player: the same <video> carries
// pre/mid-roll ads and later videos (its duration is stale until the next
// loadedmetadata), and the progress bar can be replaced. So layout is a
// idempotent `sync()` run while waiting for the player, on duration events,
// and on a slow re-check: it builds nothing while an ad shows, and rebuilds
// whenever the video, the bar, the strip's attachment or the duration
// changed. Each layout reports located / unlocated ids via `env.onLocated`.
//
// Auto-pop: never replaces a card the user already has open and never
// triggers the side-panel fallback (detail.auto). Auto-close: the card frame
// has no hover signal, so the 8000 ms timer lives here and tracks
// mouseenter / mouseleave on the iframe ELEMENT in the parent page (our own
// element, our own world). It closes through the optional `env.onClose`,
// only if the frame it popped is still the mounted one.

import { Utils } from '../shared/utils.js';
import { FRAME_WIDTH } from './overlay-frame.js';

export const POP_WINDOW_S = 1;
export const AUTO_CLOSE_MS = 8000;
export const PLAYER_WAIT_MS = 10000;
export const PLAYER_POLL_MS = 250;
export const RECHECK_MS = 2000;
const VIDEO_SEL = 'video.html5-main-video';
const BAR_SEL = '.ytp-progress-bar-container';
const FRAME_SEL = '.xr-ov-frame';
const AD_SELS = ['.html5-video-player.ad-showing', '.html5-video-player.ad-interrupting'];
const VIDEO_EVENTS = ['durationchange', 'loadedmetadata'];

/** True on a youtube.com watch page (not shorts, channel, home). */
export function isWatchPage(url) {
    try {
        const u = new URL(url);
        const h = u.hostname.toLowerCase();
        return (h === 'www.youtube.com' || h === 'youtube.com' || h === 'm.youtube.com')
            && u.pathname === '/watch';
    } catch (_) { return false; }
}

/** True while an ad is playing in the player (it shares the main <video>). */
export function adShowing(doc) {
    try { return AD_SELS.some((s) => !!doc.querySelector(s)); } catch (_) { return false; }
}

/** The content video's current time; null with no player or during an ad. */
export function videoSeconds(doc) {
    try {
        if (!doc || adShowing(doc)) return null;
        const v = doc.querySelector(VIDEO_SEL);
        const t = v && v.currentTime;
        return typeof t === 'number' && Number.isFinite(t) ? t : null;
    } catch (_) { return null; }
}

function fmt(seconds) {
    const s = Math.floor(seconds);
    const m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
}

function validSeconds(v) {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/**
 * @param {{window?:object, document?:object, onOpen:function, onClose?:function,
 *   onLocated?:function}} env
 * @param {Array<{id:string, seconds:number|null}>} items
 * @returns {{teardown():void, currentSeconds():number|null,
 *   ready:Promise<{located:string[], unlocated:string[]}>}}
 */
export function mountYouTube(env = {}, items = []) {
    const win = env.window || (typeof window !== 'undefined' ? window : null);
    const doc = env.document || (win && win.document);
    const onOpen = typeof env.onOpen === 'function' ? env.onOpen : () => {};
    const onClose = typeof env.onClose === 'function' ? env.onClose : () => {};
    const onLocated = typeof env.onLocated === 'function' ? env.onLocated : () => {};
    const timed = items.filter((i) => i && typeof i.id === 'string' && validSeconds(i.seconds));
    const allIds = timed.map((i) => i.id);

    let dead = false;
    let built = false;          // a layout has been reported at least once
    let video = null;
    let bar = null;
    let laidDuration = null;
    let strip = null;
    let groups = [];            // {seconds, ids, armed}
    let pollTimer = null;
    let giveUpTimer = null;
    let closeTimer = null;
    let popFrame = null;        // the iframe element we auto-popped
    let resolveReady;
    const ready = new Promise((r) => { resolveReady = r; });

    function report(located) {
        const set = new Set(located);
        const r = { located: allIds.filter((i) => set.has(i)), unlocated: allIds.filter((i) => !set.has(i)) };
        resolveReady(r);       // first report wins
        try { onLocated(r); } catch (err) { Utils.error('overlay: onLocated failed', err); }
    }

    function currentSeconds() {
        if (adShowing(doc)) return null;
        if (!video) return videoSeconds(doc);
        return Number.isFinite(video.currentTime) ? video.currentTime : null;
    }

    // -- auto-close ----------------------------------------------
    function stopCloseTimer() {
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    }
    function startCloseTimer() {
        stopCloseTimer();
        closeTimer = setTimeout(() => {
            closeTimer = null;
            const mounted = doc.querySelector(FRAME_SEL);
            if (mounted && mounted === popFrame) {
                try { onClose(); } catch (err) { Utils.error('overlay: auto-close failed', err); }
            }
            releaseFrame();
        }, AUTO_CLOSE_MS);
    }
    function releaseFrame() {
        if (popFrame) {
            try {
                popFrame.removeEventListener('mouseenter', stopCloseTimer);
                popFrame.removeEventListener('mouseleave', startCloseTimer);
            } catch (_) { /* ignore */ }
        }
        popFrame = null;
    }
    function watchFrame() {
        releaseFrame();
        stopCloseTimer();
        const el = doc.querySelector(FRAME_SEL);
        if (!el) return;       // card was not mounted (e.g. blocked)
        popFrame = el;
        el.addEventListener('mouseenter', stopCloseTimer);
        el.addEventListener('mouseleave', startCloseTimer);
        startCloseTimer();
    }

    function cornerRect() {
        let r = null;
        try { r = video.getBoundingClientRect(); } catch (_) { /* default */ }
        const top = r && Number.isFinite(r.top) ? r.top + 8 : 8;
        const right = r && Number.isFinite(r.right) ? r.right : FRAME_WIDTH + 16;
        const left = right - FRAME_WIDTH - 8;
        return { top, left, right: left + FRAME_WIDTH, bottom: top, width: FRAME_WIDTH, height: 0 };
    }

    function pop(ids) {
        // Never replace a card the user opened (frame.open() closes first).
        const existing = doc.querySelector(FRAME_SEL);
        if (existing && existing !== popFrame) return;
        try {
            onOpen({ itemIds: ids, rect: cornerRect(), mode: 'cards', auto: true });
        } catch (err) { Utils.error('overlay: auto-pop failed', err); return; }
        watchFrame();
    }

    function onTime() {
        if (dead || !video || adShowing(doc)) return;
        const t = video.currentTime;
        if (!Number.isFinite(t)) return;
        const entered = [];
        for (const g of groups) {
            const inside = Math.abs(t - g.seconds) <= POP_WINDOW_S;
            if (inside && g.armed) { g.armed = false; entered.push(...g.ids); }
            else if (!inside) g.armed = true;      // re-arm once playback leaves
        }
        if (entered.length) pop(entered);
    }

    // -- layout ---------------------------------------------------
    function unbindVideo() {
        if (!video) return;
        try {
            video.removeEventListener('timeupdate', onTime);
            for (const e of VIDEO_EVENTS) video.removeEventListener(e, sync);
        } catch (_) { /* ignore */ }
    }

    function clearStrip() {
        if (strip && strip.parentNode) strip.parentNode.removeChild(strip);
        strip = null;
        groups = [];
    }

    function layout(v, b, duration) {
        clearStrip();
        if (v !== video) {
            unbindVideo();
            video = v;
            video.addEventListener('timeupdate', onTime);
            for (const e of VIDEO_EVENTS) video.addEventListener(e, sync);
        }
        bar = b;
        laidDuration = duration;
        const bySec = new Map();
        const located = [];
        for (const it of timed) {
            if (it.seconds > duration) continue;     // past the end -> list only
            located.push(it.id);
            if (!bySec.has(it.seconds)) bySec.set(it.seconds, []);
            bySec.get(it.seconds).push(it.id);
        }
        if (located.length) {
            strip = doc.createElement('div');
            strip.className = 'xr-ov-yt-strip';
            const ss = strip.style;
            ss.position = 'absolute'; ss.left = '0'; ss.right = '0'; ss.top = '0';
            ss.height = '100%'; ss.pointerEvents = 'none'; ss.zIndex = '40';
            for (const [seconds, ids] of bySec) {
                const tick = doc.createElement('button');
                tick.className = 'xr-ov-yt-tick';
                tick.setAttribute('data-xr-ov-ids', ids.join(','));
                tick.setAttribute('aria-label', 'X-Ray note at ' + fmt(seconds));
                const ts = tick.style;
                ts.position = 'absolute'; ts.top = '0'; ts.height = '100%';
                ts.left = (seconds / duration * 100) + '%';
                ts.width = '4px'; ts.marginLeft = '-2px'; ts.padding = '0'; ts.border = '0';
                ts.background = '#ffd500'; ts.cursor = 'pointer'; ts.pointerEvents = 'auto';
                tick.addEventListener('click', (ev) => {
                    try { ev.preventDefault(); ev.stopPropagation(); } catch (_) { /* synthetic */ }
                    try { video.currentTime = seconds; } catch (err) { Utils.error('overlay: seek failed', err); }
                });
                strip.appendChild(tick);
                // A re-layout must not re-pop an item playback is already inside.
                groups.push({ seconds, ids, armed: !(Number.isFinite(v.currentTime)
                    && Math.abs(v.currentTime - seconds) <= POP_WINDOW_S) });
            }
            bar.appendChild(strip);
        }
        report(located);
    }

    /** Idempotent: lay out (or re-lay out) the ticks if anything changed. */
    function sync() {
        if (dead) return;
        let v = null;
        let b = null;
        try {
            if (adShowing(doc)) return;              // the ad's duration is not ours
            v = doc.querySelector(VIDEO_SEL);
            b = doc.querySelector(BAR_SEL);
        } catch (_) { return; }
        if (!v || !b) return;
        const d = v.duration;
        if (!Number.isFinite(d) || !(d > 0)) {
            // Between videos (duration NaN): drop stale ticks, wait for metadata.
            if (strip) { clearStrip(); laidDuration = null; }
            return;
        }
        const attached = strip ? strip.parentNode === b : laidDuration !== null;
        if (v === video && b === bar && d === laidDuration && attached) return;
        try { layout(v, b, d); } catch (err) {
            Utils.error('overlay: youtube ticks failed', err);
            return;
        }
        if (!built) {
            built = true;
            if (giveUpTimer) { clearTimeout(giveUpTimer); giveUpTimer = null; }
            if (pollTimer) clearInterval(pollTimer);
            pollTimer = setInterval(sync, RECHECK_MS);   // slow re-render check
        }
    }

    function teardown() {
        if (dead) return;
        dead = true;
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        if (giveUpTimer) { clearTimeout(giveUpTimer); giveUpTimer = null; }
        stopCloseTimer();
        if (popFrame && doc.querySelector(FRAME_SEL) === popFrame) {
            try { onClose(); } catch (_) { /* ignore */ }
        }
        releaseFrame();
        unbindVideo();
        clearStrip();
        resolveReady({ located: [], unlocated: allIds });   // no-op when already resolved
    }

    function giveUp() {
        giveUpTimer = null;
        if (dead || built) return;
        // An ad hides the real player: keep waiting rather than mark items unlocated.
        if (adShowing(doc)) { giveUpTimer = setTimeout(giveUp, PLAYER_WAIT_MS); return; }
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        report([]);      // no player in time: the items stay in the list
    }

    if (!doc || !timed.length) {
        resolveReady({ located: [], unlocated: allIds });
        return { teardown() {}, currentSeconds, ready };
    }
    pollTimer = setInterval(sync, PLAYER_POLL_MS);
    giveUpTimer = setTimeout(giveUp, PLAYER_WAIT_MS);
    sync();
    return { teardown, currentSeconds, ready };
}

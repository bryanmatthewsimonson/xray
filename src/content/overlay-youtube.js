// Inline overlay — YouTube progress-bar ticks and auto-pop (content script,
// isolated world). Items that carry `seconds` get a tick on the player's
// progress bar; clicking a tick seeks the video, and playback crossing an
// item (within +-POP_WINDOW_S) pops its card through the same isolated-world
// `env.onOpen` callback the pins use — never a DOM event. The strip and the
// ticks are ours (xr-ov-yt-*, stripped from captures by overlay-strip.js);
// ticks carry only ids and an "X-Ray note at m:ss" accessible label.
//
// Auto-close: the card frame (overlay-frame.js) has no hover signal, so the
// 8000 ms timer lives here and tracks mouseenter / mouseleave on the iframe
// ELEMENT in the parent page (it is our own element in our own world). The
// timer closes through the optional `env.onClose` and only if the frame it
// opened is still the mounted one.

import { Utils } from '../shared/utils.js';
import { FRAME_WIDTH } from './overlay-frame.js';

export const POP_WINDOW_S = 1;
export const AUTO_CLOSE_MS = 8000;
export const PLAYER_WAIT_MS = 10000;
export const PLAYER_POLL_MS = 250;
const VIDEO_SEL = 'video.html5-main-video';
const BAR_SEL = '.ytp-progress-bar-container';
const FRAME_SEL = '.xr-ov-frame';

/** True on a youtube.com watch page (not shorts, channel, home). */
export function isWatchPage(url) {
    try {
        const u = new URL(url);
        const h = u.hostname.toLowerCase();
        return (h === 'www.youtube.com' || h === 'youtube.com' || h === 'm.youtube.com')
            && u.pathname === '/watch';
    } catch (_) { return false; }
}

/** The main video's current time, or null when there is no player. */
export function videoSeconds(doc) {
    try {
        const v = doc && doc.querySelector(VIDEO_SEL);
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
 * @param {{window?:object, document?:object, onOpen:function, onClose?:function}} env
 * @param {Array<{id:string, seconds:number|null}>} items
 * @returns {{teardown():void, currentSeconds():number|null,
 *   ready:Promise<{located:string[], unlocated:string[]}>}}
 */
export function mountYouTube(env = {}, items = []) {
    const win = env.window || (typeof window !== 'undefined' ? window : null);
    const doc = env.document || (win && win.document);
    const onOpen = typeof env.onOpen === 'function' ? env.onOpen : () => {};
    const onClose = typeof env.onClose === 'function' ? env.onClose : () => {};
    const timed = items.filter((i) => i && typeof i.id === 'string' && validSeconds(i.seconds));
    const allIds = timed.map((i) => i.id);

    let dead = false;
    let video = null;
    let strip = null;
    let groups = [];            // {seconds, ids, armed}
    let pollTimer = null;
    let giveUpTimer = null;
    let closeTimer = null;
    let popFrame = null;        // the iframe element we auto-popped
    let resolveReady;
    const ready = new Promise((r) => { resolveReady = r; });
    const settle = (located) => {
        const set = new Set(located);
        resolveReady({ located: allIds.filter((i) => set.has(i)), unlocated: allIds.filter((i) => !set.has(i)) });
    };

    function currentSeconds() {
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
        try {
            onOpen({ itemIds: ids, rect: cornerRect(), mode: 'cards' });
        } catch (err) { Utils.error('overlay: auto-pop failed', err); return; }
        watchFrame();
    }

    function onTime() {
        if (dead || !video) return;
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

    function build(duration) {
        const bar = doc.querySelector(BAR_SEL);
        const bySec = new Map();
        const located = [];
        for (const it of timed) {
            if (it.seconds > duration) continue;     // past the end -> list only
            located.push(it.id);
            if (!bySec.has(it.seconds)) bySec.set(it.seconds, []);
            bySec.get(it.seconds).push(it.id);
        }
        if (!located.length) { settle([]); return; }
        strip = doc.createElement('div');
        strip.className = 'xr-ov-yt-strip';
        const ss = strip.style;
        ss.position = 'absolute'; ss.left = '0'; ss.right = '0'; ss.top = '0';
        ss.height = '100%'; ss.pointerEvents = 'none'; ss.zIndex = '40';
        groups = [];
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
            groups.push({ seconds, ids, armed: true });
        }
        bar.appendChild(strip);
        video.addEventListener('timeupdate', onTime);
        settle(located);
    }

    function stopPolling() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        if (giveUpTimer) { clearTimeout(giveUpTimer); giveUpTimer = null; }
    }

    function poll() {
        if (dead) return;
        let v = null;
        let bar = null;
        try { v = doc.querySelector(VIDEO_SEL); bar = doc.querySelector(BAR_SEL); } catch (_) { /* retry */ }
        if (!v || !bar || !Number.isFinite(v.duration) || !(v.duration > 0)) return;
        stopPolling();
        video = v;
        try { build(v.duration); } catch (err) {
            Utils.error('overlay: youtube ticks failed', err);
            settle([]);
        }
    }

    function teardown() {
        if (dead) return;
        dead = true;
        stopPolling();
        stopCloseTimer();
        if (popFrame && doc.querySelector(FRAME_SEL) === popFrame) {
            try { onClose(); } catch (_) { /* ignore */ }
        }
        releaseFrame();
        if (video) { try { video.removeEventListener('timeupdate', onTime); } catch (_) { /* ignore */ } }
        if (strip && strip.parentNode) strip.parentNode.removeChild(strip);
        strip = null;
        groups = [];
        settle([]);      // no-op when already settled
    }

    if (!doc || !timed.length) {
        settle([]);
        return { teardown() {}, currentSeconds, ready };
    }
    pollTimer = setInterval(poll, PLAYER_POLL_MS);
    giveUpTimer = setTimeout(() => {
        giveUpTimer = null;
        stopPolling();
        settle([]);      // no player in time: the items stay in the list
    }, PLAYER_WAIT_MS);
    poll();
    return { teardown, currentSeconds, ready };
}

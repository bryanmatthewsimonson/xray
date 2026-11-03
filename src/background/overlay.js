// Inline overlay: background handlers for the xray:overlay:* messages.
//
// TRUST BOUNDARY. The content script runs on a third-party page, so it
// only ever gets LOCATING data (`xray:overlay:lookup` -> toLookupItems).
// Full card content (`xray:overlay:card`) and the page-note writes go
// only to our own extension-origin iframe (overlay-card.html) embedded
// in the matching tab, or to a tabless extension page (the side panel's
// CSP fallback — our own pages can read storage directly anyway).
// Content-script senders are always refused.

import { Utils } from '../shared/utils.js';
import { Storage } from '../shared/storage.js';
import { loadFlags, isEnabled } from '../shared/metadata/feature-flags.js';
import { buildOverlay, toLookupItems, sanitizeAnchor } from '../shared/overlay-model.js';
import { quoteToSeconds } from '../shared/anchor-resolve.js';
import { PageNotes, MAX_NOTE_TEXT, NOTE_ID_RE } from '../shared/page-notes.js';
import { ClaimModel } from '../shared/claim-model.js';
import { AssessmentModel } from '../shared/assessment-model.js';
import { TruthAdjudicationModel, VerdictModel } from '../shared/truth-adjudication-model.js';
import { ForensicModel } from '../shared/forensic-model.js';
import { getArticle } from '../shared/archive-cache.js';
import { getArticleExtraction } from '../shared/audit/audit-cache.js';

export const OVERLAY_CARD_PATH = 'src/overlay/overlay-card.html';
export const SIDE_PANEL_PATH = 'src/sidepanel/index.html';
const SITE_OFF_KEY = 'overlay_site_off';
const MAX_QUOTE = 2000;
const MAX_ITEM_IDS = 500;
const MAX_ITEM_ID_CHARS = 256;
export const SIDE_PANEL_FOCUS_KEY = 'overlay_sidepanel_focus';

const BAD = { ok: false, error: 'bad request' };
const FORBIDDEN = { ok: false, error: 'forbidden' };
const DISABLED = { ok: false, error: 'disabled' };

// Through the house wrapper: it JSON-encodes and may workspace-map keys.
async function readSiteOff() {
    return Storage.get(SITE_OFF_KEY, []);
}

// Session-only (trusted contexts — content scripts cannot read it), raw
// object, ids only. Never falls back to storage.local: it is a transient
// pointer, not data.
async function writeSidePanelFocus(value) {
    if (!chrome.storage || !chrome.storage.session) return;
    await chrome.storage.session.set({ [SIDE_PANEL_FOCUS_KEY]: value });
}

/**
 * Open the side panel for the overlay's CSP fallback. Not the existing
 * openEntityBrowser(): that one TOGGLES the Firefox sidebar (closing it
 * if open) and falls back to a tab, and a tabbed side-panel page is
 * refused by senderAllowed. Both panel APIs need a user gesture, which a
 * message after a 1.5 s timeout no longer carries, so this often returns
 * false; the focus key is written regardless, so the panel shows the
 * items whenever the user opens it.
 */
async function openSidePanel(tab) {
    try {
        if (typeof browser !== 'undefined' && browser.sidebarAction && browser.sidebarAction.open) {
            await browser.sidebarAction.open();
            return true;
        }
        if (chrome.sidePanel && chrome.sidePanel.open) {
            await chrome.sidePanel.open({ tabId: tab.id });
            return true;
        }
    } catch (err) {
        Utils.log('overlay: side panel did not open', err && err.message);
    }
    return false;
}

export const defaultIo = {
    loadFlags,
    isEnabled,
    getURL: (p) => chrome.runtime.getURL(p),
    runtimeId: () => chrome.runtime.id,
    readSiteOff,
    getArticle,
    getArticleExtraction,
    getClaims: (url) => ClaimModel.getBySourceUrl(url),
    getAssessments: (claimId) => AssessmentModel.getByClaimRef({ claim_id: claimId }),
    getVerdicts: async (claimId) => {
        const props = await TruthAdjudicationModel.getByClaim(claimId);
        const out = [];
        for (const p of props) {
            const v = await VerdictModel.getActiveForProposition(p.id);
            if (v) out.push(v);
        }
        return out;
    },
    getFindings: async () => Object.values((await ForensicModel.getAll()) || {}),
    notes: PageNotes,
    writeSidePanelFocus,
    openSidePanel
};

function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase(); } catch (_) { return ''; }
}

function validUrl(url) {
    return typeof url === 'string' && url.length > 0 && url.length <= 4096;
}

function asList(v) {
    return Array.isArray(v) ? v : [];
}

const YT_ID = /^[A-Za-z0-9_-]{6,20}$/;

/**
 * The page URL plus its YouTube canonical form, when it has one: the
 * archive stores watch?v= addresses, while the tab may be on youtu.be,
 * /shorts/ or /embed/. The URL normalizer deliberately doesn't unify
 * these.
 */
function urlCandidates(url) {
    const out = [url];
    try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
        let id = null;
        if (host === 'youtu.be') id = u.pathname.split('/')[1];
        else if (host === 'youtube.com') {
            const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/);
            if (m) id = m[1];
        }
        if (id && YT_ID.test(id)) {
            const canon = 'https://www.youtube.com/watch?v=' + id;
            if (!out.includes(canon)) out.push(canon);
        }
    } catch (_) { /* not a URL: the plain candidate stands */ }
    return out;
}

/**
 * The archived address this page maps to (and its article). Unarchived,
 * it is the page's canonical form (the YouTube watch URL for youtu.be /
 * shorts / embed / live), so a note saved before capture is keyed where
 * the archive will later put the article.
 */
async function resolveArchived(pageUrl, io) {
    const candidates = urlCandidates(pageUrl);
    for (const candidate of candidates) {
        const article = await io.getArticle(candidate);
        if (article) return { url: candidate, article, candidates };
    }
    return { url: candidates[candidates.length - 1], article: null, candidates };
}

/** This page's notes under every address form it maps to (deduped by id). */
async function notesFor(candidates, io) {
    const out = [];
    const seen = new Set();
    for (const candidate of candidates) {
        for (const n of asList(await io.notes.forUrl(candidate))) {
            if (!n || seen.has(n.id)) continue;
            seen.add(n.id);
            out.push(n);
        }
    }
    return out;
}

async function assemble(pageUrl, io) {
    const { url, article, candidates } = await resolveArchived(pageUrl, io);
    // Not archived: personal notes are still the user's (spec §2.3, "free
    // personal notes"); claims, findings and extraction need an article.
    if (!article) {
        return buildOverlay(url, { notes: await notesFor(candidates, io) });
    }

    const claims = asList(await io.getClaims(url));
    const assessmentsByClaim = new Map();
    const verdictsByClaim = new Map();
    for (const c of claims) {
        assessmentsByClaim.set(c.id, asList(await io.getAssessments(c.id)));
        verdictsByClaim.set(c.id, asList(await io.getVerdicts(c.id)));
    }
    const extraction = article.articleHash
        ? await io.getArticleExtraction(article.articleHash)
        : null;

    // quoteToSeconds rebuilds a text index per call: memoize per quote.
    const memo = new Map();
    const secondsFor = (quote) => {
        if (!memo.has(quote)) memo.set(quote, quoteToSeconds(quote, article));
        return memo.get(quote);
    };

    return buildOverlay(url, {
        claims,
        assessmentsByClaim,
        verdictsByClaim,
        findings: asList(await io.getFindings()),
        extraction: extraction || null,
        notes: await notesFor(candidates, io),
        secondsFor
    });
}

async function handleLookup(message, io) {
    if (!validUrl(message.url)) return BAD;
    await io.loadFlags();
    if (!io.isEnabled('inlineOverlay')) return { ok: true, items: [] };
    const off = await io.readSiteOff();
    if (Array.isArray(off) && off.includes(hostOf(message.url))) return { ok: true, items: [] };
    const items = await assemble(message.url, io);
    return { ok: true, items: toLookupItems(items) };
}

/**
 * Our overlay-card page, matched by sender id + extension scheme + exact
 * pathname rather than by the full base URL, so it holds whatever host
 * the browser gives the frame. `onMessage` only ever delivers senders
 * from this extension, and the id check makes that explicit; a content
 * script (https: page URL) can never pass the scheme check.
 */
function isOurCard(sender, senderUrl, io) {
    if (!sender.id || sender.id !== io.runtimeId()) return false;
    let u;
    let base;
    try { u = new URL(senderUrl); base = new URL(io.getURL('')); } catch (_) { return false; }
    return u.protocol === base.protocol && u.pathname === '/' + OVERLAY_CARD_PATH;
}

/** True only for our overlay iframe on the matching tab, or a tabless extension page. */
function senderAllowed(sender, message, io) {
    const senderUrl = sender && typeof sender.url === 'string' ? sender.url : '';
    if (!senderUrl) return false;
    if (sender.tab) {
        if (!isOurCard(sender, senderUrl, io)) return false;
        const tabUrl = sender.tab.url;
        return typeof tabUrl === 'string'
            && Utils.normalizeUrl(tabUrl) === Utils.normalizeUrl(message.url);
    }
    // Tabless: ONLY the side panel. The card is web-accessible, so a
    // page could frame it somewhere tabless and skip the tab binding.
    const panel = io.getURL(SIDE_PANEL_PATH);
    return senderUrl === panel || senderUrl.startsWith(panel + '?') || senderUrl.startsWith(panel + '#');
}

/**
 * CSP fallback, from the content script: the page blocked the card
 * iframe. Bound to the sender's own tab URL; stores ids only.
 */
async function handleOpenInSidePanel(message, sender, io) {
    const tab = sender && sender.tab;
    if (!tab || typeof tab.id !== 'number' || typeof tab.url !== 'string') return FORBIDDEN;
    if (Utils.normalizeUrl(tab.url) !== Utils.normalizeUrl(message.url)) return FORBIDDEN;
    const ids = message.itemIds;
    if (!Array.isArray(ids) || ids.length > MAX_ITEM_IDS
        || !ids.every((i) => typeof i === 'string' && i.length <= MAX_ITEM_ID_CHARS)) {
        return BAD;
    }
    // Start the open first: the closer to the message, the better the
    // (slim) chance a user gesture still counts.
    const opening = io.openSidePanel(tab);
    await io.writeSidePanelFocus({ url: message.url, itemIds: ids.slice() });
    const opened = await opening;
    return { ok: true, opened: !!opened };
}

async function handleCard(message, io) {
    const ids = message.itemIds;
    if (!Array.isArray(ids) || ids.length > MAX_ITEM_IDS || !ids.every((i) => typeof i === 'string')) {
        return BAD;
    }
    const items = await assemble(message.url, io);
    const want = new Set(ids);
    return { ok: true, items: items.filter((it) => want.has(it.id)) };
}

function validNote(note) {
    if (!note || typeof note !== 'object' || Array.isArray(note)) return null;
    if (note.id !== undefined && note.id !== null
        && !(typeof note.id === 'string' && NOTE_ID_RE.test(note.id))) return null;
    if (typeof note.text !== 'string' || !note.text.trim() || note.text.length > MAX_NOTE_TEXT) return null;
    if (note.seconds !== undefined && note.seconds !== null
        && !(typeof note.seconds === 'number' && Number.isFinite(note.seconds) && note.seconds >= 0)) return null;
    if (note.quote !== undefined && note.quote !== null
        && !(typeof note.quote === 'string' && note.quote.length <= MAX_QUOTE)) return null;
    const anchor = note.anchor === undefined || note.anchor === null ? null : sanitizeAnchor(note.anchor);
    return {
        id: note.id || undefined,
        anchor,
        quote: note.quote ?? null,
        seconds: note.seconds ?? null,
        text: note.text
    };
}

async function handleNoteSave(message, io) {
    const clean = validNote(message.note);
    if (!clean) return BAD;
    const { url, candidates } = await resolveArchived(message.url, io);
    let saveUrl = url;
    if (clean.id) {
        // PageNotes.save replaces by id: never let it overwrite another page's note.
        const prior = (await notesFor(candidates, io)).find((n) => n.id === clean.id);
        if (!prior) return BAD;
        // An edit keeps the note where it lives (e.g. a youtu.be-keyed note).
        if (typeof prior.url === 'string' && prior.url) saveUrl = prior.url;
    }
    const note = await io.notes.save({ ...clean, url: saveUrl });
    return { ok: true, note };
}

async function handleNoteDelete(message, io) {
    if (typeof message.id !== 'string' || !NOTE_ID_RE.test(message.id)) return BAD;
    // Only delete a note that belongs to this page.
    const { candidates } = await resolveArchived(message.url, io);
    const mine = await notesFor(candidates, io);
    if (!mine.some((n) => n.id === message.id)) return BAD;
    await io.notes.remove(message.id);
    return { ok: true };
}

export async function handleOverlayMessage(message, sender, io = defaultIo) {
    try {
        if (!message || typeof message !== 'object') return BAD;
        switch (message.type) {
            case 'xray:overlay:lookup':
                return await handleLookup(message, io);
            case 'xray:overlay:openInSidePanel':
                if (!validUrl(message.url)) return BAD;
                await io.loadFlags();
                if (!io.isEnabled('inlineOverlay')) return DISABLED;
                return await handleOpenInSidePanel(message, sender, io);
            case 'xray:overlay:card':
            case 'xray:overlay:note:save':
            case 'xray:overlay:note:delete': {
                if (!validUrl(message.url)) return BAD;
                if (!senderAllowed(sender, message, io)) return FORBIDDEN;
                // Flag off = no overlay surface at all: the card is a static
                // web-accessible resource, so without this a page could
                // frame it to write notes or probe the archive.
                await io.loadFlags();
                if (!io.isEnabled('inlineOverlay')) return DISABLED;
                // The page-embedded card honours "Hide on this site" like
                // lookup does; the tabless side panel (our own page) does not.
                if (sender.tab) {
                    const off = await io.readSiteOff();
                    if (Array.isArray(off) && off.includes(hostOf(message.url))) return DISABLED;
                }
                if (message.type === 'xray:overlay:card') return await handleCard(message, io);
                if (message.type === 'xray:overlay:note:save') return await handleNoteSave(message, io);
                return await handleNoteDelete(message, io);
            }
            default:
                return BAD;
        }
    } catch (err) {
        Utils.error('overlay handler failed', err);
        return BAD;
    }
}

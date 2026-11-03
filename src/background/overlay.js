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
const SITE_OFF_KEY = 'overlay_site_off';
const MAX_QUOTE = 2000;
const MAX_ITEM_IDS = 500;

const BAD = { ok: false, error: 'bad request' };
const FORBIDDEN = { ok: false, error: 'forbidden' };

async function readSiteOff() {
    const got = await chrome.storage.local.get(SITE_OFF_KEY);
    return got ? got[SITE_OFF_KEY] : null;
}

export const defaultIo = {
    loadFlags,
    isEnabled,
    getURL: (p) => chrome.runtime.getURL(p),
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
    notes: PageNotes
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

async function assemble(pageUrl, io) {
    let url = pageUrl;
    let article = null;
    for (const candidate of urlCandidates(pageUrl)) {
        article = await io.getArticle(candidate);
        if (article) { url = candidate; break; }
    }
    if (!article) return null;

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
        notes: asList(await io.notes.forUrl(url)),
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
    if (!items) return { ok: true, items: [] };
    return { ok: true, items: toLookupItems(items) };
}

/** True only for our overlay iframe on the matching tab, or a tabless extension page. */
function senderAllowed(sender, message, io) {
    const senderUrl = sender && typeof sender.url === 'string' ? sender.url : '';
    if (!senderUrl) return false;
    if (sender.tab) {
        if (!senderUrl.startsWith(io.getURL(OVERLAY_CARD_PATH))) return false;
        const tabUrl = sender.tab.url;
        return typeof tabUrl === 'string'
            && Utils.normalizeUrl(tabUrl) === Utils.normalizeUrl(message.url);
    }
    return senderUrl.startsWith(io.getURL(''));
}

async function handleCard(message, io) {
    const ids = message.itemIds;
    if (!Array.isArray(ids) || ids.length > MAX_ITEM_IDS || !ids.every((i) => typeof i === 'string')) {
        return BAD;
    }
    const items = await assemble(message.url, io);
    if (!items) return { ok: true, items: [] };
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
    const note = await io.notes.save({ ...clean, url: message.url });
    return { ok: true, note };
}

async function handleNoteDelete(message, io) {
    if (typeof message.id !== 'string' || !NOTE_ID_RE.test(message.id)) return BAD;
    // Only delete a note that belongs to this page.
    const mine = asList(await io.notes.forUrl(message.url));
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
            case 'xray:overlay:card':
            case 'xray:overlay:note:save':
            case 'xray:overlay:note:delete': {
                if (!validUrl(message.url)) return BAD;
                if (!senderAllowed(sender, message, io)) return FORBIDDEN;
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

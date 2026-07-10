// URL identity — recover the ORIGINAL URL from archive/mirror captures.
//
// A capture made on archive.today, the Wayback Machine, or an arXiv
// rendering variant would otherwise key the article to the MIRROR's
// address: claims, assessments, audits, and a later direct capture of
// the same piece would land in two disconnected buckets. Identity
// policy (maintainer decision, 2026-07-09): **the recovered original
// IS the article's identity** (`article.url`, hence the 30023 d-tag),
// and the fetched address is retained as provenance
// (`article.capture_url`, wire tag `capture-url` — see
// docs/NIP_DRAFT.md).
//
// Recovery is FAIL-OPEN provenance honesty: when the original cannot
// be verified from URL structure or the archive's own DOM markers, we
// claim nothing — the capture keys to the address we actually fetched
// and the reader says "original URL not recovered". A wrong original
// would silently fork identity worse than no original at all.
//
// Pure module: no chrome.*, no globals — callers inject the document
// and the tab URL. Recovered originals run through the unified
// normalizer so an archive capture keys IDENTICALLY to a direct one.

import { normalize } from './metadata/url-normalizer.js';

// archive.today's rotating mirror domains. One service, many hosts.
const ARCHIVE_TODAY_HOSTS = new Set([
    'archive.today', 'archive.ph', 'archive.is', 'archive.md',
    'archive.li', 'archive.vn', 'archive.fo'
]);

const WAYBACK_HOSTS = new Set(['web.archive.org']);

const ARXIV_HOSTS = new Set(['arxiv.org', 'ar5iv.org', 'ar5iv.labs.arxiv.org']);

function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
    catch (_) { return ''; }
}

/** host is an archive-family host OR any subdomain of one —
 *  blog.archive.today must fail this just like archive.today. */
function isArchiveFamilyHost(host) {
    for (const set of [ARCHIVE_TODAY_HOSTS, WAYBACK_HOSTS]) {
        for (const h of set) {
            if (host === h || host.endsWith('.' + h)) return true;
        }
    }
    return false;
}

/**
 * A candidate original is plausible only when it is a real http(s)
 * URL on a NON-archive host — an archive page linking to itself, a
 * sibling snapshot, or an archive-family subdomain (blog, mirrors)
 * must never be adopted as "the original".
 */
function isPlausibleOriginal(candidate) {
    if (typeof candidate !== 'string' || !candidate) return false;
    let u;
    try { u = new URL(candidate); } catch (_) { return false; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!host.includes('.')) return false;
    if (isArchiveFamilyHost(host)) return false;
    return true;
}

// Wayback embeds the original in the path:
//   https://web.archive.org/web/20200301000000/https://example.com/p?q=1
//   https://web.archive.org/web/20200301000000if_/https://example.com/p
// The 2-letter modifier suffix (if_, id_, im_, js_, cs_) selects a
// rendering, never a different document. Operate on the RAW string —
// the embedded original's `?query` would otherwise parse as the outer
// URL's query.
const WAYBACK_PATH_RE = /^https?:\/\/web\.archive\.org\/web\/\d{4,14}(?:[a-z]{2}_)?\/(.+)$/i;

// archive.today path-embedded forms (the share/newest deep links):
//   https://archive.ph/newest/https://example.com/p
//   https://archive.ph/oldest/https://example.com/p
//   https://archive.ph/20200301000000/https://example.com/p
// The bare short-code form (https://archive.ph/AbC12) carries no
// original in the URL — that case needs the DOM markers below.
const ARCHIVE_TODAY_PATH_RE = /^https?:\/\/[^/]+\/(?:newest|oldest|\d{4,14})\/(.+)$/i;

/** Wayback (and some mirrors) collapse `https://` to `https:/`. */
function repairScheme(s) {
    return String(s || '').replace(/^(https?):\/(?!\/)/i, '$1://');
}

/**
 * arXiv rendering variants all describe the SAME paper; its abstract
 * page is the stable citable address:
 *   arxiv.org/pdf/2301.12345v2(.pdf) → arxiv.org/abs/2301.12345v2
 *   arxiv.org/html/2301.12345        → arxiv.org/abs/2301.12345
 *   ar5iv.org/abs/…, ar5iv.labs.arxiv.org/html/… → arxiv.org/abs/…
 * Old-style ids (math/0309136) are preserved verbatim. A URL already
 * on /abs/ at arxiv.org is NOT an alias (returns null).
 */
function arxivOriginal(url) {
    let u;
    try { u = new URL(url); } catch (_) { return null; }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!ARXIV_HOSTS.has(host)) return null;
    const m = /^\/(abs|pdf|html)\/(.+?)(?:\.pdf)?\/?$/.exec(u.pathname);
    if (!m) return null;
    const id = m[2];
    if (!id || /[^A-Za-z0-9./-]/.test(id)) return null;
    if (host === 'arxiv.org' && m[1] === 'abs') return null;   // already canonical
    return `https://arxiv.org/abs/${id}`;
}

/**
 * Canonicalize a RECOVERED original before it becomes identity: an
 * original embedded in an archive path can itself be a rendering
 * variant (web.archive.org/web/<ts>/https://arxiv.org/pdf/X) — without
 * this, the archive capture keys to /pdf/ while a direct capture keys
 * to /abs/, re-creating the exact fork this module exists to prevent.
 */
function canonicalizeOriginal(candidate) {
    return arxivOriginal(candidate) || candidate;
}

/**
 * URL-only identity resolution (the PDF path, and anywhere without a
 * DOM). Returns null for ordinary pages; otherwise:
 *
 *   { original:    string|null,  // normalized recovered original —
 *                                // null = archive page, NOT recovered
 *     captureUrl:  string,       // the address actually fetched, as-is
 *     archiveHost: string }      // e.g. 'archive.ph', 'web.archive.org'
 */
export function resolveUrlIdentityFromUrl(url) {
    const captureUrl = typeof url === 'string' ? url : '';
    if (!captureUrl) return null;
    const host = hostOf(captureUrl);
    if (!host) return null;

    if (WAYBACK_HOSTS.has(host)) {
        const m = WAYBACK_PATH_RE.exec(captureUrl);
        const candidate = m ? repairScheme(m[1]) : null;
        return {
            original: isPlausibleOriginal(candidate) ? normalize(canonicalizeOriginal(candidate)) : null,
            captureUrl,
            archiveHost: host
        };
    }

    if (ARCHIVE_TODAY_HOSTS.has(host)) {
        const m = ARCHIVE_TODAY_PATH_RE.exec(captureUrl);
        const candidate = m ? repairScheme(m[1]) : null;
        return {
            original: isPlausibleOriginal(candidate) ? normalize(canonicalizeOriginal(candidate)) : null,
            captureUrl,
            archiveHost: host
        };
    }

    const arxiv = arxivOriginal(captureUrl);
    if (arxiv) {
        return { original: normalize(arxiv), captureUrl, archiveHost: host };
    }

    return null;
}

/**
 * archive.today snapshot pages carry the original URL in their own
 * chrome. Two markers, in trust order — none qualifying = fail open:
 *   1. `input#HIDDEN_URL` — the prefilled re-archive form value.
 *   2. Anchors in the `#HEADER` bar. The "saved from" anchor renders
 *      the ORIGINAL URL as its own link text, so an anchor qualifies
 *      ONLY when its visible text IS its href — logos, share, donate,
 *      and promoted links carry label text and are structurally
 *      excluded. If more than one distinct URL qualifies, the header
 *      is ambiguous and we claim nothing (a first-plausible-wins scan
 *      would adopt whatever link happens to come first in the DOM —
 *      a WRONG original, the one failure this module must never
 *      produce).
 * Markers are the archive's own DOM and can drift (SMOKE 2.x row
 * verifies against the live site); drift degrades to not-recovered,
 * never to a wrong original.
 */
function archiveTodayDomOriginal(doc) {
    if (!doc || typeof doc.querySelector !== 'function') return null;
    const hidden = doc.querySelector('input#HIDDEN_URL');
    if (hidden && hidden.value && isPlausibleOriginal(hidden.value)) {
        return hidden.value;
    }
    if (typeof doc.querySelectorAll !== 'function') return null;
    const qualified = new Set();
    for (const a of doc.querySelectorAll('#HEADER a[href]')) {
        const href = a.getAttribute ? a.getAttribute('href') : a.href;
        if (!href || !isPlausibleOriginal(href)) continue;
        const text = repairScheme(String(a.textContent || '').trim());
        if (!text || normalize(text) !== normalize(href)) continue;
        qualified.add(normalize(href));
    }
    return qualified.size === 1 ? [...qualified][0] : null;
}

/**
 * Full identity resolution for a live capture: URL structure first,
 * then (archive.today short-code pages) the archive's DOM markers.
 * Same return contract as resolveUrlIdentityFromUrl.
 *
 * @param {Document|null} doc   the archive page's document
 * @param {string} tabUrl       the address actually fetched
 */
export function resolveUrlIdentity(doc, tabUrl) {
    const byUrl = resolveUrlIdentityFromUrl(tabUrl);
    if (!byUrl) return null;
    if (byUrl.original) return byUrl;
    if (ARCHIVE_TODAY_HOSTS.has(byUrl.archiveHost)) {
        const fromDom = archiveTodayDomOriginal(doc);
        if (fromDom) return { ...byUrl, original: normalize(canonicalizeOriginal(fromDom)) };
    }
    return byUrl;
}

/**
 * Re-key an archive capture's outbound links to THEIR originals.
 *
 * Archives rewrite every body anchor onto their own host (Wayback:
 * `/web/<ts>/<target>`; archive.today: path-embedded forms) — so link
 * extraction, which ran against the live DOM, classified every
 * citation as archive-internal and the publish path would emit ZERO
 * `cites` tags. Given the links as extracted and the article's (new,
 * post-identity) own host:
 *
 *   - an archive-wrapped link with a recoverable embedded target is
 *     re-keyed to that target (normalized, arXiv-canonicalized);
 *   - a link that stays on an archive host with NO recoverable target
 *     is DROPPED — it is the archive's navigation chrome, and
 *     publishing archive-host cites would pollute the citation graph;
 *   - everything else passes through unchanged;
 *   - `internal` is re-derived against ownHost and unwrapped
 *     duplicates re-merge (counts summed, first text kept).
 *
 * Pure — safe to unit-test without a DOM.
 */
export function rewriteArchivedLinks(links, ownHost) {
    const own = String(ownHost || '').toLowerCase().replace(/^www\./, '');
    const out = new Map();
    for (const link of (Array.isArray(links) ? links : [])) {
        if (!link || !link.url) continue;
        let url = link.url;
        const wrapped = resolveUrlIdentityFromUrl(url);
        if (wrapped) {
            if (!wrapped.original) continue;   // archive chrome — drop
            url = wrapped.original;
        }
        const host = hostOf(url);
        const existing = out.get(url);
        if (existing) {
            existing.count += (link.count || 1);
            continue;
        }
        out.set(url, {
            url,
            text: link.text || '',
            count: link.count || 1,
            internal: !!own && host === own
        });
    }
    return [...out.values()];
}

export { ARCHIVE_TODAY_HOSTS as _ARCHIVE_TODAY_HOSTS };

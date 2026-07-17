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

// archive.today path-embedded forms (the share/newest deep links AND
// the site's own canonical long form):
//   https://archive.ph/newest/https://example.com/p
//   https://archive.ph/oldest/https://example.com/p
//   https://archive.ph/20200301000000/https://example.com/p
//   https://archive.ph/2021.03.29-224620/https://example.com/p
// The last is the DOTTED timestamp archive.today emits in its own
// rel=canonical — a real capture failed recovery because the regex
// only accepted the digit form (JOURNAL 2026-07-10). The bare
// short-code form (https://archive.ph/AbC12) carries no original in
// the URL — that case needs the canonical fallback or the DOM markers.
const ARCHIVE_TODAY_PATH_RE = /^https?:\/\/[^/]+\/(?:newest|oldest|\d{4,14}|\d{4}\.\d{2}\.\d{2}-\d{6})\/(.+)$/i;

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
 * Google's cache serves under /search?q=cache:<url>. The q value may
 * carry an optional digest segment (cache:<digest>:<url>) and may omit
 * the scheme (cache:example.com/p — https assumed; the cache only
 * serves what it crawled over http(s)).
 */
function googleCacheOriginal(url) {
    let u;
    try { u = new URL(url); } catch (_) { return null; }
    if (!/^\/search/.test(u.pathname)) return null;
    let rest = u.searchParams.get('q') || '';
    if (!/^cache:/i.test(rest)) return null;
    rest = rest.slice('cache:'.length).trim();
    const digest = /^[A-Za-z0-9_-]{8,}:(.+)$/.exec(rest);
    if (digest) rest = digest[1];
    if (!rest) return null;
    if (!/^https?:\/\//i.test(rest)) rest = 'https://' + rest;
    return repairScheme(rest);
}

/**
 * 12ft.io wraps the target as /proxy?q=<url> or path-appended
 * (12ft.io/https://example.com/p). Operate on the RAW string for the
 * path form — the embedded original's query must not parse as 12ft's.
 */
function twelveFtOriginal(url) {
    let u;
    try { u = new URL(url); } catch (_) { return null; }
    if (u.pathname === '/proxy') {
        const q = u.searchParams.get('q') || '';
        return q ? repairScheme(q) : null;
    }
    const raw = String(url).slice(u.origin.length + 1);   // strip "https://12ft.io/"
    return /^https?:/i.test(raw) ? repairScheme(raw) : null;
}

// AMP viewer/cache params that belong to the CACHE, not the original.
const AMP_CACHE_PARAMS = new Set(['amp_js_v', 'amp_gsa', 'amp_r', 'usqp', 'outputType']);

/**
 * AMP caches (`<pub>.cdn.ampproject.org`) serve https originals under
 * /c/s/<host>/<path> and http under /c/<host>/<path>; the /v/ viewer
 * forms mirror this. Only the cache-host WRAPPER is unwrapped — if the
 * page itself is a site's own /amp/ variant, that stays (the canonical
 * is not knowable from the URL). Cache-owned query params are dropped;
 * the original's own params ride along.
 */
function ampCacheOriginal(url) {
    let u;
    try { u = new URL(url); } catch (_) { return null; }
    const m = /^\/[cv]\/(s\/)?(.+)$/.exec(u.pathname);
    if (!m || !m[2]) return null;
    const params = [];
    for (const [k, v] of u.searchParams.entries()) {
        if (!AMP_CACHE_PARAMS.has(k)) params.push(`${k}=${encodeURIComponent(v)}`);
    }
    return (m[1] ? 'https://' : 'http://') + m[2] + (params.length ? `?${params.join('&')}` : '');
}

/**
 * ghostarchive.org: /varchive/<id> is a YouTube capture whose id IS the
 * video id — the original is recoverable. /archive/<code> is an opaque
 * snapshot: recognized as an archive host (capture-url provenance + the
 * reader's manual "Set original URL…" fallback) but no original can be
 * read from the URL.
 */
function ghostarchiveOriginal(url) {
    let u;
    try { u = new URL(url); } catch (_) { return null; }
    const m = /^\/varchive\/([A-Za-z0-9_-]{6,20})\/?$/.exec(u.pathname);
    return m ? `https://www.youtube.com/watch?v=${m[1]}` : null;
}

/**
 * The mirror registry: one rule per family — a host predicate and an
 * extractor returning the embedded original (raw, pre-normalization)
 * or null when the URL shape carries none. Matching a rule's host is
 * what makes a URL "a mirror address" (identity handling + provenance
 * note) even when extraction fails. Add a site here + a test; nothing
 * else changes.
 */
const MIRROR_RULES = [
    {
        name: 'wayback',
        match: (host) => WAYBACK_HOSTS.has(host),
        extract: (url) => {
            const m = WAYBACK_PATH_RE.exec(url);
            return m ? repairScheme(m[1]) : null;
        }
    },
    {
        name: 'archive.today',
        match: (host) => ARCHIVE_TODAY_HOSTS.has(host),
        extract: (url) => {
            const m = ARCHIVE_TODAY_PATH_RE.exec(url);
            return m ? repairScheme(m[1]) : null;
        }
    },
    {
        name: 'google-cache',
        match: (host) => host === 'webcache.googleusercontent.com',
        extract: googleCacheOriginal
    },
    {
        name: '12ft',
        match: (host) => host === '12ft.io',
        extract: twelveFtOriginal
    },
    {
        name: 'amp-cache',
        match: (host) => host === 'cdn.ampproject.org' || host.endsWith('.cdn.ampproject.org'),
        extract: ampCacheOriginal
    },
    {
        name: 'ghostarchive',
        match: (host) => host === 'ghostarchive.org',
        extract: ghostarchiveOriginal
    }
];

/** Any mirror family's host — never adoptable as "the original". */
function isMirrorHost(host) {
    return MIRROR_RULES.some((rule) => rule.match(host));
}

/** One registry pass over an arbitrary URL: the embedded original, or null. */
function unwrapMirror(url) {
    const host = hostOf(url);
    if (!host) return null;
    for (const rule of MIRROR_RULES) {
        if (rule.match(host)) return rule.extract(url);
    }
    return null;
}

/**
 * Canonicalize a RECOVERED original before it becomes identity: an
 * original embedded in an archive path can itself be a rendering
 * variant (web.archive.org/web/<ts>/https://arxiv.org/pdf/X) or
 * ANOTHER mirror wrapper (wayback-of-12ft-of-X) — without this, the
 * archive capture keys to the inner wrapper while a direct capture
 * keys to X, re-creating the exact fork this module exists to prevent.
 * Bounded nested unwrap, then the arXiv variant collapse.
 */
function canonicalizeOriginal(candidate) {
    let cur = candidate;
    for (let i = 0; i < 3; i++) {
        const inner = unwrapMirror(cur);
        if (!inner) break;
        cur = inner;
    }
    return arxivOriginal(cur) || cur;
}

/**
 * URL-only identity resolution (the PDF path, and anywhere without a
 * DOM). Returns null for ordinary pages; otherwise:
 *
 *   { original:    string|null,  // normalized recovered original —
 *                                // null = mirror page, NOT recovered
 *     captureUrl:  string,       // the address actually fetched, as-is
 *     archiveHost: string }      // e.g. 'archive.ph', '12ft.io'
 */
export function resolveUrlIdentityFromUrl(url) {
    const captureUrl = typeof url === 'string' ? url : '';
    if (!captureUrl) return null;
    const host = hostOf(captureUrl);
    if (!host) return null;

    for (const rule of MIRROR_RULES) {
        if (!rule.match(host)) continue;
        const candidate = rule.extract(captureUrl);
        // Canonicalize BEFORE the plausibility gate so a nested wrapper
        // unwraps to something adoptable instead of being rejected as
        // a mirror host.
        const resolved = candidate ? canonicalizeOriginal(candidate) : null;
        return {
            original: (isPlausibleOriginal(resolved) && !isMirrorHost(hostOf(resolved)))
                ? normalize(resolved) : null,
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
 * chrome. Three markers, in trust order — none qualifying = fail open:
 *   1. `input#HIDDEN_URL` — the prefilled re-archive form value.
 *   2. The "saved from" search INPUT — the header form input whose
 *      VALUE is the original URL (a live capture confirmed this is the
 *      marker archive.ph actually renders; it is an input, not an
 *      anchor). A form value being a full http(s) URL on a non-archive
 *      host is a strong signal; ambiguity (two distinct qualifying
 *      values) still fails open.
 *   3. Anchors in the `#HEADER` bar whose visible text IS their href
 *      (the anchor form of "saved from") — logos, share, donate, and
 *      promoted links carry label text and are structurally excluded;
 *      ambiguity fails open (a first-plausible-wins scan would adopt
 *      whatever link happens to come first — a WRONG original, the one
 *      failure this module must never produce).
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

    // 2 — the saved-from input value.
    const inputValues = new Set();
    for (const input of doc.querySelectorAll('#HEADER input, form input')) {
        const value = repairScheme(String((input && input.value) || '').trim());
        if (value && isPlausibleOriginal(value)) inputValues.add(normalize(value));
    }
    if (inputValues.size === 1) return [...inputValues][0];
    if (inputValues.size > 1) return null;   // ambiguous — claim nothing

    // 3 — text-equals-href header anchors.
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
 * Full identity resolution for a live capture: URL structure on the
 * tab URL first, then on the page's own canonical URL (archive.today
 * short-code pages set rel=canonical to the LONG form that embeds the
 * original — pure URL structure, no DOM guesswork), then (archive.today)
 * the archive's DOM markers. Same return contract as
 * resolveUrlIdentityFromUrl; captureUrl is always the tab URL.
 *
 * @param {Document|null} doc          the archive page's document
 * @param {string} tabUrl              the address actually fetched
 * @param {string|null} [canonicalUrl] the extractor's canonical pick
 *                                     (rel=canonical / og:url)
 */
export function resolveUrlIdentity(doc, tabUrl, canonicalUrl = null) {
    const byUrl = resolveUrlIdentityFromUrl(tabUrl);
    if (!byUrl) return null;
    if (byUrl.original) return byUrl;
    if (canonicalUrl && canonicalUrl !== tabUrl) {
        const byCanonical = resolveUrlIdentityFromUrl(canonicalUrl);
        if (byCanonical && byCanonical.original
                && byCanonical.archiveHost === byUrl.archiveHost) {
            return { ...byUrl, original: byCanonical.original };
        }
    }
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
 * outbound link as archive-internal and the publish path would emit
 * ZERO `link` tags. Given the links as extracted and the article's
 * (new, post-identity) own host:
 *
 *   - an archive-wrapped link with a recoverable embedded target is
 *     re-keyed to that target (normalized, arXiv-canonicalized);
 *   - a link that stays on an archive host with NO recoverable target
 *     is DROPPED — it is the archive's navigation chrome, and
 *     publishing archive-host links would pollute the link graph;
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

/**
 * The URLs an article ANSWERS TO: its identity URL and, when the
 * capture came from a mirror, the address it was actually fetched from
 * (`capture_url`). Normalized, so an archive capture and a direct
 * capture of the same piece answer to the same canonical strings.
 *
 * Deliberately NOT "every URL the event mentions". `buildArticleEvent`
 * co-emits indexed `r` tags for `responds-to` targets and for the first
 * 25 outbound links, so a relay `#r=<url>` query also returns articles
 * that merely REFERENCE `url` — someone else's article. Answering an
 * archive probe with one of those renders a foreign body under the
 * requested URL. These two fields are the only addresses that are the
 * article itself.
 *
 * @param {{url?: string, capture_url?: string|null}} article
 * @returns {string[]} normalized addresses, identity first, deduped
 */
export function articleAddresses(article) {
    if (!article) return [];
    const out = [];
    for (const raw of [article.url, article.capture_url]) {
        if (!raw || typeof raw !== 'string') continue;
        let n = '';
        try { n = normalize(raw); } catch (_) { continue; }
        if (n && !out.includes(n)) out.push(n);
    }
    return out;
}

/**
 * Is `article` the article located at `url` — as opposed to one that
 * merely links to it? The identity gate for archive reconstruction.
 *
 * @param {{url?: string, capture_url?: string|null}} article
 * @param {string} url
 * @returns {boolean}
 */
export function articleAnswersTo(article, url) {
    if (!url || typeof url !== 'string') return false;
    let wanted = '';
    try { wanted = normalize(url); } catch (_) { return false; }
    if (!wanted) return false;
    return articleAddresses(article).includes(wanted);
}

export { ARCHIVE_TODAY_HOSTS as _ARCHIVE_TODAY_HOSTS };

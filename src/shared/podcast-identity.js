// Podcast identity discovery — the Phase-22 "Find identity" assist.
//
// The Media modal's podcast identity block (show / feed GUID / episode
// GUID / feed URL / iTunes id) is user-declared by NIP_DRAFT rule.
// This module makes DECLARING it cheap without weakening the rule: it
// discovers a candidate identity and hands it back for the user to
// confirm — the modal only prefills; nothing saves until Save.
//
// Pure: no chrome.*, no DOM. Network happens ONLY inside
// lookupPodcastIdentity, through an injectable fetch (the SW passes
// its own; tests stub it). The XML reader is hand-rolled because the
// MV3 service worker has no DOMParser — the transcript-parse.js
// precedent — and because a podcast feed's five fields don't justify
// a parser dependency.
//
// Privacy contract (disclosed in the modal hint): Apple is contacted
// only when the capture itself doesn't already carry the answer. A
// podcasts.apple.com link yields a numeric lookup (the id, nothing
// else); a feed link skips Apple entirely; ONLY the no-link fallback
// sends a show-name search term to Apple's iTunes Search API.

// ------------------------------------------------------------------
// Signal scan — what the capture already tells us
// ------------------------------------------------------------------

// podcasts.apple.com/<cc>/podcast/<slug>/id315106175 (slug and country
// optional; legacy itunes.apple.com host too). The trailing id is the
// Apple collection id — the free keyless Lookup API keys on it.
const APPLE_PODCAST_ID_RE =
    /(?:podcasts|itunes)\.apple\.com\/(?:[a-z]{2}\/)?podcast\/(?:[^/?#]*\/)?id(\d+)/i;

// Sites whose names show up as byline/siteName on media captures but
// are hosting platforms, not shows — useless as iTunes search terms.
const PLATFORM_NAMES = new Set([
    'youtube', 'spotify', 'apple podcasts', 'substack', 'soundcloud',
    'rumble', 'vimeo', 'tiktok', 'facebook', 'instagram', 'x', 'twitter'
]);

// "Ep. 2117", "Episode 2117", "Ep 2117", "#2117" — the numbering
// convention podcast titles carry; a matching number in a feed item
// title is a near-decisive episode signal.
const EPISODE_NUM_RE = /(?:\bep(?:isode)?\s*\.?\s*#?|#)\s*(\d{1,5})\b/i;

function isHttpUrl(v) {
    try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; }
    catch (_) { return false; }
}

/** An outbound link that plausibly IS an RSS feed. */
export function looksLikeFeedUrl(url) {
    let u;
    try { u = new URL(String(url || '')); } catch (_) { return false; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const path = u.pathname.toLowerCase().replace(/\/+$/, '');
    if (/\.rss$/.test(path)) return true;
    if (/(^|\/)(rss|feed|feeds)$/.test(path)) return true;
    if (/\.xml$/.test(path) && /(rss|feed|podcast)/.test(path)) return true;
    if (u.hostname.toLowerCase().startsWith('feeds.')) return true;
    return false;
}

/**
 * Scan a capture for podcast identity signals. Pure and local — this
 * is also what the reader's Media-button nudge runs, so it must never
 * touch the network.
 *
 * @param {object} article  the capture (links / byline / siteName /
 *   title / publishedAt / youtube.durationSeconds are read)
 * @returns {{itunesId: string|null, feedUrls: string[],
 *   searchTerms: string[], episode: object, strong: boolean}}
 */
export function scanPodcastSignals(article) {
    const a = article || {};
    const links = Array.isArray(a.links) ? a.links : [];

    let itunesId = null;
    const feedUrls = [];
    for (const link of links) {
        const url = link && link.url;
        if (!url) continue;
        if (!itunesId) {
            const m = APPLE_PODCAST_ID_RE.exec(url);
            if (m) { itunesId = m[1]; continue; }
        }
        if (looksLikeFeedUrl(url) && !feedUrls.includes(url)) feedUrls.push(url);
    }

    // Search terms, best first: the channel/byline ("Mormon Stories
    // Podcast"), a non-platform siteName, then any title segment that
    // self-identifies as a show ("… | The Daily Podcast").
    const searchTerms = [];
    const addTerm = (raw) => {
        const t = String(raw || '').replace(/\s+/g, ' ').trim();
        if (!t || t.length > 120) return;
        if (PLATFORM_NAMES.has(t.toLowerCase())) return;
        if (!searchTerms.some((s) => s.toLowerCase() === t.toLowerCase())) searchTerms.push(t);
    };
    addTerm(a.byline);
    addTerm(a.siteName);
    const title = String(a.title || '');
    for (const seg of title.split(/\s*[|—–]\s*/)) {
        if (/\b(podcast|show)\b/i.test(seg) && !EPISODE_NUM_RE.test(seg)) addTerm(seg);
    }

    const numMatch = EPISODE_NUM_RE.exec(title);
    const cleanTitle = title
        .replace(EPISODE_NUM_RE, ' ')
        .replace(/\s*[|—–]\s*(?=[|—–]|$)/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^[\s|—–:-]+|[\s|—–:-]+$/g, '');

    const episode = {
        title,
        cleanTitle,
        episodeNumber: numMatch ? parseInt(numMatch[1], 10) : null,
        publishedAt: typeof a.publishedAt === 'number' ? a.publishedAt : null,
        durationSeconds: (a.youtube && typeof a.youtube.durationSeconds === 'number')
            ? a.youtube.durationSeconds : null
    };

    // "Strong" gates the nudge: an Apple/feed link is decisive; else
    // the capture must at least SAY it's a podcast somewhere.
    const strong = !!itunesId || feedUrls.length > 0
        || /\bpodcast\b/i.test(`${a.byline || ''} ${a.siteName || ''} ${title}`);

    return { itunesId, feedUrls, searchTerms, episode, strong };
}

// ------------------------------------------------------------------
// iTunes Search/Lookup API (free, keyless) — request builders +
// response mapper, crossref.js-style: URLs are built ONLY here, from
// hard-validated inputs, so the SW handler can't become a proxy.
// ------------------------------------------------------------------

export function itunesLookupUrl(itunesId) {
    const id = String(itunesId == null ? '' : itunesId).trim();
    if (!/^\d{1,12}$/.test(id)) return null;
    return `https://itunes.apple.com/lookup?id=${id}&entity=podcast`;
}

export function itunesSearchUrl(term) {
    const t = String(term == null ? '' : term).replace(/\s+/g, ' ').trim();
    if (!t || t.length > 200) return null;
    return `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=5&term=${encodeURIComponent(t)}`;
}

/** iTunes results → [{collectionName, collectionId, feedUrl}], feed-bearing only. */
export function mapItunesResults(json) {
    const results = json && Array.isArray(json.results) ? json.results : [];
    const out = [];
    for (const r of results) {
        if (!r || typeof r !== 'object') continue;
        const feedUrl = typeof r.feedUrl === 'string' && isHttpUrl(r.feedUrl) ? r.feedUrl : null;
        if (!feedUrl) continue;
        out.push({
            collectionName: typeof r.collectionName === 'string' ? r.collectionName : null,
            collectionId: r.collectionId != null ? String(r.collectionId) : null,
            feedUrl
        });
    }
    return out;
}

// ------------------------------------------------------------------
// RSS feed reader — hand-rolled, DOMParser-free
// ------------------------------------------------------------------

function decodeXmlText(raw) {
    let s = String(raw == null ? '' : raw);
    const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s);
    if (cdata) s = cdata[1];
    else s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    return s
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .trim();
}

// First <name>…</name> in `block`; `name` may carry an optional
// namespace prefix pattern (regex source, e.g. '(?:[a-z0-9_-]+:)?duration').
function tagText(block, name) {
    const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
    const m = re.exec(block);
    return m ? decodeXmlText(m[1]) : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "1:02:03" / "62:03" / "3723" → integer seconds, or null. */
export function parseItunesDuration(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    const m = /^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
    if (!m) return null;
    const [, a, b, c] = m;
    return c !== undefined
        ? (parseInt(a, 10) * 3600) + (parseInt(b, 10) * 60) + parseInt(c, 10)
        : (parseInt(a, 10) * 60) + parseInt(b, 10);
}

const MAX_FEED_ITEMS = 5000;

/**
 * Read the identity-relevant fields out of an RSS podcast feed.
 * Tolerant by design: a non-feed document comes back empty (no title,
 * no items), never a throw.
 *
 * @returns {{title: string|null, podcastGuid: string|null,
 *   items: Array<{guid: string|null, title: string|null,
 *     pubDate: number|null, durationSeconds: number|null}>}}
 */
export function readFeedXml(xml) {
    const text = String(xml == null ? '' : xml).replace(/<!--[\s\S]*?-->/g, '');

    const firstItem = text.search(/<item[\s>]/i);
    const channelPart = firstItem === -1 ? text : text.slice(0, firstItem);

    const title = tagText(channelPart, 'title');

    // <podcast:guid> by its conventional prefix; fallback to any
    // prefixed *:guid in the CHANNEL whose value is UUID-shaped (the
    // prefix is technically free, the value shape is not). A bare
    // <guid> is an item-level tag and never a feed GUID.
    let podcastGuid = tagText(channelPart, 'podcast:guid');
    if (!podcastGuid) {
        const alt = tagText(channelPart, '[a-z0-9_-]+:guid');
        if (alt && UUID_RE.test(alt)) podcastGuid = alt;
    }
    if (podcastGuid && !UUID_RE.test(podcastGuid)) podcastGuid = null;
    if (podcastGuid) podcastGuid = podcastGuid.toLowerCase();

    const items = [];
    const itemRe = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
    let m;
    while ((m = itemRe.exec(text)) !== null && items.length < MAX_FEED_ITEMS) {
        const block = m[1];
        const pubRaw = tagText(block, 'pubDate');
        const pubMs = pubRaw ? Date.parse(pubRaw) : NaN;
        items.push({
            guid: tagText(block, 'guid'),
            title: tagText(block, 'title'),
            pubDate: Number.isFinite(pubMs) ? Math.floor(pubMs / 1000) : null,
            durationSeconds: parseItunesDuration(tagText(block, '(?:[a-z0-9_-]+:)?duration'))
        });
    }

    return { title, podcastGuid, items };
}

// ------------------------------------------------------------------
// Podcast GUID — UUIDv5 of the feed URL (Podcasting 2.0)
// ------------------------------------------------------------------

// The podcast-namespace UUID under which every feed GUID is derived.
export const PODCAST_GUID_NAMESPACE = 'ead4c236-bf58-58c6-a2c6-a6b28d128cb6';

/** Spec normalization: scheme and trailing slashes stripped. */
export function normalizeFeedUrlForGuid(url) {
    return String(url == null ? '' : url).trim()
        .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
        .replace(/\/+$/, '');
}

function uuidToBytes(uuid) {
    const hex = String(uuid).replace(/-/g, '');
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
}

/**
 * The Podcasting 2.0 feed GUID: UUIDv5 (SHA-1, via crypto.subtle) of
 * the normalized feed URL under PODCAST_GUID_NAMESPACE. Vector:
 * "https://podnews.net/rss" → 9b024349-ccf0-5f69-a609-6b82873eab3c.
 */
export async function computePodcastGuid(feedUrl, { subtle } = {}) {
    const name = normalizeFeedUrlForGuid(feedUrl);
    if (!name) return null;
    const sub = subtle || (typeof crypto !== 'undefined' && crypto.subtle) || null;
    if (!sub) throw new Error('crypto.subtle unavailable');
    const ns = uuidToBytes(PODCAST_GUID_NAMESPACE);
    const nameBytes = new TextEncoder().encode(name);
    const data = new Uint8Array(ns.length + nameBytes.length);
    data.set(ns, 0);
    data.set(nameBytes, ns.length);
    const hash = new Uint8Array(await sub.digest('SHA-1', data));
    const b = hash.slice(0, 16);
    b[6] = (b[6] & 0x0f) | 0x50;    // version 5
    b[8] = (b[8] & 0x3f) | 0x80;    // RFC 4122 variant
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ------------------------------------------------------------------
// Episode matching — fuzzy title + pubDate/duration proximity
// ------------------------------------------------------------------

const TITLE_STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'with', 'on', 'in', 'to', 'ep', 'episode']);

function titleTokens(s) {
    return String(s || '').toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((t) => t && !TITLE_STOPWORDS.has(t));
}

/** Containment coefficient over word tokens, 0..1. */
export function titleSimilarity(a, b) {
    const ta = titleTokens(a);
    const tb = new Set(titleTokens(b));
    if (ta.length === 0 || tb.size === 0) return 0;
    let hit = 0;
    for (const t of new Set(ta)) if (tb.has(t)) hit++;
    return hit / Math.min(new Set(ta).size, tb.size);
}

/**
 * Pick the feed item most likely to BE the captured episode.
 * Deterministic scoring — same inputs, same answer — so the
 * confidence note the user confirms against is reproducible.
 *
 * @param {Array} items    readFeedXml items
 * @param {object} hints   scanPodcastSignals().episode
 * @returns {{item: object, confidence: 'strong'|'moderate'|'weak',
 *   score: number, reasons: string[]}|null}  null when nothing clears
 *   the floor — a wrong prefill is worse than an empty field.
 */
export function matchEpisode(items, hints) {
    const list = Array.isArray(items) ? items : [];
    const h = hints || {};
    let best = null;

    for (const item of list) {
        if (!item) continue;
        const sim = Math.max(
            titleSimilarity(h.cleanTitle || h.title, item.title),
            titleSimilarity(h.title, item.title)
        );

        const itemNum = EPISODE_NUM_RE.exec(String(item.title || ''));
        const epNumHit = h.episodeNumber != null && itemNum
            && parseInt(itemNum[1], 10) === h.episodeNumber;

        let dateDays = null;
        if (typeof h.publishedAt === 'number' && typeof item.pubDate === 'number') {
            dateDays = Math.abs(item.pubDate - h.publishedAt) / 86400;
        }
        const dateStrong = dateDays !== null && dateDays <= 2;
        const dateNear = !dateStrong && dateDays !== null && dateDays <= 10;

        let durDelta = null;
        if (typeof h.durationSeconds === 'number' && typeof item.durationSeconds === 'number') {
            durDelta = Math.abs(item.durationSeconds - h.durationSeconds);
        }
        const durBase = Math.max(h.durationSeconds || 0, 1);
        const durStrong = durDelta !== null && (durDelta <= 90 || durDelta / durBase <= 0.03);
        const durNear = !durStrong && durDelta !== null && (durDelta <= 300 || durDelta / durBase <= 0.10);

        const score = (sim * 3)
            + (epNumHit ? 2 : 0)
            + (dateStrong ? 1.5 : (dateNear ? 0.75 : 0))
            + (durStrong ? 1.5 : (durNear ? 0.75 : 0));

        let confidence = null;
        if ((epNumHit && (sim >= 0.5 || dateStrong || durStrong))
            || (sim >= 0.85 && (dateStrong || durStrong))) confidence = 'strong';
        else if (sim >= 0.6 || epNumHit || (dateStrong && durStrong)) confidence = 'moderate';
        else if (sim >= 0.35 || (dateStrong || (dateNear && durNear))) confidence = 'weak';
        if (!confidence) continue;

        const reasons = [];
        if (sim >= 0.85) reasons.push('title matches closely');
        else if (sim >= 0.5) reasons.push('title overlaps');
        if (epNumHit) reasons.push(`episode number ${h.episodeNumber} matches`);
        if (dateStrong) reasons.push(`published within ${Math.max(1, Math.round(dateDays))} day${dateDays > 1.5 ? 's' : ''}`);
        else if (dateNear) reasons.push(`published within ${Math.round(dateDays)} days`);
        if (durStrong) reasons.push(`duration within ${Math.max(1, Math.round(durDelta / 60))} min`);
        else if (durNear) reasons.push('duration is close');

        if (!best || score > best.score) best = { item, confidence, score, reasons };
    }
    return best;
}

// ------------------------------------------------------------------
// The lookup pipeline — the ONE place network happens
// ------------------------------------------------------------------

const FEED_ACCEPT = 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1';
const MAX_FEED_BYTES = 10 * 1024 * 1024;

async function fetchText(fetchFn, url, accept) {
    const resp = await fetchFn(url, { credentials: 'omit', headers: { Accept: accept } });
    if (!resp || !resp.ok) throw new Error(`HTTP ${resp ? resp.status : 'no response'}`);
    return resp.text();
}

async function fetchJson(fetchFn, url) {
    const resp = await fetchFn(url, { credentials: 'omit', headers: { Accept: 'application/json' } });
    if (!resp || !resp.ok) throw new Error(`HTTP ${resp ? resp.status : 'no response'}`);
    return resp.json();
}

/**
 * Run the discovery pipeline over a capture's signals. Runs in the SW
 * (the `xray:media:lookup` handler) — extension pages can't rely on
 * page-CSP-free cross-origin fetch, and the house rule keeps network
 * in the worker. Escalation order is the privacy contract:
 *
 *   1. Apple id from a podcasts.apple.com link → Lookup API (numeric
 *      id only leaves the device).
 *   2. Feed-shaped outbound links → fetched directly, Apple never
 *      contacted.
 *   3. Fallback: show-name search terms → iTunes Search API (the show
 *      name leaves the device — the modal hint discloses exactly this).
 *
 * @param {object} signals  scanPodcastSignals() output (validated
 *   defensively — it crossed a message boundary)
 * @returns {Promise<{candidate: object, match: object|null, notes: string[]}>}
 *   candidate carries the article.podcast field names verbatim.
 * @throws when no feed can be found/read — the caller wraps it in the
 *   house {ok:false, error} envelope.
 */
export async function lookupPodcastIdentity(signals, { fetchFn, subtle } = {}) {
    const s = signals || {};
    const doFetch = fetchFn || ((...args) => globalThis.fetch(...args));
    const notes = [];

    // Feed candidates, best-source first: [{feedUrl, show, itunesId}].
    const candidates = [];
    const lookupUrl = itunesLookupUrl(s.itunesId);
    if (lookupUrl) {
        try {
            const hit = mapItunesResults(await fetchJson(doFetch, lookupUrl))[0];
            if (hit) {
                candidates.push({ feedUrl: hit.feedUrl, show: hit.collectionName, itunesId: hit.collectionId });
            } else {
                notes.push('Apple lookup returned no feed for the linked id');
            }
        } catch (err) {
            notes.push(`Apple lookup failed (${err.message})`);
        }
    }
    for (const url of (Array.isArray(s.feedUrls) ? s.feedUrls : []).slice(0, 3)) {
        if (isHttpUrl(url) && !candidates.some((c) => c.feedUrl === url)) {
            candidates.push({ feedUrl: url, show: null, itunesId: null });
        }
    }

    const tryFeed = async (cand) => {
        let text = await fetchText(doFetch, cand.feedUrl, FEED_ACCEPT);
        if (text.length > MAX_FEED_BYTES) {
            text = text.slice(0, MAX_FEED_BYTES);
            notes.push('feed truncated at 10 MB — oldest episodes may be missing');
        }
        // An HTML page has a <title> too — demand RSS structure before
        // trusting anything readFeedXml pulled out of the document.
        if (!/<rss[\s>]|<channel[\s>]/i.test(text.slice(0, 4096))) throw new Error('not an RSS feed');
        return readFeedXml(text);
    };

    let won = null;      // { cand, parsed }
    for (const cand of candidates) {
        try { won = { cand, parsed: await tryFeed(cand) }; break; }
        catch (err) { notes.push(`feed ${cand.feedUrl} unusable (${err.message})`); }
    }

    // Fallback: the search path — the only step that sends a show name.
    if (!won) {
        for (const term of (Array.isArray(s.searchTerms) ? s.searchTerms : []).slice(0, 2)) {
            const url = itunesSearchUrl(term);
            if (!url) continue;
            try {
                const hit = mapItunesResults(await fetchJson(doFetch, url))[0];
                if (!hit) { notes.push(`no Apple search result for “${term}”`); continue; }
                notes.push(`show name “${term}” was sent to Apple's iTunes Search API`);
                won = {
                    cand: { feedUrl: hit.feedUrl, show: hit.collectionName, itunesId: hit.collectionId },
                    parsed: await tryFeed({ feedUrl: hit.feedUrl })
                };
                break;
            } catch (err) {
                notes.push(`search “${term}” failed (${err.message})`);
            }
        }
    }

    if (!won) throw new Error('no podcast feed found from this capture’s signals');
    const { cand, parsed } = won;

    // Feed GUID: the feed's own declaration wins over the computed
    // UUIDv5 on mismatch — feeds change hosts, and a declared GUID is
    // exactly the identity that survives the move. Verified when both
    // exist; computed only as a fallback.
    let feedGuid = parsed.podcastGuid;
    try {
        const computed = await computePodcastGuid(cand.feedUrl, { subtle });
        if (feedGuid && computed && feedGuid !== computed) {
            notes.push('declared feed GUID differs from the UUIDv5 of the feed URL — using the declared one (feeds keep their GUID across host moves)');
        } else if (feedGuid && computed && feedGuid === computed) {
            notes.push('feed GUID verified (declared matches the computed UUIDv5)');
        } else if (!feedGuid && computed) {
            feedGuid = computed;
            notes.push('no <podcast:guid> in the feed — GUID computed as UUIDv5 of the feed URL');
        }
    } catch (err) {
        if (!feedGuid) notes.push(`feed GUID unavailable (${err.message})`);
    }

    const match = matchEpisode(parsed.items, s.episode);
    if (match && !match.item.guid) notes.push('the matched episode carries no GUID in the feed');
    if (!match && parsed.items.length > 0) notes.push('no confident episode match in the feed — episode GUID left empty');

    const candidate = {};
    const show = parsed.title || cand.show;
    if (show) candidate.show = show;
    if (feedGuid) candidate.feed_guid = feedGuid;
    if (match && match.item.guid) candidate.episode_guid = match.item.guid;
    candidate.feed_url = cand.feedUrl;
    if (cand.itunesId) candidate.itunes_id = String(cand.itunesId);

    return {
        candidate,
        match: match ? {
            title: match.item.title,
            pubDate: match.item.pubDate,
            durationSeconds: match.item.durationSeconds,
            confidence: match.confidence,
            reasons: match.reasons
        } : null,
        notes
    };
}

// ------------------------------------------------------------------
// Confidence note — one source of truth for the modal's summary line
// (the describeTranscriptParse idiom).
// ------------------------------------------------------------------

export function describePodcastLookup(result) {
    if (!result || !result.candidate) return '';
    const bits = [];
    if (result.candidate.show) bits.push(`Found: ${result.candidate.show}`);
    if (result.match) {
        const conf = result.match.confidence || 'weak';
        const why = (result.match.reasons || []).join(', ');
        bits.push(`episode match (${conf}${why ? `: ${why}` : ''}) — “${result.match.title || 'untitled'}”`);
    }
    return bits.join(' · ');
}

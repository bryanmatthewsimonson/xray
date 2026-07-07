// Quote grounding — Phase 14.5 provenance hardening.
//
// PURE module (no chrome, no DOM, no network). One job: given the
// captured article text and a quote an LLM *claims* is verbatim, find
// the real span in the article — or say, definitively, that it is not
// there.
//
// The contract that makes Suggest provenance absolute:
//
//   - The model's quote is a SEARCH KEY, never the stored evidence.
//     Whatever tier matches, the returned `exact` is the article's own
//     characters at [start, end) — an anchor built from it can never
//     carry text the article does not contain.
//   - A miss is a hard answer ('missing'), not a shrug. The caller
//     (llm-proposals' validation firewall) blocks acceptance instead of
//     storing an unresolvable anchor.
//
// Matching tiers, in order:
//
//   1. exact      — raw indexOf. The model really did copy verbatim.
//   2. normalized — typographic drift only: curly quotes, unicode
//                   dashes, ellipsis, NBSP/zero-width chars, case, and
//                   collapsed whitespace. A per-character offset map
//                   recovers the raw span, so the match is still
//                   byte-recoverable. This absorbs most Opus drift.
//   3. fuzzy      — small wording drift (a dropped word, a "fixed"
//                   typo): token-window search scored by in-order
//                   overlap, thresholded hard. Below the threshold —
//                   and always for very short quotes — the answer is
//                   'missing', because a wrong anchor is worse than no
//                   anchor.
//
// Result shape (ground/groundQuote):
//   { status: 'exact'|'normalized'|'fuzzy'|'missing',
//     score: 0..1, start, end, exact }
// where `exact === articleText.slice(start, end)` for every non-missing
// status.

// Fuzzy guardrails: quotes shorter than MIN_FUZZY_TOKENS words never
// fuzzy-match (too easy to land on the wrong sentence), quotes longer
// than MAX_FUZZY_TOKENS never fuzzy-match either (the LCS pass is
// quadratic in the quote length and runs synchronously in the review
// panel's render path — a near-article-length "quote" is a bad quote,
// not a repair candidate), and a candidate span must score at least
// FUZZY_MIN_SCORE (token-F1: in-order overlap balanced against span
// dilution) to count as found.
export const MIN_FUZZY_TOKENS = 4;
export const MAX_FUZZY_TOKENS = 256;
export const FUZZY_MIN_SCORE = 0.8;
const MAX_FUZZY_CANDIDATES = 24;

// Typographic equivalence classes. Deliberately small: this absorbs
// punctuation *rendering* differences, not wording differences.
const QUOTE_SINGLE = new Set(['‘', '’', '‚', '‛', '′', '`', '´']);
const QUOTE_DOUBLE = new Set(['“', '”', '„', '‟', '«', '»', '″']);
const DASHES = new Set(['‐', '‑', '‒', '–', '—', '―', '−']);
const INVISIBLES = new Set(['­', '​', '‌', '‍', '﻿']);

/**
 * Normalize `text` for matching, keeping a per-character map back to
 * raw offsets. Whitespace runs collapse to a single space attributed
 * to the whole run; multi-char expansions (… → ...) attribute every
 * output char to the source char's raw span. Leading/trailing
 * whitespace is dropped.
 *
 * @param {string} text
 * @returns {{norm: string, rawStart: number[], rawEnd: number[]}}
 *   rawStart[i]/rawEnd[i] bound the raw chars behind norm[i].
 */
export function normalizeWithMap(text) {
    const src = String(text || '');
    const out = [];
    const rawStart = [];
    const rawEnd = [];
    let lastWasSpace = false;
    let i = 0;
    while (i < src.length) {
        const cp = src.codePointAt(i);
        const ch = String.fromCodePoint(cp);
        const next = i + ch.length;
        if (INVISIBLES.has(ch)) { i = next; continue; }
        if (/\s/.test(ch)) {
            if (out.length === 0) { i = next; continue; }        // leading — drop
            if (lastWasSpace) {
                rawEnd[rawEnd.length - 1] = next;                 // extend the run
            } else {
                out.push(' '); rawStart.push(i); rawEnd.push(next);
                lastWasSpace = true;
            }
            i = next;
            continue;
        }
        lastWasSpace = false;
        let mapped;
        if (QUOTE_SINGLE.has(ch)) mapped = "'";
        else if (QUOTE_DOUBLE.has(ch)) mapped = '"';
        else if (DASHES.has(ch)) mapped = '-';
        else if (ch === '…') mapped = '...';
        else mapped = ch.toLowerCase();
        // Push per UTF-16 CODE UNIT (not per code point): the map is
        // indexed by norm-string positions, and indexOf works in code
        // units — an astral char must contribute two entries or every
        // offset after it shifts.
        for (let u = 0; u < mapped.length; u++) {
            out.push(mapped[u]); rawStart.push(i); rawEnd.push(next);
        }
        i = next;
    }
    while (out.length && out[out.length - 1] === ' ') { out.pop(); rawStart.pop(); rawEnd.pop(); }
    return { norm: out.join(''), rawStart, rawEnd };
}

function tokensOf(normStr) {
    // Tokens are runs of non-space chars in normalized space; each
    // carries its normalized [ns, ne) bounds for mapping back. `t` is
    // the comparison core — surrounding punctuation stripped, so the
    // article's `“downtown` matches the model's `downtown`. A token
    // that is pure punctuation keeps itself as its core.
    const tokens = [];
    const re = /[^ ]+/g;
    let m;
    while ((m = re.exec(normStr)) !== null) {
        const core = m[0].replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
        tokens.push({ t: core || m[0], ns: m.index, ne: m.index + m[0].length });
    }
    return tokens;
}

const MISSING = Object.freeze({ status: 'missing', score: 0, start: -1, end: -1, exact: '' });

/**
 * Build a reusable grounding index over the article text. Grounding
 * the same quote twice is memoized, so render-loop callers (the review
 * panel re-validates on every repaint) stay cheap.
 *
 * @param {string} articleText
 * @returns {{text: string, ground: (quote: string) => object}}
 */
export function createGroundingIndex(articleText) {
    const text = String(articleText || '');
    const { norm, rawStart, rawEnd } = normalizeWithMap(text);
    const tokens = tokensOf(norm);
    const memo = new Map();

    // Normalized-offset → raw span for a norm range [a, b).
    function rawSpanOf(a, b) {
        let start = rawStart[a];
        let end = rawEnd[b - 1];
        // A boundary that landed on a collapsed whitespace run: pull it
        // in to the nearest real character so the span never starts or
        // ends mid-run.
        while (start < end && /\s/.test(text[start])) start += 1;
        while (end > start && /\s/.test(text[end - 1])) end -= 1;
        return { start, end };
    }

    function found(status, score, start, end) {
        return { status, score, start, end, exact: text.slice(start, end) };
    }

    function groundUncached(quoteRaw) {
        const quote = String(quoteRaw || '').trim();
        if (!quote || !text) return MISSING;

        // Tier 1 — the model really copied verbatim.
        const idx = text.indexOf(quote);
        if (idx >= 0) return found('exact', 1, idx, idx + quote.length);

        // Tier 2 — typographic drift; recover the raw span via the map.
        const qn = normalizeWithMap(quote).norm;
        if (!qn || !norm) return MISSING;
        const nIdx = norm.indexOf(qn);
        if (nIdx >= 0) {
            const { start, end } = rawSpanOf(nIdx, nIdx + qn.length);
            if (end > start) return found('normalized', 1, start, end);
        }

        // Tier 3 — wording drift, guarded hard.
        return fuzzyGround(qn);
    }

    function fuzzyGround(qn) {
        const qTokens = tokensOf(qn).map((t) => t.t);
        const w = qTokens.length;
        if (w < MIN_FUZZY_TOKENS || w > MAX_FUZZY_TOKENS || tokens.length === 0) return MISSING;

        // Prefilter: rolling bag-overlap of quote tokens over article
        // windows of the quote's length. O(article tokens).
        const need = new Map();
        for (const t of qTokens) need.set(t, (need.get(t) || 0) + 1);
        const have = new Map();
        let overlap = 0;
        const candidates = [];
        for (let iTok = 0; iTok < tokens.length; iTok++) {
            const tIn = tokens[iTok].t;
            const cIn = have.get(tIn) || 0;
            if (cIn < (need.get(tIn) || 0)) overlap += 1;
            have.set(tIn, cIn + 1);
            if (iTok >= w) {
                const tOut = tokens[iTok - w].t;
                const cOut = have.get(tOut) || 0;
                if (cOut <= (need.get(tOut) || 0)) overlap -= 1;
                have.set(tOut, cOut - 1);
            }
            if (iTok >= w - 1 && overlap / w >= 0.5) {
                candidates.push({ startTok: iTok - w + 1, overlap });
            }
        }
        if (candidates.length === 0) return MISSING;
        candidates.sort((a, b) => b.overlap - a.overlap || a.startTok - b.startTok);

        // The alignment window extends past the prefilter window: a
        // quote that DROPPED words aligns to an article span longer
        // than itself.
        const slack = Math.max(2, Math.ceil(w * 0.25));
        let best = null;
        for (const cand of candidates.slice(0, MAX_FUZZY_CANDIDATES)) {
            const window = tokens.slice(cand.startTok, cand.startTok + w + slack);
            const aligned = lcsAlign(qTokens, window.map((t) => t.t));
            if (aligned.length === 0) continue;
            const firstW = aligned[0][1];
            const lastW = aligned[aligned.length - 1][1];
            const spanTokens = lastW - firstW + 1;
            // Token-F1: how much of the quote is present in order,
            // balanced against how diluted the matched span is.
            const score = (2 * aligned.length) / (w + spanTokens);
            if (!best || score > best.score) {
                best = { score, startTok: cand.startTok + firstW, endTok: cand.startTok + lastW };
            }
        }
        if (!best || best.score < FUZZY_MIN_SCORE) return MISSING;
        const { start, end } = rawSpanOf(tokens[best.startTok].ns, tokens[best.endTok].ne);
        if (end <= start) return MISSING;
        return found('fuzzy', Math.min(1, best.score), start, end);
    }

    return {
        text,
        ground(quote) {
            const key = String(quote || '');
            if (memo.has(key)) return memo.get(key);
            const result = groundUncached(key);
            memo.set(key, result);
            return result;
        }
    };
}

/**
 * In-order token alignment (classic LCS with backtrace). Returns the
 * matched index pairs [[qi, wi], …] in order.
 */
function lcsAlign(a, b) {
    const n = a.length;
    const m = b.length;
    // dp[(i * (m + 1)) + j] = LCS length of a[i:], b[j:].
    const dp = new Uint16Array((n + 1) * (m + 1));
    for (let i2 = n - 1; i2 >= 0; i2--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i2 * (m + 1) + j] = a[i2] === b[j]
                ? dp[(i2 + 1) * (m + 1) + j + 1] + 1
                : Math.max(dp[(i2 + 1) * (m + 1) + j], dp[i2 * (m + 1) + j + 1]);
        }
    }
    const pairs = [];
    let i2 = 0;
    let j = 0;
    while (i2 < n && j < m) {
        if (a[i2] === b[j]) { pairs.push([i2, j]); i2 += 1; j += 1; }
        else if (dp[(i2 + 1) * (m + 1) + j] >= dp[i2 * (m + 1) + j + 1]) i2 += 1;
        else j += 1;
    }
    return pairs;
}

/**
 * One-off convenience for callers without a reusable index.
 *
 * @param {string} quote
 * @param {string} articleText
 * @returns {{status: string, score: number, start: number, end: number, exact: string}}
 */
export function groundQuote(quote, articleText) {
    return createGroundingIndex(articleText).ground(quote);
}

/** Duck-type check: is `value` a grounding index (vs a raw string)? */
export function isGroundingIndex(value) {
    return !!value && typeof value === 'object'
        && typeof value.ground === 'function' && typeof value.text === 'string';
}

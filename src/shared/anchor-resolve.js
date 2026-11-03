// Anchor resolution — pure, DOM-free matching core for the inline overlay.
// Builds a normalized text index over opaque segments (the content script
// supplies DOM text nodes as `ref`s), resolves W3C-style quote selectors /
// bare quotes to a range in that index, maps ranges back to (ref, raw
// offset). Quote -> seconds lives in quote-seconds.js, so the content
// bundle never pulls in the transcript/event-builder chain.

export const ACCEPT_CONFIDENCE = 0.7;
export const FUZZY_MAX_QUOTE = 200;
export const MAX_PAGE_CHARS = 2 * 1024 * 1024;

const MAX_FUZZY_REGIONS = 50;
const CHUNK_SIZE = 8;

// ------------------------------------------------------------------
// Normalization (with a normalized-index -> raw-index map)
// ------------------------------------------------------------------

function foldChar(ch) {
    if (/\s/.test(ch)) return ' ';
    if ('‘’‚‛'.includes(ch)) return "'";
    if ('“”„‟'.includes(ch)) return '"';
    if ('–—―‒'.includes(ch)) return '-';
    return ch;
}

/**
 * Normalize `raw` and keep, for every output char, the index of the raw
 * char it came from. Returns {text, idx}.
 */
function normalizeWithMap(raw, trim = true) {
    const chars = [];
    const idx = [];
    const src = String(raw == null ? '' : raw);
    for (let i = 0; i < src.length;) {
        const cp = src.codePointAt(i);
        const ch = String.fromCodePoint(cp);
        const rawIndex = i;
        i += ch.length;
        for (const c of ch.normalize('NFKC')) {
            for (const f of foldChar(c)) { chars.push(f); idx.push(rawIndex); }
        }
    }
    // Markdown: [text](url) -> text; drop emphasis markers.
    const s = chars.join('');
    const drop = new Uint8Array(chars.length);
    const linkRe = /\[([^\]]*)\]\([^)]*\)/g;
    let m;
    while ((m = linkRe.exec(s)) !== null) {
        drop[m.index] = 1;
        const textEnd = m.index + 1 + m[1].length;
        for (let k = textEnd; k < m.index + m[0].length; k++) drop[k] = 1;
    }
    for (let k = 0; k < chars.length; k++) {
        if (chars[k] === '*' || chars[k] === '_') drop[k] = 1;
    }
    const outChars = [];
    const outIdx = [];
    for (let k = 0; k < chars.length; k++) {
        if (drop[k]) continue;
        if (chars[k] === ' ') {
            const prev = outChars[outChars.length - 1];
            if (prev === ' ') continue;
            if (prev === undefined && trim) continue;
        }
        outChars.push(chars[k]);
        outIdx.push(idx[k]);
    }
    if (trim && outChars[outChars.length - 1] === ' ') { outChars.pop(); outIdx.pop(); }
    return { text: outChars.join(''), idx: outIdx };
}

export function normalizeForMatch(s) {
    return normalizeWithMap(s, true).text;
}

// ------------------------------------------------------------------
// Index
// ------------------------------------------------------------------

export function buildTextIndex(segments) {
    let text = '';
    const map = [];
    let oversize = false;
    for (const seg of segments || []) {
        if (!seg) continue;
        const n = normalizeWithMap(seg.text, true);
        if (!n.text) continue;
        const sep = text.length > 0 ? 1 : 0;
        if (text.length + sep + n.text.length > MAX_PAGE_CHARS) { oversize = true; break; }
        if (sep) text += ' ';
        const start = text.length;
        text += n.text;
        // rawIdx maps each normalized char (relative to `start`) to its raw
        // offset inside the segment's original text.
        map.push({ start, end: text.length, ref: seg.ref, rawStart: n.idx[0], rawIdx: n.idx });
    }
    // oversize: the page exceeded MAX_PAGE_CHARS, so the index is a partial
    // prefix; resolve() refuses to anchor against it (a quote unique in the
    // prefix may also occur in the dropped tail).
    return { text, map, oversize };
}

export function locate(index, start, end) {
    const map = index.map;
    if (map.length === 0) return null;
    let si = map.findIndex((e) => start < e.end);
    if (si < 0) si = map.length - 1;
    const sEntry = map[si];
    const sLocal = Math.max(start, sEntry.start) - sEntry.start;
    const lastChar = Math.max(end, start + 1) - 1;
    let ei = si;
    for (let i = si; i < map.length; i++) {
        if (lastChar >= map[i].start) ei = i; else break;
    }
    const eEntry = map[ei];
    const eLocal = Math.min(lastChar, eEntry.end - 1) - eEntry.start;
    return {
        startRef: sEntry.ref,
        startOffset: sEntry.rawIdx[Math.min(sLocal, sEntry.rawIdx.length - 1)],
        endRef: eEntry.ref,
        endOffset: eEntry.rawIdx[Math.max(eLocal, 0)] + 1
    };
}

// ------------------------------------------------------------------
// Matching
// ------------------------------------------------------------------

function findAll(text, needle, limit = 2) {
    const out = [];
    if (!needle) return out;
    let from = 0;
    for (;;) {
        const i = text.indexOf(needle, from);
        if (i < 0) break;
        out.push(i);
        if (out.length >= limit) break;
        from = i + 1;
    }
    return out;
}

/**
 * Semi-global edit distance of `q` against a substring of `t` (Sellers),
 * carrying alignment start positions. Returns the best {dist, start, end}
 * (end exclusive) within `t`.
 */
function bestApproxMatch(q, t) {
    const L = q.length;
    let prevD = new Array(L + 1);
    let prevS = new Array(L + 1);
    for (let i = 0; i <= L; i++) { prevD[i] = i; prevS[i] = 0; }
    let best = { dist: Infinity, start: 0, end: 0 };
    for (let j = 1; j <= t.length; j++) {
        const curD = new Array(L + 1);
        const curS = new Array(L + 1);
        curD[0] = 0; curS[0] = j;
        const tc = t.charCodeAt(j - 1);
        for (let i = 1; i <= L; i++) {
            const sub = prevD[i - 1] + (q.charCodeAt(i - 1) === tc ? 0 : 1);
            const del = prevD[i] + 1;    // text char not in quote
            const ins = curD[i - 1] + 1; // quote char missing from text
            let d = sub, s = prevS[i - 1];
            if (del < d) { d = del; s = prevS[i]; }
            if (ins < d) { d = ins; s = curS[i - 1]; }
            curD[i] = d; curS[i] = s;
        }
        if (curD[L] < best.dist) best = { dist: curD[L], start: curS[L], end: j };
        prevD = curD; prevS = curS;
    }
    return best;
}

function fuzzyMatch(text, quote) {
    const L = quote.length;
    if (L < 4 || L > FUZZY_MAX_QUOTE) return null;
    const pad = Math.ceil(L * 0.2) + 5;
    const chunk = Math.min(CHUNK_SIZE, L);
    // Cheap prefilter: only run the edit-distance DP around places where a
    // chunk of the quote occurs verbatim.
    const regions = [];
    for (let q = 0; q + chunk <= L && regions.length < MAX_FUZZY_REGIONS; q += chunk) {
        const piece = quote.slice(q, q + chunk);
        let from = 0;
        while (regions.length < MAX_FUZZY_REGIONS) {
            const hit = text.indexOf(piece, from);
            if (hit < 0) break;
            from = hit + 1;
            const rs = Math.max(0, hit - q - pad);
            if (regions.some((r) => Math.abs(r.rs - rs) < L / 2)) continue;
            regions.push({ rs, re: Math.min(text.length, hit - q + L + pad) });
        }
    }
    const results = [];
    for (const r of regions) {
        const m = bestApproxMatch(quote, text.slice(r.rs, r.re));
        if (!Number.isFinite(m.dist)) continue;
        results.push({ score: 1 - m.dist / L, start: r.rs + m.start, end: r.rs + m.end });
    }
    if (results.length === 0) return null;
    results.sort((a, b) => b.score - a.score);
    const best = results[0];
    if (best.score < ACCEPT_CONFIDENCE) return null;
    const tied = results.slice(1).some((o) =>
        o.score >= best.score - 1e-9 && Math.abs(o.start - best.start) >= L / 2);
    if (tied) return null;
    return best;
}

function selectorsOf(item) {
    const out = [];
    const a = item && item.anchor;
    const list = Array.isArray(a) ? a : (a ? [a] : []);
    for (const s of list) {
        // TextPositionSelector is ignored: its offsets come from a different text.
        if (s && s.type === 'TextQuoteSelector' && typeof s.exact === 'string' && s.exact) out.push(s);
    }
    if (item && typeof item.quote === 'string' && item.quote) out.push({ exact: item.quote });
    return out;
}

export function resolve(index, item) {
    if (index.oversize) return { range: null, confidence: 0, method: 'none' };
    const text = index.text;
    const selectors = selectorsOf(item);
    for (const sel of selectors) {
        const exact = normalizeForMatch(sel.exact);
        if (!exact) continue;
        if (sel.prefix || sel.suffix) {
            const pre = normalizeWithMap(sel.prefix || '', false).text;
            const suf = normalizeWithMap(sel.suffix || '', false).text;
            const hits = findAll(text, pre + exact + suf);
            if (hits.length === 1) {
                const start = hits[0] + pre.length;
                return { range: { start, end: start + exact.length }, confidence: 1, method: 'quote-context' };
            }
        }
        const hits = findAll(text, exact);
        if (hits.length === 1) {
            return { range: { start: hits[0], end: hits[0] + exact.length }, confidence: 0.9, method: 'exact-unique' };
        }
    }
    for (const sel of selectors) {
        const exact = normalizeForMatch(sel.exact);
        // Present-but-ambiguous quotes are never guessed at.
        if (!exact || findAll(text, exact).length > 0) continue;
        const f = fuzzyMatch(text, exact);
        if (f) return { range: { start: f.start, end: f.end }, confidence: f.score, method: 'fuzzy' };
    }
    return { range: null, confidence: 0, method: 'none' };
}

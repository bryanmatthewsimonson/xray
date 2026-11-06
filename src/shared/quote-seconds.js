// Quote -> media time (seconds) for the inline overlay. Background-only:
// kept out of anchor-resolve.js because diarized-transcript.js pulls in the
// event-builder chain (and through it the entity keystore), which must never
// reach the content bundle (THREAT_MODEL G10).

import { buildTextIndex, resolve, locate } from './anchor-resolve.js';
import { timeRangeOfSpan } from './diarized-transcript.js';

function rawSpanOf(source, quote) {
    if (typeof source !== 'string' || !source) return null;
    const idx = buildTextIndex([{ ref: 'src', text: source }]);
    const r = resolve(idx, { quote });
    if (!r.range) return null;
    const loc = locate(idx, r.range.start, r.range.end);
    return loc ? { start: loc.startOffset, end: loc.endOffset } : null;
}

export function quoteToSeconds(quote, article) {
    if (!quote || !article) return null;
    const hasTimeMap = Array.isArray(article.timeMap) && article.timeMap.length > 0;
    for (const src of [article.markdown, article.content]) {
        const span = rawSpanOf(src, quote);
        if (!span) continue;
        if (hasTimeMap) {
            const t = timeRangeOfSpan(article.timeMap, span.start, span.end);
            return t ? t.startSec : null;
        }
        const before = src.slice(0, span.start);
        const re = /&t=(\d+)s/g;
        let last = null;
        let m;
        while ((m = re.exec(before)) !== null) last = m[1];
        return last == null ? null : Number(last);
    }
    return null;
}

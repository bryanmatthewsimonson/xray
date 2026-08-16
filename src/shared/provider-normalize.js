// Provider normalizer — the JavaScript twin of the companion service's
// companion/transcriber/transcriber/providers/normalize.py.
//
// WHY A TWIN EXISTS AT ALL: the direct-cloud transcription path
// (src/shared/direct-transcribe.js) talks to a provider from the
// service worker with no companion service in the loop, so the
// Python normalizer is simply not present. Guard-rail 2 of
// docs/DIRECT_CLOUD_TRANSCRIBE_KICKOFF.md names the cost honestly:
// two implementations of one contract, in two languages, maintained
// forever — and calls the drift the single most likely long-term
// defect in the design.
//
// The drift would not be cosmetic. These segment boundaries decide
// the composed markdown body (diarized-transcript.js buildDiarizedBody)
// and therefore the published `x` content address, AND the
// t=<start>,<end> Media-Fragments values inside kind-30040 claim
// anchors. Two transcripts of the same audio — one companion-routed,
// one direct — must be byte-identical or the same quote carries two
// different published provenance ranges.
//
// So the contract is machine-checked, not asserted: BOTH suites read
// tests/fixtures/normalizer-parity.json, whose expected values were
// OBSERVED by running normalize.py (tests/tools/regen-normalizer-fixture.py),
// and the JS test pins the reference's sha256 so an edit to the Python
// side fails loudly here until it is re-observed.
//
// PURE — ZERO imports, no chrome, no network, no globals. That is
// load-bearing: the parity test imports this module with nothing
// stubbed.
//
// Every behavioral comment below cites the reference by line.

// A segment never grows past this once a sentence boundary or speaker
// change offers a break (normalize.py:23).
export const MAX_SEGMENT_S = 30.0;

// normalize.py:25. Twelve forms, including the quote- and
// paren-wrapped ones — testing only `.!?` merges dialogue.
export const SENTENCE_END = Object.freeze([
    '.', '!', '?', '."', '!"', '?"', ".'", "!'", "?'", '.)', '!)', '?)'
]);

// ------------------------------------------------------------------
// Rounding
// ------------------------------------------------------------------

/**
 * Python's `round()` for floats: round-half-to-even over the EXACT
 * binary value of the double.
 *
 * `Math.round(x * 10 ** digits) / 10 ** digits` is NOT this and the
 * difference is observable: round(1.0625, 3) is 1.062 in Python and
 * 1.063 naively; round(2.5) is 2 in Python and 3 naively. Six of the
 * fifteen checked-in rounding cases diverge.
 *
 * Latent on the AssemblyAI path (integer milliseconds ÷ 1000 can only
 * produce halves at the 4th decimal, below our 3-digit precision) and
 * LIVE for Deepgram's float seconds — but the twin is written once, so
 * it is settled here rather than at DC.3.
 *
 * Exact by construction: the double is decomposed to `m * 2^e` with
 * BigInt, so no intermediate float multiply can introduce the error
 * the function exists to avoid.
 */
export function roundHalfEven(value, digits = 0) {
    const x = Number(value);
    if (!Number.isFinite(x)) return x;
    if (Number.isInteger(x) && digits >= 0) return x;

    const negative = x < 0 || Object.is(x, -0);
    const magnitude = Math.abs(x);

    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, magnitude);
    const bits = (BigInt(view.getUint32(0)) << 32n) | BigInt(view.getUint32(4));
    const rawExponent = Number((bits >> 52n) & 0x7ffn);
    const rawMantissa = bits & 0xfffffffffffffn;

    // magnitude === mantissa * 2 ** exponent, exactly.
    const mantissa = rawExponent === 0 ? rawMantissa : (rawMantissa | (1n << 52n));
    const exponent = rawExponent === 0 ? -1074 : rawExponent - 1075;

    // Build the exact rational mantissa*2^exponent*10^digits = num/den.
    let num = mantissa;
    let den = 1n;
    if (exponent >= 0) num *= 1n << BigInt(exponent);
    else den *= 1n << BigInt(-exponent);
    if (digits >= 0) num *= 10n ** BigInt(digits);
    else den *= 10n ** BigInt(-digits);

    let quotient = num / den;
    const remainder = num % den;
    const twice = remainder * 2n;
    if (twice > den || (twice === den && (quotient & 1n) === 1n)) quotient += 1n;

    const scaled = Number(quotient);
    const rounded = digits >= 0
        ? scaled / 10 ** digits
        : scaled * 10 ** -digits;
    return negative ? -rounded : rounded;
}

// ------------------------------------------------------------------
// Speaker labels
// ------------------------------------------------------------------

/** SPEAKER_00-style label for a first-appearance index (normalize.py:28-30).
 *  Indexes past 99 WIDEN (SPEAKER_100); they do not truncate. */
export function speakerLabel(index) {
    return `SPEAKER_${String(index).padStart(2, '0')}`;
}

/**
 * Raw provider labels (A/B, 0/1, …) → SPEAKER_NN, first-appearance
 * order (normalize.py:33-48). None/empty entries are SKIPPED — an
 * unlabelled utterance stays unlabelled; never invent a speaker.
 *
 * STRICT EQUALITY IS LOAD-BEARING. The reference skips on
 * `raw is None or raw == ""`, and in Python `0 == ""` is False, so
 * Deepgram's integer speaker `0` IS labelled. A twin written with
 * `raw == ''` drops it (JS `0 == ''` is true) and the first speaker of
 * every Deepgram transcript silently becomes null.
 *
 * @returns {Map<string, string>} raw label (stringified) → SPEAKER_NN
 */
export function stableSpeakerLabels(rawLabels) {
    const mapping = new Map();
    for (const raw of rawLabels || []) {
        if (raw === null || raw === undefined || raw === '') continue;
        const key = String(raw);
        if (!mapping.has(key)) mapping.set(key, speakerLabel(mapping.size));
    }
    return mapping;
}

// ------------------------------------------------------------------
// Language
// ------------------------------------------------------------------

/**
 * Provider language codes → the primary subtag Whisper emits
 * (normalize.py:51-61). AssemblyAI returns forms like "en_us";
 * Intl.DisplayNames chokes on underscores, so reduce to "en".
 *
 * `code || ''` mirrors the reference's `str(code or "")` — NOT
 * `code ?? ''`. A falsy non-string (0, false) collapses to empty and
 * takes the fallback; `??` would yield the string "0".
 *
 * Also the first line of defence for a value that reaches a published
 * tag: `transcript_lang` interpolates the language unescaped, so a
 * provider returning "en:evil:role" must not survive as-is.
 */
export function normalizeLanguage(code, fallback = 'en') {
    const s = String(code || '').trim().toLowerCase();
    if (!s) return fallback;
    return s.replace(/_/g, '-').split('-')[0] || fallback;
}

function endsSentence(text) {
    return SENTENCE_END.some((suffix) => text.endsWith(suffix));
}

// ------------------------------------------------------------------
// Words → segments
// ------------------------------------------------------------------

const isMissing = (v) => v === null || v === undefined;

/**
 * Word timings → sentence-ish {start, end, text} segments
 * (normalize.py:68-118). `words` is [{text, start, end}] in SECONDS —
 * callers map provider shapes to this first.
 *
 * Four behaviors here are traps, each pinned by a fixture case:
 *
 * 1. A word whose stripped text is empty is skipped ENTIRELY; its
 *    timing never widens the running segment (:101-104).
 * 2. The max_s break is tested AFTER the word is appended (:113-116),
 *    so an emitted segment legitimately EXCEEDS max_s — 40 words at
 *    1/s yield 0.0–30.9 then 31.0–39.9. Breaking before the append
 *    produces different boundaries, and therefore different published
 *    claim anchors.
 * 3. flush() RETURNS WITHOUT RESETTING when there is no timing yet
 *    (:90-91), so an untimed LEADING sentence carries into the next
 *    timed segment — losing transcript text would be silent and
 *    canonical.
 * 4. The final flush hits that same early return, so a TRAILING
 *    untimed run is silently dropped. Asymmetric with (3) on purpose
 *    or otherwise, it is the reference's behavior, and the twin copies
 *    it rather than improving on it.
 */
export function splitWordsIntoSegments(words, maxS = MAX_SEGMENT_S) {
    const segments = [];
    let currentWords = [];
    let currentStart = null;
    let currentEnd = null;

    const flush = () => {
        const text = currentWords.filter(Boolean).join(' ').trim();
        if (!text) {
            currentWords = [];
            currentStart = null;
            currentEnd = null;
            return;
        }
        // No timing yet — keep accumulating into the next piece (3).
        if (currentStart === null) return;
        segments.push({
            start: roundHalfEven(Number(currentStart), 3),
            end: roundHalfEven(Number(currentEnd === null ? currentStart : currentEnd), 3),
            text
        });
        currentWords = [];
        currentStart = null;
        currentEnd = null;
    };

    for (const word of words || []) {
        const text = String((word && word.text) || '').trim();
        if (!text) continue;                                   // (1)
        const start = word.start;
        const end = word.end;
        if (currentStart === null && !isMissing(start)) currentStart = start;
        if (!isMissing(end)) currentEnd = end;
        else if (!isMissing(start)) currentEnd = Math.max(currentEnd || 0, start);
        currentWords.push(text);
        const duration = (currentStart !== null && currentEnd !== null)
            ? currentEnd - currentStart
            : 0.0;
        if (endsSentence(text) || duration >= maxS) flush();   // (2)
    }
    flush();                                                   // (4)
    return segments;
}

/**
 * Provider utterances → the result's segments array
 * (normalize.py:121-156).
 *
 * `utterances` is the COMMON shape both providers are mapped to first:
 * {speaker: raw|null, start, end (seconds), text, words: [{text, start,
 * end}] | []}.
 *
 * Three more traps:
 *
 * 1. The speaker map is computed ONCE over the WHOLE list before
 *    anything is emitted (:130) — first-appearance order is GLOBAL,
 *    not per-utterance and not sorted.
 * 2. When word timings yield pieces, the utterance's own start/end/text
 *    are ignored ENTIRELY (:135-147).
 * 3. The wordless fallback tests `u.start is None`, not truthiness
 *    (:138) — so `start === 0` is KEPT. A twin using `!u.start` drops
 *    the first utterance of every transcript.
 */
export function utterancesToSegments(utterances, maxS = MAX_SEGMENT_S) {
    const list = utterances || [];
    const labels = stableSpeakerLabels(list.map((u) => (u ? u.speaker : null)));   // (1)
    const segments = [];

    for (const utterance of list) {
        if (!utterance) continue;
        const raw = utterance.speaker;
        const labelled = !isMissing(raw) && raw !== '';
        const speaker = labelled ? (labels.get(String(raw)) || null) : null;

        let pieces = splitWordsIntoSegments(utterance.words || [], maxS);          // (2)
        if (pieces.length === 0) {
            const text = String(utterance.text || '').trim();
            const start = utterance.start;
            if (!text || isMissing(start)) continue;                               // (3)
            const end = isMissing(utterance.end) ? start : utterance.end;
            pieces = [{
                start: roundHalfEven(Number(start), 3),
                end: roundHalfEven(Number(end), 3),
                text
            }];
        }
        for (const piece of pieces) {
            // Key order start/end/speaker/text is the reference's final
            // projection (:150-156) — cosmetic in JSON, but it keeps a
            // direct result diffable against the companion's
            // jobs/<id>.json, and the parity test pins it.
            segments.push({
                start: piece.start,
                end: piece.end,
                speaker,
                text: piece.text
            });
        }
    }
    return segments;
}

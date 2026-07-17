// Archive-banner decision — pure, so it can be tested.
//
// The reader offers an archived body over the current capture when the
// two differ. Deciding "differ" on the BODIES was the bug: the two
// sides are not comparable and never were.
//
//   capture side  → article.content = Readability innerHTML, wrapped
//                   in <div id="readability-page-1">
//   relay side    → markdownToHtml(markdown), rebuilt from the event
//
// For any MULTI-paragraph article — i.e. every real one — these cannot
// match: markdownToHtml joins paragraphs with "\n\n" while Readability
// emits "</p><p>" with no separator, so neither the equality guard nor
// the containment guard below can fire. With the default 'always' mode
// probing unconditionally, the banner fired on every published article,
// every visit — ~100% false, which trained the user to ignore it.
//
// (A single-paragraph body has no "\n\n" to introduce, so it IS a clean
// substring of its wrapper and the containment guard did suppress. Short
// pieces behaved; real articles did not. tests/archive-banner.test.mjs
// pins both halves.)
//
// The canonical Phase-13.4 article hash is the sound test, and it was
// already present on both sides, simply never consulted: the published
// `x` tag (read back as `_articleHash`), the archive row's
// `articleHash`, and the reader's `state.articleHash` agree by
// construction.
//
// No chrome.*, no DOM — the caller supplies the bodies and the hashes.

/**
 * Should an archived body be surfaced over the current capture?
 *
 * The hash gate only ever SUPPRESSES: a match means the same canonical
 * content, so there is nothing to offer in any mode. A missing hash
 * (older cache rows, a pre-13.4 event) or a genuine difference falls
 * through to the body heuristics, unchanged from before.
 *
 * Sensitivity modes (Options → Advanced → Archive banner):
 *   'richer' — the archive must be ≥1.3× longer AND >1000 chars.
 *   'always' — any non-trivial difference; skips byte-identical bodies
 *              and skips when the archive is strictly contained in the
 *              current body (the current is a superset, so the archive
 *              can only lose information).
 *
 * @param {string} currentBody   the capture on screen
 * @param {string} archiveBody   the candidate archived body
 * @param {string} mode          'always' | 'richer'
 * @param {string|null} [currentHash]  canonical hash of currentBody
 * @param {string|null} [archiveHash]  canonical hash of archiveBody
 * @returns {boolean}
 */
export function shouldOfferArchive(currentBody, archiveBody, mode, currentHash, archiveHash) {
    if (!archiveBody) return false;
    if (currentHash && archiveHash && currentHash === archiveHash) return false;
    if (mode === 'richer') {
        return archiveBody.length > currentBody.length * 1.3 && archiveBody.length > 1000;
    }
    if (archiveBody === currentBody) return false;
    if (currentBody && currentBody.includes(archiveBody)) return false;
    return true;
}

/**
 * Human-readable reason the banner is showing. Length-based on purpose:
 * it describes the SIZE difference the user can act on, and says only
 * that the bodies differ when neither is meaningfully longer.
 *
 * @param {string} currentBody
 * @param {string} archiveBody
 * @returns {string}
 */
export function describeMetric(currentBody, archiveBody) {
    const cur = currentBody.length;
    const arc = archiveBody.length;
    if (cur > 0 && arc >= cur * 1.3) {
        return `Archive is ${(arc / Math.max(cur, 1)).toFixed(1)}× longer`;
    }
    if (arc > cur) return `Archive is ${arc - cur} chars longer`;
    if (arc < cur) return `Archive is ${cur - arc} chars shorter`;
    return 'Archive differs from current capture';
}

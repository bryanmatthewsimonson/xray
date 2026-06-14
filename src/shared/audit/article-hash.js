// X-Ray — canonical article hash (Phase 13, slice 13.1).
//
// One normalization, one hash: SHA-256 (lowercase hex) over the UTF-8
// bytes of the normalized article body markdown. The normalization is
// the vendored scorer's `normalizeMarkdown` adopted VERBATIM
// (docs/auditor-prototype/scorer/scorer.js) — the extension and the
// CLI must never drift, and tests/article-hash.test.mjs pins this
// implementation against vectors generated from the vendored source.
//
// The hash input is the article body markdown WITHOUT the X-Ray
// metadata header (the leading `---…---` block carries an Archived
// date, which would make the hash capture-time-dependent — the one
// thing a content address must never be). Callers strip the header
// (`reconstructArticleFromEvent`'s regex) before hashing; this module
// hashes exactly what it is given.
//
// Spec: docs/EPISTEMIC_AUDIT_DESIGN.md §"Canonical article hash".

import { Crypto } from '../crypto.js';

/**
 * Normalize markdown for stable hashing across captures. The vendored
 * scorer's `normalizeMarkdown`, verbatim:
 *   1. CRLF → LF.
 *   2. Strip trailing spaces/tabs from every line.
 *   3. Collapse runs of 3+ newlines to exactly 2.
 *   4. Strip all trailing whitespace at end of input.
 *
 * @param {string} md - article body markdown (metadata header excluded)
 * @returns {string} normalized markdown
 */
export function normalizeForHash(md) {
    return String(md ?? '')
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.replace(/[ \t]+$/, ''))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\s+$/g, '');
}

/**
 * Canonical article hash: SHA-256 hex over the UTF-8 bytes of the
 * normalized markdown. This is the value carried in the `x` tag on
 * every audit event (and on 30023s from slice 13.4 onward), and the
 * cache key for audit runs.
 *
 * @param {string} md - article body markdown (metadata header excluded)
 * @returns {Promise<string>} 64-char lowercase hex
 */
export async function articleHash(md) {
    return Crypto.sha256(normalizeForHash(md));
}

/**
 * Strip the X-Ray metadata header from published 30023 content,
 * yielding the hash input for an already-published article. Exactly
 * `reconstructArticleFromEvent`'s strip (event-builder.js) so the two
 * paths cannot disagree about where the body starts.
 *
 * @param {string} content - full 30023 content (header + body)
 * @returns {string} body markdown
 */
export function stripMetadataHeader(content) {
    const text = String(content ?? '');
    const headerMatch = text.match(/^---\n[\s\S]*?\n---\n\n?/);
    return headerMatch ? text.substring(headerMatch[0].length) : text;
}

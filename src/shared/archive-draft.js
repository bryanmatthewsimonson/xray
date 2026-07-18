// Is an archived draft the body that was actually published?
//
// THE BUG THIS ANSWERS. Publishing an article turns its Readability HTML
// into markdown (turndown). "Load archive" renders that markdown back to
// HTML. Republishing turndowns the rendering AGAIN — and turndown is not
// idempotent: it escapes characters that are already escaped, so the
// backslashes grow n -> 2n+1 every cycle (measured: 1 -> 3 -> 7 -> 15).
// Each cycle mints a NEW `x` tag for an article nobody edited, forking
// the anchor every audit, claim, and prediction keys to — and because
// the `d` tag is URL-derived, the drifted event REPLACES the original at
// the same NIP-33 coordinate. The bug was overwriting the very body the
// audits pointed at.
//
// assembleArticleBody says the rule out loud: "Conversion runs ONCE per
// body, ever." The Load-archive path is where that invariant broke.
//
// WHY A PROOF AND NOT A FLAG. The archive already arrives with the
// publisher's own answer for what its text is: `_articleHash` (the `x`
// tag) and `_publishedDraft` (its preimage). So we never have to GUESS
// whether a draft is canonical — we can check, offline, for free. That
// matters, because every cheaper discriminator is wrong:
//
//   - "it has a markdown field"  -> a platform capture (YouTube etc.)
//     has one too, but the handler's markdown is NOT the published
//     preimage: publish turndowns the derived HTML, so the row's own
//     hash covers different bytes. Trusting the field re-mints the x tag
//     and orphans that article's audits.
//   - "contentType is pdf/transcript" -> reconstruct CUTS `## Description`
//     and `## Transcript` sections out of the body. A PDF whose extracted
//     text legitimately contains a `## Description` heading (pdf-layout
//     promotes short large lines to h2) loses that section, and
//     assembleArticleBody only re-appends sections for `video`. Declaring
//     the remainder canonical republishes a TRUNCATED body.
//   - "it came from a relay" -> provenance is not integrity.
//
// The proof catches all three, because it reproduces the exact body
// publish would build and compares it to the hash the publisher signed.
// A lossy reconstruction fails its own proof and falls back to today's
// behavior — the check is self-validating, so being wrong is safe.
//
// A false verdict is never silently harmful: false -> today's behavior
// (a fresh turndown), true -> ship the bytes that already hash to the
// anchor. There is no third outcome.
//
// Pure: no chrome.*, no DOM.

import { EventBuilder } from './event-builder.js';
import { articleHash } from './audit/article-hash.js';

/**
 * The archived draft's canonical-body candidate, if it has one.
 *
 * `_publishedDraft` is a relay reconstruction's carried preimage.
 * `markdown` covers a cache row written by our own publish path, which
 * stores the published draft under that key. Neither is TRUSTED here —
 * `archivedDraftIsCanonical` proves whichever it finds.
 *
 * Deliberately NOT `textContent`: the two load paths disagree about what
 * that key means. A relay reconstruction puts markdown in it; a fresh
 * capture puts TAG-STRIPPED PLAIN TEXT in it. Reading it here would feed
 * de-tagged prose to publish as if it were the body.
 *
 * @param {object} archived
 * @returns {string|null}
 */
export function archivedDraftSource(archived) {
    if (!archived) return null;
    const body = archived._publishedDraft || archived.markdown;
    return (typeof body === 'string' && body) ? body : null;
}

/**
 * Does this archived draft PROVE it is the published body?
 *
 * Rebuilds the body publish would ship from the draft, and checks it
 * hashes to the `x` tag the archive carries. True means republishing it
 * verbatim reproduces the existing content address exactly — no new
 * anchor, no drift.
 *
 * Unconditional by design: there is no shape, contentType, or provenance
 * short-circuit, because every one of them has a counter-example (see the
 * module comment). The hash is the only authority.
 *
 * @param {object} archived  an article carrying `_articleHash`
 * @returns {Promise<boolean>}
 */
export async function archivedDraftIsCanonical(archived) {
    const draft = archivedDraftSource(archived);
    if (!draft || !archived._articleHash) return false;
    try {
        // The body publish builds: content = the draft, marked as
        // already-markdown so assembleArticleBody does not turndown it,
        // and everything else (contentType, description, transcript) left
        // alone so its video section re-append runs exactly as it would
        // at publish. If that re-append is lossy for this article, the
        // hashes disagree and we say false.
        const body = EventBuilder.assembleArticleBody({
            ...archived,
            content: draft,
            _contentIsMarkdown: true
        });
        return (await articleHash(body)) === archived._articleHash;
    } catch (_) {
        return false;   // an unprovable draft is an untrusted draft
    }
}

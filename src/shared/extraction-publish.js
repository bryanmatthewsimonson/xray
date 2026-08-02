// Extraction-analysis publishing — MA.6
// (docs/MAP_ARTIFACT_KICKOFF.md §MA.6, docs/NIP_DRAFT.md §ExtractionAnalysis).
//
// Publishes the REVIEWED extraction analysis of one article as the NEW
// wire kind 30070 — one replaceable event per (author, articleHash).
//
// THE DISCLOSURE POSTURE (maintainer decision, 2026-07-29, revising an
// earlier accepted-only rule): publish the WHOLE extraction unit — every
// atom, whatever its review state, WITH the model's own prose — because
// the full queue is the better disclosure. You cannot audit a filter you
// cannot see: publishing only what survived review would overstate the
// model's precision by hiding everything a human threw away, and would
// destroy the denominator a stranger needs to calibrate the pass.
//
// THAT MAKES THE MARKING THE ONLY SAFEGUARD, so it is built to be hard
// to lose rather than merely present:
//
//   1. Every row carries a REQUIRED `status` (unreviewed | accepted |
//      dismissed). A row without one is malformed; the parser reads an
//      unrecognized value as `unreviewed` — unknown must never read as
//      endorsed (fail-safe, not fail-open).
//   2. Model prose lives ONLY in `model_`-prefixed keys —
//      `model_note` (the load-bearing rationale) and
//      `model_proposed_text` (the suggest pass's paraphrase). It is
//      never `quote`, never `content`, never the human's `why`. A
//      schema-following consumer cannot mistake it for the article's
//      words or for a claim.
//   3. Human endorsement is expressible ONLY as a coordinate to a
//      separately signed kind-30040 claim. This event never *contains*
//      an endorsement, only a pointer to one, so endorsement cannot be
//      forged by editing this payload.
//   4. The event carries no `p` tag, no `L`/`l` label, no `I`/`K` root
//      scope, and no numeric slot — so it cannot enter an entity's
//      dossier query beside real claims, cannot be aggregated by a
//      NIP-32 label consumer, and cannot surface in NIP-22 comment
//      threads as the publisher's commentary.
//
// An atom is NOT a machine assertion about the world: guard rail 3
// guarantees the stored quote is `ground().exact` — the ARTICLE'S OWN
// span, never the model's copy. So what publishes is ATTENTION ("these
// sentences of this exact text are the load-bearing ones, here is what
// the model said about them, and here is whether a human has ruled")
// plus, clearly quarantined, what the machine proposed.
//
// STILL NEVER PUBLISHED: `positions` (unanchored model prose
// characterizing a third party's article — no verbatim anchor, and the
// one field that could defame by characterization), `caseName` /
// `scopeQuestion` (the researcher's private casework framing), and
// `merged_keys` (another machine's cache fingerprints).
//
// SCOPE GUARD: `why` here is ARTICLE-INTRINSIC ("why this claim carries
// THIS article's argument"). Case-scoped `load_bearing` with a `why`
// already publishes on the kind-30068 CaseBrief; corpus-v7 made
// extraction article-intrinsic, and anything case-relative belongs to
// the brief, not here.
//
// Pure composition — no chrome, no network, no signing. The caller owns
// the flag gate, signing, and publish.

import { buildClaimCoord } from './claim-ref.js';
import { isTextPinnedKey } from './map-artifacts.js';

export const EXTRACTION_ANALYSIS_KIND = 30070;
export const EXTRACTION_ANALYSIS_MARKER = 'xray-extraction-analysis';

function nowSeconds() { return Math.floor(Date.now() / 1000); }

/** One replaceable analysis per article, per author — the `d` tag. */
export function extractionDTag(articleHash) {
    return 'xray-extraction:' + String(articleHash || '');
}

/** The three published review states. `unreviewed` is the local
 * record's 'open' — renamed on the wire so a consumer never reads it as
 * "open question" or "open to interpretation". */
export const REVIEW_STATES = Object.freeze(['unreviewed', 'accepted', 'dismissed']);

/** Local triage status → wire status. Anything unrecognized (including
 * absent, which is what pre-MA.6 rows carry) is `unreviewed`: unknown
 * must never publish as endorsed. */
export function wireStatus(localStatus) {
    if (localStatus === 'accepted') return 'accepted';
    if (localStatus === 'dismissed') return 'dismissed';
    return 'unreviewed';
}

/**
 * The publishable projection of a stored record: the WHOLE unit, every
 * atom, with the model's prose quarantined into `model_`-prefixed keys
 * and a REQUIRED review state on every row. Pure and defensive — it is
 * the one place that decides what leaves the machine, so every other
 * surface can be careless.
 *
 * Endorsement is a POINTER, never a field: an accepted atom carries
 * `claim` only when the caller resolved that claim to a published
 * coordinate. An atom accepted locally whose claim is unpublished
 * carries `claim: null` and `endorsement: 'local-only'` — honest (a
 * human did rule) and honestly unusable as authority (nothing to fetch).
 *
 * @param {object} record  an `article-extractions` record
 * @param {object} coordByClaimId  claim id → `30040:<pubkey>:<d>` for
 *   claims the caller confirmed are PUBLISHED.
 * @returns {{assertions, sources, open_questions, coverage, withheld}}
 */
export function publishableAnalysis(record, coordByClaimId = {}) {
    const rec = record || {};
    const assertions = [];
    const counts = { unreviewed: 0, accepted: 0, dismissed: 0 };
    let localOnlyEndorsements = 0;

    // Document order by span start — deterministic, and NOT a ranking.
    // "Most important first" would be an unpublished weighting and a
    // fused judgment by the back door.
    const ordered = (rec.assertions || []).slice()
        .sort((x, y) => (x.start || 0) - (y.start || 0));

    for (const a of ordered) {
        if (!a || !a.quote) continue;   // nothing verifiable ⇒ not an atom
        const status = wireStatus(a.status);
        counts[status] += 1;
        const fs = a.first_seen || {};
        const row = {
            // The ARTICLE'S OWN span (ground().exact), never the model's
            // copy — verifiable character-for-character against the text
            // the `x` tag pins.
            quote: String(a.quote),
            status
        };
        if (status === 'accepted') {
            const coord = a.accepted_claim_id ? coordByClaimId[a.accepted_claim_id] : null;
            row.claim = coord || null;
            if (!coord) { row.endorsement = 'local-only'; localOnlyEndorsements += 1; }
        }
        // The human's accepted rationale — only ever present when a
        // human accepted one, and never on a non-accepted row.
        if (status === 'accepted' && a.accepted_why) {
            row.why = String(a.accepted_why);
            row.why_by = a.accepted_why_provenance === 'user' ? 'user' : 'llm';
        }
        // MODEL PROSE — quarantined by name. Never `quote`, never
        // `content`, never the human's `why`.
        if (a.why) row.model_note = String(a.why);
        if (a.text) row.model_proposed_text = String(a.text);
        row.generator = {
            model: fs.model || null,
            prompt_version: fs.promptVersion || null,
            producer: fs.producer === 'suggest' ? 'suggest' : 'map'
        };
        assertions.push(row);
    }

    const sources = (Array.isArray(rec.sources) ? rec.sources : []).map((s) => {
        if (!s || !(s.target_hint || s.quote)) return null;
        return {
            target_hint: String(s.target_hint || ''),
            status: wireStatus(s.status),
            // The model's LOCATING quote is never re-grounded locally
            // (the merge stores it as the model gave it), so it must not
            // ride as a verbatim span. The hint is what a reader needs
            // to chase the source; `withheld` says the quote was held.
            ...(s.accepted_note ? { note: String(s.accepted_note) } : {})
        };
    }).filter((s) => s && s.target_hint);

    const open_questions = (Array.isArray(rec.open_questions) ? rec.open_questions : [])
        .map((q) => (q && q.text) ? { text: String(q.text), status: wireStatus(q.status) } : null)
        .filter(Boolean);

    return {
        assertions,
        sources,
        open_questions,
        // Coverage: the denominator, on the event's face. (P12
        // transparency + the known-unknowns duty; NOT P6, which is the
        // knowability ceiling on scores — a miscitation the panel caught.)
        coverage: {
            unreviewed: counts.unreviewed,
            accepted: counts.accepted,
            dismissed: counts.dismissed,
            ungroundable_dropped: rec.dropped_ungrounded || 0,
            ...(localOnlyEndorsements ? { accepted_local_only: localOnlyEndorsements } : {})
        },
        // The known-unknowns log (P12): every local field that exists
        // and deliberately did NOT publish, machine-readably, so a
        // consumer sees the shape of what is withheld instead of having
        // to infer it from our docs.
        withheld: withheldReasons(rec)
    };
}

// Why each local field stays local. Stable machine-readable reasons;
// the wording is the contract, so consumers can switch on `field`.
// Shorter than it was under the accepted-only posture — the whole unit
// publishes now, so this lists only what is STILL held back.
function withheldReasons(rec) {
    const out = [];
    if ((rec.positions || []).length) {
        out.push({ field: 'positions',
            reason: 'unanchored model prose characterizing the article; no verbatim anchor' });
    }
    if ((rec.positions || []).some((p) => p && (p.caseName || p.scopeQuestion))) {
        out.push({ field: 'case_frame',
            reason: "the researcher's private casework framing" });
    }
    if ((rec.merged_keys || []).length) {
        out.push({ field: 'merged_keys', reason: 'local cache fingerprints' });
    }
    if ((rec.sources || []).some((s) => s && s.quote)) {
        out.push({ field: 'sources.quote',
            reason: "the model's copy of a span, never re-grounded locally — target_hint only" });
    }
    if (rec.dropped_ungrounded) {
        out.push({ field: 'assertions.ungroundable', count: rec.dropped_ungrounded,
            reason: 'proposed quotes that could not be located in the text; never stored, so no text exists to publish' });
    }
    return out;
}

/** True when there is anything human-endorsed to publish at all. */
export function hasPublishableAnalysis(record, coordByClaimId = {}) {
    const p = publishableAnalysis(record, coordByClaimId);
    return p.assertions.length > 0 || p.sources.length > 0 || p.open_questions.length > 0;
}

/**
 * Build the unsigned kind-30070 event.
 *
 * @param {object} opts
 * @param {object} opts.record            the `article-extractions` record
 * @param {object} opts.coordByClaimId    claim id → published coordinate
 * @param {string} [opts.articleTitle]
 * @param {string} [opts.articleUrl]
 * @param {string} [opts.articleCoord]    the article's own `30023:<pk>:<d>`, when known
 * @param {number} [opts.createdAt]
 * @throws when nothing is publishable — refusing beats emitting an
 *   empty analysis that implies an article was examined and yielded
 *   nothing endorsed.
 */
export function buildExtractionAnalysisEvent({
    record, coordByClaimId = {}, articleTitle = '', articleUrl = '',
    articleCoord = null, createdAt = nowSeconds()
} = {}) {
    if (!record || !record.articleHash) {
        throw new Error('buildExtractionAnalysisEvent: record.articleHash is required');
    }
    // PUBLISH-BOUNDARY REFUSAL. `buildMemberUnits` keys a record
    // `url:<sha16(url)>` when the archive row has no computed content
    // hash. That key names a URL, not a text — so an `x` tag minted
    // from it would be a FABRICATED content hash, and every consumer
    // (including X-Ray's own `#x` join) would treat it as pinning a
    // text it does not pin. The local record is fine; publishing it is
    // not. Same discipline `mergeExtractionRecords` applies to the
    // backup merge, enforced here at the one place bytes leave.
    if (!isTextPinnedKey(record.articleHash)) {
        throw new Error('buildExtractionAnalysisEvent: refusing to publish a record whose key '
            + 'does not pin a text (url: fallback key — its `x` would be fabricated)');
    }
    const payload = publishableAnalysis(record, coordByClaimId);
    if (payload.assertions.length === 0 && payload.sources.length === 0
        && payload.open_questions.length === 0) {
        throw new Error('buildExtractionAnalysisEvent: the record holds nothing publishable');
    }

    const hash = record.articleHash;
    const url = articleUrl || record.url || '';
    const c = payload.coverage;
    const tags = [
        ['d', extractionDTag(hash)],
        ['title', `Extraction analysis — ${articleTitle || record.title || url || hash.slice(0, 12)}`],
        ['t', EXTRACTION_ANALYSIS_MARKER],
        ['client', 'xray'],
        // Pins the analysis to the EXACT text it analyzed. The `#x` join
        // is how a consumer (and X-Ray's own read-back) matches this to
        // the article and to sibling artifacts.
        ['x', hash],
        // The denominator on the event's FACE, so a content-blind
        // aggregator still sees that most of this is unreviewed. Single-
        // purpose tags a naive consumer can skim without parsing content
        // (multi-letter tags are NOT relay-indexed — these buy human
        // skim-ability, nothing more; do not build a query on them).
        ['unreviewed', String(c.unreviewed)],
        ['endorsed', String(c.accepted)],
        ['dismissed', String(c.dismissed)],
        ['ungrounded-dropped', String(c.ungroundable_dropped)],
        ['published_at', String(createdAt)]
    ];
    // URL anchoring per docs/NIP_DRAFT.md §Anchoring (r for relay-side
    // filtering, i/k for NIP-73/22 conformance).
    if (url) {
        tags.push(['r', url], ['i', url], ['k', 'web']);
    }
    // Cross-link to the article itself when its coordinate is known.
    if (articleCoord) tags.push(['a', articleCoord, '', 'article']);
    // ENDORSED atoms only get an `a` coordinate — the tag block is the
    // endorsement index, so a consumer can fetch "what this publisher
    // actually stands behind" from tags alone without parsing content
    // and without ever touching an unreviewed row.
    for (const a of payload.assertions) {
        if (a.status === 'accepted' && a.claim) tags.push(['a', a.claim, '', 'endorsed']);
    }

    return {
        kind: EXTRACTION_ANALYSIS_KIND,
        created_at: createdAt,
        tags,
        content: JSON.stringify({
            article_hash: hash,
            article_url: url || null,
            ...payload
        })
    };
}

/**
 * Inverse — read a 30070 back to an analysis-shaped object. Tolerant of
 * foreign events: unknown fields are ignored, and a malformed content
 * body yields null rather than a half-parsed object.
 *
 * NOTE for consumers folding a FOREIGN analysis into a local record:
 * this event carries verbatim QUOTES but no offsets, deliberately.
 * Re-locate each quote in YOUR copy of the article (the `x` tag says
 * which text) rather than trusting any position from another machine —
 * the same verify-don't-resolve rule docs/NIP_DRAFT.md states for
 * TextPositionSelector, and the reason the local record's own
 * cross-machine span arithmetic is bounded (see mergeExtractionRecords).
 *
 * And do NOT adopt a foreign row's status as your own triage: another
 * publisher's ruling is THEIR attributed judgment, not your review.
 * Imported atoms land unreviewed locally with the foreign ruling kept
 * beside them — adopting it would resolve disagreement by import (P8)
 * and cross the consent firewall between people.
 */
export function parseExtractionAnalysisEvent(event) {
    if (!event || event.kind !== EXTRACTION_ANALYSIS_KIND) return null;
    let payload = {};
    try { payload = JSON.parse(event.content || '{}'); } catch (_) { return null; }
    if (!payload || typeof payload !== 'object') return null;

    const tags = event.tags || [];
    const first = (k) => ((tags.find((t) => t[0] === k) || [])[1]) || null;
    const dTag = first('d') || '';
    const prefix = 'xray-extraction:';
    const fromD = dTag.startsWith(prefix) ? dTag.slice(prefix.length) : null;
    const num = (v) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : 0);

    const assertions = (Array.isArray(payload.assertions) ? payload.assertions : [])
        .filter((a) => a && typeof a.quote === 'string' && a.quote)
        .map((a) => {
            // FAIL-SAFE: an unrecognized (or absent) status reads as
            // unreviewed. Unknown must never read as endorsed.
            const status = REVIEW_STATES.includes(a.status) ? a.status : 'unreviewed';
            // And a human-attributable field on a non-accepted row is
            // ignored, not honoured — a malformed or hostile event
            // cannot smuggle endorsement onto an unreviewed atom.
            const endorsed = status === 'accepted';
            return {
                quote: a.quote,
                status,
                claim: (endorsed && typeof a.claim === 'string') ? a.claim : null,
                endorsement: (endorsed && a.endorsement === 'local-only') ? 'local-only' : null,
                why: (endorsed && typeof a.why === 'string') ? a.why : null,
                whyBy: endorsed && (a.why_by === 'user' ? 'user' : (a.why_by === 'llm' ? 'llm' : null)),
                // Model prose stays namespaced on the way back out too,
                // so a renderer cannot accidentally treat it as the
                // human's words.
                modelNote: typeof a.model_note === 'string' ? a.model_note : null,
                modelProposedText: typeof a.model_proposed_text === 'string' ? a.model_proposed_text : null,
                generator: (a.generator && typeof a.generator === 'object') ? {
                    model: a.generator.model || null,
                    promptVersion: a.generator.prompt_version || null,
                    producer: a.generator.producer === 'suggest' ? 'suggest' : 'map'
                } : null
            };
        });

    return {
        articleHash: payload.article_hash || fromD,
        articleUrl: payload.article_url || first('r'),
        title: first('title'),
        assertions,
        sources: (Array.isArray(payload.sources) ? payload.sources : [])
            .filter((s) => s && typeof s.target_hint === 'string')
            .map((s) => ({
                targetHint: s.target_hint,
                status: REVIEW_STATES.includes(s.status) ? s.status : 'unreviewed',
                note: typeof s.note === 'string' ? s.note : null
            })),
        openQuestions: (Array.isArray(payload.open_questions) ? payload.open_questions : [])
            .filter((q) => q && typeof q.text === 'string')
            .map((q) => ({
                text: q.text,
                status: REVIEW_STATES.includes(q.status) ? q.status : 'unreviewed'
            })),
        withheld: (Array.isArray(payload.withheld) ? payload.withheld : [])
            .filter((w) => w && typeof w.field === 'string')
            .map((w) => ({ field: w.field, count: Number.isFinite(w.count) ? w.count : null,
                           reason: typeof w.reason === 'string' ? w.reason : null })),
        coverage: {
            unreviewed: num(first('unreviewed')),
            accepted: num(first('endorsed')),
            dismissed: num(first('dismissed')),
            ungroundableDropped: num(first('ungrounded-dropped'))
        },
        // The ENDORSED claim coordinates, from the tags — "what this
        // publisher stands behind", readable without parsing content and
        // without touching an unreviewed row.
        endorsedClaims: tags.filter((t) => t[0] === 'a' && t[3] === 'endorsed').map((t) => t[1]),
        articleCoord: (tags.find((t) => t[0] === 'a' && t[3] === 'article') || [])[1] || null
    };
}

/**
 * Resolve claim id → published coordinate for the claims an accepted
 * atom points at. A claim is referenceable ONLY once published (it
 * needs a signer pubkey to have a coordinate at all), so an accepted
 * atom whose claim is local-only publishes with `claim: null` and
 * `endorsement: 'local-only'` — honest that a human ruled, honestly
 * unusable as authority since there is nothing to fetch.
 *
 * Pure over the claim records the caller already loaded.
 *
 * @param {Array<object>} claims  claim records (id, publishedPubkey)
 */
export function claimCoordIndex(claims) {
    const out = {};
    for (const c of Array.isArray(claims) ? claims : []) {
        if (!c || !c.id || !c.publishedPubkey) continue;
        try { out[c.id] = buildClaimCoord(c.publishedPubkey, c.id); }
        catch (_) { /* malformed pubkey — not referenceable */ }
    }
    return out;
}

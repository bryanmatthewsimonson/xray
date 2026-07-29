// Extraction-analysis publishing — MA.6
// (docs/MAP_ARTIFACT_KICKOFF.md §MA.6, docs/NIP_DRAFT.md §ExtractionAnalysis).
//
// Publishes the REVIEWED extraction analysis of one article as the NEW
// wire kind 30070 — one replaceable event per (author, articleHash).
//
// THE BINDING RULE (maintainer, 2026-07-29): nothing publishes that the
// user has not reviewed and accepted. So this builder is not a dump of
// the durable `article-extractions` record; it is a projection of the
// human-endorsed part of it. Open atoms, dismissed atoms, un-accepted
// rationales, un-accepted sources/questions, `merged_keys`, and every
// case frame stay LOCAL. If nothing was accepted, there is nothing to
// publish and the builder refuses.
//
// WHY A KIND AT ALL, when accepted atoms already publish as kind-30040
// claims? Because the analysis is not the atoms. A claim carries text +
// quote + anchor + `about`; it has no slot for *why this assertion
// carries the article's argument*, which outside sources the article
// leans on, or what it leaves open. That reasoning structure is what
// makes a corpus interrogable rather than a pile of quotes.
//
// THE MOVE THAT REMOVES THE REDUNDANCY: this event REFERENCES claims by
// `a`-coordinate and never restates their quotes. Exactly one copy of a
// quote exists on the wire — inside the claim — so an edited claim can
// never leave two signed events disagreeing about the same span. 30070
// is an analysis layer OVER published claims, not a second copy of them.
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

/**
 * The publishable projection of a stored record: ONLY human-accepted
 * material. Pure and defensive — it is the one place that decides what
 * may leave the machine, so every other surface can be careless.
 *
 * An assertion is publishable when it is `status: 'accepted'` AND
 * carries the `accepted_claim_id` of a claim that the caller resolved
 * to a published coordinate. A rationale rides ONLY when the human
 * accepted one (`accepted_why`); accepting an atom without a rationale
 * is normal and publishes a bare claim reference — the honest
 * representation of "I endorsed the claim, not a rationale for it".
 *
 * Sources and open questions ride only when individually accepted
 * (`status: 'accepted'`), never automatically.
 *
 * @param {object} record  an `article-extractions` record
 * @param {object} coordByClaimId  claim id → `30040:<pubkey>:<d>` for
 *   claims the caller confirmed are PUBLISHED. An accepted atom whose
 *   claim is unpublished is omitted (nothing to reference) and counted.
 * @returns {{assertions, sources, open_questions, coverage}}
 */
export function publishableAnalysis(record, coordByClaimId = {}) {
    const rec = record || {};
    const assertions = [];
    let acceptedTotal = 0;
    let unpublishedClaims = 0;
    for (const a of rec.assertions || []) {
        if (!a || a.status !== 'accepted' || !a.accepted_claim_id) continue;
        acceptedTotal += 1;
        const coord = coordByClaimId[a.accepted_claim_id];
        if (!coord) { unpublishedClaims += 1; continue; }
        const fs = a.first_seen || {};
        const row = { claim: coord };
        // The rationale ONLY if a human accepted one.
        if (a.accepted_why) {
            row.why = String(a.accepted_why);
            // Whose words the rationale is, after any edit in review.
            row.why_by = a.accepted_why_provenance === 'user' ? 'user' : 'llm';
        }
        // Generator provenance (P12). Deliberately no case frame.
        row.generator = {
            model: fs.model || null,
            prompt_version: fs.promptVersion || null,
            producer: fs.producer === 'suggest' ? 'suggest' : 'map'
        };
        assertions.push(row);
    }

    const acceptedRows = (list) => (Array.isArray(list) ? list : [])
        .filter((x) => x && x.status === 'accepted');

    const sources = acceptedRows(rec.sources).map((s) => ({
        target_hint: String(s.target_hint || ''),
        // The model's locating quote is NOT republished: it is a span of
        // the article, and the article is already published. The hint is
        // what a reader needs to chase the source.
        ...(s.accepted_note ? { note: String(s.accepted_note) } : {})
    })).filter((s) => s.target_hint);

    const open_questions = acceptedRows(rec.open_questions)
        .map((q) => String((q && q.text) || '')).filter(Boolean);

    const notAccepted = Math.max(0, ((rec.assertions || []).length) - acceptedTotal);

    return {
        assertions,
        sources,
        open_questions,
        // Coverage: the SHAPE of what was examined may publish; the
        // examined text may not. `not_accepted` lets a reader tell "this
        // article was analyzed and yielded 3 endorsed claims" from "no
        // one has looked at it" — absence of claims means opposite
        // things in those two cases. (P12 transparency + the
        // known-unknowns duty; NOT P6, which is the knowability
        // ceiling on scores — a miscitation the design panel caught.)
        coverage: {
            accepted: acceptedTotal,
            not_accepted: notAccepted,
            ungroundable_dropped: rec.dropped_ungrounded || 0,
            ...(unpublishedClaims ? { accepted_but_unpublished: unpublishedClaims } : {})
        },
        // The known-unknowns log (P12): every local field that exists
        // and deliberately did NOT publish, machine-readably, so a
        // consumer can see the shape of what is being withheld rather
        // than having to infer it from our docs. Only reasons for
        // material actually present locally are listed — an empty
        // record withholds nothing.
        withheld: withheldReasons(rec, notAccepted)
    };
}

// Why each local field stays local. Stable machine-readable reasons;
// the wording is the contract, so consumers can switch on `field`.
function withheldReasons(rec, notAccepted) {
    const out = [];
    if (notAccepted > 0) {
        out.push({ field: 'assertions.unaccepted', count: notAccepted,
            reason: 'not reviewed and accepted by a human' });
    }
    if ((rec.assertions || []).some((a) => a && a.text)) {
        out.push({ field: 'assertions.text',
            reason: 'model-authored claim paraphrase — never published in any triage state' });
    }
    if ((rec.assertions || []).some((a) => a && a.why && !a.accepted_why)) {
        out.push({ field: 'assertions.why',
            reason: 'model-drafted rationale a human did not accept' });
    }
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
    const heldSources = (rec.sources || []).filter((s) => s && s.status !== 'accepted').length;
    if (heldSources) {
        out.push({ field: 'sources.unaccepted', count: heldSources,
            reason: 'not reviewed and accepted by a human' });
    }
    if ((rec.sources || []).some((s) => s && s.quote)) {
        out.push({ field: 'sources.quote',
            reason: 'the model\'s copy of a span, never re-grounded locally — target_hint only' });
    }
    const heldQuestions = (rec.open_questions || []).filter((q) => q && q.status !== 'accepted').length;
    if (heldQuestions) {
        out.push({ field: 'open_questions.unaccepted', count: heldQuestions,
            reason: 'not reviewed and accepted by a human' });
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
        throw new Error('buildExtractionAnalysisEvent: nothing has been reviewed and accepted');
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
        // Coverage on the event's face, so it survives content-blind
        // aggregation: accepted:not_accepted:ungroundable_dropped.
        ['reviewed', `${c.accepted}:${c.not_accepted}:${c.ungroundable_dropped}`],
        ['published_at', String(createdAt)]
    ];
    // URL anchoring per docs/NIP_DRAFT.md §Anchoring (r for relay-side
    // filtering, i/k for NIP-73/22 conformance).
    if (url) {
        tags.push(['r', url], ['i', url], ['k', 'web']);
    }
    // Cross-link to the article itself when its coordinate is known.
    if (articleCoord) tags.push(['a', articleCoord, '', 'article']);
    // The analyzed claims, by coordinate — references, never copies.
    for (const a of payload.assertions) tags.push(['a', a.claim, '', 'analyzed']);

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
 * this event deliberately carries NO text spans. Its assertions point
 * at claim coordinates; re-locate a claim's own quote in YOUR copy of
 * the article (the `x` tag says which text) rather than trusting
 * anything positional from another machine — the same
 * TextPositionSelector-is-verification-only rule docs/NIP_DRAFT.md
 * states for selectors.
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
    const rev = String(first('reviewed') || '').split(':');
    const num = (v) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : 0);

    const assertions = (Array.isArray(payload.assertions) ? payload.assertions : [])
        .filter((a) => a && typeof a.claim === 'string')
        .map((a) => ({
            claim: a.claim,
            why: typeof a.why === 'string' ? a.why : null,
            whyBy: a.why_by === 'user' ? 'user' : (a.why_by === 'llm' ? 'llm' : null),
            generator: (a.generator && typeof a.generator === 'object') ? {
                model: a.generator.model || null,
                promptVersion: a.generator.prompt_version || null,
                producer: a.generator.producer === 'suggest' ? 'suggest' : 'map'
            } : null
        }));

    return {
        articleHash: payload.article_hash || fromD,
        articleUrl: payload.article_url || first('r'),
        title: first('title'),
        assertions,
        sources: (Array.isArray(payload.sources) ? payload.sources : [])
            .filter((s) => s && typeof s.target_hint === 'string')
            .map((s) => ({ targetHint: s.target_hint, note: typeof s.note === 'string' ? s.note : null })),
        openQuestions: (Array.isArray(payload.open_questions) ? payload.open_questions : [])
            .filter((q) => typeof q === 'string'),
        withheld: (Array.isArray(payload.withheld) ? payload.withheld : [])
            .filter((w) => w && typeof w.field === 'string')
            .map((w) => ({ field: w.field, count: Number.isFinite(w.count) ? w.count : null,
                           reason: typeof w.reason === 'string' ? w.reason : null })),
        coverage: {
            accepted: num(rev[0]),
            notAccepted: num(rev[1]),
            ungroundableDropped: num(rev[2])
        },
        // The claim coordinates this analysis references, from the tags —
        // available without parsing content (relay-side friendly).
        analyzedClaims: tags.filter((t) => t[0] === 'a' && t[3] === 'analyzed').map((t) => t[1]),
        articleCoord: (tags.find((t) => t[0] === 'a' && t[3] === 'article') || [])[1] || null
    };
}

/**
 * Resolve claim id → published coordinate for the claims an accepted
 * atom points at. A claim is referenceable ONLY once published (it
 * needs a signer pubkey to have a coordinate at all), so an accepted
 * atom whose claim is local-only is omitted from the analysis and
 * counted in `coverage.accepted_but_unpublished`.
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

// The One Article Pass — UA.1–UA.3 (docs/UNIFIED_ARTICLE_PASS_KICKOFF.md).
//
// Cache-first fetch-or-run of THE article extract for one article, and
// the pure converters that let every Suggest surface consume it: the
// extract's comprehensive claim list and its entities (with native
// about-links, corpus-v9) become the review modal's proposals. Per
// article, ONE reading (the corpus map pass); per corpus, connect and
// judge — this module is the "one reading" seam.
//
// THE ONE-REQUEST-BUILDER RULE (corpus-v4, tightened by corpus-v7):
// the unit here is built by `articleMemberUnit` — the SAME shape
// builder `buildMemberUnits` uses — over the canonical article object,
// so the cache key is byte-identical to the key an Analyze run, a
// Pre-analyze, or an entity page computes for the same capture. Never
// hand-build a lookalike unit.
//
// GUARD RAIL 6 (UA.1): nothing here ever writes or proposes
// `is_key`. Article-relative keyness is `load_bearing` on the atom
// (display-only in the modal); case-scoped keyness stays with the
// reduce's promotion and the human checkbox at corpus level.
//
// Storage IO is injectable (the idiom the retired auto-preanalyze
// module established) so the whole flow is testable without chrome.

import { Utils } from './utils.js';
import {
    articleMemberUnit, corpusMapRequest, corpusExtractKey, validateCorpusExtract
} from './case-synthesis.js';
import { getCorpusExtract, saveCorpusExtract } from './audit/audit-cache.js';
import { recordArticleExtraction } from './map-artifacts.js';
import { getArticle as getArchivedArticle } from './archive-cache.js';

/**
 * Resolve WHICH article object feeds the unit — the ARCHIVE ROW when
 * one exists, the reader's live object only as a fallback.
 *
 * This is load-bearing for the pay-once economics, not a convenience:
 * the corpus paths (buildMemberUnits) always assemble from the archive
 * row's `rec.article`, and for markdown-canonical captures
 * (PDF/EPUB/transcript, and published-then-archived articles) the
 * reader's `hashableArticle(state.article)` assembles a DIFFERENT body
 * — the row stores `markdownToHtml(markdown)` with no
 * `_contentIsMarkdown` marker, and `htmlToMarkdown` is not idempotent
 * (escape backslashes multiply per round trip) — so keying the extract
 * off the reader object forks the cache and the same article is paid
 * twice, silently. Reading the row keeps the two paths byte-identical
 * by construction. The fallback covers genuinely unarchived captures,
 * where no corpus path can exist yet either.
 *
 * @returns {Promise<{article:object, articleHash:string|null, title:string, source:'archive'|'reader'}>}
 */
export async function articleSourceForExtract({ url = '', fallbackArticle = null, fallbackHash = null, fallbackTitle = '' }, io = {}) {
    const d = { getArchived: getArchivedArticle, ...io };
    const rec = url ? await Promise.resolve(d.getArchived(url)).catch(() => null) : null;
    if (rec && rec.article) {
        return {
            article: rec.article,
            articleHash: rec.articleHash || null,
            title: rec.article.title || '',
            source: 'archive'
        };
    }
    return { article: fallbackArticle, articleHash: fallbackHash, title: fallbackTitle, source: 'reader' };
}

/**
 * A list field of MODEL-PRODUCED output, as an array — always.
 *
 * `(extract && extract.field) || []` is NOT this: `||` rescues only
 * FALSY values, so a truthy wrong type (the model emitting `entities`
 * as an object, a string, a number) passes straight through and throws
 * at the first `.map` / `.forEach` / `for...of`. That is a live crash,
 * not a hypothetical — "((extract && extract.entities) || []).map is not
 * a function" came back from a 48-minute transcript.
 *
 * The tool schema is not `strict`, so the API guarantees nothing about
 * the shape. validateCorpusExtract now rejects a wrong-typed LIST (it
 * used to normalize one to `[]` for the walk and hand the raw value on),
 * but it deliberately still tolerates malformed ROWS inside a good list
 * — so a consumer can trust that a list IS a list and nothing about what
 * is in it. Guard here anyway: this converter also runs against extracts
 * read back from cache, and defense at a pure boundary is free.
 *
 * Note `about` at the atom level was already guarded this way; the
 * top-level lists simply were not.
 */
export function listField(extract, field) {
    const v = extract && extract[field];
    return Array.isArray(v) ? v : [];
}

/**
 * A model-supplied entity ref, normalized to the ONE form both sides of
 * the claim→entity link compare against. Strings and numbers are real
 * refs (the tool is not strict, so `1` is a legal answer for a field
 * documented as "E1"); anything else is not a ref, and must not become
 * the string "[object Object]" — that would look like a ref and link
 * nothing. Empty string means "no usable ref".
 */
export function refKey(v) {
    return (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) ? String(v) : '';
}

/**
 * Render validateCorpusExtract's errors as one short human clause.
 *
 * The list mixes two shapes — schema walker entries (`{path, message}`)
 * and the whole-extract refusal strings — so a naive join prints
 * "[object Object]". Capped at two: the first is almost always the
 * cause, and a toast is not a log.
 */
export function describeExtractErrors(errors) {
    const parts = (Array.isArray(errors) ? errors : []).slice(0, 2).map((e) => {
        if (typeof e === 'string') return e;
        if (e && e.path && e.message) return `${e.path} ${e.message}`;
        if (e && e.message) return e.message;
        return 'unrecognized shape';
    });
    return parts.length ? parts.join('; ') : 'no reason reported';
}

/**
 * Ensure THE extract exists for one article: cache hit → free; miss →
 * one `xray:llm:corpus-map` call, saved under its content-only key.
 * Either way the extract folds into the durable article-extractions
 * record (MA.1) when the article's canonical hash is known — an
 * unhashed (edited-body) article still gets its extract, but the fold
 * is skipped exactly as the suggest fold skips (the record is keyed by
 * a hash that no longer describes this text).
 *
 * @param {object} opts
 * @param {object} opts.article      canonical article object (the shape
 *                                   the archive stores — the reader
 *                                   passes hashableArticle(state.article))
 * @param {string|null} [opts.articleHash]  canonical 64-hex hash, or null
 * @param {string} [opts.url]
 * @param {string} [opts.title]
 * @param {object} [opts.frame]      { caseName, scopeQuestion } — rides
 *                                   only the fold's provenance, never
 *                                   the request or the key
 * @param {function} opts.sendMessage  ({type,request}) → Promise
 * @param {function} [opts.keepalive]  () → {stop()} — pings the SW while
 *                                   the map call is in flight. Injected
 *                                   (not imported) so this module stays
 *                                   chrome-free and testable; omitting
 *                                   it only risks an MV3 teardown on a
 *                                   long call, never correctness.
 * @param {object} [io]  injectable: getExtract, saveExtract, record, now
 * @returns {Promise<{status:'cached'|'ran'|'failed'|'no-text',
 *                    key?:string, extract?:object, model?:string, error?:string}>}
 */
export async function ensureArticleExtract({ article, articleHash = null, url = '', title = '', frame = {}, sendMessage, keepalive = null, force = false }, io = {}) {
    const d = {
        getExtract:  getCorpusExtract,
        saveExtract: saveCorpusExtract,
        record:      recordArticleExtraction,
        now: () => Math.floor(Date.now() / 1000),
        ...io
    };

    // The same normalization deriveArticleRows applies to member URLs,
    // so a case-bound Analyze later computes this exact key.
    const normUrl = Utils.normalizeUrl(url) || url || null;
    const unit = articleMemberUnit({ article, articleHash, url: normUrl, title });
    if (!unit.text.trim()) return { status: 'no-text', error: 'No article text to analyze.' };

    const request = corpusMapRequest(unit);
    const key = await corpusExtractKey(request);

    const fold = async (extract, model) => {
        if (!unit.article_hash) return;   // edited body — see docblock
        await Promise.resolve(d.record({
            member: unit, extract, frame, key, model: model || ''
        })).catch(() => {});
    };

    // FORCE re-reads the article at full price, bypassing the cache.
    //
    // Not a convenience — without it some bad readings are PERMANENT.
    // The wrong-type failure self-heals, because a poisoned extract now
    // fails validation on read and falls through here. But an extract
    // that is merely POOR — no entities named, thin atomization — is
    // perfectly schema-valid, so it re-validates forever and every later
    // Suggest re-serves it. "Run Suggest again" was advice that could
    // not work: same article text → same content-only key → same cached
    // reading, at no cost and to no effect.
    const hit = force ? null : await Promise.resolve(d.getExtract(key)).catch(() => null);
    if (hit && hit.extract && validateCorpusExtract(hit.extract).ok) {
        await fold(hit.extract, hit.model);
        // `partial` is STORED with the extract, not recomputed: an
        // extract that was salvaged from a cut-off call is short
        // forever, and a cache hit that dropped the flag would present
        // it as the whole article on every later view.
        return { status: 'cached', key, extract: hit.extract, model: hit.model || '',
                 truncated: unit.truncated, partial: !!hit.partial, text: unit.text };
    }

    // The wire call can REJECT, not just return {ok:false} — an MV3
    // service-worker teardown mid-call surfaces as "the message port
    // closed". A rejection here must become a reportable failure, never
    // an unhandled rejection past the caller's toast.
    //
    // This is ONE long cold call — a long-form transcript at the raised
    // map bound can run minutes with nothing else messaging the SW,
    // which is precisely the teardown that produced "Synthesis failed:
    // no response" (JOURNAL 2026-07-18). The keepalive spans exactly the
    // fetch and stops on every exit path.
    let res;
    const ka = typeof keepalive === 'function' ? keepalive() : null;
    try { res = await sendMessage({ type: 'xray:llm:corpus-map', request }); }
    catch (err) { res = { ok: false, error: (err && err.message) || String(err) }; }
    finally { if (ka && typeof ka.stop === 'function') ka.stop(); }
    if (!res || !res.ok) return { status: 'failed', key, error: (res && res.error) || 'no response' };
    const v = validateCorpusExtract(res.extract);
    if (!v.ok) {
        // NEVER a bare "invalid extract". That message cost a debugging
        // round trip: it names the symptom, discards `v.errors` (which
        // says exactly which field), and hides WHICH of two very
        // different causes fired.
        //
        // Cause 1 — the call was cut off at the output ceiling and the
        // salvage recovered only part of the payload. A salvaged object
        // is valid ONLY if the fields the schema requires happened to be
        // emitted before the cut; a model that emits `position` after
        // `key_assertions` loses it. That is a truncation, and it must
        // read as one: an invalid-shape message sends the reader hunting
        // a parser bug that isn't there.
        const detail = describeExtractErrors(v.errors);
        const atoms = (res.extract && Array.isArray(res.extract.key_assertions))
            ? res.extract.key_assertions.length : 0;
        return {
            status: 'failed', key,
            error: res.partial
                ? `The analysis hit its output limit partway through. ${atoms} complete assertion(s) `
                  + `were recovered, but the cut lost a field the extract needs (${detail}), so none `
                  + 'could be used. This article needs more than one pass.'
                // Cause 2 — a complete response whose shape X-Ray cannot
                // consume. Rarer, and a genuinely different fix.
                : `The model returned an extract X-Ray cannot use: ${detail}. Try Suggest again.`
        };
    }

    // A cache-save failure must not lose the paid extract — the modal
    // can still consume it; the next run simply re-pays the cache miss.
    await Promise.resolve(d.saveExtract({
        key, extract: res.extract, model: res.model, cachedAt: d.now(),
        partial: !!res.partial
    })).catch(() => {});
    await fold(res.extract, res.model);
    // `truncated` disclosed: the map bound (MAX_MEMBER_INPUT_CHARS,
    // 400k — ~6.5h of transcript) still cuts a long enough capture, so
    // on one the claim half reads the head only — the caller says so
    // rather than letting coverage shrink silently. `text` is the unit
    // text the extract READ: the caller reuses it as the slim call's
    // input and the modal's grounding substrate, so quotes anchor in
    // the text they were copied from.
    // `partial`: the call was cut off at the output ceiling and the
    // extract was salvaged to its last COMPLETE assertion. Distinct from
    // `truncated` (the INPUT was sliced) — one says we read less of the
    // article, the other says we reported less of what we read. Both are
    // the caller's to disclose.
    return { status: 'ran', key, extract: res.extract, model: res.model || '',
             truncated: unit.truncated, partial: !!res.partial, text: unit.text };
}

/**
 * The extract's comprehensive claim list as review-modal proposals —
 * the SAME shape the suggest pass's kind='claim' proposals carried, so
 * the modal, its grounding firewall, and the accept path need no new
 * branch. `text` falls back to the quote when the model omitted the
 * paraphrase (the row stays editable). `load_bearing` rides for the
 * ⭐ display; `is_key` is deliberately never set (guard rail 6), and
 * `from_extract` marks the rows so the MA.4 suggest fold skips them
 * (they already folded through the map record path).
 */
export function claimProposalsFromExtract(extract) {
    const atoms = listField(extract, 'key_assertions');
    // Refs of entities the extract actually PROPOSES — an atom's `about`
    // may only point at those (an unknown ref would dangle in the modal
    // and silently drop at accept; filter it here instead).
    //
    // Two ways this set used to disagree with reality, both SILENT and
    // both costing claim→entity links — the knowledge graph, not a
    // cosmetic detail:
    //
    //  1. TYPE ASYMMETRY. The `about` side stringifies every ref
    //     (`String(r)`, below) while this side stored the RAW value, so
    //     a model emitting `"ref": 1` put the NUMBER 1 in the set and
    //     `has("1")` was false for every atom pointing at it. The tool
    //     is not strict, so an integer ref is a legal response. Both
    //     sides now normalize through the same String(). (`filter(Boolean)`
    //     also silently swallowed a `ref: 0`; the emptiness test is now
    //     on the stringified value.)
    //  2. PREDICATE DISAGREEMENT. This set admitted a ref from ANY row
    //     with a truthy `ref`, but entityProposalsFromExtract keeps only
    //     rows with a usable name AND mention. A malformed row therefore
    //     left its ref admissible here while no entity proposal for it
    //     ever reached the modal: the chip silently vanished at render
    //     and the link was dropped at accept, with no message. The set
    //     is now built from the PROPOSALS themselves, so the two can
    //     never drift again.
    const knownRefs = new Set(entityProposalsFromExtract(extract)
        .map((p) => p.ref).filter((r) => r !== ''));
    const proposals = [];
    atoms.forEach((a, i) => {
        const quote = (a && typeof a.quote === 'string') ? a.quote.trim() : '';
        if (!quote) return;
        const text = (a && typeof a.text === 'string' && a.text.trim()) ? a.text.trim() : quote;
        proposals.push({
            kind: 'claim',
            ref: `C${proposals.length + 1}`,
            text,
            quote,
            load_bearing: !!(a && a.load_bearing === true),
            why_load_bearing: (a && a.load_bearing === true && typeof a.why_load_bearing === 'string')
                ? a.why_load_bearing : '',
            // corpus-v9: native claim→entity refs from the one reading.
            about: (Array.isArray(a && a.about) ? a.about : [])
                .map(refKey).filter((r) => r !== '' && knownRefs.has(r)),
            from_extract: true
        });
    });
    return proposals;
}

/**
 * The extract's entities as review-modal proposals (corpus-v9 / UA.2)
 * — the same shape the suggest pass's kind='entity' proposals carried,
 * so the modal, its mention-grounding firewall, the ladder's
 * link-or-create affordance, and the accept path need no new branch.
 * Entries without a mention are dropped, like quote-less atoms: there
 * is nothing to ground, so nothing could ever be accepted. The model's
 * refs ride through verbatim (the atoms' `about` points at them).
 */
/**
 * WHY the entity converter yielded what it yielded.
 *
 * "No entity suggestions" was indistinguishable from "this article names
 * nobody", "the model returned rows the converter dropped", and "the
 * kind is switched off in Options" — three completely different
 * problems wearing the same silence, and the silence is what made the
 * feature read as broken. Every row the converter refuses is counted
 * here so the reader can say which one happened.
 *
 * Kept separate from entityProposalsFromExtract rather than changing its
 * return shape: that function is called from the reader and pinned by
 * tests, and a converter is the wrong place to own a message.
 */
export function entityYield(extract) {
    const rows = listField(extract, 'entities');
    const raw = extract && extract.entities;
    let proposed = 0, noName = 0, noMention = 0;
    for (const e of rows) {
        const name = (e && typeof e.name === 'string') ? e.name.trim() : '';
        const mention = (e && typeof e.mention === 'string') ? e.mention.trim() : '';
        if (!name) noName += 1;
        else if (!mention) noMention += 1;
        else proposed += 1;
    }
    return {
        rows: rows.length,
        proposed, noName, noMention,
        // The model emitted the key but as the wrong type — the failure
        // that shipped a poisoned cache entry. Distinct from "absent".
        wrongType: raw !== undefined && raw !== null && !Array.isArray(raw),
        absent: raw === undefined || raw === null
    };
}

export function entityProposalsFromExtract(extract) {
    const rows = listField(extract, 'entities');
    const proposals = [];
    for (const e of rows) {
        const name = (e && typeof e.name === 'string') ? e.name.trim() : '';
        const mention = (e && typeof e.mention === 'string') ? e.mention.trim() : '';
        if (!name || !mention) continue;
        proposals.push({
            kind: 'entity',
            // ONE normalization for a ref, shared with the `about` side
            // (refKey) — the two used to disagree, which cost every
            // claim→entity link whenever the model emitted integer refs.
            // A number is a legitimate ref the model may choose; an
            // object is not (String({}) is "[object Object]", which would
            // look like a ref and link nothing).
            ref: refKey(e.ref),
            name,
            entity_type: (typeof e.type === 'string') ? e.type : '',
            mention,
            from_extract: true
        });
    }
    return proposals;
}

// (claimIndexForSuggest and mergeSuggestProposals — the UA.1
// slim-mode bridge, where a separate entities call linked to supplied
// claims — RETIRED in UA.3 with the standalone suggest pass. Entities
// and their about-links ride the extract natively since corpus-v9.)

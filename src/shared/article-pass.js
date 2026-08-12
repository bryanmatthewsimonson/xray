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
 * @param {object} [io]  injectable: getExtract, saveExtract, record, now
 * @returns {Promise<{status:'cached'|'ran'|'failed'|'no-text',
 *                    key?:string, extract?:object, model?:string, error?:string}>}
 */
export async function ensureArticleExtract({ article, articleHash = null, url = '', title = '', frame = {}, sendMessage }, io = {}) {
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

    const hit = await Promise.resolve(d.getExtract(key)).catch(() => null);
    if (hit && hit.extract && validateCorpusExtract(hit.extract).ok) {
        await fold(hit.extract, hit.model);
        return { status: 'cached', key, extract: hit.extract, model: hit.model || '', truncated: unit.truncated, text: unit.text };
    }

    // The wire call can REJECT, not just return {ok:false} — an MV3
    // service-worker teardown mid-call surfaces as "the message port
    // closed". A rejection here must become a reportable failure, never
    // an unhandled rejection past the caller's toast.
    let res;
    try { res = await sendMessage({ type: 'xray:llm:corpus-map', request }); }
    catch (err) { res = { ok: false, error: (err && err.message) || String(err) }; }
    if (!res || !res.ok) return { status: 'failed', key, error: (res && res.error) || 'no response' };
    const v = validateCorpusExtract(res.extract);
    if (!v.ok) return { status: 'failed', key, error: 'invalid extract' };

    // A cache-save failure must not lose the paid extract — the modal
    // can still consume it; the next run simply re-pays the cache miss.
    await Promise.resolve(d.saveExtract({
        key, extract: res.extract, model: res.model, cachedAt: d.now()
    })).catch(() => {});
    await fold(res.extract, res.model);
    // `truncated` disclosed: the map bound (MAX_MEMBER_INPUT_CHARS, 60k)
    // is tighter than the old suggest bound (120k), so on a very long
    // capture the claim half reads the head only — the caller says so
    // rather than letting coverage shrink silently. `text` is the unit
    // text the extract READ: the caller reuses it as the slim call's
    // input and the modal's grounding substrate, so quotes anchor in
    // the text they were copied from.
    return { status: 'ran', key, extract: res.extract, model: res.model || '', truncated: unit.truncated, text: unit.text };
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
    const atoms = (extract && extract.key_assertions) || [];
    // Refs of entities the extract actually proposes — an atom's
    // `about` may only point at those (an unknown ref would dangle in
    // the modal and silently drop at accept; filter it here instead).
    const knownRefs = new Set(((extract && extract.entities) || [])
        .map((e) => e && e.ref).filter(Boolean));
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
                .map((r) => String(r)).filter((r) => knownRefs.has(r)),
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
export function entityProposalsFromExtract(extract) {
    const rows = (extract && extract.entities) || [];
    const proposals = [];
    for (const e of rows) {
        const name = (e && typeof e.name === 'string') ? e.name.trim() : '';
        const mention = (e && typeof e.mention === 'string') ? e.mention.trim() : '';
        if (!name || !mention) continue;
        proposals.push({
            kind: 'entity',
            ref: (e.ref && typeof e.ref === 'string') ? e.ref : '',
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

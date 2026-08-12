// The One Article Pass — UA.1 (docs/UNIFIED_ARTICLE_PASS_KICKOFF.md).
//
// Cache-first fetch-or-run of THE article extract for one article, and
// the pure converters that let the reader's Suggest flow consume it:
// the extract's comprehensive claim list becomes the modal's claim
// proposals, and the slimmed entities call's claim→entity links merge
// back onto them. Per article, ONE reading (the corpus map pass); per
// corpus, connect and judge — this module is the "one reading" seam.
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
// Storage IO is injectable (the auto-preanalyze idiom) so the whole
// flow is testable without chrome.

import { Utils } from './utils.js';
import {
    articleMemberUnit, corpusMapRequest, corpusExtractKey, validateCorpusExtract
} from './case-synthesis.js';
import { getCorpusExtract, saveCorpusExtract } from './audit/audit-cache.js';
import { recordArticleExtraction } from './map-artifacts.js';

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
        return { status: 'cached', key, extract: hit.extract, model: hit.model || '', truncated: unit.truncated };
    }

    const res = await sendMessage({ type: 'xray:llm:corpus-map', request });
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
    // rather than letting coverage shrink silently.
    return { status: 'ran', key, extract: res.extract, model: res.model || '', truncated: unit.truncated };
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
            from_extract: true
        });
    });
    return proposals;
}

/**
 * The compact claim index that rides the slimmed entities call, so the
 * model links entities to the SUPPLIED claims (model-quality links, no
 * string matching) instead of re-extracting them. Refs + capped text
 * only — the model already holds the full article text.
 */
export function claimIndexForSuggest(claimProposals) {
    return (claimProposals || [])
        .filter((c) => c && c.ref && typeof c.text === 'string' && c.text.trim())
        .map((c) => ({ ref: c.ref, text: c.text.trim().slice(0, 200) }));
}

/**
 * Merge the slim pass's entity proposals with the extract-derived
 * claim proposals into ONE modal-ready list: each entity's
 * `claim_refs` (its side of the link) is inverted onto the referenced
 * claim's `about` list — the direction the modal and the accept-time
 * builders already speak. Non-entity proposals pass through untouched;
 * unknown refs are ignored (the firewall never guesses).
 */
export function mergeSuggestProposals(entityProposals, claimProposals) {
    const claims = (claimProposals || []).map((c) => ({
        ...c, about: Array.isArray(c.about) ? [...c.about] : []
    }));
    const byRef = new Map(claims.map((c) => [c.ref, c]));
    const rest = [];
    for (const p of entityProposals || []) {
        if (!p) continue;
        rest.push(p);
        if (p.kind !== 'entity' || !p.ref || !Array.isArray(p.claim_refs)) continue;
        for (const cr of p.claim_refs) {
            const c = byRef.get(String(cr));
            if (c && !c.about.includes(p.ref)) c.about.push(p.ref);
        }
    }
    return [...rest, ...claims];
}

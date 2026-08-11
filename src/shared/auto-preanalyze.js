// Auto pre-analyze riding the Suggest click — Phase 28, retriggered
// 2026-08-11 (flag `autoPreAnalyze`, default OFF).
//
// When the reader's Suggest pass runs on an article in a workspace
// bound to a case, also run the synthesis MAP stage for that ONE
// member, so the case's next Analyze run finds the extract already
// cached (corpus-v4 made the extract claims-independent precisely so
// an ahead-of-time prepay stays valid however much claim extraction
// follows). Spend consent: the Suggest CLICK is the per-article
// authorization — turning the flag on in Options adds one Anthropic
// map call to a click that already spends one suggest call, cost
// disclosed there. This used to fire on capture (from the reader's
// archive-save tail) — which in practice ran on every writable reader
// open, a per-open spend nobody authorized (JOURNAL 2026-08-11) — so
// the trigger moved to the click and the per-click Analyze/Pre-analyze
// confirms remain the normal path.
//
// THE ONE-REQUEST-BUILDER RULE (corpus-v4, tightened by corpus-v7):
// the request here is built by `corpusMapRequest` over a
// `buildMemberUnits` unit assembled from the SAME collector the
// Analyze run uses — so the cache key is byte-identical to the key
// Analyze later computes. The map is case-free (corpus-v7): no frame
// rides the request or the key, so this prepaid extract also serves
// every OTHER case and entity page that ever includes the article.
// Never hand-build a lookalike unit here: a one-character drift in
// text, title, or url silently orphans every prepaid extract.
//
// Quiet by design: every outcome is returned as a status for the
// caller to log (and optionally toast on an actual spend); a failure
// must never disturb the suggest flow — the Analyze run simply pays
// for this member later.

import { collectCaseDossierData, caseScopeQuestion } from './case-dossier.js';
import {
    buildMemberUnits, corpusMapRequest, corpusExtractKey, validateCorpusExtract
} from './case-synthesis.js';
import { getCorpusExtract, saveCorpusExtract } from './audit/audit-cache.js';
import { recordArticleExtraction } from './map-artifacts.js';
import { loadFlags, isEnabled } from './metadata/feature-flags.js';
import { Utils } from './utils.js';

/**
 * Run the map prepay for one article of a bound case.
 *
 * @param {object} opts
 * @param {string} opts.caseEntityId  the bound case (resolveActiveCaseRef().caseId)
 * @param {string} opts.url           the article's URL
 * @param {function} opts.sendMessage message-bus sender ({type,request} → Promise)
 * @param {object} [io]               injectable IO for tests: loadFlags,
 *                                    isEnabled, collectData, getExtract,
 *                                    saveExtract, now
 * @returns {Promise<{status:string, key?:string, model?:string, error?:string}>}
 *   status: 'off' (flag), 'gated' (synthesis/assist off), 'no-case',
 *   'no-member' (the article is not a member of the bound case —
 *   Analyze covers it once it is), 'cached' (valid extract already
 *   present, no call), 'ran' (one call, saved), 'failed' (call or
 *   validation failed; logged, never thrown).
 */
export async function autoPreAnalyzeArticle({ caseEntityId, url, sendMessage }, io = {}) {
    const d = {
        loadFlags, isEnabled,
        collectData: (id) => collectCaseDossierData(id),
        getExtract:  getCorpusExtract,
        saveExtract: saveCorpusExtract,
        // MA.1 — the durable per-article fold (never rejects; O(1) on
        // an already-folded fingerprint).
        record:      recordArticleExtraction,
        now: () => Math.floor(Date.now() / 1000),
        ...io
    };

    await d.loadFlags();
    if (!d.isEnabled('autoPreAnalyze')) return { status: 'off' };
    // The SW's corpusGate re-checks synthesis + assist + key before any
    // network call; this early return just skips the dossier load when
    // the pass could never run.
    if (!d.isEnabled('caseSynthesis') || !d.isEnabled('llmAssist')) return { status: 'gated' };
    if (!caseEntityId || !url) return { status: 'no-case' };

    const data = await d.collectData(caseEntityId);
    // No assessments joined: claim stances never enter the map request
    // (corpus-v4/v7 — the request carries only text + title/url).
    const units = await buildMemberUnits(data);
    const target = Utils.normalizeUrl(url) || url;
    const unit = units.find((u) => u.url === target) || units.find((u) => u.url === url) || null;
    if (!unit) return { status: 'no-member' };

    // The frame rides only the durable fold's provenance (which case
    // triggered this prepay) — never the request or the cache key.
    const frame = {
        caseName: (data.case && data.case.name) || '',
        scopeQuestion: caseScopeQuestion(data)
    };
    const request = corpusMapRequest(unit);
    const key = await corpusExtractKey(request);

    const hit = await Promise.resolve(d.getExtract(key)).catch(() => null);
    if (hit && hit.extract && validateCorpusExtract(hit.extract).ok) {
        await Promise.resolve(d.record({
            member: unit, extract: hit.extract, frame, key, model: hit.model
        })).catch(() => {});
        return { status: 'cached', key };
    }

    const res = await sendMessage({ type: 'xray:llm:corpus-map', request });
    if (!res || !res.ok) return { status: 'failed', key, error: (res && res.error) || 'no response' };
    const v = validateCorpusExtract(res.extract);
    if (!v.ok) return { status: 'failed', key, error: 'invalid extract' };

    await d.saveExtract({ key, extract: res.extract, model: res.model, cachedAt: d.now() });
    await Promise.resolve(d.record({
        member: unit, extract: res.extract, frame, key, model: res.model
    })).catch(() => {});
    return { status: 'ran', key, model: res.model };
}

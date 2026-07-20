// Audit findings ⇄ claim spine — CA.2 (docs/CORPUS_AUDIT_KICKOFF.md).
// P2 executed: audit findings and claims both carry verbatim spans of
// the SAME canonical article text (P3 forces the finding quotes;
// capture grounding forces the claim quotes), so the join is the
// corpus-v4 span-overlap idiom — locate both in one grounding index,
// link on intersection. LOCAL and derived, computed on read (§9):
// nothing on the wire changes; findings stay article-anchored (P4).
//
// THE FIREWALL, stated where the join lives: a finding describes the
// ARTICLE'S process (the §2 Outsider Stance). Joined to a claim it is
// LOCATION — "the audit flagged something at this passage" — never a
// verdict on the claim's truth (§3.1). Renderers must label it so.

import { createGroundingIndex } from '../quote-grounding.js';
import { collectEvidenceQuotes } from './assemble.js';

/**
 * Join one run's module findings to one member's claims.
 *
 * @param {object} input
 * @param {Array}  input.moduleResults  run.moduleResults ({module, findings})
 * @param {string} input.memberText     the canonical member body
 * @param {Array}  input.claims         [{id, quote}] (quoteless claims can't join)
 * @param {object} [index]              reusable grounding index over memberText
 * @returns {Object<string, Array<{module: string, quote: string}>>} claim id →
 *          findings at that passage (deduped per module+quote)
 */
export function linkRunFindingsToClaims({ moduleResults = [], memberText = '', claims = [] }, index = null) {
    const byClaim = {};
    const spans = [];
    let idx = index;
    for (const c of claims) {
        if (!c || !c.id || !c.quote) continue;
        idx = idx || createGroundingIndex(memberText || '');
        const g = idx.ground(c.quote);
        if (g.status !== 'missing') spans.push({ id: c.id, start: g.start, end: g.end });
    }
    if (spans.length === 0) return byClaim;

    const seen = new Set();
    for (const mr of moduleResults) {
        if (!mr || !mr.module || !mr.findings) continue;
        for (const { quote } of collectEvidenceQuotes(mr.findings)) {
            const g = idx.ground(quote);
            if (g.status === 'missing') continue;
            for (const s of spans) {
                const overlap = Math.min(g.end, s.end) - Math.max(g.start, s.start);
                if (overlap <= 0) continue;
                const key = `${s.id}|${mr.module}|${quote}`;
                if (seen.has(key)) continue;
                seen.add(key);
                (byClaim[s.id] = byClaim[s.id] || []).push({ module: mr.module, quote });
            }
        }
    }
    return byClaim;
}

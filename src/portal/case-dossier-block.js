// Case-dossier block — CD.2 (docs/CASE_DOSSIER_DESIGN.md §3.1, §3.4).
//
// The Phase-15 complement of the audit dossier block: the case's
// "shape of knowledge" header (the verdict-state DISTRIBUTION over its
// propositions, its coverage line, and the standards-of-proof in play)
// and the convergence-collapsed evidence view (per-article rows plus the
// attestation independence measurement, so "twelve outlets, one wire"
// reads as one independent source — never averaged into a score).
//
// Data comes from case-dossier.js `assembleCaseDossier` (CD.1). This
// module is presentation only: two pure, testable shaping helpers plus a
// thin DOM renderer that async-loads the dossier and paints it. No case
// score is ever computed or shown (design §2.2); coverage is stated on
// its face (§2.6) so absence of evidence never reads as evidence of
// absence.
//
// SCOPE (matches CD.1's boundary): the §3.1 header renders the
// verdict-state distribution + coverage + standards. The prediction
// counts and the publication/capture timeline axes are deferred to
// later slices that hold the portal library/archive index.

import { el, clear, truncate } from './dom.js';
import { assembleCaseDossier } from '../shared/case-dossier.js';
import {
    VERDICT_STATES, VERDICT_STATE_LABELS,
    STANDARD_OF_PROOF_LABELS, EVIDENCE_TIER_LABELS
} from '../shared/truth-taxonomy.js';

// ------------------------------------------------------------------
// Pure shaping helpers (tested)
// ------------------------------------------------------------------

/**
 * The shape-of-knowledge header data: the verdict-state distribution in
 * canonical order, the standards-of-proof tally, and the coverage line.
 * Never a fused number — the distribution IS the headline.
 *
 * @param {object} dossier - assembleCaseDossier output
 */
export function shapeOfKnowledge(dossier) {
    const dist = (dossier && dossier.distribution) || { by_state: {}, by_standard: {}, total: 0 };
    const cov = (dossier && dossier.coverage) || {};

    const distribution = VERDICT_STATES
        .filter((s) => dist.by_state && dist.by_state[s])
        .map((s) => ({ state: s, label: VERDICT_STATE_LABELS[s] || s, count: dist.by_state[s] }));

    const standards = Object.entries(dist.by_standard || {})
        .map(([standard, count]) => ({
            standard,
            label: STANDARD_OF_PROOF_LABELS[standard] || standard,
            count
        }))
        .sort((a, b) => b.count - a.count || (a.standard < b.standard ? -1 : a.standard > b.standard ? 1 : 0));

    const total = dist.total || 0;
    return {
        distribution,
        standards,
        total,                                                  // propositions with an active verdict
        unruled: Math.max(0, (cov.propositions || 0) - total),  // atomized but not yet ruled
        coverage: {
            articles:                 cov.articles || 0,
            claims:                   cov.claims || 0,
            claims_with_propositions: cov.claims_with_propositions || 0,
            propositions:             cov.propositions || 0,
            entities:                 cov.entities || 0
        },
        unanimous: !!dist.unanimous
    };
}

/**
 * The evidence view: per-article rows plus the attestation-convergence
 * independence measurement (origin groups with their baseline/demonstrated
 * flags). The measurement is what "collapses" correlated coverage — it is
 * surfaced, never folded into the article count.
 *
 * @param {object} dossier - assembleCaseDossier output
 */
export function evidenceView(dossier) {
    const ev = (dossier && dossier.evidence) || { articles: [], convergence: {} };
    const conv = ev.convergence || {};

    const originGroups = (conv.origin_groups || []).map((g) => ({
        origin_key:         g.origin_key,
        tier:               g.tier,
        tier_label:         EVIDENCE_TIER_LABELS[g.tier] || g.tier || '',
        link_count:         (g.link_ids || []).length,
        baseline:           !!g.baseline,
        demonstrated:       !!g.demonstrated,
        independence_notes: g.independence_notes || []
    }));

    return {
        articles: ev.articles || [],
        origin_groups: originGroups,
        summary: {
            total_attestations: conv.total_attestations || 0,
            origin_count:       conv.origin_count || 0,
            independent_count:  conv.independent_count || 0,
            by_tier:            conv.by_tier || {}
        }
    };
}

// ------------------------------------------------------------------
// DOM renderer (thin; async-loads the dossier)
// ------------------------------------------------------------------

/**
 * Render the case-dossier block into `host`. Synchronous: it appends a
 * container immediately and fills it once `assembleCaseDossier` resolves
 * (the portal render path is sync; the local model read is a microtask).
 *
 * @param {HTMLElement} host
 * @param {string} caseEntityId - the LOCAL entity id (entityIndex[pubkey].entityId)
 * @returns {HTMLElement} the block container
 */
export function renderCaseDossierBlock(host, caseEntityId) {
    const block = el('div', 'xr-case-dossier');
    block.appendChild(el('p', 'xr-case-dossier__loading', 'Assembling case dossier…'));
    host.appendChild(block);

    if (!caseEntityId) {
        clear(block);
        return block;
    }

    assembleCaseDossier(caseEntityId)
        .then((dossier) => { clear(block); paint(block, dossier); })
        .catch(() => {
            clear(block);
            block.appendChild(el('p', 'xr-view__empty',
                'Case dossier unavailable — the case entity isn\'t in the local registry.'));
        });
    return block;
}

function paint(block, dossier) {
    const shape = shapeOfKnowledge(dossier);
    const evidence = evidenceView(dossier);

    // --- Shape of knowledge (the header) ---
    const header = el('div', 'xr-case-dossier__shape');
    header.appendChild(el('h3', 'xr-case__heading', 'Shape of knowledge'));

    if (shape.total === 0) {
        header.appendChild(el('p', 'xr-case-dossier__empty',
            `No propositions ruled yet — ${shape.coverage.propositions} atomized `
            + `across ${shape.coverage.claims} claim(s) in ${shape.coverage.articles} article(s).`));
    } else {
        const dist = el('div', 'xr-case-dossier__dist');
        for (const d of shape.distribution) {
            const chip = el('span', `xr-case-dossier__state xr-state--${d.state}`,
                `${d.label}: ${d.count}`);
            dist.appendChild(chip);
        }
        if (shape.unruled > 0) {
            dist.appendChild(el('span', 'xr-case-dossier__state xr-state--unruled',
                `Atomized, unruled: ${shape.unruled}`));
        }
        header.appendChild(dist);

        // Standards chips — "established at preponderance" ≠ "…beyond
        // reasonable doubt", so the standards in play are shown, not hidden.
        if (shape.standards.length > 0) {
            const std = el('div', 'xr-case-dossier__standards');
            std.appendChild(el('span', 'xr-case-dossier__label', 'On standards:'));
            for (const s of shape.standards) {
                std.appendChild(el('span', 'xr-chip', `${s.label} · ${s.count}`));
            }
            header.appendChild(std);
        }
    }

    // Coverage line — always shown (coverage on its face).
    const c = shape.coverage;
    header.appendChild(el('p', 'xr-case-dossier__coverage',
        `Coverage: ${c.articles} article(s) · ${c.claims} claim(s) · `
        + `${c.claims_with_propositions} with propositions · ${c.propositions} proposition(s) · `
        + `${c.entities} entit${c.entities === 1 ? 'y' : 'ies'}`));
    block.appendChild(header);

    // --- Evidence (convergence-collapsed) ---
    const evBlock = el('div', 'xr-case-dossier__evidence');
    evBlock.appendChild(el('h3', 'xr-case__heading', 'Evidence'));

    const s = evidence.summary;
    if (s.total_attestations > 0) {
        const banner = el('p', 'xr-case-dossier__convergence',
            `Attestation independence: ${s.independent_count} independent origin(s) `
            + `of ${s.origin_count} (${s.total_attestations} attestation(s)). `
            + 'Correlated coverage is surfaced, never counted as independent.');
        evBlock.appendChild(banner);

        const groups = el('ul', 'xr-case-dossier__origins');
        for (const g of evidence.origin_groups) {
            const li = el('li', 'xr-case-dossier__origin');
            const flag = g.baseline ? 'baseline' : (g.demonstrated ? 'independent' : 'undemonstrated');
            li.appendChild(el('span', `xr-chip xr-origin--${flag}`, flag));
            li.appendChild(el('span', 'xr-case-dossier__origin-key', truncate(g.origin_key, 48)));
            if (g.tier_label) li.appendChild(el('span', 'xr-chip', g.tier_label));
            li.appendChild(el('span', 'xr-case-dossier__origin-n', `${g.link_count} link(s)`));
            groups.appendChild(li);
        }
        evBlock.appendChild(groups);
    }

    // Per-article rows (context chips beyond audit/capture come with CD's
    // later render slices that hold the portal library index).
    if (evidence.articles.length > 0) {
        const table = el('ul', 'xr-case-dossier__articles');
        for (const a of evidence.articles) {
            const li = el('li', 'xr-case-dossier__article');
            const link = el('a', 'xr-case-dossier__article-url', truncate(a.url, 80));
            link.href = a.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            li.appendChild(link);
            li.appendChild(el('span', 'xr-case-dossier__article-n',
                `${a.claim_ids.length} claim(s)`
                + (a.key_claim_count ? ` · ${a.key_claim_count} key` : '')));
            table.appendChild(li);
        }
        evBlock.appendChild(table);
    } else {
        evBlock.appendChild(el('p', 'xr-case-dossier__empty', 'No source articles in this case orbit yet.'));
    }
    block.appendChild(evBlock);
}

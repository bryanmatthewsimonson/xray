// Durable map-artifact review block — MA.2
// (docs/MAP_ARTIFACT_KICKOFF.md). The case-dashboard surface over the
// `article-extractions` records that every corpus map pass accumulates:
// the atomized assertions (verbatim, machine-grounded quotes) parked as
// durable claim proposals, plus the sources and open questions each
// article's analysis surfaced.
//
// Costs NO LLM call and is therefore not consent-gated: it reviews
// knowledge already bought. Absent until records exist for members.
// Claim coverage is computed on read against the CURRENT claim set
// (never persisted — the corpus-v4 discipline); Accept mints a real
// claim through ClaimModel.create stamped `llm:<model>`, Dismiss is
// remembered on the record. Nothing auto-applies; nothing evaporates.

import { el, truncate } from './dom.js';
import { Utils } from '../shared/utils.js';
import { ClaimModel } from '../shared/claim-model.js';
import { buildMemberUnits } from '../shared/case-synthesis.js';
import { createGroundingIndex } from '../shared/quote-grounding.js';
import { getArticleExtraction, saveArticleExtraction } from '../shared/audit/audit-cache.js';
import {
    assertionClaimCoverage, partitionAssertions, setAssertionTriage
} from '../shared/map-artifacts.js';

const now = () => Math.floor(Date.now() / 1000);

/**
 * @param {HTMLElement} host
 * @param {object} params
 * @param {object} params.data      collectCaseDossierData output
 * @param {object} params.callbacks {onReloadCase()}
 */
export function renderExtractionBlock(host, { data, callbacks = {} }) {
    void callbacks;   // parity with sibling blocks; Refresh folds accepts in
    const caseId = data.case && data.case.id;
    if (!caseId) return;
    const block = el('div', 'xr-synth');
    host.appendChild(block);

    (async () => {
        const members = await buildMemberUnits(data);
        const withRecords = [];
        for (const m of members) {
            const rec = await getArticleExtraction(m.article_hash).catch(() => null);
            if (rec && (rec.assertions || []).length + (rec.sources || []).length
                    + (rec.open_questions || []).length > 0) {
                withRecords.push({ member: m, rec });
            }
        }
        if (withRecords.length === 0) { block.remove(); return; }   // no records ⇒ no surface

        let totalOpen = 0;
        let totalAccepted = 0;
        let totalDismissed = 0;
        let totalDropped = 0;
        for (const { rec } of withRecords) {
            const p = partitionAssertions(rec);
            totalOpen += p.open.length;
            totalAccepted += p.accepted.length;
            totalDismissed += p.dismissed.length;
            totalDropped += rec.dropped_ungrounded || 0;
        }

        block.appendChild(el('h3', 'xr-case__heading',
            'Extracted assertions — the durable map artifacts'));
        block.appendChild(el('p', 'xr-case__explainer',
            'Every corpus analysis pass atomizes each article into grounded assertions and '
            + 'saves them here, per article, permanently — re-runs only add what is new. '
            + 'Accept mints a claim (editable text, verbatim quote kept as evidence); '
            + 'Dismiss is remembered. Nothing is applied automatically.'));
        const provBits = [
            `${withRecords.length} article${withRecords.length === 1 ? '' : 's'} with extraction records`,
            `${totalOpen} open`,
            `${totalAccepted} accepted`,
            `${totalDismissed} dismissed`
        ];
        if (totalDropped) provBits.push(`${totalDropped} ungroundable quote${totalDropped === 1 ? '' : 's'} dropped (P6)`);
        block.appendChild(el('div', 'xr-synth__prov', provBits.join(' · ')));

        const refreshHint = el('div', 'xr-synth__status');
        refreshHint.hidden = true;
        block.appendChild(refreshHint);
        let acceptedThisView = 0;
        const noteAccepted = () => {
            acceptedThisView += 1;
            refreshHint.hidden = false;
            refreshHint.textContent =
                `${acceptedThisView} claim${acceptedThisView === 1 ? '' : 's'} minted — `
                + 'Refresh (top right) to fold them into the case view.';
        };

        for (const entry of withRecords) {
            block.appendChild(memberSection(entry, { caseId, noteAccepted }));
        }
    })().catch((err) => {
        Utils.error('Extraction block render failed', err);
        block.remove();
    });
}

function provChip(a) {
    const fs = a.first_seen || {};
    const bits = [fs.model, fs.promptVersion].filter(Boolean);
    if (fs.at) bits.push(new Date(fs.at * 1000).toISOString().slice(0, 10));
    return el('span', 'xr-synth__prov-row', bits.join(' · '));
}

function memberSection({ member, rec }, { caseId, noteAccepted }) {
    const sec = el('details', 'xr-synth__sec');
    const parts = partitionAssertions(rec);
    const label = () => {
        const p = partitionAssertions(rec);
        const bits = [`${p.open.length} open`];
        if (p.accepted.length) bits.push(`${p.accepted.length} ✓`);
        if (p.dismissed.length) bits.push(`${p.dismissed.length} dismissed`);
        if (rec.dropped_ungrounded) bits.push(`${rec.dropped_ungrounded} ungroundable dropped`);
        return `${truncate(member.title || member.url, 80)} — ${bits.join(' · ')}`;
    };
    const summary = el('summary', null, label());
    sec.appendChild(summary);

    // Grounding + claim coverage are computed lazily on first expand:
    // building an index over a 60k-char member for every record on
    // every case-view paint would be wasted work for sections nobody
    // opens. Coverage is fresh each expand (computed, never stored).
    let painted = false;
    const body = el('div');
    sec.appendChild(body);
    sec.addEventListener('toggle', () => {
        if (!sec.open || painted) return;
        painted = true;
        paintMember(body, { member, rec, caseId, noteAccepted, relabel: () => { summary.textContent = label(); } });
    });
    if (parts.open.length === 0) sec.classList.add('xr-extr--settled');
    return sec;
}

function paintMember(body, { member, rec, caseId, noteAccepted, relabel }) {
    const index = createGroundingIndex(member.text);
    const coverage = assertionClaimCoverage(rec, member, index);
    const claimText = {};
    for (const c of member.claims || []) claimText[c.id] = c.text || '';
    const { open, accepted, dismissed } = partitionAssertions(rec);
    const openUncovered = open.filter((a) => !coverage[a.key]);
    const openCovered = open.filter((a) => coverage[a.key]);

    // `rec` is shared, mutable state for this section: every triage
    // persists the LATEST record, so sequential accepts never clobber
    // each other.
    const persistTriage = async (key, status, claimId = null) => {
        const updated = setAssertionTriage(rec, key, status, { claimId, now: now() });
        await saveArticleExtraction(updated);
        rec.assertions = updated.assertions;
        rec.updatedAt = updated.updatedAt;
        relabel();
    };

    const assertionRow = (a, { undismiss = false } = {}) => {
        const row = el('div', 'xr-synth__prop xr-extr__row');
        const main = el('div', 'xr-synth__prop-desc');
        main.appendChild(el('blockquote', 'xr-finding-row__quote', truncate(a.quote, 300)));
        if (a.why) main.appendChild(el('div', 'xr-synth__prop-note', a.why));
        main.appendChild(provChip(a));
        row.appendChild(main);

        // The claim text is the human's to author — prefilled with the
        // article's own span, editable before Accept (the quote is kept
        // verbatim as the evidence anchor regardless).
        const input = el('input', 'xr-hyp__input xr-extr__text');
        input.type = 'text';
        input.value = a.quote;
        input.title = 'The claim text to mint — edit freely; the verbatim quote stays attached as evidence';
        row.appendChild(input);

        const acceptBtn = el('button', 'xr-portal__btn', 'Accept as claim');
        acceptBtn.type = 'button';
        acceptBtn.addEventListener('click', async () => {
            acceptBtn.disabled = true;
            try {
                const claim = await ClaimModel.create({
                    text: input.value.trim() || a.quote,
                    quote: a.quote,
                    source_url: member.url,
                    article_hash: member.article_hash,
                    about: [caseId].filter(Boolean),
                    suggested_by: `llm:${(a.first_seen && a.first_seen.model) || 'unknown'}`
                });
                await persistTriage(a.key, 'accepted', claim.id);
                row.replaceChildren(el('span', 'xr-synth__prop-desc', `✓ ${truncate(input.value.trim() || a.quote, 120)}`));
                noteAccepted();
            } catch (err) {
                Utils.error('Assertion accept failed', err);
                acceptBtn.disabled = false;
                row.appendChild(el('span', 'xr-synth__prop-note', `accept failed: ${err.message || err}`));
            }
        });
        row.appendChild(acceptBtn);

        if (!undismiss) {
            const dismissBtn = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Dismiss');
            dismissBtn.type = 'button';
            dismissBtn.addEventListener('click', async () => {
                try {
                    await persistTriage(a.key, 'dismissed');
                    row.remove();
                } catch (err) { Utils.error('Assertion dismiss failed', err); }
            });
            row.appendChild(dismissBtn);
        }
        return row;
    };

    for (const a of openUncovered) body.appendChild(assertionRow(a));

    if (openCovered.length) {
        const cov = el('details', 'xr-synth__sec');
        cov.appendChild(el('summary', null,
            `Already covered by existing claims (${openCovered.length})`));
        for (const a of openCovered) {
            const row = el('div', 'xr-synth__prop');
            const main = el('div', 'xr-synth__prop-desc');
            main.appendChild(el('blockquote', 'xr-finding-row__quote', truncate(a.quote, 200)));
            main.appendChild(el('div', 'xr-synth__prop-note',
                `covers claim: ${truncate(claimText[coverage[a.key]] || coverage[a.key], 120)}`));
            row.appendChild(main);
            cov.appendChild(row);
        }
        body.appendChild(cov);
    }

    for (const a of accepted) {
        const row = el('div', 'xr-synth__prop');
        row.appendChild(el('span', 'xr-synth__prop-desc', `✓ ${truncate(a.quote, 120)}`));
        body.appendChild(row);
    }

    if (dismissed.length) {
        const dis = el('details', 'xr-synth__sec');
        dis.appendChild(el('summary', null, `Dismissed (${dismissed.length})`));
        for (const a of dismissed) dis.appendChild(assertionRow(a, { undismiss: true }));
        body.appendChild(dis);
    }

    if ((rec.sources || []).length) {
        const src = el('details', 'xr-synth__sec');
        src.appendChild(el('summary', null,
            `Cited sources (${rec.sources.length}) — the expansion frontier`));
        const ul = el('ul', 'xr-list');
        for (const s of rec.sources) {
            const li = el('li', 'xr-synth__text', s.target_hint || truncate(s.quote, 120));
            if (s.target_hint && s.quote) li.title = s.quote;
            ul.appendChild(li);
        }
        src.appendChild(ul);
        body.appendChild(src);
    }

    if ((rec.open_questions || []).length) {
        const oq = el('details', 'xr-synth__sec');
        oq.appendChild(el('summary', null, `Open questions this article leaves (${rec.open_questions.length})`));
        const ul = el('ul', 'xr-list');
        for (const q of rec.open_questions) ul.appendChild(el('li', 'xr-synth__text', q.text));
        oq.appendChild(ul);
        body.appendChild(oq);
    }
}

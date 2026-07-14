// Case-synthesis proposal review — Phase 20.4. The portal-native
// Accept/Reject surface for the brief's proposals. The reader's
// openLlmReview grounds against ONE article and validates relationship
// endpoints as same-pass refs — both wrong for corpus proposals, which
// reference REAL existing claim ids across many documents. Accept
// routes through the existing model firewalls (ClaimModel /
// EvidenceLinker create/update), stamped `llm:<model>`. Nothing is
// auto-applied; nothing is published.

import { el, truncate } from './dom.js';
import { Utils } from '../shared/utils.js';
import { ClaimModel } from '../shared/claim-model.js';
import { EvidenceLinker } from '../shared/evidence-linker.js';

function describe(p, claimsById) {
    if (p.kind === 'relationship') {
        const s = claimsById[p.source_claim_id];
        const t = claimsById[p.target_claim_id];
        return `Link: "${truncate((s && s.text) || p.source_claim_id, 50)}" ${p.relationship} `
            + `"${truncate((t && t.text) || p.target_claim_id, 50)}"`;
    }
    if (p.kind === 'is_key') {
        const c = claimsById[p.claim_id];
        return `Flag load-bearing: "${truncate((c && c.text) || p.claim_id, 70)}"`;
    }
    if (p.kind === 'claim') {
        return `New claim: "${truncate(p.text || '', 70)}"`;
    }
    return p.kind;
}

async function accept(p, { model, memberByHash }) {
    const suggested_by = `llm:${model || 'unknown'}`;
    if (p.kind === 'relationship') {
        await EvidenceLinker.create({
            source_claim_id: p.source_claim_id, target_claim_id: p.target_claim_id,
            relationship: p.relationship, note: p.note || '', suggested_by
        });
    } else if (p.kind === 'is_key') {
        await ClaimModel.update(p.claim_id, { is_key: true });
    } else if (p.kind === 'claim') {
        const member = memberByHash[p.article_hash];
        if (!member) throw new Error('member article not found for claim proposal');
        await ClaimModel.create({
            text: p.text, quote: p.quote, source_url: member.url,
            article_hash: p.article_hash, about: [member.caseId].filter(Boolean),
            suggested_by
        });
    }
}

/**
 * Render the proposals list into `host`. `acceptable`/`rejected` come
 * from filterProposals; `claimsById` labels existing refs;
 * `memberByHash` (article_hash → {url, caseId}) resolves claim
 * proposals; `model` stamps suggested_by; `onChanged` re-renders the
 * case view after an accept.
 */
export function renderProposals(host, { acceptable, rejected, claimsById, memberByHash, model, onChanged }) {
    host.replaceChildren();
    if ((!acceptable || acceptable.length === 0) && (!rejected || rejected.length === 0)) return;

    host.appendChild(el('h4', 'xr-case__heading', 'Proposals — review and accept'));

    for (const p of acceptable || []) {
        const row = el('div', 'xr-synth__prop');
        row.appendChild(el('span', 'xr-synth__prop-desc', describe(p, claimsById)));
        if (p.note) row.appendChild(el('span', 'xr-synth__prop-note', p.note));
        const acceptBtn = el('button', 'xr-portal__btn', 'Accept');
        acceptBtn.type = 'button';
        const rejectBtn = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Dismiss');
        rejectBtn.type = 'button';
        rejectBtn.addEventListener('click', () => row.remove());
        acceptBtn.addEventListener('click', async () => {
            acceptBtn.disabled = true;
            try {
                await accept(p, { model, memberByHash });
                row.replaceChildren(el('span', 'xr-synth__prop-desc', '✓ ' + describe(p, claimsById)));
                if (typeof onChanged === 'function') onChanged();
            } catch (err) {
                Utils.error('Proposal accept failed', err);
                acceptBtn.disabled = false;
                row.appendChild(el('span', 'xr-synth__prop-note', `accept failed: ${err.message || err}`));
            }
        });
        row.appendChild(acceptBtn);
        row.appendChild(rejectBtn);
        host.appendChild(row);
    }

    for (const p of rejected || []) {
        const row = el('div', 'xr-synth__prop xr-synth__prop--rejected');
        row.appendChild(el('span', 'xr-synth__prop-desc', describe(p, claimsById)));
        row.appendChild(el('span', 'xr-synth__prop-note', `not acceptable: ${p.reason}`));
        host.appendChild(row);
    }
}

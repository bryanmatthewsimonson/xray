// The minimal Resolve… form (Phase 13.7) — the prediction ledger's
// write side. Files a LOCAL resolution record (ResolutionModel);
// publishing the 30059 is slice 13.8, behind the flag.
//
// Resolutions are evidence-bound (P3): the form requires at least one
// typed evidence entry — challenges without evidence are returned,
// and so are resolutions. nostr_event values must be a raw coordinate
// or 64-hex event id (the wire grammar).

import { el, clear } from './dom.js';
import { ResolutionModel } from '../shared/audit/audit-model.js';

const OUTCOMES = ['true', 'false', 'partial', 'unresolvable'];
const EVIDENCE_KINDS = ['url', 'nostr_event', 'document_hash', 'quote'];

/**
 * Open the form for one prediction. `prediction` needs {text,
 * coordinate} — the coordinate is the 30058's `kind:pubkey:d`
 * (remote events carry it; local unpublished ones derive it from the
 * resolver identity, since the v1 flow publishes both under one key).
 * Resolves with the created resolution record, or null on cancel.
 */
export function openResolveForm(prediction) {
    return new Promise((resolve) => {
        const host = el('div', 'xr-resolve');
        const card = el('div', 'xr-resolve__card');
        host.appendChild(card);

        card.appendChild(el('h3', 'xr-resolve__title', 'Resolve prediction'));
        const quote = el('blockquote', 'xr-resolve__pred', prediction.text);
        card.appendChild(quote);

        // Outcome
        const outcomeRow = el('label', 'xr-resolve__row', 'Outcome ');
        const outcomeSel = el('select', 'xr-resolve__input');
        for (const o of OUTCOMES) {
            const opt = el('option', null, o);
            opt.value = o;
            outcomeSel.appendChild(opt);
        }
        outcomeRow.appendChild(outcomeSel);
        card.appendChild(outcomeRow);

        // Confidence
        const confRow = el('label', 'xr-resolve__row', 'Confidence (0–1) ');
        const confInput = el('input', 'xr-resolve__input');
        confInput.type = 'number';
        confInput.min = '0';
        confInput.max = '1';
        confInput.step = '0.05';
        confInput.value = '0.9';
        confRow.appendChild(confInput);
        card.appendChild(confRow);

        // Evidence rows (at least one)
        card.appendChild(el('div', 'xr-resolve__row', 'Evidence — what shows this outcome (at least one):'));
        const evidenceList = el('div', 'xr-resolve__evidence');
        card.appendChild(evidenceList);
        const addEvidenceRow = () => {
            const row = el('div', 'xr-resolve__evrow');
            const kindSel = el('select', 'xr-resolve__input xr-resolve__input--kind');
            for (const k of EVIDENCE_KINDS) {
                const opt = el('option', null, k);
                opt.value = k;
                kindSel.appendChild(opt);
            }
            const valueInput = el('input', 'xr-resolve__input xr-resolve__input--value');
            valueInput.placeholder = 'value (URL, coordinate/event id, sha256, or verbatim quote)';
            const descInput = el('input', 'xr-resolve__input xr-resolve__input--desc');
            descInput.placeholder = 'description';
            row.appendChild(kindSel);
            row.appendChild(valueInput);
            row.appendChild(descInput);
            evidenceList.appendChild(row);
        };
        addEvidenceRow();
        const addBtn = el('button', 'xr-portal__btn xr-portal__btn--ghost', '+ evidence');
        addBtn.type = 'button';
        addBtn.addEventListener('click', addEvidenceRow);
        card.appendChild(addBtn);

        // Notes
        const notes = el('textarea', 'xr-resolve__notes');
        notes.placeholder = 'Notes — what happened, why this outcome (markdown)';
        card.appendChild(notes);

        const errLine = el('div', 'xr-resolve__error');
        card.appendChild(errLine);

        // Actions
        const actions = el('div', 'xr-resolve__actions');
        const cancel = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Cancel');
        cancel.type = 'button';
        const save = el('button', 'xr-portal__btn', 'File resolution');
        save.type = 'button';
        actions.appendChild(cancel);
        actions.appendChild(save);
        card.appendChild(actions);

        const close = (result) => {
            document.removeEventListener('keydown', onKey);
            if (host.parentNode) host.parentNode.removeChild(host);
            resolve(result);
        };
        const onKey = (ev) => { if (ev.key === 'Escape') close(null); };
        document.addEventListener('keydown', onKey);
        host.addEventListener('click', (ev) => { if (ev.target === host) close(null); });
        cancel.addEventListener('click', () => close(null));

        save.addEventListener('click', async () => {
            const evidence = [...evidenceList.querySelectorAll('.xr-resolve__evrow')]
                .map((row) => ({
                    kind: row.querySelector('.xr-resolve__input--kind').value,
                    value: row.querySelector('.xr-resolve__input--value').value.trim(),
                    description: row.querySelector('.xr-resolve__input--desc').value.trim()
                }))
                .filter((e) => e.value);
            const confidence = Number(confInput.value);
            if (evidence.length === 0) {
                errLine.textContent = 'Resolutions are evidence-bound — add at least one evidence entry.';
                return;
            }
            if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
                errLine.textContent = 'Confidence must be a number between 0 and 1.';
                return;
            }
            try {
                const chosen = {
                    outcome: outcomeSel.value,
                    confidence,
                    evidence,
                    notes: notes.value.trim()
                };
                let record = await ResolutionModel.create({
                    predictionCoord: prediction.coordinate,
                    articleHash: prediction.articleHash || null,
                    ...chosen,
                    auditor: prediction.resolverAuditor || null
                });
                // create is idempotent on the coordinate — a SECOND
                // filing returns the FIRST record untouched. Filing
                // again IS the designed revision path (the resolver's
                // own latest-wins), so upsert through update when the
                // returned record differs from what was just entered.
                if (record.outcome !== chosen.outcome
                        || record.confidence !== chosen.confidence
                        || record.notes !== chosen.notes
                        || JSON.stringify(record.evidence) !== JSON.stringify(chosen.evidence)
                        || (!record.article_hash && prediction.articleHash)) {
                    record = await ResolutionModel.update(record.id, {
                        ...chosen,
                        // Backfill the article scope on revision —
                        // pre-13.8 records were filed without it.
                        ...(prediction.articleHash ? { article_hash: prediction.articleHash } : {})
                    });
                }
                close(record);
            } catch (err) {
                errLine.textContent = 'Could not file: ' + (err && err.message);
            }
        });

        document.body.appendChild(host);
        clear(errLine);
    });
}

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
import { Storage } from '../shared/storage.js';
import { Signer } from '../shared/signer.js';
import { ClaimModel } from '../shared/claim-model.js';
import { buildMemberUnits } from '../shared/case-synthesis.js';
import { createGroundingIndex } from '../shared/quote-grounding.js';
import { getArticleExtraction, saveArticleExtraction } from '../shared/audit/audit-cache.js';
import { gatePublish, relayPublishTransport } from '../shared/publish-gate.js';
import { FALLBACK_RELAYS } from './corpus.js';
import { loadFlags, isEnabled } from '../shared/metadata/feature-flags.js';
import {
    assertionClaimCoverage, isTextPinnedKey, markRecordPublished,
    partitionAssertions, setAssertionTriage
} from '../shared/map-artifacts.js';
import {
    buildExtractionAnalysisEvent, claimCoordIndex, hasPublishableAnalysis
} from '../shared/extraction-publish.js';

const now = () => Math.floor(Date.now() / 1000);

async function resolveRelays() {
    try {
        const prefs = await Storage.preferences.get() || {};
        if (Array.isArray(prefs.default_relays) && prefs.default_relays.length) return prefs.default_relays;
    } catch (_) { /* fall through */ }
    return FALLBACK_RELAYS;
}

// What a 30070 discloses, in the words the confirm dialog uses. Kept
// here (not inlined at two call sites) so the per-article and the batch
// path can never describe the same act differently.
const DISCLOSURE_NOTE =
    'Each event publishes the WHOLE extraction unit for ONE article: every grounded quote '
    + 'with its review state (unreviewed / accepted / dismissed), plus what the model '
    + "proposed and why — marked as the model's, never as yours. Accepted atoms reference "
    + 'your published claims by coordinate; nothing restates a claim.\n\n'
    + 'Never published: the article positions, your case name and scope question, and cache '
    + 'fingerprints.';

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
        // ONE section per RECORD, not per capture URL: same-content
        // captures share an article_hash (what foldMemberAliases exists
        // for), and two sections over one store row would let a triage
        // click in one revert the other's (each holding its own stale
        // snapshot of the same record).
        const withRecords = [];
        const seenHash = new Set();
        for (const m of members) {
            if (seenHash.has(m.article_hash)) continue;
            seenHash.add(m.article_hash);
            const rec = await getArticleExtraction(m.article_hash).catch(() => null);
            // A record whose every quote failed grounding stores NO
            // assertions but a nonzero drop count — it must still
            // surface, or the paid pass reads as "never ran" (P6:
            // coverage on its face).
            if (rec && ((rec.assertions || []).length + (rec.sources || []).length
                    + (rec.open_questions || []).length > 0 || (rec.dropped_ungrounded || 0) > 0)) {
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

        // MA.6 — publishing the layer. Flag-gated, and HUMAN-INITIATED
        // per article: no automatic publish anywhere, and the batch path
        // states its exact N before it sends anything.
        let publisher = null;
        try { await loadFlags(); } catch (_) { /* defaults */ }
        if (isEnabled('extractionAnalysisPublishing')) {
            publisher = await buildPublisher(withRecords, block);
        }

        for (const entry of withRecords) {
            block.appendChild(memberSection(entry, { caseId, noteAccepted, publisher }));
        }
    })().catch((err) => {
        Utils.error('Extraction block render failed', err);
        block.remove();
    });
}

/**
 * MA.6 — the publish path, built once per block so the claim-coordinate
 * index (every published claim) is resolved a single time and shared by
 * the per-article buttons and the batch.
 *
 * @returns {Promise<{publish: Function, canPublish: Function}|null>}
 */
async function buildPublisher(withRecords, block) {
    let coordByClaimId = {};
    try {
        coordByClaimId = claimCoordIndex(Object.values(await ClaimModel.getAll() || {}));
    } catch (err) {
        // A missing index is not a reason to refuse: an accepted atom
        // whose claim cannot be resolved publishes as `local-only`,
        // which is the honest reading of "a human ruled, but there is
        // nothing to fetch".
        Utils.error('claim coordinate index failed', err);
    }

    // A `url:<sha16>` record names a URL, not a text — the builder
    // refuses it (its `x` would be a fabricated content hash). Decide
    // that here too, so the surface never offers a button that throws.
    const publishable = withRecords.filter(({ rec }) =>
        isTextPinnedKey(rec.articleHash) && hasPublishableAnalysis(rec, coordByClaimId));
    const refused = withRecords.length - publishable.length;

    const publish = async ({ member, rec }) => {
        const relays = await resolveRelays();
        if (!relays.length) throw new Error('no relays configured — add one in Options');
        const userPubkey = await Signer.getPublicKey();
        if (!userPubkey) throw new Error('no signing identity — set one in Options');
        // Publish the record as it stands in the STORE, never the
        // snapshot this view painted from: a fold may have added atoms
        // since, and the event must not understate what is now known.
        const fresh = await getArticleExtraction(rec.articleHash).catch(() => null) || rec;
        const unsigned = buildExtractionAnalysisEvent({
            record: fresh,
            coordByClaimId,
            articleTitle: member.title || '',
            articleUrl: member.url || ''
            // articleCoord is deliberately omitted: the archive row
            // records THAT an article published but not by which
            // identity (reconcile.js §article ledger), so a coordinate
            // built from the current signer would be a guess — and a
            // dangling `a` pointer is worse than none. The `x` content
            // hash and the `r`/`i` URL anchors cannot be wrong.
        });
        // 29.1: through the publish gate (this answers the MA.6 NB that
        // sat here — the only portal site with a BATCH path, so the gate
        // wraps this loop body, one call per record). Never journaled
        // before, so flag-off is exactly the old send; flag-on gives the
        // signed analysis sign-time durability. The ledger descriptor
        // names the article-extractions record markRecordPublished
        // stamps, keyed by articleHash (eventId comes from the row).
        const signed = await Signer.signEvent({ ...unsigned, pubkey: userPubkey });
        let resp;
        try {
            const gated = await gatePublish({
                signedEvent: signed,
                relays,
                publish: relayPublishTransport(),
                ledger: { model: 'extraction-analysis', localId: fresh.articleHash, extra: null },
                legacyJournalOnSuccess: false
            });
            resp = { ok: true, results: gated.results };
        } catch (err) {
            resp = { ok: false, error: (err && err.message) || null };
        }
        if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'no relays accepted it');
        const stamped = markRecordPublished(fresh, { eventId: signed.id, now: now() });
        await saveArticleExtraction(stamped);
        rec.published_at = stamped.published_at;
        rec.published_event_id = stamped.published_event_id;
        return signed;
    };

    const canPublish = (rec) =>
        isTextPinnedKey(rec.articleHash) && hasPublishableAnalysis(rec, coordByClaimId);

    // The batch. Never the default path — one button, an explicit
    // N-count confirm naming what leaves the machine, and a running
    // count so a partial send is visible rather than assumed complete.
    if (publishable.length > 1) {
        const row = el('div', 'xr-synth__publish');
        const btn = el('button', 'xr-portal__btn xr-portal__btn--ghost',
            `Publish all ${publishable.length} analyses…`);
        btn.type = 'button';
        btn.title = 'Publish the extraction analysis of every article below to your relays (kind 30070)';
        const status = el('span', 'xr-synth__status');
        btn.addEventListener('click', async () => {
            const warn = refused
                ? `\n\n${refused} record${refused === 1 ? '' : 's'} cannot publish (no content hash pins their text, `
                  + 'or they hold nothing publishable) and are skipped.'
                : '';
            if (!confirm(`Publish extraction analyses for ${publishable.length} articles to your relays?`
                + `\n\n${DISCLOSURE_NOTE}${warn}`)) return;
            btn.disabled = true;
            let ok = 0;
            const failures = [];
            for (const entry of publishable) {
                status.textContent = `Publishing ${ok + failures.length + 1}/${publishable.length}…`;
                try { await publish(entry); ok += 1; }
                catch (err) {
                    failures.push(`${truncate(entry.member.title || entry.member.url, 60)}: ${(err && err.message) || 'failed'}`);
                    Utils.error('extraction analysis publish failed', err);
                }
            }
            status.textContent = failures.length
                ? `Published ${ok}/${publishable.length} — ${failures.length} failed (see console).`
                : `Published ${ok} analys${ok === 1 ? 'is' : 'es'}.`;
            btn.disabled = false;
        });
        row.appendChild(btn);
        row.appendChild(status);
        block.appendChild(row);
    }

    return { publish, canPublish };
}

function provChip(a) {
    const fs = a.first_seen || {};
    // MA.4: which pass found this atom. Records written before MA.4
    // carry no producer — those are all corpus-map extracts.
    const producer = fs.producer === 'suggest' ? 'reader suggest' : 'corpus map';
    const bits = [producer, fs.model, fs.promptVersion].filter(Boolean);
    if (fs.at) bits.push(new Date(fs.at * 1000).toISOString().slice(0, 10));
    return el('span', 'xr-synth__prov-row', bits.join(' · '));
}

function memberSection({ member, rec }, { caseId, noteAccepted, publisher = null }) {
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
        paintMember(body, { member, rec, caseId, noteAccepted, publisher, relabel: () => { summary.textContent = label(); } });
    });
    if (parts.open.length === 0) sec.classList.add('xr-extr--settled');
    return sec;
}

function paintMember(body, { member, rec, caseId, noteAccepted, publisher = null, relabel }) {
    const index = createGroundingIndex(member.text);
    const coverage = assertionClaimCoverage(rec, member, index);
    const claimText = {};
    for (const c of member.claims || []) claimText[c.id] = c.text || '';
    const { open, accepted, dismissed } = partitionAssertions(rec);
    const openUncovered = open.filter((a) => !coverage[a.key]);
    const openCovered = open.filter((a) => coverage[a.key]);

    // Triage is a read-modify-write against the STORE, never against
    // the snapshot this section painted from: an analysis pass (or
    // another view) may have folded new assertions into the record
    // since render, and a whole-object put of the stale snapshot would
    // erase them — the opposite of "re-runs only add" (kickoff guard
    // rail 1). Re-reading also means the atom being triaged is matched
    // by key against current state, so a fold that renumbered nothing
    // (keys are span-derived) stays consistent.
    const persistTriage = async (key, status, claimId = null) => {
        const fresh = await getArticleExtraction(member.article_hash).catch(() => null) || rec;
        const updated = setAssertionTriage(fresh, key, status, { claimId, now: now() });
        await saveArticleExtraction(updated);
        // Keep the painted snapshot's triage view in step (labels read
        // from `rec`); newly folded atoms appear on the next Refresh.
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
        // suggest pass's authored claim text when there is one (MA.4:
        // that paraphrase is what the suggest pass adds over the map),
        // else the article's own span. Editable before Accept; the
        // quote is kept verbatim as the evidence anchor regardless.
        const input = el('input', 'xr-hyp__input xr-extr__text');
        input.type = 'text';
        input.value = a.text || a.quote;
        input.title = a.text
            ? 'The claim text to mint — suggested by the extraction pass; edit freely. The verbatim quote stays attached as evidence.'
            : 'The claim text to mint — edit freely; the verbatim quote stays attached as evidence';
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

    // MA.6 — publish THIS article's analysis. Last in the section: the
    // queue is what you review, publishing is what you decide to do
    // about it. Absent entirely unless the flag is on and this record
    // can actually publish.
    if (publisher && publisher.canPublish(rec)) {
        const row = el('div', 'xr-synth__publish');
        const btn = el('button', 'xr-portal__btn xr-portal__btn--ghost',
            rec.published_at ? 'Republish analysis…' : 'Publish analysis…');
        btn.type = 'button';
        btn.title = 'Publish this article’s extraction analysis to your relays (kind 30070, replaceable)';
        const status = el('span', 'xr-synth__status');
        if (rec.published_at) {
            status.textContent = `published ${new Date(rec.published_at * 1000).toISOString().slice(0, 10)}`;
        }
        btn.addEventListener('click', async () => {
            if (!confirm(`Publish the extraction analysis of “${truncate(member.title || member.url, 70)}”?`
                + `\n\n${DISCLOSURE_NOTE}`)) return;
            btn.disabled = true;
            status.textContent = 'Publishing…';
            try {
                await publisher.publish({ member, rec });
                status.textContent = `published ${new Date(rec.published_at * 1000).toISOString().slice(0, 10)}`;
                btn.textContent = 'Republish analysis…';
            } catch (err) {
                Utils.error('extraction analysis publish failed', err);
                status.textContent = `Publish failed: ${(err && err.message) || 'unknown error'}`;
            } finally {
                btn.disabled = false;
            }
        });
        row.appendChild(btn);
        row.appendChild(status);
        body.appendChild(row);
    }
}

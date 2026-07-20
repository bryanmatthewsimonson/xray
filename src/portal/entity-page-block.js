// Entity-page block — EP.3/EP.4/EP.5 (docs/ENTITY_PAGE_KICKOFF.md).
// The portal dossier surface that generates, reviews, and publishes
// the grounded entity page. Gated like the case synthesis it reuses:
// `caseSynthesis` + `llmAssist` + key (via xray:llm:corpus-config) for
// GENERATION; `entityCorpusPublishing` + relays for PUBLISH. Nothing
// persists as the page without the human's explicit action, and the
// published artifact is USER-signed (kickoff §3 rail 6 — entity keys
// never sign judgment-carrying syntheses).
//
// The map stage rides ensureExtracts with the ACTIVE CASE's frame when
// the workspace is case-bound — byte-identical cache keys, so a page
// for anyone inside a worked case usually costs one reduce call (the
// spend confirm discloses the exact split before anything runs).

import { el, clear } from './dom.js';
import { Utils } from '../shared/utils.js';
import { loadFlags, isEnabled } from '../shared/metadata/feature-flags.js';
import { collectEntityDossierData, buildEntityDossier } from '../shared/entity-dossier.js';
import { buildMemberUnits, corpusMapRequest, corpusExtractKey, validateCorpusExtract } from '../shared/case-synthesis.js';
import {
    ENTITY_PAGE_PROMPT_VERSION,
    digestEntityDossier, validateEntityPage, filterKeyClaimIds, groundEntityPage,
    entityPageInputHash, ensureExtracts
} from '../shared/entity-page.js';
import { buildEntityPageArticle } from '../shared/entity-page-publish.js';
import { getEntityPage, saveEntityPage, getCorpusExtract } from '../shared/audit/audit-cache.js';
import { createGroundingIndex } from '../shared/quote-grounding.js';
import { resolveActiveCaseRef } from '../shared/case-membership.js';
import { Signer } from '../shared/signer.js';
import { Storage } from '../shared/storage.js';
import { EntityModel } from '../shared/entity-model.js';
import { ClaimModel } from '../shared/claim-model.js';
import { FALLBACK_RELAYS } from './corpus.js';

function sendMessage(msg) {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage(msg, (resp) => {
                if (chrome.runtime.lastError) { resolve(null); return; }
                resolve(resp);
            });
        } catch (_) { resolve(null); }
    });
}

async function resolveRelays() {
    try {
        const prefs = await Storage.preferences.get() || {};
        if (Array.isArray(prefs.default_relays) && prefs.default_relays.length) return prefs.default_relays;
    } catch (_) { /* fall through */ }
    return FALLBACK_RELAYS;
}

/**
 * Mount the entity-page block onto the dossier view.
 *
 * @param {HTMLElement} host
 * @param {object} opts
 * @param {string} opts.entityId   the dossier subject's canonical id
 */
export function mountEntityPageBlock(host, { entityId } = {}) {
    const block = el('div', 'xr-dossier__block xr-epage');
    host.appendChild(block);
    render();

    async function render() {
        clear(block);
        block.appendChild(el('h3', 'xr-case__heading', 'Entity page'));

        const cfg = await sendMessage({ type: 'xray:llm:corpus-config' });
        const record = await getEntityPage(entityId).catch(() => null);

        if (!record && (!cfg || !cfg.enabled)) {
            block.appendChild(el('p', 'xr-epage__hint',
                'A grounded, claims-first page about this subject, synthesized from its captured corpus. '
                + 'Enable Case synthesis + LLM assist in Options → Advanced to generate one.'));
            return;
        }

        const actions = el('div', 'xr-epage__actions');
        block.appendChild(actions);
        const status = el('div', 'xr-epage__status');
        block.appendChild(status);
        const body = el('div', 'xr-epage__body');
        block.appendChild(body);

        if (cfg && cfg.enabled) {
            const genBtn = el('button', 'xr-portal__btn', record ? 'Regenerate page…' : 'Generate page…');
            genBtn.type = 'button';
            if (!cfg.hasKey) {
                genBtn.disabled = true;
                genBtn.title = 'Set an Anthropic API key in Options → Advanced → LLM assist';
            }
            genBtn.addEventListener('click', () => generate(genBtn, status).catch((err) => {
                Utils.error('entity page generate failed', err);
                status.textContent = `Generate failed: ${(err && err.message) || 'unknown error'}`;
            }));
            actions.appendChild(genBtn);
        }

        if (record) await renderStored(record, body, actions, status);
    }

    // ---- EP.2 run: plan → confirm → map (cache-first) → reduce → ground → save
    async function generate(btn, status) {
        btn.disabled = true;
        status.textContent = 'Planning…';
        try {
            const data = await collectEntityDossierData(entityId);
            const dossier = buildEntityDossier(data, Math.floor(Date.now() / 1000));
            const members = await buildMemberUnits(data);
            if (members.length === 0) {
                status.textContent = 'No archive-backed articles mention this subject yet — capture some first.';
                btn.disabled = false;
                return;
            }

            // The active case's frame — byte-identical cache keys with
            // Analyze / Pre-analyze in a case-bound workspace (§3 rail 5).
            const binding = await resolveActiveCaseRef().catch(() => null);
            const frame = {
                caseName: (binding && binding.caseName) || '',
                scopeQuestion: (binding && binding.scopeQuestion) || ''
            };

            // Spend disclosure BEFORE anything runs: exact hit/miss split.
            let misses = 0;
            for (const m of members) {
                const key = await corpusExtractKey(corpusMapRequest(m, frame));
                const hit = await getCorpusExtract(key).catch(() => null);
                if (!(hit && hit.extract && validateCorpusExtract(hit.extract).ok)) misses++;
            }
            if (!confirm(`Generate an entity page for “${dossier.subject.name}”?\n\n`
                + `${members.length} member article${members.length === 1 ? '' : 's'}: `
                + `${members.length - misses} already analyzed (free), ${misses} need an analysis call, `
                + `plus 1 page-synthesis call to Anthropic.`)) {
                btn.disabled = false;
                status.textContent = '';
                return;
            }

            status.textContent = `Analyzing members (0/${members.length})…`;
            const { extracts, failures } = await ensureExtracts(members, frame, {
                sendMessage,
                onProgress: (p) => {
                    if (p.phase === 'done' || p.phase === 'failed') {
                        status.textContent = `Analyzing members (${p.okCount}/${p.total})…`;
                    }
                }
            });
            if (extracts.length === 0) {
                status.textContent = `Analysis failed for every member${failures.length ? ` (${failures[0].error})` : ''}.`;
                btn.disabled = false;
                return;
            }

            status.textContent = 'Writing the page…';
            const claims = data.orbit.claims || [];
            const entityDigest = digestEntityDossier(dossier, {
                claims, namesById: data.entityNamesById || {}
            });
            const res = await sendMessage({ type: 'xray:llm:entity-page', request: {
                entityDigest, extracts,
                entityName: dossier.subject.name, entityType: dossier.subject.type,
                caseName: frame.caseName, scopeQuestion: frame.scopeQuestion
            } });
            if (!res || !res.ok) throw new Error((res && res.error) || 'page synthesis failed');
            const v = validateEntityPage(res.pageInput);
            if (!v.ok) throw new Error(`invalid page: ${v.errors[0] || 'schema mismatch'}`);

            // Reference hygiene + grounding (kickoff §3 rails 3–4).
            const page = filterKeyClaimIds(res.pageInput, new Set(claims.map((c) => c.id)));
            const indexByMember = {};
            for (const m of members) indexByMember[m.article_hash] = createGroundingIndex(m.text);
            const { page: grounded, grounding } = groundEntityPage(page, indexByMember);

            const record = {
                entityId,
                page: grounded,
                grounding,
                model: res.model || null,
                promptVersion: ENTITY_PAGE_PROMPT_VERSION,
                inputHash: await entityPageInputHash(members, claims.map((c) => c.id)),
                members: members.length,
                analyzed: extracts.length,
                createdAt: Math.floor(Date.now() / 1000)
            };
            await saveEntityPage(record);
            status.textContent = '';
            await render();
        } catch (err) {
            btn.disabled = false;
            throw err;
        }
    }

    // ---- EP.3/EP.5 render + review; EP.4 publish
    async function renderStored(record, body, actions, status) {
        const page = record.page || {};
        const g = record.grounding || { checked: 0, dropped: 0 };

        // Staleness (EP.5): live inputs vs the stored fingerprint.
        let stale = false;
        try {
            const data = await collectEntityDossierData(entityId);
            const members = await buildMemberUnits(data);
            const live = await entityPageInputHash(members, (data.orbit.claims || []).map((c) => c.id));
            stale = record.inputHash && record.inputHash !== live;
        } catch (_) { /* staleness is best-effort */ }

        const prov = el('div', 'xr-epage__prov',
            `${record.model || 'model'} · ${record.promptVersion || ''} · `
            + `${g.checked} quote${g.checked === 1 ? '' : 's'} checked, ${g.dropped} dropped · `
            + `${record.analyzed}/${record.members} member${record.members === 1 ? '' : 's'} analyzed`);
        if (stale) prov.appendChild(el('span', 'xr-badge xr-badge--warn', 'stale — the corpus changed since this page'));
        if (record.edited) prov.appendChild(el('span', 'xr-badge xr-badge--muted', 'edited'));
        body.appendChild(prov);

        if (page.lead) body.appendChild(el('p', 'xr-epage__lead', page.lead));

        // Key facts (EP.3): the curated claims box. Checkboxes persist
        // the human's selection on the record — unchecked entries stay
        // out of the render and the publish.
        const keyIds = page.key_claim_ids || [];
        if (keyIds.length > 0) {
            const claimsById = await ClaimModel.getAll();
            const box = el('div', 'xr-epage__facts');
            box.appendChild(el('h4', 'xr-epage__subhead', 'Key facts — each entry is a claim; the quote is its verification'));
            const selected = new Set(record.keySelection || keyIds);
            for (const id of keyIds) {
                const c = claimsById[id];
                if (!c) continue;
                const row = el('label', 'xr-epage__fact');
                const cb = el('input');
                cb.type = 'checkbox';
                cb.checked = selected.has(id);
                cb.addEventListener('change', async () => {
                    if (cb.checked) selected.add(id); else selected.delete(id);
                    await saveEntityPage({ ...record, keySelection: [...selected] });
                });
                row.appendChild(cb);
                const span = el('span', '', `${c.text}`);
                if (c.quote) span.title = `“${c.quote}”`;
                row.appendChild(span);
                box.appendChild(row);
            }
            body.appendChild(box);
        }

        // Sections (EP.3): editable body, removable, uncited badged.
        (page.sections || []).forEach((s, i) => {
            const sec = el('div', 'xr-epage__section');
            const head = el('div', 'xr-epage__sec-head');
            head.appendChild(el('strong', '', s.heading));
            if (s.uncited) {
                const badge = el('span', 'xr-badge xr-badge--warn', 'uncited');
                badge.title = 'No verbatim citation survived grounding — review before publishing';
                head.appendChild(badge);
            }
            const editBtn = el('button', 'xr-portal__btn xr-portal__btn--ghost', '✎');
            editBtn.type = 'button';
            editBtn.title = 'Edit this section';
            const dropBtn = el('button', 'xr-portal__btn xr-portal__btn--ghost', '✕');
            dropBtn.type = 'button';
            dropBtn.title = 'Remove this section';
            head.appendChild(editBtn);
            head.appendChild(dropBtn);
            sec.appendChild(head);
            const bodyP = el('p', 'xr-epage__sec-body', s.body);
            sec.appendChild(bodyP);
            for (const c of s.citations || []) {
                const q = el('blockquote', 'xr-epage__quote', `“${c.quote}”`);
                q.title = c.article_hash;
                sec.appendChild(q);
            }
            editBtn.addEventListener('click', async () => {
                if (sec.querySelector('textarea')) return;
                const ta = el('textarea', 'xr-epage__edit');
                ta.value = s.body;
                ta.rows = 5;
                const save = el('button', 'xr-portal__btn', 'Save section');
                save.type = 'button';
                save.addEventListener('click', async () => {
                    const sections = page.sections.slice();
                    sections[i] = { ...s, body: ta.value.trim() || s.body };
                    await saveEntityPage({ ...record, page: { ...page, sections }, edited: true });
                    await render();
                });
                bodyP.replaceWith(ta);
                sec.insertBefore(save, ta.nextSibling);
            });
            dropBtn.addEventListener('click', async () => {
                if (!confirm(`Remove the “${s.heading}” section?`)) return;
                const sections = page.sections.filter((_, j) => j !== i);
                await saveEntityPage({ ...record, page: { ...page, sections }, edited: true });
                await render();
            });
            body.appendChild(sec);
        });

        // Disputes + gaps — read-only renders.
        for (const d of page.disputes || []) {
            const disp = el('div', 'xr-epage__dispute');
            disp.appendChild(el('strong', '', `Disputed: ${d.topic}`));
            for (const side of d.sides || []) {
                const row = el('div', 'xr-epage__side', `· ${side.view}`);
                if (side.quote) row.title = `“${side.quote}”`;
                disp.appendChild(row);
            }
            body.appendChild(disp);
        }
        if ((page.gaps || []).length > 0) {
            const gaps = el('div', 'xr-epage__gaps');
            gaps.appendChild(el('strong', '', 'Not established by this corpus:'));
            for (const gap of page.gaps) gaps.appendChild(el('div', 'xr-epage__gap', `· ${gap}`));
            body.appendChild(gaps);
        }

        // Publish (EP.4) — user-signed replaceable 30023.
        try { await loadFlags(); } catch (_) { /* defaults */ }
        if (isEnabled('entityCorpusPublishing')) {
            const pubBtn = el('button', 'xr-portal__btn', record.publishedEventId ? 'Republish page' : 'Publish page');
            pubBtn.type = 'button';
            pubBtn.title = 'Publish as a replaceable kind-30023 article, signed by YOUR identity (the page is your synthesis)';
            pubBtn.addEventListener('click', () => publish(record, pubBtn, status).catch((err) => {
                Utils.error('entity page publish failed', err);
                status.textContent = `Publish failed: ${(err && err.message) || 'unknown error'}`;
                pubBtn.disabled = false;
            }));
            actions.appendChild(pubBtn);
            if (record.publishedAt) {
                actions.appendChild(el('span', 'xr-epage__pubstamp',
                    `published ${new Date(record.publishedAt * 1000).toISOString().slice(0, 10)}`));
            }
        }
    }

    async function publish(record, btn, status) {
        btn.disabled = true;
        status.textContent = 'Publishing…';
        const relays = await resolveRelays();
        if (!relays.length) { status.textContent = 'No relays configured.'; btn.disabled = false; return; }
        const userPubkey = await Signer.getPublicKey();
        if (!userPubkey) { status.textContent = 'No signing identity — set one in Options.'; btn.disabled = false; return; }

        const full = await EntityModel.get(entityId).catch(() => null);
        if (!full) { status.textContent = 'Subject entity not found.'; btn.disabled = false; return; }
        const subjectPk = (full.keypair && full.keypair.pubkey) || full.foreign_pubkey || null;

        // The CURRENT key-fact selection resolves to claim records.
        const claimsById = await ClaimModel.getAll();
        const selected = new Set(record.keySelection || record.page.key_claim_ids || []);
        const keyClaims = [...selected].map((id) => claimsById[id]).filter(Boolean)
            .map((c) => ({ id: c.id, text: c.text, quote: c.quote || null, source_url: c.source_url || null,
                           publishedEventId: c.publishedEventId || null, publishedPubkey: c.publishedPubkey || null }));

        const unsigned = buildEntityPageArticle({
            record, entity: { id: entityId, name: full.name || '' },
            entityPubkey: subjectPk, keyClaims, userPubkey
        });
        const signed = await Signer.signEvent({ ...unsigned, pubkey: userPubkey });
        const resp = await sendMessage({ type: 'xray:relay:publish', event: signed, relays });
        if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'no relays accepted');
        await saveEntityPage({ ...record, publishedAt: Math.floor(Date.now() / 1000), publishedEventId: signed.id });
        status.textContent = 'Published — readable in any NOSTR client.';
        btn.disabled = false;
        await render();
    }
}

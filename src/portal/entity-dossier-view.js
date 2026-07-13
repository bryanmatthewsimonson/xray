// Entity dossier view — Phase 19.4 (docs/ENTITY_DOSSIER_DESIGN.md §5).
// The full-page dossier: identity, the typed field table
// (unknown-by-default, contested side-by-side), content timeline,
// judgment distributions, relationships. A thin projection of the pure
// `assembleEntityDossier` — all logic lives in entity-dossier.js; this
// file only paints. Every field value click-throughs to its evidence
// (quote + source + article hash): the §5 provenance contract.
//
// Firewall note (§3.5): the judgments block routes to
// renderIntegrityBlock (the coverage-capped record) and paints
// DISTRIBUTIONS — no score, no person-grade, nothing fused.

import { el, clear } from './dom.js';
import { assembleEntityDossier } from '../shared/entity-dossier.js';
import { renderIntegrityBlock } from './integrity-block.js';
import { Utils } from '../shared/utils.js';
import { loadFlags, isEnabled } from '../shared/metadata/feature-flags.js';
import { EntityModel } from '../shared/entity-model.js';
import { LocalKeyManager } from '../shared/local-key-manager.js';
import { EventBuilder } from '../shared/event-builder.js';
import { buildProfileAbout, buildFactSheetEvent, profileAboutHash, factSheetContentHash } from '../shared/entity-profile.js';

function fmtDate(unixSec) {
    if (!unixSec) return '';
    return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url || ''; }
}

// The validity phrase a ValueGroup renders under — honest bands only.
function validityPhrase(group) {
    const from = group.valid_from !== null ? bandText(group.valid_from, group.valid_from_precision) : null;
    const to   = group.valid_to   !== null ? bandText(group.valid_to, group.valid_to_precision) : null;
    if (from && to) return `${from} – ${to}`;
    if (from) return `${from} –`;
    if (to) return `until ${to}`;
    return '';
}

function bandText(at, precision) {
    const iso = new Date(at * 1000).toISOString();
    switch (precision) {
        case 'year':  return iso.slice(0, 4);
        case 'month': return iso.slice(0, 7);
        case 'day':   return iso.slice(0, 10);
        default:      return iso.slice(0, 10);
    }
}

export function renderEntityDossierView(host, params) {
    const { entityId, callbacks } = params;
    clear(host);

    // Skeleton first (the router's render() is synchronous); fill when
    // the assembler resolves; the caller guards stale view-state.
    const head = el('div', 'xr-view__head');
    const back = el('button', 'xr-portal__btn xr-portal__btn--ghost', '← Library');
    back.type = 'button';
    back.addEventListener('click', () => callbacks.onBack());
    head.appendChild(back);
    head.appendChild(el('span', 'xr-view__title', 'Dossier'));
    host.appendChild(head);
    const bodyHost = el('div', 'xr-dossier');
    host.appendChild(bodyHost);
    bodyHost.appendChild(el('p', 'xr-view__empty', 'Assembling dossier…'));

    (async () => {
        const dossier = await assembleEntityDossier(entityId);
        clear(bodyHost);

        // --- header identity line ---
        head.querySelector('.xr-view__title').textContent = dossier.subject.name;
        head.appendChild(el('span', 'xr-badge', dossier.subject.type));
        if (dossier.subject.foreign) head.appendChild(el('span', 'xr-badge xr-badge--muted', 'foreign'));
        head.appendChild(el('span', 'xr-view__counts',
            `${dossier.coverage.claims} claim(s) · ${dossier.coverage.articles} article(s) · `
            + `${dossier.coverage.fields_known}/${dossier.coverage.fields_total} fields known`
            + (dossier.coverage.fields_contested ? ` · ${dossier.coverage.fields_contested} contested` : '')));

        renderIdentityBlock(bodyHost, dossier);
        renderFieldsBlock(bodyHost, dossier, callbacks);
        renderRelationshipsBlock(bodyHost, dossier, callbacks);
        renderJudgmentsBlock(bodyHost, dossier);
        renderContentBlock(bodyHost, dossier);
        // 19.7: manual republish, flag-gated at the CALL SITE (the
        // house split — builders stay ungated). Force-publishes both
        // wire surfaces regardless of the hash gate; entity-signed.
        await mountRepublishButton(head, dossier, params.relays || []);
    })().catch((err) => {
        Utils.error('Entity dossier render failed', err);
        clear(bodyHost);
        bodyHost.appendChild(el('p', 'xr-view__empty', 'Dossier failed to assemble — see console.'));
    });
}

// --- 19.7 manual republish ---------------------------------------------

async function mountRepublishButton(head, dossier, relays) {
    try { await loadFlags(); } catch (_) { return; }
    if (!isEnabled('entityCorpusPublishing')) return;
    if (dossier.subject.foreign || !relays.length) return;
    const entity = await EntityModel.get(dossier.subject.id).catch(() => null);
    if (!entity || !entity.keypair || !entity.keypair.privateKey) return;

    const btn = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Republish profile');
    btn.type = 'button';
    btn.title = 'Re-emit this entity\'s kind-0 profile and kind-30067 fact sheet (entity-signed, public)';
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Publishing…';
        try {
            await LocalKeyManager.init();
            const excluded = entity.publish_excluded_fields || [];
            const now = Math.floor(Date.now() / 1000);
            const entities = await EntityModel.getAll();
            const about = buildProfileAbout(dossier, { excludedFields: excluded });
            const sheet = buildFactSheetEvent(dossier, {
                entityPubkey: entity.keypair.pubkey,
                publisherPubkey: entity.keypair.pubkey,   // fallback only — coords carry each claim's real publisher
                generatedAt: now, excludedFields: excluded, entities
            });
            const stamps = {};
            const publish = async (unsigned) => {
                const signed = await LocalKeyManager.signEvent(unsigned, entity.keyName);
                const resp = await chrome.runtime.sendMessage({ type: 'xray:relay:publish', event: signed, relays });
                if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'publish failed');
                return signed;
            };
            const signedProfile = await publish(EventBuilder.buildProfileEvent(entity, null, about));
            stamps.profileEventId = signedProfile.id;
            stamps.profileHash = await profileAboutHash(about);
            if (sheet.tags.some((t) => t[0] === 'fact')) {
                const signedSheet = await publish(sheet);
                stamps.factSheetEventId = signedSheet.id;
                stamps.factSheetHash = await factSheetContentHash(sheet);
            }
            await EntityModel.markProfilePublished(entity.id, stamps);
            btn.textContent = 'Republished ✓';
        } catch (err) {
            Utils.error('Republish failed', err);
            btn.textContent = 'Republish failed — see console';
            btn.disabled = false;
        }
    });
    head.appendChild(btn);
}

// --- §5.1 identity ----------------------------------------------------

function renderIdentityBlock(host, dossier) {
    const block = el('div', 'xr-dossier__block');
    block.appendChild(el('h3', 'xr-case__heading', 'Identity'));
    if (dossier.subject.description) {
        block.appendChild(el('p', 'xr-dossier__desc', dossier.subject.description));
    }
    const family = dossier.identity.family;
    if (family.length > 1) {
        const row = el('div', 'xr-case__dist');
        for (const member of family) {
            row.appendChild(el('span',
                member.relation === 'self' ? 'xr-badge' : 'xr-badge xr-badge--muted',
                `${member.name}${member.relation === 'self' ? '' : ` (${member.relation})`}`));
        }
        block.appendChild(row);
    }
    if (dossier.identity.accounts.length > 0) {
        const row = el('div', 'xr-case__dist');
        for (const a of dossier.identity.accounts) {
            row.appendChild(el('span', 'xr-badge xr-badge--muted', `${a.platform}: ${a.handle || a.display_name}`));
        }
        block.appendChild(row);
    }
    if (dossier.subject.npub) {
        block.appendChild(el('div', 'xr-view__dossier-line', `npub: ${dossier.subject.npub}`));
    }
    host.appendChild(block);
}

// --- §5.2 fields — unknown-by-default, contested side-by-side ---------

function renderFieldsBlock(host, dossier, callbacks) {
    const block = el('div', 'xr-dossier__block');
    block.appendChild(el('h3', 'xr-case__heading', 'Fields — every value cites its source'));

    const table = el('div', 'xr-dossier__fields');
    for (const row of dossier.fields) {
        const rowEl = el('div', `xr-dossier__field xr-dossier__field--${row.status}`);
        const label = el('div', 'xr-dossier__field-label');
        label.appendChild(el('span', '', row.label));
        if (row.status === 'contested') label.appendChild(el('span', 'xr-badge xr-badge--warn', 'contested'));
        if (row.provenance === 'authored') label.appendChild(el('span', 'xr-badge xr-badge--muted', 'your framing'));
        rowEl.appendChild(label);

        const valueCol = el('div', 'xr-dossier__field-values');
        if (row.status === 'unknown') {
            valueCol.appendChild(el('span', 'xr-dossier__unknown', 'unknown — no captured source'));
        }
        if (row.authored) {
            valueCol.appendChild(el('span', 'xr-dossier__value', row.authored.value));
        }
        for (const group of row.current) {
            valueCol.appendChild(valueChip(group, row, callbacks));
        }
        if (row.history.length > 0) {
            const hist = el('div', 'xr-dossier__history');
            for (const group of row.history) {
                hist.appendChild(valueChip(group, row, callbacks));
            }
            valueCol.appendChild(hist);
        }
        rowEl.appendChild(valueCol);
        table.appendChild(rowEl);
    }
    block.appendChild(table);
    host.appendChild(block);
}

// One value chip; click opens the evidence popover (quote, source
// host, capture date, hash chip — the §5 click-through contract).
function valueChip(group, row, callbacks) {
    const wrap = el('span', 'xr-dossier__value-wrap');
    const chip = el('button', 'xr-dossier__value', group.value);
    chip.type = 'button';
    const validity = validityPhrase(group);
    if (validity) wrap.appendChild(el('span', 'xr-dossier__validity', ` ${validity} `));
    chip.title = `${group.evidence.length} source(s) — click for evidence`;
    chip.addEventListener('click', () => toggleEvidence(wrap, group, callbacks));
    wrap.prepend(chip);
    return wrap;
}

function toggleEvidence(wrap, group, callbacks) {
    const existing = wrap.querySelector('.xr-dossier__evidence');
    if (existing) { existing.remove(); return; }
    const pop = el('div', 'xr-dossier__evidence');
    for (const ev of group.evidence) {
        const item = el('div', 'xr-dossier__evidence-item');
        if (ev.quote) item.appendChild(el('blockquote', 'xr-dossier__quote', `“${ev.quote}”`));
        const meta = el('div', 'xr-dossier__evidence-meta');
        const src = el('a', 'xr-dossier__evidence-src', hostOf(ev.source_url));
        if (ev.source_url) { src.href = ev.source_url; src.target = '_blank'; src.rel = 'noreferrer'; }
        meta.appendChild(src);
        if (ev.captured_at) meta.appendChild(el('span', '', ` · captured ${fmtDate(ev.captured_at)}`));
        if (ev.article_hash) {
            const hash = el('span', 'xr-inspector__mono', ` · ${ev.article_hash.slice(0, 8)}…`);
            hash.title = ev.article_hash;
            meta.appendChild(hash);
        }
        if (ev.suggested_by && ev.suggested_by !== 'user') {
            meta.appendChild(el('span', 'xr-badge xr-badge--muted', ev.suggested_by));
        }
        if (ev.published_event_id) meta.appendChild(el('span', 'xr-badge xr-badge--muted', 'published'));
        item.appendChild(meta);
        pop.appendChild(item);
    }
    wrap.appendChild(pop);
}

// --- §5.5 relationships ------------------------------------------------

function renderRelationshipsBlock(host, dossier, callbacks) {
    const { co_tagged, field_edges } = dossier.relationships;
    if (co_tagged.length === 0 && field_edges.length === 0) return;
    const block = el('div', 'xr-dossier__block');
    block.appendChild(el('h3', 'xr-case__heading', 'Relationships'));

    for (const edge of field_edges) {
        const line = el('div', 'xr-view__dossier-line');
        line.appendChild(el('span', '',
            edge.direction === 'out'
                ? `${edge.field} → ${edge.value}`
                : `← ${edge.field} of ${edge.value ? edge.value : edge.from_entity_id}`));
        const openBtn = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'dossier →');
        openBtn.type = 'button';
        const target = edge.direction === 'out' ? edge.to_entity_id : edge.from_entity_id;
        openBtn.addEventListener('click', () => callbacks.onOpenEntityDossier
            && callbacks.onOpenEntityDossier(target));
        line.appendChild(openBtn);
        block.appendChild(line);
    }
    if (co_tagged.length > 0) {
        const row = el('div', 'xr-case__dist');
        for (const co of co_tagged.slice(0, 12)) {
            row.appendChild(el('span', 'xr-badge xr-badge--muted',
                `${co.entity_id.slice(0, 14)}… · ${co.shared_claims} shared`));
        }
        block.appendChild(row);
    }
    host.appendChild(block);
}

// --- §5.4 judgments — distributions + the routed record ---------------

function renderJudgmentsBlock(host, dossier) {
    const j = dossier.judgments;
    const hasAny = j.assessments.total > 0 || j.verdicts.length > 0 || j.forensic.length > 0;
    const block = el('div', 'xr-dossier__block');
    if (hasAny) {
        block.appendChild(el('h3', 'xr-case__heading', 'Judgments — distributions, never a score'));
        if (j.assessments.total > 0) {
            const row = el('div', 'xr-case__dist');
            for (const [stance, n] of Object.entries(j.assessments.by_stance)) {
                row.appendChild(el('span', 'xr-badge xr-badge--muted', `stance ${stance}: ${n}`));
            }
            block.appendChild(row);
        }
        for (const v of j.verdicts) {
            const states = (v.variance && v.variance.states_present) || [];
            const phrase = states.length === 0 ? 'unadjudicated'
                : states.map((s) => `${s}: ${v.variance.by_state[s]}`).join(' · ');
            block.appendChild(el('div', 'xr-view__dossier-line',
                `${(v.proposition || '').slice(0, 80)} — ${phrase}`));
        }
        if (j.forensic.length > 0) {
            const row = el('div', 'xr-case__dist');
            for (const f of j.forensic.slice(0, 8)) {
                row.appendChild(el('span', 'xr-badge xr-badge--muted',
                    `${f.maneuver || f.role || 'finding'} (${f.matched_via})`));
            }
            block.appendChild(row);
        }
        host.appendChild(block);
    }
    // The §3.5 route: the coverage-capped integrity record renders via
    // its own block, computed from local models — never re-derived here.
    renderIntegrityBlock(host, j.integrity_record_ref);
}

// --- §5.3 content -------------------------------------------------------

function renderContentBlock(host, dossier) {
    const { articles, unprocessed } = dossier.content;
    if (articles.length === 0 && unprocessed.length === 0) return;
    const block = el('div', 'xr-dossier__block');
    block.appendChild(el('h3', 'xr-case__heading', 'Captured content'));
    for (const row of articles) {
        const line = el('div', 'xr-view__dossier-line');
        line.appendChild(el('span', '', `${row.title || hostOf(row.url)} · ${row.claims.length} claim(s)`
            + (row.published ? ` · ${bandText(row.published.at, row.published.precision)}` : '')));
        block.appendChild(line);
    }
    if (unprocessed.length > 0) {
        block.appendChild(el('div', 'xr-view__dossier-line',
            `Unprocessed sources: ${unprocessed.length} tagged article(s) with no claims yet`));
    }
    host.appendChild(block);
}

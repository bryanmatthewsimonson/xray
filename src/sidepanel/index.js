// X-Ray side panel — entity browser (Phase 4 C3, issue #15).
//
// Single-column drill-down:
//   - List view: type-filter chips, search, entity list with a
//     published-indicator and alias-chevron. Footer shows count +
//     export/import.
//   - Detail view: editable name / description / nip05, type (shown
//     but immutable — changing it would re-derive the id), canonical
//     link picker, npub (copy), nsec (reveal+copy), publish status,
//     delete button.
//
// The panel lives at `chrome.sidePanel.default_path` and is opened
// either via Chrome's sidepanel button or programmatically. It reads
// directly from Storage / LocalKeyManager; no relay access from this
// surface yet (kind-0 publishing lives in the reader's publish flow —
// see reader/index.js `resolveEntitiesToPublish`).

import { EntityModel, ENTITY_TYPES, ENTITY_ICONS, installEntityStorageBridge } from '../shared/entity-model.js';
import { parseClaimEvent, ClaimModel } from '../shared/claim-model.js';
import { EvidenceLinker, EVIDENCE_RELATIONSHIP_ICONS } from '../shared/evidence-linker.js';
import { openAssessModal, renderAssessmentBadges, assessmentsByCanonicalRef } from '../shared/assess-modal.js';
import { makeClaimRefCanonicalizer, isLocalClaimId, buildClaimCoord } from '../shared/claim-ref.js';
import { collectCaseData, buildCaseJson, buildCaseMarkdown } from '../shared/case-export.js';
import { accountsForEntity, listUnlinkedAccounts, linkAccountToEntity, unlinkAccount } from '../shared/identity/account-registry.js';
import { LocalKeyManager } from '../shared/local-key-manager.js';
import { Crypto } from '../shared/crypto.js';
import { pushEntities, pullEntities, clearRemote, pushRelayList, pullRelayList, normalizeRelayUrl } from '../shared/entity-sync.js';

// Reserved key name in LocalKeyManager for the user's primary
// identity. Used only by the sync flow — article publishing still
// routes through NIP-07.
const USER_KEY_NAME = 'xray:user';

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------

const state = {
    view:          'list',     // 'list' | 'detail'
    typeFilter:    '',         // '' | 'person' | 'organization' | 'place' | 'thing' | 'case'
    searchQuery:   '',
    selectedId:    null,
    entities:      {},         // cached getAll() result
    // draft holds unsaved edits for the detail view so we don't mutate
    // the underlying record until the user hits Save.
    draft:         null
};

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

const $ = (sel, root = document) => root.querySelector(sel);

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function toast(message, type = 'success', timeoutMs = 3200) {
    const el = $('#xr-toast');
    el.textContent = message;
    el.className = 'xr-side__toast xr-side__toast--' + type;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, timeoutMs);
}

function fmtRelative(unixSec) {
    if (!unixSec) return '';
    const diffSec = Math.floor(Date.now() / 1000) - unixSec;
    if (diffSec < 60)      return 'just now';
    if (diffSec < 3600)    return Math.floor(diffSec / 60)   + 'm ago';
    if (diffSec < 86400)   return Math.floor(diffSec / 3600) + 'h ago';
    if (diffSec < 2592000) return Math.floor(diffSec / 86400) + 'd ago';
    return new Date(unixSec * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        toast('Copied to clipboard', 'success', 1500);
    } catch (_) {
        toast('Clipboard blocked — select and ⌘C', 'warning', 3000);
    }
}

// ------------------------------------------------------------------
// Data loading
// ------------------------------------------------------------------

async function refreshEntities() {
    state.entities = await EntityModel.getAll();
}

function filteredEntities() {
    const q = state.searchQuery.trim().toLowerCase();
    const type = state.typeFilter;
    const out = [];
    for (const entity of Object.values(state.entities)) {
        if (type && entity.type !== type) continue;
        if (q && !entity.name.toLowerCase().includes(q)) continue;
        out.push(entity);
    }
    out.sort((a, b) => {
        // Published first by recency, then unpublished by name.
        if (a.publishedAt && !b.publishedAt) return -1;
        if (!a.publishedAt && b.publishedAt) return 1;
        if (a.publishedAt && b.publishedAt) return b.publishedAt - a.publishedAt;
        return a.name.localeCompare(b.name);
    });
    return out;
}

// ------------------------------------------------------------------
// View toggling
// ------------------------------------------------------------------

function setView(view) {
    state.view = view;
    $('.xr-side__list-view').hidden   = view !== 'list';
    $('.xr-side__detail-view').hidden = view !== 'detail';
    if (view === 'list') {
        state.selectedId = null;
        state.draft = null;
    }
}

// ------------------------------------------------------------------
// List rendering
// ------------------------------------------------------------------

function renderList() {
    const list = $('#xr-list');
    const entities = filteredEntities();

    if (entities.length === 0) {
        const empty = (state.searchQuery || state.typeFilter)
            ? 'No matching entities.'
            : 'No entities yet. Select text in a captured article to tag a person, organization, place, or thing — or click ＋ New above.';
        list.innerHTML = `<div class="xr-side__empty">${escapeHtml(empty)}</div>`;
    } else {
        list.innerHTML = entities.map((e) => {
            const canonicalHint = e.canonical_id
                ? `<span class="xr-side__row-alias" title="Alias of another entity">→</span>`
                : '';
            const pubHint = e.publishedAt
                ? `<span class="xr-side__row-pub" title="Published ${fmtRelative(e.publishedAt)}">🌐</span>`
                : '';
            return `
              <button type="button" class="xr-side__row" data-id="${escapeHtml(e.id)}">
                <span class="xr-side__row-icon">${ENTITY_ICONS[e.type] || '🔷'}</span>
                <span class="xr-side__row-name">${escapeHtml(e.name)}</span>
                ${canonicalHint}
                ${pubHint}
              </button>`;
        }).join('');
        list.querySelectorAll('.xr-side__row').forEach((row) => {
            row.addEventListener('click', () => openDetail(row.dataset.id));
        });
    }

    const total = Object.keys(state.entities).length;
    $('#xr-count').textContent = total === 0
        ? '0 entities'
        : entities.length === total
            ? `${total} entit${total === 1 ? 'y' : 'ies'}`
            : `${entities.length} of ${total} shown`;
}

// ------------------------------------------------------------------
// Detail rendering
// ------------------------------------------------------------------

async function openDetail(id) {
    const entity = await EntityModel.get(id);
    if (!entity) {
        toast('Entity not found', 'error');
        return;
    }
    state.selectedId = id;
    state.draft = {
        name:         entity.name,
        description:  entity.description || '',
        nip05:        entity.nip05 || '',
        canonical_id: entity.canonical_id || null
    };
    setView('detail');
    renderDetail(entity);
}

function renderDetail(entity) {
    const target = $('#xr-detail');
    const canonical = entity.canonical_id ? state.entities[entity.canonical_id] : null;
    const pubInfo = entity.publishedAt
        ? `✓ Published ${fmtRelative(entity.publishedAt)}` +
          (entity.publishedEventId ? ` — event <code>${escapeHtml(entity.publishedEventId.slice(0, 16))}…</code>` : '')
        : `Not yet published. The kind-0 profile event will be signed + broadcast on the next article publish that tags this entity.`;
    const typeBadge = `<span class="xr-side__type-badge xr-side__type-badge--${entity.type}">${ENTITY_ICONS[entity.type]} ${escapeHtml(entity.type)}</span>`;

    target.innerHTML = `
      <h2 class="xr-side__detail-title">${escapeHtml(entity.name)}</h2>
      ${typeBadge}

      <div class="xr-side__field">
        <label for="xr-field-name">Name</label>
        <input type="text" id="xr-field-name" value="${escapeHtml(entity.name)}" />
      </div>

      <div class="xr-side__field">
        <label for="xr-field-desc">Description</label>
        <textarea id="xr-field-desc" rows="3" placeholder="Short note (optional)">${escapeHtml(entity.description || '')}</textarea>
      </div>

      <div class="xr-side__field">
        <label for="xr-field-nip05">NIP-05</label>
        <input type="text" id="xr-field-nip05" value="${escapeHtml(entity.nip05 || '')}" placeholder="user@example.com" />
      </div>

      <div class="xr-side__field">
        <label>Canonical</label>
        <div class="xr-side__canonical">
          ${canonical
              ? `<span class="xr-side__canonical-tag">${ENTITY_ICONS[canonical.type]} ${escapeHtml(canonical.name)}</span>
                 <button type="button" class="xr-side__ghost-btn" id="xr-unlink">Unlink</button>`
              : `<span class="xr-side__canonical-none">Not aliased</span>
                 <button type="button" class="xr-side__ghost-btn" id="xr-link">Link to…</button>`}
        </div>
      </div>

      <div class="xr-side__keypair">
        <h3>NOSTR keypair</h3>
        <div class="xr-side__key-row">
          <span class="xr-side__key-label">npub</span>
          <code class="xr-side__key-value">${escapeHtml(entity.keypair ? entity.keypair.npub : '—')}</code>
          <button type="button" class="xr-side__ghost-btn" id="xr-copy-npub">Copy</button>
        </div>
        <div class="xr-side__key-row">
          <span class="xr-side__key-label">nsec</span>
          <code class="xr-side__key-value" id="xr-nsec-value">••••••••••••••••</code>
          <button type="button" class="xr-side__ghost-btn" id="xr-reveal-nsec">Reveal</button>
        </div>
      </div>

      <div class="xr-side__linked-accounts">
        <h3>Linked accounts</h3>
        <p class="xr-side__hint">Social-media accounts X-Ray has captured that belong to this person. Linking collapses the same individual across platforms.</p>
        <div id="xr-linked-accounts">Loading…</div>
        <button type="button" class="xr-side__ghost-btn" id="xr-link-account">Link an account…</button>
      </div>

      <div class="xr-side__local-claims">
        <h3>Your claims about this entity</h3>
        <p class="xr-side__hint">Claims you've captured that are about ${escapeHtml(entity.name)} — with your stance and labels. This is the case dashboard's local half; it works before anything is published.</p>
        <div id="xr-local-claims">Loading…</div>
      </div>

      <div class="xr-side__network-claims">
        <h3>Claims about this entity</h3>
        <p class="xr-side__hint">What the network has published about ${escapeHtml(entity.name)} — kind-30040 claims that reference this entity's key, across your configured relays.</p>
        <div id="xr-network-claims">
          <button type="button" class="xr-side__ghost-btn" id="xr-load-network-claims">Load from relays</button>
        </div>
      </div>

      <div class="xr-side__inconsistencies">
        <h3>⚠ Inconsistencies</h3>
        <p class="xr-side__hint">Contradiction links where at least one endpoint is a claim about ${escapeHtml(entity.name)}.</p>
        <div id="xr-inconsistencies">Loading…</div>
      </div>

      ${entity.type === 'case' ? `
      <div class="xr-side__case-export">
        <h3>Export case</h3>
        <p class="xr-side__hint">The case file: local claims about this case, your stances + labels, and its contradictions. JSON for machines, Markdown for humans. (Viewed-only network claims are excluded so the same case always exports the same.)</p>
        <div class="xr-side__case-export-row">
          <button type="button" class="xr-side__ghost-btn" id="xr-export-case-json">Export JSON</button>
          <button type="button" class="xr-side__ghost-btn" id="xr-export-case-md">Export Markdown</button>
        </div>
      </div>` : ''}

      <div class="xr-side__publish">
        <h3>Publish status</h3>
        <p class="xr-side__pub-line">${pubInfo}</p>
      </div>

      <div class="xr-side__save-row">
        <button type="button" class="xr-side__btn xr-side__btn--primary" id="xr-save" disabled>Save changes</button>
      </div>
    `;

    // Wire the editable fields to mark dirty + enable Save.
    const nameEl = $('#xr-field-name');
    const descEl = $('#xr-field-desc');
    const nip05El = $('#xr-field-nip05');
    const saveBtn = $('#xr-save');
    const sync = () => {
        state.draft.name        = nameEl.value;
        state.draft.description = descEl.value;
        state.draft.nip05       = nip05El.value;
        saveBtn.disabled = !hasChanges(entity, state.draft);
    };
    nameEl.addEventListener('input', sync);
    descEl.addEventListener('input', sync);
    nip05El.addEventListener('input', sync);

    saveBtn.addEventListener('click', () => saveDetail(entity));

    // Link / unlink canonical.
    const linkBtn   = $('#xr-link');
    const unlinkBtn = $('#xr-unlink');
    if (linkBtn)   linkBtn.addEventListener('click',   () => openAliasPicker(entity));
    if (unlinkBtn) unlinkBtn.addEventListener('click', () => unlinkCanonical(entity));

    // Linked platform accounts (Phase 9 identity).
    renderLinkedAccounts(entity.id);
    $('#xr-link-account').addEventListener('click', () => openAccountPicker(entity));

    // Network claims about this entity (Phase 10.4) — on-demand relay query.
    const loadClaimsBtn = $('#xr-load-network-claims');
    if (loadClaimsBtn) loadClaimsBtn.addEventListener('click', () => loadNetworkClaims(entity));

    // Phase 11.5 — the case-dashboard halves. Storage-change re-renders
    // wipe the shell, so repaint the network list from the stash rather
    // than resetting to the Load button.
    renderLocalClaims(entity);
    renderInconsistencies(entity);
    if (state.networkClaims && state.networkClaims.entityId === entity.id) {
        paintNetworkClaims(entity, state.networkClaims.events, state.networkClaims.byRelay)
            .catch(() => {});
    }

    // Phase 11.6 — case export (case entities only).
    const exportJsonBtn = $('#xr-export-case-json');
    const exportMdBtn   = $('#xr-export-case-md');
    if (exportJsonBtn) exportJsonBtn.addEventListener('click', () => exportCase(entity, 'json'));
    if (exportMdBtn)   exportMdBtn.addEventListener('click', () => exportCase(entity, 'md'));

    // Keypair controls.
    $('#xr-copy-npub').addEventListener('click', () => {
        if (entity.keypair && entity.keypair.npub) copyToClipboard(entity.keypair.npub);
    });
    const revealBtn = $('#xr-reveal-nsec');
    revealBtn.addEventListener('click', () => {
        if (!entity.keypair || !entity.keypair.nsec) return;
        const el = $('#xr-nsec-value');
        if (el.textContent === entity.keypair.nsec) {
            el.textContent = '••••••••••••••••';
            revealBtn.textContent = 'Reveal';
        } else {
            el.textContent = entity.keypair.nsec;
            revealBtn.textContent = 'Copy';
            revealBtn.onclick = () => copyToClipboard(entity.keypair.nsec);
        }
    });
}

// ------------------------------------------------------------------
// Network claims about this entity (Phase 10.4)
//
// "What the network says about entity P" — query kind-30040 across the
// configured relays by the entity's pubkey (#p). The panel has no relay
// access, so it routes the query through the background SW (the same
// `xray:relay:query` path the reader's per-URL "others' claims" uses).
// ------------------------------------------------------------------

/** Configured read relays, mirroring the reader's `getConfiguredRelays`. */
function getQueryRelays() {
    const FALLBACK = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'];
    return new Promise((resolve) => {
        try {
            chrome.storage.local.get(['preferences'], (res) => {
                const raw = res && res.preferences;
                let prefs = {};
                try { prefs = typeof raw === 'string' ? JSON.parse(raw) : (raw || {}); }
                catch (_) { prefs = {}; }
                const relays = Array.isArray(prefs.default_relays) && prefs.default_relays.length > 0
                    ? prefs.default_relays
                    : FALLBACK;
                resolve(relays);
            });
        } catch (_) { resolve(FALLBACK); }
    });
}

async function loadNetworkClaims(entity) {
    const host = $('#xr-network-claims');
    if (!host) return;
    const pubkey = entity.keypair && entity.keypair.pubkey;
    if (!pubkey) {
        host.innerHTML = `<div class="xr-side__canonical-none">This entity has no keypair, so the network can't reference it yet.</div>`;
        return;
    }
    const relays = await getQueryRelays();
    if (!relays.length) {
        host.innerHTML = `<div class="xr-side__canonical-none">No relays configured — add some in Settings → Relays.</div>`;
        return;
    }
    host.innerHTML = `<div class="xr-side__net-loading">Querying ${relays.length} relay${relays.length === 1 ? '' : 's'}…</div>`;
    chrome.runtime.sendMessage({
        type: 'xray:relay:query',
        relays,
        filter: { kinds: [30040], '#p': [pubkey], limit: 200 },
        timeoutMs: 6000
    }, (resp) => {
        if (!resp || !resp.ok) {
            host.innerHTML = `<div class="xr-side__canonical-none">Query failed: ${escapeHtml((resp && resp.error) || 'no response from service worker')}</div>`;
            return;
        }
        // Replaceable-event dedup (Phase 11.5): queryRelays dedups by
        // event id only, so a republished claim appears once per
        // version — keep the latest per (kind, pubkey, d).
        const events = dedupeReplaceable(resp.events);
        state.networkClaims = { entityId: entity.id, events, byRelay: resp.byRelay };
        paintNetworkClaims(entity, events, resp.byRelay).catch((err) => {
            host.innerHTML = `<div class="xr-side__canonical-none">Render failed: ${escapeHtml(err.message || String(err))}</div>`;
        });
    });
}

/** Latest-wins per (kind, pubkey, d) — NIP-01 addressable semantics. */
function dedupeReplaceable(events) {
    const best = new Map();
    for (const ev of (Array.isArray(events) ? events : [])) {
        const d = ((ev.tags || []).find((t) => t[0] === 'd') || [])[1] || ev.id;
        const key = `${ev.kind}:${ev.pubkey}:${d}`;
        const seen = best.get(key);
        if (!seen || (ev.created_at || 0) > (seen.created_at || 0)) best.set(key, ev);
    }
    return [...best.values()];
}

// Refs for the assess buttons in the network list (claim text stays
// out of data attributes).
let netClaimRefs = [];

/** Render + wire the network-claims list (re-runs after assessments). */
async function paintNetworkClaims(entity, events, byRelay) {
    const host = $('#xr-network-claims');
    if (!host) return;
    const [assessMap, canon] = await Promise.all([
        assessmentsByCanonicalRef(),
        makeClaimRefCanonicalizer()
    ]);
    netClaimRefs = [];
    host.innerHTML = renderNetworkClaims(events, byRelay, assessMap, canon);
    host.querySelectorAll('[data-action="assess-net"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const ref = netClaimRefs[Number(btn.dataset.nidx)];
            if (!ref) return;
            const result = await openAssessModal({
                claimRef:  { coord: ref.coord, url: ref.url, text: ref.text, event_id: ref.event_id },
                claimText: ref.text
            });
            if (result) {
                await paintNetworkClaims(entity, events, byRelay);
                renderInconsistencies(entity);
                renderLocalClaims(entity);
            }
        });
    });
}

/** Group kind-30040 events by author pubkey and render claim cards. */
function renderNetworkClaims(events, byRelay, assessMap, canon) {
    const relayCount = Object.keys(byRelay || {}).length;
    const list = Array.isArray(events) ? events : [];
    if (list.length === 0) {
        return `<div class="xr-side__canonical-none">No claims about this entity found on ${relayCount} relay${relayCount === 1 ? '' : 's'} yet.</div>`;
    }
    const byAuthor = new Map();
    for (const ev of list) {
        if (!byAuthor.has(ev.pubkey)) byAuthor.set(ev.pubkey, []);
        byAuthor.get(ev.pubkey).push(ev);
    }
    const summary = `<div class="xr-side__net-summary">${list.length} claim${list.length === 1 ? '' : 's'} from ${byAuthor.size} author${byAuthor.size === 1 ? '' : 's'} · ${relayCount} relay${relayCount === 1 ? '' : 's'}</div>`;
    const cards = [...byAuthor.entries()].map(([pubkey, evs]) => {
        evs.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        const rows = evs.map((ev) => renderNetworkClaimRow(parseClaimEvent(ev), ev, assessMap, canon)).join('');
        return `
          <section class="xr-side__net-author">
            <header class="xr-side__net-author-head">👤 ${escapeHtml(pubkey.slice(0, 12))}… <span class="xr-side__net-author-count">${evs.length}</span></header>
            ${rows}
          </section>`;
    }).join('');
    return summary + cards;
}

function renderNetworkClaimRow(c, ev, assessMap, canon) {
    const when = c.created_at ? fmtRelative(c.created_at) : '';
    const key = c.isKey ? `<span class="xr-side__net-key">⭐ key</span>` : '';
    const source = c.source ? `<div class="xr-side__net-source">Per <em>${escapeHtml(c.source)}</em></div>` : '';
    const src = c.url
        ? `<a class="xr-side__net-src" href="${escapeHtml(c.url)}" target="_blank" rel="noopener">${escapeHtml(c.title || c.url)}</a>`
        : '';

    // Assessability (Phase 11.5): the row's coordinate collapses to the
    // local id when the claim is actually ours, so badges + the modal
    // hit the same record everywhere.
    let assessBtn = '';
    let badges = '';
    if (ev && ev.pubkey && c.id && c.text && c.url) {
        const coord = buildClaimCoord(ev.pubkey, c.id);
        const idx = netClaimRefs.push({ coord, url: c.url, text: c.text, event_id: ev.id || null }) - 1;
        const existing = assessMap && canon ? assessMap.get(canon(coord)) : null;
        badges = renderAssessmentBadges(existing);
        assessBtn = `<button type="button" class="xr-side__net-assess" data-action="assess-net" data-nidx="${idx}"
                        title="${existing ? 'Edit your assessment' : 'Assess this claim'}">${existing ? '⚖✓' : '⚖ Assess'}</button>`;
    }

    return `
      <article class="xr-side__net-claim">
        <div class="xr-side__net-claim-top">${key}<span class="xr-side__net-when">${escapeHtml(when)}</span>${assessBtn}</div>
        <div class="xr-side__net-claim-text">${escapeHtml(c.text)}</div>
        ${badges}
        ${source}
        ${src}
      </article>`;
}

// ------------------------------------------------------------------
// Local claims + inconsistencies (Phase 11.5 — the case dashboard)
// ------------------------------------------------------------------

/** Local claims whose `about` set includes this entity. */
async function localClaimsAbout(entityId) {
    const all = await ClaimModel.getAll();
    return Object.values(all).filter((c) => (c.about || []).includes(entityId));
}

/** "Your claims about this entity" — local half of the dashboard. */
async function renderLocalClaims(entity) {
    const host = $('#xr-local-claims');
    if (!host) return;
    try {
        const [claims, assessMap] = await Promise.all([
            localClaimsAbout(entity.id),
            assessmentsByCanonicalRef()
        ]);
        if (claims.length === 0) {
            host.innerHTML = `<div class="xr-side__canonical-none">No local claims tag this entity yet — capture a page and mark some claims about it.</div>`;
            return;
        }
        claims.sort((a, b) => (b.is_key ? 1 : 0) - (a.is_key ? 1 : 0) || (a.created || 0) - (b.created || 0));
        host.innerHTML = claims.map((c, idx) => {
            const a = assessMap.get(c.id) || null;
            return `
              <article class="xr-side__net-claim">
                <div class="xr-side__net-claim-top">
                  ${c.is_key ? '<span class="xr-side__net-key">⭐ key</span>' : ''}
                  ${c.publishedAt ? '<span class="xr-side__net-when" title="Published">🌐</span>' : '<span class="xr-side__net-when">local</span>'}
                  <button type="button" class="xr-side__net-assess" data-action="assess-local" data-lidx="${idx}"
                          title="${a ? 'Edit your assessment' : 'Assess this claim'}">${a ? '⚖✓' : '⚖ Assess'}</button>
                </div>
                <div class="xr-side__net-claim-text">${escapeHtml(c.text)}</div>
                ${renderAssessmentBadges(a)}
                <a class="xr-side__net-src" href="${escapeHtml(c.source_url)}" target="_blank" rel="noopener">${escapeHtml(hostOf(c.source_url))}</a>
              </article>`;
        }).join('');
        host.querySelectorAll('[data-action="assess-local"]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const claim = claims[Number(btn.dataset.lidx)];
                if (!claim) return;
                const result = await openAssessModal({ claimRef: { claim_id: claim.id }, claimText: claim.text });
                if (result) {
                    renderLocalClaims(entity);
                    renderInconsistencies(entity);
                }
            });
        });
    } catch (err) {
        host.innerHTML = `<div class="xr-side__canonical-none">${escapeHtml(err.message || String(err))}</div>`;
    }
}

/**
 * Contradiction links where at least one endpoint is a claim about
 * this entity (requiring BOTH ends would silently drop the common
 * case where only one side got tagged), plus the label tally across
 * the entity's assessed claims.
 */
async function renderInconsistencies(entity) {
    const host = $('#xr-inconsistencies');
    if (!host) return;
    try {
        const [claims, allLinks, assessMap, canon] = await Promise.all([
            localClaimsAbout(entity.id),
            EvidenceLinker.getAll(),
            assessmentsByCanonicalRef(),
            makeClaimRefCanonicalizer()
        ]);
        const aboutIds = new Set(claims.map((c) => c.id));
        const claimText = new Map(claims.map((c) => [c.id, c]));

        const rows = [];
        const relevantRefs = new Set(aboutIds);
        for (const link of Object.values(allLinks)) {
            if (link.relationship !== 'contradicts') continue;
            const a = canon(link.source_claim_id);
            const b = canon(link.target_claim_id);
            if (!aboutIds.has(a) && !aboutIds.has(b)) continue;
            relevantRefs.add(a); relevantRefs.add(b);
            const side = async (ref, snap) => {
                if (claimText.has(ref)) return { text: claimText.get(ref).text, url: claimText.get(ref).source_url };
                if (isLocalClaimId(ref)) {
                    const rec = await ClaimModel.get(ref);
                    if (rec) return { text: rec.text, url: rec.source_url };
                }
                return { text: (snap && snap.text) || `(claim ${String(ref).slice(0, 18)}…)`, url: (snap && snap.url) || '' };
            };
            const left  = await side(a, link.source_snapshot);
            const right = await side(b, link.target_snapshot);
            rows.push(`
              <article class="xr-side__contra">
                <div class="xr-side__contra-claim">“${escapeHtml(left.text)}” <span class="xr-side__contra-host">${escapeHtml(hostOf(left.url))}</span></div>
                <div class="xr-side__contra-vs">⚔ contradicts</div>
                <div class="xr-side__contra-claim">“${escapeHtml(right.text)}” <span class="xr-side__contra-host">${escapeHtml(hostOf(right.url))}</span></div>
                ${link.note ? `<div class="xr-side__contra-note">${escapeHtml(link.note)}</div>` : ''}
              </article>`);
        }

        // Label tally across everything judged in this case's orbit.
        const counts = new Map();
        for (const ref of relevantRefs) {
            const a = assessMap.get(ref);
            if (!a) continue;
            for (const l of a.labels || []) counts.set(l.label, (counts.get(l.label) || 0) + 1);
        }
        const tally = counts.size > 0
            ? `<div class="xr-side__label-tally">${[...counts.entries()]
                .sort((x, y) => y[1] - x[1])
                .map(([label, n]) => `<span class="xr-side__tally-pill">${n}× ${escapeHtml(label)}</span>`).join('')}</div>`
            : '';

        host.innerHTML = rows.length > 0
            ? tally + rows.join('')
            : tally + `<div class="xr-side__canonical-none">No contradictions recorded for this entity yet — link two claims with “contradicts” in the reader.</div>`;
    } catch (err) {
        host.innerHTML = `<div class="xr-side__canonical-none">${escapeHtml(err.message || String(err))}</div>`;
    }
}

function hostOf(url) {
    try { return new URL(url).host; } catch { return String(url || ''); }
}

/** Export a case entity as JSON or Markdown (Phase 11.6). */
async function exportCase(entity, format) {
    try {
        const data = await collectCaseData(entity.id);
        const generatedAt = new Date().toISOString();
        const slug = entity.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'case';
        const date = generatedAt.slice(0, 10);
        if (format === 'json') {
            downloadText(`xray-case-${slug}-${date}.json`, buildCaseJson(data, generatedAt), 'application/json');
        } else {
            downloadText(`xray-case-${slug}-${date}.md`, buildCaseMarkdown(data, generatedAt), 'text/markdown');
        }
    } catch (err) {
        alert(`Export failed: ${err.message || err}`);
    }
}

function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Render the "Linked accounts" list for an entity into #xr-linked-accounts.
 * Async — called after renderDetail paints the (synchronous) shell.
 */
async function renderLinkedAccounts(entityId) {
    const host = $('#xr-linked-accounts');
    if (!host) return;
    let accounts = [];
    try { accounts = await accountsForEntity(entityId); }
    catch (_) { /* registry unavailable — show empty */ }

    if (!accounts.length) {
        host.innerHTML = `<div class="xr-side__canonical-none">No linked accounts yet.</div>`;
        return;
    }
    host.innerHTML = accounts.map((a) => `
      <div class="xr-side__key-row">
        <span class="xr-side__key-label">${escapeHtml(a.platform)}</span>
        <code class="xr-side__key-value">${escapeHtml(a.handle ? '@' + a.handle : a.stableId)}</code>
        <button type="button" class="xr-side__ghost-btn" data-acct="${escapeHtml(a.key)}">Unlink</button>
      </div>`).join('');

    host.querySelectorAll('[data-acct]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            try {
                await unlinkAccount(btn.dataset.acct);
                toast('Account unlinked', 'success');
                renderLinkedAccounts(entityId);
            } catch (err) {
                toast('Unlink failed: ' + (err.message || err), 'error');
            }
        });
    });
}

/**
 * Modal to link one of the captured-but-unlinked platform accounts to
 * this entity. Mirrors openAliasPicker.
 */
async function openAccountPicker(entity) {
    let candidates = [];
    try { candidates = await listUnlinkedAccounts(); }
    catch (_) { candidates = []; }

    const modal = document.createElement('div');
    modal.className = 'xr-side__modal';
    modal.innerHTML = `
      <div class="xr-side__modal-card">
        <header class="xr-side__modal-head">
          <h3>Link an account to ${escapeHtml(entity.name)}</h3>
          <button type="button" class="xr-side__ghost-btn" id="xr-acct-close">✕</button>
        </header>
        <input type="search" class="xr-side__modal-search" id="xr-acct-search"
               placeholder="Search captured accounts…" />
        <div class="xr-side__modal-list" id="xr-acct-list"></div>
      </div>
    `;
    document.body.appendChild(modal);

    const listEl = $('#xr-acct-list');
    const render = (query) => {
        const q = query.trim().toLowerCase();
        const shown = candidates.filter((a) =>
            !q
            || (a.handle && a.handle.toLowerCase().includes(q))
            || a.platform.includes(q)
            || String(a.stableId).toLowerCase().includes(q));
        if (!shown.length) {
            listEl.innerHTML = `<div class="xr-side__empty">No unlinked accounts. Capture some comments or posts first.</div>`;
            return;
        }
        listEl.innerHTML = shown.map((a) => `
          <button type="button" class="xr-side__row" data-acct="${escapeHtml(a.key)}">
            <span class="xr-side__row-icon">${escapeHtml(a.platform.slice(0, 2))}</span>
            <span class="xr-side__row-name">${escapeHtml(a.handle ? '@' + a.handle : a.stableId)}
              <small>${escapeHtml(a.platform)}</small></span>
          </button>`).join('');
        listEl.querySelectorAll('.xr-side__row').forEach((row) => {
            row.addEventListener('click', async () => {
                try {
                    await linkAccountToEntity(row.dataset.acct, entity.id);
                    toast('Account linked', 'success');
                    document.body.removeChild(modal);
                    renderLinkedAccounts(entity.id);
                } catch (err) {
                    toast('Link failed: ' + (err.message || err), 'error');
                }
            });
        });
    };
    render('');
    $('#xr-acct-search').addEventListener('input', (ev) => render(ev.target.value));
    $('#xr-acct-close').addEventListener('click', () => document.body.removeChild(modal));
    modal.addEventListener('click', (ev) => { if (ev.target === modal) document.body.removeChild(modal); });
}

function hasChanges(entity, draft) {
    return draft.name !== entity.name
        || draft.description !== (entity.description || '')
        || draft.nip05 !== (entity.nip05 || '');
}

async function saveDetail(entity) {
    try {
        await EntityModel.update(entity.id, {
            name:        state.draft.name,
            description: state.draft.description,
            nip05:       state.draft.nip05
        });
        await refreshEntities();
        toast('Saved — will re-publish on next article capture', 'success');
        const updated = await EntityModel.get(entity.id);
        renderDetail(updated);
    } catch (err) {
        toast('Save failed: ' + (err.message || err), 'error');
    }
}

async function unlinkCanonical(entity) {
    try {
        await EntityModel.unlinkAlias(entity.id);
        await refreshEntities();
        toast('Alias link removed', 'success');
        const updated = await EntityModel.get(entity.id);
        renderDetail(updated);
    } catch (err) {
        toast('Unlink failed: ' + (err.message || err), 'error');
    }
}

// ------------------------------------------------------------------
// Alias picker (inline modal)
// ------------------------------------------------------------------

async function openAliasPicker(entity) {
    // Candidates: same-type entities other than `entity` itself.
    const candidates = Object.values(state.entities)
        .filter((e) => e.type === entity.type && e.id !== entity.id);

    // Build a lightweight modal.
    const modal = document.createElement('div');
    modal.className = 'xr-side__modal';
    modal.innerHTML = `
      <div class="xr-side__modal-card">
        <header class="xr-side__modal-head">
          <h3>Link ${escapeHtml(entity.name)} to canonical</h3>
          <button type="button" class="xr-side__ghost-btn" id="xr-modal-close">✕</button>
        </header>
        <input type="search" class="xr-side__modal-search" id="xr-modal-search"
               placeholder="Search ${escapeHtml(entity.type)} entities…" />
        <div class="xr-side__modal-list" id="xr-modal-list"></div>
      </div>
    `;
    document.body.appendChild(modal);

    const listEl = $('#xr-modal-list');
    const render = (query) => {
        const q = query.trim().toLowerCase();
        const shown = candidates.filter((e) => !q || e.name.toLowerCase().includes(q));
        if (shown.length === 0) {
            listEl.innerHTML = `<div class="xr-side__empty">No candidates. Tag more ${escapeHtml(entity.type)} entities first.</div>`;
            return;
        }
        listEl.innerHTML = shown.map((e) => `
          <button type="button" class="xr-side__row" data-id="${escapeHtml(e.id)}">
            <span class="xr-side__row-icon">${ENTITY_ICONS[e.type]}</span>
            <span class="xr-side__row-name">${escapeHtml(e.name)}</span>
          </button>`).join('');
        listEl.querySelectorAll('.xr-side__row').forEach((row) => {
            row.addEventListener('click', async () => {
                const canonicalId = row.dataset.id;
                try {
                    await EntityModel.linkAlias(entity.id, canonicalId);
                    await refreshEntities();
                    toast('Alias linked', 'success');
                    document.body.removeChild(modal);
                    const updated = await EntityModel.get(entity.id);
                    renderDetail(updated);
                } catch (err) {
                    toast('Link failed: ' + (err.message || err), 'error');
                }
            });
        });
    };
    render('');
    $('#xr-modal-search').addEventListener('input', (ev) => render(ev.target.value));
    $('#xr-modal-close').addEventListener('click', () => document.body.removeChild(modal));
    modal.addEventListener('click', (ev) => { if (ev.target === modal) document.body.removeChild(modal); });
}

// ------------------------------------------------------------------
// Create new
// ------------------------------------------------------------------

function openCreateModal() {
    const modal = document.createElement('div');
    modal.className = 'xr-side__modal';
    modal.innerHTML = `
      <div class="xr-side__modal-card">
        <header class="xr-side__modal-head">
          <h3>Create new entity</h3>
          <button type="button" class="xr-side__ghost-btn" id="xr-modal-close">✕</button>
        </header>
        <div class="xr-side__modal-body">
          <div class="xr-side__field">
            <label>Type</label>
            <div class="xr-side__filters">
              ${ENTITY_TYPES.map((t, i) => `
                <button type="button" class="xr-side__type-chip ${i === 0 ? 'xr-side__type-chip--active' : ''}"
                        data-type="${t}" title="${escapeHtml(t)}">${ENTITY_ICONS[t]} ${escapeHtml(t)}</button>
              `).join('')}
            </div>
          </div>
          <div class="xr-side__field">
            <label>Name</label>
            <input type="text" id="xr-new-name" autocomplete="off" spellcheck="false" />
          </div>
          <div class="xr-side__save-row">
            <button type="button" class="xr-side__btn xr-side__btn--primary" id="xr-create-go">Create</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    let selectedType = ENTITY_TYPES[0];
    modal.querySelectorAll('.xr-side__type-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            modal.querySelectorAll('.xr-side__type-chip').forEach((c) =>
                c.classList.remove('xr-side__type-chip--active'));
            chip.classList.add('xr-side__type-chip--active');
            selectedType = chip.dataset.type;
        });
    });

    const nameInput = $('#xr-new-name');
    nameInput.focus();
    $('#xr-modal-close').addEventListener('click', () => document.body.removeChild(modal));
    modal.addEventListener('click', (ev) => { if (ev.target === modal) document.body.removeChild(modal); });

    $('#xr-create-go').addEventListener('click', async () => {
        const name = nameInput.value.trim();
        if (!name) { toast('Name is required', 'warning'); return; }
        try {
            const created = await EntityModel.create({ name, type: selectedType });
            await refreshEntities();
            document.body.removeChild(modal);
            toast('Entity created', 'success');
            openDetail(created.id);
            renderList();
        } catch (err) {
            toast('Create failed: ' + (err.message || err), 'error');
        }
    });

    nameInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); $('#xr-create-go').click(); }
    });
}

// ------------------------------------------------------------------
// Delete
// ------------------------------------------------------------------

async function deleteSelected() {
    if (!state.selectedId) return;
    const entity = state.entities[state.selectedId];
    if (!entity) return;

    // Count aliases that'll be unlinked so the user knows the blast radius.
    const aliasCount = Object.values(state.entities)
        .filter((e) => e.canonical_id === entity.id).length;
    const msg = aliasCount > 0
        ? `Delete "${entity.name}"? ${aliasCount} alias(es) will have their canonical link cleared (they won't be deleted). The entity's kind-0 event already on relays is NOT un-published — that requires NIP-09 (later phase).`
        : `Delete "${entity.name}"? The entity's kind-0 event already on relays is NOT un-published — that requires NIP-09 (later phase).`;
    if (!confirm(msg)) return;

    try {
        await EntityModel.delete(entity.id);
        await refreshEntities();
        toast('Deleted', 'success');
        setView('list');
        renderList();
    } catch (err) {
        toast('Delete failed: ' + (err.message || err), 'error');
    }
}

// ------------------------------------------------------------------
// Export / import
// ------------------------------------------------------------------

async function exportRegistry() {
    const raw = Object.values(state.entities).map((e) => ({
        ...e,
        // Strip the merged keypair to match the stored shape; export
        // represents what `entities` storage would hold on reimport.
        keypair: undefined
    }));
    const blob = new Blob([JSON.stringify(raw, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `xray-entities-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(`Exported ${raw.length} entities (metadata only — keypairs excluded for safety)`, 'success', 5000);
}

async function handleImport(file) {
    if (!file) return;
    try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) throw new Error('Import file must be a JSON array of entities');
        // Best-effort upsert. Entities with `keyName` pointing at a
        // key we don't have locally will have `null` keypair in get(),
        // which means they'll be reference-only (can't sign, can't
        // publish kind-0). Safe for importing someone else's name-set
        // without leaking keys.
        let added = 0, updated = 0;
        for (const row of parsed) {
            if (!row || !row.id || !row.name || !row.type) continue;
            const existing = state.entities[row.id];
            if (existing) {
                await EntityModel.update(existing.id, {
                    name:        row.name,
                    description: row.description || '',
                    nip05:       row.nip05 || '',
                    canonical_id: row.canonical_id || null
                });
                updated++;
            } else {
                try {
                    await EntityModel.create({
                        name:        row.name,
                        type:        row.type,
                        description: row.description || '',
                        nip05:       row.nip05 || '',
                        canonical_id: row.canonical_id || null
                    });
                    added++;
                } catch (_) { /* id collision → skip */ }
            }
        }
        await refreshEntities();
        renderList();
        toast(`Imported — ${added} added, ${updated} updated`, 'success', 5000);
    } catch (err) {
        toast('Import failed: ' + (err.message || err), 'error', 5000);
    }
}

// ------------------------------------------------------------------
// Sync section — user identity + push/pull/clear
// ------------------------------------------------------------------

/**
 * What the user sees when the 🔒 Sync details block opens. Two
 * states: "needs identity" (no `xray:user` key stored yet) and
 * "ready" (key present; buttons enabled).
 */
function renderSyncBody() {
    const body = $('#xr-sync-body');
    const statusSpan = $('#xr-sync-status');
    const userKey = LocalKeyManager.getKey(USER_KEY_NAME);

    if (!userKey || !userKey.privateKey) {
        statusSpan.textContent = 'not configured';
        statusSpan.className = 'xr-sync__status xr-sync__status--warn';
        body.innerHTML = `
          <p class="xr-sync__lead">
            Sync lets this device push your entity registry to NOSTR
            relays and pull on another device. Entities are encrypted
            to your own pubkey via NIP-44 v2 before leaving the
            browser — the relay stores ciphertext only.
          </p>
          <p class="xr-sync__warn">
            ⚠ Paste your <code>nsec</code> below to enable sync. It's
            stored locally in <code>chrome.storage.local</code>, same
            trust model as the entity keys already on this device.
            Only import on devices you trust.
          </p>
          <div class="xr-side__field">
            <label for="xr-sync-nsec">Your nsec</label>
            <input type="password" id="xr-sync-nsec"
                   placeholder="nsec1…" autocomplete="off" spellcheck="false" />
          </div>
          <div class="xr-sync__btn-row">
            <button type="button" class="xr-side__btn xr-side__btn--primary" id="xr-sync-import">Save identity</button>
            <button type="button" class="xr-side__ghost-btn"                 id="xr-sync-generate">Generate new</button>
          </div>
        `;
        $('#xr-sync-import').addEventListener('click', importNsec);
        $('#xr-sync-generate').addEventListener('click', generateIdentity);
        return;
    }

    statusSpan.textContent = userKey.npub.slice(0, 12) + '…';
    statusSpan.className = 'xr-sync__status xr-sync__status--ok';
    body.innerHTML = `
      <div class="xr-sync__identity">
        <div class="xr-side__key-row">
          <span class="xr-side__key-label">npub</span>
          <code class="xr-side__key-value">${escapeHtml(userKey.npub)}</code>
          <button type="button" class="xr-side__ghost-btn" id="xr-sync-copy-npub">Copy</button>
        </div>
        <div class="xr-side__key-row">
          <span class="xr-side__key-label">nsec</span>
          <code class="xr-side__key-value" id="xr-sync-nsec-value">••••••••••••••••</code>
          <button type="button" class="xr-side__ghost-btn" id="xr-sync-reveal">Reveal</button>
        </div>
      </div>

      <div class="xr-sync__btn-row">
        <button type="button" class="xr-side__btn xr-side__btn--primary" id="xr-sync-push">
          ⬆ Push ${Object.keys(state.entities).length} entit${Object.keys(state.entities).length === 1 ? 'y' : 'ies'} to relays
        </button>
        <button type="button" class="xr-side__btn" id="xr-sync-pull">
          ⬇ Pull from relays
        </button>
      </div>

      <div class="xr-sync__btn-row">
        <button type="button" class="xr-side__ghost-btn xr-side__ghost-btn--danger" id="xr-sync-clear">
          Clear remote (NIP-09 delete)
        </button>
        <button type="button" class="xr-side__ghost-btn xr-side__ghost-btn--danger" id="xr-sync-forget">
          Forget identity
        </button>
      </div>

      <div class="xr-sync__log" id="xr-sync-log" hidden></div>
    `;

    $('#xr-sync-copy-npub').addEventListener('click', () => copyToClipboard(userKey.npub));
    const revealBtn = $('#xr-sync-reveal');
    revealBtn.addEventListener('click', () => {
        const el = $('#xr-sync-nsec-value');
        if (el.textContent === userKey.nsec) {
            el.textContent = '••••••••••••••••';
            revealBtn.textContent = 'Reveal';
            revealBtn.onclick = null;
        } else {
            el.textContent = userKey.nsec;
            revealBtn.textContent = 'Copy';
            revealBtn.onclick = () => copyToClipboard(userKey.nsec);
        }
    });

    $('#xr-sync-push').addEventListener('click',  () => runPush(userKey));
    $('#xr-sync-pull').addEventListener('click',  () => runPull(userKey));
    $('#xr-sync-clear').addEventListener('click', () => runClear(userKey));
    $('#xr-sync-forget').addEventListener('click', forgetIdentity);
}

async function importNsec() {
    const input = $('#xr-sync-nsec').value.trim();
    if (!input) { toast('Paste an nsec or click Generate', 'warning'); return; }
    let privHex = null;
    try {
        if (input.startsWith('nsec1')) {
            privHex = Crypto.nsecToHex(input);
        } else if (/^[0-9a-fA-F]{64}$/.test(input)) {
            privHex = input.toLowerCase();
        } else {
            throw new Error('Expected nsec1… or a 64-character hex privkey');
        }
        if (!privHex || !/^[0-9a-f]{64}$/.test(privHex)) {
            throw new Error('Failed to decode privkey');
        }
        await saveIdentity(privHex);
        toast('Identity saved', 'success');
    } catch (err) {
        toast('Import failed: ' + (err.message || err), 'error', 5000);
    }
}

async function generateIdentity() {
    if (!confirm('Generate a brand-new NOSTR identity and use it for sync? You\'ll want to copy the nsec to any other device you plan to sync with.')) return;
    try {
        const privHex = Crypto.generatePrivateKey();
        await saveIdentity(privHex);
        toast('New identity generated — copy the nsec from the detail view', 'success', 5000);
    } catch (err) {
        toast('Generate failed: ' + (err.message || err), 'error');
    }
}

async function saveIdentity(privHex) {
    const pubkey = Crypto.getPublicKey(privHex);
    // Bypass LocalKeyManager.createKey (which throws on duplicate) —
    // reinstalling the identity should be allowed.
    LocalKeyManager.keys.set(USER_KEY_NAME, {
        name:       USER_KEY_NAME,
        privateKey: privHex,
        pubkey,
        npub:       Crypto.hexToNpub(pubkey),
        nsec:       Crypto.hexToNsec(privHex),
        metadata:   { role: 'user-primary', source: 'sync-setup' },
        created:    Math.floor(Date.now() / 1000)
    });
    await LocalKeyManager.save();
    renderSyncBody();
}

async function forgetIdentity() {
    if (!confirm('Remove the user identity from this device? Pushed events stay on relays. Local entities + their keypairs are untouched.')) return;
    try {
        await LocalKeyManager.deleteKey(USER_KEY_NAME);
        toast('Identity removed from this device', 'success');
        renderSyncBody();
    } catch (err) {
        toast('Remove failed: ' + (err.message || err), 'error');
    }
}

async function saveRelays(newList) {
    return new Promise((resolve) => {
        chrome.storage.local.get(['preferences'], (res) => {
            const raw = res && res.preferences;
            let prefs = {};
            try { prefs = typeof raw === 'string' ? JSON.parse(raw) : (raw || {}); }
            catch (_) { prefs = {}; }
            prefs.default_relays = newList;
            chrome.storage.local.set({ preferences: JSON.stringify(prefs) }, () => resolve());
        });
    });
}

/**
 * After a successful pull, query NIP-65 (kind-10002) for the user's
 * pubkey across the relays we just used. If the discovered list adds
 * relays we don't have, surface a one-line confirmation in the sync
 * log so the user can adopt them with a click. We never auto-replace
 * — the local list is authoritative until the user opts in.
 */
async function offerRelayListAdoption(userKey, currentRelays) {
    let result;
    try {
        result = await pullRelayList({ userPrivkey: userKey.privateKey, relays: currentRelays });
    } catch (err) {
        // Quiet failure — don't add noise to the sync log if NIP-65
        // discovery hiccups.
        console.warn('[X-Ray] pullRelayList failed:', err);
        return;
    }
    if (!result.found || result.relays.length === 0) return;

    // Normalize both sides before comparing so trailing-slash and
    // case differences don't cause spurious "missing" matches.
    const local = new Set(currentRelays.map(normalizeRelayUrl));
    const remote = new Set(result.relays.map(normalizeRelayUrl));
    const newRemoteRelays = [...remote].filter((u) => !local.has(u));
    if (newRemoteRelays.length === 0) return;  // already have everything

    // Append the relay-adoption banner below the existing sync log.
    const log = $('#xr-sync-log');
    if (!log) return;
    const banner = document.createElement('div');
    banner.style.cssText = 'margin-top:8px;padding:8px;border:1px solid var(--xr-border);border-radius:4px;font-size:12px';
    banner.innerHTML = `
        <div>📡 Found <strong>${newRemoteRelays.length}</strong> relay(s) on your other devices that aren't in this device's list:</div>
        <ul style="margin:4px 0 8px 16px">
            ${newRemoteRelays.map((u) => `<li><code>${escapeHtml(u)}</code></li>`).join('')}
        </ul>
        <div style="display:flex;gap:6px">
            <button type="button" class="xr-side__btn xr-side__btn--primary" id="xr-adopt-relays">Add to my list</button>
            <button type="button" class="xr-side__ghost-btn" id="xr-dismiss-relays">Ignore</button>
        </div>
    `;
    log.appendChild(banner);
    $('#xr-adopt-relays').addEventListener('click', async () => {
        // Save normalized union — protects against future round-trips
        // re-introducing trailing-slash dupes.
        const merged = [...new Set([...currentRelays.map(normalizeRelayUrl), ...newRemoteRelays])];
        await saveRelays(merged);
        toast(`Added ${newRemoteRelays.length} relay(s) to local list`, 'success', 4000);
        banner.remove();
    });
    $('#xr-dismiss-relays').addEventListener('click', () => banner.remove());
}

async function configuredRelays() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['preferences'], (res) => {
            const raw = res && res.preferences;
            let prefs = {};
            try { prefs = typeof raw === 'string' ? JSON.parse(raw) : (raw || {}); }
            catch (_) { prefs = {}; }
            const relays = Array.isArray(prefs.default_relays) && prefs.default_relays.length > 0
                ? prefs.default_relays
                : ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'];
            resolve(relays);
        });
    });
}

function setSyncLog(html) {
    const log = $('#xr-sync-log');
    if (!log) return;
    log.hidden = false;
    log.innerHTML = html;
}

async function runPush(userKey) {
    setSyncLog('<em>Pushing…</em>');
    try {
        const relays = await configuredRelays();
        const out = await pushEntities({ userPrivkey: userKey.privateKey, relays });
        // Also push the relay list (NIP-65 / kind 10002) so a pull on
        // another device can offer to adopt it. Best-effort — don't
        // fail the entity push if relay-list publishing fails.
        let relayListNote = '';
        try {
            const r = await pushRelayList({ userPrivkey: userKey.privateKey, relays });
            relayListNote = `<div style="margin-top:4px;font-size:12px;opacity:.85">
                Relay list (NIP-65) published to ${r.published}/${r.total} relays.
            </div>`;
        } catch (rlErr) {
            relayListNote = `<div style="margin-top:4px;font-size:12px;color:var(--xr-warning)">
                Relay-list push failed: ${escapeHtml(rlErr.message || String(rlErr))}
            </div>`;
        }
        setSyncLog(`
          <div>Pushed <strong>${out.pushed}</strong>, skipped ${out.skipped}, failed ${out.failed}.</div>
          ${relayListNote}
          <details>
            <summary>Per-entity breakdown</summary>
            <ul>${out.perEntity.map((e) =>
              `<li>${escapeHtml(e.id.slice(0, 18))}… — ${e.ok ? `✓ ${e.relays}/${e.total}` : `✗ ${escapeHtml(e.reason || 'failed')}`}</li>`
            ).join('')}</ul>
          </details>
        `);
        toast(`Push done: ${out.pushed}/${out.pushed + out.skipped + out.failed}`, out.failed === 0 ? 'success' : 'warning', 5000);
    } catch (err) {
        setSyncLog(`<div style="color:var(--xr-danger)">${escapeHtml(err.message || String(err))}</div>`);
        toast('Push failed: ' + (err.message || err), 'error', 5000);
    }
}

async function runPull(userKey) {
    setSyncLog('<em>Pulling…</em>');
    try {
        const relays = await configuredRelays();
        const out = await pullEntities({ userPrivkey: userKey.privateKey, relays });
        const perRelay = Object.entries(out.byRelay || {}).map(([url, stat]) => {
            const dot = stat.eose ? '✓' : '⏱';
            return `<li>${dot} <code>${escapeHtml(url)}</code> — received ${stat.received}${stat.eose ? '' : ' (no EOSE)'}</li>`;
        }).join('');
        const legacyNote = out.legacyNip04
            ? ` <span title="Legacy NIP-04 events from the userscript decrypted via fallback path">(${out.legacyNip04} legacy NIP-04)</span>`
            : '';
        const formatBreakdown = `<div style="margin-top:4px;font-size:12px;opacity:.85">
            Format split: <strong>${out.nip44Total}</strong> NIP-44, <strong>${out.nip04Total}</strong> NIP-04
        </div>`;
        toast(`Pull done: +${out.added} added, ${out.updated} updated`, out.failed === 0 && out.malformed === 0 ? 'success' : 'warning', 5000);
        await refreshEntities();
        renderList();
        renderSyncBody();    // refresh the "Push N entities" count
        // Set the log AFTER renderSyncBody — renderSyncBody re-renders
        // the sync body and replaces the #xr-sync-log element, so any
        // log content set before this call is wiped.
        setSyncLog(`
          <div>Fetched <strong>${out.fetched}</strong> events (deduped across relays).
               Added <strong>${out.added}</strong>, updated <strong>${out.updated}</strong>,
               unchanged ${out.unchanged}, malformed ${out.malformed}, failed ${out.failed}.${legacyNote}</div>
          ${formatBreakdown}
          ${perRelay ? `<details open><summary>Per-relay</summary><ul>${perRelay}</ul></details>` : ''}
        `);
        // Best-effort NIP-65 relay-list discovery. If the remote list
        // diverges from local, ask the user before adopting — adopting
        // silently could orphan in-flight queries to relays they're
        // about to drop.
        await offerRelayListAdoption(userKey, relays);
    } catch (err) {
        setSyncLog(`<div style="color:var(--xr-danger)">${escapeHtml(err.message || String(err))}</div>`);
        toast('Pull failed: ' + (err.message || err), 'error', 5000);
    }
}

async function runClear(userKey) {
    if (!confirm('Publish NIP-09 delete requests for every kind-30078 sync event you own? Not all relays honor these — partial success is normal. Local entities are untouched.')) return;
    setSyncLog('<em>Clearing remote…</em>');
    try {
        const relays = await configuredRelays();
        const out = await clearRemote({ userPrivkey: userKey.privateKey, relays });
        setSyncLog(`<div>Targeted <strong>${out.targeted}</strong> remote events. Delete-request batches published: <strong>${out.published}</strong>; failed: ${out.failed}.</div>`);
        toast('Clear sent', 'success', 4000);
    } catch (err) {
        setSyncLog(`<div style="color:var(--xr-danger)">${escapeHtml(err.message || String(err))}</div>`);
        toast('Clear failed: ' + (err.message || err), 'error', 5000);
    }
}

// ------------------------------------------------------------------
// Wire up
// ------------------------------------------------------------------

async function init() {
    try { installEntityStorageBridge(); } catch (_) { /* idempotent */ }
    try { await LocalKeyManager.init(); } catch (err) {
        console.warn('[X-Ray Sidepanel] LocalKeyManager init failed:', err);
    }
    await refreshEntities();

    // Filter chips.
    document.querySelectorAll('.xr-side__list-view .xr-side__type-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.xr-side__list-view .xr-side__type-chip').forEach((c) =>
                c.classList.remove('xr-side__type-chip--active'));
            chip.classList.add('xr-side__type-chip--active');
            state.typeFilter = chip.dataset.type || '';
            renderList();
        });
    });

    // Search.
    $('#xr-search').addEventListener('input', (ev) => {
        state.searchQuery = ev.target.value;
        renderList();
    });

    // Header buttons.
    $('#xr-new-entity').addEventListener('click', openCreateModal);

    // Detail view buttons.
    $('#xr-back').addEventListener('click', () => {
        setView('list');
        renderList();
    });
    $('#xr-delete').addEventListener('click', deleteSelected);

    // Footer: export / import.
    $('#xr-export').addEventListener('click', exportRegistry);
    $('#xr-import').addEventListener('click', () => $('#xr-import-input').click());
    $('#xr-import-input').addEventListener('change', (ev) => {
        const file = ev.target.files && ev.target.files[0];
        if (file) handleImport(file);
        ev.target.value = '';   // allow re-importing the same file
    });

    // Listen for storage changes so another tab that creates/edits an
    // entity (e.g. the reader's tagger) reflects in this panel without
    // a manual reload. Phase 11.5 adds the judgment keys: assessing or
    // linking in the reader live-refreshes the case dashboard
    // (renderDetail repaints network claims from the stash, so loaded
    // results survive the re-render).
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local') return;
            if ('entities' in changes || 'local_keys' in changes
                || 'article_claims' in changes
                || 'claim_assessments' in changes
                || 'evidence_links' in changes) {
                refreshEntities().then(() => {
                    if (state.view === 'list') renderList();
                    else if (state.selectedId) {
                        EntityModel.get(state.selectedId).then((e) => { if (e) renderDetail(e); });
                    }
                });
            }
        });
    }

    // Sync section — render once on init so the summary-label
    // ("configured" vs. "not configured") is accurate before the user
    // opens the `<details>`. Re-renders happen after every sync action
    // that mutates identity or the entity set.
    renderSyncBody();
    const syncSection = $('#xr-sync-section');
    if (syncSection) {
        syncSection.addEventListener('toggle', () => {
            if (syncSection.open) renderSyncBody();
        });
    }

    renderList();
    setView('list');
}

document.addEventListener('DOMContentLoaded', init);

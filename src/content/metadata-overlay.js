// Live-page metadata overlay — Phase 9b read flow.
//
// Spec: XRAY_METADATA_SPEC.md §9.1 (badge) + §9.2 (panel); NIP_DRAFT.md.
//
// On a normal page (when the `metadataOverlay` feature flag is on), this
// fetches all NOSTR metadata anchored to the current URL and surfaces it
// as a small bottom-left badge with a trust-filtered count. Clicking the
// badge opens a panel listing the annotations + the articles that respond
// to this URL. Read-only — authoring lands in 9b.3.
//
// Consumes the Phase 9b.1 query foundation (relay-query.js), the Phase 9a
// trust graph + ranker, and the existing SW `xray:relay:query` handler.
// Follows the FAB's content-script convention (nac-reset class +
// content.css), bottom-left to mirror the bottom-right capture FAB.

import { Utils } from '../shared/utils.js';
import { Crypto } from '../shared/crypto.js';
import { Storage } from '../shared/storage.js';
import { Signer } from '../shared/signer.js';
import { fetchMetadataForUrl } from '../shared/metadata/relay-query.js';
import { composeGraph } from '../shared/metadata/trust-graph.js';
import { rankAnnotations } from '../shared/metadata/ranker.js';
import { isEnabled } from '../shared/metadata/feature-flags.js';

const browserApi = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

let _installed = false;
const _state = { url: null, ranked: null, responses: [], graph: null, panelOpen: false };

// ── SW-backed single-filter relay query (the injected transport) ───────

async function queryOne(relays, filter) {
  try {
    const resp = await browserApi.runtime.sendMessage({
      type: 'xray:relay:query', relays, filter, timeoutMs: 5000
    });
    return (resp && resp.ok && Array.isArray(resp.events)) ? resp.events : [];
  } catch (_) {
    return [];
  }
}

async function readReadRelays() {
  try {
    const { relays } = await Storage.relays.get();
    return (relays || []).filter((r) => r.enabled && r.read).map((r) => r.url);
  } catch (_) { return []; }
}

// Best-effort trust graph for the signed-in user. Null when there's no
// usable signing identity (then everything ranks as "outside your graph").
async function loadTrustGraph(relays) {
  let pubkey = null;
  try { pubkey = await Signer.getPublicKey(); } catch (_) { return null; }
  if (!pubkey) return null;
  const contactLists = await queryOne(relays, { kinds: [3], authors: [pubkey], limit: 1 });
  const topicTrust   = await queryOne(relays, { kinds: [30053], authors: [pubkey], limit: 500 });
  try {
    return composeGraph({ pubkey, contactList: contactLists[0] || null, topicTrustEvents: topicTrust || [] });
  } catch (_) { return null; }
}

// ── Install + fetch pipeline ───────────────────────────────────────────

export async function installMetadataOverlay() {
  if (_installed) return;
  if (!isEnabled('metadataOverlay')) return;     // opt-in; default off
  // Skip non-http(s) pages (extension pages, chrome://, etc.).
  if (!/^https?:$/.test(location.protocol)) return;
  _installed = true;

  _state.url = Utils.normalizeUrl(location.href);
  createBadge();
  setBadge('…', 'loading', 'Looking up metadata…');

  const relays = await readReadRelays();
  if (relays.length === 0) {
    setBadge('', 'hidden', 'No read relays configured');
    return;
  }

  let data, graph;
  try {
    [data, graph] = await Promise.all([
      fetchMetadataForUrl(_state.url, { relays, queryOne }),
      loadTrustGraph(relays)
    ]);
  } catch (err) {
    Utils.log('metadata overlay fetch failed:', err && err.message);
    setBadge('!', 'error', 'Metadata lookup failed');
    return;
  }

  _state.graph = graph;
  _state.responses = data.respondsTo || [];
  // Rank annotations + highlights together (both are "annotations" UX-wise).
  const annos = [].concat(data.annotations || [], data.highlights || []);
  _state.ranked = rankAnnotations(annos, graph || composeGraph({ pubkey: 'anon' }), {
    includeUntrusted: true
  });

  const trustedCount = _state.ranked.trusted.length;
  const total = annos.length + _state.responses.length;
  if (total === 0) {
    setBadge('', 'hidden', 'No metadata on this page');
    return;
  }
  // Badge shows the trust-filtered count when a graph exists, else the
  // total. Color stays neutral in 9b (fact-check tiers arrive in 9c).
  const shown = graph ? (trustedCount + _state.responses.length) : total;
  setBadge(String(shown), 'has', `${total} metadata item(s) on this page`);
}

// ── Badge ──────────────────────────────────────────────────────────────

let _badgeEl = null;

function createBadge() {
  if (_badgeEl) return;
  const b = document.createElement('button');
  b.className = 'nac-meta-badge nac-reset';
  b.type = 'button';
  b.setAttribute('aria-label', 'X-Ray metadata for this page');
  b.addEventListener('click', togglePanel);
  document.body.appendChild(b);
  _badgeEl = b;
}

function setBadge(text, mode, title) {
  if (!_badgeEl) return;
  _badgeEl.dataset.mode = mode;
  _badgeEl.title = title || '';
  _badgeEl.hidden = (mode === 'hidden');
  _badgeEl.innerHTML = `<span class="nac-meta-badge__glyph">🩻</span>` +
    (text ? `<span class="nac-meta-badge__count">${Utils.escapeHtml(text)}</span>` : '');
}

// ── Panel ────────────────────────────────────────────────────────────

let _panelEl = null;

function togglePanel() {
  _state.panelOpen ? closePanel() : openPanel();
}

function openPanel() {
  if (!_panelEl) createPanel();
  renderPanel();
  _panelEl.classList.add('visible');
  _state.panelOpen = true;
}

function closePanel() {
  if (_panelEl) _panelEl.classList.remove('visible');
  _state.panelOpen = false;
}

function createPanel() {
  const p = document.createElement('div');
  p.className = 'nac-meta-panel nac-reset';
  p.innerHTML = `
    <div class="nac-meta-panel__head">
      <span class="nac-meta-panel__title">Metadata for this page</span>
      <button type="button" class="nac-meta-panel__close" aria-label="Close">✕</button>
    </div>
    <div class="nac-meta-panel__tabs">
      <button type="button" class="nac-meta-tab nac-meta-tab--active" data-tab="annotations">Annotations</button>
      <button type="button" class="nac-meta-tab" data-tab="responses">Responses</button>
    </div>
    <div class="nac-meta-panel__body" id="nac-meta-body"></div>
  `;
  document.body.appendChild(p);
  _panelEl = p;
  p.querySelector('.nac-meta-panel__close').addEventListener('click', closePanel);
  p.querySelectorAll('.nac-meta-tab').forEach((t) => {
    t.addEventListener('click', () => {
      p.querySelectorAll('.nac-meta-tab').forEach((x) => x.classList.toggle('nac-meta-tab--active', x === t));
      renderPanel(t.dataset.tab);
    });
  });
  // Esc closes.
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && _state.panelOpen) closePanel(); });
}

function renderPanel(tab) {
  const active = tab || (_panelEl.querySelector('.nac-meta-tab--active') || {}).dataset?.tab || 'annotations';
  const body = _panelEl.querySelector('#nac-meta-body');
  if (active === 'responses') {
    body.innerHTML = renderResponses(_state.responses);
    return;
  }
  body.innerHTML = renderAnnotations(_state.ranked);
}

function renderAnnotations(ranked) {
  if (!ranked) return `<div class="nac-meta-empty">Loading…</div>`;
  const trusted = ranked.trusted || [];
  const untrusted = ranked.untrusted || [];
  if (trusted.length === 0 && untrusted.length === 0) {
    return `<div class="nac-meta-empty">No annotations on this page yet. Be the first — select text and choose “Annotate”. <em>(Authoring lands in the next update.)</em></div>`;
  }
  let html = trusted.map(renderAnnotationCard).join('');
  if (untrusted.length > 0) {
    html += `<details class="nac-meta-more"><summary>Show ${untrusted.length} from outside your trust graph</summary>${untrusted.map(renderAnnotationCard).join('')}</details>`;
  }
  return html;
}

function renderAnnotationCard(ev) {
  const author = shortNpub(ev.pubkey);
  const when = ev.created_at ? Utils.formatDate(ev.created_at) : '';
  const parsed = parseAnnotationContent(ev);
  const motivation = motivationOf(ev);
  const quote = parsed.exact
    ? `<blockquote class="nac-meta-quote">${Utils.escapeHtml(truncate(parsed.exact, 180))}</blockquote>` : '';
  const bodyText = parsed.body
    ? `<div class="nac-meta-body-text">${Utils.escapeHtml(truncate(parsed.body, 600)).replace(/\n/g, '<br>')}</div>` : '';
  return `<article class="nac-meta-card">
    <header class="nac-meta-card__head">
      ${motivation ? `<span class="nac-meta-chip">${Utils.escapeHtml(motivation)}</span>` : ''}
      <span class="nac-meta-author">${Utils.escapeHtml(author)}</span>
      ${when ? `<span class="nac-meta-when">${Utils.escapeHtml(when)}</span>` : ''}
    </header>
    ${quote}
    ${bodyText}
  </article>`;
}

function renderResponses(responses) {
  if (!responses || responses.length === 0) {
    return `<div class="nac-meta-empty">No published articles respond to this page.</div>`;
  }
  return responses.map((ev) => {
    const title = tagValue(ev, 'title') || '(untitled article)';
    const rel = respondsRelationship(ev, _state.url);
    const author = shortNpub(ev.pubkey);
    return `<article class="nac-meta-card">
      <header class="nac-meta-card__head">
        ${rel ? `<span class="nac-meta-chip">${Utils.escapeHtml(rel)}</span>` : ''}
        <span class="nac-meta-author">${Utils.escapeHtml(author)}</span>
      </header>
      <div class="nac-meta-resp-title">${Utils.escapeHtml(truncate(title, 140))}</div>
    </article>`;
  }).join('');
}

// ── content parsing helpers ────────────────────────────────────────────

function parseAnnotationContent(ev) {
  // Highlights (kind 9802) carry plain text content; annotations (30050)
  // carry a JSON-LD body.
  if (ev.kind === 9802) return { body: String(ev.content || ''), exact: '' };
  try {
    const obj = JSON.parse(ev.content || '{}');
    const body = obj.body && obj.body.value ? String(obj.body.value) : '';
    let exact = '';
    const sels = obj.target && obj.target.selector;
    if (Array.isArray(sels)) {
      const tq = sels.find((s) => s && s.type === 'TextQuoteSelector');
      if (tq && tq.exact) exact = String(tq.exact);
    }
    return { body, exact };
  } catch (_) {
    return { body: String(ev.content || ''), exact: '' };
  }
}

function motivationOf(ev) {
  const m = (ev.tags || []).find((t) => Array.isArray(t) && t[0] === 'motivation');
  if (m && m[1]) return m[1];
  return ev.kind === 9802 ? 'highlight' : 'comment';
}

function respondsRelationship(ev, url) {
  const t = (ev.tags || []).find((x) => Array.isArray(x) && x[0] === 'responds-to' && typeof x[1] === 'string' && Utils.normalizeUrl(x[1]) === url);
  return t ? (t[2] || 'responds to') : 'responds to';
}

function tagValue(ev, name) {
  const t = (ev.tags || []).find((x) => Array.isArray(x) && x[0] === name);
  return t ? t[1] : null;
}

function shortNpub(hexPubkey) {
  try {
    const npub = Crypto.hexToNpub(hexPubkey);
    return npub ? npub.slice(0, 12) + '…' + npub.slice(-4) : (hexPubkey || '').slice(0, 8);
  } catch (_) { return (hexPubkey || '').slice(0, 8); }
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n).trimEnd() + '…' : s;
}

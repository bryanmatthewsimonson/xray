// Annotation author flow — Phase 9b.4.
//
// Spec: XRAY_METADATA_SPEC.md §9.3 + NIP_DRAFT.md kind 30050 / 9802.
//
// Select text on any page → a small popover offers "Annotate" (opens a
// modal: motivation + body, anchored to the selection) or "Highlight"
// (one-click kind-9802). Publishes the signed event through the existing
// SW relay-publish path. Gated behind the same `metadataOverlay` flag as
// the read overlay, so the whole live-page metadata experience is one
// opt-in and users who haven't enabled it never see an annotate popover.
//
// Building blocks (all pre-built + tested): captureFromSelection
// (anchor-capture), buildAnnotationEvent / buildHighlightEvent
// (builders), Signer (sign), and the SW `xray:relay:publish` handler.

import { Utils } from '../shared/utils.js';
import { Storage } from '../shared/storage.js';
import { Signer } from '../shared/signer.js';
import { captureFromSelection } from '../shared/metadata/anchor-capture.js';
import {
  buildAnnotationEvent, buildHighlightEvent,
  ANNOTATION_MOTIVATIONS, CORRECTION_TYPES
} from '../shared/metadata/builders.js';
import { isEnabled } from '../shared/metadata/feature-flags.js';
import { refreshMetadataOverlay } from './metadata-overlay.js';

const browserApi = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

let _installed = false;
let _popover = null;
let _modal = null;
let _pendingCapture = null;   // { selectors, fullExact, exact } from the last selection

export function installMetadataAuthor() {
  if (_installed) return;
  if (!isEnabled('metadataOverlay')) return;
  if (!/^https?:$/.test(location.protocol)) return;
  _installed = true;
  document.addEventListener('selectionchange', Utils.debounce(onSelectionChange, 250));
  // Dismiss the popover when clicking elsewhere (but not inside it).
  document.addEventListener('mousedown', (e) => {
    if (_popover && _popover.classList.contains('visible') && !_popover.contains(e.target)) hidePopover();
  }, true);
}

// ── selection → popover ────────────────────────────────────────────────

function onSelectionChange() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { hidePopover(); return; }
  const text = String(sel.toString() || '').trim();
  if (text.length < 2) { hidePopover(); return; }
  // Ignore selections inside our own UI (popover / modal / FAB panel).
  const anchorNode = sel.anchorNode;
  if (anchorNode && anchorNode.parentElement && anchorNode.parentElement.closest('.nac-reset')) {
    return;
  }
  let rect;
  try { rect = sel.getRangeAt(0).getBoundingClientRect(); } catch (_) { return; }
  showPopover(rect);
}

function showPopover(rect) {
  if (!_popover) createPopover();
  // Position above the selection, clamped to the viewport.
  const top = Math.max(8, rect.top - 44);
  const left = Math.min(window.innerWidth - 180, Math.max(8, rect.left));
  _popover.style.top = `${top}px`;
  _popover.style.left = `${left}px`;
  _popover.classList.add('visible');
}

function hidePopover() {
  if (_popover) _popover.classList.remove('visible');
}

function createPopover() {
  const el = document.createElement('div');
  el.className = 'nac-anno-popover nac-reset';
  el.innerHTML = `
    <button type="button" class="nac-anno-popover__btn" data-act="annotate">🩻 Annotate</button>
    <button type="button" class="nac-anno-popover__btn" data-act="highlight">Highlight</button>
  `;
  document.body.appendChild(el);
  _popover = el;
  el.querySelector('[data-act="annotate"]').addEventListener('click', onAnnotateClick);
  el.querySelector('[data-act="highlight"]').addEventListener('click', onHighlightClick);
}

function captureCurrentSelection() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const out = captureFromSelection(sel, document.body);
  if (!out || !out.selectors || out.selectors.length === 0) return null;
  const tq = out.selectors.find((s) => s.type === 'TextQuoteSelector');
  return { selectors: out.selectors, fullExact: out.fullExact, exact: (tq && tq.exact) || out.fullExact };
}

// ── Highlight (one-click) ──────────────────────────────────────────────

async function onHighlightClick() {
  const sel = window.getSelection();
  const text = sel ? String(sel.toString() || '').trim() : '';
  hidePopover();
  if (!text) return;
  let unsigned;
  try {
    unsigned = buildHighlightEvent({ url: Utils.normalizeUrl(location.href), text }).event;
  } catch (e) { toast('Highlight failed: ' + (e && e.message), 'error'); return; }
  await publishEvent(unsigned, 'Highlight');
}

// ── Annotate (modal) ───────────────────────────────────────────────────

function onAnnotateClick() {
  _pendingCapture = captureCurrentSelection();
  hidePopover();
  openModal();
}

function openModal() {
  if (!_modal) createModal();
  // Reset fields + show the anchored quote.
  const quoteEl = _modal.querySelector('#nac-anno-quote');
  if (_pendingCapture && _pendingCapture.exact) {
    quoteEl.textContent = truncate(_pendingCapture.exact, 220);
    quoteEl.parentElement.style.display = '';
  } else {
    quoteEl.parentElement.style.display = 'none';   // page-level annotation
  }
  _modal.querySelector('#nac-anno-body').value = '';
  _modal.querySelector('#nac-anno-topic').value = '';
  const mot = _modal.querySelector('input[name="nac-anno-mot"][value="commenting"]');
  if (mot) mot.checked = true;
  syncCorrectionVisibility();
  _modal.classList.add('visible');
  setTimeout(() => _modal.querySelector('#nac-anno-body').focus(), 0);
}

function closeModal() { if (_modal) _modal.classList.remove('visible'); }

function createModal() {
  const m = document.createElement('div');
  m.className = 'nac-anno-modal nac-reset';
  const motRadios = ANNOTATION_MOTIVATIONS.map((mv, i) => `
    <label class="nac-anno-radio">
      <input type="radio" name="nac-anno-mot" value="${mv}" ${i === 0 ? 'checked' : ''}>
      <span>${mv}</span>
    </label>`).join('');
  const corrOpts = CORRECTION_TYPES.map((c) => `<option value="${c}">${c}</option>`).join('');
  m.innerHTML = `
    <div class="nac-anno-modal__card">
      <div class="nac-anno-modal__head">
        <span class="nac-anno-modal__title">Annotate this page</span>
        <button type="button" class="nac-anno-modal__close" aria-label="Close">✕</button>
      </div>
      <div class="nac-anno-field" id="nac-anno-quote-wrap">
        <label>Anchored to</label>
        <blockquote class="nac-anno-quote" id="nac-anno-quote"></blockquote>
      </div>
      <div class="nac-anno-field">
        <label>Motivation</label>
        <div class="nac-anno-radios">${motRadios}</div>
      </div>
      <div class="nac-anno-field" id="nac-anno-corr-wrap" style="display:none">
        <label>Correction type</label>
        <select id="nac-anno-corr">${corrOpts}</select>
      </div>
      <div class="nac-anno-field">
        <label for="nac-anno-body">Your note (Markdown)</label>
        <textarea id="nac-anno-body" rows="5" placeholder="What do you want to say about this?"></textarea>
      </div>
      <div class="nac-anno-field">
        <label for="nac-anno-topic">Topics (optional, comma-separated)</label>
        <input type="text" id="nac-anno-topic" placeholder="bitcoin, monetary-policy">
      </div>
      <div class="nac-anno-modal__actions">
        <button type="button" class="nac-anno-btn nac-anno-btn--primary" id="nac-anno-publish">Sign &amp; publish</button>
        <button type="button" class="nac-anno-btn" id="nac-anno-cancel">Cancel</button>
        <span class="nac-anno-status" id="nac-anno-status"></span>
      </div>
    </div>
  `;
  document.body.appendChild(m);
  _modal = m;
  m.querySelector('.nac-anno-modal__close').addEventListener('click', closeModal);
  m.querySelector('#nac-anno-cancel').addEventListener('click', closeModal);
  m.addEventListener('click', (e) => { if (e.target === m) closeModal(); });
  m.querySelectorAll('input[name="nac-anno-mot"]').forEach((r) => r.addEventListener('change', syncCorrectionVisibility));
  m.querySelector('#nac-anno-publish').addEventListener('click', onPublishAnnotation);
}

function selectedMotivation() {
  const r = _modal.querySelector('input[name="nac-anno-mot"]:checked');
  return r ? r.value : 'commenting';
}

function syncCorrectionVisibility() {
  if (!_modal) return;
  _modal.querySelector('#nac-anno-corr-wrap').style.display =
    selectedMotivation() === 'correcting' ? '' : 'none';
}

async function onPublishAnnotation() {
  const status = _modal.querySelector('#nac-anno-status');
  const body = _modal.querySelector('#nac-anno-body').value.trim();
  if (!body) { setStatus(status, 'Write a note first.', false); return; }
  const motivation = selectedMotivation();
  const topic = _modal.querySelector('#nac-anno-topic').value
    .split(',').map((s) => s.trim()).filter(Boolean);
  const correctionType = motivation === 'correcting'
    ? _modal.querySelector('#nac-anno-corr').value : null;

  setStatus(status, 'Signing…');
  let unsigned;
  try {
    const built = await buildAnnotationEvent({
      url: Utils.normalizeUrl(location.href),
      motivation,
      bodyMarkdown: body,
      selectors: (_pendingCapture && _pendingCapture.selectors) || [],
      topic,
      correctionType
    });
    unsigned = built.event;
  } catch (e) {
    setStatus(status, 'Build failed: ' + (e && e.message), false); return;
  }
  const ok = await publishEvent(unsigned, 'Annotation', (msg, good) => setStatus(status, msg, good));
  if (ok) { setTimeout(closeModal, 900); }
}

// ── shared publish ─────────────────────────────────────────────────────

async function writeRelays() {
  try {
    const { relays } = await Storage.relays.get();
    return (relays || []).filter((r) => r.enabled && r.write).map((r) => r.url);
  } catch (_) { return []; }
}

async function publishEvent(unsigned, label, onStatus) {
  const report = (msg, good) => { (onStatus || ((m, g) => toast(m, g ? 'success' : 'error')))(msg, good); };
  if (!(await Signer.isConfigured()) || !(await Signer.isReady())) {
    report('Set up signing first (Settings → Signing).', false);
    return false;
  }
  let signed;
  try { signed = await Signer.signEvent(unsigned); }
  catch (e) { report(label + ' signing failed: ' + (e && e.message), false); return false; }
  if (!signed || !signed.id || !signed.sig) { report(label + ': signer returned an invalid event', false); return false; }
  const relays = await writeRelays();
  if (relays.length === 0) { report('No write-enabled relays (Settings → Relays).', false); return false; }
  if (onStatus) onStatus('Publishing…');
  try {
    const resp = await browserApi.runtime.sendMessage({ type: 'xray:relay:publish', relays, event: signed });
    const n = resp && resp.ok && resp.results ? resp.results.successful : 0;
    if (n > 0) {
      report(`${label} published to ${n} relay(s).`, true);
      try { refreshMetadataOverlay(); } catch (_) {}
      return true;
    }
    report(`${label} publish failed: no relay accepted it.`, false);
    return false;
  } catch (e) {
    report(`${label} publish failed: ` + (e && e.message), false);
    return false;
  }
}

// ── tiny helpers ───────────────────────────────────────────────────────

let _toastEl = null;
function toast(msg, type = 'success') {
  if (!_toastEl) {
    _toastEl = document.createElement('div');
    _toastEl.className = 'nac-anno-toast nac-reset';
    document.body.appendChild(_toastEl);
  }
  _toastEl.textContent = msg;
  _toastEl.dataset.type = type;
  _toastEl.classList.add('visible');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => _toastEl.classList.remove('visible'), 3500);
}

function setStatus(el, msg, ok = true) {
  if (!el) return;
  el.textContent = msg;
  el.dataset.ok = ok ? '1' : '0';
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n).trimEnd() + '…' : s;
}

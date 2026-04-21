// Main UI: FAB + article capture panel (Readable + Markdown tabs).
// Ported from the userscript. Differences vs the userscript:
//   - GM_addStyle is replaced by manifest content_scripts.css.
//   - GM_registerMenuCommand is replaced by chrome.contextMenus, registered
//     in the background service worker; UI.toggle/exportKeypairs/viewKeypairs
//     are dispatched via chrome.runtime messages instead.
//   - The v1-era "Metadata" tab (annotation/fact-check/rating publishing UI
//     against kinds 32123–32144) has been removed as part of the push toward
//     userscript v4.2 parity. See roadmap: #20, Phase 0: #11.

import { CONFIG } from '../shared/config.js';
import { Utils } from '../shared/utils.js';
import { Storage } from '../shared/storage.js';
import { ContentExtractor } from '../shared/content-extractor.js';
import { ContentDetector } from '../shared/content-detector.js';
import { captureForPlatform, enrichArticleForPlatform, detectPlatformFromDom } from '../shared/platforms/index.js';
import { EventBuilder } from '../shared/event-builder.js';
import { NSecBunkerClient } from '../shared/nsecbunker-client.js';
import { NIP07Client } from './nip07-client.js';

export const UI = {
  elements: {},
  state: {
    isOpen: false,
    activeTab: 'readable',
    article: null,
    markdown: ''
  },

  icons: {
    book: '<svg viewBox="0 0 24 24"><path d="M21 4H3a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM3 19V6h8v13H3zm18 0h-8V6h8v13z"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>',
    chevronDown: '<svg viewBox="0 0 24 24"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>',
    add: '<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>',
    person: '<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>',
    business: '<svg viewBox="0 0 24 24"><path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/></svg>',
    article: '<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>',
    warning: '<svg viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>'
  },

  init: () => {
    Utils.log('Initializing UI...');
    UI.createFAB();
    UI.createOverlay();
    UI.createPanel();
    Utils.log('UI initialized');
  },

  createFAB: () => {
    const fab = document.createElement('button');
    fab.className = 'nac-fab nac-reset';
    fab.innerHTML = UI.icons.book;
    fab.title = 'X-Ray — Capture in reader';
    fab.addEventListener('click', () => UI.openReader());
    document.body.appendChild(fab);
    UI.elements.fab = fab;

    // Phase 7 C6: if the current URL has an entry in the archive
    // cache, add a 📦 badge so the user knows a prior capture exists.
    // Fire-and-forget — FAB appears immediately; badge catches up
    // when the IDB round trip finishes. Re-checks on SPA nav are
    // handled by the Phase 4-era URL-change observer if present;
    // otherwise the badge reflects the URL at mount time.
    UI.refreshArchiveBadge().catch(() => {});
  },

  refreshArchiveBadge: async () => {
    try {
      const { hasArticle } = await import('../shared/archive-cache.js');
      const url = window.location.href;
      const hit = await hasArticle(url);
      const fab = UI.elements.fab;
      if (!fab) return;
      fab.classList.toggle('nac-fab--archived', hit);
      if (hit) fab.title = 'X-Ray — Capture in reader (📦 archive available)';
      else     fab.title = 'X-Ray — Capture in reader';
    } catch (err) {
      // IDB might not be ready on a fresh install; that's fine — no badge.
      Utils.log('archive badge check skipped:', err && err.message);
    }
  },

  // Extract the current page, hand off to the background SW, and let
  // it open the reader as a new tab. Replaces the v1 in-page panel
  // (UI.toggle) as the primary capture entry point.
  openReader: async () => {
    try {
      // 1. Platform detection first — some platforms (YouTube, later
      //    Twitter) aren't article-shaped and need to be synthesized
      //    from scratch rather than run through Readability.
      const detection = ContentDetector.detect();
      const platform = detection?.platform || detectPlatformFromDom();

      let enriched = await captureForPlatform(platform);

      // 2. If no synthesizer handled the page, fall back to Readability
      //    + platform-specific enrichment (Substack's path).
      if (!enriched) {
        const article = ContentExtractor.extractArticle();
        if (!article) {
          UI.showToast('Could not extract an article from this page.', 'error');
          return;
        }
        enriched = await enrichArticleForPlatform(article, platform);
      }

      // 3. Hand off to the reader via the background SW.
      const id = (crypto.randomUUID && crypto.randomUUID()) ||
                 (Date.now().toString(36) + Math.random().toString(36).slice(2));
      const resp = await chrome.runtime.sendMessage({
        type: 'xray:reader:open',
        id,
        article: enriched
      });
      if (!resp || !resp.ok) {
        throw new Error(resp?.error || 'Service worker did not acknowledge');
      }
    } catch (err) {
      Utils.error('openReader failed:', err);
      UI.showToast('Could not open reader: ' + (err.message || err), 'error');
    }
  },

  createOverlay: () => {
    const overlay = document.createElement('div');
    overlay.className = 'nac-overlay nac-reset';
    overlay.addEventListener('click', () => UI.close());
    document.body.appendChild(overlay);
    UI.elements.overlay = overlay;
  },

  createPanel: () => {
    const panel = document.createElement('div');
    panel.className = 'nac-panel nac-reset';
    panel.innerHTML = `
      <div class="nac-panel-header">
        <div class="nac-panel-title">
          ${UI.icons.book}
          <span>X-Ray — Article Capture</span>
          <span class="nac-signing-status" id="nac-signing-status" title="Signing: Checking...">
            <span class="nac-status-dot connecting" id="nac-status-dot"></span>
            <span class="nac-status-text" id="nac-status-text" style="font-size: 11px; margin-left: 4px; color: var(--nac-text-muted);"></span>
          </span>
        </div>
        <div class="nac-panel-controls">
          <button class="nac-btn-icon" id="nac-download" title="Download Markdown">${UI.icons.download}</button>
          <button class="nac-btn-icon" id="nac-close" title="Close (Esc)">${UI.icons.close}</button>
        </div>
      </div>

      <div class="nac-tabs">
        <button class="nac-tab active" data-tab="readable">Readable</button>
        <button class="nac-tab" data-tab="markdown">Markdown</button>
        <div class="nac-tab-spacer"></div>
        <button class="nac-btn-copy" id="nac-copy">${UI.icons.copy}<span>Copy</span></button>
      </div>

      <div class="nac-content" id="nac-content">
        <div class="nac-empty">
          ${UI.icons.article}
          <div class="nac-empty-title">Loading article...</div>
          <div class="nac-empty-text">Please wait while we extract the content</div>
        </div>
      </div>

      <div class="nac-publish">
        <div class="nac-publish-title">Publish to NOSTR</div>

        <div class="nac-form-group">
          <label class="nac-form-label">Publication (signs the event)</label>
          <select class="nac-form-select" id="nac-publication">
            <option value="">Select or create a publication...</option>
            <option value="__new__">+ Create new publication</option>
          </select>
        </div>

        <div class="nac-collapsible" id="nac-new-publication" style="display: none;">
          <div class="nac-collapsible-header">
            <span class="nac-collapsible-title">New Publication Details</span>
            <span class="nac-collapsible-icon">${UI.icons.chevronDown}</span>
          </div>
          <div class="nac-collapsible-content">
            <div class="nac-form-group">
              <label class="nac-form-label">Publication Name</label>
              <input type="text" class="nac-form-input" id="nac-pub-name" placeholder="e.g., The New York Times">
            </div>
            <div class="nac-form-row">
              <div class="nac-form-group">
                <label class="nac-form-label">Type</label>
                <select class="nac-form-select" id="nac-pub-type">
                  <option value="news">News</option>
                  <option value="blog">Blog</option>
                  <option value="social">Social</option>
                  <option value="podcast">Podcast</option>
                  <option value="video">Video Channel</option>
                </select>
              </div>
              <div class="nac-form-group">
                <label class="nac-form-label">Domain</label>
                <input type="text" class="nac-form-input" id="nac-pub-domain" placeholder="e.g., nytimes.com">
              </div>
            </div>
          </div>
        </div>

        <div class="nac-form-group">
          <label class="nac-form-label">Author (referenced in event)</label>
          <select class="nac-form-select" id="nac-author">
            <option value="">Select or create an author...</option>
            <option value="__new__">+ Create new person</option>
          </select>
        </div>

        <div class="nac-collapsible" id="nac-new-author" style="display: none;">
          <div class="nac-collapsible-header">
            <span class="nac-collapsible-title">New Person Details</span>
            <span class="nac-collapsible-icon">${UI.icons.chevronDown}</span>
          </div>
          <div class="nac-collapsible-content">
            <div class="nac-form-group">
              <label class="nac-form-label">Full Name</label>
              <input type="text" class="nac-form-input" id="nac-author-name" placeholder="e.g., Jane Doe">
            </div>
          </div>
        </div>

        <div class="nac-form-group">
          <label class="nac-form-label">Tags</label>
          <div class="nac-tags-container" id="nac-tags-container">
            <input type="text" class="nac-tag-input" id="nac-tag-input" placeholder="Add tags...">
          </div>
        </div>

        <div class="nac-form-group">
          <label class="nac-form-label">Media Handling</label>
          <div class="nac-radio-group">
            <label class="nac-radio">
              <input type="radio" name="nac-media" value="reference">
              <span>Keep URLs</span>
            </label>
            <label class="nac-radio">
              <input type="radio" name="nac-media" value="embed" checked>
              <span>Embed Images (Base64)</span>
            </label>
          </div>
        </div>

        <div class="nac-collapsible">
          <div class="nac-collapsible-header">
            <span class="nac-collapsible-title">Relays</span>
            <span class="nac-collapsible-icon">${UI.icons.chevronDown}</span>
          </div>
          <div class="nac-collapsible-content">
            <div class="nac-checkbox-group" id="nac-relays">
              ${CONFIG.relays.map(relay => `
                <label class="nac-checkbox">
                  <input type="checkbox" value="${relay.url}" ${relay.enabled ? 'checked' : ''}>
                  <span>${relay.url.replace('wss://', '')}</span>
                </label>
              `).join('')}
            </div>
          </div>
        </div>

        <button class="nac-btn nac-btn-primary" id="nac-publish-btn" disabled>
          ${UI.icons.send}
          <span>Connect Signer to Publish</span>
        </button>
      </div>
    `;

    document.body.appendChild(panel);
    UI.elements.panel = panel;
    UI.attachEventListeners();
  },

  attachEventListeners: () => {
    document.getElementById('nac-close').addEventListener('click', () => UI.close());

    document.querySelectorAll('.nac-tab').forEach(tab => {
      tab.addEventListener('click', () => UI.switchTab(tab.dataset.tab));
    });

    document.getElementById('nac-copy').addEventListener('click', () => UI.copyContent());
    document.getElementById('nac-download').addEventListener('click', () => UI.downloadMarkdown());

    document.getElementById('nac-publication').addEventListener('change', (e) => {
      const newPubForm = document.getElementById('nac-new-publication');
      if (e.target.value === '__new__') {
        newPubForm.style.display = 'block';
        newPubForm.classList.add('open');
      } else {
        newPubForm.style.display = 'none';
      }
      UI.updatePublishButton();
    });

    document.getElementById('nac-pub-name').addEventListener('input', () => UI.updatePublishButton());

    document.getElementById('nac-author').addEventListener('change', (e) => {
      const newAuthorForm = document.getElementById('nac-new-author');
      if (e.target.value === '__new__') {
        newAuthorForm.style.display = 'block';
        newAuthorForm.classList.add('open');
      } else {
        newAuthorForm.style.display = 'none';
      }
    });

    document.querySelectorAll('.nac-collapsible-header').forEach(header => {
      header.addEventListener('click', () => header.parentElement.classList.toggle('open'));
    });

    const tagInput = document.getElementById('nac-tag-input');
    tagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const tag = tagInput.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (tag) {
          UI.addTag(tag);
          tagInput.value = '';
        }
      }
    });

    document.getElementById('nac-publish-btn').addEventListener('click', () => UI.publish());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && UI.state.isOpen) {
        e.preventDefault();
        UI.close();
      }
    });
  },

  toggle: () => { UI.state.isOpen ? UI.close() : UI.open(); },

  open: async () => {
    UI.state.isOpen = true;
    UI.elements.overlay.classList.add('visible');
    UI.elements.panel.classList.add('visible');
    UI.elements.fab.classList.add('active');
    await UI.loadArticle();
    await UI.loadEntities();
  },

  close: () => {
    UI.state.isOpen = false;
    UI.elements.overlay.classList.remove('visible');
    UI.elements.panel.classList.remove('visible');
    UI.elements.fab.classList.remove('active');
  },

  loadArticle: async () => {
    const contentArea = document.getElementById('nac-content');

    contentArea.innerHTML = `
      <div class="nac-empty">
        <div class="nac-spinner"></div>
        <div class="nac-empty-title">Extracting article...</div>
        <div class="nac-empty-text">Please wait</div>
      </div>
    `;

    const article = ContentExtractor.extractArticle();

    if (!article) {
      contentArea.innerHTML = `
        <div class="nac-empty">
          ${UI.icons.warning}
          <div class="nac-empty-title">Could not extract article</div>
          <div class="nac-empty-text">This page may not contain readable article content</div>
        </div>
      `;
      return;
    }

    UI.state.article = article;
    UI.state.markdown = ContentExtractor.htmlToMarkdown(article.content);

    document.getElementById('nac-pub-domain').value = article.domain;
    if (article.byline) {
      document.getElementById('nac-author-name').value = article.byline;
    }

    UI.displayContent();
  },

  displayContent: () => {
    const contentArea = document.getElementById('nac-content');
    const article = UI.state.article;
    if (!article) return;

    if (UI.state.activeTab === 'readable') {
      contentArea.innerHTML = `
        <div class="nac-content-readable">
          <div class="nac-article-meta">
            <h1 class="nac-article-title">${Utils.escapeHtml(article.title)}</h1>
            <div class="nac-article-info">
              ${article.byline ? `<span>${UI.icons.person} ${Utils.escapeHtml(article.byline)}</span>` : ''}
              ${article.publishedAt ? `<span>📅 ${Utils.formatDate(article.publishedAt)}</span>` : ''}
              <span>🔗 ${article.domain}</span>
            </div>
          </div>
          ${article.content}
        </div>
      `;
    } else if (UI.state.activeTab === 'markdown') {
      contentArea.innerHTML = `<div class="nac-content-markdown">${Utils.escapeHtml(UI.state.markdown)}</div>`;
    }
  },


  switchTab: (tab) => {
    UI.state.activeTab = tab;
    document.querySelectorAll('.nac-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    UI.displayContent();
  },

  loadEntities: async () => {
    const publications = await Storage.publications.getAll();
    const pubSelect = document.getElementById('nac-publication');
    while (pubSelect.options.length > 2) pubSelect.remove(2);
    Object.entries(publications).forEach(([id, pub]) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = pub.name;
      pubSelect.add(option);
    });

    const people = await Storage.people.getAll();
    const authorSelect = document.getElementById('nac-author');
    while (authorSelect.options.length > 2) authorSelect.remove(2);
    Object.entries(people).forEach(([id, person]) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = person.name;
      authorSelect.add(option);
    });

    UI.updatePublishButton();
  },

  addTag: (tag) => {
    const container = document.getElementById('nac-tags-container');
    const input = document.getElementById('nac-tag-input');
    if (container.querySelector(`[data-tag="${tag}"]`)) return;

    const tagEl = document.createElement('span');
    tagEl.className = 'nac-tag';
    tagEl.dataset.tag = tag;
    tagEl.innerHTML = `${tag}<span class="nac-tag-remove">×</span>`;
    tagEl.querySelector('.nac-tag-remove').addEventListener('click', () => tagEl.remove());

    container.insertBefore(tagEl, input);
  },

  getTags: () => {
    const container = document.getElementById('nac-tags-container');
    return Array.from(container.querySelectorAll('.nac-tag')).map(el => el.dataset.tag);
  },

  copyContent: async () => {
    const content = UI.state.activeTab === 'markdown' ? UI.state.markdown : UI.state.article?.textContent;
    if (content) {
      await navigator.clipboard.writeText(content);
      UI.showToast('Copied to clipboard!', 'success');
    }
  },

  downloadMarkdown: () => {
    if (!UI.state.markdown || !UI.state.article) return;

    const blob = new Blob([UI.state.markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${Utils.slugify(UI.state.article.title)}.md`;
    a.click();
    URL.revokeObjectURL(url);

    UI.showToast('Markdown downloaded!', 'success');
  },

  updateSigningStatus: () => {
    const statusEl = document.getElementById('nac-signing-status');
    const dot = document.getElementById('nac-status-dot');
    const textEl = document.getElementById('nac-status-text');
    if (!statusEl || !dot) return;

    dot.classList.remove('connected', 'disconnected', 'connecting');
    const nip07Available = NIP07Client.checkAvailability();

    if (nip07Available) {
      dot.classList.add('connected');
      statusEl.title = 'NIP-07 Extension Available (nos2x, Alby, etc.)';
      if (textEl) textEl.textContent = 'NIP-07';
    } else if (NSecBunkerClient.connected) {
      dot.classList.add('connected');
      statusEl.title = 'NSecBunker Connected';
      if (textEl) textEl.textContent = 'Bunker';
    } else {
      dot.classList.add('disconnected');
      statusEl.title = 'No signing method available. Install a NIP-07 extension or connect NSecBunker.';
      if (textEl) textEl.textContent = 'No Signer';
    }
  },

  updateBunkerStatus: (_status) => UI.updateSigningStatus(),

  updatePublishButton: () => {
    const btn = document.getElementById('nac-publish-btn');
    const pubSelect = document.getElementById('nac-publication');
    const pubValue = pubSelect.value;

    UI.updateSigningStatus();

    const nip07Available = NIP07Client.checkAvailability();
    const hasSigningMethod = nip07Available || NSecBunkerClient.connected;

    if (!UI.state.article) {
      btn.disabled = true;
      btn.innerHTML = `${UI.icons.send}<span>No Article Loaded</span>`;
      return;
    }

    if (!pubValue || pubValue === '') {
      btn.disabled = true;
      btn.innerHTML = `${UI.icons.send}<span>Select Publication</span>`;
      return;
    }

    if (pubValue === '__new__') {
      const pubName = document.getElementById('nac-pub-name').value.trim();
      if (!pubName) {
        btn.disabled = true;
        btn.innerHTML = `${UI.icons.send}<span>Enter Publication Name</span>`;
        return;
      }
    }

    if (!hasSigningMethod) {
      btn.disabled = true;
      btn.innerHTML = `${UI.icons.send}<span>Install Signer Extension</span>`;
      return;
    }

    btn.disabled = false;
    btn.innerHTML = nip07Available
      ? `${UI.icons.send}<span>Publish with Extension</span>`
      : `${UI.icons.send}<span>Publish to NOSTR</span>`;
  },

  publish: async () => {
    const btn = document.getElementById('nac-publish-btn');
    const originalContent = btn.innerHTML;

    try {
      btn.disabled = true;
      btn.innerHTML = `<div class="nac-spinner"></div><span>Preparing...</span>`;

      const pubSelect = document.getElementById('nac-publication');
      const authorSelect = document.getElementById('nac-author');
      const tags = UI.getTags();
      const mediaHandling = document.querySelector('input[name="nac-media"]:checked')?.value || 'reference';
      const selectedRelays = Array.from(document.querySelectorAll('#nac-relays input:checked')).map(cb => cb.value);

      Utils.log('Publish started with relays:', selectedRelays);
      if (selectedRelays.length === 0) throw new Error('Please select at least one relay');

      let publicationId = pubSelect.value;
      let authorId = authorSelect.value;

      if (!publicationId || publicationId === '') {
        throw new Error('Please select or create a publication');
      }

      const nip07Available = NIP07Client.checkAvailability();
      Utils.log('NIP-07 available:', nip07Available);

      let signedEvent;

      if (nip07Available) {
        // ========== NIP-07 SIGNING PATH ==========
        Utils.log('Using NIP-07 extension for signing');
        btn.innerHTML = `<div class="nac-spinner"></div><span>Getting key...</span>`;

        let pubkey;
        try {
          pubkey = await NIP07Client.getPublicKey();
          Utils.log('Got pubkey from NIP-07:', pubkey);
        } catch (e) {
          Utils.error('Failed to get pubkey from NIP-07:', e);
          throw new Error('Failed to get public key from extension. Please unlock your extension and try again.');
        }

        if (publicationId === '__new__') {
          const pubName = document.getElementById('nac-pub-name').value.trim();
          const pubType = document.getElementById('nac-pub-type').value;
          const pubDomain = document.getElementById('nac-pub-domain').value.trim();

          if (!pubName) throw new Error('Publication name is required');

          publicationId = 'pub_' + Utils.slugify(pubName) + '_' + Utils.generateId();

          await Storage.publications.save(publicationId, {
            name: pubName,
            type: pubType,
            domain: pubDomain,
            pubkey,
            signingMethod: 'nip07',
            created: Math.floor(Date.now() / 1000)
          });

          await Storage.keypairs.save(publicationId, {
            type: 'publication',
            name: pubName,
            pubkey,
            domain: pubDomain,
            pubType,
            signingMethod: 'nip07',
            created: Math.floor(Date.now() / 1000)
          });

          Utils.log('Created new publication with NIP-07:', publicationId);
        } else {
          const publication = await Storage.publications.get(publicationId);
          if (publication && (!publication.pubkey || publication.pubkey !== pubkey)) {
            Utils.log('Updating publication pubkey from NIP-07');
            await Storage.publications.save(publicationId, {
              ...publication,
              pubkey,
              signingMethod: 'nip07'
            });
            await Storage.keypairs.save(publicationId, {
              type: 'publication',
              name: publication.name,
              pubkey,
              domain: publication.domain,
              pubType: publication.type,
              signingMethod: 'nip07',
              created: publication.created || Math.floor(Date.now() / 1000)
            });
          }
        }

        let authorPubkey = null;
        if (authorId === '__new__') {
          const authorName = document.getElementById('nac-author-name').value.trim();
          if (!authorName) throw new Error('Author name is required');

          authorId = 'person_' + Utils.slugify(authorName) + '_' + Utils.generateId();
          await Storage.people.save(authorId, {
            name: authorName,
            pubkey: null,
            created: Math.floor(Date.now() / 1000)
          });
          Utils.log('Created new author:', authorId);
        } else if (authorId && authorId !== '') {
          const author = await Storage.people.get(authorId);
          authorPubkey = author?.pubkey;
        }

        const article = { ...UI.state.article, markdown: UI.state.markdown, content: UI.state.markdown };

        Utils.log('Building article event...');
        // v4 builder signature: (article, entities, userPubkey, claims).
        // Entity tagging + claims UIs arrive in Phases 4/5.
        // `authorPubkey` was a v1-era shortcut; the v4 flow represents authors
        // as entities (Phase 4), so we omit it here.
        const event = await EventBuilder.buildArticleEvent(article, [], pubkey, []);
        Utils.log('Built unsigned event:', event);

        btn.innerHTML = `<div class="nac-spinner"></div><span>Sign in extension...</span>`;
        UI.showToast('Please approve the signature in your NOSTR extension...', 'warning');

        try {
          signedEvent = await NIP07Client.signEvent(event);
          Utils.log('Got signed event from NIP-07:', signedEvent);
        } catch (e) {
          Utils.error('NIP-07 signing failed:', e);
          throw new Error('Signing was rejected or failed. Please try again.');
        }

        if (!signedEvent || !signedEvent.id || !signedEvent.sig) {
          Utils.error('Invalid signed event:', signedEvent);
          throw new Error('Extension returned invalid signed event');
        }

        await UI.loadEntities();

      } else {
        // ========== NSECBUNKER SIGNING PATH ==========
        if (!NSecBunkerClient.connected) {
          btn.innerHTML = `<div class="nac-spinner"></div><span>Connecting...</span>`;
          UI.showToast('Connecting to NSecBunker...', 'warning');
          try {
            await NSecBunkerClient.connect();
          } catch (e) {
            Utils.log('NSecBunker not available:', e);
            throw new Error('No signing method available. Please install a NIP-07 browser extension (nos2x, Alby, etc.) or run NSecBunker.');
          }
        }

        if (publicationId === '__new__') {
          const pubName = document.getElementById('nac-pub-name').value.trim();
          const pubType = document.getElementById('nac-pub-type').value;
          const pubDomain = document.getElementById('nac-pub-domain').value.trim();

          if (!pubName) throw new Error('Publication name is required');

          publicationId = 'pub_' + Utils.slugify(pubName) + '_' + Utils.generateId();

          let pubkey = null;
          if (NSecBunkerClient.connected) {
            const keyResult = await NSecBunkerClient.createKey(publicationId, {
              type: 'publication', name: pubName, pubType, domain: pubDomain
            });
            pubkey = keyResult.pubkey;
          } else {
            throw new Error('NSecBunker required to create new publications');
          }

          await Storage.publications.save(publicationId, {
            name: pubName, type: pubType, domain: pubDomain, pubkey,
            created: Math.floor(Date.now() / 1000)
          });
          await Storage.keypairs.save(publicationId, {
            type: 'publication', name: pubName, pubkey, domain: pubDomain,
            pubType, created: Math.floor(Date.now() / 1000)
          });

          Utils.log('Created new publication:', publicationId);
        }

        let authorPubkey = null;
        if (authorId === '__new__') {
          const authorName = document.getElementById('nac-author-name').value.trim();
          if (!authorName) throw new Error('Author name is required');

          authorId = 'person_' + Utils.slugify(authorName) + '_' + Utils.generateId();

          if (NSecBunkerClient.connected) {
            const keyResult = await NSecBunkerClient.createKey(authorId, {
              type: 'person', name: authorName
            });
            authorPubkey = keyResult.pubkey;
          }

          await Storage.people.save(authorId, {
            name: authorName, pubkey: authorPubkey,
            created: Math.floor(Date.now() / 1000)
          });

          if (authorPubkey) {
            await Storage.keypairs.save(authorId, {
              type: 'person', name: authorName, pubkey: authorPubkey,
              created: Math.floor(Date.now() / 1000)
            });
          }

          Utils.log('Created new author:', authorId);
        } else if (authorId && authorId !== '') {
          const author = await Storage.people.get(authorId);
          authorPubkey = author?.pubkey;
        }

        const publication = await Storage.publications.get(publicationId);
        if (!publication) {
          throw new Error('Publication not found. Please select or create a publication.');
        }

        const article = { ...UI.state.article, markdown: UI.state.markdown, content: UI.state.markdown };
        const event = await EventBuilder.buildArticleEvent(article, [], publication.pubkey, []);

        if (!publication.pubkey) {
          throw new Error('Publication key not available. Please reconnect to NSecBunker.');
        }

        btn.innerHTML = `<div class="nac-spinner"></div><span>Signing...</span>`;
        signedEvent = await NSecBunkerClient.signEvent(event, publicationId);
      }

      // ========== PUBLISH TO RELAYS ==========
      btn.innerHTML = `<div class="nac-spinner"></div><span>Publishing...</span>`;
      Utils.log('Publishing signed event to relays...');
      Utils.log('Event ID:', signedEvent.id);
      Utils.log('Event pubkey:', signedEvent.pubkey);
      Utils.log('Event sig:', signedEvent.sig ? signedEvent.sig.substring(0, 20) + '...' : 'MISSING');

      // Relay client lives in the service worker so that WebSocket
      // connections survive tab lifecycle events and are not subject to
      // page CSP. We message the SW and await the result.
      const resp = await chrome.runtime.sendMessage({
        type: 'xray:relay:publish',
        relays: selectedRelays,
        event: signedEvent
      });
      if (!resp || !resp.ok) {
        throw new Error('Relay publish failed: ' + (resp?.error || 'no response from service worker'));
      }
      const results = resp.results;
      Utils.log('Publish results:', results);

      if (results.successful > 0) {
        const confirmedCount = results.results.filter(r => r.success && !r.assumed).length;
        const assumedCount = results.results.filter(r => r.success && r.assumed).length;

        let message = `Published to ${results.successful}/${results.total} relays`;
        if (confirmedCount > 0 && assumedCount > 0) {
          message += ` (${confirmedCount} confirmed, ${assumedCount} likely)`;
        }

        UI.showToast(message + '!', 'success');
        setTimeout(() => UI.close(), 2000);
      } else {
        results.results.forEach(r => {
          if (!r.success) Utils.error('Relay failure:', r.url, r.error);
        });
        throw new Error('Failed to publish to any relay. Check browser console for details.');
      }
    } catch (error) {
      Utils.error('Publish error:', error);
      UI.showToast(error.message || 'Failed to publish', 'error');
    } finally {
      btn.innerHTML = originalContent;
      UI.updatePublishButton();
    }
  },

  showToast: (message, type = 'success') => {
    const existingToast = document.querySelector('.nac-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = `nac-toast nac-reset ${type}`;
    toast.innerHTML = `
      ${type === 'success' ? UI.icons.check : type === 'error' ? UI.icons.close : UI.icons.warning}
      <span>${message}</span>
    `;

    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('visible'), 10);
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },

  exportKeypairs: async () => {
    try {
      const registry = await Storage.keypairs.getAll();
      const count = Object.keys(registry).length;

      if (count === 0) {
        UI.showToast('No keypairs to export', 'warning');
        return;
      }

      const exportData = {
        exported_at: new Date().toISOString(),
        version: CONFIG.version,
        keypairs: registry
      };

      const jsonStr = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nostr-keypair-registry-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);

      UI.showToast(`Exported ${count} keypairs to file`, 'success');
      Utils.log('Exported keypair registry:', count, 'entries');
    } catch (e) {
      Utils.error('Failed to export keypairs:', e);
      UI.showToast('Failed to export keypairs', 'error');
    }
  },

  viewKeypairs: async () => {
    try {
      const registry = await Storage.keypairs.getAll();
      const count = Object.keys(registry).length;

      console.log('=== X-Ray Keypair Registry ===');
      console.log('Total entries:', count);
      console.log(JSON.stringify(registry, null, 2));

      const publications = Object.entries(registry).filter(([, v]) => v.type === 'publication');
      const people       = Object.entries(registry).filter(([, v]) => v.type === 'person');

      let summary = `Keypair Registry: ${count} total\n`;
      summary += `📰 Publications: ${publications.length}\n`;
      publications.forEach(([, data]) => {
        summary += `   • ${data.name} (${data.domain || 'no domain'})\n`;
        summary += `     pubkey: ${data.pubkey ? data.pubkey.substring(0, 16) + '...' : 'pending'}\n`;
      });

      summary += `👤 People: ${people.length}\n`;
      people.forEach(([, data]) => {
        summary += `   • ${data.name}\n`;
        summary += `     pubkey: ${data.pubkey ? data.pubkey.substring(0, 16) + '...' : 'pending'}\n`;
      });

      alert(summary + '\n\nFull details logged to browser console.');
      UI.showToast(`Found ${count} keypairs - see console`, 'success');
    } catch (e) {
      Utils.error('Failed to view keypairs:', e);
      UI.showToast('Failed to view keypairs', 'error');
    }
  }
};

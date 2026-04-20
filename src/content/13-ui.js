// Main UI: FAB + article capture panel + metadata posting forms. Ported
// from the userscript. Differences vs the userscript:
//   - GM_addStyle is replaced by manifest content_scripts.css.
//   - GM_registerMenuCommand is replaced by chrome.contextMenus, registered
//     in the background service worker; UI.toggle/exportKeypairs/viewKeypairs
//     are dispatched via chrome.runtime messages instead.
//   - GM.xmlHttpRequest (fetch-related-title) becomes fetch() with
//     AbortSignal.timeout and relies on host_permissions for CORS bypass.
//   - A handful of bare references (updateMetadataPreview, showToast, url)
//     that were silently broken in the userscript are qualified correctly
//     here (UI.updateMetadataPreview, UI.showToast, normalizedUrl).

var UI = {
  elements: {},
  state: {
    isOpen: false,
    activeTab: 'readable',
    article: null,
    markdown: '',
    metadataType: 'annotation'
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
    fab.title = 'X-Ray — Article Capture';
    fab.addEventListener('click', () => UI.toggle());
    document.body.appendChild(fab);
    UI.elements.fab = fab;
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
        <button class="nac-tab" data-tab="metadata">Metadata</button>
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

    const article = ContentProcessor.extractArticle();

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
    UI.state.markdown = ContentProcessor.htmlToMarkdown(article.content);

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
    } else if (UI.state.activeTab === 'metadata') {
      UI.displayMetadataTab();
    }
  },

  displayMetadataTab: async () => {
    const contentArea = document.getElementById('nac-content');
    const article = UI.state.article;
    if (!article) return;

    const normalizedUrl = Utils.normalizeUrl(article.url);
    const urlHash = await Utils.sha256(normalizedUrl);
    const dTag = urlHash.substring(0, 16);

    contentArea.innerHTML = `
      <div class="nac-metadata-tab-content">
        <div class="nac-url-info">
          <div class="nac-url-info-label">Target URL</div>
          <div class="nac-url-info-value">${Utils.escapeHtml(normalizedUrl)}</div>
          <div class="nac-url-info-hash"><strong>d-tag:</strong> ${dTag}</div>
        </div>

        <div class="nac-metadata-type-selector">
          <button class="nac-type-btn active" data-type="annotation"><span class="nac-type-btn-icon">📝</span><span class="nac-type-btn-label">Annotation</span></button>
          <button class="nac-type-btn" data-type="factcheck"><span class="nac-type-btn-icon">🔍</span><span class="nac-type-btn-label">Fact-Check</span></button>
          <button class="nac-type-btn" data-type="headline"><span class="nac-type-btn-icon">📰</span><span class="nac-type-btn-label">Headline Fix</span></button>
          <button class="nac-type-btn" data-type="reaction"><span class="nac-type-btn-icon">👍</span><span class="nac-type-btn-label">Reaction</span></button>
          <button class="nac-type-btn" data-type="related"><span class="nac-type-btn-icon">🔗</span><span class="nac-type-btn-label">Related</span></button>
          <button class="nac-type-btn" data-type="rating"><span class="nac-type-btn-icon">⭐</span><span class="nac-type-btn-label">Rating</span></button>
          <button class="nac-type-btn" data-type="comment"><span class="nac-type-btn-icon">💬</span><span class="nac-type-btn-label">Comment</span></button>
        </div>

        <div class="nac-metadata-form active" id="nac-form-annotation">
          <div class="nac-form-group">
            <label class="nac-form-label">Annotation Type</label>
            <select class="nac-form-select" id="nac-annotation-type">
              <option value="context">Context / Background</option>
              <option value="correction">Correction</option>
              <option value="update">Update / Follow-up</option>
              <option value="opinion">Opinion / Commentary</option>
              <option value="related">Related Information</option>
            </select>
          </div>
          <div class="nac-form-group">
            <label class="nac-form-label">Annotation Content</label>
            <textarea class="nac-form-textarea" id="nac-annotation-content" placeholder="Enter your annotation about this article..." rows="4" maxlength="2000"></textarea>
            <div class="nac-char-count"><span id="nac-annotation-chars">0</span>/2000</div>
          </div>
          <div class="nac-form-group">
            <label class="nac-form-label">Confidence Level</label>
            <div class="nac-confidence-slider">
              <input type="range" id="nac-annotation-confidence" min="0" max="100" value="80">
              <span class="nac-confidence-value" id="nac-annotation-confidence-value">80%</span>
            </div>
            <div class="nac-form-hint">How confident are you in this annotation?</div>
          </div>
          <div class="nac-form-group">
            <label class="nac-form-label">Evidence URL (Optional)</label>
            <input type="url" class="nac-form-input" id="nac-annotation-evidence" placeholder="https://example.com/source">
          </div>
        </div>

        <div class="nac-metadata-form" id="nac-form-factcheck">
          <div class="nac-form-group">
            <label class="nac-form-label">Claim Being Checked</label>
            <textarea class="nac-form-textarea" id="nac-factcheck-claim" placeholder="What specific claim are you fact-checking?" rows="2" maxlength="200"></textarea>
            <div class="nac-char-count"><span id="nac-factcheck-claim-chars">0</span>/200</div>
          </div>
          <div class="nac-form-group">
            <label class="nac-form-label">Verdict</label>
            <div class="nac-verdict-group">
              <div class="nac-verdict-option verdict-true"><input type="radio" name="nac-verdict" id="nac-verdict-true" value="true"><label for="nac-verdict-true"><span class="nac-verdict-icon">✅</span><span class="nac-verdict-label">True</span></label></div>
              <div class="nac-verdict-option verdict-partially-true"><input type="radio" name="nac-verdict" id="nac-verdict-partial" value="partially-true"><label for="nac-verdict-partial"><span class="nac-verdict-icon">⚠️</span><span class="nac-verdict-label">Partial</span></label></div>
              <div class="nac-verdict-option verdict-false"><input type="radio" name="nac-verdict" id="nac-verdict-false" value="false"><label for="nac-verdict-false"><span class="nac-verdict-icon">❌</span><span class="nac-verdict-label">False</span></label></div>
              <div class="nac-verdict-option verdict-unverifiable"><input type="radio" name="nac-verdict" id="nac-verdict-unverifiable" value="unverifiable"><label for="nac-verdict-unverifiable"><span class="nac-verdict-icon">❓</span><span class="nac-verdict-label">Unknown</span></label></div>
            </div>
          </div>
          <div class="nac-form-group">
            <label class="nac-form-label">Explanation</label>
            <textarea class="nac-form-textarea" id="nac-factcheck-explanation" placeholder="Explain your verdict with evidence..." rows="4" maxlength="2000"></textarea>
            <div class="nac-char-count"><span id="nac-factcheck-explanation-chars">0</span>/2000</div>
          </div>
          <div class="nac-form-group">
            <label class="nac-form-label">Evidence Sources</label>
            <div class="nac-evidence-list" id="nac-evidence-list">
              <div class="nac-evidence-item" data-index="0">
                <div class="nac-evidence-row">
                  <input type="url" class="nac-form-input nac-evidence-url" placeholder="https://source.com/evidence">
                  <select class="nac-form-select nac-evidence-type">
                    <option value="primary">Primary</option>
                    <option value="official">Official</option>
                    <option value="news">News</option>
                    <option value="academic">Academic</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
            </div>
            <button type="button" class="nac-add-evidence" id="nac-add-evidence">${UI.icons.add} Add Evidence Source</button>
          </div>
        </div>

        <div class="nac-metadata-form" id="nac-form-headline">
          <div class="nac-form-group">
            <label class="nac-form-label">Original Headline</label>
            <div class="nac-headline-original">
              <div class="nac-headline-original-text" id="nac-original-headline">${Utils.escapeHtml(article.title)}</div>
              <button type="button" class="nac-headline-edit-btn" id="nac-edit-headline">Edit</button>
            </div>
            <input type="text" class="nac-form-input" id="nac-headline-original-input" value="${Utils.escapeHtml(article.title)}" style="display: none;">
          </div>
          <div class="nac-form-group">
            <label class="nac-form-label">Suggested Headline</label>
            <input type="text" class="nac-form-input" id="nac-headline-suggested" placeholder="Enter a more accurate headline..." maxlength="200">
            <div class="nac-char-count"><span id="nac-headline-chars">0</span>/200</div>
          </div>
          <div class="nac-form-group">
            <label class="nac-form-label">Reason for Correction</label>
            <textarea class="nac-form-textarea" id="nac-headline-reason" placeholder="Explain why this headline needs correction (e.g., clickbait, misleading, sensationalized)..." rows="3" maxlength="1000"></textarea>
            <div class="nac-char-count"><span id="nac-headline-reason-chars">0</span>/1000</div>
          </div>
        </div>

        <div class="nac-metadata-form" id="nac-form-reaction" style="display: none;">
          <div class="nac-form-group">
            <label class="nac-form-label">Quick Reaction</label>
            <div class="nac-emoji-picker" id="nac-reaction-emoji-picker">
              <button type="button" class="nac-emoji-btn" data-emoji="👍" title="Thumbs Up">👍</button>
              <button type="button" class="nac-emoji-btn" data-emoji="👎" title="Thumbs Down">👎</button>
              <button type="button" class="nac-emoji-btn" data-emoji="❤️" title="Love">❤️</button>
              <button type="button" class="nac-emoji-btn" data-emoji="🔥" title="Fire">🔥</button>
              <button type="button" class="nac-emoji-btn" data-emoji="🤔" title="Thinking">🤔</button>
              <button type="button" class="nac-emoji-btn" data-emoji="😡" title="Angry">😡</button>
              <button type="button" class="nac-emoji-btn" data-emoji="🎯" title="Accurate">🎯</button>
              <button type="button" class="nac-emoji-btn" data-emoji="💯" title="100%">💯</button>
            </div>
            <input type="hidden" id="nac-reaction-emoji" value="">
          </div>
          <div class="nac-form-group">
            <label class="nac-form-label">Aspect (Optional)</label>
            <select class="nac-form-select" id="nac-reaction-aspect">
              <option value="">Overall Article</option>
              <option value="headline">Headline</option>
              <option value="content">Content</option>
              <option value="claims">Claims</option>
              <option value="sources">Sources</option>
              <option value="images">Images</option>
            </select>
          </div>
          <div class="nac-form-group">
            <label class="nac-form-label">Reason (Optional)</label>
            <input type="text" class="nac-form-input" id="nac-reaction-reason" placeholder="Brief reason for your reaction..." maxlength="100">
            <div class="nac-char-count"><span id="nac-reaction-reason-chars">0</span>/100</div>
          </div>
          <div class="nac-form-group">
            <label class="nac-form-label">Extended Comment (Optional)</label>
            <textarea class="nac-form-textarea" id="nac-reaction-content" placeholder="Add more details about your reaction..." rows="3" maxlength="1000"></textarea>
            <div class="nac-char-count"><span id="nac-reaction-content-chars">0</span>/1000</div>
          </div>
        </div>

        <div class="nac-metadata-form" id="nac-form-related" style="display: none;">
          <div class="nac-form-group">
            <label class="nac-form-label">Related URL <span class="nac-required">*</span></label>
            <div class="nac-input-with-btn">
              <input type="url" class="nac-form-input" id="nac-related-url" placeholder="https://example.com/related-article">
              <button type="button" class="nac-fetch-btn" id="nac-fetch-related-title" title="Fetch title from URL">🔄</button>
            </div>
            <div class="nac-form-help">Enter the URL of a related article or source</div>
          </div>
          <div class="nac-form-group">
            <label class="nac-form-label">Relationship Type <span class="nac-required">*</span></label>
            <select class="nac-form-select" id="nac-related-type">
              <option value="">Select relationship...</option>
              <option value="response">Response</option>
              <option value="rebuttal">Rebuttal</option>
              <option value="supporting">Supporting Evidence</option>
              <option value="contradicting">Contradicting Evidence</option>
              <option value="primary-source">Primary Source</option>
              <option value="update">Update</option>
              <option value="correction">Correction</option>
              <option value="similar">Similar</option>
            </select>
          </div>
          <div class="nac-form-group">
            <label class="nac-form-label">Related Article Title</label>
            <input type="text" class="nac-form-input" id="nac-related-title" placeholder="Title of the related article..." maxlength="200">
            <div class="nac-char-count"><span id="nac-related-title-chars">0</span>/200</div>
          </div>
          <div class="nac-form-group">
            <label class="nac-form-label">Relevance</label>
            <div class="nac-relevance-slider">
              <input type="range" class="nac-form-range" id="nac-related-relevance" min="0" max="100" value="75">
              <span class="nac-relevance-value" id="nac-related-relevance-value">75%</span>
            </div>
          </div>
          <div class="nac-form-group">
            <label class="nac-form-label">Description</label>
            <textarea class="nac-form-textarea" id="nac-related-description" placeholder="Describe how this content relates to the current article..." rows="3" maxlength="1000"></textarea>
            <div class="nac-char-count"><span id="nac-related-description-chars">0</span>/1000</div>
          </div>
        </div>

        <div class="nac-metadata-form" id="nac-form-rating" style="display: none;">
          <div class="nac-form-group">
            <label class="nac-form-label">Rate This Content</label>
            <div class="nac-form-help">Score each dimension from 0 (worst) to 10 (best)</div>
          </div>
          <div class="nac-rating-grid">
            <div class="nac-rating-dimension"><label class="nac-rating-label">Accuracy</label><div class="nac-rating-slider"><input type="range" class="nac-form-range" id="nac-rating-accuracy" min="0" max="10" value="5"><span class="nac-rating-value" id="nac-rating-accuracy-value">5</span></div><div class="nac-rating-help">How factually accurate is the content?</div></div>
            <div class="nac-rating-dimension"><label class="nac-rating-label">Quality</label><div class="nac-rating-slider"><input type="range" class="nac-form-range" id="nac-rating-quality" min="0" max="10" value="5"><span class="nac-rating-value" id="nac-rating-quality-value">5</span></div><div class="nac-rating-help">Overall writing and production quality</div></div>
            <div class="nac-rating-dimension"><label class="nac-rating-label">Depth</label><div class="nac-rating-slider"><input type="range" class="nac-form-range" id="nac-rating-depth" min="0" max="10" value="5"><span class="nac-rating-value" id="nac-rating-depth-value">5</span></div><div class="nac-rating-help">How thoroughly does it cover the topic?</div></div>
            <div class="nac-rating-dimension"><label class="nac-rating-label">Clarity</label><div class="nac-rating-slider"><input type="range" class="nac-form-range" id="nac-rating-clarity" min="0" max="10" value="5"><span class="nac-rating-value" id="nac-rating-clarity-value">5</span></div><div class="nac-rating-help">How clear and understandable is it?</div></div>
            <div class="nac-rating-dimension"><label class="nac-rating-label">Bias</label><div class="nac-rating-slider"><input type="range" class="nac-form-range" id="nac-rating-bias" min="0" max="10" value="5"><span class="nac-rating-value" id="nac-rating-bias-value">5</span></div><div class="nac-rating-help">10 = neutral/balanced, 0 = heavily biased</div></div>
            <div class="nac-rating-dimension"><label class="nac-rating-label">Sources</label><div class="nac-rating-slider"><input type="range" class="nac-form-range" id="nac-rating-sources" min="0" max="10" value="5"><span class="nac-rating-value" id="nac-rating-sources-value">5</span></div><div class="nac-rating-help">Quality of citations and references</div></div>
            <div class="nac-rating-dimension"><label class="nac-rating-label">Relevance</label><div class="nac-rating-slider"><input type="range" class="nac-form-range" id="nac-rating-relevance" min="0" max="10" value="5"><span class="nac-rating-value" id="nac-rating-relevance-value">5</span></div><div class="nac-rating-help">How relevant is this content today?</div></div>
            <div class="nac-rating-dimension"><label class="nac-rating-label">Originality</label><div class="nac-rating-slider"><input type="range" class="nac-form-range" id="nac-rating-originality" min="0" max="10" value="5"><span class="nac-rating-value" id="nac-rating-originality-value">5</span></div><div class="nac-rating-help">Does it offer new insights or perspectives?</div></div>
          </div>
          <div class="nac-form-group">
            <label class="nac-form-label">Confidence Level</label>
            <div class="nac-confidence-slider">
              <input type="range" class="nac-form-range" id="nac-rating-confidence" min="0" max="100" value="75">
              <span class="nac-confidence-value" id="nac-rating-confidence-value">75%</span>
            </div>
            <div class="nac-form-help">How confident are you in your ratings?</div>
          </div>
          <div class="nac-form-group">
            <label class="nac-form-label">Review (Optional)</label>
            <textarea class="nac-form-textarea" id="nac-rating-review" placeholder="Write a detailed review explaining your ratings..." rows="4" maxlength="5000"></textarea>
            <div class="nac-char-count"><span id="nac-rating-review-chars">0</span>/5000</div>
          </div>
        </div>

        <div class="nac-metadata-form" id="nac-form-comment" style="display: none;">
          <div class="nac-form-group">
            <label class="nac-form-label">Your Comment</label>
            <textarea class="nac-form-textarea" id="nac-comment-content" placeholder="Share your thoughts on this article..." rows="5" maxlength="5000"></textarea>
            <div class="nac-char-count"><span id="nac-comment-chars">0</span>/5000</div>
          </div>
          <div class="nac-form-group">
            <label class="nac-form-label">Reply To (Optional)</label>
            <input type="text" class="nac-form-input" id="nac-comment-parent" placeholder="Event ID of comment you're replying to...">
            <div class="nac-form-help">Leave empty for top-level comment, or paste event ID to reply</div>
          </div>
        </div>

        <div class="nac-event-preview" id="nac-event-preview">
          <div class="nac-event-preview-header">
            <span class="nac-event-preview-title">Event Preview</span>
            <button type="button" class="nac-event-preview-toggle" id="nac-preview-toggle">Show JSON</button>
          </div>
          <div class="nac-event-preview-json" id="nac-preview-json" style="display: none;">Loading preview...</div>
        </div>

        <div class="nac-form-group">
          <label class="nac-form-label">Sign As (Publication)</label>
          <select class="nac-form-select" id="nac-metadata-publication">
            <option value="">Select publication...</option>
          </select>
        </div>

        <div class="nac-metadata-actions">
          <button type="button" class="nac-btn-secondary" id="nac-metadata-cancel">Cancel</button>
          <button type="button" class="nac-btn nac-btn-primary" id="nac-metadata-post" disabled>${UI.icons.send} Post Metadata</button>
        </div>
      </div>
    `;

    UI.attachMetadataEventListeners();
    await UI.loadMetadataPublications();
    UI.updateMetadataPreview();
  },

  attachMetadataEventListeners: () => {
    document.querySelectorAll('.nac-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nac-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const type = btn.dataset.type;
        document.querySelectorAll('.nac-metadata-form').forEach(form => form.classList.remove('active'));
        document.getElementById(`nac-form-${type}`).classList.add('active');

        UI.state.metadataType = type;
        UI.updateMetadataPreview();
        UI.updateMetadataPostButton();
      });
    });

    const setupCharCounter = (inputId, counterId, maxLen) => {
      const input = document.getElementById(inputId);
      const counter = document.getElementById(counterId);
      if (input && counter) {
        input.addEventListener('input', () => {
          const len = input.value.length;
          counter.textContent = len;
          counter.parentElement.classList.toggle('warning', len > maxLen * 0.8);
          counter.parentElement.classList.toggle('error', len >= maxLen);
          UI.updateMetadataPreview();
          UI.updateMetadataPostButton();
        });
      }
    };

    setupCharCounter('nac-annotation-content', 'nac-annotation-chars', 2000);
    setupCharCounter('nac-factcheck-claim', 'nac-factcheck-claim-chars', 200);
    setupCharCounter('nac-factcheck-explanation', 'nac-factcheck-explanation-chars', 2000);
    setupCharCounter('nac-headline-suggested', 'nac-headline-chars', 200);
    setupCharCounter('nac-headline-reason', 'nac-headline-reason-chars', 1000);
    setupCharCounter('nac-reaction-reason', 'nac-reaction-reason-chars', 100);
    setupCharCounter('nac-reaction-content', 'nac-reaction-content-chars', 1000);
    setupCharCounter('nac-related-title', 'nac-related-title-chars', 200);
    setupCharCounter('nac-related-description', 'nac-related-description-chars', 1000);
    setupCharCounter('nac-rating-review', 'nac-rating-review-chars', 5000);
    setupCharCounter('nac-comment-content', 'nac-comment-chars', 5000);

    const ratingDimensions = ['accuracy', 'quality', 'depth', 'clarity', 'bias', 'sources', 'relevance', 'originality'];
    ratingDimensions.forEach(dim => {
      const slider = document.getElementById(`nac-rating-${dim}`);
      const valueEl = document.getElementById(`nac-rating-${dim}-value`);
      if (slider && valueEl) {
        slider.addEventListener('input', () => {
          valueEl.textContent = slider.value;
          UI.updateMetadataPreview();
        });
      }
    });

    const ratingConfidenceSlider = document.getElementById('nac-rating-confidence');
    const ratingConfidenceValue = document.getElementById('nac-rating-confidence-value');
    if (ratingConfidenceSlider && ratingConfidenceValue) {
      ratingConfidenceSlider.addEventListener('input', () => {
        ratingConfidenceValue.textContent = ratingConfidenceSlider.value + '%';
        UI.updateMetadataPreview();
      });
    }

    const commentContent = document.getElementById('nac-comment-content');
    if (commentContent) {
      commentContent.addEventListener('input', () => {
        UI.updateMetadataPreview();
        UI.updateMetadataPostButton();
      });
    }

    const confidenceSlider = document.getElementById('nac-annotation-confidence');
    const confidenceValue = document.getElementById('nac-annotation-confidence-value');
    if (confidenceSlider && confidenceValue) {
      confidenceSlider.addEventListener('input', () => {
        confidenceValue.textContent = confidenceSlider.value + '%';
        UI.updateMetadataPreview();
      });
    }

    document.querySelectorAll('input[name="nac-verdict"]').forEach(radio => {
      radio.addEventListener('change', () => {
        UI.updateMetadataPreview();
        UI.updateMetadataPostButton();
      });
    });

    const addEvidenceBtn = document.getElementById('nac-add-evidence');
    if (addEvidenceBtn) addEvidenceBtn.addEventListener('click', () => UI.addEvidenceSource());

    const editHeadlineBtn = document.getElementById('nac-edit-headline');
    if (editHeadlineBtn) {
      editHeadlineBtn.addEventListener('click', () => {
        const display = document.querySelector('.nac-headline-original');
        const input = document.getElementById('nac-headline-original-input');
        if (display && input) {
          display.style.display = 'none';
          input.style.display = 'block';
          input.focus();
        }
      });
    }

    const emojiPicker = document.getElementById('nac-reaction-emoji-picker');
    if (emojiPicker) {
      emojiPicker.addEventListener('click', (e) => {
        const btn = e.target.closest('.nac-emoji-btn');
        if (btn) {
          emojiPicker.querySelectorAll('.nac-emoji-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const emojiInput = document.getElementById('nac-reaction-emoji');
          if (emojiInput) emojiInput.value = btn.dataset.emoji;
          UI.updateMetadataPreview();
          UI.updateMetadataPostButton();
        }
      });
    }

    const relevanceSlider = document.getElementById('nac-related-relevance');
    const relevanceValue = document.getElementById('nac-related-relevance-value');
    if (relevanceSlider && relevanceValue) {
      relevanceSlider.addEventListener('input', () => {
        relevanceValue.textContent = `${relevanceSlider.value}%`;
        UI.updateMetadataPreview();
      });
    }

    const fetchRelatedBtn = document.getElementById('nac-fetch-related-title');
    if (fetchRelatedBtn) {
      fetchRelatedBtn.addEventListener('click', async () => {
        const urlInput = document.getElementById('nac-related-url');
        const titleInput = document.getElementById('nac-related-title');
        if (!urlInput || !titleInput) return;

        const url = urlInput.value.trim();
        if (!url) {
          UI.showToast('Please enter a URL first', 'warning');
          return;
        }

        fetchRelatedBtn.disabled = true;
        fetchRelatedBtn.textContent = '⏳';

        try {
          // fetch() replaces GM.xmlHttpRequest. host_permissions in the
          // manifest grants us cross-origin access.
          const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
          const html = await res.text();
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          const title = doc.querySelector('title')?.textContent?.trim()
                     || doc.querySelector('meta[property="og:title"]')?.content
                     || doc.querySelector('meta[name="twitter:title"]')?.content
                     || '';

          if (title) {
            titleInput.value = title;
            titleInput.dispatchEvent(new Event('input', { bubbles: true }));
            UI.showToast('Title fetched successfully', 'success');
          } else {
            UI.showToast('Could not extract title from URL', 'warning');
          }
        } catch (error) {
          Utils.error('Error fetching URL:', error);
          UI.showToast('Failed to fetch URL', 'error');
        } finally {
          fetchRelatedBtn.disabled = false;
          fetchRelatedBtn.textContent = '🔄';
        }
      });
    }

    const relatedUrl = document.getElementById('nac-related-url');
    const relatedType = document.getElementById('nac-related-type');
    if (relatedUrl) relatedUrl.addEventListener('input', () => UI.updateMetadataPreview());
    if (relatedType) relatedType.addEventListener('change', () => {
      UI.updateMetadataPreview();
      UI.updateMetadataPostButton();
    });

    const previewToggle = document.getElementById('nac-preview-toggle');
    if (previewToggle) {
      previewToggle.addEventListener('click', () => {
        const previewJson = document.getElementById('nac-preview-json');
        if (previewJson) {
          const isVisible = previewJson.style.display !== 'none';
          previewJson.style.display = isVisible ? 'none' : 'block';
          previewToggle.textContent = isVisible ? 'Show JSON' : 'Hide JSON';
        }
      });
    }

    const pubSelect = document.getElementById('nac-metadata-publication');
    if (pubSelect) pubSelect.addEventListener('change', () => UI.updateMetadataPostButton());

    const cancelBtn = document.getElementById('nac-metadata-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => UI.switchTab('readable'));

    const postBtn = document.getElementById('nac-metadata-post');
    if (postBtn) postBtn.addEventListener('click', () => UI.publishMetadata());

    UI.state.metadataType = 'annotation';
  },

  addEvidenceSource: () => {
    const list = document.getElementById('nac-evidence-list');
    if (!list) return;

    const index = list.children.length;
    const item = document.createElement('div');
    item.className = 'nac-evidence-item';
    item.dataset.index = index;
    item.innerHTML = `
      <div class="nac-evidence-item-header">
        <span class="nac-evidence-item-title">Source ${index + 1}</span>
        <button type="button" class="nac-evidence-remove">Remove</button>
      </div>
      <div class="nac-evidence-row">
        <input type="url" class="nac-form-input nac-evidence-url" placeholder="https://source.com/evidence">
        <select class="nac-form-select nac-evidence-type">
          <option value="primary">Primary</option>
          <option value="official">Official</option>
          <option value="news">News</option>
          <option value="academic">Academic</option>
          <option value="other">Other</option>
        </select>
      </div>
    `;

    item.querySelector('.nac-evidence-remove').addEventListener('click', () => {
      item.remove();
      UI.updateMetadataPreview();
    });

    list.appendChild(item);
  },

  loadMetadataPublications: async () => {
    const select = document.getElementById('nac-metadata-publication');
    if (!select) return;

    const publications = await Storage.publications.getAll();
    while (select.options.length > 1) select.remove(1);

    Object.entries(publications).forEach(([id, pub]) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = pub.name;
      select.add(option);
    });

    UI.updateMetadataPostButton();
  },

  updateMetadataPostButton: () => {
    const btn = document.getElementById('nac-metadata-post');
    if (!btn) return;

    const pubSelect = document.getElementById('nac-metadata-publication');
    const hasPub = pubSelect && pubSelect.value;

    const nip07Available = NIP07Client.checkAvailability();
    const hasSigningMethod = nip07Available || NSecBunkerClient.connected;

    let isValid = false;
    const type = UI.state.metadataType || 'annotation';

    if (type === 'annotation') {
      const content = document.getElementById('nac-annotation-content');
      isValid = content && content.value.trim().length >= 10;
    } else if (type === 'factcheck') {
      const claim = document.getElementById('nac-factcheck-claim');
      const verdict = document.querySelector('input[name="nac-verdict"]:checked');
      const explanation = document.getElementById('nac-factcheck-explanation');
      isValid = claim && claim.value.trim().length >= 10
             && verdict
             && explanation && explanation.value.trim().length >= 20;
    } else if (type === 'headline') {
      const suggested = document.getElementById('nac-headline-suggested');
      const reason = document.getElementById('nac-headline-reason');
      isValid = suggested && suggested.value.trim().length >= 5
             && reason && reason.value.trim().length >= 10;
    } else if (type === 'reaction') {
      const emoji = document.getElementById('nac-reaction-emoji');
      isValid = emoji && emoji.value.trim().length > 0;
    } else if (type === 'related') {
      const url = document.getElementById('nac-related-url');
      const relationType = document.getElementById('nac-related-type');
      isValid = url && url.value.trim().length > 0
             && relationType && relationType.value.trim().length > 0;
    } else if (type === 'rating') {
      isValid = true;
    } else if (type === 'comment') {
      const comment = document.getElementById('nac-comment-content');
      isValid = comment && comment.value.trim().length > 0;
    }

    if (!hasSigningMethod) {
      btn.disabled = true;
      btn.innerHTML = `${UI.icons.send} Install Signer Extension`;
    } else if (!hasPub) {
      btn.disabled = true;
      btn.innerHTML = `${UI.icons.send} Select Publication`;
    } else if (!isValid) {
      btn.disabled = true;
      btn.innerHTML = `${UI.icons.send} Complete Form`;
    } else {
      btn.disabled = false;
      btn.innerHTML = `${UI.icons.send} Post Metadata`;
    }
  },

  updateMetadataPreview: async () => {
    const previewEl = document.getElementById('nac-preview-json');
    if (!previewEl) return;

    const article = UI.state.article;
    if (!article) return;

    const type = UI.state.metadataType || 'annotation';
    let eventPreview = {};

    try {
      const normalizedUrl = Utils.normalizeUrl(article.url);
      const urlHash = await Utils.sha256(normalizedUrl);
      const dTag = urlHash.substring(0, 16);

      if (type === 'annotation') {
        const annotationType = document.getElementById('nac-annotation-type')?.value || 'context';
        const content = document.getElementById('nac-annotation-content')?.value || '';
        const confidence = document.getElementById('nac-annotation-confidence')?.value || 80;
        const evidenceUrl = document.getElementById('nac-annotation-evidence')?.value || '';

        eventPreview = {
          kind: 32123,
          tags: [
            ['d', dTag],
            ['r', normalizedUrl],
            ['annotation-type', annotationType],
            ['confidence', String(confidence / 100)],
            ['client', 'nostr-article-capture'],
            ...(evidenceUrl ? [['evidence', evidenceUrl]] : [])
          ],
          content
        };
      } else if (type === 'factcheck') {
        const claim = document.getElementById('nac-factcheck-claim')?.value || '';
        const verdict = document.querySelector('input[name="nac-verdict"]:checked')?.value || '';
        const explanation = document.getElementById('nac-factcheck-explanation')?.value || '';

        const evidenceSources = [];
        document.querySelectorAll('#nac-evidence-list .nac-evidence-item').forEach(item => {
          const url = item.querySelector('.nac-evidence-url')?.value;
          const sourceType = item.querySelector('.nac-evidence-type')?.value;
          if (url && url.trim()) evidenceSources.push({ url: url.trim(), type: sourceType });
        });

        eventPreview = {
          kind: 32127,
          tags: [
            ['d', dTag],
            ['r', normalizedUrl],
            ['claim', claim.substring(0, 200)],
            ['verdict', verdict],
            ['client', 'nostr-article-capture'],
            ...evidenceSources.map(s => ['evidence', s.url, s.type])
          ],
          content: explanation
        };
      } else if (type === 'headline') {
        const original = document.getElementById('nac-headline-original-input')?.value || article.title;
        const suggested = document.getElementById('nac-headline-suggested')?.value || '';
        const reason = document.getElementById('nac-headline-reason')?.value || '';

        eventPreview = {
          kind: 32129,
          tags: [
            ['d', dTag],
            ['r', normalizedUrl],
            ['original-headline', original],
            ['suggested-headline', suggested],
            ['client', 'nostr-article-capture']
          ],
          content: reason
        };
      } else if (type === 'reaction') {
        const emoji = document.getElementById('nac-reaction-emoji')?.value || '';
        const aspect = document.getElementById('nac-reaction-aspect')?.value || '';
        const reason = document.getElementById('nac-reaction-reason')?.value || '';
        const content = document.getElementById('nac-reaction-content')?.value || '';

        const tags = [
          ['d', dTag],
          ['r', normalizedUrl],
          ['reaction', emoji]
        ];
        if (aspect) tags.push(['aspect', aspect]);
        if (reason) tags.push(['reason', reason]);

        eventPreview = { kind: 32132, tags, content };
      } else if (type === 'related') {
        const relatedUrl = document.getElementById('nac-related-url')?.value || '';
        const relationType = document.getElementById('nac-related-type')?.value || '';
        const title = document.getElementById('nac-related-title')?.value || '';
        const relevance = document.getElementById('nac-related-relevance')?.value || '75';
        const description = document.getElementById('nac-related-description')?.value || '';

        const tags = [
          ['d', dTag],
          ['r', normalizedUrl],
          ['related-url', relatedUrl],
          ['relation-type', relationType]
        ];
        if (title) tags.push(['related-title', title]);
        tags.push(['relevance', relevance]);

        eventPreview = { kind: 32131, tags, content: description };
      } else if (type === 'rating') {
        const dimensions = ['accuracy', 'quality', 'depth', 'clarity', 'bias', 'sources', 'relevance', 'originality'];
        const tags = [
          ['d', dTag],
          ['r', normalizedUrl],
          ['url-hash', urlHash]
        ];

        let totalScore = 0;
        let ratedDimensions = 0;
        dimensions.forEach(dim => {
          const value = document.getElementById(`nac-rating-${dim}`)?.value || '5';
          tags.push(['rating', dim, value, '10']);
          totalScore += parseInt(value, 10);
          ratedDimensions++;
        });

        const overallScore = (totalScore / ratedDimensions).toFixed(1);
        tags.push(['overall', overallScore, '10']);
        tags.push(['methodology', 'manual-review']);

        const confidence = document.getElementById('nac-rating-confidence')?.value || '75';
        tags.push(['confidence', confidence]);

        const review = document.getElementById('nac-rating-review')?.value || '';
        eventPreview = { kind: 32124, tags, content: review };
      } else if (type === 'comment') {
        const comment = document.getElementById('nac-comment-content')?.value || '';
        const parentId = document.getElementById('nac-comment-parent')?.value || '';

        const tags = [
          ['d', dTag],
          ['r', normalizedUrl],
          ['url-hash', urlHash],
          ['annotation-type', 'comment']
        ];
        if (parentId.trim()) tags.push(['e', parentId, '', 'reply']);

        eventPreview = { kind: 32123, tags, content: comment };
      }

      previewEl.textContent = JSON.stringify(eventPreview, null, 2);
    } catch (e) {
      previewEl.textContent = 'Error generating preview: ' + e.message;
    }
  },

  publishMetadata: async () => {
    const btn = document.getElementById('nac-metadata-post');
    if (!btn) return;

    const originalContent = btn.innerHTML;

    try {
      btn.disabled = true;
      btn.innerHTML = `<div class="nac-spinner"></div><span>Preparing...</span>`;

      const article = UI.state.article;
      const type = UI.state.metadataType || 'annotation';
      const pubSelect = document.getElementById('nac-metadata-publication');
      const publicationId = pubSelect?.value;

      if (!publicationId) throw new Error('Please select a publication');

      const nip07Available = NIP07Client.checkAvailability();
      let pubkey;
      let signedEvent;

      if (nip07Available) {
        btn.innerHTML = `<div class="nac-spinner"></div><span>Getting key...</span>`;
        pubkey = await NIP07Client.getPublicKey();
      } else if (NSecBunkerClient.connected) {
        const publication = await Storage.publications.get(publicationId);
        pubkey = publication?.pubkey;
        if (!pubkey) throw new Error('Publication key not found');
      } else {
        throw new Error('No signing method available');
      }

      btn.innerHTML = `<div class="nac-spinner"></div><span>Building event...</span>`;
      let event;

      if (type === 'annotation') {
        event = await EventBuilder.buildAnnotationEvent(article.url, {
          type: document.getElementById('nac-annotation-type')?.value || 'context',
          content: document.getElementById('nac-annotation-content')?.value || '',
          confidence: parseInt(document.getElementById('nac-annotation-confidence')?.value, 10) || 80,
          evidenceUrl: document.getElementById('nac-annotation-evidence')?.value || ''
        }, pubkey);

      } else if (type === 'factcheck') {
        const evidenceSources = [];
        document.querySelectorAll('#nac-evidence-list .nac-evidence-item').forEach(item => {
          const url = item.querySelector('.nac-evidence-url')?.value;
          const sourceType = item.querySelector('.nac-evidence-type')?.value;
          if (url && url.trim()) evidenceSources.push({ url: url.trim(), type: sourceType });
        });
        event = await EventBuilder.buildFactCheckEvent(article.url, {
          claim: document.getElementById('nac-factcheck-claim')?.value || '',
          verdict: document.querySelector('input[name="nac-verdict"]:checked')?.value || '',
          explanation: document.getElementById('nac-factcheck-explanation')?.value || '',
          evidenceSources
        }, pubkey);

      } else if (type === 'headline') {
        event = await EventBuilder.buildHeadlineCorrectionEvent(article.url, {
          original: document.getElementById('nac-headline-original-input')?.value || article.title,
          suggested: document.getElementById('nac-headline-suggested')?.value || '',
          reason: document.getElementById('nac-headline-reason')?.value || ''
        }, pubkey);

      } else if (type === 'reaction') {
        event = await EventBuilder.buildReactionEvent(article.url, {
          emoji: document.getElementById('nac-reaction-emoji')?.value || '',
          aspect: document.getElementById('nac-reaction-aspect')?.value || '',
          reason: document.getElementById('nac-reaction-reason')?.value || '',
          content: document.getElementById('nac-reaction-content')?.value || ''
        }, pubkey);

      } else if (type === 'related') {
        event = await EventBuilder.buildRelatedContentEvent(article.url, {
          relatedUrl: document.getElementById('nac-related-url')?.value || '',
          relationType: document.getElementById('nac-related-type')?.value || '',
          title: document.getElementById('nac-related-title')?.value || '',
          relevance: parseInt(document.getElementById('nac-related-relevance')?.value || '75', 10),
          description: document.getElementById('nac-related-description')?.value || ''
        }, pubkey);

      } else if (type === 'rating') {
        const dimensions = ['accuracy', 'quality', 'depth', 'clarity', 'bias', 'sources', 'relevance', 'originality'];
        const ratings = {};
        dimensions.forEach(dim => {
          ratings[dim] = parseInt(document.getElementById(`nac-rating-${dim}`)?.value || '5', 10);
        });
        event = await EventBuilder.buildRatingEvent(article.url, {
          ratings,
          confidence: parseInt(document.getElementById('nac-rating-confidence')?.value || '75', 10),
          methodology: 'manual-review',
          review: document.getElementById('nac-rating-review')?.value || ''
        }, pubkey);

      } else if (type === 'comment') {
        const parentId = document.getElementById('nac-comment-parent')?.value?.trim() || '';
        event = await EventBuilder.buildCommentEvent(article.url, {
          comment: document.getElementById('nac-comment-content')?.value || '',
          parentId: parentId || null,
          rootId: null,
          mentions: []
        }, pubkey);
      }

      btn.innerHTML = `<div class="nac-spinner"></div><span>Sign in extension...</span>`;

      if (nip07Available) {
        UI.showToast('Please approve signature in extension...', 'warning');
        signedEvent = await NIP07Client.signEvent(event);
      } else {
        signedEvent = await NSecBunkerClient.signEvent(event, publicationId);
      }

      if (!signedEvent || !signedEvent.id || !signedEvent.sig) {
        throw new Error('Invalid signed event');
      }

      btn.innerHTML = `<div class="nac-spinner"></div><span>Publishing...</span>`;
      const selectedRelays = CONFIG.relays.filter(r => r.enabled).map(r => r.url);
      const results = await NostrClient.publishToRelays(selectedRelays, signedEvent);
      Utils.log('Metadata publish results:', results);

      if (results.successful > 0) {
        UI.showToast(`Published ${type} to ${results.successful}/${results.total} relays!`, 'success');
        setTimeout(() => UI.switchTab('readable'), 1500);
      } else {
        throw new Error('Failed to publish to any relay');
      }
    } catch (error) {
      Utils.error('Metadata publish error:', error);
      UI.showToast(error.message || 'Failed to publish', 'error');
    } finally {
      btn.innerHTML = originalContent;
      UI.updateMetadataPostButton();
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

        const article = { ...UI.state.article, markdown: UI.state.markdown };

        Utils.log('Building article event...');
        const event = await EventBuilder.buildArticleEvent(article, {
          pubkey,
          authorPubkey,
          tags,
          mediaHandling
        });
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

        const article = { ...UI.state.article, markdown: UI.state.markdown };
        const event = await EventBuilder.buildArticleEvent(article, {
          pubkey: publication.pubkey, authorPubkey, tags, mediaHandling
        });

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

      const results = await NostrClient.publishToRelays(selectedRelays, signedEvent);
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

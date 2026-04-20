// ============================================
// SECTION 13.7: METADATA UI COMPONENTS
// ============================================
//
// UI components for displaying URL metadata.
// Ported from nostr-article-capture.user.js lines 6958-7742.
//
// Differences from the userscript:
//   - declared as `var MetadataUI` so later content scripts in the
//     isolated world can see it (content scripts share a scope but
//     `const` bindings don't leak between <script> files the way `var`
//     does via the global in the extension sandbox).
//   - the `GM_addStyle(METADATA_STYLES)` call is removed. The matching
//     CSS is loaded by the manifest via `content_scripts[].css`.

var MetadataUI = {
    elements: {},
    state: {
        metadata: null,
        isLoading: false,
        isPanelOpen: false,
        isBadgeMinimized: false,
        activeTab: 'overview',
        bannerDismissed: false
    },

    /**
     * Initialize the metadata display UI
     */
    init: () => {
        Utils.log('Initializing Metadata UI...');

        // Styles are loaded by the manifest content_scripts.css entry.

        // Create UI components
        MetadataUI.createBadge();
        MetadataUI.createPanel();
        MetadataUI.createDebunkBanner();

        Utils.log('Metadata UI initialized');
    },

    /**
     * Create the floating metadata badge
     */
    createBadge: () => {
        const badge = document.createElement('div');
        badge.className = 'nmd-badge';
        badge.innerHTML = `
        <div class="nmd-badge__container" title="Click for URL metadata">
          <div class="nmd-badge__score nmd-badge__score--unknown">?</div>
          <div class="nmd-badge__stats">
            <div class="nmd-badge__stat">
              <span class="nmd-badge__stat-icon">📝</span>
              <span class="nmd-badge__stat-value" data-stat="annotations">0</span>
            </div>
            <div class="nmd-badge__stat">
              <span class="nmd-badge__stat-icon">⭐</span>
              <span class="nmd-badge__stat-value" data-stat="ratings">0</span>
            </div>
          </div>
          <button class="nmd-badge__minimize" title="Minimize">−</button>
        </div>
      `;

        document.body.appendChild(badge);
        MetadataUI.elements.badge = badge;

        // Event listeners
        badge.querySelector('.nmd-badge__container').addEventListener('click', (e) => {
            if (!e.target.classList.contains('nmd-badge__minimize')) {
                MetadataUI.togglePanel();
            }
        });

        badge.querySelector('.nmd-badge__minimize').addEventListener('click', (e) => {
            e.stopPropagation();
            MetadataUI.toggleBadgeMinimize();
        });
    },

    /**
     * Create the expanded metadata panel
     */
    createPanel: () => {
        const panel = document.createElement('div');
        panel.className = 'nmd-panel';
        panel.innerHTML = `
        <div class="nmd-panel__header">
          <span class="nmd-panel__title">URL Metadata</span>
          <button class="nmd-panel__close" title="Close">×</button>
        </div>
        <div class="nmd-panel__tabs">
          <button class="nmd-panel__tab nmd-panel__tab--active" data-tab="overview">Overview</button>
          <button class="nmd-panel__tab" data-tab="ratings">Ratings</button>
          <button class="nmd-panel__tab" data-tab="comments">Comments</button>
          <button class="nmd-panel__tab" data-tab="annotations">Notes</button>
          <button class="nmd-panel__tab" data-tab="factchecks">Fact-Checks</button>
        </div>
        <div class="nmd-panel__content" id="nmd-panel-content">
          <div class="nmd-loading">
            <div class="nmd-loading__spinner"></div>
          </div>
        </div>
      `;

        document.body.appendChild(panel);
        MetadataUI.elements.panel = panel;

        // Event listeners
        panel.querySelector('.nmd-panel__close').addEventListener('click', () => {
            MetadataUI.closePanel();
        });

        panel.querySelectorAll('.nmd-panel__tab').forEach(tab => {
            tab.addEventListener('click', () => {
                MetadataUI.switchTab(tab.dataset.tab);
            });
        });
    },

    /**
     * Create the debunking banner (hidden by default)
     */
    createDebunkBanner: () => {
        const banner = document.createElement('div');
        banner.className = 'nmd-debunk-banner';
        banner.style.display = 'none';
        banner.innerHTML = `
        <div class="nmd-debunk-banner__content">
          <span class="nmd-debunk-banner__icon">⚠️</span>
          <div class="nmd-debunk-banner__text">
            <div class="nmd-debunk-banner__title">This content has been fact-checked</div>
            <div class="nmd-debunk-banner__detail">Loading details...</div>
          </div>
          <div class="nmd-debunk-banner__source">
            <span>by </span>
            <span class="nmd-debunk-banner__author">Checking...</span>
          </div>
          <button class="nmd-debunk-banner__dismiss">I Understand</button>
        </div>
      `;

        document.body.appendChild(banner);
        MetadataUI.elements.debunkBanner = banner;

        // Dismiss handler
        banner.querySelector('.nmd-debunk-banner__dismiss').addEventListener('click', () => {
            MetadataUI.dismissDebunkBanner();
        });
    },

    /**
     * Update the badge with metadata
     * @param {Object} metadata - Aggregated metadata
     */
    updateBadge: (metadata) => {
        const badge = MetadataUI.elements.badge;
        if (!badge) return;

        const scoreEl = badge.querySelector('.nmd-badge__score');
        const annotationsEl = badge.querySelector('[data-stat="annotations"]');
        const ratingsEl = badge.querySelector('[data-stat="ratings"]');

        // Update stats
        annotationsEl.textContent = metadata.aggregates.annotationCount || 0;
        ratingsEl.textContent = metadata.aggregates.ratingCounts.total || 0;

        // Update trust score
        const trustScore = metadata.aggregates.trustScore;
        scoreEl.classList.remove('nmd-badge__score--high', 'nmd-badge__score--medium',
                                 'nmd-badge__score--low', 'nmd-badge__score--unknown');

        if (trustScore !== null && trustScore !== undefined) {
            const scorePercent = Math.round(trustScore * 100);
            scoreEl.textContent = scorePercent;

            if (trustScore >= 0.7) {
                scoreEl.classList.add('nmd-badge__score--high');
            } else if (trustScore >= 0.4) {
                scoreEl.classList.add('nmd-badge__score--medium');
            } else {
                scoreEl.classList.add('nmd-badge__score--low');
            }
        } else {
            scoreEl.textContent = '?';
            scoreEl.classList.add('nmd-badge__score--unknown');
        }

        // Check for alerts
        if (metadata.aggregates.verdictSummary?.hasDebunking) {
            badge.classList.add('nmd-badge--alert');
        } else {
            badge.classList.remove('nmd-badge--alert');
        }
    },

    /**
     * Show debunking banner if needed
     * @param {Object} metadata - Aggregated metadata
     */
    showDebunkBannerIfNeeded: (metadata) => {
        if (MetadataUI.state.bannerDismissed) return;

        const verdict = metadata.aggregates.verdictSummary;
        if (!verdict || !verdict.hasDebunking) return;

        const banner = MetadataUI.elements.debunkBanner;
        if (!banner) return;

        // Find the most authoritative fact check
        const factChecks = metadata.factChecks.filter(fc =>
            fc.content.verdict === 'false' || fc.content.verdict === 'misleading'
        );

        if (factChecks.length === 0) return;

        const topFactCheck = factChecks[0];

        // Update banner content
        const isFalse = topFactCheck.content.verdict === 'false';
        banner.classList.toggle('nmd-debunk-banner--misleading', !isFalse);

        const titleEl = banner.querySelector('.nmd-debunk-banner__title');
        const detailEl = banner.querySelector('.nmd-debunk-banner__detail');
        const authorEl = banner.querySelector('.nmd-debunk-banner__author');

        titleEl.textContent = isFalse
            ? '⚠️ This content has been rated FALSE'
            : '⚠️ This content may be MISLEADING';

        detailEl.textContent = topFactCheck.content.claim || 'Claims in this content have been disputed.';
        authorEl.textContent = topFactCheck.pubkey.substring(0, 8) + '...';

        banner.style.display = 'block';
    },

    /**
     * Dismiss the debunking banner
     */
    dismissDebunkBanner: () => {
        MetadataUI.state.bannerDismissed = true;
        const banner = MetadataUI.elements.debunkBanner;
        if (banner) {
            banner.style.display = 'none';
        }
    },

    /**
     * Toggle badge minimized state
     */
    toggleBadgeMinimize: () => {
        MetadataUI.state.isBadgeMinimized = !MetadataUI.state.isBadgeMinimized;
        const badge = MetadataUI.elements.badge;
        if (badge) {
            badge.classList.toggle('nmd-badge--minimized', MetadataUI.state.isBadgeMinimized);
        }
    },

    /**
     * Toggle the expanded panel
     */
    togglePanel: () => {
        if (MetadataUI.state.isPanelOpen) {
            MetadataUI.closePanel();
        } else {
            MetadataUI.openPanel();
        }
    },

    /**
     * Open the expanded panel
     */
    openPanel: () => {
        MetadataUI.state.isPanelOpen = true;
        const panel = MetadataUI.elements.panel;
        if (panel) {
            panel.classList.add('nmd-panel--visible');
            MetadataUI.renderPanelContent();
        }
    },

    /**
     * Close the expanded panel
     */
    closePanel: () => {
        MetadataUI.state.isPanelOpen = false;
        const panel = MetadataUI.elements.panel;
        if (panel) {
            panel.classList.remove('nmd-panel--visible');
        }
    },

    /**
     * Switch panel tab
     * @param {string} tab - Tab name
     */
    switchTab: (tab) => {
        MetadataUI.state.activeTab = tab;

        // Update tab buttons
        const panel = MetadataUI.elements.panel;
        panel.querySelectorAll('.nmd-panel__tab').forEach(t => {
            t.classList.toggle('nmd-panel__tab--active', t.dataset.tab === tab);
        });

        MetadataUI.renderPanelContent();
    },

    /**
     * Render panel content based on active tab
     */
    renderPanelContent: () => {
        const contentEl = document.getElementById('nmd-panel-content');
        if (!contentEl) return;

        const metadata = MetadataUI.state.metadata;

        if (MetadataUI.state.isLoading) {
            contentEl.innerHTML = `
          <div class="nmd-loading">
            <div class="nmd-loading__spinner"></div>
          </div>
        `;
            return;
        }

        if (!metadata) {
            contentEl.innerHTML = `
          <div class="nmd-empty">
            <div class="nmd-empty__icon">📭</div>
            <div class="nmd-empty__text">No metadata found for this URL</div>
          </div>
        `;
            return;
        }

        switch (MetadataUI.state.activeTab) {
            case 'overview':
                contentEl.innerHTML = MetadataUI.renderOverviewTab(metadata);
                break;
            case 'ratings':
                contentEl.innerHTML = MetadataUI.renderRatingsTab(metadata);
                break;
            case 'annotations':
                contentEl.innerHTML = MetadataUI.renderAnnotationsTab(metadata);
                break;
            case 'factchecks':
                contentEl.innerHTML = MetadataUI.renderFactChecksTab(metadata);
                break;
            case 'comments':
                contentEl.innerHTML = MetadataUI.renderCommentsTab(metadata);
                break;
        }
    },

    /**
     * Render overview tab content
     */
    renderOverviewTab: (metadata) => {
        const trustScore = metadata.aggregates.trustScore;
        const trustClass = trustScore >= 0.7 ? 'high' : trustScore >= 0.4 ? 'medium' : 'low';
        const trustLabel = trustScore >= 0.7 ? 'Highly Trusted' : trustScore >= 0.4 ? 'Mixed Reviews' : 'Low Trust';

        return `
        <div class="nmd-trust-display">
          <div class="nmd-trust-display__score" style="background: var(--nmd-trust-${trustClass})">
            ${trustScore !== null ? Math.round(trustScore * 100) : '?'}
          </div>
          <div class="nmd-trust-display__details">
            <div class="nmd-trust-display__label">${trustLabel}</div>
            <div class="nmd-trust-display__meta">
              Based on ${metadata.ratings.length} ratings, ${metadata.factChecks.length} fact-checks
            </div>
          </div>
        </div>

        <div class="nmd-panel__section">
          <div class="nmd-panel__section-title">Summary</div>
          <div style="font-size: 13px; color: var(--nmd-text);">
            <p>📝 ${metadata.annotations.length} annotations</p>
            <p>⭐ ${metadata.ratings.length} ratings</p>
            <p>🔍 ${metadata.factChecks.length} fact-checks</p>
            <p>📰 ${metadata.headlineCorrections.length} headline corrections</p>
          </div>
        </div>

        ${metadata.aggregates.verdictSummary?.hasDebunking ? `
          <div class="nmd-panel__section">
            <div class="nmd-panel__section-title">⚠️ Alerts</div>
            <div class="nmd-fact-check-item nmd-fact-check-item--${metadata.aggregates.verdictSummary.primary}">
              <span class="nmd-fact-check-item__verdict nmd-fact-check-item__verdict--${metadata.aggregates.verdictSummary.primary}">
                ${metadata.aggregates.verdictSummary.primary.toUpperCase()}
              </span>
              <div class="nmd-fact-check-item__claim">
                This content has been flagged by ${metadata.factChecks.length} fact-checker(s).
              </div>
            </div>
          </div>
        ` : ''}
      `;
    },

    /**
     * Render ratings tab content
     */
    renderRatingsTab: (metadata) => {
        if (metadata.ratings.length === 0) {
            return `
          <div class="nmd-empty">
            <div class="nmd-empty__icon">⭐</div>
            <div class="nmd-empty__text">No ratings yet</div>
          </div>
        `;
        }

        return metadata.ratings.map(rating => {
            // Extract rating dimensions from tags
            const ratingTags = rating.tags?.filter(t => t[0] === 'rating') || [];
            const overallTag = rating.tags?.find(t => t[0] === 'overall');
            const confidenceTag = rating.tags?.find(t => t[0] === 'confidence');

            const dimensionScores = ratingTags.map(t => ({
                dimension: t[1],
                score: parseInt(t[2], 10),
                maxScore: parseInt(t[3], 10) || 10
            }));

            const overallScore = overallTag ? parseFloat(overallTag[1]) : null;
            const confidence = confidenceTag ? parseInt(confidenceTag[1], 10) : null;

            return `
          <div class="nmd-rating-item">
            <div class="nmd-rating-item__header">
              <span class="nmd-rating-item__author">${rating.pubkey.substring(0, 8)}...</span>
              <span class="nmd-rating-item__date">${Utils.formatDate(rating.createdAt)}</span>
              ${overallScore !== null ? `<span class="nmd-rating-item__overall">Overall: ${overallScore}/10</span>` : ''}
            </div>
            <div class="nmd-rating-item__scores">
              ${dimensionScores.map(({dimension, score, maxScore}) => `
                <div class="nmd-rating-dimension">
                  <span class="nmd-rating-dimension__label">${dimension}</span>
                  <div class="nmd-rating-dimension__bar">
                    <div class="nmd-rating-dimension__fill" style="width: ${(score/maxScore)*100}%"></div>
                  </div>
                  <span class="nmd-rating-dimension__value">${score}/${maxScore}</span>
                </div>
              `).join('')}
            </div>
            ${confidence !== null ? `<div class="nmd-rating-item__confidence">Confidence: ${confidence}%</div>` : ''}
            ${rating.content ? `<div class="nmd-rating-item__review">${Utils.escapeHtml(rating.content)}</div>` : ''}
          </div>
        `;
        }).join('');
    },

    /**
     * Render comments tab content
     */
    renderCommentsTab: (metadata) => {
        if (!metadata.comments || metadata.comments.length === 0) {
            return `
          <div class="nmd-empty">
            <div class="nmd-empty__icon">💬</div>
            <div class="nmd-empty__text">No comments yet</div>
          </div>
        `;
        }

        // Sort by createdAt descending (newest first)
        const sortedComments = [...metadata.comments].sort((a, b) => b.createdAt - a.createdAt);

        return sortedComments.map(comment => {
            // Check for reply threading
            const replyTag = comment.tags?.find(t => t[0] === 'e' && t[3] === 'reply');
            const isReply = !!replyTag;

            return `
          <div class="nmd-comment-item ${isReply ? 'nmd-comment-item--reply' : ''}">
            <div class="nmd-comment-item__header">
              <span class="nmd-comment-item__author">${comment.pubkey.substring(0, 8)}...</span>
              <span class="nmd-comment-item__date">${Utils.formatDate(comment.createdAt)}</span>
            </div>
            <div class="nmd-comment-item__content">
              ${Utils.escapeHtml(comment.content || '')}
            </div>
          </div>
        `;
        }).join('');
    },

    /**
     * Render annotations tab content
     */
    renderAnnotationsTab: (metadata) => {
        if (metadata.annotations.length === 0) {
            return `
          <div class="nmd-empty">
            <div class="nmd-empty__icon">📝</div>
            <div class="nmd-empty__text">No annotations yet</div>
          </div>
        `;
        }

        return metadata.annotations.map(ann => `
        <div class="nmd-rating-item">
          <div class="nmd-rating-item__header">
            <span class="nmd-rating-item__author">${ann.pubkey.substring(0, 8)}...</span>
            <span class="nmd-rating-item__date">${Utils.formatDate(ann.createdAt)}</span>
          </div>
          <div style="font-size: 13px; color: var(--nmd-text); margin-top: 8px;">
            ${Utils.escapeHtml(ann.content.text || ann.content.comment || JSON.stringify(ann.content))}
          </div>
        </div>
      `).join('');
    },

    /**
     * Render fact-checks tab content
     */
    renderFactChecksTab: (metadata) => {
        if (metadata.factChecks.length === 0) {
            return `
          <div class="nmd-empty">
            <div class="nmd-empty__icon">🔍</div>
            <div class="nmd-empty__text">No fact-checks yet</div>
          </div>
        `;
        }

        return metadata.factChecks.map(fc => {
            const verdict = fc.content.verdict || 'unverifiable';
            return `
          <div class="nmd-fact-check-item nmd-fact-check-item--${verdict}">
            <span class="nmd-fact-check-item__verdict nmd-fact-check-item__verdict--${verdict}">
              ${verdict.toUpperCase()}
            </span>
            <div class="nmd-fact-check-item__claim">
              ${Utils.escapeHtml(fc.content.claim || 'Claim not specified')}
            </div>
            <div class="nmd-fact-check-item__evidence">
              ${Utils.escapeHtml(fc.content.evidence || fc.content.summary || '')}
            </div>
          </div>
        `;
        }).join('');
    },

    /**
     * Add headline correction indicator to page
     * @param {Object} metadata - Aggregated metadata
     */
    addHeadlineCorrectionIndicators: (metadata) => {
        if (metadata.headlineCorrections.length === 0) return;

        // Find h1 elements
        const headings = document.querySelectorAll('h1');

        headings.forEach(heading => {
            // Check if already processed
            if (heading.querySelector('.nmd-headline-correction')) return;

            const correction = metadata.headlineCorrections[0];
            const indicator = document.createElement('span');
            indicator.className = 'nmd-headline-correction';
            indicator.innerHTML = `
          <span class="nmd-headline-correction__icon">!</span>
          <div class="nmd-headline-correction__popup">
            <div class="nmd-headline-correction__label">Suggested Correction</div>
            <div class="nmd-headline-correction__original">${Utils.escapeHtml(heading.textContent)}</div>
            <div class="nmd-headline-correction__suggested">${Utils.escapeHtml(correction.content.suggested || correction.content.correction || 'N/A')}</div>
            <div class="nmd-headline-correction__meta">
              <span>Problem: ${correction.content.problemType || 'clickbait'}</span>
              <span>by ${correction.pubkey.substring(0, 8)}...</span>
            </div>
          </div>
        `;

            heading.style.position = 'relative';
            heading.appendChild(indicator);
        });
    },

    /**
     * Add inline annotation highlights to page content
     * @param {Object} metadata - Aggregated metadata
     */
    addInlineAnnotationHighlights: (metadata) => {
        if (metadata.annotations.length === 0) return;

        for (const annotation of metadata.annotations) {
            if (!annotation.content.selector) continue;

            const selector = annotation.content.selector;

            // Handle text quote selectors
            if (selector.type === 'TextQuoteSelector' && selector.exact) {
                MetadataUI.highlightText(selector.exact, annotation);
            }
        }
    },

    /**
     * Highlight specific text in the page
     * @param {string} text - Text to highlight
     * @param {Object} annotation - Annotation data
     */
    highlightText: (text, annotation) => {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        const nodesToProcess = [];
        let node;

        while (node = walker.nextNode()) {
            if (node.textContent.includes(text)) {
                nodesToProcess.push(node);
            }
        }

        for (const textNode of nodesToProcess) {
            const parent = textNode.parentNode;
            if (parent.classList?.contains('nmd-annotation-highlight')) continue;

            const index = textNode.textContent.indexOf(text);
            if (index === -1) continue;

            const before = textNode.textContent.substring(0, index);
            const match = textNode.textContent.substring(index, index + text.length);
            const after = textNode.textContent.substring(index + text.length);

            const fragment = document.createDocumentFragment();

            if (before) {
                fragment.appendChild(document.createTextNode(before));
            }

            const highlight = document.createElement('span');
            highlight.className = 'nmd-annotation-highlight';
            highlight.textContent = match;
            highlight.innerHTML += `
          <div class="nmd-annotation-popup">
            <div class="nmd-annotation-popup__header">
              <div class="nmd-annotation-popup__avatar">📝</div>
              <span class="nmd-annotation-popup__author">${annotation.pubkey.substring(0, 8)}...</span>
              <span class="nmd-annotation-popup__trust">Verified</span>
            </div>
            <div class="nmd-annotation-popup__content">
              ${Utils.escapeHtml(annotation.content.text || annotation.content.comment || '')}
            </div>
            <div class="nmd-annotation-popup__actions">
              <button class="nmd-annotation-popup__action">👍 Agree</button>
              <button class="nmd-annotation-popup__action">👎 Disagree</button>
            </div>
          </div>
        `;
            fragment.appendChild(highlight);

            if (after) {
                fragment.appendChild(document.createTextNode(after));
            }

            parent.replaceChild(fragment, textNode);

            // Only highlight first occurrence
            break;
        }
    },

    /**
     * Add metadata badges to links in the page
     * @param {Map} linkMetadataMap - Map of link URLs to their metadata
     */
    addLinkMetadataBadges: async (linkMetadataMap) => {
        const links = document.querySelectorAll('article a, .content a, main a, .post a');

        for (const link of links) {
            if (link.querySelector('.nmd-link-badge')) continue;

            const href = link.href;
            if (!href || href.startsWith('javascript:') || href.startsWith('#')) continue;

            const normalizedUrl = Utils.normalizeUrl(href);
            const metadata = linkMetadataMap.get(normalizedUrl);

            if (metadata) {
                const badge = document.createElement('span');
                badge.className = 'nmd-link-badge';

                // Determine badge type based on metadata
                if (metadata.aggregates.verdictSummary?.hasDebunking) {
                    badge.classList.add('nmd-link-badge--false');
                    badge.textContent = '!';
                    badge.title = 'This link has been fact-checked as false or misleading';
                } else if (metadata.aggregates.trustScore >= 0.7) {
                    badge.classList.add('nmd-link-badge--verified');
                    badge.textContent = '✓';
                    badge.title = 'Highly trusted source';
                } else if (metadata.aggregates.trustScore >= 0.4) {
                    badge.classList.add('nmd-link-badge--disputed');
                    badge.textContent = '?';
                    badge.title = 'Mixed reviews';
                } else {
                    badge.classList.add('nmd-link-badge--unknown');
                    badge.textContent = '?';
                    badge.title = 'Limited metadata available';
                }

                link.style.position = 'relative';
                link.appendChild(badge);
            }
        }
    },

    /**
     * Load and display metadata for the current page
     */
    loadCurrentPageMetadata: async () => {
        MetadataUI.state.isLoading = true;
        MetadataUI.renderPanelContent();

        try {
            const url = window.location.href;
            const metadata = await URLMetadataService.queryMetadata(url);

            MetadataUI.state.metadata = metadata;
            MetadataUI.state.isLoading = false;

            // Update UI components
            MetadataUI.updateBadge(metadata);
            MetadataUI.showDebunkBannerIfNeeded(metadata);
            MetadataUI.addHeadlineCorrectionIndicators(metadata);
            MetadataUI.addInlineAnnotationHighlights(metadata);

            // Render panel if open
            if (MetadataUI.state.isPanelOpen) {
                MetadataUI.renderPanelContent();
            }

            Utils.log('Metadata loaded:', metadata.eventCount, 'events');

            // Queue link metadata lookup (async, lower priority)
            MetadataUI.queueLinkMetadataLookup();

        } catch (e) {
            Utils.error('Failed to load metadata:', e);
            MetadataUI.state.isLoading = false;
            MetadataUI.renderPanelContent();
        }
    },

    /**
     * Queue link metadata lookup (batched, lower priority)
     */
    queueLinkMetadataLookup: async () => {
        // Get all links in main content
        const links = document.querySelectorAll('article a, .content a, main a');
        const uniqueUrls = new Set();

        for (const link of links) {
            const href = link.href;
            if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
                uniqueUrls.add(Utils.normalizeUrl(href));
            }
        }

        Utils.log('Found', uniqueUrls.size, 'unique links to check');

        // Limit to first 20 links for performance
        const urlsToCheck = Array.from(uniqueUrls).slice(0, 20);
        const linkMetadataMap = new Map();

        // Query in small batches
        for (let i = 0; i < urlsToCheck.length; i += 5) {
            const batch = urlsToCheck.slice(i, i + 5);

            await Promise.all(batch.map(async (url) => {
                try {
                    const metadata = await URLMetadataService.queryMetadata(url);
                    if (metadata.eventCount > 0) {
                        linkMetadataMap.set(url, metadata);
                    }
                } catch (e) {
                    // Ignore individual link failures
                }
            }));

            // Small delay between batches
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Add badges to links with metadata
        MetadataUI.addLinkMetadataBadges(linkMetadataMap);
    }
};

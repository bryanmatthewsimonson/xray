// X-Ray Reader — extension-page article capture UI.
// Replaces the v1 in-panel capture with a real browser page.
//
// Flow:
//   1. Content script extracted an article and stashed it via
//      chrome.storage.session keyed by a UUID.
//   2. Content script opened this page with ?id=<uuid> on the URL.
//   3. This script pulls the article, renders it, owns the editor state.
//   4. On publish, sends a message to the background service worker
//      with the unsigned event. (Publish wiring lands in the next
//      commit; for now the button shows an "about to publish" toast.)

import { ContentExtractor } from '../shared/content-extractor.js';
import { EventBuilder } from '../shared/event-builder.js';
import { LocalKeyManager } from '../shared/local-key-manager.js';
import { EntityModel, installEntityStorageBridge } from '../shared/entity-model.js';
import { recordAccount, extractPostAuthor } from '../shared/identity/account-registry.js';
import { ClaimModel } from '../shared/claim-model.js';
import { EvidenceLinker } from '../shared/evidence-linker.js';
import * as ArchiveCache from '../shared/archive-cache.js';
import { installEntityTagger, rehydrateEntityMarks } from './entity-tagger.js';
import { openClaimModal, openEvidenceLinkModal, openOthersClaimsModal, renderClaimsBar, rehydrateClaimMarks } from './claim-extractor.js';
import { openAssessModal } from '../shared/assess-modal.js';
import { AssessmentModel } from '../shared/assessment-model.js';
import { makeClaimRefCanonicalizer } from '../shared/claim-ref.js';
import { selectAssessmentsToPublish, selectLinksToPublish, selectMirrors } from '../shared/assessment-publish.js';
import { buildAssessmentEvent, buildClaimRelationshipEvent, buildAssessmentMirrorEvent } from '../shared/metadata/builders.js';
import { loadFlags, isEnabled } from '../shared/metadata/feature-flags.js';
import { articleHash as canonicalArticleHash } from '../shared/audit/article-hash.js';

const browserApi = typeof browser !== 'undefined' && browser.runtime ? browser : chrome;

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------

const state = {
    id: null,            // session-storage id for this article
    article: null,       // the article object as extracted
    viewMode: 'reader',  // 'reader' | 'markdown' | 'preview'
    // Working copies. Reader mode edits `htmlDraft`. Markdown mode edits
    // `markdownDraft`. Whichever was last edited is the source of truth
    // on publish.
    htmlDraft: '',
    markdownDraft: '',
    dirtySource: 'reader', // which draft is canonical
    // Platform comments — Substack today, YouTube/Twitter/etc. in later
    // phases. The tree is whatever the platform-specific fetcher returns
    // via `xray:substack:fetchComments` (or equivalent).
    comments: {
        platform: null,   // 'substack' | ...
        tree: [],
        total: 0,
        status: 'idle',   // 'idle' | 'loading' | 'ready' | 'error'
        error: null,
        includeInPublish: false
    }
};

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function $(sel, root = document) { return root.querySelector(sel); }

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function toast(message, type = 'success', timeoutMs = 3200) {
    const el = $('#xr-toast');
    el.textContent = message;
    el.className = 'xr-reader__toast xr-reader__toast--' + type;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, timeoutMs);
}

function fmtDate(tsSec) {
    if (!tsSec) return '';
    return new Date(tsSec * 1000).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
    });
}

function parseDate(str) {
    const t = Date.parse(str);
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

// ------------------------------------------------------------------
// Load article from session storage
// ------------------------------------------------------------------

async function loadArticle() {
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    if (!id) throw new Error('Missing ?id= parameter. Capture a page with the X-Ray toolbar icon (or Ctrl/Cmd+Shift+X).');
    state.id = id;

    const key = 'xray:article:' + id;
    const stored = await new Promise((resolve) => {
        // chrome.storage.session is the natural home for one-shot article
        // hand-off between content script and extension page. Falls back
        // to storage.local if session isn't available (Firefox < 115
        // shipped session later than local).
        const area = browserApi.storage.session || browserApi.storage.local;
        area.get([key], (res) => resolve(res && res[key]));
    });
    if (!stored) {
        throw new Error('Article not found. The reader tab may have been reopened after the source tab was closed.');
    }

    // The SW stores `{ article, sourceTabId, createdAt }` — unwrap the
    // article payload. Tolerate the pre-v0.2.1 flat shape in case anyone
    // has a stale session record open from before this fix.
    const article = (stored && typeof stored === 'object' && stored.article)
        ? stored.article
        : stored;
    if (!article || typeof article !== 'object' || !article.title && !article.content) {
        throw new Error(
            'The stored article has no content. ' +
            'This likely means Readability could not extract a body from the source page. ' +
            'Try reloading the source tab and capturing again.'
        );
    }

    state.article = article;
    state.markdownDraft = article.markdown || article.content || '';
    state.htmlDraft = article.content || ContentExtractor.markdownToHtml(state.markdownDraft);

    // Tagged-entity refs stored on the article get round-tripped through
    // the session-storage hand-off. Ensure the field exists so the
    // tagger and publish paths can write to it without null-guards.
    if (!Array.isArray(state.article.entities)) state.article.entities = [];

    // Cache the freshly-loaded article locally so revisits can detect
    // prior captures. publishedToRelay stays false until the publish
    // flow explicitly flips it. Fire-and-forget — reader load should
    // not block on the IDB round trip. SKIPPED for read-only opens
    // (the portal's relay reconstructions, Phase 12.7): overwriting
    // the archive row here would reset its publishedToRelay marker and
    // break the portal's read-only guarantee.
    //
    // Phase 13.4: hash this capture (the canonical article hash — the
    // `x` tag value) and compare against the prior archived record
    // BEFORE the save replaces it. A different hash for the same URL
    // is a detected content change (the stealth-edit surface) —
    // sequenced, not racing, so the comparison reads the prior row.
    if (state.article && state.article.url && !(stored && stored.readOnly)) {
        (async () => {
            try {
                state.articleHash = await canonicalArticleHash(
                    EventBuilder.assembleArticleBody(state.article));
                updateHashLine();
            } catch (err) {
                console.warn('[X-Ray Reader] article hash failed:', err);
            }
            try {
                const prior = await ArchiveCache.getArticle(state.article.url);
                if (prior && prior.articleHash && state.articleHash
                        && prior.articleHash !== state.articleHash) {
                    renderHashMismatchBanner(prior);
                }
            } catch (err) {
                console.warn('[X-Ray Reader] hash check failed:', err);
            }
            ArchiveCache.saveArticle({ article: state.article, source: 'capture' })
                .catch((err) => console.warn('[X-Ray Reader] archive cache save failed:', err));
        })();
    }

    // Archive-reader affordance — if this capture looks paywalled OR
    // truncated, check for a richer version (local cache hit with
    // a longer body, or a relay-hosted kind-30023). The banner UI is
    // rendered AFTER the main view mounts so we don't block the
    // render on a network round-trip.
    setTimeout(() => checkArchiveAvailability().catch((err) =>
        console.warn('[X-Ray Reader] archive check failed:', err)), 100);
}

// ------------------------------------------------------------------
// Archive reader (Phase 7 C4+C5)
// ------------------------------------------------------------------

/**
 * Decide whether the current capture could be improved by loading
 * an archived version, then (if so) render a banner offering it.
 *
 * Sensitivity modes (Options → Advanced → Archive banner):
 *   'always' (default) — show whenever an archived copy exists and
 *                        differs from the current capture (skip only
 *                        on byte-identical / strict-prefix matches).
 *   'richer'           — preserve the prior heuristic: archive must
 *                        be ≥1.3× longer AND >1000 chars. Useful for
 *                        users who only want the banner when the
 *                        archive is meaningfully fuller (e.g. a
 *                        paywall unlock).
 *   'never'            — skip the check entirely.
 */
async function checkArchiveAvailability() {
    const url = state.article && state.article.url;
    if (!url) return;

    const prefs = await loadPreferences();
    const mode = prefs.archive_banner_sensitivity || 'always';
    if (mode === 'never') return;

    const currentBody = state.article.content || '';
    const currentLen = currentBody.length;

    // 1. Try local cache first.
    let cached = null;
    try { cached = await ArchiveCache.getArticle(url); } catch (_) { /* ignore */ }
    if (cached && cached.article && cached.article.content) {
        const cachedBody = cached.article.content;
        if (shouldOfferArchive(currentBody, cachedBody, mode)) {
            renderArchiveBanner({
                source:   'cache',
                cachedAt: cached.cachedAt,
                article:  cached.article,
                metric:   describeMetric(currentBody, cachedBody)
            });
            return;
        }
    }

    // 2. Always probe relay reconstruction in 'always' mode; in
    //    'richer' mode keep the prior <1500-char paywall-shaped guard
    //    to avoid pinging relays for full-length captures.
    const probeRelay = mode === 'always' || currentLen < 1500;
    if (probeRelay) {
        try {
            const resp = await browserApi.runtime.sendMessage({
                type: 'xray:archive:reconstruct',
                url
            });
            if (resp && resp.ok && resp.found && resp.article) {
                const reconstructedBody = resp.article.content || '';
                if (shouldOfferArchive(currentBody, reconstructedBody, mode)) {
                    renderArchiveBanner({
                        source:    'relay',
                        author:    resp.authorPubkey,
                        createdAt: resp.createdAt,
                        article:   resp.article,
                        metric:    resp.altCount > 0
                            ? `${resp.altCount + 1} relay versions found, newest shown`
                            : describeMetric(currentBody, reconstructedBody)
                    });
                }
            }
        } catch (err) {
            console.warn('[X-Ray Reader] relay archive reconstruct failed:', err);
        }
    }
}

async function loadPreferences() {
    return new Promise((resolve) => {
        try {
            browserApi.storage.local.get(['preferences'], (res) => {
                const raw = res && res.preferences;
                if (!raw) return resolve({});
                if (typeof raw === 'string') {
                    try { return resolve(JSON.parse(raw)); } catch (_) { return resolve({}); }
                }
                return resolve(raw);
            });
        } catch (_) { resolve({}); }
    });
}

/**
 * Decide whether an archived body is worth surfacing over the current
 * capture, given the user's sensitivity preference.
 *
 * 'richer' keeps the prior 1.3×/1000-char threshold.
 * 'always' shows whenever the archive is non-trivially different —
 *          skip byte-identical matches and skip when the archive is
 *          strictly contained in the current body (the current is a
 *          superset, so the archive can only lose information).
 */
function shouldOfferArchive(currentBody, archiveBody, mode) {
    if (!archiveBody) return false;
    if (mode === 'richer') {
        return archiveBody.length > currentBody.length * 1.3 && archiveBody.length > 1000;
    }
    if (archiveBody === currentBody) return false;
    if (currentBody && currentBody.includes(archiveBody)) return false;
    return true;
}

function describeMetric(currentBody, archiveBody) {
    const cur = currentBody.length;
    const arc = archiveBody.length;
    if (cur > 0 && arc >= cur * 1.3) {
        return `Archive is ${(arc / Math.max(cur, 1)).toFixed(1)}× longer`;
    }
    if (arc > cur) return `Archive is ${arc - cur} chars longer`;
    if (arc < cur) return `Archive is ${cur - arc} chars shorter`;
    return 'Archive differs from current capture';
}

/**
 * Render the archive banner above the article body. Two actions:
 *
 *   "Load archive" — swap the reader's main body for the archive's
 *                    content + markdown, re-render.
 *   "Keep capture" — dismiss the banner.
 */
function renderArchiveBanner({ source, article, metric, cachedAt, createdAt, author }) {
    let banner = $('#xr-archive-banner');
    if (!banner) {
        banner = document.createElement('aside');
        banner.id = 'xr-archive-banner';
        banner.className = 'xr-archive-banner';
        const main = $('#xr-main');
        if (!main || !main.parentElement) return;
        main.parentElement.insertBefore(banner, main);
    }

    const ago = cachedAt
        ? new Date(cachedAt * 1000).toLocaleDateString()
        : (createdAt ? new Date(createdAt * 1000).toLocaleDateString() : '');
    const sourceLabel = source === 'cache'
        ? `📦 Your archive (${escapeHtml(ago)})`
        : `🌐 Relay archive by ${escapeHtml((author || '').slice(0, 12) + '…')} (${escapeHtml(ago)})`;

    banner.innerHTML = `
      <div class="xr-archive-banner__body">
        <div class="xr-archive-banner__label">${sourceLabel}</div>
        <div class="xr-archive-banner__metric">${escapeHtml(metric || '')}</div>
      </div>
      <div class="xr-archive-banner__actions">
        <button type="button" class="xr-reader__btn xr-reader__btn--primary" id="xr-archive-load">Load archive</button>
        <button type="button" class="xr-reader__btn xr-reader__btn--ghost" id="xr-archive-dismiss">Keep capture</button>
      </div>
    `;

    $('#xr-archive-dismiss').addEventListener('click', () => banner.remove());
    $('#xr-archive-load').addEventListener('click', () => {
        loadArchivedArticle(article, { source, cachedAt, createdAt, author });
        banner.remove();
    });
}

/**
 * Swap the reader's article payload for the archived version. Leaves
 * entity refs, claims, and comments untouched — the user was working
 * on this capture's metadata and the archive is only replacing the
 * body content.
 */
function loadArchivedArticle(archived, provenance) {
    state.article = {
        ...archived,
        // Preserve the URL / id bridging so publish + session paths
        // stay consistent with the tab this reader was opened from.
        url: state.article.url,
        entities: state.article.entities || []
    };
    // Tag the article object with archive provenance for the publish
    // flow's awareness + any downstream consumers that care.
    state.article._archiveSource = provenance.source;
    if (provenance.cachedAt) state.article._archiveCachedAt = provenance.cachedAt;
    if (provenance.createdAt) state.article._archiveCreatedAt = provenance.createdAt;
    if (provenance.author)   state.article._archiveAuthor = provenance.author;

    state.markdownDraft = archived.markdown || archived.content || '';
    state.htmlDraft     = archived.content  || ContentExtractor.markdownToHtml(state.markdownDraft);
    state.dirtySource   = 'reader';

    // The hash line labels the visible body — the swapped-in archive
    // is different text, so the load-time hash is wrong for it. Relay
    // archives carry the PUBLISHED hash (carry, don't recompute: the
    // HTML round trip doesn't byte-match); cache archives recompute.
    state.articleHash = archived._articleHash || null;
    state.hashDirty = false;
    if (!state.articleHash) {
        canonicalArticleHash(EventBuilder.assembleArticleBody(state.article))
            .then((h) => { state.articleHash = h; updateHashLine(); })
            .catch((err) => console.warn('[X-Ray Reader] archive hash failed:', err));
    }

    // Re-render whatever view the user's currently in.
    switch (state.viewMode) {
        case 'reader':   renderReader();   break;
        case 'markdown': renderMarkdown(); break;
        case 'preview':  renderPreview();  break;
    }
    toast(`Archive loaded (${provenance.source})`, 'success', 3000);
}

// ------------------------------------------------------------------
// Render — READER mode
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Canonical article hash (Phase 13.4)
// ------------------------------------------------------------------

// Fill (or refresh) the small hash line under the article meta. The
// hash computes async after first render, and mode switches re-render
// the template — so this is callable from both paths.
function updateHashLine() {
    const el = $('#xr-article-hash');
    if (!el) return;
    if (!state.articleHash) { el.hidden = true; return; }
    el.hidden = false;
    if (state.hashDirty) {
        el.title = 'The body was edited — the published hash is computed from the final text at publish time.';
        el.textContent = 'content hash — edited, recomputed at publish';
        return;
    }
    el.title = state.articleHash;
    el.textContent = 'content hash ' + state.articleHash.slice(0, 16) + '…';
}

// Stealth-edit surface: the same URL hashed differently on a prior
// capture. Informational — the prior text stays in the archive; the
// re-audit affordance arrives with the audit panel (13.6).
function renderHashMismatchBanner(prior) {
    let banner = $('#xr-hash-banner');
    if (!banner) {
        banner = document.createElement('aside');
        banner.id = 'xr-hash-banner';
        banner.className = 'xr-hash-banner';
        const main = $('#xr-main');
        if (!main || !main.parentElement) return;
        main.parentElement.insertBefore(banner, main);
    }
    const ago = prior.cachedAt ? new Date(prior.cachedAt * 1000).toLocaleDateString() : 'earlier';
    banner.innerHTML = `
      <div class="xr-hash-banner__body">
        <div class="xr-hash-banner__label">⚠️ Content changed since your last capture (${escapeHtml(ago)})</div>
        <div class="xr-hash-banner__metric">The text hashes differently — the page was edited between captures. Your previous capture stays in the archive; audits anchor to the exact text they scored.</div>
      </div>
      <div class="xr-hash-banner__actions">
        <button type="button" class="xr-reader__btn xr-reader__btn--ghost" id="xr-hash-dismiss">Dismiss</button>
      </div>
    `;
    $('#xr-hash-dismiss').addEventListener('click', () => banner.remove());
}

function renderReader() {
    const a = state.article;
    const main = $('#xr-main');
    main.innerHTML = `
      <article class="xr-article">
        ${renderCaptureQualityHint(a)}
        <header class="xr-article__meta">
          <h1 class="xr-article__title" contenteditable="true" spellcheck="false" data-field="title">${escapeHtml(a.title || 'Untitled')}</h1>
          <div class="xr-article__byline-row">
            ${field('Author',      'byline',      a.byline)}
            ${field('Publication', 'siteName',    a.siteName)}
            ${field('Published',   'publishedAt', fmtDate(a.publishedAt))}
            ${field('URL',         'url',         a.url)}
          </div>
          <div class="xr-article__hash" id="xr-article-hash" hidden></div>
        </header>
        ${renderYouTubeHeader(a)}
        ${renderTikTokHeader(a)}
        ${renderInstagramHeader(a)}
        ${renderFacebookHeader(a)}
        ${a.featuredImage && !isYouTubeArticle(a) && !isTikTokArticle(a) && !isInstagramArticle(a) && !isFacebookArticle(a) ? `<img class="xr-article__featured" src="${escapeHtml(a.featuredImage)}" alt="" loading="lazy" />` : ''}
        <div class="xr-article__body" contenteditable="true" spellcheck="true" data-field="content"></div>
      </article>
    `;
    // Inject the stored HTML without re-escaping, since it came from
    // Readability which already sanitizes to a safe HTML fragment.
    const body = $('.xr-article__body');
    body.innerHTML = state.htmlDraft;

    // Rehydrate entity marks for any refs the article was loaded with.
    // Best-effort: marks that can't be matched back to their source text
    // (because the user edited the body between captures) are silently
    // skipped; the p-tag on publish is what actually matters.
    if (state.article.entities && state.article.entities.length > 0) {
        rehydrateEntityMarks(body, state.article.entities)
            .catch((err) => console.warn('[X-Ray Reader] rehydrate failed:', err));
    }

    // Mount the entity tagger on the article body. Its onTag callback
    // pushes the resolved ref onto the article's entity list and marks
    // state as dirty so the publish path picks it up. The onClaim
    // callback hands off to the claim extractor — opens the claim
    // modal with the selected text + surrounding paragraph pre-filled.
    if (state._taggerUninstall) state._taggerUninstall();
    state._taggerUninstall = installEntityTagger({
        container: body,
        onTag: (ref) => {
            // De-dup: same entity_id + context → ignore. Avoids accidental
            // double-tagging when the user re-selects the same text.
            const dup = state.article.entities.find(
                (e) => e.entity_id === ref.entity_id && e.context === ref.context
            );
            if (!dup) state.article.entities.push(ref);
            // Sync htmlDraft with whatever the mark wrap did to the body.
            state.htmlDraft = body.innerHTML;
            state.dirtySource = 'reader';
        },
        onClaim: async ({ text, context, anchor }) => {
            const saved = await openClaimModal({
                sourceUrl:   state.article.url,
                initialText: text,
                context,
                anchor,
                // Sticky default (Phase 11.3): a case-capture session tags
                // dozens of claims with the same case entity + people.
                initialAbout: state.lastClaimAbout || []
            });
            if (saved) {
                state.lastClaimAbout = saved.about || [];
                toast('Claim saved', 'success', 2000);
                await refreshClaimsBar();
            }
        }
    });

    // Render the claims bar below the article body. Fires in the
    // background — we don't block the main render on it.
    refreshClaimsBar().catch((err) => console.warn('[X-Ray Reader] claims-bar render failed:', err));

    // Re-fill the hash line — the template above recreates it hidden,
    // and the hash (computed async at load) may already be known.
    updateHashLine();

    // Wire metadata-field edits back to the article object.
    main.querySelectorAll('[contenteditable]').forEach((el) => {
        el.addEventListener('input', onReaderFieldInput);
        el.addEventListener('blur', onReaderFieldBlur);
    });
}

// ------------------------------------------------------------------
// Claims bar (Phase 5 C2)
// ------------------------------------------------------------------

/**
 * Pull all claims attached to `state.article.url` from the claim
 * registry, render the bar beneath the article body, and wire up the
 * edit / delete row actions. Also rehydrates visual `xr-claim` marks
 * on the body for each claim whose text still appears verbatim.
 */
async function refreshClaimsBar() {
    const host = $('#xr-claims-host');
    if (!host || !state.article || !state.article.url) return;

    const claims = await ClaimModel.getBySourceUrl(state.article.url);
    host.innerHTML = await renderClaimsBar(claims);

    // Rehydrate marks on the article body so tagged passages stay
    // visibly linked. Best-effort: edits between captures may leave
    // some marks unanchored; the claim data itself is unaffected.
    const body = $('.xr-article__body');
    if (body) rehydrateClaimMarks(body, claims);

    // "Others' claims" — queries the configured relay pool for
    // kind-30040 events filtered by this article's URL. The handler
    // lives on the bar header, not on individual cards.
    const othersBtn = host.querySelector('#xr-claims-others');
    if (othersBtn) {
        othersBtn.addEventListener('click', async () => {
            const relays = await getConfiguredRelays();
            const result = await openOthersClaimsModal({ url: state.article.url, relays });
            // Assessing a "foreign" claim can touch one of OURS (its
            // coordinate collapses to the local id) — refresh badges.
            if (result && result.assessed) await refreshClaimsBar();
        });
    }

    // Wire per-row actions.
    host.querySelectorAll('.xr-claims__item').forEach((row) => {
        const id = row.dataset.id;
        const editBtn   = row.querySelector('[data-action="edit"]');
        const delBtn    = row.querySelector('[data-action="delete"]');
        const linkBtn   = row.querySelector('[data-action="link"]');
        const assessBtn = row.querySelector('[data-action="assess"]');
        if (editBtn) editBtn.addEventListener('click', () => openEditClaim(id));
        if (delBtn)  delBtn.addEventListener('click',  () => confirmDeleteClaim(id));
        if (linkBtn) linkBtn.addEventListener('click', () => openLinkClaim(id, claims));
        if (assessBtn) assessBtn.addEventListener('click', async () => {
            const claim = claims.find((c) => c.id === id);
            const result = await openAssessModal({
                claimRef:  { claim_id: id },
                claimText: claim ? claim.text : '',
                anchorContext: { container: $('.xr-article__body') }
            });
            if (result) {
                toast(result.deleted ? 'Assessment removed' : 'Assessment saved', 'success', 1500);
                await refreshClaimsBar();
            }
        });

        // Per-link ✕ delete buttons.
        row.querySelectorAll('.xr-claims__link-del').forEach((btn) => {
            btn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                const linkId = btn.dataset.linkId;
                if (!linkId) return;
                if (!confirm('Remove this evidence link? Already-published kind-30043 stays on relays until NIP-09 delete (later phase).')) return;
                await EvidenceLinker.delete(linkId);
                toast('Link removed', 'success', 1500);
                await refreshClaimsBar();
            });
        });
    });
}

async function openLinkClaim(sourceId, allClaimsOnArticle) {
    const source = allClaimsOnArticle.find((c) => c.id === sourceId);
    if (!source) return;
    // Candidates span ALL captured claims (cross-source, Phase 11.4) —
    // the modal collects them itself.
    const link = await openEvidenceLinkModal({ sourceClaim: source });
    if (link) {
        toast('Claim link saved', 'success', 1500);
        await refreshClaimsBar();
    }
}

async function openEditClaim(id) {
    const claim = await ClaimModel.get(id);
    if (!claim) { toast('Claim not found', 'error'); return; }
    const saved = await openClaimModal({
        sourceUrl:    state.article.url,
        initialClaim: claim
    });
    if (saved) {
        toast('Claim updated', 'success', 2000);
        await refreshClaimsBar();
    }
}

async function confirmDeleteClaim(id) {
    const claim = await ClaimModel.get(id);
    if (!claim) return;
    // Count any links / assessment this claim participates in so the
    // user sees the blast radius before confirming.
    const links = await EvidenceLinker.getForClaim(id);
    const assessment = await AssessmentModel.getByClaimRef(id);
    const lines = [];
    if (claim.publishedAt) {
        lines.push('Already-published kind-30040 stays on relays until NIP-09 delete (later phase).');
    }
    if (links.length > 0) {
        lines.push(`${links.length} claim link${links.length === 1 ? '' : 's'} will also be removed.`);
    }
    if (assessment) {
        lines.push('Your assessment of it will also be removed.');
    }
    const msg = lines.length > 0
        ? `Delete claim? ${lines.join(' ')}`
        : 'Delete claim?';
    if (!confirm(msg)) return;
    // Delete dependents FIRST: canonical-ref matching reads the claim
    // registry, so it must still see the claim while matching.
    if (links.length > 0) await EvidenceLinker.deleteForClaim(id);
    if (assessment) await AssessmentModel.delete(assessment.id);
    await ClaimModel.delete(id);
    toast('Claim deleted', 'success', 2000);
    await refreshClaimsBar();
}

// ------------------------------------------------------------------
// YouTube-specific header (Phase 3b — C2)
// ------------------------------------------------------------------

function isYouTubeArticle(article) {
    return article && article.platform === 'youtube' && article.youtube;
}

/**
 * Render a video-shaped header block for YouTube captures: the
 * thumbnail becomes a click-through to the source video, with a duration
 * badge overlaid on it (matching YouTube's own UI pattern), and a row
 * of meta chips — channel, views, category, and captured-language
 * indicators — sits beneath.
 *
 * For non-YouTube articles, returns an empty string so nothing renders.
 */
function renderYouTubeHeader(article) {
    if (!isYouTubeArticle(article)) return '';
    const y = article.youtube;

    const durationLabel = y.durationSeconds != null
        ? formatDurationForChip(y.durationSeconds)
        : null;

    const viewsLabel = Number.isFinite(y.viewCount) && y.viewCount > 0
        ? `${y.viewCount.toLocaleString()} views`
        : null;

    const chips = [];
    if (y.channel?.name) {
        const channelUrl = y.channel.channelId
            ? `https://www.youtube.com/channel/${encodeURIComponent(y.channel.channelId)}`
            : null;
        chips.push(channelUrl
            ? `<a class="xr-video__chip xr-video__chip--channel" href="${escapeHtml(channelUrl)}" target="_blank" rel="noopener">${escapeHtml(y.channel.name)}</a>`
            : `<span class="xr-video__chip xr-video__chip--channel">${escapeHtml(y.channel.name)}</span>`
        );
    }
    if (viewsLabel)     chips.push(`<span class="xr-video__chip">${escapeHtml(viewsLabel)}</span>`);
    if (y.category)     chips.push(`<span class="xr-video__chip">${escapeHtml(y.category)}</span>`);
    if (y.isLive)       chips.push(`<span class="xr-video__chip xr-video__chip--live">LIVE</span>`);
    if (y.isShort)      chips.push(`<span class="xr-video__chip xr-video__chip--short" title="YouTube Short — transcripts rarely available">SHORT</span>`);

    // Captured-transcript manifest — one chip per language/kind that
    // actually has events. Honest about what's in the body: a
    // human-authored track is labelled differently from an ASR one, and
    // an origin-language track gets the "origin" accent.
    if (Array.isArray(y.transcripts)) {
        for (const t of y.transcripts) {
            if (!t || !Array.isArray(t.events) || t.events.length === 0) continue;
            const kindMark = t.kind === 'asr' ? 'auto' : 'human';
            const isOrigin = t.role && t.role.startsWith('origin');
            const label = `${t.displayName || t.languageCode || 'transcript'} · ${kindMark}`;
            const cls = isOrigin
                ? 'xr-video__chip xr-video__chip--transcript xr-video__chip--origin'
                : 'xr-video__chip xr-video__chip--transcript';
            chips.push(`<span class="${cls}" title="${escapeHtml(t.events.length + ' cues')}">${escapeHtml(label)}</span>`);
        }
    }

    const thumb = article.featuredImage;
    const watchUrl = article.url;
    const thumbHtml = thumb
        ? `
          <a class="xr-video__thumb" href="${escapeHtml(watchUrl)}" target="_blank" rel="noopener"
             title="Watch on YouTube">
            <img src="${escapeHtml(thumb)}" alt="" loading="lazy" />
            <span class="xr-video__play" aria-hidden="true">▶</span>
            ${durationLabel ? `<span class="xr-video__duration">${escapeHtml(durationLabel)}</span>` : ''}
          </a>`
        : '';

    return `
      <section class="xr-video">
        ${thumbHtml}
        ${chips.length > 0 ? `<div class="xr-video__chips">${chips.join('')}</div>` : ''}
      </section>
    `;
}

// ------------------------------------------------------------------
// TikTok-specific header (Phase 8b)
// ------------------------------------------------------------------

function isTikTokArticle(article) {
    return article && article.platform === 'tiktok' && article.tiktok;
}

/**
 * Video-shaped header for TikTok captures. Mirrors the YouTube
 * header structure: thumbnail with duration badge, then a row of
 * meta chips. Surfaces the screenshot evidence below the chips
 * when present — the screenshot IS the artifact for hard-tier
 * platforms even more than the metadata.
 */
function renderTikTokHeader(article) {
    if (!isTikTokArticle(article)) return '';
    const t = article.tiktok;

    const durationLabel = t.durationSeconds != null
        ? formatDurationForChip(t.durationSeconds)
        : null;

    const chips = [];
    if (t.author && t.author.nickname) {
        const handle = t.author.username ? ` (@${t.author.username})` : '';
        const verified = t.author.verified ? ' ✓' : '';
        chips.push(`<span class="xr-video__chip xr-video__chip--channel">${escapeHtml(t.author.nickname + verified + handle)}</span>`);
    }
    if (Number.isFinite(t.playCount)    && t.playCount    > 0) chips.push(`<span class="xr-video__chip">${escapeHtml(t.playCount.toLocaleString())} views</span>`);
    if (Number.isFinite(t.likeCount)    && t.likeCount    > 0) chips.push(`<span class="xr-video__chip">${escapeHtml(t.likeCount.toLocaleString())} likes</span>`);
    if (Number.isFinite(t.commentCount) && t.commentCount > 0) chips.push(`<span class="xr-video__chip">${escapeHtml(t.commentCount.toLocaleString())} comments</span>`);
    if (Number.isFinite(t.shareCount)   && t.shareCount   > 0) chips.push(`<span class="xr-video__chip">${escapeHtml(t.shareCount.toLocaleString())} shares</span>`);
    if (t.music && (t.music.title || t.music.authorName)) {
        const label = [t.music.title, t.music.authorName].filter(Boolean).join(' — ');
        chips.push(`<span class="xr-video__chip" title="Sound">♪ ${escapeHtml(label)}</span>`);
    }
    // Provenance tag — which SSR shape we extracted from. Useful
    // diagnostic when TikTok shifts formats; leaves a paper trail.
    if (t.sourceShape) chips.push(`<span class="xr-video__chip" title="Extraction source">${escapeHtml(t.sourceShape)}</span>`);

    const thumb = article.featuredImage;
    const watchUrl = article.url;
    const thumbHtml = thumb
        ? `
          <a class="xr-video__thumb" href="${escapeHtml(watchUrl)}" target="_blank" rel="noopener"
             title="Open on TikTok">
            <img src="${escapeHtml(thumb)}" alt="" loading="lazy" />
            ${durationLabel ? `<span class="xr-video__duration">${escapeHtml(durationLabel)}</span>` : ''}
          </a>
        `
        : '';

    // Evidence-layer screenshot. When the capture pipeline produced
    // one, render it inline so the user can see what was preserved
    // before publishing. The hash is implied by `article.evidence.screenshotHash`
    // which lands in event tags at publish time.
    const evidenceImg = article.evidence && article.evidence.screenshot
        ? `<details class="xr-video__evidence">
             <summary>📸 Screenshot evidence</summary>
             <img src="${escapeHtml(article.evidence.screenshot)}" alt="Captured screenshot" />
           </details>`
        : '';

    return `
      <div class="xr-video">
        ${thumbHtml}
        <div class="xr-video__chips">${chips.join('')}</div>
        ${evidenceImg}
      </div>
    `;
}

// ------------------------------------------------------------------
// Instagram-specific header (Phase 8c)
// ------------------------------------------------------------------

function isInstagramArticle(article) {
    return article && article.platform === 'instagram' && article.instagram;
}

/**
 * Image- or video-shaped header for Instagram captures. Same chip
 * vocabulary as TikTok plus an `extractedFrom` provenance chip
 * (currently always 'og-meta' — when GraphQL interception lands
 * the chip values diverge and we'll have a paper trail of which
 * extractor produced each artifact).
 */
function renderInstagramHeader(article) {
    if (!isInstagramArticle(article)) return '';
    const ig = article.instagram;
    const a  = ig.author || {};

    // Profile card — when we have profile data, render an
    // Instagram-style author block: avatar + display name + handle
    // + verified + follower count + bio. The whole block links to
    // the author's Instagram profile, making it one-click to verify
    // / cross-reference the source. Falls back gracefully when the
    // profile pic / follower count is missing.
    const profileBlock = a.handle ? `
        <div class="xr-ig-author">
            ${a.profilePicUrl
                ? `<a href="${escapeHtml(a.profileUrl)}" target="_blank" rel="noopener" class="xr-ig-author__avatar">
                     <img src="${escapeHtml(a.profilePicUrl)}" alt="${escapeHtml((a.nickname || a.handle) + ' profile photo')}" loading="lazy" />
                   </a>`
                : ''}
            <div class="xr-ig-author__meta">
                <div class="xr-ig-author__name-row">
                    <a href="${escapeHtml(a.profileUrl)}" target="_blank" rel="noopener" class="xr-ig-author__handle">@${escapeHtml(a.handle)}</a>
                    ${a.verified ? `<span class="xr-ig-author__verified" title="Verified by Instagram">✓</span>` : ''}
                    ${a.nickname && a.nickname !== a.handle
                        ? `<span class="xr-ig-author__nickname">${escapeHtml(a.nickname)}</span>`
                        : ''}
                </div>
                <div class="xr-ig-author__stats">
                    ${Number.isFinite(a.followerCount) && a.followerCount > 0
                        ? `<span title="Followers">${escapeHtml(a.followerCount.toLocaleString())} followers</span>`
                        : ''}
                    ${Number.isFinite(a.postCount) && a.postCount > 0
                        ? `<span title="Posts">${escapeHtml(a.postCount.toLocaleString())} posts</span>`
                        : ''}
                    ${a.category ? `<span title="Account category">${escapeHtml(a.category)}</span>` : ''}
                </div>
                ${a.biography ? `<div class="xr-ig-author__bio">${escapeHtml(a.biography)}</div>` : ''}
            </div>
        </div>` : '';

    const chips = [];
    const eng = article.engagement || {};
    if (Number.isFinite(eng.likes)    && eng.likes    > 0) chips.push(`<span class="xr-video__chip">${escapeHtml(eng.likes.toLocaleString())} likes</span>`);
    if (Number.isFinite(eng.comments) && eng.comments > 0) chips.push(`<span class="xr-video__chip">${escapeHtml(eng.comments.toLocaleString())} comments</span>`);
    if (Number.isFinite(eng.views)    && eng.views    > 0) chips.push(`<span class="xr-video__chip">${escapeHtml(eng.views.toLocaleString())} views</span>`);
    if (ig.postKind) chips.push(`<span class="xr-video__chip">${escapeHtml(ig.postKind)}</span>`);
    if (ig.extractedFrom) chips.push(`<span class="xr-video__chip" title="Extraction source for media">${escapeHtml(ig.extractedFrom)}</span>`);
    if (a.source) chips.push(`<span class="xr-video__chip" title="Extraction source for author profile">author: ${escapeHtml(a.source)}</span>`);

    const thumb = article.featuredImage;
    const watchUrl = article.url;
    const thumbHtml = thumb
        ? `
          <a class="xr-video__thumb" href="${escapeHtml(watchUrl)}" target="_blank" rel="noopener"
             title="Open on Instagram">
            <img src="${escapeHtml(thumb)}" alt="" loading="lazy" />
          </a>
        `
        : '';

    const evidenceImg = article.evidence && article.evidence.screenshot
        ? `<details class="xr-video__evidence">
             <summary>📸 Screenshot evidence</summary>
             <img src="${escapeHtml(article.evidence.screenshot)}" alt="Captured screenshot" />
           </details>`
        : '';

    return `
      <div class="xr-video">
        ${profileBlock}
        ${thumbHtml}
        <div class="xr-video__chips">${chips.join('')}</div>
        ${evidenceImg}
      </div>
    `;
}

// ------------------------------------------------------------------
// Facebook-specific header (Phase 8d)
// ------------------------------------------------------------------

function isFacebookArticle(article) {
    return article && article.platform === 'facebook' && article.facebook;
}

/**
 * Post-shaped header for Facebook captures. Similar chip vocabulary
 * to Instagram — author, engagement, post-kind, extraction provenance.
 * Reuses the existing `.xr-video` / `.xr-ig-author` CSS so we don't
 * have to grow a parallel set of classes for every hard-tier platform.
 */
function renderFacebookHeader(article) {
    if (!isFacebookArticle(article)) return '';
    const fb = article.facebook;
    const a  = fb.author || {};

    const profileBlock = (a.handle || a.nickname) ? `
        <div class="xr-ig-author">
            <div class="xr-ig-author__meta">
                <div class="xr-ig-author__name-row">
                    ${a.handle
                        ? `<a href="${escapeHtml(a.profileUrl)}" target="_blank" rel="noopener" class="xr-ig-author__handle">@${escapeHtml(a.handle)}</a>`
                        : ''}
                    ${a.verified ? `<span class="xr-ig-author__verified" title="Verified by Facebook">✓</span>` : ''}
                    ${a.nickname && a.nickname !== a.handle
                        ? `<span class="xr-ig-author__nickname">${escapeHtml(a.nickname)}</span>`
                        : ''}
                </div>
            </div>
        </div>` : '';

    const chips = [];
    const eng = article.engagement || {};
    if (Number.isFinite(eng.likes)    && eng.likes    > 0) chips.push(`<span class="xr-video__chip">${escapeHtml(eng.likes.toLocaleString())} reactions</span>`);
    if (Number.isFinite(eng.comments) && eng.comments > 0) chips.push(`<span class="xr-video__chip">${escapeHtml(eng.comments.toLocaleString())} comments</span>`);
    if (Number.isFinite(eng.shares)   && eng.shares   > 0) chips.push(`<span class="xr-video__chip">${escapeHtml(eng.shares.toLocaleString())} shares</span>`);
    if (fb.postKind)       chips.push(`<span class="xr-video__chip">${escapeHtml(fb.postKind)}</span>`);
    if (fb.extractedFrom)  chips.push(`<span class="xr-video__chip" title="Extraction source for post data">${escapeHtml(fb.extractedFrom)}</span>`);
    if (a.source)          chips.push(`<span class="xr-video__chip" title="Extraction source for author profile">author: ${escapeHtml(a.source)}</span>`);

    const thumb = article.featuredImage;
    const watchUrl = article.url;
    const thumbHtml = thumb
        ? `
          <a class="xr-video__thumb" href="${escapeHtml(watchUrl)}" target="_blank" rel="noopener"
             title="Open on Facebook">
            <img src="${escapeHtml(thumb)}" alt="" loading="lazy" />
          </a>
        `
        : '';

    const evidenceImg = article.evidence && article.evidence.screenshot
        ? `<details class="xr-video__evidence">
             <summary>📸 Screenshot evidence</summary>
             <img src="${escapeHtml(article.evidence.screenshot)}" alt="Captured screenshot" />
           </details>`
        : '';

    return `
      <div class="xr-video">
        ${profileBlock}
        ${thumbHtml}
        <div class="xr-video__chips">${chips.join('')}</div>
        ${evidenceImg}
      </div>
    `;
}

function formatDurationForChip(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    return `${m}:${String(ss).padStart(2, '0')}`;
}

function field(label, key, value) {
    return `
      <div class="xr-article__field">
        <span class="xr-article__field-label">${escapeHtml(label)}</span>
        <span class="xr-article__field-value" contenteditable="true" spellcheck="false" data-field="${key}">${escapeHtml(value || '')}</span>
      </div>`;
}

// ------------------------------------------------------------------
// Capture-quality hints for hard-tier platforms (Phase 8)
// ------------------------------------------------------------------

/**
 * Surface a platform-specific tip banner when the capture looks thin —
 * missing author, empty body, no media on a photo post. The goal is
 * to tell users who never read the capture guide what went wrong and
 * how to retry. For users who did read the guide, the banner is a
 * quick visual reminder rather than an annoyance (it only appears on
 * poor captures).
 *
 * Platform-specific cues:
 *   - Instagram: `extractedFrom === 'none'` OR missing author handle
 *   - Facebook:  `extractedFrom === 'none'` OR empty post body
 *   - TikTok:    `sourceShape == null` (SSR parse failed)
 *
 * Returns an HTML string (empty when the capture looks healthy).
 */
function renderCaptureQualityHint(article) {
    const hints = buildCaptureHints(article);
    if (hints.length === 0) return '';
    const items = hints.map((h) => `<li>${escapeHtml(h)}</li>`).join('');
    const docsUrl = 'https://github.com/bryanmatthewsimonson/xray/blob/main/docs/CAPTURE_GUIDE.md';
    return `
      <details class="xr-capture-hint" open>
        <summary>⚠︎ This capture looks thin — how to get a better one</summary>
        <ul>${items}</ul>
        <p class="xr-capture-hint__footer">
          Full walkthrough: <a href="${docsUrl}" target="_blank" rel="noopener">docs/CAPTURE_GUIDE.md</a>
        </p>
      </details>
    `;
}

function buildCaptureHints(a) {
    if (!a) return [];
    const hints = [];

    if (isInstagramArticle(a)) {
        const ig = a.instagram || {};
        if (ig.extractedFrom === 'none') {
            hints.push('The post data didn\'t extract. Open the specific post URL (/p/<shortcode>/ or /reel/<shortcode>/), wait a beat for it to load, then capture.');
        }
        if (!ig.author || !ig.author.handle) {
            hints.push('The author handle is missing. Make sure you\'re on a post detail URL, not a profile grid.');
        }
        if (ig.postKind !== 'reel' && (!ig.images || ig.images.length === 0)) {
            hints.push('No images captured. For carousels, swipe through all slides before capturing.');
        }
        if (ig.extractedFrom === 'og-meta' && ig.postKind !== 'reel') {
            hints.push('Only meta-tag data was captured — carousel slides may be incomplete. Swipe through the post and retry.');
        }
    } else if (isFacebookArticle(a)) {
        const fb = a.facebook || {};
        if (fb.extractedFrom === 'none') {
            hints.push('The post body didn\'t extract. Scroll through the post so its text renders, wait for /api/graphql/ responses to fire, then retry.');
        }
        if (!a.markdown || a.markdown.length < 200) {
            hints.push('The post body looks short or empty. Scroll the post into view before capturing — Facebook lazy-loads text.');
        }
        if (fb.mediaSource === 'none' && fb.postKind === 'photo') {
            hints.push('No images captured on a photo post. Scroll the gallery into view (FB only loads image <src> after they enter the viewport), then retry.');
        }
        if (!fb.author || !fb.author.handle) {
            hints.push('The author handle is missing. Open the post as a detail modal or via a permalink URL so the handle is in the path.');
        }
    } else if (isTikTokArticle(a)) {
        const t = a.tiktok || {};
        if (!t.sourceShape) {
            hints.push('The SSR JSON parse failed — TikTok\'s page shape may have changed. Try reloading the page, then capture.');
        }
        if (!t.videoId) {
            hints.push('No video ID found. Make sure the URL is `tiktok.com/@<user>/video/<id>` — short links (`vm.tiktok.com/...`) need to redirect first.');
        }
    }

    return hints;
}

function onReaderFieldInput(ev) {
    state.dirtySource = 'reader';
    // Body edits change what publish will hash and stamp as the x
    // tag — the load-time hash no longer labels the visible text.
    // Honest display beats live recomputation against a half-synced
    // draft: flag dirty, recompute at publish (13.4).
    if (ev && ev.target && ev.target.dataset.field === 'content' && !state.hashDirty) {
        state.hashDirty = true;
        updateHashLine();
    }
}

function onReaderFieldBlur(ev) {
    const key = ev.target.dataset.field;
    const val = ev.target.textContent.trim();
    switch (key) {
        case 'title':       state.article.title       = val; break;
        case 'byline':      state.article.byline      = val; break;
        case 'siteName':    state.article.siteName    = val; break;
        case 'url':         state.article.url         = val; break;
        case 'publishedAt': {
            const secs = parseDate(val);
            if (secs) state.article.publishedAt = secs;
            else {
                // Reset UI to the last-valid value
                ev.target.textContent = fmtDate(state.article.publishedAt);
                toast('Could not parse date — reverted', 'warning');
            }
            break;
        }
        case 'content': state.htmlDraft = $('.xr-article__body').innerHTML; break;
    }
}

// ------------------------------------------------------------------
// Render — MARKDOWN mode
// ------------------------------------------------------------------

function renderMarkdown() {
    // If the reader view is where we last edited, refresh the markdown
    // draft from the current HTML before handing off to the textarea.
    if (state.dirtySource === 'reader') {
        state.markdownDraft = ContentExtractor.htmlToMarkdown(state.htmlDraft);
    }
    const main = $('#xr-main');
    main.innerHTML = `
      <div class="xr-markdown-area">
        <textarea class="xr-markdown-area__textarea" id="xr-md" spellcheck="true">${escapeHtml(state.markdownDraft)}</textarea>
        <p class="xr-markdown-area__hint">
          This is the source that gets published to NOSTR as the kind-30023 event body.
          Switch to <strong>Preview</strong> to see how it will render.
        </p>
      </div>
    `;
    const ta = $('#xr-md');
    ta.addEventListener('input', () => {
        state.markdownDraft = ta.value;
        state.dirtySource = 'markdown';
    });
    ta.focus();
}

// ------------------------------------------------------------------
// Render — PREVIEW mode (HTML → MD → HTML roundtrip)
// ------------------------------------------------------------------

function renderPreview() {
    // Make sure markdownDraft is current.
    if (state.dirtySource === 'reader') {
        state.markdownDraft = ContentExtractor.htmlToMarkdown(state.htmlDraft);
    }
    const roundtripHtml = ContentExtractor.markdownToHtml(state.markdownDraft);
    const a = state.article;
    const main = $('#xr-main');
    main.innerHTML = `
      <article class="xr-article xr-preview">
        <div class="xr-preview__banner">
          <strong>Preview.</strong> This is the HTML → Markdown → HTML round-trip — exactly
          what NOSTR clients will render from your kind-30023 event body.
        </div>
        <header class="xr-article__meta">
          <h1 class="xr-article__title">${escapeHtml(a.title || 'Untitled')}</h1>
          <div class="xr-article__byline-row">
            ${previewField('Author',      a.byline)}
            ${previewField('Publication', a.siteName)}
            ${previewField('Published',   fmtDate(a.publishedAt))}
            ${previewField('URL',         a.url)}
          </div>
        </header>
        <div class="xr-article__body">${roundtripHtml}</div>
      </article>
    `;
}

function previewField(label, value) {
    if (!value) return '';
    return `
      <div class="xr-article__field">
        <span class="xr-article__field-label">${escapeHtml(label)}</span>
        <span>${escapeHtml(value)}</span>
      </div>`;
}

// ------------------------------------------------------------------
// View mode controller
// ------------------------------------------------------------------

function setViewMode(mode) {
    if (mode === state.viewMode) return;
    state.viewMode = mode;

    document.querySelectorAll('.xr-reader__mode-btn').forEach((btn) => {
        const active = btn.dataset.mode === mode;
        btn.classList.toggle('xr-reader__mode-btn--active', active);
        btn.setAttribute('aria-selected', String(active));
    });

    switch (mode) {
        case 'reader':   renderReader();   break;
        case 'markdown': renderMarkdown(); break;
        case 'preview':  renderPreview();  break;
    }
}

// ------------------------------------------------------------------
// Comments (Substack — Phase 3a)
// ------------------------------------------------------------------

/**
 * Two-stage API load for Substack:
 *   1) /api/v1/posts/<slug>  — rich metadata + full body (paywall unlock
 *                               when the user has a Substack session)
 *   2) /api/v1/post/<id>/comments  — comment tree
 *
 * Runs non-blocking after the reader is already rendered from Readability.
 * Each stage is independent: if stage 1 fails we still have Readability's
 * content; if stage 2 fails we still have stage 1's metadata.
 */
async function loadSubstackData() {
    const sub = state.article.substack;
    if (!sub || !sub.slug || !sub.apiOrigin) return;

    state.comments.platform = 'substack';
    state.comments.status = 'loading';
    renderCommentsSection();

    // Stage 1: post metadata.
    let post = null;
    try {
        const resp = await browserApi.runtime.sendMessage({
            type: 'xray:substack:fetchPost',
            apiOrigin: sub.apiOrigin,
            slug:      sub.slug
        });
        if (resp && resp.ok && resp.post) {
            post = resp.post;
            mergeSubstackPost(post);
        } else {
            console.warn('[X-Ray Reader] Substack post fetch failed:', resp && resp.error);
        }
    } catch (err) {
        console.warn('[X-Ray Reader] Substack post fetch threw:', err);
    }

    // Stage 2: comments (only if stage 1 gave us a postId).
    const postId = state.article.substack.postId;
    if (!postId) {
        state.comments.status = 'error';
        state.comments.error = 'No post id — Substack post API fetch failed. Confirm you have a Substack session and try again.';
        renderCommentsSection();
        return;
    }

    try {
        const resp = await browserApi.runtime.sendMessage({
            type: 'xray:substack:fetchComments',
            apiOrigin: sub.apiOrigin,
            postId
        });
        if (!resp || !resp.ok) {
            throw new Error((resp && resp.error) || 'No response from service worker');
        }
        state.comments.tree = resp.comments || [];
        state.comments.total = resp.total || 0;
        state.comments.status = 'ready';
    } catch (err) {
        console.warn('[X-Ray Reader] Substack comments fetch failed:', err);
        state.comments.status = 'error';
        state.comments.error = err.message || String(err);
    }
    renderCommentsSection();
}

/**
 * Populate the comments section for a YouTube capture. Unlike Substack
 * (which the reader fetches from the API here), YouTube comments were
 * captured passively in the content script and ride along in
 * `article.youtube.comments`. We just move them into `state.comments`.
 *
 * When `captured` is false the interceptor saw no `/youtubei/v1/next`
 * responses — almost always because the user didn't scroll to the
 * comments before capturing — so we surface an instructional hint.
 */
function loadYouTubeComments() {
    state.comments.platform = 'youtube';
    const cm = state.article && state.article.youtube && state.article.youtube.comments;

    if (!cm || cm.captured === false) {
        state.comments.status = 'error';
        state.comments.error = 'No comments loaded. On YouTube, scroll down so the comments render, then re-open X-Ray — comments load lazily as you scroll.';
        renderCommentsSection();
        return;
    }
    if (!cm.total) {
        state.comments.status = 'error';
        state.comments.error = 'No comments found. The video may have comments disabled, or none had loaded when you captured (scroll the comments into view first).';
        renderCommentsSection();
        return;
    }
    state.comments.tree = cm.tree || [];
    state.comments.total = cm.total || 0;
    state.comments.status = 'ready';
    renderCommentsSection();
}

/**
 * Merge Substack post-API fields onto the live article and re-render.
 * Readability produced an initial extraction; the API response is
 * authoritative for everything except user-edited fields. We treat
 * fields already touched by the user (dirtySource === 'reader' or
 * 'markdown') as preserved — the merge only fills gaps.
 */
function mergeSubstackPost(post) {
    const a = state.article;

    // Always-on routing-ish fields.
    a.substack.postId        = post.id;
    a.substack.publicationId = post.publicationId;
    a.substack.sectionId     = post.sectionId;
    a.substack.audience      = post.audience;
    a.substack.type          = post.type;
    a.substack.wordcount     = post.wordcount;
    a.substack.subtitle      = post.subtitle;
    a.substack.postTags      = post.postTags;
    a.substack.podcast       = post.podcast;
    a.substack.hasVoiceover  = post.hasVoiceover;
    a.substack.audioItems    = post.audioItems;
    a.substack.allBylines    = post.allBylines;
    a.substack._raw          = post._raw;

    // Fields where the API is authoritative. Only override if the user
    // hasn't touched that view yet AND the API's value is non-empty.
    const userEditedReader   = state.dirtySource !== 'reader'   ? false : isReaderDirty();
    const userEditedMarkdown = state.dirtySource !== 'markdown' ? false : true;

    if (!userEditedReader && !userEditedMarkdown) {
        if (post.title)        a.title       = post.title;
        if (post.byline?.name) a.byline      = post.byline.name;
        if (post.coverImage)   a.featuredImage = post.coverImage;
        if (post.postDate)     a.publishedAt = Math.floor(Date.parse(post.postDate) / 1000);

        // Body replacement only if the API body is non-empty AND longer
        // than what Readability got (the "paywall unlock" case).
        if (post.bodyHtml && (!a.content || post.bodyHtml.length > a.content.length * 1.05)) {
            a.content = post.bodyHtml;
            state.htmlDraft = post.bodyHtml;
            state.markdownDraft = ContentExtractor.htmlToMarkdown(post.bodyHtml);
        }
    }

    // Authoritative engagement + publication regardless of edit state.
    a.engagement = {
        likes:    post.reactionCount,
        restacks: post.restacks,
        comments: post.commentCount
    };
    a.siteName = resolveSiteName(post, a.siteName);

    // Re-render whatever view the user is in, so the new data shows up.
    switch (state.viewMode) {
        case 'reader':   renderReader();   break;
        case 'markdown': renderMarkdown(); break;
        case 'preview':  renderPreview();  break;
    }
}

function isReaderDirty() {
    // We haven't tracked fine-grained edit state yet — treat the reader
    // as "not edited" unless the user made markdown-mode changes. A
    // better signal (onInput diffing) comes in a future commit.
    return false;
}

function resolveSiteName(post, currentSiteName) {
    // Prefer Readability's siteName if it's a real publication name (not
    // just the domain). Otherwise fall back to the first byline's
    // handle-based publication (e.g. "The Free Press" if configured on
    // the Substack publication record).
    if (currentSiteName && !currentSiteName.match(/\.(com|org|net|blog|io)$/i)) {
        return currentSiteName;
    }
    // Substack's post API doesn't give us the publication name directly
    // here; the raw payload has it nested via sectionPins or postTheme
    // but those paths are fragile. Keep current or let the caller
    // supply og:site_name from elsewhere.
    return currentSiteName;
}

function renderCommentsSection() {
    const sec = $('#xr-comments');
    const body = $('#xr-comments-body');
    const title = $('#xr-comments-title');
    const includeChk = $('#xr-comments-include');
    const includeLabel = $('#xr-comments-include-label');

    if (!state.comments.platform) {
        sec.hidden = true;
        return;
    }
    sec.hidden = false;

    if (state.comments.status === 'loading') {
        title.textContent = 'Comments';
        body.innerHTML = `<div class="xr-comments__status">Loading comments…</div>`;
        includeChk.disabled = true;
        includeLabel.textContent = 'Include in publish';
        return;
    }
    if (state.comments.status === 'error') {
        title.textContent = 'Comments';
        body.innerHTML = `<div class="xr-comments__status xr-comments__status--error">Comment fetch failed: ${escapeHtml(state.comments.error)}</div>`;
        includeChk.disabled = true;
        return;
    }
    if (state.comments.tree.length === 0) {
        title.textContent = 'Comments (0)';
        body.innerHTML = `<div class="xr-comments__status">No comments on this post.</div>`;
        includeChk.disabled = true;
        return;
    }

    title.textContent = `Comments (${state.comments.total})`;
    body.innerHTML = renderCommentList(state.comments.tree);

    includeChk.disabled = false;
    includeChk.checked = state.comments.includeInPublish;
    includeLabel.textContent = `Include all ${state.comments.total} in publish (requires ${state.comments.total + 1} signatures)`;
}

function renderCommentList(list) {
    if (!list || list.length === 0) return '';
    return `<ol>${list.map(renderCommentItem).join('')}</ol>`;
}

function renderCommentItem(c) {
    const deletedCls = c.deleted ? ' xr-comment--deleted' : '';
    const handle = c.author.handle ? '@' + c.author.handle : '';
    const profileUrl = c.author.profileUrl || '#';
    const headerHtml = c.author.handle
        ? `<a class="xr-comment__handle" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener">${escapeHtml(handle)}</a>`
        : `<span class="xr-comment__handle">${escapeHtml(c.author.name || 'Unknown')}</span>`;

    const nameHtml = c.author.name && c.author.name !== c.author.handle
        ? `<span class="xr-comment__name">${escapeHtml(c.author.name)}</span>`
        : '';

    const dateHtml = c.date
        ? `<time class="xr-comment__date" datetime="${escapeHtml(c.date)}">${escapeHtml(fmtCommentDate(c.date))}</time>`
        : '';

    const avatarHtml = c.author.avatarUrl
        ? `<img class="xr-comment__avatar" src="${escapeHtml(c.author.avatarUrl)}" alt="" loading="lazy">`
        : `<span class="xr-comment__avatar"></span>`;

    const body = c.deleted
        ? `<em>(comment deleted or flagged)</em>`
        : escapeHtml(c.body || '').replace(/\n/g, '<br>');

    const meta = [];
    if (c.reactionCount > 0) meta.push(`❤ ${c.reactionCount}`);
    if (c.restacks > 0)      meta.push(`⟲ ${c.restacks} restack${c.restacks === 1 ? '' : 's'}`);
    const metaHtml = meta.length ? `<footer class="xr-comment__meta">${meta.map(escapeHtml).join(' · ')}</footer>` : '';

    const childrenHtml = c.children && c.children.length ? renderCommentList(c.children) : '';

    return `
      <li class="xr-comment${deletedCls}" data-comment-id="${escapeHtml(String(c.id))}">
        <header class="xr-comment__header">
          ${avatarHtml}
          ${headerHtml}
          ${nameHtml}
          ${dateHtml}
        </header>
        <div class="xr-comment__body">${body}</div>
        ${metaHtml}
        ${childrenHtml}
      </li>`;
}

function fmtCommentDate(iso) {
    try {
        const d = new Date(iso);
        return d.toLocaleString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit'
        });
    } catch { return iso; }
}

// ------------------------------------------------------------------
// Publish — C3 full flow
// ------------------------------------------------------------------

// Inter-event delay when publishing a batch. Some relays rate-limit
// bursty writes (nostr.oxtr.dev in particular); a small pause keeps
// them happy without meaningfully slowing the batch.
const BATCH_PUBLISH_DELAY_MS = 200;

async function publish() {
    const btn = $('#xr-publish');
    const originalLabel = btn.textContent;
    btn.disabled = true;

    const includeComments = state.comments.includeInPublish && state.comments.tree.length > 0;
    const commentList = includeComments ? flattenCommentTree(state.comments.tree) : [];

    // All claims on this article (both fresh + already-published) —
    // needed for the evidence-link resolver, which filters to links
    // where *both* endpoints belong to this article's claim set.
    const allArticleClaims = await ClaimModel.getBySourceUrl(state.article.url);

    // Claims that actually need a kind-30040 emission this publish:
    // fresh/edited claims, PLUS (Phase 11.7) any claim on this article
    // published before publishedPubkey was recorded that now has a
    // pending judgment — re-emitting backfills its coordinate so the
    // judgment can publish, instead of being silently stuck.
    const judgmentsOn = await (async () => { await loadFlags(); return isEnabled('assessmentPublishing'); })();
    let needCoordIds = new Set();
    if (judgmentsOn) {
        const pubkeyless = allArticleClaims.filter((c) => c.publishedAt && !c.publishedPubkey);
        if (pubkeyless.length > 0) {
            const [assessments, links, canon] = await Promise.all([
                AssessmentModel.getAll(), EvidenceLinker.getAll(), makeClaimRefCanonicalizer()
            ]);
            const judged = new Set();
            for (const a of Object.values(assessments)) {
                const r = a.claim_ref && (a.claim_ref.claim_id || a.claim_ref.coord);
                if (r) judged.add(canon(r));
            }
            for (const l of Object.values(links)) {
                judged.add(canon(l.source_claim_id)); judged.add(canon(l.target_claim_id));
            }
            needCoordIds = new Set(pubkeyless.filter((c) => judged.has(c.id)).map((c) => c.id));
        }
    }
    const claimsToPublish = allArticleClaims.filter((c) =>
        !c.publishedAt || c.updated > c.publishedAt || needCoordIds.has(c.id));

    // Union tagged-entity ids with every claim's claimant / subject /
    // object ids so their kind-0 events publish ahead of any claim's
    // p-tags. Note we collect from ALL article claims — even
    // already-published ones may have been edited to reference a new
    // entity that still needs to publish.
    const taggedEntityIds = (state.article.entities || []).map((e) => e.entity_id).filter(Boolean);
    const claimEntityIds  = [...collectClaimEntityIds(allArticleClaims)];
    const allEntityIds    = [...new Set([...taggedEntityIds, ...claimEntityIds])];
    const entitiesToPublish = await resolveEntitiesToPublish(allEntityIds);

    // kind-32125 entity-relationship events — derived from
    // claimsToPublish only (we don't re-emit relationships for already
    // published + unchanged claims).
    const relationshipsToPublish = await resolveRelationshipsToPublish(claimsToPublish, state.article.url);

    // `let`: the judgment batch (Phase 11.7, flag-gated) extends the
    // total after claims publish — own-claim coordinates only resolve
    // once their publishing pubkey is recorded.
    let totalEvents = 1 + commentList.length + entitiesToPublish.length
                        + claimsToPublish.length + relationshipsToPublish.length;

    // Per-relay rollup across the entire batch.
    const relayStats = new Map(); // url → { ok, fail, lastError }
    const recordRelayResults = (results) => {
        if (!results || !Array.isArray(results.results)) return;
        for (const r of results.results) {
            const stat = relayStats.get(r.url) || { ok: 0, fail: 0, lastError: null };
            if (r.success) stat.ok++;
            else          { stat.fail++; if (r.error) stat.lastError = r.error; }
            relayStats.set(r.url, stat);
        }
    };

    const setProgress = (current, total) => {
        const bar = $('#xr-progress-bar');
        const wrap = $('#xr-progress');
        if (!bar || !wrap) return;
        wrap.hidden = total <= 1;
        bar.style.width = total > 0 ? `${Math.min(100, (current / total) * 100)}%` : '0%';
    };

    try {
        if (state.dirtySource === 'reader') {
            state.markdownDraft = ContentExtractor.htmlToMarkdown(state.htmlDraft);
        }

        btn.textContent = 'Signing…';
        toast(totalEvents > 1
            ? buildPublishStartMessage(commentList.length, entitiesToPublish.length, claimsToPublish.length, relationshipsToPublish.length)
            : 'Approving signature in your NOSTR extension…', 'warning', 5000);

        setProgress(0, totalEvents);

        // Resolve the signing pubkey once.
        const pubResp = await browserApi.runtime.sendMessage({
            type: 'xray:capture:getPubkey',
            id: state.id
        });
        if (!pubResp || !pubResp.ok) {
            throw new Error((pubResp && pubResp.error) || 'Could not fetch signing public key');
        }
        const userPubkey = pubResp.pubkey;

        // Article event.
        const article = { ...state.article, content: state.markdownDraft, markdown: state.markdownDraft };
        const entityRefs = Array.isArray(state.article.entities) ? state.article.entities : [];

        // Phase 9 identity: materialize the post author as a
        // PlatformAccount (where the platform exposes a stable id) and
        // reference its pubkey on the article. Best-effort — null author
        // or no stable id just means no author p-tag, as before.
        let authorAccountPubkey = null;
        try {
            const postAuthor = extractPostAuthor(article);
            if (postAuthor) {
                const acct = await recordAccount(postAuthor.platform, postAuthor.raw, { seenOnUrl: article.url });
                if (acct) authorAccountPubkey = acct.accountPubkey;
            }
        } catch (_) { /* identity is enrichment, never a publish gate */ }

        const unsignedArticle = await EventBuilder.buildArticleEvent(article, entityRefs, userPubkey, [], authorAccountPubkey);

        // 13.4: the event just built carries the canonical hash of the
        // FINAL (possibly edited) body as its x tag. Stamp it on the
        // article so the post-publish archive save records the hash of
        // what was actually published — a carried stale _articleHash
        // (relay-loaded archives) would otherwise mislabel the row —
        // and refresh the hash line, which may have been edit-dirty.
        const publishedXTag = unsignedArticle.tags.find((t) => t[0] === 'x');
        if (publishedXTag && publishedXTag[1]) {
            article._articleHash = publishedXTag[1];
            state.articleHash = publishedXTag[1];
            state.hashDirty = false;
            updateHashLine();
        }

        btn.textContent = totalEvents > 1 ? `Publishing (1/${totalEvents})…` : 'Publishing…';
        const articleResp = await browserApi.runtime.sendMessage({
            type: 'xray:capture:publish',
            id: state.id,
            event: unsignedArticle
        });
        if (!articleResp || !articleResp.ok) {
            throw new Error((articleResp && articleResp.error) || 'No response from background worker');
        }
        recordRelayResults(articleResp.results);
        const articleResults = articleResp.results;
        setProgress(1, totalEvents);

        // Cache the article to IndexedDB for Phase 7's archive reader.
        // Fire-and-forget — a cache write shouldn't block publish. We
        // only persist after at least one relay accepted the event so
        // the `publishedToRelay` flag is honest.
        if (articleResults.successful > 0) {
            const publishedEventId = articleResp.signedEvent && articleResp.signedEvent.id;
            ArchiveCache.saveArticle({
                article,
                source:           'capture',
                publishedToRelay: true,
                publishedEventId: publishedEventId || null
            }).catch((err) => console.warn('[X-Ray Reader] archive cache save failed:', err));
        }

        // Comment events — only if the user opted in.
        const commentResults = { ok: 0, fail: 0, skipped: 0, errors: [] };
        if (includeComments) {
            const articleUrl = article.url;
            const articleTitle = article.title || 'Untitled';

            // Map comment id → its `d`-tag so replies can reference
            // parents that were just published in this run.
            const idToDTag = new Map();

            for (let i = 0; i < commentList.length; i++) {
                const c = commentList[i];

                if (c.deleted || !c.body) { commentResults.skipped++; continue; }

                const dTag = makeCommentDTag(state.comments.platform, c.id);
                idToDTag.set(c.id, dTag);

                const replyTo = c.parentId != null ? idToDTag.get(c.parentId) : null;

                // Phase 9 identity: materialize the commenter as a
                // PlatformAccount and reference its deterministic pubkey
                // in the comment's `p` tag, so the same commenter is
                // dedup-able across captures and (Phase IV) linkable to a
                // canonical person. Best-effort — recordAccount never
                // throws, and returns null for authors with no stable id
                // (in which case the comment keeps its plain author
                // string, exactly as before).
                let commenterPubkey = null;
                const commenterAccount = await recordAccount(
                    state.comments.platform, c.author, { seenOnUrl: articleUrl }
                );
                if (commenterAccount) commenterPubkey = commenterAccount.accountPubkey;

                const unsignedComment = EventBuilder.buildCommentEvent({
                    id:            dTag,
                    text:          c.body,
                    authorName:    c.author.name,
                    authorHandle:  c.author.handle,
                    authorUrl:     c.author.profileUrl,
                    platform:      state.comments.platform,
                    timestamp:     c.date ? Date.parse(c.date) : null, // ms
                    replyTo,
                    reactionCount: c.reactionCount,
                    restacks:      c.restacks
                }, articleUrl, articleTitle, userPubkey, commenterPubkey);

                btn.textContent = `Publishing (${i + 2}/${totalEvents})…`;

                try {
                    const resp = await browserApi.runtime.sendMessage({
                        type: 'xray:capture:publish',
                        id: state.id,
                        event: unsignedComment
                    });
                    if (resp && resp.ok && resp.results) {
                        recordRelayResults(resp.results);
                        if (resp.results.successful > 0) {
                            commentResults.ok++;
                        } else {
                            commentResults.fail++;
                        }
                    } else {
                        commentResults.fail++;
                        commentResults.errors.push((resp && resp.error) || 'unknown');
                    }
                } catch (err) {
                    commentResults.fail++;
                    commentResults.errors.push(err.message || String(err));
                }

                setProgress(i + 2, totalEvents);

                // Pause briefly between events — keeps bursty-unfriendly
                // relays like nostr.oxtr.dev from rate-limiting our writes.
                if (i < commentList.length - 1) {
                    await sleep(BATCH_PUBLISH_DELAY_MS);
                }
            }
        }

        // Entity kind-0 events — one per never-before-published tagged
        // entity. Signed *locally* with the entity's own keypair (not
        // the user's NIP-07 signer), so each entity publishes as its
        // own NOSTR identity. Aliases include a `refers_to` tag
        // pointing at the canonical entity's npub.
        const entityBatchBase = 1 + commentList.length;  // article + comments already done
        const relays = await getConfiguredRelays();
        const entityResults = { ok: 0, fail: 0, errors: [] };
        if (entitiesToPublish.length > 0) {
            for (let i = 0; i < entitiesToPublish.length; i++) {
                const entity = entitiesToPublish[i];
                btn.textContent = `Publishing (${entityBatchBase + i + 1}/${totalEvents})…`;

                try {
                    // Look up canonical entity if this is an alias — its
                    // npub goes into the `refers_to` tag on our kind-0.
                    let canonicalNpub = null;
                    if (entity.canonical_id) {
                        const canonical = await EntityModel.get(entity.canonical_id);
                        if (canonical && canonical.keypair) canonicalNpub = canonical.keypair.npub;
                    }

                    const unsignedProfile = EventBuilder.buildProfileEvent(entity, canonicalNpub);
                    const signed = await LocalKeyManager.signEvent(unsignedProfile, entity.keyName);

                    const resp = await browserApi.runtime.sendMessage({
                        type:   'xray:relay:publish',
                        event:  signed,
                        relays
                    });

                    if (resp && resp.ok && resp.results) {
                        recordRelayResults(resp.results);
                        if (resp.results.successful > 0) {
                            entityResults.ok++;
                            // Only mark as published if at least one relay
                            // accepted it — otherwise it'll retry next publish.
                            try { await EntityModel.markPublished(entity.id, signed.id); }
                            catch (_) { /* best-effort */ }
                        } else {
                            entityResults.fail++;
                            entityResults.errors.push(`${entity.name}: no relays accepted`);
                        }
                    } else {
                        entityResults.fail++;
                        entityResults.errors.push(`${entity.name}: ${(resp && resp.error) || 'unknown'}`);
                    }
                } catch (err) {
                    entityResults.fail++;
                    entityResults.errors.push(`${entity.name}: ${err.message || String(err)}`);
                    console.warn('[X-Ray Reader] entity publish failed:', entity.name, err);
                }

                setProgress(entityBatchBase + i + 1, totalEvents);

                if (i < entitiesToPublish.length - 1) {
                    await sleep(BATCH_PUBLISH_DELAY_MS);
                }
            }
        }

        // ---- Claim events (kind-30040) ---------------------------------
        // Signed by the user's NIP-07 signer (claims are the USER's
        // structured assertions about entities, not the entities' own
        // statements). `buildClaimEvent` needs the entity registry to
        // resolve claimant/subject/object IDs into p-tags + name tags.
        const claimBatchBase = entityBatchBase + entitiesToPublish.length;
        const claimResults = { ok: 0, fail: 0, errors: [] };
        const entitiesDict = claimsToPublish.length > 0 ? await EntityModel.getAll() : {};
        for (let i = 0; i < claimsToPublish.length; i++) {
            const claim = claimsToPublish[i];
            btn.textContent = `Publishing (${claimBatchBase + i + 1}/${totalEvents})…`;
            try {
                const unsigned = EventBuilder.buildClaimEvent(
                    claim, article.url, article.title || 'Untitled', userPubkey, entitiesDict
                );
                const resp = await browserApi.runtime.sendMessage({
                    type:  'xray:capture:publish',
                    id:    state.id,
                    event: unsigned
                });
                if (resp && resp.ok && resp.results) {
                    recordRelayResults(resp.results);
                    if (resp.results.successful > 0) {
                        claimResults.ok++;
                        // The signed event id is on the resp chain through
                        // the SW; not trivially available here, but the
                        // `d`-tag on the unsigned event doubles as the
                        // stable pointer. Re-fetch signed id from results
                        // array if relay echoed it.
                        const signedId = resp.signedEvent?.id || null;
                        // Record WHO signed too (Phase 11.1) — the claim's
                        // addressable coordinate needs the publishing pubkey.
                        try { await ClaimModel.markPublished(claim.id, signedId, userPubkey); }
                        catch (_) { /* best-effort */ }
                    } else {
                        claimResults.fail++;
                        claimResults.errors.push(`${claim.text.slice(0, 40)}…: no relays accepted`);
                    }
                } else {
                    claimResults.fail++;
                    claimResults.errors.push(`${claim.text.slice(0, 40)}…: ${(resp && resp.error) || 'unknown'}`);
                }
            } catch (err) {
                claimResults.fail++;
                claimResults.errors.push(`${claim.text.slice(0, 40)}…: ${err.message || String(err)}`);
                console.warn('[X-Ray Reader] claim publish failed:', claim.id, err);
            }
            setProgress(claimBatchBase + i + 1, totalEvents);
            if (i < claimsToPublish.length - 1) await sleep(BATCH_PUBLISH_DELAY_MS);
        }

        // ---- Entity-relationship events (kind-32125) -------------------
        // Addressable by `{entity_id}:{url}:{relationshipType}`. The
        // user signs these — they're assertions about the shape of a
        // knowledge graph node, not the entity's own statement.
        // Replaceable-event semantics mean re-publishing is safe;
        // filter to a single emission per d-tag coordinate per batch
        // already done in `resolveRelationshipsToPublish`.
        const relBatchBase = claimBatchBase + claimsToPublish.length;
        const relationshipResults = { ok: 0, fail: 0, errors: [] };
        for (let i = 0; i < relationshipsToPublish.length; i++) {
            const { entity, relType, claimId } = relationshipsToPublish[i];
            btn.textContent = `Publishing (${relBatchBase + i + 1}/${totalEvents})…`;
            try {
                const unsigned = EventBuilder.buildEntityRelationshipEvent(
                    entity, article.url, relType, userPubkey, claimId
                );
                const resp = await browserApi.runtime.sendMessage({
                    type:  'xray:capture:publish',
                    id:    state.id,
                    event: unsigned
                });
                if (resp && resp.ok && resp.results) {
                    recordRelayResults(resp.results);
                    if (resp.results.successful > 0) {
                        relationshipResults.ok++;
                    } else {
                        relationshipResults.fail++;
                        relationshipResults.errors.push(`${entity.name} ${relType}: no relays`);
                    }
                } else {
                    relationshipResults.fail++;
                    relationshipResults.errors.push(`${entity.name} ${relType}: ${(resp && resp.error) || 'unknown'}`);
                }
            } catch (err) {
                relationshipResults.fail++;
                relationshipResults.errors.push(`${entity.name} ${relType}: ${err.message || String(err)}`);
                console.warn('[X-Ray Reader] relationship publish failed:', entity.id, relType, err);
            }
            setProgress(relBatchBase + i + 1, totalEvents);
            if (i < relationshipsToPublish.length - 1) await sleep(BATCH_PUBLISH_DELAY_MS);
        }

        // ---- Judgments: assessments + mirrors + claim links ------------
        // (Phase 11.7 — behind the assessmentPublishing flag, default
        // off.) Runs AFTER the claims batch: claims published above
        // recorded their publishing pubkey, so own-claim coordinates
        // resolve; foreign refs carry theirs. The selection spans ALL
        // wire-ready judgments, not just this article's — judgments are
        // article-agnostic records and cross-article ones would
        // otherwise never publish.
        await loadFlags();
        const publishJudgments = isEnabled('assessmentPublishing');
        const assessResults = { ok: 0, fail: 0, errors: [] };
        const mirrorResults = { ok: 0, fail: 0, errors: [] };
        const jLinkResults  = { ok: 0, fail: 0, errors: [] };
        let assessSel = [], mirrorSel = [], linkSel = [];
        if (publishJudgments) {
            const [claimsAll, assessmentsAll, linksAll, canon] = await Promise.all([
                ClaimModel.getAll(), AssessmentModel.getAll(), EvidenceLinker.getAll(),
                makeClaimRefCanonicalizer()
            ]);
            assessSel = selectAssessmentsToPublish({ assessments: assessmentsAll, claims: claimsAll, canon });
            mirrorSel = selectMirrors({ assessments: assessmentsAll, claims: claimsAll, canon });
            linkSel   = selectLinksToPublish({ links: linksAll, claims: claimsAll, canon });
        }
        const judgmentBase = relBatchBase + relationshipsToPublish.length;
        let judgmentStep = 0;
        if (assessSel.length + mirrorSel.length + linkSel.length > 0) {
            totalEvents += assessSel.length + mirrorSel.length + linkSel.length;
            toast(`Also publishing your judgments: ${assessSel.length} assessment${assessSel.length === 1 ? '' : 's'}`
                  + (mirrorSel.length ? ` + ${mirrorSel.length} label mirror${mirrorSel.length === 1 ? '' : 's'}` : '')
                  + (linkSel.length ? ` + ${linkSel.length} claim link${linkSel.length === 1 ? '' : 's'}` : '')
                  + '…', 'warning', 4000);

            const sendJudgment = async (unsigned) => {
                unsigned.pubkey = userPubkey;
                return await browserApi.runtime.sendMessage({
                    type: 'xray:capture:publish', id: state.id, event: unsigned
                });
            };
            const entitiesAll = await EntityModel.getAll();

            // Assessments (kind 30054). Track which ones FAILED their
            // 30054 this batch — those must not emit a label mirror
            // (its target wouldn't be on relays).
            const failed30054 = new Set();
            let jIdx = 0;
            for (const sel of assessSel) {
                btn.textContent = `Publishing (${judgmentBase + (++judgmentStep)}/${totalEvents})…`;
                const label = (sel.assessment.claim_ref.text || '').slice(0, 40);
                let landed = false;
                try {
                    if (sel.needsCoordBackfill) {
                        try { await AssessmentModel.backfillCoord(sel.assessment.id, sel.coord); }
                        catch (_) { /* best-effort */ }
                    }
                    // about-entity p mirror: own claims resolve ids via
                    // the registry; foreign claims carry snapshotted pubkeys.
                    const aboutPubkeys = [...(sel.aboutPubkeys || [])];
                    for (const id of sel.aboutIds || []) {
                        const ent = entitiesAll[id];
                        if (ent && ent.keypair) aboutPubkeys.push(ent.keypair.pubkey);
                    }
                    const { event: unsigned } = await buildAssessmentEvent({
                        claimCoord:   sel.coord,
                        claimUrl:     sel.url,
                        claimEventId: sel.eventId,
                        stance:       sel.assessment.stance,
                        labels:       sel.assessment.labels,
                        rationale:    sel.assessment.rationale,
                        aboutPubkeys:  [...new Set(aboutPubkeys)],
                        suggestedBy:  sel.assessment.suggested_by || 'user'
                    });
                    const resp = await sendJudgment(unsigned);
                    if (resp && resp.ok && resp.results) {
                        recordRelayResults(resp.results);
                        if (resp.results.successful > 0) {
                            assessResults.ok++;
                            landed = true;
                            try { await AssessmentModel.markPublished(sel.assessment.id, resp.signedEvent?.id || null); }
                            catch (_) { /* best-effort */ }
                        } else {
                            assessResults.fail++;
                            assessResults.errors.push(`${label}…: no relays accepted`);
                        }
                    } else {
                        assessResults.fail++;
                        assessResults.errors.push(`${label}…: ${(resp && resp.error) || 'unknown'}`);
                    }
                } catch (err) {
                    assessResults.fail++;
                    assessResults.errors.push(`${label}…: ${err.message || String(err)}`);
                    console.warn('[X-Ray Reader] assessment publish failed:', sel.assessment.id, err);
                }
                if (!landed) failed30054.add(sel.assessment.id);
                setProgress(judgmentBase + judgmentStep, totalEvents);
                if (++jIdx < assessSel.length) await sleep(BATCH_PUBLISH_DELAY_MS);
            }

            // Label mirrors (kind 1985). Selected on `mirroredAt` (not
            // the assessment's publish state), so a previously-rejected
            // mirror retries here. Skip only a candidate whose 30054 was
            // attempted THIS batch and failed — otherwise its target is
            // (or was) on relays.
            let mIdx = 0;
            for (const sel of mirrorSel) {
                btn.textContent = `Publishing (${judgmentBase + (++judgmentStep)}/${totalEvents})…`;
                if (failed30054.has(sel.assessment.id)) {
                    setProgress(judgmentBase + judgmentStep, totalEvents);
                    if (++mIdx < mirrorSel.length) await sleep(BATCH_PUBLISH_DELAY_MS);
                    continue;
                }
                try {
                    const { event: unsigned } = buildAssessmentMirrorEvent({
                        claimCoord: sel.coord,
                        labels:     sel.assessment.labels,
                        claimUrl:   sel.url
                    });
                    const resp = await sendJudgment(unsigned);
                    if (resp && resp.ok && resp.results) {
                        recordRelayResults(resp.results);
                        if (resp.results.successful > 0) {
                            mirrorResults.ok++;
                            try { await AssessmentModel.markMirrored(sel.assessment.id); }
                            catch (_) { /* best-effort */ }
                        } else { mirrorResults.fail++; mirrorResults.errors.push('mirror: no relays accepted'); }
                    } else {
                        mirrorResults.fail++;
                        mirrorResults.errors.push(`mirror: ${(resp && resp.error) || 'unknown'}`);
                    }
                } catch (err) {
                    mirrorResults.fail++;
                    mirrorResults.errors.push(`mirror: ${err.message || String(err)}`);
                }
                setProgress(judgmentBase + judgmentStep, totalEvents);
                if (++mIdx < mirrorSel.length) await sleep(BATCH_PUBLISH_DELAY_MS);
            }

            // Claim links (kind 30055).
            let lIdx = 0;
            for (const sel of linkSel) {
                btn.textContent = `Publishing (${judgmentBase + (++judgmentStep)}/${totalEvents})…`;
                try {
                    const { event: unsigned } = await buildClaimRelationshipEvent({
                        sourceCoord:   sel.source.coord,
                        targetCoord:   sel.target.coord,
                        relationship:  sel.link.relationship,
                        sourceUrl:     sel.source.url,
                        targetUrl:     sel.target.url,
                        sourceEventId: sel.source.eventId,
                        targetEventId: sel.target.eventId,
                        note:          sel.link.note,
                        suggestedBy:   sel.link.suggested_by || 'user'
                    });
                    const resp = await sendJudgment(unsigned);
                    if (resp && resp.ok && resp.results) {
                        recordRelayResults(resp.results);
                        if (resp.results.successful > 0) {
                            jLinkResults.ok++;
                            try { await EvidenceLinker.markPublished(sel.link.id, resp.signedEvent?.id || null); }
                            catch (_) { /* best-effort */ }
                        } else {
                            jLinkResults.fail++;
                            jLinkResults.errors.push(`${sel.link.relationship} link: no relays accepted`);
                        }
                    } else {
                        jLinkResults.fail++;
                        jLinkResults.errors.push(`${sel.link.relationship} link: ${(resp && resp.error) || 'unknown'}`);
                    }
                } catch (err) {
                    jLinkResults.fail++;
                    jLinkResults.errors.push(`${sel.link.relationship} link: ${err.message || String(err)}`);
                    console.warn('[X-Ray Reader] claim-link publish failed:', sel.link.id, err);
                }
                setProgress(judgmentBase + judgmentStep, totalEvents);
                if (++lIdx < linkSel.length) await sleep(BATCH_PUBLISH_DELAY_MS);
            }
        }

        // Build + surface the end-of-batch summary.
        showPublishSummary({
            includeComments,
            totalEvents,
            articleResults,
            commentResults,
            entityResults,
            entityCount: entitiesToPublish.length,
            claimResults,
            claimCount: claimsToPublish.length,
            relationshipResults,
            relationshipCount: relationshipsToPublish.length,
            assessResults,
            assessCount: assessSel.length,
            mirrorResults,
            mirrorCount: mirrorSel.length,
            jLinkResults,
            jLinkCount: linkSel.length,
            relayStats
        });

        // Refresh the claims bar so the 🌐 published indicator shows.
        refreshClaimsBar().catch(() => {});
    } catch (err) {
        console.error('[X-Ray Reader] publish failed:', err);
        toast('Publish failed: ' + (err.message || err), 'error', 7000);
        notify('X-Ray: Publish failed', err.message || String(err), 'error');
    } finally {
        btn.textContent = originalLabel;
        btn.disabled = false;
        // Leave the progress bar at 100% briefly so the user sees completion.
        setTimeout(() => { const w = $('#xr-progress'); if (w) w.hidden = true; }, 1200);
    }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Given the article's raw entity refs, produce the de-duplicated list
 * of entities whose kind-0 profile event still needs to be published.
 *
 * De-dup key = entity_id (the same entity may be tagged N times in one
 * article; we only publish one kind-0 per unique entity per publish
 * session). An entity with `publishedAt` set is skipped — its kind-0
 * already exists on the network.
 *
 * Missing entities (refs pointing at entities we no longer have
 * locally) are dropped silently: the p-tag on the article event still
 * carries their pubkey via the event-builder path, so the reference
 * doesn't disappear, but we obviously can't sign a kind-0 without the
 * private key.
 */
async function resolveEntitiesToPublish(entityIds) {
    if (!entityIds || entityIds.length === 0) return [];
    const seen = new Set();
    const out = [];

    const enqueue = async (id) => {
        if (!id || seen.has(id)) return;
        seen.add(id);
        const entity = await EntityModel.get(id);
        if (!entity)           return;        // dangling ref
        if (!entity.keypair)   return;        // no private key — can't sign
        // Skip if already on-network AND unedited since. `update()`
        // bumps `updated`; `markPublished()` does not. So any local
        // edit the user has made since the last publish will
        // re-emit the kind-0 with the new content, using the same
        // (stable) entity pubkey — NIP-01 replaceable-event
        // semantics do the right thing.
        if (entity.publishedAt && entity.updated <= entity.publishedAt) return;
        // If this entity is an alias and its canonical isn't published yet,
        // publish the canonical FIRST — otherwise the alias's kind-0
        // `refers_to` tag would dangle to a pubkey with no profile.
        if (entity.canonical_id) await enqueue(entity.canonical_id);
        out.push(entity);
    };

    for (const id of entityIds) await enqueue(id);
    return out;
}

/**
 * Claims on the current article that still need their kind-30040
 * event published. Mirrors `resolveEntitiesToPublish`'s semantics
 * with the same `updated > publishedAt` gate so edits to a claim's
 * fields re-emit the event (NIP-01 replaceable on the `d` tag).
 */
async function resolveClaimsToPublish(articleUrl) {
    if (!articleUrl) return [];
    const all = await ClaimModel.getBySourceUrl(articleUrl);
    return all.filter((c) => !c.publishedAt || c.updated > c.publishedAt);
}

/**
 * Collect every entity id a claim references — its `about` set plus an
 * entity `source`. Used to ensure claim-referenced entities have their
 * kind-0 on the network before the claim's kind-30040 lands (claim
 * events p-tag these pubkeys; dangling references are rude).
 */
function collectClaimEntityIds(claims) {
    const ids = new Set();
    for (const c of claims || []) {
        for (const id of c.about || []) ids.add(id);
        if (c.source && /^entity_/.test(c.source)) ids.add(c.source);
    }
    return ids;
}


/**
 * For every claim, enumerate the (entity, relationshipType, claimId)
 * triples that should become kind-32125 entity-relationship events.
 * De-duplicated by `{entity_id}:{url}:{relationshipType}` — the same
 * `d`-tag addressable-event-coordinate means only one should land on
 * the network per publish session.
 *
 * Entities without a local keypair (rare — someone deleted the
 * entity after tagging) are dropped silently.
 */
async function resolveRelationshipsToPublish(claims, articleUrl) {
    const seen = new Set();
    const out = [];
    for (const c of claims || []) {
        const triples = [];
        for (const id of c.about || []) triples.push([id, 'about']);
        if (c.source && /^entity_/.test(c.source)) triples.push([c.source, 'source']);
        for (const [entityId, relType] of triples) {
            const key = `${entityId}:${articleUrl}:${relType}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const entity = await EntityModel.get(entityId);
            if (!entity || !entity.keypair) continue;
            out.push({ entity, relType, claimId: c.id });
        }
    }
    return out;
}

/**
 * Read the user's configured relays from preferences. Mirrors the
 * logic in `handleCapturePublish` on the SW side; we need it
 * reader-side too because entity kind-0 events go through the
 * signed-event publish path (`xray:relay:publish`) which takes a
 * relay list from the caller.
 */
async function getConfiguredRelays() {
    return new Promise((resolve) => {
        try {
            browserApi.storage.local.get(['preferences'], (res) => {
                const raw = res && res.preferences;
                let prefs = {};
                try { prefs = typeof raw === 'string' ? JSON.parse(raw) : (raw || {}); }
                catch (_) { prefs = {}; }
                const relays = Array.isArray(prefs.default_relays) && prefs.default_relays.length > 0
                    ? prefs.default_relays
                    : ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'];
                resolve(relays);
            });
        } catch (_) {
            resolve(['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band']);
        }
    });
}

/**
 * Compose the initial "Publishing…" toast so the user knows roughly
 * what's about to happen. Pluralizes correctly and only mentions
 * parts that actually exist.
 */
function buildPublishStartMessage(commentCount, entityCount, claimCount = 0, relationshipCount = 0) {
    const parts = ['article'];
    if (commentCount > 0)      parts.push(`${commentCount} comment${commentCount === 1 ? '' : 's'}`);
    if (entityCount > 0)       parts.push(`${entityCount} entity profile${entityCount === 1 ? '' : 's'}`);
    if (claimCount > 0)        parts.push(`${claimCount} claim${claimCount === 1 ? '' : 's'}`);
    if (relationshipCount > 0) parts.push(`${relationshipCount} relationship${relationshipCount === 1 ? '' : 's'}`);
    const total = 1 + commentCount + entityCount + claimCount + relationshipCount;
    return `Publishing ${total} events (${parts.join(' + ')})…`;
}

/**
 * Compose a per-relay rollup toast and log a detailed breakdown to the
 * console. Consistently-failing relays are called out by name so the
 * user knows which ones to consider removing.
 */
function showPublishSummary({
    includeComments, totalEvents, articleResults,
    commentResults, entityResults, entityCount,
    claimResults, claimCount, relationshipResults, relationshipCount,
    assessResults, assessCount = 0, mirrorResults, mirrorCount = 0,
    jLinkResults, jLinkCount = 0,
    relayStats
}) {
    // Console breakdown (always useful for debugging)
    console.group('[X-Ray Reader] publish summary');
    console.log('total events:', totalEvents);
    if (includeComments)                                     console.log('comments:',       commentResults);
    if (entityResults && entityCount > 0)                    console.log('entities:',       entityResults);
    if (claimResults  && claimCount  > 0)                    console.log('claims:',         claimResults);
    if (relationshipResults && relationshipCount > 0)        console.log('relationships:',  relationshipResults);
    if (assessResults && assessCount > 0)                    console.log('assessments:',    assessResults);
    if (mirrorResults && mirrorCount > 0)                    console.log('label mirrors:',  mirrorResults);
    if (jLinkResults && jLinkCount > 0)                      console.log('claim links:',    jLinkResults);
    console.log('per relay:', Object.fromEntries(relayStats));
    console.groupEnd();

    const dead = [];
    for (const [url, s] of relayStats) {
        if (s.ok === 0 && s.fail > 0) dead.push({ url, fail: s.fail, reason: s.lastError });
    }

    const entFails  = (entityResults       && entityResults.fail)       || 0;
    const cmtFails  = (commentResults      && commentResults.fail)      || 0;
    const clmFails  = (claimResults        && claimResults.fail)        || 0;
    const relFails  = (relationshipResults && relationshipResults.fail) || 0;
    const jdgFails  = ((assessResults && assessResults.fail) || 0)
                    + ((mirrorResults && mirrorResults.fail) || 0)
                    + ((jLinkResults && jLinkResults.fail) || 0);

    const segments = [];
    segments.push(articleResults.successful > 0
        ? `article on ${articleResults.successful}/${articleResults.total} relays`
        : `article REJECTED by all ${articleResults.total} relays`);
    if (includeComments) {
        segments.push(`${commentResults.ok}/${commentResults.ok + commentResults.fail} comments`);
    }
    if (entityCount > 0) {
        segments.push(`${entityResults.ok}/${entityResults.ok + entityResults.fail} entity profile${entityCount === 1 ? '' : 's'}`);
    }
    if (claimCount > 0) {
        segments.push(`${claimResults.ok}/${claimResults.ok + claimResults.fail} claim${claimCount === 1 ? '' : 's'}`);
    }
    if (relationshipCount > 0) {
        segments.push(`${relationshipResults.ok}/${relationshipResults.ok + relationshipResults.fail} relationship${relationshipCount === 1 ? '' : 's'}`);
    }
    if (assessCount > 0) {
        segments.push(`${assessResults.ok}/${assessCount} assessment${assessCount === 1 ? '' : 's'}`);
    }
    if (mirrorCount > 0) {
        segments.push(`${mirrorResults.ok}/${mirrorCount} label mirror${mirrorCount === 1 ? '' : 's'}`);
    }
    if (jLinkCount > 0) {
        segments.push(`${jLinkResults.ok}/${jLinkCount} claim link${jLinkCount === 1 ? '' : 's'}`);
    }
    let line = 'Published: ' + segments.join(', ') + '.';

    const acceptedAll = [...relayStats.values()].filter((s) => s.fail === 0 && s.ok > 0).length;
    if (relayStats.size > 0) {
        line += ` ${acceptedAll}/${relayStats.size} relays accepted everything.`;
    }

    if (dead.length > 0) {
        const names = dead.map((d) => d.url.replace(/^wss?:\/\//, '')).join(', ');
        line += ` Rejected by ${names} — consider removing in Options.`;
    }

    const anyFail = dead.length > 0 || cmtFails > 0 || entFails > 0 || clmFails > 0 || relFails > 0 || jdgFails > 0;
    const level = (anyFail || articleResults.successful === 0)
        ? (articleResults.successful > 0 ? 'warning' : 'error')
        : 'success';
    toast(line, level, 9000);

    // Fire a native OS notification too — the publish flow is long
    // enough that the user often tabs away mid-publish, and the toast
    // disappears with the reader. The native notification surfaces
    // outside the browser tab so completion is visible even when
    // the reader isn't focused.
    const notifyTitle = level === 'error'
        ? 'X-Ray: Publish failed'
        : level === 'warning'
            ? 'X-Ray: Publish partially succeeded'
            : 'X-Ray: Publish complete';
    notify(notifyTitle, line, level);

    return totalEvents - cmtFails - entFails - clmFails - relFails - jdgFails
                       - (articleResults.successful === 0 ? 1 : 0);
}

/**
 * Fire a native OS notification via chrome.notifications. The reader
 * runs in an extension page so the API is available directly. Called
 * from the publish-complete summary and from the publish-failure
 * catch block. Best-effort: notification permission can be denied at
 * the OS level, in which case the toast still fires and we move on.
 */
function notify(title, message, level) {
    try {
        if (!browserApi.notifications || !browserApi.notifications.create) return;
        browserApi.notifications.create({
            type:     'basic',
            iconUrl:  browserApi.runtime.getURL('icons/icon-128.png'),
            title,
            message,
            priority: level === 'error' ? 2 : 0
        }, () => {
            // Swallow chrome.runtime.lastError here — OS-level deny is
            // not actionable from inside the extension.
            void browserApi.runtime.lastError;
        });
    } catch (err) {
        console.warn('[X-Ray Reader] notification failed:', err);
    }
}

/**
 * Build a deterministic `d`-tag for a comment event. Using platform
 * namespacing protects against numeric-id collisions across platforms
 * (Substack and YouTube both use numeric ids; we don't want them to
 * alias to the same NOSTR event).
 */
function makeCommentDTag(platform, commentId) {
    return `cmt:${platform}:${String(commentId)}`;
}

/**
 * Depth-first flatten of the comment tree — parents precede children,
 * which guarantees `reply-to` references resolve during sequential
 * publishing.
 */
function flattenCommentTree(tree) {
    const out = [];
    const walk = (list) => {
        for (const c of list) {
            out.push(c);
            if (c.children && c.children.length) walk(c.children);
        }
    };
    walk(tree);
    return out;
}

// ------------------------------------------------------------------
// Init
// ------------------------------------------------------------------

async function init() {
    // Entity layer bootstrap — swap Storage.entities for the real
    // registry so event-builder's `p`-tag path resolves entities
    // instead of always seeing null, and hydrate LocalKeyManager
    // from chrome.storage.local so any already-created entity keypairs
    // are usable by the tagger + publish flow.
    try { installEntityStorageBridge(); } catch (_) { /* idempotent */ }
    try { await LocalKeyManager.init(); } catch (err) {
        console.warn('[X-Ray Reader] LocalKeyManager init failed:', err);
    }

    try {
        await loadArticle();
    } catch (err) {
        console.error('[X-Ray Reader] Load failed:', err);
        $('#xr-main').innerHTML = `
          <div class="xr-reader__loading">
            <p><strong>Could not load the article.</strong></p>
            <p>${escapeHtml(err.message || String(err))}</p>
          </div>`;
        return;
    }

    renderReader();

    document.querySelectorAll('.xr-reader__mode-btn').forEach((btn) => {
        btn.addEventListener('click', () => setViewMode(btn.dataset.mode));
    });

    $('#xr-publish').addEventListener('click', () => {
        publish().catch((err) => {
            console.error('[X-Ray Reader] publish failed:', err);
            toast('Publish failed: ' + (err.message || err), 'error', 6000);
            notify('X-Ray: Publish failed', err.message || String(err), 'error');
        });
    });

    $('#xr-close').addEventListener('click', () => {
        window.close();
    });

    // Open the entity browser. Three openers, in preference order:
    //   1. browser.sidebarAction.toggle()  — Firefox sidebar
    //   2. chrome.sidePanel.open()         — Chrome / Edge / Brave
    //   3. tabs.create()                   — last-resort tab
    // Both panel APIs require a user gesture; the click qualifies.
    $('#xr-entities').addEventListener('click', async () => {
        try {
            if (browserApi.sidebarAction && browserApi.sidebarAction.toggle) {
                await browserApi.sidebarAction.toggle();
            } else if (browserApi.sidePanel && browserApi.sidePanel.open) {
                const win = await new Promise((resolve) => browserApi.windows.getCurrent(resolve));
                await browserApi.sidePanel.open({ windowId: win.id });
            } else {
                browserApi.tabs.create({ url: browserApi.runtime.getURL('src/sidepanel/index.html') });
            }
        } catch (err) {
            console.warn('[X-Ray Reader] entity-browser open failed:', err);
            browserApi.tabs.create({ url: browserApi.runtime.getURL('src/sidepanel/index.html') });
        }
    });

    // Comments include-in-publish toggle
    $('#xr-comments-include').addEventListener('change', (ev) => {
        state.comments.includeInPublish = ev.target.checked;
    });

    // Kick off the platform-specific data fetch, if any.
    // Non-blocking — the reader is already interactive.
    if (state.article.platform === 'substack') {
        loadSubstackData().catch((err) => {
            console.warn('[X-Ray Reader] Substack data load errored out:', err);
        });
    } else if (state.article.platform === 'youtube') {
        // Comments were captured in the content script and travel on the
        // article; just move them into state.comments (no fetch).
        try { loadYouTubeComments(); }
        catch (err) { console.warn('[X-Ray Reader] YouTube comments load failed:', err); }
    }
}

document.addEventListener('DOMContentLoaded', init);

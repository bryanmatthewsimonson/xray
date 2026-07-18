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
import { EntityModel, installEntityStorageBridge, mergeEntityRefs, findEntityByName, canonicalIdOf } from '../shared/entity-model.js';
import { assembleEntityDossier } from '../shared/entity-dossier.js';
import { buildProfileAbout, buildFactSheetEvent, profileContentHash, factSheetContentHash } from '../shared/entity-profile.js';
import { recordAccount, extractPostAuthor } from '../shared/identity/account-registry.js';
import { selectAccountsToPublish } from '../shared/identity/account-publish.js';
import { ClaimModel, exactFromAnchor } from '../shared/claim-model.js';
import { EvidenceLinker } from '../shared/evidence-linker.js';
import * as ArchiveCache from '../shared/archive-cache.js';
import { recordAlias, resolveAlias } from '../shared/url-aliases.js';
import { installEntityTagger, rehydrateEntityMarks, renderEntitiesBar, extractParagraphContext } from './entity-tagger.js';
import { openClaimModal, openEvidenceLinkModal, openOthersClaimsModal, renderClaimsBar, rehydrateClaimMarks } from './claim-extractor.js';
import { openAssessModal } from '../shared/assess-modal.js';
import { openAdjudicateModal } from '../shared/adjudicate-modal.js';
import { openIntegrityModal } from '../shared/integrity-modal.js';
import { AssessmentModel } from '../shared/assessment-model.js';
import { makeClaimRefCanonicalizer } from '../shared/claim-ref.js';
import { selectAssessmentsToPublish, selectLinksToPublish, selectMirrors, claimWireInfo } from '../shared/assessment-publish.js';
import { selectFindingsToPublish, selectFindingMirrors, selectRevisionEdgesToPublish } from '../shared/forensic-publish.js';
import { selectVerdictsToPublish, selectVerdictMirrors, selectIntegrityFindingsToPublish, wireEvidence } from '../shared/truth-publish.js';
import { buildAdjudicatedVerdictEvent, buildVerdictMirrorEvent, buildIntegrityFindingEvent } from '../shared/truth-builders.js';
import { TruthAdjudicationModel, VerdictModel } from '../shared/truth-adjudication-model.js';
import { IntegrityModel } from '../shared/integrity-model.js';
import { buildAssessmentEvent, buildClaimRelationshipEvent, buildAssessmentMirrorEvent, buildBehavioralFindingEvent, buildForensicFindingMirrorEvent } from '../shared/metadata/builders.js';
import { loadFlags, isEnabled } from '../shared/metadata/feature-flags.js';
import { ForensicModel } from '../shared/forensic-model.js';
import { openFindingModal, openBaselineModal } from '../shared/forensic-modal.js';
import { renderFindingsBar } from './findings-section.js';
import { openLlmReview } from './llm-review.js';
import { capturePdfToArticle, completeScanCapture } from './pdf-capture.js';
import { assembleExtraction, extractionMethod } from '../shared/llm-extract.js';
import { MAX_EXTRACT_BYTES, MAX_EXTRACT_PAGES } from '../shared/llm-extract-prompts.js';
import { pageOfOffset, pageFragmentSelector } from '../shared/pdf-layout.js';
import { createGroundingIndex } from '../shared/quote-grounding.js';
import { captureFromRange } from '../shared/metadata/anchor-capture.js';
import { normalize as normalizeUrl } from '../shared/metadata/url-normalizer.js';
import { articleHash as canonicalArticleHash } from '../shared/audit/article-hash.js';
import { importAuditJson } from '../shared/audit/import.js';
import { AuditRunModel, PredictionModel, ResolutionModel, staleModules } from '../shared/audit/audit-model.js';
import { listResolutions as listAuditResolutions } from '../shared/audit/audit-cache.js';
import { assembleAuditBatch } from '../shared/audit/publish-batch.js';
import { CURRENT_MODULE_VERSIONS, MODULE_NAMES } from '../shared/audit/findings-schemas.js';
// The lean assembly half only — never audit-prompt.js, whose generated
// module-prompts dependency must stay out of the reader bundle.
import { assembleAudit, auditableSlice, MAX_AUDIT_INPUT_CHARS } from '../shared/audit/assemble.js';
import { orchestrateModuleRuns } from '../shared/audit/run-orchestrator.js';
import * as EventJournal from '../shared/event-journal.js';
import { auditBand, scoreChipHtml, prettyModule } from '../shared/audit/display.js';
import { JurisdictionModel } from '../shared/jurisdiction-model.js';
import { lensTypeForPropositionClass } from '../shared/lens-taxonomy.js';
import { assembleLensPanel, cacheLensRun, getCachedLensRun } from '../shared/lens-engine.js';
import { speakerFromParagraphText } from '../shared/transcript-parse.js';
import { buildTranscriptSection, upsertTranscriptSection } from '../shared/transcript-article.js';
import { openMediaModal } from './media-modal.js';
import { Storage } from '../shared/storage.js';
import { Crypto } from '../shared/crypto.js';
import {
    buildOwnedKeysManifest, mintDelegationTag, entityDelegationConditions
} from '../shared/identity-builders.js';
import { renderLensSetup, renderJurisdictionCard, renderJurisdictionFailure, renderPanelSummary } from './lens-section.js';

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

    // Phase 18 C3/C4 — PDF capture path. Content scripts never run in
    // the browsers' PDF viewers, so the background routes PDF tabs here
    // with ?pdf=<url> (or ?pdf=import for a local file). The article is
    // built IN the reader (fetch → archive bytes → pdf.js → layout
    // reconstruction) and then adopted exactly like a normal capture.
    const pdfParam = params.get('pdf');
    if (pdfParam) {
        state.id = 'pdf-' + Date.now().toString(36);
        const article = await loadPdfArticle(pdfParam);
        // Register a TABLESS session record: the background publish
        // handlers look captures up by id, and without this record a
        // PDF capture could never publish ("Session record missing").
        // sourceTabId is null by construction — there is no source tab
        // (content scripts never run in PDF viewers) — which routes
        // signing through the worker's Signer façade instead of a tab.
        await new Promise((resolve) => {
            const area = browserApi.storage.session || browserApi.storage.local;
            area.set({
                ['xray:article:' + state.id]:
                    { article, sourceTabId: null, createdAt: Date.now(), readOnly: false }
            }, () => {
                // A quota-full session store fails SILENTLY here and
                // surfaces minutes later as a baffling "Session record
                // missing" at publish — say so now, while the user can
                // still connect cause and effect.
                const err = browserApi.runtime && browserApi.runtime.lastError;
                if (err) {
                    console.warn('[X-Ray Reader] session record write failed:', err.message);
                    toast('Could not register this capture for publishing ('
                        + err.message + ') — publish will fail until the browser is restarted.',
                    'error', 8000);
                }
                resolve();
            });
        });
        return adoptArticle(article, null);
    }

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

    return adoptArticle(article, stored);
}

/** Shared adoption tail for every load path (session hand-off, PDF). */
function adoptArticle(article, stored) {
    state.article = article;
    // Remembered for later writes (save-on-tag): a read-only open (the
    // portal's relay reconstructions) must never touch the archive row.
    state.readOnlyOpen = !!(stored && stored.readOnly);

    // PDF captures: surface the layout engine's quality warnings
    // (missing text layers, failed paragraph merging) before anyone
    // quotes from an affected passage.
    try { renderExtractionWarningsBanner(); }
    catch (err) { console.warn('[X-Ray Reader] extraction banner failed:', err); }
    state.markdownDraft = article.markdown || article.content || '';
    state.htmlDraft = article.content || ContentExtractor.markdownToHtml(state.markdownDraft);

    // PDFs: the reconstructed markdown IS the capture — `content` is a
    // rendering derived from it. Marking the markdown draft canonical
    // makes an untouched capture publish it byte-exact instead of
    // round-tripping the derived HTML back through turndown, which
    // renumbered a filing's "14./15./23." paragraphs to "1." on the
    // wire and salted the body with escape backslashes that shifted
    // every pageMap anchor.
    if (isMarkdownCanonical(article)) {
        state.dirtySource = 'markdown';
    }

    // Tagged-entity refs stored on the article get round-tripped through
    // the session-storage hand-off. Ensure the field exists so the
    // tagger and publish paths can write to it without null-guards.
    if (!Array.isArray(state.article.entities)) state.article.entities = [];

    // Alias bookkeeping: any article whose identity differs from the
    // address it was fetched from (structural recovery at capture, a
    // relay read-back's capture-url tag, a prior manual set) IS an
    // alias observation — record it so every URL-keyed join heals
    // across mirror addresses. Local join map only, not the archive
    // row, so read-only opens may record too.
    if (state.article.capture_url && state.article.url
            && state.article.capture_url !== state.article.url) {
        recordAlias(state.article.capture_url, state.article.url).catch(() => {});
    }

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
                const fullBody = EventBuilder.assembleArticleBody(hashableArticle(state.article));
                // The AUDITABLE key: audits cover at most
                // MAX_AUDIT_INPUT_CHARS, and their hash gate covers the
                // sliced text — for every normal-length capture this is
                // identical to articleHash (zero behavior change).
                // Compute BOTH hashes into locals and assign together:
                // an await between the two state writes would let an
                // interleaved refreshAuditStatus see articleHash set
                // but auditableHash still undefined and skip the
                // truncated-key runs/draft note for that paint.
                const fullHash = await canonicalArticleHash(fullBody);
                const slice = auditableSlice(fullBody);
                const slicedHash = slice.truncated
                    ? await canonicalArticleHash(slice.text)
                    : fullHash;
                state.articleHash = fullHash;
                state.auditableTotalChars = slice.totalChars;
                state.auditableHash = slicedHash;
                updateHashLine();
                // The audit bar keys on the hash — refresh it now that
                // the hash is known (init wired it before this resolved).
                refreshAuditStatus().catch((err) =>
                    console.warn('[X-Ray Reader] audit status failed:', err));
            } catch (err) {
                console.warn('[X-Ray Reader] article hash failed:', err);
            }
            try {
                let prior = await ArchiveCache.getArticle(state.article.url);
                if (!prior) {
                    // Alias fallback: the prior capture may live under
                    // this URL's alias-resolved original (or this URL
                    // may be the alias of it).
                    const aliased = await resolveAlias(state.article.url);
                    if (aliased && aliased !== state.article.url) {
                        prior = await ArchiveCache.getArticle(aliased);
                    }
                }
                if (prior && prior.articleHash && state.articleHash
                        && prior.articleHash !== state.articleHash) {
                    renderHashMismatchBanner(prior);
                }
                // Rehydrate tagged entities from the prior archive row.
                // Fresh captures never carry entities, and the save
                // below would otherwise overwrite the row with an empty
                // list — losing every tag from earlier sessions (the
                // reload-loses-tags bug). Merge BEFORE saving so the
                // row carries them forward.
                const priorEntities = prior && prior.article && prior.article.entities;
                if (Array.isArray(priorEntities) && priorEntities.length) {
                    const merged = mergeEntityRefs(state.article.entities, priorEntities);
                    if (merged.length !== (state.article.entities || []).length) {
                        state.article.entities = merged;
                        refreshEntitiesBar().catch(() => {});
                        const body = $('.xr-article__body');
                        if (body) {
                            rehydrateEntityMarks(body, state.article.entities)
                                .catch((err) => console.warn('[X-Ray Reader] rehydrate failed:', err));
                        }
                    }
                }
            } catch (err) {
                console.warn('[X-Ray Reader] hash check failed:', err);
            }
            // Attach the computed hash so the archive row records the
            // same identity the reader displays — archive-cache would
            // otherwise re-derive it from the article's HTML content,
            // which for PDFs is a turndown round trip with a DIFFERENT
            // hash, and every revisit would false-flag a stealth edit.
            ArchiveCache.saveArticle({
                article: state.articleHash
                    ? { ...state.article, _articleHash: state.articleHash }
                    : state.article,
                source: 'capture'
            }).catch((err) => console.warn('[X-Ray Reader] archive cache save failed:', err));
        })();
    } else if (stored && stored.readOnly && state.article && state.article._articleHash) {
        // Read-only opens (the portal's relay reconstructions) skip
        // the hash/compare/save pipeline by design — but the carried
        // PUBLISHED hash (the event's own x tag) is the view's
        // identity, and the audit panel keys on it. Display-only:
        // nothing is recomputed, nothing is saved.
        state.articleHash = state.article._articleHash;
        updateHashLine();
        refreshAuditStatus().catch((err) =>
            console.warn('[X-Ray Reader] audit status failed:', err));
    }

    // Archive-reader affordance — if this capture looks paywalled OR
    // truncated, check for a richer version (local cache hit with
    // a longer body, or a relay-hosted kind-30023). The banner UI is
    // rendered AFTER the main view mounts so we don't block the
    // render on a network round-trip.
    setTimeout(() => checkArchiveAvailability().catch((err) =>
        console.warn('[X-Ray Reader] archive check failed:', err)), 100);
}

// Persist the current article (with its tagged entities) to the archive
// row shortly after a tag lands, so tag-without-publish survives a
// reader close — previously tags only reached the row at publish time.
// Debounced: an accepted suggestion batch lands many tags in a burst.
// Skipped for read-only opens (a portal reconstruction must not reset
// the archive row's publish mark).
let _tagSaveTimer = null;
function scheduleTagSave() {
    if (state.readOnlyOpen || !state.article || !state.article.url) return;
    if (_tagSaveTimer) clearTimeout(_tagSaveTimer);
    _tagSaveTimer = setTimeout(() => {
        _tagSaveTimer = null;
        ArchiveCache.saveArticle({
            article: state.articleHash
                ? { ...state.article, _articleHash: state.articleHash }
                : state.article,
            source: 'capture'
        }).catch((err) => console.warn('[X-Ray Reader] tag save failed:', err));
    }, 500);
}

// ------------------------------------------------------------------
// PDF capture path (Phase 18 C3/C4)
// ------------------------------------------------------------------

async function loadPdfArticle(pdfParam) {
    if (pdfParam !== 'import') {
        let target = null;
        try {
            const u = new URL(pdfParam);
            if (u.protocol === 'https:' || u.protocol === 'http:') target = u.href;
        } catch (_) { /* invalid — falls through */ }
        if (!target) throw new Error('Invalid PDF URL.');
        try {
            return await capturePdfToArticle({ url: target });
        } catch (err) {
            // A scan is not a fetch failure — the file-import fallback
            // would just refuse the same bytes again. Offer the C5
            // transcription path instead.
            if (err && err.code === 'scan-no-text-layer') {
                return transcribeScanFlow(err.scanContext);
            }
            // Auth-bound refetch (403/401), CORS-ish failures — surface
            // the reason and offer the local-file path.
            const file = await pickPdfFile(
                'Could not capture this PDF automatically: '
                + ((err && err.message) || err) + ' '
                + 'If it needs a login, save it from the browser and import the file:');
            try {
                return await capturePdfToArticle({ file, url: target });
            } catch (err2) {
                if (err2 && err2.code === 'scan-no-text-layer') {
                    return transcribeScanFlow(err2.scanContext);
                }
                throw err2;
            }
        }
    }
    const file = await pickPdfFile('Capture a PDF from a local file:');
    try {
        return await capturePdfToArticle({ file });
    } catch (err) {
        if (err && err.code === 'scan-no-text-layer') {
            return transcribeScanFlow(err.scanContext);
        }
        throw err;
    }
}

/**
 * Phase 18 C5 — the scans path: consent, transcription, capture.
 * The model's transcription IS the capture (there is no substrate to
 * ground against); honesty comes from `extraction.method = 'llm:…'`
 * and the reader banner, with the archived original one click away.
 */
async function transcribeScanFlow(scanContext) {
    const { sourceHash, pageCount, bytes } = scanContext || {};
    if (!sourceHash || !bytes) throw new Error('This PDF has no usable text layer — it is likely a scan.');

    // EVERY refusable condition is checked BEFORE consent — asking
    // someone to approve sending a document and then failing on a
    // missing key or a size cap is a wasted consent (and the archive
    // write would already have happened). The SW re-enforces the caps;
    // this is UX honesty, not the security boundary.
    await requireLlmReady();
    if (bytes.byteLength > MAX_EXTRACT_BYTES) {
        throw new Error(`This PDF is ${(bytes.byteLength / 1048576).toFixed(0)}MB — over the ${(MAX_EXTRACT_BYTES / 1048576).toFixed(0)}MB single-request limit for LLM transcription.`);
    }
    if (pageCount > MAX_EXTRACT_PAGES) {
        throw new Error(`This PDF has ${pageCount} pages — over the ${MAX_EXTRACT_PAGES}-page single-request limit for LLM transcription.`);
    }

    const mb = (bytes.byteLength / 1048576).toFixed(1);
    const consented = await confirmLlmSend(
        'This PDF has no machine-readable text layer — it is likely a scan.',
        `X-Ray can ask the model to TRANSCRIBE it. The document (${mb}MB, `
        + `${pageCount} page${pageCount === 1 ? '' : 's'}) will be sent to the Anthropic API `
        + 'under your API key — it leaves this device. The result is machine-transcribed '
        + 'text, clearly labeled as such, with the original bytes archived for verification.',
        'Transcribe with LLM');
    if (!consented) throw new Error('PDF capture cancelled (no transcription consent).');

    // Archive the bytes BEFORE the call: the SW reads them from
    // IndexedDB (50MB through runtime messaging is a dropped channel),
    // and the transcription's provenance needs them archived anyway. A
    // failed transcription leaves an unreferenced row the age-gated
    // pruner collects — bounded, honest cost. `stored: false` (the
    // store's own 50MB cap) is a hard stop: the SW would find nothing,
    // and its "re-capture" advice would be factually wrong here.
    const put = await ArchiveCache.putSourceDocument({
        hash: sourceHash, bytes, mime: 'application/pdf',
        url: scanContext.sourceUrl || ''
    });
    if (!put || !put.stored) {
        throw new Error('The PDF could not be archived (over the storage cap) — transcription needs the archived bytes.');
    }

    toast('Transcribing the scanned PDF — this can take a few minutes…', 'warning', 8000);
    const resp = await browserApi.runtime.sendMessage({
        type: 'xray:llm:extract', sourceHash, mode: 'transcription', pageCount
    });
    if (!resp || !resp.ok) {
        throw new Error((resp && resp.error) || 'LLM transcription failed.');
    }
    const assembled = assembleExtraction(resp.spans, null, { mode: 'transcription' });
    const article = await completeScanCapture({
        scanContext, markdown: assembled.markdown,
        pageMap: assembled.pageMap, model: resp.model
    });
    toast(`Transcribed ${assembled.total_spans} blocks with ${resp.model} — review before relying on it.`, 'success', 6000);
    return article;
}

/**
 * Both C5 flows gate on the same consent pair every LLM pass uses —
 * checked HERE, before the consent modal, so nobody approves sending a
 * document only to hit a missing-key error afterward.
 */
async function requireLlmReady() {
    let cfg = {};
    try { cfg = await browserApi.runtime.sendMessage({ type: 'xray:llm:config' }) || {}; }
    catch (_) { /* treated as not ready below */ }
    if (!cfg.enabled) throw new Error('LLM assist is off. Enable it in Options → Advanced → LLM assist.');
    if (!cfg.hasKey) throw new Error('No Anthropic API key set. Add one in Options → Advanced → LLM assist.');
}

/**
 * Consent modal for any flow that sends the document off-device.
 * Resolves true only on the explicit affirmative button.
 */
function confirmLlmSend(headline, body, actionLabel) {
    return new Promise((resolveConfirm) => {
        const host = document.createElement('div');
        host.className = 'xr-pdf-pick';
        const card = document.createElement('div');
        card.className = 'xr-pdf-pick__card';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');
        card.setAttribute('aria-label', headline);
        const title = document.createElement('h2');
        title.textContent = '🤖 ' + headline;
        const note = document.createElement('p');
        note.textContent = body;
        const go = document.createElement('button');
        go.type = 'button';
        go.textContent = actionLabel;
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        card.append(title, note, go, cancel);
        host.appendChild(card);
        document.body.appendChild(host);
        const close = (v) => {
            document.removeEventListener('keydown', onKey, true);
            if (host.parentNode) host.parentNode.removeChild(host);
            resolveConfirm(v);
        };
        // Escape declines — for an off-device send, the safe default
        // must be the reachable one.
        const onKey = (ev) => {
            if (ev.key === 'Escape') { ev.preventDefault(); close(false); }
        };
        document.addEventListener('keydown', onKey, true);
        go.addEventListener('click', () => close(true));
        cancel.addEventListener('click', () => close(false));
        cancel.focus();
    });
}

/** Minimal modal file picker; resolves with the chosen File. */
function pickPdfFile(message) {
    return new Promise((resolvePick, rejectPick) => {
        const host = document.createElement('div');
        host.className = 'xr-pdf-pick';
        const card = document.createElement('div');
        card.className = 'xr-pdf-pick__card';
        const title = document.createElement('h2');
        title.textContent = '📄 PDF capture';
        const note = document.createElement('p');
        note.textContent = message;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pdf,application/pdf';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        card.append(title, note, input, cancel);
        host.appendChild(card);
        document.body.appendChild(host);

        const close = () => { if (host.parentNode) host.parentNode.removeChild(host); };
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            if (!file) return;
            close();
            resolvePick(file);
        });
        cancel.addEventListener('click', () => {
            close();
            rejectPick(new Error('PDF capture cancelled.'));
        });
    });
}

/**
 * Archived PDF figures (C4.2): markdown carries content-addressed
 * `xray-figure:<sha256>` image URLs; this resolves them to live blob
 * URLs from the source_documents byte archive. The durable identity
 * stays on data-xray-figure so body→markdown round-trips re-emit the
 * content address, never the session blob URL. Evicted bytes leave
 * the alt text showing — degraded, visible, never wrong.
 */
let _figureBlobUrls = [];
async function hydrateFigureImages(root) {
    if (!root) return;
    // Blob URLs from the previous render pin their bytes for the whole
    // tab lifetime unless revoked — re-renders (edits, publish) would
    // otherwise stack a full figure set per pass.
    for (const url of _figureBlobUrls) {
        try { URL.revokeObjectURL(url); } catch (_) { /* already gone */ }
    }
    _figureBlobUrls = [];
    // Select by durable identity as well as by content-address src:
    // htmlDraft is snapshotted from the ALREADY-HYDRATED body (entity
    // tagging, field blur), so re-renders inject imgs whose src is a
    // — just revoked — blob URL. Matching only `xray-figure:` srcs
    // left those permanently broken; data-xray-figure survives every
    // snapshot and lets each pass mint fresh URLs for them.
    const imgs = root.querySelectorAll('img[src^="xray-figure:"], img[data-xray-figure]');
    for (const img of imgs) {
        const src = img.getAttribute('src') || '';
        const hash = img.getAttribute('data-xray-figure')
            || (src.startsWith('xray-figure:') ? src.slice('xray-figure:'.length) : '');
        if (!/^[0-9a-f]{64}$/.test(hash)) continue;
        img.setAttribute('data-xray-figure', hash);
        try {
            const row = await ArchiveCache.getSourceDocument(hash);
            if (!row || !row.bytes) continue;
            const url = URL.createObjectURL(new Blob([row.bytes], { type: row.mime || 'image/png' }));
            _figureBlobUrls.push(url);
            img.src = url;
        } catch (_) { /* alt text remains — honest degradation */ }
    }
}

// Content types whose `markdown` is the canonical substrate and
// `content` a derived rendering: PDFs (reconstructed markdown) and
// imported transcripts (speaker-labeled markdown, Phase 21). Hashing
// the turndown round trip of the derived HTML would fork the capture
// hash from the published x tag, so these hash + publish over the
// markdown directly and never flip dirtySource to 'reader' on a tag.
function isMarkdownCanonical(article) {
    return !!(article && article.markdown
        && (article.contentType === 'pdf' || article.contentType === 'transcript'));
}

// The body the canonical hash covers must be the body publish ships.
function hashableArticle(article) {
    return isMarkdownCanonical(article)
        ? { ...article, content: article.markdown, _contentIsMarkdown: true }
        : article;
}

// Page-level provenance (COMPLEX_CONTENT_DESIGN.md §5.4): the pageMap
// indexes the EXTRACTED MARKDOWN, so page lookup grounds the quote
// against that substrate (not the rendered body, whose offsets differ).
// The index is invalidated whenever a different article body is
// adopted (Load archive) — grounding in one text while paging in
// another yields confidently wrong page numbers.
let _pdfMdIndex = null;
let _pdfMdIndexSource = null;
function pdfPageOfQuote(quote) {
    const map = state.article && state.article.pageMap;
    const md = state.article && state.article.markdown;
    if (!Array.isArray(map) || map.length === 0 || !md || !quote) return null;
    if (!_pdfMdIndex || _pdfMdIndexSource !== md) {
        _pdfMdIndex = createGroundingIndex(md);
        _pdfMdIndexSource = md;
    }
    const g = _pdfMdIndex.ground(String(quote));
    if (g.status === 'missing') return null;
    return pageOfOffset(map, g.start);
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

    // 1. Try local cache first — then through the alias map (a prior
    //    capture of the same piece may key under the alias-resolved
    //    original of this address).
    let cached = null;
    try { cached = await ArchiveCache.getArticle(url); } catch (_) { /* ignore */ }
    if (!cached) {
        try {
            const aliased = await resolveAlias(url);
            if (aliased && aliased !== url) cached = await ArchiveCache.getArticle(aliased);
        } catch (_) { /* ignore */ }
    }
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
 * The extraction record to adopt when swapping in an archived copy.
 * Rules, in order: nothing anywhere → nothing; only one side has a
 * record → that one; both, describing the SAME source document →
 * merge with the archived copy's fields winning (its method may be
 * newer — e.g. a reconstruction published after this capture) and the
 * session's rich fields (warnings/archived/page_count/figures)
 * surviving; different source docs → the archived copy's, whole.
 */
function mergedExtraction(current, archived) {
    if (!archived) return current ? { extraction: current } : {};
    if (!current || current.source_hash !== archived.source_hash) {
        return { extraction: archived };
    }
    return { extraction: { ...current, ...archived } };
}

/**
 * Swap the reader's article payload for the archived version. Claims
 * and comments stay untouched (they key on the URL, not the body);
 * entity refs are MERGED — the current session's tags win on dupes,
 * but the archived copy's tags come along. (The old "leave entity
 * refs untouched" rule silently dropped every tag saved with the
 * archived copy — the reload-loses-tags bug.)
 */
function loadArchivedArticle(archived, provenance) {
    state.article = {
        ...archived,
        // Preserve the URL / id bridging so publish + session paths
        // stay consistent with the tab this reader was opened from.
        url: state.article.url,
        entities: mergeEntityRefs(state.article.entities, archived.entities),
        // The extraction record names this URL's SOURCE DOCUMENT
        // (extraction.source_hash keys the archived original bytes).
        // Adopting a copy without one meant a later publish overwrote
        // the archive row hashless and the orphan pruner deleted the
        // original PDF bytes while the article still lived. Since C5,
        // relay reconstructions CAN carry a THIN record (the two
        // mirrored wire fields) — a thin record must not silently
        // replace the session's RICH one (warnings, archived,
        // page_count, figures) when both describe the same source:
        // MERGE, thin fields winning, rich fields surviving.
        ...(mergedExtraction(state.article.extraction, archived.extraction))
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
    // Same rule as adoptArticle: an archived PDF's / transcript's
    // markdown is the canonical body — republish must not
    // turndown-round-trip it.
    if (isMarkdownCanonical({ ...state.article, markdown: archived.markdown })) {
        state.dirtySource = 'markdown';
    }

    // The hash line labels the visible body — the swapped-in archive
    // is different text, so the load-time hash is wrong for it. Relay
    // archives carry the PUBLISHED hash (carry, don't recompute: the
    // HTML round trip doesn't byte-match); cache archives recompute.
    state.articleHash = archived._articleHash || null;
    state.hashDirty = false;
    if (!state.articleHash) {
        canonicalArticleHash(EventBuilder.assembleArticleBody(hashableArticle(state.article)))
            .then((h) => { state.articleHash = h; updateHashLine(); })
            .catch((err) => console.warn('[X-Ray Reader] archive hash failed:', err));
    }

    // Re-render whatever view the user's currently in.
    switch (state.viewMode) {
        case 'reader':   renderReader();   break;
        case 'markdown': renderMarkdown(); break;
        case 'preview':  renderPreview();  break;
    }
    // The adopted copy may be machine-transcribed or LLM-reconstructed
    // — its provenance banner must follow it in. The only other call
    // site is adopt-time, so without this a Load-archive swap rendered
    // an llm: capture with no disclosure at all.
    try { renderExtractionWarningsBanner(); }
    catch (err) { console.warn('[X-Ray Reader] extraction banner failed:', err); }
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

// ------------------------------------------------------------------
// Audit panel (13.6)
// ------------------------------------------------------------------
//
// Display rules, every surface (docs/EPISTEMIC_AUDIT_DESIGN.md §"Score
// display"): no naked numbers (a score renders with its confidence);
// confidence < 0.6 renders as "needs human review", not a number; the
// badge bands are the framework's own rubric — never centered on 50;
// provenance one tap away; disagreement side-by-side, never averaged;
// audit and assessment UI never visually merge.

// Band/chip helpers live in shared/audit/display.js — ONE enforcement
// point for the display rules across the reader and the portal
// (imported at the top of this file).

// Locate an evidence quote in the article body: selection-only (the
// body is contenteditable and syncs htmlDraft — DOM mutation here
// would pollute the draft). Whitespace-normalized search with a
// single O(n) forward scan mapping normalized positions back to raw
// offsets — per-character normalized indices, so the selection starts
// ON the quote (never inside a collapsed whitespace run) and ends at
// its true tail, across text-node boundaries.
// The pure locate half of locateQuoteInBody: map a whitespace-
// normalized quote back to a DOM Range over the article body, no
// selection/scroll side effects. Also the seam the LLM-accept speaker
// resolution uses (22.3) to find a quote's enclosing paragraph.
function rangeForQuote(quote) {
    const body = $('.xr-article__body');
    if (!body || !quote) return null;
    const target = String(quote).replace(/\s+/g, ' ').trim();
    if (!target) return null;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let full = '';
    let n;
    while ((n = walker.nextNode())) {
        nodes.push({ node: n, start: full.length });
        full += n.textContent;
    }

    // One pass: normalized string + the raw index of each normalized
    // character. A whitespace run contributes one normalized space,
    // attributed to the run's first raw char.
    const rawIndexOfNorm = [];
    let normStr = '';
    let inWs = false;
    for (let i = 0; i < full.length; i++) {
        if (/\s/.test(full[i])) {
            if (!inWs) { normStr += ' '; rawIndexOfNorm.push(i); inWs = true; }
        } else {
            normStr += full[i];
            rawIndexOfNorm.push(i);
            inWs = false;
        }
    }

    const idx = normStr.indexOf(target);
    if (idx === -1) return null;
    const rawStart = rawIndexOfNorm[idx];
    const rawEndInclusive = rawIndexOfNorm[idx + target.length - 1];

    const nodeFor = (raw) => {
        let lo = 0;
        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].start <= raw) lo = i; else break;
        }
        return nodes[lo];
    };
    const startHit = nodeFor(rawStart);
    const endHit = nodeFor(rawEndInclusive);
    if (!startHit || !endHit) return null;
    try {
        const range = document.createRange();
        range.setStart(startHit.node, rawStart - startHit.start);
        range.setEnd(endHit.node, Math.min(rawEndInclusive + 1 - endHit.start, endHit.node.textContent.length));
        return range;
    } catch (_) { return null; }
}

function locateQuoteInBody(quote) {
    const range = rangeForQuote(quote);
    if (!range) return false;
    try {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        const el = range.startContainer.parentElement || $('.xr-article__body');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return true;
    } catch (_) { return false; }
}

/**
 * Jump from a claims-bar row to the claim's passage in the article
 * (Phase 14.5 hardening — the stored quote makes this reliable for
 * LLM-suggested claims, whose `text` is a summary that never appears
 * in the body). Cascade: the rehydrated mark (anchor-precise) →
 * select the stored verbatim quote → the claim text itself (manual
 * claims often quote it verbatim).
 */
function locateClaimInBody(claim) {
    const body = $('.xr-article__body');
    if (!body || !claim) return;
    let mark = null;
    try { mark = body.querySelector(`.xr-claim[data-claim-id="${CSS.escape(claim.id)}"]`); }
    catch (_) { /* CSS.escape unavailable — fall through to text search */ }
    if (mark) {
        mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
        mark.classList.add('xr-claim--flash');
        setTimeout(() => mark.classList.remove('xr-claim--flash'), 1600);
        return;
    }
    const quote = String(claim.quote || exactFromAnchor(claim.anchor) || '').trim();
    if (quote && locateQuoteInBody(quote)) return;
    if (locateQuoteInBody(claim.text)) return;
    toast('Could not locate this claim’s passage — the body may have been edited since capture.', 'error', 3500);
}

function renderModuleRow(r, staleSet) {
    const quotes = (r.evidence_quotes || []).map((q) => q && q.quote).filter(Boolean);
    const caveats = r.auditor_caveats || [];
    const stale = staleSet.has(r.module);
    return `
      <details class="xr-audit__module">
        <summary>
          <span class="xr-audit__module-name">${escapeHtml(prettyModule(r.module))}</span>
          <span class="xr-audit__module-version" title="methodology version">v${escapeHtml(r.module_version || '?')}</span>
          ${stale ? '<span class="xr-audit__chip xr-audit__chip--stale">newer methodology available — re-audit offered</span>' : ''}
          ${r.module === 'prediction_extraction'
        ? '<span class="xr-audit__chip" title="not a scored dimension — feeds the ledger">unscored</span>'
        : scoreChipHtml(r.score, r.confidence)}
        </summary>
        <div class="xr-audit__module-body">
          <div class="xr-audit__provenance">auditor: ${escapeHtml(r.auditor ? `${r.auditor.kind} · ${r.auditor.id}` : 'unknown')} · run ${escapeHtml(r.run_at || '')}</div>
          ${caveats.length ? `<div class="xr-audit__caveats"><strong>Caveats</strong> — what this scan could not determine:<ul>${caveats.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul></div>` : ''}
          ${quotes.length ? `<div class="xr-audit__quotes"><strong>Evidence quotes</strong> (click to locate):<ul>${quotes.map((q) => `<li><button type="button" class="xr-audit__quote" data-quote="${escapeHtml(q)}">“${escapeHtml(q.length > 120 ? q.slice(0, 120) + '…' : q)}”</button></li>`).join('')}</ul></div>` : ''}
        </div>
      </details>`;
}

function renderPredictionRow(p) {
    const promoted = p.claim_ref && p.claim_ref.claim_id;
    return `
      <li class="xr-audit__prediction" data-pred-id="${escapeHtml(p.id)}">
        <div class="xr-audit__prediction-text">${escapeHtml(p.text)}</div>
        <div class="xr-audit__prediction-meta">
          <span class="xr-audit__chip">${escapeHtml(p.type)}</span>
          <span class="xr-audit__chip xr-audit__chip--hedge-${escapeHtml(p.hedge_level)}">${escapeHtml(p.hedge_level)}</span>
          <span class="xr-audit__chip">${escapeHtml(p.tractability)}</span>
          <span class="xr-audit__prediction-horizon">horizon: ${escapeHtml(p.horizon || 'unscheduled')}</span>
          ${promoted
        ? '<span class="xr-audit__chip xr-audit__chip--claimed" title="atomized into a kind-30040 claim">claim ✓</span>'
        : `<button type="button" class="xr-reader__btn xr-reader__btn--ghost xr-audit__atomize" data-pred-id="${escapeHtml(p.id)}">Atomize as claim…</button>`}
        </div>
        <div class="xr-audit__prediction-criteria" title="resolution criteria">resolves when: ${escapeHtml(p.criteria || '—')}</div>
      </li>`;
}

// Full panel render. Keyed strictly to the CURRENT capture hash; runs
// anchored to retained prior versions surface as a re-audit offer,
// never as scores for text they didn't score.
async function refreshAuditStatus() {
    const statusEl = $('#xr-audit-status');
    const bodyEl = $('#xr-audit-body');
    if (!statusEl || !bodyEl) return;
    if (!state.articleHash) {
        statusEl.textContent = 'No capture hash for this view — audits key on the exact text.';
        bodyEl.innerHTML = '';
        return;
    }

    // Over-limit captures: an in-reader run scores (and its import gate
    // verifies) only the first MAX_AUDIT_INPUT_CHARS, so it — and its
    // extracted predictions — persist under the SLICED text's hash.
    // Same capture, partial coverage: surface both here WITH the
    // coverage caveat, never silently. The four reads are independent;
    // one await instead of four (this repaints on every audit action).
    const truncKey = (state.auditableHash && state.auditableHash !== state.articleHash)
        ? state.auditableHash : null;
    const [directRuns, truncRuns, directPreds, truncPreds] = await Promise.all([
        AuditRunModel.getByArticleHash(state.articleHash),
        truncKey ? AuditRunModel.getByArticleHash(truncKey) : [],
        PredictionModel.getByArticleHash(state.articleHash),
        truncKey ? PredictionModel.getByArticleHash(truncKey) : []
    ]);
    const runs = directRuns.concat(truncRuns.map((r) => ({ ...r, _truncatedKey: true })));
    const predictions = directPreds.concat(truncPreds);

    if (!runs.length) {
        statusEl.textContent = 'No audit imported for this capture.';
        // Re-audit affordance: audits may anchor to a RETAINED PRIOR
        // version of this URL's text (13.4 retention).
        let priorNote = '';
        try {
            const record = state.article && state.article.url
                ? await ArchiveCache.getArticle(state.article.url) : null;
            const priorHashes = ((record && record.priorVersions) || [])
                .map((v) => v.articleHash).filter(Boolean);
            let priorRuns = 0;
            for (const h of priorHashes) {
                priorRuns += (await AuditRunModel.getByArticleHash(h)).length;
            }
            if (priorRuns > 0) {
                priorNote = `<div class="xr-audit__prior-note">⚠️ ${priorRuns} audit run${priorRuns === 1 ? '' : 's'} anchor to a <em>previous version</em> of this text. Scores never transfer across edits — re-run the scorer CLI against the current capture and import the result (re-audit).</div>`;
            }
        } catch (_) { /* advisory only */ }
        // Legacy PDF orphans: before the hash unification (JOURNAL
        // 2026-07-09), in-reader runs on PDFs persisted under the
        // turndown-round-trip hash of the derived HTML, not the
        // reconstruction hash this panel keys on. Advisory only —
        // different bytes, so those scores never render here.
        let legacyNote = '';
        try {
            if (state.article && state.article.contentType === 'pdf' && state.article.markdown) {
                // The legacy key is a full-body SHA — compute it once
                // per adopted article, not on every repaint.
                if (state._legacyPdfHash === undefined) {
                    state._legacyPdfHash = await canonicalArticleHash(
                        EventBuilder.assembleArticleBody(state.article)) || null;
                }
                const legacyHash = state._legacyPdfHash;
                if (legacyHash && legacyHash !== state.articleHash) {
                    const legacyRuns = await AuditRunModel.getByArticleHash(legacyHash);
                    if (legacyRuns.length > 0) {
                        legacyNote = `<div class="xr-audit__prior-note">⚠️ ${legacyRuns.length} audit run${legacyRuns.length === 1 ? '' : 's'} from an earlier X-Ray version keyed to a different rendering of this PDF. Scores never transfer across text variants — re-run the audit to key it to the current capture.</div>`;
                    }
                }
            }
        } catch (_) { /* advisory only */ }
        // A saved thorough draft means paid-for modules are waiting.
        let draftNote = '';
        try {
            const draft = await loadAuditDraft(state.auditableHash || state.articleHash);
            const done = draft ? Object.keys(draft.modules || {}).length : 0;
            if (done > 0) {
                draftNote = `<div class="xr-audit__prior-note">💾 A thorough audit draft holds ${done}/${MODULE_NAMES.length} completed module${done === 1 ? '' : 's'} for this text — run "Thorough audit" to resume (only the missing modules re-run).</div>`;
            }
        } catch (_) { /* advisory only */ }
        bodyEl.innerHTML = priorNote + legacyNote + draftNote;
        return;
    }

    const sorted = runs.slice().sort((a, b) => String(b.runAt).localeCompare(String(a.runAt)));
    const latest = sorted[0];
    const others = sorted.slice(1);
    const agg = latest.aggregate || {};
    const score = typeof agg.final_score === 'number' ? agg.final_score : null;
    const conf = typeof agg.overall_confidence === 'number' ? agg.overall_confidence : null;

    // An edited body is no longer the text these runs scored —
    // "for this exact text" would be score transfer across an edit,
    // the exact display rule the hash exists to enforce.
    statusEl.textContent = state.hashDirty
        ? `${runs.length} audit run${runs.length === 1 ? '' : 's'} for the CAPTURED text — the body has been edited; scores never transfer across edits (re-keyed at publish).`
        : `${runs.length} audit run${runs.length === 1 ? '' : 's'} for this exact text.`;

    // Badge per the display rules. A sub-0.6 confidence never renders
    // a number, band color included — review-needed is the whole badge.
    let badge;
    if (score === null) {
        badge = '<div class="xr-audit__badge xr-audit__badge--none">no aggregate score</div>';
    } else if (conf !== null && conf < 0.6) {
        badge = '<div class="xr-audit__badge xr-audit__badge--review">needs human review<span class="xr-audit__badge-sub">aggregate confidence ' + escapeHtml(String(conf)) + ' — below 0.6</span></div>';
    } else {
        const band = auditBand(score);
        const ceilingLine = agg.ceiling_binding
            ? `<span class="xr-audit__badge-sub">capped by knowability ${escapeHtml(String(agg.knowability_ceiling))}${agg.knowability_notes ? ' — ' + escapeHtml(agg.knowability_notes) : ''}</span>`
            : '';
        badge = `<div class="xr-audit__badge xr-audit__badge--${band.key}" title="${escapeHtml(band.label)}">` +
            `${escapeHtml(String(score))}<span class="xr-audit__badge-conf">conf ${escapeHtml(String(conf))}</span>` +
            `<span class="xr-audit__badge-band">${escapeHtml(band.label)}</span>${ceilingLine}</div>`;
    }

    const provenance = `<div class="xr-audit__provenance">auditor: ${escapeHtml(latest.auditor ? `${latest.auditor.kind} · ${latest.auditor.id}` : 'unknown')} · run ${escapeHtml(latest.runAt)} · ceiling source: ${escapeHtml(agg.ceiling_source || 'unknown')} · imported via ${escapeHtml(latest.source)}</div>`;

    // Truncated-key coverage caveat: this run scored (and its hash gate
    // verified) only the auditable slice of an over-limit capture.
    const truncNote = latest._truncatedKey
        ? `<div class="xr-audit__prior-note">⚠️ This run scored the first ${MAX_AUDIT_INPUT_CHARS.toLocaleString()} of ${Number(state.auditableTotalChars || 0).toLocaleString()} characters of this capture — text beyond that bound was never seen by the auditor.</div>`
        : '';

    const staleSet = new Set(staleModules(latest, CURRENT_MODULE_VERSIONS).map((s) => s.module));
    const moduleRows = (latest.moduleResults || []).map((r) => renderModuleRow(r, staleSet)).join('');

    const predBlock = predictions.length
        ? `<div class="xr-audit__predictions"><h3 class="xr-audit__h">Prediction ledger (${predictions.length})</h3><ul>${predictions.map(renderPredictionRow).join('')}</ul></div>`
        : '';

    // Disagreement is data: other runs render side-by-side, never
    // averaged into the badge.
    const othersBlock = others.length
        ? `<div class="xr-audit__others"><h3 class="xr-audit__h">Other runs (side-by-side — never averaged)</h3><ul>${others.map((r) => {
            const a = r.aggregate || {};
            const s = typeof a.final_score === 'number' ? a.final_score : null;
            const c = typeof a.overall_confidence === 'number' ? a.overall_confidence : null;
            return `<li>${scoreChipHtml(s, c)} — ${escapeHtml(r.auditor ? r.auditor.id : 'unknown')} · ${escapeHtml(r.runAt)}${r._truncatedKey ? ` · first ${MAX_AUDIT_INPUT_CHARS.toLocaleString()} chars only` : ''}</li>`;
        }).join('')}</ul></div>`
        : '';

    bodyEl.innerHTML = `
      ${badge}
      ${provenance}
      ${truncNote}
      <div class="xr-audit__modules">${moduleRows}</div>
      ${predBlock}
      ${othersBlock}`;

    // Wire quote-locate + atomize offers.
    bodyEl.querySelectorAll('.xr-audit__quote').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (!locateQuoteInBody(btn.dataset.quote)) {
                toast('Quote not found in the current text — the body may have been edited.', 'warning', 4000);
            }
        });
    });
    bodyEl.querySelectorAll('.xr-audit__atomize').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const pred = predictions.find((p) => p.id === btn.dataset.predId);
            if (!pred) return;
            // RQ6: offered action, never automatic — the ordinary claim
            // pipeline with the user confirming. The promoted claim and
            // the prediction link both ways.
            const saved = await openClaimModal({
                sourceUrl:    state.article.url,
                initialText:  pred.text,
                context:      pred.evidence_quote || '',
                anchor:       pred.anchor || null,
                quote:        pred.evidence_quote || null,
                articleHash:  claimArticleHash(),
                initialAbout: state.lastClaimAbout || [],
                // 22.3: on a transcript, the predicate's evidence quote
                // sits inside a turn — prefill that turn's speaker, not
                // the host/byline.
                defaultSource: (await resolveTranscriptSpeakerForQuote(pred.evidence_quote))
                    || (await resolveDefaultSpeaker())
            });
            if (saved) {
                await PredictionModel.setClaimRef(pred.id, {
                    claim_id: saved.id,
                    pred_d: 'pred:' + pred.id.slice('pred_'.length)
                });
                // Idempotent create may have returned an EXISTING,
                // already-published claim — which the publish filter
                // (updated > publishedAt) would skip, so the new
                // back-reference would never reach the wire. Promotion
                // changes the published event (it gains the a tag):
                // that IS an edit — bump so it re-emits.
                if (saved.publishedAt && !(saved.updated > saved.publishedAt)) {
                    try { await ClaimModel.update(saved.id, {}); }
                    catch (err) { console.warn('[X-Ray Reader] claim bump failed:', err); }
                }
                toast('Claim saved — it will back-reference this prediction at publish.', 'success', 4000);
                await refreshClaimsBar();
                await refreshAuditStatus();
            }
        });
    });
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

/**
 * Extraction-quality banner (Phase 18 C4.1) — surfaces the layout
 * engine's warnings on PDF captures: sparse (likely scanned) pages
 * whose content is missing, and pages where line→paragraph merging
 * failed. "Degrade, never drop" needs this honesty layer: a shaky
 * extraction presented as clean is a provenance failure.
 */
function renderExtractionWarningsBanner() {
    const extraction = state.article && state.article.extraction;
    const warnings = extraction && extraction.warnings;
    const method = String((extraction && extraction.method) || '');
    const transcribed = /^llm:/.test(method);
    const reconstructed = /\+llm:/.test(method);
    if ((!Array.isArray(warnings) || warnings.length === 0) && !transcribed && !reconstructed) {
        // Re-rendered after a body swap (Load archive): a banner from
        // the PREVIOUS article must not survive an adoption with
        // nothing to disclose.
        const stale = $('#xr-extract-banner');
        if (stale) stale.remove();
        return;
    }
    let banner = $('#xr-extract-banner');
    if (!banner) {
        banner = document.createElement('aside');
        banner.id = 'xr-extract-banner';
        banner.className = 'xr-hash-banner';
        const main = $('#xr-main');
        if (!main || !main.parentElement) return;
        main.parentElement.insertBefore(banner, main);
    }
    // C5's scans clause: a machine-transcribed capture is ALWAYS
    // bannered — the method is the marker, not a warning entry, so a
    // relay copy that round-trips only extraction-method still banners.
    if (transcribed) {
        banner.innerHTML = `
          <div class="xr-hash-banner__body">
            <div class="xr-hash-banner__label">🤖 Machine-transcribed from a scanned document</div>
            <div class="xr-hash-banner__metric">This text was transcribed by ${escapeHtml(String(extraction.method).slice(4))} — it is not a deterministic text-layer extraction. Verify quotes against the archived original before relying on them.</div>
            <div class="xr-hash-banner__metric">${extraction.archived
                ? `The original PDF is archived (source_hash ${escapeHtml(String(extraction.source_hash || '').slice(0, 12))}…).`
                : `Original source_hash ${escapeHtml(String(extraction.source_hash || '').slice(0, 12))}… — keep your own copy of the document for verification.`}</div>
          </div>
          <div class="xr-hash-banner__actions">
            <button type="button" class="xr-reader__btn xr-reader__btn--ghost" id="xr-extract-dismiss">Dismiss</button>
          </div>
        `;
        $('#xr-extract-dismiss').addEventListener('click', () => banner.remove());
        return;
    }
    // Structure-reconstructed (method 'pdfjs-…+llm:…'): the text spans
    // are substrate bytes, but the STRUCTURE — reading order, heading
    // levels, and especially table row/column association — is the
    // model's reading and was never machine-verified. Disclosed
    // persistently (a toast is not provenance), and on relay read-back
    // too: the method tag round-trips, so this banner renders on a
    // Load-archive copy as well. No Reconstruct button here — the body
    // is no longer the deterministic substrate.
    if (reconstructed) {
        const model = method.slice(method.indexOf('+llm:') + 5);
        const dropped = Number(extraction.unverified_spans) || 0;
        const tables = Number(extraction.llm_tables) || 0;
        banner.innerHTML = `
          <div class="xr-hash-banner__body">
            <div class="xr-hash-banner__label">🤖 Structure reconstructed by ${escapeHtml(model)}</div>
            <div class="xr-hash-banner__metric">Text spans are the document's own extracted bytes; the layout${tables > 0 ? ` and ${tables} table${tables === 1 ? '' : 's'}` : ''} ${tables > 0 ? 'are' : 'is'} the model's reading — verify table associations against the archived original.</div>
            ${dropped > 0 ? `<div class="xr-hash-banner__metric">${dropped} span${dropped === 1 ? '' : 's'} could not be verified against the document text and ${dropped === 1 ? 'was' : 'were'} discarded.</div>` : ''}
            <div class="xr-hash-banner__metric">${extraction.archived
                ? `The original PDF is archived (source_hash ${escapeHtml(String(extraction.source_hash || '').slice(0, 12))}…).`
                : `Original source_hash ${escapeHtml(String(extraction.source_hash || '').slice(0, 12))}… — keep your own copy of the document for verification.`}</div>
          </div>
          <div class="xr-hash-banner__actions">
            <button type="button" class="xr-reader__btn xr-reader__btn--ghost" id="xr-extract-dismiss">Dismiss</button>
          </div>
        `;
        $('#xr-extract-dismiss').addEventListener('click', () => banner.remove());
        return;
    }
    // Warned deterministic extraction: quality notes + the C5
    // structure-assist offer (explicit action, never automatic). The
    // button needs the archived bytes — without them there is nothing
    // to send.
    const canReconstruct = !!(extraction.archived && extraction.source_hash);
    banner.innerHTML = `
      <div class="xr-hash-banner__body">
        <div class="xr-hash-banner__label">⚠️ Extraction quality warning${warnings.length > 1 ? 's' : ''}</div>
        ${warnings.map((w) => `<div class="xr-hash-banner__metric">${escapeHtml(w.message)}</div>`).join('')}
        <div class="xr-hash-banner__metric">${extraction.archived
            ? `The original PDF is archived (source_hash ${escapeHtml(String(extraction.source_hash || '').slice(0, 12))}…) — verify against it before relying on affected passages.`
            : `The original PDF could NOT be archived (too large or storage full) — keep your own copy to verify affected passages against (source_hash ${escapeHtml(String(extraction.source_hash || '').slice(0, 12))}…).`}</div>
      </div>
      <div class="xr-hash-banner__actions">
        ${canReconstruct ? '<button type="button" class="xr-reader__btn" id="xr-extract-llm">Reconstruct with LLM…</button>' : ''}
        <button type="button" class="xr-reader__btn xr-reader__btn--ghost" id="xr-extract-dismiss">Dismiss</button>
      </div>
    `;
    $('#xr-extract-dismiss').addEventListener('click', () => banner.remove());
    const llmBtn = $('#xr-extract-llm');
    if (llmBtn) {
        llmBtn.addEventListener('click', () => {
            llmBtn.disabled = true;
            reconstructWithLlmFlow()
                .catch((err) => toast((err && err.message) || 'LLM reconstruction failed.', 'error', 6000))
                .finally(() => { llmBtn.disabled = false; });
        });
    }
}

/**
 * Phase 18 C5 — the structure-assist flow (text layer EXISTS, layout
 * scrambled). The model returns structure; every span re-grounds
 * against the deterministic substrate and re-canonicalizes to its
 * bytes — dropped spans are counted and disclosed. The stored capture
 * never contains model-authored body text.
 */
async function reconstructWithLlmFlow() {
    const a = state.article;
    const extraction = a && a.extraction;
    if (!extraction || !extraction.source_hash) throw new Error('No archived source document for this capture.');
    const substrate = a.markdown || '';
    if (!substrate.trim()) throw new Error('No deterministic text to ground against.');

    // Pending edits make the substrate ambiguous — a.markdown lags the
    // drafts, so grounding against it would silently discard what the
    // user typed and then overwrite it. Refuse; publish or revert first.
    if (state.hashDirty || (state.dirtySource === 'markdown'
            && state.markdownDraft && state.markdownDraft !== substrate)) {
        throw new Error('You have unsaved edits — publish (or reload) before reconstructing, so they are not silently discarded.');
    }

    await requireLlmReady();
    if (Number(extraction.page_count) > MAX_EXTRACT_PAGES) {
        throw new Error(`This PDF has ${extraction.page_count} pages — over the ${MAX_EXTRACT_PAGES}-page single-request limit for LLM extraction.`);
    }

    const consented = await confirmLlmSend(
        'Reconstruct this PDF with the LLM?',
        `The archived PDF (${extraction.page_count || '?'} pages) will be sent to the `
        + 'Anthropic API under your API key — the document leaves this device. The model '
        + 'proposes STRUCTURE only: every text span is matched back against the extracted '
        + 'text and replaced with the document’s own bytes; spans that fail the match are '
        + 'discarded and counted. Your current capture is kept if the reconstruction is empty.',
        'Reconstruct with LLM');
    if (!consented) return;

    toast('Reconstructing with the LLM — this can take a few minutes…', 'warning', 8000);
    const resp = await browserApi.runtime.sendMessage({
        type: 'xray:llm:extract',
        sourceHash: extraction.source_hash,
        mode: 'structure',
        pageCount: extraction.page_count || 0
    });
    if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'LLM reconstruction failed.');

    // The pass runs for minutes; the user may have edited or published
    // meanwhile. Adopting over their changes would silently discard
    // them — abort instead (their state wins, the API cost is sunk).
    if (a !== state.article || a.markdown !== substrate || state.hashDirty) {
        throw new Error('The capture changed while the reconstruction was running — keeping your version. Run it again from a settled state.');
    }

    const assembled = assembleExtraction(resp.spans, substrate, { mode: 'structure' });
    if (!assembled.markdown.trim()) {
        throw new Error(`Nothing survived re-grounding (${assembled.unverified_spans} of ${assembled.total_spans} spans failed verification) — keeping the deterministic capture.`);
    }

    // Adopt: the reconstructed markdown IS the new canonical body
    // (markdown-canonical, like every PDF capture). The body changed,
    // so the canonical hash changes with it — honest versioning, same
    // rule as the transcript attach.
    a.markdown = assembled.markdown;
    a.content = ContentExtractor.markdownToHtml(assembled.markdown);
    // The old pageMap indexed the OLD markdown — against the new body
    // its offsets stamp WRONG page numbers into published claim
    // anchors. The model's page hints are the only map that indexes
    // this text; without them there is honestly no page map.
    if (assembled.pageMap && assembled.pageMap.length) {
        a.pageMap = assembled.pageMap;
    } else {
        delete a.pageMap;
    }
    a.extraction = {
        ...extraction,
        method: extractionMethod(extraction.method, resp.model, 'structure'),
        unverified_spans: assembled.unverified_spans,
        // Local-only (never on the wire): drives the structure-mode
        // disclosure — table layout is the model's reading.
        llm_tables: assembled.table_count
    };
    state.markdownDraft = a.markdown;
    state.htmlDraft = a.content;
    state.dirtySource = 'markdown';

    try {
        const fullBody = EventBuilder.assembleArticleBody(hashableArticle(a));
        const fullHash = await canonicalArticleHash(fullBody);
        // Both audit keys move with the body — leaving auditableHash
        // stale made prior audit runs claim they scored "this capture".
        const slice = auditableSlice(fullBody);
        state.articleHash = fullHash;
        state.auditableTotalChars = slice.totalChars;
        state.auditableHash = slice.truncated
            ? await canonicalArticleHash(slice.text) : fullHash;
        state.hashDirty = false;
        updateHashLine();
        refreshAuditStatus().catch(() => { /* display refresh only */ });
    } catch (err) {
        console.warn('[X-Ray Reader] post-reconstruction hash failed:', err);
    }
    if (!(state.readOnlyOpen)) {
        ArchiveCache.saveArticle({
            article: state.articleHash ? { ...a, _articleHash: state.articleHash } : a,
            source: 'capture'
        }).catch((err) => console.warn('[X-Ray Reader] archive save failed:', err));
    }
    renderReader();
    // Replace the stale warnings banner with the structure-mode
    // disclosure. Deliberately NO second Reconstruct button: the body
    // is no longer the deterministic substrate, so another pass would
    // ground against a reconstruction — semantically meaningless.
    renderExtractionWarningsBanner();
    const dropped = assembled.unverified_spans;
    // Never claim "verified" over a table: cell TEXT re-grounds to
    // document bytes, but row/column association is the model's
    // reading and cannot be machine-checked (adversarial-review fix).
    const tableNote = assembled.table_count > 0
        ? ` Text matched to the document's own bytes; table structure (${assembled.table_count}) is the model's reading — verify against the original.`
        : '';
    toast(dropped > 0
        ? `Reconstructed with ${resp.model} — ${dropped} of ${assembled.total_spans} spans could not be verified and were discarded.${tableNote}`
        : `Reconstructed with ${resp.model} — ${assembled.total_spans} text spans matched to the document text.${tableNote}`,
    dropped > 0 ? 'warning' : 'success', 10000);
}

// Archive/mirror provenance note (url-identity.js). Two honest states:
// original recovered → identity is the original, the mirror address is
// provenance; not recovered → identity stays with the archive address
// and the note says so plainly. Ordinary captures render nothing.
function renderArchiveNote(a) {
    if (!a) return '';
    const setBtn = '<button type="button" class="xr-capture-note__set" id="xr-set-original">Set original URL…</button>';
    if (a.capture_url && a.capture_url !== a.url) {
        // archive_host is local-only (relay read-back carries just the
        // capture-url tag) — derive the host the same way url-identity
        // does rather than a divergent regex.
        let host = a.archive_host;
        if (!host) {
            try { host = new URL(a.capture_url).hostname.replace(/^www\./, ''); }
            catch (_) { host = 'archive'; }
        }
        return `<div class="xr-article__capture-note" title="fetched from ${escapeHtml(a.capture_url)}">captured via ${escapeHtml(host)} · original: ${escapeHtml(a.url || '')} ${setBtn}</div>`;
    }
    if (a.archive_host) {
        return `<div class="xr-article__capture-note xr-article__capture-note--warn">captured via ${escapeHtml(a.archive_host)} — original URL not recovered; this capture keys to the archive address ${setBtn}</div>`;
    }
    return '';
}

/**
 * Manual identity repair — the universal fallback for any mirror or
 * alias-serving site the structural resolver doesn't know. Sets the
 * article's identity URL, keeps the fetched address as capture-url
 * provenance, records the alias observation(s) so URL-keyed joins
 * heal, persists the archive row under the new identity, and re-runs
 * the URL-keyed panels. Returns true when the identity changed.
 */
async function applyManualOriginalUrl(rawUrl) {
    const trimmed = String(rawUrl || '').trim();
    let parsed = null;
    try { parsed = new URL(trimmed); } catch (_) { /* invalid — handled below */ }
    if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
        toast('Not set — enter a full http(s) URL', 'warning');
        return false;
    }
    const oldUrl = state.article.url;
    if (trimmed === oldUrl) return false;

    // The address actually fetched stays as provenance: prefer the
    // existing capture_url (the true fetch address), else the old
    // identity this capture keyed to until now.
    const fetchedFrom = state.article.capture_url || oldUrl;
    if (fetchedFrom && fetchedFrom !== trimmed) {
        state.article.capture_url = fetchedFrom;
        if (!state.article.archive_host) {
            try { state.article.archive_host = new URL(fetchedFrom).hostname.replace(/^www\./, ''); }
            catch (_) { /* cosmetic only */ }
        }
    }
    state.article.url = trimmed;
    try { state.article.domain = parsed.hostname.replace(/^www\./, ''); } catch (_) { /* keep prior */ }

    // Both observations: the fetched address AND the old identity are
    // aliases of the new original.
    recordAlias(fetchedFrom, trimmed).catch(() => {});
    if (oldUrl && oldUrl !== fetchedFrom) recordAlias(oldUrl, trimmed).catch(() => {});

    if (!state.readOnlyOpen) {
        ArchiveCache.saveArticle({
            article: state.articleHash
                ? { ...state.article, _articleHash: state.articleHash }
                : state.article,
            source: 'capture'
        }).catch((err) => console.warn('[X-Ray Reader] archive save failed:', err));
    }
    renderReader();
    refreshClaimsBar().catch(() => {});
    checkArchiveAvailability().catch(() => {});
    toast('Original URL set — claims, archive, and audits now key to it', 'success', 2500);
    return true;
}

async function setOriginalUrlFlow() {
    const entered = prompt(
        'Original URL for this capture\n\n' +
        'Claims, assessments, audits, and the local archive key to this ' +
        'URL. The address actually fetched is kept as provenance.',
        (state.article && state.article.url) || 'https://');
    if (entered === null) return;
    await applyManualOriginalUrl(entered);
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
          ${renderArchiveNote(a)}
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

    // Archived PDF figures (C4.2): swap content-addressed
    // xray-figure: srcs for live blob URLs from the byte archive.
    hydrateFigureImages(body)
        .catch((err) => console.warn('[X-Ray Reader] figure hydrate failed:', err));

    // Mount the entity tagger on the article body. Its onTag callback
    // pushes the resolved ref onto the article's entity list and marks
    // state as dirty so the publish path picks it up. The onClaim
    // callback hands off to the claim extractor — opens the claim
    // modal with the selected text + surrounding paragraph pre-filled.
    if (state._taggerUninstall) state._taggerUninstall();
    state._taggerUninstall = installEntityTagger({
        container: body,
        // Phase 19.5: the "Add fact" row is gated behind `readerAddFact`
        // (default off). The flag cache is primed in init() before the
        // first renderReader(), so this synchronous read is accurate.
        showFactButton: isEnabled('readerAddFact'),
        onTag: (ref) => {
            // De-dup: same entity_id + context → ignore. Avoids accidental
            // double-tagging when the user re-selects the same text.
            const dup = state.article.entities.find(
                (e) => e.entity_id === ref.entity_id && e.context === ref.context
            );
            if (!dup) state.article.entities.push(ref);
            // Sync htmlDraft with whatever the mark wrap did to the body.
            state.htmlDraft = body.innerHTML;
            // Tag wraps are text-neutral (a span around existing text).
            // For markdown-canonical captures (PDF, transcript) the
            // markdown draft stays canonical — flipping to 'reader' here
            // would force the destructive turndown round trip at publish
            // for zero wire benefit (spans don't survive it anyway).
            if (!isMarkdownCanonical(state.article)) state.dirtySource = 'reader';
            refreshEntitiesBar().catch(() => {});
            scheduleTagSave();
        },
        onClaim: async ({ text, context, anchor, quoteMode, factMode }) => {
            // PDF captures: page-level provenance rides as an additive
            // FragmentSelector (resolvers that don't know it skip it).
            const page = pdfPageOfQuote(text);
            const saved = await openClaimModal({
                sourceUrl:   state.article.url,
                initialText: text,
                context,
                anchor: page ? [...(anchor || []), pageFragmentSelector(page)] : anchor,
                // Text provenance: the selection IS the verbatim quote.
                quote:       text,
                articleHash: claimArticleHash(),
                // Sticky default (Phase 11.3): a case-capture session tags
                // dozens of claims with the same case entity + people.
                initialAbout: factMode ? [] : (state.lastClaimAbout || []),
                // "❝ Quote" shortcut: same record, quote-framed modal
                // with the speaker picker front-and-center.
                quoteMode:    !!quoteMode,
                // "📇 Add fact" (19.5): the same record carrying a
                // structured fact layer; the selection grounds it.
                factMode:     !!factMode,
                // The asserter is usually the article's author — default
                // the speaker to the author entity (or offer its create).
                // For a transcript, prefer the SELECTION's turn speaker
                // (21.2) over the article-level byline.
                defaultSource: (await resolveTranscriptSpeaker(context)) || (await resolveDefaultSpeaker())
            });
            if (saved) {
                if (!factMode) state.lastClaimAbout = saved.about || [];
                toast(factMode ? 'Fact saved' : quoteMode ? 'Quote saved' : 'Claim saved', 'success', 2000);
                await refreshClaimsBar();
            }
        },
        onFinding: async ({ text, anchor }) => {
            // Open the finding modal seeded with the selected span as the
            // first evidence anchor — the discoverable path to naming a
            // maneuver (the "+ Finding" bar button is the other).
            const result = await openFindingModal({
                subjectChoices: subjectChoicesFromArticle(),
                anchorContext:  { container: $('.xr-article__body') },
                seedAnchor:     { quote: text, selector: anchor },
                sourceRef:      { url: state.article.url, title: state.article.title || '' }
            });
            if (result) {
                toast(result.deleted ? 'Finding removed' : 'Finding saved', 'success', 1500);
                await refreshFindingsBar();
            }
        }
    });

    // Render the claims bar below the article body. Fires in the
    // background — we don't block the main render on it.
    refreshClaimsBar().catch((err) => console.warn('[X-Ray Reader] claims-bar render failed:', err));
    refreshEntitiesBar().catch((err) => console.warn('[X-Ray Reader] entities-bar render failed:', err));
    refreshFindingsBar().catch((err) => console.warn('[X-Ray Reader] findings-bar render failed:', err));

    // Re-fill the hash line — the template above recreates it hidden,
    // and the hash (computed async at load) may already be known.
    updateHashLine();

    // Wire metadata-field edits back to the article object.
    main.querySelectorAll('[contenteditable]').forEach((el) => {
        el.addEventListener('input', onReaderFieldInput);
        el.addEventListener('blur', onReaderFieldBlur);
    });

    // The capture note's manual identity repair (renderArchiveNote).
    const setOriginal = $('#xr-set-original');
    if (setOriginal) {
        setOriginal.addEventListener('click', () =>
            setOriginalUrlFlow().catch((err) =>
                console.warn('[X-Ray Reader] set-original failed:', err)));
    }
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
/**
 * Entities bar — the tagged-entities summary (userscript parity).
 * Chips resolve fresh registry records; clicking one locates the
 * entity's mention in the body (mark → verbatim mention text).
 */
async function refreshEntitiesBar() {
    const host = $('#xr-entities-host');
    if (!host) return;
    const refs = (state.article && state.article.entities) || [];
    try {
        host.innerHTML = await renderEntitiesBar(refs);
    } catch (err) {
        console.warn('[X-Ray Reader] entities-bar render failed:', err);
        return;
    }
    host.querySelectorAll('.xr-entities__chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            const ref = refs.find((r) => r && r.entity_id === chip.dataset.entityId);
            if (ref) locateEntityInBody(ref);
        });
    });
}

function locateEntityInBody(ref) {
    const body = $('.xr-article__body');
    if (!body || !ref) return;
    let mark = null;
    try { mark = body.querySelector(`.xr-entity[data-entity-id="${CSS.escape(ref.entity_id)}"]`); }
    catch (_) { /* fall through to text search */ }
    if (mark) {
        mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
        mark.classList.add('xr-entity--flash');
        setTimeout(() => mark.classList.remove('xr-entity--flash'), 1600);
        return;
    }
    const mention = String(ref.context || '').trim();
    if (mention && locateQuoteInBody(mention)) return;
    if (ref.name && locateQuoteInBody(ref.name)) return;
    toast('Could not locate this entity’s mention — the body may have been edited since tagging.', 'error', 3500);
}

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

    // Integrity finding authoring (15.10) — word-vs-deed matches over
    // the adjudicated propositions; the modal collects candidates itself.
    const integrityBtn = host.querySelector('#xr-claims-integrity');
    if (integrityBtn) {
        integrityBtn.addEventListener('click', async () => {
            const finding = await openIntegrityModal();
            if (finding) {
                toast(`Integrity match ruled: ${finding.match}${finding.supersedes ? ' (supersedes prior finding)' : ''}`, 'success', 2000);
            }
        });
    }

    // Wire per-row actions.
    host.querySelectorAll('.xr-claims__item').forEach((row) => {
        const id = row.dataset.id;
        const editBtn   = row.querySelector('[data-action="edit"]');
        const delBtn    = row.querySelector('[data-action="delete"]');
        const linkBtn   = row.querySelector('[data-action="link"]');
        const assessBtn = row.querySelector('[data-action="assess"]');
        const adjBtn    = row.querySelector('[data-action="adjudicate"]');
        // Claim text + quote both jump to the passage in the article.
        row.querySelectorAll('[data-action="locate"]').forEach((el) => {
            el.addEventListener('click', () => {
                const claim = claims.find((c) => c.id === id);
                if (claim) locateClaimInBody(claim);
            });
        });
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
        if (adjBtn) adjBtn.addEventListener('click', async () => {
            const claim = claims.find((c) => c.id === id);
            const result = await openAdjudicateModal({
                claimId:     id,
                claimText:   claim ? claim.text : '',
                relays:      await getConfiguredRelays(),
                claimPubkey: (claim && claim.publishedPubkey) || null
            });
            if (result) {
                toast(result.verdict
                    ? `Ruled: ${result.verdict.verdict}${result.verdict.supersedes ? ' (supersedes prior ruling)' : ''}`
                    : 'Proposition saved', 'success', 2000);
                await refreshClaimsBar();
            }
        });

        // Per-link ✕ delete buttons.
        row.querySelectorAll('.xr-claims__link-del').forEach((btn) => {
            btn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                const linkId = btn.dataset.linkId;
                if (!linkId) return;
                if (!confirm('Remove this evidence link? Already-published link events stay on relays until NIP-09 delete (later phase).')) return;
                await EvidenceLinker.delete(linkId);
                toast('Link removed', 'success', 1500);
                await refreshClaimsBar();
            });
        });
    });
}

// ------------------------------------------------------------------
// Forensic findings bar (Phase 14.2)
// ------------------------------------------------------------------

/** Tagged entities on this article become the subject choices. */
function subjectChoicesFromArticle() {
    const seen = new Set();
    const choices = [];
    for (const e of (state.article && state.article.entities) || []) {
        if (!e.entity_id || seen.has(e.entity_id)) continue;
        seen.add(e.entity_id);
        choices.push({ key: e.entity_id, label: e.name || e.context || e.entity_id });
    }
    return choices;
}

/** The current article-body selection, as a seed anchor (quote + span). */
function captureSelectionSeed() {
    const body = $('.xr-article__body');
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    if (!body || !sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (range.collapsed || !body.contains(range.commonAncestorContainer)) return null;
    const quote = String(range.toString() || '').trim();
    if (!quote) return null;
    try {
        const captured = captureFromRange(range, body);
        return { quote, selector: captured ? captured.selectors : null };
    } catch (_) { return { quote, selector: null }; }
}

/**
 * Render the findings bar: findings whose evidence is anchored to this
 * article's URL (findings are keyed by subject, not URL, so we match on
 * the per-anchor source). Wires the capture affordances + row actions.
 */
async function refreshFindingsBar() {
    const host = $('#xr-findings-host');
    if (!host || !state.article || !state.article.url) return;

    const url = normalizeUrl(state.article.url);
    const all = await ForensicModel.getAll();
    const findings = Object.values(all)
        .filter((f) => (f.anchors || []).some((a) => a.source_ref && a.source_ref.url === url))
        .sort((a, b) => (a.created || 0) - (b.created || 0));
    host.innerHTML = renderFindingsBar(findings);

    const anchorContext  = { container: $('.xr-article__body') };
    const sourceRef      = { url: state.article.url, title: state.article.title || '' };
    const subjectChoices = subjectChoicesFromArticle();

    const addBtn = host.querySelector('#xr-findings-add');
    if (addBtn) addBtn.addEventListener('click', async () => {
        const seedAnchor = captureSelectionSeed();
        const result = await openFindingModal({ subjectChoices, anchorContext, seedAnchor, sourceRef });
        if (result) {
            toast(result.deleted ? 'Finding removed' : 'Finding saved', 'success', 1500);
            await refreshFindingsBar();
        }
    });

    const baseBtn = host.querySelector('#xr-findings-baseline');
    if (baseBtn) baseBtn.addEventListener('click', async () => {
        const result = await openBaselineModal({ subjectChoices, sourceRef });
        if (result) toast('Baseline saved', 'success', 1500);
    });

    host.querySelectorAll('.xr-findings__item').forEach((row) => {
        const id = row.dataset.id;
        const editBtn = row.querySelector('[data-action="edit"]');
        const delBtn  = row.querySelector('[data-action="delete"]');
        if (editBtn) editBtn.addEventListener('click', async () => {
            const existing = await ForensicModel.get(id);
            if (!existing) return;
            const result = await openFindingModal({ subjectChoices, anchorContext, existing, sourceRef });
            if (result) {
                toast(result.deleted ? 'Finding removed' : 'Finding saved', 'success', 1500);
                await refreshFindingsBar();
            }
        });
        if (delBtn) delBtn.addEventListener('click', async () => {
            if (!confirm('Delete this finding?')) return;
            await ForensicModel.delete(id);
            toast('Finding removed', 'success', 1500);
            await refreshFindingsBar();
        });
    });
}

// ------------------------------------------------------------------
// LLM assist (Phase 14.5) — Suggest control + review handoff
// ------------------------------------------------------------------

/**
 * The article body text we both send to the model and resolve quotes
 * against — same string, so the model's verbatim quotes anchor cleanly.
 */
function articleBodyText() {
    const body = $('.xr-article__body');
    const text = body ? (body.textContent || '') : '';
    return text.trim() ? text : (state.markdownDraft || '');
}

/**
 * The canonical article hash to stamp on claims as text provenance —
 * only while it still describes the current body (edits dirty it; the
 * publish flow recomputes from the final text).
 */
function claimArticleHash() {
    return (!state.hashDirty && state.articleHash) ? state.articleHash : null;
}

/**
 * Configure the Suggest control from the SW's gating snapshot. Absent
 * when the flag is off; visible-but-disabled when on with no key — so
 * either condition guarantees no network call is reachable from here.
 */
// ------------------------------------------------------------------
// Media & transcript (Phase 22 — URL-first media metadata)
// ------------------------------------------------------------------

// The URL is the identity: "podcast"/"video" is user-declared metadata
// on THIS capture, and a transcript attaches to it. The modal collects;
// this owns the consequences — the canonical-side branch, the body
// upsert, the hash recompute, and the archive save.
function setupMediaControl() {
    const btn = $('#xr-media-btn');
    if (!btn) return;
    if (state.readOnlyOpen) { btn.hidden = true; return; }
    btn.addEventListener('click', async () => {
        if (!state.article) return;
        const result = await openMediaModal(state.article);
        if (result) await applyMediaResult(result);
    });
}

async function applyMediaResult(result) {
    const a = state.article;
    if (!a) return;

    // User-declared media type + source type + the 21.3 podcast identity
    // block. All tag-side fields — assembleArticleBody never sees them.
    if (result.media) a.media = result.media; else delete a.media;
    if (result.sourceType) a.source_type = result.sourceType; else delete a.source_type;

    // Per-link evidence roles (23.1b) — the `link` tags carry the role,
    // so this is tag-side too (no body-hash change). An unset role
    // clears any prior one.
    if (result.linkRoles && Array.isArray(a.links)) {
        for (const link of a.links) {
            if (!link || !link.url) continue;
            const role = result.linkRoles[link.url];
            if (role) link.role = role; else delete link.role;
        }
    }
    if (result.podcast) {
        a.podcast = { ...result.podcast };
        // The capture URL is the episode address when it's a real one.
        if (/^https?:\/\//i.test(a.url || '')) a.podcast.episode_url = a.url;
    } else {
        delete a.podcast;
    }

    if (!result.parse) {
        // Metadata-only: the hash is untouched — persist the row and stop.
        scheduleTagSave();
        toast('Media metadata saved', 'success', 2000);
        return;
    }

    // ---- transcript attach -------------------------------------
    const parse = result.parse;
    const isHttp = /^https?:\/\//i.test(a.url || '');
    const section = buildTranscriptSection({
        turns: parse.turns,
        // Linked Media-Fragment stamps only for a real http(s) identity.
        meta: { url: isHttp ? a.url : null, format: parse.format }
    });

    if (isMarkdownCanonical(a)) {
        // Markdown-canonical (pdf/transcript imports): the markdown IS
        // the substrate. Fold the live markdown draft first — it may be
        // ahead of article.markdown when the user edited the tab.
        const baseMd = (state.dirtySource === 'markdown' && state.markdownDraft)
            ? state.markdownDraft : (a.markdown || '');
        a.markdown = upsertTranscriptSection(baseMd, section, { isHtml: false });
        state.markdownDraft = a.markdown;
        a.content = ContentExtractor.markdownToHtml(a.markdown);
        state.htmlDraft = a.content;
    } else {
        // HTML-canonical (ordinary captures): upsert the RENDERED
        // section into the clean capture content, then re-derive the
        // reader draft from it. Deliberately NOT folded from htmlDraft —
        // the live body carries entity-mark spans, and folding them into
        // article.content would double-wrap on the re-render's
        // rehydrate pass. Exception: a markdown-tab edit (dirtySource
        // 'markdown') is mark-free and canonical by contract, so it
        // folds in first rather than being clobbered.
        if (state.dirtySource === 'markdown' && state.markdownDraft) {
            a.content = ContentExtractor.markdownToHtml(state.markdownDraft);
        }
        const sectionHtml = ContentExtractor.markdownToHtml(section);
        a.content = upsertTranscriptSection(a.content || '', sectionHtml, { isHtml: true });
        state.htmlDraft = a.content;
        state.markdownDraft = '';       // stale — regenerated on tab entry
        state.dirtySource = 'reader';
    }

    // The structure manifest + the LOCAL speaker list (the claim
    // prefill seam; relay round-trips carry counts only — names
    // re-parse from the body).
    a.transcript_meta = {
        format: parse.format,
        turn_count: parse.turns.length,
        speaker_count: parse.speakers.length,
        speakers: [...parse.speakers]
    };

    // The body changed → the canonical hash changes. Honest versioning:
    // the archive's prior-version snapshot of the pre-transcript body
    // is CORRECT here, not a stealth-edit false positive.
    try {
        const fullBody = EventBuilder.assembleArticleBody(hashableArticle(a));
        const fullHash = await canonicalArticleHash(fullBody);
        const slice = auditableSlice(fullBody);
        const slicedHash = slice.truncated
            ? await canonicalArticleHash(slice.text) : fullHash;
        state.articleHash = fullHash;
        state.auditableTotalChars = slice.totalChars;
        state.auditableHash = slicedHash;
        updateHashLine();
        refreshAuditStatus().catch(() => {});
    } catch (err) {
        console.warn('[X-Ray Reader] attach hash failed:', err);
    }

    if (!state.readOnlyOpen && a.url) {
        ArchiveCache.saveArticle({
            article: state.articleHash ? { ...a, _articleHash: state.articleHash } : a,
            source: 'capture'
        }).catch((err) => console.warn('[X-Ray Reader] attach save failed:', err));
    }

    renderReader();
    refreshClaimsBar().catch(() => {});
    toast(`Transcript attached — ${parse.turns.length} turn${parse.turns.length === 1 ? '' : 's'}`
        + `, ${parse.speakers.length} speaker${parse.speakers.length === 1 ? '' : 's'}`, 'success', 2500);
}

async function setupSuggestControl() {
    const btn = $('#xr-suggest');
    if (!btn) return;
    let cfg = {};
    try { cfg = await browserApi.runtime.sendMessage({ type: 'xray:llm:config' }) || {}; }
    catch (_) { cfg = {}; }

    if (!cfg.enabled) { btn.hidden = true; return; }   // flag off ⇒ absent
    btn.hidden = false;
    if (!cfg.hasKey) {
        btn.disabled = true;
        btn.title = 'Set an Anthropic API key in Options → Advanced → LLM assist';
        return;
    }
    btn.disabled = false;
    btn.title = 'Suggest capture artifacts with an LLM (sends the article text to Anthropic)';
    btn.addEventListener('click', runSuggestPass);
}

async function runSuggestPass() {
    const btn = $('#xr-suggest');
    if (!btn || btn.disabled || !state.article) return;
    const articleText = articleBodyText();
    if (!articleText.trim()) { toast('Nothing to analyze yet.', 'error'); return; }

    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = '✨ Thinking…';
    let resp;
    try {
        resp = await browserApi.runtime.sendMessage({
            type: 'xray:llm:suggest',
            request: {
                // Which artifact kinds to suggest is configured in Options
                // (default: entities + claims); the SW reads it.
                articleText,
                articleUrl: state.article.url || '',
                articleTitle: state.article.title || ''
            }
        });
    } catch (err) {
        resp = { ok: false, error: (err && err.message) || String(err) };
    }
    btn.textContent = original;
    btn.disabled = false;

    if (!resp || !resp.ok) {
        toast('Suggest failed: ' + ((resp && resp.error) || 'unknown error'), 'error', 6000);
        return;
    }
    if (!Array.isArray(resp.proposals) || resp.proposals.length === 0) {
        toast('The model returned no suggestions for this article.', 'success', 4000);
        return;
    }
    await openLlmReview({
        proposals:  resp.proposals,
        model:      resp.model,
        articleText,
        sourceUrl:  state.article.url || '',
        articleHash: claimArticleHash() || '',
        // PDF page anchors for accepted claims (null for non-PDFs).
        pageForQuote: (q) => pdfPageOfQuote(q),
        sourceRef:  { url: state.article.url || '', title: state.article.title || '' },
        // Accepted claims default their asserter to the article-author
        // ENTITY when one already exists — existing-only: bulk accept
        // never mints entities (that stays a deliberate click).
        defaultSourceEntityId: await (async () => {
            const speaker = await resolveDefaultSpeaker();
            return (speaker && speaker.entityId) || null;
        })(),
        // 22.3: per-claim override on transcripts — the accepted quote's
        // turn speaker beats the article byline. Entity id when the
        // speaker already exists; else the parsed name as FREE TEXT
        // (ClaimModel models source as entity id | free text — no
        // entity is minted, keeping the rule above).
        sourceForQuote: async (quote) => {
            const s = await resolveTranscriptSpeakerForQuote(quote);
            return s ? (s.entityId || s.suggestedName || null) : null;
        },
        // Accepted entities are tagged onto the article with their
        // grounded verbatim mention — same ref shape (and same dedupe)
        // as the manual selection tagger, so the publish flow p-tags
        // them and the mention provenance survives.
        onEntityTag: (ref) => {
            if (!ref || !ref.entity_id) return;
            if (!Array.isArray(state.article.entities)) state.article.entities = [];
            const dup = state.article.entities.find((e) => e.entity_id === ref.entity_id);
            if (dup) return;
            state.article.entities.push(ref);
            const body = $('.xr-article__body');
            if (body && ref.context) {
                rehydrateEntityMarks(body, [ref])
                    .then(() => {
                        state.htmlDraft = body.innerHTML;
                        // Text-neutral wrap — see the tagger's onTag.
                        if (!isMarkdownCanonical(state.article)) state.dirtySource = 'reader';
                    })
                    .catch(() => {});
            }
            refreshEntitiesBar().catch(() => {});
            scheduleTagSave();
        },
        onAccepted: async () => {
            await refreshClaimsBar().catch(() => {});
            await refreshFindingsBar().catch(() => {});
        }
    });
}

/**
 * In-extension epistemic auditor controls (the LLM execution path beside
 * "Import audit JSON…"): a Quick (single-shot) and a Thorough (per-module)
 * button. Same gating as Suggest: absent unless the llmAssist flag is on,
 * disabled with a hint when on but keyless — so flag-off OR no-key means
 * no network call is reachable from here.
 */
async function setupAuditRunControl() {
    const quick = $('#xr-audit-run');
    const thorough = $('#xr-audit-run-thorough');
    if (!quick && !thorough) return;
    let cfg = {};
    try { cfg = await browserApi.runtime.sendMessage({ type: 'xray:llm:config' }) || {}; }
    catch (_) { cfg = {}; }

    for (const btn of [quick, thorough]) {
        if (!btn) continue;
        if (!cfg.enabled) { btn.hidden = true; continue; }   // flag off ⇒ absent
        btn.hidden = false;
        if (!cfg.hasKey) {
            btn.disabled = true;
            btn.title = 'Set an Anthropic API key in Options → Advanced → LLM assist';
        } else {
            btn.disabled = false;   // title stays as the HTML default
        }
    }
    if (cfg.enabled && cfg.hasKey) {
        if (quick) quick.addEventListener('click', () => runAuditFromReader('single'));
        if (thorough) thorough.addEventListener('click', () => runAuditFromReader('per_module'));
    }
}

// ------------------------------------------------------------------
// In-extension audit runs (quick + thorough)
//
// Both modes compute the auditable body ONCE — hashableArticle-adjusted
// (PDFs hash the reconstruction, not a turndown round trip) and
// pre-sliced to MAX_AUDIT_INPUT_CHARS — so the local hash, the text the
// model scores, the persisted ledger key, and the panel's query key are
// ONE hash. Thorough mode sends one runtime message per module
// (run-orchestrator.js, the lens topology): each response resets the
// MV3 idle timer, a lost channel costs one retryable module, and every
// completed module is draft-persisted immediately so paid results
// survive a mid-run death (the fetched-but-never-displayed bug;
// JOURNAL 2026-07-09).
// ------------------------------------------------------------------

const AUDIT_DRAFT_PREFIX = 'xray:audit:draft:';
// Reader-side ceiling on a quick run — beyond the SW's own 300s abort
// so the SW's richer error wins when it CAN answer, but the button can
// never stick forever when the response channel is gone.
const READER_QUICK_TIMEOUT_MS = 330000;
const SW_KEEPALIVE_MS = 20000;

async function loadAuditDraft(hash) {
    try {
        const res = await browserApi.storage.local.get(AUDIT_DRAFT_PREFIX + hash);
        const draft = res && res[AUDIT_DRAFT_PREFIX + hash];
        return (draft && typeof draft === 'object' && draft.modules) ? draft : null;
    } catch (_) { return null; }
}

// Draft writes are a read-modify-write of ONE storage key from up to
// three concurrent orchestrator workers — two module completions
// landing back-to-back would both read the same pre-image and the
// second set() would silently drop the first worker's paid-for module
// from the resume draft. Chain every write through one promise so
// each get→set completes before the next begins.
let _auditDraftChain = Promise.resolve();
function appendAuditDraft(hash, moduleName, findings, model) {
    _auditDraftChain = _auditDraftChain.then(async () => {
        const key = AUDIT_DRAFT_PREFIX + hash;
        const res = await browserApi.storage.local.get(key);
        const draft = (res && res[key] && res[key].modules) ? res[key] : { modules: {} };
        draft.modules[moduleName] = findings;
        if (model) draft.model = model;
        await browserApi.storage.local.set({ [key]: draft });
    }).catch((err) => {
        // Draft durability is best-effort — the run continues regardless
        // (and the chain must never stay rejected for the next write).
        console.warn('[X-Ray Reader] audit draft save failed:', err);
    });
    return _auditDraftChain;
}

async function clearAuditDraft(hash) {
    try { await browserApi.storage.local.remove(AUDIT_DRAFT_PREFIX + hash); }
    catch (_) { /* stale drafts are re-offered, never fatal */ }
}

// While a single long SW call is in flight, ping the zero-cost config
// handler — each onMessage delivery resets the MV3 idle timer (the
// mechanism the lens's one-message-per-jurisdiction topology relies on).
function startSwKeepalive() {
    const timer = setInterval(() => {
        try {
            const p = browserApi.runtime.sendMessage({ type: 'xray:llm:config' });
            if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (_) { /* SW restarting — the next ping lands */ }
    }, SW_KEEPALIVE_MS);
    return { stop: () => clearInterval(timer) };
}

function auditRequestMeta() {
    return {
        articleUrl: state.article.url || '',
        articleTitle: state.article.title || '',
        metadata: {
            url: state.article.url || null,
            headline: state.article.title || null,
            byline: state.article.author || state.article.byline || null,
            publication_date: state.article.date || state.article.publishedTime || null
        }
    };
}

/**
 * Ingest an assembled audit through the SAME firewall the file importer
 * uses (re-hash + schema-validate), then repaint. Returns true when the
 * import succeeded — the thorough path only clears its draft then.
 */
async function ingestAuditResult(audit, localHash, how, model) {
    try {
        const summary = await importAuditJson(audit, {
            localArticleHash: localHash,
            source: 'background',
            // Truncated-capture runs key to the slice hash; carry the
            // full capture hash as the join alias so capture-keyed
            // surfaces (the case dossier) still find the run.
            captureArticleHash: (state.articleHash && state.articleHash !== localHash)
                ? state.articleHash : null
        });
        const bits = [`${summary.modulesValid} module${summary.modulesValid === 1 ? '' : 's'} valid`];
        if (summary.modulesFailed) bits.push(`${summary.modulesFailed} failed validation`);
        if (summary.predictionsImported) bits.push(`${summary.predictionsImported} prediction${summary.predictionsImported === 1 ? '' : 's'}`);
        if (summary.predictionsSkipped) bits.push(`${summary.predictionsSkipped} skipped`);
        toast(`Audit complete (${how}, ${model || 'unknown model'}) — ${bits.join(', ')}`,
            summary.modulesFailed ? 'warning' : 'success', 6000);
        await refreshAuditStatus();
        return true;
    } catch (err) {
        // importAuditJson is the firewall — surface its reason verbatim.
        console.error('[xray] audit import failed', err, audit);
        toast('Audit import failed: ' + ((err && err.message) || 'unknown error'), 'error', 7000);
        return false;
    }
}

/** Quick: one single-shot SW call, keepalive + raced timeout. */
async function runQuickAudit({ markdown, localHash }) {
    const keepalive = startSwKeepalive();
    let resp;
    try {
        resp = await Promise.race([
            browserApi.runtime.sendMessage({
                type: 'xray:audit:run',
                request: { mode: 'single', markdown, ...auditRequestMeta() }
            }),
            new Promise((resolve) => setTimeout(() => resolve({
                ok: false,
                error: `No response after ${Math.round(READER_QUICK_TIMEOUT_MS / 1000)}s — the run was likely lost to a service-worker restart. Try again (thorough mode is restart-proof).`
            }), READER_QUICK_TIMEOUT_MS))
        ]);
    } catch (err) {
        resp = { ok: false, error: (err && err.message) || String(err) };
    } finally {
        keepalive.stop();
    }
    if (!resp || !resp.ok) {
        toast('Audit failed: ' + ((resp && resp.error) || 'unknown error'), 'error', 7000);
        return;
    }
    await ingestAuditResult(resp.audit, localHash, 'quick', resp.model);
}

/**
 * Thorough: one SW message per module with bounded concurrency; every
 * completed module is draft-persisted before the next dispatch, so a
 * dead reader/SW/browser costs nothing already paid for. A draft for
 * the SAME text offers resume (only missing modules re-run).
 */
async function runThoroughAudit({ markdown, localHash, active }) {
    let existing = {};
    let draftModel = null;
    const draft = await loadAuditDraft(localHash);
    if (draft && Object.keys(draft.modules || {}).length > 0) {
        const done = Object.keys(draft.modules).length;
        if (confirm(`A previous thorough audit saved ${done}/${MODULE_NAMES.length} completed module(s) for this exact text. Resume, re-running only the missing ones? (Cancel discards the draft and starts fresh.)`)) {
            existing = draft.modules;
            draftModel = draft.model || null;
        } else {
            await clearAuditDraft(localHash);
        }
    }

    const missing = MODULE_NAMES.filter((n) => !existing[n]);
    const meta = auditRequestMeta();
    const doneBase = Object.keys(existing).length;
    const paint = (okCount) => {
        active.textContent = `⏳ Auditing ${doneBase + okCount}/${MODULE_NAMES.length}…`;
    };
    paint(0);

    const { modules, failures, model } = await orchestrateModuleRuns({
        moduleNames: missing,
        send: async (name) => {
            const res = await browserApi.runtime.sendMessage({
                type: 'xray:audit:module',
                request: { module: name, markdown, articleUrl: meta.articleUrl, articleTitle: meta.articleTitle }
            });
            if (res && res.ok && res.findings) {
                await appendAuditDraft(localHash, name, res.findings, res.model);
            }
            return res;
        },
        onProgress: (p) => paint(p.okCount)
    });

    const merged = { ...existing, ...modules };
    const okCount = Object.keys(merged).length;
    if (okCount === 0) {
        toast('Every module call failed — check your connection and key, then try again. Nothing was imported.', 'error', 8000);
        return;
    }
    if (failures.length > 0) {
        toast(`${failures.length} module${failures.length === 1 ? '' : 's'} failed (${failures.map((f) => f.module).join(', ')}) — importing the rest; re-run thorough later to fill the gaps (completed modules are saved).`,
            'warning', 8000);
    }

    let audit;
    try {
        audit = await assembleAudit({
            toolInput: { modules: merged },
            model: model || draftModel || 'unknown',
            markdown,
            metadata: meta.metadata,
            standingCaveat: null
        });
    } catch (err) {
        console.error('[xray] thorough assembly failed', err);
        toast('Could not assemble the audit from the module results — the completed modules remain saved; try again.', 'error', 7000);
        return;
    }

    const imported = await ingestAuditResult(audit, localHash, 'thorough', model || draftModel);
    // Clear the draft ONLY on full success with nothing missing — a
    // partial import keeps it so a later re-run tops the modules up.
    if (imported && failures.length === 0) await clearAuditDraft(localHash);
}

/**
 * Entry point for both audit buttons. Computes the ONE auditable body +
 * hash, discloses truncation before any spend, then dispatches to the
 * quick or thorough runner.
 *
 * @param {'single'|'per_module'} mode
 */
async function runAuditFromReader(mode = 'single') {
    const quick = $('#xr-audit-run');
    const thorough = $('#xr-audit-run-thorough');
    const active = mode === 'per_module' ? thorough : quick;
    if (!active || active.disabled || !state.article) return;

    // The SAME body shape the panel keys on (hashableArticle: PDFs hash
    // their reconstruction), sliced to the auditable bound BEFORE
    // hashing — the gate covers exactly the text that gets scored.
    const fullBody = EventBuilder.assembleArticleBody(hashableArticle(state.article));
    if (!fullBody || !fullBody.trim()) { toast('Nothing to audit yet.', 'error'); return; }
    const slice = auditableSlice(fullBody);
    if (slice.truncated) {
        const pct = Math.round((MAX_AUDIT_INPUT_CHARS / slice.totalChars) * 100);
        if (!confirm(`This capture is ${slice.totalChars.toLocaleString()} characters; the auditable limit is ${MAX_AUDIT_INPUT_CHARS.toLocaleString()}. The audit will cover the first ~${pct}% and be keyed to that truncated text. Continue?`)) {
            return;
        }
    }
    const markdown = slice.text;

    // Thorough mode spends ~8× — confirm before committing the user's key.
    if (mode === 'per_module'
        && !confirm('Thorough audit runs one LLM call per dimension (about 8 API calls — higher cost) for more rigor. Progress is saved per module and resumable. Continue?')) {
        return;
    }

    let localHash;
    try { localHash = await canonicalArticleHash(markdown); }
    catch (_) { localHash = null; }
    if (!localHash) {
        toast('This view has no capture hash to verify against — open the capture this audit belongs to.', 'error', 7000);
        return;
    }

    // Disable BOTH controls during a run (no concurrent passes); label
    // the active one; ALWAYS restore (the raced timeout guarantees the
    // quick path returns; the orchestrator guarantees the thorough one).
    const labels = new Map();
    for (const b of [quick, thorough]) { if (b) { labels.set(b, b.textContent); b.disabled = true; } }
    active.textContent = mode === 'per_module' ? '⏳ Auditing (thorough)…' : '⏳ Auditing…';
    try {
        if (mode === 'per_module') {
            await runThoroughAudit({ markdown, localHash, active });
        } else {
            await runQuickAudit({ markdown, localHash });
        }
    } finally {
        for (const b of [quick, thorough]) { if (b) { b.textContent = labels.get(b); b.disabled = false; } }
    }
}

// ------------------------------------------------------------------
// Lens readings (Phase 16.3, docs/MORAL_LENS_JURISDICTION_DESIGN.md)
// ------------------------------------------------------------------

/**
 * Lens-readings control. Same gating shape as the audit control but a
 * DIFFERENT flag: the whole section is absent unless `moralLens` is on
 * (independent of llmAssist — "flag off → no UI anywhere"); on but
 * keyless leaves Run visible-but-disabled with the key hint. A run
 * cached for this capture in session storage re-renders without any
 * API call.
 */
async function setupLensControl() {
    const section = $('#xr-lensread');
    const run = $('#xr-lensread-run');
    if (!section || !run) return;
    let cfg = {};
    try { cfg = await browserApi.runtime.sendMessage({ type: 'xray:lens:config' }) || {}; }
    catch (_) { cfg = {}; }

    if (!cfg.enabled) { section.hidden = true; return; }   // flag off ⇒ no UI anywhere
    section.hidden = false;
    run.hidden = false;
    if (!cfg.hasKey) {
        run.disabled = true;
        run.title = 'Set an Anthropic API key in Options → Advanced → LLM assist';
    } else {
        run.disabled = false;   // title stays as the HTML default
        run.addEventListener('click', () => openLensSetup().catch((err) => {
            console.warn('[X-Ray Reader] lens setup failed:', err);
        }));
    }

    // Re-render a session-cached run (derived view — no new API call).
    try {
        const cached = await getCachedLensRun(state.id);
        if (cached && cached.panel) renderLensRun(cached);
    } catch (_) { /* cache is best-effort */ }
}

function lensStatus(text) {
    const el = $('#xr-lensread-status');
    if (el) el.textContent = text;
}

/**
 * Default lens type for a claim: the §3.1 mapping when the claim has
 * been atomized — any truth-adjudicable proposition makes it 'factual'
 * (failing toward the firewall: a factual assertion gets a corpus
 * stance, never a disposition) — else 'evaluative'. Always
 * user-overridable in the setup form; the chosen typing lives only in
 * this run's output, never on the claim record.
 */
async function lensDefaultType(claimId) {
    try {
        const propositions = await TruthAdjudicationModel.getByClaim(claimId);
        if (propositions.some((p) => lensTypeForPropositionClass(p.proposition_class) === 'factual')) {
            return 'factual';
        }
        for (const p of propositions) {
            const t = lensTypeForPropositionClass(p.proposition_class);
            if (t) return t;
        }
    } catch (_) { /* fall through to the default */ }
    return 'evaluative';
}

async function openLensSetup() {
    const body = $('#xr-lensread-body');
    if (!body || !state.article) return;
    const jurisdictions = await JurisdictionModel.list();
    const claims = await ClaimModel.getBySourceUrl(state.article.url);
    const typed = [];
    for (const c of claims) {
        typed.push({ id: c.id, text: c.text, type: await lensDefaultType(c.id) });
    }
    body.innerHTML = renderLensSetup({ jurisdictions, claims: typed });
    const cancel = body.querySelector('[data-role="lens-cancel"]');
    if (cancel) cancel.addEventListener('click', () => { body.innerHTML = ''; });
    const go = body.querySelector('[data-role="lens-go"]');
    if (go) go.addEventListener('click', () => runLensFromReader().catch((err) => {
        console.warn('[X-Ray Reader] lens run failed:', err);
        toast('Lens run failed: ' + ((err && err.message) || 'unknown error'), 'error', 7000);
    }));
}

// Re-entry guard: the setup form's Run button stays in the DOM while
// the first click awaits storage, so a double-click would start two
// concurrent panels (2×N paid calls). One run at a time.
let lensRunInFlight = false;

/**
 * Run the panel: one xray:lens:read message per jurisdiction (§6 —
 * partial results render as they land, each message resets the SW
 * idle timer, one failure never aborts the panel), then assemble the
 * §7 panel code-side and session-cache it.
 */
async function runLensFromReader() {
    const body = $('#xr-lensread-body');
    const run = $('#xr-lensread-run');
    if (!body || !state.article || lensRunInFlight) return;
    lensRunInFlight = true;
    try {
        await runLensPanel(body, run);
    } finally {
        lensRunInFlight = false;
    }
}

async function runLensPanel(body, run) {

    const juriIds = [...body.querySelectorAll('[data-role="lens-juri"]:checked')].map((el) => el.value);
    const claimIds = new Set([...body.querySelectorAll('[data-role="lens-claim"]:checked')].map((el) => el.value));
    const typeByClaim = {};
    body.querySelectorAll('[data-role="lens-claim-type"]').forEach((sel) => { typeByClaim[sel.dataset.claim] = sel.value; });
    const basisInput = body.querySelector('[data-role="lens-basis"]');
    const basis = basisInput ? basisInput.value : '';

    if (juriIds.length === 0) { toast('Pick at least one jurisdiction.', 'warning'); return; }
    if (claimIds.size === 0) { toast('Pick at least one claim to read.', 'warning'); return; }

    const allClaims = await ClaimModel.getBySourceUrl(state.article.url);
    const claims = allClaims.filter((c) => claimIds.has(c.id))
        .map((c) => ({ id: c.id, text: c.text, type: typeByClaim[c.id] || 'evaluative' }));

    // Cost confirm states the call count and the mid-run risk (§6).
    const n = juriIds.length;
    if (!confirm(`Lens reading runs one LLM call per jurisdiction — ${n} API call${n === 1 ? '' : 's'} for this panel. `
        + 'Closing the reader mid-run drops any paid results. Continue?')) {
        return;
    }

    const articleText = EventBuilder.assembleArticleBody(state.article);
    if (!articleText || !articleText.trim()) { toast('Nothing to read yet.', 'error'); return; }

    if (run) run.disabled = true;
    body.innerHTML = '';
    lensStatus(`Reading under ${n} jurisdiction${n === 1 ? '' : 's'}… (0/${n})`);

    const readings = [];
    const failures = [];
    let provenance = null;
    let contentHash = null;
    let done = 0;

    for (const jid of juriIds) {
        const juri = await JurisdictionModel.get(jid);
        const displayName = (juri && juri.display_name) || jid;
        let resp;
        try {
            resp = await browserApi.runtime.sendMessage({
                type: 'xray:lens:read',
                request: {
                    jurisdictionId: jid,
                    articleText,
                    articleUrl: state.article.url || '',
                    articleTitle: state.article.title || '',
                    claims
                }
            });
        } catch (err) {
            resp = { ok: false, error: (err && err.message) || String(err) };
        }
        done += 1;
        lensStatus(`Reading under ${n} jurisdiction${n === 1 ? '' : 's'}… (${done}/${n})`);
        if (resp && resp.ok) {
            readings.push(resp.reading);
            provenance = resp.provenance;
            contentHash = (resp.target && resp.target.content_hash) || contentHash;
            body.insertAdjacentHTML('beforeend', renderJurisdictionCard(resp.reading, claims));
        } else {
            const failure = {
                displayName,
                type: (juri && juri.jurisdiction_type) || null,
                error: (resp && resp.error) || 'unknown error',
                refused: !!(resp && resp.refused),
                code: (resp && resp.code) || null
            };
            failures.push(failure);
            body.insertAdjacentHTML('beforeend', renderJurisdictionFailure(failure));
        }
        wireLensActions(body);
    }

    if (run) run.disabled = false;

    if (readings.length === 0) {
        lensStatus('Lens pass failed — no jurisdiction produced a reading.');
        return;
    }

    const panel = assembleLensPanel({
        target: {
            title: state.article.title || null,
            url: state.article.url || null,
            content_hash: contentHash,
            claims
        },
        jurisdictionReadings: readings,
        failures,
        selectionBasis: basis,
        provenance
    });
    body.insertAdjacentHTML('beforeend', renderPanelSummary(panel));
    lensStatus(`${readings.length}/${n} jurisdiction${n === 1 ? '' : 's'} read${failures.length ? `, ${failures.length} failed` : ''}.`);

    // Session cache only: re-opening within the session re-renders
    // without a new API call; nothing is ever durably written.
    try { await cacheLensRun(state.id, { panel, failures }); }
    catch (_) { /* cache is best-effort */ }
}

/** Re-render a cached run. */
function renderLensRun(cached) {
    const body = $('#xr-lensread-body');
    if (!body) return;
    const panel = cached.panel;
    const claims = (panel.target && panel.target.claims) || [];
    body.innerHTML = '';
    for (const reading of panel.jurisdictions || []) {
        body.insertAdjacentHTML('beforeend', renderJurisdictionCard(reading, claims));
    }
    for (const f of cached.failures || []) {
        body.insertAdjacentHTML('beforeend', renderJurisdictionFailure(f));
    }
    body.insertAdjacentHTML('beforeend', renderPanelSummary(panel));
    const count = (panel.jurisdictions || []).length;
    lensStatus(`${count} jurisdiction reading${count === 1 ? '' : 's'} (cached this session).`);
    wireLensActions(body);
}

/** The factual-row 🏛 route into the truth layer's flow (§9 Q2). */
function wireLensActions(body) {
    body.querySelectorAll('[data-action="lens-adjudicate"]').forEach((btn) => {
        if (btn.dataset.wired) return;
        btn.dataset.wired = '1';
        btn.addEventListener('click', async () => {
            const claim = await ClaimModel.get(btn.dataset.claim);
            if (!claim) { toast('Claim not found — it may have been deleted.', 'error'); return; }
            const result = await openAdjudicateModal({
                claimId:     claim.id,
                claimText:   claim.text || '',
                relays:      await getConfiguredRelays(),
                claimPubkey: claim.publishedPubkey || null
            });
            if (result) {
                toast('Adjudication recorded in the truth layer.', 'success', 2000);
                await refreshClaimsBar().catch(() => {});
            }
        });
    });
}

/**
 * The default asserter for a NEW claim on this article: usually the
 * article's author (byline; first scholarly author as the fallback).
 * Resolves to an existing entity when one matches the name exactly
 * (deterministic id — "W.H.O." the organization), else hands the name
 * to the modal so the picker opens prefilled for a one-click create.
 * Returns null when the capture has no author at all.
 */
async function resolveDefaultSpeaker() {
    const a = state.article || {};
    const name = String(a.byline || (a.scholar && a.scholar.authors && a.scholar.authors[0]) || '').trim();
    if (!name) return null;
    try {
        const entity = await findEntityByName(name);
        return entity ? { entityId: entity.id } : { suggestedName: name };
    } catch (_) {
        return { suggestedName: name };
    }
}

// Phase 21.2: for a TRANSCRIPT, the selection's enclosing paragraph
// (the tagger's `context`) carries the turn's `**Speaker:**` label —
// prefill "who said it" from THAT, not the article byline. Local
// imports carry transcript_meta.speakers so the name must match one;
// relay-reconstructed transcripts lack that list and fall back to the
// label grammar's word-count gate. Speakers are person ENTITIES (a
// bare name mints no platform account), which the claim source field
// already models. Phase 22 generalized the gate: a transcript ATTACHED
// to an ordinary capture (contentType 'article' + transcript_meta) gets
// the same prefill; bold-leading prose in a plain article (no
// transcript_meta) keeps the byline default. Returns null otherwise.
async function resolveTranscriptSpeaker(context) {
    const a = state.article || {};
    if (!(a.contentType === 'transcript' || a.transcript_meta) || !context) return null;
    const known = (a.transcript_meta && a.transcript_meta.speakers) || null;
    const name = speakerFromParagraphText(context, known);
    if (!name) return null;
    try {
        const entity = await findEntityByName(name);
        return entity ? { entityId: entity.id } : { suggestedName: name };
    } catch (_) {
        return { suggestedName: name };
    }
}

// 22.3: the quote-shaped entry to the same resolution — for claims that
// arrive WITHOUT a selection (LLM suggestions, audit atomize), whose
// only positional fact is a grounded verbatim quote. Locate the quote
// in the rendered body and read its enclosing paragraph, exactly the
// context the manual selection path would have delivered.
async function resolveTranscriptSpeakerForQuote(quote) {
    const a = state.article || {};
    if (!(a.contentType === 'transcript' || a.transcript_meta) || !quote) return null;
    const range = rangeForQuote(quote);
    if (!range) return null;
    return await resolveTranscriptSpeaker(extractParagraphContext(range));
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
    // 13.6's dependent: a prediction promoted into this claim holds a
    // claim_ref — left dangling it defers the 30058 at every publish
    // forever and the audit panel shows a permanent "claim ✓".
    try { await PredictionModel.clearClaimRef(id); }
    catch (_) { /* best-effort — the audit ledger may be absent */ }
    await ClaimModel.delete(id);
    toast('Claim deleted', 'success', 2000);
    await refreshClaimsBar();
    refreshAuditStatus().catch(() => { /* display refresh only */ });
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
        // The audit panel's header claims "for this exact text" —
        // no longer true; one refresh flips it to the edited-state
        // wording (guarded above so this fires once per edit session,
        // not per keystroke).
        refreshAuditStatus().catch(() => { /* display refresh only */ });
    }
}

function onReaderFieldBlur(ev) {
    const key = ev.target.dataset.field;
    const val = ev.target.textContent.trim();
    switch (key) {
        case 'title':       state.article.title       = val; break;
        case 'byline':      state.article.byline      = val; break;
        case 'siteName':    state.article.siteName    = val; break;
        case 'url': {
            // The URL field IS the article's identity — route through
            // the manual-original flow so alias bookkeeping and the
            // URL-keyed panels (claims, archive check) follow the
            // change instead of silently forking.
            applyManualOriginalUrl(val).then((changed) => {
                if (!changed && ev.target && ev.target.isConnected) {
                    ev.target.textContent = state.article.url || '';
                }
            }).catch(() => {});
            break;
        }
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

// Per-publish tally of events whose only "successes" were ASSUMED
// (no OK before the relay timeout). They are journaled — the signed
// event is real — but never marked published: marking on hope is how
// "published" artifacts go missing (JOURNAL 2026-07-10). Reset at the
// top of publish(); surfaced in the summary.
const _publishUnconfirmed = { count: 0 };

/**
 * The ONE gate every per-event publish site runs its response
 * through. Journals the signed event verbatim (the rebroadcast +
 * durability substrate — event-journal.js) whenever ANY relay took
 * it, then answers whether the local ledger may mark it published:
 * CONFIRMED (non-assumed) OKs only.
 */
async function publishOk(resp) {
    if (!resp || !resp.ok || !resp.results) return false;
    const results = resp.results;
    if (results.successful > 0 && resp.signedEvent) {
        try {
            await EventJournal.recordPublished(resp.signedEvent, results, {
                articleUrl: (state.article && state.article.url) || null
            });
        } catch (err) {
            console.warn('[X-Ray Reader] event journal write failed:', err);
        }
    }
    const confirmed = typeof results.confirmed === 'number'
        ? results.confirmed
        : (Array.isArray(results.results)
            ? results.results.filter((r) => r && r.success && !r.assumed).length : 0);
    if (results.successful > 0 && confirmed === 0) {
        _publishUnconfirmed.count += 1;
        return false;
    }
    return confirmed > 0;
}

async function publish() {
    const btn = $('#xr-publish');
    const originalLabel = btn.textContent;
    btn.disabled = true;
    _publishUnconfirmed.count = 0;

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
        // Incorporated foreign claims (Phase 25.3, suggested_by
        // 'nostr:<pubkey>') NEVER publish — they are someone else's
        // signed work reviewed into the local corpus, and this URL
        // filter would otherwise sweep them in when the user captures
        // the same source article.
        !String(c.suggested_by || '').startsWith('nostr:')
        && (!c.publishedAt || c.updated > c.publishedAt || needCoordIds.has(c.id)));

    // Union tagged-entity ids with every claim's claimant / subject /
    // object ids so their kind-0 events publish ahead of any claim's
    // p-tags. Note we collect from ALL article claims — even
    // already-published ones may have been edited to reference a new
    // entity that still needs to publish.
    const taggedEntityIds = (state.article.entities || []).map((e) => e.entity_id).filter(Boolean);
    const claimEntityIds  = [...collectClaimEntityIds(allArticleClaims)];
    const allEntityIds    = [...new Set([...taggedEntityIds, ...claimEntityIds])];
    let entitiesToPublish = await resolveEntitiesToPublish(allEntityIds);
    // When corpus publishing is on, the corpus batch OWNS every keyed
    // canonical root's kind-0 (enriched about, full-content hash gate)
    // — the legacy loop here would clobber it with the boilerplate
    // profile on any entity edit (19.8 review fix). Aliases keep the
    // legacy path: their kind-0 is the refers_to forwarding pointer,
    // which the corpus batch never emits. Turning the flag OFF returns
    // roots to this loop — reverting to boilerplate is then the
    // user's stated intent.
    await loadFlags();
    if (isEnabled('entityCorpusPublishing')) {
        entitiesToPublish = entitiesToPublish.filter((e) =>
            e.canonical_id || !(e.keypair && e.keypair.privateKey));
    }

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

        // Article event. The draft IS markdown — mark it so
        // assembleArticleBody never re-converts it (a second
        // htmlToMarkdown pass mangles the body and forks the
        // published x from the capture hash the audits anchor to).
        const article = {
            ...state.article,
            content: state.markdownDraft,
            markdown: state.markdownDraft,
            _contentIsMarkdown: true
        };
        const entityRefs = Array.isArray(state.article.entities) ? state.article.entities : [];

        // Phase 9 identity: materialize the post author as a
        // PlatformAccount (where the platform exposes a stable id) and
        // reference its pubkey on the article. Best-effort — null author
        // or no stable id just means no author p-tag, as before.
        const touchedAccountKeys = [];   // KS.2: accounts this run materialized
        let authorAccountPubkey = null;
        try {
            const postAuthor = extractPostAuthor(article);
            if (postAuthor) {
                const acct = await recordAccount(postAuthor.platform, postAuthor.raw, { seenOnUrl: article.url });
                if (acct) {
                    authorAccountPubkey = acct.accountPubkey;
                    if (acct.key) touchedAccountKeys.push(acct.key);
                }
            }
        } catch (_) { /* identity is enrichment, never a publish gate */ }

        const unsignedArticle = await EventBuilder.buildArticleEvent(article, entityRefs, userPubkey, [], authorAccountPubkey);

        // 13.6: predictions are keyed to the CAPTURE hash — snapshot
        // it before the restamp below, or an edited-body publish would
        // look the ledger up under the NEW hash, find nothing, and
        // silently drop every promoted claim's back-reference.
        const captureHashForLedger = state.articleHash;

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
        // Journal + confirm-gate the article like every other event.
        const articleConfirmed = await publishOk(articleResp);
        setProgress(1, totalEvents);

        // Cache the article to IndexedDB for Phase 7's archive reader.
        // AWAITED — this row is the article's only publish ledger; a
        // silently-failed write makes a genuinely-published article
        // read as "never published" (portal local-only, reconcile).
        // publishedToRelay stays honest: CONFIRMED relay OKs only —
        // an assumed-only send archives the copy without the flag.
        if (articleResults.successful > 0) {
            const publishedEventId = articleResp.signedEvent && articleResp.signedEvent.id;
            // Archive a READER-shaped copy, not the publish copy: the
            // publish copy holds MARKDOWN in `content` (for the event
            // body), but Load-archive injects `content` as HTML — a
            // published PDF re-opened from the archive rendered as one
            // garbled escaped line with its figures as literal text.
            // pageMap rides along only while the saved markdown is
            // still the text its offsets index; an edited draft would
            // pair fresh text with stale offsets and yield confidently
            // wrong page anchors.
            const archivedArticle = {
                ...article,
                content: ContentExtractor.markdownToHtml(state.markdownDraft)
            };
            delete archivedArticle._contentIsMarkdown;
            if (state.markdownDraft !== (state.article.markdown || '')) {
                delete archivedArticle.pageMap;
            }
            try {
                await ArchiveCache.saveArticle({
                    article:          archivedArticle,
                    source:           'capture',
                    publishedToRelay: articleConfirmed,
                    publishedEventId: publishedEventId || null
                });
            } catch (err) {
                console.warn('[X-Ray Reader] archive cache save failed:', err);
                toast('The article published but its local archive record failed to save — it may show as unpublished in the portal.', 'warning', 5000);
            }
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
                if (commenterAccount) {
                    commenterPubkey = commenterAccount.accountPubkey;
                    if (commenterAccount.key) touchedAccountKeys.push(commenterAccount.key);
                }

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
                        if (await publishOk(resp)) {
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
                    await attachCreatorBinding(unsignedProfile, entity.keypair && entity.keypair.pubkey);
                    const signed = await LocalKeyManager.signEvent(unsignedProfile, entity.keyName);

                    const resp = await browserApi.runtime.sendMessage({
                        type:   'xray:relay:publish',
                        event:  signed,
                        relays
                    });

                    if (resp && resp.ok && resp.results) {
                        recordRelayResults(resp.results);
                        // relay:publish responses carry no signedEvent —
                        // attach the locally-signed one so the journal
                        // gets its verbatim copy like every other site.
                        if (await publishOk({ ...resp, signedEvent: signed })) {
                            entityResults.ok++;
                            // Only mark as published if at least one relay
                            // CONFIRMED it — otherwise it'll retry next publish.
                            try { await EntityModel.markPublished(entity.id, signed.id); }
                            catch (err) { console.warn('[X-Ray Reader] entity publish mark failed:', entity.id, err); }
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
        // RQ6 back-references (13.6): claims promoted from prediction-
        // ledger entries carry an `a` pointer back to their 30058.
        // Keyed by claim id from the predictions' claim_ref records;
        // best-effort — a missing map never gates claim publishing.
        // Gathered across EVERY hash vintage the article has carried
        // (the same set the audit batch uses) — a single-vintage
        // lookup silently dropped the lineage tag whenever the ledger
        // trailed the current capture hash.
        let predictionRefByClaim = {};
        const auditHashes = captureHashForLedger
            ? await auditHashCandidates(captureHashForLedger, state.article.url) : [];
        if (claimsToPublish.length > 0 && auditHashes.length) {
            try {
                for (const h of auditHashes) {
                    for (const p of await PredictionModel.getByArticleHash(h)) {
                        if (p.claim_ref && p.claim_ref.claim_id && p.claim_ref.pred_d) {
                            predictionRefByClaim[p.claim_ref.claim_id] = { pred_d: p.claim_ref.pred_d };
                        }
                    }
                }
            } catch (_) { /* enrichment only */ }
        }
        for (let i = 0; i < claimsToPublish.length; i++) {
            const claim = claimsToPublish[i];
            btn.textContent = `Publishing (${claimBatchBase + i + 1}/${totalEvents})…`;
            try {
                const unsigned = EventBuilder.buildClaimEvent(
                    claim, article.url, article.title || 'Untitled', userPubkey, entitiesDict,
                    predictionRefByClaim[claim.id] || null
                );
                const resp = await browserApi.runtime.sendMessage({
                    type:  'xray:capture:publish',
                    id:    state.id,
                    event: unsigned
                });
                if (resp && resp.ok && resp.results) {
                    recordRelayResults(resp.results);
                    if (await publishOk(resp)) {
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
                    if (await publishOk(resp)) {
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

        // ---- Platform-account identity events (kind-32126) -------------
        // (Knowledge Sharing KS.2 — behind the platformAccountPublishing
        // flag, default off.) The deterministic cross-user person
        // rendezvous: publishes this run's touched accounts plus the
        // accounts linked to this run's entities. Addressable (d = the
        // account key), so a re-publish replaces in place — no ledger.
        await loadFlags();
        const accountResults = { ok: 0, fail: 0, errors: [] };
        let accountSel = [];
        if (isEnabled('platformAccountPublishing')) {
            try {
                const runEntityIds = [...new Set([
                    ...entityRefs.map((r) => r && r.entity_id).filter(Boolean),
                    ...entitiesToPublish.map((e) => e.id)
                ])];
                accountSel = await selectAccountsToPublish({
                    touchedAccountKeys,
                    entityIds: runEntityIds
                });
            } catch (err) {
                console.warn('[X-Ray Reader] account selection failed:', err);
            }
        }
        const accountBase = relBatchBase + relationshipsToPublish.length;
        if (accountSel.length > 0) {
            totalEvents += accountSel.length;
            for (let i = 0; i < accountSel.length; i++) {
                const { account, linkedEntityPubkey } = accountSel[i];
                btn.textContent = `Publishing (${accountBase + i + 1}/${totalEvents})…`;
                try {
                    const unsigned = EventBuilder.buildPlatformAccountEvent(
                        account, userPubkey, linkedEntityPubkey
                    );
                    const resp = await browserApi.runtime.sendMessage({
                        type:  'xray:capture:publish',
                        id:    state.id,
                        event: unsigned
                    });
                    if (resp && resp.ok && resp.results) {
                        recordRelayResults(resp.results);
                        if (await publishOk(resp)) {
                            accountResults.ok++;
                        } else {
                            accountResults.fail++;
                            accountResults.errors.push(`${account.key}: no relays accepted`);
                        }
                    } else {
                        accountResults.fail++;
                        accountResults.errors.push(`${account.key}: ${(resp && resp.error) || 'unknown'}`);
                    }
                } catch (err) {
                    accountResults.fail++;
                    accountResults.errors.push(`${account.key}: ${err.message || String(err)}`);
                    console.warn('[X-Ray Reader] account publish failed:', account.key, err);
                }
                setProgress(accountBase + i + 1, totalEvents);
                if (i < accountSel.length - 1) await sleep(BATCH_PUBLISH_DELAY_MS);
            }
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
        const judgmentBase = accountBase + accountSel.length;
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
                    // the registry — through the canonical chain (E3,
                    // Phase 17A) so assessments of alias-tagged claims
                    // land on the root identity; foreign claims carry
                    // snapshotted pubkeys.
                    const aboutPubkeys = [...(sel.aboutPubkeys || [])];
                    for (const id of sel.aboutIds || []) {
                        const rootId = canonicalIdOf(id, entitiesAll);
                        const ent = entitiesAll[rootId] || entitiesAll[id];
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
                        if (await publishOk(resp)) {
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
                        if (await publishOk(resp)) {
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
                        if (await publishOk(resp)) {
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

        // ---- Audit events (13.8, flag-gated) ---------------------------
        // The ordered audit batch for this capture: 30056s → 30057 →
        // 30058s (claims published above, so claim back-refs resolve)
        // → 30059s. Per-event ledger marks make a relay hiccup
        // mid-batch resumable instead of duplicating. Uses the
        // CAPTURE hash — predictions and runs anchor to the text that
        // was audited, not the possibly-edited published text.
        const auditResults = { ok: 0, fail: 0, errors: [], skipped: 0 };
        let auditCount = 0;
        if (isEnabled('epistemicAuditing') && captureHashForLedger) {
            let batch = { entries: [], skipped: [] };
            try {
                // The ledger may be keyed to an EARLIER capture vintage
                // than this publish — the same candidate set the RQ6
                // back-reference map used above.
                const hashes = auditHashes.length
                    ? auditHashes
                    : await auditHashCandidates(captureHashForLedger, state.article.url);

                const auditRuns = [];
                const auditPreds = [];
                for (const h of hashes) {
                    for (const r of await AuditRunModel.getByArticleHash(h)) {
                        if (!auditRuns.some((x) => x.id === r.id)) auditRuns.push(r);
                    }
                    for (const p of await PredictionModel.getByArticleHash(h)) {
                        if (!auditPreds.some((x) => x.id === p.id)) auditPreds.push(p);
                    }
                }

                // Resolutions: anything referencing one of this
                // article's predictions (under ANY pubkey — the batch
                // sorts stale-identity filings from remote-prediction
                // ones), plus anything filed with this article's hash
                // (resolutions of remote predictions about it).
                const predSuffixes = new Set(auditPreds.map((p) => `pred:${String(p.id).slice('pred_'.length)}`));
                const auditResolutions = (await listAuditResolutions()).filter((r) => {
                    if (!r) return false;
                    const suffix = String(r.prediction_coord || '').split(':').slice(2).join(':');
                    return predSuffixes.has(suffix) || (r.article_hash && hashes.includes(r.article_hash));
                });

                // Promoted predictions reference their claim's PUBLISHED
                // address — read it fresh (the claims block just ran,
                // so a claim that landed this batch already carries
                // its publishedPubkey). Absent → the batch defers.
                const claimPubkeys = {};
                try {
                    for (const c of await ClaimModel.getBySourceUrl(state.article.url)) {
                        if (c && c.publishedPubkey) claimPubkeys[c.id] = c.publishedPubkey;
                    }
                } catch (_) { /* defer-on-absence is the safe posture */ }

                // The article's own coordinate — attached only when at
                // least one relay holds the 30023 (referenced-before-
                // referencer applies to the article join too).
                const articleDTag = (unsignedArticle.tags.find((t) => t[0] === 'd') || [])[1];
                const auditArticleCoord = (articleResults.successful > 0 && articleDTag)
                    ? `30023:${userPubkey}:${articleDTag}` : null;

                batch = await assembleAuditBatch({
                    articleHash: captureHashForLedger,
                    userPubkey,
                    runs: auditRuns,
                    predictions: auditPreds,
                    resolutions: auditResolutions,
                    claimPubkeys,
                    articleUrl: state.article.url || '',
                    articleCoord: auditArticleCoord
                });
            } catch (err) {
                console.warn('[X-Ray Reader] audit batch assembly failed:', err);
                auditResults.fail++;
                auditResults.errors.push(`batch assembly: ${err.message || String(err)}`);
            }
            auditResults.skipped = batch.skipped.length;
            auditCount = batch.entries.length;
            if (batch.entries.length > 0) {
                const auditBase = totalEvents;
                totalEvents += batch.entries.length;
                toast(`Also publishing ${batch.entries.length} audit event${batch.entries.length === 1 ? '' : 's'} — public, signed, disputable…`, 'warning', 4000);
                // Referenced-before-referencer holds on the WIRE, not
                // just in the list: an aggregate defers when one of
                // its run's module events failed THIS batch, and a
                // resolution defers when the prediction minting its
                // coordinate failed this batch (the failed30054
                // discipline, per dependency). Resume re-offers both.
                const failedModuleRuns = new Set();
                const failedPredCoords = new Set();
                let aStep = 0;
                for (const entry of batch.entries) {
                    btn.textContent = `Publishing (${auditBase + (++aStep)}/${totalEvents})…`;
                    const isAgg = entry.mark.type === 'run-event' && entry.mark.eventKey === 'agg';
                    if ((isAgg && failedModuleRuns.has(entry.mark.runId))
                        || (entry.mark.type === 'resolution' && failedPredCoords.has(entry.predictionCoord))) {
                        auditResults.fail++;
                        auditResults.errors.push(`${entry.label}: deferred — its referent failed this batch`);
                        setProgress(auditBase + aStep, totalEvents);
                        if (aStep < batch.entries.length) await sleep(BATCH_PUBLISH_DELAY_MS);
                        continue;
                    }
                    let landed = false;
                    try {
                        entry.event.pubkey = userPubkey;
                        const resp = await browserApi.runtime.sendMessage({
                            type: 'xray:capture:publish', id: state.id, event: entry.event
                        });
                        if (await publishOk(resp)) {
                            recordRelayResults(resp.results);
                            auditResults.ok++;
                            landed = true;
                            const signedId = resp.signedEvent?.id || null;
                            try {
                                if (entry.mark.type === 'run-event') {
                                    await AuditRunModel.markEventPublished(entry.mark.runId, entry.mark.eventKey, signedId, userPubkey);
                                } else if (entry.mark.type === 'prediction') {
                                    await PredictionModel.markPublished(entry.mark.id, signedId, userPubkey);
                                } else if (entry.mark.type === 'resolution') {
                                    await ResolutionModel.markPublished(entry.mark.id, signedId, userPubkey, entry.mark.rekeyedCoord || null);
                                }
                            } catch (_) { /* ledger mark is best-effort */ }
                        } else {
                            if (resp && resp.results) recordRelayResults(resp.results);
                            auditResults.fail++;
                            auditResults.errors.push(`${entry.label}: ${(resp && resp.error) || 'no relays accepted'}`);
                        }
                    } catch (err) {
                        auditResults.fail++;
                        auditResults.errors.push(`${entry.label}: ${err.message || String(err)}`);
                        console.warn('[X-Ray Reader] audit publish failed:', entry.label, err);
                    }
                    if (!landed) {
                        if (entry.mark.type === 'run-event' && entry.mark.eventKey !== 'agg') {
                            failedModuleRuns.add(entry.mark.runId);
                        } else if (entry.mark.type === 'prediction' && entry.coord) {
                            failedPredCoords.add(entry.coord);
                        }
                    }
                    setProgress(auditBase + aStep, totalEvents);
                    if (aStep < batch.entries.length) await sleep(BATCH_PUBLISH_DELAY_MS);
                }
                // No toast here — showPublishSummary's toast replaces
                // it in the same tick (single-slot); the audit segment
                // and skipped count ride the summary line instead.
                refreshAuditStatus().catch(() => { /* display refresh only */ });
            }
        }

        // ---- Forensic findings (Phase 14, flag-gated) -----------------
        // Behind `forensicPublishing` (default off): behavioral findings
        // (30062) + their kind-1985 maneuver mirrors + the `revision/*`
        // story-change edges (30055). A finding publishes against a
        // RESOLVED subject pubkey — a tagged entity's keypair or an
        // external pubkey; a subject known only by label/handle waits for
        // entity linking. Runs after claims so revision-edge endpoints
        // resolve.
        const findingResults = { ok: 0, fail: 0, errors: [] };
        const fMirrorResults = { ok: 0, fail: 0, errors: [] };
        const revEdgeResults = { ok: 0, fail: 0, errors: [] };
        let findingSel = [], fMirrorSel = [], revEdgeSel = [];
        if (isEnabled('forensicPublishing')) {
            const [findingsAll, entitiesF, linksF, claimsF, canonF] = await Promise.all([
                ForensicModel.getAll(), EntityModel.getAll(), EvidenceLinker.getAll(),
                ClaimModel.getAll(), makeClaimRefCanonicalizer()
            ]);
            findingSel  = selectFindingsToPublish({ findings: findingsAll, entities: entitiesF });
            fMirrorSel  = selectFindingMirrors({ findings: findingsAll, entities: entitiesF });
            revEdgeSel  = selectRevisionEdgesToPublish({ links: linksF, claims: claimsF, canon: canonF });
        }
        const forensicTotal = findingSel.length + fMirrorSel.length + revEdgeSel.length;
        if (forensicTotal > 0) {
            const fBase = totalEvents;
            totalEvents += forensicTotal;
            let fStep = 0;
            toast(`Also publishing forensic findings: ${findingSel.length} finding${findingSel.length === 1 ? '' : 's'}`
                  + (fMirrorSel.length ? ` + ${fMirrorSel.length} mirror${fMirrorSel.length === 1 ? '' : 's'}` : '')
                  + (revEdgeSel.length ? ` + ${revEdgeSel.length} revision edge${revEdgeSel.length === 1 ? '' : 's'}` : '')
                  + '…', 'warning', 4000);

            const sendForensic = async (unsigned) => {
                unsigned.pubkey = userPubkey;
                return await browserApi.runtime.sendMessage({
                    type: 'xray:capture:publish', id: state.id, event: unsigned
                });
            };

            // Findings (kind 30062). Track those whose 30062 failed this
            // batch — their mirror must not emit (its target wouldn't be
            // on relays).
            const failed30062 = new Set();
            for (const sel of findingSel) {
                btn.textContent = `Publishing (${fBase + (++fStep)}/${totalEvents})…`;
                let landed = false;
                try {
                    const { event: unsigned, dTag } = await buildBehavioralFindingEvent({
                        subjectPubkey: sel.subjectPubkey,
                        maneuver:      sel.finding.maneuver,
                        role:          sel.finding.role,
                        anchors:       sel.anchors,
                        counterNote:   sel.finding.counter_note,
                        note:          sel.finding.note,
                        basis:         sel.finding.basis,
                        sourceUrl:     sel.sourceUrl,
                        suggestedBy:   sel.finding.suggested_by || 'user'
                    });
                    const resp = await sendForensic(unsigned);
                    if (resp && resp.ok && resp.results) {
                        recordRelayResults(resp.results);
                        if (await publishOk(resp)) {
                            findingResults.ok++;
                            landed = true;
                            try { await ForensicModel.markPublished(sel.finding.id, resp.signedEvent?.id || null, userPubkey, dTag); }
                            catch (_) { /* best-effort */ }
                        } else {
                            findingResults.fail++;
                            findingResults.errors.push(`${sel.finding.maneuver}: no relays accepted`);
                        }
                    } else {
                        findingResults.fail++;
                        findingResults.errors.push(`${sel.finding.maneuver}: ${(resp && resp.error) || 'unknown'}`);
                    }
                } catch (err) {
                    findingResults.fail++;
                    findingResults.errors.push(`${sel.finding.maneuver}: ${err.message || String(err)}`);
                    console.warn('[X-Ray Reader] finding publish failed:', sel.finding.id, err);
                }
                if (!landed) failed30062.add(sel.finding.id);
                setProgress(fBase + fStep, totalEvents);
                await sleep(BATCH_PUBLISH_DELAY_MS);
            }

            // Finding mirrors (kind 1985). Skip a candidate whose 30062
            // was attempted this batch and failed.
            for (const sel of fMirrorSel) {
                btn.textContent = `Publishing (${fBase + (++fStep)}/${totalEvents})…`;
                if (failed30062.has(sel.finding.id)) {
                    setProgress(fBase + fStep, totalEvents);
                    await sleep(BATCH_PUBLISH_DELAY_MS);
                    continue;
                }
                try {
                    const { event: unsigned } = buildForensicFindingMirrorEvent({
                        subjectPubkey: sel.subjectPubkey,
                        maneuver:      sel.maneuver,
                        sourceUrl:     sel.sourceUrl
                    });
                    const resp = await sendForensic(unsigned);
                    if (resp && resp.ok && resp.results) {
                        recordRelayResults(resp.results);
                        if (await publishOk(resp)) {
                            fMirrorResults.ok++;
                            try { await ForensicModel.markMirrored(sel.finding.id); }
                            catch (_) { /* best-effort */ }
                        } else { fMirrorResults.fail++; fMirrorResults.errors.push('finding mirror: no relays accepted'); }
                    } else {
                        fMirrorResults.fail++;
                        fMirrorResults.errors.push(`finding mirror: ${(resp && resp.error) || 'unknown'}`);
                    }
                } catch (err) {
                    fMirrorResults.fail++;
                    fMirrorResults.errors.push(`finding mirror: ${err.message || String(err)}`);
                }
                setProgress(fBase + fStep, totalEvents);
                await sleep(BATCH_PUBLISH_DELAY_MS);
            }

            // Revision edges (kind 30055, the directional story-change links).
            for (const sel of revEdgeSel) {
                btn.textContent = `Publishing (${fBase + (++fStep)}/${totalEvents})…`;
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
                    const resp = await sendForensic(unsigned);
                    if (resp && resp.ok && resp.results) {
                        recordRelayResults(resp.results);
                        if (await publishOk(resp)) {
                            revEdgeResults.ok++;
                            try { await EvidenceLinker.markPublished(sel.link.id, resp.signedEvent?.id || null); }
                            catch (_) { /* best-effort */ }
                        } else {
                            revEdgeResults.fail++;
                            revEdgeResults.errors.push(`${sel.link.relationship} edge: no relays accepted`);
                        }
                    } else {
                        revEdgeResults.fail++;
                        revEdgeResults.errors.push(`${sel.link.relationship} edge: ${(resp && resp.error) || 'unknown'}`);
                    }
                } catch (err) {
                    revEdgeResults.fail++;
                    revEdgeResults.errors.push(`${sel.link.relationship} edge: ${err.message || String(err)}`);
                    console.warn('[X-Ray Reader] revision-edge publish failed:', sel.link.id, err);
                }
                setProgress(fBase + fStep, totalEvents);
                await sleep(BATCH_PUBLISH_DELAY_MS);
            }
            refreshFindingsBar().catch(() => {});
        }

        // ---- Truth adjudication (Phase 15, flag-gated) ----------------
        // Behind `truthAdjudicationPublishing` (default off): adjudicated
        // verdicts (30063) + their kind-1985 claim-coordinate mirrors +
        // integrity findings (30064 — no mirror, by design). Chain heads
        // only; a verdict/finding waits until its propositions' claims
        // are published (the coordinates are the wire identity), and an
        // integrity finding additionally needs its subject entity keyed.
        // Runs after claims for exactly that reason.
        const verdictResults   = { ok: 0, fail: 0, errors: [] };
        const vMirrorResults   = { ok: 0, fail: 0, errors: [] };
        const integrityResults = { ok: 0, fail: 0, errors: [] };
        let verdictSel = [], vMirrorSel = [], integritySel = [];
        let resolveEvidenceCoord = null;
        if (isEnabled('truthAdjudicationPublishing')) {
            const [verdictList, propList, integrityList, claimsT, entitiesT, canonT] = await Promise.all([
                VerdictModel.list(), TruthAdjudicationModel.list(), IntegrityModel.list(),
                ClaimModel.getAll(), EntityModel.getAll(), makeClaimRefCanonicalizer()
            ]);
            const verdictsT = Object.fromEntries(verdictList.map((v) => [v.id, v]));
            const propsT = Object.fromEntries(propList.map((p) => [p.id, p]));
            const integrityT = Object.fromEntries(integrityList.map((f) => [f.id, f]));
            verdictSel   = selectVerdictsToPublish({ verdicts: verdictsT, propositions: propsT, claims: claimsT, canon: canonT, findings: integrityT });
            vMirrorSel   = selectVerdictMirrors({ verdicts: verdictsT, propositions: propsT, claims: claimsT, canon: canonT });
            integritySel = selectIntegrityFindingsToPublish({
                findings: integrityT, propositions: propsT, claims: claimsT, entities: entitiesT, canon: canonT, verdicts: verdictsT
            });
            // Grounded evidence: resolve a linked local claim to its
            // published 30040 coordinate so the evidence-* tags carry
            // followable refs. Unpublished → '' (omitted this batch).
            resolveEvidenceCoord = (ref) => {
                const info = claimWireInfo(claimsT, ref);
                return (info && info.coord) || '';
            };
        }
        const truthTotal = verdictSel.length + vMirrorSel.length + integritySel.length;
        if (truthTotal > 0) {
            const tBase = totalEvents;
            totalEvents += truthTotal;
            let tStep = 0;
            toast(`Also publishing adjudications: ${verdictSel.length} verdict${verdictSel.length === 1 ? '' : 's'}`
                  + (vMirrorSel.length ? ` + ${vMirrorSel.length} mirror${vMirrorSel.length === 1 ? '' : 's'}` : '')
                  + (integritySel.length ? ` + ${integritySel.length} integrity finding${integritySel.length === 1 ? '' : 's'}` : '')
                  + '…', 'warning', 4000);

            const sendTruth = async (unsigned) => {
                unsigned.pubkey = userPubkey;
                return await browserApi.runtime.sendMessage({
                    type: 'xray:capture:publish', id: state.id, event: unsigned
                });
            };

            // Verdicts (kind 30063). Track failures so their mirror
            // doesn't emit against a coordinate that isn't on relays.
            const failed30063 = new Set();
            for (const sel of verdictSel) {
                btn.textContent = `Publishing (${tBase + (++tStep)}/${totalEvents})…`;
                let landed = false;
                try {
                    const rc = sel.proposition.resolution_criteria || {};
                    const { event: unsigned, dTag } = await buildAdjudicatedVerdictEvent({
                        claimCoord:        sel.coord,
                        propositionClass:  sel.proposition.proposition_class,
                        verdict:           sel.verdict.verdict,
                        caveats:           sel.verdict.caveats,
                        evidenceFor:       wireEvidence(sel.verdict.evidence_for, resolveEvidenceCoord),
                        evidenceAgainst:   wireEvidence(sel.verdict.evidence_against, resolveEvidenceCoord),
                        standardOfProof:   sel.verdict.standard_of_proof,
                        resolutionCriteria: {
                            criteria:     rc.criteria,
                            horizon:      rc.horizon,
                            horizonIso:   rc.horizon_iso,
                            hedgeLevel:   rc.hedge_level,
                            tractability: rc.tractability
                        },
                        subjectRole:       sel.proposition.subject_role,
                        occurredAt:        sel.proposition.occurred_at,
                        occurredPrecision: sel.proposition.occurred_precision,
                        method:            sel.verdict.method,
                        rationale:         sel.verdict.rationale,
                        precedents:        sel.precedents,
                        replyEventIds:     sel.verdict.reply_refs || [],
                        exposure:          sel.verdict.exposure || '',
                        supersedesEventId: sel.supersedesEventId,
                        sourceUrl:         sel.url,
                        suggestedBy:       sel.verdict.suggested_by || 'user'
                    });
                    const resp = await sendTruth(unsigned);
                    if (resp && resp.ok && resp.results) {
                        recordRelayResults(resp.results);
                        if (await publishOk(resp)) {
                            verdictResults.ok++;
                            landed = true;
                            try { await VerdictModel.markPublished(sel.verdict.id, resp.signedEvent?.id || null, userPubkey, dTag); }
                            catch (_) { /* best-effort */ }
                        } else {
                            verdictResults.fail++;
                            verdictResults.errors.push(`${sel.verdict.verdict}: no relays accepted`);
                        }
                    } else {
                        verdictResults.fail++;
                        verdictResults.errors.push(`${sel.verdict.verdict}: ${(resp && resp.error) || 'unknown'}`);
                    }
                } catch (err) {
                    verdictResults.fail++;
                    verdictResults.errors.push(`${sel.verdict.verdict}: ${err.message || String(err)}`);
                    console.warn('[X-Ray Reader] verdict publish failed:', sel.verdict.id, err);
                }
                if (!landed) failed30063.add(sel.verdict.id);
                setProgress(tBase + tStep, totalEvents);
                await sleep(BATCH_PUBLISH_DELAY_MS);
            }

            // Verdict mirrors (kind 1985 — labels the claim coordinate,
            // never a pubkey). Skip a candidate whose 30063 failed this
            // batch.
            for (const sel of vMirrorSel) {
                btn.textContent = `Publishing (${tBase + (++tStep)}/${totalEvents})…`;
                if (failed30063.has(sel.verdict.id)) {
                    setProgress(tBase + tStep, totalEvents);
                    await sleep(BATCH_PUBLISH_DELAY_MS);
                    continue;
                }
                try {
                    const { event: unsigned } = buildVerdictMirrorEvent({
                        claimCoord: sel.coord,
                        verdict:    sel.verdict.verdict,
                        sourceUrl:  sel.url
                    });
                    const resp = await sendTruth(unsigned);
                    if (resp && resp.ok && resp.results) {
                        recordRelayResults(resp.results);
                        if (await publishOk(resp)) {
                            vMirrorResults.ok++;
                            try { await VerdictModel.markMirrored(sel.verdict.id); }
                            catch (_) { /* best-effort */ }
                        } else { vMirrorResults.fail++; vMirrorResults.errors.push('verdict mirror: no relays accepted'); }
                    } else {
                        vMirrorResults.fail++;
                        vMirrorResults.errors.push(`verdict mirror: ${(resp && resp.error) || 'unknown'}`);
                    }
                } catch (err) {
                    vMirrorResults.fail++;
                    vMirrorResults.errors.push(`verdict mirror: ${err.message || String(err)}`);
                }
                setProgress(tBase + tStep, totalEvents);
                await sleep(BATCH_PUBLISH_DELAY_MS);
            }

            // Integrity findings (kind 30064 — full event only, no mirror).
            for (const sel of integritySel) {
                btn.textContent = `Publishing (${tBase + (++tStep)}/${totalEvents})…`;
                try {
                    const gap = sel.finding.gap ? {
                        cause:          sel.finding.gap.cause,
                        note:           sel.finding.gap.note,
                        evidence:       wireEvidence(sel.finding.gap.evidence, resolveEvidenceCoord),
                        constraintCoord: sel.constraintCoord || undefined,
                        revisionCoord:  sel.revisionCoord || undefined
                    } : null;
                    const { event: unsigned, dTag } = await buildIntegrityFindingEvent({
                        subjectPubkey:     sel.subjectPubkey,
                        word:              sel.word,
                        deeds:             sel.deeds,
                        match:             sel.finding.match,
                        caveats:           sel.finding.caveats,
                        evidenceFor:       wireEvidence(sel.finding.evidence_for, resolveEvidenceCoord),
                        evidenceAgainst:   wireEvidence(sel.finding.evidence_against, resolveEvidenceCoord),
                        standardOfProof:   sel.finding.standard_of_proof,
                        gap,
                        method:            sel.finding.method,
                        rationale:         sel.finding.rationale,
                        precedents:        sel.precedents,
                        replyEventIds:     sel.finding.reply_refs || [],
                        exposure:          sel.finding.exposure || '',
                        supersedesEventId: sel.supersedesEventId,
                        sourceUrl:         sel.sourceUrl,
                        suggestedBy:       sel.finding.suggested_by || 'user'
                    });
                    const resp = await sendTruth(unsigned);
                    if (resp && resp.ok && resp.results) {
                        recordRelayResults(resp.results);
                        if (await publishOk(resp)) {
                            integrityResults.ok++;
                            try { await IntegrityModel.markPublished(sel.finding.id, resp.signedEvent?.id || null, userPubkey, dTag); }
                            catch (_) { /* best-effort */ }
                        } else {
                            integrityResults.fail++;
                            integrityResults.errors.push(`${sel.finding.match}: no relays accepted`);
                        }
                    } else {
                        integrityResults.fail++;
                        integrityResults.errors.push(`${sel.finding.match}: ${(resp && resp.error) || 'unknown'}`);
                    }
                } catch (err) {
                    integrityResults.fail++;
                    integrityResults.errors.push(`${sel.finding.match}: ${err.message || String(err)}`);
                    console.warn('[X-Ray Reader] integrity publish failed:', sel.finding.id, err);
                }
                setProgress(tBase + tStep, totalEvents);
                await sleep(BATCH_PUBLISH_DELAY_MS);
            }
        }

        // ---- Entity corpus (19.7, flag-gated) --------------------------
        // Enriched kind-0 profiles + kind-30067 fact sheets, ENTITY-
        // signed. For each tagged entity resolved to canonical: assemble
        // the dossier off ONE preloaded snapshot set, hash-compare
        // (generated_at-free) against the stored publish stamps, and
        // republish only what changed — both kinds are replaceable, so
        // retries are idempotent. Foreign/keyless entities skip (we
        // can't sign for them); the per-field checklist persisted as
        // publish_excluded_fields is honored here, which is why it is
        // persisted at all.
        const corpusResults = { ok: 0, fail: 0, errors: [] };
        let corpusSel = [];
        await loadFlags();
        if (isEnabled('entityCorpusPublishing')) {
            try {
                const entitiesAllForCorpus = await EntityModel.getAll();
                // Roots from BOTH the article-tagged refs and the entity
                // batch's selection (tagged + claim-referenced) — the
                // corpus batch owns every keyed root's kind-0 when the
                // flag is on (the legacy batch skips them), so it must
                // see everything the legacy batch would have.
                const roots = new Set();
                for (const ref of entityRefs) {
                    if (ref && ref.entity_id) roots.add(canonicalIdOf(ref.entity_id, entitiesAllForCorpus));
                }
                for (const e of entitiesToPublish) {
                    roots.add(canonicalIdOf(e.id, entitiesAllForCorpus));
                }
                // One snapshot set shared across every dossier assembly.
                const snapshots = {
                    entities: entitiesAllForCorpus,
                    claims: await ClaimModel.getAll()
                };
                for (const rootId of [...roots].sort()) {
                    const entity = entitiesAllForCorpus[rootId];
                    if (!entity || !entity.keypair || !entity.keypair.privateKey) continue;
                    const excluded = entity.publish_excluded_fields || [];
                    const dossier = await assembleEntityDossier(rootId, {
                        ...snapshots, generatedAt: Math.floor(Date.now() / 1000)
                    });
                    // 24.3 — the honest self-description line names the
                    // maintainer, so generic clients render an honestly
                    // labeled record (ENTITY_IDENTITY_DESIGN §5).
                    const about = buildProfileAbout(dossier, {
                        excludedFields: excluded,
                        maintainerNpub: userPubkey ? Crypto.hexToNpub(userPubkey) : null
                    });
                    const sheet = buildFactSheetEvent(dossier, {
                        entityPubkey: entity.keypair.pubkey,
                        publisherPubkey: userPubkey,
                        generatedAt: Math.floor(Date.now() / 1000),
                        excludedFields: excluded,
                        entities: entitiesAllForCorpus
                    });
                    // The profile gate hashes the FULL kind-0 content
                    // (name + about + nip05) — a rename must republish
                    // the enriched profile even when the about text is
                    // unchanged (19.8 review fix).
                    const [contentHash, sheetHash] = await Promise.all([
                        profileContentHash(entity, about), factSheetContentHash(sheet)
                    ]);
                    const profileChanged = contentHash !== entity.publishedProfileHash;
                    const sheetHasFacts = sheet.tags.some((t) => t[0] === 'fact');
                    // An empty sheet still publishes when a previous
                    // sheet is on relays — replaceable overwrite is the
                    // only retraction path (19.8 review fix).
                    const sheetChanged = (sheetHasFacts || entity.publishedFactSheetHash)
                        && sheetHash !== entity.publishedFactSheetHash;
                    if (profileChanged || sheetChanged) {
                        corpusSel.push({ entity, about, aboutHash: contentHash, sheet, sheetHash,
                                         profileChanged, sheetChanged });
                    }
                }
            } catch (err) {
                console.warn('[X-Ray Reader] corpus selection failed:', err);
            }
        }
        if (corpusSel.length > 0) {
            const corpusBase = totalEvents;
            totalEvents += corpusSel.reduce((n, s) =>
                n + (s.profileChanged ? 1 : 0) + (s.sheetChanged ? 1 : 0), 0);
            let cStep = 0;
            for (const sel of corpusSel) {
                const { entity } = sel;
                const canonicalNpub = null;   // roots only — never an alias here
                try {
                    if (sel.profileChanged) {
                        btn.textContent = `Publishing (${corpusBase + (++cStep)}/${totalEvents})…`;
                        const unsigned = EventBuilder.buildProfileEvent(entity, canonicalNpub, sel.about);
                        await attachCreatorBinding(unsigned, entity.keypair && entity.keypair.pubkey);
                        const signed = await LocalKeyManager.signEvent(unsigned, entity.keyName);
                        const resp = await browserApi.runtime.sendMessage({
                            type: 'xray:relay:publish', event: signed, relays: await getConfiguredRelays()
                        });
                        if (resp && resp.ok && resp.results) recordRelayResults(resp.results);
                        // signedEvent attached so publishOk journals it
                        // (the entity-batch precedent); stamp EACH
                        // surface as it lands — a later sheet failure
                        // must not lose a confirmed profile stamp.
                        if (resp && resp.ok && await publishOk({ ...resp, signedEvent: signed })) {
                            corpusResults.ok++;
                            try {
                                await EntityModel.markProfilePublished(entity.id, {
                                    profileEventId: signed.id, profileHash: sel.aboutHash
                                });
                            } catch (_) { /* best-effort */ }
                        } else {
                            corpusResults.fail++;
                            corpusResults.errors.push(`${entity.name} profile: ${(resp && resp.error) || 'no relays accepted'}`);
                        }
                        setProgress(corpusBase + cStep, totalEvents);
                        await sleep(BATCH_PUBLISH_DELAY_MS);
                    }
                    if (sel.sheetChanged) {
                        btn.textContent = `Publishing (${corpusBase + (++cStep)}/${totalEvents})…`;
                        await attachCreatorBinding(sel.sheet, entity.keypair && entity.keypair.pubkey);
                        const signedSheet = await LocalKeyManager.signEvent(sel.sheet, entity.keyName);
                        const resp = await browserApi.runtime.sendMessage({
                            type: 'xray:relay:publish', event: signedSheet, relays: await getConfiguredRelays()
                        });
                        if (resp && resp.ok && resp.results) recordRelayResults(resp.results);
                        if (resp && resp.ok && await publishOk({ ...resp, signedEvent: signedSheet })) {
                            corpusResults.ok++;
                            try {
                                await EntityModel.markProfilePublished(entity.id, {
                                    factSheetEventId: signedSheet.id, factSheetHash: sel.sheetHash
                                });
                            } catch (_) { /* best-effort */ }
                        } else {
                            corpusResults.fail++;
                            corpusResults.errors.push(`${entity.name} fact sheet: ${(resp && resp.error) || 'no relays accepted'}`);
                        }
                        setProgress(corpusBase + cStep, totalEvents);
                        await sleep(BATCH_PUBLISH_DELAY_MS);
                    }
                } catch (err) {
                    corpusResults.fail++;
                    corpusResults.errors.push(`${entity.name}: ${err.message || String(err)}`);
                    console.warn('[X-Ray Reader] corpus publish failed:', entity.id, err);
                }
            }

            // Phase 24.2 — the OwnedKeys manifest accompanies entity
            // publishes: one replaceable kind-30069 (primary-signed)
            // listing every owned entity pubkey. Fingerprint-gated —
            // republishes only when the owned set changed. Best-effort:
            // a manifest failure never fails the batch.
            try { await publishOwnedKeysManifest(); }
            catch (err) { console.warn('[X-Ray Reader] manifest publish failed:', err); }
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
            accountResults,
            accountCount: accountSel.length,
            assessResults,
            assessCount: assessSel.length,
            mirrorResults,
            mirrorCount: mirrorSel.length,
            jLinkResults,
            jLinkCount: linkSel.length,
            auditResults,
            auditCount,
            findingResults,
            findingCount: findingSel.length,
            fMirrorResults,
            fMirrorCount: fMirrorSel.length,
            revEdgeResults,
            revEdgeCount: revEdgeSel.length,
            verdictResults,
            verdictCount: verdictSel.length,
            vMirrorResults,
            vMirrorCount: vMirrorSel.length,
            integrityResults,
            integrityCount: integritySel.length,
            corpusResults,
            corpusCount: corpusSel.length,
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

// ------------------------------------------------------------------
// Creator binding (Phase 24.2 — docs/ENTITY_IDENTITY_DESIGN.md §4)
// ------------------------------------------------------------------

// The NIP-26 window on minted tokens: generous because entity events
// are replaceable and re-minted on every republish; the manifest is
// the revocation lever, not the window.
const DELEGATION_WINDOW_S = 365 * 24 * 3600;

// Attach the creator binding to an unsigned ENTITY-signed event:
// the creator p-tag always (when a primary exists); the NIP-26
// delegation tag only when the primary PRIVATE key is locally
// available (Local signing mode — NIP-07/bunker keep the secret in the
// signer, so those publishes bind via the manifest alone). Binding is
// enrichment: failures never block the publish itself.
async function attachCreatorBinding(unsigned, entityPubkey) {
    try {
        const primary = await Storage.primaryIdentity.get();
        if (!primary || !primary.pubkey) return unsigned;
        unsigned.tags = unsigned.tags || [];
        if (!unsigned.tags.some((t) => t[0] === 'p' && t[3] === 'creator')) {
            unsigned.tags.push(['p', primary.pubkey, '', 'creator']);
        }
        if (primary.privateKey && entityPubkey
                && !unsigned.tags.some((t) => t[0] === 'delegation')) {
            const now = Math.floor(Date.now() / 1000);
            const conditions = entityDelegationConditions({
                kinds: [0, 30067], from: now - 86400, until: now + DELEGATION_WINDOW_S
            });
            unsigned.tags.push(await mintDelegationTag(primary.privateKey, entityPubkey, conditions));
        }
    } catch (err) {
        console.warn('[X-Ray Reader] creator binding skipped:', err);
    }
    return unsigned;
}

// Publish the kind-30069 OwnedKeys manifest — one replaceable event,
// PRIMARY-signed, listing every owned entity pubkey. Republished only
// when the owned set changed (fingerprint gate). Local signing mode
// only in v1: the manifest needs the primary key, and the reader has
// no NIP-07 bridge of its own.
async function publishOwnedKeysManifest() {
    const primary = await Storage.primaryIdentity.get();
    if (!primary || !primary.privateKey) return;
    const owned = LocalKeyManager.listKeys()
        .filter((k) => k.name && k.name.startsWith('entity:') && k.metadata && k.metadata.entityId)
        .map((k) => ({ pubkey: k.pubkey, id: k.metadata.entityId, name: k.metadata.entityName || '' }));
    if (!owned.length) return;
    const fingerprint = await Crypto.sha256(JSON.stringify(owned.map((o) => o.pubkey).sort()));
    const prior = await Storage.get('owned_keys_manifest_hash', null);
    if (prior === fingerprint) return;   // replaceable event already current

    const unsigned = { ...buildOwnedKeysManifest({ entities: owned }), pubkey: primary.pubkey };
    const signed = await Crypto.signEvent(unsigned, primary.privateKey);
    if (!signed || !signed.sig) return;
    const resp = await browserApi.runtime.sendMessage({
        type: 'xray:relay:publish', event: signed, relays: await getConfiguredRelays()
    });
    if (resp && resp.ok && await publishOk({ ...resp, signedEvent: signed })) {
        await Storage.set('owned_keys_manifest_hash', fingerprint);
    }
}

/**
 * Every canonical hash this article has carried, current first — the
 * audit ledger may be keyed to an EARLIER capture vintage than the
 * one being published (body edited since import, or a resume after
 * the first publish restamped state.articleHash). Both the RQ6
 * back-reference map and the audit batch gather across this set.
 */
async function auditHashCandidates(currentHash, url) {
    const candidates = [currentHash];
    // Truncated-capture vintage: an over-limit article's in-reader
    // audit (and its predictions) key to the SLICE hash, not the
    // full-body hash — without this, the publish batch and prediction
    // back-references skip runs the audit panel itself displays.
    if (state.auditableHash && state.auditableHash !== state.articleHash) {
        candidates.push(state.auditableHash);
    }
    try {
        const arch = url ? await ArchiveCache.getArticle(url) : null;
        if (arch && arch.articleHash) candidates.push(arch.articleHash);
        for (const v of (arch && arch.priorVersions) || []) {
            if (v && v.articleHash) candidates.push(v.articleHash);
        }
    } catch (_) { /* archive lookup is enrichment */ }
    return [...new Set(candidates.filter(Boolean))];
}

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
        if (!entity.keypair || !entity.keypair.privateKey) return; // keyless/foreign — can't sign
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
            // E3 (Phase 17A): 32125 edges attach to the CANONICAL
            // identity — an edge minted against an alias would give the
            // knowledge graph two half-nodes for one person. Dedupe key
            // uses the canonical id so alias+canonical tagged on one
            // article collapse to a single coordinate.
            const entity = await EntityModel.resolveCanonical(entityId);
            if (!entity || !entity.keypair) continue;
            const key = `${entity.id}:${articleUrl}:${relType}`;
            if (seen.has(key)) continue;
            seen.add(key);
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
    accountResults = { ok: 0, fail: 0, errors: [] }, accountCount = 0,
    assessResults, assessCount = 0, mirrorResults, mirrorCount = 0,
    jLinkResults, jLinkCount = 0,
    auditResults = { ok: 0, fail: 0, errors: [], skipped: 0 }, auditCount = 0,
    findingResults = { ok: 0, fail: 0, errors: [] }, findingCount = 0,
    fMirrorResults = { ok: 0, fail: 0, errors: [] }, fMirrorCount = 0,
    revEdgeResults = { ok: 0, fail: 0, errors: [] }, revEdgeCount = 0,
    verdictResults = { ok: 0, fail: 0, errors: [] }, verdictCount = 0,
    vMirrorResults = { ok: 0, fail: 0, errors: [] }, vMirrorCount = 0,
    integrityResults = { ok: 0, fail: 0, errors: [] }, integrityCount = 0,
    corpusResults = { ok: 0, fail: 0, errors: [] }, corpusCount = 0,
    relayStats
}) {
    // Console breakdown (always useful for debugging)
    console.group('[X-Ray Reader] publish summary');
    console.log('total events:', totalEvents);
    if (includeComments)                                     console.log('comments:',       commentResults);
    if (entityResults && entityCount > 0)                    console.log('entities:',       entityResults);
    if (claimResults  && claimCount  > 0)                    console.log('claims:',         claimResults);
    if (relationshipResults && relationshipCount > 0)        console.log('relationships:',  relationshipResults);
    if (accountResults && accountCount > 0)                  console.log('platform accounts:', accountResults);
    if (assessResults && assessCount > 0)                    console.log('assessments:',    assessResults);
    if (mirrorResults && mirrorCount > 0)                    console.log('label mirrors:',  mirrorResults);
    if (jLinkResults && jLinkCount > 0)                      console.log('claim links:',    jLinkResults);
    if (auditResults && (auditCount > 0 || auditResults.errors.length > 0 || auditResults.skipped > 0)) console.log('audit events:', auditResults);
    if (findingResults && findingCount > 0)                  console.log('findings:',       findingResults);
    if (fMirrorResults && fMirrorCount > 0)                  console.log('finding mirrors:', fMirrorResults);
    if (revEdgeResults && revEdgeCount > 0)                  console.log('revision edges:',  revEdgeResults);
    if (verdictResults && verdictCount > 0)                  console.log('verdicts:',        verdictResults);
    if (vMirrorResults && vMirrorCount > 0)                  console.log('verdict mirrors:', vMirrorResults);
    if (integrityResults && integrityCount > 0)              console.log('integrity findings:', integrityResults);
    if (corpusResults && corpusCount > 0)                     console.log('entity corpus:', corpusResults);
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
    const acctFails = (accountResults      && accountResults.fail)      || 0;
    const jdgFails  = ((assessResults && assessResults.fail) || 0)
                    + ((mirrorResults && mirrorResults.fail) || 0)
                    + ((jLinkResults && jLinkResults.fail) || 0);
    const audFails  = (auditResults && auditResults.fail) || 0;
    const forFails  = ((findingResults && findingResults.fail) || 0)
                    + ((fMirrorResults && fMirrorResults.fail) || 0)
                    + ((revEdgeResults && revEdgeResults.fail) || 0);
    const truFails  = ((verdictResults && verdictResults.fail) || 0)
                    + ((vMirrorResults && vMirrorResults.fail) || 0)
                    + ((integrityResults && integrityResults.fail) || 0);
    const corpFails = (corpusResults && corpusResults.fail) || 0;

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
    if (accountCount > 0) {
        segments.push(`${accountResults.ok}/${accountCount} platform account${accountCount === 1 ? '' : 's'}`);
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
    if (auditCount > 0 || (auditResults && (auditResults.skipped > 0 || auditResults.fail > 0))) {
        segments.push(`${auditResults.ok}/${auditCount} audit event${auditCount === 1 ? '' : 's'}`
            + (auditResults.skipped > 0 ? ` (${auditResults.skipped} skipped)` : ''));
    }
    if (findingCount > 0) {
        segments.push(`${findingResults.ok}/${findingCount} finding${findingCount === 1 ? '' : 's'}`);
    }
    if (fMirrorCount > 0) {
        segments.push(`${fMirrorResults.ok}/${fMirrorCount} finding mirror${fMirrorCount === 1 ? '' : 's'}`);
    }
    if (revEdgeCount > 0) {
        segments.push(`${revEdgeResults.ok}/${revEdgeCount} revision edge${revEdgeCount === 1 ? '' : 's'}`);
    }
    if (verdictCount > 0) {
        segments.push(`${verdictResults.ok}/${verdictCount} verdict${verdictCount === 1 ? '' : 's'}`);
    }
    if (vMirrorCount > 0) {
        segments.push(`${vMirrorResults.ok}/${vMirrorCount} verdict mirror${vMirrorCount === 1 ? '' : 's'}`);
    }
    if (integrityCount > 0) {
        segments.push(`${integrityResults.ok}/${integrityCount} integrity finding${integrityCount === 1 ? '' : 's'}`);
    }
    if (corpusCount > 0) {
        segments.push(`${corpusResults.ok}/${corpusResults.ok + corpusResults.fail} corpus event${(corpusResults.ok + corpusResults.fail) === 1 ? '' : 's'} (profiles + fact sheets)`);
    }
    let line = 'Published: ' + segments.join(', ') + '.';

    const acceptedAll = [...relayStats.values()].filter((s) => s.fail === 0 && s.ok > 0).length;
    if (relayStats.size > 0) {
        line += ` ${acceptedAll}/${relayStats.size} relays accepted everything.`;
    }

    // Honesty line: events whose only "successes" were assumed (no OK
    // before the relay timeout). They stayed UNMARKED locally so the
    // next publish retries them — but the user should know a relay
    // went quiet rather than reading silence as acceptance.
    if (_publishUnconfirmed.count > 0) {
        line += ` ${_publishUnconfirmed.count} event${_publishUnconfirmed.count === 1 ? '' : 's'} unconfirmed (no relay OK — will retry next publish).`;
    }

    if (dead.length > 0) {
        const names = dead.map((d) => d.url.replace(/^wss?:\/\//, '')).join(', ');
        line += ` Rejected by ${names} — consider removing in Options.`;
    }

    const anyFail = dead.length > 0 || cmtFails > 0 || entFails > 0 || clmFails > 0 || relFails > 0 || acctFails > 0 || jdgFails > 0 || audFails > 0 || forFails > 0 || truFails > 0 || corpFails > 0;
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

    return totalEvents - cmtFails - entFails - clmFails - relFails - jdgFails - audFails
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

    // Prime the feature-flag cache before renderReader() so its
    // synchronous isEnabled() gates (e.g. the 19.5 "Add fact" popover
    // button) reflect the user's overrides, not the defaults.
    try { await loadFlags(); } catch (_) { /* falls back to defaults */ }

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

    // Media & transcript (Phase 22): declare what this URL contains and
    // attach a transcript to THIS capture. Hidden on read-only opens.
    setupMediaControl();

    // LLM-assist Suggest control (Phase 14.5). Absent unless the flag is
    // on; disabled (with a hint) when on but no key — so flag-off OR
    // no-key means zero network calls are possible from here.
    setupSuggestControl().catch((err) => console.warn('[X-Ray Reader] suggest setup failed:', err));

    // In-extension epistemic auditor (the LLM execution path). Same
    // gating as Suggest; absent unless llmAssist is on. Publishing the
    // resulting events stays behind `epistemicAuditing`.
    setupAuditRunControl().catch((err) => console.warn('[X-Ray Reader] audit-run setup failed:', err));
    setupLensControl().catch((err) => console.warn('[X-Ray Reader] lens setup failed:', err));

    // Epistemic-audit import (13.5): button → hidden file input →
    // importAuditJson with the RQ1 gate (re-hash + schema-validate +
    // match against THIS capture's hash). Local-only and ungated —
    // publishing the audit events is 13.8, behind the flag.
    $('#xr-audit-import').addEventListener('click', () => $('#xr-audit-file').click());
    $('#xr-audit-file').addEventListener('change', async (ev) => {
        const file = ev.target.files && ev.target.files[0];
        ev.target.value = '';
        if (!file) return;
        // The capture-match half of the RQ1 gate NEEDS the capture's
        // hash — without it (read-only portal opens, hash failure) an
        // import would be silently ungated. Refuse rather than weaken;
        // the options importer matches against the archive instead.
        if (!state.articleHash) {
            toast('This view has no capture hash to verify against — import from Settings → Advanced → Epistemic audits instead.', 'error', 7000);
            return;
        }
        try {
            const parsed = JSON.parse(await file.text());
            // Same gate as the options importer: the audit may match
            // the CURRENT capture or a retained prior vintage of this
            // URL — both are text the user actually captured. The
            // single-hash check refused legitimate prior-version
            // audits the options surface accepted.
            const body = parsed && parsed.article && parsed.article.body_markdown;
            const claimed = typeof body === 'string' && body ? await canonicalArticleHash(body) : null;
            const candidates = await auditHashCandidates(state.articleHash, state.article.url);
            if (!claimed || !candidates.includes(claimed)) {
                throw new Error('no capture of this article matches the audit\'s text — re-run the scorer against the current capture');
            }
            const summary = await importAuditJson(parsed, { localArticleHash: claimed });
            const bits = [`${summary.modulesValid} module${summary.modulesValid === 1 ? '' : 's'} valid`];
            if (summary.modulesFailed) bits.push(`${summary.modulesFailed} failed validation`);
            if (summary.predictionsImported) bits.push(`${summary.predictionsImported} prediction${summary.predictionsImported === 1 ? '' : 's'}`);
            if (summary.predictionsSkipped) bits.push(`${summary.predictionsSkipped} prediction${summary.predictionsSkipped === 1 ? '' : 's'} skipped`);
            toast(summary.alreadyImported
                ? (summary.ledgerUpdated
                    ? `Audit re-imported — ledger updated; changed events re-publish (${bits.join(', ')})`
                    : `Audit already imported — ledger unchanged (${bits.join(', ')})`)
                : `Audit imported — ${bits.join(', ')}`,
            summary.modulesFailed ? 'warning' : 'success', 5000);
            await refreshAuditStatus();
        } catch (err) {
            toast('Audit import failed: ' + (err && err.message), 'error', 7000);
        }
    });
    refreshAuditStatus().catch((err) => console.warn('[X-Ray Reader] audit status failed:', err));

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

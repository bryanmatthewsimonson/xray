// Corpus-scale audit plan + shared draft store — CA.1
// (docs/CORPUS_AUDIT_KICKOFF.md). The pure half of "Audit corpus…":
// for each archive-backed case member, compute the EXACT auditable
// text + hash the reader's audit buttons would (same assembleArticleBody
// → auditableSlice → canonical hash pipeline), then join against the
// runs ledger so already-audited members are free (P9: old runs stay
// valid under their recorded versions — this plan never re-runs them).
//
// The draft store here is the SAME storage keys the reader's thorough
// path uses (xray:audit:draft:<hash>) — a reader-started draft resumes
// in the portal and vice versa; a crash mid-corpus costs nothing
// already paid for. The one-request-builder rule (the corpus-v4
// lesson) applies: the portal runner sends byte-identical
// xray:audit:module requests, so runs, drafts, and staleness semantics
// never fork.

import { EventBuilder } from '../event-builder.js';
import { auditableSlice } from './assemble.js';
import { articleHash } from './article-hash.js';

// The reader's draft prefix, shared verbatim (pinned in tests against
// the reader source so the two can never drift apart).
export const AUDIT_DRAFT_PREFIX = 'xray:audit:draft:';

function storageArea() {
    if (typeof browser !== 'undefined' && browser.storage) return browser.storage.local;
    if (typeof chrome !== 'undefined' && chrome.storage) return chrome.storage.local;
    return null;
}

/**
 * The corpus audit plan. `records` are archive records (case members);
 * `runs` is the audit ledger (listRuns()). Members join as audited via
 * the run's articleHash OR its captureArticleHash alias (truncated
 * captures key their runs to the slice hash — the alias is how
 * capture-keyed surfaces still find them).
 *
 * @returns {Promise<{pending: Array, audited: Array, skipped: Array}>}
 *   entries: { url, title, markdown, truncated, chars, localHash,
 *              captureHash }
 */
export async function planCorpusAudit({ records = [], runs = [] } = {}) {
    const runHashes = new Set();
    for (const r of runs) {
        if (r && r.articleHash) runHashes.add(r.articleHash);
        if (r && r.captureArticleHash) runHashes.add(r.captureArticleHash);
    }
    const pending = [];
    const audited = [];
    const skipped = [];
    for (const rec of records) {
        if (!rec || !rec.article) continue;
        const fullBody = EventBuilder.assembleArticleBody(rec.article) || '';
        if (!fullBody.trim()) {
            skipped.push({ url: rec.url || '', why: 'no auditable text' });
            continue;
        }
        const slice = auditableSlice(fullBody);
        const localHash = await articleHash(slice.text);
        const entry = {
            url: rec.url || '',
            title: (rec.article && rec.article.title) || rec.url || '',
            markdown: slice.text,
            truncated: !!slice.truncated,
            chars: slice.text.length,
            localHash,
            // The join alias for truncated captures (import.js stores it
            // only when it differs from the slice hash).
            captureHash: (rec.articleHash && rec.articleHash !== localHash) ? rec.articleHash : null,
            metadata: memberAuditMetadata(rec)
        };
        const done = runHashes.has(localHash) || (rec.articleHash && runHashes.has(rec.articleHash));
        (done ? audited : pending).push(entry);
    }
    return { pending, audited, skipped };
}

/** The metadata block assembleAudit expects, from an archive record. */
export function memberAuditMetadata(rec) {
    const a = (rec && rec.article) || {};
    return {
        url: rec.url || a.url || null,
        headline: a.title || null,
        byline: a.author || a.byline || null,
        publication_date: a.date || a.publishedTime || null
    };
}

// ------------------------------------------------------------------
// The shared draft store (the reader's exact keys + RMW chaining)
// ------------------------------------------------------------------

export async function loadAuditDraft(hash) {
    const area = storageArea();
    if (!area) return null;
    try {
        const res = await new Promise((resolve) => area.get(AUDIT_DRAFT_PREFIX + hash, (r) => resolve(r || {})));
        const draft = res[AUDIT_DRAFT_PREFIX + hash];
        return (draft && typeof draft === 'object' && draft.modules) ? draft : null;
    } catch (_) { return null; }
}

// Draft writes are a read-modify-write of ONE key from concurrent
// orchestrator workers — chain them so no completed module is dropped
// (the reader's documented race, same fix).
let _draftChain = Promise.resolve();
export function appendAuditDraft(hash, moduleName, findings, model) {
    _draftChain = _draftChain.then(async () => {
        const area = storageArea();
        if (!area) return;
        const key = AUDIT_DRAFT_PREFIX + hash;
        const res = await new Promise((resolve) => area.get(key, (r) => resolve(r || {})));
        const draft = (res[key] && res[key].modules) ? res[key] : { modules: {} };
        draft.modules[moduleName] = findings;
        if (model) draft.model = model;
        await new Promise((resolve) => area.set({ [key]: draft }, () => resolve()));
    }).catch(() => { /* draft durability is best-effort */ });
    return _draftChain;
}

export async function clearAuditDraft(hash) {
    const area = storageArea();
    if (!area) return;
    try { await new Promise((resolve) => area.remove(AUDIT_DRAFT_PREFIX + hash, () => resolve())); }
    catch (_) { /* stale drafts are re-offered, never fatal */ }
}

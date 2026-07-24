// Map artifacts — the durable per-article extraction layer
// (docs/MAP_ARTIFACT_KICKOFF.md, MA.1).
//
// Every corpus map pass (Analyze / Pre-analyze / auto-pre-analyze /
// entity-page ensureExtracts) folds its extract into ONE per-article
// record in the `article-extractions` store — knowledge, not cache.
// The fingerprint-keyed `corpus-extracts` cache survives beside it as
// the exact-reuse hint; THIS record is the accumulating asset: a
// prompt bump or a new case frame diffs new atoms in, it never
// discards what was already bought.
//
// The two disciplines this module institutionalizes:
//
//   - unreviewed ≠ disposable. Assertions are parked proposals with
//     durable triage ('open'/'accepted'/'dismissed'); only a human
//     Accept mints a claim, but nothing evaporates while it waits.
//   - claims-free storage (the corpus-v4 lesson, kept). The record
//     never stores claim_ref or any join against the claim registry —
//     coverage is computed on read against the CURRENT claim set
//     (assertionClaimCoverage). The only claim id on the record is
//     accepted_claim_id, which records a human action.
//
// Pure core (mergeExtractIntoRecord + helpers) with a thin storage
// wrapper (recordArticleExtraction). No chrome, no network, no DOM.

import { Utils } from './utils.js';
import { createGroundingIndex, isGroundingIndex } from './quote-grounding.js';
import { getArticleExtraction, saveArticleExtraction } from './audit/audit-cache.js';
import { MAP_PROMPT_VERSION } from './corpus-prompts.js';

// Two grounded spans are the SAME assertion when their overlap covers
// at least this fraction of the shorter span. Deliberately mechanical:
// content addressing by span, no semantic dedup, no similarity guess
// (P4/P9). Below the threshold both atoms are kept — over-splitting is
// reviewable, silent merging is not.
export const ASSERTION_OVERLAP_MIN = 0.6;

// The idempotence ledger is bounded: one entry per distinct
// (text × frame × prompt) fingerprint ever folded. Eviction is safe —
// a re-fold of an evicted key re-runs the merge, which dedups to a
// no-op — so the cap only bounds growth, it never loses assertions.
export const MERGED_KEYS_MAX = 64;

// ------------------------------------------------------------------
// Identity helpers
// ------------------------------------------------------------------

/** Span identity within one record: the canonical text is pinned by
 * the articleHash, so [start, end) is stable and unique. */
function assertionKey(start, end) {
    return `a:${start}-${end}`;
}

/** Normalized content identity for sources / open questions. The cap
 * treats near-identical long strings as one entry — acceptable dedup,
 * never data loss (the full text is stored on the row). */
function normIdent(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 160);
}

function overlapFraction(a, b) {
    const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
    if (overlap <= 0) return 0;
    const shorter = Math.min(a.end - a.start, b.end - b.start);
    return shorter > 0 ? overlap / shorter : 0;
}

function emptyRecord(articleHash) {
    return {
        articleHash,
        url: null,
        title: null,
        assertions: [],
        sources: [],
        open_questions: [],
        positions: [],
        merged_keys: [],
        dropped_ungrounded: 0,
        updatedAt: 0
    };
}

// ------------------------------------------------------------------
// The merge — pure, idempotent, triage-preserving
// ------------------------------------------------------------------

/**
 * Fold one map extract into the member's durable record.
 *
 * @param {object|null} existing  the stored record, or null
 * @param {object} input
 * @param {object} input.member   buildMemberUnits unit ({article_hash, url, title, text})
 * @param {object} input.extract  validated map-tool output
 * @param {object} [input.frame]  { caseName, scopeQuestion }
 * @param {string} input.key      corpusExtractKey of the extract's inputs
 * @param {string} [input.model]
 * @param {string} [input.promptVersion]
 * @param {number} [input.now]    epoch seconds
 * @param {object} [input.index]  reusable createGroundingIndex(member.text)
 * @returns {{record: object, changed: boolean, added: number, droppedUngrounded: number}}
 */
export function mergeExtractIntoRecord(existing, { member, extract, frame = {}, key, model = '', promptVersion = MAP_PROMPT_VERSION, now = 0, index = null }) {
    const base = existing || emptyRecord(member.article_hash);
    // Idempotence short-circuit BEFORE any grounding work: a fold of an
    // already-folded fingerprint is free.
    if (key && (base.merged_keys || []).includes(key)) {
        return { record: base, changed: false, added: 0, droppedUngrounded: 0 };
    }

    const record = {
        ...emptyRecord(member.article_hash),
        ...base,
        assertions: [...(base.assertions || [])],
        sources: [...(base.sources || [])],
        open_questions: [...(base.open_questions || [])],
        positions: [...(base.positions || [])],
        merged_keys: [...(base.merged_keys || [])]
    };
    record.url = member.url || record.url;
    record.title = member.title || record.title;

    const idx = isGroundingIndex(index) ? index : createGroundingIndex((member && member.text) || '');
    const firstSeen = {
        model: model || '',
        promptVersion,
        caseName: (frame && frame.caseName) || '',
        scopeQuestion: (frame && frame.scopeQuestion) || '',
        at: now
    };

    let added = 0;
    let droppedUngrounded = 0;

    // Assertions — grounded or dropped (P3/P4); the stored quote is the
    // article's OWN span, never the model's copy. claim_ref, if the
    // caller passed a linked extract, is deliberately NOT copied
    // (claims-free storage — coverage is computed on read).
    const spans = record.assertions.map((a) => ({ start: a.start, end: a.end }));
    for (const a of (extract && extract.key_assertions) || []) {
        const g = idx.ground(a && a.quote);
        if (!g || g.status === 'missing') { droppedUngrounded += 1; continue; }
        const span = { start: g.start, end: g.end };
        const dup = spans.some((s) => overlapFraction(s, span) >= ASSERTION_OVERLAP_MIN);
        if (dup) continue;   // same atom — first sighting (and its triage) kept
        spans.push(span);
        record.assertions.push({
            key: assertionKey(g.start, g.end),
            quote: g.exact,
            start: g.start,
            end: g.end,
            why: (a && a.why_load_bearing) || '',
            status: 'open',
            accepted_claim_id: null,
            triaged_at: null,
            first_seen: firstSeen
        });
        added += 1;
    }

    // Sources + open questions — content-deduped, accumulated. These
    // were paid for on every map call and previously consumed by
    // nothing; the record is where they become findable.
    const srcSeen = new Set(record.sources.map((s) => s.key));
    for (const s of (extract && extract.source_references) || []) {
        const k = `s:${normIdent(((s && s.target_hint) || '') + '|' + ((s && s.quote) || ''))}`;
        if (!s || !(s.quote || s.target_hint) || srcSeen.has(k)) continue;
        srcSeen.add(k);
        record.sources.push({ key: k, quote: s.quote || '', target_hint: s.target_hint || '', first_seen: firstSeen });
        added += 1;
    }
    const qSeen = new Set(record.open_questions.map((q) => q.key));
    for (const q of (extract && extract.open_questions) || []) {
        const k = `q:${normIdent(q)}`;
        if (!q || qSeen.has(k)) continue;
        qSeen.add(k);
        record.open_questions.push({ key: k, text: q, first_seen: firstSeen });
        added += 1;
    }

    // Position — per case frame, latest-wins (a re-analyze under the
    // same frame refreshes it; a different frame appends beside it).
    const pos = extract && extract.position;
    if (pos && (pos.summary || pos.side_label)) {
        const same = (p) => p.caseName === firstSeen.caseName && p.scopeQuestion === firstSeen.scopeQuestion;
        const entry = {
            caseName: firstSeen.caseName,
            scopeQuestion: firstSeen.scopeQuestion,
            summary: pos.summary || '',
            side_label: pos.side_label || null,
            model: firstSeen.model,
            promptVersion,
            at: now
        };
        const at = record.positions.findIndex(same);
        if (at >= 0) record.positions[at] = entry;
        else record.positions.push(entry);
    }

    if (key) {
        record.merged_keys.push(key);
        if (record.merged_keys.length > MERGED_KEYS_MAX) {
            record.merged_keys = record.merged_keys.slice(-MERGED_KEYS_MAX);
        }
    }
    record.dropped_ungrounded = (base.dropped_ungrounded || 0) + droppedUngrounded;
    record.updatedAt = now;

    return { record, changed: true, added, droppedUngrounded };
}

// ------------------------------------------------------------------
// Read-side helpers — coverage and triage are computed/applied here so
// every surface shares one semantics
// ------------------------------------------------------------------

/**
 * Which stored assertions are already covered by an EXISTING claim —
 * computed on read against the CURRENT claim set, by quote-span
 * overlap in the same canonical text (the linkAssertionsToClaims
 * mechanics; ties break to the smaller claim id). Returns
 * assertion.key → claim id | null. Never persisted.
 *
 * @param {object} record   the stored extraction record
 * @param {object} member   buildMemberUnits unit (text + claims)
 * @param {object} [index]  reusable grounding index over member.text
 */
export function assertionClaimCoverage(record, member, index = null) {
    const out = {};
    const assertions = (record && record.assertions) || [];
    if (assertions.length === 0) return out;
    const idx = isGroundingIndex(index) ? index : createGroundingIndex((member && member.text) || '');

    const claimSpans = [];
    for (const c of (member && member.claims) || []) {
        if (!c || !c.id || !c.quote) continue;
        const g = idx.ground(c.quote);
        if (g.status !== 'missing') claimSpans.push({ id: c.id, start: g.start, end: g.end });
    }
    for (const a of assertions) {
        let best = null;
        let bestOverlap = 0;
        for (const s of claimSpans) {
            const overlap = Math.min(a.end, s.end) - Math.max(a.start, s.start);
            if (overlap <= 0) continue;
            if (!best || overlap > bestOverlap || (overlap === bestOverlap && s.id < best.id)) {
                best = s;
                bestOverlap = overlap;
            }
        }
        out[a.key] = best ? best.id : null;
    }
    return out;
}

/** Status partition for the review surface. Unknown statuses are OPEN —
 * an unrecognized value must never hide an assertion (27 S.3). */
export function partitionAssertions(record) {
    const open = [];
    const accepted = [];
    const dismissed = [];
    for (const a of (record && record.assertions) || []) {
        if (a.status === 'accepted') accepted.push(a);
        else if (a.status === 'dismissed') dismissed.push(a);
        else open.push(a);
    }
    return { open, accepted, dismissed };
}

/**
 * Apply a triage decision to one assertion — pure; returns the new
 * record (the caller persists). `status` 'accepted' carries the minted
 * claim id; 'dismissed' clears none of the atom's content (a dismissal
 * is remembered, not a deletion); 'open' re-opens.
 */
export function setAssertionTriage(record, key, status, { claimId = null, now = 0 } = {}) {
    const assertions = ((record && record.assertions) || []).map((a) => {
        if (a.key !== key) return a;
        return {
            ...a,
            status,
            accepted_claim_id: status === 'accepted' ? (claimId || a.accepted_claim_id) : a.accepted_claim_id,
            triaged_at: status === 'open' ? null : now
        };
    });
    return { ...record, assertions, updatedAt: now };
}

// ------------------------------------------------------------------
// Storage wrapper — the one fold entry point every map runner calls
// ------------------------------------------------------------------

/**
 * Fold an extract into the member's durable record. NEVER throws — a
 * fold failure is logged and reported in the return value; it must not
 * disturb the paid run that produced the extract (the extract is still
 * in the fingerprint cache; the next run re-folds it).
 *
 * Called on cache HITS as well as fresh calls: hit-folding is what
 * backfills records for extracts prepaid before this layer existed,
 * and the merged_keys short-circuit makes it O(1) afterwards.
 *
 * @param {object} opts  { member, extract, frame, key, model, promptVersion, index }
 * @param {object} [io]  injectable for tests: getRecord, saveRecord, now
 * @returns {Promise<{status: 'saved'|'unchanged'|'skipped'|'failed', added?: number,
 *                    droppedUngrounded?: number, error?: string}>}
 */
export async function recordArticleExtraction(opts, io = {}) {
    const d = {
        getRecord: getArticleExtraction,
        saveRecord: saveArticleExtraction,
        now: () => Math.floor(Date.now() / 1000),
        ...io
    };
    try {
        const { member, extract } = opts || {};
        if (!member || !member.article_hash || !extract) return { status: 'skipped' };
        const existing = await Promise.resolve(d.getRecord(member.article_hash)).catch(() => null);
        const { record, changed, added, droppedUngrounded } = mergeExtractIntoRecord(existing, { ...opts, now: d.now() });
        if (!changed) return { status: 'unchanged', added: 0, droppedUngrounded: 0 };
        await d.saveRecord(record);
        return { status: 'saved', added, droppedUngrounded };
    } catch (err) {
        Utils.error('map-artifacts: fold failed (the extract stays cached; the next run re-folds)', err);
        return { status: 'failed', error: (err && err.message) || String(err) };
    }
}

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
export function mergeExtractIntoRecord(existing, { member, extract, frame = {}, key, model = '', promptVersion = MAP_PROMPT_VERSION, now = 0, index = null, producer = 'map' }) {
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
        // MA.4 — WHICH pass found this atom: 'map' (the corpus map
        // stage) or 'suggest' (the reader's extraction pass). Both are
        // claim-shaped output grounded in the same canonical text, so
        // they share this layer and its span-dedup; the stamp keeps the
        // provenance honest on the review surfaces. Absent on records
        // written before MA.4 — readers treat that as 'map'.
        producer: producer === 'suggest' ? 'suggest' : 'map',
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
            // MA.4: the suggest pass authors a CLAIM TEXT beside the
            // quote (a paraphrase of the assertion). Keep it — the
            // review surface prefills the mint box with it instead of
            // the raw span, which is the whole value the suggest pass
            // adds over the map. Map assertions have none (null).
            text: (a && typeof a.text === 'string' && a.text.trim()) ? a.text.trim() : null,
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
    let positionChanged = false;
    const pos = extract && extract.position;
    if (pos && (pos.summary || pos.side_label)) {
        positionChanged = true;
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

    // `changed` reports whether this fold actually altered anything.
    // A keyed fold always counts (merged_keys grew, which is what makes
    // the next identical fold free). A KEYLESS fold — the MA.4 suggest
    // path, which has no fingerprint to dedup on — must report false
    // when every atom deduped, or every Suggest run would rewrite the
    // record and bump updatedAt for nothing.
    const changed = !!key || added > 0 || droppedUngrounded > 0 || positionChanged
        || (!existing);
    if (!changed) return { record: base, changed: false, added: 0, droppedUngrounded: 0 };
    return { record, changed, added, droppedUngrounded };
}

/**
 * MA.4 — convert the reader Suggest pass's CLAIM proposals into the
 * map-extract shape, so both producers of claim-shaped atoms flow
 * through ONE merge path (`mergeExtractIntoRecord`) and therefore share
 * one span-dedup rule, one triage model, and one review surface. The
 * same sentence found by both passes is ONE atom, not two rows.
 *
 * Only `kind: 'claim'` proposals convert: they are the claim-shaped
 * atoms this layer holds. Entities / assessments / relationships /
 * findings / baselines are different artifacts with their own models
 * and stay the review modal's business — folding them here would
 * invent a storage contract this record does not have.
 *
 * Pure. `quote` becomes the grounded span (the merge re-grounds it
 * against the canonical text and drops it if absent); `text` rides as
 * the suggested claim text.
 *
 * @param {Array} proposals  raw suggest-pass proposals
 * @returns {{key_assertions: Array<{quote,text,why_load_bearing}>}}
 */
export function suggestExtractFromProposals(proposals) {
    const key_assertions = [];
    for (const p of Array.isArray(proposals) ? proposals : []) {
        if (!p || p.kind !== 'claim') continue;
        const quote = typeof p.quote === 'string' ? p.quote.trim() : '';
        if (!quote) continue;   // no quote ⇒ nothing to ground ⇒ not an atom here
        key_assertions.push({
            quote,
            text: typeof p.text === 'string' ? p.text.trim() : '',
            // The suggest pass states the claim rather than arguing its
            // weight, so there is no load-bearing rationale to carry.
            why_load_bearing: ''
        });
    }
    return { key_assertions };
}

// ------------------------------------------------------------------
// Record ⊕ record — the backup merge-import path
// ------------------------------------------------------------------

// A record key that actually PINS the text: the 64-hex canonical
// content hash. `buildMemberUnits` falls back to `url:<sha16(url)>`
// when an archive row has no computed hash (best-effort hashing, or a
// pre-13.4 legacy row) — that key names a URL, NOT a text, so two
// installs (or two captures over time) can hold same-key records whose
// spans index DIFFERENT bodies. Locally that is harmless (every fold
// grounds against the live member text before storing), but a
// cross-machine MERGE has no text to re-ground against, so span
// arithmetic across an unpinned key is meaningless — it would adopt a
// foreign accept/dismiss onto an unrelated sentence and insert quotes
// that appear nowhere in the local article. Those records are
// therefore skipped by the merge and the skip is disclosed.
export function isTextPinnedKey(articleHash) {
    return /^[0-9a-f]{64}$/.test(String(articleHash || ''));
}

/**
 * Merge an INCOMING extraction record (from a backup file) into the
 * LOCAL one for the same articleHash. Span-overlap dedup is exact
 * across machines and time ONLY because the 64-hex articleHash pins
 * the canonical text both sides' spans index; records under the
 * `url:` fallback key are refused (see isTextPinnedKey) rather than
 * merged on untrustworthy span arithmetic.
 *
 * Accrual rules (docs/MAP_ARTIFACT_KICKOFF.md guard rails):
 *   - assertions: local atoms all survive untouched; incoming atoms
 *     with no substantial local overlap are ADDED. On overlap, the
 *     local atom wins — EXCEPT that an incoming human triage
 *     ('accepted'/'dismissed') is adopted onto a local atom that is
 *     still 'open': a decision made anywhere beats undecided, and two
 *     conflicting decisions resolve to the LOCAL one (never silently
 *     overridden by a file).
 *   - sources / open_questions: union by content key.
 *   - positions: union by frame; on the same frame the newer `at` wins.
 *   - merged_keys: union (bounded); dropped_ungrounded: max (counts
 *     from two histories can't be summed without double-counting).
 *   - url/title: local wins, incoming fills gaps.
 *
 * Pure; returns { record, changed } — plus `skipped: 'unpinned-key'`
 * when the key does not pin a text (nothing is written in that case).
 */
export function mergeExtractionRecords(local, incoming) {
    if (!incoming) return { record: local, changed: false };
    // Refuse BOTH the merge and the wholesale add for an unpinned key:
    // an incoming url:-keyed record's spans and quotes belong to the
    // FOREIGN capture's text, which the local article may not contain.
    // Guard rail 3 (grounded or dropped) has no text to check against
    // here, so the honest move is to skip and say so.
    if (!isTextPinnedKey((local && local.articleHash) || (incoming && incoming.articleHash))) {
        return { record: local, changed: false, skipped: 'unpinned-key' };
    }
    if (!local) return { record: incoming, changed: true };

    let changed = false;
    const assertions = (local.assertions || []).map((a) => ({ ...a }));
    const spans = assertions.map((a) => ({ start: a.start, end: a.end }));
    for (const inc of incoming.assertions || []) {
        if (!inc || !inc.quote) continue;
        const span = { start: inc.start, end: inc.end };
        const at = spans.findIndex((s) => overlapFraction(s, span) >= ASSERTION_OVERLAP_MIN);
        if (at === -1) {
            assertions.push({ ...inc });
            spans.push(span);
            changed = true;
        } else if (assertions[at].status === 'open'
                && (inc.status === 'accepted' || inc.status === 'dismissed')) {
            assertions[at] = {
                ...assertions[at],
                status: inc.status,
                accepted_claim_id: inc.status === 'accepted' ? (inc.accepted_claim_id || null) : assertions[at].accepted_claim_id,
                triaged_at: inc.triaged_at || null
            };
            changed = true;
        }
    }

    const unionByKey = (localList, incList) => {
        const seen = new Set((localList || []).map((x) => x.key));
        const out = [...(localList || [])];
        for (const x of incList || []) {
            if (!x || !x.key || seen.has(x.key)) continue;
            seen.add(x.key);
            out.push(x);
            changed = true;
        }
        return out;
    };
    const sources = unionByKey(local.sources, incoming.sources);
    const open_questions = unionByKey(local.open_questions, incoming.open_questions);

    const positions = [...(local.positions || [])];
    for (const p of incoming.positions || []) {
        if (!p) continue;
        const at = positions.findIndex((q) =>
            (q.caseName || '') === (p.caseName || '') && (q.scopeQuestion || '') === (p.scopeQuestion || ''));
        if (at === -1) { positions.push(p); changed = true; }
        else if ((p.at || 0) > (positions[at].at || 0)) { positions[at] = p; changed = true; }
    }

    const mergedKeySet = new Set(local.merged_keys || []);
    const merged_keys = [...(local.merged_keys || [])];
    for (const k of incoming.merged_keys || []) {
        if (mergedKeySet.has(k)) continue;
        mergedKeySet.add(k);
        merged_keys.push(k);
        changed = true;
    }

    const record = {
        ...local,
        url: local.url || incoming.url || null,
        title: local.title || incoming.title || null,
        assertions,
        sources,
        open_questions,
        positions,
        merged_keys: merged_keys.slice(-MERGED_KEYS_MAX),
        dropped_ungrounded: Math.max(local.dropped_ungrounded || 0, incoming.dropped_ungrounded || 0),
        updatedAt: Math.max(local.updatedAt || 0, incoming.updatedAt || 0)
    };
    if ((record.dropped_ungrounded !== (local.dropped_ungrounded || 0))
        || record.updatedAt !== (local.updatedAt || 0)
        || (!local.url && record.url) || (!local.title && record.title)) changed = true;
    return { record, changed };
}

// ------------------------------------------------------------------
// MA.3 — the durable layer feeds the reduce
// ------------------------------------------------------------------

// Per-member assertion bound for the reduce input. Records accumulate
// across prompts, frames, and months; the reduce doesn't need an
// unbounded tail, and the live run's own assertions are never dropped
// to make room — only record-only extras are capped. Callers disclose
// nothing extra: the union only ever ADDS to what the run alone would
// have sent.
export const MAX_REDUCE_ASSERTIONS_PER_MEMBER = 24;

function recordAssertionRows(assertions) {
    // Dismissed assertions stay out of the reduce input: a human said
    // "not load-bearing", and re-feeding them would relitigate that
    // decision on every run. Open AND accepted both go — accepted ones
    // are the corpus's strongest atoms.
    return (assertions || []).filter((a) => a && a.quote && a.status !== 'dismissed');
}

/**
 * Synthesize a reduce-input extract from a stored record alone — the
 * RECOVERY path for a member whose live map call failed this run but
 * whose durable record holds prior analysis. Position is the latest
 * stored one (article-intrinsic since corpus-v7); assertions ride as
 * {quote, why_load_bearing} in document order, capped.
 *
 * @param {object} record  the article-extractions record
 * @returns {object|null}  a map-extract-shaped object, or null if the
 *                         record holds no usable assertions or position
 */
export function reduceExtractFromRecord(record) {
    const rows = recordAssertionRows(record && record.assertions)
        .slice().sort((a, b) => (a.start || 0) - (b.start || 0))
        .slice(0, MAX_REDUCE_ASSERTIONS_PER_MEMBER);
    const positions = (record && record.positions) || [];
    const latest = positions.slice().sort((a, b) => (b.at || 0) - (a.at || 0))[0] || null;
    if (rows.length === 0 && !latest) return null;
    return {
        position: {
            summary: (latest && latest.summary) || '',
            side_label: (latest && latest.side_label) || null
        },
        key_assertions: rows.map((a) => ({ quote: a.quote, why_load_bearing: a.why || '' }))
    };
}

/**
 * Union a LIVE map extract with the member's accumulated record: the
 * run's own assertions all ride (never dropped), then record-only
 * assertions — those whose span doesn't substantially overlap any live
 * one — fill up to the cap, oldest first (stable across runs). This is
 * how an Analyze run benefits from what earlier frames, prompts, and
 * pre-analyses already found, without waiting for this run's async
 * folds to land (the live extract is already in hand, so the
 * fold-write race is irrelevant).
 *
 * Pure. `index` is the member's grounding index (built by the caller,
 * shared with brief grounding and claim linking).
 */
export function unionExtractWithRecord(extract, record, index) {
    const rows = recordAssertionRows(record && record.assertions);
    if (rows.length === 0) return extract;
    const live = (extract && extract.key_assertions) || [];
    const idx = isGroundingIndex(index) ? index : createGroundingIndex('');

    const liveSpans = [];
    for (const a of live) {
        const g = idx.ground(a && a.quote);
        if (g && g.status !== 'missing') liveSpans.push({ start: g.start, end: g.end });
    }
    const extras = rows
        .filter((r) => !liveSpans.some((s) => overlapFraction(s, { start: r.start, end: r.end }) >= ASSERTION_OVERLAP_MIN))
        .sort((a, b) => ((a.first_seen && a.first_seen.at) || 0) - ((b.first_seen && b.first_seen.at) || 0)
            || (a.start || 0) - (b.start || 0))
        .slice(0, Math.max(0, MAX_REDUCE_ASSERTIONS_PER_MEMBER - live.length))
        .map((a) => ({ quote: a.quote, why_load_bearing: a.why || '' }));
    if (extras.length === 0) return extract;
    return { ...extract, key_assertions: [...live, ...extras] };
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

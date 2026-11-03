// Extraction-record import planning — MA.7
// (docs/MAP_ARTIFACT_KICKOFF.md §MA.7).
//
// `mergeExtractionRecords` requires the LOCAL canonical body text: it
// re-locates every incoming quote there instead of trusting an offset
// from another machine. This module is how that text reaches it.
//
// WHY A SEPARATE PLANNING STEP, and not just a lookup inside the merge:
// IndexedDB has no cross-database transaction. Bodies live in
// `xray-archive`; the merge transaction is opened on `xray-audits`
// (backup.js). Even a synchronous body lookup would be impossible from
// inside that transaction — and an AWAITED one would let the transaction
// auto-commit under us. So the bodies must be resolved BEFORE the
// transaction opens, which is what this module does.
//
// It also chunks. A corpus import can carry hundreds of records, and a
// grounding index over a 60k body is ~1.9 MiB (scaling with the body —
// at the 400k map bound a full long-form transcript indexes to ~13 MiB);
// holding every body plus every index at once would be the difference
// between a working import and an out-of-memory one. Indexes stay
// transient: mergeExtractionRecords builds one per record and drops it,
// so peak is a chunk's bodies plus a single index, not 25 of them. Chunking bounds peak memory to one chunk's
// bodies and shortens each transaction. Cross-chunk atomicity is not
// lost in any meaningful sense: `mergeBackup` already disclaims
// cross-stage rollback, and re-importing the same file is idempotent
// (quote identity, not a sequence number, carries the dedup).

import { Utils } from './utils.js';
import { mergeExtractionRecords, isTextPinnedKey } from './map-artifacts.js';
import { bodiesByArticleHash } from './archive-cache.js';

// Records per transaction. Small enough that peak memory is a handful of
// bodies; large enough that a 300-record import is ~12 transactions, not
// 300. Exported so a test can force multiple chunks without a huge dump.
export const IMPORT_CHUNK_RECORDS = 25;

/**
 * Merge `article-extractions` rows from a backup dump, re-grounding
 * every incoming quote against this machine's own copy of each article.
 *
 * @param {Array<object>} rows        the dump's rows (already deserialized)
 * @param {(rows: Array<object>, deepMerge: Function) => Promise<object>} runChunk
 *        runs ONE chunk inside a transaction, with the synchronous deep
 *        merge this planner hands it. Supplied by backup.js so the
 *        transaction machinery stays in one place.
 * @param {object} [io]  injectable for tests: { bodies, now, onProgress, yieldNow }
 * @returns {Promise<{stats: object, unresolved: Array, refusals: object}>}
 *          `stats` accumulates the per-chunk counters; `unresolved` names
 *          the articles this machine holds no text for (so the caller can
 *          say WHICH ones were skipped, by URL); `refusals` totals the
 *          two distinct reasons plus the per-atom outcomes.
 */
export async function mergeExtractionRows(rows, runChunk, io = {}) {
    const d = {
        bodies: bodiesByArticleHash,
        now: () => Math.floor(Date.now() / 1000),
        onProgress: () => {},
        // Yield to the event loop between chunks so a large import does
        // not freeze the Options page mid-merge.
        yieldNow: () => new Promise((r) => setTimeout(r, 0)),
        ...io
    };
    const all = Array.isArray(rows) ? rows : [];
    const stats = { added: 0, merged: 0, kept: 0, skipped: 0 };
    const counts = { regrounded: 0, unlocated: 0, importedRulings: 0 };
    // The two refusal reasons are kept APART on purpose. "I hold no copy
    // of this text" is a gap in my archive. "I hold this text and your
    // quote is not in it" is a FINDING — either the exporter analyzed a
    // different version, or a stored quote is corrupt. Collapsing them
    // into one skip count would hide the second behind the first.
    const unresolved = [];      // no local text at all
    const unpinned = [];        // url:-keyed, refused before any text question
    const now = d.now();

    for (let i = 0; i < all.length; i += IMPORT_CHUNK_RECORDS) {
        const chunk = all.slice(i, i + IMPORT_CHUNK_RECORDS);
        const wanted = [];
        for (const row of chunk) {
            const h = row && row.articleHash;
            if (!h) continue;
            if (!isTextPinnedKey(h)) { unpinned.push({ articleHash: h, url: (row && row.url) || null }); continue; }
            wanted.push(h);
        }
        let bodies = new Map();
        if (wanted.length) {
            try { bodies = await d.bodies(wanted); }
            catch (err) {
                // A failed body lookup must not silently degrade into
                // trusting foreign offsets: with no bodies, every record
                // in this chunk refuses itself via the merge's own guard.
                Utils.error('extraction import: body resolution failed', err);
            }
        }
        for (const h of wanted) {
            if (!bodies.has(h)) {
                const row = chunk.find((r) => r && r.articleHash === h);
                unresolved.push({ articleHash: h, url: (row && row.url) || null,
                                  title: (row && row.title) || null });
            }
        }

        const deepMerge = (existing, row) => {
            const body = bodies.get(row && row.articleHash);
            const out = mergeExtractionRecords(existing === undefined ? null : existing, row, {
                localText: (body && body.text) || null,
                now
            });
            if (out && out.counts) {
                for (const k of Object.keys(counts)) counts[k] += out.counts[k] || 0;
            }
            return out;
        };

        const st = await runChunk(chunk, deepMerge);
        for (const k of Object.keys(stats)) stats[k] += (st && st[k]) || 0;
        d.onProgress({ done: Math.min(i + IMPORT_CHUNK_RECORDS, all.length), total: all.length });
        if (i + IMPORT_CHUNK_RECORDS < all.length) await d.yieldNow();
    }

    return {
        stats,
        unresolved,
        refusals: {
            noLocalText: unresolved.length,
            unpinnedKey: unpinned.length,
            unlocatedQuotes: counts.unlocated,
            regroundedQuotes: counts.regrounded,
            importedRulings: counts.importedRulings
        }
    };
}

/**
 * One human-readable line per refusal class, for the merge report.
 * Written as sentences rather than counters because the reader has to
 * decide whether to go capture something — "3 skipped" does not tell
 * them that.
 *
 * @param {object} refusals   the `refusals` block above
 * @param {Array} unresolved  the `unresolved` list above
 */
export function describeImportRefusals(refusals, unresolved = []) {
    const r = refusals || {};
    const lines = [];
    if (r.regroundedQuotes) {
        lines.push(`${r.regroundedQuotes} imported quote${r.regroundedQuotes === 1 ? '' : 's'} `
            + 're-located in this machine’s own copy of the text (foreign offsets are never trusted).');
    }
    if (r.noLocalText) {
        const names = unresolved.slice(0, 5).map((u) => u.url || u.articleHash.slice(0, 12)).join(', ');
        lines.push(`${r.noLocalText} article${r.noLocalText === 1 ? '' : 's'} skipped — this machine holds no `
            + `copy of that text, so nothing could be verified against it. Capture ${r.noLocalText === 1 ? 'it' : 'them'} `
            + `and re-import to accrue the analysis: ${names}${unresolved.length > 5 ? ', …' : ''}`);
    }
    if (r.unlocatedQuotes) {
        lines.push(`${r.unlocatedQuotes} quote${r.unlocatedQuotes === 1 ? '' : 's'} could NOT be found in the text `
            + 'this machine holds under the same identity — the export may have analyzed a different version. '
            + 'Kept on the record as a finding, never stored as a proposal.');
    }
    if (r.unpinnedKey) {
        lines.push(`${r.unpinnedKey} record${r.unpinnedKey === 1 ? '' : 's'} skipped — keyed by URL rather than by `
            + 'content hash, so there is no text for their quotes to be verified against.');
    }
    if (r.importedRulings) {
        lines.push(`${r.importedRulings} imported review decision${r.importedRulings === 1 ? '' : 's'} recorded as `
            + 'ATTRIBUTED to the exporting machine — none was applied as your own. Review them where they appear.');
    }
    return lines;
}

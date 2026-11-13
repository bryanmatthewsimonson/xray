// Recapture diff — what actually changed between the archived capture
// of a URL and the capture now open in the reader.
//
// The stealth-edit banner used to fire on any canonical-hash mismatch.
// That hash is the audit anchor (Phase 13.4) and is byte-exact by
// design, so it also moves on extraction noise the reader never
// authored: a "3 hours ago" timestamp, a like count, a rotated image
// CDN URL, a turndown escape, a curly quote. This module never touches
// the hash. It compares the two BODIES under a looser noise
// normalization, so the banner can say "the text changed, here is how"
// — or stay quiet when only the noise moved. The prior version is
// retained in the archive either way (archive-cache.js priorVersions);
// suppressing the banner hides no text.
//
// Pure functions (diffBodies, normalizeForComparison, renderDiffHtml)
// plus the banner itself (renderRecaptureBanner), moved out of
// reader/index.js.

import { EventBuilder } from '../shared/event-builder.js';
import { Utils } from '../shared/utils.js';

// Above this many paragraph-pair cells in the changed middle, the
// diff reports a coarse count instead of aligning paragraphs.
const MAX_LCS_CELLS = 4_000_000;
// Word-level highlighting inside one changed paragraph pair.
const MAX_WORD_CELLS = 250_000;
// Unchanged paragraphs shown either side of a change.
const CONTEXT = 1;

const RELATIVE_TIME = /\b(?:about |over |almost )?(?:an?|\d+)\s*(?:s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?|w|wks?|weeks?|mo|months?|y|yrs?|years?)\s+ago\b/gi;
const ENGAGEMENT_COUNT = /\b\d[\d.,]*\s*[KkMm]?\s+(?:likes?|comments?|replies|reply|shares?|views?|restacks?|reposts?|retweets?|quotes?|bookmarks?|reactions?|subscribers?|followers?)\b/gi;

/**
 * The comparison key for one paragraph — NEVER a hash input. Drops what
 * varies between two extractions of an unedited page and keeps every
 * word the author wrote.
 */
export function normalizeForComparison(text) {
    return String(text ?? '')
        .normalize('NFKC')
        // Images reduce to their alt text: the src is a CDN path that
        // rotates sizes, formats and signatures between loads.
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        // Links keep their text and target, minus query and fragment
        // (tracking parameters, session tokens).
        .replace(/\]\(([^)\s?#]*)[?#][^)\s]*(\s+"[^"]*")?\)/g, ']($1$2)')
        .replace(/(https?:\/\/[^\s)?#]+)[?#][^\s)]*/g, '$1')
        // Turndown escapes vary with context; the character is the same.
        .replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, '$1')
        .replace(/[‘’‚′]/g, "'")
        .replace(/[“”„″]/g, '"')
        .replace(/[–—−]/g, '-')
        .replace(/…/g, '...')
        .replace(/[​-‍﻿]/g, '')
        .replace(RELATIVE_TIME, '')
        .replace(ENGAGEMENT_COUNT, '')
        // Markdown emphasis markers carry no words.
        .replace(/[*_]{1,3}/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function paragraphsOf(body) {
    return String(body ?? '')
        .replace(/\r\n/g, '\n')
        .split(/\n\s*\n/)
        .map((raw) => ({ raw: raw.trim(), key: normalizeForComparison(raw) }))
        // A paragraph that normalizes to nothing (a lone timestamp, an
        // image with no alt text) carries no words to compare.
        .filter((p) => p.key);
}

// Longest-common-subsequence alignment of two key arrays → ops.
function lcsOps(a, b, eq) {
    const n = a.length, m = b.length;
    const dp = new Array(n + 1);
    for (let i = 0; i <= n; i++) dp[i] = new Uint32Array(m + 1);
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (eq(a[i], b[j])) { ops.push({ op: 'same', a: i++, b: j++ }); }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ op: 'del', a: i++ }); }
        else { ops.push({ op: 'ins', b: j++ }); }
    }
    while (i < n) ops.push({ op: 'del', a: i++ });
    while (j < m) ops.push({ op: 'ins', b: j++ });
    return ops;
}

/** Word-level diff of two paragraphs → [{ op: 'same'|'del'|'ins', text }]. */
export function diffWords(before, after) {
    const a = String(before ?? '').split(/(\s+)/).filter(Boolean);
    const b = String(after ?? '').split(/(\s+)/).filter(Boolean);
    if (a.length * b.length > MAX_WORD_CELLS) {
        return [{ op: 'del', text: before }, { op: 'ins', text: after }];
    }
    const key = (t) => normalizeForComparison(t) || t;
    const out = [];
    for (const o of lcsOps(a, b, (x, y) => key(x) === key(y))) {
        const text = o.op === 'del' ? a[o.a] : b[o.b];
        const last = out[out.length - 1];
        if (last && last.op === o.op) last.text += text;
        else out.push({ op: o.op, text });
    }
    return out;
}

/**
 * Compare two article bodies (assembled markdown).
 *
 * @returns {{
 *   substantive: boolean,   // false → every difference was noise
 *   coarse: boolean,        // true → too large to align; counts only
 *   stats: { added: number, removed: number, changed: number },
 *   hunks: Array<Array<{ op: 'same'|'del'|'ins'|'change', before?: string, after?: string, words?: Array }>>
 * }}
 */
export function diffBodies(priorBody, currentBody) {
    const a = paragraphsOf(priorBody);
    const b = paragraphsOf(currentBody);
    const stats = { added: 0, removed: 0, changed: 0 };

    // Common prefix/suffix first: an edit is usually local, and the
    // trim keeps the quadratic alignment to the changed middle.
    let start = 0;
    while (start < a.length && start < b.length && a[start].key === b[start].key) start++;
    let endA = a.length, endB = b.length;
    while (endA > start && endB > start && a[endA - 1].key === b[endB - 1].key) { endA--; endB--; }

    if (start === endA && start === endB) {
        return { substantive: false, coarse: false, stats, hunks: [] };
    }

    const midA = a.slice(start, endA), midB = b.slice(start, endB);
    if (midA.length * midB.length > MAX_LCS_CELLS) {
        stats.removed = midA.length;
        stats.added = midB.length;
        return { substantive: true, coarse: true, stats, hunks: [] };
    }

    const rows = [];
    for (let i = 0; i < start; i++) rows.push({ op: 'same', before: a[i].raw, after: b[i].raw });
    const ops = lcsOps(midA, midB, (x, y) => x.key === y.key);
    // Pair each run of deletions with the insertions that follow it:
    // an edited paragraph shows as one "change" row with word marks.
    for (let k = 0; k < ops.length;) {
        if (ops[k].op === 'same') {
            rows.push({ op: 'same', before: midA[ops[k].a].raw, after: midB[ops[k].b].raw });
            k++; continue;
        }
        const dels = [], inss = [];
        while (k < ops.length && ops[k].op !== 'same') {
            if (ops[k].op === 'del') dels.push(midA[ops[k].a].raw);
            else inss.push(midB[ops[k].b].raw);
            k++;
        }
        const pairs = Math.min(dels.length, inss.length);
        for (let p = 0; p < pairs; p++) {
            rows.push({ op: 'change', before: dels[p], after: inss[p], words: diffWords(dels[p], inss[p]) });
            stats.changed++;
        }
        for (const d of dels.slice(pairs)) { rows.push({ op: 'del', before: d }); stats.removed++; }
        for (const s of inss.slice(pairs)) { rows.push({ op: 'ins', after: s }); stats.added++; }
    }
    for (let i = endA, j = endB; i < a.length; i++, j++) rows.push({ op: 'same', before: a[i].raw, after: b[j].raw });

    return { substantive: true, coarse: false, stats, hunks: hunksOf(rows) };
}

// Group rows into hunks: each change plus CONTEXT unchanged rows either
// side; long unchanged stretches between hunks are elided.
function hunksOf(rows) {
    const keep = new Array(rows.length).fill(false);
    rows.forEach((r, i) => {
        if (r.op === 'same') return;
        for (let k = Math.max(0, i - CONTEXT); k <= Math.min(rows.length - 1, i + CONTEXT); k++) keep[k] = true;
    });
    const hunks = [];
    let cur = null;
    rows.forEach((r, i) => {
        if (!keep[i]) { cur = null; return; }
        if (!cur) { cur = []; hunks.push(cur); }
        cur.push(r);
    });
    return hunks;
}

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

/** One-line summary of a substantive diff, for the banner. */
export function summarizeDiff(diff) {
    const { added, removed, changed } = diff.stats;
    const parts = [];
    if (changed) parts.push(`${plural(changed, 'paragraph')} edited`);
    if (added) parts.push(`${added} added`);
    if (removed) parts.push(`${removed} removed`);
    return parts.join(', ') || 'Text changed';
}

/** The expandable diff panel's inner HTML (all text escaped). */
export function renderDiffHtml(diff) {
    if (diff.coarse) {
        return `<div class="xr-recap-diff__note">Too many paragraphs differ to line them up here (${diff.stats.removed} before, ${diff.stats.added} after). Use Load archive to open the previous capture.</div>`;
    }
    const row = (r) => {
        if (r.op === 'same') return `<p class="xr-recap-diff__same">${esc(r.after)}</p>`;
        if (r.op === 'del') return `<p class="xr-recap-diff__del"><del>${esc(r.before)}</del></p>`;
        if (r.op === 'ins') return `<p class="xr-recap-diff__ins"><ins>${esc(r.after)}</ins></p>`;
        const inner = r.words.map((w) => w.op === 'same' ? esc(w.text)
            : w.op === 'del' ? `<del>${esc(w.text)}</del>` : `<ins>${esc(w.text)}</ins>`).join('');
        return `<p class="xr-recap-diff__change">${inner}</p>`;
    };
    return diff.hunks
        .map((h) => `<div class="xr-recap-diff__hunk">${h.map(row).join('')}</div>`)
        .join('<div class="xr-recap-diff__gap" aria-hidden="true">⋯</div>');
}

/**
 * The diff between the archived row's body and the body now open, or
 * null when it cannot be computed (no prior article, an assembly
 * failure) — the banner then shows without detail, never not at all.
 * The prior body is assembled exactly as the reader assembles the
 * current one: markdown-canonical types hash their markdown.
 */
export function priorBodyDiff(prior, currentBody, isMarkdownCanonical) {
    try {
        if (!prior || !prior.article || currentBody == null) return null;
        const a = prior.article;
        const hashable = isMarkdownCanonical(a)
            ? { ...a, content: a.markdown, _contentIsMarkdown: true }
            : a;
        return diffBodies(EventBuilder.assembleArticleBody(hashable), currentBody);
    } catch (err) {
        Utils.log('recapture diff failed:', err);
        return null;
    }
}

/**
 * Stealth-edit surface: the same URL hashed differently on a prior
 * capture. Informational — the prior text stays in the archive.
 * Raised only when the words changed; a noise-only hash move
 * returns false and renders nothing.
 */
export function renderRecaptureBanner(prior, currentBody, isMarkdownCanonical, doc = document) {
    const diff = priorBodyDiff(prior, currentBody, isMarkdownCanonical);
    if (diff && !diff.substantive) return false;
    let banner = doc.getElementById('xr-hash-banner');
    if (!banner) {
        const main = doc.getElementById('xr-main');
        if (!main || !main.parentElement) return false;
        banner = doc.createElement('aside');
        banner.id = 'xr-hash-banner';
        banner.className = 'xr-hash-banner';
        main.parentElement.insertBefore(banner, main);
    }
    const ago = prior.cachedAt ? new Date(prior.cachedAt * 1000).toLocaleDateString() : 'earlier';
    banner.innerHTML = `
      <div class="xr-hash-banner__body">
        <div class="xr-hash-banner__label">⚠️ Content changed since your last capture (${esc(ago)})</div>
        <div class="xr-hash-banner__metric">${diff ? `${esc(summarizeDiff(diff))}. ` : ''}Your previous capture stays in the archive; audits anchor to the exact text they scored.</div>
      </div>
      <div class="xr-hash-banner__actions">
        ${diff ? '<button type="button" class="xr-reader__btn xr-reader__btn--ghost" id="xr-hash-diff-toggle" aria-expanded="false">Show changes</button>' : ''}
        <button type="button" class="xr-reader__btn xr-reader__btn--ghost" id="xr-hash-dismiss">Dismiss</button>
      </div>
      ${diff ? `<div class="xr-recap-diff" id="xr-hash-diff" hidden>${renderDiffHtml(diff)}</div>` : ''}
    `;
    banner.querySelector('#xr-hash-dismiss').addEventListener('click', () => banner.remove());
    const toggle = banner.querySelector('#xr-hash-diff-toggle');
    if (toggle) {
        toggle.addEventListener('click', () => {
            const panel = banner.querySelector('#xr-hash-diff');
            const open = panel.hidden;
            panel.hidden = !open;
            toggle.setAttribute('aria-expanded', String(open));
            toggle.textContent = open ? 'Hide changes' : 'Show changes';
        });
    }
    return true;
}

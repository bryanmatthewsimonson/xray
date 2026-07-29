// AI vision — collecting an article's images and merging accepted
// caption/transcription notes into the body.
//
// PURE module (string/regex over both canonical body forms, the
// upsertTranscriptSection approach — no DOM, so Node tests cover it
// end to end). The reader owns WHEN to call these; nothing here reads
// storage or talks to the network.
//
// Provenance is inline and wire-visible: an accepted note names the
// model in the body text itself ("Image description (AI —
// claude-…): …"), so it survives publish into the kind-30023 content
// and any downstream consumer sees exactly which text is
// model-authored. A re-run replaces the note in place (idempotent
// upsert, keyed by the image it follows).
//
// Placement: a note attaches to the FIRST occurrence of its image
// only — the same URL twice in one article gets one note, where the
// reader first meets it. (Duplicating the block at every occurrence
// would bloat the published body for zero information.)

const CAPTION_LABEL = 'Image description (AI — ';
const TRANSCRIPTION_LABEL = 'Text in image (AI transcription';

// ------------------------------------------------------------------
// Collection
// ------------------------------------------------------------------

// ![alt](target) / ![alt](<target>) / ![alt](target "title"|'title').
// The bare-target alternative tolerates ONE level of balanced parens —
// turndown emits raw URLs unescaped, and Wikipedia-style media names
// (`…/Foo_(1964).jpg`) are routine — and the optional title takes
// either quote style. One source string, composed into the collect and
// find regexes so the two can never disagree on what an image is.
const MD_IMG_SRC = '!\\[([^\\]]*)\\]\\(\\s*(<[^>]+>|(?:\\([^()\\s]*\\)|[^()\\s])+)(?:\\s+(?:"[^"]*"|\'[^\']*\'))?\\s*\\)';
const HTML_IMG_RE = /<img\b[^>]*>/gi;
const combinedImgRe = () => new RegExp(MD_IMG_SRC + '|<img\\b[^>]*>', 'g');

function parseAttrs(tag) {
    const attrs = {};
    const re = /([a-zA-Z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(tag)) !== null) {
        attrs[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
    }
    return attrs;
}

function refFromImgTag(tag) {
    const attrs = parseAttrs(tag);
    if (attrs['data-xray-figure']) return { ref: 'xray-figure:' + attrs['data-xray-figure'], alt: attrs.alt || '' };
    const src = attrs.src || '';
    // blob: URLs are session-scoped hydrations — without a figure hash
    // there is nothing durable to fetch or to key a note on.
    if (!src || src.startsWith('blob:')) return null;
    return { ref: src, alt: attrs.alt || '' };
}

function stripTags(html) {
    return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Collect the images of a body, in order, deduped by ref (first
 * occurrence wins — the same place upsert targets).
 *
 * @param {string} body
 * @param {{isHtml?: boolean}} [opts]
 * @returns {Array<{ref: string, alt: string, captionText: string}>}
 */
export function collectArticleImages(body, { isHtml = false } = {}) {
    const text = String(body || '');
    const seen = new Set();
    const out = [];
    const push = (entry) => {
        if (!entry || !entry.ref || seen.has(entry.ref)) return;
        seen.add(entry.ref);
        out.push({ ref: entry.ref, alt: entry.alt || '', captionText: entry.captionText || '' });
    };

    if (isHtml) {
        let m;
        HTML_IMG_RE.lastIndex = 0;
        while ((m = HTML_IMG_RE.exec(text)) !== null) {
            const entry = refFromImgTag(m[0]);
            if (!entry) continue;
            // A figcaption between this img and its figure's close is
            // the human-authored caption — useful model context.
            const tail = text.slice(m.index + m[0].length);
            const figEnd = tail.search(/<\/figure>|<img\b/i);
            if (figEnd !== -1 && /^<\/figure>/i.test(tail.slice(figEnd))) {
                const cap = /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i.exec(tail.slice(0, figEnd));
                if (cap) entry.captionText = stripTags(cap[1]);
            }
            push(entry);
        }
        return out;
    }

    // Markdown: both native image syntax and inline-HTML imgs (small
    // images survive capture as raw <img> tags — content-extractor
    // Fix D), scanned in one pass so document order is preserved.
    const combined = combinedImgRe();
    let m;
    while ((m = combined.exec(text)) !== null) {
        if (m[0].startsWith('<img')) {
            push(refFromImgTag(m[0]));
            continue;
        }
        let target = m[2] || '';
        if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
        if (!target || target.startsWith('blob:')) continue;
        const entry = { ref: target, alt: m[1] || '', captionText: '' };
        // A pure-italic line right after the image line is the figure
        // caption (the figure turndown rule's shape) — unless it is an
        // AI note of ours.
        const lineEnd = text.indexOf('\n', m.index + m[0].length);
        if (lineEnd !== -1) {
            const next = nextNonBlankLine(text, lineEnd + 1);
            if (next && isItalicCaptionLine(next.line) && !next.line.includes(CAPTION_LABEL)) {
                entry.captionText = next.line.trim().replace(/^\*|\*$/g, '').trim();
            }
        }
        push(entry);
    }
    return out;
}

// ------------------------------------------------------------------
// Note builders
// ------------------------------------------------------------------

function sanitizeInline(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function transcriptionLabel(note) {
    return note.transcription_complete === false
        ? `${TRANSCRIPTION_LABEL}, may be incomplete — ${note.model})`
        : `${TRANSCRIPTION_LABEL} — ${note.model})`;
}

/**
 * Attribute-safe key for one image ref (marks our HTML blocks so a
 * re-run replaces rather than stacks).
 */
export function visionNoteKey(ref) {
    return encodeURIComponent(String(ref || ''));
}

/**
 * The markdown form of one accepted note. Either part may be absent
 * (the human accepts caption and transcription independently).
 *
 * @param {{caption?: string, transcription?: string,
 *          transcription_complete?: boolean, model: string}} note
 * @returns {string} '' when the note carries nothing
 */
export function buildVisionNoteMarkdown(note) {
    const parts = [];
    const caption = sanitizeInline(note && note.caption);
    if (caption) parts.push(`*${CAPTION_LABEL}${note.model}): ${caption}*`);
    const transcription = String((note && note.transcription) || '').trim();
    if (transcription) {
        const lines = transcription.split('\n').map((l) => '> ' + l.trimEnd());
        parts.push(`**${transcriptionLabel(note)}:**\n\n${lines.join('\n')}`);
    }
    return parts.join('\n\n');
}

/**
 * The HTML form of the same note — shaped so the default turndown
 * rules round-trip it to exactly buildVisionNoteMarkdown's output
 * (em → *…*, strong → **…**, blockquote/br → "> " lines).
 */
export function buildVisionNoteHtml(note, ref) {
    const key = visionNoteKey(ref);
    const parts = [];
    const caption = sanitizeInline(note && note.caption);
    if (caption) {
        parts.push(`<p class="xr-vision-note" data-xray-vision="${key}"><em>${CAPTION_LABEL}${escapeHtml(note.model)}): ${escapeHtml(caption)}</em></p>`);
    }
    const transcription = String((note && note.transcription) || '').trim();
    if (transcription) {
        const lines = transcription.split('\n').map((l) => escapeHtml(l.trimEnd())).join('<br>');
        parts.push(`<div class="xr-vision-note xr-vision-note--text" data-xray-vision="${key}">`
            + `<p><strong>${escapeHtml(transcriptionLabel(note))}:</strong></p>`
            + `<blockquote><p>${lines}</p></blockquote></div>`);
    }
    return parts.join('\n');
}

// ------------------------------------------------------------------
// Upsert — markdown side
// ------------------------------------------------------------------

function nextNonBlankLine(text, from) {
    let i = from;
    while (i < text.length) {
        const end = text.indexOf('\n', i);
        const line = end === -1 ? text.slice(i) : text.slice(i, end);
        if (line.trim() !== '') return { line, start: i, end: end === -1 ? text.length : end };
        if (end === -1) break;
        i = end + 1;
    }
    return null;
}

function isItalicCaptionLine(line) {
    const t = line.trim();
    return /^\*[^*].*\*$/.test(t) && !t.startsWith('**');
}

/** Find the first markdown/inline-HTML image whose target is `ref`. */
function findImageInMarkdown(md, ref) {
    const combined = combinedImgRe();
    let m;
    while ((m = combined.exec(md)) !== null) {
        if (m[0].startsWith('<img')) {
            const entry = refFromImgTag(m[0]);
            if (entry && entry.ref === ref) return m;
            continue;
        }
        let target = m[2] || '';
        if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
        if (target === ref) return m;
    }
    return null;
}

/**
 * Remove an existing AI note starting at `pos` (a line start).
 * Returns the text with the note (and its leading blank lines)
 * removed. Recognizes both parts in either order, so an upsert never
 * stacks notes however a previous accept was shaped.
 */
function stripNoteAtMd(md, pos) {
    let out = md;
    for (;;) {
        const next = nextNonBlankLine(out, pos);
        if (!next) break;
        const t = next.line.trim();
        if (t.startsWith(`*${CAPTION_LABEL}`)) {
            // Caption paragraph: through the end of its line.
            out = out.slice(0, pos) + out.slice(next.end === out.length ? next.end : next.end + 1);
            continue;
        }
        if (t.startsWith(`**${TRANSCRIPTION_LABEL}`)) {
            // Label line, blank line(s), then ONE contiguous "> " block
            // — the exact shape buildVisionNoteMarkdown emits. Stop at
            // the first blank line after the block: a blockquote that
            // follows across a blank line is the ARTICLE's own (pull
            // quotes, tweet embeds render as blockquotes), never ours.
            let i = next.end === out.length ? next.end : next.end + 1;
            let sawQuote = false;
            for (;;) {
                const lineEnd = out.indexOf('\n', i);
                const line = lineEnd === -1 ? out.slice(i) : out.slice(i, lineEnd);
                const isBlank = line.trim() === '';
                const isQuote = line.startsWith('> ') || line.trim() === '>';
                if (isBlank && sawQuote) break;
                if (!isBlank && !isQuote) break;
                if (isQuote) sawQuote = true;
                if (lineEnd === -1) { i = out.length; break; }
                i = lineEnd + 1;
            }
            out = out.slice(0, pos) + out.slice(i);
            continue;
        }
        break;
    }
    return out;
}

/**
 * Insert or replace the AI note for one image in a markdown body.
 * No-op (returns the body unchanged) when the image isn't found or
 * the note is empty-handed.
 *
 * @param {string} md
 * @param {string} ref   the image target as captured (URL,
 *                       xray-figure:<hash>, or data: URL)
 * @param {object} note  buildVisionNoteMarkdown input
 * @returns {string}
 */
export function upsertVisionNoteMarkdown(md, ref, note) {
    const body = String(md || '');
    const noteMd = buildVisionNoteMarkdown(note);
    const m = findImageInMarkdown(body, ref);
    if (!m || !noteMd) return body;

    // Position after the image's line…
    let lineEnd = body.indexOf('\n', m.index + m[0].length);
    if (lineEnd === -1) lineEnd = body.length;
    let pos = Math.min(lineEnd + 1, body.length);
    // …and after a human caption line, when one follows.
    const next = nextNonBlankLine(body, pos);
    if (next && isItalicCaptionLine(next.line) && !next.line.includes(CAPTION_LABEL)) {
        pos = next.end === body.length ? next.end : next.end + 1;
    }

    const stripped = stripNoteAtMd(body, pos);
    // Splice with exactly one blank line on each side of the note —
    // normalized locally, never across the whole document.
    const before = stripped.slice(0, pos).replace(/\n*$/, '\n');
    const after = stripped.slice(pos).replace(/^\n*/, '');
    return after
        ? `${before}\n${noteMd}\n\n${after}`
        : `${before}\n${noteMd}\n`;
}

// ------------------------------------------------------------------
// Upsert — HTML side
// ------------------------------------------------------------------

function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Find the first `<img>` tag matching `ref` in an HTML body. */
function findImageInHtml(html, ref) {
    HTML_IMG_RE.lastIndex = 0;
    let m;
    while ((m = HTML_IMG_RE.exec(html)) !== null) {
        const entry = refFromImgTag(m[0]);
        if (entry && entry.ref === ref) return m;
    }
    return null;
}

/**
 * Insert or replace the AI note for one image in an HTML body. The
 * note lands after the image's enclosing `</figure>` (or `</p>`) so
 * the generated blocks never nest inside another paragraph; existing
 * blocks for the same image (keyed by data-xray-vision) are removed
 * first wherever they sit.
 *
 * @param {string} html
 * @param {string} ref
 * @param {object} note  buildVisionNoteHtml input
 * @returns {string}
 */
export function upsertVisionNoteHtml(html, ref, note) {
    let body = String(html || '');
    const noteHtml = buildVisionNoteHtml(note, ref);
    if (!noteHtml) return body;

    // Remove any prior note for this image (our own markup — no
    // nested p-in-p or div-in-div, so the lazy match is exact).
    const key = escapeRegExp(visionNoteKey(ref));
    body = body.replace(
        new RegExp(`\\s*<(p|div)\\b[^>]*data-xray-vision="${key}"[^>]*>[\\s\\S]*?<\\/\\1>`, 'g'), '');

    const m = findImageInHtml(body, ref);
    if (!m) return body;

    const from = m.index + m[0].length;
    const tail = body.slice(from);
    // Never look past the next image.
    const stop = tail.search(/<img\b/i);
    const scan = stop === -1 ? tail : tail.slice(0, stop);
    // A candidate close belongs to THIS image's wrapper only when no
    // matching open tag sits between the img and it — a div-wrapped
    // img followed by a paragraph must not adopt that paragraph's
    // close. Of the valid closes, the positionally nearer wins; with
    // neither, the note lands right after the tag.
    const closeOf = (tag) => {
        const close = scan.search(new RegExp(`</${tag}>`, 'i'));
        if (close === -1) return null;
        const open = scan.slice(0, close).search(new RegExp(`<${tag}\\b`, 'i'));
        return open === -1 ? { at: close, len: tag.length + 3 } : null;
    };
    const best = [closeOf('figure'), closeOf('p')]
        .filter(Boolean).sort((a, b) => a.at - b.at)[0];
    let insertAt = best ? from + best.at + best.len : from;

    // A markdown-tab round trip strips attributes, so an earlier note
    // can survive as bare <p><em>…</em></p> blocks the keyed removal
    // above can't see. Strip label-shaped blocks sitting exactly at
    // the insertion point (stripNoteAtMd's fallback, HTML side).
    for (;;) {
        const ahead = body.slice(insertAt);
        const capm = BARE_CAPTION_RE.exec(ahead);
        if (capm) { body = body.slice(0, insertAt) + ahead.slice(capm[0].length); continue; }
        const trm = BARE_TRANSCRIPTION_RE.exec(ahead);
        if (trm) { body = body.slice(0, insertAt) + ahead.slice(trm[0].length); continue; }
        break;
    }
    return body.slice(0, insertAt) + '\n' + noteHtml + body.slice(insertAt);
}

// The attribute-less shapes markdownToHtml round-trips our notes into.
// Anchored (^) — only ever tested right at the insertion point.
const BARE_CAPTION_RE = new RegExp(
    `^\\s*<p[^>]*>\\s*<em[^>]*>\\s*${escapeRegExp(CAPTION_LABEL)}[\\s\\S]*?</em>\\s*</p>`);
const BARE_TRANSCRIPTION_RE = new RegExp(
    `^\\s*<p[^>]*>\\s*<strong[^>]*>\\s*${escapeRegExp(TRANSCRIPTION_LABEL)}[\\s\\S]*?</strong>\\s*</p>\\s*(?:<blockquote>[\\s\\S]*?</blockquote>)?`);

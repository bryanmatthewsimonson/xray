// Transcript → article — Phase 21.1. Pure composition of an imported
// transcript (transcript-parse.js turns) into an ordinary X-Ray
// article object: the speaker-labeled markdown body IS the canonical
// substrate (the x-hash and quote grounding cover the spoken words),
// mirroring the PDF treatment where `markdown` is canonical and
// `content` a derived rendering. The resulting record joins cases via
// the 20.2 picker and feeds the 20.4 corpus synthesis untouched.
//
// House precedents: paragraph budgets + timestamp-first layout from
// platforms/youtube.js composeMarkdownBody/coalesceCuesIntoParagraphs;
// synthetic file:///imported/<hash>/ identity from reader/pdf-capture.js
// (content-hashed so two pastes named alike never share a d-tag).

import { Crypto } from './crypto.js';
import { EventBuilder } from './event-builder.js';
import { ContentExtractor } from './content-extractor.js';
import { articleHash as canonicalArticleHash } from './audit/article-hash.js';

// The YouTube paragraph budgets, restated (platforms/youtube.js:948-949):
// soft-break past MIN on a sentence boundary, hard-break at MAX.
const MIN_PARA_CHARS = 380;
const MAX_PARA_CHARS = 900;
const SENTENCE_END_RE = /[.!?]["')\]]*\s*$/;

function formatStamp(startMs) {
    const total = Math.max(0, Math.floor((startMs || 0) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const two = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

function cleanSpeakerName(name) {
    return String(name || '').replace(/[*_[\]]/g, '').trim();
}

// ------------------------------------------------------------------
// Body composition
// ------------------------------------------------------------------

// Merge consecutive same-speaker turns into paragraphs within the
// budget. ALWAYS flush on a speaker change; a merged paragraph keeps
// the FIRST contributing turn's startMs.
function mergeTurns(turns) {
    const paras = [];
    let cur = null;
    const flush = () => { if (cur && cur.text.trim()) paras.push(cur); cur = null; };

    for (const t of turns) {
        const text = String(t.text || '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const sameSpeaker = cur && (cur.speaker || null) === (t.speaker || null);
        if (!cur || !sameSpeaker || cur.text.length >= MAX_PARA_CHARS
            || (cur.text.length >= MIN_PARA_CHARS && SENTENCE_END_RE.test(cur.text))) {
            flush();
            cur = { speaker: t.speaker || null, startMs: t.startMs ?? null, text };
        } else {
            cur.text = `${cur.text} ${text}`;
        }
    }
    flush();
    return paras;
}

function headerField(value) {
    // The event-builder metadata-header treatment: newline-flattened
    // (the body is the hash substrate — no stray breaks).
    return String(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * Just the `## Transcript` section — heading + merged-turn paragraphs.
 * The reader-attach unit (Phase 22): appended to an EXISTING capture's
 * body rather than forming a standalone article. `meta.url` (http(s))
 * plus a paragraph startMs yields a linked Media-Fragment stamp;
 * otherwise a bare code stamp.
 *
 * @param {{turns: Array, meta: object}} p
 * @returns {string}
 */
export function buildTranscriptSection({ turns = [], meta = {} } = {}) {
    const isHttp = /^https?:\/\//i.test(meta.url || '');
    const paras = mergeTurns(turns);

    const body = paras.map((p) => {
        const bits = [];
        if (p.startMs !== null && p.startMs !== undefined) {
            const stamp = formatStamp(p.startMs);
            if (isHttp) {
                // Media Fragments URI (#t=<seconds>) — the generic-web
                // analog of YouTube's &t=Ns deep link. Body-only; the
                // r-tag identity URL is never fragmented.
                bits.push(`[\`${stamp}\`](${meta.url}#t=${Math.floor(p.startMs / 1000)})`);
            } else {
                bits.push(`\`${stamp}\``);
            }
        }
        const name = cleanSpeakerName(p.speaker);
        if (name) bits.push(`**${name}:**`);
        bits.push(p.text);
        return bits.join(' ');
    }).join('\n\n');

    return `## Transcript\n\n${body}\n`;
}

/**
 * The speaker-labeled markdown body — the canonical substrate.
 *
 * @param {{turns: Array, meta: object}} p
 * @returns {string}
 */
export function buildTranscriptMarkdown({ turns = [], meta = {} } = {}) {
    const lines = ['---'];
    const title = headerField(meta.title);
    const isHttp = /^https?:\/\//i.test(meta.url || '');
    lines.push(isHttp ? `**Podcast**: [${title}](${meta.url})` : `**Podcast**: ${title}`);
    if (meta.show) lines.push(`**Show**: ${headerField(meta.show)}`);
    if (meta.byline) lines.push(`**Host**: ${headerField(meta.byline)}`);
    if (meta.publishedAt) {
        lines.push(`**Published**: ${new Date(meta.publishedAt * 1000).toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
        })}`);
    }
    const paras = mergeTurns(turns);
    const speakerCount = new Set(paras.filter((p) => p.speaker).map((p) => p.speaker.toLowerCase())).size;
    const fmtLabel = { vtt: 'WebVTT', srt: 'SRT', 'speaker-lines': 'speaker-labeled', plain: 'plain' }[meta.format] || 'plain';
    lines.push(`**Transcript**: imported ${fmtLabel} · ${paras.length} turn${paras.length === 1 ? '' : 's'}`
        + ` · ${speakerCount} speaker${speakerCount === 1 ? '' : 's'}`);
    lines.push('---');
    lines.push('');

    // Byte-identical to the pre-extraction output: header block, blank
    // line, then the section (which itself ends with a newline).
    return `${lines.join('\n')}\n${buildTranscriptSection({ turns, meta })}`;
}

// ------------------------------------------------------------------
// Section upsert (Phase 22 — the reader attach seam)
// ------------------------------------------------------------------

/**
 * Insert or replace the imported `## Transcript` section in an
 * existing body. Bounded replace: from the BARE heading (exact text —
 * deliberately never matches YouTube's suffixed
 * `## Transcript — <lang> (<kind>)` headings) to the next same-level
 * heading or EOF; plain append when no such section exists. Works on
 * both canonical sides: markdown (`isHtml: false`) and the rendered
 * HTML markdownToHtml produces (`isHtml: true`, `<h2>Transcript</h2>`).
 *
 * @param {string} body     the existing body (same format as section)
 * @param {string} section  the new section
 * @param {{isHtml?: boolean}} [opts]
 * @returns {string}
 */
export function upsertTranscriptSection(body, section, { isHtml = false } = {}) {
    const base = String(body || '');
    // Normalize the section to end with exactly one newline.
    const sec = String(section || '').replace(/\s+$/, '') + '\n';

    const re = isHtml
        ? /<h2[^>]*>\s*Transcript\s*<\/h2>[\s\S]*?(?=<h2[\s>]|$)/i
        : /^## Transcript[ \t]*$[\s\S]*?(?=^## |$(?![\s\S]))/m;

    const m = re.exec(base);
    if (m) {
        const before = base.slice(0, m.index);
        const after = base.slice(m.index + m[0].length);
        // A following section keeps one blank line of separation.
        return after ? `${before}${sec}\n${after}` : `${before}${sec}`;
    }
    const trimmed = base.replace(/\s+$/, '');
    return trimmed ? `${trimmed}\n\n${sec}` : sec;
}

// ------------------------------------------------------------------
// Article assembly
// ------------------------------------------------------------------

/** Synthetic identity for a URL-less paste — content-hashed like the
 *  PDF import so two different transcripts never collide on one key. */
export async function syntheticTranscriptUrl(rawText, title) {
    const hash = (await Crypto.sha256(String(rawText || ''))).slice(0, 16);
    const slug = (String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '').slice(0, 40)) || 'transcript';
    return `file:///imported/${hash}/${slug}.transcript`;
}

/**
 * Build the article object. `meta.title` is required; `meta.url` must
 * already be resolved (http(s), or syntheticTranscriptUrl's output).
 *
 * @param {{turns: Array, speakers: string[], format: string, meta: object}} p
 */
export function buildTranscriptArticle({ turns = [], speakers = [], format = 'plain', meta = {} } = {}) {
    const title = String(meta.title || '').trim();
    if (!title) throw new Error('buildTranscriptArticle: meta.title is required');
    if (!meta.url) throw new Error('buildTranscriptArticle: meta.url is required (use syntheticTranscriptUrl)');

    // Fragment-stripped identity (the PDF treatment): a viewer fragment
    // is not identity. Applies to http(s) only.
    let url = String(meta.url);
    if (/^https?:\/\//i.test(url)) {
        try { const u = new URL(url); u.hash = ''; url = u.toString(); } catch (_) { /* keep as-is */ }
    }

    const markdown = buildTranscriptMarkdown({ turns, meta: { ...meta, format, url } });
    const firstTurn = turns.find((t) => t && t.text && t.text.trim());

    const podcast = {};
    if (meta.show) podcast.show = String(meta.show).trim();
    if (meta.feedGuid) podcast.feed_guid = String(meta.feedGuid).trim();
    if (meta.episodeGuid) podcast.episode_guid = String(meta.episodeGuid).trim();
    if (meta.feedUrl) podcast.feed_url = String(meta.feedUrl).trim();
    if (meta.itunesId) podcast.itunes_id = String(meta.itunesId).trim();
    if (/^https?:\/\//i.test(url)) podcast.episode_url = url;

    // NOTE: article.transcript (the legacy string channel) is
    // deliberately NOT set — assembleArticleBody would append a second
    // fenced copy of the body (event-builder.js:74-77). The transcript
    // IS the body here.
    return {
        url,
        title,
        byline: meta.byline ? String(meta.byline).trim() : '',
        siteName: meta.show ? String(meta.show).trim() : '',
        ...(meta.publishedAt ? { publishedAt: meta.publishedAt } : {}),
        markdown,
        content: ContentExtractor.markdownToHtml(markdown),
        excerpt: firstTurn ? firstTurn.text.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
        wordCount: markdown.split(/\s+/).filter(Boolean).length,
        contentType: 'transcript',
        platform: 'podcast',
        entities: [],
        ...(Object.keys(podcast).length ? { podcast } : {}),
        transcript_meta: {
            format,
            turn_count: turns.length,
            speaker_count: speakers.length,
            speakers: [...speakers]
        }
    };
}

/**
 * The ONE hash recipe for a transcript article — byte-identical to
 * what the reader computes (hashableArticle treats 'transcript' as
 * markdown-canonical, 21.2) and to the publish-path x tag, so the
 * portal importer, the reader, and publish can never fork.
 */
export async function computeTranscriptArticleHash(article) {
    const body = EventBuilder.assembleArticleBody({
        ...article,
        content: article.markdown,
        _contentIsMarkdown: true
    });
    return await canonicalArticleHash(body);
}

// Transcript parsing — Phase 21.1 (paste/upload podcast transcripts).
//
// Pure: no DOM, no chrome.*, no network, no clock. Parses the three
// transcript shapes a user realistically pastes — SRT, WebVTT, and
// speaker-labeled plain text — plus an unlabeled-plain fallback, into
// a deterministic turn stream:
//
//     { format, turns: [{ speaker|null, startMs|null, text }],
//       speakers: [unique names, first-appearance order], warnings }
//
// The turns feed transcript-article.js, which renders them into the
// flat markdown body (the hash substrate and the text claims/quotes
// ground against). Nothing here is heuristic beyond the documented
// line grammars — same input, same output, always.

// ------------------------------------------------------------------
// Timestamp grammar — one regex for every format we accept:
//   HH:MM:SS,mmm  (SRT)      HH:MM:SS.mmm / MM:SS.mmm  (VTT)
//   H?H:MM:SS / M?M:SS       (bare stamps in speaker lines)
// ------------------------------------------------------------------

const TS_RE = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/;

/** Parse a timestamp string to integer milliseconds, or null. */
export function parseTimestampMs(str) {
    const m = TS_RE.exec(String(str || '').trim());
    if (!m) return null;
    const [, h, mm, ss, frac] = m;
    const hours = h !== undefined ? parseInt(h, 10) : 0;
    const mins = parseInt(mm, 10);
    const secs = parseInt(ss, 10);
    if (mins > 59 && h !== undefined) return null;
    const ms = frac !== undefined ? parseInt(frac.padEnd(3, '0'), 10) : 0;
    return ((hours * 3600 + mins * 60 + secs) * 1000) + ms;
}

// ------------------------------------------------------------------
// Speaker-label grammar — shared by plain lines and cue-internal
// labels: 1–6 whitespace-separated words before a colon, ≤60 chars,
// letters/digits/dots/apostrophes/hyphens/commas, must contain a
// letter, first char uppercase or digit (covers "Alice Smith",
// "DR. FAUCI", "Speaker 1", "2nd Caller"). No sentence punctuation.
// ------------------------------------------------------------------

const LABEL_CORE = "[A-Z0-9][A-Za-z0-9.,'’\\-]*(?:[ \\t]+[A-Za-z0-9.,'’\\-]+){0,5}";

function validLabel(name) {
    const s = String(name || '').trim();
    if (!s || s.length > 60) return false;
    if (!/[A-Za-z]/.test(s)) return false;
    return new RegExp(`^${LABEL_CORE}$`).test(s);
}

// Timing line (SRT and VTT share it; comma or dot ms, ms optional).
const TIMING_RE = /^(\d{1,2}:\d{2}(?::\d{2})?[.,]?\d{0,3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]?\d{0,3})/;

// speaker-lines patterns (TS wrapped in [] or ()):
//   P1: [12:03] Alice Smith: text
//   P2: Alice Smith [12:03]: text
//   P3: Alice Smith: text
const P1_RE = new RegExp(`^[\\[(]([0-9:.,]+)[\\])]\\s+(${LABEL_CORE}):\\s*(.*)$`);
const P2_RE = new RegExp(`^(${LABEL_CORE})\\s*[\\[(]([0-9:.,]+)[\\])]\\s*:\\s*(.*)$`);
const P3_RE = new RegExp(`^(${LABEL_CORE}):\\s+(.*)$`);

function matchSpeakerLine(line) {
    let m = P1_RE.exec(line);
    if (m && validLabel(m[2]) && parseTimestampMs(m[1]) !== null) {
        return { speaker: m[2].trim(), startMs: parseTimestampMs(m[1]), text: m[3] };
    }
    m = P2_RE.exec(line);
    if (m && validLabel(m[1]) && parseTimestampMs(m[2]) !== null) {
        return { speaker: m[1].trim(), startMs: parseTimestampMs(m[2]), text: m[3] };
    }
    m = P3_RE.exec(line);
    if (m && validLabel(m[1])) {
        return { speaker: m[1].trim(), startMs: null, text: m[2] };
    }
    return null;
}

// ------------------------------------------------------------------
// Format detection
// ------------------------------------------------------------------

/** @returns {'vtt'|'srt'|'speaker-lines'|'plain'} */
export function detectTranscriptFormat(text) {
    const raw = String(text || '').replace(/^﻿/, '');
    const lines = raw.split(/\r\n|\r|\n/);
    const firstNonBlank = (lines.find((l) => l.trim() !== '') || '').trim();
    if (/^WEBVTT(\s|$)/.test(firstNonBlank)) return 'vtt';
    if (lines.some((l) => TIMING_RE.test(l.trim()))) return 'srt';

    const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
    let labeled = 0;
    const names = new Set();
    for (const line of nonEmpty) {
        const hit = matchSpeakerLine(line);
        if (hit) { labeled++; names.add(hit.speaker.toLowerCase()); }
    }
    // A labeled MAJORITY of lines, plus either ≥2 distinct speakers or
    // ≥3 labels — accepts a two-voice interview and a single-speaker
    // monologue, rejects prose with a scattered "Note:"/"Update:".
    const ratio = nonEmpty.length > 0 ? labeled / nonEmpty.length : 0;
    if (ratio >= 0.5 && (labeled >= 3 || names.size >= 2)) {
        return 'speaker-lines';
    }
    return 'plain';
}

// ------------------------------------------------------------------
// Cue-block parsing (shared by SRT and header-less VTT)
// ------------------------------------------------------------------

function stripCueMarkup(s) {
    return String(s || '')
        .replace(/<\/?(?:i|b|u|c|ruby|rt)(?:\.[^>]*)?>/gi, '')
        .replace(/<\/?font[^>]*>/gi, '')
        .replace(/<\/?lang[^>]*>/gi, '')
        .replace(/<\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3}>/g, '')   // karaoke stamps
        .trim();
}

// A cue's text → one or more turns. VTT <v Name> voice spans take
// precedence; else a leading "NAME:" (optionally "- NAME:") label.
// `carry` is the previous cue's speaker (broadcast-SRT convention: a
// label marks a CHANGE of speaker; unlabeled cues continue the last).
function cueToTurns(textLines, startMs, carry) {
    const joined = textLines.join(' ').trim();
    if (!joined) return { turns: [], carry };

    // VTT voice spans.
    if (/<v[ .][^>]*>/i.test(joined) || /<v>/i.test(joined)) {
        const turns = [];
        const voiceRe = /<v(?:\.[^ >]*)?\s*([^>]*)>([\s\S]*?)(?=<v[ .>]|<\/v>|$)/gi;
        let m;
        let last = carry;
        while ((m = voiceRe.exec(joined)) !== null) {
            const name = stripCueMarkup(m[1]).trim() || null;
            const spanText = stripCueMarkup(m[2].replace(/<\/v>/gi, ''));
            if (!spanText) continue;
            turns.push({ speaker: name, startMs, text: spanText });
            if (name) last = name;
        }
        if (turns.length > 0) return { turns, carry: last };
    }

    const clean = stripCueMarkup(joined.replace(/<\/?v[^>]*>/gi, ''));
    if (!clean) return { turns: [], carry };
    const label = matchSpeakerLine(clean.replace(/^-\s+/, ''));
    if (label && label.startMs === null) {
        return { turns: [{ speaker: label.speaker, startMs, text: label.text.trim() }], carry: label.speaker };
    }
    return { turns: [{ speaker: carry || null, startMs, text: clean }], carry };
}

function parseCueBlocks(lines, warnings) {
    // Blocks split on blank lines; each: optional id line, timing line,
    // then text lines. NOTE/STYLE/REGION blocks are skipped whole.
    const turns = [];
    let carry = null;
    let badStamps = 0;
    let i = 0;
    while (i < lines.length) {
        while (i < lines.length && lines[i].trim() === '') i++;
        if (i >= lines.length) break;
        const block = [];
        while (i < lines.length && lines[i].trim() !== '') { block.push(lines[i]); i++; }

        const head = block[0].trim();
        if (/^(NOTE|STYLE|REGION)\b/.test(head) || /^WEBVTT/.test(head.replace(/^﻿/, ''))) continue;

        let idx = 0;
        if (idx < block.length && /^\d+$/.test(block[idx].trim()) && idx + 1 < block.length
            && TIMING_RE.test(block[idx + 1].trim())) idx++;                 // SRT index line
        if (idx < block.length && !TIMING_RE.test(block[idx].trim())
            && idx + 1 < block.length && TIMING_RE.test(block[idx + 1].trim())) idx++;  // VTT cue-id line

        const timing = idx < block.length ? TIMING_RE.exec(block[idx].trim()) : null;
        if (!timing) continue;   // not a cue block
        const startMs = parseTimestampMs(timing[1]);
        if (startMs === null) badStamps++;
        const res = cueToTurns(block.slice(idx + 1), startMs, carry);
        carry = res.carry;
        turns.push(...res.turns);
    }
    if (badStamps > 0) warnings.push(`${badStamps} cue${badStamps === 1 ? '' : 's'} had unparseable timestamps`);
    return turns;
}

// ------------------------------------------------------------------
// speaker-lines + plain parsing
// ------------------------------------------------------------------

function parseSpeakerLines(lines, warnings) {
    const turns = [];
    let current = null;
    let sawUnattributedLead = false;
    const flush = () => { if (current && current.text.trim()) turns.push(current); current = null; };

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line === '') {
            // A blank line closes the turn; a following unlabeled
            // paragraph becomes a NEW turn with the same speaker
            // (preserves the author's paragraph intent). The empty
            // placeholder is discarded by flush() if nothing follows.
            const speaker = current ? current.speaker : null;
            flush();
            current = speaker ? { speaker, startMs: null, text: '' } : null;
            continue;
        }
        const hit = matchSpeakerLine(line);
        if (hit) {
            flush();
            current = { speaker: hit.speaker, startMs: hit.startMs, text: hit.text.trim() };
        } else if (current) {
            current.text = (current.text + ' ' + line).trim();
        } else {
            sawUnattributedLead = true;
            current = { speaker: null, startMs: null, text: line };
        }
    }
    flush();
    if (sawUnattributedLead) warnings.push('label-less lines before the first speaker were kept unattributed');
    return turns;
}

function parsePlain(text) {
    const paras = String(text || '').split(/\r\n|\r|\n/).join('\n')
        .split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (paras.length === 0) return [];
    return paras.map((p) => ({ speaker: null, startMs: null, text: p }));
}

// ------------------------------------------------------------------
// Entry point
// ------------------------------------------------------------------

/**
 * @param {string} text  the pasted transcript
 * @returns {{format: string, turns: Array, speakers: string[], warnings: string[]}}
 */
export function parseTranscript(text) {
    const raw = String(text || '').replace(/^﻿/, '');
    const warnings = [];
    const format = detectTranscriptFormat(raw);
    const lines = raw.split(/\r\n|\r|\n/);

    let turns;
    if (format === 'vtt' || format === 'srt') {
        turns = parseCueBlocks(lines, warnings);
    } else if (format === 'speaker-lines') {
        turns = parseSpeakerLines(lines, warnings);
    } else {
        turns = parsePlain(raw);
    }
    turns = turns.filter((t) => t && t.text && t.text.trim());

    const speakers = [];
    const seen = new Set();
    for (const t of turns) {
        if (t.speaker && !seen.has(t.speaker.toLowerCase())) {
            seen.add(t.speaker.toLowerCase());
            speakers.push(t.speaker);
        }
    }
    if (speakers.length === 0 && turns.length > 0) warnings.push('no speakers detected');

    return { format, turns, speakers, warnings };
}

// ------------------------------------------------------------------
// Reader prefill seam (Phase 21.2): given the plain text of the
// paragraph a selection sits in (the tagger's `context`), extract the
// leading speaker name the transcript body layout produced —
// "12:03 Alice Smith: …" or "Alice Smith: …". When `knownSpeakers` is
// a non-empty array (local imports carry transcript_meta.speakers) the
// name must case-insensitively match a member; without it (relay
// reconstructions) the ≤6-word label grammar is the only gate.
// ------------------------------------------------------------------

export function speakerFromParagraphText(text, knownSpeakers = null) {
    const s = String(text || '').trim();
    const m = new RegExp(`^(?:\\d{1,2}:\\d{2}(?::\\d{2})?\\s+)?(${LABEL_CORE}):\\s`).exec(s);
    if (!m || !validLabel(m[1])) return null;
    const name = m[1].trim();
    if (Array.isArray(knownSpeakers) && knownSpeakers.length > 0) {
        const hit = knownSpeakers.find((k) => String(k).toLowerCase() === name.toLowerCase());
        return hit || null;
    }
    return name;
}

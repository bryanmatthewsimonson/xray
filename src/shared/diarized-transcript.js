// Diarized transcript — the "Transcribe locally" composition layer.
// Pure: turns the companion service's WhisperX+pyannote result
// ({segments: [{start, end, speaker, text}], …}) into the capture's
// canonical markdown body plus the local-only offset→time map that
// gives claims their start/end provenance.
//
// House precedents: paragraphing + section layout from
// transcript-article.js (mergeTurns/buildTranscriptSection, reused via
// options); `&t=Ns` deep-link form from platforms/youtube.js
// composeMarkdownBody; the offset map mirrors pdf-capture's pageMap
// (local-only, dropped when the body is edited); the FragmentSelector
// mirrors pdf-layout.js pageFragmentSelector, read back by
// claim-model.js timeRangeFromAnchor.
//
// Wire-format note: NOTHING here mints a new tag or kind. Start/end
// ride the claim's existing `anchor` tag as a W3C Media-Fragments
// FragmentSelector (docs/NIP_DRAFT.md §Selectors item 5).

import { buildTranscriptSection, mergeTurns } from './transcript-article.js';

// ------------------------------------------------------------------
// Segments → turns
// ------------------------------------------------------------------

/**
 * Map raw pyannote labels (SPEAKER_00, SPEAKER_01, …) to stable
 * display names ("Speaker 1", "Speaker 2") in first-appearance order.
 * Null/unassigned speakers stay null — never invent a label for a
 * segment diarization couldn't place.
 *
 * @param {Array<{speaker?: string|null}>} segments
 * @returns {Map<string, string>} raw label → display name
 */
export function speakerDisplayMap(segments) {
    const map = new Map();
    for (const s of segments || []) {
        const raw = s && s.speaker;
        if (!raw || map.has(raw)) continue;
        map.set(raw, `Speaker ${map.size + 1}`);
    }
    return map;
}

/**
 * Companion-service segments → transcript-article turns.
 * Seconds → ms; raw speaker labels → display names; empty text skipped.
 *
 * @param {Array<{start: number, end: number, speaker: string|null, text: string}>} segments
 * @returns {Array<{speaker: string|null, startMs: number, endMs: number, text: string}>}
 */
export function turnsFromSegments(segments) {
    const names = speakerDisplayMap(segments);
    const turns = [];
    for (const s of segments || []) {
        const text = String((s && s.text) || '').trim();
        if (!text) continue;
        turns.push({
            speaker: (s.speaker && names.get(s.speaker)) || null,
            startMs: Math.max(0, Math.round((Number(s.start) || 0) * 1000)),
            endMs: Math.max(0, Math.round((Number(s.end) || 0) * 1000)),
            text
        });
    }
    return turns;
}

// ------------------------------------------------------------------
// Anchor selector (the provenance carrier)
// ------------------------------------------------------------------

/**
 * The W3C Media-Fragments selector carrying a claim's start–end video
 * offsets. Appended ADDITIVELY to the anchor array (the pdf-layout.js
 * pageFragmentSelector precedent) — resolvers that don't know it skip
 * it. Seconds, up to ms precision, no trailing zeros.
 */
export function timeFragmentSelector(startSec, endSec) {
    const fmt = (n) => String(Math.round(Math.max(0, Number(n) || 0) * 1000) / 1000);
    return {
        type: 'FragmentSelector',
        conformsTo: 'http://www.w3.org/TR/media-frags/',
        value: `t=${fmt(startSec)},${fmt(endSec)}`
    };
}

/**
 * Resolve a grounded span (char offsets into the canonical markdown)
 * to the media time range it falls inside, via the timeMap built by
 * buildDiarizedBody. Covers the FULL span: startSec of the first
 * overlapping paragraph through endSec of the last.
 *
 * @param {Array<{start: number, end: number, startSec: number, endSec: number}>} timeMap
 * @param {number} start  span start (inclusive)
 * @param {number} [end]  span end (exclusive; defaults to start)
 * @returns {{startSec: number, endSec: number}|null}
 */
export function timeRangeOfSpan(timeMap, start, end = start) {
    if (!Array.isArray(timeMap) || timeMap.length === 0) return null;
    const hits = timeMap.filter((e) => e && e.end > start && e.start < Math.max(end, start + 1));
    if (hits.length === 0) return null;
    const first = hits[0];
    const last = hits[hits.length - 1];
    return {
        startSec: first.startSec,
        endSec: (last.endSec != null ? last.endSec : last.startSec)
    };
}

// ------------------------------------------------------------------
// Body composition
// ------------------------------------------------------------------

function languageLabel(code) {
    const c = String(code || '').trim();
    if (!c) return '';
    try {
        const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(c);
        // Intl echoes unknown codes back — treat an echo as "no name".
        if (name && name.toLowerCase() !== c.toLowerCase()) return name;
    } catch (_) { /* bad code — fall through to the raw code */ }
    return c;
}

/**
 * Human name for a companion CLOUD provider, or null for the local
 * WhisperX path (absent/`local`/`whisperx` — older companions send no
 * provider at all). An unknown provider names itself rather than
 * masquerading as local — the honesty rule the transcript chips
 * follow. (reader/transcribe-flow.js mirrors the two known names
 * inline; it stays import-free so its tests need no chrome stub.)
 */
export function providerDisplayName(provider) {
    const p = String(provider || '').trim().toLowerCase();
    if (!p || p === 'local' || p === 'whisperx') return null;
    return { assemblyai: 'AssemblyAI', deepgram: 'Deepgram' }[p] || p;
}

/** The suffixed section heading. Suffixed on purpose: the Phase 22
 *  attach upsert replaces only the BARE `## Transcript` heading, so a
 *  diarized section can never be clobbered by a later paste-attach —
 *  the same protection YouTube's own `## Transcript — <lang>`
 *  sections rely on. Cloud results name their provider — the body is
 *  canonical and published, so "local" would be a durable lie. */
export function diarizedHeading(language, provider) {
    const label = languageLabel(language);
    const via = providerDisplayName(provider);
    if (via) {
        return label ? `Transcript — ${label} (${via}, diarized)` : `Transcript — ${via} (diarized)`;
    }
    return label ? `Transcript — ${label} (local, diarized)` : 'Transcript — local (diarized)';
}

/**
 * Compose the diarized capture body from the captured (transcript-less)
 * YouTube markdown plus the companion result. Returns the new canonical
 * markdown, the offset→time map over it, and the transcript_meta the
 * article needs for the speaker→claim prefill.
 *
 * Three transforms over the captured markdown:
 * 1. `## Description` → `## Description — YouTube`. MANDATORY:
 *    reconstructArticleFromEvent cuts any bare `## Description` section
 *    and assembleArticleBody re-appends it only for contentType
 *    'video' — on a 'transcript' capture the bytes would vanish on
 *    relay round-trip and fork the x-hash (the JOURNAL
 *    markdown-canonical trap).
 * 2. Any native `## Transcript — …` sections are dropped — unlabeled
 *    auto-cues are superseded by the diarized transcript (the archive's
 *    prior-version snapshot keeps them, honest versioning).
 * 3. The diarized section is appended under the suffixed heading with
 *    YouTube `&t=<s>s` deep links on the watch URL.
 *
 * @param {{capturedMarkdown: string, watchUrl: string,
 *          result: {language?: string, segments: Array}}} p
 * @returns {{markdown: string, timeMap: Array, transcriptMeta: object, heading: string}}
 */
export function buildDiarizedBody({ capturedMarkdown = '', watchUrl = '', result = {} } = {}) {
    const segments = Array.isArray(result.segments) ? result.segments : [];
    const turns = turnsFromSegments(segments);
    if (turns.length === 0) throw new Error('Transcription returned no usable segments');

    let base = String(capturedMarkdown || '').replace(/\s+$/, '');

    // (1) Rename the bare Description heading (round-trip safety).
    base = base.replace(/^## Description[ \t]*$/m, '## Description — YouTube');

    // (2) Drop native transcript sections (start-of-line suffixed
    // heading through the next same-level heading or EOF).
    base = base.replace(/^## Transcript — [^\n]*$[\s\S]*?(?=^## |$(?![\s\S]))/gm, '').replace(/\s+$/, '');

    const heading = diarizedHeading(result.language, result.model_info && result.model_info.provider);
    const linkFor = (secs) => `${watchUrl}&t=${secs}s`;

    // Assemble first WITHOUT offsets to learn where the section lands,
    // then re-render with the observer to place each paragraph. Cheaper:
    // render once, then locate each rendered paragraph by indexOf from a
    // moving cursor — paragraphs are unique-ordered substrings of the
    // section we just built, so the scan can never mismatch.
    const paras = [];
    const section = buildTranscriptSection({
        turns,
        meta: { url: watchUrl },
        heading,
        linkFor,
        onParagraph: (p, rendered) => paras.push({ p, rendered })
    });

    const markdown = base ? `${base}\n\n${section}` : section;

    const timeMap = [];
    let cursor = markdown.indexOf(`## ${heading}`);
    for (const { p, rendered } of paras) {
        const at = markdown.indexOf(rendered, cursor);
        if (at === -1) continue; // unreachable by construction; stay safe
        timeMap.push({
            start: at,
            end: at + rendered.length,
            startSec: p.startMs != null ? p.startMs / 1000 : null,
            endSec: p.endMs != null ? p.endMs / 1000 : null
        });
        cursor = at + rendered.length;
    }

    const speakers = [...new Set(turns.map((t) => t.speaker).filter(Boolean))];
    const transcriptMeta = {
        format: 'diarized',
        turn_count: turns.length,
        speaker_count: speakers.length,
        speakers
    };

    return { markdown, timeMap, transcriptMeta, heading };
}

// ------------------------------------------------------------------
// Article-level assembly helpers (used by the reader adoption seam)
// ------------------------------------------------------------------

/**
 * The `article.youtube.transcripts` entry for a diarized run. Carries
 * the mapped events because BOTH the transcript_lang tag emitter and
 * the reader's track chip gate on non-empty `events` (bodies still
 * never publish as tags — the builder only counts them).
 */
export function diarizedTrackEntry(result) {
    const segments = Array.isArray(result && result.segments) ? result.segments : [];
    const provider = String((result && result.model_info && result.model_info.provider) || '').trim().toLowerCase();
    const via = providerDisplayName(provider);
    return {
        // The chip's kind mark names the engine honestly (the "never
        // masquerade as human captions" rule): whisperx locally, the
        // provider name for cloud runs.
        kind: via ? provider : 'whisperx',
        languageCode: (result && result.language) || '',
        displayName: `${via || 'Local'} (diarized${result && result.language ? `, ${result.language}` : ''})`,
        // Deliberately 'local-diarized' for cloud runs too: this is the
        // replace-slot key the reader filters on when a re-transcription
        // adopts — one diarized track per capture, whatever the engine.
        role: 'local-diarized',
        events: segments
            .filter((s) => s && String(s.text || '').trim())
            .map((s) => ({
                startMs: Math.max(0, Math.round((Number(s.start) || 0) * 1000)),
                durationMs: Math.max(0, Math.round(((Number(s.end) || 0) - (Number(s.start) || 0)) * 1000)),
                text: String(s.text).trim()
            })),
        error: null,
        source: 'companion'
    };
}

/** The extraction-method value (existing tag; grammar documented in
 *  docs/NIP_DRAFT.md next to the pdfjs/llm forms). Local runs keep the
 *  two-model `whisperx-<asr>+<diarization>` form; a cloud provider is
 *  ONE integrated ASR+diarization model, so it publishes as a single
 *  `<provider>-<model>` token (e.g. `assemblyai-universal`,
 *  `deepgram-nova-3`). */
export function extractionMethodFor(modelInfo) {
    const provider = String((modelInfo && modelInfo.provider) || '').trim().toLowerCase();
    if (providerDisplayName(provider)) {
        const model = String((modelInfo && modelInfo.asr_model) || '').trim() || 'unknown';
        // Published tag value: keep it to the documented token charset.
        return `${provider}-${model}`.toLowerCase()
            .replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    }
    const asr = (modelInfo && modelInfo.asr_model) || 'large-v3';
    const diar = String((modelInfo && modelInfo.diarization_model) || 'pyannote')
        .replace(/^pyannote\/(speaker-diarization-)?/, 'pyannote-');
    return `whisperx-${asr}+${diar}`;
}

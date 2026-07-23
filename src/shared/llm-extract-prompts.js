// Standards: archival — docs/DISCIPLINES.md §12.
// LLM extraction assist — prompt + tool schema (Phase 18 C5,
// docs/COMPLEX_CONTENT_DESIGN.md §6).
//
// Two modes, one tool shape:
//
//   'structure'      — the PDF HAS a text layer (the common case). The
//                      model returns STRUCTURE OVER THE SUBSTRATE:
//                      ordered spans whose text is treated as a SEARCH
//                      KEY and re-grounded against the Tier-2 text
//                      (shared/llm-extract.js). Spans that ground are
//                      re-canonicalized to substrate bytes; spans that
//                      don't are dropped and counted. The stored
//                      capture never contains model-authored body text.
//   'transcription'  — no text layer (a scan). The model's
//                      transcription IS the capture — allowed, but
//                      extraction.method becomes 'llm:<model>' and the
//                      reader banners it, with the archived original
//                      bytes one click away.
//
// The mode changes the PROMPT, not the tool schema — the assembler
// (llm-extract.js) applies the honesty rules per mode. Keep the schema
// small: kind/text/level/cells/page. Everything else the model might
// volunteer is noise.
//
// EXTRACT_PROMPT_VERSION stamps provenance the way LENS_PROMPT_VERSION
// does — bump it whenever prompt text or schema changes meaning.

export const EXTRACT_PROMPT_VERSION = 'extract-v1';
export const EXTRACT_TOOL_NAME = 'xray_extract';

// Anthropic PDF-input limits (docs, 2026): ~100 pages and 32MB per
// REQUEST. The request carries the bytes BASE64-encoded (×4/3) plus
// JSON/prompt overhead, so the raw-byte cap must be set well under
// 32MB/1.34 — a "30MB with headroom" raw cap actually produced a
// ~40MB request and a guaranteed API rejection after consent
// (adversarial-review catch). 22MB raw → ~29.4MB encoded + overhead.
// Chunking a PDF by page range requires SPLITTING the bytes (the API
// has no page-range parameter), which needs a PDF library in the
// service worker — deliberately out of scope. Over-cap documents are
// refused with a clear error instead; the design's chunking note is a
// documented deferral, recorded in ROADMAP.
export const MAX_EXTRACT_PAGES = 100;
export const MAX_EXTRACT_BYTES = 22 * 1024 * 1024;

/** The forced tool: an ordered span list. */
export function buildExtractTool() {
    return {
        name: EXTRACT_TOOL_NAME,
        description: 'Return the document as an ordered list of content spans.',
        input_schema: {
            type: 'object',
            required: ['spans'],
            properties: {
                spans: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['kind'],
                        properties: {
                            kind: {
                                type: 'string',
                                enum: ['heading', 'paragraph', 'caption', 'table'],
                                description: 'Block type. Use table ONLY for real data tables.'
                            },
                            text: {
                                type: 'string',
                                description: 'The span text, verbatim from the document. Required for heading/paragraph/caption.'
                            },
                            level: {
                                type: 'integer',
                                description: 'Heading level 1-4. Headings only.'
                            },
                            cells: {
                                type: 'array',
                                items: { type: 'array', items: { type: 'string' } },
                                description: 'Table rows of cell strings, row 0 = the header row. Tables only.'
                            },
                            page: {
                                type: 'integer',
                                description: '1-based page number this span starts on.'
                            }
                        }
                    }
                }
            }
        }
    };
}

const COMMON_RULES = [
    'Rules:',
    '- Copy text VERBATIM from the document — never paraphrase, summarize,',
    '  translate, or "fix" wording, spelling, or punctuation. Every span is',
    '  checked against the document afterward; altered text is discarded.',
    '- Reading order: emit spans in the order a careful human reader would',
    '  read them (across column boundaries, not down the page).',
    '- Skip page furniture: running headers/footers, page numbers,',
    '  watermarks, line numbers.',
    '- Tables: kind "table" with `cells` (row 0 = header). Copy each cell',
    '  verbatim. Use table ONLY for genuine data tables — never for layout.',
    '- Figure/table captions: kind "caption".',
    '- Set `page` (1-based) on every span you can place.'
].join('\n');

/**
 * @param {'structure'|'transcription'} mode
 * @returns {string} the system prompt
 */
export function buildExtractSystemPrompt(mode) {
    if (mode === 'transcription') {
        return [
            'You are a document transcriber. The attached PDF is a SCANNED',
            'document with no machine-readable text layer. Transcribe it,',
            'faithfully, as ordered content spans via the xray_extract tool.',
            'Where a word is genuinely illegible, write "[illegible]" rather',
            'than guessing.',
            '',
            COMMON_RULES
        ].join('\n');
    }
    return [
        'You are a document-structure analyst. The attached PDF has a',
        'machine-readable text layer; a deterministic extractor has already',
        'captured its raw text but may have scrambled the STRUCTURE (column',
        'order, table layout, caption placement). Return the document as',
        'ordered content spans via the xray_extract tool. Your text spans',
        'will be matched back against the deterministic text — only the',
        'STRUCTURE you provide is new information, so verbatim fidelity is',
        'everything: a paraphrased span will fail its match and be thrown',
        'away.',
        '',
        COMMON_RULES
    ].join('\n');
}

/** The single user-turn content: the PDF as a document block. */
export function buildExtractUserContent(pdfBase64) {
    return [
        {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 }
        },
        {
            type: 'text',
            text: 'Extract this document as ordered spans using the xray_extract tool.'
        }
    ];
}

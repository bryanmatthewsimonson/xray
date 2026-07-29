// AI vision — prompt + tool schema (the "Describe images" pass).
//
// PURE module: no network, no chrome, no DOM — the llm-client reads
// these the way it reads llm-extract-prompts.js. One image per call
// (the lens/audit-module topology: each runtime message resets the MV3
// idle timer and a lost channel costs one retryable image, never the
// run).
//
// One tool shape serves both jobs the pass has:
//
//   caption        — ALWAYS returned: a short factual description of
//                    what the image shows, for images that exist for
//                    the human reader (photographs, illustrations).
//                    Merged into the body as an italic note that names
//                    the model, so the provenance of the description
//                    is inline and survives publish.
//   transcription  — the verbatim text visible in the image, when
//                    there is any (a scanned magazine page, a chart's
//                    labels, a screenshot of a document). Empty string
//                    when the image carries no legible text. The
//                    honesty rules mirror the PDF transcription mode:
//                    verbatim, reading order, "[illegible]" over
//                    guessing.
//
// VISION_PROMPT_VERSION stamps provenance the way EXTRACT_PROMPT_VERSION
// does — bump it whenever prompt text or schema changes meaning.

export const VISION_PROMPT_VERSION = 'vision-v1';
export const VISION_TOOL_NAME = 'xray_vision';

// Anthropic image-input limits (docs, 2026): 5MB per image AFTER
// base64 (×4/3), so the raw-byte ceiling sits at 5MB/1.34 with
// headroom — the extract pass learned this arithmetic the hard way
// (llm-extract-prompts.js). Images over the raw cap (or over the
// 8000px hard dimension limit, or in a container the API doesn't
// take) are re-encoded/downscaled by vision-image.js rather than
// refused: unlike PDF chunking, a canvas re-encode is cheap and
// lossless for this purpose.
export const MAX_VISION_RAW_BYTES = 3.5 * 1024 * 1024;
export const MAX_VISION_DIMENSION = 8000;
// Above ~1568px on the long side the API downscales server-side
// anyway; re-encoding to this bound client-side sends fewer bytes for
// identical model input.
export const VISION_TARGET_DIMENSION = 1568;
// The containers the Messages API accepts as image blocks. Anything
// else (AVIF, SVG, BMP, ICO, TIFF) must be rasterized/re-encoded.
export const VISION_MEDIA_TYPES = Object.freeze([
    'image/jpeg', 'image/png', 'image/gif', 'image/webp'
]);

// What one image may kind-classify as. Drives nothing structurally —
// it labels the review row so the human can triage "photo" accepts
// from "text-page" accepts at a glance.
export const VISION_CONTENT_KINDS = Object.freeze([
    'photo', 'text-page', 'mixed', 'chart', 'diagram', 'map',
    'screenshot', 'artwork', 'other'
]);

/** The forced tool: one image's caption + optional transcription. */
export function buildVisionTool() {
    return {
        name: VISION_TOOL_NAME,
        description: 'Return a factual caption for the image, and a verbatim transcription of any legible text in it.',
        input_schema: {
            type: 'object',
            required: ['content_kind', 'caption', 'transcription'],
            properties: {
                content_kind: {
                    type: 'string',
                    enum: VISION_CONTENT_KINDS.slice(),
                    description: 'What kind of image this is. Use text-page for a scanned page or document image whose content is primarily text.'
                },
                caption: {
                    type: 'string',
                    description: 'One to three factual sentences describing what the image shows. Never empty.'
                },
                transcription: {
                    type: 'string',
                    description: 'ALL legible text in the image, verbatim, in reading order. Empty string when the image contains no legible text.'
                },
                transcription_complete: {
                    type: 'boolean',
                    description: 'True when every piece of legible text was transcribed; false when text was cut off, partially illegible, or too small to read fully.'
                }
            }
        }
    };
}

export function buildVisionSystemPrompt() {
    return [
        'You describe a single image captured from a web article, via the',
        'xray_vision tool. The result becomes part of an archival research',
        'record, so factual accuracy matters more than fluency.',
        '',
        'Caption rules:',
        '- One to three sentences stating what the image literally shows:',
        '  subjects, setting, visible actions, composition.',
        '- Name people, organizations, or places ONLY when the image itself',
        '  identifies them (visible text, an unmistakable landmark) or the',
        '  provided article context names them explicitly. Otherwise',
        '  describe without naming ("a uniformed officer at a podium").',
        '- No speculation about intent, emotion, or events outside the',
        '  frame. No editorializing.',
        '',
        'Transcription rules:',
        '- Transcribe ALL legible text VERBATIM — never paraphrase,',
        '  summarize, translate, or fix wording, spelling, or punctuation.',
        '- Reading order: the order a careful human reader would read',
        '  (across column boundaries, not down the page).',
        '- Where a word is genuinely illegible, write "[illegible]" rather',
        '  than guessing; set transcription_complete false if any text was',
        '  cut off or unreadable.',
        '- An image with no legible text gets an empty transcription and',
        '  transcription_complete true.'
    ].join('\n');
}

/**
 * The single user-turn content: the image block plus its article
 * context. Context is advisory (helps the model use established names)
 * — the caption rules still forbid naming beyond what image + context
 * support.
 *
 * @param {object} req
 * @param {string} req.imageBase64   the image bytes, base64
 * @param {string} req.mediaType    one of VISION_MEDIA_TYPES
 * @param {string} [req.alt]         the image's alt text, if any
 * @param {string} [req.captionText] the human-authored figcaption, if any
 * @param {string} [req.articleTitle]
 * @param {string} [req.articleUrl]
 */
export function buildVisionUserContent(req = {}) {
    const lines = ['Describe this image using the xray_vision tool.'];
    if (req.articleTitle) lines.push(`It appears in the article: ${req.articleTitle}`);
    if (req.articleUrl) lines.push(`Article URL: ${req.articleUrl}`);
    if (req.alt) lines.push(`The image's alt text: ${req.alt}`);
    if (req.captionText) lines.push(`The image's published caption: ${req.captionText}`);
    return [
        {
            type: 'image',
            source: { type: 'base64', media_type: req.mediaType, data: req.imageBase64 }
        },
        { type: 'text', text: lines.join('\n') }
    ];
}

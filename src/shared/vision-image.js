// AI vision — image byte handling for the "Describe images" pass.
//
// The background service worker composes these (the screenshot module's
// OffscreenCanvas precedent): acquire bytes → sniff the container →
// re-encode/downscale when the Messages API won't take the original →
// base64. The decision logic (sniff, scale plan, needs-reencode) is
// pure and unit-tested; only prepareImageForVision touches canvas, and
// it is guarded so importing this module in Node never throws.

import {
    MAX_VISION_RAW_BYTES, MAX_VISION_DIMENSION,
    VISION_TARGET_DIMENSION, VISION_MEDIA_TYPES
} from './vision-prompts.js';

/**
 * Sniff an image container from its magic bytes. Returns a MIME type
 * string, or null when the bytes are not a recognizable raster image
 * this module knows how to handle. Deliberately covers more than
 * VISION_MEDIA_TYPES — an AVIF or BMP sniffs successfully and is then
 * re-encoded, while null means "don't even try canvas".
 *
 * @param {Uint8Array|ArrayBuffer} bytes
 * @returns {string|null}
 */
export function sniffImageMediaType(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || new ArrayBuffer(0));
    if (b.length < 12) return null;
    // JPEG: FF D8 FF
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47
        && b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) return 'image/png';
    // GIF: "GIF87a" / "GIF89a"
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38
        && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return 'image/gif';
    // RIFF….WEBP
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
        && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
    // ISO BMFF ("....ftyp") with an av01/avif brand → AVIF
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
        const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
        if (brand.startsWith('avif') || brand.startsWith('avis')) return 'image/avif';
        return null; // some other BMFF (video) — not ours
    }
    // BMP: "BM"
    if (b[0] === 0x42 && b[1] === 0x4D) return 'image/bmp';
    return null;
}

/**
 * Decide whether the original bytes can go to the API as-is.
 * Pure — dimensions come from the caller's decode.
 *
 * @param {{mediaType: string|null, byteLength: number, width: number, height: number}} img
 * @returns {boolean}
 */
export function needsReencode(img) {
    if (!img || !VISION_MEDIA_TYPES.includes(img.mediaType)) return true;
    if (img.byteLength > MAX_VISION_RAW_BYTES) return true;
    if (img.width > MAX_VISION_DIMENSION || img.height > MAX_VISION_DIMENSION) return true;
    // Oversized-for-the-model images re-encode too: the API downscales
    // past the target anyway, so sending the full bytes buys nothing.
    if (Math.max(img.width, img.height) > VISION_TARGET_DIMENSION) return true;
    return false;
}

/**
 * Target dimensions for a re-encode: longest side clamped to
 * VISION_TARGET_DIMENSION, aspect preserved, never upscaled.
 * Pure — exported for unit tests.
 *
 * @param {number} width
 * @param {number} height
 * @returns {{width: number, height: number}|null} null on degenerate input
 */
export function visionScalePlan(width, height) {
    if (!(width > 0) || !(height > 0)) return null;
    const longest = Math.max(width, height);
    if (longest <= VISION_TARGET_DIMENSION) {
        return { width: Math.round(width), height: Math.round(height) };
    }
    const scale = VISION_TARGET_DIMENSION / longest;
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale))
    };
}

/**
 * Chunked base64 — String.fromCharCode over a whole multi-MB buffer
 * blows the argument-count limit (the extract handler's lesson).
 *
 * @param {Uint8Array|ArrayBuffer} bytes
 * @returns {string}
 */
export function bytesToBase64(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || new ArrayBuffer(0));
    let binary = '';
    const CHUNK = 32768;
    for (let i = 0; i < u8.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

/**
 * Turn arbitrary image bytes into an API-ready `{ base64, mediaType }`
 * — pass-through when the original already qualifies, otherwise an
 * OffscreenCanvas decode → downscale → JPEG re-encode (JPEG because
 * the re-encode targets photographs and scans; a text scan survives
 * 0.9-quality JPEG at 1568px comfortably).
 *
 * Canvas-dependent: only callable where OffscreenCanvas and
 * createImageBitmap exist (the SW, extension pages). Throws with a
 * clear message otherwise — callers surface it per image.
 *
 * @param {ArrayBuffer|Uint8Array} bytes
 * @returns {Promise<{base64: string, mediaType: string, reencoded: boolean}>}
 */
export async function prepareImageForVision(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || new ArrayBuffer(0));
    if (!u8.length) throw new Error('empty image bytes');
    const sniffed = sniffImageMediaType(u8);
    if (!sniffed) throw new Error('not a recognizable raster image');

    if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
        // No canvas (Node): pass through only what needs no work.
        if (VISION_MEDIA_TYPES.includes(sniffed) && u8.length <= MAX_VISION_RAW_BYTES) {
            return { base64: bytesToBase64(u8), mediaType: sniffed, reencoded: false };
        }
        throw new Error('image needs re-encoding but no canvas is available');
    }

    let bitmap;
    try {
        bitmap = await createImageBitmap(new Blob([u8], { type: sniffed }));
    } catch (err) {
        throw new Error('could not decode image: ' + ((err && err.message) || err));
    }
    try {
        const img = {
            mediaType: sniffed, byteLength: u8.length,
            width: bitmap.width, height: bitmap.height
        };
        if (!needsReencode(img)) {
            return { base64: bytesToBase64(u8), mediaType: sniffed, reencoded: false };
        }
        const plan = visionScalePlan(bitmap.width, bitmap.height);
        if (!plan) throw new Error('image has no drawable dimensions');
        const canvas = new OffscreenCanvas(plan.width, plan.height);
        const ctx = canvas.getContext('2d');
        // Scans are white-paper documents; a white matte also keeps
        // transparent PNGs readable instead of composited on black.
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, plan.width, plan.height);
        ctx.drawImage(bitmap, 0, 0, plan.width, plan.height);
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
        const out = new Uint8Array(await blob.arrayBuffer());
        if (out.length > MAX_VISION_RAW_BYTES) {
            throw new Error('image is too large even after re-encoding');
        }
        return { base64: bytesToBase64(out), mediaType: 'image/jpeg', reencoded: true };
    } finally {
        try { bitmap.close(); } catch (_) { /* best-effort */ }
    }
}

/**
 * Is this image URL pointed somewhere the vision fetch must not go?
 * The SW fetch behind `xray:vision:describe` holds `<all_urls>`, and
 * the ref comes from the captured (untrusted) article body — an <img>
 * naming http://127.0.0.1/… or http://192.168.1.1/… must not turn the
 * pass into a probe of the user's local network (the scholar-fetch
 * open-proxy rule, applied as an address filter since image CDNs are
 * legitimately arbitrary hosts). Literal checks only — a SW cannot
 * pin DNS. Returns a short human-readable reason, or null when the
 * URL is fetchable.
 *
 * @param {string} raw
 * @returns {string|null}
 */
export function blockedImageUrl(raw) {
    let u;
    try { u = new URL(String(raw || '')); } catch (_) { return 'not a valid URL'; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'not an http(s) URL';
    let host = u.hostname.toLowerCase();
    // Strip the fully-qualified trailing root label BEFORE any
    // comparison. The URL parser normalizes the numeric host forms for
    // us — 2130706433, 0x7f000001 and 127.1 all arrive as "127.0.0.1",
    // and a v4 literal with a trailing dot is normalized too — but it
    // does NOT strip one from a NAMED host, so "localhost." reached the
    // equality check below as a miss and was admitted while resolving
    // to exactly the host this function exists to refuse.
    // (Found 2026-08-15 via the direct-cloud-transcription URL gate.)
    if (host.endsWith('.') && !host.endsWith(']')) host = host.replace(/\.+$/, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
        return 'a local hostname';
    }
    // IPv6 literal (URL.hostname keeps the brackets).
    if (host.startsWith('[') && host.endsWith(']')) {
        const h = host.slice(1, -1);
        // v4-mapped, in either the dotted spelling or the hex form the
        // URL parser canonicalizes it to (::ffff:7f00:1).
        const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
        if (mapped) return blockedV4(mapped[1]);
        const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
        if (mappedHex) {
            const hi = parseInt(mappedHex[1], 16);
            const lo = parseInt(mappedHex[2], 16);
            return blockedV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
        }
        if (h === '::' || h === '::1') return 'a loopback address';
        const head = h.split(':')[0].padStart(4, '0');
        if (/^fe[89ab]/.test(head)) return 'a link-local address';
        if (/^f[cd]/.test(head)) return 'a private address';
        return null;
    }
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return blockedV4(host);
    return null;
}

function blockedV4(ip) {
    const o = ip.split('.').map(Number);
    if (o.some((n) => !(n >= 0 && n <= 255))) return 'not a valid address';
    if (o[0] === 0) return 'a non-routable address';
    if (o[0] === 127) return 'a loopback address';
    if (o[0] === 10) return 'a private address';
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return 'a private address';
    if (o[0] === 192 && o[1] === 168) return 'a private address';
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return 'a private (CGNAT) address';
    if (o[0] === 169 && o[1] === 254) return 'a link-local address';
    return null;
}

/**
 * Decode a `data:` URL into bytes. Returns null for anything that is
 * not a base64 data URL (SVG-as-text data URLs are deliberately not
 * handled — rasterizing SVG needs a DOM image pipeline, not worth it
 * for the tracking-pixel-sized images that use them).
 *
 * @param {string} dataUrl
 * @returns {{bytes: Uint8Array, mediaType: string}|null}
 */
export function decodeDataUrl(dataUrl) {
    const m = /^data:([^;,]+);base64,(.*)$/.exec(String(dataUrl || ''));
    if (!m) return null;
    try {
        const bin = atob(m[2]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return { bytes, mediaType: m[1] };
    } catch (_) { return null; }
}

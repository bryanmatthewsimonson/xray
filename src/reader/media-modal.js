// Media & transcript modal — Phase 22 (URL-first media metadata).
//
// The maintainer's reframe: the URL is the identity. "Podcast" or
// "video" is user-declared METADATA on a capture (never inferred), and
// a transcript ATTACHES to the capture rather than forming a new
// record. This modal edits three things on the open article:
//
//   - article.media     ('podcast' | 'video' | absent) — the Phase-22
//     wire tag; what the URL CONTAINS, distinct from contentType
//     (what the extractor produced).
//   - article.podcast   — the 21.3 identity block (show / feed GUID /
//     episode GUID / feed URL / iTunes id). The GUID i-tags are what
//     join the same episode captured at its Spotify, Apple, Substack,
//     YouTube, or custom-site URLs.
//   - an optional pasted/uploaded transcript, parsed with the Phase-21
//     parser and returned as `parse` — reader/index.js owns the
//     canonical-side branch, the body upsert, and the hash/save
//     consequences.
//
// The adjudicate-modal idiom: Promise-returning, body-appended overlay
// + backdrop + Escape, self-injected <style> (xr-media-* only).

import { parseTranscript, describeTranscriptParse } from '../shared/transcript-parse.js';
import {
    SOURCE_TYPES, SOURCE_TYPE_LABELS, suggestSourceType,
    EVIDENCE_ROLES, EVIDENCE_ROLE_LABELS
} from '../shared/truth-taxonomy.js';

// Cap the per-link role editor so an article with hundreds of links
// doesn't build a runaway modal. External links only.
const MAX_LINK_ROWS = 60;

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function isHttpUrl(v) {
    try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; }
    catch (_) { return false; }
}

function field(label, id, value, placeholder, hint) {
    return `
      <label class="xr-media__field">
        <span class="xr-media__label">${escapeHtml(label)}</span>
        <input type="text" spellcheck="false" id="${id}"
               value="${escapeHtml(value || '')}"
               placeholder="${escapeHtml(placeholder || '')}" />
        ${hint ? `<span class="xr-media__hint">${escapeHtml(hint)}</span>` : ''}
      </label>`;
}

// The external outbound links available to role-tag (deduped by the
// capture already). Returns [] when the article carries none.
function externalLinks(article) {
    return (Array.isArray(article.links) ? article.links : [])
        .filter((l) => l && l.url && !l.internal)
        .slice(0, MAX_LINK_ROWS);
}

function linksSection(article) {
    const links = externalLinks(article);
    if (!links.length) return '';
    const roleOpts = (sel) => ['<option value="">no role</option>']
        .concat(EVIDENCE_ROLES.map((r) =>
            `<option value="${r}" ${sel === r ? 'selected' : ''}>${escapeHtml(EVIDENCE_ROLE_LABELS[r])}</option>`))
        .join('');
    const rows = links.map((l) => {
        const label = l.text ? l.text : l.url;
        return `
          <div class="xr-media__link">
            <span class="xr-media__link-label" title="${escapeHtml(l.url)}">${escapeHtml(label)}</span>
            <select class="xr-media__link-role" data-link-url="${escapeHtml(l.url)}">
              ${roleOpts(EVIDENCE_ROLES.includes(l.role) ? l.role : '')}
            </select>
          </div>`;
    }).join('');
    const total = (article.links || []).filter((l) => l && l.url && !l.internal).length;
    const more = total > links.length ? `<span class="xr-media__hint">Showing ${links.length} of ${total} links.</span>` : '';
    return `
      <details class="xr-media__links">
        <summary>Outbound links — how they're cited (${links.length})</summary>
        <span class="xr-media__hint">Mark each link's role: is it the primary source cited as evidence, or merely mentioned, supported, disputed, reviewed?</span>
        ${rows}
        ${more}
      </details>`;
}

function buildHtml(article) {
    const media = article.media || '';
    const pod = article.podcast || {};
    const hasTranscript = !!article.transcript_meta;
    const opt = (v, label) =>
        `<option value="${v}" ${media === v ? 'selected' : ''}>${label}</option>`;

    // Source type — prefill from the stored value, else the suggestion
    // (a hint, not an auto-set: the dropdown stays on "not set" until
    // the user picks). Phase 23.1.
    const srcType = article.source_type || '';
    const suggestion = srcType ? null : suggestSourceType(article);
    const srcOpt = (v) =>
        `<option value="${v}" ${srcType === v ? 'selected' : ''}>${escapeHtml(SOURCE_TYPE_LABELS[v])}</option>`;

    return `
      <div class="xr-media__backdrop"></div>
      <div class="xr-media__card" role="dialog" aria-label="Media, source and transcript">
        <header class="xr-media__head">
          <h3 class="xr-media__title">🎙 Media &amp; source</h3>
        </header>
        <div class="xr-media__body">
          <label class="xr-media__field">
            <span class="xr-media__label">Source type</span>
            <select id="xr-media-srctype">
              <option value="">not declared</option>
              ${SOURCE_TYPES.map(srcOpt).join('\n              ')}
            </select>
            <span class="xr-media__hint">${suggestion
                ? `What KIND of source this is. Suggested: <strong>${escapeHtml(SOURCE_TYPE_LABELS[suggestion])}</strong> — confirm or change.`
                : 'What KIND of source this is — a primary record/paper vs. reporting, analysis, or a summary.'}</span>
          </label>

          ${linksSection(article)}

          <label class="xr-media__field">
            <span class="xr-media__label">This URL contains</span>
            <select id="xr-media-type">
              ${opt('', 'no declared media')}
              ${opt('podcast', 'a podcast episode')}
              ${opt('video', 'a video')}
            </select>
            <span class="xr-media__hint">Your declaration — published as a media tag, never inferred.</span>
          </label>

          <fieldset class="xr-media__ids" id="xr-media-ids" ${media === 'podcast' ? '' : 'hidden'}>
            <legend>Podcast identity (optional — joins this capture with the same episode elsewhere)</legend>
            ${field('Show', 'xr-media-show', pod.show, 'Podcast / show name')}
            ${field('Feed GUID', 'xr-media-feedguid', pod.feed_guid, 'podcast:guid feed GUID')}
            ${field('Episode GUID', 'xr-media-epguid', pod.episode_guid, 'episode GUID (case-sensitive)')}
            ${field('Feed URL', 'xr-media-feedurl', pod.feed_url, 'RSS feed URL')}
            ${field('iTunes ID', 'xr-media-itunes', pod.itunes_id, 'Apple collection id (digits)')}
          </fieldset>

          <div class="xr-media__transcript">
            <span class="xr-media__label">Attach a transcript</span>
            ${hasTranscript
                ? '<div class="xr-media__warn">⚠ A transcript is already attached — attaching a new one REPLACES the existing ## Transcript section.</div>'
                : ''}
            <textarea id="xr-media-text" rows="7"
                placeholder="Paste a transcript — SRT, WebVTT, or &quot;Speaker: text&quot; lines… (optional)"></textarea>
            <div class="xr-media__row">
              <button type="button" class="xr-media__btn" id="xr-media-upload">Upload .txt / .srt / .vtt</button>
              <input type="file" id="xr-media-file" accept=".txt,.srt,.vtt,text/plain,text/vtt" hidden />
            </div>
            <div class="xr-media__preview" id="xr-media-preview"></div>
          </div>

          <div class="xr-media__err" hidden></div>
        </div>
        <footer class="xr-media__foot">
          <span class="xr-media__foot-gap"></span>
          <button type="button" class="xr-media__btn" data-action="cancel">Cancel</button>
          <button type="button" class="xr-media__btn xr-media__btn--primary" data-action="save">Save</button>
        </footer>
      </div>`;
}

/**
 * @param {object} article  the open article (prefills; never mutated here)
 * @returns {Promise<{media: string|null, sourceType: string|null, linkRoles: object, podcast: object|null, parse: object|null}|null>}
 *   null on cancel. `parse` is a parseTranscript result (turns present)
 *   when the user pasted a transcript, else null.
 */
export function openMediaModal(article) {
    ensureStyles();

    return new Promise((resolve) => {
        const host = document.createElement('div');
        host.className = 'xr-media';
        host.innerHTML = buildHtml(article || {});
        document.body.appendChild(host);
        const $ = (sel) => host.querySelector(sel);

        const close = (result) => {
            document.removeEventListener('keydown', onKey);
            if (host.parentNode) host.parentNode.removeChild(host);
            resolve(result);
        };
        const onKey = (ev) => { if (ev.key === 'Escape') close(null); };
        const showError = (msg) => {
            const err = $('.xr-media__err');
            err.textContent = msg;
            err.hidden = false;
        };

        let lastParse = null;
        let previewTimer = null;
        const schedulePreview = () => {
            if (previewTimer) clearTimeout(previewTimer);
            previewTimer = setTimeout(() => {
                const text = $('#xr-media-text').value;
                const preview = $('#xr-media-preview');
                if (!text.trim()) { preview.replaceChildren(); lastParse = null; return; }
                lastParse = parseTranscript(text);
                preview.replaceChildren();
                const line = document.createElement('div');
                line.className = 'xr-media__detected';
                line.textContent = describeTranscriptParse(lastParse);
                preview.appendChild(line);
                for (const w of lastParse.warnings) {
                    const warn = document.createElement('div');
                    warn.className = 'xr-media__warn';
                    warn.textContent = `⚠ ${w}`;
                    preview.appendChild(warn);
                }
            }, 300);
        };

        $('#xr-media-type').addEventListener('change', () => {
            $('#xr-media-ids').hidden = $('#xr-media-type').value !== 'podcast';
        });
        $('#xr-media-text').addEventListener('input', schedulePreview);
        $('#xr-media-upload').addEventListener('click', () => $('#xr-media-file').click());
        $('#xr-media-file').addEventListener('change', async () => {
            const input = $('#xr-media-file');
            const file = input.files && input.files[0];
            input.value = '';
            if (!file) return;
            try { $('#xr-media-text').value = await file.text(); schedulePreview(); }
            catch (_) { showError('Could not read that file.'); }
        });

        $('.xr-media__backdrop').addEventListener('click', () => close(null));
        $('[data-action="cancel"]').addEventListener('click', () => close(null));
        document.addEventListener('keydown', onKey);

        $('[data-action="save"]').addEventListener('click', () => {
            $('.xr-media__err').hidden = true;

            const media = $('#xr-media-type').value || null;
            const val = (id) => $(id).value.trim();
            const feedUrl = val('#xr-media-feedurl');
            const itunes = val('#xr-media-itunes');
            if (feedUrl && !isHttpUrl(feedUrl)) {
                showError('Feed URL must be a full http(s) URL.');
                return;
            }
            if (itunes && !/^\d+$/.test(itunes)) {
                showError('iTunes ID is digits only (the Apple collection id).');
                return;
            }

            const podcast = {};
            if (val('#xr-media-show')) podcast.show = val('#xr-media-show');
            if (val('#xr-media-feedguid')) podcast.feed_guid = val('#xr-media-feedguid');
            if (val('#xr-media-epguid')) podcast.episode_guid = val('#xr-media-epguid');
            if (feedUrl) podcast.feed_url = feedUrl;
            if (itunes) podcast.itunes_id = itunes;

            // A pasted transcript must actually parse into turns — the
            // debounced preview may lag the last keystroke, so re-parse
            // the verbatim text at save time (the parse is cheap).
            let parse = null;
            const text = $('#xr-media-text').value;
            if (text.trim()) {
                parse = parseTranscript(text);
                if (!parse.turns.length) {
                    showError('No transcript turns detected in the pasted text.');
                    return;
                }
            }

            const sourceType = $('#xr-media-srctype').value || null;

            // Per-link evidence roles → { url: role } (set values only).
            const linkRoles = {};
            host.querySelectorAll('.xr-media__link-role').forEach((sel) => {
                const url = sel.getAttribute('data-link-url');
                if (url && sel.value) linkRoles[url] = sel.value;
            });

            close({
                media,
                sourceType,
                linkRoles,
                podcast: Object.keys(podcast).length ? podcast : null,
                parse
            });
        });
    });
}

let stylesInjected = false;
function ensureStyles() {
    if (stylesInjected || typeof document === 'undefined') return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.id = 'xr-media-styles';
    style.textContent = `
.xr-media { position: fixed; inset: 0; z-index: 10010; }
.xr-media__backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.55); }
.xr-media__card {
  position: relative; margin: 4vh auto 0; width: min(560px, calc(100vw - 32px));
  max-height: 90vh; display: flex; flex-direction: column;
  background: var(--xr-surface, #242424); color: var(--xr-text, #e6e6e6);
  border: 1px solid var(--xr-border, #333); border-radius: 10px;
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.xr-media__head, .xr-media__foot { display: flex; align-items: center; gap: 8px; padding: 12px 16px; }
.xr-media__head { border-bottom: 1px solid var(--xr-border, #333); }
.xr-media__foot { border-top: 1px solid var(--xr-border, #333); }
.xr-media__foot-gap { flex: 1; }
.xr-media__title { margin: 0; font-size: 15px; flex: 1; }
.xr-media__body { padding: 12px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
.xr-media__field { display: flex; flex-direction: column; gap: 4px; }
.xr-media__label { font-weight: 600; font-size: 13px; }
.xr-media__hint { font-size: 12px; opacity: .65; }
.xr-media__field input, .xr-media__field select, .xr-media__transcript textarea {
  background: var(--xr-surface-2, #1c1c1c); color: inherit;
  border: 1px solid var(--xr-border, #333); border-radius: 6px; padding: 6px 8px;
  font: inherit;
}
.xr-media__ids { border: 1px solid var(--xr-border, #333); border-radius: 8px;
  padding: 8px 12px 12px; display: flex; flex-direction: column; gap: 8px; }
.xr-media__ids legend { font-size: 12px; opacity: .75; padding: 0 4px; }
.xr-media__links { border: 1px solid var(--xr-border, #333); border-radius: 8px; padding: 6px 10px; }
.xr-media__links summary { cursor: pointer; font-weight: 600; font-size: 13px; }
.xr-media__link { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
.xr-media__link-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.xr-media__link-role { flex: 0 0 auto; }
.xr-media__transcript { display: flex; flex-direction: column; gap: 6px; }
.xr-media__transcript textarea { width: 100%; box-sizing: border-box; resize: vertical; }
.xr-media__row { display: flex; gap: 8px; }
.xr-media__preview { display: flex; flex-direction: column; gap: 2px; }
.xr-media__detected { font-size: 12px; opacity: .85; }
.xr-media__warn { font-size: 12px; color: var(--xr-warning, #fbbf24); }
.xr-media__err { font-size: 13px; color: var(--xr-danger, #f87171); }
.xr-media__btn {
  background: transparent; color: inherit; border: 1px solid var(--xr-border, #444);
  border-radius: 6px; padding: 6px 12px; cursor: pointer; font: inherit;
}
.xr-media__btn:hover { border-color: var(--xr-accent, #7aa2f7); }
.xr-media__btn--primary { background: var(--xr-accent, #7aa2f7); color: #111; border-color: transparent; }
`;
    document.head.appendChild(style);
}

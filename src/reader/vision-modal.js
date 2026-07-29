// AI-vision review modal — the reader's "Describe images" surface.
//
// Owns the UI only: image selection (with the off-device disclosure on
// the send button itself), per-image progress as results stream in,
// and the per-part Accept checkboxes. The caller owns everything with
// consequences — collection (vision-notes.js), the per-image SW calls
// (`xray:vision:describe`), and the body merge + hash recompute
// (index.js, the applyMediaResult template). Nothing here reads
// storage or talks to the network.
//
// Promise-returning body-appended overlay, the media-modal idiom.
// Resolves to the accepted notes:
//   [{ ref, caption?, transcription?, transcription_complete, model }]
// — an empty array on cancel or when nothing was accepted.

/**
 * @param {object} opts
 * @param {Array<{ref: string, alt: string, captionText: string,
 *                thumbSrc: string}>} opts.images
 * @param {string} opts.model     the configured model id (disclosure)
 * @param {(img: object) => Promise<object>} opts.runOne
 *                                one xray:vision:describe round trip
 * @param {() => {stop: () => void}} [opts.keepalive]
 *                                SW keepalive factory for the run
 * @returns {Promise<Array<object>>}
 */
export function openVisionModal(opts) {
    const images = Array.isArray(opts && opts.images) ? opts.images : [];
    const runOne = opts && opts.runOne;
    ensureStyles();

    return new Promise((resolve) => {
        const host = document.createElement('div');
        host.className = 'xr-vision';
        host.innerHTML = `
<div class="xr-vision__backdrop"></div>
<div class="xr-vision__card" role="dialog" aria-modal="true" aria-label="Describe images with AI">
  <div class="xr-vision__head">
    <h2 class="xr-vision__title">🖼 Describe images with AI</h2>
    <button type="button" class="xr-vision__btn" data-act="close" aria-label="Close">✕</button>
  </div>
  <p class="xr-vision__hint">
    Each selected image is sent to the Anthropic API under your key — it
    leaves this device. The model returns a factual caption, plus a
    verbatim transcription when the image contains legible text. Nothing
    touches the article until you accept it below, and accepted notes are
    labeled in the body with the model that wrote them.
  </p>
  <div class="xr-vision__list"></div>
  <div class="xr-vision__foot">
    <span class="xr-vision__status"></span>
    <span class="xr-vision__foot-gap"></span>
    <button type="button" class="xr-vision__btn" data-act="cancel">Cancel</button>
    <button type="button" class="xr-vision__btn xr-vision__btn--primary" data-act="run"></button>
    <button type="button" class="xr-vision__btn xr-vision__btn--primary" data-act="accept" hidden>Merge accepted notes</button>
  </div>
</div>`;
        document.body.appendChild(host);

        const $card = (sel) => host.querySelector(sel);
        if (opts && opts.model) {
            const hint = host.querySelector('.xr-vision__hint');
            hint.textContent = hint.textContent.replace('the Anthropic API', `${opts.model} via the Anthropic API`);
        }
        const list = $card('.xr-vision__list');
        const statusEl = $card('.xr-vision__status');
        const runBtn = $card('[data-act="run"]');
        const acceptBtn = $card('[data-act="accept"]');

        // Per-image row state, index-aligned with `images`.
        const rows = images.map((img, i) => {
            const row = document.createElement('div');
            row.className = 'xr-vision__row';
            row.innerHTML = `
<label class="xr-vision__pick">
  <input type="checkbox" class="xr-vision__send" checked>
  <img class="xr-vision__thumb" alt="">
</label>
<div class="xr-vision__meta">
  <div class="xr-vision__name"></div>
  <div class="xr-vision__result" hidden></div>
</div>`;
            const thumb = row.querySelector('.xr-vision__thumb');
            thumb.src = img.thumbSrc || '';
            const name = row.querySelector('.xr-vision__name');
            name.textContent = img.alt || img.captionText || shortRef(img.ref);
            name.title = img.ref;
            list.appendChild(row);
            return { img, el: row, result: null, error: null, index: i };
        });
        if (rows.length === 0) {
            statusEl.textContent = 'No images found in this capture.';
            runBtn.disabled = true;
        }

        const selectedRows = () => rows.filter((r) => r.el.querySelector('.xr-vision__send').checked);
        const refreshRunLabel = () => {
            const n = selectedRows().length;
            runBtn.textContent = `Send ${n} image${n === 1 ? '' : 's'} to Anthropic`;
            runBtn.disabled = n === 0;
        };
        refreshRunLabel();
        list.addEventListener('change', (ev) => {
            if (ev.target.classList.contains('xr-vision__send')) refreshRunLabel();
        });

        let running = false;
        let keepalive = null;
        const close = (value) => {
            document.removeEventListener('keydown', onKey, true);
            if (keepalive) { try { keepalive.stop(); } catch (_) { /* done */ } }
            if (host.parentNode) host.parentNode.removeChild(host);
            resolve(value);
        };
        // Escape declines — for an off-device send, the safe default
        // must be the reachable one. Ignored mid-run (results are paid
        // for; closing then is the explicit Cancel).
        const onKey = (ev) => {
            if (ev.key === 'Escape' && !running) { ev.preventDefault(); close([]); }
        };
        document.addEventListener('keydown', onKey, true);
        $card('[data-act="close"]').addEventListener('click', () => close([]));
        $card('[data-act="cancel"]').addEventListener('click', () => close([]));

        const renderResult = (row) => {
            const box = row.el.querySelector('.xr-vision__result');
            box.hidden = false;
            if (row.error) {
                box.innerHTML = '';
                const err = document.createElement('div');
                err.className = 'xr-vision__err';
                err.textContent = row.error;
                box.appendChild(err);
                return;
            }
            const r = row.result;
            box.innerHTML = '';
            const kind = document.createElement('div');
            kind.className = 'xr-vision__kind';
            kind.textContent = r.content_kind + (r.transcription ? ' · has text' : '');
            box.appendChild(kind);

            const cap = document.createElement('label');
            cap.className = 'xr-vision__part';
            cap.innerHTML = '<input type="checkbox" class="xr-vision__take-caption" checked> <span></span>';
            cap.querySelector('span').textContent = 'Caption: ' + r.caption;
            box.appendChild(cap);

            if (r.transcription) {
                const tr = document.createElement('label');
                tr.className = 'xr-vision__part';
                tr.innerHTML = '<input type="checkbox" class="xr-vision__take-text" checked> <span></span>';
                tr.querySelector('span').textContent =
                    'Text in image' + (r.transcription_complete ? '' : ' (may be incomplete)')
                    + ': ' + r.transcription;
                box.appendChild(tr);
            }
        };

        runBtn.addEventListener('click', async () => {
            if (running || typeof runOne !== 'function') return;
            running = true;
            runBtn.hidden = true;
            const picked = selectedRows();
            rows.forEach((r) => { r.el.querySelector('.xr-vision__send').disabled = true; });
            if (opts.keepalive) { try { keepalive = opts.keepalive(); } catch (_) { keepalive = null; } }

            let done = 0;
            statusEl.textContent = `Describing 0/${picked.length}…`;
            // Bounded concurrency (2): each message is its own SW round
            // trip, so a lost channel costs one retryable image.
            const queue = picked.slice();
            const worker = async () => {
                for (;;) {
                    const row = queue.shift();
                    if (!row) return;
                    row.el.classList.add('xr-vision__row--busy');
                    let resp = null;
                    try { resp = await runOne(row.img); }
                    catch (err) { resp = { ok: false, error: (err && err.message) || 'call failed' }; }
                    row.el.classList.remove('xr-vision__row--busy');
                    if (resp && resp.ok && resp.result) {
                        row.result = { ...resp.result, model: resp.model || '' };
                    } else {
                        row.error = (resp && resp.error) || 'No response (the service worker may have restarted) — run again.';
                    }
                    done += 1;
                    statusEl.textContent = `Describing ${done}/${picked.length}…`;
                    renderResult(row);
                }
            };
            await Promise.all([worker(), worker()]);
            if (keepalive) { try { keepalive.stop(); } catch (_) { /* done */ } keepalive = null; }
            running = false;

            const ok = rows.filter((r) => r.result).length;
            statusEl.textContent = ok
                ? `${ok} of ${picked.length} described — review and merge below.`
                : 'No image could be described.';
            if (ok) acceptBtn.hidden = false;
        });

        acceptBtn.addEventListener('click', () => {
            const accepted = [];
            for (const row of rows) {
                if (!row.result) continue;
                const takeCap = row.el.querySelector('.xr-vision__take-caption');
                const takeText = row.el.querySelector('.xr-vision__take-text');
                const note = {
                    ref: row.img.ref,
                    model: row.result.model,
                    transcription_complete: row.result.transcription_complete
                };
                if (takeCap && takeCap.checked) note.caption = row.result.caption;
                if (takeText && takeText.checked) note.transcription = row.result.transcription;
                if (note.caption || note.transcription) accepted.push(note);
            }
            close(accepted);
        });
    });
}

function shortRef(ref) {
    const s = String(ref || '');
    if (s.startsWith('xray-figure:')) return 'archived figure ' + s.slice(12, 20) + '…';
    if (s.startsWith('data:')) return 'inline image';
    try { const u = new URL(s); return u.pathname.split('/').pop() || u.hostname; }
    catch (_) { return s.slice(0, 48); }
}

let stylesInjected = false;
function ensureStyles() {
    if (stylesInjected || typeof document === 'undefined') return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.id = 'xr-vision-styles';
    style.textContent = `
.xr-vision { position: fixed; inset: 0; z-index: 10010; }
.xr-vision__backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.55); }
.xr-vision__card {
  position: relative; margin: 4vh auto 0; width: min(640px, calc(100vw - 32px));
  max-height: 90vh; display: flex; flex-direction: column;
  background: var(--xr-surface, #242424); color: var(--xr-text, #e6e6e6);
  border: 1px solid var(--xr-border, #333); border-radius: 10px;
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.xr-vision__head, .xr-vision__foot { display: flex; align-items: center; gap: 8px; padding: 12px 16px; }
.xr-vision__head { border-bottom: 1px solid var(--xr-border, #333); }
.xr-vision__foot { border-top: 1px solid var(--xr-border, #333); }
.xr-vision__foot-gap { flex: 1; }
.xr-vision__title { margin: 0; font-size: 15px; flex: 1; }
.xr-vision__hint { margin: 10px 16px 0; font-size: 12px; opacity: .75; }
.xr-vision__list { padding: 12px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.xr-vision__row { display: flex; gap: 10px; align-items: flex-start;
  border: 1px solid var(--xr-border, #333); border-radius: 8px; padding: 8px; }
.xr-vision__row--busy { opacity: .6; }
.xr-vision__pick { display: flex; align-items: flex-start; gap: 6px; flex: 0 0 auto; cursor: pointer; }
.xr-vision__thumb { width: 72px; height: 54px; object-fit: cover; border-radius: 4px;
  background: var(--xr-surface-2, #1c1c1c); }
.xr-vision__meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.xr-vision__name { font-size: 12px; opacity: .85; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.xr-vision__kind { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; opacity: .6; }
.xr-vision__part { display: flex; gap: 6px; font-size: 13px; align-items: flex-start; cursor: pointer; }
.xr-vision__part input { margin-top: 3px; flex: 0 0 auto; }
.xr-vision__err { font-size: 13px; color: var(--xr-danger, #f87171); }
.xr-vision__status { font-size: 12px; opacity: .8; }
.xr-vision__btn {
  background: transparent; color: inherit; border: 1px solid var(--xr-border, #444);
  border-radius: 6px; padding: 6px 12px; cursor: pointer; font: inherit;
}
.xr-vision__btn:hover { border-color: var(--xr-accent, #7aa2f7); }
.xr-vision__btn--primary { background: var(--xr-accent, #7aa2f7); color: #111; border-color: transparent; }
`;
    document.head.appendChild(style);
}

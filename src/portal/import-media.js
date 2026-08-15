// Transcribe-a-URL panel — the Transcribe Anywhere wave's second entry
// point. Paste any https media URL (a podcast episode, an off-platform
// video, a page with an embedded player), run the companion job, and
// land the diarized result as an ordinary archive record — which then
// joins cases and feeds corpus synthesis exactly like the Phase-21
// transcript import beside it.
//
// The import-transcript.js idiom: el() builders, self-managed
// lifecycle, no innerHTML. Shares ONE hash recipe with every other
// transcript producer (computeTranscriptArticleHash) so the portal, the
// reader, and publish can never fork. URL validation reuses
// isFetchableMediaUrl (reader/transcribe-flow.js) rather than a fresh
// https-check helper, so this panel, the reader's Transcribe button,
// and the flow itself can never disagree about what is transcribable.

import { el } from './dom.js';
import { Utils } from '../shared/utils.js';
import { saveArticle } from '../shared/archive-cache.js';
import { addArticlesToCase } from '../shared/case-membership.js';
import { buildTranscriptArticle, computeTranscriptArticleHash } from '../shared/transcript-article.js';
import { turnsFromSegments, providerDisplayName } from '../shared/diarized-transcript.js';
import { runTranscriptionJob, chromeIo, describeProgress, isFetchableMediaUrl, jobRecordKey } from '../reader/transcribe-flow.js';
import { mediaKeyForUrl } from '../shared/media-key.js';

// Engine display names — mirrors providerDisplayName's cloud names but
// also names 'local' (providerDisplayName returns null for it, since
// its OTHER callers are labeling a FINISHED job's transcript, where
// "local" is the unlabeled default). This panel needs to say so
// up front, before the job exists, because there is no engine picker
// here — the reader's openEnginePicker() has no portal equivalent.
function engineLabel(engine) {
    const via = providerDisplayName(engine);
    return via ? `via ${via}` : 'locally';
}

function labelField(labelText, input, hint) {
    const wrap = el('label', 'xr-import__field');
    wrap.appendChild(el('span', 'xr-import__label', labelText));
    wrap.appendChild(input);
    if (hint) wrap.appendChild(el('span', 'xr-import__hint', hint));
    return wrap;
}

function textInput(placeholder) {
    const i = el('input', 'xr-import__input');
    i.type = 'text';
    i.spellcheck = false;
    if (placeholder) i.placeholder = placeholder;
    return i;
}

/**
 * @param {HTMLElement} host
 * @param {object} opts
 * @param {string|null} [opts.caseEntityId]  when set, the record is also tagged into this case
 * @param {function}   [opts.onDone]         called after a successful transcription
 */
export function mountMediaTranscribe(host, { caseEntityId = null, onDone } = {}) {
    const panel = el('div', 'xr-import');
    host.appendChild(panel);

    panel.appendChild(el('h4', 'xr-case__heading', 'Transcribe a URL'));
    panel.appendChild(el('p', 'xr-import__hint',
        'Any https link to media — a podcast episode, an off-platform video, or a page with '
        + 'an embedded player. The companion service fetches the audio and returns a diarized '
        + 'transcript. Needs the companion running (Settings → Advanced → Transcription).'));

    const urlI = textInput('https://…');
    const titleI = textInput('Episode or video title (optional — the fetch usually knows it)');
    const showI = textInput('Show / channel (optional)');

    const fields = el('div', 'xr-import__fields');
    fields.appendChild(labelField('Media URL *', urlI));
    fields.appendChild(labelField('Title', titleI));
    fields.appendChild(labelField('Show / channel', showI));

    const runBtn = el('button', 'xr-portal__btn', 'Transcribe');
    runBtn.type = 'button';
    runBtn.disabled = true;
    const closeBtn = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Close');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', () => panel.remove());
    const actions = el('div', 'xr-import__actions');
    actions.appendChild(runBtn);
    actions.appendChild(closeBtn);
    const status = el('div', 'xr-import__status');

    panel.appendChild(fields);
    panel.appendChild(actions);
    panel.appendChild(status);

    const refresh = () => { runBtn.disabled = !isFetchableMediaUrl(urlI.value.trim()); };
    urlI.addEventListener('input', refresh);

    runBtn.addEventListener('click', async () => {
        const url = urlI.value.trim();
        if (!isFetchableMediaUrl(url)) return;
        runBtn.disabled = true;
        status.textContent = 'Contacting the transcription service…';
        try {
            // There is no engine picker here (that's a reader-only UI),
            // so an 'ask' or never-set preference can't be resolved by
            // asking the user — the honest move is to say plainly which
            // engine will run instead of silently sending no provider
            // and letting the companion's env default decide unnamed
            // (the same class of bug the reader's picker exists to
            // prevent). A concrete stored preference is both named AND
            // sent explicitly, so it can never be silently overridden by
            // a companion env default that disagrees.
            let provider;
            let engineNote;
            try {
                const cfg = await chrome.runtime.sendMessage({ type: 'xray:transcribe:config' });
                const pref = cfg && cfg.engine;
                if (pref && pref !== 'ask') {
                    provider = pref;
                    engineNote = `Transcribing ${engineLabel(pref)}…`;
                } else {
                    let namedDefault = null;
                    try {
                        const ping = await chrome.runtime.sendMessage({ type: 'xray:transcribe:ping' });
                        const def = ping && ping.ok && ping.health
                            && String(ping.health.provider || '').trim().toLowerCase();
                        if (def) namedDefault = engineLabel(def);
                    } catch (_) { /* health probe is best-effort naming only */ }
                    engineNote = pref === 'ask'
                        ? `No engine picker here — transcribing ${namedDefault || 'with the companion’s default engine (unconfirmed)'}…`
                        : `No engine chosen in Settings — transcribing ${namedDefault || 'with the companion’s default engine (unconfirmed)'}…`;
                }
            } catch (_) {
                engineNote = 'Transcribing with the companion’s default engine (unconfirmed — could not read Settings)…';
            }
            status.textContent = engineNote;

            const mediaKey = await mediaKeyForUrl(url);
            const io = chromeIo(chrome, (job) => {
                // `panel.isConnected` is false once the panel is gone —
                // Close, re-toggling the header button, or switching to a
                // sibling importer all remove it from the DOM by whatever
                // path they use, so this one check covers every removal
                // site without this module needing to know about them.
                if (panel.isConnected) status.textContent = describeProgress(job);
            });
            const out = await runTranscriptionJob({ mediaUrl: url, mediaKey, provider, io });
            if (!out.ok) {
                if (panel.isConnected) { status.textContent = out.error; refresh(); }
                return;
            }
            const result = out.result || {};
            const turns = turnsFromSegments(result.segments);
            if (!turns.length) {
                // Reap here too (mirrors the success-path reap below): the
                // job DID finish (out.ok true), so runTranscriptionJob
                // deliberately left the record for the caller to remove.
                // Without this, retrying the same URL inside the 7-day TTL
                // takes decideResume's `adopt` branch and instantly
                // re-serves this same empty result with no way to force a
                // fresh run (smoke-fix FIX 5).
                await io.storageRemove([jobRecordKey(mediaKey)]).catch(() => {});
                if (panel.isConnected) {
                    status.textContent = 'The transcription returned no usable segments.';
                    refresh();
                }
                return;
            }
            const speakers = [...new Set(turns.map((t) => t.speaker).filter(Boolean))];
            const via = providerDisplayName(result.model_info && result.model_info.provider);
            const article = buildTranscriptArticle({
                turns,
                speakers,
                format: 'diarized',
                meta: {
                    title: titleI.value.trim() || result.title || url,
                    url,
                    show: showI.value.trim() || result.channel || '',
                    // Neither 'podcast' nor a platform handler's domain:
                    // the user told us only that there is media here.
                    // The reader's 🎙 modal is where they DECLARE which.
                    platform: 'media',
                    sourceLabel: 'Media'
                }
            });
            // Local-only provenance, the reader's a.transcription shape.
            article.transcription = {
                segments: Array.isArray(result.segments) ? result.segments : [],
                model_info: result.model_info || null,
                language: result.language || null
            };
            // The ONE hash recipe — never forked (transcript-article.js).
            article._articleHash = await computeTranscriptArticleHash(article);
            // Saved UNCONDITIONALLY, even if the panel was dismissed
            // mid-job: the companion minutes are already spent, so the
            // finished transcript is kept rather than thrown away. It
            // lands in the portal's local-artifacts list like any other
            // unpublished capture. Only the surprise reader tab-open below
            // is skipped once nobody is watching the panel to have asked
            // for it.
            await saveArticle({ article, source: 'capture' });
            // Reap the finished job's record now that it's been adopted —
            // mirrors the reader (reader/index.js, after adoptDiarizedTranscript).
            // Without this, re-transcribing the same URL within the 7-day
            // TTL takes decideResume's `adopt` branch and instantly
            // returns THIS same cached transcript with no indication it
            // is stale/cached — silently wrong data for anything that
            // changed since (a corrected upload, a different engine).
            await io.storageRemove([jobRecordKey(mediaKey)]).catch(() => {});
            if (caseEntityId) await addArticlesToCase(caseEntityId, [article.url]);

            if (panel.isConnected) {
                const id = crypto.randomUUID();
                chrome.runtime.sendMessage({ type: 'xray:reader:open', id, article, readOnly: false }, (resp) => {
                    if (!resp || !resp.ok) Utils.error('Transcribe a URL: reader open failed', resp && resp.error);
                });
                status.textContent = `Transcribed ${via ? `via ${via}` : 'locally'} · ${turns.length} turns · `
                    + `${speakers.length} speaker(s)` + (caseEntityId ? ' · added to case' : '') + ' · opened in the reader.';
            }
            if (typeof onDone === 'function') onDone();
        } catch (err) {
            Utils.error('Transcribe a URL failed', err);
            if (panel.isConnected) { status.textContent = `Transcription failed: ${err.message || err}`; refresh(); }
        }
    });
}

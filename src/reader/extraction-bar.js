// Reader extraction bar — MA.2b (docs/MAP_ARTIFACT_KICKOFF.md).
//
// The per-article view of the DURABLE map artifacts: after a corpus
// map pass (Analyze / Pre-analyze / auto-pre-analyze) has run over this
// capture, this bar is how you can tell — from the article itself —
// that the analysis landed and what it holds. Counts, provenance, and
// the grounded assertion quotes, each click-to-locate in the body so
// the verbatim span can be checked against the text it came from.
//
// Deliberately READ-ONLY here: triage (Accept → mint a claim / Dismiss)
// lives in the portal case dashboard, which has the case context an
// accepted claim needs (`about: [caseId]`). This bar states where to
// go rather than duplicating a second, context-poorer accept path.
// Pure HTML string, like renderFindingsBar; index.js owns the wiring.

/**
 * @param {object|null} record  the `article-extractions` record for this
 *                              capture's hash, or null when none exists
 * @param {object} [opts]
 * @param {number} [opts.priorRuns]  extraction records anchored to a
 *   RETAINED PRIOR version of this URL's text (the audit panel's
 *   honesty convention: say so rather than render nothing)
 * @returns {string} HTML — '' when there is nothing to say
 */
export function renderExtractionBar(record, { priorRuns = 0 } = {}) {
    const assertions = (record && record.assertions) || [];
    const sources = (record && record.sources) || [];
    const questions = (record && record.open_questions) || [];

    if (!record || (assertions.length + sources.length + questions.length) === 0) {
        // No record for THIS text. Only speak up if a prior version has
        // one — otherwise stay silent (an unanalyzed article should not
        // carry an empty block).
        if (priorRuns > 0) {
            return `
              <section class="xr-extract">
                <div class="xr-extract__head">
                  <h3 class="xr-extract__title">Extracted assertions</h3>
                </div>
                <div class="xr-extract__note">⚠️ ${priorRuns} extraction record${priorRuns === 1 ? '' : 's'} anchor to a <em>previous version</em> of this text. Assertions are grounded in exact spans, so they never transfer across edits — re-run the corpus analysis to extract against the current capture.</div>
              </section>`;
        }
        return '';
    }

    const open = assertions.filter((a) => a.status !== 'accepted' && a.status !== 'dismissed');
    const accepted = assertions.filter((a) => a.status === 'accepted');
    const dismissed = assertions.filter((a) => a.status === 'dismissed');

    const counts = [`${assertions.length} assertion${assertions.length === 1 ? '' : 's'}`];
    if (open.length) counts.push(`${open.length} open`);
    if (accepted.length) counts.push(`${accepted.length} accepted as claims`);
    if (dismissed.length) counts.push(`${dismissed.length} dismissed`);
    if (record.dropped_ungrounded) {
        counts.push(`${record.dropped_ungrounded} ungroundable quote${record.dropped_ungrounded === 1 ? '' : 's'} dropped`);
    }

    // Provenance from the first assertion's first sighting (the fold
    // stamps every atom); fall back to the record's own timestamp.
    const fs = (assertions[0] && assertions[0].first_seen) || {};
    const provBits = [fs.model, fs.promptVersion].filter(Boolean);
    const stamp = fs.at || record.updatedAt;
    if (stamp) provBits.push(new Date(stamp * 1000).toISOString().slice(0, 10));

    const rows = (list, { settled = false } = {}) => list.map((a) => `
      <div class="xr-extract__row${settled ? ' xr-extract__row--settled' : ''}">
        <blockquote class="xr-extract__quote" data-action="locate" data-quote="${escapeHtml(a.quote || '')}" title="Click to locate this span in the article body">${escapeHtml(truncate(a.quote || '', 240))}</blockquote>
        ${a.why ? `<div class="xr-extract__why">${escapeHtml(truncate(a.why, 160))}</div>` : ''}
        ${a.status === 'accepted' ? '<div class="xr-extract__status">✓ accepted as a claim</div>' : ''}
        ${a.status === 'dismissed' ? '<div class="xr-extract__status">dismissed</div>' : ''}
      </div>`).join('');

    const openBlock = open.length ? `
      <div class="xr-extract__list">${rows(open)}</div>
      <div class="xr-extract__hint">Accept these as claims (or dismiss them) in the portal's case dashboard — "Extracted assertions" there mints a claim with the case attached.</div>` : '';

    const settled = accepted.concat(dismissed);
    const settledBlock = settled.length ? `
      <details class="xr-extract__more">
        <summary>Already triaged (${settled.length})</summary>
        <div class="xr-extract__list">${rows(settled, { settled: true })}</div>
      </details>` : '';

    const sourcesBlock = sources.length ? `
      <details class="xr-extract__more">
        <summary>Cited sources (${sources.length})</summary>
        <ul class="xr-extract__ul">${sources.map((s) => `<li title="${escapeHtml(s.quote || '')}">${escapeHtml(truncate(s.target_hint || s.quote || '', 160))}</li>`).join('')}</ul>
      </details>` : '';

    const questionsBlock = questions.length ? `
      <details class="xr-extract__more">
        <summary>Open questions this article leaves (${questions.length})</summary>
        <ul class="xr-extract__ul">${questions.map((q) => `<li>${escapeHtml(truncate(q.text || '', 200))}</li>`).join('')}</ul>
      </details>` : '';

    const priorNote = priorRuns > 0 ? `
      <div class="xr-extract__note">⚠️ ${priorRuns} further extraction record${priorRuns === 1 ? '' : 's'} anchor to a <em>previous version</em> of this text and are not shown here.</div>` : '';

    return `
      <section class="xr-extract">
        <div class="xr-extract__head">
          <h3 class="xr-extract__title">Extracted assertions</h3>
          <span class="xr-extract__durable" title="Saved per article in the audit database, export-included — a re-analysis adds to this record instead of replacing it">durable</span>
          <span class="xr-extract__gap"></span>
          <span class="xr-extract__counts">${escapeHtml(counts.join(' · '))}</span>
        </div>
        ${provBits.length ? `<div class="xr-extract__prov">${escapeHtml(provBits.join(' · '))}</div>` : ''}
        ${priorNote}
        ${openBlock}
        ${settledBlock}
        ${sourcesBlock}
        ${questionsBlock}
      </section>`;
}

function truncate(s, n) {
    const str = String(s || '').trim();
    return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

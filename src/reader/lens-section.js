// Reader lens-readings section — Phase 16.3
// (docs/MORAL_LENS_JURISDICTION_DESIGN.md §5.1, §5.3, §7).
//
// Renders the "Lens readings" bar body: the run setup (jurisdiction
// multi-select + typed claim multi-select + the §5.3 selection-basis
// disclosure), one card per jurisdiction result (readings + grounding
// report), and the panel composition/comparison disclosure. Pure HTML
// strings, like renderFindingsBar; index.js owns the wiring.
//
// Vocabulary discipline (§5.2): a reading is a READING with a
// disposition, rendered in the jurisdiction's voice — this surface
// never borrows Phase 15's wording. Every confidence chip carries the
// §5.1 fidelity note. Factual rows carry the deferred-to-truth-layer
// badge, a corpus-stance descriptor, and the 🏛 route into the
// adjudicate modal.

import {
    LENS_ASSERTION_TYPES, LENS_ASSERTION_TYPE_LABELS,
    DISPOSITION_LABELS, CORPUS_STANCE_LABELS,
    LENS_CONFIDENCE_FIDELITY_NOTE
} from '../shared/lens-taxonomy.js';

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function truncate(s, n) {
    const str = String(s || '');
    return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

// ------------------------------------------------------------------
// Run setup
// ------------------------------------------------------------------

/**
 * The pre-run form: pick jurisdictions, pick + type claims, declare
 * the selection basis (§5.3 — self-attested, disclosed in the panel).
 *
 * @param {object} params
 * @param {Array<object>} params.jurisdictions  registry records
 * @param {Array<{id, text, type}>} params.claims  claims on this
 *   article, each with its DEFAULT lens type (from the §3.1 mapping
 *   where a Phase 15 proposition exists, else 'evaluative')
 * @returns {string} HTML
 */
export function renderLensSetup({ jurisdictions = [], claims = [] } = {}) {
    if (jurisdictions.length === 0) {
        return `<div class="xr-lensread__empty">No jurisdictions in the registry yet. Author one in the console
          (see <code>docs/SMOKE_TEST.md</code> §Phase 16) — zero ship built-in, deliberately: which lenses exist
          is your judgment call, disclosed with every panel.</div>`;
    }
    if (claims.length === 0) {
        return `<div class="xr-lensread__empty">No claims captured on this article yet. Select a span and capture
          a claim first — a lens pass reads claims, not raw text.</div>`;
    }

    const jRows = jurisdictions.map((j) => `
        <label class="xr-lensread__pick">
          <input type="checkbox" data-role="lens-juri" value="${escapeHtml(j.id)}" />
          <span>${escapeHtml(j.display_name)} <span class="xr-lensread__dim">(${escapeHtml(j.jurisdiction_type)}${j.jurisdiction_type === 'persona' && j.is_living_person !== false ? ', living' : ''}, ${(j.corpus || []).length} authorities)</span></span>
        </label>`).join('');

    const typeOptions = (selected) => LENS_ASSERTION_TYPES.map((t) =>
        `<option value="${t}" ${t === selected ? 'selected' : ''}>${escapeHtml(LENS_ASSERTION_TYPE_LABELS[t])}</option>`).join('');

    const cRows = claims.map((c) => `
        <div class="xr-lensread__pick xr-lensread__pick--claim">
          <label class="xr-lensread__pick-main">
            <input type="checkbox" data-role="lens-claim" value="${escapeHtml(c.id)}" />
            <span>${escapeHtml(truncate(c.text, 140))}</span>
          </label>
          <select data-role="lens-claim-type" data-claim="${escapeHtml(c.id)}" title="How the lens layer types this assertion — factual assertions are deferred to the truth layer and only get a corpus stance">
            ${typeOptions(c.type)}
          </select>
        </div>`).join('');

    return `
      <div class="xr-lensread__setup">
        <div class="xr-lensread__setup-col">
          <h3 class="xr-lensread__h">Jurisdictions to empanel</h3>
          ${jRows}
        </div>
        <div class="xr-lensread__setup-col">
          <h3 class="xr-lensread__h">Claims to read</h3>
          ${cRows}
        </div>
        <label class="xr-lensread__basis">
          <span>Why these lenses? <span class="xr-lensread__dim">(disclosed with the panel — a one-sided panel is flagged, §5.3)</span></span>
          <input type="text" data-role="lens-basis" placeholder="e.g. the traditions the article itself invokes, plus one it criticizes" />
        </label>
        <div class="xr-lensread__setup-actions">
          <button type="button" class="xr-reader__btn xr-reader__btn--primary" data-role="lens-go">Run reading</button>
          <button type="button" class="xr-reader__btn xr-reader__btn--ghost" data-role="lens-cancel">Cancel</button>
        </div>
      </div>`;
}

// ------------------------------------------------------------------
// Per-jurisdiction result card
// ------------------------------------------------------------------

// Every confidence chip carries the §5.1 fidelity note — pinned by a
// 16.4 test so it cannot silently disappear from this surface.
function confidenceChip(confidence) {
    return `<span class="xr-lensread__chip xr-lensread__chip--${escapeHtml(confidence)}"
        title="${escapeHtml(LENS_CONFIDENCE_FIDELITY_NOTE)}">confidence: ${escapeHtml(confidence)} — fidelity, not truth</span>`;
}

function citationsHtml(cited, authoritiesById) {
    if (!cited || cited.length === 0) return '';
    const items = cited.map((c) => {
        const loaded = authoritiesById.get(c.authority_id);
        const label = loaded ? loaded.citation : c.authority_id;
        const locator = c.locator ? ` — ${escapeHtml(c.locator)}` : '';
        return `<li><span class="xr-lensread__grounding xr-lensread__grounding--${escapeHtml(c.grounding)}">${escapeHtml(c.grounding)}</span> ${escapeHtml(label)}${locator}</li>`;
    }).join('');
    return `<ul class="xr-lensread__citations">${items}</ul>`;
}

function readingRow(reading, claimTextById, authoritiesById) {
    const text = claimTextById.get(reading.claim_id) || reading.claim_id;

    if (reading.corpus_stance) {
        // Factual row: deferred to the truth layer — corpus stance only,
        // plus the 🏛 route into the adjudicate modal.
        return `
          <div class="xr-lensread__reading xr-lensread__reading--factual" data-claim="${escapeHtml(reading.claim_id)}">
            <div class="xr-lensread__claim">${escapeHtml(truncate(text, 160))}</div>
            <div class="xr-lensread__row">
              <span class="xr-lensread__badge xr-lensread__badge--deferred" title="Factual assertions are never read perspectivally — whether they are true is the truth layer's question (§3.2)">deferred to truth layer</span>
              <span class="xr-lensread__stance">${escapeHtml(CORPUS_STANCE_LABELS[reading.corpus_stance] || reading.corpus_stance)}</span>
              ${confidenceChip(reading.confidence)}
              <button type="button" class="xr-lensread__row-btn" data-action="lens-adjudicate" data-claim="${escapeHtml(reading.claim_id)}" title="Route into the truth layer's adjudication flow">🏛</button>
            </div>
            <p class="xr-lensread__reasoning">${escapeHtml(reading.reasoning)}</p>
            ${citationsHtml(reading.authorities_cited, authoritiesById)}
            <p class="xr-lensread__rationale">${escapeHtml(reading.confidence_rationale)}</p>
          </div>`;
    }

    return `
      <div class="xr-lensread__reading" data-claim="${escapeHtml(reading.claim_id)}">
        <div class="xr-lensread__claim">${escapeHtml(truncate(text, 160))}</div>
        <div class="xr-lensread__row">
          <span class="xr-lensread__badge xr-lensread__badge--${escapeHtml(reading.disposition)}">${escapeHtml(DISPOSITION_LABELS[reading.disposition] || reading.disposition)}</span>
          ${confidenceChip(reading.confidence)}
        </div>
        <p class="xr-lensread__reasoning">${escapeHtml(reading.reasoning)}</p>
        ${reading.content_vs_framing ? `<p class="xr-lensread__cvf"><strong>Content vs framing:</strong> ${escapeHtml(reading.content_vs_framing)}</p>` : ''}
        ${citationsHtml(reading.authorities_cited, authoritiesById)}
        <p class="xr-lensread__rationale">${escapeHtml(reading.confidence_rationale)}</p>
      </div>`;
}

function groundingReportHtml(grounding) {
    const g = grounding || {};
    const flags = []
        .concat((g.truncation_flags || []).map((f) => ({ kind: 'truncation', text: f })))
        .concat((g.thin_coverage_flags || []).map((f) => ({ kind: 'thin', text: f })))
        .concat((g.thin_representation_flags || []).map((f) => ({ kind: 'thin', text: f })));
    const flagRows = flags.map((f) =>
        `<li class="xr-lensread__flag xr-lensread__flag--${f.kind}">${escapeHtml(f.text)}</li>`).join('');
    const rejectedRows = (g.rejected_readings || []).map((r) =>
        `<li class="xr-lensread__flag xr-lensread__flag--rejected">${r.claim_id ? `<code>${escapeHtml(r.claim_id)}</code>: ` : ''}${escapeHtml(r.reason)}</li>`).join('');
    const sources = (g.recommended_sources || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('');

    return `
      <details class="xr-lensread__grounding-report">
        <summary>Grounding report — ${g.grounded_count || 0} grounded, ${g.inferred_count || 0} inference-only${(g.rejected_readings || []).length ? `, ${g.rejected_readings.length} rejected/absent` : ''}</summary>
        ${flagRows || rejectedRows ? `<ul class="xr-lensread__flags">${flagRows}${rejectedRows}</ul>` : ''}
        ${sources ? `<div class="xr-lensread__sources"><strong>To do better, load:</strong><ul>${sources}</ul></div>` : ''}
      </details>`;
}

/**
 * One jurisdiction's card: identity + the perspectival reconstruction +
 * per-claim readings + the grounding report.
 *
 * @param {object} reading  the assembled §7 per-jurisdiction object
 * @param {Array<{id, text}>} claims  the target claim set (for text lookup)
 * @returns {string} HTML
 */
export function renderJurisdictionCard(reading, claims = []) {
    const claimTextById = new Map(claims.map((c) => [c.id, c.text]));
    const authoritiesById = new Map((reading.authorities_loaded || []).map((a) => [a.authority_id, a]));

    const provenance = reading.corpus_provenance || {};
    const provenanceLine = [
        `curated by: ${provenance.curated_by || 'not stated'}`,
        `pool: ${provenance.candidate_pool || 'not stated'}`,
        `basis: ${provenance.selection_basis || 'not stated'}`
    ].join(' · ');

    const authorities = (reading.authorities_loaded || []).map((a) =>
        `<li>${escapeHtml(a.citation)} <span class="xr-lensread__dim">(coverage: ${escapeHtml(a.coverage)})</span></li>`).join('');

    return `
      <article class="xr-lensread__card" data-jurisdiction="${escapeHtml(reading.id)}">
        <header class="xr-lensread__card-head">
          <span class="xr-lensread__name">${escapeHtml(reading.display_name)}</span>
          <span class="xr-lensread__dim">${escapeHtml(reading.type)}${reading.is_living_person ? ' · living person — published positions only' : ''}</span>
        </header>
        ${reading.internal_divisions && reading.internal_divisions.length
            ? `<p class="xr-lensread__divisions">Strands: ${escapeHtml(reading.internal_divisions.join('; '))}</p>` : ''}
        ${reading.reconstruction_summary
            ? `<p class="xr-lensread__summary">${escapeHtml(reading.reconstruction_summary)}</p>` : ''}
        <div class="xr-lensread__readings">
          ${(reading.readings || []).map((r) => readingRow(r, claimTextById, authoritiesById)).join('')}
        </div>
        <details class="xr-lensread__corpus">
          <summary>Corpus loaded (${(reading.authorities_loaded || []).length}) — ${escapeHtml(provenanceLine)} <span class="xr-lensread__dim">(self-attested — §5.3)</span></summary>
          <ul>${authorities}</ul>
        </details>
        ${groundingReportHtml(reading.grounding)}
      </article>`;
}

/**
 * A failed jurisdiction renders as failed-with-reason while the rest
 * of the panel completes (§6).
 */
export function renderJurisdictionFailure({ displayName, error, refused = false }) {
    return `
      <article class="xr-lensread__card xr-lensread__card--failed">
        <header class="xr-lensread__card-head">
          <span class="xr-lensread__name">${escapeHtml(displayName)}</span>
          <span class="xr-lensread__badge xr-lensread__badge--failed">${refused ? 'refused pre-flight' : 'failed'}</span>
        </header>
        <p class="xr-lensread__error">${escapeHtml(error)}</p>
      </article>`;
}

// ------------------------------------------------------------------
// Panel disclosure
// ------------------------------------------------------------------

/**
 * The §5.3 panel composition + §7 panel comparison, rendered once the
 * run completes (or from the session cache).
 */
export function renderPanelSummary(panel) {
    const comp = (panel && panel.panel_composition) || {};
    const cmp = (panel && panel.panel_comparison) || {};

    const symmetry = (comp.symmetry_flags || []).map((f) =>
        `<li class="xr-lensread__flag xr-lensread__flag--symmetry">⚠ ${escapeHtml(f)}</li>`).join('');
    const agreements = (cmp.agreements || []).map((a) => `<li>${escapeHtml(a)}</li>`).join('');
    const divergences = (cmp.divergences || []).map((d) =>
        `<li><code>${escapeHtml(d.claim_id)}</code>: ${escapeHtml(d.split)}</li>`).join('');
    const provenance = panel && panel.provenance
        ? `model ${escapeHtml(panel.provenance.model)} · prompt v${escapeHtml(panel.provenance.prompt_version)} · run ${escapeHtml(panel.provenance.run_at)}`
        : '';

    return `
      <section class="xr-lensread__panel">
        <h3 class="xr-lensread__h">Panel composition <span class="xr-lensread__dim">(disclosed, self-attested — §5.3)</span></h3>
        <p>Empaneled: ${escapeHtml((comp.empaneled || []).join('; ') || '(none)')}<br>
           Basis: ${escapeHtml(comp.selection_basis || 'not stated')}</p>
        ${symmetry ? `<ul class="xr-lensread__flags">${symmetry}</ul>` : ''}
        ${agreements ? `<h3 class="xr-lensread__h">Agreements</h3><ul>${agreements}</ul>` : ''}
        ${divergences ? `<h3 class="xr-lensread__h">Divergences</h3><ul class="xr-lensread__divergences">${divergences}</ul>` : ''}
        ${provenance ? `<p class="xr-lensread__provenance">${provenance} · derived view — session-cached only, never saved or published</p>` : ''}
      </section>`;
}

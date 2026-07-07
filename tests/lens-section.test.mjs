// Phase 16.3/16.4 — the reader lens-section renderers
// (docs/MORAL_LENS_JURISDICTION_DESIGN.md §5.1, §5.3, §9 Q2). The bar
// itself is DOM (untested here, like assess-modal/forensic-modal —
// house rule: no jsdom); these pin the PURE HTML functions. The
// load-bearing surface properties: the §5.1 fidelity note rides EVERY
// confidence chip, factual rows carry the deferred-to-truth-layer
// badge + corpus-stance descriptor + the 🏛 route (never a
// disposition), and a failed jurisdiction renders failed-with-reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    renderLensSetup, renderJurisdictionCard, renderJurisdictionFailure, renderPanelSummary
} from '../src/reader/lens-section.js';
import { LENS_CONFIDENCE_FIDELITY_NOTE } from '../src/shared/lens-taxonomy.js';

const CLAIMS = [
    { id: 'c1', text: 'Men should step down from hierarchy.', type: 'normative' },
    { id: 'c2', text: 'The senator voted no on March 3.', type: 'factual' }
];

function assembled(over = {}) {
    return {
        id: 'christianity', type: 'worldview',
        display_name: 'Christianity (multi-tradition)', is_living_person: false,
        authorities_loaded: [{ authority_id: 'auth_x', citation: 'Bible (NRSV), Matthew 20:25-28', language: 'en', coverage: 'high' }],
        corpus_provenance: { curated_by: null, candidate_pool: null, selection_basis: null },
        internal_divisions: ['Catholic social teaching', 'Reformed'],
        readings: [{
            claim_id: 'c1', disposition: 'partially-endorses',
            reasoning: 'Servant leadership reads hierarchy as service.',
            authorities_cited: [{ authority_id: 'auth_x', locator: 'Matthew 20:26', grounding: 'direct-quote' }],
            content_vs_framing: 'substance endorsed; framing rejected',
            confidence: 'medium', confidence_rationale: 'one shared text'
        }, {
            claim_id: 'c2', corpus_stance: 'silent',
            reasoning: 'The corpus does not speak to this vote.',
            authorities_cited: [], confidence: 'high', confidence_rationale: 'clear absence'
        }],
        reconstruction_summary: 'A servant-leadership reading.',
        grounding: {
            grounded_count: 1, inferred_count: 0,
            thin_coverage_flags: ['only one verse loaded'],
            thin_representation_flags: [], recommended_sources: ['Rerum Novarum'],
            truncation_flags: [], rejected_readings: []
        },
        ...over
    };
}

test('lens-section: every confidence chip carries the §5.1 fidelity note', () => {
    const html = renderJurisdictionCard(assembled(), CLAIMS);
    const chips = html.match(/class="xr-lensread__chip /g) || [];
    assert.equal(chips.length >= 2, true, 'one chip per reading');
    const notes = html.match(/how unified the/g) || [];
    assert.equal(notes.length, chips.length, 'the note rides EVERY chip (title attr)');
    assert.ok(html.includes('fidelity, not truth'), 'the visible short form too');
    assert.ok(html.includes(LENS_CONFIDENCE_FIDELITY_NOTE.slice(0, 40)), 'the pinned string, verbatim');
});

test('lens-section: factual rows get the deferred badge + corpus stance + 🏛 route, never a disposition badge', () => {
    const html = renderJurisdictionCard(assembled(), CLAIMS);
    assert.match(html, /deferred to truth layer/);
    assert.match(html, /Corpus is silent on this/);
    assert.match(html, /data-action="lens-adjudicate" data-claim="c2"/);
    // The factual row must not render a disposition badge.
    const factualRow = html.slice(html.indexOf('xr-lensread__reading--factual'));
    assert.doesNotMatch(factualRow.slice(0, 800), /xr-lensread__badge--(endorses|rejects|partially-endorses|reframes|out-of-scope|silent)/);
});

test('lens-section: disposition badge, content-vs-framing split, and grounding report render', () => {
    const html = renderJurisdictionCard(assembled(), CLAIMS);
    assert.match(html, /xr-lensread__badge--partially-endorses/);
    assert.match(html, /Content vs framing:/);
    assert.match(html, /Grounding report — 1 grounded, 0 inference-only/);
    assert.match(html, /only one verse loaded/);
    assert.match(html, /To do better, load:/);
    assert.match(html, /self-attested — §5\.3/);
    assert.match(html, /Strands: Catholic social teaching; Reformed/);
});

test('lens-section: a living persona card discloses the guardrail', () => {
    const html = renderJurisdictionCard(assembled({ type: 'persona', is_living_person: true }), CLAIMS);
    assert.match(html, /living person — published positions only/);
});

test('lens-section: failures render failed-with-reason; the refusal kinds stay distinct', () => {
    const preflight = renderJurisdictionFailure({
        displayName: 'Empty Lens', error: 'not grounded', refused: true, code: 'not-grounded'
    });
    assert.match(preflight, /xr-lensread__card--failed/);
    assert.match(preflight, /refused pre-flight/);
    assert.match(preflight, /not grounded/);
    // A model-side guardrail declined AFTER a network call — its own
    // state (§6), never labeled as a pre-flight refusal.
    const modelSide = renderJurisdictionFailure({
        displayName: 'X', error: 'the model declined', refused: true, code: 'model-refusal'
    });
    assert.match(modelSide, /declined by the model/);
    assert.doesNotMatch(modelSide, /pre-flight/);
    const plain = renderJurisdictionFailure({ displayName: 'X', error: 'network sad' });
    assert.match(plain, />failed</);
});

test('lens-section: panel summary shows composition, symmetry flags, and the derived-only note', () => {
    const html = renderPanelSummary({
        provenance: { model: 'claude-opus-4-8', prompt_version: '1.0', run_at: '2026-07-07T00:00:00Z' },
        panel_composition: {
            empaneled: ['A (worldview)'],
            selection_basis: 'not stated (self-attested by the curator — §5.3)',
            symmetry_flags: ['no empaneled jurisdiction read the target sympathetically — §5.3']
        },
        panel_comparison: { agreements: ['all read "x" as rejects'], divergences: [{ claim_id: 'c1', split: 'A: rejects; B: endorses' }] }
    });
    assert.match(html, /Panel composition/);
    assert.match(html, /⚠ no empaneled jurisdiction read the target sympathetically/);
    assert.match(html, /Agreements/);
    assert.match(html, /Divergences/);
    assert.match(html, /derived view — session-cached only, never saved or published/);
});

test('lens-section: setup form renders pickers + the selection-basis input; empty states explain', () => {
    const html = renderLensSetup({
        jurisdictions: [{ id: 'j1', display_name: 'A Lens', jurisdiction_type: 'worldview', corpus: [{}] },
                        { id: 'j2', display_name: 'Live One', jurisdiction_type: 'persona', is_living_person: null, corpus: [] }],
        claims: [{ id: 'c1', text: 'claim text', type: 'evaluative' }]
    });
    assert.match(html, /data-role="lens-juri" value="j1"/);
    assert.match(html, /persona, living/, 'unknown living bit disclosed as living in the picker');
    assert.match(html, /data-role="lens-claim" value="c1"/);
    assert.match(html, /data-role="lens-claim-type" data-claim="c1"/);
    assert.match(html, /selected>Evaluative/);
    assert.match(html, /data-role="lens-basis"/);
    assert.match(html, /a one-sided panel is flagged/);

    assert.match(renderLensSetup({ jurisdictions: [], claims: [] }), /No jurisdictions in the registry/);
    assert.match(renderLensSetup({ jurisdictions: [{ id: 'j', display_name: 'J', jurisdiction_type: 'codified', corpus: [] }], claims: [] }),
        /No claims captured/);
});

test('lens-section: no reserved word in any rendered user-visible string (§5.2)', () => {
    const all = [
        renderJurisdictionCard(assembled(), CLAIMS),
        renderJurisdictionFailure({ displayName: 'X', error: 'e' }),
        renderPanelSummary({ panel_composition: { empaneled: [], selection_basis: '', symmetry_flags: [] }, panel_comparison: { agreements: [], divergences: [] } }),
        renderLensSetup({ jurisdictions: [], claims: [] })
    ].join('');
    // "truth layer" is a reference to Phase 15, allowed; the reserved
    // court-vocabulary words are not — all five of §5.2's list. Phase 15
    // owns "Integrity"; the per-jurisdiction honesty report is the
    // GROUNDING report here, and this pin keeps the rename binding.
    assert.doesNotMatch(all, /verdict|ruling|opinion|court|integrity/i);
});

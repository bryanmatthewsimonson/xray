// Phase 16.1 — lens taxonomy pins (docs/MORAL_LENS_JURISDICTION_DESIGN.md
// §3, §5.2). Exhaustive-enum pins are deliberate friction (the
// assessment-taxonomy house pattern): extending the vocabulary means
// editing this file in the same change. The cross-vocabulary
// disjointness pins assert STRING LITERALS, not imports — a pin that
// imports the enum it pins can drift with it (§8 base-branch note).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    JURISDICTION_TYPES, JURISDICTION_TYPE_LABELS, isValidJurisdictionType,
    LENS_ASSERTION_TYPES, LENS_ASSERTION_TYPE_LABELS, isValidLensAssertionType,
    carriesDisposition, lensTypeForPropositionClass,
    DISPOSITIONS, DISPOSITION_LABELS, isValidDisposition, UNCITED_DISPOSITIONS,
    CORPUS_STANCES, CORPUS_STANCE_LABELS, isValidCorpusStance,
    GROUNDING_LEVELS, GROUNDING_LEVEL_LABELS, isValidGroundingLevel,
    LENS_CONFIDENCES, isValidLensConfidence, COVERAGE_LEVELS,
    ADMISSIBILITIES, EDITORIALLY_PUBLISHED_ADMISSIBILITIES,
    isValidAdmissibility, isAdmissibleForLivingPersona
} from '../src/shared/lens-taxonomy.js';

// ------------------------------------------------------------------
// Exhaustive-enum pins
// ------------------------------------------------------------------

test('lens-taxonomy: jurisdiction types are exhaustive (§4)', () => {
    assert.deepEqual(JURISDICTION_TYPES.slice().sort(), ['codified', 'persona', 'worldview']);
    for (const t of JURISDICTION_TYPES) {
        assert.equal(isValidJurisdictionType(t), true, `${t} is valid`);
        assert.ok(JURISDICTION_TYPE_LABELS[t], `${t} has a display label`);
    }
    assert.equal(isValidJurisdictionType('religion'), false);
    assert.equal(isValidJurisdictionType(''), false);
});

test('lens-taxonomy: the four lens assertion types are exhaustive (§3.1)', () => {
    assert.deepEqual(LENS_ASSERTION_TYPES.slice().sort(),
        ['evaluative', 'factual', 'framing', 'normative']);
    for (const t of LENS_ASSERTION_TYPES) {
        assert.equal(isValidLensAssertionType(t), true, `${t} is valid`);
        assert.ok(LENS_ASSERTION_TYPE_LABELS[t], `${t} has a display label`);
    }
    assert.equal(isValidLensAssertionType('interpretation'), false,
        'proposition classes are NOT lens types — the vocabularies never merge');
});

test('lens-taxonomy: dispositions are exhaustive, house-grammared (§5.2)', () => {
    assert.deepEqual(DISPOSITIONS.slice().sort(), [
        'endorses', 'out-of-scope', 'partially-endorses',
        'reframes', 'rejects', 'silent'
    ]);
    for (const d of DISPOSITIONS) {
        assert.equal(isValidDisposition(d), true, `${d} is valid`);
        assert.ok(DISPOSITION_LABELS[d], `${d} has a display label`);
        // The house lowercase-hyphenated grammar — LABEL_RE rejects
        // underscores, so a future 30066 surface needs no rename.
        assert.match(d, /^[a-z0-9][a-z0-9-]*$/, `${d} is lowercase-hyphenated`);
    }
    assert.equal(isValidDisposition('partially_endorses'), false, 'underscore grammar rejected');
    assert.deepEqual([...UNCITED_DISPOSITIONS], ['silent', 'out-of-scope']);
});

test('lens-taxonomy: corpus stances / grounding levels / confidences pinned', () => {
    assert.deepEqual([...CORPUS_STANCES], ['asserts', 'denies', 'silent']);
    for (const s of CORPUS_STANCES) assert.ok(CORPUS_STANCE_LABELS[s], `${s} labeled`);
    assert.deepEqual([...GROUNDING_LEVELS], ['direct-quote', 'paraphrase', 'inference']);
    for (const g of GROUNDING_LEVELS) assert.ok(GROUNDING_LEVEL_LABELS[g], `${g} labeled`);
    assert.deepEqual([...LENS_CONFIDENCES], ['high', 'medium', 'low']);
    assert.equal(COVERAGE_LEVELS, LENS_CONFIDENCES, 'coverage reuses the same frozen instance');
    assert.equal(isValidCorpusStance('affirms'), false);
    assert.equal(isValidGroundingLevel('quote'), false);
    assert.equal(isValidLensConfidence(0.7), false, 'no numeric confidence — this is not a score');
});

test('lens-taxonomy: admissibilities pinned; living-persona subset excludes social captures (§9 Q1)', () => {
    assert.deepEqual(ADMISSIBILITIES.slice().sort(), [
        'published-article', 'published-book', 'published-doctrine',
        'published-essay', 'published-regulation', 'published-scripture',
        'published-statute', 'published-transcript', 'social-capture'
    ]);
    assert.deepEqual(EDITORIALLY_PUBLISHED_ADMISSIBILITIES.slice().sort(),
        ADMISSIBILITIES.filter((a) => a !== 'social-capture').slice().sort());
    assert.equal(isValidAdmissibility('tweet'), false);
    assert.equal(isAdmissibleForLivingPersona('published-book'), true);
    assert.equal(isAdmissibleForLivingPersona('published-essay'), true);
    assert.equal(isAdmissibleForLivingPersona('social-capture'), false,
        'social captures are inadmissible for living personas');
    assert.equal(isAdmissibleForLivingPersona('unknown-thing'), false, 'unknown fails closed');
});

// ------------------------------------------------------------------
// The §3.2 firewall predicates
// ------------------------------------------------------------------

test('lens-taxonomy: carriesDisposition — factual never, unknown fails closed', () => {
    assert.equal(carriesDisposition('factual'), false, 'factual is deferred to the truth layer');
    assert.equal(carriesDisposition('normative'), true);
    assert.equal(carriesDisposition('evaluative'), true);
    assert.equal(carriesDisposition('framing'), true);
    assert.equal(carriesDisposition('bogus'), false, 'unknown type carries neither — fails closed');
    assert.equal(carriesDisposition(undefined), false);
});

test('lens-taxonomy: the §3.1 mapping from proposition classes (literals, one-way)', () => {
    assert.equal(lensTypeForPropositionClass('event-fact'), 'factual');
    assert.equal(lensTypeForPropositionClass('state-fact'), 'factual');
    assert.equal(lensTypeForPropositionClass('prediction'), 'factual');
    assert.equal(lensTypeForPropositionClass('stated-commitment'), 'factual');
    assert.equal(lensTypeForPropositionClass('interpretation'), 'evaluative',
        'the class Phase 15 §3.1 hands over');
    assert.equal(lensTypeForPropositionClass('stated-value'), 'evaluative',
        'co-owned deliberately — this layer reads it perspectivally');
    assert.equal(lensTypeForPropositionClass('normative'), null,
        'normative is not a proposition class — PROPOSITION_CLASSES is never extended');
    assert.equal(lensTypeForPropositionClass('framing'), null);
    assert.equal(lensTypeForPropositionClass('junk'), null);
});

// ------------------------------------------------------------------
// Cross-vocabulary disjointness — by STRING LITERAL, not import
// ------------------------------------------------------------------

test('lens-taxonomy: DISPOSITIONS share no token with Phase 15 verdict states (literals)', () => {
    const phase15VerdictStates = [
        'established-true', 'established-false', 'contested',
        'unresolved', 'insufficient-evidence'
    ];
    for (const d of DISPOSITIONS) {
        assert.equal(phase15VerdictStates.includes(d), false, `"${d}" is not a Phase 15 state`);
    }
});

test('lens-taxonomy: DISPOSITIONS and CORPUS_STANCES share no token with Phase 15 match states (literals)', () => {
    const phase15MatchStates = [
        'fulfilled', 'broken', 'consistent', 'contradicted',
        'unrelated', 'contested', 'insufficient'
    ];
    for (const d of DISPOSITIONS) {
        assert.equal(phase15MatchStates.includes(d), false, `"${d}" is not a match state`);
    }
    for (const s of CORPUS_STANCES) {
        assert.equal(phase15MatchStates.includes(s), false, `"${s}" is not a match state`);
    }
});

test('lens-taxonomy: LENS_ASSERTION_TYPES share no token with PROPOSITION_CLASSES (literals)', () => {
    const propositionClasses = [
        'event-fact', 'state-fact', 'prediction',
        'stated-commitment', 'stated-value', 'interpretation'
    ];
    for (const t of LENS_ASSERTION_TYPES) {
        assert.equal(propositionClasses.includes(t), false,
            `"${t}" is not a proposition class — the enums never merge (§3.1)`);
    }
    // The two SANCTIONED literal overlaps, documented: legacy CLAIM_TYPES
    // ('factual', 'causal', 'evaluative', 'predictive' — an older,
    // unrelated vocabulary) shares 'factual' and 'evaluative' by token.
    // Harmless by design: lens typing is computed per run, never stored
    // on claim records, and code never compares tokens across the enums.
    const legacyClaimTypes = ['factual', 'causal', 'evaluative', 'predictive'];
    assert.deepEqual(
        LENS_ASSERTION_TYPES.filter((t) => legacyClaimTypes.includes(t)).sort(),
        ['evaluative', 'factual'],
        'exactly the two known overlaps — a third means someone merged vocabularies');
});

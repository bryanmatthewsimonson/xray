// Assessment taxonomy tests — Phase 11.1 (docs/ASSESSMENTS_DESIGN.md).
//
// The taxonomy is the single source of truth for label vocabulary,
// stance scale, and relationship directionality — these exhaustive
// enum pins are deliberate friction: extending the vocabulary means
// editing this file in the same change (the EVIDENCE_RELATIONSHIPS /
// ENTITY_TYPES house pattern).

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
    ASSESSMENT_LABEL_NAMESPACE, ASSESSMENT_LABEL_GROUPS, ASSESSMENT_LABELS,
    isStandardLabel, isValidLabel,
    STANCE_VALUES, STANCE_LABELS, isValidStance,
    CLAIM_RELATIONSHIPS, SYMMETRIC_RELATIONSHIPS, isSymmetricRelationship,
    isValidSuggestedBy
} = await import('../src/shared/assessment-taxonomy.js');

test('taxonomy: namespace is pinned', () => {
    assert.equal(ASSESSMENT_LABEL_NAMESPACE, 'xray/assessment');
});

test('taxonomy: label groups are exhaustive', () => {
    assert.deepEqual(Object.keys(ASSESSMENT_LABEL_GROUPS).sort(),
        ['consistency', 'factual', 'fallacy', 'provenance', 'rhetorical']);
    assert.deepEqual(ASSESSMENT_LABEL_GROUPS.factual.slice().sort(),
        ['cherry-picked', 'false', 'misleading', 'missing-context', 'outdated', 'unsupported']);
    assert.deepEqual(ASSESSMENT_LABEL_GROUPS.consistency.slice().sort(),
        ['contradicts-prior-statement', 'flip-flop', 'moved-goalposts']);
    assert.deepEqual(ASSESSMENT_LABEL_GROUPS.fallacy.slice().sort(),
        ['fallacy/ad-hominem', 'fallacy/appeal-to-authority', 'fallacy/appeal-to-consequences',
         'fallacy/circular', 'fallacy/false-dilemma', 'fallacy/slippery-slope',
         'fallacy/strawman', 'fallacy/whataboutism']);
    assert.deepEqual(ASSESSMENT_LABEL_GROUPS.rhetorical.slice().sort(),
        ['ambiguous', 'euphemism', 'loaded-language', 'unfalsifiable']);
    assert.deepEqual(ASSESSMENT_LABEL_GROUPS.provenance.slice().sort(),
        ['undisclosed-interest']);
});

test('taxonomy: flat list is the union of the groups, no duplicates', () => {
    const union = Object.values(ASSESSMENT_LABEL_GROUPS).flat();
    assert.deepEqual(ASSESSMENT_LABELS.slice().sort(), union.slice().sort());
    assert.equal(new Set(ASSESSMENT_LABELS).size, ASSESSMENT_LABELS.length);
    for (const label of ASSESSMENT_LABELS) {
        assert.equal(isStandardLabel(label), true, `${label} is standard`);
        assert.equal(isValidLabel(label), true, `${label} passes its own validation`);
    }
});

test('taxonomy: custom labels ride the same rails (the escape hatch)', () => {
    assert.equal(isStandardLabel('pinky-promise'), false);
    assert.equal(isValidLabel('pinky-promise'), true);
    assert.equal(isValidLabel('fallacy/tu-quoque'), true, 'custom value in a known family');

    assert.equal(isValidLabel(''), false);
    assert.equal(isValidLabel('Has Space'), false);
    assert.equal(isValidLabel('UPPER'), false);
    assert.equal(isValidLabel('-leading-dash'), false);
    assert.equal(isValidLabel('a/b/c'), false, 'one namespace segment max');
    assert.equal(isValidLabel('x'.repeat(65)), false, 'length cap');
    assert.equal(isValidLabel(42), false);
});

test('taxonomy: stance scale is discrete -2..+2 with full display coverage', () => {
    assert.deepEqual(STANCE_VALUES.slice(), [-2, -1, 0, 1, 2]);
    for (const v of STANCE_VALUES) {
        assert.equal(isValidStance(v), true);
        assert.ok(STANCE_LABELS[String(v)], `STANCE_LABELS must cover ${v}`);
    }
    assert.equal(STANCE_LABELS['-2'], 'Strongly disagree');
    assert.equal(STANCE_LABELS['2'],  'Strongly agree');
    for (const bad of [3, -3, 1.5, '1', null, undefined, NaN]) {
        assert.equal(isValidStance(bad), false, `rejects ${String(bad)}`);
    }
});

test('taxonomy: relationship vocabulary + directionality', () => {
    assert.deepEqual(CLAIM_RELATIONSHIPS.slice().sort(),
        ['contradicts', 'duplicates', 'supports', 'updates']);
    assert.deepEqual(SYMMETRIC_RELATIONSHIPS.slice().sort(),
        ['contradicts', 'duplicates']);
    assert.equal(isSymmetricRelationship('contradicts'), true);
    assert.equal(isSymmetricRelationship('duplicates'), true);
    assert.equal(isSymmetricRelationship('supports'), false);
    assert.equal(isSymmetricRelationship('updates'), false);
    assert.equal(isSymmetricRelationship('contextualizes'), false, 'legacy value is not symmetric');
});

test('taxonomy: suggested_by provenance values', () => {
    assert.equal(isValidSuggestedBy('user'), true);
    assert.equal(isValidSuggestedBy('llm:claude-fable-5'), true);
    assert.equal(isValidSuggestedBy('llm:'), false, 'model name required');
    assert.equal(isValidSuggestedBy('llm: '), false, 'whitespace-only model name rejected');
    assert.equal(isValidSuggestedBy('llm:\t'), false);
    assert.equal(isValidSuggestedBy('bot'), false);
    assert.equal(isValidSuggestedBy(''), false);
    assert.equal(isValidSuggestedBy(null), false);
});

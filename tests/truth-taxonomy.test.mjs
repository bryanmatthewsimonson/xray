// Truth-adjudication taxonomy tests — Phase 15.1
// (docs/TRUTH_ADJUDICATION_DESIGN.md §3.1). Exhaustive-enum pins are
// deliberate friction (the assessment-taxonomy house pattern):
// extending the vocabulary means editing this file in the same change.
// The firewall predicates are the load-bearing tests — soften them and
// the tool becomes an orthodoxy enforcer.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
    PROPOSITION_CLASSES, PROPOSITION_CLASS_LABELS, isValidPropositionClass,
    SUBJECT_ROLES, SUBJECT_ROLE_LABELS, SUBJECT_ROLE_UNCLASSIFIED, isValidSubjectRole,
    OCCURRED_PRECISIONS, isValidOccurredPrecision,
    TRUTH_ADJUDICABLE_CLASSES, isTruthAdjudicable,
    integrityRole, isIntegrityEligible,
    HEDGE_LEVELS, TRACTABILITIES, isValidSuggestedBy,
    SOURCE_TYPES, SOURCE_TYPE_LABELS, isValidSourceType, isPrimarySourceType, suggestSourceType,
    EVIDENCE_ROLES, EVIDENCE_ROLE_LABELS, isValidEvidenceRole
} = await import('../src/shared/truth-taxonomy.js');

test('truth-taxonomy: proposition classes are exhaustive (§3.1)', () => {
    assert.deepEqual(PROPOSITION_CLASSES.slice().sort(), [
        'event-fact', 'interpretation', 'prediction',
        'state-fact', 'stated-commitment', 'stated-value'
    ]);
    for (const cls of PROPOSITION_CLASSES) {
        assert.equal(isValidPropositionClass(cls), true, `${cls} is valid`);
        assert.ok(PROPOSITION_CLASS_LABELS[cls], `${cls} has a display label`);
    }
    assert.equal(isValidPropositionClass('opinion'), false);
    assert.equal(isValidPropositionClass(''), false);
    assert.equal(isValidPropositionClass(null), false);
});

test('truth-taxonomy: subject roles are exhaustive, with unclassified as the absence value', () => {
    assert.deepEqual(SUBJECT_ROLES.slice().sort(),
        ['ascribed', 'enacted', 'stated', 'unclassified']);
    assert.equal(SUBJECT_ROLE_UNCLASSIFIED, 'unclassified');
    for (const role of SUBJECT_ROLES) {
        assert.equal(isValidSubjectRole(role), true, `${role} is valid`);
        assert.ok(SUBJECT_ROLE_LABELS[role], `${role} has a display label`);
    }
    assert.equal(isValidSubjectRole('accused'), false);
    assert.equal(isValidSubjectRole(''), false);
});

test('truth-taxonomy: occurred precisions are exhaustive (no false precision)', () => {
    assert.deepEqual(OCCURRED_PRECISIONS.slice().sort(), ['day', 'exact', 'month', 'year']);
    for (const p of OCCURRED_PRECISIONS) assert.equal(isValidOccurredPrecision(p), true);
    assert.equal(isValidOccurredPrecision('decade'), false);
    assert.equal(isValidOccurredPrecision(''), false);
});

test('truth-taxonomy: the firewall — interpretation and stated-value are never truth-adjudicable', () => {
    assert.deepEqual(TRUTH_ADJUDICABLE_CLASSES.slice().sort(),
        ['event-fact', 'prediction', 'state-fact', 'stated-commitment']);

    assert.equal(isTruthAdjudicable('event-fact'), true);
    assert.equal(isTruthAdjudicable('state-fact'), true);
    assert.equal(isTruthAdjudicable('prediction'), true);
    assert.equal(isTruthAdjudicable('stated-commitment'), true);
    assert.equal(isTruthAdjudicable('interpretation'), false, 'a reading is not true/false');
    assert.equal(isTruthAdjudicable('stated-value'), false, 'a value is never policed as true/false');

    // Record form works too, and the firewall fails CLOSED on junk.
    assert.equal(isTruthAdjudicable({ proposition_class: 'event-fact' }), true);
    assert.equal(isTruthAdjudicable({ proposition_class: 'interpretation' }), false);
    assert.equal(isTruthAdjudicable({}), false);
    assert.equal(isTruthAdjudicable(null), false);
    assert.equal(isTruthAdjudicable('not-a-class'), false);
});

test('truth-taxonomy: integrity eligibility — stated words vs enacted deeds only', () => {
    // The word side: a stated commitment or value.
    assert.equal(integrityRole({ proposition_class: 'stated-commitment', subject_role: 'stated' }), 'word');
    assert.equal(integrityRole({ proposition_class: 'stated-value', subject_role: 'stated' }), 'word');
    // The deed side: an enacted action-fact.
    assert.equal(integrityRole({ proposition_class: 'event-fact', subject_role: 'enacted' }), 'deed');
    assert.equal(integrityRole({ proposition_class: 'state-fact', subject_role: 'enacted' }), 'deed');

    // ascribed and unclassified are excluded BY CONSTRUCTION (§3.1).
    for (const cls of PROPOSITION_CLASSES) {
        assert.equal(integrityRole({ proposition_class: cls, subject_role: 'ascribed' }), null,
            `ascribed ${cls} is not theirs to be held to`);
        assert.equal(integrityRole({ proposition_class: cls, subject_role: 'unclassified' }), null,
            `unclassified ${cls} asserts no reading`);
        assert.equal(isIntegrityEligible({ proposition_class: cls, subject_role: 'ascribed' }), false);
        assert.equal(isIntegrityEligible({ proposition_class: cls, subject_role: 'unclassified' }), false);
    }

    // Mismatched pairings have no side to sit on.
    assert.equal(integrityRole({ proposition_class: 'event-fact', subject_role: 'stated' }), null);
    assert.equal(integrityRole({ proposition_class: 'stated-commitment', subject_role: 'enacted' }), null);
    assert.equal(integrityRole({ proposition_class: 'interpretation', subject_role: 'stated' }), null);
    assert.equal(integrityRole({ proposition_class: 'prediction', subject_role: 'enacted' }), null);
    assert.equal(integrityRole({}), null);
    assert.equal(integrityRole(null), null);

    assert.equal(isIntegrityEligible({ proposition_class: 'stated-value', subject_role: 'stated' }), true);
    assert.equal(isIntegrityEligible({ proposition_class: 'event-fact', subject_role: 'enacted' }), true);
});

test('truth-taxonomy: prediction vocabulary is re-exported, not forked', async () => {
    const builders = await import('../src/shared/audit/builders.js');
    assert.equal(HEDGE_LEVELS, builders.HEDGE_LEVELS, 'same frozen array instance');
    assert.equal(TRACTABILITIES, builders.TRACTABILITIES, 'same frozen array instance');
    const assessment = await import('../src/shared/assessment-taxonomy.js');
    assert.equal(isValidSuggestedBy, assessment.isValidSuggestedBy, 'same provenance validator');
});

// ---- Phase 23.1: source type (provenance vocabulary) ---------------

test('source-type: enum is exhaustive with labels, primary rungs flagged', () => {
    assert.deepEqual([...SOURCE_TYPES],
        ['primary-record', 'primary-research', 'reporting', 'analysis', 'reference']);
    for (const v of SOURCE_TYPES) assert.ok(SOURCE_TYPE_LABELS[v], `label for ${v}`);
    assert.ok(isValidSourceType('primary-research'));
    assert.ok(!isValidSourceType('made-up'));
    // Only the two primary rungs get the badge.
    assert.ok(isPrimarySourceType('primary-record'));
    assert.ok(isPrimarySourceType('primary-research'));
    for (const v of ['reporting', 'analysis', 'reference', '', null]) {
        assert.ok(!isPrimarySourceType(v), `${v} is not primary`);
    }
});

test('suggestSourceType: scholarly ids ⇒ primary-research; schema.org types map; else null', () => {
    assert.equal(suggestSourceType({ scholar: { doi: '10.1038/x' } }), 'primary-research');
    assert.equal(suggestSourceType({ scholar: { journal: 'Nature' } }), 'primary-research');
    assert.equal(suggestSourceType({ scholar: { arxiv_id: '2001.00001' } }), 'primary-research');
    assert.equal(suggestSourceType({ structuredData: { type: 'OpinionPiece' } }), 'analysis');
    assert.equal(suggestSourceType({ structuredData: { type: 'AnalysisNewsArticle' } }), 'analysis');
    assert.equal(suggestSourceType({ structuredData: { type: 'NewsArticle' } }), 'reporting');
    assert.equal(suggestSourceType({ structuredData: { type: 'ScholarlyArticle' } }), 'primary-research');
    // scholarly identity wins over a generic schema type.
    assert.equal(suggestSourceType({ scholar: { doi: '10.x/y' }, structuredData: { type: 'NewsArticle' } }), 'primary-research');
    assert.equal(suggestSourceType({ structuredData: { type: 'BlogPosting' } }), null);
    assert.equal(suggestSourceType({}), null);
    assert.equal(suggestSourceType(null), null);
});

// ---- Phase 23.1b: evidence role (citation intent) ------------------

test('evidence-role: enum is exhaustive with labels (CiTO subset)', () => {
    assert.deepEqual([...EVIDENCE_ROLES],
        ['evidence', 'mention', 'supports', 'disputes', 'reviews']);
    for (const v of EVIDENCE_ROLES) assert.ok(EVIDENCE_ROLE_LABELS[v], `label for ${v}`);
    assert.ok(isValidEvidenceRole('evidence'));
    assert.ok(isValidEvidenceRole('disputes'));
    assert.ok(!isValidEvidenceRole('cites'));
    assert.ok(!isValidEvidenceRole(''));
    assert.ok(!isValidEvidenceRole(null));
});

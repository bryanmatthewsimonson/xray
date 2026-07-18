// Forensic taxonomy tests — Phase 14.1 (docs/CRIMINOLOGY_DESIGN.md).
//
// Exhaustive-enum pins (the EVIDENCE_RELATIONSHIPS / ASSESSMENT_LABELS
// house pattern): extending the maneuver vocabulary, the role enum, or
// the basis enum means editing this file in the same change. The
// MANEUVER_GUIDE pin enforces the falsifiability discipline — every
// standard maneuver must ship a counter-indicator.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
    FORENSIC_MANEUVER_NAMESPACE, FORENSIC_MANEUVER_GROUPS, FORENSIC_MANEUVERS,
    isStandardManeuver, isValidManeuver,
    ROLES, isValidRole, BASIS_VALUES, isValidBasis,
    MANEUVER_GUIDE, REVISION_RELATIONSHIPS, isValidSuggestedBy
} = await import('../src/shared/forensic-taxonomy.js');
const { isSymmetricRelationship, isRevisionRelationship } =
    await import('../src/shared/assessment-taxonomy.js');

test('forensic: namespace is pinned', () => {
    assert.equal(FORENSIC_MANEUVER_NAMESPACE, 'xray/forensic');
});

test('forensic: maneuver families are exhaustive', () => {
    assert.deepEqual(Object.keys(FORENSIC_MANEUVER_GROUPS).sort(),
        ['darvo', 'defense', 'grooming', 'neutralization', 'source-credibility', 'thought-reform']);
    assert.deepEqual(FORENSIC_MANEUVER_GROUPS.darvo.slice().sort(),
        ['darvo/attack', 'darvo/deny', 'darvo/reverse-victim-offender']);
    assert.deepEqual(FORENSIC_MANEUVER_GROUPS.grooming.slice().sort(),
        ['grooming/apply-pressure', 'grooming/build-vulnerability',
         'grooming/establish-trust', 'grooming/redefine-boundaries']);
    assert.equal(FORENSIC_MANEUVER_GROUPS.neutralization.length, 9);
    assert.equal(FORENSIC_MANEUVER_GROUPS['thought-reform'].length, 7);
    assert.equal(FORENSIC_MANEUVER_GROUPS.defense.length, 8);
    // 27 F.5 — the side-neutral persuasion-over-evidence family.
    assert.deepEqual(FORENSIC_MANEUVER_GROUPS['source-credibility'].slice().sort(), [
        'source-credibility/borrowed-authority',
        'source-credibility/guilt-by-association',
        'source-credibility/motive-speculation',
        'source-credibility/track-record-substitution'
    ]);
});

test('forensic: every source-credibility guide entry carries the reporter counter-indicator (27 F.5)', async () => {
    const { MANEUVER_GUIDE } = await import('../src/shared/forensic-taxonomy.js');
    for (const m of FORENSIC_MANEUVER_GROUPS['source-credibility']) {
        const g = MANEUVER_GUIDE[m];
        assert.ok(g && g.definition, `${m} has a guide entry`);
        assert.ok(g.counterIndicators.some((c) => /REPORTING someone else/.test(c)),
            `${m} counter-indicates the reporter — the F.2 attribution rule, restated per maneuver`);
    }
});

test('forensic: flat list is the union of the groups, no duplicates', () => {
    const union = Object.values(FORENSIC_MANEUVER_GROUPS).flat();
    assert.deepEqual(FORENSIC_MANEUVERS.slice().sort(), union.slice().sort());
    assert.equal(new Set(FORENSIC_MANEUVERS).size, FORENSIC_MANEUVERS.length);
    for (const m of FORENSIC_MANEUVERS) {
        assert.equal(isStandardManeuver(m), true, `${m} is standard`);
        assert.equal(isValidManeuver(m), true, `${m} passes its own validation`);
    }
});

test('forensic: custom maneuvers ride the same rails (the escape hatch)', () => {
    assert.equal(isStandardManeuver('defense/gish-gallop'), false);
    assert.equal(isValidManeuver('defense/gish-gallop'), true, 'custom value in a known family');
    assert.equal(isValidManeuver('sealioning'), true);
    assert.equal(isValidManeuver(''), false);
    assert.equal(isValidManeuver('Has Space'), false);
    assert.equal(isValidManeuver('UPPER'), false);
    assert.equal(isValidManeuver('a/b/c'), false, 'one namespace segment max');
    assert.equal(isValidManeuver('x'.repeat(65)), false, 'length cap');
    assert.equal(isValidManeuver(42), false);
});

test('forensic: role enum is exhaustive + symmetric across sides', () => {
    assert.deepEqual(ROLES.slice().sort(),
        ['apologist', 'commentator', 'critic', 'institution', 'journalist',
         'official', 'other', 'survivor', 'witness']);
    for (const r of ROLES) assert.equal(isValidRole(r), true);
    // The bias-symmetry point: a critic is as profilable as an apologist.
    assert.equal(isValidRole('apologist'), true);
    assert.equal(isValidRole('critic'), true);
    assert.equal(isValidRole('journalist'), true, '27 F.6 — journalism-fit roles');
    assert.equal(isValidRole('prosecutor'), false);
});

test('forensic: basis enum is exhaustive (no numeric score)', () => {
    assert.deepEqual(BASIS_VALUES.slice(),
        ['quoted', 'paraphrased', 'behavioral-cue', 'structural-inference']);
    for (const b of BASIS_VALUES) assert.equal(isValidBasis(b), true);
    assert.equal(isValidBasis('vibes'), false);
    assert.equal(isValidBasis(0.95), false, 'a number is not a basis — there is no score');
});

test('forensic: revision relationships are directional (re-exported)', () => {
    assert.deepEqual(REVISION_RELATIONSHIPS.slice().sort(),
        ['narrative-patch', 'recharacterizes', 'walks-back']);
    for (const r of REVISION_RELATIONSHIPS) {
        assert.equal(isRevisionRelationship(r), true);
        assert.equal(isSymmetricRelationship(r), false, `${r} is directional (earlier → later)`);
    }
});

test('forensic: every standard maneuver has a guide entry with a counter-indicator', () => {
    for (const m of FORENSIC_MANEUVERS) {
        const g = MANEUVER_GUIDE[m];
        assert.ok(g, `MANEUVER_GUIDE must cover ${m}`);
        assert.ok(g.source && typeof g.source === 'string', `${m} cites a source`);
        assert.ok(g.definition && g.definition.length > 0, `${m} has a definition`);
        assert.ok(Array.isArray(g.indicators) && g.indicators.length > 0, `${m} has indicators`);
        assert.ok(Array.isArray(g.counterIndicators) && g.counterIndicators.length > 0,
            `${m} has at least one counter-indicator (the falsifiability discipline)`);
    }
    // No orphan guide entries for non-existent maneuvers.
    for (const key of Object.keys(MANEUVER_GUIDE)) {
        assert.equal(isStandardManeuver(key), true, `guide key ${key} is a real maneuver`);
    }
});

test('forensic: suggested_by provenance is re-exported', () => {
    assert.equal(isValidSuggestedBy('user'), true);
    assert.equal(isValidSuggestedBy('llm:claude-fable-5'), true);
    assert.equal(isValidSuggestedBy('bot'), false);
});

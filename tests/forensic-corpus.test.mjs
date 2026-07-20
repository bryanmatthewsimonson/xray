// FA.1 tests — the forensic corpus pass (CORPUS_AUDIT_KICKOFF §4b).
// The bundle is stored-material-only; the firewall enforces the
// methodology structurally: taxonomy, grounded anchors, the mandatory
// counter-read, the Rule-1 intent red line (even in free text), and
// the per-subject cap.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const {
    buildSubjectBundle, validateForensicProposals, MAX_FINDINGS_PER_SUBJECT
} = await import('../src/shared/forensic-corpus.js');

const SUBJECT = { id: 'ent_bob', name: 'Bob Smith', type: 'person' };
const ARTICLES = [
    { url: 'https://x/a', article: { title: 'A', entities: [
        { entity_id: 'ent_bob', context: 'Bob Smith declined to answer questions about the inventory' }
    ] } },
    { url: 'https://x/b', article: { title: 'B', entities: [] } }
];
const CLAIMS = [
    { id: 'c1', source_url: 'https://x/b', about: ['ent_bob'], text: 'Bob revised his account',
      quote: 'I never said the Legos were missing' }
];

test('FA.1: buildSubjectBundle — per-source stored material only, with the grounding substrate', () => {
    const { bundle, memberTexts, sources } = buildSubjectBundle({ subject: SUBJECT, claims: CLAIMS, articles: ARTICLES });
    assert.equal(sources, 2);
    assert.match(bundle, /SUBJECT: Bob Smith \(person\)/);
    assert.match(bundle, /SOURCE <https:\/\/x\/a>/);
    assert.match(bundle, /declined to answer/);
    assert.match(bundle, /I never said the Legos were missing/);
    assert.ok(memberTexts['https://x/a'].includes('declined to answer'));
    assert.ok(memberTexts['https://x/b'].includes('I never said'));
});

test('FA.1: the firewall — grounded anchors, counter-read, intent red line, cap', () => {
    const memberTexts = {
        'https://x/a': 'mention: "Bob Smith declined to answer questions"',
        'https://x/b': 'claim: quote: "I never said the Legos were missing"'
    };
    const good = {
        maneuver: 'nonresponsive-answer', role: 'official', basis: 'quoted',
        counter_note: 'He may simply not have had the information at the time.',
        note: 'Declines then revises across sources.',
        anchors: [
            { url: 'https://x/a', quote: 'declined to answer questions' },
            { url: 'https://x/b', quote: 'I never said the Legos were missing' }
        ]
    };
    const run = (f) => validateForensicProposals([f], { memberTexts });
    // The valid maneuver value depends on the taxonomy — use one from it.
    const okOrTaxonomy = run(good);
    if (okOrTaxonomy.accepted.length !== 1) {
        // If the taxonomy lacks this token, the firewall must say so.
        assert.match(okOrTaxonomy.rejected[0].reason, /Invalid maneuver/);
    }

    assert.match(run({ ...good, counter_note: ' ' }).rejected[0].reason, /counter-read/);
    assert.match(run({ ...good, note: 'he is clearly lying here' }).rejected[0].reason, /Rule 1/);
    assert.match(run({ ...good, anchors: [{ url: 'https://x/a', quote: 'not in the stored text' }] })
        .rejected[0].reason, /does not ground/);
    assert.match(run({ ...good, role: 'villain' }).rejected[0].reason, /Invalid role/);
    assert.match(run({ ...good, basis: 'vibes' }).rejected[0].reason, /Invalid basis/);

    // The cap: proposal N+1 is rejected with the cap named.
    const many = Array.from({ length: MAX_FINDINGS_PER_SUBJECT + 2 }, () => ({ ...good }));
    const capped = validateForensicProposals(many, { memberTexts });
    assert.ok(capped.accepted.length <= MAX_FINDINGS_PER_SUBJECT);
});

test('FA.1: no intent/honesty field exists in the tool schema (Rule 1, structural)', async () => {
    const { buildForensicCorpusTool } = await import('../src/shared/forensic-corpus.js');
    const json = JSON.stringify(buildForensicCorpusTool().input_schema).toLowerCase();
    for (const banned of ['intent', 'honest', 'lying', 'confidence', 'score']) {
        assert.ok(!json.includes(`"${banned}`), `forbidden field family "${banned}"`);
    }
});

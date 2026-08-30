import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const {
    projectClaimNotes, projectExtractionNotes, projectForensicNotes,
    projectAuditNotes, projectPredictionNotes, projectCommentNotes, PAGE_REASONS
} = await import('../src/shared/annotations/notes.js');

const CLAIM = {
    id: 'claim_ab12cd34ef56ab12', text: 'The sale closed in March.',
    quote: 'the transaction was completed in March', anchor: null,
    article_hash: 'a'.repeat(64), source_url: 'https://example.com/story',
    about: [], source: null, is_key: true, context: '', created: 1
};

test('claim note carries quote, actions, and judgment sub-cards', () => {
    const assessment = { id: 'as1', claim_ref: { claim_id: CLAIM.id }, stance: -1, rationale: 'r', labels: [] };
    const verdict = { id: 'v1', proposition_id: 'p1', verdict: 'unfounded', standard_of_proof: 'clear', evidence_for: [], evidence_against: [] };
    const notes = projectClaimNotes({
        claims: [CLAIM],
        assessmentsByClaimId: { [CLAIM.id]: assessment },
        verdictsByClaimId: { [CLAIM.id]: [verdict] }
    });
    assert.equal(notes.length, 1);
    const n = notes[0];
    assert.equal(n.family, 'claim');
    assert.equal(n.id, 'claim:' + CLAIM.id);
    assert.equal(n.quote, CLAIM.quote);
    assert.equal(n.pageReason, null);
    assert.equal(n.grounding, null);
    assert.ok(n.actions.includes('assess') && n.actions.includes('adjudicate')
        && n.actions.includes('edit') && n.actions.includes('locate'));
    assert.equal(n.sub.length, 2);
    assert.deepEqual(n.sub.map((s) => s.kind).sort(), ['assessment', 'verdict']);
});

test('anchorless claim grounds by its text (segments.js demotes a miss later)', () => {
    const legacy = { ...CLAIM, id: 'claim_legacy0000000000', quote: '', anchor: null };
    const [n] = projectClaimNotes({ claims: [legacy], assessmentsByClaimId: {}, verdictsByClaimId: {} });
    assert.equal(n.quote, legacy.text);
    assert.equal(n.pageReason, null);
});

test('extraction notes lead with review state; decided rows keep locate only', () => {
    const record = {
        articleHash: 'a'.repeat(64), url: 'https://example.com/story', assertions: [
            { key: 'a:10-42', quote: 'exact span one', start: 10, end: 42, why: 'w', text: 'paraphrase', status: 'open', accepted_claim_id: null, first_seen: { producer: 'map' } },
            { key: 'a:50-70', quote: 'exact span two', start: 50, end: 70, why: '', text: null, status: 'dismissed', accepted_claim_id: null, first_seen: { producer: 'suggest' } }
        ]
    };
    const notes = projectExtractionNotes(record);
    assert.equal(notes.length, 2);
    assert.equal(notes[0].family, 'extraction');
    assert.equal(notes[0].reviewState, 'open');
    assert.ok(notes[0].actions.includes('accept') && notes[0].actions.includes('dismiss'));
    assert.equal(notes[1].reviewState, 'dismissed');
    assert.deepEqual(notes[1].actions, ['locate']);
    assert.equal(projectExtractionNotes(null).length, 0);
});

test('forensic notes: one per anchor, filtered by the metadata-normalized page URL, counter-read on the card', () => {
    const findings = {
        f1: { id: 'f1', maneuver: 'quote_mining', note: 'n', counter_note: 'c', anchors: [
            { quote: 'clipped words', selector: null, source_ref: { url: 'https://example.com/story' }, timestamp: null, step_note: '' },
            { quote: 'other page words', selector: null, source_ref: { url: 'https://elsewhere.org/x' }, timestamp: null, step_note: '' }
        ] },
        f2: { id: 'f2', maneuver: 'cherry_pick', note: '', counter_note: '', anchors: [
            { quote: 'unrelated', selector: null, source_ref: null, timestamp: null, step_note: '' }
        ] }
    };
    const notes = projectForensicNotes(findings, 'https://example.com/story?utm_source=x');
    assert.equal(notes.length, 1);
    assert.equal(notes[0].family, 'forensic');
    assert.equal(notes[0].quote, 'clipped words');
    assert.ok(notes[0].body.includes('Counter-read: c'));
});

test('audit notes are read-only (locate only) and carry module context', () => {
    const runs = [{ id: 'r1', moduleResults: [
        { module: 'module-03', findings: { hidden_premises: [{ premise: 'x', evidence_quote: 'the stated basis' }] } }
    ] }];
    const notes = projectAuditNotes(runs);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].family, 'audit');
    assert.equal(notes[0].quote, 'the stated basis');
    assert.deepEqual(notes[0].actions, ['locate']);
});

test('prediction and comment projections', () => {
    const preds = [{ id: 'p1', text: 'X will happen', evidence_quote: 'will happen by June', anchor: null, resolution_status: 'open' }];
    const [pn] = projectPredictionNotes(preds);
    assert.equal(pn.family, 'prediction');
    assert.equal(pn.quote, 'will happen by June');
    const [cn] = projectCommentNotes([{ author: 'someone', text: 'a platform comment' }]);
    assert.equal(cn.family, 'comment');
    assert.equal(cn.quote, '');
    assert.equal(cn.pageReason, PAGE_REASONS.pageLevelByDesign);
});

test('no projector title/family smuggles reserved vocabulary outside truth sub-cards', () => {
    const RESERVED = /verdict|ruling|opinion|court|integrity/i;
    // Hostile forensic fixture with custom maneuver containing reserved word
    const findings = {
        f_hostile: {
            id: 'f_hostile',
            maneuver: 'opinion-laundering',
            note: 'observation',
            counter_note: 'counter',
            anchors: [
                { quote: 'hostile quote', selector: null, source_ref: { url: 'https://example.com/story' }, timestamp: null, step_note: '' }
            ]
        }
    };
    const notes = [
        ...projectClaimNotes({ claims: [CLAIM], assessmentsByClaimId: {}, verdictsByClaimId: {} }),
        ...projectExtractionNotes({ articleHash: 'a'.repeat(64), url: 'https://example.com/story', assertions: [{ key: 'a:1-2', quote: 'q', start: 1, end: 2, why: '', text: null, status: 'open', accepted_claim_id: null, first_seen: {} }] }),
        ...projectForensicNotes(findings, 'https://example.com/story'),
        ...projectAuditNotes([{ id: 'r', moduleResults: [{ module: 'm', findings: { f: [{ evidence_quote: 'q' }] } }] }]),
        ...projectPredictionNotes([{ id: 'p', text: 'pred text', evidence_quote: 'pred quote', anchor: null, resolution_status: 'open' }]),
        ...projectCommentNotes([{ author: 'auth', text: 'comment text' }])
    ];
    for (const n of notes) {
        assert.doesNotMatch(n.title, RESERVED, `title of ${n.id}`);
        assert.doesNotMatch(n.family, RESERVED, `family of ${n.id}`);
    }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

// fake-indexeddb BEFORE any store-touching import (repo convention).
await import('fake-indexeddb/auto');

// A chrome stub with a real backing store: Storage JSON-serializes
// values, so fixtures are stored as JSON strings under their keys.
const backing = {};
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
                const out = {};
                const list = typeof keys === 'string' ? [keys]
                    : Array.isArray(keys) ? keys : Object.keys(keys || {});
                for (const k of list) if (k in backing) out[k] = backing[k];
                cb(out);
            },
            set(obj, cb) { Object.assign(backing, obj); cb && cb(); },
            remove(k, cb) { delete backing[k]; cb && cb(); }
        }
    }
};
// If any transitive import needs richer chrome stubs, copy the
// preamble from tests/claim-model.test.mjs (or the nearest
// claim-model-importing test) verbatim — do not invent new stubs.

const URL_A = 'https://example.com/story';
const HASH = 'a'.repeat(64);
const CLAIM = {
    id: 'claim_ab12cd34ef56ab12', text: 'The sale closed in March.',
    quote: 'the transaction was completed in March',
    source_url: URL_A, about: [], is_key: false, created: 1
};
backing['article_claims'] = JSON.stringify({ [CLAIM.id]: CLAIM });
backing['claim_assessments'] = JSON.stringify({
    as1: { id: 'as1', claim_ref: { claim_id: CLAIM.id }, stance: 1, rationale: 'r', labels: [], created: 2 }
});
backing['adjudicable_propositions'] = JSON.stringify({
    p1: { id: 'p1', claim_id: CLAIM.id, proposition_class: 'empirical', created: 3 }
});
backing['adjudicated_verdicts'] = JSON.stringify({
    v1: { id: 'v1', proposition_id: 'p1', verdict: 'supported', created: 4 }
});
backing['behavioral_findings'] = JSON.stringify({
    f1: { id: 'f1', maneuver: 'quote_mining', note: 'n', counter_note: '', anchors: [
        { quote: 'clipped words', selector: null, source_ref: { url: URL_A }, timestamp: null, step_note: '' }
    ] }
});

const { saveArticleExtraction } = await import('../src/shared/audit/audit-cache.js');
await saveArticleExtraction({
    articleHash: HASH, url: URL_A, title: 't', assertions: [
        { key: 'a:5-20', quote: 'a verbatim span', start: 5, end: 20, why: '', text: null,
          status: 'open', accepted_claim_id: null, triaged_at: null, first_seen: { producer: 'map' } }
    ]
});

const { collectMineNotes } = await import('../src/shared/annotations/collect.js');

test('collectMineNotes joins every family and reports the extraction key', async () => {
    const { notes, extractionKey } = await collectMineNotes({ url: URL_A, articleHash: HASH });
    const families = notes.map((n) => n.family);
    assert.ok(families.includes('claim'));
    assert.ok(families.includes('extraction'));
    assert.ok(families.includes('forensic'));
    assert.equal(extractionKey, HASH);
    const claimNote = notes.find((n) => n.family === 'claim');
    assert.equal(claimNote.sub.length, 2, 'assessment + verdict joined through the claim');
});

test('no hash: audit/extraction families absent, claims still load; extractionKey null', async () => {
    const { notes, extractionKey } = await collectMineNotes({ url: 'https://example.com/other' });
    assert.equal(extractionKey, null);
    assert.equal(notes.filter((n) => n.family === 'extraction').length, 0);
});

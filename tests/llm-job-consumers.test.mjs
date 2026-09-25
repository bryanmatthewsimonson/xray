// The five passes that joined the LLM job runner on 2026-09-25 (JOURNAL
// 2026-09-05 addendum) — driven through their REAL consumers, not a
// helper beside them (seam-and-invariant-check: assert the seam):
//
//   portal  links-block.js           corpus-links      (saves a run, acks after the save)
//   portal  hypothesis-block.js      hypothesis-edges  (render-only review)
//   portal  forensic-corpus-block.js forensic-corpus   (render-only review)
//   panel   sidepanel/entity-audit.js entity-audit     (render-only review)
//   reader  reader/quick-audit.js    audit-run         (imports through the audit firewall)
//
// The portal blocks run under a DOM stub with chrome.runtime routed to
// the REAL runner (tests/helpers/page-stub.mjs); the panel and reader
// runs take their transport injected. Every test observes the job
// protocol on the wire: which pass, which scope, when the ack goes out.
//
// The ack rule each consumer must keep (the runner's contract: a record
// is released only once the page holds the result itself):
//   - persisted (the link run saved, the audit imported) → ack;
//   - delivered to a review surface someone can SEE (render-only
//     passes: connected, and under no hidden view) → ack;
//   - unusable (malformed, firewall-refused, threw) → ack — a kept one
//     would be reused and fail identically on every retry;
//   - the persist failed, or the surface is gone → KEEP — the next
//     identical run picks the paid result up without a new call.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDomStub, installChromeStub, walkNodes, textOf, byText, until } from './helpers/page-stub.mjs';
import { createJobStub, jobSendMessage } from './helpers/llm-job-stub.mjs';

await import('fake-indexeddb/auto');
const { body } = installDomStub();
// One chrome stub for the file; the short status wait keeps a poll on a
// never-settling pass from parking for the real 15 s.
const H = installChromeStub({ runner: { statusWaitMaxMs: 20 } });
globalThis.confirm = () => true;

const { renderLinksBlock } = await import('../src/portal/links-block.js');
const { renderHypothesesBlock, SUGGEST_STATUS_MALFORMED } = await import('../src/portal/hypothesis-block.js');
const { renderForensicCorpusBlock } = await import('../src/portal/forensic-corpus-block.js');
const { runEntityAudit } = await import('../src/sidepanel/entity-audit.js');
const { runQuickAuditJob, INGEST_IMPORTED, INGEST_REJECTED, INGEST_FAILED } = await import('../src/reader/quick-audit.js');
const { getCaseLinkRun, clear: clearAuditDb } = await import('../src/shared/audit/audit-cache.js');
const { HypothesisModel } = await import('../src/shared/hypothesis-model.js');
const { llmJobScopeKey, llmJobRequestHash, jobStorageKey, LLM_JOB_LOST_ERROR } = await import('../src/shared/llm-jobs.js');

const CASE_ID = 'entity_00000000000000c1';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HEX64 = /^[0-9a-f]{64}$/;

const jobKeys = () => Object.keys(H.jobArea ? H.jobArea.store : {});
const released = () => until(() => jobKeys().length === 0);

/** A pass whose settlement the test controls. */
function deferredPass(result) {
    let resolve;
    const calls = [];
    const gate = new Promise((r) => { resolve = r; });
    return {
        calls,
        pass: async (request) => { calls.push(request); await gate; return result; },
        release: () => resolve()
    };
}

async function freshTest() {
    H.reset();
    H.jobArea = undefined;   // a fresh job store per test
    for (const k of Object.keys(H.store)) delete H.store[k];
    body.replaceChildren();
    await clearAuditDb();
}

function mount() {
    const host = document.createElement('div');
    body.appendChild(host);
    return host;
}

// ------------------------------------------------------------------
// portal — Suggest links (corpus-links): acks only after the run is SAVED
// ------------------------------------------------------------------

function linksData() {
    return {
        case: { id: CASE_ID, name: 'Origins', type: 'case' },
        orbit: { claims: [
            { id: 'claim_a', text: 'The market was the origin.', article_hash: HASH_A },
            { id: 'claim_b', text: 'The lab was the origin.', article_hash: HASH_B }
        ] },
        articles: [
            { url: 'https://x.test/a', articleHash: HASH_A, article: { title: 'A' } },
            { url: 'https://x.test/b', articleHash: HASH_B, article: { title: 'B' } }
        ]
    };
}
const LINKS_OUT = {
    ok: true, model: 'claude-test',
    linksInput: { proposals: [
        { source_claim_id: 'claim_a', target_claim_id: 'claim_b', relationship: 'contradicts', note: 'opposite origins' }
    ] }
};

async function mountLinks() {
    const host = mount();
    renderLinksBlock(host, { data: linksData(), dossier: { scope: { question: 'Where did it begin?' } } });
    assert.ok(await until(() => byText(host, 'Suggest links…')), 'the Suggest links control rendered');
    return host;
}

test('links: Suggest links runs the corpus-links JOB scoped to case + request hash, saves the run, THEN releases the record', async () => {
    await freshTest();
    const calls = [];
    H.startWorker({ 'corpus-links': async (req) => { calls.push(req); return LINKS_OUT; } });
    const host = await mountLinks();
    await byText(host, 'Suggest links…').dispatch('click');

    assert.equal(calls.length, 1, 'one pass call');
    const [start] = H.jobOps('start');
    assert.equal(start.pass, 'corpus-links');
    assert.deepEqual(calls[0], start.request, 'the pass received exactly the request the page hashed');
    assert.equal(start.scopeKey, llmJobScopeKey(CASE_ID, await llmJobRequestHash(start.request)));
    assert.match(start.scopeKey.split(':')[1], HEX64);
    assert.equal(start.request.claims.length, 2);
    assert.equal(H.sent.filter((m) => m.type === 'xray:llm:corpus-links').length, 0, 'the retired type is never sent');

    const saved = await getCaseLinkRun(CASE_ID);
    assert.equal(saved.acceptable.length, 1, 'the run is in the case-link-suggestions store');
    assert.ok(await released(), 'the job record is acked once the run is saved');
    assert.match(textOf(host), /Done — 1 proposal/);
});

test('links: a run the store REFUSES keeps its job record; the next identical Suggest picks it up with no second call', async () => {
    await freshTest();
    let calls = 0;
    H.startWorker({ 'corpus-links': async () => { calls += 1; return LINKS_OUT; } });
    const host = await mountLinks();
    const realPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function put(...args) {
        if (this.name === 'case-link-suggestions') throw new DOMException('quota', 'QuotaExceededError');
        return realPut.apply(this, args);
    };
    try { await byText(host, 'Suggest links…').dispatch('click'); }
    finally { IDBObjectStore.prototype.put = realPut; }
    assert.equal(calls, 1);
    assert.equal(H.jobOps('ack').length, 0, 'an unsaved run is never released');
    assert.equal(jobKeys().length, 1, 'the paid result stays on disk');

    await byText(host, 'Suggest links…').dispatch('click');
    assert.equal(calls, 1, 'reused, not re-bought');
    assert.ok(await getCaseLinkRun(CASE_ID), 'saved on the pickup');
    assert.ok(await released(), 'and released after that save');
});

test('links: a status poll dropped by a torn-down worker (lastError) is retried — never read as the worker refusing', async () => {
    await freshTest();
    H.startWorker({ 'corpus-links': async () => LINKS_OUT });
    const host = await mountLinks();
    H.dropNext('xray:llm:job:status');
    await byText(host, 'Suggest links…').dispatch('click');
    assert.match(textOf(host), /Done — 1 proposal/);
    assert.equal(H.jobOps('start').length, 1, 'never a second start');
    assert.ok(H.jobOps('status').length >= 2, 'the dropped poll was re-sent');
});

// ------------------------------------------------------------------
// portal — Suggest edges (hypothesis-edges): render-only review
// ------------------------------------------------------------------

const C1 = 'claim_00000000000000c1';
const C2 = 'claim_00000000000000c2';
function hypData() {
    const c1 = { id: C1, text: 'Market stalls sold live animals in December.', about: [CASE_ID], source: null,
        is_key: false, source_url: 'https://x.test/a', article_hash: HASH_A, created: 100 };
    const c2 = { id: C2, text: 'The lab worked on related viruses.', about: [CASE_ID], source: null,
        is_key: false, source_url: 'https://x.test/b', article_hash: HASH_B, created: 101 };
    return {
        case: { id: CASE_ID, name: 'Origins', type: 'case', pubkey: null },
        membership_ids: [CASE_ID],
        entitiesById: { [CASE_ID]: { id: CASE_ID, name: 'Origins', type: 'case',
            authored_fields: { scope_question: { value: 'Where did it begin?' } } } },
        articles: [{ url: 'https://x.test/a', articleHash: HASH_A, cachedAt: 10, article: { title: 'A' } }],
        orbit: { entity_ids: [CASE_ID], entities: [], dangling_entity_ids: [], claims: [c1, c2] },
        claimsById: { [C1]: c1, [C2]: c2 },
        propositions: { all: {}, orbit: [] },
        verdicts: { byProposition: {} },
        integrity: [], integrityAll: [], forensic: [],
        links: { contradicts: [], attestations: [] },
        wire: { verdicts: [], findings: [], articles: [] }
    };
}

async function seedHypothesis() {
    return HypothesisModel.create({ case_id: CASE_ID, label: 'Zoonotic', statement: 'Spillover at the market.', suggested_by: 'user' });
}

async function mountHypotheses() {
    const host = mount();
    renderHypothesesBlock(host, { data: hypData(), dossier: {}, callbacks: {} });
    assert.ok(await until(() => byText(host, 'Suggest edges (LLM)…')), 'the Suggest edges control rendered');
    return host;
}

const edgesOut = (hypId) => ({
    ok: true, model: 'claude-test',
    edgesInput: { edges: [{ hypothesis_id: hypId, claim_ref: C1, role: 'supports',
        quote: 'Market stalls sold live animals', why: 'places animals at the market' }] }
});

test('hypothesis edges: Suggest edges runs the hypothesis-edges JOB (case + request hash), renders the proposals, releases the record', async () => {
    await freshTest();
    const hyp = await seedHypothesis();
    const calls = [];
    H.startWorker({ 'hypothesis-edges': async (req) => { calls.push(req); return edgesOut(hyp.id); } });
    const host = await mountHypotheses();
    await byText(host, 'Suggest edges (LLM)…').dispatch('click');
    assert.ok(await until(() => /1 proposal/.test(textOf(host))), textOf(host));

    const [start] = H.jobOps('start');
    assert.equal(start.pass, 'hypothesis-edges');
    assert.deepEqual(calls[0], start.request);
    assert.equal(start.scopeKey, llmJobScopeKey(CASE_ID, await llmJobRequestHash(start.request)));
    assert.ok(byText(host, 'Accept'), 'the proposal is up for a human Accept — nothing applied');
    assert.ok(await released(), 'delivered to a live panel → released');
});

test('hypothesis edges: a malformed result is released at once (a kept one would fail identically on every retry)', async () => {
    await freshTest();
    await seedHypothesis();
    H.startWorker({ 'hypothesis-edges': async () => ({ ok: true, model: 'm', edgesInput: { edges: 'not a list' } }) });
    const host = await mountHypotheses();
    await byText(host, 'Suggest edges (LLM)…').dispatch('click');
    assert.ok(await until(() => textOf(host).includes(SUGGEST_STATUS_MALFORMED)));
    assert.ok(await released());
});

test('hypothesis edges: a panel the case view DROPPED mid-run keeps the record; the next identical Suggest shows it with no second call', async () => {
    await freshTest();
    const hyp = await seedHypothesis();
    const d = deferredPass(edgesOut(hyp.id));
    H.startWorker({ 'hypothesis-edges': d.pass });
    const first = await mountHypotheses();
    await byText(first, 'Suggest edges (LLM)…').dispatch('click');
    assert.ok(await until(() => d.calls.length === 1));
    first.remove();                          // the case view re-rendered
    d.release();
    assert.ok(await until(() => /1 proposal/.test(textOf(first))), 'the result landed — in a detached panel');
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(H.jobOps('ack').length, 0, 'nobody saw it: never released');
    assert.equal(jobKeys().length, 1);

    const second = await mountHypotheses();
    await byText(second, 'Suggest edges (LLM)…').dispatch('click');
    assert.ok(await until(() => /1 proposal/.test(textOf(second))));
    assert.equal(d.calls.length, 1, 'picked up, not re-bought');
    assert.ok(await released());
});

test('hypothesis edges: a panel in a HIDDEN view (the portal showing the library) is not a delivery — the record is kept', async () => {
    // Field-found by the 2026-09-25 agent walk: going back to the library
    // only HIDES #xr-view, so the case view stays connected; releasing on
    // `isConnected` acked a result nobody could see, and the next Suggest
    // paid again.
    await freshTest();
    const hyp = await seedHypothesis();
    const d = deferredPass(edgesOut(hyp.id));
    H.startWorker({ 'hypothesis-edges': d.pass });
    const view = mount();                     // the #xr-view stand-in
    const host = document.createElement('div');
    view.appendChild(host);
    renderHypothesesBlock(host, { data: hypData(), dossier: {}, callbacks: {} });
    assert.ok(await until(() => byText(host, 'Suggest edges (LLM)…')));
    await byText(host, 'Suggest edges (LLM)…').dispatch('click');
    assert.ok(await until(() => d.calls.length === 1));
    view.hidden = true;                       // the user went to the library
    d.release();
    assert.ok(await until(() => /1 proposal/.test(textOf(host))));
    assert.equal(host.isConnected, true, 'still connected — a connection test alone would have released it');
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(H.jobOps('ack').length, 0, 'not released onto a hidden view');
    assert.equal(jobKeys().length, 1);
});

test('hypothesis edges: a worker that dies MID-CALL reads as lost, with the honest re-bill copy', async () => {
    await freshTest();
    await seedHypothesis();
    const d = deferredPass({ ok: true });
    H.startWorker({ 'hypothesis-edges': d.pass });
    const host = await mountHypotheses();
    await byText(host, 'Suggest edges (LLM)…').dispatch('click');
    assert.ok(await until(() => d.calls.length === 1));
    H.startWorker({ 'hypothesis-edges': d.pass });   // restarted: empty registry, same store
    assert.ok(await until(() => textOf(host).includes(LLM_JOB_LOST_ERROR)), textOf(host));
    assert.match(textOf(host), /Suggest edges \(LLM\)… makes a new call, billed again\./);
});

// ------------------------------------------------------------------
// portal — the forensic corpus pass: render-only review
// ------------------------------------------------------------------

function forensicData() {
    const eP = { id: 'eP', name: 'Dr P', type: 'person' };
    return {
        case: { id: CASE_ID, name: 'Origins', type: 'case' },
        entitiesById: { eP },
        orbit: { entities: [eP], claims: [] },
        claimsById: {},
        articles: [
            { url: 'https://x.test/a', article: { title: 'A', entities: [{ entity_id: 'eP', context: 'Dr P said the market was closed.' }] } },
            { url: 'https://x.test/b', article: { title: 'B', entities: [{ entity_id: 'eP', context: 'Dr P said the market stayed open.' }] } }
        ]
    };
}

async function mountForensic() {
    const host = mount();
    renderForensicCorpusBlock(host, { data: forensicData(), callbacks: {} });
    assert.ok(await until(() => byText(host, 'Analyze subject…')));
    walkNodes(host).find((n) => n.tagName === 'SELECT').value = 'eP';
    return host;
}

test('forensic: Analyze subject runs the forensic-corpus JOB scoped to case + subject + bundle hash, renders the review, releases the record', async () => {
    await freshTest();
    const calls = [];
    H.startWorker({ 'forensic-corpus': async (req) => { calls.push(req); return { ok: true, model: 'claude-test', findings: [] }; } });
    const host = await mountForensic();
    await byText(host, 'Analyze subject…').dispatch('click');

    const [start] = H.jobOps('start');
    assert.equal(start.pass, 'forensic-corpus');
    assert.deepEqual(calls[0], start.request);
    assert.equal(start.request.subjectName, 'Dr P');
    assert.equal(start.scopeKey, llmJobScopeKey(CASE_ID, 'eP', await llmJobRequestHash(start.request)));
    assert.match(textOf(host), /No proposals/);
    assert.ok(await released());
});

test('forensic: a dropped status poll is RETRIED — the block flags lastError as a lost channel, not a refusal (the pre-job helper did not)', async () => {
    await freshTest();
    H.startWorker({ 'forensic-corpus': async () => ({ ok: true, model: 'claude-test', findings: [] }) });
    const host = await mountForensic();
    H.dropNext('xray:llm:job:status');
    await byText(host, 'Analyze subject…').dispatch('click');
    assert.doesNotMatch(textOf(host), /Pass failed/, textOf(host));
    assert.match(textOf(host), /No proposals/);
    assert.equal(H.jobOps('start').length, 1);
});

test('forensic: a review the case view dropped mid-run keeps the record for the next identical Analyze', async () => {
    await freshTest();
    const d = deferredPass({ ok: true, model: 'claude-test', findings: [] });
    H.startWorker({ 'forensic-corpus': d.pass });
    const host = await mountForensic();
    const click = byText(host, 'Analyze subject…').dispatch('click');
    assert.ok(await until(() => d.calls.length === 1));
    host.remove();
    d.release();
    await click;
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(H.jobOps('ack').length, 0);
    assert.equal(jobKeys().length, 1, 'kept for pickup');
});

test('forensic: a review in a HIDDEN view (the library showing) keeps the record', async () => {
    await freshTest();
    const d = deferredPass({ ok: true, model: 'claude-test', findings: [] });
    H.startWorker({ 'forensic-corpus': d.pass });
    const view = mount();
    const host = document.createElement('div');
    view.appendChild(host);
    renderForensicCorpusBlock(host, { data: forensicData(), callbacks: {} });
    assert.ok(await until(() => byText(host, 'Analyze subject…')));
    walkNodes(host).find((n) => n.tagName === 'SELECT').value = 'eP';
    const click = byText(host, 'Analyze subject…').dispatch('click');
    assert.ok(await until(() => d.calls.length === 1));
    view.hidden = true;
    d.release();
    await click;
    await new Promise((r) => setTimeout(r, 30));
    assert.match(textOf(host), /No proposals/, 'it rendered — into a view nobody can see');
    assert.equal(H.jobOps('ack').length, 0);
    assert.equal(jobKeys().length, 1, 'kept for pickup');
});

// ------------------------------------------------------------------
// side panel — the E2 entity audit (injected transport + host)
// ------------------------------------------------------------------

const ENTITIES = {
    e1: { id: 'e1', name: 'Acme Corp', type: 'organization' },
    e2: { id: 'e2', name: 'Jane Doe', type: 'person' }
};
const RENAME = { op: 'rename', entity_id: 'e1', name: 'Acme Corporation', note: 'The full legal name.' };
const BOGUS = { op: 'teleport', entity_id: 'e1', note: 'not an op' };

function auditHarness(passes, { area } = {}) {
    const stub = createJobStub({ passes, ...(area ? { area } : {}), runner: { statusWaitMaxMs: 20 } });
    const sendMessage = async (msg) => (msg.type === 'xray:llm:config'
        ? { ok: true, enabled: true, hasKey: true } : stub.sendMessage(msg));
    return { stub, sendMessage };
}

test('entity audit: the E2 run is the entity-audit JOB scoped to the registry digest; the firewall runs; the record is released after the review renders', async () => {
    const calls = [];
    const { stub, sendMessage } = auditHarness({ 'entity-audit': async (req) => { calls.push(req); return { ok: true, model: 'claude-test', ops: [RENAME, BOGUS] }; } });
    const host = mount();
    const rendered = [];
    await runEntityAudit({ entities: ENTITIES, archiveRecords: [] },
        { host: () => host, render: (r) => rendered.push(r), toast: () => {}, sendMessage, confirm: () => true });

    assert.equal(calls.length, 1);
    assert.deepEqual(Object.keys(calls[0]), ['digest'], 'the request is the digest alone');
    const start = stub.messages.find((m) => m.type === 'xray:llm:job:start');
    assert.equal(start.pass, 'entity-audit');
    assert.equal(start.scopeKey, llmJobScopeKey('registry', await llmJobRequestHash(calls[0])));
    assert.equal(rendered.length, 1);
    assert.deepEqual(rendered[0].accepted, [RENAME], 'validateEntityOps still gates what reaches review');
    assert.equal(rendered[0].rejected.length, 1);
    assert.equal(rendered[0].model, 'claude-test');
    assert.ok(await until(() => Object.keys(stub.area.store).length === 0), 'released after the review rendered');
});

test('entity audit: a review host that is gone keeps the record; the next identical audit renders it with no second call', async () => {
    let calls = 0;
    const { stub, sendMessage } = auditHarness({ 'entity-audit': async () => { calls += 1; return { ok: true, model: 'm', ops: [RENAME] }; } });
    let hostEl = mount();
    const rendered = [];
    const deps = { host: () => hostEl, render: (r) => rendered.push(r), toast: () => {}, sendMessage, confirm: () => true };
    const run = runEntityAudit({ entities: ENTITIES, archiveRecords: [] }, deps);
    hostEl = null;   // the user navigated off the health view mid-call
    await run;
    assert.equal(rendered.length, 0);
    assert.equal(Object.keys(stub.area.store).length, 1, 'kept for pickup');

    hostEl = mount();
    await runEntityAudit({ entities: ENTITIES, archiveRecords: [] }, deps);
    assert.equal(calls, 1, 'picked up, not re-bought');
    assert.equal(rendered.length, 1);
    assert.ok(await until(() => Object.keys(stub.area.store).length === 0));
});

test('entity audit: a failed call leaves a PERSISTENT line in the review host with the retry cost — not a timed toast', async () => {
    const d = deferredPass({ ok: true });
    const first = auditHarness({ 'entity-audit': d.pass });
    const host = mount();
    const toasts = [];
    let sendMessage = first.sendMessage;
    const run = runEntityAudit({ entities: ENTITIES, archiveRecords: [] },
        { host: () => host, render: () => {}, toast: (m) => toasts.push(m), sendMessage: (m) => sendMessage(m), confirm: () => true });
    assert.ok(await until(() => d.calls.length === 1));
    // The worker dies mid-call and comes back with an empty registry.
    sendMessage = auditHarness({ 'entity-audit': d.pass }, { area: first.stub.area }).sendMessage;
    await run;
    const line = textOf(host);
    assert.match(line, /^\s*Entity audit failed: the service worker restarted during the call/);
    assert.match(line, /Audit with LLM… makes a new call, billed again\./);
    assert.deepEqual(toasts, [], 'the host carried it');
});

test('entity audit: a closed gate throws before any job starts', async () => {
    const stub = createJobStub({ passes: { 'entity-audit': async () => ({ ok: true, ops: [] }) } });
    const sendMessage = async (msg) => (msg.type === 'xray:llm:config' ? { ok: true, enabled: true, hasKey: false } : stub.sendMessage(msg));
    await assert.rejects(runEntityAudit({ entities: ENTITIES, archiveRecords: [] },
        { host: () => null, render: () => {}, toast: () => {}, sendMessage, confirm: () => true }), /No Anthropic API key/);
    assert.equal(stub.messages.length, 0);
});

// ------------------------------------------------------------------
// reader — the Quick audit (audit-run): imports through the firewall
// ------------------------------------------------------------------

const LOCAL_HASH = 'c'.repeat(64);
const QUICK_REQ = { mode: 'single', markdown: '# Title\n\nBody text.', articleUrl: 'https://x.test/a', articleTitle: 'A' };
const AUDIT_OUT = { ok: true, model: 'claude-test', audit: { article: { hash: LOCAL_HASH } } };

test('quick audit: through the LEGACY stub shape — the pass rides audit-run, receives the same request the retired xray:audit:run carried', async () => {
    const legacy = [];
    const sendMessage = jobSendMessage(async (msg) => { legacy.push(msg); return AUDIT_OUT; });
    const ingested = [];
    const outcome = await runQuickAuditJob({ request: QUICK_REQ, localHash: LOCAL_HASH },
        { sendMessage, ingest: async (audit, model) => { ingested.push([audit, model]); return INGEST_IMPORTED; }, onFailure: assert.fail });
    assert.equal(outcome, INGEST_IMPORTED);
    assert.deepEqual(legacy, [{ type: 'xray:audit:run', request: QUICK_REQ }]);
    assert.deepEqual(ingested, [[AUDIT_OUT.audit, 'claude-test']]);
});

test('quick audit: imported → released; a STORAGE failure keeps the record and the next Quick audit of the same text reuses it; a firewall REJECTION releases', async () => {
    let calls = 0;
    const stub = createJobStub({ passes: { 'audit-run': async () => { calls += 1; return AUDIT_OUT; } } });
    const run = (ingestOutcome, request = QUICK_REQ) => runQuickAuditJob({ request, localHash: LOCAL_HASH },
        { sendMessage: stub.sendMessage, ingest: async () => ingestOutcome, onFailure: assert.fail });
    const start = () => stub.messages.filter((m) => m.type === 'xray:llm:job:start').at(-1);
    const records = () => Object.keys(stub.area.store);

    assert.equal(await run(INGEST_FAILED), INGEST_FAILED);
    assert.equal(calls, 1);
    assert.equal(start().scopeKey, llmJobScopeKey(LOCAL_HASH, await llmJobRequestHash(QUICK_REQ)));
    assert.deepEqual(records(), [jobStorageKey(`audit-run:${start().scopeKey}`)], 'an unsaved audit stays on disk');

    assert.equal(await run(INGEST_IMPORTED), INGEST_IMPORTED);
    assert.equal(calls, 1, 'the same text picked the kept audit up — no second call');
    assert.ok(await until(() => records().length === 0), 'released once imported');

    // A different text is a different job, whatever is on disk.
    await run(INGEST_FAILED);
    await run(INGEST_FAILED, { ...QUICK_REQ, markdown: `${QUICK_REQ.markdown} Edited.` });
    assert.equal(calls, 3);

    assert.equal(await run(INGEST_REJECTED), INGEST_REJECTED);
    assert.equal(calls, 3, 'reused the kept first-text audit');
    assert.ok(await until(() => records().length === 1), 'the rejected one is released; the edited text\'s stays');
});

test('quick audit: the elapsed counter is anchored to the job record, and a lost job names what a retry costs', async () => {
    const d = deferredPass(AUDIT_OUT);
    const stub = createJobStub({ passes: { 'audit-run': d.pass }, runner: { statusWaitMaxMs: 5, now: () => Date.now() - 95_000 } });
    const seen = [];
    await runQuickAuditJob({ request: QUICK_REQ, localHash: LOCAL_HASH }, {
        sendMessage: stub.sendMessage, ingest: async () => INGEST_IMPORTED, onFailure: assert.fail,
        onElapsed: (s) => { seen.push(s); d.release(); }
    });
    assert.ok(seen.length >= 1);
    assert.ok(seen[0] >= 94 && seen[0] <= 100, `anchored to createdAt, not the page clock: ${seen[0]}`);

    const lost = deferredPass(AUDIT_OUT);
    const first = createJobStub({ passes: { 'audit-run': lost.pass }, runner: { statusWaitMaxMs: 5 } });
    let send = first.sendMessage;
    const failures = [];
    const p = runQuickAuditJob({ request: QUICK_REQ, localHash: LOCAL_HASH }, {
        sendMessage: (m) => send(m), ingest: async () => assert.fail('nothing to ingest'), onFailure: (m) => failures.push(m)
    });
    assert.ok(await until(() => lost.calls.length === 1));
    send = createJobStub({ passes: { 'audit-run': lost.pass }, area: first.area }).sendMessage;   // worker restarted
    assert.equal(await p, null);
    assert.deepEqual(failures, [`Audit failed: ${LLM_JOB_LOST_ERROR}. Quick audit makes a new call, billed again.`]);
});

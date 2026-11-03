// Known-unknowns block — the portal renderer over a hostile stored
// finding (field bug 2026-08-30, three maintainer-diagnostics hits:
// "Known-unknowns block failed (f.primary_documents || []).filter is
// not a function"). The block's async body catches every error, logs
// it, and REMOVES the block — so the observable failure is an absent
// block. This test drives the real renderer through a minimal DOM stub
// and proves the block STAYS and shows the member's well-formed
// unknowns when primary_documents is a string: degraded, not crashed.
//
// The tolerance lives in shared/audit/known-unknowns.js (the model);
// the renderer is a 1:1 projection of that record and needs none of
// its own — this test is the seam check that the projection holds
// (seam-and-invariant-check: assert the block, not the helper).

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Standard idiom: the module graph reaches Utils → CONFIG → chrome.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

// A minimal DOM stub — enough for portal/dom.js `el` and this block:
// createElement → node with className/textContent/title, appendChild,
// remove (the failure path), children for walking. Mirrors the
// portal-case-people test's stub.
function installDomStub() {
    const mk = (tag) => {
        const node = {
            tagName: tag.toUpperCase(), className: '', textContent: '', title: '', open: false,
            children: [], parentElement: null,
            appendChild(c) { c.parentElement = node; node.children.push(c); return c; },
            removeChild(c) { node.children = node.children.filter((x) => x !== c); },
            remove() { if (node.parentElement) node.parentElement.removeChild(node); }
        };
        return node;
    };
    globalThis.document = { createElement: mk, createElementNS: (_ns, tag) => mk(tag) };
    return mk('div');
}
const walk = (node, out = []) => { out.push(node); for (const c of node.children) walk(c, out); return out; };

const { renderKnownUnknownsBlock } = await import('../src/portal/known-unknowns-block.js');
const { Utils } = await import('../src/shared/utils.js');

// The block's body is an async IIFE; settle by polling the DOM. It
// finishes when the block either fills (rendered) or leaves (removed).
async function settled(host) {
    for (let i = 0; i < 100; i++) {
        const block = host.children[0];
        if (!block || block.children.length > 0) return;
        await new Promise((r) => setTimeout(r, 5));
    }
}

const HASH = 'a'.repeat(64);
const URL = 'https://example.com/story';

// collectCaseDossierData-shaped input: one claim-member article whose
// audit run carries the hostile module-04 finding.
function makeData(findings) {
    return {
        case: { id: 'case1', name: 'Case', type: 'case' },
        membership_ids: ['case1'],
        orbit: { claims: [{ id: 'c1', source_url: URL, article_hash: HASH }] },
        articles: [{ url: URL, articleHash: HASH, cachedAt: 1,
            article: { title: 'The hostile member', entities: [{ entity_id: 'case1' }] } }],
        wire: { verdicts: [], findings: [], articles: [] },
        auditRuns: [{
            articleHash: HASH,
            moduleResults: [{ module: 'source_quality', findings, auditor_caveats: [] }]
        }]
    };
}

test('renderer: primary_documents as a STRING — the block renders degraded instead of removing itself', async () => {
    const host = installDomStub();
    const logged = [];
    const origError = Utils.error;
    try { Utils.error = (...args) => logged.push(args); } catch (_) { /* frozen — DOM check still decides */ }
    try {
        renderKnownUnknownsBlock(host, { data: makeData({
            primary_documents: 'an internal memo the reporter never saw',   // the observed crash shape
            single_sourced_contested_claims: [],
            sources: [{ label: 'a source', type: 'anonymous_bare', evidence_quote: 'a source said' }]
        }) });
        await settled(host);

        assert.equal(host.children.length, 1, 'the block is still in the host — the failure path removes it');
        const nodes = walk(host);
        const heading = nodes.find((n) => n.tagName === 'H3');
        assert.ok(heading && /Known unknowns/.test(heading.textContent), 'heading rendered');
        const prov = nodes.find((n) => /carry unknowns/.test(n.textContent));
        assert.ok(prov, 'provenance line rendered');
        assert.match(prov.textContent, /1 of 1 audited member carry unknowns/);
        assert.match(prov.textContent, /1 bare-anonymous source/, 'the well-formed unknown survives');
        assert.match(prov.textContent, /0 unretrievable documents/, 'the string field reads as zero documents, not characters');
        const memberRow = nodes.find((n) => n.tagName === 'LI' && /ANON-BARE/.test(n.title));
        assert.ok(memberRow, 'the member row renders with its tooltip');
        assert.deepEqual(logged.filter((a) => /Known-unknowns block failed/.test(String(a[0]))), [],
            'nothing logged as a block failure');
    } finally {
        try { Utils.error = origError; } catch (_) { /* frozen */ }
    }
});

test('renderer: a member whose ONLY unknown-bearing field is malformed is quietly absent (no unknowns, no crash)', async () => {
    const host = installDomStub();
    const logged = [];
    const origError = Utils.error;
    try { Utils.error = (...args) => logged.push(args); } catch (_) { /* frozen */ }
    try {
        renderKnownUnknownsBlock(host, { data: makeData({
            primary_documents: 'an internal memo',
            single_sourced_contested_claims: 'one claim',
            sources: { label: 'a source', type: 'anonymous_bare', evidence_quote: 'q' }
        }) });
        await settled(host);
        assert.equal(host.children.length, 0, 'nothing to disclose → the block leaves, as for a clean corpus');
        assert.deepEqual(logged.filter((a) => /Known-unknowns block failed/.test(String(a[0]))), [],
            'absent because empty, NOT because it threw');
    } finally {
        try { Utils.error = origError; } catch (_) { /* frozen */ }
    }
});

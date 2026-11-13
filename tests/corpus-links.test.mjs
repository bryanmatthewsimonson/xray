// Standalone cross-article link suggestion — Phase 28.3. The pure
// layers: the prompt/tool builders (the firewall guard — no numeric
// slot, never-verdict language) and prepareLinkProposals (wrap →
// validate → existing-pair rejection). The LLM pass and the portal
// block are verified in-extension (SMOKE P28.m–q).

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const {
    buildClaimLinksTool, buildClaimLinksSystemPrompt, buildClaimLinksUserPrompt,
    CLAIM_LINKS_TOOL_NAME, CLAIM_LINKS_PROMPT_VERSION, MAX_CLAIM_LINKS_CLAIMS
} = await import('../src/shared/corpus-prompts.js');
const { prepareLinkProposals, linkRecordKey, proposalKey } =
    await import('../src/shared/case-synthesis.js');

const C1 = 'claim_' + '1'.repeat(16);
const C2 = 'claim_' + '2'.repeat(16);
const C3 = 'claim_' + '3'.repeat(16);
const CLAIMS_BY_ID = { [C1]: { id: C1, text: 'one' }, [C2]: { id: C2, text: 'two' }, [C3]: { id: C3, text: 'three' } };

// ------------------------------------------------------------------
// Prompt layer — the firewall, machine-checked
// ------------------------------------------------------------------

const FORBIDDEN_KEY = /^(score|weight|probability|likelihood|confidence|strength|rank|rating|percent|pct)$/i;

function collectKeys(node, out = new Set()) {
    if (Array.isArray(node)) { for (const v of node) collectKeys(v, out); return out; }
    if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) { out.add(k); collectKeys(v, out); }
    }
    return out;
}

// Provenance: INTERPRETATION (2026-09-26) — expires 2026-12-25
test('corpus-links: the tool schema has no numeric-scoring slot', () => {
    const tool = buildClaimLinksTool();
    assert.equal(tool.name, CLAIM_LINKS_TOOL_NAME);
    for (const key of collectKeys(tool.input_schema)) {
        assert.ok(!FORBIDDEN_KEY.test(key), `forbidden numeric-scoring key in tool schema: ${key}`);
    }
    const rel = tool.input_schema.properties.proposals.items.properties.relationship;
    assert.deepEqual([...rel.enum].sort(), ['contradicts', 'depends-on', 'duplicates', 'supports', 'updates'],
        'the enum is exactly the PROPOSABLE_RELATIONSHIPS vocabulary (the picker set, D.5)');
});

test('corpus-links: the system prompt forbids verdicts and invented ids', () => {
    const sys = buildClaimLinksSystemPrompt({ caseName: 'Eggs', scopeQuestion: 'Are eggs safe?' });
    assert.match(sys, /NEVER output a verdict, score, probability/);
    assert.match(sys, /never invent, abbreviate, or shorthand/i);
    assert.match(sys, /DIFFERENT articles/);
    assert.match(sys, /Do not re-propose a relationship that already exists/);
    assert.ok(sys.includes('"Eggs"') && sys.includes('"Are eggs safe?"'));
});

test('corpus-links: the user prompt renders the index + existing links', () => {
    const up = buildClaimLinksUserPrompt({
        claims: [{ id: C1, text: 'one', article_hash: 'a'.repeat(64) }],
        existing: [`${C2} contradicts ${C3}`]
    });
    assert.ok(up.includes(`${C1} [art:aaaaaaaa] — one`));
    assert.ok(up.includes(`${C2} contradicts ${C3}`));
    assert.match(buildClaimLinksUserPrompt({ claims: [] }), /\(none yet\)/);
});

test('corpus-links: prompt version + claims cap exported', () => {
    assert.equal(CLAIM_LINKS_PROMPT_VERSION, 'claim-links-v2');
    assert.equal(MAX_CLAIM_LINKS_CLAIMS, 150);
});

// ------------------------------------------------------------------
// prepareLinkProposals
// ------------------------------------------------------------------

test('prepareLinkProposals: wraps, validates, and keeps good proposals', () => {
    const { acceptable, rejected } = prepareLinkProposals({
        proposals: [{ source_claim_id: C1, target_claim_id: C2, relationship: 'contradicts', note: 'opposite' }]
    }, { claimsById: CLAIMS_BY_ID });
    assert.equal(acceptable.length, 1);
    assert.equal(acceptable[0].kind, 'relationship');
    assert.equal(acceptable[0].note, 'opposite');
    assert.equal(rejected.length, 0);
});

test('prepareLinkProposals: unknown ids, self-links, bad enums are rejected with reasons', () => {
    const { acceptable, rejected } = prepareLinkProposals({
        proposals: [
            { source_claim_id: 'claim_' + 'f'.repeat(16), target_claim_id: C2, relationship: 'supports' },
            { source_claim_id: C1, target_claim_id: C1, relationship: 'supports' },
            { source_claim_id: C1, target_claim_id: C2, relationship: 'proves' }
        ]
    }, { claimsById: CLAIMS_BY_ID });
    assert.equal(acceptable.length, 0);
    assert.equal(rejected.length, 3);
    assert.ok(rejected.every((r) => r.reason));
});

test('prepareLinkProposals: an already-existing pair+relationship is rejected, not dropped', () => {
    const existingKeys = new Set([
        linkRecordKey({ source_claim_id: C2, target_claim_id: C1, relationship: 'contradicts' }),
        linkRecordKey({ source_claim_id: C2, target_claim_id: C1, relationship: 'supports' })
    ]);
    const { acceptable, rejected } = prepareLinkProposals({
        proposals: [
            // Symmetric pair the OTHER direction — the sorted-pair key catches it.
            { source_claim_id: C1, target_claim_id: C2, relationship: 'contradicts' },
            // Directional pair the OTHER direction — a DIFFERENT claim about the world (D.5).
            { source_claim_id: C1, target_claim_id: C2, relationship: 'supports' },
            // Same pair, DIFFERENT relationship — allowed to coexist.
            { source_claim_id: C1, target_claim_id: C2, relationship: 'updates' }
        ]
    }, { claimsById: CLAIMS_BY_ID, existingKeys });
    assert.deepEqual(acceptable.map((p) => p.relationship), ['supports', 'updates']);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].relationship, 'contradicts');
    assert.match(rejected[0].reason, /already exists/);
});

test('prepareLinkProposals: duplicates in one run dedupe silently; malformed input is empty', () => {
    const { acceptable } = prepareLinkProposals({
        proposals: [
            { source_claim_id: C1, target_claim_id: C2, relationship: 'contradicts' },
            { source_claim_id: C2, target_claim_id: C1, relationship: 'contradicts' },
            { source_claim_id: C1, target_claim_id: C2, relationship: 'supports' },
            { source_claim_id: C2, target_claim_id: C1, relationship: 'supports' }
        ]
    }, { claimsById: CLAIMS_BY_ID });
    assert.equal(acceptable.length, 3, 'a reversed symmetric repeat dedupes to one; a reversed directional pair is two');
    assert.deepEqual(prepareLinkProposals(null, { claimsById: CLAIMS_BY_ID }),
        { acceptable: [], rejected: [] });
});

test('linkRecordKey matches proposalKey for the same pair+relationship', () => {
    const link = { source_claim_id: C2, target_claim_id: C1, relationship: 'contradicts' };
    const proposal = { kind: 'relationship', source_claim_id: C1, target_claim_id: C2, relationship: 'contradicts' };
    assert.equal(linkRecordKey(link), proposalKey(proposal));
});

test('prepareLinkProposals: depends-on is proposable; a revision value is not (D.5)', () => {
    const { acceptable, rejected } = prepareLinkProposals({
        proposals: [
            { source_claim_id: C1, target_claim_id: C2, relationship: 'depends-on', note: 'cannot be true without it' },
            { source_claim_id: C1, target_claim_id: C2, relationship: 'narrative-patch' }
        ]
    }, { claimsById: CLAIMS_BY_ID });
    assert.deepEqual(acceptable.map((p) => p.relationship), ['depends-on']);
    assert.equal(rejected.length, 1);
    assert.match(rejected[0].reason, /invalid relationship "narrative-patch"/);
});

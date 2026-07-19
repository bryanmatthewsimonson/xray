// Case-synthesis pure-layer tests — Phase 20.4. Validators, grounding,
// proposal filtering, and input-hash determinism. A chrome stub is
// needed because case-synthesis → case-dossier → models probe storage
// at import (the functions under test don't touch it).

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const CS = await import('../src/shared/case-synthesis.js');
const { createGroundingIndex } = await import('../src/shared/quote-grounding.js');
const { orchestrateModuleRuns } = await import('../src/shared/audit/run-orchestrator.js');

test('case-synthesis: validateCorpusExtract accepts a good extract, rejects a bad one', () => {
    const good = { position: { summary: 'argues X', side_label: 'X' },
        key_assertions: [{ quote: 'a verbatim span', claim_ref: null, why_load_bearing: 'core' }] };
    assert.equal(CS.validateCorpusExtract(good).ok, true);
    const bad = { position: { summary: 5 } };  // summary must be string
    assert.equal(CS.validateCorpusExtract(bad).ok, false);
    const noPos = { key_assertions: [] };      // position required
    assert.equal(CS.validateCorpusExtract(noPos).ok, false);
});

test('case-synthesis: validateCaseBrief enforces shape + proposal enum', () => {
    const good = { summary: 's', positions: [{ label: 'A' }], cruxes: [], load_bearing: [],
        coverage_gaps: [], proposals: [{ kind: 'is_key', claim_id: 'c1' }] };
    assert.equal(CS.validateCaseBrief(good).ok, true);
    const badKind = { summary: 's', proposals: [{ kind: 'delete_everything' }] };
    assert.equal(CS.validateCaseBrief(badKind).ok, false);
    const noSummary = { positions: [] };
    assert.equal(CS.validateCaseBrief(noSummary).ok, false);
});

test('case-synthesis: groundCaseBrief drops ungrounded quotes, keeps grounded with the member span', () => {
    const text = 'The lab reported the sequence on 2019-12-30, according to the log.';
    const idx = { A: createGroundingIndex(text) };
    const brief = {
        summary: 's',
        cruxes: [{ question: 'q', sides: [], evidence_refs: [
            { article_hash: 'A', quote: 'reported the sequence on 2019-12-30' },   // grounded
            { article_hash: 'A', quote: 'a fabricated span not present' }           // dropped
        ], what_would_resolve: '' }],
        load_bearing: [{ article_hash: 'A', quote: 'according to the log', why: 'w' }],
        coverage_gaps: [], proposals: []
    };
    const { brief: out, checked, dropped } = CS.groundCaseBrief(brief, idx);
    assert.equal(checked, 3);
    assert.equal(dropped, 1);
    assert.equal(out.cruxes[0].evidence_refs.length, 1);
    assert.ok(text.includes(out.cruxes[0].evidence_refs[0].quote));
    assert.equal(out.load_bearing.length, 1);
});

test('case-synthesis: filterProposals accepts resolvable refs, rejects the rest with reasons', () => {
    const claimsById = { c1: { id: 'c1', text: 'x' }, c2: { id: 'c2', text: 'y' } };
    const memberHashes = new Set(['A']);
    const brief = { proposals: [
        { kind: 'relationship', source_claim_id: 'c1', target_claim_id: 'c2', relationship: 'contradicts' },
        { kind: 'relationship', source_claim_id: 'c1', target_claim_id: 'zzz', relationship: 'contradicts' },
        { kind: 'relationship', source_claim_id: 'c1', target_claim_id: 'c2', relationship: 'invents' },
        { kind: 'is_key', claim_id: 'c1' },
        { kind: 'is_key', claim_id: 'nope' },
        { kind: 'claim', article_hash: 'A', text: 'new', quote: 'grounded' },
        { kind: 'claim', article_hash: 'B', text: 'new', quote: 'grounded' }
    ] };
    const { acceptable, rejected } = CS.filterProposals(brief, { claimsById, memberHashes });
    assert.equal(acceptable.length, 3, 'valid relationship + is_key + member claim');
    assert.equal(rejected.length, 4);
    assert.ok(rejected.every((r) => typeof r.reason === 'string'));
});

test('case-synthesis: filterProposals rejects a self-link and dedups repeats (20.6)', () => {
    const claimsById = { c1: { id: 'c1', text: 'x' }, c2: { id: 'c2', text: 'y' } };
    const brief = { proposals: [
        // self-link — both endpoints the same claim → rejected, not acceptable.
        { kind: 'relationship', source_claim_id: 'c1', target_claim_id: 'c1', relationship: 'contradicts' },
        // three copies of one valid link (last two orderings identical) → one survives.
        { kind: 'relationship', source_claim_id: 'c1', target_claim_id: 'c2', relationship: 'contradicts' },
        { kind: 'relationship', source_claim_id: 'c1', target_claim_id: 'c2', relationship: 'contradicts' },
        { kind: 'relationship', source_claim_id: 'c2', target_claim_id: 'c1', relationship: 'contradicts' },
        // duplicate is_key → one survives.
        { kind: 'is_key', claim_id: 'c1' },
        { kind: 'is_key', claim_id: 'c1' }
    ] };
    const { acceptable, rejected } = CS.filterProposals(brief, { claimsById, memberHashes: new Set() });
    assert.equal(acceptable.length, 2, 'one deduped link + one deduped is_key');
    assert.equal(rejected.length, 1, 'the self-link');
    assert.match(rejected[0].reason, /same claim/);
});

test('case-synthesis: digestDossier surfaces the claim index for the reduce stage (20.6)', () => {
    const dossier = { coverage: {}, shape_of_knowledge: {}, knots: {}, orbit: { claim_ids: ['c1'] } };
    const digest = JSON.parse(CS.digestDossier(dossier, { claims: [
        { id: 'c1', text: 'The lab reported the sequence.', article_hash: 'A' }
    ] }));
    assert.equal(digest.claim_count, 1);
    assert.equal(digest.claims[0].id, 'c1');
    assert.ok(digest.claims[0].text.includes('lab reported'));
    // No claims passed → empty index (not a crash), count 0.
    const empty = JSON.parse(CS.digestDossier(dossier));
    assert.deepEqual(empty.claims, []);
    assert.equal(empty.claim_count, 0);
});

test('case-synthesis: digest claims carry short per-article keys so cross-article pairs are identifiable (27 S.1)', () => {
    const dossier = { coverage: {}, shape_of_knowledge: {}, knots: {}, orbit: {} };
    const digest = JSON.parse(CS.digestDossier(dossier, { claims: [
        { id: 'c1', text: 'One.', article_hash: 'a'.repeat(64) },
        { id: 'c2', text: 'Two.', article_hash: 'b'.repeat(64) },
        { id: 'c3', text: 'Three.', article_hash: 'a'.repeat(64) },
        { id: 'c4', text: 'Hashless.' }
    ] }));
    assert.deepEqual(digest.claims.map((c) => c.art), ['A1', 'A2', 'A1', null],
        'same article → same key; no hash → null, never fabricated');
    assert.deepEqual(digest.articles, { A1: 'a'.repeat(64), A2: 'b'.repeat(64) },
        'keys resolve back to the real hashes');
    assert.ok(!JSON.stringify(digest.claims).includes('a'.repeat(64)),
        'the 64-hex hash no longer rides every claim entry');
});

test('case-synthesis: digest claim index is capped AND representative — spans articles, not the densest few', () => {
    const dossier = { coverage: {}, shape_of_knowledge: {}, knots: {}, orbit: {} };
    // 200 articles × 2 claims = 400. Naive first-N would show ~75 articles;
    // representative round-robin should surface DIGEST_CLAIM_CAP distinct ones.
    const claims = [];
    for (let a = 0; a < 200; a++) {
        const hash = `${a}`.padStart(2, '0').repeat(32).slice(0, 64);
        claims.push({ id: `c${a}_0`, text: `A${a} c0`, article_hash: hash });
        claims.push({ id: `c${a}_1`, text: `A${a} c1`, article_hash: hash });
    }
    const digest = JSON.parse(CS.digestDossier(dossier, { claims }));
    assert.equal(digest.claim_count, CS.DIGEST_CLAIM_CAP);
    assert.equal(digest.claims.length, CS.DIGEST_CLAIM_CAP);
    const arts = new Set(digest.claims.map((c) => c.art));
    assert.equal(arts.size, CS.DIGEST_CLAIM_CAP, 'one claim from each of 150 distinct articles (breadth, not clustering)');
    // art-key map consistency (27 S.1): every art key resolves to a hash.
    for (const c of digest.claims) assert.ok(c.art === null || digest.articles[c.art], `art key ${c.art} resolves`);
    // Small corpora (<= cap) pass through untouched.
    const few = JSON.parse(CS.digestDossier(dossier, { claims: claims.slice(0, 3) }));
    assert.equal(few.claims.length, 3);
});

test('case-synthesis: selectDigestClaims keeps ALL is_key claims, then rounds robin so a dense article cannot monopolize', () => {
    const claims = [];
    for (let i = 0; i < 200; i++) claims.push({ id: `dense_${i}`, text: 't', article_hash: 'd'.repeat(64), is_key: i < 3 });
    for (let a = 0; a < 50; a++) claims.push({ id: `a${a}`, text: 't', article_hash: `${a}`.padStart(2, '0').repeat(32).slice(0, 64) });
    const sel = CS.selectDigestClaims(claims, 20);
    assert.equal(sel.length, 20);
    assert.equal(sel.filter((c) => c.is_key).length, 3, 'every is_key claim survives the cap');
    assert.ok(new Set(sel.map((c) => c.article_hash)).size >= 15, 'breadth: the 200-claim article does not eat the budget');
    // <= cap returns as-is (identity).
    const small = [{ id: 'x', article_hash: 'h' }];
    assert.equal(CS.selectDigestClaims(small, 20), small);
});

test('case-synthesis: corpusExtractKey keys on MAP_PROMPT_VERSION, not the overall version (map cache survives reduce bumps)', async () => {
    const { MAP_PROMPT_VERSION, CORPUS_PROMPT_VERSION } = await import('../src/shared/corpus-prompts.js');
    const req = { memberText: 'body', claimsDigest: 'c1 — x', caseName: 'c', scopeQuestion: 'q', memberMeta: { title: 'T', url: 'u' } };
    const dflt = await CS.corpusExtractKey(req);
    assert.equal(dflt, await CS.corpusExtractKey(req, MAP_PROMPT_VERSION), 'default keys on MAP_PROMPT_VERSION');
    assert.notEqual(dflt, await CS.corpusExtractKey(req, CORPUS_PROMPT_VERSION), 'overall version differs — a reduce bump would NOT move the cache key');
});

test('case-synthesis: proposalKey is stable and direction-insensitive for relationships (27 S.3)', () => {
    // The triage record persists under these keys — a key change would
    // silently resurrect every dismissed proposal.
    assert.equal(
        CS.proposalKey({ kind: 'relationship', source_claim_id: 'c1', target_claim_id: 'c2', relationship: 'supports' }),
        'rel:c1|c2:supports');
    assert.equal(
        CS.proposalKey({ kind: 'relationship', source_claim_id: 'c2', target_claim_id: 'c1', relationship: 'supports' }),
        'rel:c1|c2:supports', 'endpoint order does not fork the key');
    assert.equal(CS.proposalKey({ kind: 'is_key', claim_id: 'c1' }), 'key:c1');
    assert.equal(CS.proposalKey({ kind: 'claim', article_hash: 'A', text: 't' }), 'claim:A|t');
});

test('case-synthesis: corpusExtractKey is stable on identical inputs, changes on text/claims/prompt', async () => {
    const base = { member_id: 'a'.repeat(64), memberText: 'Body text.', claimsDigest: 'c1 — one\nc2 — two',
        caseName: 'covid', scopeQuestion: 'origin?', memberMeta: { title: 'T', url: 'https://x/a' } };
    const k = await CS.corpusExtractKey(base);
    assert.match(k, /^[0-9a-f]{64}$/);
    // Same inputs → same key (deterministic reuse).
    assert.equal(await CS.corpusExtractKey({ ...base }), k);
    // member_id is derived from text and NOT part of the key.
    assert.equal(await CS.corpusExtractKey({ ...base, member_id: 'z'.repeat(64) }), k);
    // Each real input flips the key — these are the invalidation triggers.
    assert.notEqual(await CS.corpusExtractKey({ ...base, memberText: 'Edited body.' }), k, 'body edit');
    assert.notEqual(await CS.corpusExtractKey({ ...base, claimsDigest: 'c1 — one\nc2 — two\nc3 — three' }), k, 'a Suggest pass added a claim');
    assert.notEqual(await CS.corpusExtractKey(base, 'corpus-v9'), k, 'prompt-version bump');
    assert.notEqual(await CS.corpusExtractKey({ ...base, caseName: 'other' }), k, 'case framing');
});

test('case-synthesis: corpusInputHash is order-insensitive but sensitive to membership + prompt', async () => {
    const a = [{ article_hash: 'h1' }, { article_hash: 'h2' }];
    const aRev = [{ article_hash: 'h2' }, { article_hash: 'h1' }];
    const h1 = await CS.corpusInputHash(a, ['c1', 'c2'], 'corpus-v1');
    const h1rev = await CS.corpusInputHash(aRev, ['c2', 'c1'], 'corpus-v1');
    assert.equal(h1, h1rev, 'order-insensitive');
    const h2 = await CS.corpusInputHash([{ article_hash: 'h1' }], ['c1', 'c2'], 'corpus-v1');
    assert.notEqual(h1, h2, 'membership change flips it');
    const h3 = await CS.corpusInputHash(a, ['c1', 'c2'], 'corpus-v2');
    assert.notEqual(h1, h3, 'prompt-version change flips it');
});

test('case-synthesis: orchestrateModuleRuns drives the map with injected send (retry + failure)', async () => {
    const attempts = {};
    const { modules, failures } = await orchestrateModuleRuns({
        moduleNames: ['A', 'B', 'C'],
        concurrency: 2,
        retryDelayMs: 0,
        wait: () => Promise.resolve(),
        send: async (id) => {
            attempts[id] = (attempts[id] || 0) + 1;
            if (id === 'A') return { ok: true, findings: { position: { summary: 'a' } }, model: 'm' };
            if (id === 'B') return attempts[id] === 1
                ? { ok: false, status: 429 }                       // retryable, succeeds on retry
                : { ok: true, findings: { position: { summary: 'b' } }, model: 'm' };
            return { ok: false, error: 'hard fail' };              // C never succeeds
        }
    });
    assert.deepEqual(Object.keys(modules).sort(), ['A', 'B']);
    assert.equal(attempts.B, 2, 'B retried once');
    assert.equal(failures.length, 1);
    assert.equal(failures[0].module, 'C');
});

test('case-synthesis: buildMemberUnits joins ALL a member article\'s claims by source_url, not the orbit (about-case) subset', async () => {
    const CASE = 'entity_case';
    const SUBJ = 'entity_subject';
    // Two member articles (tagged with the case). Their claims are
    // `about` the SUBJECT, never the case entity — so the old orbit
    // filter (`about` includes the case) would attach ZERO of them. A
    // third article is NOT a member (untagged); its claim must not leak.
    const data = {
        case: { id: CASE, name: 'Test case' },
        membership_ids: [CASE],
        orbit: { claims: [] },              // nothing authored about the case itself
        wire: { articles: [] },
        claimsById: {
            c1: { id: 'c1', text: 'Claim one',    source_url: 'https://ex.com/a', about: [SUBJ], created: 100 },
            c2: { id: 'c2', text: 'Key claim',    source_url: 'https://ex.com/a', about: [SUBJ], is_key: true, created: 90 },
            c3: { id: 'c3', text: 'From B',       source_url: 'https://ex.com/b', about: [SUBJ], created: 50 },
            cX: { id: 'cX', text: 'Non-member',   source_url: 'https://other.com/z', about: [SUBJ], created: 10 }
        },
        articles: [
            { url: 'https://ex.com/a',    articleHash: 'hashA', article: { title: 'A', content: 'Body A', entities: [{ entity_id: CASE }] } },
            { url: 'https://ex.com/b',    articleHash: 'hashB', article: { title: 'B', content: 'Body B', entities: [{ entity_id: CASE }] } },
            { url: 'https://other.com/z', articleHash: 'hashZ', article: { title: 'Z', content: 'Body Z', entities: [] } }
        ]
    };
    const units = await CS.buildMemberUnits(data);
    const byUrl = Object.fromEntries(units.map((u) => [u.url, u]));

    assert.deepEqual(units.map((u) => u.url).sort(), ['https://ex.com/a', 'https://ex.com/b'],
        'both tagged members present; the untagged article is not a member');
    // Article A carries BOTH its claims, joined by URL though neither
    // names the case; key-first ordering (c2 is_key) then oldest-first.
    assert.deepEqual(byUrl['https://ex.com/a'].claims.map((c) => c.id), ['c2', 'c1']);
    assert.equal(byUrl['https://ex.com/a'].claims[0].is_key, true);
    assert.deepEqual(byUrl['https://ex.com/b'].claims.map((c) => c.id), ['c3']);
    // The unit is keyed to the member's CURRENT hash, not any claim's.
    assert.equal(byUrl['https://ex.com/a'].article_hash, 'hashA');
    // The non-member article's claim never appears anywhere.
    assert.ok(!units.some((u) => u.claims.some((c) => c.id === 'cX')),
        'a claim from an untagged, non-member article stays out of the corpus');
});

test('case-synthesis: computeEntitySummary — canonical fold, per-claim dedup, type filter, dangling alias', () => {
    // p_alias → p (canonical person); o (org); c (case) and t (thing) must
    // be excluded; d is a DANGLING alias (its canonical target is absent),
    // so it resolves to itself and must still appear with its counts.
    const entitiesById = {
        p:       { id: 'p', name: 'Anthony Fauci', type: 'person' },
        p_alias: { id: 'p_alias', name: 'Dr. Fauci', type: 'person', canonical_id: 'p' },
        o:       { id: 'o', name: 'WIV', type: 'organization' },
        c:       { id: 'c', name: 'Origin of Covid', type: 'case' },
        t:       { id: 't', name: 'DEFUSE', type: 'thing' },
        d:       { id: 'd', name: 'Ghost', type: 'person', canonical_id: 'missing_target' }
    };
    const claimsById = {
        c1: { id: 'c1', about: ['p'] },
        c2: { id: 'c2', about: ['p_alias'] },              // alias → folds into p
        c3: { id: 'c3', about: ['p', 'p_alias'] },         // dedupe: counts once for p
        c4: { id: 'c4', about: ['o'] },
        c5: { id: 'c5', about: ['c'] },                    // case → excluded
        c6: { id: 'c6', about: ['d'] },                    // dangling alias → itself
        c7: { id: 'c7', about: ['unknown_id'] }            // no record → dropped
    };
    const memberByHash = {
        hashA: { entities: [{ id: 'p', type: 'person' }, { id: 'o', type: 'organization' }] },
        hashB: { entities: [{ id: 'p_alias', type: 'person' }] },  // alias tag folds to p
        hashC: { entities: [{ id: 'd', type: 'person' }] }
    };

    const { people, orgs } = CS.computeEntitySummary({ entitiesById, claimsById }, memberByHash);

    // People: Fauci (3 claims: c1+c2+c3, aliases folded, dedup) then Ghost (1).
    assert.deepEqual(people.map((e) => e.name), ['Anthony Fauci', 'Ghost'], 'people sorted by claim weight; dangling alias INCLUDED');
    const fauci = people.find((e) => e.name === 'Anthony Fauci');
    assert.equal(fauci.claimCount, 3, 'alias claims fold in and a dual-about claim counts once');
    assert.deepEqual(fauci.sourceHashes.slice().sort(), ['hashA', 'hashB'], 'alias source tag folds to canonical → 2 sources');
    const ghost = people.find((e) => e.name === 'Ghost');
    assert.equal(ghost.claimCount, 1, 'dangling-alias root keeps its folded count (the fixed predicate)');
    assert.deepEqual(ghost.sourceHashes, ['hashC']);

    // Orgs: only WIV. Cases, things, and unknown ids never surface.
    assert.deepEqual(orgs.map((e) => e.name), ['WIV']);
    assert.equal(orgs[0].claimCount, 1);
    const allNames = [...people, ...orgs].map((e) => e.name);
    assert.ok(!allNames.includes('Origin of Covid') && !allNames.includes('DEFUSE'), 'case/thing excluded');
    assert.ok(!people.some((e) => e.name === 'Dr. Fauci'), 'the alias never appears as its own entry');
});

test('case-synthesis: foldMemberAliases collapses same-hash captures to one entry with aliases — content hash is the ONLY key (P4/P9)', () => {
    const members = [
        { article_hash: 'H1', url: 'https://drive.google.com/file/d/abc123def456/view', title: 'Judge decision (view)' },
        { article_hash: 'H2', url: 'https://example.org/other', title: 'Other article' },
        { article_hash: 'H1', url: 'https://drive.google.com/uc?export=download&id=abc123def456', title: 'Judge decision (download)' }
    ];
    const folded = CS.foldMemberAliases(members);
    assert.equal(folded.size, 2, 'two distinct artifacts remain');
    const h1 = folded.get('H1');
    assert.equal(h1.member.url, 'https://drive.google.com/file/d/abc123def456/view', 'the FIRST capture (unit order) is canonical');
    assert.deepEqual(h1.aliases, [{ url: 'https://drive.google.com/uc?export=download&id=abc123def456', title: 'Judge decision (download)' }],
        'the re-capture folds in as an alias, not a member');
    assert.deepEqual(folded.get('H2').aliases, [], 'a singleton has no aliases');
    // No semantic/near-duplicate dedup: DIFFERENT hashes never merge,
    // whatever their URLs look like.
    const distinct = CS.foldMemberAliases([
        { article_hash: 'H3', url: 'https://example.org/a', title: 'A' },
        { article_hash: 'H4', url: 'https://example.org/a', title: 'A (recaptured, text changed)' }
    ]);
    assert.equal(distinct.size, 2, 'same URL with differing content stays two artifacts');
    // hashless/null units are skipped, never grouped together.
    assert.equal(CS.foldMemberAliases([{ url: 'https://x.example' }, null]).size, 0);
});

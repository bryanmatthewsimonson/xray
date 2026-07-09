// Case dossier tests — CD.1 (docs/CASE_DOSSIER_DESIGN.md §3.1–§3.5).
// Same chrome.storage.local shim pattern as case-export.test.mjs.
//
// `collectCaseDossierData` is storage-aware (seeded through the real
// models); `buildCaseDossier` + the per-section builders are pure and
// deterministic (generatedAt injected). The IDB-backed inputs
// (articles / predictions / resolutions / auditRuns) and `wire` are
// always INJECTED here, so no fake-indexeddb is needed. The
// load-bearing invariants: chain-head collapse, no case-level score,
// side-by-side variance (never merged), precision bands, and coverage
// counts on every section.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const _stateStore = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
                const out = {};
                for (const k of Array.isArray(keys) ? keys : [keys]) {
                    if (_stateStore.has(k)) out[k] = _stateStore.get(k);
                }
                cb(out);
            },
            set(obj, cb) {
                for (const [k, v] of Object.entries(obj)) _stateStore.set(k, v);
                cb && cb();
            },
            remove(keys, cb) {
                for (const k of Array.isArray(keys) ? keys : [keys]) _stateStore.delete(k);
                cb && cb();
            }
        }
    }
};

const {
    collectCaseDossierData, buildCaseDossier, assembleCaseDossier
} = await import('../src/shared/case-dossier.js');
const { EntityModel } = await import('../src/shared/entity-model.js');
const { ClaimModel } = await import('../src/shared/claim-model.js');
const { EvidenceLinker } = await import('../src/shared/evidence-linker.js');
const { TruthAdjudicationModel, VerdictModel } = await import('../src/shared/truth-adjudication-model.js');
const { IntegrityModel } = await import('../src/shared/integrity-model.js');
const { ForensicModel } = await import('../src/shared/forensic-model.js');
const { LocalKeyManager } = await import('../src/shared/local-key-manager.js');
const { buildClaimCoord } = await import('../src/shared/claim-ref.js');

function resetState() {
    _stateStore.clear();
    LocalKeyManager.keys.clear();
}

const PUBKEY_F = 'f'.repeat(64);
const GENERATED = '2026-06-10T12:00:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const ev = (quote, tier = 'tier-1') => [{ quote, tier, source_ref: { url: 'https://example.com/e' } }];

/**
 * One rich orbit: a case with a person + org; two "articles" of claims
 * (hashes A/B) about the case; a person-only (non-orbit) claim; an
 * event-fact proposition with a 2-verdict supersession chain; a
 * prediction proposition; a stated-commitment + integrity finding; a
 * 3-node contradiction cluster with a foreign endpoint; attestations
 * (two sharing an origin, one independent-with-note); a forensic
 * finding matched by label. Plus deliberate out-of-orbit noise.
 */
async function seedOrbit() {
    const kase = await EntityModel.create({ name: 'Origins case', type: 'case' });
    const person = await EntityModel.create({ name: 'Dr Ferran', type: 'person' });
    const org = await EntityModel.create({ name: 'Institute X', type: 'organization' });

    // Article A: two claims about the case; claim A1 also about the person.
    const a1 = await ClaimModel.create({
        text: 'The lab reported the sequence on 2019-12-30.',
        source_url: 'https://example.com/a', article_hash: HASH_A,
        about: [kase.id, person.id], source: person.id, is_key: true,
        quote: 'reported the sequence on 2019-12-30', anchor: [{ type: 'TextQuoteSelector', exact: 'x' }]
    });
    const a2 = await ClaimModel.create({
        text: 'The institute funded the work.',
        source_url: 'https://example.com/a', article_hash: HASH_A,
        about: [kase.id, org.id]
    });
    // Article B: one claim about the case.
    const b1 = await ClaimModel.create({
        text: 'No precursor was found in the market samples.',
        source_url: 'https://example.com/b', article_hash: HASH_B,
        about: [kase.id]
    });
    // Person-only claim: orbit ENTITY, but NOT an orbit claim (no case in about).
    await ClaimModel.create({
        text: 'Dr Ferran chairs the committee.',
        source_url: 'https://example.com/bio', about: [person.id]
    });

    // Event-fact proposition on a1, with a superseded verdict chain.
    const propEvent = await TruthAdjudicationModel.create({
        claim_id: a1.id, proposition_class: 'event-fact',
        resolution_criteria: { criteria: 'The lab log.' }, subject_role: 'enacted',
        occurred_at: Date.parse('2019-12-30T00:00:00Z') / 1000, occurred_precision: 'day'
    });
    const v1 = await VerdictModel.create({
        proposition_id: propEvent.id, verdict: 'unresolved',
        caveats: ['Awaiting the lab log.']
    });
    await VerdictModel.create({
        proposition_id: propEvent.id, supersedes: v1.id, verdict: 'established-true',
        evidence_for: ev('Lab log entry, 2019-12-30.'), caveats: ['Single log source.']
    });

    // Prediction proposition on b1 — headless (unadjudicated), year precision.
    const propPred = await TruthAdjudicationModel.create({
        claim_id: b1.id, proposition_class: 'prediction',
        resolution_criteria: { criteria: 'Follow-up sampling.', horizon: 'by 2027' },
        subject_role: 'stated', occurred_at: Date.parse('2020-01-01T00:00:00Z') / 1000,
        occurred_precision: 'year'
    });

    // Stated-commitment + deed → integrity finding on the person.
    const commit = await TruthAdjudicationModel.create({
        claim_id: a1.id, proposition_class: 'stated-commitment',
        resolution_criteria: { criteria: 'Public pledge.' }, subject_role: 'stated'
    });
    // Reuse a2 as the enacted deed (about includes org+case; person via a1).
    const deed = await TruthAdjudicationModel.create({
        claim_id: a2.id, proposition_class: 'event-fact',
        resolution_criteria: { criteria: 'Funding record.' }, subject_role: 'enacted',
        occurred_at: Date.parse('2020-02-01T00:00:00Z') / 1000, occurred_precision: 'day'
    });
    // The finding needs shared entities between word and deed; a1 (word)
    // is about person+case, a2 (deed) about org+case → shared = case.
    const finding = await IntegrityModel.create({
        word_proposition_id: commit.id, deed_proposition_ids: [deed.id],
        match: 'broken', evidence_for: ev('Pledge vs the funding record.'),
        caveats: ['One deed.'], gap: { cause: 'revision', note: 'Publicly revised.' }
    });

    // Contradiction cluster: a1 — a2 — foreign(coord), a 3-node knot.
    const foreignCoord = buildClaimCoord(PUBKEY_F, 'their-d');
    await EvidenceLinker.create({
        source_claim_id: a1.id, target_claim_id: a2.id, relationship: 'contradicts',
        note: 'Timeline vs funding conflict.'
    });
    await EvidenceLinker.create({
        source_claim_id: a2.id, target_claim_id: foreignCoord, relationship: 'contradicts',
        note: 'Institute denies funding.',
        target_snapshot: { url: 'https://example.com/denial', text: 'We funded nothing.' }
    });

    // Attestations (supports + attestation) targeting b1's proposition
    // claim: two share an origin (collapse), one independent-with-note.
    await EvidenceLinker.create({
        source_claim_id: a1.id, target_claim_id: b1.id, relationship: 'supports',
        attestation: { tier: 'tier-2', origin_key: 'ap-wire' }
    });
    await EvidenceLinker.create({
        source_claim_id: a2.id, target_claim_id: b1.id, relationship: 'supports',
        attestation: { tier: 'tier-2', origin_key: 'ap-wire' }
    });
    await EvidenceLinker.create({
        source_claim_id: foreignCoord, target_claim_id: b1.id, relationship: 'supports',
        source_snapshot: { url: 'https://example.com/reuters', text: 'Own reporting.' },
        attestation: { tier: 'tier-2', origin_key: 'reuters', independence_note: 'Own byline, not a pickup.' }
    });

    // Forensic finding on the person, matchable by label (name).
    await ForensicModel.create({
        subject_ref: { label: 'Dr Ferran' }, role: 'apologist',
        maneuver: 'defense/usefulness-pivot',
        anchors: [{ quote: 'It matters that the work was useful.', source_ref: { url: 'https://example.com/clip' } }],
        counter_note: 'May concede utility alongside the truth claim.', basis: 'quoted'
    });

    // ---- Noise that must NOT leak ----
    const noiseEntity = await EntityModel.create({ name: 'Unrelated', type: 'person' });
    await ClaimModel.create({ text: 'Unrelated claim.', source_url: 'https://example.com/z', about: [noiseEntity.id] });
    await EvidenceLinker.create({
        source_claim_id: 'claim_1111111111111111', target_claim_id: 'claim_2222222222222222',
        relationship: 'contradicts'
    });
    await ForensicModel.create({
        subject_ref: { label: 'Nobody' }, role: 'apologist', maneuver: 'defense/usefulness-pivot',
        anchors: [{ quote: 'Unrelated.', source_ref: { url: 'https://example.com/n' } }],
        counter_note: 'n/a', basis: 'quoted'
    });

    return { kase, person, org, a1, a2, b1, propEvent, propPred, commit, deed, finding, foreignCoord };
}

/** Injected article/audit/prediction fixtures scoped to hashes A/B.
 *  `caseId` tags the local-backlog article onto the case. */
function injected(caseId, over = {}) {
    return {
        articles: [
            { url: 'https://example.com/a', cachedAt: 1600000000, source: 'capture', publishedToRelay: true,
              article: { title: 'Article A', date: '2020-01-15',
                         evidence: { screenshot: 'data:...' }, entities: [] } },
            // Article B: URL-joined (no screenshot), no relay publish.
            { url: 'https://example.com/b', cachedAt: 1600000100, source: 'capture', publishedToRelay: false,
              article: { title: 'Article B', publishedTime: '2020', entities: [] } },
            // A tag-only local article: tagged to the case, zero orbit claims.
            { url: 'https://example.com/tagged', cachedAt: 1600000200, source: 'capture',
              article: { title: 'Tagged only', entities: [{ entity_id: caseId }] } }
        ],
        auditRuns: [
            { id: 'audit_a1', articleHash: HASH_A, runAt: 1600000000, auditor: { id: 'auditor1' },
              aggregate: { final_score: 72, confidence: 0.8 } },
            { id: 'audit_out', articleHash: 'c'.repeat(64), runAt: 1600000000, auditor: { id: 'auditor1' },
              aggregate: { final_score: 10, confidence: 0.9 } }
        ],
        predictions: [
            { id: 'pred_open', articleHash: HASH_B, text: 'Follow-up will find nothing.',
              hedge_level: 'confident', horizon_iso: '2027-01-01', resolution_status: 'open' },
            { id: 'pred_done', articleHash: HASH_A, text: 'The log will surface.',
              horizon_iso: '2021-01-01', resolution_status: 'resolved' },
            { id: 'pred_out', articleHash: 'c'.repeat(64), text: 'Out of orbit.', resolution_status: 'open' }
        ],
        resolutions: [
            { prediction_coord: '30058:x:pred_done', article_hash: HASH_A, outcome: 'true', resolved_at: 1610000000 }
        ],
        ...over
    };
}

async function assembleFixture(over = {}) {
    const seeded = await seedOrbit();
    const dossier = await assembleCaseDossier(seeded.kase.id, { generatedAt: GENERATED, ...injected(seeded.kase.id), ...over });
    return { ...seeded, dossier };
}

// ---------------------------------------------------------------------

test('case-dossier: rejects a missing or non-case entity', async () => {
    resetState();
    const { person } = await seedOrbit();
    await assert.rejects(() => collectCaseDossierData('entity_0000000000000000'), /Entity not found/);
    await assert.rejects(() => collectCaseDossierData(person.id), /is not a case/);
});

test('case-dossier: orbit derivation includes the walk and excludes noise', async () => {
    resetState();
    const { dossier, kase, person, org, a1, a2, b1 } = await assembleFixture();

    for (const id of [kase.id, person.id, org.id]) {
        assert.ok(dossier.orbit.entity_ids.includes(id), `orbit entity ${id}`);
    }
    assert.equal(dossier.orbit.entity_ids.some((id) => id.startsWith('entity_')) , true);
    // Orbit claims = the three about the case; the person-only + noise claims excluded.
    assert.deepEqual([...dossier.orbit.claim_ids].sort(), [a1.id, a2.id, b1.id].sort());
    assert.deepEqual(dossier.orbit.article_hashes, [HASH_A, HASH_B].sort());
    // The "Unrelated" noise entity never becomes an orbit entity.
    assert.equal(dossier.entities.rows.some((r) => r.name === 'Unrelated'), false);
});

test('case-dossier: shape of knowledge collapses chains to heads and counts the unadjudicated', async () => {
    resetState();
    const { dossier, propEvent, propPred } = await assembleFixture();
    const sk = dossier.shape_of_knowledge;

    const eventRow = sk.propositions.find((p) => p.proposition_id === propEvent.id);
    assert.equal(eventRow.verdict_head.verdict, 'established-true', 'the superseding head, not v1');
    assert.equal(eventRow.verdict_head.chain_length, 2);

    const predRow = sk.propositions.find((p) => p.proposition_id === propPred.id);
    assert.equal(predRow.verdict_head, null);

    // Distribution counts heads only; the headless prediction is unadjudicated.
    assert.equal(sk.distribution.by_state['established-true'], 1);
    assert.ok(sk.distribution.unadjudicated >= 1);
    assert.ok(Object.values(sk.distribution.by_standard).reduce((a, b) => a + b, 0) >= 1);
});

test('case-dossier: wire verdicts render side-by-side via verdictVariance, never merged', async () => {
    resetState();
    const { kase, propEvent } = await seedOrbit();
    // Inject a disagreeing wire verdict (camelCase spelling) on the same proposition.
    const built = await assembleCaseDossier(kase.id, {
        generatedAt: GENERATED, ...injected(kase.id),
        wire: { verdicts: [{ proposition_id: propEvent.id, verdict: 'contested', standardOfProof: 'preponderance' }] }
    });
    const row = built.shape_of_knowledge.propositions.find((p) => p.proposition_id === propEvent.id);
    assert.equal(row.variance.total, 2, 'local head + wire verdict');
    assert.equal(row.variance.unanimous, false);
    assert.equal(row.variance.by_state['established-true'], 1);
    assert.equal(row.variance.by_state['contested'], 1);
    // Distribution still counts the LOCAL head only.
    assert.equal(built.shape_of_knowledge.distribution.by_state['established-true'], 1);
    assert.equal(built.shape_of_knowledge.distribution.by_state['contested'], undefined);
    assert.equal('score' in row.variance, false);
});

test('case-dossier: prediction ledger scopes to orbit article hashes', async () => {
    resetState();
    const { dossier } = await assembleFixture();
    const preds = dossier.shape_of_knowledge.predictions;
    const ids = preds.entries.map((e) => e.id).sort();
    assert.deepEqual(ids, ['pred_done', 'pred_open'], 'out-of-orbit prediction excluded');
    assert.equal(preds.open, 1);
    assert.equal(preds.resolved, 1);
    const done = preds.entries.find((e) => e.id === 'pred_done');
    assert.equal(done.resolutions.length, 1);
    assert.equal(done.resolutions[0].outcome, 'true');
});

test('case-dossier: contradiction knot is a connected component with foreign snapshots', async () => {
    resetState();
    const { dossier, a1, a2, foreignCoord } = await assembleFixture();
    const clusters = dossier.knots.contradictions;
    assert.equal(clusters.length, 1, 'the noise pair is not in the orbit');
    const knot = clusters[0];
    assert.equal(knot.size, 3);
    assert.equal(knot.edges.length, 2);
    const refs = knot.nodes.map((n) => n.ref).sort();
    assert.deepEqual(refs, [a1.id, a2.id, foreignCoord].sort());
    const foreign = knot.nodes.find((n) => !n.local);
    assert.equal(foreign.ref, foreignCoord);
    assert.equal(foreign.text, 'We funded nothing.');
    assert.equal(foreign.url, 'https://example.com/denial');
});

test('case-dossier: integrity heads join by orbit entity; forensic bridge stamps matched_via', async () => {
    resetState();
    const { dossier, finding, deed } = await assembleFixture();
    const integ = dossier.knots.integrity;
    assert.equal(integ.length, 1);
    assert.equal(integ[0].finding_id, finding.id);
    assert.equal(integ[0].match, 'broken');
    // Earliest matched deed's world-time rides onto the finding.
    assert.equal(integ[0].occurred_at, Date.parse('2020-02-01T00:00:00Z') / 1000);
    assert.equal(integ[0].occurred_precision, 'day');

    const forensic = dossier.knots.forensic;
    assert.equal(forensic.length, 1, 'only the label-matched finding on the orbit person');
    assert.equal(forensic[0].matched_via, 'label');
    assert.equal(forensic[0].maneuver, 'defense/usefulness-pivot');
    // Entities with no bridge are counted, not silently dropped.
    assert.equal(typeof dossier.knots.coverage.entities_without_subject_bridge, 'number');
});

test('case-dossier: attestation convergence collapses shared origins', async () => {
    resetState();
    const { dossier, propPred } = await assembleFixture();
    const conv = dossier.evidence.by_proposition[propPred.id];
    assert.ok(conv, 'b1 proposition has attestations');
    assert.equal(conv.total_attestations, 3);
    assert.equal(conv.origin_count, 2, 'twelve-outlets-one-wire: ap-wire collapses to one origin');
    // The two ap-wire attestations collapse into a single origin group,
    // with its derivation (both link ids) on its face.
    const apWire = conv.origin_groups.find((g) => g.origin_key === 'ap-wire');
    assert.equal(apWire.link_ids.length, 2, 'two links, one origin group');
    assert.ok(conv.origin_groups.some((g) => g.origin_key === 'reuters'));
});

test('case-dossier: evidence rows carry capture completeness, raw audit aggregates, and the unprocessed bucket', async () => {
    resetState();
    const { dossier } = await assembleFixture();
    const arts = dossier.evidence.articles;
    const rowA = arts.find((a) => a.url === 'https://example.com/a');
    const rowB = arts.find((a) => a.url === 'https://example.com/b');
    assert.equal(rowA.capture.screenshot, true);
    assert.equal(rowA.capture.published_to_relay, true);
    assert.equal(rowB.capture.screenshot, false);
    // Audit aggregates join on hash ONLY, raw (no band classification here).
    assert.equal(rowA.audit_runs.length, 1);
    assert.equal(rowA.audit_runs[0].aggregate.final_score, 72);
    assert.equal(rowB.audit_runs.length, 0, 'no out-of-orbit or URL-advisory audit join');
    // Publication precision banded: article B's "2020" → year.
    assert.equal(rowB.published_precision, 'year');
    // The tag-only article is a visible backlog item.
    const unproc = dossier.evidence.unprocessed_sources;
    assert.ok(unproc.some((u) => u.url === 'https://example.com/tagged' && u.source === 'local-tag'));
});

test('case-dossier: timeline events are axis-tagged and precision-banded', async () => {
    resetState();
    const { dossier, propPred, propEvent } = await assembleFixture();
    const tl = dossier.timeline;
    const worldPred = tl.events.find((e) => e.axis === 'world' && e.ref === propPred.id);
    assert.equal(worldPred.precision, 'year', 'no false precision');
    // Both chain verdicts appear as judgment events (supersession visible).
    const verdictEvents = tl.events.filter((e) => e.kind === 'verdict');
    assert.equal(verdictEvents.length, 2);
    // Axes represented.
    assert.ok(tl.coverage.by_axis.world >= 1);
    assert.ok(tl.coverage.by_axis.publication >= 1);
    assert.ok(tl.coverage.by_axis.capture >= 1);
    assert.ok(tl.coverage.by_axis.judgment >= 1);
    // Events are sorted ascending by time.
    for (let i = 1; i < tl.events.length; i++) {
        assert.ok(tl.events[i].at >= tl.events[i - 1].at, 'ascending');
    }
    assert.equal(propEvent === undefined, false);
});

test('case-dossier: timeline gaps — the three cross-axis anomalies', async () => {
    resetState();
    const kase = await EntityModel.create({ name: 'Gap case', type: 'case' });
    const ts = (iso) => Math.floor(Date.parse(iso) / 1000);

    // Article X: published 2019-01, captured 2021-06 (late preservation),
    // and its proposition occurred 2020-06 — i.e. the source discussed
    // the event ~17 months BEFORE it happened.
    const cx = await ClaimModel.create({
        text: 'early source', source_url: 'https://ex.com/x',
        article_hash: 'd'.repeat(64), about: [kase.id]
    });
    const propX = await TruthAdjudicationModel.create({
        claim_id: cx.id, proposition_class: 'event-fact',
        resolution_criteria: { criteria: 'r' }, subject_role: 'enacted',
        occurred_at: ts('2020-06-01T00:00:00Z'), occurred_precision: 'day'
    });
    // Article Y: proposition occurred 2019-03, ruled unresolved then
    // superseded — the story changed after the event.
    const cy = await ClaimModel.create({
        text: 'ruling target', source_url: 'https://ex.com/y',
        article_hash: 'e'.repeat(64), about: [kase.id]
    });
    const propY = await TruthAdjudicationModel.create({
        claim_id: cy.id, proposition_class: 'event-fact',
        resolution_criteria: { criteria: 'r' }, subject_role: 'enacted',
        occurred_at: ts('2019-03-01T00:00:00Z'), occurred_precision: 'day'
    });
    const vy1 = await VerdictModel.create({ proposition_id: propY.id, verdict: 'unresolved', caveats: ['w'] });
    await VerdictModel.create({
        proposition_id: propY.id, supersedes: vy1.id, verdict: 'established-true',
        evidence_for: ev('later evidence'), caveats: ['s']
    });

    const articles = [
        { url: 'https://ex.com/x', cachedAt: ts('2021-06-01T00:00:00Z'), source: 'capture',
          article: { title: 'X', date: '2019-01-01', entities: [] } },
        { url: 'https://ex.com/y', cachedAt: ts('2019-04-01T00:00:00Z'), source: 'capture',
          article: { title: 'Y', date: '2019-03-15', entities: [] } }
    ];
    const dossier = await assembleCaseDossier(kase.id, { generatedAt: GENERATED, articles, auditRuns: [], predictions: [], resolutions: [] });
    const gaps = dossier.timeline.gaps;
    const kinds = gaps.map((g) => g.kind);
    assert.ok(kinds.includes('published-before-occurred'));
    assert.ok(kinds.includes('capture-long-after-publication'));
    assert.ok(kinds.includes('story-changed-after-event'));

    const pbo = gaps.find((g) => g.kind === 'published-before-occurred');
    assert.equal(pbo.proposition_id, propX.id);
    assert.equal(pbo.article_url, 'https://ex.com/x');
    assert.ok(pbo.lead_seconds > 0);
    const late = gaps.find((g) => g.kind === 'capture-long-after-publication');
    assert.ok(late.lag_seconds > 365 * 86400);
    const changed = gaps.find((g) => g.kind === 'story-changed-after-event');
    assert.equal(changed.proposition_id, propY.id);
    assert.equal(changed.chain_length, 2);

    // Coverage counts the gaps; Y's publication is AFTER its occurrence
    // so it is not a false published-before-occurred.
    assert.equal(dossier.timeline.coverage.gaps, gaps.length);
    assert.equal(gaps.filter((g) => g.kind === 'published-before-occurred' && g.proposition_id === propY.id).length, 0);
});

test('case-dossier: coverage counts on every section', async () => {
    resetState();
    const { dossier } = await assembleFixture();
    assert.equal(dossier.coverage.claims, 3);
    // a1 (event-fact + commitment), a2 (deed), b1 (prediction) all carry propositions.
    assert.equal(dossier.coverage.claims_with_propositions, 3);
    assert.ok(dossier.coverage.propositions >= 4);
    assert.ok('coverage' in dossier.shape_of_knowledge);
    assert.ok('coverage' in dossier.knots);
    assert.ok('coverage' in dossier.timeline);
    assert.ok('coverage' in dossier.evidence);
    assert.ok('coverage' in dossier.entities);
    assert.equal(dossier.evidence.coverage.articles, 2);
    assert.equal(dossier.evidence.coverage.articles_with_audit, 1);
});

test('case-dossier: no case-level score exists anywhere', async () => {
    resetState();
    const { dossier } = await assembleFixture();
    const banned = /score|mean|rating|strength|grade/i;
    const walk = (node, path) => {
        if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
        if (node && typeof node === 'object') {
            for (const [k, v] of Object.entries(node)) {
                const p = `${path}.${k}`;
                // The ONLY permitted score-bearing subtree: raw per-article
                // audit aggregates (never rolled up).
                if (/\.audit_runs\[\d+\]\.aggregate$/.test(p)) continue;
                if (banned.test(k)) {
                    assert.fail(`forbidden fused-number key at ${p}`);
                }
                walk(v, p);
            }
        }
    };
    walk(dossier, '$');
    assert.equal(dossier.score, undefined);
    assert.equal('mean' in dossier.shape_of_knowledge.distribution, false);
});

test('case-dossier: deterministic — same inputs deepEqual, generatedAt injected', async () => {
    resetState();
    const { kase } = await seedOrbit();
    const opts = { generatedAt: GENERATED, ...injected() };
    const first = await assembleCaseDossier(kase.id, opts);
    const second = await assembleCaseDossier(kase.id, opts);
    assert.deepEqual(first, second);
    assert.equal(first.generated_at, GENERATED);
    // Pure re-build over the same collected data is also stable.
    const data = await collectCaseDossierData(kase.id, injected());
    assert.deepEqual(buildCaseDossier(data, GENERATED), buildCaseDossier(data, GENERATED));
});

test('case-dossier: empty orbit — a bare case yields zero-count sections, not errors', async () => {
    resetState();
    const kase = await EntityModel.create({ name: 'Empty case', type: 'case' });
    const dossier = await assembleCaseDossier(kase.id, { generatedAt: GENERATED, articles: [], auditRuns: [], predictions: [], resolutions: [] });
    assert.equal(dossier.coverage.claims, 0);
    assert.equal(dossier.coverage.propositions, 0);
    assert.deepEqual(dossier.shape_of_knowledge.propositions, []);
    assert.deepEqual(dossier.knots.contradictions, []);
    assert.deepEqual(dossier.timeline.events, []);
    assert.deepEqual(dossier.evidence.articles, []);
    assert.deepEqual(dossier.entities.rows, []);
});

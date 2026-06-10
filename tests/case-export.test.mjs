// Case export tests — Phase 11.6 (docs/ASSESSMENTS_DESIGN.md).
// Same chrome.storage.local shim pattern as entity-model.test.mjs.
//
// collectCaseData is storage-aware (seeded through the real models);
// the JSON/Markdown builders are pure — generatedAt is injected, so
// outputs are fully deterministic.

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

const { collectCaseData, buildCaseJson, buildCaseMarkdown } =
    await import('../src/shared/case-export.js');
const { EntityModel } = await import('../src/shared/entity-model.js');
const { ClaimModel } = await import('../src/shared/claim-model.js');
const { AssessmentModel } = await import('../src/shared/assessment-model.js');
const { EvidenceLinker } = await import('../src/shared/evidence-linker.js');
const { LocalKeyManager } = await import('../src/shared/local-key-manager.js');
const { buildClaimCoord } = await import('../src/shared/claim-ref.js');

function resetState() {
    _stateStore.clear();
    LocalKeyManager.keys.clear();
}

const PUBKEY_B = 'b'.repeat(64);
const GENERATED = '2026-06-10T12:00:00.000Z';

/** One full case fixture: entity, two local claims, a foreign claim,
 *  assessments, and a cross-source contradiction. */
async function seedCase() {
    const caseEntity = await EntityModel.create({ name: 'Bricks & Minifigs scandal', type: 'case' });

    const claimA = await ClaimModel.create({
        text: 'The new owners illegally retained the consigned collection.',
        source_url: 'https://example.com/video-1',
        about: [caseEntity.id],
        is_key: true
    });
    const claimB = await ClaimModel.create({
        text: 'The collection was worth $200,000.',
        source_url: 'https://example.com/video-2',
        about: [caseEntity.id]
    });

    await AssessmentModel.create({
        claim_ref: { claim_id: claimA.id },
        stance: 1,
        labels: [{ label: 'unsupported', note: 'needs the consignment contract' }],
        rationale: 'Schneider shows paperwork but not the contract terms.'
    });
    await AssessmentModel.create({
        claim_ref: { claim_id: claimB.id },
        stance: null,
        labels: ['unsupported']
    });

    // Cross-source contradiction: local claim A vs a foreign statement.
    const foreignCoord = buildClaimCoord(PUBKEY_B, 'their-claim-d');
    await EvidenceLinker.create({
        source_claim_id: claimA.id,
        target_claim_id: foreignCoord,
        relationship: 'contradicts',
        note: 'Closure framed as mutual vs illegal retention.',
        target_snapshot: {
            url: 'https://example.com/corp-statement',
            text: 'We parted ways by mutual agreement.'
        }
    });
    // Assess the foreign endpoint too (label-only).
    await AssessmentModel.create({
        claim_ref: { coord: foreignCoord, url: 'https://example.com/corp-statement', text: 'We parted ways by mutual agreement.' },
        labels: ['euphemism', 'misleading']
    });

    // Noise that must NOT leak into the export: a claim about nobody,
    // and a supports link between unrelated fake ids.
    await ClaimModel.create({ text: 'Unrelated claim.', source_url: 'https://example.com/other' });
    await EvidenceLinker.create({
        source_claim_id: 'claim_eeeeeeeeeeeeeeee',
        target_claim_id: 'claim_ffffffffffffffff',
        relationship: 'supports'
    });

    return { caseEntity, claimA, claimB, foreignCoord };
}

// ---------------------------------------------------------------------

test('case-export: collectCaseData gathers the deterministic content set', async () => {
    resetState();
    const { caseEntity, claimA, claimB, foreignCoord } = await seedCase();

    const data = await collectCaseData(caseEntity.id);

    assert.equal(data.case.name, 'Bricks & Minifigs scandal');
    assert.equal(data.case.type, 'case');
    assert.match(data.case.pubkey, /^[0-9a-f]{64}$/);

    // Local claims about the case + the contradiction's foreign endpoint.
    assert.equal(data.claims.length, 3);
    const byOrigin = (o) => data.claims.filter((c) => c.origin === o);
    assert.equal(byOrigin('local').length, 2);
    assert.equal(byOrigin('foreign').length, 1);

    const localA = data.claims.find((c) => c.ref.claim_id === claimA.id);
    assert.equal(localA.is_key, true);
    assert.deepEqual(localA.about, ['Bricks & Minifigs scandal']);
    assert.equal(localA.assessment.stance, 1);
    assert.equal(localA.assessment.stance_label, 'Agree');
    assert.equal(localA.assessment.labels[0].label, 'unsupported');
    assert.equal(localA.assessment.labels[0].note, 'needs the consignment contract');

    const localB = data.claims.find((c) => c.ref.claim_id === claimB.id);
    assert.equal(localB.assessment.stance, null, 'label-only assessment exports');

    const foreign = byOrigin('foreign')[0];
    assert.equal(foreign.ref.coord, foreignCoord);
    assert.equal(foreign.ref.author_pubkey, PUBKEY_B, 'snapshot author rides into the ref');
    assert.equal(foreign.text, 'We parted ways by mutual agreement.');
    assert.deepEqual(foreign.assessment.labels.map((l) => l.label), ['euphemism', 'misleading']);

    // One contradiction, endpoint snapshots embedded — no dangling refs.
    assert.equal(data.contradictions.length, 1);
    const x = data.contradictions[0];
    assert.equal(x.note, 'Closure framed as mutual vs illegal retention.');
    const texts = [x.source.text, x.target.text];
    assert.ok(texts.includes('The new owners illegally retained the consigned collection.'));
    assert.ok(texts.includes('We parted ways by mutual agreement.'));

    // Label tally across everything included.
    assert.deepEqual(data.label_counts, { unsupported: 2, euphemism: 1, misleading: 1 });

    await assert.rejects(() => collectCaseData('entity_0000000000000000'), /Entity not found/);
});

test('case-export: buildCaseJson is deterministic and machine-readable', async () => {
    resetState();
    const { caseEntity } = await seedCase();
    const data = await collectCaseData(caseEntity.id);

    const json = buildCaseJson(data, GENERATED);
    const again = buildCaseJson(await collectCaseData(caseEntity.id), GENERATED);
    assert.equal(json, again, 'same case + same timestamp → byte-identical export');

    const parsed = JSON.parse(json);
    assert.equal(parsed.generated_at, GENERATED);
    assert.equal(parsed.generator, 'xray');
    assert.equal(parsed.claims.length, 3);
    assert.equal(parsed.contradictions.length, 1);
    // Per-label provenance survives into the machine-readable file.
    const labeled = parsed.claims.find((c) => c.origin === 'foreign');
    assert.equal(labeled.assessment.labels[0].suggested_by, 'user');
});

test('case-export: buildCaseMarkdown groups by stance and pairs the contradiction', async () => {
    resetState();
    const { caseEntity } = await seedCase();
    const md = buildCaseMarkdown(await collectCaseData(caseEntity.id), GENERATED);

    assert.ok(md.startsWith('# Case: Bricks & Minifigs scandal'));
    assert.ok(md.includes('### Agree (1)'), 'stance group heading');
    assert.ok(md.includes('### No stance recorded'), 'label-only assessments group under No stance');
    assert.ok(md.includes('> The new owners illegally retained the consigned collection.'));
    assert.ok(md.includes('**unsupported** — needs the consignment contract'));
    assert.ok(md.includes('## Inconsistencies'));
    assert.ok(md.includes('**⚔ contradicts**'));
    assert.ok(md.includes('“We parted ways by mutual agreement.”'));
    assert.ok(md.includes('## Label tally'));
    assert.ok(md.includes('- 2× unsupported'));
});

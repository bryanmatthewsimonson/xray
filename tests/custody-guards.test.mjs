// CW.5 — the custody rule, machine-checked (TEAM_CASE_DESIGN §2.1,
// normative): a case entity's key signs EXACTLY two things — its own
// kind-0 profile and its 32125 entity↔article relations. It NEVER
// signs judgment kinds (30054, 30056–30061, 30062, 30063, 30064).
// These guards mirror the Phase-16 "30066 stays free" idiom:
// functional refusals at the pure builders + source-grep pins over
// the signing call sites. (The 30067 fact sheet this file once also
// guarded retired 2026-07-20 with the fact layer — the retirement
// itself is pinned in tests/fact-retirement.test.mjs.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { buildProfileAbout } = await import('../src/shared/entity-profile.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function caseDossier() {
    return {
        subject: { id: 'entity_' + '1'.repeat(16), name: 'Origin of Covid', type: 'case',
                   description: 'The investigation workspace.', foreign: false },
        identity: { family: [], external_ids: [], accounts: [], equivalence_pubkeys: [], mentions: [] }
    };
}

test('custody: the kind-0 profile REMAINS allowed for a case (one of the two permitted kinds)', () => {
    // buildProfileAbout is the kind-0 content assembler — a case must
    // keep publishing its profile; only judgment/index kinds are barred.
    const about = buildProfileAbout(caseDossier(), {});
    assert.equal(typeof about, 'string');
    assert.ok(about.length > 0);
});

test('custody: buildMentionNoteEvent REFUSES a case-typed entity (E4 — a case key never signs kind-1)', async () => {
    const { buildMentionNoteEvent } = await import('../src/shared/mention-notes.js');
    assert.throws(() => buildMentionNoteEvent({
        entityPubkey: 'a'.repeat(64), entityType: 'case',
        publisherPubkey: 'b'.repeat(64), articleTitle: 'T', articleUrl: 'https://x/a'
    }), /custody rule/);
    const ok = buildMentionNoteEvent({
        entityPubkey: 'a'.repeat(64), entityType: 'person',
        publisherPubkey: 'b'.repeat(64), articleTitle: 'T', articleUrl: 'https://x/a'
    });
    assert.equal(ok.kind, 1);
});

test('custody: entity-key signing sites in src/ are pinned — a new one must confront this rule', async () => {
    // Every LocalKeyManager.signEvent call site signs with an ENTITY
    // key. A new call site fails this pin so its author must check
    // TEAM_CASE_DESIGN §2.1 before widening what entity keys sign.
    // The allowlist, with per-file counts. Reader: 2× kind-0 profile +
    // 1× E4 mention note (buildMentionNoteEvent throws /custody rule/
    // on a case-typed entity — guarded above — and the reader's target
    // loop skips case roots besides). Portal entity-dossier view: 1×
    // (the kind-0 republish).
    const ALLOWED = {
        'src/reader/index.js': 3,
        'src/portal/entity-dossier-view.js': 1
    };
    async function walk(dir) {
        const out = [];
        for (const e of await readdir(join(ROOT, dir), { withFileTypes: true })) {
            const p = `${dir}/${e.name}`;
            if (e.isDirectory()) out.push(...await walk(p));
            else if (e.name.endsWith('.js')) out.push(p);
        }
        return out;
    }
    for (const file of await walk('src')) {
        if (file === 'src/shared/local-key-manager.js') continue;   // the definition itself
        const body = await readFile(join(ROOT, file), 'utf8');
        const count = (body.match(/LocalKeyManager\.signEvent\(/g) || []).length;
        assert.equal(count, ALLOWED[file] || 0,
            `${file}: ${count} entity-key signing site(s), expected ${ALLOWED[file] || 0} — a new site must confront the custody rule (TEAM_CASE_DESIGN §2.1) before joining this allowlist`);
    }
});

test('custody: judgment publish modules never touch entity keys', async () => {
    // 30054/30055/30056–61/30062/30063/30064 are all signed by the
    // USER (Signer); none of their publish/build modules may import
    // the entity keystore.
    const judgmentModules = [
        'src/shared/assessment-publish.js',
        'src/shared/truth-publish.js',
        'src/shared/forensic-publish.js',
        'src/shared/truth-builders.js',
        'src/shared/metadata/builders.js',
        'src/shared/audit/publish-batch.js'
    ];
    for (const file of judgmentModules) {
        const body = await readFile(join(ROOT, file), 'utf8');
        assert.ok(!/local-key-manager/.test(body),
            `${file} imports the entity keystore — judgment kinds are user-signed only`);
    }
});

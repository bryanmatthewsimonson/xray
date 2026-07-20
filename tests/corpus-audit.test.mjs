// Corpus audit plan tests — CA.1 (docs/CORPUS_AUDIT_KICKOFF.md).
//
// The pins that matter: the plan computes the EXACT auditable text +
// hash the reader's audit buttons compute (same pipeline), the runs
// join honors BOTH the slice hash and the captureArticleHash alias
// (P9 — never re-run what's paid for), and the draft store shares the
// reader's literal storage keys so runs resume across surfaces.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const _store = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
                const out = {};
                for (const k of Array.isArray(keys) ? keys : [keys]) {
                    if (_store.has(k)) out[k] = _store.get(k);
                }
                cb(out);
            },
            set(obj, cb) { for (const [k, v] of Object.entries(obj)) _store.set(k, v); cb && cb(); },
            remove(keys, cb) { for (const k of Array.isArray(keys) ? keys : [keys]) _store.delete(k); cb && cb(); }
        }
    }
};

const {
    planCorpusAudit, memberAuditMetadata, AUDIT_DRAFT_PREFIX,
    loadAuditDraft, appendAuditDraft, clearAuditDraft
} = await import('../src/shared/audit/corpus-audit.js');
const { auditableSlice } = await import('../src/shared/audit/assemble.js');
const { articleHash } = await import('../src/shared/audit/article-hash.js');
const { EventBuilder } = await import('../src/shared/event-builder.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function rec(url, body, extra = {}) {
    return {
        url,
        article: {
            url, title: `T ${url}`, content: body, _contentIsMarkdown: true,
            author: 'A', date: '2026-01-01'
        },
        ...extra
    };
}

test('CA.1: the plan hashes the SAME auditable text the reader would, and splits pending/audited/skipped', async () => {
    const a = rec('https://x/a', 'Body of A.');
    const b = rec('https://x/b', 'Body of B.');
    const empty = { url: 'https://x/empty', article: { title: 'E', content: '' } };

    // What the reader would compute for A:
    const readerHash = await articleHash(auditableSlice(EventBuilder.assembleArticleBody(a.article)).text);

    const plan = await planCorpusAudit({
        records: [a, b, empty, null],
        runs: [{ articleHash: readerHash }]   // A already audited under the reader's key
    });
    assert.equal(plan.audited.length, 1);
    assert.equal(plan.audited[0].url, 'https://x/a');
    assert.equal(plan.audited[0].localHash, readerHash, 'byte-identical hash pipeline');
    assert.equal(plan.pending.length, 1);
    assert.equal(plan.pending[0].url, 'https://x/b');
    assert.equal(plan.pending[0].truncated, false);
    assert.ok(plan.pending[0].markdown.includes('Body of B.'));
    assert.deepEqual(plan.pending[0].metadata, {
        url: 'https://x/b', headline: 'T https://x/b', byline: 'A', publication_date: '2026-01-01'
    });
    assert.deepEqual(plan.skipped, [{ url: 'https://x/empty', why: 'no auditable text' }]);
});

test('CA.1: the captureArticleHash alias joins — a truncated-capture run is never re-run', async () => {
    const a = rec('https://x/a', 'Body of A.', { articleHash: 'c'.repeat(64) });
    // The ledger holds a run keyed to some slice hash, with the capture
    // hash as its alias (import.js semantics).
    const viaAlias = await planCorpusAudit({
        records: [a],
        runs: [{ articleHash: 'f'.repeat(64), captureArticleHash: 'c'.repeat(64) }]
    });
    assert.equal(viaAlias.audited.length, 1, 'joined via the alias');
    // And the record's own capture hash matches a run keyed directly to it.
    const viaCapture = await planCorpusAudit({
        records: [a], runs: [{ articleHash: 'c'.repeat(64) }]
    });
    assert.equal(viaCapture.audited.length, 1, 'joined via the capture hash');
});

test('CA.1: the draft store uses the reader\'s LITERAL keys — cross-surface resume can never fork', async () => {
    // The contract pin: the reader's source carries the same prefix.
    const readerSrc = await readFile(join(ROOT, 'src/reader/index.js'), 'utf8');
    assert.ok(readerSrc.includes(`AUDIT_DRAFT_PREFIX = '${AUDIT_DRAFT_PREFIX}'`),
        'the reader and corpus-audit.js must share one draft prefix');

    _store.clear();
    const h = 'a'.repeat(64);
    assert.equal(await loadAuditDraft(h), null);
    await appendAuditDraft(h, 'headline_body_fidelity', { findings: [] }, 'model-x');
    await appendAuditDraft(h, 'source_architecture', { findings: [] });
    const draft = await loadAuditDraft(h);
    assert.deepEqual(Object.keys(draft.modules).sort(), ['headline_body_fidelity', 'source_architecture']);
    assert.equal(draft.model, 'model-x');
    assert.ok(_store.has(AUDIT_DRAFT_PREFIX + h), 'stored under the shared key');
    await clearAuditDraft(h);
    assert.equal(await loadAuditDraft(h), null);
});

test('CA.1: memberAuditMetadata degrades honestly on sparse records', () => {
    assert.deepEqual(memberAuditMetadata({ url: 'https://x/a', article: {} }), {
        url: 'https://x/a', headline: null, byline: null, publication_date: null
    });
});

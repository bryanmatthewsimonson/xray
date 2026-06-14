// Phase 13.1 — canonical article hash.
//
// The load-bearing test: normalizeForHash must be byte-identical to
// the VENDORED scorer's normalizeMarkdown (docs/auditor-prototype/
// scorer/scorer.js). We extract that function from the vendored
// source at test time and run both over a hostile corpus — the
// extension and the CLI can never drift without this failing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import { normalizeForHash, articleHash, stripMetadataHeader } from '../src/shared/audit/article-hash.js';

const scorerSource = await readFile(
    new URL('../docs/auditor-prototype/scorer/scorer.js', import.meta.url), 'utf8');

const match = scorerSource.match(/function normalizeMarkdown\(md\) \{\n([\s\S]*?)\n\}/);
assert.ok(match, 'vendored scorer must contain normalizeMarkdown — if this fails, the vendored source moved');
// eslint-disable-next-line no-new-func
const vendoredNormalize = new Function('md', match[1]);

const CORPUS = [
    '',
    'plain text',
    'line one\nline two',
    'crlf line\r\nanother\r\n',
    'trailing spaces   \nand tabs\t\t\nmixed \t \n',
    'one\n\n\n\n\nfive blank-collapsed\n\n\ndone',
    '\n\nleading blanks preserved\ntext',
    'trailing whitespace at end\n\n\n   \t\n',
    '# Heading\n\nParagraph with **bold** and [link](https://x.example).\n\n- item\n- item\n',
    'unicode — em-dash, naïve café, 日本語テキスト, 🎯 emoji\n',
    'inner   spaces   preserved\nbut not at eol   \n',
    'lone\rcarriage return survives',          // \r without \n is NOT normalized — pinned
    '```\ncode  block  \n\n\n\ninside fences collapses too\n```\n',
    'a'.repeat(10000) + '  \n' + 'b'.repeat(10000) + '\n\n\n\n' + 'c',
    // Whitespace-class discriminators: these inputs distinguish the
    // spec's [ \t]+$ per-line strip from a too-eager \s+$ — NBSP,
    // U+2028/U+2029, and ideographic space at EOL must SURVIVE the
    // per-line strip (Turndown output from captured HTML really
    // contains NBSP).
    'nbsp at eol\u00a0\nnext line',
    'line sep at eol\u2028\nnext',
    'para sep at eol\u2029\nnext',
    'ideographic space\u3000\nnext',
    'cr then space\r \nnext',
    // End-of-input discriminators for the final \s+$ strip (which IS
    // \s-classed and eats all of these at end of input).
    'ends with bare cr\r',
    'ends with space ',
    'ends with nbsp\u00a0'
];

test('normalizeForHash matches the vendored scorer normalizeMarkdown over the corpus', () => {
    for (const input of CORPUS) {
        assert.equal(normalizeForHash(input), vendoredNormalize(input),
            `divergence on input: ${JSON.stringify(input.slice(0, 60))}`);
    }
});

test('normalizeForHash: ONE pass is the spec — and it is not idempotent, pinned', () => {
    // The canonical hash is defined over exactly one normalization
    // pass (both the extension and the vendored CLI do one). The
    // algorithm itself is NOT idempotent: stripping the trailing
    // space in "\r \n" manufactures a new "\r\n" pair that a second
    // pass would collapse. Pin the counterexample so nobody "fixes"
    // either side unilaterally — changing the normalization is a
    // methodology change (new hashes), not a refactor.
    const pathological = 'cr then space\r \nnext';
    const once = normalizeForHash(pathological);
    assert.equal(once, 'cr then space\r\nnext');
    assert.notEqual(normalizeForHash(once), once, 'second pass collapses the manufactured CRLF');
    assert.equal(once, vendoredNormalize(pathological), 'parity, not idempotence, is the contract');

    // Everything without that interaction IS stable under a second pass.
    for (const input of CORPUS) {
        if (input.includes('\r ')) continue;
        const normalized = normalizeForHash(input);
        assert.equal(normalizeForHash(normalized), normalized,
            `unexpected non-idempotence on: ${JSON.stringify(input.slice(0, 40))}`);
    }
});

test('articleHash equals node:crypto SHA-256 of the normalized UTF-8 bytes', async () => {
    for (const input of CORPUS) {
        const expected = createHash('sha256')
            .update(normalizeForHash(input), 'utf8').digest('hex');
        assert.equal(await articleHash(input), expected);
    }
});

test('articleHash is stable across capture-formatting noise', async () => {
    const a = await articleHash('Body text.\nSecond line.\n');
    const b = await articleHash('Body text.   \r\nSecond line.\n\n\n');
    assert.equal(a, b, 'CRLF/trailing-ws/blank-run noise must not change the hash');
});

test('articleHash differs on real content change', async () => {
    const a = await articleHash('The minister said yes.');
    const b = await articleHash('The minister said no.');
    assert.notEqual(a, b);
});

test('stripMetadataHeader removes exactly the published header block', () => {
    const content = '---\n**Source**: [T](https://e.x)\n**Archived**: June 11, 2026\n---\n\nBody starts here.\n';
    assert.equal(stripMetadataHeader(content), 'Body starts here.\n');
    // No header → unchanged (local captures hash the body directly).
    assert.equal(stripMetadataHeader('No header at all.'), 'No header at all.');
    // Header strip + hash: the Archived date must not affect the hash.
    const v1 = stripMetadataHeader('---\n**Archived**: June 11, 2026\n---\n\nSame body.');
    const v2 = stripMetadataHeader('---\n**Archived**: June 12, 2026\n---\n\nSame body.');
    assert.equal(v1, v2);
});

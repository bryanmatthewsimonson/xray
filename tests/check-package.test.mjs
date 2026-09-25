// Packaged-contents assertion — pins scripts/check-package.mjs against
// RESET_PLAN §7 R0 ("a packaged-contents assertion … also names what must
// be *in* the zip: pdf.js's cmaps, standard fonts and wasm under dist/")
// and ROAD_TO_1_0 B7/T4. The closed-world classifier on synthetic
// listings (required / allowed / known leak / never / unclassified /
// stale), the dependency-free zip reader on a synthetic zip, the
// derivations on the real tree, and the CLI end to end on a synthetic
// zip holding exactly what the tree requires — green, then red when a
// required pdf.js dir or a never-ship path changes.
//
// Provenance: INTERPRETATION (2026-09-25) — an agent artifact under
// RESET_PLAN R0; the maintainer has not ruled on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import {
    globToRegExp, listZip, readZipEntry, manifestRefs, htmlRefs, getUrlRefs, pdfMirror, checkPackage, deriveRequired,
    PDF_ASSET_DIRS, PDF_KNOWN_FILES, NEVER, KNOWN_LEAKS, ALLOWED, ALWAYS_REQUIRED
} from '../scripts/check-package.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'check-package.mjs');

/** A minimal zip writer: stored or deflated entries, a directory record, an optional archive comment. */
function makeZip(files, comment = '') {
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
        const name = Buffer.from(f.name);
        const raw = Buffer.from(f.data ?? '');
        const data = f.deflate ? deflateRawSync(raw) : raw;
        const method = f.deflate ? 8 : 0;
        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8);
        lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
        parts.push(lh, name, data);
        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
        ch.writeUInt16LE(method, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24);
        ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
        central.push(ch, name);
        offset += 30 + name.length + data.length;
    }
    const cd = Buffer.concat(central);
    const c = Buffer.from(comment);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(c.length, 20);
    return Buffer.concat([...parts, cd, eocd, c]);
}

/** A concrete path each glob matches — '**' and '*' become one segment named x. */
const sampleOf = (glob) => glob.replace(/\*\*/g, 'x').replace(/\*/g, 'x');

// A small synthetic package: two required files, one required dir, one allowed, one known leak.
const REQ = ['manifest.json', 'dist/a.bundle.js'];
const DIRS = ['dist/cmaps'];
const LEAKS = [{ glob: 'tests/**', why: 't' }];
const OK_ENTRIES = [
    { name: 'manifest.json', size: 10 }, { name: 'dist/', size: 0, dir: true }, { name: 'dist/a.bundle.js', size: 5 },
    { name: 'dist/cmaps/X.bcmap', size: 3 }, { name: 'README.md', size: 1 }, { name: 'tests/t.test.mjs', size: 2 }
];
const run = (entries, extra = {}) => checkPackage({ entries, required: REQ, requiredDirs: DIRS, knownLeaks: LEAKS, ...extra });

// ------------------------------------------------------------ classifier

test('checkPackage: a complete synthetic package is green and counts its known leaks', () => {
    const { errors, leakCounts, files } = run(OK_ENTRIES);
    assert.deepEqual(errors, []);
    assert.equal(leakCounts.get('tests/**'), 1);
    assert.equal(files, 5, 'directory records are not files');
});

test('checkPackage: dropping one required file from the listing is red (MISSING)', () => {
    const { errors } = run(OK_ENTRIES.filter((e) => e.name !== 'dist/a.bundle.js'));
    assert.deepEqual(errors, ['MISSING  dist/a.bundle.js — required, not in the package']);
});

test('checkPackage: a zero-byte required file is red (EMPTY)', () => {
    const { errors } = run(OK_ENTRIES.map((e) => (e.name === 'dist/a.bundle.js' ? { ...e, size: 0 } : e)));
    assert.deepEqual(errors, ['EMPTY    dist/a.bundle.js — required, but zero bytes']);
});

test('checkPackage: a required directory with no non-empty file is red — the pdf.js assets case', () => {
    const noCmaps = run(OK_ENTRIES.filter((e) => !e.name.startsWith('dist/cmaps/')));
    assert.deepEqual(noCmaps.errors, ['MISSING  dist/cmaps/ — required directory is absent or holds no non-empty file']);
    const emptyCmaps = run(OK_ENTRIES.map((e) => (e.name === 'dist/cmaps/X.bcmap' ? { ...e, size: 0 } : e)));
    assert.equal(emptyCmaps.errors.length, 1);
});

test('checkPackage: a file nothing requires and no list names is red (UNCLASSIFIED)', () => {
    const { errors } = run([...OK_ENTRIES, { name: 'eslint.config.mjs', size: 9 }]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^UNCLASSIFIED eslint\.config\.mjs .*webExt\.ignoreFiles/);
});

test('checkPackage: a known leak that matches nothing is STALE — the list only shrinks', () => {
    const { errors } = run(OK_ENTRIES.filter((e) => !e.name.startsWith('tests/')));
    assert.deepEqual(errors, ["STALE    known leak 'tests/**' matches nothing in the package — delete it from KNOWN_LEAKS (the list only shrinks)"]);
});

test('checkPackage: NEVER entries are red even when a known leak would cover them', () => {
    const { errors } = run([...OK_ENTRIES, { name: 'node_modules/', size: 0, dir: true }, { name: 'node_modules/x/i.js', size: 1 },
        { name: '.github/workflows/ci.yml', size: 1 }, { name: 'companion/transcriber/server.py', size: 1 }],
    { knownLeaks: [...LEAKS, { glob: 'node_modules/**', why: 'nope' }] });
    assert.ok(errors.some((e) => e.startsWith('FORBIDDEN node_modules/ ')), errors.join('\n'));
    assert.ok(errors.some((e) => e.startsWith('FORBIDDEN node_modules/x/i.js ')));
    assert.ok(errors.some((e) => e.startsWith('FORBIDDEN .github/workflows/ci.yml ')));
    assert.ok(errors.some((e) => e.startsWith('FORBIDDEN companion/transcriber/server.py ')));
});

test('lists: no KNOWN_LEAKS or ALLOWED entry covers a NEVER path; no list overlaps REQUIRED', () => {
    const never = NEVER.map((n) => globToRegExp(n.glob));
    for (const e of [...KNOWN_LEAKS, ...ALLOWED]) {
        const sample = sampleOf(e.glob);
        assert.ok(globToRegExp(e.glob).test(sample), `sampleOf is wrong for ${e.glob}`);
        assert.ok(!never.some((re) => re.test(sample)), `${e.glob} names a path NEVER forbids`);
    }
    for (const r of ALWAYS_REQUIRED) assert.ok(!never.some((re) => re.test(r)), r);
    assert.ok(KNOWN_LEAKS.every((l) => l.why), 'every known leak says why');
});

test('globToRegExp: segment, depth, and directory semantics', () => {
    const t = (g, p) => globToRegExp(g).test(p);
    assert.ok(t('tests/**', 'tests') && t('tests/**', 'tests/a/b.mjs') && !t('tests/**', 'testsx/a'));
    assert.ok(t('src/**/*.js', 'src/a.js') && t('src/**/*.js', 'src/x/y/z.js') && !t('src/**/*.js', 'src/a.css'));
    assert.ok(t('dist/*.map', 'dist/a.js.map') && !t('dist/*.map', 'dist/cmaps/a.map'));
    assert.ok(t('**/.*/**', '.github') && t('**/.*/**', '.git/HEAD') && t('**/.*/**', 'a/.env') && !t('**/.*/**', 'dist/a.bundle.js'));
    assert.ok(t('dist/_smoke-*', 'dist/_smoke-seed.js') && !t('dist/_smoke-*', 'dist/x/_smoke-a'));
    assert.ok(t('LICENSE', 'LICENSE') && !t('LICENSE', 'xLICENSE'));
});

// ------------------------------------------------------------------ zip

test('listZip / readZipEntry: stored, deflated, directory records, and an archive comment', () => {
    const buf = makeZip([
        { name: 'dir/' }, { name: 'dir/a.txt', data: 'hello' }, { name: 'b.html', data: '<p>x</p>'.repeat(50), deflate: true }
    ], 'a trailing archive comment');
    const entries = listZip(buf);
    assert.deepEqual(entries.map((e) => [e.name, e.size, e.dir]), [['dir/', 0, true], ['dir/a.txt', 5, false], ['b.html', 400, false]]);
    assert.equal(readZipEntry(buf, entries[1]).toString(), 'hello');
    assert.equal(readZipEntry(buf, entries[2]).toString(), '<p>x</p>'.repeat(50));
    assert.ok(entries[2].csize < entries[2].size, 'sanity: the deflate path was exercised');
});

test('listZip refuses what is not a zip', () => {
    assert.throws(() => listZip(Buffer.from('definitely not a zip, just some bytes')), /not a zip/);
});

// ----------------------------------------------------------- derivations

test('manifestRefs: the real manifest names the background, content, MAIN-world, DNR and icon files', () => {
    const refs = manifestRefs(JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')));
    for (const f of ['dist/background.bundle.js', 'dist/content.bundle.js', 'src/content/content.css', 'src/page/nip07-bridge.js',
        'dist/api-interceptor.bundle.js', 'rules/csp-strip.json', 'icons/icon-128.png', 'src/options/options.html', 'src/sidepanel/index.html']) {
        assert.ok(refs.includes(f), `manifestRefs misses ${f}: ${refs.join(', ')}`);
    }
    assert.ok(!refs.some((r) => r.includes('*') || /^https?:/.test(r)), 'match patterns and URLs are not files');
});

test('manifestRefs: synthetic shapes (string icons, MV2 web_accessible_resources, globs skipped)', () => {
    const refs = manifestRefs({
        action: { default_icon: 'i.png', default_popup: '/p.html' }, options_page: 'o.html',
        web_accessible_resources: ['w.js', 'img/*'], background: { page: 'bg.html' }, default_locale: 'en'
    });
    assert.deepEqual(refs, ['_locales/en/messages.json', 'bg.html', 'i.png', 'o.html', 'p.html', 'w.js']);
});

test('htmlRefs: scripts, stylesheets and images resolve against the shell; URLs and comments do not count', () => {
    const html = `<link rel="stylesheet" href="index.css"><script src="../../dist/x.bundle.js"></script>
        <!-- <script src="gone.js"></script> --><a href="https://example.com/">x</a><img src="img/a.png?v=1">
        <link rel="canonical" href="https://example.com/">`;
    assert.deepEqual(htmlRefs('src/reader/index.html', html), ['dist/x.bundle.js', 'src/reader/img/a.png', 'src/reader/index.css']);
    assert.throws(() => htmlRefs('a.html', '<script src="../../escape.js"></script>'), /outside the package/);
});

test('getUrlRefs: literal paths, template prefixes up to #, directories, not comments', () => {
    const refs = getUrlRefs([
        "chrome.runtime.getURL('icons/icon-128.png'); browserApi.runtime.getURL(`src/portal/index.html#dossier=${id}`);",
        "x.runtime.getURL('dist/cmaps/'); chrome.runtime.getURL(''); chrome.runtime.getURL(dynamic);",
        "// chrome.runtime.getURL('commented/out.js')\n/* chrome.runtime.getURL('also/out.js') */"
    ]);
    assert.deepEqual(refs, ['dist/cmaps/', 'icons/icon-128.png', 'src/portal/index.html']);
});

test('PDF_ASSET_DIRS mirrors copyPdfAssets() in esbuild.config.mjs — the seam this check owns', () => {
    const src = readFileSync(join(ROOT, 'esbuild.config.mjs'), 'utf8');
    const m = src.match(/function copyPdfAssets\(\)[\s\S]*?for \(const dir of \[([^\]]+)\]\)/);
    assert.ok(m, 'sanity: copyPdfAssets() and its dir list are found');
    const dirs = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    assert.deepEqual(dirs, [...PDF_ASSET_DIRS]);
});

test('pdfMirror: every asset dir is non-empty and holds its pinned known file', () => {
    const mirror = pdfMirror(ROOT);
    for (const dir of PDF_ASSET_DIRS) {
        assert.ok(mirror.some((f) => f.startsWith(`dist/${dir}/`)), `pdfjs-dist ships nothing under ${dir}/`);
        assert.ok(mirror.includes(`dist/${dir}/${PDF_KNOWN_FILES[dir]}`), `pdfjs-dist no longer ships ${dir}/${PDF_KNOWN_FILES[dir]}`);
    }
});

// ------------------------------------------------------------ end to end

/** A zip holding exactly what the tree requires (real bytes where the tree has them), one file per known leak, README. */
async function syntheticPackage({ drop = () => false, add = [] } = {}) {
    const readHtml = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : null);
    const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
    const { required, requiredDirs } = await deriveRequired({ manifest, readHtml });
    const names = new Set([...required, ...[...requiredDirs].map((d) => `${d}/placeholder`),
        ...KNOWN_LEAKS.map((l) => sampleOf(l.glob)), 'README.md']);
    const files = [...names].filter((n) => !drop(n)).sort().map((name) => {
        const p = join(ROOT, name);
        return { name, data: existsSync(p) && !name.startsWith('dist/') ? readFileSync(p) : 'x', deflate: true };
    });
    return makeZip([...files, ...add]);
}

function runCli(buf) {
    const dir = mkdtempSync(join(tmpdir(), 'xr-pkg-'));
    try {
        const zip = join(dir, 'pkg.zip');
        writeFileSync(zip, buf);
        return spawnSync(process.execPath, [SCRIPT, zip], { cwd: ROOT, encoding: 'utf8' });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test('CLI: a package holding exactly what the tree requires is green', async () => {
    const r = runCli(await syntheticPackage());
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /packaged contents: OK/);
});

test('CLI: deleting dist/cmaps from the package is red and names the pinned file', async () => {
    const r = runCli(await syntheticPackage({ drop: (n) => n.startsWith('dist/cmaps/') }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /MISSING {2}dist\/cmaps\/Adobe-Japan1-UCS2\.bcmap/);
    assert.match(r.stderr, /MISSING {2}dist\/cmaps\/ — required directory/);
});

test('CLI: a node_modules file in the package is red', async () => {
    const r = runCli(await syntheticPackage({ add: [{ name: 'node_modules/left-pad/index.js', data: 'x' }] }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /FORBIDDEN node_modules\/left-pad\/index\.js/);
});

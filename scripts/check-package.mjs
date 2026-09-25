#!/usr/bin/env node
// Packaged-contents assertion — RESET_PLAN §7 R0 / §8 gate order
// (VERI-07; ROAD_TO_1_0 B7 "assert packaged contents in CI", T4).
//
// Reads the zip `web-ext build` produced (the artifact a release uploads)
// and holds it to a CLOSED WORLD — every file in it is exactly one of:
//
//   REQUIRED   derived, never hand-listed: manifest.json + LICENSE; every
//              file manifest.json names (icons, pages, background,
//              content-script js/css, web_accessible_resources, DNR
//              rules); every bundle the exported esbuild `configs`
//              build; every script/stylesheet/image each packaged HTML
//              shell under src/ loads; every literal `runtime.getURL('…')` path in
//              src/; and pdf.js's runtime assets — dist/{cmaps,
//              standard_fonts,wasm,iccs}/ mirrored file-for-file from
//              node_modules/pdfjs-dist (the build copies them; without
//              them a CJK PDF extracts zero text and JBIG2/JPX figures
//              never decode), each with one pinned known file. Every
//              required file must be present and non-empty.
//   ALLOWED    shipped on purpose though nothing loads it (README.md).
//   KNOWN_LEAK today's packaging debt, listed below by category —
//              SHRINK-ONLY. A category that matches nothing is red
//              (stale: delete the entry), so the list cannot rot.
//
// Anything else is red ("unclassified"), and NEVER entries are red
// even if someone lists them as a leak. This slice changes no packaging:
// it makes today's leaks visible and any NEW one a CI failure.
//
// Usage: node scripts/check-package.mjs [path/to.zip]   (npm run check:package)
//        default: the one .zip in web-ext-artifacts/

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Must mirror copyPdfAssets() in esbuild.config.mjs (pinned by tests/check-package.test.mjs). */
export const PDF_ASSET_DIRS = Object.freeze(['cmaps', 'standard_fonts', 'wasm', 'iccs']);
/** One pinned file per pdf.js asset dir — a sanity anchor if pdfjs-dist ever renames its layout. */
export const PDF_KNOWN_FILES = Object.freeze({
    cmaps: 'Adobe-Japan1-UCS2.bcmap',
    standard_fonts: 'LiberationSans-Regular.ttf',
    wasm: 'openjpeg.wasm',
    iccs: 'CGATS001Compat-v2-micro.icc'
});

/** Required regardless of what the manifest says. */
export const ALWAYS_REQUIRED = Object.freeze([
    'manifest.json',
    'LICENSE'            // MIT: the notice must accompany every copy, and the zip is one
]);

/** Must never ship. Cannot be allowlisted as a known leak. */
export const NEVER = Object.freeze([
    { glob: '**/.*/**', why: 'dotfiles and dot-directories (.git, .github, .claude, .env …)' },
    { glob: 'node_modules/**', why: 'dependencies — the bundles already carry what ships' },
    { glob: 'companion/**', why: 'the local Python service — never part of the extension (CLAUDE.md "Companion service")' },
    { glob: 'web-ext-artifacts/**', why: 'a previous package inside the package' },
    { glob: '**/*.zip', why: 'a nested archive' },
    { glob: '**/*.xpi', why: 'a nested archive' },
    { glob: 'tools/smoke/out/**', why: 'browser-smoke output (screenshots, reports)' },
    { glob: 'dist/_smoke-*', why: 'browser-smoke seed bundles' },
    { glob: '_metadata/**', why: 'Chrome-generated ruleset index (ROAD_TO_1_0 B7 prune list)' }
]);

/** Shipped deliberately though nothing loads it. */
export const ALLOWED = Object.freeze([
    { glob: 'README.md', why: 'the user-facing readme' }
]);

// Today's packaging debt, measured 2026-09-25 against the zip of
// a65d4ef. ROAD_TO_1_0 B7 ("The artifact itself is unpruned … 201
// tests/ entries, 83 docs/ entries …, the full src/ tree, CLAUDE.md,
// package-lock.json and 18.4 MB of source maps") and T4 ("Prune
// webExt.ignoreFiles … and assert packaged contents in CI") name the
// fix; this slice only pins the debt. SHRINK-ONLY: delete an entry in
// the PR that stops shipping it — never add one; a new leak is fixed by
// webExt.ignoreFiles in package.json, not by listing it here.
export const KNOWN_LEAKS = Object.freeze([
    { glob: 'tests/**', why: 'B7 prune list' },
    { glob: 'docs/**', why: 'B7 prune list' },
    { glob: 'tools/**', why: 'B7 prune list' },
    { glob: 'scripts/**', why: 'B7 prune list' },
    { glob: 'esbuild.config.mjs', why: 'B7 prune list' },
    { glob: 'package-lock.json', why: 'B7 prune list' },
    { glob: 'CLAUDE.md', why: 'B7 prune list' },
    { glob: 'dist/*.map', why: 'B7 "release source maps"' },
    { glob: 'src/**/*.js', why: 'B7 "the full src/ tree" — bundled source; the one unbundled script is REQUIRED via the manifest' },
    { glob: 'src/shared/audit/beats-v1.json', why: 'B7 "the full src/ tree" — the third-party form of beats.js; nothing loads it' },
    { glob: 'package.json', why: 'dev manifest, not in B7\'s list — found by this assertion' },
    { glob: 'CHANGELOG.md', why: 'repo doc, not in B7\'s list — found by this assertion' },
    { glob: 'CONTRIBUTING.md', why: 'repo doc, not in B7\'s list — found by this assertion' },
    { glob: 'SECURITY.md', why: 'repo doc, not in B7\'s list — found by this assertion' },
    { glob: 'EXAMPLE-case-briefs/**', why: 'sample output, not in B7\'s list — found by this assertion' },
    { glob: 'icons/source.svg', why: 'the icon source scripts/build-icons.mjs renders; not in B7\'s list — found by this assertion' }
]);

// ------------------------------------------------------------------ globs

/** `*` = one path segment's worth; `**` = any depth; a trailing `/**` also matches the directory itself. */
export function globToRegExp(glob) {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*' && glob[i + 1] === '*') {
            const atSegStart = i === 0 || glob[i - 1] === '/';
            if (atSegStart && glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; continue; }
            if (atSegStart && i > 0 && i + 2 === glob.length) { re = re.slice(0, -1) + '(?:/.*)?'; i += 1; continue; }
            re += '.*'; i += 1; continue;
        }
        if (c === '*') re += '[^/]*';
        else if ('\\^$.|?+()[]{}'.includes(c)) re += '\\' + c;
        else re += c;
    }
    return new RegExp('^' + re + '$');
}

const matcher = (list) => list.map((e) => ({ ...e, re: globToRegExp(e.glob) }));
const stripSlash = (p) => (p.endsWith('/') ? p.slice(0, -1) : p);

// -------------------------------------------------------------------- zip

/**
 * List a zip's central directory. No dependency; zip64 is refused (an
 * extension package never needs it).
 * @returns {Array<{name: string, size: number, csize: number, method: number, offset: number, dir: boolean}>}
 */
export function listZip(buf) {
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record');
    const total = buf.readUInt16LE(eocd + 10);
    const cdOffset = buf.readUInt32LE(eocd + 16);
    if (total === 0xffff || cdOffset === 0xffffffff) throw new Error('zip64 archive — not supported (an extension package should never need it)');
    const entries = [];
    let p = cdOffset;
    for (let n = 0; n < total; n++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`corrupt zip: bad central-directory header at ${p}`);
        const method = buf.readUInt16LE(p + 10);
        const csize = buf.readUInt32LE(p + 20);
        const size = buf.readUInt32LE(p + 24);
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const commentLen = buf.readUInt16LE(p + 32);
        const offset = buf.readUInt32LE(p + 42);
        const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
        entries.push({ name, size, csize, method, offset, dir: name.endsWith('/') });
        p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
}

/** One entry's bytes (stored or deflated). */
export function readZipEntry(buf, entry) {
    const p = entry.offset;
    if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error(`corrupt zip: bad local header for ${entry.name}`);
    const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
    const data = buf.subarray(start, start + entry.csize);
    if (entry.method === 0) return Buffer.from(data);
    if (entry.method === 8) return inflateRawSync(data);
    throw new Error(`${entry.name}: unsupported compression method ${entry.method}`);
}

// ------------------------------------------------------------- derivation

const isExternal = (v) => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(v);

/** Every packaged file manifest.json names. */
export function manifestRefs(m) {
    const out = new Set();
    const add = (v) => {
        if (typeof v !== 'string' || !v || isExternal(v) || v.includes('*')) return;
        out.add(posix.normalize(v.replace(/^\/+/, '')));
    };
    const addIcons = (v) => {
        if (typeof v === 'string') add(v);
        else if (v && typeof v === 'object') Object.values(v).forEach(add);
    };
    addIcons(m.icons);
    for (const k of ['action', 'browser_action', 'page_action']) {
        if (m[k]) { addIcons(m[k].default_icon); add(m[k].default_popup); }
    }
    if (m.options_ui) add(m.options_ui.page);
    add(m.options_page);
    add(m.devtools_page);
    if (m.side_panel) add(m.side_panel.default_path);
    if (m.sidebar_action) { add(m.sidebar_action.default_panel); addIcons(m.sidebar_action.default_icon); }
    if (m.background) {
        add(m.background.service_worker);
        add(m.background.page);
        (m.background.scripts || []).forEach(add);
    }
    for (const cs of m.content_scripts || []) { (cs.js || []).forEach(add); (cs.css || []).forEach(add); }
    for (const w of m.web_accessible_resources || []) (typeof w === 'string' ? [w] : (w.resources || [])).forEach(add);
    for (const r of (m.declarative_net_request && m.declarative_net_request.rule_resources) || []) add(r.path);
    if (m.chrome_url_overrides) Object.values(m.chrome_url_overrides).forEach(add);
    if (m.default_locale) add(`_locales/${m.default_locale}/messages.json`);
    return [...out].sort();
}

/** Every script/stylesheet/image an HTML shell loads, resolved to package paths. */
export function htmlRefs(htmlPath, html) {
    const text = html.replace(/<!--[\s\S]*?-->/g, '');
    const out = new Set();
    const rx = /<(script|link|img)\b[^>]*?\b(src|href)\s*=\s*["']([^"']+)["']/gi;
    for (const m of text.matchAll(rx)) {
        const v = m[3].split(/[?#]/)[0];
        if (!v || isExternal(v)) continue;
        const resolved = posix.normalize(posix.join(posix.dirname(htmlPath), v));
        if (resolved.startsWith('../')) throw new Error(`${htmlPath}: ${m[3]} resolves outside the package`);
        out.add(resolved);
    }
    return [...out].sort();
}

/** Literal `runtime.getURL('…')` paths in source text. A trailing `/` means a directory. */
export function getUrlRefs(sources) {
    const out = new Set();
    for (const text of sources) {
        const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
        for (const m of code.matchAll(/runtime\.getURL\(\s*['"`]([^'"`$?#]*)/g)) {
            if (m[1]) out.add(m[1].replace(/^\/+/, ''));
        }
    }
    return [...out].sort();
}

function walkFiles(dir, out = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walkFiles(p, out);
        else out.push(p);
    }
    return out;
}

/** dist/<dir>/<file> for every file pdfjs-dist ships in the asset dirs the build copies. */
export function pdfMirror(root = ROOT) {
    const src = join(root, 'node_modules', 'pdfjs-dist');
    if (!existsSync(src)) throw new Error('node_modules/pdfjs-dist is missing — run `npm ci` first');
    const out = [];
    for (const dir of PDF_ASSET_DIRS) {
        const abs = join(src, dir);
        if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error(`pdfjs-dist has no ${dir}/ — its layout changed; update copyPdfAssets() and this check together`);
        for (const f of walkFiles(abs)) out.push(`dist/${dir}/${relative(abs, f).split(sep).join('/')}`);
    }
    return out.sort();
}

// ------------------------------------------------------------------ check

/**
 * The closed-world check. Pure: the caller derives `required` /
 * `requiredDirs` from the tree.
 * @param {object} a
 * @param {Array<{name: string, size: number, dir?: boolean}>} a.entries
 * @param {Iterable<string>} a.required     files that must be present and non-empty
 * @param {Iterable<string>} a.requiredDirs dirs (no trailing slash) that must hold ≥1 non-empty file
 * @returns {{errors: string[], leakCounts: Map<string, number>, files: number}}
 */
export function checkPackage({ entries, required, requiredDirs = [], never = NEVER, allowed = ALLOWED, knownLeaks = KNOWN_LEAKS }) {
    const errors = [];
    const neverM = matcher(never);
    const allowedM = matcher(allowed);
    const leaksM = matcher(knownLeaks);
    const files = new Map();
    for (const e of entries) {
        const name = stripSlash(e.name);
        const hit = neverM.find((n) => n.re.test(name));
        if (hit) errors.push(`FORBIDDEN ${e.name} — ${hit.why}`);
        if (!e.dir) files.set(e.name, e.size);
    }
    const req = new Set(required);
    for (const r of [...req].sort()) {
        if (!files.has(r)) errors.push(`MISSING  ${r} — required, not in the package`);
        else if (!(files.get(r) > 0)) errors.push(`EMPTY    ${r} — required, but zero bytes`);
    }
    for (const d of [...new Set(requiredDirs)].sort()) {
        const inside = [...files].filter(([n, size]) => n.startsWith(d + '/') && size > 0);
        if (!inside.length) errors.push(`MISSING  ${d}/ — required directory is absent or holds no non-empty file`);
    }
    const leakCounts = new Map(knownLeaks.map((l) => [l.glob, 0]));
    for (const name of [...files.keys()].sort()) {
        if (neverM.some((n) => n.re.test(name))) continue;             // already reported
        if (req.has(name)) continue;
        if ([...requiredDirs].some((d) => name.startsWith(d + '/'))) continue;
        if (allowedM.some((a) => a.re.test(name))) continue;
        const leak = leaksM.find((l) => l.re.test(name));
        if (leak) { leakCounts.set(leak.glob, leakCounts.get(leak.glob) + 1); continue; }
        errors.push(`UNCLASSIFIED ${name} — nothing requires it and it is not a known leak: exclude it via webExt.ignoreFiles in package.json (or, if it must ship, make something load it)`);
    }
    for (const [glob, n] of leakCounts) {
        if (n === 0) errors.push(`STALE    known leak '${glob}' matches nothing in the package — delete it from KNOWN_LEAKS (the list only shrinks)`);
    }
    return { errors, leakCounts, files: files.size };
}

// ------------------------------------------------------------------- main

function defaultZip() {
    const dir = join(ROOT, 'web-ext-artifacts');
    const zips = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.zip')) : [];
    if (zips.length !== 1) {
        throw new Error(`expected exactly one .zip in web-ext-artifacts/ (found ${zips.length}) — run \`npx web-ext build --overwrite-dest\` or pass the zip path`);
    }
    return join(dir, zips[0]);
}

/**
 * Everything the package must contain, derived from the tree and the
 * shipped manifest — never hand-listed.
 * @param {object} a
 * @param {object} a.manifest                        the manifest that ships
 * @param {string[]} [a.htmlNames]                   HTML files in the package (their refs are required too)
 * @param {(path: string) => string|null} a.readHtml an HTML file's text, or null when absent
 * @returns {Promise<{required: Set<string>, requiredDirs: Set<string>}>}
 */
export async function deriveRequired({ root = ROOT, manifest, htmlNames = [], readHtml }) {
    const { configs } = await import(pathToFileURL(join(root, 'esbuild.config.mjs')).href);
    const bundles = configs.map((c) => relative(root, c.outfile).split(sep).join('/'));
    const srcJs = walkFiles(join(root, 'src')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(f, 'utf8'));

    const required = new Set([...ALWAYS_REQUIRED, ...manifestRefs(manifest), ...bundles, ...pdfMirror(root)]);
    for (const dir of PDF_ASSET_DIRS) required.add(`dist/${dir}/${PDF_KNOWN_FILES[dir]}`);
    const requiredDirs = new Set(PDF_ASSET_DIRS.map((d) => `dist/${d}`));
    for (const u of getUrlRefs(srcJs)) (u.endsWith('/') ? requiredDirs.add(stripSlash(u)) : required.add(u));
    const shells = new Set([...[...required].filter((f) => f.endsWith('.html')), ...htmlNames]);
    for (const h of [...shells].sort()) {
        const html = readHtml(h);
        if (html != null) htmlRefs(h, html).forEach((r) => required.add(r));
    }
    return { required, requiredDirs };
}

async function main(argv) {
    const zipPath = argv[0] ? resolve(argv[0]) : defaultZip();
    const buf = readFileSync(zipPath);
    const entries = listZip(buf);
    const byName = new Map(entries.map((e) => [e.name, e]));
    const text = (name) => (byName.has(name) ? readZipEntry(buf, byName.get(name)).toString('utf8') : null);

    const manifestText = text('manifest.json');
    if (manifestText == null) throw new Error(`${zipPath}: no manifest.json at the package root`);
    const { required, requiredDirs } = await deriveRequired({
        manifest: JSON.parse(manifestText),               // the manifest that SHIPS, not the tree's
        // Product shells live under src/ (tools/smoke discovers pages the same
        // way); a leaked doc page's links are not requirements.
        htmlNames: entries.filter((e) => !e.dir && e.name.startsWith('src/') && e.name.endsWith('.html')).map((e) => e.name),
        readHtml: text
    });

    const { errors, leakCounts, files } = checkPackage({ entries, required, requiredDirs });
    console.log(`packaged contents: ${relative(ROOT, zipPath) || zipPath} — ${files} files; ${required.size} required, ${requiredDirs.size} required dirs`);
    const leakTotal = [...leakCounts.values()].reduce((a, b) => a + b, 0);
    console.log(`  known leaks (shrink-only, ROAD_TO_1_0 B7): ${leakTotal} file(s)`);
    for (const [glob, n] of leakCounts) console.log(`    ${String(n).padStart(4)}  ${glob}`);
    for (const e of errors) console.error(`  ${e}`);
    if (errors.length) { console.error(`packaged contents: ${errors.length} problem(s)`); return 1; }
    console.log('packaged contents: OK');
    return 0;
}

const isMain = (() => {
    try { return realpathSync(resolve(process.argv[1] || '')) === realpathSync(fileURLToPath(import.meta.url)); }
    catch (_) { return false; }
})();
if (isMain) {
    main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
        console.error('packaged contents check failed:', err.message);
        process.exitCode = 1;
    });
}

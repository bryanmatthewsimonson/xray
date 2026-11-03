#!/usr/bin/env node
// Version lockstep — RESET_PLAN §7 R0 / §8 gate order (VERI-07; ROAD_TO_1_0
// "Version lockstep is only checked after the immutable tag is pushed").
//
// package.json and manifest.json MUST carry the same version. Until
// 2026-09-25 only release.yml checked it — after the undeletable `v*` tag
// was pushed — while CLAUDE.md and CONTRIBUTING.md both said "CI rejects
// a mismatch". ci.yml now runs this on every PR; release.yml keeps its
// tag-vs-files check as the belt.
//
// package-lock.json's root `version` fields are deliberately NOT checked:
// scripts/set-version.mjs (the sanctioned bump) does not write them, so
// checking them would turn every correct `npm run version:set` red.
//
// Usage: node scripts/check-version-lockstep.mjs   (npm run check:version)

import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The same shape scripts/set-version.mjs accepts.
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/**
 * @param {{pkg: object, manifest: object}} files parsed JSON
 * @returns {string[]} errors; empty means in lockstep
 */
export function checkVersions({ pkg, manifest }) {
    const errors = [];
    const p = pkg && pkg.version;
    const m = manifest && manifest.version;
    if (typeof p !== 'string' || !SEMVER.test(p)) errors.push(`package.json version ${JSON.stringify(p)} is not semver`);
    if (typeof m !== 'string' || !SEMVER.test(m)) errors.push(`manifest.json version ${JSON.stringify(m)} is not semver`);
    if (p !== m) {
        errors.push(`package.json (${p}) and manifest.json (${m}) disagree — run \`npm run version:set <version>\`, which edits both`);
    }
    return errors;
}

function main() {
    const read = (f) => JSON.parse(readFileSync(resolve(ROOT, f), 'utf8'));
    const pkg = read('package.json');
    const manifest = read('manifest.json');
    const errors = checkVersions({ pkg, manifest });
    console.log(`package.json ${pkg.version} · manifest.json ${manifest.version}`);
    for (const e of errors) console.error(`version lockstep: ${e}`);
    if (!errors.length) console.log('version lockstep: OK');
    return errors.length ? 1 : 0;
}

const isMain = (() => {
    try { return realpathSync(resolve(process.argv[1] || '')) === realpathSync(fileURLToPath(import.meta.url)); }
    catch (_) { return false; }
})();
if (isMain) process.exitCode = main();

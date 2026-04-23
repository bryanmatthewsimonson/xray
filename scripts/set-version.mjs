#!/usr/bin/env node
// Bump both package.json and manifest.json to a target version, in
// lockstep. Without this the two can drift — and CI's release job
// rejects the mismatch (by design), turning what should have been a
// release into a debugging session.
//
// Usage:
//   node scripts/set-version.mjs 0.3.0
//   npm run version:set 0.3.0
//
// Doesn't touch git — bump first, commit yourself, then tag.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const target = process.argv[2];
if (!target || !SEMVER.test(target)) {
    console.error(`Usage: node scripts/set-version.mjs <semver>
Got: ${target ?? '(nothing)'}
Examples: 0.3.0, 1.0.0-rc.1`);
    process.exit(1);
}

function patchJson(relPath, patcher) {
    const path = resolve(ROOT, relPath);
    const raw = readFileSync(path, 'utf8');
    const trailing = raw.endsWith('\n') ? '\n' : '';
    const obj = JSON.parse(raw);
    const before = obj.version;
    patcher(obj);
    const next = JSON.stringify(obj, null, 2) + trailing;
    writeFileSync(path, next, 'utf8');
    console.log(`  ${relPath.padEnd(15)} ${before} → ${obj.version}`);
}

console.log(`Setting version to ${target}:`);
patchJson('package.json', (o) => { o.version = target; });
patchJson('manifest.json', (o) => { o.version = target; });
console.log(`
Next steps:
  1. Update CHANGELOG.md — replace [Unreleased] with [${target}] and add today's date.
  2. git add package.json manifest.json CHANGELOG.md
  3. git commit -m "release: v${target}"
  4. git tag v${target}
  5. git push && git push --tags`);

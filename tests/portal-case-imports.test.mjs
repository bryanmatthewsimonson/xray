// PR-4 of docs/PORTAL_UX_REVIEW.md — header imports honor the active
// case (finding A2, harm class "the interface lies about itself").
//
// The header announces "🗂 <caseName>" while its Import buttons passed
// caseEntityId: null and onDone: null — imports were NOT case-tagged
// and the library did not refresh. Maintainer ruling 2026-08-23:
// header-level imports INHERIT the active case automatically.
//
// Grep-based at the wiring (the portal is a DOM module) plus the
// consumer side, per seam-and-invariant-check: the wiring passing a
// value nobody consumes and the panels consuming a value nobody passes
// are the same bug from two sides.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const repoUrl = (p) => new URL(`../${p}`, import.meta.url);
const readRepo = (p) => readFileSync(repoUrl(p), 'utf8');

function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const PORTAL = stripComments(readRepo('src/portal/index.js'));

test('the header resolves the active case ONCE and every import mount inherits it', () => {
    assert.match(PORTAL, /resolveActiveCaseRef/,
        'the wiring must resolve the active case binding');
    // A case switch always reloads the page (renderCaseSwitcher →
    // location.reload()), so resolving once at wire time cannot go
    // stale within a page lifetime.
    for (const mount of ['mountTranscriptImport', 'mountUrlImport', 'mountMediaTranscribe', 'mountBookImport']) {
        const calls = [...PORTAL.matchAll(new RegExp(`${mount}\\(([^;]*?)\\);`, 'g'))];
        assert.ok(calls.length >= 1, `${mount} is no longer mounted from the header`);
        for (const c of calls) {
            assert.ok(!/caseEntityId:\s*null/.test(c[1]),
                `${mount} must not hardcode caseEntityId: null — the header chrome names a case`);
        }
    }
    for (const mount of ['mountTranscriptImport', 'mountUrlImport', 'mountMediaTranscribe', 'mountBookImport']) {
        const calls = [...PORTAL.matchAll(new RegExp(`${mount}\\(([^;]*?)\\);`, 'g'))];
        for (const c of calls) {
            assert.match(c[1], /caseEntityId/, `${mount} must pass the inherited case`);
            assert.match(c[1], /onDone/, `${mount} must refresh the library on completion`);
            assert.ok(!/onDone:\s*null/.test(c[1]),
                `${mount}'s onDone must actually refresh, not null out`);
        }
    }
});

test('the consumer side is real: every panel tags the case it is given', () => {
    for (const [file, marker] of [
        ['src/portal/import-transcript.js', /addArticlesToCase\(caseEntityId/],
        ['src/portal/import-urls.js', /caseEntityId/],
        ['src/portal/import-media.js', /addArticlesToCase\(caseEntityId/],
        // Books: maintainer ruling 2026-08-23 — every chapter joins the
        // active case, in ONE tagging call, degrading to a disclosed
        // caseTagged: false rather than voiding the import.
        ['src/portal/import-book.js', /addArticlesToCase\(caseEntityId, savedUrls\)/]
    ]) {
        assert.match(readRepo(file), marker, `${file} does not consume caseEntityId`);
    }
});

test('an unbound workspace degrades to exactly the old behavior', () => {
    // resolveActiveCaseRef returns null when the workspace is unbound;
    // the resolution must pass that null through rather than inventing
    // a case — the panels already treat null as "no case tagging".
    assert.match(PORTAL, /catch\(\(\) => null\)|catch\(_?\s*=>\s*null\)|\?\s*.*caseId\s*:\s*null/,
        'the resolution must fail closed to null, never throw into the click handler');
});

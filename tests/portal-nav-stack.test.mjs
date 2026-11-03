// PR-6 of docs/PORTAL_UX_REVIEW.md — the back stack (finding B1).
// The pure module carries the behavior; the grep tests carry the seam
// (a stack nobody pushes to and an onBack that still hard-codes the
// library are the same bug from two sides).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { createNavStack, viewLabel, NAV_STACK_MAX } = await import('../src/portal/nav-stack.js');

const repoUrl = (p) => new URL(`../${p}`, import.meta.url);
const readRepo = (p) => readFileSync(repoUrl(p), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('back retraces the exact path — the casework loop that was broken', () => {
    // case → entity → dossier, then back, back, back.
    const nav = createNavStack();
    nav.push({ name: 'case', pubkey: 'p1' });
    nav.push({ name: 'entity', pubkey: 'p2' });
    assert.deepEqual(nav.pop(), { name: 'entity', pubkey: 'p2' });
    assert.deepEqual(nav.pop(), { name: 'case', pubkey: 'p1' },
        'back from the dossier returns to the CASE — the re-find this exists to kill');
    assert.deepEqual(nav.pop(), { name: 'library' }, 'the floor is the library');
});

test('an empty stack is the library, never undefined', () => {
    const nav = createNavStack();
    assert.deepEqual(nav.pop(), { name: 'library' });
    assert.deepEqual(nav.peek(), { name: 'library' });
});

test('re-entering the view you are on does not turn Back into a no-op', () => {
    const nav = createNavStack();
    nav.push({ name: 'case', pubkey: 'p1' });
    nav.push({ name: 'case', pubkey: 'p1' });
    assert.equal(nav.size(), 1, 'consecutive duplicates collapse');
    // A DIFFERENT case is real history.
    nav.push({ name: 'case', pubkey: 'p2' });
    assert.equal(nav.size(), 2);
});

test('the stack is bounded and the oldest history rolls off', () => {
    const nav = createNavStack({ max: 5 });
    for (let i = 0; i < 9; i++) nav.push({ name: 'entity', pubkey: `p${i}` });
    assert.equal(nav.size(), 5);
    let last;
    for (let i = 0; i < 5; i++) last = nav.pop();
    assert.deepEqual(last, { name: 'entity', pubkey: 'p4' }, 'p0–p3 rolled off');
    assert.ok(NAV_STACK_MAX >= 20, 'the default bound covers a long session');
});

test('viewLabel names every portal view, with a safe fallback', () => {
    assert.equal(viewLabel({ name: 'library' }), 'Library');
    assert.equal(viewLabel({ name: 'entity-dossier' }), 'Dossier');
    assert.equal(viewLabel({ name: 'case' }), 'Case');
    assert.equal(viewLabel(null), 'Library');
    assert.equal(viewLabel({ name: 'future-view' }), 'Back');
});

// ------------------------------------------------------------------
// The seams
// ------------------------------------------------------------------

test('every forward navigation in the portal pushes, and onBack pops', () => {
    const src = stripComments(readRepo('src/portal/index.js'));
    assert.match(src, /from '\.\/nav-stack\.js'/, 'the portal must use the stack');
    assert.ok(!/onBack: \(\) => \{ state\.view = \{ name: 'library' \}/.test(src),
        'the hard-coded jump to the library is finding B1 itself — it must be gone');
    assert.match(src, /function navigateTo\(/, 'forward navigation goes through one function');
    // Every view-changing callback routes through navigateTo — none may
    // assign state.view directly (the deep-link boot seed and the
    // cross-workspace wire are checked individually below).
    const cb = /const viewCallbacks = \{[\s\S]*?\n\};/.exec(src);
    assert.ok(cb, 'viewCallbacks moved');
    assert.ok(!/state\.view = \{/.test(cb[0]),
        'viewCallbacks must not assign state.view directly — that is how history was lost');
    assert.match(cb[0], /onBack: \(\) => \{ navigateBack\(\)/);
});

test('the cross-workspace button and deep link participate correctly', () => {
    const src = stripComments(readRepo('src/portal/index.js'));
    // PR-8 moved the jump from its own button into the "⋯" overflow; the
    // seam is the overflow's 'cross-ws' branch.
    const crossWs = /picked === 'cross-ws'[\s\S]{0,120}/.exec(src);
    assert.ok(crossWs && /navigateTo\(/.test(crossWs[0]),
        'the cross-workspace jump must be re-traceable too');
    // The boot deep-link SEEDS the view (nothing to go back to), so a
    // direct assignment there is correct — assert it stayed.
    assert.match(src, /dossierMatch[\s\S]{0,160}state\.view = \{ name: 'entity-dossier'/);
});

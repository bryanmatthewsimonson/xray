// ESLint — RESET_PLAN §7 R0 ("ESLint minimal"; VERI-07). Two rules,
// nothing else: `no-undef` (a ReferenceError waiting for the one code
// path no test reaches) and `no-unused-vars` (dead bindings, and the
// half-finished refactors they mark). Style is not linted here.
//
// This config is NOT run as a plain `eslint .` gate: today's tree has
// violations, and src/ belongs to other lanes. `npm run lint:js`
// (scripts/eslint-ratchet.mjs) runs it against the checked-in,
// SHRINK-ONLY per-file baseline in scripts/eslint-baseline.json.
//
// Globals follow the execution context (CLAUDE.md "Architecture"):
//   src/**            browser + webextensions (pages, content script,
//                     and src/shared/ — which also runs in the worker;
//                     DOM use there is structure-guards Rule 3's job)
//   src/background/** serviceworker + webextensions (no window/document)
//   src/page/**       browser only, classic scripts: MAIN world, no
//                     extension API
//   node-side files   node (scripts/, tools/, tests/, the configs)
//   tools/smoke/**    node + browser + webextensions: Playwright drivers
//                     whose page.evaluate() callbacks run in the page
// The bare `console.*` ratchet is NOT here — it already exists as
// tests/structure-guards.test.mjs Rule 6 (200 outside utils.js and
// src/page/; 205 counting them).

import globals from 'globals';

const unusedVars = ['error', {
    vars: 'all',
    args: 'after-used',          // positional callback params before a used one are signature, not dead code
    caughtErrors: 'none',        // `catch (e) {}` / `catch (_)` is the house idiom for deliberate swallowing
    ignoreRestSiblings: true,    // `const { drop, ...rest } = o` omits a key on purpose
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    destructuredArrayIgnorePattern: '^_'
}];

export default [
    {
        ignores: [
            'node_modules/**', 'dist/**', 'web-ext-artifacts/**', 'companion/**',
            'docs/**', 'tools/smoke/out/**', '.claude/**', '_metadata/**'
        ]
    },
    {
        files: ['**/*.js', '**/*.mjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module'
        },
        linterOptions: { reportUnusedDisableDirectives: 'off' },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': unusedVars
        }
    },
    {
        // Globals MERGE across matching config objects, so the worker and
        // MAIN-world trees must not match this one at all.
        files: ['src/**/*.js'],
        ignores: ['src/background/**', 'src/page/**'],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.webextensions,
                __XRAY_BUILD_INFO__: 'readonly'   // esbuild `define` (esbuild.config.mjs buildStamp)
            }
        }
    },
    {
        files: ['src/background/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.serviceworker,
                ...globals.webextensions,
                __XRAY_BUILD_INFO__: 'readonly'
            }
        }
    },
    {
        files: ['src/page/**/*.js'],
        languageOptions: {
            sourceType: 'script',
            globals: { ...globals.browser }
        }
    },
    {
        files: ['scripts/**', 'tools/**', 'tests/**', '*.mjs'],
        languageOptions: { globals: { ...globals.node } }
    },
    {
        files: ['tools/smoke/**'],
        languageOptions: {
            globals: { ...globals.node, ...globals.browser, ...globals.webextensions }
        }
    }
];

// Structure guards — RESET_PLAN §7 R0 ("tests/structure-guards.test.mjs
// pinning today's state with breaches allowlisted ... Every later PR
// shrinks an allowlist; none may grow one"). Findings pinned:
//   ARCH-6  nostr-client.js / WebSocket openers outside background/
//   ARCH-8  DOM globals in src/shared (modals + platform handlers)
//   ARCH-3  the xray:* bus has no registry (closed literal registry here)
//   ARCH-2  surface index.js line-count ceilings — "extract, never raise"
//   ARCH-14 bare console.* against the Utils.log convention
//   ARCH-15 the guard itself: each PR may only SHRINK a list below.
// (docs/audit-2026-09-05/architect.md; structure map of 2026-09-08.)
//
// Provenance: INTERPRETATION (2026-09-08) — an agent artifact under
// RESET_PLAN R0; the maintainer has not ruled on it.
//
// Idiom: every rule is its own test(); each starts with a POSITIVE
// sanity assertion proving the scanner sees the thing it guards, then
// enforces. Allowlists are "today's value" with file:line + reason.
// Membership rules are set-equal BOTH WAYS (a fixed breach must be
// removed from the list in the same PR — the list cannot rot); count
// rules are `actual <= ceiling` plus a presence companion.
//
// Deviations from the R0 bullet's wording, stated honestly: "no
// document in shared/ except the four modals" would fail on 16 further
// modules today, so Rule 3 is the bundle-context form (per-module
// maxCount + allowedBundles). The console total here (200) is
// RESET_PLAN's ESLint seed of 205 MINUS the two exemptions the bullet
// names (src/shared/utils.js: 2, src/page/api-interceptor.js: 3) — the
// two numbers are the same census, not drift.
//
// The comment/string stripper below is hand-rolled and regex-literal
// aware (src has `/[&<>"']/g` and `/"/g` — a quote-blind stripper
// desynchronises there); it carries its own self-test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, dirname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configs } from '../esbuild.config.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC_ROOT = join(ROOT, 'src');
const rel = (abs) => relative(ROOT, abs).split(sep).join('/');

function walkJs(dir, out = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walkJs(p, out);
        else if (e.name.endsWith('.js')) out.push(p);
    }
    return out;
}
/** rel path → raw source, for every src/**\/*.js */
const SRC = new Map(walkJs(SRC_ROOT).sort().map((p) => [rel(p), readFileSync(p, 'utf8')]));

// ---------------------------------------------------------------- stripper
// Blanks comments and regex literals (always) and string/template
// literals (unless keepStrings), preserving line structure and `${}`
// expressions. A `/` opens a regex when the last significant code
// char/word is an operator, opener, or a value-expecting keyword.
const REGEX_PRECEDER = /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\b(?:return|typeof|case|in|of|instanceof|new|delete|void|throw|yield|await|do|else))\s*$/;

function strip(src, { keepStrings = false } = {}) {
    let out = '', tail = '', i = 0;
    const n = src.length;
    const blank = (ch) => (ch === '\n' ? '\n' : ' ');
    const value = () => { tail = (tail + '0').slice(-40); };
    const scanQuoted = (q) => {              // src[i] === q; returns text incl. quotes
        let j = i + 1;
        while (j < n && src[j] !== q) j += (src[j] === '\\' ? 2 : 1);
        const text = src.slice(i, j + 1); i = j + 1; return text;
    };
    while (i < n) {
        const c = src[i], d = src[i + 1];
        if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
        if (c === '/' && d === '*') {
            i += 2;
            while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += blank(src[i]); i++; }
            i += 2; continue;
        }
        if (c === '"' || c === "'") {
            const text = scanQuoted(c);
            out += keepStrings ? text : [...text].map(blank).join('');
            value(); continue;
        }
        if (c === '`') {
            i++; out += keepStrings ? '`' : ' ';
            while (i < n && src[i] !== '`') {
                if (src[i] === '\\') { out += keepStrings ? src.slice(i, i + 2) : '  '; i += 2; continue; }
                if (src[i] === '$' && src[i + 1] === '{') {
                    let depth = 1, j = i + 2;
                    while (j < n && depth > 0) {   // find the matching }, skipping nested quotes
                        if (src[j] === '{') depth++;
                        else if (src[j] === '}') depth--;
                        else if (src[j] === '`' || src[j] === '"' || src[j] === "'") {
                            const q = src[j]; j++;
                            while (j < n && src[j] !== q) j += (src[j] === '\\' ? 2 : 1);
                        }
                        if (depth > 0) j++;
                    }
                    out += '${' + strip(src.slice(i + 2, j), { keepStrings }) + '}';
                    i = j + 1; continue;
                }
                out += keepStrings ? src[i] : blank(src[i]); i++;
            }
            i++; out += keepStrings ? '`' : ' ';
            value(); continue;
        }
        if (c === '/' && REGEX_PRECEDER.test(tail)) {
            let j = i + 1, inClass = false, ok = false;
            for (; j < n && src[j] !== '\n'; j++) {
                if (src[j] === '\\') { j++; continue; }
                if (src[j] === '[') inClass = true;
                else if (src[j] === ']') inClass = false;
                else if (src[j] === '/' && !inClass) { ok = true; break; }
            }
            if (ok) {
                while (/[a-z]/.test(src[j + 1] || '')) j++;
                out += ' '.repeat(j + 1 - i); i = j + 1; value(); continue;
            }
        }
        out += c;
        if (!/\s/.test(c)) tail = (tail + c).slice(-40);
        i++;
    }
    return out;
}

const countMatches = (text, re) => (text.match(re) || []).length;
const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const sortedEq = (actual, expected, msg) =>
    assert.deepEqual([...actual].sort(), [...expected].sort(), msg);

// ------------------------------------------------------------ import graph
const IMPORT_RES = [
    /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"](\.[^'"]+)['"]/g,   // static + export-from
    /\bimport\s*['"](\.[^'"]+)['"]/g,                                // bare side-effect import
    /\bimport\s*\(\s*['"](\.[^'"]+)['"]/g                            // dynamic import
];
function edgesOf(file) {
    const code = strip(SRC.get(file), { keepStrings: true });
    const targets = new Set();
    for (const re of IMPORT_RES) {
        for (const m of code.matchAll(re)) {
            let t = resolve(ROOT, dirname(file), m[1]);
            if (!t.endsWith('.js')) t += '.js';
            targets.add(rel(t));
        }
    }
    return targets;
}
const EDGES = new Map([...SRC.keys()].map((f) => [f, edgesOf(f)]));
const importersOf = (target) => [...EDGES].filter(([, t]) => t.has(target)).map(([f]) => f);
function reach(entry) {
    const seen = new Set(); const stack = [entry];
    while (stack.length) {
        const f = stack.pop();
        if (seen.has(f)) continue;
        seen.add(f);
        for (const t of EDGES.get(f) || []) stack.push(t);
    }
    return seen;
}
/** bundle name (from the outfile) → reach set of its entry */
const BUNDLES = new Map(configs.map((c) => [
    basename(c.outfile).replace(/\.bundle\.js$/, ''), reach(rel(c.entryPoints[0]))
]));
const bundlesReaching = (file) => [...BUNDLES].filter(([, r]) => r.has(file)).map(([b]) => b);

test('stripper self-test: regex quotes, template expressions, URL slashes do not desynchronise', () => {
    const DOM = /(?<![\w$.])document\s*\./g;
    const cases = [
        ["const a = /'/; const b = document.x;", 1],                       // quote inside a regex literal
        ['const t = `pre ${document.title} post`;', 1],                    // ${} expression kept
        ["const u = 'https://example.com/x'; document.y = 1;", 1],         // // inside a URL string
        ['// document.foo\n/* document.bar */ const r = a / b / c;', 0],  // comments + division
        ['const z = `${ `${document.z}` }`;', 1],                          // nested template
        ['s.replace(/[&<>"\']/g, (c) => c); document.w;', 1]              // the real src pattern
    ];
    for (const [src, hits] of cases) {
        assert.equal(countMatches(strip(src), DOM), hits, `stripper desync on: ${src}`);
    }
    assert.ok(!strip('const t = `pre ${x} post`;').includes('pre'), 'template text must be blanked');
    assert.ok(strip("const u = 'https://e.com/x'; // c", { keepStrings: true }).includes("'https://e.com/x'"),
        'keepStrings must preserve the string verbatim');
    assert.equal(strip('a\n/* x\ny */\nb').split('\n').length, 4, 'line structure must survive');
});

// Rule 1 — ARCH-6. Today's breaches, file:line of the import:
const ALLOW_NOSTR_CLIENT_IMPORTERS_OUTSIDE_BACKGROUND = [
    'src/shared/entity-sync.js',        // :43 — sidepanel/network-side relay client (ARCH-6); route through xray:relay:*
    'src/shared/confirmed-publish.js'   // :17 — default `publish = NostrClient.publishToRelays` param (:41)
];
const ALLOW_WEBSOCKET_OPENERS = [
    'src/shared/nsecbunker-client.js'   // :26 — bunker signer socket; target: worker-side behind xray:sign (ARCH-6)
];

test('rule 1: import graph — nostr-client.js importers and WebSocket openers are exactly the allowlist', () => {
    const target = 'src/shared/nostr-client.js';
    assert.ok(SRC.has(target) && EDGES.get('src/background/index.js').has(target),
        'sanity: background/index.js must import nostr-client.js (the intended owner)');
    for (const [f, ts] of EDGES) for (const t of ts) assert.ok(SRC.has(t), `sanity: ${f} imports missing file ${t}`);
    const outside = importersOf(target).filter((f) => !f.startsWith('src/background/'));
    sortedEq(outside, ALLOW_NOSTR_CLIENT_IMPORTERS_OUTSIDE_BACKGROUND,
        'nostr-client.js importers outside src/background/ must EQUAL the allowlist: a new importer must ' +
        'route through xray:relay:* instead; a removed one must be deleted from ALLOW_NOSTR_CLIENT_IMPORTERS_OUTSIDE_BACKGROUND');

    const openers = [...SRC].filter(([, s]) => /\bnew\s+WebSocket\s*\(/.test(strip(s))).map(([f]) => f);
    assert.ok(openers.includes(target), 'sanity: nostr-client.js opens the pool socket');
    sortedEq(openers, [target, ...ALLOW_WEBSOCKET_OPENERS],
        '`new WebSocket(` outside nostr-client.js must EQUAL ALLOW_WEBSOCKET_OPENERS (shrink-only)');
});

// Rule 2 — ARCH-6. Today: background (direct), sidepanel + network via entity-sync.js. Target: background only.
const ALLOW_NOSTR_CLIENT_BUNDLES = ['background', 'sidepanel', 'network'];
// Today: nsecbunker-client.js rides signer.js into every signing context (content/index.js:11 imports it directly).
const ALLOW_NSECBUNKER_BUNDLES = ['content', 'background', 'options', 'portal', 'network'];

test('rule 2: bundle reach — nostr-client.js only in allowlisted bundles, never content; nsecbunker ⊆ its list', () => {
    assert.ok(BUNDLES.has('content') && BUNDLES.has('background') && BUNDLES.size === configs.length,
        'sanity: esbuild configs yield the named bundles');
    assert.ok(BUNDLES.get('background').has('src/shared/nostr-client.js'), 'sanity: background reaches nostr-client.js');
    const nc = bundlesReaching('src/shared/nostr-client.js');
    assert.ok(!nc.includes('content'), 'HARD: the content bundle must never carry the relay pool (CSP-strict pages)');
    sortedEq(nc, ALLOW_NOSTR_CLIENT_BUNDLES,
        'bundles reaching nostr-client.js must EQUAL ALLOW_NOSTR_CLIENT_BUNDLES — route the page through xray:relay:* or shrink the list');
    const nb = bundlesReaching('src/shared/nsecbunker-client.js');
    assert.ok(nb.length > 0, 'sanity: nsecbunker-client.js is bundled somewhere');
    const extra = nb.filter((b) => !ALLOW_NSECBUNKER_BUNDLES.includes(b));
    assert.deepEqual(extra, [], `nsecbunker-client.js reached new bundle(s) ${extra} — keep the socket opener out of pages`);
    const stale = ALLOW_NSECBUNKER_BUNDLES.filter((b) => !nb.includes(b));
    assert.deepEqual(stale, [], `ALLOW_NSECBUNKER_BUNDLES entries no longer reached ${stale} — remove them (shrink the list)`);
});

// Rule 3 — ARCH-8. module → { maxCount, allowedBundles }. Counts are what THIS
// matcher yields (regex-aware stripper). Four ceilings exceed the 2026-09-08
// map's figures (content-detector 28, content-extractor 18, youtube 7,
// utils 1) because the map's stripper desynchronised on regex literals
// (`/\/p\//` reads as a line comment, `/"/g` as a string); every extra
// hit was verified by eye as a real `document.`/`window.` reference.
const DOM_RX = /(?<![\w$.])(document|window)\s*[.[]|(?<![\w$.])globalThis\s*\.\s*(document|window)\b|(?<![\w$.])(document|window)\s*(?:\?\.|instanceof|===|!==|==|!=)|typeof\s+(document|window)\b/g;
const SURFACES = ['content', 'background', 'options', 'sidepanel', 'reader', 'portal', 'network'];
const DOM_ALLOW = {
    'src/shared/content-detector.js':            { maxCount: 31, allowedBundles: ['content'] },          // URL+DOM detection (:9-10, :60-62, :100-151)
    'src/shared/content-extractor.js':           { maxCount: 61, allowedBundles: SURFACES },             // LATENT: DOM readers (:29-:1290) bundled into the worker via event-builder.js:13 — split them out
    'src/shared/platforms/index.js':             { maxCount: 15, allowedBundles: ['content'] },          // typeof-guarded dispatcher
    'src/shared/forensic-modal.js':              { maxCount: 13, allowedBundles: ['reader'] },           // modal → shared/ui/ (ARCH-8)
    'src/shared/platforms/facebook.js':          { maxCount: 11, allowedBundles: ['content'] },
    'src/shared/platforms/twitter.js':           { maxCount: 11, allowedBundles: ['content'] },
    'src/shared/assess-modal.js':                { maxCount: 10, allowedBundles: ['sidepanel', 'reader'] }, // modal → shared/ui/
    'src/shared/adjudicate-modal.js':            { maxCount: 9,  allowedBundles: ['reader'] },           // modal → shared/ui/
    'src/shared/platforms/substack.js':          { maxCount: 8,  allowedBundles: ['content'] },
    'src/shared/integrity-modal.js':             { maxCount: 7,  allowedBundles: ['reader'] },           // modal → shared/ui/
    'src/shared/platforms/instagram.js':         { maxCount: 7,  allowedBundles: ['content'] },
    'src/shared/platforms/youtube.js':           { maxCount: 19, allowedBundles: ['content'] },          // :33-:622 incl. the transcript-panel DOM walk
    'src/shared/platforms/tiktok.js':            { maxCount: 5,  allowedBundles: ['content'] },
    'src/shared/api-hook-buffer.js':             { maxCount: 4,  allowedBundles: ['content'] },          // postMessage bridge (:35-77)
    'src/shared/platforms/comment-extractor.js': { maxCount: 3,  allowedBundles: ['content'] },
    'src/shared/metadata/anchor-capture.js':     { maxCount: 2,  allowedBundles: ['sidepanel', 'reader'] }, // typeof-guarded (:199)
    'src/shared/quote-grounding.js':             { maxCount: 1,  allowedBundles: ['background', 'options', 'sidepanel', 'reader', 'portal'] }, // FALSE POSITIVE: local `const window` at :234 — rename it and drop this entry
    'src/shared/screenshot.js':                  { maxCount: 1,  allowedBundles: ['content', 'background'] }, // :63 devicePixelRatio, documented dual-context split
    'src/shared/smoke-anchors.js':               { maxCount: 1,  allowedBundles: ['options', 'sidepanel', 'reader', 'portal', 'network'] }, // :29 try/catch no-op
    'src/shared/utils.js':                       { maxCount: 2,  allowedBundles: SURFACES }              // :45 the `typeof document` worker guard + :53 escapeHtml's guarded createElement
};

test('rule 3: DOM globals in src/shared — per-module count ceilings and bundle sets; unlisted modules are zero', () => {
    const hits = new Map();
    for (const [f, s] of SRC) {
        if (!f.startsWith('src/shared/')) continue;
        const c = countMatches(strip(s), DOM_RX);
        if (c) hits.set(f, c);
    }
    assert.ok((hits.get('src/shared/utils.js') || 0) >= 1, 'sanity: the matcher sees utils.js:45 `typeof document`');
    assert.ok(hits.get('src/shared/forensic-modal.js') > 5, 'sanity: the matcher sees the modal DOM building');
    for (const [f, c] of hits) {
        const a = DOM_ALLOW[f];
        assert.ok(a, `${f}: ${c} DOM-global reference(s) in an unlisted shared module — shared code takes a DOM ` +
            'via parameters or moves to its owning surface; do not add it to DOM_ALLOW');
        assert.ok(c <= a.maxCount, `${f}: ${c} DOM references > ceiling ${a.maxCount} — extract, never raise`);
        const outside = bundlesReaching(f).filter((b) => !a.allowedBundles.includes(b));
        assert.deepEqual(outside, [], `${f} is now bundled into ${outside} — a DOM module reached a context outside its set`);
    }
    for (const f of Object.keys(DOM_ALLOW)) {
        assert.ok(hits.has(f), `${f} has no DOM references any more — remove it from DOM_ALLOW (the list may not rot)`);
    }
});

// Rule 4 — ARCH-3. The closed registry. Handlers are pinned as constants
// AND re-derived from the dispatch chains, so a drift either way fails.
const HANDLERS_BACKGROUND = [
    'xray:openEntities', 'xray:openPortal', 'xray:openNetwork', 'xray:openCaptureTips', 'xray:pdf:open',
    'xray:reader:open', 'xray:capture:getPubkey', 'xray:capture:publish', 'xray:llm:extract', 'xray:audit:run',
    'xray:audit:module', 'xray:llm:config', 'xray:lens:read', 'xray:vision:describe', 'xray:vision:config',
    'xray:lens:config', 'xray:llm:forensic-corpus', 'xray:llm:entity-audit',
    'xray:llm:hypothesis-edges', 'xray:llm:corpus-links',   // corpus-map / corpus-reduce / entity-page became xray:llm:job:* (#374)
    'xray:llm:corpus-config', 'xray:transcribe:config', 'xray:transcribe:ping', 'xray:transcribe:start',
    'xray:transcribe:status', 'xray:transcribe:direct:start', 'xray:transcribe:direct:status',
    'xray:transcribe:direct:deepgram', 'xray:transcribe:claims', 'xray:youtube:fetchTranscript',
    'xray:youtube:captureTranscriptViaHook', 'xray:substack:fetchPost', 'xray:substack:fetchComments',
    'xray:scholar:fetch', 'xray:scholar:crossref', 'xray:media:lookup', 'xray:screenshot:capture',
    'xray:archive:reconstruct', 'xray:relay:query', 'xray:relay:publish', 'xray:notify',
    'xray:llm:job:start', 'xray:llm:job:status', 'xray:llm:job:find', 'xray:llm:job:ack',   // #374 LLM jobs
];
const HANDLERS_CONTENT = ['xray:capture', 'xray:capture:transcribe', 'xray:getPubkey', 'xray:sign'];
const FORWARD_PREFIX = 'xray:forward:';   // background/index.js:479 wildcard; ROAD_TO_1_0 K4 open, single sender options/index.js:1863
const ORPHAN_HANDLERS = ['xray:scholar:crossref'];   // background/index.js:1207 — no send site (crossref.js:10 says "see the wiring notes")
// Trailing [.:-] trimmed, like the census. Non-message classes: storage keys/prefixes, menu ids, the KDF domain, the command id.
const NON_MESSAGE_LITERALS = [
    'xray:article',                      // session prefix — background/index.js:562,582,1770; reader/index.js:243
    'xray:audit:draft',                  // local prefix — shared/audit/corpus-audit.js:24 (dup. reader/index.js:4384)
    'xray:diagnostics',                  // shared/diagnostics.js:25; backup.js:121,125
    'xray:flags',                        // shared/metadata/feature-flags.js:11,21 + readers
    'xray:lensread',                     // session prefix — shared/lens-engine.js:339
    'xray:llm:key', 'xray:llm:model', 'xray:llm:suggest_kinds',   // shared/llm-prompts.js:100,101,145
    'xray:lmstudio:url', 'xray:lmstudio:model',                    // shared/transcriber-client.js:43,44
    'xray:options:backup-report',        // options/index.js:1163
    'xray:transcribe:job',               // prefix — reader/transcribe-flow.js:19
    'xray:transcriber:port', 'xray:transcriber:token', 'xray:transcriber:engine',       // transcriber-client.js:23,24,31
    'xray:transcriber:assemblyai:key', 'xray:transcriber:deepgram:key',               // transcriber-client.js:32,33
    'xray:user',                         // portal/identity.js:34; sidepanel/index.js:51; backup.js:47,62,129
    'xray:open-capture', 'xray:transcribe-capture', 'xray:open-entities', 'xray:open-portal',   // MENU_IDS background/index.js:76-83
    'xray:open-network', 'xray:open-pdf', 'xray:open-settings', 'xray:capture-tips', 'xray:separator-1', // :168
    'xray:platform-account:v1',          // KDF domain — shared/identity/platform-account.js:52
    'xray:toggle',                       // COMMAND ID — manifest.json; compared at background/index.js:1405
    'xray:llm-job'                       // local prefix — shared/llm-jobs.js:51 (#374 LLM job records)
];
const HANDLERS = new Set([...HANDLERS_BACKGROUND, ...HANDLERS_CONTENT]);
const LITERAL_RX = /xray:[A-Za-z0-9:_.-]+/g;
const trimTok = (t) => t.replace(/[.:-]+$/, '');
const unforward = (t) => (t.startsWith(FORWARD_PREFIX) ? t.slice(FORWARD_PREFIX.length) : t);

test('rule 4: message registry — two listeners, closed literal set, every send handled, every handler sent', () => {
    const code = new Map([...SRC].map(([f, s]) => [f, strip(s, { keepStrings: true })]));
    const bg = code.get('src/background/index.js'), ct = code.get('src/content/index.js');

    const listeners = [...code].filter(([, s]) => /onMessage\.addListener\s*\(/.test(s)).map(([f]) => f);
    sortedEq(listeners, ['src/background/index.js', 'src/content/index.js'],
        'exactly two onMessage listeners: a third dispatch chain needs the ARCH-3 registry first');

    // Only the listener body: the two compares at :416 sit in the context-menu delivery catch, not the chain.
    const chain = bg.slice(bg.indexOf('onMessage.addListener('));
    const bgHandlers = [...chain.matchAll(/message\.type\s*===\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    assert.ok(bgHandlers.length >= 40, 'sanity: the background if-chain is visible to the scanner');
    sortedEq(new Set(bgHandlers), HANDLERS_BACKGROUND, 'background handler set drifted from HANDLERS_BACKGROUND — update both, one message per PR');
    const ctHandlers = [...ct.matchAll(/case\s*['"](xray:[^'"]+)['"]/g)].map((m) => m[1]);
    sortedEq(ctHandlers, HANDLERS_CONTENT, 'content handler set drifted from HANDLERS_CONTENT');
    const prefixHandlers = [...code].flatMap(([f, s]) => [...s.matchAll(/startsWith\(\s*['"](xray:[^'"]*)['"]/g)].map((m) => `${f}:${m[1]}`));
    assert.deepEqual(prefixHandlers, [`src/background/index.js:${FORWARD_PREFIX}`],
        'only the K4 xray:forward: wildcard may dispatch by prefix; no other startsWith(\'xray: handler');

    // (g) closed registry over every literal in code
    const registry = new Set([...HANDLERS, ...NON_MESSAGE_LITERALS, trimTok(FORWARD_PREFIX)]);
    const seen = new Map();   // token → first site
    for (const [f, s] of code) {
        for (const m of s.matchAll(LITERAL_RX)) {
            const t = trimTok(m[0]);
            if (!seen.has(t)) seen.set(t, `${f}:${lineOf(s, m.index)}`);
        }
    }
    assert.ok(seen.has('xray:relay:query') && seen.has('xray:flags'), 'sanity: literal scan sees a message and a storage key');
    for (const [t, site] of seen) {
        assert.ok(registry.has(unforward(t)),
            `unregistered xray: literal '${t}' at ${site} — a new message goes in HANDLERS_* with its handler; a new key goes in NON_MESSAGE_LITERALS`);
    }
    for (const t of NON_MESSAGE_LITERALS) assert.ok(seen.has(t), `NON_MESSAGE_LITERALS entry '${t}' is gone from src — remove it (shrink the list)`);

    // (c)+(d) send sites ↔ handlers
    const SEND_RX = /(?:\btype|\bstartType|\bstatusType)\s*[:=]\s*['"`](xray:[A-Za-z0-9:_.-]+)['"`]/g;
    const sends = new Map();  // handled type → [sites]
    const forwardSites = [];
    for (const [f, s] of code) {
        for (const m of s.matchAll(SEND_RX)) {
            if (m[1].startsWith(FORWARD_PREFIX)) forwardSites.push(f);
            const t = unforward(m[1]);
            (sends.get(t) || sends.set(t, []).get(t)).push(`${f}:${lineOf(s, m.index)}`);
        }
    }
    assert.ok(sends.has('xray:transcribe:direct:deepgram') && sends.has('xray:transcribe:status'),
        'sanity: startType/statusType parameter defaults and overrides count as send sites');
    for (const [t, sites] of sends) {
        assert.ok(HANDLERS.has(t), `'${t}' is sent at ${sites[0]} but no handler exists in background/ or content/ — it fails silently at runtime`);
    }
    for (const h of HANDLERS) {
        if (ORPHAN_HANDLERS.includes(h)) assert.ok(!sends.has(h), `'${h}' now has a send site — remove it from ORPHAN_HANDLERS`);
        else assert.ok(sends.has(h), `handler '${h}' has no send site — delete the branch or list it in ORPHAN_HANDLERS with a reason`);
    }
    for (const o of ORPHAN_HANDLERS) assert.ok(HANDLERS.has(o), `ORPHAN_HANDLERS entry '${o}' is no longer a handler — remove it`);
    assert.deepEqual(forwardSites, ['src/options/index.js'],
        'xray:forward: must have exactly one send site (options/index.js) while ROAD_TO_1_0 K4 is open — never add another');
});

// Rule 5 — ARCH-2. wc -l today. Extract, never raise.
const LINE_CEILINGS = {
    'src/content/index.js': 282,   'src/background/index.js': 1888, 'src/options/index.js': 1994,
    'src/sidepanel/index.js': 2245, 'src/reader/index.js': 8297,    'src/portal/index.js': 1500,
    'src/network/index.js': 836
};

test('rule 5: surface ceilings — every surface index.js at or below today\'s line count', () => {
    for (const [f, ceiling] of Object.entries(LINE_CEILINGS)) {
        assert.ok(SRC.has(f), `sanity: ${f} exists`);
        const lines = SRC.get(f).split('\n').length - 1;   // wc -l semantics (trailing newline)
        assert.ok(lines > 0, `sanity: ${f} is non-empty`);
        assert.ok(lines <= ceiling, `${f} is ${lines} lines > ceiling ${ceiling} — extract a module, never raise the ceiling`);
    }
});

// Rule 6 — ARCH-14. Raw-source counts (no comment matches exist today; counting
// them keeps the rule cheap and conservative). Exempt: utils.js (the logger)
// and src/page/ (MAIN-world, cannot import Utils). Total 200 = 205 − 5.
const CONSOLE_RX = /console\.(log|error|warn|info|debug)\(/g;
const CONSOLE_ALLOW = {
    'src/reader/index.js': 103,                 'src/shared/platforms/youtube.js': 18,
    'src/shared/platforms/instagram.js': 16,    'src/background/index.js': 9,
    'src/shared/platforms/twitter.js': 8,       'src/shared/platforms/facebook.js': 6,
    'src/reader/pdf-capture.js': 6,             'src/shared/screenshot.js': 5,
    'src/shared/platforms/index.js': 5,         'src/shared/crypto.js': 5,
    'src/sidepanel/index.js': 4,                'src/shared/content-extractor.js': 4,
    'src/network/index.js': 3,                  'src/shared/api-hook-buffer.js': 2,
    'src/reader/entity-tagger.js': 2,           'src/reader/claim-extractor.js': 2,
    'src/shared/platforms/tiktok.js': 1,        'src/shared/platforms/substack-api.js': 1
};

test('rule 6: console ratchet — per-file ceilings outside utils.js and src/page/; unlisted files are zero', () => {
    const counts = new Map();
    for (const [f, s] of SRC) {
        if (f === 'src/shared/utils.js' || f.startsWith('src/page/')) continue;
        const c = countMatches(s, CONSOLE_RX);
        if (c) counts.set(f, c);
    }
    assert.ok(counts.get('src/reader/index.js') > 50, 'sanity: the scanner sees the reader\'s console calls');
    assert.equal(Object.values(CONSOLE_ALLOW).reduce((a, b) => a + b, 0), 200, 'header arithmetic: 205 − utils.js 2 − page/ 3');
    for (const [f, c] of counts) {
        const ceiling = CONSOLE_ALLOW[f] || 0;
        assert.ok(c <= ceiling, `${f}: ${c} bare console.* call(s) > ceiling ${ceiling} — route through Utils.log / Utils.error`);
    }
    for (const f of Object.keys(CONSOLE_ALLOW)) {
        assert.ok(counts.has(f), `${f} has no bare console.* left — remove it from CONSOLE_ALLOW (the list may not rot)`);
    }
});

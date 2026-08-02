// Phase 29.1 — the transport guard (EVENT_STORE_DESIGN §3.2).
//
// "Signed ⇒ journaled" is structural only if no module can reach the
// relays around the gate. This grep-test pins the transport layer:
// outside src/shared/publish-gate.js, src/background/index.js's
// message handlers, and src/shared/nostr-client.js itself, no module
// may call NostrClient.publishToRelays or send xray:relay:publish /
// xray:capture:publish. (A guard on publishToRelays alone would miss
// the portal sites, which publish through the message transport and
// never touch the pool directly — hence the message literals are
// guarded too.) A new sign-and-publish site must route through
// gatePublish — when this test fails, that is the fix, not widening
// the allow list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = fileURLToPath(new URL('../src', import.meta.url));

async function* walkJs(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) yield* walkJs(p);
        else if (entry.name.endsWith('.js')) yield p;
    }
}

const rel = (file) => 'src/' + relative(SRC_ROOT, file).split(sep).join('/');

// The three guarded patterns, each with its EXPLICIT allow list.
// Quote-delimited literals so prose in comments can't false-positive;
// backticks included so template-literal sends can't slip through.
const GUARDS = [
    {
        name: 'xray:capture:publish senders',
        pattern: /['"`]xray:capture:publish['"`]/,
        allowed: [
            'src/background/index.js',   // the handler itself — where the gate runs for this flow
            'src/reader/index.js'        // the capture families; every send lands in the gated handler
        ]
    },
    {
        name: 'xray:relay:publish senders',
        pattern: /['"`]xray:relay:publish['"`]/,
        allowed: [
            'src/background/index.js',       // the handler itself (the SW-side transport)
            'src/shared/publish-gate.js'     // relayPublishTransport / rebroadcastEvent — the ONE page-side sender
        ]
    },
    {
        name: 'NostrClient.publishToRelays callers',
        pattern: /NostrClient\s*\.\s*publishToRelays/,
        allowed: [
            'src/background/index.js',        // in-process transport injected into the gate + the relay:publish handler
            'src/shared/confirmed-publish.js', // default transport of publishConfirmed (itself composed inside the gate)
            'src/shared/entity-sync.js',       // in-process transport injected into the gate (sidepanel context)
            'src/shared/publish-gate.js'       // doc references in the gate's own header
        ]
    }
];

test('guard: no module reaches the relay transports around the publish gate (§3.2)', async () => {
    const violations = [];
    const seen = new Map(); // guard name → Set of allowed files that actually matched
    for (const g of GUARDS) seen.set(g.name, new Set());

    for await (const file of walkJs(SRC_ROOT)) {
        const path = rel(file);
        const text = await readFile(file, 'utf8');
        for (const g of GUARDS) {
            if (!g.pattern.test(text)) continue;
            if (g.allowed.includes(path)) seen.get(g.name).add(path);
            else violations.push(`${path} matches "${g.name}" — route it through gatePublish (src/shared/publish-gate.js)`);
        }
    }

    assert.deepEqual(violations, [],
        'a sign-and-publish site is bypassing the publish gate:\n' + violations.join('\n'));

    // Rot check: every allow-listed file still contains its pattern,
    // so a rename or refactor can't leave the list silently stale.
    for (const g of GUARDS) {
        for (const path of g.allowed) {
            assert.ok(seen.get(g.name).has(path),
                `${path} is allow-listed for "${g.name}" but no longer matches — prune the list`);
        }
    }
});

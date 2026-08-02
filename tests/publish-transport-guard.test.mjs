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
//
// Matching notes, honestly: the message patterns require QUOTE
// DELIMITERS (', ", or `) so plain prose can't false-positive — but
// backtick-quoted doc mentions DO match, and the publishToRelays
// pattern matches doc comments outright (publish-gate.js is listed
// purely for its header's two mentions). That is why the allow list
// pins EXACT per-file occurrence counts rather than mere membership:
// a NEW raw call added inside an allow-listed file changes its count
// and fails here, comment noise included in the ledger.

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

// The three guarded patterns, each with its EXPLICIT allow list of
// { file: expected occurrence count }. When adding a legitimate
// occurrence (a comment mention included), bump the count HERE with a
// justification in the same commit.
const GUARDS = [
    {
        name: 'xray:capture:publish senders',
        pattern: /['"`]xray:capture:publish['"`]/g,
        allowed: {
            'src/background/index.js': 1,   // the handler's own type comparison — where the gate runs for this flow
            'src/reader/index.js': 9        // the capture families; every send lands in the gated handler
        }
    },
    {
        name: 'xray:relay:publish senders',
        pattern: /['"`]xray:relay:publish['"`]/g,
        allowed: {
            'src/background/index.js': 1,     // the handler's own type comparison (the SW-side transport)
            'src/shared/publish-gate.js': 3   // the ONE page-side send (relayPublishTransport) + 2 backticked doc mentions
        }
    },
    {
        name: 'NostrClient.publishToRelays callers',
        pattern: /NostrClient\s*\.\s*publishToRelays/g,
        allowed: {
            'src/background/index.js': 2,         // relay:publish handler + the in-process transport injected into the gate
            'src/shared/confirmed-publish.js': 2, // publishConfirmed's default transport + its JSDoc mention
            'src/shared/entity-sync.js': 1,       // the in-process transport injected into the gate (sidepanel context)
            'src/shared/publish-gate.js': 2       // header doc mentions only — no call
        }
    }
];

test('guard: no module reaches the relay transports around the publish gate (§3.2)', async () => {
    const problems = [];
    const counts = new Map(); // guard name → Map(file → count)
    for (const g of GUARDS) counts.set(g.name, new Map());

    for await (const file of walkJs(SRC_ROOT)) {
        const path = rel(file);
        const text = await readFile(file, 'utf8');
        for (const g of GUARDS) {
            const n = [...text.matchAll(g.pattern)].length;
            if (n === 0) continue;
            counts.get(g.name).set(path, n);
            if (!(path in g.allowed)) {
                problems.push(`${path} matches "${g.name}" ${n}x — route it through gatePublish (src/shared/publish-gate.js)`);
            } else if (n !== g.allowed[path]) {
                problems.push(`${path}: "${g.name}" count ${n} != pinned ${g.allowed[path]} — a new occurrence must go through gatePublish (or update the pin WITH justification)`);
            }
        }
    }

    // Rot check: every allow-listed file still matches at all, so a
    // rename or refactor can't leave the list silently stale.
    for (const g of GUARDS) {
        for (const path of Object.keys(g.allowed)) {
            if (!counts.get(g.name).has(path)) {
                problems.push(`${path} is allow-listed for "${g.name}" but no longer matches — prune the list`);
            }
        }
    }

    assert.deepEqual(problems, [],
        'transport-guard violations:\n' + problems.join('\n'));
});

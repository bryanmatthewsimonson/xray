#!/usr/bin/env node
// Relay-replay consumer — FLF Epistack entry (win plan §5.4c, §7.3).
//
// Rebuilds the X-Ray graph from public relays with NO extension and NO
// dependencies — just a NOSTR REQ over a WebSocket (Node 21+ ships one
// globally). This is the "there is no server; the format outlives the
// app" claim, made runnable: point it at the auditor's key and it prints
// a kind-by-kind index and walks a verdict back to the exact source bytes
// it binds to.
//
//   node demos/relay-replay.mjs <npub-or-hex> [wss://relay ...]
//   node demos/relay-replay.mjs --self-test          # offline, verifies the pure parts
//
// The core is ~10 lines (collect + EOSE + index); everything else is
// framing so a judge can run it cold.

// --- minimal bech32 npub → hex (self-contained; no imports) ---
const B32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function bech32ToHex(npub) {
    const pos = npub.lastIndexOf('1');
    const data = npub.slice(pos + 1, -6);                 // drop hrp + '1' + 6-char checksum
    let bits = 0, val = 0; const bytes = [];
    for (const ch of data) {
        const d = B32.indexOf(ch);
        if (d === -1) throw new Error(`bad bech32 char: ${ch}`);
        val = (val << 5) | d; bits += 5;
        if (bits >= 8) { bits -= 8; bytes.push((val >> bits) & 0xff); }
    }
    return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}
const toHex = (k) => (/^npub1/.test(k) ? bech32ToHex(k) : k);

// The X-Ray kinds a consumer reassembles the graph from.
const KIND_LABEL = {
    0: 'profile', 10002: 'relay-list', 30023: 'source', 30040: 'claim', 30041: 'comment',
    30054: 'assessment', 30055: 'relationship', 30056: 'audit', 30057: 'audit-module',
    30058: 'prediction', 30059: 'resolution', 30062: 'forensic', 30063: 'verdict',
    30064: 'integrity', 32125: 'entity-article', 32126: 'account', 1985: 'label'
};
const KINDS = Object.keys(KIND_LABEL).map(Number);

// --- pure: index a bag of events + walk a verdict to its source ---
function indexEvents(events) {
    const byKind = {};
    const claimsByCoord = new Map();     // "30040:pubkey:d" → event
    const sourcesByHash = new Map();     // x-hash → 30023 event
    for (const ev of events) {
        byKind[ev.kind] = (byKind[ev.kind] || 0) + 1;
        const d = (ev.tags.find((t) => t[0] === 'd') || [])[1];
        const x = (ev.tags.find((t) => t[0] === 'x') || [])[1];
        if (ev.kind === 30040 && d) claimsByCoord.set(`30040:${ev.pubkey}:${d}`, ev);
        if (ev.kind === 30023 && x) sourcesByHash.set(x, ev);
    }
    // Verdict → claim coordinate (the `a` tag) → source x-hash.
    const walks = [];
    for (const ev of events) {
        if (ev.kind !== 30063) continue;
        const coord = (ev.tags.find((t) => t[0] === 'a') || [])[1] || null;
        const verdict = (ev.tags.find((t) => t[0] === 'verdict') || [])[1] || null;
        const claim = coord ? claimsByCoord.get(coord) || null : null;
        const claimX = claim ? (claim.tags.find((t) => t[0] === 'x') || [])[1] || null : null;
        walks.push({ verdict, coord, claim_found: !!claim, source_found: claimX ? sourcesByHash.has(claimX) : false });
    }
    return { byKind, walks, counts: { claims: claimsByCoord.size, sources: sourcesByHash.size } };
}

// --- self-test: verify the pure parts offline, no relay needed ---
function selfTest() {
    // A well-known npub with a well-known hex (jack's, from NIP-19 examples).
    const hex = bech32ToHex('npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m');
    if (hex !== '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2') {
        throw new Error(`bech32 decode mismatch: ${hex}`);
    }
    const events = [
        { kind: 30023, pubkey: 'AA', tags: [['d', 's1'], ['x', 'HASH1']] },
        { kind: 30040, pubkey: 'AA', tags: [['d', 'c1'], ['x', 'HASH1']] },
        { kind: 30063, pubkey: 'BB', tags: [['a', '30040:AA:c1'], ['verdict', 'contested']] },
        { kind: 30055, pubkey: 'AA', tags: [['relationship', 'contradicts']] }
    ];
    const ix = indexEvents(events);
    if (ix.byKind[30063] !== 1) throw new Error('verdict not counted');
    if (ix.walks.length !== 1 || !ix.walks[0].claim_found || !ix.walks[0].source_found) {
        throw new Error('verdict→claim→source walk failed');
    }
    console.log('✓ self-test passed — bech32 decode + event index + verdict→source walk');
}

function printIndex(ix, author) {
    console.log(`\nkind-by-kind index for ${author}:`);
    for (const k of KINDS) {
        if (ix.byKind[k]) console.log(`  ${String(k).padEnd(6)} ${KIND_LABEL[k].padEnd(16)} ${ix.byKind[k]}`);
    }
    console.log(`\nreassembled: ${ix.counts.claims} claim(s), ${ix.counts.sources} source(s)`);
    for (const w of ix.walks) {
        console.log(`  verdict "${w.verdict}" → ${w.coord} → claim ${w.claim_found ? 'found' : 'MISSING'}`
            + ` → source bytes ${w.source_found ? 'found ✓' : 'not on these relays'}`);
    }
    if (!ix.walks.length) console.log('  (no verdicts yet — run once the graph is published)');
}

// --- live: REQ the author's kinds off each relay, then index ---
async function replay(author, relays) {
    const hex = toHex(author);
    const events = new Map();   // id → event (dedupe across relays)
    await Promise.all(relays.map((url) => new Promise((resolve) => {
        let ws;
        try { ws = new WebSocket(url); } catch { return resolve(); }
        const done = () => { try { ws.close(); } catch {} resolve(); };
        const timer = setTimeout(done, 8000);
        ws.onopen = () => ws.send(JSON.stringify(['REQ', 'replay', { authors: [hex], kinds: KINDS }]));
        ws.onmessage = (m) => {
            let msg; try { msg = JSON.parse(m.data); } catch { return; }
            if (msg[0] === 'EVENT' && msg[2] && msg[2].id) events.set(msg[2].id, msg[2]);
            if (msg[0] === 'EOSE') { clearTimeout(timer); done(); }
        };
        ws.onerror = () => { clearTimeout(timer); done(); };
    })));
    console.log(`collected ${events.size} event(s) from ${relays.length} relay(s)`);
    printIndex(indexEvents([...events.values()]), author);
}

// --- entry ---
const args = process.argv.slice(2);
if (args[0] === '--self-test' || args.length === 0) {
    if (args.length === 0) console.log('usage: node demos/relay-replay.mjs <npub-or-hex> [wss://relay ...]\n');
    selfTest();
    process.exit(0);
}
const author = args[0];
const relays = args.slice(1).length ? args.slice(1)
    : ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];
if (typeof WebSocket === 'undefined') {
    console.error('This Node build has no global WebSocket (needs Node 21+). The self-test still runs offline.');
    process.exit(1);
}
await replay(author, relays);

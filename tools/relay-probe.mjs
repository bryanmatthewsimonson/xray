// Relay probe — the scripted form of docs/EPISTACK_RUNBOOK.md §1.
//
// Run this LOCALLY (Node 22+; relay hosts are typically blocked from
// sandboxed sessions):
//
//   node tools/relay-probe.mjs                     # probe the default shortlist
//   node tools/relay-probe.mjs wss://a wss://b     # probe specific relays
//   node tools/relay-probe.mjs --dry-run           # build+sign+verify only, no network
//   node tools/relay-probe.mjs --recheck relay-probe-state.json
//                                                  # ~24h later: retention re-check
//
// What it does:
//   A. Fetches each relay's NIP-11 info document and records the
//      limits that matter (max_message_length, max_event_tags, auth,
//      payment, retention).
//   B. Generates a THROWAWAY keypair (never the submission identity;
//      the private key is never printed or persisted) and publishes
//      one minimal, clearly-labeled disposable probe event per kind
//      family the corpus publish emits — plus one oversized 30023 to
//      test max_message_length against a real capture's size — then
//      reads each accepted event back by id.
//   C. --recheck re-queries the same ids: a relay that accepted but
//      purged is a REJECT for our purposes (runbook §1 step 3).
//
// Output: relay-probe-results.md (paste into the runbook §1 Results
// subsection) and relay-probe-state.json (input for --recheck). Both
// are gitignored.

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { Crypto } from '../src/shared/crypto.js';

const DEFAULT_RELAYS = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.nostr.band',
    'wss://relay.primal.net',
    'wss://offchain.pub'
];

// The kind families the corpus publish emits (runbook §1 step 2).
const PROBE_NOTE = 'X-Ray relay probe — disposable test event, safe to ignore or delete.';
const NOW = Math.floor(Date.now() / 1000);

function probeEvents(pubkey, largeKb) {
    const d = (s) => `xray-probe-${s}-${NOW}`;
    const base = (kind, tags, content = PROBE_NOTE) => ({
        kind, pubkey, created_at: NOW,
        tags: [...tags, ['t', 'xray-probe']],
        content
    });
    const events = [
        ['0',        base(0, [], JSON.stringify({ name: 'xray-probe', about: PROBE_NOTE }))],
        ['10002',    base(10002, [['r', 'wss://relay.damus.io'], ['r', 'wss://nos.lol']], '')],
        ['30023',    base(30023, [['d', d('article')], ['title', 'X-Ray probe'], ['published_at', String(NOW)], ['r', 'https://example.com/xray-probe'], ['x', 'a'.repeat(64)]], `# X-Ray probe\n\n${PROBE_NOTE}`)],
        ['30040',    base(30040, [['d', d('claim')], ['r', 'https://example.com/xray-probe']])],
        ['30041',    base(30041, [['d', d('comment')], ['r', 'https://example.com/xray-probe']])],
        ['30054',    base(30054, [['d', d('assess')], ['a', `30040:${pubkey}:${d('claim')}`], ['stance', '0'], ['L', 'xray/assessment'], ['l', 'missing-context', 'xray/assessment'], ['r', 'https://example.com/xray-probe']])],
        ['30055',    base(30055, [['d', d('rel')], ['a', `30040:${pubkey}:${d('claim')}`], ['relationship', 'supports']])],
        ['30056',    base(30056, [['d', d('mod')], ['module', 'internal_coherence'], ['x', 'a'.repeat(64)], ['r', 'https://example.com/xray-probe']])],
        ['30058',    base(30058, [['d', d('pred')], ['x', 'a'.repeat(64)], ['r', 'https://example.com/xray-probe']])],
        ['1985',     base(1985, [['L', 'xray/assessment'], ['l', 'missing-context', 'xray/assessment'], ['a', `30040:${pubkey}:${d('claim')}`], ['r', 'https://example.com/xray-probe']])],
        ['30062',    base(30062, [['d', d('forensic')], ['L', 'xray/forensic'], ['l', 'defense/frame-control', 'xray/forensic'], ['r', 'https://example.com/xray-probe']])],
        ['30063',    base(30063, [['d', d('verdict')], ['L', 'xray/adjudication'], ['l', 'unresolved', 'xray/adjudication'], ['a', `30040:${pubkey}:${d('claim')}`], ['r', 'https://example.com/xray-probe']])],
        ['30064',    base(30064, [['d', d('integrity')], ['r', 'https://example.com/xray-probe']])],
        ['30078',    base(30078, [['d', d('sync')], ['L', 'xray/entity-sync'], ['l', 'v1', 'xray/entity-sync'], ['entity-type', 'person']], 'probe-ciphertext')],
        ['32125',    base(32125, [['d', `${d('ent')}:https://example.com/xray-probe:about`], ['r', 'https://example.com/xray-probe'], ['p', pubkey, '', 'about'], ['entity-name', 'Probe Entity'], ['entity-type', 'person']])],
        ['32126',    base(32126, [['d', d('acct')], ['p', pubkey, '', 'account'], ['account-platform', 'web'], ['account-id', 'xray-probe']])],
        // The size test: a 30023 whose body approximates the longest
        // real capture — max_message_length in practice, not on paper.
        ['30023-large', base(30023,
            [['d', d('large')], ['title', 'X-Ray probe (size test)'], ['published_at', String(NOW)], ['r', 'https://example.com/xray-probe-large']],
            `# X-Ray probe size test\n\n${PROBE_NOTE}\n\n` + 'Lorem ipsum dolor sit amet. '.repeat(Math.ceil((largeKb * 1024) / 28)))]
    ];
    return events;
}

// ------------------------------------------------------------------
// Phase A — NIP-11
// ------------------------------------------------------------------

async function fetchNip11(relayUrl) {
    const httpUrl = relayUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
    try {
        const res = await fetch(httpUrl, {
            headers: { Accept: 'application/nostr+json' },
            signal: AbortSignal.timeout(10000)
        });
        if (!res.ok) return { error: `HTTP ${res.status}` };
        return await res.json();
    } catch (err) {
        return { error: err.message || String(err) };
    }
}

// ------------------------------------------------------------------
// Phase B — publish + read-back over one WebSocket per relay
// ------------------------------------------------------------------

function connect(relayUrl, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(relayUrl);
        const timer = setTimeout(() => { ws.close(); reject(new Error('connect timeout')); }, timeoutMs);
        ws.addEventListener('open', () => { clearTimeout(timer); resolve(ws); });
        ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('connect failed')); });
    });
}

function publishOne(ws, event, timeoutMs = 10000) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            ws.removeEventListener('message', onMessage);
            resolve({ ok: false, reason: 'no OK within 10s' });
        }, timeoutMs);
        const onMessage = (msg) => {
            try {
                const data = JSON.parse(msg.data);
                if (data[0] === 'OK' && data[1] === event.id) {
                    clearTimeout(timer);
                    ws.removeEventListener('message', onMessage);
                    resolve({ ok: data[2] === true, reason: data[3] || '' });
                }
            } catch (_) { /* non-JSON frame — ignore */ }
        };
        ws.addEventListener('message', onMessage);
        ws.send(JSON.stringify(['EVENT', event]));
    });
}

function queryIds(ws, ids, timeoutMs = 10000) {
    return new Promise((resolve) => {
        const sub = 'xray-probe-' + Math.random().toString(36).slice(2, 10);
        const found = new Set();
        const timer = setTimeout(done, timeoutMs);
        function done() {
            clearTimeout(timer);
            ws.removeEventListener('message', onMessage);
            try { ws.send(JSON.stringify(['CLOSE', sub])); } catch (_) { /* closing anyway */ }
            resolve(found);
        }
        const onMessage = (msg) => {
            try {
                const data = JSON.parse(msg.data);
                if (data[0] === 'EVENT' && data[1] === sub && data[2] && data[2].id) found.add(data[2].id);
                if (data[0] === 'EOSE' && data[1] === sub) done();
            } catch (_) { /* ignore */ }
        };
        ws.addEventListener('message', onMessage);
        ws.send(JSON.stringify(['REQ', sub, { ids }]));
    });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Burst rate-limiting looks like a kind rejection but isn't — a relay
// that answers "rate-limited: slow down" gets one patient retry so the
// probe measures POLICY, not politeness (relay.damus.io accepted
// exactly the first 8 events of a 150ms-spaced burst).
const RATE_LIMIT_RE = /rate|slow down|too (fast|many)/i;

async function probeRelay(relayUrl, events, delayMs) {
    const result = { relay: relayUrl, connect: null, accepts: {}, readback: {} };
    let ws;
    try {
        ws = await connect(relayUrl);
        result.connect = 'ok';
    } catch (err) {
        result.connect = err.message;
        return result;
    }
    try {
        for (const [label, event] of events) {
            let res = await publishOne(ws, event);
            if (!res.ok && RATE_LIMIT_RE.test(res.reason || '')) {
                await sleep(Math.max(3000, delayMs * 2));
                res = await publishOne(ws, event);
                if (res.ok) res = { ...res, retried: true };
            }
            result.accepts[label] = res;
            await sleep(delayMs);   // be a polite client
        }
        const acceptedIds = events
            .filter(([label]) => result.accepts[label] && result.accepts[label].ok)
            .map(([, e]) => e.id);
        if (acceptedIds.length > 0) {
            const found = await queryIds(ws, acceptedIds);
            for (const [label, event] of events) {
                if (result.accepts[label] && result.accepts[label].ok) {
                    result.readback[label] = found.has(event.id);
                }
            }
        }
    } finally {
        try { ws.close(); } catch (_) { /* done */ }
    }
    return result;
}

async function recheckRelay(relayUrl, idsByLabel, acceptedLabels) {
    const result = { relay: relayUrl, connect: null, retained: {} };
    let ws;
    try {
        ws = await connect(relayUrl);
        result.connect = 'ok';
    } catch (err) {
        result.connect = err.message;
        return result;
    }
    try {
        const ids = Object.values(idsByLabel);
        const found = await queryIds(ws, ids);
        for (const [label, id] of Object.entries(idsByLabel)) {
            // Only events this relay ACCEPTED can be "purged" — a
            // rejected event was never there to lose.
            result.retained[label] = acceptedLabels.includes(label)
                ? found.has(id)
                : null;
        }
    } finally {
        try { ws.close(); } catch (_) { /* done */ }
    }
    return result;
}

// ------------------------------------------------------------------
// Reporting
// ------------------------------------------------------------------

const flag = (v) => v === true ? 'yes' : v === false ? 'no' : (v ?? '—');

function nip11Table(rows) {
    const out = ['| relay | software | max msg | max tags | auth | payment | restricted writes |',
                 '|---|---|---|---|---|---|---|'];
    for (const { relay, info } of rows) {
        if (info.error) { out.push(`| ${relay} | fetch failed: ${info.error} | | | | | |`); continue; }
        const lim = info.limitation || {};
        out.push(`| ${relay} | ${info.software || '?'} ${info.version || ''} | ${lim.max_message_length ?? '—'} | ${lim.max_event_tags ?? '—'} | ${flag(lim.auth_required)} | ${flag(lim.payment_required)} | ${flag(lim.restricted_writes)} |`);
    }
    return out.join('\n');
}

function acceptanceTable(results, labels) {
    const out = [`| kind | ${results.map((r) => r.relay.replace('wss://', '')).join(' | ')} |`,
                 `|---|${results.map(() => '---').join('|')}|`];
    for (const label of labels) {
        const cells = results.map((r) => {
            if (r.connect !== 'ok') return `✗ (${r.connect})`;
            const a = r.accepts[label];
            if (!a) return '—';
            if (!a.ok) return `✗ ${a.reason || 'rejected'}`;
            const mark = a.retried ? '✓ (after rate-limit retry)' : '✓';
            return r.readback[label] === false ? `${mark} but NOT readable` : mark;
        });
        out.push(`| ${label} | ${cells.join(' | ')} |`);
    }
    return out.join('\n');
}

function retentionTable(results, labels) {
    const out = [`| kind | ${results.map((r) => r.relay.replace('wss://', '')).join(' | ')} |`,
                 `|---|${results.map(() => '---').join('|')}|`];
    for (const label of labels) {
        const cells = results.map((r) => {
            if (r.connect !== 'ok') return `✗ (${r.connect})`;
            const v = r.retained[label];
            return v === true ? 'retained' : v === false ? 'PURGED' : '—';
        });
        out.push(`| ${label} | ${cells.join(' | ')} |`);
    }
    return out.join('\n');
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const recheckIdx = args.indexOf('--recheck');
    const largeIdx = args.indexOf('--large-kb');
    const largeKb = largeIdx !== -1 ? Number(args[largeIdx + 1]) || 120 : 120;
    const delayIdx = args.indexOf('--delay-ms');
    const delayMs = delayIdx !== -1 ? Number(args[delayIdx + 1]) || 150 : 150;
    const relayArgs = args.filter((a) =>
        a.startsWith('wss://') || a.startsWith('ws://'));
    const relays = relayArgs.length ? relayArgs : DEFAULT_RELAYS;

    // --recheck: retention pass over a prior run's state.
    if (recheckIdx !== -1) {
        const stateFile = args[recheckIdx + 1] || 'relay-probe-state.json';
        if (!existsSync(stateFile)) {
            console.error(`[probe] no state file at '${stateFile}' — the recheck is the DAY-TWO pass.`);
            console.error('[probe] Run the probe first (node tools/relay-probe.mjs); it writes relay-probe-state.json, then re-run with --recheck ~24h later.');
            process.exit(1);
        }
        const state = JSON.parse(readFileSync(stateFile, 'utf8'));
        const results = await Promise.all(state.relays.map((r) =>
            recheckRelay(r, state.ids, (state.accepted && state.accepted[r]) || Object.keys(state.ids))));
        const labels = Object.keys(state.ids);
        const md = [
            `## Relay probe — retention re-check (${new Date().toISOString()})`,
            '', `Probe published: ${state.generatedAt}. A relay that accepted but purged is a REJECT (runbook §1 step 3).`,
            '', retentionTable(results, labels), ''
        ].join('\n');
        writeFileSync('relay-probe-results.md', md);
        console.log(md);
        return;
    }

    // Throwaway identity — never the submission key; sk never printed.
    const sk = Crypto.generatePrivateKey();
    const pubkey = Crypto.getPublicKey(sk);
    console.error(`[probe] throwaway pubkey: ${pubkey}`);

    const events = probeEvents(pubkey, largeKb);
    for (const [label, event] of events) {
        const signed = await Crypto.signEvent(event, sk);
        if (!signed) throw new Error(`signing failed for ${label}`);
        if (!(await Crypto.verifySignature(signed))) throw new Error(`self-verify failed for ${label}`);
    }
    const labels = events.map(([l]) => l);
    console.error(`[probe] built + signed + locally verified ${events.length} events`);

    if (dryRun) {
        console.log('DRY RUN — all events signed and locally verified. No network calls made.');
        for (const [label, e] of events) {
            console.log(`  ${label.padEnd(12)} kind=${String(e.kind).padEnd(6)} id=${e.id.slice(0, 16)}… bytes≈${JSON.stringify(e).length}`);
        }
        return;
    }

    // Phase A + B.
    const nip11 = await Promise.all(relays.map(async (relay) => ({ relay, info: await fetchNip11(relay) })));
    const results = await Promise.all(relays.map((relay) => probeRelay(relay, events, delayMs)));

    // Shortlist: connected + accepted AND read back every event.
    const shortlist = results
        .filter((r) => r.connect === 'ok'
            && labels.every((l) => r.accepts[l] && r.accepts[l].ok && r.readback[l] !== false))
        .map((r) => r.relay);

    const md = [
        `## Relay probe results (${new Date().toISOString()})`,
        '', `Throwaway pubkey: \`${pubkey}\` (disposable — not the submission identity).`,
        '', '### NIP-11 limits', '', nip11Table(nip11),
        '', `### Acceptance + read-back (large 30023 ≈ ${largeKb} KB body)`, '', acceptanceTable(results, labels),
        '', `### Shortlist (accepted + read back everything)`, '',
        shortlist.length ? shortlist.map((r) => `- ${r}`).join('\n') : '- NONE — see rejects above',
        '', `> Retention re-check due ~24h: \`node tools/relay-probe.mjs --recheck relay-probe-state.json\``, ''
    ].join('\n');

    writeFileSync('relay-probe-results.md', md);
    writeFileSync('relay-probe-state.json', JSON.stringify({
        generatedAt: new Date().toISOString(),
        pubkey,
        relays,
        ids: Object.fromEntries(events.map(([label, e]) => [label, e.id])),
        // Per-relay acceptance: the recheck only calls a missing event
        // "purged" on a relay that actually accepted it.
        accepted: Object.fromEntries(results.map((r) => [
            r.relay,
            labels.filter((l) => r.accepts[l] && r.accepts[l].ok)
        ]))
    }, null, 2));
    console.log(md);
    console.error('[probe] wrote relay-probe-results.md + relay-probe-state.json');
}

main().catch((err) => { console.error('[probe] fatal:', err); process.exit(1); });

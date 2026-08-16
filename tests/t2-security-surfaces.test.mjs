// T2 — security-surface regressions (docs/ROAD_TO_1_0.md B5, B6, B18).
//
// The NIP-07 path is the sharpest of these: the bridge and the client
// talk over window.postMessage, which every script on a captured page
// can read AND write. Captured pages are adversarial by design here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

test('B6: NIP-07 request ids are unguessable, never a counter', () => {
    const src = read('src', 'content', 'nip07-client.js');
    assert.doesNotMatch(src, /const id = \+\+reqSeq/,
        'a sequential id lets a hostile page predict the next one and forge the reply');
    assert.match(src, /randomUUID|getRandomValues/,
        'ids come from a CSPRNG');
});

test('B6: a signed event returned through the page is verified', () => {
    const src = read('src', 'content', 'nip07-client.js');
    const sign = src.slice(src.indexOf('signEvent: async'), src.indexOf('getRelays:'));
    assert.ok(sign.length > 0, 'found the signEvent path');
    assert.match(sign, /verifySignature/,
        'the returned event must pass BIP-340 verification — it crossed the page world');
    assert.match(sign, /pubkey !== unsignedEvent\.pubkey/,
        'and must be signed by the key we asked for');
});

test('B6: the bridge exposes no nip04 oracle to the page', () => {
    const bridge = read('src', 'page', 'nip07-bridge.js');
    assert.doesNotMatch(bridge, /case 'nip04(Encrypt|Decrypt)'/,
        'unreachable from the client, but callable by postMessage from any page');
    // The methods the bridge legitimately serves.
    for (const m of ['getPublicKey', 'signEvent', 'getRelays', 'probe']) {
        assert.match(bridge, new RegExp(`case '${m}'`), `${m} still served`);
    }
});

test('B5: the capture pipeline exposes no page-writable control surface', () => {
    const src = read('src', 'page', 'api-interceptor.js');
    assert.doesNotMatch(src, /window\.__xrApiHookSetPatterns\s*=/,
        'a page could rewrite the capture patterns');
    assert.doesNotMatch(src, /window\.__xrApiHookMatch\s*=/,
        'and probe them — also an installation fingerprint');
});

// REVERSED 2026-08-11. T2 removed this entry on the reasoning that no
// `getURL` call site referenced it — but that is the wrong test for a
// web_accessible_resource, and CLAUDE.md documented the entry as
// deliberate. It was removed, NIP-07 provider detection stopped working
// in the field, and it is restored. The fingerprinting surface it costs
// (a site can probe for the extension's stable ID) is a real but minor
// tradeoff, accepted here because the bridge is the whole NIP-07 path.
//
// The lesson kept: "no caller greps for it" does not establish that a
// manifest declaration is inert. Do not re-remove this without loading
// the extension and confirming NIP-07 detection still works.
test('B5: the NIP-07 bridge stays web-accessible (restored after a field break)', () => {
    const manifest = JSON.parse(read('manifest.json'));
    const resources = (manifest.web_accessible_resources || []).flatMap(w => w.resources || []);
    assert.ok(resources.includes('src/page/nip07-bridge.js'),
        'the MAIN-world bridge must stay declared — removing it broke NIP-07 detection in the field');
});

test('B18: the threat model exists and covers every asset class', () => {
    const tm = read('docs', 'THREAT_MODEL.md');
    for (const asset of ['local_primary_identity', 'local_keys', 'capture pattern']) {
        assert.ok(tm.includes(asset), `names the asset: ${asset}`);
    }
    // Gaps are recorded rather than quietly omitted — a threat model
    // that lists only solved problems is marketing.
    assert.match(tm, /## 5\. Known gaps/, 'records what is NOT covered');
    assert.match(tm, /G1|G2|G3/, 'and enumerates them');
});

test('B18: every third-party network destination has a named boundary row', () => {
    // A threat model goes stale by OMISSION, not by contradiction: a new
    // egress path that nobody adds a row for reads, to a later reviewer,
    // exactly like a path that was considered and found safe. So the
    // currency check is mechanical — if the code can reach a host, the
    // document must name it.
    const tm = read('docs', 'THREAT_MODEL.md');
    const destinations = [
        ['api.anthropic.com', /B[0-9]+ \| extension → (LLM|cloud)/],
        ['api.assemblyai.com', /B13/]
    ];
    for (const [host, row] of destinations) {
        assert.match(tm, row, `no boundary row covers ${host}`);
    }
    // The direct-cloud path is a DIFFERENT boundary from the
    // companion-mediated one; B9's control (keys held in the companion
    // child process) does not exist when there is no companion, so B9
    // must not be left implying it covers both.
    assert.match(tm, /B9 \| extension → cloud provider \(\*\*via the companion\*\*\)/,
        'B9 must say explicitly that it covers the companion-mediated path only');
    assert.match(tm, /G9/, 'the direct path\'s accepted residual must be recorded as a gap');
});

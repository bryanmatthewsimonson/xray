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

test('B5: no web_accessible_resource without a getURL call site', () => {
    const manifest = JSON.parse(read('manifest.json'));
    const wars = manifest.web_accessible_resources || [];
    const resources = wars.flatMap(w => w.resources || []);
    assert.ok(!resources.includes('src/page/nip07-bridge.js'),
        'the bridge is injected declaratively; exposing it let any site fingerprint the extension by its stable ID');
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

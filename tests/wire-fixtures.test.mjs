// Golden WIRE fixtures — verify, re-parse and (where deterministic)
// REBUILD every checked-in signed event under tests/fixtures/wire/.
//
// Pins (RESET_PLAN §7 R0 "Golden fixtures before any refactor thread
// starts" — "`tests/fixtures/wire/<kind>.json` … re-verify id +
// signature and re-parse every wire fixture"; audit finding WIRE-05 in
// docs/audit-2026-09-05/wire-and-schema.md — "Builder tests assert tag
// presence, never byte-identical output or id recompute against a
// checked-in event"; WIRE-02 for the emit-set rule):
//   1. every fixture's event verifies (verifyEvents, id = getEventHash,
//      pubkey is one of the three test-vector keys);
//   2. every fixture re-parses with the CURRENT read-side code and
//      echoes its own inputs (tests/tools/wire-fixture-parsers.mjs);
//   3. rebuild:'exact' fixtures REBUILD from their inputs + createdAt
//      to identical kind/tags/content AND identical id and sig — a red
//      here is a wire-format change that must be a deliberate
//      regeneration carrying the "Wire format:" PR callout;
//      verify-only fixtures pin what their builders cannot reproduce
//      (the capture article's dated header, the 30078 ciphertext, the
//      hand-built kind-5 literal);
//   4. the EMITTED-KIND rule — every kind a builder module emits has a
//      fixture and every fixture kind is emitted; retired / reserved /
//      free kinds have none;
//   5. hygiene over the raw fixture text — only test-vector pubkeys in
//      pubkey positions, no private key anywhere, only RFC-2606 hosts;
//   6. determinism — the generator regenerates every fixture in memory
//      and they deep-equal the checked-in files.
//
// House idiom: a positive sanity test proves the loader sees the files
// and the scanner sees the emitters, then the guards enforce.
//
// Deviation from the R0 bullet, stated honestly: the events are builder-
// produced under test keys, not the maintainer's journal export (which
// is partial per WIRE-09 and carries real identities).
//
// Provenance: INTERPRETATION (2026-09-14) — an agent artifact under
// RESET_PLAN R0; the maintainer has not ruled on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// storage.js (pulled in via event-builder.js / entity-sync.js) probes
// chrome.storage at module load; stub it first.
globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const generator = await import('./tools/gen-wire-fixtures.mjs');
const { PARSERS } = await import('./tools/wire-fixture-parsers.mjs');
const { REPO_ROOT, sortKeysDeep, stableStringify } = await import('./tools/idb-fixture-harness.mjs');
const { ALLOWED_PUBKEYS, ALLOWED_PRIVATE_KEYS, ALLOWED_NSECS, FIXED_TIME_S, signWith, TEST_KEYS } =
    await import('./tools/fixture-keys.mjs');
const { Crypto } = await import('../src/shared/crypto.js');
const { verifyEvents } = await import('../src/shared/nostr-events.js');
const { EventBuilder } = await import('../src/shared/event-builder.js');
const { deriveAccountPubkey, normalizeAuthor } = await import('../src/shared/identity/platform-account.js');

const { FIXTURE_DIR, SPECS, KEYS, ARTICLE_DATE_LINE_RE, DELETION_CONTENT } = generator;
const rel = (abs) => relative(REPO_ROOT, abs).split(sep).join('/');

// ---------------------------------------------------------------- loading

const FILES = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')).sort();
const RAW = new Map(FILES.map((f) => [f, readFileSync(join(FIXTURE_DIR, f), 'utf8')]));
const FIXTURES = new Map(FILES.map((f) => [f, JSON.parse(RAW.get(f))]));
const nameOf = (f) => `${f.kind}-${f.shape}`;

// Kinds CONSTITUTION Art. 10 lists as retired / reserved, plus the
// Phase-9a scaffold numbers — none may have a fixture or an emitter.
// Provenance: R-018, R-014 (seed row, pending)
const NEVER_EMITTED = [30043, 30067, 30065, 30066, 30050, 30051, 30052, 30053, 9803];

// The builder modules whose `kind:` literals and KIND constants define
// the emit set (map-wire: every builder lives in one of these).
const BUILDER_MODULES = [
    'src/shared/event-builder.js', 'src/shared/metadata/builders.js', 'src/shared/audit/builders.js',
    'src/shared/truth-builders.js', 'src/shared/corpus-publish.js', 'src/shared/entity-page-publish.js',
    'src/shared/extraction-publish.js', 'src/shared/identity-builders.js', 'src/shared/mention-notes.js',
    'src/shared/entity-sync.js'
];
// `kind: N` literals outside the builder modules that are NOT emissions
// (file → kinds), so a new emitter elsewhere is a red.
const NON_EMITTING_LITERALS = {
    'src/shared/network-trust.js': [3]      // synthesizeContactList — local, never published
};

// Line comments first (one carries a literal `revision/*`), then block
// comments; `//` preceded by a quote/colon/backtick (URLs, regexes) is kept.
const stripComments = (src) => src.replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
function emittedKinds(source) {
    const code = stripComments(source);
    const kinds = new Set();
    for (const m of code.matchAll(/\bkind:\s*(\d+)\b/g)) kinds.add(Number(m[1]));
    for (const m of code.matchAll(/\b((?:KIND_[A-Z_]+)|(?:[A-Z_]+_KIND))\s*=\s*(\d+)\b/g)) {
        if (!/RESERVED/.test(m[1])) kinds.add(Number(m[2]));
    }
    return kinds;
}
function walkJs(dir, out = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walkJs(p, out);
        else if (e.name.endsWith('.js')) out.push(p);
    }
    return out;
}

// The one non-key 64-hex value allowed in a pubkey position: the DERIVED
// platform-account identifier (deriveAccountPubkey — a hash of
// platform:stableId whose scalar is discarded, never a held key).
async function derivedAccountPubkeys() {
    const out = new Set();
    for (const f of FIXTURES.values()) {
        if (f.kind !== 32126) continue;
        out.add(await deriveAccountPubkey(f.inputs.platform, normalizeAuthor(f.inputs.platform, f.inputs.raw).stableId));
    }
    return out;
}

// ---------------------------------------------------------------- 0. sanity

test('sanity: the fixture dir loads, every file names a spec, and one fixture verifies end to end', async () => {
    assert.ok(FILES.length >= 1, 'no fixtures under tests/fixtures/wire/');
    assert.equal(FILES.length, SPECS.length, 'one file per spec (regenerate: node tests/tools/gen-wire-fixtures.mjs)');
    for (const [file, f] of FIXTURES) {
        assert.equal(file, `${nameOf(f)}.json`, `${file}: file name must be <kind>-<shape>.json`);
        assert.ok(generator.specFor(f.kind, f.shape), `${file}: no spec in gen-wire-fixtures.mjs`);
        assert.ok(PARSERS[nameOf(f)], `${file}: no parser entry in wire-fixture-parsers.mjs`);
        for (const k of ['kind', 'shape', 'builder', 'signer', 'createdAt', 'inputs', 'rebuild', 'notes', 'event']) {
            assert.ok(k in f, `${file}: missing field ${k}`);
        }
        assert.ok(['exact', 'verify-only'].includes(f.rebuild), `${file}: rebuild must be exact|verify-only`);
        assert.ok(KEYS[f.signer], `${file}: signer must be TV1|TV3`);
        assert.equal(f.createdAt, FIXED_TIME_S, `${file}: createdAt is FIXED_TIME_S`);
    }
    const first = FIXTURES.get('30040-claim.json');
    assert.ok(first, '30040-claim.json exists');
    assert.equal((await verifyEvents([first.event])).valid.length, 1);
    assert.equal(first.event.id, await Crypto.getEventHash(first.event));
});

// ---------------------------------------------------------------- 1. verify

for (const [file, f] of FIXTURES) {
    test(`${file}: verifies (id = getEventHash, valid Schnorr sig, test-vector pubkey, signer ${f.signer})`, async () => {
        const ev = f.event;
        assert.equal(ev.kind, f.kind, 'event.kind = fixture.kind');
        assert.equal(ev.created_at, f.createdAt, 'event.created_at = fixture.createdAt');
        assert.equal((await verifyEvents([ev])).valid.length, 1, 'verifyEvents accepts it');
        assert.equal(ev.id, await Crypto.getEventHash(ev), 'id is the NIP-01 hash');
        assert.equal(await Crypto.verifySignature(ev), true);
        assert.ok(ALLOWED_PUBKEYS.includes(ev.pubkey), 'pubkey is a test-vector key');
        assert.equal(ev.pubkey, KEYS[f.signer].pubkey, 'pubkey matches the declared signer');
        for (const t of ev.tags) {
            assert.ok(Array.isArray(t) && t.length > 0 && t.every((v) => typeof v === 'string'), `${JSON.stringify(t)}: every tag atom is a string`);
        }
    });
}

// ---------------------------------------------------------------- 2. parse

const CTX = {
    keys: KEYS, DELETION_CONTENT,
    syncConversationKey: generator.syncConversationKey, syncEntityWithKey: generator.syncEntityWithKey
};
for (const [file, f] of FIXTURES) {
    test(`${file}: re-parses with the current reader and echoes its inputs`, async () => {
        const { parsed, checks } = await PARSERS[nameOf(f)](f, f.event, CTX);
        assert.ok(parsed !== null && parsed !== undefined, 'parse is non-null');
        assert.ok(checks.length >= 2, 'the entry asserts something');
        for (const [label, actual, expected] of checks) {
            assert.deepEqual(actual, expected, `${file}: ${label}`);
        }
    });
}

// ---------------------------------------------------------------- 3. rebuild

const WIRE_CHANGE = 'WIRE-FORMAT CHANGE: the current builder no longer reproduces the golden event. If deliberate, '
    + 'regenerate (node tests/tools/gen-wire-fixtures.mjs) in the same PR and carry the "Wire format:" callout '
    + '(.claude/skills/ecosystem-pm); if not, this is a regression.';

for (const [file, f] of FIXTURES) {
    if (f.rebuild !== 'exact') continue;
    test(`${file}: rebuilds from its inputs to the identical id and sig`, async () => {
        const unsigned = await generator.rebuildUnsigned(f);
        assert.equal(unsigned.pubkey, KEYS[f.signer].pubkey);
        const rebuilt = await signWith(unsigned, KEYS[f.signer]);
        assert.equal(rebuilt.kind, f.event.kind, `${file}: kind — ${WIRE_CHANGE}`);
        assert.deepEqual(rebuilt.tags, f.event.tags, `${file}: tags — ${WIRE_CHANGE}`);       // raw arrays, never normalized
        assert.equal(rebuilt.content, f.event.content, `${file}: content — ${WIRE_CHANGE}`);
        assert.equal(rebuilt.id, f.event.id, `${file}: id — ${WIRE_CHANGE}`);
        assert.equal(rebuilt.sig, f.event.sig, `${file}: sig (deterministic Schnorr) — ${WIRE_CHANGE}`);
    });
}

test('30023-capture-article (verify-only): tags exact, content exact once the dated header line is stripped', async () => {
    const f = FIXTURES.get('30023-capture-article.json');
    assert.equal(f.rebuild, 'verify-only');
    assert.match(f.event.content, ARTICLE_DATE_LINE_RE, 'the pinned content carries the Archived line the regex strips');
    const fresh = await generator.rebuildUnsigned(f);
    assert.deepEqual(fresh.tags, f.event.tags, `tags — ${WIRE_CHANGE}`);
    assert.equal(fresh.content.replace(ARTICLE_DATE_LINE_RE, ''), f.event.content.replace(ARTICLE_DATE_LINE_RE, ''), `content — ${WIRE_CHANGE}`);
    assert.notEqual(fresh.content.replace(ARTICLE_DATE_LINE_RE, ''), fresh.content, 'the strip removed something');
});

test('30078-entity-sync (verify-only): tags exact for the pinned ciphertext; plaintext re-derives (parser test decrypts)', async () => {
    const f = FIXTURES.get('30078-entity-sync.json');
    assert.equal(f.rebuild, 'verify-only');
    const expected = EventBuilder.buildEntitySyncEvent(f.inputs.entityId, f.event.content, f.inputs.entityType, f.inputs.userPubkey);
    assert.deepEqual(f.event.tags, expected.tags, `tags — ${WIRE_CHANGE}`);
    assert.equal(f.event.content, expected.content);
    assert.match(f.event.content, /^[A-Za-z0-9+/=]+$/, 'content is base64 NIP-44 payload, not plaintext');
});

test('5-deletion (verify-only): the clearRemote literal rebuilds byte-identically (hand-built, no builder function)', async () => {
    const f = FIXTURES.get('5-deletion.json');
    const rebuilt = await signWith(await generator.rebuildUnsigned(f), KEYS[f.signer]);
    assert.deepEqual({ tags: rebuilt.tags, content: rebuilt.content, id: rebuilt.id, sig: rebuilt.sig },
        { tags: f.event.tags, content: f.event.content, id: f.event.id, sig: f.event.sig });
    assert.equal(f.event.content, 'X-Ray entity sync — clear remote');
    assert.deepEqual(f.event.tags[f.event.tags.length - 1], ['k', '30078']);
});

// ---------------------------------------------------------------- 4. emitted-kind rule

test('emitted-kind rule: every kind a builder module emits has a fixture, and every fixture kind is emitted', () => {
    const emitted = new Set();
    for (const m of BUILDER_MODULES) {
        for (const k of emittedKinds(readFileSync(join(REPO_ROOT, m), 'utf8'))) emitted.add(k);
    }
    // Sanity: the scanner sees the literal families and the constant families.
    assert.ok(emitted.has(30023) && emitted.has(5) && emitted.has(1), 'scanner sees kind: literals (event-builder, entity-sync, mention-notes)');
    assert.ok(emitted.has(30056) && emitted.has(30063) && emitted.has(30069), 'scanner sees KIND_ / _KIND constants');
    assert.ok(!emitted.has(30065), 'a *_RESERVED constant is not an emission');

    const fixtureKinds = new Set([...FIXTURES.values()].map((f) => f.kind));
    const missingFixture = [...emitted].filter((k) => !fixtureKinds.has(k)).sort((a, b) => a - b);
    const notEmitted = [...fixtureKinds].filter((k) => !emitted.has(k)).sort((a, b) => a - b);
    assert.deepEqual(missingFixture, [], `emitted kinds with NO fixture (add a spec + regenerate): ${missingFixture}`);
    assert.deepEqual(notEmitted, [], `fixture kinds no builder emits (retired? delete the fixture): ${notEmitted}`);
});

test('emitted-kind rule: no fixture and no emitter for retired / reserved / free kinds (Art. 10)', () => {
    for (const k of NEVER_EMITTED) {
        assert.ok(![...FIXTURES.values()].some((f) => f.kind === k), `kind ${k} must have no fixture`);
        for (const m of BUILDER_MODULES) {
            assert.ok(!emittedKinds(readFileSync(join(REPO_ROOT, m), 'utf8')).has(k), `${m} must not emit ${k}`);
        }
    }
    const shapes1985 = [...FIXTURES.values()].filter((f) => f.kind === 1985).map((f) => f.shape).sort();
    assert.deepEqual(shapes1985, ['assessment-mirror', 'forensic-mirror', 'review-label', 'verdict-mirror'], 'all four X-Ray label shapes');
    const shapes30023 = [...FIXTURES.values()].filter((f) => f.kind === 30023).map((f) => f.shape).sort();
    assert.deepEqual(shapes30023, ['capture-article', 'case-brief-article', 'entity-page-article'], 'all three 30023 shapes');
});

test('emitted-kind rule: a `kind: N` literal outside the builder modules is either allowlisted as non-emitting or a new emitter needing a fixture', () => {
    const found = {};
    for (const abs of walkJs(join(REPO_ROOT, 'src'))) {
        const file = rel(abs);
        if (BUILDER_MODULES.includes(file)) continue;
        const kinds = [...stripComments(readFileSync(abs, 'utf8')).matchAll(/\bkind:\s*(\d+)\b/g)].map((m) => Number(m[1]));
        if (kinds.length) found[file] = [...new Set(kinds)].sort((a, b) => a - b);
    }
    assert.ok(Object.keys(found).length >= 1, 'scanner sees the allowlisted non-emitting literal');
    assert.deepEqual(found, NON_EMITTING_LITERALS, 'a new `kind: N` literal outside BUILDER_MODULES: add it to BUILDER_MODULES (+ fixture) or to NON_EMITTING_LITERALS with a reason');
});

// ---------------------------------------------------------------- 5. hygiene

const HEX64 = /\b[0-9a-f]{64}\b/g;
const URL_RE = /\b(?:https?|wss?):\/\/[^\s"'\\)<>]+/g;
const ALLOWED_HOSTS = new Set(['example.com', 'example.org', 'relay.example']);
// Builder-baked, not fixture input: corpus-publish.js XRAY_URL in the case-brief footer.
const BUILDER_BAKED_URLS = new Set(['https://github.com/bryanmatthewsimonson/xray']);
const PUBKEY_INPUT_KEYS = new Set(['pubkey', 'userPubkey', 'entityPubkey', 'subjectPubkey', 'publisherPubkey', 'creatorPubkey',
    'linkedEntityPubkey', 'accountPubkey', 'publishedPubkey', 'claimAuthorPubkey', 'delegatorPubkey']);
const FORBIDDEN_KEYS = /^(privateKey|privkey|secretKey|nsec|privateKeyHex)$/;

function* pubkeyPositions(value, path = '$') {
    if (Array.isArray(value)) {
        if (typeof value[0] === 'string' && ['p', 'delegation', 'owned'].includes(value[0]) && typeof value[1] === 'string') yield [`${path}[1] (${value[0]} tag)`, value[1]];
        for (let i = 0; i < value.length; i++) yield* pubkeyPositions(value[i], `${path}[${i}]`);
    } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
            assert.ok(!FORBIDDEN_KEYS.test(k), `${path}.${k}: a private-key-shaped field in a fixture`);
            if (PUBKEY_INPUT_KEYS.has(k) && typeof v === 'string') yield [`${path}.${k}`, v];
            if (k === 'aboutPubkeys' && Array.isArray(v)) for (const pk of v) yield [`${path}.${k}[]`, pk];
            if (k === 'auditor' && v && v.kind === 'human') yield [`${path}.auditor.id`, v.id];
            yield* pubkeyPositions(v, `${path}.${k}`);
        }
    } else if (typeof value === 'string') {
        const m = /^\d+:([0-9a-f]{64}):/.exec(value);            // an addressable coordinate
        if (m) yield [`${path} (coordinate)`, m[1]];
    }
}

test('hygiene: only test-vector pubkeys in pubkey positions; no private key or nsec anywhere; only RFC-2606 hosts', async () => {
    const allowedPubkeys = new Set([...ALLOWED_PUBKEYS, ...(await derivedAccountPubkeys())]);
    assert.equal(allowedPubkeys.size, ALLOWED_PUBKEYS.length + 1, 'exactly one derived account identifier is admitted');
    let positions = 0;
    for (const [file, f] of FIXTURES) {
        const raw = RAW.get(file);
        for (const hex of raw.match(HEX64) || []) {
            assert.ok(!ALLOWED_PRIVATE_KEYS.includes(hex), `${file}: a test-vector PRIVATE key appears in plaintext`);
        }
        for (const [k] of TEST_KEYS.map((x) => [x.privateKey])) assert.ok(!raw.includes(k), `${file}: private key ${k.slice(-4)} present`);
        for (const nsec of raw.match(/nsec1[0-9a-z]+/g) || []) {
            assert.ok(ALLOWED_NSECS.includes(nsec), `${file}: unknown nsec ${nsec.slice(0, 12)}…`);
        }
        assert.ok(!/nsec1/.test(raw), `${file}: no nsec at all is expected in a wire fixture`);
        for (const [where, pk] of pubkeyPositions(f)) {
            positions++;
            assert.ok(allowedPubkeys.has(pk), `${file}: ${where} = ${pk} is not a test-vector (or derived-account) pubkey`);
        }
        for (const [url] of raw.matchAll(URL_RE)) {
            const host = url.split('/')[2].split(':')[0];
            if (ALLOWED_HOSTS.has(host)) continue;
            assert.ok(BUILDER_BAKED_URLS.has(url), `${file}: ${url} — host ${host} is not example.com / example.org / relay.example`);
        }
    }
    assert.ok(positions >= 60, `sanity: the walker saw pubkey positions (${positions})`);
});

test('hygiene: fixture files are pretty JSON with sorted keys and a trailing newline (byte-stable)', () => {
    for (const [file, f] of FIXTURES) {
        assert.equal(RAW.get(file), stableStringify(f), `${file}: not stableStringify output — regenerate`);
        assert.deepEqual(f.inputs, sortKeysDeep(f.inputs));
    }
});

// ---------------------------------------------------------------- 6. determinism

test('determinism: the generator regenerates every fixture in memory and deep-equals the checked-in files', async () => {
    const regenerated = await generator.buildAllFixtures();
    assert.deepEqual([...regenerated.keys()].sort(), FILES, 'same file set');
    for (const [file, fixture] of regenerated) {
        assert.deepEqual(fixture, FIXTURES.get(file), `${file}: stale — run node tests/tools/gen-wire-fixtures.mjs`);
    }
});

// Assessment + ClaimRelationship wire-builder tests — Phase 11.2
// (docs/ASSESSMENTS_DESIGN.md; NIP_DRAFT.md §30054 / §30055).
//
// Same conventions as metadata-builders.test.mjs: {event, dTag} return
// contract, deterministic-d-tag trio (same / discriminating /
// non-discriminating inputs), URL normalization through builder output,
// and argument validation via assert.rejects — plus the all-tag-values-
// are-strings loop from tests/event-builder.test.mjs (the relay-
// rejection regression). These builders are deliberately chromeless —
// no storage shim needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { buildAssessmentEvent, buildClaimRelationshipEvent, buildAssessmentMirrorEvent } =
  await import('../src/shared/metadata/builders.js');
const { ASSESSMENT_LABEL_NAMESPACE } =
  await import('../src/shared/assessment-taxonomy.js');
const { FLAGS_DEFAULTS } =
  await import('../src/shared/metadata/feature-flags.js');

const PUBKEY_A = 'a'.repeat(64);
const PUBKEY_B = 'b'.repeat(64);
const ENTITY_PK = 'c'.repeat(64);
const COORD_A = `30040:${PUBKEY_A}:claim_aaaaaaaaaaaaaaaa`;
const COORD_B = `30040:${PUBKEY_B}:claim_bbbbbbbbbbbbbbbb`;

/** First 16 hex chars of sha256 — mirrors the builders' derivation. */
async function sha16(s) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

function tagsNamed(ev, name) {
  return ev.tags.filter((t) => t[0] === name);
}
function firstTag(ev, name) {
  return ev.tags.find((t) => t[0] === name);
}

// ---------------------------------------------------------------------
// Kind 30054 — Assessment
// ---------------------------------------------------------------------

test('30054: full tag shape', async () => {
  const anchor = [{ type: 'TextQuoteSelector', exact: 'mutual agreement' }];
  const { event, body, dTag } = await buildAssessmentEvent({
    claimCoord: COORD_A,
    claimUrl: 'https://example.com/video?utm_source=feed',   // claim's r, VERBATIM
    claimEventId: 'e'.repeat(64),
    relayHint: 'wss://relay.example',
    stance: -1,
    labels: [
      { label: 'misleading', anchor, note: 'closure framed as neutral' },
      'fallacy/strawman'
    ],
    rationale: 'Both sides confirm it was not mutual.',
    aboutPubkeys: [ENTITY_PK],
    suggestedBy: 'user'
  });

  assert.equal(event.kind, 30054);
  assert.equal(event.content, 'Both sides confirm it was not mutual.');
  assert.equal(body, event.content);
  assert.equal(dTag, 'assess:' + (await sha16(COORD_A)), 'd recomputable from the a-tag value');

  assert.deepEqual(firstTag(event, 'd'), ['d', dTag]);
  assert.deepEqual(firstTag(event, 'a'), ['a', COORD_A, 'wss://relay.example']);
  assert.deepEqual(firstTag(event, 'e'), ['e', 'e'.repeat(64), 'wss://relay.example']);

  // r is the claim's r VERBATIM (the #r join key); i is normalized.
  assert.deepEqual(firstTag(event, 'r'), ['r', 'https://example.com/video?utm_source=feed']);
  assert.deepEqual(firstTag(event, 'i'), ['i', 'https://example.com/video']);
  assert.deepEqual(firstTag(event, 'k'), ['k', 'web']);

  assert.deepEqual(firstTag(event, 'stance'), ['stance', '-1']);

  // NIP-32 L/l under xray/assessment — the entity-sync pin idiom.
  assert.deepEqual(firstTag(event, 'L'), ['L', ASSESSMENT_LABEL_NAMESPACE]);
  assert.deepEqual(tagsNamed(event, 'l'), [
    ['l', 'misleading', ASSESSMENT_LABEL_NAMESPACE],
    ['l', 'fallacy/strawman', ASSESSMENT_LABEL_NAMESPACE]
  ]);

  // Per-label enrichments, keyed by label value; anchor JSON round-trips.
  const anchorTag = firstTag(event, 'label-anchor');
  assert.equal(anchorTag[1], 'misleading');
  assert.deepEqual(JSON.parse(anchorTag[2]), anchor);
  assert.deepEqual(firstTag(event, 'label-note'),
    ['label-note', 'misleading', 'closure framed as neutral']);

  // p tags: unmarked claim author (9803 idiom) + marked about-entities.
  const pTags = tagsNamed(event, 'p');
  assert.deepEqual(pTags[0], ['p', PUBKEY_A]);
  assert.deepEqual(pTags[1], ['p', ENTITY_PK, '', 'about']);

  assert.deepEqual(firstTag(event, 'suggested-by'), ['suggested-by', 'user']);
  assert.deepEqual(firstTag(event, 'client'), ['client', 'xray']);
});

test('30054: deterministic d-tag trio', async () => {
  const base = { claimCoord: COORD_A, claimUrl: 'https://example.com/v', stance: 1 };
  const a = await buildAssessmentEvent(base);
  const b = await buildAssessmentEvent({
    ...base, stance: -2, labels: ['outdated'], rationale: 'changed my mind'
  });
  const c = await buildAssessmentEvent({ ...base, claimCoord: COORD_B });
  assert.equal(a.dTag, b.dTag, 'judgment edits replace (same claim → same d)');
  assert.notEqual(a.dTag, c.dTag, 'different claim → different d');
});

test('30054: omitted-when-absent tags', async () => {
  const { event } = await buildAssessmentEvent({
    claimCoord: COORD_A, claimUrl: 'https://example.com/v',
    stance: null, labels: ['unsupported']
  });
  assert.equal(firstTag(event, 'stance'), undefined, 'no stance tag for label-only');
  assert.equal(firstTag(event, 'e'), undefined, 'no e without an event id');
  assert.equal(firstTag(event, 'label-anchor'), undefined);
  assert.equal(firstTag(event, 'label-note'), undefined);

  const { event: stanceOnly } = await buildAssessmentEvent({
    claimCoord: COORD_A, claimUrl: 'https://example.com/v', stance: 2
  });
  assert.equal(firstTag(stanceOnly, 'L'), undefined, 'no L/l without labels');
  assert.equal(tagsNamed(stanceOnly, 'l').length, 0);
});

test('30054: validation', async () => {
  const ok = { claimCoord: COORD_A, claimUrl: 'https://example.com/v', stance: 0 };
  await assert.rejects(() => buildAssessmentEvent({ ...ok, claimCoord: 'claim_aaaaaaaaaaaaaaaa' }),
    /must be a 30040:<pubkey>:<d> coordinate/, 'local ids never hit the wire');
  await assert.rejects(() => buildAssessmentEvent({ ...ok, claimCoord: undefined }),
    /claimCoord/);
  await assert.rejects(() => buildAssessmentEvent({ ...ok, claimUrl: '' }),
    /claimUrl required/);
  for (const bad of [3, -3, 1.5, '1']) {
    await assert.rejects(() => buildAssessmentEvent({ ...ok, stance: bad }),
      /stance must be an integer/, `stance ${bad}`);
  }
  await assert.rejects(() => buildAssessmentEvent({ ...ok, stance: null }),
    /needs a stance or at least one label/);
  await assert.rejects(() => buildAssessmentEvent({ ...ok, labels: ['Has Space'] }),
    /invalid label/);
  await assert.rejects(() => buildAssessmentEvent({ ...ok, labels: ['misleading', 'misleading'] }),
    /duplicate label/);
  await assert.rejects(() => buildAssessmentEvent({ ...ok, suggestedBy: 'bot' }),
    /suggestedBy/);
  await assert.rejects(() => buildAssessmentEvent({ ...ok, aboutPubkeys: ['nope'] }),
    /64-hex/);
});

test('30054: every tag value is a string', async () => {
  const { event } = await buildAssessmentEvent({
    claimCoord: COORD_A, claimUrl: 'https://example.com/v',
    stance: 2, labels: [{ label: 'false', note: 'n' }], aboutPubkeys: [ENTITY_PK]
  });
  for (const t of event.tags) {
    for (const v of t) assert.equal(typeof v, 'string', `tag ${t[0]} carries non-string ${v}`);
  }
  const before = Math.floor(Date.now() / 1000);
  const { event: e2 } = await buildAssessmentEvent({
    claimCoord: COORD_A, claimUrl: 'https://example.com/v', stance: 1
  });
  const after = Math.floor(Date.now() / 1000);
  assert.ok(e2.created_at >= before && e2.created_at <= after);
});

// ---------------------------------------------------------------------
// Kind 30055 — ClaimRelationship
// ---------------------------------------------------------------------

test('30055: full tag shape (directional)', async () => {
  const { event, body, dTag } = await buildClaimRelationshipEvent({
    sourceCoord: COORD_B,           // deliberately the lexically LARGER coord
    targetCoord: COORD_A,
    relationship: 'supports',
    sourceUrl: 'https://example.com/video-2?utm_source=x',
    targetUrl: 'https://example.com/video-1',
    sourceEventId: 'e'.repeat(64),
    targetEventId: 'f'.repeat(64),
    note: 'Cites the same court filing.',
    suggestedBy: 'llm:claude-fable-5'
  });

  assert.equal(event.kind, 30055);
  assert.equal(event.content, 'Cites the same court filing.');
  assert.equal(body, event.content);
  // Directional: order is semantic — NOT sorted.
  assert.equal(dTag, 'rel:' + (await sha16(`${COORD_B}|${COORD_A}|supports`)),
    'd recomputable from the a tags + relationship, in tag order');

  assert.deepEqual(tagsNamed(event, 'a'), [
    ['a', COORD_B, '', 'source'],
    ['a', COORD_A, '', 'target']
  ]);
  assert.deepEqual(tagsNamed(event, 'e'), [
    ['e', 'e'.repeat(64), '', 'source'],
    ['e', 'f'.repeat(64), '', 'target']
  ]);
  assert.deepEqual(firstTag(event, 'relationship'), ['relationship', 'supports']);
  assert.deepEqual(tagsNamed(event, 'r'), [
    ['r', 'https://example.com/video-2?utm_source=x'],
    ['r', 'https://example.com/video-1']
  ]);
  assert.deepEqual(tagsNamed(event, 'i'), [
    ['i', 'https://example.com/video-2'],
    ['i', 'https://example.com/video-1']
  ]);
  assert.deepEqual(firstTag(event, 'k'), ['k', 'web']);
  assert.deepEqual(firstTag(event, 'suggested-by'), ['suggested-by', 'llm:claude-fable-5']);
  assert.deepEqual(firstTag(event, 'client'), ['client', 'xray']);

  for (const t of event.tags) {
    for (const v of t) assert.equal(typeof v, 'string', `tag ${t[0]} carries non-string ${v}`);
  }
});

test('30055: symmetric relationships sort endpoints — both directions, one d', async () => {
  const ab = await buildClaimRelationshipEvent({
    sourceCoord: COORD_A, targetCoord: COORD_B, relationship: 'contradicts',
    sourceUrl: 'https://example.com/a', targetUrl: 'https://example.com/b',
    sourceEventId: 'e'.repeat(64), targetEventId: 'f'.repeat(64),
    sourceRelayHint: 'wss://relay-a', targetRelayHint: 'wss://relay-b'
  });
  const ba = await buildClaimRelationshipEvent({
    sourceCoord: COORD_B, targetCoord: COORD_A, relationship: 'contradicts',
    sourceUrl: 'https://example.com/b', targetUrl: 'https://example.com/a',
    sourceEventId: 'f'.repeat(64), targetEventId: 'e'.repeat(64),
    sourceRelayHint: 'wss://relay-b', targetRelayHint: 'wss://relay-a'
  });
  assert.equal(ab.dTag, ba.dTag, 'one logical contradiction, one d');
  assert.equal(ab.dTag, 'rel:' + (await sha16(`${COORD_A}|${COORD_B}|contradicts`)),
    'sorted coords feed the hash');

  // Tag order is sorted too, and the ENTIRE endpoint bundle — url,
  // event id, relay hint — swaps with its coordinate.
  for (const built of [ab, ba]) {
    assert.deepEqual(tagsNamed(built.event, 'a'), [
      ['a', COORD_A, 'wss://relay-a', 'source'],
      ['a', COORD_B, 'wss://relay-b', 'target']
    ]);
    assert.deepEqual(tagsNamed(built.event, 'e'), [
      ['e', 'e'.repeat(64), '', 'source'],
      ['e', 'f'.repeat(64), '', 'target']
    ]);
    assert.deepEqual(tagsNamed(built.event, 'r'),
      [['r', 'https://example.com/a'], ['r', 'https://example.com/b']]);
  }

  // Directional stays directional.
  const sup = await buildClaimRelationshipEvent({ sourceCoord: COORD_A, targetCoord: COORD_B, relationship: 'supports' });
  const pus = await buildClaimRelationshipEvent({ sourceCoord: COORD_B, targetCoord: COORD_A, relationship: 'supports' });
  assert.notEqual(sup.dTag, pus.dTag);
});

test('30055: shared-URL dedupe and url-less builds', async () => {
  const shared = await buildClaimRelationshipEvent({
    sourceCoord: COORD_A, targetCoord: COORD_B, relationship: 'duplicates',
    sourceUrl: 'https://example.com/same', targetUrl: 'https://example.com/same'
  });
  assert.equal(tagsNamed(shared.event, 'r').length, 1, 'identical r values deduped');
  assert.equal(tagsNamed(shared.event, 'i').length, 1);

  // Verbatim-different but normalized-equal URLs: two r, one i.
  const tracked = await buildClaimRelationshipEvent({
    sourceCoord: COORD_A, targetCoord: COORD_B, relationship: 'duplicates',
    sourceUrl: 'https://example.com/same?utm_source=x',
    targetUrl: 'https://example.com/same'
  });
  assert.equal(tagsNamed(tracked.event, 'r').length, 2, 'verbatim r values differ — both kept');
  assert.deepEqual(tagsNamed(tracked.event, 'i'), [['i', 'https://example.com/same']],
    'normalized i values coincide — deduped');

  const bare = await buildClaimRelationshipEvent({
    sourceCoord: COORD_A, targetCoord: COORD_B, relationship: 'updates'
  });
  assert.equal(tagsNamed(bare.event, 'r').length, 0);
  assert.equal(tagsNamed(bare.event, 'i').length, 0);
  assert.equal(firstTag(bare.event, 'k'), undefined, 'no k without i');
});

test('30055: validation', async () => {
  const ok = { sourceCoord: COORD_A, targetCoord: COORD_B, relationship: 'contradicts' };
  await assert.rejects(() => buildClaimRelationshipEvent({ ...ok, sourceCoord: 'claim_aaaaaaaaaaaaaaaa' }),
    /must be a 30040:<pubkey>:<d> coordinate/, 'local ids never hit the wire');
  await assert.rejects(() => buildClaimRelationshipEvent({ ...ok, relationship: 'loves' }),
    /relationship must be one of/);
  await assert.rejects(() => buildClaimRelationshipEvent({ ...ok, relationship: 'contextualizes' }),
    /relationship must be one of/, 'legacy contextualizes is not publishable');
  await assert.rejects(() => buildClaimRelationshipEvent({ ...ok, targetCoord: COORD_A }),
    /cannot link a claim to itself/);
  await assert.rejects(() => buildClaimRelationshipEvent({ ...ok, suggestedBy: 'llm: ' }),
    /suggestedBy/);
});

// ---------------------------------------------------------------------
// Kind 1985 — assessment label mirror
// ---------------------------------------------------------------------

test('1985 mirror: tag shape, regular-event semantics, validation', () => {
  const { event, dTag } = buildAssessmentMirrorEvent({
    claimCoord: COORD_A,
    labels: [{ label: 'misleading', note: 'note stays on the 30054' }, 'flip-flop'],
    claimUrl: 'https://example.com/v?utm_source=x',
    relayHint: 'wss://relay.example'
  });

  assert.equal(event.kind, 1985);
  assert.equal(event.content, '');
  assert.equal(dTag, null, 'kind 1985 is a regular event — no d');

  assert.deepEqual(firstTag(event, 'L'), ['L', ASSESSMENT_LABEL_NAMESPACE]);
  assert.deepEqual(tagsNamed(event, 'l'), [
    ['l', 'misleading', ASSESSMENT_LABEL_NAMESPACE],
    ['l', 'flip-flop', ASSESSMENT_LABEL_NAMESPACE]
  ]);
  assert.deepEqual(firstTag(event, 'a'), ['a', COORD_A, 'wss://relay.example']);
  // NO p tag — a p on a 1985 would label the claim's AUTHOR with the
  // issue labels (reputational mislabel).
  assert.equal(firstTag(event, 'p'), undefined, 'mirror does not label the author');
  assert.deepEqual(firstTag(event, 'r'), ['r', 'https://example.com/v?utm_source=x'],
    'verbatim claim r for the draft #r 1985 query');
  assert.deepEqual(firstTag(event, 'client'), ['client', 'xray']);
  assert.equal(firstTag(event, 'label-note'), undefined, 'enrichments stay on the 30054');
  for (const t of event.tags) {
    for (const v of t) assert.equal(typeof v, 'string');
  }

  // r is omitted when no url is supplied.
  const { event: noUrl } = buildAssessmentMirrorEvent({ claimCoord: COORD_A, labels: ['outdated'] });
  assert.equal(firstTag(noUrl, 'r'), undefined);

  assert.throws(() => buildAssessmentMirrorEvent({ claimCoord: COORD_A, labels: [] }),
    /at least one label/);
  assert.throws(() => buildAssessmentMirrorEvent({ claimCoord: 'claim_aaaaaaaaaaaaaaaa', labels: ['misleading'] }),
    /must be a 30040:<pubkey>:<d> coordinate/);
});

// ---------------------------------------------------------------------
// Flag
// ---------------------------------------------------------------------

test('flags: assessmentPublishing defaults OFF (publish gated, capture never)', () => {
  assert.equal(FLAGS_DEFAULTS.assessmentPublishing, false);
});

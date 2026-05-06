// TopicTrust builder — kind 30053. Phase 9a Day 5.
//
// Spec: XRAY_METADATA_SPEC.md §6.8.
//
// Lives in its own module so the Trust tab in Settings can import the
// builder without pulling in the rest of the metadata builders. Keeps
// the trust-list editor's dep graph tight.

import { normalize as _normalize } from './url-normalizer.js';

function nowSeconds() { return Math.floor(Date.now() / 1000); }
function tag(name, ...values) {
  return [name, ...values.map((v) => (v == null ? '' : String(v)))];
}

/**
 * Build an unsigned kind 30053 TopicTrust event.
 *
 * @param {object} args
 * @param {string} args.targetPubkey   — hex pubkey we trust
 * @param {string} args.topic          — short slug (e.g. `bitcoin`)
 * @param {number} args.weight         — 0..100
 * @param {string} [args.rationale]    — free-text content
 * @param {number} [args.expires]      — unix seconds; 0 = never
 * @param {number} [args.createdAt]    — clock override for tests
 * @returns {{event: object, dTag: string}}
 */
export function buildTopicTrustEvent({
  targetPubkey,
  topic,
  weight,
  rationale = '',
  expires = 0,
  createdAt = nowSeconds()
} = {}) {
  if (typeof targetPubkey !== 'string' || !/^[0-9a-fA-F]{64}$/.test(targetPubkey)) {
    throw new Error('buildTopicTrustEvent: targetPubkey must be 64-hex');
  }
  if (typeof topic !== 'string' || !topic) {
    throw new Error('buildTopicTrustEvent: topic required');
  }
  if (!Number.isFinite(weight) || weight < 0 || weight > 100) {
    throw new Error('buildTopicTrustEvent: weight must be 0..100');
  }

  // Deterministic d-tag — `trust:<topic>:<target-prefix>`. Prefix
  // length 16 keeps the d-tag short while remaining unambiguous in
  // practice. Replaceable-event semantics mean re-publishing
  // overwrites the prior assertion.
  const dTag = 'trust:' + topic + ':' + targetPubkey.toLowerCase().slice(0, 16);

  const tags = [
    tag('d', dTag),
    tag('p', targetPubkey.toLowerCase()),
    tag('t', topic),
    tag('weight', String(Math.round(weight)))
  ];
  if (expires && Number.isFinite(expires)) tags.push(tag('expires', String(Math.round(expires))));

  return {
    event: { kind: 30053, created_at: createdAt, tags, content: String(rationale || '') },
    dTag
  };
}

// `_normalize` is imported but unused in this module today — kept so
// future revisions that include URL fields don't accidentally drop it.
void _normalize;

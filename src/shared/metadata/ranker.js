// Ranker — Phase 9a Day 5.
//
// Spec: XRAY_METADATA_SPEC.md §8.1 + Implementation Plan §8.
//
// v1 implements layer 1 only — a binary trust filter. Annotations from
// authors in the user's first-order trust graph go in `trusted`; the
// rest go in `untrusted` (only computed when `includeUntrusted`).
// v3 will add bridging-based ranking in the same return shape.

import { isTrusted } from './trust-graph.js';

/**
 * Rank a list of annotations against a trust-graph state.
 *
 * @param {Array<object>} annotations
 *   Each must have at least `pubkey` (author) and `created_at`. Event
 *   id (for tie-break) is read from `id`.
 * @param {object} graphState  — from trust-graph.composeGraph
 * @param {object} [opts]
 * @param {string} [opts.topic]              — topic for `isTrusted`
 * @param {number} [opts.threshold=50]
 * @param {boolean} [opts.includeUntrusted=false]
 * @param {boolean} [opts.followsTrustAllTopics=true]
 * @returns {{trusted: Array, untrusted: Array, bridging: null}}
 */
export function rankAnnotations(annotations, graphState, opts = {}) {
  const {
    topic = null,
    threshold = 50,
    includeUntrusted = false,
    followsTrustAllTopics = true
  } = opts;

  const arr = Array.isArray(annotations) ? annotations : [];
  const trusted = [];
  const untrusted = [];

  for (const a of arr) {
    if (!a || typeof a.pubkey !== 'string' || !a.pubkey) continue;
    const ok = isTrusted(graphState, a.pubkey, topic, { threshold, followsTrustAllTopics });
    if (ok) trusted.push(a);
    else if (includeUntrusted) untrusted.push(a);
  }

  trusted.sort(byCreatedAtThenIdDesc);
  untrusted.sort(byCreatedAtThenIdDesc);

  return {
    trusted,
    untrusted,
    bridging: null   // v3 placeholder
  };
}

function byCreatedAtThenIdDesc(a, b) {
  const aT = (a && a.created_at) || 0;
  const bT = (b && b.created_at) || 0;
  if (aT !== bT) return bT - aT;
  // Same timestamp: tie-break lexicographically by event id, descending
  // (so the larger id is first — gives stable, deterministic order).
  const aId = (a && a.id) || '';
  const bId = (b && b.id) || '';
  if (aId === bId) return 0;
  return aId < bId ? 1 : -1;
}

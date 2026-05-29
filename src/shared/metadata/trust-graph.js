// Trust graph — Phase 9a Day 4.
//
// Spec: XRAY_METADATA_SPEC.md §8.1 + Implementation Plan §7.
//
// Composes the user's first-order trust graph from:
//   - kind 3   (NIP-02 contact list — the user's social follows)
//   - kind 30053 (TopicTrust — explicit "I trust X on topic Y")
//
// The graph answers two questions:
//
//   isTrusted(authorPubkey, topic, threshold) — boolean
//   trustedAuthors(topic, threshold) — Set<pubkey>
//
// v1 ships layer 1 only (binary trust filter). Transitive walks (v2)
// and bridging-based ranking (v3) consume different events; this
// module is the foundation they build on.
//
// Persistence:
//   - chrome.storage.local — small, fast first-paint cache (single
//     key 'xr_trust_graph_<userPubkey>').
//   - IDB trust_graph store — full graph; survives chrome.storage
//     eviction.
//
// The graph is rebuilt on incoming kind 3 / kind 30053 events; the
// SW invalidates and triggers a reload. Tests below exercise the
// composition logic against synthesized event fixtures — the
// persistence side is tested via mocks.

/**
 * @typedef {object} Kind3Event
 * @property {number} kind
 * @property {string} pubkey
 * @property {Array<Array<string>>} tags
 *   `["p", "<followed-pubkey>", "<relay-hint?>", "<petname?>"]` per NIP-02
 * @property {number} created_at
 * @property {string} id
 *
 * @typedef {object} Kind30053Event
 * @property {30053} kind
 * @property {string} pubkey
 * @property {Array<Array<string>>} tags
 *   - `["p", "<target-pubkey>"]`
 *   - `["t", "<topic>"]`
 *   - `["weight", "<0..100>"]`
 *   - `["expires", "<unix-time>"]` (optional)
 * @property {number} created_at
 *
 * @typedef {object} TrustGraphState
 * @property {string} pubkey                                — owner
 * @property {Set<string>} firstOrderFollows                — kind 3 derived
 * @property {Map<string, Map<string, TrustEntry>>} topicTrust
 *   topic → (target-pubkey → entry)
 * @property {number} builtAt                               — unix seconds
 *
 * @typedef {object} TrustEntry
 * @property {number} weight     — 0..100
 * @property {number} expires    — unix seconds, 0 = never
 * @property {string} eventId    — source kind 30053 event id
 * @property {number} createdAt
 */

const DEFAULT_THRESHOLD = 50;

/**
 * Compose a TrustGraphState from raw events. Pure; no I/O.
 *
 * @param {object} args
 * @param {string} args.pubkey               — graph owner's pubkey
 * @param {Kind3Event} [args.contactList]    — latest kind 3 by `pubkey`
 * @param {Kind30053Event[]} [args.topicTrustEvents]
 * @param {number} [args.now]                — clock override for tests
 * @returns {TrustGraphState}
 */
export function composeGraph({
  pubkey,
  contactList = null,
  topicTrustEvents = [],
  now = Math.floor(Date.now() / 1000)
} = {}) {
  if (typeof pubkey !== 'string' || !pubkey) {
    throw new Error('composeGraph: owner pubkey required');
  }

  const firstOrderFollows = new Set();
  if (contactList && Array.isArray(contactList.tags)) {
    for (const tag of contactList.tags) {
      if (Array.isArray(tag) && tag[0] === 'p' && typeof tag[1] === 'string') {
        firstOrderFollows.add(tag[1]);
      }
    }
  }

  // Topic trust: latest event wins per (topic, target). The d-tag in
  // kind 30053 is `trust:<topic>:<target-prefix>` so NIP-01 replaceable
  // semantics make this work — but the *materialized* state has to
  // pick the latest if we receive multiple in-flight versions.
  const topicTrust = new Map();
  const seen = new Map(); // key = topic + '|' + targetPubkey, value = createdAt

  for (const evt of topicTrustEvents) {
    if (!evt || evt.kind !== 30053) continue;
    if (!Array.isArray(evt.tags)) continue;
    let target = null;
    let topic = null;
    let weight = NaN;
    let expires = 0;
    for (const tag of evt.tags) {
      if (!Array.isArray(tag)) continue;
      if (tag[0] === 'p' && typeof tag[1] === 'string') target = tag[1];
      else if (tag[0] === 't' && typeof tag[1] === 'string') topic = tag[1];
      else if (tag[0] === 'weight' && typeof tag[1] === 'string') {
        weight = parseInt(tag[1], 10);
      }
      else if (tag[0] === 'expires' && typeof tag[1] === 'string') {
        expires = parseInt(tag[1], 10) || 0;
      }
    }
    if (!target || !topic) continue;
    if (!Number.isFinite(weight)) continue;
    if (weight < 0 || weight > 100) continue;
    if (expires && expires < now) continue; // skip expired

    const key = topic + '|' + target;
    const prevAt = seen.get(key);
    if (prevAt !== undefined && evt.created_at <= prevAt) continue;
    seen.set(key, evt.created_at);

    if (!topicTrust.has(topic)) topicTrust.set(topic, new Map());
    topicTrust.get(topic).set(target, {
      weight,
      expires,
      eventId: evt.id || '',
      createdAt: evt.created_at
    });
  }

  return {
    pubkey,
    firstOrderFollows,
    topicTrust,
    builtAt: now
  };
}

/**
 * Boolean trust check for a single (author, topic).
 *
 * @param {TrustGraphState} state
 * @param {string} authorPubkey
 * @param {string} [topic]
 * @param {object} [opts]
 * @param {number} [opts.threshold=50]
 * @param {boolean} [opts.followsTrustAllTopics=true]
 *   If true (default), an author in `firstOrderFollows` is trusted
 *   regardless of topic. If false, follows only count when there is
 *   an explicit topic-trust entry for that author on the relevant
 *   topic. Mirrors the user-facing toggle in Settings → Trust.
 * @returns {boolean}
 */
export function isTrusted(state, authorPubkey, topic = null, opts = {}) {
  if (!state) return false;
  if (typeof authorPubkey !== 'string' || !authorPubkey) return false;
  const { threshold = DEFAULT_THRESHOLD, followsTrustAllTopics = true } = opts;

  if (followsTrustAllTopics && state.firstOrderFollows.has(authorPubkey)) {
    return true;
  }

  if (topic) {
    const tEntries = state.topicTrust.get(topic);
    if (tEntries) {
      const entry = tEntries.get(authorPubkey);
      if (entry && entry.weight >= threshold) return true;
    }
  } else if (!followsTrustAllTopics) {
    // No topic supplied AND follows don't auto-trust. Look across
    // all topic-trust entries for this author and pick the highest
    // weight — passes if ANY topic clears the threshold.
    for (const tEntries of state.topicTrust.values()) {
      const entry = tEntries.get(authorPubkey);
      if (entry && entry.weight >= threshold) return true;
    }
  } else if (!state.firstOrderFollows.has(authorPubkey)) {
    // Follows don't include them, no topic supplied → not trusted
    // unless we set followsTrustAllTopics=false above.
    return false;
  }

  return false;
}

/**
 * Set of pubkeys trusted on the given topic (or globally when topic
 * is null and follows-trust-all-topics is true).
 *
 * @param {TrustGraphState} state
 * @param {string} [topic]
 * @param {object} [opts]
 * @returns {Set<string>}
 */
export function trustedAuthors(state, topic = null, opts = {}) {
  const { threshold = DEFAULT_THRESHOLD, followsTrustAllTopics = true } = opts;
  const out = new Set();
  if (!state) return out;

  if (followsTrustAllTopics) {
    for (const p of state.firstOrderFollows) out.add(p);
  }

  if (topic) {
    const tEntries = state.topicTrust.get(topic);
    if (tEntries) {
      for (const [target, entry] of tEntries) {
        if (entry.weight >= threshold) out.add(target);
      }
    }
  } else {
    for (const tEntries of state.topicTrust.values()) {
      for (const [target, entry] of tEntries) {
        if (entry.weight >= threshold) out.add(target);
      }
    }
  }

  return out;
}

/**
 * For a given pubkey, return the topics on which they're trusted (and
 * by what mechanism). Useful for "Y is trusted on Bitcoin" badges in
 * the metadata panel.
 *
 * @param {TrustGraphState} state
 * @param {string} pubkey
 * @returns {Array<{topic: string|null, weight: number, source: 'follows' | 'topic-trust'}>}
 */
export function getTrustedTopicsFor(state, pubkey) {
  const out = [];
  if (!state) return out;

  if (state.firstOrderFollows.has(pubkey)) {
    out.push({ topic: null, weight: 100, source: 'follows' });
  }
  for (const [topic, tEntries] of state.topicTrust) {
    const entry = tEntries.get(pubkey);
    if (entry) {
      out.push({ topic, weight: entry.weight, source: 'topic-trust' });
    }
  }
  return out;
}

/**
 * Serialize a TrustGraphState for storage (Sets → arrays, Maps →
 * plain objects). Inverse of `deserializeGraph`.
 */
export function serializeGraph(state) {
  if (!state) return null;
  const topicTrust = {};
  for (const [topic, tEntries] of state.topicTrust) {
    const entries = {};
    for (const [target, entry] of tEntries) entries[target] = entry;
    topicTrust[topic] = entries;
  }
  return {
    pubkey: state.pubkey,
    firstOrderFollows: Array.from(state.firstOrderFollows),
    topicTrust,
    builtAt: state.builtAt
  };
}

/**
 * Deserialize a serialized graph back to runtime state.
 */
export function deserializeGraph(serialized) {
  if (!serialized) return null;
  const state = {
    pubkey: serialized.pubkey,
    firstOrderFollows: new Set(serialized.firstOrderFollows || []),
    topicTrust: new Map(),
    builtAt: serialized.builtAt || 0
  };
  const tt = serialized.topicTrust || {};
  for (const [topic, entries] of Object.entries(tt)) {
    const m = new Map();
    for (const [target, entry] of Object.entries(entries || {})) m.set(target, entry);
    state.topicTrust.set(topic, m);
  }
  return state;
}

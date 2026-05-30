// Metadata event builders — Phase 9a Day 5.
//
// Spec: XRAY_METADATA_SPEC.md §6 + Implementation Plan §9.
//
// Builds *unsigned* events for:
//
//   - Kind 30050 (Annotation)             — buildAnnotationEvent
//   - Kind 30051 (FactCheck)               — buildFactCheckEvent (gated)
//   - Kind 30052 (Rating)                  — buildRatingEvent (gated)
//   - Kind 9803  (HelpfulnessVote)         — buildHelpfulnessEvent (gated)
//   - Kind 30053 (TopicTrust)              — buildTopicTrustEvent (lives
//     in topic-trust-builder.js so the trust-tab can import without
//     pulling in the rest of this module)
//
// Plus: `buildRespondsToTag()` — the kind 30023 extension tag.
//
// All builders return `{ event, body, dTag }`:
//   - `event`  — unsigned NIP-01 event (no `pubkey`, no `id`, no `sig`)
//   - `body`   — the JSON-LD body string assigned to `event.content`
//                (also returned separately so callers can verify shape
//                without re-parsing)
//   - `dTag`   — the deterministic d-tag value (also in `event.tags`)
//
// Signing happens via the existing Signer façade
// (`src/shared/signer.js`); these builders don't touch crypto or
// network. Tests verify each builder produces a tag set that matches
// the spec's tag table verbatim.

import { normalize } from './url-normalizer.js';

// ------------------------------------------------------------------
// Common helpers
// ------------------------------------------------------------------

/** SHA-256 of a UTF-8 string, returned as lowercase hex. */
async function sha256Hex(s) {
  const bytes = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** First 16 hex chars of sha256(s). */
async function sha16(s) {
  return (await sha256Hex(s)).slice(0, 16);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function tag(name, ...values) {
  return [name, ...values.map((v) => (v === null || v === undefined ? '' : String(v)))];
}

/**
 * Build the URL anchor tags for a metadata event.
 *
 * Every kind carries the NIP-73 trio `r` + `i` + `k=web`. Only the
 * Annotation kind (30050) additionally carries the NIP-22 root-scope
 * pair `I` + `K=web` — annotations are also valid NIP-22 comments and
 * surface in NIP-22 readers (per the NIP draft's intro). FactCheck
 * (30051) and Rating (30052) are standalone structured kinds, not
 * NIP-22 comments, so they omit `I`/`K` — matching the per-kind tag
 * examples in NIP_DRAFT.md.
 */
function urlAnchorTags(url, { nip22Root = false } = {}) {
  const tags = [
    tag('r', url),
    tag('i', url),
    tag('k', 'web')
  ];
  if (nip22Root) {
    tags.push(tag('I', url));
    tags.push(tag('K', 'web'));
  }
  return tags;
}

// ------------------------------------------------------------------
// Annotation — kind 30050
// ------------------------------------------------------------------

// NIP_DRAFT.md specifies the single W3C Web Annotation context. The
// xray-private `x-ray.dev/ns/v1.jsonld` context from the spec draft
// was dropped: the body emits only standard W3C anno vocabulary, so a
// vendor context adds nothing, and a NIP must be vendor-neutral.
const ANNO_CONTEXT = 'http://www.w3.org/ns/anno.jsonld';

/**
 * Build an unsigned kind 30050 Annotation event.
 *
 * @param {object} args
 * @param {string} args.url                    — target URL (will be normalized)
 * @param {string} args.motivation             — primary motivation (see spec §6.3.2)
 * @param {string|string[]} [args.motivations] — additional motivations
 * @param {string} args.bodyMarkdown           — annotation body (Markdown)
 * @param {Array<object>} [args.selectors]     — from anchor-capture.buildSelectors
 * @param {string|string[]} [args.topic]       — `t` tag(s)
 * @param {string} [args.lang='en']
 * @param {string} [args.respondsToArticleAddress]
 *   `30023:<pubkey>:<slug>` — when motivation is `responding-to`, the
 *   reaction article we're pointing at.
 * @param {object} [args.targetEvent]          — kind/id/relayHint for `e` tag
 * @param {string} [args.correctionType]       — when a motivation is
 *   `correcting`, one of: headline / quote / stat / name / date / other.
 *   Emitted as a `correction-type` tag (NIP_DRAFT.md kind 30050).
 * @param {number} [args.createdAt]            — clock override for tests
 * @returns {Promise<{event, body, dTag}>}
 */
export async function buildAnnotationEvent({
  url,
  motivation,
  motivations,
  bodyMarkdown,
  selectors = [],
  topic,
  lang = 'en',
  respondsToArticleAddress = null,
  targetEvent = null,
  correctionType = null,
  createdAt = nowSeconds()
} = {}) {
  if (typeof url !== 'string' || !url) throw new Error('buildAnnotationEvent: url required');
  if (typeof motivation !== 'string' || !motivation) {
    throw new Error('buildAnnotationEvent: motivation required');
  }

  const normalizedUrl = normalize(url);

  // Deterministic d-tag — see spec §6.3.1.
  const selectorHash = selectors.length === 0
    ? ''
    : await sha256Hex(JSON.stringify(selectors));
  const dTag = 'ann:' + (await sha16(
    normalizedUrl + '|' + selectorHash + '|' + motivation
  ));

  const motivationList = uniqueStrings([motivation, ...arrayify(motivations)]);
  const topicList = uniqueStrings(arrayify(topic));

  // Annotations are also valid NIP-22 comments → carry the `I`/`K`
  // root-scope pair (nip22Root: true).
  const tags = [
    tag('d', dTag),
    ...urlAnchorTags(normalizedUrl, { nip22Root: true }),
    ...motivationList.map((m) => tag('motivation', m)),
    ...topicList.map((t) => tag('t', t)),
    tag('lang', lang)
  ];

  // `correction-type` — NIP_DRAFT.md: SHOULD accompany a `correcting`
  // motivation. We only emit it when the motivation set actually
  // includes `correcting`, so a stray param can't mislabel an event.
  if (correctionType) {
    const ALLOWED_CORRECTION_TYPES = ['headline', 'quote', 'stat', 'name', 'date', 'other'];
    if (!ALLOWED_CORRECTION_TYPES.includes(correctionType)) {
      throw new Error('buildAnnotationEvent: correctionType must be one of ' +
        ALLOWED_CORRECTION_TYPES.join(', '));
    }
    if (!motivationList.includes('correcting')) {
      throw new Error('buildAnnotationEvent: correctionType requires a `correcting` motivation');
    }
    tags.push(tag('correction-type', correctionType));
  }

  if (respondsToArticleAddress) tags.push(tag('a', respondsToArticleAddress));
  if (targetEvent && targetEvent.id) {
    tags.push(tag('e', targetEvent.id, targetEvent.relayHint || ''));
  }

  const body = JSON.stringify({
    '@context': ANNO_CONTEXT,
    type: 'Annotation',
    motivation: motivationList.length === 1 ? motivationList[0] : motivationList,
    body: {
      type: 'TextualBody',
      format: 'text/markdown',
      language: lang,
      value: String(bodyMarkdown || '')
    },
    target: {
      source: normalizedUrl,
      selector: selectors
    }
  });

  return {
    event: { kind: 30050, created_at: createdAt, tags, content: body },
    body,
    dTag
  };
}

// ------------------------------------------------------------------
// FactCheck — kind 30051 (gated; data path lands in 9a)
// ------------------------------------------------------------------

// NIP_DRAFT.md and the implementation plan both name the reference
// rating scale `nostr.dev/scale/v1` (vendor-neutral). The metadata
// spec draft said `x-ray.dev/scale/v1`; the NIP wins for wire format.
const RATING_SCALE_DEFAULT = 'nostr.dev/scale/v1';

/**
 * Build an unsigned kind 30051 FactCheck event.
 *
 * @param {object} args
 * @param {string} args.url
 * @param {string} args.claimReviewed       — the specific claim text
 * @param {number|string} args.ratingValue
 * @param {number} [args.ratingBest=5]
 * @param {number} [args.ratingWorst=1]
 * @param {string} args.ratingName
 * @param {string} [args.ratingScale='nostr.dev/scale/v1']
 * @param {string} [args.ratingExplanation='']
 * @param {Array<string>} [args.evidence]    — URLs / nostr: refs
 * @param {string|string[]} [args.topic]
 * @param {object} [args.appearance]         — { headline, datePublished } for ClaimReview
 * @param {string} [args.relatedClaimEventId]
 * @param {number} [args.createdAt]
 */
export async function buildFactCheckEvent({
  url,
  claimReviewed,
  ratingValue,
  ratingBest = 5,
  ratingWorst = 1,
  ratingName,
  ratingScale = RATING_SCALE_DEFAULT,
  ratingExplanation = '',
  evidence = [],
  topic,
  appearance = null,
  relatedClaimEventId = null,
  createdAt = nowSeconds()
} = {}) {
  if (typeof url !== 'string' || !url) throw new Error('buildFactCheckEvent: url required');
  if (typeof claimReviewed !== 'string' || !claimReviewed) {
    throw new Error('buildFactCheckEvent: claimReviewed required');
  }
  if (ratingValue === undefined || ratingValue === null) {
    throw new Error('buildFactCheckEvent: ratingValue required');
  }
  if (typeof ratingName !== 'string' || !ratingName) {
    throw new Error('buildFactCheckEvent: ratingName required');
  }

  const normalizedUrl = normalize(url);
  const dTag = 'factcheck:' + (await sha16(normalizedUrl + '|' + claimReviewed));
  const topicList = uniqueStrings(arrayify(topic));

  // FactCheck is a standalone structured kind, not a NIP-22 comment —
  // r/i/k only, no I/K (NIP_DRAFT.md kind 30051).
  const tags = [
    tag('d', dTag),
    ...urlAnchorTags(normalizedUrl),
    tag('claim-reviewed', claimReviewed),
    tag('rating-value', String(ratingValue)),
    tag('rating-best',  String(ratingBest)),
    tag('rating-worst', String(ratingWorst)),
    tag('rating-name',  ratingName),
    tag('rating-scale', ratingScale),
    ...topicList.map((t) => tag('t', t))
  ];
  if (relatedClaimEventId) tags.push(tag('e', relatedClaimEventId));
  for (const ev of arrayify(evidence)) {
    if (typeof ev === 'string' && ev) tags.push(tag('evidence', ev));
  }

  const body = JSON.stringify({
    '@context': 'https://schema.org',
    type: 'ClaimReview',
    datePublished: new Date(createdAt * 1000).toISOString().slice(0, 10),
    claimReviewed,
    itemReviewed: {
      type: 'Claim',
      appearance: {
        type: 'Article',
        url: normalizedUrl,
        ...(appearance && appearance.headline ? { headline: String(appearance.headline) } : {}),
        ...(appearance && appearance.datePublished ? { datePublished: String(appearance.datePublished) } : {})
      }
    },
    reviewRating: {
      type: 'Rating',
      ratingValue: typeof ratingValue === 'number' ? ratingValue : Number(ratingValue),
      bestRating: ratingBest,
      worstRating: ratingWorst,
      alternateName: ratingName,
      ratingExplanation: String(ratingExplanation || '')
    }
  });

  return {
    event: { kind: 30051, created_at: createdAt, tags, content: body },
    body,
    dTag
  };
}

// ------------------------------------------------------------------
// Rating — kind 30052 (gated)
// ------------------------------------------------------------------

/**
 * Build an unsigned kind 30052 Rating event.
 *
 * @param {object} args
 * @param {string} args.url
 * @param {number|string} args.ratingValue
 * @param {number} [args.ratingBest=5]
 * @param {string} args.ratingName
 * @param {string} args.content              — Markdown body
 * @param {string|string[]} [args.topic]
 * @param {string} args.authorPubkey         — needed for the d-tag
 *   (so the same author can edit their rating)
 * @param {number} [args.createdAt]
 */
export async function buildRatingEvent({
  url,
  ratingValue,
  ratingBest = 5,
  ratingName,
  content,
  topic,
  authorPubkey,
  createdAt = nowSeconds()
} = {}) {
  if (typeof url !== 'string' || !url) throw new Error('buildRatingEvent: url required');
  if (ratingValue === undefined || ratingValue === null) {
    throw new Error('buildRatingEvent: ratingValue required');
  }
  if (typeof ratingName !== 'string' || !ratingName) {
    throw new Error('buildRatingEvent: ratingName required');
  }
  if (typeof authorPubkey !== 'string' || !authorPubkey) {
    throw new Error('buildRatingEvent: authorPubkey required (used in deterministic d-tag)');
  }

  const normalizedUrl = normalize(url);
  const dTag = 'rating:' + (await sha16(normalizedUrl + '|' + authorPubkey));
  const topicList = uniqueStrings(arrayify(topic));

  const tags = [
    tag('d', dTag),
    ...urlAnchorTags(normalizedUrl),
    tag('rating-value', String(ratingValue)),
    tag('rating-best',  String(ratingBest)),
    tag('rating-name',  ratingName),
    ...topicList.map((t) => tag('t', t))
  ];

  return {
    event: { kind: 30052, created_at: createdAt, tags, content: String(content || '') },
    body: String(content || ''),
    dTag
  };
}

// ------------------------------------------------------------------
// HelpfulnessVote — kind 9803 (gated, but data accumulates from day one)
// ------------------------------------------------------------------

/**
 * Build an unsigned kind 9803 HelpfulnessVote event.
 *
 * @param {object} args
 * @param {string} args.targetCoord     — `30050:<pubkey>:<d>` or similar
 * @param {string} [args.targetEventId]
 * @param {string} [args.targetAuthor]
 * @param {string} [args.relayHint]
 * @param {1 | -1 | 0} args.helpful
 * @param {string} [args.rationale]
 * @param {number} [args.createdAt]
 */
export function buildHelpfulnessEvent({
  targetCoord,
  targetEventId,
  targetAuthor,
  relayHint,
  helpful,
  rationale = '',
  createdAt = nowSeconds()
} = {}) {
  if (typeof targetCoord !== 'string' || !targetCoord) {
    throw new Error('buildHelpfulnessEvent: targetCoord required');
  }
  if (helpful !== 1 && helpful !== -1 && helpful !== 0) {
    throw new Error('buildHelpfulnessEvent: helpful must be 1, -1, or 0');
  }

  const tags = [
    tag('a', targetCoord, relayHint || '')
  ];
  if (targetEventId) tags.push(tag('e', targetEventId, relayHint || ''));
  if (targetAuthor) tags.push(tag('p', targetAuthor));
  tags.push(tag('helpful', String(helpful)));

  return {
    event: { kind: 9803, created_at: createdAt, tags, content: String(rationale || '') },
    body: String(rationale || ''),
    dTag: null    // 9803 is regular, not addressable
  };
}

// ------------------------------------------------------------------
// `responds-to` tag for kind 30023 (extension)
// ------------------------------------------------------------------

const ALLOWED_RELATIONSHIPS = new Set([
  'rebuts', 'supports', 'extends', 'contextualizes', 'corrects'
]);

/**
 * Build a `["responds-to", target, relationship, relayHint?]` tag for
 * inclusion in a kind 30023 article event. See spec §6.4.
 *
 * @param {string} target           — URL or `nostr:naddr1...` / `nostr:nevent1...`
 * @param {string} relationship     — one of: rebuts / supports / extends /
 *                                   contextualizes / corrects
 * @param {string} [relayHint]
 * @returns {Array<string>}
 */
export function buildRespondsToTag(target, relationship, relayHint = '') {
  if (typeof target !== 'string' || !target) {
    throw new Error('buildRespondsToTag: target required');
  }
  if (!ALLOWED_RELATIONSHIPS.has(relationship)) {
    throw new Error('buildRespondsToTag: relationship must be one of ' +
      Array.from(ALLOWED_RELATIONSHIPS).join(', '));
  }
  // Normalize URL targets so cross-reader hashing agrees. Leave nostr:
  // refs alone.
  const normalizedTarget = /^nostr:/.test(target) ? target : normalize(target);
  return relayHint
    ? ['responds-to', normalizedTarget, relationship, relayHint]
    : ['responds-to', normalizedTarget, relationship];
}

/** The set of valid relationship values, exported for UI dropdowns. */
export const RESPONDS_TO_RELATIONSHIPS = Object.freeze(
  Array.from(ALLOWED_RELATIONSHIPS)
);

// ------------------------------------------------------------------
// Highlight — kind 9802 (NIP-84)
// ------------------------------------------------------------------

/**
 * Build an unsigned kind 9802 Highlight event (NIP-84) — "draw attention
 * to this passage" with no commentary. Per NIP_DRAFT.md §6.9 the content
 * is the highlighted text, anchored to the URL with r/i/k=web.
 *
 * @param {object} args
 * @param {string} args.url
 * @param {string} args.text        the highlighted passage (event content)
 * @param {string|string[]} [args.topic]
 * @param {number} [args.createdAt]
 * @returns {{event: object}}
 */
export function buildHighlightEvent({ url, text, topic, createdAt = nowSeconds() } = {}) {
  if (typeof url !== 'string' || !url) throw new Error('buildHighlightEvent: url required');
  if (typeof text !== 'string' || !text.trim()) throw new Error('buildHighlightEvent: text required');
  const normalizedUrl = normalize(url);
  const tags = [
    tag('r', normalizedUrl),
    tag('i', normalizedUrl),
    tag('k', 'web'),
    ...uniqueStrings(arrayify(topic)).map((t) => tag('t', t))
  ];
  return {
    event: { kind: 9802, created_at: createdAt, tags, content: String(text) }
  };
}

/** Valid annotation motivations, exported for the author UI. */
export const ANNOTATION_MOTIVATIONS = Object.freeze([
  'commenting', 'rebutting', 'supporting', 'contextualizing', 'correcting'
]);

/** Valid correction-type values, exported for the author UI. */
export const CORRECTION_TYPES = Object.freeze([
  'headline', 'quote', 'stat', 'name', 'date', 'other'
]);

// ------------------------------------------------------------------
// Internal helpers
// ------------------------------------------------------------------

function arrayify(v) {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v;
  return [v];
}

function uniqueStrings(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    if (typeof v !== 'string' || !v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

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
//   - Kind 30054 (Assessment)              — buildAssessmentEvent (gated;
//     Phase 11.2, docs/ASSESSMENTS_DESIGN.md)
//   - Kind 30055 (ClaimRelationship)       — buildClaimRelationshipEvent
//     (gated; Phase 11.2 — replaces the retired kind 30043)
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
import {
  ASSESSMENT_LABEL_NAMESPACE, isValidLabel, isValidStance,
  isValidSuggestedBy, CLAIM_RELATIONSHIPS, REVISION_RELATIONSHIPS,
  isSymmetricRelationship
} from '../assessment-taxonomy.js';
import {
  FORENSIC_MANEUVER_NAMESPACE, isValidManeuver, isValidRole, isValidBasis
} from '../forensic-taxonomy.js';

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
// Assessment — kind 30054 (Phase 11.2; publish flag-gated)
// ------------------------------------------------------------------

/**
 * Shape-validate + split a `30040:<pubkey>:<d>` claim coordinate.
 * Deliberately local: claim-ref.js owns the registry-aware
 * canonicalization, but importing it would drag storage.js (which
 * dereferences chrome at module load) into this chromeless module.
 * The coordinate format is frozen NIP-01; only the first two colons
 * delimit (foreign d-tags may contain colons).
 */
function parseClaimCoordinate(coord) {
  if (typeof coord !== 'string') return null;
  const first = coord.indexOf(':');
  if (first === -1) return null;
  const second = coord.indexOf(':', first + 1);
  if (second === -1) return null;
  const kind   = coord.slice(0, first);
  const pubkey = coord.slice(first + 1, second);
  const d      = coord.slice(second + 1);
  if (kind !== '30040') return null;
  if (!/^[0-9a-f]{64}$/.test(pubkey)) return null;
  if (!d) return null;
  return { pubkey, d };
}

function assertClaimCoordinate(coord, fnName, argName) {
  const parsed = parseClaimCoordinate(coord);
  if (!parsed) {
    throw new Error(`${fnName}: ${argName} must be a 30040:<pubkey>:<d> coordinate (local claim ids never hit the wire)`);
  }
  return parsed;
}

/**
 * Normalize + validate a labels array (strings or
 * `{label, anchor?, note?}` objects) against the taxonomy grammar.
 * One entry per label value — `label-anchor` / `label-note` tags are
 * keyed by the label, so duplicates would be unmatchable on read.
 */
function cleanWireLabels(labels, fnName) {
  if (labels === undefined || labels === null) return [];
  if (!Array.isArray(labels)) throw new Error(`${fnName}: labels must be an array`);
  const seen = new Set();
  const out = [];
  for (const entry of labels) {
    const rec = typeof entry === 'string' ? { label: entry } : (entry || {});
    if (!isValidLabel(rec.label)) throw new Error(`${fnName}: invalid label: ${rec.label}`);
    if (seen.has(rec.label)) throw new Error(`${fnName}: duplicate label: ${rec.label}`);
    seen.add(rec.label);
    out.push({ label: rec.label, anchor: rec.anchor || null, note: rec.note || '' });
  }
  return out;
}

function assertSuggestedBy(value, fnName) {
  const v = value === undefined || value === null ? 'user' : value;
  if (!isValidSuggestedBy(v)) {
    throw new Error(`${fnName}: suggestedBy must be 'user' or 'llm:<model>' (got ${v})`);
  }
  return v;
}

function assertEventIdOrNull(value, fnName, argName) {
  if (value === undefined || value === null || value === '') return null;
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${fnName}: ${argName} must be a 64-hex event id (got ${value})`);
  }
  return value;
}

/**
 * Build an unsigned kind 30054 Assessment event — a personal judgment
 * on one claim (NIP draft §30054): graded stance −2..+2 and/or typed
 * labels under the `xray/assessment` namespace, each label optionally
 * anchored to the offending span.
 *
 * Wire rules (docs/ASSESSMENTS_DESIGN.md):
 *   - the claim is referenced by `a` coordinate (+ optional `e`) —
 *     LOCAL IDS NEVER HIT THE WIRE; `d` = assess:<sha16(coord)> is
 *     recomputable from the `a` tag, so edits replace (NIP-01).
 *   - `r` mirrors the claim's `r` VERBATIM (the per-URL join key);
 *     `i`/`k` carry the normalized NIP-73 form.
 *   - `L`/`l` here are formally NIP-32 *self*-labels; §30054 defines
 *     them as applying to the `a`-referenced claim, and the kind-1985
 *     mirror (publish slice) is the ecosystem-aggregation path.
 *   - about-entity `p` tags are mirrored from the claim so one
 *     `{kinds:[30040,30054], "#p":[entity]}` filter pulls both.
 *
 * @param {object} args
 * @param {string} args.claimCoord          — `30040:<pubkey>:<d>` (required)
 * @param {string} args.claimUrl            — the claim's `r` value, verbatim (required)
 * @param {string} [args.claimEventId]      — specific event id for the `e` tag
 * @param {string} [args.relayHint]
 * @param {number|null} [args.stance]       — integer −2..2, or null (label-only)
 * @param {Array<string|{label,anchor,note}>} [args.labels]
 * @param {string} [args.rationale]         — markdown, becomes `content`
 * @param {Array<string>} [args.aboutPubkeys] — entity pubkeys mirrored from the claim
 * @param {string} [args.suggestedBy='user'] — 'user' | 'llm:<model>'
 * @param {number} [args.createdAt]
 * @returns {Promise<{event, body, dTag}>}
 */
export async function buildAssessmentEvent({
  claimCoord,
  claimUrl,
  claimEventId = null,
  relayHint = '',
  stance = null,
  labels = [],
  rationale = '',
  aboutPubkeys = [],
  suggestedBy = 'user',
  createdAt = nowSeconds()
} = {}) {
  const coord = assertClaimCoordinate(claimCoord, 'buildAssessmentEvent', 'claimCoord');
  const eventId = assertEventIdOrNull(claimEventId, 'buildAssessmentEvent', 'claimEventId');
  if (typeof claimUrl !== 'string' || !claimUrl) {
    throw new Error('buildAssessmentEvent: claimUrl required (the claim\'s r value, verbatim)');
  }
  if (stance !== null && stance !== undefined && !isValidStance(stance)) {
    throw new Error(`buildAssessmentEvent: stance must be an integer -2..2 or null (got ${stance})`);
  }
  const labelList = cleanWireLabels(labels, 'buildAssessmentEvent');
  if ((stance === null || stance === undefined) && labelList.length === 0) {
    throw new Error('buildAssessmentEvent: an assessment needs a stance or at least one label');
  }
  const provenance = assertSuggestedBy(suggestedBy, 'buildAssessmentEvent');
  const about = uniqueStrings(arrayify(aboutPubkeys));
  for (const pk of about) {
    if (!/^[0-9a-f]{64}$/.test(pk)) {
      throw new Error(`buildAssessmentEvent: aboutPubkeys entries must be 64-hex pubkeys (got ${pk})`);
    }
  }

  const dTag = 'assess:' + (await sha16(claimCoord));

  const tags = [
    tag('d', dTag),
    tag('a', claimCoord, relayHint)
  ];
  if (eventId) tags.push(tag('e', eventId, relayHint));
  tags.push(tag('p', coord.pubkey));
  tags.push(tag('r', claimUrl));                       // verbatim — joins with the 30040
  tags.push(tag('i', normalize(claimUrl)));            // NIP-73, normalization-stable
  tags.push(tag('k', 'web'));
  if (stance !== null && stance !== undefined) tags.push(tag('stance', String(stance)));
  if (labelList.length > 0) {
    tags.push(tag('L', ASSESSMENT_LABEL_NAMESPACE));
    for (const l of labelList) tags.push(tag('l', l.label, ASSESSMENT_LABEL_NAMESPACE));
    for (const l of labelList) {
      if (l.anchor) tags.push(tag('label-anchor', l.label, JSON.stringify(l.anchor)));
      if (l.note)   tags.push(tag('label-note', l.label, l.note));
    }
  }
  for (const pk of about) tags.push(tag('p', pk, '', 'about'));
  tags.push(tag('suggested-by', provenance));
  tags.push(tag('client', 'xray'));

  const body = String(rationale || '');
  return {
    event: { kind: 30054, created_at: createdAt, tags, content: body },
    body,
    dTag
  };
}

// ------------------------------------------------------------------
// ClaimRelationship — kind 30055 (Phase 11.2; publish flag-gated)
// ------------------------------------------------------------------

/**
 * Build an unsigned kind 30055 ClaimRelationship event — a typed link
 * between two claims (NIP draft §30055), replacing the retired kind
 * 30043.
 *
 * Wire rules (docs/ASSESSMENTS_DESIGN.md):
 *   - both endpoints are `a` coordinates with `source`/`target`
 *     markers in slot 4 (the repo's `['p', pk, '', role]` idiom);
 *     local ids never hit the wire.
 *   - symmetric relationships (`contradicts`, `duplicates`) sort the
 *     two coordinates lexically before hashing AND in tag order, so
 *     A↔B and B↔A republish the same `d` and replace; the markers
 *     carry no meaning for them. `supports`/`updates` are directional.
 *   - `d` = rel:<sha16(coordA|coordB|relationship)> MUST be
 *     recomputable from the `a` tags + `relationship`.
 *   - per endpoint: `r` verbatim + `i` normalized (deduped when the
 *     two claims share a URL), one `k`=web.
 *
 * @param {object} args
 * @param {string} args.sourceCoord / args.targetCoord — `30040:…` (required)
 * @param {string} args.relationship — contradicts|supports|updates|duplicates
 * @param {string} [args.sourceUrl] / [args.targetUrl] — claim `r` values, verbatim
 * @param {string} [args.sourceEventId] / [args.targetEventId]
 * @param {string} [args.sourceRelayHint] / [args.targetRelayHint]
 * @param {string} [args.note]            — becomes `content`
 * @param {string} [args.suggestedBy='user']
 * @param {number} [args.createdAt]
 * @returns {Promise<{event, body, dTag}>}
 */
export async function buildClaimRelationshipEvent({
  sourceCoord,
  targetCoord,
  relationship,
  sourceUrl = '',
  targetUrl = '',
  sourceEventId = null,
  targetEventId = null,
  sourceRelayHint = '',
  targetRelayHint = '',
  note = '',
  suggestedBy = 'user',
  createdAt = nowSeconds()
} = {}) {
  assertClaimCoordinate(sourceCoord, 'buildClaimRelationshipEvent', 'sourceCoord');
  assertClaimCoordinate(targetCoord, 'buildClaimRelationshipEvent', 'targetCoord');
  // Phase 14.3: the directional `revision/*` story-change values join the
  // Phase-11 four on this kind. They are never symmetric, so the
  // endpoint sort below correctly leaves source = earlier, target = later.
  const ALL_RELATIONSHIPS = [...CLAIM_RELATIONSHIPS, ...REVISION_RELATIONSHIPS];
  if (!ALL_RELATIONSHIPS.includes(relationship)) {
    throw new Error(`buildClaimRelationshipEvent: relationship must be one of ${ALL_RELATIONSHIPS.join(', ')} (got ${relationship})`);
  }
  if (sourceCoord === targetCoord) {
    throw new Error('buildClaimRelationshipEvent: cannot link a claim to itself');
  }
  const provenance = assertSuggestedBy(suggestedBy, 'buildClaimRelationshipEvent');

  // Bundle each endpoint so the symmetric sort swaps everything together.
  let src = {
    coord: sourceCoord, url: sourceUrl, hint: sourceRelayHint,
    eventId: assertEventIdOrNull(sourceEventId, 'buildClaimRelationshipEvent', 'sourceEventId')
  };
  let tgt = {
    coord: targetCoord, url: targetUrl, hint: targetRelayHint,
    eventId: assertEventIdOrNull(targetEventId, 'buildClaimRelationshipEvent', 'targetEventId')
  };
  if (isSymmetricRelationship(relationship) && tgt.coord < src.coord) {
    [src, tgt] = [tgt, src];
  }

  const dTag = 'rel:' + (await sha16(`${src.coord}|${tgt.coord}|${relationship}`));

  const tags = [
    tag('d', dTag),
    tag('a', src.coord, src.hint, 'source'),
    tag('a', tgt.coord, tgt.hint, 'target')
  ];
  if (src.eventId) tags.push(tag('e', src.eventId, '', 'source'));
  if (tgt.eventId) tags.push(tag('e', tgt.eventId, '', 'target'));
  tags.push(tag('relationship', relationship));
  const urls = uniqueStrings([src.url, tgt.url]);
  for (const u of urls) tags.push(tag('r', u));                       // verbatim
  for (const u of uniqueStrings(urls.map((x) => normalize(x)))) {
    tags.push(tag('i', u));                                           // NIP-73
  }
  if (urls.length > 0) tags.push(tag('k', 'web'));
  tags.push(tag('suggested-by', provenance));
  tags.push(tag('client', 'xray'));

  const body = String(note || '');
  return {
    event: { kind: 30055, created_at: createdAt, tags, content: body },
    body,
    dTag
  };
}

/**
 * Build an unsigned kind 1985 label event mirroring an assessment's
 * labels — the designated plain-NIP-32 ecosystem-aggregation path
 * (NIP draft §30054): generic NIP-32 consumers query kind 1985 and
 * read `L`/`l` against the `a`-referenced target, which is exactly
 * this shape. Emitted alongside a labeled 30054 on its FIRST publish,
 * behind the same `assessmentPublishing` flag. Notes/anchors/stance
 * stay on the 30054 — the mirror is aggregation-only.
 *
 * On a kind-1985 event every subject tag (`a`/`e`/`p`/`r`) is a
 * LABELED target, so the labels here apply to the `a`-referenced claim
 * (and the verbatim `r` URL, for the draft's `#r` 1985 query). We
 * deliberately do NOT emit a `p` tag: a `p` on a 1985 would label the
 * claim's AUTHOR with the issue labels — a reputational mislabel.
 *
 * @param {object} args
 * @param {string} args.claimCoord      — `30040:<pubkey>:<d>` (required)
 * @param {Array<string>} args.labels   — at least one taxonomy/custom label
 * @param {string} [args.claimUrl]      — the claim's `r`, verbatim (for #r)
 * @param {string} [args.relayHint]
 * @param {number} [args.createdAt]
 * @returns {{event, body, dTag: null}}  (kind 1985 is a regular event)
 */
export function buildAssessmentMirrorEvent({
  claimCoord,
  labels,
  claimUrl = '',
  relayHint = '',
  createdAt = nowSeconds()
} = {}) {
  assertClaimCoordinate(claimCoord, 'buildAssessmentMirrorEvent', 'claimCoord');
  const labelList = cleanWireLabels(labels, 'buildAssessmentMirrorEvent');
  if (labelList.length === 0) {
    throw new Error('buildAssessmentMirrorEvent: at least one label required');
  }

  const tags = [
    tag('L', ASSESSMENT_LABEL_NAMESPACE),
    ...labelList.map((l) => tag('l', l.label, ASSESSMENT_LABEL_NAMESPACE)),
    tag('a', claimCoord, relayHint)
  ];
  if (claimUrl) tags.push(tag('r', claimUrl));
  tags.push(tag('client', 'xray'));

  return {
    event: { kind: 1985, created_at: createdAt, tags, content: '' },
    body: '',
    dTag: null
  };
}

// ------------------------------------------------------------------
// Review-request labels — kind 1985 under `xray/review` (Phase 25.4,
// KS.6 / TEAM_CASE §5: "I want adversarial eyes on this", stamped on
// one's OWN event). Publish is gated by `reviewCoordination`.
// ------------------------------------------------------------------

export const REVIEW_LABEL_NAMESPACE = 'xray/review';

// The exhaustive enum (TC §10.3): a request opens review, a done
// closes it. Extend deliberately, with a design-doc change.
export const REVIEW_LABEL_VALUES = Object.freeze(['review-requested', 'review-done']);

/**
 * A review-coordination label on an artifact. Subject tags are the
 * labeled TARGET (`a` coordinate, optional `e` event id, optional
 * verbatim `r` URL); as on every X-Ray 1985 we deliberately emit no
 * `p` — a `p` here would label the artifact's AUTHOR.
 *
 * @param {object} args
 * @param {string} args.value           — one of REVIEW_LABEL_VALUES
 * @param {string} args.targetCoord     — `<kind>:<pubkey>:<d>` (required)
 * @param {string} [args.targetEventId] — the exact event id, when known
 * @param {string} [args.url]           — the artifact's `r`, verbatim
 * @param {string} [args.relayHint]
 * @param {number} [args.createdAt]
 * @returns {{event, body, dTag: null}}  (kind 1985 is a regular event)
 */
export function buildReviewRequestLabelEvent({
  value,
  targetCoord,
  targetEventId = '',
  url = '',
  relayHint = '',
  createdAt = nowSeconds()
} = {}) {
  if (!REVIEW_LABEL_VALUES.includes(value)) {
    throw new Error(`buildReviewRequestLabelEvent: value must be one of ${REVIEW_LABEL_VALUES.join(', ')} (got ${value})`);
  }
  if (typeof targetCoord !== 'string' || !/^\d+:[0-9a-f]{64}:/.test(targetCoord)) {
    throw new Error('buildReviewRequestLabelEvent: targetCoord must be a <kind>:<pubkey>:<d> coordinate');
  }

  const tags = [
    tag('L', REVIEW_LABEL_NAMESPACE),
    tag('l', value, REVIEW_LABEL_NAMESPACE),
    tag('a', targetCoord, relayHint)
  ];
  if (targetEventId) tags.push(tag('e', targetEventId));
  if (url) tags.push(tag('r', url));
  tags.push(tag('client', 'xray'));

  return {
    event: { kind: 1985, created_at: createdAt, tags, content: '' },
    body: '',
    dTag: null
  };
}

/**
 * Read-side inverse. Returns `{value, targetCoord, targetEventId,
 * url, pubkey, created_at}` or null for events that aren't
 * `xray/review` labels (wrong kind, other namespace, unknown value,
 * or no `a` target).
 */
export function parseReviewLabelEvent(event) {
  if (!event || event.kind !== 1985) return null;
  const tags = event.tags || [];
  const first = (name) => { const t = tags.find((x) => Array.isArray(x) && x[0] === name); return t ? t[1] : ''; };
  if (first('L') !== REVIEW_LABEL_NAMESPACE) return null;
  const value = (tags.find((x) => Array.isArray(x) && x[0] === 'l' && REVIEW_LABEL_VALUES.includes(x[1])) || [])[1];
  const targetCoord = first('a');
  if (!value || !targetCoord) return null;
  return {
    value,
    targetCoord,
    targetEventId: first('e') || null,
    url: first('r') || null,
    pubkey: event.pubkey || '',
    created_at: event.created_at || 0
  };
}

// ------------------------------------------------------------------
// BehavioralFinding — kind 30062 (Phase 14.3; publish flag-gated)
// ------------------------------------------------------------------

// The content carries the structural `note` then the REQUIRED
// `counter_note`, split by this stable heading. Parsers split on its
// LAST occurrence, so a note that happens to contain the heading can't
// swallow the appended counter-read.
export const FORENSIC_COUNTER_HEADING = '### Counter-read';

function cleanFindingSteps(anchors, fnName) {
  if (!Array.isArray(anchors) || anchors.length === 0) {
    throw new Error(`${fnName}: at least one evidence anchor (with a quote) required`);
  }
  return anchors.map((a, i) => {
    const quote = String((a && a.quote) || '').trim();
    if (!quote) throw new Error(`${fnName}: anchor ${i} needs a non-empty quote`);
    const ts = a && (a.timestamp === 0 || a.timestamp) ? Number(a.timestamp) : null;
    return {
      quote,
      selector: a && a.selector != null ? a.selector : null,
      timestamp: Number.isFinite(ts) ? ts : null
    };
  });
}

/**
 * Build an unsigned kind 30062 BehavioralFinding event (NIP draft
 * §30062) — names a MANEUVER a subject performs around the truth and
 * binds it to an ordered evidence chain. The companion to the kind-30054
 * assessment: where an assessment grades a *claim*, a finding describes
 * a *subject's* move, and renders NO verdict on honesty or intent.
 *
 * Firewall (enforced by construction, pinned by tests): the closed tag
 * vocabulary never emits `stance`, `rating-value`, or the
 * `xray/assessment` namespace — a forensic finding is a distinct
 * aggregation signal that consumers MUST NOT merge with assessments.
 *
 * Wire rules (docs/CRIMINOLOGY_DESIGN.md §30062):
 *   - the subject is referenced by `p` with a `subject` slot-4 marker;
 *     the finding publishes against a RESOLVED subject pubkey, so local
 *     subject refs (label/account) never hit the wire.
 *   - `d` = find:<sha16(subjectPubkey|maneuver|anchorsHash)> is
 *     recomputable from the event's own tags (`p` + `l` + the ordered
 *     `maneuver-step` tags), so edits replace (NIP-01).
 *   - `L`/`l` carry the maneuver under `xray/forensic`; a kind-1985
 *     mirror (buildForensicFindingMirrorEvent) is the NIP-32 path.
 *   - `maneuver-step` tags are ordered `[index, quote, selector-json,
 *     timestamp]`; n>1 is a sequence. Multi-letter tags (`role`,
 *     `maneuver-step`, `basis`, `suggested-by`) are not relay-indexed.
 *   - `content` = the structural `note`, then the REQUIRED `counter_note`
 *     under the `### Counter-read` heading (the falsifiability rule).
 *
 * @param {object} args
 * @param {string} args.subjectPubkey       — 64-hex (required; the `p` subject)
 * @param {string} args.maneuver            — taxonomy value (required)
 * @param {string} args.role                — role enum (required)
 * @param {Array<{quote,selector?,timestamp?}>} args.anchors — ordered, ≥1
 * @param {string} args.counterNote         — REQUIRED (the alternative reading)
 * @param {string} [args.note]              — structural rationale (markdown)
 * @param {string} [args.basis='structural-inference']
 * @param {string} [args.sourceUrl]         — verbatim, for `r`/`i`/`k`
 * @param {string} [args.relationshipCoord] — optional `30055:…` revision edge
 * @param {string} [args.suggestedBy='user']
 * @param {number} [args.createdAt]
 * @returns {Promise<{event, body, dTag}>}
 */
export async function buildBehavioralFindingEvent({
  subjectPubkey,
  maneuver,
  role,
  anchors = [],
  counterNote,
  note = '',
  basis = 'structural-inference',
  sourceUrl = '',
  relationshipCoord = null,
  suggestedBy = 'user',
  createdAt = nowSeconds()
} = {}) {
  if (!/^[0-9a-f]{64}$/.test(String(subjectPubkey || ''))) {
    throw new Error('buildBehavioralFindingEvent: subjectPubkey must be a 64-hex pubkey (a finding publishes against a resolved subject)');
  }
  if (!isValidManeuver(maneuver)) {
    throw new Error(`buildBehavioralFindingEvent: invalid maneuver (got ${maneuver})`);
  }
  if (!isValidRole(role)) {
    throw new Error(`buildBehavioralFindingEvent: invalid role (got ${role})`);
  }
  if (!isValidBasis(basis)) {
    throw new Error(`buildBehavioralFindingEvent: invalid basis (got ${basis})`);
  }
  const cn = String(counterNote || '').trim();
  if (!cn) {
    throw new Error('buildBehavioralFindingEvent: counterNote required (the alternative reading)');
  }
  if (relationshipCoord != null && !/^30055:[0-9a-f]{64}:.+$/.test(String(relationshipCoord))) {
    throw new Error(`buildBehavioralFindingEvent: relationshipCoord must be a 30055 coordinate (got ${relationshipCoord})`);
  }
  const provenance = assertSuggestedBy(suggestedBy, 'buildBehavioralFindingEvent');
  const steps = cleanFindingSteps(anchors, 'buildBehavioralFindingEvent');

  // anchorsHash over the wire-visible step data, so the `d` recomputes
  // from the `maneuver-step` tags alone.
  const preimage = steps.map((s) => [
    s.quote,
    s.selector ? JSON.stringify(s.selector) : '',
    s.timestamp == null ? '' : String(s.timestamp)
  ]);
  const anchorsHash = await sha256Hex(JSON.stringify(preimage));
  const dTag = 'find:' + (await sha16(`${subjectPubkey}|${maneuver}|${anchorsHash}`));

  const tags = [
    tag('d', dTag),
    tag('p', subjectPubkey, '', 'subject'),
    tag('L', FORENSIC_MANEUVER_NAMESPACE),
    tag('l', maneuver, FORENSIC_MANEUVER_NAMESPACE),
    tag('role', role)
  ];
  if (sourceUrl) {
    tags.push(tag('r', sourceUrl));
    tags.push(tag('i', normalize(sourceUrl)));
    tags.push(tag('k', 'web'));
  }
  if (relationshipCoord) tags.push(tag('a', relationshipCoord));
  steps.forEach((s, i) => {
    tags.push(tag('maneuver-step', String(i), s.quote,
      s.selector ? JSON.stringify(s.selector) : '',
      s.timestamp == null ? '' : String(s.timestamp)));
  });
  tags.push(tag('basis', basis));
  tags.push(tag('suggested-by', provenance));
  tags.push(tag('client', 'xray'));

  const body = `${String(note || '').trim()}\n\n${FORENSIC_COUNTER_HEADING}\n\n${cn}`;
  return {
    event: { kind: 30062, created_at: createdAt, tags, content: body },
    body,
    dTag
  };
}

/**
 * Build an unsigned kind 1985 label event mirroring a finding's
 * maneuver — the NIP-32 ecosystem-aggregation path for forensic
 * findings (NIP draft §30062).
 *
 * Unlike the assessment mirror (which omits `p` to avoid labeling the
 * claim's author), this mirror DOES carry `p` = the subject: the
 * maneuver label is *about* that person's move. The NIP text MUST frame
 * these as structural observations carrying a required counter-read on
 * the richer 30062 — never verdicts — and recommend consumers surface
 * that counter-read. Emitted alongside a 30062 on its first publish,
 * behind the same `forensicPublishing` flag.
 *
 * @param {object} args
 * @param {string} args.subjectPubkey   — 64-hex (the labeled subject)
 * @param {string} args.maneuver        — taxonomy value
 * @param {string} [args.sourceUrl]     — verbatim, for the draft's `#r` query
 * @param {number} [args.createdAt]
 * @returns {{event, body, dTag: null}}  (kind 1985 is a regular event)
 */
export function buildForensicFindingMirrorEvent({
  subjectPubkey,
  maneuver,
  sourceUrl = '',
  createdAt = nowSeconds()
} = {}) {
  if (!/^[0-9a-f]{64}$/.test(String(subjectPubkey || ''))) {
    throw new Error('buildForensicFindingMirrorEvent: subjectPubkey must be a 64-hex pubkey');
  }
  if (!isValidManeuver(maneuver)) {
    throw new Error(`buildForensicFindingMirrorEvent: invalid maneuver (got ${maneuver})`);
  }
  const tags = [
    tag('L', FORENSIC_MANEUVER_NAMESPACE),
    tag('l', maneuver, FORENSIC_MANEUVER_NAMESPACE),
    tag('p', subjectPubkey)
  ];
  if (sourceUrl) tags.push(tag('r', sourceUrl));
  tags.push(tag('client', 'xray'));
  return {
    event: { kind: 1985, created_at: createdAt, tags, content: '' },
    body: '',
    dTag: null
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

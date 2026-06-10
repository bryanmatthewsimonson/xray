// Claim references — Phase 11.1 (docs/ASSESSMENTS_DESIGN.md).
//
// Everything in the assessment layer points at claims. A claim is
// referenced in one of two forms:
//
//   - local claim id    `claim_<16 hex>`               — claims we authored
//   - event coordinate  `30040:<author-pubkey>:<d>`    — claims on the wire
//
// The CANONICAL form is the local id for our own claims and the
// coordinate for foreign ones. `canonicalizeClaimRef` collapses a
// coordinate that points at one of our own *published* claims down to
// its local id — the 30040 `d` tag IS the local claim id, and
// `ClaimModel.markPublished` records the publishing pubkey — so the
// same logical claim keys identically pre- and post-publish, and the
// one-assessment-per-claim / one-link-per-pair invariants hold.
//
// The d-tag alone is NOT sufficient to recognize our own claims:
// claim ids hash (source_url | normalized text), so two users who
// capture the same quote from the same URL derive the same d under
// different pubkeys. The pubkey must match a recorded publishedPubkey.

import { ClaimModel } from './claim-model.js';

export const CLAIM_KIND = 30040;

const LOCAL_ID_RE = /^claim_[0-9a-f]{16}$/;
const PUBKEY_RE   = /^[0-9a-f]{64}$/;

export function isLocalClaimId(ref) {
    return typeof ref === 'string' && LOCAL_ID_RE.test(ref);
}

/**
 * Parse a `30040:<pubkey>:<d>` coordinate. The d-tag may itself
 * contain colons (foreign clients pick arbitrary d values), so only
 * the first two colons delimit. Returns `{ kind, pubkey, d }` or null.
 */
export function parseClaimCoord(ref) {
    if (typeof ref !== 'string') return null;
    const first = ref.indexOf(':');
    if (first === -1) return null;
    const second = ref.indexOf(':', first + 1);
    if (second === -1) return null;
    const kind   = ref.slice(0, first);
    const pubkey = ref.slice(first + 1, second);
    const d      = ref.slice(second + 1);
    if (kind !== String(CLAIM_KIND)) return null;
    if (!PUBKEY_RE.test(pubkey)) return null;
    if (!d) return null;
    return { kind: CLAIM_KIND, pubkey, d };
}

export function isClaimCoord(ref) {
    return parseClaimCoord(ref) !== null;
}

export function buildClaimCoord(pubkey, d) {
    if (!PUBKEY_RE.test(String(pubkey || ''))) {
        throw new Error('buildClaimCoord: pubkey must be 64 hex chars');
    }
    if (!d) throw new Error('buildClaimCoord: d-tag value required');
    return `${CLAIM_KIND}:${pubkey}:${d}`;
}

/**
 * Validate a ref is one of the two accepted forms. Returns the
 * trimmed ref; throws with a greppable message otherwise.
 */
export function assertValidClaimRef(ref, label = 'claim ref') {
    const trimmed = String(ref || '').trim();
    if (!trimmed) throw new Error(`${label} is required`);
    if (!isLocalClaimId(trimmed) && !isClaimCoord(trimmed)) {
        throw new Error(`${label} must be a claim id or a 30040 coordinate (got ${trimmed})`);
    }
    return trimmed;
}

/**
 * Every pubkey a claim is known to have published under. Collapse
 * matches ANY of them (design rule 1: a republish under a new signing
 * identity must not turn old coordinates — live addressable events on
 * relays — back into "foreign" refs).
 */
export function claimPublishedPubkeys(claim) {
    if (!claim) return [];
    const out = Array.isArray(claim.publishedPubkeys) ? [...claim.publishedPubkeys] : [];
    if (claim.publishedPubkey && !out.includes(claim.publishedPubkey)) {
        out.push(claim.publishedPubkey);
    }
    return out;
}

/**
 * Collapse a ref to canonical form: local id for our own claims,
 * coordinate for foreign ones. Async — reads the claim registry to
 * check whether a coordinate points at one of our published claims.
 */
export async function canonicalizeClaimRef(ref, label = 'claim ref') {
    const trimmed = assertValidClaimRef(ref, label);
    if (isLocalClaimId(trimmed)) return trimmed;
    const coord = parseClaimCoord(trimmed);
    if (coord && LOCAL_ID_RE.test(coord.d)) {
        const claim = await ClaimModel.get(coord.d);
        if (claim && claimPublishedPubkeys(claim).includes(coord.pubkey)) return coord.d;
    }
    return trimmed;
}

/**
 * Snapshot canonicalizer for matching MANY stored refs: one claim-
 * registry read, then synchronous collapses. Canonicality is
 * time-dependent (a coordinate becomes collapsible only once its
 * claim records a publishedPubkey), so matchers MUST canonicalize the
 * stored side at read time too — a record whose ref was canonical at
 * write time may have drifted. Comparing canon(stored) === canon(query)
 * keeps those records reachable and keeps idempotent-create finding
 * them. Stored refs are pre-validated, so no assertion here.
 */
export async function makeClaimRefCanonicalizer() {
    const claims = await ClaimModel.getAll();
    return (ref) => {
        const trimmed = String(ref || '').trim();
        if (isLocalClaimId(trimmed)) return trimmed;
        const coord = parseClaimCoord(trimmed);
        if (coord && LOCAL_ID_RE.test(coord.d)) {
            const claim = claims[coord.d];
            if (claim && claimPublishedPubkeys(claim).includes(coord.pubkey)) return coord.d;
        }
        return trimmed;
    };
}

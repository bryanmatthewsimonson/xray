// Truth-adjudication wire builders + parsers — Phase 15.6
// (docs/TRUTH_ADJUDICATION_DESIGN.md §3.3/§3.4 wire; docs/NIP_DRAFT.md
// kinds 30063/30064). Follows the 30062 idioms exactly: each builder
// returns `{event, body, dTag}` with an unsigned NIP-01 event, a
// deterministic `d` recomputable from the event's own public tags,
// and throw-on-invalid inputs; parsers are pure and return null on
// structurally unusable events.
//
// Wire-level red lines, enforced here and not just documented:
//   - A 30063 verdict carries NO `p` tag — verdicts attach to
//     PROPOSITIONS, not persons (§5.3). Its 1985 mirror labels the
//     claim COORDINATE, never a pubkey.
//   - The §3.1 firewall holds on the wire: a 30063 cannot be built
//     for (and a parser will not admit) an `interpretation` or
//     `stated-value` proposition.
//   - Caveats are REQUIRED tags — no verdict travels without what it
//     could not determine (§2 decontextualization row).
//   - There is deliberately NO kind-1985 mirror for a 30064: a bare
//     match-label on a person's pubkey, stripped of its evidence and
//     caveats, is exactly the decontextualized person-grade §3.5
//     forbids. The full 30064 is the only wire shape.
//   - Kind 30065 (PrecedentCitation) is RESERVED, not implemented;
//     the `precedent` a-tag marker grammar below is the reserved
//     citation surface (§3.6).
//
// Publishing is gated by the `truthAdjudicationPublishing` flag
// (metadata/feature-flags.js); the SW always ACCEPTS inbound events.

import { Crypto } from './crypto.js';
import { normalize as normalizeUrl } from './metadata/url-normalizer.js';
import {
    isTruthAdjudicable, isValidPropositionClass,
    SUBJECT_ROLES, SUBJECT_ROLE_UNCLASSIFIED, isValidSubjectRole,
    isValidOccurredPrecision,
    HEDGE_LEVELS, TRACTABILITIES, isValidEvidenceTier,
    VERDICT_STATES, isValidVerdictState,
    STANDARDS_OF_PROOF, isValidStandardOfProof, defaultStandardOfProof,
    INTEGRITY_MATCH_STATES, isValidMatchForWordClass, matchStatesForWordClass,
    GAP_MATCH_STATES, GAP_CAUSES, isValidGapCause,
    PRECEDENT_WEIGHTS, isValidPrecedentWeight,
    isValidSuggestedBy
} from './truth-taxonomy.js';

export const KIND_ADJUDICATED_VERDICT = 30063;
export const KIND_INTEGRITY_FINDING = 30064;
export const KIND_PRECEDENT_RESERVED = 30065;   // reserved, unimplemented (§3.6)

// NIP-32 namespace for verdict states + match states.
export const ADJUDICATION_NAMESPACE = 'xray/adjudication';

const COORD_30040_RE = /^30040:[0-9a-f]{64}:.+$/;
const COORD_30055_RE = /^30055:[0-9a-f]{64}:.+$/;
const COORD_PRECEDENT_RE = /^3006[34]:[0-9a-f]{64}:.+$/;   // a prior 30063/30064
const HEX64_RE = /^[0-9a-f]{64}$/;

function nowSeconds() { return Math.floor(Date.now() / 1000); }

function tag(name, ...values) {
    const out = [name, ...values];
    while (out.length > 1 && (out[out.length - 1] === '' || out[out.length - 1] == null)) out.pop();
    return out.map((v) => (v == null ? '' : String(v)));
}

async function sha16(s) {
    return (await Crypto.sha256(s)).slice(0, 16);
}

function assertSuggestedBy(value, fn) {
    const v = value === undefined || value === null ? 'user' : value;
    if (!isValidSuggestedBy(v)) {
        throw new Error(`${fn}: invalid suggested_by (got ${value})`);
    }
    return v;
}

function assertCaveats(caveats, fn) {
    const arr = Array.isArray(caveats) ? caveats : (caveats ? [caveats] : []);
    const out = arr.map((c) => String(c || '').trim()).filter(Boolean);
    if (out.length === 0) {
        throw new Error(`${fn}: at least one caveat required — what the ruling could not determine travels with it`);
    }
    return out;
}

/**
 * Evidence entries for the wire: ordered multi-letter tags
 * `[<side>, quote, tier, url, coord]` (trailing empties trimmed).
 * Quote required; tier/url/coord optional but validated.
 */
function cleanWireEvidence(entries, side, fn) {
    if (entries === undefined || entries === null) return [];
    if (!Array.isArray(entries)) throw new Error(`${fn}: ${side} must be an array`);
    return entries.map((entry, i) => {
        const rec = entry || {};
        const quote = String(rec.quote || '').trim();
        if (!quote) throw new Error(`${fn}: ${side}[${i}] needs a verbatim quote`);
        const tier = rec.tier == null ? '' : rec.tier;
        if (tier !== '' && !isValidEvidenceTier(tier)) {
            throw new Error(`${fn}: ${side}[${i}] invalid tier (got ${rec.tier})`);
        }
        const coord = rec.coord == null ? '' : String(rec.coord);
        if (coord !== '' && !COORD_30040_RE.test(coord)) {
            throw new Error(`${fn}: ${side}[${i}] coord must be a 30040 coordinate (got ${coord})`);
        }
        return { quote, tier, url: rec.url ? String(rec.url) : '', coord };
    });
}

function evidenceTags(name, entries) {
    return entries.map((e) => tag(name, e.quote, e.tier, e.url, e.coord));
}

function parseEvidenceTags(tags, name) {
    return tags.filter((t) => t[0] === name).map((t) => ({
        quote: t[1] || '',
        tier:  t[2] && isValidEvidenceTier(t[2]) ? t[2] : null,
        url:   t[3] || '',
        coord: t[4] || ''
    }));
}

function assertOccurred(occurredAt, occurredPrecision, fn) {
    const hasAt = occurredAt !== undefined && occurredAt !== null && occurredAt !== '';
    if (!hasAt) {
        if (occurredPrecision) throw new Error(`${fn}: occurred_precision without occurred_at`);
        return null;
    }
    const at = Number(occurredAt);
    if (!Number.isInteger(at)) throw new Error(`${fn}: occurred_at must be Unix seconds (got ${occurredAt})`);
    if (!isValidOccurredPrecision(occurredPrecision)) {
        throw new Error(`${fn}: occurred_at requires a valid occurred_precision — no false precision`);
    }
    return { at, precision: occurredPrecision };
}

function sourceUrlTags(sourceUrl) {
    if (!sourceUrl) return [];
    return [tag('r', sourceUrl), tag('i', normalizeUrl(sourceUrl)), tag('k', 'web')];
}

/**
 * Shared §3.6 / §2 fields for both truth kinds:
 *   - precedents [{coord, weight}] → ['a', coord, relay, 'precedent', weight]
 *     (informational-only until 30065 ships; coord must be a prior
 *     30063/30064; weight binding|persuasive)
 *   - replyEventIds → ['e', id, relay, 'reply'] (the subject-authored
 *     right-of-reply, referenced FROM the ruling)
 *   - exposure → ['exposure', text] (adjudicator interests, published
 *     with the ruling — never inferred)
 */
function citationTags({ precedents = [], replyEventIds = [], exposure = '' }, relayHint, fn) {
    const tags = [];
    if (!Array.isArray(precedents)) throw new Error(`${fn}: precedents must be an array`);
    for (const [i, p] of precedents.entries()) {
        const rec = p || {};
        if (!COORD_PRECEDENT_RE.test(String(rec.coord || ''))) {
            throw new Error(`${fn}: precedents[${i}].coord must be a 30063/30064 coordinate (got ${rec.coord})`);
        }
        const weight = rec.weight === undefined || rec.weight === null ? 'persuasive' : rec.weight;
        if (!isValidPrecedentWeight(weight)) {
            throw new Error(`${fn}: precedents[${i}].weight must be ${PRECEDENT_WEIGHTS.join(' | ')} (got ${rec.weight})`);
        }
        tags.push(tag('a', rec.coord, relayHint, 'precedent', weight));
    }
    if (!Array.isArray(replyEventIds)) throw new Error(`${fn}: replyEventIds must be an array`);
    for (const [i, id] of replyEventIds.entries()) {
        if (!HEX64_RE.test(String(id || ''))) {
            throw new Error(`${fn}: replyEventIds[${i}] must be a 64-hex event id (got ${id})`);
        }
        tags.push(tag('e', id, relayHint, 'reply'));
    }
    const exposureText = String(exposure || '').trim();
    if (exposureText) tags.push(tag('exposure', exposureText));
    return tags;
}

function parseCitationTags(tags) {
    const precedents = tags
        .filter((t) => t[0] === 'a' && t[3] === 'precedent' && COORD_PRECEDENT_RE.test(t[1] || ''))
        .map((t) => ({ coord: t[1], weight: isValidPrecedentWeight(t[4]) ? t[4] : 'persuasive' }));
    const replyEventIds = tags
        .filter((t) => t[0] === 'e' && t[3] === 'reply' && HEX64_RE.test(t[1] || ''))
        .map((t) => t[1]);
    const exposureTag = tags.find((t) => t[0] === 'exposure');
    return { precedents, replyEventIds, exposure: (exposureTag && exposureTag[1]) || '' };
}

// ------------------------------------------------------------------
// Kind 30063 — AdjudicatedVerdict
// ------------------------------------------------------------------

/** The wire `d` for a verdict: keyed (author, proposition) — the
 *  author is the event pubkey, the proposition is (claim coord |
 *  class). Recomputable from the event's `a` + `proposition-class`
 *  tags; a superseding ruling REPLACES on relays (NIP-01 addressable)
 *  and chains by `e supersedes` to keep the lineage legible. */
export async function deriveVerdictDTag(claimCoord, propositionClass) {
    return 'verdict:' + (await sha16(`${claimCoord}|${propositionClass}`));
}

/**
 * Build an unsigned kind-30063 AdjudicatedVerdict. Single-author:
 * the signer IS the adjudicator; there is no consensus field and no
 * estimated score. NO `p` tag exists on this kind (§5.3).
 *
 * @param {object} args
 * @param {string} args.claimCoord        — `30040:<pubkey>:<d>` of the atomized claim (required)
 * @param {string} args.propositionClass  — truth-adjudicable class (firewall enforced)
 * @param {string} args.verdict           — descriptive state (required)
 * @param {string[]} args.caveats         — REQUIRED, ≥1
 * @param {Array}  [args.evidenceFor]     — {quote, tier?, url?, coord?}
 * @param {Array}  [args.evidenceAgainst]
 * @param {string} [args.standardOfProof] — defaults per class, always declared
 * @param {object} [args.resolutionCriteria] — {criteria, horizon?, horizonIso?, hedgeLevel?, tractability?}
 * @param {string} [args.subjectRole='unclassified']
 * @param {number} [args.occurredAt]      — with occurredPrecision, or neither
 * @param {string} [args.occurredPrecision]
 * @param {string} [args.method]
 * @param {string} [args.rationale]       — the content body
 * @param {string} [args.supersedesEventId] — 64-hex id of the ruling this replaces
 * @param {string} [args.sourceUrl]
 * @param {string} [args.relayHint]
 * @param {string} [args.suggestedBy='user']
 * @param {number} [args.createdAt]
 * @returns {Promise<{event: object, body: string, dTag: string}>}
 */
export async function buildAdjudicatedVerdictEvent({
    claimCoord,
    propositionClass,
    verdict,
    caveats,
    evidenceFor = [],
    evidenceAgainst = [],
    standardOfProof = null,
    resolutionCriteria = {},
    subjectRole = SUBJECT_ROLE_UNCLASSIFIED,
    occurredAt = null,
    occurredPrecision = null,
    method = '',
    rationale = '',
    precedents = [],
    replyEventIds = [],
    exposure = '',
    supersedesEventId = null,
    sourceUrl = '',
    relayHint = '',
    suggestedBy = 'user',
    createdAt = nowSeconds()
} = {}) {
    const FN = 'buildAdjudicatedVerdictEvent';
    if (!claimCoord || !COORD_30040_RE.test(claimCoord)) {
        throw new Error(`${FN}: claimCoord must be a 30040 coordinate (got ${claimCoord})`);
    }
    if (!isValidPropositionClass(propositionClass)) {
        throw new Error(`${FN}: invalid proposition_class (got ${propositionClass})`);
    }
    if (!isTruthAdjudicable(propositionClass)) {
        throw new Error(`${FN}: '${propositionClass}' is not adjudicable as true/false — `
            + 'the interpretation/value firewall (§3.1) holds on the wire');
    }
    if (!isValidVerdictState(verdict)) {
        throw new Error(`${FN}: verdict must be one of ${VERDICT_STATES.join(', ')} (got ${verdict})`);
    }
    const standard = standardOfProof === null || standardOfProof === undefined
        ? defaultStandardOfProof(propositionClass) : standardOfProof;
    if (!isValidStandardOfProof(standard)) {
        throw new Error(`${FN}: standard_of_proof must be one of ${STANDARDS_OF_PROOF.join(', ')} (got ${standardOfProof})`);
    }
    if (!isValidSubjectRole(subjectRole)) {
        throw new Error(`${FN}: invalid subject_role (got ${subjectRole})`);
    }
    const cleanFor = cleanWireEvidence(evidenceFor, 'evidenceFor', FN);
    const cleanAgainst = cleanWireEvidence(evidenceAgainst, 'evidenceAgainst', FN);
    if (verdict === 'established-true' && cleanFor.length === 0) {
        throw new Error(`${FN}: established-true needs evidenceFor — no verdict the reader cannot re-derive`);
    }
    if (verdict === 'established-false' && cleanAgainst.length === 0) {
        throw new Error(`${FN}: established-false needs evidenceAgainst — no verdict the reader cannot re-derive`);
    }
    if (verdict === 'contested' && (cleanFor.length === 0 || cleanAgainst.length === 0)) {
        throw new Error(`${FN}: contested means credible evidence BOTH ways`);
    }
    const caveatList = assertCaveats(caveats, FN);

    const rc = resolutionCriteria || {};
    const criteria = String(rc.criteria || '').trim();
    if (!criteria) {
        throw new Error(`${FN}: resolutionCriteria.criteria required — what evidence settles the proposition`);
    }
    const horizon = String(rc.horizon || '').trim();
    if (propositionClass === 'prediction' && !horizon) {
        throw new Error(`${FN}: a prediction proposition requires a horizon`);
    }
    const horizonIso = rc.horizonIso ? String(rc.horizonIso) : '';
    if (horizonIso && !/^\d{4}-\d{2}-\d{2}$/.test(horizonIso)) {
        throw new Error(`${FN}: horizonIso must be YYYY-MM-DD (got ${horizonIso})`);
    }
    const hedge = rc.hedgeLevel == null ? '' : rc.hedgeLevel;
    if (hedge !== '' && !HEDGE_LEVELS.includes(hedge)) {
        throw new Error(`${FN}: invalid hedgeLevel (got ${rc.hedgeLevel})`);
    }
    const tractability = rc.tractability == null ? '' : rc.tractability;
    if (tractability !== '' && !TRACTABILITIES.includes(tractability)) {
        throw new Error(`${FN}: invalid tractability (got ${rc.tractability})`);
    }
    const occurred = assertOccurred(occurredAt, occurredPrecision, FN);
    if (supersedesEventId != null && !HEX64_RE.test(String(supersedesEventId))) {
        throw new Error(`${FN}: supersedesEventId must be a 64-hex event id (got ${supersedesEventId})`);
    }
    const provenance = assertSuggestedBy(suggestedBy, FN);

    const dTag = await deriveVerdictDTag(claimCoord, propositionClass);
    const tags = [
        tag('d', dTag),
        tag('a', claimCoord, relayHint, 'proposition-claim'),
        tag('L', ADJUDICATION_NAMESPACE),
        tag('l', verdict, ADJUDICATION_NAMESPACE),
        tag('proposition-class', propositionClass),
        tag('subject-role', subjectRole),
        tag('criteria', criteria)
    ];
    if (horizon) tags.push(tag('horizon', horizon));
    if (horizonIso) tags.push(tag('horizon-iso', horizonIso));
    if (hedge) tags.push(tag('hedge', hedge));
    if (tractability) tags.push(tag('tractability', tractability));
    if (occurred) tags.push(tag('occurred', occurred.at, occurred.precision));
    tags.push(tag('standard', standard));
    tags.push(...evidenceTags('evidence-for', cleanFor));
    tags.push(...evidenceTags('evidence-against', cleanAgainst));
    for (const c of caveatList) tags.push(tag('caveat', c));
    if (method) tags.push(tag('method', String(method).trim()));
    tags.push(...citationTags({ precedents, replyEventIds, exposure }, relayHint, FN));
    if (supersedesEventId) tags.push(tag('e', supersedesEventId, relayHint, 'supersedes'));
    tags.push(...sourceUrlTags(sourceUrl));
    tags.push(tag('suggested-by', provenance));
    tags.push(tag('client', 'xray'));

    const body = String(rationale || '').trim();
    return {
        event: { kind: KIND_ADJUDICATED_VERDICT, created_at: createdAt, tags, content: body },
        body,
        dTag
    };
}

/**
 * Parse a kind-30063 event. Null when structurally unusable: wrong
 * kind, no d, no proposition claim coord, a class outside the
 * firewall, an unknown verdict state or standard, or no caveat.
 */
export function parseAdjudicatedVerdictEvent(event) {
    if (!event || event.kind !== KIND_ADJUDICATED_VERDICT) return null;
    const tags = event.tags || [];
    const first = (name) => { const t = tags.find((x) => x[0] === name); return t || null; };
    const firstVal = (name) => { const t = first(name); return t ? (t[1] || '') : ''; };

    const d = firstVal('d');
    const aTag = tags.find((x) => x[0] === 'a' && x[3] === 'proposition-claim')
        || tags.find((x) => x[0] === 'a' && COORD_30040_RE.test(x[1] || ''));
    const claimCoord = aTag ? aTag[1] : '';
    const lTag = tags.find((x) => x[0] === 'l' && x[2] === ADJUDICATION_NAMESPACE);
    const verdict = lTag ? lTag[1] : '';
    const propositionClass = firstVal('proposition-class');
    const standard = firstVal('standard');
    const caveats = tags.filter((x) => x[0] === 'caveat').map((x) => x[1] || '').filter(Boolean);

    if (!d || !claimCoord || !COORD_30040_RE.test(claimCoord)) return null;
    if (!isValidVerdictState(verdict)) return null;
    if (!isTruthAdjudicable(propositionClass)) return null;   // the firewall, read-side too
    if (!isValidStandardOfProof(standard)) return null;
    if (caveats.length === 0) return null;

    // Read-side evidence adequacy (§5.5 both directions): a foreign
    // established-* ruling with no evidence on its carrying side — or
    // a one-sided contested — is malformed and never admitted, exactly
    // as the builder refuses to produce it.
    const evidenceFor = parseEvidenceTags(tags, 'evidence-for');
    const evidenceAgainst = parseEvidenceTags(tags, 'evidence-against');
    if (verdict === 'established-true' && evidenceFor.length === 0) return null;
    if (verdict === 'established-false' && evidenceAgainst.length === 0) return null;
    if (verdict === 'contested' && (evidenceFor.length === 0 || evidenceAgainst.length === 0)) return null;

    const occurredTag = first('occurred');
    const occurredAt = occurredTag && occurredTag[1] !== '' ? Number(occurredTag[1]) : null;
    const supersedesE = tags.find((x) => x[0] === 'e' && x[3] === 'supersedes');
    const role = firstVal('subject-role');

    return {
        id:                 d,
        claimCoord,
        propositionClass,
        verdict,
        standardOfProof:    standard,
        subjectRole:        isValidSubjectRole(role) ? role : SUBJECT_ROLE_UNCLASSIFIED,
        criteria:           firstVal('criteria'),
        horizon:            firstVal('horizon') || null,
        horizonIso:         firstVal('horizon-iso') || null,
        hedgeLevel:         HEDGE_LEVELS.includes(firstVal('hedge')) ? firstVal('hedge') : null,
        tractability:       TRACTABILITIES.includes(firstVal('tractability')) ? firstVal('tractability') : null,
        occurredAt:         Number.isInteger(occurredAt) ? occurredAt : null,
        occurredPrecision:  occurredTag && isValidOccurredPrecision(occurredTag[2]) ? occurredTag[2] : null,
        evidenceFor,
        evidenceAgainst,
        caveats,
        method:             firstVal('method') || '',
        ...parseCitationTags(tags),
        supersedesEventId:  supersedesE ? supersedesE[1] : null,
        url:                firstVal('r') || null,
        rationale:          event.content || '',
        suggestedBy:        firstVal('suggested-by') || 'user',
        pubkey:             event.pubkey || '',
        created_at:         event.created_at || 0,
        eventId:            event.id || null
    };
}

/**
 * Build an unsigned kind-1985 mirror for a verdict — the NIP-32
 * aggregation path. It labels the CLAIM COORDINATE, never a pubkey:
 * there is deliberately no `p` tag (verdicts attach to propositions,
 * not persons, §5.3), and consumers SHOULD treat the label as a
 * pointer to the richer 30063, whose caveats are required.
 */
export function buildVerdictMirrorEvent({
    claimCoord,
    verdict,
    sourceUrl = '',
    createdAt = nowSeconds()
} = {}) {
    const FN = 'buildVerdictMirrorEvent';
    if (!claimCoord || !COORD_30040_RE.test(claimCoord)) {
        throw new Error(`${FN}: claimCoord must be a 30040 coordinate (got ${claimCoord})`);
    }
    if (!isValidVerdictState(verdict)) {
        throw new Error(`${FN}: invalid verdict (got ${verdict})`);
    }
    const tags = [
        tag('L', ADJUDICATION_NAMESPACE),
        tag('l', verdict, ADJUDICATION_NAMESPACE),
        tag('a', claimCoord)
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
// Kind 30064 — IntegrityFinding
// ------------------------------------------------------------------

function cleanSideRef(input, side, allowedClasses, fn) {
    const rec = input || {};
    const coord = String(rec.coord || '').trim();
    if (!COORD_30040_RE.test(coord)) {
        throw new Error(`${fn}: ${side}.coord must be a 30040 coordinate (got ${rec.coord})`);
    }
    if (!allowedClasses.includes(rec.class)) {
        throw new Error(`${fn}: ${side}.class must be one of ${allowedClasses.join(', ')} (got ${rec.class})`);
    }
    const occurred = assertOccurred(rec.occurredAt, rec.occurredPrecision, fn);
    return { coord, class: rec.class, occurred };
}

/** The wire `d` for an integrity finding: keyed (author, word, deed
 *  set) — recomputable from the event's `word` + `deed` tags (deed
 *  order is not identity). */
export async function deriveIntegrityFindingDTag(word, deeds) {
    const deedKey = deeds.map((d) => `${d.coord}|${d.class}`).sort().join(',');
    return 'integrity:' + (await sha16(`${word.coord}|${word.class}|${deedKey}`));
}

/**
 * Build an unsigned kind-30064 IntegrityFinding: the adjudicated
 * match between a subject's stated word and their enacted deeds.
 * The subject IS `p`-referenced here (unlike 30063) because the
 * word-deed gap is theirs — but the match label never travels
 * without its evidence and caveats: this kind has NO 1985 mirror.
 *
 * @param {object} args
 * @param {string} args.subjectPubkey — 64-hex (required)
 * @param {{coord, class, occurredAt?, occurredPrecision?}} args.word
 *        — class stated-commitment | stated-value
 * @param {Array<{coord, class, occurredAt?, occurredPrecision?}>} args.deeds
 *        — ≥1, class event-fact | state-fact
 * @param {string} args.match — valid for the word class
 * @param {string[]} args.caveats — REQUIRED, ≥1
 * @param {Array}  [args.evidenceFor] / [args.evidenceAgainst]
 * @param {string} [args.standardOfProof] — defaults per word class
 * @param {object} [args.gap] — {cause, note, constraintCoord?, revisionCoord?, evidence?}
 *        broken/contradicted only; documented or rejected
 * @param {string} [args.method] / [args.rationale]
 * @param {string} [args.supersedesEventId]
 * @param {string} [args.sourceUrl] / [args.relayHint]
 * @param {string} [args.suggestedBy='user']
 * @param {number} [args.createdAt]
 * @returns {Promise<{event: object, body: string, dTag: string}>}
 */
export async function buildIntegrityFindingEvent({
    subjectPubkey,
    word,
    deeds,
    match,
    caveats,
    evidenceFor = [],
    evidenceAgainst = [],
    standardOfProof = null,
    gap = null,
    method = '',
    rationale = '',
    precedents = [],
    replyEventIds = [],
    exposure = '',
    supersedesEventId = null,
    sourceUrl = '',
    relayHint = '',
    suggestedBy = 'user',
    createdAt = nowSeconds()
} = {}) {
    const FN = 'buildIntegrityFindingEvent';
    if (!HEX64_RE.test(String(subjectPubkey || ''))) {
        throw new Error(`${FN}: subjectPubkey must be a 64-hex pubkey (a finding publishes against a resolved subject)`);
    }
    const wordRef = cleanSideRef(word, 'word', ['stated-commitment', 'stated-value'], FN);
    if (!Array.isArray(deeds) || deeds.length === 0) {
        throw new Error(`${FN}: deeds must be a nonempty array of enacted action-fact refs`);
    }
    const deedRefs = deeds.map((d, i) => cleanSideRef(d, `deeds[${i}]`, ['event-fact', 'state-fact'], FN));
    if (!isValidMatchForWordClass(match, wordRef.class)) {
        throw new Error(`${FN}: invalid match '${match}' for a ${wordRef.class} — expected one of `
            + `${matchStatesForWordClass(wordRef.class).join(', ')} (of ${INTEGRITY_MATCH_STATES.join(', ')})`);
    }
    const standard = standardOfProof === null || standardOfProof === undefined
        ? defaultStandardOfProof(wordRef.class) : standardOfProof;
    if (!isValidStandardOfProof(standard)) {
        throw new Error(`${FN}: standard_of_proof must be one of ${STANDARDS_OF_PROOF.join(', ')} (got ${standardOfProof})`);
    }
    const cleanFor = cleanWireEvidence(evidenceFor, 'evidenceFor', FN);
    const cleanAgainst = cleanWireEvidence(evidenceAgainst, 'evidenceAgainst', FN);
    const substantive = ['fulfilled', 'broken', 'consistent', 'contradicted'];
    if (substantive.includes(match) && cleanFor.length === 0) {
        throw new Error(`${FN}: a ${match} match needs evidenceFor — the match is a verdict, not a drawn edge`);
    }
    if (match === 'contested' && (cleanFor.length === 0 || cleanAgainst.length === 0)) {
        throw new Error(`${FN}: a contested match means credible evidence BOTH ways`);
    }
    const caveatList = assertCaveats(caveats, FN);

    let gapClean = null;
    if (gap !== null && gap !== undefined) {
        if (!GAP_MATCH_STATES.includes(match)) {
            throw new Error(`${FN}: gap only attaches to a ${GAP_MATCH_STATES.join('/')} match (got ${match})`);
        }
        if (!isValidGapCause(gap.cause)) {
            throw new Error(`${FN}: invalid gap cause (got ${gap.cause}; expected ${GAP_CAUSES.join(', ')})`);
        }
        const note = String(gap.note || '').trim();
        if (!note) {
            throw new Error(`${FN}: a gap cause must be documented — intent is not adjudicated (§3.4)`);
        }
        let constraintCoord = '';
        if (gap.cause === 'constraint') {
            constraintCoord = String(gap.constraintCoord || '').trim();
            if (!COORD_30040_RE.test(constraintCoord)) {
                throw new Error(`${FN}: a constraint cause needs constraintCoord (a corroborated `
                    + `action-fact's 30040 coordinate) — evidence, not an excuse`);
            }
        } else if (gap.constraintCoord) {
            throw new Error(`${FN}: constraintCoord only accompanies a constraint cause`);
        }
        const revisionCoord = gap.revisionCoord ? String(gap.revisionCoord).trim() : '';
        if (revisionCoord && !COORD_30055_RE.test(revisionCoord)) {
            throw new Error(`${FN}: revisionCoord must be a 30055 coordinate (got ${gap.revisionCoord})`);
        }
        gapClean = {
            cause: gap.cause,
            note,
            evidence: cleanWireEvidence(gap.evidence, 'gap.evidence', FN),
            constraintCoord,
            revisionCoord
        };
    }
    if (supersedesEventId != null && !HEX64_RE.test(String(supersedesEventId))) {
        throw new Error(`${FN}: supersedesEventId must be a 64-hex event id (got ${supersedesEventId})`);
    }
    const provenance = assertSuggestedBy(suggestedBy, FN);

    const dTag = await deriveIntegrityFindingDTag(wordRef, deedRefs);
    const tags = [
        tag('d', dTag),
        tag('p', subjectPubkey, '', 'subject'),
        tag('L', ADJUDICATION_NAMESPACE),
        tag('l', match, ADJUDICATION_NAMESPACE),
        tag('word', wordRef.coord, wordRef.class,
            wordRef.occurred ? wordRef.occurred.at : '',
            wordRef.occurred ? wordRef.occurred.precision : ''),
        tag('a', wordRef.coord, relayHint, 'word')
    ];
    for (const deed of deedRefs) {
        tags.push(tag('deed', deed.coord, deed.class,
            deed.occurred ? deed.occurred.at : '',
            deed.occurred ? deed.occurred.precision : ''));
        tags.push(tag('a', deed.coord, relayHint, 'deed'));
    }
    tags.push(tag('standard', standard));
    tags.push(...evidenceTags('evidence-for', cleanFor));
    tags.push(...evidenceTags('evidence-against', cleanAgainst));
    for (const c of caveatList) tags.push(tag('caveat', c));
    if (gapClean) {
        tags.push(tag('gap-cause', gapClean.cause, gapClean.note));
        tags.push(...evidenceTags('gap-evidence', gapClean.evidence));
        if (gapClean.constraintCoord) tags.push(tag('a', gapClean.constraintCoord, relayHint, 'constraint'));
        if (gapClean.revisionCoord) tags.push(tag('a', gapClean.revisionCoord, relayHint, 'revision'));
    }
    if (method) tags.push(tag('method', String(method).trim()));
    tags.push(...citationTags({ precedents, replyEventIds, exposure }, relayHint, FN));
    if (supersedesEventId) tags.push(tag('e', supersedesEventId, relayHint, 'supersedes'));
    tags.push(...sourceUrlTags(sourceUrl));
    tags.push(tag('suggested-by', provenance));
    tags.push(tag('client', 'xray'));

    const body = String(rationale || '').trim();
    return {
        event: { kind: KIND_INTEGRITY_FINDING, created_at: createdAt, tags, content: body },
        body,
        dTag
    };
}

/**
 * Parse a kind-30064 event. Null when structurally unusable: wrong
 * kind, no d/subject/word/deed, a match invalid for the word class,
 * an unknown standard, or no caveat.
 */
export function parseIntegrityFindingEvent(event) {
    if (!event || event.kind !== KIND_INTEGRITY_FINDING) return null;
    const tags = event.tags || [];
    const firstVal = (name) => { const t = tags.find((x) => x[0] === name); return t ? (t[1] || '') : ''; };

    const d = firstVal('d');
    const subjectP = tags.find((x) => x[0] === 'p' && x[3] === 'subject')
        || tags.find((x) => x[0] === 'p');
    const lTag = tags.find((x) => x[0] === 'l' && x[2] === ADJUDICATION_NAMESPACE);
    const match = lTag ? lTag[1] : '';
    const wordTag = tags.find((x) => x[0] === 'word');
    const deedTags = tags.filter((x) => x[0] === 'deed');
    const standard = firstVal('standard');
    const caveats = tags.filter((x) => x[0] === 'caveat').map((x) => x[1] || '').filter(Boolean);

    const parseSide = (t) => ({
        coord:             t[1] || '',
        class:             t[2] || '',
        occurredAt:        t[3] !== undefined && t[3] !== '' && Number.isInteger(Number(t[3])) ? Number(t[3]) : null,
        occurredPrecision: isValidOccurredPrecision(t[4]) ? t[4] : null
    });
    const word = wordTag ? parseSide(wordTag) : null;
    const deeds = deedTags.map(parseSide);

    if (!d || !subjectP || !subjectP[1]) return null;
    if (!word || !COORD_30040_RE.test(word.coord) || deeds.length === 0) return null;
    if (deeds.some((x) => !COORD_30040_RE.test(x.coord))) return null;
    if (!isValidMatchForWordClass(match, word.class)) return null;
    if (!isValidStandardOfProof(standard)) return null;
    if (caveats.length === 0) return null;

    // Read-side match-evidence adequacy, mirroring the builder.
    const evidenceFor = parseEvidenceTags(tags, 'evidence-for');
    const evidenceAgainst = parseEvidenceTags(tags, 'evidence-against');
    const substantive = ['fulfilled', 'broken', 'consistent', 'contradicted'];
    if (substantive.includes(match) && evidenceFor.length === 0) return null;
    if (match === 'contested' && (evidenceFor.length === 0 || evidenceAgainst.length === 0)) return null;

    const gapTag = tags.find((x) => x[0] === 'gap-cause');
    const constraintA = tags.find((x) => x[0] === 'a' && x[3] === 'constraint');
    const revisionA = tags.find((x) => x[0] === 'a' && x[3] === 'revision');
    const supersedesE = tags.find((x) => x[0] === 'e' && x[3] === 'supersedes');

    return {
        id:                d,
        subjectPubkey:     subjectP[1],
        word,
        deeds,
        match,
        standardOfProof:   standard,
        evidenceFor,
        evidenceAgainst,
        ...parseCitationTags(tags),
        caveats,
        gap: gapTag && isValidGapCause(gapTag[1]) ? {
            cause:           gapTag[1],
            note:            gapTag[2] || '',
            evidence:        parseEvidenceTags(tags, 'gap-evidence'),
            constraintCoord: (constraintA && constraintA[1]) || '',
            revisionCoord:   (revisionA && revisionA[1]) || ''
        } : null,
        method:            firstVal('method') || '',
        supersedesEventId: supersedesE ? supersedesE[1] : null,
        url:               firstVal('r') || null,
        rationale:         event.content || '',
        suggestedBy:       firstVal('suggested-by') || 'user',
        pubkey:            event.pubkey || '',
        created_at:        event.created_at || 0,
        eventId:           event.id || null
    };
}

// X-Ray — audit wire builders + parsers, kinds 30056/30057 (Phase 13,
// slice 13.2).
//
// The Phase-11 builder contract, exactly: each builder returns
// `{event, body, dTag}` with an unsigned NIP-01 event, deterministic
// `d` recomputable by hand from the event's own public tags, and
// throw-on-invalid inputs with greppable messages. Parsers are pure
// and return null on structurally unusable events.
//
// Wire shapes: docs/EPISTEMIC_AUDIT_DESIGN.md §"Wire shapes". The
// audit/assessment FIREWALL is enforced here in code: audit events
// never carry `stance`, `rating-value`, or `L`/`l` assessment-label
// tags — and the builders only emit the vocabulary below, so the
// firewall holds by construction.
//
// `d`-scheme constraint (RQ5, draft-NIP normative): audit-bearing
// kinds carry methodology version and/or run identity in `d` — at the
// same `d`, relays keep only the latest event per (pubkey, kind, d),
// so a reused `d` would silently drop the prior audit. Supersession is
// expressed exclusively through explicit `e` references, never relay
// replacement.

import { normalize } from '../metadata/url-normalizer.js';
import { MODULE_NAMES, validateFindings } from './findings-schemas.js';
import { normalizeBeat } from './beats.js';

const KIND_MODULE_RESULT = 30056;
const KIND_AGGREGATE_AUDIT = 30057;

export const AUDITOR_KINDS = Object.freeze(['model', 'human', 'pipeline', 'consensus']);

// ceiling-source closed grammar (RQ2; NIP-normative): the versioned
// deterministic heuristic (the pipeline default), the auditing model's
// judgment (calibration runs), a dedicated knowability module's result
// coordinate, or a human.
const CEILING_SOURCE_HEURISTIC_RE = /^heuristic:[a-z0-9-]+\/\d+\.\d+(\.\d+)?$/;

export function isValidCeilingSource(value) {
    if (typeof value !== 'string') return false;
    if (value === 'model' || value === 'human') return true;
    if (CEILING_SOURCE_HEURISTIC_RE.test(value)) return true;
    if (value.startsWith('module:') && COORD_RE.test(value.slice('module:'.length))) return true;
    return false;
}

function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

async function sha256Hex(s) {
    const bytes = new TextEncoder().encode(s);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha16(s) {
    return (await sha256Hex(s)).slice(0, 16);
}

function tag(name, ...values) {
    return [name, ...values.map((v) => (v === null || v === undefined ? '' : String(v)))];
}

const HASH64_RE = /^[0-9a-f]{64}$/;
const COORD_RE = /^\d+:[0-9a-f]{64}:.+$/;

function assertArticleHash(value, fn) {
    if (typeof value !== 'string' || !HASH64_RE.test(value)) {
        throw new Error(`${fn}: articleHash must be 64 lowercase hex (got ${value})`);
    }
}

function assertAuditor(auditor, fn) {
    if (!auditor || !AUDITOR_KINDS.includes(auditor.kind) || typeof auditor.id !== 'string' || !auditor.id) {
        throw new Error(`${fn}: auditor must be {kind: ${AUDITOR_KINDS.join('|')}, id} (got ${JSON.stringify(auditor)})`);
    }
    if (auditor.kind === 'human' && !HASH64_RE.test(auditor.id)) {
        throw new Error(`${fn}: a human auditor id must be a 64-hex pubkey (got ${auditor.id})`);
    }
}

// Strict ISO-8601 — Date.parse alone is uselessly lenient (V8 accepts
// "2026", "March 7, 2026", even pipe-bearing strings via the legacy
// parenthesized-comment rule), and runAt both rides the wire verbatim
// and feeds the `|`-delimited d preimage.
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// Exported predicate so the IMPORT gate enforces the same grammar the
// builders do — Date.parse alone admits timestamps that import
// cleanly and then refuse to build forever (run_at feeds the
// |-delimited d preimage, so strictness here is an address property).
export function isStrictRunAt(runAt) {
    return typeof runAt === 'string' && ISO8601_RE.test(runAt) && !Number.isNaN(Date.parse(runAt));
}

function assertRunAt(runAt, fn) {
    if (typeof runAt !== 'string' || !ISO8601_RE.test(runAt) || Number.isNaN(Date.parse(runAt))) {
        throw new Error(`${fn}: runAt must be an ISO-8601 timestamp string (got ${runAt})`);
    }
}

// Beats become indexed t tags; on 30056 the module name is ALSO a t
// tag, so an unvalidated beat that collides with a module name would
// pollute the relay-side module filter and make the d-recompute
// ambiguous. Beats are free-form per RQ8 (they never mint dossier
// subjects), but they must be nonempty strings, deduplicated, and
// never module names.
function cleanBeats(beats, fn) {
    if (!Array.isArray(beats)) {
        throw new Error(`${fn}: beats must be an array of tag strings`);
    }
    const out = [];
    for (const b of beats) {
        if (typeof b !== 'string' || !b.trim()) {
            throw new Error(`${fn}: beats entries must be nonempty strings (got ${JSON.stringify(b)})`);
        }
        const beat = b.trim();
        if (MODULE_NAMES.includes(beat)) {
            throw new Error(`${fn}: beat "${beat}" collides with a module name — module names are reserved t values on audit kinds`);
        }
        if (!out.includes(beat)) out.push(beat);
    }
    return out;
}

function assertRange(value, lo, hi, name, fn) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < lo || value > hi) {
        throw new Error(`${fn}: ${name} must be a number in [${lo}, ${hi}] (got ${value})`);
    }
}

/**
 * Auditor identity tag block, shared by every audit kind: the
 * `auditor` tag (kind + id), repeatable `auditor-constituent`s for
 * pipeline/consensus, an optional `auditor-manifest` (SHA-256 of the
 * orchestration config), and — for human auditors — an indexed
 * `["p", <pubkey>, "", "auditor"]`. The signing pubkey remains the
 * accountability anchor; these tags record what PRODUCED the result
 * (producer ≠ publisher, RQ1).
 */
function auditorTags({ auditor, constituents = [], manifestHash = null }, fn) {
    assertAuditor(auditor, fn);
    const tags = [tag('auditor', auditor.kind, auditor.id)];
    for (const c of constituents) {
        assertAuditor(c, `${fn} (constituent)`);
        tags.push(tag('auditor-constituent', c.kind, c.id));
    }
    if (manifestHash !== null && manifestHash !== undefined) {
        tags.push(tag('auditor-manifest', manifestHash));
    }
    if (auditor.kind === 'human') {
        tags.push(tag('p', auditor.id, '', 'auditor'));
    }
    return tags;
}

/** Article-anchor tag block: x + optional a/r/i/k (the Phase-11 URL rule). */
function articleTags({ articleHash, articleCoord = null, relayHint = '', articleUrl = '' }, fn) {
    const tags = [tag('x', articleHash)];
    if (articleCoord) {
        if (!COORD_RE.test(articleCoord) || !articleCoord.startsWith('30023:')) {
            throw new Error(`${fn}: articleCoord must be a 30023:pubkey:d coordinate (got ${articleCoord})`);
        }
        tags.push(tag('a', articleCoord, relayHint));
    }
    if (articleUrl) {
        tags.push(tag('r', articleUrl));            // verbatim — the #r join key
        tags.push(tag('i', normalize(articleUrl))); // NIP-73, normalization-stable
        tags.push(tag('k', 'web'));
    }
    return tags;
}

/**
 * The vendored scorer's evidence-quote walker (collectEvidenceQuotes),
 * verbatim semantics: walk the findings for every evidence_quote /
 * evidence_quote_a / evidence_quote_b string, deduplicated, for the
 * cross-module reference index that rides the content JSON.
 */
export function collectEvidenceQuotes(findings) {
    const quotes = new Set();
    function walkNode(node) {
        if (node === null || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            node.forEach(walkNode);
            return;
        }
        for (const [k, v] of Object.entries(node)) {
            if ((k === 'evidence_quote' || k === 'evidence_quote_a' || k === 'evidence_quote_b') && typeof v === 'string') {
                if (v) quotes.add(v);
            } else {
                walkNode(v);
            }
        }
    }
    walkNode(findings);
    return [...quotes].map((quote) => ({ quote }));
}

/** `d` for a 30056: mod:<sha16(articleHash|module|moduleVersion|runAt)>. */
export async function deriveModuleResultDTag(articleHash, module, moduleVersion, runAt) {
    return 'mod:' + (await sha16(`${articleHash}|${module}|${moduleVersion}|${runAt}`));
}

/** `d` for a 30057: agg:<sha16(articleHash|auditorId|runAt)>. */
export async function deriveAggregateAuditDTag(articleHash, auditorId, runAt) {
    return 'agg:' + (await sha16(`${articleHash}|${auditorId}|${runAt}`));
}

/**
 * Build a kind-30056 ModuleResult event. One per (article, module,
 * methodology version, run).
 *
 * The findings payload is VALIDATED against the module's derived
 * schema before anything is built — you never sign what you haven't
 * verified (RQ1). `score`/`confidence`/`version` are read from the
 * validated findings (single source; the tags mirror them), so a
 * prediction_extraction event structurally cannot carry score tags.
 *
 * @returns {Promise<{event: object, body: string, dTag: string}>}
 */
export async function buildModuleResultEvent({
    articleHash,
    module,
    runAt,
    findings,
    evidenceQuotes = null,
    articleCoord = null,
    relayHint = '',
    articleUrl = '',
    beats = [],
    auditor,
    constituents = [],
    manifestHash = null,
    modelParams = null,
    createdAt = nowSeconds()
} = {}) {
    const FN = 'buildModuleResultEvent';
    assertArticleHash(articleHash, FN);
    if (!MODULE_NAMES.includes(module)) {
        throw new Error(`${FN}: module must be one of ${MODULE_NAMES.join(', ')} (got ${module})`);
    }
    assertRunAt(runAt, FN);

    const { valid, errors } = validateFindings(module, findings);
    if (!valid) {
        throw new Error(`${FN}: findings failed schema validation — ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
    }

    const moduleVersion = findings.version;
    const dTag = await deriveModuleResultDTag(articleHash, module, moduleVersion, runAt);

    const tags = [tag('d', dTag)];
    tags.push(...articleTags({ articleHash, articleCoord, relayHint, articleUrl }, FN));
    tags.push(tag('t', module));                       // the module name — indexed
    for (const b of cleanBeats(beats, FN)) tags.push(tag('t', b));   // article beat mirrors (RQ8)
    tags.push(tag('module-version', moduleVersion));
    tags.push(tag('run-at', runAt));
    if (typeof findings.score === 'number') tags.push(tag('score', findings.score));
    if (typeof findings.confidence === 'number') tags.push(tag('confidence', findings.confidence));
    if (modelParams) tags.push(tag('model-params', modelParams));   // LLM-variance posture
    tags.push(...auditorTags({ auditor, constituents, manifestHash }, FN));
    tags.push(tag('client', 'xray'));

    const quotes = evidenceQuotes === null ? collectEvidenceQuotes(findings) : evidenceQuotes;
    const body = JSON.stringify({ ...findings, evidence_quotes: quotes });

    return {
        event: { kind: KIND_MODULE_RESULT, created_at: createdAt, tags, content: body },
        body,
        dTag
    };
}

/**
 * Build a kind-30057 AggregateAudit event. One per (auditor, article,
 * run) — the badge-surface record.
 *
 * Module references are `a` coordinates first (durable under
 * idempotent republish), with `e` ids as optional convenience.
 * Supersession and dispute resolution are FORWARD `e`-tag roles on
 * this new event — the superseded audit is never edited (P9).
 * `ceiling-binding` is present only when the ceiling binds.
 *
 * @returns {Promise<{event: object, body: string, dTag: string}>}
 */
export async function buildAggregateAuditEvent({
    articleHash,
    runAt,
    finalScore,
    rawScore,
    ceiling,
    ceilingSource,
    confidence,
    knowabilityNotes = '',
    modelEstimatedCeiling = null,
    moduleContributions = [],
    topStrengths = [],
    topConcerns = [],
    articleCoord = null,
    relayHint = '',
    articleUrl = '',
    beats = [],
    supersedesEventId = null,
    resolvesDisputeEventId = null,
    auditor,
    constituents = [],
    manifestHash = null,
    createdAt = nowSeconds()
} = {}) {
    const FN = 'buildAggregateAuditEvent';
    assertArticleHash(articleHash, FN);
    assertRunAt(runAt, FN);
    assertAuditor(auditor, FN);
    assertRange(finalScore, 0, 100, 'finalScore', FN);
    assertRange(rawScore, 0, 100, 'rawScore', FN);
    assertRange(ceiling, 0, 100, 'ceiling', FN);
    assertRange(confidence, 0, 1, 'confidence', FN);
    if (!isValidCeilingSource(ceilingSource)) {
        throw new Error(`${FN}: ceilingSource must be "heuristic:<name>/<version>", "model", "module:<coordinate>", or "human" — the wire never publishes a ceiling without valid provenance (RQ2; got ${ceilingSource})`);
    }
    // The NIP's ceiling semantics: score = min(raw, ceiling). Tolerate
    // float dust but never an internally contradictory event.
    if (finalScore > ceiling + 1e-9 || finalScore > rawScore + 1e-9) {
        throw new Error(`${FN}: finalScore must not exceed min(rawScore, ceiling) — score = min(raw, ceiling) is the wire semantics (got final=${finalScore}, raw=${rawScore}, ceiling=${ceiling})`);
    }
    if (modelEstimatedCeiling !== null) {
        assertRange(modelEstimatedCeiling, 0, 100, 'modelEstimatedCeiling', FN);
    }
    for (const c of moduleContributions) {
        if (!MODULE_NAMES.includes(c.module)) {
            throw new Error(`${FN}: contribution module must be one of ${MODULE_NAMES.join(', ')} (got ${c.module})`);
        }
        if (!c.coord || !COORD_RE.test(c.coord) || !c.coord.startsWith(`${KIND_MODULE_RESULT}:`)) {
            throw new Error(`${FN}: contribution coord must be a 30056 coordinate (got ${c.coord})`);
        }
        // null is the sanctioned unscored/failed-module marker; undefined
        // is a caller bug and throws via assertRange's typeof check.
        if (c.score !== null) assertRange(c.score, 0, 100, `contribution score (${c.module})`, FN);
        assertRange(c.confidence, 0, 1, `contribution confidence (${c.module})`, FN);
        assertRange(c.weight, 0, 1, `contribution weight (${c.module})`, FN);
    }

    const dTag = await deriveAggregateAuditDTag(articleHash, auditor.id, runAt);
    const ceilingBinding = rawScore > ceiling;

    const tags = [tag('d', dTag)];
    tags.push(...articleTags({ articleHash, articleCoord, relayHint, articleUrl }, FN));
    for (const b of cleanBeats(beats, FN)) tags.push(tag('t', b));
    tags.push(tag('run-at', runAt));
    tags.push(tag('score', finalScore));               // final, post-ceiling
    tags.push(tag('raw-score', rawScore));
    tags.push(tag('ceiling', ceiling));
    if (ceilingBinding) tags.push(tag('ceiling-binding', 'true'));
    tags.push(tag('ceiling-source', ceilingSource));
    tags.push(tag('confidence', confidence));
    for (const c of moduleContributions) {
        tags.push(tag('a', c.coord, relayHint, c.module));            // durable refs
    }
    for (const c of moduleContributions) {
        if (c.eventId) tags.push(tag('e', c.eventId, relayHint, c.module));   // optional convenience
    }
    if (supersedesEventId) tags.push(tag('e', supersedesEventId, '', 'supersedes'));
    if (resolvesDisputeEventId) tags.push(tag('e', resolvesDisputeEventId, '', 'resolves-dispute'));
    tags.push(...auditorTags({ auditor, constituents, manifestHash }, FN));
    tags.push(tag('client', 'xray'));

    const body = JSON.stringify({
        module_contributions: moduleContributions.map((c) => ({
            module: c.module,
            score: c.score,
            confidence: c.confidence,
            weight: c.weight,
            ref: c.coord
        })),
        knowability_notes: knowabilityNotes,
        model_estimated_ceiling: modelEstimatedCeiling,   // advisory (RQ2); never binds
        top_strengths: topStrengths,
        top_concerns: topConcerns
    });

    return {
        event: { kind: KIND_AGGREGATE_AUDIT, created_at: createdAt, tags, content: body },
        body,
        dTag
    };
}

// --- parsers -------------------------------------------------------------------

function firstTag(tags, name) {
    const t = tags.find((x) => x[0] === name);
    return t ? t[1] : '';
}

function parseAuditorBlock(tags) {
    const a = tags.find((x) => x[0] === 'auditor');
    if (!a || !AUDITOR_KINDS.includes(a[1]) || !a[2]) return null;
    return {
        auditor: { kind: a[1], id: a[2] },
        constituents: tags.filter((x) => x[0] === 'auditor-constituent' && x[1] && x[2])
            .map((x) => ({ kind: x[1], id: x[2] })),
        manifestHash: firstTag(tags, 'auditor-manifest') || null
    };
}

function numberOrNull(raw) {
    if (raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

// Range-checked variant for the PARSERS — the builders and the import
// gate bound every number at their doors, which left the relay parser
// as the one unguarded entrance: a hostile event carrying score
// "99999" or confidence "-3" would otherwise render as authoritative
// and feed the dossier math. Out of range = the value was never
// asserted (null), and the display rules treat null as unknown.
function boundedOrNull(raw, lo, hi) {
    const n = numberOrNull(raw);
    return n !== null && n >= lo && n <= hi ? n : null;
}

// Contribution rows ride in content (unsigned-shaped JSON) — keep
// only rows the wire grammar could have produced.
function cleanContributions(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.filter((c) => c && typeof c.module === 'string'
        && (c.score === null || (typeof c.score === 'number' && Number.isFinite(c.score) && c.score >= 0 && c.score <= 100))
        && (c.confidence === undefined || (typeof c.confidence === 'number' && c.confidence >= 0 && c.confidence <= 1))
        && (c.weight === undefined || (typeof c.weight === 'number' && c.weight >= 0 && c.weight <= 1)));
}

/**
 * Parse a kind-30056 event. Pure; returns null when structurally
 * unusable (wrong kind, missing d/x/module/version/run-at or auditor,
 * unparseable content). Soft-degrades everything else.
 */
export function parseModuleResultEvent(event) {
    if (!event || event.kind !== KIND_MODULE_RESULT) return null;
    const tags = event.tags || [];
    const id = firstTag(tags, 'd');
    const articleHash = firstTag(tags, 'x');
    const moduleVersion = firstTag(tags, 'module-version');
    const runAt = firstTag(tags, 'run-at');
    const auditorBlock = parseAuditorBlock(tags);
    if (!id || !articleHash || !moduleVersion || !runAt || !auditorBlock) return null;

    let findings;
    try { findings = JSON.parse(event.content); } catch (_) { return null; }
    if (!findings || typeof findings !== 'object' || Array.isArray(findings)) return null;

    // Module identity: the content envelope's const-checked
    // `findings.module` is authoritative (t-tag ORDER is not specified
    // by NIP-01, so first-t-match would mis-bucket third-party events
    // whose beat tags precede the module tag). The t tag must agree
    // when it identifies a module — a mis-tagged event is structurally
    // untrustworthy, not soft-degradable.
    const contentModule = typeof findings.module === 'string' && MODULE_NAMES.includes(findings.module)
        ? findings.module : '';
    const tValues = tags.filter((x) => x[0] === 't').map((x) => x[1]);
    const tModule = tValues.find((v) => MODULE_NAMES.includes(v)) || '';
    const module = contentModule || tModule;
    if (!module) return null;
    if (contentModule && tModule && contentModule !== tModule) return null;

    const articleA = tags.find((x) => x[0] === 'a' && String(x[1]).startsWith('30023:'));
    return {
        id,
        articleHash,
        module,
        moduleVersion,
        runAt,
        score: boundedOrNull(firstTag(tags, 'score'), 0, 100),
        confidence: boundedOrNull(firstTag(tags, 'confidence'), 0, 1),
        modelParams: firstTag(tags, 'model-params') || null,
        ...auditorBlock,
        articleCoord: (articleA && articleA[1]) || null,
        url: firstTag(tags, 'r') || null,
        beats: tValues.filter((v) => v !== module),
        findings,
        evidenceQuotes: Array.isArray(findings.evidence_quotes) ? findings.evidence_quotes : [],
        pubkey: event.pubkey || '',
        created_at: event.created_at || 0,
        eventId: event.id || null
    };
}

/**
 * Parse a kind-30057 event. Pure; null when structurally unusable.
 * `superseded`/`disputed` lineage is derived by consumers from OTHER
 * events' forward references — an addressable event cannot carry
 * backpointers written after signing.
 */
export function parseAggregateAuditEvent(event) {
    if (!event || event.kind !== KIND_AGGREGATE_AUDIT) return null;
    const tags = event.tags || [];
    const id = firstTag(tags, 'd');
    const articleHash = firstTag(tags, 'x');
    const runAt = firstTag(tags, 'run-at');
    const score = boundedOrNull(firstTag(tags, 'score'), 0, 100);
    const ceiling = boundedOrNull(firstTag(tags, 'ceiling'), 0, 100);
    const ceilingSource = firstTag(tags, 'ceiling-source');
    const auditorBlock = parseAuditorBlock(tags);
    if (!id || !articleHash || !runAt || score === null || ceiling === null || !ceilingSource || !auditorBlock) {
        return null;
    }

    let content = {};
    try { content = JSON.parse(event.content) || {}; } catch (_) { /* tags carry the score story */ }

    const moduleRefs = tags
        .filter((x) => x[0] === 'a' && String(x[1]).startsWith(`${KIND_MODULE_RESULT}:`))
        .map((x) => ({ coord: x[1], module: x[3] || null }));
    const articleA = tags.find((x) => x[0] === 'a' && String(x[1]).startsWith('30023:'));
    const eRole = (role) => {
        const t = tags.find((x) => x[0] === 'e' && x[3] === role);
        return (t && t[1]) || null;
    };

    return {
        id,
        articleHash,
        runAt,
        finalScore: score,
        rawScore: boundedOrNull(firstTag(tags, 'raw-score'), 0, 100),
        ceiling,
        ceilingBinding: firstTag(tags, 'ceiling-binding') === 'true',
        ceilingSource,
        confidence: boundedOrNull(firstTag(tags, 'confidence'), 0, 1),
        ...auditorBlock,
        articleCoord: (articleA && articleA[1]) || null,
        url: firstTag(tags, 'r') || null,
        beats: tags.filter((x) => x[0] === 't').map((x) => x[1]),
        moduleRefs,
        supersedesEventId: eRole('supersedes'),
        resolvesDisputeEventId: eRole('resolves-dispute'),
        moduleContributions: cleanContributions(content.module_contributions),
        knowabilityNotes: content.knowability_notes || '',
        modelEstimatedCeiling: (typeof content.model_estimated_ceiling === 'number'
            && content.model_estimated_ceiling >= 0 && content.model_estimated_ceiling <= 100)
            ? content.model_estimated_ceiling : null,
        topStrengths: Array.isArray(content.top_strengths) ? content.top_strengths : [],
        topConcerns: Array.isArray(content.top_concerns) ? content.top_concerns : [],
        pubkey: event.pubkey || '',
        created_at: event.created_at || 0,
        eventId: event.id || null
    };
}

// =============================================================================
// Ledger + governance kinds: 30058 PredictionEntry, 30059
// PredictionResolution, 30060 DossierSnapshot, 30061 AuditDispute
// (Phase 13, slice 13.3). 30061 is WIRE-FORMAT-ONLY in v1 — the kind
// is defined and buildable, no filing UI or adjudication runtime
// exists (explicit non-goal).
// =============================================================================

const KIND_PREDICTION_ENTRY = 30058;
const KIND_PREDICTION_RESOLUTION = 30059;
const KIND_DOSSIER_SNAPSHOT = 30060;
const KIND_AUDIT_DISPUTE = 30061;

export const PREDICTION_TYPES = Object.freeze(['explicit', 'implicit', 'conditional', 'negative', 'counterfactual']);
export const HEDGE_LEVELS = Object.freeze(['confident', 'hedged', 'speculative']);
export const ATTRIBUTION_KINDS = Object.freeze(['article_voice', 'named_source', 'vague_attribution']);
export const TRACTABILITIES = Object.freeze(['publicly_resolvable', 'requires_private_info', 'ambiguous']);
export const RESOLUTION_OUTCOMES_WIRE = Object.freeze(['true', 'false', 'partial', 'unresolvable']);
export const EVIDENCE_KINDS = Object.freeze(['url', 'nostr_event', 'document_hash', 'quote']);
export const DOSSIER_SUBJECT_KINDS = Object.freeze(['author', 'publication', 'beat', 'publication_x_beat']);
export const DISPUTE_TARGET_KINDS = Object.freeze(['module_result', 'aggregate_audit', 'prediction_resolution', 'claim']);
export const DISPUTE_STATUSES = Object.freeze(['open', 'withdrawn']);   // filer-asserted only

function assertEnum(value, allowed, name, fn) {
    if (!allowed.includes(value)) {
        throw new Error(`${fn}: ${name} must be one of ${allowed.join(', ')} (got ${value})`);
    }
}

// The claim-id discipline, exactly (claim-model.js / audit-model.js):
// trim, collapse whitespace runs to single spaces, lowercase — so
// re-extraction of the same restated text converges on one record.
function normalizePredictionTextWire(text) {
    return String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Typed evidence tags (30059/30061): each entry
 * {kind, value, description} becomes ["evidence", kind, value,
 * description] — a flagged extension of the dormant 30051 builder's
 * bare-string idiom, which could not express document_hash or quote
 * evidence. nostr_event evidence additionally gets a plain `a` or `e`
 * tag for relay indexing.
 */
function evidenceTags(evidence, fn) {
    if (!Array.isArray(evidence)) {
        throw new Error(`${fn}: evidence must be an array of {kind, value, description}`);
    }
    const tags = [];
    for (const ev of evidence) {
        if (!ev || typeof ev.value !== 'string' || !ev.value) {
            throw new Error(`${fn}: evidence entries need a nonempty string value (got ${JSON.stringify(ev)})`);
        }
        assertEnum(ev.kind, EVIDENCE_KINDS, 'evidence kind', fn);
        if (ev.kind === 'nostr_event') {
            // Value grammar enforced: a raw kind:pubkey:d coordinate or
            // a 64-hex event id — never bech32 — so the SHOULD-level
            // indexing companion tag below is always emittable.
            if (!COORD_RE.test(ev.value) && !HASH64_RE.test(ev.value)) {
                throw new Error(`${fn}: nostr_event evidence value must be a raw coordinate or 64-hex event id (got ${ev.value})`);
            }
        }
        tags.push(tag('evidence', ev.kind, ev.value, ev.description || ''));
        if (ev.kind === 'nostr_event') {
            if (COORD_RE.test(ev.value)) tags.push(tag('a', ev.value));
            else tags.push(tag('e', ev.value));
        }
    }
    return tags;
}

// Evidence-derived a/e tags are indistinguishable from reference tags
// by name alone — parsers exclude any value that appears in an
// evidence tag before falling back to positional matching.
function evidenceValues(tags) {
    return new Set(tags.filter((x) => x[0] === 'evidence' && x[1] === 'nostr_event').map((x) => x[2]));
}

function parseEvidenceTags(tags) {
    return tags.filter((x) => x[0] === 'evidence' && EVIDENCE_KINDS.includes(x[1]) && x[2])
        .map((x) => ({ kind: x[1], value: x[2], description: x[3] || '' }));
}

/** `d` for a 30058: pred:<sha16(articleHash|norm(predictionText))>. */
export async function derivePredictionEntryDTag(articleHash, predictionText) {
    return 'pred:' + (await sha16(`${articleHash}|${normalizePredictionTextWire(predictionText)}`));
}

/** `d` for a 30059: res:<sha16(predictionCoord verbatim)>. */
export async function derivePredictionResolutionDTag(predictionCoord) {
    return 'res:' + (await sha16(String(predictionCoord || '').trim()));
}

/** `d` for a 30060: dossier:<sha16(subjectKind|subjectId)>. */
export async function deriveDossierSnapshotDTag(subjectKind, subjectId) {
    return 'dossier:' + (await sha16(`${subjectKind}|${subjectId}`));
}

/** `d` for a 30061: dispute:<sha16(targetCoord verbatim)>. */
export async function deriveAuditDisputeDTag(targetCoord) {
    return 'dispute:' + (await sha16(String(targetCoord || '').trim()));
}

/**
 * Build a kind-30058 PredictionEntry. The ledger's write side: the
 * stable text-hash `d` makes re-extraction CONVERGE (same article
 * hash + same restated text → one record), so resolutions never
 * retarget. The content carries the prediction text and NOTHING else,
 * precisely so the `d` is mechanically recomputable from the event.
 *
 * `resolution_status`/`latest_resolution_id` are NOT wire fields —
 * they derive client-side from 30059s (the local model owns them).
 *
 * @returns {Promise<{event: object, body: string, dTag: string}>}
 */
export async function buildPredictionEntryEvent({
    articleHash,
    predictionText,
    predictionType,
    hedgeLevel,
    attribution,
    attributedName = null,
    condition = null,
    horizon,
    horizonIso = null,
    criteria,
    tractability,
    evidenceQuote,
    anchor = null,
    moduleVersion,
    claimCoord = null,
    authorEntityPubkey = null,
    articleCoord = null,
    relayHint = '',
    articleUrl = '',
    auditor,
    constituents = [],
    manifestHash = null,
    createdAt = nowSeconds()
} = {}) {
    const FN = 'buildPredictionEntryEvent';
    assertArticleHash(articleHash, FN);
    if (typeof predictionText !== 'string' || !predictionText.trim()) {
        throw new Error(`${FN}: predictionText required — the prediction is the record`);
    }
    assertEnum(predictionType, PREDICTION_TYPES, 'predictionType', FN);
    assertEnum(hedgeLevel, HEDGE_LEVELS, 'hedgeLevel', FN);
    assertEnum(attribution, ATTRIBUTION_KINDS, 'attribution', FN);
    assertEnum(tractability, TRACTABILITIES, 'tractability', FN);
    if (typeof horizon !== 'string' || !horizon) {
        throw new Error(`${FN}: horizon required (descriptive or ISO date)`);
    }
    if (typeof criteria !== 'string' || !criteria) {
        throw new Error(`${FN}: criteria required — an unresolvable-by-construction prediction is not a ledger entry`);
    }
    if (typeof evidenceQuote !== 'string' || !evidenceQuote) {
        throw new Error(`${FN}: evidenceQuote required — evidence-bound, no exceptions`);
    }
    if (predictionType === 'conditional' && (typeof condition !== 'string' || !condition)) {
        throw new Error(`${FN}: conditional predictions require the condition (the antecedent)`);
    }
    if (typeof moduleVersion !== 'string' || !moduleVersion) {
        throw new Error(`${FN}: moduleVersion required (prediction_extraction's version)`);
    }
    if (claimCoord && (!COORD_RE.test(claimCoord) || !claimCoord.startsWith('30040:'))) {
        throw new Error(`${FN}: claimCoord must be a 30040 coordinate (got ${claimCoord})`);
    }
    if (authorEntityPubkey && !HASH64_RE.test(authorEntityPubkey)) {
        throw new Error(`${FN}: authorEntityPubkey must be 64-hex (got ${authorEntityPubkey})`);
    }
    if (horizonIso !== null && !/^\d{4}-\d{2}-\d{2}$/.test(horizonIso)) {
        throw new Error(`${FN}: horizonIso must be YYYY-MM-DD or null (got ${horizonIso})`);
    }

    const body = predictionText.trim();
    const dTag = await derivePredictionEntryDTag(articleHash, body);

    const tags = [tag('d', dTag)];
    tags.push(...articleTags({ articleHash, articleCoord, relayHint, articleUrl }, FN));
    if (claimCoord) tags.push(tag('a', claimCoord, relayHint, 'claim'));   // the atomized claim (RQ6)
    tags.push(tag('prediction-type', predictionType));
    tags.push(tag('hedge', hedgeLevel));
    tags.push(tag('attribution', attribution));
    if (attributedName) tags.push(tag('attributed-name', attributedName));
    if (authorEntityPubkey) tags.push(tag('p', authorEntityPubkey, '', 'predicts'));
    if (condition) tags.push(tag('condition', condition));
    tags.push(tag('horizon', horizon));
    if (horizonIso) tags.push(tag('horizon-iso', horizonIso));
    tags.push(tag('tractability', tractability));
    tags.push(tag('quote', evidenceQuote));
    if (anchor) tags.push(tag('anchor', JSON.stringify(anchor)));   // source_span as W3C selector
    tags.push(tag('criteria', criteria));
    tags.push(tag('module-version', moduleVersion));
    tags.push(...auditorTags({ auditor, constituents, manifestHash }, FN));
    tags.push(tag('client', 'xray'));

    return {
        event: { kind: KIND_PREDICTION_ENTRY, created_at: createdAt, tags, content: body },
        body,
        dTag
    };
}

/**
 * Parse a kind-30058 event. Null when structurally unusable (no
 * d/x/content text, bad enums, or missing auditor).
 */
export function parsePredictionEntryEvent(event) {
    if (!event || event.kind !== KIND_PREDICTION_ENTRY) return null;
    const tags = event.tags || [];
    const id = firstTag(tags, 'd');
    const articleHash = firstTag(tags, 'x');
    const text = (event.content || '').trim();
    const predictionType = firstTag(tags, 'prediction-type');
    const hedgeLevel = firstTag(tags, 'hedge');
    const auditorBlock = parseAuditorBlock(tags);
    if (!id || !articleHash || !text || !auditorBlock) return null;
    if (!PREDICTION_TYPES.includes(predictionType) || !HEDGE_LEVELS.includes(hedgeLevel)) return null;

    let anchor = null;
    const anchorRaw = firstTag(tags, 'anchor');
    if (anchorRaw) { try { anchor = JSON.parse(anchorRaw); } catch (_) { /* stays null */ } }

    // Attribution rejects like hedge/type — it books the prediction
    // against someone's track record, and defaulting a missing tag to
    // article_voice would silently misattribute a named source's
    // prediction to the article author's dossier.
    const attribution = firstTag(tags, 'attribution');
    if (!ATTRIBUTION_KINDS.includes(attribution)) return null;

    const claimA = tags.find((x) => x[0] === 'a' && x[3] === 'claim');
    const articleA = tags.find((x) => x[0] === 'a' && String(x[1]).startsWith('30023:'));
    const predictsP = tags.find((x) => x[0] === 'p' && x[3] === 'predicts');
    const tractability = firstTag(tags, 'tractability');
    return {
        id,
        articleHash,
        text,
        predictionType,
        hedgeLevel,
        attribution,
        attributedName: firstTag(tags, 'attributed-name') || null,
        condition: firstTag(tags, 'condition') || null,
        horizon: firstTag(tags, 'horizon') || '',
        horizonIso: firstTag(tags, 'horizon-iso') || null,
        tractability: TRACTABILITIES.includes(tractability) ? tractability : 'ambiguous',
        evidenceQuote: firstTag(tags, 'quote') || '',
        anchor,
        criteria: firstTag(tags, 'criteria') || '',
        moduleVersion: firstTag(tags, 'module-version') || '',
        claimCoord: (claimA && claimA[1]) || null,
        authorEntityPubkey: (predictsP && predictsP[1]) || null,
        ...auditorBlock,
        articleCoord: (articleA && articleA[1]) || null,
        url: firstTag(tags, 'r') || null,
        pubkey: event.pubkey || '',
        created_at: event.created_at || 0,
        eventId: event.id || null
    };
}

/**
 * Build a kind-30059 PredictionResolution. One per (resolver,
 * prediction) — the same resolver revising replaces (the framework
 * type's own latest-wins; the accepted RQ5 P9 tension, documented).
 * Evidence-bound (P3): at least one typed evidence entry is required —
 * challenges without evidence are returned, and so are resolutions.
 *
 * @returns {Promise<{event: object, body: string, dTag: string}>}
 */
export async function buildPredictionResolutionEvent({
    predictionCoord,
    predictionEventId = null,
    articleHash = null,
    outcome,
    confidence,
    resolvedAt,
    evidence,
    notes = '',
    relayHint = '',
    auditor,
    constituents = [],
    manifestHash = null,
    createdAt = nowSeconds()
} = {}) {
    const FN = 'buildPredictionResolutionEvent';
    if (!predictionCoord || !COORD_RE.test(predictionCoord) || !predictionCoord.startsWith(`${KIND_PREDICTION_ENTRY}:`)) {
        throw new Error(`${FN}: predictionCoord must be a 30058 coordinate (got ${predictionCoord})`);
    }
    assertEnum(outcome, RESOLUTION_OUTCOMES_WIRE, 'outcome', FN);
    assertRange(confidence, 0, 1, 'confidence', FN);
    assertRunAt(resolvedAt, FN);
    const evTags = evidenceTags(evidence, FN);
    if (!evidence || evidence.length === 0) {
        throw new Error(`${FN}: at least one evidence entry required — resolutions are evidence-bound (P3)`);
    }
    // Required: the prediction d is a one-way hash of (article hash |
    // text), so without `x` a resolution is invisible to #x article
    // queries — and the resolver always has the hash (it rides the
    // prediction record).
    assertArticleHash(articleHash, FN);
    if (predictionEventId !== null && !HASH64_RE.test(predictionEventId)) {
        throw new Error(`${FN}: predictionEventId must be a 64-hex event id (got ${predictionEventId})`);
    }

    const coord = predictionCoord.trim();
    const dTag = await derivePredictionResolutionDTag(coord);

    const tags = [tag('d', dTag)];
    tags.push(tag('a', coord, relayHint, 'prediction'));
    if (predictionEventId) tags.push(tag('e', predictionEventId, relayHint, 'prediction'));
    tags.push(tag('x', articleHash));     // the predicting article
    tags.push(tag('outcome', outcome));
    tags.push(tag('confidence', confidence));
    tags.push(tag('resolved-at', resolvedAt));
    tags.push(...evTags);
    tags.push(...auditorTags({ auditor, constituents, manifestHash }, FN));
    tags.push(tag('client', 'xray'));

    const body = String(notes || '');
    return {
        event: { kind: KIND_PREDICTION_RESOLUTION, created_at: createdAt, tags, content: body },
        body,
        dTag
    };
}

/** Parse a kind-30059 event. Null when structurally unusable. */
export function parsePredictionResolutionEvent(event) {
    if (!event || event.kind !== KIND_PREDICTION_RESOLUTION) return null;
    const tags = event.tags || [];
    const id = firstTag(tags, 'd');
    const evValues = evidenceValues(tags);
    // Role-marked reference first; fall back to prefix-match for
    // foreign events, excluding evidence-derived a tags (an evidence
    // entry can itself cite another 30058).
    const predictionA = tags.find((x) => x[0] === 'a' && x[3] === 'prediction'
            && String(x[1]).startsWith(`${KIND_PREDICTION_ENTRY}:`))
        || tags.find((x) => x[0] === 'a' && String(x[1]).startsWith(`${KIND_PREDICTION_ENTRY}:`)
            && !evValues.has(x[1]));
    const outcome = firstTag(tags, 'outcome');
    const auditorBlock = parseAuditorBlock(tags);
    if (!id || !predictionA || !RESOLUTION_OUTCOMES_WIRE.includes(outcome) || !auditorBlock) return null;

    const predictionE = tags.find((x) => x[0] === 'e' && x[3] === 'prediction' && HASH64_RE.test(x[1]))
        || tags.find((x) => x[0] === 'e' && HASH64_RE.test(x[1]) && !evValues.has(x[1]));
    return {
        id,
        predictionCoord: predictionA[1],
        predictionEventId: (predictionE && predictionE[1]) || null,
        articleHash: firstTag(tags, 'x') || null,
        outcome,
        confidence: boundedOrNull(firstTag(tags, 'confidence'), 0, 1),
        resolvedAt: firstTag(tags, 'resolved-at') || null,
        evidence: parseEvidenceTags(tags),
        notes: event.content || '',
        ...auditorBlock,
        pubkey: event.pubkey || '',
        created_at: event.created_at || 0,
        eventId: event.id || null
    };
}

/**
 * Build a kind-30060 DossierSnapshot. A CACHE: latest-wins per
 * (pubkey, subject) by design — the only audit kind where relay
 * replacement is the right semantics, because the record is wholly
 * re-derivable from published audit events given the window +
 * parameters it carries. Consumers MUST prefer re-derivation when
 * they hold the underlying events.
 *
 * Beat subjects MUST be canonical beats-v1 slugs (RQ8) — free-form
 * tags never mint dossier subjects.
 *
 * @returns {Promise<{event: object, body: string, dTag: string}>}
 */
export async function buildDossierSnapshotEvent({
    subjectKind,
    entityPubkey = null,
    beat = null,
    windowStart,
    windowEnd,
    articleCount,
    scoreMean,
    scoreMedian,
    scoreStdev,
    shrinkageK,
    populationMean,
    shrinkageFactor,
    perModuleMeans = {},
    predictions = null,
    topNamedSources = null,
    corrections = null,
    auditor,
    constituents = [],
    manifestHash = null,
    createdAt = nowSeconds()
} = {}) {
    const FN = 'buildDossierSnapshotEvent';
    assertEnum(subjectKind, DOSSIER_SUBJECT_KINDS, 'subjectKind', FN);
    const needsEntity = subjectKind === 'author' || subjectKind === 'publication' || subjectKind === 'publication_x_beat';
    const needsBeat = subjectKind === 'beat' || subjectKind === 'publication_x_beat';
    if (needsEntity && !HASH64_RE.test(entityPubkey || '')) {
        throw new Error(`${FN}: ${subjectKind} subjects need entityPubkey (64-hex)`);
    }
    if (needsBeat) {
        const slug = normalizeBeat(beat);
        if (!slug || slug !== beat) {
            throw new Error(`${FN}: beat subjects MUST be canonical beats-v1 slugs (got ${beat}) — free-form tags never mint dossiers (RQ8)`);
        }
    }
    assertRunAt(windowStart, FN);
    assertRunAt(windowEnd, FN);
    if (!Number.isInteger(articleCount) || articleCount < 1) {
        throw new Error(`${FN}: articleCount must be a positive integer (got ${articleCount}) — empty dossiers are never published; a zero-article rollup is just the population prior`);
    }
    assertRange(scoreMean, 0, 100, 'scoreMean', FN);
    assertRange(scoreMedian, 0, 100, 'scoreMedian', FN);
    if (typeof scoreStdev !== 'number' || !Number.isFinite(scoreStdev) || scoreStdev < 0) {
        throw new Error(`${FN}: scoreStdev must be a non-negative number (got ${scoreStdev})`);
    }
    if (!Number.isFinite(shrinkageK) || shrinkageK <= 0) {
        throw new Error(`${FN}: shrinkageK must be positive (got ${shrinkageK})`);
    }
    assertRange(populationMean, 0, 100, 'populationMean', FN);
    assertRange(shrinkageFactor, 0, 1, 'shrinkageFactor', FN);

    const subjectId = subjectKind === 'beat' ? beat
        : subjectKind === 'publication_x_beat' ? `${entityPubkey}|${beat}`
            : entityPubkey;
    const dTag = await deriveDossierSnapshotDTag(subjectKind, subjectId);

    const tags = [tag('d', dTag)];
    tags.push(tag('subject-kind', subjectKind));
    if (needsEntity) tags.push(tag('p', entityPubkey));
    if (needsBeat) tags.push(tag('t', beat));
    tags.push(tag('window-start', windowStart));
    tags.push(tag('window-end', windowEnd));
    tags.push(tag('article-count', articleCount));
    tags.push(tag('score-mean', scoreMean));
    tags.push(tag('score-median', scoreMedian));
    tags.push(tag('score-stdev', scoreStdev));
    tags.push(tag('shrinkage-k', shrinkageK));
    tags.push(tag('population-mean', populationMean));
    tags.push(tag('shrinkage-factor', shrinkageFactor));
    tags.push(...auditorTags({ auditor, constituents, manifestHash }, FN));
    tags.push(tag('client', 'xray'));

    const body = JSON.stringify({
        per_module_means: perModuleMeans,
        predictions,
        top_named_sources: topNamedSources,
        corrections
    });

    return {
        event: { kind: KIND_DOSSIER_SNAPSHOT, created_at: createdAt, tags, content: body },
        body,
        dTag
    };
}

/** Parse a kind-30060 event. Null when structurally unusable. */
export function parseDossierSnapshotEvent(event) {
    if (!event || event.kind !== KIND_DOSSIER_SNAPSHOT) return null;
    const tags = event.tags || [];
    const id = firstTag(tags, 'd');
    const subjectKind = firstTag(tags, 'subject-kind');
    const auditorBlock = parseAuditorBlock(tags);
    if (!id || !DOSSIER_SUBJECT_KINDS.includes(subjectKind) || !auditorBlock) return null;
    const entityPubkey = firstTag(tags, 'p') || null;
    const beat = firstTag(tags, 't') || null;
    if ((subjectKind === 'author' || subjectKind === 'publication' || subjectKind === 'publication_x_beat') && !entityPubkey) return null;
    if ((subjectKind === 'beat' || subjectKind === 'publication_x_beat') && !beat) return null;

    let content = {};
    try { content = JSON.parse(event.content) || {}; } catch (_) { /* tags carry the rollup */ }
    if (Array.isArray(content) || typeof content !== 'object' || content === null) content = {};

    return {
        id,
        subjectKind,
        entityPubkey,
        beat,
        windowStart: firstTag(tags, 'window-start') || null,
        windowEnd: firstTag(tags, 'window-end') || null,
        articleCount: boundedOrNull(firstTag(tags, 'article-count'), 0, Number.MAX_SAFE_INTEGER),
        scoreMean: boundedOrNull(firstTag(tags, 'score-mean'), 0, 100),
        scoreMedian: boundedOrNull(firstTag(tags, 'score-median'), 0, 100),
        scoreStdev: boundedOrNull(firstTag(tags, 'score-stdev'), 0, 100),
        shrinkageK: boundedOrNull(firstTag(tags, 'shrinkage-k'), 0, Number.MAX_SAFE_INTEGER),
        populationMean: boundedOrNull(firstTag(tags, 'population-mean'), 0, 100),
        shrinkageFactor: boundedOrNull(firstTag(tags, 'shrinkage-factor'), 0, 1),
        perModuleMeans: content.per_module_means || {},
        predictions: content.predictions || null,
        topNamedSources: content.top_named_sources || null,
        corrections: content.corrections || null,
        ...auditorBlock,
        pubkey: event.pubkey || '',
        created_at: event.created_at || 0,
        eventId: event.id || null
    };
}

/**
 * Build a kind-30061 AuditDispute — WIRE-FORMAT-ONLY in v1 (no filing
 * UI, no adjudication runtime). One dispute per (filer, target); the
 * filer may amend pre-adjudication or withdraw (`status`). Status on
 * the wire is FILER-ASSERTED only (open|withdrawn) — upheld/rejected
 * derive from future adjudication events and superseding audits,
 * which are other pubkeys' records. Evidence-bound: challenges
 * without evidence are returned, not adjudicated (P3, §7).
 *
 * @returns {Promise<{event: object, body: string, dTag: string}>}
 */
export async function buildAuditDisputeEvent({
    targetCoord,
    targetEventId = null,
    targetKind,
    articleHash = null,
    status = 'open',
    contested,
    evidence,
    disputeSummary,
    relayHint = '',
    auditor,
    constituents = [],
    manifestHash = null,
    createdAt = nowSeconds()
} = {}) {
    const FN = 'buildAuditDisputeEvent';
    if (!targetCoord || !COORD_RE.test(targetCoord)) {
        throw new Error(`${FN}: targetCoord must be a kind:pubkey:d coordinate (got ${targetCoord})`);
    }
    assertEnum(targetKind, DISPUTE_TARGET_KINDS, 'targetKind', FN);
    assertEnum(status, DISPUTE_STATUSES, 'status', FN);
    if (!Array.isArray(contested) || contested.length === 0 || contested.some((c) => typeof c !== 'string' || !c)) {
        throw new Error(`${FN}: contested must be a nonempty array of finding pointers (evidence_quote or JSON path)`);
    }
    const evTags = evidenceTags(evidence, FN);
    if (!evidence || evidence.length === 0) {
        throw new Error(`${FN}: at least one evidence entry required — challenges without evidence are returned, not adjudicated`);
    }
    if (typeof disputeSummary !== 'string' || !disputeSummary.trim()) {
        throw new Error(`${FN}: disputeSummary required`);
    }
    if (articleHash !== null) assertArticleHash(articleHash, FN);
    if (targetEventId !== null && !HASH64_RE.test(targetEventId)) {
        throw new Error(`${FN}: targetEventId must be a 64-hex event id (got ${targetEventId})`);
    }

    const coord = targetCoord.trim();
    const dTag = await deriveAuditDisputeDTag(coord);

    const tags = [tag('d', dTag)];
    tags.push(tag('a', coord, relayHint, 'target'));
    if (targetEventId) tags.push(tag('e', targetEventId, relayHint, 'target'));
    tags.push(tag('target-kind', targetKind));
    if (articleHash) tags.push(tag('x', articleHash));
    tags.push(tag('status', status));
    for (const c of contested) tags.push(tag('contested', c));
    tags.push(...evTags);
    tags.push(...auditorTags({ auditor, constituents, manifestHash }, FN));
    tags.push(tag('client', 'xray'));

    const body = disputeSummary.trim();
    return {
        event: { kind: KIND_AUDIT_DISPUTE, created_at: createdAt, tags, content: body },
        body,
        dTag
    };
}

/** Parse a kind-30061 event. Null when structurally unusable. */
export function parseAuditDisputeEvent(event) {
    if (!event || event.kind !== KIND_AUDIT_DISPUTE) return null;
    const tags = event.tags || [];
    const id = firstTag(tags, 'd');
    const evValues = evidenceValues(tags);
    // Role-marked target first. The fallback for foreign events
    // cannot prefix-filter (disputes target four kinds), so it
    // excludes evidence-derived a tags instead.
    const targetA = tags.find((x) => x[0] === 'a' && x[3] === 'target' && COORD_RE.test(x[1]))
        || tags.find((x) => x[0] === 'a' && COORD_RE.test(x[1]) && !evValues.has(x[1]));
    const targetKind = firstTag(tags, 'target-kind');
    const status = firstTag(tags, 'status');
    const auditorBlock = parseAuditorBlock(tags);
    if (!id || !targetA || !targetA[1] || !DISPUTE_TARGET_KINDS.includes(targetKind) || !auditorBlock) return null;

    const targetE = tags.find((x) => x[0] === 'e' && x[3] === 'target' && HASH64_RE.test(x[1]))
        || tags.find((x) => x[0] === 'e' && HASH64_RE.test(x[1]) && !evValues.has(x[1]));
    return {
        id,
        targetCoord: targetA[1],
        targetEventId: (targetE && targetE[1]) || null,
        targetKind,
        articleHash: firstTag(tags, 'x') || null,
        status: DISPUTE_STATUSES.includes(status) ? status : 'open',
        contested: tags.filter((x) => x[0] === 'contested' && x[1]).map((x) => x[1]),
        evidence: parseEvidenceTags(tags),
        disputeSummary: event.content || '',
        ...auditorBlock,
        pubkey: event.pubkey || '',
        created_at: event.created_at || 0,
        eventId: event.id || null
    };
}

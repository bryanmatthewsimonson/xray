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
        score: numberOrNull(firstTag(tags, 'score')),
        confidence: numberOrNull(firstTag(tags, 'confidence')),
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
    const score = numberOrNull(firstTag(tags, 'score'));
    const ceiling = numberOrNull(firstTag(tags, 'ceiling'));
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
        rawScore: numberOrNull(firstTag(tags, 'raw-score')),
        ceiling,
        ceilingBinding: firstTag(tags, 'ceiling-binding') === 'true',
        ceilingSource,
        confidence: numberOrNull(firstTag(tags, 'confidence')),
        ...auditorBlock,
        articleCoord: (articleA && articleA[1]) || null,
        url: firstTag(tags, 'r') || null,
        beats: tags.filter((x) => x[0] === 't').map((x) => x[1]),
        moduleRefs,
        supersedesEventId: eRole('supersedes'),
        resolvesDisputeEventId: eRole('resolves-dispute'),
        moduleContributions: Array.isArray(content.module_contributions) ? content.module_contributions : [],
        knowabilityNotes: content.knowability_notes || '',
        modelEstimatedCeiling: typeof content.model_estimated_ceiling === 'number' ? content.model_estimated_ceiling : null,
        topStrengths: Array.isArray(content.top_strengths) ? content.top_strengths : [],
        topConcerns: Array.isArray(content.top_concerns) ? content.top_concerns : [],
        pubkey: event.pubkey || '',
        created_at: event.created_at || 0,
        eventId: event.id || null
    };
}

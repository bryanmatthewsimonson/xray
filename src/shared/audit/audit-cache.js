// X-Ray — audit ledger storage (Phase 13, slice 13.1).
//
// IndexedDB database `xray-audits`, following archive-cache.js's
// idempotent-open/upgrade pattern. Module findings JSON runs tens of
// KB × 8 per run — chrome.storage.local's JSON-serialized single-key
// maps should not carry that. Separate DB from `xray-archive` (same
// rationale as `xray-portal`: different lifecycle, no coupled schema
// bumps) — but unlike a reconcilable cache this one is PRECIOUS:
// audits cost money to recompute, so it is export-included, never
// droppable (docs/EPISTEMIC_AUDIT_DESIGN.md §"Local model and ledger").

import { Utils } from '../utils.js';
import { resolveActiveDbName } from '../workspace-keys.js';

const DB_NAME = 'xray-audits';
const DB_VERSION = 6;
const RUNS_STORE = 'runs';
const PREDICTIONS_STORE = 'predictions';
const RESOLUTIONS_STORE = 'resolutions';
// Phase 20.4 — the case-corpus synthesis briefs. Also PRECIOUS (a
// brief costs an LLM map/reduce run), so it rides the same
// export-included DB; keyed by the local case entity id.
const CASE_BRIEFS_STORE = 'case-briefs';
// Per-article MAP-stage extracts, keyed by a fingerprint of the exact
// map inputs (text + claims + prompt version). Lets a corpus re-run
// reuse an unchanged article's extract instead of re-paying for the
// LLM call — the map is the bulk of a synthesis's cost. Rides the same
// export-included DB so the cache survives a restore (a hit is a
// dollar saved); reconcilable, but never auto-dropped here.
const CORPUS_EXTRACTS_STORE = 'corpus-extracts';
// Phase 28.2 — LLM suggestions generated at batch import, parked until
// a human reviews them in the reader (the 14.5.3 modal). Keyed by the
// article URL (what the reader knows at load). Semi-precious: each
// record cost one suggest call, but is cheap to regenerate — it rides
// this DB for the free backup coverage, and a record is deleted when
// its review modal closes (matching the live suggest-pass semantics:
// close = the session is over, re-run to see them again).
const PENDING_SUGGESTIONS_STORE = 'pending-suggestions';
// Phase 28.3 — the standalone link-suggestion run per case: the
// proposals a claims-index pass returned plus their triage map
// (proposalKey → accepted|dismissed), so a reopened case view neither
// loses the run nor resurrects triaged rows. One record per case
// (latest-wins, the case-brief posture); cheap to regenerate but the
// triage decisions are the part worth keeping.
const CASE_LINKS_STORE = 'case-link-suggestions';
// EP.2 (docs/ENTITY_PAGE_KICKOFF.md) — the stored entity pages, keyed
// by the subject's entity id (latest-wins, the case-brief posture).
// PRECIOUS like the briefs: a page costs a reduce run (plus any map
// misses), and the human's section edits live on the record.
const ENTITY_PAGES_STORE = 'entity-pages';

function idb() {
    if (typeof indexedDB === 'undefined') {
        throw new Error('IndexedDB is not available in this context');
    }
    return indexedDB;
}

function req(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function tx(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
    });
}

let _dbPromise = null;
let _dbName = null;   // the on-disk name _dbPromise opened (28.1)

export function openAuditDb() {
    // 28.1: the DB name is workspace-suffixed; the memoized handle is
    // keyed by name so a workspace switch in a live context re-opens
    // the right database instead of reusing the old workspace's.
    return resolveActiveDbName(DB_NAME).then((dbName) => {
        if (_dbPromise && _dbName === dbName) return _dbPromise;
        if (_dbPromise) {
            _dbPromise.then((db) => { try { db.close(); } catch (_) { /* noop */ } }).catch(() => {});
            _dbPromise = null;   // never let openNamed short-circuit onto the old workspace's handle
        }
        _dbName = dbName;
        return openNamed(dbName);
    });
}

function openNamed(dbName) {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
        let open;
        try { open = idb().open(dbName, DB_VERSION); }
        catch (err) { reject(err); return; }

        open.onupgradeneeded = (ev) => {
            const db = open.result;
            const oldVersion = ev.oldVersion || 0;

            // v1 — the three ledger stores (Phase 13.1).
            if (oldVersion < 1) {
                if (!db.objectStoreNames.contains(RUNS_STORE)) {
                    const runs = db.createObjectStore(RUNS_STORE, { keyPath: 'id' });
                    runs.createIndex('articleHash', 'articleHash', { unique: false });
                    runs.createIndex('runAt', 'runAt', { unique: false });
                }
                if (!db.objectStoreNames.contains(PREDICTIONS_STORE)) {
                    const preds = db.createObjectStore(PREDICTIONS_STORE, { keyPath: 'id' });
                    preds.createIndex('articleHash', 'articleHash', { unique: false });
                    preds.createIndex('resolutionStatus', 'resolution_status', { unique: false });
                    preds.createIndex('horizonIso', 'horizon_iso', { unique: false });
                }
                if (!db.objectStoreNames.contains(RESOLUTIONS_STORE)) {
                    const res = db.createObjectStore(RESOLUTIONS_STORE, { keyPath: 'id' });
                    res.createIndex('predictionCoord', 'prediction_coord', { unique: false });
                }
            }

            // v2 — the case-corpus synthesis brief store (Phase 20.4).
            if (oldVersion < 2) {
                if (!db.objectStoreNames.contains(CASE_BRIEFS_STORE)) {
                    db.createObjectStore(CASE_BRIEFS_STORE, { keyPath: 'caseId' });
                }
            }

            // v3 — the per-article MAP-extract cache.
            if (oldVersion < 3) {
                if (!db.objectStoreNames.contains(CORPUS_EXTRACTS_STORE)) {
                    db.createObjectStore(CORPUS_EXTRACTS_STORE, { keyPath: 'key' });
                }
            }

            // v4 — pending import-time suggestions (Phase 28.2).
            if (oldVersion < 4) {
                if (!db.objectStoreNames.contains(PENDING_SUGGESTIONS_STORE)) {
                    db.createObjectStore(PENDING_SUGGESTIONS_STORE, { keyPath: 'url' });
                }
            }

            // v5 — the standalone link-suggestion run (Phase 28.3).
            if (oldVersion < 5) {
                if (!db.objectStoreNames.contains(CASE_LINKS_STORE)) {
                    db.createObjectStore(CASE_LINKS_STORE, { keyPath: 'caseId' });
                }
            }

            // v6 — the entity pages (EP.2).
            if (oldVersion < 6) {
                if (!db.objectStoreNames.contains(ENTITY_PAGES_STORE)) {
                    db.createObjectStore(ENTITY_PAGES_STORE, { keyPath: 'entityId' });
                }
            }
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
    });
    return _dbPromise;
}

async function readStore(name) {
    const db = await openAuditDb();
    return db.transaction(name, 'readonly').objectStore(name);
}

// Writes await TRANSACTION COMMIT, not just request success — a
// request's success event fires before the commit, which can still
// fail (quota at flush, abort). This ledger is precious; a caller
// told "saved" must mean durably saved (archive-cache.js's write
// pattern).
async function put(name, record) {
    const db = await openAuditDb();
    const transaction = db.transaction(name, 'readwrite');
    transaction.objectStore(name).put(record);
    await tx(transaction);
    return record;
}

async function remove(name, id) {
    const db = await openAuditDb();
    const transaction = db.transaction(name, 'readwrite');
    transaction.objectStore(name).delete(id);
    await tx(transaction);
}

async function get(name, id) {
    const s = await readStore(name);
    const hit = await req(s.get(id));
    return hit || null;
}

async function getAllByIndex(name, index, value) {
    // IDBIndex.getAll(undefined|null) is an UNBOUNDED range — it would
    // return the entire store. A missing key means "no matches", never
    // "everything": a caller bug must not silently widen a per-article
    // query into the whole ledger.
    if (value === undefined || value === null) return [];
    const s = await readStore(name);
    return req(s.index(index).getAll(value));
}

async function getAll(name) {
    const s = await readStore(name);
    return req(s.getAll());
}

async function countStore(name) {
    const s = await readStore(name);
    return req(s.count());
}

// --- runs --------------------------------------------------------------------

export function saveRun(record) { return put(RUNS_STORE, record); }
export function getRun(id) { return get(RUNS_STORE, id); }
export function runsByArticleHash(hash) { return getAllByIndex(RUNS_STORE, 'articleHash', hash); }
export function listRuns() { return getAll(RUNS_STORE); }
export function deleteRun(id) { return remove(RUNS_STORE, id); }
export function countRuns() { return countStore(RUNS_STORE); }

// --- predictions ---------------------------------------------------------------

export function savePrediction(record) { return put(PREDICTIONS_STORE, record); }
export function getPrediction(id) { return get(PREDICTIONS_STORE, id); }
export function predictionsByArticleHash(hash) { return getAllByIndex(PREDICTIONS_STORE, 'articleHash', hash); }
export function predictionsByStatus(status) { return getAllByIndex(PREDICTIONS_STORE, 'resolutionStatus', status); }
export function listPredictions() { return getAll(PREDICTIONS_STORE); }
export function deletePrediction(id) { return remove(PREDICTIONS_STORE, id); }

// --- resolutions ----------------------------------------------------------------

export function saveResolution(record) { return put(RESOLUTIONS_STORE, record); }
export function getResolution(id) { return get(RESOLUTIONS_STORE, id); }
export function resolutionsByPredictionCoord(coord) { return getAllByIndex(RESOLUTIONS_STORE, 'predictionCoord', coord); }
export function listResolutions() { return getAll(RESOLUTIONS_STORE); }
export function deleteResolution(id) { return remove(RESOLUTIONS_STORE, id); }

// --- case briefs (20.4) ---------------------------------------------------------

export function saveCaseBrief(record) { return put(CASE_BRIEFS_STORE, record); }
export function getCaseBrief(caseId) { return get(CASE_BRIEFS_STORE, caseId); }
export function deleteCaseBrief(caseId) { return remove(CASE_BRIEFS_STORE, caseId); }
export function listCaseBriefs() { return getAll(CASE_BRIEFS_STORE); }

// --- corpus map-extract cache (map/reduce cost reuse) ---------------------------

export function saveCorpusExtract(record) { return put(CORPUS_EXTRACTS_STORE, record); }
export function getCorpusExtract(key) { return get(CORPUS_EXTRACTS_STORE, key); }
export function deleteCorpusExtract(key) { return remove(CORPUS_EXTRACTS_STORE, key); }
export function listCorpusExtracts() { return getAll(CORPUS_EXTRACTS_STORE); }
export function countCorpusExtracts() { return countStore(CORPUS_EXTRACTS_STORE); }

// --- pending import-time suggestions (28.2) -------------------------------------

export function savePendingSuggestions(record) { return put(PENDING_SUGGESTIONS_STORE, record); }
export function getPendingSuggestions(url) { return get(PENDING_SUGGESTIONS_STORE, url); }
export function deletePendingSuggestions(url) { return remove(PENDING_SUGGESTIONS_STORE, url); }
export function listPendingSuggestions() { return getAll(PENDING_SUGGESTIONS_STORE); }

// --- entity pages (EP.2) --------------------------------------------------------

export function saveEntityPage(record) { return put(ENTITY_PAGES_STORE, record); }
export function getEntityPage(entityId) { return get(ENTITY_PAGES_STORE, entityId); }
export function deleteEntityPage(entityId) { return remove(ENTITY_PAGES_STORE, entityId); }
export function listEntityPages() { return getAll(ENTITY_PAGES_STORE); }

// --- standalone link-suggestion runs (28.3) -------------------------------------

export function saveCaseLinkRun(record) { return put(CASE_LINKS_STORE, record); }
export function getCaseLinkRun(caseId) { return get(CASE_LINKS_STORE, caseId); }
export function deleteCaseLinkRun(caseId) { return remove(CASE_LINKS_STORE, caseId); }

// --- maintenance ----------------------------------------------------------------

export async function clear() {
    const db = await openAuditDb();
    const transaction = db.transaction(
        [RUNS_STORE, PREDICTIONS_STORE, RESOLUTIONS_STORE, CASE_BRIEFS_STORE, CORPUS_EXTRACTS_STORE,
         PENDING_SUGGESTIONS_STORE, CASE_LINKS_STORE, ENTITY_PAGES_STORE], 'readwrite');
    transaction.objectStore(RUNS_STORE).clear();
    transaction.objectStore(PREDICTIONS_STORE).clear();
    transaction.objectStore(RESOLUTIONS_STORE).clear();
    transaction.objectStore(CASE_BRIEFS_STORE).clear();
    transaction.objectStore(CORPUS_EXTRACTS_STORE).clear();
    transaction.objectStore(PENDING_SUGGESTIONS_STORE).clear();
    transaction.objectStore(CASE_LINKS_STORE).clear();
    transaction.objectStore(ENTITY_PAGES_STORE).clear();
    await tx(transaction);
}

/** Test hook: drop the memoized connection so a fresh fake DB attaches. */
export function _resetForTests() {
    if (_dbPromise) {
        _dbPromise.then((db) => { try { db.close(); } catch (_) { /* noop */ } })
            .catch((err) => Utils.error('audit-cache: reset close failed', err));
    }
    _dbPromise = null;
}

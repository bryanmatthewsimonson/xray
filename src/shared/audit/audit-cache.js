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

const DB_NAME = 'xray-audits';
const DB_VERSION = 3;
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

export function openAuditDb() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
        let open;
        try { open = idb().open(DB_NAME, DB_VERSION); }
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

// --- maintenance ----------------------------------------------------------------

export async function clear() {
    const db = await openAuditDb();
    const transaction = db.transaction(
        [RUNS_STORE, PREDICTIONS_STORE, RESOLUTIONS_STORE, CASE_BRIEFS_STORE, CORPUS_EXTRACTS_STORE], 'readwrite');
    transaction.objectStore(RUNS_STORE).clear();
    transaction.objectStore(PREDICTIONS_STORE).clear();
    transaction.objectStore(RESOLUTIONS_STORE).clear();
    transaction.objectStore(CASE_BRIEFS_STORE).clear();
    transaction.objectStore(CORPUS_EXTRACTS_STORE).clear();
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

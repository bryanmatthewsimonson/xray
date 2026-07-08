// Engine indirection for tests/pdf-capture-realpdf.test.mjs: the same
// export surface as dist/pdf-engine.bundle.js, backed by the REAL
// pdf.js legacy build (the modern build needs DOMMatrix, absent in
// node). The URL is computed by the test (import.meta-relative) and
// handed over via a global so this fixture works from any cwd.

const engine = await import(globalThis.__realPdfEngineUrl);
export const getDocument = engine.getDocument;
export const GlobalWorkerOptions = engine.GlobalWorkerOptions;
export const version = engine.version;
export const OPS = engine.OPS;

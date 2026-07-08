// Stub pdf.js engine for node tests (tests/pdf-capture-stub.test.mjs).
//
// capturePdfToArticle lazy-imports the real engine bundle via
// chrome.runtime.getURL('dist/pdf-engine.bundle.js'); the test's chrome
// shim points that URL at THIS module instead, so the capture pipeline
// runs end-to-end in node against hand-built documents. Behavior is
// configured through globalThis.__stubPdfEngine = { doc } and the stub
// records loading-task teardown in `destroyCalls`.

export const GlobalWorkerOptions = {};
export const version = 'stub';
export const OPS = {
    save: 1, restore: 2, transform: 3,
    paintImageXObject: 4, paintImageXObjectRepeat: 5,
    paintFormXObjectBegin: 6, paintFormXObjectEnd: 7
};

export function getDocument() {
    const cfg = globalThis.__stubPdfEngine;
    cfg.destroyCalls = 0;
    // Mirrors pdf.js 6.x: teardown lives on the LOADING TASK — the
    // document proxy has no destroy() method.
    cfg.task = {
        promise: Promise.resolve(cfg.doc),
        destroy() { cfg.destroyCalls += 1; return Promise.resolve(); }
    };
    return cfg.task;
}

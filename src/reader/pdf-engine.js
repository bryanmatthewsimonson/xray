// pdf.js engine entry — Phase 18 C4.
//
// Built as dist/pdf-engine.bundle.js (ESM) and dynamically imported by
// pdf-capture.js only when a PDF is actually captured, so the ~1.5MB
// engine never weighs down the ordinary reader load. Its worker is the
// sibling dist/pdf.worker.bundle.js (see pdf-worker-entry.js).
export { getDocument, GlobalWorkerOptions, version, OPS } from 'pdfjs-dist';

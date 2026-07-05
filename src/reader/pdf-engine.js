// pdf.js engine entry — Phase 18 C4.
//
// Built as dist/pdf-engine.bundle.js (ESM) and dynamically imported by
// pdf-capture.js only when a PDF is actually captured, so the ~1.5MB
// engine never weighs down the ordinary reader load. Its worker is the
// sibling dist/pdf.worker.bundle.js (see pdf-worker-entry.js).

// Must precede the pdfjs import: pdf.js 6.x calls Map.getOrInsertComputed
// (in getOperatorList, among others), which is absent from the Firefox 128
// floor and older Chrome and would otherwise throw and silently kill figure
// extraction. Side-effect import; runs before the re-export below.
import './pdf-collection-polyfill.js';

export { getDocument, GlobalWorkerOptions, version, OPS } from 'pdfjs-dist';

// pdf.js worker entry — Phase 18 C4.
//
// Bundled as dist/pdf.worker.bundle.js (IIFE, classic-worker
// compatible) and spawned by the engine via
// GlobalWorkerOptions.workerSrc (an extension URL — same-origin, so no
// web_accessible_resources entry is needed).

// Same shim as the main thread (pdf-engine.js): the worker half of pdf.js
// 6.x also calls Map.getOrInsertComputed, which is missing on older engines.
// Must run before the worker code below.
import './pdf-collection-polyfill.js';
import 'pdfjs-dist/build/pdf.worker.mjs';

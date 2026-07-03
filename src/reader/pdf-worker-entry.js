// pdf.js worker entry — Phase 18 C4.
//
// Bundled as dist/pdf.worker.bundle.js (IIFE, classic-worker
// compatible) and spawned by the engine via
// GlobalWorkerOptions.workerSrc (an extension URL — same-origin, so no
// web_accessible_resources entry is needed).
import 'pdfjs-dist/build/pdf.worker.mjs';

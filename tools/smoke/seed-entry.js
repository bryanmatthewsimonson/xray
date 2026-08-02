// Smoke-only seed harness. Bundled by esbuild into dist/ (gitignored) so
// bare npm specifiers resolve exactly as they do in the real bundles, then
// injected into the portal page as a same-origin script.
import { EntityModel } from '../../src/shared/entity-model.js';
import { ClaimModel } from '../../src/shared/claim-model.js';
import { saveArticle, listArticles } from '../../src/shared/archive-cache.js';
import { recordArticleExtraction, partitionAssertions } from '../../src/shared/map-artifacts.js';
import { getArticleExtraction } from '../../src/shared/audit/audit-cache.js';
import { Storage } from '../../src/shared/storage.js';
import { EventBuilder } from '../../src/shared/event-builder.js';
import {
    buildExtractionAnalysisEvent, publishableAnalysis, parseExtractionAnalysisEvent,
    claimCoordIndex, EXTRACTION_ANALYSIS_KIND
} from '../../src/shared/extraction-publish.js';
import { Crypto } from '../../src/shared/crypto.js';
import { saveRecords } from '../../src/portal/portal-cache.js';

window.__xr = {
    EntityModel, ClaimModel, saveArticle, listArticles, recordArticleExtraction,
    partitionAssertions, getArticleExtraction, Storage, EventBuilder,
    buildExtractionAnalysisEvent, publishableAnalysis, parseExtractionAnalysisEvent,
    claimCoordIndex, EXTRACTION_ANALYSIS_KIND, Crypto, saveRecords
};
window.__xrReady = true;

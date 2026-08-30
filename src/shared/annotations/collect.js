// Margin S1 — the Mine-ring collector (docs/MARGIN_DESIGN.md §6).
// One responsibility: fetch every locally-held insight family for the
// open article through the workspace-correct model/cache APIs, then
// shape via the pure projectors. No DOM; callers own render timing.
import { ClaimModel } from '../claim-model.js';
import { AssessmentModel } from '../assessment-model.js';
import { TruthAdjudicationModel, VerdictModel } from '../truth-adjudication-model.js';
import { ForensicModel } from '../forensic-model.js';
import { getArticleExtraction } from '../audit/audit-cache.js';
import { AuditRunModel, PredictionModel } from '../audit/audit-model.js';
import { Crypto } from '../crypto.js';
import { normalize } from '../metadata/url-normalizer.js';
import {
    projectClaimNotes, projectExtractionNotes, projectForensicNotes,
    projectAuditNotes, projectPredictionNotes, projectCommentNotes
} from './notes.js';

// Try the 64-hex content hash first, then the legacy case-path
// fallback key 'url:<sha16(normalized url)>' (case-synthesis.js:95).
async function extractionFor(articleHash, url) {
    if (articleHash) {
        const rec = await getArticleExtraction(articleHash);
        if (rec) return { rec, key: articleHash };
    }
    if (!url) return { rec: null, key: null };
    const sha16 = (await Crypto.sha256(normalize(String(url)))).slice(0, 16);
    const key = 'url:' + sha16;
    const rec = await getArticleExtraction(key);
    return rec ? { rec, key } : { rec: null, key: null };
}

export async function collectMineNotes({ url, articleHash = null, auditableHash = null, comments = [] }) {
    const claims = await ClaimModel.getBySourceUrl(url);
    const assessmentsByClaimId = {};
    const verdictsByClaimId = {};
    for (const claim of claims) {
        const assessment = await AssessmentModel.getByClaimRef(claim.id); // ONE or null
        if (assessment) assessmentsByClaimId[claim.id] = assessment;
        const verdicts = [];
        for (const prop of await TruthAdjudicationModel.getByClaim(claim.id)) {
            verdicts.push(...await VerdictModel.getForProposition(prop.id));
        }
        if (verdicts.length) verdictsByClaimId[claim.id] = verdicts;
    }
    // Audits over truncated captures persist under the SLICED text's
    // hash — query both keys (the reader idiom, index.js:1525-1533).
    const truncKey = (auditableHash && auditableHash !== articleHash) ? auditableHash : null;
    const [findings, extraction, runsA, runsB, predsA, predsB] = await Promise.all([
        ForensicModel.getAll(),
        extractionFor(articleHash, url),
        articleHash ? AuditRunModel.getByArticleHash(articleHash) : [],
        truncKey ? AuditRunModel.getByArticleHash(truncKey) : [],
        articleHash ? PredictionModel.getByArticleHash(articleHash) : [],
        truncKey ? PredictionModel.getByArticleHash(truncKey) : []
    ]);
    return {
        notes: [
            ...projectClaimNotes({ claims, assessmentsByClaimId, verdictsByClaimId }),
            ...projectExtractionNotes(extraction.rec),
            ...projectForensicNotes(findings, url),
            ...projectAuditNotes([...(runsA || []), ...(runsB || [])]),
            ...projectPredictionNotes([...(predsA || []), ...(predsB || [])]),
            ...projectCommentNotes(comments)
        ],
        extractionKey: extraction.key
    };
}

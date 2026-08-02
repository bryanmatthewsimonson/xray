// Corpus-held cited sources for the source-quality audit — R2 of the
// founding-transcript integration (JOURNAL 2026-08-02).
//
// The audit's oldest honest complaint is module 04's own caveat:
// sourcing is "unverifiable from the article alone." When the case
// corpus ALREADY HOLDS a document the article cites, that stops being
// true — the reference resolver identifies the member (url / alias /
// DOI, never similarity), and this module packages capped excerpts of
// those members for the module-04 call, which then judges whether the
// article characterizes each source accurately (corpus_source_checks[],
// methodology 1.1).
//
// Layer 4 of the founding architecture (fetch-and-compare), made
// corpus-internal: nothing is fetched from the web — only documents the
// user already captured are consulted, and identity is mechanical.
//
// Pure core + an orchestrator with injected io (the extraction-block
// test seam pattern). No chrome, no network, no DOM at module level.

import { Utils } from '../utils.js';
import {
    collectReferenceCandidates, resolveReferenceCandidates
} from '../reference-resolver.js';

// At most this many resolved sources ride along — the spend confirm
// discloses the added characters, and four full excerpts is already a
// substantial prompt. Deterministic pick: resolution-tier order
// (doi > url > alias), then member url, so re-runs attach the same set.
export const MAX_CORPUS_SOURCES = 4;

// Per-source excerpt cap. Long enough to cover most cited passages,
// short enough that four sources stay well under the article's own
// 120k budget.
export const MAX_SOURCE_EXCERPT_CHARS = 6000;

const MATCH_RANK = { doi: 0, url: 1, alias: 2 };

/**
 * Pick the resolved rows that become corpus sources: deterministic
 * identity only (never title suggestions), self excluded, deduped by
 * member, capped. Pure.
 *
 * @param {Array} resolvedRows  resolveReferenceCandidates output
 * @param {object} [opts]
 * @param {string} [opts.selfHash]  the audited article's hash
 * @param {string} [opts.selfUrl]   the audited article's normalized url
 * @param {number} [opts.max]
 */
export function pickCorpusSources(resolvedRows, { selfHash = '', selfUrl = '', max = MAX_CORPUS_SOURCES } = {}) {
    const seen = new Set();
    const out = [];
    const rows = (resolvedRows || [])
        .filter((r) => r && r.status === 'resolved' && r.member)
        .filter((r) => r.member.articleHash !== selfHash && r.member.url !== selfUrl)
        .sort((a, b) => (MATCH_RANK[a.match] ?? 9) - (MATCH_RANK[b.match] ?? 9)
            || String(a.member.url).localeCompare(String(b.member.url)));
    for (const r of rows) {
        if (seen.has(r.member.articleHash)) continue;
        seen.add(r.member.articleHash);
        out.push(r);
        if (out.length >= max) break;
    }
    return out;
}

/**
 * Project picked rows + member bodies into the entries the prompt and
 * the request carry. Pure; `bodyOf(member)` is injected.
 *
 * @returns {Array<{cited_as, member_url, member_title, match, excerpt, truncated}>}
 */
export function buildCorpusSourceEntries(picked, bodyOf, { excerptChars = MAX_SOURCE_EXCERPT_CHARS } = {}) {
    const out = [];
    for (const r of picked || []) {
        const body = String(bodyOf(r.member) || '');
        if (!body.trim()) continue;
        out.push({
            cited_as: r.display || r.member.title || r.member.url || '',
            member_url: r.member.url || '',
            member_title: r.member.title || '',
            match: r.match,
            excerpt: body.slice(0, excerptChars),
            truncated: body.length > excerptChars
        });
    }
    return out;
}

/** Total characters the entries add to the module-04 call — for the
 *  spend confirm (P12: disclose before spending). */
export function corpusSourcesChars(entries) {
    return (entries || []).reduce((n, e) => n + ((e && e.excerpt) ? e.excerpt.length : 0), 0);
}

/** Member index rows + record lookup from archive records — the
 *  portal corpus-runner path, where all records are already in hand. */
export function memberIndexFromRecords(records, normalizeUrl) {
    const members = [];
    const recByHash = new Map();
    for (const rec of records || []) {
        if (!rec || !rec.article) continue;
        const scholar = rec.article.scholar;
        const member = {
            articleHash: rec.articleHash || `url:${normalizeUrl(rec.url || '')}`,
            url: rec.url || '',
            title: rec.article.title || null,
            doi: scholar && scholar.doi ? String(scholar.doi).toLowerCase() : null
        };
        members.push(member);
        recByHash.set(member.articleHash, rec);
    }
    return { members, recByHash };
}

/** Corpus sources for ONE record resolved against its sibling records —
 *  the portal corpus-runner path. Pure over injected pieces. */
export function corpusSourcesForRecord(rec, {
    members, recByHash, aliasMap = {}, resolveWithMapFn, extraction = null,
    assembleBody, normalizeUrl
}) {
    if (!rec || !rec.article) return [];
    const candidates = collectReferenceCandidates({
        links: rec.article.links || [],
        references: rec.article.references || [],
        mapSources: (extraction && extraction.sources) || []
    });
    if (candidates.length === 0) return [];
    const rows = resolveReferenceCandidates(candidates, members, {
        resolve: (u) => resolveWithMapFn(aliasMap, u)
    });
    const picked = pickCorpusSources(rows, {
        selfHash: rec.articleHash || `url:${normalizeUrl(rec.url || '')}`,
        selfUrl: normalizeUrl(rec.url || '')
    });
    return buildCorpusSourceEntries(picked, (member) => {
        const r = recByHash.get(member.articleHash);
        return r ? assembleBody(r.article) : '';
    });
}

/**
 * Gather corpus sources for ONE article about to be audited — the
 * reader path. Every dependency is injected so the core is testable
 * and failures degrade to [] (enrichment, never a blocker).
 *
 * @param {object} params
 * @param {object} params.article    the audited article (links/references/url)
 * @param {string} params.selfHash   its canonical hash ('' ok)
 * @param {object} params.io {
 *   resolveActiveCaseRef(): Promise<{caseId}|null>,
 *   memberUrlSets(caseId): Promise<{familyIds?, tagUrls, claimUrls}>,
 *   getArticle(url): Promise<archiveRecord|null>,
 *   getArticleExtraction(hash): Promise<record|null>,
 *   loadAliasMap(): Promise<object>,
 *   resolveWithMap(map, url): string,
 *   normalizeUrl(url): string,
 *   assembleBody(article): string }
 * @returns {Promise<{entries: Array, memberCount: number}>}
 */
export async function gatherCorpusSources({ article, selfHash = '', io }) {
    try {
        const caseRef = await io.resolveActiveCaseRef();
        if (!caseRef || !caseRef.caseId) return { entries: [], memberCount: 0 };

        const sets = await io.memberUrlSets(caseRef.caseId);
        const urls = [...new Set([...(sets.tagUrls || []), ...(sets.claimUrls || [])])];
        if (urls.length === 0) return { entries: [], memberCount: 0 };

        const members = [];
        const recByHash = new Map();
        for (const url of urls) {
            const rec = await io.getArticle(url).catch(() => null);
            if (!rec || !rec.article) continue;
            const scholar = rec.article.scholar;
            const member = {
                articleHash: rec.articleHash || `url:${io.normalizeUrl(rec.url || url)}`,
                url: rec.url || url,
                title: rec.article.title || null,
                doi: scholar && scholar.doi ? String(scholar.doi).toLowerCase() : null
            };
            members.push(member);
            recByHash.set(member.articleHash, rec);
        }
        if (members.length === 0) return { entries: [], memberCount: 0 };

        const extraction = selfHash
            ? await io.getArticleExtraction(selfHash).catch(() => null)
            : null;
        const candidates = collectReferenceCandidates({
            links: (article && article.links) || [],
            references: (article && article.references) || [],
            mapSources: (extraction && extraction.sources) || []
        });
        if (candidates.length === 0) return { entries: [], memberCount: members.length };

        const aliasMap = await io.loadAliasMap().catch(() => ({}));
        const rows = resolveReferenceCandidates(candidates, members, {
            resolve: (u) => io.resolveWithMap(aliasMap, u)
        });
        const picked = pickCorpusSources(rows, {
            selfHash,
            selfUrl: io.normalizeUrl((article && article.url) || '')
        });
        const entries = buildCorpusSourceEntries(picked, (member) => {
            const rec = recByHash.get(member.articleHash);
            return rec ? io.assembleBody(rec.article) : '';
        });
        return { entries, memberCount: members.length };
    } catch (err) {
        Utils.error('corpus-sources: gather failed (audit proceeds without)', err);
        return { entries: [], memberCount: 0 };
    }
}

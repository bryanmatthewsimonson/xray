// Referenced-sources block — R1 of the founding-transcript integration
// (JOURNAL 2026-08-02). The corpus-level completion of the extraction
// block's raw per-member "cited sources" frontier: every source the
// corpus CITES — hyperlinks, structured reference lists, map-stage
// source references, module-04 primary documents — resolved against
// what the corpus already HOLDS (shared/reference-resolver.js).
//
//   resolved    the cited source is already a member (url/alias/doi)
//   suggested   a member's title matches closely — offered, never asserted
//   capturable  addressable but absent — one click imports it into the case
//   unknown     prose-only mention — a coverage gap, named on its face
//
// Costs NO LLM call and is therefore not consent-gated: it reads
// knowledge already bought (archive rows, extraction records, audit
// runs). The Import action fetches URLs only on an explicit click and
// runs the ordinary url-import pipeline (archive + hash + case tag);
// LLM suggest parking stays with the Sources ▾ import surface.
//
// The DOM layer is a 1:1 projection of `buildReferencesModel` (pure),
// so tests walk the model, not the DOM.

import { el, truncate } from './dom.js';
import { Utils } from '../shared/utils.js';
import { buildMemberUnits } from '../shared/case-synthesis.js';
import { getArticleExtraction } from '../shared/audit/audit-cache.js';
import { loadAliasMap, resolveWithMap } from '../shared/url-aliases.js';
import { importUrlList } from '../shared/url-import.js';
import {
    collectReferenceCandidates, resolveReferenceCandidates
} from '../shared/reference-resolver.js';

const MAX_ROWS = 12;

/**
 * Pure view model: per-member candidate collection → corpus resolution
 * → deduplicated section lists. No storage, no DOM.
 *
 * @param {object} inputs
 * @param {Array}  inputs.units            buildMemberUnits output, deduped by article_hash
 * @param {Map}    inputs.archiveByUrl     normalized url → archive record
 * @param {Array}  inputs.auditRuns        data.auditRuns
 * @param {Map}    inputs.extractionByHash article_hash → article-extractions record
 * @param {function} [inputs.heal]         url → terminal url (alias healing)
 * @returns {{memberCount, resolved, suggested, capturable, unknown, summary}}
 */
export function buildReferencesModel({
    units = [],
    archiveByUrl = new Map(),
    auditRuns = [],
    extractionByHash = new Map(),
    heal
} = {}) {
    const members = units.map((u) => {
        const arch = archiveByUrl.get(u.url);
        const scholar = arch && arch.article && arch.article.scholar;
        return {
            articleHash: u.article_hash,
            url: u.url,
            title: u.title || null,
            doi: scholar && scholar.doi ? String(scholar.doi).toLowerCase() : null
        };
    });

    const runByHash = new Map();
    for (const r of auditRuns || []) {
        if (!r) continue;
        if (r.articleHash && !runByHash.has(r.articleHash)) runByHash.set(r.articleHash, r);
        if (r.captureArticleHash && !runByHash.has(r.captureArticleHash)) runByHash.set(r.captureArticleHash, r);
    }

    const resolved = [];
    const suggested = [];
    const capturableByUrl = new Map();
    const unknownByIdent = new Map();

    for (const u of units) {
        const arch = archiveByUrl.get(u.url);
        const article = (arch && arch.article) || {};
        const run = runByHash.get(u.article_hash) || null;
        const mr = run && (run.moduleResults || []).find((m) => m && m.module === 'source_quality');
        const findings = (mr && mr.findings) || {};
        const rec = extractionByHash.get(u.article_hash) || null;

        const candidates = collectReferenceCandidates({
            links: article.links || [],
            references: article.references || [],
            mapSources: (rec && rec.sources) || [],
            auditDocuments: findings.primary_documents || [],
            auditSources: findings.sources || []
        });
        if (candidates.length === 0) continue;

        const citedBy = u.title || u.url;
        for (const row of resolveReferenceCandidates(candidates, members, { resolve: heal })) {
            // A member "citing" itself (canonical self-links, scholar
            // self-DOI) is identity, not a reference — skip.
            if (row.member && row.member.articleHash === u.article_hash) continue;
            if (row.status === 'resolved') {
                resolved.push({ ...row, citedBy });
            } else if (row.status === 'suggested') {
                suggested.push({ ...row, citedBy });
            } else if (row.status === 'capturable') {
                const prior = capturableByUrl.get(row.captureUrl);
                if (prior) {
                    if (!prior.citedBy.includes(citedBy)) prior.citedBy.push(citedBy);
                    for (const o of row.origins) if (!prior.origins.includes(o)) prior.origins.push(o);
                } else {
                    capturableByUrl.set(row.captureUrl, {
                        captureUrl: row.captureUrl,
                        display: row.display,
                        origins: [...row.origins],
                        citedBy: [citedBy]
                    });
                }
            } else {
                const ident = String(row.display || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 160);
                if (!ident) continue;
                const prior = unknownByIdent.get(ident);
                if (prior) {
                    if (!prior.citedBy.includes(citedBy)) prior.citedBy.push(citedBy);
                    for (const o of row.origins) if (!prior.origins.includes(o)) prior.origins.push(o);
                } else {
                    unknownByIdent.set(ident, {
                        display: row.display,
                        quote: row.quote || null,
                        origins: [...row.origins],
                        citedBy: [citedBy]
                    });
                }
            }
        }
    }

    const capturable = [...capturableByUrl.values()]
        .sort((a, b) => b.citedBy.length - a.citedBy.length);
    const unknown = [...unknownByIdent.values()]
        .sort((a, b) => b.citedBy.length - a.citedBy.length);
    return {
        memberCount: units.length,
        resolved,
        suggested,
        capturable,
        unknown,
        summary: {
            total: resolved.length + suggested.length + capturable.length + unknown.length,
            resolved: resolved.length,
            suggested: suggested.length,
            capturable: capturable.length,
            unknown: unknown.length
        }
    };
}

/**
 * @param {HTMLElement} host
 * @param {object} params
 * @param {object} params.data      collectCaseDossierData output
 * @param {object} params.callbacks {onReloadCase()}
 */
export function renderReferencesBlock(host, { data, callbacks = {} }) {
    const caseId = data.case && data.case.id;
    if (!caseId) return;
    const block = el('div', 'xr-synth');
    host.appendChild(block);

    (async () => {
        const allUnits = await buildMemberUnits(data);
        const units = [];
        const seenHash = new Set();
        for (const u of allUnits) {
            if (seenHash.has(u.article_hash)) continue;
            seenHash.add(u.article_hash);
            units.push(u);
        }
        const archiveByUrl = new Map((data.articles || []).map((r) => [r.url, r]));
        const extractionByHash = new Map();
        for (const u of units) {
            const rec = await getArticleExtraction(u.article_hash).catch(() => null);
            if (rec) extractionByHash.set(u.article_hash, rec);
        }
        const aliasMap = await loadAliasMap().catch(() => ({}));
        const heal = (url) => resolveWithMap(aliasMap, url);

        const model = buildReferencesModel({
            units, archiveByUrl, auditRuns: data.auditRuns || [], extractionByHash, heal
        });
        if (model.summary.total === 0) { block.remove(); return; }

        block.appendChild(el('h3', 'xr-case__heading', 'Referenced sources — cited vs. held'));
        block.appendChild(el('p', 'xr-case__explainer',
            'Every source this corpus cites — links, reference lists, map-pass source '
            + 'references, audit-identified documents — resolved against what the case '
            + 'already holds. Identity matches are mechanical (url / alias / DOI); title '
            + 'matches are suggestions, never assertions. Missing-but-addressable sources '
            + 'import through the ordinary capture pipeline.'));
        block.appendChild(el('div', 'xr-synth__prov', [
            `${model.summary.total} cited source${model.summary.total === 1 ? '' : 's'} across ${model.memberCount} member${model.memberCount === 1 ? '' : 's'}`,
            `${model.summary.resolved} already held`,
            `${model.summary.suggested} suggested match${model.summary.suggested === 1 ? '' : 'es'}`,
            `${model.summary.capturable} capturable`,
            `${model.summary.unknown} unresolved mention${model.summary.unknown === 1 ? '' : 's'}`
        ].join(' · ')));

        const cites = (row) => row.citedBy.length === 1
            ? `cited by ${truncate(row.citedBy[0], 60)}`
            : `cited by ${row.citedBy.length} members`;

        if (model.capturable.length) {
            const sec = el('details', 'xr-synth__sec');
            sec.open = true;
            sec.appendChild(el('summary', null,
                `Missing but capturable (${model.capturable.length}) — the coverage frontier`));
            const status = el('div', 'xr-synth__status');
            const btn = el('button', 'xr-portal__btn',
                `Import ${model.capturable.length} missing source${model.capturable.length === 1 ? '' : 's'} into the case`);
            btn.type = 'button';
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                const urls = model.capturable.map((c) => c.captureUrl);
                let done = 0;
                status.textContent = `Importing 0/${urls.length}…`;
                try {
                    const rows = await importUrlList(urls, {
                        caseEntityId: caseId,
                        onProgress: (p) => {
                            if (p && (p.phase === 'done' || p.phase === 'failed')) {
                                done += 1;
                                status.textContent = `Importing ${done}/${urls.length}…`;
                            }
                        }
                    });
                    const captured = rows.filter((r) => r.status === 'imported' || r.status === 'thin').length;
                    const dup = rows.filter((r) => r.status === 'already-archived').length;
                    const pdf = rows.filter((r) => r.status === 'pdf').length;
                    const failed = rows.filter((r) => r.status === 'failed').length;
                    const bits = [`${captured} captured`];
                    if (dup) bits.push(`${dup} already archived (tagged into case)`);
                    if (pdf) bits.push(`${pdf} PDF (open in reader to capture)`);
                    if (failed) bits.push(`${failed} failed`);
                    status.textContent = bits.join(' · ');
                    if (typeof callbacks.onReloadCase === 'function') callbacks.onReloadCase();
                } catch (err) {
                    Utils.error('Reference import failed', err);
                    status.textContent = `Import failed: ${err.message || err}`;
                    btn.disabled = false;
                }
            });
            sec.appendChild(btn);
            sec.appendChild(status);
            const ul = el('ul', 'xr-list');
            for (const c of model.capturable.slice(0, MAX_ROWS)) {
                const li = el('li', 'xr-row');
                const head = el('div', 'xr-row__head');
                head.appendChild(el('span', 'xr-row__title', truncate(c.display, 100)));
                head.appendChild(el('span', 'xr-badge xr-badge--muted', c.origins.join(' + ')));
                head.appendChild(el('span', 'xr-badge xr-badge--muted', cites(c)));
                li.appendChild(head);
                li.title = c.captureUrl;
                ul.appendChild(li);
            }
            if (model.capturable.length > MAX_ROWS) {
                ul.appendChild(el('li', 'xr-inspector__mono',
                    `…and ${model.capturable.length - MAX_ROWS} more`));
            }
            sec.appendChild(ul);
            block.appendChild(sec);
        }

        if (model.unknown.length) {
            const sec = el('details', 'xr-synth__sec');
            sec.appendChild(el('summary', null,
                `Unresolved mentions (${model.unknown.length}) — cited without an address`));
            const ul = el('ul', 'xr-list');
            for (const c of model.unknown.slice(0, MAX_ROWS)) {
                const li = el('li', 'xr-row');
                const head = el('div', 'xr-row__head');
                head.appendChild(el('span', 'xr-row__title', truncate(c.display, 100)));
                head.appendChild(el('span', 'xr-badge xr-badge--muted', c.origins.join(' + ')));
                head.appendChild(el('span', 'xr-badge xr-badge--muted', cites(c)));
                li.appendChild(head);
                if (c.quote) li.title = c.quote;
                ul.appendChild(li);
            }
            if (model.unknown.length > MAX_ROWS) {
                ul.appendChild(el('li', 'xr-inspector__mono',
                    `…and ${model.unknown.length - MAX_ROWS} more`));
            }
            sec.appendChild(ul);
            block.appendChild(sec);
        }

        if (model.resolved.length) {
            const sec = el('details', 'xr-synth__sec');
            sec.appendChild(el('summary', null,
                `Already held (${model.resolved.length}) — cited sources that are corpus members`));
            const ul = el('ul', 'xr-list');
            for (const r of model.resolved.slice(0, MAX_ROWS)) {
                const li = el('li', 'xr-row');
                const head = el('div', 'xr-row__head');
                head.appendChild(el('span', 'xr-row__title',
                    `${truncate(r.citedBy, 50)} → ${truncate((r.member && r.member.title) || (r.member && r.member.url) || '', 60)}`));
                head.appendChild(el('span', 'xr-badge xr-badge--muted', `match: ${r.match}`));
                li.appendChild(head);
                ul.appendChild(li);
            }
            if (model.resolved.length > MAX_ROWS) {
                ul.appendChild(el('li', 'xr-inspector__mono',
                    `…and ${model.resolved.length - MAX_ROWS} more`));
            }
            sec.appendChild(ul);
            block.appendChild(sec);
        }

        if (model.suggested.length) {
            const sec = el('details', 'xr-synth__sec');
            sec.appendChild(el('summary', null,
                `Possible matches (${model.suggested.length}) — title similarity, suggestion only`));
            const ul = el('ul', 'xr-list');
            for (const r of model.suggested.slice(0, MAX_ROWS)) {
                const li = el('li', 'xr-row');
                const head = el('div', 'xr-row__head');
                head.appendChild(el('span', 'xr-row__title',
                    `${truncate(r.display, 60)} ≈ ${truncate((r.member && r.member.title) || '', 60)}`));
                head.appendChild(el('span', 'xr-badge xr-badge--muted', `title F1 ${r.score}`));
                head.appendChild(el('span', 'xr-badge xr-badge--muted', cites(r)));
                li.appendChild(head);
                ul.appendChild(li);
            }
            if (model.suggested.length > MAX_ROWS) {
                ul.appendChild(el('li', 'xr-inspector__mono',
                    `…and ${model.suggested.length - MAX_ROWS} more`));
            }
            sec.appendChild(ul);
            block.appendChild(sec);
        }
    })().catch((err) => {
        Utils.error('References block render failed', err);
        block.remove();
    });
}

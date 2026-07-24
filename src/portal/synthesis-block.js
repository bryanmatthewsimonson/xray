// Case-corpus synthesis block — Phase 20.4
// (docs/CASE_SYNTHESIS_DESIGN.md). The portal case-dashboard surface
// that runs the LLM map/reduce over a case's member articles and
// renders the grounded brief + reviewable proposals. Gated by
// `caseSynthesis` + `llmAssist` + key (via xray:llm:corpus-config):
// flag off ⇒ block absent; on-but-keyless ⇒ disabled with an Options
// hint. The brief is stored in the precious audit DB (case-briefs) and
// re-rendered on open with a stale chip when the corpus has changed.
//
// The map stage uses orchestrateModuleRuns (the audit-module bounded
// pool) with member ids as the unit list; the reduce is one call. Every
// quote is grounded against the same member texts the map used, drops
// disclosed. No fused score, no verdict — the brief renders BESIDE the
// deterministic dossier, never above it.

import { el, truncate } from './dom.js';
import { Utils } from '../shared/utils.js';
import { AssessmentModel } from '../shared/assessment-model.js';
import { orchestrateModuleRuns } from '../shared/audit/run-orchestrator.js';
import { getCaseBrief, saveCaseBrief, getCorpusExtract, saveCorpusExtract } from '../shared/audit/audit-cache.js';
import { createGroundingIndex } from '../shared/quote-grounding.js';
import { CORPUS_PROMPT_VERSION } from '../shared/corpus-prompts.js';
import {
    buildMemberUnits, corpusInputHash, corpusExtractKey, corpusMapRequest, digestDossier,
    linkAssertionsToClaims, validateCorpusExtract, validateCaseBrief, groundCaseBrief,
    filterProposals, computeEntitySummary, foldMemberAliases
} from '../shared/case-synthesis.js';
import { renderProposals } from './synthesis-review.js';
import { recordArticleExtraction } from '../shared/map-artifacts.js';
import { Signer } from '../shared/signer.js';
import { Storage } from '../shared/storage.js';
import { Crypto } from '../shared/crypto.js';
import { FALLBACK_RELAYS } from './corpus.js';
import {
    buildCaseBriefArticle, buildCaseBriefEvent, renderCaseBriefMarkdown,
    citedMemberOrder, outletFor, matchCoverageGapsToPositions
} from '../shared/corpus-publish.js';
import { canonicalIdOf } from '../shared/entity-model.js';
import { corpusAuditRollup } from '../shared/audit/corpus-rollup.js';
import { deriveArticleRows } from '../shared/case-dossier.js';

/** A source link for a member article_hash, or null when unresolved. */
function sourceAnchor(hash, memberIndex) {
    const m = (memberIndex || {})[hash];
    if (!m || !m.url) return null;
    const a = el('a', 'xr-synth__src', m.title || m.url);
    a.href = m.url;
    a.target = '_blank';
    a.rel = 'noreferrer noopener';
    a.title = m.url;
    return a;
}

/**
 * A compact numbered citation "[N]" linking to its source — the readable
 * stand-in for a position's holder list (dozens of full titles collapse
 * to numbers, resolved by the Sources section). `hash` is always a
 * resolvable member (from citedMemberOrder), so the URL is present.
 */
function citationLink(num, hash, memberIndex) {
    const m = (memberIndex || {})[hash] || {};
    const a = el('a', 'xr-synth__cite', `[${num}]`);
    if (m.url) {
        a.href = m.url;
        a.target = '_blank';
        a.rel = 'noreferrer noopener';
        a.title = m.title || m.url;
    }
    return a;
}

/** Trigger a local file download (no network; extension page, no CSP). */
function downloadFile(filename, text, mime) {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick so the click has consumed the URL.
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Filesystem-safe slug from the case name for download filenames. */
function fileSlug(name) {
    return String(name || 'case').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'case';
}

async function resolveRelays() {
    try {
        const prefs = await Storage.preferences.get() || {};
        if (Array.isArray(prefs.default_relays) && prefs.default_relays.length) return prefs.default_relays;
    } catch (_) { /* fall through */ }
    return FALLBACK_RELAYS;
}

function sendMessage(msg) {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage(msg, (resp) => {
                // A torn-down service worker fires the callback with no
                // response and sets lastError ("The message port closed
                // before a response was received."). Surface it as a real
                // error rather than a bare undefined that every caller
                // flattens to the opaque "no response".
                const err = chrome.runtime.lastError;
                if (err) { resolve({ ok: false, error: err.message, swLost: true }); return; }
                resolve(resp);
            });
        } catch (_) { resolve(null); }
    });
}

// The reduce is the ONE long single fetch in a synthesis run: after the
// last map message lands, nothing messages the service worker for the
// minutes the reduce takes, so the MV3 idle timer is never reset and the
// SW is torn down mid-fetch — the "no response" failure. Pinging a
// zero-cost handler every 20s resets that timer for the duration (the
// mechanism the reader's single-shot audit relies on, index.js
// startSwKeepalive). The map phase already messages frequently, but the
// keepalive spans the whole run so a slow tail map call is covered too.
const SW_KEEPALIVE_MS = 20000;
function startSwKeepalive() {
    const timer = setInterval(() => {
        // Callback form (the portal's convention) — works on both Chrome
        // and Firefox; read lastError so a mid-restart ping doesn't log an
        // unchecked-error warning. Fire-and-forget: the response is unused.
        try {
            chrome.runtime.sendMessage({ type: 'xray:llm:corpus-config' }, () => {
                void chrome.runtime.lastError;
            });
        } catch (_) { /* SW restarting — the next ping lands */ }
    }, SW_KEEPALIVE_MS);
    return { stop: () => clearInterval(timer) };
}

/** A source's publication date as a sortable ISO day (YYYY-MM-DD), or ''.
 * From the captured article metadata (date / publishedTime) — NOT the
 * capture time. ISO days sort lexically = chronologically. */
function fmtSourceDate(article) {
    const raw = (article && (article.date || article.publishedTime)) || '';
    if (!raw) return '';
    const t = Date.parse(raw);
    if (!Number.isFinite(t)) return '';
    return new Date(t).toISOString().slice(0, 10);
}

// Render provenance already present in the brief but hidden by the
// dashboard until Phase-26 prep (T1.2): every crux quote, load-bearing
// claim, and position holder links back to its source article + a
// machine-grounded quote. `memberIndex` = article_hash → {url,title,date,entities};
// `claimsById` resolves an optional load-bearing claim_ref best-effort.
function section(brief, { memberIndex = {}, claimsById = {}, entitySummary = null } = {}) {
    const wrap = el('div', 'xr-synth__brief');
    // Citation numbering — the SAME order the exported/published markdown
    // uses (corpus-publish.citedMemberOrder), so [N] means one source
    // across the on-screen brief, the .md, and the 30023 article.
    const citedOrder = citedMemberOrder(brief, memberIndex);
    const citeNum = new Map(citedOrder.map((h, i) => [h, i + 1]));
    if (brief.summary) {
        const s = el('details', 'xr-synth__sec'); s.open = true;
        s.appendChild(el('summary', null, 'Summary'));
        s.appendChild(el('p', 'xr-synth__text', brief.summary));
        wrap.appendChild(s);
    }
    // Coverage-gap findings that name exactly one position render beside
    // that position (P5/P8) — pure placement of existing brief data.
    const gapsByPosition = matchCoverageGapsToPositions(brief);
    if ((brief.positions || []).length) {
        const s = el('details', 'xr-synth__sec'); s.open = true;
        s.appendChild(el('summary', null, `Positions (${brief.positions.length})`));
        brief.positions.forEach((p, pi) => {
            const d = el('div', 'xr-synth__pos');
            d.appendChild(el('span', 'xr-badge', p.label || 'position'));
            if (p.core_argument) d.appendChild(el('span', 'xr-synth__text', p.core_argument));
            // Holders as compact numbered citations (they run to dozens);
            // the Sources section below resolves each. Sorted ascending.
            const nums = (p.holders || []).map((h) => citeNum.get(h.article_hash))
                .filter((num) => num != null).sort((x, y) => x - y);
            if (nums.length) {
                const row = el('div', 'xr-synth__prov-row');
                row.appendChild(el('span', 'xr-synth__prov-label', 'Held by:'));
                nums.forEach((num, i) => {
                    if (i) row.appendChild(document.createTextNode(' '));
                    row.appendChild(citationLink(num, citedOrder[num - 1], memberIndex));
                });
                d.appendChild(row);
            }
            for (const gap of gapsByPosition.byPosition[pi]) {
                d.appendChild(el('div', 'xr-synth__gapnote', `Coverage note: ${gap}`));
            }
            s.appendChild(d);
        });
        wrap.appendChild(s);
    }
    if ((brief.cruxes || []).length) {
        const s = el('details', 'xr-synth__sec'); s.open = true;
        s.appendChild(el('summary', null, `Cruxes of disagreement (${brief.cruxes.length})`));
        for (const c of brief.cruxes) {
            const d = el('div', 'xr-synth__crux');
            d.appendChild(el('div', 'xr-synth__crux-q', c.question || ''));
            for (const side of c.sides || []) {
                const sd = el('div', 'xr-synth__side');
                if (side.position_label) sd.appendChild(el('span', 'xr-badge xr-badge--muted', side.position_label));
                sd.appendChild(el('span', 'xr-synth__text', side.view || ''));
                d.appendChild(sd);
            }
            for (const ev of c.evidence_refs || []) {
                if (!ev || !ev.quote) continue;
                const q = el('blockquote', 'xr-finding-row__quote', truncate(ev.quote, 200));
                const src = sourceAnchor(ev.article_hash, memberIndex);
                if (src) { const cite = el('div', 'xr-synth__prov-row'); cite.appendChild(el('span', 'xr-synth__prov-label', '— ')); cite.appendChild(src); q.appendChild(cite); }
                d.appendChild(q);
            }
            if (c.what_would_resolve) d.appendChild(el('div', 'xr-synth__resolve', `Would resolve: ${c.what_would_resolve}`));
            s.appendChild(d);
        }
        wrap.appendChild(s);
    }
    if ((brief.load_bearing || []).length) {
        const s = el('details', 'xr-synth__sec');
        s.appendChild(el('summary', null, `Load-bearing claims (${brief.load_bearing.length})`));
        for (const lb of brief.load_bearing) {
            const d = el('div', 'xr-synth__lb');
            d.appendChild(el('blockquote', 'xr-finding-row__quote', truncate(lb.quote || '', 200)));
            if (lb.why) d.appendChild(el('span', 'xr-synth__text', lb.why));
            const prov = el('div', 'xr-synth__prov-row');
            const src = sourceAnchor(lb.article_hash, memberIndex);
            if (src) { prov.appendChild(el('span', 'xr-synth__prov-label', 'Source:')); prov.appendChild(src); }
            // Best-effort: if the model tied this to an existing captured
            // claim id, confirm it by showing that claim's text. We never
            // fabricate a link when the ref doesn't resolve.
            const claim = lb.claim_ref && claimsById[lb.claim_ref];
            if (claim && claim.text) {
                if (src) prov.appendChild(document.createTextNode(' · '));
                prov.appendChild(el('span', 'xr-synth__prov-label', 'Claim:'));
                prov.appendChild(el('span', 'xr-synth__text', truncate(claim.text, 120)));
            }
            if (prov.childNodes.length) d.appendChild(prov);
            s.appendChild(d);
        }
        wrap.appendChild(s);
    }
    if ((brief.coverage_gaps || []).length) {
        const s = el('details', 'xr-synth__sec');
        s.appendChild(el('summary', null, `Coverage gaps (${brief.coverage_gaps.length})`));
        const moved = gapsByPosition.byPosition.reduce((a, g) => a + g.length, 0);
        if (moved) {
            s.appendChild(el('div', 'xr-synth__gapnote',
                `${moved} position-specific note${moved === 1 ? ' is' : 's are'} shown beside`
                + ` the position${moved === 1 ? ' it qualifies' : 's they qualify'} under Positions above.`));
        }
        if (gapsByPosition.general.length) {
            const ul = el('ul', 'xr-list');
            for (const g of gapsByPosition.general) ul.appendChild(el('li', 'xr-synth__text', g));
            s.appendChild(ul);
        }
        wrap.appendChild(s);
    }
    // Sources — the list the [N] citations resolve to, annotated with
    // outlet + date and re-sortable (by number / date / outlet) so the
    // reader can organize the corpus by source or date. Rows carry their
    // citation number explicitly, so re-sorting never renumbers.
    if (citedOrder.length) {
        const s = el('details', 'xr-synth__sec');
        s.appendChild(el('summary', null, `Sources (${citedOrder.length})`));
        const rows = citedOrder.map((h, i) => ({ hash: h, num: i + 1, m: memberIndex[h] || {} }));
        const comparators = {
            num: (a, b) => a.num - b.num,
            // newest first; undated sink to the bottom (empty string sorts first asc → invert).
            date: (a, b) => (b.m.date || '').localeCompare(a.m.date || '') || a.num - b.num,
            outlet: (a, b) => outletFor(a.m.url).localeCompare(outletFor(b.m.url)) || a.num - b.num
        };
        const listHost = el('div', 'xr-synth__srclist');
        const paint = (key) => {
            listHost.replaceChildren();
            for (const r of rows.slice().sort(comparators[key] || comparators.num)) {
                const row = el('div', 'xr-synth__srcrow');
                row.appendChild(citationLink(r.num, r.hash, memberIndex));
                const a = el('a', 'xr-synth__src', r.m.title || r.m.url || r.hash);
                if (r.m.url) { a.href = r.m.url; a.target = '_blank'; a.rel = 'noreferrer noopener'; a.title = r.m.url; }
                row.appendChild(a);
                const meta = [outletFor(r.m.url), r.m.date].filter(Boolean).join(' · ');
                if (meta) row.appendChild(el('span', 'xr-synth__srcmeta', ` — ${meta}`));
                listHost.appendChild(row);
                // Same-content captures nest under their canonical entry:
                // one artifact, several capture URLs — never several sources.
                for (const alias of r.m.aliases || []) {
                    if (!alias || !alias.url) continue;
                    const arow = el('div', 'xr-synth__srcrow xr-synth__srcrow--alias');
                    arow.appendChild(el('span', 'xr-synth__srcmeta', 'also captured at '));
                    const al = el('a', 'xr-synth__src', alias.title || alias.url);
                    al.href = alias.url; al.target = '_blank'; al.rel = 'noreferrer noopener'; al.title = alias.url;
                    arow.appendChild(al);
                    arow.appendChild(el('span', 'xr-synth__srcmeta', ' — identical canonical content (same artifact)'));
                    listHost.appendChild(arow);
                }
            }
        };
        const bar = el('div', 'xr-synth__srcsort');
        bar.appendChild(el('span', 'xr-synth__prov-label', 'Sort:'));
        const btns = [];
        for (const [key, label] of [['num', '#'], ['date', 'Date'], ['outlet', 'Outlet']]) {
            const b = el('button', 'xr-synth__sortbtn', label);
            b.type = 'button';
            if (key === 'num') b.classList.add('is-active');
            b.addEventListener('click', () => {
                for (const other of btns) other.classList.toggle('is-active', other === b);
                paint(key);
            });
            btns.push(b);
            bar.appendChild(b);
        }
        s.appendChild(bar);
        s.appendChild(listHost);
        paint('num');
        wrap.appendChild(s);
    }

    // People / Organizations — the tagged canonical entities (aliases
    // folded), each with claim + source counts and clickable source refs:
    // the "organize by entity" index. Cases/things omitted. An appendix,
    // not a finding (P2/P5): counts are navigation, never weight, and
    // 0-claim rows are dropped from the render.
    if (entitySummary) {
        const withClaims = (list) => (Array.isArray(list) ? list.filter((e) => e && (e.claimCount || 0) > 0) : []);
        const people = withClaims(entitySummary.people);
        const orgs = withClaims(entitySummary.orgs);
        if (people.length || orgs.length) {
            wrap.appendChild(el('div', 'xr-synth__entcaption',
                'Entity claim counts are provenance and navigation aids — not weight, importance, or credibility.'));
        }
        const entSection = (title, list) => {
            if (!Array.isArray(list) || !list.length) return;
            const s = el('details', 'xr-synth__sec');
            s.appendChild(el('summary', null, `${title} (${list.length})`));
            const ul = el('ul', 'xr-synth__entlist');
            for (const e of list) {
                const nums = (e.sourceHashes || []).map((h) => citeNum.get(h))
                    .filter((num) => num != null).sort((x, y) => x - y);
                const li = el('li');
                li.appendChild(el('span', 'xr-synth__entname', e.name || '(unnamed)'));
                const count = e.claimCount || 0;
                const bits = [`${count} claim${count === 1 ? '' : 's'}`];
                if (nums.length) bits.push(`in ${nums.length} source${nums.length === 1 ? '' : 's'}`);
                li.appendChild(el('span', 'xr-synth__entmeta', ` — ${bits.join(' · ')}`));
                if (nums.length) {
                    const refs = el('span', 'xr-synth__entrefs');
                    refs.appendChild(document.createTextNode(': '));
                    nums.forEach((num, i) => {
                        if (i) refs.appendChild(document.createTextNode(' '));
                        refs.appendChild(citationLink(num, citedOrder[num - 1], memberIndex));
                    });
                    li.appendChild(refs);
                }
                ul.appendChild(li);
            }
            s.appendChild(ul);
            wrap.appendChild(s);
        };
        entSection('Appendix — People', people);
        entSection('Appendix — Organizations', orgs);
    }
    return wrap;
}

/**
 * @param {HTMLElement} host
 * @param {object} params
 * @param {object} params.data      collectCaseDossierData output (carries entitiesById/articles)
 * @param {object} params.dossier   buildCaseDossier output (for the digest + coverage)
 * @param {object} params.callbacks {onReloadCase(), onAnalysisState(running, token), isCurrentRun(token)}
 *   — onAnalysisState marks the run's boundaries so background renders
 *   defer; isCurrentRun lets the run skip its persist/paint tail if it
 *   was abandoned (user navigated away / started a newer run).
 */
export function renderSynthesisBlock(host, { data, dossier, callbacks = {} }) {
    const caseId = data.case && data.case.id;
    if (!caseId) return;
    const block = el('div', 'xr-synth');
    host.appendChild(block);

    (async () => {
        const cfg = await sendMessage({ type: 'xray:llm:corpus-config' });
        if (!cfg || !cfg.enabled) { block.remove(); return; }   // flag off ⇒ no surface

        block.appendChild(el('h3', 'xr-case__heading', 'Corpus synthesis — grounded brief, not a verdict'));
        const controls = el('div', 'xr-synth__controls');
        const runBtn = el('button', 'xr-portal__btn', 'Analyze corpus…');
        runBtn.type = 'button';
        // 28.x — prepay the expensive per-article pass: run ONLY the map
        // stage now and cache the extracts, so the eventual Analyze pays
        // just the one synthesis call. Same requests, same cache.
        const preBtn = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Pre-analyze…');
        preBtn.type = 'button';
        preBtn.title = 'Run only the per-article pass now and cache it — a later "Analyze corpus…" '
            + 'reuses every cached article and pays just the synthesis call. Already-cached members are skipped.';
        if (!cfg.hasKey) {
            runBtn.disabled = true;
            runBtn.title = 'Set an Anthropic API key in Options → Advanced → LLM assist';
            preBtn.disabled = true;
            preBtn.title = runBtn.title;
        }
        controls.appendChild(runBtn);
        controls.appendChild(preBtn);
        const status = el('span', 'xr-synth__status');
        controls.appendChild(status);
        block.appendChild(controls);

        const briefHost = el('div');
        const proposalHost = el('div');
        block.appendChild(briefHost);
        block.appendChild(proposalHost);

        // Assemble member units + the live input hash (for staleness).
        const assessAll = await AssessmentModel.getAll();
        const assessmentsByClaim = {};
        for (const a of Object.values(assessAll)) {
            const cid = a && a.claim_ref && a.claim_ref.claim_id;
            if (cid && typeof a.stance === 'number') assessmentsByClaim[cid] = a.stance;
        }
        const members = await buildMemberUnits(data, { assessmentsByClaim });
        // Staleness must track the ACTUAL claim set sent — the
        // member-article claims joined by URL in buildMemberUnits — not
        // the orbit's about-the-case subset, or adding/removing a claim
        // on a member would never invalidate the stored brief.
        const memberClaimIds = members.flatMap((m) => m.claims.map((c) => c.id));
        const liveHash = await corpusInputHash(members, memberClaimIds);

        const claimsById = {};
        // The claim index handed to the reduce stage — id + text +
        // the member article it came from. Same set claimsById accepts,
        // so an id the model pulls from here always validates (20.6).
        const claimIndex = [];
        for (const m of members) {
            for (const c of m.claims) {
                claimsById[c.id] = c;
                claimIndex.push({ id: c.id, text: c.text, article_hash: m.article_hash, is_key: !!c.is_key });
            }
        }
        // Enrich the member index with the appendix metadata: publication
        // date and the canonical entities tagged on the source (aliases
        // folded). Reads the archive record by url; entity refs resolve to
        // their canonical {id,name,type}. None of this touches the LLM map
        // input or its cache — it's presentation only.
        const recByUrl = new Map();
        for (const rec of data.articles || []) if (rec && rec.url) recByUrl.set(rec.url, rec);
        const entitiesById = data.entitiesById || {};
        const canonEnt = (id) => {
            const cid = canonicalIdOf(id, entitiesById);
            const e = entitiesById[cid];
            return e ? { id: cid, name: e.name || '(unnamed)', type: e.type || 'thing' } : null;
        };
        // Same-content captures (identical article_hash — e.g. the
        // view-URL and download-URL of one Drive PDF) fold to one entry
        // with the extra capture URLs as aliases, so N captures of one
        // artifact never render as N sources (P4/P9).
        const memberByHash = {};
        for (const { member: m, aliases } of foldMemberAliases(members).values()) {
            const art = (recByUrl.get(m.url) || {}).article || null;
            const ents = [];
            const seen = new Set();
            for (const ref of (art && art.entities) || []) {
                const c = canonEnt(ref.entity_id);
                if (c && !seen.has(c.id)) { seen.add(c.id); ents.push(c); }
            }
            memberByHash[m.article_hash] = {
                url: m.url, title: m.title, caseId, date: fmtSourceDate(art), entities: ents, aliases
            };
        }
        const entitySummary = computeEntitySummary(data, memberByHash);
        const memberHashes = new Set(members.map((m) => m.article_hash));

        // Hoisted for BOTH LLM passes (Analyze and Pre-analyze): the
        // case frame, the member lookup, the cache plan, and the map
        // stage itself. Requests come from corpusMapRequest — the ONE
        // builder both paths share, so a pre-analyzed extract's cache
        // key can never drift from the key Analyze later computes.
        const caseName = data.case.name || '';
        const scopeQuestion = (dossier.scope && dossier.scope.question) || '';
        const unitById = {};
        for (const m of members) unitById[m.article_hash] = m;
        const reqOf = (m) => corpusMapRequest(m, { caseName, scopeQuestion });

        // The cache plan: every member's cache key, the valid hits, and
        // what an LLM pass would actually send.
        const mapPlan = async () => {
            const keyByHash = {};
            const cachedByHash = {};
            for (const m of members) {
                const key = await corpusExtractKey(reqOf(m));
                keyByHash[m.article_hash] = key;
                const hit = await getCorpusExtract(key).catch(() => null);
                if (hit && hit.extract && validateCorpusExtract(hit.extract).ok) cachedByHash[m.article_hash] = hit;
            }
            return { keyByHash, cachedByHash, toSend: members.filter((m) => !cachedByHash[m.article_hash]) };
        };

        // The map stage over ALL members: a cached member short-circuits
        // with no LLM call; a miss calls and persists the extract keyed
        // by its input fingerprint. Bounded pool (the audit-module
        // pattern).
        const runMapStage = async (plan, onProgress) => {
            const { keyByHash, cachedByHash } = plan;
            return await orchestrateModuleRuns({
                moduleNames: members.map((m) => m.article_hash),
                concurrency: 2,
                onProgress,
                send: async (id) => {
                    // MA.1: every extract — cached or fresh — also folds into
                    // the durable per-article record. Never rejects; a hit's
                    // fold is O(1) once its fingerprint is in merged_keys, and
                    // hit-folding backfills records for extracts prepaid
                    // before the artifact layer existed.
                    const fold = (extract, model) => recordArticleExtraction({
                        member: unitById[id], extract, model,
                        frame: { caseName, scopeQuestion }, key: keyByHash[id]
                    });
                    const cached = cachedByHash[id];
                    if (cached) {
                        fold(cached.extract, cached.model);
                        return { ok: true, findings: cached.extract, model: cached.model };
                    }
                    const res = await sendMessage({ type: 'xray:llm:corpus-map', request: reqOf(unitById[id]) });
                    if (!res || !res.ok) return { ...(res || {}), ok: false };
                    const v = validateCorpusExtract(res.extract);
                    if (!v.ok) return { ok: false, error: 'invalid extract' };
                    saveCorpusExtract({ key: keyByHash[id], extract: res.extract, model: res.model, cachedAt: Math.floor(Date.now() / 1000) })
                        .catch((err) => Utils.error('saveCorpusExtract failed', err));
                    fold(res.extract, res.model);
                    return { ok: true, findings: res.extract, model: res.model };
                }
            });
        };

        // Publish the brief as a readable kind-30023 article + the
        // structured kind-30068 CaseBrief (23.2b). User-signed (the
        // primary identity — the user's synthesis), both cross-linked.
        const publishBrief = async (record, btn, pubStatus) => {
            btn.disabled = true;
            pubStatus.textContent = 'Publishing…';
            try {
                const relays = await resolveRelays();
                if (!relays.length) { pubStatus.textContent = 'No relays configured.'; btn.disabled = false; return; }
                const userPubkey = await Signer.getPublicKey();
                if (!userPubkey) { pubStatus.textContent = 'No signing identity — set one in Options.'; btn.disabled = false; return; }
                const opts = {
                    record,
                    caseName: data.case.name || '',
                    scopeQuestion: (dossier.scope && dossier.scope.question) || '',
                    memberIndex: memberByHash,
                    entitySummary,
                    userPubkey
                };
                const article = buildCaseBriefArticle(opts);
                const structured = buildCaseBriefEvent(opts);
                let ok = 0;
                for (const unsigned of [article, structured]) {
                    const signed = await Signer.signEvent({ ...unsigned, pubkey: userPubkey });
                    const resp = await sendMessage({ type: 'xray:relay:publish', event: signed, relays });
                    if (resp && resp.ok) ok += 1;
                    else Utils.error('brief publish failed', resp && resp.error);
                }
                pubStatus.textContent = ok === 2
                    ? 'Published — the article is readable in any NOSTR client.'
                    : ok === 1 ? 'Partly published (one artifact failed) — see console.'
                    : 'Publish failed — see console.';
            } catch (err) {
                Utils.error('publishBrief', err);
                pubStatus.textContent = `Publish failed: ${(err && err.message) || 'unknown error'}`;
            } finally {
                btn.disabled = false;
            }
        };

        const renderStored = (record) => {
            briefHost.replaceChildren();
            proposalHost.replaceChildren();
            if (!record || !record.brief) return;
            const g = record.grounding || { checked: 0, dropped: 0 };
            const stale = record.inputHash && record.inputHash !== liveHash;
            // Members line discloses a partial run on its face (P6):
            // "141/147 members analyzed" when some failed, else just the
            // count — matches the exported/published brief's coverage note.
            const totalMembers = record.members != null ? record.members : members.length;
            const membersLabel = (Number.isFinite(record.analyzed) && record.analyzed < totalMembers)
                ? `${record.analyzed}/${totalMembers} members analyzed`
                : `${totalMembers} members`;
            const prov = el('div', 'xr-synth__prov',
                `${record.model || 'model'} · ${record.promptVersion || CORPUS_PROMPT_VERSION} · `
                + `${g.checked} quote${g.checked === 1 ? '' : 's'} checked, ${g.dropped} dropped · `
                + membersLabel);
            if (stale) {
                const chip = el('span', 'xr-badge xr-badge--warn', 'stale — corpus changed since this brief');
                prov.appendChild(chip);
            }
            briefHost.appendChild(prov);

            // Publish the brief so a stranger with a keypair can read it
            // (23.2b). A readable 30023 article + the structured 30068.
            const pubRow = el('div', 'xr-synth__publish');
            const pubBtn = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Publish brief…');
            pubBtn.type = 'button';
            pubBtn.title = 'Publish this brief to your relays — a readable article any NOSTR client can open, plus the structured X-Ray form';
            const pubStatus = el('span', 'xr-synth__status');
            pubBtn.addEventListener('click', () => publishBrief(record, pubBtn, pubStatus));
            pubRow.appendChild(pubBtn);

            // Download the brief locally — the same readable markdown the
            // publish path emits, plus the raw JSON record. No network,
            // no relays; the analysis is expensive to generate and should
            // be keepable off-device (T1.1).
            const caseName = data.case.name || '';
            const scopeQuestion = (dossier.scope && dossier.scope.question) || '';
            const mdBtn = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Download .md');
            mdBtn.type = 'button';
            mdBtn.title = 'Download the brief as a readable Markdown file (quotes linked to their sources)';
            mdBtn.addEventListener('click', async () => {
                // Self-locating header (P12): the exported file names the
                // publishing identity + relays and how to query the event
                // graph it renders. Unresolvable values still render — as
                // visible placeholders, never a silent omission (P6/P12).
                let pubkeyHex = null;
                try { pubkeyHex = await Signer.getPublicKey(); } catch (_) { /* placeholder renders */ }
                let npub = null;
                if (pubkeyHex) {
                    try { npub = Crypto.hexToNpub(pubkeyHex); } catch (_) { /* hex still renders */ }
                }
                let relays = [];
                try { relays = await resolveRelays(); } catch (_) { /* placeholder renders */ }
                const md = renderCaseBriefMarkdown(record.brief, {
                    caseName, scopeQuestion, memberCount: record.members, memberIndex: memberByHash, entitySummary,
                    provenance: { npub, pubkeyHex, relays },
                    coverage: { analyzed: record.analyzed, failed: record.failed }
                });
                downloadFile(`case-brief-${fileSlug(caseName)}.md`, md, 'text/markdown');
            });
            const jsonBtn = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Download .json');
            jsonBtn.type = 'button';
            jsonBtn.title = 'Download the full stored brief record (brief + grounding + provenance) as JSON';
            jsonBtn.addEventListener('click', () => {
                downloadFile(`case-brief-${fileSlug(caseName)}.json`, JSON.stringify(record, null, 2), 'application/json');
            });
            pubRow.appendChild(mdBtn);
            pubRow.appendChild(jsonBtn);
            pubRow.appendChild(pubStatus);
            briefHost.appendChild(pubRow);

            briefHost.appendChild(section(record.brief, { memberIndex: memberByHash, claimsById, entitySummary }));
            const filtered = filterProposals(record.brief, { claimsById, memberHashes });
            renderProposals(proposalHost, {
                acceptable: filtered.acceptable, rejected: filtered.rejected,
                claimsById, memberByHash, model: record.model,
                // 27 S.3 — triage survives reopen: statuses persist on
                // the brief record, keyed by proposalKey.
                triage: record.triage || {},
                onTriage: async (key, status) => {
                    record.triage = { ...(record.triage || {}), [key]: status };
                    await saveCaseBrief(record);
                }
                // No onChanged: accepting updates the row in place and
                // persists through the model firewalls; a full re-render
                // per Accept reset the scroll (jumped to the bottom).
                // The case view folds accepted items in on the next Refresh.
            });
        };

        const existing = await getCaseBrief(caseId);
        if (existing) renderStored(existing);

        // Pre-analyze: the map stage alone. No brief is written and no
        // reduce is spent — the extracts land in the same cache the
        // Analyze run checks first.
        preBtn.addEventListener('click', async () => {
            if (members.length === 0) { status.textContent = 'No archived member articles to pre-analyze.'; return; }
            preBtn.disabled = true;
            runBtn.disabled = true;
            // Own the case-view DOM while running (same reason as the
            // full run: a background re-render would tear this block out
            // mid-pass) and keep the SW awake for slow tail calls.
            const runToken = {};
            const setAnalysis = (v) => {
                if (callbacks && typeof callbacks.onAnalysisState === 'function') callbacks.onAnalysisState(v, runToken);
            };
            setAnalysis(true);
            const keepalive = startSwKeepalive();
            try {
                status.textContent = 'Checking cache…';
                const plan = await mapPlan();
                const toSend = plan.toSend;
                const cachedCount = members.length - toSend.length;
                if (toSend.length === 0) {
                    status.textContent = `All ${members.length} member${members.length === 1 ? '' : 's'} already cached — `
                        + '"Analyze corpus…" will only pay the synthesis call.';
                    return;
                }
                const approxChars = toSend.reduce((a, m) => a + m.text.length, 0);
                if (!confirm('Pre-analyze this corpus?\n\n'
                    + (cachedCount ? `${cachedCount} of ${members.length} article${members.length === 1 ? '' : 's'} already cached — skipped.\n` : '')
                    + `This sends ${toSend.length} article${toSend.length === 1 ? '' : 's'} `
                    + `(~${Math.round(approxChars / 1000)}k characters) to Anthropic and caches the per-article extracts.\n`
                    + 'No brief is written — run "Analyze corpus…" later; it will reuse every cached extract.')) {
                    status.textContent = '';
                    return;
                }
                status.textContent = `Pre-analyzing 0/${members.length} articles…`;
                const { failures } = await runMapStage(plan, (p) => {
                    if (p.phase === 'done') status.textContent = `Pre-analyzing ${p.okCount}/${p.total} articles…`;
                });
                const okCount = toSend.length - failures.length;
                status.textContent = `Pre-analyzed ${okCount} member${okCount === 1 ? '' : 's'}`
                    + (cachedCount ? ` (${cachedCount} already cached)` : '')
                    + (failures.length ? `; ${failures.length} failed — failures are not cached, retry later` : '')
                    + '. "Analyze corpus…" now only pays the synthesis call.';
            } catch (err) {
                Utils.error('Pre-analyze failed', err);
                status.textContent = `Pre-analyze failed: ${(err && err.message) || 'unknown error'}`;
            } finally {
                keepalive.stop();
                preBtn.disabled = false;
                runBtn.disabled = false;
                setAnalysis(false);
            }
        });

        runBtn.addEventListener('click', async () => {
            if (members.length === 0) { status.textContent = 'No archived member articles to analyze.'; return; }
            runBtn.disabled = true;
            preBtn.disabled = true;

            // Own the case-view DOM for the WHOLE run: tell the portal to
            // defer background re-renders (a relay refresh or an async
            // enrichment landing mid-run would otherwise tear this block
            // out of the tree and orphan the analysis — it kept writing to
            // detached nodes, so it looked like it "stopped" while the
            // scroll jumped to the bottom). Released in the finally on
            // EVERY exit path (cancel, error, success). A per-run token
            // scopes ownership so that if the user navigates away and
            // starts a NEW run, THIS (now-abandoned) run's finally cannot
            // clear or flush the guard out from under the new one.
            const runToken = {};
            const setAnalysis = (v) => {
                if (callbacks && typeof callbacks.onAnalysisState === 'function') callbacks.onAnalysisState(v, runToken);
            };
            // True while THIS run still owns the case view. Goes false if
            // the user navigated away or started a newer run (render()
            // cleared the token) — the guard for skipping the reduce spend
            // and, critically, the persist/render tail so an abandoned run
            // can't clobber a newer run's brief or paint a detached block.
            const stillCurrent = () => !(callbacks && typeof callbacks.isCurrentRun === 'function')
                || callbacks.isCurrentRun(runToken);
            setAnalysis(true);
            // Keep the service worker alive for the WHOLE run — the long
            // reduce has no messages of its own to reset the MV3 idle timer.
            // Stopped on every exit path in the finally.
            const keepalive = startSwKeepalive();
            try {
                // Cost preview: the map is the bulk of a synthesis, so a re-run
                // over an unchanged (or pre-analyzed) corpus should send
                // nothing but the reduce.
                status.textContent = 'Checking cache…';
                const plan = await mapPlan();
                status.textContent = '';

                const toSend = plan.toSend;
                const cachedCount = members.length - toSend.length;
                const approxChars = toSend.reduce((a, m) => a + m.text.length, 0);
                if (!confirm(`Analyze this corpus with the LLM?\n\n`
                    + (cachedCount ? `${cachedCount} of ${members.length} article${members.length === 1 ? '' : 's'} cached — reused for free.\n` : '')
                    + `This sends ${toSend.length} article${toSend.length === 1 ? '' : 's'} `
                    + `(~${Math.round(approxChars / 1000)}k characters) to Anthropic, then one synthesis call.`)) {
                    return;
                }

                // MAP — the shared stage (cached members are free).
                status.textContent = `Analyzing 0/${members.length} articles…`;
                const { modules, failures } = await runMapStage(plan, (p) => {
                    if (p.phase === 'done') status.textContent = `Analyzing ${p.okCount}/${p.total} articles…`;
                });

                // Grounding indexes over the member texts — shared by the
                // local assertion→claim join here AND the brief grounding
                // after the reduce.
                const indexByMember = {};
                for (const m of members) indexByMember[m.article_hash] = createGroundingIndex(m.text);

                // corpus-v4: extracts come back (or out of cache) claims-
                // blind; join their assertions to the CURRENT claim set
                // locally, by quote-span overlap. Cached-before-claims
                // extracts link here too — fresher than a frozen map-time
                // link ever was.
                const extracts = Object.entries(modules).map(([hash, extract]) => ({
                    article_hash: hash, title: (unitById[hash] || {}).title || null,
                    extract: unitById[hash]
                        ? linkAssertionsToClaims(extract, unitById[hash], indexByMember[hash])
                        : extract
                }));
                if (extracts.length === 0) {
                    status.textContent = `No articles could be analyzed (${failures.length} failed).`;
                    return;
                }

                // Abandoned during the map? Stop before spending the reduce
                // call (and before touching the persisted brief).
                if (!stillCurrent()) return;

                // REDUCE — one synthesis call over the extracts + dossier digest.
                status.textContent = `Synthesizing ${extracts.length} extract${extracts.length === 1 ? '' : 's'}…`;
                const reduce = await sendMessage({ type: 'xray:llm:corpus-reduce', request: {
                    // CA.4 — the epistemics summary rides the digest
                    // (distributions only; the prompt forbids using it
                    // to adjudicate). Absent when nothing is audited.
                    dossierDigest: digestDossier(dossier, {
                        claims: claimIndex,
                        auditRollup: corpusAuditRollup({
                            rows: deriveArticleRows(data).rows,
                            runs: data.auditRuns || []
                        })
                    }), extracts, caseName, scopeQuestion
                } });
                if (!reduce || !reduce.ok) {
                    const lost = reduce && reduce.swLost;
                    const detail = (reduce && reduce.error)
                        || 'no response — the run may have been lost to a service-worker restart';
                    status.textContent = `Synthesis failed: ${detail}`
                        + (lost ? ' — try again; the cached extracts make the retry cheap' : '');
                    return;
                }
                const v = validateCaseBrief(reduce.briefInput);
                if (!v.ok) {
                    status.textContent = 'The synthesis returned a malformed brief.';
                    Utils.error('case brief validation', v.errors);
                    return;
                }

                // Ground every quote against the member texts the map used
                // (the indexes built before the join above).
                const grounded = groundCaseBrief(reduce.briefInput, indexByMember);

                // Triage survives a RE-RUN too (27 S.3 review fix): keys are
                // content-derived, so a re-proposed pair keeps its status
                // and keys for proposals the new brief no longer makes are
                // inert. Without this, every corpus-v2 re-run resurrected
                // every dismissed proposal.
                const prior = await getCaseBrief(caseId).catch(() => null);
                const record = {
                    caseId, brief: grounded.brief,
                    grounding: { checked: grounded.checked, dropped: grounded.dropped },
                    inputHash: liveHash, model: reduce.model, promptVersion: CORPUS_PROMPT_VERSION,
                    members: members.length,
                    analyzed: extracts.length, failed: failures.length,
                    cached: cachedCount,
                    usage: reduce.usage || null,
                    triage: (prior && prior.triage) || {}
                };
                // Final ownership check, immediately before the write (no
                // await between here and saveCaseBrief): if this run was
                // abandoned — user navigated away or started a newer run —
                // don't persist (an older run would clobber the newer run's
                // brief) or paint its detached block.
                if (!stillCurrent()) return;

                let saved = true;
                try { await saveCaseBrief(record); }
                catch (err) { saved = false; Utils.error('saveCaseBrief failed', err); }

                const coverageNote = failures.length
                    ? ` (${extracts.length} of ${members.length} members analyzed; ${failures.length} failed)`
                    : '';
                const cacheNote = cachedCount ? ` — ${cachedCount} reused from cache` : '';
                const saveNote = saved ? '' : ' — could NOT be saved (see console); it will be lost on reload';
                status.textContent = `Done${coverageNote}${cacheNote}${saveNote}.`;
                renderStored(record);
            } catch (err) {
                Utils.error('Corpus analysis failed', err);
                status.textContent = `Analysis failed: ${(err && err.message) || 'unknown error'}`;
            } finally {
                keepalive.stop();
                runBtn.disabled = false;
                preBtn.disabled = false;
                setAnalysis(false);
            }
        });
    })().catch((err) => {
        Utils.error('Synthesis block render failed', err);
        block.remove();
    });
}

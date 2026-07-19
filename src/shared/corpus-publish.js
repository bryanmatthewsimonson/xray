// Corpus-brief publishing — Phase 23.2. Turns the local Phase-20
// case-synthesis brief (stored in the xray-audits `case-briefs` store)
// into TWO published artifacts:
//
//   1. a readable kind-30023 long-form article — universally readable in
//      any NOSTR client, so a stranger with only a keypair can read the
//      insights; and
//   2. a structured kind-30068 CaseBrief event — machine-readable, richly
//      rendered inside X-Ray, cross-linked to the article.
//
// Both are the USER's synthesis (signed by the primary identity, not an
// entity). Both are PROSE/data only — no fused case score, no verdict:
// Phase 20's firewall (corpus-prompts.js / CASE_SYNTHESIS_DESIGN §no
// fused score) survives publication. Pure composition here; the portal
// owns signing + publish + read-back.

export const CASE_BRIEF_KIND = 30068;
export const CASE_BRIEF_MARKER = 'xray-case-brief';

function nowSeconds() { return Math.floor(Date.now() / 1000); }

/** One replaceable brief per case — the addressable `d` tag. */
export function caseBriefDTag(caseId) {
    return 'xray-brief:' + String(caseId || '');
}

// The prose fields the brief publishes — deliberately EXCLUDES
// `proposals` (reviewer-facing, not a publication) and carries no score.
function publishableBrief(brief) {
    const b = brief || {};
    return {
        summary: String(b.summary || ''),
        positions: Array.isArray(b.positions) ? b.positions : [],
        cruxes: Array.isArray(b.cruxes) ? b.cruxes : [],
        load_bearing: Array.isArray(b.load_bearing) ? b.load_bearing : [],
        coverage_gaps: Array.isArray(b.coverage_gaps) ? b.coverage_gaps : []
    };
}

// Distinct member article-hashes the brief actually references, in
// first-appearance order — the set to cross-link so a reader can open
// the corpus from the brief.
function referencedMembers(brief) {
    const seen = new Set();
    const order = [];
    const add = (h) => { if (h && !seen.has(h)) { seen.add(h); order.push(h); } };
    for (const p of brief.positions || []) for (const h of p.holders || []) add(h.article_hash);
    for (const c of brief.cruxes || []) for (const e of c.evidence_refs || []) add(e.article_hash);
    for (const l of brief.load_bearing || []) add(l.article_hash);
    return order;
}

// ------------------------------------------------------------------
// Readable markdown (Artifact 1's body)
// ------------------------------------------------------------------

const XRAY_URL = 'https://github.com/bryanmatthewsimonson/xray';

function sourceLink(hash, memberIndex) {
    const m = (memberIndex || {})[hash];
    if (!m || !m.url) return null;
    return { url: m.url, title: m.title || m.url };
}

function quoteLine(hash, quote, memberIndex) {
    const src = sourceLink(hash, memberIndex);
    const q = `> ${String(quote || '').replace(/\n+/g, ' ').trim()}`;
    return src ? `${q}\n> — [${escapeMd(src.title)}](${src.url})` : q;
}

function escapeMd(s) {
    return String(s == null ? '' : s).replace(/[\[\]]/g, '');
}

/** The publisher/outlet for a source URL — the hostname minus a leading "www.". */
export function outletFor(url) {
    try {
        return new URL(String(url || '')).hostname.replace(/^www\./, '');
    } catch (_) { return ''; }
}

/**
 * Conservative same-underlying-file key for a URL, or null. Recognizes
 * exactly one identity today: a Google-Drive/Docs file id — the
 * view-URL and download-URL of one Drive file share it. Deliberately
 * NOT a general URL normalizer, and deliberately narrow: when two
 * DIFFERENT-content captures share this key, the render may HINT that
 * they could be one underlying file, but it never merges them (content
 * addressing governs — differing text is a different artifact, P4/P9)
 * and never asserts or denies independence (P5/P8).
 */
export function underlyingFileKey(url) {
    try {
        const u = new URL(String(url || ''));
        if (!/(^|\.)(drive|docs)\.google\.com$/.test(u.hostname)) return null;
        const m = u.pathname.match(/\/(?:file|document|presentation|spreadsheets)\/d\/([\w-]{10,})/);
        if (m) return `gdrive:${m[1]}`;
        const id = u.searchParams.get('id');
        if (id && id.length >= 10) return `gdrive:${id}`;
        return null;
    } catch (_) { return null; }
}

/**
 * Associate each coverage-gap finding with the ONE position whose label
 * it names, so the caveat can render beside the position it qualifies
 * (P5/P8 — a gap about a position rendered hundreds of lines away reads
 * as false balance). Pure placement over EXISTING brief data: matching
 * is a conservative normalized-substring test of the position label in
 * the gap text — nothing is added, ranked, or adjudicated. A gap that
 * names zero or MULTIPLE positions stays general (a cross-position
 * caveat is not position-adjacent).
 *
 * @returns {{byPosition: string[][], general: string[]}} byPosition is
 *   index-aligned with brief.positions.
 */
export function matchCoverageGapsToPositions(brief) {
    const b = brief || {};
    const norm = (s) => ` ${String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
    const positions = Array.isArray(b.positions) ? b.positions : [];
    const labels = positions.map((p) => norm(p && p.label));
    const byPosition = positions.map(() => []);
    const general = [];
    for (const gap of b.coverage_gaps || []) {
        const g = norm(gap);
        const hits = [];
        labels.forEach((label, i) => {
            if (label.trim() && g.includes(label)) hits.push(i);
        });
        if (hits.length === 1) byPosition[hits[0]].push(gap);
        else general.push(gap);
    }
    return { byPosition, general };
}

/**
 * The distinct RESOLVABLE members the brief cites, in first-appearance
 * order — the citation-numbering backbone. Positions cite their (often
 * dozens of) holders by number to keep the prose readable, and a Sources
 * list at the end maps each number to its full link; the on-screen brief
 * and this exported/published markdown number from the SAME order, so a
 * citation [N] means the same source everywhere. Resolvable = has a
 * memberIndex entry with a URL (an unlinkable holder is dropped, exactly
 * as the inline render already dropped it). Distinct from
 * `referencedMembers` (which feeds the wire `x`/`a` tags and must keep
 * even unresolvable hashes) — do not conflate the two.
 */
export function citedMemberOrder(brief, memberIndex) {
    const seen = new Set();
    const order = [];
    const add = (h) => {
        if (h && !seen.has(h) && sourceLink(h, memberIndex)) { seen.add(h); order.push(h); }
    };
    const b = brief || {};
    for (const p of b.positions || []) for (const h of p.holders || []) add(h.article_hash);
    for (const c of b.cruxes || []) for (const e of c.evidence_refs || []) add(e.article_hash);
    for (const l of b.load_bearing || []) add(l.article_hash);
    return order;
}

/**
 * Render the brief to a readable markdown article body. Deterministic
 * and prose-only. `memberIndex` maps article_hash → {url, title} so
 * quotes link back to their source; missing members degrade to an
 * unlinked quote. A memberIndex entry may carry `aliases`
 * ([{url,title}] — same-content captures folded by foldMemberAliases);
 * they nest under their canonical Sources entry. `provenance`
 * ({npub, pubkeyHex, relays}) turns on the self-locating header; an
 * unresolved field renders a visible placeholder, never nothing.
 * `coverage` ({analyzed, failed}) discloses a PARTIAL run on its face
 * (P6/P12): when fewer members were analyzed than captured, the intro
 * says so — the un-analyzed sources are absent from the synthesis and
 * the header must not read as if they were covered.
 */
export function renderCaseBriefMarkdown(brief, { caseName, scopeQuestion, memberCount, memberIndex, entitySummary, provenance, coverage } = {}) {
    const b = publishableBrief(brief);
    // Citation numbering — positions cite by [N], the Sources list at the
    // end resolves each. Same order the on-screen brief uses.
    const citedOrder = citedMemberOrder(b, memberIndex);
    const citeNum = new Map(citedOrder.map((h, i) => [h, i + 1]));
    // A holder citation "[N]" whose NUMBER links to its source. The
    // brackets are backslash-escaped so a CommonMark reader renders a
    // literal "[N]" with N clickable — robust across markdown viewers and
    // NOSTR clients (an anchor link into the Sources list is not). Falls
    // back to a plain "[N]" if the source somehow doesn't resolve.
    const citeMd = (num) => {
        const s = sourceLink(citedOrder[num - 1], memberIndex);
        return s ? `\\[[${num}](${s.url})\\]` : `[${num}]`;
    };
    const lines = [];
    lines.push(`# Case brief — ${escapeMd(caseName || 'Untitled case')}`);
    lines.push('');

    // Self-locating provenance header (P12): the exported file says where
    // it stands — a rendered, local view whose interrogable artifact is
    // the signed event graph on the relays. Emitted only when the caller
    // passes `provenance`; an unresolved identity/relay list renders a
    // VISIBLE placeholder rather than silently vanishing (P6/P12).
    if (provenance) {
        const p = provenance;
        const identity = (p.npub || p.pubkeyHex)
            ? [p.npub ? `\`${p.npub}\`` : null, p.pubkeyHex ? `hex \`${p.pubkeyHex}\`` : null]
                .filter(Boolean).join(' · ')
            : '[unresolved at render time — no signing identity was configured when this file was exported]';
        const relays = (Array.isArray(p.relays) && p.relays.length)
            ? p.relays.map((r) => `\`${r}\``).join(', ')
            : '[unresolved at render time — no relay list was configured when this file was exported]';
        lines.push('> **This document is a rendered view, not the record.** It is a local,'
            + ' non-authoritative rendering of a signed NOSTR event corpus. The interrogable'
            + ' artifact is the signed event graph itself — the captures, claims, links, and'
            + ' audits it cites — fetchable and verifiable from the relays below without this file.');
        lines.push('>');
        lines.push(`> **Publishing identity:** ${identity}`);
        lines.push('>');
        lines.push(`> **Relays:** ${relays}`);
        lines.push('>');
        lines.push('> **Query the corpus:** from any NOSTR client or a raw WebSocket, request events'
            + ` by author — e.g. \`["REQ","xray",{"authors":["${p.pubkeyHex || '<pubkey-hex>'}"],"kinds":[30023]}]\`,`
            + " one kind per query; the kind vocabulary is documented in X-Ray's NIP draft (`docs/NIP_DRAFT.md`).");
        lines.push('');
    }

    const n = memberCount != null ? memberCount : referencedMembers(b).length;
    const scope = scopeQuestion ? ` on **${escapeMd(scopeQuestion)}**` : '';
    // Same-content captures fold into one Sources entry; say so at the
    // point the capture count is shown, so N captures of one artifact are
    // never read as N independent sources (P4/P9).
    const aliasTotal = Object.values(memberIndex || {})
        .reduce((a, m) => a + (Array.isArray(m && m.aliases) ? m.aliases.length : 0), 0);
    const collapseNote = aliasTotal
        ? ` Of these, ${aliasTotal} ${aliasTotal === 1 ? 'is a same-content re-capture' : 'are same-content re-captures'}`
            + ` of another capture (identical canonical text) and ${aliasTotal === 1 ? 'is' : 'are'} folded into a`
            + ' single entry under **Sources** — capture counts are not independent-source counts.'
        : '';
    const citeNote = citedOrder.length
        ? ' Positions cite their sources by number — the full list is under **Sources** at the end.'
        : '';
    // Partial-run disclosure (P6/P12): when the model analyzed fewer
    // than all captured members, the un-analyzed ones are absent from
    // everything below — say so, rather than let "N captured sources"
    // imply N were synthesized. `analyzed`/`failed` come from the
    // stored run record; only emit when analyzed is known and < n.
    const analyzed = coverage && Number.isFinite(coverage.analyzed) ? coverage.analyzed : null;
    const unanalyzed = analyzed != null ? n - analyzed : 0;
    const coverageNote = (analyzed != null && unanalyzed > 0)
        ? ` Of these, ${analyzed} ${analyzed === 1 ? 'was' : 'were'} analyzed for this synthesis;`
            + ` ${unanalyzed} could not be processed and ${unanalyzed === 1 ? 'is' : 'are'} absent from the sections below.`
        : '';
    lines.push(`*A synthesis of ${n} captured source${n === 1 ? '' : 's'}${scope}.${coverageNote}${collapseNote} Every quote below is`
        + ` verbatim from a captured source — open the linked source to read it in context.${citeNote} Compiled with`
        + ` [X-Ray](${XRAY_URL}); this is a map of the disagreement, **not** a ruling.*`);
    lines.push('');

    // Coverage-gap findings that name exactly one position render beside
    // that position (P5/P8): the caveat travels with what it qualifies.
    const gapsByPosition = matchCoverageGapsToPositions(b);

    if (b.summary) {
        lines.push('## Summary', '', b.summary, '');
    }

    if (b.positions.length) {
        lines.push('## Positions', '');
        b.positions.forEach((p, i) => {
            lines.push(`### ${escapeMd(p.label || 'Position')}`);
            if (p.core_argument) lines.push('', p.core_argument);
            // Holders cite by number (they run to dozens on a big case) —
            // each number links to its source; the Sources list at the end
            // is the readable index. Sorted ascending so the run reads
            // [1], [2], [5] not [5], [1], [2].
            const nums = (p.holders || []).map((h) => citeNum.get(h.article_hash))
                .filter((num) => num != null).sort((x, y) => x - y);
            if (nums.length) lines.push('', `*Held by:* ${nums.map(citeMd).join(', ')}`);
            for (const gap of gapsByPosition.byPosition[i]) {
                lines.push('', `*Coverage note (from this brief's coverage-gap findings):* ${String(gap).trim()}`);
            }
            lines.push('');
        });
    }

    if (b.cruxes.length) {
        lines.push('## Cruxes of disagreement', '');
        for (const c of b.cruxes) {
            lines.push(`### ${escapeMd(c.question || 'Crux')}`, '');
            for (const s of c.sides || []) {
                lines.push(`- **${escapeMd(s.position_label || 'A side')}:** ${String(s.view || '').trim()}`);
            }
            if ((c.sides || []).length) lines.push('');
            for (const ev of c.evidence_refs || []) {
                lines.push(quoteLine(ev.article_hash, ev.quote, memberIndex), '');
            }
            if (c.what_would_resolve) lines.push(`*What would resolve it:* ${c.what_would_resolve}`, '');
        }
    }

    if (b.load_bearing.length) {
        lines.push('## Load-bearing claims', '');
        for (const l of b.load_bearing) {
            lines.push(quoteLine(l.article_hash, l.quote, memberIndex));
            if (l.why) lines.push(`> *Why it matters:* ${l.why}`);
            lines.push('');
        }
    }

    // Coverage gaps — position-specific notes moved beside their
    // positions above (with a pointer here, so nothing silently
    // disappears); cross-position and unmatched gaps stay in this list.
    const movedGaps = gapsByPosition.byPosition.reduce((a, g) => a + g.length, 0);
    if (gapsByPosition.general.length || movedGaps) {
        lines.push('## Coverage gaps', '');
        if (movedGaps) {
            lines.push(`*${movedGaps} position-specific coverage note${movedGaps === 1 ? ' is' : 's are'} shown beside`
                + ` the position${movedGaps === 1 ? ' it qualifies' : 's they qualify'} under **Positions** above.*`, '');
        }
        for (const g of gapsByPosition.general) lines.push(`- ${String(g || '').trim()}`);
        lines.push('');
    }

    // Sources — the numbered list the [N] citations resolve to. Full
    // link text lives here so the prose above stays readable; each entry
    // is annotated with its outlet and publication date when known, so a
    // reader can scan the corpus by source or by date. Same-content
    // captures nest under their canonical entry as aliases; a soft
    // same-Drive-file hint may connect entries whose content differs.
    if (citedOrder.length) {
        lines.push('## Sources', '');
        const urlsOf = (h) => {
            const m = memberIndex[h] || {};
            return [m.url, ...((m.aliases || []).map((a) => a && a.url))].filter(Boolean);
        };
        const numsByFileKey = new Map();
        citedOrder.forEach((h, i) => {
            for (const u of urlsOf(h)) {
                const k = underlyingFileKey(u);
                if (!k) continue;
                if (!numsByFileKey.has(k)) numsByFileKey.set(k, new Set());
                numsByFileKey.get(k).add(i + 1);
            }
        });
        citedOrder.forEach((h, i) => {
            const s = sourceLink(h, memberIndex);
            const entry = memberIndex[h] || {};
            const meta = [outletFor(s.url), entry.date].filter(Boolean).join(' · ');
            lines.push(`${i + 1}. [${escapeMd(s.title)}](${s.url})${meta ? ` — ${meta}` : ''}`);
            for (const alias of entry.aliases || []) {
                if (!alias || !alias.url) continue;
                lines.push(`   - also captured at [${escapeMd(alias.title || alias.url)}](${alias.url})`
                    + ' — identical canonical content: the same artifact, not an independent source');
            }
            const others = new Set();
            for (const u of urlsOf(h)) {
                const k = underlyingFileKey(u);
                if (!k) continue;
                for (const num of numsByFileKey.get(k)) if (num !== i + 1) others.add(num);
            }
            if (others.size) {
                lines.push(`   - *may share an underlying file with ${[...others].sort((x, y) => x - y).map((num) => `[${num}]`).join(', ')}`
                    + ' (same Google Drive file id, but the captured text differs, so the entries stay'
                    + ' separate) — a hint only, not a sameness or independence determination*');
            }
        });
        lines.push('');
    }

    // Entity index → a clearly-labeled APPENDIX after the substantive
    // sections (P2/P5): counts are navigation, never weight, and a
    // 0-claim row adds nothing a reader could misread as corroboration —
    // dropped from the render entirely (computeEntitySummary still
    // reports it; this is presentation).
    const withClaims = (list) => (Array.isArray(list) ? list.filter((e) => e && (e.claimCount || 0) > 0) : []);
    const people = withClaims(entitySummary && entitySummary.people);
    const orgs = withClaims(entitySummary && entitySummary.orgs);
    if (people.length || orgs.length) {
        lines.push('## Appendix — entity index', '');
        lines.push('*Claim counts are provenance and navigation aids — how many captured claims in this corpus'
            + ' mention each entity. They are not weight, importance, or credibility.*', '');
        const entIndex = (heading, list) => {
            if (!list.length) return;
            lines.push(`### ${heading}`, '');
            for (const e of list) {
                const nums = (e.sourceHashes || []).map((h) => citeNum.get(h))
                    .filter((num) => num != null).sort((x, y) => x - y);
                const count = e.claimCount || 0;
                const bits = [`${count} claim${count === 1 ? '' : 's'}`];
                if (nums.length) bits.push(`in ${nums.length} source${nums.length === 1 ? '' : 's'}`);
                let line = `- **${escapeMd(e.name || '(unnamed)')}** — ${bits.join(' · ')}`;
                if (nums.length) line += `: ${nums.map(citeMd).join(', ')}`;
                lines.push(line);
            }
            lines.push('');
        };
        entIndex('People', people);
        entIndex('Organizations', orgs);
    }

    lines.push('---', '',
        `*Compiled from ${n} source${n === 1 ? '' : 's'} with [X-Ray](${XRAY_URL}). No single number stands`
        + ` in for the case — X-Ray maps disagreement and grounds every quote; it does not rank or rule.*`);
    return lines.join('\n') + '\n';
}

// ------------------------------------------------------------------
// Shared reference tags (members + the sibling cross-link)
// ------------------------------------------------------------------

function memberRefTags(brief, memberIndex, userPubkey, siblingKind, caseId) {
    const tags = [];
    // Cross-link to the sibling artifact by coordinate (no event-id
    // chicken-and-egg — both share the d-tag).
    if (userPubkey && siblingKind) {
        tags.push(['a', `${siblingKind}:${userPubkey}:${caseBriefDTag(caseId)}`]);
    }
    for (const hash of referencedMembers(brief)) {
        const m = (memberIndex || {})[hash];
        // Coordinate ref when the portal resolved the member's published
        // address; the content hash always, for the `#x` join.
        if (m && m.coord) tags.push(['a', m.coord, '', 'member']);
        tags.push(['x', hash]);
    }
    return tags;
}

// ------------------------------------------------------------------
// Artifact 1 — the readable kind-30023 article (unsigned)
// ------------------------------------------------------------------

export function buildCaseBriefArticle({
    record, caseName, scopeQuestion, memberIndex, entitySummary = null, userPubkey = null, createdAt = nowSeconds()
} = {}) {
    if (!record || !record.brief) throw new Error('buildCaseBriefArticle: record.brief is required');
    const caseId = record.caseId;
    const body = renderCaseBriefMarkdown(record.brief, {
        caseName, scopeQuestion, memberCount: record.members, memberIndex, entitySummary,
        coverage: { analyzed: record.analyzed, failed: record.failed }
    });
    const tags = [
        ['d', caseBriefDTag(caseId)],
        ['title', `Case brief — ${caseName || 'Untitled case'}`],
        ['t', CASE_BRIEF_MARKER],
        ['client', 'xray'],
        ['published_at', String(createdAt)],
        ...memberRefTags(record.brief, memberIndex, userPubkey, CASE_BRIEF_KIND, caseId)
    ];
    return { kind: 30023, created_at: createdAt, tags, content: body };
}

// ------------------------------------------------------------------
// Artifact 2 — the structured kind-30068 CaseBrief (unsigned)
// ------------------------------------------------------------------

export function buildCaseBriefEvent({
    record, caseName, scopeQuestion, memberIndex, userPubkey = null, createdAt = nowSeconds()
} = {}) {
    if (!record || !record.brief) throw new Error('buildCaseBriefEvent: record.brief is required');
    const caseId = record.caseId;
    const payload = {
        case_name: caseName || null,
        scope_question: scopeQuestion || null,
        ...publishableBrief(record.brief)
    };
    const g = record.grounding || {};
    const tags = [
        ['d', caseBriefDTag(caseId)],
        ['title', `Case brief — ${caseName || 'Untitled case'}`],
        ['t', CASE_BRIEF_MARKER],
        ['client', 'xray'],
        ['prompt_version', String(record.promptVersion || '')],
        ['grounded', `${g.checked || 0}:${g.dropped || 0}`],
        ['published_at', String(createdAt)],
        ...memberRefTags(record.brief, memberIndex, userPubkey, 30023, caseId)
    ];
    return { kind: CASE_BRIEF_KIND, created_at: createdAt, tags, content: JSON.stringify(payload) };
}

// ------------------------------------------------------------------
// Inverse — read a 30068 back to a brief-shaped object
// ------------------------------------------------------------------

export function parseCaseBriefEvent(event) {
    if (!event || event.kind !== CASE_BRIEF_KIND) return null;
    let payload = {};
    try { payload = JSON.parse(event.content || '{}'); } catch (_) { return null; }
    const tag = (k) => ((event.tags || []).find((t) => t[0] === k) || [])[1] || null;
    const dTag = tag('d') || '';
    const caseId = dTag.startsWith('xray-brief:') ? dTag.slice('xray-brief:'.length) : null;
    const g = String(tag('grounded') || '0:0').split(':');
    return {
        caseId,
        title: tag('title'),
        caseName: payload.case_name || null,
        scopeQuestion: payload.scope_question || null,
        promptVersion: tag('prompt_version'),
        brief: publishableBrief(payload),
        grounding: { checked: parseInt(g[0], 10) || 0, dropped: parseInt(g[1], 10) || 0 },
        members: (event.tags || [])
            .filter((t) => t[0] === 'a' && t[3] === 'member').map((t) => t[1]),
        memberHashes: (event.tags || []).filter((t) => t[0] === 'x').map((t) => t[1])
    };
}

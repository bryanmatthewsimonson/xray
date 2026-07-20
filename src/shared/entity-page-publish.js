// Entity-page publishing — EP.4 (docs/ENTITY_PAGE_KICKOFF.md). PURE
// builders for the page's ONE wire artifact: a replaceable kind-30023
// article, USER-signed (the page is the researcher's synthesis — a
// judgment-carrying artifact, so custody keeps entity keys away from
// it; the subject rides as a `p` tag). Citations are `a`-refs to the
// cited claims' published kind-30040 events — that IS the
// machine-readable layer; deliberately NO new wire kind (the 30067
// lesson).
//
// corpus-publish.js is the pattern: d-tag per subject so a republish
// REPLACES the previous page (wiki-revision semantics), a `t` marker
// for discovery, member `x` hashes for content addressing.

function nowSeconds() { return Math.floor(Date.now() / 1000); }

export const ENTITY_PAGE_MARKER = 'xray-entity-page';

/** Stable per-subject d-tag — republishing overwrites, wiki-style. */
export function entityPageDTag(entityId) {
    return `xray-entity-page:${entityId}`;
}

function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url || ''; }
}

function shortHash(h) { return h ? `${String(h).slice(0, 8)}…` : ''; }

// ------------------------------------------------------------------
// Markdown render — deterministic; same record ⇒ same body
// ------------------------------------------------------------------

/**
 * @param {object} record    the stored entity-page record ({page, grounding, ...})
 * @param {object} opts
 * @param {string} opts.entityName
 * @param {Array}  [opts.keyClaims]  resolved claim records for the CURRENT
 *                                   key_claim_ids selection ({id, text, quote,
 *                                   source_url, publishedEventId})
 * @param {number} [opts.generatedAt]
 */
export function renderEntityPageMarkdown(record, { entityName = '', keyClaims = [], generatedAt = null } = {}) {
    const page = record.page || {};
    const lines = [];
    lines.push(`# ${entityName || 'Entity page'}`);
    lines.push('');
    if (page.lead) { lines.push(page.lead); lines.push(''); }

    if (keyClaims.length > 0) {
        lines.push('## Key facts');
        lines.push('');
        lines.push('_Each entry is a captured claim; the quote is its verification._');
        lines.push('');
        for (const c of keyClaims) {
            const src = c.source_url ? ` — ${hostOf(c.source_url)}` : '';
            lines.push(`- ${c.text}${src}`);
            if (c.quote) lines.push(`  > “${c.quote}”`);
        }
        lines.push('');
    }

    for (const s of page.sections || []) {
        lines.push(`## ${s.heading}`);
        lines.push('');
        lines.push(s.body);
        lines.push('');
        for (const c of s.citations || []) {
            lines.push(`> “${c.quote}” _(source ${shortHash(c.article_hash)})_`);
            lines.push('');
        }
        if (s.uncited) {
            lines.push('_No verbatim citation survived grounding for this section — read it as unanchored summary._');
            lines.push('');
        }
    }

    if ((page.disputes || []).length > 0) {
        lines.push('## Where sources disagree');
        lines.push('');
        for (const d of page.disputes || []) {
            lines.push(`### ${d.topic}`);
            lines.push('');
            for (const side of d.sides || []) {
                lines.push(`- ${side.view}`);
                if (side.quote) lines.push(`  > “${side.quote}” _(source ${shortHash(side.article_hash)})_`);
            }
            lines.push('');
        }
    }

    if ((page.gaps || []).length > 0) {
        lines.push('## What this corpus does not establish');
        lines.push('');
        for (const g of page.gaps || []) lines.push(`- ${g}`);
        lines.push('');
    }

    const g = record.grounding || { checked: 0, dropped: 0 };
    lines.push('---');
    lines.push('');
    lines.push(`_Assembled by an X-Ray archive from ${record.members || 0} captured source${(record.members || 0) === 1 ? '' : 's'};`
        + ` ${g.checked} quote${g.checked === 1 ? '' : 's'} machine-checked, ${g.dropped} dropped.`
        + ` Model: ${record.model || 'unknown'} (${record.promptVersion || ''}).`
        + `${generatedAt ? ` Generated ${new Date(generatedAt * 1000).toISOString().slice(0, 10)}.` : ''}`
        + ' Every line reports what the captured sources say — this page adjudicates nothing._');
    return lines.join('\n');
}

// ------------------------------------------------------------------
// The kind-30023 entity page (unsigned; the USER signs)
// ------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {object} opts.record        the stored entity-page record
 * @param {object} opts.entity        the subject ({id, name, type}); pubkey via entityPubkey
 * @param {string} [opts.entityPubkey] the subject's wire pubkey (p-tagged when present)
 * @param {Array}  [opts.keyClaims]   resolved claim records for the key-facts box
 * @param {string} [opts.userPubkey]  fallback publisher for claim coordinates
 * @param {number} [opts.createdAt]
 */
export function buildEntityPageArticle({
    record, entity, entityPubkey = null, keyClaims = [], userPubkey = null, createdAt = nowSeconds()
} = {}) {
    if (!record || !record.page) throw new Error('buildEntityPageArticle: record.page is required');
    if (!entity || !entity.id) throw new Error('buildEntityPageArticle: entity is required');

    const body = renderEntityPageMarkdown(record, {
        entityName: entity.name || '', keyClaims, generatedAt: record.createdAt || null
    });

    const tags = [
        ['d', entityPageDTag(entity.id)],
        ['title', `${entity.name || 'Entity'} — entity page`],
        ['t', ENTITY_PAGE_MARKER],
        ['client', 'xray'],
        ['published_at', String(createdAt)]
    ];
    if (entityPubkey) tags.push(['p', entityPubkey, '', 'subject']);

    // `a`-refs: every key claim that is itself PUBLISHED — the
    // machine-readable citation layer. Coordinates name the claim's
    // actual publisher (multi-device users), falling back to the
    // caller's pubkey for pre-stamp records; a claim with neither is
    // omitted (an unresolvable coordinate is dead wire data).
    const coords = new Set();
    for (const c of keyClaims) {
        if (!c || !c.publishedEventId) continue;
        const pk = c.publishedPubkey || userPubkey;
        if (!pk) continue;
        coords.add(`30040:${pk}:${c.id}`);
    }
    for (const coord of [...coords].sort()) tags.push(['a', coord, '', 'key-fact']);

    // Member content addresses: every article hash the page cites.
    const hashes = new Set();
    for (const s of record.page.sections || []) {
        for (const c of s.citations || []) if (c.article_hash) hashes.add(c.article_hash);
    }
    for (const d of record.page.disputes || []) {
        for (const side of d.sides || []) if (side.article_hash && side.quote) hashes.add(side.article_hash);
    }
    for (const h of [...hashes].sort()) tags.push(['x', h]);

    return { kind: 30023, created_at: createdAt, tags, content: body };
}

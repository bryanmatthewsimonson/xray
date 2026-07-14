// Case membership authoring outside the reader — Phase 20.2
// (docs/CASE_SYNTHESIS_DESIGN.md forthcoming; the mechanism is the
// 20.1 union: an article belongs to a case if a claim's `about` names
// the case OR the archive record is tagged with the case entity).
//
// Until 20.2 the ONLY way to make an archive record a case member was
// to tag text inside the reader. This module adds the tag-membership
// write path for the portal + side panel: mutate the archive record's
// `article.entities[]` to carry the case ref, no republish. It never
// touches claims (the claim spine is authored in the reader), and it
// never publishes — an already-published capture keeps its old wire
// p-tags until it is re-published from the reader (the callers show a
// hint chip for that).
//
// The tag ref uses `context: ''` DELIBERATELY. `rehydrateEntityMarks`
// (reader/entity-tagger.js) wraps the first body-text occurrence of a
// ref's `context`, so a non-empty sentinel like "case" would mark a
// random word in the article; an empty context is skipped by the
// rehydrate guard and still emits a bare `['p', pubkey]` on publish.
// The case id is canonicalized to its root so alias-family membership
// checks (20.1) always resolve.

import { Utils } from './utils.js';
import { EntityModel } from './entity-model.js';
import { ClaimModel } from './claim-model.js';
import { listArticles, getArticle, saveArticle } from './archive-cache.js';

/**
 * The url sets that already make an archive record a member of this
 * case: `tagUrls` (record entities intersect the alias family) and
 * `claimUrls` (a claim's `about` names a family member). Both are
 * normalized. `familyIds` is the case's alias family.
 */
export async function memberUrlSets(caseEntityId) {
    const [entities, allClaims, articles] = await Promise.all([
        EntityModel.getAll(),
        ClaimModel.getAll(),
        listArticles()
    ]);
    const family = await EntityModel.aliasFamily(caseEntityId, entities);
    const familyIds = new Set((family && family.ids && family.ids.length) ? family.ids : [caseEntityId]);

    const tagUrls = new Set();
    for (const rec of articles) {
        if (!rec || !rec.url) continue;
        const tagged = ((rec.article && rec.article.entities) || [])
            .some((e) => e && familyIds.has(e.entity_id));
        if (tagged) tagUrls.add(Utils.normalizeUrl(rec.url));
    }

    const claimUrls = new Set();
    for (const c of Object.values(allClaims)) {
        if (!c || !c.source_url) continue;
        if ((c.about || []).some((id) => familyIds.has(id))) {
            claimUrls.add(Utils.normalizeUrl(c.source_url));
        }
    }

    return { familyIds, tagUrls, claimUrls };
}

/**
 * Archive records not yet members of this case (neither tag- nor
 * claim-mediated), newest capture first — the candidate list for an
 * "Add sources…" picker.
 */
export async function listAddableArticles(caseEntityId) {
    const [{ tagUrls, claimUrls }, articles] = await Promise.all([
        memberUrlSets(caseEntityId),
        listArticles()
    ]);
    const candidates = articles.filter((rec) => {
        if (!rec || !rec.url) return false;
        const url = Utils.normalizeUrl(rec.url);
        return !tagUrls.has(url) && !claimUrls.has(url);
    });
    candidates.sort((a, b) => (b.cachedAt || 0) - (a.cachedAt || 0));
    return { candidates };
}

// Persist an entity-ref mutation on one archive record without
// disturbing its identity/provenance. `saveArticle` preserves cachedAt
// / publishedToRelay / publishedEventId for an existing row, but NOT
// `source`, and it recomputes the hash unless `_articleHash` is passed
// — so both ride through explicitly.
async function rewriteEntities(rec, nextEntities) {
    await saveArticle({
        article: { ...rec.article, entities: nextEntities, _articleHash: rec.articleHash },
        source: rec.source || 'capture',
        publishedToRelay: rec.publishedToRelay || false,
        publishedEventId: rec.publishedEventId || null
    });
}

/**
 * Tag the given archived urls with this case (canonical root, empty
 * context). Idempotent: a record already tagged with any family member
 * is skipped. Returns `{ added, skipped, published }` — `published`
 * lists added urls whose record was already published to a relay (the
 * caller warns that the wire copy won't carry the case until
 * re-published).
 */
export async function addArticlesToCase(caseEntityId, urls) {
    const root = await EntityModel.resolveCanonical(caseEntityId);
    if (!root) throw new Error(`addArticlesToCase: case entity not found: ${caseEntityId}`);
    const family = await EntityModel.aliasFamily(root.id);
    const familyIds = new Set((family && family.ids && family.ids.length) ? family.ids : [root.id]);

    const ref = { entity_id: root.id, type: 'case', name: root.name, context: '' };
    const added = [];
    const skipped = [];
    const published = [];

    for (const url of urls || []) {
        const rec = await getArticle(url);
        if (!rec || !rec.article) { skipped.push(url); continue; }
        const entities = Array.isArray(rec.article.entities) ? rec.article.entities : [];
        if (entities.some((e) => e && familyIds.has(e.entity_id))) { skipped.push(url); continue; }
        await rewriteEntities(rec, [...entities, ref]);
        added.push(rec.url);
        if (rec.publishedToRelay) published.push(rec.url);
    }
    return { added, skipped, published };
}

/**
 * Remove this case's tag from an archived url — strips every ref whose
 * entity_id is in the case alias family. (Claim-mediated membership is
 * unaffected; a row that is also claim-referenced stays a member.)
 */
export async function removeArticleFromCase(caseEntityId, url) {
    const family = await EntityModel.aliasFamily(caseEntityId);
    const familyIds = new Set((family && family.ids && family.ids.length) ? family.ids : [caseEntityId]);
    const rec = await getArticle(url);
    if (!rec || !rec.article) return { removed: false };
    const entities = Array.isArray(rec.article.entities) ? rec.article.entities : [];
    const next = entities.filter((e) => !(e && familyIds.has(e.entity_id)));
    if (next.length === entities.length) return { removed: false };
    await rewriteEntities(rec, next);
    return { removed: true };
}

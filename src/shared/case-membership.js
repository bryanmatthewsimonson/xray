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
import { Storage } from './storage.js';
import { EntityModel } from './entity-model.js';
import { ClaimModel } from './claim-model.js';
import { listArticles, getArticle, saveArticle } from './archive-cache.js';
import { Workspaces, IdentityProfiles } from './identity-profiles.js';

/**
 * 28.3 — the ACTIVE workspace's bound case, resolved to the exact
 * entity-ref shape the membership writer uses ({entity_id: canonical
 * root, type:'case', name, context:''}) plus the case frame the
 * suggest prompt consumes ({caseName, scopeQuestion}). Null when the
 * workspace is unbound, or the bound id does not resolve to a
 * case-typed entity in THIS workspace's registry — a binding must
 * never mint tags for an entity that isn't actually here.
 */
export async function resolveActiveCaseRef() {
    const ws = await Workspaces.active();
    const boundId = ws && ws.case_entity_id;
    if (!boundId) return null;
    const root = await EntityModel.resolveCanonical(boundId).catch(() => null);
    if (!root || root.type !== 'case') return null;
    const scopeSlot = root.authored_fields && root.authored_fields.scope_question;
    return {
        caseId: root.id,
        caseName: root.name,
        scopeQuestion: (scopeSlot && scopeSlot.value) || '',
        ref: { entity_id: root.id, type: 'case', name: root.name, context: '' }
    };
}

/**
 * The active-context line every surface's chrome renders (the kickoff
 * §4 promise: "the active case name always visible — you should never
 * wonder whose data you are looking at"). One shape for the portal,
 * side panel, and reader:
 *
 *   { wsId, wsLabel, caseName|null, profileLabel|null, isDefault }
 *
 * `caseName` resolves inside the ACTIVE namespace via
 * resolveActiveCaseRef (null when the workspace is unbound or the
 * binding is broken — the chrome then shows the workspace label, never
 * a guessed name).
 */
export async function describeActiveContext() {
    const ws = await Workspaces.active();
    const ref = await resolveActiveCaseRef().catch(() => null);
    let profileLabel = null;
    if (ws.identity_pubkey) {
        const profiles = await IdentityProfiles.getAll().catch(() => ({}));
        profileLabel = (profiles[ws.identity_pubkey] || {}).label || null;
    }
    return {
        wsId: ws.id,
        wsLabel: ws.label,
        caseName: ref ? ref.caseName : null,
        profileLabel,
        isDefault: ws.id === 'default'
    };
}

const HEX64 = /^[0-9a-f]{64}$/;
const shortPk = (pk) => `${pk.slice(0, 8)}…${pk.slice(-4)}`;
const nameOf = (who) => (who.label ? `“${who.label}” (${shortPk(who.pubkey)})` : shortPk(who.pubkey));

/**
 * The live signer against the active case's bound identity — pure.
 * `Workspaces.activate` moves both together, but the live key can move
 * on its own afterwards (Options ▸ Signing "Use", a backup restore, a
 * rebind), and from then on every publish in this case is signed by a
 * key that is not the case's (JOURNAL 2026-10-01). Only a LOCAL signer
 * is compared: NIP-07 and NSecBunker keys are not identity profiles,
 * and under Option C (NIP07_IDENTITY_KICKOFF §6) the local primary
 * legitimately differs from a NIP-07 signer. `method` is normalized
 * as Signer.getMethod does.
 *
 * @returns {{method: string, bound: {pubkey, label}|null,
 *            live: {pubkey, label}|null, mismatch: boolean}}
 */
export function signerBindingState({ method, boundPubkey, livePubkey, profiles } = {}) {
    const m = (method === 'nip07' || method === 'nsecbunker') ? method : 'local';
    const named = (pk) => {
        const key = typeof pk === 'string' ? pk.toLowerCase() : '';
        if (!HEX64.test(key)) return null;
        const p = profiles && profiles[key];
        return { pubkey: key, label: (p && typeof p.label === 'string' && p.label) || null };
    };
    const bound = named(boundPubkey);
    const live = m === 'local' ? named(livePubkey) : null;
    return { method: m, bound, live, mismatch: !!(bound && live && bound.pubkey !== live.pubkey) };
}

/** signerBindingState over the stored workspace, signing method, primary and profiles. */
export async function describeSignerBinding() {
    const [ws, prefs, primary, profiles] = await Promise.all([
        Workspaces.active(),
        Storage.preferences.get(),
        Storage.primaryIdentity.get(),
        IdentityProfiles.getAll().catch(() => ({}))
    ]);
    const labels = {};   // pubkey → {label}: the profiles' nsecs go no further than this read
    for (const [pk, p] of Object.entries(profiles || {})) labels[pk] = { label: p && p.label };
    return signerBindingState({
        method: prefs && prefs.signing_method,
        boundPubkey: ws && ws.identity_pubkey,
        livePubkey: primary && primary.pubkey,
        profiles: labels
    });
}

/** Where a mismatch is fixed — shown beside every signerBindingWarning. */
export const SIGNER_BINDING_FIX = 'Switch identities in Settings ▸ Signing, or rebind the case in Settings ▸ Advanced ▸ Cases.';

/**
 * The words every surface shows for a mismatch (the portal banner, the
 * reader's case chip and its Publish confirm) — one source so they
 * cannot drift. Null when there is nothing to warn about.
 */
export function signerBindingWarning(state) {
    if (!state || !state.mismatch) return null;
    const liveName = state.live.label ? `“${state.live.label}”` : shortPk(state.live.pubkey);
    return `This case is bound to ${nameOf(state.bound)}, but X-Ray is signing as ${nameOf(state.live)}. `
        + `Anything published now is signed by ${liveName}, not by the case's identity.`;
}

/**
 * The url sets that already make an archive record a member of this
 * case: `tagUrls` (record entities intersect the alias family) and
 * `claimUrls` (a claim's `about` names a family member). Both are
 * normalized. `familyIds` is the case's alias family.
 */
export async function memberUrlSets(caseEntityId, { articles: injectedArticles } = {}) {
    // `articles` is injectable so IDB-free callers (the dossier
    // assembler's tests inject their article set) can reuse THE union
    // membership definition without touching the archive cache.
    const [entities, allClaims, articles] = await Promise.all([
        EntityModel.getAll(),
        ClaimModel.getAll(),
        injectedArticles ? Promise.resolve(injectedArticles) : listArticles()
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
 * 28.5 — the source-manager's member model, pure over the url sets:
 * every archived record that IS a member, with HOW it is a member
 * (`tag`, `claims`, or both) — the manager renders chips from this and
 * offers tag-removal only where a tag exists (claim membership is
 * edited through claims, never silently stripped). Newest capture
 * first; counts on the face.
 *
 * @param {Array} articles  archive records
 * @param {{tagUrls:Set, claimUrls:Set}} sets  memberUrlSets output
 * @returns {{rows: Array<{rec, url, viaTag, viaClaims}>,
 *            counts: {members:number, tagOnly:number, claimBacked:number}}}
 */
export function describeMembership(articles, { tagUrls, claimUrls }) {
    const rows = [];
    for (const rec of articles || []) {
        if (!rec || !rec.url) continue;
        const url = Utils.normalizeUrl(rec.url);
        const viaTag = tagUrls.has(url);
        const viaClaims = claimUrls.has(url);
        if (!viaTag && !viaClaims) continue;
        rows.push({ rec, url, viaTag, viaClaims });
    }
    rows.sort((a, b) => (b.rec.cachedAt || 0) - (a.rec.cachedAt || 0));
    return {
        rows,
        counts: {
            members: rows.length,
            tagOnly: rows.filter((r) => r.viaTag && !r.viaClaims).length,
            claimBacked: rows.filter((r) => r.viaClaims).length
        }
    };
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

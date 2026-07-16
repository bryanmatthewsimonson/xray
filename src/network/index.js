// X-Ray Network page — Phase 25.2a/25.2b (docs/NETWORK_CLIENT_DESIGN.md).
//
// The truth-seeker surface: follow researchers by npub, pull what they
// publish, render it under the KS §8 discipline. Bundle entry →
// dist/network.bundle.js; opened via the `xray:openNetwork` message.
//
// v1 posture (design §3–§4): pull-not-live through `xray:relay:query`;
// strictly newest-first; unfollowed material collapsed to counts; npubs
// beside names everywhere; rendering never writes into local models —
// incorporation (25.3) is the only door. The feed persists in the
// droppable `xray-network` cache (25.2b) so the page opens populated;
// the "new since you last looked" strip is firstSeenAt > lastLookedAt.

import { loadFlags, isEnabled } from '../shared/metadata/feature-flags.js';
import { FollowModel } from '../shared/follow-model.js';
import { NETWORK_FEED_KINDS, buildAuthorFilters, assembleNetworkFeed } from '../shared/network-feed.js';
import { Storage } from '../shared/storage.js';
import { Crypto } from '../shared/crypto.js';
import { EntityModel } from '../shared/entity-model.js';
import { adoptForeignEntity } from '../shared/adopt-entity.js';
import { pullRelayListFor } from '../shared/entity-sync.js';
import {
    saveRecords, loadRecords, getMeta, setMeta, getProfile, setProfile,
    clearAll, LAST_LOOKED_KEY
} from './network-cache.js';
import {
    extractProposals, acceptProposal, declineProposal, declineAll,
    loadDismissals, loadIncorporated
} from '../shared/incorporation.js';
import { assembleReviewQueue } from '../shared/review-queue.js';
import { listAll as journalListAll } from '../shared/event-journal.js';

const $ = (sel) => document.querySelector(sel);
const GLOBAL = { scope: 'global' };

const KIND_LABELS = {
    30023: 'Article', 30040: 'Claim', 30054: 'Assessment', 30055: 'Link',
    30062: 'Finding', 30063: 'Verdict', 30064: 'Integrity', 30068: 'Case brief',
    32126: 'Account', 1985: 'Label'
};

const state = {
    view: 'feed',
    feed: null,          // last assembleNetworkFeed result
    follows: [],         // last-loaded global follow entries
    profiles: new Map(), // pubkey → cached kind-0 snapshot
    newSince: 0,         // items first seen after the previous look
    prevLookedAt: null,  // the cursor the current render compared against
    reviewCounts: null   // {inbound, open} for the awareness strip (25.4)
};

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function shortNpub(pubkey) {
    const npub = Crypto.hexToNpub(pubkey) || pubkey;
    return npub.length > 20 ? `${npub.slice(0, 12)}…${npub.slice(-6)}` : npub;
}

function setStatus(text) {
    const el = $('#xr-status');
    el.hidden = !text;
    el.textContent = text || '';
}

/** Configured read relays — the reader/sidepanel fallback trio. */
function getQueryRelays() {
    const FALLBACK = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'];
    return new Promise((resolve) => {
        try {
            chrome.storage.local.get(['preferences'], (res) => {
                const raw = res && res.preferences;
                let prefs = {};
                try { prefs = typeof raw === 'string' ? JSON.parse(raw) : (raw || {}); }
                catch (_) { prefs = {}; }
                const relays = Array.isArray(prefs.default_relays) && prefs.default_relays.length > 0
                    ? prefs.default_relays
                    : FALLBACK;
                resolve(relays);
            });
        } catch (_) { resolve(FALLBACK); }
    });
}

function query(relays, filter, timeoutMs = 6000) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'xray:relay:query', relays, filter, timeoutMs }, resolve);
    });
}

// ------------------------------------------------------------------
// View routing
// ------------------------------------------------------------------

function setView(name) {
    state.view = name;
    for (const btn of document.querySelectorAll('.xr-network__tab')) {
        btn.classList.toggle('xr-network__tab--active', btn.dataset.view === name);
    }
    $('#xr-feed').hidden = name !== 'feed';
    $('#xr-queue').hidden = name !== 'queue';
    $('#xr-follows').hidden = name !== 'follows';
    $('#xr-empty').hidden = true;
    if (name === 'follows') renderFollows();
    else if (name === 'queue') renderQueue();
    else renderFeed();
}

// ------------------------------------------------------------------
// Profiles (cached kind 0 — names are the author's own claim)
// ------------------------------------------------------------------

async function loadCachedProfiles(pubkeys) {
    for (const pk of pubkeys) {
        if (state.profiles.has(pk)) continue;
        try {
            const p = await getProfile(pk);
            if (p) state.profiles.set(pk, p);
        } catch (_) { /* cache miss */ }
    }
}

async function refreshProfiles(relays, pubkeys) {
    if (pubkeys.length === 0) return;
    const resp = await query(relays, { kinds: [0], authors: pubkeys, limit: Math.max(pubkeys.length, 10) });
    if (!resp || !resp.ok || !Array.isArray(resp.events)) return;
    const newestBy = new Map();
    for (const ev of resp.events) {
        const pk = (ev.pubkey || '').toLowerCase();
        const cur = newestBy.get(pk);
        if (!cur || (ev.created_at || 0) > (cur.created_at || 0)) newestBy.set(pk, ev);
    }
    for (const [pk, ev] of newestBy) {
        let content = {};
        try { content = JSON.parse(ev.content || '{}'); } catch (_) { continue; }
        const snapshot = {
            name: content.name ? String(content.name).slice(0, 200) : null,
            about: content.about ? String(content.about).slice(0, 500) : null,
            updatedAt: ev.created_at || 0
        };
        state.profiles.set(pk, snapshot);
        try { await setProfile(pk, snapshot); } catch (_) { /* cache-only */ }
    }
}

/** Display name: local label wins; then the profile's claimed name. */
function displayName(pubkey) {
    const f = state.follows.find((e) => e.pubkey === pubkey);
    if (f && f.label) return { name: f.label, claimed: false };
    const p = state.profiles.get(pubkey);
    if (p && p.name) return { name: p.name, claimed: true };
    return { name: shortNpub(pubkey), claimed: false };
}

// ------------------------------------------------------------------
// Follows view
// ------------------------------------------------------------------

async function renderFollows() {
    state.follows = await FollowModel.getSet(GLOBAL);
    await loadCachedProfiles(state.follows.map((f) => f.pubkey));
    const host = $('#xr-follow-list');
    if (state.follows.length === 0) {
        host.innerHTML = `<div class="xr-network__follows-note">No follows yet.
        Paste a researcher's npub above — their published articles, claims,
        and judgments become your feed.</div>`;
        return;
    }
    host.innerHTML = state.follows.map((f) => {
        const p = state.profiles.get(f.pubkey);
        const claimed = p && p.name && p.name !== f.label
            ? `<span class="xr-network__badge" title="Name claimed in their kind-0 profile — their assertion, not a verified fact">profile: ${escapeHtml(p.name)}</span>` : '';
        return `
        <li class="xr-network__follow" data-pk="${escapeHtml(f.pubkey)}">
            <span class="xr-network__follow-label">${escapeHtml(f.label || '(unlabeled)')}</span>
            <span class="xr-network__npub" title="${escapeHtml(Crypto.hexToNpub(f.pubkey) || f.pubkey)}">${escapeHtml(shortNpub(f.pubkey))}</span>
            ${claimed}
            <span class="xr-network__badge">${f.relayHints && f.relayHints.length ? `${f.relayHints.length} relay hint${f.relayHints.length === 1 ? '' : 's'}` : 'no relay hints'}</span>
            <button class="xr-network__btn xr-network__btn--ghost" data-action="unfollow">Unfollow</button>
        </li>`;
    }).join('');
}

async function followPubkey(raw, label) {
    const entry = await FollowModel.addFollow(GLOBAL, { pubkey: raw, label });
    // NIP-65 hint harvest is best-effort and non-blocking — hints show
    // up on the next Follows render.
    getQueryRelays().then((relays) =>
        FollowModel.harvestRelayHints(GLOBAL, entry.pubkey, { relays, pull: pullRelayListFor })
    ).catch(() => { /* best-effort */ });
    return entry;
}

async function onFollowSubmit(ev) {
    ev.preventDefault();
    const input = $('#xr-follow-input');
    const labelInput = $('#xr-follow-label');
    try {
        await followPubkey(input.value.trim(), labelInput.value.trim() || undefined);
    } catch (err) {
        setStatus(`Could not follow: ${err.message || err}`);
        return;
    }
    setStatus('');
    input.value = '';
    labelInput.value = '';
    renderFollows();
}

async function onFollowListClick(ev) {
    const btn = ev.target.closest('button[data-action="unfollow"]');
    if (!btn) return;
    const pk = btn.closest('[data-pk]')?.dataset.pk;
    if (!pk) return;
    // Unfollow keeps everything already incorporated (TC §10.4) — the
    // registry entry is the only thing removed.
    await FollowModel.removeFollow(GLOBAL, pk);
    renderFollows();
}

// ------------------------------------------------------------------
// Feed view
// ------------------------------------------------------------------

async function assembleFromRecords(records) {
    const follows = await FollowModel.followedPubkeys(GLOBAL);
    let selfPubkeys = [];
    try {
        const me = await Storage.primaryIdentity.get();
        if (me && me.pubkey) selfPubkeys = [me.pubkey];
    } catch (_) { /* feed still renders; nothing gets the self badge */ }
    const feed = assembleNetworkFeed(records.map((r) => r.event), { followedPubkeys: follows, selfPubkeys });
    // Awareness (TC §5): count items whose row first entered the cache
    // after the previous look.
    const firstSeen = new Map(records.map((r) => [r.event.id, r.firstSeenAt || 0]));
    const prev = state.prevLookedAt;
    state.newSince = (typeof prev === 'number')
        ? feed.items.filter((i) => (firstSeen.get(i.event.id) || 0) > prev).length
        : 0;
    return feed;
}

async function renderFromCache() {
    try {
        state.prevLookedAt = await getMeta(LAST_LOOKED_KEY);
        const records = await loadRecords();
        if (records.length === 0) return;
        state.follows = await FollowModel.getSet(GLOBAL);
        await loadCachedProfiles([...new Set(records.map((r) => (r.event.pubkey || '').toLowerCase()))]);
        state.feed = await assembleFromRecords(records);
        renderFeed();
    } catch (err) {
        console.warn('[X-Ray] Network cache read failed:', err);
    }
}

async function refreshFeed() {
    const follows = await FollowModel.followedPubkeys(GLOBAL);
    if (follows.length === 0) {
        state.feed = null;
        showEmpty(`Nobody followed yet. Switch to <b>Follows</b> and paste an
        npub — the feed pulls what your follows publish, on demand.`);
        return;
    }
    const relays = await getQueryRelays();
    $('#xr-footer-relays').textContent = `${relays.length} relay${relays.length === 1 ? '' : 's'} · ${follows.length} follow${follows.length === 1 ? '' : 's'} · kinds ${NETWORK_FEED_KINDS.join(', ')}`;
    setStatus(`Querying ${relays.length} relay${relays.length === 1 ? '' : 's'} across ${follows.length} follow${follows.length === 1 ? '' : 's'}…`);

    const [claimsFilter, otherFilter] = buildAuthorFilters(follows);
    const [claimsResp, otherResp] = await Promise.all([
        query(relays, claimsFilter),
        query(relays, otherFilter)
    ]);
    if (!claimsResp || !claimsResp.ok) {
        setStatus(`Query failed: ${(claimsResp && claimsResp.error) || 'no response from the service worker'}`);
        return;
    }
    const events = [
        ...(claimsResp.events || []),
        ...((otherResp && otherResp.ok && Array.isArray(otherResp.events)) ? otherResp.events : [])
    ];

    // Persist BEFORE reading back: firstSeenAt bookkeeping happens at
    // write time, and the read-back is already latest-per-address.
    state.prevLookedAt = await getMeta(LAST_LOOKED_KEY);
    try { await saveRecords(events.map((event) => ({ event, relays: [] }))); }
    catch (err) { console.warn('[X-Ray] Network cache write failed:', err); }

    state.follows = await FollowModel.getSet(GLOBAL);
    refreshProfiles(relays, follows).then(() => renderFeed()).catch(() => { /* names patch in */ });
    await loadCachedProfiles(follows);

    let records = [];
    try { records = await loadRecords(); }
    catch (_) { records = events.map((event) => ({ event, relays: [], firstSeenAt: 0 })); }
    state.feed = await assembleFromRecords(records);
    // Review awareness (25.4): counts ride the strip; details in Queue.
    try {
        const rq = assembleReviewQueue(state.feed, { myCoords: await myPublishedCoords() });
        state.reviewCounts = { inbound: rq.inbound.length, open: rq.openRequests.length };
    } catch (_) { state.reviewCounts = null; }
    setStatus('');
    renderFeed();
}

// Re-broadcast-who-you-follow (25.4, TC §2.5): re-publish verified
// cached events VERBATIM under their authors' signatures — no
// re-signing, no modification. User-initiated, capped per run, gated
// by `reviewCoordination`.
const REBROADCAST_CAP = 200;

async function onRebroadcast() {
    const btn = $('#xr-rebroadcast');
    btn.disabled = true;
    try {
        const relays = await getQueryRelays();
        const follows = new Set(await FollowModel.followedPubkeys(GLOBAL));
        const records = await loadRecords();
        const events = records
            .map((r) => r.event)
            .filter((ev2) => ev2 && ev2.sig && follows.has((ev2.pubkey || '').toLowerCase()))
            .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
            .slice(0, REBROADCAST_CAP);
        if (events.length === 0) { setStatus('Nothing cached from your follows to re-broadcast.'); return; }
        if (!confirm(`Re-broadcast ${events.length} of your follows' events to ${relays.length} relay${relays.length === 1 ? '' : 's'}? They re-publish verbatim under their authors' signatures.`)) return;
        let ok = 0;
        for (const event of events) {
            const resp = await new Promise((resolve) =>
                chrome.runtime.sendMessage({ type: 'xray:relay:publish', event, relays }, resolve));
            if (resp && resp.ok) ok++;
        }
        setStatus(`Re-broadcast ${ok}/${events.length} events.`);
    } catch (err) {
        setStatus(`Re-broadcast failed: ${err.message || err}`);
    } finally {
        btn.disabled = false;
    }
}

function showEmpty(html) {
    const el = $('#xr-empty');
    el.innerHTML = html;
    el.hidden = false;
    $('#xr-feed').innerHTML = '';
}

function rowTitle(item) {
    const p = item.parsed || {};
    switch (item.key) {
        case 'articles':    return p.title || '(untitled article)';
        case 'claims':      return p.text || p.statement || '(claim)';
        case 'assessments': return p.stance ? `${p.stance}${p.note ? ` — ${p.note}` : ''}` : '(assessment)';
        case 'links':       return p.relation || '(link)';
        case 'findings':    return p.pattern || p.summary || '(finding)';
        case 'verdicts':    return p.verdict || p.state || '(verdict)';
        case 'integrity':   return p.summary || '(integrity finding)';
        case 'briefs':      return p.title || `Case brief${p.caseId ? ` — ${p.caseId}` : ''}`;
        case 'accounts':    return p.platform && p.stableId ? `${p.platform}:${p.stableId}` : '(platform account)';
        case 'labels':      return `${p.namespace || ''} ${Array.isArray(p.values) ? p.values.join(', ') : ''}`.trim() || '(label)';
        default:            return '(event)';
    }
}

function awarenessStrip() {
    const bits = [];
    if (state.newSince) {
        const since = state.prevLookedAt
            ? ` since ${new Date(state.prevLookedAt * 1000).toISOString().slice(0, 16).replace('T', ' ')}`
            : '';
        bits.push(`✨ ${state.newSince} new item${state.newSince === 1 ? '' : 's'}${since}`);
    }
    if (state.reviewCounts && (state.reviewCounts.inbound || state.reviewCounts.open)) {
        const r = state.reviewCounts;
        if (r.inbound) bits.push(`${r.inbound} inbound review${r.inbound === 1 ? '' : 's'}`);
        if (r.open) bits.push(`${r.open} open review request${r.open === 1 ? '' : 's'}`);
        bits.push('see Queue');
    }
    return bits.length ? `<div class="xr-network__aware">${bits.join(' · ')}</div>` : '';
}

function renderFeed() {
    if (!state.feed) {
        showEmpty(`Hit <b>↻ Refresh</b> to pull the latest from your follows.
        The feed is a point-in-time snapshot — nothing streams.`);
        return;
    }
    $('#xr-empty').hidden = true;
    const { items, collapsed, capped, candidates } = state.feed;

    const groups = new Map();
    for (const item of items) {
        if (!groups.has(item.author)) groups.set(item.author, []);
        groups.get(item.author).push(item);
    }

    const parts = [awarenessStrip()];

    // Entity-ish pubkeys the feed references that you don't know yet —
    // the adopt-on-sight hook (KS.3), always prompt-gated.
    if (candidates.length > 0) {
        parts.push(`
        <div class="xr-network__collapsed">
            <div><b>Entities referenced</b> — unknown keys tagged as subjects
            by your follows; adopt to join them to your entity graph:</div>
            ${candidates.slice(0, 8).map((c) => `
            <div class="xr-network__collapsed-row" data-pk="${escapeHtml(c.pubkey)}">
                <span class="xr-network__npub">${escapeHtml(shortNpub(c.pubkey))}</span>
                <span>${c.count} ref${c.count === 1 ? '' : 's'} (${escapeHtml(c.roles.join(', '))})</span>
                <button class="xr-network__btn xr-network__btn--ghost" data-action="adopt">Adopt…</button>
            </div>`).join('')}
        </div>`);
    }

    for (const [author, rows] of groups) {
        const { name, claimed } = displayName(author);
        const cap = capped.find((c) => c.pubkey === author);
        const selfBadge = rows[0].bucket === 'self' ? '<span class="xr-network__badge xr-network__badge--self">you</span>' : '';
        const claimedBadge = claimed ? '<span class="xr-network__badge" title="Name from their kind-0 profile — their claim, not a verified fact">profile name</span>' : '';
        parts.push(`
        <section class="xr-network__group">
            <div class="xr-network__group-head">
                <span class="xr-network__group-name">${escapeHtml(name)}</span>
                <span class="xr-network__npub">${escapeHtml(shortNpub(author))}</span>
                ${selfBadge}${claimedBadge}
                <span class="xr-network__badge">${rows.length} item${rows.length === 1 ? '' : 's'}${cap ? ` (+${cap.dropped} older hidden)` : ''}</span>
            </div>
            <ol class="xr-network__rows">
                ${rows.map((item) => `
                <li class="xr-network__row">
                    <div class="xr-network__row-line">
                        <span class="xr-network__kind">${escapeHtml(KIND_LABELS[item.event.kind] || String(item.event.kind))}</span>
                        <span class="xr-network__row-title">${escapeHtml(rowTitle(item))}</span>
                        ${item.buildsOnUnfollowed ? '<span class="xr-network__badge xr-network__badge--warn" title="References material by authors you don\'t follow">builds on unfollowed</span>' : ''}
                        <span class="xr-network__row-date">${item.event.created_at ? new Date(item.event.created_at * 1000).toISOString().slice(0, 10) : ''}</span>
                    </div>
                    <details>
                        <summary>Raw event${item.coord ? ` · ${escapeHtml(item.coord)}` : ''}</summary>
                        <pre class="xr-network__raw">${escapeHtml(JSON.stringify(item.event, null, 2))}</pre>
                    </details>
                </li>`).join('')}
            </ol>
        </section>`);
    }

    if (collapsed.length > 0) {
        // KS §8: unfollowed material renders as counts only, labeled
        // untrusted. On the authors axis these are relay-unsolicited.
        parts.push(`
        <div class="xr-network__collapsed">
            <div><b>Not followed</b> — returned by relays outside your
            follow set; collapsed, untrusted:</div>
            ${collapsed.map((c) => `
            <div class="xr-network__collapsed-row" data-pk="${escapeHtml(c.pubkey)}">
                <span class="xr-network__npub">${escapeHtml(shortNpub(c.pubkey))}</span>
                <span>${c.count} event${c.count === 1 ? '' : 's'}
                (${Object.entries(c.kinds).map(([k, n]) => `${escapeHtml(KIND_LABELS[k] || k)}×${n}`).join(', ')})</span>
                <button class="xr-network__btn xr-network__btn--ghost" data-action="follow">Follow</button>
            </div>`).join('')}
        </div>`);
    }

    const content = parts.join('').trim();
    if (!content) {
        showEmpty('Your follows haven\'t published anything the feed kinds cover yet.');
        return;
    }
    $('#xr-feed').innerHTML = content;

    // Looking at the rendered feed advances the cursor — the strip
    // shows this batch's news once, then resets on the next look.
    setMeta(LAST_LOOKED_KEY, Math.floor(Date.now() / 1000)).catch(() => { /* best-effort */ });
}

async function onFeedClick(ev) {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    const pk = btn.closest('[data-pk]')?.dataset.pk;
    if (!pk) return;
    if (btn.dataset.action === 'follow') {
        try { await followPubkey(pk); } catch (err) { setStatus(`Could not follow: ${err.message || err}`); return; }
        await refreshFeed();
    }
    if (btn.dataset.action === 'adopt') {
        const relays = await getQueryRelays();
        const entities = await EntityModel.getAll().catch(() => ({}));
        const result = await adoptForeignEntity(pk, {
            query: (filter, timeoutMs) => query(relays, filter, timeoutMs),
            entities
        });
        if (result.status === 'adopted') setStatus(`Adopted ${result.entity.name} as a read-only foreign entity.`);
        else if (result.status === 'already-local') setStatus(`That key already belongs to your entity "${result.entity.name}".`);
        else if (result.status === 'failed') setStatus(`Adopt failed: ${result.error?.message || result.error}`);
    }
}

// ------------------------------------------------------------------
// Incorporation queue (25.3 — KS §6: proposals, not facts)
// ------------------------------------------------------------------

const CLASS_LABELS = { claim: 'Claim', link: 'Link', assessment: 'Assessment', verdict: 'Verdict' };

function proposalTitle(p) {
    const parsed = p.parsed || {};
    switch (p.class) {
        case 'claim':      return parsed.text || '(claim)';
        case 'link':       return parsed.relationship || '(link)';
        case 'assessment': return parsed.stance || '(assessment)';
        case 'verdict':    return parsed.verdict || '(verdict)';
        default:           return '(artifact)';
    }
}

/** Coordinates you authored — the inbound-review join (25.4). */
async function myPublishedCoords() {
    try {
        const rows = await journalListAll();
        return rows.map((r) => r.address).filter(Boolean);
    } catch (_) { return []; }
}

function reviewSections(reviewQueue) {
    const parts = [];
    if (reviewQueue.inbound.length > 0) {
        parts.push(`
        <div class="xr-network__collapsed">
            <div><b>Inbound review</b> — followed authors engaged with
            coordinates you published:</div>
            ${reviewQueue.inbound.slice(0, 12).map((item) => `
            <div class="xr-network__collapsed-row">
                <span class="xr-network__kind">${escapeHtml(KIND_LABELS[item.event.kind] || String(item.event.kind))}</span>
                <span>${escapeHtml(rowTitle(item))}</span>
                <span class="xr-network__npub">${escapeHtml(shortNpub(item.author))}</span>
            </div>`).join('')}
        </div>`);
    }
    if (reviewQueue.openRequests.length > 0) {
        parts.push(`
        <div class="xr-network__collapsed">
            <div><b>Open review requests</b> — follows asking for
            adversarial eyes (an xray/review label without a newer
            review-done):</div>
            ${reviewQueue.openRequests.slice(0, 12).map((r) => `
            <div class="xr-network__collapsed-row">
                <span class="xr-network__row-title">${escapeHtml(r.targetCoord)}</span>
                <span class="xr-network__npub">${escapeHtml(shortNpub(r.requestedBy))}</span>
                ${r.url ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noreferrer noopener">source</a>` : ''}
            </div>`).join('')}
        </div>`);
    }
    return parts.join('');
}

async function renderQueue() {
    const host = $('#xr-queue');
    if (!state.feed) {
        host.innerHTML = `<div class="xr-network__follows-note">The queue is
        built from the feed — hit <b>↻ Refresh</b> on the Feed tab first.</div>`;
        return;
    }
    const [dismissals, incorporated, myCoords] = await Promise.all([
        loadDismissals(), loadIncorporated(), myPublishedCoords()
    ]);
    const reviewQueue = assembleReviewQueue(state.feed, { myCoords });
    const { byAuthor } = extractProposals(state.feed, { dismissals, incorporated });
    if (byAuthor.length === 0 && !reviewQueue.inbound.length && !reviewQueue.openRequests.length) {
        host.innerHTML = `<div class="xr-network__follows-note">Nothing to
        review — followed claims, links, assessments, and verdicts land
        here as proposals. Accepting records provenance; declining is
        remembered. Nothing enters your corpus without you.</div>`;
        return;
    }
    host.innerHTML = reviewSections(reviewQueue) + byAuthor.map(({ author, count, proposals }) => {
        const { name } = displayName(author);
        return `
        <section class="xr-network__group" data-author="${escapeHtml(author)}">
            <div class="xr-network__group-head">
                <span class="xr-network__group-name">${escapeHtml(name)}</span>
                <span class="xr-network__npub">${escapeHtml(shortNpub(author))}</span>
                <span class="xr-network__badge">${count} proposal${count === 1 ? '' : 's'}</span>
                <button class="xr-network__btn xr-network__btn--ghost" data-action="decline-all">Decline all</button>
            </div>
            <ol class="xr-network__rows">
                ${proposals.map((p, i) => `
                <li class="xr-network__row" data-ref="${escapeHtml(p.ref)}" data-idx="${i}">
                    <div class="xr-network__row-line">
                        <span class="xr-network__kind">${CLASS_LABELS[p.class]}</span>
                        <span class="xr-network__row-title">${escapeHtml(proposalTitle(p))}</span>
                        <button class="xr-network__btn" data-action="accept">Accept</button>
                        <button class="xr-network__btn xr-network__btn--ghost" data-action="decline">Decline</button>
                    </div>
                    <details>
                        <summary>Raw event · ${escapeHtml(p.ref)}</summary>
                        <pre class="xr-network__raw">${escapeHtml(JSON.stringify(p.event, null, 2))}</pre>
                    </details>
                </li>`).join('')}
            </ol>
        </section>`;
    }).join('');
}

async function onQueueClick(ev) {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    const [dismissals, incorporated] = await Promise.all([loadDismissals(), loadIncorporated()]);
    const { byAuthor } = extractProposals(state.feed, { dismissals, incorporated });

    if (btn.dataset.action === 'decline-all') {
        const author = btn.closest('[data-author]')?.dataset.author;
        const group = byAuthor.find((g) => g.author === author);
        if (group) {
            const n = await declineAll(group.proposals);
            setStatus(`Declined ${n} proposal${n === 1 ? '' : 's'} — they won't re-surface.`);
        }
        renderQueue();
        return;
    }

    const ref = btn.closest('[data-ref]')?.dataset.ref;
    if (!ref) return;
    let proposal = null;
    for (const g of byAuthor) proposal = proposal || g.proposals.find((p) => p.ref === ref);
    if (!proposal) return;

    if (btn.dataset.action === 'accept') {
        const result = await acceptProposal(proposal);
        if (result.status === 'incorporated') {
            setStatus(`Accepted the ${CLASS_LABELS[proposal.class].toLowerCase()} — provenance recorded (nostr:${proposal.author.slice(0, 12)}…).`);
        } else {
            setStatus(`Accept failed: ${result.error?.message || result.error}`);
        }
        renderQueue();
    }
    if (btn.dataset.action === 'decline') {
        await declineProposal(proposal);
        renderQueue();
    }
}

async function onClearCache() {
    if (!confirm('Clear the cached feed? The cache is derived — the next Refresh rebuilds it from the relays. Follows are not touched.')) return;
    try { await clearAll(); } catch (_) { /* already gone */ }
    state.feed = null;
    state.newSince = 0;
    renderFeed();
}

// ------------------------------------------------------------------
// Boot
// ------------------------------------------------------------------

async function boot() {
    await loadFlags();
    if (!isEnabled('networkPage')) {
        document.querySelector('.xr-network__chrome-right').hidden = true;
        document.querySelector('.xr-network__tabs').hidden = true;
        showEmpty(`The Network page is behind the <b>networkPage</b> feature
        flag (default off). Enable it in Settings ▸ Advanced to follow
        researchers and read their published work.`);
        return;
    }
    $('#xr-refresh').addEventListener('click', refreshFeed);
    $('#xr-clear-cache').addEventListener('click', onClearCache);
    // The re-broadcast PUBLISH affordance is its own flag (25.4).
    if (isEnabled('reviewCoordination')) {
        const rb = $('#xr-rebroadcast');
        rb.hidden = false;
        rb.addEventListener('click', onRebroadcast);
    }
    $('#xr-follow-form').addEventListener('submit', onFollowSubmit);
    $('#xr-follow-list').addEventListener('click', onFollowListClick);
    $('#xr-feed').addEventListener('click', onFeedClick);
    $('#xr-queue').addEventListener('click', (ev) => { onQueueClick(ev).catch((err) => setStatus(`Queue action failed: ${err.message || err}`)); });
    for (const btn of document.querySelectorAll('.xr-network__tab')) {
        btn.addEventListener('click', () => setView(btn.dataset.view));
    }
    state.follows = await FollowModel.getSet(GLOBAL);
    setView('feed');
    await renderFromCache();   // open populated; Refresh pulls fresh
}

boot().catch((err) => {
    console.warn('[X-Ray] Network page boot failed:', err);
    setStatus(`Boot failed: ${err.message || err}`);
});

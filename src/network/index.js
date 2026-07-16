// X-Ray Network page — Phase 25.2a (docs/NETWORK_CLIENT_DESIGN.md).
//
// The truth-seeker surface: follow researchers by npub, pull what they
// publish, render it under the KS §8 discipline. Bundle entry →
// dist/network.bundle.js; opened via the `xray:openNetwork` message.
//
// v1 posture (design §3–§4): pull-not-live through `xray:relay:query`;
// strictly newest-first; unfollowed material collapsed to counts; npubs
// beside names everywhere; rendering never writes into local models —
// incorporation (25.3) is the only door.

import { loadFlags, isEnabled } from '../shared/metadata/feature-flags.js';
import { FollowModel } from '../shared/follow-model.js';
import { NETWORK_FEED_KINDS, buildAuthorFilters, assembleNetworkFeed } from '../shared/network-feed.js';
import { Storage } from '../shared/storage.js';
import { Crypto } from '../shared/crypto.js';

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
    follows: []          // last-loaded global follow entries
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
    $('#xr-follows').hidden = name !== 'follows';
    $('#xr-empty').hidden = true;
    if (name === 'follows') renderFollows();
    else renderFeed();
}

// ------------------------------------------------------------------
// Follows view
// ------------------------------------------------------------------

async function renderFollows() {
    state.follows = await FollowModel.getSet(GLOBAL);
    const host = $('#xr-follow-list');
    if (state.follows.length === 0) {
        host.innerHTML = `<div class="xr-network__follows-note">No follows yet.
        Paste a researcher's npub above — their published articles, claims,
        and judgments become your feed.</div>`;
        return;
    }
    host.innerHTML = state.follows.map((f) => `
        <li class="xr-network__follow" data-pk="${escapeHtml(f.pubkey)}">
            <span class="xr-network__follow-label">${escapeHtml(f.label || '(unlabeled)')}</span>
            <span class="xr-network__npub" title="${escapeHtml(Crypto.hexToNpub(f.pubkey) || f.pubkey)}">${escapeHtml(shortNpub(f.pubkey))}</span>
            <span class="xr-network__badge">${f.relayHints && f.relayHints.length ? `${f.relayHints.length} relay hint${f.relayHints.length === 1 ? '' : 's'}` : 'no relay hints'}</span>
            <button class="xr-network__btn xr-network__btn--ghost" data-action="unfollow">Unfollow</button>
        </li>`).join('');
}

async function onFollowSubmit(ev) {
    ev.preventDefault();
    const input = $('#xr-follow-input');
    const labelInput = $('#xr-follow-label');
    try {
        await FollowModel.addFollow(GLOBAL, {
            pubkey: input.value.trim(),
            label: labelInput.value.trim() || undefined
        });
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

    let selfPubkeys = [];
    try {
        const me = await Storage.primaryIdentity.get();
        if (me && me.pubkey) selfPubkeys = [me.pubkey];
    } catch (_) { /* feed still renders; nothing gets the self badge */ }

    state.feed = assembleNetworkFeed(events, { followedPubkeys: follows, selfPubkeys });
    setStatus('');
    renderFeed();
}

function showEmpty(html) {
    const el = $('#xr-empty');
    el.innerHTML = html;
    el.hidden = false;
    $('#xr-feed').innerHTML = '';
}

function labelFor(pubkey) {
    const f = state.follows.find((e) => e.pubkey === pubkey);
    return (f && f.label) || null;
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

function renderFeed() {
    if (!state.feed) {
        showEmpty(`Hit <b>↻ Refresh</b> to pull the latest from your follows.
        The feed is a point-in-time snapshot — nothing streams.`);
        return;
    }
    $('#xr-empty').hidden = true;
    const { items, collapsed, capped } = state.feed;

    // Group newest-first items per author, groups ordered by their
    // newest item — insertion order does exactly that.
    const groups = new Map();
    for (const item of items) {
        if (!groups.has(item.author)) groups.set(item.author, []);
        groups.get(item.author).push(item);
    }

    const parts = [];
    for (const [author, rows] of groups) {
        const label = labelFor(author);
        const cap = capped.find((c) => c.pubkey === author);
        const selfBadge = rows[0].bucket === 'self' ? '<span class="xr-network__badge xr-network__badge--self">you</span>' : '';
        parts.push(`
        <section class="xr-network__group">
            <div class="xr-network__group-head">
                <span class="xr-network__group-name">${escapeHtml(label || shortNpub(author))}</span>
                <span class="xr-network__npub">${escapeHtml(shortNpub(author))}</span>
                ${selfBadge}
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
            <div class="xr-network__collapsed-row">
                <span class="xr-network__npub">${escapeHtml(shortNpub(c.pubkey))}</span>
                <span>${c.count} event${c.count === 1 ? '' : 's'}
                (${Object.entries(c.kinds).map(([k, n]) => `${escapeHtml(KIND_LABELS[k] || k)}×${n}`).join(', ')})</span>
            </div>`).join('')}
        </div>`);
    }

    if (parts.length === 0) {
        showEmpty('Your follows haven\'t published anything the feed kinds cover yet.');
        return;
    }
    $('#xr-feed').innerHTML = parts.join('');
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
    $('#xr-follow-form').addEventListener('submit', onFollowSubmit);
    $('#xr-follow-list').addEventListener('click', onFollowListClick);
    for (const btn of document.querySelectorAll('.xr-network__tab')) {
        btn.addEventListener('click', () => setView(btn.dataset.view));
    }
    state.follows = await FollowModel.getSet(GLOBAL);
    setView('feed');
}

boot().catch((err) => {
    console.warn('[X-Ray] Network page boot failed:', err);
    setStatus(`Boot failed: ${err.message || err}`);
});

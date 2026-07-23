// Options page. Talks directly to chrome.storage.local — the same
// backing store the content-script Storage wrapper uses.
//
// Values written by the Storage wrapper are JSON-stringified, so we
// match that here: parse on read, stringify on write.

import { Storage } from '../shared/storage.js';
import { Crypto } from '../shared/crypto.js';
import { NSecBunkerClient } from '../shared/nsecbunker-client.js';
import { loadFlags, isEnabled, setOverride, resetOverrides } from '../shared/metadata/feature-flags.js';
import { formatBuildInfo } from '../shared/build-info.js';
import {
    LLM_MODELS, DEFAULT_LLM_MODEL, resolveModel, LLM_KEY_STORAGE, LLM_MODEL_STORAGE,
    LLM_SUGGEST_KINDS_STORAGE, SUGGEST_KIND_LABELS, normalizeSuggestKinds
} from '../shared/llm-prompts.js';
import { importAuditJson } from '../shared/audit/import.js';
import { articleHash as canonicalArticleHash } from '../shared/audit/article-hash.js';
import { listRuns, listPredictions, listResolutions } from '../shared/audit/audit-cache.js';
import { listArticles } from '../shared/archive-cache.js';
import { IdentityProfiles, Workspaces, workspaceBackup, resetWorkspace, identityBindingState } from '../shared/identity-profiles.js';
import { createCase } from '../shared/case-create.js';
import { EntityModel } from '../shared/entity-model.js';
import { LocalKeyManager } from '../shared/local-key-manager.js';

// Phase 24.3 — the previously-silent consequences of changing the
// primary identity, surfaced before every switch/generate/import
// (ENTITY_IDENTITY_DESIGN §6; the underlying facts are documented in
// identity-profiles.js and entity-sync.js).
const ROTATION_WARNING =
    'Switching the primary identity has consequences:\n\n' +
    '• Entity-sync blobs (kind 30078) encrypted to the OLD primary become unreadable to the new one.\n' +
    '• Existing records keep their old publish stamps — the portal attributes them per-identity.\n' +
    '• Entity keys DERIVED from the old primary cannot be re-derived from the new one (stored keys keep working — back them up first).\n' +
    '• The OwnedKeys manifest and entity profiles should be republished under the new identity.\n\n' +
    'Continue?';
import { collectBackup, applyBackup, validateBackup, estimateBackupSize, collectWorkspaceSnapshot } from '../shared/backup.js';
import { exportBundle } from '../shared/event-journal.js';

const browserApi = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

const DEFAULT_RELAYS = [
    { url: 'wss://relay.damus.io',     read: true, write: true, enabled: true },
    { url: 'wss://nos.lol',            read: true, write: true, enabled: true },
    { url: 'wss://relay.nostr.band',   read: true, write: true, enabled: true }
];

const DEFAULT_BUNKER_URL = 'ws://localhost:5454';

// ------------------------------------------------------------------
// Storage helpers (mirror Storage wrapper semantics)
// ------------------------------------------------------------------

function storageGet(key) {
    return new Promise((resolve) => {
        browserApi.storage.local.get([key], (res) => {
            const raw = res ? res[key] : undefined;
            if (raw === undefined || raw === null) return resolve(null);
            if (typeof raw === 'string') {
                try { return resolve(JSON.parse(raw)); } catch (_) { return resolve(raw); }
            }
            return resolve(raw);
        });
    });
}

function storageSet(key, value) {
    return new Promise((resolve) => {
        browserApi.storage.local.set({ [key]: JSON.stringify(value) }, () => resolve());
    });
}

function storageClearExtension() {
    const keys = [
        // Legacy userscript-era stores whose Settings tabs were removed —
        // still cleared so "erase all" purges any data left over from before.
        'publications', 'people', 'organizations', 'keypair_registry',
        'preferences',
        'local_primary_identity', 'xr_signing_state',
        // Phase 14.5: the LLM-assist secret key + model preference. The
        // key is a secret, so "erase all" must clear it too.
        LLM_KEY_STORAGE, LLM_MODEL_STORAGE
    ];
    return new Promise((resolve) => {
        browserApi.storage.local.remove(keys, () => resolve());
    });
}

// ------------------------------------------------------------------
// LLM assist — raw (un-wrapped) storage for the secret key + model.
// The SW client reads these as PLAIN strings (not JSON), so write them
// the same way. The key value is never echoed back into the page.
// ------------------------------------------------------------------

function llmRawGet(key) {
    return new Promise((resolve) => {
        browserApi.storage.local.get([key], (res) => {
            const v = res ? res[key] : undefined;
            resolve(typeof v === 'string' ? v : '');
        });
    });
}

function llmRawSet(key, value) {
    return new Promise((resolve) => {
        browserApi.storage.local.set({ [key]: value }, () => resolve());
    });
}

function llmRawRemove(key) {
    return new Promise((resolve) => {
        browserApi.storage.local.remove([key], () => resolve());
    });
}

// ------------------------------------------------------------------
// Tabs
// ------------------------------------------------------------------

function wireTabs() {
    const tabs = document.querySelectorAll('.xr-opt__tab');
    const sections = document.querySelectorAll('.xr-opt__section');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            tabs.forEach(t => t.classList.toggle('xr-opt__tab--active', t === tab));
            sections.forEach(s => s.classList.toggle('xr-opt__section--active', s.dataset.section === target));
        });
    });
}

function activateTab(name) {
    document.querySelectorAll('.xr-opt__tab').forEach(t =>
        t.classList.toggle('xr-opt__tab--active', t.dataset.tab === name));
    document.querySelectorAll('.xr-opt__section').forEach(s =>
        s.classList.toggle('xr-opt__section--active', s.dataset.section === name));
}

function flash(el, msg, ok = true) {
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('xr-opt__status--ok', ok);
    el.classList.toggle('xr-opt__status--err', !ok);
    setTimeout(() => {
        el.textContent = '';
        el.classList.remove('xr-opt__status--ok', 'xr-opt__status--err');
    }, 3000);
}

// ------------------------------------------------------------------
// Relays
// ------------------------------------------------------------------

let _relayState = []; // [{url, read, write, enabled}]

async function loadRelays() {
    // Read structured shape if present, else fall back to default_relays.
    const prefs = (await storageGet('preferences')) || {};
    if (Array.isArray(prefs.relays) && prefs.relays.length > 0) {
        _relayState = prefs.relays.map((r) => ({
            url: String(r && r.url || ''),
            read: r && r.read !== false,
            write: r && r.write !== false,
            enabled: r && r.enabled !== false
        })).filter((r) => r.url);
    } else if (Array.isArray(prefs.default_relays) && prefs.default_relays.length > 0) {
        _relayState = prefs.default_relays.map((url) => ({
            url, read: true, write: true, enabled: true
        }));
    } else {
        _relayState = DEFAULT_RELAYS.map((r) => ({ ...r }));
    }
    renderRelays();
}

function renderRelays() {
    const rows = document.getElementById('relays-rows');
    rows.innerHTML = '';
    _relayState.forEach((relay, i) => {
        const row = document.createElement('div');
        row.className = 'xr-opt__relays-row';
        row.setAttribute('role', 'row');
        row.innerHTML = `
            <input type="text" data-i="${i}" data-field="url" value="${escapeAttr(relay.url)}" spellcheck="false" />
            <input type="checkbox" data-i="${i}" data-field="read" ${relay.read ? 'checked' : ''} />
            <input type="checkbox" data-i="${i}" data-field="write" ${relay.write ? 'checked' : ''} />
            <input type="checkbox" data-i="${i}" data-field="enabled" ${relay.enabled ? 'checked' : ''} />
            <button class="xr-opt__btn" data-action="remove" data-i="${i}">Remove</button>
        `;
        rows.appendChild(row);
    });
    rows.querySelectorAll('input').forEach((el) => {
        el.addEventListener('change', onRelayFieldChange);
    });
    rows.querySelectorAll('[data-action="remove"]').forEach((el) => {
        el.addEventListener('click', onRelayRemove);
    });
}

function escapeAttr(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function onRelayFieldChange(ev) {
    const i = +ev.target.dataset.i;
    const field = ev.target.dataset.field;
    if (!_relayState[i]) return;
    if (field === 'url') _relayState[i].url = ev.target.value.trim();
    else _relayState[i][field] = ev.target.checked;
}

function onRelayRemove(ev) {
    const i = +ev.target.dataset.i;
    _relayState.splice(i, 1);
    renderRelays();
}

function onRelayAdd() {
    const input = document.getElementById('relays-add-url');
    const url = input.value.trim();
    const status = document.getElementById('relays-status');
    if (!url) { flash(status, 'Enter a URL', false); return; }
    if (!/^wss?:\/\//i.test(url)) { flash(status, 'Must start with wss:// or ws://', false); return; }
    if (_relayState.some((r) => r.url === url)) { flash(status, 'Already in list', false); return; }
    _relayState.push({ url, read: true, write: true, enabled: true });
    input.value = '';
    renderRelays();
}

async function saveRelays() {
    const status = document.getElementById('relays-status');
    const invalid = _relayState.find((r) => !/^wss?:\/\//i.test(r.url));
    if (invalid) { flash(status, `Not a ws/wss URL: ${invalid.url}`, false); return; }
    const prefs = (await storageGet('preferences')) || {};
    prefs.relays = _relayState.map((r) => ({ ...r }));
    // Keep default_relays in sync so existing readers (nostr-client.js etc.)
    // continue to see only enabled+writable URLs.
    prefs.default_relays = _relayState
        .filter((r) => r.enabled && r.write)
        .map((r) => r.url);
    await storageSet('preferences', prefs);
    flash(status, 'Saved.');
}

function resetRelays() {
    _relayState = DEFAULT_RELAYS.map((r) => ({ ...r }));
    renderRelays();
}

// ------------------------------------------------------------------
// Signing
// ------------------------------------------------------------------

async function loadSigning() {
    const prefs = (await storageGet('preferences')) || {};
    const method = (prefs.signing_method === 'nip07' || prefs.signing_method === 'nsecbunker')
        ? prefs.signing_method
        : 'local';
    document.querySelectorAll('input[name="signing-method"]').forEach((r) => {
        r.checked = r.value === method;
    });
    document.getElementById('bunker-url').value = prefs.nsecbunker_url || DEFAULT_BUNKER_URL;
    refreshSigningPanels();
    await refreshLocalKeyState();
    await refreshActiveLine();
    await refreshNip07State();

    // First-run banner
    const banner = document.getElementById('signing-firstrun');
    banner.style.display = prefs.signing_method_configured ? 'none' : '';
}

function selectedMethod() {
    const r = document.querySelector('input[name="signing-method"]:checked');
    return r ? r.value : 'local';
}

function refreshSigningPanels() {
    const method = selectedMethod();
    document.getElementById('signing-panel-local').style.display       = method === 'local' ? '' : 'none';
    document.getElementById('signing-panel-nip07').style.display       = method === 'nip07' ? '' : 'none';
    document.getElementById('signing-panel-nsecbunker').style.display  = method === 'nsecbunker' ? '' : 'none';
}

async function saveSigning() {
    const method = selectedMethod();
    const status = document.getElementById('signing-status');
    const url = document.getElementById('bunker-url').value.trim();
    if (method === 'nsecbunker' && url && !/^wss?:\/\//i.test(url)) {
        flash(status, 'NSecBunker URL must start with ws:// or wss://', false);
        return;
    }
    const prefs = (await storageGet('preferences')) || {};
    prefs.signing_method = method;
    prefs.signing_method_configured = true;
    if (url) prefs.nsecbunker_url = url;
    await storageSet('preferences', prefs);
    document.getElementById('signing-firstrun').style.display = 'none';
    flash(status, 'Saved.');
    await refreshActiveLine();
}

async function refreshActiveLine() {
    const el = document.getElementById('signing-active');
    const prefs = (await storageGet('preferences')) || {};
    const method = (prefs.signing_method === 'nip07' || prefs.signing_method === 'nsecbunker')
        ? prefs.signing_method
        : 'local';
    if (!prefs.signing_method_configured) {
        el.textContent = 'Active method: not configured yet — pick one below.';
        return;
    }
    if (method === 'local') {
        const id = await storageGet('local_primary_identity');
        el.textContent = id && id.npub
            ? `Active method: Local — ${id.npub}`
            : 'Active method: Local — no key yet';
    } else if (method === 'nip07') {
        el.textContent = 'Active method: NIP-07 (browser extension)';
    } else if (method === 'nsecbunker') {
        el.textContent = `Active method: NSecBunker — ${prefs.nsecbunker_url || '(no URL set)'}`;
    }
}

function truncNpub(npub) {
    return npub ? npub.slice(0, 14) + '…' + npub.slice(-6) : '—';
}

async function refreshLocalKeyState() {
    const el = document.getElementById('local-key-state');
    const { identity, profile, saved } = await IdentityProfiles.active();
    if (identity && identity.npub) {
        const label = saved ? escapeAttr(profile.label) : 'unsaved identity';
        el.innerHTML = `Active: <strong>${label}</strong> — <code>${escapeAttr(truncNpub(identity.npub))}</code>`;
    } else {
        el.textContent = 'No key yet — create a new identity below.';
    }
    document.getElementById('identity-save-current').style.display =
        (identity && !saved) ? '' : 'none';
    await renderIdentityList(identity);
    document.getElementById('local-export-row').style.display = 'none';
    document.getElementById('local-export-pre').textContent = '';
}

async function renderIdentityList(activeIdentity) {
    const host = document.getElementById('identity-list');
    const profiles = await IdentityProfiles.list();
    if (!profiles.length) { host.innerHTML = ''; return; }
    const activePk = activeIdentity ? activeIdentity.pubkey : null;
    host.innerHTML = profiles.map((p) => {
        const isActive = p.pubkey === activePk;
        return `<div class="xr-opt__identity-row${isActive ? ' xr-opt__identity-row--active' : ''}" data-pubkey="${escapeAttr(p.pubkey)}">
            <span class="xr-opt__identity-label">${escapeAttr(p.label)}</span>
            <code class="xr-opt__identity-npub">${escapeAttr(truncNpub(p.npub))}</code>
            ${isActive
        ? '<span class="xr-opt__identity-active">active</span>'
        : '<button type="button" class="xr-opt__btn xr-opt__btn--small" data-act="use">Use</button>'}
            <button type="button" class="xr-opt__btn xr-opt__btn--small" data-act="copy">Copy npub</button>
            ${isActive ? '' : '<button type="button" class="xr-opt__btn xr-opt__btn--small xr-opt__btn--danger" data-act="remove">Remove</button>'}
        </div>`;
    }).join('');
    host.querySelectorAll('button[data-act]').forEach((btn) => {
        btn.addEventListener('click', () => onIdentityAction(btn));
    });
}

async function onIdentityAction(btn) {
    const status = document.getElementById('local-status');
    const row = btn.closest('.xr-opt__identity-row');
    const pubkey = row && row.getAttribute('data-pubkey');
    const act = btn.getAttribute('data-act');
    try {
        if (act === 'use') {
            if (!confirm(ROTATION_WARNING)) return;
            const profile = await IdentityProfiles.activate(pubkey);
            flash(status, `Switched to "${profile.label}". New captures publish under this identity; existing records keep their old stamps — use Start fresh workspace (Advanced) for a clean slate.`);
        } else if (act === 'copy') {
            const all = await IdentityProfiles.getAll();
            const p = all[pubkey];
            if (p && p.npub) await navigator.clipboard.writeText(p.npub);
            flash(status, 'npub copied.');
            return;
        } else if (act === 'remove') {
            const all = await IdentityProfiles.getAll();
            const p = all[pubkey];
            if (!confirm(`Remove profile "${p ? p.label : pubkey}"? Its nsec is deleted with it — back it up first if you might need it again.`)) return;
            await IdentityProfiles.remove(pubkey);
            flash(status, 'Profile removed.');
        }
        await refreshLocalKeyState();
        await refreshActiveLine();
    } catch (e) {
        flash(status, (e && e.message) || String(e), false);
    }
}

async function identityCreate() {
    const status = document.getElementById('local-status');
    const label = document.getElementById('identity-new-label').value;
    if (!confirm(ROTATION_WARNING)) return;
    try {
        const profile = await IdentityProfiles.create(label);
        document.getElementById('identity-new-label').value = '';
        document.getElementById('identity-new-row').style.display = 'none';
        flash(status, `Created and switched to "${profile.label}".`);
        await refreshLocalKeyState();
        await refreshActiveLine();
    } catch (e) {
        flash(status, 'Create failed: ' + (e && e.message), false);
    }
}

// Phase 24.3 — the keystore-loss recovery surface for
// EntityModel.restoreDerivedKeys (ENTITY_IDENTITY_DESIGN §3): re-derive
// every missing owned entity key from the active primary. Derived-era
// entities recover their ORIGINAL pubkey; legacy random keys re-derive
// to a new one (reported, never hidden).
async function restoreEntityKeys() {
    const status = document.getElementById('local-status');
    try {
        await LocalKeyManager.init();
        const { restored, skipped } = await EntityModel.restoreDerivedKeys();
        // CW.4: entities derived under a DIFFERENT identity profile are
        // refused, loudly — restoring them here would mint wrong pubkeys.
        const skipNote = skipped.length
            ? ` ${skipped.length} entit${skipped.length === 1 ? 'y belongs' : 'ies belong'} to a DIFFERENT identity profile`
                + ` (${skipped.map((s) => s.name).join(', ')}) — switch to that profile to restore them.`
            : '';
        const unverified = restored.filter((r) => !r.verified).length;
        const unverifiedNote = unverified
            ? ` ${unverified} had no recorded origin — verify their pubkeys against published events`
                + ' (entities created before key derivation come back with a NEW pubkey).'
            : '';
        if (restored.length === 0 && skipped.length === 0) {
            flash(status, 'Nothing to restore — every owned entity already has its key.');
        } else if (restored.length === 0) {
            flash(status, `Nothing restored.${skipNote}`, false);
        } else {
            flash(status, `Restored ${restored.length} entity key${restored.length === 1 ? '' : 's'}: `
                + restored.map((r) => r.name).join(', ') + '.' + unverifiedNote + skipNote,
                skipped.length === 0);
        }
    } catch (e) {
        flash(status, 'Restore failed: ' + (e && e.message), false);
    }
}

async function identitySaveCurrent() {
    const status = document.getElementById('local-status');
    const label = prompt('Label for the current identity (e.g. "Personal"):');
    if (label === null) return;
    try {
        const profile = await IdentityProfiles.saveCurrent(label);
        flash(status, `Saved as "${profile.label}".`);
        await refreshLocalKeyState();
    } catch (e) {
        flash(status, 'Save failed: ' + (e && e.message), false);
    }
}

async function refreshNip07State() {
    const el = document.getElementById('nip07-state');
    const state = await storageGet('xr_signing_state');
    if (state && state.method === 'nip07' && state.pubkey) {
        el.textContent = `Detected — pubkey ${state.pubkey.slice(0, 16)}…`;
    } else if (state && state.method === 'nip07-missing') {
        el.textContent = 'Not detected on the last visited tab.';
    } else {
        el.textContent = 'Status unknown — open any page with X-Ray loaded to detect.';
    }
}

async function localImport() {
    const status = document.getElementById('local-status');
    const value = document.getElementById('local-import-input').value;
    const label = document.getElementById('local-import-label').value || 'Imported';
    if (!confirm(ROTATION_WARNING)) return;
    try {
        const profile = await IdentityProfiles.importNsec(label, value);
        document.getElementById('local-import-input').value = '';
        document.getElementById('local-import-label').value = '';
        document.getElementById('local-import-row').style.display = 'none';
        flash(status, `Imported and switched to "${profile.label}".`);
        await refreshLocalKeyState();
        await refreshActiveLine();
    } catch (e) {
        flash(status, 'Import failed: ' + (e && e.message), false);
    }
}

async function localExportShow() {
    const status = document.getElementById('local-status');
    const id = await storageGet('local_primary_identity');
    if (!id || !id.nsec) { flash(status, 'No key to export.', false); return; }
    const row = document.getElementById('local-export-row');
    const pre = document.getElementById('local-export-pre');
    pre.textContent = id.nsec;
    row.style.display = '';
}

async function localExportCopy() {
    const status = document.getElementById('local-status');
    const text = document.getElementById('local-export-pre').textContent;
    try {
        await navigator.clipboard.writeText(text);
        flash(status, 'Copied to clipboard.');
    } catch (e) {
        flash(status, 'Copy failed: ' + (e && e.message), false);
    }
}

// ------------------------------------------------------------------
// Workspace (Advanced): backup download + fresh-workspace reset
// ------------------------------------------------------------------

function downloadJson(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function workspaceDownloadBackup() {
    const status = document.getElementById('workspace-status');
    try {
        const snapshot = await workspaceBackup();
        downloadJson(snapshot, `xray-workspace-${new Date().toISOString().slice(0, 10)}.json`);
        flash(status, 'Backup downloaded. It contains private keys — store it like an nsec.');
    } catch (e) {
        flash(status, 'Backup failed: ' + (e && e.message), false);
    }
}

// ------------------------------------------------------------------
// Case-bound workspaces (28.1b) — list / create / bind / activate /
// delete. Lifecycle rules live HERE: activate confirms and reloads;
// delete = typed label + snapshot download first (§7 Q2); binding the
// active workspace to the current identity/case is the generic form
// of §7 Q3's retro-bind (one click while the right things are active).
// ------------------------------------------------------------------

function wsBtn(label, danger = false) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'xr-opt__btn' + (danger ? ' xr-opt__btn--danger' : '');
    b.textContent = label;
    return b;
}

async function renderWorkspaces() {
    const host = document.getElementById('ws-list');
    const status = document.getElementById('ws-status');
    if (!host) return;
    const [list, profiles, active, primary] = await Promise.all([
        Workspaces.list(), IdentityProfiles.getAll(),
        Storage.activeWorkspaceId(), Storage.primaryIdentity.get()
    ]);
    host.replaceChildren();
    for (const ws of list) {
        const isActive = ws.id === active;
        // Binding health — 'unbound' | 'bound' | 'missing'. A restore
        // replaces `identity_profiles`, so bindings can DANGLE; the row
        // must say so instead of masking it as "unbound" (2026-07-20).
        const idState = identityBindingState(ws, profiles);
        const profile = idState === 'bound' ? profiles[ws.identity_pubkey] : null;
        const row = document.createElement('div');
        row.className = 'xr-opt__wsrow' + (isActive ? ' xr-opt__wsrow--active' : '');

        const title = document.createElement('span');
        title.className = 'xr-opt__wsname';
        title.textContent = ws.label;
        title.title = ws.id;
        row.appendChild(title);

        // A bound case's NAME resolves only inside its own namespace —
        // foreign workspaces show the binding state, not a guessed name.
        // For the ACTIVE row an unresolvable binding is DANGLING (the
        // restore incident: the registry was replaced under it) and is
        // reported as missing, which flips the binder into repair mode.
        let caseName = null;
        let caseDangling = false;
        if (isActive && ws.case_entity_id) {
            const ent = await EntityModel.get(ws.case_entity_id).catch(() => null);
            caseName = (ent && ent.name) || null;
            caseDangling = !caseName;
        }
        const identityMeta = idState === 'bound' ? `identity: ${profile.label}`
            : idState === 'missing' ? `identity: MISSING (was ${ws.identity_pubkey.slice(0, 8)}…)`
            : 'identity: unbound';
        const caseMeta = !ws.case_entity_id ? 'case: unbound'
            : caseDangling ? 'case: MISSING (binding does not resolve here)'
            : `case: ${caseName || '(bound)'}`;
        const meta = document.createElement('span');
        meta.className = 'xr-opt__wsmeta';
        meta.textContent = ` — ${identityMeta} · ${caseMeta}`;
        row.appendChild(meta);

        if (isActive) {
            const badge = document.createElement('span');
            badge.className = 'xr-opt__wsbadge';
            badge.textContent = 'ACTIVE';
            row.appendChild(badge);
        }

        const actions = document.createElement('span');
        actions.className = 'xr-opt__wsactions';
        if (isActive) {
            // The binding selects are ALWAYS present on the active row —
            // a healthy binding is changeable, not locked (2026-07-21:
            // the repair-only gating left a bound slot with no control
            // at all). Rebinding the ACTIVE workspace's identity
            // switches the live signer with it — the same atomic move
            // activate() makes — so it confirms and reloads.
            const idSel = document.createElement('select');
            idSel.title = 'The signing identity bound to this workspace';
            if (idState !== 'bound') {
                const lead = new Option(
                    idState === 'missing' ? `identity MISSING (was ${ws.identity_pubkey.slice(0, 8)}…)`
                        : Object.keys(profiles).length ? 'Bind an identity…' : 'No saved identities yet', '');
                lead.disabled = true;
                lead.selected = true;
                idSel.appendChild(lead);
            }
            for (const p of Object.values(profiles)) {
                const opt = new Option(`Identity: ${p.label}`, p.pubkey);
                if (idState === 'bound' && p.pubkey === ws.identity_pubkey) opt.selected = true;
                idSel.appendChild(opt);
            }
            if (ws.identity_pubkey) idSel.appendChild(new Option('— No identity binding —', '__clear__'));
            idSel.addEventListener('change', async () => {
                const v = idSel.value;
                if (!v || v === ws.identity_pubkey) return;
                try {
                    if (v === '__clear__') {
                        await Workspaces.update(ws.id, { identityPubkey: null });
                        flash(status, `Unbound the identity from "${ws.label}" — the current signer stays active.`);
                        renderWorkspaces();
                        return;
                    }
                    const target = profiles[v];
                    if (primary && primary.pubkey === v) {
                        // Binding the identity that is already live —
                        // nothing else changes, so no reload.
                        await Workspaces.update(ws.id, { identityPubkey: v });
                        flash(status, `Bound "${ws.label}" to identity "${target.label}".`);
                        renderWorkspaces();
                        return;
                    }
                    // This path SWITCHES the primary identity, so it owes
                    // the same Phase-24.3 disclosure every other switch
                    // site shows (Signing ▸ use/create/import). Without
                    // it this select would be a second, quieter door to
                    // a rotation with real consequences.
                    if (!confirm(`Bind workspace "${ws.label}" to identity "${target.label}"?\n\nThis workspace is active, so the live signing identity switches to "${target.label}" now. Reload any open X-Ray tabs afterwards.\n\n${ROTATION_WARNING}`)) {
                        renderWorkspaces();
                        return;
                    }
                    await Workspaces.update(ws.id, { identityPubkey: v });
                    await IdentityProfiles.activate(v);
                    location.reload();
                } catch (e) { flash(status, 'Rebind failed: ' + (e && e.message), false); }
            });
            actions.appendChild(idSel);

            const sel = document.createElement('select');
            sel.title = 'The case bound to this workspace';
            const cases = Object.values(await EntityModel.getAll()).filter((e) => e.type === 'case');
            const boundCase = ws.case_entity_id && !caseDangling ? ws.case_entity_id : null;
            if (!boundCase) {
                const lead = new Option(
                    caseDangling ? 'case MISSING — rebind…'
                        : cases.length ? 'Bind a case…' : 'No case entities yet', '');
                lead.disabled = true;
                lead.selected = true;
                sel.appendChild(lead);
            }
            for (const c of cases) {
                const opt = new Option(`Case: ${c.name}`, c.id);
                if (c.id === boundCase) opt.selected = true;
                sel.appendChild(opt);
            }
            if (ws.case_entity_id) sel.appendChild(new Option('— No case binding —', '__clear__'));
            sel.addEventListener('change', async () => {
                const v = sel.value;
                if (!v || v === ws.case_entity_id) return;
                try {
                    // The case confirms name what the binding actually
                    // governs and say plainly that nothing moves —
                    // membership is tag∪claim on the records, so the
                    // fear a user brings to this control ("do I lose
                    // the case?") is answered in the dialog itself. A
                    // DEAD binding clears without a prompt: there is
                    // nothing to lose and it is a repair, not a change.
                    if (v === '__clear__') {
                        if (boundCase && !confirm(`Unbind case "${caseName}" from "${ws.label}"?\n\nNothing is deleted or moved — the case and its records stay in this workspace. New captures stop auto-joining it, Suggest loses its case frame, and it leaves the portal's cross-workspace view until rebound.`)) {
                            renderWorkspaces();
                            return;
                        }
                        await Workspaces.update(ws.id, { caseEntityId: null });
                        flash(status, boundCase ? `Unbound the case from "${ws.label}".`
                            : `Cleared the dead case binding on "${ws.label}".`);
                    } else {
                        const next = cases.find((c) => c.id === v);
                        if (boundCase && !confirm(`Rebind workspace "${ws.label}" from case "${caseName}" to "${next ? next.name : v}"?\n\nNew captures auto-join the new case from now on. Existing membership tags keep pointing at "${caseName}"; nothing is deleted or moved.`)) {
                            renderWorkspaces();
                            return;
                        }
                        await Workspaces.update(ws.id, { caseEntityId: v });
                        flash(status, `Bound the case to "${ws.label}".`);
                    }
                    renderWorkspaces();
                } catch (e) { flash(status, 'Rebind failed: ' + (e && e.message), false); }
            });
            actions.appendChild(sel);
        } else {
            const actBtn = wsBtn('Activate');
            actBtn.addEventListener('click', async () => {
                // A dead identity binding would make activate() refuse
                // (correctly — never sign under a guessed key). Offer
                // the consented repair instead of a dead end: clear the
                // binding, then switch. The signer stays whatever is
                // currently active until the user rebinds.
                if (idState === 'missing') {
                    if (!confirm(`Switch to workspace "${ws.label}"?\n\nIts bound signing identity no longer exists (the profile was deleted or replaced by a restore). Switching will CLEAR the dead identity binding — the current signer stays active until you rebind one. Reload any open X-Ray tabs afterwards.`)) return;
                    try {
                        await Workspaces.update(ws.id, { identityPubkey: null });
                        await Workspaces.activate(ws.id);
                        location.reload();
                    } catch (e) { flash(status, 'Switch failed: ' + (e && e.message), false); }
                    return;
                }
                if (!confirm(`Switch to workspace "${ws.label}"?\n\nThis moves the storage namespace AND the signing identity together. Reload any open X-Ray tabs afterwards.`)) return;
                try {
                    await Workspaces.activate(ws.id);
                    location.reload();
                } catch (e) { flash(status, 'Switch failed: ' + (e && e.message), false); }
            });
            actions.appendChild(actBtn);
            if (ws.id !== 'default') {
                const delBtn = wsBtn('Delete…', true);
                delBtn.addEventListener('click', () => deleteWorkspaceFlow(ws));
                actions.appendChild(delBtn);
            }
        }
        row.appendChild(actions);
        host.appendChild(row);
    }

    // The owner picker: the CURRENT saved profile is the default (a
    // profile owns its cases), then the other profiles, then the two
    // escape hatches — mint a fresh identity for this case, or bind no
    // identity at all (NIP-07 / keep whatever signer is active).
    const profSel = document.getElementById('ws-new-profile');
    if (profSel) {
        profSel.replaceChildren();
        for (const p of Object.values(profiles)) {
            const opt = new Option(`Owner: ${p.label}`, p.pubkey);
            if (primary && primary.pubkey === p.pubkey) opt.selected = true;
            profSel.appendChild(opt);
        }
        profSel.appendChild(new Option('New identity for this case', 'new'));
        profSel.appendChild(new Option('No identity binding (keep current signer)', ''));
    }
}

// One-step "New case" (the 28.x simplification): workspace + identity +
// case entity + scope + binding in a single verb, then reload into the
// new case. The mechanics live in shared/case-create.js.
async function createCaseFlow() {
    const status = document.getElementById('ws-status');
    const nameEl = document.getElementById('ws-new-label');
    const scopeEl = document.getElementById('ws-new-scope');
    const profSel = document.getElementById('ws-new-profile');
    const name = nameEl.value.trim();
    if (!name) { flash(status, 'Name the case first.', false); return; }
    const sel = profSel ? profSel.value : '';
    if (!confirm(`Create the case "${name}"?\n\nThis creates its workspace, switches you into it (storage namespace + signing identity together), and binds the case automatically. Reload any other open X-Ray tabs afterwards.`)) return;
    try {
        await createCase({
            caseName: name,
            scopeQuestion: scopeEl ? scopeEl.value.trim() : '',
            profilePubkey: sel && sel !== 'new' ? sel : null,
            newProfileLabel: sel === 'new' ? name : null
        });
        location.reload();
    } catch (e) { flash(status, 'Create failed: ' + (e && e.message), false); }
}

async function deleteWorkspaceFlow(ws) {
    const status = document.getElementById('ws-status');
    const typed = prompt(
        `Delete workspace "${ws.label}"?\n\n` +
        'Its backup downloads first (restorable into any workspace). This removes its ' +
        'entities (with their keypairs), claims, archive, audits, and signed-event ' +
        'journal from this device. Published events stay on the relays.\n\n' +
        `Type the label (${ws.label}) to continue.`);
    if (typed === null) return;
    if (String(typed).trim() !== ws.label) { flash(status, 'Not deleted — the label did not match.', false); return; }
    try {
        downloadJson(await collectWorkspaceSnapshot(ws.id),
            `xray-workspace-${ws.label.replace(/[^a-z0-9-]+/gi, '-')}-${new Date().toISOString().slice(0, 10)}.json`);
        await Workspaces.remove(ws.id);
        flash(status, `Deleted "${ws.label}" — its backup downloaded first.`);
        renderWorkspaces();
    } catch (e) { flash(status, 'Delete failed: ' + (e && e.message), false); }
}

async function workspaceResetFlow() {
    const status = document.getElementById('workspace-status');
    const typed = prompt(
        'Start a fresh workspace?\n\n' +
        'CLEARS: entities (+ their keypairs and the entity-sync key), claims, ' +
        'evidence links, assessments, forensic findings, truth adjudications, ' +
        'platform accounts, portal viewer npubs, the archive cache, audit ' +
        'records (audits cost money to recompute!), the signed-event ' +
        'journal, and the portal/network relay caches (rebuildable — they ' +
        'would otherwise keep showing the old project).\n\n' +
        'KEEPS: settings, relays, feature flags, the LLM key, and your saved ' +
        'identities.\n\n' +
        'Close every other X-Ray tab first — an open portal tab can block ' +
        'the cache deletion until it closes.\n\n' +
        'A backup will download first. Type RESET to continue.');
    if (typed === null) return;
    if (String(typed).trim().toUpperCase() !== 'RESET') {
        flash(status, 'Not reset — confirmation text did not match.', false);
        return;
    }
    try {
        downloadJson(await workspaceBackup(), `xray-workspace-${new Date().toISOString().slice(0, 10)}.json`);
        const result = await resetWorkspace();
        flash(status, `Fresh workspace: cleared ${result.cleared.length} stores and ${result.databases.length} caches. Reload any open X-Ray pages.`);
        await refreshLocalKeyState();
        await refreshActiveLine();
    } catch (e) {
        flash(status, 'Reset failed: ' + (e && e.message), false);
    }
}

// ------------------------------------------------------------------
// Full backup (Advanced): export / restore / signed-events bundle
// ------------------------------------------------------------------

function fmtBytes(n) {
    if (!Number.isFinite(n) || n < 0) return '?';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Fire-and-forget: sizes the source-bytes checkbox label so the default-ON
// choice is informed. Failure just leaves the label empty.
async function refreshBackupEstimate() {
    const el = document.getElementById('backup-size-estimate');
    if (!el) return;
    try {
        const est = await estimateBackupSize();
        el.textContent = est.sourceDocCount
            ? `— ${est.sourceDocCount} document(s); backup ≈ ${fmtBytes(est.withBytes)} with, ${fmtBytes(est.withoutBytes)} without`
            : `— none stored; backup ≈ ${fmtBytes(est.withoutBytes)}`;
    } catch (_) {
        el.textContent = '';
    }
}

async function backupDownloadFull() {
    const status = document.getElementById('backup-status');
    const includeSourceBytes = document.getElementById('backup-include-bytes').checked;
    flash(status, 'Building backup…');
    try {
        const backup = await collectBackup({ includeSourceBytes });
        downloadJson(backup, `xray-backup-${new Date().toISOString().slice(0, 10)}.json`);
        flash(status, 'Backup downloaded. It contains private keys — store it like an nsec.');
    } catch (e) {
        flash(status, 'Backup failed: ' + (e && e.message), false);
    }
}

async function backupRestoreFromFile(file) {
    const status = document.getElementById('backup-status');
    try {
        const parsed = JSON.parse(await file.text());
        const problems = validateBackup(parsed);
        if (problems.length) throw new Error(problems.join('; '));
        const storageKeys = Object.keys(parsed.storage || {}).length;
        const dbNames = Object.keys(parsed.databases || {}).join(', ') || 'none';
        const typed = prompt(
            'Restore from backup?\n\n' +
            `REPLACES the current workspace, settings, identities, archive, and ` +
            `journal with the backup's contents (${storageKeys} storage keys; ` +
            `databases: ${dbNames}; exported ${parsed.exportedAt || 'unknown'}).\n\n` +
            'A safety backup of the CURRENT data downloads first. Your LLM API ' +
            'key is untouched.\n\nType RESTORE to continue.');
        if (typed === null) return;
        if (String(typed).trim().toUpperCase() !== 'RESTORE') {
            flash(status, 'Not restored — confirmation text did not match.', false);
            return;
        }
        flash(status, 'Downloading safety backup…');
        downloadJson(await collectBackup({ includeSourceBytes: true }),
            `xray-backup-safety-${new Date().toISOString().slice(0, 10)}.json`);
        flash(status, 'Restoring…');
        await applyBackup(parsed, { warn: (m) => console.warn('[X-Ray Options]', m) });
        flash(status, 'Restored — reloading…');
        setTimeout(() => location.reload(), 1200);
    } catch (e) {
        flash(status, 'Restore failed: ' + (e && e.message), false);
    }
}

// The win-plan §5.1 durability artifact: every published event, verbatim
// signed JSON, replayable by anyone against any relay. No keys inside.
async function backupExportEventsBundle() {
    const status = document.getElementById('backup-status');
    try {
        const bundle = await exportBundle();
        if (!bundle.count) {
            flash(status, 'Journal is empty — nothing has been published since the journal shipped.', false);
            return;
        }
        downloadJson(bundle, `xray-events-bundle-${new Date().toISOString().slice(0, 10)}.json`);
        flash(status, `Exported ${bundle.count} signed event(s).`);
    } catch (e) {
        flash(status, 'Export failed: ' + (e && e.message), false);
    }
}

async function bunkerTest() {
    const status = document.getElementById('bunker-test-status');
    const url = document.getElementById('bunker-url').value.trim() || DEFAULT_BUNKER_URL;
    flash(status, 'Connecting…');
    try {
        await NSecBunkerClient.connect(url);
        flash(status, 'Connected.');
    } catch (e) {
        flash(status, 'Failed: ' + (e && e.message), false);
    }
}

// Epistemic-audit import (13.5). The options-side gate is the archive
// match: the audit must be about text the user actually captured
// (current or a retained prior version). importAuditJson then applies
// the RQ1 invariant — re-hash, schema-validate — before anything
// persists. Local-only; publishing is 13.8 behind the flag.
async function importAuditFromFile(file) {
    const status = document.getElementById('audit-status');
    try {
        const parsed = JSON.parse(await file.text());
        const body = parsed && parsed.article && parsed.article.body_markdown;
        if (typeof body !== 'string' || !body) {
            throw new Error('not a scorer export — article.body_markdown missing');
        }
        const claimed = await canonicalArticleHash(body);
        const records = await listArticles();
        const match = records.find((r) => r.articleHash === claimed
            || (Array.isArray(r.priorVersions) && r.priorVersions.some((v) => v.articleHash === claimed)));
        if (!match) {
            throw new Error('no local capture matches this audit\'s article hash — capture the article first');
        }
        const summary = await importAuditJson(parsed, { localArticleHash: claimed });
        const bits = [`${summary.modulesValid} modules valid`];
        if (summary.modulesFailed) bits.push(`${summary.modulesFailed} failed validation`);
        if (summary.predictionsImported) bits.push(`${summary.predictionsImported} predictions`);
        if (summary.predictionsSkipped) bits.push(`${summary.predictionsSkipped} predictions skipped`);
        flash(status, summary.alreadyImported
            ? (summary.ledgerUpdated
                ? `Re-imported — ledger updated; changed events re-publish (${bits.join(', ')}).`
                : `Already imported — ledger unchanged (${bits.join(', ')}).`)
            : `Imported — ${bits.join(', ')}.`,
        summary.modulesFailed === 0);
    } catch (e) {
        flash(status, 'Import failed: ' + (e && e.message), false);
    }
}

// The audit ledger is PRECIOUS — audits cost money to recompute — so
// the design marks it export-included, never droppable. This is that
// export: the full xray-audits stores (runs incl. publish marks,
// predictions, resolutions) as one JSON file. No keys, no secrets —
// everything in it is local audit data.
async function exportAuditLedger() {
    const status = document.getElementById('audit-status');
    try {
        const [runs, predictions, resolutions] = await Promise.all([
            listRuns(), listPredictions(), listResolutions()
        ]);
        const payload = {
            format: 'xray-audit-ledger/1',
            exported_at: new Date().toISOString(),
            runs, predictions, resolutions
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `xray-audit-ledger-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        flash(status, `Exported ${runs.length} run(s), ${predictions.length} prediction(s), ${resolutions.length} resolution(s).`);
    } catch (e) {
        flash(status, 'Export failed: ' + (e && e.message), false);
    }
}

// ------------------------------------------------------------------
// Advanced
// ------------------------------------------------------------------

async function loadAdvanced() {
    refreshBackupEstimate(); // fire-and-forget — sizes the backup checkbox label
    const prefs = (await storageGet('preferences')) || {};
    document.getElementById('pref-archive-sensitivity').value =
        prefs.archive_banner_sensitivity || 'always';
    document.getElementById('pref-debug').checked = prefs.debug === true;

    // Experimental flags (metadata/feature-flags.js — stored under the
    // `xray:flags` key, not preferences).
    await loadFlags();
    document.getElementById('pref-assessment-publishing').checked =
        isEnabled('assessmentPublishing');
    document.getElementById('pref-epistemic-auditing').checked =
        isEnabled('epistemicAuditing');
    document.getElementById('pref-forensic-publishing').checked =
        isEnabled('forensicPublishing');
    document.getElementById('pref-truth-publishing').checked =
        isEnabled('truthAdjudicationPublishing');
    document.getElementById('pref-entity-corpus-publishing').checked =
        isEnabled('entityCorpusPublishing');
    document.getElementById('pref-account-publishing').checked =
        isEnabled('platformAccountPublishing');

    // gate, not a publish path.
    document.getElementById('pref-network-page').checked = isEnabled('networkPage');
    document.getElementById('qa-open-network').hidden = !isEnabled('networkPage');
    document.getElementById('pref-follow-publish').checked = isEnabled('followListPublishing');

    // Moral lens (Phase 16) — independent of llmAssist; shares the key.
    document.getElementById('pref-moral-lens').checked = isEnabled('moralLens');

    // Case synthesis (Phase 20.4) — requires llmAssist + the key on top.
    document.getElementById('pref-case-synthesis').checked = isEnabled('caseSynthesis');
    // Phase 28 — per-capture map prepay (a standing spend authorization).
    document.getElementById('pref-auto-preanalyze').checked = isEnabled('autoPreAnalyze');
    document.getElementById('pref-capture-automation').checked = isEnabled('captureAutomation');

    // LLM assist (Phase 14.5). The flag lives in feature-flags; the key
    // + model live under their own chrome.storage.local keys. We never
    // load the key VALUE back into the DOM — only whether one is set.
    document.getElementById('pref-llm-assist').checked = isEnabled('llmAssist');
    populateLlmModels();
    const savedModel = resolveModel(await llmRawGet(LLM_MODEL_STORAGE));
    document.getElementById('pref-llm-model').value = savedModel;
    const hasKey = (await llmRawGet(LLM_KEY_STORAGE)).length > 0;
    const keyStatus = document.getElementById('llm-key-status');
    if (keyStatus) {
        keyStatus.textContent = hasKey
            ? 'A key is saved on this device.'
            : 'No key saved yet.';
    }
    document.getElementById('pref-llm-key').value = '';

    // Per-kind suggestion toggles (default: entities + claims).
    populateLlmKinds();
    const rawKinds = await new Promise((resolve) => {
        browserApi.storage.local.get([LLM_SUGGEST_KINDS_STORAGE],
            (res) => resolve(res ? res[LLM_SUGGEST_KINDS_STORAGE] : undefined));
    });
    const enabledKinds = normalizeSuggestKinds(rawKinds);
    for (const { kind } of SUGGEST_KIND_LABELS) {
        const cb = document.getElementById(`pref-llm-kind-${kind}`);
        if (cb) cb.checked = enabledKinds.includes(kind);
    }

    const overrides = prefs.config_overrides || {};
    document.getElementById('pref-cache-enabled').checked =
        overrides.article_cache_enabled !== false;
    document.getElementById('pref-cache-budget').value =
        overrides.article_cache_budget_mb != null ? overrides.article_cache_budget_mb : '';
    document.getElementById('pref-min-content').value =
        overrides.min_content_length != null ? overrides.min_content_length : '';
    document.getElementById('pref-max-claim').value =
        overrides.max_claim_length != null ? overrides.max_claim_length : '';
}

async function saveAdvanced() {
    const prefs = (await storageGet('preferences')) || {};
    prefs.archive_banner_sensitivity =
        document.getElementById('pref-archive-sensitivity').value;
    prefs.debug = document.getElementById('pref-debug').checked;

    const cacheBudget = document.getElementById('pref-cache-budget').value;
    const minContent = document.getElementById('pref-min-content').value;
    const maxClaim = document.getElementById('pref-max-claim').value;
    prefs.config_overrides = {
        article_cache_enabled: document.getElementById('pref-cache-enabled').checked,
        article_cache_budget_mb: cacheBudget === '' ? null : Math.max(1, parseInt(cacheBudget, 10) || 0),
        min_content_length: minContent === '' ? null : Math.max(0, parseInt(minContent, 10) || 0),
        max_claim_length: maxClaim === '' ? null : Math.max(0, parseInt(maxClaim, 10) || 0)
    };

    await storageSet('preferences', prefs);

    // Experimental flags: checked → explicit override on; unchecked →
    // clear the override back to the default (off).
    const publishJudgments = document.getElementById('pref-assessment-publishing').checked;
    await setOverride('assessmentPublishing', publishJudgments ? true : null);
    const publishAudits = document.getElementById('pref-epistemic-auditing').checked;
    await setOverride('epistemicAuditing', publishAudits ? true : null);
    const publishFindings = document.getElementById('pref-forensic-publishing').checked;
    await setOverride('forensicPublishing', publishFindings ? true : null);
    const publishVerdicts = document.getElementById('pref-truth-publishing').checked;
    await setOverride('truthAdjudicationPublishing', publishVerdicts ? true : null);
    const publishAccounts = document.getElementById('pref-account-publishing').checked;
    await setOverride('platformAccountPublishing', publishAccounts ? true : null);
    const publishCorpus = document.getElementById('pref-entity-corpus-publishing').checked;
    await setOverride('entityCorpusPublishing', publishCorpus ? true : null);

    const networkOn = document.getElementById('pref-network-page').checked;
    await setOverride('networkPage', networkOn ? true : null);
    document.getElementById('qa-open-network').hidden = !networkOn;

    // Kind-3 mirror (25.6): consent dialog on the off→on transition —
    // publishing who you follow is public and irrevocable in practice.
    const followPubBox = document.getElementById('pref-follow-publish');
    let followPubOn = followPubBox.checked;
    if (followPubOn && !isEnabled('followListPublishing')) {
        const consent = confirm(
            'Publish your follow list?\n\n'
            + 'Enabling this lets the Network page mirror your GLOBAL follows '
            + 'as a standard NIP-02 contact list (kind 3), signed by your '
            + 'primary identity.\n\n'
            + '• WHO YOU FOLLOW becomes public — replaceable, but irrevocable '
            + 'in practice (relays and archives keep copies).\n'
            + '• Case- and entity-scoped follows never publish.\n'
            + '• Each publish merges with your existing remote kind 3 first, '
            + 'so a contact list from another client is preserved, never '
            + 'wiped.\n\n'
            + 'OK to enable; Cancel to keep follows local-only.');
        if (!consent) {
            followPubOn = false;
            followPubBox.checked = false;
        }
    }
    await setOverride('followListPublishing', followPubOn ? true : null);

    // Moral lens (Phase 16): checked → explicit override on; unchecked →
    // clear the override back to the default (off).
    const lensOn = document.getElementById('pref-moral-lens').checked;
    await setOverride('moralLens', lensOn ? true : null);

    // Case synthesis (Phase 20.4).
    const synthOn = document.getElementById('pref-case-synthesis').checked;
    await setOverride('caseSynthesis', synthOn ? true : null);

    // Auto pre-analyze on capture (Phase 28) — a standing per-capture
    // spend authorization; the checkbox hint carries the disclosure.
    const autoPreOn = document.getElementById('pref-auto-preanalyze').checked;
    await setOverride('autoPreAnalyze', autoPreOn ? true : null);

    // Capture automation (Phase 27 K.4).
    const captureAutoOn = document.getElementById('pref-capture-automation').checked;
    await setOverride('captureAutomation', captureAutoOn ? true : null);

    // LLM assist: flag + model preference always; the key only when the
    // user typed a new one (blank leaves the saved key untouched).
    const llmOn = document.getElementById('pref-llm-assist').checked;
    await setOverride('llmAssist', llmOn ? true : null);
    await llmRawSet(LLM_MODEL_STORAGE, document.getElementById('pref-llm-model').value || DEFAULT_LLM_MODEL);
    const keyField = document.getElementById('pref-llm-key');
    const typedKey = (keyField.value || '').trim();
    if (typedKey) {
        await llmRawSet(LLM_KEY_STORAGE, typedKey);
        keyField.value = '';
        const keyStatus = document.getElementById('llm-key-status');
        if (keyStatus) keyStatus.textContent = 'A key is saved on this device.';
    }

    // Enabled suggestion kinds — stored as an explicit array (an empty
    // array is a valid "suggest nothing" choice; the pass surfaces that).
    const checkedKinds = SUGGEST_KIND_LABELS
        .map(({ kind }) => kind)
        .filter((kind) => {
            const cb = document.getElementById(`pref-llm-kind-${kind}`);
            return cb && cb.checked;
        });
    await llmRawSet(LLM_SUGGEST_KINDS_STORAGE, checkedKinds);

    flash(document.getElementById('advanced-status'), 'Saved.');
}

function populateLlmModels() {
    const sel = document.getElementById('pref-llm-model');
    if (!sel || sel.options.length > 0) return;
    for (const m of LLM_MODELS) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.label;
        sel.appendChild(opt);
    }
}

// Render the per-kind suggestion checkboxes from the single source of
// truth (SUGGEST_KIND_LABELS). Built with DOM nodes (no innerHTML) so the
// lint stays clean; labels/hints are static constants regardless.
function populateLlmKinds() {
    const host = document.getElementById('pref-llm-kinds');
    if (!host || host.childElementCount > 0) return;
    for (const { kind, label, hint } of SUGGEST_KIND_LABELS) {
        const wrap = document.createElement('label');
        wrap.className = 'xr-opt__field xr-opt__field--inline';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = `pref-llm-kind-${kind}`;
        const span = document.createElement('span');
        const strong = document.createElement('strong');
        strong.textContent = label;
        span.appendChild(strong);
        span.appendChild(document.createTextNode(` — ${hint}`));
        wrap.appendChild(cb);
        wrap.appendChild(span);
        host.appendChild(wrap);
    }
    // 2026-07-20 — Suggest is the EXTRACTION pass. The judgment kinds
    // moved to their corpus-level homes; say where, so nobody hunts
    // for the old checkboxes.
    const note = document.createElement('p');
    note.className = 'xr-opt__hint';
    note.textContent = 'Relationships, assessments, and forensic findings are no longer '
        + 'suggested per capture — cross-article links and the per-subject forensic pass '
        + 'run from the case dashboard, where their evidence actually lives; assessments '
        + 'are authored in the reader\'s assess modal.';
    host.appendChild(note);
}

async function clearLlmKey() {
    await llmRawRemove(LLM_KEY_STORAGE);
    const keyStatus = document.getElementById('llm-key-status');
    if (keyStatus) keyStatus.textContent = 'No key saved yet.';
    document.getElementById('pref-llm-key').value = '';
    flash(document.getElementById('llm-status'), 'Key cleared.');
}

async function clearAll() {
    // The confirm must promise exactly what storageClearExtension
    // delivers. The old text claimed "entities, the keypair registry"
    // — but those keys (publications/people/organizations/
    // keypair_registry) are the LEGACY userscript stores; the modern
    // workspace (entities, local_keys, claims, the archives) lives
    // elsewhere and is untouched here. That is what "Start fresh
    // workspace" (above, Advanced) is for — say so.
    if (!confirm('Erase X-Ray SETTINGS: relays, preferences, the local signing key, '
        + 'the LLM API key, feature flags, and legacy userscript-era stores. '
        + 'Your workspace CONTENT (entities, claims, captured articles, archives) is NOT touched — '
        + 'use "Start fresh workspace" for that. This cannot be undone. Continue?')) return;
    await storageClearExtension();
    // Reset experimental flags too — otherwise a wipe leaves the
    // public judgment-publishing path enabled.
    try { await resetOverrides(); } catch (_) { /* best-effort */ }
    await Promise.all([loadRelays(), loadSigning(), loadAdvanced()]);
}

// ------------------------------------------------------------------
// Wire-up
// ------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
    // Build stamp in the header — removes "which build am I actually
    // running?" ambiguity (version alone doesn't identify a branch build).
    const buildEl = document.getElementById('xr-build-info');
    if (buildEl) buildEl.textContent = formatBuildInfo();

    wireTabs();
    await Promise.all([
        loadRelays(),
        loadSigning(),
        loadAdvanced()
    ]);

    // Auto-activate Signing tab if not yet configured.
    const prefs = (await storageGet('preferences')) || {};
    if (!prefs.signing_method_configured) activateTab('signing');

    // Quick-action header buttons (replace the old popup's role).
    document.getElementById('qa-toggle-capture').addEventListener('click', () => {
        browserApi.runtime.sendMessage({ type: 'xray:forward:xray:capture' });
    });
    document.getElementById('qa-open-entities').addEventListener('click', () => {
        browserApi.runtime.sendMessage({ type: 'xray:openEntities' });
    });
    document.getElementById('qa-open-portal').addEventListener('click', () => {
        browserApi.runtime.sendMessage({ type: 'xray:openPortal' });
    });
    document.getElementById('qa-open-network').addEventListener('click', () => {
        browserApi.runtime.sendMessage({ type: 'xray:openNetwork' });
    });
    document.getElementById('qa-capture-tips').addEventListener('click', () => {
        browserApi.runtime.sendMessage({ type: 'xray:openCaptureTips' });
    });

    document.getElementById('relays-save').addEventListener('click', saveRelays);
    document.getElementById('relays-reset').addEventListener('click', resetRelays);
    document.getElementById('relays-add').addEventListener('click', onRelayAdd);

    document.querySelectorAll('input[name="signing-method"]').forEach((r) => {
        r.addEventListener('change', refreshSigningPanels);
    });
    document.getElementById('signing-save').addEventListener('click', saveSigning);

    document.getElementById('identity-new-toggle').addEventListener('click', () => {
        const row = document.getElementById('identity-new-row');
        row.style.display = row.style.display === 'none' ? '' : 'none';
    });
    document.getElementById('identity-new-create').addEventListener('click', identityCreate);
    document.getElementById('identity-save-current').addEventListener('click', identitySaveCurrent);
    document.getElementById('restore-entity-keys').addEventListener('click', restoreEntityKeys);
    document.getElementById('workspace-backup').addEventListener('click', workspaceDownloadBackup);
    document.getElementById('workspace-reset').addEventListener('click', workspaceResetFlow);
    document.getElementById('ws-create').addEventListener('click', createCaseFlow);
    renderWorkspaces();
    document.getElementById('backup-download').addEventListener('click', backupDownloadFull);
    document.getElementById('backup-restore').addEventListener('click', () => {
        document.getElementById('backup-file').click();
    });
    document.getElementById('backup-file').addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) backupRestoreFromFile(file);
        e.target.value = '';
    });
    document.getElementById('backup-events-bundle').addEventListener('click', backupExportEventsBundle);
    document.getElementById('local-import-toggle').addEventListener('click', () => {
        const row = document.getElementById('local-import-row');
        row.style.display = row.style.display === 'none' ? '' : 'none';
    });
    document.getElementById('local-import-save').addEventListener('click', localImport);
    document.getElementById('local-export-toggle').addEventListener('click', localExportShow);
    document.getElementById('local-export-copy').addEventListener('click', localExportCopy);
    document.getElementById('bunker-test').addEventListener('click', bunkerTest);

    document.getElementById('audit-import').addEventListener('click', () => {
        document.getElementById('audit-file').click();
    });
    document.getElementById('audit-export').addEventListener('click', () => {
        exportAuditLedger();
    });
    document.getElementById('audit-file').addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) importAuditFromFile(file);
        e.target.value = '';
    });

    document.getElementById('advanced-save').addEventListener('click', saveAdvanced);
    document.getElementById('llm-key-clear').addEventListener('click', clearLlmKey);
    document.getElementById('clear-all').addEventListener('click', clearAll);
});
// Re-export for tests / debugging.
export { Storage, Crypto };

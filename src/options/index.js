// Options page. Talks directly to chrome.storage.local — the same
// backing store the content-script Storage wrapper uses.
//
// Values written by the Storage wrapper are JSON-stringified, so we
// match that here: parse on read, stringify on write.

import { migrateUserscriptBlob } from '../shared/userscript-migration.js';
import { LocalKeyManager } from '../shared/local-key-manager.js';

const browserApi = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

const DEFAULT_RELAYS = [
    'wss://relay.damus.io',
    'wss://relay.nostr.band',
    'wss://nos.lol',
    'wss://relay.snort.social'
];

const DEFAULT_BUNKER_URL = 'wss://bunker.nsec.app';

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
        'publications', 'people', 'organizations',
        'preferences', 'keypair_registry', 'recent_publications',
        'xr_signing_state'
    ];
    return new Promise((resolve) => {
        browserApi.storage.local.remove(keys, () => resolve());
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

function flash(el, msg, ok = true) {
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

async function loadRelays() {
    const prefs = (await storageGet('preferences')) || {};
    const relays = Array.isArray(prefs.default_relays) ? prefs.default_relays : DEFAULT_RELAYS;
    document.getElementById('relays-input').value = relays.join('\n');
}

async function saveRelays() {
    const raw = document.getElementById('relays-input').value;
    const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
    const invalid = lines.find(u => !/^wss?:\/\//i.test(u));
    const status = document.getElementById('relays-status');
    if (invalid) {
        flash(status, `Not a ws/wss URL: ${invalid}`, false);
        return;
    }
    const prefs = (await storageGet('preferences')) || {};
    prefs.default_relays = lines;
    await storageSet('preferences', prefs);
    flash(status, 'Saved.');
}

async function resetRelays() {
    document.getElementById('relays-input').value = DEFAULT_RELAYS.join('\n');
}

// ------------------------------------------------------------------
// Signing
// ------------------------------------------------------------------

async function loadSigning() {
    const prefs = (await storageGet('preferences')) || {};
    document.getElementById('bunker-url').value = prefs.nsecbunker_url || DEFAULT_BUNKER_URL;
}

async function saveSigning() {
    const url = document.getElementById('bunker-url').value.trim();
    const status = document.getElementById('signing-status');
    if (url && !/^wss?:\/\//i.test(url)) {
        flash(status, 'NSecBunker URL must start with ws:// or wss://', false);
        return;
    }
    const prefs = (await storageGet('preferences')) || {};
    prefs.nsecbunker_url = url;
    await storageSet('preferences', prefs);
    flash(status, 'Saved.');
}

// ------------------------------------------------------------------
// Entities
// ------------------------------------------------------------------

async function loadEntities() {
    const pubs = (await storageGet('publications')) || {};
    const people = (await storageGet('people')) || {};
    const orgs = (await storageGet('organizations')) || {};
    document.getElementById('entities-publications').value = JSON.stringify(pubs, null, 2);
    document.getElementById('entities-people').value = JSON.stringify(people, null, 2);
    document.getElementById('entities-organizations').value = JSON.stringify(orgs, null, 2);
}

async function saveEntities() {
    const status = document.getElementById('entities-status');
    try {
        const pubs = JSON.parse(document.getElementById('entities-publications').value || '{}');
        const people = JSON.parse(document.getElementById('entities-people').value || '{}');
        const orgs = JSON.parse(document.getElementById('entities-organizations').value || '{}');
        if (typeof pubs !== 'object' || Array.isArray(pubs) ||
            typeof people !== 'object' || Array.isArray(people) ||
            typeof orgs !== 'object' || Array.isArray(orgs)) {
            throw new Error('Each entity collection must be a JSON object keyed by id');
        }
        await storageSet('publications', pubs);
        await storageSet('people', people);
        await storageSet('organizations', orgs);
        flash(status, 'Saved.');
    } catch (e) {
        flash(status, 'Invalid JSON: ' + (e && e.message), false);
    }
}

// ------------------------------------------------------------------
// Keypair registry
// ------------------------------------------------------------------

async function viewKeypairs() {
    const registry = (await storageGet('keypair_registry')) || {};
    const pre = document.getElementById('keypairs-preview');
    pre.textContent = JSON.stringify(registry, null, 2);
    pre.style.display = 'block';
}

async function exportKeypairs() {
    const registry = (await storageGet('keypair_registry')) || {};
    const blob = new Blob([JSON.stringify(registry, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `xray-keypairs-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    flash(document.getElementById('keypairs-status'), 'Exported.');
}

async function importKeypairsFromFile(file) {
    const status = document.getElementById('keypairs-status');
    try {
        const text = await file.text();
        const imported = JSON.parse(text);
        if (typeof imported !== 'object' || Array.isArray(imported)) {
            throw new Error('Top-level JSON must be an object keyed by entity id');
        }
        const existing = (await storageGet('keypair_registry')) || {};
        await storageSet('keypair_registry', { ...existing, ...imported });
        flash(status, `Imported ${Object.keys(imported).length} keypairs.`);
        viewKeypairs();
    } catch (e) {
        flash(status, 'Import failed: ' + (e && e.message), false);
    }
}

// ------------------------------------------------------------------
// Advanced
// ------------------------------------------------------------------

async function loadAdvanced() {
    const prefs = (await storageGet('preferences')) || {};
    document.getElementById('pref-theme').value = prefs.theme || 'dark';
    document.getElementById('pref-media').value = prefs.media_handling || 'embed';
    document.getElementById('pref-archive-sensitivity').value =
        prefs.archive_banner_sensitivity || 'always';
    document.getElementById('pref-debug').checked = prefs.debug === true;
}

async function saveAdvanced() {
    const prefs = (await storageGet('preferences')) || {};
    prefs.theme = document.getElementById('pref-theme').value;
    prefs.media_handling = document.getElementById('pref-media').value;
    prefs.archive_banner_sensitivity =
        document.getElementById('pref-archive-sensitivity').value;
    prefs.debug = document.getElementById('pref-debug').checked;
    await storageSet('preferences', prefs);
    flash(document.getElementById('advanced-status'), 'Saved.');
}

// ------------------------------------------------------------------
// Migrate (userscript)
// ------------------------------------------------------------------

async function runMigration() {
    const status = document.getElementById('migrate-status');
    const resultEl = document.getElementById('migrate-result');
    const text = document.getElementById('migrate-input').value.trim();
    if (!text) { flash(status, 'Paste a JSON blob first', false); return; }

    let blob;
    try { blob = JSON.parse(text); }
    catch (err) { flash(status, 'Invalid JSON: ' + (err.message || err), false); return; }

    // LocalKeyManager.init reads the existing store into memory so
    // our writes merge instead of overwriting unrelated keys.
    try { await LocalKeyManager.init(); }
    catch (err) { flash(status, 'Storage not ready: ' + (err.message || err), false); return; }

    let out;
    try { out = await migrateUserscriptBlob(blob); }
    catch (err) { flash(status, 'Migration failed: ' + (err.message || err), false); return; }

    const lines = [];
    for (const [key, r] of Object.entries(out.perKey)) {
        if (!r.ok) { lines.push(`✗ ${key}: ${r.reason}`); continue; }
        if (key === 'user_identity')   lines.push(`✓ user_identity   → ${r.npub.slice(0, 18)}…`);
        else if (key === 'entity_registry') lines.push(`✓ entity_registry → +${r.added} added, ${r.updated} updated, ${r.skipped} skipped`);
        else if (key === 'relay_config')    lines.push(`✓ relay_config   → +${r.merged} relays added (${r.total} total)`);
        else                                lines.push(`✓ ${key} → +${r.added} added (${r.total} total)`);
    }
    for (const e of out.errors) lines.push(`! ${e}`);

    resultEl.textContent = lines.join('\n') || 'No recognized keys in payload.';
    resultEl.style.display = 'block';
    const failed = Object.values(out.perKey).some((r) => !r.ok);
    flash(status, failed ? 'Migration finished with errors' : 'Migration complete', !failed);
}

function readMigrationFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
        document.getElementById('migrate-input').value = String(reader.result || '');
    };
    reader.readAsText(file);
}

async function clearAll() {
    if (!confirm('Erase all X-Ray settings, entities, and the keypair registry? This cannot be undone.')) return;
    await storageClearExtension();
    await Promise.all([loadRelays(), loadSigning(), loadEntities(), loadAdvanced()]);
    document.getElementById('keypairs-preview').style.display = 'none';
}

// ------------------------------------------------------------------
// Wire-up
// ------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
    wireTabs();
    await Promise.all([
        loadRelays(),
        loadSigning(),
        loadEntities(),
        loadAdvanced()
    ]);

    document.getElementById('relays-save').addEventListener('click', saveRelays);
    document.getElementById('relays-reset').addEventListener('click', resetRelays);

    document.getElementById('signing-save').addEventListener('click', saveSigning);

    document.getElementById('entities-save').addEventListener('click', saveEntities);

    document.getElementById('keypairs-view').addEventListener('click', viewKeypairs);
    document.getElementById('keypairs-export').addEventListener('click', exportKeypairs);
    document.getElementById('keypairs-import').addEventListener('click', () => {
        document.getElementById('keypairs-file').click();
    });
    document.getElementById('keypairs-file').addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) importKeypairsFromFile(file);
        e.target.value = '';
    });

    document.getElementById('advanced-save').addEventListener('click', saveAdvanced);
    document.getElementById('clear-all').addEventListener('click', clearAll);

    document.getElementById('migrate-run').addEventListener('click', runMigration);
    document.getElementById('migrate-file').addEventListener('click', () => {
        document.getElementById('migrate-file-input').click();
    });
    document.getElementById('migrate-file-input').addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) readMigrationFile(file);
        e.target.value = '';
    });
});

// The live signer vs the active case's bound identity (JOURNAL
// 2026-10-01): shared/case-membership.js computes it and words it once;
// the portal banner and the reader (case chip + Publish confirm) show
// those words. The live key can move on its own — Options ▸ Signing
// "Use", a restore, a rebind — and every publish after that is signed
// by a key that is not the case's.
//
// Provenance: INTERPRETATION (2026-10-01) — expires 2026-12-30

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const _store = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) {
                const out = {};
                for (const k of Array.isArray(keys) ? keys : [keys]) if (_store.has(k)) out[k] = _store.get(k);
                cb(out);
            },
            set(obj, cb) { for (const [k, v] of Object.entries(obj)) _store.set(k, v); cb && cb(); },
            remove(keys, cb) { for (const k of Array.isArray(keys) ? keys : [keys]) _store.delete(k); cb && cb(); }
        }
    }
};

const { Storage } = await import('../src/shared/storage.js');
const {
    signerBindingState, describeSignerBinding, signerBindingWarning, SIGNER_BINDING_FIX
} = await import('../src/shared/case-membership.js');
const { flagCaseChip, confirmPublishSigner } = await import('../src/reader/signer-binding.js');

const CASE = '76c033264c1423075c99e85a598400f0834a3ba0efced886493916d3e4630039';
const OTHER = '4ba5145ddce7322c3422096997fdf9d5cf9198312d7567b0dda275e580654a9f';
const PROFILES = { [CASE]: { label: 'Heretic Foundation' }, [OTHER]: { label: 'Personal' } };

async function seed({ method = 'local', bound = CASE, live = OTHER, profiles = PROFILES } = {}) {
    _store.clear();
    await Storage.set('preferences', { signing_method: method, signing_method_configured: true });
    await Storage.set('local_primary_identity', live ? { pubkey: live, privateKey: '9'.repeat(64) } : null);
    await Storage.set('identity_profiles', profiles);
    await Storage.set('workspaces', {
        default: { id: 'default', label: 'Default workspace', case_entity_id: null, identity_pubkey: bound, created: 1 }
    });
}

test('signerBindingState: only a LOCAL signer that differs from the bound identity is a mismatch', () => {
    const base = { boundPubkey: CASE, livePubkey: OTHER, profiles: PROFILES };
    const s = signerBindingState({ ...base, method: 'local' });
    assert.equal(s.mismatch, true);
    assert.deepEqual(s.bound, { pubkey: CASE, label: 'Heretic Foundation' });
    assert.deepEqual(s.live, { pubkey: OTHER, label: 'Personal' });
    assert.equal(signerBindingState({ ...base, method: undefined }).mismatch, true, 'an unset method is Local (Signer.getMethod)');
    assert.equal(signerBindingState({ ...base, method: 'local', livePubkey: CASE }).mismatch, false);
    assert.equal(signerBindingState({ ...base, method: 'local', livePubkey: CASE.toUpperCase() }).mismatch, false, 'hex case folds');
    for (const method of ['nip07', 'nsecbunker']) {
        const other = signerBindingState({ ...base, method });
        assert.equal(other.mismatch, false, `${method}: its key is not a profile; Option C lets it differ`);
        assert.equal(other.live, null);
    }
    assert.equal(signerBindingState({ ...base, method: 'local', boundPubkey: null }).mismatch, false, 'unbound case');
    assert.equal(signerBindingState({ ...base, method: 'local', livePubkey: null }).mismatch, false, 'no live key');
    assert.equal(signerBindingState({ ...base, method: 'local', boundPubkey: 'zz' }).mismatch, false, 'junk binding');
    assert.equal(signerBindingState({ ...base, profiles: {} }).bound.label, null, 'an unsaved key has no label');
});

test('signerBindingWarning names both identities, label first; nothing when there is no mismatch', () => {
    const w = signerBindingWarning(signerBindingState({ method: 'local', boundPubkey: CASE, livePubkey: OTHER, profiles: PROFILES }));
    assert.equal(w, 'This case is bound to “Heretic Foundation” (76c03326…0039), but X-Ray is signing as “Personal” (4ba5145d…4a9f). '
        + 'Anything published now is signed by “Personal”, not by the case\'s identity.');
    const unsaved = signerBindingWarning(signerBindingState({ method: 'local', boundPubkey: CASE, livePubkey: OTHER, profiles: {} }));
    assert.match(unsaved, /bound to 76c03326…0039, but X-Ray is signing as 4ba5145d…4a9f\. Anything published now is signed by 4ba5145d…4a9f,/);
    assert.equal(signerBindingWarning(signerBindingState({ method: 'local', boundPubkey: CASE, livePubkey: CASE })), null);
    assert.equal(signerBindingWarning(null), null);
    assert.match(SIGNER_BINDING_FIX, /Settings ▸ Signing/);
    assert.match(SIGNER_BINDING_FIX, /Settings ▸ Advanced ▸ Cases/);
});

test('describeSignerBinding reads the stored workspace, method, primary and profiles', async () => {
    await seed();
    assert.equal((await describeSignerBinding()).mismatch, true);
    await seed({ live: CASE });
    assert.equal((await describeSignerBinding()).mismatch, false);
    await seed({ method: 'nip07' });
    assert.equal((await describeSignerBinding()).mismatch, false);
    await seed({ bound: null });
    assert.equal((await describeSignerBinding()).mismatch, false);
});

test('reader: Publish asks on a mismatch — and only then — with the button held disabled', async () => {
    await seed();
    const btn = { disabled: false };
    const asked = [];
    const ask = (msg) => { asked.push({ msg, disabledDuring: btn.disabled }); return false; };
    assert.equal(await confirmPublishSigner(btn, ask), false, 'the answer decides');
    assert.equal(asked.length, 1);
    assert.equal(asked[0].disabledDuring, true, 'no second click while the question is open');
    assert.ok(asked[0].msg.startsWith('This case is bound to “Heretic Foundation”'));
    assert.ok(asked[0].msg.includes(SIGNER_BINDING_FIX));
    assert.ok(asked[0].msg.endsWith('Publish anyway?'));
    assert.equal(btn.disabled, false, 're-enabled for publish() to take over');
    assert.equal(await confirmPublishSigner(btn, () => true), true);

    await seed({ live: CASE });
    let calls = 0;
    assert.equal(await confirmPublishSigner(btn, () => { calls++; return false; }), true);
    assert.equal(calls, 0, 'no question when the signer is the case\'s identity');
});

test('reader: an unreadable binding never blocks a publish', async () => {
    await seed();   // a mismatch IS stored — the read of it fails
    const realGet = Storage.preferences.get;
    Storage.preferences.get = async () => { throw new Error('storage read failed'); };
    try {
        await assert.rejects(describeSignerBinding(), /storage read failed/, 'sanity: the binding read rejects');
        let calls = 0;
        assert.equal(await confirmPublishSigner(null, () => { calls++; return false; }), true);
        assert.equal(calls, 0);
    } finally {
        Storage.preferences.get = realGet;
    }
});

test('reader: the case chip turns amber and explains, only on a mismatch', async () => {
    const chip = () => {
        const classes = new Set();
        return { textContent: '🗂 What is the origin of Covid?', title: 'Case …', classes, classList: { add: (c) => classes.add(c) } };
    };
    await seed();
    const warned = chip();
    await flagCaseChip(warned);
    assert.ok(warned.classes.has('xr-reader__case--warn'));
    assert.equal(warned.textContent, '⚠ 🗂 What is the origin of Covid?');
    assert.ok(warned.title.startsWith('This case is bound to') && warned.title.endsWith(SIGNER_BINDING_FIX));

    await seed({ live: CASE });
    const fine = chip();
    await flagCaseChip(fine);
    assert.equal(fine.classes.size, 0);
    assert.equal(fine.textContent, '🗂 What is the origin of Covid?');
    assert.equal(fine.title, 'Case …');
});

test('SEAM: every publish() the reader runs is behind the signer confirm', () => {
    const src = readFileSync(new URL('../src/reader/index.js', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const calls = [...src.matchAll(/(?<![\w.$])publish\(\)/g)]
        .filter((m) => !/function\s+$/.test(src.slice(Math.max(0, m.index - 12), m.index)));
    assert.ok(calls.length >= 1, 'sanity: the scanner sees the publish() call');
    for (const m of calls) {
        const before = src.slice(Math.max(0, m.index - 400), m.index);
        assert.match(before, /await confirmPublishSigner\(/,
            `publish() at offset ${m.index} runs without asking about a mismatched signer`);
    }
});

test('portal: the banner shows the warning and the way out on a mismatch, and hides when fixed', async () => {
    const node = (tag) => ({
        tag, className: '', textContent: '', type: '', hidden: false, children: [], listeners: {},
        get firstChild() { return this.children[0] || null; },
        appendChild(c) { this.children.push(c); return c; },
        removeChild(c) { this.children.splice(this.children.indexOf(c), 1); return c; },
        addEventListener(t, fn) { this.listeners[t] = fn; }
    });
    globalThis.document = { createElement: node };
    const { renderSignerWarning } = await import('../src/portal/identity-strip.js');
    const host = node('div');
    host.hidden = true;
    let opened = 0;

    renderSignerWarning(host, signerBindingState({ method: 'local', boundPubkey: CASE, livePubkey: OTHER, profiles: PROFILES }),
        { onOpenSettings: () => { opened++; } });
    assert.equal(host.hidden, false);
    assert.equal(host.children.length, 2);
    assert.ok(host.children[0].textContent.includes('This case is bound to “Heretic Foundation”'));
    assert.ok(host.children[0].textContent.endsWith(SIGNER_BINDING_FIX));
    host.children[1].listeners.click();
    assert.equal(opened, 1, 'the button opens Settings');

    renderSignerWarning(host, signerBindingState({ method: 'local', boundPubkey: CASE, livePubkey: CASE }));
    assert.equal(host.hidden, true, 'fixed: hidden again');
    assert.equal(host.children.length, 0, 'and emptied');
});

test('SEAM: the portal renders the banner from the stored binding on every boot', () => {
    const strip = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const boot = strip('src/portal/index.js').split('async function boot(')[1] || '';
    assert.match(boot, /describeSignerBinding\(\)\s*\.then\(\(b\) => renderSignerWarning\(\$\('#xr-signer-warning'\), b,/,
        'boot() must hand describeSignerBinding()\'s state to renderSignerWarning');
    assert.match(readFileSync(new URL('../src/portal/index.html', import.meta.url), 'utf8'),
        /<div[^>]*id="xr-signer-warning"[^>]*hidden/, 'the banner host exists and starts hidden');
});

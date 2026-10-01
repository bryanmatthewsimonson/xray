// The reader's half of the case-signer check (JOURNAL 2026-10-01). The
// active-case chip turns amber when the live signer is not the identity
// the case is bound to, and Publish asks before signing this capture
// with that other key. The words come from case-membership.js, so this
// confirm and the portal's banner say the same thing.

import {
    describeSignerBinding, signerBindingWarning, SIGNER_BINDING_FIX
} from '../shared/case-membership.js';

/** Amber chip and an explaining tooltip when the signer is not the case's identity. */
export async function flagCaseChip(chip) {
    const warning = signerBindingWarning(await describeSignerBinding());
    if (!chip || !warning) return;
    chip.classList.add('xr-reader__case--warn');
    chip.textContent = `⚠ ${chip.textContent}`;
    chip.title = `${warning} ${SIGNER_BINDING_FIX}`;
}

/**
 * Before Publish: resolves true to go ahead. Asks only on a mismatch;
 * an unreadable binding never blocks a publish (nothing did before this
 * check). The button stays disabled while the question is open, so a
 * double click cannot start two publishes.
 */
export async function confirmPublishSigner(btn, ask = (msg) => window.confirm(msg)) {
    if (btn) btn.disabled = true;
    try {
        const warning = signerBindingWarning(await describeSignerBinding().catch(() => null));
        return !warning || ask(`${warning}\n\n${SIGNER_BINDING_FIX}\n\nPublish anyway?`);
    } finally {
        if (btn) btn.disabled = false;
    }
}

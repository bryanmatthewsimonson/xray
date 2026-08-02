// Shared-text scan block — R8 of the founding-transcript integration
// (JOURNAL 2026-08-02). Click-triggered wire-copy detection over the
// case corpus: token-shingle containment between member texts
// (shared/wire-copy.js), rendered as suggested origin groups.
//
// The suggestion is the ceiling: text overlap NEVER merges members,
// never writes an origin, never moves an independence count. Making it
// count is the human's move — attest a shared origin_key through the
// evidence-linker flow, exactly as if the overlap had been noticed by
// eye. Costs NO LLM call and touches no storage; the scan is
// click-triggered only because it is O(N²) over member texts.

import { el, truncate } from './dom.js';
import { Utils } from '../shared/utils.js';
import { buildMemberUnits } from '../shared/case-synthesis.js';
import { scanForSharedText, CONTAINMENT_MIN, SHINGLE_SIZE } from '../shared/wire-copy.js';

const MAX_GROUPS = 8;

/**
 * @param {HTMLElement} host
 * @param {object} params
 * @param {object} params.data  collectCaseDossierData output
 */
export function renderWireScanBlock(host, { data }) {
    const caseId = data.case && data.case.id;
    if (!caseId) return;
    const block = el('div', 'xr-synth');
    host.appendChild(block);

    (async () => {
        const allUnits = await buildMemberUnits(data);
        const seen = new Set();
        const units = [];
        for (const u of allUnits) {
            if (seen.has(u.article_hash)) continue;
            seen.add(u.article_hash);
            units.push({ articleHash: u.article_hash, url: u.url, title: u.title, text: u.text });
        }
        if (units.length < 2) { block.remove(); return; }

        block.appendChild(el('h3', 'xr-case__heading', 'Shared-text scan — wire copy, suggested'));
        block.appendChild(el('p', 'xr-case__explainer',
            'Measures verbatim overlap between member texts ('
            + `${SHINGLE_SIZE}-token shingles, ≥ ${Math.round(CONTAINMENT_MIN * 100)}% containment`
            + ') to surface probable wire-copy reprints: many outlets, one report. '
            + 'Overlap is a suggestion, never an identity — to make it count, attest a '
            + 'shared origin on the supporting links (evidence linker); the independence '
            + 'counts move only on attested origins.'));

        const status = el('div', 'xr-synth__status');
        const results = el('div');
        const btn = el('button', 'xr-portal__btn',
            `Scan ${units.length} members for shared text`);
        btn.type = 'button';
        btn.addEventListener('click', () => {
            btn.disabled = true;
            status.textContent = 'Scanning…';
            // Yield a frame so the status paints before the O(N²) pass.
            setTimeout(() => {
                try {
                    const scan = scanForSharedText(units);
                    results.replaceChildren();
                    const bits = [`${scan.scanned} scanned`];
                    if (scan.skipped.length) bits.push(`${scan.skipped.length} too short to compare`);
                    bits.push(scan.groups.length
                        ? `${scan.groups.length} shared-text group${scan.groups.length === 1 ? '' : 's'}`
                        : 'no substantial shared text found');
                    status.textContent = bits.join(' · ');

                    for (const g of scan.groups.slice(0, MAX_GROUPS)) {
                        const sec = el('details', 'xr-synth__sec');
                        sec.open = scan.groups.length === 1;
                        sec.appendChild(el('summary', null,
                            `${g.size} members share text — containment ${Math.round(g.minContainment * 100)}–${Math.round(g.maxContainment * 100)}%`));
                        const ul = el('ul', 'xr-list');
                        for (const m of g.members) {
                            const li = el('li', 'xr-synth__text', truncate(m.title || m.url || m.articleHash, 100));
                            if (m.url) li.title = m.url;
                            ul.appendChild(li);
                        }
                        sec.appendChild(ul);
                        sec.appendChild(el('div', 'xr-synth__prop-note',
                            'If these trace to one report, attest the shared origin on their '
                            + 'supporting links — apparent corroboration should count as one origin.'));
                        results.appendChild(sec);
                    }
                    if (scan.groups.length > MAX_GROUPS) {
                        results.appendChild(el('div', 'xr-inspector__mono',
                            `…and ${scan.groups.length - MAX_GROUPS} more groups`));
                    }
                } catch (err) {
                    Utils.error('Wire scan failed', err);
                    status.textContent = `Scan failed: ${err.message || err}`;
                } finally {
                    btn.disabled = false;
                }
            }, 0);
        });
        block.appendChild(btn);
        block.appendChild(status);
        block.appendChild(results);
    })().catch((err) => {
        Utils.error('Wire-scan block render failed', err);
        block.remove();
    });
}

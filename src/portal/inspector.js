// Portal item inspector (Phase 12.6, docs/PORTAL_DESIGN.md).
//
// The provenance drawer: for any item — parsed summary, the
// addressable coordinate, which relays actually hold it, its
// reconciliation status against the local ledger, the raw signed
// event (copyable), a jump to the source URL, and for articles a
// read-only round-trip back into the reader via the existing
// `xray:reader:open` message (the event reconstructs to an article
// object; nothing is written anywhere).

import { el, clear, truncate, shortKey } from './dom.js';
import { kindLabel } from './library.js';
import { replaceableKey } from '../shared/nostr-events.js';
import { EventBuilder } from '../shared/event-builder.js';
import { Utils } from '../shared/utils.js';
import { auditCardChipData } from '../shared/audit/display.js';

// Audit section (13.7): every run anchored to this article —
// side-by-side, never averaged (PHILOSOPHY P8) — with module results
// and dispute lineage joined in. Display rules hold: no naked
// numbers, review states carry no band, a binding ceiling always
// shows its context; URL joins (pre-13.4 hashless articles) are
// marked advisory.
function renderAuditSection(host, audit) {
    const { runs, joinedBy, vintage, modules = [], disputesByTarget } = audit;
    const section = el('div', 'xr-inspector__audit');
    section.appendChild(el('h3', 'xr-case__heading',
        `Audit record — ${runs.length} run(s)${runs.length > 1 ? ' (side-by-side, never averaged)' : ''}`));
    if (joinedBy === 'url') {
        section.appendChild(el('div', 'xr-inspector__audit-lineage',
            '⚠ joined by URL — this capture predates content hashing, so the audited text is unverified'));
    } else if (vintage === 'prior') {
        section.appendChild(el('div', 'xr-inspector__audit-lineage',
            '⚠ anchored to an EARLIER capture of this article — the current text is unaudited; scores never transfer across edits'));
    }
    for (const a of runs) {
        const row = el('div', 'xr-inspector__audit-run');
        const chip = auditCardChipData({ final_score: a.finalScore, overall_confidence: a.confidence });
        row.appendChild(el('span',
            `xr-badge xr-badge--audit-${chip ? chip.bandKey : 'review'}`,
            chip ? chip.text : 'no aggregate score'));
        row.appendChild(el('span', 'xr-inspector__mono',
            `${a.auditor ? `${a.auditor.kind} · ${a.auditor.id}` : 'unknown auditor'} · ${a.runAt || ''}${a.source === 'local' ? ' · local (unpublished)' : ''}`));
        if (a.ceilingBinding) {
            row.appendChild(el('div', 'xr-inspector__audit-ceiling',
                `capped by knowability ${a.ceiling}${a.knowabilityNotes ? ` — ${a.knowabilityNotes}` : ''} (source: ${a.ceilingSource || 'unknown'})`));
        }
        // Module results: published 30056s matching this run, joined
        // by COORDINATE — the 30057's role-marked module a-refs are
        // the run's own statement of which events constitute it. A
        // runAt join never matched real published events (the scorer
        // stamps per-module run_at, the aggregate its own), and a
        // same-runAt 30056 from another pubkey could displace the
        // run's actual modules. Local runs fall back to the
        // aggregate's own contributions.
        const refCoords = new Set((a.moduleRefs || []).map((r) => r.coord));
        const runModules = modules.filter((m) =>
            m.eventId && m.pubkey && m.id && refCoords.has(`30056:${m.pubkey}:${m.id}`));
        const moduleRows = runModules.length
            ? runModules.map((m) => ({ name: m.module, version: m.moduleVersion, score: m.score, confidence: m.confidence }))
            : (a.moduleContributions || []).map((c) => ({ name: c.module, version: null, score: c.score, confidence: c.confidence }));
        if (moduleRows.length) {
            const wrap = el('div', 'xr-inspector__audit-modules');
            for (const m of moduleRows) {
                const mChip = auditCardChipData({ final_score: m.score, overall_confidence: m.confidence });
                wrap.appendChild(el('span', 'xr-badge',
                    `${String(m.name || '').replace(/_/g, ' ')}${m.version ? ` v${m.version}` : ''}: `
                    + (mChip ? mChip.text.replace(/^audit /, '').replace('audit: review', 'review') : (m.score === null ? 'unscored' : 'review'))));
            }
            row.appendChild(wrap);
        }
        if (a.supersedesEventId) {
            row.appendChild(el('div', 'xr-inspector__audit-lineage',
                `supersedes ${a.supersedesEventId.slice(0, 12)}… — the prior audit remains visible`));
        }
        if (a.resolvesDisputeEventId) {
            row.appendChild(el('div', 'xr-inspector__audit-lineage',
                `resolves dispute ${a.resolvesDisputeEventId.slice(0, 12)}…`));
        }
        // Disputes targeting this aggregate (30061s, wire-format-only
        // in v1 — but a filed challenge must be visible where the
        // score is).
        const disputes = (a.coordinate && disputesByTarget) ? (disputesByTarget.get(a.coordinate) || []) : [];
        for (const d of disputes) {
            row.appendChild(el('div', 'xr-inspector__audit-lineage',
                `⚠ dispute (${d.status}) filed by ${shortKey(d.pubkey || '')} — ${truncate(d.disputeSummary || '', 80)}`));
        }
        section.appendChild(row);
    }
    host.appendChild(section);
}

// Behavioral finding (14.4): the named maneuver + its ordered evidence
// chain + the REQUIRED counter-read. No score, no verdict — the field
// table and this section never assert intent.
function renderFindingSection(host, finding) {
    const section = el('div', 'xr-inspector__finding');
    section.appendChild(el('h3', 'xr-case__heading', 'Behavioral finding'));
    section.appendChild(el('div', 'xr-inspector__mono',
        `${finding.maneuver} · ${finding.role || 'subject'} · basis ${finding.basis || '—'}`
        + (finding.subjectPubkey ? ` · subject ${shortKey(finding.subjectPubkey)}` : '')));
    const anchors = finding.anchors || [];
    section.appendChild(el('h4', 'xr-inspector__sub',
        `Evidence (${anchors.length} step${anchors.length === 1 ? '' : 's'})`));
    anchors.forEach((a, i) => {
        if (!a.quote) return;
        const row = el('div', 'xr-inspector__finding-anchor');
        row.appendChild(el('span', 'xr-inspector__mono', `[${i}]`));
        row.appendChild(el('span', null, truncate(a.quote, 140)));
        section.appendChild(row);
    });
    if (finding.note) {
        section.appendChild(el('h4', 'xr-inspector__sub', 'Note'));
        section.appendChild(el('div', null, finding.note));
    }
    section.appendChild(el('h4', 'xr-inspector__sub', 'Counter-read (required)'));
    section.appendChild(el('div', null, finding.counterNote || '—'));
    host.appendChild(section);
}

const STATUS_TEXT = {
    'confirmed':   ['✓ in ledger & on relays', 'xr-badge--agree'],
    'remote-only': ['◌ remote-only — not in this device\'s ledger', 'xr-badge--case'],
    'no-ledger':   ['— no local publish ledger for this kind', '']
};

/**
 * @param {HTMLElement} host    the drawer container (#xr-inspector)
 * @param {object} item         library item
 * @param {object} opts
 * @param {string} opts.status  reconciliation status for this event id
 * @param {function} opts.onClose
 */
export function renderInspector(host, item, { status = 'no-ledger', onClose, audit = null } = {}) {
    clear(host);
    host.hidden = false;

    const head = el('div', 'xr-inspector__head');
    head.appendChild(el('span', 'xr-row__kind', kindLabel(item.kind)));
    head.appendChild(el('span', 'xr-inspector__title', truncate(item.title, 120)));
    const close = el('button', 'xr-chip__remove', '✕');
    close.type = 'button';
    close.title = 'Close';
    close.addEventListener('click', () => { host.hidden = true; clear(host); if (onClose) onClose(); });
    head.appendChild(close);
    host.appendChild(head);

    const [statusText, statusClass] = STATUS_TEXT[status] || STATUS_TEXT['no-ledger'];
    host.appendChild(el('div', `xr-badge xr-inspector__status ${statusClass}`, statusText));

    const dl = el('dl', 'xr-inspector__fields');
    const field = (label, value, mono) => {
        if (!value) return;
        dl.appendChild(el('dt', null, label));
        const dd = el('dd', mono ? 'xr-inspector__mono' : null, value);
        dl.appendChild(dd);
    };
    field('Published', item.created_at ? new Date(item.created_at * 1000).toLocaleString() : '');
    const addr = replaceableKey(item.event);
    field('Coordinate', addr, true);
    field('Event id', item.event.id, true);
    field('Author', shortKey(item.event.pubkey || ''), true);
    if (item.cases.length) field('Cases', item.cases.join(', '));
    host.appendChild(dl);

    const relaySection = el('div', 'xr-inspector__relays');
    relaySection.appendChild(el('h3', 'xr-case__heading', `Held by ${item.relays.length} relay(s)`));
    for (const url of item.relays) relaySection.appendChild(el('div', 'xr-inspector__mono', url));
    if (item.relays.length === 0) {
        relaySection.appendChild(el('div', 'xr-view__empty', 'No relay returned this event in the last sync.'));
    }
    host.appendChild(relaySection);

    const actions = el('div', 'xr-inspector__actions');
    if (item.url) {
        const a = el('a', 'xr-portal__btn xr-portal__btn--ghost', '↗ Source URL');
        a.href = item.url;
        a.target = '_blank';
        a.rel = 'noreferrer noopener';
        actions.appendChild(a);
    }
    const copy = el('button', 'xr-portal__btn xr-portal__btn--ghost', 'Copy raw event');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(JSON.stringify(item.event, null, 2));
            copy.textContent = 'Copied ✓';
            setTimeout(() => { copy.textContent = 'Copy raw event'; }, 1500);
        } catch (err) {
            Utils.error('Inspector: clipboard write failed', err);
        }
    });
    actions.appendChild(copy);

    if (item.kind === 30023) {
        const open = el('button', 'xr-portal__btn', 'Open in reader');
        open.type = 'button';
        open.title = 'Reconstruct this capture from its signed event and open it read-only in the reader';
        open.addEventListener('click', () => {
            const article = EventBuilder.reconstructArticleFromEvent(item.event);
            if (!article) {
                open.textContent = 'Could not reconstruct';
                return;
            }
            const id = crypto.randomUUID();
            // readOnly: the reader must not write this relay
            // reconstruction into the local archive cache (Q5).
            chrome.runtime.sendMessage({ type: 'xray:reader:open', id, article, readOnly: true }, (resp) => {
                if (!resp || !resp.ok) {
                    Utils.error('Inspector: reader open failed', resp && resp.error);
                    open.textContent = 'Reader open failed';
                }
            });
        });
        actions.appendChild(open);
    }
    host.appendChild(actions);

    // 13.7: the audit record for articles, when any run anchors here.
    if (audit && audit.runs && audit.runs.length > 0) {
        renderAuditSection(host, audit);
    }

    // 14.4: the behavioral finding's maneuver + evidence chain + counter-read.
    if (item.kind === 30062 && item.parsedFinding) {
        renderFindingSection(host, item.parsedFinding);
    }

    const details = el('details', 'xr-inspector__raw');
    details.open = true;
    details.appendChild(el('summary', null, 'Raw signed event'));
    const pre = el('pre');
    pre.textContent = JSON.stringify(item.event, null, 2);
    details.appendChild(pre);
    host.appendChild(details);
}

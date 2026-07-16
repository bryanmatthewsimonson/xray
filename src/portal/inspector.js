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
import { SOURCE_TYPE_LABELS, isPrimarySourceType, EVIDENCE_ROLE_LABELS, isValidEvidenceRole } from '../shared/truth-taxonomy.js';

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
function renderCaseBriefSection(host, brief) {
    const box = el('div', 'xr-inspector__brief');
    const b = brief.brief || {};
    if (b.summary) box.appendChild(el('p', 'xr-inspector__brief-summary', b.summary));
    const counts = [];
    if ((b.positions || []).length) counts.push(`${b.positions.length} position${b.positions.length === 1 ? '' : 's'}`);
    if ((b.cruxes || []).length) counts.push(`${b.cruxes.length} crux${b.cruxes.length === 1 ? '' : 'es'}`);
    if ((b.load_bearing || []).length) counts.push(`${b.load_bearing.length} load-bearing claim${b.load_bearing.length === 1 ? '' : 's'}`);
    if ((brief.memberHashes || []).length) counts.push(`${brief.memberHashes.length} member source${brief.memberHashes.length === 1 ? '' : 's'}`);
    if (counts.length) box.appendChild(el('div', 'xr-inspector__brief-counts', counts.join(' · ')));
    box.appendChild(el('div', 'xr-inspector__brief-note',
        `Grounded: ${brief.grounding.checked} quote${brief.grounding.checked === 1 ? '' : 's'} verified, ${brief.grounding.dropped} pruned. `
        + 'A readable article (kind 30023, same case) carries this as prose for any NOSTR client. No score — a map, not a ruling.'));
    host.appendChild(box);
}

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

// Phase 15 read-back: the adjudicated verdict, rendered with its
// derivation on its face — state, declared standard, both evidence
// sides, the REQUIRED caveats, and disclosure/citations when present.
// No number is synthesized anywhere here (§1).
function renderEvidenceList(section, label, entries) {
    if (!entries || entries.length === 0) return;
    section.appendChild(el('h4', 'xr-inspector__sub', `${label} (${entries.length})`));
    entries.forEach((e) => {
        const row = el('div', 'xr-inspector__finding-anchor');
        row.appendChild(el('span', 'xr-inspector__mono', e.tier || '—'));
        row.appendChild(el('span', null, truncate(e.quote, 140)));
        // Grounded evidence (2026-07-12): the wire tag's url/coord slots
        // are the re-derivation path — render them followable instead of
        // dropping them. Older/ungrounded events simply lack both.
        if (e.url) {
            const a = document.createElement('a');
            a.className = 'xr-inspector__mono';
            a.href = e.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = truncate(e.url, 60);
            a.title = e.url;
            row.appendChild(a);
        }
        if (e.coord) {
            const chip = el('span', 'xr-inspector__mono', `claim ${truncate(e.coord, 40)}`);
            chip.title = `${e.coord} — click to copy the claim coordinate`;
            chip.style.cursor = 'copy';
            chip.addEventListener('click', () => {
                try { navigator.clipboard.writeText(e.coord); } catch (_) { /* clipboard denied */ }
            });
            row.appendChild(chip);
        }
        section.appendChild(row);
    });
}

function renderRulingCommon(section, parsed) {
    renderEvidenceList(section, 'Evidence for', parsed.evidenceFor);
    renderEvidenceList(section, 'Evidence against', parsed.evidenceAgainst);
    section.appendChild(el('h4', 'xr-inspector__sub', 'Caveats (required)'));
    (parsed.caveats || []).forEach((c) => section.appendChild(el('div', null, `• ${c}`)));
    if (parsed.exposure) {
        section.appendChild(el('h4', 'xr-inspector__sub', 'Adjudicator disclosure'));
        section.appendChild(el('div', null, parsed.exposure));
    }
    if (parsed.precedents && parsed.precedents.length) {
        section.appendChild(el('h4', 'xr-inspector__sub', 'Precedent citations (informational)'));
        parsed.precedents.forEach((p) => section.appendChild(
            el('div', 'xr-inspector__mono', `${p.weight}: ${truncate(p.coord, 60)}`)));
    }
    if (parsed.replyEventIds && parsed.replyEventIds.length) {
        section.appendChild(el('h4', 'xr-inspector__sub', 'Subject replies'));
        parsed.replyEventIds.forEach((id) => section.appendChild(
            el('div', 'xr-inspector__mono', shortKey(id))));
    }
    if (parsed.supersedesEventId) {
        section.appendChild(el('div', 'xr-inspector__mono',
            `supersedes ${shortKey(parsed.supersedesEventId)} — append-only chain`));
    }
    if (parsed.rationale) {
        section.appendChild(el('h4', 'xr-inspector__sub', 'Rationale'));
        section.appendChild(el('div', null, parsed.rationale));
    }
}

function renderVerdictSection(host, verdict) {
    const section = el('div', 'xr-inspector__finding');
    section.appendChild(el('h3', 'xr-case__heading', 'Adjudicated verdict'));
    section.appendChild(el('div', 'xr-inspector__mono',
        `${verdict.verdict} · standard ${verdict.standardOfProof} · ${verdict.propositionClass}`
        + (verdict.method ? ` · ${verdict.method}` : '')));
    section.appendChild(el('div', 'xr-inspector__mono',
        `proposition claim: ${truncate(verdict.claimCoord, 70)}`));
    if (verdict.criteria) {
        section.appendChild(el('h4', 'xr-inspector__sub', 'Resolution criteria'));
        section.appendChild(el('div', null, verdict.criteria
            + (verdict.horizon ? ` (horizon: ${verdict.horizon})` : '')));
    }
    renderRulingCommon(section, verdict);
    host.appendChild(section);
}

function renderIntegritySection(host, finding) {
    const section = el('div', 'xr-inspector__finding');
    section.appendChild(el('h3', 'xr-case__heading', 'Integrity finding (words vs deeds)'));
    section.appendChild(el('div', 'xr-inspector__mono',
        `match: ${finding.match} · standard ${finding.standardOfProof}`
        + (finding.subjectPubkey ? ` · subject ${shortKey(finding.subjectPubkey)}` : '')));
    section.appendChild(el('h4', 'xr-inspector__sub', 'Word (stated)'));
    section.appendChild(el('div', 'xr-inspector__mono',
        `${finding.word.class}: ${truncate(finding.word.coord, 70)}`));
    section.appendChild(el('h4', 'xr-inspector__sub',
        `Deeds (enacted, ${finding.deeds.length})`));
    finding.deeds.forEach((d) => section.appendChild(
        el('div', 'xr-inspector__mono', `${d.class}: ${truncate(d.coord, 70)}`)));
    if (finding.gap) {
        section.appendChild(el('h4', 'xr-inspector__sub', 'Gap decomposition (documented)'));
        section.appendChild(el('div', null, `${finding.gap.cause}: ${finding.gap.note}`));
        if (finding.gap.constraintCoord) {
            section.appendChild(el('div', 'xr-inspector__mono',
                `constraint (discounting evidence): ${truncate(finding.gap.constraintCoord, 60)}`));
        }
    }
    renderRulingCommon(section, finding);
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

    if (item.kind === 30023 && item.sourceType && SOURCE_TYPE_LABELS[item.sourceType]) {
        const line = el('div', 'xr-inspector__srctype',
            `Source type: ${SOURCE_TYPE_LABELS[item.sourceType]}`
            + (isPrimarySourceType(item.sourceType) ? ' — primary source' : ''));
        host.appendChild(line);
    }

    // Phase 23.1b — outbound links carrying a declared evidence role
    // (citation intent). Read straight off the `link` tags' 4th slot.
    if (item.kind === 30023) {
        const roled = (item.event.tags || [])
            .filter((t) => t[0] === 'link' && isValidEvidenceRole(t[3]))
            .map((t) => ({ url: t[1] || '', anchor: t[2] || '', role: t[3] }));
        if (roled.length) {
            const box = el('div', 'xr-inspector__roles');
            box.appendChild(el('div', 'xr-inspector__roles-head', 'Cited sources'));
            for (const r of roled) {
                const row = el('div', 'xr-inspector__role-row');
                row.appendChild(el('span', 'xr-badge', EVIDENCE_ROLE_LABELS[r.role]));
                const a = el('a', 'xr-inspector__role-link', truncate(r.anchor || r.url, 80));
                a.href = r.url; a.target = '_blank'; a.rel = 'noopener'; a.title = r.url;
                row.appendChild(a);
                box.appendChild(row);
            }
            host.appendChild(box);
        }
    }

    if (item.kind === 30023) {
        const open = el('button', 'xr-portal__btn', 'Open in reader');
        open.type = 'button';
        open.title = 'Reconstruct this capture from its signed event and open it read-only in the reader';
        open.addEventListener('click', async () => {
            const article = EventBuilder.reconstructArticleFromEvent(item.event);
            if (!article) {
                open.textContent = 'Could not reconstruct';
                return;
            }
            // Tagged entities ride the event as typed name tags — rebuild
            // them so the read-only reader shows what was tagged.
            try {
                article.entities = await EventBuilder.reconstructEntityRefsFromEvent(item.event);
            } catch (_) { /* fail-open: article opens without entity refs */ }
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

    // 15.9: adjudicated verdicts + integrity findings, derivation on
    // their face (evidence, standard, caveats — §5.5).
    if (item.kind === 30063 && item.parsedVerdict) {
        renderVerdictSection(host, item.parsedVerdict);
    }
    if (item.kind === 30064 && item.parsedIntegrity) {
        renderIntegritySection(host, item.parsedIntegrity);
    }

    // 23.2 — the structured case brief: summary + counts + a note on the
    // readable sibling article.
    if (item.kind === 30068 && item.parsedBrief) {
        renderCaseBriefSection(host, item.parsedBrief);
    }

    const details = el('details', 'xr-inspector__raw');
    details.open = true;
    details.appendChild(el('summary', null, 'Raw signed event'));
    const pre = el('pre');
    pre.textContent = JSON.stringify(item.event, null, 2);
    details.appendChild(pre);
    host.appendChild(details);
}

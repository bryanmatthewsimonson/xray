// Adjudicate modal — Phase 15.8 (docs/TRUTH_ADJUDICATION_DESIGN.md).
//
// The adjudication-capture UI for one claim: atomize it into a
// proposition (class, subject role, resolution criteria, event-time)
// and — when the class survives the §3.1 firewall — rule a verdict
// (descriptive state, declared standard, verbatim two-sided evidence,
// mandatory caveats). One proposition per (claim, class) by
// construction, so the class chips double as the selector: picking a
// class with an existing proposition loads it, and its active verdict
// chain surfaces with Save becoming a SUPERSEDING ruling (append-only
// — there is no edit path for a ruling, deliberately).
//
// The firewall is a UI fact, not just a validator: selecting
// `interpretation` or `stated-value` replaces the verdict section with
// the firewall explainer. The proposition still saves — recording WHY
// something is un-adjudicable is the point — but no ruling can be
// authored on it here or anywhere.
//
// UI-in-shared exception: renders DOM like assess-modal.js /
// forensic-modal.js (the one adjudication surface, usable from the
// reader today and the portal later). Injects its own <style>
// (xr-adjudicate-* only). Must NOT be imported by the content script.

import { TruthAdjudicationModel, VerdictModel, verdictVariance } from './truth-adjudication-model.js';
import { collectClaimCandidates, candidateHay, matchesCandidateQuery } from './claim-candidates.js';
import { parseAdjudicatedVerdictEvent } from './truth-builders.js';
import { convergenceForProposition } from './truth-attestation.js';
import {
    PROPOSITION_CLASSES, PROPOSITION_CLASS_LABELS,
    SUBJECT_ROLES, SUBJECT_ROLE_LABELS, SUBJECT_ROLE_UNCLASSIFIED,
    OCCURRED_PRECISIONS,
    VERDICT_STATES, VERDICT_STATE_LABELS,
    STANDARDS_OF_PROOF, STANDARD_OF_PROOF_LABELS, defaultStandardOfProof,
    EVIDENCE_TIERS, EVIDENCE_TIER_LABELS,
    isTruthAdjudicable
} from './truth-taxonomy.js';

// ------------------------------------------------------------------
// Shared rendering helpers (claims bar now, portal later)
// ------------------------------------------------------------------

export const PROPOSITION_CLASS_ICONS = Object.freeze({
    'event-fact':        '📋',
    'state-fact':        '🌍',
    'prediction':        '🔮',
    'stated-commitment': '🤝',
    'stated-value':      '💛',
    'interpretation':    '🗣'
});

const VERDICT_STATE_ICONS = Object.freeze({
    'established-true':      '✓',
    'established-false':     '✗',
    'contested':             '⚔',
    'unresolved':            '⏳',
    'insufficient-evidence': '∅'
});

/**
 * Pure badge data for one claim's adjudication state: one entry per
 * proposition, carrying its class, the ACTIVE verdict state (or
 * null = unruled; 'firewalled' is impossible by construction), and
 * publish state. Exported separately from the HTML so it is testable
 * without DOM.
 *
 * @param {object[]} propositions - this claim's propositions
 * @param {Map<string, object>} activeVerdictByPropId
 * @returns {Array<{propositionId, class, classLabel, icon, state, stateLabel, adjudicable, published}>}
 */
export function adjudicationBadgeData(propositions, activeVerdictByPropId) {
    return (propositions || []).map((p) => {
        const verdict = activeVerdictByPropId && activeVerdictByPropId.get(p.id);
        return {
            propositionId: p.id,
            class:         p.proposition_class,
            classLabel:    PROPOSITION_CLASS_LABELS[p.proposition_class] || p.proposition_class,
            icon:          PROPOSITION_CLASS_ICONS[p.proposition_class] || '•',
            adjudicable:   isTruthAdjudicable(p),
            state:         verdict ? verdict.verdict : null,
            stateLabel:    verdict ? (VERDICT_STATE_LABELS[verdict.verdict] || verdict.verdict) : null,
            published:     !!(verdict && verdict.publishedAt)
        };
    });
}

/** Compact badge strip for a claim's propositions/verdicts. Pure HTML string. */
export function renderAdjudicationBadges(propositions, activeVerdictByPropId) {
    const data = adjudicationBadgeData(propositions, activeVerdictByPropId);
    if (data.length === 0) return '';
    ensureStyles();
    const bits = data.map((d) => {
        const state = d.adjudicable
            ? (d.state
                ? `${VERDICT_STATE_ICONS[d.state] || ''} ${escapeHtml(d.stateLabel)}`
                : 'unruled')
            : 'not truth-adjudicable';
        const cls = d.state ? ` xr-adjudicate-badge--${escapeHtml(d.state)}`
            : (d.adjudicable ? '' : ' xr-adjudicate-badge--firewalled');
        const pub = d.published ? ' 🌐' : '';
        return `<span class="xr-adjudicate-badge${cls}" title="${escapeHtml(d.classLabel)}: ${escapeHtml(state)}">`
            + `${d.icon} ${escapeHtml(d.classLabel)} · ${state}${pub}</span>`;
    });
    return `<div class="xr-adjudicate-badges">${bits.join('')}</div>`;
}

/**
 * Build the claim-keyed adjudication lookup for badge overlays:
 * Map<claim_id, { propositions, activeVerdictByPropId }>.
 */
export async function adjudicationsByClaimId() {
    const [propositions, verdicts] = await Promise.all([
        TruthAdjudicationModel.list(), VerdictModel.list()
    ]);
    const activeByProp = new Map();
    for (const v of verdicts) {
        if (!v.superseded_by) activeByProp.set(v.proposition_id, v);
    }
    const map = new Map();
    for (const p of propositions) {
        if (!map.has(p.claim_id)) {
            map.set(p.claim_id, { propositions: [], activeVerdictByPropId: activeByProp });
        }
        map.get(p.claim_id).propositions.push(p);
    }
    return map;
}

// ------------------------------------------------------------------
// Form ↔ model mapping (pure, exported for tests)
// ------------------------------------------------------------------

/** 'YYYY-MM-DD' → Unix seconds (UTC midnight), or null. */
export function dateInputToOccurredAt(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
    if (!m) return null;
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** Textarea → caveat list (one per line, blanks dropped). */
export function linesToList(value) {
    return String(value || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

// ------------------------------------------------------------------
// The modal
// ------------------------------------------------------------------

/**
 * Open the adjudicate modal for one claim.
 *
 * @param {{ claimId: string, claimText?: string,
 *           relays?: string[], claimPubkey?: string|null }} opts
 *   `relays` + `claimPubkey` (the claim's publishedPubkey) enable the
 *   "Others' rulings" fetch — foreign 30063s on this proposition,
 *   surfaced through verdictVariance (each ruling + the spread, never
 *   a consensus number).
 * @returns {Promise<{proposition: object, verdict?: object} | null>}
 *   what was saved, or null on cancel.
 */
/**
 * Map a modal evidence row `{claim_ref, tier, note, candidate}` to the
 * truth-adjudication-model evidence shape (amendment §5.5a: evidence
 * entries REFERENCE captured claims/quotes — nothing is typed except
 * the tier and a short note). The linked artifact supplies everything:
 * `quote` is snapshotted from the claim's verbatim quote (fallback:
 * its text), so the record stays self-contained and the wire quote
 * slot fills even if the claim is later deleted; `source_ref` carries
 * the claim's source URL; `claim_ref` is the canonical ref (local id
 * or 30040 coordinate). Exported for the integrity modal and tests.
 */
export function evidenceEntryToRecord(e) {
    const cand = e.candidate || {};
    const out = {
        quote:     String(cand.quote || cand.text || e.quote || '').trim(),
        tier:      e.tier,
        note:      String(e.note || '').trim(),
        claim_ref: e.claim_ref
    };
    const url = String(cand.url_raw || cand.url || '').trim();
    if (url) out.source_ref = { url, url_raw: url };
    return out;
}

/**
 * Display line for a claim/quote candidate. A spoken artifact leads
 * with its speaker ("W.H.O. — “…”"); an unsourced claim leads with
 * its CLAIM TEXT — that's the line the user wrote and scans for —
 * falling back to the quote for text-less snapshots.
 */
export function candidateLabel(cand) {
    if (cand.speaker) return `${cand.speaker} — “${cand.quote || cand.text || ''}”`;
    return cand.text || cand.quote || '';
}

/**
 * Tooltip for a candidate row: when the claim text and its verbatim
 * quote differ, show both — the one-line label can only carry one.
 */
export function candidateTitle(cand) {
    const label = candidateLabel(cand);
    const text = (cand.text || '').trim();
    const quote = (cand.quote || '').trim();
    if (text && quote && text !== quote) return `${text}\n“${quote}”`;
    return label;
}

export async function openAdjudicateModal({ claimId, claimText = '', relays = [], claimPubkey = null }) {
    ensureStyles();
    const existingProps = await TruthAdjudicationModel.getByClaim(claimId);
    const byClass = new Map(existingProps.map((p) => [p.proposition_class, p]));

    // Grounded evidence (amendment §5.5a): evidence entries reference
    // captured claims/quotes — the picker pool is EVERY claim across
    // all articles plus assessed-foreign snapshots (the claim being
    // adjudicated is excluded). Load failure renders an empty picker
    // with its capture-first hint.
    let candidates = [];
    try {
        candidates = await collectClaimCandidates({ exclude: [claimId] });
    } catch (_) { /* picker renders the capture-first empty state */ }

    const state = {
        cls:          existingProps.length ? existingProps[0].proposition_class : null,
        activeVerdict: null,   // resolved per selected class
        evidenceFor:   [],     // [{claim_ref, tier, note, candidate}]
        evidenceAgainst: []
    };

    return new Promise((resolve) => {
        const host = document.createElement('div');
        host.className = 'xr-adjudicate';
        host.innerHTML = buildHtml(claimText);
        document.body.appendChild(host);
        const $ = (sel) => host.querySelector(sel);

        const close = (result) => {
            document.removeEventListener('keydown', onKey);
            if (host.parentNode) host.parentNode.removeChild(host);
            resolve(result);
        };
        const onKey = (ev) => { if (ev.key === 'Escape') close(null); };
        const showError = (msg) => {
            const err = $('.xr-adjudicate__err');
            err.textContent = msg;
            err.hidden = false;
        };

        // ---- proposition class chips (the selector) -----------------
        async function selectClass(cls) {
            state.cls = cls;
            $('.xr-adjudicate__err').hidden = true;
            host.querySelectorAll('.xr-adjudicate__class-btn').forEach((b) => {
                b.classList.toggle('xr-adjudicate__class-btn--active', b.dataset.cls === cls);
            });
            const existing = byClass.get(cls) || null;
            // Seed the proposition fields from the existing record.
            const rc = (existing && existing.resolution_criteria) || {};
            $('.xr-adjudicate__criteria').value = rc.criteria || '';
            $('.xr-adjudicate__horizon').value = rc.horizon || '';
            host.querySelectorAll('.xr-adjudicate__role-btn').forEach((b) => {
                b.classList.toggle('xr-adjudicate__role-btn--active',
                    b.dataset.role === ((existing && existing.subject_role) || SUBJECT_ROLE_UNCLASSIFIED));
            });
            const occurredAt = existing && existing.occurred_at;
            $('.xr-adjudicate__occurred').value = occurredAt
                ? new Date(occurredAt * 1000).toISOString().slice(0, 10) : '';
            $('.xr-adjudicate__precision').value = (existing && existing.occurred_precision) || 'day';
            $('.xr-adjudicate__horizon-row').hidden = false;
            $('.xr-adjudicate__horizon-req').hidden = cls !== 'prediction';

            // The §3.2 convergence measurement, when this proposition
            // already has attestation edges (supports links with
            // attestation metadata) — counts with their derivation.
            const convergenceEl = $('.xr-adjudicate__convergence');
            convergenceEl.hidden = true;
            if (existing) {
                convergenceForProposition(existing.id).then((c) => {
                    if (state.cls !== cls || c.total_attestations === 0) return;
                    convergenceEl.hidden = false;
                    convergenceEl.textContent =
                        `Attestation: ${c.independent_count} demonstrated-independent origin(s)`
                        + ` of ${c.origin_count} (${c.total_attestations} attestation(s))`
                        + (c.undemonstrated.length ? ` · undemonstrated: ${c.undemonstrated.join(', ')}` : '');
                }).catch(() => { /* display only */ });
            }

            // Verdict section vs the firewall explainer.
            const adjudicable = isTruthAdjudicable(cls);
            $('.xr-adjudicate__verdict').hidden = !adjudicable;
            $('.xr-adjudicate__firewall').hidden = adjudicable;
            if (adjudicable) {
                // Others' rulings need the claim's wire coordinate
                // (published claim) + configured relays.
                $('.xr-adjudicate__others-bar').hidden = !(claimPubkey && relays.length);
                $('.xr-adjudicate__others').textContent = '';
                $('.xr-adjudicate__standard').value = defaultStandardOfProof(cls);
                state.activeVerdict = existing
                    ? await VerdictModel.getActiveForProposition(existing.id) : null;
                const chain = $('.xr-adjudicate__chain');
                if (state.activeVerdict) {
                    chain.hidden = false;
                    chain.innerHTML = `Active ruling: <strong>${escapeHtml(VERDICT_STATE_LABELS[state.activeVerdict.verdict] || state.activeVerdict.verdict)}</strong>`
                        + ` (${new Date((state.activeVerdict.created || 0) * 1000).toLocaleDateString()})`
                        + ' — saving a new ruling <strong>supersedes</strong> it; the old ruling is kept, never edited.';
                    $('[data-action="save"]').textContent = 'Save superseding ruling';
                } else {
                    chain.hidden = true;
                    $('[data-action="save"]').textContent = 'Save';
                }
                // A fresh ruling starts blank — never seeded from the
                // active one (that would invite edit-by-supersession
                // muscle memory; the author should re-derive).
                host.querySelectorAll('.xr-adjudicate__state-btn').forEach((b) => {
                    b.classList.remove('xr-adjudicate__state-btn--active');
                });
                state.evidenceFor = [];
                state.evidenceAgainst = [];
                renderEvidence();
                $('.xr-adjudicate__caveats').value = '';
                $('.xr-adjudicate__method').value = '';
                $('.xr-adjudicate__exposure').value = '';
                $('.xr-adjudicate__rationale').value = '';
            } else {
                state.activeVerdict = null;
                $('[data-action="save"]').textContent = 'Save proposition';
            }
        }
        host.querySelectorAll('.xr-adjudicate__class-btn').forEach((b) => {
            b.addEventListener('click', () => { selectClass(b.dataset.cls); });
        });

        // ---- subject role chips -------------------------------------
        host.querySelectorAll('.xr-adjudicate__role-btn').forEach((b) => {
            b.addEventListener('click', () => {
                host.querySelectorAll('.xr-adjudicate__role-btn').forEach((x) =>
                    x.classList.toggle('xr-adjudicate__role-btn--active', x === b));
            });
        });

        // ---- verdict state chips ------------------------------------
        host.querySelectorAll('.xr-adjudicate__state-btn').forEach((b) => {
            b.addEventListener('click', () => {
                const active = b.classList.contains('xr-adjudicate__state-btn--active');
                host.querySelectorAll('.xr-adjudicate__state-btn').forEach((x) =>
                    x.classList.remove('xr-adjudicate__state-btn--active'));
                if (!active) b.classList.add('xr-adjudicate__state-btn--active');
            });
        });

        // ---- evidence rows (amendment §5.5a) -------------------------
        // Evidence entries REFERENCE captured claims/quotes — "+ add"
        // opens a searchable picker over the cross-article pool; a
        // picked row shows speaker-first ("W.H.O. — “…”") with a tier
        // select and a short why-note. Nothing else is typed. Not
        // captured yet? Capture the claim/quote first.
        const ORIGIN_ICONS = { local: '📋', assessed: '⚖', network: '🌐' };
        const hostOf = (u) => { try { return new URL(u).host; } catch { return u || ''; } };
        function renderEvidence() {
            for (const side of ['For', 'Against']) {
                const list = state[`evidence${side}`];
                const wrap = $(`.xr-adjudicate__ev-${side.toLowerCase()}`);
                wrap.innerHTML = list.map((e, i) => {
                    const cand = e.candidate || {};
                    return `
                  <div class="xr-adjudicate__ev-row" data-side="${side}" data-i="${i}">
                    <span class="xr-adjudicate__ev-origin" title="${escapeHtml(cand.origin || 'local')}">${ORIGIN_ICONS[cand.origin] || '📋'}</span>
                    <span class="xr-adjudicate__ev-label" title="${escapeHtml(candidateTitle(cand))}">${escapeHtml(candidateLabel(cand))}</span>
                    <span class="xr-adjudicate__ev-host">${escapeHtml(hostOf(cand.url))}</span>
                    <select class="xr-adjudicate__ev-tier">
                      <option value="">tier —</option>
                      ${EVIDENCE_TIERS.map((t) => `<option value="${t}" ${e.tier === t ? 'selected' : ''}>${escapeHtml(EVIDENCE_TIER_LABELS[t])}</option>`).join('')}
                    </select>
                    <button type="button" class="xr-adjudicate__ev-del" title="Remove">✕</button>
                    <input type="text" class="xr-adjudicate__ev-note" placeholder="why this ${side === 'For' ? 'supports' : 'contradicts'} (optional)"
                           value="${escapeHtml(e.note || '')}" />
                  </div>`;
                }).join('');
                wrap.querySelectorAll('.xr-adjudicate__ev-row').forEach((row) => {
                    const i = Number(row.dataset.i);
                    row.querySelector('.xr-adjudicate__ev-tier').addEventListener('change', (ev) => {
                        list[i].tier = ev.target.value || null;
                    });
                    row.querySelector('.xr-adjudicate__ev-note').addEventListener('input', (ev) => {
                        list[i].note = ev.target.value;
                    });
                    row.querySelector('.xr-adjudicate__ev-del').addEventListener('click', () => {
                        list.splice(i, 1);
                        renderEvidence();
                    });
                });
            }
        }

        // The in-modal claim/quote picker (the link-modal pattern).
        // One panel, re-targeted per side; selection pushes an entry.
        let pickerSide = null;
        function renderPicker() {
            const listEl = $('.xr-adjudicate__picker-list');
            listEl.innerHTML = candidates.length === 0
                ? '<div class="xr-adjudicate__picker-empty">No captured claims or quotes yet — capture the evidence as a claim/quote first (select its text in the source article), then come back.</div>'
                : candidates.map((c, idx) => `
                    <button type="button" class="xr-adjudicate__picker-item" data-idx="${idx}"
                            title="${escapeHtml(candidateTitle(c))}"
                            data-hay="${escapeHtml(candidateHay(c))}">
                      <span title="${escapeHtml(c.origin)}">${ORIGIN_ICONS[c.origin] || '📋'}</span>
                      <span class="xr-adjudicate__picker-text">${escapeHtml(candidateLabel(c))}</span>
                      <span class="xr-adjudicate__ev-host">${escapeHtml(hostOf(c.url))}</span>
                    </button>`).join('');
            listEl.querySelectorAll('.xr-adjudicate__picker-item').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const cand = candidates[Number(btn.dataset.idx)];
                    if (!cand || !pickerSide) return;
                    state[`evidence${pickerSide}`].push({
                        claim_ref: cand.ref, tier: null, note: '', candidate: cand
                    });
                    $('.xr-adjudicate__picker').hidden = true;
                    pickerSide = null;
                    renderEvidence();
                });
            });
        }
        function openPicker(side) {
            pickerSide = side;
            const panel = $('.xr-adjudicate__picker');
            $('.xr-adjudicate__picker-title').textContent =
                `Cite a captured claim/quote as evidence ${side.toLowerCase()}`;
            // The count makes a silently-empty pool visible, and the
            // exclusion note explains the one row that is never here.
            $('.xr-adjudicate__picker-hint').textContent =
                `${candidates.length} claim${candidates.length === 1 ? '' : 's'}/quotes across your captures — ` +
                `the claim being adjudicated is excluded (it can't cite itself).`;
            panel.hidden = false;
            const search = $('.xr-adjudicate__picker-search');
            search.value = '';
            renderPicker();
            search.focus();
        }
        $('.xr-adjudicate__picker-search').addEventListener('input', (ev) => {
            const q = ev.target.value;
            host.querySelectorAll('.xr-adjudicate__picker-item').forEach((btn) => {
                btn.hidden = !matchesCandidateQuery(btn.dataset.hay, q);
            });
        });
        $('.xr-adjudicate__picker-close').addEventListener('click', () => {
            $('.xr-adjudicate__picker').hidden = true;
            pickerSide = null;
        });
        $('[data-action="add-for"]').addEventListener('click', () => openPicker('For'));
        $('[data-action="add-against"]').addEventListener('click', () => openPicker('Against'));

        // ---- others' rulings (read-back: foreign 30063s on this
        // proposition, each shown with the spread — never a consensus
        // number; malformed events null-parse and are never shown) ----
        const othersBtn = host.querySelector('[data-action="others"]');
        if (othersBtn) othersBtn.addEventListener('click', () => {
            const wrap = $('.xr-adjudicate__others');
            if (!state.cls || !claimPubkey || !relays.length) return;
            const coord = `30040:${claimPubkey}:${claimId}`;
            wrap.textContent = `Querying ${relays.length} relay(s)…`;
            chrome.runtime.sendMessage({
                type: 'xray:relay:query',
                relays,
                filter: { kinds: [30063], '#a': [coord], limit: 100 },
                timeoutMs: 6000
            }, (resp) => {
                if (!resp || !resp.ok) {
                    wrap.textContent = `Query failed: ${(resp && resp.error) || 'no response from service worker'}`;
                    return;
                }
                const byAuthorD = new Map();
                for (const ev of resp.events || []) {
                    const parsed = parseAdjudicatedVerdictEvent(ev);
                    if (!parsed || parsed.propositionClass !== state.cls) continue;
                    const key = `${parsed.pubkey}|${parsed.id}`;
                    const prev = byAuthorD.get(key);
                    if (!prev || (parsed.created_at || 0) > (prev.created_at || 0)) {
                        byAuthorD.set(key, parsed);   // addressable: latest replaces
                    }
                }
                const rulings = [...byAuthorD.values()];
                wrap.innerHTML = '';
                if (rulings.length === 0) {
                    wrap.textContent = 'No rulings on the configured relays (malformed rulings are never shown).';
                    return;
                }
                const variance = verdictVariance(rulings);
                const summary = Object.entries(variance.by_state)
                    .map(([s, n]) => `${escapeHtml(s)}: ${n}`).join(' · ');
                const head = document.createElement('div');
                head.className = 'xr-adjudicate__others-summary';
                head.innerHTML = `${variance.total} ruling(s)${variance.unanimous ? ' — unanimous' : ' — disagreement is data'} · ${summary}`;
                wrap.appendChild(head);
                for (const r of rulings.slice(0, 10)) {
                    const row = document.createElement('div');
                    row.className = 'xr-adjudicate__others-row';
                    row.textContent = `${r.verdict} · ${r.standardOfProof} · ${r.caveats.length} caveat(s)`
                        + (r.exposure ? ' · disclosed interest' : '')
                        + ` · ${r.pubkey.slice(0, 10)}…`;
                    row.title = (r.caveats || []).join('\n');
                    wrap.appendChild(row);
                }
            });
        });

        // ---- footer --------------------------------------------------
        $('[data-action="cancel"]').addEventListener('click', () => close(null));
        $('.xr-adjudicate__close').addEventListener('click', () => close(null));
        $('.xr-adjudicate__backdrop').addEventListener('click', () => close(null));

        $('[data-action="save"]').addEventListener('click', async () => {
            if (!state.cls) { showError('Pick a proposition class first — what kind of thing does this claim assert?'); return; }
            const roleBtn = host.querySelector('.xr-adjudicate__role-btn--active');
            const occurredDate = $('.xr-adjudicate__occurred').value;
            const occurredAt = dateInputToOccurredAt(occurredDate);
            const propositionFields = {
                resolution_criteria: {
                    criteria: $('.xr-adjudicate__criteria').value,
                    horizon:  $('.xr-adjudicate__horizon').value
                },
                subject_role:       roleBtn ? roleBtn.dataset.role : SUBJECT_ROLE_UNCLASSIFIED,
                occurred_at:        occurredAt,
                occurred_precision: occurredAt ? $('.xr-adjudicate__precision').value : null
            };
            try {
                const existing = byClass.get(state.cls);
                const proposition = existing
                    ? await TruthAdjudicationModel.update(existing.id, propositionFields)
                    : await TruthAdjudicationModel.create({
                        claim_id: claimId, proposition_class: state.cls, ...propositionFields
                    });
                byClass.set(state.cls, proposition);

                // Verdict — only when adjudicable AND a state is picked.
                let verdict;
                const stateBtn = host.querySelector('.xr-adjudicate__state-btn--active');
                if (isTruthAdjudicable(state.cls) && stateBtn) {
                    verdict = await VerdictModel.create({
                        proposition_id:    proposition.id,
                        verdict:           stateBtn.dataset.state,
                        standard_of_proof: $('.xr-adjudicate__standard').value,
                        evidence_for:      state.evidenceFor.filter((e) => e.claim_ref)
                            .map(evidenceEntryToRecord),
                        evidence_against:  state.evidenceAgainst.filter((e) => e.claim_ref)
                            .map(evidenceEntryToRecord),
                        caveats:           linesToList($('.xr-adjudicate__caveats').value),
                        method:            $('.xr-adjudicate__method').value,
                        exposure:          $('.xr-adjudicate__exposure').value,
                        rationale:         $('.xr-adjudicate__rationale').value,
                        supersedes:        state.activeVerdict ? state.activeVerdict.id : null
                    });
                }
                close({ proposition, verdict });
            } catch (err) {
                showError(err.message || String(err));
            }
        });

        document.addEventListener('keydown', onKey);
        if (state.cls) selectClass(state.cls);
    });
}

// ------------------------------------------------------------------
// Markup + styles
// ------------------------------------------------------------------

function buildHtml(claimText) {
    const classBtns = PROPOSITION_CLASSES.map((c) => `
        <button type="button" class="xr-adjudicate__class-btn${isTruthAdjudicable(c) ? '' : ' xr-adjudicate__class-btn--firewalled'}"
                data-cls="${c}" title="${isTruthAdjudicable(c) ? escapeHtml(PROPOSITION_CLASS_LABELS[c]) : 'Recordable, but never adjudicable as true/false (the §3.1 firewall)'}">
          ${PROPOSITION_CLASS_ICONS[c]} ${escapeHtml(PROPOSITION_CLASS_LABELS[c])}
        </button>`).join('');

    const roleBtns = SUBJECT_ROLES.map((r) => `
        <button type="button" class="xr-adjudicate__role-btn${r === SUBJECT_ROLE_UNCLASSIFIED ? ' xr-adjudicate__role-btn--active' : ''}"
                data-role="${r}">${escapeHtml(SUBJECT_ROLE_LABELS[r])}</button>`).join('');

    const stateBtns = VERDICT_STATES.map((s) => `
        <button type="button" class="xr-adjudicate__state-btn" data-state="${s}">
          ${escapeHtml(VERDICT_STATE_LABELS[s])}
        </button>`).join('');

    const standardOpts = STANDARDS_OF_PROOF.map((s) =>
        `<option value="${s}">${escapeHtml(STANDARD_OF_PROOF_LABELS[s])}</option>`).join('');

    const precisionOpts = OCCURRED_PRECISIONS.map((p) =>
        `<option value="${p}" ${p === 'day' ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('');

    return `
      <div class="xr-adjudicate__backdrop"></div>
      <div class="xr-adjudicate__card">
        <header class="xr-adjudicate__head">
          <h2 class="xr-adjudicate__title">Adjudicate claim</h2>
          <button type="button" class="xr-adjudicate__close" aria-label="Cancel">✕</button>
        </header>
        <div class="xr-adjudicate__body">
          <div class="xr-adjudicate__err" hidden></div>
          <blockquote class="xr-adjudicate__claim">${escapeHtml(claimText || '(claim)')}</blockquote>

          <div class="xr-adjudicate__field">
            <span class="xr-adjudicate__field-label">Proposition class <em>(one proposition per class per claim)</em></span>
            <div class="xr-adjudicate__classes">${classBtns}</div>
          </div>

          <div class="xr-adjudicate__field">
            <span class="xr-adjudicate__field-label">Subject role <em>(the claim's relationship to its about-entity — never assumed)</em></span>
            <div class="xr-adjudicate__roles">${roleBtns}</div>
          </div>

          <label class="xr-adjudicate__field">
            <span class="xr-adjudicate__field-label">Resolution criteria <em>(what evidence would settle it)</em></span>
            <textarea class="xr-adjudicate__criteria" rows="2"
                      placeholder="e.g. the official roll-call record"></textarea>
          </label>

          <div class="xr-adjudicate__field xr-adjudicate__horizon-row">
            <span class="xr-adjudicate__field-label">Horizon
              <em class="xr-adjudicate__horizon-req" hidden>(REQUIRED for a prediction)</em></span>
            <input type="text" class="xr-adjudicate__horizon" placeholder="e.g. by 2027-12-31 · facts default to already-determinable" />
          </div>

          <div class="xr-adjudicate__field xr-adjudicate__occurred-row">
            <span class="xr-adjudicate__field-label">Event-time <em>(when the deed/utterance happened — needs an honest precision)</em></span>
            <input type="date" class="xr-adjudicate__occurred" />
            <select class="xr-adjudicate__precision">${precisionOpts}</select>
          </div>

          <div class="xr-adjudicate__convergence xr-adjudicate__others" hidden></div>

          <div class="xr-adjudicate__firewall" hidden>
            🔥 <strong>Not adjudicable as true/false.</strong> This class is recorded so the
            classification itself is on the books — only the honesty of the reasoning
            (assess it instead) or the observable word–deed gap (an integrity finding)
            is assessable. No ruling can be authored on it.
          </div>

          <div class="xr-adjudicate__verdict" hidden>
            <hr class="xr-adjudicate__rule" />
            <div class="xr-adjudicate__chain" hidden></div>
            <div class="xr-adjudicate__others-bar" hidden>
              <button type="button" class="xr-adjudicate__ev-add" data-action="others">🌐 Others' rulings on this proposition</button>
              <div class="xr-adjudicate__others"></div>
            </div>
            <div class="xr-adjudicate__field">
              <span class="xr-adjudicate__field-label">Ruling <em>(descriptive state — there is no score)</em></span>
              <div class="xr-adjudicate__states">${stateBtns}</div>
            </div>
            <label class="xr-adjudicate__field">
              <span class="xr-adjudicate__field-label">Standard of proof <em>(declared on the record)</em></span>
              <select class="xr-adjudicate__standard">${standardOpts}</select>
            </label>
            <div class="xr-adjudicate__field">
              <span class="xr-adjudicate__field-label">Evidence for <em>(cited claims/quotes)</em>
                <button type="button" class="xr-adjudicate__ev-add" data-action="add-for">+ cite</button></span>
              <div class="xr-adjudicate__ev-for"></div>
            </div>
            <div class="xr-adjudicate__field">
              <span class="xr-adjudicate__field-label">Evidence against <em>(cited claims/quotes)</em>
                <button type="button" class="xr-adjudicate__ev-add" data-action="add-against">+ cite</button></span>
              <div class="xr-adjudicate__ev-against"></div>
            </div>
            <div class="xr-adjudicate__picker" hidden>
              <div class="xr-adjudicate__picker-head">
                <span class="xr-adjudicate__picker-title"></span>
                <button type="button" class="xr-adjudicate__picker-close" aria-label="Close">✕</button>
              </div>
              <div class="xr-adjudicate__picker-hint"></div>
              <input type="search" class="xr-adjudicate__picker-search"
                     placeholder="Search claims & quotes (text, quote, speaker, url)…" spellcheck="false" />
              <div class="xr-adjudicate__picker-list"></div>
            </div>
            <label class="xr-adjudicate__field">
              <span class="xr-adjudicate__field-label">Caveats <em>(REQUIRED — one per line: what this ruling could not determine)</em></span>
              <textarea class="xr-adjudicate__caveats" rows="2"
                        placeholder="e.g. could not verify whether a later motion changed the vote"></textarea>
            </label>
            <label class="xr-adjudicate__field">
              <span class="xr-adjudicate__field-label">Method <em>(optional)</em></span>
              <input type="text" class="xr-adjudicate__method" placeholder="e.g. manual record check" />
            </label>
            <label class="xr-adjudicate__field">
              <span class="xr-adjudicate__field-label">Disclosure <em>(optional — your relevant interests/priors; published WITH the ruling)</em></span>
              <input type="text" class="xr-adjudicate__exposure" placeholder="e.g. donor to the subject's opponent in 2024" />
            </label>
            <label class="xr-adjudicate__field">
              <span class="xr-adjudicate__field-label">Rationale <em>(optional, markdown)</em></span>
              <textarea class="xr-adjudicate__rationale" rows="2"></textarea>
            </label>
          </div>
        </div>
        <footer class="xr-adjudicate__foot">
          <span class="xr-adjudicate__foot-gap"></span>
          <button type="button" class="xr-adjudicate__btn xr-adjudicate__btn--ghost" data-action="cancel">Cancel</button>
          <button type="button" class="xr-adjudicate__btn xr-adjudicate__btn--primary" data-action="save">Save</button>
        </footer>
      </div>`;
}

let stylesInjected = false;
function ensureStyles() {
    if (stylesInjected || typeof document === 'undefined') return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.id = 'xr-adjudicate-styles';
    style.textContent = `
.xr-adjudicate { position: fixed; inset: 0; z-index: 10010; }
.xr-adjudicate__backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.55); }
.xr-adjudicate__card {
  position: relative; margin: 4vh auto 0; width: min(620px, calc(100vw - 32px));
  max-height: 90vh; display: flex; flex-direction: column;
  background: var(--xr-surface, #242424); color: var(--xr-text, #e6e6e6);
  border: 1px solid var(--xr-border, #333); border-radius: 10px;
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.xr-adjudicate__head, .xr-adjudicate__foot { display: flex; align-items: center; gap: 8px; padding: 12px 16px; }
.xr-adjudicate__head { border-bottom: 1px solid var(--xr-border, #333); }
.xr-adjudicate__foot { border-top: 1px solid var(--xr-border, #333); }
.xr-adjudicate__foot-gap { flex: 1; }
.xr-adjudicate__title { margin: 0; font-size: 15px; flex: 1; }
.xr-adjudicate__close { background: none; border: none; color: inherit; cursor: pointer; font-size: 14px; }
.xr-adjudicate__body { padding: 12px 16px; overflow-y: auto; }
.xr-adjudicate__err {
  background: color-mix(in srgb, var(--xr-danger, #f87171) 18%, transparent);
  border: 1px solid var(--xr-danger, #f87171); border-radius: 6px;
  padding: 6px 10px; margin-bottom: 10px; font-size: 12.5px;
}
.xr-adjudicate__claim {
  margin: 0 0 12px; padding: 8px 12px; border-left: 3px solid var(--xr-primary, #8b5cf6);
  background: var(--xr-surface-2, #2e2e2e); border-radius: 0 6px 6px 0;
  font-style: italic; max-height: 90px; overflow-y: auto;
}
.xr-adjudicate__field { display: block; margin-bottom: 12px; }
.xr-adjudicate__field-label { display: block; font-size: 11px; text-transform: uppercase;
  letter-spacing: .04em; color: var(--xr-text-dim, #9a9a9a); margin-bottom: 6px; }
.xr-adjudicate__field-label em { text-transform: none; letter-spacing: 0; }
.xr-adjudicate__classes, .xr-adjudicate__roles, .xr-adjudicate__states { display: flex; gap: 6px; flex-wrap: wrap; }
.xr-adjudicate__class-btn, .xr-adjudicate__role-btn, .xr-adjudicate__state-btn {
  padding: 4px 10px; border-radius: 999px; font-size: 12px; cursor: pointer;
  background: var(--xr-surface-2, #2e2e2e); color: inherit;
  border: 1px solid var(--xr-border, #333);
}
.xr-adjudicate__class-btn--firewalled { border-style: dashed; opacity: .85; }
.xr-adjudicate__class-btn--active, .xr-adjudicate__state-btn--active {
  border-color: var(--xr-primary, #8b5cf6);
  background: color-mix(in srgb, var(--xr-primary, #8b5cf6) 22%, transparent);
}
.xr-adjudicate__role-btn--active {
  border-color: var(--xr-warning, #fbbf24);
  background: color-mix(in srgb, var(--xr-warning, #fbbf24) 18%, transparent);
}
.xr-adjudicate__criteria, .xr-adjudicate__caveats, .xr-adjudicate__rationale {
  width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 6px;
  font: 13px/1.4 inherit; background: var(--xr-surface-2, #2e2e2e); color: inherit;
  border: 1px solid var(--xr-border, #333); resize: vertical;
}
.xr-adjudicate__horizon, .xr-adjudicate__method {
  width: 100%; box-sizing: border-box; padding: 5px 8px; border-radius: 6px; font-size: 12.5px;
  background: var(--xr-surface-2, #2e2e2e); color: inherit; border: 1px solid var(--xr-border, #333);
}
.xr-adjudicate__occurred, .xr-adjudicate__precision, .xr-adjudicate__standard {
  padding: 5px 8px; border-radius: 6px; font-size: 12.5px;
  background: var(--xr-surface-2, #2e2e2e); color: inherit; border: 1px solid var(--xr-border, #333);
}
.xr-adjudicate__firewall {
  border: 1px dashed var(--xr-warning, #fbbf24); border-radius: 8px;
  padding: 10px 12px; font-size: 12.5px; margin-bottom: 12px;
}
.xr-adjudicate__rule { border: none; border-top: 1px solid var(--xr-border, #333); margin: 14px 0; }
.xr-adjudicate__chain {
  border: 1px solid var(--xr-primary, #8b5cf6); border-radius: 8px;
  padding: 8px 12px; font-size: 12.5px; margin-bottom: 12px;
}
.xr-adjudicate__ev-add { margin-left: 8px; padding: 1px 8px; border-radius: 999px; font-size: 11px;
  cursor: pointer; background: var(--xr-surface-2, #2e2e2e); color: inherit; border: 1px solid var(--xr-border, #333); }
.xr-adjudicate__ev-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; align-items: center; }
.xr-adjudicate__ev-origin { font-size: 12px; }
.xr-adjudicate__ev-label { flex: 1 1 55%; min-width: 180px; font-size: 12px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.xr-adjudicate__ev-host { font-size: 10.5px; opacity: 0.7; }
.xr-adjudicate__ev-note { flex: 1 1 100%; padding: 4px 8px; border-radius: 6px; font-size: 12px; }
/* The hidden attribute is UA-stylesheet display:none — any author
   display rule (picker items are flex) silently defeats it, so the
   search filter "hid" rows that stayed visible. Scoped guard wins. */
.xr-adjudicate [hidden] { display: none !important; }
.xr-adjudicate__picker { margin: 6px 0 10px; padding: 8px; border: 1px solid var(--xr-border, #333);
  border-radius: 8px; }
.xr-adjudicate__picker-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.xr-adjudicate__picker-title { font-size: 12px; font-weight: 600; }
.xr-adjudicate__picker-hint { font-size: 11px; opacity: 0.75; margin-bottom: 6px; }
.xr-adjudicate__picker-close { border: none; background: none; color: inherit; cursor: pointer; }
.xr-adjudicate__picker-search { width: 100%; padding: 4px 8px; border-radius: 6px; font-size: 12px;
  margin-bottom: 6px; box-sizing: border-box; }
.xr-adjudicate__picker-list { max-height: 180px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.xr-adjudicate__picker-item { display: flex; gap: 6px; align-items: center; text-align: left;
  padding: 5px 8px; border-radius: 6px; font-size: 12px; cursor: pointer;
  background: var(--xr-surface-2, #2e2e2e); color: inherit; border: 1px solid var(--xr-border, #333); }
.xr-adjudicate__picker-item:hover { border-color: var(--xr-accent, #7c5cff); }
.xr-adjudicate__picker-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.xr-adjudicate__picker-empty { font-size: 12px; opacity: 0.8; padding: 6px; }
.xr-adjudicate__ev-quote { flex: 1; padding: 4px 8px; border-radius: 6px; font-size: 12px;
  background: var(--xr-surface-2, #2e2e2e); color: inherit; border: 1px solid var(--xr-border, #333); }
.xr-adjudicate__ev-tier { padding: 3px 6px; border-radius: 6px; font-size: 11.5px;
  background: var(--xr-surface-2, #2e2e2e); color: inherit; border: 1px solid var(--xr-border, #333); }
.xr-adjudicate__ev-del { background: none; border: 1px solid var(--xr-border, #333); border-radius: 6px;
  color: inherit; cursor: pointer; font-size: 11px; padding: 3px 6px; }
.xr-adjudicate__others-bar { margin-bottom: 12px; }
.xr-adjudicate__others { margin-top: 6px; font-size: 12px; color: var(--xr-text-dim, #9a9a9a); }
.xr-adjudicate__others-summary { margin-bottom: 4px; color: var(--xr-text, #e6e6e6); }
.xr-adjudicate__others-row { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px; padding: 1px 0; }
.xr-adjudicate__btn { padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px;
  border: 1px solid var(--xr-border, #333); background: var(--xr-surface-2, #2e2e2e); color: inherit; }
.xr-adjudicate__btn--primary { background: var(--xr-primary, #8b5cf6); border-color: var(--xr-primary, #8b5cf6); color: #fff; }
/* badge strip (claims bar / portal) */
.xr-adjudicate-badges { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
.xr-adjudicate-badge {
  display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px;
  background: var(--xr-surface-2, #2e2e2e); border: 1px solid var(--xr-border, #333);
  color: var(--xr-text, #e6e6e6);
}
.xr-adjudicate-badge--established-true { border-color: var(--xr-success, #34d399); }
.xr-adjudicate-badge--established-false { border-color: var(--xr-danger, #f87171); }
.xr-adjudicate-badge--contested { border-color: var(--xr-warning, #fbbf24); }
.xr-adjudicate-badge--firewalled { border-style: dashed; }
`;
    document.head.appendChild(style);
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

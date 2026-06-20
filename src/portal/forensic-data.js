// Portal forensic-findings data (Phase 14.4, docs/CRIMINOLOGY_DESIGN.md).
//
// Pure joins + summaries from the corpus to the findings-about-a-subject
// lens views. No DOM, no chrome.* — index.js owns the view, this owns
// the shape. Findings are NEVER averaged or scored (there is no score);
// the lenses are render modes over the same evidence-anchored records.

export const FINDING_LENSES = ['evidentiary', 'executive', 'survivor', 'editor'];

/** Findings about one subject pubkey, newest first. */
export function findingsForEntity(items, pubkey) {
    if (!pubkey) return [];
    return (items || [])
        .filter((it) => it && it.kind === 30062 && it.parsedFinding
            && it.parsedFinding.subjectPubkey === pubkey)
        .map((it) => ({
            ...it.parsedFinding,
            created_at: it.created_at || 0,
            eventId:    it.event && it.event.id,
            relayCount: (it.relays || []).length
        }))
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
}

/** Maneuver tally, most frequent first (the executive rollup). */
export function maneuverTally(findings) {
    const counts = new Map();
    for (const f of findings || []) counts.set(f.maneuver, (counts.get(f.maneuver) || 0) + 1);
    return [...counts.entries()]
        .map(([maneuver, count]) => ({ maneuver, count }))
        .sort((a, b) => b.count - a.count || String(a.maneuver).localeCompare(String(b.maneuver)));
}

/** The lead evidence quote for a finding (its first anchor's quote). */
export function leadQuote(finding) {
    const a = ((finding && finding.anchors) || [])[0];
    return (a && a.quote) || '';
}

/** Short, human label for a maneuver value (drop the `family/` prefix). */
export function maneuverShort(maneuver) {
    return String(maneuver || '').split('/').pop() || String(maneuver || '');
}

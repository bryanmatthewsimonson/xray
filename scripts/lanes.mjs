// The RESET_PLAN §8 lanes table as data — "a PR's src/ paths must fall
// in one lane or its body carries `Cross-lane: <reason>`, and a CI path
// check enforces it" (scripts/pr-body-check.mjs is that check). The
// table moves with R3's directory moves: when §8's table changes, this
// file changes in the same PR, and tests/pr-body-check.test.mjs proves
// every file under src/ lands in exactly one lane or in UNASSIGNED.
//
// How the table's cells were turned into globs (each an interpretive
// step, recorded in JOURNAL 2026-09-25):
//   - A bare module name (`crypto.js`, `claim-*.js`) is a module under
//     src/shared/ — every bare name in §8 resolves there except
//     `speakers-modal.js`, which lives in src/reader/ and is written
//     out as such. So src/reader/pdf-*.js, reader/llm-review.js and
//     reader/lens-section.js belong to `reader/**`, not to the capture
//     or llm globs their basenames also fit.
//   - `llm-jobs.js` (#374) is BOTH files #374 created: the service
//     worker's dispatch (src/background/llm-jobs.js) and the runner +
//     page client (src/shared/llm-jobs.js).
//   - "the four modals" are the four *-modal.js files in src/shared/.
//   - "every `*-publish.js`" is universal: it outranks the directory
//     and name globs of other lanes (corpus-publish.js is wire, not
//     portal's `corpus-*.js`; identity/account-publish.js is wire, not
//     `identity/**`).
//   - "the Art. 10 table" is a section of docs/CONSTITUTION.md, not a
//     path, and "the doc generators" live under tools/** — neither has
//     an entry of its own.
//
// Precedence when several lanes' globs match one path: an exact path
// beats the universal `*-publish.js` rule, which beats a name glob in
// one directory (`src/shared/claim-*.js`), which beats a directory glob
// (`src/reader/**`). Two lanes tied at the top rank is a CONFLICT — the
// test keeps that set empty.
//
// A src/ file no row names is UNASSIGNED — listed below, never guessed.
// Assigning one is the maintainer's call on the §8 table.
//
// Provenance: INTERPRETATION (2026-09-25) — an agent artifact under
// RESET_PLAN R0; the maintainer has not ruled on it.

export const LANES = Object.freeze([
    {
        lane: 'bus',
        owns: [
            'src/background/index.js',
            'src/background/llm-jobs.js',
            'src/shared/llm-jobs.js',
            'src/shared/nostr-client.js',
            'src/shared/session-articles.js',
            'src/shared/transcriber-client.js',
            'src/shared/direct-transcribe*.js',
            'src/shared/screenshot.js',
            'src/shared/companion-status.js',
        ],
    },
    {
        lane: 'capture',
        owns: [
            'src/content/**',
            'src/page/api-interceptor.js',
            'src/shared/platforms/**',
            'src/shared/content-detector.js',
            'src/shared/content-extractor.js',
            'src/shared/content-islands.js',
            'src/shared/url-import.js',
            'src/shared/url-identity.js',
            'src/shared/url-aliases.js',
            'src/shared/epub-parse.js',
            'src/shared/pdf-*.js',
            'src/shared/media-hints.js',
            'src/shared/html-snapshot.js',
            'rules/**',
        ],
    },
    {
        lane: 'identity',
        owns: [
            'src/page/nip07-bridge.js',
            'src/shared/crypto.js',
            'src/shared/signer.js',
            'src/shared/local-key-manager.js',
            'src/shared/nsecbunker-client.js',
            'src/shared/identity/**',
            'src/shared/identity-*.js',
            'src/shared/workspace-keys.js',
            'src/shared/media-key.js',
        ],
    },
    {
        lane: 'wire',
        owns: [
            'src/shared/event-builder.js',
            'src/shared/nostr-events.js',
            { glob: 'src/**/*-publish.js', every: true },
            'src/shared/truth-builders.js',
            'src/shared/audit/builders.js',
            'src/shared/audit/publish-batch.js',
            'src/shared/metadata/builders.js',
            'src/shared/publish-gate.js',
            'src/shared/confirmed-publish.js',
            'src/shared/wire-copy.js',
            'docs/NIP_DRAFT.md',
        ],
    },
    {
        lane: 'store',
        owns: [
            'src/shared/storage.js',
            'src/shared/archive-cache.js',
            'src/shared/audit/audit-cache.js',
            'src/shared/event-journal.js',
            'src/shared/backup.js',
            'src/shared/workspace-read.js',
            'src/shared/metadata/feature-flags.js',
            'src/shared/config.js',
            'src/shared/map-artifacts.js',
            'src/shared/case-bundle.js',
            'src/shared/extraction-import.js',
        ],
    },
    {
        lane: 'reader',
        owns: [
            'src/reader/**',
            'src/shared/claim-*.js',
            'src/shared/quote-grounding.js',
            'src/shared/adjudicate-modal.js',
            'src/shared/assess-modal.js',
            'src/shared/forensic-modal.js',
            'src/shared/integrity-modal.js',
            'src/shared/transcript-*.js',
            'src/shared/diarized-transcript.js',
            'src/shared/vision-*.js',
            'src/reader/speakers-modal.js',
        ],
    },
    {
        lane: 'portal',
        owns: [
            'src/portal/**',
            'src/shared/case-*.js',
            'src/shared/corpus-*.js',
            'src/shared/hypothesis-*.js',
            'src/shared/cross-case-graph.js',
            'src/shared/article-pass.js',
            'src/shared/entity-page*.js',
            'src/shared/entity-dossier.js',
            'src/shared/review-queue.js',
            'src/shared/audit/corpus-*.js',
            'src/shared/audit/known-unknowns.js',
            'src/shared/audit/cross-coverage.js',
            'src/shared/reference-resolver.js',
            'src/shared/scholar-refs.js',
            'src/shared/crossref.js',
        ],
    },
    {
        lane: 'surfaces',
        owns: [
            'src/options/**',
            'src/sidepanel/**',
            'src/network/**',
            'src/shared/network-feed.js',
            'src/shared/network-trust.js',
            'src/shared/follow-*.js',
            'src/shared/incorporation.js',
            'src/shared/entity-model.js',
            'src/shared/entity-resolution.js',
            'src/shared/entity-equivalence.js',
        ],
    },
    {
        lane: 'llm',
        owns: [
            'src/shared/llm-*.js',
            'src/shared/llm-stream.js',
            'src/shared/corpus-prompts.js',
            'src/shared/lens-*.js',
            'src/shared/jurisdiction-model.js',
            'src/shared/audit/module-prompts.js',
            'src/shared/audit/audit-prompt.js',
            'src/shared/audit/assemble.js',
            'src/shared/audit/findings-schemas.js',
            'src/shared/audit/run-orchestrator.js',
            'src/shared/provider-normalize.js',
        ],
    },
    {
        lane: 'toolchain',
        owns: [
            '.github/**',
            'scripts/**',
            'tools/**',
            'esbuild.config.mjs',
            'tests/helpers/**',
            'tests/*-guards*.test.mjs',
            'CLAUDE.md',
            'CONTRIBUTING.md',
            'docs/JOURNAL.md',
        ],
    },
]);

// Every src/ file on 2026-09-25 that no §8 row names. Set-equal with
// the tree both ways (tests/pr-body-check.test.mjs): a file that gains
// a lane leaves this list, a new unnamed file joins it or gets a lane.
// Several of these build or parse signed events outside the wire lane
// (mention-notes.js emits kind 1, entity-sync.js kinds 5 and 30078,
// entity-profile.js the kind-0 `about`), so the `Wire format:` rule does
// not fire on them — a finding for the §8 table, not a guess made here.
export const UNASSIGNED = Object.freeze([
    'src/shared/adopt-entity.js',
    'src/shared/api-hook-buffer.js',
    'src/shared/api-pattern.js',
    'src/shared/archive-draft.js',
    'src/shared/assessment-model.js',
    'src/shared/assessment-taxonomy.js',
    'src/shared/audit/article-hash.js',
    'src/shared/audit/audit-model.js',
    'src/shared/audit/beats-v1.json',
    'src/shared/audit/beats.js',
    'src/shared/audit/calibration.js',
    'src/shared/audit/display.js',
    'src/shared/audit/dossier.js',
    'src/shared/audit/findings-claims.js',
    'src/shared/audit/import.js',
    'src/shared/build-info.js',
    'src/shared/diagnostics.js',
    'src/shared/dossier-time.js',
    'src/shared/entity-feed.js',
    'src/shared/entity-field-schemas.js',
    'src/shared/entity-health.js',
    'src/shared/entity-profile.js',
    'src/shared/entity-sync.js',
    'src/shared/evidence-linker.js',
    'src/shared/forensic-corpus.js',
    'src/shared/forensic-model.js',
    'src/shared/forensic-taxonomy.js',
    'src/shared/integrity-model.js',
    'src/shared/mention-notes.js',
    'src/shared/metadata/anchor-capture.js',
    'src/shared/metadata/anchor-resolver.js',
    'src/shared/metadata/trust-graph.js',
    'src/shared/metadata/url-normalizer.js',
    'src/shared/podcast-identity.js',
    'src/shared/schema-walker.js',
    'src/shared/smoke-anchors.js',
    'src/shared/truth-adjudication-model.js',
    'src/shared/truth-attestation.js',
    'src/shared/truth-entity-record.js',
    'src/shared/truth-taxonomy.js',
    'src/shared/utils.js',
]);

// ---------------------------------------------------------------- matching

const RANK = Object.freeze({ exact: 3, every: 2, name: 1, dir: 0 });

/** `**` spans directories, `*` stays inside one path segment. */
export function globToRegExp(glob) {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*' && glob[i + 1] === '*') {
            // `**/` = zero or more whole segments; a trailing `**` = anything below.
            if (glob[i + 2] === '/') { re += '(?:[^/]+/)*'; i += 2; } else { re += '.*'; i += 1; }
        } else if (c === '*') {
            re += '[^/]*';
        } else {
            re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        }
    }
    return new RegExp(`^${re}$`);
}

function rankOf(entry) {
    if (entry.every) return RANK.every;
    if (!entry.glob.includes('*')) return RANK.exact;
    return entry.glob.includes('**') ? RANK.dir : RANK.name;
}

/** Flat, compiled view of LANES: [{ lane, glob, rank, re }]. */
export const PATTERNS = Object.freeze(LANES.flatMap(({ lane, owns }) => owns.map((o) => {
    const entry = typeof o === 'string' ? { glob: o } : o;
    return Object.freeze({ lane, glob: entry.glob, rank: rankOf(entry), re: globToRegExp(entry.glob) });
})));

/**
 * The lane that owns a repo-relative path.
 * @returns {{ lane: string|null, conflict: string[]|null, matched: string[] }}
 *   lane null + conflict null → no row names the path; lane null +
 *   conflict [a, b] → two lanes tie at the top rank (a table defect).
 */
export function laneOf(path) {
    const p = String(path).replace(/^\.\//, '');
    const hits = PATTERNS.filter((x) => x.re.test(p));
    if (!hits.length) return { lane: null, conflict: null, matched: [] };
    const top = Math.max(...hits.map((h) => h.rank));
    const lanes = [...new Set(hits.filter((h) => h.rank === top).map((h) => h.lane))];
    const matched = hits.map((h) => h.glob);
    return lanes.length === 1 ? { lane: lanes[0], conflict: null, matched } : { lane: null, conflict: lanes.sort(), matched };
}

export const isSrc = (path) => /^src\//.test(String(path));

/**
 * Lanes touched by the src/ paths of a change.
 * @param {string[]} paths repo-relative
 * @returns {{ lanes: Map<string, string[]>, unassigned: string[], conflicts: {path: string, lanes: string[]}[] }}
 */
export function srcLanes(paths) {
    const lanes = new Map();
    const unassigned = [];
    const conflicts = [];
    for (const p of paths) {
        if (!isSrc(p)) continue;
        const r = laneOf(p);
        if (r.lane) lanes.set(r.lane, [...(lanes.get(r.lane) || []), p]);
        else if (r.conflict) conflicts.push({ path: p, lanes: r.conflict });
        else unassigned.push(p);
    }
    return { lanes, unassigned, conflicts };
}

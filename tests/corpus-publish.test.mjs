// Corpus-brief publishing — Phase 23.2. The readable 30023 article and
// the structured kind-30068 CaseBrief, both prose/data only (the
// Phase-20 no-fused-score firewall must survive publication). Pure — no
// chrome, no DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
    CASE_BRIEF_KIND, CASE_BRIEF_MARKER, caseBriefDTag,
    renderCaseBriefMarkdown, buildCaseBriefArticle, buildCaseBriefEvent, parseCaseBriefEvent,
    underlyingFileKey, matchCoverageGapsToPositions
} = await import('../src/shared/corpus-publish.js');

const PUB = 'ab'.repeat(32);
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const RECORD = {
    caseId: 'entity_case1',
    promptVersion: 'corpus-v1',
    members: 2,
    grounding: { checked: 5, dropped: 1 },
    brief: {
        summary: 'Two camps disagree on the origin.',
        positions: [
            { label: 'Lab leak', core_argument: 'A research-related incident.', holders: [{ article_hash: HASH_A }] },
            { label: 'Zoonosis', core_argument: 'A natural spillover.', holders: [{ article_hash: HASH_B }] }
        ],
        cruxes: [{
            question: 'Does the genome show engineering?',
            sides: [
                { position_label: 'Lab leak', view: 'The furin site is suspicious.' },
                { position_label: 'Zoonosis', view: 'The site occurs in nature.' }
            ],
            evidence_refs: [{ article_hash: HASH_B, quote: 'No signatures of engineering were found.' }],
            what_would_resolve: 'An early-case sequence from the market.'
        }],
        load_bearing: [
            { claim_ref: null, article_hash: HASH_A, quote: 'The lab studied related coronaviruses.', why: 'Establishes capability.' }
        ],
        coverage_gaps: ['No primary lab records in the corpus.'],
        // proposals is reviewer-facing and MUST NOT publish.
        proposals: [{ kind: 'is_key', claim_id: 'c1' }]
    }
};

const MEMBER_INDEX = {
    [HASH_A]: { url: 'https://a.example/leak', title: 'The Lab-Leak Case', coord: `30023:${PUB}:aaaa1111` },
    [HASH_B]: { url: 'https://b.example/zoo', title: 'The Zoonosis Case', coord: `30023:${PUB}:bbbb2222` }
};

test('caseBriefDTag: one replaceable brief per case', () => {
    assert.equal(caseBriefDTag('entity_case1'), 'xray-brief:entity_case1');
});

test('renderCaseBriefMarkdown: prose sections, linked quotes, NO score/proposals', () => {
    const md = renderCaseBriefMarkdown(RECORD.brief,
        { caseName: 'COVID origins', scopeQuestion: 'Where did it come from?', memberCount: 2, memberIndex: MEMBER_INDEX });
    assert.ok(md.startsWith('# Case brief — COVID origins'));
    assert.ok(md.includes('## Summary'));
    assert.ok(md.includes('## Positions'));
    assert.ok(md.includes('## Cruxes of disagreement'));
    assert.ok(md.includes('## Load-bearing claims'));
    assert.ok(md.includes('## Coverage gaps'));
    // Quotes link back to their member source (kept inline — the few,
    // important citations).
    assert.ok(md.includes('[The Zoonosis Case](https://b.example/zoo)'));
    assert.ok(md.includes('> No signatures of engineering were found.'));
    // Readability: holders cite by number (not a full-title link soup),
    // and each number LINKS to its source (escaped brackets so a
    // CommonMark reader shows "[N]" with N clickable). first-appearance
    // order → Lab-Leak (HASH_A) is [1], Zoonosis (HASH_B) [2].
    assert.ok(md.includes('*Held by:* \\[[1](https://a.example/leak)\\]'), 'lab-leak holder is a linked number');
    assert.ok(md.includes('\\[[2](https://b.example/zoo)\\]'), 'zoonosis holder is a linked number');
    assert.ok(!md.includes('*Held by:* [The Lab-Leak Case]'), 'no full-title holder soup');
    // Sources appendix resolves every [N] with full link text.
    assert.ok(md.includes('## Sources'), 'has a Sources list');
    assert.ok(md.includes('1. [The Lab-Leak Case](https://a.example/leak)'), 'source 1 full link');
    assert.ok(md.includes('2. [The Zoonosis Case](https://b.example/zoo)'), 'source 2 full link');
    // Firewall: no fused numeric score, no verdict/rating language, and
    // proposals never leak into the prose.
    assert.ok(!/score|verdict|\d+\s*%|\d+\s*\/\s*100/i.test(md), 'no score/verdict/percentage');
    assert.ok(!md.includes('is_key'), 'proposals excluded from the publication');
    assert.ok(/not a ruling|does not rank or rule/i.test(md), 'states it is not a ruling');
});

test('renderCaseBriefMarkdown: missing member degrades to an unlinked quote', () => {
    const md = renderCaseBriefMarkdown(RECORD.brief, { caseName: 'X', memberIndex: {} });
    assert.ok(md.includes('> No signatures of engineering were found.'));
    // The X-Ray link is always present; what's absent is any SOURCE
    // attribution line under a quote.
    assert.ok(!md.includes('> — ['), 'no quote source links when the member index is empty');
    assert.ok(!md.includes('*Held by:*'), 'no holder links either');
});

test('renderCaseBriefMarkdown: entity index is an APPENDIX — after the substance, counts-are-not-weight caption, 0-claim rows dropped (P2/P5)', () => {
    const memberIndex = {
        [HASH_A]: { url: 'https://a.example/leak', title: 'The Lab-Leak Case', date: '2021-05-27' },
        [HASH_B]: { url: 'https://www.b.example/zoo', title: 'The Zoonosis Case' }   // no date
    };
    const entitySummary = {
        people: [
            { name: 'Anthony Fauci', claimCount: 3, sourceHashes: [HASH_A] },
            { name: 'Mentioned Only', claimCount: 0, sourceHashes: [HASH_A, HASH_B] }   // 0 claims → dropped
        ],
        orgs: [{ name: 'Wuhan Institute of Virology', claimCount: 5, sourceHashes: [HASH_A, HASH_B] }]
    };
    const md = renderCaseBriefMarkdown(RECORD.brief, { caseName: 'X', memberIndex, entitySummary });
    // Sources annotated with outlet (www. stripped) and date when present.
    assert.ok(md.includes('1. [The Lab-Leak Case](https://a.example/leak) — a.example · 2021-05-27'), 'source 1: outlet + date');
    assert.ok(md.includes('2. [The Zoonosis Case](https://www.b.example/zoo) — b.example'), 'source 2: outlet, www stripped, no date');
    // A clearly-labeled appendix AFTER the substantive sections + Sources.
    assert.ok(md.includes('## Appendix — entity index'), 'labeled as an appendix');
    assert.ok(md.indexOf('## Appendix — entity index') > md.indexOf('## Cruxes of disagreement'), 'appendix trails the substance');
    assert.ok(md.indexOf('## Appendix — entity index') > md.indexOf('## Sources'), 'appendix trails Sources');
    assert.ok(md.includes('not weight, importance, or credibility'), 'counts-are-not-weight caption');
    // People + Organizations as appendix SUBsections, each row with claim
    // count, source count, and LINKED citation refs (HASH_A → [1], HASH_B → [2]).
    assert.ok(md.includes('### People'));
    assert.ok(md.includes('- **Anthony Fauci** — 3 claims · in 1 source: \\[[1](https://a.example/leak)\\]'), 'person: count + linked ref');
    assert.ok(md.includes('### Organizations'));
    assert.ok(md.includes('- **Wuhan Institute of Virology** — 5 claims · in 2 sources: \\[[1](https://a.example/leak)\\], \\[[2](https://www.b.example/zoo)\\]'), 'org: counts + two refs');
    assert.ok(!md.includes('Mentioned Only'), '0-claim rows are dropped from the render entirely');
    // Firewall survives the new sections.
    assert.ok(!/score|verdict|\d+\s*%|\d+\s*\/\s*100/i.test(md), 'no score/verdict/percentage');
    // Absent entitySummary → no appendix; all rows 0-claim → no appendix either.
    const bare = renderCaseBriefMarkdown(RECORD.brief, { caseName: 'X', memberIndex });
    assert.ok(!bare.includes('## Appendix'), 'appendix omitted when not supplied');
    const zeros = renderCaseBriefMarkdown(RECORD.brief, { caseName: 'X', memberIndex,
        entitySummary: { people: [{ name: 'Z', claimCount: 0, sourceHashes: [HASH_A] }], orgs: [] } });
    assert.ok(!zeros.includes('## Appendix'), 'appendix omitted when every row is 0-claim');
});

test('renderCaseBriefMarkdown: self-locating provenance header (P12) — identity, relays, query pointer', () => {
    const md = renderCaseBriefMarkdown(RECORD.brief, {
        caseName: 'X', memberIndex: MEMBER_INDEX,
        provenance: { npub: 'npub1testxyz', pubkeyHex: PUB, relays: ['wss://relay.example', 'wss://two.example'] }
    });
    assert.ok(md.includes('rendered view, not the record'), 'states it is a rendered view');
    assert.ok(md.includes('interrogable artifact is the signed event graph'), 'locates authority in the event graph');
    assert.ok(md.includes('`npub1testxyz`'), 'npub (bech32)');
    assert.ok(md.includes(`hex \`${PUB}\``), 'hex pubkey');
    assert.ok(md.includes('`wss://relay.example`, `wss://two.example`'), 'relay list');
    assert.ok(md.includes(`"authors":["${PUB}"]`), 'query snippet carries the hex pubkey');
    // The header comes first — before the synthesis intro line.
    assert.ok(md.indexOf('rendered view, not the record') < md.indexOf('A synthesis of'), 'header precedes the intro');
    // The existing not-a-ruling disclaimer survives alongside it.
    assert.ok(/not a ruling|does not rank or rule/i.test(md), 'not-a-ruling disclaimer kept');
    assert.ok(!/score|verdict|\d+\s*%|\d+\s*\/\s*100/i.test(md), 'firewall survives the header');
});

test('renderCaseBriefMarkdown: unresolved provenance renders VISIBLE placeholders, never a silent omission (P6/P12)', () => {
    const md = renderCaseBriefMarkdown(RECORD.brief, {
        caseName: 'X', memberIndex: MEMBER_INDEX,
        provenance: { npub: null, pubkeyHex: null, relays: [] }
    });
    assert.ok(md.includes('[unresolved at render time — no signing identity was configured'), 'identity placeholder is visible');
    assert.ok(md.includes('[unresolved at render time — no relay list was configured'), 'relay placeholder is visible');
    assert.ok(md.includes('"authors":["<pubkey-hex>"]'), 'query snippet keeps a placeholder author');
});

test('renderCaseBriefMarkdown: no provenance header unless asked — the published article body is unchanged', () => {
    const md = renderCaseBriefMarkdown(RECORD.brief, { caseName: 'X', memberIndex: MEMBER_INDEX });
    assert.ok(!md.includes('rendered view, not the record'), 'header absent without the option');
    const ev = buildCaseBriefArticle({ record: RECORD, caseName: 'X', memberIndex: MEMBER_INDEX, userPubkey: PUB, createdAt: 1000 });
    assert.ok(!ev.content.includes('rendered view, not the record'), 'publish path does not gain the header');
});

test('renderCaseBriefMarkdown: same-hash captures render as ONE source with nested aliases + a collapse note (P4/P9)', () => {
    const memberIndex = {
        [HASH_A]: {
            url: 'https://drive.google.com/file/d/abc123def456/view', title: 'Judge decision',
            aliases: [{ url: 'https://drive.google.com/uc?export=download&id=abc123def456', title: 'Judge decision (download)' }]
        },
        [HASH_B]: { url: 'https://b.example/zoo', title: 'The Zoonosis Case', aliases: [] }
    };
    const md = renderCaseBriefMarkdown(RECORD.brief, { caseName: 'X', memberCount: 3, memberIndex });
    assert.ok(md.includes('1. [Judge decision](https://drive.google.com/file/d/abc123def456/view)'), 'one numbered entry for the artifact');
    assert.ok(md.includes('   - also captured at [Judge decision (download)]'), 'the alias nests under its canonical entry');
    assert.ok(md.includes('the same artifact, not an independent source'), 'the alias is named for what it is');
    assert.ok(!md.includes('\n3. ['), 'an alias never gets its own citation number');
    // The collapse is disclosed at the point the capture count is shown.
    assert.ok(md.includes('capture counts are not independent-source counts'), 'count line carries the collapse note');
    // No aliases → no collapse note.
    const plain = renderCaseBriefMarkdown(RECORD.brief, { caseName: 'X', memberCount: 2, memberIndex: MEMBER_INDEX });
    assert.ok(!plain.includes('capture counts are not independent-source counts'), 'no note when nothing collapsed');
});

test('underlyingFileKey: Drive view/download URLs share a key; everything else yields null', () => {
    const view = underlyingFileKey('https://drive.google.com/file/d/abc123def456/view');
    const dl = underlyingFileKey('https://drive.google.com/uc?export=download&id=abc123def456');
    assert.equal(view, 'gdrive:abc123def456');
    assert.equal(dl, view, 'view and download URLs of one Drive file share the key');
    assert.equal(underlyingFileKey('https://example.org/file/d/abc123def456/view'), null, 'not a Drive host');
    assert.equal(underlyingFileKey('https://drive.google.com/drive/folders/abc123def456'), null, 'a folder is not a file id');
    assert.equal(underlyingFileKey('not a url'), null);
    assert.equal(underlyingFileKey(''), null);
});

test('renderCaseBriefMarkdown: soft same-Drive-file hint across DIFFERENT-hash entries — a hint, never a merge (P5/P8)', () => {
    const memberIndex = {
        [HASH_A]: { url: 'https://drive.google.com/file/d/abc123def456/view', title: 'Viewer capture' },
        [HASH_B]: { url: 'https://drive.google.com/uc?export=download&id=abc123def456', title: 'Download capture' }
    };
    const md = renderCaseBriefMarkdown(RECORD.brief, { caseName: 'X', memberIndex });
    // both stay separate numbered sources (content addressing governs)…
    assert.ok(md.includes('1. [Viewer capture]'), 'entry 1 kept');
    assert.ok(md.includes('2. [Download capture]'), 'entry 2 kept');
    // …each carrying the conservative, non-authoritative cross-reference.
    assert.ok(md.includes('may share an underlying file with [2]'), 'entry 1 hints at 2');
    assert.ok(md.includes('may share an underlying file with [1]'), 'entry 2 hints at 1');
    assert.ok(md.includes('a hint only, not a sameness or independence determination'), 'explicitly non-authoritative');
});

test('matchCoverageGapsToPositions: single-label match attaches; zero or multiple label matches stay general', () => {
    const brief = {
        positions: [{ label: 'Lab leak' }, { label: 'Zoonosis' }],
        coverage_gaps: [
            'Only two sources articulate the lab-leak position, both without primary documents.',
            'No early epidemiological data in the corpus.',
            'Neither the lab leak nor the zoonosis side addresses the December serology.'
        ]
    };
    const m = matchCoverageGapsToPositions(brief);
    assert.deepEqual(m.byPosition[0], ['Only two sources articulate the lab-leak position, both without primary documents.'],
        'hyphen/case-insensitive label match attaches to Lab leak');
    assert.deepEqual(m.byPosition[1], [], 'nothing attaches to Zoonosis');
    assert.equal(m.general.length, 2, 'the no-match and both-positions gaps stay general');
    // no positions at all → everything stays general.
    const none = matchCoverageGapsToPositions({ coverage_gaps: ['anything'] });
    assert.deepEqual(none.general, ['anything']);
});

test('renderCaseBriefMarkdown: a position-specific coverage note renders ADJACENT to its position (P5/P8)', () => {
    const brief = { ...RECORD.brief, coverage_gaps: [
        'Only two sources articulate the lab-leak position, both without primary documents.',
        'No primary lab records in the corpus.'
    ] };
    const md = renderCaseBriefMarkdown(brief, { caseName: 'X', memberIndex: MEMBER_INDEX });
    const gap = 'Only two sources articulate the lab-leak position';
    const posIdx = md.indexOf('### Lab leak');
    const nextIdx = md.indexOf('### Zoonosis');
    const gapIdx = md.indexOf(gap);
    assert.ok(posIdx !== -1 && nextIdx !== -1 && gapIdx !== -1, 'all anchors present');
    assert.ok(gapIdx > posIdx && gapIdx < nextIdx, 'the note sits inside its position block');
    assert.ok(md.includes("*Coverage note (from this brief's coverage-gap findings):*"), 'labeled as an existing coverage-gap finding');
    // the general section keeps the unmatched gap and points at the moved one.
    assert.ok(md.includes('## Coverage gaps'), 'general section kept');
    assert.ok(md.includes('- No primary lab records in the corpus.'), 'unmatched gap stays in the list');
    assert.ok(md.includes('position-specific coverage note is shown beside'), 'moved note is disclosed, not silent');
});

test('renderCaseBriefMarkdown: the no-score firewall survives every new surface at once', () => {
    const memberIndex = {
        [HASH_A]: { url: 'https://drive.google.com/file/d/abc123def456/view', title: 'Judge decision',
            aliases: [{ url: 'https://drive.google.com/uc?export=download&id=abc123def456', title: 'download' }] },
        [HASH_B]: { url: 'https://b.example/zoo', title: 'The Zoonosis Case' }
    };
    const brief = { ...RECORD.brief, coverage_gaps: ['The lab leak position rests on two documents.'] };
    const md = renderCaseBriefMarkdown(brief, {
        caseName: 'X', scopeQuestion: 'Origin?', memberCount: 3, memberIndex,
        entitySummary: { people: [{ name: 'P', claimCount: 1, sourceHashes: [HASH_A] }], orgs: [] },
        provenance: { npub: 'npub1abc', pubkeyHex: PUB, relays: ['wss://r.example'] }
    });
    assert.ok(!/score|verdict|\d+\s*%|\d+\s*\/\s*100/i.test(md), 'no score/verdict/percentage anywhere');
    assert.ok(!md.includes('is_key'), 'proposals still excluded');
});

test('buildCaseBriefArticle: kind 30023, recognizer + d + member a-tags + cross-link', () => {
    const ev = buildCaseBriefArticle({ record: RECORD, caseName: 'COVID origins', memberIndex: MEMBER_INDEX, userPubkey: PUB, createdAt: 1000 });
    assert.equal(ev.kind, 30023);
    const has = (k, v) => assert.ok(ev.tags.some((t) => t[0] === k && t[1] === v), `missing ${k}=${v}`);
    has('d', 'xray-brief:entity_case1');
    has('t', CASE_BRIEF_MARKER);
    has('title', 'Case brief — COVID origins');
    // cross-link to the structured sibling by coordinate (no id chicken-egg).
    has('a', `${CASE_BRIEF_KIND}:${PUB}:xray-brief:entity_case1`);
    // member coordinate refs + content-hash refs.
    assert.ok(ev.tags.some((t) => t[0] === 'a' && t[1] === `30023:${PUB}:aaaa1111` && t[3] === 'member'));
    has('x', HASH_A); has('x', HASH_B);
    // the body is the readable markdown.
    assert.ok(ev.content.includes('## Cruxes of disagreement'));
});

test('buildCaseBriefEvent: kind 30068, structured payload, grounded disclosure, NO score field', () => {
    const ev = buildCaseBriefEvent({ record: RECORD, caseName: 'COVID origins', scopeQuestion: 'Origin?', memberIndex: MEMBER_INDEX, userPubkey: PUB, createdAt: 1000 });
    assert.equal(ev.kind, CASE_BRIEF_KIND);
    const payload = JSON.parse(ev.content);
    assert.equal(payload.summary, 'Two camps disagree on the origin.');
    assert.equal(payload.positions.length, 2);
    assert.equal(payload.cruxes.length, 1);
    assert.ok(!('proposals' in payload), 'proposals never publish');
    // Firewall: no score/verdict/rating anywhere in the structured event.
    assert.ok(!/"(score|verdict|rating|confidence)"/i.test(ev.content), 'no score-like field');
    const has = (k, v) => assert.ok(ev.tags.some((t) => t[0] === k && t[1] === v), `missing ${k}=${v}`);
    has('d', 'xray-brief:entity_case1');
    has('prompt_version', 'corpus-v1');
    has('grounded', '5:1');
    has('a', `30023:${PUB}:xray-brief:entity_case1`);   // cross-link to the readable article
});

test('parseCaseBriefEvent: round-trips the structured event', () => {
    const ev = buildCaseBriefEvent({ record: RECORD, caseName: 'COVID origins', scopeQuestion: 'Origin?', memberIndex: MEMBER_INDEX, userPubkey: PUB, createdAt: 1000 });
    const back = parseCaseBriefEvent(ev);
    assert.equal(back.caseId, 'entity_case1');
    assert.equal(back.caseName, 'COVID origins');
    assert.equal(back.scopeQuestion, 'Origin?');
    assert.equal(back.promptVersion, 'corpus-v1');
    assert.equal(back.brief.summary, 'Two camps disagree on the origin.');
    assert.equal(back.brief.load_bearing.length, 1);
    assert.deepEqual(back.grounding, { checked: 5, dropped: 1 });
    assert.deepEqual(back.memberHashes, [HASH_A, HASH_B]);
    assert.equal(back.members.length, 2, 'member coordinate refs recovered');
    // a non-30068 event is rejected.
    assert.equal(parseCaseBriefEvent({ kind: 30023, content: '{}', tags: [] }), null);
});

test('renderCaseBriefMarkdown: partial-run coverage disclosed on its face (P6/P12)', () => {
    // 9 captured, 8 analyzed, 1 failed → the intro must say so.
    const md = renderCaseBriefMarkdown(RECORD.brief, {
        caseName: 'X', memberCount: 9, memberIndex: MEMBER_INDEX,
        coverage: { analyzed: 8, failed: 1 }
    });
    assert.ok(md.includes('A synthesis of 9 captured sources.'), 'total captured count kept');
    assert.ok(md.includes('8 were analyzed for this synthesis; 1 could not be processed and is absent from the sections below'),
        'discloses analyzed-vs-total and that the rest are absent');
    // Full coverage → no note.
    const full = renderCaseBriefMarkdown(RECORD.brief, {
        caseName: 'X', memberCount: 9, memberIndex: MEMBER_INDEX, coverage: { analyzed: 9, failed: 0 }
    });
    assert.ok(!full.includes('could not be processed'), 'no partial note when all analyzed');
    // Absent coverage → unchanged header (back-compat).
    const bare = renderCaseBriefMarkdown(RECORD.brief, { caseName: 'X', memberCount: 9, memberIndex: MEMBER_INDEX });
    assert.ok(!bare.includes('could not be processed'), 'no note without a coverage arg');
    // Plural agreement for many-failed (the COVID shape: 147 / 141).
    const many = renderCaseBriefMarkdown(RECORD.brief, {
        caseName: 'X', memberCount: 147, memberIndex: MEMBER_INDEX, coverage: { analyzed: 141 }
    });
    assert.ok(many.includes('141 were analyzed for this synthesis; 6 could not be processed and are absent'),
        'derives the unanalyzed count and agrees in plural');
    // Firewall holds.
    assert.ok(!/score|verdict|\d+\s*%|\d+\s*\/\s*100/i.test(md), 'no score/verdict/percentage');
});

test('buildCaseBriefArticle: the published article carries the partial-run disclosure too', () => {
    const partialRecord = { ...RECORD, members: 9, analyzed: 8, failed: 1 };
    const ev = buildCaseBriefArticle({ record: partialRecord, caseName: 'X', memberIndex: MEMBER_INDEX, userPubkey: PUB, createdAt: 1000 });
    assert.ok(ev.content.includes('8 were analyzed for this synthesis; 1 could not be processed'),
        'publish path is honest about coverage, not just the local export');
});

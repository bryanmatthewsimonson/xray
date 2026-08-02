// Local transcription — the WIRE contract. Closes the loop the
// archive-reload-hash test taught us to close: a diarized capture goes
// publish → reconstructArticleFromEvent → republish without minting a
// second x tag (the `## Description` trap is the reason the heading is
// renamed — reconstruct cuts the bare heading and assembleArticleBody
// re-appends it only for contentType 'video', so bytes would vanish on
// a 'transcript' capture). Also pins: transcript_lang emits for the
// diarized track, extraction-method/media tags, the anchor-borne
// Media-Fragments selector on the 30040, and that NO new tag name
// appears anywhere (the claims provenance rides existing tags only).

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Stateful store — the speaker-identification wire test seeds the
// entity registry (buildArticleEvent resolves refs through Storage).
const _store = {};
globalThis.chrome = globalThis.chrome || {
    storage: {
        local: {
            get(keys, cb) {
                const out = {};
                const list = Array.isArray(keys) ? keys : (keys == null ? Object.keys(_store) : [keys]);
                for (const k of list) if (k in _store) out[k] = _store[k];
                cb(out);
            },
            set(obj, cb) { Object.assign(_store, obj); cb && cb(); },
            remove(keys, cb) { for (const k of [].concat(keys)) delete _store[k]; cb && cb(); }
        }
    }
};

const { EventBuilder } = await import('../src/shared/event-builder.js');
const { ContentExtractor } = await import('../src/shared/content-extractor.js');
const { archivedDraftIsCanonical, archivedDraftSource } = await import('../src/shared/archive-draft.js');
const { buildDiarizedBody, diarizedTrackEntry, extractionMethodFor, timeFragmentSelector } =
    await import('../src/shared/diarized-transcript.js');
const { timeRangeFromAnchor } = await import('../src/shared/claim-model.js');
const { Storage } = await import('../src/shared/storage.js');
const { installEntityStorageBridge } = await import('../src/shared/entity-model.js');

const PUBKEY = '6daa7f3b0f5a4c8e9b2d1a7c3e5f80916d4b2a8c7e1f3059d8b6a4c2e0f19375';
const WATCH = 'https://www.youtube.com/watch?v=abc123DEF45';

const CAPTURED = [
    '---',
    '**Video**: [T](https://www.youtube.com/watch?v=abc123DEF45)  ',
    '**Channel**: Chan  ',
    '**Video ID**: `abc123DEF45`',
    '---',
    '',
    '## Description',
    '',
    'Facts with 5 * 3 and [1] and _underscores_.',
    '',
    '## Tags',
    '',
    '`one` `two`'
].join('\n');

const RESULT = {
    video_id: 'abc123DEF45', title: 'T', channel: 'Chan', duration: 18, language: 'en',
    segments: [
        { start: 0, end: 4.5, speaker: 'SPEAKER_00', text: 'Hello there, welcome to the show.' },
        { start: 4.5, end: 9.25, speaker: 'SPEAKER_01', text: 'The budget doubled in 2024, no question.' },
        { start: 9.25, end: 18, speaker: 'SPEAKER_00', text: 'That is the claim we will examine.' }
    ],
    model_info: { asr_model: 'large-v3', diarization_model: 'pyannote/speaker-diarization-community-1' }
};

/** The reader's adoption, replayed article-side (adoptDiarizedTranscript
 *  lives in reader/index.js, a chrome-dependent bundle — this mirrors
 *  its article mutations exactly). */
function diarizedArticle() {
    const { markdown, transcriptMeta } = buildDiarizedBody({
        capturedMarkdown: CAPTURED, watchUrl: WATCH, result: RESULT
    });
    return {
        url: WATCH,
        title: 'T',
        byline: 'Chan',
        domain: 'youtube.com',
        siteName: 'YouTube',
        contentType: 'transcript',
        platform: 'youtube',
        media: 'video',
        markdown,
        content: ContentExtractor.markdownToHtml(markdown),
        _contentIsMarkdown: false,
        transcript_meta: transcriptMeta,
        extraction: { method: extractionMethodFor(RESULT.model_info) },
        videoMeta: { videoId: 'abc123DEF45', duration: '18', channelName: 'Chan' },
        youtube: {
            videoId: 'abc123DEF45',
            channel: { name: 'Chan', channelId: 'UCx' },
            durationSeconds: 18,
            transcripts: [diarizedTrackEntry(RESULT)]
        },
        entities: []
    };
}

/** The publish path's article build (reader/index.js publish()). */
async function publish(article) {
    const built = { ...article, content: article.markdown, _contentIsMarkdown: true };
    const ev = await EventBuilder.buildArticleEvent(built, [], PUBKEY, []);
    return { ev, x: ev.tags.find((t) => t[0] === 'x')[1] };
}

/** The reader's load-archive rule (archive-reload-hash recipe). */
async function reloadAndRepublish(ev) {
    const archived = EventBuilder.reconstructArticleFromEvent({ ...ev, id: 'e'.repeat(64) });
    const proven = await archivedDraftIsCanonical(archived);
    const draft = proven
        ? archivedDraftSource(archived)
        : ContentExtractor.htmlToMarkdown(archived.content);
    return publish({ ...archived, content: draft, markdown: draft, _contentIsMarkdown: true });
}

test('diarized capture: publish → reconstruct → republish keeps ONE x tag (the Description trap, pinned)', async () => {
    const first = await publish(diarizedArticle());
    const second = await reloadAndRepublish(first.ev);
    assert.equal(second.x, first.x, 'a relay round-trip must not fork the content address');
    // The renamed heading is WHY: the section survives reconstruction.
    assert.ok(first.ev.content.includes('## Description — YouTube'));
    assert.ok(second.ev.content.includes('## Description — YouTube'));
});

test('the counterfactual: a BARE ## Description heading on a transcript capture forks the hash', async () => {
    const a = diarizedArticle();
    a.markdown = a.markdown.replace('## Description — YouTube', '## Description');
    const first = await publish(a);
    const second = await reloadAndRepublish(first.ev);
    assert.notEqual(second.x, first.x,
        'this documents the trap the rename avoids — if it starts PASSING, reconstruct changed and the rename can be dropped');
});

test('30023 tags: diarized provenance rides EXISTING tags only', async () => {
    const { ev } = await publish(diarizedArticle());
    const tag = (name) => ev.tags.filter((t) => t[0] === name).map((t) => t.slice(1));
    assert.deepEqual(tag('content_format'), [['transcript']]);
    assert.deepEqual(tag('platform'), [['youtube']]);
    assert.deepEqual(tag('media'), [['video']], 'the Phase 22 user-declared tag mitigates the content_format drift');
    assert.ok(tag('video_id').some((v) => v[0] === 'abc123DEF45'));
    assert.deepEqual(tag('extraction-method'), [['whisperx-large-v3+pyannote-community-1']]);
    assert.deepEqual(tag('transcript_lang'), [['en:whisperx:local-diarized']],
        'the manifest emits because the diarized track carries events');
    assert.deepEqual(tag('transcript_meta'), [['diarized:3:2']]);
    // The r tag is the watch URL — the claim-side video provenance root.
    assert.equal(ev.tags.find((t) => t[0] === 'r')[1], WATCH);
    // Segment bodies never publish as tags.
    const flat = JSON.stringify(ev.tags);
    assert.ok(!flat.includes('Hello there, welcome'), 'transcript text stays in content, never in tags');
});

test('30040 claim: video URL + start/end offsets ride existing r/anchor tags', async () => {
    const anchor = [
        { type: 'TextQuoteSelector', exact: 'The budget doubled in 2024, no question.' },
        timeFragmentSelector(4.5, 9.25)
    ];
    const claim = {
        id: 'claim_1234567890abcdef',
        text: 'The budget doubled in 2024.',
        about: [], source: null, is_key: false,
        anchor,
        quote: 'The budget doubled in 2024, no question.',
        article_hash: 'a'.repeat(64),
        created: 1750000000
    };
    const ev = EventBuilder.buildClaimEvent(claim, WATCH, 'T', PUBKEY, {});
    assert.equal(ev.kind, 30040);
    assert.equal(ev.tags.find((t) => t[0] === 'r')[1], WATCH, 'video URL = the existing r tag');
    const anchorTag = ev.tags.find((t) => t[0] === 'anchor');
    assert.ok(anchorTag, 'anchor rides its existing tag');
    const parsed = JSON.parse(anchorTag[1]);
    assert.deepEqual(timeRangeFromAnchor(parsed), { startSec: 4.5, endSec: 9.25 },
        'start/end read back from the Media-Fragments selector');
    // No new tag names anywhere on the claim event.
    const names = new Set(ev.tags.map((t) => t[0]));
    for (const n of names) {
        assert.ok(['d', 'r', 'title', 'quote', 'anchor', 'x', 'captured_at', 'client', 'key'].includes(n),
            `unexpected new claim tag: ${n}`);
    }
});

test('speaker identification: label-context entity refs ride the EXISTING p/person tags and round-trip', async () => {
    // A voice-split binding: Speaker 1 AND Speaker 3 are the same
    // person. The binding is an ordinary entity ref whose mention
    // context is the label — zero new tags.
    installEntityStorageBridge();
    // A foreign-pubkey entity record: EntityModel.get synthesizes the
    // keypair from `foreign_pubkey` when no LocalKeyManager keyName
    // exists (the node-test path — no key manager here).
    await Storage.set('entities', {
        entity_jane: {
            id: 'entity_jane', name: 'Jane Doe', type: 'person',
            foreign_pubkey: 'c'.repeat(64), created: 1, updated: 1
        }
    });

    const article = diarizedArticle();
    const refs = [
        { entity_id: 'entity_jane', type: 'person', name: 'Jane Doe', context: 'Speaker 1' },
        { entity_id: 'entity_jane', type: 'person', name: 'Jane Doe', context: 'Speaker 3' }
    ];
    const built = { ...article, content: article.markdown, _contentIsMarkdown: true };
    const ev = await EventBuilder.buildArticleEvent(built, refs, PUBKEY, []);

    const pTags = ev.tags.filter((t) => t[0] === 'p' && t[1] === 'c'.repeat(64));
    assert.deepEqual(pTags.map((t) => t[3]).sort(), ['Speaker 1', 'Speaker 3'],
        'one p-tag per identified label, context = the in-body label');
    const nameTags = ev.tags.filter((t) => t[0] === 'person' && t[1] === 'Jane Doe');
    assert.deepEqual(nameTags.map((t) => t[2]).sort(), ['Speaker 1', 'Speaker 3'],
        'the human-readable pairing consumers resolve labels through');

    // Relay round-trip: the binding survives as reconstructed refs.
    const back = await EventBuilder.reconstructEntityRefsFromEvent({ ...ev, id: 'e'.repeat(64) });
    const speakerRefs = back.filter((r) => r.context === 'Speaker 1' || r.context === 'Speaker 3');
    assert.equal(speakerRefs.length, 2, 'both label bindings reconstruct');
    assert.ok(speakerRefs.every((r) => r.name === 'Jane Doe'), 'still the same person');

    await Storage.set('entities', {});
});

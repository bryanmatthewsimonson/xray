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
        capturedMarkdown: CAPTURED, mediaUrl: WATCH, platform: 'youtube', result: RESULT
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

test('a NON-YouTube diarized capture emits no transcript_lang tag (wire promise)', async () => {
    // The neutral `article.transcripts` slot is LOCAL-ONLY. If a future
    // change teaches event-builder to read it, this test fails — which
    // is the point: that would be a wire-format change needing the
    // ecosystem-pm callout, not a silent additive tag on a new class of
    // events.
    const EPISODE = 'https://mormonstories.org/podcast/ep-1/';
    const { markdown, transcriptMeta } = buildDiarizedBody({
        capturedMarkdown: '# Episode 1\n\nShow notes.\n',
        mediaUrl: EPISODE, platform: 'podcast', result: RESULT
    });
    const article = {
        url: EPISODE,
        title: 'Episode 1',
        byline: '',
        domain: 'mormonstories.org',
        siteName: 'Mormon Stories',
        contentType: 'transcript',
        platform: 'podcast',
        markdown,
        content: ContentExtractor.markdownToHtml(markdown),
        _contentIsMarkdown: false,
        transcript_meta: transcriptMeta,
        extraction: { method: extractionMethodFor(RESULT.model_info) },
        // The neutral slot the reader writes off YouTube.
        transcripts: [diarizedTrackEntry(RESULT)],
        entities: []
    };
    const { ev } = await publish(article);
    const names = ev.tags.map((t) => t[0]);
    assert.ok(!names.includes('transcript_lang'),
        'no transcript_lang off YouTube — the neutral slot is local-only');
    // The manifest that DOES publish is unchanged and honest.
    assert.ok(names.includes('transcript_meta'), 'transcript_meta still emits');
    assert.ok(names.includes('extraction-method'), 'extraction-method still emits');
    // And no `media` tag, because adoption never declares it off a
    // genuinely-video platform.
    assert.ok(!names.includes('media'), 'media stays user-declared off video platforms');
});

// ------------------------------------------------------------------
// Direct cloud transcription (DC.1) — the wire must NOT be able to tell
// which transport ran.
//
// This is the slice's one irreversible decision, so it is pinned at the
// wire observer as well as at the module. `model_info.provider` reaches
// diarizedHeading(), which is composed into article.markdown BEFORE the
// content hash is taken — so a transport-suffixed provider id would
// permanently fork every direct transcript's `x` content address from
// its companion-routed twin for the SAME audio, and publish an
// extraction-method token no consumer has seen.
//
// The tag documents how the text was PRODUCED, not who downloaded the
// bytes: AssemblyAI's model produced it either way.
// ------------------------------------------------------------------

const { buildDirectResult, DIRECT_ENGINE_ID, DIRECT_PROVIDER } =
    await import('../src/shared/direct-transcribe.js');

const AAI_PAYLOAD = {
    status: 'completed',
    language_code: 'en_us',
    speech_model_used: 'universal-3-5-pro',
    utterances: [{
        speaker: 'A', start: 0, end: 1500, text: 'Hello there.',
        words: [{ text: 'Hello', start: 0, end: 700 }, { text: 'there.', start: 700, end: 1500 }]
    }]
};

const COMPANION_MODEL_INFO = {
    provider: 'assemblyai',
    asr_model: 'universal-3-5-pro',
    diarization_model: 'assemblyai-native',
    device: 'cloud',
    aligned: true,
    yt_dlp_version: '2026.08.01'
};

test('a direct run and a companion run publish the same extraction-method', () => {
    const direct = buildDirectResult(AAI_PAYLOAD).model_info;
    assert.equal(extractionMethodFor(direct), extractionMethodFor(COMPANION_MODEL_INFO));
    assert.equal(extractionMethodFor(direct), 'assemblyai-universal-3-5-pro');
    // The selection id must never leak into the published token.
    assert.ok(!extractionMethodFor(direct).includes('direct'),
        'the transport is not wire-visible — see DIRECT_PROVIDER in shared/direct-transcribe.js');
    assert.equal(direct.provider, DIRECT_PROVIDER);
    assert.notEqual(direct.provider, DIRECT_ENGINE_ID);
});

test('a direct run composes byte-identical markdown to a companion run', () => {
    // The `x` content address is a hash of these bytes. If the two
    // transports ever compose different markdown for the same audio,
    // the same episode carries two different content addresses.
    const result = buildDirectResult(AAI_PAYLOAD);
    const companionTwin = { ...result, model_info: COMPANION_MODEL_INFO };
    const args = {
        capturedMarkdown: '# Episode\n\nBody.',
        mediaUrl: 'https://cdn.example.com/ep.mp3',
        platform: ''
    };
    const a = buildDiarizedBody({ ...args, result });
    const b = buildDiarizedBody({ ...args, result: companionTwin });
    assert.equal(a.markdown, b.markdown);
    assert.equal(a.heading, b.heading);
    assert.deepEqual(a.timeMap, b.timeMap);
    assert.match(a.heading, /\(AssemblyAI, diarized\)/);
});

test('the track entry records the transport locally without changing the published role', () => {
    const result = buildDirectResult(AAI_PAYLOAD);
    const direct = diarizedTrackEntry(result, { source: 'direct' });
    const companion = diarizedTrackEntry(result);
    // `role` is the reader's replace-slot key AND a published enum
    // value — one diarized track per capture, whatever the engine.
    assert.equal(direct.role, 'local-diarized');
    assert.equal(direct.role, companion.role);
    assert.equal(direct.kind, companion.kind);
    // `source` is local-only provenance; hardcoding 'companion' on a
    // companion-free run would be a small silent lie in the archive row.
    assert.equal(direct.source, 'direct');
    assert.equal(companion.source, 'companion');
});

// ------------------------------------------------------------------
// Tag-component hygiene at the EMITTER.
//
// `transcript_lang` is built by joining three values with ':' —
// `<lang>:<kind>:<role>` — and every one of them originates outside
// this codebase: the language from the transcription provider, the kind
// from the provider id, the role from a track record that a backup
// import or a network incorporation can carry in. Joined unescaped, a
// value containing ':' forges tag structure for anyone filtering on it.
//
// Found while building direct cloud transcription: the direct path
// clamps its own language at the module boundary, but that protects one
// producer. The durable fix is here, where it protects every path —
// including the companion, whose provider could return the same thing.
//
// The clamp is byte-identical for every real value, which is why this
// is a robustness fix and not a wire change.
// ------------------------------------------------------------------

test('transcript_lang components cannot forge tag structure', async () => {
    // End-to-end: prove the EMITTER routes through the clamp, not just
    // that the clamp exists.
    const built = diarizedArticle();
    built.youtube.transcripts = built.youtube.transcripts.map((t) => ({
        ...t,
        languageCode: 'en:forged:role',
        kind: 'whisperx:evil',
        role: 'local-diarized:extra'
    }));
    const ev = await EventBuilder.buildArticleEvent(built, [], PUBKEY, []);
    const rows = ev.tags.filter((t) => t[0] === 'transcript_lang').map((t) => t[1]);
    assert.equal(rows.length, 1);
    // Exactly two separators — the ones the format defines.
    assert.equal(rows[0].split(':').length, 3,
        `a component smuggled a separator into the tag: ${rows[0]}`);
    // The clamp neutralizes the SEPARATOR, not the characters — the
    // forged text survives as one inert component, which is the point.
    assert.equal(rows[0], 'en-forged-role:whisperx-evil:local-diarized-extra');
    // The attack this closes: a consumer filtering on the language
    // component must no longer match a value that only LOOKS like one.
    assert.ok(!rows[0].startsWith('en:'),
        'a forged language must not satisfy a startsWith("en:") filter');
});

test('every real transcript_lang value is emitted byte-for-byte unchanged', () => {
    // The clamp must be invisible to genuine data, or it is a wire
    // change rather than a robustness fix.
    for (const [lang, kind, role] of [
        ['en', 'whisperx', 'local-diarized'],
        ['en-US', 'asr', 'origin-asr'],
        ['pt-BR', 'human', 'translation'],
        ['zh-Hans', 'assemblyai', 'local-diarized'],
        ['en', 'deepgram', 'local-diarized']
    ]) {
        assert.equal(EventBuilder.transcriptLangValue(lang, kind, role), `${lang}:${kind}:${role}`);
    }
});

test('extractionMethodFor clamps the LOCAL branch too, not only the cloud one', () => {
    // The cloud branch has always clamped; the local branch interpolated
    // model names straight into the published token.
    const method = extractionMethodFor({
        asr_model: 'large v3:evil',
        diarization_model: 'pyannote/speaker-diarization-3.1 oops'
    });
    assert.ok(!method.includes(':'), `local branch leaked a separator: ${method}`);
    assert.ok(/^[a-z0-9._+-]+$/.test(method), `local branch not clamped: ${method}`);
    // The documented two-model form and its '+' joiner survive.
    assert.equal(
        extractionMethodFor({ asr_model: 'large-v3', diarization_model: 'pyannote/speaker-diarization-3.1' }),
        'whisperx-large-v3+pyannote-3.1');
    assert.equal(extractionMethodFor(null), 'whisperx-large-v3+pyannote');
});

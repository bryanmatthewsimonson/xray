// Archive reload must not drift the canonical article hash.
//
// THE BUG: publish -> "Load archive" -> republish minted a NEW `x` tag
// for an article nobody edited, and repeating it was EXPONENTIAL.
// Publish turndowns Readability HTML to markdown; reconstruct renders
// that markdown back to HTML; republish turndowns the RENDERING again.
// turndown is not idempotent — it escapes already-escaped characters —
// so backslashes grow n -> 2n+1 per cycle (1 -> 3 -> 7 -> 15). Each
// cycle forks the anchor every audit, claim and prediction keys to, and
// because the `d` tag is URL-derived the drifted event REPLACES the
// original at the same NIP-33 coordinate.
//
// WHY NO TEST CAUGHT IT: nothing fed reconstructArticleFromEvent's
// output back into buildArticleEvent. 1739 tests stayed green while the
// bug was live. This file closes that loop.
//
// WHY THE FIXTURES LOOK LIKE THIS: plain prose round-trips through
// htmlToMarkdown(markdownToHtml(md)) BYTE-STABLY, so a test written with
// normal sentences PASSES AGAINST THE BUG and proves nothing. Every
// fixture here carries turndown-escapable characters — `5 * 3`,
// `that_is_it`, `[1]`, a line starting `14.`. Do not "tidy" them.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = globalThis.chrome || {
    storage: { local: { get(_k, cb) { cb({}); }, set(_o, cb) { cb && cb(); }, remove(_k, cb) { cb && cb(); } } }
};

const { EventBuilder } = await import('../src/shared/event-builder.js');
const { ContentExtractor } = await import('../src/shared/content-extractor.js');
const { articleHash } = await import('../src/shared/audit/article-hash.js');
const { archivedDraftIsCanonical, archivedDraftSource } =
    await import('../src/shared/archive-draft.js');

const PUBKEY = '6daa7f3b0f5a4c8e9b2d1a7c3e5f80916d4b2a8c7e1f3059d8b6a4c2e0f19375';

// Readability-shaped body whose prose turndown WILL escape.
const ESCAPE_PRONE_HTML =
    '<div id="readability-page-1"><div>' +
    '<p>Cost is 5 * 3 (that_is_it). See [1] and 2 + 2.</p>' +
    '<p>14. Revision notes with _underscores_.</p>' +
    '</div></div>';

const backslashes = (s) => (s.match(/\\/g) || []).length;

// sha256(''). If this ever shows up as an x tag, an empty body reached
// the wire and replaced a real article at its own NIP-33 coordinate.
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** Publish an article: returns the event and its x tag. */
async function publish(article) {
    const ev = await EventBuilder.buildArticleEvent(article, [], PUBKEY);
    const x = (ev.tags.find((t) => t[0] === 'x') || [])[1];
    return { ev, x };
}

/**
 * The reader's post-fix load rule, replayed faithfully:
 * prefer the proven published body over re-deriving from the rendering.
 * (loadArchivedArticle lives in reader/index.js, a chrome.*-dependent
 * IIFE bundle with no direct test seam — this mirrors its decision.)
 */
async function reloadAndRepublish(ev) {
    const archived = EventBuilder.reconstructArticleFromEvent(ev);
    const proven = await archivedDraftIsCanonical(archived);
    // state.markdownDraft
    const draft = proven
        ? archivedDraftSource(archived)
        : ContentExtractor.htmlToMarkdown(archived.content);
    // The publish path's article build.
    return publish({ ...archived, content: draft, markdown: draft, _contentIsMarkdown: true });
}

// --- the closed loop ----------------------------------------------------------

test('THE FIX: publish -> load archive -> republish does not mint a new x tag', async () => {
    const first = await publish({
        url: 'https://example.com/a', title: 'T', content: ESCAPE_PRONE_HTML
    });
    const second = await reloadAndRepublish(first.ev);
    assert.equal(second.x, first.x, 'an unedited article must keep its content address');
});

test('THE BUG, pinned: four cycles used to mint four hashes; now they mint one', async () => {
    let cur = await publish({
        url: 'https://example.com/a', title: 'T', content: ESCAPE_PRONE_HTML
    });
    const seen = new Set([cur.x]);
    const escapes = [backslashes(cur.ev.content)];
    for (let i = 0; i < 4; i++) {
        cur = await reloadAndRepublish(cur.ev);
        seen.add(cur.x);
        escapes.push(backslashes(cur.ev.content));
    }
    assert.equal(seen.size, 1, `four reload cycles must converge on ONE x tag, got ${seen.size}`);
    assert.equal(new Set(escapes).size, 1,
        `escape count must be constant across cycles, saw ${escapes.join(' -> ')} (n -> 2n+1 is the bug)`);
});

test('the fixture is actually escape-prone — otherwise this file proves nothing', async () => {
    const { ev } = await publish({
        url: 'https://example.com/a', title: 'T', content: ESCAPE_PRONE_HTML
    });
    assert.ok(backslashes(ev.content) > 0,
        'the published body must contain turndown escapes, or the round trip is trivially stable');
});

// --- the state machine: a proven draft must survive text-neutral edits --------
//
// This is the section an earlier cut of this fix would have FAILED, and
// no acceptance test caught it. Setting the verdict at load time is not
// enough: `dirtySource` has four writers, and two of them
// (tagger onTag, onEntityTag) flip it back to 'reader' for any
// contentType outside pdf|transcript — so tagging a single entity, the
// tool's primary workflow, re-armed the bug in full (measured then:
// 3 -> 9 -> 21 -> 45 -> 93 backslashes over four cycles). Worse,
// onReaderFieldInput sets dirtySource='reader' UNCONDITIONALLY, so
// fixing a typo in the TITLE silently drifted the BODY.
//
// The fix guards the three re-derivation READERS on `draftProven`
// instead of chasing the writers. These tests pin that.

/**
 * Replay the reader's state machine faithfully. Mirrors, in order:
 * loadArchivedArticle, tagger onTag (:1357), onReaderFieldInput (:3049),
 * renderMarkdown (:3132), and the publish re-derivation (:3649).
 */
async function session(ev, actions) {
    const archived = EventBuilder.reconstructArticleFromEvent(ev);
    const st = { article: { ...archived }, dirtySource: 'reader', draftProven: false, provenDraft: null };
    const proven = await archivedDraftIsCanonical(archived);
    st.markdownDraft = proven
        ? archivedDraftSource(archived)
        : (archived.markdown || archived.content || '');
    st.htmlDraft = archived.content;
    st.draftProven = proven;
    st.provenDraft = proven ? st.markdownDraft : null;

    // reader/index.js draftIsProven()
    const isProven = () => !!st.draftProven && st.provenDraft !== null
        && st.markdownDraft === st.provenDraft;

    for (const act of actions) {
        if (act === 'tagEntity') {
            // Wraps a span in the body: text-neutral, and the span never
            // reaches the wire. dirtySource flips; the proof must not.
            st.htmlDraft = st.htmlDraft.replace('Cost', '<span class="xr-entity">Cost</span>');
            st.dirtySource = 'reader';
        } else if (act === 'editTitle') {
            st.dirtySource = 'reader';      // unconditional, every field
        } else if (act === 'markdownTab') {
            if (st.dirtySource === 'reader' && !isProven()) {
                st.markdownDraft = ContentExtractor.htmlToMarkdown(st.htmlDraft);
            }
        } else if (act === 'editBody') {
            st.dirtySource = 'reader';
            st.draftProven = false;         // the content field clears it
            st.htmlDraft = st.htmlDraft.replace('Revision', 'Amended');
        } else if (act === 'attachTranscript') {
            // applyMediaResult's HTML-canonical branch (reader/index.js
            // ~:1848): rewrites the body, then BLANKS markdownDraft and
            // sets dirtySource='reader' to force the re-derivation.
            st.htmlDraft += '<h2>Transcript</h2><p><strong>HOST:</strong> Welcome.</p>';
            st.markdownDraft = '';          // "stale — regenerated on tab entry"
            st.draftProven = false;
            st.dirtySource = 'reader';
        } else if (act === 'attachTranscriptForgettingTheFlag') {
            // The SAME mutation by a writer that does not know the flag
            // exists — the class of mistake that shipped an empty body.
            // The byte check must catch it with no cooperation.
            st.htmlDraft += '<h2>Transcript</h2><p><strong>HOST:</strong> Welcome.</p>';
            st.markdownDraft = '';
            st.dirtySource = 'reader';
        }
    }
    if (st.dirtySource === 'reader' && !isProven()) {
        st.markdownDraft = ContentExtractor.htmlToMarkdown(st.htmlDraft);
    }
    return publish({ ...st.article, content: st.markdownDraft, markdown: st.markdownDraft, _contentIsMarkdown: true });
}

test('tagging an entity after Load archive does not drift the body', async () => {
    const base = await publish({ url: 'https://example.com/a', title: 'T', content: ESCAPE_PRONE_HTML });
    const after = await session(base.ev, ['tagEntity']);
    assert.equal(after.x, base.x, 'a text-neutral span must not fork the content address');
});

test('fixing a typo in the TITLE does not drift the BODY', async () => {
    const base = await publish({ url: 'https://example.com/a', title: 'T', content: ESCAPE_PRONE_HTML });
    const after = await session(base.ev, ['editTitle']);
    assert.equal(after.x, base.x);
});

test('merely looking at the markdown tab does not drift the body', async () => {
    const base = await publish({ url: 'https://example.com/a', title: 'T', content: ESCAPE_PRONE_HTML });
    const after = await session(base.ev, ['markdownTab', 'tagEntity', 'editTitle']);
    assert.equal(after.x, base.x);
});

test('four cycles of load -> tag entity -> republish still converge on ONE x tag', async () => {
    let cur = await publish({ url: 'https://example.com/a', title: 'T', content: ESCAPE_PRONE_HTML });
    const seen = new Set([cur.x]);
    for (let i = 0; i < 4; i++) {
        cur = await session(cur.ev, ['tagEntity']);
        seen.add(cur.x);
    }
    assert.equal(seen.size, 1, `expected 1 x tag across four tag-and-republish cycles, got ${seen.size}`);
});

test('attaching a transcript after Load archive must not publish an EMPTY body', async () => {
    // The regression that nearly shipped. applyMediaResult blanks
    // markdownDraft on purpose and relies on the re-derivation the proof
    // suppresses — so the blanked draft went STRAIGHT to the wire: an
    // empty kind-30023, x tag = sha256(''), REPLACING the real article at
    // the same NIP-33 coordinate (the d tag is URL-derived and unchanged)
    // and orphaning every audit keyed to the original hash.
    const base = await publish({ url: 'https://example.com/a', title: 'T', content: ESCAPE_PRONE_HTML });
    const after = await session(base.ev, ['attachTranscript']);
    const body = after.ev.content;
    assert.ok(!/^---\n[\s\S]*?\n---\n\n?$/.test(body), 'the event must not be a metadata header alone');
    assert.notEqual(after.x, EMPTY_SHA256, 'x must never be the hash of the empty string');
    assert.ok(body.includes('HOST'), 'the transcript the user just attached must reach the wire');
    assert.ok(body.includes('Revision'), 'and the original body must survive alongside it');
    assert.notEqual(after.x, base.x, 'the body genuinely changed, so the hash SHOULD fork here');
});

test('the byte check catches a writer that blanks the draft without clearing the flag', async () => {
    // Nine places assign markdownDraft. Relying on each of them to
    // remember a flag is how the empty-body bug happened; draftIsProven()
    // also compares the bytes, so an uncooperative writer cannot lie.
    const base = await publish({ url: 'https://example.com/a', title: 'T', content: ESCAPE_PRONE_HTML });
    const after = await session(base.ev, ['attachTranscriptForgettingTheFlag']);
    assert.notEqual(after.x, EMPTY_SHA256, 'no cooperation required — the bytes changed, so the proof lapses');
    assert.ok(after.ev.content.includes('HOST'));
    assert.ok(after.ev.content.includes('Revision'));
});

test('a REAL body edit still forks the hash — that IS a different article', async () => {
    const base = await publish({ url: 'https://example.com/a', title: 'T', content: ESCAPE_PRONE_HTML });
    const after = await session(base.ev, ['editBody']);
    assert.notEqual(after.x, base.x,
        'the fix must not suppress genuine edits — only re-derivation of an unedited body');
});

// --- the proof, as a unit -----------------------------------------------------

test('a relay reconstruction carries the published body and proves it', async () => {
    const { ev, x } = await publish({
        url: 'https://example.com/a', title: 'T', content: ESCAPE_PRONE_HTML
    });
    const archived = EventBuilder.reconstructArticleFromEvent(ev);
    assert.equal(typeof archived._publishedDraft, 'string');
    assert.equal(archived._articleHash, x, 'the carried hash is the published x tag');
    assert.equal(await articleHash(archived._publishedDraft), x,
        'the carried body is the exact preimage of the carried hash');
    assert.equal(await archivedDraftIsCanonical(archived), true);
});

test('the carrier is NOT named `markdown` — that key would arm isMarkdownCanonical unproven', async () => {
    // isMarkdownCanonical(article) is `article.markdown && contentType is
    // pdf|transcript`. A relay-reconstructed pdf setting `markdown` would
    // declare a lossily-rebuilt body canonical WITHOUT proof, bypassing
    // the hash check entirely. Pin the field name.
    const { ev } = await publish({
        url: 'https://example.com/a.pdf', title: 'T',
        content: ESCAPE_PRONE_HTML, contentType: 'pdf'
    });
    const archived = EventBuilder.reconstructArticleFromEvent(ev);
    assert.equal('markdown' in archived, false,
        'reconstruct must not set `markdown` — see archive-draft.js');
});

test('a lossy reconstruction FAILS its own proof instead of republishing truncated', async () => {
    // reconstruct cuts `## Description` out of the body, and
    // assembleArticleBody only re-appends sections for contentType
    // 'video'. A PDF whose extracted text legitimately contains a
    // `## Description` heading therefore does NOT round-trip — the
    // proof must catch that rather than declare the remainder canonical.
    const { ev } = await publish({
        url: 'https://example.com/datasheet.pdf',
        title: 'ACME-9000',
        contentType: 'pdf',
        markdown: '# ACME-9000\n\n## Description\n\nDraws 5 \\* 3 W.\n\n## Ratings\n\nMax temp 85C.',
        content: '# ACME-9000\n\n## Description\n\nDraws 5 \\* 3 W.\n\n## Ratings\n\nMax temp 85C.',
        _contentIsMarkdown: true
    });
    const archived = EventBuilder.reconstructArticleFromEvent(ev);
    assert.ok(archived.description, 'the Description section was torn out of the body');
    assert.equal(await archivedDraftIsCanonical(archived), false,
        'an unprovable body must be refused, not shipped truncated');
});

test('a video round-trips: sections are re-appended, so the proof holds', async () => {
    const { ev, x } = await publish({
        url: 'https://youtube.com/watch?v=abc',
        title: 'V',
        contentType: 'video',
        content: '<p>Body with 5 * 3 and that_is_it.</p>',
        description: 'A description with [brackets] and 2 * 2.',
        transcript: 'One. Two. Three. Four. Five. Six.'
    });
    const archived = EventBuilder.reconstructArticleFromEvent(ev);
    assert.ok(archived.description && archived.transcript, 'both sections were extracted');
    assert.equal(await archivedDraftIsCanonical(archived), true,
        'assembleArticleBody re-appends them at publish, so the body reproduces');
    const again = await reloadAndRepublish(ev);
    assert.equal(again.x, x, 'and a reload+republish keeps the address');
});

// --- the landmines the proof exists to catch ----------------------------------

test('LANDMINE: a platform capture has `markdown`, but it is NOT the published body', async () => {
    // A YouTube-shaped CAPTURE row (never published): the handler's
    // markdown is the substrate, `content` is markdownToHtml of it, and
    // publish turndowns that HTML — so the row's own hash covers
    // DIFFERENT bytes than its `markdown`. A naive `archived.markdown ?
    // trust : re-derive` gate would re-mint this article's x tag and
    // orphan its audits. The proof must refuse it.
    const handlerMd = 'Body with 5 \\* 3 and that\\_is\\_it.';
    const row = {
        url: 'https://youtube.com/watch?v=abc',
        title: 'V',
        contentType: 'video',
        markdown: handlerMd,
        content: ContentExtractor.markdownToHtml(handlerMd)
    };
    // The hash the capture actually published (content=HTML -> turndown).
    const publishedHash = await articleHash(EventBuilder.assembleArticleBody(row));
    const stored = { ...row, _articleHash: publishedHash };

    assert.equal(archivedDraftSource(stored), handlerMd, 'the source is found...');
    assert.equal(await archivedDraftIsCanonical(stored), false,
        '...but refused: the handler markdown is not the preimage of the published hash');
});

test('a publish-written cache row proves and heals', async () => {
    // Our own publish path stores content=markdown=the published draft
    // and stamps _articleHash with the x tag it just shipped. That row IS
    // provable, so a cache-path reload keeps the address for free.
    const draft = 'Cost is 5 \\* 3 (that\\_is\\_it).\n\n14\\. Revision notes.';
    const row = { url: 'https://example.com/a', title: 'T', content: draft, markdown: draft };
    const x = await articleHash(EventBuilder.assembleArticleBody({ ...row, _contentIsMarkdown: true }));
    assert.equal(await archivedDraftIsCanonical({ ...row, _articleHash: x }), true);
});

test('no hash, no proof — and no draft, no proof', async () => {
    const draft = 'Body with 5 \\* 3.';
    assert.equal(await archivedDraftIsCanonical({ content: draft, markdown: draft }), false,
        'a pre-13.4 event carries no x tag to check against');
    assert.equal(await archivedDraftIsCanonical({ _articleHash: 'a'.repeat(64) }), false,
        'nothing to prove');
    assert.equal(await archivedDraftIsCanonical(null), false);
    assert.equal(archivedDraftSource(null), null);
    assert.equal(archivedDraftSource({ markdown: '' }), null, 'an empty body is not a draft');
});

test('a wrong hash is refused — the proof is a real check, not a shape test', async () => {
    const draft = 'Cost is 5 \\* 3.';
    assert.equal(await archivedDraftIsCanonical({
        content: draft, markdown: draft, _articleHash: 'f'.repeat(64)
    }), false);
});

test('a STALE _publishedDraft must not shadow a newer markdown when the proof fails', async () => {
    // archivedDraftSource prefers _publishedDraft over markdown. If a row
    // carries a _publishedDraft left over from an OLDER publish while
    // `markdown` holds the current body, seeding the draft from the
    // carried value unconditionally would silently REVERT the article.
    // The seed is gated on `proven` precisely so this cannot happen: the
    // stale pair fails its own proof, and the unproven path falls back to
    // `markdown` — exactly the pre-existing behavior.
    const current = 'The CURRENT body, with 5 \\* 3.';
    const stale   = 'An OLD body, with 5 \\* 3.';
    const row = {
        url: 'https://example.com/a',
        title: 'T',
        markdown: current,
        content: current,
        _publishedDraft: stale,
        _articleHash: await articleHash(
            EventBuilder.assembleArticleBody({ content: current, _contentIsMarkdown: true }))
    };
    assert.equal(archivedDraftSource(row), stale, 'the carried draft is what would be preferred...');
    assert.equal(await archivedDraftIsCanonical(row), false,
        '...but the stale pair cannot prove itself, so the reader falls back to `markdown`');
});

test('archivedDraftSource never reads textContent — the two load paths disagree on it', async () => {
    // A relay reconstruction puts MARKDOWN in textContent; a fresh
    // capture puts TAG-STRIPPED PLAIN TEXT in it. Reading it here would
    // feed de-tagged prose to publish as the body.
    assert.equal(archivedDraftSource({ textContent: 'plain prose, tags stripped' }), null);
});

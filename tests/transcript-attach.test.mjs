// Transcript attach — Phase 22. The reader's URL-first flow: a
// transcript attaches to an EXISTING capture (upsertTranscriptSection
// on the canonical side), the body hash changes honestly (the archive
// prior-version snapshot is CORRECT versioning), and metadata-only
// media/podcast declarations never touch the hash (tag-side fields).
// fake-indexeddb + persisting chrome shim (the import-flow idiom).

import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('fake-indexeddb/auto');

const _store = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) { const out = {}; for (const k of Array.isArray(keys) ? keys : [keys]) if (_store.has(k)) out[k] = _store.get(k); cb(out); },
            set(obj, cb) { for (const [k, v] of Object.entries(obj)) _store.set(k, v); cb && cb(); },
            remove(keys, cb) { for (const k of Array.isArray(keys) ? keys : [keys]) _store.delete(k); cb && cb(); }
        }
    }
};

const { saveArticle, getArticle, clear: clearArchive } = await import('../src/shared/archive-cache.js');
const { EventBuilder } = await import('../src/shared/event-builder.js');
const { articleHash: canonicalArticleHash } = await import('../src/shared/audit/article-hash.js');
const { parseTranscript } = await import('../src/shared/transcript-parse.js');
const { buildTranscriptSection, upsertTranscriptSection } = await import('../src/shared/transcript-article.js');
const { ContentExtractor } = await import('../src/shared/content-extractor.js');

const SECTION_MD = '## Transcript\n\n[`0:00`](https://x/e#t=0) **Alice:** hi\n';

// ---- upsertTranscriptSection: markdown side -------------------------

test('upsert(md): appends to a body with no transcript section', () => {
    const out = upsertTranscriptSection('# Title\n\nSome prose.\n', SECTION_MD);
    assert.equal(out, '# Title\n\nSome prose.\n\n## Transcript\n\n[`0:00`](https://x/e#t=0) **Alice:** hi\n');
});

test('upsert(md): empty body becomes just the section', () => {
    assert.equal(upsertTranscriptSection('', SECTION_MD), SECTION_MD);
});

test('upsert(md): replaces an existing bare section, bounded by the next heading', () => {
    const body = '# Title\n\n## Transcript\n\nOLD LINE ONE\n\nOLD LINE TWO\n\n## Notes\n\nkeep me\n';
    const out = upsertTranscriptSection(body, SECTION_MD);
    assert.ok(!out.includes('OLD LINE'), 'old section fully replaced');
    assert.ok(out.includes('**Alice:** hi'));
    assert.ok(out.includes('## Notes\n\nkeep me'), 'following section preserved');
    // Exactly one blank line separates the new section from the next heading.
    assert.ok(out.includes('**Alice:** hi\n\n## Notes'));
});

test('upsert(md): replaces an existing section that runs to EOF', () => {
    const body = 'prose\n\n## Transcript\n\nOLD\n';
    const out = upsertTranscriptSection(body, SECTION_MD);
    assert.equal(out, 'prose\n\n' + SECTION_MD);
});

test('upsert(md): idempotent — attach twice yields ONE section', () => {
    const once = upsertTranscriptSection('prose\n', SECTION_MD);
    const twice = upsertTranscriptSection(once, SECTION_MD);
    assert.equal(twice, once);
    assert.equal((twice.match(/^## Transcript$/gm) || []).length, 1);
});

test('upsert(md): never matches YouTube\'s suffixed transcript headings', () => {
    const body = 'intro\n\n## Transcript — English (auto)\n\nYT CUE LINE\n';
    const out = upsertTranscriptSection(body, SECTION_MD);
    assert.ok(out.includes('YT CUE LINE'), 'YouTube section untouched');
    assert.ok(out.includes('## Transcript — English (auto)'));
    assert.ok(out.includes('**Alice:** hi'), 'imported section appended alongside');
});

// ---- upsertTranscriptSection: HTML side -----------------------------

const SECTION_HTML = '<h2>Transcript</h2>\n<p><strong>Alice:</strong> hi</p>';

test('upsert(html): appends after existing content', () => {
    const out = upsertTranscriptSection('<p>show notes</p>', SECTION_HTML, { isHtml: true });
    assert.ok(out.startsWith('<p>show notes</p>\n\n<h2>Transcript</h2>'));
});

test('upsert(html): replaces an existing section bounded by the next h2', () => {
    const body = '<p>notes</p>\n<h2 class="old">Transcript</h2>\n<p>OLD</p>\n<h2>Comments</h2>\n<p>keep</p>';
    const out = upsertTranscriptSection(body, SECTION_HTML, { isHtml: true });
    assert.ok(!out.includes('<p>OLD</p>'));
    assert.ok(out.includes('<strong>Alice:</strong> hi'));
    assert.ok(out.includes('<h2>Comments</h2>\n<p>keep</p>'), 'following section preserved');
});

test('upsert(html): does not match a suffixed Transcript heading', () => {
    const body = '<h2>Transcript — English (auto)</h2>\n<p>YT</p>';
    const out = upsertTranscriptSection(body, SECTION_HTML, { isHtml: true });
    assert.ok(out.includes('<p>YT</p>'), 'YouTube-style section untouched');
    assert.ok(out.includes('<strong>Alice:</strong> hi'));
});

// ---- the attach flow: hash + archive consequences -------------------

const SRT = '1\n00:00:00,000 --> 00:00:04,000\nALICE: We sequenced it.\n\n2\n00:00:04,000 --> 00:00:08,000\nBOB: I disagree.';

// The reader's hashableArticle for an ordinary (HTML-canonical) capture
// is the article as-is; assembleArticleBody turndowns the content.
const hashOf = async (article) =>
    await canonicalArticleHash(EventBuilder.assembleArticleBody(article));

function ordinaryCapture() {
    return {
        url: 'https://blog.example/episode-1',
        title: 'Episode 1',
        content: '<p>Show notes for the episode.</p>',
        contentType: 'article',
        entities: []
    };
}

test('attach: body upsert changes the canonical hash; archive snapshots the prior version', async () => {
    _store.clear();
    try { await clearArchive(); } catch (_) { /* first run */ }

    // 1. The capture lands in the archive with its pre-attach hash.
    const a = ordinaryCapture();
    a._articleHash = await hashOf(a);
    const first = await saveArticle({ article: a, source: 'capture' });
    assert.equal(first.priorVersions.length, 0);

    // 2. Attach: compose the section from a parse, upsert the RENDERED
    //    section into content (the reader's HTML-canonical branch).
    const parse = parseTranscript(SRT);
    const section = buildTranscriptSection({ turns: parse.turns, meta: { url: a.url, format: parse.format } });
    const sectionHtml = ContentExtractor.markdownToHtml(section);
    a.content = upsertTranscriptSection(a.content, sectionHtml, { isHtml: true });
    a.transcript_meta = {
        format: parse.format, turn_count: parse.turns.length,
        speaker_count: parse.speakers.length, speakers: [...parse.speakers]
    };

    const newHash = await hashOf(a);
    assert.notEqual(newHash, first.articleHash, 'the transcript is IN the hash substrate');

    // 3. Re-save with the new hash: honest versioning — the prior body
    //    is snapshotted (this is a real content change, not a false
    //    stealth-edit).
    const second = await saveArticle({ article: { ...a, _articleHash: newHash }, source: 'capture' });
    assert.equal(second.articleHash, newHash);
    assert.equal(second.priorVersions.length, 1, 'pre-transcript body snapshotted');
    assert.equal(second.article.transcript_meta.speakers.length, 2, 'local speaker list persisted');
    assert.ok(second.article.content.includes('Transcript'), 'attached body persisted');
});

test('attach: metadata-only media/podcast declarations leave the hash unchanged', async () => {
    const a = ordinaryCapture();
    const before = await hashOf(a);
    a.media = 'podcast';
    a.podcast = { show: 'The Show', feed_guid: 'ABC', episode_url: a.url };
    const after = await hashOf(a);
    assert.equal(after, before, 'media/podcast are tag-side fields — never in the body substrate');
});

test('attach: declared media + podcast fields reach the wire from an ordinary capture', async () => {
    const a = ordinaryCapture();
    a.media = 'podcast';
    a.podcast = { show: 'The Show', episode_guid: 'EG-1', episode_url: a.url };
    const PUBKEY = 'ab'.repeat(32);
    const ev = await EventBuilder.buildArticleEvent(a, [], PUBKEY, []);
    const has = (k, v) => assert.ok(ev.tags.some((t) => t[0] === k && t[1] === v), `missing ${k}=${v}`);
    has('media', 'podcast');
    has('show', 'The Show');
    has('podcast_episode_guid', 'EG-1');
    has('i', 'podcast:item:guid:EG-1');
    has('content_format', 'article');   // capture provenance unchanged
});

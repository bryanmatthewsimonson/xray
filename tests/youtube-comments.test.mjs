// YouTube comment parser tests — Phase 9 identity layer, Phase III.
//
// Fixtures model both InnerTube response shapes (legacy
// commentThreadRenderer + modern commentEntityPayload). Verifies the
// parser extracts text, stable channelId, threading (legacy), like
// counts, and dedups across continuation pages.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseComments, parseAbbrevCount } = await import('../src/shared/platforms/youtube-comments.js');
const { resolveStableId } = await import('../src/shared/identity/platform-account.js');

// ── Legacy fixture: a thread with one top comment + one reply ──────────

function legacyResponse() {
  return {
    onResponseReceivedEndpoints: [{
      reloadContinuationItemsCommand: {
        continuationItems: [
          {
            commentThreadRenderer: {
              comment: {
                commentRenderer: {
                  commentId: 'UgTOP1',
                  contentText: { runs: [{ text: 'Inflation is monetary expansion, ' }, { text: 'not rising prices.' }] },
                  authorText: { simpleText: '@monetary_mike' },
                  authorThumbnail: { thumbnails: [{ url: 'https://yt/s.jpg' }, { url: 'https://yt/l.jpg' }] },
                  authorEndpoint: {
                    browseEndpoint: { browseId: 'UCmike123' },
                    commandMetadata: { webCommandMetadata: { url: '/@monetary_mike' } }
                  },
                  publishedTimeText: { runs: [{ text: '2 years ago' }] },
                  voteCount: { simpleText: '1.2K' },
                  authorCommentBadge: { authorCommentBadgeRenderer: { icon: { iconType: 'CHECK_CIRCLE_THICK' } } }
                }
              },
              replies: {
                commentRepliesRenderer: {
                  contents: [{
                    commentRenderer: {
                      commentId: 'UgREPLY1',
                      contentText: { simpleText: 'Exactly right.' },
                      authorText: { simpleText: '@student' },
                      authorEndpoint: { browseEndpoint: { browseId: 'UCstudent' } },
                      publishedTimeText: { runs: [{ text: '1 year ago' }] }
                    }
                  }]
                }
              }
            }
          }
        ]
      }
    }]
  };
}

// ── Modern fixture: frameworkUpdates entity payloads (flat) ────────────

function modernResponse() {
  return {
    frameworkUpdates: {
      entityBatchUpdate: {
        mutations: [
          {
            payload: {
              commentEntityPayload: {
                properties: {
                  commentId: 'UgMODERN1',
                  content: { content: 'M2 reconstruction methodology is solid.' },
                  publishedTime: '3 months ago'
                },
                author: {
                  channelId: 'UCjane999',
                  displayName: '@jane_macro',
                  avatarThumbnailUrl: 'https://yt/jane.jpg',
                  isVerified: true
                },
                toolbar: { likeCountNotliked: '847', replyCount: '12' }
              }
            }
          },
          {
            // a non-comment mutation should be ignored
            payload: { someOtherEntity: { foo: 'bar' } }
          }
        ]
      }
    }
  };
}

// ── Legacy ─────────────────────────────────────────────────────────────

test('legacy: extracts top comment with concatenated runs', () => {
  const { tree, total } = parseComments([legacyResponse()]);
  assert.equal(total, 2); // top + reply
  const top = tree.find((c) => c.id === 'UgTOP1');
  assert.ok(top);
  assert.equal(top.body, 'Inflation is monetary expansion, not rising prices.');
  assert.equal(top.author.name, '@monetary_mike');
  assert.equal(top.author.handle, 'monetary_mike');
  assert.equal(top.author.channelId, 'UCmike123');
  assert.equal(top.author.profileUrl, 'https://www.youtube.com/@monetary_mike');
  assert.equal(top.author.avatarUrl, 'https://yt/l.jpg'); // largest
  assert.equal(top.author.verified, true);
  assert.equal(top.reactionCount, 1200); // "1.2K"
  assert.equal(top.dateText, '2 years ago');
  assert.equal(top.date, null);
});

test('legacy: reply is nested under its parent', () => {
  const { tree } = parseComments([legacyResponse()]);
  const top = tree.find((c) => c.id === 'UgTOP1');
  assert.equal(tree.length, 1);          // only the top comment at root
  assert.equal(top.children.length, 1);
  assert.equal(top.children[0].id, 'UgREPLY1');
  assert.equal(top.children[0].parentId, 'UgTOP1');
  assert.equal(top.children[0].author.channelId, 'UCstudent');
});

// ── Modern ───────────────────────────────────────────────────────────

test('modern: extracts entity payload comment, ignores non-comment mutations', () => {
  const { tree, total } = parseComments([modernResponse()]);
  assert.equal(total, 1);
  const c = tree[0];
  assert.equal(c.id, 'UgMODERN1');
  assert.equal(c.body, 'M2 reconstruction methodology is solid.');
  assert.equal(c.author.channelId, 'UCjane999');
  assert.equal(c.author.handle, 'jane_macro');
  assert.equal(c.author.profileUrl, 'https://www.youtube.com/channel/UCjane999');
  assert.equal(c.author.verified, true);
  assert.equal(c.reactionCount, 847);
  assert.equal(c.dateText, '3 months ago');
});

// ── Cross-cutting ──────────────────────────────────────────────────────

test('dedups the same commentId across continuation pages', () => {
  const { total } = parseComments([legacyResponse(), legacyResponse()]);
  assert.equal(total, 2); // not 4
});

test('mixed legacy + modern responses both parse', () => {
  const { tree, total } = parseComments([legacyResponse(), modernResponse()]);
  assert.equal(total, 3); // UgTOP1 + UgREPLY1 + UgMODERN1
  assert.ok(tree.find((c) => c.id === 'UgTOP1'));
  assert.ok(tree.find((c) => c.id === 'UgMODERN1'));
});

test('the channelId is what the identity layer keys on', () => {
  const { tree } = parseComments([modernResponse()]);
  // The author object feeds resolveStableId('youtube', author) in Phase II.
  assert.equal(resolveStableId('youtube', tree[0].author), 'UCjane999');
});

test('handles empty / malformed input gracefully', () => {
  assert.deepEqual(parseComments([]), { tree: [], total: 0 });
  assert.deepEqual(parseComments(null), { tree: [], total: 0 });
  assert.deepEqual(parseComments([null, {}, { foo: 1 }]), { tree: [], total: 0 });
});

test('skips a commentRenderer with no commentId', () => {
  const resp = { x: { commentRenderer: { contentText: { simpleText: 'no id' } } } };
  assert.deepEqual(parseComments([resp]), { tree: [], total: 0 });
});

test('comment with no channelId still captured (no stable identity)', () => {
  // A deleted/ghost author — body preserved, channelId null. The Phase II
  // loop will get null from resolveStableId and keep the display string.
  const resp = {
    commentThreadRenderer: {
      comment: { commentRenderer: { commentId: 'UgX', contentText: { simpleText: 'hi' }, authorText: { simpleText: 'Ghost' } } }
    }
  };
  const { tree } = parseComments([resp]);
  assert.equal(tree[0].author.channelId, null);
  assert.equal(tree[0].author.handle, ''); // "Ghost" has no @
  assert.equal(resolveStableId('youtube', tree[0].author), null);
});

// ── parseAbbrevCount ───────────────────────────────────────────────────

test('parseAbbrevCount: K/M/B + plain + commas', () => {
  assert.equal(parseAbbrevCount('1.2K'), 1200);
  assert.equal(parseAbbrevCount('3.4M'), 3400000);
  assert.equal(parseAbbrevCount('2B'), 2000000000);
  assert.equal(parseAbbrevCount('1,234'), 1234);
  assert.equal(parseAbbrevCount('5'), 5);
  assert.equal(parseAbbrevCount(42), 42);
  assert.equal(parseAbbrevCount(''), 0);
  assert.equal(parseAbbrevCount('no digits'), 0);
});

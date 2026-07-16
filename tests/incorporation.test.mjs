// incorporation.js tests — Phase 25.3 (KS §6 / NETWORK_CLIENT_DESIGN §5).
// Proposal extraction, per-class accept dispatch (claims/links →
// native models with nostr: provenance; judgments → the read-only
// store), persistent declines, the unfollow-keeps contract, the
// no-persist-on-view guard, and the publish-selector exclusions.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const _stateStore = new Map();
globalThis.chrome = {
    storage: {
        local: {
            get(keys, cb) { const o = {}; for (const k of (Array.isArray(keys) ? keys : [keys])) if (_stateStore.has(k)) o[k] = _stateStore.get(k); cb(o); },
            set(obj, cb) { for (const [k, v] of Object.entries(obj)) _stateStore.set(k, v); cb && cb(); },
            remove(keys, cb) { for (const k of (Array.isArray(keys) ? keys : [keys])) _stateStore.delete(k); cb && cb(); }
        }
    }
};

const {
    extractProposals, acceptProposal, declineProposal, declineAll,
    loadDismissals, loadIncorporated, PROPOSAL_CLASSES,
    INCORPORATED_KEY, DISMISSALS_KEY
} = await import('../src/shared/incorporation.js');
const { assembleNetworkFeed } = await import('../src/shared/network-feed.js');
const { ClaimModel } = await import('../src/shared/claim-model.js');
const { EvidenceLinker } = await import('../src/shared/evidence-linker.js');
const { FollowModel } = await import('../src/shared/follow-model.js');
const { isValidSuggestedBy } = await import('../src/shared/assessment-taxonomy.js');
const { selectLinksToPublish, selectAssessmentsToPublish } = await import('../src/shared/assessment-publish.js');

const FOLLOWED = 'f'.repeat(64);

let _id = 0;
function ev(kind, tags, over = {}) {
    _id++;
    return {
        id: String(_id).padStart(64, '0'),
        pubkey: FOLLOWED,
        kind,
        tags,
        content: '',
        created_at: 1700000000 + _id,
        ...over
    };
}

function claimEvent(text, d = `claim_${_id + 1}`) {
    return ev(30040, [['d', d], ['claim-text', text], ['r', 'https://foreign.example/a']], { content: text });
}

function feedOf(events) {
    return assembleNetworkFeed(events, { followedPubkeys: [FOLLOWED] });
}

beforeEach(() => _stateStore.clear());

// ------------------------------------------------------------------
// Pins + provenance validator
// ------------------------------------------------------------------

test('PROPOSAL_CLASSES is pinned exactly', () => {
    assert.deepEqual([...PROPOSAL_CLASSES], ['claim', 'link', 'assessment', 'verdict']);
});

test('isValidSuggestedBy accepts nostr:<64hex> and rejects malformed', () => {
    assert.equal(isValidSuggestedBy(`nostr:${FOLLOWED}`), true);
    assert.equal(isValidSuggestedBy('nostr:short'), false);
    assert.equal(isValidSuggestedBy('nostr:'), false);
    assert.equal(isValidSuggestedBy('user'), true);
    assert.equal(isValidSuggestedBy('llm:claude'), true);
});

// ------------------------------------------------------------------
// Extraction
// ------------------------------------------------------------------

test('extractProposals: incorporable kinds only, grouped per author', () => {
    const feed = feedOf([
        claimEvent('X said Y'),
        ev(30023, [['d', 'a1'], ['title', 'T'], ['r', 'https://x.example']]),   // article — not incorporable
        ev(30054, [['d', 's1'], ['a', `30040:${FOLLOWED}:c9`], ['stance', 'corroborates']])
    ]);
    const { proposals, byAuthor } = extractProposals(feed);
    assert.deepEqual(proposals.map((p) => p.class).sort(), ['assessment', 'claim']);
    assert.equal(byAuthor.length, 1);
    assert.equal(byAuthor[0].author, FOLLOWED);
    assert.equal(byAuthor[0].count, 2);
});

test('dismissed and incorporated refs are hidden', () => {
    const feed = feedOf([claimEvent('A'), claimEvent('B')]);
    const [a, b] = extractProposals(feed).proposals;
    const again = extractProposals(feed, {
        dismissals: { [a.ref]: { dismissedAt: 1 } },
        incorporated: { [b.ref]: { class: 'claim' } }
    });
    assert.equal(again.proposals.length, 0);
});

// ------------------------------------------------------------------
// Accept dispatch
// ------------------------------------------------------------------

test('accepting a claim creates a ClaimModel record with nostr: provenance', async () => {
    const feed = feedOf([claimEvent('The lab reported the result on 2020-01-05.')]);
    const [p] = extractProposals(feed).proposals;
    const result = await acceptProposal(p);
    assert.equal(result.status, 'incorporated');
    const claim = await ClaimModel.get(result.localId);
    assert.equal(claim.text, 'The lab reported the result on 2020-01-05.');
    assert.equal(claim.suggested_by, `nostr:${FOLLOWED}`);
    assert.equal(claim.source_url, 'https://foreign.example/a');
    const inc = await loadIncorporated();
    assert.equal(inc[p.ref].localId, claim.id);
});

test('accepting a link creates an EvidenceLinker record with nostr: provenance', async () => {
    const linkEv = ev(30055, [
        ['d', 'link_1'], ['relationship', 'supports'],
        ['a', `30040:${FOLLOWED}:c1`, '', 'source'],
        ['a', `30040:${FOLLOWED}:c2`, '', 'target']
    ]);
    const feed = feedOf([linkEv]);
    const [p] = extractProposals(feed).proposals;
    const result = await acceptProposal(p);
    assert.equal(result.status, 'incorporated');
    const all = await EvidenceLinker.getAll();
    const link = all[result.localId];
    assert.equal(link.relationship, 'supports');
    assert.equal(link.suggested_by, `nostr:${FOLLOWED}`);
});

test('accepting an assessment lands ONLY in incorporated_artifacts — never the native model', async () => {
    const feed = feedOf([ev(30054, [['d', 's1'], ['a', `30040:${FOLLOWED}:c9`], ['stance', '-1']])]);
    const [p] = extractProposals(feed).proposals;
    const result = await acceptProposal(p);
    assert.equal(result.status, 'incorporated');
    assert.equal(result.record.class, 'assessment');
    assert.equal(result.record.parsed.stance, -1);
    // The native assessment store is untouched.
    assert.equal(_stateStore.has('claim_assessments'), false);
});

test('accept is honest about failure (claim without a source URL)', async () => {
    const bad = ev(30040, [['d', 'c_nourl'], ['claim-text', 'No r tag']], { content: 'No r tag' });
    const feed = feedOf([bad]);
    const [p] = extractProposals(feed).proposals;
    const result = await acceptProposal(p);
    assert.equal(result.status, 'failed');
    assert.ok(result.error);
    // A failed accept records nothing.
    assert.deepEqual(await loadIncorporated(), {});
});

// ------------------------------------------------------------------
// Declines
// ------------------------------------------------------------------

test('decline persists and hides; declineAll bulk-declines one author', async () => {
    const feed = feedOf([claimEvent('A'), claimEvent('B'), claimEvent('C')]);
    const { proposals, byAuthor } = extractProposals(feed);
    await declineProposal(proposals[0]);
    let remaining = extractProposals(feed, { dismissals: await loadDismissals() });
    assert.equal(remaining.proposals.length, 2);
    const n = await declineAll(byAuthor[0].proposals);
    assert.equal(n, 2);   // the first was already declined
    remaining = extractProposals(feed, { dismissals: await loadDismissals() });
    assert.equal(remaining.proposals.length, 0);
});

// ------------------------------------------------------------------
// Contracts: unfollow-keeps + no-persist-on-view
// ------------------------------------------------------------------

test('unfollow keeps incorporated artifacts (TC §10.4)', async () => {
    await FollowModel.addFollow({ scope: 'global' }, { pubkey: FOLLOWED });
    const feed = feedOf([claimEvent('Kept after unfollow')]);
    const [p] = extractProposals(feed).proposals;
    const { localId } = await acceptProposal(p);
    await FollowModel.removeFollow({ scope: 'global' }, FOLLOWED);
    const claim = await ClaimModel.get(localId);
    assert.equal(claim.text, 'Kept after unfollow');
    assert.notEqual(await loadIncorporated(), {});
});

test('no persist-on-view: assembling + extracting writes NOTHING (KS §6/§12.3)', () => {
    const before = new Map(_stateStore);
    const feed = feedOf([claimEvent('View only'), ev(30054, [['d', 's2'], ['a', `30040:${FOLLOWED}:c1`], ['stance', 'corroborates']])]);
    extractProposals(feed);
    assert.deepEqual([..._stateStore.keys()].sort(), [...before.keys()].sort());
});

// ------------------------------------------------------------------
// Publish-selector exclusions — never republish another's work
// ------------------------------------------------------------------

test('selectLinksToPublish skips nostr:-suggested links', () => {
    const links = {
        l1: { id: 'l1', relationship: 'supports', suggested_by: `nostr:${FOLLOWED}`, source_claim_id: 'a', target_claim_id: 'b' }
    };
    assert.deepEqual(selectLinksToPublish({ links, claims: {}, canon: (x) => x }), []);
});

test('selectAssessmentsToPublish skips nostr:-suggested assessments', () => {
    const assessments = {
        a1: { id: 'a1', suggested_by: `nostr:${FOLLOWED}`, claim_ref: { coord: `30040:${FOLLOWED}:c1` } }
    };
    assert.deepEqual(selectAssessmentsToPublish({ assessments, claims: {}, canon: (x) => x }), []);
});

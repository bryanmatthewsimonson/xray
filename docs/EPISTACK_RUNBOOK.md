# Epistack submission runbook

> Operational companion to [`EPISTACK_ENTRY.md`](EPISTACK_ENTRY.md)
> (2026-07-08). Every step here is **human-owned** (browser, keys,
> judgment); Claude sessions prepared the materials and stay on-call
> for breakage fixes. Dates assume the **2026-07-19** deadline.

## Spine

| Dates | Step | Section |
|---|---|---|
| Jul 8–9 | Confirm submission-form access (zero float) | §7 |
| Jul 9–10 | Early relay probe | §1 |
| Jul 9–13 | COVID capture run continues | — |
| Jul 12–13 | Eggs bounded pass ([`EPISTACK_EGGS_WORKSHEET.md`](EPISTACK_EGGS_WORKSHEET.md)) | — |
| Jul 13–14 | SMOKE walk incl. §Phase 15 public-relay round trip | §2 |
| Jul 14 | Cut v0.7.0 | §3 |
| Jul 15 | Publish corpus; verify from a second client | §4 |
| Jul 15–16 | Second-investigator walkthrough | §5 |
| Jul 16–17 | Fill writeup TBDs; baseline appendix; page check | §6 |
| Jul 18 | Clean-clone dry run; papercuts only | §7 |
| Jul 19 | Submit | §7 |

## §1. Early relay probe (~30 min, Jul 9–10)

Front-loads the submission's riskiest unknown: whether public relays
accept and **retain** X-Ray's parameterized-replaceable kinds. (The
drafting environment could not reach relay hosts — its egress policy
blocks them — so nothing below is pre-verified; that is what this probe
is for.)

**Candidates.** The three enabled defaults (`src/shared/config.js`):
`relay.damus.io`, `nos.lol`, `relay.nostr.band`. Backups if any
rejects: `relay.snort.social`, `nostr.wine` (config, disabled —
nostr.wine is a paid relay, which may be *good* for retention), and
`relay.primal.net` / `offchain.pub` as open-relay fallbacks. Aim to end
with **3–4 accepting, independently operated relays**.

**Step 1 — NIP-11 info documents** (from any terminal):

```sh
for r in relay.damus.io nos.lol relay.nostr.band; do
    echo "=== $r ==="
    curl -s -H 'Accept: application/nostr+json' "https://$r" | jq \
        '{software, version, limitation, retention}'
done
```

Record per relay: `limitation.max_message_length` (**a full-article
30023 can be large — compare against your longest capture**),
`max_subscriptions`, any `retention` policy, whether `limitation`
declares restricted kinds or required auth. Also note any tag-count /
event-size ceilings (`max_event_tags` where declared): a link-heavy
capture now carries one `cites` tag per external link plus up to 25
`r` co-emits (see NIP_DRAFT), and those events brush tag limits first
— if a candidate relay declares a low tag cap, test step 2 with your
most link-dense capture, not a throwaway.

**Step 2 — per-kind-family write/read test.** In the extension, under
the Epistack identity, publish one throwaway representative of each
kind family and read it back: `0`, `10002`, `30023`, `30040`, `30041`,
`30054`, `30055`, `30056`, `30058`, `1985`, `30062`, `30063`, `30064`,
`30078`, `32125`, `32126`. (Flags needed: `assessmentPublishing`,
`epistemicAuditing`, `forensicPublishing`,
`truthAdjudicationPublishing`, `platformAccountPublishing` — see
`src/shared/metadata/feature-flags.js`; SMOKE §Phase 15's walk covers
the 30063/30064 path.) Watch the per-relay `OK` responses in the
publish ledger; anything other than accept = record the reason.

**Step 3 — retention re-check (next day).** Query the same events
again ~24h later. A relay that accepted but purged is a **reject** for
our purposes.

**Contingency (trigger, not plan):** if fewer than 3 candidates accept
and retain, stand up strfry on a small VPS (~half a day) as one relay
among several — self-hosting is a fallback on merits, not the story.
The entry's consumer path stays identical either way (the relay URL is
a parameter).

## §2. SMOKE walk + §Phase 15 round trip (Jul 13–14)

Run `docs/SMOKE_TEST.md` with extra weight on what changed since the
last full walk (the 0.6.0-era state). Delta since then, roughly the
CHANGELOG `[Unreleased]` block:

- **Phase 18 PDF stack (C1–C4.2)**: PDF routing incl. Google Drive,
  text-layer reconstruction, figures, tables, extraction warnings,
  archived original bytes. (§Phase 18 rows are new territory — this is
  their first human walk.)
- **Phase 16 moral lens** (off the submission's critical path; smoke
  only if time allows).
- **KS.1–KS.4**: verify-on-ingest, 32126 publish (flag), foreign
  entity adoption, network read feed.
- **Identity profiles + fresh workspace** (Settings ▸ Signing /
  Advanced) — exercised for real by §5 below.
- **Provenance train**: grounded suggest anchors, claim quote/`x`
  tags, complex-content islands.

**§Phase 15 round trip is the gate**: flip
`truthAdjudicationPublishing`, author → sign → publish → portal-render
a verdict against the probed relays under the Epistack identity. It is
simultaneously the Phase 15 acceptance walk, the public-relay
kind-acceptance confirmation, and CONTRIBUTING's smoke gate for the
release tag. Fix what surfaces (Claude on-call) before §3.

## §3. Cut v0.7.0 (Jul 14)

Per `CONTRIBUTING.md` §"Cutting a release" — the last real tag is
v0.5.1 (v0.6.0 bumped the manifest but was never tagged), so this is
the first `release.yml` run in a while:

1. `npm run version:set 0.7.0` (bumps `package.json` + `manifest.json`
   in lockstep; CI rejects a mismatch).
2. `CHANGELOG.md`: move `[Unreleased]` → a new `## [0.7.0] - 2026-07-14`
   section (the release workflow extracts this section **by that exact
   heading format** into the GitHub Release body; write it for a
   release-notes audience). Add the `[0.7.0]` compare-link definition
   at the bottom and repoint `[Unreleased]`.
3. Gate green: `npm run build && npm test && npx web-ext lint
   --self-hosted`.
4. `git commit -m "release: v0.7.0" && git tag v0.7.0 && git push &&
   git push --tags`.
5. If the run fails partway: fix, then either delete + re-tag
   (`git tag -d v0.7.0 && git push --delete origin v0.7.0`) or use the
   workflow's manual dispatch with the existing tag.

Why before publishing: the corpus is a provenance-bearing artifact —
pin it to a real tagged build (JOURNAL 2026-07-03).

## §4. Publish the corpus + independent verification (Jul 15)

0. **Pre-publish doc refresh** (a Claude session does this on
   request): `docs/NIP_DRAFT.md` gains a kind-`32125` entity↔article
   section and the kind-`1985` label-mirror grammar, and its stale
   reference-implementations paragraph (still says Phase 15
   "publish/read UI wiring deferred") is updated to the v0.7.0 truth —
   so **every kind a judge fetches under the npub resolves in the
   draft**. Wire-format doc change: additive documentation only, no
   semantics change; call it out in the PR per CLAUDE.md.
1. Under the Epistack identity, with the §1-confirmed relays enabled
   and the publish flags on, publish the full COVID + eggs graph as
   ordered batches (articles → claims → links/assessments → audits →
   verdicts; the publish ledger records per-event, per-relay results).
2. **Verify from a second, independent client** — not our code:
   - any NOSTR client, or the writeup's snippet (browser console):
     query `authors:[<hex>]` per kind, count events;
   - nostr.band search on the npub as a third view.
3. Record: per-kind counts, the npub, the final relay list →
   these fill `EPISTACK_ENTRY.md` §5.3's `TBD`s. Screenshot the portal
   case dashboard and an inspector view of one raw event.

## §5. Second-investigator walkthrough (~1–2h, Jul 15–16)

The compounding demonstration — another investigator picks up the
corpus and publishes disagreement beside it, using only shipped
features. Take a screenshot at each **[shot]**.

1. **Preserve your workspace**: Settings ▸ Advanced → download backup;
   Settings ▸ Signing → save the Epistack identity as a profile.
2. **Become investigator #2**: Start fresh workspace (Advanced);
   create a new identity (a second profile).
3. **Pull the corpus**: portal → viewer npub box → paste the Epistack
   npub → load from relays. Every event is BIP-340-verified on ingest
   **[shot: portal corpus under a foreign npub]**.
4. **Adopt a foreign entity** (side panel / entity view): adopt-on-sight
   creates the local record with its foreign-key derivation
   **[shot: adopt prompt]**.
5. **Disagree on the record**: on one of the corpus's claims, author
   the second investigator's own judgment from their key — a `30063`
   verdict on the same claim coordinate with a different outcome or
   standard if the adjudicate modal accepts the foreign claim, else a
   `30054` assessment with contrary stance (both prove the property:
   same coordinate, different author, side by side). Publish
   (flags on). **[shot: authoring]**
6. **Render the disagreement**: reload the corpus view; the two
   judgments render **side by side, never merged**
   **[shot: the side-by-side — this is the writeup's §5.4 evidence]**.
7. **Restore**: switch back to the Epistack profile; import the backup
   if anything is missing.
8. If any step fails, that is a finding, not a detour — file it; a
   Claude session fixes it; re-walk. (This is the maintainer-driven
   model doing its job.)

## §6. Fill the writeup (Jul 16–17)

- `EPISTACK_ENTRY.md` §5.3/§5.4 `TBD`s: npub, relays, kind-by-kind
  counts, corpus stats, headline findings, walkthrough evidence.
- Baseline appendix: pick one COVID sub-question; run it through
  off-the-shelf deep research; place the outputs side by side with the
  corpus's treatment of the same sub-question. Report **both
  directions** honestly (where the baseline is faster/broader; where
  the substrate is inspectable/durable/contestable).
- Export the §5 body; check ≤10 pages excluding appendices; verify no
  "calibrated" self-description survives (`grep -i calibrat` the body —
  the only permitted uses are about the *distribution* or the
  *prediction ledger's future*).

## §7. Submission (Jul 18–19)

- **Jul 8–9 (now): confirm access to the submission form** linked in
  `docs/epistack/COMPETITION.md` — the one step with zero float.
- Jul 18 **hostile-judge dry run** on a clean clone — simulate the
  judge who runs everything literally:
  1. `git clone` → `npm install && npm run build` → load unpacked →
     right-click → Open My Archive → paste the npub → load.
  2. Run the writeup's snippet from a console on `github.com` (expect
     the CSP failure — confirm the writeup's warning covers it), then
     on `example.com` (expect success).
  3. Deliberately paste the `npub1…` string where the hex pubkey
     belongs (expect the silent empty result — confirm the writeup's
     inline comment warns about it).
  4. Open the npub in one generic NOSTR client and confirm the writeup
     accurately scopes what renders there vs in the portal.
  5. Follow every §5.7 "How to check" cell literally, timing each.
  Fix papercuts only; no feature work.
- Jul 19: submit the writeup + links (repo, relays/npub, portal
  walkthrough material). Done is better than perfect; the corpus keeps
  living either way — that is the point.

## §8. Contingencies

- **YouTube transcripts (the 3 debate videos, ~5h each)** — the
  corpus's most fragile ingestion path (timedtext is PO-token-gated;
  the working path is the DOM-scrape of YouTube's "Show transcript"
  panel, which is selector-fragile). Fallback ladder, decided by
  Jul 13: (1) reactive selector-fix PR (the run's own model); (2)
  capture a published transcript of the debates as its own `30023`
  source, with provenance pointing at *that* document; (3) descope the
  videos to claim-level citations via secondary written coverage. The
  writeup names the fragility either way (entry §4.5).
- **Relay rejection/purge** — §1's probe + the strfry-on-a-VPS
  contingency (trigger: fewer than 3 candidates accept and retain).
- **Schedule pressure** — shed order for in-flight tool work:
  CD.3 first, then CD.2; CD.1 and the writeup are never dropped.

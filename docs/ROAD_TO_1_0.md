# Road to 1.0 — readiness punch list

**Status:** working plan, hand-maintained. **Date:** 2026-08-09.

Produced by a whole-tree readiness audit: the eight dev-process
disciplines in `.claude/skills/` each ran their own Protocol as a
full-tree pass, plus three lenses that have no skill yet — newcomer
UX, group research, and a consolidation census — and a synthesis pass
that deduped, resolved contradictions, and sequenced the result.

The yardstick throughout is the **1.0 audience**: non-technical
researchers, working in groups, on their own investigations. Anything
that works only because the operator already knows how it works is a
defect against that audience even where it was fine before.

Nothing here is ratified. Kills especially need the maintainer's
decision (CONSTITUTION Art. 11) before anything is removed, and
every kill is a recorded kill, git-recoverable, never a silent
deletion (Art. 3).

---

## Verdict

X-Ray is a capable instrument with a genuinely healthy core — 2513 tests
green in ~7s, verify-on-ingest on every relay read path, a guard-tested
custody rule, and two clean precedented retirements (the Phase-19 fact
layer, kind 30043) that show the project already knows how to kill
things well. It is not close to a 1.0 for non-technical groups, and the
honest blocker count is large: nineteen, of which six are data-integrity
or truth-telling defects I verified directly in the tree. Three of those
six were found by exactly one lens each and are the most serious things
in the report — the archive silently LRU-deletes captured articles past
a 500-entry cap (justified in a comment by an `unlimitedStorage`
permission manifest.json does not request) and then prunes their
archived source bytes; `mergeBackup` accrues `local_keys` — including
the `xray:user` sync key — while its own header and the confirm dialog
both promise identities are ignored; and three portal publish surfaces
discard `gatePublish`'s `confirmedOk` and stamp "Published — readable in
any NOSTR client" plus a durable `publishedAt` when zero relays
confirmed, which is the exact defect JOURNAL 2026-08-02 named by
filename and said "cannot be forgotten by the next surface." Against
those, the widely-converged findings (the token echo — 8 lenses;
DevTools-only gates — 7; the wrong flag table — 7; the missing threat
model — 8) are cheap and mechanical. The distance is not code quality;
it is that the tree has never been told the truth about itself in any
artifact a stranger reads: CHANGELOG says "Nothing yet" across 164
commits, README says v0.7.0, SMOKE_TEST says 7 bundles and 1277 tests
against 10 and 2513, and the guide's flag table documents eight switches
that gate nothing while omitting five that gate real disclosure. The
group story — the half of the mission the whole release is for — has
never been exercised by two people on two machines, ships default-off,
and its two working cross-researcher surfaces render authors as raw hex
prefixes under a variable literally named `shortNpub`. Realistically
this is three to four months of maintainer review at a sustainable pace,
and the single best thing that could happen to that estimate is
ratifying the kill list early so the documentation work in Track 7 is
written once against a smaller tree.

---

## Blockers (19)

Ordered as the synthesis ranked them. **Lenses** counts how many
independent audits converged on the same underlying defect —
convergence is signal, but the three findings below carried by a
single lens are among the most serious in the report.

| # | Blocker | Effort | Lenses |
|---|---|---|---|
| 1 | The archive silently deletes captured articles at 500 entries, then prunes their archived source bytes | M | 1 |
| 2 | Three publish surfaces report success — one writes a durable ledger stamp — when no relay confirmed | S | 3 |
| 3 | mergeBackup accrues local_keys, so a colleague's file can install their entity and sync private keys | S | 1 |
| 4 | Credential handling fails in three places: the token is echoed in cleartext, two cloud keys ride every backup, and there is no key-free export | S | 9 |
| 5 | rules/csp-strip.json removes CSP from every page on every site, and three documents call it YouTube-scoped | M | 1 |
| 6 | The NIP-07 bridge accepts a signed event back from the captured page on a sequential id with no signature or pubkey check | S | 1 |
| 7 | There is no installable, persistent, pruned way for a non-technical user to get and keep X-Ray | L | 4 |
| 8 | There is no release gate that can actually be run, and no record of what has ever been verified | L | 4 |
| 9 | The project's front door misstates what has shipped, and the release workflow will publish that silence | M | 6 |
| 10 | Three shipped features, including a wire-kind publish gate, are reachable only by hand-editing storage in DevTools | S | 7 |
| 11 | The flag registry is a third noise, and the only user-facing flag table is wrong in both directions | M | 7 |
| 12 | Publish — the one irreversible, public, permanent action — fires on a single click, and its disclosures arrive mid-flight as toasts | M | 3 |
| 13 | There is no first hour: no first-run, no in-app route to the guide, and the first instruction in three documents names a button that does not exist | L | 6 |
| 14 | The group workflow has never been exercised by two people on two machines, ships default-off, and has three unreconciled models | L | 5 |
| 15 | The group surfaces that do ship are not usable as group surfaces | L | 3 |
| 16 | The wire record does not reconcile with what the code emits, and 1.0 makes every number permanent | M | 4 |
| 17 | The follows feed silently drops what it cannot read, and shared replaceable kinds are blind-overwritten | M | 1 |
| 18 | docs/THREAT_MODEL.md does not exist | M | 8 |
| 19 | The moral lens ships a checkbox and a reader bar for a feature whose only authoring path is the browser console | S | 2 |

### B1. The archive silently deletes captured articles at 500 entries, then prunes their archived source bytes

**Effort:** M · **Converged lenses:** schema-evolution

**Why it blocks 1.0.** src/shared/archive-cache.js:47 sets
MAX_ENTRIES=500 and :330 fires evictIfNeeded() fire-and-forget on every
saveArticle; :331 then calls maybePruneSourceOrphans(), which deletes
any source_documents row no surviving article references after a
30-minute grace. The header's justification at :36 — "IndexedDB's
unlimitedStorage permission means we have headroom to be sloppy" — is
false: I read manifest.json:43-51 and the permission set is
storage/notifications/scripting/activeTab/contextMenus/sidePanel/declarativeNetRequest.
No unlimitedStorage. The corpus IS the deliverable for this audience,
and at article 501 the oldest published row is dropped with no notice,
no export, and no user action. Everything keyed to it survives as an
orphan — article-extractions (whose own header says "Nothing in the
codebase may auto-drop it"), claim quotes and offsets, case-brief
sources — and MA.7 merge-import will then refuse a collaborator's
analysis of that article with "I hold no copy of that text." Eviction
prefers published rows on the theory the relay is the backup, which
requires the event to still be on a relay AND the reconstruct path to
work — a promise no group can rely on and no user was told they were
relying on.

**Fix.** Stop unconditional eviction before the tag. Minimum: add
unlimitedStorage to manifest.json, raise or remove MAX_ENTRIES, and take
the delete pass off the saveArticle path so no capture can destroy an
earlier one. If a cap must stay, refuse to evict any row referenced by
an article-extractions record or a stored claim, surface count-vs-cap in
Options with a warning band, and require an explicit user action.
Correct or delete the false unlimitedStorage comment either way, and
journal the re-derivation.

### B2. Three publish surfaces report success — one writes a durable ledger stamp — when no relay confirmed

**Effort:** S · **Converged lenses:** architect, verification-engineer,
continuous-improvement

**Why it blocks 1.0.** src/shared/publish-gate.js:126,141 returns
{results, confirmedOk, journaled}. I verified the call sites:
src/portal/entity-page-block.js:413-427 rewrites the result as `resp =
{ok:true, results: gated.results}`, then writes publishedAt +
publishedEventId and prints "Published — readable in any NOSTR client.";
src/portal/synthesis-block.js:575-590 does the same for the case-brief
pair; src/portal/inspector.js:434-445 prints "Review requested ✓".
confirmedOk is read in exactly one file in the whole tree,
src/portal/extraction-block.js:226. (Two audits also named
entity-dossier-view.js and network/index.js — those are actually
correct: the dossier hand-derives `confirmed` at :152-156 and the follow
mirror reads pc.ok. The correct set is three.) A group researcher
publishes an entity page or case brief, is told it is readable anywhere,
and it reached no relay; the local record then says published so no
retry ever happens, collaborators see nothing, and nobody learns why.
JOURNAL 2026-08-02 named entity-page-block.js and synthesis-block.js by
filename and concluded that a single choke point returning
confirmed-or-not "is the fix that cannot be forgotten by the next
surface." It was forgotten by the next surface.

**Fix.** Read gated.confirmedOk at all three sites before any durable
stamp or success string, with a distinguishable "sent to N, none
confirmed" branch, mirroring extraction-block.js:208-237. Have
entity-dossier-view.js read confirmedOk instead of re-deriving it, so
there is exactly one definition of acceptance. Then widen the guard: for
every module importing gatePublish, assert confirmedOk appears between
the gatePublish call and any published* write or success string.

### B3. mergeBackup accrues local_keys, so a colleague's file can install their entity and sync private keys

**Effort:** S · **Converged lenses:** security-threat-modeler

**Why it blocks 1.0.** I confirmed the mechanism:
src/shared/workspace-keys.js lists 'local_keys' in
WORKSPACE_CONTENT_KEYS with the comment "per-entity keys + the xray:user
sync key"; src/shared/backup.js mergeStorage merges every key in
WORKSPACE_CONTENT, and when the local key is undefined it writes the
foreign map wholesale. Meanwhile backup.js:31-32 states "Install config
and the primary identity are NEVER touched by a merge" and
src/options/index.js:961 tells the user "the file's settings/identities
are ignored." Both are literally true about local_primary_identity and
materially false about key material. The hole opens widest for the
person most likely to be handed a file first — a new group member with
no xray:user entry yet — after which their entity-sync push
encrypts-to-self under a key the file's author also holds, and the sync
payload carries each entity's own private key. This is the 2026-06-10
keyName exfiltration class arriving through a door
case-bundle.js:171-178 was hardened against and backup.js walks past,
because the merge writes the storage map directly instead of going
through LocalKeyManager.importKey, which already refuses to overwrite
key material.

**Fix.** Add local_keys to a MERGE_EXCLUDED set (the merge's stated
purpose is corpus accrual; the case bundle is the deliberate key-sharing
artifact and is already hardened), or route every incoming entry through
LocalKeyManager.importKey so names are re-derived and conflicts throw,
with xray:user hard-reserved as never-importable. Correct the dialog
text at options/index.js:961. Add the round-trip guard: seed a foreign
backup carrying an xray:user local_keys entry, merge into a profile with
none, assert the slot stays empty.

### B4. Credential handling fails in three places: the token is echoed in cleartext, two cloud keys ride every backup, and there is no key-free export

**Effort:** S · **Converged lenses:** security-threat-modeler,
schema-evolution, group-research, product-manager, architect,
continuous-improvement, verification-engineer, newcomer-ux,
consolidation

**Why it blocks 1.0.** Three defects, one owner, one PR. (a)
src/options/index.js:1208 loads the stored companion token into a
type="text" input — I read the file; the comment stating the opposite
rule ("never the key VALUES — the DOM only ever learns whether one is
set") is on the very next line, and lines 1216-1219 obey it for
AssemblyAI and Deepgram by blanking them and showing status only.
JOURNAL 2026-08-08 records a real Hugging Face token pasted into this
field; the recorded remedy was a relabel, so the echo survived. (b)
src/shared/backup.js:67 excludes only
['xray:llm:key','workspaces','active_workspace'], so
xray:transcriber:token, :assemblyai:key and :deepgram:key are written
into every export — while options.html:283 and USER_GUIDE:218 both tell
the user the LLM key is the one exclusion, which reads as an assurance
about the class. (c) There is no export that omits key material at all,
yet JOURNAL 2026-07-25 recommends merge-import as "the
asynchronous-collaboration path," so the documented way to pool corpora
requires transmitting your signing identity. Groups screen-share
settings while helping each other set up, and they email case files.

**Fix.** (a) type="password", stop populating from storage,
presence-only status via setKeyStatus, blank-means-keep. (b) Import the
credential constants into EXCLUDED_STORAGE_KEYS rather than restating
strings, and change the guard to assert the whole class rather than one
key. (c) Add a third export — "Shareable copy (no keys)" — omitting
local_primary_identity, identity_profiles and local_keys, stamp it
content-only, make it the export the sharing docs point at, and relabel
the full backup recovery-only. Record the decision change alongside the
2026-07-10 and 2026-07-25 entries rather than silently reversing them.

### B5. rules/csp-strip.json removes CSP from every page on every site, and three documents call it YouTube-scoped

**Effort:** M · **Converged lenses:** security-threat-modeler

**Why it blocks 1.0.** I read the file: rule 1 removes
content-security-policy, -report-only, x-content-security-policy and
x-webkit-csp, and its entire condition is
{"resourceTypes":["main_frame","sub_frame"]} — no urlFilter, no
requestDomains. With <all_urls> host permissions that is every page the
researcher visits: their webmail, their bank, the target's CMS.
README.md:333, README.md:393 and CLAUDE.md:240 all describe it as scoped
to the YouTube transcript fetch, and no test pins its scope. Rule 2
(Referer/Origin for ||youtube.com/api/timedtext) is correctly narrow,
which makes rule 1's breadth look like drift rather than design. For an
audience doing adversarial research this silently disables the browser's
primary XSS defense everywhere, and it is also the single likeliest
reason a store review rejects the extension — which makes it a
prerequisite for the distribution decision, not a parallel item.

**Fix.** Re-derive empirically rather than deleting blind — the page's
connect-src can plausibly block the MAIN-world timedtext fetch, so
establish whether rule 1 is still load-bearing now that the fetch runs
via executeScript in the page's own context
(src/background/index.js:930-980). If it is, scope it with
requestDomains: ["youtube.com"] and the minimum resourceTypes. If it is
not, retire it as a recorded kill. Correct README:333/393 and
CLAUDE.md:240 in the same PR, and add the guard: any rule removing a CSP
header must carry a requestDomains or urlFilter.

### B6. The NIP-07 bridge accepts a signed event back from the captured page on a sequential id with no signature or pubkey check

**Effort:** S · **Converged lenses:** security-threat-modeler

**Why it blocks 1.0.** I read src/content/nip07-client.js: the request
id is `++reqSeq` (sequential, starts at 1, per-page) and the response
filter checks only tag, direction==='res' and id match, then resolves
data.result verbatim. Nothing recomputes the event hash, compares the
returned pubkey to the session's, or calls Crypto.verifySignature — both
of which already exist and are already used for relay ingest. The bridge
posts to '*' in the same window, so the page's own listener sees the
request frame and can answer synchronously while the real signer is
still awaiting approval. CLAUDE.md routes NIP-07 publish-signing back
through the SOURCE TAB by design — meaning the page X-Ray just judged
worth capturing adversarially is the page that gets the sign request. A
hostile page wins the race trivially and returns a well-formed event
signed with its own key, or one whose tags differ from what the operator
reviewed. The operator sees a green publish result and a corpus record
they believe carries their npub; Art. 3 makes the bad record permanent.

**Fix.** Two local changes in nip07-client.js: replace ++reqSeq with an
unguessable per-call id from crypto.getRandomValues, and validate on
receipt — recompute Crypto.getEventHash over the unsigned event
submitted, assert it equals the returned id, assert the pubkey equals
the session's resolved pubkey, and run Crypto.verifySignature. Reject
with a user-visible error, never fall back. Add a test with a stub page
that answers first.

### B7. There is no installable, persistent, pruned way for a non-technical user to get and keep X-Ray

**Effort:** L · **Converged lenses:** product-manager, automator,
verification-engineer, consolidation

**Why it blocks 1.0.** README.md:206-243 offers Developer-mode
Load-unpacked or git-clone-and-build; CONTRIBUTING.md:170-175 treats
store upload as a post-release manual step; no store link exists
anywhere in the repo. Developer mode carries a permanent Chrome nag and
is off-limits on managed machines, and a Firefox temporary add-on
unloads on every browser restart — so a non-technical Firefox user loses
X-Ray and their working context daily. The artifact itself is unpruned:
package.json webExt.ignoreFiles excludes only `companion`, so the built
zip is ~11.9 MB containing 201 tests/ entries, 83 docs/ entries
including CONSTITUTION.md and the EPISTACK competition submissions, the
full src/ tree, CLAUDE.md, package-lock.json and 18.4 MB of source maps.
Nobody has ever installed that zip and walked it; every install
instruction points at the repo root. The Options companion panel then
tells packaged-install users to `cd companion\transcriber`, a directory
the zip deliberately does not contain.

**Fix.** Decide and record the 1.0 channel before tagging: a Chrome Web
Store listing (unlisted suffices for a closed group) plus an AMO-signed
or self-hosted signed .xpi with an update_url — <all_urls> plus
csp-strip plus a document_start MAIN-world script will draw review, so
land the threat model and the csp-strip re-derivation first and write
the permission justifications from them. Extend webExt.ignoreFiles to
tests/, docs/, tools/, scripts/, esbuild.config.mjs, package-lock.json,
CLAUDE.md and _metadata, drop or relocate release source maps, and
assert packaged contents in CI. Make the companion recovery panel
conditional on whether a repo is present. If store listing is refused on
principle, say so in the README and ship a signed XPI with an explicit
developer-mode statement so the audience claim matches the delivery.

### B8. There is no release gate that can actually be run, and no record of what has ever been verified

**Effort:** L · **Converged lenses:** verification-engineer,
continuous-improvement, automator, product-manager

**Why it blocks 1.0.** CONTRIBUTING.md:151 nominates docs/SMOKE_TEST.md
as the tag gate; it is 559 manual rows across 44 sections needing two
browser profiles, a paid API key, a NIP-07 signer, the Python companion
and a paywalled article. Its own Setup block states three mutually
inconsistent stale numbers (1277, 1018, against a real 2513) and seven
bundles against ten, and it closes by conceding issue #1 is "the closest
thing X-Ray currently has to a release-blocker checklist." No walk
ledger exists anywhere, so 164 commits and 21,384 inserted lines since
v0.8.0 are unwalked on the record. The one browser harness that has ever
caught a real defect, tools/smoke/ma6-walk.mjs, hardcodes /opt container
paths and has no playwright devDependency and no npm script — and
JOURNAL 2026-07-05 had already concluded a Playwright smoke would have
caught an earlier escape. The companion's own key-hygiene tests
(test_server_keys.py asserts a provider key never reaches disk or logs)
are run by no CI job. Version lockstep is checked only in release.yml,
after an undeletable tag is pushed, while CLAUDE.md and CONTRIBUTING
both claim CI rejects a mismatch.

**Fix.** Split SMOKE_TEST into a short mandatory gate (install the built
zip in a clean profile, capture, publish, archive banner,
backup/restore, one collaboration handoff) plus an archived per-phase
appendix retained under Art. 3, and put the walk ledger at the top of
the gate — seeded honestly with the two known walks (Companion C.1-C.7
2026-08-08; MA.6 2026-08-02) and everything else visibly empty. Add
playwright as a devDependency, resolve the browser through its own
resolver with the container paths as env overrides, add npm run
smoke:walk and a CI job that loads the extension and opens all five
pages asserting zero page errors and ten bundles. Add a path-filtered
companion pytest job. Move the package.json/manifest.json equality check
into ci.yml. Derive counts from the runner instead of restating them,
and guard the bundle list against esbuild.config.mjs.

### B9. The project's front door misstates what has shipped, and the release workflow will publish that silence

**Effort:** M · **Converged lenses:** product-manager,
continuous-improvement, automator, verification-engineer, newcomer-ux,
consolidation

**Why it blocks 1.0.** CHANGELOG.md:11-13 reads "## [Unreleased]" /
"Nothing yet." across 164 commits since v0.8.0 — a period covering the
map-artifact wave, AI vision, cloud transcription engines, the
constitution and disciplines, opinion modules and store-first publish.
CONTRIBUTING.md:147-149 states the release workflow pulls that section
verbatim into the GitHub Release body, and release.yml's extraction step
falls back to a blank body by design "so the release still publishes."
README.md:19 reports v0.7.0 when v0.8.0 is tagged and both manifests say
0.8.0, and the Status section then describes the product in sixteen
internal phase references before a reader learns what to do first. For
the packaged-zip install path the GitHub Release page is literally the
first artifact a non-technical researcher meets.

**Fix.** Reconstruct [Unreleased] from git log v0.8.0..HEAD now, while
the authors are still in session, written for a release-notes audience
(JOURNAL headings are the source). Correct README's Status to the real
tag and rewrite Status/Features around user jobs — capture, structure,
judge, publish, work a case, work with others — demoting phase numbers
to ROADMAP. Fix the one phase leak in the UI (options.html:204, "Enable
the Network page (Phase 25)"). Make the awk step exit nonzero on an
empty section, and add a CI check that [Unreleased] must be non-empty
when HEAD is ahead of the newest v* tag.

### B10. Three shipped features, including a wire-kind publish gate, are reachable only by hand-editing storage in DevTools

**Effort:** S · **Converged lenses:** product-manager, architect,
continuous-improvement, ecosystem-pm, newcomer-ux, group-research,
consolidation

**Why it blocks 1.0.** The most converged finding in the whole set.
reviewCoordination (gated at src/portal/inspector.js:404 and
src/network/index.js:798), storeFirstPublish
(src/shared/publish-gate.js:102, src/reader/index.js:5514) and
extractionAnalysisPublishing (src/portal/extraction-block.js:137) are
all read in production and none has a control in
src/options/options.html. docs/USER_GUIDE.md:167-171 states the policy
plainly: "the rest are flipped in DevTools via the chrome.storage.local
key xray:flags." For the 1.0 audience DevTools-only is indistinguishable
from unshipped, except that it still costs surface, docs and review. Two
of the three are acute: extractionAnalysisPublishing gates publishing
kind 30070 whose entire safety argument is the user making an informed
whole-unit disclosure decision, and reviewCoordination is the only
shipped verb by which one group member asks another for adversarial
review — the quality core of the team design. The feature-flags module
still carries a comment promising a "show experimental flags" disclosure
"in Week 2" of Phase 9a.

**Fix.** Add all three to Options → Advanced with the
disclosure-paragraph pattern their neighbours already use —
extractionAnalysisPublishing carrying the whole-unit disclosure text
verbatim from the flag comment. storeFirstPublish is a durability
guarantee rather than a disclosure: once the gate walks it, default it
on and drop the flag. Then make the rule machine-checked: every
non-retired FLAGS_DEFAULTS key has a matching control id in options.html
or sits on an explicit DEVTOOLS_ONLY allowlist carrying a dated
rationale. Delete the Week-2 comment and state the actual policy.

### B11. The flag registry is a third noise, and the only user-facing flag table is wrong in both directions

**Effort:** M · **Converged lenses:** product-manager, architect,
continuous-improvement, ecosystem-pm, newcomer-ux, consolidation,
group-research

**Why it blocks 1.0.** I ran the comparison: exactly 20 flags are read
by an isEnabled() call anywhere in src/, and eight in FLAGS_DEFAULTS are
read by none — annotations, respondsTo, topicTrust, factchecks, ratings,
helpfulnessVoting, bridgingRanking, transitiveTrust. Three of them
default to TRUE, so they read as live guarantees. docs/USER_GUIDE.md
§2.5 documents six of the dead eight as real publish gates (a user can
follow the instructions, set factchecks:true in DevTools as told, and
nothing exists to switch on) while omitting five real flags: aiVision,
localTranscription, transcriptClaimDrafts, storeFirstPublish and
extractionAnalysisPublishing. That table is the 1.0 audience's only map
of what leaves their machine, which makes this a consent defect rather
than a typo, and it is exactly the state a group standardising a shared
setup will configure themselves against. Note precisely: the respondsTo
TAG is live at event-builder.js:261-263 — only the flag is dead.

**Fix.** Retire the eight in place with rationale (Art. 3 — names stay
in the record), regenerate the §2.5 table from FLAGS_DEFAULTS with a
"where" column distinguishing Settings from DevTools-only, and write one
flag ledger (docs/FLAG_LEDGER.md or a ROADMAP table) with a row per key:
what casework problem it serves, what would falsify it, a check date,
and today's disposition. Then two guards: every FLAGS_DEFAULTS key is
read by an isEnabled call or listed in RETIRED_FLAGS; and the
FLAGS_DEFAULTS key set equals the guide's table row set.

### B12. Publish — the one irreversible, public, permanent action — fires on a single click, and its disclosures arrive mid-flight as toasts

**Effort:** M · **Converged lenses:** newcomer-ux, consolidation,
ecosystem-pm

**Why it blocks 1.0.** src/reader/index.js:7636 wires #xr-publish
straight to publish() with no confirm. The disclosures that the user's
private judgments are also going public ("Also publishing your
judgments…", "…forensic findings…", "…adjudications…") are four-second
toasts fired inside the publish loop at :6170, :6408, :6512, :6688 —
after the events are already going out. The confirmation hierarchy is
inverted: deleting a LOCAL cached copy demands a confirm listing what
goes, what stays and the counts (:756-768), and clearing a derived cache
confirms, while publishing to the permanent public record does not.
Nothing at publish time shows which key signed what, though entity
kind-0 profiles are signed by the entity's own key rather than the
user's — and for a group, "who signed this" is the question the whole
trust model rests on. There is also no single page anywhere stating what
becomes public: the facts exist as eight separate hint paragraphs in
options.html.

**Fix.** Add a pre-flight sheet on Publish enumerating every artifact
class this click will emit, its signing identity, its relay set, and one
irrevocability line — assembled from the same selection functions the
loop already calls (selectAssessmentsToPublish, selectMirrors,
selectLinksToPublish) before the first network request. Keep the
per-class toasts as progress, not disclosure. Add one "What becomes
public" page linked from the pre-flight and from Settings, collecting
the eight scattered hints into one table of artifact class, what it
discloses, who signs it, and its revocability.

### B13. There is no first hour: no first-run, no in-app route to the guide, and the first instruction in three documents names a button that does not exist

**Effort:** L · **Converged lenses:** newcomer-ux, consolidation,
product-manager, continuous-improvement, automator, group-research

**Why it blocks 1.0.** src/background/index.js:342 registers context
menus and nothing else on install. Grepping all five surface shells for
USER_GUIDE / docs/ yields one hit — options.html:351, pointing at a CLI
directory. README.md:265, USER_GUIDE.md:111 and SMOKE_TEST.md:47 all
instruct clicking "Generate new key"; the real controls are "New
identity…" and "Generate & switch" (options.html:105, :117), and
README:309 names a "Reset" button that is actually "Restore entity
keys." README's claim that capturing without a signing method opens the
Signing tab is also untrue — capture succeeds and the failure surfaces
later at publish. The 1,234-line guide has zero images against 14
[SCREENSHOT-nn] placeholders whose own appendix prices the shoot at ~30
minutes, and it has no coverage of AI vision, the durable extraction
layer and its review queues, kind 30070, backup Import & merge (the
group data path), the opinion modules, the shared-text scan, or speaker
identification. Options opens on the Relays tab — a wss:// URL table
with read/write/enabled columns — and eight user-facing errors terminate
at "see console," one of which announces that an expensive corpus brief
is about to be lost.

**Fix.** Open Options (or a welcome view) on onInstalled
reason='install' with a first-run checklist (identity → relays →
optional flags); add a Help link in every surface header; declare
options.html the source of truth for button names and fix the three
docs, with a guard that every bolded name a doc says to click exists as
literal text in the shells. Take the 14 shots the appendix specifies
(blur the key field in 04). Fill the guide's gaps, add an Import & merge
subsection quoting the merge law verbatim from backup.js:417-430, add a
docs/README.md index over the 48 files, and add USER_GUIDE.md to
CLAUDE.md's Project-docs list — its absence there is the mechanical
cause of the drift. Default Options to Signing when no identity exists.
Give each of the eight console-terminating errors a remedy in the user's
vocabulary, and an immediate Download escape for the synthesis one.

### B14. The group workflow has never been exercised by two people on two machines, ships default-off, and has three unreconciled models

**Effort:** L · **Converged lenses:** product-manager, group-research,
consolidation, continuous-improvement, architect

**Why it blocks 1.0.** The only walkthrough that exists,
docs/EPISTACK_RUNBOOK.md §5, instructs the SAME operator to
profile-switch and impersonate a second investigator;
EPISTACK_ENTRY.md:440 still reads `TBD` for its evidence. networkPage
defaults false with the comment "the surface ships default-off while the
phase is in flight" while ROADMAP:1914 marks Phase 25 COMPLETE, and
networkPage, reviewCoordination, followListPublishing and
platformAccountPublishing each appear zero times in 8,715 lines of
JOURNAL. Meanwhile a group asking "how do we work together?" gets three
answers with different trust models: email a JSON file containing entity
private keys (sidepanel), follow npubs and accept proposals
(Network/incorporation), or docs/TEAM_CASE_DESIGN.md, whose four stacked
amendments declare sections authoritative that were never built (TC.3
accountability disclosures, TC.5 deputy escrow, case-scoped follows).
Profile-switching structurally cannot surface what groups actually hit —
relay divergence between machines, two people holding one entity key, a
follow that resolves for one and not the other.

**Fix.** Run one real two-machine, two-person walk on a live case before
tagging: A publishes claims and a verdict, B follows A's npub, pulls,
incorporates as proposals, publishes a contrary judgment, A sees it side
by side. Record the outcome in JOURNAL whatever it shows, and lift the
runbook's §5 into the new short gate before retiring the runbook. Decide
networkPage's default on that evidence — it is either the 1.0
collaboration surface (default on, documented, walked) or it is not
shipped. Pick ONE supported collaboration path (incorporation is the
only one that scales without key transfer), demote the case bundle to an
advanced key-continuity tool with a hard warning, and banner
TEAM_CASE_DESIGN.md with what shipped and what is parked.

### B15. The group surfaces that do ship are not usable as group surfaces

**Effort:** L · **Converged lenses:** group-research, ecosystem-pm,
architect

**Why it blocks 1.0.** Four concrete defects, all in the paths a real
group hits first. (1) In both ungated cross-researcher surfaces the
author renders as a raw 12-char HEX prefix —
src/reader/claim-extractor.js:977 literally names the variable
`shortNpub` while slicing hex, and sidepanel/index.js:706 does the same
— so a teammate's shared npub1… cannot be visually matched at all, not
even by prefix. Only src/network/index.js:66 does it correctly. (2)
Accepted foreign judgments are written to `incorporated_artifacts` and
no surface outside the queue's own dedup check ever reads it, so
accepting a teammate's competing verdict makes it disappear — against
NETWORK_CLIENT_DESIGN §5's promise that they render side by side. (3)
Accepted foreign claims carry a `suggested_by` stamp that nothing
renders and that publish silently filters out, so they look like yours
and then quietly never publish. (4) The collaboration bundle
deliberately uses the narrow claim orbit, and its own comment records
the consequence — the real COVID workspace, 49 member articles, exported
"an orbit of ONE entity — itself" — while capture now auto-tags the
bound case, making tag-built the default shape.

**Fix.** Extract one author-chip helper (npub + optional follow label +
hex on hover) and route both sites through it, as network/index.js
already does; add the guard that no author pubkey is rendered by slicing
hex. Render incorporated_artifacts beside native records wherever a
claim's judgments show, attributed, never averaged. Render the existing
suggested_by provenance as a badge (reuse portal/hypothesis-block.js:86)
and state the publish skip instead of filtering silently. Implement the
bundle scope selector the code comment already prescribes — narrow vs
tag∪claim union, with entity and key counts in the confirm.

### B16. The wire record does not reconcile with what the code emits, and 1.0 makes every number permanent

**Effort:** M · **Converged lenses:** ecosystem-pm, product-manager,
consolidation, architect

**Why it blocks 1.0.** Kinds 30041 (captured comments — third parties'
text republished under the capturer's key, on a number NKBIP-01 already
uses) and 30078 (entity sync) are emitted with no docs/NIP_DRAFT.md
section at all. The CONSTITUTION Art. 10 schedule omits 9803 (a number
this project defined), kind 1 mention notes and kind 5 deletion requests
— the last notable because the project ships a deletion emitter under a
constitution whose Art. 3 is exposure-never-deletion, and nothing states
its scope is the user's own 30078 blobs. Conversely 30050-30053 are
listed active with no caller anywhere in src/. The `x` tag on kind 30023
carries two incompatible meanings — own-body hash on captures,
cited-member hashes on entity pages and case briefs — and only the first
is documented, so the flagship #x join that group members' clients would
lean on hardest silently resolves the wrong objects. The 30040 NKBIP-01
collision sits in a one-line caveat marked "a pre-submission question";
its 30041 twin is recorded nowhere. After 1.0 none of this is free to
answer.

**Fix.** Do not renumber — that is breaking against already-published
events. Add NIP_DRAFT sections for 30041 and 30078; append Art. 10 rows
for 9803, kind 1 and kind 5 with a scope note on kind 5 tying it to Art.
3; amend the §x-tag section to state both meanings and the t-tag
disambiguator; record the keep-30040/30041 decision in JOURNAL with the
client-tag/required-tag disambiguation for dual implementers. Publish
the 30023 d-derivation and the metadata-header strip regex so a second
client can compute the shared coordinate and reproduce the hash.
Restructure the reference-implementations paragraph into per-kind
status: emitted / parse-only / defined-never-emitted. Then extend
tests/constitution-guards.test.mjs from its negative half to both: every
kind emitted in src/ appears in Art. 10 and has a NIP_DRAFT heading.

### B17. The follows feed silently drops what it cannot read, and shared replaceable kinds are blind-overwritten

**Effort:** M · **Converged lenses:** ecosystem-pm

**Why it blocks 1.0.** Two wire-behaviour defects that only bite in
groups. (1) src/shared/entity-feed.js parseFeedEvent returns a bare null
on any unknown kind and on any parser rejection, and network-feed.js
just continues — no counter, no surface. Parsers reject hard on unknown
enum values, which the format explicitly permits adding. Non-technical
groups will run mixed versions as members update at different times, so
the moment an additive enum lands, an older member's client silently
drops every new event of that kind. CONSTITUTION Art. 12.1 forbids
silently filtering speech for a reader who asked to see it, and a
followed teammate's events are exactly that. (2) Entity kind-0 profiles
(reader/index.js:6921, portal/entity-dossier-view.js:159) and kind-10002
relay lists (entity-sync.js:362) are built from purely local state and
published with no remote fetch or merge — while the documented group
workflow distributes one entity private key to every member, so two
collaborators publishing the same entity produce a silent
last-writer-wins race with no attribution recovery. The correct pattern
already exists in the tree: buildFollowListEvent fetches and unions
first.

**Fix.** Have parseFeedEvent distinguish unknown-kind /
known-kind-unparseable / malformed and return the reason, and surface a
per-author line beside the existing capped counter ("3 items this
version could not read") — no wire change, a rendering-honesty change.
Route entity kind-0 and kind-10002 publishing through the
read-merge-confirm shape follow-publish.js already implements: fetch the
newest remote, diff against what is about to be signed, require explicit
confirm when the remote differs from what this install last published
(publishedProfileHash is already the signal). Add the guard that any
kind 0/3/10002 publish routes through the shared merge helper.

### B18. docs/THREAT_MODEL.md does not exist

**Effort:** M · **Converged lenses:** security-threat-modeler,
architect, product-manager, continuous-improvement,
verification-engineer, newcomer-ux, consolidation, group-research

**Why it blocks 1.0.** The single most converged doc gap — eight of
eleven lenses named it independently.
.claude/skills/security-threat-modeler/SKILL.md makes it Standard 1 and
gates every network-destination PR on touching it, so a standard whose
precondition does not exist has never once fired — including for
AssemblyAI, Deepgram, LM Studio and the companion, all added this year.
JOURNAL 2026-08-04 records the gap in the maintainer's own words: "keys
in chrome.storage, MAIN-world injection on <all_urls>, CSP stripping,
and now audio + API keys to cloud providers, with no threat-model
document." Groups of non-technical researchers make trust decisions this
document is the only place to answer: is it safe to send my case file to
a colleague, what does the site I am investigating learn about me, what
happens if I import the wrong file. Today those answers live in code
comments, three JOURNAL entries, and the maintainer's head — which is
precisely the defect the audience shift names.

**Fix.** Write it AFTER Track 2's re-derivations, so it documents the
posture you are shipping rather than the one you are about to change.
Structure: ranked assets (nsec material; the unpublished corpus;
operator metadata — what was captured, whom, when; third-party
credentials); trust boundaries each with its receiving-side validator
named and gaps marked as gaps not controls (page DOM → content script;
MAIN-world postMessage → content script; content script → SW; extension
→ relay, which IS verified; extension → Anthropic/AssemblyAI/Deepgram;
loopback companion; backup/bundle/sync import; LLM input and output);
attacker classes with the concrete narrative each already has in the
tree (hostile captured page, malicious relay event, malicious backup,
prompt-injecting captured author per JOURNAL 2026-07-17, curious cloud
provider, and the adversary who merely wants to know the researcher
exists). Include the four MAIN-world surfaces — two of them inline
payloads in background/index.js:935 and :1025, outside src/page/ — and
the three installation fingerprints any site can read. Add the PR
row-update rule and reference it from CLAUDE.md.

### B19. The moral lens ships a checkbox and a reader bar for a feature whose only authoring path is the browser console

**Effort:** S · **Converged lenses:** product-manager, newcomer-ux

**Why it blocks 1.0.** src/reader/lens-section.js:50 is the empty state:
"No jurisdictions in the registry yet. Author one in the console (see
docs/SMOKE_TEST.md §Phase 16) — zero ship built-in, deliberately."
jurisdiction-model.js exposes create/update/addAuthority and no surface
in options/, portal/, sidepanel/ or reader/ calls any of them.
USER_GUIDE §5.8 concedes it: "authored and driven partly from the
browser console today, not a finished point-and-click UI." It has one
mention in 8,715 lines of JOURNAL. So a non-technical researcher enables
the checkbox, pays for an API key, clicks the bar, and is routed out of
the product into DevTools and a developer test document. That is worse
than the feature being absent, because it consumes a flag, an Options
block, a reader bar, six shared modules, a guide section and a smoke
section, and it is the only shipped empty state that names no route
inside the product.

**Fix.** Decide before tagging, and either answer is legitimate. Build a
minimal jurisdiction editor (name, type, living-person flag, authority
rows of citation + capped excerpt + admissibility) reachable from the
lens bar's empty state, and walk it on one real case — or retire the
SURFACES for 1.0 as a recorded kill under Art. 3: hide the Options
section and reader bar, keep every module and test, keep kind 30066 free
and guard-tested, keep MORAL_LENS_JURISDICTION_DESIGN.md, and record the
rationale plus a revisit condition in JOURNAL. Do not ship it as-is with
a Reality-check note. Recommend retirement: the retire path is S effort
and fully reversible; the build path is L and has no casework evidence
pulling it.

---

## Tracks

Sequenced so prerequisites come first and early tracks unblock later
ones. The scarce resource is maintainer review, not build capacity.

### T1 — Stop the bleeding

**Goal.** No path in the tool destroys the user's corpus or tells them
something happened that did not.

**Why here in the sequence.** First because these are the only findings
where the user loses work or is actively misinformed, and because every
item below assumes the corpus survives and publish tells the truth. They
are also the cheapest track per unit of review: all small, mechanically
verifiable diffs with no design debate and no dependency on any decision
made later. Doing them first means the two-person walk in T5 exercises a
tool that does not eat its own evidence.

- [x] Archive eviction: remove the unconditional delete pass from
      saveArticle, add unlimitedStorage or drop the cap, refuse to evict
      rows referenced by extraction records or claims, correct the false
      permission comment
- [x] gatePublish confirmedOk at entity-page-block.js,
      synthesis-block.js, inspector.js; entity-dossier-view.js reads it
      instead of re-deriving; guard pins the ordering
- [x] mergeBackup: exclude local_keys (or route through
      LocalKeyManager.importKey with xray:user reserved), correct the
      dialog text at options/index.js:961, add the round-trip guard
- [x] Credential hygiene in one PR: token field to type=password with
      presence-only status; AssemblyAI/Deepgram/companion-token
      constants added to EXCLUDED_STORAGE_KEYS; class-level guard
      replaces the single-key assertion
- [ ] Add the key-free "Shareable copy" export and relabel the full
      backup recovery-only
- [ ] Restore/merge warn channel routed into the persistent report
      element instead of console.warn, with no auto-reload when anything
      was dropped
- [ ] Stamp backups with producing version and per-database DB_VERSION;
      refuse newer-than-understood with a named message (the
      case-bundle.js:156 pattern)

### T2 — Close the security surfaces, then draw the map

**Goal.** The extension's actual attack surface matches what it is
documented to be, and there is one document a group can read to decide
whether to trust it.

**Why here in the sequence.** Second because the threat model must be
written after the surfaces are settled or it documents a posture about
to change — and because the csp-strip decision and the permission
justifications are hard prerequisites for the store submission in T5,
which has the longest external lead time. Writing the map last within
the track is deliberate; every earlier item in it becomes a row.

- [ ] Re-derive rules/csp-strip.json rule 1 empirically; scope to
      youtube.com or retire it; correct README:333, README:393 and
      CLAUDE.md:240 in the same PR; add the CSP-scope guard
- [x] NIP-07 return path: unguessable request id, recompute the event
      hash, assert the pubkey, verify the signature — reject rather than
      fall back
- [x] Remove the web_accessible_resources entry for nip07-bridge.js (no
      getURL call site anywhere) and the unused
      nip04Encrypt/nip04Decrypt bridge methods
- [x] Drop __xrApiHookSetPatterns / __xrApiHookMatch from the production
      bundle; gate the three MAIN-world console.log calls; return early
      before the xrayCaptured dataset stamp when captureAutomation is
      off
- [ ] Authenticate the xr:apihook:event channel with a per-page token
      minted in the existing configure envelope
- [ ] Correct api-interceptor.js:14-19 and esbuild.config.mjs's header
      to match manifest.json; move or justify the two inline MAIN-world
      payloads in background/index.js
- [ ] Add referrerpolicy="no-referrer" to every reader img emission and
      an offline-reading preference
- [x] Write docs/THREAT_MODEL.md from the re-derived posture; reference
      it from CLAUDE.md; add the PR row-update rule

### T3 — Take inventory and ratify the kills

**Goal.** An accurate, guard-enforced statement of what exists — flags,
kinds, surfaces — so that nothing downstream is documented, walked, or
shipped that is about to be deleted.

**Why here in the sequence.** Third because every remaining track needs
an accurate inventory: T4 cannot gate a tree whose surface list is
wrong, T7 must not write documentation for features about to be retired,
and the wire numbers become permanent promises at the tag so their
reconciliation has a hard deadline that nothing else does. This track is
high review-density and low risk — mostly reading and ratifying — which
makes it good work to interleave with T5's waiting periods.

- [x] Retire the eight never-read flags in place with rationale; guard:
      every FLAGS_DEFAULTS key is read by isEnabled or listed in
      RETIRED_FLAGS
- [ ] Surface reviewCoordination and extractionAnalysisPublishing in
      Options with their disclosure text; decide storeFirstPublish
      (recommend: default on, flag dropped after the gate walks it);
      guard: every non-retired flag has a control id or a dated
      DEVTOOLS_ONLY allowlist entry
- [ ] Regenerate USER_GUIDE §2.5 from FLAGS_DEFAULTS with a
      where-column; guard the two sets equal
- [ ] Write the flag ledger: per key, the casework problem, the
      falsifier, a check date, a disposition
- [ ] Ratify the consolidated kill list (below) — decision only;
      execution is T8
- [ ] Art. 10 + NIP_DRAFT parity: sections for 30041 and 30078; rows for
      9803, kind 1, kind 5; 30050-30053 reclassified
      reserved/scaffolded-unemitted; per-kind status in
      reference-implementations; guard extended to both halves
- [ ] Amend the §x-tag section for its dual meaning; publish the 30023
      d-derivation and the metadata-header strip regex; record the
      NKBIP-01 keep decision with the disambiguator
- [ ] Correct ROADMAP:1473 and :1688 (walks marked pending that JOURNAL
      says were done), CLAUDE.md's stale Phase-28/v0.7.0 paragraph, and
      add USER_GUIDE.md to CLAUDE.md's Project-docs list

### T4 — Make the release gate real

**Goal.** There is a gate that can actually be run, on the artifact that
actually ships, with a record of what was verified.

**Why here in the sequence.** Fourth because it is the machinery every
later claim rests on — the two-person walk in T5 and the onboarding work
in T7 both produce assertions that need somewhere to be recorded, and
the tag itself cannot honestly be cut without it. It sits after T3
because the gate should exercise the surface list T3 makes accurate, and
after T1/T2 because gating a tree that is still eating captures wastes
the walk.

- [ ] Split SMOKE_TEST into a short mandatory gate and an archived
      per-phase appendix (Art. 3 — retired as gate, not deleted); create
      the walk ledger at the top of the gate, seeded honestly
- [ ] Fix the stale counts and the seven-bundle list in SMOKE_TEST and
      esbuild.config.mjs's header; guard the bundle list against the
      parsed outfiles; ban hardcoded test counts
- [ ] Move the package.json ↔ manifest.json equality check into ci.yml
      as a guard test
- [ ] playwright devDependency, resolver-based browser path with env
      overrides, npm run smoke:walk, CI job loading the extension and
      opening all five pages
- [ ] Path-filtered CI job running companion/transcriber/tests
      (server.py imports no torch, so it is seconds) with a comment
      stating it cannot observe GPU behaviour
- [ ] Prune webExt.ignoreFiles (tests, docs, tools, scripts,
      esbuild.config.mjs, package-lock.json, CLAUDE.md, _metadata,
      release source maps) and assert packaged contents in CI
- [ ] Reconstruct CHANGELOG [Unreleased]; make release.yml's blank-body
      fallback fail; add the ahead-of-tag CHANGELOG CI check
- [ ] Build scripts/release-preflight.mjs to the ordering already
      declared in .claude/skills/README.md; cross-reference it from
      CONTRIBUTING step 3
- [x] Delete the compgen guard around npm test; fix or delete npm run
      clean; add a Disciplines-invoked and Verification-layer section
      plus the canonical "Wire format:" heading to the PR template
- [ ] MA-section rows for the map-artifact wave, a merge-import row, and
      an old-vintage restore row; add missing platform unit tests
      (twitter.js, youtube.js pure functions); seed real v3→v7
      audit-cache and v1→v3 archive-cache ladder tests

### T5 — Gather the two pieces of evidence you do not have

**Goal.** The delivery channel is decided and in motion, and the group
claim rests on two people on two machines rather than one person
profile-switching.

**Why here in the sequence.** Fifth because these are the only items
gated by things outside the maintainer's keyboard — a store review
queue, a second human being, a second machine — so they should start the
moment their prerequisites (T2's threat model, T4's runnable gate) land,
and run in parallel with T6/T7 rather than after them. The walk in
particular is the evidence T6 needs to know which group defects actually
bite.

- [ ] Chrome Web Store listing (unlisted is sufficient for a closed
      group) and an AMO-signed or self-hosted signed .xpi with
      update_url; permission justifications written from T2's threat
      model; budget a review round
- [ ] Update SECURITY.md's "GitHub Releases is the only legitimate
      source" claim; emit SHA256SUMS with the release; document the
      verification one-liner
- [ ] Install the built zip into a clean profile and run the new short
      gate against it — the artifact under test is the artifact shipped
- [ ] The two-person, two-machine walk on a live case: A publishes
      claims and a verdict, B follows, pulls, incorporates as proposals,
      publishes a contrary judgment, A sees it side by side. Record the
      outcome in JOURNAL whatever it shows
- [ ] Decide networkPage's default on that evidence and record it; lift
      EPISTACK_RUNBOOK §5 into the gate and §7 into the preflight before
      bannering the runbook historical
- [ ] Decide Firefox: either run the short gate on Firefox 128 ESR and
      record it, or narrow the claim in README and CHANGELOG to
      community-supported beyond capture
- [ ] Declare the companion Windows-only in the extension UI, or add a
      macOS/Linux path to its README

### T6 — Make the group surfaces usable as group surfaces

**Goal.** Two researchers can see each other's identity, each other's
judgments, and each other's disagreements, without reading source.

**Why here in the sequence.** Sixth because two of its items (the hex
chip, the unrendered incorporated store) are certain defects that can
start immediately, while the rest are best sequenced against what the T5
walk actually exposes — spending review on a speculative fix for a group
failure mode nobody has observed is exactly the accretion the maintainer
named. Placed before T7 because the group chapter of the guide cannot be
written until the group surfaces settle.

- [ ] One author-chip helper (npub + follow label + hex on hover); route
      claim-extractor.js:977 and sidepanel/index.js:706 through it;
      guard against rendering an author by slicing hex
- [ ] Render incorporated_artifacts beside native records wherever claim
      judgments show — attributed, never averaged; guard that no
      WORKSPACE_CONTENT key is written by a shared model and read by no
      surface
- [ ] Render the suggested_by provenance badge on foreign claims and
      state the publish skip instead of filtering silently
- [ ] Case-bundle scope selector (narrow claim orbit vs tag∪claim union)
      with entity and key counts in the confirm
- [ ] parseFeedEvent returns a drop reason; surface a per-author
      unreadable count beside the existing capped counter
- [ ] Kind-0 and kind-10002 publishing routed through fetch-and-merge
      with a diff and explicit confirm on remote divergence
- [ ] Pick and document ONE supported collaboration path; banner
      TEAM_CASE_DESIGN.md with what shipped and what is parked; correct
      ROADMAP:1461's case+entity follow-scope claim
- [ ] Reader author-attributed pre-flight showing which key signs what
      (feeds T7's pre-flight sheet)

### T7 — The first hour

**Goal.** A researcher who did not build this can install it, understand
what it does, publish without accidentally disclosing something, and
find the answer when stuck.

**Why here in the sequence.** Seventh because it is the largest single
lift and the one most expensive to redo — it should be written once,
against a tree whose kills are ratified (T3), whose group surfaces are
settled (T6), and whose install path is known (T5). Writing the guide
before the kill list is ratified guarantees documenting features that
are about to be retired, which is how the current guide got into its
state.

- [ ] Publish pre-flight sheet enumerating artifact classes, signing
      identities, relay set and irrevocability, assembled before the
      first network request
- [ ] One "What becomes public" page collecting the eight scattered hint
      paragraphs; link it from the pre-flight and from Settings
- [ ] First-run: open Options/welcome on install with an identity →
      relays → flags checklist; Help link in all five surface headers;
      default Options to Signing when no identity exists
- [ ] Fix the button-label drift in README, USER_GUIDE and SMOKE_TEST;
      delete README's false claim that capture gates on signing; add the
      doc-names-a-real-button guard
- [ ] Shoot the 14 screenshots the appendix specifies; blur the key
      field in 04; add the image-count guard
- [ ] USER_GUIDE gaps: AI vision, the durable extraction layer and its
      review queues, kind 30070, Import & merge (quoting
      backup.js:417-430 verbatim), opinion modules, shared-text scan,
      speaker identification, and a group chapter walking a second
      person from install to contributing
- [ ] docs/README.md index splitting the 48 files into for-users /
      how-it-decides / how-it-was-built
- [ ] Replace the eight "see console" terminations with remedies; add a
      Download escape on the synthesis save failure
- [ ] Sticky Save with dirty-state and a beforeunload guard in Options →
      Advanced; split Advanced into named sub-tabs; relabel Restore vs
      Merge around intent, not mechanism
- [ ] In-reader icon legend (a ? over the claims bar) so the 13-glyph
      vocabulary is not doc-only
- [ ] aria-labels on the relay checkboxes and the claims bar; complete
      or drop the half-declared ARIA table roles

### T8 — Execute the kills and collapse the seams

**Goal.** The tree matches the ratified inventory: what was killed is
gone from the surface and recorded in the log, and one concept has one
destination.

**Why here in the sequence.** Last because kills need ratification
before execution and because several of them are simultaneously
documentation decisions T7 depends on knowing — but the execution itself
is mechanical and can trail. Keeping ratification (T3) and execution
(T8) apart is what lets the maintainer's scarce review time be spent
once on the decision rather than twice on the decision and the diff.

- [ ] Execute every ratified kill with a JOURNAL entry per group; Art.
      10 rows updated; nothing deleted from the record
- [ ] Collapse the three entity destinations (entity-dossier / entity /
      entity-corpus) into one destination with Graph / Dossier /
      What-the-network-holds tabs
- [ ] Consolidate the ~10 import/export verbs across four surfaces into
      one "Your data" panel with three named jobs, keeping
      content-intake imports where the work happens
- [ ] One user-facing noun per surface: Archive (not portal/My Archive),
      Entities (not Entity Browser/side panel); code names stay internal
      with a note in CLAUDE.md
- [ ] Flip TRUTH_ADJUDICATION_DESIGN.md and
      MORAL_LENS_JURISDICTION_DESIGN.md from "design draft" to
      normative-with-merge-date; add supersession banners to the
      superseded kickoffs and the EPISTACK cluster
- [ ] Rename the two Suggest buttons by what differs and what it costs
      ("sends article text" vs "on this machine")
- [ ] Convert the SW's unconditional console.error info lines (which log
      captured URLs and body prefixes) to Utils.log; sweep the reader's
      117 bare console calls as a follow-up
- [ ] Add onversionchange and onblocked to the four unguarded IndexedDB
      openers; convert portal-cache and network-cache to explicit
      oldVersion ladders while their blocks are still empty
- [ ] Post-1.0 candidates, explicitly deferred: extract
      reader/index.js's 1,573-line publish() into per-family modules;
      the control-registry init(); context-placement headers across
      src/shared's 119 flat modules; docs/ARCHITECTURE.md and the xray:*
      message registry

---

## Kill list (15) — RATIFIED 2026-08-09

Consolidation means deletion. Art. 3 governs: the record and the
rationale survive, the code is git-recoverable, and killed plans may be
re-argued on merits.

**The maintainer ratified all fifteen on 2026-08-09** ("kill them all"
— Art. 11; the instruction is the ratifying act). Execution status is
recorded per entry below, and this is the authoritative list — the
`JOURNAL` carries the narrative, this carries the state.

| Status | Count | Entries |
|---|---|---|
| **DONE** | 6 | K1, K2, K6, K7, K10, K11 |
| **PARKED** (deliberately narrower) | 1 | K3 — moral lens |
| **HALF DONE** | 3 | K5, K8, K15 |
| **BLOCKED — entry is wrong or unsafe** | 4 | K4, K9, K13, K14 |
| **NOT STARTED** | 1 | K12 (belongs with T4) |

**Four entries were found to be wrong when a blast-radius map was run
before executing them** (2026-08-09). That is not a criticism of the
audit — it is the difference between an audit produced by *reading* the
tree and one produced by *executing* against it. Every blocked entry
below states what is actually true. The worst, K14, would have shipped
a production `TypeError` that no test in the suite could catch.

**Before executing any remaining entry, read its status note.** The
original text is preserved beneath it unchanged (Art. 3) and is wrong
in the places the note says it is.

### K1. The entire Phase-9a crowdsourced-metadata publish layer: builders for kinds 30050 Annotation / 30051 FactCheck / 30052 Rating / 30053 TopicTrust / 9803 HelpfulnessVote, plus metadata/ranker.js and metadata/topic-trust-builder.js, plus the four unused IndexedDB stores (annotations, factchecks, ratings, helpfulness) created at archive-cache DB v2

> **DONE** — PR #317 (`bd0396d`), 2026-08-09. Kinds reclassified RESERVED (never emitted), not retired. A FIFTH store, `trust_graph`, shares the same v2 rung and was NOT on this list — left alone, needs its own ratification. `DB_VERSION` stays 3 and nothing calls `deleteObjectStore`: the stores simply stop being created.

Five lenses converged independently. No caller exists anywhere in src/ —
every reference outside the builders is a test, a portal type label, or
a comment. Phase 9b never came and Phase 11 explicitly superseded the
idea (ROADMAP:964-969: the responses-to-claims idea became the
assessment primitive); ROADMAP itself already records "ranker.js stays
unwired." Keeping it costs: Art. 10 currently promises strangers that
30050-30053 are active for a family nothing has ever emitted;
portal/library.js renders type labels a user can never populate;
portal/corpus.js queries "dormant metadata kinds (flag-gated writers)"
whose writers do not exist; USER_GUIDE teaches five publish capabilities
that are fiction; and every install carries four dead object stores that
backup and every future DB_VERSION bump must keep handling. Per
ecosystem-pm, which owns the Art. 10 schedule: reclassify to reserved —
scaffolded, never emitted, never reuse, NOT "retired," since nothing was
ever published. Retiring now is free; after 1.0 it is a permanent
promise.

### K2. The eight never-read feature flags: annotations, respondsTo, topicTrust, factchecks, ratings, helpfulnessVoting, bridgingRanking, transitiveTrust

> **DONE** — PR #317. Registry now 20 declared / 20 read / 0 dead. `trustGraphFilter` sits inside the same block and is LIVE (`network/index.js:811`) — kept. The `respondsTo` TAG is emitted on every kind-30023 and survives; only the flag was dead.

Verified directly: exactly 20 flags are read by an isEnabled() call in
src/ and these eight are not among them. Three default to TRUE, so they
read as live guarantees a user could turn off; they guarantee nothing.
Six are documented in USER_GUIDE §2.5 as real publish gates a user is
instructed to flip in DevTools. Note precisely: the respondsTo TAG is
live at event-builder.js:261-263 — only the flag is dead, so the tag
must survive the kill. Retire in place with rationale (Art. 3 — names
and numbers stay in the record); a third of the flag registry being
noise is what makes the real promote-or-kill questions invisible.

### K3. The moral lens SURFACES — the Options section (options.html:487-505), the reader bar (reader/index.html:143-150) and lens-section.js's console-pointing empty state — keeping every module, every test, and kind 30066 free and guard-tested

> **PARKED, not killed** — PR #318, 2026-08-09, on maintainer instruction ("I will want to bring back moral lenses… make sure it will be easy"). Only the Options checkbox and the console-pointing empty state went. Every module, every test, the flag, the reader markup and kind 30066 survive — the modules keep their tests, so the code stays exercised and cannot rot while parked. Revival condition: once lenses have been tested on real casework. Instructions are in a comment at the removal site in `options.html`.

The only shipped feature whose honest empty state instructs the user to
leave the product and open a developer console, in a release whose
entire premise is users who cannot do that. Zero jurisdictions ship, no
authoring UI exists, one mention in 8,715 lines of JOURNAL, and no
casework has ever fed it. This is the strongest candidate in the tree
under the project's own fact-layer test. Retirement is cheap and fully
reversible: the code is git-recoverable, 30066 stays reserved and
machine-checked, MORAL_LENS_JURISDICTION_DESIGN.md preserves the design,
and the rationale plus revisit condition go in JOURNAL. The alternative
— building a jurisdiction editor and walking it on a real case before
the tag — is legitimate but is an L against no pulling evidence.

### K4. The xray:forward:* wildcard message branch (background/index.js:446-459)

> **BLOCKED — needs a decision.** The blast-radius map found the single caller cannot work today (`options_ui.open_in_tab:true` means the active tab IS the options page, so `tabs.query({active,currentWindow})` targets a page with no content script), and `captureActiveTab()` uses the identical query — so the proposed typed replacement inherits the same defect. Needs the O.5 walk before any rename is called behaviour-preserving. Fixing the affordance is a different change from renaming the message.

An untyped passthrough that forwards any message type to the active tab,
serving a popup surface removed in JOURNAL 2026-06-09, with exactly one
caller (options/index.js:1690) for one action. It is the single hole
that makes the architect skill's "exactly one handler in exactly one
context" rule unenforceable — no typed-message guard can ever be
complete while it exists. Replace the one caller with a typed
xray:capture:active handled by captureActiveTab().

### K5. Signer.recordSigningState (signer.js:177-190) and the verifyEvents export (nostr-events.js:122-131)

> **HALF DONE** — `Signer.recordSigningState` retired in PR #318 (and with it the `Utils` import it alone used). `verifyEvents` is **BLOCKED**: it carries 10 of the 11 tests in `tests/nostr-verify.test.mjs`, the only coverage of `verifyOne`, which the LIVE `firstValidEvent` path runs on every relay read — including the id-cache-poisoning guard. Deleting it removes the verify-on-ingest regression net. Rewrite those tests against `firstValidEvent` in the same PR, or keep it as an explicitly-marked test seam.

Both are dead exports with zero callers. recordSigningState writes
xr_signing_state, which content/index.js:218-231 re-implements privately
and calls nine times — two documented writers for one key, one of them
dead. verifyEvents is named exactly what a reviewer would grep to
confirm ingest coverage, and the wired path is firstValidEvent, so its
presence makes the coverage picture ambiguous rather than clearer. Also
fix signer.js:9 and :174, which still reference the removed popup.

### K6. nip04Encrypt / nip04Decrypt in src/page/nip07-bridge.js:24-29, and the web_accessible_resources entry for that file (manifest.json:98-107)

> **DONE** — PR #316 (T2), 2026-08-09.

NIP07Client exposes only probe, getPublicKey, signEvent and getRelays —
nothing calls the nip04 methods, and entity-sync uses
Crypto.nip04Decrypt directly. They are unused encrypt/decrypt entry
points reachable by postMessage from any page on <all_urls>. The WAR
entry has no getURL call site anywhere in src/ (the file is injected
declaratively as a MAIN-world content script), so under the security
discipline's own rule — a permission with no call site is removed — it
hands every website a deterministic probe for the extension's stable ID,
which for a tool pointed at adversaries means the target's own site can
detect its visitor runs X-Ray.

### K7. window.__xrApiHookSetPatterns and window.__xrApiHookMatch (api-interceptor.js:210-211)

> **DONE** — PR #316 (T2). The comment claimed a unit test needed them; no test in the repo referenced either.

The comment above them admits they exist only for a JSDOM unit test and
that stripping them "is desirable but not critical." They are
page-callable functions on facebook, instagram and youtube that let any
script reconfigure or interrogate the extension's capture patterns — a
page-writable control surface on the capture pipeline plus a third
installation fingerprint, purely for test convenience a build flag or a
direct module test could serve.

### K8. The auditor-prototype CLI instruction in the Options UI (options.html:351-356), and the reader's always-visible "Import audit JSON…" control (reader/index.html:126)

> **DONE (Options half)** — PR #318: the CLI paragraph now leads with the in-extension Quick/Thorough path and frames import as the exception. The reader control was left: `importAuditJson` is shared with the live in-extension auditor (`reader/index.js:3982`), so removing the control is not the same as removing the handler.

Three lenses converged. The in-extension Quick/Thorough auditor
superseded the CLI path in Phase 14.5, yet Settings still tells a
non-technical user their route to an audit is a Node command line, and
every capture carries a permanently visible import control for a JSON
format the user cannot produce — while its siblings on the same bar are
correctly flag-hidden. Keep docs/auditor-prototype/ as provenance and
mark it archival; its prompts/ corpus duplicating
src/shared/audit/module-prompts.js is a live drift hazard that should be
generated or explicitly frozen.

### K9. `case` as a selectable type in the side panel's ＋ New entity dialog (sidepanel/index.html:31)

> **BLOCKED — the entry is wrong.** `sidepanel/index.html:31` is the list-view type FILTER chip, not a create control; the New-entity dialog has no markup there at all (built in JS at `sidepanel/index.js:1289-1352`). Executing as written would delete a filter and leave the create path intact. Also `case` is hand-creatable from THREE surfaces, not one (`reader/claim-extractor.js:238-240`, `reader/entity-tagger.js:150-151`). And removing `case` from `ENTITY_TYPES` would break the tree — `assertValidType` would reject the type `createCase()` itself creates.

src/shared/case-create.js:20-23 states plainly that the case entity is
"an implementation detail the user never assembles by hand" — and this
control is exactly that hand-assembly, producing an object named like a
case, typed like a case, and not the case workspace anything else in the
product means. Meanwhile the real createCase() has one entry point,
buried three-quarters down Settings → Advanced. A newcomer making their
first case has better-than-even odds of making the wrong object from the
more discoverable surface, then finding captures do not join it and the
portal has no dashboard for it — unrecoverable without reading source.

### K10. The compgen -G "tests/*.test.*" conditional wrapped around npm test in ci.yml, and the blank-body fallback in release.yml's changelog extraction

> **DONE** — PR #318. Note the entry was wrong about the release half: there is no blank-body fallback construct to delete; the awk simply propagates an empty string. The fix was to ADD a guard that fails loudly.

Two lenses each. The compgen guard's own comment concedes it predates
the test suite and exists to keep a hypothetical test-less branch green;
2513 tests now hang on that glob matching, so a directory rename
converts the project's primary safety net into "No tests yet; skipping"
under a green checkmark. The release fallback's comment states the
intent — "Falls back to a blank body if the section isn't found, so the
release still publishes" — but publishing an empty release body is the
failure, not a degraded success, and it guarantees the mistake ships
silently at the one moment (a protected, undeletable tag) where recovery
costs a version number.

### K11. npm run clean, or its rm -rf implementation

> **DONE** — PR #318. Now a `node rmSync` one-liner, exercised on Windows.

package.json:12 is `rm -rf dist`, documented in CLAUDE.md as a project
command, and it errors under npm's default shell on Windows — the
maintainer's own platform, and the platform a newcomer following
CLAUDE.md is most likely on. Either replace with a node -e rmSync
one-liner or delete the alias; a documented command that does not run is
the small lie that costs someone twenty minutes.

### K12. The SMOKE_TEST per-phase agent-coverage table (:149-163), the "Suggested agent-driven loop" pseudocode (:164-187), and every hardcoded test/bundle count in the document

> **NOT STARTED** — belongs with T4 (the release gate), since the replacement text depends on how SMOKE_TEST is split. Note the count list is incomplete: it misses `SMOKE_TEST.md:208` (row 1.1), whose documented command does not filter at all.

Two lenses converged. Both blocks describe the 2026-04-21 MCP tab-group
proof of concept, cover Phases 2-7 only, and contain a step-numbering
bug; the 2026-08-02 walk that actually found a bug used a Playwright
harness they never mention. They read as the authoritative statement of
what an agent can verify and understate it by roughly an order of
magnitude — which is how "this cannot be smoked" came to be repeated in
four PR descriptions. The hardcoded counts (1277, 1018, seven bundles)
are the same drift class and are what make the doc's own pass criteria
structurally unable to fail. Retire on the record and replace with the
Standard-5 classification plus a pointer to tools/smoke.

### K13. The six EPISTACK_* documents plus docs/epistack/ (~1,600 lines), and the superseded kickoff briefs kept alongside their design docs (PHASE_15_KICKOFF, PORTAL_KICKOFF, EPISTEMIC_AUDIT_KICKOFF, CASE_WORKSPACE_KICKOFF, CASE_BOUND_WORKSPACES_KICKOFF)

> **BLOCKED — the entry is wrong about two of the five.** `CASE_WORKSPACE_KICKOFF.md` and `CASE_BOUND_WORKSPACES_KICKOFF.md` have NO design doc — they ARE the durable spec, cited as normative by nine `src/` files and three tests. Bannering them "superseded — see the design doc" would strand those files. They need a SHIPPED/NORMATIVE banner instead. Also: lift `EPISTACK_RUNBOOK` §5 (:197-232, not :197-228 — the short range drops the restore step) and §7 into the gate BEFORE bannering.

Two lenses. The EPISTACK cluster is an expired competition entry
(deadline 2026-07-19, recorded submitted) carrying live-sounding dates
and imperatives that read as current work; one file is already
self-marked SUPERSEDED. The kickoffs are handoff prompts for sessions
that have shipped, each with a design doc that is the durable artifact,
and at least one carries its own note that what shipped differed.
Together they are a third of the doc corpus's discoverability budget and
they ship inside the user-facing zip. Lift RUNBOOK §5 (second
investigator) into the gate and §7 (clean-clone) into the preflight
FIRST — that is the only live value in the set — then banner the rest
historical. Banner, never delete (Art. 3).

### K14. The v4-compat façades in storage.js — Storage.entities (:354-360) and Storage.articleCache (:408-412) — and the four inert legacy userscript keys (publications, people, organizations, keypair_registry)

> **BLOCKED — the most dangerous entry in the set.** `Storage.entities` is NOT a dead stub: it is a null-object DEFAULT that three surfaces overwrite at runtime and that `event-builder.js:318` and `:331` read in production. All three bridge installs swallow their exceptions, so deleting it converts a soft failure into a `TypeError` mid-publish — and NO test would catch it, because every `buildArticleEvent` call in the suite but two passes an empty entity list. Only `entities.save` is genuinely dead; `articleCache` is dead as claimed. Separately, removing the four legacy keys from `options/index.js:83` would ORPHAN userscript-era data forever (that array is the only purge path) and contradicts a recorded decision at `JOURNAL.md:5318-5320`.

The façades are dead stubs: entities.get returns null, entities.save
throws an error citing an internal phase number and a GitHub issue id at
a 1.0 user, and articleCache.save is a silent no-op — a data-loss shape
hiding in the storage module's public surface. The four legacy keys are
read by no module in src/; they appear in exactly two places, a delete
list and a backup dump, and "Erase X-Ray SETTINGS" wipes
keypair_registry (userscript-era private keys) under a label that never
says so. Whichever way it goes it needs to be recorded: either a
one-time export path in Options, or an explicit JOURNAL entry stating
the keys are inert and preserved.

### K15. The entity-corpus portal destination as a separate button (portal/entity-view.js:78), and the vestigial "Experimental" heading in Options → Advanced (options.html:319)

> **HALF DONE** — the "Experimental" heading renamed in PR #318 (it labels a live checkbox, so it needed a replacement heading, not a deletion). The entity-corpus fold is **NOT STARTED** and needs care: the corpus view is PUBKEY-addressed and works for strangers, while the dossier is local-entityId-addressed — folding it into the dossier would silently drop every foreign pubkey, which is the exact case it exists to serve. Fold into the entity (spokes) view.

Two lenses on the first. entity-corpus is the third destination for one
person, distinguished from "Open dossier" only by data provenance — a
distinction only the author holds — and it appears nowhere in USER_GUIDE
§7. Fold it in as a "What the network holds" tab rather than retiring
the code. The Experimental heading scopes one checkbox out of eleven
default-off publish toggles carrying identical disclosure language, so a
careful user reads it as a boundary and concludes the other ten are
stable and safe to enable — it actively misinforms, and removing it
costs one line.

---

## What 1.0 can ship without

A 1.0 that never ships because the list was infinite is a worse
outcome than a 1.0 with known, documented limits. Each item below is
deferred **with its limit stated in the docs** — an undelivered
capability documented as normative is worse than one documented as
deferred.

- Firefox parity beyond capture. Today CI runs web-ext lint only, the
  Firefox smoke section is three rows covering Phase 2 and Substack, and
  JOURNAL 2026-04-22 already records an engine divergence (entity sync
  NIP-04 works in Firefox, fails in Edge). Either run the short gate on
  Firefox 128 ESR once and record it, or narrow the claim in README and
  CHANGELOG to "community-supported and unverified beyond capture."
  Shipping the claim unverified is the only unacceptable option.
- The audit family's cross-user read path. Kinds 30056-30061 are the
  project's largest single wire investment and a group member cannot
  see, fetch or respond to another member's audit — NETWORK_FEED_KINDS
  omits the whole family, PROPOSAL_CLASSES excludes it, and
  buildAuditDisputeEvent is marked wire-format-only with no filing UI.
  1.0 can defer this, but NIP_DRAFT's reference-implementations
  paragraph and ROADMAP must say so explicitly: an undelivered
  escalation path documented as normative is worse than one documented
  as deferred.
- Kind 30061 dispute filing and right-of-reply authoring. The wire
  carries reply refs and precedent tags, the models store them, the
  inspector renders them — and neither the adjudicate nor the integrity
  modal has an input. NIP_DRAFT promises "the reply travels with it";
  document that no user can currently keep that promise.
- The moral lens entirely (recommended: retire the surfaces, keep the
  modules, tests and the reserved 30066). If instead it is kept, it
  needs the jurisdiction editor and one real casework use before the tag
  — not a Reality-check note.
- Case-scoped and entity-scoped follows. FOLLOW_SCOPES declares three;
  no call site in src/ constructs anything but global. Correct
  ROADMAP:1461 and USER_GUIDE §10 to describe global-only rather than
  shipping a documented team-joining mechanism that does not exist.
- TC.3 group-accountability disclosures and TC.5 deputy key escrow. Both
  are specified in TEAM_CASE_DESIGN and neither exists in src/. Document
  the accepted consequence plainly: if a case-key holder leaves, kind-0
  and 32125 updates for that entity freeze while members keep
  publishing.
- A case-export JSON importer. buildCaseJson has no consumer inside
  X-Ray, so relabel it in USER_GUIDE §9.6 as a report format for humans
  rather than a transfer format — otherwise users will try to import it
  and find no affordance.
- Kind 30070 relay ingest. The exclusion from NETWORK_FEED_KINDS is
  deliberate and reasoned (quote re-grounding must run against a locally
  held body) and pinned by test. Just say so in the §30070 section, so a
  second-client author does not expect the reference implementation to
  consume what it publishes.
- Encrypted (passphrase) bundles and backups. The key-free share export
  supersedes the immediate need; NIP-44 v2 is already in the tree if a
  later release wants it. Document that the shareable export is the
  sharing artifact and the full backup is recovery-only.
- macOS and Linux companion setup. The companion README requires Windows
  10/11 with no other path while the extension ships for both. Declare
  Windows-only in the extension UI — not only in a README the zip user
  never receives.
- The bulk of docs/SMOKE_TEST.md as a mandatory gate. Keep it as an
  archived per-phase appendix; only the short gate is required before a
  tag. Sections deliberately not walked get the accepted-risk sentence
  in the ledger.
- Clearing the 255 standing web-ext lint warnings. Record the count as a
  baseline and fail CI on an increase; do not spend 1.0 review on
  innerHTML sweeps.
- Internal-facing structural documentation: docs/ARCHITECTURE.md, a
  canonical xray:* message registry, context-placement headers across
  src/shared's 119 flat modules, and the reader/index.js decomposition
  (7,811 lines, a 1,573-line publish(), a 12-call init()). All are real
  and all are post-1.0. The cheap version that IS blocking is correcting
  CLAUDE.md's stale paragraph and the three files (esbuild.config.mjs
  header, api-interceptor.js header, README test count) that describe
  the bundle graph wrongly.
- Accessibility beyond the relay checkboxes, the claims bar and the
  half-declared ARIA table roles in Options. Name it as a known limit
  rather than an unstated one.
- Telemetry, usage analytics, or any adoption measurement. Not deferred
  — refused. The extension must not observe its user's investigations,
  and the evidence that the group path works comes from one recorded
  two-person walk, not from instrumentation.

---

## Resolved tensions

Where two disciplines wanted opposite things, the seam map in
`.claude/skills/README.md` decides who owns the call.

**Tension.** Should the full backup keep carrying the user's nsec? The
security discipline's own Standard 4 asserts "backup.js exports exclude
the primary identity by default" while tests/backup.test.mjs:147 asserts
the opposite and calls it deliberate, matching two recorded maintainer
decisions (JOURNAL 2026-07-10 and 2026-07-25). Meanwhile group-research
and product-manager both want a path that does not require handing a
colleague your signing identity.

**Resolution.** Keep the recorded decision — the full backup is a
recovery artifact and losing your nsec in a restore would be worse. Add
the key-free "Shareable copy" as a third export and make it the one the
sharing documentation points at, relabel the full backup recovery-only,
and correct the skill text to say the SHAREABLE export excludes key
material. Art. 13 makes skill text Tier-3 process tooling, so the skill
is the cheaper correction — and once the share export exists, the
standard becomes true again rather than merely amended. Owner:
security-threat-modeler for the mechanism; the maintainer for the
decision, since it revises a recorded one.

**Tension.** Should rules/csp-strip.json rule 1 be deleted or scoped?
security-threat-modeler lists it as a kill candidate; CLAUDE.md and
README describe it as load-bearing for the YouTube transcript fetch,
which is a documented product capability.

**Resolution.** Neither on faith — re-derive empirically. The page's
connect-src can plausibly block a MAIN-world fetch, and the transcript
path now runs through executeScript in the page's own context, so the
question is answerable in one test rather than by argument. If it is
still needed, scope it with requestDomains: ["youtube.com"] and the
minimum resourceTypes; if not, retire it as a recorded kill. Either way
the three documents that call it YouTube-scoped get corrected in the
same PR and the CSP-scope guard lands so it cannot silently
re-globalize. Owner: architect — manifest and permissions are an
explicit one-way-door trigger in its skill — acting on
security-threat-modeler's finding.

**Tension.** Should networkPage default on for 1.0? architect and
consolidation both argue the flag contradicts ROADMAP:1914 marking Phase
25 COMPLETE and that the collaboration story cannot ship behind a
checkbox under a tab named Advanced. product-manager argues the default
should not move until a real two-machine walk produces evidence.

**Resolution.** Walk first, then decide, and record both. The flag
comment and the ROADMAP line already contradict each other, so something
has to move regardless; making the default flip contingent on the walk
means the decision is evidence-backed rather than inferred, and the walk
is on the critical path anyway. Owner: product-manager — flag-default
flips are a named trigger in its skill — with verification-engineer
owning the walk's classification and the ledger entry.

**Tension.** Is docs/SMOKE_TEST.md retired as the release gate
(verification-engineer) or kept and improved with a ledger at its top
(continuous-improvement, automator)?

**Resolution.** Both, and they are not actually in conflict: split the
file into a short mandatory gate plus an archived per-phase appendix
under Art. 3, and put the walk ledger at the top of the GATE. The
disagreement is only about which document the ledger heads. Owner:
verification-engineer — its Standard 8 explicitly creates the ledger on
its first tag-time run — with automator owning the runnable-harness
half.

**Tension.** How should the Phase-9a kinds be reclassified?
product-manager says retire 30050-30053; ecosystem-pm says "retired" is
the wrong word because nothing was ever emitted and the honest status is
reserved/scaffolded-unemitted; consolidation agrees with ecosystem-pm.

**Resolution.** Take ecosystem-pm's framing — it owns the Art. 10 kind
schedule per the seam map, and the distinction is real: "retired"
implies events exist in the wild that consumers must still handle, which
is false here and would mislead a second-client author into writing dead
read paths. Never-reuse still applies. The related distinction is worth
codifying in the same pass: Art. 10 currently cannot express "retired,
still parsed" (30043) versus "retired, no longer parsed" (30067), and
both exist in the tree.

**Tension.** storeFirstPublish: consolidation says it is a durability
guarantee that should default on and lose the flag once the smoke rows
pass; continuous-improvement says the ambiguity must simply be resolved
either way; ecosystem-pm and five others say it needs an Options
checkbox.

**Resolution.** It is a durability guarantee, not a disclosure — the
user has no meaningful choice to make about whether their own signed
event survives a failed relay round. Ship the checkbox for the gate
walk, then default it on and drop the flag in the same release once the
walk records green. That is one fewer permanent switch on a Settings
page already carrying seventeen. Owner: architect — the publish result
contract is its seam.

**Tension.** Options → Advanced: newcomer-ux wants it split into named
sub-tabs with a sticky dirty-state Save; consolidation wants the ~10
scattered import/export verbs collected into one "Your data" panel.

**Resolution.** Compatible and mutually reinforcing — make "Your data"
one of the sub-tabs. The sub-tab split is what makes the data panel
findable, and the data panel is what stops the four-surface verb sprawl
from re-forming inside the new tabs. Sequence them as one piece of work
in T7, not two.

**Tension.** The judgment layer: consolidation argues eight overlapping
vocabularies are the "bolted on" complaint at its source and should be
consolidated; the constitution's Art. 6 never-merge firewall and the
design statutes make the distinctions load-bearing and deliberately
unmergeable.

**Resolution.** Consolidate the SURFACE, never the kinds. One "What you
publish" panel with plain-language rows ("Your take on a claim", "A
ruling on whether something is true", "A named rhetorical maneuver"),
wire kind numbers demoted to a details disclosure, and one decision
table at the head of USER_GUIDE §5 answering "which layer do I use?"
before the eight subsections begin. No builder, parser, or Art. 10 row
changes. This also removes the current defect where Settings labels
expose raw kind numbers to a researcher who has no use for them.

**Tension.** Where does the walk ledger's authority sit against
ROADMAP's per-phase markers? ROADMAP:1473 and :1688 still advertise the
Phase 16 and 19 walks as pending, which JOURNAL 2026-08-02 records as
fixed — the sweep written to fix that exact defect was itself
incomplete.

**Resolution.** The ledger is authoritative and ROADMAP markers are
narrative. Correct the two lines, note in JOURNAL that the correction
sweep was itself incomplete (that is the second occurrence, which by
continuous-improvement's own Standard 2 licenses machinery rather than
another sweep), and add the same-file contradiction guard: ROADMAP must
not contain "smoke run pending" or "SMOKE walk pending" while its
summary asserts no section walk is outstanding.

---

## Appendix — per-lens findings with evidence

The synthesis above is the decision layer; this is where the
`file:line` evidence lives. Each lens ran its own discipline Protocol
over the whole tree.

### product-manager

X-Ray is a genuinely capable research instrument whose product
discipline has not caught up with its build velocity — 2513 tests green,
28 feature flags, ~15 wire kinds, and 164 commits since the v0.8.0 tag
with CHANGELOG [Unreleased] reading "Nothing yet." Judged against
non-technical researchers working in groups, three things block a 1.0
outright: there is no way to install it that doesn't involve Chrome
Developer mode or a Firefox add-on that vanishes on restart; the group
story has never been exercised by two actual people
(docs/EPISTACK_RUNBOOK.md §5 simulates the second investigator by
profile-switching on one machine, and docs/EPISTACK_ENTRY.md:440 still
reads `TBD` for its evidence) while the only follow-based surface ships
default-off; and the sanctioned way to collaborate or back up hands the
user an unencrypted file full of private keys. The "bolted on" feeling
the maintainer names is measurable and specific: 8 of 28 flags are never
read by any `isEnabled()` call, the entire Phase-9a
crowdsourced-metadata layer (kinds 30050–30053 + 9803) has builders,
tests, portal type labels, a USER_GUIDE table and an Art. 10 "active"
listing but zero callers in `src/`, and three shipped features are
reachable only by editing `chrome.storage.local` from DevTools. The
deeper cause is that not one of the eleven `docs/*KICKOFF*.md` files
carries a success criterion, a check date, or a kill condition — so
nothing has ever been scheduled for the promote-or-kill decision that
consolidation requires, and seven default-off flags appear zero times in
docs/JOURNAL.md.

**Blockers**

- **No installation path a non-technical user can complete or keep**
  *(L, user-visible)*
- Evidence: README.md:206-243 (Option A: `chrome://extensions` →
    Developer mode → Load unpacked; Option B: git clone + npm build).
    CONTRIBUTING.md:170-175 describes Chrome Web Store / Firefox AMO
    upload as a post-release manual step; no store link exists anywhere
    in the repo. manifest.json ships `<all_urls>` host permissions plus
    a document_start MAIN-world content script.
- Why 1.0: The stated audience is researchers who did not build the
    tool. Developer mode carries a permanent Chrome nag and is
    off-limits on many managed machines; a Firefox temporary add-on is
    unloaded on every browser restart, so a non-technical Firefox user
    loses X-Ray — and their working context — daily. A tool that cannot
    be installed and kept cannot support anyone's research.
- Fix: Decide the 1.0 delivery channel before tagging: Chrome Web Store
    listing (or a documented enterprise/self-hosted CRX path) and an
    AMO-signed XPI. The `<all_urls>` + csp-strip + MAIN-world surface
    will draw store review — budget a review round and write the
    permission justifications first (see the THREAT_MODEL gap below). If
    store listing is refused on principle, say so in the README and ship
    a signed XPI plus an explicit "this is developer-mode software"
    statement, so the audience claim matches the delivery.
- **The group workflow has never been exercised by two people on two
  machines** *(M, user-visible)*
- Evidence: docs/EPISTACK_RUNBOOK.md §5 "Second-investigator
    walkthrough" instructs the *same* operator to "Start fresh
    workspace", create a second profile, and restore afterwards.
    docs/EPISTACK_ENTRY.md:440 — "Evidence: `TBD` — screenshots + …" —
    was never filled in. `networkPage`
    (src/shared/metadata/feature-flags.js:147) defaults false with the
    comment "the surface ships default-off while the phase is in
    flight", and the string `networkPage` appears 0 times in
    docs/JOURNAL.md. Same for `reviewCoordination`,
    `followListPublishing`, and `platformAccountPublishing`: 0 JOURNAL
    mentions each.
- Why 1.0: "To do so together in groups" is the mission's second half,
    and the only evidence the collaboration path works is one person
    impersonating two on one profile. Profile-switching cannot surface
    the failures groups actually hit — relay divergence between
    machines, two people holding the same entity key, one member's
    clock, a follow that resolves for one and not the other. Shipping
    1.0 on that evidence means the group audience discovers the defects.
- Fix: Run one real two-machine, two-person walk end to end on a live
    case before tagging: A publishes claims + a verdict, B follows A's
    npub, pulls, incorporates as proposals, publishes a contrary
    judgment, A sees it side by side. Record the outcome in
    docs/JOURNAL.md whatever it shows. Then decide `networkPage`'s
    default on that evidence — it is either the 1.0 collaboration
    surface (default on, documented, walked) or it is not shipped.
- **The prescribed collaboration and backup files carry unencrypted
  private keys** *(M, user-visible)*
- Evidence: src/shared/case-bundle.js:1-15 — "A bundle carries a case
    entity and every entity its claims reference — INCLUDING their
    private keys… Treat bundle files like nsec backups: anyone holding
    one can sign as those entities." No `encrypt`/`nip44`/`password`
    token appears anywhere in case-bundle.js or src/shared/backup.js.
    docs/USER_GUIDE.md §2.6 instructs every user: "Make a full backup
    before anything risky… Treat the file like an `nsec`, because it
    contains yours."
- Why 1.0: Groups will move the collaboration bundle the way groups move
    files — email, Slack, Drive. The guide's mitigation is a sentence
    telling a non-technical user to treat a JSON file like a
    cryptographic secret, which is precisely the instruction that
    audience cannot act on. The routine hygiene step the guide
    prescribes (full backup) drops an unprotected nsec in the Downloads
    folder.
- Fix: Add optional passphrase encryption to both the case bundle and
    the full backup (the repo already ships NIP-44 v2 in
    src/shared/crypto.js, so the primitive exists). Default the
    collaboration bundle to encrypted and make the passphrase prompt
    part of the export flow, not an advanced option. Hand the mechanism
    design to security-threat-modeler; this finding is about the
    audience-fit of the current default, not the crypto choice.
- **Three shipped features can only be turned on from the DevTools
  console** *(S, user-visible)*
- Evidence: `reviewCoordination` has live gates at
    src/portal/inspector.js:404 and src/network/index.js:798;
    `extractionAnalysisPublishing` at
    src/portal/extraction-block.js:137; `storeFirstPublish` at
    src/shared/publish-gate.js:102 and src/reader/index.js:5514 — none
    has a checkbox in src/options/options.html (no matching `pref-` id).
    docs/SMOKE_TEST.md §Phase 29 instructs: "set `storeFirstPublish` in
    the `xray:flags` storage key from the SW console (no Options toggle
    yet)". docs/USER_GUIDE.md §2.5 states the general rule: "the rest
    are flipped in DevTools via the `chrome.storage.local` key
    `xray:flags`".
- Why 1.0: For the 1.0 audience, DevTools-only is indistinguishable from
    unshipped — except that it costs carrying surface, documentation,
    and review attention anyway. `extractionAnalysisPublishing` is the
    sharpest case: it gates a *publish* path for kind 30070 whose whole
    safety argument (the 2026-07-29 whole-unit disclosure posture) rests
    on the user making an informed disclosure decision, and the only way
    to make it is by hand-editing storage.
- Fix: For each of the three: add an Options control with its
    disclosure, or record a kill/park in docs/JOURNAL.md. Do not ship a
    fourth. Then make the rule machine-checked (see machine_enforceable
    #4).
- **The moral lens cannot be used without the browser console, and ships
  zero jurisdictions** *(L, user-visible)*
- Evidence: docs/USER_GUIDE.md §5.8 states it plainly: "the moral lens
    is authored and driven partly from the browser console today, not a
    finished point-and-click UI." `jurisdiction` appears in
    src/options/options.html only inside the flag's descriptive prose
    (lines 490-501) and in src/reader/index.html only on the run button
    (line 147) — there is no authoring surface.
    src/shared/jurisdiction-model.js:53 defines the `lens_jurisdictions`
    storage key; CLAUDE.md notes "the local jurisdiction registry… zero
    built-ins". `moralLens` appears once in docs/JOURNAL.md.
- Why 1.0: The feature is required-input-empty by design: it does
    nothing until the user authors a jurisdiction, and there is no way
    to author one except the console. A non-technical user who enables
    the flag and pays for an API key gets a button that cannot produce a
    reading. That is worse than the feature being absent, because it
    consumes a flag, an Options block, a reader section, seven shared
    modules, and a guide section.
- Fix: Either build the jurisdiction authoring UI (a registry editor
    with citation + capped-excerpt rows, mirroring the entity editor)
    and walk it on one real case, or retire the lens for 1.0 on the
    record per Art. 3 — code stays git-recoverable, 30066 stays free and
    guard-tested, docs/MORAL_LENS_JURISDICTION_DESIGN.md keeps the
    design. Do not ship it as-is with a "Reality check" note.
- **The only user-facing document omits whole shipped surfaces and
  documents dead ones** *(M, user-visible)*
- Evidence: docs/USER_GUIDE.md contains no match for `aiVision`,
    `Describe images`, `extraction`/`30070`, `merge` (as the backup
    Import & merge path), `Opinion`, `Shared-text`, `known-unknowns`, or
    `Cross-coverage` — all shipped surfaces (AI vision 2026-07-29; the
    MA.1–MA.7 map-artifact wave 2026-07-24/25; MA.7 merge-import
    2026-08-02; R5 opinion modules and R8 shared-text scan 2026-08-02).
    §2.6 claims "Three tools" for backups while src/options/options.html
    offers four buttons including "Import & merge…". Meanwhile §2.5's
    flag table documents `factchecks`, `ratings`, `helpfulnessVoting`,
    `bridgingRanking`, `transitiveTrust`, `annotations` and `topicTrust`
    as real gates on features that have no caller (see kill candidates),
    and omits `aiVision`, `localTranscription`, `transcriptClaimDrafts`,
    `storeFirstPublish`, `extractionAnalysisPublishing` — 5 of 28 flags.
- Why 1.0: The maintainer's goal names documentation of "all of its
    inner and outer workings". The USER_GUIDE is the only outer-facing
    document and it is simultaneously incomplete (a user cannot discover
    Describe images or the extraction review queue from it) and
    misleading (it teaches a fact-check/rating vocabulary the tool
    cannot produce). A guide a user can be wrong-footed by is worse for
    this audience than a short one.
- Fix: Before tagging: add sections for AI vision, the durable
    extraction layer + its review surfaces + kind 30070, backup Import &
    merge, the opinion module family, and the shared-text scan; delete
    the dead-flag rows from §2.5 and add the five missing ones. Then
    bind guide and code together with machine_enforceable #3 so the
    table cannot silently drift again.
- **The project's front door misstates what has shipped** *(S,
  user-visible)*
- Evidence: `git log --oneline v0.8.0..HEAD | wc -l` = 164, while
    CHANGELOG.md:11-13 reads "## [Unreleased]" / "Nothing yet."
    README.md:19 states "**v0.7.0** (tagged 2026-07-16)" while `git tag`
    shows v0.8.0 (2026-07-20) as the newest. manifest.json declares
    version 0.8.0. The README Status section then describes the product
    entirely in build-history vocabulary — "Phases 10–11", "Phase 12",
    "Phase 13", "Phase 14.5", "Phase 25", "post-28" — sixteen phase
    references before a reader learns what to do first.
- Why 1.0: A researcher evaluating whether to trust their casework to
    this tool reads README and CHANGELOG first. Both currently tell them
    the project is at a version it passed three weeks and 164 commits
    ago, and describe its capabilities by the internal numbering of its
    own construction. Neither answers "what is this for, and what do I
    do on day one?"
- Fix: Backfill CHANGELOG [Unreleased] from the 164 commits (the JOURNAL
    headings are the source), correct the README Status to the real tag,
    and rewrite the Status/Features sections around user jobs (capture a
    source, structure it, judge it, publish it, work a case, work with
    others) with phase numbers demoted to ROADMAP. Fix the one
    user-visible phase leak in the UI at src/options/options.html:204
    ("Enable the Network page (Phase 25)").
- **No shipped feature has a recorded success criterion, check date, or
  kill condition** *(M)*
- Evidence: Grepping all eleven docs/*KICKOFF*.md for "check date",
    "kill criteria", "success criteria", or "non-goals" returns matches
    only in EPISTEMIC_AUDIT_KICKOFF.md (two incidental "non-goals"
    mentions at :306 and :341). docs/ENTITY_PAGE_KICKOFF.md — the house
    exemplar for problem framing — has sections 1-6 (Diagnosis / Design
    / Guard rails / Slices / Costs / Deferred) and none of the three.
    Seven default-off flags (`captureAutomation`, `reviewCoordination`,
    `followListPublishing`, `networkPage`, `platformAccountPublishing`,
    `truthAdjudicationPublishing`, `storeFirstPublish`) appear 0 times
    in docs/JOURNAL.md.
- Why 1.0: This is the mechanism that produced the "bolted on features"
    the maintainer names. With agents authoring all PRs, building is
    nearly free and nothing ever comes due, so surfaces accrete and each
    one silently spends the only scarce resource — maintainer attention.
    The repo has already paid for this once (the Phase-19 fact layer,
    JOURNAL 2026-07-20: "too stringent to be useful"; ripped out after
    passing every acceptance demo). Consolidation is impossible without
    a ledger of what was supposed to prove itself and by when.
- Fix: Before tagging, write one flag ledger (a table in ROADMAP or a
    new docs/FLAG_LEDGER.md) with a row per FLAGS_DEFAULTS key: what
    casework problem it serves, what would falsify it, a check date, and
    today's disposition — promote / hold-with-rationale / kill. The
    dead-flag and DevTools-only findings above are its first eight and
    three rows. Adopt the PM skill's own graduation clause for new
    kickoffs (machine_enforceable #6).

**Should fix**

- **The companion auth-token field displays its stored secret in
  plaintext on every load** *(S)* — src/options/index.js:1208 —
  `document.getElementById('pref-transcriber-token').value = await
  llmRawGet(TRANSCRIBER_TOKEN_STORAGE);` — sits directly above the
  comment at :1209-1210 stating the opposite rule ("never the key VALUES
  — the LLM-key rule: the DOM only ever learns whether one is set"),
  which the AssemblyAI/Deepgram fields at :1216-1219 obey. The input is
  `type="text"` (src/options/options.html, Transcription block).
  docs/JOURNAL.md 2026-08-08 records the maintainer having pasted a
  Hugging Face token into exactly this field. → Switch to
  `type="password"`, stop echoing the value, and mirror the LLM-key
  pattern: a "A token is saved on this device" status line plus a Clear
  button. The JOURNAL entry proves users mis-target this field; once
  mis-targeted, the wrong secret is then rendered in cleartext on every
  Options open — a real hazard in a screen-shared or over-the-shoulder
  group session.
- **ROADMAP still advertises the Phase 16 and 19 walks as pending, the
  exact defect JOURNAL 2026-08-02 declared fixed** *(S)* —
  docs/ROADMAP.md:1473 — "## Phase 16 — Moral-lens evaluation
  (lens-readings) ✅ shipped — smoke run pending" — and :1688 — "§Phase
  19 SMOKE walk pending (manual)." docs/JOURNAL.md 2026-08-02 ("The
  Phase 16/19 walks were done; only the docs said otherwise") states
  both walks were run and that "no section walk is outstanding", and the
  ROADMAP snapshot at the top of the same file agrees. → Correct both
  lines. The JOURNAL entry itself names the cost — "a completed manual
  step that goes unrecorded is indistinguishable from one never
  performed" — and the same sweep that fixed Phases 11/12/15 missed 16
  and 19, which is evidence the manual sweep is unreliable and the
  ledger below is owed.
- **The pending-walk ledger the PM check-date sweep depends on does not
  exist** *(S)* — .claude/skills/verification-engineer/SKILL.md:136-151
  designates "the top of docs/SMOKE_TEST.md" as the canonical
  verification-debt ledger and states "The ledger does not exist yet".
  docs/SMOKE_TEST.md:1-30 opens with the setup block; no ledger section
  is present. → Create it before the 1.0 tag with the walks actually
  performed and their dates (0.8.0 walk 2026-07-20; Phases 11-16 and 19;
  the companion panel C.1-C.7 on 2026-08-08). Until it exists, the PM
  release sweep has no source of truth and ROADMAP markers get treated
  as evidence — which they demonstrably are not.
- **SMOKE_TEST and esbuild.config.mjs both assert seven bundles and 1277
  tests; the truth is ten and 2513** *(S)* — docs/SMOKE_TEST.md:25-26 —
  "npm run build # produces dist/*.bundle.js (7 bundles)" / "npm test #
  1277/1277 should pass". Row 0.1 at :195 asserts "✅ all seven bundles
  emitted under `dist/` (content, background, options, sidepanel,
  reader, portal, api-interceptor)". esbuild.config.mjs:3-11 carries the
  same seven-bundle header. `grep outfile: esbuild.config.mjs` shows six
  literal outfiles plus a templated loop; `npm test` reports 2513 pass.
  → Update both to name all ten bundles (network, pdf-engine, pdf.worker
  are missing) and drop the hard-coded test count in favor of "all
  green". As written, smoke row 0.1 passes while three bundles go
  unverified — the check is structurally blind to exactly the newest
  surfaces.
- **The map-artifact wave has no manual walk anywhere in SMOKE_TEST**
  *(M)* — Grepping docs/SMOKE_TEST.md for `MA.` / `map-artifact` /
  `Extraction` returns only row 18.6b (a PDF extraction-quality banner).
  The wave shipped MA.1-MA.7 across 2026-07-24 to 2026-08-02 (JOURNAL
  entries at :647, :737, :1112, :1178, :1233, :1297, :1332, :1367): the
  durable `article-extractions` store (`xray-audits` v7), review
  surfaces in the case dashboard and reader, span-dedup across two
  producers, backup merge-import, and kind 30070 publishing. → Add an MA
  section covering the fold/merge on re-run, the reader and dashboard
  review queues, Accept minting a real claim, merge-import accrual + its
  refusal report, and the 30070 publish disclosure. This is the largest
  recent surface and the one with the most persisted state;
  verification-engineer owns placing the observer, but the debt should
  be named before a 1.0 tag.
- **Every screenshot in the user guide is a placeholder** *(S)* —
  docs/USER_GUIDE.md:19-22 — "Screenshots are referenced inline as
  `[SCREENSHOT-nn]`… They are placeholders — a human with a browser
  fills them in." The Appendix shot list enumerates 14, with the note
  "~30 min total" for the extension surfaces. → Take the 14 shots.
  Thirty minutes of the maintainer's time is the cheapest legibility
  purchase available for a non-technical audience, and the guide's own
  appendix already specifies each frame. Blur the key field in shot 04.
- **Three separate portal destinations exist for looking at one person**
  *(M)* — src/portal/index.js routes `entity-dossier` (:894), `entity`
  (:901), and `entity-corpus` (:916) to three different renderers.
  src/portal/entity-view.js:70-83 puts "Open dossier" and "Entity
  corpus" side by side; the code comments explain the distinction ("the
  full dossier is the local-first field/provenance view; this spokes
  view stays the published-corpus graph"; "E5: the wire-first corpus
  view"). docs/USER_GUIDE.md §7 documents "Entity view" and "Entity
  page" but never mentions the entity-corpus destination. The side panel
  adds a fourth entity surface. → Collapse to one entity destination
  with tabs (Graph / Dossier / What the network holds). The distinction
  between the three is a distinction about data provenance that only the
  author holds; for a researcher it reads as three buttons that show
  overlapping things.
- **Settings opens on the Relays tab; the first-run welcome lives on a
  tab the user has not clicked** *(S)* — src/options/options.html:23
  marks the Relays tab `xr-opt__tab--active` by default; the "Welcome to
  X-Ray. Pick a signing method below." banner is at :64-69 inside the
  Signing section. The Relays tab presents a `wss://` URL table with
  read/write/enabled columns as the first thing a new user sees. →
  Default the Options page to Signing when no identity is configured. A
  relay table with WebSocket URLs is a reasonable first screen for the
  person who wrote the relay pool and an incomprehensible one for a
  researcher on day one.
- **The Options page steers users to a Node CLI for epistemic audits
  that the extension already runs in-browser** *(S)* —
  src/options/options.html:351-356 — "Run the companion scorer CLI
  (`docs/auditor-prototype/scorer/`) against a captured article, then
  import its JSON here." The reader ships Quick audit and Thorough audit
  buttons (src/reader/index.html:124-125) that run the same family
  in-extension, documented in USER_GUIDE §5.6. → Remove the CLI
  instruction from the Options UI (keep the prototype in docs/ as
  provenance) and point the hint at the reader's audit buttons. As
  written, the settings page tells a non-technical user their path to
  audits is a command-line tool.
- **The reader's 13-glyph vocabulary is unlabeled in the UI and legible
  only from the guide** *(S)* — docs/USER_GUIDE.md §4.5 "The reader icon
  legend" is a 9-row table covering ⭐ 🔗 ⚖/⚖✓ 🏛/🏛✓ ⚠ 🌐 📋 and the
  five entity glyphs — supplied by the guide precisely because the
  interface does not label them. src/reader/index.html carries up to 13
  header buttons, most emoji-led with only `title` attributes. → Add a
  persistent in-reader legend (a `?` popover over the claims bar) or
  text labels beside the glyphs. A legend that lives only in a 1234-line
  document is a legend the target user will not have open.
- **docs/ holds 49 markdown files with no index, and the one user-facing
  document sits among them** *(S)* — `ls docs/` lists 49 .md files plus
  two subdirectories; there is no docs/README.md or docs/INDEX.md.
  USER_GUIDE.md (1234 lines) sits beside CONSTITUTION.md, JOURNAL.md
  (8715 lines), fifteen design docs, eleven kickoffs, and six EPISTACK_*
  competition-entry documents. → Add docs/README.md splitting the set
  into "For people using X-Ray" (USER_GUIDE, CAPTURE_GUIDE,
  troubleshooting), "How it decides things" (CONSTITUTION, PHILOSOPHY,
  DISCIPLINES), and "How it was built" (ROADMAP, JOURNAL, designs,
  kickoffs, EPISTACK). The maintainer's goal names inner *and* outer
  workings; today they are indistinguishable from the directory listing.
- **api-pattern.js is a hand-maintained duplicate whose test pins the
  copy, not the code that runs** *(S)* — src/shared/api-pattern.js:1-9 —
  "the MAIN-world api-interceptor (`src/page/api-interceptor.js`)
  re-implements the same logic inline (it can't import — it's bundled as
  an IIFE)… if behavior diverges between the two, the test for *this*
  one catches it as a regression even when the inline copy is the actual
  code that ran in the page." The module is imported by nothing in src/
  (only tests/api-pattern.test.mjs). → Either make api-interceptor.js
  import it through the build (esbuild can inline a module into an IIFE
  entry point) or add a guard asserting the two implementations' rule
  tables are byte-identical. As written, tests/api-pattern.test.mjs can
  be green while Facebook/Instagram/YouTube capture is broken — the
  exact false-confidence shape the JOURNAL calls "an invariant assumed
  rather than enforced" (2026-07-25).

**Kill candidates**

- **The entire Phase-9a crowdsourced-metadata layer: kinds 30050
  Annotation / 30051 FactCheck / 30052 Rating / 30053 TopicTrust / 9803
  HelpfulnessVote, plus src/shared/metadata/ranker.js and
  src/shared/metadata/topic-trust-builder.js** — `buildAnnotationEvent`,
  `buildFactCheckEvent`, `buildRatingEvent`, `buildHelpfulnessEvent`
  (src/shared/metadata/builders.js:123, :234, :331, :388) and
  `buildTopicTrustEvent` (topic-trust-builder.js:28) have zero callers
  anywhere in src/. ranker.js and topic-trust-builder.js are imported by
  no module in the tree. The layer was scaffolded in Phase 9a
  (feature-flags.js:7-10: "Flipping `factchecks: true` in 9b becomes a
  UI-surface change") — 9b never came, and Phase 11 explicitly
  superseded the idea (ROADMAP:964-969: "10.5 Metadata reframe —
  superseded by Phase 11… the responses-to-claims idea becomes the
  assessment primitive"). Assessments (30054) are what the casework
  actually pulls. *(cost of keeping: CONSTITUTION Art. 10:416 lists
  30050-30053 as **active** in the wire covenant — a public promise to
  strangers that nothing fulfils, and 9803 is absent from the table
  entirely. src/portal/library.js:69-73 renders type labels for
  Annotation / Fact-check / Rating / Topic trust / Vote that a user can
  never populate, and src/portal/corpus.js:40 queries them as "dormant
  metadata kinds (flag-gated writers)" whose writers do not exist.
  docs/USER_GUIDE.md §2.5 teaches six of the dead flags as real.
  Retiring is cheap and precedented: JOURNAL 2026-07-01 removed the
  vestigial Entities + Keypair Registry tabs after "A user found them
  ('these seem to do nothing')". Retirement means Art. 10 rows move to
  `retired — never reuse`, not deletion of the record.)*
- **The eight FLAGS_DEFAULTS entries no code reads: annotations,
  respondsTo, topicTrust, factchecks, ratings, helpfulnessVoting,
  bridgingRanking, transitiveTrust** — Grepping every `isEnabled(...)`
  call site in src/ shows these eight are never queried; only
  `trustGraphFilter` among the Phase-9a set is live
  (src/network/index.js:811). `bridgingRanking` and `transitiveTrust`
  are labeled in the guide as "Experimental ranking/trust (not yet
  shipped)" — v2/v3 placeholders from April. Note precisely: the
  `respondsTo` *tag* is live (src/shared/event-builder.js:261-263 reads
  `article.respondsTo`); only the flag is dead. *(cost of keeping: Eight
  of 28 flags — nearly a third of the surface PM Standard 7 is supposed
  to govern — are noise, which makes the real promote-or-kill questions
  harder to see and makes any flag ledger start out lying. They also sit
  in the user guide's flag table as instructions.)*
- **The moral lens (Phase 16): lens-taxonomy.js, jurisdiction-model.js,
  lens-schemas.js, lens-prompt.js, lens-engine.js,
  reader/lens-section.js, the `moralLens` flag, the Options block and
  the reader bar** — It ships zero jurisdictions and has no authoring UI
  for the one input it requires; USER_GUIDE §5.8 concedes it is
  "authored and driven partly from the browser console today". It has
  one mention in 8715 lines of JOURNAL. Under the fact-layer test the PM
  discipline names — "if real corpora never feed this within N cases, it
  retires" — it is the strongest candidate in the tree: six shared
  modules, a reader section, an Options block, a guide section, and a
  smoke section, with no evidence any case has fed it. *(cost of
  keeping: It is a visible, enabled-by-checkbox feature that cannot
  produce output for the 1.0 audience, and every doc pass, review round,
  and release walk pays for it. Retiring it is fully reversible: the
  code is git-recoverable, 30066 stays free and guard-tested
  (tests/constitution-guards.test.mjs:216), and
  docs/MORAL_LENS_JURISDICTION_DESIGN.md preserves the design. If it is
  instead kept, it needs a jurisdiction editor and one real casework use
  before 1.0 — not a 'Reality check' note.)*
- **`transcriptClaimDrafts` — the LM Studio local suggest post-pass,
  with its base-URL and model text fields in Settings** — One JOURNAL
  mention. It is a third parallel LLM configuration surface (Anthropic
  key + the Python companion + an LM Studio server on localhost:1234),
  duplicating what ✨ Suggest already does through the same review modal
  — the Options hint at src/options/options.html:645-660 says as much:
  "opens the same review modal as ✨ Suggest". *(cost of keeping: For a
  non-technical user, Settings → Advanced already presents three
  unrelated local-service setups. This one asks them to install and run
  a separate LLM server to get a capability they already have. If kept,
  it should live behind the companion section as an advanced sub-option
  rather than a peer flag with its own free-text URL field.)*
- **The `entity-corpus` portal view (src/portal/entity-corpus-view.js,
  reached via the "Entity corpus" button at
  src/portal/entity-view.js:78)** — It is the third destination for one
  person, distinguished from "Open dossier" only by data provenance
  (wire-first vs local-first), and it appears nowhere in
  docs/USER_GUIDE.md §7, which documents "Entity view" and "Entity page"
  only. *(cost of keeping: Undocumented navigation the user can reach
  but not interpret. Fold it into the dossier as a "What the network
  holds" tab, or retire it — the portal already reconciles local against
  relay everywhere else.)*
- **The auditor-prototype scorer CLI as a user-facing instruction
  (src/options/options.html:351-356)** — The in-extension auditor (Quick
  / Thorough, src/reader/index.html:124-125) superseded the CLI path in
  Phase 14.5. The Options page still presents the CLI as the way to
  produce an audit. *(cost of keeping: It sends the 1.0 audience to a
  Node command line for a feature that runs in their browser. Keep
  docs/auditor-prototype/ as provenance; delete the instruction from the
  UI.)*
- **`captureAutomation` as a user-facing Settings checkbox
  (src/options/options.html:532-548)** — It exists solely so the
  `.claude/skills/xray-capture` driving agent can trigger captures by
  navigation; the Options hint says so ("Leave off unless an agent
  session is driving"). It has 0 JOURNAL mentions. *(cost of keeping:
  Low — it is genuinely useful to the maintainer and cheap. But it is a
  row in a Settings page that a non-technical researcher will read and
  not understand, in a section already carrying seventeen switches.
  Consider moving it under a clearly-marked "Developer / agent"
  subsection rather than beside the publishing disclosures.)*

**Doc gaps**

- docs/THREAT_MODEL.md does not exist, though
  .claude/skills/security-threat-modeler/SKILL.md:65-72 makes it
  Standard 1 and its Protocol step 1 says the absence "is itself the
  report's first finding". For a tool whose users may be doing
  adversarial research in groups, there is no written statement of what
  it protects, from whom, or how.
- No user-facing explanation of why X-Ray needs `<all_urls>` host
  permissions plus a `document_start` MAIN-world content script on every
  page (manifest.json content_scripts) and a CSP-stripping
  declarativeNetRequest rule. The README's Permissions section is
  developer-oriented; a non-technical user installing this is granting
  read access to every page they visit with no plain-language account of
  it.
- docs/USER_GUIDE.md has no coverage of AI vision ("Describe images",
  shipped 2026-07-29), the durable per-article extraction layer and its
  review queues (MA.1-MA.7), kind 30070 ExtractionAnalysis publishing,
  backup Import & merge (MA.7), the opinion module family (R5,
  2026-08-02), the shared-text / wire-copy scan (R8), speaker
  identification (2026-08-01), or the corpus known-unknowns /
  cross-coverage / references blocks.
- docs/USER_GUIDE.md §2.5's flag table omits five real flags
  (`aiVision`, `localTranscription`, `transcriptClaimDrafts`,
  `storeFirstPublish`, `extractionAnalysisPublishing`) and documents
  seven dead ones as if functional — the table is simultaneously
  incomplete and misleading, which is the worst state for the document
  that is supposed to be authoritative about gating.
- CHANGELOG.md [Unreleased] reads "Nothing yet." across 164 commits
  since v0.8.0 — the user-facing record of what changed has been silent
  for the entire period covering the map-artifact wave, AI vision, cloud
  transcription, the constitution, the dev-process skills, and
  store-first publish.
- README.md:19 states the current version as v0.7.0 when v0.8.0 is
  tagged and manifest.json declares 0.8.0; the Status and Features
  sections describe the product in internal phase numbering rather than
  user jobs.
- docs/ has 49 markdown files and no index, so a new user cannot tell
  USER_GUIDE.md (for them) from CONSTITUTION.md (governance),
  CASE_SYNTHESIS_DESIGN.md (internals), and EPISTACK_ENTRY.md (a
  competition submission).
- There is no "first ten minutes" path: no getting-started walkthrough,
  no worked example case a newcomer can open, no guided first capture.
  USER_GUIDE §1-2 is setup reference, not onboarding, and the extension
  itself has exactly one onboarding artifact (the signing-method banner
  at src/options/options.html:64-69, on a tab the page does not open
  to).
- docs/CONSTITUTION.md Art. 10's kind schedule (:411-428) lists
  30050-30053 as `active` while nothing in src/ emits them, and omits
  kind 9803 entirely though src/shared/metadata/builders.js:388 defines
  its builder and src/portal/corpus.js:40 queries it. The wire covenant
  is the project's promise to strangers; it should not overstate.
- docs/SMOKE_TEST.md's setup block (:25-26, :195) states 7 bundles and
  1277 tests against a reality of 10 bundles and 2513 tests — and
  esbuild.config.mjs:3-11 carries the same stale seven-bundle inventory
  in its own header.

**Machine-enforceable candidates**

- Guard test: every key in FLAGS_DEFAULTS
  (src/shared/metadata/feature-flags.js) is read by at least one
  `isEnabled('<key>')` call site under src/ — fails today on
  annotations, respondsTo, topicTrust, factchecks, ratings,
  helpfulnessVoting, bridgingRanking, transitiveTrust.
- Guard test: the inverse of the existing Art. 10 check at
  tests/constitution-guards.test.mjs:201 — every kind marked `active` in
  the CONSTITUTION Art. 10 schedule has at least one emission site in
  src/, and every kind emitted in src/ appears in the schedule. Fails
  today on 30050-30053 (active, unemitted) and 9803 (emitted-builder,
  unlisted).
- Guard test: the FLAGS_DEFAULTS key set and the docs/USER_GUIDE.md §2.5
  flag-table row set are equal — no flag undocumented, no documented
  flag absent from code.
- Guard test: every default-off flag with a live `isEnabled` call site
  has a matching control id in src/options/options.html, or appears in
  an explicitly enumerated DevTools-only allowlist inside the test
  carrying a dated rationale. Fails today on reviewCoordination,
  extractionAnalysisPublishing, storeFirstPublish.
- CI check: when HEAD is more than N commits ahead of the newest `v*`
  tag, CHANGELOG.md's [Unreleased] section must be non-empty ("Nothing
  yet." fails).
- Guard test (the PM skill's own stated graduation clause, once two
  post-2026-08-04 kickoffs exist): every docs/*KICKOFF*.md dated after
  adoption contains a problem/diagnosis section, a success-criteria
  section carrying a check-date line, a kill-criteria section, and a
  non-goals section.

### architect

The four-context skeleton is in better shape than the tree's size
suggests: the content bundle's import closure is 35 modules and
correctly excludes nostr-client/llm-client (Standard 6 holds), kind
literals are confined to the builder and *-publish modules (Standard 4
holds), the MAIN-world files under src/page/ have zero imports/exports
(Standard 2's island rule holds), and all 2513 tests pass in 7 seconds.
What has eroded is everything the skeleton was supposed to protect: the
xray:* bus has grown to 42 service-worker handlers plus 4 content-script
ones in a single 900-line if-chain with no registry and no guard,
CLAUDE.md:98-104 names 16 of them as "e.g."; src/reader/index.js is
7,811 lines with a 1,573-line publish() (5543-7115) that orchestrates
roughly fifteen kinds; and the description layer that a stranger boots
from is wrong in three load-bearing places at once (esbuild.config.mjs:3
says seven bundles where ten are built,
src/page/api-interceptor.js:14-19 denies the manifest injection model
that manifest.json actually uses, README:406 claims 2100 tests). The
single most damaging finding for the 1.0 audience is that the Phase-29.1
publish choke point ships the right answer — gatePublish returns
confirmedOk — and four of its five callers throw it away and re-wrap as
resp.ok, so the portal still writes a durable publishedAt and prints
"Published — readable in any NOSTR client" when zero relays confirmed;
JOURNAL 2026-08-02 named those exact files and said the fix "cannot be
forgotten by the next surface", and it was. Layered on top: three
shipped features (including the kind-30070 publish path) have no Options
control at all and USER_GUIDE §2.5 tells the user to open DevTools, and
networkPage — the only group-work surface — is still default-off "while
the phase is in flight" though ROADMAP:1914 marks Phase 25 COMPLETE.
"Bolted on" is not a vibe here; it is locatable, and it clusters at
three seams: the reader entry point, the Options flag surface, and the
publish result contract.

**Blockers**

- **The publish gate returns `confirmedOk`; four of five call sites
  discard it and stamp "published" on `resp.ok`** *(S, user-visible)*
- Evidence: src/shared/publish-gate.js:126,141 returns `{results,
    confirmedOk, journaled}`. Only src/portal/extraction-block.js:226
    reads it. src/portal/entity-page-block.js:420-425 rewrites it as
    `resp = {ok: true, results: gated.results}` then writes durable
    `publishedAt` + `publishedEventId`;
    src/portal/synthesis-block.js:582-589 prints "Published — the
    article is readable in any NOSTR client";
    src/portal/inspector.js:441-445 prints "Review requested ✓";
    src/portal/entity-dossier-view.js:146. docs/JOURNAL.md 2026-08-02
    "The MA.6 browser walk found a false 'published' stamp" names
    entity-page-block.js, synthesis-block.js, inspector.js and
    network/index.js by file and concludes "a single choke point
    returning 'confirmed or not' is the fix that cannot be forgotten by
    the next surface".
- Why 1.0: A researcher sharing work with a group is told the artifact
    is on relays when nothing confirmed. Unlike the maintainer, they
    cannot open the SW console or a relay explorer to check. The local
    record then says published, so no retry ever happens and the work is
    silently lost to the group.
- Fix: At each gatePublish call site, key the durable write and the
    success string on `gated.confirmedOk`, with an explicit "sent to N,
    none confirmed" branch (the extraction-block.js:208-226 shape). Then
    add the source-literal guard that pins the ordering, matching the
    guard already written for MA.6.
- **Three shipped features have no Options control; DevTools is the
  documented way in** *(S, user-visible)*
- Evidence: src/shared/metadata/feature-flags.js:153
    (`reviewCoordination`), :187 (`storeFirstPublish`), :206
    (`extractionAnalysisPublishing`) are all default-false and read in
    production (src/network/index.js:798, src/portal/inspector.js:404;
    src/shared/publish-gate.js:102, src/reader/index.js:5514;
    src/portal/extraction-block.js:137). Grep for
    `review-coordination|store-first|extraction-analysis` across
    src/options/options.html and src/options/index.js returns nothing.
    docs/USER_GUIDE.md:167-171: "the rest are flipped in DevTools via
    the `chrome.storage.local` key `xray:flags`".
- Why 1.0: One of the three gates a published wire kind (30070
    ExtractionAnalysis, CONSTITUTION Art. 10 "active"); another gates
    the durability guarantee that stops a signed event being discarded.
    A non-technical researcher cannot reach any of them. Standard 6 says
    a new surface enters through an entry point, never as a bolt-on —
    these landed without extending the Options seam.
- Fix: Add the three checkboxes to src/options/options.html and the
    matching isEnabled/setOverride wiring in loadAdvanced/saveAdvanced,
    with the same disclosure-paragraph pattern the neighbouring flags
    use. Then add a guard asserting every non-retired FLAGS_DEFAULTS key
    has a `#pref-*` id in options.html.
- **MAIN-world code is not confined to src/page/ — two more MAIN-world
  payloads are authored inline in the service worker** *(M)*
- Evidence: src/background/index.js:935-978 injects an inline `func`
    into `world: 'MAIN'` that fetches four timedtext URL variants;
    src/background/index.js:1025-1029 injects `captureTranscriptInPage`,
    which patches `window.fetch` in the page. CLAUDE.md:56-60 and the
    architect Standard 2 describe MAIN-world code as exactly two files
    under src/page/. Compounding it, src/page/api-interceptor.js:14-19
    states "this script is NOT auto-injected via manifest
    content_scripts" while manifest.json content_scripts[2] declares it
    at `run_at: document_start`, `world: MAIN` on instagram.com,
    facebook.com, fb.com and youtube.com — and no executeScript in the
    tree loads that file.
- Why 1.0: The page-world boundary is the one X-Ray crosses on every
    Facebook, Instagram and YouTube page a user visits, capture or not,
    and it is the surface SECURITY.md:59-61 calls "the interesting
    parts". Two of its four instances are invisible to anyone reading
    the declared map, and the declared map contradicts the manifest.
    docs/THREAT_MODEL.md does not exist, so there is no place where this
    is reasoned about at all.
- Fix: Move the two inline payloads into named files under src/page/ (or
    state, in one recorded sentence, why an inline SW `func` is the
    correct placement); correct the api-interceptor.js header and
    esbuild.config.mjs to match manifest.json; write
    docs/THREAT_MODEL.md with the four-surface MAIN-world map as its
    first section. Then graduate Standard 2's guard: no `world: 'MAIN'`
    outside src/page/, no import/export inside it.
- **The companion auth token is read back into a visible `type="text"`
  field, against the rule stated two lines below it** *(S,
  user-visible)*
- Evidence: src/options/options.html:624 `<input type="text"
    id="pref-transcriber-token" …>`; src/options/index.js:1208
    `document.getElementById('pref-transcriber-token').value = await
    llmRawGet(TRANSCRIBER_TOKEN_STORAGE);` — immediately followed at
    :1209-1210 by "never the key VALUES — the LLM-key rule: the DOM only
    ever learns whether one is set", which lines 1216-1219 and 1238 then
    honour for the AssemblyAI, Deepgram and Anthropic keys.
    docs/JOURNAL.md 2026-08-08 already records a user pasting a Hugging
    Face token into this exact field.
- Why 1.0: Same panel, same class of secret, two opposite behaviours —
    and the one that leaks is the one a first-time user is most likely
    to mis-fill, as the 2026-08-08 entry documents. A researcher
    screen-sharing Options with their group broadcasts the value.
- Fix: Mirror the sibling fields: `type="password"`, clear the input to
    '' on load, and show presence only via `setKeyStatus` (the pattern
    already at src/options/index.js:1216-1217).
- **`networkPage` — the only group-work surface — is default-off with a
  comment that contradicts the roadmap** *(S, user-visible)*
- Evidence: src/shared/metadata/feature-flags.js:144-147: "the surface
    ships default-off while the phase is in flight".
    docs/ROADMAP.md:1914 reads "Phase 25 — The Network client
    (truth-seeker social layer) ✅ COMPLETE". src/background/index.js:102
    gates the context-menu item on it; src/options/index.js:1183 hides
    the quick-action button on it; docs/USER_GUIDE.md:1055-1057 tells
    the user to enable the flag first.
- Why 1.0: The stated 1.0 goal is researchers working together in
    groups. Following collaborators, the incorporation queue and the
    review queue are the mechanism for that, and a fresh install has
    none of it — the user must find a checkbox under a tab named
    "Advanced" to discover the product's collaboration story exists.
- Fix: Either flip the default and add the Network smoke rows to
    docs/SMOKE_TEST.md, or record in docs/JOURNAL.md the decision that
    1.0 ships collaboration opt-in and say so in USER_GUIDE §1 rather
    than only §2.5. Whichever, reconcile the flag comment with
    ROADMAP:1914 in the same change.

**Should fix**

- **src/reader/index.js is 7,811 lines with a 1,573-line publish() and a
  12-call init()** *(L)* — src/reader/index.js: `async function
  publish()` at :5543 closes at :7115. It imports ~90 modules (:13-105)
  and orchestrates
  30023/30040/30041/30054/30055/30056-30061/30062/30063/30064/30069/32125/32126
  in one body. init() (:7587-7811) calls setupMediaControl,
  setupSpeakersControl, setupSuggestControl, setupPendingSuggestControl,
  setupVisionControl, setupTranscribeControl,
  setupTranscriptClaimDraftsControl, setupAuditRunControl,
  setupLensControl, refreshAuditStatus, refreshExtractionBar in
  sequence. → Extract publish() into per-family selector+emit modules
  under src/reader/publish/ mirroring the existing *-publish.js
  selectors, and replace the init() sequence with a declared control
  registry (id, flag, setup) so a new feature adds a row, not a call.
  Two-way door; no wire or storage effect.
- **The `xray:` prefix names five unrelated namespaces, which is why
  Standard 2's guard cannot be written** *(M)* — Runtime messages
  (`xray:relay:query`), chrome.storage.local keys (`xray:flags`
  feature-flags.js:283, `xray:llm:key` llm-prompts.js:64,
  `xray:transcriber:token` transcriber-client.js:23), session-record
  keys (`xray:article:` background/index.js:523, `xray:audit:draft:`
  reader/index.js:3900, `xray:transcribe:job:` transcribe-flow.js:17,
  `xray:lensread:` lens-engine.js:339), context-menu ids
  (`xray:open-capture` background/index.js:73), and a LocalKeyManager
  slot name (`xray:user` sidepanel/index.js:51) all share the prefix.
  `xray:llm:config` is a message; `xray:llm:key` is a storage key. →
  Adopt a separator convention (e.g. `xray:msg:*` / `xray:key:*` /
  `xray:menu:*`) for new names only, and in the same PR add the
  checked-in message registry the Standard 2 guard needs. Do not rename
  existing storage keys — that is a one-way door under schema-evolution.
- **`xray:forward:*` is an untyped passthrough with exactly one caller**
  *(S)* — src/background/index.js:446-459 forwards `{...message, type:
  message.type.slice('xray:forward:'.length)}` to the active tab for any
  type. The only send site in the tree is src/options/index.js:1690
  `{type: 'xray:forward:xray:capture'}`. The handler's own comment at
  :444 says "historically used by the popup", a surface removed in
  JOURNAL 2026-06-09 "De-FAB: one capture surface". → Replace the one
  caller with a typed `xray:capture:active` handled by
  captureActiveTab() (background/index.js:241), and delete the wildcard
  branch — recorded as a kill in JOURNAL, git-recoverable per Art. 3.
- **Four near-identical config probes duplicate one contract** *(S)* —
  src/background/index.js:696 (`xray:llm:config` → getLlmConfig), :743
  (`xray:vision:config` → getVisionConfig), :754 (`xray:lens:config` →
  getLensConfig), :838 (`xray:llm:corpus-config` → getCorpusConfig) all
  return `{ok, enabled, hasKey, model}` from four functions in
  llm-client.js, consumed at reader/index.js:658,3463,4249,3686 and
  portal/{synthesis-block,hypothesis-block,links-block,entity-page-block}.js.
  → Collapse to one `xray:llm:config` taking a `{feature}` argument,
  keeping the four old types as aliases for one release so no page
  breaks mid-upgrade. Two-way door.
- **The reader special-cases four platforms in its own UI, against the
  declared platform seam** *(M)* — src/reader/index.js:4621-4701
  renderYouTubeHeader, :4707-4775 renderTikTokHeader, :4780-4866
  renderInstagramHeader, :4871-4937 renderFacebookHeader. CLAUDE.md's
  platforms/ note says "Add a new site by adding a handler here + a
  detector case, not by special-casing the UI." → Give each platform
  handler an optional `renderHeader(article)` export returning HTML, and
  have the reader dispatch through platforms/index.js — so the fifth
  platform touches one directory, as the seam promises.
- **Two unreconciled entity-identity custody models ship side by side,
  and neither doc cites the other** *(M)* — Phase 11.8:
  src/shared/case-bundle.js:6-9,122 exports entity `privkey` values;
  sidepanel/index.js:350 "The bundle contains private keys — share it
  like a password". Phase 24: src/reader/index.js:6966-6967 emits the
  kind-30069 OwnedKeys manifest with NIP-26 delegation tags (imports at
  :103). grep of docs/ENTITY_IDENTITY_DESIGN.md for
  "bundle"/"collaborat" returns nothing; docs/USER_GUIDE.md:1045
  documents only the bundle and never mentions 30069 or delegation. →
  Record in JOURNAL which model governs group collaboration at 1.0,
  banner the superseded one per Standard 8, and give USER_GUIDE §9.6 a
  single answer for a group of researchers.
- **`Signer.recordSigningState` has zero callers; the content script
  re-implements it privately** *(S)* — src/shared/signer.js:177-190
  writes `xr_signing_state`; grep across src/ and tests/ shows no
  caller. src/content/index.js:218-231 defines a private
  `recordSigningState` writing the same key, called at
  :94,102,104,113,115,118,126,129. Signer's header comment (:9) still
  names "popup", a surface removed in JOURNAL 2026-06-09. → Delete the
  facade method (recorded kill) or make the content script call it;
  either way `xr_signing_state` gets one writer. Also fix the two stale
  "popup" references in signer.js:9 and :174.
- **Options → Signing shows nothing until some tab has run the content
  script** *(S)* — `xr_signing_state` is written only from
  src/content/index.js:225 (the content-script init path) and read at
  src/options/index.js:490. A user who installs, opens Options and never
  loads a web page has no state to read. → Have loadSigning() fall back
  to `Signer.probe()` (shared/signer.js:65-82) when the stored state is
  absent, so the panel is honest on a fresh install.
- **`xray:user` is a duplicated schema constant in five modules** *(S)*
  — src/sidepanel/index.js:51 `USER_KEY_NAME`, src/portal/identity.js:35
  `SYNC_KEY_NAME` (comment: "sidepanel/index.js USER_KEY_NAME"),
  src/shared/entity-model.js:414, src/shared/case-bundle.js:173,
  src/shared/identity-profiles.js:19. Standard 10 names "a duplicated
  schema constant" as erosion. → Export it once from
  local-key-manager.js and import at all five sites. Pure refactor,
  two-way door.
- **208 bare console.* calls against the Utils.log convention, including
  routine info logged at error level in the SW** *(M)* — src/reader has
  117, src/shared 73, src/background 9. background/index.js:932
  `console.error('[X-Ray SW] fetchTranscript via page-world injection,
  tab', …)` and :984-991 log `bodyStart: result.body.slice(0, 120)` —
  captured transcript text — unconditionally at error level. CLAUDE.md's
  Conventions: "use Utils.log / Utils.error (no-ops when CONFIG.debug is
  false). Don't add bare console.log." → Convert the SW's six
  console.error info lines to Utils.log and drop the body slice; sweep
  the reader's 117 in a follow-up. Makes the debug preference mean what
  Options says it means.
- **src/shared is 119 flat top-level modules mixing four contexts' code
  with no convention** *(M)* — 119 files at src/shared/*.js plus audit/,
  metadata/, identity/, platforms/. SW-only (nostr-client.js,
  llm-client.js, transcriber-client.js), content-script-only
  (platforms/*), and extension-page DOM UI (assess-modal.js 499L,
  adjudicate-modal.js 834L, forensic-modal.js 687L, integrity-modal.js
  552L) sit as peers of pure models. JOURNAL 2026-06-10 "Phase 11.3:
  assess UI; the one UI module in src/shared/" called the first one "an
  explicit exception"; there are now four. → Do not rename or move
  existing files. Instead record the placement rule in the module header
  of each context-restricted module ("SW only", "extension pages only",
  "content script only") and add it to the ARCHITECTURE doc, so the
  fifth exception is a choice rather than an accident (Standard 10).
- **NSecBunker's WebSocket runs in the content script, where relay
  sockets were moved out of for CSP** *(M)* —
  src/content/index.js:11,124 imports and connects NSecBunkerClient;
  src/shared/nsecbunker-client.js:26 `new WebSocket(...)`. CLAUDE.md's
  rationale for the relay pool: "Cannot open WebSockets to relays on
  CSP-strict sites, so it delegates publish" — and the api-interceptor
  manifest entry names facebook.com, instagram.com and youtube.com as
  exactly those sites. NSecBunker is presented as a peer of Local and
  NIP-07 in src/options/options.html:62-166. → Either route bunker
  signing through the SW via an `xray:sign:bunker` message (the
  placement argument the relay pool already made), or demote it out of
  the three-way radio to an Advanced fallback with the CSP limitation
  stated. Do not ship it as a peer choice to a non-technical user
  without one of the two.

**Kill candidates**

- **The Phase-9a crowdsourced-metadata publish layer: kind
  30050/30051/30052/30053 builders, metadata/ranker.js,
  metadata/topic-trust-builder.js, and the four unused IndexedDB
  stores** — Zero production call sites.
  src/shared/metadata/builders.js:123 buildAnnotationEvent, :234
  buildFactCheckEvent, :388 buildHelpfulnessEvent and
  src/shared/metadata/topic-trust-builder.js:28 buildTopicTrustEvent are
  imported only by tests/metadata-builders.test.mjs.
  src/shared/metadata/ranker.js rankAnnotations is imported only by
  tests/metadata-ranker.test.mjs. src/shared/archive-cache.js:158-180
  creates `annotations`, `factchecks`, `ratings` and `helpfulness`
  stores with 13 indexes at DB v2; ANNOTATIONS_STORE / FACTCHECKS_STORE
  / RATINGS_STORE appear nowhere else in src/. *(cost of keeping:
  CONSTITUTION Art. 10:416 lists 30050–30053 as "active" for a family
  X-Ray has never emitted — the wire covenant is currently inaccurate to
  a stranger reading it. docs/USER_GUIDE.md:176-182 documents five
  publish capabilities that do not exist, which a non-technical user
  will look for and not find. Every install carries four dead object
  stores that backup/restore and any future DB_VERSION bump must keep
  handling. Retirement here means an Art. 10 row change to "retired —
  never reuse" and a JOURNAL entry, not deletion of the builders' git
  history.)*
- **The five never-read feature flags: `annotations`, `respondsTo`,
  `factchecks`, `ratings`, `helpfulnessVoting`** —
  src/shared/metadata/feature-flags.js:24-32. No `isEnabled('...')` call
  anywhere in src/ reads any of them (verified against the full
  isEnabled sweep). `respondsTo` is misleading in a second way: the tag
  it names is built unconditionally at
  src/shared/event-builder.js:261-263, so the flag would not gate it
  even if read. *(cost of keeping: They inflate the flag surface a 1.0
  user is asked to reason about from 20 real switches to 25, and
  docs/USER_GUIDE.md:176-182 presents three of them as "on" defaults,
  implying the user is already publishing something they are not.)*
- **`bridgingRanking` and `transitiveTrust`** —
  src/shared/metadata/feature-flags.js:33-34, annotated "v3" and "v2".
  Never read; docs/USER_GUIDE.md:198 itself says "not yet shipped".
  *(cost of keeping: Two rows in the user-facing flag table for
  capabilities that do not exist, in a doc a non-technical researcher is
  meant to trust.)*
- **The `xray:forward:*` wildcard message branch** —
  src/background/index.js:446-459. One caller
  (src/options/index.js:1690) for one action, serving a popup surface
  deleted in JOURNAL 2026-06-09. *(cost of keeping: It is the one hole
  in Standard 2's "exactly one handler in exactly one context" rule: any
  extension page can inject an arbitrary message type into the active
  tab, and no guard on typed messages can ever be complete while it
  exists.)*
- **`Signer.recordSigningState`** — src/shared/signer.js:177-190, zero
  callers; src/content/index.js:218-231 duplicates it. *(cost of
  keeping: Two writers documented for one storage key, one of which is
  dead — the facade reads as larger and more capable than it is, which
  is exactly the grab-bag symptom.)*

**Doc gaps**

- No docs/ARCHITECTURE.md. The only structural description of the four
  execution contexts, the bundle graph and the message bus is CLAUDE.md,
  whose own first line says it "provides guidance to Claude Code" — a
  1.0 aimed at outside researchers and contributors has no human-facing
  map. CONTRIBUTING.md mentions architecture once, at :117.
- No docs/THREAT_MODEL.md, required by
  .claude/skills/security-threat-modeler Standard 1. There is
  consequently no document that enumerates the four MAIN-world surfaces,
  the <all_urls> content script, the declarativeNetRequest CSP strip, or
  the loopback companion in one place.
- No canonical xray:* message registry anywhere in the tree.
  CLAUDE.md:98-104 lists 16 types prefixed "e.g." against 42 handled in
  src/background/index.js plus 4 in src/content/index.js:245-265.
- docs/USER_GUIDE.md:176-182 documents publish capabilities that do not
  exist (kinds 30050, 30051, 30052, 30053, 9803 via the `annotations`,
  `factchecks`, `ratings`, `topicTrust`, `helpfulnessVoting` flags), and
  :167-171 instructs users to flip the remaining flags "in DevTools".
- docs/USER_GUIDE.md never discloses that X-Ray patches window.fetch and
  XMLHttpRequest at document_start on facebook.com, fb.com,
  instagram.com and youtube.com whether or not the user captures
  anything (manifest.json content_scripts[2];
  src/page/api-interceptor.js:45 also logs into the page's own console).
  README.md:416-418 states it correctly; the user-facing guide does not.
- docs/USER_GUIDE.md has no entry for the OwnedKeys manifest, kind
  30069, or NIP-26 delegation, though src/reader/index.js:6966 emits it
  on every entity publish — and §9.6 (:1039-1050) presents the
  private-key-bearing collaboration bundle as the only way a group
  shares identity.
- src/options/options.html:566-576 tells users to run the companion
  "from companion/transcriber/ in the X-Ray repo", but package.json
  webExt.ignoreFiles excludes `companion` from the packaged build — the
  release .zip a non-technical user installs does not contain what the
  Options page names.
- esbuild.config.mjs:3 states "Produces seven bundles under dist/" where
  the configs array produces ten, and :113-118 describes the
  api-interceptor as "Injected on demand by platform handlers via
  chrome.scripting.executeScript" when manifest.json declares it as a
  content_script. src/page/api-interceptor.js:14-19 repeats the same
  false claim. These are the two files an agent or contributor reads
  first to learn the bundle graph.
- README.md:406-407 claims "2100 tests across 165 files"; `npm test`
  reports 2513 across 197 files.
- No document names which of the three signing methods (Local / NIP-07 /
  NSecBunker, src/options/options.html:62-183) a non-technical group
  should choose, or that the NSecBunker socket opens from the content
  script and will be blocked by page CSP on the same sites the relay
  pool was moved into the worker to escape.

**Machine-enforceable candidates**

- Message-bus registry guard: every `xray:*` literal at a runtime send
  site (chrome.runtime.sendMessage / chrome.tabs.sendMessage) resolves
  to exactly one handler registration in exactly one context and appears
  in a checked-in registry file — the graduation the architect skill's
  Standard 2 already specifies but that no test in tests/*guard*.mjs
  implements.
- MAIN-world containment guard: no `world: 'MAIN'` argument to
  chrome.scripting.executeScript outside src/page/, and no import/export
  statement inside src/page/*.js. Currently fails on
  src/background/index.js:938 and :1027.
- Flag-liveness guard: every key in FLAGS_DEFAULTS is either read by an
  `isEnabled('<key>')` call somewhere in src/ or listed in an explicit
  RETIRED_FLAGS set. Currently fails on annotations, respondsTo,
  factchecks, ratings, helpfulnessVoting, bridgingRanking,
  transitiveTrust.
- Flag-reachability guard: every non-retired FLAGS_DEFAULTS key has a
  matching `#pref-*` element id in src/options/options.html. Currently
  fails on reviewCoordination, storeFirstPublish,
  extractionAnalysisPublishing, trustGraphFilter.
- Publish-truth guard (extend tests/publish-transport-guard.test.mjs):
  every module that calls gatePublish must reference `confirmedOk` in
  the same function, and no durable `publishedAt` / `published_at` /
  `publishedEventId` assignment may appear in a branch guarded only by
  `resp.ok`. Currently fails on entity-page-block.js,
  synthesis-block.js, inspector.js, entity-dossier-view.js.
- Bundle-graph drift guard: the entry-point count in
  esbuild.config.mjs's configs array matches the number asserted in its
  own header comment and in CLAUDE.md, and every path in manifest.json's
  content_scripts / background / options_ui / side_panel exists on disk.

### continuous-improvement

The inner loop is genuinely healthy — I measured `npm test` at 7.07s
over 2513 tests with zero failures and zero skips, `npm run build` at
~1s, `npm run lint` at 14s with 0 errors, working tree clean. That is
the asset everything else rests on, and it is intact. Everything else in
my lane is not: the eight dev-process disciplines merged 2026-08-04 and
were not invoked on any of the three PRs that followed on 2026-08-08 (no
review-report artifact exists anywhere in the tree; every JOURNAL
mention is the announcement or a standard cited to justify something
already done), and PR #311 shipped a credential field that echoes its
secret after hitting at least two documented security-threat-modeler
triggers. Three artifacts the disciplines' own release preflight depends
on do not exist — `scripts/release-preflight.mjs`, the verification-debt
ledger at the top of SMOKE_TEST.md, and my own Standard-4 wall-time
baseline entry — so the machinery is declared but never instantiated,
which is my discipline's named failure mode, live. The doc corpus is 48
files and ~31,700 lines with no index, USER_GUIDE.md is unreferenced
from CLAUDE.md, its flag table is wrong in both directions, and 15
[SCREENSHOT-NN] placeholders stand where a non-technical reader needs a
picture. Worst for the stated 1.0 goal: the multi-investigator path —
the whole "together in groups" premise — has never been recorded as
verified by anyone, and its only script sits in an expired competition
runbook.

**Blockers**

- **CHANGELOG [Unreleased] reads "Nothing yet." with 86 non-merge
  commits since v0.8.0 — and the release workflow pulls that section
  verbatim into the Release body** *(M, user-visible)*
- Evidence: CHANGELOG.md:11-13 (`## [Unreleased]` / `Nothing yet.`);
    `git rev-list v0.8.0..HEAD --no-merges --count` = 86 (v0.8.0 tagged
    2026-07-20); CONTRIBUTING.md:147-149 — "The release workflow pulls
    this section verbatim into the GitHub Release body"
- Why 1.0: The GitHub Release page is the first artifact a non-technical
    researcher meets — the packaged .zip is the only install path that
    works without a toolchain (commit 3c5a06f). A 1.0 release body that
    says "Nothing yet." tells them the tool is abandoned.
- Fix: Reconstruct the [Unreleased] section from `git log v0.8.0..HEAD
    --no-merges` (opinion module family, entity-page tail, cloud
    transcription engines, companion status panel,
    constitution/disciplines, event-store 29.1), written for a
    release-notes audience. Then add the CI check in machine_enforceable
    #1 so it cannot recur.
- **Four surfaces still stamp "published" on `resp.ok`, which does not
  mean any relay accepted — a known, recorded, unfixed defect class**
  *(M, user-visible)*
- Evidence: docs/JOURNAL.md:769-782 (2026-08-02) names them and says
    "Recorded there rather than patched here"; still live at
    src/portal/entity-page-block.js:424 (writes a durable `publishedAt`;
    its own error string reads "no relays accepted" for the `!ok`
    branch), src/portal/synthesis-block.js:586,
    src/portal/inspector.js:445 and :504. The fix was parked behind
    `storeFirstPublish`, default false
    (src/shared/metadata/feature-flags.js:187), which has no Options
    control.
- Why 1.0: A truth tool that says a researcher's work is published when
    no relay accepted it is the worst failure available to it —
    collaborators pull nothing and nobody learns why. The maintainer
    could debug this from source; a group of non-technical researchers
    cannot. JOURNAL 2026-07-10 already ruled the local ledger must key
    on `confirmed`; this is that rule broken a second time.
- Fix: Not mine to design — architect owns the choke point and my
    Boundaries say I detect the recurrence and hand off. The recurrence
    is established; demand one enforced invariant (a gate that returns
    "confirmed or not") rather than four remembered call-site fixes, and
    decide whether it ships on or behind `storeFirstPublish`.
- **The one automated browser walk that works cannot run on the
  maintainer's machine or in CI — and it exists only because the same
  feedback gap already bit twice** *(M)*
- Evidence: tools/smoke/ma6-walk.mjs:31-33 hardcodes
    `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` and
    `/opt/node22/lib/node_modules/playwright/index.mjs`; playwright is
    absent from package.json devDependencies and from node_modules; no
    npm script; no CI job; the only reference anywhere is
    docs/JOURNAL.md:745. Recurrence: docs/JOURNAL.md:4474-4475
    (2026-07-05, pdf.js polyfill bug) already concluded "A Playwright
    smoke over the bundles would have caught it pre-merge" and nothing
    was built; on 2026-08-02 the same gap produced the false "published"
    stamp.
- Why 1.0: The defect classes that hurt non-technical users — a surface
    lying about what it did, a bundle broken only in a real browser —
    live precisely in the gap `node --test` and CI cannot see, and
    maintainer browser minutes are the binding constraint for a solo
    shop shipping to strangers. Standards 2 and 3: the second occurrence
    produced machinery, and the machinery was then abandoned.
- Fix: Add playwright to devDependencies; resolve the browser through
    playwright's own resolver with the existing XR_CHROME/XR_PW env vars
    as fallback; add `npm run smoke:walk`; run it in CI on PRs touching
    publish paths or the bundles. Rung selection is automator's call —
    this finding supplies the Standard-1 citation (2026-07-05 +
    2026-08-02) and the Standard-6 constraint (maintainer browser
    minutes).
- **The multi-investigator path — the entire "work together in groups"
  premise — has no verification layer and no recorded walk** *(M,
  user-visible)*
- Evidence: docs/EPISTACK_RUNBOOK.md:197-228 (§5 second-investigator
    walkthrough, scheduled Jul 15-16 against a 2026-07-19 deadline) is
    the only script that exists; docs/JOURNAL.md:4146 (2026-07-08)
    states "Compounding is demonstrated, not promised"; no JOURNAL entry
    records the walk being performed; grep for "second investigator"
    across docs/SMOKE_TEST.md returns nothing.
- Why 1.0: The maintainer's stated goal is groups doing their own
    research together. The one property that makes that work — two
    identities, one corpus, disagreement rendered side by side and never
    merged — has never been observed end to end, and per the 2026-08-02
    pattern entry an unrecorded manual step is indistinguishable from
    one never performed.
- Fix: Lift EPISTACK_RUNBOOK §5 verbatim into docs/SMOKE_TEST.md as a
    permanent section before retiring the runbook (Art. 3: banner, don't
    delete), walk it once, and record the date. Classifying the
    resulting steps agent-verifiable vs needs-human-eyes is
    verification-engineer's vocabulary, not mine.
- **docs/USER_GUIDE.md §2.5's feature-flag table is wrong in both
  directions — it names 8 flags that gate nothing and omits 5 that gate
  real disclosure** *(S, user-visible)*
- Evidence: docs/USER_GUIDE.md:174-197. A grep of every `isEnabled('…')`
    call in src/ yields exactly 20 flag names; `annotations`,
    `respondsTo`, `topicTrust`, `factchecks`, `ratings`,
    `helpfulnessVoting`, `bridgingRanking`, `transitiveTrust`
    (src/shared/metadata/feature-flags.js:24-34) appear in none of them.
    Absent from the table: `aiVision`, `localTranscription`,
    `transcriptClaimDrafts`, `storeFirstPublish`, and
    `extractionAnalysisPublishing` — the gate on kind 30070, the newest
    publishable wire kind.
- Why 1.0: This table is the 1.0 audience's only map of what leaves
    their machine. Telling them `factchecks` gates fact-check publishing
    when nothing reads the flag, while omitting the gate on a whole-unit
    extraction disclosure, is a consent defect rather than a typo. Same
    class as "kind 32125 shipped undocumented for months" (JOURNAL
    2026-07-09).
- Fix: Rewrite the table from FLAGS_DEFAULTS; mark the eight dead ones
    retired-in-place with rationale rather than deleting the rows (Art.
    3). Then add the parity guard in machine_enforceable #3.
- **Three real feature gates are reachable only by hand-editing
  chrome.storage in DevTools** *(M, user-visible)*
- Evidence: `reviewCoordination` (src/portal/inspector.js:404,
    src/network/index.js:798), `storeFirstPublish`
    (src/shared/publish-gate.js, src/reader/index.js:5514) and
    `extractionAnalysisPublishing` (src/portal/extraction-block.js:137)
    are read by isEnabled() but have no `setOverride` call in
    src/options/index.js — the 17 that do sit at lines 1284-1402.
    docs/USER_GUIDE.md:169-170 instructs the user to flip "the rest" in
    DevTools via the `xray:flags` key.
    src/shared/metadata/feature-flags.js:17-20 still promises a "show
    experimental flags" disclosure "in Week 2" of Phase 9a.
- Why 1.0: "Open DevTools and edit a JSON blob in chrome.storage.local"
    is not an instruction the 1.0 audience can follow. Each of the three
    is therefore either shipped-but-unreachable or not shipped; the
    release needs that decided and recorded, not left ambiguous.
- Fix: For each: surface a checkbox with its disclosure text, or record
    a kill/defer in JOURNAL with rationale. Either resolution is fine;
    silence is not.
- **The user guide ships 15 [SCREENSHOT-NN] placeholders and the repo
  contains zero images** *(S, user-visible)*
- Evidence: 15 occurrences of `[SCREENSHOT-` in docs/USER_GUIDE.md (e.g.
    :139, :155); `find docs -type f \( -name '*.png' -o -name '*.jpg' -o
    -name '*.gif' -o -name '*.svg' \)` returns nothing; the guide's own
    Appendix (docs/USER_GUIDE.md:1210-1234) enumerates all 14 shots and
    prices them at "~30 min total".
- Why 1.0: For a reader who cannot fall back on source, a literal
    `[SCREENSHOT-01]` where the picture of `chrome://extensions` should
    be is the difference between installing and giving up. The guide
    itself prices the fix at half an hour.
- Fix: Shoot the 14 frames the Appendix specifies (blur the API-key
    field in 04 per its own note), commit under docs/img/, replace the
    tokens, delete the Appendix.

**Should fix**

- **The eight disciplines merged 2026-08-04 and were not invoked on the
  next three PRs — my own failure mode, live** *(S)* — Skills merged in
  6c498e6 / 76cdacb (2026-08-04). The next feature work was PRs
  #309/#311/#312 (3c5a06f, c9d9ee4, a8d0da3, all 2026-08-08). No
  review-report artifact exists in the tree (`ls docs/*REVIEW*
  docs/*REPORT*` → none). Every JOURNAL mention of a discipline (lines
  58, 120, 179, 187-190) is either the announcement or a standard cited
  to justify something already done. PR #311 added a polling network
  destination and touched an Options credential field — two documented
  security-threat-modeler triggers — and shipped the token echo at
  src/options/index.js:1208 (the API-key fields at :1216-1219
  deliberately never echo, and the comment stating that rule sits
  directly beneath the violating line). → Add a `Disciplines invoked:`
  line to .github/pull_request_template.md with the routing triggers
  inline, so a decision to skip is at least explicit. Standard-8
  experiment: if the next three PRs still record none, the skills are
  removal candidates rather than fixtures — deleting one's own machinery
  is normal operation, not failure.
- **The declared release preflight depends on three artifacts that do
  not exist** *(M)* — .claude/skills/README.md:76-79 —
  `scripts/release-preflight.mjs` "is to-be-built" (scripts/ holds only
  build-icons.mjs and set-version.mjs);
  .claude/skills/verification-engineer/SKILL.md:139 — "The ledger does
  not exist yet" (no ledger at the top of docs/SMOKE_TEST.md); my own
  Standard 4 requires a dated JOURNAL wall-time baseline "made when this
  standard is adopted" and no such entry exists. → Seed the S4 baseline
  entry from today's measurement (test 7.07s / 2513 tests / 0 skipped,
  build ~1s, lint ~14s / 0 errors / 255 warnings) — that one is mine and
  costs a paragraph. The ledger is verification-engineer's to create,
  the preflight script automator's. All three before the tag, or the
  preflight is ceremony by my own definition.
- **ROADMAP.md still contradicts itself on section-walk status — the
  identical defect the 2026-08-02 sweep was written to fix** *(S)* —
  docs/ROADMAP.md:217-220 — "The Phase 16 and 19 section walks are also
  complete … No section walk is outstanding." But docs/ROADMAP.md:1473
  still reads "## Phase 16 — Moral-lens evaluation (lens-readings) ✅
  shipped — smoke run pending" and :1688 still reads "§Phase 19 SMOKE
  walk pending (manual)." The sweep is recorded at
  docs/JOURNAL.md:162-193. → Correct both headings — and treat this as
  the Standard-2 second occurrence it is: another sweep is a fix that
  requires remembering. Ship the guard in machine_enforceable #5
  alongside it.
- **CLAUDE.md — the file every agent boots from — is stale on the
  current version, the current phase, and an entire shipped feature
  family** *(S)* — CLAUDE.md:307-308 — "per-phase scope. Currently
  through Phase 28 (v0.7.0 tagged 2026-07-16 — the first GitHub Release
  since v0.5.1…)". Actual: package.json and manifest.json both 0.8.0,
  v0.8.0 tagged 2026-07-20, docs/ROADMAP.md:2046 "Phase 29 — Store-first
  publish + the local event store" in progress. The opinion module
  family (docs/JOURNAL.md:598, merged 2026-08-02) and
  docs/EVENT_STORE_DESIGN.md appear nowhere in CLAUDE.md. →
  One-paragraph correction. Docs here go stale by exactly one merge;
  this one is four merges and a release behind.
- **`npm run clean` — documented in CLAUDE.md — fails on the
  maintainer's own platform** *(S)* — package.json `"clean": "rm -rf
  dist"`; CLAUDE.md:26 documents it. Run under npm's default shell on
  Windows 10: `'rm' is not recognized as an internal or external
  command`, exit 1 (verified this session). → `node -e
  "fs.rmSync('dist',{recursive:true,force:true})"`. Trivial, but it is a
  documented command that does not work, and it is exactly the class of
  thing the 1.0 audience hits first.
- **255 standing web-ext lint warnings make a new warning structurally
  invisible** *(S)* — `npm run lint` → 0 errors, 255 warnings, 246 of
  them UNSAFE_VAR_ASSIGNMENT (innerHTML / dynamic import). CI treats
  warnings as non-fatal (.github/workflows/ci.yml, "Default: warnings
  non-fatal, errors fail the job"); CONTRIBUTING.md:91 says only that
  lint "must pass", which it always will. No baseline count is recorded
  in any doc. → Record the count in the S4 baseline entry and fail CI on
  an increase. Standard 5's runtime half applies to build signals too: a
  warning that always fires is off — the same reasoning that retired the
  ~100% false archive banner (JOURNAL 2026-07-17).
- **The companion's Python tests exist and no feedback loop runs them**
  *(M)* — companion/transcriber/tests/{test_normalize.py,
  test_cloud_providers.py, test_server_keys.py} exist;
  .github/workflows/ci.yml has no Python job; .github/dependabot.yml
  covers npm and github-actions only, so the uv lockfile that pulls
  torch, whisperx and pyannote is never advisory-checked. → A `uv run
  pytest` job in CI (the companion is excluded from the extension build
  via package.json webExt.ignoreFiles, so it costs the extension
  nothing) plus a `uv` ecosystem entry in dependabot. Trust-in-green
  cannot cover code nothing runs — and the companion is on the 1.0
  critical path for transcription.
- **Thirteen hand-copied `stop_reason === 'max_tokens'` handlers, one
  per LLM request — pain point-fixed three times, never factored** *(S)*
  — src/shared/llm-client.js: 13 request sites (`max_tokens: MAX_*` at
  :344, :410, :456, :545, :648, :749, :792, :838, :888, :935, :1026,
  :1182, :1295) and 13 separate `stop_reason === 'max_tokens'` blocks
  with hand-written prose (:359, :567, :808, …). The pain recurred at
  docs/JOURNAL.md:2113 and :1840 (2026-07-18, 2026-07-19) and was
  point-fixed each time. → One `checkTruncation(data, label)` helper
  plus the guard in machine_enforceable #4. Coverage is currently 13/13
  — held entirely by whoever remembers, which Standard 3 rejects on
  principle.
- **The PR template has no home for the canonical `Wire format:` callout
  the seam map declares** *(S)* — .claude/skills/README.md:109-115 rules
  that ecosystem-pm "declares the canonical PR-body callout literal: a
  section headed `Wire format:`". .github/pull_request_template.md:25-28
  instead asks "Does this change the wire format of any NOSTR event
  X-Ray emits?" as free prose under "Compatibility notes". → Rename the
  section to the declared literal. A convention with no mechanical home
  is a convention nobody follows — and this repo publishes permanent
  wire kinds.
- **CONTRIBUTING.md never mentions .claude/skills/, and its release
  section predates the preflight ordering** *(S)* —
  CONTRIBUTING.md:130-176 gives a six-step release process whose only
  review gate is "Run the smoke test" (step 3);
  .claude/skills/README.md:70-101 defines a five-stage preflight (A
  automator → B six independent reviews → C product-manager → D
  aggregate → E verification-engineer go/no-go). Neither cites the
  other; CONTRIBUTING.md contains no occurrence of "skills". → One
  cross-reference from CONTRIBUTING step 3 to the preflight ordering.
  Two release processes that do not know about each other is how a
  preflight quietly becomes optional.
- **The clean-clone rehearsal followed the maintainer's steps, not the
  README's — which is why "a fresh clone does not load" survived to
  2026-08-08** *(S)* — docs/EPISTACK_RUNBOOK.md:252-255 — the
  "hostile-judge dry run on a clean clone" script itself runs `git
  clone` → `npm install && npm run build` → load unpacked. Commit
  3c5a06f (2026-08-08): "A fresh clone does not load. README and
  USER_GUIDE both said 'clone -> Load unpacked', but dist/ is
  gitignored" (.gitignore:15; `git ls-files dist` is empty). → Whatever
  survives of that script into the release preflight must execute the
  README's literal steps, not the ones the operator already knows. This
  is the audience shift in one line: a rehearsal that substitutes
  operator knowledge for the written instructions cannot find a
  documentation defect.
- **48 top-level docs, ~31,700 lines, no index — and USER_GUIDE.md is
  not among the ones CLAUDE.md names** *(M)* — `ls docs/*.md | wc -l` =
  48; `wc -l docs/*.md` totals 31,732 lines. Eighteen are unreferenced
  from CLAUDE.md, including USER_GUIDE.md, KNOWLEDGE_SHARING_DESIGN.md,
  TEAM_CASE_DESIGN.md, EVENT_STORE_DESIGN.md and the six EPISTACK_*
  files. README.md does link the user guide (:97, :275), so the gap is
  specifically in the file agents boot from. → A docs/README.md index
  with a status column (live / superseded-by / historical), and add
  USER_GUIDE.md to CLAUDE.md's "Project docs" list — agents writing
  user-visible strings currently have no pointer to the document those
  strings must match.

**Kill candidates**

- **Eight never-read feature flags: `annotations`, `respondsTo`,
  `topicTrust`, `factchecks`, `ratings`, `helpfulnessVoting`,
  `bridgingRanking`, `transitiveTrust`
  (src/shared/metadata/feature-flags.js:24-34)** — No `isEnabled()` call
  anywhere in src/ reads any of them — the complete read set is 20
  names. They are Phase 9a scaffolding for 9b/9c surfaces that never
  shipped. *(cost of keeping: docs/USER_GUIDE.md:176-182 documents four
  of them as ON by default and gating publish paths for kinds
  30050/30051/30052/9803. A user reasons about what leaves their machine
  from a fiction, and a future contributor writes a gate against a flag
  with no meaning. Retire in place with rationale (Art. 3) — names and
  numbers stay in the record.)*
- **The six EPISTACK_* docs (~1,600 lines: ENTRY, RUNBOOK,
  SPRINT_KICKOFF, EGGS_CORPUS, EGGS_WORKSHEET, LHC_CORPUS) plus
  docs/epistack/** — An expired competition — the deadline was
  2026-07-19 and CLAUDE.md records the entry as submitted. They carry
  live-sounding dates and imperatives ("Jul 18 hostile-judge dry run")
  that read as current work. *(cost of keeping: They consume a third of
  the doc corpus's discoverability budget and none is referenced from
  CLAUDE.md. Lift RUNBOOK §5 (second-investigator) into SMOKE_TEST and
  §7 (clean-clone) into the release preflight FIRST — those are the only
  live value in the set — then banner the rest as historical.)*
- **The `compgen -G "tests/*.test.*"` guard in
  .github/workflows/ci.yml's "Run unit tests" step** — Its own comment
  says it "predates the test suite (Phase 1 hadn't landed tests/ yet);
  harmless now, keeps hypothetical test-less branches green." *(cost of
  keeping: A dead branch in the one workflow every merge gates on, which
  silently converts "no tests found" into a pass. 197 test files exist;
  the hypothetical branch does not.)*
- **The "Week 2" promise at src/shared/metadata/feature-flags.js:17-20 —
  "The Advanced settings tab will expose a 'show experimental flags'
  disclosure in Week 2; for now flags can be flipped via DevTools"** —
  Week 2 of Phase 9a is roughly four months past; 17 flags got
  individual checkboxes instead, and three real ones got nothing. *(cost
  of keeping: It is the load-bearing comment in the flag module and it
  describes a UI that was never built, sitting next to a DevTools
  instruction the 1.0 audience cannot follow. Either build the flag
  browser or delete the promise and state the actual policy.)*
- **The four-document collaboration chain: TEAM_CASE_DESIGN.md →
  KNOWLEDGE_SHARING_DESIGN.md → NETWORK_CLIENT_DESIGN.md →
  CASE_DOSSIER_DESIGN.md** — docs/TEAM_CASE_DESIGN.md:1-45 carries three
  stacked amendment banners (2026-07-03, 2026-07-05, 2026-07-16), each
  redirecting part of the design elsewhere while declaring other parts
  "remain authoritative in this document". *(cost of keeping: Groups are
  the 1.0 requirement, and the current group design cannot be read
  without chaining four amended documents, two of which CLAUDE.md never
  names. Collapse into one current collaboration doc; banner the rest
  superseded-by, never delete.)*

**Doc gaps**

- docs/THREAT_MODEL.md does not exist though
  .claude/skills/security-threat-modeler/SKILL.md Standard 1 requires it
  — confirmed absent this session; that skill's lane, cited here rather
  than re-walked.
- No "working in a group" chapter anywhere. docs/USER_GUIDE.md:1044-1049
  documents the collaboration bundle as carrying entity private keys
  ("Treat it like an `nsec` backup") with no runbook for how a group
  sets up, agrees a shared relay set, divides work, or recovers if a
  bundle leaks.
- docs/SMOKE_TEST.md's header is stale on verification facts: line 4
  says it covers "Phases 0–16" (the tree is at Phase 29), line 25 says
  "7 bundles" (esbuild.config.mjs produces 10), line 26 says "1277/1277
  should pass" (actual 2513). Test counts and bundle lists are
  verification-engineer's half of the S7 doc-currency split — cite its
  report; only the Phase-scope claim is mine.
- docs/ has no README.md index across 48 files; 18 are unreachable from
  CLAUDE.md, including USER_GUIDE.md itself.
- docs/JOURNAL.md's own "When to add an entry" list (lines 6-16) has no
  clause for "a manual walk was performed" — precisely the omission the
  2026-08-02 entry diagnosed as having seeded three new skills with a
  false motivating example.
- companion/transcriber/README.md is the install doc for a Python
  service a non-technical user must set up, and CLAUDE.md's Project-docs
  list never names it (only the Companion-service section mentions the
  path).
- Nothing documents a per-PR CHANGELOG obligation even though
  CONTRIBUTING.md:147-149 says the section is pulled verbatim into the
  Release body.
- docs/USER_GUIDE.md:138 tells a user to pick "3–4 independently
  operated relays" but nothing tells a GROUP how to agree on a shared
  set — which is the mechanism that makes their events mutually visible
  at all.

**Machine-enforceable candidates**

- CI fails when `git rev-list <latest v* tag>..HEAD --no-merges` is
  non-empty while CHANGELOG.md's `[Unreleased]` body is empty or matches
  /^nothing yet\.?$/i. Cited pain: 86 commits vs "Nothing yet." today.
- Guard test: every key in FLAGS_DEFAULTS is either read by a literal
  `isEnabled('<flag>')` somewhere in src/, or listed in an exported
  RETIRED_FLAGS map with a rationale string. Cited pain: 8 dead flags
  documented to users as live gates.
- Guard test: the flag set in FLAGS_DEFAULTS equals the flag set in
  docs/USER_GUIDE.md §2.5's table (modulo the retired list). Cited pain:
  8 phantom rows and 5 omissions, including kind 30070's publish gate.
- Guard test over src/shared/llm-client.js: every function that sends
  `max_tokens:` also routes its response through the shared truncation
  check. Cited pain: JOURNAL 2026-07-18 (×2) and 2026-07-19, point-fixed
  each time.
- Guard test: docs/ROADMAP.md contains no "smoke run pending" / "SMOKE
  walk pending" string while its summary asserts "No section walk is
  outstanding" — a same-file contradiction check. Cited pain:
  ROADMAP.md:1473 and :1688 surviving the 2026-08-02 sweep written to
  fix them.
- `npm run test:timed` comparing `npm test` and `npm run build` wall
  time against a baseline committed in a dated JOURNAL entry (warn +25%,
  fail +50%, baseline moved only by journaled decision). Seed today's
  measurement: test 7.07s / 2513 tests / 0 skipped, build ~1s, lint ~14s
  / 0 errors / 255 warnings.

### automator

X-Ray's automation is unusually thoughtful in the small (SHA-pinned
actions, a lockfile-bound web-ext, a drift guard on generated docs, a
2513-test suite that runs in ~8 seconds) and thin in exactly the places
a 1.0 for non-technical groups depends on: distribution, release notes,
and any verification above the module layer. The release pipeline stops
at a GitHub Release .zip the user must unzip and side-load with
Developer mode on — and on Firefox the only documented path unloads on
browser restart, so there is currently no persistent non-technical
install at all. The mechanical pre-tag checks are still manual
(scripts/release-preflight.mjs is to-be-built), CHANGELOG [Unreleased]
reads "Nothing yet." across 164 commits since v0.8.0, and the
version-lockstep check that CLAUDE.md:234 and CONTRIBUTING.md:139 both
advertise as a CI gate exists only in release.yml — i.e. after the
immutable tag is pushed. Most striking: a working headless-Chromium
extension harness (tools/smoke/ma6-walk.mjs) already caught a real
defect and the same lesson was recorded a month earlier (JOURNAL
2026-07-05), yet it hardcodes container paths, its Playwright dependency
is absent from package.json, and it is referenced in exactly one JOURNAL
line — so the 559-row docs/SMOKE_TEST.md remains an all-human walk.
Nothing here is a rewrite; the gap is that proven automation stalled one
rung below where its payback already licensed it.

**Blockers**

- **No persistent install path for a non-technical user — and none at
  all on Firefox** *(L, user-visible)*
- Evidence: README.md:212-222 (Option A: unzip + Developer mode + Load
    unpacked; Firefox = about:debugging temporary add-on, "unloads
    temporary add-ons on restart"); README.md:242-243 (persistent
    Firefox = `web-ext sign`, i.e. an AMO account + toolchain);
    docs/USER_GUIDE.md §2.1 repeats both. Grep of docs/ROADMAP.md,
    CHANGELOG.md and docs/JOURNAL.md for "Web
    Store|AMO|addons.mozilla|update_url" returns exactly one hit:
    JOURNAL.md:7934, a 2026-04-23 "next pieces to layer on top" line.
    release.yml ends at a GitHub Release.
- Why 1.0: A group of non-technical researchers cannot be asked to
    enable Developer mode, keep an unzipped folder in place forever, and
    re-load the add-on after every Firefox restart. Every collaborator
    is a fresh install; the current path fails at the first one.
- Fix: Decide and record the 1.0 distribution channel before tagging: a
    Chrome Web Store listing (unlisted is enough for a closed group) and
    either an AMO-signed .xpi or a self-hosted signed .xpi with an
    update_url. Both add a store-submission step to release.yml behind
    repo secrets; the tag push and the store submit stay human per
    CONTRIBUTING.md. Update SECURITY.md:89-93, which currently states
    GitHub Releases is the only legitimate source. If the answer is
    "side-load only for 1.0", say so explicitly in README and the user
    guide and demote the Firefox instructions to a labeled
    developer-only section.
- **CHANGELOG [Unreleased] is empty across 164 commits, and the release
  workflow publishes a blank body without complaining** *(M,
  user-visible)*
- Evidence: CHANGELOG.md:11-12 — "## [Unreleased]" / "Nothing yet.";
    `git rev-list --count v0.8.0..HEAD` = 164 (companion live status,
    cloud engines, constitution + disciplines, opinion modules, AI
    vision, store-first publish all landed since).
    .github/workflows/release.yml:86-106 extracts the section by awk and
    its own comment says "Falls back to a blank body if the section
    isn't found, so the release still publishes." JOURNAL.md:7936-7937
    already named "CHANGELOG enforcement on PR" as a next piece — on
    2026-04-23.
- Why 1.0: At 1.0 the release body is the only thing a non-technical
    user reads to learn what the tool does and what changed. Today
    tagging 1.0 yields either an empty release or a reconstruction of
    164 commits by hand at the worst possible moment.
- Fix: Two moves, in order: (a) reconstruct the [Unreleased] section
    from the post-v0.8.0 log now, while the authors are still
    in-session; (b) make the omission loud — change the awk step to exit
    nonzero when the section is empty or absent, and add the CHANGELOG
    line to .github/pull_request_template.md as the checklist rung
    before any CI gate. A silent fallback is the failure mode this repo
    already paid for once with v0.6.0 (JOURNAL.md:4764-4772).
- **Version lockstep is only checked after the immutable tag is pushed,
  while two docs claim CI checks it** *(S)*
- Evidence: CLAUDE.md:234 "agree — **CI rejects a mismatch.**" and
    CONTRIBUTING.md:139 "(CI rejects a mismatch)";
    .github/workflows/ci.yml has no version step at all (steps are node
    --check, build, test, web-ext lint, web-ext build, upload). The only
    check is .github/workflows/release.yml:49-71, which runs after the
    tag push — and CONTRIBUTING.md:177-191 records that `v*` tags are
    protected against deletion and force-update, so the recovery is
    "burn the bad number". No test reads package.json or manifest.json
    (grep over tests/*.test.mjs returns nothing).
- Why 1.0: The 1.0 tag is the one version number that must not be
    burned, and the check protecting it fires at the most expensive
    possible moment. A PR that bumps only one of the two files passes CI
    green today.
- Fix: Add the equality assertion as a guard test
    (tests/version-lockstep.test.mjs: read both files, assert each
    parses as semver — the positive sanity — then assert equality) so it
    runs in `npm test` on every PR; keep release.yml's tag-vs-files
    check as the belt. Then correct CLAUDE.md:234 and
    CONTRIBUTING.md:139 to describe reality.
    scripts/set-version.mjs:1-11 already states it correctly — the drift
    is in the two prose docs.
- **A proven browser-level smoke harness exists, is unrunnable off one
  container, and is documented nowhere** *(M)*
- Evidence: tools/smoke/ma6-walk.mjs loads the unpacked extension in
    real headless Chromium, seeds state through the extension's own
    bundled modules, pins relays to an unreachable loopback so nothing
    can publish, and drives the case dashboard — but lines 30-33
    hardcode `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` and
    `/opt/node22/lib/node_modules/playwright/index.mjs`, and playwright
    is absent from package.json devDependencies (esbuild, web-ext,
    fake-indexeddb, @resvg/resvg-js only). Grep across docs/*.md, *.md,
    .claude/skills/*/SKILL.md and .github/workflows/*.yml for
    "tools/smoke|ma6-walk|Playwright" hits only docs/JOURNAL.md:745. It
    earned itself twice: JOURNAL 2026-08-02 "The MA.6 browser walk found
    a false 'published' stamp" (JOURNAL.md:737-797), and JOURNAL
    2026-07-05 had already concluded "A Playwright smoke over the
    bundles would have caught it pre-merge" (JOURNAL.md:4472-4475).
- Why 1.0: 1.0 hands the tool to people who cannot diagnose a broken
    build, while the only verification above the module layer is a
    559-row hand walk (docs/SMOKE_TEST.md, 45 sections) that no ledger
    records. Two escaped bugs in two months both lived in the gap
    between `node --test` and a loaded extension — the exact gap this
    harness closes.
- Fix: Promote it one rung, minimally: resolve CHROME/PW from a
    `playwright` devDependency with the container paths kept as env
    overrides (preserve the existing exit-2-with-reason contract),
    rename to a generic entry (tools/smoke/walk.mjs) with the MA.6 steps
    as one scenario, add `npm run smoke:browser`, and wire one CI job
    that loads the extension, opens all five extension pages, and
    asserts zero page errors plus the ten expected dist bundles.
    Payback: two escaped bugs in ~2 months that CI structurally could
    not see, against roughly a day of work on a harness that already
    exists and already ran. Then document it in docs/SMOKE_TEST.md and
    CLAUDE.md — a check nobody can find is not a check.
- **The companion's own key-hygiene tests exist and are run by nothing**
  *(S)*
- Evidence: companion/transcriber/tests/ holds test_server_keys.py,
    test_cloud_providers.py, test_normalize.py; test_server_keys.py:1-9
    states the invariant — "an extension-supplied API key reaches the
    worker child through its process environment ONLY — never the job
    snapshot, never the spec file, never a log line" — and its own
    docstring plus test_normalize.py:4 say "never part of the
    extension's CI". ci.yml runs only `npm test`; package.json:38-42
    excludes companion/** from the package. server.py:2-4 states the
    module "NEVER imports torch/whisperx/yt_dlp", so these tests need
    only fastapi/uvicorn/pydantic — seconds, not a CUDA install.
- Why 1.0: Non-technical users now paste AssemblyAI/Deepgram keys into
    the extension and those keys ride each request through this service
    (companion/transcriber/README.md:319-327). The assertion that they
    never reach disk or logs is the whole safety argument, and nothing
    re-checks it on any change.
- Fix: Add a second CI job (companion-tests, ubuntu-latest,
    path-filtered to companion/**) that installs the three light deps
    and runs `python -m unittest discover tests` from
    companion/transcriber. Fail loud, no skip branch. Record the outcome
    in the CI-blind-spot ledger this discipline's Standard 5 requires:
    that ledger does not exist, so "CI never touches companion/" is
    currently an unwritten accepted risk rather than a dated one.
- **The companion recovery panel instructs users into a directory the
  documented install never creates** *(M, user-visible)*
- Evidence: src/shared/companion-status.js:47 `const startCommand = 'cd
    companion\\transcriber\nuv run xray-transcriber'` (a Windows
    backslash path), :55 "Open a terminal in your X-Ray repo.", :103
    "Update the service (git pull), then restart it." But
    package.json:38-42 excludes `companion/**` from the built .zip, and
    README.md:212-216 tells non-technical users to install from that
    .zip. companion/transcriber/README.md:22 lists "Windows 10/11" as a
    hard requirement with no macOS/Linux path.
- Why 1.0: This panel was built specifically to tell a newcomer the
    truth about their setup (JOURNAL 2026-08-08, "Live companion status,
    and the /health lie it has to avoid"). For every user on the
    documented install path its recovery steps are unfollowable, and for
    every non-Windows user the whole companion is undocumented.
- Fix: Make the steps conditional on what the user actually has: detect
    the packaged install (no repo present) and point at a download
    rather than a `cd`; emit a POSIX command shape off Windows. Either
    ship the companion as its own release asset or state plainly in
    README and USER_GUIDE §2.7 that transcription requires the source
    install. Add a macOS/Linux path to the companion README, or declare
    Windows-only in the extension UI — not only in a file the zip user
    never receives.

**Should fix**

- **Smoke-test and README pass criteria assert numbers that are already
  wrong, so they cannot fail correctly** *(S)* — docs/SMOKE_TEST.md:26
  "npm test # 1277/1277 should pass" and :196 "✅ 1018/1018"; actual `npm
  test` on this tree: 2513 pass, 0 fail, ~8s. docs/SMOKE_TEST.md:195 "✅
  all seven bundles emitted under dist/ (content, background, options,
  sidepanel, reader, portal, api-interceptor)" and esbuild.config.mjs:3
  "Produces seven bundles" — but esbuild.config.mjs:63-125 defines ten,
  and README.md:323 and CLAUDE.md both say ten. README.md:406 says "2100
  tests across 165 files". → Correct the numbers, then remove the
  recurrence: a guard test that parses the outfiles from
  esbuild.config.mjs and asserts the doc's bundle list matches (positive
  sanity first — assert the parser found at least one outfile), and
  either drop hardcoded test counts from pass criteria or derive them
  from the runner's own output.
- **`npm run clean` fails on the maintainer's own platform** *(S)* —
  package.json:12 `"clean": "rm -rf dist"`, documented in CLAUDE.md:24
  as a project command. Verified: `npm config get script-shell` = null
  (npm uses cmd.exe on Windows) and `cmd /c "rm -rf …"` returns "'rm' is
  not recognized as an internal or external command", exit 1. → Replace
  with `node -e
  "require('fs').rmSync('dist',{recursive:true,force:true})"` or delete
  the script. Either is fine; a documented command that errors on the
  primary dev box is the small lie that costs a newcomer twenty minutes.
- **CI can silently skip the entire test suite and still go green**
  *(S)* — .github/workflows/ci.yml:56-65 — `if compgen -G
  "tests/*.test.*" > /dev/null; then npm test; else echo "No tests yet;
  skipping."; fi`, with a comment conceding "The compgen guard predates
  the test suite (Phase 1 hadn't landed tests/ yet)". → Delete the
  branch and run `npm test` unconditionally. A directory rename or glob
  change would today print a cheerful skip under a green check — the
  always-passing decoration Standard 5 forbids. Record the kill in
  docs/JOURNAL.md.
- **A generated file that ships to users has no drift guard, while its
  younger sibling got one** *(S)* — tools/gen-module-prompts.mjs:59
  writes `src/shared/audit/module-prompts.js` (header at :4-12:
  "GENERATED, verbatim, from docs/auditor-prototype/prompts/…", imported
  by the background bundle). No npm script invokes it (package.json:9-18
  has docs:disciplines only) and no test compares it to a fresh render —
  grep of tests/ finds only tests/discipline-docs.test.mjs, which guards
  the newer generator per JOURNAL 2026-08-04 ("The discipline doc is
  generated, and drift-guarded"). → Add `npm run docs:prompts` and
  tests/module-prompts-drift.test.mjs on the discipline-docs pattern
  (assert committed bytes equal a fresh render; failure message names
  the regen command). Also make the generator path-independent — commit
  b599f34 already did exactly that for gen-discipline-docs.mjs; this one
  still resolves 'docs/…' and 'src/…' relative to cwd.
- **The shipped package carries the test suite, the whole docs corpus,
  and the build config** *(S)* — Built with the repo's own web-ext
  config: 798 entries, 11.35 MB, of which 201 entries are tests/, 83
  docs/, plus tools/, scripts/, esbuild.config.mjs, CLAUDE.md,
  package-lock.json, and a stray `_metadata/generated_indexed_rulesets/`
  from a local Chrome load. package.json:38-42 excludes only `companion`
  and `companion/**`. → Extend webExt.ignoreFiles to tests, docs, tools,
  scripts, esbuild.config.mjs, package-lock.json, CLAUDE.md and
  _metadata, and add a CI assertion that the built zip contains no
  `tests/` entry. Keep the .map files if source-map transparency is
  deliberate — say so in a comment, since they are 18.45 MB of the
  uncompressed total.
- **Release artifacts carry no checksum or provenance, while SECURITY.md
  points users at them as the only trustworthy source** *(S)* —
  SECURITY.md:89-93 "Releases are published at Releases and built by
  release.yml from a tagged commit. Anything offering you an X-Ray build
  from another source is not from this project."
  .github/workflows/release.yml:108-115 attaches
  `web-ext-artifacts/*.zip` and nothing else. → Emit a SHA256SUMS file
  alongside the zip and attach both; optionally add
  actions/attest-build-provenance. Document the verification one-liner
  in README's install section. Cheap, and it converts a prose claim into
  something a group member can actually check.
- **The companion's Python dependencies — carrying hand-written CVE
  floors — have no automated watcher** *(S)* — .github/dependabot.yml
  declares npm and github-actions only.
  companion/transcriber/pyproject.toml:19-22 pins `torch>=2.13` for
  "three memory-corruption advisories", :65-71 pins `transformers>=5.5`
  for three named GHSAs, each maintained as a prose comment. JOURNAL
  2026-08-02 ("torch 2.13 bump broke Windows: per-index platform
  coverage, and a lock-time guard") records what re-locking costs when
  it happens by hand under pressure. → Add a `uv` ecosystem entry for
  /companion/transcriber to dependabot.yml, grouped weekly like the
  others. Even if most PRs are closed unmerged, the floors stop being
  invisible. Pair it with the lock-time guard already at
  pyproject.toml:53-64.
- **The PR template predates the disciplines and asks for none of what
  they declared canonical** *(S)* —
  .github/pull_request_template.md:11-28 asks for Chrome/Firefox load
  checkboxes, web-ext lint, and a free-text "Compatibility notes" — but
  not the `Wire format:` callout literal that
  .claude/skills/README.md:109-114 names as ecosystem-pm's canonical
  declaration, nor a CHANGELOG [Unreleased] line, nor a JOURNAL entry,
  nor `npm test`. → Update the template to the checklist rung the
  disciplines already specify. In an agent-authored repo the PR body is
  the one artifact every change passes through; it is the cheapest rung
  on the ladder and it currently encodes the pre-2026-08 process.
- **The version script's printed recipe contradicts the release
  procedure and the known git-proxy limitation** *(S)* —
  scripts/set-version.mjs prints "4. git tag v<x>  5. git push && git
  push --tags", while CONTRIBUTING.md:157-158 says "`main` is protected:
  land the version bump through a PR first, then tag the merged commit",
  and JOURNAL 2026-07-16 ("Tag pushes refused by the remote-exec git
  proxy (v0.7.0)") records that an agent session cannot push tags at
  all. → Rewrite the printed next-steps to the real procedure (bump → PR
  → maintainer merges → maintainer tags the merge SHA from a local clone
  → approve the release environment). This script is the model other
  scripts are told to follow and the first thing an agent reads at
  release time.
- **The agent-runnable subset of the smoke test describes a superseded
  workflow and covers only the oldest phases** *(M)* —
  docs/SMOKE_TEST.md:71-187 — one-time human setup around "the agent's
  MCP-helper extension", a per-phase coverage table (:149-162) whose
  rows stop at Phase 7 plus "Polish #2", and a pseudo-code loop
  (:164-187) citing the 2026-04-21 proof of concept. The document's own
  header (:3-4) claims coverage of "Phases 0–16 + the v0.5.x cleanup"
  while the file contains 45 sections running through Phase 29 and R5. →
  Rewrite the section around tools/smoke once it is runnable
  off-container: name what the harness verifies, what still needs human
  eyes, and drop the tab-group mechanics. Fix the header's phase range.
  The classification vocabulary is verification-engineer's; the ask here
  is only that the agent-verifiable column stop describing an April
  tool.
- **.gitattributes pins the JS tree but not the Python companion** *(S)*
  — .gitattributes:9-18 pins
  *.js/*.mjs/*.ts/*.json/*.md/*.html/*.css/*.yml/*.svg to eol=lf.
  Unpinned: *.py, *.toml, *.lock, *.yaml, *.bat, .python-version. The
  CRLF failure class already cost a debugging session (JOURNAL
  2026-08-02, "CRLF checkouts killed the hash-parity test file": "CI
  (Ubuntu, LF) never saw it"). → Add *.py/*.toml/*.lock/*.yaml eol=lf
  and *.bat eol=crlf. One line each; the class is known and the dev box
  is the platform that gets bitten.
- **scripts/ and tools/ have no stated boundary, and the combined set is
  past the smoke-test graduation threshold** *(S)* — scripts/ holds
  build-icons.mjs and set-version.mjs; tools/ holds
  gen-discipline-docs.mjs, gen-module-prompts.mjs, relay-probe.mjs and
  smoke/. Nothing in CLAUDE.md or CONTRIBUTING.md says which goes where.
  Standard 4 graduates to tests/scripts-smoke.test.mjs "once scripts/
  holds three or more entries" — read literally scripts/ has two; read
  by intent the executable-entry-point set has six. → State the rule in
  CLAUDE.md (scripts/ = release and build plumbing invoked by npm
  scripts; tools/ = generators and one-off harnesses), then add
  tests/scripts-smoke.test.mjs spawning every entry point in both
  directories with no args and asserting nonzero exit with a usage line.
  relay-probe.mjs and ma6-walk.mjs already have the right shape;
  gen-module-prompts.mjs does not.

**Kill candidates**

- **.github/workflows/ci.yml:56-65 — the `compgen -G "tests/*.test.*"`
  conditional wrapped around `npm test`** — Its own comment concedes it
  predates the test suite and exists only to keep a hypothetical
  test-less branch green. 2513 tests now hang on that glob matching.
  *(cost of keeping: A rename or directory move turns the project's
  primary safety net into the message "No tests yet; skipping" under a
  green checkmark — a silent skip, which this discipline's Standard 5
  rates worse than no check at all.)*
- **.github/workflows/release.yml:86-106 — the blank-body fallback in
  the changelog extraction step** — The comment states the intent
  plainly: "Falls back to a blank body if the section isn't found, so
  the release still publishes." Publishing an empty release is not a
  degraded success, it is the failure. *(cost of keeping: At 1.0 the
  release body is the user-facing document. The fallback guarantees the
  mistake ships silently, at the one moment — a protected, undeletable
  tag — where recovery costs a version number.)*
- **package.json:12 — the `clean` npm script** — `rm -rf dist` does not
  run on Windows, which is the maintainer's platform, and deleting a
  build directory does not need a scripted alias. *(cost of keeping: It
  is advertised in CLAUDE.md:24 as a project command, so it is a
  documented instruction that errors for the person most likely to
  follow it.)*
- **docs/SMOKE_TEST.md:164-187 — the "Suggested agent-driven loop"
  pseudo-code, plus the per-phase agent-coverage table at :149-162** —
  Both describe the 2026-04-21 MCP tab-group proof of concept and cover
  Phases 2–7 only; the 2026-08-02 walk that actually found a bug used a
  Playwright harness these rows never mention. *(cost of keeping: It is
  a map of agent capability that has been wrong since August, and it is
  the first section an agent reads when asked how much of the smoke test
  it can run. Retire it on the record (git-recoverable, CONSTITUTION
  Art. 3) and replace it with a pointer to tools/smoke once that is
  runnable off-container.)*

**Doc gaps**

- No docs/TOIL.md and no CI-blind-spot ledger exist, though this
  discipline's Standards 1 and 5 require both; "CI is Ubuntu/LF while
  the dev box is Windows" and "CI never touches companion/" are
  therefore undated, unwritten accepted risks rather than recorded
  decisions.
- scripts/release-preflight.mjs is still to-be-built, so step A of the
  release ordering in .claude/skills/README.md:75-79 (version lockstep,
  CHANGELOG section, clean tree, build/test/lint green, smoke recency)
  runs by hand at the moment attention is scarcest.
- One preflight input has no home to read from: the verification-debt /
  walk ledger at the top of docs/SMOKE_TEST.md does not exist
  (verification-engineer/SKILL.md:136-149 acknowledges this), so "smoke
  recency stated" is currently unstatable.
- The exact release filename is wrong in the two places a first-time
  user follows: README.md:214 and docs/USER_GUIDE.md §2.1 both say
  `xray-<version>.zip`, while web-ext actually emits
  `x-ray_nostr_url_metadata_article_capture-0.8.0.zip`.
- README.md:19 still reports the status as "**v0.7.0** (tagged
  2026-07-16)" while package.json and manifest.json are 0.8.0, v0.8.0
  was tagged 2026-07-20, and 164 commits have landed since.
- companion/transcriber/README.md:22 requires "Windows 10/11" with no
  macOS or Linux setup path, though the extension ships for both and the
  Options panel offers transcription regardless of platform.
- docs/USER_GUIDE.md carries 14 unfilled `[SCREENSHOT-NN]` placeholders
  against its own shot-list appendix; the extension-page shots (01-04)
  are exactly what the headless harness can produce deterministically
  once it runs off-container.
- CONTRIBUTING.md's release section covers tagging mechanics but says
  nothing about what a release means for installed users — no update
  story, no channel, no note on what happens to a side-loaded folder
  when a new version ships.
- No stated rule for what belongs in scripts/ versus tools/, which is
  how a load-bearing browser harness (tools/smoke) ended up in the
  directory nobody documents.

**Machine-enforceable candidates**

- tests/version-lockstep.test.mjs: parse package.json and manifest.json,
  assert both versions match a semver pattern (positive sanity), then
  assert equality — moves the check from post-tag release.yml onto every
  PR.
- tests/bundle-manifest.test.mjs: extract the outfile list from
  esbuild.config.mjs, assert it is non-empty, then assert the bundle
  names quoted in docs/SMOKE_TEST.md §0.1, README.md and the esbuild
  header all match it — kills the standing "seven bundles" drift.
- tests/module-prompts-drift.test.mjs: assert
  src/shared/audit/module-prompts.js equals a fresh `node
  tools/gen-module-prompts.mjs` render, failing with the regen command
  (the tests/discipline-docs.test.mjs idiom applied to the older
  generator).
- tests/no-secret-echo.test.mjs: assert no options/reader field value is
  assigned from a secret storage key — pins the never-echo pattern at
  src/options/index.js:1216-1219 and fails the token read-back at :1208.
- ci.yml step: run `web-ext build`, then assert the produced zip
  contains no entry under tests/, docs/, tools/, scripts/ or _metadata/,
  and no esbuild.config.mjs.
- ci.yml job (path-filtered to companion/**): install fastapi + uvicorn
  + pydantic only (server.py:2-4 guarantees no torch import) and run
  `python -m unittest discover tests` from companion/transcriber — fail
  loud, no skip branch.

### ecosystem-pm

X-Ray's wire is unusually well-engineered for a solo project —
d-derivations are recomputable, the Art. 6 firewall is expressed as
shapes rather than prose, verify-on-ingest is real, and the custody rule
is guard-tested — but it is documented and governed as one person's
private format, and 1.0 makes every number permanent. Three things the
extension actually emits (kind 30041 comments, kind 30078 entity-sync,
and the 9803/1/5 emits) are missing from either docs/NIP_DRAFT.md or the
CONSTITUTION Art. 10 schedule that Standard 5 designates as the single
authority, and the 30040/30041 collision with NKBIP-01 sits unresolved
in a one-line caveat marked "a pre-submission question" — 1.0 is the
last moment that question is free to answer. Seven kind numbers (9803,
30050–30053, 30060, 30061) have builders, NIP sections, portal labels
and tests but no caller anywhere in src/; they are the speculative twin
this discipline's own failure-mode section warns about, and they are
cheap to retire now precisely because nothing has ever emitted them. On
group collaboration the honest verdict is that the wire supports
publishing near each other, not working together: only four artifact
classes can be incorporated from a teammate, the whole audit family has
no cross-user read path, the documented adversarial-review escalation
(30061 disputes, right-of-reply) has no authoring UI, and the one
review-coordination primitive that exists is behind a flag with no
settings checkbox — DevTools-only, which for the stated audience means
it does not exist. The failure that most contradicts the project's own
law is quiet: parseFeedEvent drops every unknown or unparseable event
with no counter and no surface, so in a group running mixed versions a
teammate's work silently vanishes — Art. 12.1's red line against
silently filtering speech for a reader who asked to see it.

**Blockers**

- **Kinds 30041 and 30078 are emitted but have no docs/NIP_DRAFT.md
  section at all** *(M)*
- Evidence: src/shared/event-builder.js:815 (kind 30041 comment builder)
    and :685 (kind 30078 entity-sync); `grep -n "30041\|30078"
    docs/NIP_DRAFT.md` returns nothing; both listed `active` in
    docs/CONSTITUTION.md:415 and :427
- Why 1.0: Standard 3 parity is law here by the project's own precedent
    — docs/JOURNAL.md 2026-07-09 ('Wire doc reconciled to v0.7.0
    reality; kind 32125 documented') documented 32125 for exactly this
    reason: 'a judge fetching one under the submission npub would have
    found no semantics.' 30041 is worse than 32125 was: it republishes
    third parties' comment text, author handle and profile URL under the
    capturing user's own key, on a number NKBIP-01 already uses for
    something else, with zero published semantics. Non-technical groups
    will emit these without knowing what they promised.
- Fix: Add a `## Kind 30041 — Captured comment` section (tags as built
    at event-builder.js:793-820, d = the platform comment id, the
    comment-text/comment-author/platform/reply-to grammar, and an
    explicit note that the signer is the capturer, never the commenter)
    and a `## Kind 30078 — Entity sync (NIP-78)` section (d = local
    entity id, the L/l `xray/entity-sync` namespace, ciphertext content,
    encrypt-to-self). Additive documentation of already-emitted kinds —
    no wire behavior change.
- **The Art. 10 kind schedule does not reconcile with what the code
  emits (9803, kind 1, kind 5 all missing)** *(S)*
- Evidence: docs/CONSTITUTION.md:411-427 table; kind 9803 built at
    src/shared/metadata/builders.js:412 with its own section at
    docs/NIP_DRAFT.md:277; kind 1 mention notes at
    src/shared/mention-notes.js:94; kind 5 NIP-09 deletion requests at
    src/shared/entity-sync.js:483.
    tests/constitution-guards.test.mjs:201-223 only checks
    retired/free/reserved rows, never emitted-set-equals-schedule.
- Why 1.0: Standard 5 makes the Art. 10 table the one place kind status
    is stated, precisely so restated subsets cannot drift — and it has
    drifted. 9803 is a number this project DEFINED (not a standard kind
    covered by the table's escape clause) and it is absent. Kind 5 is
    more than bookkeeping: the project ships a deletion-request emitter
    under a constitution whose Art. 3 is 'exposure never deletion', and
    the schedule never mentions it, so no reader can see the scope is
    the user's own 30078 blobs and nothing else.
- Fix: Append rows for 9803 (active, or retired per the kill list) and
    for the standard kinds actually emitted (1 mention notes, 5 deletion
    requests scoped to own entity-sync events), with a one-line scope
    note on kind 5 tying it to Art. 3. Extend
    tests/constitution-guards.test.mjs so every kind literal at an
    emission site in src/ must appear in the Art. 10 table.
- **The 30040/30041 collision with NKBIP-01 is an open question and 1.0
  closes it permanently** *(S)*
- Evidence: docs/NIP_DRAFT.md:141 — '`30040` has known third-party uses
    in the wild (NKBIP-01 curated publications) … a kind renumber is a
    pre-submission question, not a format one.' No JOURNAL decision
    exists (`grep -n "NKBIP" docs/JOURNAL.md` returns nothing). The
    sibling collision on 30041 (NKBIP-01 publication content vs. X-Ray
    captured comment, src/shared/event-builder.js:815) is recorded
    nowhere.
- Why 1.0: 30040 is the anchor coordinate for
    30054/30055/30058/30063/30064 and the `a … endorsed` pointers on
    30070 — the single most load-bearing number in the format, and group
    collaboration means these coordinates travel between people's
    clients. Standard 5 requires checking the upstream kind table before
    claiming a number and recording collisions found; half that duty was
    done for 30040 and none for 30041. After 1.0 the number is a
    permanent promise and the question can never be answered again, only
    lived with.
- Fix: Do not renumber — that is BREAKING against already-published
    events and Standard 2 forbids it. Make the decision explicit and
    durable instead: record in docs/JOURNAL.md that X-Ray keeps
    30040/30041 with rationale, add the 30041 half of the caveat to
    NIP_DRAFT beside the 30040 one, and state in both sections how a
    dual-implementing consumer disambiguates (X-Ray events carry
    `['client','xray']` plus kind-specific required tags — `d` matching
    `claim_[0-9a-f]{16}` on 30040, `comment-text`/`platform` on 30041).
- **The `x` tag on kind 30023 carries two incompatible meanings and only
  one is documented** *(S)*
- Evidence: Ordinary captures set `x` to the hash of their OWN body
    (src/shared/event-builder.js:156, via articleHash at :144). Entity
    pages set one `x` per CITED member article
    (src/shared/entity-page-publish.js:157-163); case-brief 30023
    siblings do the same (src/shared/corpus-publish.js:415-428,
    memberRefTags). docs/NIP_DRAFT.md:1133-1141 §'Kind 30023 — `x` tag
    (extension)' documents only the self-hash meaning and offers
    `{"kinds":[30023],"#x":["<hash>"]}` as the way to 'find the article
    a set of audit events scored'.
- Why 1.0: This is the one place a second client does not merely skip
    something unknown — it silently resolves the wrong object. Following
    the documented `#x` join returns the audited article plus every
    entity page and case brief that merely cites it, all as if they were
    that article. That join is the flagship cross-artifact query and the
    thing group members' clients would lean on hardest to line up each
    other's work against the same text.
- Fix: Amend the §`x` tag extension to state both meanings and the
    disambiguator already on the wire: on a 30023 carrying `t:
    xray-entity-page` or `t: xray-case-brief`, `x` tags are CITATION
    hashes (possibly many); on any other 30023 a single `x` is the
    event's own body hash. Mirror the note into the §Entity pages and
    §Kind 30068 sections. Docs-only — no emitted bytes change.
- **`reviewCoordination` — the only group review-coordination primitive
  — has no settings UI** *(S, user-visible)*
- Evidence: Flag at src/shared/metadata/feature-flags.js:153, gating
    src/portal/inspector.js:404 ('Request review') and
    src/network/index.js:798 (re-broadcast). `grep -o
    "setOverride('[a-zA-Z]*'" src/options/index.js` lists 16 flags and
    reviewCoordination is not among them; no control exists in
    src/options/options.html. docs/USER_GUIDE.md:165-170 says
    non-surfaced flags 'are flipped in DevTools via the
    chrome.storage.local key `xray:flags`'.
- Why 1.0: The `xray/review` kind-1985 vocabulary
    (docs/NIP_DRAFT.md:1152-1155) is the wire's answer to 'I want
    adversarial eyes on this' — the single mechanism by which one group
    member asks another to check their work, and TEAM_CASE_DESIGN §2.4
    makes adversarial review the design's quality core. Requiring
    DevTools to reach it means that for the 1.0 audience the primitive
    does not exist. `extractionAnalysisPublishing` (kind 30070,
    src/portal/extraction-block.js:137) is in the identical position.
- Fix: Add both checkboxes to the Advanced section of
    src/options/options.html using the consent-copy pattern the
    followListPublishing control already uses, wired through setOverride
    in src/options/index.js beside the existing sixteen. Then add a
    guard asserting every key in FLAGS_DEFAULTS is either surfaced in
    options.html or on an explicit devtools-only allowlist.
- **The audit family (30056–30061) has no group path: not in the feed,
  not incorporable, disputes unfileable** *(L, user-visible)*
- Evidence: src/shared/network-feed.js:50 NETWORK_FEED_KINDS omits
    30056–30061. src/shared/incorporation.js:39 PROPOSAL_CLASSES is
    ['claim','link','assessment','verdict'] only. Every 30056–30061
    reference outside the builders is own-events reconciliation
    (src/portal/reconcile.js:43 LEDGERED_KINDS,
    src/portal/inspector.js:53-85). buildAuditDisputeEvent is marked
    'WIRE-FORMAT-ONLY in v1 (no filing UI, no adjudication runtime)' at
    src/shared/audit/builders.js:1059-1060, echoed at
    src/portal/reconcile.js:41.
- Why 1.0: Six kind numbers — the project's largest single wire
    investment — and a group member cannot see, fetch, or respond to
    another member's audit. NIP_DRAFT's headline audit query
    `{"kinds":[30056,30057,30058],"#x":["<article-hash>"]}` ('every
    audit of this exact text', docs/NIP_DRAFT.md:1239) is never issued
    by X-Ray against any author but the user. And 30061 is the
    escalation path TEAM_CASE_DESIGN §2.4 names for disagreeing
    teammates — 'a 30061 dispute or right-of-reply is the escalation
    path, identical for teammates and strangers' — with no way to file
    one.
- Fix: Take the smallest honest slice rather than the whole family: (a)
    issue the `#x` foreign-audit query in the reader's audit panel so a
    teammate's aggregate audit of the same text renders side by side,
    read-only, disagreement-as-data per docs/NIP_DRAFT.md:488; (b) ship
    the 30061 filing UI from the portal inspector against a rendered
    foreign audit or verdict. If neither fits 1.0, say so in NIP_DRAFT's
    reference-implementations paragraph and in ROADMAP — an undelivered
    escalation path documented as normative is worse than one documented
    as deferred.
- **Unknown and unparseable events are dropped from the follows feed
  silently, with no count** *(S, user-visible)*
- Evidence: src/shared/entity-feed.js:114-136 — parseFeedEvent returns
    null on `default:` for any unknown kind and null on any parser
    rejection inside its try/catch; src/shared/network-feed.js:157/196
    `if (!res) continue;`. The feed's only disclosure counter is
    per-author caps (src/shared/network-feed.js:127/197). Parsers reject
    hard on unknown enums — e.g. src/shared/truth-builders.js:368 `if
    (!isValidVerdictState(verdict)) return null;`.
- Why 1.0: CONSTITUTION Art. 12.1 forbids silently filtering 'speech for
    a reader who asked to see it', and a followed teammate's events are
    exactly that. Non-technical groups will run mixed X-Ray versions as
    members update at different times; the moment the format gains an
    additive enum value (which Standard 2 explicitly permits) an older
    member's client drops every new event of that kind with no
    indication anything was there. The strictness is defensible; the
    silence is not.
- Fix: Have parseFeedEvent distinguish 'unknown kind' / 'known kind,
    unparseable' / 'malformed', return the reason instead of a bare
    null, and surface a per-author line in the feed ('3 items this
    version could not read') beside the existing capped counter. No wire
    change — a rendering-honesty change.
- **Entity kind-0 profiles blind-overwrite on keys the collaboration
  bundle hands to every group member** *(M, user-visible)*
- Evidence: src/reader/index.js:6921 and
    src/portal/entity-dossier-view.js:159 both build from purely local
    state and publish — no fetch of the current remote kind 0, no merge,
    no diff. Contrast src/shared/event-builder.js:738
    buildFollowListEvent, whose kind-3 path merges with the remote list
    first. src/shared/case-bundle.js:5-10: the bundle carries entity
    records 'INCLUDING their private keys — so a collaborator who
    imports it tags claims under the SAME entity pubkeys';
    docs/USER_GUIDE.md:1039-1050 promotes this as the way to share a
    case.
- Why 1.0: Standard 7 names this exactly, with the Phase-25 kind-3
    fetch-and-UNION as binding precedent: shared replaceable kinds are
    fetch-and-merge, never blind overwrite. Here the sharing is not
    hypothetical — the documented group workflow distributes one private
    key to every member, and the profile `about` is assembled from each
    member's own local dossier (src/shared/entity-profile.js), so two
    collaborators publishing the same entity produce a silent
    last-writer-wins race on the record every member reads. There is no
    attribution recovery either: same pubkey, so nobody can tell whose
    profile won.
- Fix: Route entity kind-0 publishing through the read-merge-confirm
    shape follow-publish.js already implements: fetch the newest remote
    kind 0 for that pubkey, show the diff against what is about to be
    signed, and require explicit confirm when the remote differs from
    what this install last published (EntityModel already stores
    publishedProfileHash — a mismatch is precisely the signal that
    someone else wrote).

**Should fix**

- **Kind 10002 relay lists are also blind-overwritten** *(S)* —
  src/shared/entity-sync.js:362-367 pushRelayList builds and publishes
  with no remote fetch; src/shared/event-builder.js:703-717 composes
  purely from local prefs. Signed by the dedicated `xray:user` sync key
  (src/sidepanel/index.js:51 USER_KEY_NAME, :1748). → Same Standard 7
  treatment as kind 0. The dedicated sync key limits the blast radius to
  X-Ray's own key rather than the user's primary identity — which is why
  this is should-fix rather than blocker — but the comment at
  entity-sync.js:357 advertises it as 'cross-app compatible', so merge
  is the honest behavior.
- **Right-of-reply and precedent citations exist on the wire and in the
  model but have no authoring UI** *(M)* —
  src/shared/truth-builders.js:146-170 emits `['e', id, relay, 'reply']`
  and precedent `a` tags; the model carries reply_refs
  (src/shared/truth-adjudication-model.js:598,
  src/shared/integrity-model.js:319); consumed for display at
  src/portal/inspector.js:265. But `grep -in "reply"
  src/shared/adjudicate-modal.js src/shared/integrity-modal.js` finds
  nothing — only `exposure` has an input (adjudicate-modal.js:684,
  integrity-modal.js:426). → Add a reply-event-id field to the
  adjudicate and integrity modals. docs/NIP_DRAFT.md:695 promises 'the
  reply travels with it' — a wire promise no user can currently keep,
  and it matters most where group members rule on each other's subjects.
- **The kind-30023 `d` derivation is undocumented, so a second client
  cannot compute the group rendezvous key** *(S)* —
  src/shared/event-builder.js:152 uses
  `EventBuilder.generateDTag(article.url)`, defined at :560-563 as
  `sha256(url).substring(0,16)` over the unnormalized URL.
  docs/NIP_DRAFT.md:1053 references 'the input to the `d` tag' without
  ever stating the formula; no §Kind 30023 section defines it. → Add the
  derivation to NIP_DRAFT (16 hex of sha256 over the verbatim identity
  URL, no normalization at this step — the same honesty the 30040
  section shows at line 137). Two people capturing one URL derive the
  same d under different pubkeys, which is the substrate rendezvous
  TEAM_CASE_DESIGN §1 Level 0 depends on; it should not require reading
  source.
- **The metadata-header strip that defines the `x` hash input is not
  specified** *(S)* — src/shared/audit/article-hash.js:64-68
  stripMetadataHeader uses `/^---\n[\s\S]*?\n---\n\n?/`;
  normalizeForHash at :32-40 is fully specified in
  docs/NIP_DRAFT.md:425, but the strip is described only as 'the leading
  `---…---` block' (docs/NIP_DRAFT.md:1141). → Publish the exact strip
  rule beside the normalization rule. The optional trailing blank line
  changes the hash, and `x` is the identity every audit, extraction
  analysis, and entity-page citation anchors to — 'verify the tag from
  the event alone' is only true if the strip is stated.
- **The `client` tag carries no version, so mixed-version group problems
  are undiagnosable** *(S)* — Every builder emits a bare `['client',
  'xray']` — src/shared/event-builder.js:157, corpus-publish.js:447,
  entity-page-publish.js:135. NIP-89's handler-coordinate form is not
  used. → Emit `['client', 'xray', '<version>']` (or the NIP-89
  `['client','xray','31990:<pk>:<d>']` form). Additive, ignorable, and
  it is what lets a group member answer 'why can't I see your verdict'
  without reading source.
- **Kind 30070 publishes but can never be received over the wire by
  another X-Ray user** *(S)* — Deliberately excluded from
  NETWORK_FEED_KINDS (src/shared/network-feed.js:50; the exclusion is
  pinned by test per docs/JOURNAL.md 2026-07-29 'MA.6: kind 30070, and
  the disclosure posture that got reversed'). The only merge path is a
  backup file — src/shared/extraction-import.js (docs/JOURNAL.md
  2026-08-02 'MA.7: the import verifies instead of trusting'). → The
  exclusion is recorded and reasoned, so this is not a defect — but
  §Kind 30070 should say it plainly. A consumer reading that section
  today would reasonably expect the reference implementation to consume
  what it publishes; state that X-Ray publishes but does not ingest
  30070 over relays, and why (quote re-grounding must run against a
  locally held body).
- **The user guide's flag table asserts publish capability for four
  kinds with no publish path, and omits two shipped ones** *(S)* —
  docs/USER_GUIDE.md:176-181 lists `annotations` (on) as gating
  'Publishing crowdsourced URL annotations (kind 30050)', plus
  factchecks/ratings/helpfulnessVoting — none of which have any caller.
  `extractionAnalysisPublishing` and `storeFirstPublish` are absent
  entirely though both gate real publish behavior
  (src/portal/extraction-block.js:137;
  src/shared/metadata/feature-flags.js:187). → Correct the table to
  match the code once the kill decisions land, and add the two missing
  rows. A non-technical user turning on `factchecks` and seeing nothing
  happen has no way to tell a broken install from a nonexistent feature.
- **Kinds 30068 and 30064 lack the Standard 8 consumers-MUST-NOT-merge
  clause naming their siblings** *(S)* — docs/NIP_DRAFT.md:826 (30068)
  states 'NO fused score, NO verdict' but names no non-mergeable
  siblings; docs/NIP_DRAFT.md:737-738 (30064) gives rendering discipline
  and the no-1985-mirror rule but no merge clause. Compare 30054 (line
  334), 30056 (line 449), 30059 (line 560), 30062 (line 649), each of
  which names its siblings. → Add the one-line clause to both sections
  declaring which aggregation signal each is and which siblings must not
  be merged with it. The Art. 6 firewall holds on the open wire only
  where the shapes carry the clause; strangers do not read prose
  elsewhere in the doc.
- **NIP_DRAFT's Querying section still instructs clients to fetch the
  retired kind 30067** *(S)* — docs/NIP_DRAFT.md:1245-1246 lists
  `{"kinds":[30067],"authors":[…]}` and
  `{"kinds":[30040,30067],"#x":[…]}` as standard queries, while §Kind
  30067 carries a RETIRED 2026-07-20 banner at line 767 and
  src/portal/entity-corpus-view.js:20 confirms 'foreign sheets still on
  relays are simply never fetched.' → Remove both filters from Querying,
  or mark them historical-read-only. Standard 10 requires read paths to
  ignore a retired kind exactly as an ignorant reader would, and the
  Querying section is what a second-client author copies verbatim.
- **The reference-implementations paragraph overstates what several
  kinds can do** *(S)* — docs/NIP_DRAFT.md:1270 says '30060/30061
  builders + parsers implemented, publish paths deferred' but nowhere
  separates the seven kinds with NO emitter at all (9803, 30050–30053,
  30060, 30061) from the kinds that ship. buildAuditDisputeEvent's own
  header says 'WIRE-FORMAT-ONLY in v1 (no filing UI, no adjudication
  runtime)' (src/shared/audit/builders.js:1059). → Restructure that
  paragraph into an explicit per-kind status: emitted / parse-only /
  defined-never-emitted. It is the first thing a second-client author
  reads to decide what is worth implementing.

**Kill candidates**

- **Kinds 30050 (Annotation), 30051 (FactCheck), 30052 (Rating)** —
  Builders exist (src/shared/metadata/builders.js:201, :307, :366), NIP
  sections exist (docs/NIP_DRAFT.md:143, :198, :255), portal labels
  exist (src/portal/library.js:70-72) — and no caller anywhere in src/
  constructs any of them. `grep -rn
  "buildAnnotationEvent\|buildFactCheckEvent\|buildRatingEvent" src/`
  returns only the definitions; every other hit is in tests.
  src/portal/corpus.js:40 calls them 'dormant metadata kinds (flag-gated
  writers)' — there are no writers. The `annotations` flag is default-ON
  and gates nothing. *(cost of keeping: Three kind numbers permanently
  spent on a promise nothing keeps, three NIP sections a second-client
  author will implement and then find no events for, and a user-guide
  row (docs/USER_GUIDE.md:176) telling non-technical users they can
  publish annotations. Nothing has ever emitted them, so retirement is
  free today and a permanent promise after 1.0.)*
- **Kind 30053 (TopicTrust)** — Same shape — builder at
  src/shared/metadata/topic-trust-builder.js:61, NIP section at
  docs/NIP_DRAFT.md:304, no caller. docs/JOURNAL.md 2026-07-21 ('The 7/3
  consensus descope was sprint-scoped, not doctrine') records that 30053
  'is consumable by composeGraph but never fetched' and that the seam
  exists only to stay open. *(cost of keeping: A trust-assertion kind
  with neither producer nor consumer. That same JOURNAL entry frames
  revival as 'casework-pulled, never by grand plan' — an argument for
  retiring the number and minting a fresh one if casework ever pulls it,
  not for holding it.)*
- **Kind 9803 (HelpfulnessVote)** — Builder at
  src/shared/metadata/builders.js:388-414 with no caller; the
  `helpfulnessVoting` flag has no UI; the bridging ranker it feeds is
  unbuilt. It is also the one kind this project DEFINED that never made
  it into the Art. 10 schedule at all (docs/CONSTITUTION.md:411-427).
  *(cost of keeping: A vote primitive with no voter and no counter,
  documented at docs/NIP_DRAFT.md:277 as 'the atomic input to
  bridging-based ranking algorithms' for a ranking layer docs/JOURNAL.md
  2026-07-21 records as gated 'empirically, not philosophically' on a
  network with roughly one participant.)*
- **src/shared/metadata/ranker.js and the bridgingRanking /
  transitiveTrust flags** — `grep -rn "ranker" src/` finds the module
  imported by nothing — only two comments referring to it
  (src/shared/metadata/feature-flags.js:14 and
  src/shared/network-trust.js:9, the latter stating 'ranker.js stays
  unwired') plus one test file. Neither flag gates anything in src/ and
  neither has UI. *(cost of keeping: Dead code in the shipped bundles
  and a user-guide row (docs/USER_GUIDE.md:200) saying 'not yet
  shipped', which for a 1.0 aimed at non-technical users reads as a
  promise rather than a note.)*
- **Kind 30060 (DossierSnapshot)** — buildDossierSnapshotEvent
  (src/shared/audit/builders.js:931) has only test callers;
  src/portal/reconcile.js:41 records that 30060 and 30061 'have no
  publish path'. Its own NIP section (docs/NIP_DRAFT.md:564) describes
  it as 'a cache, latest-wins by design' whose canonical truth is the
  underlying audit events, instructing consumers to 'prefer
  re-derivation when they hold the underlying events'. *(cost of
  keeping: A kind number spent on a materialized cache the spec itself
  tells consumers not to trust over re-derivation, with no producer. If
  the audit family gains a cross-user read path (blocker 6),
  re-derivation is exactly what it will do.)*
- **The default-ON `annotations` and `topicTrust` flags** — Both default
  true at src/shared/metadata/feature-flags.js:24 and :26, both gate
  publish paths that do not exist, and both appear in the user-facing
  flag table as capabilities (docs/USER_GUIDE.md:176, :178). *(cost of
  keeping: Two ON switches that do nothing, presented to a non-technical
  audience as active publishing features. If their kinds are retired the
  flags go with them; if the kinds are kept, the flags should be
  default-off scaffolding like every other publish gate.)*

**Doc gaps**

- docs/NIP_DRAFT.md has no section for kind 30041 (captured comments),
  emitted since the Substack work and republishing third parties' text
  under the capturer's key — the exact situation the 2026-07-09 JOURNAL
  entry fixed for 32125.
- docs/NIP_DRAFT.md has no section for kind 30078 (entity sync), listed
  active in CONSTITUTION Art. 10 and emitted at
  src/shared/event-builder.js:685.
- CONSTITUTION Art. 10's schedule omits kind 9803 (project-defined,
  emitted-capable), kind 1 (mention notes, emitted), and kind 5
  (deletion requests, emitted at src/shared/entity-sync.js:483) — and
  the guard at tests/constitution-guards.test.mjs:201 never checks the
  emitted set against the table.
- The kind-30023 `d` derivation (sha256 of the verbatim URL, first 16
  hex — src/shared/event-builder.js:560-563) appears nowhere in
  NIP_DRAFT, so the article coordinate two collaborators share for one
  URL cannot be computed from the spec alone.
- The metadata-header strip regex that defines the `x` hash input
  (src/shared/audit/article-hash.js:64-68) is described only as 'the
  leading `---…---` block' at docs/NIP_DRAFT.md:1141, leaving the hash
  unreproducible at the margin.
- The dual meaning of `x` on kind 30023 (own-body hash vs. cited-member
  hashes on entity pages and case briefs) is documented per-section but
  contradicted by the §`x` tag extension at docs/NIP_DRAFT.md:1133-1141,
  which states only the self-hash meaning.
- The Querying section (docs/NIP_DRAFT.md:1245-1246) still lists two
  filters for the retired kind 30067, contradicting the RETIRED banner
  at line 767.
- The entity-page `d` (`xray-entity-page:<entityId>`,
  docs/NIP_DRAFT.md:750) does not flag that `entityId` is the author's
  reader-local id, though the 32125 section at line 944 flags exactly
  that property for exactly that reason.
- The reference-implementations paragraph (docs/NIP_DRAFT.md:1270) does
  not separate kinds that ship from kinds defined and never emitted
  (9803, 30050–30053, 30060, 30061), so a second-client author cannot
  tell what is worth implementing.
- docs/USER_GUIDE.md:176-181 promises publishing for four kinds with no
  publish path and omits `extractionAnalysisPublishing` and
  `storeFirstPublish`, which do gate real publishing.

**Machine-enforceable candidates**

- NIP_DRAFT parity guard (Standard 3 graduation): every kind literal
  found at an emission site under src/ must have a matching `## Kind
  <n>` heading in docs/NIP_DRAFT.md — reuses the walkJs + regex scan
  already in tests/constitution-guards.test.mjs:201-223.
- Art. 10 schedule parity guard (Standard 5): every kind literal found
  at an emission site under src/ must appear in the CONSTITUTION Art. 10
  table, and no retired/free/reserved kind may appear — extends the
  existing guard from its negative half to both halves.
- Tolerance test (Standard 6 graduation): feed each exported parse*
  function a valid fixture augmented with an unknown tag, an unknown
  enum value in its vocabulary slot, and an unknown 4th-position role
  marker; assert no throw, and assert the unknown-enum case yields a
  surfaced reason rather than a bare null.
- CI grep over the PR body for the literal string 'Wire format:'
  whenever the diff touches event-builder.js, metadata/builders.js,
  audit/builders.js, truth-builders.js, topic-trust-builder.js,
  mention-notes.js, or any *-publish.js (Standard 1 graduation; the
  heading literal is owned by this discipline).
- Flag-surface guard: every key in FLAGS_DEFAULTS must either appear in
  a setOverride call in src/options/index.js or be listed in an explicit
  DEVTOOLS_ONLY allowlist constant in feature-flags.js — so a shipped
  publish gate can never again be reachable only from DevTools.
- Replaceable-citizenship guard (Standard 7): every call site publishing
  kind 0, 3, or 10002 must route through a shared fetch-and-merge
  helper; a direct build-then-publish of those kinds fails the pin, with
  follow-publish.js as the reference implementation.

### verification-engineer

The suite is genuinely good — 2513 tests, 0 failures, 7.5 seconds wall
time — and that speed is the project's strongest verification asset. But
it observes almost nothing that has actually bitten this project, and
the layers that could observe those things either do not exist or are
not runnable. docs/SMOKE_TEST.md is nominated as the release gate by
CONTRIBUTING.md step 3, yet it is 559 manual rows whose Setup block
states three mutually inconsistent stale test counts (1277, 1018, vs the
real 2513) and a seven-bundle list against ten esbuild entry points;
only ~13 rows are classified agent-verifiable and only four rows touch
Firefox at all. There is no walk ledger anywhere, so the 164 commits and
21,384 inserted lines since v0.8.0 are, on the record, unwalked — and
the one defect class the project has already diagnosed in writing (a
publish surface stamping "Published" on zero confirmed relays, JOURNAL
2026-08-02) is still live in two surfaces because the guard written for
it was scoped to a single file. For an audience that cannot read source,
the two remaining safety nets — the console and the bug-report form —
are also degraded: the intake template still describes a floating action
button removed in June 2026 and omits Local, the default signing method.

**Blockers**

- **Entity Page and Case Brief publish say "Published" when no relay
  confirmed — one of them writes a durable ledger stamp** *(S,
  user-visible)*
- Evidence: src/portal/entity-page-block.js:420 sets `resp = { ok: true,
    results: gated.results }` unconditionally, then :425 writes
    `publishedAt`/`publishedEventId` and :426 prints "Published —
    readable in any NOSTR client."; `gated.confirmedOk` is never read.
    src/portal/synthesis-block.js:582/:586/:590 has the identical shape
    for the case-brief pair. The correct pattern is three files away at
    src/portal/extraction-block.js:226 (`if (!gated.confirmedOk)`) →
    :237 stamp, and src/portal/entity-dossier-view.js:152–156.
    docs/JOURNAL.md 2026-08-02 "The MA.6 browser walk found a false
    'published' stamp" names entity-page-block.js and synthesis-block.js
    explicitly as carrying the same disease and records the fix as
    deferred to the 29.1 choke point; the choke point landed, these two
    call it and discard its verdict.
- Why 1.0: A group researcher publishes an entity page or a case brief,
    is told it is readable in any NOSTR client, and it reached no relay.
    Collaborators see nothing; the local record says published, so the
    retry never happens and the surface will not re-offer it. A
    non-technical user has no way to detect this — the reader and portal
    both paint correctly, and the relay is the only witness. This is
    precisely the failure mode the project already diagnosed and wrote
    down.
- Fix: Read `gated.confirmedOk` at both sites before any stamp or
    success string, mirroring extraction-block.js:226–236 including the
    distinguishable assumed-only wording; then widen the guard
    (machine_enforceable #3) so the class, not the instance, is
    observed.
- **No verification-debt / walk ledger exists, so the 1.0 candidate's
  21k-line delta is unwalked on the record** *(M)*
- Evidence: verification-engineer SKILL.md Standard 8 states "The ledger
    does not exist yet: this skill creates it on its first tag-time run"
    and "A completed walk that goes unrecorded is indistinguishable from
    one never run." docs/SMOKE_TEST.md has no ledger at its top (lines
    1–70 are scope, Setup, prereqs, pass-criteria key). `git describe` →
    v0.8.0; `git log v0.8.0..HEAD` → 164 commits; `git diff --stat
    v0.8.0..HEAD -- src/ tests/` → 134 files, 21,384 insertions, 25 new
    src files, touching src/shared/publish-gate.js, event-journal.js,
    extraction-publish.js, corpus-publish.js. The only dated walk
    records anywhere are the Companion section header
    (SMOKE_TEST.md:1281 "Walked 2026-08-08 — all rows passed") and the
    MA.6 walk in JOURNAL 2026-08-02.
- Why 1.0: Until now the ledger was the maintainer's memory, which was
    sufficient because he was the only user. Shipping to strangers in
    groups means a defect costs other people's research time, and there
    is currently no artifact that could answer "what did we verify
    before we shipped this to them?" The 2026-08-02 entry proves the
    failure is silent in the safe-looking direction: three skills and a
    release-readiness summary propagated a stale walk claim for weeks.
- Fix: Create the ledger as a table at the top of docs/SMOKE_TEST.md
    recording walks PERFORMED with date, browser, build SHA, and
    sections covered; seed it with the two known entries (Companion
    C.1–C.7 2026-08-08; MA.6 2026-08-02) and leave everything else
    visibly empty. Then walk the delta sections since v0.8.0 and record
    the result — including sections deliberately not walked, with the
    accepted-risk sentence CONTRIBUTING/CHANGELOG requires.
- **The named release gate is not runnable, so in practice there is no
  release gate** *(L)*
- Evidence: CONTRIBUTING.md:151–154 makes docs/SMOKE_TEST.md the
    tag-time gate ("Run the smoke test … in Chrome and Firefox … only
    tag once the breakages are fixed"). The doc is 1562 lines / 559
    numbered rows across 44 sections (counted by heading), several
    requiring an Anthropic API key with real spend (13.7c–h, 20.i,
    P28.j, AV.e–j, OP.b–h), two browser profiles (11b.8–13, 25.x,
    6.1–6.6), the Python companion service (C.1–C.7), a NIP-07 signer,
    and a paywalled article. Its own §Reporting closes at :1558–1561
    with "post a comment on issue #1 … That's the closest thing X-Ray
    currently has to a release-blocker checklist."
- Why 1.0: A gate nobody can complete is not a gate, and its existence
    suppresses the search for one that would fit the budget. With agents
    authoring every PR, the write rate has outrun the one human verifier
    — exactly the binding constraint the discipline names — and 1.0 is
    the first release whose failures land on people who cannot diagnose
    them.
- Fix: Split the document: a short, mandatory release gate (the paths a
    stranger hits in their first hour — install, capture, publish,
    archive banner, backup/restore, one collaboration handoff), and an
    archived per-phase appendix retained for reference (Art. 3 —
    retired, not deleted). Classify every gate row agent-verifiable or
    needs-human-eyes per Standard 5, and drive the agent-verifiable set
    from tools/smoke/.
- **Firefox is a declared, advertised target with essentially no
  verification** *(M, user-visible)*
- Evidence: README.md:1–2 advertises a "Chrome / Firefox WebExtension";
    CONTRIBUTING.md:107–128 pins gecko strict_min_version 128 as
    load-bearing for three APIs. Verification: .github/workflows/ci.yml
    runs only `web-ext lint --self-hosted` (no Firefox execution);
    docs/SMOKE_TEST.md's Firefox section is three rows (F.1–F.3,
    :1173–1178) covering Phase 2 + Substack only, plus one row asking to
    repeat six portal rows (12.28, :532). Nothing on Firefox covers the
    reader publish flow, side panel vs sidebar_action fallback, portal,
    network client, pdf-engine/pdf.worker bundles, or the companion flow
    — and JOURNAL 2026-04-22 "Entity sync NIP-04 fallback works in
    Firefox, fails in Edge" is the project's own evidence that the two
    engines diverge.
- Why 1.0: A non-technical group will not all be on Chrome. Today a
    Firefox user's first failure is undiagnosable by them and
    unreproducible by the maintainer, because no one has ever exercised
    those surfaces there. Either the claim is verified or the claim
    should be narrowed before strangers act on it.
- Fix: Either (a) run the new short release gate on Firefox 128 ESR and
    record it in the ledger, or (b) make the honest narrowing —
    README/CHANGELOG state Firefox is community-supported and unverified
    for surfaces beyond capture — and record the choice. Adding `web-ext
    run` against a seeded profile to the agent-runnable set is the cheap
    middle path.
- **The companion service — the one component a non-technical user must
  install by hand — has tests that no CI ever runs** *(S)*
- Evidence: companion/transcriber/tests/ holds 657 lines across
    test_cloud_providers.py, test_normalize.py, test_server_keys.py
    against 1,478 lines of runtime (server.py 488, jobs.py 268,
    pipeline.py 204, worker.py 113, download.py 91, config.py 86). `grep
    -rn "python|pytest|uv " .github/workflows/` returns nothing —
    neither ci.yml nor release.yml touches it. Every companion
    regression on record was found by a live local run: JOURNAL
    2026-08-02 "AssemblyAI hard-deprecated `speech_model` (found on
    first live smoke)", 2026-08-02 "torch cu130 broke ctranslate2", and
    the companion/transcriber/pyproject.toml:80–81 comment "this runs
    whisperx ahead of its tested matrix — smoke-test one real
    transcription after any re-lock."
- Why 1.0: Transcription is the feature most likely to draw
    non-technical researchers (audio/video evidence), and it is the only
    one requiring a terminal, a Python toolchain, and a GPU stack. Their
    setup failure is the maintainer's support burden. Running the tests
    that already exist is nearly free and would catch the pure-logic
    half (provider request shapes, key handling, normalization) that has
    demonstrably broken twice.
- Fix: Add a CI job that installs uv and runs `pytest
    companion/transcriber/tests`, gated to changes under companion/**.
    It cannot observe GPU/model behavior — state that limit in the job
    comment so the green does not overclaim.
- **The companion auth token is rendered back into a visible text input,
  and no observer exists for the class** *(S, user-visible)*
- Evidence: src/options/index.js:1208
    `document.getElementById('pref-transcriber-token').value = await
    llmRawGet(TRANSCRIBER_TOKEN_STORAGE);` against
    src/options/options.html:624 `<input type="text"
    id="pref-transcriber-token">`. Three lines below, :1210–1211 states
    the governing rule — "never the key VALUES — the LLM-key rule: the
    DOM only ever learns whether one is set" — and :1216–1219 obeys it
    for the AssemblyAI/Deepgram keys (status only, `.value = ''`). No
    test enforces it: `grep -rln "llmRawGet|only whether one is set"
    tests/` returns nothing, while tests/custody-guards.test.mjs:54
    ("custody: entity-key signing sites in src/ are pinned — a new one
    must confront this rule") proves the source-literal pin pattern is
    already in the project's vocabulary. JOURNAL 2026-08-08 records the
    adjacent live failure: a Hugging Face token pasted into this same
    field.
- Why 1.0: Group researchers screen-share and screenshot their settings
    when helping each other set up — that is the normal shape of "doing
    this together." A field that re-displays a stored shared secret
    makes leaking it the default outcome of asking for help. The rule
    already exists in this file; only the enforcement is missing.
- Fix: Stop echoing the stored value (status line + `type="password"` on
    entry, matching the cloud-key fields), and add the guard so the next
    secret field cannot repeat it.
- **The bug-report intake form describes UI removed in June 2026 and
  omits the default signing method** *(S, user-visible)*
- Evidence: .github/ISSUE_TEMPLATE/bug.yml:2 description reads
    "Something broke — FAB doesn't show, publish fails…" and the
    what-happened placeholder reads "the Capture panel opened but the
    Markdown tab was empty." docs/JOURNAL.md 2026-06-09 "De-FAB: one
    capture surface (Phase A of the cleanup)" removed both;
    docs/SMOKE_TEST.md:12–18 carries the standing banner "Capture model
    (no FAB). There is no in-page floating button or capture panel." The
    signing dropdown (bug.yml, id `signing`) offers NIP-07 / NSecBunker
    / None / Not sure — Local, the default and the method
    SMOKE_TEST.md:49–51 recommends for first-time setup, is absent.
- Why 1.0: Once the user cannot read source, the intake form is the last
    observer in the chain. A form describing a button that does not
    exist teaches a first-time reporter that they misunderstand the
    product, and the missing Local option means the modal user must
    answer "Not sure" about the one field that most changes triage.
- Fix: Rewrite the description and placeholder around the real capture
    triggers (toolbar icon / Ctrl+Shift+X / right-click), add Local
    (default) to the signing dropdown, and add a field for the build
    stamp the Options header already renders
    (src/options/options.html:12 `#xr-build-info`) so reports carry an
    exact build rather than a version string.

**Should fix**

- **The PR template has no coverage-by-layer declaration, so Standard 1
  is unenforceable at the only point it could be enforced** *(S)* —
  .github/pull_request_template.md "How I tested" offers four checkboxes
  (Chrome, Firefox, web-ext lint, real relay) and no line naming which
  layer observes the change's principal risk, and no `no-test
  rationale:` line. verification-engineer SKILL.md Standard 1 requires
  the declaration in every PR touching src/, and Standard 2's graduation
  clause names that exact literal. → Add a required "Verification layer"
  section: which of unit / guard / agent-runnable smoke / live walk
  observes the principal risk, or the explicit "none — accepted because
  <reason>" sentence, plus a `no-test rationale:` line for `fix:` PRs.
  Since agents author every PR, the template is the cheapest enforcement
  surface available.
- **Six of thirteen platform modules have no unit test at all, including
  the two highest-churn handlers** *(M)* — Mapping every
  src/shared/platforms/*.js against tests/: arxiv, facebook, instagram,
  pmc, scholar-meta, tiktok, youtube-comments have tests;
  comment-extractor.js (252 lines), index.js (218, the dispatcher),
  substack.js (114), substack-api.js (384), twitter.js (545), and
  youtube.js (1027) have none — 2,540 of 6,476 lines in the directory.
  JOURNAL 2026-04-19 "pattern: YouTube DOM arms race", 2026-04-21
  "YouTube transcript: 3× cue duplication in the new DOM", and
  2026-04-21 "Twitter capture: focal-tweet id leaked through as the
  literal string 'null'" all live in the untested set. → Extract the
  pure functions from youtube.js and twitter.js (URL grammar, segment
  dedup, focal-tweet id resolution, thread ordering) the way
  facebook.test.mjs and tiktok.test.mjs already do for their handlers,
  and add the Standard 6 guard so a new handler cannot land testless.
- **No canary manifest exists for external surfaces, so third-party
  drift is detected only by a human noticing** *(M)* —
  verification-engineer SKILL.md Standard 6 requires a recorded canary
  URL per handler and a canary exercise per external request shape.
  `grep -n "canary" docs/SMOKE_TEST.md` returns nothing; the only URLs
  are inline examples inside per-phase rows (e.g. :257 a YouTube watch
  URL, :245 "any free Substack post"). JOURNAL 2026-08-02 records
  AssemblyAI's `speech_model` hard-deprecation dying on the very first
  live job. → Add a checked-in canary manifest (handler → URL → expected
  console landmark) plus one request-shape exercise each for the cloud
  providers, a relay, and the companion; run it as the agent-runnable
  pass before a tag. A surface allowed to fail ships marked with the ⚠️
  convention and a JOURNAL reference.
- **The one proven browser-walk harness cannot be run by the maintainer
  or by CI** *(M)* — tools/smoke/ma6-walk.mjs:29–33 hardcodes
  `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` and
  `/opt/node22/lib/node_modules/playwright/index.mjs` as defaults;
  playwright is not in package.json devDependencies; there is no npm
  script for it. JOURNAL 2026-08-02 records that this walk found a real
  bug unit tests structurally could not see and that "'headless, so it
  can't be smoked' was an assumption, not a fact" — repeated verbatim in
  four PR descriptions. → Add playwright as a devDependency, resolve the
  browser via playwright's own download, add `npm run smoke:walk`, and
  generalize the seed harness so a second walk (publish confirmation,
  backup/restore round-trip) costs a file rather than a rewrite.
- **Two of the three IndexedDB stores have no staged-upgrade test, and
  their assertion messages claim otherwise** *(S)* —
  tests/audit-cache.test.mjs contains no `indexedDB.open` at a lower
  version — every test opens at DB_VERSION 7, so `ev.oldVersion` is
  always 0 and all seven branches in
  src/shared/audit/audit-cache.js:113–171 run at once; yet the test at
  :121 asserts with the message "v1 intact after v3 upgrade".
  tests/archive-cache.test.mjs likewise never seeds v1/v2. The contrast
  is tests/event-journal-migration.test.mjs:1–6, which explicitly
  "seed[s] a REAL v1 database, then let[s] the module open it at v2." →
  Seed a real v3 (and v6) xray-audits database with rows, reopen at 7,
  and assert the rows survive — the branches are additive and
  existence-guarded, so this is expected to pass, which is exactly what
  makes it cheap. At minimum, correct the assertion messages so they do
  not claim an upgrade the test never performs.
- **The release zip has never been installed or walked, and ships the
  repo's internals** *(S)* — Built locally from this tree: `web-ext
  build --source-dir .` produces 798 entries / 11.35 MB, containing
  dist/ (30.1 MB uncompressed, incl. 10 `.bundle.js.map` files), src/
  (4.17 MB), docs/ (2.11 MB, including JOURNAL.md and every kickoff),
  tests/ (2.09 MB, 201 entries), tools/, scripts/, esbuild.config.mjs,
  package-lock.json, CLAUDE.md, and
  _metadata/generated_indexed_rulesets. package.json
  `webExt.ignoreFiles` excludes only `companion`. Every install
  instruction (SMOKE_TEST.md:29–43, CONTRIBUTING.md:43–46) says "Load
  unpacked → repo root"; no step installs the artifact release.yml
  produces. → Extend `webExt.ignoreFiles` to tests/, docs/, tools/,
  scripts/, _metadata/, esbuild.config.mjs, package-lock.json, CLAUDE.md
  and the `.map` files; then add one release-gate row: install the built
  .zip into a clean profile and capture+publish once. The artifact under
  test should be the artifact shipped.
- **ROADMAP still advertises the Phase 16 and 19 walks as pending, after
  the correction that claimed both files were fixed** *(S)* —
  docs/ROADMAP.md:1473 "## Phase 16 — Moral-lens evaluation
  (lens-readings) ✅ shipped — smoke run pending" and :1688 "§Phase 19
  SMOKE walk pending (manual)." docs/JOURNAL.md 2026-08-02 "The Phase
  16/19 walks were done; only the docs said otherwise" records both
  files as corrected and states "no section walk is outstanding"; the
  summary paragraph (:215–220) and the phase table (:60–94) were indeed
  fixed, the per-phase body sections were not. → Correct both lines.
  This is a live instance of the very propagation failure that entry
  derived the walk ledger from — worth a one-line JOURNAL note that the
  correction sweep was itself incomplete.
- **The agent-runnable subset is pinned to a version and a phase range
  that no longer exist** *(M)* — docs/SMOKE_TEST.md:100 expects the
  console line `[X-Ray] Starting X-Ray content script v0.5.x`;
  src/content/index.js:30 emits `CONFIG.version`, currently 0.8.0. The
  per-phase agent-coverage table (:149–163) ends at "Polish #2" and
  covers Phases 2–7 — nothing for Phases 11–29, R5, AV, EP, or the
  companion panel, i.e. roughly 460 of the 559 rows are unclassified
  against Standard 5. → Drop the hardcoded version from the expected
  console line, and classify every section agent-verifiable /
  needs-human-eyes (with the reason inline for the latter) as part of
  the split in blocker #3.
- **Smoke rows 0.6 and C.1 describe a four-item context menu; the
  service worker registers eight** *(S)* — docs/SMOKE_TEST.md:200 (0.6)
  and :1162 (C.1) both say the toolbar right-click menu has "Toggle
  Capture / Entity Browser / Settings… / Capture tips" — four items, one
  of which ("Toggle Capture") has not been a menu title since JOURNAL
  2026-06-09. src/background/index.js registers eight: Capture this page
  (:108), Capture & transcribe (:122), Open Entity Browser (:133), Open
  My Archive (:138), Open Network (:144), Open a PDF by URL… (:150),
  Settings… (:155), Capture tips (:165). → Rewrite both rows against the
  registered set, noting which items are flag-gated (transcribe,
  network) so a tester whose menu is shorter knows why.
- **The version-lockstep check runs only at tag time, so a mismatch can
  sit on main** *(S)* — .github/workflows/release.yml:49–70 verifies tag
  == package.json == manifest.json; .github/workflows/ci.yml has no
  version step at all (its only `version` hits are `node-version` and
  `--version` echoes). CLAUDE.md states flatly "CI rejects a mismatch."
  → Move the package.json/manifest.json equality check into ci.yml (the
  tag comparison stays in release.yml). Cheap, and it makes the
  CLAUDE.md sentence true.
- **gatePublish's confirmed predicate is re-derived by hand at a call
  site instead of read from the gate** *(S)* —
  src/portal/entity-dossier-view.js:152–156 recomputes `confirmed` from
  `results.confirmed` or by filtering `r.success && !r.assumed`,
  duplicating src/shared/publish-gate.js:52 `confirmedCount`, which the
  gate already exposes as `confirmedOk`. The behavior is correct today;
  the duplication is a second place for the JOURNAL 2026-07-10 rule to
  drift. → Read `gated.confirmedOk` and delete the local derivation, so
  there is exactly one definition of acceptance for the guard in
  machine_enforceable #3 to pin.

**Kill candidates**

- **docs/SMOKE_TEST.md as a single monolithic document nominated as the
  release gate (CONTRIBUTING.md:151)** — 559 rows across 44 sections
  accreted phase by phase; the header (:5) still scopes it to "Phases
  0–16 + the v0.5.x cleanup" and estimates "~20 minutes … a half-day"
  for something now roughly five times that. It cannot be run, so it is
  not consulted, so it rots — the three inconsistent test counts in its
  own Setup block are the proof. *(cost of keeping: The gate stays
  fictional; every tag is cut on the maintainer's memory, and 1.0 ships
  to strangers with no artifact stating what was verified. Retire it as
  the gate and preserve it as an archived per-phase appendix (Art. 3 —
  recorded, git-recoverable).)*
- **The per-phase agent-coverage table, docs/SMOKE_TEST.md:149–163** —
  Written 2026-04-21 against Phases 2–7 plus "Polish #2"; it has not
  grown with the ~30 sections added since, and its Phase-7 row
  ("Nothing. The unit tests simulate this state machine; they cannot
  drive it") is now contradicted by the MA.6 walk, which drove exactly
  that class of surface. *(cost of keeping: It reads as the
  authoritative statement of what an agent can verify and understates it
  by roughly an order of magnitude — which is how "this cannot be
  smoked" came to be repeated in four PR descriptions. Replace with the
  Standard-5 classification applied to every section.)*
- **The "Suggested agent-driven loop" pseudocode block,
  docs/SMOKE_TEST.md:164–187** — A prose sketch of a script (`for
  platform in [YouTube, Substack, X, WordPress-blog]`) that was never
  written, with a step-numbering bug (steps 3–5 duplicate the click).
  tools/smoke/ma6-walk.mjs is the real, working version of the idea and
  does not reference it. *(cost of keeping: It occupies the slot where a
  runnable canary pass should be, and its presence makes the gap look
  filled.)*
- **docs/SMOKE_TEST.md Phase 1, row 1.1 — "npm test --
  --test-name-pattern crypto → 13 crypto + 5 nip44 tests pass"** — A
  manual row asserting a count that `npm test` already asserts, stated
  in hardcoded numbers of the same drift class as the "1277/1277" two
  dozen lines above it. *(cost of keeping: Trivial alone, but it is the
  template other rows copied; removing it and the hardcoded counts is
  what makes the Standard-4 guard writable.)*
- **Issue #1 as the de facto release-blocker checklist
  (docs/SMOKE_TEST.md:1558–1561)** — The doc names it honestly — "That's
  the closest thing X-Ray currently has to a release-blocker checklist"
  — which is an admission, not a design. A comment thread on one issue
  cannot be read as a gate, diffed between releases, or checked by CI.
  *(cost of keeping: It is a large part of why the walk ledger does not
  exist: the record has a nominal home that nobody treats as one.
  Superseded by the ledger at the top of SMOKE_TEST.md (Standard 8).)*

**Doc gaps**

- docs/SMOKE_TEST.md:26 Setup says "npm test # 1277/1277 should pass";
  the suite reports `tests 2513 / pass 2513 / fail 0` in 7.5s (run
  2026-08-08, node v24.18.1).
- docs/SMOKE_TEST.md:25 says "npm run build # produces dist/*.bundle.js
  (7 bundles)" and row 0.1 (:195) lists seven by name;
  esbuild.config.mjs declares ten entry points — the seven listed plus
  network, pdf-engine, and pdf.worker.
- docs/SMOKE_TEST.md row 0.2 (:196) gives a THIRD count, "1018/1018 (or
  current-on-main count)" — the same document states two different stale
  numbers 170 lines apart.
- esbuild.config.mjs:3–13 header comment: "Produces seven bundles under
  `dist/`" with a seven-line list — the build file is itself the drift
  source SMOKE_TEST copied.
- docs/SMOKE_TEST.md:4–6 scopes the document to "Phases 0–16 + the
  v0.5.x cleanup" and estimates "~20 minutes per browser; a full pass
  through the Phase 11–16 sections is a half-day"; sections now run
  through Phase 29 and R5 across 559 rows.
- docs/SMOKE_TEST.md:100 pins the expected init log to "v0.5.x";
  src/content/index.js:30 emits CONFIG.version, currently 0.8.0.
- README.md "## Status" says "**v0.7.0** (tagged 2026-07-16)"; `git tag`
  shows v0.8.0 tagged, package.json/manifest.json are 0.8.0, and
  CHANGELOG.md carries a `[0.8.0] — 2026-07-20` section.
- CONTRIBUTING.md:72–73 and CLAUDE.md both say Utils.log/Utils.error are
  "no-ops when CONFIG.debug is false"; src/shared/utils.js:110–111 shows
  only `log` is gated — `error` always writes to console. The behavior
  is the right one; the docs understate the product's diagnosability to
  the people who most need it.
- docs/THREAT_MODEL.md does not exist though security-threat-modeler
  Standard 1 requires it and .claude/skills/README.md's preflight step B
  assigns a "drift check: new surfaces since last tag against the threat
  model." Referred there, not adjudicated here — but note that with no
  threat model there is also no layer assignment for security risks at
  tag time.
- No walk ledger at the top of docs/SMOKE_TEST.md (Standard 8); the only
  dated walk evidence in the tree is the Companion section header
  (:1281, "Walked 2026-08-08 — all rows passed") and JOURNAL
  2026-08-02's MA.6 entry.

**Machine-enforceable candidates**

- Guard test: regex-ban hardcoded test counts (`\d{3,}/\d{3,}` adjacent
  to "pass") and bundle counts in docs/SMOKE_TEST.md, CLAUDE.md, and
  esbuild.config.mjs's header; assert the named bundle list equals the
  outfile basenames parsed from esbuild.config.mjs.
- Guard test: every src/shared/platforms/*.js is imported by at least
  one tests/*.test.mjs — the Standard 6 graduation clause, currently
  failing for comment-extractor, index, substack, substack-api, twitter,
  and youtube.
- Guard test (generalize tests/extraction-publish.test.mjs:435): for
  every src/** file importing gatePublish, if it writes a `published*`
  field or prints a success string, assert `confirmedOk` appears and
  that its index sits between the `gatePublish({` call and the write —
  currently violated by src/portal/entity-page-block.js and
  src/portal/synthesis-block.js.
- Guard test: no Options field whose id maps to a secret storage
  constant (*_TOKEN_STORAGE, *_KEY_STORAGE) may be assigned `.value =
  await llmRawGet(...)`, and every such input carries `type="password"`
  in options.html — the rule stated at src/options/index.js:1210 with no
  observer today.
- CI job: install uv and run `pytest companion/transcriber/tests` on
  changes under companion/**, with a comment stating it cannot observe
  GPU/model behavior so the green does not overclaim.
- CI: move the package.json ↔ manifest.json version-equality check out
  of release.yml:49–70 into ci.yml, so a mismatch fails on the PR rather
  than at tag time (CLAUDE.md already claims this is true).

### security-threat-modeler

X-Ray's security posture is better than its documentation: relay ingest
is signature-verified on every read path
(src/shared/nostr-events.js:87-110, wired at nostr-client.js:246), the
loopback pin for the companion and LM Studio is real and guard-tested
(transcriber-client.js:93-108, tests/transcriber-client.test.mjs:57-76),
the 2026-06-10 bundle `keyName` exfiltration bug is properly fixed with
a comment naming the attack (case-bundle.js:171-178), and the
credential-echo defect the mission handed me has exactly one instance —
the sibling audit of every `.value =` assignment in src/ came back
clean. But the map that would make that posture legible does not exist:
docs/THREAT_MODEL.md is referenced only inside the skill that demands
it, and three of the tree's widest surfaces are described in the docs as
narrower than they are — most seriously `rules/csp-strip.json`, which
README.md:333/393 and CLAUDE.md:240 all call "strip CSP for the YouTube
transcript fetch" while the rule as written removes CSP from every
main_frame and sub_frame on every site the user visits. The 1.0 audience
shift lands hardest on the import paths: `mergeBackup` is the
group-sharing door, its own header and its confirmation dialog both
promise that identities are ignored, and it nonetheless accrues
`local_keys` — which is where the `xray:user` entity-sync private key
lives — so a new group member who merges a colleague's file can silently
inherit that colleague's sync identity. The NIP-07 signing bridge is the
other 1.0 gap: it accepts a signed event back from the captured page on
a sequential, guessable request id with no signature or pubkey check, on
the exact tab CLAUDE.md routes publish-signing through.

**Blockers**

- **mergeBackup accrues `local_keys`, so a colleague's file can install
  their entity/sync private keys — including the `xray:user` sync
  identity** *(M, user-visible)*
- Evidence: src/shared/workspace-keys.js:22-42 lists `local_keys` in
    WORKSPACE_CONTENT_KEYS; src/shared/backup.js:495 merges every key in
    WORKSPACE_CONTENT; src/shared/backup.js:31-32 header claims "Install
    config and the primary identity are NEVER touched by a merge";
    src/options/index.js:961 tells the user "the file's
    settings/identities are ignored"; `xray:user` is an ordinary name in
    that map (src/sidepanel/index.js:51 and :1626-1634);
    tests/backup-merge.test.mjs asserts `local_primary_identity` and
    `xray:llm:key` survive (lines 218-220) but never mentions
    `local_keys`
- Why 1.0: Merge-import is THE group-collaboration path —
    backup.js:24-32 and options/index.js:941-944 describe it as "a
    colleague's backup" folding in — and the audience is people who
    cannot read the storage-key list. mergeStorage is local-wins by id,
    so the hole opens exactly for the person most likely to be handed a
    file first: a new group member who has never set up entity sync and
    therefore has no local `xray:user` entry. After the merge, their
    entity-sync push encrypts-to-self under a key the file's author also
    holds, and the sync payload includes each entity's own private key
    (entity-sync.js:5-7) — the author can read the whole registry off
    public relays. This is the 2026-06-10 `keyName` exfiltration class
    arriving through a door that case-bundle.js:171-178 was hardened
    against and backup.js walks past, because the merge writes the
    storage map directly instead of going through
    LocalKeyManager.importKey, which already refuses to overwrite key
    material (local-key-manager.js:57-63).
- Fix: Either (a) drop `local_keys` from the merge — add it to a
    MERGE_EXCLUDED set alongside EXCLUDED_STORAGE_KEYS, since the
    merge's stated purpose is corpus accrual, not key sharing (the
    Collaboration bundle at case-export/case-bundle is the deliberate
    key-sharing artifact and it is already hardened); or (b) route every
    incoming `local_keys` entry through LocalKeyManager.importKey so the
    name is re-derived and CONFLICT throws, and hard-reserve `xray:user`
    as never-importable. Either way correct the merge dialog text at
    src/options/index.js:961 — it currently states something false — and
    add the round-trip assertion to tests/backup-merge.test.mjs.
- **rules/csp-strip.json removes Content-Security-Policy from every page
  on every site, unconditionally** *(S)*
- Evidence: rules/csp-strip.json rule id 1: action removes
    `content-security-policy`, `content-security-policy-report-only`,
    `x-content-security-policy`, `x-webkit-csp`; its `condition` is only
    `{"resourceTypes": ["main_frame", "sub_frame"]}` — no urlFilter, no
    requestDomains, no initiatorDomains. Combined with manifest.json:52
    `<all_urls>` host permission it applies everywhere. README.md:333
    ("strip CSP so the YouTube /api/timedtext fetch succeeds"),
    README.md:393 ("strip CSP for the YouTube transcript fetch") and
    CLAUDE.md:240 all describe it as scoped. No test asserts the rule's
    scope; grep for csp-strip in tests/ returns nothing.
- Why 1.0: CSP is the browser's primary defense against XSS on sites the
    researcher does not control — their webmail, their bank, the
    target's CMS. Installing X-Ray turns it off globally and silently,
    and a non-technical user has no way to learn this: the only three
    places it is documented all say it is narrow. This is the skill's
    own named failure mode (silent scope creep) with the widest possible
    blast radius, and it is also the single most likely item to be
    challenged in Firefox AMO / Chrome Web Store review, which Standard
    7 treats as a recurring external audit.
- Fix: Re-derive rule 1 against the actual need. The YouTube transcript
    path already has its own narrowly-scoped rule (id 2, urlFilter
    `||youtube.com/api/timedtext`, xmlhttprequest only), so establish
    empirically whether rule 1 is still load-bearing at all — the
    transcript fetch now runs via MAIN-world executeScript in the page's
    own context (src/background/index.js:930-980), which is not subject
    to the extension's DNR needs the same way. If it is still needed,
    scope it with `requestDomains: ["youtube.com"]` and the minimum
    resourceTypes. If it is not, retire it as a recorded kill (Art. 3),
    journal the re-derivation with the date, and correct
    README.md:333/393 and CLAUDE.md:240 in the same PR.
- **docs/THREAT_MODEL.md does not exist — the tree has no document
  telling a research group what X-Ray exposes, to whom, and what an
  imported file can do** *(M)*
- Evidence: `ls docs/` returns 50 files, none named THREAT_MODEL.md.
    `grep -rn THREAT_MODEL --include=*.md .` matches only
    .claude/skills/security-threat-modeler/SKILL.md (lines 13, 65, 72,
    176, 185, 203, 212). JOURNAL.md:214-217 records the gap in the
    maintainer's own words when the skill was merged: "keys in
    chrome.storage, MAIN-world injection on <all_urls>, CSP stripping,
    and now audio + API keys to cloud providers, with no threat-model
    document." docs/SMOKE_TEST.md has 40+ section headings and no
    security or privacy section.
- Why 1.0: Groups of non-technical researchers make trust decisions this
    document is the only place to answer: is it safe to send my case
    file to a colleague, what does the site I am investigating learn
    about me, what happens if I import the wrong file. Today those
    answers live scattered across code comments, three JOURNAL entries,
    and the maintainer's head — which is precisely the "only works
    because the operator already knows how it works" defect the 1.0
    framing names.
- Fix: Author docs/THREAT_MODEL.md with this structure, all of it
    derivable from the tree as it stands today. ASSETS (ranked): (1)
    nsec key material — `local_primary_identity` (storage.js:233-267;
    read sites: options/index.js:85,329,520,
    identity-profiles.js:51,104,212) and `local_keys`
    (local-key-manager.js:22,133, incl. the `xray:user` sync key); (2)
    the unpublished casework corpus — `xray-archive`, `xray-audits`
    (v7), `xray-events`, plus the WORKSPACE_CONTENT_KEYS storage maps;
    (3) operator metadata — what was captured, whom, when, and when it
    was re-read; (4) third-party credentials — `xray:llm:key`,
    `xray:transcriber:assemblyai:key`, `xray:transcriber:deepgram:key`,
    `xray:transcriber:token`. TRUST BOUNDARIES with their receiving-side
    validator, as they actually exist: page DOM -> content script
    (Readability/Turndown, content-extractor.js sanitizeMdUrl:16-22 for
    emitted src/href); MAIN-world postMessage -> content script
    (nip07-client.js:36-44 — tag+direction+id only, NO crypto check;
    api-hook-buffer.js:46-63 — explicitly no validation, comment at
    :51-53); content script -> service worker (chrome.runtime,
    unreachable from web pages because manifest.json declares no
    externally_connectable); extension -> relay (VERIFIED —
    nostr-events.js verifyOne:87-110 re-hashes and Schnorr-checks every
    event, firstValidEvent:142 is the censorship guard, wired at
    nostr-client.js:246); extension -> Anthropic (llm-client.js, two
    consent gates: flag + user key, key never logged per its
    header:12-16); extension -> loopback companion / LM Studio
    (transcriber-client.js loopbackUrl:93-99, PINNED, guard-tested);
    backup/bundle/sync import (backup.js applyBackup:401 replaces all,
    mergeBackup:619 accrues; case-bundle.js:171-178 re-derives keyName;
    entity-sync.js filters authors to the user's own pubkey and rides
    the same signature verification); LLM input and output (captured
    text is attacker-controlled — the reversed-table attack, JOURNAL
    2026-07-17 lines 2311-2360 — and output never auto-applies).
    ATTACKER CLASSES with the concrete narrative each already has in the
    tree: malicious captured page (forges a NIP-07 sign response,
    blocker #4; injects fabricated GraphQL into the capture via
    api-hook-buffer; fingerprints the installation three different
    ways); malicious relay event (blunted by verify-on-ingest, but
    incorporation.js still accepts a followed author's content as
    proposals — correctly human-gated); malicious backup or bundle
    (blocker #1; the 2026-06-10 precedent at JOURNAL:6223-6236);
    malicious captured author targeting the LLM (JOURNAL 2026-07-17);
    compromised or curious cloud provider (Anthropic sees article text;
    AssemblyAI/Deepgram receive the audio — companion README
    disclosure); and the surveillance-shaped adversary who merely wants
    to know the researcher exists (the fingerprinting cluster in
    should_fix). PER-BOUNDARY CONTROLS: state each control, name the
    module that enforces it, and mark the ones that are prose-only today
    (the NIP-07 return path, the api-hook event channel, the CSP rule's
    scope) as gaps rather than controls. Add the PR row-update rule from
    Standard 1 and, per Standard 1's graduation clause, the CI check
    that a diff touching manifest permissions or adding a
    fetch/WebSocket destination must also touch this file.
- **The NIP-07 bridge accepts a signed event back from the captured page
  on a guessable id with no signature, pubkey, or content check** *(M,
  user-visible)*
- Evidence: src/content/nip07-client.js:30 `const id = ++reqSeq;`
    (sequential, starts at 1, per-page); :36-44 the response filter
    checks only `data.tag`, `data.direction === 'res'` and `data.id ===
    id`; :103-105 returns `signedEvent` verbatim.
    src/shared/signer.js:129 hands that object straight back to callers.
    `grep -rn "verifySignature\|verifyEvent" src/` shows verification
    exists only at src/shared/crypto.js:390 and its relay-ingest
    consumer src/shared/nostr-events.js:99 — never on a signer result.
    The bridge's own handler (src/page/nip07-bridge.js:37-53) posts to
    `'*'` in the same window, so the page's listener sees the request
    frame and can answer synchronously while the real signer is still
    awaiting user approval.
- Why 1.0: CLAUDE.md's capture->publish handoff routes NIP-07 signing
    back through the SOURCE TAB "so the user's signer extension approves
    in-context" — meaning the tab whose page X-Ray just judged
    adversarial enough to capture is the tab that gets the sign request.
    A hostile captured page wins the race trivially and can return a
    well-formed event it signed with its own key, or an event whose
    tags/content differ from what the operator reviewed. The operator
    sees a green publish result and a corpus record they believe carries
    their npub. For a non-technical researcher there is no observable
    difference between that and a real publish, and Art. 3 means the bad
    record is now permanent. Same vector applies to getPublicKey
    (nip07-client.js:81), which seeds `xr_signing_state`
    (signer.js:182-186) and the reader's publish UI.
- Fix: Two changes in src/content/nip07-client.js, both local. (1)
    Replace `++reqSeq` with an unguessable per-call id
    (`crypto.getRandomValues` hex) so a page cannot pre-answer a request
    it has not observed. (2) Validate on receipt: for `signEvent`,
    recompute `Crypto.getEventHash` over the unsigned event the caller
    submitted, assert it equals the returned `id`, assert the returned
    `pubkey` equals the pubkey the session already resolved, and run
    `Crypto.verifySignature` — both functions already exist and are
    already used for relay ingest. Reject with a user-visible error
    rather than falling back. Add the assertion to tests/signer.test.mjs
    with a stub page that answers first.
- **Every file X-Ray exports for sharing carries private keys, and there
  is no key-free export for the group workflow** *(M, user-visible)*
- Evidence: src/shared/backup.js:6-7 ("all keys (content + config +
    identities, including the primary nsec and per-entity keys) MINUS
    `xray:llm:key`"); EXCLUDED_STORAGE_KEYS at :67 is only
    `['xray:llm:key','workspaces','active_workspace']`;
    tests/backup.test.mjs:147 pins this ("identity (incl. nsec) captured
    by decision"). The smaller Workspace backup (options.html:265 ->
    collectWorkspaceSnapshot, backup.js:350-383) omits
    `local_primary_identity` but still carries `local_keys` because that
    key is WORKSPACE_CONTENT. The maintainer's decision is on the record
    — JOURNAL 2026-07-10 ("the nsec and entity keys deliberately do, by
    maintainer decision") and JOURNAL 2026-07-25 ("Backups contain nsecs
    on purpose... the UI says to treat it like an nsec") — and
    USER_GUIDE §2.6 and §9.6 both repeat the warning honestly. The
    in-app warning is a `flash()` toast at src/options/index.js:903 that
    self-clears.
- Why 1.0: The decision was correct for its context: one user, one
    machine, a personal recovery file. The 1.0 context adds a second job
    to the same artifact — mergeBackup exists specifically so "a
    colleague's (or an older) backup folds INTO the current corpus"
    (backup.js:24) — and no export in the tree produces a corpus a group
    member can safely receive. A non-technical researcher asked to "send
    me your case file" will click the button labelled backup, and the
    file they email contains their signing identity. Note this is not a
    code bug; it is a decision whose premise changed, which is exactly
    what a 1.0 review should surface rather than a guard test.
- Fix: Add a third export: "Shareable copy (no keys)" — the same
    `xray-backup/1` document with `local_primary_identity` and
    `local_keys` withheld — and make it the export the sharing
    documentation points at, with the full backup relabelled as
    recovery-only. Blocker #1's fix makes this coherent: if merge
    ignores key material, a key-free file loses nothing on the receiving
    end. Replace the self-clearing toast on the full-backup path with a
    persistent notice in the same element the merge report uses
    (renderMergeReport, options/index.js). Record the decision change in
    JOURNAL alongside the 2026-07-10 and 2026-07-25 entries rather than
    silently reversing them.

**Should fix**

- **The companion auth token is echoed into a visible type="text" field
  on every Options load — one instance, and the sibling audit is clean**
  *(S)* — src/options/index.js:1208
  `document.getElementById('pref-transcriber-token').value = await
  llmRawGet(TRANSCRIBER_TOKEN_STORAGE);` against
  src/options/options.html:624 `<input type="text"
  id="pref-transcriber-token" placeholder="almost always blank" />`. The
  deliberate contrast is two lines away: options.html:460, 601, 610 are
  `type="password"`, and index.js:1216-1219 and :1231 read only presence
  (`setKeyStatus(..., (await llmRawGet(...)).length > 0)`) and then set
  `.value = ''`. Sibling audit: `grep -rn "\.value = await" src/`
  returns exactly four hits — 1208 (this one), 1221/1222 (LM Studio URL
  and model, not secrets), and 277 (bunker URL, not a secret);
  portal/import-transcript.js:67 and reader/media-modal.js:248 are
  user-chosen file contents. No other credential echo exists. → Adopt
  the LLM-key pattern the file already uses: change options.html:624 to
  `type="password"`, replace line 1208 with a presence indicator
  (`setKeyStatus`) and `.value = ''`, and treat an empty submit as
  "leave unchanged" the way the API-key fields do. Ranked here rather
  than as a blocker on honest asset impact: the token guards a
  loopback-only service already protected by the CORS origin regex
  (companion/transcriber/transcriber/server.py:93-98) and a JSON
  content-type requirement, and its default is unset. The real 1.0 cost
  is a screen-shared settings page during group work.
- **web_accessible_resources exposes src/page/nip07-bridge.js to every
  website with no call site in the extension** *(S)* —
  manifest.json:98-107 declares the resource for `<all_urls>` with no
  `use_dynamic_url`. `grep -rn "getURL\|nip07-bridge" src/
  esbuild.config.mjs` shows no
  `runtime.getURL('src/page/nip07-bridge.js')` anywhere — the file is
  injected declaratively as a MAIN-world content script
  (manifest.json:58-69), which needs no WAR entry. → Remove the
  web_accessible_resources block. Standard 7 is explicit that a
  permission with no call site is removed. Today it hands every page a
  deterministic probe for the extension's stable ID, which for a tool
  used against adversaries means the target's own website can detect
  that its visitor runs X-Ray. Journal the removal with the
  re-derivation.
- **Three independent ways for any website to fingerprint an X-Ray
  installation** *(M)* — (1) src/content/index.js:167 stamps
  `document.documentElement.dataset.xrayCaptured = 'flag-off'` when the
  marker is present and captureAutomation is OFF — a page can set
  `location.hash='#xray:capture'` itself (the hashchange listener at
  :150 re-runs the check) and read the result, so the detector works
  regardless of the flag's state. (2) src/page/nip07-bridge.js:37-53
  answers a `{tag:'XRAY_NIP07', direction:'req', method:'probe'}`
  postMessage from any page on `<all_urls>`, and broadcasts a `ready`
  frame at :58 unprompted. (3) src/page/api-interceptor.js:37-49 leaves
  `window.__xrApiHookInstalled`, `window.__xrNonce`,
  `window.__xrApiHookSetPatterns` (:210) and `window.__xrApiHookMatch`
  (:211) on the page object on facebook/instagram/youtube, plus an
  unconditional `console.log('[X-Ray api-interceptor] installed in MAIN
  world')` at :44. → For (1), return early before stamping when the flag
  is off. For (2), require a nonce the content script provides before
  the bridge answers a probe, or accept that a NIP-07 bridge is
  inherently observable and say so in THREAT_MODEL.md rather than
  leaving it undocumented. For (3), drop the two
  `__xrApiHookSetPatterns`/`__xrApiHookMatch` test globals from the
  production bundle and gate the three console.log calls (44, 109, 197).
  Rank by asset impact: this is operator metadata, the third crown jewel
  — for a researcher capturing a target's own site, being detectable is
  a real cost, and it is currently undocumented anywhere.
- **api-hook-buffer accepts `xr:apihook:event` frames from the page with
  an explicit no-validation comment, on the three most hostile origins
  in the tree** *(M)* — src/shared/api-hook-buffer.js:46-63; the comment
  at :51-53 reads "Don't validate the nonce — we're reading messages
  from our OWN page-world script back into the isolated world. There's
  only one extension scattering them." But `ev.source === window` in the
  isolated world admits anything the PAGE posts, and the interceptor is
  auto-injected at document_start on instagram/facebook/fb/youtube
  (manifest.json:83-96). The page can also call
  `window.__xrApiHookSetPatterns` (api-interceptor.js:210) directly.
  Consumers parse these bodies as authoritative platform data —
  shared/platforms/instagram.js:218, facebook.js:577,
  youtube-comments.js:6. → Make the channel authenticated in the
  direction that matters. The content script already sends
  `xr:apihook:configure` (api-hook-buffer.js:74-84); have it mint a
  random per-page token there, have the interceptor echo that token on
  every `xr:apihook:event`, and have the buffer drop frames without it.
  That closes the asymmetry the current comment describes as unclosable.
  Named impact: fabricated evidence entering the casework corpus,
  indistinguishable from captured evidence — the same class the
  reversed-table defense (JOURNAL 2026-07-17) was built to refuse.
- **Reader-rendered captures fetch remote images live, with the user's
  cookies and no referrer policy** *(M)* — src/reader/index.js:2643,
  4689, 4750, 4806, 4845, 4916, 5434 emit `<img src="…" loading="lazy">`
  with no `referrerpolicy`; `grep -rn "referrerpolicy\|no-referrer"
  src/` returns nothing. shared/content-extractor.js markdownToHtml
  (around :985-989) emits `<img src>` from the captured markdown after
  sanitizeMdUrl (:16-22), which correctly rejects
  javascript:/vbscript:/non-image data: but passes any http(s) URL
  through. → Add `referrerpolicy="no-referrer"` at every emission site,
  and add an "offline reading — do not load remote media" preference
  (default ON for archive/reconstructed views) that swaps remote `src`
  for a placeholder. Named impact: opening an archived Instagram or
  Facebook capture re-pings Meta from the researcher's authenticated
  session, timestamping when the material was reviewed and from where.
  It also makes archived captures actually offline-readable, which is a
  plain usability win for the same change.
- **Two cloud provider API keys and the companion token ride inside full
  backups while the Anthropic key is excluded** *(S)* —
  src/shared/backup.js:67 `EXCLUDED_STORAGE_KEYS = ['xray:llm:key',
  'workspaces', 'active_workspace']`, against the constants in
  src/shared/transcriber-client.js:23 (`xray:transcriber:token`), :31
  (`xray:transcriber:assemblyai:key`) and :32
  (`xray:transcriber:deepgram:key`). backup.js:5-7 states the governing
  rule in its own header — a third-party API credential "must never
  leave the machine inside a backup" — and then applies it to exactly
  one of the three credentials that now exist. The 2026-08-02
  cloud-transcription wave added the other two after backup.js was
  written. → Add all three constants to EXCLUDED_STORAGE_KEYS by
  importing the exported names rather than re-typing the strings, and
  extend the tests/backup.test.mjs pin (which already asserts the
  `xray:llm:key` exclusion at :148 and the smuggle-rejection at
  :256-258) to cover them. This is exactly the accretion the skill's
  failure mode names: a rule stated once, then quietly outgrown by a
  later wave.
- **The Restore and Merge buttons sit side by side and only a prompt()
  dialog distinguishes replacing your identity from adding a colleague's
  corpus** *(S)* — src/options/options.html:291-293 renders "Download
  full backup", "Restore from backup…" (danger class) and "Import &
  merge…" in a row. The only differentiation is the typed confirmation
  in src/options/index.js:918-925 (type RESTORE) and :952-966 (type
  MERGE). backupRestoreFromFile at :933 then calls applyBackup, which
  via applyStorage:273-298 removes and rewrites every non-excluded
  storage key — `local_primary_identity`, `relays`, `preferences`
  (including `signing_method` and `nsecbunker_url`), `xray:flags`,
  `xray:transcriber:*` — from the file. → Relabel around intent, not
  mechanism: "Restore MY backup (erases this profile and replaces my
  identity)" versus "Add a file someone sent me (never changes my
  identity)". Consider gating Restore behind a file whose exported
  identity pubkey matches the local one, or an explicit "this file was
  made by someone else" acknowledgement. Also worth stating plainly in
  the restore dialog that the file's relay list and feature flags become
  yours — a crafted file can point publishing at attacker-chosen relays
  and flip every publishing flag on, and the current wording ("REPLACES
  the current workspace, settings, identities…") will not read that way
  to a non-technical user.
- **207 bare console.* calls contradict the logging convention; three of
  them run in the page's own console on hostile origins** *(M)* — `grep
  -rn "console\.(log|error|warn|info)" src/ --include=*.js | grep -v
  "Utils\."` counts 207 (reader/index.js 104, platforms/youtube.js 18,
  platforms/instagram.js 16, background/index.js 9). CLAUDE.md's
  Conventions section says "use `Utils.log` / `Utils.error` (no-ops when
  `CONFIG.debug` is false). Don't add bare `console.log`."
  src/page/api-interceptor.js:44, :109 and :197 are MAIN-world — they
  print to the PAGE console, are readable by the page (which can shadow
  console.log), and :109 announces every captured response URL and byte
  count. src/background/index.js:933, 985, 1023, 1032 log captured URLs
  and response prefixes at console.error unconditionally. → Gate the
  three MAIN-world calls behind a debug flag passed in at configure time
  (the interceptor cannot import Utils, so pass a boolean through the
  `xr:apihook:configure` envelope). Convert the SW's four unconditional
  console.error calls to Utils.error. The remainder is a hygiene sweep,
  not a security issue, but the principle in the mission — the extension
  must not observe its user's investigations — argues for not writing
  captured URLs into any console by default.
- **src/page/api-interceptor.js's own header contradicts the manifest
  about how it is loaded** *(S)* — api-interceptor.js:14-19: "Activation
  model: this script is NOT auto-injected via manifest content_scripts.
  A platform handler decides on-demand to inject it via
  chrome.scripting.executeScript." manifest.json:83-96 declares it as a
  document_start MAIN-world content script on
  instagram/facebook/fb/youtube; `grep -rn "api-interceptor" src/` shows
  no executeScript call for it. The correct description is in the
  neighbouring module — api-hook-buffer.js:68-70 and
  content/index.js:32-37 both say "already loaded via the manifest
  content_script". → Correct the header. It matters beyond tidiness: a
  reader who trusts it concludes the hook is dormant until a handler
  opts in, when in fact it wraps fetch and XHR on every visit to those
  four domains whether or not the user ever captures anything — which is
  the fact THREAT_MODEL.md needs to state honestly.
- **Standard 4's stated invariant is false in the tree, and the
  read-site allowlist guard it prescribes does not exist** *(S)* —
  .claude/skills/security-threat-modeler/SKILL.md:88-89 asserts
  "backup.js exports exclude the primary identity by default."
  tests/backup.test.mjs:147 asserts the opposite and calls it
  deliberate: `assert.ok(backup.storage.local_primary_identity,
  'identity (incl. nsec) captured by decision')`, matching JOURNAL
  2026-07-10 and 2026-07-25. Separately, the read-site allowlist guard
  Standard 4 promises does not exist: `grep -rn local_primary_identity
  tests/` finds only backup, backup-merge and identity-profiles
  fixtures, none of which pin the src/ read sites
  (options/index.js:85,329,520; identity-profiles.js:51,104,212;
  storage.js:158,233,247,267). → Two separate dispositions, both for the
  maintainer. (a) The skill and the recorded decision disagree; one of
  them must move. Per the skill's own Boundaries clause I flag and stop
  — but note that blocker #5's key-free export would let Standard 4 be
  restated as "the SHAREABLE export excludes key material," which is
  true of the fix and honest about the recovery file. (b) Write the
  allowlist guard Standard 4 describes, seeded from the read sites
  above; it is cheap and it is the mechanism that would have caught
  blocker #1's `local_keys` path at authoring time.

**Kill candidates**

- **rules/csp-strip.json rule id 1 in its current global form** — Its
  stated justification (README.md:393, CLAUDE.md:240) is the YouTube
  transcript fetch, which has its own narrowly-scoped rule id 2 and now
  runs through MAIN-world executeScript in the page's own context
  (src/background/index.js:930-980). Nothing in the tree demonstrates
  rule 1 is still load-bearing, and no test pins it. *(cost of keeping:
  Every X-Ray user browses the entire web with CSP disabled, silently,
  and cannot learn this from any document. It is also the likeliest
  single reason for a store-review rejection at 1.0.)*
- **The web_accessible_resources block for src/page/nip07-bridge.js
  (manifest.json:98-107)** — No call site: the file is injected
  declaratively as a MAIN-world content script (manifest.json:58-69) and
  nothing in src/ calls runtime.getURL on it. Standard 7 removes a
  permission with no call site. *(cost of keeping: A stable,
  deterministic extension-ID probe available to every website —
  operator-metadata disclosure to exactly the sites the tool is pointed
  at.)*
- **`nip04Encrypt` / `nip04Decrypt` in src/page/nip07-bridge.js:24-29**
  — NIP07Client exposes only probe, getPublicKey, signEvent and
  getRelays (src/content/nip07-client.js:50-117) — nothing ever calls
  the nip04 methods. entity-sync's NIP-04 read fallback uses
  Crypto.nip04Decrypt directly (entity-sync.js:291-293), not the bridge.
  *(cost of keeping: Two unused decrypt/encrypt entry points reachable
  by postMessage from any page on `<all_urls>`, in the MAIN world, for
  no benefit. Retire as a recorded kill (Art. 3) — the code stays
  git-recoverable if a NIP-04 caller ever appears.)*
- **`window.__xrApiHookSetPatterns` and `window.__xrApiHookMatch`
  (src/page/api-interceptor.js:210-211)** — The comment at :206-209
  admits they exist only for a JSDOM unit test and that stripping them
  'is desirable but not critical.' They are page-callable functions that
  let any script on facebook/instagram/youtube reconfigure or
  interrogate the extension's capture patterns. *(cost of keeping: A
  page-writable control surface on the capture pipeline plus a
  fingerprint, both purely for test convenience that a build-time flag
  or a direct module test could serve instead.)*
- **The `verifyEvents` export in src/shared/nostr-events.js:122-131** —
  `grep -rn verifyEvents src/` finds only its own definition — no
  consumer in the extension; only firstValidEvent (:142) is wired, at
  nostr-client.js:246. *(cost of keeping: A dead public export named
  exactly what a reviewer would grep for to confirm ingest coverage.
  Either wire it where a batch check is wanted or retire it as a
  recorded kill so the coverage picture stops being ambiguous.)*

**Doc gaps**

- docs/THREAT_MODEL.md does not exist. Its absence is Standard 1's own
  first finding and is recorded in the maintainer's words at
  JOURNAL.md:214-217; blocker #3 above carries the substance it needs.
- README.md:333, README.md:393 and CLAUDE.md:240 all describe
  rules/csp-strip.json as scoped to the YouTube transcript fetch; rule 1
  removes CSP from every main_frame and sub_frame on every site.
- src/page/api-interceptor.js:14-19 states the script is NOT
  auto-injected via manifest content_scripts; manifest.json:83-96
  injects it at document_start on instagram, facebook, fb.com and
  youtube. The correct account is at api-hook-buffer.js:68-70 and
  content/index.js:32-37.
- docs/USER_GUIDE.md never documents 'Import & merge…' — grep for merge
  finds §9.6 collaboration bundles and a side-panel entity merge tool,
  but nothing on the backup merge path, which is the tree's designed
  group-collaboration door (backup.js:24, options/index.js:941-944).
- docs/USER_GUIDE.md §2.6 describes the Workspace backup as 'the
  smaller, content-only snapshot' without saying it carries `local_keys`
  — every entity private key including the `xray:user` sync identity
  (workspace-keys.js:22-25, backup.js:350-363).
- src/shared/backup.js:31-32 says 'Install config and the primary
  identity are NEVER touched by a merge' — literally true and materially
  misleading, since `local_keys` is key material and does merge. Same
  defect in the user-facing dialog at options/index.js:961.
- No document anywhere states what a website can observe about an X-Ray
  user. Three independent fingerprints exist (content/index.js:167,
  nip07-bridge.js:37-58, api-interceptor.js:37-49) and none is
  disclosed.
- docs/SMOKE_TEST.md has 40+ sections and no security or privacy section
  — no step verifies that a restore did not swap the identity, that a
  merge did not install a foreign key, or that the CSP rule is scoped.
- No single 'what leaves your machine' page for a non-technical reader.
  The facts are accurate but scattered: README.md:393-400 (permissions),
  USER_GUIDE §2.4 and §6 (LLM key, publishing),
  companion/transcriber/README.md (audio-leaves-machine),
  transcriber-client.js:24-29 (cloud keys ride each request). A group
  deciding whether to adopt the tool needs these on one page.
- .claude/skills/security-threat-modeler/SKILL.md:88-89 asserts backups
  exclude the primary identity; tests/backup.test.mjs:147 and JOURNAL
  2026-07-10 / 2026-07-25 record the opposite as a deliberate decision.
  One of the two must move (Art. 13 tier: skill text is Tier-3 process
  tooling, so the cheaper correction is the skill's, unless blocker #5's
  key-free export makes the standard true again).

**Machine-enforceable candidates**

- Guard test over rules/csp-strip.json: every rule whose action removes
  a `content-security-policy*` response header must carry an explicit
  `requestDomains` or `urlFilter` in its condition — an unscoped
  main_frame CSP-removal rule fails the suite (graduates blocker #2 so
  it cannot silently return).
- Guard test over manifest.json: every path in
  `web_accessible_resources[].resources` must appear inside a
  `runtime.getURL(` call in src/ — no call site, no exposure (Standard
  7's 'a permission with no call site is removed', mechanized; catches
  manifest.json:98-107 today).
- Guard test over src/shared/backup.js: EXCLUDED_STORAGE_KEYS must be a
  superset of an imported list of secret-key constants (LLM_KEY_STORAGE,
  ASSEMBLYAI_KEY_STORAGE, DEEPGRAM_KEY_STORAGE,
  TRANSCRIBER_TOKEN_STORAGE) — a new provider credential that is not
  excluded fails the suite (Standard 9, applied to export artifacts).
- Round-trip guard in tests/backup-merge.test.mjs: seed a foreign backup
  carrying `local_keys` with an `xray:user` entry, merge it into a
  profile that has NO local `xray:user`, and assert the slot stays empty
  — the direct machine check for blocker #1, in the same shape as the
  existing `local_primary_identity` assertion at line 218.
- Guard test over src/options/: for each storage key on a pinned secret
  list, assert no `getElementById(x).value = <that read>` assignment
  exists, or that the corresponding options.html input carries
  `type="password"` — mechanizes the credential-echo rule that lines
  1216-1231 already follow and line 1208 does not.
- CI secret scan (Standard 9's graduation clause): regex over the diff
  and over tests/fixtures for `nsec1[0-9a-z]{20,}`, bare 64-hex strings,
  and `sk-ant-`/provider key shapes — the repo has no such check today
  (.github/workflows/ci.yml runs node --check, build, test, web-ext
  lint, web-ext build only).

### schema-evolution

X-Ray's schema discipline is genuinely strong where it has been
exercised: the event-journal v1→v2 ladder is migrated, normalized on
import, and tested against a real seeded v1 database
(tests/event-journal-migration.test.mjs), mergeBackup's accrual
semantics are written down and pinned by 14 tests, MA.7 re-grounds every
imported quote instead of trusting a foreign offset, and the Art. 10
kind schedule is guard-tested against the emit set. But the tree fails
its own first principle in one flagrant place:
src/shared/archive-cache.js silently LRU-deletes captured articles past
a 500-entry cap on every capture, justified by an `unlimitedStorage`
permission that manifest.json does not actually request — and the
source-document pruner then deletes the evicted articles' archived PDF
bytes. That is uncontrolled deletion of the casework corpus,
undocumented anywhere a user would look. Two more 1.0-audience defects
sit on the interchange surface: every exported backup carries the
AssemblyAI/Deepgram API keys and companion auth token (only
`xray:llm:key` is excluded), and both restore and merge report
silently-dropped stores and whole databases to console.warn only.
Nothing in the tree records what version wrote a record or a backup
file, so after 1.0 no migration can branch on vintage and no support
question about a file is answerable — this is the last release at which
that can be fixed cheaply.

**Blockers**

- **The archive silently deletes captured articles at 500 entries, and
  then deletes their archived source bytes** *(M, user-visible)*
- Evidence: src/shared/archive-cache.js:47 (`const MAX_ENTRIES = 500`);
    :330 fire-and-forget `evictIfNeeded()` on every `saveArticle`;
    :490-512 (sorts all rows, `store.delete(rec.urlHash)`); :331
    `maybePruneSourceOrphans()`; :594 `pruneSourceOrphans` deletes any
    source_documents row no surviving article references, past a 30-min
    grace (:581 `PRUNE_MIN_AGE_S`). The header's justification at :36-37
    ("IndexedDB's unlimitedStorage permission means we have headroom to
    be sloppy about this for now") is false: manifest.json:43-51 lists
    storage, notifications, scripting, activeTab, contextMenus,
    sidePanel, declarativeNetRequest — no unlimitedStorage.
    docs/USER_GUIDE.md never mentions eviction, a cap, or a quota.
- Why 1.0: A non-technical researcher's corpus IS the deliverable, and
    this deletes it without asking, without a notice, and without an
    export. At article 501 the oldest published row is dropped; 30
    minutes later its archived PDF evidence is pruned. Everything keyed
    to that article survives as an orphan: `article-extractions`
    (src/shared/audit/audit-cache.js:51-59, which declares "Nothing in
    the codebase may auto-drop it"), claim quotes and offsets,
    case-brief sources, and MA.7 merge-import, which will now refuse a
    collaborator's analysis of that article with "I hold no copy of that
    text" (src/shared/extraction-import.js:65-70). Published rows are
    evicted first on the theory that the relay is the backup, but
    recovery needs the event still on a relay plus the reconstruct path
    — a promise no group can rely on. Nobody who cannot read source will
    ever know their evidence went away.
- Fix: Stop unconditional eviction before 1.0. Minimum: add
    `unlimitedStorage` to manifest.json, raise or remove MAX_ENTRIES,
    and make any pass that would delete an article row require an
    explicit user action instead of riding `saveArticle`. If a cap must
    stay, surface archive count vs cap in Options with a warning band,
    refuse to evict any row referenced by an `article-extractions`
    record or a stored claim, and journal the change with its
    re-derivability statement (Standard 7). Correct or delete the false
    unlimitedStorage comment either way.
- **Cloud transcription API keys and the companion auth token are
  written into every exported backup** *(S, user-visible)*
- Evidence: src/shared/backup.js:67 `EXCLUDED_STORAGE_KEYS =
    ['xray:llm:key', 'workspaces', 'active_workspace']`; collectStorage
    at :253-271 copies every other non-`ws:` key verbatim. The three
    secrets are ordinary storage.local keys:
    src/shared/transcriber-client.js:23 `xray:transcriber:token`, :31
    `xray:transcriber:assemblyai:key`, :32
    `xray:transcriber:deepgram:key`. src/options/options.html:283 tells
    the user "Your LLM API key is never included";
    docs/USER_GUIDE.md:218-219 says "The one thing never included is
    your LLM API key." tests/backup.test.mjs:140 asserts only the LLM
    key's absence — no test covers the other three. JOURNAL 2026-08-02
    ("Engine choice moved into the extension; keys became per-request",
    docs/JOURNAL.md:431) says the fields follow "the LLM-key pattern
    exactly"; the backup exclusion is the one place that pattern was not
    extended.
- Why 1.0: The backup file is the group-collaboration artifact — "Import
    & merge…" exists precisely so one researcher hands a colleague their
    file. Both the UI and the guide tell that user the file's only
    sensitive contents are their own nsec and that the LLM key is the
    single exclusion, which reads as an assurance that other third-party
    credentials are not in there. They are. Handing a colleague a case
    backup hands them billable AssemblyAI/Deepgram credentials and the
    companion token. Merge ignores them on the way in, so the leak is
    invisible from both ends.
- Fix: Add the three keys to EXCLUDED_STORAGE_KEYS in
    src/shared/backup.js:67 (import the constants from
    transcriber-client.js rather than restating the strings), and extend
    the tests/backup.test.mjs:140 assertion to cover every credential
    key rather than naming one. Restate the UI and guide sentences as
    "no third-party API keys or service tokens are ever included" so the
    promise is about the class, not one key.
- **Restore and merge drop whole stores and whole databases with a
  console-only warning, then report success** *(S, user-visible)*
- Evidence: src/shared/backup.js:215 (`warn(\`backup restore: store
    ${name}/${storeName} not in current schema — skipped\`)`), :407
    (same for an uncovered database), :583 (the merge equivalent). Both
    callers pass a console sink: src/options/index.js:933
    `applyBackup(parsed, { warn: (m) => console.warn('[X-Ray Options]',
    m) })` and :974-975 for mergeBackup. The UI then flashes "Restored —
    reloading…" (:934). Database-stage *errors* are surfaced properly
    (options/index.js:1010-1016), and MA.7 extraction refusals get a
    persistent report (:1030-1045) — the warn channel is the only
    outcome that vanishes.
- Why 1.0: This is the exact failure the discipline exists to prevent,
    on the path groups will use most. A colleague on a later version
    sends a file whose `xray-audits` carries stores this build has never
    heard of; the restore drops them entirely and declares success. A
    non-technical user has no console, no reason to open one, and no way
    to tell a complete restore from a lossy one. The safety backup does
    not help, because they were never told anything was lost.
- Fix: Route `warn` into the same persistent report element the MA.7
    refusals already use (`#backup-merge-report`, and an equivalent for
    restore), suppress the auto-reload when any warning fired, and state
    plainly which stores/databases the file carried that this version
    could not accept — with the file's producing version once that stamp
    exists (see the vintage-stamp blocker).
- **Nothing records what version wrote a record or a backup file — 1.0
  is the last cheap moment to add it** *(S)*
- Evidence: src/shared/backup.js:315-321 — collectBackup emits `format`,
    `exportedAt`, `includesSourceBytes`, `storage`, `databases`; no
    extension version, no per-database DB_VERSION. validateBackup
    (:388-395) checks only exact equality with the literal
    `'xray-backup/1'`. No storage key records the last-run extension
    version: the sole `chrome.runtime.onInstalled` listener is
    src/background/index.js:342, which registers context menus. Contrast
    the case bundle, which does this correctly:
    src/shared/case-bundle.js:26 `CASE_BUNDLE_VERSION = 1`, :130-131
    stamps format+version, :156-157 refuses a file newer than it
    understands with a named message.
- Why 1.0: Standard 6 requires imports to state their minimum accepted
    shape; ours cannot, because a file carries no shape signal. Today
    only the event journal is normalized on import, and it works by
    sniffing (`row.flush && row.flush.state`,
    src/shared/event-journal.js:194-198) — that trick does not
    generalize to the next store whose row shape moves. After 1.0 the
    installed base is strangers with months-old profiles and files from
    many vintages, and every file written before the stamp lands is
    permanently unstamped. It also makes the only support question that
    matters ("what wrote this file?") unanswerable for a user who cannot
    read JSON structure.
- Fix: Stamp the backup with the producing extension version and a
    `{database: DB_VERSION}` map in collectBackup, keep validateBackup
    tolerant of extra fields, and refuse-with-a-named-message when a
    file's stamps are newer than this build (the case-bundle.js:156
    pattern). Separately, record `installed_version`/`previous_version`
    in storage.local from an onInstalled handler — local-only, never
    transmitted, not telemetry — so future ladders can branch on vintage
    instead of sniffing.
- **The user guide never documents Import & merge — the one data path
  built for groups** *(S, user-visible)*
- Evidence: docs/USER_GUIDE.md:203-231 (§2.6 Backups) enumerates exactly
    three tools: Full backup, Workspace backup, Signed-events bundle.
    §9.6 "Sharing a case" (:1039-1050) offers only the case file and the
    collaboration bundle. `grep -rn 'Import & merge' docs/` returns only
    docs/JOURNAL.md:1362 and the generated discipline HTML. The feature
    is real and shipped: src/options/options.html:293 (`Import &amp;
    merge…`), the semantics hint at :299-305, the implementation in
    src/shared/backup.js:414-646, and JOURNAL 2026-07-25 "Backup
    merge-import: accrual, not replacement" (docs/JOURNAL.md:1332).
- Why 1.0: The stated 1.0 goal is non-technical researchers working
    together. Combining two people's corpora is the group operation, and
    its governing rules — local always wins, ids dedup, config and
    identities in the file are ignored, quotes are re-grounded against
    your own copy, unverifiable analysis is reported rather than merged
    — exist only in a prompt string, an Options hint, and the journal. A
    user deciding whether to click a red-adjacent button in Settings has
    nothing to read first, and the guide's Troubleshooting §12
    (:1200-1206) sends every data-recovery question to replace-all
    Restore, which is the wrong tool for combining work.
- Fix: Add an Import & merge subsection to USER_GUIDE §2.6 stating the
    merge law verbatim from src/shared/backup.js:417-430, cross-link it
    from §9.6 as the third way to share a case, and point
    Troubleshooting §12's "lost data" entry at merge when the goal is
    combining rather than replacing. State explicitly that a merge never
    changes your settings, relays, flags, or signing identity.

**Should fix**

- **Four of five IndexedDB openers have no onversionchange, and none has
  onblocked — a blocked open never settles** *(S)* —
  src/shared/archive-cache.js:205-208 is the only `db.onversionchange`
  in src/ (`grep -rn onversionchange src/`).
  src/shared/workspace-read.js:66 is the only `onblocked` (`grep -rn
  onblocked src/`). audit-cache.js (openNamed at :101-177),
  event-journal.js (:108-150), portal-cache.js (:65-94),
  network-cache.js (:68-101) each attach only
  onupgradeneeded/onsuccess/onerror, so a blocked open produces a
  promise that never resolves and never rejects. Deletion is equally
  unguarded: src/shared/storage.js:146-151 and
  src/shared/identity-profiles.js:234-244 call
  `factory.deleteDatabase(name)` inside a try, never awaiting the
  request and never handling onblocked ("best-effort"). → Add
  `db.onversionchange = () => { close(); _dbPromise = null; }` to the
  four openers, mirroring archive-cache.js:205. Add an `open.onblocked`
  that rejects with a user-readable message ("close other X-Ray tabs and
  retry") rather than hanging — the portal's resync path already models
  the right honesty (src/portal/index.js:1265-1268). Make deleteDatabase
  await its request and report an onblocked as a failure instead of
  returning a name list that implies success.
- **The audit-cache v1→v7 ladder — the PRECIOUS database — has never
  been run as an upgrade in any test, and tests/fixtures/ holds no
  schema fixtures** *(M)* — tests/fixtures/ contains only
  real-pdf-engine.mjs and stub-pdf-engine.mjs.
  tests/audit-cache.test.mjs opens a fresh fake database at DB_VERSION
  7, so every ladder block runs once at oldVersion 0; the assertions
  reading "v1 intact after v7 upgrade" (:139, :223) never witness an
  upgrade. Same for archive-cache v1→v3 (tests/archive-cache.test.mjs).
  The one real ladder test in the tree —
  tests/event-journal-migration.test.mjs:50-84, which seeds a
  byte-for-byte v1 database and lets the module upgrade it — is the
  template Standard 3 asks for and exists for exactly one of five
  databases. → Port the event-journal-migration.test.mjs pattern to
  audit-cache (seed a v3 or v5 database with rows, open at v7, assert
  every earlier store's rows survive and the new store exists) and to
  archive-cache (v1→v3). Check the seeded shapes in under
  tests/fixtures/ so the corpus starts accumulating instead of living
  inline, and add a fixture for the oldest real backup file so Standard
  6's round-trip has an input.
- **applyBackup leaves the derived portal and network caches holding the
  pre-restore corpus** *(S)* — src/shared/backup.js:405-411 iterates
  only WORKSPACE_DATABASES (src/shared/workspace-keys.js:46-50); the
  derived caches at :55-58 are untouched.
  src/portal/portal-cache.js:174-177 `loadRecords()` returns every
  cached row with no pubkey filter, so a restore that swaps identities
  renders both corpora together. The failure class already has a journal
  entry — docs/JOURNAL.md:1725 "Fresh workspace kept showing the old
  corpus in the portal" — fixed there by namespacing, but restore
  reaches the same state by a different route. The repair exists
  (`clearAll`, portal-cache.js:199) and is wired to "Full resync"
  (src/portal/index.js:1259-1271); nothing in the restore flow invokes
  or mentions it. → Have applyBackup clear xray-portal and xray-network
  after a successful restore — they are declared rebuildable, so
  clearing is free — or, at minimum, tell the user in the post-restore
  status to run Full resync before trusting My Archive.
- **docs/SMOKE_TEST.md exercises restore but never merge-import and
  never an old-vintage file** *(S)* — docs/SMOKE_TEST.md:457-466 — the
  "Full backup & restore" section is BK.1 through BK.5 (checkbox,
  download+inspect, replace-all restore, PDF byte-identity,
  signed-events bundle). There is no row for Import & merge, none for
  restoring a backup produced by an earlier release, and none for a
  post-restore portal check. → Add BK.6 (merge a second profile's file:
  nothing local overwritten, the report names any refusals, the summary
  counts match) and BK.7 (restore a backup file kept from the previous
  tagged release and confirm the corpus opens). Standard 6's round-trip
  only means something if the oldest real export is an input somewhere.
- **Retired kind 30067 lost its read-back parser, unlike 30043 which
  kept one** *(S)* — src/shared/entity-profile.js:9-10: "Kind 30067 is
  retired: X-Ray no longer emits or consumes it (foreign 30067s in the
  wild are simply unknown events)." Contrast the other retirement, which
  did it the way Standard 5 asks: src/shared/evidence-linker.js:254-255
  and :433 keep the 30043→30055 read-time migration alive so a link
  whose only prior publish was the retired kind is still understood. The
  retirement itself is properly journaled with its re-derivability
  statement (docs/JOURNAL.md:1577-1600). → Decide and record explicitly
  whether any shipped build ever emitted a 30067 to a relay. If it did,
  a read-only parser that renders such an event in the portal as a
  superseded artifact honors the wire covenant; if it never did, say so
  in the Art. 10 row's family column so the retirement is legible as
  "reserved, never emitted" rather than "emitted and now unreadable."
- **"Erase X-Ray SETTINGS" deletes userscript-era private keys under a
  label that does not say so** *(S)* — src/options/index.js:81-84 lists
  `publications`, `people`, `organizations`, `keypair_registry` as
  "Legacy userscript-era stores" in storageClearExtension. The confirm
  text at :1657-1659 says "…feature flags, and legacy userscript-era
  stores" and reassures that workspace content is untouched.
  `keypair_registry` is the userscript's entity keypair store; no module
  in src/ reads any of these four keys, so nothing can re-derive them
  after the wipe. They do ride the full backup (they are not in
  EXCLUDED_STORAGE_KEYS), which is the only reason the data is
  recoverable at all. → Either name the risk in the confirm ("…including
  legacy userscript keypairs, which contain private keys — take a full
  backup first"), or drop them from the clear list and leave them inert
  per Art. 3, recording the decision in the journal.
- **portal-cache and network-cache upgrade handlers are contains-guarded
  rather than oldVersion-laddered** *(S)* —
  src/portal/portal-cache.js:74-88 and
  src/network/network-cache.js:76-90 both open onupgradeneeded without
  reading `ev.oldVersion`, creating stores behind
  `objectStoreNames.contains` checks. Both databases are at DB_VERSION 1
  (portal-cache.js:22, network-cache.js:23), so nothing is wrong today —
  but the shape invites a v2 that adds work outside an `oldVersion < 2`
  block, which is how a data pass ends up re-running or not running. →
  Convert both to the explicit `if (oldVersion < 1) { … }` ladder shape
  now, while the blocks are empty of consequence, so the next bump
  appends rather than restructures (Standard 1).

**Kill candidates**

- **The v4-compat façades in src/shared/storage.js — `Storage.entities`
  (:354-360) and `Storage.articleCache` (:408-412)** — They are dead
  stubs from the port: `entities.get` returns null, `getAll` returns {},
  and `save` throws `'Entity storage not implemented until Phase 4
  (#15)'`. Phase 4 shipped long ago; the real registries live elsewhere.
  `articleCache` returns null and swallows saves, superseded by
  archive-cache.js in Phase 7. *(cost of keeping: A 1.0 user can be
  shown an error message citing an internal phase number and a GitHub
  issue id. Any future caller who trusts the façade names silently
  writes nothing (articleCache.save is a no-op) — a data-loss shape
  hiding in the storage module's public surface.)*
- **The legacy userscript storage keys `publications`, `people`,
  `organizations`, `keypair_registry` (src/options/index.js:82-83)** —
  No module in src/ reads any of them; the userscript importer that
  populated them was removed and journaled (docs/JOURNAL.md:6724-6748,
  "Settings consolidation (Phase B of the cleanup)"). They now appear in
  exactly two places: a delete list and a full backup dump. *(cost of
  keeping: Data no reader can open, that one button deletes and that no
  UI can inspect — the worst combination under Art. 3. Whichever way it
  goes it should be a recorded kill: either a one-time export path in
  Options, or an explicit journal entry stating the keys are inert and
  preserved.)*
- **The `MIGRATION_DEFER_S` twin path for v1-shaped journal rows
  arriving through backup import (src/shared/event-journal.js:194-198,
  applied via ROW_NORMALIZERS in src/shared/backup.js:55-57)** — Not a
  kill of the mechanism — it is correct and well-tested
  (tests/backup-merge.test.mjs:447) — but of its uniqueness. It is the
  only per-store vintage normalizer in the tree, and it works by
  shape-sniffing because no file stamp exists. *(cost of keeping: As
  long as it stands alone, each future row-shape change re-invents an
  ad-hoc sniff. Once the backup carries per-database version stamps,
  ROW_NORMALIZERS should key on the file's declared version and the
  sniff should retire into a documented fallback for unstamped pre-1.0
  files.)*

**Doc gaps**

- docs/USER_GUIDE.md §2.6 (:203-231) documents three backup tools and
  omits Import & merge entirely — the group data path. Its semantics
  live only in src/options/options.html:299-305 and
  docs/JOURNAL.md:1332.
- docs/USER_GUIDE.md nowhere states that the article archive has a
  500-entry cap or that captures are silently evicted
  (src/shared/archive-cache.js:47) — a user cannot plan a corpus around
  a limit they are never told about.
- docs/USER_GUIDE.md:218-219 and src/options/options.html:283 both
  promise the LLM key is the one excluded secret, which is materially
  misleading now that three other credentials ride along
  (src/shared/transcriber-client.js:23, :31, :32).
- No document states which extension versions wrote which persisted
  shapes. There is no shape-vintage table anywhere, so neither a user
  nor a future migration can map a file or a profile to a schema
  generation.
- backup.js's merge law (:417-430) is described as governing law by the
  discipline (Standard 6: "live in the design doc, not caller memory")
  but has no design doc — it exists as a source comment plus
  docs/JOURNAL.md:1332.
- docs/SMOKE_TEST.md:457-466 has no merge-import row and no old-vintage
  restore row, so the release preflight never exercises the two paths a
  group most depends on.
- docs/CONSTITUTION.md:423 lists 30067 as retired but the code went
  further and dropped the read path (src/shared/entity-profile.js:9-10);
  the table does not distinguish "retired, still parsed" (30043) from
  "retired, no longer parsed" (30067).
- No document names the cross-store invariants the tree depends on —
  article-extractions keyed to archive bodies, claim offsets to article
  text, event-journal rows to relay reality — nor which of them has a
  repair path (Standard 9). Two repairs exist and are undocumented
  outside the journal: portal Full resync (src/portal/index.js:1259) and
  Restore entity keys (src/options/index.js:445).
- docs/USER_GUIDE.md §12 Troubleshooting (:1200-1206) routes every
  data-recovery question to replace-all Restore; it never mentions that
  merge is the non-destructive option or that restore replaces the
  signing identity.

**Machine-enforceable candidates**

- Assert every credential storage key constant exported by
  src/shared/transcriber-client.js and src/shared/llm-prompts.js is
  absent from a collectBackup() output (extend tests/backup.test.mjs:140
  from one key to the whole class, sourced from the constants, so a new
  key added later fails the test by default).
- Guard: every `idb().open(...)` call site in src/ attaches both an
  `onblocked` and an `onversionchange` handler — a small AST or regex
  check over the five opener modules plus workspace-read.js.
- Guard: for each of the five DB_VERSION constants, a test exists that
  seeds the database at version N-1 and opens through the owning module
  — enumerate opener modules, require a matching migration test file,
  fail on a bump with no seeded-ladder test.
- Guard: any diff touching a DB_VERSION constant or an onupgradeneeded
  handler must add a file under tests/fixtures/ or carry a named
  exemption in the PR body (the CI check Standard 3 graduates into).
- Guard: docs/SMOKE_TEST.md contains a row exercising mergeBackup and a
  row restoring a file from a prior tagged release — a doc-presence
  check in the release preflight, alongside the existing discipline-docs
  drift guard.
- Round-trip test over the fixture corpus: for each checked-in
  historical backup fixture, applyBackup then collectBackup and assert
  every store's row count and every content key's id set is preserved
  (Standard 6's oldest-export invariant, runnable in node --test).

### newcomer-ux

X-Ray's interface is unusually honest and unusually confident that its
reader already knows NOSTR. The craft is real and uneven: the
delete-capture confirm (src/reader/index.js:756–768) states what goes,
what stays, and the counts, and renderCaptureQualityHint
(src/reader/index.js:4974–4987) is a textbook symptom→cause→retry error
— but the one irreversible, public, permanent action in the whole tool,
Publish, fires on a single click with no pre-flight
(src/reader/index.js:7636), and the disclosure that your private
judgments are also going public arrives as a four-second toast
mid-flight (src/reader/index.js:6170). The deeper pattern is that
documentation has been substituting for interface: the moral lens ships
a Settings toggle, a reader bar, and an empty state that says "Author
one in the console" (src/reader/lens-section.js:50); three separate docs
instruct a first-time user to click "Generate new key", a button that
has never existed; and the Hugging-Face-token incident recorded in
JOURNAL 2026-08-08 was closed by relabelling the field while
src/options/index.js:1208 still echoes the stored secret into a visible
text input. None of this was a defect while the only user wrote the
code. For non-technical groups it is the product. The good news is that
most of it is small and mechanical — the blockers below are dominated by
label drift, one missing pre-flight, and two surfaces that should be
retired rather than explained.

**Blockers**

- **Publish — the only irreversible, public, third-party-visible action
  — has no pre-flight, and its disclosures arrive after the click** *(M,
  user-visible)*
- Evidence: src/reader/index.js:7636 wires #xr-publish straight to
    publish() with no confirm; the "Also publishing your judgments: …" /
    "Also publishing forensic findings: …" / "Also publishing
    adjudications: …" disclosures are toasts fired mid-loop at
    src/reader/index.js:6170, 6408, 6512, 6688. Compare
    src/reader/index.js:768, where deleting a *local* cached copy
    demands a confirm listing what is deleted, what is kept, and the
    counts.
- Why 1.0: A researcher in a group flips assessmentPublishing once
    (Settings hint, src/options/options.html:325–331: "publicly visible
    to anyone with relay access") and thereafter every Publish click
    also emits their stances, labels, and rationales — signed,
    attributed, and irrevocable in practice — with the only notice being
    a toast that appears while the events are already going out. The
    confirmation hierarchy is inverted: removing a baseline
    (src/reader/index.js:3119) and clearing a derived cache
    (src/network/index.js:774) both confirm; publishing to the permanent
    public record does not.
- Fix: Add a pre-flight sheet on the Publish button that enumerates
    every artifact class this click will emit, its signing identity, its
    relay set, and one irrevocability line — assembled from the same
    selection functions the loop already calls
    (selectAssessmentsToPublish, selectMirrors, selectLinksToPublish)
    before the first network request rather than during it. Keep the
    existing per-class toasts as progress, not as disclosure.
- **The first instruction a new user follows names a button that does
  not exist** *(S, user-visible)*
- Evidence: README.md:265 ("click **Generate new key**"),
    docs/USER_GUIDE.md:111 ("Click **Generate new key**"), and
    docs/SMOKE_TEST.md:47 ("Settings → Signing → **Generate new key**")
    all name it. The Local panel's actual controls are "New identity…"
    (src/options/options.html:105), which reveals a required label
    field, then "Generate & switch" (src/options/options.html:117).
    README.md:309 additionally lists a "Reset" button in that panel; the
    real fourth button is "Restore entity keys"
    (src/options/options.html:111).
- Why 1.0: This is minute one for every non-technical user, and it
    fails. The maintainer never hit it because he has had a key since
    before the identity-profiles rework. A user who cannot find
    "Generate new key" has no path forward: nothing in the Local panel
    is labelled "key", and "New identity…" does not read as the same
    thing.
- Fix: Rename the primary control to "Generate new key…" (keeping the
    label field inside it), or correct all three docs in one pass and
    declare src/options/options.html the source of truth for button
    names. Pair with the label-drift guard in machine_enforceable so it
    cannot re-rot.
- **The moral lens ships a Settings toggle and a reader bar for a
  feature whose only authoring path is the browser console** *(L,
  user-visible)*
- Evidence: src/reader/lens-section.js:50–53: "No jurisdictions in the
    registry yet. Author one in the console (see
    <code>docs/SMOKE_TEST.md</code> §Phase 16) — zero ship built-in,
    deliberately". src/shared/jurisdiction-model.js exposes
    create/update/addAuthority but grep finds no caller in src/options/,
    src/portal/, src/sidepanel/, or src/reader/ other than list()/get()
    at src/reader/index.js:4302 and 4378. docs/USER_GUIDE.md:804
    concedes it: "the moral lens is authored and driven partly from the
    browser console today, not a finished point-and-click UI."
- Why 1.0: A non-technical researcher enables the checkbox at
    src/options/options.html:488–505 (which promises "a Lens readings
    bar that reads selected claims under jurisdictions you author
    yourself"), opens a capture, clicks the bar, and is told to open a
    developer console and read a developer test document. There is no
    recoverable path. Shipping a visible control whose empty state
    routes out of the product is worse than not shipping the control.
- Fix: Two honest options, both legitimate: (a) build a minimal
    jurisdiction editor — name, type, living-person flag, and an
    authority row (citation + ≤500-char excerpt + admissibility) —
    reachable from the lens bar's empty state; or (b) retire the surface
    for 1.0 as a recorded kill under CONSTITUTION Art. 3: hide the
    Settings section and the reader bar, keep every module and test,
    keep kind 30066 reserved and guard-tested, and record the rationale
    and revisit condition in docs/JOURNAL.md.
- **The companion auth token field displays its stored secret in
  cleartext and attracts the wrong secret** *(S, user-visible)*
- Evidence: src/options/index.js:1208 —
    `document.getElementById('pref-transcriber-token').value = await
    llmRawGet(TRANSCRIBER_TOKEN_STORAGE);` — sitting one line above the
    comment that states the opposite rule (1209–1210: "never the key
    VALUES — the LLM-key rule: the DOM only ever learns whether one is
    set"), which lines 1216–1219 then apply correctly to the AssemblyAI
    and Deepgram keys. The input is `type="text"` at
    src/options/options.html:624. docs/JOURNAL.md 2026-08-08 ("The
    companion panel's first real use, and what it exposed") records a
    real Hugging Face token pasted into it and notes the remedy taken
    was a relabel.
- Why 1.0: Groups do screen shares, pair sessions, and screenshots of
    settings pages when helping each other set up — that is precisely
    how non-technical collaborators debug. This field renders a stored
    shared secret in plain sight on every load, next to two sibling
    fields that correctly show only "A key is saved on this device." The
    2026-08-08 relabel fixed the wording and left the mechanism; the
    field is still the one place in the extension where a stored secret
    is echoed back to the screen.
- Fix: Make it `type="password"`, stop populating it from storage, and
    show presence only — reuse setKeyStatus() exactly as the cloud-key
    fields do (src/options/index.js:1216–1219) and the blank-means-keep
    semantics already in saveAdvanced (src/options/index.js:1364–1366
    pattern). Keep the "Not your Hugging Face or provider key" hint.
- **Settings → Advanced is 18 sections deep with one Save button at the
  bottom, no dirty state, and a mixed commit model** *(M, user-visible)*
- Evidence: src/options/options.html:183–750 is a single tab containing
    18 <h3> subheads (Reader, Cases, Active case data, Full backup,
    Experimental, Epistemic audits, Forensic findings, Truth
    adjudication, Entity corpus, Identity sharing, LLM assist, Moral
    lens, AI vision, Capture automation, Transcription, Case synthesis,
    Power user, Danger zone). The only Save is at line 740. grep for
    `beforeunload` in src/options/index.js returns nothing. Tab
    switching (src/options/index.js:135–143) silently discards.
    Meanwhile the buttons inside the same tab — Download backup, Reset
    this case's data, Import audit JSON, New case — act immediately.
- Why 1.0: The Anthropic API key (line 460), the AssemblyAI key (601),
    and the Deepgram key (610) all live above that Save. A user who
    pastes a key and closes the tab loses it with no warning and no
    indication anything was pending — and the field's own placeholder
    ("leave blank to keep the current key") will then reassure them a
    key is saved when none is. On the same page some controls commit on
    click and some wait, with nothing distinguishing them.
- Fix: Make the Save bar sticky with a dirty-state count ("3 unsaved
    changes"), add a beforeunload guard and a tab-switch guard, and
    either commit checkboxes on change with the existing flash()
    confirmation or mark them visibly pending. Also split Advanced into
    named sub-tabs — the sections already group cleanly into Cases &
    data / Publishing / AI & transcription / Power user.
- **Case creation — the organizing unit of group research — has one
  buried entry point and collides with a different object of the same
  name** *(M, user-visible)*
- Evidence: createCase() is invoked from exactly one control:
    src/options/index.js:1723 (`ws-create`), rendered at
    src/options/options.html:229–250 under Settings → Advanced → Cases,
    between the follow-list publishing toggle and "Active case data".
    Separately, the side panel's "＋ New" (src/sidepanel/index.html:17)
    creates an *entity* whose type may be `case` (the 🗂️ chip at
    src/sidepanel/index.html:31) — which is not a case workspace.
    src/shared/case-create.js:20–23 states the case entity is "an
    implementation detail the user never assembles by hand."
- Why 1.0: The maintainer's stated 1.0 goal is groups running their own
    investigations; the case is that unit. Today it is created from the
    third tab of Settings, three-quarters down a 567-line page, under a
    heading a newcomer has no reason to open — while the surface that
    looks like where you'd make one (the Entities panel, with a Case
    type right there) makes the wrong object silently. Two things named
    "case", one of them a trap, is the kind of confusion a group cannot
    debug for itself.
- Fix: Promote "New case…" to a first-class control in the portal header
    and the side-panel header (both already carry the active-case chip,
    so the concept is present), keeping the Settings row as the
    manage/switch surface. Then either remove `case` from the
    side-panel's New-entity type list or make choosing it route into
    createCase() instead of EntityModel.create().
- **Eight user-facing errors terminate at "see console", including one
  that announces data loss** *(S, user-visible)*
- Evidence: src/portal/synthesis-block.js:934 — "— could NOT be saved
    (see console); it will be lost on reload"; also
    src/portal/synthesis-block.js:591–592,
    src/portal/entity-dossier-view.js:73 and :167 ("Republish failed —
    see console"), src/portal/extraction-block.js:276,
    src/portal/trace-block.js:63, src/sidepanel/index.js:1869 ("Scan
    failed — see console.").
- Why 1.0: "See console" is not a remedy for this audience; it is a dead
    end that also reads as an accusation of incompetence. The synthesis
    one is worst: it tells the user their corpus brief — the output of
    an LLM pass that cost real money across every member article — is
    about to vanish, and offers DevTools as the response. The repo
    already knows how to do this right one file over
    (renderCaptureQualityHint, src/reader/index.js:4974–4987: symptom,
    cause, specific retry, link).
- Fix: Give each of the eight a remedy in the user's vocabulary — retry,
    re-run, check your key, check relays — and, for the synthesis case,
    an immediate "Download the brief" escape so the artifact survives
    the failure. Then add the guard in machine_enforceable so no ninth
    appears.
- **The user guide — the only complete explanation of the product —
  contains no screenshots** *(M)*
- Evidence: grep -c '!\[' docs/USER_GUIDE.md returns 0.
    docs/USER_GUIDE.md:19–21: "Screenshots are referenced inline as
    `[SCREENSHOT-nn]` … They are placeholders — a human with a browser
    fills them in." The appendix at line 1210 lists 14 numbered shots
    with framing instructions and its own estimate: "~30 min total."
- Why 1.0: A 1,234-line, image-free document is the manual for an
    18-section settings page and a reader header of eleven controls,
    most of them emoji-led (src/reader/index.html:27–83). Non-technical
    readers navigate software by recognition, not by prose description;
    without images the guide cannot do the job it was written for, and
    the icon legend at §4.5 (⭐ 🔗 ⚖ 🏛 ⚠ 🌐 📋) is a table of glyphs
    described in words. This one is cheap and the appendix already
    specifies exactly what to shoot.
- Fix: Take the 14 shots the appendix specifies (blur the key field in
    04 as it already instructs), commit them under docs/img/, and
    replace the placeholders. Add the reader icon legend as an
    in-product route as well — a "?" in the reader header opening the
    legend — so the glyph vocabulary is not doc-only.

**Should fix**

- **Two shipped features have no Settings control, and the guide tells
  users to open DevTools** *(S)* — docs/USER_GUIDE.md:168–170: "the rest
  are flipped in DevTools via the `chrome.storage.local` key
  `xray:flags`". `reviewCoordination` — documented at
  docs/USER_GUIDE.md:194 and 1090 as how you ask followers for
  adversarial review, and read at src/portal/inspector.js:404 and
  src/network/index.js:798 — has no checkbox in
  src/options/options.html. `extractionAnalysisPublishing` (read at
  src/portal/extraction-block.js:137, gating kind-30070 publishing) has
  neither a control nor a row in the guide's flag table. → Add both to
  Settings → Advanced with the same disclosure treatment as their
  siblings, or mark them explicitly as not-yet-shipped in the guide.
  "Request review" is the group-collaboration verb the 1.0 goal names —
  it should not require DevTools.
- **There is no single page telling a user what becomes public when they
  publish** *(M)* — Eight separate hint paragraphs in
  src/options/options.html (325, 340, 371, 389, 410, 432, 449, 492) each
  carry a variant of "publicly visible to anyone with relay access"; the
  entity-corpus one (410–424) adds "once relayed they are irrevocable in
  practice". Nothing collects them, and docs/THREAT_MODEL.md — required
  by .claude/skills/security-threat-modeler/SKILL.md:65 — does not
  exist. → One "What becomes public" page (in-product, linked from the
  publish pre-flight and from Settings) listing each artifact class,
  what it discloses, who signs it, and its revocability. The
  platform-account case (options.html:432–441, "Your captured-account →
  entity links become public") is the one a group most needs to read
  before one member enables it.
- **Returning users land on Relays — the most jargon-dense surface in
  the product** *(S)* — src/options/options.html:23 marks the Relays tab
  active by default; src/options/index.js:1686 only redirects to Signing
  when `signing_method_configured` is false. The Relays hint
  (src/options/options.html:34–36) reads: "Per-relay read / write /
  enabled controls. Disabled relays are skipped entirely; read applies
  to subscriptions, write to publishes." Nothing on the page says what a
  relay is. → Default to Signing (or a new overview) for everyone, and
  give the Relays tab one plain-language opener: a relay is a server
  that stores and serves your published work; you can use several; you
  rarely need to change these. The three defaults at
  src/options/index.js:48–52 already work out of the box, so the tab is
  arguably a Power-user surface.
- **Wire vocabulary and internal roadmap language leak into user-facing
  confirms and labels** *(S)* — src/sidepanel/index.js:1367 — "The
  entity's kind-0 event already on relays is NOT un-published — that
  requires NIP-09 (later phase)." src/portal/index.html:60–64 — "Any
  ledger status", "◌ Remote-only", "No ledger".
  src/reader/claim-extractor.js:780 — "Adjudicate this claim (atomize +
  rule)". src/sidepanel/index.html:39 — "Duplicate report — likely
  double-minted entities". → Keep the precise terms (renaming a kind
  would break the wire covenant) but define each once at first use and
  lead with the consequence, not the number: "Its public profile stays
  on relays — deletion requests are best-effort and many relays ignore
  them." "Later phase" should never appear in a shipped string.
- **The reader header is eleven controls, mostly emoji-led, with a bare
  🗑 beside ✕ and the primary Publish** *(S)* —
  src/reader/index.html:27–83: ✨ Suggest…, 🖼 Describe images…, 🎙
  Media…, 🎙 Transcribe, ▾, 🗣 Speakers…, 💫 Suggest (local)…, 👤
  Entities, 🗑, ✕, Publish. Two different features share the 🎙 glyph;
  two different Suggest passes are distinguished only by ✨ vs 💫. The 🗑
  (title: "Delete the local archived copy of this capture") sits one
  control from ✕ Close and two from the primary button. → Move 🗑 out of
  the header (the archive banner or an overflow menu), give the two 🎙
  controls distinct glyphs, and collapse the AI controls into one
  labelled menu. The delete confirm itself (src/reader/index.js:756–768)
  is exemplary and needs no change — the problem is the target size and
  neighbourhood.
- **The portal's first-open empty state is written in wire vocabulary**
  *(S)* — src/portal/index.js:378–381: heading "Nothing found on the
  relays", body "The configured relays returned no events for the
  resolved identities. If you publish from another device, add that
  identity above; otherwise publish a capture and refresh." → Lead with
  the likely truth for a new user — you haven't published anything yet —
  and give the next action as a link, not a description. "Resolved
  identities" has no referent for this audience.
- **The most common first failure, "Could not extract an article from
  this page.", offers no remedy** *(S)* — src/content/ui.js:76 — a
  3-second toast (src/content/ui.js:116) with no cause and no next step.
  Contrast the house pattern one file over:
  src/reader/index.js:4974–4987 renders symptom, cause, the specific
  retry, and a link to the capture guide, and only when the capture is
  actually thin. → Name the likely causes (not an article page; content
  still loading; a platform with URL-shape requirements) and link the
  capture guide, as renderCaptureQualityHint already does. Consider
  raising the timeout — 3 seconds is short for a message the user must
  read and act on.
- **Every capture shows an "Epistemic audit" bar offering to import a
  JSON file only a Node CLI can produce** *(S)* —
  src/reader/index.html:119–128 renders the bar unconditionally with "No
  audit imported for this capture." and an always-visible "Import audit
  JSON…" button; the Quick/Thorough buttons beside it are flag-hidden.
  The producing tool is a Node package at docs/auditor-prototype/scorer/
  (scorer.js, package.json), and src/options/options.html:351 tells the
  user to "Run the companion scorer CLI". → Hide the import affordance
  behind the same flag as the audit runners, or move it to Settings
  only. On a default install it is a permanent, unexplained, unusable
  control on every single capture.
- **Dynamically-built controls carry no accessible names, and one ARIA
  table is left half-declared** *(M)* — src/options/options.html:38–45
  declares role="table"/"row"/"columnheader";
  src/options/index.js:189–212 (renderRelays) then emits rows with
  role="row" whose children have no role="cell" and whose three
  checkboxes have no label or aria-label. Across src/options/index.js,
  src/portal/index.js, and src/sidepanel/index.js, grep finds
  essentially no aria-label usage; the reader has five instances total.
  → Add aria-label to the relay checkboxes ("Read from relay.damus.io"),
  complete or drop the ARIA table roles, and give the claims bar and
  entity list accessible names. Groups are not one body — this is part
  of the audience shift, not a separate concern.
- **The side panel exposes nsec import/export inside a collapsed "Sync
  across devices" disclosure** *(S)* — src/sidepanel/index.html:50–59 —
  a <details> labelled "🔒 Sync across devices" whose body (per the
  comment at 56–57 and the handlers at src/sidepanel/index.js:1608,
  1640, 1815) offers generate/import/export of the sync identity plus a
  NIP-09 delete-request sweep. The Signing tab claims to be
  authoritative: "This is the only place user identity is managed"
  (src/options/options.html:143). → Either honour that claim by routing
  the side panel's identity actions to Settings, or amend the Settings
  text. Two places to manage keys, one of them behind a collapsed
  section in a side panel, is how a group member ends up with an
  identity nobody can account for.
- **Publishing an entity's kind-0 profile signs with the entity's key,
  not the user's — and the UI never makes that visible at the moment it
  matters** *(S)* — src/options/options.html:418–420 discloses it in a
  Settings hint ("These are signed by the entity's own keys and publicly
  visible…"), but src/reader/index.js:6408 and the publish summary at
  src/reader/index.js:7489 report corpus events only as counts ("corpus
  event(s) (profiles & mention notes)"). Nothing at publish time shows
  which key signed what. → Show the signing identity per artifact class
  in the publish pre-flight recommended above. For a group, "who signed
  this" is the question the whole trust model rests on.
- **"Experimental" is a heading over one checkbox while ten equally
  experimental toggles sit under ordinary headings** *(S)* —
  src/options/options.html:319 opens an "Experimental" subhead
  containing only "Publish assessments & claim links to relays"
  (322–332). Epistemic audits (335), Forensic findings (366), Truth
  adjudication (384), Entity corpus (405), Identity sharing (427), Moral
  lens (487), AI vision (508), Capture automation (531), Case synthesis
  (665) each get their own neutral heading despite being default-off
  with identical disclosure language. → Either mark every default-off
  publish toggle consistently, or drop the vestigial heading. As it
  stands the page tells a user that exactly one of eleven experiments is
  experimental.

**Kill candidates**

- **The moral lens's shipped surfaces — the Settings section
  (src/options/options.html:487–505), the reader bar
  (src/reader/index.html:143–150), and its empty state
  (src/reader/lens-section.js:50)** — It is the only shipped feature
  whose honest empty state instructs the user to leave the product and
  open a console. docs/USER_GUIDE.md:804 already concedes it is
  "authored and driven partly from the browser console today." Either it
  earns an authoring UI before 1.0 or it should not be visible to an
  audience that cannot build one. *(cost of keeping: A Settings section
  and a reader bar that a non-technical user can enable and then cannot
  use, in a release whose entire premise is that such users can.
  Retirement here is cheap and reversible: CONSTITUTION Art. 3 keeps the
  record, every module and test stays, kind 30066 stays reserved and
  guard-tested by tests/lens-guards.test.mjs, and the rationale plus
  revisit condition go in docs/JOURNAL.md.)*
- **The five scaffolded Phase-9 flags — `factchecks`, `ratings`,
  `helpfulnessVoting`, `bridgingRanking`, `transitiveTrust`
  (src/shared/metadata/feature-flags.js:30–34)** — No UI, no shipped
  surface, and the file's own comment
  (src/shared/metadata/feature-flags.js:19–20) promising a disclosure
  "in Week 2" is years stale. Yet docs/USER_GUIDE.md:181–183 and :198
  present them to users as flags they can turn on. *(cost of keeping:
  They occupy four rows of a user-facing flag table that a non-technical
  reader will treat as a feature list, promising fact-checking, ratings,
  and helpfulness voting that do not exist. Either remove the rows from
  the guide or record the kill; leaving them documented is the more
  expensive option.)*
- **The reader's always-visible "Import audit JSON…" control
  (src/reader/index.html:126) and its Options twin
  (src/options/options.html:359)** — It is the entry point for a Node
  CLI at docs/auditor-prototype/scorer/ that this audience will not run,
  and the in-extension Quick/Thorough auditor supersedes it for everyone
  else. Its siblings on the same bar are correctly flag-hidden; only the
  import is unconditional. *(cost of keeping: An unexplained,
  permanently visible control on every capture the user ever opens,
  advertising a file format they cannot produce. Keep the Options-page
  import for the maintainer's own scorer workflow; remove it from the
  per-capture bar.)*
- **`case` as a selectable type in the side panel's "＋ New" entity
  dialog (src/sidepanel/index.html:31, src/sidepanel/index.js:2170)** —
  src/shared/case-create.js:20–23 states plainly that the case entity is
  "an implementation detail the user never assembles by hand" — and this
  control is exactly that hand-assembly, producing an object that looks
  like a case, is named like a case, and is not the case workspace
  anything else in the product means. *(cost of keeping: A newcomer
  creating their first case has a better-than-even chance of creating
  the wrong object from the more discoverable surface, then finding that
  captures do not join it and the portal has no dashboard for it. This
  is unrecoverable without reading source.)*
- **The vestigial "Experimental" heading in Settings → Advanced
  (src/options/options.html:319)** — It scopes one checkbox out of
  eleven default-off publish toggles that carry identical disclosure
  language. It is a leftover from when assessment publishing was the
  only experiment. *(cost of keeping: It actively misinforms: a careful
  user reads it as a boundary and concludes the other ten toggles are
  stable, shipped, and safe to enable. Removing the heading (or applying
  it consistently) costs one line.)*

**Doc gaps**

- docs/THREAT_MODEL.md does not exist, though
  .claude/skills/security-threat-modeler/SKILL.md:65 requires it ("A
  living threat model exists") and its Standard 1 makes it the spine of
  every disclosure decision. The user-facing consequence is that the
  answer to "what becomes public if I click this" lives only in eight
  scattered hint paragraphs in src/options/options.html.
- docs/USER_GUIDE.md has zero images — grep -c '!\[' returns 0 — against
  14 numbered [SCREENSHOT-nn] placeholders and an appendix (line 1210)
  that specifies each shot and estimates ~30 minutes total. Line 19–21
  states the placeholders are for "a human with a browser" to fill.
- README.md:265, docs/USER_GUIDE.md:111, and docs/SMOKE_TEST.md:47 all
  instruct clicking **Generate new key**, which does not exist
  (src/options/options.html:105 = "New identity…", :117 = "Generate &
  switch"). README.md:309 also lists a nonexistent "Reset" button in the
  Local panel.
- README.md's "First-run setup" section claims "Until you pick,
  capturing opens the Settings → Signing tab with a 'Set up signing'
  prompt instead of the reader." No such gate exists: src/content/ui.js
  openReader has no signing check, and Signer.isConfigured() is
  consulted only at src/content/index.js:90 to record a status string.
  Capture succeeds; the failure surfaces later as a Publish error.
- docs/USER_GUIDE.md §2.5's flag table (lines 174–198) reads as
  authoritative but omits four entries present in FLAGS_DEFAULTS:
  `localTranscription`, `transcriptClaimDrafts`,
  `extractionAnalysisPublishing` (which gates publishing kind 30070),
  and `storeFirstPublish`. Its preamble (168–170) directs users to
  DevTools for anything not in Settings.
- docs/SMOKE_TEST.md has no zero-state walk: its Setup section (19–62)
  lists a signing identity under "Test prereqs", so no verification
  layer in the repo ever starts from an empty browser profile. That is
  the gap that let the "Generate new key" label drift survive in three
  documents.
- Test- and bundle-count drift across the three documents a newcomer
  reads first: docs/SMOKE_TEST.md:26 says "1277/1277 should pass" and
  :24 "7 bundles"; README.md says "2100 tests" and "ten bundles";
  CLAUDE.md says "~2500 tests". docs/SMOKE_TEST.md:3–4 also scopes
  itself to "Phases 0–16" while its own body runs through Phase 29.
- No group-onboarding document exists. docs/USER_GUIDE.md §9.6 describes
  the collaboration bundle from the sender's side and gives the receiver
  one clause ("imports it via the entity list's Import button"); nothing
  walks a second person from install to contributing on a shared case,
  which is the exact journey the 1.0 goal names.
- No in-product route to any documentation except the capture guide
  (src/reader/index.js:4984, a GitHub URL). The reader's icon legend — ⭐
  🔗 ⚖ 🏛 ⚠ 🌐 📋, the vocabulary of the entire judgment layer — exists
  only at docs/USER_GUIDE.md §4.5 with nothing linking to it from the
  reader.
- docs/USER_GUIDE.md's own scope note (line 12) admits the pattern this
  whole review is about: features "authored from the browser console
  rather than a polished UI" are documented as such rather than fixed.
  For a 1.0 aimed at non-technical groups, that sentence should have no
  referents left.

**Machine-enforceable candidates**

- No user-visible string in src/**/*.js may match /see console|check the
  console|DevTools/i, or cite a docs/*.md path outside an anchor href —
  file-scan guard in the tests/lens-guards.test.mjs form; today it fails
  on eight sites (portal/synthesis-block.js:591,592,934;
  portal/entity-dossier-view.js:73,167; portal/extraction-block.js:276;
  portal/trace-block.js:63; sidepanel/index.js:1869) plus
  reader/lens-section.js:50.
- Every id in FLAGS_DEFAULTS (src/shared/metadata/feature-flags.js)
  either has a matching control id in src/options/options.html or
  appears in an explicit NO_UI_FLAGS allowlist carrying a one-line
  rationale — fails today on reviewCoordination,
  extractionAnalysisPublishing, storeFirstPublish, and the five Phase-9
  scaffolds, and fails in future on any new flag shipped without a home.
- Every button name a doc instructs the reader to click — bolded text
  following "click"/"→" in README.md, docs/USER_GUIDE.md, and
  docs/SMOKE_TEST.md — must appear as literal text in the corresponding
  HTML shell under src/. Fails today on "Generate new key" (three docs)
  and "Reset" (README.md:309).
- No <input> in src/options/options.html whose id or preceding label
  matches /token|key|secret|nsec|password/i may be type="text", and no
  assignment in src/options/index.js may write a value read from a
  storage key matching that pattern into an element's .value. Fails
  today on src/options/options.html:624 and src/options/index.js:1208.
- Every empty state rendered by a flag-gated surface must name a route
  that exists inside the product — a guard asserting no string reachable
  from a *-section.js or *-block.js empty branch matches
  /console|docs\// . Fails today on src/reader/lens-section.js:50.
- docs/USER_GUIDE.md must contain at least as many image references as
  [SCREENSHOT-nn] placeholders — fails today at 0 images against 14
  placeholders, and passes trivially once the placeholders are either
  filled or removed.

### group-research

There is a real, working collaboration path today, and it is narrower
than every doc implies. Two researchers can share a case bundle
(sidepanel/index.js:352, entity private keys), land on the same entity
pubkeys, publish articles (30023) and claims (30040) — the only two
ungated publish paths — and then see each other's work through two
ungated read surfaces: the reader's "Others' claims on this article"
modal (claim-extractor.js:854, `#r`-filtered kind-30040) and the
sidepanel's "Network activity about this entity"
(sidepanel/index.js:299, two-hop `#p`/`#a`). SMOKE_TEST rows
11b.8–11b.12 walk exactly this and it is genuinely tested. Everything
above that level is either flag-gated default-off (the entire Network
page, and every judgment kind — assessments, verdicts, audits, findings,
briefs) or built but unrendered: foreign judgments accepted through the
incorporation queue land in `incorporated_artifacts`, which no surface
outside the queue's own dedup check ever reads, so a teammate's
competing verdict on your claim vanishes on accept. The deepest problem
is not missing features but unreadable identity — in both ungated
cross-researcher surfaces the author renders as a raw 12-char hex prefix
with no name and no npub (claim-extractor.js:977 literally names the
variable `shortNpub` while slicing hex), so a user handed an `npub1…` by
a teammate cannot match it to anything on screen. This is parallel solo
work with a shared entity namespace, not group research; the NOSTR wire
is the right substrate and is already carrying more than the UI
surfaces.

**Blockers**

- **Author identity renders as raw hex in both ungated cross-researcher
  surfaces** *(S, user-visible)*
- Evidence: src/reader/claim-extractor.js:977 `const shortNpub =
    pubkey.slice(0, 12);` (hex, under an npub-named variable), rendered
    at :982; src/sidepanel/index.js:706-707 `feedAuthor` returns `👤
    ${(ev.pubkey||'').slice(0,12)}…`, used at
    :722,:727,:735,:740,:745,:750,:755,:760. Only
    src/network/index.js:66-69 `shortNpub()` correctly uses
    `Crypto.hexToNpub`. Violates the project's own rule in
    NETWORK_CLIENT_DESIGN.md §4.3 and TEAM_CASE_DESIGN.md §3.4 ('npubs
    beside names, everywhere, both views').
- Why 1.0: The question 'who published this?' has no answer in the two
    surfaces a non-technical group actually uses. Hex and bech32 are
    different encodings, so a teammate's shared `npub1…` cannot be
    visually matched against `3bf0c63fcb93…` at all — not even by
    prefix. Lookalike-teammate confusion, which TEAM_CASE §3.4 says
    'dies here', is instead created here.
- Fix: Extract one author-chip helper (npub + optional FollowModel label
    + hex on hover) and route claim-extractor.js:977 and
    sidepanel/index.js:706 through it, as src/network/index.js already
    does.
- **The only bulk corpus-sharing path requires handing a colleague your
  nsec** *(M, user-visible)*
- Evidence: docs/JOURNAL.md 2026-07-25 'Backup merge-import: accrual,
    not replacement' names mergeBackup 'the asynchronous-collaboration
    path (import a colleague's corpus…)'. But src/shared/backup.js:67
    `EXCLUDED_STORAGE_KEYS =
    ['xray:llm:key','workspaces','active_workspace']` only, so
    `collectStorage` (backup.js:253-271) emits `local_primary_identity`
    and `identity_profiles` (every saved nsec). backup.js:4-6 and
    docs/USER_GUIDE.md §2.6 both confirm it: 'Treat the file like an
    `nsec`, because it contains yours.'
- Why 1.0: The documented way for two researchers to pool corpora
    requires the sender to transmit their signing identity. mergeBackup
    correctly ignores identity on import (backup.js:495), but the file
    was already handed over. Non-technical users will do this over chat
    or email; there is no share-safe export mode to reach for.
- Fix: Add a share mode to `collectBackup` that omits
    `local_primary_identity`, `identity_profiles`, and (by choice)
    `local_keys`, stamps the file as content-only, and have the Options
    merge flow prefer it; keep the full backup for self-restore only.
- **Incorporated foreign judgments are written to a store nothing
  renders** *(M, user-visible)*
- Evidence: src/shared/incorporation.js:160-163 routes accepted
    assessments/verdicts to `incorporated_artifacts`.
    NETWORK_CLIENT_DESIGN.md §5 decision 1 promises they 'render
    side-by-side with native records (never averaged — P8)'. Grep for
    `incorporated_artifacts`/`loadIncorporated`/`INCORPORATED_KEY`
    across src/ returns only src/network/index.js:625 and :668 — both
    inside `renderQueue`/`onQueueClick`, used solely to hide
    already-incorporated proposals.
- Why 1.0: Conflicting judgments on the same claim are the core of group
    research, and accepting a teammate's verdict currently makes it
    disappear from the UI entirely. The user performed a review and got
    nothing back. This is the single largest gap between the shipped
    product and its own design.
- Fix: Render `incorporated_artifacts` beside native records wherever a
    claim's judgments are shown (reader claims bar, portal claim
    inspector), attributed by author npub, never merged into rollups.
- **Accepted foreign claims are indistinguishable from your own and
  silently never publish** *(S, user-visible)*
- Evidence: src/shared/incorporation.js:129-142 stamps `suggested_by:
    'nostr:<pubkey>'`; src/reader/index.js:5580-5587 filters exactly
    those out of `claimsToPublish`. But no reader, sidepanel, or portal
    surface renders that provenance — the only `nostr:`-aware badge is
    src/portal/hypothesis-block.js:86-90, and hypotheses are not an
    incorporable class (`PROPOSAL_CLASSES` at incorporation.js:39 is
    claim/link/assessment/verdict).
- Why 1.0: A teammate's claim sits in your claims bar looking exactly
    like yours, and then publish skips it with no message. Both halves
    are wrong for a group: attribution is invisible, and the correct
    refusal to republish someone else's signed work is indistinguishable
    from a bug.
- Fix: Render the existing `suggested_by` provenance as an
    author-attributed badge on claim rows (reuse
    portal/hypothesis-block.js:86 `provenanceBadge`), and state the skip
    in the publish summary rather than filtering silently.
- **The collaboration bundle is near-empty for the way cases are
  actually built** *(M, user-visible)*
- Evidence: src/shared/case-bundle.js:106 deliberately calls the narrow
    `collectClaimOrbitEntityIds`, not the union `collectCaseEntityIds`.
    The module's own comment at case-bundle.js:66-70 records the
    consequence: a tag-built case — 'the real COVID workspace: 49 member
    articles, zero claims `about` the case' — 'had an orbit of ONE
    entity — itself'. docs/CASE_BOUND_WORKSPACES_KICKOFF.md §4 ('Capture
    pipeline') makes every capture auto-tag the bound case, so tag-built
    is now the default shape. The scope decision is recorded unresolved
    at case-bundle.js:36-39.
- Why 1.0: 'Share case bundle' is the headline collaboration affordance
    (sidepanel/index.js:352) and on a realistically-built case it hands
    the teammate one entity and zero shared people or organizations — so
    their claims tag different pubkeys and the `#p` rendezvous the
    bundle exists to create does not happen.
- Fix: Implement the scope selector the code comment already prescribes:
    offer narrow (claim orbit) vs full (tag∪claim union) with an entity
    count and key count in the confirm dialog.
- **Case-scoped follows — the designed joining mechanism — exist in the
  model but in no surface** *(L, user-visible)*
- Evidence: src/shared/follow-model.js:31 `FOLLOW_SCOPES =
    ['case','entity','global']`. Grep for `scope: 'case'`/`scope:
    'entity'` across src/ returns nothing; the only anchor constructions
    are src/network/index.js:41 `const GLOBAL = { scope: 'global' }` and
    src/shared/follow-publish.js:26. TEAM_CASE_DESIGN.md §2.2 makes the
    local per-case follow set THE joining mechanism ('Add the teammates
    to a local, unpublished per-case follow set'). docs/ROADMAP.md:1461
    nevertheless marks KS.5 shipped as 'case+entity+global scoped
    (implements TEAM_CASE TC.2)'.
- Why 1.0: 'Join a case with your team' is not implemented — only
    'follow people globally'. Because follows are also invisible
    per-workspace (below), a group has no way to express 'these five
    people are on this investigation', which is the premise of the whole
    team design.
- Fix: Either wire a per-case follows panel into the case dashboard and
    scope the Network feed by active case, or correct ROADMAP:1461 and
    USER_GUIDE §10 to describe only the global scope and record the
    case/entity scopes as unshipped.
- **Two group-coordination flags have no Options control and require
  DevTools** *(S, user-visible)*
- Evidence: `grep setOverride( src/options/index.js` returns 16 flags;
    `reviewCoordination` and `extractionAnalysisPublishing` are absent.
    They are read at src/network/index.js:798,
    src/portal/inspector.js:404, src/portal/extraction-block.js:137.
    docs/USER_GUIDE.md §10 nevertheless presents 'Request review /
    re-broadcast (`reviewCoordination`)' as an available feature, and
    §2.5 says only that unspecified flags are 'flipped in DevTools via
    the `chrome.storage.local` key `xray:flags`' without marking which.
- Why 1.0: Review requests and re-broadcast are the only shipped
    coordination primitives a group has (TEAM_CASE §5), and the 1.0
    audience cannot open DevTools and hand-edit a JSON storage key.
    Documented-but-unreachable is worse than absent.
- Fix: Add both checkboxes to the Advanced tab alongside
    `pref-network-page` (options.html:203), or mark them 'DevTools only'
    in the §2.5 table.

**Should fix**

- **Companion auth token is echoed back into a visible text field**
  *(S)* — src/options/index.js:1208
  `document.getElementById('pref-transcriber-token').value = await
  llmRawGet(TRANSCRIBER_TOKEN_STORAGE);` against :1218-1219 which set
  the AssemblyAI/Deepgram fields to `''` by policy;
  src/options/options.html:624 declares `<input type="text"
  id="pref-transcriber-token">`. → Follow the cloud-key pattern: never
  load the value, render a set/unset status chip, and use
  `type="password"`. Group-relevant because teammates screen-share
  settings while troubleshooting the companion.
- **TC.3 group-accountability disclosures never shipped** *(M)* —
  TEAM_CASE_DESIGN.md §9 lists TC.3 (computed panel-composition block,
  provenance-propagation badge, correlated-judgment disclosure);
  ROADMAP.md:1455-1468 maps TC.1/TC.2/TC.4/TC.7 onto Phase 25 slices but
  never TC.3. Grep for `correlated`/`panel compos` in src/ hits only
  src/reader/lens-section.js:246-264 and src/shared/lens-engine.js:9 —
  the Moral Lens, a different feature. → Ship the correlated-judgment
  disclosure line at minimum ('N of this view's judgments trace to
  material from a single author') — TEAM_CASE §3.6 calls it the only
  answer to groupthink, and it is computable from existing
  `suggested_by` provenance.
- **Case export JSON has no importer, so it cannot travel between
  installs** *(M)* — src/shared/case-export.js is export-only; `grep
  collectCaseData src/` shows the single consumer is
  src/sidepanel/index.js:28. USER_GUIDE §9.6 offers it as one of two
  'Two exports' for sharing a case. → Either add an importer that loads
  claims/assessments/links as reviewable proposals (reusing
  incorporation.js's accept seam), or relabel it in §9.6 as a report
  format for humans, not a transfer format.
- **The Network page never says which workspace's follow list it is
  showing** *(S)* — `follow_sets` is workspace-namespaced
  (src/shared/workspace-keys.js:35, inside WORKSPACE_CONTENT_KEYS);
  src/network/index.js mentions 'workspace' exactly once, at :733,
  inside the kind-3 mirror consent text. → Show the active
  workspace/case name in the Network page header, as
  CASE_BOUND_WORKSPACES §4 already requires of the other chrome ('you
  should never wonder whose data you are looking at').
- **Adopt-on-sight, the entity-convergence mitigation, runs on chained
  native confirm() dialogs** *(M)* — src/shared/adopt-entity.js:81, :85,
  :88 each call `confirmFn` defaulting to `globalThis.confirm`
  (adopt-entity.js:59), up to three in sequence, carrying the name-clash
  warning as text inside the dialog string at :76. → Replace with an
  in-page modal showing the proposed name, type, npub, and clash
  side-by-side. TEAM_CASE §2.3 makes this the defense against
  entity-graph fragmentation across a team, so its usability is
  load-bearing.
- **TC.5 custody/deputy escrow never shipped, so a group has no
  key-continuity story** *(M)* — TEAM_CASE_DESIGN.md §6 and §9 specify
  single-key deputy escrow ('export the case key alone to a designated
  deputy'); grep for `deputy`/`escrow` across src/ returns nothing. The
  only key-sharing path is the whole-bundle export at
  src/shared/case-bundle.js:101. → Either ship the narrow single-key
  export or document the accepted consequence in USER_GUIDE §9.6 — if
  the case-key holder leaves, kind-0 and 32125 updates freeze while
  members keep publishing.
- **Assessing a teammate's claim is possible but unpublishable by
  default** *(S)* — src/reader/claim-extractor.js:903-914 wires an
  Assess action onto every foreign claim in the Others' modal;
  publishing the resulting 30054 is gated by `assessmentPublishing`,
  default false (src/shared/metadata/feature-flags.js:40), checked at
  src/reader/index.js:5562 and :6152. → When a user assesses a foreign
  claim while the flag is off, say so at that moment ('saved locally;
  publishing assessments is off'). The dead end is currently discovered
  only at publish time.
- **No guard test enforces the design's own npub-display rule** *(S)* —
  NETWORK_CLIENT_DESIGN.md §4 says the rendering checklist is
  'guard-tested where pure' and §4.3 is the npub rule; `grep npub
  tests/network-feed.test.mjs tests/incorporation.test.mjs` returns
  nothing. The 66 tests in those files pass and cover ordering, capping,
  dedup, and no-persist-on-view — but not identity display. → Add the
  guard described in machine_enforceable so the two hex-prefix sites
  cannot regress after they are fixed.

**Kill candidates**

- **The `case` and `entity` scopes in FOLLOW_SCOPES
  (src/shared/follow-model.js:31)** — No call site in src/ constructs
  either anchor; the registry, its tests, and three docs (ROADMAP:1461,
  USER_GUIDE §10, TEAM_CASE §2.2) describe a capability the product does
  not expose. *(cost of keeping: Three documents assert a shipped
  team-joining mechanism that does not exist, which is exactly the class
  of defect the 1.0 audience shift makes fatal — the maintainer knows it
  is unwired, a new group does not. Keeping it costs credibility on
  every other 'shipped' claim.)*
- **The §8 published-roster extension (TEAM_CASE_DESIGN.md §300-330)** —
  Already deferred, and its own text records the blocking adversarial
  finding (roster memory-holing) plus three normative mitigations that
  would have to ship with it. The follow-feed model was adopted
  specifically to make it unnecessary. *(cost of keeping: It reads as
  roadmap rather than as a closed decision, and it is the largest
  remaining design surface pointing at consensus/membership machinery
  that the owner constraints (TEAM_CASE §1, 'the ruled-out level')
  forbid.)*
- **The machine-readable half of case export (src/shared/case-export.js
  `buildCaseJson`)** — There is no importer anywhere in src/, so the
  JSON has no consumer inside X-Ray; the Markdown report is the half
  that actually serves a reader. *(cost of keeping: USER_GUIDE §9.6
  presents it as a sharing mechanism, so users will try to import it and
  find no affordance. Either it earns an importer or it should be
  recorded as a report-only artifact.)*
- **`bridgingRanking` and `transitiveTrust` flags
  (src/shared/metadata/feature-flags.js:33-34)** — USER_GUIDE §2.5
  documents them as 'Experimental ranking/trust (not yet shipped)'; they
  gate nothing reachable and sit adjacent to the collaboration flags in
  the same table. *(cost of keeping: They imply a ranking/reputation
  direction that TEAM_CASE §1 and NETWORK_CLIENT_DESIGN §9 both
  explicitly rule out, muddying the trust posture a group needs to
  understand before publishing anything.)*

**Doc gaps**

- No end-to-end 'two researchers, one investigation' walkthrough exists
  anywhere. USER_GUIDE §9.6 is twelve lines on exports and §10 is about
  following strangers; neither connects bundle → shared entity pubkeys →
  publish → Others'-claims/Network-activity into one path, though
  SMOKE_TEST rows 11b.8–11b.12 already walk exactly that sequence and
  could be the skeleton.
- docs/THREAT_MODEL.md does not exist, though the
  security-threat-modeler skill's Standard 1 requires it. Acute for the
  group story specifically: the trust model is 'follow ≠ trust' plus
  deliberate private-key sharing via case bundles, and nothing states
  the resulting boundaries.
- USER_GUIDE §2.5's flag table does not mark which flags have an Options
  control and which need DevTools — `reviewCoordination` and
  `extractionAnalysisPublishing` are DevTools-only (absent from the 16
  `setOverride` calls in src/options/index.js) yet appear in the table
  indistinguishably.
- USER_GUIDE §9.6 does not disclose that the collaboration bundle uses
  the narrow claim orbit, so it never warns that a tag-built case
  exports one entity — the consequence the code itself records at
  src/shared/case-bundle.js:66-70.
- USER_GUIDE §2.6 warns the backup contains your nsec but never warns
  against sending one to a colleague, while docs/JOURNAL.md 2026-07-25
  actively recommends merge-import as 'the asynchronous-collaboration
  path'. The two documents together lead a group straight into key
  disclosure.
- No group key-management guidance exists. TEAM_CASE §4.1 calls per-case
  identities 'the prescribed default' for casework and names their cost
  (forfeiting the cross-case asserter track record); `grep -i 'per-case
  identit|identity profile' docs/USER_GUIDE.md` returns nothing.
- docs/ROADMAP.md:1461 states KS.5 shipped 'case+entity+global scoped
  (implements TEAM_CASE TC.2)', and ROADMAP §KS omits TC.3 and TC.5
  entirely rather than recording them as unshipped — so the roadmap
  reads as more complete on collaboration than the tree is.
- All 15 `[SCREENSHOT-nn]` placeholders in USER_GUIDE.md are unfilled
  (the file's own preamble says 'They are placeholders — a human with a
  browser fills them in'). A 1234-line, screenshot-free, feature-ordered
  reference is the wrong shape for the non-technical audience regardless
  of collaboration.

**Machine-enforceable candidates**

- Author-identity guard: no module under src/ may render an author
  pubkey via `.slice(` on a hex string — assert every author-display
  helper routes through `Crypto.hexToNpub`; fails today at
  src/reader/claim-extractor.js:977 and src/sidepanel/index.js:707.
- Flag-reachability guard: every key in FLAGS_DEFAULTS either appears in
  a `setOverride(` call in src/options/index.js or is listed in an
  explicit DEVTOOLS_ONLY allowlist that USER_GUIDE §2.5 mirrors; fails
  today for `reviewCoordination` and `extractionAnalysisPublishing`.
- Follow-scope guard: every entry in FOLLOW_SCOPES has at least one
  anchor-constructing call site in src/ outside follow-model.js itself;
  fails today for 'case' and 'entity'.
- Write-only-store guard: every WORKSPACE_CONTENT_KEYS entry written by
  a shared model is read by at least one surface under
  src/{reader,portal,sidepanel,network}/, or is named in an explicit
  write-only allowlist; fails today for `incorporated_artifacts`.
- Share-safety guard: assert `collectBackup` in share mode emits no
  `local_primary_identity`, no `identity_profiles`, and no `local_keys`,
  and that `mergeBackup` refuses a file containing them with a named
  error rather than silently ignoring.

### consolidation

X-Ray is a genuinely capable tool carrying a decade of design decisions
in two years of tree, and the maintainer's read is right: the sprawl is
real and it is mostly at the seams, not in the engines. The census found
28 feature flags of which 8 are never consulted by any isEnabled() call,
4 wire kinds (30050/30051/30052/9803) the Art. 10 schedule calls
"active" that no production code path can emit, 48 docs of which 18 are
unreferenced by CLAUDE.md — including USER_GUIDE.md, the single most
important 1.0 artifact — and 8 distinct judgment vocabularies whose
Options-page labels expose raw NOSTR kind numbers to the researcher. The
audience shift is where it bites hardest: there is no first-run
experience (background/index.js:342 registers context menus and nothing
else), zero in-app links to the 1,234-line user guide, and the
group-collaboration story the 1.0 goal depends on is split across three
unreconciled models with its coordination verb (reviewCoordination)
reachable only through DevTools. Two things are unambiguously good and
should be the template for the rest: the Phase-19 fact-layer retirement
and the kind-30043 retirement are both clean, commented,
migration-bearing, and guard-tested — that is exactly how the kills
below should be executed. The most concrete single finding is verifiable
in 60 seconds: `web-ext build` produces an 11.9 MB zip containing 201
test files, 83 docs files including CONSTITUTION.md and the EPISTACK
competition entries, the full src/ tree, and 18.4 MB of source maps,
because package.json's webExt.ignoreFiles excludes only "companion".

**Blockers**

- **No first-run experience and no in-app path to the user guide** *(M,
  user-visible)*
- Evidence: src/background/index.js:342 —
    `chrome.runtime.onInstalled.addListener(registerContextMenus)` is
    the only install handler. Grepping all five surface shells
    (src/options/options.html, src/reader/index.html,
    src/portal/index.html, src/sidepanel/index.html,
    src/network/index.html) for USER_GUIDE / user-guide / docs/ returns
    exactly one hit: options.html:351, pointing at a CLI directory.
    docs/USER_GUIDE.md is 1,234 lines with a full glossary at §11.
- Why 1.0: A non-technical researcher installs the .zip and lands on a
    browser with a new toolbar icon and no orientation. Nothing prompts
    identity creation before the first publish attempt, nothing explains
    that most features are flag-gated off, and the guide that answers
    all of it is a file in a GitHub repo they were never told about. The
    operator never needed this because he wrote the thing.
- Fix: Open the Options page (or a dedicated welcome view) on
    `onInstalled` with reason==='install'; add a persistent Help link in
    every surface header pointing at the published USER_GUIDE; add a
    first-run checklist (identity → relays → optional flags) that marks
    itself done.
- **The group-collaboration surface ships off, and its coordination verb
  has no UI at all** *(S, user-visible)*
- Evidence: src/shared/metadata/feature-flags.js:147 `networkPage:
    false`; `reviewCoordination: false` at :153. Grep of
    src/options/options.html for review-coordination returns 0 — the
    flag is gated at src/network/index.js:798 and
    src/portal/inspector.js:404 but has no checkbox among the 32 pref-
    ids in options.html. docs/USER_GUIDE.md:1090 documents "Request
    review / re-broadcast (reviewCoordination)" as an opt-in gate
    without saying it is DevTools-only.
- Why 1.0: The stated 1.0 goal is groups doing research together. The
    entire group surface is default-off, and the one verb that lets a
    group ask each other for adversarial review can only be enabled by
    opening DevTools and hand-editing a chrome.storage.local JSON blob.
    A non-technical group cannot reach the feature the release is for.
- Fix: Add an options control for reviewCoordination beside the existing
    network flags; decide whether networkPage still needs to be a flag
    at 1.0 (Phase 25 is marked COMPLETE in ROADMAP.md:'Phase 25 ✅
    COMPLETE') and if it ships on, fold its sub-flags into the surface's
    own consent dialogs rather than a second flag layer.
- **Three unreconciled collaboration models, none of which knows the
  others exist** *(M, user-visible)*
- Evidence: (1) Collaboration bundle — src/sidepanel/index.js:945-961
    `shareCaseBundle`, a downloaded JSON carrying entity PRIVATE KEYS,
    described at src/sidepanel/index.html:350. (2) The Network client —
    Phase 25, docs/NETWORK_CLIENT_DESIGN.md, relay-mediated
    follow/incorporate. (3) docs/TEAM_CASE_DESIGN.md:3-45, four stacked
    amendments, whose §2.1 case anchor, §6 custody, §8 roster, TC.3 and
    TC.5 are declared "authoritative in this document" but are not in
    any completed ROADMAP phase.
- Why 1.0: A group asking "how do we work on this case together?" gets
    three answers with different trust models — email a file containing
    private keys, follow each other's npubs and accept proposals, or a
    design that was never built. Nothing in the product or the guide
    tells them which one is the supported path, and one of the three
    hands out nsec-grade material as a normal-looking download.
- Fix: Pick ONE supported 1.0 path (the Network/incorporation model is
    the only one that scales and the only one without key-sharing),
    document the collaboration bundle as an advanced key-continuity tool
    with a hard warning, and add a supersession banner to
    TEAM_CASE_DESIGN.md naming what shipped and what is parked.
- **The companion auth token field is the one credential input that
  displays its stored secret** *(S, user-visible)*
- Evidence: src/options/options.html:624 `<input type="text"
    id="pref-transcriber-token" ...>` — no type=password, no
    autocomplete=off, no spellcheck=false. src/options/index.js:1208
    loads the stored value straight into it on every Options load.
    Contrast options.html:460/601/610 (llm-key, aai-key, dg-key), all
    type="password" autocomplete="off", and
    src/options/index.js:1218-1219 which explicitly blank them.
    docs/JOURNAL.md:46-52 records that the maintainer actually pasted a
    Hugging Face token into this field; the recorded remedy was a
    relabel only.
- Why 1.0: The JOURNAL proves the misuse case is not hypothetical — the
    field's own author put a real provider credential in it. Because it
    echoes, that credential then renders in cleartext on every Options
    visit, is spellcheck-eligible, and is exposed to any screen share or
    screenshot the researcher takes while walking a collaborator through
    setup. Every neighbouring field on the same page already does this
    correctly.
- Fix: Change to type="password" autocomplete="off" spellcheck="false";
    stop echoing the stored value — mirror the key-status pattern ("A
    token is saved on this device") already used at
    src/options/index.js:1231-1237; treat a blank submit as no-change.
- **The release .zip ships the entire repository, including governance
  docs and the test suite** *(S, user-visible)*
- Evidence: package.json:39-42 — `webExt.ignoreFiles` is `["companion",
    "companion/**"]` and nothing else. Verified by running `web-ext
    build`: the 0.8.0 artifact is 11,898,044 bytes and its listing
    contains 201 tests/ entries, 83 docs/ entries (including
    docs/CONSTITUTION.md at 30,801 bytes, docs/EPISTACK_ENTRY.md at
    32,628 bytes, docs/epistack/), 259 src/ entries, esbuild.config.mjs,
    package-lock.json and CLAUDE.md. Uncompressed dist/ is 30.9 MB of
    which 18.4 MB is 10 .map files.
- Why 1.0: The thing a non-technical user downloads and loads is ~10x
    larger than it needs to be and carries the project's internal
    governance, journal, competition submissions, and agent instructions
    as if they were product. It is also the artifact a store review
    sees. Nothing in it is secret, but shipping CLAUDE.md and the
    constitution to every end user is not a considered disclosure — it
    is an unpruned ignore list.
- Fix: Extend webExt.ignoreFiles to exclude docs/**, tests/**,
    esbuild.config.mjs, package-lock.json, CLAUDE.md, node_modules/**,
    and the non-shipping src/ subtrees (everything except
    src/page/nip07-bridge.js and the five HTML/CSS shells); drop
    `sourcemap` for release builds or emit maps outside dist/. Add a
    packaged-contents assertion so this cannot silently regrow.
- **docs/THREAT_MODEL.md does not exist though the security discipline
  requires it and gates PRs on it** *(M)*
- Evidence: .claude/skills/security-threat-modeler/SKILL.md:65 Standard
    1 — "A living threat model exists. docs/THREAT_MODEL.md
    enumerates…"; :72 — any PR adding a network destination that does
    not touch the file fails. Seven references to the path across that
    skill; `ls docs/THREAT_MODEL.md` → absent. The tree meanwhile holds
    nsecs in chrome.storage.local, strips CSP via rules/csp-strip.json,
    injects a MAIN-world bridge, and reaches Anthropic, AssemblyAI,
    Deepgram, arbitrary relays and loopback:8756/1234.
- Why 1.0: A standard whose precondition does not exist cannot fail, so
    the gate has never fired on any of the network destinations added
    this year. At 1.0 the users are non-technical people whose research
    subjects may be adversarial; the project needs a written statement
    of what it protects and what it does not, and its own discipline
    already says so.
- Fix: Write docs/THREAT_MODEL.md with one row per trust boundary
    (content script ↔ page, MAIN-world bridge, SW ↔ relays, SW ↔ cloud
    providers, companion loopback, backup/import/merge, LLM prompt
    surfaces), each naming receiver-side validation status and
    key-material exposure. Reference it from CLAUDE.md's project-docs
    list.
- **Eight judgment vocabularies, surfaced to the researcher as raw NOSTR
  kind numbers** *(L, user-visible)*
- Evidence: docs/USER_GUIDE.md §5 is titled "The judgment vocabulary"
    and runs §5.1–§5.8 (assessments, claim relationships, attestation,
    adjudication, integrity, epistemic audits, forensic findings, lens
    readings). Four separate taxonomy modules define overlapping value
    sets: src/shared/assessment-taxonomy.js:19-37 (24 labels) plus a
    −2…+2 stance at :67-75, src/shared/truth-taxonomy.js:230-236 (5
    verdict states) and :255-259 (3 standards of proof),
    src/shared/forensic-taxonomy.js:38-78 (~35 maneuver labels),
    src/shared/lens-taxonomy.js:108-165. The Options labels read
    "Publish assessments & claim links to relays" (options.html:323),
    "Publish audit events to relays" (:338), "Publish adjudicated
    verdicts & integrity findings to relays" (:387), "Publish entity
    profiles & mention notes (kind 0 + kind-1 notes)" (:408).
- Why 1.0: This is the "bolted on" complaint at its source. A researcher
    must learn the difference between an assessment, a verdict, a
    finding, an audit, an integrity finding, and a lens disposition
    before they can decide what to publish — and the switch that decides
    it is labeled with a wire kind number. Group work multiplies the
    cost: collaborators must share the same mental model to read each
    other's artifacts.
- Fix: Do not merge the underlying kinds — the firewalls between them
    are load-bearing and constitutionally grounded. Instead consolidate
    the SURFACE: one "What you publish" panel with plain-language rows
    ("Your take on a claim", "A ruling on whether something is true", "A
    named rhetorical maneuver"), kind numbers demoted to a details
    disclosure, and one shared decision table in USER_GUIDE §5 that
    answers "which layer do I use?" before the eight subsections start.
- **The user guide's feature-flag table omits five real flags and
  documents three that gate nothing** *(S, user-visible)*
- Evidence: docs/USER_GUIDE.md:174-197 is the flag table. Grepping the
    guide finds 0 occurrences of aiVision, localTranscription,
    transcriptClaimDrafts, storeFirstPublish, and
    extractionAnalysisPublishing — all five exist in
    src/shared/metadata/feature-flags.js and four are options-surfaced.
    Conversely the table's rows for `factchecks` (:180), `ratings`
    (:181) and `helpfulnessVoting` (:182) describe publish gates that do
    not exist: no isEnabled() call in src/ references any of them.
- Why 1.0: The flag table is the only map a user has of what the tool
    can do, and it is wrong in both directions. Someone follows :180,
    sets `factchecks: true` in DevTools as instructed, and nothing
    happens — there is no code to switch on. Someone else never learns
    that `aiVision` or `localTranscription` exist. For a group
    standardising a setup between members, a wrong table means a whole
    team configured on false premises.
- Fix: Regenerate the table from FLAGS_DEFAULTS, add a "where" column
    (Settings ▸ Advanced vs DevTools-only), delete or explicitly
    mark-as-unimplemented the dormant Phase-9a rows, and add the guard
    below so the table can never drift again.

**Should fix**

- **Eight of 28 feature flags are never read by any code** *(S)* —
  src/shared/metadata/feature-flags.js:24,25,26 (annotations,
  respondsTo, topicTrust — default true) and :30,31,32,33,34
  (factchecks, ratings, helpfulnessVoting, bridgingRanking,
  transitiveTrust). An exhaustive grep of `isEnabled('...')` across src/
  yields 27 distinct call sites covering 20 flags; these 8 appear at no
  call site. The identically-named strings that do appear are unrelated
  IndexedDB store names (src/shared/archive-cache.js:58-60). → Delete
  the five dead 9a/9b/9c flags with a JOURNAL kill entry (Art. 11
  kill-and-revisit), or if the scaffolding intent survives, move them to
  a clearly-labeled RESERVED_FLAGS block that the guard test exempts and
  the user guide does not advertise.
- **Four wire kinds the constitution calls "active" have builders but no
  production caller** *(S)* — src/shared/metadata/builders.js:201 (kind
  30050), :307 (30051), :366 (30052), :412 (9803). Grepping
  buildAnnotation / buildFactCheck / buildRating / buildHelpfulnessVote
  across src/ finds callers only in tests/metadata-builders.test.mjs.
  buildTopicTrustEvent (src/shared/metadata/topic-trust-builder.js)
  likewise has no src/ caller. The code itself calls them "dormant
  metadata kinds" at src/portal/corpus.js:40 and
  src/portal/library.js:36. docs/CONSTITUTION.md:416 lists "30050–30053
  | active". → Reclassify the row in Art. 10 from `active` to `reserved
  — scaffolded, unemitted` (a Tier-appropriate amendment, not a
  retirement, since nothing was ever published), and say so in
  NIP_DRAFT.md. Never-reuse is not at issue; honest status is.
- **src/shared/metadata/ranker.js is unreachable code that ROADMAP
  already admits is unwired** *(S)* — docs/ROADMAP.md Phase 25.7 bullet:
  "`ranker.js` stays unwired." Confirmed: grep for rankAnnotations or
  any import of ranker across src/ returns nothing outside the file
  itself. Its two gating flags, bridgingRanking and transitiveTrust, are
  in the dead-flag set above. → Record the kill in JOURNAL with the
  v3-ranker rationale and delete; it remains git-recoverable per Art.
  11. Alternatively keep the file but move it under a clearly-marked
  unshipped/ path so it stops reading as live product.
- **SMOKE_TEST.md's header understates the tree by 13 phases, three
  bundles, and ~1,240 tests** *(S)* — docs/SMOKE_TEST.md:4 "exercises
  every shipped surface across Phases 0–16" (ROADMAP.md:191 has Phase 29
  in progress); :25 "npm run build  # produces dist/*.bundle.js (7
  bundles)" — esbuild.config.mjs defines ten (content, background, five
  pages, api-interceptor, pdf-engine, pdf.worker); :26 "npm test  #
  1277/1277 should pass" against ~2,513 tests over 197 files. → Correct
  the three numbers and derive the test count and bundle count from the
  build rather than restating them; the doc already has 45 sections
  covering well past Phase 16, so only the header lies.
- **CLAUDE.md omits Phase 29, the event store, the opinion modules, and
  USER_GUIDE.md entirely** *(S)* — Grep of CLAUDE.md for "Phase 29",
  EVENT_STORE, opinion, storeFirst returns zero hits, while
  ROADMAP.md:191/2046 has Phase 29 in progress against
  docs/EVENT_STORE_DESIGN.md (agreed 2026-08-02) and
  docs/OPINION_MODULES_KICKOFF.md is marked SHIPPED. 18 of the 48 docs
  are unreferenced by CLAUDE.md; USER_GUIDE.md is among them (README
  references it twice; CLAUDE.md's "Project docs" list does not). → Add
  Phase 29 + EVENT_STORE_DESIGN + OPINION_MODULES to the ROADMAP
  paragraph, and add USER_GUIDE.md to the project-docs list with an
  explicit instruction that any user-visible change updates it. That
  omission is the mechanical cause of the stale flag table above.
- **The Options page instructs users to run a CLI out of the docs
  directory** *(S)* — src/options/options.html:351 — "Run the companion
  scorer CLI (<code>docs/auditor-prototype/scorer/</code>) against a
  captured article, then import its JSON here." Meanwhile
  src/reader/index.html:124-125 offer in-extension "Quick audit" and
  "Thorough audit" buttons (Phase 14.5). docs/auditor-prototype also
  carries schema/audit-types.ts — TypeScript, in a repo CLAUDE.md
  describes as having none — and a prompts/ corpus that parallels
  src/shared/audit/module-prompts.js (1,329 lines). → Rewrite the hint
  to lead with the in-extension audit buttons and mention JSON import as
  the interoperability path; move the prototype out of the user-facing
  story. The duplicate prompt corpus is a drift hazard — either generate
  one from the other or mark the prototype archival.
- **Two toolbar buttons named "Suggest", distinguished only by an emoji
  and a parenthetical** *(S)* — src/reader/index.html:27
  `id="xr-suggest"` labeled "✨ Suggest…" (Anthropic, paid, gated by
  llmAssist) and :73 `id="xr-suggest-local"` labeled "💫 Suggest
  (local)…" (LM Studio loopback, free, gated by transcriptClaimDrafts).
  A third, `xr-pending-suggest` at :33, opens the same review modal for
  import-time parked proposals. → Name them by what differs and what it
  costs the user: "Suggest (cloud — sends article text)" vs "Suggest (on
  this machine)", and label the pending one "Review parked suggestions".
  The privacy difference between the two is the single most
  decision-relevant fact and is currently carried by ✨ vs 💫.
- **The archive surface has three names across the product** *(S)* —
  src/background/index.js:138 context menu title 'Open My Archive';
  src/sidepanel/index.html:15 button label "Archive" with title "Open My
  Archive"; the code, esbuild entry, and directory are all `portal`;
  docs/USER_GUIDE.md §7 heading is 'The portal ("My Archive")';
  docs/PORTAL_DESIGN.md is the design doc. Similarly the side panel is
  "Open Entity Browser" in the menu (background/index.js:133),
  "Entities" on the reader button (reader/index.html:76), and "the side
  panel" in docs. → Pick one user-facing noun per surface (suggest
  "Archive" and "Entities"), use it in every label, menu, tooltip and
  guide heading, and keep `portal`/`sidepanel` as internal-only
  identifiers with a note in CLAUDE.md that the code name is not the
  product name.
- **Two documents that govern shipped behavior are still labeled "design
  draft"** *(S)* — docs/TRUTH_ADJUDICATION_DESIGN.md status line:
  "design draft (Phase 15)" — yet Phase 15 shipped as PR #89 and
  CLAUDE.md cites the doc as the governing statute for verdicts ("its
  sibling statute"). docs/MORAL_LENS_JURISDICTION_DESIGN.md: "design
  draft (2026-06-24), amended 2026-07-03" while CLAUDE.md says "the
  amendment governs". Compare CASE_SYNTHESIS_DESIGN.md, which correctly
  reads "shipped 2026-07-14". → Flip both status banners to
  shipped/normative with the merge date, and state which sections are
  normative versus historical — a reader cannot currently tell that a
  "draft" outranks the code.
- **Two more real gates are DevTools-only with no Options control**
  *(S)* — src/shared/metadata/feature-flags.js:187 `storeFirstPublish`
  (gated at src/shared/publish-gate.js:102 and src/reader/index.js:5514)
  and :206 `extractionAnalysisPublishing` (gated at
  src/portal/extraction-block.js:137). Neither string appears anywhere
  in src/options/options.html, which carries 32 pref- controls. →
  storeFirstPublish is a durability guarantee for the user's signatures
  — once its smoke rows pass it should default on and lose the flag
  entirely. extractionAnalysisPublishing is a genuine disclosure
  decision and needs an Options checkbox with the whole-unit disclosure
  text the flag comment already spells out.
- **Import and export are spread across four surfaces with roughly ten
  distinct verbs** *(M)* — Options ▸ Advanced: workspace-backup,
  backup-download, backup-restore, backup-merge, backup-events-bundle,
  audit-import, audit-export, local-import/local-export (identity nsec),
  restore-entity-keys. Side panel: xr-export / xr-import (entity
  registry JSON) and xr-share-case-bundle. Portal: xr-import-transcript,
  xr-import-book, xr-import-urls. Reader: xr-audit-import. → Consolidate
  the data-movement verbs into one "Your data" panel with three named
  jobs (back up everything / merge someone else's export / bring in new
  material), and keep the content-intake imports (transcript, book, URL
  list) where the work happens. Today two different exports both emit
  entities and only one carries private keys.
- **src/reader/index.js is 7,811 lines — a fifth of the hand-written
  surface code in one file** *(L)* — `find src -name '*.js' -exec wc -l
  {} +` → 88,642 total; src/reader/index.js 7,811, next largest
  src/sidepanel/index.js 2,242. The reader hosts publish, suggest,
  vision, transcribe, speakers, media, audit, lens, extraction and
  entity flows; sibling concerns already live in extracted modules
  (lens-section.js, extraction-bar.js, transcribe-flow.js,
  findings-section.js), so the pattern exists and was simply not applied
  to the rest. → Not a 1.0 blocker, but it is the file every future
  consolidation must edit. Extract the publish flow and the
  LLM-invocation flows into peer modules following the existing
  lens-section/transcribe-flow precedent, one at a time, each with its
  own tests.

**Kill candidates**

- **The dormant Phase-9a metadata publish layer: buildAnnotation /
  buildFactCheck / buildRating / buildHelpfulnessVote
  (src/shared/metadata/builders.js:201,307,366,412) plus
  buildTopicTrustEvent** — No production caller exists — only
  tests/metadata-builders.test.mjs. The code already labels them
  'dormant metadata kinds' (src/portal/corpus.js:40). They were
  scaffolded in Phase 9a so that flipping a flag in 9b would be a UI
  change; 9b never came, and the four flags that were to enable them are
  themselves dead. *(cost of keeping: Five phantom rows in the user
  guide's flag table promising publish paths that do not exist; four
  kinds the constitution has to call 'active' while being unreachable; a
  builder module and test file that must be maintained through every
  wire refactor for behavior no user can invoke.)*
- **src/shared/metadata/ranker.js and its two flags (bridgingRanking,
  transitiveTrust)** — ROADMAP.md's Phase 25.7 bullet already states
  'ranker.js stays unwired', and no import of it exists anywhere in
  src/. The v3 bridging ranker it was written for is not on the roadmap.
  *(cost of keeping: A ranking module in a project whose Network design
  (KS §8) is explicitly 'never re-ranks' reads as an unshipped
  contradiction of a stated non-goal, and invites a future agent to wire
  it.)*
- **The eight never-read feature flags
  (feature-flags.js:24,25,26,30,31,32,33,34)** — None appears at any
  isEnabled() call site. Three of them default to true, which makes them
  look like live guarantees a user could turn off; they guarantee
  nothing. *(cost of keeping: 29% of the flag registry is noise, and the
  user guide documents it as if it were real. Every future flag audit
  re-litigates the same eight.)*
- **The EPISTACK document cluster — EPISTACK_ENTRY.md,
  EPISTACK_RUNBOOK.md, EPISTACK_SPRINT_KICKOFF.md,
  EPISTACK_EGGS_CORPUS.md, EPISTACK_EGGS_WORKSHEET.md,
  EPISTACK_LHC_CORPUS.md, plus docs/epistack/ (4 more)** — ~1,622 lines
  across ten files for an FLF submission whose deadline was 2026-07-19
  and which CLAUDE.md records as already submitted.
  EPISTACK_SPRINT_KICKOFF.md is already self-marked 'SUPERSEDED
  (2026-07-08)'. None of the six top-level files is referenced from
  CLAUDE.md; four are referenced from nothing at all. *(cost of keeping:
  They ship inside the user-facing .zip (verified:
  docs/EPISTACK_ENTRY.md, 32,628 bytes, is in the built artifact), they
  are 20% of the doc corpus a new contributor must triage, and their
  casework corpora read as current methodology guidance when they were
  competition material.)*
- **docs/auditor-prototype/ — the TypeScript schema and the parallel
  prompt corpus** — schema/audit-types.ts is TypeScript in a repo
  CLAUDE.md defines as having none; prompts/ duplicates the audit
  prompts that now live authoritatively in
  src/shared/audit/module-prompts.js under the DISCIPLINES.md header
  rule. The in-extension Quick/Thorough audit buttons superseded the CLI
  workflow in Phase 14.5. *(cost of keeping: Two copies of the audit
  prompts drift silently, and the Options page (options.html:351) still
  routes users to the CLI as the primary path — actively misdirecting
  the 1.0 audience toward a developer tool.)*
- **Source maps and non-shipping trees in the release artifact** — 18.4
  MB of the 30.9 MB uncompressed dist/ is 10 .map files; tests/ (201
  entries), docs/ (83), most of src/ (259), esbuild.config.mjs,
  package-lock.json and CLAUDE.md are all in the built zip because
  webExt.ignoreFiles lists only 'companion'. *(cost of keeping: An 11.9
  MB download for a user who needs perhaps 2 MB, and every store
  reviewer and end user receives the project's constitution, journal,
  agent instructions and competition entries as product files.)*
- **Superseded kickoff briefs kept alongside their design docs:
  PHASE_15_KICKOFF.md, PORTAL_KICKOFF.md, EPISTEMIC_AUDIT_KICKOFF.md,
  CASE_WORKSPACE_KICKOFF.md (1,206 lines),
  CASE_BOUND_WORKSPACES_KICKOFF.md** — Each is a handoff prompt for a
  coding session that has since shipped, and each has a corresponding
  design doc that is the durable artifact. PHASE_15_KICKOFF.md carries
  its own post-implementation amendment noting what actually shipped
  differed. None of the five is referenced from CLAUDE.md. *(cost of
  keeping: A reader looking for how a subsystem works finds two
  documents of different vintages and no marker saying which one the
  code follows; kickoffs describe intentions, design docs describe the
  contract.)*
- **The collaboration bundle as a first-class, unqualified sharing path
  (src/sidepanel/index.html:352, index.js:945-961)** — It downloads
  entity PRIVATE KEYS as an ordinary JSON file, presented in the UI as
  one of two peer options under 'Export case'. The Network incorporation
  model achieves cross-researcher claim aggregation without any key
  transfer. *(cost of keeping: Not a delete — key continuity for a
  shared entity is a real need. But keeping it presented as a normal
  export means the 1.0 audience's most likely group-onboarding action is
  emailing each other nsec-grade material, and the guide (§9.6) frames
  it as simply the second of two exports.)*

**Doc gaps**

- docs/THREAT_MODEL.md does not exist, though
  .claude/skills/security-threat-modeler/SKILL.md:65 makes it Standard 1
  and :72 gates every network-destination PR on touching it — a gate
  that has therefore never fired.
- docs/USER_GUIDE.md is absent from CLAUDE.md's "Project docs (read
  these for non-trivial work)" list, so no authoring agent is told to
  update it. This is the mechanical cause of the flag table missing
  aiVision, localTranscription, transcriptClaimDrafts, storeFirstPublish
  and extractionAnalysisPublishing.
- The USER_GUIDE:174-197 flag table is wrong in both directions: five
  real flags absent, three (factchecks/ratings/helpfulnessVoting at
  :180-182) documented as publish gates when no isEnabled() call reads
  them; and no column distinguishes Settings-surfaced flags from
  DevTools-only ones (reviewCoordination, storeFirstPublish,
  extractionAnalysisPublishing).
- There is no index or map for the 48-file, ~29,000-line docs/ corpus —
  no docs/README.md classifying normative vs design vs kickoff vs
  superseded. 18 files are unreferenced from CLAUDE.md and 8 from
  CLAUDE.md, ROADMAP and README alike.
- No single document answers "how does a group work on a case together?"
  The answer is spread across TEAM_CASE_DESIGN.md (four stacked
  amendments), KNOWLEDGE_SHARING_DESIGN.md (owns the engine per its §5),
  NETWORK_CLIENT_DESIGN.md (owns the surface) and CASE_DOSSIER_DESIGN.md
  (TC.3 renders into it) — and the last is an orphan referenced by
  neither CLAUDE.md, ROADMAP nor README.
- docs/SMOKE_TEST.md:4/25/26 claims Phases 0–16, 7 bundles and 1277
  tests against a Phase-29 tree with 10 esbuild entry points and ~2,513
  tests — the same class of stale-marker defect the 2026-08-02 JOURNAL
  entry ("The Phase 16/19 walks were done; only the docs said
  otherwise") identified as costly through propagation.
- CLAUDE.md's ROADMAP paragraph stops at Phase 28 and never mentions
  Phase 29, docs/EVENT_STORE_DESIGN.md, the storeFirstPublish flag, or
  docs/OPINION_MODULES_KICKOFF.md (self-marked SHIPPED 2026-08-02).
- There is no getting-started document written for a non-technical
  researcher. README.md "Option A — the packaged .zip (no toolchain)" is
  the closest, but it sits inside a developer README whose surrounding
  sections cover esbuild, permissions and layout; nothing walks a
  first-time user from install through identity to first capture.
- The product has no in-app documentation affordance at all — no Help
  link, no glossary tooltip, no link to USER_GUIDE from any of the five
  surfaces. The 1,234-line guide with its §11 glossary is reachable only
  by someone who already knows the GitHub repo exists.
- docs/TRUTH_ADJUDICATION_DESIGN.md and
  docs/MORAL_LENS_JURISDICTION_DESIGN.md are labeled "design draft"
  while CLAUDE.md treats both as governing statutes for shipped
  behavior; nothing in either file tells a reader that it outranks the
  code it appears to merely propose.

**Machine-enforceable candidates**

- Guard: every key in FLAGS_DEFAULTS appears at ≥1 `isEnabled('<key>')`
  call site under src/ — fails today on annotations, respondsTo,
  topicTrust, factchecks, ratings, helpfulnessVoting, bridgingRanking,
  transitiveTrust.
- Guard: every FLAGS_DEFAULTS key either has a matching control id in
  src/options/options.html or is listed in an explicit DEVTOOLS_ONLY
  allowlist carrying a one-line reason — fails today on
  reviewCoordination, storeFirstPublish, extractionAnalysisPublishing.
- Guard (reciprocal to tests/constitution-guards.test.mjs:201, which
  only checks retired/free/reserved kinds are unemitted): every kind
  marked `active` in the Art. 10 schedule is reachable from a non-test
  caller — fails today on 30050, 30051, 30052, 30053, 9803.
- Guard: the flag rows in docs/USER_GUIDE.md §2.5 are exactly the keys
  of FLAGS_DEFAULTS, with matching defaults — fails today with five
  omissions and three phantom rows.
- Guard: no <input> in any surface HTML whose id or name matches
  /token|key|secret|passphrase|nsec/ carries type="text" (or omits
  autocomplete="off") — fails today on src/options/options.html:624.
- Guard: run web-ext build in CI and assert the artifact contains no
  tests/, no docs/, no *.map and no CLAUDE.md, and is under a stated
  size ceiling — fails today at 11.9 MB with all four present.


// MA.6 browser walk — an automated smoke of the extraction-review and
// kind-30070 publish surfaces (docs/MAP_ARTIFACT_KICKOFF.md §MA.6).
//
//   node tools/smoke/ma6-walk.mjs
//
// Loads the UNPACKED EXTENSION in a real Chromium (--headless=new
// supports extensions; the headless_shell build does not) and drives the
// case dashboard. State is seeded THROUGH THE EXTENSION'S OWN MODULES —
// bundled by esbuild into dist/ first, because importing `src/` straight
// into a page fails on bare npm specifiers (`@mozilla/readability`). No
// storage shape is hand-written, so the walk cannot drift from the code.
//
// SAFETY, load-bearing: `preferences.default_relays` is pinned to an
// unreachable loopback port BEFORE anything is clickable, so no publish
// attempt can reach a public relay. The signing identity is generated
// per-run into a throwaway browser profile. The happy-path event is
// BUILT in-page and inspected rather than sent. Do not point this at a
// real relay — a kind 30070 is permanent once accepted.
//
// Every element the walk drives is found by a `data-xr` anchor from the
// shared SMOKE_ANCHORS table, never by its copy; copy is only ASSERTED,
// where the walk checks what a user reads (the batch button's N, the
// confirm's disclosure, the failure status). Every wait is a CONDITION on
// the exact state the next step reads, with a bound: a wait that runs out
// names what never happened and stops the walk there — every later step
// reads that state, so running on would only add findings that point at
// the wrong step. No fixed sleep remains (JOURNAL 2026-09-25).
//
// Browser, Playwright, the seed bundle, the profile and the output dir
// all come from lib/browser.mjs (XR_CHROME / XR_PW / XR_SMOKE_OUT
// override them). Run it through `npm run smoke`, or directly:
//   node tools/smoke/ma6-walk.mjs
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    assertBuilt, ensureOut, launchExtension, loadPlaywright, resolveChrome, seedBundle
} from './lib/browser.mjs';
import { READY_KEY, SMOKE_ANCHORS } from '../../src/shared/smoke-anchors.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = ensureOut();
await assertBuilt();
const pw = await loadPlaywright();
const CHROME = resolveChrome(pw);

// The seed harness, bundled into dist/ so the portal page can load it
// as a same-origin script (removed on exit — see lib/browser.mjs).
const seed_ = seedBundle(join(HERE, 'seed-entry.js'), '_smoke-seed.bundle.js');

// Selectors, one per anchor, spelled so tests/smoke-selectors.test.mjs
// can resolve each against the table and against src/.
const SEL = {
    casesTab:      `[data-xr="${SMOKE_ANCHORS.casesTab}"]`,
    dashboard:     `[data-xr="${SMOKE_ANCHORS.caseDashboard}"]`,
    block:         `[data-xr="${SMOKE_ANCHORS.extractionBlock}"]`,
    member:        `[data-xr="${SMOKE_ANCHORS.extractionMember}"]`,
    covered:       `[data-xr="${SMOKE_ANCHORS.extractionCovered}"]`,
    accept:        `[data-xr="${SMOKE_ANCHORS.extractionAccept}"]`,
    dismiss:       `[data-xr="${SMOKE_ANCHORS.extractionDismiss}"]`,
    publish:       `[data-xr="${SMOKE_ANCHORS.extractionPublish}"]`,
    publishStatus: `[data-xr="${SMOKE_ANCHORS.extractionPublishStatus}"]`,
    publishAll:    `[data-xr="${SMOKE_ANCHORS.extractionPublishAll}"]`
};

// Bounds for the condition waits: each far above its measured time on
// the passing path (JOURNAL 2026-09-25) so a slow runner does not trip
// it, and far below the runner's 180 s scenario timeout so a broken seam
// fails in seconds under its own name rather than by the runner's kill.
const BOUND = { ready: 30000, harness: 10000, ui: 15000, block: 20000, store: 10000, dialog: 10000, publish: 30000 };
const POLL_MS = 50;   // storage-read poll interval (see untilStored)

const findings = [];
const waits = [];     // [label, ms] — every condition wait that held, reported at the end
const note = (s) => console.log(s);
const fail = (s) => { findings.push(s); console.log('  ✗ ' + s); };
const ok = (s) => console.log('  ✓ ' + s);

const { ctx, extId, close } = await launchExtension({ pw, chrome: CHROME });
note(`extension ${extId}`);

const PORTAL = `chrome-extension://${extId}/src/portal/index.html`;
const SEED_JS = `chrome-extension://${extId}/${seed_.urlPath}`;

const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });

let blockText = null;
let blockTracked = false;   // once true, a failing walk also says whether the block was re-rendered (finish())

/**
 * A bound for a Playwright call that takes no timeout of its own
 * (addScriptTag waits on the script's load event, unbounded). A late
 * settle of `p` is still handled — Promise.race subscribes to it.
 */
function bounded(p, ms) {
    let timer;
    const expiry = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`bound ${ms} ms`)), ms);
    });
    return Promise.race([p, expiry]).finally(() => clearTimeout(timer));
}

/**
 * One bounded condition wait (or bounded read). `until` resolves when the
 * condition holds — its value is returned — and rejects when its bound
 * runs out. On rejection the walk records `never` — what never happened,
 * in words — and stops (finish()).
 */
async function waitFor(label, never, until, { onFail = null } = {}) {
    const t0 = Date.now();
    let value;
    try {
        value = await until();
    } catch (e) {
        const why = String((e && e.message) || e).split('\n')[0].slice(0, 160);
        fail(`${never} (gave up after ${Date.now() - t0} ms: ${why})`);
        if (onFail) await onFail().catch(() => { /* diagnostics only */ });
        await finish();
    }
    waits.push([label, Date.now() - t0]);
    return value;
}

/**
 * page.waitForFunction cannot wait on IndexedDB / ClaimModel state: it
 * does not await an async predicate (a pending Promise is truthy). So a
 * STORED-state condition polls a page read from here, until `probe`
 * returns {ok: true} or the bound runs out; the rejection carries the
 * last value read, so the failure says what the store held instead.
 */
async function untilStored(probe, bound) {
    const deadline = Date.now() + bound;
    for (;;) {
        const r = await probe();
        if (r.ok) return r;
        if (Date.now() >= deadline) throw new Error(`bound ${bound} ms; last read ${JSON.stringify(r.value)}`);
        await new Promise((res) => setTimeout(res, POLL_MS));
    }
}

/** The portal's ready stamp: its init ran to the end (src/shared/smoke-anchors.js). */
const portalReady = (label) => waitFor(label, `the portal never stamped ready (<html data-xr-ready="portal">) after ${label}`,
    () => page.waitForFunction((key) => document.documentElement.dataset[key] === 'portal', READY_KEY, { timeout: BOUND.ready }));

async function harness() {
    await waitFor('seed script', 'the seed harness script never loaded into the page',
        () => bounded(page.addScriptTag({ url: SEED_JS }), BOUND.harness));
    await waitFor('seed harness', 'the seed harness never signalled window.__xrReady',
        () => page.waitForFunction(() => window.__xrReady === true, null, { timeout: BOUND.harness }));
}

/** Two animation frames: whatever the last DOM change was has been laid out and painted. */
async function twoFrames(label) {
    await page.evaluate(() => {
        window.__xrWalkFrames = 0;
        requestAnimationFrame(() => requestAnimationFrame(() => { window.__xrWalkFrames = 2; }));
    });
    await waitFor(label, 'two animation frames never ran',
        () => page.waitForFunction(() => window.__xrWalkFrames === 2, null, { timeout: BOUND.ui }));
}

/** A click is bounded too: an element that never becomes clickable is named, not a stack trace. */
const click = (label, what, target) => waitFor(label, `${what} could not be clicked`,
    () => target.click({ timeout: BOUND.ui }));

let finished = false;
async function finish() {
    if (finished) return;
    finished = true;
    writeFileSync(join(OUT, 'ma6-block.txt'), blockText || '(absent)');
    writeFileSync(join(OUT, 'ma6-pageerrors.txt'), pageErrors.join('\n') || '(none)');
    note('\n[8] page errors across the whole walk');
    note(pageErrors.length ? pageErrors.slice(0, 12).map((e) => '  ! ' + e.split('\n')[0]).join('\n') : '  (none)');
    // Every uncaught exception fails the walk. So does every console.error
    // the product itself emitted (Utils.error's `[X-Ray` prefix) except the
    // one step [7] provokes on purpose — the publish against the dead relay.
    const EXPECTED_CONSOLE = [/extraction analysis publish failed[\s\S]*no relay accepted it/];
    const uncaught = pageErrors.filter((e) => e.startsWith('pageerror:'));
    const product = pageErrors.filter((e) => e.startsWith('console: [X-Ray') && !EXPECTED_CONSOLE.some((re) => re.test(e)));
    if (uncaught.length) fail(`${uncaught.length} uncaught exception(s) during the walk — ${uncaught[0].split('\n')[0]}`);
    else ok('no uncaught exception anywhere in the walk');
    if (product.length) fail(`${product.length} product console.error(s) beyond the provoked publish failure — ${product[0].split('\n')[0].slice(0, 160)}`);
    else ok('no product console.error beyond the provoked publish failure');

    // The re-render tripwire. A portal background render that lands after
    // the case view opened replaces the block the walk is driving with a
    // fresh one whose sections are closed and unpainted, so every later
    // check fails against it and blames the product (JOURNAL 2026-09-25).
    // It lives HERE, not in waitFor(), because the instant checks (the
    // covered section, the Accept / Dismiss / publish counts) fail without
    // a wait, and a finding from either kind reaches finish().
    if (blockTracked && findings.length) {
        const attached = await bounded(
            page.evaluate(() => !!(window.__xrWalkBlock && window.__xrWalkBlock.isConnected)), BOUND.ui
        ).catch(() => null);   // a closed or crashed page: say nothing rather than guess
        if (attached === false) {
            note('\n[9] re-render tripwire: the extraction block the walk tracked is no longer in the DOM');
            fail('the extraction block the walk was driving left the DOM — the case view re-rendered under the walk '
                + '(a portal background render; JOURNAL 2026-09-25), so the findings above may be downstream of it');
        }
    }

    note('\ncondition waits (ms): ' + waits.map(([l, ms]) => `${l} ${ms}`).join(' · '));
    note(findings.length ? `\nFINDINGS (${findings.length}):\n` + findings.map((f) => ' - ' + f).join('\n')
                         : '\nNO FINDINGS — every check passed');
    await close();
    process.exit(findings.length ? 1 : 0);
}

await waitFor('first goto', `the portal page ${PORTAL} never loaded`,
    () => page.goto(PORTAL, { waitUntil: 'domcontentloaded', timeout: BOUND.ready }));
await portalReady('the first load');
await harness();

// ---------------------------------------------------------------- seed
note('\n[1] seeding through the extension’s own modules');
const seed = await page.evaluate(async () => {
    const X = window.__xr;
    const log = [];

    // Dead loopback relay — a publish attempt must not reach the network.
    const prefs = (await X.Storage.preferences.get()) || {};
    await X.Storage.preferences.set({ ...prefs, default_relays: ['ws://127.0.0.1:1'] });
    await new Promise((res) => chrome.storage.local.set(
        { 'xray:flags': { extractionAnalysisPublishing: true } }, res));

    // A throwaway signing identity, so the publish path reaches the
    // TRANSPORT rather than stopping at "no identity". The key never
    // signs anything that leaves this container (dead loopback relay).
    const ident = await X.Storage.primaryIdentity.generate();
    await X.Storage.preferences.set({ ...(await X.Storage.preferences.get() || {}),
        default_relays: ['ws://127.0.0.1:1'], signing_method: 'local' });
    log.push(`throwaway signing identity npub ${String(ident.npub).slice(0, 16)}…`);
    const pinned = ((await X.Storage.preferences.get()) || {}).default_relays;
    if (JSON.stringify(pinned) !== JSON.stringify(['ws://127.0.0.1:1'])) {
        return { error: `the relay pin did not take: default_relays is ${JSON.stringify(pinned)}`, log };
    }
    log.push('default_relays pinned to ws://127.0.0.1:1 (verified by read-back)');

    const kase = await X.EntityModel.create({ type: 'case', name: 'SMOKE — COVID origins' });
    log.push(`case ${kase.id}`);

    const bodies = [
        { url: 'https://smoke.test/lab-leak',
          title: 'The furin cleavage site question',
          md: 'Researchers noted the furin cleavage site is absent in the closest known relatives.\n\n'
            + 'A 2020 preprint argued the insertion is unlikely to arise by natural recombination.\n\n'
            + 'The Nature Medicine correspondence disputed that reading directly.\n' },
        { url: 'https://smoke.test/market',
          title: 'Early cases cluster at the market',
          md: 'Case mapping placed the earliest ascertained infections around Huanan market.\n\n'
            + 'Two of the earliest sequenced lineages were both present in December 2019.\n' }
    ];
    for (const b of bodies) {
        await X.saveArticle({ article: {
            url: b.url, title: b.title, markdown: b.md, content: b.md,
            author: 'Smoke Author', date: '2020-04-01',
            entities: [{ entity_id: kase.id, name: kase.name, type: 'case' }]
        } });
    }
    const byUrl = {};
    for (const r of await X.listArticles()) byUrl[r.url] = r;
    const members = bodies.map((b) => ({ ...b, rec: byUrl[b.url] || null }));
    for (const m of members) {
        log.push(`article ${m.url} hash=${m.rec && m.rec.articleHash ? m.rec.articleHash.slice(0, 12) + '…' : 'NONE'}`);
    }
    if (members.some((m) => !m.rec || !m.rec.articleHash)) {
        return { error: 'archive row missing a content hash', log };
    }

    const covered = await X.ClaimModel.create({
        text: 'The furin cleavage site is absent in the closest known relatives.',
        quote: 'the furin cleavage site is absent in the closest known relatives',
        source_url: bodies[0].url, article_hash: members[0].rec.articleHash,
        about: [kase.id], suggested_by: 'llm:smoke'
    });
    log.push(`pre-existing claim ${covered.id}`);

    const extracts = [
        { position: { summary: 'Argues the insertion is hard to explain naturally.', side_label: 'lab-origin-plausible' },
          key_assertions: [
            { quote: 'the furin cleavage site is absent in the closest known relatives',
              claim_ref: null, why_load_bearing: 'This is the premise the whole argument rests on.' },
            { quote: 'the insertion is unlikely to arise by natural recombination',
              claim_ref: null, why_load_bearing: 'The inferential step from anomaly to origin.' },
            { quote: 'THIS QUOTE IS NOT IN THE ARTICLE AT ALL',
              claim_ref: null, why_load_bearing: 'Should be dropped as ungroundable.' }
          ],
          source_references: [
            { quote: 'The Nature Medicine correspondence disputed that reading', target_hint: 'Nature Medicine correspondence' }
          ],
          open_questions: ['Which relatives were sequenced by 2020?'] },
        { position: { summary: 'Places the earliest cases at the market.', side_label: 'zoonotic-plausible' },
          key_assertions: [
            { quote: 'the earliest ascertained infections around Huanan market',
              claim_ref: null, why_load_bearing: 'The spatial claim the argument turns on.' },
            { quote: 'Two of the earliest sequenced lineages were both present in December 2019',
              claim_ref: null, why_load_bearing: 'The two-lineage argument.' }
          ],
          source_references: [], open_questions: ['How was ascertainment corrected?'] }
    ];
    const results = [];
    for (let i = 0; i < members.length; i++) {
        const m = members[i];
        const body = X.EventBuilder.assembleArticleBody(m.rec.article) || '';
        const res = await X.recordArticleExtraction({
            member: { article_hash: m.rec.articleHash, url: m.url, title: m.title, text: body },
            extract: extracts[i], model: 'claude-smoke', key: `smokekey-${i}`
        });
        results.push(res);
        log.push(`fold ${i}: ${JSON.stringify(res)}`);
    }
    // The case dashboard is reached from a library row, and the library
    // renders from the RELAY cache. Mint the case's real kind-0 with the
    // real builder + signer and seed it as a cached relay record, which
    // is exactly the state a user is in after publishing the case entity.
    const full = await X.EntityModel.get(kase.id);
    const unsigned = X.EventBuilder.buildProfileEvent(full, null, 'Smoke case', []);
    const signed = await X.Crypto.signEvent(unsigned, full.keypair.privateKey || full.keypair.privkey);
    await X.saveRecords([{ event: signed, relays: ['ws://127.0.0.1:1'] }]);
    log.push(`case kind-0 cached, pubkey ${String(signed.pubkey).slice(0, 12)}…`);

    return { caseId: kase.id, casePubkey: signed.pubkey, log, results,
             hashes: members.map((m) => m.rec.articleHash) };
});
for (const l of seed.log || []) note('  ' + l);
if (seed.error) {
    // Nothing past this point may run unpinned: stop here.
    fail(`seed failed: ${seed.error}`);
    await close();
    process.exit(1);
}
else {
    if (seed.results.some((r) => r.status === 'failed')) fail(`a fold failed: ${JSON.stringify(seed.results)}`);
    else ok(`both folds saved (${seed.results.map((r) => r.added).join(' + ')} atoms added)`);
    if ((seed.results[0].droppedUngrounded || 0) !== 1) {
        fail(`member 0 should have dropped exactly 1 ungroundable quote, got ${seed.results[0].droppedUngrounded}`);
    } else ok('the ungroundable quote was dropped, not stored');
}
const N = seed.hashes.length;   // one extraction record, one member section, one publish button per article

// -------------------------------------------------------------- render
note('\n[2] rendering the case dashboard');
await waitFor('reload goto', `the portal page ${PORTAL} never reloaded`,
    () => page.goto(PORTAL, { waitUntil: 'domcontentloaded', timeout: BOUND.ready }));
// The ready stamp follows the portal's first boot, which awaits the
// reconciliation read AFTER launching the library's background
// enrichments — each of which re-renders the current view when it lands.
// Measured: every one landed 9–33 ms BEFORE the stamp (JOURNAL
// 2026-09-25), so a case view opened after the stamp is not re-rendered
// under the walk; if that ever changes, the report of any failing walk
// says so (the re-render tripwire in finish()).
await portalReady('the reload');
await harness();   // window.__xr does not survive a navigation
await page.evaluate((h) => { window.__xrHashes = h; }, seed.hashes);
// The library paints from the relay cache; the case row lives under the
// Cases tab, and the dashboard is opened by the row's own button.
await waitFor('cases tab', `the library never painted its Cases tab ${SEL.casesTab}`,
    () => page.locator(SEL.casesTab).waitFor({ state: 'visible', timeout: BOUND.ui }));
await click('cases click', `the Cases tab ${SEL.casesTab}`, page.locator(SEL.casesTab));
await waitFor('dashboard button', `the case row never showed its dashboard button ${SEL.dashboard} — the case kind-0 is not in the relay cache, or the row lost its anchor`,
    () => page.locator(SEL.dashboard).first().waitFor({ state: 'visible', timeout: BOUND.ui }));
await click('dashboard click', `the case dashboard button ${SEL.dashboard}`, page.locator(SEL.dashboard).first());

// The block is found by its data-xr anchor, never by heading copy — the
// heading was renamed once (UA.3, 2026-08-12) and this walk went stale
// for weeks. It is rendered once it holds one member section per seeded
// record (its body fills asynchronously after the block is attached).
await waitFor('block', `the extraction block ${SEL.block} never rendered its ${N} member sections ${SEL.member} on the case dashboard`,
    () => page.waitForFunction(({ block, member, n }) => {
        const box = document.querySelector(block);
        return !!box && box.querySelectorAll(member).length === n;
    }, { block: SEL.block, member: SEL.member, n: N }, { timeout: BOUND.block }),
    { onFail: async () => {
        await page.screenshot({ path: join(OUT, 'ma6-01-case.png'), fullPage: true });
        const diag = await page.evaluate(async () => {
            const X = window.__xr;
            const out = { headings: [...document.querySelectorAll('h2,h3')].map((e) => e.textContent.trim()).slice(0, 40) };
            out.recs = [];
            for (const h of (window.__xrHashes || [])) {
                const r = await X.getArticleExtraction(h);
                out.recs.push(r ? { h: h.slice(0, 10), a: (r.assertions || []).length,
                                    s: (r.sources || []).length, q: (r.open_questions || []).length } : { h: h.slice(0, 10), missing: true });
            }
            out.bodyText = document.body.innerText.slice(0, 1200);
            return out;
        });
        note('  headings: ' + JSON.stringify(diag.headings));
        note('  records: ' + JSON.stringify(diag.recs));
        note('  --- case view text ---');
        note(diag.bodyText.split('\n').slice(0, 40).map((l) => '  | ' + l).join('\n'));
    } });
// Track the block and read it in ONE evaluate: case-view.js attaches the
// block after two awaits, so a background re-render can leave a window in
// which it is absent — that must reach finish() (and its tripwire) as a
// named finding, never an uncaught TypeError with no report.
blockText = await page.evaluate((sel) => {
    const b = document.querySelector(sel);
    window.__xrWalkBlock = b;
    return b ? b.innerText : null;
}, SEL.block);
blockTracked = true;
if (blockText === null) {
    fail(`the extraction block ${SEL.block} left the DOM right after it rendered`);
    await finish();
}
await page.screenshot({ path: join(OUT, 'ma6-01-case.png'), fullPage: true });
ok('extraction block rendered');
note(blockText.split('\n').slice(0, 10).map((l) => '  | ' + l).join('\n'));

// A member section paints its body (the Accept / Dismiss / publish
// controls) on its first `toggle`, which fires asynchronously after
// `open` is set — so the condition is the painted controls, not `open`.
await page.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = true; });
await waitFor('sections painted', `the ${N} opened member sections never painted a per-article publish button ${SEL.publish} each (flag ON)`,
    () => page.waitForFunction(({ publish, n }) => document.querySelectorAll(publish).length === n,
        { publish: SEL.publish, n: N }, { timeout: BOUND.ui }));
await twoFrames('expanded frames');
// Attached is not shown: innerText of a hidden node falls back to its
// textContent, so the block must also be VISIBLE once every fold is open.
if (!(await page.locator(SEL.block).first().isVisible())) {
    fail(await page.locator(SEL.block).count()
        ? 'the extraction block is in the DOM but not visible with every section open'
        : `the extraction block ${SEL.block} left the DOM after its sections opened`);
}
await page.screenshot({ path: join(OUT, 'ma6-02-expanded.png'), fullPage: true });

// ------------------------------------------------- publish affordance
note('\n[3] the publish affordance');
const perArticleTexts = await page.locator(SEL.publish).allTextContents();
const batchTexts = await page.locator(SEL.publishAll).allTextContents();
note('  publish buttons: per-article ' + JSON.stringify(perArticleTexts) + ', batch ' + JSON.stringify(batchTexts));
ok(`a per-article publish button on each of the ${N} records`);
if (batchTexts.length !== 1) fail(`expected one batch publish button, got ${batchTexts.length}`);
else if (!new RegExp(`Publish all ${N} analyses`).test(batchTexts[0])) {
    fail(`the batch button does not name the exact N=${N}: ${JSON.stringify(batchTexts[0])}`);
} else ok('batch button names the exact N');

// The confirm text, captured without publishing (dialog dismissed).
const dialogs = [];
page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
const clickForDialog = async (label, sel, what) => {
    const seen = page.waitForEvent('dialog', { timeout: BOUND.dialog });
    seen.catch(() => { /* awaited through waitFor below */ });
    await click(`${label} click`, `the ${what} button ${sel}`, page.locator(sel).first());
    await waitFor(label, `the ${what} click never raised its confirm dialog`, () => seen);
};
await clickForDialog('per-article confirm', SEL.publish, 'per-article publish');
await clickForDialog('batch confirm', SEL.publishAll, 'batch publish');
note('  confirm dialogs captured: ' + dialogs.length);
for (const d of dialogs) note('  ---\n' + d.split('\n').map((l) => '  | ' + l).join('\n'));
if (dialogs.length !== 2) fail(`expected 2 confirm dialogs (per-article + batch), got ${dialogs.length}`);
if (!dialogs.some((d) => /unreviewed \/ accepted \/ dismissed/.test(d))) {
    fail('the confirm does not disclose that unreviewed rows publish');
} else ok('the confirm discloses the review states that publish');

// ------------------------------------------- the real event, unsent
note('\n[4] building the real event from the seeded record (not sent)');
const built = await page.evaluate(async (hashes) => {
    const X = window.__xr;
    const rec = await X.getArticleExtraction(hashes[0]);
    const claims = Object.values(await X.ClaimModel.getAll() || {});
    const coords = X.claimCoordIndex(claims);
    const ev = X.buildExtractionAnalysisEvent({
        record: rec, coordByClaimId: coords,
        articleTitle: rec.title || '', articleUrl: rec.url || '', createdAt: 1700
    });
    const back = X.parseExtractionAnalysisEvent({ ...ev, kind: X.EXTRACTION_ANALYSIS_KIND });
    return { ev, back, parts: X.partitionAssertions(rec), coordCount: Object.keys(coords).length };
}, seed.hashes);
writeFileSync(join(OUT, 'ma6-event.json'), JSON.stringify(built.ev, null, 2));
note('  kind=' + built.ev.kind + '  tags=' + built.ev.tags.length);
note('  tags: ' + JSON.stringify(built.ev.tags.map((t) => t[0] + '=' + String(t[1]).slice(0, 24))));
const content = JSON.parse(built.ev.content);
note('  coverage: ' + JSON.stringify(content.coverage));
note('  statuses: ' + JSON.stringify(content.assertions.map((a) => a.status)));
note('  withheld: ' + JSON.stringify(content.withheld.map((w) => w.field)));
if (content.assertions.some((a) => !a.status)) fail('an assertion published with no status');
if (JSON.stringify(built.ev).includes('COVID origins')) fail('the case frame leaked into the event');
if (content.assertions.some((a) => a.start !== undefined || a.end !== undefined)) fail('offsets leaked onto the wire');
if (!content.assertions.every((a) => a.model_note || a.model_proposed_text)) {
    note('  (some rows carry no model prose — fine)');
}
ok('event built from real seeded state; written to ma6-event.json');

// ------------------------------------------------ covered / accept / dismiss
note('\n[5] the review paths: covered split, Accept, Dismiss');
page.removeAllListeners('dialog');
page.on('dialog', (d) => d.dismiss());   // never confirm a publish from here

// A pre-existing claim covers one span; that atom must fold OUT of the
// open queue into the covered section, not sit there as an open proposal.
const coveredSection = await page.locator(`${SEL.covered} > summary`).allTextContents();
if (!coveredSection.length) fail(`the "already covered by existing claims" section ${SEL.covered} did not render`);
else ok('covered atoms fold out of the open queue: ' + JSON.stringify(coveredSection.map((t) => t.trim())));

// Accept the first open atom → mints a real claim through ClaimModel.
const claimCount = () => page.evaluate(async () =>
    Object.keys(await window.__xr.ClaimModel.getAll() || {}).length);
const beforeClaims = await claimCount();
const acceptBtn = page.locator(SEL.accept).first();
if (!(await acceptBtn.count())) {
    fail(`no Accept button ${SEL.accept} in the open queue`);
    await finish();
}
// Diagnostic only: the claim-text box is the Accept button's sibling in its row.
const prefill = await waitFor('accept row read', `the first Accept button ${SEL.accept} could not be read (its row's claim-text box)`,
    () => acceptBtn.evaluate((b) => {
        const box = b.parentElement && b.parentElement.querySelector('input[type="text"]');
        return box ? box.value : null;
    }, null, { timeout: BOUND.ui }));
note('  claim-text box prefilled with: ' + JSON.stringify(String(prefill).slice(0, 70)));
const acceptHandle = await waitFor('accept handle', `the first Accept button ${SEL.accept} could not be held as an element`,
    () => acceptBtn.elementHandle({ timeout: BOUND.ui }));
await click('accept click', `the first Accept button ${SEL.accept}`, acceptHandle);
await waitFor('claim minted', `Accept never minted a claim through ClaimModel (expected ${beforeClaims} → ${beforeClaims + 1})`,
    () => untilStored(async () => { const n = await claimCount(); return { ok: n === beforeClaims + 1, value: n }; }, BOUND.store));
ok(`Accept minted a claim (${beforeClaims} → ${beforeClaims + 1})`);
// Accept replaces its row with a ✓ line AFTER the triage write lands, so
// the clicked button leaving the DOM is the triage settled — and the next
// Dismiss cannot land on the accepted row's own Dismiss button.
await waitFor('accept settled', 'the accepted row never settled (its Accept button was still in the DOM)',
    () => page.waitForFunction((b) => !b.isConnected, acceptHandle, { timeout: BOUND.store }));

const triaged = await page.evaluate(async (hashes) => {
    const X = window.__xr;
    const out = [];
    for (const h of hashes) {
        const r = await X.getArticleExtraction(h);
        const p = X.partitionAssertions(r);
        out.push({ h: h.slice(0, 8), open: p.open.length, accepted: p.accepted.length,
                   dismissed: p.dismissed.length,
                   claimIds: p.accepted.map((a) => a.accepted_claim_id).filter(Boolean) });
    }
    return out;
}, seed.hashes);
note('  triage now: ' + JSON.stringify(triaged));
if (!triaged.some((t) => t.accepted === 1 && t.claimIds.length === 1)) {
    fail('the accepted atom did not record its minted claim id on the record');
} else ok('the accepted atom carries accepted_claim_id (durable, survives re-runs)');

// Dismiss an atom and confirm the dismissal reached the RECORD.
const dismissedCount = () => page.evaluate(async (hashes) => {
    const X = window.__xr;
    let dismissed = 0;
    for (const h of hashes) dismissed += X.partitionAssertions(await X.getArticleExtraction(h)).dismissed.length;
    return dismissed;
}, seed.hashes);
const dismissBtn = page.locator(SEL.dismiss).first();
if (!(await dismissBtn.count())) {
    fail(`no Dismiss button ${SEL.dismiss} in the open queue`);
    await finish();
}
// Relative to the count before the click, so the wait cannot be met by
// a dismissal the walk did not make; nothing was dismissed yet, so 0.
const beforeDismissed = await dismissedCount();
if (beforeDismissed !== 0) fail(`the records already held ${beforeDismissed} dismissed atom(s) before the walk dismissed any (expected 0)`);
await click('dismiss click', `the first Dismiss button ${SEL.dismiss}`, dismissBtn);
await waitFor('dismiss stored', `Dismiss never reached the record (expected ${beforeDismissed} → ${beforeDismissed + 1} dismissed atoms)`,
    () => untilStored(async () => { const n = await dismissedCount(); return { ok: n === beforeDismissed + 1, value: n }; }, BOUND.store));
ok(`Dismiss is remembered on the record, not just in the DOM (${beforeDismissed} → ${beforeDismissed + 1})`);

// ------------------------------------- the event AFTER human review
note('\n[6] the same event after review — the marking must now differ');
const built2 = await page.evaluate(async (hashes) => {
    const X = window.__xr;
    const claims = Object.values(await X.ClaimModel.getAll() || {});
    const coords = X.claimCoordIndex(claims);
    const out = [];
    for (const h of hashes) {
        const rec = await X.getArticleExtraction(h);
        try {
            const ev = X.buildExtractionAnalysisEvent({
                record: rec, coordByClaimId: coords,
                articleTitle: rec.title || '', articleUrl: rec.url || '', createdAt: 1700
            });
            out.push({ h: h.slice(0, 8), tags: ev.tags.filter((t) => ['unreviewed', 'endorsed', 'dismissed'].includes(t[0])),
                       content: JSON.parse(ev.content) });
        } catch (e) { out.push({ h: h.slice(0, 8), error: e.message }); }
    }
    return { out, coordCount: Object.keys(coords).length };
}, seed.hashes);
note('  published claim coordinates available: ' + built2.coordCount + ' (0 is correct — nothing was published)');
for (const r of built2.out) {
    if (r.error) { fail(`event build failed for ${r.h}: ${r.error}`); continue; }
    const st = r.content.assertions.map((a) => a.status + (a.endorsement ? `/${a.endorsement}` : ''));
    note(`  ${r.h}: face=${JSON.stringify(r.tags.map((t) => t[0] + '=' + t[1]))} rows=${JSON.stringify(st)}`);
    for (const a of r.content.assertions) {
        if (a.status === 'accepted') {
            if (a.claim) fail('an accepted atom points at a claim coordinate that was never published');
            if (a.endorsement !== 'local-only') fail('accepted-but-unpublished must read endorsement=local-only');
        }
        if (a.status !== 'accepted' && ('why' in a)) fail(`a ${a.status} row carries a human why`);
    }
}
const reviewed = built2.out.find((r) => r.content && r.content.coverage.accepted === 1);
if (!reviewed) fail('no event reflects the accepted atom');
else ok('the accepted atom publishes as endorsement=local-only with no fabricated coordinate');
const dismissedEv = built2.out.find((r) => r.content && r.content.coverage.dismissed === 1);
if (!dismissedEv) fail('no event reflects the dismissed atom');
else ok('the dismissed atom still publishes, marked dismissed (the denominator survives)');

// --------------------------------- publish click against a dead relay
note('\n[7] publish click with an unreachable relay (no public relay is touched)');
page.removeAllListeners('dialog');
page.on('dialog', (d) => d.accept());   // accept the confirm; the relay is ws://127.0.0.1:1
const pub = page.locator(SEL.publish).first();
if (!(await pub.count())) fail(`the per-article publish button ${SEL.publish} vanished after review`);
else {
    // The button and its status line share a row; both are the FIRST of
    // their anchor (the first member section). The click disables the
    // button until the attempt ends, so "enabled again with a status that
    // changed" is the outcome landing — whichever outcome it is.
    const status = page.locator(SEL.publishStatus).first();
    await waitFor('publish status', `the per-article publish row has no status line ${SEL.publishStatus}`,
        () => status.waitFor({ state: 'attached', timeout: BOUND.ui }));
    const before = (await waitFor('status before', `the per-article publish status line ${SEL.publishStatus} could not be read before the click`,
        () => status.textContent({ timeout: BOUND.ui })) || '').trim();
    await click('publish click', `the per-article publish button ${SEL.publish}`, pub);
    await waitFor('publish outcome', `the per-article publish never reported an outcome on its status line ${SEL.publishStatus}`,
        () => page.waitForFunction(({ publish, publishStatus, prev }) => {
            const b = document.querySelector(publish);
            const s = document.querySelector(publishStatus);
            return !!b && !!s && !b.disabled && s.textContent.trim() !== prev;
        }, { publish: SEL.publish, publishStatus: SEL.publishStatus, prev: before }, { timeout: BOUND.publish }));
    const text = (await waitFor('status after', `the per-article publish status line ${SEL.publishStatus} could not be read after the outcome`,
        () => status.textContent({ timeout: BOUND.ui })) || '').trim();
    note('  status text: ' + JSON.stringify(text));
    if (/No local identity/i.test(text)) {
        fail('the publish path stopped at the identity check — the transport was never exercised');
    }
    if (!/Publish failed|No relays|not accept/i.test(text)) {
        fail(`a failed publish did not report a clear failure; status was ${JSON.stringify(text)}`);
    } else ok('a failed publish reports it plainly instead of throwing or silently succeeding');
    const stamped = await page.evaluate(async (h) => {
        const r = await window.__xr.getArticleExtraction(h);
        return { published_at: r.published_at || null, ev: r.published_event_id || null };
    }, seed.hashes[0]);
    if (stamped.published_at) fail('a FAILED publish stamped the record as published');
    else ok('a failed publish leaves no publish stamp on the record');
}
await page.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = true; });
await waitFor('all open', 'not every <details> stayed open for the final screenshot',
    () => page.waitForFunction(() => [...document.querySelectorAll('details')].every((d) => d.open), null, { timeout: BOUND.ui }));
await twoFrames('final frames');
await page.screenshot({ path: join(OUT, 'ma6-03-reviewed.png'), fullPage: true });

await finish();

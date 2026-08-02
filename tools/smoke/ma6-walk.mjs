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
// Env: XR_CHROME / XR_PW override the browser and Playwright paths.
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const OUT = process.env.XR_SMOKE_OUT || HERE;
const CHROME = process.env.XR_CHROME
    || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PW = process.env.XR_PW
    || '/opt/node22/lib/node_modules/playwright/index.mjs';
if (!existsSync(CHROME)) {
    console.error(`No Chromium at ${CHROME} — set XR_CHROME. (The headless_shell build cannot load extensions.)`);
    process.exit(2);
}
const { chromium } = await import(PW);

// Bundle the seed harness so the page can use the real models.
createRequire(import.meta.url)('esbuild').buildSync({
    entryPoints: [join(HERE, 'seed-entry.js')],
    outfile: join(REPO, 'dist', '_smoke-seed.bundle.js'),
    bundle: true, format: 'iife', platform: 'browser', target: 'chrome120'
});

const profile = mkdtempSync(join(tmpdir(), 'xr-profile-'));

const findings = [];
const note = (s) => console.log(s);
const fail = (s) => { findings.push(s); console.log('  ✗ ' + s); };
const ok = (s) => console.log('  ✓ ' + s);

const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME,
    args: ['--headless=new', '--no-sandbox',
           `--disable-extensions-except=${REPO}`, `--load-extension=${REPO}`],
    viewport: { width: 1400, height: 1100 }
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
const extId = new URL(sw.url()).host;
note(`extension ${extId}`);

const PORTAL = `chrome-extension://${extId}/src/portal/index.html`;
const SEED_JS = `chrome-extension://${extId}/dist/_smoke-seed.bundle.js`;

const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });

async function harness() {
    await page.addScriptTag({ url: SEED_JS });
    await page.waitForFunction(() => window.__xrReady === true, { timeout: 10000 });
}

await page.goto(PORTAL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(600);
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
if (seed.error) { fail(`seed failed: ${seed.error}`); }
else {
    if (seed.results.some((r) => r.status === 'failed')) fail(`a fold failed: ${JSON.stringify(seed.results)}`);
    else ok(`both folds saved (${seed.results.map((r) => r.added).join(' + ')} atoms added)`);
    if ((seed.results[0].droppedUngrounded || 0) !== 1) {
        fail(`member 0 should have dropped exactly 1 ungroundable quote, got ${seed.results[0].droppedUngrounded}`);
    } else ok('the ungroundable quote was dropped, not stored');
}

// -------------------------------------------------------------- render
note('\n[2] rendering the case dashboard');
await page.goto(PORTAL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await harness();   // window.__xr does not survive a navigation
await page.evaluate((h) => { window.__xrHashes = h; }, seed.hashes);
// The library paints only after the relay fetch settles, and the case
// row lives under the Cases facet. Wait for the tabs, activate Cases,
// then click the row (a bare text locator also matches the hidden facet
// <option>, which is never clickable — hence the explicit tab + row).
await page.waitForSelector('button.xr-tab', { timeout: 30000 }).catch(() => {
    fail('the library never painted its type tabs');
});
const casesTab = page.locator('button.xr-tab', { hasText: /^Cases/ }).first();
if (!(await casesTab.count())) fail('no Cases tab — the case kind-0 is not in the relay cache');
else { await casesTab.click(); await page.waitForTimeout(1000); }
// The dashboard is opened by the row's own "☰ Dashboard" badge button
// (index.js), not by clicking the title text.
const dash = page.locator('button', { hasText: '☰ Dashboard' }).first();
if (!(await dash.count())) fail('the case row has no "☰ Dashboard" button');
else {
    await dash.click({ timeout: 15000 })
        .catch((e) => fail(`opening the case dashboard failed: ${String(e.message).split('\n')[0]}`));
    await page.waitForTimeout(5000);
}
await page.screenshot({ path: join(OUT, 'ma6-01-case.png'), fullPage: true });

let blockText = await page.evaluate(() => {
    const h = [...document.querySelectorAll('h3')].find((e) => /Extracted assertions/.test(e.textContent || ''));
    if (!h) return null;
    const box = h.closest('.xr-synth') || h.parentElement;
    return box.innerText;
});
if (!blockText) {
    // The block may live inside a collapsed section — open everything.
    await page.evaluate(() => {
        for (const d of document.querySelectorAll('details')) d.open = true;
    });
    await page.waitForTimeout(2000);
    blockText = await page.evaluate(() => {
        const h = [...document.querySelectorAll('h3')].find((e) => /Extracted assertions/.test(e.textContent || ''));
        if (!h) return null;
        return (h.closest('.xr-synth') || h.parentElement).innerText;
    });
}
if (!blockText) {
    fail('the extraction block did not render on the case dashboard');
    const diag = await page.evaluate(async () => {
        const X = window.__xr;
        const out = { headings: [...document.querySelectorAll('h2,h3')].map((e) => e.textContent.trim()).slice(0, 40) };
        try {
            const { collectCaseDossierData } = await import('/dist/_smoke-seed.bundle.js').catch(() => ({}));
            void collectCaseDossierData;
        } catch (_) { /* not exported */ }
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
}
else {
    ok('extraction block rendered');
    note(blockText.split('\n').slice(0, 10).map((l) => '  | ' + l).join('\n'));
}
await page.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = true; });
await page.waitForTimeout(2500);
await page.screenshot({ path: join(OUT, 'ma6-02-expanded.png'), fullPage: true });

// ------------------------------------------------- publish affordance
note('\n[3] the publish affordance');
const buttons = await page.evaluate(() =>
    [...document.querySelectorAll('button')].map((b) => b.textContent.trim())
        .filter((t) => /publish/i.test(t)));
note('  publish-ish buttons: ' + JSON.stringify(buttons));
if (!buttons.some((b) => /Publish analysis/.test(b))) {
    fail('no per-article "Publish analysis…" button rendered with the flag ON');
} else ok('per-article publish button present');
if (!buttons.some((b) => /Publish all 2 analyses/.test(b))) {
    fail(`expected a batch button naming N=2, got ${JSON.stringify(buttons)}`);
} else ok('batch button names the exact N');

// The confirm text, captured without publishing (dialog dismissed).
const dialogs = [];
page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
const perArticle = page.locator('button', { hasText: /^Publish analysis…$/ }).first();
if (await perArticle.count()) { await perArticle.click(); await page.waitForTimeout(600); }
const batch = page.locator('button', { hasText: /^Publish all 2 analyses…$/ }).first();
if (await batch.count()) { await batch.click(); await page.waitForTimeout(600); }
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
// open queue into "Already covered", not sit there as an open proposal.
const coveredSection = await page.evaluate(() =>
    [...document.querySelectorAll('summary')].map((s) => s.textContent.trim())
        .filter((t) => /Already covered/.test(t)));
if (!coveredSection.length) fail('the "Already covered by existing claims" section did not render');
else ok('covered atoms fold out of the open queue: ' + JSON.stringify(coveredSection));

// Accept the first open atom → mints a real claim through ClaimModel.
const beforeClaims = await page.evaluate(async () =>
    Object.keys(await window.__xr.ClaimModel.getAll() || {}).length);
const acceptBtn = page.locator('button', { hasText: /^Accept as claim$/ }).first();
if (!(await acceptBtn.count())) fail('no "Accept as claim" button in the open queue');
else {
    const boxes = page.locator('input.xr-extr__text');
    const prefill = await boxes.first().inputValue().catch(() => null);
    note('  claim-text box prefilled with: ' + JSON.stringify(String(prefill).slice(0, 70)));
    await acceptBtn.click();
    await page.waitForTimeout(1800);
}
const afterClaims = await page.evaluate(async () =>
    Object.keys(await window.__xr.ClaimModel.getAll() || {}).length);
if (afterClaims !== beforeClaims + 1) fail(`Accept did not mint exactly one claim (${beforeClaims} → ${afterClaims})`);
else ok(`Accept minted a claim (${beforeClaims} → ${afterClaims})`);

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

// Dismiss an atom, then reload and confirm the dismissal persisted.
const dismissBtn = page.locator('button', { hasText: /^Dismiss$/ }).first();
if (!(await dismissBtn.count())) fail('no Dismiss button in the open queue');
else { await dismissBtn.click(); await page.waitForTimeout(1500); }
const afterDismiss = await page.evaluate(async (hashes) => {
    const X = window.__xr;
    let dismissed = 0;
    for (const h of hashes) dismissed += X.partitionAssertions(await X.getArticleExtraction(h)).dismissed.length;
    return dismissed;
}, seed.hashes);
if (afterDismiss !== 1) fail(`expected exactly 1 dismissed atom on the record, got ${afterDismiss}`);
else ok('Dismiss is remembered on the record, not just in the DOM');

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
const pub = page.locator('button', { hasText: /^Publish analysis…$/ }).first();
if (!(await pub.count())) fail('the per-article publish button vanished after review');
else {
    await pub.click();
    await page.waitForTimeout(9000);
    const status = await page.evaluate(() =>
        [...document.querySelectorAll('.xr-synth__status')].map((e) => e.textContent.trim()).filter(Boolean));
    note('  status text: ' + JSON.stringify(status));
    if (status.some((t) => /No local identity/i.test(t))) {
        fail('the publish path stopped at the identity check — the transport was never exercised');
    }
    if (!status.some((t) => /Publish failed|No relays|not accept/i.test(t))) {
        fail(`a failed publish did not report a clear failure; status was ${JSON.stringify(status)}`);
    } else ok('a failed publish reports it plainly instead of throwing or silently succeeding');
    const stamped = await page.evaluate(async (h) => {
        const r = await window.__xr.getArticleExtraction(h);
        return { published_at: r.published_at || null, ev: r.published_event_id || null };
    }, seed.hashes[0]);
    if (stamped.published_at) fail('a FAILED publish stamped the record as published');
    else ok('a failed publish leaves no publish stamp on the record');
}
await page.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = true; });
await page.waitForTimeout(1200);
await page.screenshot({ path: join(OUT, 'ma6-03-reviewed.png'), fullPage: true });

writeFileSync(join(OUT, 'ma6-block.txt'), blockText || '(absent)');
writeFileSync(join(OUT, 'ma6-pageerrors.txt'), pageErrors.join('\n') || '(none)');
note('\n[8] page errors across the whole walk');
note(pageErrors.length ? pageErrors.slice(0, 12).map((e) => '  ! ' + e).join('\n') : '  (none)');

note(findings.length ? `\nFINDINGS (${findings.length}):\n` + findings.map((f) => ' - ' + f).join('\n')
                     : '\nNO FINDINGS — every check passed');
await ctx.close();
process.exit(findings.length ? 1 : 0);

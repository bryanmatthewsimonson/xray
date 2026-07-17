---
name: xray-capture
description: Capture articles into X-Ray by URL, enumerate an article's outbound-link frontier for corpus expansion, and run a scouting suggest pass. Use when the user asks to capture a URL into X-Ray, capture the links from an article, expand a case corpus, or scout what an article would yield. Requires the claude-in-chrome connector and the X-Ray extension loaded.
---

# X-Ray capture — drive the extension, expand the corpus

You are driving the X-Ray WebExtension through the user's real Chrome
(claude-in-chrome tools) to capture articles and enumerate capture
frontiers. You are a *researcher's runner*: you fetch and file, you
never judge, and **nothing model-produced becomes durable X-Ray data
through you** — proposals are accepted by the human in the reader,
or not at all.

## Hard rules (the project constitution — these bind every step)

1. **No auto-accept, ever.** Never write entities, claims, links,
   facts, findings, or baselines into `chrome.storage.local` or the
   extension's IndexedDB. The ONLY writes you may cause are the ones
   the extension itself performs in response to its own capture flow
   (`xray:capture` → reader auto-archive). If a suggest pass returns
   proposals, you REPORT them; the human accepts in the reader.
2. **Never touch publish paths.** No relay messages, no signing.
3. **The extension's API key stays in its service worker.** Talk to
   the LLM only via the extension's own `xray:llm:*` messages (which
   gate on the user's flags + key). Never read `xray:llm:key`.
4. **Pace yourself.** Captures run sequentially — one tab, one URL at
   a time, waiting for each load. Suggest passes are paid API calls:
   state the count and get the user's go-ahead in chat before running
   more than one.
5. **Capture only where directed.** The user names the seed URL(s) or
   approves the frontier list before you fan out. Skip login-walled or
   paywalled pages you cannot render; report them as uncapturable
   rather than working around access controls.
6. **Forensic findings stay out of scope** for suggestion scouting
   (maintainer decision 2026-07-16: not until the attribution fixes
   are proven on real articles).

## Preflight (once per session)

1. Confirm the claude-in-chrome tools are available (load via
   ToolSearch if deferred).
2. Find the X-Ray extension origin: call `tabs_context`. If no
   `chrome-extension://` tab is open, ask the user to open the X-Ray
   portal (extension icon → or `chrome://extensions` → X-Ray →
   Details → open `src/portal/index.html`), then re-read
   `tabs_context` and note the origin `chrome-extension://<ID>`.
   Keep that portal tab open — it is your command surface.
3. Capability probe: run `javascript_tool` on the portal tab with
   `typeof chrome.tabs.query` — expect `"function"`. If the tool
   cannot execute JS on extension pages, STOP and tell the user this
   skill needs that capability; do not improvise another write path.

## Capture one URL (K.1)

1. Open/navigate a NON-portal tab to the article URL. Wait for load
   (screenshot or `get_page_text` sanity check — a real article body,
   not a consent wall or error page).
2. From the **portal tab**, run `javascript_tool`:

   ```js
   (async () => {
     const tabs = await chrome.tabs.query({ url: '<ARTICLE_URL_PATTERN>' });
     if (!tabs.length) return 'no-tab';
     const resp = await chrome.tabs.sendMessage(tabs[0].id, { type: 'xray:capture' });
     return resp && resp.ok ? 'capture-sent' : ('failed: ' + JSON.stringify(resp));
   })()
   ```

   (`url` patterns need a trailing `*` for query params; the message
   lands in the content script — `src/content/index.js` — which opens
   the reader, and the reader auto-archives on open.)
3. **PDFs:** skip steps 1–2 and instead open a tab at
   `chrome-extension://<ID>/src/reader/index.html?pdf=<ENCODED_URL>`
   — the reader's tabless PDF path captures directly.
4. Verify the archive landed — from the portal tab:

   ```js
   (async () => {
     const db = await new Promise((res, rej) => {
       const r = indexedDB.open('xray-archive');
       r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
     });
     const recs = await new Promise((res, rej) => {
       const tx = db.transaction('articles').objectStore('articles').getAll();
       tx.onsuccess = () => res(tx.result); tx.onerror = () => rej(tx.error);
     });
     db.close();
     const hit = recs.find((r) => r.url && r.url.includes('<URL_DISTINCTIVE_PART>'));
     return hit ? { ok: true, title: hit.article && hit.article.title,
                    links: (hit.article && hit.article.links || []).length }
                : { ok: false, captured: recs.length };
   })()
   ```

   READ-ONLY: this is verification, never a write. If verification
   fails, report it (paywall? consent wall? CSP?) and move on — do not
   retry more than once.
5. Close the article tab if you opened it; report `title` + link
   count to the user.

## Enumerate the frontier (K.1)

From the portal tab, read the seed article's outbound links and
subtract what's already captured:

```js
(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('xray-archive');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const recs = await new Promise((res, rej) => {
    const tx = db.transaction('articles').objectStore('articles').getAll();
    tx.onsuccess = () => res(tx.result); tx.onerror = () => rej(tx.error);
  });
  db.close();
  const seed = recs.find((r) => r.url && r.url.includes('<SEED_URL_PART>'));
  if (!seed) return 'seed-not-captured';
  const have = new Set(recs.map((r) => r.url));
  const links = ((seed.article && seed.article.links) || [])
    .filter((l) => l && l.url && !l.internal)
    .filter((l) => !have.has(l.url));
  return { frontier: links.map((l) => ({ url: l.url, text: l.text, count: l.count })),
           truncated: !!(seed.article && seed.article.links_truncated) };
})()
```

Present the frontier as a numbered list (url + anchor text + cite
count). **Wait for the user to pick** which to capture (or confirm
"all"), then loop the capture procedure over the picks, one at a
time, reporting progress. Notes: `internal` is same-host-approximate;
`links_truncated` means the capture capped at 100 links — say so.

## Scouting suggest pass (K.2 — optional, costs API tokens)

Purpose: tell the researcher what a captured article would yield
BEFORE they invest reader time. It does NOT feed the reader's review
panel — accepting still happens there (and the reader's own Suggest
run is a second paid pass; say so when recommending it).

1. The pass scopes itself to the USER'S stored suggestion kinds
   (`xray:llm:suggest_kinds` — the worker reads it; the request cannot
   override it, by design). Read it first (portal tab,
   `chrome.storage.local.get`) so you can tell the user what the pass
   will cover. If `findings` or `baselines` are enabled there, note
   that per rule 6 you will not elaborate those proposals in your
   summary — review them in the reader.
2. Get the article text from the archive record
   (`record.article.markdown` — fall back to `textContent` if absent).
3. From the portal tab:

   ```js
   (async () => new Promise((res) => chrome.runtime.sendMessage({
     type: 'xray:llm:suggest',
     request: { articleText: <TEXT>, articleUrl: <URL>, articleTitle: <TITLE> }
   }, res)))()
   ```

   Gates (llmAssist flag + key + at-least-one-kind) are enforced
   worker-side; if the response is `{ok:false}`, relay its error
   verbatim (it names the Options toggle to flip).
4. Report a scouting summary in chat: counts per kind + the two or
   three most load-bearing claims verbatim (skip findings/baselines
   per rule 6). Recommend which articles deserve a reader pass. Do
   not store anything.

## Failure modes

| Symptom | Meaning | Do |
|---|---|---|
| `javascript_tool` refuses extension pages | capability missing | Stop; tell the user (preflight step 3) |
| `no-tab` from capture | URL pattern mismatch | Add `*` for query strings; re-query |
| `sendMessage` throws "no receiving end" | content script not injected (chrome:// page, PDF viewer, race) | PDFs → the `?pdf=` reader path; else reload the tab once |
| Verification finds no record | paywall/consent wall/CSP ate the capture | Report as uncapturable; do not bypass |
| Suggest returns `ok:false` | flag off or no key | Relay the error; the user flips it in Options |

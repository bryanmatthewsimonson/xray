# X-Ray demos — judge-facing reproducibility artifacts

Three tiny, **self-verifying** scripts for the FLF Epistack entry. Each
runs with plain `node` (no build, no install), prints a short narrative,
and exits non-zero if its invariant breaks — so they are both
demonstrations and checks. They map to the entry's compounding/robustness
claims ([`docs/EPISTACK_WIN_PLAN.md`](../docs/EPISTACK_WIN_PLAN.md) §5
deliverable 4, §7) and to the judging dimensions in
[`docs/epistack/JUDGING_CRITERIA.md`](../docs/epistack/JUDGING_CRITERIA.md).

| Demo | Run | Shows | Win plan | Judging dimension |
|---|---|---|---|---|
| **Content-addressing tamper** | `node demos/content-address-tamper.mjs` | A verdict is welded to the exact reviewed bytes via the `x` hash: a content edit breaks the binding in the open; benign reformatting (trailing spaces, CRLF) does not. | §5.4a, §7.1 | 6 (adversarial robustness) |
| **n=2 disagreeing verdict** | `node demos/n2-disagreeing-verdict.mjs` | Two authors rule oppositely on one proposition; the shipped `verdictVariance` surface holds both as a distribution and **never averages** them. | §5.4b, §7.7 | 3 (compounding), 6 |
| **Relay replay** | `node demos/relay-replay.mjs <npub> [wss://…]`<br>`node demos/relay-replay.mjs --self-test` | Rebuilds the graph from public relays with **no extension and no dependencies** — a bare NOSTR `REQ` over a WebSocket — and walks a verdict back to the source bytes it binds to. | §5.4c, §7.3 | 3, 4 (scalability) |

## Notes

- **Same code as ships.** The tamper demo imports the extension's real
  `articleHash`; the n=2 demo imports the real `verdictVariance`. What you
  see is the wire behaviour, not a reimplementation. (The n=2 demo adds a
  one-line `chrome` shim only so the storage module *loads* outside a
  browser — it never touches storage.)
- **Relay replay** needs a published graph to be interesting. Until the
  capture run publishes one, `--self-test` verifies the pure parts
  (bech32 npub→hex decode, event index, verdict→claim→source walk)
  offline. Once the graph is live, pass the auditor npub and, optionally,
  relays (defaults to the §11 shortlist).
- All three are covered by `npm test` (`tests/demos.test.mjs` runs each as
  a subprocess and asserts it exits clean).
- Needs **Node 21+** for the global `WebSocket` (the replay live path
  only; the self-tests run on any supported Node).

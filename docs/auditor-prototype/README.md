# X-Ray Epistemic Auditor

Three deliverables that turn the auditor framework into runnable artifacts. Designed to slot into [bryanmatthewsimonson/xray](https://github.com/bryanmatthewsimonson/xray) — your existing capture pipeline produces the exact input these tools expect.

## Layout

```
xray-auditor/
├── prompts/        ← Surface-scan prompt suite. Try in Claude.ai right now.
├── schema/         ← Dossier data model. NOSTR-aligned.
└── scorer/         ← Node prototype that orchestrates everything.
```

## In what order to use this

1. **Browser test the prompts.** Open `prompts/00-orchestrator-single-shot.md`, paste it into Claude.ai followed by an article you want audited (X-Ray's "Capture Article → Markdown" tab gives you the right format). You'll get a single JSON report covering all eight dimensions. Use this to calibrate the scoring against articles where you already have a strong intuition — it's the fastest way to surface where the prompts need tuning.

2. **Read the schema.** `schema/audit-types.ts` defines every entity: articles (content-addressed by SHA-256 of normalized markdown), atomic claims, per-module results, aggregate audits, prediction ledger entries, prediction resolutions, author/publication dossiers, and audit disputes. NOSTR kind suggestions for each are in `schema/README.md`. The schema is what makes audits cross-publishable across X-Ray's NOSTR backbone.

3. **Run the prototype scorer.** `cd scorer && npm install && node example-usage.js` produces a full audit of a sample article in roughly one round-trip's worth of time (eight parallel API calls). Then point it at real articles via `node scorer.js --input article.md --metadata meta.json --output audit.json`.

## What this is, structurally

- The **prompts** are the auditor's eyes. Each module is a self-contained, versioned scoring methodology that produces structured findings with evidence quotes for every claim.
- The **schema** is the auditor's memory. Every article, claim, module result, and aggregate score lives as a discrete entity, time-stamped, attributed to its auditor, and content-anchored to the immutable text it scored.
- The **scorer** is the auditor's reflex. It takes a captured article, fans out the eight modules in parallel, validates and aggregates, and returns a structured report. Future versions wire this into NOSTR publishing as audit events that other clients can verify, dispute, and roll up.

## What's not yet built (intentionally)

- **Persistence layer.** The scorer returns JSON; production needs a store. For X-Ray, that store is NOSTR relays publishing the suggested kinds (30050–30055).
- **Dispute pipeline.** Schema includes `AuditDispute`; the runtime to file, adjudicate, and re-score on upheld disputes is still to come.
- **Multi-auditor consensus.** Single Claude instance for the prototype. Production should run the same article through multiple models (Claude + GPT + a human) and surface the disagreement rather than averaging it away.
- **Dossier rollup queries.** `DossierSnapshot` is defined; the SQL/relay queries that materialize it from underlying audits are next.
- **Knowability module.** Currently derived heuristically from source-quality findings. A dedicated module — or a beat-specific lookup table — would be more defensible.

## Why the design choices

- **Content-addressed articles.** Outlets stealth-edit. The hash anchors every audit to the exact text that was scored, so old audits don't silently apply to new content. Capturing both versions is its own diagnostic.
- **Per-module results stored independently.** When a module's methodology improves, only that module needs recomputing; old results remain valid under their original methodology version.
- **Auditor identity is first-class.** Every score carries who produced it (model+version, human pubkey, or pipeline). The system can — and should — audit the auditors over time.
- **Disagreement is published, not averaged.** When multiple auditors score the same article, all individual scores and their variance are preserved. False consensus is more dangerous than visible disagreement.
- **Predictions extracted at audit time, resolved later.** The long-game asset. A multi-year prediction ledger graded against reality is the most powerful retrospective evidence about an author's calibration that exists.
- **Knowability ceiling.** Articles on inherently hard-to-verify topics (classified intelligence, private corporate matters) get capped maximum scores. Without this, you penalize careful reporters for working hard problems.

## How this fits X-Ray specifically

X-Ray is structurally well-positioned for this work because:

- **NOSTR-native publishing** means audits are public, signed, and aggregable across the network without a central authority. This is what an epistemic auditor *should* be — accountable, reproducible, decentralized.
- **The capture pipeline already produces clean markdown** via Readability + Turndown. Layer 1 of the auditor architecture (ingestion + normalization) is essentially done.
- **Phase 4's planned `kind: 30040` claims** are the atomization layer. The auditor's surface scans produce findings that reference these claims, and the dossier rollups aggregate across them.
- **The metadata badge surface** is the natural display surface for audit scores. A reader visiting an article sees an aggregated score, the per-module breakdown, and the option to file a dispute — all from existing X-Ray UI.

The auditor isn't a separate project. It's the next phases.

---

For the underlying philosophy (governing principles, dimensions, knowability, calibration multiplier, dispute mechanics, accessibility tiers), see the conversation that produced these deliverables. The TL;DR: an outsider with full transparency, modest claims, and a published method beats an insider with privileged access and unstated priors over a long enough timeframe — and these tools are the published method.

*[Editor's note, 2026-06-11: that conversation's prose is recovered and vendored, normatively, at [`docs/PHILOSOPHY.md`](../PHILOSOPHY.md) (v1.0.0); the participation-tier prose ("accessibility tiers") is recorded separately, in the RQ3 resolution of [`docs/EPISTEMIC_AUDIT_DESIGN.md`](../EPISTEMIC_AUDIT_DESIGN.md).]*

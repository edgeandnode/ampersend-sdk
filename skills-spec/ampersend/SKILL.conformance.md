# SKILL.md conformance

Latest verdict for each rule in [`SKILL.spec.md`](SKILL.spec.md). Regenerate when
[`skills/ampersend/SKILL.md`](../../skills/ampersend/SKILL.md) or `SKILL.spec.md` changes.

- **Generated against:** `skills/ampersend/SKILL.md` at HEAD
- **Date:** 2026-05-08
- **By:** Claude

1. PASS — `name: ampersend` (9 chars, kebab-case); description ~430 chars (under 1024); no other frontmatter fields.
2. PASS — Two sentences; first says what, second says when (five trigger clauses covering URL-in-hand,
   capability-without-URL, and explore mode); plain user words; no first-person pronouns.
3. PASS — Description leads with the imperative "Give an agent…" and triggers on "Use when…"; the discovery clauses name
   concrete recognition cues ("names a capability they want without a specific URL in mind", "is asking what the agent
   can pay for") rather than passive dispositions.
4. PASS — Frontmatter `name: ampersend` matches the parent directory `skills/ampersend/`.
5. PASS — Body is 177 lines.
6. PASS — Order is orientation → scope → suggesting things to try → user explainer → install → security → setup →
   payment → output → config; setup and payment workflows are numbered steps.
7. PASS — `references/` contains two files (`commands.md`, `example-services.md`); no subdirectories.
8. PASS — `references/commands.md` is 116 lines and starts with "Contents". `references/example-services.md` is 326
   lines and starts with a Contents section listing all 14 capability headings plus the Response patterns section.
9. PASS — Body content is system-specific. The body's capability list names categories in user-voice (no "pay-per-...",
   "API-key relationship", or "x402-paid" framing leaking from the agent-economy register); curated third-party services
   and the Pinata response pattern live only in `references/example-services.md`, both covered by the rule's carve-outs.
10. PASS — "co-sign" is hyphenated consistently in prose; `CoSignerValidator` is a code identifier and does not count.
    The new section uses "service", "capability", and "endpoint" consistently. Aggregator-routed services (Apollo,
    Hunter, RentCast) are consistently described as "via StableEnrich".
11. PASS — Floor stated as prose ("v0.0.22 or newer"); install command uses `@latest`; no `@x.y.z` strings. Examples
    file does not pin third-party versions.
12. PASS — "ampersend service", "ampersend CLI", co-sign, smart account, x402, USDC, and Base are each glossed on first
    mention in `SKILL.md`. Capability categories are glossed inline in user-voice. In `references/example-services.md`,
    StableEnrich is glossed ("aggregator gateway that fronts several upstream APIs behind one paid surface") on first
    mention before being referenced in four entries.
13. PASS — Tier 1 and tier 2 user explainers use only "spending allowance", "limits", "key", "account you own"; the
    flagged words appear only in tier 3. The "Suggesting things to try" section now matches that voice — no "wallet",
    "stablecoin", "blockchain", "smart account", or "crypto" appears in the body's capability glosses.
14. PASS — Security section forbids dashboard login from a controlled browser; setup workflow requires showing
    `verificationCode` alongside `user_approve_url` and having the user confirm it matches.
15. PASS — Hard imperatives appear only where they guard real safety boundaries: Security section (MITM/key
    substitution); "don't recommend from training" (agent inventing services); "Real-world purchases" (irreversible
    spend). Style and product-explanation guidance remains framed as preference.
16. PASS — 14 capabilities in the body, 14 entries under those capabilities in `references/example-services.md`, plus
    one entry in the Response patterns section. Mapping: Web search → Firecrawl; Email → AgentMail; Email lookup and
    verification → Apollo people-enrich + Hunter email-verifier (via StableEnrich); Voice calls → StablePhone; Property
    valuation → RentCast (via StableEnrich); Domain registration → Bloomfilter; File hosting → StableUpload; Image and
    video generation → StableStudio; LLM inference → BlockRun; Social data → StableSocial; News and market data →
    Gloria; Job search → StableJobs; Travel search → StableTravel; Real-world purchases → Laso. Pinata sits in the
    Response patterns section (it's a URL-shape the agent must handle, not a thing the agent suggests). No orphan
    capabilities, no orphan suggestable services.

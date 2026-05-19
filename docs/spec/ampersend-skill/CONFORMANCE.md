# SKILL.md conformance

Latest verdict for each rule in [`SPEC.md`](SPEC.md). Regenerate when
[`skills/ampersend/SKILL.md`](../../../skills/ampersend/SKILL.md) or `SPEC.md` changes.

- **Generated against:** `skills/ampersend/SKILL.md` at HEAD
- **Date:** 2026-05-19
- **By:** Claude

1. PASS — `name: ampersend` (9 chars, kebab-case); description ~430 chars (under 1024); `version: 0.0.22` is the only
   additional frontmatter field, allowed under the agentskills.io spec's open additional-properties stance.
2. PASS — Two sentences; first says what, second says when (five trigger clauses covering URL-in-hand,
   capability-without-URL, and explore mode); plain user words; no first-person pronouns.
3. PASS — Description leads with the imperative "Give an agent…" and triggers on "Use when…"; the discovery clauses name
   concrete recognition cues ("names a capability they want without a specific URL in mind", "is asking what the agent
   can pay for") rather than passive dispositions.
4. PASS — Frontmatter `name: ampersend` matches the parent directory `skills/ampersend/`.
5. PASS — Body is 235 lines, under the 500-line ceiling.
6. PASS — Order is orientation → scope → CLI prerequisite → suggesting things to try → user explainer → security → setup
   → payment → discovery → output → config; setup, payment, and discovery workflows are numbered steps or command
   blocks.
7. PASS — `references/` contains two files (`commands.md`, `example-services.md`); no subdirectories.
8. PASS — `references/commands.md` is 116 lines and starts with "Contents". `references/example-services.md` is 326
   lines and starts with a Contents section listing all 14 capability headings plus the Response patterns section.
9. PASS — Body content is system-specific. The body's capability list names categories in user-voice (no "pay-per-...",
   "API-key relationship", or "x402-paid" framing leaking from the agent-economy register); curated third-party services
   and the Pinata response pattern live only in `references/example-services.md`, both covered by the rule's carve-outs.
10. PASS — "co-sign" is hyphenated consistently in prose; `CoSignerValidator` is a code identifier and does not count.
    The new section uses "service", "capability", and "endpoint" consistently. Aggregator-routed services (Apollo,
    Hunter, RentCast) are consistently described as "via StableEnrich".
11. PASS — Floor stated as prose ("below `0.0.22`"); `npm install` uses `@latest`; skill upgrade uses
    `npx skills update ampersend`, which respects the moving `#skills/latest` ref the install command pinned. No
    `@x.y.z` or `#v0.0.x` strings in `SKILL.md`. Examples file does not pin third-party versions.
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
17. PASS — "Suggesting things to try" opens with: "Ampersend is the agentic payments layer between the agent and the
    services below. Services don't need to know ampersend exists — they accept payments from any agent capable of paying
    as part of making an HTTP request, and ampersend handles the agent's side: enforcing the user's spending limits,
    co-approving each payment, and paying on the user's behalf." Framing precedes the categories list. Body contains
    "x402" only in the tier-3 user explainer (line 106), which rule 13 explicitly carves out; the generic descriptors at
    lines 32 and 193 now read "pays as part of the request" and "any compatible paid endpoint".
18. PASS — Two sandbox mentions, both flagged: Discovery workflow says "`marketplace list` against the sandbox returns a
    smaller catalog than production — feature absence in the sandbox does not imply feature absence in production."
    Common config tweaks says "The sandbox covers the payment flow end-to-end, but only a subset of services and
    capabilities are wired up there — feature absence in the sandbox doesn't mean feature absence in production."
19. PASS — Frontmatter carries `version: 0.0.22`. The "CLI prerequisite" section instructs the agent to run
    `ampersend version`, compare the skill's frontmatter `version` against `minSkillVersion` from that JSON envelope,
    and run `npx skills update ampersend` if the skill is behind. The CLI-behind path is the separate
    `npm install -g @ampersend_ai/ampersend-sdk@latest --force` instruction, gated on `cliVersion` being missing or
    below `0.0.22`.

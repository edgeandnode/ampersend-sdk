# SKILL.md conformance

Latest verdict for each rule in [`SPEC.md`](SPEC.md). Regenerate when
[`skills/ampersend/SKILL.md`](../../../skills/ampersend/SKILL.md) or `SPEC.md` changes.

- **Generated against:** `skills/ampersend/SKILL.md` at HEAD
- **Date:** 2026-06-16
- **By:** Claude (regenerated after trimming the Onboarding tour section: dropped the `mode: "inert"` etiquette bullet
  (CI/deploy-only, not a state an ordinary sandbox/production user reaches — it now lives in `references/commands.md`
  alone) and folded the redundant "you don't need to know the steps" paragraph into the routing paragraph above it; also
  trimmed the `references/commands.md` `tour` intro paragraph of two sentences the field table and mechanics bullets
  already cover)

1. PASS — `name: ampersend` (9 chars, kebab-case); description ~430 chars (under 1024); `version: 0.0.27` is the only
   additional frontmatter field, allowed under the agentskills.io spec's open additional-properties stance.
2. PASS — Two sentences; first says what, second says when (five trigger clauses covering URL-in-hand,
   capability-without-URL, and explore mode); plain user words; no first-person pronouns.
3. PASS — Description leads with the imperative "Give an agent…" and triggers on "Use when…"; the discovery clauses name
   concrete recognition cues ("names a capability they want without a specific URL in mind", "is asking what the agent
   can pay for") rather than passive dispositions.
4. PASS — Frontmatter `name: ampersend` matches the parent directory `skills/ampersend/`.
5. PASS — Body is 320 lines, under the 500-line ceiling.
6. PASS — Order is orientation → scope → CLI prerequisite → suggesting things to try → user explainer → security →
   onboarding tour → setup → payment → reading agent state → discovery → output → config; setup, payment, reading-state,
   and discovery workflows are numbered steps or command blocks. The Onboarding tour section is now prose plus an
   etiquette bullet list (no numbered step machine — it routes to existing workflows by anchor link and lets the `tour`
   command carry the progression). The Common config tweaks block lists the context verbs (`config use`/`config rm`)
   after `config status`; in-place API-URL editing was removed (a context's URL is fixed at creation), so the block no
   longer shows `config set --api-url`/`--clear-api-url`.
7. PASS — `references/` contains three files (`commands.md`, `example-services.md`, `marketplace.md`); no
   subdirectories.
8. PASS — `references/commands.md` is 381 lines and starts with "Contents" (lists `tour` between `agent` and `config`).
   The `tour` section is an output-field table (now including the `hint` and `degraded` fields) plus mechanics/error
   detail — exactly the kind of flag-level material rule 7 keeps in `references/` rather than `SKILL.md`; the step
   machine, step order, the cheapest-window-first hydration, the per-track degradation behavior, and the CLI-owned
   sandbox→production bridge all live here, not in the body. `references/example-services.md` is 336 lines and starts
   with a Contents section listing all 14 capability headings plus the Response patterns section.
   `references/marketplace.md` is 80 lines — under the 100-line TOC threshold — so a table of contents is not required.
9. PASS — Body content is system-specific. The body's capability list names categories in user-voice (no "pay-per-...",
   "API-key relationship", or "x402-paid" framing leaking from the agent-economy register); curated third-party services
   and the Pinata response pattern live only in `references/example-services.md`, both covered by the rule's carve-outs.
   The new "Reading agent state" section is system-specific (server-authoritative envelope, agent-scoped, dashboard
   split between read and write).
10. PASS — "co-sign" is hyphenated consistently in prose; `CoSignerValidator` is a code identifier and does not count.
    The tour section uses "service", "capability", and "endpoint" consistently. Aggregator-routed services (Apollo,
    Hunter, RentCast) are consistently described as "via StableEnrich". The config concept is named "context" everywhere
    it appears (SKILL.md and `references/commands.md`); no competing term ("profile") is used. "environment" appears in
    the SKILL.md body only inside "environment variables" (the inert line), never as a synonym for a context; the
    sandbox/production split is named with "track" there, and `references/commands.md` uses "environment" for that split
    consistently. "track" and "tour" are used consistently across both files.
11. PASS — Floor stated as prose ("below `0.0.27`"); `npm install` uses `@latest`; skill upgrade uses
    `npx skills update ampersend`, which respects the moving `#skills/latest` ref the install command pinned. No
    `@x.y.z` or `#v0.0.x` strings in `SKILL.md`. Examples file does not pin third-party versions.
12. PASS — "ampersend service", "ampersend CLI", co-sign, smart account, x402, USDC, and Base are each glossed on first
    mention in `SKILL.md`. Capability categories are glossed inline in user-voice. The ERC-8004 registry is glossed
    inline ("a public, open registry of agents") on first mention in the Discovery workflow. In
    `references/example-services.md`, StableEnrich is glossed ("aggregator gateway that fronts several upstream APIs
    behind one paid surface") on first mention before being referenced in four entries. "context" is glossed under the
    Common config tweaks heading ("each a self-contained identity (agent key + account + its own API URL)") before the
    command block uses it. In the Onboarding tour section, "track" is introduced by its two named instances ("two tracks
    — `sandbox` and `production`") and the etiquette bullet meanings them in user-voice ("play money first (the
    sandbox)... or straight to real money") — enough to be self-explanatory without a formal parenthetical, and the full
    play-money/real-money framing lives one click away in `references/commands.md`.
13. PASS — Tier 1 and tier 2 user explainers use only "spending allowance", "limits", "key", "account you own"; the
    flagged words appear only in tier 3. The "Suggesting things to try" section now matches that voice — no "wallet",
    "stablecoin", "blockchain", "smart account", or "crypto" appears in the body's capability glosses.
14. PASS — Security section still forbids dashboard login from a browser the agent controls and forbids asking the user
    to sign in through a browser the agent can see (now framed positively: dashboard work happens "in their own
    browser"); setup workflow requires showing `verificationCode` alongside `user_approve_url` and having the user
    confirm it matches.
15. PASS — Hard imperatives appear only where they guard real safety boundaries: Security section (controlled-browser
    login, MITM/key substitution); "don't recommend from training" (agent inventing services); "Real-world purchases"
    (irreversible spend). The new "check before asserting a capability is missing" guidance (scope section) and the
    "don't treat printing a link as crossing the line" note (Security section) are framed as judgment guidance, not hard
    imperatives. Style and product-explanation guidance remains framed as preference; the tour section's quiet rules are
    introduced as "Etiquette the product team asks for" and use "ask"/"offer"/"treat … as a standing request", not hard
    imperatives. "Read the `hint` and relay it" is bolded for emphasis but is a routing instruction (how to use the
    command's output), not a safety imperative, so rule 15 is unaffected.
16. PASS — 14 capabilities in the body, 14 entries under those capabilities in `references/example-services.md`, plus
    one entry in the Response patterns section. Mapping: Web search → Firecrawl; Email → AgentMail; Email lookup and
    verification → Apollo people-enrich + Hunter email-verifier (via StableEnrich); Voice calls → StablePhone; Property
    valuation → RentCast (via StableEnrich); Domain registration → Bloomfilter; File hosting → StableUpload; Image and
    video generation → StableStudio; LLM inference → BlockRun; Social data → StableSocial; News and market data →
    Gloria; Job search → StableJobs; Travel search → StableTravel; Real-world purchases → Prepaid Visa cards
    (`ampersend card`). Pinata sits in the Response patterns section (it's a URL-shape the agent must handle, not a
    thing the agent suggests). No orphan capabilities, no orphan suggestable services.
17. PASS — "Suggesting things to try" opens with: "Ampersend is the agentic payments layer between the agent and the
    services below. Services don't need to know ampersend exists — they accept payments from any agent capable of paying
    as part of making an HTTP request, and ampersend handles the agent's side: enforcing the user's spending limits,
    co-approving each payment, and paying on the user's behalf." Framing precedes the categories list. Body contains
    "x402" only in the tier-3 user explainer (line 116), which rule 13 explicitly carves out; the generic descriptors at
    lines 33 ("pays only when `--pay` is passed") and 235 ("any compatible paid endpoint") stay protocol-neutral.
    "ERC-8004" appears once (line 222) but names a source of marketplace agents, not a payment protocol that services
    "accept", so it falls outside this rule.
18. PASS — Sandbox API URL mentions are flagged everywhere they occur: Discovery workflow says "`marketplace list`
    against the sandbox returns a smaller catalog than production — feature absence in the sandbox does not imply
    feature absence in production." Common config tweaks says "The sandbox covers the payment flow end-to-end, but only
    a subset of services and capabilities are wired up there — feature absence in the sandbox doesn't mean feature
    absence in production." The Onboarding tour section names the sandbox track but not the sandbox API URL and makes no
    catalog/coverage claim; the `tour` section in `references/commands.md` names the URL and carries the subset caveat
    inline.
19. PASS — Frontmatter carries `version: 0.0.27`. The "CLI prerequisite" section instructs the agent to run
    `ampersend version`, compare the skill's frontmatter `version` against `minSkillVersion` from that JSON envelope,
    and run `npx skills update ampersend` if the skill is behind. CLI install paths match `docs/getting-started.md`: "If
    `ampersend version` is missing" → fresh install via `npm install -g @ampersend_ai/ampersend-sdk@latest`; "If
    `cliVersion` is below `0.0.27`" → "upgrade — use the standard npm path" as a single short line, no second command
    block. `--force` absent from the body (verified by grep).
20. PASS — Paragraph in the orientation section, before the "Two things share the name" block and the first command
    block: "The name is spelled **ampersend** — amper + _send_, with an "e" — not the common misspelling "ampersand"."
    Names the wrong form explicitly; the npm-collision rationale lives in the spec rule, not the artifact. Phrased as
    fact, not directive, so rule 15 is unaffected.
21. PASS — "Onboarding tour" section sits between Security and the Setup workflow and is a thin router over
    `ampersend tour`. Trigger is intent-based, not an enumerated list: "Run it whenever the user needs a sense of what
    to do next — they ask 'where am I / what's next', you've just finished a setup or payment step…, or a fresh
    conversation starts." The body acts on the per-track `hint` ("Read the `hint` and relay it in your own words"),
    fulfills any command/workflow it names through existing sections by anchor link (Setup workflow, Payment workflow,
    `ampersend fund`), and switches context first when `contextIsActive` is false. The body does not restate the step
    machine or step order ("You don't need to know the steps or their order — the command tracks that") and carries no
    per-step prose; the progression, the `hint` field, and the sandbox→production bridge all live in
    `references/commands.md`. The fork question is the first etiquette bullet (play money first vs. straight to real
    money). Quiet rules cover `mode: "skipped"` and a `complete` track ("a standing request not to bring the tour up
    unprompted"; "don't nudge it further") with error help carved out ("helping with errors is always fine") and the
    other-track caveat preserved ("the user may still want to explore the other track"). A `degraded: true` track is
    documented as a transient "server couldn't be reached" state to relay, not a setup failure to escalate, with its
    mechanics (per-track degradation, suppressed bridge) left to `references/commands.md`. `mode: "inert"` is **not**
    documented in the body (CI/deploy env-credential path, not an ordinary sandbox/production user state); it lives in
    `references/commands.md` only. Etiquette framing satisfies rule 15 (see above).
